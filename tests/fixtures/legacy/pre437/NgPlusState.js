// NgPlusState.js - NG+ on a save slot (docs/specs/ng-plus.md): the unlock's terms, the
// Barracks, the "Who rides again?" pick and the veterans brought into the next NG+ run.
//
// Pure: no Phaser, no storage, no RNG, no game data. MetaProgressionManager holds one state
// (`meta.ngPlus`, saved as its own key) and calls these to read and change it; the run side
// (who is a candidate, what a veteran comes back as) is engine/NgPlusRun.js.
//
//   state = {
//     v: 1,
//     rev,          // bumped on every change (a change count; the adopt-merge takes the newer
//                   //   write whole, adoptNgPlusState)
//     barracks,     // records: a lord's ({ id: 'lord:<name>', kind: 'lord', name, keptSkills,
//                   //   keptItems, rides, rideLog }) or a recruit's (also className (base),
//                   //   growths, traits, traitAttackStat, markId, portraitVariant). `rideLog`
//                   //   is each ride's keeps, newest last, so a lost run can take back the
//                   //   commander's latest ride (undoLastRide)
//     bring,        // up to bringLimitFor(Barracks Wing) recruit record ids for the next NG+ run
//     pendingRide,  // the last eligible win's survivors, until picked or passed:
//                   //   { runId, difficultyId, endedAt, candidates: [candidate], picked: [ref] }
//                   //   (`picked`: the refs already sent to the Barracks from this ride; the
//                   //   ride stays open until every slot is filled or the player is done)
//     wins,         // NG+ runs won on this slot (the cycle, phase 2)
//   }
//
// Invariant: a kept item's uid has exactly one owner across the Barracks. A pick refuses an
// item another record keeps (`kept_by_other`), normalization drops a later record's copy and
// a run start installs each uid once, so an heirloom traded to another veteran during a run
// can never be kept twice.
//
// A candidate is what NgPlusRun.rideCandidates read off a surviving unit: { ref, kind, name,
// className, level, tier, recordId, identity (a recruit's), items, skills, skillKinds }.
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../../../../src/utils/constants.js';

export const NG_PLUS_STATE_VERSION = 1;
/** purchasedUpgrades key of the unlock (max-merged with the upgrades, so never lost). */
export const NG_PLUS_UNLOCK_KEY = 'ng_plus';
export const NG_PLUS_COST = Object.freeze({ valor: 1750, supply: 1750 });
/** A Black Sun win opens the unlock. */
export const NG_PLUS_MILESTONE = 'beatLunatic';
/** The rungs an NG+ run is played on, and whose wins offer "Who rides again?". */
export const NG_PLUS_RUNGS = Object.freeze(['hard', 'lunatic']);
export const RIDE_LORD_PICKS = 1;
export const RIDE_RECRUIT_PICKS = 2;
/** Recruit veterans an NG+ run brings before any Barracks Wing tier. */
export const BRING_LIMIT = 2;

/**
 * The NG+ tab's own upgrades: repeatable currency sinks, bought with both currencies once NG+
 * is unlocked and never refunded. Tier n (from 1) costs `base + step * (n - 1)` of each, up to
 * `maxTier`. The tier is stored in `purchasedUpgrades[key]` beside the unlock (so the cloud
 * and the adopt-merge max-merge it, and an older client keeps it untouched). A tier adds one:
 * Barracks Wing a recruit veteran to bring, Seer's Lantern a Vision charge in every run.
 */
export const NG_PLUS_UPGRADES = Object.freeze({
  barracks_wing: Object.freeze({
    id: 'barracks_wing',
    key: 'ng_plus_barracks_wing',
    name: 'Barracks Wing',
    base: 800,
    step: 400,
    maxTier: 4,
  }),
  seers_lantern: Object.freeze({
    id: 'seers_lantern',
    key: 'ng_plus_seers_lantern',
    name: 'Seer’s Lantern',
    base: 600,
    step: 400,
    maxTier: 5,
  }),
});
export const NG_PLUS_UPGRADE_IDS = Object.freeze(Object.keys(NG_PLUS_UPGRADES));

/** An upgrade's tier from its stored level, clamped to the tiers that exist. */
export function ngPlusUpgradeTier(id, storedLevel) {
  const upgrade = NG_PLUS_UPGRADES[id];
  if (!upgrade) return 0;
  return Math.min(upgrade.maxTier, count(storedLevel));
}

