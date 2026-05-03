// Cliente de Google Sheets para el módulo de control de stock.
// Mismo enfoque que gastos/sheets-client.js: REST + JWT firmado a mano,
// sin librería googleapis (evitamos sumar deps al package.json).
//
// Variables de entorno requeridas:
//   STOCK_SHEET_ID         — ID de la planilla (de la URL)
//   GOOGLE_SA_EMAIL        — email del service account (mismo que gastos)
//   GOOGLE_SA_PRIVATE_KEY  — private key del JSON, con \n literales (mismo que gastos)
//   STOCK_SHEET_TAB        — opcional, default "Movimientos"

const crypto = require("crypto");

const SHEET_ID = process.env.STOCK_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
const SA_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const TAB = process.env.STOCK_SHEET_TAB || "Movimientos";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// Cabecera esperada en la pestaña Movimientos.
// Si la primera fila está vacía, la insertamos automáticamente al primer append.
const HEADER = [
  "Fecha/Hora",
  "Operario",
  "Tipo",
  "Código Producto",
  "Producto",
  "Color",
  "Talle",
  "Cantidad",
  "ID Carga"
];

let cachedToken = null;
let cachedTokenExp = 0;
let headerVerificado = false;

function configurado() {
  return !!(SHEET_ID && SA_EMAIL && SA_KEY);
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function obtenerAccessToken() {
  const ahora = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExp - 60 > ahora) return cachedToken;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: SA_EMAIL,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: ahora,
    exp: ahora + 3000
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(SA_KEY);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth fallido: ${JSON.stringify(data)}`);
  }
  cachedToken = data.access_token;
  cachedTokenExp = ahora + (data.expires_in || 3600);
  return cachedToken;
}

// Asegura que la fila 1 tenga las cabeceras. Solo se ejecuta una vez por cold-start.
async function asegurarCabecera(token) {
  if (headerVerificado) return;
  const range = encodeURIComponent(`${TAB}!A1:I1`);
  const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
  const r = await fetch(getUrl, { headers: { "Authorization": `Bearer ${token}` } });
  const data = await r.json();
  if (!r.ok) {
    throw new Error(`Error leyendo cabecera: ${data?.error?.message || r.status}`);
  }
  const filaActual = (data.values && data.values[0]) || [];
  const yaTiene = filaActual.length >= HEADER.length &&
                  HEADER.every((h, i) => (filaActual[i] || "").trim() === h);
  if (!yaTiene) {
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;
    const u = await fetch(updateUrl, {
      method: "PUT",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [HEADER] })
    });
    if (!u.ok) {
      const ed = await u.json().catch(() => ({}));
      throw new Error(`Error escribiendo cabecera: ${ed?.error?.message || u.status}`);
    }
  }
  headerVerificado = true;
}

// Agrega filas a la pestaña Movimientos.
// Cada fila: [fechaHora, operario, tipo, codigo, producto, color, talle, cantidad, idCarga]
async function appendMovimientos(filas) {
  if (!configurado()) {
    return { ok: false, error: "Google Sheets no configurado (faltan STOCK_SHEET_ID, GOOGLE_SA_EMAIL o GOOGLE_SA_PRIVATE_KEY)" };
  }
  if (!Array.isArray(filas) || filas.length === 0) {
    return { ok: false, error: "Sin filas para agregar" };
  }

  try {
    const token = await obtenerAccessToken();
    await asegurarCabecera(token);

    const range = encodeURIComponent(`${TAB}!A:I`);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ values: filas })
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, error: `Sheets API error: ${data?.error?.message || res.status}` };
    }
    return { ok: true, filasAgregadas: filas.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { appendMovimientos, configurado };
