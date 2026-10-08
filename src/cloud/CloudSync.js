import { mergeRunRecords } from '../engine/RunRecords.js';
import { lordsMetOfMetaSave, mergeLordNames } from '../engine/LordsMet.js';
import {
  normalizePrologueState,
  reconcilePickedPrologue,
} from '../engine/MetaProgressionManager.js';
import { grant as PROLOGUE_GRANT } from '../../data/prologue.json';
import { normalizeSettings } from '../utils/SettingsManager.js';
import { stampPendingCloudPair } from '../engine/CloudPendingRecovery.js';
import { nativeCapacitor, getNativeSaveMirror } from '../utils/nativeSaveMirror.js';
import { preserveCloudConflict } from '../engine/CloudSaveConflict.js';
import { isPrologueRun } from '../engine/ScriptedBattle.js';
// CloudSync.js — Fire-and-forget cloud save/load via Supabase
// All methods catch errors and console.warn — never throw.
// Stores per-slot data as { "1": {...}, "2": {...}, "3": {...} } in a single Supabase row.

import { supabase } from './supabaseClient.js';
import {
  getMetaClockFloorKey,
  getMetaKey,
  getRunClockFloorKey,
  getRunKey,
  hasSlotRecoveryRecord,
  getSlotSummary,
  getSlotCloudPendingKey,
  getSlotQuarantineKey,
  getSlotPairJournalKey,
  getSlotRecoveryOwnerKey,
  isReadableRunShape,
  isReadableMetaShape,
  isSlotKeptAtLogout,
  MAX_SLOTS,
} from '../engine/SlotManager.js';
import { markStartup } from '../utils/startupTelemetry.js';
import { reportAsyncError } from '../utils/errorReporter.js';

const TABLES = {
  run: 'run_saves',
  meta: 'meta_progression',
  settings: 'user_settings',
};

const SETTINGS_LS_KEY = 'emblem_rogue_settings';
const FETCH_TIMEOUT_MS = 2000;
const SLOT_WRITE_MAX_ATTEMPTS = 3;
const AUTH_EXPIRED_USER_MESSAGE = 'Cloud sync unavailable: local saves only until re-auth.';
const CLOUD_UPDATE_SLOT_CONFLICT_REMOTE_NEWER = 'cloud_update_slot_conflict_remote_newer';
const CLOUD_UPDATE_SLOT_FRESH_LOCAL_BLOCKED = 'cloud_update_slot_fresh_local_blocked';
const REMOTE_NEWER_WARN_SIGNATURE_LIMIT = 256;
const FLUSH_QUEUE_TIMEOUT_MS = 6000;

const cloudSyncStatus = {
  mode: 'ok',
  authExpired: false,
  message: '',
  context: null,
  code: null,
  updatedAt: null,
};

export function getCloudSyncStatus() {
  if (
    cloudSyncStatus.mode === 'local_only' &&
    ![...protectedBackupReported].some((signature) =>
      protectedLocalSlot(Number(signature.slice(signature.lastIndexOf(':') + 1))),
    )
  )
    resetCloudSyncStatus();
  return cloudSyncStatus;
}

