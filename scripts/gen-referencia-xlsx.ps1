$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$outPath = Join-Path $repoRoot 'REFERENCIA-mh-ia.xlsx'
if (Test-Path $outPath) { Remove-Item $outPath -Force }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$wb = $excel.Workbooks.Add()
while ($wb.Sheets.Count -gt 1) { $wb.Sheets.Item($wb.Sheets.Count).Delete() }

$script:firstSheetUsed = $false

function Add-Sheet {
    param($wb, $excel, $name, $headers, $rows)

    if (-not $script:firstSheetUsed) {
        $sh = $wb.Sheets.Item(1)
        $sh.Name = $name
        $script:firstSheetUsed = $true
    } else {
        $sh = $wb.Sheets.Add([Type]::Missing, $wb.Sheets.Item($wb.Sheets.Count))
        $sh.Name = $name
    }

    for ($i = 0; $i -lt $headers.Count; $i++) {
        $sh.Cells.Item(1, $i + 1).Value2 = $headers[$i]
    }
    $hr = $sh.Range($sh.Cells.Item(1, 1), $sh.Cells.Item(1, $headers.Count))
    $hr.Font.Bold = $true
    $hr.Font.Color = 0xFFFFFF
    $hr.Interior.Color = 0xC4724D
    $hr.HorizontalAlignment = -4108
    $hr.RowHeight = 22

    for ($r = 0; $r -lt $rows.Count; $r++) {
        $row = $rows[$r]
        for ($c = 0; $c -lt $row.Count; $c++) {
            $sh.Cells.Item($r + 2, $c + 1).Value2 = [string]$row[$c]
        }
    }

    $sh.Columns.AutoFit() | Out-Null
    for ($c = 1; $c -le $headers.Count; $c++) {
        $col = $sh.Columns.Item($c)
        if ($col.ColumnWidth -gt 70) { $col.ColumnWidth = 70 }
    }

    $used = $sh.UsedRange
    $used.WrapText = $true
    $used.VerticalAlignment = -4160
    $used.Font.Name = 'Arial'
    $used.Font.Size = 10

    $sh.Activate()
    $excel.ActiveWindow.SplitRow = 1
    $excel.ActiveWindow.FreezePanes = $true
    $used.AutoFilter() | Out-Null

    return $sh
}

# ---------- README ----------
$readmeRows = @(
    ,@('Modulos', 'Cada archivo .js del repo con propósito y dependencias internas'),
    ,@('Funciones', 'Todas las funciones exportadas: módulo, archivo, firma, devuelve, propósito'),
    ,@('Endpoints', 'Rutas HTTP del Express principal y del módulo stock-control'),
    ,@('Variables_Entorno', 'Env vars con módulo, obligatoriedad y descripción'),
    ,@('Estructuras', 'Shapes de objetos: memoria del cliente, producto, stock, precios, rubros, gastos, movimientos'),
    ,@('Constantes', 'Constantes y arrays exportados con su valor'),
    ,@('Flujos', 'Pasos numerados de los 4 flujos principales del sistema')
)
Add-Sheet $wb $excel 'README' @('Hoja','Contenido') $readmeRows | Out-Null

