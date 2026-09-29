/* Tests des regles (game.js).  node --test tools/tests/*.test.js */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const G = require('../../game.js');

const idx = (label) => 'ABCDE'.indexOf(label[0]) + 5 * (Number(label.slice(1)) - 1);

// Construit une position a la main : { L: ['A1',...], D: [...] }, puis trait / treve.
function position({ L = [], D = [], toMove = 1, truce = -1, ply = 10 }) {
  const board = new Array(25).fill(0);
  L.forEach((c) => { board[idx(c)] = 1; });
  D.forEach((c) => { board[idx(c)] = 2; });
  return G.fromJSON({ board, toMove, truce: truce === -1 ? -1 : idx(truce), ply, winner: 0, lastMove: -1 });
}

test('plateau : 10 Maisons (2 par symbole), 15 Alliances, symetrie 180°', () => {
  const houses = G.CELLS.filter((c) => c.house);
  assert.strictEqual(houses.length, 10);
  assert.strictEqual(G.ALLIANCES.length, 15);
  for (let s = 0; s < 5; s++) assert.strictEqual(houses.filter((c) => c.syms[0] === s).length, 2);
  G.CELLS.forEach((c) => {
    assert.strictEqual(G.MASK[c.i], G.MASK[24 - c.i], 'symetrie ' + c.label);
    if (!c.house) assert.notStrictEqual(c.syms[0], c.syms[1]);
  });
  // Ours+Sanglier en B3 et D3
  assert.deepStrictEqual(G.cellName(idx('B3')), 'Ours + Sanglier');
  assert.deepStrictEqual(G.cellName(idx('D3')), 'Sanglier + Ours');
});

test('28 fenetres d\'alignement de 4', () => {
  assert.strictEqual(G.WINDOWS.length, 28);
});

test('Premier Serment : Clair doit ouvrir sur une Alliance', () => {
  const s = G.newGame();
  const moves = G.legalMoves(s);
  assert.strictEqual(moves.length, 15);
  moves.forEach((m) => assert.ok(!G.IS_HOUSE[m]));
  G.play(s, idx('B3'));
  // Fonce : tour normal, Maisons comprises
  assert.strictEqual(G.legalMoves(s).length, 24);
  G.play(s, idx('A1'));
  // Clair 2e tour : aucune restriction
  assert.ok(G.legalMoves(s).includes(idx('C1')));
});

test('immunite : une Maison adverse ne peut jamais etre capturee', () => {
  const s = position({ L: ['C1', 'D1', 'A2'], D: ['A1', 'E3'], toMove: 1 });
  assert.ok(!G.legalMoves(s).includes(idx('A1')));
  assert.ok(!G.legalMoves(s).includes(idx('E3')));
});

test('prerequis d\'Alliance : les deux symboles sont requis, peu importe la case', () => {
  // D2 = Aigle+Ours. Clair possede Aigle (D1) mais pas Ours.
  let s = position({ L: ['D1'], D: ['D2'], toMove: 1 });
  assert.ok(!G.legalMoves(s).includes(idx('D2')));
  // + une Maison Ours (C5, a l'autre bout du plateau) -> capture possible
  s = position({ L: ['D1', 'C5'], D: ['D2'], toMove: 1 });
  assert.ok(G.legalMoves(s).includes(idx('D2')));
  // un pion Ours sur une Alliance ne compte pas
  s = position({ L: ['D1', 'B2'], D: ['D2'], toMove: 1 });
  assert.ok(!G.legalMoves(s).includes(idx('D2')));
});

test('capture : le pion retourne dans la reserve de son proprietaire', () => {
  const s = position({ L: ['D1', 'C5'], D: ['D2', 'A1'], toMove: 1 });
  assert.strictEqual(G.reserve(s, 2), 11);
  G.play(s, idx('D2'));
  assert.strictEqual(s.board[idx('D2')], 1);
  assert.strictEqual(G.reserve(s, 2), 12);
  assert.strictEqual(G.reserve(s, 1), 10);
});

