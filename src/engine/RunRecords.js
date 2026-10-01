import { specialCharacterDefinition } from './SpecialCharacterPolicy.js';
import { isDifficultyId } from './DifficultyEngine.js';
import { DEED_FORMS, unitEpithet } from './DeedTitles.js';
import { CONSUMABLE_MAX, INVENTORY_MAX, MAX_SKILLS, XP_STAT_NAMES } from '../utils/constants.js';

// Victory records ("Records" on the title screen): display snapshots of won runs,
// never live units or inventory objects. Stored whole in each slot's meta save and its
// cloud copy, so every field passes through mergeRunRecords — a field it does not
// name is dropped on load, merge and sync.
//
// Schema v2 (additive; a v1 record has no `v` and only the identity fields):
//   v: 2
//   roster[]: identity + tally {kills, bossKills, crits, healed, battles}
//             + (detail) stats [XP_STAT_NAMES order, HP is max HP], weapon, items,
//               accessory, skills (ids), deeds (ids, title first)
//   fallen[]: identity + tally + fellAt {act, battle}
// Identity: name, className, level, isLord, specialCharId, tier, portraitVariant,
// epithet, epithetForm. Detail is kept on the newest DETAILED_RUN_RECORDS of a slot;
// older records are trimmed to identity + tally (deterministic and idempotent).

export const RUN_RECORD_VERSION = 2;
export const MAX_RUN_RECORDS = 50;
export const DETAILED_RUN_RECORDS = 15;
export const MAX_RECORD_UNITS = 20;
export const MAX_RECORD_FALLEN = 20;
/** Everything a unit can carry besides the equipped weapon. */
export const MAX_RECORD_ITEMS = INVENTORY_MAX - 1 + CONSUMABLE_MAX;
export const MAX_RECORD_DEEDS = 6;
/** Stat order of `stats` (HP is the unit's max HP). */
export const RECORD_STAT_NAMES = Object.freeze([...XP_STAT_NAMES]);
export const RECORD_TALLY_KEYS = Object.freeze([
  'kills',
  'bossKills',
  'crits',
  'healed',
  'battles',
]);
const DETAIL_KEYS = Object.freeze(['stats', 'weapon', 'items', 'accessory', 'skills', 'deeds']);

const MAX_STAT = 999;
const MAX_TALLY = 999_999;
const ID_PATTERN = /^[a-z0-9_]{1,64}$/;
const ACT_PATTERN = /^[A-Za-z0-9_]{1,32}$/;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function cleanText(value, max = 80) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function cleanNames(list, max) {
  if (!Array.isArray(list)) return [];
  return list
    .map((name) => cleanText(name))
    .filter(Boolean)
    .slice(0, max);
}

