const fs = require("fs");
const path = require("path");

const MEDIA_DIR = __dirname;
const IMAGENES_DIR = path.join(MEDIA_DIR, "imagenes");
const PDF_DIR = path.join(MEDIA_DIR, "pdf");

// ─── EXTENSIONES ACEPTADAS ────────────────────────────────────────────────────
const EXT_IMAGENES = [".jpg", ".jpeg", ".png", ".webp"];
const EXT_PDF = [".pdf"];

// ─── NORMALIZAR CÓDIGO ────────────────────────────────────────────────────────
// Busca con el código tal cual y también en minúsculas para cubrir ambos casos
function variantes(codigo) {
  const c = codigo.trim();
  return [c, c.toUpperCase(), c.toLowerCase()];
}

// ─── BUSCAR ARCHIVO EN UNA CARPETA ────────────────────────────────────────────
function buscarArchivo(carpeta, codigo, extensiones) {
  if (!fs.existsSync(carpeta)) return null;
  for (const variante of variantes(codigo)) {
    for (const ext of extensiones) {
      const archivo = path.join(carpeta, variante + ext);
      if (fs.existsSync(archivo)) return archivo;
    }
  }
  return null;
}

// ─── OBTENER IMAGEN DE UN PRODUCTO ────────────────────────────────────────────
function obtenerImagen(codigo) {
  return buscarArchivo(IMAGENES_DIR, codigo, EXT_IMAGENES);
}

// ─── OBTENER PDF DE UN PRODUCTO ───────────────────────────────────────────────
function obtenerPDF(codigo) {
  // Primero busca por código exacto, luego por código base
  // Ej: V60UCB → V60UC → V60U
  const codigoUpper = codigo.toUpperCase();
  const candidatos = [codigo];

  // Marbela: EDM60 → VEDM | EDM60N → VEDMN
  if (codigoUpper.startsWith("EDM")) {
    const conN = codigoUpper.includes("N") ? "VEDMN" : "VEDM";
    candidatos.push(conN, "VEDM");
  }

  // Familia V\d+ sin sufijo (ej V150, V120): probar V150U, V150UC
  // El usuario a veces pide "catalogo v150" refiriéndose a la familia.
  if (/^V\d{2,3}$/i.test(codigo)) {
    candidatos.push(codigo + "U", codigo + "UC");
  }

  // Generar códigos base (quitar sufijo B o COLOR)
  const sinB = codigo.replace(/B$/i, "");
  const sinColor = codigo.replace(/COLOR$/i, "");
  const sinSufijo = codigo.replace(/(B|COLOR|UCB|UCCOLOR|UB|UCOLOR)$/i, "");

  [sinB, sinColor, sinSufijo].forEach(c => {
    if (c !== codigo && c.length > 2) candidatos.push(c);
  });

  for (const candidato of candidatos) {
    const encontrado = buscarArchivo(PDF_DIR, candidato, EXT_PDF);
    if (encontrado) return encontrado;
  }

  // Último fallback: cualquier archivo que EMPIECE con el código (tolerante)
  // Ej: "V150" → v150u.pdf (el primero que matchee)
  if (fs.existsSync(PDF_DIR)) {
    const archivos = fs.readdirSync(PDF_DIR);
    const match = archivos.find(a => {
      if (!EXT_PDF.includes(path.extname(a).toLowerCase())) return false;
      const base = path.basename(a, path.extname(a)).toUpperCase();
      return base.startsWith(codigoUpper);
    });
    if (match) return path.join(PDF_DIR, match);
  }

  return null;
}

// ─── OBTENER TODO EL MEDIA DE UN PRODUCTO ────────────────────────────────────
function obtenerMedia(codigo) {
  return {
    codigo,
    imagen: obtenerImagen(codigo),
    pdf: obtenerPDF(codigo)
  };
}

// ─── LISTAR TODO EL MEDIA DISPONIBLE ─────────────────────────────────────────
function listarTodoElMedia() {
  const resultado = { imagenes: [], pdf: [] };

  if (fs.existsSync(IMAGENES_DIR)) {
    fs.readdirSync(IMAGENES_DIR)
      .filter(f => EXT_IMAGENES.includes(path.extname(f).toLowerCase()))
      .forEach(f => resultado.imagenes.push({
        archivo: f,
        codigo: path.basename(f, path.extname(f)).toUpperCase(),
        ruta: path.join(IMAGENES_DIR, f)
      }));
  }

  if (fs.existsSync(PDF_DIR)) {
    fs.readdirSync(PDF_DIR)
      .filter(f => EXT_PDF.includes(path.extname(f).toLowerCase()))
      .forEach(f => resultado.pdf.push({
        archivo: f,
        codigo: path.basename(f, path.extname(f)).toUpperCase(),
        ruta: path.join(PDF_DIR, f)
      }));
  }

  return resultado;
}

// ─── GENERAR ÍNDICE DE MEDIA DISPONIBLE ──────────────────────────────────────
// Útil para que el agente sepa qué puede enviar sin buscar en disco cada vez
function generarIndice() {
  const media = listarTodoElMedia();
  const indice = {};

  media.imagenes.forEach(m => {
    if (!indice[m.codigo]) indice[m.codigo] = {};
    indice[m.codigo].imagen = m.ruta;
  });

  media.pdf.forEach(m => {
    if (!indice[m.codigo]) indice[m.codigo] = {};
    indice[m.codigo].pdf = m.ruta;
  });

  const rutaIndice = path.join(MEDIA_DIR, "indice.json");
  fs.writeFileSync(rutaIndice, JSON.stringify(indice, null, 2), "utf8");
  console.log(`✅ Índice generado: ${Object.keys(indice).length} productos con media`);
  return indice;
}

// ─── RESUMEN DE COBERTURA ─────────────────────────────────────────────────────
function resumenCobertura() {
  const media = listarTodoElMedia();
  console.log(`\n📁 MEDIA DISPONIBLE`);
  console.log(`   Imágenes: ${media.imagenes.length}`);
  media.imagenes.forEach(m => console.log(`     - ${m.archivo}`));
  console.log(`   PDFs: ${media.pdf.length}`);
  media.pdf.forEach(m => console.log(`     - ${m.archivo}`));
}

module.exports = {
  obtenerImagen,
  obtenerPDF,
  obtenerMedia,
  listarTodoElMedia,
  generarIndice,
  resumenCobertura
};
