// autoUpdater.js - Sistema de actualización automática via GitHub Releases
const { autoUpdater } = require("electron-updater");
const { ipcMain, shell, app } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;
let updateLog = null;
let downloadedFilePath = null; // Ruta del archivo descargado (DMG o ZIP)
let updateAlreadyChecked = false; // ← FLAG: evita múltiples checks al minimizar/maximizar

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

  // ══════════════════════════════════════════════════════════
  // GUARD: Si ya se configuró el updater, no volver a hacerlo
  // ══════════════════════════════════════════════════════════
  if (updateAlreadyChecked) {
    log("⏭️ Auto-updater ya fue inicializado, saltando...");
    return;
  }
  updateAlreadyChecked = true;

  // Configuración
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
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
    log(`📦 Actualización descargada: v${info.version}. Buscando archivo instalable...`);

    // Buscar el archivo descargado (DMG o ZIP) en todas las rutas posibles
    downloadedFilePath = findDownloadedInstaller(info.version);

    if (downloadedFilePath) {
      log(`📦 Archivo encontrado: ${downloadedFilePath}`);
    } else {
      log(`⚠️ No se encontró archivo instalable en cache`);
    }

    sendToRenderer("updater:status", {
      status: "downloaded",
      version: info.version,
      installerFound: !!downloadedFilePath
    });
  });

  autoUpdater.on("error", (error) => {
    // Ignorar el error de code signature — la descarga ya fue exitosa
    if (error.message.includes("Could not get code signature")) {
      log(`⚠️ Sin firma de código (normal en apps no certificadas), continuando...`);
      return;
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

    if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
      // ✅ Abrir el archivo descargado directamente
      // Si es un DMG → el usuario arrastra la app a /Applications
      // Si es un ZIP → macOS lo descomprime automáticamente
      log(`📂 Abriendo archivo: ${downloadedFilePath}`);
      shell.openPath(downloadedFilePath);

      // Cerrar la app después de un momento para que el usuario pueda instalar
      setTimeout(() => {
        app.quit();
      }, 2000);
    } else {
      // ═══════════════════════════════════════════════════════════
      // FALLBACK: Intentar quitAndInstall de electron-updater
      // ═══════════════════════════════════════════════════════════
      log(`🔄 Intentando quitAndInstall()...`);
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        log(`⚠️ quitAndInstall falló: ${err.message}. Abriendo releases...`);
        shell.openExternal("https://github.com/Sscreamss/validador-whatsapp-gui/releases/latest");
        setTimeout(() => {
          app.quit();
        }, 1500);
      }
    }
  });

  ipcMain.handle("updater:get-version", () => {
    return app.getVersion();
  });

  // ═══════════════════════════════════════
  // CHECK INICIAL (una sola vez)
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

// ═══════════════════════════════════════════════════════════
// BUSCAR ARCHIVO DESCARGADO (DMG, ZIP) EN TODAS LAS RUTAS
// ═══════════════════════════════════════════════════════════
function findDownloadedInstaller(version) {
  const appName = app.getName() || "validador-whatsapp-gui";

  // electron-updater guarda en distintas rutas según la versión y plataforma
  const possibleCacheDirs = [
    path.join(app.getPath("cache"), `${appName}-updater`, "pending"),
    path.join(app.getPath("cache"), `${appName}-updater`),
    path.join(app.getPath("temp"), `${appName}-updater`),
    path.join(app.getPath("cache"), "electron-updater", "pending"),
    path.join(app.getPath("cache"), "electron-updater"),
    // Ruta alternativa con el productName
    path.join(app.getPath("cache"), "Validador WhatsApp-updater", "pending"),
    path.join(app.getPath("cache"), "Validador WhatsApp-updater"),
  ];

  log(`🔎 Buscando instalador v${version} en ${possibleCacheDirs.length} directorios...`);

  for (const cacheDir of possibleCacheDirs) {
    try {
      if (!fs.existsSync(cacheDir)) continue;

      const files = fs.readdirSync(cacheDir);
      log(`   📁 ${cacheDir}: [${files.join(", ")}]`);

      // Buscar DMG primero (preferido para macOS)
      const dmg = files.find(f => f.endsWith(".dmg") && (f.includes(version) || files.length <= 3));
      if (dmg) return path.join(cacheDir, dmg);

      // Buscar ZIP como alternativa
      const zip = files.find(f => f.endsWith(".zip") && (f.includes(version) || files.length <= 3));
      if (zip) return path.join(cacheDir, zip);

      // Si solo hay un archivo .dmg o .zip en la carpeta, usarlo
      const anyInstaller = files.find(f => f.endsWith(".dmg") || f.endsWith(".zip"));
      if (anyInstaller) return path.join(cacheDir, anyInstaller);

    } catch (err) {
      log(`   ⚠️ Error leyendo ${cacheDir}: ${err.message}`);
    }
  }

  // Último recurso: buscar recursivamente en la carpeta cache
  try {
    const mainCache = app.getPath("cache");
    log(`   🔎 Búsqueda amplia en: ${mainCache}`);
    const found = findFileRecursive(mainCache, version, 2);
    if (found) return found;
  } catch (err) {
    log(`   ⚠️ Error en búsqueda amplia: ${err.message}`);
  }

  return null;
}

// Buscar archivo recursivamente (con profundidad limitada)
function findFileRecursive(dir, version, maxDepth) {
  if (maxDepth <= 0) return null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && (entry.name.endsWith(".dmg") || entry.name.endsWith(".zip")) && entry.name.includes(version)) {
        return fullPath;
      }
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const found = findFileRecursive(fullPath, version, maxDepth - 1);
        if (found) return found;
      }
    }
  } catch {}
  return null;
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