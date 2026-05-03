// Convierte texto libre en una lista de gastos estructurados usando Claude.
// Soporta múltiples gastos en un mismo mensaje (separados por ; o frases).
// Devuelve [] si no logra extraer nada.

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `Sos un parser de gastos personales en español rioplatense.
Recibís texto libre y devolvés un JSON con la lista de gastos detectados.

FORMATO DE RESPUESTA (estricto, solo JSON, sin markdown ni texto extra):
{"gastos":[{"descripcion":"...","monto":12345,"medio_pago":"..."}]}

REGLAS:
- "monto" es un número entero en pesos argentinos. Convertí "20.000" / "20mil" / "20k" / "20 mil" → 20000.
- "descripcion" es lo que se compró o el comercio (ej "carniceria", "ropa puma", "desayuno ypf"). Capitalizá la primera letra.
- "medio_pago" normalizado: usá exactamente uno de estos valores cuando se mencione:
  • "Mercado Pago"
  • "Caja de Ahorro"
  • "Cuenta Corriente"
  • "Efectivo"
  • "Tarjeta Crédito"
  • "Tarjeta Débito"
  • "Transferencia"
  Si no se menciona el medio de pago, dejá medio_pago como cadena vacía "".
- Si en un mismo mensaje hay varios gastos separados por ";" o "y", devolvé uno por cada uno.
- Si no podés identificar al menos descripción + monto, devolvé {"gastos":[]}.

EJEMPLO ENTRADA: "carniceria 20.000 mercado pago; ropa puma 50.000 caja de ahorro; desayuno ypf 15.000"
EJEMPLO SALIDA: {"gastos":[{"descripcion":"Carniceria","monto":20000,"medio_pago":"Mercado Pago"},{"descripcion":"Ropa Puma","monto":50000,"medio_pago":"Caja de Ahorro"},{"descripcion":"Desayuno YPF","monto":15000,"medio_pago":""}]}`;

async function parsearGastos(texto) {
  if (!ANTHROPIC_API_KEY) {
    console.error("⚠️ Gastos: ANTHROPIC_API_KEY no configurada");
    return [];
  }
  if (!texto || !texto.trim()) return [];

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: texto }]
      })
    });
    const data = await res.json();
    const raw = data?.content?.[0]?.text || "";

    // Claude a veces envuelve en ```json ... ``` aunque le digamos que no
    const limpio = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(limpio);
    const lista = Array.isArray(parsed?.gastos) ? parsed.gastos : [];

    return lista
      .filter(g => g && g.descripcion && Number.isFinite(Number(g.monto)) && Number(g.monto) > 0)
      .map(g => ({
        descripcion: String(g.descripcion).trim(),
        monto: Math.round(Number(g.monto)),
        medio_pago: String(g.medio_pago || "").trim()
      }));
  } catch (e) {
    console.error("Error parseando gastos:", e.message);
    return [];
  }
}

module.exports = { parsearGastos };
