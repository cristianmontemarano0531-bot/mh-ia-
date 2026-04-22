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
    .replace(/[-]/g, " ")   // guión → espacio (para transcripciones de audio como "B-Mini")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── LEVENSHTEIN (para typos) ─────────────────────────────────────────────────
function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0).map((_, j) => j === 0 ? i : 0));
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// ─── DETECTAR CONSULTA GENÉRICA ───────────────────────────────────────────────
function esConsultaGenerica(consulta) {
  const q = normalizar(consulta);
  const patrones = ["que tienen", "que hay", "que modelos", "cuales tienen", "que productos", "que venden",
    "tienen vanitor", "me mostras", "me muestras", "que me ofrecen", "que tienen de",
    "vanitorios tienen", "espejos tienen", "bachas tienen", "mesadas tienen",
    "tienen de vanitor", "tienen de espejo", "tienen de bacha", "que lineas", "que marcas"
  ];
  return patrones.some(p => q.includes(p));
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
    "hormigon|hormigón|ormigon|gris|oscuro|home|orme|ormi|hormigo": "HORMIGON",
    "grafito|gráfito|grafico|grafitti": "GRAFITO",
    "mezzo|mezo|meso|madera|marron|marrón|meso color": "MEZZO",
    "caju|cajú|cajou|arena|beige|kaju|cahu": "CAJU",
    "sahara|sahará|sahara color|zahara": "SAHARA",
    "terra|tierra|beige marmol": "TERRA",
    "nero|negro|marquina|neto": "NERO"
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
function calcularScore(producto, consulta, medidas, colores, contextoCliente) {
  const q = normalizar(consulta);
  const palabras = q.split(/\s+/).filter(p => p.length > 1);
  let score = 0;

  // 1. KEYWORDS DEL CATÁLOGO
  const keywords = (producto.keywords || []).map(normalizar);
  const todosKeywords = [
    ...keywords,
    ...(producto.tags || "").split(",").map(t => normalizar(t.trim())),
    normalizar(producto.nombre || ""),
    normalizar(producto.categoria || ""),
    normalizar(producto.linea || "")
  ];

  palabras.forEach(palabra => {
    if (todosKeywords.includes(palabra)) {
      score += 15;
    } else {
      todosKeywords.forEach(kw => {
        if (kw.includes(palabra) && palabra.length > 2) score += 5;
        if (palabra.includes(kw) && kw.length > 3) score += 3;
        // Levenshtein para typos (solo palabras largas)
        if (palabra.length >= 5 && kw.length >= 5 && levenshtein(palabra, kw) === 1) score += 8;
      });
    }
  });

  // 2. CÓDIGO EXACTO O PARCIAL
  const codNorm = normalizar(producto.codigo);
  if (codNorm === q) {
    score += 100;
  } else if (palabras.some(p => p.length >= 4 && codNorm === p)) {
    score += 80; // código exacto como parte de la query
  } else if (palabras.some(p => p.length >= 4 && codNorm.startsWith(p))) {
    score += 40;
  } else if (palabras.some(p => codNorm.includes(p) && p.length >= 3)) {
    score += 20;
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
    if (productosColores.includes(normalizar(color))) score += 20;
  });

  // 5. BONUS POR CATEGORÍA EXPLÍCITA
  if (q.includes("cajones") && producto.guardado === "cajones") score += 15;
  if (q.includes("puertas") && producto.guardado === "puertas") score += 15;
  if ((q.includes("bacha") || q.includes("bachas") || q.includes("pileta")) && producto.categoria === "bacha") score += 20;
  if ((q.includes("mesada") || q.includes("mesadas")) && producto.categoria === "mesada") score += 20;
  if ((q.includes("espejo") || q.includes("espejos")) && producto.categoria === "espejo") score += 20;
  // Líneas de producto
  if ((q.includes("marbela") || q.includes("marmol")) && producto.linea === "marbela") score += 25;
  if (q.includes("classic") && producto.linea === "classic") score += 25;
  if ((q.includes("piatto") || q.includes("estandar") || q.includes("estándar")) && producto.linea === "piatto") score += 25;
  // Categorías vanitory
  if ((q.includes("vanitor") || q.includes("banitorio") || q.includes("mueble")) && producto.categoria === "vanitory") score += 15;
  // Categorías placard
  if ((q.includes("placard") || q.includes("modulo") || q.includes("módulo")) && (producto.keywords || []).includes("placard")) score += 20;
  if (q.includes("frente") && producto.categoria === "frente") score += 25;
  if ((q.includes("modulo") || q.includes("módulo")) && producto.categoria === "modulo") score += 25;
  if (q.includes("componente") && producto.categoria === "componente_placard") score += 25;
  // Categorías cocina
  if ((q.includes("cocina") || q.includes("alacena")) && (producto.keywords || []).includes("cocina")) score += 20;

  // 6. BOOST POR HISTORIAL DEL CLIENTE (reforma 7)
  if (contextoCliente) {
    const prefsColor = (contextoCliente.preferencias_color || []).map(c => normalizar(c));
    const prefsMedida = contextoCliente.preferencias_medida || [];

    productosColores.forEach(c => {
      if (prefsColor.includes(c)) score += 10;
    });
    if (producto.medida && prefsMedida.includes(producto.medida)) score += 10;
  }

  return score;
}

