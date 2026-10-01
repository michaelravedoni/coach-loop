// Test de fumée : caméra factice de Chromium, retards courts, époques courtes.
// Vérifie la lecture retardée, la pause, le pas image, le retour au direct,
// le pinch/double tap, le zoom lié, le plafonnement de la mémoire et le redémarrage.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const server = await serve();
const url = `http://localhost:${server.address().port}/`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['camera'], serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.addInitScript(() => {
  localStorage.setItem('coachloop.settings', JSON.stringify({ delays: [5, 8, 12] }));
});
await page.goto(url);
await page.evaluate(() => { coachloop.recorder.epochSeconds = 15; coachloop.recorder.maxDelay = 14; });

const lag = (i) => page.evaluate((i) => {
  const p = coachloop.players[i];
  return p.pos() === null ? null : coachloop.recorder.now() - p.pos();
}, i);
const player = (i, fn) => page.evaluate(({ i, fn }) => {
  const p = coachloop.players[i];
  return new Function('p', `return (${fn})(p)`)(p);
}, { i, fn: fn.toString() });

try {
  await page.click('#mainToggleBtn');
  await wait(16_000);

  // Lecture retardée : chaque écran affiche à `maintenant - retard` (±1 s)
  for (const [i, delay] of [[0, 5], [1, 8], [2, 12]]) {
    assert.equal(await player(i, (p) => p.state), 'LIVE', `écran ${i + 1} en direct`);
    assert.ok(Math.abs((await lag(i)) - delay) < 1, `écran ${i + 1} : retard ${await lag(i)} ≠ ${delay}`);
  }

  // Pause : la tête de lecture ne bouge plus et le retard grandit
  await player(0, (p) => p.togglePlay());
  await wait(500);
  const l0 = await lag(0);
  await wait(1500);
  assert.ok((await lag(0)) - l0 > 1.3, 'la pause fige l\'image');
  assert.equal(await player(0, (p) => p.state), 'ANALYSE');

  // Pas image, saut arrière, curseur
  await player(0, (p) => p.step(1));
  await player(0, (p) => p.jump(-3));
  await wait(800);
  assert.ok((await lag(0)) > l0 + 3, 'le saut de −3 s recule');
  await player(0, (p) => { p.sliderInput(coachloop.recorder.now() - 10); p.sliderChange(); });
  await wait(1200);
  assert.ok(Math.abs((await lag(0)) - 11) < 2.5, 'le curseur déplace la lecture');

  // Retour automatique au direct après 10 s d'inactivité
  await wait(11_000);
  assert.equal(await player(0, (p) => p.state), 'LIVE');
  // Le rechargement peut prendre quelques secondes sur une machine lente : on laisse 10 s pour se recaler.
  for (let i = 0; i < 20 && Math.abs((await lag(0)) - 5) >= 1.2; i++) await wait(500);
  assert.ok(Math.abs((await lag(0)) - 5) < 1.2, `retour au direct au bon retard (${await lag(0)} s)`);

  // Pause pendant un rechargement en arrière-plan : la pause doit être respectée
  // (l'écran 1 a un retard de 5 s, il recharge souvent).
  let caught = false;
  for (let i = 0; i < 600 && !caught; i++) {
    caught = await player(0, (p) => {
      if (p.state === 'LIVE' && p.loading) { p.togglePlay(); return true; }
      return false;
    });
    if (!caught) await wait(25);
  }
  assert.ok(caught, 'un rechargement a été intercepté');
  await wait(2500);
  assert.equal(await player(0, (p) => p.video.paused), true, 'la pause survit à un rechargement en cours');
  await player(0, (p) => p.returnToLive());
  await wait(1500);

  // Verrou : un appui long déverrouille et ne reverrouille pas au relâchement
  await page.click('#lockBtn');
  assert.equal(await page.evaluate(() => document.getElementById('consolePanel').classList.contains('is-locked')), true);
  const lockBox = await page.locator('#lockBtn').boundingBox();
  await page.mouse.move(lockBox.x + lockBox.width / 2, lockBox.y + lockBox.height / 2);
  await page.mouse.down();
  await wait(1300);
  await page.mouse.up();
  await wait(200);
  assert.equal(await page.evaluate(() => document.getElementById('consolePanel').classList.contains('is-locked')), false, 'le verrou reste déverrouillé');

  // Ralenti : la lecture ne revient pas en arrière toute seule
  await player(1, (p) => p.setSpeed(0.5));
  await wait(1500);
  const s1 = await lag(1);
  await wait(3000);
  const grow = (await lag(1)) - s1;
  assert.ok(grow > 1 && grow < 2, `ralenti 0,5× : le retard grandit de ${grow.toFixed(2)} s en 3 s`);

  // HUD masqué = inerte
  assert.equal(await player(2, (p) => p.el.hudBottom.inert), true);

  // Pinch, relâcher un doigt, double tap
  const box = await page.locator('#card2 .video-viewport').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const pointer = (type, id, x) => page.evaluate(({ type, id, x, cy }) => {
    document.querySelector('#card2 .video-viewport').dispatchEvent(
      new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: cy, bubbles: true, isPrimary: id === 1 }));
  }, { type, id, x, cy });
  await pointer('pointerdown', 1, cx - 40);
  await pointer('pointerdown', 2, cx + 40);
  for (let k = 1; k <= 10; k++) { await pointer('pointermove', 1, cx - 40 - k * 10); await pointer('pointermove', 2, cx + 40 + k * 10); }
  await pointer('pointerup', 2, cx + 140);
  await pointer('pointerup', 1, cx - 140);
  assert.ok((await player(2, (p) => p.view.scale)) > 2, 'le pinch zoome et le zoom reste après le relâchement');
  assert.equal(await player(2, (p) => p.state), 'LIVE', 'le pinch n\'entre pas en analyse');
  for (let i = 0; i < 2; i++) { await pointer('pointerdown', 1, cx); await pointer('pointerup', 1, cx); await wait(100); }
  assert.equal(await player(2, (p) => p.view.scale), 1, 'le double tap remet le zoom à 1×');

  // Lecture en zoom, zoom lié
  await player(2, (p) => p.setView({ scale: 2, nx: 0, ny: 0 }));
  await player(2, (p) => p.togglePlay());
  await wait(500);
  await player(2, (p) => p.togglePlay());
  await wait(1500);
  const playing = await player(2, (p) => !p.video.paused);
  assert.ok(playing, 'la lecture fonctionne zoomée');
  await page.click('#linkZoomBtn');
  await player(2, (p) => p.setView({ scale: 3, nx: 0.1, ny: 0 }));
  assert.deepEqual(await page.evaluate(() => coachloop.players.map((p) => p.view.scale)), [3, 3, 3]);

  // Mémoire plafonnée : au bout de ~35 s, pas plus de 2 époques
  await wait(10_000);
  const epochs = await page.evaluate(() => coachloop.recorder.epochs.length);
  assert.ok(epochs <= 3, `mémoire bornée (${epochs} époques)`);

  // Arrêt propre puis redémarrage
  await page.click('#mainToggleBtn');
  assert.equal(await page.evaluate(() => coachloop.recorder.epochs.length), 0);
  await page.click('#mainToggleBtn');
  // Le premier écran (retard 5 s) doit repasser en direct ; on laisse jusqu'à 25 s aux machines lentes.
  for (let i = 0; i < 50 && (await player(0, (p) => p.state)) !== 'LIVE'; i++) await wait(500);
  assert.equal(await player(0, (p) => p.state), 'LIVE', 'la session redémarre');

  assert.deepEqual(errors, [], 'aucune erreur JavaScript');
  console.log('OK');
} finally {
  await browser.close();
  server.close();
}
