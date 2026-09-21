import { describe, it, expect, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { generateLootChoices } from '../src/engine/LootSystem.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import { forecastProjection, counterRisk } from '../src/ui/forecastDisplay.js';
const data = loadGameData();
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seeded(seed, fn) {
  const spy = vi.spyOn(Math, 'random').mockImplementation(rng(seed));
  try {
    return fn();
  } finally {
    spy.mockRestore();
  }
}
describe('playtester balance contracts', () => {
  it('200 Act 1 boss rolls have three distinct curated rewards, never basic supplies', () => {
    const seen = new Set();
    for (let seed = 1; seed <= 200; seed++)
      seeded(seed, () => {
        const choices = generateLootChoices(
          'act1',
          data.lootTables,
          data.weapons,
          data.consumables,
          3,
          0,
          data.accessories,
          data.whetstones,
          null,
          true,
        );
        expect(choices).toHaveLength(3);
        expect(new Set(choices.map((c) => c.item?.name))).toHaveLength(3);
        for (const c of choices) {
          expect(c.item).toBeTruthy();
          expect(c.item.name).not.toMatch(/Vulnerary|^Steel |Armorslayer/);
          seen.add(c.type);
        }
      });
    expect(seen.has('statBooster')).toBe(true);
    expect(seen.has('weapon')).toBe(true);
  });
  it('Normal Act 2 has no random Sunder weapons; Hard still can', () => {
    let hardSunder = 0;
    for (let seed = 1; seed <= 50; seed++)
      for (const difficultyId of ['normal', 'hard'])
        seeded(seed, () => {
          const c = generateBattle({ act: 'act2', objective: 'rout', difficultyId }, data);
          const n = c.enemySpawns.filter((u) => u.sunderWeapon).length;
          if (difficultyId === 'normal') expect(n).toBe(0);
          else hardSunder += n;
        });
    expect(hardSunder).toBeGreaterThan(0);
  });
});
describe('display projection against real resolution', () => {
  const weapon = {
    name: 'Plain sword',
    type: 'Sword',
    range: '1',
    might: 5,
    hit: 100,
    crit: 0,
    weight: 0,
    special: '',
  };
  const unit = (name, hp, spd) => ({
    name,
    className: 'Myrmidon',
    currentHP: hp,
    stats: { HP: hp, STR: 8, MAG: 0, SKL: 10, SPD: spd, DEF: 4, RES: 3, LCK: 20 },
    skills: [],
    weapon,
    weaponRank: 'Prof',
    faction: name === 'A' ? 'player' : 'enemy',
  });
  it('matches ordinary exchanges including lethal first hits and doubles without using RNG', () => {
    for (const hp of [1, 9, 20, 100])
      for (const aSpd of [1, 10, 20])
        for (const dSpd of [1, 10, 20]) {
          const a = unit('A', hp, aSpd),
            d = unit('D', hp, dSpd);
          const f = getCombatForecast(a, weapon, d, weapon, 1, null, null);
          const prediction = forecastProjection(f);
          const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
          let actual;
          try {
            actual = resolveCombat(a, weapon, d, weapon, 1, null, null);
          } finally {
            spy.mockRestore();
          }
          expect(prediction).toEqual({
            attackerHP: actual.attackerHP,
            defenderHP: actual.defenderHP,
          });
        }
  });
  it('omits unsupported effects and explains conditional counter risk', () => {
    const a = unit('A', 1, 10),
      d = unit('D', 20, 10);
    const f = getCombatForecast(a, weapon, d, weapon, 1, null, null, {
      defMods: { vantage: true },
    });
    expect(forecastProjection(f)).toBeNull();
    expect(counterRisk(f)).toContain('could defeat A');
  });
});

it('warns about a lethal multi-hit counter even if one strike is survivable', () => {
  expect(
    counterRisk({
      attacker: { name: 'Sera', hp: 10 },
      defender: { canCounter: true, hit: 85, crit: 0, damage: 6, attackCount: 2 },
    }),
  ).toContain('could defeat Sera');
});

it('uses post-art-cost HP for counter warnings and respects prevented counters', () => {
  const f = {
    attacker: { name: 'Edric', hp: 10 },
    defender: { canCounter: true, hit: 80, crit: 0, damage: 6, attackCount: 1 },
  };
  expect(counterRisk(f)).toBe('');
  expect(counterRisk(f, 5)).toContain('could defeat Edric');
  expect(counterRisk(f, 7)).toBe('');
  expect(counterRisk({ ...f, defender: { ...f.defender, canCounter: false } }, 5)).toBe('');
});
