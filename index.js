require("dotenv").config({ path: "./config/.env.local" });
const express = require("express");
const cron = require("node-cron");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

// ─── CREAR CARPETAS SI NO EXISTEN ─────────────────────────────────────────────
["datos-dux", "memoria-de-clientes", "registros"].forEach(dir => {
  if (!fs.existsSync(path.join(__dirname, dir))) {
    fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
  }
});

const buscadorCtx = require("./buscador/buscador-con-contexto.js");
const memoria = require("./memoria-de-clientes/memoria-manager.js");
const mediaManager = require("./imagenes-y-pdf-para-clientes/media-manager.js");
const { verificarCuitEnDux } = require("./sincronizacion-automatica/verificar-cuit-dux.js");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Servir media como archivos estáticos (para Twilio MMS)
app.use("/media", express.static(path.join(__dirname, "imagenes-y-pdf-para-clientes")));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BASE_URL || "";
const PORT = process.env.PORT || 3000;

// ─── PERFILES INTERNOS ────────────────────────────────────────────────────────
const USUARIOS_INTERNOS = {
  "5491149460531": { nombre: "Cristian", perfil: "interno" },
  "5491165005095": { nombre: "MH Fábrica", perfil: "interno" },
  "5491139042568": { nombre: "Vendedor 1", perfil: "interno" }
};

// Número principal que recibe alertas de nuevos clientes
const ADMIN_NUMERO = "5491149460531";

// ─── IDENTIFICAR PERFIL ───────────────────────────────────────────────────────
async function obtenerPerfil(numero) {
  const limpio = numero.replace(/\D/g, "");
  if (USUARIOS_INTERNOS[limpio]) {
    const u = USUARIOS_INTERNOS[limpio];
    memoria.actualizarNombre(limpio, u.nombre, "interno");
    return { ...u, numero: limpio };
  }
  const mem = memoria.cargarMemoria(limpio);
  if (mem.nombre && mem.perfil === "pdv") {
    return { nombre: mem.nombre, perfil: "pdv", numero: limpio };
  }
  return { nombre: mem.nombre || null, perfil: "externo", numero: limpio };
}

// ─── TRANSCRIBIR AUDIO ────────────────────────────────────────────────────────
async function transcribirAudio(mediaUrl) {
  if (!OPENAI_API_KEY || !mediaUrl) return null;
  try {
    const audioRes = await fetch(mediaUrl, {
      headers: { "Authorization": "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64") }
    });
    if (!audioRes.ok) return null;
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());
    const boundary = "----FormBoundary" + Date.now();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`),
      audioBuffer,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nes\r\n--${boundary}--`)
    ]);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body
    });
    const data = await res.json();
    return data.text || null;
  } catch (e) {
    console.error("Error Whisper:", e.message);
    return null;
  }
}

// ─── ENVIAR MENSAJE WHATSAPP ──────────────────────────────────────────────────
async function enviarMensaje(numero, texto) {
  try {
    const params = new URLSearchParams({
      To: `whatsapp:+${numero}`,
      From: "whatsapp:+14155238886",
      Body: texto
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      }
    );
    return res.ok;
  } catch (e) {
    console.error("Error enviando mensaje:", e.message);
    return false;
  }
}

// ─── ENVIAR MEDIA (PDF o IMAGEN) POR TWILIO MMS ──────────────────────────────
async function enviarMedia(numero, mediaPath, caption = "") {
  if (!mediaPath || !BASE_URL) {
    console.log("⚠️ No se puede enviar media: sin BASE_URL o archivo no encontrado");
    return false;
  }
  try {
    // Construir URL pública relativa al servidor
    const rel = path.relative(
      path.join(__dirname, "imagenes-y-pdf-para-clientes"),
      mediaPath
    ).replace(/\\/g, "/");
    const mediaUrl = `${BASE_URL}/media/${rel}`;

    const params = new URLSearchParams({
      To: `whatsapp:+${numero}`,
      From: "whatsapp:+14155238886",
      Body: caption,
      MediaUrl0: mediaUrl
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: params
      }
    );
    if (res.ok) console.log(`📎 Media enviada: ${mediaUrl}`);
    return res.ok;
  } catch (e) {
    console.error("Error enviando media:", e.message);
    return false;
  }
}

