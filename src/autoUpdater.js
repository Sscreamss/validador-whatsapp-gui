// autoUpdater.js - Sistema de actualización automática via GitHub Releases
const { autoUpdater } = require("electron-updater");
const { ipcMain } = require("electron");

let mainWindow = null;
let updateLog = null;

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
  autoUpdater.autoInstallOnAppQuit = true;
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
    log(`📦 Actualización descargada: v${info.version}. Lista para instalar.`);
    sendToRenderer("updater:status", {
      status: "downloaded",
      version: info.version
    });
  });

  autoUpdater.on("error", (error) => {
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
    log("🔄 Instalando actualización y reiniciando...");
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle("updater:get-version", () => {
    const { app } = require("electron");
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