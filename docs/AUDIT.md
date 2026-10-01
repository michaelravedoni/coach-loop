# CoachLoop — Audit technique et pistes d'amélioration

Date : 2026-10-01 · Périmètre : `index.html` (1329 lignes), `sw.js`, `manifest.json`, `README.md`. Aucun code applicatif n'a été modifié.

## 0. État d'avancement (mise à jour après implémentation)

Les 7 lots ont été réalisés dans la même branche. Vérifié par un test automatique (`npm test`, Chromium, caméra factice) : retard stable à chaque écran, pause, pas image, saut, curseur, retour auto au direct, ralenti 0,5× sans retour en arrière, pinch qui garde le zoom, double tap, lecture en zoom, zoom lié, mémoire bornée avec rotation des époques, arrêt/redémarrage. **Rien n'a été testé sur Safari ni sur un iPad** : à valider sur ton iPad avant de fusionner (surtout le positionnement dans les fichiers MP4 de Safari et le passage d'une époque à l'autre).

| Lot | Réalisé | Reste / limites |
|---|---|---|
| 1 Gestes | Pointer Events, pinch centré sur les doigts, pan borné, double tap fiable, HUD masqué `inert`, molette, pinch trackpad, clavier | Pinch Safari de bureau (événements `gesture*`) non testé |
| 2 Lecture | Double tampon vidéo, attente de `loadedmetadata`/`seeked`, rafraîchissement seulement quand il manque de la vidéo, ralenti sans retour arrière, icône synchronisée par événements | `requestVideoFrameCallback` non utilisé : le pas image reste basé sur `currentTime` (1/fps réel) |
| 3 Cycle de vie | Wake Lock, caméra perdue → message + « Reprendre », fin de séance propre, garde double clic, `frameRate` sans `min`, erreurs affichées dans l'interface, choix de la caméra | — |
| 4 PWA | Cache versionné en stale-while-revalidate, bandeau « Nouvelle version disponible », safe areas, `100dvh` | Icône `apple-touch-icon` laissée en SVG (OK d'après toi) |
| 5 Mémoire | Niveau B (époques de 2 min, ≈ 3,5 min de tampon ≈ 130 Mo), indépendant de la durée de séance | Niveau C (WebCodecs) non fait : à reconsidérer seulement si le niveau B pose problème sur iPad |
| 6 Structure/CI | Modules ES, un seul gabarit d'écran, test Playwright, workflow GitHub Actions | Pas d'ESLint/Prettier ni `@ts-check` (non ajoutés pour éviter du bruit) |
| 7 UX/UI | Cibles ≥ 36–40 px, textes plus grands, compte à rebours « Disponible dans N s », zoom lié optionnel, réglages mémorisés, verrou par appui long, plein écran quittable (Échap), affichage du tampon | Mise en page portrait sommaire ; pas de vérification visuelle sur iPad |

### Correctifs après l'essai local (2026-10-01)

Retours de Michael : flashs noirs récurrents, sauts de timeline / écran noir / play-pause bloqué en manipulant un lecteur, verrou qui se reverrouille.

| Symptôme | Cause (lue dans le code, reproduite pour les flashs) | Correctif |
|---|---|---|
| Flashs noirs | La nouvelle vidéo était affichée dès que `play()` répondait, avant que sa première image soit présentée ; l'ancienne était vidée par un minuteur qui pouvait tomber en plein chargement suivant ; l'écran à retard court recharge toutes les ~2 s | Affichage seulement après `requestVideoFrameCallback` ; vidéo de réserve gardée « visible » derrière (z-index, pas `opacity: 0`) ; plus de minuteur de nettoyage. Mesuré par capture d'écran (Chromium, 45 s, retards 5/8/12 s) : 88 images noires → 0 |
| Pause / lecture ignorée | Un rechargement lancé avant le clic relançait la lecture à son arrivée | Intention de lecture (`wantPlay`) relue au moment d'afficher ; l'icône suit l'intention |
| Saut en arrière ou vers une autre position | Un chargement visait la position du début de la demande, pas celle d'arrivée ; `+3 s` / pas image repartaient de l'ancienne position pendant un chargement ; `play()` sur une vidéo arrivée au bout la ramenait au début de l'époque | Cible suivie dans le temps (`goal`), position logique pour les sauts, rechargement d'un extrait frais quand on relance une vidéo terminée |
| Écran noir ou source perdue | Chargements enchaînés (glissement du doigt) qui se coupaient mutuellement | Un seul chargement actif, écart minimal de 150 ms, le dernier gagne |
| Verrou qui se reverrouille | Le déverrouillage se faisait après 1 s d'appui, puis le relâchement déclenchait un `click` qui reverrouillait | Le clic qui suit un déverrouillage est ignoré (testé avec une vraie souris) |

Limites : vérifié en Chromium uniquement ; le comportement de `requestVideoFrameCallback` sur une vidéo en pause (Safari) reste à confirmer sur iPad. Le test de pause pendant un rechargement garde le comportement mais je n'ai pas pu prouver qu'il échouait avant le correctif.

Les sections suivantes décrivent l'état **avant** les corrections.

---

## 1. Résumé

Le principe fonctionne, mais le moteur de lecture repose sur un mécanisme fragile : **à chaque seconde, tous les morceaux enregistrés sont recollés en un nouveau fichier vidéo, et les 3 lecteurs rechargent leur source**. Ce choix explique l'essentiel des « petits bugs » que tu décris (sauts, arrêts, comportement bizarre au rembobinage, à la pause, après un pinch) et il fait aussi croître la mémoire sans limite.

À part le moteur, trois familles de défauts :

1. **Gestes tactiles** : le pinch peut réinitialiser le zoom tout seul, des sauts de position apparaissent après un pinch, les boutons masqués restent cliquables.
2. **Cycle de vie** : le service worker ne livre jamais les mises à jour, l'écran de l'iPad peut se mettre en veille en pleine séance, rien ne gère la perte de la caméra.
3. **Dette de structure** : l'écran est copié 3 fois dans le HTML et dans l'état JS, tout est dans un seul fichier, aucun test.

**Lecture en zoom : oui, c'est faisable.** Voir §4.

### Légende des preuves

* **[E]** vérifié en exécution : Chromium 141 headless sous Linux, caméra factice, session de ~30 s.
* **[L]** vérifié par lecture du code : le raisonnement est dans le texte, mais ce n'est pas reproduit en vrai.
* **[S]** supposé : comportement connu ou probable d'un navigateur, à confirmer sur un iPad ou dans Safari.

**Limite importante :** je n'ai aucun accès à Safari ni à un iPad. Tout ce qui touche Safari/iPad est [L] ou [S].

---

## 2. Faiblesses et bugs, par gravité

Gravité = impact sur la stabilité en séance. Les identifiants (C1, E2…) servent à choisir les correctifs au §7.

| ID | Gravité | Sujet | Preuve |
|---|---|---|---|
| C1 | 🔴 Critique | Mémoire non plafonnée, pas de ring buffer | L |
| C2 | 🔴 Critique | Recollage complet + rechargement des 3 vidéos chaque seconde | E + L |
| C3 | 🔴 Critique | Durée vidéo inconnue (WebM), positionnement peu fiable | E |
| C4 | 🔴 Critique | Le pinch déclenche la remise à 1× tout seul | L |
| C5 | 🔴 Critique | Service worker figé : les mises à jour n'arrivent jamais | L |
| E1 | 🟠 Élevé | Saut de position après un pinch | L |
| E2 | 🟠 Élevé | Boutons masqués cliquables : actions involontaires | L |
| E3 | 🟠 Élevé | Ralenti « global » impossible en direct (retour arrière toutes les ~1,6 s) | L |
| E4 | 🟠 Élevé | Mode ANALYSE : vidéo figée sur un fichier périmé | L |
| E5 | 🟠 Élevé | Source rechargée sans attendre `loadedmetadata` | L + S |
| E6 | 🟠 Élevé | Pas de Wake Lock, pas de gestion de la perte caméra/arrière-plan | L |
| E7 | 🟠 Élevé | `stopSession` : dernier chunk traité après le nettoyage | L |
| E8 | 🟠 Élevé | Curseur et boutons déclenchent aussi le scrub au doigt | L |
| M1 | 🟡 Moyen | `frameRate.min: 30` fait échouer la caméra, message d'erreur vide | E |
| M2 | 🟡 Moyen | Pas de gestes souris/clavier : zoom, pan, scrub inutilisables sur ordinateur | L |
| M3 | 🟡 Moyen | Pas de zone de sécurité (safe area) en PWA, `100vh` sur Safari | L + S |
| M4 | 🟡 Moyen | Icône ▶/⏸ pas resynchronisée après retour au direct | L |
| M5 | 🟡 Moyen | Pas de pas image fiable (1/60 s fixe, seek approximatif) | L |
| M6 | 🟡 Moyen | Retard affiché basé sur l'horloge murale, pas sur la vidéo | L + S |
| M7 | 🟡 Moyen | Pas de garde contre le double clic sur « Démarrer » | L |
| F1 | ⚪ Faible | Valeurs « bidon » à l'écran (« Optimisé », « 60 fps » avant démarrage, « RAM ») | L |
| F2 | ⚪ Faible | `vid.src = ""` provoque une erreur média | L |
| F3 | ⚪ Faible | Code mort (`isSwiping`), 4 minuteurs au lieu d'une boucle | L |
| F4 | ⚪ Faible | Cible tactile trop petite (22–28 px), textes de 10–11 px | L |

### 🔴 Critiques

**C1 — Mémoire non plafonnée [L]** — `index.html:1040-1042, 1061`
`chunks` ne fait que grossir (`chunks.push`, jamais de `shift`). Le README parle de « ring buffers » : **ils n'existent pas dans le code**. À la cible de 5 Mb/s (`videoBitsPerSecond`, ligne 1037), cela fait environ 37 Mo par minute, soit 2,2 Go par heure. Les navigateurs sur iPad coupent un onglet bien avant. Le compteur « RAM » ne mesure d'ailleurs que la taille des chunks, pas la mémoire réellement utilisée (copies décodées, blobs recollés), et « Statut : Optimisé » est un texte fixe (ligne 806).

Pourquoi ce n'est pas un simple `chunks.shift()` : avec `MediaRecorder`, **seul le premier chunk contient l'en-tête du fichier**. Supprimer les plus anciens rend tout le reste illisible. Il faut une autre approche, voir §5.

**C2 — Recollage + rechargement chaque seconde [E + L]** — `index.html:1060-1081`
`rebuildStream()` est appelé à chaque chunk (1/s). Elle crée un `Blob` de tout l'historique, une nouvelle URL, puis, pour chaque écran en direct, **remplace `video.src`** dès qu'il reste moins de 2 s de vidéo ou que la durée est inconnue (`isNaN(remaining)`).

Mesuré sur l'écran 1 en Chromium (retard réglé à 5 s) : `src` réassigné 5 fois en ~20 s, avec `duration` à `null` (inconnue) sur 7 des 8 relevés. Chaque réassignation réinitialise le décodeur, ce qui provoque un clignotement ou un arrêt, et le coût augmente avec la taille du fichier.

Autre effet : les écrans n'ont jamais besoin de la dernière seconde (ils affichent à −20 s minimum). Il n'y a donc aucune raison de recoller toutes les secondes.

**C3 — Durée inconnue sur WebM [E]**
Chromium enregistre en WebM (`video/webm;codecs=vp8`, mesuré). Ces fichiers n'ont ni durée ni index de positionnement tant que l'enregistrement est en cours : `duration` valait `null` (non fini) dans 7 relevés sur 8, `seekable` sans fin. Conséquences probables : positionnement lent ou approximatif, curseur et `currentTime` qui ne correspondent pas, et le test `remaining < 2 || isNaN(remaining)` toujours vrai (cause directe de C2). Safari produit du MP4 fragmenté, dont le comportement de positionnement est différent et **non vérifié** [S].

**C4 — Le pinch remet le zoom à 1× tout seul [L]** — `index.html:972-989`
Le « double tap » est détecté par un `touchend` qui compare avec le `touchend` précédent (< 300 ms). Or **relever deux doigts après un pinch produit deux `touchend` très rapprochés** : le deuxième est pris pour un double tap et remet `scale = 1`. Le zoom se perd donc souvent à la fin du geste. Même effet en tapant deux fois vite sur Play, −3 s, +3 s : le zoom saute.
C'est très probablement la cause principale du « pas moyen de rester zoomé et lancer la lecture ».

**C5 — Service worker figé [L]** — `sw.js:1, 32-38`
Stratégie « cache d'abord » avec un nom de cache fixe (`tridelay-v1`, ancien nom du projet). Tant que `sw.js` ne change pas, le navigateur ne détecte aucune nouvelle version, et `index.html` reste servi depuis le cache pour toujours. Une PWA installée sur un iPad **ne recevra jamais** les correctifs, sauf désinstallation.

### 🟠 Élevés

**E1 — Saut après un pinch [L]** — `index.html:918-925, 937-969, 972-976`
Quand on relève un seul doigt d'un pinch, il reste un doigt actif mais `startX/startY/scrubStartTime` ne sont pas remis à zéro (aucun `touchstart` n'est émis). Au prochain `touchmove`, le delta est calculé depuis l'ancienne position : **saut de pan** si on est zoomé, **saut de scrub** (et passage en ANALYSE) si on est revenu sous 1,05×.

