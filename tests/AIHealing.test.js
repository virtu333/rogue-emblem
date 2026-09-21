import { afterEach, expect, it, vi } from 'vitest';
import { AIController } from '../src/engine/AIController.js';
import { createEnemyUnit } from '../src/engine/UnitManager.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const staff = structuredClone(data.weapons.find((w) => w.name === 'Heal'));
  const healer = {
    name: 'Healer',
    faction: 'enemy',
    col: 1,
    row: 1,
    mov: 2,
    moveType: 'Infantry',
    aiMode: 'heal',
    currentHP: 20,
    stats: { HP: 20, MAG: 5 },
    weapon: staff,
    inventory: [staff],
    proficiencies: [{ type: 'Staff', rank: 'Prof' }],
  };
  const ally = { name: 'Ally', faction: 'enemy', col: 2, row: 1, currentHP: 5, stats: { HP: 20 } };
  const player = {
    name: 'Player',
    faction: 'player',
    col: 1,
    row: 2,
    currentHP: 20,
    stats: { HP: 20 },
  };
  const ai = new AIController({ getMovementRange: () => new Map() }, data);
  ai._delay = async () => {};
  return { ai, healer, ally, player, staff };
}
it('heals a wounded ally before attacking and spends exactly one finite staff use', async () => {
  const { ai, healer, ally, player, staff } = fixture();
  const heal = vi.fn(),
    attack = vi.fn(),
    done = vi.fn();
  await ai._processOneEnemy(healer, [healer, ally], [player], [], {
    onHeal: heal,
    onAttack: attack,
    onUnitDone: done,
  });
  expect(ally.currentHP).toBe(15);
  expect(staff._usesSpent).toBe(1);
  expect(heal).toHaveBeenCalledTimes(1);
  expect(attack).not.toHaveBeenCalled();
  expect(done).toHaveBeenCalledTimes(1);
});
it('does not heal while silenced, exhausted, out of range, or superseded', async () => {
  const { ai, healer, ally, player, staff } = fixture();
  healer._conditions = [{ id: 'silence', turnsRemaining: 2 }];
  expect(ai.applyHealDecision(healer, ally, staff)).toBeNull();
  healer._conditions = [];
  staff._usesSpent = 99;
  expect(ai.applyHealDecision(healer, ally, staff)).toBeNull();
  staff._usesSpent = 0;
  ally.col = 8;
  expect(ai.applyHealDecision(healer, ally, staff)).toBeNull();
  ally.col = 2;
  await ai._processOneEnemy(healer, [healer, ally], [player], [], {
    isCurrent: () => false,
    onUnitDone: vi.fn(),
  });
  expect(ally.currentHP).toBe(5);
  expect(staff._usesSpent).toBe(0);
});
it('seeded generated Act2+ healers are capped at one and have usable healing staves', () => {
  let found = 0;
  for (let seed = 1; seed <= 60; seed++) {
    vi.spyOn(Math, 'random').mockImplementation(createSeededRng(seed));
    const config = generateBattle({ act: 'act2', objective: 'rout', difficultyId: 'normal' }, data);
    const healers = config.enemySpawns.filter((s) => s.aiMode === 'heal');
    expect(healers.length).toBeLessThanOrEqual(1);
    for (const spawn of healers) {
      found++;
      const enemy = createEnemyUnit(
        data.classes.find((c) => c.name === spawn.className),
        spawn.level,
        data.weapons,
      );
      expect(enemy.weapon.type).toBe('Staff');
      expect(enemy.weapon.healBase).toBeGreaterThan(0);
    }
  }
  expect(found).toBeGreaterThan(0);
  expect(data.enemies.pools.act1.base).not.toContain('Cleric');
});

it('a sleeping enemy cannot move, attack or heal even when a healing target is available', async () => {
  const { ai, healer, ally, player, staff } = fixture();
  healer._conditions = [{ id: 'sleep', turnsRemaining: 2 }];
  const attack = vi.fn(),
    heal = vi.fn(),
    done = vi.fn();
  await ai._processOneEnemy(healer, [healer, ally], [player], [], {
    onAttack: attack,
    onHeal: heal,
    onUnitDone: done,
  });
  expect(attack).not.toHaveBeenCalled();
  expect(heal).not.toHaveBeenCalled();
  expect(done).toHaveBeenCalledOnce();
  expect(ai.applyHealDecision(healer, ally, staff)).toBeNull();
  expect(ally.currentHP).toBe(5);
});
