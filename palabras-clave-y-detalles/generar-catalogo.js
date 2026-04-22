const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../datos-dux");
const CATALOGO_DIR = __dirname;

// ─── MAPEO DE RUBROS A SECCIONES ─────────────────────────────────────────────
const RUBROS_SECCION = {
  "MUEBLES": "baño",
  "BACHAS": "baño",
  "MESADAS": "baño",
  "ESPEJOS Y BOTIQUINES": "baño",
  "BLANCO LINEA": "cocina",
  "UÑERO": "cocina",
  "PLACARD": "placard",
  "PLACARD 90": "placard"
};

// ─── NÚMEROS EN LETRAS ───────────────────────────────────────────────────────
const NUMEROS = {
  "30": ["treinta"],
  "40": ["cuarenta"],
  "45": ["cuarenta y cinco"],
  "50": ["cincuenta"],
  "60": ["sesenta", "seisenta"],
  "70": ["setenta"],
  "80": ["ochenta"],
  "90": ["noventa"],
  "100": ["cien"],
  "110": ["ciento diez"],
  "120": ["ciento veinte", "cien veinte"],
  "140": ["ciento cuarenta"],
  "150": ["ciento cincuenta"],
  "190": ["ciento noventa"]
};

// ─── VARIANTES FONÉTICAS DE COLORES ──────────────────────────────────────────
const COLORES_KEYWORDS = {
  "BLANCO": ["blanco", "blanc", "blanca", "bl", "en blanco", "el blanco"],
  "HORMIGON": ["hormigon", "hormigón", "ormigon", "ormigón", "gris", "gris oscuro", "el gris"],
  "GRAFITO": ["grafito", "gráfito", "grafitto", "oscuro", "el oscuro"],
  "MEZZO": ["mezzo", "mezo", "meso", "messo", "mezó", "el meso", "madera", "marron", "marrón"],
  "CAJU": ["caju", "cajú", "cajou", "kaju", "arena", "beige", "el caju"],
  "SAHARA": ["sahara", "sahará", "saara", "sajara"],
  "TERRA": ["terra", "tierra", "marmol beige", "mármol beige"],
  "NERO": ["nero", "negro", "néro", "marmol negro", "mármol negro", "negro marquina"]
};

// ─── PALABRAS GENERALES POR CATEGORÍA ────────────────────────────────────────
const CATEGORIA_KEYWORDS = {
  "vanitory": ["vanitory", "vanitori", "banitorio", "mueble baño", "mueble de baño"],
  "bacha": ["bacha", "pileta", "lavatorio", "lavamanos", "bacha de apoyo"],
  "mesada": ["mesada", "tapa", "mesada integrada"],
  "espejo": ["espejo", "espejo de baño", "espejo con luz", "espejo led"],
  "anaquel": ["anaquel", "botiquin", "botiquín", "colgante superior", "modulo superior"],
  "alacena": ["alacena", "alacená"],
  "bajo_mesada": ["bajo mesada", "bajomesada", "bajo de", "bajo"],
  "modulo": ["modulo", "módulo", "interior placard", "placard"],
  "frente": ["frente placard", "frente", "puerta placard"],
};

// ─── EXTRAER MEDIDA DEL NOMBRE ────────────────────────────────────────────────
function extraerMedida(nombre) {
  const match = nombre.match(/(\d{2,3})\s*CM/i);
  return match ? match[1] : null;
}

// ─── DETECTAR COLORES EN NOMBRE ───────────────────────────────────────────────
function detectarColores(nombre, codigo) {
  const upper = nombre.toUpperCase() + " " + codigo.toUpperCase();
  const colores = [];
  if (upper.includes("BLANCO") || upper.includes("UCB") || upper.endsWith("B")) {
    if (!upper.includes("NEGRO") && !upper.includes("BODEGA")) colores.push("BLANCO");
  }
  if (upper.includes("COLOR") && !upper.includes("BLANCO")) {
    colores.push("HORMIGON", "GRAFITO", "MEZZO", "CAJU", "SAHARA");
  }
  if (upper.includes("TERRA")) colores.push("TERRA");
  if (upper.includes("NERO") || upper.includes("NEGRO MARQUINA")) colores.push("NERO");
  return [...new Set(colores)];
}

