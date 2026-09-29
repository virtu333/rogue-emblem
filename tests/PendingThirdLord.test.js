// The Power of Friendship arrival is rolled once, when it falls due, and must
// survive a reload before the player chooses: the same cards, the same mode, the
// same rerolls spent. A reload must never re-roll it, hand back a spent reroll or
// lose the lord.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { prepareBattleRewards } from '../src/engine/PendingBattleRewards.js';
import {
  prepareThirdLord,
  rerollThirdLord,
  resolveThirdLordArrival,
} from '../src/engine/PendingThirdLord.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

beforeEach(() => {
  const storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

// A run that just won its third battle with the meta upgrade in `mode`.
function thirdVictory(mode = 'pick3_reroll', seed = 11) {
  const run = new RunManager(gameData);
  run.startRun({ runSeed: seed, difficultyId: 'normal' });
  run.metaEffects = { ...run.metaEffects, thirdLordMode: mode };
  run.completedBattles = 3;
  prepareBattleRewards(run, gameData, { isBoss: false, goldEarned: 100, completionGoldAward: 100 });
  const scene = {
    gameData,
    runManager: run,
    registry: { get: (k) => (k === 'activeSlot' ? 1 : null) },
  };
  return { run, scene };
}

const names = (draft) => draft.candidates.map((c) => c.unit.name);
const face = (c) => ({ name: c.unit.name, stats: c.unit.stats, variant: c.unit.portraitVariant });

describe('pending third lord', () => {
  it('a save and load bring back the same candidates, mode and rerolls', () => {
    const { run, scene } = thirdVictory();
    const draft = prepareThirdLord(run, gameData);
    expect(draft.candidates).toHaveLength(3);
    const offered = draft.candidates.map(face);
    expect(saveServiceRun(scene)).toBe('');

    const resumed = loadRun(gameData, 1);
    expect(resumed.pendingThirdLord.candidates.map(face)).toEqual(offered);
    expect(resumed.pendingThirdLord.mode).toBe('pick3_reroll');
    expect(resumed.pendingThirdLord.rerolled).toBe(false);
    expect(resumed.canRerollThirdLord()).toBe(true);
    expect(resumed.pendingThirdLord.candidates.every((c) => c.isLord)).toBe(true);
  });

  it('a resumed draft is not rolled again, however often it is asked for', () => {
    const { run, scene } = thirdVictory();
    prepareThirdLord(run, gameData);
    saveServiceRun(scene);
    const resumed = loadRun(gameData, 1);
    const offered = names(resumed.pendingThirdLord);
    const random = vi.spyOn(Math, 'random');
    for (let i = 0; i < 3; i++) expect(names(prepareThirdLord(resumed, gameData))).toEqual(offered);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('the roll is deterministic for a seed and differs after a reroll', () => {
    const a = prepareThirdLord(thirdVictory('pick3', 5).run, gameData);
    const b = prepareThirdLord(thirdVictory('pick3', 5).run, gameData);
    expect(names(a)).toEqual(names(b));
    const { run } = thirdVictory('pick3_reroll', 5);
    const first = names(prepareThirdLord(run, gameData));
    rerollThirdLord(run);
    expect(names(prepareThirdLord(run, gameData))).not.toEqual(first);
  });

  it('pick_all offers every lord and random offers one', () => {
    const all = prepareThirdLord(thirdVictory('pick_all').run, gameData);
    expect(all.candidates.length).toBeGreaterThan(3);
    expect(prepareThirdLord(thirdVictory('random').run, gameData).candidates).toHaveLength(1);
  });

  it('a reroll is spent for good: the new cards are saved and reloading cannot undo it', () => {
    const { run, scene } = thirdVictory();
    const before = names(prepareThirdLord(run, gameData));
    saveServiceRun(scene);
    rerollThirdLord(run);
    expect(run.canRerollThirdLord()).toBe(false);
    const after = prepareThirdLord(run, gameData);
    saveServiceRun(scene);

    const resumed = loadRun(gameData, 1);
    expect(resumed.canRerollThirdLord()).toBe(false);
    expect(resumed.pendingThirdLord.rerolled).toBe(true);
    expect(names(resumed.pendingThirdLord)).toEqual(names(after));
    expect(names(resumed.pendingThirdLord)).not.toEqual(before);
  });

  it('choosing joins the lord, clears the draft and it stays cleared on disk', () => {
    const { run, scene } = thirdVictory();
    prepareThirdLord(run, gameData);
    saveServiceRun(scene);
    const resumed = loadRun(gameData, 1);
    const pick = resumed.pendingThirdLord.candidates[1].unit;
    const rosterBefore = resumed.roster.length;

    resolveThirdLordArrival(resumed, pick);
    expect(resumed.pendingThirdLord).toBeNull();
    expect(resumed.thirdLordJoined).toBe(true);
    saveServiceRun({ ...scene, runManager: resumed });

    const again = loadRun(gameData, 1);
    expect(again.pendingThirdLord).toBeNull();
    expect(again.thirdLordJoined).toBe(true);
    expect(again.roster).toHaveLength(rosterBefore + 1);
    expect(again.roster.map((u) => u.name)).toContain(pick.name);
    expect(again.pendingBattleReward).toBeTruthy(); // the rewards are still owed
  });

  it('skipping clears the draft without joining anyone', () => {
    const { run, scene } = thirdVictory();
    prepareThirdLord(run, gameData);
    saveServiceRun(scene);
    const resumed = loadRun(gameData, 1);
    const roster = resumed.roster.map((u) => u.name);
    resolveThirdLordArrival(resumed, null);
    saveServiceRun({ ...scene, runManager: resumed });
    const again = loadRun(gameData, 1);
    expect(again.pendingThirdLord).toBeNull();
    expect(again.roster.map((u) => u.name)).toEqual(roster);
  });

  it('a save from before the field existed loads with no draft', () => {
    const { run } = thirdVictory();
    prepareThirdLord(run, gameData);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.pendingThirdLord;
    expect(RunManager.fromJSON(saved, gameData).pendingThirdLord).toBeNull();
  });

  it('a stale draft is dropped: no reward, another act, already arrived, a lord already here', () => {
    const { run } = thirdVictory();
    prepareThirdLord(run, gameData);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    expect(RunManager.fromJSON(saved, gameData).pendingThirdLord).toBeTruthy();

    expect(
      RunManager.fromJSON({ ...saved, pendingBattleReward: null }, gameData).pendingThirdLord,
    ).toBeNull();
    expect(
      RunManager.fromJSON({ ...saved, thirdLordJoined: true }, gameData).pendingThirdLord,
    ).toBeNull();

    const otherAct = structuredClone(saved);
    otherAct.pendingThirdLord.actId = 'act3';
    expect(RunManager.fromJSON(otherAct, gameData).pendingThirdLord).toBeNull();

    const badMode = structuredClone(saved);
    badMode.pendingThirdLord.mode = 'bogus';
    expect(RunManager.fromJSON(badMode, gameData).pendingThirdLord).toBeNull();

    // Every candidate is already in the army (fallen): nothing left to offer.
    const taken = structuredClone(saved);
    taken.fallenUnits = [
      ...(taken.fallenUnits || []),
      ...taken.pendingThirdLord.candidates.map((c) => ({ ...c.unit })),
    ];
    expect(RunManager.fromJSON(taken, gameData).pendingThirdLord).toBeNull();
  });

  it('offers nothing when no lord is left to arrive', () => {
    const { run } = thirdVictory('pick_all');
    run.fallenUnits = gameData.lords.map((l) => ({ name: l.name, isLord: true, stats: {} }));
    expect(prepareThirdLord(run, gameData)).toBeNull();
    expect(run.pendingThirdLord).toBeNull();
  });
});
