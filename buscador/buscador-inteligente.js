const fs = require("fs");
const path = require("path");

const CATALOGO_DIR = path.join(__dirname, "../palabras-clave-y-detalles");
const DATA_DIR = path.join(__dirname, "../datos-dux");

// ─── CARGAR CATÁLOGO Y DATOS ──────────────────────────────────────────────────
function cargarCatalogo(seccion = "baño") {
  const archivo = path.join(CATALOGO_DIR, `${seccion}.json`);
  if (!fs.existsSync(archivo)) return [];
  return JSON.parse(fs.readFileSync(archivo, "utf8"));
}

function cargarStock() {
  const archivo = path.join(DATA_DIR, "stock.json");
  if (!fs.existsSync(archivo)) return {};
  return JSON.parse(fs.readFileSync(archivo, "utf8"));
}

function cargarPrecios() {
  const archivo = path.join(DATA_DIR, "precios.json");
  if (!fs.existsSync(archivo)) return {};
  return JSON.parse(fs.readFileSync(archivo, "utf8"));
}

// ─── NORMALIZAR TEXTO ─────────────────────────────────────────────────────────
function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// ─── EXTRAER MEDIDAS DE LA CONSULTA ────────────────────────────────────────────
function extraerMedidas(consulta) {
  const medidas = new Set();
  const matches = consulta.match(/\b(\d{2,3})\s*cm?\b/gi);
  if (matches) {
    matches.forEach(m => {
      const num = m.replace(/\D/g, "");
      if (num.length > 1) medidas.add(num);
    });
  }
  return [...medidas];
}

// ─── EXTRAER COLORES DE LA CONSULTA ────────────────────────────────────────────
function extraerColores(consulta) {
  const coloresMap = {
    "blanco|blanc|bl": "BLANCO",
    "hormigon|hormigón|ormigon|gris|oscuro": "HORMIGON",
    "grafito|gráfito": "GRAFITO",
    "mezzo|mezo|meso|madera|marron|marrón": "MEZZO",
    "caju|cajú|cajou|arena|beige": "CAJU",
    "sahara|sahará": "SAHARA",
    "terra|tierra|beige marmol": "TERRA",
    "nero|negro|marquina": "NERO"
  };

  const coloresEncontrados = new Set();
  const consulta_norm = normalizar(consulta);

  for (const [pattern, color] of Object.entries(coloresMap)) {
    const regex = new RegExp(`\\b(${pattern})\\b`, "i");
    if (regex.test(consulta_norm)) {
      coloresEncontrados.add(color);
    }
  }

  return [...coloresEncontrados];
}

// ─── SCORING DE BÚSQUEDA ──────────────────────────────────────────────────────
function calcularScore(producto, consulta, medidas, colores) {
  const q = normalizar(consulta);
  const palabras = q.split(/\s+/).filter(p => p.length > 1);
  let score = 0;

  // 1. KEYWORDS DEL CATÁLOGO (motor de busqueda + tags)
  const keywords = (producto.keywords || []).map(normalizar);
  const todosKeywords = [
    ...keywords,
    ...(producto.tags || "").split(",").map(t => normalizar(t.trim())),
    normalizar(producto.nombre || ""),
    normalizar(producto.categoria || ""),
    normalizar(producto.linea || "")
  ];

  palabras.forEach(palabra => {
    // Palabra exacta en keywords
    if (todosKeywords.includes(palabra)) {
      score += 15;
    } else {
      // Palabra contenida
      todosKeywords.forEach(kw => {
        if (kw.includes(palabra) && palabra.length > 2) score += 5;
        if (palabra.includes(kw) && kw.length > 3) score += 3;
      });
    }
  });

  // 2. CÓDIGO EXACTO
  if (normalizar(producto.codigo) === q) {
    score += 100;
  } else if (palabras.some(p => normalizar(producto.codigo).includes(p))) {
    score += 30;
  }

  // 3. MEDIDA EXACTA
  if (medidas.length > 0 && producto.medida) {
    if (medidas.includes(producto.medida)) {
      score += 25;
    } else {
      score -= 10;
    }
  }

  // 4. COLORES COINCIDENTES
  const productosColores = (producto.colores || []).map(normalizar);
  colores.forEach(color => {
    if (productosColores.includes(normalizar(color))) {
      score += 20;
    }
  });

  // 5. BONUS POR CATEGORÍA EXPLÍCITA
  if (q.includes("cajones") && producto.guardado === "cajones") score += 15;
  if (q.includes("puertas") && producto.guardado === "puertas") score += 15;
  if (q.includes("bacha") && producto.categoria === "bacha") score += 20;
  if (q.includes("mesada") && producto.categoria === "mesada") score += 20;
  if (q.includes("espejo") && producto.categoria === "espejo") score += 20;
  if (q.includes("marbela") && producto.linea === "marbela") score += 20;

  return score;
}

