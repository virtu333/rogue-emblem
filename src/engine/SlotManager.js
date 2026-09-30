// SlotManager.js — Pure utility module for save slot management
// No Phaser deps.

import { HintManager } from './HintManager.js';
import { ALWAYS_MET_LORD_NAMES, lordNamesInRun, lordsMetOfMetaSave } from './LordsMet.js';

export const MAX_SLOTS = 3;
const META_KEY_PREFIX = 'emblem_rogue_slot_';
const META_KEY_SUFFIX = '_meta';
const RUN_KEY_SUFFIX = '_run';
const RUN_CLOCK_FLOOR_SUFFIX = '_run_clock_floor';
const META_CLOCK_FLOOR_SUFFIX = '_meta_clock_floor';
export const ACTIVE_SLOT_KEY = 'emblem_rogue_active_slot';

// Old keys (pre-slot system)
const OLD_META_KEY = 'emblem_rogue_meta_save';
const OLD_RUN_KEY = 'emblem_rogue_run_save';

export function getMetaKey(slot) {
  return `${META_KEY_PREFIX}${slot}${META_KEY_SUFFIX}`;
}

export function getRunKey(slot) {
  return `${META_KEY_PREFIX}${slot}${RUN_KEY_SUFFIX}`;
}

export function getRunClockFloorKey(slot) {
  return `${META_KEY_PREFIX}${slot}${RUN_CLOCK_FLOOR_SUFFIX}`;
}

export function getMetaClockFloorKey(slot) {
  return `${META_KEY_PREFIX}${slot}${META_CLOCK_FLOOR_SUFFIX}`;
}

export const getSlotQuarantineKey = (slot) => `${META_KEY_PREFIX}${slot}_quarantine`;
export const getSlotPairJournalKey = (slot) => `${META_KEY_PREFIX}${slot}_pair_journal`;

/** The canonical bytes a discard must preserve, including absent keys. */
export function getSlotDataKeys(slot) {
  return [
    getMetaKey(slot),
    getRunKey(slot),
    getRunClockFloorKey(slot),
    getMetaClockFloorKey(slot),
    `${META_KEY_PREFIX}${slot}_cloud_conflict`,
    `${META_KEY_PREFIX}${slot}_hints`,
  ];
}

/** Recovery records reserve their slot, even after its canonical keys were removed. */
export function hasSlotRecoveryRecord(slot) {
  try {
    return [getSlotQuarantineKey(slot), getSlotPairJournalKey(slot)].some(
      (key) => localStorage.getItem(key) !== null,
    );
  } catch {
    return true;
  }
}

/** Read-only inspection; missing metadata alone is not evidence of an empty slot. */
export function inspectSlot(slot) {
  let raw = {};
  try {
    for (const key of [
      ...getSlotDataKeys(slot),
      getSlotQuarantineKey(slot),
      getSlotPairJournalKey(slot),
    ])
      raw[key] = localStorage.getItem(key);
  } catch {
    return { status: 'unreadable', raw, meta: parseMetaObject(raw[getMetaKey(slot)]) };
  }
  const meta = parseMetaObject(raw[getMetaKey(slot)]);
  const run = parseMetaObject(raw[getRunKey(slot)]);
  const hasRunData = raw[getRunKey(slot)] !== null;
  const recovery =
    raw[getSlotQuarantineKey(slot)] !== null || raw[getSlotPairJournalKey(slot)] !== null;
  const occupied =
    [getMetaKey(slot), getRunKey(slot), `${META_KEY_PREFIX}${slot}_cloud_conflict`].some(
      (key) => raw[key] !== null,
    ) || recovery;
  return {
    status: recovery ? 'recovery-required' : !occupied ? 'empty' : meta ? 'valid' : 'damaged',
    raw,
    meta,
    hasRunData,
    runParseable: Boolean(run),
  };
}

/** Count of occupied slots, including damaged and recovery-only saves. */
export function getSlotCount() {
  return getOccupiedSlots().length;
}

/** Array of slot numbers containing save or recovery evidence. */
export function getOccupiedSlots() {
  const occupied = [];
  for (let i = 1; i <= MAX_SLOTS; i++) {
    if (inspectSlot(i).status !== 'empty') occupied.push(i);
  }
  return occupied;
}

/**
 * Parse slot meta JSON and accept only non-null, non-array objects.
 * Returns parsed object for valid meta, otherwise null.
 */
