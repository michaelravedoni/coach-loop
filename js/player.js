// Un écran de lecture retardée.
//
// États : WAITING (le retard n'est pas encore atteint) → LIVE (lecture en
// continu à `maintenant - retard`) ↔ ANALYSE (l'utilisateur a pris la main ;
// retour automatique au direct après INACTIVITY_TIMEOUT s sans action).
//
// Ce module est le seul à modifier `currentTime` et à changer la source.
// Deux <video> se relaient (double tampon) : la nouvelle source est chargée et
// positionnée en arrière-plan, puis affichée d'un coup, sans noir ni saut.

import { identityView, viewTransform } from './gestures.js';

export const INACTIVITY_TIMEOUT = 10;
export const SPEED_CYCLE = [1, 0.5, 0.25];
const LIVE_TOLERANCE = 0.8; // écart max (s) entre la lecture et le direct retardé
const LOOKAHEAD = 3; // on recharge quand il reste moins de 3 s de vidéo
const RING_LENGTH = 44; // 2 * PI * 7
const HUD_HIDE_MS = 3000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function once(el, type, timeoutMs) {
  return new Promise((resolve, reject) => {
    const done = (ok, err) => {
      clearTimeout(timer);
      el.removeEventListener(type, onType);
      el.removeEventListener('error', onError);
      ok ? resolve() : reject(err);
    };
    const onType = () => done(true);
    const onError = () => done(false, new Error('media error'));
    const timer = setTimeout(() => done(false, new Error(`timeout ${type}`)), timeoutMs);
    el.addEventListener(type, onType);
    el.addEventListener('error', onError);
  });
}

export class Player {
  /**
   * @param {{index:number, root:HTMLElement, recorder:import('./recorder.js').Recorder,
   *          delay:number, onViewChange:(index:number, view:object)=>void}} opts
   */
  constructor({ index, root, recorder, delay, onViewChange }) {
    this.index = index;
    this.root = root;
    this.recorder = recorder;
    this.delay = delay;
    this.onViewChange = onViewChange;

    const ref = (name) => root.querySelector(`[data-ref="${name}"]`);
    this.el = {
      viewport: root.querySelector('.video-viewport'),
      stack: root.querySelector('.video-stack'),
      grid: root.querySelector('.grid-overlay'),
      wait: root.querySelector('.wait-overlay'),
      waitValue: ref('waitValue'),
      scrubBadge: ref('scrubBadge'),
      hud: ref('hud'),
      hudBottom: ref('hudBottom'),
      number: ref('number'),
      delayLabel: ref('delayLabel'),
      badge: ref('badge'),
      zoomBadge: ref('zoomBadge'),
      scrub: ref('scrub'),
      playBtn: ref('playBtn'),
      speedBtn: ref('speedBtn'),
      tag: ref('tag'),
      liveWrap: ref('liveWrap'),
      ring: ref('ring'),
    };
    this.videos = [...root.querySelectorAll('video')];
    this.active = 0;
    this.videos[0].classList.add('on');

    this.state = 'WAITING';
    this.speed = 1;
    this.src = null; // { epoch, url, coverage }
    this.loadId = 0;
    this.loading = false;
    this.lastActivity = 0;
    this.dragging = false;
    this.scrubBase = 0;
    this.view = identityView();
    this.hudTimer = null;
    this.hudHidden = false;

    this.el.number.textContent = String(index + 1);
    this.setDelay(delay);

    for (const v of this.videos) {
      for (const type of ['play', 'pause', 'ended']) {
        v.addEventListener(type, () => { if (v === this.video) this.#syncPlayIcon(); });
      }
    }
    new ResizeObserver(() => this.#applyView()).observe(this.el.viewport);
  }

  get video() { return this.videos[this.active]; }

  /** Instant de la séance affiché à l'écran (secondes), ou null. */
  pos() {
    return this.src ? this.src.epoch.t0 + this.video.currentTime : null;
  }

  // ---------- Réglages ----------

  setDelay(seconds) {
    this.delay = seconds;
    this.el.delayLabel.textContent = `-${seconds}s`;
  }

  setGrid(on) {
    this.el.grid.classList.toggle('active', on);
  }

  setSpeed(rate) {
    this.speed = rate;
    for (const v of this.videos) v.playbackRate = rate;
    this.el.speedBtn.textContent = `${rate.toFixed(rate === 0.25 ? 2 : 1)}x`;
    this.el.speedBtn.classList.toggle('slow', rate < 1);
    if (rate < 1) this.enterAnalysis();
    else this.touch();
  }

  cycleSpeed() {
    this.setSpeed(SPEED_CYCLE[(SPEED_CYCLE.indexOf(this.speed) + 1) % SPEED_CYCLE.length]);
  }

  // ---------- Zoom ----------

  getView() { return this.view; }

  setView(view) {
    this.applyView(view);
    this.onViewChange(this.index, view);
  }

  /** Applique une vue sans prévenir (utilisé par le zoom lié). */
  applyView(view) {
    this.view = view;
    this.#applyView();
  }

  #applyView() {
    const { clientWidth: w, clientHeight: h } = this.el.viewport;
    this.el.stack.style.transform = viewTransform(this.view, w, h);
    const zoomed = this.view.scale > 1.001;
    this.el.zoomBadge.hidden = !zoomed;
    if (zoomed) this.el.zoomBadge.textContent = `${this.view.scale.toFixed(1)}×`;
  }

  // ---------- HUD ----------

  #setHudHidden(hidden) {
    this.hudHidden = hidden;
    this.el.hud.classList.toggle('hidden', hidden);
    // `inert` : un HUD masqué ne reçoit ni clic, ni focus clavier.
    this.el.hudBottom.inert = hidden;
  }

  pokeHud() {
    this.#setHudHidden(false);
    clearTimeout(this.hudTimer);
    if (this.state === 'LIVE') {
      this.hudTimer = setTimeout(() => this.#setHudHidden(true), HUD_HIDE_MS);
    }
  }

  /** Tout geste ou action de l'utilisateur : relance le compte à rebours du retour au direct. */
  touch() {
    this.lastActivity = this.recorder.now();
    if (this.state === 'ANALYSE') this.#updateRing(1);
  }

  #syncPlayIcon() {
    this.el.playBtn.textContent = this.video.paused ? '▶' : '⏸';
  }

  #updateRing(progress) {
    this.el.ring.style.strokeDashoffset = String(RING_LENGTH * (1 - progress));
  }

