# Heraldis

Le jeu Heraldis (regles : `../Heraldis_Regles_DEFINITIVES.md`) en PWA installable,
hors-ligne, sans build. Construite sur **pwa-engine** (dossier `engine/`).

Modes : contre l'ordinateur, a deux sur le meme appareil, IA contre IA.

## Lancer en local

Un service worker exige http:// (pas file://) :

```
python3 -m http.server 8000
# puis http://localhost:8000
```

## Structure

| Fichier | Role |
|---|---|
| `data.js` | plateau, Maisons, IA proposees et leurs niveaux (`window.HERALDIS_DATA`) |
| `game.js` | moteur de regles pur (`HeraldisGame`) : Premier Serment, capture, immunite, Treve, passe, fin |
| `ai.js` | les IA (`HeraldisAI.choose(state, id, cfg)`) |
| `ai-worker.js` | execute l'IA dans un Web Worker (repli automatique sur la page si indisponible) |
| `app.js` | ecrans, deroulement de la partie, annuler, conseil, sauvegarde, statistiques |
| `app.css` | theme (tokens `:root`) + plateau |
| `engine/` | le moteur, **copie** depuis toolbox/pwa-engine (ne pas editer ici) |
| `tools/tests/` | tests Node des regles et des IA |

## Les IA

| IA | Principe | Niveaux |
|---|---|---|
| Aleatoire | coup legal au hasard | — |
| Glouton | 1 coup d'avance + fonction d'evaluation | bruit 12 / 4 / 0 |
| MCTS | UCT, simulations uniformement aleatoires | 0,25 s / 1,2 s / 3 s |
| MCTS tactique | UCT, simulations guidees (gagne, bloque, prefere les Maisons) | 0,25 s / 1,2 s / 3 s |
| Minimax α-β | negamax + PVS, approfondissement iteratif, table de transposition Zobrist, coups tueurs, historique | prof. 2 / 4 / illimitee (3 s) |

L'evaluation (Glouton, Minimax) parcourt les 28 fenetres de 4 cases : une fenetre
est morte si l'adversaire y tient une Maison (immunisee), un pion adverse sur
Alliance coute 1 temps s'il est capturable, 2 sinon ; les pions sur Alliance que
l'adversaire peut capturer valent moins ; menaces immediates et Maisons possedees
comptent. Les niveaux se reglent dans `data.js`.

## Verifier

```
node --test tools/tests/*.test.js      # regles + IA
./tools/check-app.sh                   # versions, APP_SHELL, identifiants
```

## Livrer une nouvelle version

1. `./tools/bump-version.sh vX.Y.Z` — bumpe `index.html`, `app.js`,
   `service-worker.js`, `manifest.json` d'un coup.
2. Ajoute tout nouveau fichier statique a `APP_SHELL` dans `service-worker.js`.

## Mettre a jour le moteur

Depuis `toolbox/pwa-engine/` : `./tools/sync-engine.sh <chemin-vers>/heraldis/app`,
puis `./tools/bump-version.sh vX.Y.Z` ici (le cache SW inclut `engine/*`).
