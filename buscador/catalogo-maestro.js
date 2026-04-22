const fs = require("fs");
const path = require("path");

const BANO_FILE = path.join(__dirname, "../palabras-clave-y-detalles/baño.json");
const PBANO_FILE = path.join(__dirname, "../datos-dux/productos-bano.json");

let _cache = null;
let _cacheTs = 0;
const TTL = 60 * 1000; // 60s

function cargar() {
  const now = Date.now();
  if (_cache && (now - _cacheTs) < TTL) return _cache;

  if (!fs.existsSync(BANO_FILE) || !fs.existsSync(PBANO_FILE)) return null;

  const cat = JSON.parse(fs.readFileSync(BANO_FILE, "utf8"));
  const pbano = JSON.parse(fs.readFileSync(PBANO_FILE, "utf8"));

  const rubroByCode = {};
  pbano.forEach(p => {
    rubroByCode[p.codigo] = { rubro: p.rubro, sub_rubro: p.sub_rubro };
  });

  // Agrupar por rubro + subrubro (los colores y medidas varían según subrubro/línea)
  const porRubro = {};

  cat.forEach(p => {
    const info = rubroByCode[p.codigo] || {};
    const rubro = info.rubro || "DESCONOCIDO";
    const subrubro = info.sub_rubro || "(sin subrubro)";

    if (!porRubro[rubro]) porRubro[rubro] = { total: 0, subrubros: {} };
    if (!porRubro[rubro].subrubros[subrubro]) {
      porRubro[rubro].subrubros[subrubro] = {
        medidas: new Set(),
        colores: new Set(),
        codigos: new Set()
      };
    }
    const bucket = porRubro[rubro].subrubros[subrubro];
    bucket.codigos.add(p.codigo);
    if (p.medida) bucket.medidas.add(p.medida);
    (p.colores || []).forEach(c => bucket.colores.add(String(c).toUpperCase()));
    (p.colores_disponibles || []).forEach(c => bucket.colores.add(String(c).toUpperCase()));
    (p.variantes_familia || []).forEach(v =>
      (v.colores || []).forEach(c => bucket.colores.add(String(c).toUpperCase()))
    );
  });

  const salida = {};
  Object.entries(porRubro).forEach(([r, v]) => {
    const subrubrosSalida = {};
    let total = 0;
    Object.entries(v.subrubros).forEach(([sr, info]) => {
      subrubrosSalida[sr] = {
        total: info.codigos.size,
        medidas: [...info.medidas].sort((a, b) => parseInt(a) - parseInt(b)),
        colores: [...info.colores].sort()
      };
      total += info.codigos.size;
    });
    salida[r] = { total, subrubros: subrubrosSalida };
  });

  _cache = { total: cat.length, porRubro: salida };
  _cacheTs = now;
  return _cache;
}

// Devuelve un string compacto para inyectar en el system prompt.
// Desglose rubro → subrubro → medidas/colores (los colores varían según subrubro/línea).
function resumenParaPrompt() {
  const data = cargar();
  if (!data) return "";

  const lineas = [`Total en catálogo: ${data.total} productos (SOLO esto existe — nada más).`];

  Object.entries(data.porRubro).forEach(([rubro, info]) => {
    lineas.push(`\n• ${rubro} (${info.total} productos):`);
    Object.entries(info.subrubros).forEach(([sr, sub]) => {
      const parts = [`    ▸ ${sr} (${sub.total})`];
      if (sub.medidas.length) parts.push(`medidas: ${sub.medidas.join(", ")} cm`);
      if (sub.colores.length) parts.push(`colores: ${sub.colores.join(", ")}`);
      lineas.push(parts.join(" | "));
    });
  });

  return lineas.join("\n");
}

module.exports = { cargar, resumenParaPrompt };