function resetCloudSyncStatus() {
  cloudSyncStatus.mode = 'ok';
  cloudSyncStatus.authExpired = false;
  cloudSyncStatus.message = '';
  cloudSyncStatus.context = null;
  cloudSyncStatus.code = null;
  cloudSyncStatus.updatedAt = null;
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/**
 * Detect old flat cloud format (no "1"/"2"/"3" keys) and wrap as slot 1.
 * New format: { "1": {...}, "2": {...}, "3": {...} }
 * Old format: { totalRenown: ..., ... } (flat meta/run data)
 */
function migrateCloudData(cloudData) {
  if (!cloudData || typeof cloudData !== 'object') return {};
  // If it already has slot keys, return as-is
  if (
    cloudData['1'] !== undefined ||
    cloudData['2'] !== undefined ||
    cloudData['3'] !== undefined
  ) {
    return cloudData;
  }
  // Old flat format — wrap as slot 1 (only if non-empty object)
  if (Object.keys(cloudData).length > 0) {
    return { 1: cloudData };
  }
  return {};
}

/**
 * Fetch a single table's data for a user.
 * Returns the data field or null.
 */
async function fetchTable(userId, table, accessToken) {
  const row = await fetchTableRow(userId, table, accessToken);
  return row.data;
}

async function fetchTableRow(userId, table, accessToken) {
  if (!supabase) return { exists: false, data: null, updatedAt: null };
  let query = supabase.from(table).select('data,updated_at').eq('user_id', userId);
  // Bind pending recovery to the verified account. The SDK can otherwise
  // substitute its anonymous key if auth disappears just before request send.
  if (accessToken) query = query.setHeader('Authorization', `Bearer ${accessToken}`);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return { exists: false, data: null, updatedAt: null };
  return {
    exists: true,
    data: data.data ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

function protectedLocalSlot(slot) {
  try {
    return (
      hasSlotRecoveryRecord(slot) ||
      getSlotSummary(slot)?.recoveryRequired === true ||
      localStorage.getItem(`emblem_rogue_slot_${slot}_cloud_conflict`) !== null
    );
  } catch {
    return true;
  }
}

// Serialize within a tab; byte checks also protect against another tab writing
// during native acknowledgements. Exact owned writes permit a local retry only.
const pendingRecoveryQueues = new Map();
const pendingRecoveryWrites = new Map();

async function authenticatedSession(userId) {
  try {
    const result = await withTimeout(supabase.auth?.getSession?.(), FETCH_TIMEOUT_MS);
    const session = result?.data?.session;
    return !result?.error &&
      session?.user?.id === userId &&
      typeof session.access_token === 'string' &&
      session.access_token
      ? session
      : null;
  } catch {
    return null;
  }
}

async function ownsAuthenticatedSession(userId) {
  return (await authenticatedSession(userId)) !== null;
}

async function applyPendingCloudSlot(userId, slot, runSlots, metaSlots) {
  const key = getSlotCloudPendingKey(slot);
  let originalPendingRaw;
  let mirror;
  let retiredByUs = false;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return;
    originalPendingRaw = raw;
    const pending = JSON.parse(raw);
    if (pending?.version !== 1 || pending.userId !== userId) return;
    if (!(await ownsAuthenticatedSession(userId))) return;
    const recoveryKeys = [
      getSlotQuarantineKey(slot),
      getSlotPairJournalKey(slot),
      getSlotRecoveryOwnerKey(slot),
    ];
    const canonicalKeys = [getMetaKey(slot), getRunKey(slot)];
    const previous = pendingRecoveryWrites.get(slot);
    const expected =
      previous?.raw === raw
        ? previous.values
        : new Map(canonicalKeys.map((recordKey) => [recordKey, null]));
    const isUnchanged = () =>
      localStorage.getItem(key) === raw &&
      recoveryKeys.every((recordKey) => localStorage.getItem(recordKey) === null) &&
      canonicalKeys.every(
        (recordKey) => localStorage.getItem(recordKey) === expected.get(recordKey),
      );
    // Nonempty local data without an owned write proof belongs to another writer.
    // Keep both it and the reservation. Never replace it with a cloud fetch.
    if (!isUnchanged()) return;
    const run = runSlots[String(slot)] ?? null;
    const meta = metaSlots[String(slot)] ?? null;
    if (
      (run !== null && !isReadableRunShape(run)) ||
      (meta !== null && !isReadableMetaShape(meta)) ||
      (run !== null && meta === null)
    )
      return;
    mirror = nativeCapacitor() ? getNativeSaveMirror() : null;
    if (nativeCapacitor() && !mirror)
      throw new Error('Device backup is unavailable. Cloud recovery stays reserved.');
    if (mirror && !(await mirror.ensureDurable(key, raw)))
      throw new Error('Cloud reservation device backup failed.');
    if (!isUnchanged() || !(await ownsAuthenticatedSession(userId)) || !isUnchanged()) return;
    const canonical = mirror
      ? stampPendingCloudPair(slot, run, meta, localStorage, mirror)
      : [
          [getMetaKey(slot), meta === null ? null : JSON.stringify(meta)],
          [getRunKey(slot), run === null ? null : JSON.stringify(run)],
        ];
    pendingRecoveryWrites.set(slot, { raw, values: expected });
    for (const [canonicalKey, valueRaw] of canonical) {
      if (!isUnchanged()) throw new Error('cloud reservation or local save changed');
      if (valueRaw === null) localStorage.removeItem(canonicalKey);
      else localStorage.setItem(canonicalKey, valueRaw);
      expected.set(canonicalKey, valueRaw);
      if (!isUnchanged()) throw new Error('cloud recovery write failed');
      if (mirror && !(await mirror.ensureDurable(canonicalKey, valueRaw)))
        throw new Error('Recovered save device backup failed.');
    }
    if (!isUnchanged() || !(await ownsAuthenticatedSession(userId)) || !isUnchanged()) return;
    localStorage.removeItem(key);
    retiredByUs = true;
    if (localStorage.getItem(key) !== null) throw new Error('cloud reservation clear failed');
    if (mirror && !(await mirror.ensureDurable(key, null)))
      throw new Error('Cloud reservation retirement device backup failed.');
    pendingRecoveryWrites.delete(slot);
  } catch (err) {
    // Only our retirement may be undone. A released/replaced reservation is final
    // for this operation; a stale fetch cannot resurrect it after an await.
    try {
      if (mirror && retiredByUs && originalPendingRaw && localStorage.getItem(key) === null)
        localStorage.setItem(key, originalPendingRaw);
    } catch {
      /* Acknowledged canonical data still survives on disk. */
    }
    reportCloudFailure('cloud_pending_recovery', err, { slot });
  }
}

async function applyPendingCloudSlots(userId, runData, metaData, fetchSession) {
  // A reservation created during an ordinary fetch must wait for a new,
  // bearer-bound fetch. Retrospective authentication cannot validate its rows.
  if (!fetchSession) return;
  const runSlots = migrateCloudData(runData);
  const metaSlots = migrateCloudData(metaData);
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const previous = pendingRecoveryQueues.get(slot) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(() => applyPendingCloudSlot(userId, slot, runSlots, metaSlots));
    pendingRecoveryQueues.set(slot, next);
    try {
      await next;
    } finally {
      if (pendingRecoveryQueues.get(slot) === next) pendingRecoveryQueues.delete(slot);
    }
  }
}

function applyRunSlots(runData, metaData, reservedAtStart = new Set()) {
  const runSlots = migrateCloudData(runData);
  const metaSlots = migrateCloudData(metaData);
  const skipped = new Set();
  for (let i = 1; i <= MAX_SLOTS; i++) {
    if (reservedAtStart.has(i) || protectedLocalSlot(i)) {
      skipped.add(i);
      continue;
    }
    const key = getRunKey(i);
    const cloudSlot = runSlots[String(i)];
    if (cloudSlot == null) continue;
    if (
      !isCloudSlotPayload(metaSlots[String(i)]) &&
      !isCloudSlotPayload(readLocalJSON(getMetaKey(i)))
    ) {
      skipped.add(i);
      continue;
    }

    const localState = readLocalJSONWithState(key);
    if (localState.parseError) {
      // Another tab may have changed the slot after inspection. Raw damaged
      // data still needs an explicit recovery decision before replacement.
      skipped.add(i);
      continue;
    }

    if (!localState.exists) {
      try {
        localStorage.setItem(key, JSON.stringify(cloudSlot));
      } catch (e) {
        skipped.add(i);
        console.warn('[CloudSync] localStorage write failed:', key, e);
      }
      continue;
    }

    const shouldKeepLocal = shouldPreferLocalRun(localState.value, cloudSlot, i);
    if (!shouldKeepLocal) {
      if (!preserveCloudConflict(i, localState.value, cloudSlot, metaSlots[String(i)] ?? null)) {
        skipped.add(i);
        console.warn('[CloudSync] kept local run because conflict backup could not be saved:', i);
        continue;
      }
      try {
        localStorage.setItem(key, JSON.stringify(cloudSlot));
      } catch (e) {
        skipped.add(i);
        console.warn('[CloudSync] localStorage write failed:', key, e);
      }
    }
  }
  return skipped;
}

function applyMetaSlots(metaData, skipped = new Set()) {
  const metaSlots = migrateCloudData(metaData);
  for (let i = 1; i <= MAX_SLOTS; i++) {
    if (
      skipped.has(i) ||
      hasSlotRecoveryRecord(i) ||
      localStorage.getItem(`emblem_rogue_slot_${i}_cloud_conflict`) !== null
    )
      continue;
    const key = getMetaKey(i);
    const cloudSlot = metaSlots[String(i)];
    if (cloudSlot == null) continue;
    const localSlot = readLocalJSON(key);
    const shouldKeepLocal = shouldPreferLocalMeta(localSlot, cloudSlot);
    const records = mergeRunRecords(localSlot?.runRecords || [], cloudSlot?.runRecords || []);
    // Lords met on either copy stay met (a union, like the run records).
    const localLords = lordsMetOfMetaSave(localSlot);
    const lordsMet = mergeLordNames(localLords, lordsMetOfMetaSave(cloudSlot));
    // The prologue on either copy: the further state, the chapters and lessons unioned;
    // the grant's receipt only from the payload whose economy is kept (a completion the
    // other copy brought is paid into it once: reconcilePickedPrologue).
    const winner = shouldKeepLocal ? localSlot : cloudSlot;
    const hasPrologue = localSlot?.prologue != null || cloudSlot?.prologue != null;
    const reconciled = hasPrologue
      ? reconcilePickedPrologue(winner, shouldKeepLocal ? cloudSlot : localSlot, PROLOGUE_GRANT)
      : null;
    const prologue = reconciled?.prologue ?? null;
    const prologueChanged =
      hasPrologue &&
      JSON.stringify(prologue) !== JSON.stringify(normalizePrologueState(localSlot?.prologue));
    if (
      !shouldKeepLocal ||
      JSON.stringify(records) !== JSON.stringify(localSlot?.runRecords || []) ||
      lordsMet.length > localLords.length ||
      prologueChanged
    ) {
      try {
        // A repaired copy is a new write: newer than both, so the next fetch keeps it.
        const selected =
          shouldKeepLocal || reconciled?.economy
            ? { ...winner, savedAt: Math.max(Date.now(), Number(winner.savedAt || 0) + 1) }
            : cloudSlot;
        const merged = records.length ? { ...selected, runRecords: records } : selected;
        localStorage.setItem(
          key,
          JSON.stringify({
            ...merged,
            lordsMet,
            ...(prologue ? { prologue } : {}),
            ...(reconciled?.economy ?? {}),
          }),
        );
      } catch (e) {
        console.warn('[CloudSync] localStorage write failed:', key, e);
      }
    }
  }
}

function applySettings(settingsData) {
  // No cloud row is not a request to reset local preferences.
  if (!settingsData) return;
  try {
    const local = readLocalJSON(SETTINGS_LS_KEY);
    const localTime = Number(local?.savedAt) || 0;
    const cloudTime = Number(settingsData.savedAt) || 0;
    if (local && localTime >= cloudTime) return;
    localStorage.setItem(
      SETTINGS_LS_KEY,
      JSON.stringify({ ...normalizeSettings(settingsData), savedAt: cloudTime || Date.now() }),
    );
    globalThis.dispatchEvent?.(new Event('emblem-settings-hydrated'));
  } catch (e) {
    console.warn('[CloudSync] localStorage write failed:', SETTINGS_LS_KEY, e);
  }
}

/**
 * Fetch all tables for a user and write to slot-specific localStorage keys.
 * Called once on login, before Phaser boots.
 */
export async function fetchAllToLocalStorage(userId, options = {}) {
  if (!supabase) return { rejectedCount: 0, deferredReservationSlots: [] };
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : FETCH_TIMEOUT_MS;

  markStartup('cloud_sync_start', { timeoutMs });

  let reservedAtStart;
  try {
    reservedAtStart = new Set(
      Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).filter(
        (slot) => localStorage.getItem(getSlotCloudPendingKey(slot)) !== null,
      ),
    );
  } catch (err) {
    reportCloudFailure('cloud_pending_inspection', err);
    return { rejectedCount: 1, deferredReservationSlots: [] };
  }

  const fetchSession = reservedAtStart.size ? await authenticatedSession(userId) : null;
  let deferredReservationSlots = fetchSession ? [] : [...reservedAtStart];
  if (deferredReservationSlots.length)
    reportCloudFailure(
      'cloud_pending_session_unavailable',
      new Error('Cloud recovery session could not be verified.'),
      {
        slots: deferredReservationSlots,
      },
    );
  // A reservation needs a bearer-bound fetch, but it must not block unrelated
  // slots and settings. Ordinary hydration still respects each local protection.

  const [runRes, metaRes, settingsRes] = await Promise.allSettled([
    withTimeout(fetchTable(userId, TABLES.run, fetchSession?.access_token), timeoutMs),
    withTimeout(fetchTable(userId, TABLES.meta, fetchSession?.access_token), timeoutMs),
    withTimeout(fetchTable(userId, TABLES.settings, fetchSession?.access_token), timeoutMs),
  ]);

  let skippedRunSlots = new Set();
  if (runRes.status === 'fulfilled') {
    // Apply run/progression as a fetched pair. A partial fetch must not mix
    // another device's run with this device's progression. Settings are independent.
    if (metaRes.status === 'fulfilled') {
      await applyPendingCloudSlots(userId, runRes.value, metaRes.value, fetchSession);
      skippedRunSlots = applyRunSlots(runRes.value, metaRes.value, reservedAtStart);
    }
  } else {
    console.warn('CloudSync fetch run_saves:', runRes.reason);
    reportCloudFailure('cloud_fetch_table', runRes.reason, { table: TABLES.run });
  }

  if (metaRes.status === 'fulfilled') {
    if (runRes.status === 'fulfilled') applyMetaSlots(metaRes.value, skippedRunSlots);
  } else {
    console.warn('CloudSync fetch meta_progression:', metaRes.reason);
    reportCloudFailure('cloud_fetch_table', metaRes.reason, { table: TABLES.meta });
  }

  if (settingsRes.status === 'fulfilled') {
    applySettings(settingsRes.value);
  } else {
    console.warn('CloudSync fetch user_settings:', settingsRes.reason);
    reportCloudFailure('cloud_fetch_table', settingsRes.reason, { table: TABLES.settings });
  }

  const rejected = [runRes, metaRes, settingsRes].filter((r) => r.status === 'rejected');
  const hasAuthExpiryFailure = rejected.some((r) => isAuthExpiryError(r.reason));
  if (!hasAuthExpiryFailure && rejected.length === 0) {
    clearAuthExpiredStatusOnSuccess();
  }
  const timeoutFailures = rejected.filter((r) => r.reason?.message === 'timeout').length;
  markStartup('cloud_sync_complete', {
    rejectedCount: rejected.length,
    timeoutFailures,
  });
  getCloudSyncStatus(); // Refresh the shared notice after a reservation was resolved.
  try {
    // Include recovery deferred after the fetch too (auth loss, missing pair,
    // or native acknowledgement). Background retry is bounded by main.js.
    deferredReservationSlots = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).filter(
      (slot) => localStorage.getItem(getSlotCloudPendingKey(slot)) !== null,
    );
  } catch (err) {
    reportCloudFailure('cloud_pending_inspection', err);
    return { rejectedCount: rejected.length + 1, deferredReservationSlots: [...reservedAtStart] };
  }
  return { rejectedCount: rejected.length, deferredReservationSlots };
}

