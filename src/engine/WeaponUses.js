// WeaponUses.js — weapon durability as uses per battle (docs/specs/weapon-uses.md). Pure.
//
// Every combat weapon a PLAYER unit holds has a number of uses each battle, by tier
// (data/weaponUses.json `byTier`), and refills after the battle, as Breachbolt's shots
// and a staff's uses do. One use is one resolved combat in which the weapon struck
// (attacking or countering, hit or miss; a double is still one use). Enemies, NPC allies
// and the arena never spend uses. A weapon whose catalog row says `perBattleUses`
// (Breachbolt, The Middle Pages) keeps its own count for every faction, as before.
//
// The count is read, never stored: a weapon holds only `_usesSpent`, so a save needs no
// migration and a build without the rule (or with `enabled: false`) plays the same save
// with unlimited uses. Combat.js reads this module through `tracksBattleUses` and
// `getPerBattleMaxUses`; nothing else decides whether a weapon has uses.

import defaults from '../../data/weaponUses.json' with { type: 'json' };

let config = defaults;

const NON_WEAPON_TYPES = new Set(['Staff', 'Scroll', 'Consumable']);

/** The rule's data (data/weaponUses.json unless a test swapped it). */
export function weaponUsesConfig() {
  return config;
}

/** Tests only: play with another config; returns a function that restores the old one. */
export function setWeaponUsesConfigForTesting(next) {
  const previous = config;
  config = next ?? defaults;
  return () => {
    config = previous;
  };
}

/** Is weapon durability switched on? */
export function isWeaponUsesEnabled(cfg = config) {
  return cfg?.enabled === true;
}

/** A combat weapon (not a staff, scroll or consumable) with no catalog per-battle count. */
export function isDurabilityWeapon(weapon) {
  return Boolean(
    weapon &&
    typeof weapon.type === 'string' &&
    !NON_WEAPON_TYPES.has(weapon.type) &&
    !weapon.perBattleUses,
  );
}

/** The uses a weapon's tier gives it each battle (0 when the tier is unlisted). */
export function durabilityBaseUses(weapon, cfg = config) {
  const n = cfg?.byTier?.[weapon?.tier];
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Does this unit spend durability uses with this weapon? (catalog per-battle weapons aside) */
export function spendsDurability(weapon, unit, cfg = config) {
  return (
    isWeaponUsesEnabled(cfg) &&
    unit?.faction === 'player' &&
    isDurabilityWeapon(weapon) &&
    durabilityBaseUses(weapon, cfg) > 0
  );
}

/** The uses a durability weapon has each battle for this unit. */
export function durabilityMaxUses(weapon, unit, cfg = config) {
  if (!spendsDurability(weapon, unit, cfg)) return 0;
  return durabilityBaseUses(weapon, cfg);
}

/** Does this unit's weapon keep a per-battle count (a catalog per-battle weapon, or durability)? */
export function tracksBattleUses(weapon, unit, cfg = config) {
  if (!weapon || weapon.type === 'Staff') return false;
  return Boolean(weapon.perBattleUses) || spendsDurability(weapon, unit, cfg);
}

/** Uses a per-battle weapon has in each battle for this unit (Combat.getPerBattleMaxUses). */
export function perBattleMaxUses(weapon, unit, cfg = config) {
  if (!weapon?.perBattleUses) return durabilityMaxUses(weapon, unit, cfg);
  const byFaction = weapon?.usesByFaction?.[unit?.faction];
  return Number.isFinite(byFaction) ? byFaction : (weapon?.uses ?? 0);
}

/** A player unit's uses each battle with this weapon (the Compendium's figure); null when none. */
export function playerBattleUses(weapon, cfg = config) {
  const unit = { faction: 'player' };
  if (!tracksBattleUses(weapon, unit, cfg)) return null;
  const n = perBattleMaxUses(weapon, unit, cfg);
  return n > 0 ? n : null;
}

/** True when this unit's weapon keeps a count and has none left this battle. */
export function isSpentForBattle(weapon, unit, cfg = config) {
  if (!tracksBattleUses(weapon, unit, cfg)) return false;
  return perBattleMaxUses(weapon, unit, cfg) - (weapon._usesSpent || 0) <= 0;
}

/**
 * Validate data/weaponUses.json against the weapon catalog: every combat weapon tier is
 * listed with a whole number of uses of at least 1. Returns error strings.
 */
export function validateWeaponUsesConfig(cfg, { weapons = [] } = {}) {
  const errors = [];
  if (!cfg || typeof cfg !== 'object') return ['config must be an object'];
  if (cfg.version !== 1) errors.push('version must be 1');
  if (typeof cfg.enabled !== 'boolean') errors.push('enabled must be true or false');
  const byTier = cfg.byTier;
  if (!byTier || typeof byTier !== 'object' || Array.isArray(byTier)) {
    errors.push('byTier must be an object of tier -> uses');
    return errors;
  }
  for (const [tier, n] of Object.entries(byTier)) {
    if (!Number.isInteger(n) || n < 1) errors.push(`byTier.${tier} must be a whole number >= 1`);
  }
  const tiers = new Set(weapons.filter((w) => isDurabilityWeapon(w)).map((w) => w.tier));
  for (const tier of tiers) {
    if (!Object.hasOwn(byTier, tier)) errors.push(`byTier has no entry for weapon tier ${tier}`);
  }
  for (const key of Object.keys(cfg)) {
    if (!['version', 'enabled', 'byTier'].includes(key)) errors.push(`unknown key ${key}`);
  }
  return errors;
}

/**
 * Refill an item's per-battle uses (a Breachbolt's shots, a staff's uses, a weapon's
 * durability) for the next battle. Anything else is left alone. Mutates the item.
 */
export function refillBattleUses(item) {
  if (!item || typeof item !== 'object') return;
  // A catalog per-battle weapon or staff always carries its count (readers
  // expect 0, not undefined); a tier weapon is only touched once it has spent.
  if (item.perBattleUses) item._usesSpent = 0;
  else if (isDurabilityWeapon(item) && item._usesSpent) item._usesSpent = 0;
}