// ─── BUSCAR PRODUCTOS ─────────────────────────────────────────────────────────
function buscar(consulta, seccion = "baño", limit = 5) {
  const catalogo = cargarCatalogo(seccion);
  const stock = cargarStock();
  const precios = cargarPrecios();

  if (catalogo.length === 0) {
    return {
      error: `No hay productos en la sección '${seccion}'`,
      resultados: [],
      debug: null
    };
  }

  const medidas = extraerMedidas(consulta);
  const colores = extraerColores(consulta);

  // Calcular scores
  const resultados = catalogo
    .map(prod => ({
      ...prod,
      score: calcularScore(prod, consulta, medidas, colores),
      stock_info: stock[prod.codigo] || { stockTotal: 0, variantes: {} },
      precio_madre: precios["57669"]?.items[prod.codigo]?.precio || 0,
      precio_may1: precios["58940"]?.items[prod.codigo]?.precio || 0,
      precio_may2: precios["59895"]?.items[prod.codigo]?.precio || 0
    }))
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    consulta,
    seccion,
    medidas_detectadas: medidas,
    colores_detectados: colores,
    resultados: resultados.map(r => ({
      codigo: r.codigo,
      nombre: r.nombre,
      categoria: r.categoria,
      medida: r.medida,
      colores: r.colores,
      score: r.score,
      stock_total: r.stock_info.stockTotal,
      stock_variantes: r.stock_info.variantes,
      precio_madre: r.precio_madre,
      precio_may1: r.precio_may1,
      precio_may2: r.precio_may2,
      linea: r.linea,
      guardado: r.guardado
    })),
    confianza: resultados.length > 0 ? (resultados[0].score > 30 ? "alta" : "media") : "baja"
  };
}

// ─── BUSCAR POR CÓDIGO EXACTO ─────────────────────────────────────────────────
function buscarPorCodigo(codigo, seccion = "baño") {
  const catalogo = cargarCatalogo(seccion);
  const stock = cargarStock();
  const precios = cargarPrecios();

  const cod_norm = normalizar(codigo);
  const producto = catalogo.find(p => normalizar(p.codigo) === cod_norm);

  if (!producto) return { error: `Código '${codigo}' no encontrado en ${seccion}` };

  return {
    codigo: producto.codigo,
    nombre: producto.nombre,
    categoria: producto.categoria,
    medida: producto.medida,
    colores: producto.colores,
    stock_total: (stock[producto.codigo] || { stockTotal: 0 }).stockTotal,
    stock_variantes: (stock[producto.codigo] || { variantes: {} }).variantes,
    precio_madre: precios["57669"]?.items[producto.codigo]?.precio || 0,
    precio_may1: precios["58940"]?.items[producto.codigo]?.precio || 0,
    precio_may2: precios["59895"]?.items[producto.codigo]?.precio || 0,
    linea: producto.linea,
    guardado: producto.guardado,
    descripcion: producto.nombre
  };
}

// ─── LISTAR SUGERENCIAS (para autocompletar) ───────────────────────────────────
function sugerencias(inicio, seccion = "baño", limit = 5) {
  const catalogo = cargarCatalogo(seccion);
  const inicio_norm = normalizar(inicio);

  return catalogo
    .filter(p => normalizar(p.codigo).startsWith(inicio_norm) ||
                 normalizar(p.nombre).includes(inicio_norm))
    .slice(0, limit)
    .map(p => ({
      codigo: p.codigo,
      nombre: p.nombre.substring(0, 60),
      categoria: p.categoria
    }));
}

module.exports = {
  buscar,
  buscarPorCodigo,
  sugerencias,
  cargarCatalogo,
  cargarStock,
  cargarPrecios
};
