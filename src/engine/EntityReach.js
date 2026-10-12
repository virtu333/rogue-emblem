// EntityReach — the two reaches of the Entity, read from one place (pure, no Phaser deps).
//
// The Entity strikes on its own turn within ENTITY_PRIMARY_ATTACK_RANGE of its 3x3 body
// (AIController._decideEntityAction), but its weapons (Eldritch Grasp, Twisting Vortex) carry
// range 1-4, so a unit that attacks it from 3-4 tiles away is countered all the same
// (Combat.canCounter). Every danger display shows the strike zone; this module names the
// rest: the distances from the body where the Entity can ONLY counter. Ordinary units need
// no such band: movement plus weapon range already covers where they can counter.
//
// The counter distances are asked of Combat.canCounter itself (the rule the forecast and
// the strike loop use), never of a number: a weapon of range 1-3 gives 3 alone, a spent
// per-battle weapon or a staff gives none.

import { ENTITY_PRIMARY_ATTACK_RANGE } from '../utils/constants.js';
import { canCounter, parseRange } from './Combat.js';
import { entityDistanceTo, isEntity } from './EntitySystem.js';

/** How far the Entity's own strikes reach from its body (one rule: the AI's and the Danger zone's). */
export const entityStrikeReach = () => ENTITY_PRIMARY_ATTACK_RANGE;

/**
 * Distances from the Entity's body (ascending, each beyond its strike reach) at which it can
 * counter an attacker but never strike on its own turn. Empty for a non-Entity.
 */
export function entityCounterOnlyDistances(entity) {
  if (!isEntity(entity) || !entity.weapon) return [];
  const farthest = parseRange(entity.weapon.range).max;
  const out = [];
  for (let d = ENTITY_PRIMARY_ATTACK_RANGE + 1; d <= farthest; d++) {
    if (canCounter(entity, entity.weapon, d)) out.push(d);
  }
  return out;
}

/** Farthest distance from the body at which the Entity can counter (its strike reach at least). */
export function entityCounterReach(entity) {
  const far = entityCounterOnlyDistances(entity);
  return far.length ? far[far.length - 1] : ENTITY_PRIMARY_ATTACK_RANGE;
}

/**
 * The tiles of a cols x rows map where the Entity can only counter: those whose distance from
 * the nearest body tile (EntitySystem.entityDistanceTo, what combat measures) is one of
 * entityCounterOnlyDistances. Never a body tile, never a strike tile.
 * @returns {Set<string>} "col,row" keys
 */
export function entityCounterOnlyTiles(entity, cols, rows) {
  const tiles = new Set();
  const distances = entityCounterOnlyDistances(entity);
  if (!distances.length) return tiles;
  const reach = distances[distances.length - 1];
  const wanted = new Set(distances);
  const c0 = Math.max(0, entity.col - reach);
  const c1 = Math.min(cols - 1, entity.col + 2 + reach);
  const r0 = Math.max(0, entity.row - reach);
  const r1 = Math.min(rows - 1, entity.row + 2 + reach);
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      if (wanted.has(entityDistanceTo(entity, col, row))) tiles.add(`${col},${row}`);
    }
  }
  return tiles;
}

/**
 * The Entity's reach as the unit pages read it: { strike, counter, text }, or null for any
 * other unit. "Strikes within 2 · Counters within 4"; when its counter reaches no farther than
 * its strike, one clause ("Strikes and counters within 2").
 */
export function entityReachInfo(unit) {
  if (!isEntity(unit)) return null;
  const strike = ENTITY_PRIMARY_ATTACK_RANGE;
  const counter = entityCounterReach(unit);
  const text =
    counter > strike
      ? `Strikes within ${strike} · Counters within ${counter}`
      : `Strikes and counters within ${strike}`;
  return { strike, counter, text };
}

/**
 * The forecast's one-line warning, or '' : the Entity answers an attack from beyond its strike
 * reach (a bow at range 3 is not safe). `display.entityCounterAt` is the combat distance, set by
 * Combat.getCombatForecast only when the Entity does counter from farther than it strikes.
 */
export function entityCounterNote(forecast) {
  const at = forecast?.display?.entityCounterAt;
  if (!(at > ENTITY_PRIMARY_ATTACK_RANGE) || !forecast.defender?.canCounter) return '';
  return `Counters from ${at} tiles · it strikes within ${ENTITY_PRIMARY_ATTACK_RANGE}`;
}
