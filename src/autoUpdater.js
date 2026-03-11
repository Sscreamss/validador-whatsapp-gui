// autoUpdater.js - Sistema de actualización automática via GitHub Releases
const { autoUpdater } = require("electron-updater");
const { ipcMain, shell, app } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;
let updateLog = null;
let downloadedDmgPath = null; // Guardamos la ruta del DMG descargado

function log(message) {
  console.log(`[AutoUpdater] ${message}`);
  updateLog?.({
    at: new Date().toISOString(),
    type: "AUTO_UPDATE",
    message
  });
}

function setupAutoUpdater(win, onLog) {
  mainWindow = win;
  updateLog = onLog;

  // Configuración
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // Lo manejamos nosotros
  autoUpdater.allowDowngrade = false;

  // ═══════════════════════════════════════
  // EVENTOS DEL AUTO-UPDATER
  // ═══════════════════════════════════════

  autoUpdater.on("checking-for-update", () => {
    log("🔍 Buscando actualizaciones...");
    sendToRenderer("updater:status", { status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    log(`✅ Nueva versión disponible: v${info.version}`);
    sendToRenderer("updater:status", {
      status: "available",
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes || ""
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    log(`👍 Ya tenés la última versión (v${info.version})`);
    sendToRenderer("updater:status", {
      status: "up-to-date",
      version: info.version
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.round(progress.percent);
    log(`⬇️ Descargando: ${percent}% (${formatBytes(progress.transferred)} / ${formatBytes(progress.total)})`);
    sendToRenderer("updater:progress", {
      percent,
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    log(`📦 Actualización descargada: v${info.version}. Buscando DMG...`);

    // Buscar el DMG descargado en la carpeta cache del updater
    downloadedDmgPath = findDownloadedDmg(info.version);

    if (downloadedDmgPath) {
      log(`📦 DMG encontrado: ${downloadedDmgPath}`);
    } else {
      log(`⚠️ No se encontró el DMG, se abrirá la página de releases`);
    }

    sendToRenderer("updater:status", {
      status: "downloaded",
      version: info.version,
      dmgFound: !!downloadedDmgPath
    });
  });

  autoUpdater.on("error", (error) => {
    // Ignorar el error de code signature — la descarga ya fue exitosa
    if (error.message.includes("Could not get code signature")) {
      log(`⚠️ Sin firma de código (normal en apps no certificadas), continuando...`);
      return; // No enviar error al renderer, update-downloaded ya se disparó
    }
    log(`❌ Error en actualización: ${error.message}`);
    sendToRenderer("updater:status", {
      status: "error",
      error: error.message
    });
  });

  // ═══════════════════════════════════════
  // IPC HANDLERS (desde el renderer)
  // ═══════════════════════════════════════

  ipcMain.handle("updater:check", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      return { ok: true, version: result?.updateInfo?.version };
    } catch (error) {
      log(`❌ Error verificando: ${error.message}`);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("updater:download", async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      log(`❌ Error descargando: ${error.message}`);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("updater:install", () => {
    log("🔄 Iniciando instalación...");

    if (downloadedDmgPath && fs.existsSync(downloadedDmgPath)) {
      // ✅ Abrir el DMG directamente — el usuario arrastra la app a /Applications
      log(`📂 Abriendo DMG: ${downloadedDmgPath}`);
      shell.openPath(downloadedDmgPath);
    } else {
      // Fallback: abrir la página de releases en GitHub
      log(`🌐 Abriendo página de releases en GitHub`);
      shell.openExternal("https://github.com/Sscreamss/validador-whatsapp-gui/releases/latest");
    }

    // Cerrar la app después de un momento para que el usuario pueda instalar
    setTimeout(() => {
      app.quit();
    }, 1500);
  });

  ipcMain.handle("updater:get-version", () => {
    return app.getVersion();
  });

  // ═══════════════════════════════════════
  // CHECK INMEDIATO al arrancar
  // ═══════════════════════════════════════
  log("🚀 Verificando actualizaciones al iniciar...");
  autoUpdater.checkForUpdates().catch((err) => {
    log(`⚠️ No se pudo verificar actualizaciones: ${err.message}`);
    sendToRenderer("updater:status", { status: "offline" });
  });

  // Re-verificar cada 24 horas
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  setInterval(() => {
    log("🔄 Verificación periódica de actualizaciones (24h)...");
    autoUpdater.checkForUpdates().catch((err) => {
      log(`⚠️ No se pudo verificar actualizaciones: ${err.message}`);
    });
  }, TWENTY_FOUR_HOURS);
}

// ═══════════════════════════════════════
// BUSCAR DMG DESCARGADO EN CACHE
// ═══════════════════════════════════════
function findDownloadedDmg(version) {
  try {
    const cacheDir = path.join(app.getPath("cache"), "validador-whatsapp-gui-updater", "pending");
    if (!fs.existsSync(cacheDir)) return null;

    const files = fs.readdirSync(cacheDir);

    // Primero buscar el arm64 (Apple Silicon es lo más común)
    const arm64 = files.find(f => f.includes(version) && f.includes("arm64") && f.endsWith(".dmg"));
    if (arm64) return path.join(cacheDir, arm64);

    // Si no, buscar cualquier DMG de esa versión
    const anyDmg = files.find(f => f.includes(version) && f.endsWith(".dmg"));
    if (anyDmg) return path.join(cacheDir, anyDmg);

    return null;
  } catch (err) {
    log(`⚠️ Error buscando DMG en cache: ${err.message}`);
    return null;
  }
}

function sendToRenderer(channel, data) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  } catch {}
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

module.exports = { setupAutoUpdater };