**E2 — Boutons masqués cliquables [L]** — CSS `index.html:148-150, 233-235`
`.hud-layer.hidden` ne fait que `opacity: 0`, et `.hud-bottom` garde `pointer-events: auto`. Taper dans la zone basse d'un écran en direct **appuie sur un bouton invisible** (Play, −3 s…) : `pointerdown` réaffiche le HUD, puis le `click` part sur le bouton. C'est un générateur de comportements « mystères » en séance.

**E3 — Ralenti global inutilisable en direct [L]** — `index.html:1116-1118, 1248-1259`
`setGlobalSpeed(0.5)` ne passe pas en ANALYSE. En mode DIRECT, `engineTick` force `currentTime = targetPos` dès que l'écart dépasse 1,2 s. À 0,25×, la vidéo prend du retard sur le « direct » et est ramenée en avant toutes les ~1,6 s. Même chose après `returnToLive` si la vitesse globale est < 1.

**E4 — Mode ANALYSE sur un fichier périmé [L]** — `index.html:1069-1081, 1101`
En ANALYSE, la source n'est plus rechargée (`s.mode === 'LIVE'` requis), donc la vidéo ne contient plus que ce qui existait au dernier rechargement. Le curseur, lui, a pour `max` le temps écoulé. On peut donc glisser le curseur vers une zone que la vidéo n'a pas, et la lecture s'arrête à la fin du fichier périmé. Comme chaque action relance le compte à rebours de 10 s, on peut rester longtemps dans cet état.

