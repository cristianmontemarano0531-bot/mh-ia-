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

  const porRubro = {};

  cat.forEach(p => {
    const info = rubroByCode[p.codigo] || {};
    const rubro = info.rubro || "DESCONOCIDO";
    if (!porRubro[rubro]) {
      porRubro[rubro] = {
        medidas: new Set(),
        colores: new Set(),
        lineas: new Set(),
        subrubros: new Set(),
        codigos: new Set()
      };
    }
    porRubro[rubro].codigos.add(p.codigo);
    if (p.medida) porRubro[rubro].medidas.add(p.medida);
    (p.colores || []).forEach(c => porRubro[rubro].colores.add(String(c).toUpperCase()));
    (p.colores_disponibles || []).forEach(c => porRubro[rubro].colores.add(String(c).toUpperCase()));
    (p.variantes_familia || []).forEach(v =>
      (v.colores || []).forEach(c => porRubro[rubro].colores.add(String(c).toUpperCase()))
    );
    if (p.linea) porRubro[rubro].lineas.add(p.linea);
    if (info.sub_rubro) porRubro[rubro].subrubros.add(info.sub_rubro);
  });

  const salida = {};
  Object.entries(porRubro).forEach(([r, v]) => {
    salida[r] = {
      medidas: [...v.medidas].sort((a, b) => parseInt(a) - parseInt(b)),
      colores: [...v.colores].sort(),
      lineas: [...v.lineas].sort(),
      subrubros: [...v.subrubros].sort(),
      total: v.codigos.size
    };
  });

  _cache = { total: cat.length, porRubro: salida };
  _cacheTs = now;
  return _cache;
}

// Devuelve un string compacto para inyectar en el system prompt
function resumenParaPrompt() {
  const data = cargar();
  if (!data) return "";

  const lineas = [`Total en catálogo: ${data.total} productos (SOLO esto existe — nada más).`];

  Object.entries(data.porRubro).forEach(([rubro, info]) => {
    const parts = [`  • ${rubro} (${info.total} productos)`];
    if (info.subrubros.length) parts.push(`subrubros: ${info.subrubros.join(" / ")}`);
    if (info.medidas.length) parts.push(`medidas: ${info.medidas.join(", ")} cm`);
    if (info.lineas.length) parts.push(`líneas: ${info.lineas.join(", ")}`);
    if (info.colores.length) parts.push(`colores: ${info.colores.join(", ")}`);
    lineas.push(parts.join(" | "));
  });

  return lineas.join("\n");
}

module.exports = { cargar, resumenParaPrompt };
