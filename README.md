# MH Dux Sync — Sincronizador Automático

Sistema de sincronización automática de datos desde Dux ERP (productos, stock, precios) cada 60 minutos.

## Estructura

```
compartida-con-clude-code/
├── config/
│   └── .env.local          ← Token Dux (no subir a Git)
├── data/
│   ├── productos.json      ← Catálogo completo
│   ├── stock.json          ← Stock por variante/color
│   └── precios.json        ← Listas de precios (3 listas)
├── sync/
│   ├── sync-dux.js         ← Script que descarga datos
│   └── runner.js           ← Scheduler (corre cada 60 min)
└── logs/
    ├── sync.log            ← Log del sincronizador
    └── runner.log          ← Log del scheduler
```

## Instalación

```bash
cd compartida-con-clude-code
npm install
```

## Uso

### Opción 1: Sincronizar ahora (una sola vez)
```bash
npm run sync
```

### Opción 2: Sincronizar automáticamente cada 60 minutos
```bash
npm run sync:watch
```

Esto va a:
1. Ejecutar el sync inmediatamente
2. Cada 60 minutos corre automáticamente
3. Logs detallados en `logs/sync.log`

## Qué descarga

### `productos.json` — Catálogo completo
```json
[
  {
    "codigo_item": "V90UC",
    "nombre": "Vanitory 90cm con cajones",
    "stock_disponible": 45,
    ...
  }
]
```

### `stock.json` — Stock por variante/color
```json
{
  "V90UC": {
    "nombre": "Vanitory 90cm",
    "total": 45,
    "variantes": {
      "BLANCO": { "stock": 10, "almacen": "General" },
      "HORMIGON": { "stock": 15, "almacen": "General" },
      ...
    }
  }
}
```

### `precios.json` — 3 listas de precios
```json
{
  "57669": {
    "nombre": "LISTA MADRE 1925",
    "items": {
      "V90UC": { "precio": 45000, "moneda": "ARS", "vigente": true },
      ...
    }
  },
  "58940": { ... },
  "59895": { ... }
}
```

## Cómo usar los datos

Desde tu app de WhatsApp (o cualquier otra app):

```javascript
const fs = require("fs");

// Cargar datos
const productos = JSON.parse(fs.readFileSync("data/productos.json"));
const stock = JSON.parse(fs.readFileSync("data/stock.json"));
const precios = JSON.parse(fs.readFileSync("data/precios.json"));

// Buscar un producto
const v90uc = productos.find(p => p.codigo_item === "V90UC");

// Consultar stock
console.log(stock["V90UC"].variantes["BLANCO"].stock); // 10

// Consultar precio
const precioMadre = precios["57669"].items["V90UC"].precio; // 45000
```

## Problemas y soluciones

| Problema | Solución |
|----------|----------|
| "dotenv not found" | Ejecutar `npm install` |
| "node-cron not found" | Ejecutar `npm install` |
| Los JSONs no se actualizan | Revisar `logs/sync.log` |
| Rate limit de Dux (429) | El script reintenta automáticamente 3 veces |

## Próximos pasos

1. ✅ Probamos localmente
2. ➡️ Subimos el script a Railway
3. ➡️ Railway ejecuta el sync cada 60 min automáticamente
4. ➡️ Tu app de WhatsApp consulta los JSONs en Railway

## Logs

Ver últimas sincronizaciones:
```bash
tail -f logs/sync.log
```

Ver actividad del scheduler:
```bash
tail -f logs/runner.log
```
