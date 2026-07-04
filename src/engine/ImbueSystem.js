// ImbueSystem.js — Pure functions for weapon imbues (rare weapon blessings).
// No Phaser deps.
//
// An imbue permanently attaches one special effect to a weapon instance.
// Instance state is a single field (`weapon._imbueId`) plus a display-name
// rename that composes with the forge system's `_baseName` convention, so
// "Vampiric Iron Sword +2" works in both orders of application. Weapons are
// always structuredClone'd off weapons.json and saved by value, so `_imbueId`
// persists through serialization with no extra plumbing (canonical
// weapons.json never gains imbue fields — its schema is additionalProperties:false).
//
// Effects are resolved catalog-side from data/imbues.json at combat time:
// - `combatMods` effects merge into the wielder's combat mods in Combat.js
//   (same seam as weapon-art mods), so they apply both attacking and defending.
// - `postCombatPoison` reuses the resolveCombat poisonEffects path.
// - `postCombatStatus` emits into resolveCombat's imbueStatusEffects, applied
//   by the post-combat pipeline via StatusConditionSystem.applyCondition
//   (which enforces statusImmunity).
//
// Delivery: whetstone-like "Imbuing Stone" items (one per imbue, plus a
// player's-choice "Prismatic Stone") resolved from imbues.json through the
// existing `forge` loot category. Stones never enter inventory.

// Item types that cannot be imbued (matches forge exclusions).
const EXCLUDED_TYPES = new Set(['Staff', 'Scroll', 'Consumable', 'Accessory', 'Whetstone']);

/** Imbue id carried by the Prismatic Stone: the player picks the imbue on use. */
export const IMBUE_CHOICE_ID = 'choice';

/**
 * Normalize the imbues dataset: accepts the imbues.json object
 * ({ imbues: [...] }) or a bare array. Returns the imbue definition array.
 */
export function getImbueList(imbuesData) {
  if (Array.isArray(imbuesData)) return imbuesData;
  if (Array.isArray(imbuesData?.imbues)) return imbuesData.imbues;
  return [];
}

/** Look up an imbue definition by id. */
export function getImbueById(imbuesData, imbueId) {
  if (!imbueId || typeof imbueId !== 'string') return null;
  return getImbueList(imbuesData).find((imbue) => imbue?.id === imbueId) || null;
}

/** True if the weapon instance carries an imbue. */
export function isImbued(weapon) {
  return typeof weapon?._imbueId === 'string' && weapon._imbueId.length > 0;
}

/**
 * Check whether a weapon can receive an imbue.
 * One imbue per weapon (v1); excluded types match forge exclusions.
 * @param {object} weapon
 * @returns {boolean}
 */
export function canImbue(weapon) {
  if (!weapon || !weapon.type || EXCLUDED_TYPES.has(weapon.type)) return false;
  return !isImbued(weapon);
}

/**
 * Apply an imbue to a weapon, mutating it in place.
 * Prepends the imbue adjective to the display name, composing with the forge
 * system's `_baseName` rename:
 * - unforged weapon: "Iron Sword" → "Vampiric Iron Sword" (forging later
 *   snapshots the imbued name as `_baseName`, giving "Vampiric Iron Sword +1")
 * - forged weapon: `_baseName` "Iron Sword", name "Iron Sword +2" →
 *   `_baseName` "Vampiric Iron Sword", name "Vampiric Iron Sword +2"
 *   (deforging to +0 restores "Vampiric Iron Sword")
 * @param {object} weapon
 * @param {object} imbueDef - entry from imbues.json
 * @returns {{ success: boolean }}
 */
export function applyImbue(weapon, imbueDef) {
  if (!canImbue(weapon)) return { success: false };
  const imbueId = typeof imbueDef?.id === 'string' ? imbueDef.id : '';
  const adjective = typeof imbueDef?.adjective === 'string' ? imbueDef.adjective.trim() : '';
  if (!imbueId || !adjective || imbueId === IMBUE_CHOICE_ID) return { success: false };

  weapon._imbueId = imbueId;
  if (typeof weapon._baseName === 'string' && weapon._baseName.length > 0) {
    // Forged weapon: rename the base and recompose the "+N" display name so
    // future forges/deforges keep the imbued base.
    weapon._baseName = `${adjective} ${weapon._baseName}`;
    const forgeLevel = Number(weapon._forgeLevel) || 0;
    weapon.name = forgeLevel > 0 ? `${weapon._baseName} +${forgeLevel}` : weapon._baseName;
  } else {
    weapon.name = `${adjective} ${weapon.name}`;
  }
  return { success: true };
}

/** Get the full imbue definition attached to a weapon instance, or null. */
export function getImbueForWeapon(weapon, imbuesData) {
  if (!isImbued(weapon)) return null;
  return getImbueById(imbuesData, weapon._imbueId);
}

/**
 * Combat mods contributed by a weapon's imbue (merged like weapon-art mods in
 * Combat.js, on whichever side wields the weapon). Includes an `activated`
 * entry so forecasts/UI can surface the imbue. Returns null when the weapon
 * has no imbue, the catalog is missing, or the imbue is not a combatMods type.
 */
