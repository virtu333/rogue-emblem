// The prologue's Home Base grant across a cloud merge (docs/specs/prologue-chapter.md §9
// "RunManager", the grant merge rule). The cloud fetch keeps one meta payload whole (its
// currencies and upgrades, picked by savedAt), so the grant's receipt (`grantPaid`) must
// come from that payload: a receipt taken from the other copy says "paid" over an
// economy that never held the grant, and completePrologue then never pays it. A
// completion only the other copy saw is paid into the kept economy once
// (MetaProgressionManager.reconcilePickedPrologue). The invariant every case checks: the
// resulting economy is the kept payload's own plus the grant exactly when its own
// lineage never received it, and finishing the prologue afterwards pays nothing more.
// The local adopt-merge (_adoptForeignDiskStateIfNewer) keeps both economies at their
// max, so there the receipt is a union, and an unpaid newer copy never pays twice.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  writable: true,
});

const mocked = vi.hoisted(() => ({ from: vi.fn(), report: vi.fn() }));
vi.mock('../src/cloud/supabaseClient.js', () => ({ supabase: { from: mocked.from } }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocked.report }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: vi.fn() }));

import {
  __resetCloudSyncQueuesForTests,
  __resetCloudSyncStatusForTests,
  fetchAllToLocalStorage,
} from '../src/cloud/CloudSync.js';
import {
  MetaProgressionManager,
  reconcilePickedPrologue,
} from '../src/engine/MetaProgressionManager.js';
import { getMetaKey, getRunKey, getSlotSummary } from '../src/engine/SlotManager.js';
import { routeForSlot, PROLOGUE_ROUTES } from '../src/engine/PrologueRouting.js';
import upgradesData from '../data/metaUpgrades.json';
import prologueData from '../data/prologue.json';

// Derived from the data, not from the code under test.
const GRANT = { valor: prologueData.grant.valor, supply: prologueData.grant.supply };
const KEY = getMetaKey(1);
// recruit_hp_growth's first tier: 35 Supply (metaUpgrades.json, the recruit_stats tab).
const HP_TIER_1 = upgradesData.find((u) => u.id === 'recruit_hp_growth').costs[0];

/** A meta payload: `own` is what its lineage earned apart from the grant. */
function payload({ savedAt, state, paid = state === 'complete', own = [0, 0], spent = false }) {
  const grant = paid ? [GRANT.valor, GRANT.supply] : [0, 0];
  const valor = own[0] + grant[0];
  const supply = own[1] + grant[1] - (spent ? HP_TIER_1 : 0);
  return {
    savedAt,
    balanceRevision: 2,
    totalValor: valor,
    totalSupply: supply,
    purchasedUpgrades: spent ? { recruit_hp_growth: 1 } : {},
    prologue: { state, grantPaid: paid, chaptersCompleted: [], practised: [] },
  };
}

function cloud(meta, run = null) {
  mocked.from.mockImplementation((table) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          const data =
            table === 'meta_progression' ? { 1: meta } : table === 'run_saves' ? run : null;
          return { data: data && { data: structuredClone(data), updated_at: 'r1' }, error: null };
        },
      }),
    }),
  }));
}

async function fetchWith(cloudMeta, cloudRun = null) {
  cloud(cloudMeta, cloudRun);
  await fetchAllToLocalStorage('u', { timeoutMs: 100 });
  return JSON.parse(store.get(KEY));
}

/** The kept economy, as a live manager loads it, after the prologue's end is committed. */
function economyAfterCompleting() {
  const meta = new MetaProgressionManager(upgradesData, KEY);
  const result = meta.completePrologue({ grant: GRANT });
  expect(result.ok).toBe(true);
  return {
    paidAgain: result.paid,
    valor: meta.totalValor,
    supply: meta.totalSupply,
    upgrades: { ...meta.purchasedUpgrades },
  };
}

beforeEach(() => {
  store.clear();
  mocked.from.mockReset();
  __resetCloudSyncQueuesForTests();
  __resetCloudSyncStatusForTests();
});

