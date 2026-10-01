// Gestes sur un écran : pinch/molette = zoom, glisser = déplacement (zoomé) ou
// défilement dans le temps (non zoomé), double tap = zoom 1×.
// Un seul code (Pointer Events) pour le doigt, la souris et le stylet.

export const MAX_ZOOM = 6;
const SCRUB_PX_PER_3S = 150;
const MOVE_THRESHOLD = 8;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;
const TAP_MAX_MS = 300;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Vue = zoom + décalage, en fractions de la taille de l'écran (indépendant de la taille). */
export const identityView = () => ({ scale: 1, nx: 0, ny: 0 });

export function clampView(v) {
  const scale = clamp(v.scale, 1, MAX_ZOOM);
  if (scale <= 1.001) return identityView();
  const lim = (scale - 1) / 2;
  return { scale, nx: clamp(v.nx, -lim, lim), ny: clamp(v.ny, -lim, lim) };
}

export function viewTransform(v, width, height) {
  return `translate(${v.nx * width}px, ${v.ny * height}px) scale(${v.scale})`;
}

/** Zoome en gardant le point du contenu qui était sous (m0x, m0y) sous (m1x, m1y). */
function viewAbout(v0, scale1, m0x, m0y, m1x, m1y, rect) {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const k = scale1 / v0.scale;
  const tx = (m1x - cx) - k * ((m0x - cx) - v0.nx * rect.width);
  const ty = (m1y - cy) - k * ((m0y - cy) - v0.ny * rect.height);
  return clampView({ scale: scale1, nx: tx / rect.width, ny: ty / rect.height });
}

/**
 * @param {HTMLElement} el zone tactile (l'écran vidéo, hors barre de commandes)
 * @param {{
 *   getView: () => {scale:number,nx:number,ny:number},
 *   setView: (v: {scale:number,nx:number,ny:number}) => void,
 *   onActivity: () => void,
 *   onTap: () => void,
 *   onScrubStart: () => void,
 *   onScrubMove: (seconds: number) => void,
 *   onScrubEnd: () => void,
 * }} h
 */
export function attachGestures(el, h) {
  const pointers = new Map();
  let mode = null; // 'pan' | 'scrub' | 'pinch'
  let moved = false;
  let downAt = 0;
  let lastTap = { t: 0, x: 0, y: 0 };
  let ref = null; // état de référence, recalculé à chaque changement du nombre de doigts

  const points = () => [...pointers.values()];

  function rebaseline() {
    const pts = points();
    const view = h.getView();
    if (pts.length >= 2) {
      const [a, b] = pts;
      ref = {
        view,
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
    } else if (pts.length === 1) {
      ref = { view, x: pts[0].x, y: pts[0].y };
    }
  }

  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { el.setPointerCapture(e.pointerId); } catch { /* pointeur déjà terminé */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    h.onActivity();
    if (pointers.size === 1) {
      moved = false;
      mode = null;
      downAt = performance.now();
    } else {
      moved = true;
      if (mode === 'scrub') h.onScrubEnd();
      mode = 'pinch';
    }
    rebaseline();
  });

  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const rect = el.getBoundingClientRect();

    if (pointers.size >= 2 && mode === 'pinch') {
      const [a, b] = points();
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const scale1 = clamp(ref.view.scale * (dist / ref.dist), 1, MAX_ZOOM);
      h.setView(viewAbout(ref.view, scale1, ref.mx, ref.my, (a.x + b.x) / 2, (a.y + b.y) / 2, rect));
      h.onActivity();
      return;
    }

    if (pointers.size !== 1 || !ref) return;
    const dx = p.x - ref.x;
    const dy = p.y - ref.y;
    if (!moved && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
    if (!moved) {
      moved = true;
      mode = ref.view.scale > 1.02 ? 'pan' : 'scrub';
      if (mode === 'scrub') h.onScrubStart();
    }
    if (mode === 'pan') {
      h.setView(clampView({
        scale: ref.view.scale,
        nx: ref.view.nx + dx / rect.width,
        ny: ref.view.ny + dy / rect.height,
      }));
    } else if (mode === 'scrub') {
      h.onScrubMove((dx / SCRUB_PX_PER_3S) * 3);
    }
    h.onActivity();
  });

  function end(e) {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size > 0) {
      // Il reste un doigt : on repart de sa position actuelle pour éviter tout saut.
      mode = h.getView().scale > 1.02 ? 'pan' : null;
      rebaseline();
      return;
    }
    if (mode === 'scrub') h.onScrubEnd();
    const now = performance.now();
    const isTap = e.type === 'pointerup' && !moved && now - downAt < TAP_MAX_MS;
    mode = null;
    if (!isTap) return;
    if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_TAP_PX) {
      lastTap = { t: 0, x: 0, y: 0 };
      h.setView(identityView());
    } else {
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      h.onTap();
    }
  }
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  // Molette / pincement du trackpad (Chrome envoie ctrl+molette)
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const v0 = h.getView();
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const scale1 = clamp(v0.scale * factor, 1, MAX_ZOOM);
    h.setView(viewAbout(v0, scale1, e.clientX, e.clientY, e.clientX, e.clientY, rect));
    h.onActivity();
  }, { passive: false });

  // Pincement du trackpad sous Safari (événements propriétaires)
  let gestureStart = null;
  el.addEventListener('gesturestart', (e) => { e.preventDefault(); gestureStart = h.getView(); });
  el.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    if (!gestureStart) return;
    const rect = el.getBoundingClientRect();
    const scale1 = clamp(gestureStart.scale * e.scale, 1, MAX_ZOOM);
    h.setView(viewAbout(gestureStart, scale1, e.clientX, e.clientY, e.clientX, e.clientY, rect));
    h.onActivity();
  });
  el.addEventListener('gestureend', (e) => { e.preventDefault(); gestureStart = null; });

  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
