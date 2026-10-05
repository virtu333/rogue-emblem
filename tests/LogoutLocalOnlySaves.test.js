// Sign-out with a save no backup can carry (docs/specs/prologue-chapter.md §9
// "RunManager", the logout contract). The prologue's run save stays on the device
// (CloudSync.isLocalOnlyRunSave), and sign-out clears the slot cache so another account
// never inherits it. So logout's backup names what it could not carry
// (`{ ok, localOnly }`), and the title asks before discarding it: a confirmed backup of
// everything else is never read as consent. Each case drives the real logout (TitleScene,
// CloudSync, SlotManager against an in-memory Supabase) and then the same account
// signing in again: every save is either back, or was discarded only after the player
// chose to; the standard run reaches the cloud before anything is cleared; Keep playing
// keeps everything.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
const mocks = vi.hoisted(() => ({ from: vi.fn(), signOut: vi.fn(), report: vi.fn() }));
vi.mock('../src/utils/domUI.js', () => ({ hasDOMHost: () => true }));
vi.mock('../src/ui/MenuSurface.js', async () => ({
  ...(await vi.importActual('../src/ui/MenuSurface.js')),
  element: (tag, text) => ({ tag, text }),
  button: (label, onClick) => ({ tag: 'button', label, onClick }),
}));
vi.mock('../src/cloud/supabaseClient.js', () => ({
  signOut: mocks.signOut,
  supabase: { from: mocks.from },
}));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocks.report }));
vi.mock('../src/utils/startupTelemetry.js', () => ({
  markStartup: vi.fn(),
  logStartupSummary: vi.fn(),
}));

import { TitleScene, localOnlyDiscardText } from '../src/scenes/TitleScene.js';
import {
  __flushCloudSyncQueuesForTests,
  __resetCloudSyncQueuesForTests,
  __resetCloudSyncStatusForTests,
  fetchAllToLocalStorage,
  listLocalOnlySaves,
} from '../src/cloud/CloudSync.js';
import { getMetaKey, getRunKey, getSlotSummary } from '../src/engine/SlotManager.js';
import { routeForSlot, PROLOGUE_ROUTES } from '../src/engine/PrologueRouting.js';

/** One user's row of a slot table, held in memory with its revision. */
function table({ failWrites = false } = {}) {
  const t = { row: null, writes: 0, failWrites };
  let rev = 0;
  const filtered = (run) => {
    const filters = [];
    const chain = {
      eq: (field, value) => (filters.push({ field, value }), chain),
      is: (field, value) => (filters.push({ field, value }), chain),
      select: () => chain,
      maybeSingle: async () => run(filters.find((f) => f.field === 'updated_at')?.value),
    };
    return chain;
  };
  const refuse = { data: null, error: { code: '500', message: 'offline' } };
  t.api = {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: t.row && { data: structuredClone(t.row.data), updated_at: t.row.updated_at },
          error: null,
        }),
      }),
    }),
    insert: async (payload) => {
      if (t.failWrites) return { error: refuse.error };
      t.writes++;
      if (t.row) return { error: { code: '23505', message: 'duplicate key' } };
      t.row = { data: structuredClone(payload.data), updated_at: `rev-${++rev}` };
      return { error: null };
    },
    update: (payload) =>
      filtered(async (expected) => {
        if (t.failWrites) return refuse;
        t.writes++;
        if (!t.row || (expected !== undefined && expected !== t.row.updated_at))
          return { data: null, error: null };
        t.row = { data: structuredClone(payload.data), updated_at: `rev-${++rev}` };
        return { data: { updated_at: t.row.updated_at }, error: null };
      }),
    delete: () =>
      filtered(async () => {
        if (t.failWrites) return refuse;
        t.row = null;
        return { data: { user_id: 'u' }, error: null };
      }),
    upsert: async () => ({ error: null }),
  };
  return t;
}

const store = new Map();
let runs, metas, settings, scene, menus, reload;

function cloud({ failRunWrites = false } = {}) {
  runs = table({ failWrites: failRunWrites });
  metas = table();
  settings = table();
  mocks.from.mockImplementation((name) =>
    name === 'run_saves' ? runs.api : name === 'meta_progression' ? metas.api : settings.api,
  );
}

const prologueRun = {
  version: 1,
  mode: 'prologue',
  runRecordId: 'prologue-run',
  actIndex: 0,
  roster: [{ name: 'Edric' }, { name: 'Gaspar' }],
  nodeMap: { nodes: [{ id: 'prologue_1', row: 1 }] },
  currentNodeId: 'prologue_1',
  savedAt: 500,
};
const standardRun = {
  version: 1,
  mode: 'standard',
  runRecordId: 'standard-run',
  actIndex: 0,
  roster: [{ name: 'Edric' }, { name: 'Sera' }],
  nodeMap: { nodes: [{ id: 'n3', row: 3 }] },
  currentNodeId: 'n3',
  gold: 321,
  savedAt: 400,
};
const prologueMeta = { savedAt: 300, totalValor: 0, totalSupply: 0, prologue: { state: 'in_progress' } }; // prettier-ignore
const veteranMeta = { savedAt: 310, totalValor: 90, totalSupply: 70, runsStarted: 2, prologue: { state: 'complete', grantPaid: true } }; // prettier-ignore
const completeMeta = { savedAt: 320, totalValor: 60, totalSupply: 40, prologue: { state: 'complete', grantPaid: true } }; // prettier-ignore

