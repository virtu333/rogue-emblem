// Freeing local save space when a write hits the storage quota.
//
// WebKit (the iOS app, Safari) allows about 5 MB of localStorage per origin,
// counted in bytes of the stored strings (two per character once a save holds
// any non-Latin-1 text, such as the arrows in battle history). A suspended
// battle carries up to ~0.5 MB of optional rewind history, so three slots with
// suspended battles can fill it. Before a save gives up, the other slots'
// optional history is shed in stages (see shedOptionalHistory) and the write
// is retried. The slot being written is never touched here: its own battle
// write already degrades through persistWithTimelineFallback.
import { MAX_SLOTS, getRunKey } from './SlotManager.js';
import { shedOptionalHistory } from './BattleTimelinePersistence.js';

export function isQuotaExceededError(err) {
  if (err?.name === 'QuotaExceededError' || err?.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.code === 22)
    return true;
  if (typeof err?.message === 'string' && /quota/i.test(err.message)) return true;
  return false;
}

/** Shed one stage of optional history from every other slot's run save. */
export function shedOtherSlotsHistory(excludeSlot, level, storage = globalThis.localStorage) {
  let freed = false;
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    if (slot === excludeSlot) continue;
    const key = getRunKey(slot);
    let run;
    try {
      const raw = storage.getItem(key);
      if (!raw) continue;
      run = JSON.parse(raw);
    } catch {
      continue;
    }
    const smaller = shedOptionalHistory(run, level);
    if (!smaller) continue;
    try {
      storage.setItem(key, JSON.stringify(smaller));
      freed = true;
    } catch {
      /* the store is too full even to shrink this entry */
    }
  }
  return freed;
}

/**
 * setItem that, on a quota error, sheds other slots' optional history stage by
 * stage and retries. Throws the last error when nothing more can be freed.
 */
export function setItemFreeingSpace(key, value, excludeSlot, storage = globalThis.localStorage) {
  try {
    storage.setItem(key, value);
    return { freed: false };
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
    let lastError = err;
    for (const level of [1, 2, 3]) {
      if (!shedOtherSlotsHistory(excludeSlot, level, storage)) continue;
      try {
        storage.setItem(key, value);
        return { freed: true, level };
      } catch (retryErr) {
        lastError = retryErr;
        if (!isQuotaExceededError(retryErr)) break;
      }
    }
    throw lastError;
  }
}
