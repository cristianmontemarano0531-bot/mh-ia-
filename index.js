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
const memoria = require("./memoria-de-clientes/memoria-manager.js");
const mediaManager = require("./imagenes-y-pdf-para-clientes/media-manager.js");
const usuariosMgr = require("./config/usuarios-manager.js");
const detectorGastos = require("./gastos/detector.js");
const procesadorGastos = require("./gastos/index.js");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
// Middleware: forzar Content-Disposition con filename para que WhatsApp
// reconozca el documento con su nombre. Algunos clientes no renderizan
// bien el adjunto sin este header.
app.use("/media", (req, res, next) => {
  const filename = path.basename(req.path);
  if (filename) {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  next();
}, express.static(path.join(__dirname, "imagenes-y-pdf-para-clientes"), {
  setHeaders: (res, filePath) => {
    if (filePath.toLowerCase().endsWith(".pdf")) {
      res.setHeader("Content-Type", "application/pdf");
    }
  }
}));

// Módulo de control de stock móvil (web app interna para depósito).
// Aislado del flujo del bot: vive en /control y tiene su propio router.
app.use("/control", require("./stock-control/router.js"));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

// Railway da RAILWAY_STATIC_URL sin "https://" — lo forzamos siempre
const RAW_BASE_URL = process.env.RAILWAY_STATIC_URL || process.env.BASE_URL || "";
const BASE_URL = RAW_BASE_URL && !/^https?:\/\//i.test(RAW_BASE_URL)
  ? `https://${RAW_BASE_URL}`
  : RAW_BASE_URL;
console.log(`🌐 BASE_URL=${BASE_URL || "(vacío)"}`);

const VERSION = "4.1.4";

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS DE COMUNICACIÓN
// ═════════════════════════════════════════════════════════════════════════════

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

async function enviarMedia(numero, mediaPath, caption = "") {
  if (!mediaPath || !BASE_URL) {
    console.log("⚠️ No se puede enviar media: sin BASE_URL o archivo no encontrado");
    return false;
  }
  try {
    const rel = path.relative(
      path.join(__dirname, "imagenes-y-pdf-para-clientes"),
      mediaPath
    ).replace(/\\/g, "/");
    // Cache-busting: si Twilio/WhatsApp cacheó un intento anterior fallido,
    // el query param fuerza que lo traten como URL nueva.
    const mediaUrl = `${BASE_URL}/media/${rel}?v=${Date.now()}`;

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
    const body = await res.text();
    if (res.ok) {
      console.log(`📎 Media OK → ${mediaUrl}`);
    } else {
      console.error(`❌ Media FAIL (${res.status}) URL=${mediaUrl}\n${body.substring(0, 500)}`);
    }
    return res.ok;
  } catch (e) {
    console.error("Error enviando media:", e.message);
    return false;
  }
}

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
      max_tokens: 1200,
      system: systemPrompt,
      messages: mensajes
    })
  });
  const data = await res.json();
  return data.content?.[0]?.text || "Lo siento, hubo un error. Intentá de nuevo.";
}

// ═════════════════════════════════════════════════════════════════════════════
// CORRECCIÓN DE AUDIO (Whisper deforma términos rioplatenses)
// ═════════════════════════════════════════════════════════════════════════════

const CORRECCIONES_AUDIO = [
  [/\bb[\s-]?mini\b/gi, "vmini"],
  [/\bv[\s-]?mini\b/gi, "vmini"],
  [/\bbe[\s-]?mini\b/gi, "vmini"],
  [/\bhome\b/gi, "hormigon"],
  [/\bormigon\b/gi, "hormigon"],
  [/\bormi\b/gi, "hormigon"],
  [/\bgrafitti\b/gi, "grafito"],
  [/\bgrafico\b/gi, "grafito"],
  [/\bzahara\b/gi, "sahara"],
  [/\bneto\b/gi, "nero"],
  [/\bkaju\b/gi, "caju"],
  [/\bmar[\s-]?bela\b/gi, "marbela"],
  [/\bmar[\s-]?bella\b/gi, "marbela"],
];

function corregirTranscripcion(texto) {
  let corregido = texto;
  CORRECCIONES_AUDIO.forEach(([patron, reemplazo]) => {
    corregido = corregido.replace(patron, reemplazo);
  });
  if (corregido !== texto) console.log(`🔧 Corrección audio: "${texto}" → "${corregido}"`);
  return corregido;
}

