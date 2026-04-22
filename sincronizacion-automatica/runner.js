const cron = require("node-cron");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(__dirname, "../registros/runner.log");

function log(mensaje) {
  const timestamp = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  const linea = `[${timestamp}] ${mensaje}`;
  console.log(linea);
  if (!fs.existsSync(path.dirname(LOG_FILE))) fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, linea + "\n");
}

function ejecutarSync() {
  log("▶️  Ejecutando sincronización...");

  const proceso = spawn("node", [path.join(__dirname, "sync-dux.js")], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit"
  });

  proceso.on("close", (code) => {
    if (code === 0) {
      log("✅ Sincronización completada exitosamente\n");
    } else {
      log(`⚠️  Sincronización terminó con código ${code}\n`);
    }
  });

  proceso.on("error", (error) => {
    log(`❌ Error ejecutando sincronización: ${error.message}\n`);
  });
}

log("🚀 Iniciando sincronizador de Dux...");
log("📅 Cron schedule: Cada 60 minutos (*/60 * * * *)");
log("⏰ Próxima ejecución: 1 minuto desde ahora (y luego cada 60 min)");
log("---");

// Ejecutar inmediatamente al iniciar
ejecutarSync();

// Programar para que corra cada 60 minutos
cron.schedule("*/60 * * * *", () => {
  log("🔔 Trigger: 60 minutos han pasado");
  ejecutarSync();
});

log("✅ Runner activado. Presiona Ctrl+C para detener.\n");
