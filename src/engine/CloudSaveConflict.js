import { getRunKey, getMetaKey } from './SlotManager.js';

export const cloudConflictKey = (slot) => `emblem_rogue_slot_${slot}_cloud_conflict`;
export function getCloudSaveConflict(slot) {
  try {
    return JSON.parse(localStorage.getItem(cloudConflictKey(slot)) || 'null');
  } catch {
    return null;
  }
}
function materialJSON(value) {
  if (Array.isArray(value)) return value.map(materialJSON);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((k) => k !== 'savedAt')
      .sort()
      .map((k) => [k, materialJSON(value[k])]),
  );
}
export function hasMaterialRunDifference(local, cloud) {
  return JSON.stringify(materialJSON(local)) !== JSON.stringify(materialJSON(cloud));
}

// Preserve the displaced device run before applying a newer cloud version.
// A failed backup must never overwrite the only copy of local progress.
export function preserveCloudConflict(slot, localRun, cloudRun, cloudMeta) {
  if (!localRun || !cloudRun || !hasMaterialRunDifference(localRun, cloudRun)) return true;
  try {
    const existing = getCloudSaveConflict(slot);
    const record = existing
      ? {
          ...existing,
          cloudRun,
          cloudMeta: cloudMeta === undefined ? existing.cloudMeta : cloudMeta,
        }
      : {
          localRun,
          cloudRun,
          cloudMeta:
            cloudMeta === undefined
              ? JSON.parse(localStorage.getItem(getMetaKey(slot)) || 'null')
              : cloudMeta,
          localMeta: JSON.parse(localStorage.getItem(getMetaKey(slot)) || 'null'),
          recordedAt: Date.now(),
        };
    localStorage.setItem(cloudConflictKey(slot), JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function resolveCloudSaveConflict(slot, choice) {
  const conflict = getCloudSaveConflict(slot);
  if (!conflict) return { ok: true };
  if (!['local', 'cloud'].includes(choice)) return { ok: false, reason: 'Choose a save version.' };
  const runKey = getRunKey(slot);
  const metaKey = getMetaKey(slot);
  const previousRun = localStorage.getItem(runKey);
  const previousMeta = localStorage.getItem(metaKey);
  try {
    const currentRun = JSON.parse(previousRun || 'null');
    const currentMeta = JSON.parse(previousMeta || 'null');
    const selectedRun = choice === 'local' ? conflict.localRun : conflict.cloudRun;
    const selectedMeta = choice === 'local' ? conflict.localMeta : conflict.cloudMeta;
    if (
      !selectedRun ||
      !selectedMeta ||
      typeof selectedMeta !== 'object' ||
      Array.isArray(selectedMeta)
    ) {
      return {
        ok: false,
        reason:
          'This version is missing progression data. Keep the other version or retry cloud sync before choosing.',
      };
    }
    const savedAt = Math.max(
      Date.now(),
      (currentRun?.savedAt || 0) + 1,
      (currentMeta?.savedAt || 0) + 1,
      (conflict.cloudRun?.savedAt || 0) + 1,
      (conflict.cloudMeta?.savedAt || 0) + 1,
    );
    localStorage.setItem(
      runKey,
      JSON.stringify(choice === 'local' ? { ...selectedRun, savedAt } : selectedRun),
    );
    if (selectedMeta)
      localStorage.setItem(
        metaKey,
        JSON.stringify(choice === 'local' ? { ...selectedMeta, savedAt } : selectedMeta),
      );
    else localStorage.removeItem(metaKey);
    const run = JSON.parse(localStorage.getItem(runKey) || 'null');
    const meta = JSON.parse(localStorage.getItem(metaKey) || 'null');
    localStorage.removeItem(cloudConflictKey(slot));
    return { ok: true, run, meta };
  } catch {
    try {
      if (previousRun == null) localStorage.removeItem(runKey);
      else localStorage.setItem(runKey, previousRun);
      if (previousMeta == null) localStorage.removeItem(metaKey);
      else localStorage.setItem(metaKey, previousMeta);
    } catch {
      /* Preserved conflict remains available for recovery. */
    }
    return {
      ok: false,
      reason: 'Could not save this choice. Free some device storage and try again.',
    };
  }
}

export function describeSavedRun(run) {
  if (!run) return 'No active run';
  const roster = (run.roster || [])
    .slice(0, 3)
    .map((unit) => unit.name)
    .join(', ');
  const location = run.nodeMap?.nodes?.find((node) => node.id === run.currentNodeId);
  const saved = Number.isFinite(run.savedAt)
    ? new Date(run.savedAt).toLocaleString()
    : 'time unavailable';
  return `${roster || 'Army'} · Act ${(run.actIndex || 0) + 1} · ${run.completedBattles || 0} battles won · ${run.gold || 0} gold · ${run.battleInProgress?.checkpoint ? 'Battle suspended' : location ? `${location.type} node` : 'Act start'} · Saved ${saved}`;
}
