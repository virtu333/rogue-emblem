// A unit's resting look on the battlefield (presentation only: nothing here writes game
// state). A unit that has spent its action is drawn "acted": its sprite tinted grey, its
// label and affix pips at half alpha, its faction ring dimmed. Everything else rests in
// its plain colours.
//
// Flashes (a heal's green, a cure, a lava or acid burn, a strike's hit flash) tint a
// sprite for a moment. When one ends, the sprite returns to the look the unit's STATE
// asks for now, read through `restUnitTint`, never to "no tint" and never to a tint
// remembered when the flash began: the action that owns a flash can end (the unit is
// dimmed) or be refreshed (Dance) while the flash is still playing, and a remembered or
// cleared tint then shows the wrong unit as ready or spent. `tests/UnitRestAppearance.test.js`
// holds every flash in src to this rule.
import { isSleeping } from '../engine/StatusConditionSystem.js';
import { battleContrastEnabled } from './BattleContrast.js';
import { setFactionRingActed } from './FactionRings.js';
import { UI_HEX } from '../utils/uiStyles.js';

/** The acted sprite tint (matches the contrast pass's palette when it is on). */
export function actedUnitTint() {
  return battleContrastEnabled() ? 0xb8b8b8 : UI_HEX.lineStrong;
}

/**
 * Whether the unit's resting look is the acted (dimmed) one, from its state alone:
 * a player unit that has acted (it stays spent through the enemy phase, until its next
 * player phase begins) or is asleep; an enemy that has acted in its own phase. NPC
 * allies are never dimmed.
 */
export function unitRestsDimmed(unit) {
  if (!unit) return false;
  if (unit.faction === 'player') return unit.hasActed === true || isSleeping(unit);
  if (unit.faction === 'enemy') return unit.hasActed === true;
  return false;
}

/** The acted look: grey sprite, half-alpha label and pips, dimmed ring. */
export function applyActedLook(unit) {
  if (!unit) return;
  unit.graphic?.setTint?.(actedUnitTint());
  unit.label?.setAlpha?.(0.5);
  setFactionRingActed(unit.factionIndicator, true);
  if (unit.affixPips) unit.affixPips.forEach((p) => p?.setAlpha?.(0.5));
}

/** The ready look: no tint, full-alpha label and pips, plain ring. */
export function applyReadyLook(unit) {
  if (!unit) return;
  unit.graphic?.clearTint?.();
  unit.label?.setAlpha?.(1);
  setFactionRingActed(unit.factionIndicator, false);
  if (unit.affixPips) unit.affixPips.forEach((p) => p?.setAlpha?.(1));
}

/**
 * Put the sprite's tint back to the unit's resting tint: the acted grey when its state
 * says so, else none. The one way a flash ends. `graphic` defaults to the unit's own
 * (a strike's flash may hold the sprite it tinted).
 */
export function restUnitTint(unit, graphic = unit?.graphic) {
  if (!graphic) return;
  if (unitRestsDimmed(unit)) graphic.setTint?.(actedUnitTint());
  else graphic.clearTint?.();
}

/**
 * Put the whole look (sprite, label, ring, pips) back to what the unit's state asks for,
 * through the scene's dimUnit/undimUnit. For a change of state (a refresh, a wake, a
 * cure, a new phase, a restore) rather than the end of a flash.
 */
export function restUnitAppearance(scene, unit) {
  if (!unit) return;
  if (unitRestsDimmed(unit)) {
    if (typeof scene?.dimUnit === 'function') scene.dimUnit(unit);
    else applyActedLook(unit);
  } else if (typeof scene?.undimUnit === 'function') scene.undimUnit(unit);
  else applyReadyLook(unit);
}