function put(slot, meta, run = null) {
  store.set(getMetaKey(slot), JSON.stringify(meta));
  if (run) store.set(getRunKey(slot), JSON.stringify(run));
}
const local = (key) => (store.has(key) ? JSON.parse(store.get(key)) : null);

beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  reload = vi.fn();
  vi.stubGlobal('location', { reload });
  mocks.from.mockReset();
  mocks.signOut.mockReset();
  mocks.signOut.mockResolvedValue(undefined);
  __resetCloudSyncQueuesForTests();
  __resetCloudSyncStatusForTests();
  scene = new TitleScene();
  scene.scene = { isActive: () => true };
  scene.registry = { get: (key) => (key === 'cloud' ? { userId: 'u' } : undefined) };
  scene._setLogoutNotice = vi.fn();
  scene._showLogoutProgress = vi.fn();
  menus = [];
  scene._openTitleMenu = (title) => {
    const menu = { title, children: [], focusContent: vi.fn() };
    menu.body = { append: (...nodes) => menu.children.push(...nodes) };
    scene.nativeMenu = menu;
    menus.push(menu);
    return menu;
  };
  scene._closeTitleMenu = () => {
    scene.nativeMenu = null;
  };
});
afterEach(() => vi.unstubAllGlobals());

const lastMenu = () => menus[menus.length - 1];
const text = (menu) =>
  menu.children
    .filter((n) => n.tag === 'p')
    .map((n) => n.text)
    .join(' ');