/** Background pulls retry deferred reservations instead of treating partial hydration as success. */
export function isCloudHydrationComplete(result) {
  return result?.rejectedCount === 0 && (result.deferredReservationSlots?.length ?? 0) === 0;
}

/**
 * The payload a queued write sends, frozen when it is queued. Callers hand over the
 * object they just wrote to localStorage, and some of it is live state (a run's roster
 * and convoy, the meta's records); the write itself waits behind earlier writes and a
 * remote read, so without this it would serialize whatever the game had changed since:
 * a reward claimed after the save, beside the contract that save still owes. The JSON
 * round trip is the local write's own serialization, so the cloud gets exactly the
 * payload, savedAt included, that was saved on the device at that moment.
 */
function snapshotSlotPayload(slotData) {
  return slotData == null ? slotData : JSON.parse(JSON.stringify(slotData));
}

/**
 * Read-modify-write helper: fetch current cloud slot map, update one slot, upsert back.
 */
async function updateSlotInTable(userId, table, slot, liveSlotData, options = {}) {
  const slotData = snapshotSlotPayload(liveSlotData);
  const configuredAttempts = Number.isFinite(options.maxAttempts)
    ? Math.floor(options.maxAttempts)
    : SLOT_WRITE_MAX_ATTEMPTS;
  const maxAttempts = Math.max(1, configuredAttempts);
  const queueKey = `${userId}:${table}`;
  const prev = updateQueues.get(queueKey) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await writeSlotWithAuthRefresh(userId, table, slot, slotData, maxAttempts, options.expected);
      return true;
    })
    .catch((e) => {
      const operation = slotData === null ? 'delete' : 'upsert';
      if (isRemoteNewerConflictError(e)) {
        if (Number.isFinite(e?.remoteSavedAt)) {
          setClockFloorSavedAt(table, slot, e.remoteSavedAt);
        }
        warnRemoteNewerConflictOnce(userId, table, slot, e);
        reportCloudFailure(CLOUD_UPDATE_SLOT_CONFLICT_REMOTE_NEWER, e, {
          table,
          slot,
          operation,
          maxAttempts,
          localSavedAt: e?.localSavedAt ?? null,
          remoteSavedAt: e?.remoteSavedAt ?? null,
        });
        return false;
      }
      if (isFreshLocalBlockedError(e)) {
        reportCloudFailure(CLOUD_UPDATE_SLOT_FRESH_LOCAL_BLOCKED, e, {
          table,
          slot,
          operation,
          maxAttempts,
        });
        return false;
      }
      console.warn(`CloudSync updateSlot ${table}:`, e);
      reportCloudFailure('cloud_update_slot', e, {
        table,
        slot,
        operation,
        maxAttempts,
      });
      return false;
    })
    .finally(() => {
      if (updateQueues.get(queueKey) === next) updateQueues.delete(queueKey);
    });
  updateQueues.set(queueKey, next);
  return next;
}

