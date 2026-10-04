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

describe('a difficulty base is a floor, never a replacement', () => {
  const modes = data.difficulty.modes;
  const count = (id, deployCount, act = 'act4') =>
    rollEnemyCount({
      deployCount,
      act,
      deployCountCap: modes[id].act1EnemyCountDeployCap,
      row: 3,
      tiles: 400, // a big map: the density cap stays out of the way
      densityCap: data.enemies.enemyCountByTiles,
      enemyCountBonus: modes[id].enemyCountBonus,
      enemyCountBase: modes[id].enemyCountBase,
    });

  it('a small army meets at least the base; a big one meets its own size', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // Nightfall: base 4. Two units meet the base; eight meet eight.
    expect(count('hard', 8) - count('hard', 2)).toBe(8 - 4);
  });

  it("Nightfall's floor is exactly 4: armies up to four meet the same force, a fifth adds one", () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    // max(4, deploy) for deploy 1..4 is 4; deploy 5 is 5, so the count steps up by one.
    expect(count('hard', 1)).toBe(count('hard', 4));
    expect(count('hard', 3)).toBe(count('hard', 4));
    expect(count('hard', 5) - count('hard', 4)).toBe(1);
    expect(modes.hard.enemyCountBase).toBe(4);
  });

  it('the rungs never invert: harder is never fewer, whatever the army size', () => {
    for (const roll of [0, 0.5, 0.999]) {
      vi.spyOn(Math, 'random').mockReturnValue(roll);
      for (let deploy = 1; deploy <= 12; deploy++)
        for (const act of ['act2', 'act3', 'act4']) {
          const ladder = ['normal', 'dusk', 'hard', 'lunatic'].map((id) => count(id, deploy, act));
          for (let i = 1; i < ladder.length; i++)
            expect(ladder[i], `deploy ${deploy} ${act} ${ladder}`).toBeGreaterThanOrEqual(
              ladder[i - 1],
            );
        }
      vi.restoreAllMocks();
    }
  });
});
