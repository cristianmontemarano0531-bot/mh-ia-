const fs = require("fs");
const path = require("path");

const RUBROS_FILE = path.join(__dirname, "../datos-dux/rubros.json");

// Rubros relevantes para el bot (excluir materia prima, electro, etc.)
const RUBROS_VISIBLES = [
  "BACHAS", "BLANCO LINEA", "CLASSIC", "ESPEJOS Y BOTIQUINES",
  "MESADAS", "MUEBLES", "PLACARD", "PLACARD 90", "UÑERO", "SANITARIOS"
];

// Mapeo rubro Dux → sección del catálogo
const RUBRO_A_SECCION = {
  "BACHAS": "baño",
  "BLANCO LINEA": "cocina",
  "CLASSIC": "cocina",
  "ESPEJOS Y BOTIQUINES": "baño",
  "MESADAS": "baño",
  "MUEBLES": "baño",
  "PLACARD": "placard",
  "PLACARD 90": "placard",
  "UÑERO": "baño",
  "SANITARIOS": "baño"
};

// Aliases para reconocer rubros desde texto natural
const ALIASES_RUBRO = {
  "bacha": "BACHAS", "bachas": "BACHAS", "pileta": "BACHAS",
  "espejo": "ESPEJOS Y BOTIQUINES", "espejos": "ESPEJOS Y BOTIQUINES", "botiquin": "ESPEJOS Y BOTIQUINES",
  "mesada": "MESADAS", "mesadas": "MESADAS",
  "mueble": "MUEBLES", "muebles": "MUEBLES", "vanitory": "MUEBLES", "vanitorios": "MUEBLES",
  "placard": "PLACARD", "placards": "PLACARD",
  "blanco linea": "BLANCO LINEA", "blanco": "BLANCO LINEA",
  "classic": "CLASSIC",
  "unero": "UÑERO", "uñero": "UÑERO"
};

function cargarArbol() {
  if (!fs.existsSync(RUBROS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(RUBROS_FILE, "utf8"));
  } catch { return {}; }
}

// Detectar si la consulta es sobre un rubro específico (sin subrubro ni producto)
function detectarRubro(consulta) {
  const q = consulta.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  for (const [alias, rubro] of Object.entries(ALIASES_RUBRO)) {
    const regex = new RegExp(`\\b${alias}\\b`);
    if (regex.test(q)) return rubro;
  }
  return null;
}

// Obtener subrubros de un rubro
function obtenerSubrubros(rubro) {
  const arbol = cargarArbol();
  return arbol[rubro]?.subrubros || [];
}

// Obtener productos de un rubro + subrubro opcional
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
  const q = texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  for (const op of opcionesDisponibles) {
    const opNorm = op.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (q.includes(opNorm) || opNorm.includes(q)) return op;
  }
  return null;
}

// Generar mensaje de selección de subrubro
function mensajeSeleccionSubrubro(rubro, subrubros) {
  if (!subrubros.length) return null;
  const ops = subrubros.map(s => `*${s.nombre}*`).join(" / ");
  return `📂 *${rubro}* — ¿Qué tipo?\n${ops}`;
}

module.exports = {
  detectarRubro,
  obtenerSubrubros,
  obtenerProductos,
  detectarEleccionSubrubro,
  mensajeSeleccionSubrubro,
  RUBRO_A_SECCION
};