**E5 — Source rechargée sans attendre `loadedmetadata` [L + S]** — `index.html:1073-1078, 1186-1190`
`vid.src = …; vid.currentTime = pos;` est exécuté d'affilée. Sur plusieurs navigateurs (Safari en particulier), un `currentTime` posé avant les métadonnées est ignoré : la vidéo repart de 0. Il faut attendre `loadedmetadata` avant de se positionner. Les erreurs de `play()` sont avalées (`.catch(() => {})`).

**E6 — Cycle de vie de la séance [L]**
Aucun `navigator.wakeLock` : l'iPad se met en veille, la caméra s'arrête, la séance est perdue. Aucun écouteur sur `track.onended`, `mediaRecorder.onerror` ni `visibilitychange` : si la caméra est coupée (appel, retour à l'accueil, permission retirée), l'interface continue comme si de rien n'était et les écrans se figent.

**E7 — Fin de séance [L]** — `index.html:1039-1044, 1314-1321`
`mediaRecorder.stop()` émet un dernier `dataavailable` **après** le nettoyage (`chunks = []`, URL révoquées). Ce chunk est repoussé dans `chunks`, une nouvelle URL est créée, et le compteur « RAM » repart d'une valeur non nulle. À la séance suivante, le tableau commence par un morceau de l'ancienne séance : l'en-tête du fichier est faux, ce qui peut rendre la nouvelle séance illisible [S]. Il faut détacher le gestionnaire ou attendre `onstop` avant de nettoyer.

**E8 — Curseur et boutons déclenchent aussi le scrub [L]** — `index.html:927-969`
Les `touchmove` sont écoutés sur toute la carte, sans filtrer la cible. Faire glisser le curseur de la barre, ou bouger légèrement le doigt sur un bouton, déclenche **aussi** le scrub au doigt. Deux mécanismes se disputent `currentTime`.

### 🟡 Moyens

* **M1 [E]** — `index.html:1022` : `frameRate: { ideal: 60, min: 30 }`. Une caméra incapable de 30 images/s fait échouer `getUserMedia` (OverconstrainedError). Constaté avec la caméra factice (20 i/s) : l'alerte affiche « Erreur caméra : » avec un message **vide**. À remplacer par `ideal` sans `min`, et par un message d'erreur utile (permission refusée, caméra absente, HTTPS requis…) dans l'interface plutôt que `alert()`.
* **M2 [L]** — Les gestes n'utilisent que des événements `touch*`. Sur Chrome ou Safari de bureau : **pas de zoom, pas de pan, pas de scrub à la souris**. Puisque l'app cible tous les navigateurs, il faut passer aux Pointer Events (souris, doigt, stylet) plus la molette/pinch trackpad et des raccourcis clavier (espace, flèches, J/K/L).
* **M3 [L + S]** — `apple-mobile-web-app-status-bar-style: black-translucent` sans `viewport-fit=cover` ni `env(safe-area-inset-*)` : en PWA, le haut de l'écran passe sous la barre d'état. `100vh` (lignes 55, 63, 86) dépasse en onglet Safari à cause de la barre d'adresse : utiliser `100dvh`.
* **M4 [L]** — `returnToLive` ne remet pas l'icône Play/Pause à jour. Après une pause suivie du retour automatique au direct, le bouton affiche ▶ alors que la vidéo joue. Cause de fond : l'interface est mise à jour à la main au lieu de s'appuyer sur les événements `play`, `pause`, `ratechange`.
* **M5 [L]** — `FRAME_STEP = 1/60` est fixe, alors que la caméra peut tourner à 30 i/s : deux appuis pour une image. Le positionnement par `currentTime` n'est pas précis à l'image près sur ces fichiers. L'API `requestVideoFrameCallback` donne les vrais temps d'image.
* **M6 [L + S]** — Le retard affiché (`updateTag`) et la cible de lecture se calculent avec `Date.now()` depuis le clic sur « Démarrer ». Or la vidéo enregistrée démarre avec un petit décalage et peut perdre des images : **le retard réel peut différer du retard affiché de quelques centaines de ms**. À mesurer sur iPad ; avec des horodatages d'encodage (§5) le problème disparaît.
* **M7 [L]** — `isRunning` n'est mis à `true` qu'après `await getUserMedia`. Un double clic rapide lance deux flux.

### ⚪ Faibles

* **F1** — « Statut : Optimisé » fixe, « 60 fps » écrit en dur avant le démarrage, étiquette « RAM » inexacte.
* **F2** — `s.vid.src = ""` (ligne 1301) recharge la page comme média et déclenche une erreur. Utiliser `removeAttribute('src')` puis `load()`.
* **F3** — `isSwiping` n'est jamais lu ; 1 minuteur global à 250 ms + 1 minuteur par écran à 100 ms (compte à rebours) au lieu d'une boucle unique ou d'une animation CSS.
* **F4** — Boutons de 22–28 px (la recommandation Apple est de 44 pt) et textes de 0,6–0,72 rem (~10–11 px). Pour un usage sur le terrain (gants, mains moites, soleil), c'est trop petit. Voir §6.

### Ce qui est solide

* **Aucune donnée n'est envoyée** : aucun `fetch`/XHR dans le code applicatif ; seule la mise en cache du service worker utilise le réseau [L].
* Le principe d'état LIVE/ANALYSE avec retour automatique au bout de 10 s est clair et utile.
* Le verrouillage de la console, la grille de repères et le zoom (concept) sont de bonnes idées bien pensées pour l'usage.

---

## 3. Pourquoi la lecture se dégrade quand on rembobine, avance ou met en pause

Hypothèse de travail, cohérente avec C1–C3 et E4–E5 (à confirmer par une mesure sur iPad) :

1. Plus la séance dure, plus le fichier recollé grossit. Le positionnement dans un WebM sans index (C3) est un balayage séquentiel : le temps d'un `seek` **augmente avec la durée de la séance** [S].
2. Pendant ce temps, le rechargement toutes les secondes (C2) interrompt le décodeur, parfois en plein positionnement.
3. Le HUD, les gestes et les minuteurs écrivent tous dans `currentTime` sans coordination (E1, E3, E8, boucle `engineTick`).

Résultat : sauts, arrêts, images répétées, retours au direct inattendus. Corriger les symptômes un par un sans changer le moteur donnerait un résultat fragile.

---

## 4. Lecture en zoom : est-ce faisable ?

**Oui, sans réserve technique.**

* **[E]** Test en Chromium : `scale(2)` appliqué à la vidéo puis `togglePlay()` → la lecture démarre et `currentTime` avance (14,46 s → 16,46 s en 2 s). Le zoom n'est qu'une transformation CSS ; rien dans le code n'interdit de lire en zoom.
* Le problème rencontré vient donc de l'interface, pas d'une limite : C4 (remise à 1× involontaire), E1 (sauts après un pinch), E2 (boutons masqués cliquables), E8 (le doigt sur un bouton déclenche un pan/scrub).
* Sur iPad/Safari, la transformation CSS d'une vidéo en lecture est en général fluide, mais **je ne l'ai pas vérifié** [S].

Pour fiabiliser : appliquer le zoom au conteneur (pas à `<video>`), centrer le pinch sur le milieu des doigts, borner le pan, découpler l'état de zoom de l'état de lecture, et ne remettre le zoom à 1× que par un double tap **sur une seule touche, sans mouvement**, ou par un bouton « 1× » explicite.

**Idée UX utile au coach :** une option « Zoom lié » qui applique le même zoom/pan aux 3 écrans, pour comparer la même zone du corps (appui, hanche…) sur les 3 passages.

---

## 5. Architecture proposée

Objectif : simple, maintenable, sans dette, standards 2026, **toujours sans étape de build**.

### 5.1 Structure du code (sans build)

Les modules ES natifs (`<script type="module">`) sont supportés par tous les navigateurs ciblés.

```
index.html          # structure + <template> d'un écran (un seul, instancié 3×)
styles.css          # variables, layout, composants (CSS nesting, dvh, container queries)
sw.js               # cache versionné
manifest.webmanifest
icons/              # icône(s) de l'app
js/
  main.js           # assemblage, état de séance
  recorder.js       # caméra + enregistrement + tampon circulaire (Recorder, RingBuffer)
  player.js         # un lecteur : machine d'état LIVE ↔ ANALYSE, seul propriétaire de currentTime
  gestures.js       # Pointer Events : pinch, pan, scrub, double tap (un seul code pour doigt/souris/stylet)
  hud.js            # affichage, auto-masquage (avec `inert` quand masqué)
  settings.js       # retards, vitesse, grille, sauvegarde localStorage
test/
  smoke.spec.js     # Playwright, caméra factice (déjà démontré possible dans cet audit)
```

Principes :

* **Une seule définition d'un écran** (`<template>` ou élément personnalisé) au lieu de 3 copies HTML + 3 objets d'état.
* **Une machine d'état explicite** par lecteur (`LIVE`, `ANALYSE`, `ATTENTE`), seule autorisée à modifier `currentTime`.
* **L'interface suit les événements média** (`play`, `pause`, `seeked`, `ratechange`) au lieu d'être mise à jour à la main.
* **Pointer Events** à la place de `touch*` : un seul code pour iPad, souris et trackpad, plus molette (zoom) et clavier.
* **HUD masqué = `inert`** (plus de clics fantômes) ; zones tactiles ≥ 44 px.
* **`@ts-check` + JSDoc** pour avoir du typage sans compilateur ; ESLint/Prettier optionnels.
* **CI** : GitHub Actions avec un test de fumée Playwright (Chromium + caméra factice, comme dans cet audit) et déploiement GitHub Pages.
* **Service worker** : `index.html` en « stale-while-revalidate », cache versionné automatiquement, bandeau « Nouvelle version disponible — Recharger ».

### 5.2 Moteur d'enregistrement : trois niveaux

| Niveau | Principe | Gain | Coût / risque |
|---|---|---|---|
| **A. Correctifs sur place** | Garder `MediaRecorder`, ne recoller que toutes les ~10 s (et seulement si un écran approche de la fin), attendre `loadedmetadata`, plafonner la durée | Stabilité nettement meilleure, peu de code | La mémoire reste non plafonnée sur de très longues séances |
| **B. Époques `MediaRecorder`** | Arrêter/redémarrer l'enregistreur en recouvrement toutes les ~2–3 min : chaque « époque » est un fichier autonome, on supprime les anciennes une fois dépassées par tous les retards | Mémoire plafonnée (≈ 2 × durée d'époque), fichiers plus petits donc positionnement plus rapide | Un petit rechargement quand un écran change d'époque ; logique de recouvrement à écrire et tester |
| **C. WebCodecs + canvas** | `VideoEncoder` produit des images encodées (horodatées) gardées dans un vrai tampon circulaire ; `VideoDecoder` + `<canvas>` affichent ; images clés régulières | Retard exact, pas à pas image par image fiable, **pas de blob, pas de `seek` sur fichier**, lecture en zoom triviale, mémoire strictement bornée | Plus de code (~400 lignes) ; gestion de 3 décodeurs sur iPad à valider ; Safari/iPad à tester en vrai avant de s'engager [S] |