function parseMetaObject(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

/** First empty slot number (1-3), or null if all full. */
export function getNextAvailableSlot() {
  for (let i = 1; i <= MAX_SLOTS; i++) {
    if (inspectSlot(i).status === 'empty') return i;
  }
  return null;
}

/**
 * Summary info for a slot. Returns null only when no slot evidence exists.
 * If meta is valid but run JSON is corrupt, returns summary with runCorrupt: true.
 * @returns {{ slot, valor, supply, runsCompleted, runsStarted, upgradesOwned, metaSavedAt, hasActiveRun, actReached, runCorrupt } | null}
 */
export function getSlotSummary(slot) {
  const inspection = inspectSlot(slot);
  if (inspection.status === 'empty') return null;
  const meta = inspection.meta || {};
  const summary = {
    slot,
    milestones: Array.isArray(meta.milestones) ? meta.milestones.slice() : [],
    valor: meta.totalValor ?? meta.totalRenown ?? 0,
    supply: meta.totalSupply ?? meta.totalRenown ?? 0,
    runsCompleted: meta.runsCompleted || 0,
    // Pre-tracking saves: finished runs are a floor on started runs.
    runsStarted: Math.max(meta.runsStarted || 0, meta.runsCompleted || 0),
    // Home base upgrade levels bought (metaUpgrades), summed across upgrades.
    upgradesOwned: Object.values(
      meta.purchasedUpgrades && typeof meta.purchasedUpgrades === 'object'
        ? meta.purchasedUpgrades
        : {},
    ).reduce((sum, level) => sum + Math.max(0, Math.trunc(Number(level) || 0)), 0),
    // When this slot's progression last saved (MetaProgressionManager `savedAt`).
    metaSavedAt: Number.isFinite(meta.savedAt) ? meta.savedAt : null,
    hasActiveRun: false,
    actReached: null,
    runCorrupt: false,
  };

  if (inspection.status !== 'valid') {
    return {
      ...summary,
      slotStatus: inspection.status,
      recoveryRequired: true,
      metaDamaged: !inspection.meta,
      runCorrupt: inspection.status === 'unreadable',
      runRecoverable: inspection.runParseable === true,
    };
  }

  const runRaw = inspection.raw[getRunKey(slot)];
  if (runRaw !== null) {
    try {
      const run = JSON.parse(runRaw);
      if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error('Invalid run');
      summary.hasActiveRun = true;
      summary.actReached = (run.actIndex || 0) + 1;
      summary.savedAt = Number.isFinite(run.savedAt) ? run.savedAt : null;
      const node = run.nodeMap?.nodes?.find((entry) => entry.id === run.currentNodeId);
      summary.rosterNames = (run.roster || []).slice(0, 3).map((unit) => unit.name);
      // Presentation extras for the save screen (read-only; never written back).
      const roster = Array.isArray(run.roster) ? run.roster : [];
      summary.rosterSize = roster.length;
      summary.roster = roster.slice(0, 4).map((unit) => ({
        name: unit?.name || '',
        className: unit?.className || '',
        isLord: Boolean(unit?.isLord),
        tier: unit?.tier || 'base',
        isCommander: Boolean(unit?.isCommander),
      }));
      summary.actId = Array.isArray(run.actSequence) ? run.actSequence[run.actIndex || 0] : null;
      summary.actCount = Array.isArray(run.actSequence) ? run.actSequence.length : null;
      summary.difficultyId = typeof run.difficultyId === 'string' ? run.difficultyId : null;
      summary.nodeType = node?.type || null;
      summary.stage = node && Number.isFinite(node.row) ? node.row + 1 : null;
      const bip = run.battleInProgress;
      const battleNodeId = bip?.nodeId || run.currentNodeId;
      const templateId =
        bip?.checkpoint?.battleConfig?.templateId ||
        bip?.battleParams?.templateId ||
        run.battleConfigsByNodeId?.[battleNodeId]?.templateId ||
        node?.templateId ||
        node?.battleParams?.templateId;
      summary.templateId = typeof templateId === 'string' ? templateId : null;
      summary.battleIsBoss = bip?.isBoss === true || node?.type === 'boss';
      summary.battleSuspended = Boolean(run.battleInProgress?.checkpoint);
      summary.completedBattles = run.completedBattles || 0;
      summary.location = node
        ? `${node.type} node${Number.isFinite(node.row) ? ` · stage ${node.row + 1}` : ''}`
        : 'Act start';
    } catch (_) {
      summary.hasActiveRun = false;
      summary.runCorrupt = true;
      console.error(`[SlotManager] Corrupt run data in slot ${slot}`);
    }
  }

  return summary;
}

/** Delete both meta and run data for a slot (and hint state). */
export function deleteSlot(slot) {
  try {
    localStorage.removeItem(getMetaKey(slot));
    localStorage.removeItem(getRunKey(slot));
    localStorage.removeItem(getRunClockFloorKey(slot));
    localStorage.removeItem(getMetaClockFloorKey(slot));
    localStorage.removeItem(`emblem_rogue_slot_${slot}_cloud_conflict`);
  } catch (err) {
    console.warn('[SlotManager] deleteSlot failed:', err?.message || err);
  }
  HintManager.deleteForSlot(slot);
}

/** Get the currently active slot number (1-3), or null. */
export function getActiveSlot() {
  try {
    const val = localStorage.getItem(ACTIVE_SLOT_KEY);
    return val ? Number(val) : null;
  } catch (_) {
    return null;
  }
}

/** Set the active slot number. */
export function setActiveSlot(slot) {
  try {
    localStorage.setItem(ACTIVE_SLOT_KEY, String(slot));
  } catch (err) {
    console.warn('[SlotManager] setActiveSlot failed:', err?.message || err);
  }
}

/**
 * Migrate old single-save data to slot 1.
 * Safe to call multiple times — only acts if old keys exist.
 */
export function migrateOldSaves() {
  try {
    let migratedAny = false;

    const oldMeta = localStorage.getItem(OLD_META_KEY);
    if (oldMeta && !localStorage.getItem(getMetaKey(1))) {
      localStorage.setItem(getMetaKey(1), oldMeta);
      migratedAny = true;
    }
    if (oldMeta) localStorage.removeItem(OLD_META_KEY);

    const oldRun = localStorage.getItem(OLD_RUN_KEY);
    if (oldRun && !localStorage.getItem(getRunKey(1))) {
      localStorage.setItem(getRunKey(1), oldRun);
      migratedAny = true;
    }
    if (oldRun) localStorage.removeItem(OLD_RUN_KEY);

    if (migratedAny) {
      setActiveSlot(1);
    }
  } catch (err) {
    console.warn('[SlotManager] migrateOldSaves failed:', err?.message || err);
  }
}

/** Check if any slot (1-3) contains the given milestone. */
export function hasAnySlotMilestone(milestone) {
  for (let i = 1; i <= MAX_SLOTS; i++) {
    try {
      const raw = localStorage.getItem(getMetaKey(i));
      if (!raw) continue;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.milestones) && saved.milestones.includes(milestone)) return true;
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

/**
 * Deed ids earned in any slot (1-3): each save's record, plus the deeds on its run's
 * units (living and fallen), so saves from before the record still count. Read
 * cross-slot like hasAnySlotMilestone, so the Title-screen Compendium matches in-run.
 * @returns {Set<string>}
 */
export function earnedDeedIdsAcrossSlots() {
  const ids = new Set();
  const addUnits = (units) => {
    for (const unit of Array.isArray(units) ? units : [])
      for (const entry of Array.isArray(unit?.deeds?.earned) ? unit.deeds.earned : [])
        if (typeof entry?.id === 'string') ids.add(entry.id);
  };
  for (let i = 1; i <= MAX_SLOTS; i++) {
    try {
      const meta = JSON.parse(localStorage.getItem(getMetaKey(i)) || 'null');
      for (const id of Array.isArray(meta?.deedsEarned) ? meta.deedsEarned : [])
        if (typeof id === 'string') ids.add(id);
      const run = JSON.parse(localStorage.getItem(getRunKey(i)) || 'null');
      addUnits(run?.roster);
      addUnits(run?.fallenUnits);
    } catch (_) {
      /* an unreadable slot adds nothing */
    }
  }
  return ids;
}

/**
 * Lords met in any slot (1-3): each save's record (or its backfill for saves from
 * before it) plus the lords of its run, living and fallen. Read cross-slot like
 * earnedDeedIdsAcrossSlots, so the Title-screen Compendium matches in-run. Edric and
 * Sera are always met.
 * @returns {Set<string>}
 */
export function metLordNamesAcrossSlots() {
  const names = new Set(ALWAYS_MET_LORD_NAMES);
  for (let i = 1; i <= MAX_SLOTS; i++) {
    try {
      const meta = JSON.parse(localStorage.getItem(getMetaKey(i)) || 'null');
      if (meta) for (const name of lordsMetOfMetaSave(meta)) names.add(name);
      const run = JSON.parse(localStorage.getItem(getRunKey(i)) || 'null');
      for (const name of lordNamesInRun(run)) names.add(name);
    } catch (_) {
      /* an unreadable slot adds nothing */
    }
  }
  return names;
}

/** Clear all slot data + active slot key. Used by logout. */
export function clearAllSlotData() {
  if (
    Array.from({ length: MAX_SLOTS }, (_, i) => getSlotSummary(i + 1)).some(
      (summary) => summary?.recoveryRequired || summary?.runCorrupt,
    )
  )
    return false;
  for (let i = 1; i <= MAX_SLOTS; i++) {
    deleteSlot(i);
  }
  try {
    localStorage.removeItem(ACTIVE_SLOT_KEY);
  } catch (err) {
    console.warn('[SlotManager] clearAllSlotData failed:', err?.message || err);
  }
  return true;
}
