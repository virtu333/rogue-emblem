// ChurchVow — each church asks for one vow (playtest 2026-09-28, Wave 4).
//
// Healing and reviving stay open at every church. Beyond them the player makes one
// vow per church: Promotion (as before: the church's promotions, within the
// difficulty's limit) or a Blessing (one minor, tier-1 blessing added to the run,
// chosen from a few the altar offers). The first promotion or the chosen blessing
// commits the vow; the other side then stays closed for this church. The vow is kept
// on the run (RunManager.churchVowByNodeId, saved), like the Ruins' one path, so
// leaving, re-entering or reloading never opens the other side. Pure: no Phaser, no
// DOM. The offer is hashed from the run seed and the node, never the battle RNG.

import { CHURCH_VOWS } from '../utils/constants.js';
import { isPrologueRun } from './ScriptedBattle.js';
import { PROLOGUE_BLESSING_BLOCK } from '../data/prologueContent.js';

export { CHURCH_VOWS };

/** How many blessings an altar offers (fewer once the run holds the rest). */
export const CHURCH_BLESSING_OFFERS = 3;

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The vow made at this church: 'promote', 'blessing', or null (none yet). */
export function churchVow(run, nodeId) {
  const vow = run?.churchVowByNodeId?.[nodeId];
  return CHURCH_VOWS.includes(vow) ? vow : null;
}

/** The line a church shows once its vow is made. */
export function churchVowLine(vow) {
  if (vow === 'promote') return 'Your vow here was Promotion: this altar gives no blessing.';
  if (vow === 'blessing') return 'Your vow here was a Blessing: this altar promotes no one.';
  return '';
}

/**
 * The minor blessings this altar offers: tier 1, none the run already holds, in an
 * order hashed from the run seed and the node (the same offer on every visit).
 */
export function churchBlessingOffers(run, nodeId, gameData) {
  const held = new Set(run?.getActiveBlessingIds?.() || []);
  const pool = (gameData?.blessings?.blessings || []).filter(
    (b) => b?.tier === 1 && !held.has(b.id),
  );
  const seed = `${Number(run?.runSeed) >>> 0}:${nodeId}`;
  return pool
    .map((b) => ({ b, key: hash(`${seed}:${b.id}`) }))
    .sort((x, y) => x.key - y.key || (x.b.id < y.b.id ? -1 : 1))
    .slice(0, CHURCH_BLESSING_OFFERS)
    .map(({ b }) => b);
}

/** Why a vow cannot be made (or used) here now: '' when it can. */
export function churchVowBlock(run, nodeId, vow) {
  if (!CHURCH_VOWS.includes(vow)) return 'Choose Promotion or a Blessing.';
  const made = churchVow(run, nodeId);
  if (made && made !== vow) return churchVowLine(made);
  return '';
}

/** Why this blessing cannot be taken here: '' when it can. */
export function churchBlessingBlock(run, nodeId, blessingId, gameData) {
  // The prologue's chapel shows the altar, greyed: blessings start with the first run.
  if (isPrologueRun(run)) return PROLOGUE_BLESSING_BLOCK;
  const made = churchVow(run, nodeId);
  if (made === 'blessing') return 'This altar has already blessed you.';
  const reason = churchVowBlock(run, nodeId, 'blessing');
  if (reason) return reason;
  if (!churchBlessingOffers(run, nodeId, gameData).some((b) => b.id === blessingId))
    return 'That blessing is not offered here.';
  return '';
}

/** Vow a Blessing: the chosen minor blessing joins the run and applies now. */
export function takeChurchBlessing(run, nodeId, blessingId, gameData) {
  const reason = churchBlessingBlock(run, nodeId, blessingId, gameData);
  if (reason) return { ok: false, reason };
  if (!run.addBlessingMidRun(blessingId)) return { ok: false, reason: 'Blessing unavailable.' };
  commitChurchVow(run, nodeId, 'blessing');
  const blessing = gameData.blessings.blessings.find((b) => b.id === blessingId);
  return { ok: true, message: `${blessing.name}: ${blessing.description}` };
}

/** Record the vow (a promotion commits 'promote' through this). */
export function commitChurchVow(run, nodeId, vow) {
  if (!nodeId || !CHURCH_VOWS.includes(vow)) return;
  if (!run.churchVowByNodeId || typeof run.churchVowByNodeId !== 'object')
    run.churchVowByNodeId = {};
  run.churchVowByNodeId[nodeId] = vow;
}
