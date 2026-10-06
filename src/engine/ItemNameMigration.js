// Item renames for saved runs (the naming pass, docs/specs/item-names.md). Pure.
//
// Saves store whole item objects, and an item's name is its identity (weapon-art
// gates, loot and siege lookups, icons, fx). When items are renamed, a saved run
// still holds the old names, so RunManager.fromJSON runs migrateSavedItemNames on
// the parsed save before anything else reads it. The walk renames every item it
// finds anywhere in the save: the roster and convoy, shops, rewards, colosseum
// mercenaries, and the battle checkpoint, its entry state and its rewind timeline
// (keyframes and patches). Names are composed ("Keen Iron Sword +2": imbue
// adjective, base, forge level or wear), and each part is renamed on its own.
//
// A save written after the renames carries itemNamesRevision, and the walk skips it.

import { ITEM_NAME_SUFFIX_RE, itemNameSuffix } from '../utils/itemNames.js';

/** Bump when a new rename table is added below. */
export const ITEM_NAMES_REVISION = 1;

/** Revision 1 (2026-09-26): the Armoury Grammar. Old name -> new name. */
export const ITEM_RENAMES = Object.freeze({
  'Killing Edge': 'Keen Sword',
  'Wo Dao': 'Jian',
  'Wind Sword': 'Gust Blade',
  'Tempest Blade': 'Gale Blade',
  Lancereaver: 'Lancehook',
  Armorslayer: 'Mailbane',
  'Levin Sword': 'Thunderbrand',
  'Venin Blade': 'Adder Blade',
  'Brave Sword': 'Oathblade',
  Gemini: 'Twinsworn',
  Soulreaver: 'Namethief',
  'Killer Lance': 'Keen Lance',
  Swordreaver: 'Axehook',
  Horseslayer: 'Horsebane',
  'Brave Lance': 'Oathlance',
  'Short Axe': 'Hatchet',
  'Killer Axe': 'Keen Axe',
  Axereaver: 'Bladehook',
  'Brave Axe': 'Oathaxe',
  Stormbreaker: 'Tidebreaker',
  'Killer Bow': 'Keen Bow',
  'Brave Bow': 'Oathbow',
  'Venin Bow': 'Adder Bow',
  Doublebow: "Hermit's Bow",
  Elfire: 'Wildfire',
  Bolganone: 'Conflagration',
  Excalibur: 'Firstwind',
  Bolting: 'Breachbolt',
  Lightning: 'Glimmer',
  Shine: 'Brilliance',
  Aura: 'Crownlight',
  Luce: 'Endword',
  'Keen Imbuing Stone': 'Cruel Imbuing Stone',
  'Sundering Imbuing Stone': 'Armorbane Imbuing Stone',
  // A legendary weapon art named for its weapon (battle history keeps art names).
  'Gemini Tempest': 'Twinsworn Tempest',
});

/** Imbue adjectives by imbue id: the old word, and the word it became. */
export const IMBUE_ADJECTIVE_RENAMES = Object.freeze({
  keen: { from: 'Keen', to: 'Cruel' },
  armorbane: { from: 'Sundering', to: 'Armorbane' },
});

const TO_BY_FROM = Object.fromEntries(
  Object.values(IMBUE_ADJECTIVE_RENAMES).map((a) => [a.from, a.to]),
);
// Every imbue adjective a saved name can start with, before and after the renames.
const IMBUE_ADJECTIVES = new Set([
  'Vampiric',
  'Venomous',
  'Binding',
  'Warded',
  ...Object.values(IMBUE_ADJECTIVE_RENAMES).flatMap((a) => [a.from, a.to]),
]);

// Keys whose string values are item names wherever they appear: item and art
// names, siege weapon names, battle-history weapon names.
const NAME_KEYS = new Set(['name', '_baseName', 'weaponName', 'siegeWeapon', 'itemName', 'weapon']);
const ITEM_TYPES = new Set([
  'Sword',
  'Lance',
  'Axe',
  'Bow',
  'Tome',
  'Light',
  'Staff',
  'Breath',
  'Scroll',
  'Consumable',
  'Accessory',
  'Whetstone',
]);

/**
 * The new name for a (possibly composed) item name, or the name unchanged.
 *
 * - "+N" forge and "-N" wear suffixes are kept.
 * - `imbueId` (the item's `_imbueId`) marks the first word as its imbue adjective,
 *   renamed when that imbue's word changed; the rest is renamed as a base.
 * - Without it (a rewind patch leaf, a history string), a first word is taken as
 *   an old imbue adjective only when the rest is a renamed item or one of
 *   `knownBases` (current catalog names): "Keen Iron Sword" becomes "Cruel Iron
 *   Sword", while "Keen Edge" (a deed) is left alone.
 */
