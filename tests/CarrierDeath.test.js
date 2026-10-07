// Spec 3G, owner question Q4: a carrier killed before it is robbed loses its item. Nothing
// drops, nothing is paid, nothing rises with it, so Steal is the only road to a carried
// item and a carrier is never a loot source of its own. Ways it can go wrong:
//   - the item drops to the ground, the convoy, a bag or the victory loot when its carrier
//     falls (the economy changes by what a foe carried, not by what a Thief took);
//   - the kill pays differently for a carrier than for the same foe with nothing;
//   - a Zombie that rises from a carrier carries the item, or one that is raised holds one;
//   - something in combat or the AI reads the item.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { buildRisenUnit, createRemains } from '../src/engine/ZombieRemains.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => restoreMathRandom());
const modifiers = (rung) => resolveDifficultyMode(data.difficulty, rung).modifiers;

function battle(seed, carryOn) {
  installSeed(seed);
  try {
    const b = new HeadlessBattle(data, {
      ...modifiers('lunatic'),
      carryConfig: carryOn ? modifiers('lunatic').carryConfig : null,
      difficultyId: 'lunatic',
      act: 'act3',
      objective: 'rout',
      battleSeed: 500 + seed,
      deployCount: 6,
    });
    b.init();
    return b;
  } finally {
    restoreMathRandom();
  }
}

/** A seed whose battle has a carrier; the same battle without the roll is its control. */
function pair() {
  for (let seed = 1; seed <= 60; seed++) {
    const withCarry = battle(seed, true);
    const carrier = withCarry.enemyUnits.find((e) => e.carriedItem);
    if (!carrier) continue;
    const without = battle(seed, false);
    const twin = without.enemyUnits.find((e) => e.col === carrier.col && e.row === carrier.row);
    return { withCarry, without, carrier, twin, uid: carrier.carriedItem.uid };
  }
  throw new Error('no battle with a carrier in 60 seeds');
}

const everywhere = (b) => [
  ...b.playerUnits.flatMap((u) => [...u.inventory, ...u.consumables, u.carriedItem]),
  ...b.enemyUnits.flatMap((u) => [...u.inventory, ...u.consumables, u.carriedItem]),
];

describe('a carrier that falls loses its item', () => {
  it('the item is gone, nobody gains it, and the battle pays what it paid with nothing carried', () => {
    const { withCarry, without, carrier, twin, uid } = pair();
    expect(twin, 'the same garrison without the roll').toBeTruthy();
    expect(twin.carriedItem).toBeUndefined();
    const killer = withCarry.playerUnits[0];
    const twinKiller = without.playerUnits[0];
    const bagsBefore = structuredClone(withCarry.playerUnits.map((u) => [u.inventory, u.consumables])); // prettier-ignore

    withCarry._removeUnit(carrier, { killer });
    without._removeUnit(twin, { killer: twinKiller });

    expect(withCarry.enemyUnits).not.toContain(carrier);
    expect(everywhere(withCarry).filter((i) => i?.uid === uid)).toEqual([]);
    expect(withCarry.playerUnits.map((u) => [u.inventory, u.consumables])).toEqual(bagsBefore);
    // The kill pays exactly what the same kill pays with nothing carried.
    expect(withCarry.goldEarned).toBe(without.goldEarned);
    expect(withCarry.goldEarned).toBeGreaterThan(0);
    expect(withCarry._zombieTombstones.length).toBe(without._zombieTombstones.length);
  });

  it('a Zombie that rises where a carrier fell holds nothing', () => {
    const { carrier } = pair();
    const record = createRemains(carrier, { col: carrier.col, row: carrier.row }, { seen: true });
    expect(JSON.stringify(record)).not.toContain(carrier.carriedItem.uid);
    const risen = buildRisenUnit(record, { col: carrier.col, row: carrier.row });
    expect(risen.carriedItem).toBeUndefined();
    expect(risen.consumables).toEqual([]);
    expect(risen._noXP).toBe(true);
  });

  it('nothing in combat, the AI, XP or loot reads a carried item', () => {
    const quiet = [
      'engine/AIController.js',
      'engine/Combat.js',
      'engine/SkillSystem.js',
      'engine/PostCombatEffects.js',
      'engine/BattleXp.js',
      'engine/LootSystem.js',
      'engine/PendingBattleRewards.js',
      'engine/ZombieRemains.js',
      'engine/Necromancy.js',
    ];
    for (const file of quiet) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      // Necromancy names it once, in the comment that keeps Skeletons empty-handed.
      const lines = source.split('\n').filter((l) => /carriedItem/.test(l) && !/^\s*(\/\/|\*)/.test(l)); // prettier-ignore
      expect(lines, file).toEqual([]);
    }
  });
});
