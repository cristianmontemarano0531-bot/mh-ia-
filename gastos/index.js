// Orquestador del módulo de gastos.
// Recibe el texto del WhatsApp (ya con el prefijo "gasto"), lo parsea
// con Claude y lo escribe en Google Sheets.

const { quitarPrefijo } = require("./detector.js");
const { parsearGastos } = require("./parser.js");
const { appendGastos, configurado } = require("./sheets-client.js");

function fechaArgentina() {
  const ahora = new Date();
  // Buenos Aires no tiene DST → UTC-3 fijo
  const tzOffsetMs = -3 * 60 * 60 * 1000;
  const local = new Date(ahora.getTime() + tzOffsetMs);
  const yyyy = local.getUTCFullYear();
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mi = String(local.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function fmtMonto(n) {
  return "$" + Number(n).toLocaleString("es-AR");
}

async function procesarGasto(textoCrudo) {
  if (!configurado()) {
    return "⚠️ Módulo de gastos sin configurar. Faltan variables de entorno (GASTOS_SHEET_ID, GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY).";
  }

  const contenido = quitarPrefijo(textoCrudo);
  if (!contenido) {
    return "Mandame el gasto después de la palabra. Ejemplo:\n*gasto:* carniceria 20.000 mercado pago";
  }

  const gastos = await parsearGastos(contenido);
  if (gastos.length === 0) {
    return "No pude entender el gasto. Probá con este formato:\n*gasto:* carniceria 20.000 mercado pago\n\nO varios separados por `;`:\n*gasto:* carniceria 20.000 mercado pago; nafta 15.000";
  }

  const fecha = fechaArgentina();
  const filas = gastos.map(g => [fecha, g.descripcion, g.monto, g.medio_pago]);
  const resultado = await appendGastos(filas);

  if (!resultado.ok) {
    console.error(`❌ Gastos: error escribiendo en Sheets — ${resultado.error}`);
    return `No pude guardar el gasto. Error: ${resultado.error}`;
  }

  // Confirmación
  if (gastos.length === 1) {
    const g = gastos[0];
    const medio = g.medio_pago ? ` — ${g.medio_pago}` : "";
    return `✅ ${g.descripcion} ${fmtMonto(g.monto)}${medio}`;
  }
  const lineas = gastos.map(g => {
    const medio = g.medio_pago ? ` — ${g.medio_pago}` : "";
    return `• ${g.descripcion} ${fmtMonto(g.monto)}${medio}`;
  }).join("\n");
  const total = gastos.reduce((acc, g) => acc + g.monto, 0);
  return `✅ ${gastos.length} gastos cargados:\n${lineas}\n*Total:* ${fmtMonto(total)}`;
}

module.exports = { procesarGasto };
