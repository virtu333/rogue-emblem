import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const createClient = vi.hoisted(() => vi.fn(() => ({ auth: {} })));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
beforeEach(() => {
  vi.resetModules();
  createClient.mockClear();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-key');
});
afterEach(() => vi.unstubAllEnvs());
describe('local play defaults', () => {
  it.each([undefined, '', 'false', '1'])(
    'does not create a client with credentials but flag %s',
    async (flag) => {
      vi.stubEnv('VITE_CLOUD_ENABLED', flag);
      const { supabase, getSession } = await import('../src/cloud/supabaseClient.js');
      expect(supabase).toBeNull();
      expect(await getSession()).toBeNull();
      expect(createClient).not.toHaveBeenCalled();
    },
  );
  it('retains cloud support only when the build explicitly enables it', async () => {
    vi.stubEnv('VITE_CLOUD_ENABLED', 'true');
    const { supabase } = await import('../src/cloud/supabaseClient.js');
    expect(supabase).not.toBeNull();
    expect(createClient).toHaveBeenCalledOnce();
  });
  it('still boots locally if an opted-in build has incomplete credentials', async () => {
    vi.stubEnv('VITE_CLOUD_ENABLED', 'true');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const { supabase } = await import('../src/cloud/supabaseClient.js');
    expect(supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
});
