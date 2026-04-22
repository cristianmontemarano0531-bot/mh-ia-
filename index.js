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
const buscadorBase = require("./buscador/buscador-inteligente.js");
const navRubros = require("./buscador/navegacion-rubros.js");
const catalogoMaestro = require("./buscador/catalogo-maestro.js");
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

// ─── CORRECTOR DE TRANSCRIPCIONES DE AUDIO ───────────────────────────────────
// Whisper deforma nombres de productos en español rioplatense
const CORRECCIONES_AUDIO = [
  // Producto VMINI
  [/\bb[\s-]?mini\b/gi, "vmini"],
  [/\bv[\s-]?mini\b/gi, "vmini"],
  [/\bbe[\s-]?mini\b/gi, "vmini"],
  // Colores
  [/\bhome\b/gi, "hormigon"],
  [/\bormigon\b/gi, "hormigon"],
  [/\bormi\b/gi, "hormigon"],
  [/\bgrafitti\b/gi, "grafito"],
  [/\bgrafico\b/gi, "grafito"],
  [/\bzahara\b/gi, "sahara"],
  [/\bneto\b/gi, "nero"],
  [/\bkaju\b/gi, "caju"],
  // Líneas
  [/\bmar[\s-]?bela\b/gi, "marbela"],
  [/\bmar[\s-]?bella\b/gi, "marbela"],
  [/\bana[\s-]?quel\b/gi, "anaquel"],
];

