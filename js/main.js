import { Recorder, MAX_DELAY } from './recorder.js';
import { Player, SPEED_CYCLE } from './player.js';
import { attachGestures, clampView, identityView } from './gestures.js';

const DEFAULT_DELAYS = [20, 40, 60];
const MIN_DELAY = 5;
const DELAY_STEP = 5;
const UNLOCK_HOLD_MS = 1000;
const SETTINGS_KEY = 'coachloop.settings';

const $ = (id) => document.getElementById(id);
const recorder = new Recorder();

// ---------- Réglages mémorisés ----------

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) ?? {};
  } catch {
    return {};
  }
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      delays: players.map((p) => p.delay),
      linkZoom,
      grid: gridsActive,
      cameraId: $('cameraSelect').value || null,
    }));
  } catch { /* stockage indisponible : sans conséquence */ }
}

const saved = loadSettings();
let linkZoom = Boolean(saved.linkZoom);
let gridsActive = Boolean(saved.grid);
let isLocked = false;
let activeIndex = 0;

// ---------- Messages ----------

const toastEl = $('toast');
let toastTimer = null;
function showToast(message, { action, onAction, kind = 'error', timeout = 6000 } = {}) {
  clearTimeout(toastTimer);
  toastEl.className = `toast ${kind === 'info' ? 'info' : ''}`;
  toastEl.textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action;
    btn.addEventListener('click', () => { hideToast(); onAction?.(); });
    toastEl.append(btn);
  }
  toastEl.hidden = false;
  if (timeout) toastTimer = setTimeout(hideToast, timeout);
}
function hideToast() {
  toastEl.hidden = true;
}

// ---------- Écrans ----------

const grid = $('mainGrid');
const consolePanel = $('consolePanel');
const template = $('screenTemplate');

const players = [0, 1, 2].map((index) => {
  const root = template.content.firstElementChild.cloneNode(true);
  root.id = `card${index}`;
  grid.insertBefore(root, consolePanel);
  const player = new Player({
    index,
    root,
    recorder,
    delay: clampDelay(saved.delays?.[index] ?? DEFAULT_DELAYS[index]),
    onViewChange: (from, view) => {
      if (!linkZoom) return;
      for (const other of players) if (other.index !== from) other.applyView(view);
    },
  });
  wireScreen(player);
  return player;
});

function clampDelay(v) {
  return Math.max(MIN_DELAY, Math.min(MAX_DELAY, Number(v) || MIN_DELAY));
}

function wireScreen(player) {
  const { root, el } = player;
  const activate = () => { activeIndex = player.index; };

  attachGestures(el.viewport, {
    getView: () => player.getView(),
    setView: (v) => player.setView(v),
    onActivity: () => { activate(); player.pokeHud(); if (player.state === 'ANALYSE') player.touch(); },
    onTap: () => player.pokeHud(),
    onScrubStart: () => player.scrubStart(),
    onScrubMove: (s) => player.scrubMove(s),
    onScrubEnd: () => player.scrubEnd(),
  });

  // Commandes de la barre (délégation : aucun gestionnaire en ligne dans le HTML)
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    activate();
    switch (btn.dataset.act) {
      case 'play': player.togglePlay(); break;
      case 'step-back': player.step(-1); break;
      case 'step-fwd': player.step(1); break;
      case 'jump-back': player.jump(-3); break;
      case 'jump-fwd': player.jump(3); break;
      case 'speed': player.cycleSpeed(); break;
      case 'live': player.returnToLive(); break;
      case 'fullscreen': toggleFullscreen(player); break;
    }
  });
  el.zoomBadge.addEventListener('click', () => player.setView(identityView()));

  el.scrub.addEventListener('pointerdown', () => { activate(); player.enterAnalysis(); });
  el.scrub.addEventListener('input', (e) => player.sliderInput(parseFloat(e.target.value)));
  el.scrub.addEventListener('change', () => player.sliderChange());

  // Souris : le HUD se réveille au passage
  root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') player.pokeHud(); });
  player.setGrid(gridsActive);
}

function toggleFullscreen(player) {
  const on = !player.root.classList.contains('is-fullscreen');
  players.forEach((p) => p.root.classList.remove('is-fullscreen'));
  player.root.classList.toggle('is-fullscreen', on);
}

// ---------- Console ----------

const steppersEl = $('steppers');
players.forEach((player) => {
  const box = document.createElement('div');
  box.className = 'stepper-box';
  box.innerHTML = `
    <span class="stepper-title">ÉCRAN ${player.index + 1}</span>
    <div class="stepper-inner">
      <button class="step-btn-touch" data-delta="-${DELAY_STEP}" aria-label="Réduire le décalage de l'écran ${player.index + 1}">−</button>
      <span class="step-display">${player.delay}s</span>
      <button class="step-btn-touch" data-delta="${DELAY_STEP}" aria-label="Augmenter le décalage de l'écran ${player.index + 1}">+</button>
    </div>`;
  const display = box.querySelector('.step-display');
  box.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delta]');
    if (!btn) return;
    player.setDelay(clampDelay(player.delay + Number(btn.dataset.delta)));
    display.textContent = `${player.delay}s`;
    saveSettings();
  });
  steppersEl.append(box);
});