/**
 * The prologue's run save (RunManager mode 'prologue') stays on the device that plays
 * it. A client from before the prologue reads run_saves without knowing `mode` and
 * would open that save as a standard run on the prologue's seven-node authored map,
 * so it never reaches the cloud: the prologue is short, the slot's meta (pushed as
 * usual) records it 'in_progress', and a device without the run save offers it again
 * (PrologueRouting.routeForSlot). Logout's backup leaves it out the same way and
 * reports it (`localOnly`), so sign-out asks before it discards one.
 */
export function isLocalOnlyRunSave(run) {
  return isCloudSlotPayload(run) && isPrologueRun(run);
}

// Slots whose cloud row has been checked for a prologue run save this session.
const retiredPrologueRows = new Set();

/**
 * Remove a prologue run save an earlier build pushed to this slot's cloud row. The delete
 * holds only while the row is itself a prologue run, so a standard run in the row
 * (another device's) is never touched. Checked once a session per slot only when the
 * check completes (the row deleted, or found holding no prologue run); a check that
 * failed (offline, a refused write, an error) is forgotten and runs again on the slot's
 * next prologue push.
 */
function retireCloudPrologueRun(userId, slot) {
  const signature = `${userId}:${slot}`;
  if (retiredPrologueRows.has(signature)) return;
  retiredPrologueRows.add(signature);
  void updateSlotInTable(userId, TABLES.run, slot, null, { expected: isLocalOnlyRunSave }).then(
    (done) => {
      if (done !== true) retiredPrologueRows.delete(signature);
    },
  );
}

/**
 * The cloud side of "Use this device save": the chosen local run replaces the cloud's.
 * A local-only run (the prologue's) is never pushed, so the cloud run it was chosen
 * over is deleted instead (only while the row still holds that run), or the next
 * fetch would find it newer and ask again.
 */
export function pushChosenLocalRun(userId, slot, run, replacedCloudRun) {
  if (!isLocalOnlyRunSave(run)) return pushRunSave(userId, slot, run);
  if (replacedCloudRun != null) return deleteRunSave(userId, slot, replacedCloudRun);
  return { queued: false, reason: 'prologue_local' };
}

const protectedBackupReported = new Set();
export function pushRunSave(userId, slot, runData) {
  if (protectedLocalSlot(slot)) {
    const signature = `${userId}:${slot}`;
    if (!protectedBackupReported.has(signature)) {
      protectedBackupReported.add(signature);
      reportCloudFailure('cloud_backup_protected_slot', new Error('protected_slot'), { slot });
    }
    if (!cloudSyncStatus.authExpired) {
      cloudSyncStatus.mode = 'local_only';
      cloudSyncStatus.message = `Slot ${slot}: local save kept; cloud backup paused until recovery is resolved.`;
      cloudSyncStatus.context = 'protected_slot';
      cloudSyncStatus.updatedAt = Date.now();
    }
    return { queued: false, reason: 'protected_slot' };
  }
  if (!supabase || !userId) return { queued: false, reason: 'offline' };
  if (isLocalOnlyRunSave(runData)) {
    retireCloudPrologueRun(userId, slot);
    return { queued: false, reason: 'prologue_local' };
  }
  getCloudSyncStatus(); // A resolved recovery gate no longer pauses new backups.
  updateSlotInTable(userId, TABLES.run, slot, runData);
  return { queued: true };
}