const press = async (menu, label) => {
  const node = menu.children.find((n) => n.tag === 'button' && n.label === label);
  expect(node, `${menu.title}: ${label}`).toBeTruthy();
  await node.onClick();
  // _finishLogout runs un-awaited from a button: let it settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The same account signs in again on this device (main.js's login fetch). */
async function signInAgain() {
  await __flushCloudSyncQueuesForTests();
  await fetchAllToLocalStorage('u', { timeoutMs: 100 });
}

describe('signing out with an unfinished prologue', () => {
  it('(a) asks before discarding it; Keep playing keeps everything; Sign out anyway discards it and the slot is offered the prologue again', async () => {
    cloud();
    put(1, prologueMeta, prologueRun);
    const before = new Map(store);

    await scene._handleLogout({ userId: 'u' });
    // The backup carried the meta, and could not carry the run: nothing is cleared,
    // and the player is asked, in words that say what will be lost.
    expect(metas.row.data[1].prologue.state).toBe('in_progress');
    expect(runs.row).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(store).toEqual(before);
    expect(lastMenu().title).toBe('Sign out?');
    expect(text(lastMenu())).toContain('unfinished prologue on Slot 1');
    expect(text(lastMenu())).toContain("can't be backed up");
    expect(text(lastMenu())).toContain('Signing out discards it');

    await press(lastMenu(), 'Keep playing');
    expect(scene.nativeMenu).toBeNull();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(store).toEqual(before);

    await scene._handleLogout({ userId: 'u' });
    await press(lastMenu(), 'Sign out anyway');
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
    // No unscoped save is left in the slot cache for the next account.
    expect(store.has(getRunKey(1))).toBe(false);
    expect(store.has(getMetaKey(1))).toBe(false);

    await signInAgain();
    const summary = getSlotSummary(1);
    expect(summary.hasActiveRun).toBe(false);
    expect(summary.prologue).toBe('in_progress');
    expect(routeForSlot(summary, { hasPrologue: true })).toBe(PROLOGUE_ROUTES.OFFER);
  });

  it('(b) a prologue slot beside a standard run: the run is uploaded before the question, and comes back on sign-in', async () => {
    cloud();
    put(1, prologueMeta, prologueRun);
    put(2, veteranMeta, standardRun);

    await scene._handleLogout({ userId: 'u' });
    // Asked only after the standard run and both metas reached the cloud.
    expect(lastMenu().title).toBe('Sign out?');
    expect(runs.row.data).toEqual({ 2: standardRun });
    expect(Object.keys(metas.row.data).sort()).toEqual(['1', '2']);
    expect(text(lastMenu())).toContain('Slot 1');
    expect(text(lastMenu())).not.toContain('Slot 2');
    expect(store.has(getRunKey(1))).toBe(true);

    await press(lastMenu(), 'Sign out anyway');
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(store.has(getRunKey(1))).toBe(false);
    expect(store.has(getRunKey(2))).toBe(false);

    await signInAgain();
    expect(local(getRunKey(2))).toEqual(standardRun);
    expect(routeForSlot(getSlotSummary(2))).toBe(PROLOGUE_ROUTES.RESUME);
    expect(routeForSlot(getSlotSummary(1))).toBe(PROLOGUE_ROUTES.OFFER);
  });

  it('(c) a completed prologue holds nothing local-only: sign-out asks nothing and loses nothing', async () => {
    cloud();
    put(1, completeMeta);
    put(2, veteranMeta, standardRun);
    expect(listLocalOnlySaves()).toEqual([]);

    await scene._handleLogout({ userId: 'u' });
    expect(menus).toEqual([]);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(store.has(getMetaKey(1))).toBe(false);

    await signInAgain();
    expect(local(getMetaKey(1)).prologue).toMatchObject({ state: 'complete', grantPaid: true });
    expect(local(getMetaKey(1)).totalValor).toBe(60);
    expect(local(getRunKey(2))).toEqual(standardRun);
    expect(routeForSlot(getSlotSummary(1))).toBe(PROLOGUE_ROUTES.HOME_BASE);
  });

  it('(d) a failed backup of the standard run: nothing goes without the explicit discard, which names the prologue too', async () => {
    cloud({ failRunWrites: true });
    put(1, prologueMeta, prologueRun);
    put(2, veteranMeta, standardRun);
    const before = new Map(store);

    await scene._handleLogout({ userId: 'u' });
    expect(lastMenu().title).toBe('Cloud backup failed');
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(store).toEqual(before);

    await press(lastMenu(), 'Stay signed in');
    expect(store).toEqual(before);
    expect(mocks.signOut).not.toHaveBeenCalled();

    await scene._handleLogout({ userId: 'u' });
    await press(lastMenu(), 'Discard local saves and log out');
    expect(lastMenu().title).toBe('Discard local saves?');
    expect(text(lastMenu())).toContain('unfinished prologue on Slot 1');
    await press(lastMenu(), 'Keep local saves');
    expect(store).toEqual(before);
    expect(mocks.signOut).not.toHaveBeenCalled();

    // A retry once the network is back uploads the run; the prologue is still asked about.
    runs.failWrites = false;
    await scene._handleLogout({ userId: 'u' });
    expect(runs.row.data).toEqual({ 2: standardRun });
    expect(lastMenu().title).toBe('Sign out?');
    await press(lastMenu(), 'Sign out anyway');
    expect(mocks.signOut).toHaveBeenCalledOnce();

    await signInAgain();
    expect(local(getRunKey(2))).toEqual(standardRun);
    expect(routeForSlot(getSlotSummary(1))).toBe(PROLOGUE_ROUTES.OFFER);
  });

  it('(d) the explicit discard after a failed backup is the only consent: both saves go, and the same account finds what the cloud held', async () => {
    cloud({ failRunWrites: true });
    put(1, prologueMeta, prologueRun);
    put(2, veteranMeta, standardRun);

    await scene._handleLogout({ userId: 'u' });
    await press(lastMenu(), 'Discard local saves and log out');
    await press(lastMenu(), 'Delete local saves and log out');
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(store.has(getRunKey(1))).toBe(false);
    expect(store.has(getRunKey(2))).toBe(false);

    runs.failWrites = false;
    await signInAgain();
    // The run never reached the cloud (the player was told); the metas did.
    expect(local(getRunKey(2))).toBeNull();
    expect(local(getMetaKey(2)).totalValor).toBe(90);
    expect(routeForSlot(getSlotSummary(1))).toBe(PROLOGUE_ROUTES.OFFER);
  });

  it('a prologue that appears after the question is asked about before sign-out clears it', async () => {
    cloud();
    put(1, prologueMeta, prologueRun);
    // The player agreed to discard Slot 1's; meanwhile (another tab, say) Slot 3 began one.
    put(3, prologueMeta, prologueRun);
    await scene._finishLogout({ discardLocalOnly: [{ slot: 1, kind: 'prologue' }] });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(store.has(getRunKey(1))).toBe(true);
    expect(store.has(getRunKey(3))).toBe(true);
    expect(lastMenu().title).toBe('Sign out?');
    expect(text(lastMenu())).toContain('Slots 1 and 3');
    await press(lastMenu(), 'Sign out anyway');
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(store.has(getRunKey(1))).toBe(false);
    expect(store.has(getRunKey(3))).toBe(false);
  });

  it('a slot logout keeps (an unchosen cloud conflict) is not named: its prologue stays', async () => {
    cloud();
    put(1, prologueMeta, prologueRun);
    store.set('emblem_rogue_slot_1_cloud_conflict', JSON.stringify({ localRun: prologueRun }));
    expect(listLocalOnlySaves()).toEqual([]);
  });
});

describe('localOnlyDiscardText', () => {
  it('names each slot, once, in order', () => {
    expect(localOnlyDiscardText([])).toBe('');
    expect(localOnlyDiscardText([{ slot: 3 }])).toContain('unfinished prologue on Slot 3 stays');
    expect(localOnlyDiscardText([{ slot: 3 }, { slot: 1 }, { slot: 3 }])).toContain(
      'unfinished prologues on Slots 1 and 3 stay',
    );
    expect(localOnlyDiscardText([{ slot: 2 }, { slot: 1 }, { slot: 3 }])).toContain(
      'Slots 1, 2 and 3',
    );
  });
});
