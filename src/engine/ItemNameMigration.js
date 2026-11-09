// Item renames for saved runs (the naming pass, docs/specs/item-names.md). Pure.
//
// Saves store whole item objects, and an item's name is its identity (weapon-art
// gates, loot and siege lookups, icons, fx). When items are renamed, a saved run
// still holds the old names, so RunManager.fromJSON runs migrateSavedItemNames on
// the parsed save before anything else reads it. The walk renames every item it
// finds anywhere in the save: the roster and convoy, shops, rewards, colosseum
// mercenaries, and the battle checkpoint, its entry state and its rewind timeline
// (each destination as a whole state: fromJSON decodes rewind patches before the
// walk and re-encodes them after, BattleTimeline.expandTimelinePatches). Names are
// composed ("Keen Iron Sword +2": imbue adjective, base, forge level or wear), and
// each part is renamed on its own.
//
// A save written after the renames carries itemNamesRevision, and the walk skips it.
//
// Saves outside the run hold whole items too: NG+'s Barracks (kept items, a pending ride's
// candidates, a ride log's replaced item) lives in the meta save, which has no revision of its
// own. NgPlusState renames every item it reads through renameItemNamesIn (names are pure, no
// catalog needed), and NgPlusRun refreshes a renamed item's text from the catalog when it joins a
// run (refreshRenamedItemText). The Compendium's saved discoveries map old names the same way
// (CompendiumDiscovery.discoveriesInUpgrades).

import { ITEM_NAME_SUFFIX_RE, itemNameSuffix } from '../utils/itemNames.js';
import { renameGrantedSkillSpecial } from './SkillNames.js';

/** Bump when a new rename table is added below. */
export const ITEM_NAMES_REVISION = 2;

/** Revision 1 (2026-09-26): the Armoury Grammar. Old name -> new name. */
const REVISION_1 = {
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
};

/**
 * Revision 2 (2026-09-27, rebuilt on main 2026-11-09): skills, arts, supplies, gear and staves
 * move off Fire Emblem's names. Skills are saved by id, so only the scrolls that teach them and
 * the arts (whose names battle history keeps) are renamed here; old skill names left in a saved
 * battle log stay as they were.
 */
