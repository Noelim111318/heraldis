/* Heraldis — Worker de l'IA : calcule hors du fil principal pour que
 * l'interface reste fluide pendant la reflexion.
 *
 *   -> { id, state, ai, cfg }       (state = HeraldisGame.toJSON(...))
 *   <- { id, move, info }  ou  { id, error }
 *
 *   -> { id, state, kind: 'estimate', cfg }   chances de victoire
 *   <- { id, light }                         probabilite que Clair gagne
 */
/* global HeraldisAI */
importScripts('./data.js', './game.js', './ai.js');

self.onmessage = function (e) {
  var req = e.data || {};
  try {
    if (req.kind === 'estimate') {
      self.postMessage({ id: req.id, light: HeraldisAI.estimate(req.state, req.cfg).light });
      return;
    }
    var res = HeraldisAI.choose(req.state, req.ai, req.cfg);
    self.postMessage({ id: req.id, move: res.move, info: res.info });
  } catch (err) {
    self.postMessage({ id: req.id, error: String(err && err.message || err) });
  }
};