# ---------- Modulos ----------
$modulosRows = @(
    ,@('core','index.js','Servidor Express, webhook Twilio, helpers de mensajeria, cron de sync','buscador, memoria, media, gastos, usuarios, stock-control'),
    ,@('core','package.json','Dependencias npm: express, twilio, dotenv, node-cron','-'),
    ,@('buscador','buscador/buscador-inteligente.js','Motor de búsqueda con scoring multi-dimensional','config (discontinuados), datos-dux'),
    ,@('buscador','buscador/buscador-con-contexto.js','Wrapper que enriquece búsqueda con memoria y perfil','buscador-inteligente, memoria-manager'),
    ,@('buscador','buscador/navegacion-rubros.js','Árbol rubros->subrubros->productos y detección fuera de scope','datos-dux/rubros-bano.json'),
    ,@('buscador','buscador/catalogo-maestro.js','Resumen de catálogo inyectable en system prompt (cache 60s)','palabras-clave-y-detalles'),
    ,@('config','config/usuarios-manager.js','Usuarios fijos hardcoded + extras dinámicos','config/usuarios-extras.json'),
    ,@('config','config/discontinuados.json','Códigos a filtrar de búsquedas y catálogos','-'),
    ,@('memoria','memoria-de-clientes/memoria-manager.js','Persistencia por cliente: historial, contexto, preferencias','filesystem (efímero en Railway)'),
    ,@('media','imagenes-y-pdf-para-clientes/media-manager.js','Resolver de imágenes/PDFs por código con fallbacks inteligentes','imagenes/, pdf/'),
    ,@('gastos','gastos/index.js','Orquestador del módulo de gastos personales (admin)','gastos/detector, parser, sheets-client'),
    ,@('gastos','gastos/detector.js','Detecta prefijo gasto/gastos','-'),
    ,@('gastos','gastos/parser.js','Convierte texto libre a JSON via Claude Haiku','-'),
    ,@('gastos','gastos/sheets-client.js','Cliente REST + JWT manual a Google Sheets','-'),
    ,@('sync','sincronizacion-automatica/sync-dux.js','Descarga catálogo Dux ERP cada hora','datos-dux/'),
    ,@('sync','sincronizacion-automatica/runner.js','Cron alternativo (no usado en Railway)','sync-dux'),
    ,@('stock-control','stock-control/router.js','Express Router /control para PWA móvil de depósito','datos-dux, stock-control/sheet'),
    ,@('stock-control','stock-control/sheet.js','Cliente REST + JWT a Google Sheets de movimientos','-'),
    ,@('stock-control','stock-control/public/index.html','PWA frontend (carrito de variantes, vanilla JS)','-'),
    ,@('catalogo','palabras-clave-y-detalles/baño.json','Catálogo curado ~77 productos de baño','-'),
    ,@('catalogo','palabras-clave-y-detalles/generar-catalogo.js','Script standalone para regenerar baño.json (no exporta)','-'),
    ,@('datos','datos-dux/stock.json','Stock por código y variante (generado por sync)','-'),
    ,@('datos','datos-dux/precios.json','3 listas de precios (generado por sync)','-'),
    ,@('datos','datos-dux/rubros-bano.json','Árbol rubro->subrubro->códigos (generado por sync)','-'),
    ,@('datos','datos-dux/productos.json','Mapeo código->rubro/sub_rubro (generado por sync)','-')
)
Add-Sheet $wb $excel 'Modulos' @('Modulo','Archivo','Proposito','Dependencias internas') $modulosRows | Out-Null

