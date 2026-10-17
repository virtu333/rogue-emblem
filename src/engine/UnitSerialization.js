// UnitSerialization.js - serializeUnit and the item signature it relinks a weapon by, moved out of
// RunManager.js so the recruit and event-join modules that serialize a unit need not import the
// RunManager (which imports them back). RunManager re-exports serializeUnit for its older importers.

import { normalizeEquippedFirst } from './UnitManager.js';
import { ensureItemUid } from '../utils/itemUid.js';
import { UNIT_PRESENTATION_FIELDS } from './BattleUnitState.js';
import { EPIC_BATTLE_UNIT_FIELDS } from './EpicWeapons.js';

// Phaser-specific fields that must be stripped for serialization
const PHASER_FIELDS = UNIT_PRESENTATION_FIELDS;

export function legacyItemSignature(item) {
  if (!item || typeof item !== 'object') return JSON.stringify(item);
  const clone = structuredClone(item);
  delete clone.uid;
  return JSON.stringify(clone);
}

/**
 * Strip Phaser display objects from a unit, reset per-battle flags.
 */
export function serializeUnit(unit) {
  const data = { ...unit };
  delete data.battleEntityId;
  delete data.equippedInventoryIndex;
  delete data._lastAiDecision; // transient target references can contain Phaser objects
  if (unit?.stats && typeof unit.stats === 'object') {
    data.stats = { ...unit.stats };
  }
  if (unit?.rolledGrowths && typeof unit.rolledGrowths === 'object') {
    data.rolledGrowths = { ...unit.rolledGrowths };
  }
  // Deep-clone mutable collection fields to prevent shared-reference mutations
  if (Array.isArray(data.inventory))
    data.inventory = data.inventory.map((i) => ensureItemUid(structuredClone(i)));
  if (Array.isArray(data.skills)) data.skills = [...data.skills];
  if (Array.isArray(data.consumables))
    data.consumables = data.consumables.map((c) => ensureItemUid(structuredClone(c)));
  if (Array.isArray(data.proficiencies))
    data.proficiencies = data.proficiencies.map((p) => ({ ...p }));
  if (data.accessory) data.accessory = ensureItemUid(structuredClone(data.accessory));
  if (data.deeds && typeof data.deeds === 'object') data.deeds = structuredClone(data.deeds);
  // Relink weapon to cloned inventory item (preserves identity invariant)
  if (data.weapon && Array.isArray(data.inventory) && Array.isArray(unit.inventory)) {
    const weaponUid = typeof unit.weapon?.uid === 'string' ? unit.weapon.uid : '';
    let origIdx = weaponUid ? data.inventory.findIndex((w) => w?.uid === weaponUid) : -1;
    if (origIdx < 0) origIdx = unit.inventory.indexOf(unit.weapon);
    if (origIdx < 0) {
      const weaponSig = legacyItemSignature(unit.weapon);
      origIdx = unit.inventory.findIndex((w) => legacyItemSignature(w) === weaponSig);
    }
    if (origIdx >= 0 && origIdx < data.inventory.length) {
      data.weapon = data.inventory[origIdx];
      // Run-level saves keep the FE invariant: equipped weapon first.
      normalizeEquippedFirst(data);
    } else {
      // Weapon not in inventory (legacy/edge case) — deep-clone independently
      data.weapon = ensureItemUid(structuredClone(unit.weapon));
    }
  } else if (data.weapon) {
    data.weapon = ensureItemUid(structuredClone(unit.weapon));
  }
  for (const key of PHASER_FIELDS) data[key] = null;
  data.hasMoved = false;
  data.hasActed = false;
  data._miracleUsed = false;
  data._phoenixBroochUsed = false;
  const timedBuffStats = unit?._battleTimedWeaponArtAppliedStats;
  if (timedBuffStats && data.stats && typeof data.stats === 'object') {
    for (const [rawStat, rawValue] of Object.entries(timedBuffStats)) {
      const stat = typeof rawStat === 'string' ? rawStat.trim().toUpperCase() : '';
      if (!stat) continue;
      const value = Math.trunc(Number(rawValue) || 0);
      if (value === 0) continue;
      data.stats[stat] = (data.stats[stat] || 0) - value;
      if (stat === 'MOV') data.stats[stat] = Math.max(1, data.stats[stat] || 1);
      else data.stats[stat] = Math.max(0, data.stats[stat] || 0);
    }
    if (Object.prototype.hasOwnProperty.call(data.stats, 'MOV')) {
      data.mov = data.stats.MOV;
    }
  }
  delete data._battleDeltas;
  delete data._battleDeltaSources;
  delete data._battleWeaponArtUsage;
  delete data._battleAbilityUsage;
  delete data._speedtakerStacks;
  delete data._battleTimedWeaponArtBuffs;
  delete data._battleTimedWeaponArtAppliedStats;
  delete data._battleTimedWeaponArtAppliedCombatMods;
  delete data._movementSpent;
  delete data._turnAnchor;
  delete data._legendaryGraceTurn;
  delete data._fortHealStreak;
  // Deed progress commits at victory (commitBattleDeeds) or not at all.
  delete data._battleDeeds;
  delete data._slewAllies;
  // The Unbroken Banner's stamp is the battle's: the victory commit reads it first.
  delete data._bannerHeld;
  // The trade cards' battle stamps (TradeBoons.stampArmyBattleRules): the battle's, never the run's.
  delete data._rangedReachBonus;
  delete data._weaponSwapLocked;
  delete data._inBattle;
  // The Epic weapons' battle counts (Frightened Acclaim's kills, Gorgemaw's last meal).
  for (const key of EPIC_BATTLE_UNIT_FIELDS) delete data[key];
  return data;
}
