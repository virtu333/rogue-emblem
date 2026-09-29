// Zombie remains in the headless battle (shared rules: engine/ZombieRemains.js).
// The harness keeps the records, ticks them at each enemy-phase start, raises them,
// blocks a Rout on them and offers Smash, like BattleScene. Ways this breaks:
//   - the last zombie of a Rout ends the battle while it can still rise
//   - Smash is missing, draws RNG, or does not win the Rout it finishes
//   - the rise comes a phase early or late
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameDriver } from './GameDriver.js';
import { HEADLESS_STATES } from './HeadlessBattle.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { createEnemyUnit } from '../../src/engine/UnitManager.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

const data = loadGameData();

afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

// A Rout with its enemies cleared and one Zombie standing next to Edric.
function routWithZombie(seed = 11) {
  installSeed(seed);
  const driver = new GameDriver(data, { act: 'act2', objective: 'rout', battleSeed: seed });
  driver.init();
  const b = driver.battle;
  b.battleConfig.reinforcements = null;
  const edric = b.playerUnits.find((u) => u.name === 'Edric');
  b.playerUnits.splice(0, b.playerUnits.length, edric);
  const zombie = createEnemyUnit(
    data.classes.find((c) => c.name === 'Zombie'),
    3,
    data.weapons,
    1,
    data.skills,
    'act2',
  );
  const open = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]
    .map(([dc, dr]) => ({ col: edric.col + dc, row: edric.row + dr }))
    .find(
      ({ col, row }) =>
        col >= 0 &&
        row >= 0 &&
        col < b.battleConfig.cols &&
        row < b.battleConfig.rows &&
        !b.getUnitAt(col, row) &&
        b.grid.getTerrainAt(col, row)?.moveCost?.Infantry !== '--',
    );
  Object.assign(zombie, open);
  b.enemyUnits.splice(0, b.enemyUnits.length, zombie);
  return { driver, b, edric, zombie };
}

describe('HeadlessBattle: Zombie remains', () => {
  it('the last Zombie of a Rout leaves remains; Smash (no RNG) wins the battle', () => {
    const { b, edric, zombie } = routWithZombie();
    b._removeUnit(zombie, { killer: edric });
    expect(b._zombieTombstones).toHaveLength(1);
    expect(b._checkBattleEnd()).toBe(false);
    expect(b.result).toBeNull();

    b.selectUnit('Edric');
    b.moveTo(edric.col, edric.row);
    expect(b.getAvailableActions().map((a) => a.label)).toContain('Smash');
    const random = vi.spyOn(Math, 'random');
    b.chooseAction('Smash');
    expect(b.battleState).toBe(HEADLESS_STATES.SELECTING_REMAINS_TARGET);
    b.chooseRemainsTarget(zombie.col, zombie.row);
    expect(random).not.toHaveBeenCalled();
    expect(b._zombieTombstones).toEqual([]);
    expect(b.result).toBe('victory');
  });

  it('left alone, the remains rise at the third enemy-phase start after a player-phase kill', async () => {
    const { driver, b, edric, zombie } = routWithZombie(23);
    b._removeUnit(zombie, { killer: edric });
    const tile = { col: zombie.col, row: zombie.row };
    // The board right after each enemy-phase start's rising step (the risen zombie
    // may then attack Edric and fall to his counter).
    const afterRise = [];
    const rise = b._processZombieRevival.bind(b);
    b._processZombieRevival = () => {
      rise();
      afterRise.push(b.enemyUnits.map((u) => ({ ...u })));
    };
    const phasesUntilRise = [];
    for (let turn = 1; turn <= 3; turn++) {
      phasesUntilRise.push(b._zombieTombstones[0]?.turnsRemaining ?? null);
      await driver.step({ type: 'end_turn', payload: {} });
    }
    expect(phasesUntilRise).toEqual([3, 2, 1]);
    expect(b._zombieTombstones).toEqual([]);
    expect(afterRise.map((units) => units.length)).toEqual([0, 0, 1]);
    const risen = afterRise[2][0];
    expect(risen).toMatchObject({ className: 'Zombie', _revived: true, _noXP: true });
    expect(risen.currentHP).toBe(Math.max(1, Math.floor(zombie.stats.HP / 2)));
    expect({ col: risen.col, row: risen.row }).toEqual(tile);
  });

  it('the scripted policy walks to the remains and smashes them', async () => {
    const { driver, b, edric, zombie } = routWithZombie(31);
    b._removeUnit(zombie, { killer: edric });
    const agent = new ScriptedAgent(driver);
    let steps = 0;
    while (b.battleState !== HEADLESS_STATES.BATTLE_END && steps < 50) {
      const action = agent.chooseAction(driver.listLegalActions());
      await driver.step(action);
      steps++;
    }
    expect(b.result).toBe('victory');
    expect(b.enemyUnits).toHaveLength(0);
    expect(b._zombieTombstones).toEqual([]);
  });
});
