// CloudSync.js — Fire-and-forget cloud save/load via Supabase
// All methods catch errors and console.warn — never throw.

import { supabase } from './supabaseClient.js';

const TABLES = {
  run: 'run_saves',
  meta: 'meta_progression',
  settings: 'user_settings',
};

const LS_KEYS = {
  run: 'emblem_rogue_run_save',
  meta: 'emblem_rogue_meta_save',
  settings: 'emblem_rogue_settings',
};

/**
 * Fetch all 3 tables for a user and write to localStorage.
 * Called once on login, before Phaser boots.
 */
export async function fetchAllToLocalStorage(userId) {
  if (!supabase) return;
  for (const [key, table] of Object.entries(TABLES)) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('data')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) { console.warn(`CloudSync fetch ${table}:`, error.message); continue; }
      if (data) {
        localStorage.setItem(LS_KEYS[key], JSON.stringify(data.data));
      } else {
        localStorage.removeItem(LS_KEYS[key]);
      }
    } catch (e) { console.warn(`CloudSync fetch ${table}:`, e); }
  }
}

export function pushRunSave(userId, runData) {
  if (!supabase) return;
  supabase.from(TABLES.run)
    .upsert({ user_id: userId, data: runData, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error) console.warn('CloudSync pushRunSave:', error.message); });
}

export function pushMeta(userId, metaData) {
  if (!supabase) return;
  supabase.from(TABLES.meta)
    .upsert({ user_id: userId, data: metaData, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error) console.warn('CloudSync pushMeta:', error.message); });
}

export function pushSettings(userId, settingsData) {
  if (!supabase) return;
  supabase.from(TABLES.settings)
    .upsert({ user_id: userId, data: settingsData, updated_at: new Date().toISOString() })
    .then(({ error }) => { if (error) console.warn('CloudSync pushSettings:', error.message); });
}

export function deleteRunSave(userId) {
  if (!supabase) return;
  supabase.from(TABLES.run)
    .delete()
    .eq('user_id', userId)
    .then(({ error }) => { if (error) console.warn('CloudSync deleteRunSave:', error.message); });
}
