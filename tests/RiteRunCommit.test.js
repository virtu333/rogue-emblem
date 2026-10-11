// The Rite in the run (docs/specs/act-v-descent.md §4, §9.5): RunManager creates it as the Descent
// opens, commits a battle's words only at its victory, saves it, and hands its tier to the
// battles it changes. Ways this breaks:
//   - the Rite starts at another value than the Eclipse's global phase says, exists off the
//     Descent, or survives into a run that never reached it
//   - a Vigil's words are committed twice (a second commit of the same node), from a battle
//     whose map has no vigil, or by a revert, a Continue from Map or a resume
//   - the Mortuary Column's par rule fires over par
//   - a save loses the Rite, or an old save loads one
//   - battle params outside the Descent gain Rite keys, or a boss of the route lacks its mods
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { generateSeededBattle, scoutBattle } from '../src/engine/BattleScout.js';

const baseData = loadGameData();
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});
const RITE = baseData.descent.rite;

function runIntoDescent(difficultyId = 'hard', { runSeed = 13, shadow = 0, eclipse = true } = {}) {
  const rm = new RunManager(descentData());
  rm.startRun({ runSeed, difficultyId, applyBlessingsAtStart: false, eclipseEnabled: eclipse });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.eclipse = { ...rm.eclipse, shadow };
  rm.advanceAct();
  return rm;
}
const nodeOf = (rm, key) => rm.nodeMap.nodes.find((n) => n.descentKey === key);
/** Lock the node's real map, as BattleScene does at entry. */
function lockMap(rm, node) {
  const params = rm.getBattleParams(node);
  const config = generateSeededBattle(params, rm.gameData, params.battleSeed);
  rm.lockBattleConfig(node.id, config);
  return config;
}

describe('the Rite begins with the Descent', () => {
  it('starts at the words the Eclipse’s global phase names', () => {
    for (const phase of baseData.eclipse.phases) {
      const rm = runIntoDescent('hard', { shadow: phase.min });
      expect(rm.rite, phase.id).toEqual({
        v: 1,
        words: RITE.startByPhase[phase.id],
        start: RITE.startByPhase[phase.id],
        log: [{ source: 'eclipse', delta: RITE.startByPhase[phase.id] }],
      });
    }
  });

  it('starts at 0 with the Eclipse off, whatever the meter says', () => {
    const rm = runIntoDescent('hard', { shadow: 100, eclipse: false });
    expect(rm.rite.words).toBe(0);
  });

  it('exists on no other act, and not on the old 2-node final act', () => {
    const rm = new RunManager(descentData());
    rm.startRun({ runSeed: 5, difficultyId: 'hard', applyBlessingsAtStart: false });
    expect(rm.rite).toBeNull();
    rm.advanceAct();
    expect(rm.rite).toBeNull();
    const old = new RunManager(baseData); // descent.json ships switched off
    old.startRun({ runSeed: 5, difficultyId: 'hard', applyBlessingsAtStart: false });
    old.actIndex = old.actSequence.indexOf('finalBoss') - 1;
    old.advanceAct();
    expect(old.nodeMap.descent).toBeUndefined();
    expect(old.rite).toBeNull();
  });
});

describe('a battle’s words commit at its victory, once', () => {
  it('the Vigil’s words join the Rite at the victory commit and a second commit adds nothing', () => {
    const rm = runIntoDescent('hard', { shadow: 50 });
    const start = rm.rite.words;
    const vigil = nodeOf(rm, 'vigil');
    expect(lockMap(rm, vigil).vigil).toBeTruthy();
    expect(rm.completeBattle(rm.getRoster(), vigil.id, 0, { riteWords: 9 })).toBe(true);
    expect(rm.rite.words).toBe(start + 9);
    expect(rm.rite.log.at(-1)).toEqual({ source: 'vigil', delta: 9, nodeId: vigil.id });
    // The node is done: the same victory again is refused before anything counts.
    expect(rm.completeBattle(rm.getRoster(), vigil.id, 0, { riteWords: 9 })).toBe(false);
    expect(rm.rite.words).toBe(start + 9);
  });

  it('a battle whose locked map has no vigil commits no words, whatever it is handed', () => {
    const rm = runIntoDescent();
    const stair = nodeOf(rm, 'stair');
    expect(lockMap(rm, stair).vigil).toBeUndefined();
    rm.completeBattle(rm.getRoster(), stair.id, 0, { riteWords: 6 });
    expect(rm.rite.words).toBe(0);
    expect(rm.rite.log).toHaveLength(1);
  });

  it('without a locked map (the headless sims) the node’s set piece decides', () => {
    const rm = runIntoDescent();
    rm.completeBattle(rm.getRoster(), nodeOf(rm, 'stair').id, 0, { riteWords: 6 });
    expect(rm.rite.words).toBe(0);
    rm.completeBattle(rm.getRoster(), nodeOf(rm, 'vigil').id, 0, { riteWords: 6 });
    expect(rm.rite.words).toBe(6);
  });

  it('the Mortuary Column lowers it won at or under par, never over', () => {
    const delta = RITE.underPar.column;
    const at = runIntoDescent('hard', { shadow: 75 });
    const words = at.rite.words;
    at.completeBattle(at.getRoster(), nodeOf(at, 'column').id, 0, { turnCount: 7, turnPar: 7 });
    expect(at.rite.words).toBe(words + delta);
    expect(at.rite.log.at(-1)).toEqual({
      source: 'battle',
      delta,
      nodeId: nodeOf(at, 'column').id,
    });
    const over = runIntoDescent('hard', { shadow: 75 });
    over.completeBattle(over.getRoster(), nodeOf(over, 'column').id, 0, {
      turnCount: 8,
      turnPar: 7,
    });
    expect(over.rite.words).toBe(words);
  });

  it('Continue from Map and a resume leave it as it was; only the victory commits', () => {
    const rm = runIntoDescent('hard', { shadow: 25 });
    const vigil = nodeOf(rm, 'vigil');
    lockMap(rm, vigil);
    const before = structuredClone(rm.rite);
    rm.beginBattleInProgress(vigil.id, { battleParams: rm.getBattleParams(vigil) });
    rm.setBattleCheckpoint({ version: 1, state: {} });
    // The save written mid-battle and loaded again (a refresh, a crash): the same Rite.
    const resumed = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), rm.gameData);
    expect(resumed.rite).toEqual(before);
    // Continue from Map: the battle goes back to its entry; the Rite never moved.
    expect(rm.revertBattleInProgressToEntry()).toBe(true);
    expect(rm.rite).toEqual(before);
    // Fought again and won: counted once.
    rm.completeBattle(rm.getRoster(), vigil.id, 0, { riteWords: 4 });
    expect(rm.rite.words).toBe(before.words + 4);
  });
});

