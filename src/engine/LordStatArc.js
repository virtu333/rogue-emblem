// LordStatArc.js - the `lord_stat_arc` blessing boon (Slow Fuse): the starting lords take a
// stat dip in one act and a lasting rise from a later one. Docs: docs/blessings_contract.md,
// docs/specs/blessings-v3.md §5.1.
//
// Pure rules over a run (RunManager): every function reads and writes only the run's roster,
// fallen units and `blessingRuntimeModifiers.lordStatArcs`, with no Phaser and no randomness.
//
// A tracker is `{ blessingId, stats, dipAct, dip, riseAct, rise, unitUids, dipTaken,
// dipApplied: { [uid]: { [stat]: appliedDelta } }, dipReverted, riseApplied }`:
//  - `unitUids` are the lords it was granted to (the starting lords; recruits and the third
//    lord are untouched). They are matched by unit identity in the roster AND the fallen, so a
//    lord who fell during the dip comes back at the same total as one who lived.
//  - `dipApplied` stores the delta each unit ACTUALLY took (HP never goes below 1, any other
//    stat never below 0), so the revert gives back exactly that much and never more.
//  - The dip is reverted as its act ends (advanceAct, with the other act-scoped effects) and
//    the rise lands as the rise act begins (`applyArcsOnActEntry`, before the army's rest),
//    once (`riseApplied`), so the dip is never "taken back twice" and the rise never twice.

import { unitUidOf } from './UnitIdentity.js';
import { XP_STAT_NAMES } from '../utils/constants.js';

const ARC_STATS = new Set(XP_STAT_NAMES);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Change one stat, clamped (HP >= 1, others >= 0); returns the delta that really applied. */
function shiftStat(unit, stat, delta) {
  if (!unit?.stats || !Number.isFinite(delta) || delta === 0) return 0;
  const before = Number(unit.stats[stat]) || 0;
  const floor = stat === 'HP' ? 1 : 0;
  const next = delta < 0 ? Math.min(before, Math.max(floor, before + delta)) : before + delta;
  const applied = next - before;
  if (applied === 0) return 0;
  unit.stats[stat] = next;
  if (stat === 'HP') {
    if (applied > 0) unit.currentHP = (unit.currentHP || 0) + applied;
    else unit.currentHP = Math.min(unit.currentHP || 0, unit.stats.HP || 0);
  }
  return applied;
}

/** Normalised boon params, or null when they do not describe an arc. */
export function parseLordStatArc(params, actSequence = []) {
  if (!isPlainObject(params)) return null;
  const stats = Array.isArray(params.stats)
    ? [...new Set(params.stats.filter((stat) => ARC_STATS.has(stat)))]
    : [];
  const dip = Math.trunc(Number(params.dip));
  const rise = Math.trunc(Number(params.rise));
  const dipAct = typeof params.dipAct === 'string' ? params.dipAct : '';
  const riseAct = typeof params.riseAct === 'string' ? params.riseAct : '';
  if (stats.length === 0) return null;
  if (!Number.isFinite(dip) || !Number.isFinite(rise) || (dip === 0 && rise === 0)) return null;
  if (!actSequence.includes(dipAct) || !actSequence.includes(riseAct)) return null;
  return { stats, dipAct, dip, riseAct, rise };
}

function holdersOf(run, tracker) {
  return [...(run.roster || []), ...(run.fallenUnits || [])].filter((unit) =>
    tracker.unitUids.includes(unitUidOf(unit)),
  );
}

function actIndexOf(run, actId) {
  return run.actSequence.indexOf(actId);
}

function takeDip(run, tracker) {
  tracker.dipTaken = true;
  if (tracker.dip === 0) return;
  for (const unit of holdersOf(run, tracker)) {
    const uid = unitUidOf(unit);
    const applied = {};
    for (const stat of tracker.stats) {
      const delta = shiftStat(unit, stat, tracker.dip);
      if (delta !== 0) applied[stat] = delta;
    }
    tracker.dipApplied[uid] = applied;
  }
}

function giveRise(run, tracker) {
  tracker.riseApplied = true;
  if (tracker.rise === 0) return;
  for (const unit of holdersOf(run, tracker))
    for (const stat of tracker.stats) shiftStat(unit, stat, tracker.rise);
}

/**
 * Start an arc for the run's current roster (the starting lords). The dip lands now if this
 * is its act; the rise lands now only if the run is already in or past its act (a mid-run
 * grant). Returns the tracker (already stored), or null for malformed params.
 */