export function pushMeta(userId, slot, metaData) {
  if (!supabase || protectedLocalSlot(slot)) return;
  updateSlotInTable(userId, TABLES.meta, slot, metaData);
}

export function pushSettings(userId, liveSettingsData) {
  if (!supabase) return;
  const settingsData = snapshotSlotPayload(liveSettingsData);
  const queueKey = `${userId}:${TABLES.settings}`;
  const prev = updateQueues.get(queueKey) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const remote = await fetchTable(userId, TABLES.settings);
      if (Number(remote?.savedAt || 0) > Number(settingsData?.savedAt || 0)) {
        applySettings(remote);
        return;
      }
      const { error } = await supabase
        .from(TABLES.settings)
        .upsert({ user_id: userId, data: settingsData, updated_at: new Date().toISOString() });
      if (error) throw error;
      clearAuthExpiredStatusOnSuccess();
    })
    .catch((err) => {
      reportCloudFailure('cloud_push_settings', err, { table: TABLES.settings });
    })
    .finally(() => {
      if (updateQueues.get(queueKey) === next) updateQueues.delete(queueKey);
    });
  updateQueues.set(queueKey, next);
  return next;
}

export function deleteRunSave(userId, slot, abandonedRun) {
  const runRecordId = abandonedRun?.runRecordId;
  const identity =
    typeof runRecordId === 'string' && runRecordId
      ? runRecordId
      : isReadableRunShape(abandonedRun)
        ? abandonedRun
        : undefined;
  if (!supabase || protectedLocalSlot(slot) || identity === undefined)
    return { queued: false, reason: 'unverified_run' };
  const runQueueKey = `${userId}:${TABLES.run}`;
  const metaQueueKey = `${userId}:${TABLES.meta}`;
  const prevRun = updateQueues.get(runQueueKey) || Promise.resolve();
  const prevMeta = updateQueues.get(metaQueueKey) || Promise.resolve();
  const next = Promise.allSettled([prevRun, prevMeta])
    .catch(() => {})
    .then(async () => {
      if (protectedLocalSlot(slot)) return;
      // Snapshot cloud run slot for compensating restore if later meta sync fails.
      const cloudRunBeforeDelete = await fetchTableRow(userId, TABLES.run);
      const runBeforeDelete = migrateCloudData(cloudRunBeforeDelete.data)[String(slot)] ?? null;

      if (!matchesRunIdentity(runBeforeDelete, identity)) return;
      const deleted = await writeSlotWithAuthRefresh(
        userId,
        TABLES.run,
        slot,
        null,
        SLOT_WRITE_MAX_ATTEMPTS,
        identity,
      );
      if (deleted === false) return;

      const localMetaState = readLocalJSONWithState(getMetaKey(slot));
      if (localMetaState.parseError) {
        reportCloudFailure(
          'cloud_delete_run_meta_sync_skipped',
          new Error('local_meta_parse_error'),
          {
            table: TABLES.meta,
            slot,
            reason: 'parse_error',
          },
        );
        return;
      }
      if (!localMetaState.exists) {
        console.warn('CloudSync deleteRunSave meta sync skipped: local meta missing', { slot });
        return;
      }
      if (!isCloudSlotPayload(localMetaState.value)) {
        reportCloudFailure('cloud_delete_run_meta_sync_skipped', new Error('local_meta_invalid'), {
          table: TABLES.meta,
          slot,
          reason: 'invalid',
        });
        return;
      }

      try {
        await writeSlotWithAuthRefresh(
          userId,
          TABLES.meta,
          slot,
          localMetaState.value,
          SLOT_WRITE_MAX_ATTEMPTS,
        );
      } catch (metaErr) {
        // Compensating restore: reinsert cloud run slot when meta sync fails after delete.
        if (isCloudSlotPayload(runBeforeDelete)) {
          try {
            await writeSlotWithAuthRefresh(
              userId,
              TABLES.run,
              slot,
              runBeforeDelete,
              SLOT_WRITE_MAX_ATTEMPTS,
              null, // Compensate only into an absent row; never replace a new remote run.
            );
          } catch (restoreErr) {
            reportCloudFailure('cloud_delete_run_restore_failed', restoreErr, {
              table: TABLES.run,
              slot,
            });
          }
        }
        throw metaErr;
      }
    })
    .catch((e) => {
      console.warn('CloudSync deleteRunSave:', e);
      reportCloudFailure('cloud_delete_run', e, { slot });
    })
    .finally(() => {
      if (updateQueues.get(runQueueKey) === next) updateQueues.delete(runQueueKey);
      if (updateQueues.get(metaQueueKey) === next) updateQueues.delete(metaQueueKey);
    });
  updateQueues.set(runQueueKey, next);
  updateQueues.set(metaQueueKey, next);
}

/**
 * Delete a slot from BOTH run_saves and meta_progression tables.
 * Called when user deletes a save slot.
 */
export function deleteSlotCloud(userId, slot) {
  if (!supabase) return;
  updateSlotInTable(userId, TABLES.run, slot, null);
  updateSlotInTable(userId, TABLES.meta, slot, null);
}

const updateQueues = new Map();
const remoteNewerWarnedSignatures = new Set();

/**
 * Wait for all in-flight cloud writes to settle, bounded by a timeout.
 * Returns true when every queued write settled before the deadline.
 * Used before destructive local operations (logout) so pending pushes
 * are not lost with the local data they were backing up.
 */
export async function flushCloudSyncQueues(timeoutMs = FLUSH_QUEUE_TIMEOUT_MS) {
  const pending = [...updateQueues.values()];
  if (pending.length === 0) return true;
  let timedOut = false;
  await Promise.race([
    Promise.allSettled(pending),
    new Promise((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs),
    ),
  ]);
  return !timedOut;
}

