require("dotenv").config({ path: "./config/.env.local" });
const express = require("express");
const cron = require("node-cron");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

// ─── CREAR CARPETAS SI NO EXISTEN (importante en Railway) ─────────────────────
["datos-dux", "memoria-de-clientes", "registros"].forEach(dir => {
  if (!fs.existsSync(path.join(__dirname, dir))) {
    fs.mkdirSync(path.join(__dirname, dir), { recursive: true });
  }
});

const buscadorCtx = require("./buscador/buscador-con-contexto.js");
const memoria = require("./memoria-de-clientes/memoria-manager.js");

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

// ─── PERFILES INTERNOS ────────────────────────────────────────────────────────
const USUARIOS_INTERNOS = {
  "5491149460531": { nombre: "Cristian", perfil: "interno" },
  "5491165005095": { nombre: "MH Fábrica", perfil: "interno" },
  "5491139042568": { nombre: "Vendedor 1", perfil: "interno" }
};

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
  return { nombre: mem.nombre || "Cliente", perfil: "externo", numero: limpio };
}

// ─── TRANSCRIBIR AUDIO ────────────────────────────────────────────────────────
async function transcribirAudio(mediaUrl) {
  if (!OPENAI_API_KEY || !mediaUrl) return null;
  try {
    const audioRes = await fetch(mediaUrl, {
      headers: {
        "Authorization": "Basic " + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")
      }
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

// ─── ALERTAR EQUIPO INTERNO ───────────────────────────────────────────────────
async function alertarEquipo(numero, nombre, mensaje) {
  const alerta = `⚠️ *Consulta externa*\n📱 +${numero}\n👤 ${nombre}\n💬 ${mensaje.substring(0, 100)}`;
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

// ─── FORMATEAR RESULTADOS DE BÚSQUEDA ────────────────────────────────────────
function formatearBusqueda(resultado, perfil) {
  if (!resultado || resultado.resultados.length === 0) {
    return "Sin resultados para esta búsqueda.";
  }
  const lines = [];
  resultado.resultados.slice(0, 3).forEach((p, i) => {
    lines.push(`[Resultado ${i + 1}] ${p.codigo} — ${p.nombre}`);
    if (p.medida) lines.push(`Medida: ${p.medida}cm | Guardado: ${p.guardado || "N/A"}`);
    if (p.colores?.length) lines.push(`Colores: ${p.colores.join(", ")}`);

    if (perfil === "interno") {
      const vars = Object.entries(p.stock_variantes || {})
        .map(([k, v]) => `${k}:${v.stock}`).join(", ");
      lines.push(`Stock: ${p.stock_total} uds | ${vars || "sin variantes"}`);
      lines.push(`Lista Madre: $${p.precio_madre} | May1: $${p.precio_may1} | May2: $${p.precio_may2}`);
    } else if (perfil === "pdv") {
      lines.push(`Disponibilidad: ${p.stock_total > 0 ? "En stock" : "Sin stock"}`);
      lines.push(`Precio público: $${p.precio_madre}`);
    } else {
      lines.push(`Disponibilidad: ${p.stock_total > 0 ? "Disponible" : "Consultar"}`);
      lines.push(`Precio: $${p.precio_madre}`);
    }
    lines.push("");
  });
  return lines.join("\n").trim();
}

// ─── PROCESAR MENSAJE ─────────────────────────────────────────────────────────
async function procesarMensaje(numero, texto, mediaUrl = null) {
  const perfil = await obtenerPerfil(numero);
  let mensajeTexto = texto;

  // Audio → texto
  if (mediaUrl && (!texto || !texto.trim())) {
    console.log(`🎤 Transcribiendo audio de ${numero}...`);
    const transcripcion = await transcribirAudio(mediaUrl);
    if (transcripcion) {
      mensajeTexto = transcripcion;
      console.log(`📝 "${transcripcion}"`);
    } else {
      return "No pude escuchar el audio. ¿Podés escribirme?";
    }
  }

  if (!mensajeTexto?.trim()) return null;

  // Guardar en memoria
  memoria.registrarMensaje(numero, "user", mensajeTexto);

  // Determinar sección
  const q = mensajeTexto.toLowerCase();
  let seccion = "baño";
  if (perfil.perfil === "interno") {
    if (q.includes("en cocina") || q.includes("alacena") || q.includes("bajo mesada")) seccion = "cocina";
    else if (q.includes("en placard") || q.includes("modulo placard")) seccion = "placard";
  }

  // Buscar en catálogo + enriquecer con datos Dux
  const resultado = buscadorCtx.buscarConContexto(numero, mensajeTexto, {
    seccion,
    perfil: perfil.perfil,
    limit: 3
  });

  const infoBusqueda = formatearBusqueda(resultado, perfil.perfil);

  // Alerta si externo pregunta por stock
  if (perfil.perfil === "externo" &&
    (q.includes("stock") || q.includes("disponib") || q.includes("cuantos") || q.includes("cuántos"))) {
    await alertarEquipo(numero, perfil.nombre, mensajeTexto);
  }

  const resumenMem = memoria.resumenCliente(numero);
  const historial = memoria.obtenerHistorialClaude(numero).slice(-8);

  const systemPrompt = `Sos el asistente de ventas de MH Amoblamientos, fábrica argentina de muebles de baño (vanitorys, bachas, mesadas, espejos). Atendés por WhatsApp de forma concisa y amigable. Respondés siempre en español rioplatense.

${resumenMem}

PERFIL: ${perfil.perfil}${perfil.nombre ? ` | Nombre: ${perfil.nombre}` : ""}
${perfil.perfil === "interno" ? "→ Equipo interno: mostrá stock exacto por color y todas las listas de precios." : ""}
${perfil.perfil === "pdv" ? "→ Revendedor PDV: mostrá precio público Lista Madre. Al final preguntá: '¿Querés ver tu precio de compra?'" : ""}
${perfil.perfil === "externo" ? "→ Consumidor final: mostrá solo precio Lista Madre. Si pregunta stock decí: 'Derivo tu consulta al equipo, te contactan pronto.'" : ""}

DATOS DE LA BASE (actualizados desde Dux):
${infoBusqueda}

REGLAS:
- Usá solo los datos de arriba. No inventes precios ni stock.
- Si hay un resultado claro, respondé directo con los datos.
- Si hay varios resultados similares, listá los 2-3 más relevantes.
- Si no hay datos, pedí más detalle: medida, color o tipo de producto.
- Máximo 5 líneas de respuesta.`;

  try {
    const respuesta = await llamarClaude(historial, systemPrompt);
    memoria.registrarMensaje(numero, "assistant", respuesta);
    return respuesta;
  } catch (error) {
    console.error("Error Claude:", error.message);
    return "Hubo un error procesando tu consulta. Intentá de nuevo en unos segundos.";
  }
}

// ─── WEBHOOK TWILIO ───────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.status(200).send("");
  const numero = (req.body.From || "").replace("whatsapp:+", "");
  const texto = req.body.Body || "";
  const mediaUrl = req.body.MediaUrl0 || null;

  if (!numero) return;
  console.log(`📩 [${numero}] ${texto || "(audio)"}`);

  try {
    const respuesta = await procesarMensaje(numero, texto, mediaUrl);
    if (respuesta) {
      await enviarMensaje(numero, respuesta);
      console.log(`✅ → ${numero}: ${respuesta.substring(0, 80)}...`);
    }
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
      estado[f] = {
        ok: true,
        kb: (stat.size / 1024).toFixed(1),
        modificado: stat.mtime.toLocaleString("es-AR")
      };
    } else {
      estado[f] = { ok: false };
    }
  });
  res.json({
    status: "ok",
    version: "2.0",
    hora: new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }),
    datos_dux: estado
  });
});

// ─── SYNC DUX (no bloquea el servidor) ───────────────────────────────────────
function ejecutarSync() {
  console.log("🔄 Sincronizando Dux...");
  exec(
    "node sincronizacion-automatica/sync-dux.js",
    { cwd: __dirname, timeout: 300000 },
    (err) => {
      if (err) console.error("⚠️ Error sync Dux:", err.message);
      else console.log("✅ Sync Dux completado");
    }
  );
}

// Sync al arrancar (en background, no bloquea)
setTimeout(ejecutarSync, 5000);

// Sync cada hora
cron.schedule("0 * * * *", () => {
  console.log("⏰ Cron: sync Dux...");
  ejecutarSync();
});

// ─── ARRANCAR SERVIDOR ────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 MH Amoblamientos IA v2.0`);
  console.log(`📡 Puerto: ${PORT}`);
  console.log(`📱 Webhook: POST /webhook`);
  console.log(`🔄 Sync Dux: al arrancar + cada hora\n`);
});
