import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeySnapshot, assertJourneyEqual, assertNodeMonotonic } from './JourneyInvariants.js';
import { loadRun, saveRun } from '../../src/engine/RunManager.js';
import { createRecruitUnit } from '../../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { _resetUidCounter } from '../../src/utils/itemUid.js';
import { showMinorHint } from '../../src/ui/HintDisplay.js';
import { saveServiceRun } from '../../src/ui/serviceSave.js';

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
  installSeed(42);
  _resetUidCounter();
  vi.clearAllMocks();
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const enter = (service) => ({ type: 'enter', service });
const press = (label) => ({ type: 'press', label });
const confirm = (index = 0) => ({ type: 'confirm', index });
const reload = { type: 'reload' };
const leave = { type: 'leave' };

describe('Journey A1–A2: production lifecycle adapters', () => {
  it('an older saved mercenary board grants Dance before preview and hire, not only after reload', async () => {
    const d = new RunDriver(storage);
    const dancer = createRecruitUnit(
      { name: 'Legacy Dancer', level: 1 },
      d.data.classes.find((c) => c.name === 'Dancer'),
      d.data.weapons,
    );
    expect(dancer.skills).not.toContain('dance');
    d.node('arena').colosseumState = {
      fightsPerUnit: {},
      levelsGained: {},
      mercHired: false,
      mercCandidates: [{ unit: dancer, hireCost: 500 }],
    };
    // Historical-board input fixture only; actions below must save themselves.
    saveRun(d.run, null, 1);
    d.assertPersisted('legacy board fixture');
    await d.step(reload);
    await d.step(enter('arena'));
    expect(d.arena._mercCandidates[0].unit.skills).toContain('dance');
    await d.step(press('Mercenary board'));
    await d.step(press(/^Legacy Dancer ·/));
    await d.step(press('Confirm hire'));
    await d.step(reload);
    expect(d.run.roster.find((u) => u.name === 'Legacy Dancer').skills).toContain('dance');
  });
  it('buy → Back → buy → confirm → reload → sell → leave → reload', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('shop'));
    const before = journeySnapshot(d.run);
    await d.step(press(/^Buy ·/));
    await d.step({ type: 'back' });
    expect(journeySnapshot(d.run)).toEqual(before);
    await d.step(press(/^Buy ·/));
    // Give ordinary items to convoy; pool items have a one-choice confirm.
    await d.step(confirm(d.menu.child.options.choices.length - 1));
    expect(d.run.gold).toBeLessThan(before.gold);
    await d.step(reload);
    await d.step(enter('shop'));
    await d.step(press('Sell'));
    await d.step(press(/^Sell ·/));
    await d.step(confirm());
    await d.step(leave);
    await d.step(reload);
    expect(d.node('shop').completed).toBe(true);
    expect(d.run.currentNodeId).toBe('journey-shop');
  });
  it('forge completion preserves weapon bonuses, cost and visit counter through reload', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('shop'));
    await d.step(press('Forge'));
    await d.step(press('Choose forge'));
    await d.step(confirm());
    expect(d.scene.shopForgesUsed).toBe(1);
    await d.step(reload);
    await d.step(enter('shop'));
    expect(d.scene.shopForgesUsed).toBe(1);
  });
  it('church heal, promotion and revive use rendered callbacks and survive reopening', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('church'));
    await d.step(press('Heal all · Free'));
    expect(d.run.roster.every((u) => u.currentHP === u.stats.HP)).toBe(true);
    await d.step(press(/^Edric ·/));
    await d.step(confirm());
    expect(d.run.roster[0].tier).toBe('promoted');
    await d.step(press(/^Journey Fallen ·/));
    await d.step(confirm());
    expect(d.run.fallenUnits).toHaveLength(0);
    await d.step(reload);
    await d.step(enter('church'));
    await d.step(leave);
    await d.step(reload);
    expect(d.node('church').completed).toBe(true);
  });
  it('caravan open consumes pending reward; purchase/reload cannot reroll stock; leave ends visit', async () => {
    const d = new RunDriver(storage, { caravan: true });
    await d.step(enter('caravan'));
    expect(d.run.pendingCaravanShop).toBeNull();
    const original = structuredClone(d.run.activeCaravanShop);
    await d.step(reload);
    await d.step(enter('caravan'));
    expect(d.run.activeCaravanShop).toEqual(original);
    await d.step(press(/^Buy ·/));
    await d.step(confirm(d.menu.child.options.choices.length - 1));
    const remaining = structuredClone(d.run.activeCaravanShop);
    await d.step(reload);
    await d.step(enter('caravan'));
    expect(d.run.activeCaravanShop).toEqual(remaining);
    await d.step(leave);
    await d.step(reload);
    expect(d.run.getPendingCaravanShop()).toBeNull();
  });
  it('real arena fight is durable while its log is open, then hire and visit completion persist', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('church'));
    await d.step(press('Heal all · Free'));
    await d.step(leave);
    await d.step(enter('arena'));
    await d.step(press('Arena'));
    await d.step(press(/^Edric ·/));
    await d.step(press(/^Bronze ·/));
    const fighter = d.arena._selectedUnit.name;
    await d.step(press('Fight'));
    expect(d.arena._fightsPerUnit[fighter]).toBe(1);
    const oldArena = d.arena;
    await d.step(reload);
    await d.step(enter('arena'));
    expect(d.arena).not.toBe(oldArena);
    expect(d.arena._fightsPerUnit[fighter]).toBe(1);
    await d.step(press('Mercenary board'));
    const candidate = d.arena._mercCandidates[0].unit.name;
    const candidateButton = d.buttons().find((b) => b.textContent.startsWith(`${candidate} ·`));
    await d.step(press(candidateButton.textContent));
    await d.step(press('Confirm hire'));
    expect(d.arena._mercHired).toBe(true);
    await d.step(reload);
    await d.step(enter('arena'));
    expect(d.arena._mercHired).toBe(true);
    await d.step(leave);
    await d.step(reload);
    expect(d.node('arena').completed).toBe(true);
  });
  it('abandon invokes the real node-map callback and persists meta payout', async () => {
    const d = new RunDriver(storage);
    await d.step({ type: 'abandon' });
    expect(loadRun(d.data, 1)).toBeNull();
  });
  it('reload with an unconfirmed purchase neither buys nor saves or calls leave', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('shop'));
    await d.step(press(/^Buy ·/));
    const before = journeySnapshot(d.run);
    const writes = storage.writes;
    const leaveSpy = vi.spyOn(d.shop, 'leaveShopNode');
    await d.step(reload);
    expect(storage.writes).toBe(writes);
    expect(leaveSpy).not.toHaveBeenCalled();
    expect(journeySnapshot(d.run)).toEqual(before);
  });
  it.each(['shop', 'church', 'arena'])(
    '%s leave write failure retains previous durable oracle and warns',
    async (service) => {
      const d = new RunDriver(storage);
      await d.step(enter(service));
      const durable = structuredClone(d.lastDurable);
      storage.failWrites = true;
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await d.step(leave);
      expect(result.persistence).toBe('failed');
      expect(showMinorHint).toHaveBeenCalled();
      expect(d.lastDurable).toEqual(durable);
      storage.failWrites = false;
      await d.step(reload);
      expect(d.node(service).completed).toBe(false);
    },
  );
  it('root Back uses the production leave callback and permits the next service', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('shop'));
    await d.step({ type: 'back' });
    expect(d.service).toBeNull();
    await d.step(reload);
    expect(d.node('shop').completed).toBe(true);
    await d.step(enter('church'));
  });
  it('failed purchase save warns; successful leave retries durability without charging twice', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('shop'));
    await d.step(press(/^Buy ·/));
    const before = d.run.gold;
    storage.failWrites = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await d.step(confirm(d.menu.child.options.choices.length - 1));
    expect(result.persistence).toBe('failed');
    expect(d.menu.status).toContain('Save failed');
    const spent = before - d.run.gold;
    expect(spent).toBeGreaterThan(0);
    storage.failWrites = false;
    await d.step(leave);
    await d.step(reload);
    expect(d.run.gold).toBe(before - spent);
  });
  it('unchanged-value transactions and rejected duplicate callbacks cannot corrupt saves', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('shop'));
    await d.step(press(/^Buy ·/));
    const { apply, choices } = d.menu.child.options;
    const target = choices.at(-1);
    await d.step(confirm(choices.length - 1));
    const after = journeySnapshot(d.run);
    expect(apply(target).ok).toBe(false);
    expect(journeySnapshot(d.run)).toEqual(after);
    d.assertPersisted('duplicate purchase');
  });
});