# ---------- Funciones ----------
$funcionesRows = @(
    ,@('core','index.js','transcribirAudio','mediaUrl: string|null','Promise<string|null>','Descarga audio Twilio y lo envía a Whisper en español'),
    ,@('core','index.js','enviarMensaje','numero, texto','Promise<boolean>','Envía mensaje texto via Twilio'),
    ,@('core','index.js','enviarMedia','numero, mediaPath, caption?','Promise<boolean>','Envía PDF/imagen via Twilio (URL pública con cache-busting)'),
    ,@('core','index.js','llamarClaude','mensajes[], systemPrompt','Promise<string>','Claude Haiku 4.5 via REST'),
    ,@('core','index.js','corregirTranscripcion','texto','string','Aplica array CORRECCIONES_AUDIO'),
    ,@('core','index.js','detectarComandoAdmin','texto','{cmd,args}|null','Detecta comandos que empiezan con /'),
    ,@('core','index.js','extraerCodigo','texto','string|null','Regex V\d+, VMINI, EDM\d+, VEDM, TAPAMARMOL'),
    ,@('core','index.js','detectarRubroSolo','texto','string|null','Rubro puro sin qualifiers'),
    ,@('core','index.js','detectarPedidoMedia','texto','{esPDF,esImagen,esMedia}','Usuario pide PDF/ficha/imagen'),
    ,@('core','index.js','extraerVariante','texto','string|null','Match en VARIANTES_CONOCIDAS'),
    ,@('core','index.js','fmtPrecio','n: number','string','Formatea como $X.XXX,XX argentino'),
    ,@('core','index.js','fmtStockVariantes','stock_variantes, soloVariante?','string','Stock desagregado o consolidado'),
    ,@('core','index.js','formatearCodigoExacto','prod, varianteSolicitada?','string|null','Cuadro código + nombre + precio + stock'),
    ,@('core','index.js','fmtStockInline','stock_variantes','string','Compacto: Stock N variantes (total X)'),
    ,@('core','index.js','formatearLista','resultados, limit=8','string|null','Lista con código, medida, línea, precio, stock'),
    ,@('core','index.js','formatearListaSimple','productos, limit?','string|null','• *CODIGO* - stock (Modo 3)'),
    ,@('core','index.js','resumenRubro','rubro','{total,detalle}','Conteo por subrubro'),
    ,@('core','index.js','construirSystemPrompt','usuario, saludar, infoBusqueda','string','System prompt para Claude interno'),
    ,@('core','index.js','ejecutarComandoAdmin','numeroOrigen, cmd','string','Router de /agregar, /quitar, /usuarios, /help'),
    ,@('core','index.js','procesarMensaje','numero, texto, mediaUrl?','Promise<{texto,media}>','CORE: orquesta detectores y modos 1-3'),
    ,@('core','index.js','ejecutarSync','-','void','Spawn de sync-dux.js (cron horario)'),
    ,@('buscador','buscador-inteligente.js','cargarDiscontinuados','-','Set<string>','Lee config/discontinuados.json'),
    ,@('buscador','buscador-inteligente.js','cargarCatalogo','seccion?','Array<producto>','Filtra discontinuados'),
    ,@('buscador','buscador-inteligente.js','cargarStock','-','object','Lee datos-dux/stock.json'),
    ,@('buscador','buscador-inteligente.js','cargarPrecios','-','object','Lee datos-dux/precios.json'),
    ,@('buscador','buscador-inteligente.js','normalizar','texto','string','lowercase, sin diacríticos, espacios'),
    ,@('buscador','buscador-inteligente.js','levenshtein','a, b','number','Distancia de edición (max 3)'),
    ,@('buscador','buscador-inteligente.js','esConsultaGenerica','consulta','boolean','Detecta que tienen / que hay'),
    ,@('buscador','buscador-inteligente.js','extraerMedidas','consulta','Array<string>','Busca \b(\d{2,3})\s*cm?\b'),
    ,@('buscador','buscador-inteligente.js','extraerColores','consulta','Array<string>','hormigon/grafito/mezzo/caju/sahara/terra/nero/blanco/negro'),
    ,@('buscador','buscador-inteligente.js','calcularScore','producto, consulta, medidas, colores, contexto','number','Scoring 6 dimensiones'),
    ,@('buscador','buscador-inteligente.js','buscar','consulta, seccion?, limit?, contexto?','object','Motor principal: filtro score>=20'),
    ,@('buscador','buscador-inteligente.js','buscarPorCodigo','codigo, seccion?','object|{error}','Búsqueda exacta normalizada'),
    ,@('buscador','buscador-inteligente.js','listarPorCodigos','codigos[], seccion?','Array<producto>','Filtra catálogo por códigos'),
    ,@('buscador','buscador-inteligente.js','sugerencias','inicio, seccion?, limit=5','Array<{codigo,nombre,categoria}>','Autocomplete'),
    ,@('buscador','buscador-con-contexto.js','buscarConContexto','numero, consulta, opciones?','object','Enriquece búsqueda con memoria del cliente'),
    ,@('buscador','buscador-con-contexto.js','generarRecomendacion','resultados, memoria, perfil','string','Adapta respuesta a interno/PDV/externo'),
    ,@('buscador','buscador-con-contexto.js','obtenerDetalles','numero, codigo','object|{error}','Busca por código exacto con contexto'),
    ,@('buscador','navegacion-rubros.js','detectarRubro','consulta','string|null','Match en ALIASES_RUBRO'),
    ,@('buscador','navegacion-rubros.js','detectarFueraDeScope','consulta','string|null','Match en ALIASES_FUERA_SCOPE'),
    ,@('buscador','navegacion-rubros.js','obtenerSubrubros','rubro','Array<{nombre,codigos}>','Lee rubros-bano.json'),
    ,@('buscador','navegacion-rubros.js','obtenerProductos','rubro, subrubro?','Array<string>','Códigos sin discontinuados'),
    ,@('buscador','navegacion-rubros.js','detectarEleccionSubrubro','texto, opciones','string|null','Match fuzzy'),
    ,@('buscador','catalogo-maestro.js','cargar','-','{total,porRubro}','Cache 60s'),
    ,@('buscador','catalogo-maestro.js','resumenParaPrompt','-','string','Texto para inyectar en system prompt'),
    ,@('config','usuarios-manager.js','normalizarNumero','numero','string','Solo dígitos'),
    ,@('config','usuarios-manager.js','esInterno','numero','boolean','Fijos + extras'),
    ,@('config','usuarios-manager.js','esAdmin','numero','boolean','Compara con ADMIN_NUMERO'),
    ,@('config','usuarios-manager.js','obtenerUsuario','numero','{nombre,perfil,numero,tipo}|null','Busca en fijos y extras'),
    ,@('config','usuarios-manager.js','agregarUsuario','numero, nombre','{ok,error?,usuario?}','Persiste a usuarios-extras.json'),
    ,@('config','usuarios-manager.js','quitarUsuario','numero','{ok,error?}','No permite borrar fijos'),
    ,@('config','usuarios-manager.js','listarUsuarios','-','{fijos[],extras[]}','Ambas listas'),
    ,@('memoria','memoria-manager.js','cargarMemoria','numero','object','Crea estructura si no existe'),
    ,@('memoria','memoria-manager.js','guardarMemoria','numero, memoria','void','Persiste a {numero}.json'),
    ,@('memoria','memoria-manager.js','registrarMensaje','numero, rol, texto','object','Trunca historial a 20'),
    ,@('memoria','memoria-manager.js','actualizarNombre','numero, nombre, perfil?','void','-'),
    ,@('memoria','memoria-manager.js','actualizarContexto','numero, {seccion?,producto?,color?,medida?}','object','Limita historiales 10/3/3'),
    ,@('memoria','memoria-manager.js','obtenerHistorialClaude','numero','Array<{role,content}>','Formato Claude API'),
    ,@('memoria','memoria-manager.js','generarSaludo','numero','string','Personalizado nuevo/recurrente'),
    ,@('memoria','memoria-manager.js','resumenCliente','numero','string','Para inyectar en system prompt'),
    ,@('memoria','memoria-manager.js','listarClientes','-','Array<{numero,nombre,perfil,...}>','Sorted por total_consultas desc'),
    ,@('memoria','memoria-manager.js','esPrimeraVezHoy','numero','boolean','-'),
    ,@('memoria','memoria-manager.js','esNumeroNuevo','numero','boolean','Sin nombre o total=0'),
    ,@('memoria','memoria-manager.js','estaEsperandoNombre','numero','boolean','Flag conversacional'),
    ,@('memoria','memoria-manager.js','marcarEsperandoNombre','numero, esperando','void','Setea flag'),
    ,@('memoria','memoria-manager.js','estaEsperandoSiCliente','numero','boolean','Flag conversacional'),
    ,@('memoria','memoria-manager.js','marcarEsperandoSiCliente','numero, esperando','void','Setea flag'),
    ,@('memoria','memoria-manager.js','estaEsperandoNombreYCuit','numero','boolean','Flag conversacional'),
    ,@('memoria','memoria-manager.js','marcarEsperandoNombreYCuit','numero, esperando','void','Setea flag'),
    ,@('memoria','memoria-manager.js','guardarCuit','numero, cuit, verificado?','void','-'),
    ,@('memoria','memoria-manager.js','esClienteVerificado','numero','boolean','-'),
    ,@('memoria','memoria-manager.js','estaEsperandoSubrubro','numero','object|null','-'),
    ,@('memoria','memoria-manager.js','marcarEsperandoSubrubro','numero, datos','void','-'),
    ,@('memoria','memoria-manager.js','guardarConsultaPendiente','numero, texto','void','-'),
    ,@('memoria','memoria-manager.js','obtenerConsultaPendiente','numero','string|null','-'),
    ,@('memoria','memoria-manager.js','limpiarConsultaPendiente','numero','void','-'),
    ,@('memoria','memoria-manager.js','asignarListaPrecios','numero, lista','boolean','madre/may1/may2'),
    ,@('memoria','memoria-manager.js','obtenerListaPrecios','numero','string','-'),
    ,@('memoria','memoria-manager.js','guardarNombreDesdeChat','numero, nombre','string','Capitaliza y persiste'),
    ,@('media','media-manager.js','obtenerImagen','codigo','string|null','Ruta absoluta'),
    ,@('media','media-manager.js','obtenerPDF','codigo','string|null','Con fallbacks: EDM->VEDM, V\d+->V\d+U, sin sufijos, prefijo'),
    ,@('media','media-manager.js','obtenerMedia','codigo','{codigo,imagen?,pdf?}|null','Ambos en un objeto'),
    ,@('media','media-manager.js','listarTodoElMedia','-','{imagenes[],pdf[]}','Scan dirs'),
    ,@('media','media-manager.js','generarIndice','-','object','Persiste indice.json'),
    ,@('media','media-manager.js','resumenCobertura','-','void','Imprime a console'),
    ,@('gastos','gastos/index.js','procesarGasto','textoCrudo','Promise<string>','Orquesta parser+sheets-client; devuelve confirmación'),
    ,@('gastos','gastos/detector.js','esGasto','texto','boolean','Comienza con prefijo gasto/gastos'),
    ,@('gastos','gastos/detector.js','quitarPrefijo','texto','string','Extrae contenido post-prefijo'),
    ,@('gastos','gastos/parser.js','parsearGastos','texto','Promise<Array<{descripcion,monto,medio_pago}>>','Claude Haiku con system prompt estricto'),
    ,@('gastos','gastos/sheets-client.js','configurado','-','boolean','Chequea env vars'),
    ,@('gastos','gastos/sheets-client.js','obtenerAccessToken','-','Promise<string>','JWT firmado RSA-SHA256, cache 50min'),
    ,@('gastos','gastos/sheets-client.js','appendGastos','filas[]','Promise<{ok,filasAgregadas?,error?}>','Append rows a Sheets API'),
    ,@('sync','sync-dux.js','descargarTodosLosItems','-','Promise<Array>','Paginación 50, retry en 429'),
    ,@('sync','sync-dux.js','procesarProductos','items','Array<{codigo,nombre,rubro,sub_rubro,...}>','Mapea items a producto básico'),
    ,@('sync','sync-dux.js','procesarStock','items','object','Por código: stockTotal + variantes por color/depósito'),
    ,@('sync','sync-dux.js','procesarPrecios','items','object','3 listas: 57669/58940/59895'),
    ,@('sync','sync-dux.js','construirArbolRubros','items','object','Árbol rubro->subrubro->códigos'),
    ,@('sync','sync-dux.js','guardarJSON','nombre, datos','void','Escritura atómica .tmp -> rename'),
    ,@('sync','sync-dux.js','ejecutarSync','-','Promise<void>','Orquesta todo, log a sync.log'),
    ,@('sync','runner.js','ejecutarSync','-','void','Spawn alternativo (no usado en Railway)'),
    ,@('stock-control','router.js','parseJsonSeguro','raw','object','Strippea BOM EF BB BF antes de parsear'),
    ,@('stock-control','router.js','leerProductos','-','Array','Cache en memoria'),
    ,@('stock-control','router.js','leerStock','-','object','Lee stock.json cada request (data fresca)'),
    ,@('stock-control','router.js','stockDeVariante','stock, codigo, color?','number|null','-'),
    ,@('stock-control','sheet.js','configurado','-','boolean','Chequea STOCK_SHEET_ID y SA'),
    ,@('stock-control','sheet.js','obtenerAccessToken','-','Promise<string>','JWT + OAuth2'),
    ,@('stock-control','sheet.js','asegurarCabecera','token','Promise<void>','Single-execution con flag'),
    ,@('stock-control','sheet.js','appendMovimientos','filas[]','Promise<{ok,filasAgregadas?,error?}>','Append a Movimientos sheet')
)
Add-Sheet $wb $excel 'Funciones' @('Modulo','Archivo','Funcion','Parametros','Devuelve','Proposito') $funcionesRows | Out-Null