describe('the cloud merge keeps the grant with the economy it picked', () => {
  it('the review repro: a newer local copy that only began, an older cloud copy that finished and was paid', async () => {
    store.set(KEY, JSON.stringify(payload({ savedAt: 200, state: 'in_progress' })));
    const merged = await fetchWith(payload({ savedAt: 100, state: 'complete' }));
    expect(merged.prologue).toMatchObject({ state: 'complete', grantPaid: true });
    // The local economy (0/0) kept, plus the grant it never held: not 0/0.
    expect([merged.totalValor, merged.totalSupply]).toEqual([GRANT.valor, GRANT.supply]);
    expect(economyAfterCompleting()).toEqual({
      paidAgain: false,
      valor: GRANT.valor,
      supply: GRANT.supply,
      upgrades: {},
    });
  });

  it('the other ordering: the newer cloud copy only began, the older local one finished', async () => {
    store.set(KEY, JSON.stringify(payload({ savedAt: 100, state: 'complete', own: [7, 3] })));
    const merged = await fetchWith(payload({ savedAt: 200, state: 'in_progress', own: [5, 2] }));
    // The cloud's economy is kept (local's 7/3 goes with it, as for any picked payload),
    // and the grant local had is paid into it once.
    expect([merged.totalValor, merged.totalSupply]).toEqual([5 + GRANT.valor, 2 + GRANT.supply]);
    expect(merged.prologue).toMatchObject({ state: 'complete', grantPaid: true });
    // A repaired copy is a new write, newer than both.
    expect(merged.savedAt).toBeGreaterThan(200);
    expect(economyAfterCompleting().paidAgain).toBe(false);
  });

  it('an unspent grant on both copies is never added again, in either ordering', async () => {
    for (const [localAt, cloudAt] of [
      [100, 200],
      [200, 100],
    ]) {
      store.clear();
      store.set(KEY, JSON.stringify(payload({ savedAt: localAt, state: 'complete' })));
      const merged = await fetchWith(payload({ savedAt: cloudAt, state: 'complete' }));
      expect([merged.totalValor, merged.totalSupply]).toEqual([GRANT.valor, GRANT.supply]);
      expect(economyAfterCompleting().paidAgain).toBe(false);
    }
  });

  it('a grant spent on upgrades in the kept copy stays spent: no balance comes back', async () => {
    // The newer copy finished, was paid and bought a tier; the older one only began.
    store.set(KEY, JSON.stringify(payload({ savedAt: 100, state: 'in_progress' })));
    const merged = await fetchWith(payload({ savedAt: 200, state: 'complete', spent: true }));
    expect(merged.totalSupply).toBe(GRANT.supply - HP_TIER_1);
    expect(merged.purchasedUpgrades).toEqual({ recruit_hp_growth: 1 });
    expect(economyAfterCompleting()).toEqual({
      paidAgain: false,
      valor: GRANT.valor,
      supply: GRANT.supply - HP_TIER_1,
      upgrades: { recruit_hp_growth: 1 },
    });
    // The same, kept locally: a newer local copy that spent it, an older paid cloud copy.
    store.clear();
    store.set(KEY, JSON.stringify(payload({ savedAt: 200, state: 'complete', spent: true })));
    const kept = await fetchWith(payload({ savedAt: 100, state: 'complete' }));
    expect([kept.totalValor, kept.totalSupply]).toEqual([GRANT.valor, GRANT.supply - HP_TIER_1]);
  });

  it('a grant the dropped copy spent is paid once into the kept one (its upgrades went with it)', async () => {
    store.set(KEY, JSON.stringify(payload({ savedAt: 100, state: 'complete', spent: true })));
    const merged = await fetchWith(payload({ savedAt: 200, state: 'in_progress' }));
    expect([merged.totalValor, merged.totalSupply]).toEqual([GRANT.valor, GRANT.supply]);
    expect(merged.purchasedUpgrades).toEqual({});
  });

  it('a prologue still being played here, finished on the other copy: paid once, the run kept, and its ending pays nothing', async () => {
    const run = {
      version: 1,
      mode: 'prologue',
      runRecordId: 'p',
      actIndex: 0,
      roster: [{ name: 'Edric' }],
      nodeMap: { nodes: [{ id: 'prologue_3', row: 3 }] },
      currentNodeId: 'prologue_3',
      savedAt: 210,
    };
    store.set(KEY, JSON.stringify(payload({ savedAt: 200, state: 'in_progress' })));
    store.set(getRunKey(1), JSON.stringify(run));
    const merged = await fetchWith(payload({ savedAt: 100, state: 'complete' }));
    expect(merged.prologue.state).toBe('complete');
    expect(JSON.parse(store.get(getRunKey(1)))).toEqual(run);
    expect(routeForSlot(getSlotSummary(1))).toBe(PROLOGUE_ROUTES.RESUME);
    // Finishing the run here commits the ending: the grant is already in the economy.
    expect(economyAfterCompleting()).toMatchObject({
      paidAgain: false,
      valor: GRANT.valor,
      supply: GRANT.supply,
    });
  });

  it('repeated merges are idempotent: never a second grant', async () => {
    store.set(KEY, JSON.stringify(payload({ savedAt: 200, state: 'in_progress' })));
    const cloudCopy = payload({ savedAt: 100, state: 'complete' });
    const first = await fetchWith(cloudCopy);
    const second = await fetchWith(cloudCopy);
    const third = await fetchWith(cloudCopy);
    for (const merged of [second, third])
      expect([merged.totalValor, merged.totalSupply]).toEqual([GRANT.valor, GRANT.supply]);
    expect(third.prologue).toEqual(first.prologue);
    // The cloud copy wins next time (another device saved it later), still unpaid: the
    // repair is paid into that copy once, never on top of the earlier one.
    const later = await fetchWith(payload({ savedAt: Date.now() + 1e6, state: 'in_progress' }));
    expect([later.totalValor, later.totalSupply]).toEqual([GRANT.valor, GRANT.supply]);
    const again = await fetchWith(payload({ savedAt: Date.now() + 1e6, state: 'in_progress' }));
    expect([again.totalValor, again.totalSupply]).toEqual([GRANT.valor, GRANT.supply]);
  });

  it('exactly one grant is reflected, for every pair of states, both orderings', async () => {
    // complete ⇒ paid (completePrologue pays and records in one write); the others unpaid.
    const states = ['in_progress', 'skipped', 'complete'];
    for (const localState of states)
      for (const cloudState of states)
        for (const [localAt, cloudAt] of [
          [100, 200],
          [200, 100],
        ]) {
          store.clear();
          const local = payload({ savedAt: localAt, state: localState, own: [11, 13] });
          const remote = payload({ savedAt: cloudAt, state: cloudState, own: [17, 19] });
          store.set(KEY, JSON.stringify(local));
          const merged = await fetchWith(remote);
          const kept = localAt > cloudAt ? local : remote;
          const own = kept === local ? [11, 13] : [17, 19];
          const complete = localState === 'complete' || cloudState === 'complete';
          const label = `${localState}@${localAt} / ${cloudState}@${cloudAt}`;
          expect(merged.prologue.state === 'complete', label).toBe(complete);
          expect(merged.prologue.grantPaid, label).toBe(complete);
          expect([merged.totalValor, merged.totalSupply], label).toEqual(
            complete ? [own[0] + GRANT.valor, own[1] + GRANT.supply] : own,
          );
          if (complete) expect(economyAfterCompleting().paidAgain, label).toBe(false);
        }
  });

  it("a kept copy with no prologue record (a client from before it) can't vouch: the other receipt stays, nothing added", async () => {
    // An older client drops the record but keeps the currencies, a fetched grant included.
    store.set(KEY, JSON.stringify(payload({ savedAt: 100, state: 'complete' })));
    const stripped = { savedAt: 200, totalValor: GRANT.valor, totalSupply: GRANT.supply };
    const merged = await fetchWith(stripped);
    expect([merged.totalValor, merged.totalSupply]).toEqual([GRANT.valor, GRANT.supply]);
    expect(merged.prologue).toMatchObject({ state: 'complete', grantPaid: true });
  });
});