// ─── ALERTAR EQUIPO INTERNO ───────────────────────────────────────────────────
async function alertarEquipo(numero, nombre, mensaje) {
  const nombreMostrar = nombre || `+${numero}`;
  const alerta = `⚠️ *Consulta externa*\n📱 +${numero}\n👤 ${nombreMostrar}\n💬 ${mensaje.substring(0, 120)}`;
  for (const interno of Object.keys(USUARIOS_INTERNOS)) {
    await enviarMensaje(interno, alerta);
  }
}

// ─── LLAMAR A CLAUDE ──────────────────────────────────────────────────────────
async function llamarClaude(mensajes, systemPrompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: systemPrompt,
      messages: mensajes
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "Lo siento, hubo un error. Intentá de nuevo.";
}

// ─── DETECTAR PEDIDO DE MEDIA ─────────────────────────────────────────────────
function detectarPedidoMedia(texto) {
  const q = texto.toLowerCase();
  const esPDF = /\bpdf\b|\bficha\b|\bfichat[eé]cnica\b|\bficha tecnica\b/.test(q);
  const esImagen = /\bimagen\b|\bfoto\b|\bfotograf[ií]a\b|\bjpg\b|\bpng\b|\bver\b.*\bproducto\b/.test(q);
  return { esPDF, esImagen, esMedia: esPDF || esImagen };
}

// ─── DETECTAR PEDIDO DE STOCK (palabras clave de disponibilidad) ──────────────
function consultaStock(texto) {
  const q = texto.toLowerCase();
  return /\bstock\b|\bdisponib|\bcuant[ao]s?\b|\bhay\b.*\bdisponib|\bqueda\b|\bquedan\b|\bhay\b/.test(q);
}

// ─── OBTENER PRECIO SEGÚN LISTA ASIGNADA ─────────────────────────────────────
function precioSegunLista(producto, lista) {
  switch (lista) {
    case "may1": return producto.precio_may1;
    case "may2": return producto.precio_may2;
    default:     return producto.precio_madre;
  }
}

