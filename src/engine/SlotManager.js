// SlotManager.js — Pure utility module for save slot management
// No Phaser deps.

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
    } catch (_) { /* ignore */ }
  }
  return occupied;
}

/** First empty slot number (1-3), or null if all full. */
export function getNextAvailableSlot() {
  for (let i = 1; i <= MAX_SLOTS; i++) {
    try {
      if (localStorage.getItem(getMetaKey(i)) === null) return i;
    } catch (_) { /* ignore */ }
  }
  return null;
}

/**
 * Summary info for a slot. Returns null if slot is empty.
 * @returns {{ slot, renown, runsCompleted, hasActiveRun, actReached }}
 */
export function getSlotSummary(slot) {
  try {
    const metaRaw = localStorage.getItem(getMetaKey(slot));
    if (!metaRaw) return null;

    const meta = JSON.parse(metaRaw);
    const summary = {
      slot,
      valor: meta.totalValor ?? meta.totalRenown ?? 0,
      supply: meta.totalSupply ?? meta.totalRenown ?? 0,
      runsCompleted: meta.runsCompleted || 0,
      hasActiveRun: false,
      actReached: null,
    };

    const runRaw = localStorage.getItem(getRunKey(slot));
    if (runRaw) {
      const run = JSON.parse(runRaw);
      summary.hasActiveRun = true;
      summary.actReached = (run.actIndex || 0) + 1;
    }

    return summary;
  } catch (_) {
    return null;
  }
}

/** Delete both meta and run data for a slot. */
export function deleteSlot(slot) {
  try {
    localStorage.removeItem(getMetaKey(slot));
    localStorage.removeItem(getRunKey(slot));
  } catch (_) { /* ignore */ }
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
  } catch (_) { /* ignore */ }
}

/**
 * Migrate old single-save data to slot 1.
 * Safe to call multiple times — only acts if old keys exist.
 */
export function migrateOldSaves() {
  try {
    const oldMeta = localStorage.getItem(OLD_META_KEY);
    if (oldMeta) {
      localStorage.setItem(getMetaKey(1), oldMeta);
      localStorage.removeItem(OLD_META_KEY);
    }

    const oldRun = localStorage.getItem(OLD_RUN_KEY);
    if (oldRun) {
      localStorage.setItem(getRunKey(1), oldRun);
      localStorage.removeItem(OLD_RUN_KEY);
    }

    // If we migrated anything, set active slot to 1
    if (oldMeta || oldRun) {
      setActiveSlot(1);
    }
  } catch (_) { /* ignore */ }
}

/** Clear all slot data + active slot key. Used by logout. */
export function clearAllSlotData() {
  for (let i = 1; i <= MAX_SLOTS; i++) {
    deleteSlot(i);
  }
  try {
    localStorage.removeItem(ACTIVE_SLOT_KEY);
  } catch (_) { /* ignore */ }
}
