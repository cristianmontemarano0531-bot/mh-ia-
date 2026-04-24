const buscador = require('./buscador-inteligente.js');
const memoria = require('../memoria-de-clientes/memoria-manager.js');

// ─── ENRIQUECER CONSULTA CON HISTORIAL RECIENTE ────────────────────────────────
// Cuando el cliente manda respuestas cortas como "En 60", "De pie", "Con cajones"
// (conversación en pedacitos), una búsqueda con solo ese texto devuelve nada.
// Concatenamos los últimos mensajes del usuario para armar una consulta rica.
function enriquecerConsulta(consulta, memoriaCliente) {
  const texto = String(consulta || "").trim();
  const palabras = texto.split(/\s+/).filter(Boolean);

  // Si la consulta ya tiene código o ≥5 palabras, no necesita enriquecimiento
  const tieneCodigo = /\b[A-Z]{1,3}\d{2,3}[A-Z]*\b/i.test(texto);
  if (palabras.length >= 5 || tieneCodigo) return texto;

  // Concatenar los últimos 3 mensajes del usuario del historial (el actual aún no está registrado).
  // Filtramos: (a) el mensaje actual, (b) comandos admin (/agregar, /usuarios, etc),
  // (c) respuestas monosílabas a preguntas del bot que no aportan info de producto.
  const historial = memoriaCliente?.historial || [];
  const userMsgs = historial.filter(m => m.rol === "user").map(m => m.texto);
  const SHORT_REPLIES = /^(si|sí|no|ok|dale|gracias|listo|bueno|perfecto)$/i;
  const ultimos3 = userMsgs
    .slice(-3)
    .map(t => t.trim())
    .filter(t => {
      if (!t || t === texto.trim()) return false;
      if (t.startsWith("/")) return false;              // comandos admin
      if (SHORT_REPLIES.test(t)) return false;          // yes/no/ok
      return true;
    });

  const userRecent = ultimos3.join(" ");
  const enriquecida = (userRecent + " " + texto).trim();
  if (enriquecida !== texto) {
    console.log(`🔗 Query enriquecida: "${texto}" → "${enriquecida}"`);
  }
  return enriquecida || texto;
}

// ─── BUSCAR CON CONTEXTO DEL CLIENTE ───────────────────────────────────────────
function buscarConContexto(numero, consulta, opciones = {}) {
  const {
    seccion = null,
    limit = 5,
    perfil = null
  } = opciones;

  // 1. OBTENER MEMORIA DEL CLIENTE
  const mem = memoria.cargarMemoria(numero);

  // 2. SECCIÓN (scope único = baño para externos, flexible para internos)
  let seccion_busqueda = seccion || mem.contexto.ultima_seccion || 'baño';
  if (perfil === 'externo') seccion_busqueda = 'baño';

  // 3. ENRIQUECER consulta con historial reciente (resuelve follow-ups cortos)
  const consultaEnriquecida = enriquecerConsulta(consulta, mem);

  // 4. BUSCAR EN EL CATÁLOGO
  const resultados = buscador.buscar(consultaEnriquecida, seccion_busqueda, limit, mem.contexto);

  // 4. ENRIQUECER CON CONTEXTO
  const respuesta = {
    numero,
    nombre: mem.nombre,
    perfil,
    seccion: seccion_busqueda,
    consulta,
    ...resultados,
    recomendacion: generarRecomendacion(resultados, mem, perfil)
  };

  // 5. ACTUALIZAR MEMORIA (para el próximo chat)
  if (resultados.resultados.length > 0) {
    const producto = resultados.resultados[0];
    memoria.actualizarContexto(numero, {
      seccion: seccion_busqueda,
      producto: producto.codigo,
      color: resultados.colores_detectados[0] || null,
      medida: resultados.medidas_detectadas[0] || null
    });
  }

  return respuesta;
}

// ─── GENERAR RESPUESTA RECOMENDADA SEGÚN PERFIL ────────────────────────────────
function generarRecomendacion(resultados, memoria, perfil) {
  if (resultados.resultados.length === 0) {
    return "No encontré productos que coincidan con tu búsqueda.";
  }

  const top = resultados.resultados[0];
  const stock = top.stock_total;

  let respuesta = "";

  if (perfil === 'interno') {
    // Internos ven stock completo y todas las listas de precios
    respuesta = `${top.codigo} - ${top.nombre}\n`;
    respuesta += `Stock total: ${stock} unidades\n`;
    respuesta += `Lista Madre: $${top.precio_madre}\n`;
    respuesta += `Mayorista 1: $${top.precio_may1}\n`;
    respuesta += `Mayorista 2: $${top.precio_may2}`;

    if (resultados.resultados.length > 1) {
      respuesta += `\n\nOtros coincidentes:`;
      resultados.resultados.slice(1, 3).forEach(p => {
        respuesta += `\n• ${p.codigo} (Stock: ${p.stock_total})`;
      });
    }
  } else if (perfil === 'pdv') {
    // PDV ve precio público y lo pregunta por su precio
    respuesta = `${top.codigo} - ${top.nombre}\n`;
    respuesta += `Stock: ${stock > 0 ? 'disponible' : 'sin stock'}\n`;
    respuesta += `Precio público: $${top.precio_madre}\n\n`;
    respuesta += "¿Querés ver tu precio de compra?";
  } else {
    // Externo ve solo precio público
    respuesta = `${top.codigo} - ${top.nombre}\n`;
    respuesta += `Disponibilidad: ${stock > 0 ? 'en stock' : 'consultar disponibilidad'}\n`;
    respuesta += `Precio: $${top.precio_madre}`;

    if (stock === 0) {
      respuesta += `\n\nEste producto sin stock. Derivo tu consulta al equipo.`;
    }
  }

  return respuesta;
}

// ─── OBTENER DETALLES COMPLETOS DE UN PRODUCTO ─────────────────────────────────
function obtenerDetalles(numero, codigo) {
  const producto = buscador.buscarPorCodigo(codigo);
  const mem = memoria.cargarMemoria(numero);

  if (producto.error) return { error: producto.error };

  return {
    codigo: producto.codigo,
    nombre: producto.nombre,
    categoria: producto.categoria,
    medida: producto.medida,
    colores: producto.colores,
    guardado: producto.guardado,
    linea: producto.linea,
    stock_total: producto.stock_total,
    stock_variantes: producto.stock_variantes,
    precios: {
      madre: producto.precio_madre,
      mayorista1: producto.precio_may1,
      mayorista2: producto.precio_may2
    }
  };
}

module.exports = {
  buscarConContexto,
  obtenerDetalles,
  generarRecomendacion
};