// ─── BUSCAR PRODUCTOS ─────────────────────────────────────────────────────────
function buscar(consulta, seccion = "baño", limit = 5, contextoCliente = null) {
  const catalogo = cargarCatalogo(seccion);
  const stock = cargarStock();
  const precios = cargarPrecios();

  if (catalogo.length === 0) {
    return {
      error: `No hay productos en la sección '${seccion}'`,
      resultados: [],
      consulta_generica: false
    };
  }

  // Detectar consulta genérica (reforma 4)
  if (esConsultaGenerica(consulta)) {
    return {
      consulta,
      seccion,
      consulta_generica: true,
      medidas_detectadas: [],
      colores_detectados: [],
      resultados: [],
      confianza: "generica"
    };
  }

  const medidas = extraerMedidas(consulta);
  const colores = extraerColores(consulta);

  // Calcular scores
  const resultados = catalogo
    .map(prod => ({
      ...prod,
      score: calcularScore(prod, consulta, medidas, colores, contextoCliente),
      stock_info: stock[prod.codigo] || { stockTotal: 0, variantes: {} },
      precio_madre: precios["57669"]?.items[prod.codigo]?.precio || 0,
      precio_may1: precios["58940"]?.items[prod.codigo]?.precio || 0,
      precio_may2: precios["59895"]?.items[prod.codigo]?.precio || 0
    }))
    .filter(p => p.score >= 20)  // Reforma 2: umbral mínimo 20
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
      guardado: r.guardado,
      familia: r.familia || "",
      tipo_familia: r.tipo_familia || "",
      variantes_familia: r.variantes_familia || [],
      variantes_familia_medida: r.variantes_familia_medida || [],
      colores_disponibles: r.colores_disponibles || [],
      relacionados: r.relacionados || [],
      frase: r.frase || ""
    })),
    confianza: resultados.length > 0 ? (resultados[0].score >= 60 ? "alta" : resultados[0].score >= 30 ? "media" : "baja") : "baja",
    consulta_generica: false,
    pedir_mas_detalle: resultados.length === 0 || (resultados.length > 0 && resultados[0].score < 30)
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
    familia: producto.familia || "",
    variantes_familia: producto.variantes_familia || [],
    colores_disponibles: producto.colores_disponibles || [],
    relacionados: producto.relacionados || [],
    frase: producto.frase || "",
    desc_larga: producto.desc_larga || "",
    descripcion: producto.nombre
  };
}

// ─── LISTAR PRODUCTOS POR CÓDIGOS (navegación rubro/subrubro) ────────────────
function listarPorCodigos(codigos, seccion = "baño") {
  const catalogo = cargarCatalogo(seccion);
  const stock = cargarStock();
  const precios = cargarPrecios();

  const codigosSet = new Set((codigos || []).map(c => String(c).toUpperCase()));

  return catalogo
    .filter(p => codigosSet.has(String(p.codigo).toUpperCase()))
    .map(p => ({
      codigo: p.codigo,
      nombre: p.nombre,
      categoria: p.categoria,
      medida: p.medida,
      colores: p.colores || [],
      linea: p.linea,
      guardado: p.guardado,
      familia: p.familia || "",
      variantes_familia: p.variantes_familia || [],
      stock_total: (stock[p.codigo] || { stockTotal: 0 }).stockTotal,
      stock_variantes: (stock[p.codigo] || { variantes: {} }).variantes,
      precio_madre: precios["57669"]?.items[p.codigo]?.precio || 0,
      precio_may1: precios["58940"]?.items[p.codigo]?.precio || 0,
      precio_may2: precios["59895"]?.items[p.codigo]?.precio || 0
    }));
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
  listarPorCodigos,
  cargarCatalogo,
  cargarStock,
  cargarPrecios
};
