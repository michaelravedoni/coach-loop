// Caméra + enregistrement en « époques ».
//
// Un MediaRecorder ne produit un fichier lisible que s'il contient son premier
// morceau (l'en-tête). On ne peut donc pas retirer les plus anciens morceaux
// d'un enregistrement continu. À la place, on redémarre l'enregistreur toutes
// les EPOCH_SECONDS : chaque époque est un fichier autonome, et on supprime les
// époques entières devenues inutiles. La mémoire reste bornée (~ EPOCH_SECONDS
// + MAX_DELAY + marge) quelle que soit la durée de la séance.

export const MAX_DELAY = 90;
const DEFAULT_EPOCH_SECONDS = 120;
const PRUNE_SLACK = 5;
const CHUNK_MS = 1000;
const BITRATE = 5_000_000;

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

function pickMime() {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

export class Epoch {
  constructor(t0, mime) {
    this.t0 = t0;
    this.mime = mime;
    this.chunks = [];
    this.bytes = 0;
    this.closed = false;
    this.endT = null;
    this.recorder = null;
  }

  /** Secondes de vidéo disponibles depuis le début de l'époque. */
  coverage() {
    return this.closed ? this.endT - this.t0 : this.chunks.length * (CHUNK_MS / 1000);
  }

  /** Fichier autonome contenant tout ce qui est enregistré jusqu'ici. */
  snapshot() {
    const blob = new Blob(this.chunks, { type: this.mime || this.chunks[0]?.type || 'video/mp4' });
    return { url: URL.createObjectURL(blob), coverage: this.coverage() };
  }
}

export class Recorder extends EventTarget {
  constructor() {
    super();
    this.stream = null;
    this.epochs = [];
    this.running = false;
    this.starting = false;
    this.startedAt = 0;
    this.fps = 30;
    this.mime = '';
    this.rotateTimer = null;
    this.deviceId = null;
    // Réglables pour les tests (époques courtes)
    this.epochSeconds = DEFAULT_EPOCH_SECONDS;
    this.maxDelay = MAX_DELAY;
  }

  /** Temps de séance en secondes. */
  now() {
    return (performance.now() - this.startedAt) / 1000;
  }

  get oldest() {
    return this.epochs[0]?.t0 ?? 0;
  }

  get bytes() {
    return this.epochs.reduce((acc, e) => acc + e.bytes, 0);
  }

  /** Époque qui contient l'instant `pos` (la plus récente qui a commencé avant). */
  epochFor(pos) {
    for (let i = this.epochs.length - 1; i >= 0; i--) {
      if (this.epochs[i].t0 <= pos + 0.05) return this.epochs[i];
    }
    return this.epochs[0] ?? null;
  }

  nextEpoch(epoch) {
    const i = this.epochs.indexOf(epoch);
    return i >= 0 ? this.epochs[i + 1] ?? null : null;
  }

  async listCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  async start(deviceId = null) {
    if (this.running || this.starting) return;
    this.starting = true;
    try {
      const video = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60 },
      };
      if (deviceId) video.deviceId = { exact: deviceId };
      else video.facingMode = { ideal: 'environment' };

      this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      const track = this.stream.getVideoTracks()[0];
      this.fps = Math.round(track.getSettings().frameRate || 30);
      track.addEventListener('ended', () => {
        if (this.running) this.dispatchEvent(new Event('cameralost'));
      });

      this.mime = pickMime();
      this.epochs = [];
      this.startedAt = performance.now();
      this.running = true;
      this.#openEpoch();
      this.rotateTimer = setInterval(() => this.#tick(), 1000);
    } catch (err) {
      this.#releaseStream();
      throw err;
    } finally {
      this.starting = false;
    }
  }

  stop() {
    this.running = false;
    clearInterval(this.rotateTimer);
    for (const e of this.epochs) this.#closeEpoch(e);
    this.#releaseStream();
    this.epochs = [];
  }

  #releaseStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  #openEpoch() {
    const epoch = new Epoch(this.now(), this.mime);
    const opts = { videoBitsPerSecond: BITRATE };
    if (this.mime) opts.mimeType = this.mime;
    const rec = new MediaRecorder(this.stream, opts);
    epoch.recorder = rec;
    epoch.mime = rec.mimeType || this.mime;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        epoch.chunks.push(e.data);
        epoch.bytes += e.data.size;
      }
    };
    rec.onerror = () => this.dispatchEvent(new Event('recorderror'));
    rec.start(CHUNK_MS);
    this.epochs.push(epoch);
    return epoch;
  }

  #closeEpoch(epoch) {
    if (epoch.closed) return;
    epoch.closed = true;
    epoch.endT = this.now();
    const rec = epoch.recorder;
    // On détache les gestionnaires après le dernier morceau, jamais avant.
    rec.onstop = () => {
      rec.ondataavailable = null;
      rec.onerror = null;
    };
    if (rec.state !== 'inactive') {
      try { rec.stop(); } catch { /* déjà arrêté */ }
    }
  }

  #tick() {
    if (!this.running) return;
    const cur = this.epochs[this.epochs.length - 1];
    if (this.now() - cur.t0 >= this.epochSeconds) {
      this.#openEpoch();
      // Léger recouvrement pour ne perdre aucune image au changement d'époque.
      setTimeout(() => this.#closeEpoch(cur), 300);
    }
    // Supprime les époques que plus aucun écran ne peut atteindre.
    while (this.epochs.length > 1 && this.now() - this.maxDelay - PRUNE_SLACK >= this.epochs[1].t0) {
      this.epochs.shift();
    }
  }
}
