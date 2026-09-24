// End-of-run rewards are written to meta before RunComplete clears the run
// save. A reload in that window used to re-read an unsettled run and pay the
// valor/supply (and runsCompleted) a second time. settleAndPersistEndRun
// persists the settled record immediately, so the reload settle is a no-op.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = {};
let failRunWrites = false;
let failMetaWrites = false;
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => {
      if (failRunWrites && k.endsWith('_run')) throw new Error('QuotaExceededError');
      if (failMetaWrites && k.endsWith('_meta')) throw new Error('QuotaExceededError');
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  writable: true,
});

import { loadGameData } from './testData.js';
import {
  RunManager,
  saveRun,
  loadRun,
  settleAndPersistEndRun,
  endRunPayoutPending,
  retryPendingEndRunPayout,
} from '../src/engine/RunManager.js';
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

  it('pays once even when the settled run itself could not be written', () => {
    const rm = finishRun(gd);
    rm.status = 'victory';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    failRunWrites = true;
    let first;
    try {
      first = settleAndPersistEndRun(rm, freshMeta(gd), 'victory', { slot: 1 });
    } finally {
      failRunWrites = false;
    }
    const afterFirst = freshMeta(gd);
    expect(afterFirst.totalValor).toBe(first.valor);

    // The slot still holds the unsettled run; reloading settles it again.
    const reloaded = loadRun(gd, 1);
    expect(reloaded.endRunRewards?.appliedToMeta).not.toBe(true);
    reloaded.status = 'victory';
    settleAndPersistEndRun(reloaded, freshMeta(gd), 'victory', { slot: 1 });

    const final = freshMeta(gd);
    expect(final.totalValor).toBe(first.valor);
    expect(final.totalSupply).toBe(afterFirst.totalSupply);
    expect(final.runsCompleted).toBe(afterFirst.runsCompleted);
    expect(loadRun(gd, 1).endRunRewards?.appliedToMeta).toBe(true);
    vi.restoreAllMocks();
  });

  it('still pays a different run in full', () => {
    const meta = freshMeta(gd);
    meta.markRunSettled('some-earlier-run');
    const rm = finishRun(gd);
    rm.status = 'victory';
    const rewards = settleAndPersistEndRun(rm, meta, 'victory', { slot: 1 });
    expect(freshMeta(gd).totalValor).toBe(rewards.valor);
    expect(freshMeta(gd).hasSettledRun(rm.runRecordId)).toBe(true);
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

  it('a failed meta write never records the run as paid (review repro: 75 Valor → 0)', () => {
    const rm = finishRun(gd);
    rm.status = 'victory';
    const meta = freshMeta(gd);
    const expected = rm.previewEndRunRewards('victory');
    expect(expected.valor).toBeGreaterThan(0);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    failMetaWrites = true;
    let first;
    try {
      first = settleAndPersistEndRun(rm, meta, 'victory', { slot: 1 });
    } finally {
      failMetaWrites = false;
    }
    // Nothing was credited or marked paid, in memory or on disk.
    expect(first.appliedToMeta).toBe(false);
    expect(endRunPayoutPending(rm, meta)).toBe(true);
    expect(meta.totalValor).toBe(0);
    expect(meta.hasSettledRun(rm.runRecordId)).toBe(false);
    expect(freshMeta(gd).totalValor).toBe(0);
    // The run save (which did succeed) records the payout as still owed.
    const reloaded = loadRun(gd, 1);
    expect(reloaded.endRunRewards.appliedToMeta).toBe(false);

    // Retry after reload pays exactly once, in full, and clears the save.
    const later = freshMeta(gd);
    expect(retryPendingEndRunPayout(gd, later, 1)).toBe(true);
    const final = freshMeta(gd);
    expect(final.totalValor).toBe(expected.valor);
    expect(final.totalSupply).toBe(expected.supply);
    expect(final.runsCompleted).toBe(1);
    expect(final.hasSettledRun(rm.runRecordId)).toBe(true);
    expect(loadRun(gd, 1)).toBeNull();
    // A second retry finds nothing to pay.
    expect(retryPendingEndRunPayout(gd, final, 1)).toBe(false);
    expect(freshMeta(gd).totalValor).toBe(expected.valor);
    vi.restoreAllMocks();
  });

  it('writes the payout, counters, milestones and paid marker in one meta write', () => {
    const rm = finishRun(gd);
    rm.status = 'victory';
    const meta = freshMeta(gd);
    const writes = [];
    const setItem = localStorage.setItem;
    localStorage.setItem = (k, v) => {
      if (k.endsWith('_meta')) writes.push(JSON.parse(v));
      return setItem(k, v);
    };
    try {
      rm.settleEndRunRewards(meta, 'victory');
    } finally {
      localStorage.setItem = setItem;
    }
    expect(writes).toHaveLength(1);
    const [payload] = writes;
    expect(payload.totalValor).toBeGreaterThan(0);
    expect(payload.totalSupply).toBeGreaterThan(0);
    expect(payload.runsCompleted).toBe(1);
    expect(payload.settledRunIds).toContain(rm.runRecordId);
    expect(payload.milestones).toContain('beatAct1');
  });

  it('a payout that fails part-way rolls back instead of half-paying', () => {
    const meta = freshMeta(gd);
    const before = meta._captureState();
    expect(() =>
      meta.applyRunPayout((m) => {
        m.addValor(40);
        m.markRunSettled('run-x');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(meta._captureState()).toEqual(before);
    expect(meta.hasSettledRun('run-x')).toBe(false);
    // Saves are no longer deferred after the failure.
    meta.addValor(5);
    expect(freshMeta(gd).totalValor).toBe(5);
  });

  it('keeps retrying while meta cannot be written, without losing the owed payout', () => {
    const rm = new RunManager(gd);
    rm.startRun({ runSeed: 11, applyBlessingsAtStart: false });
    rm.completedBattles = 3;
    rm.failRun();
    const owed = rm.previewEndRunRewards('defeat');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    failMetaWrites = true;
    try {
      settleAndPersistEndRun(rm, freshMeta(gd), 'defeat', { slot: 1 });
      expect(retryPendingEndRunPayout(gd, freshMeta(gd), 1)).toBe(false);
      expect(loadRun(gd, 1).endRunRewards.appliedToMeta).toBe(false);
    } finally {
      failMetaWrites = false;
    }
    expect(retryPendingEndRunPayout(gd, freshMeta(gd), 1)).toBe(true);
    expect(freshMeta(gd).totalValor).toBe(owed.valor);
    vi.restoreAllMocks();
  });
});
