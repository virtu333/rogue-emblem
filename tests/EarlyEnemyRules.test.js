import { describe, it, expect } from 'vitest';
import { restrictOpeningCavaliers } from '../src/engine/EarlyEnemyRules.js';
import { RunManager } from '../src/engine/RunManager.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
describe('Normal opening cavalry protection', () => {
  it('counts joined and fallen units rather than deployed units', () => {
    const run = { currentAct: 'act1', difficultyId: 'normal', roster: [{}, {}], fallenUnits: [] };
    expect(restrictOpeningCavaliers(run)).toBe(true);
    run.fallenUnits.push({});
    expect(restrictOpeningCavaliers(run)).toBe(false);
    for (const difficultyId of ['hard', 'lunatic'])
      expect(restrictOpeningCavaliers({ ...run, roster: [], fallenUnits: [], difficultyId })).toBe(
        false,
      );
    expect(
      restrictOpeningCavaliers({ ...run, currentAct: 'act2', roster: [], fallenUnits: [] }),
    ).toBe(false);
  });
  it('persists party history and leaves canonical encounter params unchanged', () => {
    const rm = new RunManager(data);
    rm.startRun({ difficultyId: 'normal' });
    rm.completedBattles = 1;
    const node = rm.nodeMap.nodes.find((n) => n.battleParams);
    expect(rm.getBattleParams(node).excludeOpeningCavaliers).toBe(true);
    expect(node.battleParams.excludeOpeningCavaliers).toBeUndefined();
    rm.fallenUnits.push(structuredClone(rm.roster[1]));
    const restored = RunManager.fromJSON(rm.toJSON(), data);
    expect(restored.getBattleParams(node).excludeOpeningCavaliers).toBe(false);
  });
  it('filters both regular enemies and boss choices over generated maps', () => {
    const params = {
      act: 'act1',
      objective: 'seize',
      row: 7,
      isBoss: true,
      deployCount: 2,
      difficultyId: 'normal',
      excludeOpeningCavaliers: true,
    };
    for (let i = 0; i < 12; i++) {
      const battle = generateBattle(params, data);
      expect(battle.enemySpawns.length).toBeGreaterThan(0);
      expect(battle.enemySpawns.some((u) => u.className === 'Cavalier')).toBe(false);
      expect(battle.enemySpawns.some((u) => u.isBoss)).toBe(true);
    }
  });
});
