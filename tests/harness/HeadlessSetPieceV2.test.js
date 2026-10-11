// Set pieces v2 in the headless harness (act-v-descent §9.2, §9.4): a seize set piece whose
// seated boss falls before a lord takes the throne, a defeat set piece won on its last target
// with other foes standing, a target's Revival Stones, and an authored post that never walks.
// HeadlessBattle builds each from gameData.setPieces exactly as BattleScene does.
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { GameDriver } from './GameDriver.js';
import { checkInvariants } from './Invariants.js';
import { damageUnitDetailed } from '../../src/engine/UnitHealth.js';
import { DEFEAT_FIXTURE, GATE_FIXTURE, SEIZE_FIXTURE, withSetPieces } from '../setPieceFixtures.js';

const base = loadGameData();
const data = withSetPieces(base, SEIZE_FIXTURE, DEFEAT_FIXTURE, GATE_FIXTURE);
afterEach(() => restoreMathRandom());

function battle(seed, params) {
  installSeed(seed);
  const driver = new GameDriver(data, { difficultyId: 'normal', battleSeed: seed, ...params });
  driver.init();
  return driver;
}

const at = (u) => ({ col: u.col, row: u.row });

describe('a seize set piece in the harness', () => {
  it('the seated boss falls, then a lord takes the throne and seizes', async () => {
    for (const seed of [1, 2, 3, 4]) {
      const driver = battle(seed, {
        act: 'act1',
        objective: 'seize',
        setPiece: 'fixture_throne',
        isBoss: true,
        deployCount: 2,
        levelRange: [1, 2],
      });
      const b = driver.battle;
      const throne = b.battleConfig.thronePos;
      expect(throne, `seed ${seed}`).toBeTruthy();
      const boss = b.enemyUnits.find((u) => u.isBoss);
      expect(at(boss)).toEqual(throne);
      expect(base.enemies.bosses.act1.map((d) => d.name)).toContain(boss.name);
      const edric = b.playerUnits.find((u) => u.name === 'Edric');

      // The boss falls: a seize map does not end on the kill.
      b._removeUnit(boss, { killer: edric });
      expect(b._checkBattleEnd()).toBe(false);
      expect(b.result).toBeNull();

      await driver.step({ type: 'select_unit', payload: { unitName: 'Edric' } });
      await driver.step({ type: 'move_to', payload: throne });
      expect(b.getAvailableActions().map((a) => a.label)).toContain('Seize');
      await driver.step({ type: 'choose_action', payload: { label: 'Seize' } });
      expect(b.result).toBe('victory');
      // The named guard still stands: a seize never needed it.
      expect(b.enemyUnits.some((u) => u.name === 'Gate Guard')).toBe(true);
      expect(checkInvariants(driver)).toEqual([]);
    }
  });
});

describe('a defeat set piece in the harness', () => {
  const vigil = (seed) =>
    battle(seed, {
      act: 'act2',
      objective: 'rout',
      setPiece: 'fixture_vigil',
      deployCount: 2,
      levelRange: [1, 1],
    });

  it('is not won while a target stands, and is won when the last falls with guards standing', () => {
    for (const seed of [5, 6, 7]) {
      const driver = vigil(seed);
      const b = driver.battle;
      const edric = b.playerUnits.find((u) => u.name === 'Edric');
      const voiceA = b.enemyUnits.find((u) => u.authoredId === 'voice_a');
      const voiceB = b.enemyUnits.find((u) => u.authoredId === 'voice_b');
      expect(voiceA.name).toBe('Voice of the Calling');
      expect(voiceB.name).toBe('Voice of the Binding');
      expect(voiceA.isBoss).toBeFalsy();

      expect(b._checkBattleEnd()).toBe(false);
      b._removeUnit(voiceA, { killer: edric });
      expect(b._checkBattleEnd()).toBe(false);
      expect(b.result).toBeNull();
      b._removeUnit(voiceB, { killer: edric });
      expect(b.enemyUnits.length).toBeGreaterThan(0);
      expect(b._checkBattleEnd()).toBe(true);
      expect(b.result).toBe('victory');
      expect(checkInvariants(driver)).toEqual([]);
    }
  });

  it('the invariants refuse a defeat victory with a target standing', () => {
    const driver = vigil(5);
    driver.battle._onVictory();
    expect(checkInvariants(driver).join('\n')).toMatch(/objectives victory with targets standing/);
  });

  it('an authored post never walks; it strikes from its tile when a foe is in reach', async () => {
    const driver = vigil(8);
    const b = driver.battle;
    const post = b.enemyUnits.find((u) => u.authoredId === 'voice_a');
    const walker = b.enemyUnits.find((u) => u.authoredId === 'voice_b');
    const postTile = at(post);
    const walkerStart = at(walker);
    let walked = false;
    for (let turn = 0; turn < 3 && b.result === null; turn++) {
      await driver.step({ type: 'end_turn', payload: {} });
      if (b.enemyUnits.includes(post)) expect(at(post)).toEqual(postTile);
      if (b.enemyUnits.includes(walker)) walked ||= at(walker).col !== walkerStart.col || at(walker).row !== walkerStart.row; // prettier-ignore
    }
    // The other Voice, the same class with no post, does walk toward the army.
    expect(walked).toBe(true);
    // A lord two tiles away: the post strikes from where it stands.
    const fresh = vigil(8);
    const fb = fresh.battle;
    const voice = fb.enemyUnits.find((u) => u.authoredId === 'voice_a');
    const edric = fb.playerUnits.find((u) => u.name === 'Edric');
    edric.col = voice.col;
    edric.row = voice.row + 2;
    const decision = fb.aiController._decideAction(voice, fb.enemyUnits, fb.playerUnits, fb.npcUnits); // prettier-ignore
    expect(decision.target).toBe(edric);
    expect(decision.path).toBeNull();
  });
});

describe("a target's Revival Stones", () => {
  it('a broken bar is not a fall: the gate opens on the last bar only', () => {
    const driver = battle(11, {
      act: 'finalBoss',
      objective: 'rout',
      setPiece: 'fixture_gate',
      difficultyId: 'hard',
      isBoss: true,
      bossName: 'The Lieutenant',
      bossLevelBonus: 3,
      revivalStones: { actBoss: 0, emperor: 0, lieutenant: 1, eliteCaptain: 0 },
      deployCount: 2,
    });
    const b = driver.battle;
    const lieutenant = b.enemyUnits.find((u) => u.isBoss);
    expect(lieutenant).toMatchObject({ name: 'The Lieutenant', revivalStones: 1 });
    const full = lieutenant.stats.HP;

    const first = damageUnitDetailed(lieutenant, 999);
    expect(first.stoneBroken).toBe(true);
    expect(lieutenant.currentHP).toBe(full);
    expect(b._checkBattleEnd()).toBe(false);
    expect(b.result).toBeNull();

    const last = damageUnitDetailed(lieutenant, 999);
    expect(last.stoneBroken).toBe(false);
    expect(lieutenant.currentHP).toBe(0);
    b._removeUnit(lieutenant, { killer: b.playerUnits[0] });
    // The Sage still stands: the rest need not fall.
    expect(b.enemyUnits.length).toBeGreaterThan(0);
    expect(b._checkBattleEnd()).toBe(true);
    expect(b.result).toBe('victory');
    expect(checkInvariants(driver)).toEqual([]);
  });
});
