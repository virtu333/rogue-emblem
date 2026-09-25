import { afterEach, describe, expect, it, vi } from 'vitest';
import { rollEnemyCount } from '../src/engine/MapGenerator.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
afterEach(() => vi.restoreAllMocks());
describe('Normal Act 1 recruitment relief', () => {
  it('lets additional recruits increase player strength without matching each with an enemy', () => {
    for (const roll of [0, 0.999]) {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      const count = (deployCount, act = 'act1', deployCountCap = 3) =>
        rollEnemyCount({
          deployCount,
          act,
          deployCountCap,
          row: 3,
          tiles: 80,
          densityCap: data.enemies.enemyCountByTiles,
        });
      expect(count(2)).toBe(2 + Math.floor(roll * 2));
      expect(count(3)).toBe(count(4));
      expect(count(4, 'act2')).toBe(count(3, 'act2') + 1);
      expect(count(4, 'act1', 0)).toBe(count(3, 'act1', 0) + 1);
    }
  });
  it('keeps the act-1 deploy cap for Normal only, while recruit nodes are elite everywhere', () => {
    // Recruit nodes are elite fights on every difficulty (docs/specs/strategy-layer.md):
    // one extra foe on Normal, two on Hard/Lunatic, plus one guaranteed affix.
    expect(data.difficulty.modes.normal.recruitEnemyCountBonus).toBe(1);
    expect(data.difficulty.modes.normal.recruitAffixCount).toBe(1);
    expect(data.difficulty.modes.normal.act1EnemyCountDeployCap).toBe(3);
    for (const id of ['hard', 'lunatic']) {
      expect(data.difficulty.modes[id].recruitEnemyCountBonus).toBe(2);
      expect(data.difficulty.modes[id].recruitAffixCount).toBe(1);
      expect(data.difficulty.modes[id].act1EnemyCountDeployCap).toBe(0);
    }
  });
});