const rateButtons = [...document.querySelectorAll('[data-rate]')];
rateButtons.forEach((btn) => btn.addEventListener('click', () => {
  const rate = Number(btn.dataset.rate);
  players.forEach((p) => p.setSpeed(rate));
}));
function syncRateButtons() {
  const speeds = new Set(players.map((p) => p.speed));
  const common = speeds.size === 1 ? [...speeds][0] : null;
  rateButtons.forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.rate) === common));
}

const gridBtn = $('gridBtn');
function renderGrid() {
  gridBtn.classList.toggle('active', gridsActive);
  gridBtn.setAttribute('aria-pressed', String(gridsActive));
  players.forEach((p) => p.setGrid(gridsActive));
}
gridBtn.addEventListener('click', () => { gridsActive = !gridsActive; renderGrid(); saveSettings(); });
renderGrid();

const linkBtn = $('linkZoomBtn');
function renderLink() {
  linkBtn.classList.toggle('active', linkZoom);
  linkBtn.setAttribute('aria-pressed', String(linkZoom));
  linkBtn.textContent = `Zoom lié sur les 3 écrans : ${linkZoom ? 'oui' : 'non'}`;
}
linkBtn.addEventListener('click', () => {
  linkZoom = !linkZoom;
  if (linkZoom) {
    const view = players[activeIndex].getView();
    players.forEach((p) => p.applyView(view));
  }
  renderLink();
  saveSettings();
});
renderLink();

// Verrou athlètes : un appui verrouille, un appui long (1 s) déverrouille
const lockBtn = $('lockBtn');
let lockTimer = null;
function renderLock() {
  consolePanel.classList.toggle('is-locked', isLocked);
  lockBtn.classList.toggle('locked', isLocked);
  $('lockIcon').textContent = isLocked ? '🔒' : '🔓';
  lockBtn.setAttribute('aria-label', isLocked ? 'Maintenir pour déverrouiller' : 'Verrouiller les réglages');
}
let swallowClick = false;
lockBtn.addEventListener('pointerdown', () => {
  swallowClick = false;
  if (!isLocked) return;
  lockTimer = setTimeout(() => {
    isLocked = false;
    swallowClick = true; // le relâchement qui suit ne doit pas reverrouiller
    renderLock();
  }, UNLOCK_HOLD_MS);
});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
  lockBtn.addEventListener(type, () => clearTimeout(lockTimer));
}
lockBtn.addEventListener('click', () => {
  if (swallowClick) { swallowClick = false; return; }
  if (!isLocked) { isLocked = true; renderLock(); }
  else showToast('Maintiens le cadenas 1 seconde pour déverrouiller.', { kind: 'info', timeout: 2500 });
});
renderLock();

// ---------- Séance ----------

const mainBtn = $('mainToggleBtn');
const cameraSelect = $('cameraSelect');
let wakeLock = null;
let loopId = null;

async function acquireWakeLock() {
  try {
    wakeLock = await navigator.wakeLock?.request('screen');
    wakeLock?.addEventListener('release', () => { wakeLock = null; });
  } catch { /* refusé (économie d'énergie) : on continue sans */ }
}

function describeError(err) {
  if (!window.isSecureContext) return 'La caméra exige une connexion sécurisée (HTTPS).';
  if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') return 'Ce navigateur ne gère pas l\'enregistrement vidéo.';
  switch (err?.name) {
    case 'NotAllowedError': return 'Accès à la caméra refusé. Autorise la caméra dans les réglages du navigateur.';
    case 'NotFoundError': return 'Aucune caméra détectée.';
    case 'NotReadableError': return 'La caméra est utilisée par une autre application.';
    case 'OverconstrainedError': return 'La caméra choisie n\'est pas disponible. Choisis-en une autre.';
    default: return `Impossible de démarrer la caméra${err?.message ? ` : ${err.message}` : '.'}`;
  }
}

async function populateCameras() {
  try {
    const cams = await recorder.listCameras();
    if (cams.length < 2) { cameraSelect.hidden = true; return; }
    const current = cameraSelect.value || saved.cameraId;
    cameraSelect.replaceChildren(...cams.map((c, i) => {
      const opt = document.createElement('option');
      opt.value = c.deviceId;
      opt.textContent = c.label || `Caméra ${i + 1}`;
      return opt;
    }));
    if (cams.some((c) => c.deviceId === current)) cameraSelect.value = current;
    cameraSelect.hidden = false;
  } catch { /* liste indisponible : le choix par défaut suffit */ }
}
cameraSelect.addEventListener('change', () => {
  saveSettings();
  if (recorder.running) showToast('La caméra choisie sera utilisée à la prochaine session.', { kind: 'info', timeout: 3000 });
});