# ---------- Endpoints ----------
$endpointsRows = @(
    ,@('POST','/webhook','core/index.js','TwiML form','TwiML XML','Webhook Twilio - mensajes WhatsApp entrantes'),
    ,@('GET','/','core/index.js','-','{ok,version,...}','Health check + estado de datos-dux y usuarios'),
    ,@('GET','/debug/media','core/index.js','-','{imagenes[],pdf[]}','Lista todos los PDFs e imágenes con URLs'),
    ,@('GET','/debug/producto/:codigo','core/index.js','-','producto','Datos completos del producto'),
    ,@('GET','/debug/pdf/:codigo','core/index.js','-','{archivo,tamano,url,...}','Info PDF + validación Twilio'),
    ,@('*','/media/*','core (express.static)','-','file','Sirve estática: PDFs e imágenes'),
    ,@('GET','/control/api/productos','stock-control/router.js','-','{ok,productos[],total}','Lista de productos para PWA'),
    ,@('GET','/control/api/health','stock-control/router.js','-','{ok,productos:N,stockArchivo,sheetConfigurado}','Health del módulo stock-control'),
    ,@('POST','/control/api/movimientos','stock-control/router.js','{operario,items[]}','{ok,filasAgregadas,idCarga}','Registra movimiento -> Google Sheets'),
    ,@('GET','/control/','stock-control (express.static)','-','HTML','Sirve PWA frontend (carrito de variantes)')
)
Add-Sheet $wb $excel 'Endpoints' @('Metodo','Path','Modulo','Body/Params','Respuesta','Proposito') $endpointsRows | Out-Null