// ═════════════════════════════════════════════════════════════════════════════
// DETECTORES DE INTENCIÓN
// ═════════════════════════════════════════════════════════════════════════════

// Comandos admin — empiezan con "/"
function detectarComandoAdmin(texto) {
  const t = texto.trim();
  if (!t.startsWith("/")) return null;
  const partes = t.split(/\s+/);
  const cmd = partes[0].toLowerCase();
  return { cmd, args: partes.slice(1) };
}

// Detecta un código de producto dentro del texto.
// Códigos válidos en MH (baño): V\d+..., EDM\d+..., TAPAMARMOL\d+..., VMINI..., VMINIB, VEDM...
function extraerCodigo(texto) {
  const t = String(texto || "").toUpperCase();
  const patrones = [
    /\bV\d{2,3}[A-Z]*\b/,                    // V60U, V80UC, V60CLAC, V60UCCOLOR
    /\bVMINI[A-Z]*\b/,                        // VMINI, VMINIB, VMINICOLOR, VMINIBCOLOR
    /\bEDM\d{2,3}[A-Z]*\b/,                   // EDM60, EDM80N
    /\bVEDM[A-Z]*\d*\b/,                      // VEDM, VEDMN, VEDM60
    /\bTAPAMARMOL\d{2,3}[A-Z]*\b/,            // TAPAMARMOL060N
  ];
  for (const p of patrones) {
    const m = t.match(p);
    if (m) return m[0];
  }
  return null;
}

// Detecta si el texto menciona un RUBRO sin especificar medida/código/qualifier.
// "vanitorios" → MUEBLES  |  "bachas" → BACHAS  |  "mesadas" → MESADAS
// PERO "mesadas de loza" → null (tiene qualifier "loza" → va a Modo 2)
function detectarRubroSolo(texto) {
  const t = texto.toLowerCase().trim();
  if (t.split(/\s+/).length > 4) return null;
  if (/\d{2,3}/.test(t)) return null;
  if (extraerCodigo(texto)) return null;

  // Si menciona un qualifier (subrubro / color / tipo), NO es rubro solo → va a Modo 2
  const QUALIFIERS = /\b(loza|losa|sint[eé]tic|laminad|marmol|m[aá]rmol|classic|clasic|piatto|piato|marbela|blanco|blanca|negro|mate|monocomando|agujero|apoyo|encastre|color|sahara|caju|caj[uú]|mezzo|grafito|hormigon|hormig[oó]n|nero|terra|cajon|caj[oó]n|hueco|puerta|colgante|de pie|u[ñn]ero)\b/i;
  if (QUALIFIERS.test(t)) return null;

  if (/\b(vanitor|mueble)/i.test(t)) return "MUEBLES";
  if (/\bbacha/i.test(t)) return "BACHAS";
  if (/\bmesada/i.test(t)) return "MESADAS";
  if (/\b(espejo|botiqu[ií]n)/i.test(t)) return "ESPEJOS Y BOTIQUINES";
  return null;
}

// Pedido de PDF/imagen por lenguaje natural
function detectarPedidoMedia(texto) {
  const q = texto.toLowerCase();
  const esPDF = /\bpdf\b|\bficha\b|\bcatalogo\b|\bcatálogo\b|\bficha tecnica\b/.test(q);
  const esImagen = /\bimagen\b|\bfoto\b|\bfotograf[ií]a\b|\bjpg\b|\bpng\b/.test(q);
  return { esPDF, esImagen, esMedia: esPDF || esImagen };
}

// ═════════════════════════════════════════════════════════════════════════════
// DETECTOR DE VARIANTE DENTRO DE LA CONSULTA
// Ej: "vmini hormigon" → { codigo: "VMINICOLOR", variante: "HORMIGON" }
// ═════════════════════════════════════════════════════════════════════════════
const VARIANTES_CONOCIDAS = ["SAHARA", "CAJU", "GRAFITO", "HORMIGON", "MEZZO", "BLANCO", "NEGRO", "NERO", "TERRA"];