async function startSession() {
  hideToast();
  if (!window.isSecureContext || !navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
    showToast(describeError());
    return;
  }
  mainBtn.disabled = true;
  try {
    await recorder.start(cameraSelect.hidden ? null : cameraSelect.value || null);
  } catch (err) {
    showToast(describeError(err));
    return;
  } finally {
    mainBtn.disabled = false;
  }
  $('liveCam').srcObject = recorder.stream;
  $('liveCam').play().catch(() => {});
  $('fpsVal').textContent = `${recorder.fps} fps`;
  mainBtn.classList.add('is-recording');
  mainBtn.textContent = 'Arrêter la session';
  acquireWakeLock();
  loopId = setInterval(tick, 100);
  populateCameras();
}

function stopSession() {
  clearInterval(loopId);
  recorder.stop();
  players.forEach((p) => p.stop());
  $('liveCam').srcObject = null;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  mainBtn.classList.remove('is-recording');
  mainBtn.textContent = 'Démarrer la session';
  $('timeReadout').textContent = '0s';
  $('bufferReadout').textContent = '0 s · 0 Mo';
  syncRateButtons();
  offerUpdate();
}

mainBtn.addEventListener('click', () => (recorder.running ? stopSession() : startSession()));

recorder.addEventListener('cameralost', () => {
  stopSession();
  showToast('La caméra a été interrompue. La session est arrêtée.', {
    action: 'Reprendre',
    onAction: () => startSession(),
    timeout: 0,
  });
});
recorder.addEventListener('recorderror', () => {
  stopSession();
  showToast('Erreur d\'enregistrement. La session est arrêtée.', { action: 'Reprendre', onAction: () => startSession(), timeout: 0 });
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !recorder.running) return;
  if (!wakeLock) acquireWakeLock();
  const track = recorder.stream?.getVideoTracks()[0];
  if (track && track.readyState !== 'live') recorder.dispatchEvent(new Event('cameralost'));
});

function tick() {
  const now = recorder.now();
  $('timeReadout').textContent = `${Math.floor(now)}s`;
  const span = now - recorder.oldest;
  $('bufferReadout').textContent = `${Math.round(span)} s · ${(recorder.bytes / (1024 * 1024)).toFixed(0)} Mo`;
  players.forEach((p) => p.tick(now));
  syncRateButtons();
}

// ---------- Clavier (ordinateur) ----------

document.addEventListener('keydown', (e) => {
  if (!recorder.running || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches?.('select, input:not([type="range"])')) return;
  const player = players[activeIndex];
  const zoomBy = (k) => {
    const v = player.getView();
    const scale = Math.min(6, Math.max(1, v.scale * k));
    const r = scale / v.scale;
    player.setView(clampView({ scale, nx: v.nx * r, ny: v.ny * r }));
  };
  switch (e.key) {
    case ' ': player.togglePlay(); break;
    case 'ArrowLeft': e.shiftKey ? player.jump(-3) : player.step(-1); break;
    case 'ArrowRight': e.shiftKey ? player.jump(3) : player.step(1); break;
    case 'l': case 'L': player.returnToLive(); break;
    case 's': case 'S': player.cycleSpeed(); break;
    case '+': case '=': zoomBy(1.25); break;
    case '-': zoomBy(0.8); break;
    case '0': player.setView(identityView()); break;
    case 'f': case 'F': toggleFullscreen(player); break;
    case 'Escape': players.forEach((p) => p.root.classList.remove('is-fullscreen')); break;
    case '1': case '2': case '3': activeIndex = Number(e.key) - 1; break;
    default: return;
  }
  e.preventDefault();
});

// ---------- Service worker et mises à jour ----------

let waitingWorker = null;
let updateRequested = false;

function offerUpdate() {
  if (!waitingWorker || recorder.running) return;
  showToast('Nouvelle version disponible.', {
    kind: 'info',
    action: 'Recharger',
    timeout: 0,
    onAction: () => { updateRequested = true; waitingWorker.postMessage({ type: 'SKIP_WAITING' }); },
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      if (!reg) return;
      const track = (worker) => { waitingWorker = worker; offerUpdate(); };
      if (reg.waiting && navigator.serviceWorker.controller) track(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) track(worker);
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (updateRequested) location.reload();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && !recorder.running) reg.update().catch(() => {});
      });
    } catch (err) {
      console.error('Service worker :', err);
    }
  });
}

// Utile pour les tests et le débogage
window.coachloop = { recorder, players, SPEED_CYCLE };
