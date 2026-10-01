// Service worker : fonctionnement hors ligne + mises à jour.
//
// - Les fichiers de l'app sont servis depuis le cache (démarrage instantané,
//   même sans réseau) et rafraîchis en arrière-plan : une nouvelle version est
//   donc disponible dès le chargement suivant, sans désinstaller l'app.
// - Quand ce fichier change (nouvelle VERSION), la page affiche « Nouvelle
//   version disponible » ; le rechargement n'a lieu qu'à la demande de l'utilisateur.
//
// À chaque modification de la liste des fichiers ci-dessous, incrémenter VERSION.
const VERSION = 'coachloop-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './js/main.js',
  './js/recorder.js',
  './js/player.js',
  './js/gestures.js',
  './manifest.json',
  './icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      return (await network) || Response.error();
    }),
  );
});
