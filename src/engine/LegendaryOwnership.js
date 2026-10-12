// LegendaryOwnership.js - one Legend-tier weapon per run.
//
// A legendary weapon is granted at most once a run: `run.legendaryGrants` is the ledger of base
// names (forge and wear suffixes stripped) a battle reward or a shop sale has handed over, kept
// even after the weapon is sold or breaks. What the army holds right now counts too, which
// covers a save from before the ledger. Loot and shop draws read `ownedLegendaryNames` and leave
// those names out of their pools (the draw falls to another item of the tier), and add no draw
// when nothing is owned, so a run that owns no legendary rolls exactly as it did.

import { stripItemNameSuffix, weaponCatalogNames } from '../utils/itemNames.js';

// Legend-tier weapons only: the Legend staves (Warp Staff, Fortify) stay repeatable.
const isLegend = (item) => item?.tier === 'Legend' && item.type !== 'Staff';

/**
 * The catalog name of a Legend item: no forge/wear suffix, no imbue adjective. With the weapon
 * catalog the name is read off it (a forged, imbued copy keeps the adjective in `_baseName`).
 */
function plainName(item, allWeapons = null) {
  if (Array.isArray(allWeapons)) {
    const legends = legendaryCatalogNames(allWeapons);
    const found = weaponCatalogNames(item).find((name) => legends.has(name));
    if (found) return found;
  }
  const base = stripItemNameSuffix(item._baseName || item.name);
  return item._imbueId && !item._baseName ? base.replace(/^\S+\s+/, '') : base;
}

/** The Legend-tier weapon names a catalog holds: the only names the ledger can exclude. */
export function legendaryCatalogNames(allWeapons) {
  return new Set(
    (Array.isArray(allWeapons) ? allWeapons : []).filter(isLegend).map((weapon) => weapon.name),
  );
}

/** `names` held to the catalog's Legend weapons (a stray or corrupt entry excludes nothing). */
export function legendaryExclusions(names, allWeapons) {
  const legends = legendaryCatalogNames(allWeapons);
  return new Set([...(names || [])].filter((name) => legends.has(name)));
}

/** The ledger as saved: unique non-empty strings. Anything else is dropped. */
export function sanitizeLegendaryGrants(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((name) => typeof name === 'string' && name))];
}

/** Record a granted weapon in the run's ledger (no-op for anything but a Legend-tier item). */
export function recordLegendaryGrant(run, item) {
  if (!run || !isLegend(item) || typeof item.name !== 'string') return false;
  const name = plainName(item, run.gameData?.weapons);
  if (!name) return false;
  const ledger = sanitizeLegendaryGrants(run.legendaryGrants);
  if (!ledger.includes(name)) ledger.push(name);
  run.legendaryGrants = ledger;
  return true;
}

/** Every Legend-tier weapon the army, its fallen and the convoy hold right now. */
function heldLegendaryItems(run) {
  const held = [];
  const add = (item) => {
    if (isLegend(item) && typeof item.name === 'string') held.push(item);
  };
  const units = [
    ...(Array.isArray(run?.roster) ? run.roster : []),
    ...(Array.isArray(run?.fallenUnits) ? run.fallenUnits : []),
    ...(Array.isArray(run?.laidToRest) ? run.laidToRest : []),
  ];
  for (const unit of units) {
    if (!unit || typeof unit !== 'object') continue;
    add(unit.weapon);
    for (const item of Array.isArray(unit.inventory) ? unit.inventory : []) add(item);
  }
  for (const item of Array.isArray(run?.convoy?.weapons) ? run.convoy.weapons : []) add(item);
  return held;
}

/** Every Legend-tier base name this run has been granted or still holds. */
export function ownedLegendaryNames(run) {
  const owned = new Set(sanitizeLegendaryGrants(run?.legendaryGrants));
  for (const item of heldLegendaryItems(run))
    for (const name of weaponCatalogNames(item)) owned.add(name);
  return owned;
}

/**
 * Write what the run holds into the ledger. A save from before the ledger has none, and the
 * held-weapon scan stops protecting a legendary once it is discarded, so a load remembers the
 * ones it can see (the ones already discarded cannot be known).
 */
export function adoptHeldLegendaries(run) {
  for (const item of heldLegendaryItems(run)) recordLegendaryGrant(run, item);
}

/** True when this item is a Legend-tier weapon the run already has (granted or held). */
export function isDuplicateLegendary(run, item) {
  return (
    isLegend(item) &&
    typeof item.name === 'string' &&
    ownedLegendaryNames(run).has(plainName(item, run?.gameData?.weapons))
  );
}
