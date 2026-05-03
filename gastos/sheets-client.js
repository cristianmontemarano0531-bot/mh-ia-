// Cliente mínimo de Google Sheets (REST API + service account JWT).
// No usa la librería googleapis para no agregar una dependencia pesada
// (mismo enfoque del resto del repo: fetch crudo).
//
// Variables de entorno requeridas:
//   GASTOS_SHEET_ID            — ID de la planilla (de la URL)
//   GOOGLE_SA_EMAIL            — email del service account
//   GOOGLE_SA_PRIVATE_KEY      — private key del JSON, con \n literales
//   GASTOS_SHEET_TAB           — opcional, default "Gastos"

const crypto = require("crypto");

const SHEET_ID = process.env.GASTOS_SHEET_ID;
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL;
const SA_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
const TAB = process.env.GASTOS_SHEET_TAB || "Gastos";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

// Cache del access token entre llamadas (válido 1h, lo renovamos a los 50 min)
let cachedToken = null;
let cachedTokenExp = 0;

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

// Agrega una o más filas a la planilla. Cada fila: [fecha, descripcion, monto, medio_pago].
// Devuelve { ok, filasAgregadas, error? }.
async function appendGastos(filas) {
  if (!configurado()) {
    return { ok: false, error: "Google Sheets no configurado (faltan variables de entorno)" };
  }
  if (!Array.isArray(filas) || filas.length === 0) {
    return { ok: false, error: "Sin filas para agregar" };
  }

  try {
    const token = await obtenerAccessToken();
    const range = encodeURIComponent(`${TAB}!A:D`);
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

module.exports = { appendGastos, configurado };
