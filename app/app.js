/* Heraldis — logique de l'app (ecrans, partie, IA).
 *
 * La coque PWA (service worker, bandeau installer, helpers) est fournie par
 * AppEngine (engine/engine.js). Les regles sont dans game.js, les IA dans
 * ai.js (executees dans ai-worker.js quand c'est possible).
 */
(function () {
  'use strict';

  var APP_VERSION = 'v1.0.0';
  var E = window.AppEngine;
  var D = window.HERALDIS_DATA;
  var G = window.HeraldisGame;
  var PASS = G.PASS;

  E.boot({
    id: 'heraldis',
    version: APP_VERSION,
    streakBadgeSel: false,
    backButton: true,          // bouton retour Android -> accueil
    updateWhen: true,          // maj du SW seulement depuis l'accueil, jamais en pleine partie
    install: { showOn: function () { return E.screens.current() === 'screen-home'; } },
  });

  var $ = E.$;
  // Element d'une famille d'identifiants : pid('name', 1) -> #name-1.
  function pid(key, p) { return document.getElementById(key + '-' + p); }
  var DEMO_MAX_PLY = 300;      // garde-fou IA contre IA (les regles n'ont pas de limite)
  var AI_MIN_DELAY = 450;      // l'IA ne repond jamais plus vite : on voit le tour passer
  var DEMO_DELAY = 750;

  /* ------------------------------------------------------------ Reglages */
  var prefs = Object.assign({
    mode: 'ai', ai: 'minimax', level: 'moyen', side: '1',
    demo1: 'minimax:moyen', demo2: 'mcts-heavy:moyen',
    hints: true, sound: true, haptic: true, coords: false,
  }, E.store.load('prefs', {}));
  function savePrefs() { E.store.save('prefs', prefs); }

  function aiById(id) {
    for (var i = 0; i < D.ais.length; i++) if (D.ais[i].id === id) return D.ais[i];
    return D.ais[0];
  }
  function levelName(id) {
    for (var i = 0; i < D.levels.length; i++) if (D.levels[i].id === id) return D.levels[i].name;
    return '';
  }
  function aiLabel(ai, level) {
    var a = aiById(ai);
    return a.name + (a.levels ? ' · ' + levelName(level) : '');
  }
  function aiCfg(ai, level) {
    var a = aiById(ai);
    return a.levels ? (a.levels[level] || a.levels.moyen) : null;
  }

  /* ------------------------------------------------------------ Plateau */
  // Construit les 25 cases (une seule fois). interactive=false : plateau des regles.
  function buildBoard(el, interactive) {
    el.textContent = '';
    var cells = [];
    G.CELLS.forEach(function (c) {
      var b = document.createElement(interactive ? 'button' : 'div');
      if (interactive) { b.type = 'button'; b.setAttribute('role', 'gridcell'); }
      b.className = 'cell ' + (c.house ? 'cell--house' : 'cell--alliance');
      b.dataset.i = c.i;
      var h1 = D.houses[c.syms[0]], h2 = D.houses[c.syms[c.syms.length - 1]];
      b.style.setProperty('--c1', h1.color);
      b.style.setProperty('--c2', h2.color);
      c.syms.forEach(function (k) {
        var s = document.createElement('span');
        s.className = 'sym';
        s.textContent = D.houses[k].icon;
        b.appendChild(s);
      });
      var co = document.createElement('span');
      co.className = 'coord';
      co.textContent = c.label;
      b.appendChild(co);
      el.appendChild(b);
      cells.push(b);
    });
    return cells;
  }

  var boardEl = $('#board');
  var cellEls = buildBoard(boardEl, true);
  buildBoard($('#rules-board'), false);

  // Houses possedees : 5 symboles par joueur.
  [1, 2].forEach(function (p) {
    var box = pid('houses', p);
    D.houses.forEach(function (h) {
      var s = document.createElement('span');
      s.textContent = h.icon;
      s.title = h.name;
      box.appendChild(s);
    });
  });

  /* ------------------------------------------------------------- Partie */
  var game = null;           // { mode, players:{1,2}, state, history:[], over, paused, counted }
  var turnTimer = null;
  var hintCell = -1;
  var shownPieces = new Int8Array(25).fill(-1);

  function makePlayers(mode) {
    var P = {};
    if (mode === 'duo') {
      P[1] = { type: 'human', name: 'Clair', sub: 'Joueur 1' };
      P[2] = { type: 'human', name: 'Foncé', sub: 'Joueur 2' };
    } else if (mode === 'demo') {
      [1, 2].forEach(function (p) {
        var parts = String(prefs['demo' + p]).split(':');
        P[p] = { type: 'ai', ai: parts[0], level: parts[1] || 'moyen', name: aiById(parts[0]).name, sub: G.playerName(p) + (aiById(parts[0]).levels ? ' · ' + levelName(parts[1] || 'moyen') : '') };
      });
    } else {
      var human = prefs.side === '0' ? (Math.random() < 0.5 ? 1 : 2) : Number(prefs.side);
      var ai = { type: 'ai', ai: prefs.ai, level: prefs.level, name: 'IA ' + aiById(prefs.ai).name, sub: aiById(prefs.ai).levels ? levelName(prefs.level) : '' };
      P[human] = { type: 'human', name: 'Vous', sub: G.playerName(human) };
      P[3 - human] = ai;
    }
    return P;
  }

  function newGame() {
    stopTurn();
    game = {
      mode: prefs.mode,
      players: makePlayers(prefs.mode),
      state: G.newGame(),
      history: [],
      over: false,
      paused: false,
      counted: false,
    };
    shownPieces.fill(-1);
    $('#log-list').textContent = '';
    $('#ai-info').textContent = '';
    saveGame();
    E.sound.resume();
    showPlay();
  }

  function saveGame() {
    if (!game || game.over) { E.store.remove('game'); return; }
    E.store.save('game', {
      mode: game.mode, players: game.players,
      state: G.toJSON(game.state),
      history: game.history.map(function (h) { return { state: h.state, move: h.move, text: h.text }; }),
    });
  }

  function loadSavedGame() {
    var g = E.store.load('game', null);
    if (!g || !g.state || !g.players) return null;
    try {
      return {
        mode: g.mode, players: g.players,
        state: G.fromJSON(g.state),
        history: g.history || [],
        over: false, paused: false, counted: false,
      };
    } catch (e) { return null; }
  }

  function resumeGame() {
    var g = loadSavedGame();
    if (!g) { refreshHome(); return; }
    stopTurn();
    game = g;
    shownPieces.fill(-1);
    rebuildLog();
    $('#ai-info').textContent = '';
    E.sound.resume();
    showPlay();
  }

  // Affiche l'ecran de jeu ; l'ecouteur screen:show (plus bas) lance le tour.
  // Une seule entree d'historique depuis l'accueil (bouton retour -> accueil).
  function showPlay() {
    E.screens.show('screen-play', { push: E.screens.current() !== 'screen-play' });
  }

  function current() { return game.players[game.state.toMove]; }
  function isHumanTurn() { return game && !game.over && current().type === 'human'; }

  function stopTurn() {
    clearTimeout(turnTimer);
    turnTimer = null;
    AIRunner.cancel();
  }

  function startTurn() {
    stopTurn();
    hintCell = -1;
    var s = game.state;
    if (s.winner) { endGame(); return; }
    if (game.mode === 'demo' && s.ply >= DEMO_MAX_PLY) { endGame(true); return; }
    render();
    var p = s.toMove, pl = current();
    var moves = G.legalMoves(s);

    if (moves.length === 1 && moves[0] === PASS) {             // §3 : passe automatique
      setStatus(G.playerName(p) + ' n\'a plus de pion en réserve : il passe.');
      turnTimer = setTimeout(function () { doMove(PASS); }, 1300);
      return;
    }
    if (pl.type === 'ai') {
      if (game.paused) { setStatus('Pause.'); return; }
      setStatus(pl.name + ' réfléchit', true);
      boardEl.classList.add('is-busy');
      var started = Date.now(), ply0 = s.ply;
      var minDelay = game.mode === 'demo' ? DEMO_DELAY : AI_MIN_DELAY;
      AIRunner.think(s, pl.ai, aiCfg(pl.ai, pl.level), function (res) {
        var wait = Math.max(0, minDelay - (Date.now() - started));
        turnTimer = setTimeout(function () {
          if (!game || game.over || game.state !== s || s.ply !== ply0) return;
          showAiInfo(pl, res.info);
          doMove(res.move);
        }, wait);
      });
      return;
    }
    // Humain
    var who = game.mode === 'duo' ? 'Au tour de ' + G.playerName(p) : 'À vous de jouer';
    if (s.ply === 0) who += ' — Premier Serment : ouvrez sur une Alliance.';
    else who += '.';
    setStatus(who);
  }

  function doMove(m) {
    var s = game.state;
    if (!G.isLegal(s, m)) return;
    var text = G.describe(s, m);
    var capture = m !== PASS && s.board[m] !== 0;
    game.history.push({ state: G.toJSON(s), move: m, text: text });
    G.play(s, m);
    addLog(text);
    E.announce(text);
    if (capture) { tone(330, 0.09, 'triangle'); tone(247, 0.12, 'triangle', 0.08); E.haptic([20, 40, 30]); }
    else if (m !== PASS) { tone(s.toMove === 2 ? 520 : 440, 0.08, 'sine'); E.haptic('tap'); }
    saveGame();
    startTurn();
  }

  function endGame(capped) {
    var s = game.state;
    game.over = true;
    stopTurn();
    render();
    E.store.remove('game');
    var title, sub = '';
    var w = capped ? G.DRAW : s.winner;
    var humanWon = w !== G.DRAW && game.players[w].type === 'human';
    if (w === G.DRAW) {
      title = 'Match nul';
      sub = capped ? 'Partie arrêtée après ' + DEMO_MAX_PLY + ' coups.' : 'Le plateau est plein, sans alignement.';
    } else if (game.mode === 'ai') {
      title = humanWon ? '🏆 Victoire !' : 'Défaite…';
      sub = humanWon ? 'Vous alignez quatre blasons.' : game.players[w].name + ' aligne quatre blasons.';
    } else {
      title = '🏆 Victoire de ' + (game.mode === 'demo' ? game.players[w].name + ' (' + G.playerName(w) + ')' : G.playerName(w));
      sub = 'Quatre blasons alignés en ' + Math.ceil(s.ply / 2) + ' tours.';
    }
    $('#result-title').textContent = title;
    $('#result-sub').textContent = sub;
    $('#result').hidden = false;
    setStatus(w === G.DRAW ? 'Partie nulle.' : 'Partie terminée.');
    [1, 2].forEach(function (p) { pid('player', p).classList.toggle('is-winner', w === p); });
    E.announce(title + '. ' + sub, true);

    if (game.mode === 'ai' && !humanWon && w !== G.DRAW) {
      E.sound.feedback(false); E.haptic('error');
    } else {
      E.sound.feedback(true); E.haptic('success');
      if (w !== G.DRAW) E.fx.burst(true, { colors: ['#E8B84A', '#F4EEDC', '#5FCB85', '#86AEEA'] });
    }
    if (!game.counted) { recordStats(w); game.counted = true; }
    renderActions();
  }

  /* --------------------------------------------------------- Clic humain */
  boardEl.addEventListener('click', function (e) {
    var cell = e.target.closest('.cell');
    if (!cell || !game) return;
    var i = Number(cell.dataset.i);
    if (!isHumanTurn()) return;
    var s = game.state;
    if (G.isLegal(s, i)) {
      E.sound.resume();
      doMove(i);
      return;
    }
    // Coup refuse : on explique pourquoi.
    var why = whyIllegal(s, i);
    setStatus(why);
    cell.classList.remove('shake');
    void cell.offsetWidth;
    cell.classList.add('shake');
    E.haptic('error');
    tone(180, 0.12, 'square', 0, 0.06);
  });

  function whyIllegal(s, i) {
    var p = s.toMove, v = s.board[i], c = G.CELLS[i];
    if (s.ply === 0 && c.house) return 'Premier Serment : le tout premier coup doit se jouer sur une Alliance.';
    if (v === p) return 'Cette case est déjà à vous.';
    if (v && c.house) return 'Maison Fondatrice : ce pion est immunisé, il ne peut jamais être capturé.';
    if (v && i === s.truce) return 'Trêve : vous ne pouvez pas reprendre immédiatement cette case.';
    if (v) {
      var missing = c.syms.filter(function (k) { return !(s.hmask[p] & (1 << k)); })
        .map(function (k) { return D.houses[k].icon + ' ' + D.houses[k].name; });
      return 'Pour capturer cette Alliance, il vous faut une Maison ' + missing.join(' et une Maison ') + '.';
    }
    return 'Coup impossible.';
  }

  /* --------------------------------------------------------------- Rendu */
  function setStatus(text, thinking) {
    var el = $('#status');
    el.textContent = '';
    var span = document.createElement('span');
    span.textContent = text;
    if (thinking) span.className = 'thinking';
    el.appendChild(span);
  }

  function render() {
    var s = game.state;
    var human = isHumanTurn();
    var legal = human ? G.legalMoves(s) : [];
    boardEl.classList.toggle('hints', !!prefs.hints && human);
    boardEl.classList.toggle('is-busy', !human && !game.over);
    var winSet = s.winLine || [];

    for (var i = 0; i < 25; i++) {
      var el = cellEls[i], v = s.board[i], c = G.CELLS[i];
      // pion : recree seulement s'il change (pour l'animation de pose)
      if (shownPieces[i] !== v) {
        var old = el.querySelector('.piece');
        if (old) old.remove();
        if (v) {
          var pc = document.createElement('span');
          pc.className = 'piece piece--' + v;
          el.insertBefore(pc, el.firstChild);
        }
        shownPieces[i] = v;
      }
      var isLegal = legal.indexOf(i) !== -1;
      el.classList.toggle('has-piece', !!v);
      el.classList.toggle('is-playable', isLegal);
      el.classList.toggle('is-capturable', isLegal && !!v);
      el.classList.toggle('is-locked', human && s.ply === 0 && c.house);
      el.classList.toggle('is-last', s.lastMove === i && !s.winner);
      el.classList.toggle('is-win', winSet.indexOf(i) !== -1);
      el.classList.toggle('is-hint', hintCell === i);

      var truce = el.querySelector('.truce');
      var showTruce = s.truce === i && !s.winner;
      if (showTruce && !truce) {
        truce = document.createElement('span');
        truce.className = 'truce';
        truce.textContent = '🏳️';
        truce.title = 'Trêve';
        el.appendChild(truce);
      } else if (!showTruce && truce) truce.remove();

      var label = c.label + ', ' + (c.house ? 'Maison ' : 'Alliance ') + G.cellName(i) + ', ' +
        (v ? 'pion ' + G.playerName(v) : 'vide') +
        (isLegal && v ? ', capturable' : '') + (showTruce ? ', sous Trêve' : '');
      el.setAttribute('aria-label', label);
      el.setAttribute('aria-disabled', isLegal ? 'false' : 'true');
    }

    [1, 2].forEach(function (p) {
      var pl = game.players[p];
      pid('name', p).textContent = pl.name;
      pid('sub', p).textContent = pl.sub || '';
      var r = G.reserve(s, p);
      pid('reserve', p).textContent = r;
      pid('reserve', p).parentNode.classList.toggle('is-empty', r === 0);
      pid('player', p).classList.toggle('is-turn', !game.over && s.toMove === p);
      if (!game.over) pid('player', p).classList.remove('is-winner');
      var spans = pid('houses', p).children;
      for (var k = 0; k < spans.length; k++) spans[k].classList.toggle('on', !!(s.hmask[p] & (1 << k)));
    });

    if (!game.over) $('#result').hidden = true;
    renderActions();
  }

  function renderActions() {
    var demo = game.mode === 'demo';
    var undoable = !demo && !game.over && lastUndoIndex() >= 0;
    $('#undo-btn').hidden = demo;
    $('#undo-btn').disabled = !undoable;
    $('#hint-btn').hidden = demo;
    $('#hint-btn').disabled = !isHumanTurn();
    $('#pause-btn').hidden = !demo || game.over;
    $('#pause-btn').textContent = game.paused ? '▶ Reprendre' : '⏸ Pause';
    $('#actions').classList.toggle('is-over', game.over);
  }

  function showAiInfo(pl, info) {
    var el = $('#ai-info');
    if (!info) { el.textContent = ''; return; }
    var parts = [aiById(pl.ai).name];
    if (info.forced) parts.push('coup forcé');
    else if (info.depth != null) {
      parts.push('profondeur ' + info.depth);
      parts.push(fmtInt(info.nodes) + ' positions');
      if (info.mate) parts.push(info.score > 0 ? 'gain forcé trouvé' : 'se sait perdu');
    } else if (info.iterations != null) {
      parts.push(fmtInt(info.iterations) + ' simulations');
      parts.push('victoire estimée ' + Math.round(info.winRate * 100) + ' %');
    } else if (info.moves != null) {
      parts.push(info.moves + ' coups ' + (pl.ai === 'random' ? 'possibles' : 'évalués'));
    }
    if (info.ms != null && info.ms > 0) parts.push((info.ms / 1000).toFixed(1).replace('.', ',') + ' s');
    el.textContent = parts.join(' · ');
  }
  function fmtInt(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  function addLog(text) {
    var li = document.createElement('li');
    li.textContent = text;
    $('#log-list').appendChild(li);
  }
  function rebuildLog() {
    $('#log-list').textContent = '';
    game.history.forEach(function (h) { addLog(h.text); });
  }

  function tone(freq, dur, type, at, peak) {
    E.sound.tone(freq, at || 0, dur, type || 'sine', peak || 0.15);
  }

  /* ----------------------------------------------- Annuler / conseil / pause */
  // Index du coup a annuler : le dernier coup (non force) joue par un humain.
  function lastUndoIndex() {
    for (var i = game.history.length - 1; i >= 0; i--) {
      var h = game.history[i];
      if (game.players[h.state.toMove].type === 'human' && h.move !== PASS) return i;
    }
    return -1;
  }

  $('#undo-btn').addEventListener('click', function () {
    if (!game || game.over) return;
    var i = lastUndoIndex();
    if (i < 0) return;
    stopTurn();
    game.state = G.fromJSON(game.history[i].state);
    game.history.length = i;
    shownPieces.fill(-1);
    rebuildLog();
    $('#ai-info').textContent = '';
    saveGame();
    startTurn();
    setStatus('Coup annulé. ' + $('#status').textContent);
  });

  $('#hint-btn').addEventListener('click', function () {
    if (!isHumanTurn()) return;
    var s = game.state, ply0 = s.ply;
    setStatus('Recherche d\'un conseil', true);
    $('#hint-btn').disabled = true;
    AIRunner.think(s, D.hintAi.id, aiCfg(D.hintAi.id, D.hintAi.level), function (res) {
      if (!game || game.state !== s || s.ply !== ply0 || !isHumanTurn()) return;
      hintCell = res.move;
      render();
      setStatus(res.move === PASS ? 'Conseil : passer.'
        : 'Conseil : ' + (s.board[res.move] ? 'capturer ' : 'poser en ') + G.CELLS[res.move].label + ' (' + G.cellName(res.move) + ').');
    });
  });

  $('#pause-btn').addEventListener('click', function () {
    if (!game || game.mode !== 'demo' || game.over) return;
    game.paused = !game.paused;
    if (game.paused) { stopTurn(); setStatus('Pause.'); renderActions(); }
    else startTurn();
  });

  $('#quit-btn').addEventListener('click', goHome);
  $('#home-btn').addEventListener('click', goHome);
  $('#again-btn').addEventListener('click', function () {
    // Rejouer avec les memes reglages (en mode IA, le camp « au hasard » est retire).
    prefs.mode = game.mode;
    newGame();
  });

  // Les ecrans secondaires sont tous ouverts depuis l'accueil avec une entree
  // d'historique : revenir = history.back(), comme le bouton retour Android.
  function goHome() {
    stopTurn();
    if (game && !game.over) saveGame();
    if (E.screens.current() !== 'screen-home') E.screens.back();
  }

  E.on('screen:show', function (id) {
    if (id === 'screen-play') {
      // Arrivee sur le jeu (nouvelle partie, reprise, ou bouton « suivant »).
      if (!game) { E.screens.show('screen-home'); return; }
      if (game.over) render(); else startTurn();
      return;
    }
    // Quitter le jeu : on suspend l'IA ; la partie reste sauvegardee.
    clearTimeout(turnTimer);
    AIRunner.cancel();
    if (id === 'screen-home') refreshHome();
  });
  E.on('screen:back', function () { E.screens.show('screen-home'); });

  /* ------------------------------------------------------------- IA (Worker) */
  var AIRunner = (function () {
    var worker = null, broken = false, seq = 0, pending = null;

    function spawn() {
      if (worker || broken || typeof Worker === 'undefined') return worker;
      try {
        worker = new Worker('ai-worker.js');
        worker.onmessage = function (e) {
          var d = e.data || {};
          if (!pending || d.id !== pending.id) return;
          var p = pending; pending = null;
          if (d.error) { console.warn('IA :', d.error); runLocal(p); return; }
          p.cb({ move: d.move, info: d.info });
        };
        worker.onerror = function (e) {
          // Worker indisponible (file://, vieux navigateur...) : repli sur la page.
          if (e && e.preventDefault) e.preventDefault();
          broken = true;
          try { worker.terminate(); } catch (x) { /* ignore */ }
          worker = null;
          if (pending) { var p = pending; pending = null; runLocal(p); }
        };
      } catch (e) { broken = true; worker = null; }
      return worker;
    }

    function runLocal(p) {
      pending = p;
      setTimeout(function () {
        if (pending !== p) return;
        var res = window.HeraldisAI.choose(p.state, p.ai, p.cfg);
        if (pending !== p) return;
        pending = null;
        p.cb(res);
      }, 30);
    }

    return {
      think: function (state, ai, cfg, cb) {
        this.cancel();
        var p = { id: ++seq, state: G.toJSON(state), ai: ai, cfg: cfg, cb: cb };
        pending = p;
        var w = spawn();
        if (w) w.postMessage({ id: p.id, state: p.state, ai: ai, cfg: cfg });
        else runLocal(p);
      },
      // Abandonne le calcul en cours ; un worker occupe est remplace (arret immediat).
      cancel: function () {
        if (!pending) return;
        pending = null;
        if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } worker = null; }
      },
    };
  })();

  /* --------------------------------------------------------- Statistiques */
  function recordStats(w) {
    var st = E.store.load('stats', {});
    var key, rec;
    if (game.mode === 'ai') {
      var human = game.players[1].type === 'human' ? 1 : 2;
      var ai = game.players[3 - human];
      key = 'ai:' + ai.ai + (aiById(ai.ai).levels ? ':' + ai.level : '');
      rec = st[key] || { w: 0, l: 0, d: 0 };
      if (w === G.DRAW) rec.d++; else if (w === human) rec.w++; else rec.l++;
    } else if (game.mode === 'duo') {
      key = 'duo';
      rec = st[key] || { w: 0, l: 0, d: 0 };       // w = Clair, l = Fonce
      if (w === G.DRAW) rec.d++; else if (w === 1) rec.w++; else rec.l++;
    } else return;
    st[key] = rec;
    E.store.save('stats', st);
  }

  function renderStats() {
    var st = E.store.load('stats', {});
    var body = $('#stats-body');
    body.textContent = '';
    var keys = Object.keys(st);
    if (!keys.length) {
      var p = document.createElement('p');
      p.className = 'stats-empty';
      p.textContent = 'Aucune partie terminée pour l\'instant.';
      body.appendChild(p);
      return;
    }
    var aiKeys = [];
    D.ais.forEach(function (a) {
      (a.levels ? D.levels.map(function (l) { return 'ai:' + a.id + ':' + l.id; }) : ['ai:' + a.id])
        .forEach(function (k) { if (st[k]) aiKeys.push(k); });
    });
    if (aiKeys.length) {
      body.appendChild(table('Contre l\'ordinateur', ['Adversaire', 'Parties', 'V', 'D', 'N', '% V'], aiKeys.map(function (k) {
        var r = st[k], n = r.w + r.l + r.d, parts = k.split(':');
        return [aiLabel(parts[1], parts[2]), n, [r.w, 'w'], [r.l, 'l'], r.d, n ? Math.round(100 * r.w / n) + ' %' : '–'];
      })));
    }
    if (st.duo) {
      var r = st.duo;
      body.appendChild(table('À deux', ['', 'Parties', 'Clair', 'Foncé', 'Nulles'], [['Total', r.w + r.l + r.d, r.w, r.l, r.d]]));
    }
  }

  function table(caption, head, rows) {
    var t = document.createElement('table');
    t.className = 'stats-table';
    var cap = document.createElement('caption');
    cap.textContent = caption;
    cap.className = 'h-small';
    cap.style.textAlign = 'left';
    cap.style.color = 'var(--gold)';
    cap.style.padding = '12px 0 4px';
    t.appendChild(cap);
    var tr = document.createElement('tr');
    head.forEach(function (h) { var th = document.createElement('th'); th.textContent = h; tr.appendChild(th); });
    t.appendChild(tr);
    rows.forEach(function (row) {
      var r = document.createElement('tr');
      row.forEach(function (v) {
        var td = document.createElement('td');
        if (Array.isArray(v)) { td.textContent = v[0]; td.className = v[1]; } else td.textContent = v;
        r.appendChild(td);
      });
      t.appendChild(r);
    });
    return t;
  }

  /* ------------------------------------------------------------- Accueil */
  function buildHome() {
    var list = $('#ai-list');
    D.ais.forEach(function (a) {
      var lab = document.createElement('label');
      lab.className = 'ai-opt';
      var inp = document.createElement('input');
      inp.type = 'radio'; inp.name = 'ai'; inp.value = a.id;
      var span = document.createElement('span');
      var ic = document.createElement('span'); ic.className = 'ai-icon'; ic.textContent = a.icon;
      var nm = document.createElement('span'); nm.className = 'ai-name'; nm.textContent = a.name;
      var force = document.createElement('small'); force.textContent = '★★★★★'.slice(0, a.stars || 1); nm.appendChild(force);
      var ds = document.createElement('span'); ds.className = 'ai-desc'; ds.textContent = a.desc;
      span.appendChild(ic); span.appendChild(nm); span.appendChild(ds);
      lab.appendChild(inp); lab.appendChild(span);
      list.appendChild(lab);
    });
    var seg = $('#level-seg');
    D.levels.forEach(function (l) {
      var lab = document.createElement('label');
      var inp = document.createElement('input');
      inp.type = 'radio'; inp.name = 'level'; inp.value = l.id;
      var span = document.createElement('span'); span.textContent = l.name;
      lab.appendChild(inp); lab.appendChild(span);
      seg.appendChild(lab);
    });
    [1, 2].forEach(function (p) {
      var sel = pid('demo-ai', p);
      D.ais.forEach(function (a) {
        (a.levels ? D.levels : [null]).forEach(function (l) {
          var o = document.createElement('option');
          o.value = a.id + (l ? ':' + l.id : '');
          o.textContent = a.icon + ' ' + a.name + (l ? ' — ' + l.name : '');
          sel.appendChild(o);
        });
      });
      sel.value = prefs['demo' + p];
      if (!sel.value) sel.selectedIndex = 0;
      sel.addEventListener('change', function () { prefs['demo' + p] = sel.value; savePrefs(); });
    });

    setRadio('mode', prefs.mode);
    setRadio('ai', prefs.ai);
    setRadio('level', prefs.level);
    setRadio('side', prefs.side);
    ['mode', 'ai', 'level', 'side'].forEach(function (name) {
      document.querySelectorAll('input[name="' + name + '"]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          if (inp.checked) { prefs[name] = inp.value; savePrefs(); refreshHome(); }
        });
      });
    });

    bindToggle('set-hints', 'hints');
    // au demarrage, on ne cree l'AudioContext qu'au 1er geste (politique autoplay)
    bindToggle('set-sound', 'sound', function (v, init) { if (!init || !v) E.sound.enable(v); });
    bindToggle('set-haptic', 'haptic');
    bindToggle('set-coords', 'coords', function (v) { document.body.classList.toggle('show-coords', v); });
  }

  function setRadio(name, value) {
    var inp = document.querySelector('input[name="' + name + '"][value="' + value + '"]') ||
      document.querySelector('input[name="' + name + '"]');
    if (inp) inp.checked = true;
  }

  function bindToggle(id, key, apply) {
    var el = $('#' + id);
    el.checked = !!prefs[key];
    if (apply) apply(!!prefs[key], true);
    el.addEventListener('change', function () {
      prefs[key] = el.checked;
      savePrefs();
      if (apply) apply(el.checked, false);
    });
  }

  function refreshHome() {
    $('#opt-ai').hidden = prefs.mode !== 'ai';
    $('#opt-demo').hidden = prefs.mode !== 'demo';
    $('#opt-duo').hidden = prefs.mode !== 'duo';
    $('#level-field').hidden = !aiById(prefs.ai).levels;
    var saved = E.store.load('game', null);
    var btn = $('#resume-btn');
    btn.hidden = !saved;
    if (saved) {
      var modeTxt = saved.mode === 'duo' ? 'à deux' : saved.mode === 'demo' ? 'IA contre IA' : 'contre ' + ((saved.players[1].type === 'ai' ? saved.players[1] : saved.players[2]).name || 'l\'IA');
      btn.textContent = '▶ Reprendre la partie ' + modeTxt + ' (coup ' + ((saved.state && saved.state.ply) + 1) + ')';
    }
  }

  // Les vibrations se coupent en enveloppant E.haptic (le moteur n'a pas d'interrupteur).
  var rawHaptic = E.haptic;
  E.haptic = function (t) { if (prefs.haptic) rawHaptic(t); };

  /* --------------------------------------------------------------- Cablage */
  buildHome();
  refreshHome();

  $('#start-btn').addEventListener('click', function () {
    if (E.store.load('game', null) && !window.confirm('Abandonner la partie en cours et en commencer une nouvelle ?')) return;
    newGame();
  });
  $('#resume-btn').addEventListener('click', resumeGame);
  $('#rules-btn').addEventListener('click', function () { E.screens.show('screen-rules', { push: true }); });
  $('#stats-btn').addEventListener('click', function () { renderStats(); E.screens.show('screen-stats', { push: true }); });
  $('#rules-back-btn').addEventListener('click', goHome);
  $('#stats-back-btn').addEventListener('click', goHome);
  $('#stats-reset-btn').addEventListener('click', function () {
    if (!window.confirm('Effacer toutes les statistiques ?')) return;
    E.store.remove('stats');
    renderStats();
  });

  E.screens.show('screen-home');
})();
