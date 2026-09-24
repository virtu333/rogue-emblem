// supabaseClient.js — Supabase singleton + auth wrappers

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Credentials alone must never opt players into account/session restoration.
// Keep existing cloud support available only to deliberately cloud-enabled builds.
export const cloudEnabled = import.meta.env.VITE_CLOUD_ENABLED === 'true';
export const supabase =
  cloudEnabled && supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

const EMAIL_DOMAIN = '@emblem-rogue.local';

export async function signUp(username, password) {
  if (!supabase) throw new Error('Cloud services unavailable');
  if (!username || typeof username !== 'string' || !username.trim()) {
    throw new Error('Username is required');
  }
  const normalized = username.trim().toLowerCase();
  const { data, error } = await supabase.auth.signUp({
    email: normalized + EMAIL_DOMAIN,
    password,
    options: { data: { display_name: normalized } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(username, password) {
  if (!supabase) throw new Error('Cloud services unavailable');
  if (!username || typeof username !== 'string' || !username.trim()) {
    throw new Error('Username is required');
  }
  const normalized = username.trim().toLowerCase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalized + EMAIL_DOMAIN,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function refreshSession() {
  if (!supabase) return null;
  const { data, error } = await supabase.auth.refreshSession();
  if (error) throw error;
  return data?.session || null;
}