  #renderState() {
    const analyse = this.state === 'ANALYSE';
    this.el.badge.textContent = analyse ? 'ANALYSE' : 'DIRECT';
    this.el.badge.classList.toggle('analysis', analyse);
    this.el.liveWrap.classList.toggle('visible', analyse);
    this.el.wait.hidden = this.state !== 'WAITING';
    this.#syncPlayIcon();
  }

  // ---------- Transitions ----------

  enterAnalysis() {
    if (this.state === 'WAITING') return;
    this.state = 'ANALYSE';
    clearTimeout(this.hudTimer);
    this.#setHudHidden(false);
    this.touch();
    this.#renderState();
  }

  returnToLive() {
    if (this.state === 'WAITING') return;
    this.state = 'LIVE';
    this.setSpeed(1);
    this.#renderState();
    this.seek(this.recorder.now() - this.delay, { play: true });
    this.pokeHud();
  }

  // ---------- Commandes ----------

  togglePlay() {
    if (this.state === 'WAITING') return;
    this.enterAnalysis();
    const v = this.video;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
    this.touch();
  }

  jump(seconds) {
    if (this.state === 'WAITING') return;
    this.enterAnalysis();
    this.seek(this.pos() + seconds);
    this.touch();
  }

  step(direction) {
    if (this.state === 'WAITING') return;
    this.enterAnalysis();
    this.video.pause();
    this.seek(this.pos() + direction / (this.recorder.fps || 30), { play: false });
    this.touch();
  }

  scrubStart() {
    if (this.state === 'WAITING') return;
    this.enterAnalysis();
    this.scrubBase = this.pos() ?? this.recorder.now();
  }

  scrubMove(seconds) {
    if (this.state === 'WAITING') return;
    this.seek(this.scrubBase + seconds);
    const lag = Math.max(0, this.recorder.now() - (this.pos() ?? 0));
    this.el.scrubBadge.textContent = `−${lag.toFixed(1)}s`;
    this.el.scrubBadge.classList.add('visible');
    this.touch();
  }

  scrubEnd() {
    this.el.scrubBadge.classList.remove('visible');
    this.touch();
  }

  /** Curseur de la barre de commandes. */
  sliderInput(value) {
    if (this.state === 'WAITING') return;
    this.enterAnalysis();
    this.dragging = true;
    this.seek(value);
    this.touch();
  }

  sliderChange() {
    this.dragging = false;
    this.touch();
  }

  // ---------- Positionnement et chargement ----------

  /**
   * Va à l'instant `pos` de la séance. Si la source en cours le contient, on se
   * contente de déplacer la tête de lecture ; sinon on charge un nouvel extrait.
   */
  seek(pos, { play } = {}) {
    const rec = this.recorder;
    pos = clamp(pos, rec.oldest, rec.now() - 0.3);
    const epoch = rec.epochFor(pos);
    if (!epoch) return;
    const v = this.video;
    const shouldPlay = play ?? !v.paused;

    if (this.src && this.src.epoch === epoch && pos - epoch.t0 <= this.src.coverage - 0.5) {
      this.loadId++; // annule un chargement en cours devenu inutile
      this.loading = false;
      v.currentTime = Math.max(0, pos - epoch.t0);
      if (shouldPlay && v.paused) v.play().catch(() => {});
      return;
    }
    this.#load(epoch, pos, { play: shouldPlay });
  }

  /**
   * Charge l'époque dans la vidéo cachée, la positionne, puis l'affiche.
   * `live` : la cible suit l'horloge (maintenant - retard) jusqu'au moment de l'affichage.
   */
  async #load(epoch, pos, { play, live = this.state === 'LIVE' }) {
    const token = ++this.loadId;
    this.loading = true;
    const spare = this.videos[1 - this.active];
    const snap = epoch.snapshot();
    const target = () => (live ? this.recorder.now() - this.delay : pos);
    let swapped = false;
    try {
      spare.src = snap.url;
      await once(spare, 'loadedmetadata', 5000);
      if (token !== this.loadId) return;

      const t0 = Math.max(0, target() - epoch.t0);
      if (Math.abs(spare.currentTime - t0) > 0.01) {
        spare.currentTime = t0;
        await once(spare, 'seeked', 4000);
        if (token !== this.loadId) return;
      }
      // Début d'époque pas encore atteint par le direct : on attend ici, l'ancienne vidéo continue.
      const wait = epoch.t0 - target();
      if (wait > 0) {
        await sleep(wait * 1000);
        if (token !== this.loadId) return;
      }
      spare.playbackRate = this.speed;
      if (play) {
        await spare.play().catch(() => {});
        if (token !== this.loadId) return;
      }

      const old = this.video;
      const oldSrc = this.src;
      spare.classList.add('on');
      old.classList.remove('on');
      old.pause();
      this.active = 1 - this.active;
      this.src = { epoch, url: snap.url, coverage: snap.coverage };
      swapped = true;
      this.#syncPlayIcon();
      setTimeout(() => {
        old.removeAttribute('src');
        old.load();
        if (oldSrc) URL.revokeObjectURL(oldSrc.url);
      }, 300);
    } catch {
      // Chargement impossible ou trop long : le prochain tick réessaiera.
    } finally {
      if (!swapped) {
        URL.revokeObjectURL(snap.url);
        if (token === this.loadId) {
          spare.removeAttribute('src');
          spare.load();
        }
      }
      if (token === this.loadId) this.loading = false;
    }
  }

  /** Époque à charger si la source actuelle est sur le point de manquer de vidéo. */
  #refreshTarget(p) {
    const epoch = this.src.epoch;
    const upcoming = this.recorder.epochFor(p + 1.5);
    if (upcoming && upcoming !== epoch) return upcoming;
    if (p - epoch.t0 + LOOKAHEAD > this.src.coverage && epoch.coverage() > this.src.coverage + 1) return epoch;
    return null;
  }

  // ---------- Boucle principale ----------

  tick(now) {
    const rec = this.recorder;
    const { scrub } = this.el;
    scrub.min = String(rec.oldest);
    scrub.max = String(now);

    if (this.state === 'WAITING') {
      const remaining = this.delay - now;
      this.el.waitValue.textContent = `${Math.max(0, Math.ceil(remaining))} s`;
      const epoch = rec.epochFor(now - this.delay);
      if (remaining <= 0 && epoch && epoch.coverage() > now - this.delay - epoch.t0 + 1.5) {
        this.state = 'LIVE';
        this.#renderState();
        this.#load(epoch, now - this.delay, { play: true, live: true });
        this.pokeHud();
      }
      return;
    }

    const p = this.pos();
    if (p !== null) {
      if (!this.dragging) scrub.value = String(p);
      this.el.tag.textContent = `-${Math.max(0, now - p).toFixed(1)}s`;
    }

    if (this.state === 'ANALYSE') {
      const remaining = INACTIVITY_TIMEOUT - (now - this.lastActivity);
      this.#updateRing(clamp(remaining / INACTIVITY_TIMEOUT, 0, 1));
      if (remaining <= 0 && !this.dragging) {
        this.returnToLive();
        return;
      }
    }

    if (this.loading || !this.src || p === null) return;
    const v = this.video;

    if (this.state === 'LIVE') {
      const target = now - this.delay;
      if (Math.abs(p - target) > LIVE_TOLERANCE || v.ended) {
        this.seek(target, { play: true });
        return;
      }
      if (v.paused) v.play().catch(() => {});
    }

    if (!v.paused && !v.ended) {
      const next = this.#refreshTarget(p);
      if (next) this.#load(next, p, { play: true });
    }
  }

  // ---------- Fin de séance ----------

  stop() {
    this.loadId++;
    this.loading = false;
    for (const v of this.videos) {
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.classList.remove('on');
    }
    if (this.src) URL.revokeObjectURL(this.src.url);
    this.src = null;
    this.active = 0;
    this.videos[0].classList.add('on');
    this.state = 'WAITING';
    this.speed = 1;
    this.dragging = false;
    clearTimeout(this.hudTimer);
    this.root.classList.remove('is-fullscreen');
    this.el.scrubBadge.classList.remove('visible');
    this.el.tag.textContent = `-${this.delay}.0s`;
    this.el.scrub.value = '0';
    this.setSpeedUI();
    this.applyView(identityView());
    this.#setHudHidden(false);
    this.#renderState();
  }

  setSpeedUI() {
    this.el.speedBtn.textContent = '1.0x';
    this.el.speedBtn.classList.remove('slow');
  }
}