/**
 * Queue a push of every locally stored slot (run + meta) to the cloud.
 * The per-slot remote-newer guards still apply, so this can only fast-forward
 * the cloud, never regress it. Call flushCloudSyncQueues() afterwards to wait.
 */
export function pushAllLocalSlots(userId) {
  if (!supabase || !userId) return;
  for (let i = 1; i <= MAX_SLOTS; i++) {
    if (protectedLocalSlot(i)) continue;
    const metaState = readLocalJSONWithState(getMetaKey(i));
    if (metaState.exists && !metaState.parseError && isCloudSlotPayload(metaState.value)) {
      pushMeta(userId, i, metaState.value);
    }
    const runState = readLocalJSONWithState(getRunKey(i));
    if (runState.exists && !runState.parseError && isCloudSlotPayload(runState.value)) {
      pushRunSave(userId, i, runState.value);
    }
  }
}

/**
 * The saves logout would discard that no backup can carry: each slot logout clears
 * (SlotManager.isSlotKeptAtLogout is false) whose run save stays on the device
 * (isLocalOnlyRunSave: the prologue's). A slot logout keeps is not listed.
 * @returns {Array<{ slot: number, kind: 'prologue' }>}
 */
export function listLocalOnlySaves() {
  const saves = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    try {
      if (isSlotKeptAtLogout(slot)) continue;
      const run = readLocalJSON(getRunKey(slot));
      if (isLocalOnlyRunSave(run)) saves.push({ slot, kind: 'prologue' });
    } catch {
      /* an unreadable slot is kept at logout, not discarded */
    }
  }
  return saves;
}

/**
 * Back up every local slot before logout and say what the backup could not carry.
 * `ok`: the exact captured batch (every slot's meta, every run save but a local-only
 * one) was durably written. `localOnly`: the saves logout would still discard
 * (listLocalOnlySaves), read after the batch; `ok` never vouches for them, so the
 * caller asks before discarding any (TitleScene._handleLogout).
 * @returns {Promise<{ ok: boolean, localOnly: Array<{ slot: number, kind: 'prologue' }> }>}
 */
export async function backupAllLocalSlots(userId, options = {}) {
  const ok = await backupLocalSlotBatch(userId, options).catch(() => false);
  return { ok: ok === true, localOnly: listLocalOnlySaves() };
}

/** Confirm the exact captured local batch was durably written before logout.
 * Queue settlement and auth status alone do not imply successful network writes.
 * Capture all payloads before scheduling any writes so failure/timeout leaves the
 * caller's local recovery copy intact, and later unrelated writes cannot mask it.
 */
