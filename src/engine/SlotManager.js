// SlotManager.js — Pure utility module for save slot management
// No Phaser deps.

import { HintManager } from './HintManager.js';

export const MAX_SLOTS = 3;
const META_KEY_PREFIX = 'emblem_rogue_slot_';
const META_KEY_SUFFIX = '_meta';
const RUN_KEY_SUFFIX = '_run';
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

/** Count of occupied slots (1-3 that have meta data). */
export function getSlotCount() {
  return getOccupiedSlots().length;
}

/** Array of slot numbers that have meta data saved. */
export function getOccupiedSlots() {
  const occupied = [];
  for (let i = 1; i <= MAX_SLOTS; i++) {
    try {
      if (localStorage.getItem(getMetaKey(i)) !== null) {
        occupied.push(i);
      }
    } catch (_) {
      /* ignore */
    }
  }
  return occupied;
}

/** First empty slot number (1-3), or null if all full. */
export function getNextAvailableSlot() {
  for (let i = 1; i <= MAX_SLOTS; i++) {
    try {
      if (localStorage.getItem(getMetaKey(i)) === null) return i;
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

/**
 * Summary info for a slot. Returns null if slot is empty (no meta).
 * If meta is valid but run JSON is corrupt, returns summary with runCorrupt: true.
 * @returns {{ slot, valor, supply, runsCompleted, hasActiveRun, actReached, runCorrupt } | null}
 */
export function getSlotSummary(slot) {
  let meta;
  try {
    const metaRaw = localStorage.getItem(getMetaKey(slot));
    if (!metaRaw) return null;
    meta = JSON.parse(metaRaw);
  } catch (_) {
    return null; // meta itself is corrupt — treat as empty
  }

  const summary = {
    slot,
    valor: meta.totalValor ?? meta.totalRenown ?? 0,
    supply: meta.totalSupply ?? meta.totalRenown ?? 0,
    runsCompleted: meta.runsCompleted || 0,
    hasActiveRun: false,
    actReached: null,
    runCorrupt: false,
  };

  let runRaw;
  try {
    runRaw = localStorage.getItem(getRunKey(slot));
  } catch (_) {
    summary.runCorrupt = true;
    console.error(`[SlotManager] Failed to read run data for slot ${slot}`);
    return summary;
  }
  if (runRaw) {
    try {
      const run = JSON.parse(runRaw);
      summary.hasActiveRun = true;
      summary.actReached = (run.actIndex || 0) + 1;
    } catch (_) {
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

/** Clear all slot data + active slot key. Used by logout. */
export function clearAllSlotData() {
  for (let i = 1; i <= MAX_SLOTS; i++) {
    deleteSlot(i);
  }
  try {
    localStorage.removeItem(ACTIVE_SLOT_KEY);
  } catch (err) {
    console.warn('[SlotManager] clearAllSlotData failed:', err?.message || err);
  }
}