# ---------- Variables_Entorno ----------
$envRows = @(
    ,@('ANTHROPIC_API_KEY','core','Si','Claude Haiku 4.5'),
    ,@('OPENAI_API_KEY','core','Si','Whisper (audios WhatsApp)'),
    ,@('TWILIO_ACCOUNT_SID','core','Si','Twilio SID'),
    ,@('TWILIO_AUTH_TOKEN','core','Si','Twilio token'),
    ,@('RAILWAY_STATIC_URL','core','Auto en Railway','Base pública para servir /media'),
    ,@('BASE_URL','core','Fallback local','Reemplaza a RAILWAY_STATIC_URL'),
    ,@('DUX_TOKEN','sync','Si','Authorization a Dux ERP'),
    ,@('DUX_BASE','sync','No','Default: https://erp.duxsoftware.com.ar/WSERP/rest/services'),
    ,@('GASTOS_SHEET_ID','gastos','Si (módulo gastos)','Sheet de gastos personales'),
    ,@('GASTOS_SHEET_TAB','gastos','No','Default: Gastos'),
    ,@('GOOGLE_SA_EMAIL','gastos+stock','Si','SA mh-gastos-bot@mh-gastos.iam.gserviceaccount.com'),
    ,@('GOOGLE_SA_PRIVATE_KEY','gastos+stock','Si','Con \n literales'),
    ,@('STOCK_SHEET_ID','stock-control','Si (módulo stock)','1yfzi8OebptBh7JvZovYHhugut5q8V2rGcb13Ny2n6JY'),
    ,@('STOCK_SHEET_TAB','stock-control','No','Default: Movimientos')
)
Add-Sheet $wb $excel 'Variables_Entorno' @('Variable','Modulo','Obligatoria','Descripcion') $envRows | Out-Null