export function startLordStatArc(run, blessingId, params) {
  const parsed = parseLordStatArc(params, run.actSequence || []);
  if (!parsed) return null;
  const lords = (run.roster || []).filter((unit) => unit?.isLord);
  const tracker = {
    blessingId,
    ...parsed,
    unitUids: lords.map((unit) => run.assignUnitUid(unit)),
    dipTaken: false,
    dipApplied: {},
    dipReverted: false,
    riseApplied: false,
  };
  const now = actIndexOf(run, run.currentAct);
  const dipIndex = actIndexOf(run, tracker.dipAct);
  if (now === dipIndex) takeDip(run, tracker);
  // A dip whose act has already passed is never taken (nothing to give back later either).
  else if (now > dipIndex) tracker.dipReverted = true;
  if (now >= actIndexOf(run, tracker.riseAct)) giveRise(run, tracker);
  if (!Array.isArray(run.blessingRuntimeModifiers.lordStatArcs))
    run.blessingRuntimeModifiers.lordStatArcs = [];
  run.blessingRuntimeModifiers.lordStatArcs.push(tracker);
  return tracker;
}

/** The act `expiredAct` is ending: every dip taken in it is given back by the stored amount. */
export function revertArcDipsForExpiredAct(run, expiredAct) {
  const arcs = run.blessingRuntimeModifiers?.lordStatArcs;
  if (!Array.isArray(arcs) || !expiredAct) return;
  for (const tracker of arcs) {
    if (!tracker.dipTaken || tracker.dipReverted || tracker.dipAct !== expiredAct) continue;
    for (const unit of holdersOf(run, tracker)) {
      const applied = tracker.dipApplied[unitUidOf(unit)] || {};
      for (const [stat, delta] of Object.entries(applied))
        unit.stats[stat] = (unit.stats[stat] || 0) - delta;
    }
    tracker.dipReverted = true;
    run._recordBlessingEvent(
      'act_transition',
      tracker.blessingId,
      { type: 'lord_stat_arc', params: { dipAct: tracker.dipAct, dip: tracker.dip } },
      { revertedInAct: expiredAct, stats: tracker.stats },
    );
  }
}

/**
 * The run has just entered `run.currentAct` (called from advanceAct before the army's rest):
 * a dip waiting for this act is taken, and a rise due by this act lands, once.
 */
export function applyArcsOnActEntry(run) {
  const arcs = run.blessingRuntimeModifiers?.lordStatArcs;
  if (!Array.isArray(arcs)) return;
  const now = actIndexOf(run, run.currentAct);
  for (const tracker of arcs) {
    if (!tracker.dipTaken && !tracker.dipReverted && tracker.dipAct === run.currentAct)
      takeDip(run, tracker);
    if (!tracker.riseApplied && now >= actIndexOf(run, tracker.riseAct)) {
      giveRise(run, tracker);
      run._recordBlessingEvent(
        'act_transition',
        tracker.blessingId,
        { type: 'lord_stat_arc', params: { riseAct: tracker.riseAct, rise: tracker.rise } },
        { appliedInAct: run.currentAct, stats: tracker.stats },
      );
    }
  }
}

/** A saved tracker list, cleaned: malformed entries are dropped, fields get safe defaults. */
export function sanitizeLordStatArcs(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const entry of raw) {
    if (!isPlainObject(entry) || typeof entry.blessingId !== 'string') continue;
    const stats = Array.isArray(entry.stats) ? entry.stats.filter((s) => ARC_STATS.has(s)) : [];
    const dip = Math.trunc(Number(entry.dip));
    const rise = Math.trunc(Number(entry.rise));
    if (
      stats.length === 0 ||
      !Number.isFinite(dip) ||
      !Number.isFinite(rise) ||
      typeof entry.dipAct !== 'string' ||
      typeof entry.riseAct !== 'string'
    )
      continue;
    const dipApplied = {};
    if (isPlainObject(entry.dipApplied))
      for (const [uid, byStat] of Object.entries(entry.dipApplied)) {
        if (!isPlainObject(byStat)) continue;
        dipApplied[uid] = Object.fromEntries(
          Object.entries(byStat)
            .filter(([stat, delta]) => ARC_STATS.has(stat) && Number.isFinite(Number(delta)))
            .map(([stat, delta]) => [stat, Math.trunc(Number(delta))]),
        );
      }
    out.push({
      blessingId: entry.blessingId,
      stats,
      dipAct: entry.dipAct,
      dip,
      riseAct: entry.riseAct,
      rise,
      unitUids: Array.isArray(entry.unitUids)
        ? entry.unitUids.filter((uid) => typeof uid === 'string')
        : [],
      dipTaken: entry.dipTaken === true,
      dipApplied,
      dipReverted: entry.dipReverted === true,
      riseApplied: entry.riseApplied === true,
    });
  }
  return out;
}
