import { describe, it, expect, vi } from 'vitest';

// Mock @supabase/supabase-js to return null (simulates missing env vars)
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => null,
}));

// Force VITE env vars missing so supabase stays null
import.meta.env.VITE_SUPABASE_URL = '';
import.meta.env.VITE_SUPABASE_ANON_KEY = '';

describe('Supabase offline / missing-env guards', () => {
  it('signUp throws clean error when supabase is null', async () => {
    // Dynamic import so the mock takes effect
    const { signUp, supabase } = await import('../src/cloud/supabaseClient.js');
    // supabase should be null because env vars are empty
    expect(supabase).toBeNull();
    await expect(signUp('user', 'pass')).rejects.toThrow('Cloud services unavailable');
  });

  it('signIn throws clean error when supabase is null', async () => {
    const { signIn, supabase } = await import('../src/cloud/supabaseClient.js');
    expect(supabase).toBeNull();
    await expect(signIn('user', 'pass')).rejects.toThrow('Cloud services unavailable');
  });

  it('signOut returns gracefully when supabase is null', async () => {
    const { signOut, supabase } = await import('../src/cloud/supabaseClient.js');
    expect(supabase).toBeNull();
    await expect(signOut()).resolves.not.toThrow();
  });

  it('getSession returns null when supabase is null', async () => {
    const { getSession, supabase } = await import('../src/cloud/supabaseClient.js');
    expect(supabase).toBeNull();
    const session = await getSession();
    expect(session).toBeNull();
  });

  it('refreshSession returns null when supabase is null', async () => {
    const { refreshSession, supabase } = await import('../src/cloud/supabaseClient.js');
    expect(supabase).toBeNull();
    const session = await refreshSession();
    expect(session).toBeNull();
  });
});
