// iOS save audit (d): WebKit allows ~5 MB of localStorage per origin and a
// suspended battle carries up to ~0.5 MB of optional rewind history, so three
// slots with suspended battles can fill it. A save that hits the quota now
// sheds the *other* slots' optional history in stages and retries, instead of
// failing; their battles still resume from their checkpoints.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { shedOptionalHistory } from '../src/engine/BattleTimelinePersistence.js';
import { setItemFreeingSpace, shedOtherSlotsHistory } from '../src/engine/SaveSpace.js';
import { RunManager, saveRun, loadRun } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { getRunKey, getMetaKey } from '../src/engine/SlotManager.js';

class QuotaStorage {
  constructor(limit) {
    this.limit = limit;
    this.map = new Map();
  }
  used(except = null) {
    let total = 0;
    for (const [k, v] of this.map) if (k !== except) total += k.length + v.length;
    return total;
  }
  get length() {
    return this.map.size;
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    v = String(v);
    if (this.used(k) + k.length + v.length > this.limit) {
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.map.set(k, v);
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

let journeyStorage;
beforeEach(() => {
  journeyStorage = new JourneyStorage();
  vi.stubGlobal('localStorage', journeyStorage);
  installSeed(42);
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A real run save with a suspended battle and a recorded timeline. */
function suspendedBattleSave() {
  const driver = new RunDriver(journeyStorage, { seed: 42 });
  const run = driver.run;
  run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(run, driver.data);
  scene.playerUnits = structuredClone(run.roster.slice(0, 2));
  scene.playerUnits.forEach((unit, index) => {
    Object.assign(unit, { col: 1, row: index + 1, faction: 'player', isCommander: index === 0 });
    scene.addUnitGraphic(unit);
  });
  scene._battleCommanderId = scene.playerUnits[0].battleEntityId;
  scene.grid.fogEnabled = false;
  scene._visionController = new VisionRewindController(scene, run);
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint()).toBe(true);
  for (let turn = 2; turn <= 4; turn++) {
    for (let hp = 1; hp <= 3; hp++) {
      scene.playerUnits[0].currentHP = 20 - turn - hp;
      scene._timelineFacts = [`HP ${hp}`];
      scene._captureSuspendCheckpoint();
    }
    scene.turnManager.turnNumber = turn;
    scene._timelineBoundary = 'turn_start';
    scene._captureSuspendCheckpoint();
  }
  const saved = JSON.parse(JSON.stringify({ ...run.toJSON(), savedAt: 1000 }));
  expect(saved.battleInProgress.timeline.entries.length).toBeGreaterThan(5);
  expect(saved.battleInProgress.timeline.presentation).toBeTruthy();
  return { saved, gameData: driver.data };
}

describe('shedOptionalHistory', () => {
  it('sheds frames, then earlier turns, then the timeline — never the checkpoint', () => {
    const { saved } = suspendedBattleSave();
    const checkpoint = JSON.stringify(saved.battleInProgress.checkpoint);
    const one = shedOptionalHistory(saved, 1);
    expect(one.battleInProgress.timeline.presentation).toBeNull();
    expect(one.battleInProgress.timeline.entries).toEqual(saved.battleInProgress.timeline.entries);
    expect(shedOptionalHistory(one, 1)).toBeNull(); // nothing left at this stage
    const two = shedOptionalHistory(one, 2);
    const turns = new Set(two.battleInProgress.timeline.entries.map((e) => e.turnNumber));
    expect([...turns]).toEqual([two.battleInProgress.timeline.currentTurn]);
    const three = shedOptionalHistory(two, 3);
    expect(three.battleInProgress.timeline.entries).toEqual([]);
    expect(three.battleInProgress.timelineCurrentEntryId).toBeNull();
    for (const stage of [one, two, three]) {
      expect(JSON.stringify(stage.battleInProgress.checkpoint)).toBe(checkpoint);
      expect(stage.savedAt).toBe(saved.savedAt);
      expect(stage.gold).toBe(saved.gold);
      expect(stage.roster).toEqual(saved.roster);
    }
    expect(JSON.stringify(three).length).toBeLessThan(JSON.stringify(saved).length);
  });

  it('leaves saves without battle history alone', () => {
    expect(shedOptionalHistory({ gold: 5, battleInProgress: null }, 1)).toBeNull();
    expect(shedOptionalHistory(null, 2)).toBeNull();
  });
});

describe('a save that hits the quota makes room in the other slots', () => {
  it('saveRun succeeds by shedding another slot’s history; that battle still resumes', () => {
    const { saved, gameData } = suspendedBattleSave();
    const other = JSON.stringify(saved);
    const rm = new RunManager(gameData);
    rm.startRun();
    const mine = JSON.stringify({ ...rm.toJSON(), savedAt: 1 });
    // Room for the other slot's full save plus most, not all, of this one.
    const storage = new QuotaStorage(
      getRunKey(2).length + other.length + getRunKey(1).length + mine.length - 2000,
    );
    storage.setItem(getRunKey(2), other);
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(saveRun(rm, null, 1)).toEqual({ ok: true });
    expect(JSON.parse(storage.getItem(getRunKey(1))).roster).toEqual(
      JSON.parse(JSON.stringify(rm.toJSON().roster)),
    );
    const shrunk = JSON.parse(storage.getItem(getRunKey(2)));
    expect(shrunk.battleInProgress.timeline.presentation).toBeNull();
    expect(shrunk.battleInProgress.checkpoint).toEqual(saved.battleInProgress.checkpoint);
    const resumed = loadRun(gameData, 2);
    expect(resumed.battleInProgress.checkpoint).toBeTruthy();
  });

  it('still reports quota when nothing optional is left to shed', () => {
    const rm = new RunManager(new RunDriver(journeyStorage, { seed: 42 }).data);
    rm.startRun();
    const storage = new QuotaStorage(500);
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(saveRun(rm, null, 1)).toMatchObject({ ok: false, reason: 'quota', isQuotaError: true });
  });

  it('never sheds the slot being written', () => {
    const { saved } = suspendedBattleSave();
    const storage = new QuotaStorage(10_000_000);
    storage.setItem(getRunKey(1), JSON.stringify(saved));
    expect(shedOtherSlotsHistory(1, 1, storage)).toBe(false);
    expect(
      JSON.parse(storage.getItem(getRunKey(1))).battleInProgress.timeline.presentation,
    ).toBeTruthy();
  });

  it('a meta save on a full store also makes room', () => {
    const { saved, gameData } = suspendedBattleSave();
    const other = JSON.stringify(saved);
    // Measure this meta save, then leave slightly less room than it needs.
    const probe = new QuotaStorage(10_000_000);
    vi.stubGlobal('localStorage', probe);
    new MetaProgressionManager(gameData.metaUpgrades, getMetaKey(1))._save();
    const metaSize = getMetaKey(1).length + probe.getItem(getMetaKey(1)).length;
    const storage = new QuotaStorage(getRunKey(3).length + other.length + metaSize - 50);
    storage.setItem(getRunKey(3), other);
    vi.stubGlobal('localStorage', storage);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const meta = new MetaProgressionManager(gameData.metaUpgrades, getMetaKey(1));
    expect(meta._save().ok).toBe(true);
    expect(storage.getItem(getMetaKey(1))).toBeTruthy();
    expect(
      JSON.parse(storage.getItem(getRunKey(3))).battleInProgress.timeline.presentation,
    ).toBeNull();
  });

  it('non-quota errors are not swallowed', () => {
    const storage = {
      setItem() {
        throw new Error('SecurityError: access denied');
      },
    };
    expect(() => setItemFreeingSpace('k', 'v', 1, storage)).toThrow('access denied');
  });
});