describe('saved with the run', () => {
  it('round-trips, and an old save (or a broken record) reads no Rite', () => {
    const rm = runIntoDescent('hard', { shadow: 100 });
    rm.completeBattle(rm.getRoster(), nodeOf(rm, 'vigil').id, 0, { riteWords: 3 });
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    expect(RunManager.fromJSON(saved, rm.gameData).rite).toEqual(rm.rite);
    delete saved.rite;
    expect(RunManager.fromJSON(saved, rm.gameData).rite).toBeNull();
    saved.rite = { words: 'many' };
    expect(RunManager.fromJSON(saved, rm.gameData).rite).toBeNull();
  });
});

describe('battle params', () => {
  const RITE_KEYS = ['riteAtEntry', 'riteBand', 'riteLevel', 'riteMods'];

  it('a run without a Rite gains none of its keys', () => {
    const rm = new RunManager(descentData());
    rm.startRun({ runSeed: 5, difficultyId: 'hard', applyBlessingsAtStart: false });
    for (const node of rm.nodeMap.nodes.filter((n) => n.battleParams)) {
      const params = rm.getBattleParams(node);
      for (const key of RITE_KEYS) expect(params, `${node.id} ${key}`).not.toHaveProperty(key);
    }
  });

  it('every Descent battle reads the words and the level rule; only a boss gets mods', () => {
    const rm = runIntoDescent('hard', { shadow: 100 });
    rm.rite = { ...rm.rite, words: 20 };
    const stair = rm.getBattleParams(nodeOf(rm, 'stair'));
    expect(stair).toMatchObject({
      riteAtEntry: 20,
      riteBand: 'answered',
      riteLevel: { perWordLevel: RITE.perWordLevel, levelCap: RITE.levelCap },
    });
    expect(stair).not.toHaveProperty('riteMods');
    expect(rm.getBattleParams(nodeOf(rm, 'vigil'))).not.toHaveProperty('riteMods');
    expect(rm.getBattleParams(nodeOf(rm, 'gate')).riteMods).toMatchObject({
      band: 'answered',
      target: 'lieutenant',
      ...RITE.mods.answered.lieutenant,
    });
    expect(rm.getBattleParams(nodeOf(rm, 'entity')).riteMods).toMatchObject({
      band: 'answered',
      target: 'entity',
      ...RITE.mods.answered.entity,
    });
    // A Spoken rite changes nothing: no mods key at all.
    rm.rite = { ...rm.rite, words: 6 };
    expect(rm.getBattleParams(nodeOf(rm, 'entity'))).not.toHaveProperty('riteMods');
  });

  it('the route preview’s scout reads the tier (a Broken gate shows two fewer foes)', () => {
    const scouted = (words) => {
      const rm = runIntoDescent('hard', { shadow: 100 });
      expect(rm.addBlessingMidRun('seers_eye', { earned: true })).toBeTruthy();
      rm.rite = { ...rm.rite, words };
      return scoutBattle(rm, nodeOf(rm, 'gate'));
    };
    const spoken = scouted(6);
    const broken = scouted(2);
    expect(spoken.foes.length).toBeGreaterThan(3);
    expect(broken.foes.length).toBe(spoken.foes.length - RITE.mods.broken.lieutenant.escortDrop);
    expect(broken.foes.filter((f) => f.isBoss)).toEqual(spoken.foes.filter((f) => f.isBoss));
  });

  it('a Vigil’s locked map carries the Rite’s Hollowed level rule', () => {
    const rm = runIntoDescent();
    rm.gameData.descent.rite.perWordLevel = 3;
    rm.gameData.descent.rite.levelCap = 2;
    const config = lockMap(rm, nodeOf(rm, 'vigil'));
    expect(config.vigil).toMatchObject({ perWordLevel: 3, levelCap: 2 });
  });
});