function extraerVariante(texto) {
  const t = texto.toUpperCase();
  // Normalizar acentos
  const norm = t.replace(/Á/g, "A").replace(/É/g, "E").replace(/Í/g, "I").replace(/Ó/g, "O").replace(/Ú/g, "U");
  for (const v of VARIANTES_CONOCIDAS) {
    if (norm.includes(v)) return v;
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// FORMATEADORES — devuelven texto listo para WhatsApp (cuadro visual)
// ═════════════════════════════════════════════════════════════════════════════

function fmtPrecio(n) {
  if (!n || n === 0) return "sin precio cargado";
  return "$" + Number(n).toLocaleString("es-AR");
}

function fmtStockVariantes(stock_variantes, soloVariante = null) {
  if (!stock_variantes || Object.keys(stock_variantes).length === 0) return "sin stock cargado";

  // Filtrar el depósito único "DEPOSITO" → solo mostramos "Stock: N"
  const entries = Object.entries(stock_variantes);
  const sumUnico = entries.length === 1 && entries[0][0] === "DEPOSITO";

  if (sumUnico) {
    return `Stock: ${entries[0][1].stock ?? 0}`;
  }

  // Si el user pidió una variante puntual
  if (soloVariante) {
    const v = stock_variantes[soloVariante];
    if (!v) return `${soloVariante}: sin stock cargado`;
    return `Stock ${soloVariante}: ${v.stock ?? 0}`;
  }

  // Desagregado por variante
  const lineas = entries
    .filter(([k, v]) => k !== "DEPOSITO")
    .map(([k, v]) => `  ${k}: ${v.stock ?? 0}`);
  const total = entries.reduce((acc, [k, v]) => acc + (v.stock || 0), 0);
  return "Stock por variante:\n" + lineas.join("\n") + `\n  Total: ${total}`;
}

// Modo 1 — código exacto
function formatearCodigoExacto(prod, varianteSolicitada = null) {
  if (prod.error) return null;
  const linea1 = `*${prod.codigo}* — ${prod.nombre}`;
  const linea2 = fmtPrecio(prod.precio_madre) + " (lista madre)";
  const stockTxt = fmtStockVariantes(prod.stock_variantes, varianteSolicitada);
  return `${linea1}\n${linea2}\n${stockTxt}`;
}

// Modo 2 — varios productos matcheados (tabla compacta, una sola línea de stock por producto)
function fmtStockInline(stock_variantes) {
  if (!stock_variantes || Object.keys(stock_variantes).length === 0) return "sin stock";
  const entries = Object.entries(stock_variantes);
  const unico = entries.length === 1 && entries[0][0] === "DEPOSITO";
  if (unico) return `Stock: ${entries[0][1].stock ?? 0}`;
  const partes = entries
    .filter(([k]) => k !== "DEPOSITO")
    .map(([k, v]) => `${k} ${v.stock ?? 0}`);
  const total = entries.reduce((acc, [k, v]) => acc + (v.stock || 0), 0);
  return `Stock: ${partes.join(" · ")} (total ${total})`;
}

function formatearLista(resultados, limit = 8) {
  if (!resultados || resultados.length === 0) return null;
  const lista = resultados.slice(0, limit);
  return lista.map(p => {
    // Mostrar "linea" (piatto/marbela/classic) SOLO en muebles.
    // En bachas/mesadas/espejos es ruido (son marcados como "piatto" por tema de matching dimensional).
    const mostrarLinea = p.categoria === "vanitory" && p.linea;
    const linea = mostrarLinea ? ` ${p.linea}` : "";
    const medida = p.medida ? ` (${p.medida}cm)` : "";
    const l1 = `• *${p.codigo}*${medida}${linea} — ${fmtPrecio(p.precio_madre)}`;
    const l2 = `  ${fmtStockInline(p.stock_variantes)}`;
    return `${l1}\n${l2}`;
  }).join("\n");
}

// Lista SIMPLE: solo código + stock (sin precio, sin medida). Para Modo 3 / rubro completo.
function formatearListaSimple(productos, limit = 30) {
  if (!productos || productos.length === 0) return null;
  return productos.slice(0, limit).map(p =>
    `• *${p.codigo}* — ${fmtStockInline(p.stock_variantes)}`
  ).join("\n");
}

// Modo 3 — rubro genérico
function resumenRubro(rubro) {
  const subrubros = navRubros.obtenerSubrubros(rubro) || [];
  const conteo = subrubros.map(s => {
    const prods = navRubros.obtenerProductos(rubro, s.nombre) || [];
    return `${s.nombre.replace(/^VANITORY /, "")} ${prods.length}`;
  });
  const total = subrubros.reduce((acc, s) => acc + (navRubros.obtenerProductos(rubro, s.nombre) || []).length, 0);
  return { total, detalle: conteo.join(" · ") };
}

// ═════════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT
// ═════════════════════════════════════════════════════════════════════════════

function construirSystemPrompt(usuario, saludar, infoBusqueda) {
  const nombreSimple = (usuario?.nombre || "").split(" ")[0] || "";
  const instruccionSaludo = saludar
    ? `Es la primera consulta del día de ${nombreSimple}. Arrancá con "Hola ${nombreSimple}," y después respondé.`
    : `NO saludes. Respondé directo con la info.`;

  return `Sos la herramienta interna de MH Amoblamientos. Tu rol es responder rápido sobre STOCK, PRECIO (lista madre) y CATÁLOGO a los empleados.

ESTILO:
- Cálido tipo compañero de trabajo, pero conciso. Nada de formalidad excesiva.
- Respuestas de 2-8 líneas. Nunca párrafos largos.
- Sin emojis decorativos.
- ${instruccionSaludo}

REGLA DE ORO (anti-alucinación):
- NUNCA inventes códigos, colores, medidas, stock ni precios.
- Solo usás los datos de la sección INFO que te paso abajo.
- Solo decís "no tengo ese dato cargado" si INFO comienza literalmente con "MODO: sin match" o dice que no hay datos. Si INFO te trae productos formateados (con código, precio, stock), los tenés que mostrar.

CÓMO RESPONDER SEGÚN EL MODO DE INFO:
- MODO: match directo → copiá la info tal cual, sin cambios.
- MODO: lista de productos → copiá la lista tal cual, NO pidas al usuario que elija uno, NO la resumas.
- MODO: demasiados matches → mostrá el preview y pedile que filtre por medida/color.
- MODO: sin match → decí que no encontraste y pedí más detalle.
- MODO: código exacto → copiá el cuadro tal cual.

REGLAS GENERALES:
- No agregues comentarios tipo "te paso el dato" o "avisame si necesitás algo más".
- Nunca sumarices el stock en total único si hay variantes — mostralas desagregadas (ya viene así en INFO).

CATÁLOGO ACTIVO: 77 productos de baño
• Muebles (43): Piatto 36, Marbela 4, Classic 3
• Bachas (11): loza 8, sintético 3
• Mesadas (18): loza, sintética, laminado
• Espejos y botiquines (5)

Colores válidos:
• Piatto: BLANCO + CAJU/GRAFITO/HORMIGON/MEZZO/SAHARA
• Marbela: NERO o TERRA (nunca mezclar con Piatto)
• Classic: solo BLANCO
• Bachas/Mesadas: BLANCO (algunas mesadas NEGRO MATE)

INFO (la respuesta real):
${infoBusqueda}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// COMANDOS ADMIN
// ═════════════════════════════════════════════════════════════════════════════

function ejecutarComandoAdmin(numeroOrigen, cmd) {
  if (!usuariosMgr.esAdmin(numeroOrigen)) {
    return `No tenés permisos para ese comando.`;
  }

  switch (cmd.cmd) {
    case "/agregar":
    case "/add": {
      const numero = cmd.args[0];
      const nombre = cmd.args.slice(1).join(" ");
      if (!numero || !nombre) return `Uso: /agregar <numero> <nombre>\nEjemplo: /agregar 5491122334455 Leo`;
      const r = usuariosMgr.agregarUsuario(numero, nombre);
      if (!r.ok) return `❌ ${r.error}`;
      return `✅ Agregado: ${nombre} (${usuariosMgr.normalizarNumero(numero)}).\n⚠️ Temporal: se borra en el próximo deploy. Para permanente, editá el código.`;
    }

    case "/quitar":
    case "/remove": {
      const numero = cmd.args[0];
      if (!numero) return `Uso: /quitar <numero>`;
      const r = usuariosMgr.quitarUsuario(numero);
      if (!r.ok) return `❌ ${r.error}`;
      return `✅ Quitado: ${usuariosMgr.normalizarNumero(numero)}`;
    }

    case "/usuarios":
    case "/list":
    case "/lista": {
      const l = usuariosMgr.listarUsuarios();
      let out = "*Usuarios fijos:*\n";
      l.fijos.forEach(u => {
        out += `• ${u.nombre} — ${u.numero}${u.admin ? " (admin)" : ""}\n`;
      });
      if (l.extras.length) {
        out += "\n*Extras (temporales):*\n";
        l.extras.forEach(u => {
          out += `• ${u.nombre} — ${u.numero}\n`;
        });
      } else {
        out += "\n(sin extras cargados)";
      }
      return out;
    }

    case "/help":
    case "/ayuda":
      return "Comandos admin:\n/agregar <num> <nombre>\n/quitar <num>\n/usuarios\n/ayuda";

    default:
      return `Comando desconocido. Mandá /ayuda para ver la lista.`;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PROCESAR MENSAJE (CORE)
// ═════════════════════════════════════════════════════════════════════════════

async function procesarMensaje(numero, texto, mediaUrl) {
  const limpio = usuariosMgr.normalizarNumero(numero);

  // ── Transcribir audio si vino ──
  if (mediaUrl && !texto) {
    const transcrito = await transcribirAudio(mediaUrl);
    if (!transcrito) return { texto: "No pude entender el audio, probá de nuevo o escribilo.", media: null };
    texto = corregirTranscripcion(transcrito);
    console.log(`🎤 Audio → "${texto}"`);
  }

  if (!texto || !texto.trim()) return null;

  const mensaje = texto.trim();
  const usuario = usuariosMgr.obtenerUsuario(limpio);

  // ── Rechazar no-internos ──
  if (!usuario) {
    console.log(`🚫 Acceso denegado: ${limpio}`);
    return {
      texto: "Esta es una herramienta interna de MH Amoblamientos.\nPara consultas contactanos al 11-4460-4224 o visitá Av. Presidente Perón 3048, Haedo.",
      media: null
    };
  }

  // ── Módulo de gastos personales (solo admin, prefijo "gasto") ──
  if (usuariosMgr.esAdmin(limpio) && detectorGastos.esGasto(mensaje)) {
    console.log(`💸 Gasto detectado de ${limpio}`);
    const resp = await procesadorGastos.procesarGasto(mensaje);
    memoria.registrarMensaje(limpio, "user", mensaje);
    memoria.registrarMensaje(limpio, "assistant", resp);
    return { texto: resp, media: null };
  }

  // ── Comandos admin ──
  const cmdAdmin = detectarComandoAdmin(mensaje);
  if (cmdAdmin) {
    const resp = ejecutarComandoAdmin(limpio, cmdAdmin);
    memoria.registrarMensaje(limpio, "user", mensaje);
    memoria.registrarMensaje(limpio, "assistant", resp);
    return { texto: resp, media: null };
  }

  // ── Pedido de PDF/imagen ──
  const pedidoMedia = detectarPedidoMedia(mensaje);
  if (pedidoMedia.esMedia) {
    // 1. Ver si hay código EN el mismo mensaje (ej "catalogo de vminib")
    let codigoMedia = extraerCodigo(mensaje);
    // 2. Si no, fallback al último producto consultado
    if (!codigoMedia) {
      const mem = memoria.cargarMemoria(limpio);
      codigoMedia = mem.contexto?.ultimo_producto;
    }

    if (!codigoMedia) {
      const r = "¿De qué producto querés el PDF/foto? Decime el código o consultá primero el producto.";
      memoria.registrarMensaje(limpio, "user", mensaje);
      memoria.registrarMensaje(limpio, "assistant", r);
      return { texto: r, media: null };
    }

    let archivo = null, tipoMedia = "";
    if (pedidoMedia.esPDF) { archivo = mediaManager.obtenerPDF(codigoMedia); tipoMedia = "PDF"; }
    else if (pedidoMedia.esImagen) { archivo = mediaManager.obtenerImagen(codigoMedia); tipoMedia = "imagen"; }

    memoria.registrarMensaje(limpio, "user", mensaje);

    if (archivo) {
      const ext = path.extname(archivo).toLowerCase();
      const esPDF = ext === ".pdf";

      if (esPDF) {
        // Twilio Sandbox no entrega PDFs bien como adjunto → mandamos link clickeable
        const rel = path.relative(
          path.join(__dirname, "imagenes-y-pdf-para-clientes"),
          archivo
        ).replace(/\\/g, "/");
        const url = `${BASE_URL}/media/${rel}`;
        const respuesta = `📄 Ficha técnica de *${codigoMedia}*\n${url}`;
        memoria.registrarMensaje(limpio, "assistant", respuesta);
        return { texto: respuesta, media: null };
      } else {
        // Imágenes sí se entregan bien por MMS
        const caption = `🖼️ Imagen de *${codigoMedia}*`;
        memoria.registrarMensaje(limpio, "assistant", caption);
        return { texto: caption, media: archivo };
      }
    } else {
      const r = `No tengo ${tipoMedia} cargado para *${codigoMedia}* todavía.`;
      memoria.registrarMensaje(limpio, "assistant", r);
      return { texto: r, media: null };
    }
  }

  // ── Chequear si es primera consulta del día ANTES de registrar el mensaje ──
  const esPrimera = memoria.esPrimeraVezHoy(limpio);
  const primerNombre = (usuario?.nombre || "").split(" ")[0] || "";
  const saludo = esPrimera && primerNombre ? `Hola ${primerNombre},\n` : "";

  // ── Guardar mensaje ──
  memoria.registrarMensaje(limpio, "user", mensaje);

  // ── Casual replies (hola/gracias/ok) — respuesta instantánea, sin buscador ──
  const casual = /^(hola|holis|buenos? d[ií]as|buenas(?: tardes| noches)?|gracias|ok|dale|listo)[.!?]?$/i;
  if (casual.test(mensaje.trim())) {
    let respuesta;
    if (/^gracias/i.test(mensaje.trim())) {
      respuesta = "👍";
    } else if (/^(ok|dale|listo)/i.test(mensaje.trim())) {
      respuesta = "Dale.";
    } else {
      respuesta = primerNombre
        ? `Hola ${primerNombre}. Consultame por código (ej V60CLAC), descripción (vanitory 60) o rubro (mesadas).`
        : "Hola. Consultame por código, descripción o rubro.";
    }
    memoria.registrarMensaje(limpio, "assistant", respuesta);
    return { texto: respuesta, media: null };
  }

  // ═══ MODO 1 — Código exacto (con fallback a prefijo) ═══
  const codigo = extraerCodigo(mensaje);
  if (codigo) {
    let prod = buscadorBase.buscarPorCodigo(codigo, "baño");

    // Fallback: si no hay match exacto (ej "VMINI" no existe pero sí VMINICOLOR/VMINIB),
    // buscar productos que empiecen con ese código. Si la query tiene una variante
    // (color), priorizar el código que tenga esa variante en stock.
    if (prod.error) {
      const variante = extraerVariante(mensaje);
      const catalogo = require("./palabras-clave-y-detalles/baño.json");
      const candidatos = catalogo
        .map(p => p.codigo)
        .filter(c => c.toUpperCase().startsWith(codigo.toUpperCase()));

      if (variante) {
        // Probar cada candidato y elegir el que tenga esa variante en stock
        for (const c of candidatos) {
          const p = buscadorBase.buscarPorCodigo(c, "baño");
          if (!p.error && p.stock_variantes?.[variante]) {
            prod = p;
            break;
          }
        }
      }
      // Si sigue sin match y hay 1 solo candidato, elegirlo
      if (prod.error && candidatos.length === 1) {
        prod = buscadorBase.buscarPorCodigo(candidatos[0], "baño");
      }
    }

    if (!prod.error) {
      const variante = extraerVariante(mensaje);
      const cuadro = formatearCodigoExacto(prod, variante);
      const respuesta = saludo + cuadro;
      memoria.registrarMensaje(limpio, "assistant", respuesta);
      memoria.actualizarContexto(limpio, { producto: prod.codigo });
      return { texto: respuesta, media: null };
    }
  }

  // ═══ MODO 3 — Rubro solo (lista directa, sin preguntar) ═══
  const rubroSolo = detectarRubroSolo(mensaje);
  if (rubroSolo) {
    const subrubros = navRubros.obtenerSubrubros(rubroSolo) || [];
    const codigos = [];
    subrubros.forEach(s => {
      const prods = navRubros.obtenerProductos(rubroSolo, s.nombre) || [];
      prods.forEach(c => codigos.push(c));
    });
    const productos = codigos
      .map(c => buscadorBase.buscarPorCodigo(c, "baño"))
      .filter(p => !p.error);

    if (productos.length === 0) {
      const r = saludo + `No tengo productos cargados en ${rubroSolo}.`;
      memoria.registrarMensaje(limpio, "assistant", r);
      return { texto: r, media: null };
    }
    const lista = formatearListaSimple(productos, 30);
    const respuesta = `${saludo}Rubro: *${rubroSolo}* (${productos.length} productos)\n${lista}`;
    memoria.registrarMensaje(limpio, "assistant", respuesta);
    return { texto: respuesta, media: null };
  }

  // ═══ MODO 2 — Semi-específico ═══
  const resultado = buscadorCtx.buscarConContexto(limpio, mensaje, {
    seccion: "baño",
    perfil: "interno",
    limit: 15
  });

  // Filtro por categoría: si la query menciona explícitamente un tipo de producto,
  // descartar resultados de otras categorías. Evita que "mesadas de loza" traiga
  // vanitorys Marbela que tienen keyword 'mesada integrada'.
  if (resultado && resultado.resultados && resultado.resultados.length > 0) {
    const q = mensaje.toLowerCase();
    let categoriaEsperada = null;
    if (/\bmesada/i.test(q)) categoriaEsperada = "mesada";
    else if (/\bbacha/i.test(q)) categoriaEsperada = "bacha";
    else if (/\b(vanitor|mueble)/i.test(q)) categoriaEsperada = "vanitory";
    else if (/\b(espejo|botiqu[ií]n)/i.test(q)) categoriaEsperada = "espejo";

    if (categoriaEsperada) {
      const filtrados = resultado.resultados.filter(p => p.categoria === categoriaEsperada);
      if (filtrados.length > 0) resultado.resultados = filtrados;
    }
  }

  if (!resultado || !resultado.resultados || resultado.resultados.length === 0) {
    const r = saludo + `No encontré productos con "${mensaje}".\nProbá con un código (ej V60CLAC), rubro (mesadas / bachas / vanitorios) o descripción con medida (vanitory 60, mesada 80).`;
    memoria.registrarMensaje(limpio, "assistant", r);
    return { texto: r, media: null };
  }

  // Si el top match es muy claro (1 o 2 con score alto) → cuadro detallado
  if (resultado.resultados.length === 1 || (resultado.resultados[0].score >= 60 && resultado.resultados.length <= 3)) {
    const cuadros = resultado.resultados.slice(0, 3).map(p => formatearCodigoExacto(p, null)).join("\n\n");
    const respuesta = saludo + cuadros;
    memoria.registrarMensaje(limpio, "assistant", respuesta);
    if (resultado.resultados[0].codigo) {
      memoria.actualizarContexto(limpio, { ultimo_producto: resultado.resultados[0].codigo });
    }
    return { texto: respuesta, media: null };
  }

  // Cantidad razonable → lista con precio
  if (resultado.resultados.length <= 10) {
    const lista = formatearLista(resultado.resultados, 10);
    const respuesta = saludo + lista;
    memoria.registrarMensaje(limpio, "assistant", respuesta);
    return { texto: respuesta, media: null };
  }

  // Demasiados → preview + pedir filtro
  const preview = formatearLista(resultado.resultados.slice(0, 5), 5);
  const respuesta = `${saludo}Encontré ${resultado.resultados.length} productos. Te paso los primeros 5:\n${preview}\n\nFiltrá por medida, color o tipo para ver más.`;
  memoria.registrarMensaje(limpio, "assistant", respuesta);
  return { texto: respuesta, media: null };
}

// ═════════════════════════════════════════════════════════════════════════════
// WEBHOOK TWILIO
// ═════════════════════════════════════════════════════════════════════════════

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

    await enviarMensaje(numero, resultado.texto);

    if (resultado.media) {
      const ext = path.extname(resultado.media).toLowerCase();
      const esPDF = ext === ".pdf";
      await enviarMedia(numero, resultado.media, esPDF ? "📄 Ficha técnica" : "🖼️ Imagen");
    }

    console.log(`✅ → ${numero}: ${resultado.texto.substring(0, 80)}...`);
  } catch (error) {
    console.error(`❌ Error procesando [${numero}]:`, error.message);
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINTS DE SALUD Y DEBUG
// ═════════════════════════════════════════════════════════════════════════════

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
  const usuarios = usuariosMgr.listarUsuarios();
  res.json({
    status: "ok",
    version: VERSION,
    hora: new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }),
    usuarios_fijos: usuarios.fijos.length,
    usuarios_extras: usuarios.extras.length,
    datos_dux: estado
  });
});

app.get("/debug/media", (req, res) => {
  const media = mediaManager.listarTodoElMedia();
  const mapear = (item, tipo) => {
    const rel = path
      .relative(path.join(__dirname, "imagenes-y-pdf-para-clientes"), item.ruta)
      .replace(/\\/g, "/");
    const url = BASE_URL ? `${BASE_URL}/media/${rel}` : `(sin BASE_URL) /media/${rel}`;
    const stat = fs.existsSync(item.ruta) ? fs.statSync(item.ruta) : null;
    return {
      codigo: item.codigo,
      archivo: item.archivo,
      tipo,
      existe: !!stat,
      tamano_kb: stat ? +(stat.size / 1024).toFixed(1) : null,
      url
    };
  };
  res.json({
    base_url: BASE_URL || "(vacío — no se pueden enviar medios)",
    base_url_tiene_https: BASE_URL.startsWith("https://"),
    pdfs: media.pdf.map(m => mapear(m, "pdf")),
    imagenes: media.imagenes.map(m => mapear(m, "imagen"))
  });
});

app.get("/debug/producto/:codigo", (req, res) => {
  const codigo = req.params.codigo;
  const prod = buscadorBase.buscarPorCodigo(codigo, "baño");
  res.json(prod);
});

app.get("/debug/pdf/:codigo", (req, res) => {
  const codigo = req.params.codigo;
  const archivo = mediaManager.obtenerPDF(codigo);
  if (!archivo) {
    return res.status(404).json({
      codigo,
      error: "No se encontró PDF para este código",
      sugerencia: "Probá GET /debug/media para ver los códigos con PDF disponible"
    });
  }
  const rel = path
    .relative(path.join(__dirname, "imagenes-y-pdf-para-clientes"), archivo)
    .replace(/\\/g, "/");
  const url = BASE_URL ? `${BASE_URL}/media/${rel}` : null;
  const stat = fs.statSync(archivo);
  res.json({
    codigo,
    archivo_encontrado: archivo,
    archivo_existe: true,
    tamano_bytes: stat.size,
    tamano_mb: +(stat.size / 1024 / 1024).toFixed(2),
    supera_limite_twilio_5mb: stat.size > 5 * 1024 * 1024,
    url_generada: url,
    url_valida_https: url ? url.startsWith("https://") : false,
    base_url_actual: BASE_URL || "(vacío)"
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// SYNC DUX (cron cada hora)
// ═════════════════════════════════════════════════════════════════════════════

function ejecutarSync() {
  console.log("🔄 Sincronizando Dux...");
  exec("node sincronizacion-automatica/sync-dux.js", { cwd: __dirname, timeout: 300000 }, (err) => {
    if (err) console.error("⚠️ Error sync Dux:", err.message);
    else console.log("✅ Sync Dux completado");
  });
}

setTimeout(ejecutarSync, 5000);
cron.schedule("0 * * * *", ejecutarSync, {
  timezone: "America/Argentina/Buenos_Aires"
});
console.log("⏰ Cron sync programado: cada hora en punto (America/Argentina/Buenos_Aires)");

// ═════════════════════════════════════════════════════════════════════════════
// START SERVER
// ═════════════════════════════════════════════════════════════════════════════

// Solo arrancar el server si este archivo se corre directo (no cuando se require() desde tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀 MH-IA v${VERSION} (herramienta interna)`);
    console.log(`   Puerto: ${PORT}`);
    console.log(`   Base URL: ${BASE_URL || "(vacío)"}`);
    const u = usuariosMgr.listarUsuarios();
    console.log(`   Usuarios: ${u.fijos.length} fijos + ${u.extras.length} extras\n`);
  });
}

// Exports para testing
module.exports = { procesarMensaje };
