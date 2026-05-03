# Referencia técnica — mh-ia y derivados

Base de datos de **estructuras y funciones** del bot de WhatsApp `mh-ia` y los módulos derivados que viven en el mismo repo.

> Generado el 2026-05-03. Este archivo es la fuente de verdad para nombres de funciones, parámetros, shapes de datos y endpoints. Si tocás código y cambiás una firma, actualizá la sección correspondiente.

---

## Índice

1. [Stack y deploy](#1-stack-y-deploy)
2. [Variables de entorno](#2-variables-de-entorno)
3. [Endpoints HTTP](#3-endpoints-http)
4. [`index.js` — entrada y orquestador](#4-indexjs--entrada-y-orquestador)
5. [`buscador/`](#5-buscador)
6. [`config/`](#6-config)
7. [`memoria-de-clientes/`](#7-memoria-de-clientes)
8. [`imagenes-y-pdf-para-clientes/`](#8-imagenes-y-pdf-para-clientes)
9. [`gastos/`](#9-gastos)
10. [`sincronizacion-automatica/`](#10-sincronizacion-automatica)
11. [`stock-control/` (mh-stock-app)](#11-stock-control-mh-stock-app)
12. [`palabras-clave-y-detalles/`](#12-palabras-clave-y-detalles)
13. [`datos-dux/` — JSON generados](#13-datos-dux--json-generados)
14. [Flujos principales](#14-flujos-principales)

---

## 1. Stack y deploy

| Concepto | Valor |
|----------|-------|
| Runtime | Node.js 22.22.2 (sin Node local — todo en Railway) |
| Repo | https://github.com/cristianmontemarano0531-bot/mh-ia- |
| Deploy | Railway, region `us-west2`, 1 replica |
| URL pública | https://mh-ia-production.up.railway.app |
| Webhook WhatsApp | `POST /webhook` (Twilio sandbox `whatsapp:+14155238886`) |
| Stock control | `GET /control` (módulo derivado) |
| IA | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) vía REST |
| Audios | OpenAI Whisper |
| WhatsApp | Twilio |

**Dependencias npm** (`package.json`):

```json
{
  "dotenv": "^16.0.3",
  "express": "^4.18.2",
  "node-cron": "^3.0.2",
  "twilio": "^4.19.0"
}
```

`fetch` es global (Node 18+). No se usa `axios` ni `googleapis` — Google Sheets se llama vía REST + JWT manual.

---

## 2. Variables de entorno

| Variable | Módulo | Obligatoria | Descripción |
|----------|--------|-------------|-------------|
| `ANTHROPIC_API_KEY` | core | sí | Claude Haiku 4.5 |
| `OPENAI_API_KEY` | core | sí | Whisper (audios WhatsApp) |
| `TWILIO_ACCOUNT_SID` | core | sí | Twilio SID |
| `TWILIO_AUTH_TOKEN` | core | sí | Twilio token |
| `RAILWAY_STATIC_URL` | core | auto en Railway | base pública para servir `/media` |
| `BASE_URL` | core | fallback local | reemplaza a `RAILWAY_STATIC_URL` |
| `DUX_TOKEN` | sync | sí | Authorization a Dux ERP |
| `DUX_BASE` | sync | no | default `https://erp.duxsoftware.com.ar/WSERP/rest/services` |
| `GASTOS_SHEET_ID` | gastos | sí (módulo gastos) | Sheet de gastos personales |
| `GASTOS_SHEET_TAB` | gastos | no | default `"Gastos"` |
| `GOOGLE_SA_EMAIL` | gastos + stock | sí | service account `mh-gastos-bot@mh-gastos.iam.gserviceaccount.com` |
| `GOOGLE_SA_PRIVATE_KEY` | gastos + stock | sí | con `\n` literales |
| `STOCK_SHEET_ID` | stock-control | sí (módulo stock) | `1yfzi8OebptBh7JvZovYHhugut5q8V2rGcb13Ny2n6JY` |
| `STOCK_SHEET_TAB` | stock-control | no | default `"Movimientos"` |

Local: `config/.env.local` (gitignored).

---

## 3. Endpoints HTTP

### Express principal (`index.js`)

| Método | Path | Origen | Propósito |
|--------|------|--------|-----------|
| `POST` | `/webhook` | Twilio | recibe mensajes WhatsApp |
| `GET`  | `/` | health | estado de datos-dux, usuarios, versión |
| `GET`  | `/debug/media` | debug | lista todos los PDFs e imágenes con URLs |
| `GET`  | `/debug/producto/:codigo` | debug | datos completos del producto |
| `GET`  | `/debug/pdf/:codigo` | debug | info del PDF y validación Twilio |
| `*`    | `/media/*` | static | sirve PDFs e imágenes desde `imagenes-y-pdf-para-clientes/` |
| `*`    | `/control/*` | mount | router de stock-control |

### Router stock-control (`stock-control/router.js`)

| Método | Path | Body | Respuesta |
|--------|------|------|-----------|
| `GET`  | `/control/api/productos` | — | `{ ok, productos: [...], total }` |
| `GET`  | `/control/api/health` | — | `{ ok, productos: N, stockArchivo: bool, sheetConfigurado: bool }` |
| `POST` | `/control/api/movimientos` | `{ operario, items: [{codigo, qty, color?, talle?, ...}] }` | `{ ok, filasAgregadas, idCarga }` |
| `GET`  | `/control/` | — | sirve `public/index.html` (PWA) |

---

## 4. `index.js` — entrada y orquestador

880 líneas, ~40KB. Servidor Express + cron de sync + webhook Twilio.

### Constantes

| Nombre | Tipo | Valor |
|--------|------|-------|
| `VERSION` | string | `"4.1.4"` |
| `RAW_BASE_URL` / `BASE_URL` | string | URL pública para `/media` |
| `CORRECCIONES_AUDIO` | `Array<[RegExp, string]>` | normaliza errores de Whisper (vmini, hormigon, grafito, sahara, etc.) |
| `VARIANTES_CONOCIDAS` | `Array<string>` | `["SAHARA","CAJU","GRAFITO","HORMIGON","MEZZO","BLANCO","NEGRO","NERO","TERRA"]` |

### Funciones top-level

| Firma | Devuelve | Propósito |
|-------|----------|-----------|
| `transcribirAudio(mediaUrl)` | `Promise<string\|null>` | descarga audio Twilio → Whisper español |
| `enviarMensaje(numero, texto)` | `Promise<boolean>` | mensaje texto via Twilio |
| `enviarMedia(numero, mediaPath, caption?)` | `Promise<boolean>` | PDF/imagen via Twilio (URL pública con cache-busting) |
| `llamarClaude(mensajes, systemPrompt)` | `Promise<string>` | Claude Haiku 4.5 REST |
| `corregirTranscripcion(texto)` | `string` | aplica `CORRECCIONES_AUDIO` |
| `detectarComandoAdmin(texto)` | `{cmd, args} \| null` | detecta comandos `/...` |
| `extraerCodigo(texto)` | `string \| null` | regex `V\d+`, `VMINI`, `EDM\d+`, `VEDM`, `TAPAMARMOL` |
| `detectarRubroSolo(texto)` | `string \| null` | rubro puro sin qualifiers |
| `detectarPedidoMedia(texto)` | `{esPDF, esImagen, esMedia}` | usuario pide PDF/ficha/imagen |
| `extraerVariante(texto)` | `string \| null` | match en `VARIANTES_CONOCIDAS` |
| `fmtPrecio(n)` | `string` | `"$X.XXX,XX"` argentino o `"sin precio cargado"` |
| `fmtStockVariantes(stock_variantes, soloVariante?)` | `string` | desagregado o consolidado |
| `formatearCodigoExacto(prod, varianteSolicitada?)` | `string \| null` | cuadro código + nombre + precio + stock |
| `fmtStockInline(stock_variantes)` | `string` | compacto: `"Stock: N variantes (total X)"` |
| `formatearLista(resultados, limit=8)` | `string \| null` | lista con código, medida, línea, precio, stock |
| `formatearListaSimple(productos, limit?)` | `string \| null` | `"• *CODIGO* — stock"` (Modo 3) |
| `resumenRubro(rubro)` | `{total, detalle}` | conteo por subrubro |
| `construirSystemPrompt(usuario, saludar, infoBusqueda)` | `string` | system prompt para Claude interno |
| `ejecutarComandoAdmin(numeroOrigen, cmd)` | `string` | router de `/agregar`, `/quitar`, `/usuarios`, `/help` |
| `procesarMensaje(numero, texto, mediaUrl?)` | `Promise<{texto, media}>` | **CORE** — orquesta detectores y modos |
| `ejecutarSync()` | `void` | spawnea sync-dux.js |

### Programación (cron)

- `setTimeout(ejecutarSync, 5000)` — al startup
- `cron.schedule("0 * * * *", ejecutarSync)` — cada hora en punto (Buenos Aires)

### Detectores en orden dentro de `procesarMensaje`

1. Audio → transcribir + corregir
2. Rechazo de no-internos
3. Gastos personales (solo admin, prefijo `gasto`)
4. Comandos admin (`/...`)
5. Pedido de PDF/imagen
6. Casual reply (hola/gracias/ok)
7. **Modo 1** — código exacto
8. **Modo 3** — rubro solo
9. **Modo 2** — semi-específico (búsqueda con contexto)

---

## 5. `buscador/`

### `buscador-con-contexto.js`

Wrapper que enriquece búsquedas con memoria del cliente y adapta respuesta al perfil.

| Función | Firma | Devuelve |
|---------|-------|----------|
| `buscarConContexto` | `(numero, consulta, opciones?: {seccion, limit, perfil})` | `{numero, nombre, perfil, seccion, consulta, resultados[], recomendacion, ...}` |
| `generarRecomendacion` | `(resultados, memoria, perfil)` | `string` adaptado al perfil (interno/PDV/externo) |
| `obtenerDetalles` | `(numero, codigo)` | producto completo o `{error}` |

### `buscador-inteligente.js`

Motor de búsqueda con scoring multi-dimensional.

| Función | Firma | Devuelve |
|---------|-------|----------|
| `cargarDiscontinuados` | `()` | `Set<string>` |
| `cargarCatalogo` | `(seccion?)` | `Array<producto>` (filtra discontinuados) |
| `cargarStock` | `()` | `{codigo: {stockTotal, variantes: {COLOR: {stock, stockReal, reservado}}}}` |
| `cargarPrecios` | `()` | `{listaId: {nombre, items: {codigo: {precio}}}}` |
| `normalizar` | `(texto)` | `string` (lowercase, sin diacríticos) |
| `levenshtein` | `(a, b)` | `number` (distancia, máx 3) |
| `esConsultaGenerica` | `(consulta)` | `boolean` |
| `extraerMedidas` | `(consulta)` | `Array<string>` (`["60","80"]`) |
| `extraerColores` | `(consulta)` | `Array<string>` |
| `calcularScore` | `(producto, consulta, medidas, colores, contextoCliente)` | `number` |
| `buscar` | `(consulta, seccion?, limit?, contextoCliente?)` | resultado completo (ver shape abajo) |
| `buscarPorCodigo` | `(codigo, seccion?)` | producto completo o `{error}` |
| `listarPorCodigos` | `(codigos[], seccion?)` | `Array<producto>` |
| `sugerencias` | `(inicio, seccion?, limit=5)` | `Array<{codigo, nombre, categoria}>` |

**Scoring (`calcularScore`)** — 6 dimensiones:

1. Match de keywords (15 exacto, 5 parcial, 8 Levenshtein)
2. Código exacto/parcial (100 / 80–40)
3. Medida exacta (+25, sin match −10)
4. Colores (+20 por color)
5. Categoría/tipo/línea (+15 a +25)
6. Historial cliente (+10 por preferencia)

**Shape de `buscar()` resultado:**

```js
{
  consulta, seccion,
  medidas_detectadas: ["60"],
  colores_detectados: ["hormigon"],
  resultados: [{ codigo, nombre, categoria, medida, colores, score,
                 stock_total, stock_variantes, precio_madre, precio_may1, precio_may2,
                 linea, guardado, familia, variantes_familia,
                 colores_disponibles, relacionados, frase }],
  confianza: "alta"|"media"|"baja",
  pedir_mas_detalle: boolean
}
```

### `navegacion-rubros.js`

Árbol rubros → subrubros → productos.

**Constantes exportadas:**
- `RUBROS_VISIBLES = ["MUEBLES","BACHAS","MESADAS","ESPEJOS Y BOTIQUINES"]`
- `RUBRO_A_SECCION = {"MUEBLES":"baño","BACHAS":"baño",...}`

| Función | Firma | Devuelve |
|---------|-------|----------|
| `detectarRubro` | `(consulta)` | nombre rubro o `null` |
| `detectarFueraDeScope` | `(consulta)` | alias encontrado o `null` |
| `obtenerSubrubros` | `(rubro)` | `Array<{nombre, codigos}>` |
| `obtenerProductos` | `(rubro, subrubro?)` | `Array<string>` (códigos, sin discontinuados) |
| `detectarEleccionSubrubro` | `(texto, opcionesDisponibles)` | opción match o `null` |

### `catalogo-maestro.js`

Resumen de catálogo inyectable en system prompt.

| Función | Firma | Devuelve |
|---------|-------|----------|
| `cargar` | `()` | `{total, porRubro}` (cache 60s) |
| `resumenParaPrompt` | `()` | string formateado para Claude |

---

## 6. `config/`

### `usuarios-manager.js`

**Constantes exportadas:**
- `ADMIN_NUMERO = "5491149460531"` (Cristian)

**Estructura `USUARIOS_FIJOS` (hardcoded):**
```js
{
  "5491149460531": { nombre: "Cristian", perfil: "interno", admin: true },
  "5491165005095": { nombre: "MH Fábrica", perfil: "interno" },
  "5491139042568": { nombre: "Vendedor 1", perfil: "interno" }
}
```

| Función | Firma | Devuelve |
|---------|-------|----------|
| `normalizarNumero` | `(numero)` | `string` (solo dígitos) |
| `esInterno` | `(numero)` | `boolean` (fijos + extras) |
| `esAdmin` | `(numero)` | `boolean` |
| `obtenerUsuario` | `(numero)` | `{nombre, perfil, numero, tipo: "fijo"\|"extra"}` o `null` |
| `agregarUsuario` | `(numero, nombre)` | `{ok, error?, usuario?}` (persiste a `usuarios-extras.json`) |
| `quitarUsuario` | `(numero)` | `{ok, error?}` (no permite borrar fijos) |
| `listarUsuarios` | `()` | `{fijos: [], extras: []}` |

> **Restricción:** filesystem efímero en Railway → `usuarios-extras.json` se borra en cada deploy. Para permanentes, editar `USUARIOS_FIJOS`.

### `discontinuados.json`

```json
{
  "_comentario": "...",
  "codigos": ["V80ECO1C","V80ECO1CCOLOR","VEDM60","VEDM60N","VEDM80","VEDM80N",
              "TAPAMARMOL060","TAPAMARMOL060N","TAPAMARMOL080","TAPAMARMOL080N", ...],
  "_notas": { "CODIGO": "razón o tipo componente" }
}
```

---

## 7. `memoria-de-clientes/`

### `memoria-manager.js`

Persistencia por cliente en `{numero}.json` (filesystem efímero — se pierde en deploy).

**Shape de la memoria:**

```js
{
  numero, nombre, perfil,
  lista_precios: "madre"|"may1"|"may2",
  primera_consulta, ultima_consulta, total_consultas,
  historial: [{ ts, rol: "user"|"assistant", texto }],   // máx 20
  contexto: {
    ultima_seccion, ultimo_producto,
    productos_vistos: [],          // máx 10
    preferencias_color: [],        // máx 3
    preferencias_medida: [],       // máx 3
    esperando_nombre, esperando_si_cliente, esperando_nombre_y_cuit,
    esperando_subrubro,            // null | {datos}
    consulta_pendiente,
    cuit, cliente_verificado
  }
}
```

| Función | Firma | Devuelve |
|---------|-------|----------|
| `cargarMemoria` | `(numero)` | objeto memoria (crea si no existe) |
| `guardarMemoria` | `(numero, memoria)` | `void` |
| `registrarMensaje` | `(numero, rol, texto)` | memoria actualizada (trunca historial a 20) |
| `actualizarNombre` | `(numero, nombre, perfil?)` | `void` |
| `actualizarContexto` | `(numero, {seccion?, producto?, color?, medida?})` | memoria |
| `obtenerHistorialClaude` | `(numero)` | `Array<{role, content}>` para Claude API |
| `generarSaludo` | `(numero)` | `string` personalizado |
| `resumenCliente` | `(numero)` | `string` para system prompt |
| `listarClientes` | `()` | `Array<{numero, nombre, perfil, ultima_consulta, total_consultas}>` |
| `esPrimeraVezHoy` | `(numero)` | `boolean` |
| `esNumeroNuevo` | `(numero)` | `boolean` |
| `estaEsperandoNombre` / `marcarEsperandoNombre` | `(numero[, esperando])` | flag |
| `estaEsperandoSiCliente` / `marcarEsperandoSiCliente` | `(numero[, esperando])` | flag |
| `estaEsperandoNombreYCuit` / `marcarEsperandoNombreYCuit` | `(numero[, esperando])` | flag |
| `guardarCuit` | `(numero, cuit, verificado?)` | `void` |
| `esClienteVerificado` | `(numero)` | `boolean` |
| `estaEsperandoSubrubro` / `marcarEsperandoSubrubro` | `(numero[, datos])` | objeto o `null` |
| `guardarConsultaPendiente` / `obtenerConsultaPendiente` / `limpiarConsultaPendiente` | `(numero[, texto])` | string o void |
| `asignarListaPrecios` | `(numero, "madre"\|"may1"\|"may2")` | `boolean` |
| `obtenerListaPrecios` | `(numero)` | string |
| `guardarNombreDesdeChat` | `(numero, nombre)` | `string` (capitalizado) |

---

## 8. `imagenes-y-pdf-para-clientes/`

### `media-manager.js`

| Función | Firma | Devuelve |
|---------|-------|----------|
| `obtenerImagen` | `(codigo)` | ruta absoluta o `null` |
| `obtenerPDF` | `(codigo)` | ruta absoluta o `null` (con fallbacks: `EDM→VEDM/VEDMN`, `V\d+→V\d+U/V\d+UC`, sin sufijos `B/COLOR/UCB`, prefijo) |
| `obtenerMedia` | `(codigo)` | `{codigo, imagen?, pdf?}` o `null` |
| `listarTodoElMedia` | `()` | `{imagenes: [{archivo, codigo, ruta}], pdf: [...]}` |
| `generarIndice` | `()` | `{CODIGO: {imagen, pdf}}` (persiste a `indice.json`) |
| `resumenCobertura` | `()` | imprime a console |

**Directorios:**
- `imagenes/` (JPG, PNG, WebP)
- `pdf/` (PDF)

> **Restricción Twilio Sandbox:** no entrega PDFs como adjunto correctamente — se envían como link clickeable en texto.

---

## 9. `gastos/`

Módulo personal del admin (Cristian). Prefijo `gasto:` o `gastos:` en mensaje WhatsApp.

### `index.js`

| Función | Firma | Devuelve |
|---------|-------|----------|
| `procesarGasto` | `(textoCrudo)` | `Promise<string>` (confirmación al admin) |

Flujo: chequea config → quita prefijo → `parsearGastos()` → `appendGastos()` → confirmación.

### `detector.js`

Constante: `PREFIJO = /^gastos?\b\s*[:\-]?\s*/i`

| Función | Firma | Devuelve |
|---------|-------|----------|
| `esGasto` | `(texto)` | `boolean` |
| `quitarPrefijo` | `(texto)` | `string` |

### `parser.js`

| Función | Firma | Devuelve |
|---------|-------|----------|
| `parsearGastos` | `(texto)` | `Promise<Array<{descripcion, monto, medio_pago}>>` |

Llama a Claude Haiku 4.5 con system prompt estricto:
- monto entero en pesos
- descripción capitalizada
- `medio_pago` normalizado a valores fijos
- tolera wrapper ` ```json ... ``` `

### `sheets-client.js`

Cliente REST + JWT manual (sin `googleapis`).

| Función | Firma | Devuelve |
|---------|-------|----------|
| `configurado` | `()` | `boolean` |
| `obtenerAccessToken` | `()` | `Promise<string>` (cache 50min) |
| `appendGastos` | `(filas: Array<[fecha, descripcion, monto, medio_pago]>)` | `Promise<{ok, filasAgregadas?, error?}>` |

**Helper interno:** `base64url()` (encoding sin padding para JWT firmado RSA-SHA256).

---

## 10. `sincronizacion-automatica/`

### `sync-dux.js`

Cron horario: descarga catálogo desde Dux ERP y persiste a `datos-dux/*.json`.

| Función | Firma | Devuelve |
|---------|-------|----------|
| `descargarTodosLosItems` | `()` | `Promise<Array>` (paginación 50, maneja 429) |
| `procesarProductos` | `(items)` | `Array<{codigo, nombre, rubro, sub_rubro, habilitado, iva}>` |
| `procesarStock` | `(items)` | `{codigo: {nombre, stockTotal, variantes: {COLOR: {stock, stockReal, reservado, deposito}}}}` |
| `procesarPrecios` | `(items)` | `{idLista: {nombre, items: {codigo: {precio}}}}` (3 listas) |
| `construirArbolRubros` | `(items)` | `{RUBRO: {subrubros: [...], productos: [...]}}` |
| `guardarJSON` | `(nombre, datos)` | `void` (escritura atómica `.tmp` → rename) |
| `ejecutarSync` | `()` | `Promise<void>` (orquesta todo, log a `registros/sync.log`) |

**Listas de precios procesadas:**
- `57669` LISTA MADRE 1925
- `58940` MAYORISTA 1
- `59895` MAYORISTA 2

### `runner.js`

Spawn cron alternativo (no usado en Railway — `index.js` ya tiene el cron).

| Función | Firma | Devuelve |
|---------|-------|----------|
| `ejecutarSync` | `()` | `void` (spawn `node sync-dux.js`) |

`cron.schedule("*/60 * * * *", ejecutarSync)` + ejecución inmediata al startup.

---

## 11. `stock-control/` (mh-stock-app)

PWA móvil para movimientos de stock en depósito → Google Sheets formato Dux. **En producción desde 2026-05-03.**

### `router.js`

Express Router montado en `/control`.

| Función interna | Firma | Devuelve |
|-----------------|-------|----------|
| `parseJsonSeguro` | `(raw)` | objeto (strippea BOM `EF BB BF`) |
| `leerProductos` | `()` | `Array` (cache en memoria de `productos.json`) |
| `leerStock` | `()` | objeto (lee `stock.json` cada request — fresca) |
| `stockDeVariante` | `(stock, codigo, color?)` | `number \| null` |

### `sheet.js`

Cliente REST + JWT a Google Sheets (mismo SA que gastos).

**Header esperado** (auto-inserta si no existe):
```
[Fecha/Hora, Operario, Tipo, Código Producto, Producto, Color, Talle, Cantidad, ID Carga]
```

| Función | Firma | Devuelve |
|---------|-------|----------|
| `configurado` | `()` | `boolean` |
| `obtenerAccessToken` | `()` | `Promise<string>` |
| `asegurarCabecera` | `(token)` | `Promise<void>` (single-execution con flag) |
| `appendMovimientos` | `(filas: Array<[...9 cols]>)` | `Promise<{ok, filasAgregadas?, error?}>` |

### Frontend (`public/index.html` + JS vanilla)

UX **carrito de variantes** (no lista desplegable):

1. Buscador único — matchea código, descripción y color
2. Seleccionar variante → fila fija con `−`/`+` libres (sin toggle modo)
3. Botones rápidos `+5` / `+10` para lotes
4. Re-búsqueda no duplica fila — lleva a la abierta
5. Confirmar → escribe una fila por variante en `Movimientos`

**Operarios fijos** (selector + localStorage): Juan, Tizi, Marcos, Cristian, Agustín, Lucas, Germán, Julián, Miguel.

> **Hotfix BOM:** `productos.json` regenerado sin BOM. PowerShell `Out-File -Encoding utf8` agrega BOM — usar `[System.IO.File]::WriteAllBytes` o `[System.Text.UTF8Encoding]::new($false)`.

---

## 12. `palabras-clave-y-detalles/`

### `baño.json` — catálogo curado (~77 productos)

**Shape de un registro:**

```js
{
  codigo: "V60CLAC",
  nombre: "VANITORY PIATTO 60CM CLASICO BLANCO",
  seccion: "baño",
  categoria: "vanitory",
  linea: "piatto",
  medida: "60",
  guardado: "puertas",
  colores: ["BLANCO"],
  familia: "VANITORY PIATTO",
  variantes_familia: [
    { codigo, colores: [], es_blanco?: bool, es_color?: bool }
  ],
  colores_disponibles: [],
  relacionados: [],
  desc_larga: "...",
  frase: "...",
  es_componente: false,
  keywords: [],                    // ~50-100 keywords
  stock: 0,                        // sobreescrito por sync
  stock_variantes: { DEPOSITO: { stock, stockReal, reservado, deposito } },
  precios: { madre, mayorista1, mayorista2 },
  tipo_familia: "medida_color",
  variantes_familia_medida: [{ codigo, descripcion }]
}
```

### Otros JSON (`base-mh.json`, `cocina.json`, `placard.json`)

Catálogos para rubros fuera de scope actual — **no usados por el bot** (se rechazan vía `ALIASES_FUERA_SCOPE`).

### `generar-catalogo.js`

Script standalone para regenerar `baño.json`. **No exporta funciones.**

---

## 13. `datos-dux/` — JSON generados

Generados por `sync-dux.js` cada hora. Lectura por `buscador-inteligente.js` y `navegacion-rubros.js`.

### `stock.json`

```js
{
  "V60CLAC": {
    nombre: "VANITORY PIATTO 60...",
    stockTotal: 5,
    variantes: {
      "BLANCO":   { stock: 5, stockReal: 5, reservado: 0, deposito: "DEPOSITO" },
      "DEPOSITO": { stock: 5, stockReal: 5, reservado: 0, deposito: "DEPOSITO" }
    }
  }
}
```

### `precios.json`

```js
{
  "57669": { nombre: "LISTA MADRE 1925",  items: { "V60CLAC": { precio: 313511 } } },
  "58940": { nombre: "LISTA MAYORISTA 1", items: { ... } },
  "59895": { nombre: "LISTA MAYORISTA 2", items: { ... } }
}
```

### `rubros-bano.json`

```js
{
  "MUEBLES": {
    subrubros: [
      { nombre: "PIATTO",  codigos: ["V60CLAC", ...] },
      { nombre: "MARBELA", codigos: ["EDM60", ...] },
      { nombre: "CLASSIC", codigos: ["V60UC", ...] }
    ],
    productos: ["V60CLAC", "V60CLACOLOR", ...]
  },
  "BACHAS": { ... }, "MESADAS": { ... }, "ESPEJOS Y BOTIQUINES": { ... }
}
```

### `productos.json` / `productos-bano.json`

Mapeo `código ↔ rubro/sub_rubro`. Generado durante sync.

---

## 14. Flujos principales

### A. Mensaje entrante WhatsApp

```
Twilio POST /webhook
  → procesarMensaje(numero, texto, mediaUrl)
      1. transcribirAudio + corregirTranscripcion (si hay audio)
      2. esInterno?  → si no, rechazo
      3. esGasto + esAdmin?  → procesarGasto
      4. detectarComandoAdmin?  → ejecutarComandoAdmin
      5. detectarPedidoMedia?  → enviarMedia (PDF/imagen)
      6. casual reply (hola/gracias/ok)
      7. Modo 1: extraerCodigo  → buscarPorCodigo  → formatearCodigoExacto
      8. Modo 3: detectarRubroSolo  → obtenerProductos  → formatearListaSimple
      9. Modo 2: buscarConContexto  → llamarClaude(prompt enriquecido)
  → enviarMensaje + opcional enviarMedia
  → registrarMensaje(numero, "assistant", respuesta)
```

### B. Sincronización Dux

```
startup +5s  ──┐
cron horario ──┴→ ejecutarSync()
                  → spawn node sincronizacion-automatica/sync-dux.js
                      → descargarTodosLosItems  (paginación, retry 429)
                      → procesarProductos / Stock / Precios / Rubros
                      → guardarJSON (atómico)  → datos-dux/*.json
                      → log → registros/sync.log
```

### C. Gasto personal (admin)

```
"gasto: carniceria 20.000 mercado pago"
  → esGasto + esAdmin?  → procesarGasto(texto)
      → quitarPrefijo
      → parsearGastos (Claude Haiku → JSON estricto)
      → appendGastos (JWT → Google Sheets append)
  → confirmación: "✅ Carniceria $20.000 — Mercado Pago"
```

### D. Movimiento de stock (mh-stock-app)

```
operario en /control (móvil)
  → buscar variante  → fila fija con +/− y +5/+10
  → confirmar
  → POST /control/api/movimientos { operario, items[] }
      → asegurarCabecera (si primer escritura)
      → appendMovimientos → Sheet "Movimientos"
  → { ok, filasAgregadas, idCarga }
  → Cristian importa el Sheet a Dux sin transformar
```

---

## Notas operativas

- **Filesystem efímero en Railway:** `memoria-de-clientes/*.json` y `usuarios-extras.json` se borran en cada deploy. Para persistir usuarios → editar `USUARIOS_FIJOS` en `config/usuarios-manager.js`.
- **Cualquier cambio en `index.js` o módulos cargados** debe ser aditivo, en rama separada, probado en Railway antes de mergear a `main`. Nunca tocar el flujo de detectores 4–9 sin pedido explícito.
- **Twilio Sandbox** no entrega PDFs como adjunto bien → siempre como link clickeable en texto.
- **PowerShell + JSON:** `Out-File -Encoding utf8` agrega BOM. Para JSON limpio usar `[System.IO.File]::WriteAllBytes` o `UTF8Encoding(false)`.
