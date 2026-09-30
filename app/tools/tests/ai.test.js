/* Tests des IA (ai.js).  node --test tools/tests/*.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../../game.js');
const AI = require('../../ai.js');

const idx = (label) => 'ABCDE'.indexOf(label[0]) + 5 * (Number(label.slice(1)) - 1);
function position({ L = [], D = [], toMove = 1, truce = -1, ply = 10 }) {
  const board = new Array(25).fill(0);
  L.forEach((c) => { board[idx(c)] = 1; });
  D.forEach((c) => { board[idx(c)] = 2; });
  return G.fromJSON({ board, toMove, truce, ply, winner: 0, lastMove: -1 });
}

const FAST = {
  random: null,
  greedy: { noise: 0 },
  minimax: { depth: 4, time: 300 },
  mcts: { time: 300 },
  'mcts-heavy': { time: 300 },
};

test('chaque IA renvoie un coup legal, y compris au Premier Serment', () => {
  Object.keys(FAST).forEach((id) => {
    const s = G.newGame();
    for (let k = 0; k < 6 && !s.winner; k++) {
      const { move } = AI.choose(s, id, FAST[id]);
      assert.ok(G.isLegal(s, move), id + ' coup ' + move);
      G.play(s, move);
    }
  });
});

test('l\'etat passe a choose() n\'est pas modifie', () => {
  const s = position({ L: ['A1', 'B2'], D: ['C1', 'E5'], toMove: 1 });
  const before = JSON.stringify(G.toJSON(s));
  ['greedy', 'minimax', 'mcts', 'mcts-heavy'].forEach((id) => AI.choose(s, id, FAST[id]));
  assert.strictEqual(JSON.stringify(G.toJSON(s)), before);
});

test('les IA (hors aleatoire) saisissent une victoire immediate', () => {
  const s = position({ L: ['A1', 'B1', 'C1'], D: ['A5', 'B5', 'E5'], toMove: 1 });
  ['greedy', 'minimax', 'mcts', 'mcts-heavy'].forEach((id) => {
    assert.strictEqual(AI.choose(s, id, FAST[id]).move, idx('D1'), id);
  });
});

test('les IA bloquent une menace adverse unique', () => {
  // Fonce menace D1 (A1 B1 C1 = Maisons/Alliance, D1 vide). Clair n'a rien.
  const s = position({ L: ['A5', 'E5'], D: ['A1', 'B1', 'C1'], toMove: 1 });
  ['greedy', 'minimax', 'mcts-heavy'].forEach((id) => {
    assert.strictEqual(AI.choose(s, id, FAST[id]).move, idx('D1'), id);
  });
});

test('la Treve est respectee par l\'IA', () => {
  // Clair gagnerait en capturant D2, mais D2 vient de lui etre prise.
  const s = position({ L: ['A2', 'B2', 'C2', 'D1', 'C5'], D: ['D2'], toMove: 1, truce: idx('D2') });
  ['greedy', 'minimax', 'mcts', 'mcts-heavy'].forEach((id) => {
    assert.notStrictEqual(AI.choose(s, id, FAST[id]).move, idx('D2'), id);
  });
});

test('minimax detecte un gain force', () => {
  const s = position({ L: ['A1', 'B1', 'C1'], D: ['A5', 'B5', 'E5'], toMove: 1 });
  const r = AI.choose(s, 'minimax', { depth: 6, time: 500 });
  assert.ok(r.info.mate);
  assert.ok(r.info.score > AI.MATE_BOUND);
});

function playMatch(a, b, n) {
  // a joue Clair sur la moitie des parties, Fonce sur l'autre.
  let wa = 0, wb = 0, d = 0;
  for (let g = 0; g < n; g++) {
    const s = G.newGame();
    const light = g % 2 === 0 ? a : b;
    const dark = g % 2 === 0 ? b : a;
    while (!s.winner && s.ply < 300) {
      const who = s.toMove === 1 ? light : dark;
      G.play(s, AI.choose(s, who.id, who.cfg).move);
    }
    const w = s.winner === 1 ? light : s.winner === 2 ? dark : null;
    if (w === a) wa++; else if (w === b) wb++; else d++;
  }
  return { wa, wb, d };
}

test('minimax bat nettement l\'aleatoire', () => {
  const r = playMatch({ id: 'minimax', cfg: { depth: 2, time: 100 } }, { id: 'random' }, 10);
  assert.ok(r.wa >= 9, JSON.stringify(r));
});

test('MCTS bat nettement l\'aleatoire', () => {
  const r = playMatch({ id: 'mcts', cfg: { time: 60 } }, { id: 'random' }, 10);
  assert.ok(r.wa >= 8, JSON.stringify(r));
});

test('estimation des chances : bornee, et certaine sur un gain force', () => {
  const debut = AI.estimate(G.newGame(), { time: 200 }).light;
  assert.ok(debut >= 0 && debut <= 1, String(debut));
  // Clair au trait gagne en D1 : 100 % pour Clair
  const s = position({ L: ['A1', 'B1', 'C1'], D: ['A5', 'B5', 'E5'], toMove: 1 });
  assert.strictEqual(AI.estimate(s, { time: 200 }).light, 1);
  // meme position, Fonce au trait mais incapable de parer (pas de capture possible) : Clair gagne quand meme
  const t = position({ L: ['A1', 'B1', 'C1', 'A3', 'B3', 'C3'], D: ['A5', 'B5'], toMove: 2 });
  assert.ok(AI.estimate(t, { time: 300 }).light > 0.9);
  // partie finie
  const f = position({ L: ['A1', 'B1', 'C1'], toMove: 1 });
  G.play(f, idx('D1'));
  assert.strictEqual(AI.estimate(f).light, 1);
});
