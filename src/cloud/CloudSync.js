// CloudSync.js — Fire-and-forget cloud save/load via Supabase
// All methods catch errors and console.warn — never throw.
// Stores per-slot data as { "1": {...}, "2": {...}, "3": {...} } in a single Supabase row.

import { supabase } from './supabaseClient.js';
import {
  getMetaClockFloorKey,
  getMetaKey,
  getRunClockFloorKey,
  getRunKey,
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
async function fetchTable(userId, table) {
  const row = await fetchTableRow(userId, table);
  return row.data;
}

async function fetchTableRow(userId, table) {
  if (!supabase) return { exists: false, data: null, updatedAt: null };
  const { data, error } = await supabase
    .from(table)
    .select('data,updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { exists: false, data: null, updatedAt: null };
  return {
    exists: true,
    data: data.data ?? null,
    updatedAt: data.updated_at ?? null,
  };
}

function applyRunSlots(runData) {
  const runSlots = migrateCloudData(runData);
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const key = getRunKey(i);
    const cloudSlot = runSlots[String(i)];
    if (cloudSlot == null) continue;

    const localState = readLocalJSONWithState(key);
    if (localState.parseError) {
      // Corrupted local JSON is not recoverable; heal from cloud when available.
      try {
        localStorage.setItem(key, JSON.stringify(cloudSlot));
      } catch (e) {
        console.warn('[CloudSync] localStorage write failed:', key, e);
      }
      continue;
    }

    if (!localState.exists) {
      try {
        localStorage.setItem(key, JSON.stringify(cloudSlot));
      } catch (e) {
        console.warn('[CloudSync] localStorage write failed:', key, e);
      }
      continue;
    }

    const shouldKeepLocal = shouldPreferLocalRun(localState.value, cloudSlot, i);
    if (!shouldKeepLocal) {
      try {
        localStorage.setItem(key, JSON.stringify(cloudSlot));
      } catch (e) {
        console.warn('[CloudSync] localStorage write failed:', key, e);
      }
    }
  }
}

function applyMetaSlots(metaData) {
  const metaSlots = migrateCloudData(metaData);
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const key = getMetaKey(i);
    const cloudSlot = metaSlots[String(i)];
    if (cloudSlot == null) continue;
    const localSlot = readLocalJSON(key);
    const shouldKeepLocal = shouldPreferLocalMeta(localSlot, cloudSlot);
    if (!shouldKeepLocal) {
      try {
        localStorage.setItem(key, JSON.stringify(cloudSlot));
      } catch (e) {
        console.warn('[CloudSync] localStorage write failed:', key, e);
      }
    }
  }
}

function applySettings(settingsData) {
  try {
    if (settingsData) {
      localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(settingsData));
    } else {
      localStorage.removeItem(SETTINGS_LS_KEY);
    }
  } catch (e) {
    console.warn('[CloudSync] localStorage write failed:', SETTINGS_LS_KEY, e);
  }
}

/**
 * Fetch all tables for a user and write to slot-specific localStorage keys.
 * Called once on login, before Phaser boots.
 */
