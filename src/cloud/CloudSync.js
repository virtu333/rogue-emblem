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
  if (cloudData['1'] !== undefined || cloudData['2'] !== undefined || cloudData['3'] !== undefined) {
    return cloudData;
  }
  // Old flat format — wrap as slot 1 (only if non-empty object)
  if (Object.keys(cloudData).length > 0) {
    return { '1': cloudData };
  }
  return {};
}

/**
 * Fetch a single table's data for a user.
 * Returns the data field or null.
 */
async function fetchTable(userId, table) {
  const { data, error } = await supabase
    .from(table)
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.data : null;
}

function applyRunSlots(runData) {
  const runSlots = migrateCloudData(runData);
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const key = getRunKey(i);
    if (runSlots[String(i)]) {
      localStorage.setItem(key, JSON.stringify(runSlots[String(i)]));
    } else {
      localStorage.removeItem(key);
    }
  }
}

function applyMetaSlots(metaData) {
  const metaSlots = migrateCloudData(metaData);
  for (let i = 1; i <= MAX_SLOTS; i++) {
    const key = getMetaKey(i);
    const cloudSlot = metaSlots[String(i)];
    if (!cloudSlot) continue;
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
  }

  if (metaRes.status === 'fulfilled') {
    applyMetaSlots(metaRes.value);
  } else {
    console.warn('CloudSync fetch meta_progression:', metaRes.reason);
  }

  if (settingsRes.status === 'fulfilled') {
    applySettings(settingsRes.value);
  } else {
    console.warn('CloudSync fetch user_settings:', settingsRes.reason);
  }

  const rejected = [runRes, metaRes, settingsRes].filter(r => r.status === 'rejected');
  const timeoutFailures = rejected.filter((r) => r.reason?.message === 'timeout').length;
  markStartup('cloud_sync_complete', {
    rejectedCount: rejected.length,
    timeoutFailures,
  });
}

/**
 * Read-modify-write helper: fetch current cloud slot map, update one slot, upsert back.
 */
async function updateSlotInTable(userId, table, slot, slotData) {
  const queueKey = `${userId}:${table}`;
  const prev = updateQueues.get(queueKey) || Promise.resolve();
  const next = prev
    .catch(() => {})
    .then(async () => {
      const current = await fetchTable(userId, table);
      const slotMap = migrateCloudData(current);
      if (slotData === null) {
        delete slotMap[String(slot)];
      } else {
        slotMap[String(slot)] = slotData;
      }
      // If all slots empty, delete the row
      const hasData = Object.values(slotMap).some(v => v != null);
      if (!hasData) {
        await supabase.from(table).delete().eq('user_id', userId);
      } else {
        await supabase.from(table).upsert({
          user_id: userId, data: slotMap, updated_at: new Date().toISOString(),
        });
      }
    })
    .catch((e) => {
      console.warn(`CloudSync updateSlot ${table}:`, e);
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
      const { error } = await supabase.from(TABLES.settings)
        .upsert({ user_id: userId, data: settingsData, updated_at: new Date().toISOString() });
      if (error) throw error;
    })
    .catch((err) => {
      reportAsyncError('cloud_push_settings', err, { table: TABLES.settings });
    })
    .finally(() => {
      if (updateQueues.get(queueKey) === next) updateQueues.delete(queueKey);
    });
  updateQueues.set(queueKey, next);
}

export function deleteRunSave(userId, slot) {
  if (!supabase) return;
  updateSlotInTable(userId, TABLES.run, slot, null);
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

function readLocalJSON(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function getSavedAt(slotData) {
  const ts = slotData?.savedAt;
  return Number.isFinite(ts) ? ts : null;
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
