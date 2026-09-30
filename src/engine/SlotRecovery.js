// Raw recovery copies are deliberately separate from playable saves. Never rebuild
// default progression here: a healthy run cannot replace missing earned meta.
import {
  MAX_SLOTS,
  getSlotDataKeys,
  getSlotQuarantineKey,
  getSlotPairJournalKey,
} from './SlotManager.js';

function validSlot(slot) {
  return Number.isInteger(slot) && slot >= 1 && slot <= MAX_SLOTS;
}

export function readSlotArchive(slot, storage = globalThis.localStorage) {
  const raw = storage.getItem(getSlotQuarantineKey(slot));
  if (raw === null) return null;
  const archive = JSON.parse(raw);
  if (
    archive?.version !== 1 ||
    archive.slot !== slot ||
    !['archiving', 'archived'].includes(archive.state) ||
    !archive.values ||
    typeof archive.values !== 'object' ||
    !getSlotDataKeys(slot).every(
      (key) =>
        Object.hasOwn(archive.values, key) &&
        (archive.values[key] === null || typeof archive.values[key] === 'string'),
    )
  )
    throw new Error('The recovery copy could not be read safely. Keep it for recovery.');
  return archive;
}

/** Prepare without deleting; native callers persist this copy to disk before discard. */
export function archiveSlot(slot, storage = globalThis.localStorage) {
  if (!validSlot(slot)) return { ok: false, reason: 'Invalid save slot.' };
  try {
    if (storage.getItem(getSlotPairJournalKey(slot)) !== null)
      throw new Error('This slot has an unfinished save restore. Keep it for recovery.');
    let archive = readSlotArchive(slot, storage);
    if (archive?.state === 'archived')
      throw new Error('A recovery copy already exists. Review it before reusing this slot.');
    if (!archive) {
      const values = Object.fromEntries(
        getSlotDataKeys(slot).map((key) => [key, storage.getItem(key)]),
      );
      if (Object.values(values).every((value) => value === null))
        throw new Error('No save data to archive.');
      archive = {
        version: 1,
        slot,
        state: 'archiving',
        at: Date.now(),
        savedAt: Date.now(),
        values,
      };
      const raw = JSON.stringify(archive);
      storage.setItem(getSlotQuarantineKey(slot), raw);
      if (storage.getItem(getSlotQuarantineKey(slot)) !== raw)
        throw new Error('Could not verify the recovery copy. The save was kept.');
    }
    return { ok: true, archive, raw: storage.getItem(getSlotQuarantineKey(slot)) };
  } catch (err) {
    return {
      ok: false,
      reason: err?.message || 'Could not archive this save. Nothing was removed.',
    };
  }
}

/** Native callers must durably mirror archiveSlot's copy before invoking discard. */
export function archiveAndDiscardSlot(slot, storage = globalThis.localStorage, expectedArchiveRaw) {
  const prepared = archiveSlot(slot, storage);
  if (!prepared.ok) return prepared;
  if (expectedArchiveRaw !== undefined && prepared.raw !== expectedArchiveRaw)
    return { ok: false, reason: 'The recovery copy changed. Review it before discarding.' };
  const archive = prepared.archive;
  try {
    // A previous deletion may have stopped partway. Do not delete new data written
    // by another tab/cloud job since the copy was made.
    for (const key of getSlotDataKeys(slot)) {
      const current = storage.getItem(key);
      if (current !== null && current !== archive.values[key])
        throw new Error('The save changed after it was archived. Keep both copies for recovery.');
    }
    for (const key of getSlotDataKeys(slot)) {
      storage.removeItem(key);
      if (storage.getItem(key) !== null)
        throw new Error('Could not finish discarding the save. Retry.');
    }
    const raw = JSON.stringify({
      ...archive,
      state: 'archived',
      savedAt: Math.max(Date.now(), (archive.savedAt || 0) + 1),
    });
    storage.setItem(getSlotQuarantineKey(slot), raw);
    if (storage.getItem(getSlotQuarantineKey(slot)) !== raw)
      throw new Error('Could not verify discard completion. The recovery copy was kept.');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err?.message || 'Could not archive this save. Nothing else was removed.',
    };
  }
}

/** A separate, confirmed choice retires the last raw copy and frees the slot. */
export function retireSlotArchive(slot, storage = globalThis.localStorage) {
  if (!validSlot(slot)) return { ok: false, reason: 'Invalid save slot.' };
  try {
    const archive = readSlotArchive(slot, storage);
    if (
      archive?.state !== 'archived' ||
      storage.getItem(getSlotPairJournalKey(slot)) !== null ||
      getSlotDataKeys(slot).some((key) => storage.getItem(key) !== null)
    )
      throw new Error('Finish recovery or discard before freeing this slot.');
    storage.removeItem(getSlotQuarantineKey(slot));
    if (storage.getItem(getSlotQuarantineKey(slot)) !== null)
      throw new Error('Could not free this slot. Retry.');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'Could not free this slot.' };
  }
}