# ---------- Estructuras ----------
$estructurasRows = @(
    ,@('memoria_cliente','memoria-manager','numero','string','Número WhatsApp normalizado'),
    ,@('memoria_cliente','memoria-manager','nombre','string|null','Nombre del cliente'),
    ,@('memoria_cliente','memoria-manager','perfil','string|null','interno/externo/PDV'),
    ,@('memoria_cliente','memoria-manager','lista_precios','madre|may1|may2','Lista asignada'),
    ,@('memoria_cliente','memoria-manager','primera_consulta','string','Fecha primera consulta'),
    ,@('memoria_cliente','memoria-manager','ultima_consulta','string','Fecha última consulta'),
    ,@('memoria_cliente','memoria-manager','total_consultas','number','Contador'),
    ,@('memoria_cliente','memoria-manager','historial','Array<{ts,rol,texto}>','Máximo 20 entradas'),
    ,@('memoria_cliente','memoria-manager','contexto.ultima_seccion','string','-'),
    ,@('memoria_cliente','memoria-manager','contexto.ultimo_producto','string|null','-'),
    ,@('memoria_cliente','memoria-manager','contexto.productos_vistos','Array<string>','Máximo 10'),
    ,@('memoria_cliente','memoria-manager','contexto.preferencias_color','Array<string>','Máximo 3'),
    ,@('memoria_cliente','memoria-manager','contexto.preferencias_medida','Array<string>','Máximo 3'),
    ,@('memoria_cliente','memoria-manager','contexto.esperando_*','boolean','Flags de flow conversacional'),
    ,@('memoria_cliente','memoria-manager','contexto.cuit','string|null','-'),
    ,@('memoria_cliente','memoria-manager','contexto.cliente_verificado','boolean','-'),
    ,@('producto_catalogo','baño.json','codigo','string','SKU - clave principal'),
    ,@('producto_catalogo','baño.json','nombre','string','Descripción completa'),
    ,@('producto_catalogo','baño.json','seccion','string','Siempre baño por ahora'),
    ,@('producto_catalogo','baño.json','categoria','string','vanitory, bacha, mesada, etc'),
    ,@('producto_catalogo','baño.json','linea','string','piatto, marbela, classic'),
    ,@('producto_catalogo','baño.json','medida','string','60, 80, 100, 120 cm'),
    ,@('producto_catalogo','baño.json','guardado','string','puertas, cajones, hueco'),
    ,@('producto_catalogo','baño.json','colores','Array<string>','-'),
    ,@('producto_catalogo','baño.json','familia','string','Agrupador (ej VANITORY PIATTO)'),
    ,@('producto_catalogo','baño.json','variantes_familia','Array<{codigo,colores,...}>','-'),
    ,@('producto_catalogo','baño.json','keywords','Array<string>','~50-100 keywords para search'),
    ,@('producto_catalogo','baño.json','stock','number','Sobreescrito por sync'),
    ,@('producto_catalogo','baño.json','stock_variantes','{COLOR/DEPOSITO:{stock,stockReal,reservado,deposito}}','-'),
    ,@('producto_catalogo','baño.json','precios.madre','number','Lista MADRE 1925'),
    ,@('producto_catalogo','baño.json','precios.mayorista1','number','MAYORISTA 1'),
    ,@('producto_catalogo','baño.json','precios.mayorista2','number','MAYORISTA 2'),
    ,@('producto_catalogo','baño.json','tipo_familia','string','medida_color, etc'),
    ,@('producto_catalogo','baño.json','desc_larga','string','-'),
    ,@('producto_catalogo','baño.json','frase','string','Marketing copy'),
    ,@('producto_catalogo','baño.json','es_componente','boolean','-'),
    ,@('stock_dux','datos-dux/stock.json','{codigo}.nombre','string','-'),
    ,@('stock_dux','datos-dux/stock.json','{codigo}.stockTotal','number','Suma de variantes'),
    ,@('stock_dux','datos-dux/stock.json','{codigo}.variantes.{COLOR}.stock','number','-'),
    ,@('stock_dux','datos-dux/stock.json','{codigo}.variantes.{COLOR}.stockReal','number','Real - reservado'),
    ,@('stock_dux','datos-dux/stock.json','{codigo}.variantes.{COLOR}.reservado','number','-'),
    ,@('stock_dux','datos-dux/stock.json','{codigo}.variantes.{COLOR}.deposito','string','Nombre del depósito'),
    ,@('precios_dux','datos-dux/precios.json','{idLista}.nombre','string','LISTA MADRE 1925, etc'),
    ,@('precios_dux','datos-dux/precios.json','{idLista}.items.{codigo}.precio','number','Precio en pesos'),
    ,@('rubros_dux','datos-dux/rubros-bano.json','{RUBRO}.subrubros','Array<{nombre,codigos}>','-'),
    ,@('rubros_dux','datos-dux/rubros-bano.json','{RUBRO}.productos','Array<string>','Códigos del rubro'),
    ,@('gasto','gastos/parser','descripcion','string','Capitalizada'),
    ,@('gasto','gastos/parser','monto','number','Entero en pesos'),
    ,@('gasto','gastos/parser','medio_pago','string','Normalizado a valores fijos'),
    ,@('fila_gastos_sheet','gastos/sheets-client','col A','string','Fecha/Hora Argentina'),
    ,@('fila_gastos_sheet','gastos/sheets-client','col B','string','Descripción'),
    ,@('fila_gastos_sheet','gastos/sheets-client','col C','number','Monto'),
    ,@('fila_gastos_sheet','gastos/sheets-client','col D','string','Medio de pago'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col A','string','Fecha/Hora'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col B','string','Operario'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col C','string','Tipo (entrada/salida)'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col D','string','Código Producto'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col E','string','Producto (nombre)'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col F','string','Color'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col G','string','Talle'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col H','number','Cantidad'),
    ,@('fila_movimientos_sheet','stock-control/sheet','col I','string','ID Carga (lote)'),
    ,@('resultado_buscar','buscador-inteligente','consulta','string','Texto original'),
    ,@('resultado_buscar','buscador-inteligente','seccion','string','-'),
    ,@('resultado_buscar','buscador-inteligente','medidas_detectadas','Array<string>','-'),
    ,@('resultado_buscar','buscador-inteligente','colores_detectados','Array<string>','-'),
    ,@('resultado_buscar','buscador-inteligente','resultados','Array<producto+score>','Score >= 20, sorted desc'),
    ,@('resultado_buscar','buscador-inteligente','confianza','alta|media|baja','-'),
    ,@('resultado_buscar','buscador-inteligente','pedir_mas_detalle','boolean','-'),
    ,@('item_movimiento','stock-control/router','codigo','string','SKU'),
    ,@('item_movimiento','stock-control/router','qty','number','Positivo=carga, negativo=descarga'),
    ,@('item_movimiento','stock-control/router','color','string?','Variante color'),
    ,@('item_movimiento','stock-control/router','talle','string?','Si aplica')
)
Add-Sheet $wb $excel 'Estructuras' @('Estructura','Modulo','Campo','Tipo','Descripcion') $estructurasRows | Out-Null