export function renameItemName(name, { imbueId = null, knownBases = null } = {}) {
  if (typeof name !== 'string' || !name) return name;
  const suffix = itemNameSuffix(name);
  const base = suffix ? name.slice(0, -suffix.length) : name;
  if (Object.hasOwn(ITEM_RENAMES, base)) return ITEM_RENAMES[base] + suffix;
  const space = base.indexOf(' ');
  if (space < 0) return name;
  const adjective = base.slice(0, space);
  const rest = base.slice(space + 1);
  const renamedRest = Object.hasOwn(ITEM_RENAMES, rest) ? ITEM_RENAMES[rest] : null;
  let nextAdjective = adjective;
  if (imbueId) {
    const info = IMBUE_ADJECTIVE_RENAMES[imbueId];
    if (info && adjective === info.from) nextAdjective = info.to;
  } else if (IMBUE_ADJECTIVES.has(adjective) && (renamedRest || knownBases?.has(rest))) {
    nextAdjective = TO_BY_FROM[adjective] || adjective;
  } else return name;
  const next = `${nextAdjective} ${renamedRest || rest}`;
  return next === base ? name : next + suffix;
}

function isItemLike(value) {
  return typeof value?.name === 'string' && ITEM_TYPES.has(value.type);
}

/**
 * Refresh text the catalog changed along with the name (lore, and the special
 * that states the rule), leaving run state (stats, forge, imbue, uses) alone.
 * Random legendaries keep their own rolled special.
 */
function refreshFromCatalog(item, catalog) {
  if (!catalog || item._isRandomLegendary) return;
  const base = String(item._baseName || item.name).replace(ITEM_NAME_SUFFIX_RE, '');
  const entry =
    catalog.get(base) || (item._imbueId ? catalog.get(base.slice(base.indexOf(' ') + 1)) : null);
  if (!entry || entry.type !== item.type) return;
  if (typeof entry.lore === 'string') item.lore = entry.lore;
  if (typeof entry.special === 'string' && typeof item.special === 'string')
    item.special = entry.special;
}

/**
 * Rename every item name in a parsed save, in place. Returns the number of names
 * changed. `gameData` (optional) supplies the current catalog for lore/special.
 */
export function renameItemsDeep(root, gameData = null) {
  const catalog = gameData
    ? new Map(
        [...(gameData.weapons || []), ...(gameData.consumables || [])].map((w) => [w.name, w]),
      )
    : null;
  const renamedTargets = new Set(Object.values(ITEM_RENAMES));
  // Names a bare string can be an imbued form of ("Keen Iron Sword").
  const knownBases = new Set([
    ...Object.keys(ITEM_RENAMES),
    ...(gameData?.weapons || []).map((w) => w.name),
  ]);
  let changed = 0;
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 64 || seen.has(node)) return;
    seen.add(node);
    const imbueId =
      !Array.isArray(node) && typeof node._imbueId === 'string' ? node._imbueId : null;
    let renamedHere = false;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (typeof value === 'string' && NAME_KEYS.has(key)) {
        const next = renameItemName(value, { imbueId, knownBases });
        if (next !== value) {
          node[key] = next;
          changed += 1;
          renamedHere = true;
        }
      } else if (
        NAME_KEYS.has(key) &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value.$ === 'string'
      ) {
        // A rewind patch leaf: { name: { $: 'Killing Edge +1' } }.
        const next = renameItemName(value.$, { knownBases });
        if (next !== value.$) {
          value.$ = next;
          changed += 1;
        }
      } else if (value && typeof value === 'object') visit(value, depth + 1);
    }
    if (renamedHere && isItemLike(node)) {
      const base = String(node._baseName || node.name).replace(ITEM_NAME_SUFFIX_RE, '');
      const tail = node._imbueId ? base.slice(base.indexOf(' ') + 1) : base;
      if (renamedTargets.has(tail) || renamedTargets.has(base)) refreshFromCatalog(node, catalog);
    }
  };
  visit(root, 0);
  return changed;
}

/**
 * Bring a parsed save up to the current item names. Mutates and returns `saved`;
 * a save already at ITEM_NAMES_REVISION is returned untouched.
 */
export function migrateSavedItemNames(saved, gameData = null) {
  if (!saved || typeof saved !== 'object') return saved;
  if (Number(saved.itemNamesRevision) >= ITEM_NAMES_REVISION) return saved;
  renameItemsDeep(saved, gameData);
  saved.itemNamesRevision = ITEM_NAMES_REVISION;
  return saved;
}
