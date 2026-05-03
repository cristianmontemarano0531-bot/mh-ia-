# Módulo de gastos personales — Setup

Este módulo permite cargar gastos desde WhatsApp (texto o audio) escribiendo
en una planilla de Google Sheets. Solo se activa para el número admin
(`5491149460531`) y solo cuando el mensaje empieza con la palabra **`gasto`**.

## Cómo se usa (desde WhatsApp)

```
gasto: carniceria 20.000 mercado pago
gasto: ropa puma 50.000 caja de ahorro; nafta ypf 15.000
```

También funciona por audio: mandás un audio diciendo "gasto carniceria
veinte mil mercado pago" y se carga igual.

Confirmación esperada:
```
✅ Carniceria $20.000 — Mercado Pago
```

## Setup por única vez

### 1. Crear la planilla en Google Sheets
1. Andá a https://sheets.google.com y creá una planilla nueva.
2. Renombrá la pestaña/hoja a **`Gastos`** (sin acento).
3. Poné los encabezados en la fila 1: `Fecha`, `Descripción`, `Monto`, `Medio de pago`.
4. Copiá el **Sheet ID** de la URL. Si la URL es
   `https://docs.google.com/spreadsheets/d/1AbCdEf.../edit`, el ID es `1AbCdEf...`.

### 2. Crear un Service Account en Google Cloud
1. Entrá a https://console.cloud.google.com/ con tu cuenta de Google.
2. Creá un proyecto nuevo (o usá uno existente). Nombre sugerido: `mh-gastos`.
3. En el buscador del header poné **"Google Sheets API"** y habilitala.
4. Andá a **IAM & Admin → Service Accounts → Create Service Account**.
   - Nombre: `mh-gastos-bot`
   - Rol: dejalo sin rol (no hace falta a nivel proyecto, alcanza con
     compartir la planilla puntual).
5. Una vez creado, entrá al service account → pestaña **Keys** → **Add Key →
   Create new key → JSON**. Se descarga un archivo `.json`.

### 3. Compartir la planilla con el Service Account
1. Abrí el JSON que bajaste y copiá el campo `client_email`
   (algo como `mh-gastos-bot@mh-gastos.iam.gserviceaccount.com`).
2. Volvé a la planilla → botón **Compartir** → pegá ese email →
   permisos **Editor** → enviar.

### 4. Configurar las variables de entorno
Agregar a `config/.env.local` (local) y a Railway (producción):

```env
GASTOS_SHEET_ID=1AbCdEf...                          # paso 1.4
GOOGLE_SA_EMAIL=mh-gastos-bot@mh-gastos.iam.gserviceaccount.com   # del JSON, campo client_email
GOOGLE_SA_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n
```

**IMPORTANTE sobre `GOOGLE_SA_PRIVATE_KEY`:**
- En el JSON el campo `private_key` ya viene con `\n` literales (dos
  caracteres: backslash + n). Copialo tal cual entre comillas o sin comillas,
  tanto en `.env.local` como en Railway.
- El módulo se encarga de convertir los `\n` literales en saltos de línea
  reales antes de firmar el JWT (`replace(/\\n/g, "\n")`).

Opcional:
```env
GASTOS_SHEET_TAB=Gastos     # default si no se setea
```

### 5. Probar
- Local: `node -e "require('./gastos').procesarGasto('gasto: prueba 1000 efectivo').then(console.log)"`
  (debería responder `✅ Prueba $1.000 — Efectivo` y agregar la fila).
- WhatsApp: mandá `gasto: prueba 1000 efectivo` desde tu número.

## Estructura de la planilla

| A (Fecha)         | B (Descripción) | C (Monto) | D (Medio de pago) |
|-------------------|-----------------|-----------|-------------------|
| 2026-05-02 14:32  | Carniceria      | 20000     | Mercado Pago      |

La fecha se setea automáticamente en hora de Buenos Aires (UTC-3). El monto
se guarda como número entero (sin formato), así Google Sheets te permite
hacer SUM, gráficos, etc.

## Qué medios de pago entiende el parser

El parser intenta normalizar al medio más cercano de esta lista:

- Mercado Pago
- Caja de Ahorro
- Cuenta Corriente
- Efectivo
- Tarjeta Crédito
- Tarjeta Débito
- Transferencia

Si no menciona medio, queda vacío. Si menciona algo fuera de la lista,
Claude tira lo más parecido o vacío.