/** The price of an upgrade's next tier, or null at its last. */
export function ngPlusUpgradeNextCost(id, tier) {
  const upgrade = NG_PLUS_UPGRADES[id];
  const t = count(tier);
  if (!upgrade || t >= upgrade.maxTier) return null;
  const price = upgrade.base + upgrade.step * t;
  return { valor: price, supply: price };
}

/** Recruit veterans an NG+ run brings at a Barracks Wing tier. */
export function bringLimitFor(barracksWingTier) {
  return BRING_LIMIT + ngPlusUpgradeTier('barracks_wing', barracksWingTier);
}

/** The most any slot can bring (every Barracks Wing tier): what a saved Bring list keeps. */
export const MAX_BRING_LIMIT = BRING_LIMIT + NG_PLUS_UPGRADES.barracks_wing.maxTier;

/** Vision charges Seer's Lantern adds to every run at a tier. */
export function ngPlusVisionBonus(seersLanternTier) {
  return ngPlusUpgradeTier('seers_lantern', seersLanternTier);
}

/** What one character may hold across runs: kept skills by slot kind, kept items by kind. */
export const KEPT_SKILL_CAPS = Object.freeze({ skill: 10, ability: 5 });
/** How many rides a record remembers for undoLastRide (older ones can no longer be undone). */
export const RIDE_LOG_LIMIT = 30;
export const KEPT_ITEM_CAPS = Object.freeze({
  weapon: INVENTORY_MAX,
  consumable: CONSUMABLE_MAX,
  accessory: 1,
});

const isRecord = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isName = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 160;
const count = (v) => Math.max(0, Math.floor(Number(v) || 0));

export function defaultNgPlusState() {
  return { v: NG_PLUS_STATE_VERSION, rev: 0, barracks: [], bring: [], pendingRide: null, wins: 0 };
}

/** True for a rung an NG+ run is played on. */
export function isNgPlusRung(difficultyId) {
  return NG_PLUS_RUNGS.includes(difficultyId);
}

/** Which of a character's item caps an item counts in, or null (not a bag item). */
export function keptItemKind(item) {
  if (!isRecord(item) || !isName(item.name)) return null;
  if (item.type === 'Accessory') return 'accessory';
  if (item.type === 'Consumable') return 'consumable';
  if (item.type === 'Scroll') return null;
  return 'weapon';
}

const sanitizeItems = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .filter((item) => keptItemKind(item) && isId(item.uid))
    .map((item) => structuredClone(item));

const sanitizeSkillIds = (raw) => [...new Set((Array.isArray(raw) ? raw : []).filter(isName))];

const sanitizeKinds = (raw, ids) => {
  const out = {};
  for (const id of ids) out[id] = raw?.[id] === 'ability' ? 'ability' : 'skill';
  return out;
};

function sanitizeGrowths(raw) {
  if (!isRecord(raw)) return null;
  const out = {};
  for (const [stat, value] of Object.entries(raw))
    if (isName(stat) && Number.isFinite(value)) out[stat] = Math.round(value);
  return Object.keys(out).length ? out : null;
}

/** A recruit's identity: what comes back at a fresh level. Null when unusable. */
function sanitizeIdentity(raw) {
  if (!isRecord(raw) || !isName(raw.className)) return null;
  const growths = sanitizeGrowths(raw.growths);
  if (!growths) return null;
  return {
    className: raw.className,
    growths,
    traits: sanitizeSkillIds(raw.traits),
    traitAttackStat:
      raw.traitAttackStat === 'STR' || raw.traitAttackStat === 'MAG' ? raw.traitAttackStat : null,
    markId: isName(raw.markId) ? raw.markId : null,
    portraitVariant: raw.portraitVariant ?? null,
  };
}

const sanitizeItem = (raw) => (keptItemKind(raw) && isId(raw.uid) ? structuredClone(raw) : null);

/** One ride's keeps on a record (what undoLastRide takes back), or null. */
function sanitizeRideEntry(raw) {
  if (!isRecord(raw)) return null;
  const kindOf = (v) => (v === 'ability' ? 'ability' : 'skill');
  return {
    skillId: isName(raw.skillId) ? raw.skillId : null,
    itemUid: isId(raw.itemUid) ? raw.itemUid : null,
    replacedSkillId: isName(raw.replacedSkillId) ? raw.replacedSkillId : null,
    replacedSkillKind: kindOf(raw.replacedSkillKind),
    replacedItem: sanitizeItem(raw.replacedItem),
  };
}

