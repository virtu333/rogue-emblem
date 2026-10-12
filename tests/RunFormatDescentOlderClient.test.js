// A Descent save on a client from before the Descent (engine/RunFormat.js): one with the run-format
// guard (#305) and none of the Descent's ids. RunFormat is mocked to that client: it plays no
// capability, and derives only the guard's own seven (the Descent's fields mean nothing to it),
// so whatever it refuses here it refuses on the save's marker. The loader, the slot summary and
// the slot card are this build's own, as they are the guard's. Detection and the marker's stages
// are RunFormatDescent.test.js.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/RunFormat.js', async (importOriginal) => {
  const actual = await importOriginal();
  // The guard's table as #305 shipped it: the only ids that client derives from a payload.
  const GUARD_IDS = new Set([
    'encounters',
    'parModel',
    'objectives',
    'gateTerrain',
    'bossKit',
    'arena',
    'setPiece',
  ]);
  const runFormatBlock = (saved, { runFormat = 2, clientCapabilities = [] } = {}) => {
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    const stored = actual.storedRunFormat(saved);
    const derived = actual.requiredRunFormat(saved).capabilities.filter((id) => GUARD_IDS.has(id));
    const capabilities = [...new Set([...stored.capabilities, ...derived])];
    const format = Math.max(stored.format, derived.length ? 2 : 1);
    const missing = capabilities.filter((id) => !clientCapabilities.includes(id));
    return format <= runFormat && missing.length === 0 ? null : { format, capabilities, missing };
  };
  return { ...actual, CLIENT_CAPABILITIES: Object.freeze([]), runFormatBlock };
});

import { loadGameData } from './testData.js';
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { getMetaKey, getRunKey, getSlotSummary } from '../src/engine/SlotManager.js';
import { RunFormatError } from '../src/engine/RunFormat.js';
import { slotCardModel, NEEDS_NEWER_CLIENT_TEXT } from '../src/ui/slotCardModel.js';
import { pickResumeSlot } from '../src/ui/titleMenuModel.js';
import {
  atGateRun,
  descentEntryRun,
  midVigilRun,
  pastVigilRun,
  startedRun,
  withDescentOff,
  withDescentOn,
} from './helpers/descentRunFormatFixtures.js';

// The older client's data: from before the Descent, so it is switched off there (the shipped
// file has it on); its final act is the old 2-node map.
const gameData = withDescentOff(loadGameData());
const descentData = withDescentOn(gameData);

const store = new Map();
let writes = 0;
beforeEach(() => {
  store.clear();
  writes = 0;
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      writes++;
      store.set(k, String(v));
    },
    removeItem: (k) => {
      writes++;
      store.delete(k);
    },
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  };
});

/** Put a save in slot 1 as its writer left it (with the slot's meta). */
function storeSave(saved) {
  const raw = JSON.stringify(saved);
  store.set(getRunKey(1), raw);
  store.set(getMetaKey(1), JSON.stringify({ savedAt: 1, runsStarted: 3 }));
  writes = 0;
  return raw;
}

const STAGES = [
  ['route entry on First Light', () => descentEntryRun(descentData, { difficultyId: 'normal' })],
  ['route entry on Nightfall', () => descentEntryRun(descentData, { difficultyId: 'hard' })],
  ['mid-Vigil (a checkpoint holding its count)', () => midVigilRun(descentData)],
  ['a Rite that has taken words', () => pastVigilRun(descentData)],
  ['at the gate (its battle in progress)', () => atGateRun(descentData)],
];

describe('an older client refuses every stage of a Descent run and leaves the save as it was', () => {
  it.each(STAGES)('%s', (_label, build) => {
    const raw = storeSave(build().toJSON());
    expect(loadRun(gameData, 1)).toBeNull();
    expect(store.get(getRunKey(1))).toBe(raw);
    expect(writes).toBe(0);
    expect(() => RunManager.fromJSON(JSON.parse(raw), gameData)).toThrow(RunFormatError);
    // The slot says so: no Continue, and Resume never picks it.
    const summary = getSlotSummary(1);
    expect(summary).toMatchObject({
      hasActiveRun: true,
      needsNewerClient: true,
      runCorrupt: false,
    });
    const card = slotCardModel(1, summary, { gameData });
    expect(card.state).toBe('newer');
    expect(card.status).toBe(NEEDS_NEWER_CLIENT_TEXT);
    expect(pickResumeSlot([summary])).toBeNull();
  });

  it('the marker is what holds it there: the route-entry save without one would load', () => {
    // First Light's entry holds no mechanic the guard's own detection knows; only the Descent's
    // ids in its marker stop that client. (So the floor written at the route's build matters.)
    const saved = descentEntryRun(descentData, { difficultyId: 'normal' }).toJSON();
    expect(saved.requiresCapabilities).toEqual(['descent', 'rite']);
    delete saved.requiresClient;
    delete saved.requiresCapabilities;
    storeSave(saved);
    expect(loadRun(gameData, 1)).toBeInstanceOf(RunManager);
  });
});

describe('the same older client still loads everything else', () => {
  it('a run with the Descent switched on, short of the final act', () => {
    const run = startedRun(descentData, { difficultyId: 'lunatic', seed: 6 });
    run.advanceAct();
    run.advanceAct();
    const raw = storeSave(run.toJSON());
    expect(loadRun(gameData, 1)).toBeInstanceOf(RunManager);
    expect(store.get(getRunKey(1))).toBe(raw);
    expect(getSlotSummary(1).needsNewerClient).toBe(false);
  });

  it('a final act built with the Descent off (the 2-node map)', () => {
    storeSave(descentEntryRun(gameData, { difficultyId: 'hard' }).toJSON());
    expect(loadRun(gameData, 1)).toBeInstanceOf(RunManager);
    expect(getSlotSummary(1).needsNewerClient).toBe(false);
  });

  it('an old save from before the Rite (no `rite` key)', () => {
    const old = startedRun(gameData, { difficultyId: 'normal', seed: 2 }).toJSON();
    delete old.rite;
    const raw = storeSave(old);
    const loaded = loadRun(gameData, 1);
    expect(loaded).toBeInstanceOf(RunManager);
    expect(loaded.rite).toBeNull();
    expect(store.get(getRunKey(1))).toBe(raw);
    expect(writes).toBe(0);
  });
});
