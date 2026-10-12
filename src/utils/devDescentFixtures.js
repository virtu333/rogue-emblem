// Review route for Act V, the Descent (docs/specs/act-v-descent.md): `?devScene=nodemap&
// preset=fresh&descent=1[&difficulty=hard][&rite=7][&descentRow=4][&seed=42]`. This switches the
// Descent on (data/descent.json `enabled`, whatever it says) for THIS PAGE'S game data only,
// reachable through devStartup's dev routes (the dev server and deploy previews, never the
// production site). A real run never reads this file, and `data/descent.json` is never changed.
//
//   descent=1       the run enters Act V (its authored route, the Rite at its Eclipse start)
//   rite=N          the Rite stands at N words
//   descentRow=N    the party has walked rows 0..N-1 (the shortest road), so row N is next
//   difficulty=hard the Entity's road (the Lieutenant's gate, then the Entity); normal/dusk: the
//                   Lieutenant's (First Light / Dusk)

import { createRite } from '../engine/Rite.js';

/** This page's game data with the Descent switched on (a copy; the loaded data is untouched). */
export function withDevDescent(gameData) {
  if (!gameData?.descent) return gameData;
  return { ...gameData, descent: { ...gameData.descent, enabled: true } };
}

/**
 * Take a freshly started run into Act V and set the review's Rite and progress.
 * @param {object} runManager
 * @param {{ riteWords?: number, descentRow?: number }} config
 */
export function applyDevDescent(runManager, config = {}) {
  while (
    runManager.currentAct !== 'finalBoss' &&
    runManager.actIndex < runManager.actSequence.length - 1
  )
    runManager.advanceAct();
  if (!runManager.rite) return;
  if (Number.isFinite(config.riteWords))
    runManager.rite = createRite({ start: Math.max(0, config.riteWords) });
  const rows = Number.isFinite(config.descentRow) ? config.descentRow : 0;
  if (rows <= 0) return;
  // Walk the first node of each row below `rows` that the road from the start reaches.
  const byId = new Map((runManager.nodeMap?.nodes || []).map((n) => [n.id, n]));
  let at = byId.get(runManager.nodeMap?.startNodeId);
  for (let guard = 0; at && guard < 20; guard++) {
    if (at.row >= rows) break;
    if (!at.completed) runManager.markNodeComplete(at.id);
    at = byId.get((at.edges || [])[0]);
  }
}