// ─── DETECTAR TIPO DE GUARDADO ────────────────────────────────────────────────
function detectarGuardado(nombre) {
  const upper = nombre.toUpperCase();
  if (upper.includes("CAJON") || upper.includes("CAJONES")) return "cajones";
  if (upper.includes("PUERTA") || upper.includes("PUERTAS")) return "puertas";
  if (upper.includes("REBATIBLE")) return "rebatible";
  if (upper.includes("ESTANTE")) return "estantes";
  return "";
}

// ─── DETECTAR CATEGORÍA ───────────────────────────────────────────────────────
function detectarCategoria(nombre, rubro, codigo) {
  const upper = nombre.toUpperCase();
  const cod = codigo.toUpperCase();

  if (rubro === "BACHAS") return "bacha";
  if (rubro === "ESPEJOS Y BOTIQUINES") return "espejo";

  if (upper.includes("TAPA") || upper.includes("TAPAMARMOL")) return "mesada";
  if (upper.includes("MESADA") || upper.includes("LOZA") || cod.startsWith("DLOZA") || cod.startsWith("M5") || cod === "Z8" || cod.startsWith("MAR")) return "mesada";
  if (upper.includes("ANAQUEL")) return "anaquel";
  if (upper.includes("VANITORY") || cod.startsWith("V") || cod.startsWith("VMINI") || cod.startsWith("EDM") || cod.startsWith("VEDM")) return "vanitory";
  if (upper.includes("ALACENA") || upper.includes("ESCOBERO") || upper.includes("PORTA MICRO") || upper.includes("PORTA MICROONDAS")) return "alacena";
  if (upper.includes("BAJO MESADA")) return "bajo_mesada";
  if (upper.includes("FRENTE PLACARD") || cod.startsWith("FRE")) return "frente";
  if (upper.includes("MODULO") || upper.includes("MÓDULO") || upper.includes("INTERIOR")) return "modulo";
  if (upper.includes("BARRAL") || upper.includes("CUBO") || upper.includes("ESTANTE") || upper.includes("CAJON") || upper.includes("COSTADO")) return "componente_placard";
  return "otro";
}

// ─── DETECTAR LÍNEA ────────────────────────────────────────────────────────────
function detectarLinea(nombre, codigo, rubro) {
  const upper = nombre.toUpperCase() + " " + codigo.toUpperCase();
  if (upper.includes("MARBELA") || codigo.startsWith("EDM") || codigo.startsWith("VEDM") || upper.includes("TAPAMARMOL")) return "marbela";
  if (rubro === "CLASSIC" || upper.includes("CLASSIC") || upper.includes("CLÁSICO")) return "classic";
  if (rubro === "BLANCO LINEA") return "blanco";
  if (rubro === "UÑERO") return "uñero";
  if (rubro === "PLACARD" || rubro === "PLACARD 90") return "placard";
  return "piatto";
}

// ─── ES COMPONENTE ─────────────────────────────────────────────────────────────
function esComponente(nombre, codigo) {
  const upper = nombre.toUpperCase();
  const cod = codigo.toUpperCase();
  if (upper.includes("ES COMPONENTE")) return true;
  if (cod.startsWith("VEDM")) return true;
  if (cod.startsWith("V30") && (cod.includes("UCB") || cod.includes("UCCOLOR"))) return false;
  if (["PA90", "PA90-2", "ES40", "ES40-2", "ES60", "ES60-2", "CA40", "CA60", "BRR1", "BRR2", "BRR3",
       "TCH1","TCH2","TCH3","TCH4","TCH5","TCH6","CUBO40","CUBO60","PLPUERTA","PANEL A","PANEL B",
       "UPANEL A","UPANEL B","UPM","PM"].includes(cod)) return true;
  return false;
}

