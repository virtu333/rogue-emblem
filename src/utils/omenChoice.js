// omenChoice.js — the Omens a slot chose last time, kept per slot on the device
// (`emblem_rogue_slot_<n>_omens`, `{ [omenId]: rank }`) so the difficulty screen opens on the
// same choice. Same storage rules as pendingRunSeed.js: every storage call is guarded, and the
// game registry (`omenChoices`, `{ [slot]: ranks }`) holds the choice for the session when
// storage refuses. deleteSlot clears the key.
import { getSlotOmensKey } from '../engine/SlotManager.js';

export const OMEN_CHOICE_REGISTRY_KEY = 'omenChoices';

function resolveStorage(injected) {
  if (injected !== undefined) return injected;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const slotOf = (registry) => {
  const slot = registry?.get?.('activeSlot');
  return Number.isInteger(Number(slot)) && Number(slot) > 0 ? Number(slot) : null;
};
const registryKey = (registry) => String(registry?.get?.('activeSlot') ?? 'none');

/** `{ id: rank }` of positive whole ranks from a stored value, or {}. */
function parseRanks(raw) {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [id, rank] of Object.entries(value)) {
    const n = Math.trunc(Number(rank));
    if (n > 0) out[id] = n;
  }
  return out;
}

const registryMap = (registry) => {
  const map = registry?.get?.(OMEN_CHOICE_REGISTRY_KEY);
  return map && typeof map === 'object' ? map : {};
};

/** The active slot's remembered Omens ({} when none). */
export function readOmenChoice(registry, { storage: injected } = {}) {
  const storage = resolveStorage(injected);
  const slot = slotOf(registry);
  if (slot !== null && storage) {
    try {
      const raw = storage.getItem(getSlotOmensKey(slot));
      if (raw !== null && raw !== undefined) return parseRanks(raw);
    } catch {
      // Unreadable storage: the registry holds it for the session.
    }
  }
  return parseRanks(registryMap(registry)[registryKey(registry)]);
}

/** Keep `ranks` as the active slot's choice (an empty choice clears it). */
export function writeOmenChoice(registry, ranks, { storage: injected } = {}) {
  const storage = resolveStorage(injected);
  const slot = slotOf(registry);
  const clean = parseRanks(ranks);
  const empty = Object.keys(clean).length === 0;
  let stored = false;
  if (slot !== null && storage) {
    try {
      const key = getSlotOmensKey(slot);
      if (empty) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(clean));
      stored = true;
    } catch {
      stored = false;
    }
  }
  if (registry?.set) {
    const map = { ...registryMap(registry) };
    if (stored || empty) delete map[registryKey(registry)];
    else map[registryKey(registry)] = clean;
    registry.set(OMEN_CHOICE_REGISTRY_KEY, map);
  }
}