// ─── FORMATEAR RESULTADOS DE BÚSQUEDA ────────────────────────────────────────
function formatearBusqueda(resultado, perfil, listaPrecios = "madre") {
  if (!resultado) return "Sin resultados.";

  // Consulta genérica → responder con menú de categorías
  if (resultado.consulta_generica) {
    return "CONSULTA_GENERICA: El cliente quiere ver qué productos hay. Mencioná las categorías: vanitorios (30 a 150cm), bachas de apoyo en loza, mesadas, espejos con LED. Invitalo a pedir por medida o tipo.";
  }

  // Score bajo o sin resultados → pedir más detalle
  if (!resultado.resultados || resultado.resultados.length === 0 || resultado.pedir_mas_detalle) {
    return "SIN_RESULTADOS: No encontré productos claros para esta consulta. Pedí más detalle al cliente: medida en cm, tipo de producto (vanitorio/bacha/espejo/mesada) o color.";
  }

  // Deduplicar por familia
  const familiaVista = new Set();
  const deduplicados = [];
  for (const p of resultado.resultados) {
    const clave = p.familia && p.familia !== p.codigo ? p.familia : p.codigo;
    if (!familiaVista.has(clave)) {
      familiaVista.add(clave);
      deduplicados.push(p);
    }
    if (deduplicados.length >= 3) break;
  }

  const lines = [];
  deduplicados.forEach((p, i) => {
    lines.push(`[Resultado ${i + 1}] ${p.codigo} — ${p.nombre}`);
    if (p.medida) lines.push(`Medida: ${p.medida}cm | Guardado: ${p.guardado || "N/A"}`);

    // Opciones de color / variantes
    if (p.variantes_familia && p.variantes_familia.length > 1) {
      lines.push(`OPCIONES:`);
      p.variantes_familia.forEach(v => {
        const colStr = v.colores && v.colores.length ? v.colores.join(" / ") : (v.es_blanco ? "blanco" : "colores");
        lines.push(`  → ${v.codigo}: ${colStr}`);
      });
    } else if (p.colores_disponibles && p.colores_disponibles.length > 0) {
      lines.push(`Colores: ${p.colores_disponibles.join(" / ")}`);
    } else if (p.colores?.length) {
      lines.push(`Colores: ${p.colores.join(", ")}`);
    }

    // Datos de stock y precio según perfil
    if (perfil === "interno") {
      const vars = Object.entries(p.stock_variantes || {})
        .map(([k, v]) => `${k}:${v.stock}`).join(", ");
      lines.push(`Stock: ${p.stock_total} uds | ${vars || "sin variantes"}`);
      lines.push(`Lista Madre: $${p.precio_madre} | May1: $${p.precio_may1} | May2: $${p.precio_may2}`);
    } else if (perfil === "pdv") {
      lines.push(`Disponibilidad: ${p.stock_total > 0 ? "En stock" : "Sin stock"}`);
      lines.push(`Precio público: $${p.precio_madre}`);
    } else {
      // EXTERNO: nunca mostrar stock numérico
      lines.push(`Disponibilidad: ${p.stock_total > 0 ? "Disponible" : "Consultar"}`);
      lines.push(`Precio lista pública: $${p.precio_madre}`);
      // Si tiene lista especial, incluir para que Claude la ofrezca solo si la piden
      if (listaPrecios !== "madre") {
        lines.push(`[Precio especial del cliente (${listaPrecios}): $${precioSegunLista(p, listaPrecios)} — mostrar SOLO si el cliente lo pide]`);
      }
    }

    if (p.frase) lines.push(`"${p.frase}"`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

// ─── PROCESAR MENSAJE ─────────────────────────────────────────────────────────
async function procesarMensaje(numero, texto, mediaUrl = null) {
  const perfil = await obtenerPerfil(numero);
  const limpio = perfil.numero;
  let mensajeTexto = texto;

  // Audio → texto
  if (mediaUrl && (!texto || !texto.trim())) {
    console.log(`🎤 Transcribiendo audio de ${limpio}...`);
    const transcripcion = await transcribirAudio(mediaUrl);
    if (transcripcion) {
      mensajeTexto = transcripcion;
      console.log(`📝 "${transcripcion}"`);
    } else {
      return { texto: "No pude escuchar el audio. ¿Podés escribirme?", media: null };
    }
  }

  if (!mensajeTexto?.trim()) return { texto: null, media: null };

  // ── COMANDOS ADMIN (solo internos) ────────────────────────────────────────
  if (perfil.perfil === "interno") {
    // "lista may1 +5491122334455" o "lista madre 5491122334455"
    const cmdLista = mensajeTexto.match(/^lista\s+(madre|may1|may2)\s+\+?(\d{10,13})/i);
    if (cmdLista) {
      const nuevaLista = cmdLista[1].toLowerCase();
      const numTarget = cmdLista[2];
      const ok = memoria.asignarListaPrecios(numTarget, nuevaLista);
      const resp = ok
        ? `✅ Lista *${nuevaLista}* asignada a +${numTarget}`
        : `❌ Lista inválida. Usá: lista madre/may1/may2 [número]`;
      return { texto: resp, media: null };
    }
    // "clientes" → lista resumen
    if (/^clientes?\s*$/i.test(mensajeTexto.trim())) {
      const clientes = memoria.listarClientes().slice(0, 15);
      if (!clientes.length) return { texto: "No hay clientes registrados aún.", media: null };
      const lineas = clientes.map(c =>
        `• ${c.nombre} (+${c.numero}) | ${c.perfil} | lista: ${memoria.obtenerListaPrecios(c.numero)} | consultas: ${c.total_consultas}`
      );
      return { texto: `*Clientes registrados:*\n${lineas.join("\n")}`, media: null };
    }
  }

  // ── FLUJO: ESPERANDO SÍ/NO (¿sos cliente?) ────────────────────────────────
  if (perfil.perfil === "externo" && memoria.estaEsperandoSiCliente(limpio)) {
    const q = mensajeTexto.toLowerCase().trim();
    const esSi = /^(s[ií]|yes|claro|si!|sí!|dale|obvio|si,|sí,)/.test(q);
    const esNo = /^(no|nop|no!|nope|no,|para nada)/.test(q);

    memoria.registrarMensaje(limpio, "user", mensajeTexto);

    if (esSi) {
      memoria.marcarEsperandoSiCliente(limpio, false);
      memoria.marcarEsperandoNombreYCuit(limpio, true);
      const resp = `¡Genial! ¿Me pasás tu *nombre completo* y tu *CUIT o DNI*?\n\n_(Ej: Juan Pérez 20123456789)_`;
      memoria.registrarMensaje(limpio, "assistant", resp);
      return { texto: resp, media: null };
    } else if (esNo) {
      memoria.marcarEsperandoSiCliente(limpio, false);
      memoria.marcarEsperandoNombre(limpio, true);
      const resp = `Sin problema! ¿Me decís tu nombre para atenderte mejor?`;
      memoria.registrarMensaje(limpio, "assistant", resp);
      return { texto: resp, media: null };
    } else {
      const resp = `No entendí. ¿Sos cliente de MH Amoblamientos? Contestá *Sí* o *No*.`;
      memoria.registrarMensaje(limpio, "assistant", resp);
      return { texto: resp, media: null };
    }
  }

  // ── FLUJO: CAPTURA DE NOMBRE + CUIT (cliente identificado) ───────────────
  if (perfil.perfil === "externo" && memoria.estaEsperandoNombreYCuit(limpio)) {
    memoria.registrarMensaje(limpio, "user", mensajeTexto);
    memoria.marcarEsperandoNombreYCuit(limpio, false);

    // Extraer CUIT/DNI (7-11 dígitos seguidos, con o sin guiones)
    const cuitMatch = mensajeTexto.match(/\b(\d{2}-?\d{8}-?\d|\d{7,11})\b/);
    const cuitLimpio = cuitMatch ? cuitMatch[1].replace(/-/g, "") : null;
    // Nombre: texto sin el número
    const textoSinNum = mensajeTexto.replace(/\d{2}-?\d{8}-?\d|\d{7,11}/g, "").replace(/\s+/g, " ").trim();
    const nombreGuardado = memoria.guardarNombreDesdeChat(limpio, textoSinNum || mensajeTexto);

    let resp;
    if (cuitLimpio) {
      const verificacion = await verificarCuitEnDux(cuitLimpio);
      memoria.guardarCuit(limpio, cuitLimpio, verificacion.verificado);

      if (verificacion.verificado) {
        const nombreDux = verificacion.nombre_dux ? ` (en Dux: ${verificacion.nombre_dux})` : "";
        await enviarMensaje(
          ADMIN_NUMERO,
          `🟢 *Cliente verificado por WhatsApp*\n👤 ${nombreGuardado}${nombreDux}\n📱 +${limpio}\n🪪 CUIT/DNI: ${cuitLimpio}\n\n💡 Para asignarle lista: _lista may1 ${limpio}_ o _lista may2 ${limpio}_`
        );
        resp = `¡Hola ${nombreGuardado}! Te encontramos como cliente de MH. 🎉\n\nTe atiendo con precio de lista pública por ahora. El equipo puede activarte tu precio especial en breve.\n\n¿En qué te puedo ayudar?`;
      } else {
        await enviarMensaje(
          ADMIN_NUMERO,
          `🟡 *Nuevo número dice ser cliente (CUIT no encontrado en Dux)*\n👤 ${nombreGuardado}\n📱 +${limpio}\n🪪 CUIT/DNI: ${cuitLimpio}\n\nVerificar manualmente.`
        );
        resp = `¡Hola ${nombreGuardado}! No te encontré en nuestro sistema con ese CUIT/DNI. Avisé al equipo para que te asistan. 😊\n\n¿En qué te puedo ayudar mientras tanto?`;
      }
    } else {
      // No dio CUIT, solo nombre
      resp = `¡Perfecto, ${nombreGuardado}! Avisé al equipo para que verifiquen tu cuenta. Mientras tanto, ¿en qué te puedo ayudar?`;
      await enviarMensaje(
        ADMIN_NUMERO,
        `🟡 *Posible cliente sin CUIT*\n👤 ${nombreGuardado}\n📱 +${limpio}\nNo dio número de CUIT/DNI.`
      );
    }
    memoria.registrarMensaje(limpio, "assistant", resp);
    return { texto: resp, media: null };
  }

  // ── FLUJO: CAPTURA DE NOMBRE (no-clientes) ────────────────────────────────
  if (perfil.perfil === "externo" && memoria.estaEsperandoNombre(limpio)) {
    const nombreGuardado = memoria.guardarNombreDesdeChat(limpio, mensajeTexto);
    memoria.registrarMensaje(limpio, "user", mensajeTexto);
    const respuesta = `¡Perfecto, ${nombreGuardado}! Bienvenido a *MH Amoblamientos*.\n\nSomos una fábrica argentina de muebles de baño: vanitorios, bachas, mesadas y espejos. ¿En qué te puedo ayudar hoy?`;
    memoria.registrarMensaje(limpio, "assistant", respuesta);
    return { texto: respuesta, media: null };
  }

  // ── NÚMERO NUEVO EXTERNO → preguntar si es cliente ─────────────────────────
  if (perfil.perfil === "externo" && memoria.esNumeroNuevo(limpio)) {
    memoria.marcarEsperandoSiCliente(limpio, true);
    const respuesta = `¡Hola! 👋 Bienvenido a *MH Amoblamientos*, fábrica argentina de muebles de baño.\n\n¿Sos cliente nuestro?`;
    memoria.registrarMensaje(limpio, "assistant", respuesta);
    return { texto: respuesta, media: null };
  }

  // ── PEDIDO DE PDF o IMAGEN ────────────────────────────────────────────────
  const pedidoMedia = detectarPedidoMedia(mensajeTexto);
  if (pedidoMedia.esMedia) {
    const mem = memoria.cargarMemoria(limpio);
    const ultimoCodigo = mem.contexto?.ultimo_producto;

    if (ultimoCodigo) {
      let archivoMedia = null;
      let tipoMedia = "";

      if (pedidoMedia.esPDF) {
        archivoMedia = mediaManager.obtenerPDF(ultimoCodigo);
        tipoMedia = "PDF";
      } else if (pedidoMedia.esImagen) {
        archivoMedia = mediaManager.obtenerImagen(ultimoCodigo);
        tipoMedia = "imagen";
      }
      // Fallback: si piden PDF y no hay, intentar imagen
      if (!archivoMedia && pedidoMedia.esPDF) {
        archivoMedia = mediaManager.obtenerImagen(ultimoCodigo);
        tipoMedia = "imagen";
      }

      memoria.registrarMensaje(limpio, "user", mensajeTexto);

      if (archivoMedia) {
        const caption = `Aquí tenés la ${tipoMedia} del *${ultimoCodigo}* 📄`;
        memoria.registrarMensaje(limpio, "assistant", caption);
        return { texto: caption, media: archivoMedia };
      } else {
        const resp = `No tengo ${tipoMedia} disponible para *${ultimoCodigo}* todavía. ¿Querés que te pase los datos técnicos por acá?`;
        memoria.registrarMensaje(limpio, "assistant", resp);
        return { texto: resp, media: null };
      }
    } else {
      const resp = "¿De qué producto querés el PDF o la imagen? Primero consultame el producto y después te lo mando.";
      memoria.registrarMensaje(limpio, "user", mensajeTexto);
      memoria.registrarMensaje(limpio, "assistant", resp);
      return { texto: resp, media: null };
    }
  }

  // ── CONSULTA DE STOCK DE EXTERNO → no dar info, alertar equipo ───────────
  if (perfil.perfil === "externo" && consultaStock(mensajeTexto)) {
    memoria.registrarMensaje(limpio, "user", mensajeTexto);
    await alertarEquipo(limpio, perfil.nombre, mensajeTexto);
    const resp = `Voy a consultar la disponibilidad con el equipo y te responden a la brevedad. 🙌`;
    memoria.registrarMensaje(limpio, "assistant", resp);
    return { texto: resp, media: null };
  }

  // ── GUARDAR MENSAJE Y BUSCAR ──────────────────────────────────────────────
  memoria.registrarMensaje(limpio, "user", mensajeTexto);

  // Determinar sección
  const q = mensajeTexto.toLowerCase();
  let seccion = "baño";
  if (perfil.perfil === "interno") {
    if (q.includes("en cocina") || q.includes("alacena") || q.includes("bajo mesada")) seccion = "cocina";
    else if (q.includes("en placard") || q.includes("modulo placard")) seccion = "placard";
  }

  const resultado = buscadorCtx.buscarConContexto(limpio, mensajeTexto, {
    seccion,
    perfil: perfil.perfil,
    limit: 6
  });

  const listaPrecios = memoria.obtenerListaPrecios(limpio);
  const infoBusqueda = formatearBusqueda(resultado, perfil.perfil, listaPrecios);
  const resumenMem = memoria.resumenCliente(limpio);
  const historial = memoria.obtenerHistorialClaude(limpio).slice(-8);

  // Saludo personalizado si es primera vez del día
  const esPrimeraMensajeHoy = memoria.esPrimeraVezHoy(limpio);
  const saludoExtra = (esPrimeraMensajeHoy && perfil.nombre && perfil.perfil !== "externo")
    ? `Hoy es la primera consulta del día de ${perfil.nombre}. Saludalo calurosamente por su nombre al inicio de la respuesta.`
    : "";

  const systemPrompt = `Sos el asistente de ventas de MH Amoblamientos, fábrica argentina de muebles de baño (vanitorios, bachas, mesadas, espejos). Atendés por WhatsApp de forma concisa y amigable. Respondés siempre en español rioplatense.

${resumenMem}
${saludoExtra}

PERFIL: ${perfil.perfil}${perfil.nombre ? ` | Nombre: ${perfil.nombre}` : ""}
${perfil.perfil === "interno" ? "→ Equipo interno: mostrá stock exacto por color y todas las listas de precios." : ""}
${perfil.perfil === "pdv" ? "→ Revendedor PDV: mostrá precio público Lista Madre. Al final preguntá: '¿Querés ver tu precio de compra?'" : ""}
${perfil.perfil === "externo" ? `→ Consumidor final: mostrá siempre el "Precio lista pública". NUNCA menciones stock numérico ni unidades. Si el dato tiene "[Precio especial...]", NO lo menciones a menos que el cliente lo pida explícitamente (dice "mi precio", "precio de cuenta", "precio especial"). Si el cliente tiene lista especial asignada (${listaPrecios !== "madre" ? `lista: ${listaPrecios}` : "lista madre por ahora"}), al final podés agregar: "¿Querés que te pase tu precio especial de cliente?"` : ""}

DATOS DE LA BASE (actualizados desde Dux):
${infoBusqueda}

REGLAS:
- Usá solo los datos de arriba. No inventes precios ni stock.
- Si el resultado empieza con CONSULTA_GENERICA: respondé con un menú amigable de categorías disponibles.
- Si el resultado empieza con SIN_RESULTADOS: pedí más detalle al cliente (medida, tipo, color).
- Si hay OPCIONES DE COLOR: presentalas claramente y preguntá cuál prefiere.
- Si hay un resultado claro con alta confianza, respondé directo con los datos.
- Si hay varios similares, listá hasta 3 con sus diferencias clave.
- Máximo 5 líneas de respuesta.
- NUNCA des stock numérico a consumidores finales (perfil externo).
- Si el cliente pide PDF o imagen, decile que responda "PDF" o "foto" y se lo enviás.`;

  try {
    const respuesta = await llamarClaude(historial, systemPrompt);
    memoria.registrarMensaje(limpio, "assistant", respuesta);
    return { texto: respuesta, media: null };
  } catch (error) {
    console.error("Error Claude:", error.message);
    return { texto: "Hubo un error procesando tu consulta. Intentá de nuevo en unos segundos.", media: null };
  }
}

// ─── WEBHOOK TWILIO ───────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.status(200).send("");
  const numero = (req.body.From || "").replace("whatsapp:+", "");
  const texto = req.body.Body || "";
  const mediaUrl = req.body.MediaUrl0 || null;

  if (!numero) return;
  console.log(`📩 [${numero}] ${texto || "(audio/media)"}`);

  try {
    const resultado = await procesarMensaje(numero, texto, mediaUrl);
    if (!resultado || !resultado.texto) return;

    // Enviar texto
    await enviarMensaje(numero, resultado.texto);

    // Enviar media si hay
    if (resultado.media) {
      const ext = path.extname(resultado.media).toLowerCase();
      const esPDF = ext === ".pdf";
      await enviarMedia(numero, resultado.media, esPDF ? "📄 Ficha técnica" : "🖼️ Imagen del producto");
    }

    console.log(`✅ → ${numero}: ${resultado.texto.substring(0, 80)}...`);
  } catch (error) {
    console.error(`❌ Error procesando [${numero}]:`, error.message);
  }
});

// ─── ENDPOINT DE SALUD ────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const archivos = ["datos-dux/productos.json", "datos-dux/stock.json", "datos-dux/precios.json"];
  const estado = {};
  archivos.forEach(f => {
    const ruta = path.join(__dirname, f);
    if (fs.existsSync(ruta)) {
      const stat = fs.statSync(ruta);
      estado[f] = { ok: true, kb: (stat.size / 1024).toFixed(1), modificado: stat.mtime.toLocaleString("es-AR") };
    } else {
      estado[f] = { ok: false };
    }
  });
  res.json({
    status: "ok",
    version: "3.1",
    hora: new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }),
    datos_dux: estado
  });
});

// ─── SYNC DUX ─────────────────────────────────────────────────────────────────
function ejecutarSync() {
  console.log("🔄 Sincronizando Dux...");
  exec("node sincronizacion-automatica/sync-dux.js", { cwd: __dirname, timeout: 300000 }, (err) => {
    if (err) console.error("⚠️ Error sync Dux:", err.message);
    else console.log("✅ Sync Dux completado");
  });
}

setTimeout(ejecutarSync, 5000);
cron.schedule("0 * * * *", () => { console.log("⏰ Cron: sync Dux..."); ejecutarSync(); });

// ─── ARRANCAR SERVIDOR ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 MH Amoblamientos IA v3.1`);
  console.log(`📡 Puerto: ${PORT}`);
  console.log(`📱 Webhook: POST /webhook`);
  console.log(`📎 Media: GET /media/*`);
  console.log(`🔄 Sync Dux: al arrancar + cada hora\n`);
});
