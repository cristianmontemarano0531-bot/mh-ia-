const fs = require("fs");
const path = require("path");

// FUENTE DE VERDAD: solo 89 productos de baño (curados desde Dux)
const RUBROS_FILE = path.join(__dirname, "../datos-dux/rubros-bano.json");

// Rubros de baño que vendemos por WhatsApp
const RUBROS_VISIBLES = ["MUEBLES", "BACHAS", "MESADAS", "ESPEJOS Y BOTIQUINES"];

// Todo mapea a sección "baño" (scope único del bot)
const RUBRO_A_SECCION = {
  "MUEBLES": "baño",
  "BACHAS": "baño",
  "MESADAS": "baño",
  "ESPEJOS Y BOTIQUINES": "baño"
};

// Aliases para reconocer rubros desde texto natural. Orden: más específico primero.
const ALIASES_RUBRO = [
  ["espejos y botiquines", "ESPEJOS Y BOTIQUINES"],
  ["espejos", "ESPEJOS Y BOTIQUINES"],
  ["espejo", "ESPEJOS Y BOTIQUINES"],
  ["botiquines", "ESPEJOS Y BOTIQUINES"],
  ["botiquin", "ESPEJOS Y BOTIQUINES"],
  ["bachas", "BACHAS"],
  ["bacha", "BACHAS"],
  ["piletas", "BACHAS"],
  ["pileta", "BACHAS"],
  ["mesadas", "MESADAS"],
  ["mesada", "MESADAS"],
  ["vanitorios", "MUEBLES"],
  ["vanitorys", "MUEBLES"],
  ["vanitoris", "MUEBLES"],
  ["vanitory", "MUEBLES"],
  ["vanitorio", "MUEBLES"],
  ["muebles de bano", "MUEBLES"],
  ["mueble de bano", "MUEBLES"],
  ["muebles", "MUEBLES"],
  ["mueble", "MUEBLES"]
];

// Rubros FUERA DE SCOPE (cocina, placard, etc.) — el bot redirige
const ALIASES_FUERA_SCOPE = [
  "placard", "placards",
  "cocina", "cocinas", "alacena", "alacenas",
  "bajo mesada cocina", "modulo cocina",
  "classic",
  "blanco linea",
  "unero", "uñero",
  "sanitario", "sanitarios", "inodoro", "bidet", "bidé", "mochila"
];

function cargarArbol() {
  if (!fs.existsSync(RUBROS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(RUBROS_FILE, "utf8"));
  } catch { return {}; }
}

function normalizar(texto) {
  return texto.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Detectar si la consulta es sobre un rubro específico de baño
function detectarRubro(consulta) {
  const q = normalizar(consulta);
  for (const [alias, rubro] of ALIASES_RUBRO) {
    const regex = new RegExp(`\\b${alias.replace(/\s/g, "\\s+")}\\b`);
    if (regex.test(q)) return rubro;
  }
  return null;
}

// Detectar si la consulta pide algo fuera de nuestro scope (cocina/placard/etc.)
function detectarFueraDeScope(consulta) {
  const q = normalizar(consulta);
  for (const alias of ALIASES_FUERA_SCOPE) {
    const regex = new RegExp(`\\b${alias.replace(/\s/g, "\\s+")}\\b`);
    if (regex.test(q)) return alias;
  }
  return null;
}

// Obtener subrubros de un rubro
function obtenerSubrubros(rubro) {
  const arbol = cargarArbol();
  return arbol[rubro]?.subrubros || [];
}

// Obtener códigos de productos de un rubro (+ subrubro opcional)
function obtenerProductos(rubro, subrubro = null) {
  const arbol = cargarArbol();
  const data = arbol[rubro];
  if (!data) return [];
  if (!subrubro) return data.productos;
  const sr = data.subrubros.find(s => s.nombre.toLowerCase() === subrubro.toLowerCase());
  return sr ? sr.codigos : data.productos;
}

// Detectar si el texto es una respuesta a subrubro ofrecido
function detectarEleccionSubrubro(texto, opcionesDisponibles) {
  const q = normalizar(texto);
  for (const op of opcionesDisponibles) {
    const opNorm = normalizar(op);
    if (q.includes(opNorm) || opNorm.includes(q)) return op;
  }
  return null;
}

module.exports = {
  detectarRubro,
  detectarFueraDeScope,
  obtenerSubrubros,
  obtenerProductos,
  detectarEleccionSubrubro,
  RUBRO_A_SECCION,
  RUBROS_VISIBLES
};