test('Treve : pas de reprise immediate, mais possible plus tard', () => {
  // Fonce possede Aigle (B5) + Ours (C1) ; Clair possede Aigle (D1) + Ours (C5).
  const s = position({ L: ['D1', 'C5'], D: ['D2', 'B5', 'C1'], toMove: 1 });
  G.play(s, idx('D2'));                       // Clair capture D2
  assert.strictEqual(s.truce, idx('D2'));
  assert.ok(!G.legalMoves(s).includes(idx('D2')), 'reprise immediate interdite');
  G.play(s, idx('E3'));                       // Fonce joue ailleurs
  G.play(s, idx('A3'));                       // Clair joue ailleurs
  assert.ok(G.legalMoves(s).includes(idx('D2')), 'reprise ulterieure permise');
});

test('reserve vide : le joueur passe automatiquement', () => {
  const L = ['A1', 'B1', 'D1', 'E1', 'A2', 'B2', 'D2', 'E2', 'A4', 'B4', 'D4', 'E4', 'C3'];
  const s = position({ L, D: ['C1'], toMove: 1 });
  assert.strictEqual(G.reserve(s, 1), 0);
  assert.deepStrictEqual(G.legalMoves(s), [G.PASS]);
  const rec = G.play(s, G.PASS);
  assert.strictEqual(s.toMove, 2);
  assert.strictEqual(s.truce, -1);
  G.undo(s, G.PASS, rec);
  assert.strictEqual(s.toMove, 1);
});

test('victoire : 4 alignes (ligne, colonne, diagonales)', () => {
  const cases = [['A1', 'B1', 'C1', 'D1'], ['E2', 'E3', 'E4', 'E5'], ['A1', 'B2', 'C3', 'D4'], ['E2', 'D3', 'C4', 'B5']];
  cases.forEach((line) => {
    const s = position({ L: line.slice(0, 3), toMove: 1 });
    G.play(s, idx(line[3]));
    assert.strictEqual(s.winner, 1, line.join(' '));
    assert.strictEqual(s.winLine.length, 4);
  });
});

test('victoire par capture', () => {
  // Clair : A2 B2 C2 + Maisons Aigle (D1) et Sanglier (A3). Fonce en C2? non : D2 = Aigle+Ours.
  // Ligne A3..D3 : A3(S) B3(OS) C3(CS) D3(SO). Clair a A3,B3,C3 ; Fonce en D3 (Sanglier+Ours).
  const s = position({ L: ['A3', 'B3', 'C3', 'C1'], D: ['D3'], toMove: 1 });  // C1 = Ours
  G.play(s, idx('D3'));
  assert.strictEqual(s.winner, 1);
});

test('plateau plein sans alignement : nulle', () => {
  // Remplissage en damier par colonnes decalees, sans 4 alignes.
  const pattern = [
    1, 1, 2, 2, 1,
    2, 2, 1, 1, 2,
    1, 1, 2, 2, 1,
    2, 2, 1, 1, 2,
    1, 1, 2, 2, 0,
  ];
  const s = G.fromJSON({ board: pattern, toMove: 2, truce: -1, ply: 30, winner: 0, lastMove: -1 });
  assert.strictEqual(s.count[1], 12);
  G.play(s, 24);
  assert.strictEqual(s.winner, G.DRAW);
});

test('play/undo restaure exactement l\'etat', () => {
  const s = G.newGame();
  let rnd = 7;
  const r = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let g = 0; g < 50; g++) {
    const st = G.newGame();
    const stack = [];
    while (!st.winner && st.ply < 120) {
      const moves = G.legalMoves(st);
      const m = moves[Math.floor(r() * moves.length)];
      const before = JSON.stringify(G.toJSON(st)) + st.count + st.hmask;
      stack.push([m, G.play(st, m), before]);
    }
    while (stack.length) {
      const [m, rec, before] = stack.pop();
      G.undo(st, m, rec);
      assert.strictEqual(JSON.stringify(G.toJSON(st)) + st.count + st.hmask, before);
    }
  }
  assert.ok(s);
});
