// updater-ui.js
// Maneja toda la UI del auto-updater en el renderer.
// Se inicializa UNA SOLA VEZ al arrancar la app.

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // FLAG GLOBAL: evita que se re-inicialice al minimizar/maximizar
  // ═══════════════════════════════════════════════════════════
  let updaterAlreadyInitialized = false;
  let updaterCompleted = false; // true cuando ya pasó el check (up-to-date, error, dev, etc.)

  // ─────────────────────────────────────────
  // OVERLAY HTML (se inyecta dinámicamente)
  // ─────────────────────────────────────────
  function createOverlayHTML() {
    return `
      <div id="updaterOverlay" class="updater-overlay hidden">
        <div class="updater-modal">

          <!-- Checking -->
          <div class="updater-state active" id="updaterChecking">
            <div class="updater-spinner"></div>
            <h2>Verificando actualizaciones...</h2>
            <p>Conectando con GitHub Releases</p>
          </div>

          <!-- Up to date -->
          <div class="updater-state" id="updaterUpToDate">
            <div class="updater-icon updater-icon--success">✓</div>
            <h2>¡Estás al día!</h2>
            <p id="upToDateVersion"></p>
            <button class="updater-btn updater-btn--primary" id="updaterContinueBtn">
              Continuar →
            </button>
          </div>

          <!-- Update available + descargando -->
          <div class="updater-state" id="updaterAvailable">
            <div class="updater-icon updater-icon--info">↓</div>
            <h2>Nueva versión disponible</h2>
            <p id="availableVersionText"></p>
            <p class="updater-subtitle">Descargando en segundo plano...</p>
            <div class="updater-progress-bar">
              <div class="updater-progress-fill" id="updaterProgressFill"></div>
            </div>
            <p class="updater-progress-text" id="updaterProgressText">0%</p>
          </div>

          <!-- Downloaded - ready to install -->
          <div class="updater-state" id="updaterDownloaded">
            <div class="updater-icon updater-icon--success">📦</div>
            <h2>Actualización lista</h2>
            <p id="downloadedVersionText"></p>
            <p class="updater-subtitle">Se descargó el instalador. Hacé clic para abrir e instalar.</p>
            <div class="updater-actions">
              <button class="updater-btn updater-btn--primary" id="updaterInstallBtn">
                Instalar ahora
              </button>
              <button class="updater-btn updater-btn--secondary" id="updaterLaterBtn">
                Más tarde
              </button>
            </div>
          </div>

          <!-- Error / Sin conexión -->
          <div class="updater-state" id="updaterError">
            <div class="updater-icon updater-icon--warn">⚠️</div>
            <h2>Sin conexión</h2>
            <p>No se pudo verificar actualizaciones.</p>
            <button class="updater-btn updater-btn--secondary" id="updaterOfflineBtn">
              Continuar sin actualizar
            </button>
          </div>

          <!-- Dev mode -->
          <div class="updater-state" id="updaterDev">
            <div class="updater-icon updater-icon--warn">🛠</div>
            <h2>Modo desarrollo</h2>
            <p>Las actualizaciones automáticas están desactivadas.</p>
            <button class="updater-btn updater-btn--secondary" id="updaterDevBtn">
              Continuar
            </button>
          </div>

        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────
  // ESTILOS CSS
  // ─────────────────────────────────────────
  function createStyles() {
    return `
      .updater-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(8px);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: updaterFadeIn 0.2s ease;
      }

      .updater-overlay.hidden {
        display: none !important;
      }

      @keyframes updaterFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }

      .updater-modal {
        background: var(--bg-card, #fff);
        border: 1px solid var(--border-color, #e0e0e0);
        border-radius: 20px;
        padding: 48px 40px;
        width: 420px;
        text-align: center;
        box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
        animation: updaterSlideUp 0.3s ease;
      }

      @keyframes updaterSlideUp {
        from { opacity: 0; transform: translateY(20px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .updater-state { display: none; }
      .updater-state.active { display: block; }

      .updater-spinner {
        width: 48px;
        height: 48px;
        border: 4px solid var(--border-color, #e0e0e0);
        border-top-color: var(--primary-color, #007AFF);
        border-radius: 50%;
        animation: updaterSpin 0.8s linear infinite;
        margin: 0 auto 24px;
      }

      @keyframes updaterSpin {
        to { transform: rotate(360deg); }
      }

      .updater-icon {
        width: 64px;
        height: 64px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        margin: 0 auto 20px;
      }

      .updater-icon--success { background: rgba(52, 199, 89, 0.15); }
      .updater-icon--info    { background: rgba(0, 122, 255, 0.15); }
      .updater-icon--warn    { background: rgba(255, 149, 0, 0.15); }

      .updater-modal h2 {
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--text-primary, #000);
        margin-bottom: 8px;
      }

      .updater-modal p {
        font-size: 0.95rem;
        color: var(--text-secondary, #555);
        margin-bottom: 8px;
      }

      .updater-subtitle {
        font-size: 0.85rem !important;
        color: var(--text-tertiary, #888) !important;
        margin-bottom: 20px !important;
      }

      .updater-progress-bar {
        background: var(--bg-secondary, #f0f0f0);
        border-radius: 99px;
        height: 8px;
        overflow: hidden;
        margin: 16px 0 8px;
      }

      .updater-progress-fill {
        height: 100%;
        background: var(--primary-color, #007AFF);
        border-radius: 99px;
        width: 0%;
        transition: width 0.3s ease;
      }

      .updater-progress-text {
        font-size: 0.8rem !important;
        color: var(--text-tertiary, #888) !important;
        margin-bottom: 0 !important;
      }

      .updater-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 24px;
      }

      .updater-btn {
        padding: 12px 28px;
        border-radius: 10px;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.15s ease;
      }

      .updater-btn--primary {
        background: var(--primary-color, #007AFF);
        color: #fff;
        margin-top: 24px;
      }

      .updater-btn--primary:hover {
        background: var(--primary-hover, #0056CC);
        transform: translateY(-1px);
      }

      .updater-btn--secondary {
        background: var(--bg-secondary, #f0f0f0);
        color: var(--text-primary, #000);
        margin-top: 8px;
      }

      .updater-btn--secondary:hover {
        background: var(--border-color, #d0d0d0);
      }
    `;
  }

  // ─────────────────────────────────────────
  // LÓGICA PRINCIPAL
  // ─────────────────────────────────────────
  function showState(stateId) {
    document.querySelectorAll('.updater-state').forEach(el => el.classList.remove('active'));
    const el = document.getElementById(stateId);
    if (el) el.classList.add('active');
  }

  function showOverlay() {
    document.getElementById('updaterOverlay')?.classList.remove('hidden');
  }

  function hideOverlay() {
    const overlay = document.getElementById('updaterOverlay');
    if (!overlay || overlay.classList.contains('hidden')) return;
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.2s ease';
    setTimeout(() => {
      overlay.classList.add('hidden');
      overlay.style.opacity = '';
      overlay.style.transition = '';
    }, 200);
  }

  function initUpdaterUI() {
    // ══════════════════════════════════════════════════
    // GUARD: No re-inicializar si ya se hizo
    // ══════════════════════════════════════════════════
    if (updaterAlreadyInitialized) {
      console.log('[UpdaterUI] Ya inicializado, ignorando re-init.');
      return;
    }
    updaterAlreadyInitialized = true;

    // Inyectar estilos
    const style = document.createElement('style');
    style.textContent = createStyles();
    document.head.appendChild(style);

    // Inyectar overlay HTML al body
    const wrapper = document.createElement('div');
    wrapper.innerHTML = createOverlayHTML();
    document.body.prepend(wrapper.firstElementChild);

    // Mostrar overlay — el estado "checking" ya tiene clase "active"
    showOverlay();

    // ── Timeout de seguridad: si en 15s no llega ningún evento, cerrar ──
    const safetyTimeout = setTimeout(() => {
      console.warn('[UpdaterUI] Timeout de seguridad — cerrando overlay');
      updaterCompleted = true;
      hideOverlay();
    }, 15000);

    function resolveUpdater() {
      clearTimeout(safetyTimeout);
      updaterCompleted = true;
    }

    // ── Botones ──
    document.getElementById('updaterContinueBtn')?.addEventListener('click', () => { resolveUpdater(); hideOverlay(); });
    document.getElementById('updaterOfflineBtn')?.addEventListener('click', () => { resolveUpdater(); hideOverlay(); });
    document.getElementById('updaterDevBtn')?.addEventListener('click', () => { resolveUpdater(); hideOverlay(); });
    document.getElementById('updaterLaterBtn')?.addEventListener('click', () => { resolveUpdater(); hideOverlay(); });

    document.getElementById('updaterInstallBtn')?.addEventListener('click', () => {
      resolveUpdater();
      // Llamar al main process para que abra el DMG/ZIP
      window.updaterAPI?.install();
    });

    // ── Escuchar estados del main process ──
    if (window.updaterAPI) {
      window.updaterAPI.onStatus((data) => {
        console.log('[UpdaterUI] Estado recibido:', data.status);

        // Si el updater ya completó su ciclo inicial, ignorar eventos
        // que re-dispararían el overlay (como "checking" de los intervals de 24h)
        if (updaterCompleted && data.status === 'checking') {
          console.log('[UpdaterUI] Check periódico ignorado (ya completó ciclo inicial).');
          return;
        }

        switch (data.status) {

          case 'checking':
            showState('updaterChecking');
            showOverlay();
            break;

          case 'up-to-date':
            resolveUpdater();
            showState('updaterUpToDate');
            const versionEl = document.getElementById('upToDateVersion');
            if (versionEl) versionEl.textContent = `Versión actual: v${data.version}`;
            setTimeout(hideOverlay, 1500);
            break;

          case 'available':
            showState('updaterAvailable');
            showOverlay();
            const availEl = document.getElementById('availableVersionText');
            if (availEl) availEl.textContent = `v${data.version} disponible — descargando...`;
            break;

          case 'downloaded':
            resolveUpdater();
            showState('updaterDownloaded');
            showOverlay();
            const dlEl = document.getElementById('downloadedVersionText');
            if (dlEl) dlEl.textContent = `v${data.version} lista para instalar`;
            break;

          case 'error':
          case 'offline':
            resolveUpdater();
            showState('updaterError');
            break;

          case 'dev':
            resolveUpdater();
            showState('updaterDev');
            setTimeout(hideOverlay, 1000);
            break;

          default:
            resolveUpdater();
            hideOverlay();
        }
      });

      window.updaterAPI.onProgress((data) => {
        const fill = document.getElementById('updaterProgressFill');
        const text = document.getElementById('updaterProgressText');
        if (fill) fill.style.width = `${data.percent}%`;
        if (text) {
          const mb = (data.transferred / 1024 / 1024).toFixed(1);
          const total = (data.total / 1024 / 1024).toFixed(1);
          text.textContent = `${data.percent}% — ${mb} MB / ${total} MB`;
        }
      });

    } else {
      // updaterAPI no disponible
      console.warn('[UpdaterUI] updaterAPI no disponible, cerrando overlay.');
      resolveUpdater();
      setTimeout(hideOverlay, 800);
    }
  }

  // Inicializar cuando el DOM esté listo (una sola vez)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpdaterUI);
  } else {
    initUpdaterUI();
  }

})();