// LegendaryOwnership.js - one Legend-tier weapon per run.
//
// A legendary weapon is granted at most once a run: `run.legendaryGrants` is the ledger of base
// names (forge and wear suffixes stripped) a battle reward or a shop sale has handed over, kept
// even after the weapon is sold or breaks. What the army holds right now counts too, which
// covers a save from before the ledger. Loot and shop draws read `ownedLegendaryNames` and leave
// those names out of their pools (the draw falls to another item of the tier), and add no draw
// when nothing is owned, so a run that owns no legendary rolls exactly as it did.

import { stripItemNameSuffix } from '../utils/itemNames.js';

const isLegend = (item) => item?.tier === 'Legend';

/** The ledger as saved: unique non-empty strings. Anything else is dropped. */
export function sanitizeLegendaryGrants(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((name) => typeof name === 'string' && name))];
}

/** Record a granted weapon in the run's ledger (no-op for anything but a Legend-tier item). */
export function recordLegendaryGrant(run, item) {
  if (!run || !isLegend(item) || typeof item.name !== 'string') return false;
  const name = stripItemNameSuffix(item.name);
  if (!name) return false;
  const ledger = sanitizeLegendaryGrants(run.legendaryGrants);
  if (!ledger.includes(name)) ledger.push(name);
  run.legendaryGrants = ledger;
  return true;
}

/** Every Legend-tier base name this run has been granted or still holds. */
export function ownedLegendaryNames(run) {
  const owned = new Set(sanitizeLegendaryGrants(run?.legendaryGrants));
  const add = (item) => {
    if (isLegend(item) && typeof item.name === 'string') owned.add(stripItemNameSuffix(item.name));
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
  return owned;
}

/** True when this item is a Legend-tier weapon the run already has (granted or held). */
export function isDuplicateLegendary(run, item) {
  return (
    isLegend(item) &&
    typeof item.name === 'string' &&
    ownedLegendaryNames(run).has(stripItemNameSuffix(item.name))
  );
}
