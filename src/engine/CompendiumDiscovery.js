// CompendiumDiscovery.js — which items and skills this save has met (pure, no Phaser,
// no storage).
//
// The Compendium's Arms, Items and Skills entries stay "???" until the save has met
// them: offered (a battle reward's choices, a shop's stock), owned (a unit's bag, the
// convoy, the accessory and scroll stores, a unit's skills) or used against the army
// (a foe's weapon and skills in an exchange, a foe's status staff). Items are kept by
// their catalog name (a forge's "+N", a wear's "-N" and an imbue's adjective are run
// state, not identity; an old save's pre-rename name counts as its new one), skills by
// id. MetaProgressionManager keeps the two lists (`itemsSeen`, `skillsSeen`) in memory;
// this module holds the rules it, the cross-slot reader (SlotManager) and the cloud
// merge share.
//
// Saved, the lists live inside `purchasedUpgrades` as one key per entry
// (`__seen_item:<name>` / `__seen_skill:<id>`, value 0), never as fields of their own.
// A build from before them (a lagging app, a stale tab) writes a fixed list of meta
// fields and would drop new ones on every save and push that copy to the cloud; it
// copies `purchasedUpgrades` whole on load, keeps its unknown keys when it saves or
// max-merges it, and reads only the ids its own data lists (the balance-revision marker
// rides there for the same reason). A value of 0 adds nothing to any older build's
// "upgrades owned" sum. Every load also unions the backfill from the save's records,
// so a copy that lost keys can only lose what nothing else remembers.

import { stripItemNameSuffix } from '../utils/itemNames.js';
import { ITEM_RENAMES } from './ItemNameMigration.js';
import { boundSkillOf } from './EffectiveSkills.js';

const MAX_ENTRY_LENGTH = 80;
/** A bound on each list; the catalogs hold a few hundred entries. */
export const MAX_DISCOVERIES = 2000;

function validEntry(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_ENTRY_LENGTH;
}

/** Names or ids as a sorted, de-duplicated list (unions any number of lists). */
export function mergeSeen(...lists) {
  const seen = new Set();
  for (const list of lists)
    for (const value of Array.isArray(list) ? list : []) if (validEntry(value)) seen.add(value);
  return [...seen].sort().slice(0, MAX_DISCOVERIES);
}

/** An empty discovery record. */
export function emptyDiscoveries() {
  return { items: [], skills: [] };
}

/** Two or more `{ items, skills }` records as one. */
export function mergeDiscoveries(...records) {
  return {
    items: mergeSeen(...records.map((r) => r?.items)),
    skills: mergeSeen(...records.map((r) => r?.skills)),
  };
}

/**
 * The catalog name an item instance answers to: its base name without a forge's "+N" or
 * a wear's "-N", without an imbue's adjective (one word: "Vampiric Iron Sword"), and
 * renamed when the naming pass renamed it (ItemNameMigration's ITEM_RENAMES: an old
 * victory record or an unmigrated run save still says "Killing Edge").
 */
export function itemCatalogNames(item) {
  if (!item || typeof item !== 'object') return [];
  const names = new Set();
  for (const raw of [item._baseName, item.name]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    let name = stripItemNameSuffix(raw.trim());
    if (item._imbueId) name = name.replace(/^\S+\s+/, '');
    if (!name) continue;
    names.add(Object.hasOwn(ITEM_RENAMES, name) ? ITEM_RENAMES[name] : name);
  }
  return [...names];
}

/** Where each list is kept inside a saved `purchasedUpgrades` (see the header). */
export const SEEN_ITEM_KEY = '__seen_item:';
export const SEEN_SKILL_KEY = '__seen_skill:';

/** Is this `purchasedUpgrades` key a discovery rather than an upgrade id? */
export function isDiscoveryKey(key) {
  return (
    typeof key === 'string' && (key.startsWith(SEEN_ITEM_KEY) || key.startsWith(SEEN_SKILL_KEY))
  );
}

/** The discoveries a saved `purchasedUpgrades` carries. */
export function discoveriesInUpgrades(purchasedUpgrades) {
  if (!purchasedUpgrades || typeof purchasedUpgrades !== 'object') return emptyDiscoveries();
  const items = [];
  const skills = [];
  for (const key of Object.keys(purchasedUpgrades)) {
    if (key.startsWith(SEEN_ITEM_KEY)) items.push(key.slice(SEEN_ITEM_KEY.length));
    else if (key.startsWith(SEEN_SKILL_KEY)) skills.push(key.slice(SEEN_SKILL_KEY.length));
  }
  return { items: mergeSeen(items), skills: mergeSeen(skills) };
}

/** `purchasedUpgrades` without its discovery keys (the in-memory shape). */
export function withoutDiscoveryKeys(purchasedUpgrades) {
  const upgrades = {};
  if (!purchasedUpgrades || typeof purchasedUpgrades !== 'object') return upgrades;
  for (const [key, value] of Object.entries(purchasedUpgrades))
    if (!isDiscoveryKey(key)) upgrades[key] = value;
  return upgrades;
}

/** `purchasedUpgrades` as saved: the upgrades, then one key (value 0) per discovery. */
export function withDiscoveryKeys(purchasedUpgrades, found) {
  const saved = withoutDiscoveryKeys(purchasedUpgrades);
  for (const name of mergeSeen(found?.items)) saved[SEEN_ITEM_KEY + name] = 0;
  for (const id of mergeSeen(found?.skills)) saved[SEEN_SKILL_KEY + id] = 0;
  return saved;
}

