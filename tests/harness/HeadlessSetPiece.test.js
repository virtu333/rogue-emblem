// The headless harness builds an event set piece's map from data/setPieces.json, as
// BattleScene does (docs/specs/event-set-pieces.md). HeadlessBattle once passed generateBattle an
// explicit table list with no `setPieces`, so a battle that named one threw "Unknown set piece".
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { GameDriver } from './GameDriver.js';
import { findSetPiece } from '../../src/engine/SetPieces.js';

const data = loadGameData();
afterEach(() => restoreMathRandom());

describe('HeadlessBattle generates a set piece battle', () => {
  for (const id of ['toll_house', 'toll_crossing']) {
    it(`${id}: the harness's own generation is the set piece's map`, () => {
      installSeed(5);
      const driver = new GameDriver(data, {
        act: 'act1',
        objective: 'rout',
        setPiece: id,
        deployCap: findSetPiece(data.setPieces, id).deploy.max,
        difficultyId: 'normal',
        deployCount: 4,
        levelRange: [2, 3],
        battleSeed: 77,
      });
      driver.init();
      expect(driver.battle.battleConfig.setPieceId).toBe(id);
      expect(driver.battle.enemyUnits.length).toBeGreaterThan(0);
    });
  }
});

describe('the Toll Crossing guards do not wait out a passive army', () => {
  // Its bridge guards hold as a pack (HoldActivation) that only wakes when threatened, hurt or
  // killed, so an army that waits at the bank was never attacked: the fight ran to the turn cap.
  // The pack carries a wake turn (setPieces.json `wake`): the enemy phase of turn 4 sends it.
  const crossing = (seed) => {
    const params = {
      act: 'act1',
      objective: 'rout',
      setPiece: 'toll_crossing',
      deployCap: 6,
      difficultyId: 'normal',
      deployCount: 4,
      levelRange: [2, 3],
      battleSeed: seed,
    };
    installSeed(seed);
    const driver = new GameDriver(data, params);
    driver.init();
    return driver;
  };

  it('holds through turn 3 with nobody near, and the whole pack hunts from turn 4', async () => {
    for (const seed of [3, 8, 21, 55]) {
      const driver = crossing(seed);
      const b = driver.battle;
      const pack = b.enemyUnits.filter((u) => u.aiMode === 'hold');
      expect(pack.length, `seed ${seed}: a hold pack`).toBeGreaterThanOrEqual(2);
      expect(pack.every((u) => u.holdWakeTurn === 4)).toBe(true);
      for (let turn = 1; turn <= 4; turn++) {
        if (b.result !== null) break;
        await driver.step({ type: 'end_turn', payload: {} });
        const asleep = pack.filter((u) => u.aiMode === 'hold' && b.enemyUnits.includes(u));
        if (turn < 4) {
          // Nothing woke them yet (the army never left the bank).
          expect(asleep.length, `seed ${seed} after turn ${turn}`).toBe(pack.length);
        } else {
          expect(asleep, `seed ${seed} after turn 4`).toEqual([]);
          expect(
            pack.filter((u) => b.enemyUnits.includes(u)).every((u) => u.holdWoke),
            `seed ${seed}`,
          ).toBe(true);
        }
      }
    }
  });
});
