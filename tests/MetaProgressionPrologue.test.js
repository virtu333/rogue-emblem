// meta.prologue (docs/specs/prologue-chapter.md §9): the state and its ledger round-trip
// the slot's meta save, the Home Base grant is paid exactly once across a refresh
// between the grant and the next save, a cloud merge keeps a paid grant paid, the
// state never steps back from complete, and runsStarted / runsCompleted never move.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MetaProgressionManager,
  normalizePrologueState,
  mergePrologueState,
} from '../src/engine/MetaProgressionManager.js';
import upgradesData from '../data/metaUpgrades.json';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
  setItem: vi.fn((key, val) => {
    store[key] = String(val);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

const KEY = 'emblem_rogue_slot_1_meta';
const GRANT = { valor: 60, supply: 40 };
const saved = () => JSON.parse(store[KEY]);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  localStorageMock.setItem.mockClear();
});

describe('the record', () => {
  it('starts at none with nothing paid, and normalizes garbage', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    expect(meta.getPrologueState()).toBe('none');
    expect(meta.getPrologue()).toEqual({
      state: 'none',
      grantPaid: false,
      chaptersCompleted: [],
      practised: [],
    });
    expect(
      normalizePrologueState({ state: 'bogus', grantPaid: 'yes', chaptersCompleted: 'p1' }),
    ).toEqual({ state: 'none', grantPaid: false, chaptersCompleted: [], practised: [] });
  });

  it('round-trips the slot save: state, ledger, chapters and practised lessons', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.setPrologueState('in_progress');
    meta.recordPrologueChapter('p1_banner_at_dawn');
    meta.recordProloguePractised(['forecast', 'forecast', 'veteran_kills']);
    expect(saved().prologue).toEqual({
      state: 'in_progress',
      grantPaid: false,
      chaptersCompleted: ['p1_banner_at_dawn'],
      practised: ['forecast', 'veteran_kills'],
    });
    const again = new MetaProgressionManager(upgradesData, KEY);
    expect(again.getPrologue()).toEqual(meta.getPrologue());
    expect(again.hasCompletedPrologueChapter('p1_banner_at_dawn')).toBe(true);
    expect(again.hasCompletedPrologueChapter('p2_old_hands')).toBe(false);
  });

  it('an old save without the field loads as none', () => {
    store[KEY] = JSON.stringify({ totalValor: 10, totalSupply: 5, runsStarted: 2 });
    const meta = new MetaProgressionManager(upgradesData, KEY);
    expect(meta.getPrologueState()).toBe('none');
    expect(meta.runsStarted).toBe(2);
  });

  it('never steps back from complete, and refuses an unknown state', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.completePrologue({ grant: GRANT });
    expect(meta.setPrologueState('skipped')).toEqual({ ok: true });
    expect(meta.getPrologueState()).toBe('complete');
    expect(meta.setPrologueState('later')).toEqual({ ok: false });
  });
});

describe('the grant is paid once', () => {
  it('completePrologue pays the grant, marks the ledger and saves in one write', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    localStorageMock.setItem.mockClear();
    const result = meta.completePrologue({
      grant: GRANT,
      chaptersCompleted: ['p1_banner_at_dawn', 'p2_old_hands'],
      practised: ['forecast'],
    });
    expect(result).toEqual({ ok: true, paid: true });
    expect(meta.totalValor).toBe(60);
    expect(meta.totalSupply).toBe(40);
    expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
    expect(saved()).toMatchObject({
      totalValor: 60,
      totalSupply: 40,
      runsStarted: 0,
      runsCompleted: 0,
      prologue: {
        state: 'complete',
        grantPaid: true,
        chaptersCompleted: ['p1_banner_at_dawn', 'p2_old_hands'],
        practised: ['forecast'],
      },
    });
  });

  it('a second call (the ending reached again) pays nothing', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.completePrologue({ grant: GRANT });
    expect(meta.completePrologue({ grant: GRANT })).toEqual({ ok: true, paid: false });
    expect(meta.totalValor).toBe(60);
    expect(meta.totalSupply).toBe(40);
  });

  it('a refresh between the grant and the next save finds it paid', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.completePrologue({ grant: GRANT });
    // The page reloads: a new manager reads the slot from disk.
    const reloaded = new MetaProgressionManager(upgradesData, KEY);
    expect(reloaded.getPrologueState()).toBe('complete');
    expect(reloaded.completePrologue({ grant: GRANT })).toEqual({ ok: true, paid: false });
    expect(reloaded.totalValor).toBe(60);
    expect(saved().totalValor).toBe(60);
  });

  it('a payment that cannot be saved is rolled back so a retry pays, never a second call', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    // A refusal that is not a quota (a quota first sheds optional records and retries).
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('storage refused the write');
    });
    expect(meta.completePrologue({ grant: GRANT })).toEqual({ ok: false, paid: false });
    expect(meta.totalValor).toBe(0);
    expect(meta.getPrologueState()).toBe('none');
    expect(meta.completePrologue({ grant: GRANT })).toEqual({ ok: true, paid: true });
    expect(meta.totalValor).toBe(60);
  });

  it('a paid grant on disk (another device, a cloud fetch) is adopted before paying', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.addValor(5); // this manager has saved once
    const foreign = {
      ...saved(),
      totalValor: 65,
      totalSupply: 40,
      prologue: { state: 'complete', grantPaid: true, chaptersCompleted: [], practised: [] },
      savedAt: saved().savedAt + 10_000,
    };
    store[KEY] = JSON.stringify(foreign);
    expect(meta.completePrologue({ grant: GRANT })).toEqual({ ok: true, paid: false });
    expect(meta.totalValor).toBe(65);
    expect(meta.totalSupply).toBe(40);
    expect(saved().prologue.grantPaid).toBe(true);
  });

  it('runsStarted and runsCompleted never move', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.setPrologueState('in_progress');
    meta.recordPrologueChapter('p1_banner_at_dawn');
    meta.completePrologue({ grant: GRANT });
    expect(meta.runsStarted).toBe(0);
    expect(meta.runsCompleted).toBe(0);
    expect(meta.getRunsStarted()).toBe(0);
  });
});

describe('merging two records', () => {
  it('takes the further state, keeps a paid grant paid and unions the lists', () => {
    expect(
      mergePrologueState(
        { state: 'skipped', grantPaid: false, chaptersCompleted: ['a'], practised: ['x'] },
        { state: 'in_progress', grantPaid: true, chaptersCompleted: ['b'], practised: ['x', 'y'] },
      ),
    ).toEqual({
      state: 'skipped',
      grantPaid: true,
      chaptersCompleted: ['a', 'b'],
      practised: ['x', 'y'],
    });
    expect(mergePrologueState({ state: 'complete' }, null).state).toBe('complete');
  });

  it('a newer foreign payload keeps the local completion too (max-merge on adopt)', () => {
    const meta = new MetaProgressionManager(upgradesData, KEY);
    meta.completePrologue({ grant: GRANT });
    const foreign = {
      ...saved(),
      totalValor: 500,
      prologue: { state: 'skipped', grantPaid: false, chaptersCompleted: [], practised: [] },
      savedAt: saved().savedAt + 10_000,
    };
    store[KEY] = JSON.stringify(foreign);
    meta.addValor(1); // any save adopts the newer disk copy first (max-merge)
    expect(meta.getPrologue()).toMatchObject({ state: 'complete', grantPaid: true });
    expect(meta.totalValor).toBe(500);
    expect(JSON.parse(store[KEY]).prologue.grantPaid).toBe(true);
  });
});
