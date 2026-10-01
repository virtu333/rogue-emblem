import { getMetaKey, getRunKey, getMetaClockFloorKey, getRunClockFloorKey } from './SlotManager.js';

/** A recovered canonical save must outrank the native record it replaces. */
export function stampPendingCloudPair(slot, run, meta, storage, mirror, now = Date.now()) {
  return [
    [getMetaKey(slot), getMetaClockFloorKey(slot), meta],
    [getRunKey(slot), getRunClockFloorKey(slot), run],
  ].map(([key, floorKey, value]) => {
    if (value === null) return [key, null];
    const record = mirror?.records?.get(key);
    let nativeStamp = null;
    let localStamp = null;
    try {
      nativeStamp = typeof record?.value === 'string' ? JSON.parse(record.value)?.savedAt : null;
    } catch {
      /* An unreadable old record cannot lower the known stamp floor. */
    }
    try {
      localStamp = JSON.parse(storage.getItem(key))?.savedAt;
    } catch {
      /* Empty recovery slot. */
    }
    const floors = [
      mirror?.stamps?.get(key),
      record?.savedAt,
      record?.deletedSavedAt,
      nativeStamp,
      localStamp,
      Number(storage.getItem(floorKey)),
    ].filter(Number.isFinite);
    const savedAt = Math.max(
      now,
      Number.isFinite(value.savedAt) ? value.savedAt : 0,
      ...floors.map((stamp) => stamp + 1),
    );
    return [key, JSON.stringify({ ...value, savedAt })];
  });
}