export function getImbueCombatMods(weapon, imbuesData) {
  const imbue = getImbueForWeapon(weapon, imbuesData);
  if (!imbue || imbue.effect?.type !== 'combatMods') return null;
  const mods = imbue.effect.combatMods;
  if (!mods || typeof mods !== 'object') return null;
  return {
    ...structuredClone(mods),
    activated: [{ id: `imbue_${imbue.id}`, name: imbue.name }],
  };
}

/** Post-combat poison damage contributed by a weapon's imbue (0 if none). */
export function getImbuePostCombatPoison(weapon, imbuesData) {
  const imbue = getImbueForWeapon(weapon, imbuesData);
  if (!imbue || imbue.effect?.type !== 'postCombatPoison') return 0;
  const damage = Math.trunc(Number(imbue.effect.damage) || 0);
  return damage > 0 ? damage : 0;
}

/**
 * Post-combat status effect contributed by a weapon's imbue, or null.
 * @returns {{ status: string, chance: number, durationPhases: number }|null}
 */
export function getImbuePostCombatStatus(weapon, imbuesData) {
  const imbue = getImbueForWeapon(weapon, imbuesData);
  if (!imbue || imbue.effect?.type !== 'postCombatStatus') return null;
  const status = typeof imbue.effect.status === 'string' ? imbue.effect.status : '';
  if (!status) return null;
  const chance = Math.max(0, Math.min(100, Math.trunc(Number(imbue.effect.chance) || 0)));
  if (chance <= 0) return null;
  return {
    status,
    chance,
    durationPhases: Math.max(1, Math.trunc(Number(imbue.effect.durationPhases) || 1)),
  };
}

/**
 * Display info for an imbued weapon (tooltips / inspect panels).
 * Falls back to the raw id when the catalog entry is missing (stale save vs
 * newer data) so the UI still shows *something*.
 * @returns {{ id, name, adjective, description, lore }|null}
 */
export function getImbueDisplayInfo(weapon, imbuesData) {
  if (!isImbued(weapon)) return null;
  const imbue = getImbueById(imbuesData, weapon._imbueId);
  if (!imbue) {
    return {
      id: weapon._imbueId,
      name: weapon._imbueId,
      adjective: '',
      description: '',
      lore: '',
    };
  }
  return {
    id: imbue.id,
    name: imbue.name || imbue.id,
    adjective: imbue.adjective || '',
    description: imbue.description || '',
    lore: imbue.lore || '',
  };
}

/**
 * Pick a random imbue definition, weighted by each entry's `weight`.
 * @param {object} imbuesData
 * @param {function} [rng=Math.random]
 */
export function pickRandomImbue(imbuesData, rng = Math.random) {
  const imbues = getImbueList(imbuesData).filter((imbue) => imbue?.id);
  if (imbues.length <= 0) return null;
  const weights = imbues.map((imbue) => {
    const weight = Number(imbue.weight);
    return Number.isFinite(weight) && weight > 0 ? weight : 1;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < imbues.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return imbues[i];
  }
  return imbues[imbues.length - 1];
}

// --- Imbuing Stones (whetstone-like delivery items) ---

/** True if a loot/shop item is an imbuing stone (whetstone-like, never inventoried). */
export function isImbueStone(item) {
  return item?.type === 'Whetstone' && typeof item.imbueId === 'string' && item.imbueId.length > 0;
}

/**
 * Build the imbuing-stone item list from imbues.json: one stone per imbue plus
 * the Prismatic Stone (player's choice). Items are whetstone-shaped
 * (`type: 'Whetstone'`) so they flow through the existing `forge` loot
 * category and are excluded from forging/imbuing themselves.
 */
export function getImbueStoneItems(imbuesData) {
  const stones = [];
  for (const imbue of getImbueList(imbuesData)) {
    if (!imbue?.id || !imbue.stone?.name) continue;
    stones.push({
      name: imbue.stone.name,
      type: 'Whetstone',
      imbueId: imbue.id,
      price: Math.max(0, Math.trunc(Number(imbue.stone.price) || 0)),
      lore: imbue.stone.lore || '',
      description: imbue.description || '',
    });
  }
  const prismatic = imbuesData?.prismaticStone;
  if (prismatic?.name) {
    stones.push({
      name: prismatic.name,
      type: 'Whetstone',
      imbueId: IMBUE_CHOICE_ID,
      price: Math.max(0, Math.trunc(Number(prismatic.price) || 0)),
      lore: prismatic.lore || '',
      description: 'Choose one of the six imbues',
    });
  }
  return stones;
}

/**
 * Resolve the imbue definition a stone applies, or null for the Prismatic
 * Stone (player's choice) and unknown ids.
 */
export function resolveStoneImbue(stone, imbuesData) {
  if (!isImbueStone(stone) || stone.imbueId === IMBUE_CHOICE_ID) return null;
  return getImbueById(imbuesData, stone.imbueId);
}

/** Short one-line effect text for stone cards/tooltips. */
export function getImbueStoneDetailText(stone, imbuesData) {
  if (!isImbueStone(stone)) return '';
  if (stone.imbueId === IMBUE_CHOICE_ID) return 'Imbue: choose a blessing';
  const imbue = getImbueById(imbuesData, stone.imbueId);
  if (!imbue) return 'Imbue a weapon';
  return `Imbue: ${imbue.description}`;
}