function cleanIds(list, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const id of list) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id) || out.includes(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

/** Eight whole stats in RECORD_STAT_NAMES order, or null. */
function cleanStats(raw) {
  if (!Array.isArray(raw) || raw.length !== RECORD_STAT_NAMES.length) return null;
  if (!raw.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return raw.map((n) => Math.max(0, Math.min(MAX_STAT, Math.trunc(n))));
}

/** Positive counters only, in RECORD_TALLY_KEYS order; null when all are zero. */
function cleanTally(raw) {
  if (!isObject(raw)) return null;
  const out = {};
  for (const key of RECORD_TALLY_KEYS) {
    const n = Number(raw[key]);
    if (!Number.isFinite(n)) continue;
    const v = Math.max(0, Math.min(MAX_TALLY, Math.trunc(n)));
    if (v > 0) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

function cleanFellAt(raw) {
  if (!isObject(raw)) return null;
  const act = typeof raw.act === 'string' && ACT_PATTERN.test(raw.act) ? raw.act : null;
  const battle =
    Number.isFinite(raw.battle) && raw.battle >= 1 ? Math.min(9999, Math.trunc(raw.battle)) : null;
  return act || battle ? { act, battle } : null;
}

/** The v1 fields of a unit snapshot (fixed key order: records compare as JSON). */
function cleanIdentity(u) {
  return {
    name: u.name.slice(0, 80),
    className: String(u.className || '').slice(0, 80),
    level: Math.max(1, Math.trunc(u.level) || 1),
    isLord: u.isLord === true,
    ...(specialCharacterDefinition(u) ? { specialCharId: u.specialCharId } : {}),
    // A title earned on the march (Deeds & Epithets); absent on older records.
    ...(typeof u.epithet === 'string' && u.epithet.trim()
      ? {
          epithet: u.epithet.trim().slice(0, 80),
          epithetForm: DEED_FORMS.includes(u.epithetForm) ? u.epithetForm : 'the',
        }
      : {}),
    // Optional (records from before portrait variety have neither).
    ...(u.tier === 'promoted' ? { tier: 'promoted' } : {}),
    ...(typeof u.portraitVariant === 'string' && /^[a-z0-9_]{1,64}$/.test(u.portraitVariant)
      ? { portraitVariant: u.portraitVariant }
      : {}),
  };
}

function cleanSurvivor(u, v2) {
  const out = cleanIdentity(u);
  if (!v2) return out;
  const tally = cleanTally(u.tally);
  if (tally) out.tally = tally;
  const stats = cleanStats(u.stats);
  if (stats) out.stats = stats;
  const weapon = cleanText(u.weapon);
  if (weapon) out.weapon = weapon;
  const items = cleanNames(u.items, MAX_RECORD_ITEMS);
  if (items.length) out.items = items;
  const accessory = cleanText(u.accessory);
  if (accessory) out.accessory = accessory;
  const skills = cleanIds(u.skills, MAX_SKILLS);
  if (skills.length) out.skills = skills;
  const deeds = cleanIds(u.deeds, MAX_RECORD_DEEDS);
  if (deeds.length) out.deeds = deeds;
  return out;
}

function cleanFallen(u) {
  const out = cleanIdentity(u);
  const tally = cleanTally(u.tally);
  if (tally) out.tally = tally;
  const fellAt = cleanFellAt(u.fellAt);
  if (fellAt) out.fellAt = fellAt;
  return out;
}

const validUnits = (list, max) =>
  (Array.isArray(list) ? list : [])
    .slice(0, max)
    .filter((u) => isObject(u) && typeof u.name === 'string');

function cleanRecord(record) {
  const v2 = Number.isInteger(record.v) && record.v >= RUN_RECORD_VERSION;
  return {
    ...(v2 ? { v: RUN_RECORD_VERSION } : {}),
    id: record.id.slice(0, 160),
    endedAt: Number.isFinite(record.endedAt) ? record.endedAt : 0,
    difficulty: isDifficultyId(record.difficulty) ? record.difficulty : 'normal',
    ...(record.noMetaMode === true ? { noMetaMode: true } : {}),
    seed: Number.isFinite(record.seed) ? record.seed : null,
    actsCleared: Math.max(0, Math.trunc(record.actsCleared) || 0),
    totalTurns: Number.isFinite(record.totalTurns)
      ? Math.max(0, Math.trunc(record.totalTurns))
      : null,
    // The Eclipse's final shadow (null for runs before it or with it off).
    shadow: Number.isFinite(record.shadow)
      ? Math.max(0, Math.min(1000, Math.trunc(record.shadow)))
      : null,
    roster: validUnits(record.roster, MAX_RECORD_UNITS).map((u) => cleanSurvivor(u, v2)),
    ...(v2 ? { fallen: validUnits(record.fallen, MAX_RECORD_FALLEN).map(cleanFallen) } : {}),
  };
}

/**
 * An older record kept lean: survivors keep identity + tally, the fallen keep who they
 * were and where they fell. Stable under a second pass.
 */
function trimRecord(record) {
  if (!record.v) return record;
  return {
    ...record,
    roster: record.roster.map((u) => {
      const out = { ...u };
      for (const key of DETAIL_KEYS) delete out[key];
      return out;
    }),
    fallen: record.fallen.map((u) => ({
      name: u.name,
      className: u.className,
      level: u.level,
      isLord: u.isLord,
      ...(u.fellAt ? { fellAt: u.fellAt } : {}),
    })),
  };
}

/**
 * Which copy of one run to keep when sources disagree: the newer schema (an older
 * client's stripped copy never wins), then the later end, then the richer copy (a
 * trimmed copy never replaces a detailed one), then a stable content order so the
 * merge does not depend on which source came first.
 */
function preferred(a, b) {
  const va = a.v || 1;
  const vb = b.v || 1;
  if (va !== vb) return va > vb ? a : b;
  // Copies of one run share its end time; legacy ids (from the seed) can name two runs.
  if (a.endedAt !== b.endedAt) return a.endedAt > b.endedAt ? a : b;
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  // Detail only ever adds fields, so the longer copy of a run is the richer one.
  if (ja.length !== jb.length) return ja.length > jb.length ? a : b;
  return ja >= jb ? a : b;
}

/**
 * Union of victory records from any sources (local, cloud, a fresh win): each run once,
 * newest MAX_RUN_RECORDS kept, survivor detail kept on the newest DETAILED_RUN_RECORDS.
 * Pure, deterministic and idempotent (merge(merge(x)) equals merge(x)).
 */
export function mergeRunRecords(...sources) {
  const byId = new Map();
  for (const record of sources.flat()) {
    if (!isObject(record) || typeof record.id !== 'string' || !record.id) continue;
    const clean = cleanRecord(record);
    const held = byId.get(clean.id);
    byId.set(clean.id, held ? preferred(held, clean) : clean);
  }
  return [...byId.values()]
    .sort((a, b) => b.endedAt - a.endedAt || a.id.localeCompare(b.id))
    .slice(0, MAX_RUN_RECORDS)
    .map((record, index) => (index < DETAILED_RUN_RECORDS ? record : trimRecord(record)));
}

// ── Writer helpers (RunManager builds a won run's record from these) ──────────

function itemName(item) {
  return typeof item?.name === 'string' ? item.name : '';
}

/** Run tallies of a unit's deeds as a record tally (null when it has none). */
export function unitRecordTally(unit) {
  const stats = isObject(unit?.deeds?.stats) ? unit.deeds.stats : {};
  return cleanTally(stats);
}

function unitIdentity(unit) {
  const epithet = unitEpithet(unit);
  return {
    name: unit.name,
    className: unit.className,
    level: unit.level,
    isLord: unit.isLord,
    specialCharId: unit.specialCharId,
    tier: unit.tier,
    portraitVariant: unit.portraitVariant, // the face the unit wore (portrait variety)
    ...(epithet ? { epithet: epithet.text, epithetForm: epithet.form } : {}),
  };
}

/** Earned deed ids, the displayed title first, then newest. */
function recordDeedIds(unit) {
  const earned = Array.isArray(unit?.deeds?.earned) ? unit.deeds.earned : [];
  const titleId = unitEpithet(unit)?.id;
  return [...earned]
    .filter((e) => typeof e?.id === 'string')
    .sort(
      (a, b) =>
        (b.id === titleId) - (a.id === titleId) || (Number(b.seq) || 0) - (Number(a.seq) || 0),
    )
    .map((e) => e.id);
}

/** A surviving unit's snapshot for a v2 record (sanitized again by mergeRunRecords). */
export function survivorRecord(unit) {
  const weapon = unit?.weapon && typeof unit.weapon === 'object' ? unit.weapon : null;
  const inventory = Array.isArray(unit?.inventory) ? unit.inventory.filter(Boolean) : [];
  // The equipped weapon is one of the inventory's entries: list it once, as the weapon.
  let equipped = weapon ? inventory.indexOf(weapon) : -1;
  if (equipped === -1 && weapon)
    equipped = inventory.findIndex(
      (item) => (weapon.uid && item.uid === weapon.uid) || itemName(item) === itemName(weapon),
    );
  const carried = [
    ...inventory.filter((_, i) => i !== equipped),
    ...(Array.isArray(unit?.consumables) ? unit.consumables.filter(Boolean) : []),
  ];
  const stats = isObject(unit?.stats) ? unit.stats : {};
  return {
    ...unitIdentity(unit),
    tally: unitRecordTally(unit),
    stats: RECORD_STAT_NAMES.map((stat) => Number(stats[stat]) || 0),
    weapon: itemName(weapon),
    items: carried.map(itemName).filter(Boolean),
    accessory: itemName(unit?.accessory),
    skills: Array.isArray(unit?.skills) ? unit.skills.filter((id) => typeof id === 'string') : [],
    deeds: recordDeedIds(unit),
  };
}

/** A fallen unit's snapshot: who, their tallies, and where they fell (`unit.fellAt`). */
export function fallenRecord(unit) {
  return { ...unitIdentity(unit), tally: unitRecordTally(unit), fellAt: unit?.fellAt ?? null };
}

/**
 * Who of the fallen a record keeps (at most MAX_RECORD_FALLEN): every lord, then the
 * rest in the order they fell; the list stays in the order they fell.
 */
export function fallenForRecord(fallen) {
  const list = (Array.isArray(fallen) ? fallen : []).filter(
    (u) => isObject(u) && typeof u.name === 'string' && !u.isCaravan,
  );
  if (list.length <= MAX_RECORD_FALLEN) return list;
  const keep = new Set(
    [...list.filter((u) => u.isLord), ...list.filter((u) => !u.isLord)].slice(0, MAX_RECORD_FALLEN),
  );
  return list.filter((u) => keep.has(u));
}
