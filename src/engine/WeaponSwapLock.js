// WeaponSwapLock.js - Oathbound Steel's cost (an act boss's trade card, docs/specs/blessings-v3.md
// §6.8, engine/TradeBoons.js `weapon_swap_locked`): a player unit holding a combat weapon in battle
// cannot change it for another. Pure leaf module (no imports) so every reader can ask it.
//
// The lock is stamped on each player unit for the battle (`stampArmyBattleRules` in
// engine/TradeBoons.js, from `battleParams.weaponSwapLocked`: the scene and the harness at the
// battle's start and resume, a joiner as it joins) and read here:
//   - AttackOptions.getAttackWeapons: the attack's weapons are the one held (targeting, the
//     forecast's weapon cycle, the default pick, move-then-attack, the harness's picks);
//   - WeaponArtSystem.canUseWeaponArt: an art carried by another weapon is out ('weapon_locked');
//   - the battle's Equip menu and in-battle Trade (ItemTrade) refuse a change of it;
//   - PerBattleWeapons.swapSpentWeapons never hands a spent weapon's place to another.
// A staff is no combat weapon: a unit holding none (or only a staff) may take one up, after which
// it holds it. A locked unit may still heal: the Heal action takes the staff up for the cast and
// hands the held weapon back (HealController.holdStaff / restoreCombatWeapon, never through these
// gates), but neither the Equip menu nor a reorder may put the held weapon down for a staff. A unit leaves the battle without the lock (UnitSerialization.serializeUnit).

/** The field the battle's lock rides on a unit (checkpoints and rewinds keep it). */
export const WEAPON_SWAP_LOCK_FIELD = '_weaponSwapLocked';
/** What the player is told when the lock refuses a change. */
export const WEAPON_SWAP_LOCK_REASON = "Oathbound Steel: weapons can't be changed in battle";

const NOT_COMBAT = new Set(['Staff', 'Scroll', 'Consumable', 'Accessory']);

/** True for a weapon a unit fights with (never a staff or a scroll). */
export function isCombatWeapon(weapon) {
  return Boolean(weapon && typeof weapon.type === 'string' && !NOT_COMBAT.has(weapon.type));
}

/** True while `unit` is held to the combat weapon it holds (`unit.weapon`). */
export function weaponSwapLocked(unit) {
  return Boolean(
    unit &&
    unit.faction === 'player' &&
    unit[WEAPON_SWAP_LOCK_FIELD] === true &&
    isCombatWeapon(unit.weapon),
  );
}

/** True when the lock refuses `unit` taking up `next` (any weapon) in place of the one it holds. */
export function weaponChangeBlocked(unit, next) {
  return weaponSwapLocked(unit) && Boolean(next) && next !== unit.weapon;
}
