// AchievementStore — where the player's achievements live on this device
// (docs/specs/achievements.md).
//
// Achievements are the player's, not a slot's. Each slot's meta save carries the state (so the
// cloud copy carries it to another device), and the device keeps one more copy
// (`emblem_rogue_achievements`) so deleting a slot never loses one. What the player has
// earned is the union of every copy: `achievementsOnDevice()`. A slot's manager takes that
// union in when it loads and writes it back with its next save, so every copy converges.
//
// Notices: a newly earned achievement is announced to the listeners (`onAchievementsUnlocked`:
// the unlock card) only once the meta write that holds it has landed.

import {
  emptyAchievementState,
  mergeAchievementStates,
  normalizeAchievementState,
} from './Achievements.js';

export const DEVICE_ACHIEVEMENTS_KEY = 'emblem_rogue_achievements';
// The slot metas, as SlotManager.getMetaKey names them (spelled here so this module imports no
// slot code); more than SlotManager.MAX_SLOTS are read, which costs nothing.
const slotMetaKey = (slot) => `emblem_rogue_slot_${slot}_meta`;
const MAX_SLOTS_READ = 8;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function readJSON(store, key) {
  try {
    const raw = store.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // a corrupt copy never hides the others
  }
}

/** The device's own copy (empty when absent or unreadable). */
export function readDeviceAchievements() {
  const store = storage();
  return normalizeAchievementState(store ? readJSON(store, DEVICE_ACHIEVEMENTS_KEY) : null);
}

/** Fold `state` into the device's copy. Best effort: false when storage refused. */
export function writeDeviceAchievements(state) {
  const store = storage();
  if (!store) return false;
  try {
    const merged = mergeAchievementStates(readJSON(store, DEVICE_ACHIEVEMENTS_KEY), state);
    store.setItem(DEVICE_ACHIEVEMENTS_KEY, JSON.stringify(merged));
    return true;
  } catch {
    return false;
  }
}

/** Every copy on this device: the device key and each slot's meta save. */
export function achievementsOnDevice() {
  const store = storage();
  if (!store) return emptyAchievementState();
  const copies = [readJSON(store, DEVICE_ACHIEVEMENTS_KEY)];
  for (let slot = 1; slot <= MAX_SLOTS_READ; slot++)
    copies.push(readJSON(store, slotMetaKey(slot))?.achievements);
  return mergeAchievementStates(...copies);
}

// ── Notices ──────────────────────────────────────────────────────────────

const listeners = new Set();

/** Listen for newly earned achievement ids. Returns the unsubscribe. */
export function onAchievementsUnlocked(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Tell every listener (a listener's failure never reaches the others or the caller).
 * `retro: true` marks what the retroactive pass found in older records: one notice for all.
 */
export function announceAchievements(ids, { retro = false } = {}) {
  const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
  if (!list.length) return;
  for (const listener of [...listeners]) {
    try {
      listener([...list], { retro: retro === true });
    } catch (err) {
      console.warn('[Achievements] notice listener failed:', err?.message || err);
    }
  }
}
