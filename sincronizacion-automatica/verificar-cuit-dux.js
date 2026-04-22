require("dotenv").config({ path: "../config/.env.local" });

const DUX_TOKEN = process.env.DUX_TOKEN;
const DUX_BASE = "https://erp.duxsoftware.com.ar/WSERP/rest/services";

// ─── VERIFICAR CUIT EN DUX VÍA HISTORIAL DE COBROS ───────────────────────────
// Busca el CUIT en los cobros de los últimos 2 años para confirmar que es cliente
async function verificarCuitEnDux(cuit) {
  if (!DUX_TOKEN || !cuit) return { verificado: false, motivo: "sin token o CUIT" };

  const cuitLimpio = cuit.replace(/[^\d]/g, "");
  if (cuitLimpio.length < 7) return { verificado: false, motivo: "CUIT/DNI muy corto" };

  const hoy = new Date();
  const hace2anos = new Date(hoy);
  hace2anos.setFullYear(hace2anos.getFullYear() - 2);

  const formatFecha = (d) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

  const fechaDesde = formatFecha(hace2anos);
  const fechaHasta = formatFecha(hoy);

  const url = `${DUX_BASE}/cobros?idEmpresa=6121&idSucursal=1&cuit=${cuitLimpio}&limit=1&fechaDesde=${fechaDesde}&fechaHasta=${fechaHasta}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: DUX_TOKEN },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) return { verificado: false, motivo: `HTTP ${res.status}` };

    const data = await res.json();

    if (data.cobros && data.cobros.length > 0) {
      const cobro = data.cobros[0];
      const cliente = cobro.detalles_cliente || {};
      return {
        verificado: true,
        nombre_dux: cliente.apellido_razon_soc || null,
        id_cliente: cliente.id_cliente || null,
        cuit: cuitLimpio
      };
    }

    return { verificado: false, motivo: "no encontrado en cobros", cuit: cuitLimpio };
  } catch (e) {
    console.error("Error verificando CUIT en Dux:", e.message);
    return { verificado: false, motivo: e.message };
  }
}

module.exports = { verificarCuitEnDux };
