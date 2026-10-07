// PassMovement — the options Pass (docs/specs/phase3.md 3E) adds to a unit's movement.
// Pure, no Phaser.
//
// Pass is a passive: the unit moves through enemy units but can never stop on one. The
// rule itself lives in Grid.js (computeMovementRange and computePath take `{ pass }`;
// `passesThrough` says whom it walks through); this module is only the question "does this
// unit have it?", asked in one place so the scene, the previews, the headless harness and the
// sims all pass the same options. It reads EffectiveSkills, so a Pass lent by an accessory
// works exactly as a learned one.
//
// Enemies never get Pass: the option is only ever true for a player unit, and the AI's
// movement code (AIController, ThreatForecast.enemyThreatTiles) never asks for it.
import { hasEffectiveSkill } from './EffectiveSkills.js';
import { passesThrough } from './Grid.js';
import { PASS_SKILL_ID } from '../utils/constants.js';

export { PASS_SKILL_ID };

/** Does this unit walk through enemy units (Pass, learned, innate or lent)? */
export function hasPass(unit) {
  return unit?.faction === 'player' && hasEffectiveSkill(unit, PASS_SKILL_ID);
}

/**
 * The movement options for `unit`: `{ pass }`, passed as the last argument of
 * `Grid.getMovementRange` / `findPath`. `{ pass: false }` for anyone without Pass.
 */
export function movementOptionsFor(unit) {
  return { pass: hasPass(unit) };
}

/**
 * For FogAmbush.ambushStop: does `unit` walk through this hidden unit? (Only a foe, and only
 * with Pass; a hidden NPC still stops the walk, as it always did.)
 */
export function passesHiddenUnit(unit, hidden) {
  return hasPass(unit) && passesThrough(hidden, unit.faction);
}
