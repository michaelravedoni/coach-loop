# CoachLoop ⏱️🏃‍♂️

> High-performance, offline-first delayed video feedback Progressive Web App designed for track & field and sports coaching.

**CoachLoop** turns an iPad, tablet, or laptop into an autonomous video analysis station. It runs in any modern browser, as a regular web page or installed as a PWA. It captures camera video continuously and displays three simultaneous delayed replay screens (e.g. −20s, −40s, −60s) alongside a live monitoring and control dashboard. Athletes can review their trials three consecutive times in complete autonomy without requiring manual coach intervention.

---

## ⚡ Key features

* **Triple time-shift replay:** Stream three distinct delayed playback windows concurrently on a clean 2x2 grid.
* **Instant gesture scrubbing:** Swipe horizontally on any screen to inspect movements frame-by-frame or scrub across time with tactile feedback.
* **Autonomous 10s auto-reset:** Athletes can pause, scrub, or inspect slow-motion sequences; if untouched for 10 seconds, the player automatically snaps back to the continuous live delay.
* **Per-player slow motion:** Toggle 1.0x, 0.5x, and 0.25x speed independently per screen or globally across all screens.
* **Pinch-to-zoom & pan:** Inspect foot placements, hip angles, and kinematic checkpoints up to 4x magnification with double-tap reset.
* **Auto-hiding broadcast HUD:** Full-bleed video display with controls fading out during normal playback to preserve vertical space.
* **Lock / Safe mode:** Coach-lock safeguard to prevent accidental stoppage or delay tampering during intense group workouts.
* **100% client-side & privacy-first:** All recording and playback happen in the browser on your device. Zero video data is uploaded to any server and nothing is written to disk by the app.
* **Offline-ready PWA:** Install it as an app (iPad home screen, Chrome/Edge install, Safari Dock) and run it trackside without Wi-Fi or cellular reception once it has been loaded one time.

---

## 🌐 Supported browsers

CoachLoop targets all current browsers and has been tested by the maintainer in both modes (regular tab and installed PWA) on:

| Platform | Browser | Tab | Installed PWA |
|---|---|---|---|
| iPad (iPadOS) | Safari | ✅ | ✅ (Add to Home Screen) |
| macOS / Windows / Linux | Chrome (and Chromium-based browsers) | ✅ | ✅ (Install app) |
| macOS | Safari | ✅ | ✅ (Add to Dock) |

Requirements: a browser with `getUserMedia` and `MediaRecorder`, a camera, and a **secure context** (HTTPS or `localhost`; opening `index.html` directly from disk will not give camera access).

Known limits, listed in [`docs/AUDIT.md`](docs/AUDIT.md):

* Pinch-to-zoom, pan and swipe scrubbing use touch events. On a computer, use the on-screen controls; mouse, trackpad and keyboard gestures are not implemented yet.
* Gesture and playback glitches can occur while pinching, rewinding or pausing.
* Firefox and Android browsers have not been tested.

---

## 🧠 Memory behaviour

The video is recorded in memory in 1-second chunks and **the buffer is not capped yet**: nothing is discarded during a session, so memory use grows with its length (up to about 37 MB per minute at the 5 Mbit/s target bitrate, roughly 2 GB per hour). On an iPad, prefer shorter sessions and use **Arrêter la session** between groups; stopping releases everything. A true fixed-size ring buffer is planned (see the audit).

The delay is limited to 90 seconds per screen, but the whole session stays available for scrubbing back until you stop.

---

## 🛠️ Tech stack

* Pure vanilla JavaScript (ES6+), HTML5, and CSS Grid.
* **Browser media APIs:** `MediaDevices.getUserMedia()` and the `MediaRecorder` API, using MP4 (H.264) when the browser supports it and WebM (VP8) otherwise.
* **Offline engine:** Standard Service Worker cache API & Web App Manifest.
* **Zero external dependencies:** Single static deployment with no build steps, bundlers, or frameworks required.

---

## 🚀 Quick start & deployment

### Run with GitHub Pages

1. Fork or clone this repository.
2. Navigate to **Settings > Pages**.
3. Under **Build and deployment > Source**, select **Deploy from a branch** (`main` / `root`).
4. Open the generated HTTPS URL on your iPad or device.

### Install as an app (PWA)

**iPadOS (Safari)**

1. Open your hosted URL in **Safari**.
2. Tap the **Share** button (`⎙`).
3. Select **Add to Home Screen**.
4. Launch **CoachLoop** from your home screen for a full-screen experience.

**Chrome / Edge (desktop and Android)**

1. Open your hosted URL.
2. Click the install icon in the address bar (or menu > **Install CoachLoop**).

**Safari on macOS**

1. Open your hosted URL.
2. Choose **File > Add to Dock**.

### Updates

The offline cache is currently not versioned, so an installed copy may keep serving an older version after a new deployment. If an update does not show up, remove the installed app (or clear the site data) and open the URL again.

---

## 📄 License

MIT License — free to use, modify, and distribute for clubs, coaches, and sports organizations.
