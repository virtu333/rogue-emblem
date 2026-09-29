// The boss recruit draft is rolled once, at the victory save, and must survive a
// reload before the player chooses: the same candidates, never a re-roll.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { RunManager, loadRun } from '../src/engine/RunManager.js';
import { prepareBattleRewards } from '../src/engine/PendingBattleRewards.js';
import { prepareBossRecruit, resolveBossRecruit } from '../src/engine/PendingBossRecruit.js';
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

// A run that just won its act boss: rewards prepared, recruit draft rolled.
function bossVictory() {
  const run = new RunManager(gameData);
  run.startRun({ runSeed: 11, difficultyId: 'normal' });
  prepareBattleRewards(run, gameData, { isBoss: true, goldEarned: 100, completionGoldAward: 100 });
  const candidates = prepareBossRecruit(run, gameData);
  const scene = {
    gameData,
    runManager: run,
    registry: { get: (k) => (k === 'activeSlot' ? 1 : null) },
  };
  return { run, candidates, scene };
}

const face = (candidate) => ({
  name: candidate.unit.name,
  className: candidate.unit.className,
  level: candidate.unit.level,
  stats: candidate.unit.stats,
  skills: candidate.unit.skills,
  portraitVariant: candidate.unit.portraitVariant,
  weapons: candidate.unit.inventory.map((w) => w.name),
  isLord: candidate.isLord,
});

describe('pending boss recruit', () => {
  it('rolls a draft that a save and load bring back unchanged', () => {
    const { candidates, scene } = bossVictory();
    expect(candidates.length).toBeGreaterThan(0);
    const offered = candidates.map(face);
    expect(saveServiceRun(scene)).toBe('');

    const resumed = loadRun(gameData, 1);
    expect(resumed.pendingBossRecruit.candidates.map(face)).toEqual(offered);
    expect(resumed.pendingBossRecruit.actId).toBe('act1');
  });

  it('the resumed draft is not rolled again, however often it is asked for', () => {
    const { scene } = bossVictory();
    saveServiceRun(scene);
    const resumed = loadRun(gameData, 1);
    const offered = resumed.pendingBossRecruit.candidates.map(face);

    const random = vi.spyOn(Math, 'random');
    for (let i = 0; i < 3; i++)
      expect(prepareBossRecruit(resumed, gameData).map(face)).toEqual(offered);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
  });

  it('survives a second save and load (a reload while still undecided)', () => {
    const { candidates, scene } = bossVictory();
    const offered = candidates.map(face);
    saveServiceRun(scene);
    const once = loadRun(gameData, 1);
    saveServiceRun({ ...scene, runManager: once });
    expect(loadRun(gameData, 1).pendingBossRecruit.candidates.map(face)).toEqual(offered);
  });

  it('choosing a candidate joins it and clears the draft, on disk too', () => {
    const { scene } = bossVictory();
    saveServiceRun(scene);
    const resumed = loadRun(gameData, 1);
    const pick = resumed.pendingBossRecruit.candidates[0].unit;
    const rosterBefore = resumed.roster.length;

    resolveBossRecruit(resumed, pick);
    expect(resumed.pendingBossRecruit).toBeNull();
    expect(resumed.roster).toHaveLength(rosterBefore + 1);
    expect(resumed.roster.at(-1).name).toBe(pick.name);
    saveServiceRun({ ...scene, runManager: resumed });

    const again = loadRun(gameData, 1);
    expect(again.pendingBossRecruit).toBeNull();
    expect(again.roster.map((u) => u.name)).toContain(pick.name);
    expect(again.pendingBattleReward).toBeTruthy(); // the rewards are still owed
  });

  it('skipping clears the draft without joining anyone', () => {
    const { scene } = bossVictory();
    saveServiceRun(scene);
    const resumed = loadRun(gameData, 1);
    const rosterBefore = resumed.roster.map((u) => u.name);

    resolveBossRecruit(resumed, null);
    expect(resumed.pendingBossRecruit).toBeNull();
    saveServiceRun({ ...scene, runManager: resumed });

    const again = loadRun(gameData, 1);
    expect(again.pendingBossRecruit).toBeNull();
    expect(again.roster.map((u) => u.name)).toEqual(rosterBefore);
  });

  it('a save from before the field existed loads with no draft', () => {
    const { run } = bossVictory();
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.pendingBossRecruit;
    expect(RunManager.fromJSON(saved, gameData).pendingBossRecruit).toBeNull();
  });

  it('a stale draft is dropped: no reward pending, or another act', () => {
    const { run } = bossVictory();
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    expect(RunManager.fromJSON(saved, gameData).pendingBossRecruit).toBeTruthy();

    const noReward = { ...saved, pendingBattleReward: null };
    expect(RunManager.fromJSON(noReward, gameData).pendingBossRecruit).toBeNull();

    const otherAct = structuredClone(saved);
    otherAct.pendingBossRecruit.actId = 'act3';
    expect(RunManager.fromJSON(otherAct, gameData).pendingBossRecruit).toBeNull();
  });

  it('offers nothing after the final boss', () => {
    const run = new RunManager(gameData);
    run.startRun({ runSeed: 11, difficultyId: 'normal' });
    run.actIndex = run.actSequence.indexOf('finalBoss');
    expect(run.currentAct).toBe('finalBoss');
    expect(prepareBossRecruit(run, gameData)).toBeNull();
    expect(run.pendingBossRecruit).toBeNull();
  });
});
