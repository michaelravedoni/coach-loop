# CoachLoop ⏱️🏃‍♂️

> High-performance, offline-first delayed video feedback Progressive Web App designed for track & field and sports coaching.

**CoachLoop** turns any iPad, tablet, or laptop into an autonomous video analysis station. It captures camera video continuously and displays three simultaneous delayed replay screens (e.g. −20s, −40s, −60s) alongside a live monitoring and control dashboard. Athletes can review their trials three consecutive times in complete autonomy without requiring manual coach intervention.

---

## ⚡ Key features

* **Triple time-shift replay:** Stream three distinct delayed playback windows concurrently on a clean 2x2 grid.
* **Instant gesture scrubbing:** Swipe horizontally on any screen to inspect movements frame-by-frame or scrub across time with tactile feedback.
* **Autonomous 10s auto-reset:** Athletes can pause, scrub, or inspect slow-motion sequences; if untouched for 10 seconds, the player automatically snaps back to the continuous live delay.
* **Per-player slow motion:** Toggle 1.0x, 0.5x, and 0.25x speed independently per screen or globally across all screens.
* **Pinch-to-zoom & pan:** Inspect foot placements, hip angles, and kinematic checkpoints up to 4x magnification with double-tap reset.
* **Auto-hiding broadcast HUD:** Full-bleed video display with controls fading out during normal playback to preserve vertical space.
* **Lock / Safe mode:** Coach-lock safeguard to prevent accidental stoppage or delay tampering during intense group workouts.
* **100% client-side & privacy-first:** All processing and ring buffers run entirely in local memory (RAM). Zero video data is uploaded to any server.
* **Offline-ready PWA:** Install directly to your iPad home screen via Safari and run seamlessly trackside without Wi-Fi or cellular reception.

---

## 🛠️ Tech stack

* Pure vanilla JavaScript (ES6+), HTML5, and CSS Grid.
* **Hardware-accelerated media:** `MediaDevices.getUserMedia()`, `MediaRecorder` API with adaptive MP4/WebM encoding.
* **Offline engine:** Standard Service Worker cache API & Web App Manifest.
* **Zero external dependencies:** Single static deployment with no build steps, bundlers, or frameworks required.

---

## 🚀 Quick start & deployment

### Run with GitHub Pages

1. Fork or clone this repository.
2. Navigate to **Settings > Pages**.
3. Under **Build and deployment > Source**, select **Deploy from a branch** (`main` / `root`).
4. Open the generated HTTPS URL on your iPad or device.

### Install on iPadOS

1. Open your hosted URL in **Safari**.
2. Tap the **Share** button (`⎙`).
3. Select **Add to Home Screen**.
4. Launch **CoachLoop** from your home screen for an uninterrupted, full-screen native experience.

---

## 📄 License

MIT License — free to use, modify, and distribute for clubs, coaches, and sports organizations.