describe('reconcilePickedPrologue (pure)', () => {
  it('never touches the economy unless it repairs, and repairs into the winner only', () => {
    const winner = payload({ savedAt: 2, state: 'skipped', own: [3, 4] });
    const loser = payload({ savedAt: 1, state: 'complete', own: [900, 900] });
    expect(reconcilePickedPrologue(winner, loser, GRANT).economy).toEqual({
      totalValor: 3 + GRANT.valor,
      totalSupply: 4 + GRANT.supply,
    });
    expect(reconcilePickedPrologue(loser, winner, GRANT).economy).toBeNull();
    const none = { ...winner, prologue: { state: 'none' } };
    expect(reconcilePickedPrologue(none, loser, GRANT)).toMatchObject({
      prologue: { state: 'complete', grantPaid: true },
      economy: null,
    });
  });
});

describe('the local adopt-merge keeps both economies, so the receipt is a union', () => {
  it('a paid live copy and a newer unpaid copy on disk: one grant, never two', () => {
    store.set(KEY, JSON.stringify(payload({ savedAt: 100, state: 'complete' })));
    const meta = new MetaProgressionManager(upgradesData, KEY);
    // Another writer (a fetch, a tab) puts a newer copy that only began on disk.
    store.set(KEY, JSON.stringify(payload({ savedAt: Date.now() + 1e6, state: 'in_progress' })));
    expect(meta.completePrologue({ grant: GRANT })).toMatchObject({ ok: true, paid: false });
    expect([meta.totalValor, meta.totalSupply]).toEqual([GRANT.valor, GRANT.supply]);
  });

  it('an unpaid live copy and a newer paid copy on disk: adopted, never paid again', () => {
    store.set(KEY, JSON.stringify(payload({ savedAt: 100, state: 'in_progress' })));
    const meta = new MetaProgressionManager(upgradesData, KEY);
    store.set(
      KEY,
      JSON.stringify(payload({ savedAt: Date.now() + 1e6, state: 'complete', spent: true })),
    );
    expect(meta.completePrologue({ grant: GRANT })).toMatchObject({ ok: true, paid: false });
    expect([meta.totalValor, meta.totalSupply]).toEqual([GRANT.valor, GRANT.supply - HP_TIER_1]);
    expect(meta.purchasedUpgrades).toEqual({ recruit_hp_growth: 1 });
  });
});