function corregirTranscripcion(texto) {
  let corregido = texto;
  CORRECCIONES_AUDIO.forEach(([patron, reemplazo]) => {
    corregido = corregido.replace(patron, reemplazo);
  });
  if (corregido !== texto) {
    console.log(`🔧 Corrección audio: "${texto}" → "${corregido}"`);
  }
  return corregido;
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

  // ── FAMILIA VANITORY: mostrar opciones por medida (cajones/puertas × blanco/color) ──
  const topResultado = resultado.resultados[0];
  if (topResultado?.tipo_familia === "vanitory" && topResultado?.variantes_familia_medida?.length > 1) {
    const medida = topResultado.medida;
    const mismaMediaVans = resultado.resultados.filter(p => p.tipo_familia === "vanitory" && p.medida === medida);

    // Ganador claro (≥20 pts de diferencia) → saltar al resultado directo
    if (mismaMediaVans.length >= 2 && (mismaMediaVans[0].score - mismaMediaVans[1].score) >= 20) {
      // Cae al flujo normal de deduplicación abajo
    } else {

    const lines = [`🪟 *Vanitorios de ${medida}cm* — opciones disponibles:`];

    resultado.resultados
      .filter(p => p.tipo_familia === "vanitory" && p.medida === medida)
      .forEach(p => {
        const guardadoStr = p.guardado ? p.guardado.charAt(0).toUpperCase() + p.guardado.slice(1) : "?";
        const colorStr = (p.colores || []).length === 1 ? "Blanco" : "Color";
        // Extraer nombre de línea del nombre del producto
        const lineaMatch = p.nombre.match(/LINEA\s+(\w+)|ECO|MARBELA/i);
        const linea = lineaMatch ? ` [${lineaMatch[0].trim()}]` : "";
        const stockStr = perfil === "interno"
          ? `${p.stock_total} uds`
          : p.stock_total > 0 ? "✅" : "❌";
        const precioStr = perfil === "interno"
          ? `$${p.precio_madre}/$${p.precio_may1}/$${p.precio_may2}`
          : `$${precioSegunLista(p, listaPrecios)}`;
        lines.push(`  → *${p.codigo}*${linea} — ${guardadoStr}/${colorStr} | ${stockStr} | ${precioStr}`);
      });

    lines.push(`\n¿Con cajones o con puertas? ¿En blanco o con color?`);
    return lines.join("\n");
    } // fin else ganador claro
  }

  // ── FAMILIA DE MEDIDAS: mostrar todas las variantes compactas (ej: mesadas de loza) ──
  if ((topResultado?.tipo_familia === "medida" || topResultado?.tipo_familia === "medida_color") && topResultado?.variantes_familia_medida?.length > 1) {
    const lines = [];
    const nombre_familia = topResultado.nombre.split(" ").slice(0, 4).join(" ");
    lines.push(`📐 *${nombre_familia}* — opciones disponibles:`);

    resultado.resultados
      .filter(p => p.tipo_familia === "medida" || p.tipo_familia === "medida_color")
      .forEach(p => {
        const stockStr = perfil === "interno"
          ? `${p.stock_total} uds`
          : p.stock_total > 0 ? "disponible" : "sin stock";
        const precioStr = perfil === "interno"
          ? `$${p.precio_madre}|$${p.precio_may1}|$${p.precio_may2}`
          : `$${perfil === "pdv" ? p.precio_madre : precioSegunLista(p, listaPrecios)}`;
        const varInfo = p.variantes_familia_medida?.find(v => v.codigo === p.codigo);
        const label = varInfo?.descripcion || p.codigo;
        lines.push(`  → *${p.codigo}* (${label}) | ${stockStr} | ${precioStr}`);
      });

    lines.push(`\n¿Cuál medida necesitás?`);
    return lines.join("\n");
  }

  // Deduplicar por familia (colores)
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

// ─── FORMATEAR LISTA DE SUBRUBRO ──────────────────────────────────────────────
function formatearListaSubrubro(productos, rubro, subrubro, perfil, listaPrecios) {
  if (!productos || productos.length === 0) {
    return `SIN_RESULTADOS: No hay productos catalogados en ${rubro}${subrubro ? " → " + subrubro : ""}.`;
  }

  const titulo = subrubro ? `${rubro} → ${subrubro}` : rubro;
  const lines = [`📂 *${titulo}* (${productos.length} modelos):`];

  // Deduplicar por familia
  const familiaVista = new Set();
  const deduplicados = [];
  for (const p of productos) {
    const clave = p.familia && p.familia !== p.codigo ? p.familia : p.codigo;
    if (!familiaVista.has(clave)) {
      familiaVista.add(clave);
      deduplicados.push(p);
    }
  }

  deduplicados.slice(0, 10).forEach((p, i) => {
    let line = `[Opción ${i + 1}] ${p.codigo} — ${p.nombre}`;
    if (p.medida) line += ` | ${p.medida}cm`;

    if (perfil === "interno") {
      line += ` | Stock: ${p.stock_total} uds`;
      line += ` | $${p.precio_madre}/$${p.precio_may1}/$${p.precio_may2}`;
    } else {
      line += ` | ${p.stock_total > 0 ? "Disponible" : "Consultar"}`;
      const precio = listaPrecios === "madre" ? p.precio_madre : precioSegunLista(p, listaPrecios);
      line += ` | $${precio}`;
      if (listaPrecios !== "madre") {
        line += ` [especial]`;
      }
    }

    if (p.colores && p.colores.length > 1) line += ` | Colores: ${p.colores.join("/")}`;
    lines.push(line);
  });

  if (deduplicados.length > 10) lines.push(`... y ${deduplicados.length - 10} modelos más`);

  return lines.join("\n");
}

// ─── CONSTRUIR SYSTEM PROMPT ──────────────────────────────────────────────────
function construirSystemPrompt(perfil, listaPrecios, resumenMem, saludoExtra, infoBusqueda) {
  const nombreCliente = perfil.nombre || "";

  // ⛔ Primera sección del prompt — la más importante. Anti-alucinación.
  const reglaOro = `╔════════════════════════════════════════════╗
║  REGLA DE ORO — INNEGOCIABLE                ║
║  Solo existe lo que aparece en DATOS o en   ║
║  CATÁLOGO MAESTRO. NADA MÁS.                ║
╚════════════════════════════════════════════╝

Nuestra base de productos vive en un sistema en la nube (Dux) que se sincroniza cada hora.
El bloque "DATOS" te trae lo que hay en ese sistema para esta consulta puntual.
El bloque "CATÁLOGO MAESTRO" te muestra TODO lo que existe en la base (rubros, medidas, colores, líneas).

QUÉ NUNCA PODÉS HACER:
❌ Inventar códigos (ej: "V70B", "VNEGRO", "ESPEJO-LED") que no estén listados.
❌ Inventar precios. Si no está el precio en DATOS → decí "te confirmo el precio en un momento" o pedí código exacto.
❌ Inventar stock ni disponibilidad. Si no aparece → "consulto disponibilidad con el equipo".
❌ Inventar colores, medidas, materiales o acabados que no estén en CATÁLOGO MAESTRO.
❌ Inventar modelos, líneas o categorías (ej: "línea Premium", "modelo Ejecutivo") que no existan.
❌ Prometer cuotas, financiación, descuentos, envíos gratis o plazos si no te los pasaron en DATOS.

QUÉ SÍ HACÉS CUANDO TE FALTA UN DATO:
✅ Preguntarle al cliente con los valores reales del CATÁLOGO MAESTRO.
   Ej: si pregunta un color raro → "Lo tenemos en blanco o en estos colores: [lista real]. ¿Cuál te gusta?"
✅ Si no encontrás el producto que pidió → "No lo tengo en catálogo. Lo consulto con el equipo y te vuelvo."
✅ Pedir código exacto, medida en cm, o que el cliente aclare.`;

  const catalogoMaestroStr = `📋 CATÁLOGO MAESTRO (fuente de verdad, actualizada desde Dux):
${catalogoMaestro.resumenParaPrompt()}

IMPORTANTE:
- Esos son TODOS los rubros, subrubros, medidas y colores que existen. No hay más.
- Los colores y medidas dependen del SUBRUBRO (línea), no solo del rubro. Recordá las reglas duras:
  · VANITORY PIATTO → medidas 30 a 150 cm; colores: BLANCO o línea color (Cajú/Grafito/Hormigón/Mezzo/Sahara).
  · VANITORY MARBELA → SOLO medidas 60 y 80 cm; SOLO colores NERO (negro) o TERRA (beige). Ya viene CON tapa de mármol integrada (no se vende sin tapa ni la tapa suelta).
  · VANITORY CLASSIC → SOLO medidas 50 y 60 cm; SOLO color BLANCO.
  · BACHAS → solo en BLANCO (loza o sintético).
  · MESADAS DE LOZA → BLANCO o NEGRO MATE.
  · MESADAS laminado/sintética → las medidas estándar del catálogo.
  · NO vendemos tapas de mármol sueltas (son componentes internos de los Marbela).
- Si el cliente nombra un color o medida que no está en el subrubro correcto, aclarale cuáles sí hay. NO adaptes un producto a un valor inexistente.`;

  const basePersona = `Sos Abril, asesora comercial de MH Amoblamientos — fábrica argentina de muebles de baño (vanitorios, bachas, mesadas, espejos).
Atendés por WhatsApp en español rioplatense, con tono humano, directo y sin vueltas.`;

  const estilo = `ESTILO MH:
- Mensajes cortos. Un dato por línea. Nada de párrafos largos.
- Hablá natural: "dale", "buenísimo", "perfecto", "te paso", "avanzamos". Sin tecnicismos innecesarios.
- Si el cliente saluda o escribe informal, contestá igual de amable. Si va al grano, vos también.
- Saludá por el nombre cuando lo tenés.${nombreCliente ? ` El cliente se llama ${nombreCliente}.` : ""}
- Cerrá siempre con una pregunta comercial concreta: "¿Avanzamos?", "¿Te lo preparo?", "¿Abonás al retirar?", "¿Querés que te pase el flete?".`;

  const scope = `SCOPE — qué vendemos por acá:
- SOLO muebles de baño: vanitorios (Piatto, Marbela, Classic), bachas, mesadas, espejos/botiquines.
- NO vendemos por WhatsApp: cocinas, placards, alacenas, sanitarios (inodoros/bidets), uñeros de cocina.
- Si preguntan por algo fuera de scope, rebotalo amable:
  "Por WhatsApp solo manejamos línea de baño. Para [cocina/placard/etc.] pueden acercarse al local o llamar al 4460-4224."`;

  const perfilBloque = perfil.perfil === "interno"
    ? `PERFIL CLIENTE: INTERNO (equipo MH)
- Mostrale stock exacto por variante y las tres listas (Madre / May1 / May2).
- Puede consultar TODO el catálogo (también rubros fuera del scope comercial).`
    : perfil.perfil === "pdv"
    ? `PERFIL CLIENTE: PDV (revendedor)
- Precio público (Lista Madre).
- Stock: "disponible" o "sin stock", sin números.
- Al final ofrecé: "¿Querés ver tu precio de compra?"`
    : `PERFIL CLIENTE: EXTERNO (consumidor final)
- Mostrá SIEMPRE el precio lista pública. NUNCA des stock numérico (decí "disponible" o "consultar").
- Si aparece "[Precio especial...]" o "[especial]", NO lo menciones salvo que el cliente pida explícitamente "mi precio", "precio de cuenta" o "precio especial".
${listaPrecios !== "madre" ? `- Este cliente tiene lista especial (${listaPrecios}). Al final podés ofrecer: "¿Querés que te pase tu precio especial de cliente?"` : ""}`;

  const reglasBusqueda = `CÓMO MANEJAR LA CONSULTA (según DATOS):
- Si DATOS = "CONSULTA_GENERICA:..." → el cliente pidió algo muy abierto. NO tires catálogo. Preguntá medida + tipo usando SOLO los valores reales del CATÁLOGO MAESTRO. Máximo 2 preguntas.
- Si DATOS = "SIN_RESULTADOS:..." → decile textual: "no lo tengo cargado así, ¿me pasás el código exacto o medida en cm?". NO sugieras productos alternativos que inventaste.
- Si DATOS = "CONSULTA_RUBRO_GENERICO:..." → preguntá medida + tipo usando medidas y líneas reales del CATÁLOGO MAESTRO para ese rubro. Ejemplo para MUEBLES: "¿Qué medida necesitás? Tenemos de 30 a 150 cm. ¿Preferís Piatto (colgante con uñero), Marbela (colgante con tiradores) o Classic (de pie)?"
- Si DATOS = "FUERA_DE_SCOPE:..." → rebote amable, derivá al local/teléfono.
- Si hay un resultado claro (alta confianza) → respondé directo con código, precio exacto y 1 frase de cierre. Ejemplo: "El VMINIB sale $78.600. ¿Te lo preparo?"
- Si hay varias opciones (mismo rubro, distinta medida/color) → máximo 3 líneas, una por opción, preguntando al final cuál prefiere.
- Si el cliente pide un color que no existe en CATÁLOGO MAESTRO → aclará los que sí hay: "Lo tenemos en [lista real de colores del rubro]. ¿Cuál elegís?"
- Si el cliente pide una medida que no existe → aclará las medidas reales: "En ese rubro manejamos [medidas reales]. ¿Alguna te sirve?"
- Si piden PDF/foto/ficha de un producto, decile que responda "PDF" o "foto" y se lo mandás.
- Si no encontrás algo que el cliente pidió → decí "Lo consulto con el equipo y te confirmo". NO inventes un código similar ni un producto alternativo.`;

  return [reglaOro, catalogoMaestroStr, basePersona, estilo, scope, perfilBloque, resumenMem, saludoExtra, reglasBusqueda, `DATOS (resultado puntual de esta consulta):\n${infoBusqueda}`]
    .filter(Boolean).join("\n\n");
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
      console.log(`📝 "${transcripcion}"`);
      mensajeTexto = corregirTranscripcion(transcripcion);
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

    // Si había una consulta pendiente, procesarla ahora en un segundo mensaje
    const pendiente = memoria.obtenerConsultaPendiente(limpio);
    if (pendiente) {
      memoria.limpiarConsultaPendiente(limpio);
      await enviarMensaje(limpio, resp);
      return procesarMensaje(numero, pendiente, null);
    }

    return { texto: resp, media: null };
  }

  // ── FLUJO: CAPTURA DE NOMBRE (no-clientes) ────────────────────────────────
  if (perfil.perfil === "externo" && memoria.estaEsperandoNombre(limpio)) {
    const nombreGuardado = memoria.guardarNombreDesdeChat(limpio, mensajeTexto);
    memoria.registrarMensaje(limpio, "user", mensajeTexto);

    // Si había una consulta pendiente del primer mensaje, procesarla ahora.
    const pendiente = memoria.obtenerConsultaPendiente(limpio);
    if (pendiente) {
      memoria.limpiarConsultaPendiente(limpio);
      const saludo = `¡Perfecto, ${nombreGuardado}! Recuperando tu consulta...`;
      await enviarMensaje(limpio, saludo);
      memoria.registrarMensaje(limpio, "assistant", saludo);
      // Reentrada recursiva con la consulta original
      const perfilActualizado = await obtenerPerfil(numero);
      return procesarMensaje(numero, pendiente, null);
    }

    const respuesta = `¡Perfecto, ${nombreGuardado}! Bienvenido a *MH Amoblamientos*.\n\nSomos una fábrica argentina de muebles de baño: vanitorios, bachas, mesadas y espejos. ¿En qué te puedo ayudar hoy?`;
    memoria.registrarMensaje(limpio, "assistant", respuesta);
    return { texto: respuesta, media: null };
  }

  // ── NÚMERO NUEVO EXTERNO → preguntar si es cliente ─────────────────────────
  if (perfil.perfil === "externo" && memoria.esNumeroNuevo(limpio)) {
    // Si el primer mensaje parece una consulta real (no solo un "hola"), guardala para procesarla después del saludo.
    const esSoloSaludo = /^(hola|buen[oa]s?|buenas?\s?(dias?|tardes?|noches?)|hey|hi|holi|holis|que tal|qtal)[\s!.¡]*$/i.test(mensajeTexto.trim());
    if (!esSoloSaludo && mensajeTexto.trim().length > 3) {
      memoria.guardarConsultaPendiente(limpio, mensajeTexto);
    }
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

  // ── FUERA DE SCOPE (cocina/placard/sanitarios) → rebote conversacional ────
  if (perfil.perfil !== "interno") {
    const fueraScope = navRubros.detectarFueraDeScope(mensajeTexto);
    const rubroBano = navRubros.detectarRubro(mensajeTexto);
    // Solo rebota si mencionó fuera-de-scope Y no está hablando de algo de baño
    if (fueraScope && !rubroBano) {
      memoria.registrarMensaje(limpio, "user", mensajeTexto);
      const listaPrecios = memoria.obtenerListaPrecios(limpio);
      const resumenMem = memoria.resumenCliente(limpio);
      const historial = memoria.obtenerHistorialClaude(limpio).slice(-8);
      const infoBusqueda = `FUERA_DE_SCOPE: el cliente preguntó por "${fueraScope}". Recordale que por WhatsApp solo manejás línea de baño. Invitalo a pasar por el local (Av. Presidente Perón 3048, Haedo) o llamar al 4460-4224 para cocina/placard/sanitarios. Después ofrecele ayuda con algo de baño.`;
      const systemPrompt = construirSystemPrompt(perfil, listaPrecios, resumenMem, "", infoBusqueda);
      try {
        const respuesta = await llamarClaude(historial, systemPrompt);
        memoria.registrarMensaje(limpio, "assistant", respuesta);
        return { texto: respuesta, media: null };
      } catch (error) {
        console.error("Error Claude (fuera scope):", error.message);
        return { texto: "Por WhatsApp solo manejamos línea de baño. Para otros productos acercate al local o al 4460-4224.", media: null };
      }
    }
  }

  // ── RUBRO DE BAÑO DETECTADO + SIN MEDIDA → pedir calificación ────────────
  {
    const rubroDetectado = navRubros.detectarRubro(mensajeTexto);
    if (rubroDetectado) {
      const sinMedida = !/\b\d{2,3}\s*cm?\b/i.test(mensajeTexto);
      const sinCodigo = !/\b[A-Z]{1,3}\d{2,3}[A-Z]*\b/i.test(mensajeTexto);
      const palabrasQ = mensajeTexto.trim().split(/\s+/);
      const esRubroGenerico = palabrasQ.length <= 5 && sinMedida && sinCodigo;

      if (esRubroGenerico) {
        memoria.registrarMensaje(limpio, "user", mensajeTexto);
        const subrubros = navRubros.obtenerSubrubros(rubroDetectado);
        const subrubrosStr = subrubros.length
          ? subrubros.map(s => s.nombre).join(" / ")
          : "(sin subrubros)";

        const pistas = {
          "MUEBLES": "Preguntale: ¿qué medida (30, 45, 50, 60, 80, 90, 110, 120 cm)? y ¿colgante con uñero (línea Piatto), colgante con tiradores (Marbela) o de pie (Classic)?",
          "BACHAS": "Preguntale: ¿de apoyo sobre mesada o de encastre? ¿prefiere loza blanca o sintética con color?",
          "MESADAS": "Preguntale: ¿qué medida? ¿laminado (económico), loza, mármol sintético o mármol natural?",
          "ESPEJOS Y BOTIQUINES": "Preguntale: ¿espejo simple o botiquín con puertas? ¿qué medida?"
        };

        const listaPrecios = memoria.obtenerListaPrecios(limpio);
        const resumenMem = memoria.resumenCliente(limpio);
        const historial = memoria.obtenerHistorialClaude(limpio).slice(-8);
        const infoBusqueda = `CONSULTA_RUBRO_GENERICO: el cliente preguntó por "${rubroDetectado}" sin dar medida ni código. Subrubros disponibles: ${subrubrosStr}. ${pistas[rubroDetectado] || "Preguntá medida y tipo."} Máximo 2 preguntas, tono natural, no uses menús tipo lista.`;
        const systemPrompt = construirSystemPrompt(perfil, listaPrecios, resumenMem, "", infoBusqueda);
        try {
          const respuesta = await llamarClaude(historial, systemPrompt);
          memoria.registrarMensaje(limpio, "assistant", respuesta);
          return { texto: respuesta, media: null };
        } catch (error) {
          console.error("Error Claude (rubro generico):", error.message);
          return { texto: "¿Me contás qué medida y tipo buscás?", media: null };
        }
      }
    }
  }

  // ── GUARDAR MENSAJE Y BUSCAR ──────────────────────────────────────────────
  memoria.registrarMensaje(limpio, "user", mensajeTexto);

  // Sección: siempre baño (scope único del bot — solo 89 productos curados)
  const resultado = buscadorCtx.buscarConContexto(limpio, mensajeTexto, {
    seccion: "baño",
    perfil: perfil.perfil,
    limit: 6
  });

  const listaPrecios = memoria.obtenerListaPrecios(limpio);
  const infoBusqueda = formatearBusqueda(resultado, perfil.perfil, listaPrecios);
  const resumenMem = memoria.resumenCliente(limpio);
  const historial = memoria.obtenerHistorialClaude(limpio).slice(-8);

  const esPrimeraMensajeHoy = memoria.esPrimeraVezHoy(limpio);
  const saludoExtra = (esPrimeraMensajeHoy && perfil.nombre && perfil.perfil !== "externo")
    ? `Hoy es la primera consulta del día de ${perfil.nombre}. Saludalo calurosamente por su nombre al inicio de la respuesta.`
    : "";

  const systemPrompt = construirSystemPrompt(perfil, listaPrecios, resumenMem, saludoExtra, infoBusqueda);

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
    version: "3.8",
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
  console.log(`\n🚀 MH Amoblamientos IA v3.8 — 77 productos comerciales (componentes internos ocultos)`);
  console.log(`📡 Puerto: ${PORT}`);
  console.log(`📱 Webhook: POST /webhook`);
  console.log(`📎 Media: GET /media/*`);
  console.log(`🔄 Sync Dux: al arrancar + cada hora\n`);
});
