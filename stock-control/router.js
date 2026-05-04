// Router del módulo de control de stock móvil.
// Se monta como app.use("/control", require("./stock-control/router"))
// — totalmente aislado del flujo del bot de WhatsApp.

const express = require("express");
const path = require("path");
const fs = require("fs");
const sheet = require("./sheet.js");

const router = express.Router();

const STOCK_JSON = path.join(__dirname, "..", "datos-dux", "stock.json");
const PRODUCTOS_JSON = path.join(__dirname, "productos.json");

// Algunos archivos JSON generados en Windows tienen BOM (EF BB BF) al inicio
// y JSON.parse los rechaza con "Unexpected token". Lo strippeamos defensivamente.
function parseJsonSeguro(raw) {
  return JSON.parse(raw.replace(/^﻿/, ""));
}

// Cache en memoria del catálogo de productos (no cambia hasta redeploy).
// Inicializo undefined (no null/[]) así si el primer parse falla podemos reintentar.
let productosCache;
function leerProductos() {
  if (Array.isArray(productosCache) && productosCache.length > 0) return productosCache;
  try {
    const raw = fs.readFileSync(PRODUCTOS_JSON, "utf8");
    productosCache = parseJsonSeguro(raw);
  } catch (e) {
    console.error("[stock-control] no pude leer productos.json:", e.message);
    productosCache = [];
  }
  return productosCache;
}

// Lectura del stock actual: el cron de mh-ia regenera el archivo cada hora.
// Lo leemos cada request para no quedarnos con un snapshot stale.
function leerStock() {
  try {
    const raw = fs.readFileSync(STOCK_JSON, "utf8");
    return parseJsonSeguro(raw);
  } catch (e) {
    console.warn("[stock-control] no pude leer stock.json:", e.message);
    return {};
  }
}

// Devuelve el stock real para una variante, o null si no hay dato.
function stockDeVariante(stock, codigo, color) {
  const item = stock[codigo];
  if (!item) return null;
  if (color) {
    const v = item.variantes && item.variantes[color.toUpperCase()];
    return v ? Number(v.stockReal) || 0 : null;
  }
  // Sin color: tomamos el stockTotal precalculado por la sync.
  return typeof item.stockTotal === "number" ? item.stockTotal : null;
}

// ─────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────

// GET /control/api/productos — catálogo enriquecido con stock actual.
// Devuelve [{codigo, producto, color, talle, rubro, subrubro, stock}].
router.get("/api/productos", (_req, res) => {
  try {
    const productos = leerProductos();
    const stock = leerStock();
    const enriquecido = productos.map(p => ({
      ...p,
      stock: stockDeVariante(stock, p.codigo, p.color)
    }));
    res.json({ ok: true, productos: enriquecido, total: enriquecido.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /control/api/health — diagnóstico rápido.
router.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    productos: leerProductos().length,
    stockArchivo: fs.existsSync(STOCK_JSON),
    sheetConfigurado: sheet.configurado()
  });
});

// POST /control/api/movimientos — recibe los movimientos confirmados y los
// agrega como filas en la pestaña Movimientos del Google Sheet.
// Body: { operario: string, items: [{codigo, color, talle, producto, qty}] }
//   - qty positivo => INGRESO, negativo => EGRESO. qty=0 se ignora.
//     (Esos términos los entiende Dux para importación de movimientos.)
router.post("/api/movimientos", express.json(), async (req, res) => {
  try {
    const { operario, items } = req.body || {};
    if (!operario || typeof operario !== "string") {
      return res.status(400).json({ ok: false, error: "Falta 'operario'" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "Falta 'items' o vacío" });
    }

    const validos = items.filter(it => it && it.codigo && Number(it.qty) !== 0);
    if (validos.length === 0) {
      return res.status(400).json({ ok: false, error: "No hay movimientos con cantidad distinta de cero" });
    }

    // Timestamp en zona Argentina, formato amigable para el Sheet.
    const ahora = new Date();
    const fechaHora = ahora.toLocaleString("es-AR", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false
    });
    // ID de carga corto: agrupa todas las filas que se confirmaron juntas.
    const idCarga = ahora.getTime().toString(36).slice(-6).toUpperCase();

    const filas = validos.map(it => {
      const qty = Number(it.qty);
      const tipo = qty > 0 ? "INGRESO" : "EGRESO";
      return [
        fechaHora,
        operario,
        tipo,
        it.codigo,
        it.producto || "",
        it.color || "",
        it.talle || "",
        Math.abs(qty),
        idCarga
      ];
    });

    const r = await sheet.appendMovimientos(filas);
    if (!r.ok) {
      return res.status(500).json({ ok: false, error: r.error });
    }
    res.json({ ok: true, filasAgregadas: r.filasAgregadas, idCarga });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Frontend estático: GET /control sirve public/index.html
// ─────────────────────────────────────────────────────────────────────
router.use(express.static(path.join(__dirname, "public")));

module.exports = router;
