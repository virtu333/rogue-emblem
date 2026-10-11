// EncounterTriggers.js — the wake triggers an encounter group reads
// (docs/specs/large-maps/02-encounters-and-pacing.md §3.4). Pure, no Phaser, no RNG.
//
// EncounterGroups.checkEncounters evaluates them at one point: the encounter check at the top
// of each enemy phase. PR 2.1 ships the kinds today's hold packs need:
//   danger  a member the player can see has a player unit or a known NPC on its Danger tiles
//           (ThreatForecast.enemyThreatTiles over PlayerKnowledge): the red zone is the wake
//           zone, and a fogged member never wakes this way;
//   hurt    a member was struck, hexed or moved (HoldDisturbance marks it when it happens), or
//           a member fell (fewer living than the group's size);
//   turn    the absolute turn an authored set piece's `wake: N` names (`{ turn: N, delay: 0 }`):
//           the enemy phase of turn N, or any later check (`>=`, so a resume skips nothing).
// The relative clocks, `groupWoken`, `tile`, `sight` and `objective` follow in 2.2.

import { enemyThreatTiles, isThreatSourceVisible } from './ThreatForecast.js';

/** The trigger kinds this build evaluates. */
export const TRIGGER_KINDS = Object.freeze(['danger', 'hurt', 'turn']);

/**
 * A group wake's delay when its trigger names none (§3.4 "Default delays"): the player's own
 * act wakes at once; a clock gets one player phase of warning. 2.1 evaluates delay 0 only.
 */
export const DEFAULT_WAKE_DELAY = Object.freeze({ danger: 0, hurt: 0, turn: 1 });

const tileKey = (col, row) => `${col},${row}`;

export function wakeDelay(wake) {
  return Number.isInteger(wake?.delay) ? wake.delay : (DEFAULT_WAKE_DELAY[wake?.kind] ?? 0);
}

/**
 * `hurt`, the member's own part: struck, hexed or moved. The hooks that change a unit mark it
 * the moment it happens (HoldDisturbance.markHoldDisturbed), so a heal or a recovery before the
 * enemy phase cannot hide it; standing off its post is a backstop for any move without a hook.
 * @returns {'hurt'|'status'|'moved'|null}
 */
export function memberDisturbance(unit) {
  if (unit?.holdDisturbed) return unit.holdDisturbed;
  const post = unit?.holdPost;
  if (post && (post.col !== unit.col || post.row !== unit.row)) return 'moved';
  return null;
}

/** `hurt`, the group's part: a member is gone (killed, even from outside every zone). */
export function groupLostMember(living, size) {
  return Number.isInteger(size) && living < size;
}

/** `turn` in its absolute form: due at the check of turn `wake.turn` or any later one. */
export function absoluteTurnDue(wake, turn) {
  return (
    wake?.kind === 'turn' &&
    Number.isInteger(wake.turn) &&
    Number.isInteger(turn) &&
    turn >= wake.turn
  );
}

/**
 * Who stands in a Danger zone for the `danger` trigger: the player's own units and the NPCs
 * the player knows of (PlayerKnowledge: a fogged NPC counts only through the recruit beacon),
 * exactly as the Danger overlay sees them.
 */
export function dangerTargets({ playerUnits = [], npcUnits = [], threatContext = null }) {
  const knows = threatContext?.isKnown || (() => true);
  return [...(playerUnits || []), ...(npcUnits || []).filter((u) => knows(u))].filter(
    (u) => u && u.currentHP > 0 && !u._removing,
  );
}

/**
 * `danger` for one member: seen by the player with a target inside its Danger tiles. Only
 * what the player knows shapes the tiles (`positions`, from `threatContext.positions()`).
 */
export function memberInDanger(unit, threatContext, positions, targets) {
  if (!threatContext || !isThreatSourceVisible(threatContext.grid, unit)) return false;
  const { damage, status } = enemyThreatTiles(threatContext, unit, positions);
  return targets.some((t) => {
    const k = tileKey(t.col, t.row);
    return damage.has(k) || status.has(k);
  });
}

/**
 * The problems with one wake trigger, as this build reads it ([] when it is sound). A kind the
 * build does not evaluate is refused rather than ignored: a group that could never wake would
 * sleep through the battle.
 */
export function wakeTriggerErrors(wake, where = 'wake') {
  if (!wake || typeof wake !== 'object' || Array.isArray(wake)) return [`${where} is not a record`];
  if (!TRIGGER_KINDS.includes(wake.kind)) return [`${where}: unknown kind "${wake.kind}"`];
  const errors = [];
  if (wake.delay !== undefined && !(Number.isInteger(wake.delay) && wake.delay >= 0))
    errors.push(`${where}: delay must be an integer >= 0`);
  // Only the immediate wakes run in this build; delayed ones need the fired ledger's bands (2.2).
  if (wakeDelay(wake) !== 0) errors.push(`${where}: a delayed wake is not supported yet`);
  if (wake.kind === 'turn') {
    if (!(Number.isInteger(wake.turn) && wake.turn >= 1))
      errors.push(`${where}: turn needs an absolute turn >= 1`);
    const extra = Object.keys(wake).filter((k) => !['kind', 'delay', 'turn'].includes(k));
    if (extra.length) errors.push(`${where}: turn does not take ${extra.join(', ')} yet`);
  } else {
    const extra = Object.keys(wake).filter((k) => k !== 'kind' && k !== 'delay');
    if (extra.length) errors.push(`${where}: ${wake.kind} takes no ${extra.join(', ')}`);
  }
  return errors;
}
