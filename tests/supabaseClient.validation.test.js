import { describe, expect, it, vi } from 'vitest';

// Create spies we can inspect
const signUpSpy = vi.fn(async () => ({ data: { user: {} }, error: null }));
const signInSpy = vi.fn(async () => ({ data: { session: {} }, error: null }));

// Mock Supabase createClient to provide a dummy client
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signUp: signUpSpy,
      signInWithPassword: signInSpy,
      signOut: vi.fn(async () => {}),
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  }),
}));

// Provide env vars so supabase client is non-null
vi.stubEnv('VITE_SUPABASE_URL', 'https://fake.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'fake-key');

const { signUp, signIn } = await import('../src/cloud/supabaseClient.js');

describe('supabaseClient username validation', () => {
  it('signUp rejects empty string', async () => {
    await expect(signUp('', 'password')).rejects.toThrow('Username is required');
  });

  it('signUp rejects whitespace-only string', async () => {
    await expect(signUp('   ', 'password')).rejects.toThrow('Username is required');
  });

  it('signUp rejects null', async () => {
    await expect(signUp(null, 'password')).rejects.toThrow('Username is required');
  });

  it('signUp rejects undefined', async () => {
    await expect(signUp(undefined, 'password')).rejects.toThrow('Username is required');
  });

  it('signIn rejects empty string', async () => {
    await expect(signIn('', 'password')).rejects.toThrow('Username is required');
  });

  it('signIn rejects whitespace-only string', async () => {
    await expect(signIn('   ', 'password')).rejects.toThrow('Username is required');
  });
});

describe('supabaseClient username normalization', () => {
  it('signUp trims and lowercases username', async () => {
    signUpSpy.mockClear();
    await signUp('  Alice  ', 'password');
    expect(signUpSpy).toHaveBeenCalledWith({
      email: 'alice@emblem-rogue.local',
      password: 'password',
      options: { data: { display_name: 'alice' } },
    });
  });

  it('signIn trims and lowercases username', async () => {
    signInSpy.mockClear();
    await signIn('  Bob  ', 'password');
    expect(signInSpy).toHaveBeenCalledWith({
      email: 'bob@emblem-rogue.local',
      password: 'password',
    });
  });
});