const sanitizeRideLog = (raw) =>
  (Array.isArray(raw) ? raw : []).map(sanitizeRideEntry).filter(Boolean).slice(-RIDE_LOG_LIMIT);

/** One Barracks record as saved, or null. */
export function sanitizeRecord(raw) {
  if (!isRecord(raw) || !isId(raw.id) || !isName(raw.name)) return null;
  const kind = raw.kind === 'lord' ? 'lord' : raw.kind === 'recruit' ? 'recruit' : null;
  if (!kind) return null;
  if (kind === 'lord' && raw.id !== lordRecordId(raw.name)) return null;
  const keptSkills = sanitizeSkillIds(raw.keptSkills);
  const record = {
    id: raw.id,
    kind,
    name: raw.name,
    keptSkills,
    skillKinds: sanitizeKinds(raw.skillKinds, keptSkills),
    keptItems: sanitizeItems(raw.keptItems),
    rides: count(raw.rides),
    rideLog: sanitizeRideLog(raw.rideLog),
  };
  if (kind === 'recruit') {
    const identity = sanitizeIdentity(raw);
    if (!identity) return null;
    Object.assign(record, identity);
  }
  return record;
}

function sanitizeCandidate(raw) {
  if (!isRecord(raw) || !isId(raw.ref) || !isName(raw.name)) return null;
  const kind = raw.kind === 'lord' ? 'lord' : raw.kind === 'recruit' ? 'recruit' : null;
  if (!kind) return null;
  const skills = sanitizeSkillIds(raw.skills);
  const candidate = {
    ref: raw.ref,
    kind,
    name: raw.name,
    className: isName(raw.className) ? raw.className : '',
    level: count(raw.level) || 1,
    tier: raw.tier === 'promoted' ? 'promoted' : 'base',
    recordId: isId(raw.recordId) ? raw.recordId : null,
    identity: kind === 'recruit' ? sanitizeIdentity(raw.identity) : null,
    items: sanitizeItems(raw.items),
    skills,
    skillKinds: sanitizeKinds(raw.skillKinds, skills),
  };
  if (kind === 'recruit' && !candidate.identity && !candidate.recordId) return null;
  return candidate;
}

function sanitizePendingRide(raw) {
  if (!isRecord(raw) || !isId(raw.runId)) return null;
  const candidates = (Array.isArray(raw.candidates) ? raw.candidates : [])
    .map(sanitizeCandidate)
    .filter(Boolean);
  if (!candidates.length) return null;
  const refs = new Set(candidates.map((c) => c.ref));
  return {
    runId: raw.runId,
    difficultyId: isName(raw.difficultyId) ? raw.difficultyId : null,
    endedAt: count(raw.endedAt),
    candidates,
    picked: [...new Set((Array.isArray(raw.picked) ? raw.picked : []).filter((r) => refs.has(r)))],
  };
}

/** How many of each kind a ride can still send: { lord, recruit } (never below 0). */
export function rideSlotsLeft(ride) {
  if (!ride) return { lord: 0, recruit: 0 };
  const picked = new Set(ride.picked || []);
  const left = (kind, limit) => {
    const all = ride.candidates.filter((c) => c.kind === kind);
    const taken = all.filter((c) => picked.has(c.ref)).length;
    return Math.max(0, Math.min(limit, all.length) - taken);
  };
  return { lord: left('lord', RIDE_LORD_PICKS), recruit: left('recruit', RIDE_RECRUIT_PICKS) };
}

/** A saved state, or anything else, as a whole v1 state (unknown records dropped). */
export function normalizeNgPlusState(raw) {
  const state = defaultNgPlusState();
  if (!isRecord(raw) || raw.v !== NG_PLUS_STATE_VERSION) return state;
  state.rev = count(raw.rev);
  const seen = new Set();
  const ownedUids = new Set();
  for (const entry of Array.isArray(raw.barracks) ? raw.barracks : []) {
    const record = sanitizeRecord(entry);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    // One owner per kept item, and one copy: the first copy seen keeps it (an earlier record,
    // or the earlier entry of the same record), a later copy is dropped (with the ride-log
    // entry that would bring it back).
    record.keptItems = record.keptItems.filter((item) => {
      if (ownedUids.has(item.uid)) return false;
      ownedUids.add(item.uid);
      return true;
    });
    state.barracks.push(record);
  }
  for (const record of state.barracks)
    for (const entry of record.rideLog || [])
      if (entry.replacedItem && ownedElsewhere(state, record, entry.replacedItem.uid))
        entry.replacedItem = null;
  const recruits = new Set(state.barracks.filter((r) => r.kind === 'recruit').map((r) => r.id));
  state.bring = [
    ...new Set((Array.isArray(raw.bring) ? raw.bring : []).filter((id) => recruits.has(id))),
  ].slice(0, MAX_BRING_LIMIT);
  state.pendingRide = sanitizePendingRide(raw.pendingRide);
  state.wins = count(raw.wins);
  return state;
}

