// Detecta si un mensaje empieza con el prefijo "gasto" / "gastos".
// El prefijo es la única forma de activar este flujo, así no choca con
// consultas de stock que pueden tener montos y palabras parecidas.

const PREFIJO = /^gastos?\b\s*[:\-]?\s*/i;

function esGasto(texto) {
  if (!texto) return false;
  return PREFIJO.test(texto.trim());
}

// Saca el prefijo y devuelve solo el contenido a parsear.
// "gasto: carniceria 20.000 mercado pago" → "carniceria 20.000 mercado pago"
function quitarPrefijo(texto) {
  return String(texto || "").trim().replace(PREFIJO, "").trim();
}

module.exports = { esGasto, quitarPrefijo };