const REVISION_2 = {
  // Scrolls, named for the skill or art they teach (skill and art ids are unchanged).
  'Sol Scroll': 'Reclaim Scroll',
  'Luna Scroll': 'Umbra Scroll',
  'Astra Scroll': 'Constellation Scroll',
  'Vantage Scroll': 'Forestall Scroll',
  'Wrath Scroll': 'Seethe Scroll',
  'Adept Scroll': 'Flurry Scroll',
  'Miracle Scroll': 'Reprieve Scroll',
  'Cancel Scroll': 'Stifle Scroll',
  'Desperation Scroll': "Death's Door Scroll",
  'Quick Riposte Scroll': 'Riposte Scroll',
  'Death Blow Scroll': 'Onslaught Scroll',
  'Darting Blow Scroll': 'Quickstep Scroll',
  'Windsweep Scroll': 'Gale Cut Scroll',
  'Grounder Scroll': 'Sweep Scroll',
  'Hexblade Scroll': 'Witchcut Scroll',
  'Dragonhaze Scroll': 'Heat Haze Scroll',
  'Knightkneeler Scroll': 'Kneebreaker Scroll',
  'Longearche Scroll': "Serpent's Reach Scroll",
  'Glowing Ember Scroll': 'Forgefire Thrust Scroll',
  'Helm Splitter Scroll': 'Helmcleaver Scroll',
  'Wild Abandon Scroll': 'Reckless Swing Scroll',
  'Rushing Blow Scroll': 'Charging Cut Scroll',
  'Armored Strike Scroll': 'Ironclad Blow Scroll',
  'Encloser Scroll': 'Pinning Shot Scroll',
  'Ward Arrow Scroll': 'Gag Arrow Scroll',
  "Hunter's Volley Scroll": "Hawk's Talons Scroll",
  'Burning Quake Scroll': 'Cinder Quake Scroll',
  'Nosferatu Scroll': 'Grave Hunger Scroll',
  'Seraphim Scroll': 'Scouring Fire Scroll',
  // Scrolls added since the first draft of this table (2026-11-09 rebuild).
  'Lifetaker Scroll': "Reaper's Due Scroll",
  'Speedtaker Scroll': 'Quickening Scroll',
  'Warding Blow Scroll': 'Warded Advance Scroll',
  'Wrath Strike Scroll': 'Grim Stroke Scroll',
  'Tempest Lance Scroll': 'Surging Thrust Scroll',
  'Hit and Run Scroll': 'Strike and Fade Scroll',
  'Curved Shot Scroll': 'Arcing Shot Scroll',
  'Heavy Draw Scroll': 'Full Draw Scroll',
  'Seal Speed Scroll': 'Hamstring Scroll',
  'Shatter Slash Scroll': 'Guardsplitter Scroll',
  'Diamond Axe Scroll': 'Adamant Cleave Scroll',
  'Break Shot Scroll': 'Joint Shot Scroll',
  'Waning Shot Scroll': 'Sapping Shot Scroll',
  'Seal Magic Scroll': 'Rattle Scroll',
  // Weapon arts: saves keep art names in battle history and activation records.
  'Wrath Strike': 'Grim Stroke',
  Grounder: 'Sweep',
  Windsweep: 'Gale Cut',
  Hexblade: 'Witchcut',
  'Seal Speed': 'Hamstring',
  'Finesse Blade': 'Deft Cut',
  Dragonhaze: 'Heat Haze',
  'Astra Strike': 'Falling Stars',
  'Tempest Lance': 'Surging Thrust',
  'Hit and Run': 'Strike and Fade',
  Knightkneeler: 'Kneebreaker',
  'Shatter Slash': 'Guardsplitter',
  'Glowing Ember': 'Forgefire Thrust',
  Longearche: "Serpent's Reach",
  'Helm Splitter': 'Helmcleaver',
  'Diamond Axe': 'Adamant Cleave',
  'Wild Abandon': 'Reckless Swing',
  'Rushing Blow': 'Charging Cut',
  'Armored Strike': 'Ironclad Blow',
  'Curved Shot': 'Arcing Shot',
  Encloser: 'Pinning Shot',
  'Ward Arrow': 'Gag Arrow',
  'Break Shot': 'Joint Shot',
  'Waning Shot': 'Sapping Shot',
  'Seal Magic': 'Rattle',
  'Heavy Draw': 'Full Draw',
  "Hunter's Volley": "Hawk's Talons",
  'Burning Quake': 'Cinder Quake',
  Nosferatu: 'Grave Hunger',
  Seraphim: 'Scouring Fire',
  'Galeforce Assault': 'Oathstorm',
  'Pavise Strike': 'Shieldwall Strike',
  // Supplies, gear and staves (owner review of the naming ledger, round two).
  Vulnerary: 'Poultice',
  'Master Seal': 'Sovereign Seal',
  'Energy Drop': 'Mightroot',
  'Spirit Dust': 'Spellstone Dust',
  'Secret Book': 'Drill Primer',
  Speedwing: 'Fleet Plume',
  Dracoshield: 'Wyrmscale',
  Talisman: 'Warding Cord',
  'Angelic Robe': 'Blessed Vestment',
  'Goddess Icon': 'Fatethread Pendant',
  'Seraph Robe': "Sisters' Mantle",
  Boots: "Courier's Boots",
  'Delphi Shield': 'Picket Buckler',
  Mend: 'Solace',
  Recover: 'Remembrance',
  Physic: 'Farcall',
  Fortify: 'Canticle',
  Restore: 'Unbinding',
  'Rescue Staff': 'Deliverance Staff',
  'Warp Staff': 'Fold Staff',
  'Sleep Staff': 'Lullaby Staff',
  'Silence Staff': 'Hush Staff',
  // Gear added since the first draft (2026-11-09 rebuild).
  'Galeforce Charm': 'Onrush Charm',
};

