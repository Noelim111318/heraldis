/* Heraldis — donnees du jeu.
 *
 * Tout le contenu editable tient ici : plateau, Maisons, IA proposees et
 * leurs niveaux. La logique des regles vit dans game.js, les IA dans ai.js.
 * Ce fichier est aussi charge par ai-worker.js (pas de DOM ici).
 */
(function (root) {
  'use strict';

  var DATA = {
    title: 'Heraldis',

    // Les cinq Maisons Fondatrices. `key` sert dans BOARD ci-dessous ;
    // `crest` = embleme crests/<crest>.png (silhouette, teintee en CSS).
    houses: [
      { key: 'L', name: 'Loup',     crest: 'loup', color: '#5E7398' },
      { key: 'A', name: 'Aigle',    crest: 'aigle', color: '#C9962E' },
      { key: 'O', name: 'Ours',     crest: 'ours', color: '#86573A' },
      { key: 'C', name: 'Cerf',     crest: 'cerf', color: '#4A8458' },
      { key: 'S', name: 'Sanglier', crest: 'sanglier', color: '#A0413C' },
    ],

    // Plateau 5x5, ligne par ligne (regles §2). 1 lettre = Maison Fondatrice,
    // 2 lettres = Alliance. Symetrique par rotation a 180°.
    board: [
      'C',  'LA', 'O',  'A',  'L',
      'LO', 'OC', 'AS', 'AO', 'LC',
      'S',  'OS', 'CS', 'SO', 'S',
      'CL', 'OA', 'SA', 'CO', 'OL',
      'L',  'A',  'O',  'AL', 'C',
    ],

    piecesPerPlayer: 13,
    alignToWin: 4,

    // IA proposees, de la plus faible a la plus forte (`stars`, mesure en
    // tournoi a temps egal). `levels` : reglages par niveau, lus par ai.js.
    ais: [
      {
        id: 'random', name: 'Aléatoire', stars: 1, icon: '🎲',
        desc: 'Joue un coup légal au hasard. Idéal pour découvrir les règles.',
        levels: null,
      },
      {
        id: 'greedy', name: 'Glouton', stars: 2, icon: '🍖',
        desc: 'Regarde un seul coup à l\'avance et prend celui qui améliore le plus sa position. Voit les menaces immédiates.',
        levels: {
          facile:    { noise: 12 },
          moyen:     { noise: 4 },
          difficile: { noise: 0 },
        },
      },
      {
        id: 'mcts', name: 'MCTS', stars: 3, icon: '🎰',
        desc: 'Monte-Carlo Tree Search (UCT) : simule des milliers de fins de partie au hasard et joue le coup qui gagne le plus souvent.',
        levels: {
          facile:    { time: 250 },
          moyen:     { time: 1200 },
          difficile: { time: 3000 },
        },
      },
      {
        id: 'mcts-heavy', name: 'MCTS tactique', stars: 4, icon: '🧠',
        desc: 'MCTS dont les simulations sont guidées : elles saisissent les victoires, bloquent les menaces et privilégient les Maisons.',
        levels: {
          facile:    { time: 250 },
          moyen:     { time: 1200 },
          difficile: { time: 3000 },
        },
      },
      {
        id: 'minimax', name: 'Minimax α-β', stars: 5, icon: '🌳',
        desc: 'Explore l\'arbre des coups en supposant que l\'adversaire joue au mieux. Élagage alpha-bêta, approfondissement itératif et table de transposition.',
        levels: {
          facile:    { depth: 2,  time: 400 },
          moyen:     { depth: 4,  time: 1200 },
          difficile: { depth: 30, time: 3000 },
        },
      },
    ],

    levels: [
      { id: 'facile',    name: 'Facile' },
      { id: 'moyen',     name: 'Moyen' },
      { id: 'difficile', name: 'Difficile' },
    ],

    // IA utilisee par le bouton « Conseil ».
    hintAi: { id: 'minimax', level: 'moyen' },
  };

  root.HERALDIS_DATA = DATA;
  root.APP_DATA = DATA;
  if (typeof module !== 'undefined' && module.exports) module.exports = DATA;
})(typeof globalThis !== 'undefined' ? globalThis : this);