# ---------- Constantes ----------
$constantesRows = @(
    ,@('VERSION','core/index.js','"4.1.4"','string','Versión del bot'),
    ,@('CORRECCIONES_AUDIO','core/index.js','Array<[RegExp,string]>','array','Normaliza errores de Whisper (vmini, hormigon, etc.)'),
    ,@('VARIANTES_CONOCIDAS','core/index.js','[SAHARA,CAJU,GRAFITO,HORMIGON,MEZZO,BLANCO,NEGRO,NERO,TERRA]','Array<string>','Colores disponibles'),
    ,@('USUARIOS_FIJOS','config/usuarios-manager.js','{numero:{nombre,perfil,admin?}}','object','Hardcoded - persisten en deploys'),
    ,@('ADMIN_NUMERO','config/usuarios-manager.js','5491149460531','string','Cristian (admin único)'),
    ,@('RUBROS_VISIBLES','buscador/navegacion-rubros.js','[MUEBLES,BACHAS,MESADAS,ESPEJOS Y BOTIQUINES]','Array<string>','Visibles al cliente'),
    ,@('RUBRO_A_SECCION','buscador/navegacion-rubros.js','{MUEBLES:bano,BACHAS:bano,...}','object','Mapeo a JSON catálogo'),
    ,@('ALIASES_RUBRO','buscador/navegacion-rubros.js','Array<[regex,rubro]>','array','Sinónimos: vanitorios->MUEBLES'),
    ,@('ALIASES_FUERA_SCOPE','buscador/navegacion-rubros.js','[placard,cocina,classic,unero,sanitario,...]','Array<string>','Rechaza fuera de baño'),
    ,@('PREFIJO','gastos/detector.js','/^gastos?\b\s*[:\-]?\s*/i','RegExp','Prefijo gasto/gastos'),
    ,@('LISTA_57669','sync-dux.js','LISTA MADRE 1925','number-string','-'),
    ,@('LISTA_58940','sync-dux.js','LISTA MAYORISTA 1','number-string','-'),
    ,@('LISTA_59895','sync-dux.js','LISTA MAYORISTA 2','number-string','-'),
    ,@('OPERARIOS','stock-control/public','[Juan,Tizi,Marcos,Cristian,Agustín,Lucas,Germán,Julián,Miguel]','Array<string>','Selector PWA (localStorage)'),
    ,@('HEADER_MOVIMIENTOS','stock-control/sheet.js','[Fecha/Hora,Operario,Tipo,Código Producto,Producto,Color,Talle,Cantidad,ID Carga]','Array<string>','Auto-insertado en Sheet')
)
Add-Sheet $wb $excel 'Constantes' @('Nombre','Modulo','Valor','Tipo','Descripcion') $constantesRows | Out-Null