describe('Calibration: known S1–S4 defect equivalents must be detected', () => {
  it('S1: missing abandon reward settlement', async () => {
    const d = new RunDriver(storage);
    vi.spyOn(d.run, 'settleEndRunRewards').mockImplementation(() => {});
    await expect(d.step({ type: 'abandon' })).rejects.toThrow('Journey abandon: totalValor');
  });
  it('S2: missing arena settlement persist', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('church'));
    await d.step(press('Heal all · Free'));
    await d.step(leave);
    await d.step(enter('arena'));
    await d.step(press('Arena'));
    await d.step(press(/^Edric ·/));
    await d.step(press(/^Bronze ·/));
    // Suppress only the save invoked by arena settlement, retaining the real
    // combat, visit-state capture and every other storage writer.
    vi.mocked(saveServiceRun).mockImplementationOnce(() => '');
    await expect(d.step(press('Fight'))).rejects.toThrow('Journey persistence:');
  });
  it.each(['shop', 'church', 'arena'])('S3: missing %s leave save', async (service) => {
    const d = new RunDriver(storage);
    await d.step(enter(service));
    if (service === 'shop') vi.spyOn(d.shop, '_persistVisit').mockImplementation(() => {});
    else if (service === 'arena') vi.spyOn(d.scene, 'persistRunSave').mockImplementation(() => {});
    else vi.mocked(saveServiceRun).mockImplementationOnce(() => '');
    await expect(d.step(leave)).rejects.toThrow('Journey persistence:');
  });
  it('S4: caravan open does not persist consumed reward/cached stock', async () => {
    const d = new RunDriver(storage, { caravan: true });
    vi.spyOn(d.shop, '_persistVisit').mockImplementation(() => {});
    await expect(d.step(enter('caravan'))).rejects.toThrow('Journey persistence:');
  });
  it('S4: resumed pending flag without cached stock is rejected even before reroll', async () => {
    const d = new RunDriver(storage, { caravan: true });
    const original = d.shop._saveShopState.bind(d.shop);
    vi.spyOn(d.shop, '_saveShopState').mockImplementation(() => {
      original();
      d.run.activeCaravanShop = null;
      d.run.pendingCaravanShop = { actId: d.run.currentAct };
    });
    // Serialization parity alone cannot detect a consistently wrong lifecycle.
    await expect(d.step(enter('caravan'))).rejects.toThrow('Journey caravan entry');
  });
  it('S4: cached stock does not excuse failing to consume the pending reward', async () => {
    const d = new RunDriver(storage, { caravan: true });
    const persist = d.shop._persistVisit.bind(d.shop);
    vi.spyOn(d.shop, '_persistVisit').mockImplementation(() => {
      d.run.pendingCaravanShop = { actId: d.run.currentAct };
      persist();
    });
    await expect(d.step(enter('caravan'))).rejects.toThrow('Journey caravan entry');
  });
  it('missing node completion fails even when the wrong live state is successfully saved', async () => {
    const d = new RunDriver(storage);
    await d.step(enter('church'));
    vi.spyOn(d.run, 'markNodeComplete').mockImplementation(() => {});
    await expect(d.step(leave)).rejects.toThrow('Journey leave: church completion');
  });
  it('independent resource fields catch compensating gold and item losses', () => {
    const d = new RunDriver(storage);
    const before = journeySnapshot(d.run);
    d.run.gold += 500;
    d.run.roster[0].inventory.pop();
    expect(() => assertJourneyEqual(before, journeySnapshot(d.run), 'calibration')).toThrow('gold');
  });
  it.each([
    [
      'gold',
      (d) => {
        d.run.gold++;
      },
    ],
    [
      'roster',
      (d) => {
        d.run.roster[0].xp++;
      },
    ],
    [
      'roster',
      (d) => {
        d.run.roster[0].inventory.pop();
      },
    ],
    [
      'fallenUnits',
      (d) => {
        d.run.fallenUnits.pop();
      },
    ],
    [
      'currentNodeId',
      (d) => {
        d.run.currentNodeId = 'journey-church';
      },
    ],
  ])('unsaved %s mutation cannot pass a persistence boundary', (field, mutate) => {
    const d = new RunDriver(storage);
    mutate(d);
    expect(() => d.assertPersisted('calibration')).toThrow(`${field} differs`);
  });
  it('node monotonicity is scoped to the same run/act', () => {
    const d = new RunDriver(storage);
    const before = journeySnapshot(d.run);
    before.nodes[0].completed = true;
    const after = journeySnapshot(d.run);
    expect(() => assertNodeMonotonic(before, after)).toThrow('became incomplete');
    after.identity[1]++;
    expect(() => assertNodeMonotonic(before, after)).not.toThrow();
  });
});