/**
 * Old names that are also plain words ("Restore", "Boots"): renamed only on an item (or in an
 * item-only field), never on some other named thing in a save.
 */
const PLAIN_WORD_NAMES = new Set([
  'Mend',
  'Recover',
  'Physic',
  'Fortify',
  'Restore',
  'Boots',
  'Talisman',
]);

/** Every rename, old name -> new name. No new name is another rename's old name. */
export const ITEM_RENAMES = Object.freeze({ ...REVISION_1, ...REVISION_2 });

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
const NAME_KEYS = new Set([
  'name',
  '_baseName',
  'weaponName',
  'siegeWeapon',
  'carries',
  'itemName',
  'weapon',
]);
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
 * - Without it (a history string), a first word is taken as an old imbue
 *   adjective only when the rest is a renamed item or one of `knownBases`
 *   (current catalog names): "Keen Iron Sword" becomes "Cruel Iron Sword", while
 *   "Keen Edge" (a deed) is left alone.
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
        [
          ...(gameData.weapons || []),
          ...(gameData.consumables || []),
          ...(gameData.accessories || []),
        ].map((w) => [w.name, w]),
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
        if (
          key === 'name' &&
          PLAIN_WORD_NAMES.has(value.replace(ITEM_NAME_SUFFIX_RE, '')) &&
          !isItemLike(node)
        )
          continue;
        const next = renameItemName(value, { imbueId, knownBases });
        if (next !== value) {
          node[key] = next;
          changed += 1;
          renamedHere = true;
        }
      } else if (key === 'recruitBlessingGrants' && Array.isArray(value)) {
        // "blessingId:Item Name" keys: a renamed item must not be granted twice.
        node[key] = value.map((grant) => {
          if (typeof grant !== 'string') return grant;
          const at = grant.indexOf(':');
          const next =
            at < 0 ? grant : grant.slice(0, at + 1) + renameItemName(grant.slice(at + 1));
          if (next !== grant) changed += 1;
          return next;
        });
      } else if (value && typeof value === 'object') visit(value, depth + 1);
    }
    // A weapon that grants a skill (a random legendary) names the skill in its special.
    if (isItemLike(node) && typeof node.special === 'string') {
      const next = renameGrantedSkillSpecial(node.special, gameData?.skills);
      if (next !== node.special) {
        node.special = next;
        changed += 1;
      }
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

/**
 * Rename the items of a store outside the run save (NG+'s Barracks in the meta save), in
 * place: names only, plus a granted skill's special (no catalog needed). Returns `items`.
 * Idempotent: a current name is never an old one (ITEM_RENAMES), so a second pass changes
 * nothing.
 */
export function renameItemNamesIn(items) {
  if (items && typeof items === 'object') renameItemsDeep(items);
  return items;
}

/**
 * The catalog's text (lore, a stated rule) for an item that carries a renamed item's name,
 * in place: the text renameItemsDeep would have refreshed had the catalog been at hand when
 * the name changed (an NG+ kept item joining a run). Run state is never touched.
 */
export function refreshRenamedItemText(item, gameData) {
  if (!isItemLike(item) || !gameData) return item;
  const base = String(item._baseName || item.name).replace(ITEM_NAME_SUFFIX_RE, '');
  const tail = item._imbueId ? base.slice(base.indexOf(' ') + 1) : base;
  const targets = new Set(Object.values(ITEM_RENAMES));
  if (!targets.has(tail) && !targets.has(base)) return item;
  const catalog = new Map(
    [
      ...(gameData.weapons || []),
      ...(gameData.consumables || []),
      ...(gameData.accessories || []),
    ].map((w) => [w.name, w]),
  );
  refreshFromCatalog(item, catalog);
  return item;
}