/**
 * The adopt-merge of a stale manager (MetaProgressionManager._adoptForeignDiskStateIfNewer,
 * only when the disk copy was written after this one): the newer write's state, whole. Every
 * NG+ change adopts the disk before it applies, so the newer write already holds every change
 * this copy made; taking it whole never brings back a veteran it released or a pick it spent,
 * and a revision count can't outvote it. A disk payload without the key (a build that dropped
 * it) keeps `local`.
 */
export function adoptNgPlusState(local, disk) {
  if (disk === undefined || disk === null) return normalizeNgPlusState(local);
  return normalizeNgPlusState(disk);
}

export function lordRecordId(name) {
  return `lord:${name}`;
}

export function findRecord(state, id) {
  return (state?.barracks || []).find((record) => record.id === id) || null;
}

/** The record that keeps an item, by uid, or null. */
export function keeperOf(state, uid) {
  if (!isId(uid)) return null;
  return (state?.barracks || []).find((r) => r.keptItems.some((i) => i.uid === uid)) || null;
}

/** True when a record other than `record` keeps the item. */
function ownedElsewhere(state, record, uid) {
  const keeper = keeperOf(state, uid);
  return Boolean(keeper) && keeper !== record && keeper.id !== record?.id;
}

/** The record a lord's kit comes back from in an NG+ run, or null. */
export function lordRecord(state, name) {
  return findRecord(state, lordRecordId(name));
}

const bump = (state) => {
  state.rev = count(state.rev) + 1;
  return state;
};

/** Remove records (fallen veterans). Returns the ids removed. */
export function removeRecords(state, ids) {
  const drop = new Set(ids || []);
  const removed = state.barracks.filter((r) => drop.has(r.id)).map((r) => r.id);
  if (!removed.length) return removed;
  state.barracks = state.barracks.filter((r) => !drop.has(r.id));
  state.bring = state.bring.filter((id) => !drop.has(id));
  bump(state);
  return removed;
}

/** Release a veteran by hand. */
export function releaseRecord(state, id) {
  return removeRecords(state, [id]).length > 0;
}

/** The recruit veterans to bring into the next NG+ run (at most `limit`: bringLimitFor). */
export function setBring(state, ids, limit = BRING_LIMIT) {
  const list = [...new Set(Array.isArray(ids) ? ids : [])];
  if (list.length > limit) return { ok: false, reason: 'too_many' };
  for (const id of list)
    if (findRecord(state, id)?.kind !== 'recruit') return { ok: false, reason: 'unknown' };
  state.bring = list;
  bump(state);
  return { ok: true };
}

/**
 * What one run's end does to the Barracks (NgPlusRun.ngPlusRunEnd's record): the brought
 * veterans and lords that fell leave it; the commander a defeat took loses only their latest
 * ride (`setBackIds`, undoLastRide); the ones that came through a win keep their items as they are
 * now (one sold, used up or broken is gone); an eligible win leaves its survivors to pick from,
 * replacing an older pick never made; an NG+ win counts. Returns what changed.
 */
export function applyRunEnd(state, end) {
  if (!isRecord(end)) return { removed: [], setBack: [], ride: false };
  const removed = removeRecords(state, end.fallenIds);
  let changed = removed.length > 0;
  const setBack = [];
  for (const id of Array.isArray(end.setBackIds) ? end.setBackIds : [])
    if (undoLastRide(state, id)) setBack.push(id);
  if (setBack.length) changed = true;
  for (const refresh of Array.isArray(end.refresh) ? end.refresh : []) {
    const record = findRecord(state, refresh?.id);
    if (!record) continue;
    record.keptItems = sanitizeItems(refresh.keptItems).filter(
      (item) => !ownedElsewhere(state, record, item.uid),
    );
    changed = true;
  }
  const ride = sanitizePendingRide(end.pendingRide);
  if (ride) {
    state.pendingRide = ride;
    changed = true;
  }
  if (end.ngPlusWin === true) {
    state.wins = count(state.wins) + 1;
    changed = true;
  }
  if (changed) bump(state);
  return { removed, setBack, ride: Boolean(ride) };
}

