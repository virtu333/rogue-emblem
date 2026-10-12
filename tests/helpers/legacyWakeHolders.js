// A frozen copy of HoldActivation.wakeHolders as it stood before encounter groups replaced it
// (docs/specs/large-maps/02-encounters-and-pacing.md §3.6). Tests run it beside the encounter
// check over the same boards: the two must wake the same units for the same reasons. Never
// edit it to make a test pass.
import { enemyThreatTiles, isThreatSourceVisible } from '../../src/engine/ThreatForecast.js';

const HOLD_AI_MODE = 'hold';
const tileKey = (col, row) => `${col},${row}`;
const isHolding = (unit) => unit?.aiMode === HOLD_AI_MODE && unit.currentHP > 0;
function disturbed(unit) {
  if (unit.holdDisturbed) return unit.holdDisturbed;
  const post = unit.holdPost;
  if (post && (post.col !== unit.col || post.row !== unit.row)) return 'moved';
  return null;
}

/**
 * Rule 1: seen by the player with a player or NPC unit inside its Danger tiles. Only
 * what the player knows shapes the tiles (`threatContext.positions()`, PlayerKnowledge).
 */
function threatened(unit, threatContext, positions, targets) {
  if (!threatContext || !isThreatSourceVisible(threatContext.grid, unit)) return false;
  const { damage, status } = enemyThreatTiles(threatContext, unit, positions);
  return targets.some((t) => {
    const k = tileKey(t.col, t.row);
    return damage.has(k) || status.has(k);
  });
}

/**
 * Wake the packs whose members meet a wake rule (mutates them: aiMode cleared, `holdWoke`
 * records why: 'turn' for the authored wake turn). Call at the top of an enemy phase, with its turn number: the holders
 * still holding afterwards record it (`holdCheckedTurn`, saved with the unit), so a
 * phase resumed from a checkpoint never checks again. By then enemies that already moved
 * may have opened new stop tiles, and a second check would break the exact restore.
 * @param {{ enemyUnits: object[], playerUnits: object[], npcUnits?: object[],
 *   threatContext?: object|null, bossEnraged?: boolean, turn?: number|null }} battle
 * @returns {{ unit: object, reason: string }[]} the holders woken, in pack order
 */
export function legacyWakeHolders({
  enemyUnits = [],
  playerUnits = [],
  npcUnits = [],
  threatContext = null,
  bossEnraged = false,
  turn = null,
}) {
  const checked = Number.isInteger(turn);
  const holders = (enemyUnits || [])
    .filter(isHolding)
    .filter((u) => !checked || u.holdCheckedTurn !== turn);
  if (!holders.length) return [];
  // The player's own units, and the NPCs the player knows of (PlayerKnowledge: a fogged
  // NPC counts only through the recruit beacon), exactly as the Danger overlay sees them.
  const knows = threatContext?.isKnown || (() => true);
  const targets = [...(playerUnits || []), ...(npcUnits || []).filter((u) => knows(u))].filter(
    (u) => u && u.currentHP > 0 && !u._removing,
  );
  let positions = null;
  const living = new Map();
  for (const unit of holders) living.set(unit.holdPack, (living.get(unit.holdPack) || 0) + 1);
  const packReason = new Map();
  for (const unit of holders) {
    if (packReason.has(unit.holdPack)) continue;
    let reason = bossEnraged ? 'enrage' : disturbed(unit);
    // Its authored wake turn has come (any member's: a pack shares one).
    if (!reason && checked) {
      const wakeAt = holders.find(
        (h) => h.holdPack === unit.holdPack && Number.isInteger(h.holdWakeTurn),
      )?.holdWakeTurn;
      if (wakeAt !== undefined && turn >= wakeAt) reason = 'turn';
    }
    // A member is gone (killed, even from outside every zone): the rest wake.
    if (!reason && living.get(unit.holdPack) < unit.holdPackSize) reason = 'fallen';
    if (!reason) {
      positions ||= threatContext?.positions?.() || null;
      if (threatened(unit, threatContext, positions, targets)) reason = 'threat';
    }
    if (reason) packReason.set(unit.holdPack, reason);
  }
  const woken = [];
  for (const unit of holders) {
    const reason = packReason.get(unit.holdPack);
    if (!reason) {
      if (checked) unit.holdCheckedTurn = turn;
      continue;
    }
    delete unit.aiMode;
    delete unit.holdDisturbed;
    unit.holdWoke = reason;
    woken.push({ unit, reason });
  }
  return woken;
}
