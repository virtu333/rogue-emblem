// supabaseClient.js — Supabase singleton + auth wrappers

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

const EMAIL_DOMAIN = '@emblem-rogue.local';

export async function signUp(username, password) {
  const { data, error } = await supabase.auth.signUp({
    email: username.toLowerCase() + EMAIL_DOMAIN,
    password,
    options: { data: { display_name: username } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: username.toLowerCase() + EMAIL_DOMAIN,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}
