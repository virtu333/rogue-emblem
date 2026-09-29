// LordsMet.js — which lords this save has met (pure, no Phaser, no storage).
//
// A new save knows only the default pair (Edric and Sera). Every other lord appears in
// the home base (Starting lords, the commander picker) and the Compendium once they
// have joined an army on this save: the third-lord arrival, a boss recruit, a recruit
// node. MetaProgressionManager keeps the list (`lordsMet`); this module holds the
// rules both it and the cross-slot reader (SlotManager) share.

import { DEFAULT_STARTING_LORD_NAMES } from './Commander.js';

/** Lords every save has met. */
export const ALWAYS_MET_LORD_NAMES = Object.freeze([...DEFAULT_STARTING_LORD_NAMES]);

const MAX_LORD_NAME_LENGTH = 40;

function validName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= MAX_LORD_NAME_LENGTH;
}

/** Lord names as a sorted, de-duplicated list (unions any number of lists). */
export function mergeLordNames(...lists) {
  const names = new Set();
  for (const list of lists)
    for (const name of Array.isArray(list) ? list : []) if (validName(name)) names.add(name);
  return [...names].sort();
}

/**
 * Lords in a run (a RunManager or its saved JSON): the roster and the fallen. A lord
 * who joined and fell was still met.
 */
export function lordNamesInRun(run) {
  if (!run || typeof run !== 'object') return [];
  const names = [];
  for (const pool of [run.roster, run.fallenUnits])
    for (const unit of Array.isArray(pool) ? pool : [])
      if (unit?.isLord === true && validName(unit.name)) names.push(unit.name);
  return mergeLordNames(names);
}

/**
 * Remember every lord of a run as met on this save (a MetaProgressionManager; idempotent,
 * writes only when a lord is new). Called where lords join: the run's start and route
 * map (a loaded run), a won battle (a recruit-node lord), a boss recruit, the third lord.
 * @returns {boolean} whether a lord was new
 */
export function recordRunLordsMet(meta, run) {
  if (typeof meta?.recordLordsMet !== 'function') return false;
  try {
    return meta.recordLordsMet(lordNamesInRun(run)) === true;
  } catch (err) {
    console.warn('[LordsMet] could not record met lords:', err?.message || err);
    return false;
  }
}

/**
 * The lords a meta save from before `lordsMet` had evidently met: the default pair,
 * its commander-choice picks, lords holding starting skills, lords who fell in a run,
 * and lords in its run records. The slot's in-progress run is added by the caller
 * (lordNamesInRun), since it lives in a separate save.
 */
export function lordsMetFromMetaSave(saved) {
  const names = [...ALWAYS_MET_LORD_NAMES];
  if (!saved || typeof saved !== 'object') return mergeLordNames(names);
  const selection = saved.lordSelection;
  if (selection && typeof selection === 'object')
    names.push(selection.commander, selection.partner);
  if (saved.skillAssignments && typeof saved.skillAssignments === 'object')
    names.push(...Object.keys(saved.skillAssignments));
  const falls = saved.storyFlags?.lordFalls;
  if (falls && typeof falls === 'object') names.push(...Object.keys(falls));
  for (const record of Array.isArray(saved.runRecords) ? saved.runRecords : [])
    for (const unit of Array.isArray(record?.roster) ? record.roster : [])
      if (unit?.isLord === true) names.push(unit.name);
  return mergeLordNames(names);
}

/**
 * A meta save's met lords: its `lordsMet` list when it has one (always with the default
 * pair), else the backfill from its other records.
 */
export function lordsMetOfMetaSave(saved) {
  return Array.isArray(saved?.lordsMet)
    ? mergeLordNames(ALWAYS_MET_LORD_NAMES, saved.lordsMet)
    : lordsMetFromMetaSave(saved);
}

/**
 * The lord definitions (lords.json order) a save may show: those in `met` (a Set, an
 * array, or a predicate) and always the default pair.
 */
export function metLords(lords, met) {
  const isMet =
    typeof met === 'function'
      ? met
      : met instanceof Set
        ? (name) => met.has(name)
        : (name) => Array.isArray(met) && met.includes(name);
  return (Array.isArray(lords) ? lords : []).filter(
    (lord) => ALWAYS_MET_LORD_NAMES.includes(lord?.name) || isMet(lord?.name),
  );
}
