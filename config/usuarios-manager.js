// Maneja usuarios internos del bot.
// Combina USUARIOS_FIJOS (hardcoded en el código) con usuarios-extras.json
// (agregados en runtime por el admin vía comando /agregar).
//
// Importante: Railway tiene filesystem efímero. Los extras sobreviven reinicios
// del mismo deploy, pero se pierden en el próximo git push. Para usuarios
// permanentes, editar USUARIOS_FIJOS acá abajo.

const fs = require("fs");
const path = require("path");

const EXTRAS_PATH = path.join(__dirname, "usuarios-extras.json");

// Hardcoded — los 3 del equipo permanente
const USUARIOS_FIJOS = {
  "5491149460531": { nombre: "Cristian", perfil: "interno", admin: true },
  "5491165005095": { nombre: "MH Fábrica", perfil: "interno" },
  "5491139042568": { nombre: "Vendedor 1", perfil: "interno" }
};

// El admin es el único que puede agregar/quitar usuarios por WhatsApp
const ADMIN_NUMERO = "5491149460531";

function normalizarNumero(numero) {
  return String(numero || "").replace(/\D/g, "");
}

function cargarExtras() {
  try {
    if (!fs.existsSync(EXTRAS_PATH)) return {};
    return JSON.parse(fs.readFileSync(EXTRAS_PATH, "utf8")) || {};
  } catch (e) {
    console.error("Error leyendo usuarios-extras.json:", e.message);
    return {};
  }
}

function guardarExtras(extras) {
  try {
    fs.writeFileSync(EXTRAS_PATH, JSON.stringify(extras, null, 2), "utf8");
    return true;
  } catch (e) {
    console.error("Error escribiendo usuarios-extras.json:", e.message);
    return false;
  }
}

function esInterno(numero) {
  const n = normalizarNumero(numero);
  if (USUARIOS_FIJOS[n]) return true;
  const extras = cargarExtras();
  return !!extras[n];
}

function esAdmin(numero) {
  return normalizarNumero(numero) === ADMIN_NUMERO;
}

function obtenerUsuario(numero) {
  const n = normalizarNumero(numero);
  if (USUARIOS_FIJOS[n]) return { ...USUARIOS_FIJOS[n], numero: n, tipo: "fijo" };
  const extras = cargarExtras();
  if (extras[n]) return { ...extras[n], numero: n, tipo: "extra" };
  return null;
}

function agregarUsuario(numero, nombre) {
  const n = normalizarNumero(numero);
  if (!n || n.length < 8) return { ok: false, error: "Número inválido" };
  if (USUARIOS_FIJOS[n]) return { ok: false, error: `${n} ya es usuario fijo` };
  const extras = cargarExtras();
  extras[n] = { nombre: nombre || "(sin nombre)", perfil: "interno", agregado: new Date().toISOString() };
  if (!guardarExtras(extras)) return { ok: false, error: "No se pudo guardar" };
  return { ok: true, usuario: extras[n] };
}

function quitarUsuario(numero) {
  const n = normalizarNumero(numero);
  if (USUARIOS_FIJOS[n]) return { ok: false, error: `${n} es usuario fijo (editá el código para quitarlo)` };
  const extras = cargarExtras();
  if (!extras[n]) return { ok: false, error: "No está en la lista de extras" };
  delete extras[n];
  if (!guardarExtras(extras)) return { ok: false, error: "No se pudo guardar" };
  return { ok: true };
}

function listarUsuarios() {
  const extras = cargarExtras();
  const fijos = Object.entries(USUARIOS_FIJOS).map(([num, u]) => ({
    numero: num,
    nombre: u.nombre,
    tipo: "fijo",
    admin: !!u.admin
  }));
  const extra = Object.entries(extras).map(([num, u]) => ({
    numero: num,
    nombre: u.nombre,
    tipo: "extra"
  }));
  return { fijos, extras: extra };
}

module.exports = {
  ADMIN_NUMERO,
  esInterno,
  esAdmin,
  obtenerUsuario,
  agregarUsuario,
  quitarUsuario,
  listarUsuarios,
  normalizarNumero
};