**Recommandation :** A tout de suite (rapide, élimine la plupart des bugs), puis un **prototype de C sur iPad** pour décider entre B et C sur des mesures plutôt que sur des suppositions. WebCodecs est disponible dans Chrome, Safari 16.4+ et Firefox récent, mais le comportement avec 3 décodeurs simultanés sur iPad doit être mesuré.

---

## 6. Pistes UX / UI

**Terrain d'abord**

* Zones tactiles ≥ 44 px, textes ≥ 14 px, icônes avec `aria-label`. Les boutons d'un écran de 1/4 d'iPad sont aujourd'hui minuscules.
* **Écran noir avant que le retard soit atteint** : montrer « Disponible dans 12 s » (l'écran 3 reste vide 60 s au démarrage).
* **Compte à rebours de 10 s** : lisible et accessible (l'anneau fait 16 px) ; permettre de le suspendre quand on met en pause volontairement (« figer »), ou le rallonger pour la pause. À trancher avec toi : voir §8.
* **Retour au direct** : transition douce plutôt qu'un rechargement visible.
* **Verrou** : le bouton cadenas se désactive d'un tap ; pour une vraie protection, exiger un appui long (~1 s).
* **Plein écran** : utiliser l'API Fullscreen quand elle existe (pas sur iPhone, mais sur iPad/ordinateur) et ajouter un bouton de sortie évident.
* **Orientation** : la grille 2×2 est pensée paysage ; prévoir un agencement portrait (container queries).

**Pour coacher**

* Zoom lié sur les 3 écrans (§4), bouton « 1× » explicite, indicateur du niveau de zoom.
* Pas image par image fiable, avec affichage du numéro/temps d'image.
* Enregistrer ou partager un extrait (feuille de partage / enregistrement du clip) : à valider avec toi, la confidentialité « rien n'est stocké » est actuellement un argument fort.
* Réglages mémorisés (retards, vitesse, grille) dans `localStorage`.
* Choix de la caméra (avant/arrière/USB), utile sur ordinateur.
* Affichage honnête du tampon : « Tampon : 62 s / 38 Mo » plutôt que « RAM » et « Optimisé ».
* Messages d'erreur dans l'interface (caméra refusée, HTTPS manquant, perte caméra), avec bouton « Reprendre ».

**Ordinateur**

* Raccourcis : `Espace` lecture/pause, `←`/`→` image, `Maj+←/→` ±3 s, `L` retour au direct, `+`/`-`/`0` zoom.
* Zoom à la molette et pan à la souris.

---

## 7. Feuille de route proposée (à choisir)

Chaque lot est indépendant et ferait l'objet d'une PR séparée.

| Lot | Contenu | Corrige |
|---|---|---|
| **1. Stabiliser les gestes** | Pointer Events, pinch centré, pan borné, double tap fiable, `inert` sur le HUD masqué, filtrage des cibles | C4, E1, E2, E8, M2 (partiel), §4 |
| **2. Stabiliser la lecture** | Recollage espacé, attente de `loadedmetadata`, ANALYSE à jour, ralenti en direct, synchro des boutons par événements | C2, C3 (partiel), E3, E4, E5, M4 |
| **3. Cycle de vie** | Wake Lock, erreurs caméra, fin de séance propre, garde double clic, `frameRate` sans `min` | E6, E7, M1, M7 |
| **4. PWA** | Service worker versionné + bandeau de mise à jour, safe areas, `dvh` | C5, M3 |
| **5. Mémoire plafonnée** | Niveau B ou C du §5.2, après prototype iPad | C1, C3, M5, M6 |
| **6. Structure & CI** | Modules ES, un seul gabarit d'écran, `@ts-check`, test Playwright, déploiement Pages | F3 et dette |
| **7. UX/UI** | §6 : cibles tactiles, attente avant retard, zoom lié, réglages, plein écran | F4, UX |

Ordre conseillé : **1 → 2 → 3 → 4**, puis le prototype du lot 5, puis 6 et 7. Les lots 1 à 4 se font sans toucher à l'architecture.

---

## 8. Décisions de produit (réponses de Michael, 2026-10-01)

1. **Pause volontaire** : retour automatique au direct après 10 s, comportement actuel conservé.
2. **Durée de séance** : stable et performant sans limite en théorie ; en pratique 20–25 min en moyenne, rarement plus de 40 min. À 5 Mb/s, 25 min représentent ≈ 0,9 Go et 40 min ≈ 1,5 Go : le niveau A seul (§5.2) ne suffit donc pas pour garantir une séance de 40 min sur iPad. Il faut un tampon plafonné (niveau B ou C).
3. **Zoom lié** sur les 3 écrans : oui, **optionnel, activable par un bouton**.
4. **Sauvegarde d'extrait** : non pour le moment.
5. **Versions visées** : iPadOS 26 (ou plus récent). Wake Lock, `requestVideoFrameCallback` et WebCodecs y sont disponibles, ce qui rend le niveau C du §5.2 envisageable ; il reste à mesurer 3 décodeurs simultanés sur un vrai iPad.
