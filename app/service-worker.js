/* Heraldis — service worker.
 * Toute la logique (precache tolerant, network-first, purge, cache runtime)
 * est dans engine/sw-core.js. Ici on declare juste l'identite du cache et la
 * liste des fichiers de la coque.
 *
 * >>> A chaque livraison : ./tools/bump-version.sh vX.Y.Z
 *     (bumpe APP_VERSION ici + index.html + app.js + manifest.json d'un coup)
 *     puis ajoute tout nouveau fichier statique a APP_SHELL ci-dessous.
 */
self.APP_SLUG = 'heraldis';
self.APP_VERSION = 'v1.7.0';

self.APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './data.js',
  './game.js',
  './ai.js',
  './ai-worker.js',
  './manifest.json',
  './favicon.ico',
  './fonts/cinzel-latin.woff2',
  './crests/loup.png',
  './crests/aigle.png',
  './crests/ours.png',
  './crests/cerf.png',
  './crests/sanglier.png',
  './diag.html',
  './engine/engine.js',
  './engine/diag.js',
  './engine/engine.css',
  './engine/sw-core.js',
  './engine/fonts/nunito-latin.woff2',
  './engine/fonts/nunito-latin-ext.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

importScripts('./engine/sw-core.js');
