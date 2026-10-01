# CoachLoop ⏱️🏃‍♂️

> High-performance, offline-first delayed video feedback Progressive Web App designed for track & field and sports coaching.

**CoachLoop** turns an iPad, tablet, or laptop into an autonomous video analysis station. It runs in any modern browser, as a regular web page or installed as a PWA. It captures camera video continuously and displays three simultaneous delayed replay screens (e.g. −20s, −40s, −60s) alongside a live monitoring and control dashboard. Athletes can review their trials three consecutive times in complete autonomy without requiring manual coach intervention.

---

## ⚡ Key features

* **Triple time-shift replay:** Stream three distinct delayed playback windows concurrently on a clean 2x2 grid.
* **Gesture scrubbing:** Swipe horizontally on any screen to scrub across time; use the frame-step and ±3 s buttons for fine inspection.
* **Autonomous 10s auto-reset:** Athletes can pause, scrub, or inspect slow-motion sequences; if untouched for 10 seconds, the player automatically snaps back to the continuous live delay.
* **Per-player slow motion:** Toggle 1.0x, 0.5x, and 0.25x speed independently per screen or globally across all screens.
* **Pinch-to-zoom & pan:** Inspect foot placements, hip angles, and kinematic checkpoints up to 6x magnification, centred on your fingers, with double-tap reset. Playback keeps running while zoomed.
* **Linked zoom (optional):** One button applies the same zoom and pan to the three screens, to compare the same body area across the three attempts.
* **Mouse, trackpad and keyboard:** Wheel / trackpad pinch to zoom, drag to pan or scrub. Shortcuts: `Space` play/pause, `←` `→` frame step, `Shift`+`←` `→` ±3 s, `L` back to live, `S` speed, `+` `-` `0` zoom, `F` fullscreen, `1` `2` `3` select a screen.
* **Auto-hiding broadcast HUD:** Full-bleed video display with controls fading out during normal playback to preserve vertical space.
* **Lock / Safe mode:** Coach-lock safeguard to prevent accidental stoppage or delay tampering during intense group workouts. Tap to lock, hold for one second to unlock.
* **Screen stays awake:** The app asks the browser to keep the display on during a session, and tells you if the camera is interrupted.
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

Notes:

* Firefox and Android browsers have not been tested.
* The technical audit, the list of fixes and what still needs validation on a real iPad are in [`docs/AUDIT.md`](docs/AUDIT.md).

---

## 🧠 Memory behaviour

The camera is recorded in memory in **segments ("epochs") of 2 minutes**. Each epoch is a standalone video file, and epochs that no screen can reach any more (older than the longest delay, 90 s max) are dropped. Memory therefore stays bounded, at roughly 3.5 minutes of video (about 130 MB at the 5 Mbit/s target bitrate) however long the session runs. The console shows the current buffer size.

Consequence: you can scrub back over the last few minutes, not over the whole session.

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

The app is served from the offline cache and refreshed in the background, so a new deployment is picked up on the next launch. When the service worker itself changes, a **"Nouvelle version disponible"** banner offers to reload (it never reloads in the middle of a session). Bump `VERSION` in `sw.js` whenever the list of files changes.

---

## 🧪 Development

No build step. Serve the folder over HTTP (`localhost` counts as a secure context) and open it in a browser:

```bash
npm install        # only needed for the tests (Playwright)
npm start          # static server on http://localhost:8080
npm test           # smoke test in Chromium with a fake camera
```

Code layout: `index.html` (markup and the screen template), `styles.css`, `js/main.js` (wiring and console), `js/recorder.js` (camera and epoch buffer), `js/player.js` (one delayed screen), `js/gestures.js` (pinch, pan, scrub), `sw.js` (offline cache). CI runs the smoke test on every push.

---

## 📄 License

MIT License — free to use, modify, and distribute for clubs, coaches, and sports organizations.