/** The Barracks record a candidate already has (a brought veteran's, or a lord's), or null. */
export function recordFor(state, candidate) {
  if (!candidate) return null;
  if (candidate.recordId) {
    const record = findRecord(state, candidate.recordId);
    if (record) return record;
  }
  return candidate.kind === 'lord' ? lordRecord(state, candidate.name) : null;
}

/** Why a draft pick list cannot be committed, or null. */
export function ridePickBlock(state, picks) {
  const ride = state?.pendingRide;
  if (!ride) return 'no_ride';
  if (!Array.isArray(picks)) return 'bad_picks';
  const refs = new Set();
  const itemUids = new Set();
  const picked = new Set(ride.picked || []);
  const pickedOf = (kind) =>
    ride.candidates.filter((c) => c.kind === kind && picked.has(c.ref)).length;
  let lords = pickedOf('lord');
  let recruits = pickedOf('recruit');
  for (const pick of picks) {
    const candidate = ride.candidates.find((c) => c.ref === pick?.ref);
    if (!candidate || refs.has(pick.ref)) return 'unknown_candidate';
    if (picked.has(pick.ref)) return 'already_picked';
    refs.add(pick.ref);
    if (candidate.kind === 'lord') lords += 1;
    else recruits += 1;
    const reason = keepBlock(state, candidate, recordFor(state, candidate), pick);
    if (reason) return reason;
    if (pick.itemUid != null) {
      if (itemUids.has(pick.itemUid)) return 'kept_by_other';
      itemUids.add(pick.itemUid);
    }
  }
  if (lords > RIDE_LORD_PICKS) return 'too_many_lords';
  if (recruits > RIDE_RECRUIT_PICKS) return 'too_many_recruits';
  return null;
}

/** The kept skills of one kind on a record. */
export function keptOfKind(record, kind) {
  return (record?.keptSkills || []).filter((id) => (record.skillKinds?.[id] || 'skill') === kind);
}

/** The kept items of one kind on a record. */
export function keptItemsOfKind(record, kind) {
  return (record?.keptItems || []).filter((item) => keptItemKind(item) === kind);
}

function keepBlock(state, candidate, record, pick) {
  if (pick.skillId != null) {
    if (!candidate.skills.includes(pick.skillId)) return 'unknown_skill';
    if (record?.keptSkills.includes(pick.skillId)) return 'already_kept';
    const kind = candidate.skillKinds[pick.skillId] || 'skill';
    const held = keptOfKind(record, kind);
    if (held.length >= KEPT_SKILL_CAPS[kind]) {
      if (!held.includes(pick.replaceSkillId)) return 'skill_cap';
    } else if (pick.replaceSkillId != null) return 'bad_replace';
  }
  if (pick.itemUid != null) {
    const item = candidate.items.find((i) => i.uid === pick.itemUid);
    if (!item) return 'unknown_item';
    if (record?.keptItems.some((i) => i.uid === item.uid)) return 'already_kept';
    if (ownedElsewhere(state, record, item.uid)) return 'kept_by_other';
    const kind = keptItemKind(item);
    const held = keptItemsOfKind(record, kind);
    if (held.length >= KEPT_ITEM_CAPS[kind]) {
      if (!held.some((i) => i.uid === pick.replaceItemUid)) return 'item_cap';
    } else if (pick.replaceItemUid != null) return 'bad_replace';
  }
  return null;
}

/** A new record for a candidate not yet in the Barracks. */
function newRecord(candidate, runId) {
  const id =
    candidate.kind === 'lord' ? lordRecordId(candidate.name) : `vet:${runId}:${candidate.ref}`;
  return {
    id,
    kind: candidate.kind,
    name: candidate.name,
    keptSkills: [],
    skillKinds: {},
    keptItems: [],
    rides: 0,
    rideLog: [],
    ...(candidate.kind === 'recruit' ? structuredClone(candidate.identity) : {}),
  };
}

/**
 * Commit "Who rides again?": each pick adds (or updates) its character's record with one
 * skill and one item from the run (a full kind replaces the one the player named). The ride
 * stays open, its picks remembered, until every slot it can fill is filled; an empty list is
 * "Done" and closes it. Refused whole (nothing changes) when any pick is invalid.
 * @param {Array<{ ref, skillId?, itemUid?, replaceSkillId?, replaceItemUid? }>} picks
 */
