// End-of-run rewards are written to meta before RunComplete clears the run
// save. A reload in that window used to re-read an unsettled run and pay the
// valor/supply (and runsCompleted) a second time. settleAndPersistEndRun
// persists the settled record immediately, so the reload settle is a no-op.

import { describe, it, expect, beforeEach } from 'vitest';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  writable: true,
});

import { loadGameData } from './testData.js';
import { RunManager, saveRun, loadRun, settleAndPersistEndRun } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';

function finishRun(gd) {
  const rm = new RunManager(gd);
  rm.startRun({ runSeed: 5, applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.length - 1;
  const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
  expect(rm.completeBattle(rm.getRoster(), boss.id, 0)).toBe(true);
  expect(rm.isRunComplete()).toBe(true);
  expect(saveRun(rm, null, 1).ok).toBe(true);
  return rm;
}

const freshMeta = (gd) => new MetaProgressionManager(gd.metaUpgrades, getMetaKey(1));

describe('settleAndPersistEndRun', () => {
  let gd;
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    gd = loadGameData();
  });

  it('pays victory rewards once even if the page dies before RunComplete clears the run', () => {
    const rm = finishRun(gd);
    rm.status = 'victory';
    const first = settleAndPersistEndRun(rm, freshMeta(gd), 'victory', { slot: 1 });
    expect(first.valor).toBeGreaterThan(0);
    const afterFirst = freshMeta(gd);
    expect(afterFirst.totalValor).toBe(first.valor);

    // Reload: NodeMap's checkActComplete settles the reloaded run again.
    const reloaded = loadRun(gd, 1);
    expect(reloaded.endRunRewards?.appliedToMeta).toBe(true);
    reloaded.status = 'victory';
    settleAndPersistEndRun(reloaded, freshMeta(gd), 'victory', { slot: 1 });

    const final = freshMeta(gd);
    expect(final.totalValor).toBe(first.valor);
    expect(final.totalSupply).toBe(afterFirst.totalSupply);
    expect(final.runsCompleted).toBe(afterFirst.runsCompleted);
  });

  it('persists the defeat outcome so an abandon interrupted before clearing is not replayable', () => {
    const rm = new RunManager(gd);
    rm.startRun({ runSeed: 9, applyBlessingsAtStart: false });
    expect(saveRun(rm, null, 1).ok).toBe(true);
    rm.failRun();
    settleAndPersistEndRun(rm, freshMeta(gd), 'defeat', { slot: 1 });

    const reloaded = loadRun(gd, 1);
    expect(reloaded.status).toBe('defeat');
    expect(reloaded.endRunRewards?.appliedToMeta).toBe(true);
  });

  it('only settles (no write) without a valid slot', () => {
    const rm = new RunManager(gd);
    rm.startRun({ runSeed: 3, applyBlessingsAtStart: false });
    rm.failRun();
    const rewards = settleAndPersistEndRun(rm, freshMeta(gd), 'defeat', { slot: undefined });
    expect(rewards.appliedToMeta).toBe(true);
    expect(Object.keys(store).some((k) => /_run$/.test(k))).toBe(false);
  });
});
