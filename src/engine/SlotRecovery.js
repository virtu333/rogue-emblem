// Raw recovery copies are deliberately separate from playable saves. Never rebuild
// default progression here: a healthy run cannot replace missing earned meta.
import {
  MAX_SLOTS,
  getSlotDataKeys,
  getSlotQuarantineKey,
  getSlotPairJournalKey,
  getSlotRecoveryOwnerKey,
} from './SlotManager.js';

function validSlot(slot) {
  return Number.isInteger(slot) && slot >= 1 && slot <= MAX_SLOTS;
}

export const MAX_SLOT_ARCHIVE_BYTES = 1024 * 1024;

function checkedWrite(slot, archive, storage) {
  const raw = JSON.stringify(archive);
  // Bound each of the three archives; quota/oversize failure preserves the originals.
  if (raw.length * 2 > MAX_SLOT_ARCHIVE_BYTES)
    throw new Error(
      'This save is too large to archive here. Export the raw save before discarding.',
    );
  storage.setItem(getSlotQuarantineKey(slot), raw);
  if (storage.getItem(getSlotQuarantineKey(slot)) !== raw)
    throw new Error('Could not verify the recovery copy. The save was kept.');
  return raw;
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
        (key === getSlotRecoveryOwnerKey(slot) && !Object.hasOwn(archive.values, key)) ||
        (Object.hasOwn(archive.values, key) &&
          (archive.values[key] === null || typeof archive.values[key] === 'string')),
    )
  )
    throw new Error('The recovery copy could not be read safely. Keep it for recovery.');
  archive.values[getSlotRecoveryOwnerKey(slot)] ??= null;
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
      checkedWrite(slot, archive, storage);
    }
    return { ok: true, archive, raw: storage.getItem(getSlotQuarantineKey(slot)) };
  } catch (err) {
    return {
      ok: false,
      reason: err?.message || 'Could not archive this save. Nothing was removed.',
    };
  }
}

/** Replace a pending copy only while all original non-absent keys still exist. */
export function retakeSlotArchive(slot, storage = globalThis.localStorage) {
  try {
    const previous = readSlotArchive(slot, storage);
    if (
      previous?.state !== 'archiving' ||
      previous.discardStarted ||
      storage.getItem(getSlotPairJournalKey(slot)) !== null ||
      getSlotDataKeys(slot).some(
        (key) => previous.values[key] !== null && storage.getItem(key) === null,
      )
    )
      throw new Error('Original data has already been removed. Keep or export the recovery copy.');
    const archive = {
      ...previous,
      values: Object.fromEntries(getSlotDataKeys(slot).map((key) => [key, storage.getItem(key)])),
      savedAt: Math.max(Date.now(), (previous.savedAt || 0) + 1),
    };
    checkedWrite(slot, archive, storage);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'Could not retake this copy.' };
  }
}

/** Forget only the recovery record; canonical and cloud data are never removed. */
export function forgetSlotArchive(slot, storage = globalThis.localStorage, expectedRaw) {
  if (!validSlot(slot)) return { ok: false, reason: 'Invalid save slot.' };
  try {
    if (expectedRaw !== undefined && storage.getItem(getSlotQuarantineKey(slot)) !== expectedRaw)
      throw new Error('The recovery copy changed. Review the current copy first.');
    storage.removeItem(getSlotQuarantineKey(slot));
    if (storage.getItem(getSlotQuarantineKey(slot)) !== null)
      throw new Error('Could not remove copy.');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'Could not remove copy.' };
  }
}

/** The player explicitly attests that the exported raw bundle is saved and checked. */
export function discardExportedSlot(slot, snapshot, confirmed, storage = globalThis.localStorage) {
  if (!validSlot(slot) || confirmed !== true)
    return { ok: false, reason: 'Verify your export first.' };
  const keys = [...getSlotDataKeys(slot), getSlotQuarantineKey(slot), getSlotPairJournalKey(slot)];
  try {
    if (
      !keys.every(
        (key) => Object.hasOwn(snapshot || {}, key) && storage.getItem(key) === snapshot[key],
      )
    )
      throw new Error('The save changed since export. Export and check the new data first.');
    const anchor = JSON.stringify({ _exportDiscardPending: true, savedAt: Date.now() });
    // Replace a sufficiently large canonical string in place before adding a key.
    // This is explicit discard of bytes already verified by the player in an export;
    // it creates room without touching another slot or losing recovery evidence.
    const anchorKey = getSlotDataKeys(slot)
      .filter((key) => /_(meta|run|cloud_conflict)$/.test(key))
      .sort((a, b) => (snapshot[b]?.length || 0) - (snapshot[a]?.length || 0))
      .find((key) => snapshot[key]?.length >= anchor.length);
    if (anchorKey) {
      storage.setItem(anchorKey, anchor);
      if (storage.getItem(anchorKey) !== anchor) throw new Error('Could not begin local discard.');
    }
    const record = {
      version: 1,
      slot,
      state: 'archiving',
      discardStarted: true,
      externalCopy: true,
      savedAt: Date.now(),
      values: Object.fromEntries(
        getSlotDataKeys(slot).map((key) => [
          key,
          key === getSlotRecoveryOwnerKey(slot) ? snapshot[key] : null,
        ]),
      ),
    };
    checkedWrite(slot, record, storage);
    for (const key of [...getSlotDataKeys(slot), getSlotPairJournalKey(slot)]) {
      storage.removeItem(key);
      if (storage.getItem(key) !== null)
        throw new Error('Could not finish local discard. Keep your export and retry.');
    }
    checkedWrite(slot, { ...record, state: 'archived' }, storage);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'Could not discard local data. Keep your export.' };
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
    checkedWrite(slot, { ...archive, discardStarted: true }, storage);
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
export function retireSlotArchive(
  slot,
  storage = globalThis.localStorage,
  expectedArchiveRaw,
  expectedOwnerRaw,
) {
  if (!validSlot(slot)) return { ok: false, reason: 'Invalid save slot.' };
  try {
    const archive = readSlotArchive(slot, storage);
    const ownerKey = getSlotRecoveryOwnerKey(slot);
    if (
      expectedArchiveRaw !== undefined &&
      storage.getItem(getSlotQuarantineKey(slot)) !== expectedArchiveRaw
    )
      throw new Error('The recovery copy changed. Review the current copy first.');
    if (expectedOwnerRaw !== undefined && storage.getItem(ownerKey) !== expectedOwnerRaw)
      throw new Error('The recovery owner changed. Review the current copy first.');
    if (
      archive?.state !== 'archived' ||
      storage.getItem(getSlotPairJournalKey(slot)) !== null ||
      getSlotDataKeys(slot).some((key) => key !== ownerKey && storage.getItem(key) !== null)
    )
      throw new Error('Finish recovery or discard before freeing this slot.');
    storage.removeItem(getSlotQuarantineKey(slot));
    if (storage.getItem(getSlotQuarantineKey(slot)) !== null)
      throw new Error('Could not free this slot. Retry.');
    // Ownership remains intact through acknowledgement/cancellation and until
    // the copy itself is gone. If this deletion fails, the owner marker still
    // reserves the slot and can be archived/discarded through recovery.
    try {
      storage.removeItem(ownerKey);
      if (storage.getItem(ownerKey) !== null) throw new Error('Could not verify owner cleanup.');
    } catch {
      throw new Error(
        'The copy was removed but ownership cleanup failed. Archive and discard the remaining recovery record, then free the slot.',
      );
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'Could not free this slot.' };
  }
}