async function backupLocalSlotBatch(
  userId,
  { timeoutMs = FLUSH_QUEUE_TIMEOUT_MS, skipRecovery = false } = {},
) {
  if (!supabase || !userId) return false;
  const batch = [];
  try {
    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const protectedSlot = protectedLocalSlot(slot);
      if (protectedSlot) {
        if (skipRecovery) continue;
        return false;
      }
      for (const [table, key] of [
        [TABLES.meta, getMetaKey(slot)],
        [TABLES.run, getRunKey(slot)],
      ]) {
        const raw = localStorage.getItem(key);
        if (raw == null) continue;
        const value = JSON.parse(raw);
        if (!isCloudSlotPayload(value)) return false;
        // The prologue's run save is never backed up (isLocalOnlyRunSave); the caller
        // learns of it from `localOnly`, never from a confirmed batch.
        if (table === TABLES.run && isLocalOnlyRunSave(value)) continue;
        batch.push({ slot, table, value, key, raw });
      }
    }
  } catch {
    return false;
  }
  if (!batch.length) return true;
  let timer;
  try {
    return await Promise.race([
      Promise.all(
        batch.map(({ slot, table, value }) => updateSlotInTable(userId, table, slot, value)),
      ).then(
        (results) =>
          results.every((result) => result === true) &&
          batch.every(({ key, raw }) => localStorage.getItem(key) === raw),
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function __flushCloudSyncQueuesForTests() {
  await Promise.allSettled([...updateQueues.values()]);
}

export function __resetCloudSyncQueuesForTests() {
  updateQueues.clear();
  retiredPrologueRows.clear();
  pendingRecoveryQueues.clear();
  pendingRecoveryWrites.clear();
  remoteNewerWarnedSignatures.clear();
  protectedBackupReported.clear();
}

export function __resetCloudSyncStatusForTests() {
  resetCloudSyncStatus();
}

function readLocalJSON(key) {
  const localState = readLocalJSONWithState(key);
  if (localState.parseError) return null;
  return localState.value;
}

function readLocalJSONWithState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return { exists: false, value: null, parseError: false };
    return { exists: true, value: JSON.parse(raw), parseError: false };
  } catch (_) {
    return { exists: true, value: null, parseError: true };
  }
}

function getSavedAt(slotData) {
  const ts = slotData?.savedAt;
  return Number.isFinite(ts) ? ts : null;
}

function getClockFloorKeyForTable(table, slot) {
  if (table === TABLES.run) return getRunClockFloorKey(slot);
  if (table === TABLES.meta) return getMetaClockFloorKey(slot);
  return null;
}

function getClockFloorSavedAt(table, slot) {
  const key = getClockFloorKeyForTable(table, slot);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch (_) {
    return null;
  }
}

function setClockFloorSavedAt(table, slot, remoteSavedAt) {
  if (!Number.isFinite(remoteSavedAt)) return;
  const key = getClockFloorKeyForTable(table, slot);
  if (!key) return;
  const existingFloor = getClockFloorSavedAt(table, slot);
  const nextFloor = Number.isFinite(existingFloor)
    ? Math.max(existingFloor, remoteSavedAt)
    : remoteSavedAt;
  try {
    localStorage.setItem(key, String(nextFloor));
  } catch (e) {
    console.warn('[CloudSync] localStorage write failed:', key, e);
  }
}

function clearClockFloorSavedAt(table, slot) {
  const key = getClockFloorKeyForTable(table, slot);
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch (_) {
    /* ignore */
  }
}

function isRemoteNewerConflictError(err) {
  return err?.code === 'CLOUD_CONFLICT_REMOTE_NEWER';
}

function isFreshLocalBlockedError(err) {
  return err?.code === 'CLOUD_FRESH_LOCAL_BLOCKED';
}

/**
 * A meta payload with no completed runs, no purchases, no milestones, and no
 * banked currency is indistinguishable from a brand-new save. Used to block
 * the empty-boot-clobbers-cloud failure mode.
 */
function isFreshMetaPayload(metaSlot) {
  if (!isCloudSlotPayload(metaSlot)) return true;
  if ((Number(metaSlot.runsCompleted) || 0) > 0) return false;
  if (metaSlot.purchasedUpgrades && Object.keys(metaSlot.purchasedUpgrades).length > 0)
    return false;
  if (Array.isArray(metaSlot.milestones) && metaSlot.milestones.length > 0) return false;
  const valor = Number(metaSlot.totalValor ?? metaSlot.totalRenown) || 0;
  const supply = Number(metaSlot.totalSupply ?? metaSlot.totalRenown) || 0;
  return valor <= 0 && supply <= 0;
}

function healLocalMetaFromRemote(slot, remoteSlot) {
  if (protectedLocalSlot(slot)) return;
  const key = getMetaKey(slot);
  try {
    localStorage.setItem(key, JSON.stringify(remoteSlot));
  } catch (e) {
    console.warn('[CloudSync] localStorage write failed:', key, e);
  }
  if (Number.isFinite(remoteSlot?.savedAt)) {
    setClockFloorSavedAt(TABLES.meta, slot, remoteSlot.savedAt);
  }
}

function warnRemoteNewerConflictOnce(userId, table, slot, err) {
  const scope = userId ?? 'anonymous';
  const signature = `${scope}:${table}:${slot}:${err?.localSavedAt ?? 'null'}:${err?.remoteSavedAt ?? 'null'}`;
  if (remoteNewerWarnedSignatures.has(signature)) return;
  if (remoteNewerWarnedSignatures.size >= REMOTE_NEWER_WARN_SIGNATURE_LIMIT) {
    const oldestSignature = remoteNewerWarnedSignatures.values().next().value;
    if (oldestSignature !== undefined) {
      remoteNewerWarnedSignatures.delete(oldestSignature);
    }
  }
  remoteNewerWarnedSignatures.add(signature);
  console.warn('CloudSync updateSlot conflict remote newer:', {
    userId: scope,
    table,
    slot,
    localSavedAt: err?.localSavedAt ?? null,
    remoteSavedAt: err?.remoteSavedAt ?? null,
  });
}

function isCloudSlotPayload(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAuthExpiryError(err) {
  if (!err) return false;
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status);
  if (status === 401 || status === 403) return true;
  const code = String(err?.code || '').toLowerCase();
  if (code === 'pgrst301' || code === 'invalid_jwt' || code === 'auth_session_missing') return true;
  const msg = String(err?.message || err?.error_description || '').toLowerCase();
  if (msg.includes('auth session missing')) return true;
  if (msg.includes('session expired') || msg.includes('session has expired')) return true;
  if (msg.includes('jwt') && (msg.includes('expired') || msg.includes('invalid'))) return true;
  if (msg.includes('invalid refresh token')) return true;
  return false;
}

async function tryRefreshSessionAfterAuthError(err) {
  if (!isAuthExpiryError(err)) return false;
  const refreshSession = supabase?.auth?.refreshSession;
  if (typeof refreshSession !== 'function') return false;
  try {
    const { error } = await refreshSession.call(supabase.auth);
    if (error) throw error;
    return true;
  } catch (refreshErr) {
    reportCloudFailure('cloud_refresh_session', refreshErr);
    return false;
  }
}

function markCloudAuthExpired(err, context) {
  if (!isAuthExpiryError(err)) return false;
  if (!cloudSyncStatus.authExpired) {
    cloudSyncStatus.mode = 'auth_expired';
    cloudSyncStatus.authExpired = true;
    cloudSyncStatus.message = AUTH_EXPIRED_USER_MESSAGE;
    cloudSyncStatus.context = context;
    cloudSyncStatus.code = err?.code || null;
    cloudSyncStatus.updatedAt = Date.now();
  }
  return true;
}

function clearAuthExpiredStatusOnSuccess() {
  if (!cloudSyncStatus.authExpired) return;
  resetCloudSyncStatus();
}

function reportCloudFailure(context, err, extra = {}) {
  const authExpired = markCloudAuthExpired(err, context);
  reportAsyncError(context, err, { ...extra, authExpired });
}

function isConflictError(err) {
  if (!err) return false;
  const code = String(err?.code || '').toLowerCase();
  if (code === '23505' || code === '409') return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('duplicate key') || msg.includes('conflict');
}

function isRemoteSlotNewer(localSlot, remoteSlot) {
  const localTs = getSavedAt(localSlot);
  const remoteTs = getSavedAt(remoteSlot);
  if (!Number.isFinite(localTs) || !Number.isFinite(remoteTs)) return false;
  return remoteTs > localTs;
}

function buildConflictExhaustedError(table, slot, maxAttempts, lastConflict) {
  const err = new Error(`cloud write conflict retry exhausted after ${maxAttempts} attempts`);
  err.code = 'CLOUD_CONFLICT_RETRY_EXHAUSTED';
  err.table = table;
  err.slot = slot;
  err.maxAttempts = maxAttempts;
  err.lastConflictCode = lastConflict?.code || null;
  return err;
}

function withRevisionFilter(query, expectedUpdatedAt) {
  if (expectedUpdatedAt == null) return query.is('updated_at', null);
  return query.eq('updated_at', expectedUpdatedAt);
}

async function insertTableRow(userId, table, slotMap) {
  if (!supabase) throw new Error('Cloud unavailable');
  const payload = {
    user_id: userId,
    data: slotMap,
    updated_at: new Date().toISOString(),
  };
  const tableApi = supabase.from(table);
  if (typeof tableApi.insert === 'function') {
    const { error } = await tableApi.insert(payload);
    if (!error) return { ok: true };
    if (isConflictError(error)) return { ok: false, conflict: error };
    return { ok: false, error };
  }
  const { error } = await tableApi.upsert(payload);
  if (!error) return { ok: true };
  if (isConflictError(error)) return { ok: false, conflict: error };
  return { ok: false, error };
}

async function updateTableRowWithRevision(userId, table, expectedUpdatedAt, slotMap) {
  if (!supabase) throw new Error('Cloud unavailable');
  let query = supabase
    .from(table)
    .update({
      data: slotMap,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  query = withRevisionFilter(query, expectedUpdatedAt);
  const { data, error } = await query.select('updated_at').maybeSingle();
  if (error) {
    if (isConflictError(error)) return { ok: false, conflict: error };
    return { ok: false, error };
  }
  if (!data) return { ok: false, conflict: new Error('stale_write_conflict') };
  return { ok: true };
}

async function deleteTableRowWithRevision(userId, table, expectedUpdatedAt) {
  if (!supabase) throw new Error('Cloud unavailable');
  let query = supabase.from(table).delete().eq('user_id', userId);
  query = withRevisionFilter(query, expectedUpdatedAt);
  const { data, error } = await query.select('user_id').maybeSingle();
  if (error) {
    if (isConflictError(error)) return { ok: false, conflict: error };
    return { ok: false, error };
  }
  if (!data) return { ok: false, conflict: new Error('stale_delete_conflict') };
  return { ok: true };
}

// Legacy runs have no stable ID. Delete only the complete snapshot we cleared;
// a newer or different legacy run cannot be mistaken for that abandoned save.
function matchesRunIdentity(run, identity) {
  if (typeof identity === 'string') return run?.runRecordId === identity;
  if (typeof identity === 'function') return identity(run) === true;
  const ordered = (value) =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, ordered(value[key])]),
          )
        : value;
  return !!run && !!identity && JSON.stringify(ordered(run)) === JSON.stringify(ordered(identity));
}

async function writeSlotWithRetry(userId, table, slot, slotData, maxAttempts, expectedRunRecordId) {
  if (!supabase) throw new Error('Cloud unavailable');
  let lastConflict = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const row = await fetchTableRow(userId, table);
    const slotMap = migrateCloudData(row.data);
    const remoteSlot = slotMap[String(slot)];
    if (
      expectedRunRecordId !== undefined &&
      (protectedLocalSlot(slot) ||
        (expectedRunRecordId === null
          ? remoteSlot != null
          : !matchesRunIdentity(remoteSlot, expectedRunRecordId)))
    )
      return false;
    if (
      slotData !== null &&
      isCloudSlotPayload(remoteSlot) &&
      isRemoteSlotNewer(slotData, remoteSlot)
    ) {
      const err = new Error('cloud slot newer on remote');
      err.code = 'CLOUD_CONFLICT_REMOTE_NEWER';
      err.table = table;
      err.slot = slot;
      err.localSavedAt = getSavedAt(slotData);
      err.remoteSavedAt = getSavedAt(remoteSlot);
      throw err;
    }
    if (
      table === TABLES.meta &&
      slotData !== null &&
      isCloudSlotPayload(remoteSlot) &&
      isFreshMetaPayload(slotData) &&
      !isFreshMetaPayload(remoteSlot)
    ) {
      // A zero-progress meta with a wall-clock-newer savedAt is the signature of a
      // device that booted before the cloud fetch completed (timeout/offline) and
      // started fresh. Never let it destroy real progression — heal local from the
      // remote copy instead and surface a conflict.
      healLocalMetaFromRemote(slot, remoteSlot);
      const err = new Error('fresh local meta blocked from overwriting cloud progression');
      err.code = 'CLOUD_FRESH_LOCAL_BLOCKED';
      err.table = table;
      err.slot = slot;
      err.localSavedAt = getSavedAt(slotData);
      err.remoteSavedAt = getSavedAt(remoteSlot);
      throw err;
    }
    if (slotData === null) {
      delete slotMap[String(slot)];
    } else {
      slotMap[String(slot)] = slotData;
    }

    const hasData = Object.values(slotMap).some((v) => v != null);
    let writeResult;
    if (!row.exists) {
      if (!hasData) return;
      writeResult = await insertTableRow(userId, table, slotMap);
    } else if (!hasData) {
      writeResult = await deleteTableRowWithRevision(userId, table, row.updatedAt);
    } else {
      writeResult = await updateTableRowWithRevision(userId, table, row.updatedAt, slotMap);
    }

    if (writeResult.ok) return;
    if (writeResult.conflict) {
      lastConflict = writeResult.conflict;
      if (attempt < maxAttempts) continue;
      throw buildConflictExhaustedError(table, slot, maxAttempts, lastConflict);
    }
    throw writeResult.error;
  }
}