// ─── GENERAR KEYWORDS ─────────────────────────────────────────────────────────
function generarKeywords(nombre, codigo, categoria, colores, medida, guardado, linea) {
  const kw = new Set();

  // Código siempre es keyword
  kw.add(codigo.toLowerCase());
  // Variantes del código sin sufijos comunes
  kw.add(codigo.toLowerCase().replace("color", "").replace("b", ""));

  // Nombre partido en palabras (sin stopwords)
  const stopwords = new Set(["de", "con", "en", "y", "a", "el", "la", "los", "las", "un", "una", "para", "por", "cm", "al"]);
  nombre.toLowerCase().split(/\s+/).forEach(p => {
    if (p.length > 2 && !stopwords.has(p)) kw.add(p);
  });

  // Medida y sus variantes
  if (medida) {
    kw.add(medida);
    (NUMEROS[medida] || []).forEach(n => kw.add(n));
    kw.add(`el de ${medida}`);
    kw.add(`de ${medida}`);
  }

  // Guardado
  if (guardado === "cajones") { kw.add("cajones"); kw.add("cajonera"); kw.add("cajon"); }
  if (guardado === "puertas") { kw.add("puertas"); kw.add("puerta"); }
  if (guardado === "rebatible") { kw.add("rebatible"); kw.add("rebatibles"); }

  // Colores y sus variantes fonéticas
  colores.forEach(color => {
    (COLORES_KEYWORDS[color] || [color.toLowerCase()]).forEach(v => kw.add(v));
  });

  // Keywords de categoría
  (CATEGORIA_KEYWORDS[categoria] || []).forEach(k => kw.add(k));

  // Línea
  if (linea === "marbela") { kw.add("marbela"); kw.add("marmol"); kw.add("mármol"); kw.add("acrilico"); }
  if (linea === "piatto") { kw.add("piatto"); kw.add("piato"); }
  if (linea === "classic") { kw.add("classic"); kw.add("clasico"); kw.add("clásico"); kw.add("de pie"); }

  return [...kw].filter(k => k.length > 1).sort();
}

// ─── GENERAR CATÁLOGO ─────────────────────────────────────────────────────────
function generarCatalogo() {
  console.log("🗂️  Generando catálogo de búsqueda...");

  const productos = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "productos.json")));
  const stock = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "stock.json")));
  const precios = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "precios.json")));

  const catalogo = { baño: [], cocina: [], placard: [] };
  let total = 0;

  productos.forEach(p => {
    const seccion = RUBROS_SECCION[p.rubro];
    if (!seccion) return; // Ignorar materia prima, ajustables, etc.

    const medida = extraerMedida(p.nombre);
    const colores = detectarColores(p.nombre, p.codigo);
    const guardado = detectarGuardado(p.nombre);
    const categoria = detectarCategoria(p.nombre, p.rubro, p.codigo);
    const linea = detectarLinea(p.nombre, p.codigo, p.rubro);
    const componente = esComponente(p.nombre, p.codigo);
    const keywords = generarKeywords(p.nombre, p.codigo, categoria, colores, medida, guardado, linea);

    const stockInfo = stock[p.codigo] || { stockTotal: 0, variantes: {} };
    const precioMadre = precios["57669"]?.items[p.codigo]?.precio || 0;
    const precioMay1 = precios["58940"]?.items[p.codigo]?.precio || 0;
    const precioMay2 = precios["59895"]?.items[p.codigo]?.precio || 0;

    const item = {
      codigo: p.codigo,
      nombre: p.nombre,
      seccion,
      categoria,
      linea,
      medida: medida || "",
      guardado,
      colores,
      es_componente: componente,
      keywords,
      stock: stockInfo.stockTotal,
      stock_variantes: stockInfo.variantes,
      precios: {
        madre: precioMadre,
        mayorista1: precioMay1,
        mayorista2: precioMay2
      }
    };

    catalogo[seccion].push(item);
    total++;
  });

  // Ordenar cada sección: primero no-componentes, luego por categoría
  Object.keys(catalogo).forEach(seccion => {
    catalogo[seccion].sort((a, b) => {
      if (a.es_componente !== b.es_componente) return a.es_componente ? 1 : -1;
      return a.categoria.localeCompare(b.categoria) || a.codigo.localeCompare(b.codigo);
    });
  });

  // Guardar catálogo completo
  fs.writeFileSync(
    path.join(CATALOGO_DIR, "catalogo.json"),
    JSON.stringify(catalogo, null, 2),
    "utf8"
  );

  // Guardar secciones separadas
  Object.entries(catalogo).forEach(([seccion, items]) => {
    fs.writeFileSync(
      path.join(CATALOGO_DIR, `${seccion}.json`),
      JSON.stringify(items, null, 2),
      "utf8"
    );
    const kb = (fs.statSync(path.join(CATALOGO_DIR, `${seccion}.json`)).size / 1024).toFixed(1);
    console.log(`  ✅ catalogo/${seccion}.json → ${items.length} productos (${kb} KB)`);
  });

  const totalKb = (fs.statSync(path.join(CATALOGO_DIR, "catalogo.json")).size / 1024).toFixed(1);
  console.log(`\n✅ catalogo/catalogo.json → ${total} productos totales (${totalKb} KB)`);
  console.log(`   Baño: ${catalogo.baño.length} | Cocina: ${catalogo.cocina.length} | Placard: ${catalogo.placard.length}`);
}

generarCatalogo();
