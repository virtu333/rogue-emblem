// CloudSync.js — Fire-and-forget cloud save/load via Supabase
// All methods catch errors and console.warn — never throw.
// Stores per-slot data as { "1": {...}, "2": {...}, "3": {...} } in a single Supabase row.

import { supabase } from './supabaseClient.js';
import { getMetaKey, getRunKey, MAX_SLOTS } from '../engine/SlotManager.js';
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
      localStorage.setItem(key, JSON.stringify(cloudSlot));
      continue;
    }

    if (!localState.exists) {
      localStorage.setItem(key, JSON.stringify(cloudSlot));
      continue;
    }

    const shouldKeepLocal = shouldPreferLocalRun(localState.value, cloudSlot);
    if (!shouldKeepLocal) localStorage.setItem(key, JSON.stringify(cloudSlot));
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
    if (!shouldKeepLocal) localStorage.setItem(key, JSON.stringify(cloudSlot));
  }
}

function applySettings(settingsData) {
  if (settingsData) {
    localStorage.setItem(SETTINGS_LS_KEY, JSON.stringify(settingsData));
  } else {
    localStorage.removeItem(SETTINGS_LS_KEY);
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
      await writeSlotWithRetry(userId, table, slot, slotData, maxAttempts);
      clearAuthExpiredStatusOnSuccess();
    })
    .catch((e) => {
      console.warn(`CloudSync updateSlot ${table}:`, e);
      reportCloudFailure('cloud_update_slot', e, {
        table,
        slot,
        operation: slotData === null ? 'delete' : 'upsert',
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
  updateSlotInTable(userId, TABLES.run, slot, null);

  const localMetaState = readLocalJSONWithState(getMetaKey(slot));
  if (localMetaState.parseError) {
    reportCloudFailure('cloud_delete_run_meta_sync_skipped', new Error('local_meta_parse_error'), {
      table: TABLES.meta,
      slot,
      reason: 'parse_error',
    });
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
  updateSlotInTable(userId, TABLES.meta, slot, localMetaState.value);
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

export async function __flushCloudSyncQueuesForTests() {
  await Promise.allSettled([...updateQueues.values()]);
}

export function __resetCloudSyncQueuesForTests() {
  updateQueues.clear();
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
  if (msg.includes('session') && msg.includes('expired')) return true;
  if (msg.includes('jwt') && (msg.includes('expired') || msg.includes('invalid'))) return true;
  if (msg.includes('invalid refresh token')) return true;
  return false;
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

// Prefer local run data whenever cloud is not strictly newer.
// If timestamps are missing on either side, keep local (loss-averse).
export function shouldPreferLocalRun(localSlot, cloudSlot) {
  if (!localSlot || !cloudSlot) return false;
  const localTs = getSavedAt(localSlot);
  const cloudTs = getSavedAt(cloudSlot);
  if (!Number.isFinite(localTs) || !Number.isFinite(cloudTs)) return true;
  return localTs >= cloudTs;
}

// Prefer local meta when it has a newer timestamp than cloud.
// If timestamps are missing on either side, prefer cloud for deterministic sync.
export function shouldPreferLocalMeta(localSlot, cloudSlot) {
  if (!localSlot || !cloudSlot) return false;
  const localTs = getSavedAt(localSlot);
  const cloudTs = getSavedAt(cloudSlot);
  if (!Number.isFinite(localTs) || !Number.isFinite(cloudTs)) return false;
  return localTs > cloudTs;
}
