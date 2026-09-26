import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  default: { Scene: class {}, Math: { Clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) } },
}));
vi.mock('../src/ui/HintDisplay.js', () => ({ showMinorHint: vi.fn(), showImportantHint: vi.fn() }));
import { showMinorHint } from '../src/ui/HintDisplay.js';
import { RunManager } from '../src/engine/RunManager.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const storage = new Map();
let failWrites = false;
beforeEach(() => {
  storage.clear();
  failWrites = false;
  showMinorHint.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => {
      if (failWrites) throw new Error('write blocked');
      storage.set(k, String(v));
    },
    removeItem: (k) => storage.delete(k),
    key: (i) => [...storage.keys()][i] ?? null,
    get length() {
      return storage.size;
    },
  });
});

function scene(slot) {
  const run = new RunManager(data);
  run.startRun({ runSeed: 7 });
  return {
    runManager: run,
    registry: { get: (key) => (key === 'activeSlot' ? slot : null) },
  };
}
const save = (s) => NodeMapScene.prototype.persistRunSave.call(s);

it('a session without a save slot (dev routes) saves nothing and warns about nothing', () => {
  const result = save(scene(undefined));
  expect(result).toEqual({ ok: false, reason: 'missing_slot' });
  expect(showMinorHint).not.toHaveBeenCalled();
  expect(storage.size).toBe(0);
});

it('a real slot saves quietly', () => {
  expect(save(scene(1)).ok).toBe(true);
  expect(storage.has('emblem_rogue_slot_1_run')).toBe(true);
  expect(showMinorHint).not.toHaveBeenCalled();
});

it('a real failure on a real slot still tells the player', () => {
  failWrites = true;
  expect(save(scene(1)).ok).toBe(false);
  expect(showMinorHint).toHaveBeenCalledWith(
    expect.anything(),
    'Save failed — storage may be unavailable',
  );
});
