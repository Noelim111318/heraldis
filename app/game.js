/* Heraldis — moteur de regles (pur, sans DOM).
 *
 * Charge par la page (index.html), par le Worker de l'IA (ai-worker.js) et par
 * les tests Node (tools/tests/). Expose `HeraldisGame`.
 *
 * Etat d'une partie (mutable, pour que l'IA puisse jouer/annuler vite) :
 *   board    Int8Array(25)  0 vide, 1 Clair, 2 Fonce
 *   count    [_, n1, n2]    pions poses par joueur (reserve = 13 - count)
 *   hmask    [_, m1, m2]    Maisons possedees (1 bit par symbole). Un pion
 *                           sur une Maison n'est jamais capture : le masque ne
 *                           fait que grandir.
 *   toMove   1 | 2
 *   truce    case que le joueur au trait ne peut PAS reprendre (§6), ou -1
 *   ply      nombre de coups joues (passes comprises)
 *   winner   0 en cours, 1/2 vainqueur, 3 nulle
 *   winLine  les 4 cases alignees, ou null
 *   lastMove derniere case jouee, PASS, ou -1
 *
 * Un coup est un entier : 0..24 = la case visee (pose ou capture selon ce
 * qu'elle contient), 25 = passer.
 */
(function (root) {
  'use strict';

  var DATA = root.HERALDIS_DATA || (typeof require === 'function' ? require('./data.js') : null);

  var SIZE = 5;
  var N = SIZE * SIZE;
  var PASS = N;
  var LIGHT = 1, DARK = 2, DRAW = 3;
  var PIECES = DATA.piecesPerPlayer;
  var ALIGN = DATA.alignToWin;

  /* ------------------------------------------------------------ Plateau */
  var SYM_INDEX = {};
  DATA.houses.forEach(function (h, i) { SYM_INDEX[h.key] = i; });

  var CELLS = DATA.board.map(function (code, i) {
    var syms = code.split('').map(function (k) { return SYM_INDEX[k]; });
    var mask = 0;
    syms.forEach(function (s) { mask |= 1 << s; });
    var row = Math.floor(i / SIZE), col = i % SIZE;
    return {
      i: i, row: row, col: col,
      syms: syms,
      mask: mask,
      house: syms.length === 1,
      label: 'ABCDE'.charAt(col) + (row + 1),
    };
  });
  var IS_HOUSE = new Int8Array(N);
  var MASK = new Int8Array(N);
  var ALLIANCES = [];
  CELLS.forEach(function (c) {
    IS_HOUSE[c.i] = c.house ? 1 : 0;
    MASK[c.i] = c.mask;
    if (!c.house) ALLIANCES.push(c.i);
  });

  // Toutes les fenetres de 4 cases alignees (lignes, colonnes, 2 diagonales).
  var WINDOWS = [];
  var DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (var r = 0; r < SIZE; r++) {
    for (var c = 0; c < SIZE; c++) {
      for (var d = 0; d < DIRS.length; d++) {
        var dr = DIRS[d][0], dc = DIRS[d][1];
        var er = r + dr * (ALIGN - 1), ec = c + dc * (ALIGN - 1);
        if (er < 0 || er >= SIZE || ec < 0 || ec >= SIZE) continue;
        var w = [];
        for (var k = 0; k < ALIGN; k++) w.push((r + dr * k) * SIZE + (c + dc * k));
        WINDOWS.push(w);
      }
    }
  }
  var WIN_BY_CELL = [];
  for (var i = 0; i < N; i++) WIN_BY_CELL.push([]);
  WINDOWS.forEach(function (w, wi) { w.forEach(function (cell) { WIN_BY_CELL[cell].push(wi); }); });

  /* --------------------------------------------------------------- Etat */
  function newGame() {
    return {
      board: new Int8Array(N),
      count: [0, 0, 0],
      hmask: [0, 0, 0],
      toMove: LIGHT,
      truce: -1,
      ply: 0,
      winner: 0,
      winLine: null,
      lastMove: -1,
    };
  }

  function clone(s) {
    return {
      board: new Int8Array(s.board),
      count: s.count.slice(),
      hmask: s.hmask.slice(),
      toMove: s.toMove,
      truce: s.truce,
      ply: s.ply,
      winner: s.winner,
      winLine: s.winLine ? s.winLine.slice() : null,
      lastMove: s.lastMove,
    };
  }

  // Forme JSON (localStorage, postMessage) <-> etat.
  function toJSON(s) {
    return {
      board: Array.prototype.slice.call(s.board),
      toMove: s.toMove, truce: s.truce, ply: s.ply,
      winner: s.winner, winLine: s.winLine, lastMove: s.lastMove,
    };
  }
  function fromJSON(o) {
    var s = newGame();
    for (var i = 0; i < N; i++) {
      var p = o.board[i] | 0;
      s.board[i] = p;
      if (p) {
        s.count[p]++;
        if (IS_HOUSE[i]) s.hmask[p] |= MASK[i];
      }
    }
    s.toMove = o.toMove === DARK ? DARK : LIGHT;
    s.truce = typeof o.truce === 'number' ? o.truce : -1;
    s.ply = o.ply | 0;
    s.winner = o.winner | 0;
    s.winLine = o.winLine || null;
    s.lastMove = typeof o.lastMove === 'number' ? o.lastMove : -1;
    return s;
  }

  function other(p) { return 3 - p; }
  function reserve(s, p) { return PIECES - s.count[p]; }

  // p peut-il capturer la case `cell` ? (§5 immunite + prerequis, §6 Treve)
  function canCapture(s, p, cell) {
    return s.board[cell] === 3 - p &&
      !IS_HOUSE[cell] &&
      (s.hmask[p] & MASK[cell]) === MASK[cell] &&
      cell !== s.truce;
  }

  /* -------------------------------------------------------------- Coups */
  // Remplit `out` (tableau reutilisable) avec les coups legaux ; renvoie le nombre.
  function genMoves(s, out) {
    var n = 0;
    if (s.winner) return 0;
    var p = s.toMove;
    if (s.count[p] >= PIECES) { out[0] = PASS; return 1; }          // §3 : passe
    var b = s.board;
    if (s.ply === 0) {                                                // §4 : Premier Serment
      for (var k = 0; k < ALLIANCES.length; k++) if (!b[ALLIANCES[k]]) out[n++] = ALLIANCES[k];
      return n;
    }
    var opp = 3 - p, hm = s.hmask[p];
    for (var i = 0; i < N; i++) {
      var v = b[i];
      if (v === 0) out[n++] = i;
      else if (v === opp && !IS_HOUSE[i] && (hm & MASK[i]) === MASK[i] && i !== s.truce) out[n++] = i;
    }
    return n;
  }

  function legalMoves(s) {
    var buf = new Array(N + 1);
    var n = genMoves(s, buf);
    buf.length = n;
    return buf;
  }

  function isLegal(s, m) {
    return legalMoves(s).indexOf(m) !== -1;
  }

  // Joue le coup (suppose legal). Renvoie un entier qui permet undo().
  function play(s, m) {
    var p = s.toMove;
    var rec = ((s.truce + 1) << 2) | ((s.lastMove + 1) << 7) | (s.hmask[p] << 12);
    if (m === PASS) {
      s.truce = -1;
    } else {
      var prev = s.board[m];
      rec |= prev;
      s.board[m] = p;
      s.count[p]++;
      if (prev) s.count[prev]--;
      if (IS_HOUSE[m]) s.hmask[p] |= MASK[m];
      // §6 : l'adversaire ne pourra pas reprendre immediatement cette case.
      s.truce = prev ? m : -1;
      // §7 : seul le joueur qui vient de jouer peut avoir aligne.
      var ws = WIN_BY_CELL[m], b = s.board;
      for (var k = 0; k < ws.length; k++) {
        var w = WINDOWS[ws[k]];
        if (b[w[0]] === p && b[w[1]] === p && b[w[2]] === p && b[w[3]] === p) {
          s.winner = p;
          s.winLine = w;
          break;
        }
      }
      if (!s.winner && s.count[1] + s.count[2] === N) s.winner = DRAW;
    }
    s.lastMove = m;
    s.toMove = 3 - p;
    s.ply++;
    return rec;
  }

  function undo(s, m, rec) {
    s.ply--;
    var p = 3 - s.toMove;
    s.toMove = p;
    s.winner = 0;
    s.winLine = null;
    s.truce = ((rec >> 2) & 31) - 1;
    s.lastMove = ((rec >> 7) & 31) - 1;
    s.hmask[p] = (rec >> 12) & 31;
    if (m !== PASS) {
      var prev = rec & 3;
      s.board[m] = prev;
      s.count[p]--;
      if (prev) s.count[prev]++;
    }
  }

  /* ------------------------------------------------------------ Textes */
  function playerName(p) { return p === LIGHT ? 'Clair' : 'Foncé'; }

  function cellName(i) {
    return CELLS[i].syms.map(function (k) { return DATA.houses[k].name; }).join(' + ');
  }

  // Description d'un coup, a appeler AVANT de le jouer.
  function describe(s, m) {
    var who = playerName(s.toMove);
    if (m === PASS) return who + ' passe (réserve vide)';
    var c = CELLS[m];
    var verb = s.board[m] ? 'capture' : 'pose en';
    return who + ' ' + verb + ' ' + c.label + ' (' + cellName(m) + ')';
  }

  var API = {
    SIZE: SIZE, N: N, PASS: PASS, LIGHT: LIGHT, DARK: DARK, DRAW: DRAW,
    PIECES: PIECES,
    CELLS: CELLS, IS_HOUSE: IS_HOUSE, MASK: MASK, ALLIANCES: ALLIANCES,
    WINDOWS: WINDOWS, WIN_BY_CELL: WIN_BY_CELL,
    newGame: newGame, clone: clone, toJSON: toJSON, fromJSON: fromJSON,
    other: other, reserve: reserve, canCapture: canCapture,
    genMoves: genMoves, legalMoves: legalMoves, isLegal: isLegal,
    play: play, undo: undo,
    playerName: playerName, cellName: cellName, describe: describe,
  };

  root.HeraldisGame = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
