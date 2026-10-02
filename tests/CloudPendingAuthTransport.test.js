import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ reads: 0, headers: [], expired: false, lateReservation: false }));
vi.mock('../src/cloud/supabaseClient.js', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient('https://rls.test', 'anonymous-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (url, options) => {
        const authorization = new Headers(options.headers).get('Authorization');
        state.headers.push(authorization);
        if (state.lateReservation)
          localStorage.setItem(
            'emblem_rogue_slot_1_cloud_pending',
            '{"version":1,"userId":"account-a"}',
          );
        if (state.expired)
          return new Response(JSON.stringify({ message: 'JWT expired', code: 'PGRST301' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        // An anonymous request receives an RLS-empty array, even though the
        // account's run exists. Use the real SDK Authorization path here.
        const data =
          authorization === 'Bearer account-a-token'
            ? [
                {
                  data: String(url).includes('run_saves')
                    ? { 1: { runRecordId: 'cloud-run', gold: 731 } }
                    : String(url).includes('meta_progression')
                      ? { 1: { totalValor: 347 } }
                      : null,
                },
              ]
            : [];
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  // The session disappears exactly when the SDK selects request credentials,
  // then returns before the post-fetch validation. Pre/post checks alone fail.
  supabase.auth.getSession = async () => ({
    data: {
      session:
        ++state.reads >= (state.lateReservation ? 1 : 2) &&
        state.reads <= (state.lateReservation ? 3 : 4)
          ? null
          : { user: { id: 'account-a' }, access_token: 'account-a-token' },
    },
    error: null,
  });
  return { supabase };
});
import { fetchAllToLocalStorage, __resetCloudSyncQueuesForTests } from '../src/cloud/CloudSync.js';
let local;
const pendingKey = 'emblem_rogue_slot_1_cloud_pending';
const raw = '{"version":1,"userId":"account-a"}';
beforeEach(() => {
  local = new Map([[pendingKey, raw]]);
  vi.stubGlobal('localStorage', {
    getItem: (key) => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, String(value)),
    removeItem: (key) => local.delete(key),
  });
  __resetCloudSyncQueuesForTests();
  state.reads = 0;
  state.headers.length = 0;
  state.expired = false;
  state.lateReservation = false;
});
afterEach(() => vi.unstubAllGlobals());
describe('pending recovery binds actual Supabase requests to the account', () => {
  it('does not silently substitute anonymous credentials while auth temporarily disappears', async () => {
    await fetchAllToLocalStorage('account-a', { timeoutMs: 100 });
    expect(state.headers).toEqual(Array(3).fill('Bearer account-a-token'));
    expect(JSON.parse(local.get('emblem_rogue_slot_1_run'))).toEqual({
      runRecordId: 'cloud-run',
      gold: 731,
    });
    expect(JSON.parse(local.get('emblem_rogue_slot_1_meta'))).toEqual({ totalValor: 347 });
    expect(local.has(pendingKey)).toBe(false);
  });
  it('a reservation created during an ordinary anonymous bootstrap fetch waits for authenticated recovery', async () => {
    local.delete(pendingKey);
    state.lateReservation = true;
    await fetchAllToLocalStorage('account-a', { timeoutMs: 100 });
    expect(state.headers).toEqual(Array(3).fill('Bearer anonymous-public-key'));
    expect(local).toEqual(new Map([[pendingKey, raw]]));
  });

  it('expired account credentials retain the reservation rather than proving absence', async () => {
    state.expired = true;
    await fetchAllToLocalStorage('account-a', { timeoutMs: 100 });
    expect(state.headers).toEqual(Array(3).fill('Bearer account-a-token'));
    expect(local).toEqual(new Map([[pendingKey, raw]]));
  });
});
