/* Heraldis — intelligences artificielles (pur, sans DOM).
 *
 * Tourne dans le Worker (ai-worker.js), a defaut sur la page, et sous Node
 * pour les tests. Expose `HeraldisAI.choose(state, aiId, levelCfg)` qui
 * renvoie { move, info } de facon synchrone.
 *
 *   random      coup legal au hasard
 *   greedy      1 coup d'avance + fonction d'evaluation (+ bruit selon niveau)
 *   minimax     negamax alpha-beta, approfondissement iteratif, table de
 *               transposition (Zobrist), coups tueurs, heuristique historique
 *   mcts        UCT, simulations uniformement aleatoires
 *   mcts-heavy  UCT, simulations guidees (gagne / bloque / prefere les Maisons)
 */
(function (root) {
  'use strict';

  var G = root.HeraldisGame || (typeof require === 'function' ? require('./game.js') : null);

  var N = G.N, PASS = G.PASS, DRAW = G.DRAW, PIECES = G.PIECES;
  var WINDOWS = G.WINDOWS, WIN_BY_CELL = G.WIN_BY_CELL;
  var IS_HOUSE = G.IS_HOUSE, MASK = G.MASK;
  var NW = WINDOWS.length;

  var WIN = 100000;          // victoire certaine (moins la distance en coups)
  var WIN_SOON = 20000;      // le joueur au trait a un coup gagnant immediat
  var MATE_BOUND = WIN - 1000;

  var rand = Math.random;
  function setRandom(fn) { rand = fn || Math.random; }
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }

  function shuffle(a, n) {
    n = n == null ? a.length : n;
    for (var i = n - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function popcount(x) { var c = 0; while (x) { x &= x - 1; c++; } return c; }

  /* --------------------------------------------------------- Evaluation */
  // Valeur d'une fenetre selon le nombre de « temps » qui manquent pour la
  // completer (case vide = 1, pion adverse capturable = 1, pion adverse sur
  // Alliance pas encore capturable = 2, pion adverse sur Maison = morte).
  var V_NEED = [0, 60, 12, 3, 0.8, 0.2, 0.05, 0, 0, 0];

  // Score du point de vue du joueur au trait (negamax). Entier.
  function evaluate(s) {
    var me = s.toMove, op = 3 - me, b = s.board;
    var hMe = s.hmask[me], hOp = s.hmask[op];
    var sumMe = 0, sumOp = 0, thMe = 0, thOp = 0;

    for (var wi = 0; wi < NW; wi++) {
      var w = WINDOWS[wi];
      var needMe = 0, needOp = 0, nMe = 0, nOp = 0, fragMe = 0, fragOp = 0;
      var deadMe = false, deadOp = false, gapMe = -1, gapOp = -1;
      for (var k = 0; k < 4; k++) {
        var c = w[k], v = b[c], m = MASK[c];
        if (v === 0) {
          needMe++; needOp++; gapMe = c; gapOp = c;
        } else if (v === me) {
          nMe++;
          if (IS_HOUSE[c]) deadOp = true;
          else if ((hOp & m) === m) { needOp++; gapOp = c; fragMe++; }
          else needOp += 2;
        } else {
          nOp++;
          if (IS_HOUSE[c]) deadMe = true;
          else if ((hMe & m) === m) { needMe++; gapMe = c; fragOp++; }
          else needMe += 2;
        }
      }
      if (!deadMe && nMe) {
        sumMe += V_NEED[needMe] * (1 - 0.2 * fragMe);
        if (needMe === 1) thMe |= 1 << gapMe;
      }
      if (!deadOp && nOp) {
        sumOp += V_NEED[needOp] * (1 - 0.2 * fragOp);
        if (needOp === 1) thOp |= 1 << gapOp;
      }
    }

    // Menace immediate du joueur au trait : il gagne au coup suivant (sauf si
    // la seule case gagnante est protegee par la Treve, ou s'il doit passer).
    if (thMe && s.count[me] < PIECES) {
      if (s.truce >= 0) thMe &= ~(1 << s.truce);
      if (thMe) return WIN_SOON;
    }

    var score = sumMe - sumOp;
    var nThOp = popcount(thOp);
    if (nThOp >= 2) score -= 150;      // difficile de parer deux menaces
    else if (nThOp === 1) score -= 5;
    score += 6 * (popcount(hMe) - popcount(hOp));
    score += 3;                        // avoir le trait
    return Math.round(score * 10);
  }

  // Coups gagnants immediats pour le joueur au trait.
  function winningMoves(s) {
    var p = s.toMove, b = s.board, out = [];
    if (s.winner || s.count[p] >= PIECES || s.ply === 0) return out;
    for (var wi = 0; wi < NW; wi++) {
      var w = WINDOWS[wi], n = 0, gap = -1;
      for (var k = 0; k < 4; k++) {
        if (b[w[k]] === p) n++; else gap = w[k];
      }
      if (n === 3 && (b[gap] === 0 || G.canCapture(s, p, gap)) && out.indexOf(gap) === -1) out.push(gap);
    }
    return out;
  }

  /* ---------------------------------------------------------- Aleatoire */
  function chooseRandom(s) {
    var moves = G.legalMoves(s);
    return { move: moves[Math.floor(rand() * moves.length)], info: { moves: moves.length } };
  }

  /* ------------------------------------------------------------ Glouton */
  function chooseGreedy(s, cfg) {
    var t0 = now();
    var noise = (cfg && cfg.noise) || 0;
    var moves = shuffle(G.legalMoves(s));
    var best = moves[0], bestSc = -Infinity, bestRaw = 0;
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var rec = G.play(s, m);
      var sc;
      if (s.winner === DRAW) sc = 0;
      else if (s.winner) sc = WIN;
      else sc = -evaluate(s);
      G.undo(s, m, rec);
      var noisy = sc + (noise ? (rand() * 2 - 1) * noise * 10 : 0);
      if (noisy > bestSc) { bestSc = noisy; best = m; bestRaw = sc; }
    }
    return { move: best, info: { score: bestRaw, moves: moves.length, ms: Math.round(now() - t0) } };
  }

  /* ------------------------------------------------------------ Minimax */
  // Zobrist : 2 x 32 bits pour limiter les collisions.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0);
    };
  }
  var zr = mulberry32(0x4E7A1D15);
  var ZA = new Int32Array(N * 3), ZB = new Int32Array(N * 3);
  var TA = new Int32Array(N + 1), TB = new Int32Array(N + 1);   // Treve (index +1)
  for (var zi = 0; zi < N * 3; zi++) { ZA[zi] = zr(); ZB[zi] = zr(); }
  for (zi = 0; zi <= N; zi++) { TA[zi] = zr(); TB[zi] = zr(); }
  var SIDE_A = zr() | 0, SIDE_B = zr() | 0;

  var TT_BITS = 18, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  var ttA = new Int32Array(TT_SIZE), ttB = new Int32Array(TT_SIZE);
  var ttDepth = new Int8Array(TT_SIZE), ttFlag = new Int8Array(TT_SIZE);
  var ttScore = new Int32Array(TT_SIZE), ttMove = new Int8Array(TT_SIZE);
  var EXACT = 1, LOWER = 2, UPPER = 3;

  var MAX_PLY = 64;
  var moveBufs = [], scoreBufs = [];
  for (var bi = 0; bi < MAX_PLY + 1; bi++) { moveBufs.push(new Int8Array(N + 1)); scoreBufs.push(new Float64Array(N + 1)); }
  var killers = new Int8Array((MAX_PLY + 1) * 2);
  var history = [null, new Float64Array(N + 1), new Float64Array(N + 1)];

  var ABORT = { abort: true };
  var hA = 0, hB = 0, nodes = 0, deadline = 0;

  function hashOf(s) {
    var a = 0, b = 0;
    for (var i = 0; i < N; i++) { a ^= ZA[i * 3 + s.board[i]]; b ^= ZB[i * 3 + s.board[i]]; }
    a ^= TA[s.truce + 1]; b ^= TB[s.truce + 1];
    if (s.toMove === 2) { a ^= SIDE_A; b ^= SIDE_B; }
    return [a, b];
  }

  // Joue m en tenant le hash a jour ; renvoie le record d'undo.
  function makeMove(s, m) {
    var p = s.toMove;
    hA ^= TA[s.truce + 1] ^ SIDE_A; hB ^= TB[s.truce + 1] ^ SIDE_B;
    if (m !== PASS) {
      var prev = s.board[m];
      hA ^= ZA[m * 3 + prev] ^ ZA[m * 3 + p];
      hB ^= ZB[m * 3 + prev] ^ ZB[m * 3 + p];
    }
    var rec = G.play(s, m);
    hA ^= TA[s.truce + 1]; hB ^= TB[s.truce + 1];
    return rec;
  }
  function unmakeMove(s, m, rec) {
    hA ^= TA[s.truce + 1]; hB ^= TB[s.truce + 1];
    G.undo(s, m, rec);
    var p = s.toMove;
    if (m !== PASS) {
      var prev = s.board[m];
      hA ^= ZA[m * 3 + prev] ^ ZA[m * 3 + p];
      hB ^= ZB[m * 3 + prev] ^ ZB[m * 3 + p];
    }
    hA ^= TA[s.truce + 1] ^ SIDE_A; hB ^= TB[s.truce + 1] ^ SIDE_B;
  }

  // Note de tri d'un coup (plus grand = explore d'abord).
  function orderScore(s, m, ttm, ply) {
    if (m === ttm) return 1e9;
    if (m === PASS) return 0;
    var p = s.toMove, op = 3 - p, b = s.board;
    var sc = history[p][m];
    var ws = WIN_BY_CELL[m];
    var capture = b[m] === op;
    for (var k = 0; k < ws.length; k++) {
      var w = WINDOWS[ws[k]], cp = 0, co = capture ? 1 : 0;
      for (var j = 0; j < 4; j++) {
        var c = w[j];
        if (c === m) continue;
        if (b[c] === p) cp++; else if (b[c] === op) co++;
      }
      if (cp === 3) return 5e8;                 // gagne
      if (co >= 3) sc += 1e7;                   // bloque / casse une menace
      else if (cp === 2 && co === 0) sc += 2e4;
    }
    if (killers[ply * 2] === m || killers[ply * 2 + 1] === m) sc += 1e6;
    if (IS_HOUSE[m]) sc += 300;
    if (capture) sc += 200;
    sc += ws.length * 20;
    return sc;
  }

  function orderMoves(s, moves, scores, n, ttm, ply) {
    for (var i = 0; i < n; i++) scores[i] = orderScore(s, moves[i], ttm, ply);
    // tri par insertion (n <= 26)
    for (i = 1; i < n; i++) {
      var mv = moves[i], sv = scores[i], j = i - 1;
      while (j >= 0 && scores[j] < sv) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
      moves[j + 1] = mv; scores[j + 1] = sv;
    }
  }

  function negamax(s, depth, alpha, beta, ply) {
    if ((++nodes & 1023) === 0 && now() > deadline) throw ABORT;
    if (s.winner) return s.winner === DRAW ? 0 : -(WIN - ply);   // le coup precedent a gagne
    if (depth <= 0 || ply >= MAX_PLY) return evaluate(s);

    var alpha0 = alpha;
    var slot = hA & TT_MASK, ttm = -1;
    if (ttA[slot] === hA && ttB[slot] === hB && ttFlag[slot]) {
      ttm = ttMove[slot];
      if (ttDepth[slot] >= depth) {
        var ts = ttScore[slot];
        if (ts > MATE_BOUND) ts -= ply; else if (ts < -MATE_BOUND) ts += ply;
        var f = ttFlag[slot];
        if (f === EXACT) return ts;
        if (f === LOWER && ts >= beta) return ts;
        if (f === UPPER && ts <= alpha) return ts;
      }
    }

    var moves = moveBufs[ply], scores = scoreBufs[ply];
    var n = G.genMoves(s, moves);
    orderMoves(s, moves, scores, n, ttm, ply);

    var best = -Infinity, bestMove = moves[0];
    for (var i = 0; i < n; i++) {
      var m = moves[i];
      var rec = makeMove(s, m);
      var sc;
      if (i === 0) {
        sc = -negamax(s, depth - 1, -beta, -alpha, ply + 1);
      } else {                                             // PVS : fenetre nulle puis re-recherche
        sc = -negamax(s, depth - 1, -alpha - 1, -alpha, ply + 1);
        if (sc > alpha && sc < beta) sc = -negamax(s, depth - 1, -beta, -alpha, ply + 1);
      }
      unmakeMove(s, m, rec);
      if (sc > best) { best = sc; bestMove = m; }
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) {
        if (m !== PASS && s.board[m] === 0 && killers[ply * 2] !== m) {
          killers[ply * 2 + 1] = killers[ply * 2];
          killers[ply * 2] = m;
        }
        history[s.toMove][m] += depth * depth;
        break;
      }
    }

    var store = best;
    if (store > MATE_BOUND) store += ply; else if (store < -MATE_BOUND) store -= ply;
    ttA[slot] = hA; ttB[slot] = hB;
    ttDepth[slot] = depth;
    ttScore[slot] = store;
    ttMove[slot] = bestMove;
    ttFlag[slot] = best <= alpha0 ? UPPER : (best >= beta ? LOWER : EXACT);
    return best;
  }

  function chooseMinimax(state, cfg) {
    var t0 = now();
    var maxDepth = Math.min((cfg && cfg.depth) || 4, MAX_PLY - 2);
    var budget = (cfg && cfg.time) || 1000;
    deadline = t0 + budget;
    nodes = 0;
    ttFlag.fill(0);
    killers.fill(-1);
    history[1].fill(0); history[2].fill(0);

    var s = G.clone(state);
    var h = hashOf(s); hA = h[0]; hB = h[1];

    var rootMoves = shuffle(G.legalMoves(s));        // melange : varie les coups a egalite
    if (rootMoves.length === 1) {
      return { move: rootMoves[0], info: { depth: 0, nodes: 0, forced: true, ms: 0 } };
    }
    var bestMove = rootMoves[0], bestScore = 0, reached = 0;
    var scores = new Float64Array(rootMoves.length);

    for (var depth = 1; depth <= maxDepth; depth++) {
      // coup precedent en tete, puis tri heuristique
      for (var i = 0; i < rootMoves.length; i++) scores[i] = rootMoves[i] === bestMove ? 1e12 : orderScore(s, rootMoves[i], -1, 0);
      var idx = rootMoves.map(function (m, j) { return j; }).sort(function (a, b) { return scores[b] - scores[a]; });
      rootMoves = idx.map(function (j) { return rootMoves[j]; });

      var alpha = -Infinity, iterBest = rootMoves[0], iterScore = -Infinity, done = 0;
      try {
        for (i = 0; i < rootMoves.length; i++) {
          var m = rootMoves[i];
          var rec = makeMove(s, m);
          var sc;
          if (i === 0) sc = -negamax(s, depth - 1, -Infinity, Infinity, 1);
          else {
            sc = -negamax(s, depth - 1, -alpha - 1, -alpha, 1);
            if (sc > alpha) sc = -negamax(s, depth - 1, -Infinity, -alpha, 1);
          }
          unmakeMove(s, m, rec);
          done++;
          if (sc > iterScore) { iterScore = sc; iterBest = m; }
          if (sc > alpha) alpha = sc;
        }
      } catch (e) {
        if (e !== ABORT) throw e;
        // Recherche interrompue (`s` est laisse en plein milieu : on ne s'en sert
        // plus). Le 1er coup explore est l'ancien meilleur ; si au moins lui a
        // ete evalue a cette profondeur, le meilleur de l'iteration est fiable.
        if (done > 0) { bestMove = iterBest; bestScore = iterScore; }
        break;
      }
      bestMove = iterBest; bestScore = iterScore; reached = depth;
      if (Math.abs(bestScore) > MATE_BOUND) break;     // issue forcee trouvee
      if (now() > deadline) break;
    }

    return {
      move: bestMove,
      info: { depth: reached, nodes: nodes, score: bestScore, mate: Math.abs(bestScore) > MATE_BOUND, ms: Math.round(now() - t0) },
    };
  }

  /* --------------------------------------------------------------- MCTS */
  var ROLLOUT_CAP = 160;
  var UCT_C = 1.2;

  function copyInto(dst, src) {
    dst.board.set(src.board);
    dst.count[1] = src.count[1]; dst.count[2] = src.count[2];
    dst.hmask[1] = src.hmask[1]; dst.hmask[2] = src.hmask[2];
    dst.toMove = src.toMove; dst.truce = src.truce; dst.ply = src.ply;
    dst.winner = src.winner; dst.winLine = null; dst.lastMove = src.lastMove;
  }

  var rollBuf = new Int8Array(N + 1);
  var rollW = new Float64Array(N + 1);

  function rolloutPure(s) {
    for (var t = 0; !s.winner && t < ROLLOUT_CAP; t++) {
      var n = G.genMoves(s, rollBuf);
      G.play(s, rollBuf[Math.floor(rand() * n)]);
    }
    return s.winner || DRAW;
  }

  // Politique guidee : gagne si possible, bloque une menace sur case vide,
  // sinon tirage pondere (Maisons x3, captures x2).
  function heavyMove(s) {
    var p = s.toMove, op = 3 - p, b = s.board;
    if (s.count[p] >= PIECES) return PASS;
    var n = G.genMoves(s, rollBuf);
    if (s.ply > 0) {
      var block = -1;
      for (var wi = 0; wi < NW; wi++) {
        var w = WINDOWS[wi], cp = 0, co = 0, gap = -1;
        for (var k = 0; k < 4; k++) {
          var v = b[w[k]];
          if (v === p) cp++; else if (v === op) co++; else gap = w[k];
        }
        if (cp === 3 && co === 0 && gap >= 0) return gap;                       // gagne (case vide)
        if (cp === 3 && co === 1) {                                             // gagne par capture ?
          for (k = 0; k < 4; k++) if (b[w[k]] === op && G.canCapture(s, p, w[k])) return w[k];
        }
        if (co === 3 && cp === 0 && gap >= 0 && block < 0) block = gap;
      }
      if (block >= 0) return block;
    }
    var tot = 0;
    for (var i = 0; i < n; i++) {
      var m = rollBuf[i];
      var wgt = IS_HOUSE[m] ? 3 : (b[m] ? 2 : 1);
      rollW[i] = wgt; tot += wgt;
    }
    var r = rand() * tot;
    for (i = 0; i < n; i++) { r -= rollW[i]; if (r <= 0) return rollBuf[i]; }
    return rollBuf[n - 1];
  }

  function rolloutHeavy(s) {
    for (var t = 0; !s.winner && t < ROLLOUT_CAP; t++) G.play(s, heavyMove(s));
    return s.winner || DRAW;
  }

  function newNode(move, parent, s) {
    return {
      move: move, parent: parent, children: [],
      untried: s.winner ? [] : shuffle(G.legalMoves(s)),
      n: 0, w: 0,
      player: 3 - s.toMove,             // joueur qui a joue `move`
    };
  }

  function chooseMcts(state, cfg, heavy) {
    var t0 = now();
    var budget = (cfg && cfg.time) || 1000;
    var maxIter = (cfg && cfg.iterations) || Infinity;
    var rootState = G.clone(state);
    var rootMoves = G.legalMoves(rootState);
    if (rootMoves.length === 1) return { move: rootMoves[0], info: { iterations: 0, forced: true, ms: 0 } };

    var root = newNode(-1, null, rootState);
    var s = G.clone(rootState);
    var rollout = heavy ? rolloutHeavy : rolloutPure;
    var iter = 0, end = t0 + budget;

    while (iter < maxIter && ((iter & 63) !== 0 || now() < end)) {
      iter++;
      copyInto(s, rootState);
      var node = root;
      // 1. selection
      while (node.untried.length === 0 && node.children.length) {
        var best = null, bestV = -Infinity, lnN = Math.log(node.n);
        for (var i = 0; i < node.children.length; i++) {
          var ch = node.children[i];
          var v = ch.w / ch.n + UCT_C * Math.sqrt(lnN / ch.n);
          if (v > bestV) { bestV = v; best = ch; }
        }
        node = best;
        G.play(s, node.move);
      }
      // 2. expansion
      if (node.untried.length && !s.winner) {
        var m = node.untried.pop();
        G.play(s, m);
        var child = newNode(m, node, s);
        node.children.push(child);
        node = child;
      }
      // 3. simulation
      var result = s.winner || rollout(s);
      // 4. retropropagation
      while (node) {
        node.n++;
        if (result === node.player) node.w += 1;
        else if (result === DRAW) node.w += 0.5;
        node = node.parent;
      }
    }

    var bestChild = null;
    root.children.forEach(function (c) { if (!bestChild || c.n > bestChild.n) bestChild = c; });
    return {
      move: bestChild ? bestChild.move : rootMoves[0],
      info: {
        iterations: iter,
        winRate: bestChild ? bestChild.w / bestChild.n : 0.5,
        ms: Math.round(now() - t0),
      },
    };
  }

  /* ------------------------------------------------- Chances de victoire */
  // Probabilite que Clair gagne (nulle = 1/2), pour la barre de l'interface.
  // Un minimax court detecte les issues forcees ; sinon on prend le taux de
  // victoire du meilleur coup selon un MCTS tactique (simulations guidees).
  function estimate(state, cfg) {
    var s = state.board instanceof Int8Array ? state : G.fromJSON(state);
    if (s.winner) return { light: s.winner === 1 ? 1 : s.winner === 2 ? 0 : 0.5 };
    var budget = (cfg && cfg.time) || 500;
    var moves = G.legalMoves(s);
    if (moves.length === 1) {                     // coup force (passe) : on regarde apres
      var c = G.clone(s);
      G.play(c, moves[0]);
      return estimate(c, cfg);
    }
    var mm = chooseMinimax(s, { depth: 4, time: Math.round(budget * 0.25) });
    var pMover;
    if (mm.info.mate) pMover = mm.info.score > 0 ? 1 : 0;
    else pMover = chooseMcts(s, { time: Math.round(budget * 0.75) }, true).info.winRate;
    return { light: s.toMove === 1 ? pMover : 1 - pMover };
  }

  /* ----------------------------------------------------------- Aiguillage */
  function choose(state, aiId, cfg) {
    var s = state.board instanceof Int8Array ? state : G.fromJSON(state);
    if (s.winner) return { move: -1, info: {} };
    var res;
    switch (aiId) {
      case 'random': res = chooseRandom(G.clone(s)); break;
      case 'greedy': res = chooseGreedy(G.clone(s), cfg); break;
      case 'minimax': res = chooseMinimax(s, cfg); break;
      case 'mcts': res = chooseMcts(s, cfg, false); break;
      case 'mcts-heavy': res = chooseMcts(s, cfg, true); break;
      default: throw new Error('IA inconnue : ' + aiId);
    }
    res.info.ai = aiId;
    return res;
  }

  var API = {
    choose: choose,
    estimate: estimate,
    evaluate: evaluate,
    winningMoves: winningMoves,
    setRandom: setRandom,
    WIN: WIN, WIN_SOON: WIN_SOON, MATE_BOUND: MATE_BOUND,
  };

  root.HeraldisAI = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