export async function fetchAllToLocalStorage(userId, options = {}) {
  if (!supabase) return;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : FETCH_TIMEOUT_MS;

  markStartup('cloud_sync_start', { timeoutMs });

  const [runRes, metaRes, settingsRes] = await Promise.allSettled([
    withTimeout(fetchTable(userId, TABLES.run), timeoutMs),
    withTimeout(fetchTable(userId, TABLES.meta), timeoutMs),
    withTimeout(fetchTable(userId, TABLES.settings), timeoutMs),
  ]);

  if (runRes.status === 'fulfilled') {
    applyRunSlots(runRes.value);
  } else {
    console.warn('CloudSync fetch run_saves:', runRes.reason);
    reportCloudFailure('cloud_fetch_table', runRes.reason, { table: TABLES.run });
  }

  if (metaRes.status === 'fulfilled') {
    applyMetaSlots(metaRes.value);
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
  return { rejectedCount: rejected.length };
}

/**
 * Read-modify-write helper: fetch current cloud slot map, update one slot, upsert back.
 */
async function updateSlotInTable(userId, table, slot, slotData, options = {}) {
  const configuredAttempts = Number.isFinite(options.maxAttempts)
    ? Math.floor(options.maxAttempts)
    : SLOT_WRITE_MAX_ATTEMPTS;
  const maxAttempts = Math.max(1, configuredAttempts);
  const queueKey = `${userId}:${table}`;
  const prev = updateQueues.get(queueKey) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      await writeSlotWithAuthRefresh(userId, table, slot, slotData, maxAttempts);
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
        return;
      }
      if (isFreshLocalBlockedError(e)) {
        reportCloudFailure(CLOUD_UPDATE_SLOT_FRESH_LOCAL_BLOCKED, e, {
          table,
          slot,
          operation,
          maxAttempts,
        });
        return;
      }
      console.warn(`CloudSync updateSlot ${table}:`, e);
      reportCloudFailure('cloud_update_slot', e, {
        table,
        slot,
        operation,
        maxAttempts,
      });
    })
    .finally(() => {
      if (updateQueues.get(queueKey) === next) updateQueues.delete(queueKey);
    });
  updateQueues.set(queueKey, next);
}

export function pushRunSave(userId, slot, runData) {
  if (!supabase) return;
  updateSlotInTable(userId, TABLES.run, slot, runData);
}

export function pushMeta(userId, slot, metaData) {
  if (!supabase) return;
  updateSlotInTable(userId, TABLES.meta, slot, metaData);
}

export function pushSettings(userId, settingsData) {
  if (!supabase) return;
  const queueKey = `${userId}:${TABLES.settings}`;
  const prev = updateQueues.get(queueKey) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
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
}

export function deleteRunSave(userId, slot) {
  if (!supabase) return;
  const runQueueKey = `${userId}:${TABLES.run}`;
  const metaQueueKey = `${userId}:${TABLES.meta}`;
  const prevRun = updateQueues.get(runQueueKey) || Promise.resolve();
  const prevMeta = updateQueues.get(metaQueueKey) || Promise.resolve();
  const next = Promise.allSettled([prevRun, prevMeta])
    .catch(() => {})
    .then(async () => {
      // Snapshot cloud run slot for compensating restore if later meta sync fails.
      const cloudRunBeforeDelete = await fetchTableRow(userId, TABLES.run);
      const runBeforeDelete = migrateCloudData(cloudRunBeforeDelete.data)[String(slot)] ?? null;

      await writeSlotWithAuthRefresh(userId, TABLES.run, slot, null, SLOT_WRITE_MAX_ATTEMPTS);

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

export async function __flushCloudSyncQueuesForTests() {
  await Promise.allSettled([...updateQueues.values()]);
}

export function __resetCloudSyncQueuesForTests() {
  updateQueues.clear();
  remoteNewerWarnedSignatures.clear();
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

async function writeSlotWithRetry(userId, table, slot, slotData, maxAttempts) {
  if (!supabase) throw new Error('Cloud unavailable');
  let lastConflict = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const row = await fetchTableRow(userId, table);
    const slotMap = migrateCloudData(row.data);
    const remoteSlot = slotMap[String(slot)];
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

async function writeSlotWithAuthRefresh(userId, table, slot, slotData, maxAttempts) {
  try {
    await writeSlotWithRetry(userId, table, slot, slotData, maxAttempts);
    clearAuthExpiredStatusOnSuccess();
    clearClockFloorSavedAt(table, slot);
    return;
  } catch (err) {
    const refreshed = await tryRefreshSessionAfterAuthError(err);
    if (!refreshed) throw err;
  }
  await writeSlotWithRetry(userId, table, slot, slotData, maxAttempts);
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