/** Collects items and the skills they name (a scroll's lesson, a ring's bound skill). */
function collector() {
  const items = [];
  const skills = [];
  const addSkill = (id) => {
    if (validEntry(id)) skills.push(id);
  };
  const addItem = (item) => {
    if (!item || typeof item !== 'object') return;
    items.push(...itemCatalogNames(item));
    addSkill(item.skillId);
    addSkill(boundSkillOf(item));
  };
  const addItems = (list) => {
    for (const item of Array.isArray(list) ? list : []) addItem(item);
  };
  const addUnit = (unit, { kit = 'all' } = {}) => {
    if (!unit || typeof unit !== 'object') return;
    addItem(unit.weapon);
    addItem(unit.accessory);
    if (kit === 'all') {
      addItems(unit.inventory);
      addItems(unit.consumables);
    }
    for (const list of [unit.skills, unit.benchedSkills])
      for (const id of Array.isArray(list) ? list : []) addSkill(id);
  };
  return {
    addItem,
    addItems,
    addSkill,
    addUnit,
    result: () => ({ items: mergeSeen(items), skills: mergeSeen(skills) }),
  };
}

/** Items in a saved shop state (`{ items: [{ item, ... }] }`). */
function shopStateItems(state) {
  return (Array.isArray(state?.items) ? state.items : []).map((entry) => entry?.item ?? entry);
}

/**
 * What a run (a RunManager or its saved JSON) shows the player: every unit's kit and
 * skills (the living and the fallen), the convoy, the accessory and scroll stores, an
 * unclaimed battle reward's choices and every shop's stock.
 * @returns {{ items: string[], skills: string[] }}
 */
export function discoveriesInRun(run) {
  if (!run || typeof run !== 'object') return emptyDiscoveries();
  const c = collector();
  for (const pool of [run.roster, run.fallenUnits, run.laidToRest])
    for (const unit of Array.isArray(pool) ? pool : []) c.addUnit(unit);
  c.addItems(run.convoy?.weapons);
  c.addItems(run.convoy?.consumables);
  c.addItems(run.accessories);
  c.addItems(run.scrolls);
  for (const choice of Array.isArray(run.pendingBattleReward?.choices)
    ? run.pendingBattleReward.choices
    : [])
    c.addItem(choice?.item);
  const shops = run.shopStateByNodeId && typeof run.shopStateByNodeId === 'object';
  for (const state of shops ? Object.values(run.shopStateByNodeId) : [])
    c.addItems(shopStateItems(state));
  c.addItems(shopStateItems(run.activeCaravanShop?.shopState));
  return c.result();
}

/**
 * What a foe shows in an exchange or with its staff: the weapon in its hands, its
 * accessory and its skills (its bag stays unseen).
 */
export function discoveriesOfFoes(units) {
  const c = collector();
  for (const unit of Array.isArray(units) ? units : [])
    if (unit?.faction === 'enemy') c.addUnit(unit, { kit: 'held' });
  return c.result();
}

/**
 * The items and skills a meta save from before the lists had evidently met: its
 * victory records' survivors (weapon, items, accessory, skills) and the skills it
 * assigned to its lords. The slot's in-progress run is added by the caller.
 */
export function discoveriesFromMetaSave(saved) {
  if (!saved || typeof saved !== 'object') return emptyDiscoveries();
  const c = collector();
  for (const record of Array.isArray(saved.runRecords) ? saved.runRecords : [])
    for (const unit of Array.isArray(record?.roster) ? record.roster : []) {
      if (!unit || typeof unit !== 'object') continue;
      for (const name of [
        unit.weapon,
        unit.accessory,
        ...(Array.isArray(unit.items) ? unit.items : []),
      ])
        if (validEntry(name)) c.addItem({ name });
      for (const id of Array.isArray(unit.skills) ? unit.skills : []) c.addSkill(id);
    }
  const assigned = saved.skillAssignments;
  if (assigned && typeof assigned === 'object')
    for (const ids of Object.values(assigned))
      for (const id of Array.isArray(ids) ? ids : []) c.addSkill(id);
  return c.result();
}

/**
 * A meta save's discoveries: the keys in its `purchasedUpgrades`, always unioned with the
 * backfill from its records (a copy an older build or a lost write left without keys
 * still knows what its records show).
 */
export function discoveriesOfMetaSave(saved) {
  return mergeDiscoveries(
    discoveriesInUpgrades(saved?.purchasedUpgrades),
    discoveriesFromMetaSave(saved),
  );
}

function record(meta, found) {
  if (typeof meta?.recordDiscoveries !== 'function') return false;
  try {
    return meta.recordDiscoveries(found) === true;
  } catch (err) {
    console.warn('[CompendiumDiscovery] could not record discoveries:', err?.message || err);
    return false;
  }
}

/**
 * Remember what a run shows as met on this save (a MetaProgressionManager; idempotent,
 * writes only when something is new). Called beside each run save.
 * @returns {boolean} whether anything was new
 */
export function recordRunDiscoveries(meta, run) {
  return record(meta, discoveriesInRun(run));
}

/** Remember the foes among `units` (an exchange's two sides, a staff's caster). */
export function recordFoesEncountered(meta, units) {
  return record(meta, discoveriesOfFoes(units));
}

/**
 * The Compendium's view of discoveries: `isItemSeen(entry)` / `isSkillSeen(entry)` for a
 * catalog entry. `all: true` shows everything (a view with nothing to gate it).
 */
export function discoveryView({ items = [], skills = [], all = false } = {}) {
  const itemSet = new Set(items);
  const skillSet = new Set(skills);
  return {
    all,
    isItemSeen: (entry) => all || itemSet.has(entry?.name),
    isSkillSeen: (entry) => all || skillSet.has(entry?.id),
  };
}
