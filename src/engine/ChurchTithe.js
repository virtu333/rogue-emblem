// ChurchTithe.js — the Tithe Box (`tithe_box`, an earned blessing: docs/specs/blessings-v3.md §6.1).
// Pure: no Phaser, no randomness.
//
// While the run holds it, a church pays its gold the first time the party enters it
// (`ChurchController.handleChurch` calls `payChurchTithe`): once a node, whatever the visits,
// reloads or the vow made there. Never the Ruins' sanctuary (it is not a church) and never the
// prologue (no earned blessing reaches it). `run.churchTitheByNodeId` records the churches that
// paid, saved with the run and reset with each act's map (RunManager.advanceAct), like the vows.
// The church where the box is taken (the Old Sanctum's vow) pays at once: the box is in hand
// and the party is inside (decision in PR D1).

import { NODE_TYPES } from '../utils/constants.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { churchEntryGoldOf } from './EarnedBoons.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A saved tithe record: `{ [nodeId]: true }` for each church that paid; anything else dropped. */
export function sanitizeChurchTithes(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [nodeId, paid] of Object.entries(raw)) if (nodeId && paid === true) out[nodeId] = true;
  return out;
}

/**
 * Pay the Tithe Box's gold for entering this church, once a node. Returns
 * `{ paid: number, message }` (paid 0 and no message when nothing is owed: no box, a paid node,
 * a node that is no church, the prologue).
 */
export function payChurchTithe(run, nodeId) {
  const none = { paid: 0, message: '' };
  if (!run || !nodeId || isPrologueRun(run)) return none;
  const gold = churchEntryGoldOf(run);
  if (gold <= 0) return none;
  const node = run.nodeMap?.nodes?.find((n) => n?.id === nodeId);
  if (node?.type !== NODE_TYPES.CHURCH) return none;
  if (!isPlainObject(run.churchTitheByNodeId)) run.churchTitheByNodeId = {};
  if (run.churchTitheByNodeId[nodeId] === true) return none;
  run.churchTitheByNodeId[nodeId] = true;
  run.addGold(gold);
  return { paid: gold, message: `Tithe Box: the priests add ${gold} G.` };
}