# ---------- Flujos ----------
$flujosRows = @(
    ,@('A. Mensaje WhatsApp','1','POST /webhook (Twilio)','Twilio'),
    ,@('A. Mensaje WhatsApp','2','procesarMensaje(numero, texto, mediaUrl)','core/index.js'),
    ,@('A. Mensaje WhatsApp','3','Si audio: transcribirAudio + corregirTranscripcion','core/index.js'),
    ,@('A. Mensaje WhatsApp','4','Validar esInterno -> rechazo si no','config/usuarios-manager.js'),
    ,@('A. Mensaje WhatsApp','5','esGasto + esAdmin -> procesarGasto','gastos/'),
    ,@('A. Mensaje WhatsApp','6','detectarComandoAdmin -> ejecutarComandoAdmin','core/index.js'),
    ,@('A. Mensaje WhatsApp','7','detectarPedidoMedia -> enviarMedia','core/index.js + media-manager'),
    ,@('A. Mensaje WhatsApp','8','Casual reply (hola/gracias/ok)','core/index.js'),
    ,@('A. Mensaje WhatsApp','9','Modo 1: extraerCodigo -> buscarPorCodigo -> formatearCodigoExacto','buscador-inteligente'),
    ,@('A. Mensaje WhatsApp','10','Modo 3: detectarRubroSolo -> obtenerProductos -> formatearListaSimple','navegacion-rubros'),
    ,@('A. Mensaje WhatsApp','11','Modo 2: buscarConContexto -> llamarClaude(prompt enriquecido)','buscador-con-contexto'),
    ,@('A. Mensaje WhatsApp','12','enviarMensaje + opcional enviarMedia','core/index.js'),
    ,@('A. Mensaje WhatsApp','13','registrarMensaje(numero, "assistant", respuesta)','memoria-manager'),
    ,@('B. Sync Dux','1','startup +5s O cron horario "0 * * * *"','core/index.js'),
    ,@('B. Sync Dux','2','ejecutarSync() -> spawn node sync-dux.js','core/index.js'),
    ,@('B. Sync Dux','3','descargarTodosLosItems (paginación 50, retry 429)','sync-dux.js'),
    ,@('B. Sync Dux','4','procesarProductos / Stock / Precios / Rubros','sync-dux.js'),
    ,@('B. Sync Dux','5','guardarJSON atómico (.tmp -> rename)','sync-dux.js'),
    ,@('B. Sync Dux','6','Output: datos-dux/{stock,precios,productos,rubros-bano}.json','sync-dux.js'),
    ,@('B. Sync Dux','7','Log a registros/sync.log con timestamp Argentina','sync-dux.js'),
    ,@('C. Gasto admin','1','Mensaje: gasto: carniceria 20.000 mercado pago','-'),
    ,@('C. Gasto admin','2','esGasto + esAdmin -> procesarGasto(texto)','gastos/index.js'),
    ,@('C. Gasto admin','3','quitarPrefijo','gastos/detector.js'),
    ,@('C. Gasto admin','4','parsearGastos (Claude Haiku JSON)','gastos/parser.js'),
    ,@('C. Gasto admin','5','appendGastos (JWT -> Google Sheets append)','gastos/sheets-client.js'),
    ,@('C. Gasto admin','6','Confirmación: OK Carniceria $20.000 - Mercado Pago','-'),
    ,@('D. Movimiento stock','1','Operario en /control (móvil)','PWA'),
    ,@('D. Movimiento stock','2','Buscar variante -> fila fija con +/- y +5/+10','PWA frontend'),
    ,@('D. Movimiento stock','3','Confirmar -> POST /control/api/movimientos','PWA frontend'),
    ,@('D. Movimiento stock','4','asegurarCabecera (single-execution)','stock-control/sheet.js'),
    ,@('D. Movimiento stock','5','appendMovimientos -> Sheet Movimientos','stock-control/sheet.js'),
    ,@('D. Movimiento stock','6','Respuesta: {ok, filasAgregadas, idCarga}','stock-control/router.js'),
    ,@('D. Movimiento stock','7','Cristian importa el Sheet a Dux ERP sin transformar','-')
)
Add-Sheet $wb $excel 'Flujos' @('Flujo','Paso','Accion','Modulo o Funcion') $flujosRows | Out-Null

$wb.Sheets.Item('README').Activate()
$wb.SaveAs($outPath, 51)
$wb.Close($false)
$excel.Quit()
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($wb) | Out-Null
[System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
[GC]::Collect()
[GC]::WaitForPendingFinalizers()

Write-Host ""
Write-Host "Excel generado en: $outPath" -ForegroundColor Green
Write-Host "Abriendo..." -ForegroundColor Cyan
Start-Process $outPath
