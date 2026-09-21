import { it, expect, vi } from 'vitest';
import {
  resolveDeploymentSelection,
  normalizeDeploymentNames,
} from '../src/engine/DeploymentSelection.js';
import { RunManager } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { loadGameData } from './testData.js';
const roster = [{ name: 'Edric', isCommander: true }, { name: 'Sera' }, { name: 'Fighter' }];
it('retains commander and remembered order while dropping missing units and trimming the cap', () => {
  expect(
    resolveDeploymentSelection(roster, { min: 1, max: 2 }, ['Dead', 'Fighter', 'Sera']).map(
      (u) => u.name,
    ),
  ).toEqual(['Edric', 'Fighter']);
  expect(resolveDeploymentSelection(roster, { min: 2, max: 3 }, []).map((u) => u.name)).toEqual([
    'Edric',
  ]);
  expect(resolveDeploymentSelection(roster, { min: 0, max: 0 }, ['Sera'])).toEqual([]);
  expect(normalizeDeploymentNames([null, 'Edric', 'Edric', 42])).toEqual(['Edric']);
});
it('deployment memory round-trips and old saves remain valid', () => {
  const data = loadGameData();
  const run = new RunManager(data);
  run.startRun();
  run.lastDeployment = ['Edric', 'Sera'];
  expect(RunManager.fromJSON(run.toJSON(), data).lastDeployment).toEqual(['Edric', 'Sera']);
  const old = run.toJSON();
  delete old.lastDeployment;
  expect(RunManager.fromJSON(old, data).lastDeployment).toEqual([]);
  run.startRun();
  expect(run.lastDeployment).toEqual([]);
});
it('last difficulty survives a new meta instance and rejects invalid IDs', () => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
  });
  try {
    const meta = new MetaProgressionManager([], 'test');
    expect(meta.lastDifficulty).toBeNull();
    const adopt = vi.spyOn(meta, '_adoptForeignDiskStateIfNewer').mockImplementation(() => {
      meta.lastDifficulty = 'normal';
    });
    expect(meta.rememberDifficulty('hard')).toEqual({ ok: true });
    expect(adopt).toHaveBeenCalledTimes(1);
    adopt.mockRestore();
    expect(new MetaProgressionManager([], 'test').lastDifficulty).toBe('hard');
    expect(meta.rememberDifficulty('invalid').ok).toBe(false);
  } finally {
    vi.unstubAllGlobals();
  }
});
