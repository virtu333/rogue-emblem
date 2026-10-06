// How many uses a Vulnerary has in a run: the one rule every acquisition path reads.
//
// consumables.json holds the base (the free healing is deliberately small). The Home Base
// upgrade Apothecary's Recipe lifts it through the run's meta effects (`vulneraryUses`),
// and a run snapshots its meta effects at the start, so the figure never moves mid-run.
// The prologue applies no meta effects; data/prologue.json `consumableEffects` pins its own.
//
// Items are stored whole in saves, so this is read only when an item is CREATED (a kit, a
// shop's stock, a loot roll, a grant). Nothing re-reads it for an item that already exists.
//
// Pure: no Phaser, no randomness, never mutates its inputs.

export const VULNERARY_NAME = 'Vulnerary';

function isVulnerary(item) {
  return item?.name === VULNERARY_NAME;
}

/**
 * The effective uses of a Vulnerary.
 * @param {number} baseUses - the catalog template's uses (consumables.json)
 * @param {{ vulneraryUses?: number }|null} [effects] - the run's meta effects
 * @returns {number}
 */
export function vulneraryUsesFor(baseUses, effects = null) {
  const base = Math.max(0, Math.trunc(Number(baseUses) || 0));
  const lifted = Math.trunc(Number(effects?.vulneraryUses) || 0);
  return Math.max(base, lifted);
}

/**
 * The item as this run should acquire it: a Vulnerary takes the effective uses, anything
 * else (and a Vulnerary already at that many) comes back as the same object. Never
 * mutates `item`, so a shared catalog template stays at its data value.
 * @template T
 * @param {T} item - a consumable template or instance
 * @param {{ vulneraryUses?: number }|null} [effects]
 * @returns {T}
 */
export function applyVulneraryRecipe(item, effects = null) {
  if (!isVulnerary(item)) return item;
  const uses = vulneraryUsesFor(item.uses, effects);
  return uses === item.uses ? item : { ...item, uses };
}

/**
 * A consumables catalog as this run sees it: the Vulnerary entry carries the effective
 * uses. Hand this, not gameData.consumables, to anything that draws or stocks items.
 * @param {object[]} catalog - gameData.consumables
 * @param {{ vulneraryUses?: number }|null} [effects]
 * @returns {object[]}
 */
export function consumableCatalogFor(catalog, effects = null) {
  return (Array.isArray(catalog) ? catalog : []).map((item) => applyVulneraryRecipe(item, effects));
}

/**
 * The template for a named consumable as this run acquires it, or null.
 * @param {object[]} catalog - gameData.consumables
 * @param {string} name
 * @param {{ vulneraryUses?: number }|null} [effects]
 */
export function consumableTemplateFor(catalog, name, effects = null) {
  const template = (Array.isArray(catalog) ? catalog : []).find((c) => c?.name === name);
  return template ? applyVulneraryRecipe(template, effects) : null;
}
