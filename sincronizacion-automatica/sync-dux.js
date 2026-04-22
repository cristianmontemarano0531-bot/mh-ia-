const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../config/.env.local") });

const DUX_TOKEN = process.env.DUX_TOKEN;
const DUX_BASE = process.env.DUX_BASE || "https://erp.duxsoftware.com.ar/WSERP/rest/services";

const DATA_DIR = path.join(__dirname, "../datos-dux");
const LOG_FILE = path.join(__dirname, "../registros/sync.log");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(LOG_FILE))) fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

function log(mensaje) {
  const timestamp = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  const linea = `[${timestamp}] ${mensaje}`;
  console.log(linea);
  fs.appendFileSync(LOG_FILE, linea + "\n");
}

function esperar(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchConReintento(url, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "Authorization": DUX_TOKEN,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      });

      if (res.status === 429) {
        log(`⚠️  Rate limit (429). Intento ${i + 1}/${intentos}. Esperando 7s...`);
        await esperar(7000);
        continue;
      }

      if (!res.ok) {
        log(`❌ Error ${res.status} en: ${url}`);
        return null;
      }

      return await res.json();
    } catch (error) {
      log(`❌ Error en fetch (intento ${i + 1}/${intentos}): ${error.message}`);
      if (i < intentos - 1) await esperar(3000);
    }
  }
  return null;
}

async function descargarTodosLosItems() {
  log("📦 Descargando todos los items de Dux (productos + stock + precios)...");
  const items = [];
  let offset = 0;
  const limit = 50;
  let pagina = 1;

  while (true) {
    const url = `${DUX_BASE}/items?limit=${limit}&offset=${offset}&habilitado=SI`;
    log(`  Página ${pagina}: offset=${offset}`);

    const data = await fetchConReintento(url);

    if (!data) {
      log(`⚠️  No se pudo obtener la página ${pagina}. Deteniendo.`);
      break;
    }

    const results = data.results || (Array.isArray(data) ? data : []);

    if (results.length === 0) {
      log(`  ✅ Sin más items en offset=${offset}. Paginación completa.`);
      break;
    }

    items.push(...results);
    log(`  ✅ Página ${pagina}: ${results.length} items | Acumulado: ${items.length}`);

    offset += limit;
    pagina++;

    // Rate limit: esperar entre páginas
    await esperar(1500);
  }

  log(`✅ Total descargado: ${items.length} items`);
  return items;
}

function procesarProductos(items) {
  log("🗂️  Procesando productos...");
  return items
    .filter(item => item.cod_item)
    .map(item => ({
      codigo: item.cod_item,
      nombre: item.item || "",
      rubro: item.rubro?.nombre || "",
      sub_rubro: item.sub_rubro?.nombre || "",
      habilitado: item.habilitado === "S",
      iva: parseFloat(item.porc_iva) || 0
    }));
}

function construirArbolRubros(items) {
  log("🌲 Construyendo árbol rubro → subrubro → productos...");
  const arbol = {};

  items.forEach(item => {
    const rubro = item.rubro?.nombre;
    const subrubro = item.sub_rubro?.nombre || null;
    const codigo = item.cod_item;
    if (!rubro || !codigo) return;

    if (!arbol[rubro]) arbol[rubro] = { subrubros: {}, productos: [] };
    if (!arbol[rubro].productos.includes(codigo)) arbol[rubro].productos.push(codigo);

    if (subrubro) {
      if (!arbol[rubro].subrubros[subrubro]) arbol[rubro].subrubros[subrubro] = [];
      arbol[rubro].subrubros[subrubro].push(codigo);
    }
  });

  // Convertir a formato más amigable
  const resultado = {};
  Object.entries(arbol).forEach(([rubro, data]) => {
    resultado[rubro] = {
      subrubros: Object.entries(data.subrubros).map(([nombre, codigos]) => ({ nombre, codigos })),
      productos: data.productos
    };
  });

  log(`✅ Árbol construido: ${Object.keys(resultado).length} rubros`);
  return resultado;
}

function procesarStock(items) {
  log("📊 Procesando stock por variante/color...");
  const stock = {};

  items.forEach(item => {
    const codigo = item.cod_item;
    if (!codigo) return;

    let stockTotal = 0;
    const variantes = {};

    if (Array.isArray(item.stock) && item.stock.length > 0) {
      item.stock.forEach(s => {
        const cantidad = parseFloat(s.stock_disponible) || 0;
        // Si tiene color usa color, sino usa nombre del depósito
        const clave = s.color ? s.color.toUpperCase() : (s.nombre || "DEPOSITO").toUpperCase();
        variantes[clave] = {
          stock: cantidad,
          stockReal: parseFloat(s.stock_real) || 0,
          reservado: parseFloat(s.stock_reservado) || 0,
          deposito: s.nombre || ""
        };
        stockTotal += cantidad;
      });
    }

    stock[codigo] = {
      nombre: item.item || "",
      stockTotal,
      variantes
    };
  });

  log(`✅ Stock procesado: ${Object.keys(stock).length} productos`);
  return stock;
}

function procesarPrecios(items) {
  log("💰 Procesando listas de precios...");

  const precios = {
    57669: { nombre: "LISTA MADRE 1925", items: {} },
    58940: { nombre: "LISTA MAYORISTA 1", items: {} },
    59895: { nombre: "LISTA MAYORISTA 2", items: {} }
  };

  items.forEach(item => {
    const codigo = item.cod_item;
    if (!codigo) return;
    if (!Array.isArray(item.precios) || item.precios.length === 0) return;

    item.precios.forEach(p => {
      const idLista = p.id;
      const precio = parseFloat(p.precio) || 0;
      if (precios[idLista]) {
        precios[idLista].items[codigo] = { precio };
      }
    });
  });

  const totales = Object.entries(precios)
    .map(([id, lista]) => `${lista.nombre}: ${Object.keys(lista.items).length}`)
    .join(" | ");
  log(`✅ Precios procesados — ${totales}`);

  return precios;
}

function guardarJSON(nombre, datos) {
  const ruta = path.join(DATA_DIR, `${nombre}.json`);
  fs.writeFileSync(ruta, JSON.stringify(datos, null, 2), "utf8");
  const kb = (fs.statSync(ruta).size / 1024).toFixed(2);
  log(`💾 Guardado: data/${nombre}.json (${kb} KB)`);
}

async function ejecutarSync() {
  log("🚀 ========== INICIANDO SINCRONIZACIÓN DUX ==========");
  const inicio = Date.now();

  try {
    const items = await descargarTodosLosItems();

    if (items.length === 0) {
      log("❌ No se descargaron items. Abortando.");
      return;
    }

    const productos = procesarProductos(items);
    const stock = procesarStock(items);
    const precios = procesarPrecios(items);
    const rubros = construirArbolRubros(items);

    guardarJSON("productos", productos);
    guardarJSON("stock", stock);
    guardarJSON("precios", precios);
    guardarJSON("rubros", rubros);

    const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
    log(`⏱️  Tiempo total: ${segundos}s`);
    log("✅ ========== SINCRONIZACIÓN COMPLETADA ==========\n");

  } catch (error) {
    log(`❌ ERROR CRÍTICO: ${error.message}`);
    log(error.stack);
  }
}

ejecutarSync();
