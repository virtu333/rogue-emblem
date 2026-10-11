// CompendiumDiscovery.js — which items and skills this save has met (pure, no Phaser,
// no storage).
//
// The Compendium's Arms, Items and Skills entries stay "???" until the save has met
// them: offered (a battle reward's choices, a shop's stock), owned (a unit's bag, the
// convoy, the accessory and scroll stores, a unit's skills) or used against the army
// (a foe's weapon and skills in an exchange, a foe's status staff). Items are kept by
// their catalog name (a forge's "+N", a wear's "-N" and an imbue's adjective are run
// state, not identity), skills by id. MetaProgressionManager keeps the two lists
// (`itemsSeen`, `skillsSeen`); this module holds the rules it, the cross-slot reader
// (SlotManager) and the cloud merge share.

import { stripItemNameSuffix, weaponCatalogNames } from '../utils/itemNames.js';
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

/** The catalog names an item instance answers to. */
export function itemCatalogNames(item) {
  if (!item || typeof item !== 'object') return [];
  // A forged or worn name ("Iron Sword +2") is never a catalog name; its base is.
  return weaponCatalogNames(item).filter((name) => name === stripItemNameSuffix(name));
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
      for (const name of [unit.weapon, unit.accessory, ...(unit.items || [])])
        if (validEntry(name)) c.addItem({ name });
      for (const id of Array.isArray(unit.skills) ? unit.skills : []) c.addSkill(id);
    }
  const assigned = saved.skillAssignments;
  if (assigned && typeof assigned === 'object')
    for (const ids of Object.values(assigned))
      for (const id of Array.isArray(ids) ? ids : []) c.addSkill(id);
  return c.result();
}

/** A meta save's discoveries: its lists when it has them, else the backfill. */
export function discoveriesOfMetaSave(saved) {
  if (Array.isArray(saved?.itemsSeen) || Array.isArray(saved?.skillsSeen))
    return { items: mergeSeen(saved.itemsSeen), skills: mergeSeen(saved.skillsSeen) };
  return discoveriesFromMetaSave(saved);
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
