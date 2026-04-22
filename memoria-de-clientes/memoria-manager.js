const fs = require("fs");
const path = require("path");

const MEMORIA_DIR = __dirname;
const MAX_MENSAJES = 20;      // Últimos 20 mensajes por cliente
const MAX_PRODUCTOS_VISTOS = 10; // Últimos productos consultados

function archivoCliente(numero) {
  const limpio = numero.replace(/[^\d]/g, "");
  return path.join(MEMORIA_DIR, `${limpio}.json`);
}

function ahora() {
  return new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function fechaHoy() {
  return new Date().toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
}

// ─── CARGAR MEMORIA ───────────────────────────────────────────────────────────
function cargarMemoria(numero) {
  const archivo = archivoCliente(numero);
  if (!fs.existsSync(archivo)) {
    return {
      numero: numero.replace(/[^\d]/g, ""),
      nombre: null,
      perfil: null,
      primera_consulta: fechaHoy(),
      ultima_consulta: fechaHoy(),
      total_consultas: 0,
      historial: [],
      contexto: {
        ultima_seccion: "baño",
        ultimo_producto: null,
        productos_vistos: [],
        preferencias_color: [],
        preferencias_medida: []
      }
    };
  }
  try {
    return JSON.parse(fs.readFileSync(archivo, "utf8"));
  } catch {
    return cargarMemoria("_nuevo_");
  }
}

// ─── GUARDAR MEMORIA ──────────────────────────────────────────────────────────
function guardarMemoria(numero, memoria) {
  const archivo = archivoCliente(numero);
  fs.writeFileSync(archivo, JSON.stringify(memoria, null, 2), "utf8");
}

// ─── REGISTRAR MENSAJE ────────────────────────────────────────────────────────
function registrarMensaje(numero, rol, texto) {
  const memoria = cargarMemoria(numero);

  memoria.ultima_consulta = fechaHoy();
  if (rol === "user") memoria.total_consultas++;

  memoria.historial.push({
    ts: ahora(),
    rol,  // "user" | "assistant"
    texto: texto.substring(0, 300)
  });

  // Mantener solo los últimos MAX_MENSAJES
  if (memoria.historial.length > MAX_MENSAJES) {
    memoria.historial = memoria.historial.slice(-MAX_MENSAJES);
  }

  guardarMemoria(numero, memoria);
  return memoria;
}

// ─── ACTUALIZAR NOMBRE ────────────────────────────────────────────────────────
function actualizarNombre(numero, nombre, perfil = null) {
  const memoria = cargarMemoria(numero);
  memoria.nombre = nombre;
  if (perfil) memoria.perfil = perfil;
  guardarMemoria(numero, memoria);
}

// ─── ACTUALIZAR CONTEXTO DE BÚSQUEDA ─────────────────────────────────────────
function actualizarContexto(numero, { seccion, producto, color, medida } = {}) {
  const memoria = cargarMemoria(numero);

  if (seccion) memoria.contexto.ultima_seccion = seccion;

  if (producto) {
    memoria.contexto.ultimo_producto = producto;
    if (!memoria.contexto.productos_vistos.includes(producto)) {
      memoria.contexto.productos_vistos.unshift(producto);
      if (memoria.contexto.productos_vistos.length > MAX_PRODUCTOS_VISTOS) {
        memoria.contexto.productos_vistos = memoria.contexto.productos_vistos.slice(0, MAX_PRODUCTOS_VISTOS);
      }
    }
  }

  if (color && !memoria.contexto.preferencias_color.includes(color)) {
    memoria.contexto.preferencias_color.unshift(color);
    if (memoria.contexto.preferencias_color.length > 3) {
      memoria.contexto.preferencias_color = memoria.contexto.preferencias_color.slice(0, 3);
    }
  }

  if (medida && !memoria.contexto.preferencias_medida.includes(medida)) {
    memoria.contexto.preferencias_medida.unshift(medida);
    if (memoria.contexto.preferencias_medida.length > 3) {
      memoria.contexto.preferencias_medida = memoria.contexto.preferencias_medida.slice(0, 3);
    }
  }

  guardarMemoria(numero, memoria);
  return memoria;
}

// ─── OBTENER HISTORIAL PARA CLAUDE ───────────────────────────────────────────
// Devuelve los mensajes en formato que Claude entiende
function obtenerHistorialClaude(numero) {
  const memoria = cargarMemoria(numero);
  return memoria.historial.map(m => ({
    role: m.rol,
    content: m.texto
  }));
}

// ─── SALUDO PERSONALIZADO ─────────────────────────────────────────────────────
function generarSaludo(numero) {
  const memoria = cargarMemoria(numero);
  const nombre = memoria.nombre;
  const esNuevo = memoria.total_consultas === 0;

  if (esNuevo) {
    return nombre
      ? `¡Hola ${nombre}! 👋 Bienvenido a MH Amoblamientos.`
      : `¡Hola! 👋 Bienvenido a MH Amoblamientos.`;
  }

  const saludos = nombre
    ? [
        `¡Hola ${nombre}! ¿En qué te puedo ayudar hoy?`,
        `¡Buenas ${nombre}! ¿Qué necesitás?`,
        `¡Hola de nuevo ${nombre}! ¿Cómo te puedo ayudar?`
      ]
    : [
        `¡Hola! ¿En qué te puedo ayudar?`,
        `¡Buenas! ¿Qué necesitás?`
      ];

  return saludos[Math.floor(Math.random() * saludos.length)];
}

// ─── RESUMEN DEL CLIENTE (para el prompt de Claude) ──────────────────────────
function resumenCliente(numero) {
  const memoria = cargarMemoria(numero);
  const partes = [];

  if (memoria.nombre) partes.push(`Nombre: ${memoria.nombre}`);
  if (memoria.perfil) partes.push(`Perfil: ${memoria.perfil}`);
  if (memoria.total_consultas > 0) partes.push(`Consultas previas: ${memoria.total_consultas}`);
  if (memoria.contexto.ultimo_producto) partes.push(`Último producto visto: ${memoria.contexto.ultimo_producto}`);
  if (memoria.contexto.preferencias_color.length) partes.push(`Colores de interés: ${memoria.contexto.preferencias_color.join(", ")}`);
  if (memoria.contexto.preferencias_medida.length) partes.push(`Medidas consultadas: ${memoria.contexto.preferencias_medida.join(", ")} cm`);

  return partes.length > 0
    ? `[Contexto del cliente: ${partes.join(" | ")}]`
    : "[Cliente nuevo sin historial]";
}

// ─── LISTAR TODOS LOS CLIENTES ────────────────────────────────────────────────
function listarClientes() {
  const archivos = fs.readdirSync(MEMORIA_DIR).filter(f => f.endsWith(".json"));
  return archivos.map(archivo => {
    const datos = JSON.parse(fs.readFileSync(path.join(MEMORIA_DIR, archivo), "utf8"));
    return {
      numero: datos.numero,
      nombre: datos.nombre || "(sin nombre)",
      perfil: datos.perfil || "desconocido",
      ultima_consulta: datos.ultima_consulta,
      total_consultas: datos.total_consultas
    };
  }).sort((a, b) => b.total_consultas - a.total_consultas);
}

module.exports = {
  cargarMemoria,
  guardarMemoria,
  registrarMensaje,
  actualizarNombre,
  actualizarContexto,
  obtenerHistorialClaude,
  generarSaludo,
  resumenCliente,
  listarClientes
};
