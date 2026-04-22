const buscador = require('./buscador-inteligente.js');
const memoria = require('../memoria-de-clientes/memoria-manager.js');

// ─── BUSCAR CON CONTEXTO DEL CLIENTE ───────────────────────────────────────────
function buscarConContexto(numero, consulta, opciones = {}) {
  const {
    seccion = null,  // null = auto, 'baño', 'cocina', 'placard'
    limit = 5,
    perfil = null    // 'interno', 'pdv', 'externo'
  } = opciones;

  // 1. OBTENER MEMORIA DEL CLIENTE
  const mem = memoria.cargarMemoria(numero);

  // 2. DETERMINAR SECCIÓN (con contexto)
  let seccion_busqueda = seccion;

  // Si es externo, SOLO baño
  if (perfil === 'externo') {
    seccion_busqueda = 'baño';
  }

  // Si consulta menciona "cocina", busca en cocina
  if (!seccion_busqueda) {
    if (consulta.toLowerCase().includes('cocina') || consulta.toLowerCase().includes('alacena')) {
      seccion_busqueda = 'cocina';
    } else if (consulta.toLowerCase().includes('placard') || consulta.toLowerCase().includes('modulo')) {
      seccion_busqueda = 'placard';
    } else {
      // Default: última sección consultada o baño
      seccion_busqueda = mem.contexto.ultima_seccion || 'baño';
    }
  }

  // 3. BUSCAR EN EL CATÁLOGO
  const resultados = buscador.buscar(consulta, seccion_busqueda, limit);

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