async function writeSlotWithAuthRefresh(
  userId,
  table,
  slot,
  slotData,
  maxAttempts,
  expectedRunRecordId,
) {
  try {
    const result = await writeSlotWithRetry(
      userId,
      table,
      slot,
      slotData,
      maxAttempts,
      expectedRunRecordId,
    );
    if (result === false) return false;
    clearAuthExpiredStatusOnSuccess();
    clearClockFloorSavedAt(table, slot);
    return;
  } catch (err) {
    const refreshed = await tryRefreshSessionAfterAuthError(err);
    if (!refreshed) throw err;
  }
  const result = await writeSlotWithRetry(
    userId,
    table,
    slot,
    slotData,
    maxAttempts,
    expectedRunRecordId,
  );
  if (result === false) return false;
  clearAuthExpiredStatusOnSuccess();
  clearClockFloorSavedAt(table, slot);
}

// Deterministic run winner policy:
// - both valid timestamps => local wins ties and newer values
// - only one valid timestamp => valid side wins
// - neither valid => cloud wins
export function shouldPreferLocalRun(localSlot, cloudSlot, slot = null) {
  if (!localSlot || !cloudSlot) return false;
  const localTs = getSavedAt(localSlot);
  const cloudTs = getSavedAt(cloudSlot);
  const localValid = Number.isFinite(localTs);
  const cloudValid = Number.isFinite(cloudTs);
  if (localValid && cloudValid) return localTs >= cloudTs;
  if (localValid) return true;
  if (cloudValid) return false;
  if (Number.isFinite(slot)) {
    markStartup('cloud_run_merge_no_savedAt', { slot });
  }
  return false;
}

// Deterministic meta winner policy (mirrors shouldPreferLocalRun):
// - both valid timestamps => local wins only when strictly newer
// - only one valid timestamp => valid side wins
// - neither valid => cloud wins for deterministic sync
export function shouldPreferLocalMeta(localSlot, cloudSlot) {
  if (!localSlot || !cloudSlot) return false;
  const localTs = getSavedAt(localSlot);
  const cloudTs = getSavedAt(cloudSlot);
  const localValid = Number.isFinite(localTs);
  const cloudValid = Number.isFinite(cloudTs);
  if (localValid && cloudValid) return localTs > cloudTs;
  if (localValid) return true;
  return false;
}
