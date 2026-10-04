// PrologueDeparture — the row-2 departure check (docs/specs/prologue-chapter.md §6,
// "Route map, row 2"). Pure: no DOM, no Phaser, no RNG.
//
// Tamsin joins at Harrow's Market or Chapel unarmed (her bow burned with her watch
// post). The roster lesson shows how to hand her the bow, but it can be skipped and
// never blocks travel, so a player can leave the fork with her still unarmed and only
// find out in P3. Travelling on from the node where she joined while she carries no
// combat weapon she can use raises a non-blocking choice (ui/PrologueDepartureWarning:
// Open Roster / Continue anyway); this module says when.

import { isPrologueRun } from './ScriptedBattle.js';
import { prologueJoinsAtNode } from './Prologue.js';
import { canEquip } from './UnitManager.js';

const isCombatWeapon = (item) =>
  Boolean(item) &&
  item.type !== 'Consumable' &&
  item.type !== 'Scroll' &&
  item.type !== 'Accessory' &&
  item.type !== 'Staff';

/** The unit carries a combat weapon it can wield (equipped or not). */
export function hasUsableWeapon(unit) {
  return (unit?.inventory || []).some((w) => isCombatWeapon(w) && canEquip(unit, w));
}

/**
 * Leaving for `node` would take an unarmed arrival recruit into the road: the prologue
 * run, standing on a node where someone joined on arrival (joins.atNode), travelling to
 * another node, with that unit in the army and no usable combat weapon. Returns
 * { unit } (the unit's name) or null.
 * @param {object} run - RunManager
 * @param {{ id: string }} node - the node the player chose to travel to
 */
export function unarmedDeparture(run, node) {
  if (!isPrologueRun(run) || !node?.id) return null;
  const from = run.currentNodeId;
  if (!from || node.id === from) return null;
  const keys = prologueJoinsAtNode(run.gameData?.prologue, from);
  for (const key of keys) {
    const unit = (run.roster || []).find((u) => u?.name === key);
    if (unit && unit.currentHP !== 0 && !hasUsableWeapon(unit)) return { unit: unit.name };
  }
  return null;
}
