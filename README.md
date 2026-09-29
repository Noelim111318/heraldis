# Heraldis

Jeu de plateau abstrait pour 2 joueurs : alignez 4 pions sur un plateau de 25
blasons, en forgeant des alliances entre cinq Maisons (Loup, Aigle, Ours, Cerf,
Sanglier).

| | |
|---|---|
| [`Heraldis_Regles_DEFINITIVES.md`](Heraldis_Regles_DEFINITIVES.md) | les règles du jeu |
| [`app/`](app/) | l'application (PWA installable, hors-ligne) : contre l'ordinateur, à deux, ou IA contre IA |

## Jouer

**En ligne : https://noelim111318.github.io/heraldis/** (installable sur mobile
via « Ajouter à l'écran d'accueil »). Publiée automatiquement à chaque push sur
`main` (`.github/workflows/pages.yml`).

En local :

```
cd app
python3 -m http.server 8000   # puis http://localhost:8000
```

Cinq IA sont proposées (Aléatoire, Glouton, MCTS, MCTS tactique, Minimax α-β),
chacune en trois niveaux. Détails dans [`app/README.md`](app/README.md).

## Vérifier

```
cd app
node --test tools/tests/*.test.js
./tools/check-app.sh
```
