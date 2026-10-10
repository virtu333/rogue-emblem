// pendingRunSeed.js — the seed of a run offered at the shrine but not yet begun, kept per slot
// (docs/specs/blessings-v3.md §3.2, §7.1). Backing out of the shrine, opening another slot's
// shrine, or reloading the page shows the same offer (the same blessings at the same prices, the
// same gift), so neither the offer nor the gift can be re-rolled for free. It is cleared when the
// run begins and when the slot is deleted (SlotManager.deleteSlot).
//
// Where it lives: the slot's localStorage key (`emblem_rogue_slot_<n>_pendingSeed`), as
// `{ seed, runsStarted }`. `runsStarted` is the save's count when the seed was drawn: once a run
// has begun since (the count moved), the seed is stale and read as none, so a new run always
// draws afresh even if the clear at the run's start never reached the device. Every storage call
// is guarded: when storage cannot be read or written (private mode, a full quota), the game
// registry (`pendingBlessingRunSeeds`, `{ [slot]: { seed, runsStarted } }`) holds it for the
// session instead.

import { getSlotPendingSeedKey } from '../engine/SlotManager.js';

export const PENDING_RUN_SEED_KEY = 'pendingBlessingRunSeeds';

const slotOf = (registry) => {
  const slot = registry?.get?.('activeSlot');
  return Number.isInteger(Number(slot)) && Number(slot) > 0 ? Number(slot) : null;
};
const registryKey = (registry) => String(registry?.get?.('activeSlot') ?? 'none');
const countOf = (runsStarted) => Math.max(0, Math.trunc(Number(runsStarted) || 0));

function registrySeeds(registry) {
  const seeds = registry?.get?.(PENDING_RUN_SEED_KEY);
  return seeds && typeof seeds === 'object' ? seeds : {};
}

function setRegistryEntry(registry, entry) {
  if (!registry?.set) return;
  const seeds = { ...registrySeeds(registry) };
  if (entry) seeds[registryKey(registry)] = entry;
  else delete seeds[registryKey(registry)];
  registry.set(PENDING_RUN_SEED_KEY, seeds);
}

/** `{ seed, runsStarted }` from a stored value, or null for anything else. */
function parseEntry(raw) {
  if (raw === null || raw === undefined) return null;
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  // A bare number (an older registry entry) carries no count: it is this session's.
  if (typeof value === 'number') return Number.isFinite(value) ? { seed: value } : null;
  if (!value || typeof value !== 'object' || !Number.isFinite(value.seed)) return null;
  return {
    seed: value.seed,
    ...(Number.isFinite(value.runsStarted) ? { runsStarted: value.runsStarted } : {}),
  };
}

const current = (entry, runsStarted) =>
  entry && (entry.runsStarted === undefined || entry.runsStarted === countOf(runsStarted))
    ? entry.seed
    : null;

/**
 * The active slot's pending run seed, or null (none kept, or kept before a run began since).
 * @param {object} registry the game registry (`activeSlot`, the fallback map)
 * @param {{ runsStarted?: number, storage?: Storage|null }} [options]
 */
export function readPendingRunSeed(
  registry,
  { runsStarted = 0, storage = globalThis.localStorage } = {},
) {
  const slot = slotOf(registry);
  if (slot !== null && storage) {
    try {
      const stored = current(parseEntry(storage.getItem(getSlotPendingSeedKey(slot))), runsStarted);
      if (stored !== null) return stored;
    } catch {
      // Unreadable storage: the registry holds it for the session.
    }
  }
  return current(parseEntry(registrySeeds(registry)[registryKey(registry)]), runsStarted);
}

/**
 * Keep `seed` as the active slot's pending run seed (or clear it with null). Storage first; the
 * registry only when storage refuses, so a cleared slot never finds a stale registry copy.
 */
export function writePendingRunSeed(
  registry,
  seed,
  { runsStarted = 0, storage = globalThis.localStorage } = {},
) {
  const slot = slotOf(registry);
  const entry = Number.isFinite(seed) ? { seed, runsStarted: countOf(runsStarted) } : null;
  let stored = false;
  if (slot !== null && storage) {
    try {
      const key = getSlotPendingSeedKey(slot);
      if (entry) storage.setItem(key, JSON.stringify(entry));
      else storage.removeItem(key);
      stored = true;
    } catch {
      stored = false;
    }
  }
  setRegistryEntry(registry, stored ? null : entry);
}

/** Clear the active slot's pending run seed (the run began). */
export function clearPendingRunSeed(registry, options = {}) {
  writePendingRunSeed(registry, null, options);
}