export function applyRidePicks(state, picks) {
  const block = ridePickBlock(state, picks);
  if (block) return { ok: false, reason: block };
  const ride = state.pendingRide;
  const added = [];
  if (!picks.length) {
    state.pendingRide = null;
    bump(state);
    return { ok: true, added, closed: true };
  }
  for (const pick of picks) {
    const candidate = ride.candidates.find((c) => c.ref === pick.ref);
    let record = recordFor(state, candidate);
    if (!record) {
      if (candidate.kind === 'recruit' && !candidate.identity) continue;
      record = newRecord(candidate, ride.runId);
      state.barracks.push(record);
    }
    const entry = sanitizeRideEntry({
      skillId: pick.skillId,
      itemUid: pick.itemUid,
      replacedSkillId: pick.replaceSkillId,
      replacedSkillKind: record.skillKinds?.[pick.replaceSkillId],
      replacedItem: record.keptItems.find((i) => i.uid === pick.replaceItemUid),
    });
    if (pick.skillId != null) {
      if (pick.replaceSkillId != null)
        record.keptSkills = record.keptSkills.filter((id) => id !== pick.replaceSkillId);
      record.keptSkills.push(pick.skillId);
      record.skillKinds = sanitizeKinds(
        { ...record.skillKinds, [pick.skillId]: candidate.skillKinds[pick.skillId] },
        record.keptSkills,
      );
    }
    if (pick.itemUid != null) {
      if (pick.replaceItemUid != null)
        record.keptItems = record.keptItems.filter((i) => i.uid !== pick.replaceItemUid);
      record.keptItems.push(structuredClone(candidate.items.find((i) => i.uid === pick.itemUid)));
    }
    record.rides += 1;
    record.rideLog = [...(record.rideLog || []), entry].slice(-RIDE_LOG_LIMIT);
    added.push(record.id);
  }
  ride.picked = [...(ride.picked || []), ...picks.map((pick) => pick.ref)];
  const left = rideSlotsLeft(ride);
  const closed = left.lord === 0 && left.recruit === 0;
  if (closed) state.pendingRide = null;
  bump(state);
  return { ok: true, added, closed };
}

/**
 * Take back a record's latest ride (a lost run's commander): the skill and item it kept leave,
 * and whatever that ride replaced comes back. An item the ride kept that is no longer on the
 * record (used up) is simply not there to take. A record left with nothing kept and no rides
 * leaves the Barracks. Returns true when a ride was taken back.
 */
export function undoLastRide(state, id) {
  const record = findRecord(state, id);
  const entry = record?.rideLog?.at(-1);
  if (!entry) return false;
  record.rideLog = record.rideLog.slice(0, -1);
  if (entry.skillId) {
    record.keptSkills = record.keptSkills.filter((s) => s !== entry.skillId);
  }
  if (entry.replacedSkillId && !record.keptSkills.includes(entry.replacedSkillId)) {
    record.keptSkills.push(entry.replacedSkillId);
    record.skillKinds = { ...record.skillKinds, [entry.replacedSkillId]: entry.replacedSkillKind };
  }
  record.skillKinds = sanitizeKinds(record.skillKinds, record.keptSkills);
  if (entry.itemUid) record.keptItems = record.keptItems.filter((i) => i.uid !== entry.itemUid);
  if (
    entry.replacedItem &&
    !record.keptItems.some((i) => i.uid === entry.replacedItem.uid) &&
    !ownedElsewhere(state, record, entry.replacedItem.uid)
  )
    record.keptItems.push(structuredClone(entry.replacedItem));
  record.rides = Math.max(0, count(record.rides) - 1);
  if (!record.rides && !record.keptSkills.length && !record.keptItems.length)
    removeRecords(state, [record.id]);
  return true;
}

/** Pass on the pending ride (nobody new rides again). */
export function passRide(state) {
  if (!state?.pendingRide) return false;
  state.pendingRide = null;
  bump(state);
  return true;
}

/**
 * What an NG+ run starts with: the recruits chosen to bring and every lord's kit (a lord's
 * applies when they are in the run). Deep copies.
 */
export function runStartOf(state, { bringLimit = BRING_LIMIT } = {}) {
  const s = normalizeNgPlusState(state);
  return {
    veterans: s.bring
      .slice(0, bringLimit)
      .map((id) => structuredClone(findRecord(s, id)))
      .filter(Boolean),
    lordKits: s.barracks.filter((r) => r.kind === 'lord').map((r) => structuredClone(r)),
  };
}
