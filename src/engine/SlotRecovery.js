// Raw recovery copies are deliberately separate from playable saves. Never rebuild
// default progression here: a healthy run cannot replace missing earned meta.
import {
  MAX_SLOTS,
  getSlotDataKeys,
  getSlotQuarantineKey,
  getSlotPairJournalKey,
  getSlotRecoveryOwnerKey,
  getSlotRecoveryOwner,
  getSlotCloudPendingKey,
  getMetaKey,
  getRunKey,
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
        ([getSlotRecoveryOwnerKey(slot), getSlotCloudPendingKey(slot)].includes(key) &&
          !Object.hasOwn(archive.values, key)) ||
        (Object.hasOwn(archive.values, key) &&
          (archive.values[key] === null || typeof archive.values[key] === 'string')),
    )
  )
    throw new Error('The recovery copy could not be read safely. Keep it for recovery.');
  archive.values[getSlotRecoveryOwnerKey(slot)] ??= null;
  archive.values[getSlotCloudPendingKey(slot)] ??= null;
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
    // Logout can assign ownership after the raw copy was prepared. Fold it in
    // before native acknowledgement and before deleting any canonical key.
    const ownerRaw = storage.getItem(getSlotRecoveryOwnerKey(slot));
    if (ownerRaw !== null && archive.values[getSlotRecoveryOwnerKey(slot)] !== ownerRaw) {
      archive.values[getSlotRecoveryOwnerKey(slot)] = ownerRaw;
      archive.savedAt = Math.max(Date.now(), (archive.savedAt || 0) + 1);
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
    let exportedOwner = snapshot[getSlotRecoveryOwnerKey(slot)];
    if (exportedOwner === null && snapshot[getSlotCloudPendingKey(slot)] !== null) {
      // Exporting an account-owned reservation must not assign it to whichever
      // account happens to be signed in when the archive is subsequently freed.
      exportedOwner = snapshot[getSlotCloudPendingKey(slot)];
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
          key === getSlotRecoveryOwnerKey(slot) ? exportedOwner : null,
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
    for (const key of getSlotDataKeys(slot).filter(
      (key) => key !== getSlotRecoveryOwnerKey(slot),
    )) {
      const current = storage.getItem(key);
      if (current !== null && current !== archive.values[key])
        throw new Error('The save changed after it was archived. Keep both copies for recovery.');
    }
    archive.discardStarted = true;
    checkedWrite(slot, archive, storage);
    for (const key of [
      ...getSlotDataKeys(slot).filter((key) => key !== getSlotRecoveryOwnerKey(slot)),
      getSlotRecoveryOwnerKey(slot),
    ]) {
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

/** Explicit account choice for a known unassigned, empty cloud reservation. */
export function claimUnassignedCloudPending(slot, userId, storage = globalThis.localStorage) {
  try {
    if (!validSlot(slot) || typeof userId !== 'string' || !userId.trim())
      throw new Error('Sign in to choose this account.');
    const key = getSlotCloudPendingKey(slot);
    const raw = storage.getItem(key);
    const pending = JSON.parse(raw);
    if (
      pending?.version !== 1 ||
      pending.userId !== null ||
      [
        getSlotQuarantineKey(slot),
        getSlotPairJournalKey(slot),
        getSlotRecoveryOwnerKey(slot),
        getMetaKey(slot),
        getRunKey(slot),
      ].some((recordKey) => storage.getItem(recordKey) !== null)
    )
      throw new Error('This reservation already belongs to an account or contains recovery data.');
    const next = JSON.stringify({
      ...pending,
      userId,
      savedAt: Math.max(Date.now(), (pending.savedAt || 0) + 1),
    });
    if (storage.getItem(key) !== raw)
      throw new Error('Cloud reservation changed. Review it again.');
    storage.setItem(key, next);
    if (storage.getItem(key) !== next)
      throw new Error('Could not verify your account choice. Keep the slot reserved.');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** Reserve Free before native acknowledgement; the archive remains until confirmed. */
export function prepareSlotCloudPending(slot, userId = null, storage = globalThis.localStorage) {
  try {
    const archive = readSlotArchive(slot, storage);
    if (archive?.state !== 'archived') throw new Error('Finish discard before freeing this slot.');
    const owner = getSlotRecoveryOwner(slot, storage);
    const existing = storage.getItem(getSlotCloudPendingKey(slot));
    if (existing !== null) return { ok: true, raw: existing };
    const raw = JSON.stringify({
      version: 1,
      userId: typeof owner === 'string' ? owner : userId,
      savedAt: Date.now(),
    });
    storage.setItem(getSlotCloudPendingKey(slot), raw);
    if (storage.getItem(getSlotCloudPendingKey(slot)) !== raw)
      throw new Error('Could not reserve cloud recovery. The copy was kept.');
    return { ok: true, raw };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** A separate, confirmed choice retires the last raw copy and frees the slot. */
export function retireSlotArchive(
  slot,
  storage = globalThis.localStorage,
  expectedArchiveRaw,
  expectedOwnerRaw,
  userId = null,
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
      getSlotDataKeys(slot).some(
        (key) =>
          key !== ownerKey && key !== getSlotCloudPendingKey(slot) && storage.getItem(key) !== null,
      )
    )
      throw new Error('Finish recovery or discard before freeing this slot.');
    const reserved = prepareSlotCloudPending(slot, userId, storage);
    if (!reserved.ok) throw new Error(reserved.reason);
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

/** Explicitly abandon cloud recovery; preserve all canonical bytes and cloud data. */
export function releaseSlotCloudPending(slot, expectedRaw, storage = globalThis.localStorage) {
  try {
    if (
      !validSlot(slot) ||
      typeof expectedRaw !== 'string' ||
      storage.getItem(getSlotCloudPendingKey(slot)) !== expectedRaw
    )
      throw new Error('The reservation changed. Review it again.');
    if (
      [getSlotQuarantineKey(slot), getSlotPairJournalKey(slot), getSlotRecoveryOwnerKey(slot)].some(
        (key) => storage.getItem(key) !== null,
      )
    )
      throw new Error(
        'Keep or resolve the remaining recovery data before releasing this reservation.',
      );
    storage.removeItem(getSlotCloudPendingKey(slot));
    if (storage.getItem(getSlotCloudPendingKey(slot)) !== null)
      throw new Error('Could not release the reservation. Retry.');
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/** The UI uses the same complete envelope size as the archive writer. */
export function slotArchiveByteSize(slot, storage = globalThis.localStorage) {
  const now = Date.now();
  return (
    JSON.stringify({
      version: 1,
      slot,
      state: 'archiving',
      discardStarted: true,
      at: now,
      savedAt: now,
      values: Object.fromEntries(getSlotDataKeys(slot).map((key) => [key, storage.getItem(key)])),
    }).length * 2
  );
}
