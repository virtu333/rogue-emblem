// Enemies that carry an item for a Thief to steal (docs/specs/phase3.md 3G,
// engine/EnemyCarry.js, GoldPouch.js, EnemySpawnGear). Ways it can go wrong, one test each:
//   - the roll draws Math.random (a map or a battle changes when carriers are on);
//   - the same garrison does not give the same carriers (a resume or a rewind differs);
//   - the rates are not the table (per rung, per act, per slot), or a rung's max is ignored;
//   - a boss, the Entity, an authored spawn or a Skeleton carries;
//   - an act hands out an item it should not (Elixir before Act III, a Master Seal before IV);
//   - a Gold Pouch is worth the wrong gold, or sells for more than it spends;
//   - the flag does not become a whole item with a uid, or the unit's bag or the AI sees it;
//   - the harness or scene drops the carrier (EnemySpawnGear), or a raised Skeleton gets one;
//   - a saved run (no table) starts carrying, or bad data validates.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { generateBattle } from '../src/engine/MapGenerator.js';
import { resolveDifficultyMode, validateDifficultyConfig } from '../src/engine/DifficultyEngine.js';
import {
  assignEnemyCarry,
  buildCarriedItem,
  carriedItemUid,
  isCarrierEligible,
  validateCarryPools,
} from '../src/engine/EnemyCarry.js';
import { applyEnemySpawnGear } from '../src/engine/EnemySpawnGear.js';
import { goldPouchValue, makeGoldPouch } from '../src/engine/GoldPouch.js';
import { getSellPrice } from '../src/engine/LootSystem.js';
import { buildRaisedSkeleton } from '../src/engine/Necromancy.js';
import { RunManager } from '../src/engine/RunManager.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
});

const modifiers = (rung) => resolveDifficultyMode(data.difficulty, rung).modifiers;
const RUNGS = ['normal', 'dusk', 'hard', 'lunatic'];
const ACTS = ['act1', 'act2', 'act3', 'act4', 'finalBoss'];

// The spec's table (docs/specs/phase3.md 3G), written out by hand: [Act I, II, III, IV, max].
// The final boss takes Act IV's rate.
const TABLE = {
  normal: [0, 0.15, 0.2, 0.25, 1],
  dusk: [0.1, 0.25, 0.3, 0.35, 1],
  hard: [0.2, 0.35, 0.45, 0.5, 2],
  lunatic: [0.3, 0.45, 0.55, 0.6, 3],
};
const chanceOf = (rung, act) => TABLE[rung][act === 'finalBoss' ? 3 : Number(act.slice(3)) - 1];
const cfg = (chance, max = 1) => ({ perBattle: true, act1: chance, act2: chance, act3: chance, act4: chance, finalBoss: chance, maxPerBattle: max }); // prettier-ignore

/** A synthetic garrison of ordinary fighters at distinct tiles, one per seed. */
function garrison(seed, fighters = 6) {
  const spawns = [];
  for (let i = 0; i < fighters; i++)
    spawns.push({ className: 'Fighter', col: i + seed * 7, row: seed, level: 3 + (seed % 5) });
  return spawns;
}
const carriers = (spawns) => spawns.filter((s) => s.carries);
const roll = (spawns, act, rung, extra = {}) =>
  assignEnemyCarry(spawns, {
    act,
    difficultyId: rung,
    templateId: 'tpl',
    carryConfig: modifiers(rung).carryConfig,
    lootTables: data.lootTables,
    ...extra,
  });

describe('the rung table', () => {
  it('is the spec table, on every rung and act, validated like the caster gear', () => {
    for (const rung of RUNGS) {
      const c = modifiers(rung).carryConfig;
      expect(c.perBattle, rung).toBe(true);
      for (const act of ACTS) expect(c[act], `${rung} ${act}`).toBe(chanceOf(rung, act));
      expect(c.maxPerBattle, rung).toBe(TABLE[rung][4]);
    }
    expect(validateDifficultyConfig(data.difficulty).errors).toEqual([]);
  });

  it('rejects a rung with no table, a chance outside 0..1, or a bad max', () => {
    const bad = structuredClone(data.difficulty);
    bad.modes.normal.carryConfig = null;
    bad.modes.dusk.carryConfig.act2 = 1.5;
    bad.modes.hard.carryConfig.maxPerBattle = -1;
    bad.modes.lunatic.carryConfig.perBattle = false;
    delete bad.modes.lunatic.carryConfig.finalBoss;
    const errors = validateDifficultyConfig(bad).errors.join('\n');
    expect(errors).toMatch(/normal\.carryConfig must be an object/);
    expect(errors).toMatch(/dusk\.carryConfig\.act2/);
    expect(errors).toMatch(/hard\.carryConfig\.maxPerBattle/);
    expect(errors).toMatch(/lunatic\.carryConfig\.perBattle/);
    expect(errors).toMatch(/lunatic\.carryConfig\.finalBoss/);
  });

  it('is on a run through its modifiers, and a run saved without it carries nothing', () => {
    const run = new RunManager(data);
    run.applyDifficultySelection('lunatic');
    expect(run.difficultyModifiers.carryConfig).toEqual(modifiers('lunatic').carryConfig);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    delete saved.difficultyModifiers.carryConfig; // as a save from before this table holds it
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.difficultyModifiers.carryConfig).toBeNull();
    for (let seed = 1; seed <= 30; seed++) {
      const spawns = garrison(seed);
      assignEnemyCarry(spawns, { act: 'act4', difficultyId: 'lunatic', carryConfig: loaded.difficultyModifiers.carryConfig, lootTables: data.lootTables }); // prettier-ignore
      expect(carriers(spawns)).toEqual([]);
    }
  });
});

describe('the roll', () => {
  it('draws no Math.random, and gives the same carriers for the same garrison', () => {
    const draws = vi.spyOn(Math, 'random');
    const seen = [];
    for (let seed = 1; seed <= 200; seed++) {
      const a = garrison(seed);
      const b = garrison(seed);
      roll(a, 'act3', 'lunatic');
      roll(b, 'act3', 'lunatic');
      expect(b).toEqual(a);
      seen.push(carriers(a).length);
    }
    expect(draws).not.toHaveBeenCalled();
    expect(seen.some((n) => n > 0)).toBe(true); // not vacuous
  });

  it('is its own stream: another act, rung, template or garrison rolls differently', () => {
    const marks = (spawns) =>
      spawns.map((s) => (s.carries ? `${s.col}:${s.carries}` : '-')).join(',');
    const outcomes = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      for (const act of ['act2', 'act3']) {
        for (const templateId of ['a', 'b']) {
          const spawns = garrison(seed);
          roll(spawns, act, 'lunatic', { templateId });
          outcomes.add(`${seed}|${act}|${templateId}|${marks(spawns)}`);
        }
      }
    }
    // 240 draws land on many distinct results (a stream keyed on nothing would repeat one).
    expect(new Set([...outcomes].map((o) => o.split('|')[3])).size).toBeGreaterThan(20);
  });

  it('gives a battle with a carrier its share, per rung and act, by the table', () => {
    const N = 3000;
    for (const rung of RUNGS) {
      for (const act of ['act1', 'act2', 'act3', 'act4', 'finalBoss']) {
        const p = chanceOf(rung, act);
        const max = TABLE[rung][4];
        const counts = new Array(max + 1).fill(0);
        for (let seed = 0; seed < N; seed++) {
          const spawns = garrison(seed + 1000 * ACTS.indexOf(act));
          roll(spawns, act, rung);
          const n = carriers(spawns).length;
          expect(n, `${rung} ${act}`).toBeLessThanOrEqual(max);
          counts[n]++;
        }
        // At least k carriers: p^k, each slot a fresh roll that ends the rolls on a miss.
        for (let k = 1; k <= max; k++) {
          const atLeast = counts.slice(k).reduce((a, b) => a + b, 0) / N;
          const expected = p ** k;
          // Five standard errors of a binomial share, at least 0.015.
          const tolerance = Math.max(0.015, 5 * Math.sqrt((expected * (1 - expected)) / N));
          expect(Math.abs(atLeast - expected), `${rung} ${act} >=${k}`).toBeLessThan(tolerance);
        }
        if (p === 0) expect(counts[0]).toBe(N);
      }
    }
  });

  it('never gives one unit two items, and needs a unit that can carry', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const spawns = garrison(seed, 2);
      roll(spawns, 'act4', 'lunatic', { carryConfig: cfg(1, 3) });
      expect(carriers(spawns)).toHaveLength(2); // max 3, two eligible
    }
    const none = [{ className: 'Knight', col: 1, row: 1, level: 5, isBoss: true }];
    roll(none, 'act4', 'lunatic', { carryConfig: cfg(1, 3) });
    expect(carriers(none)).toEqual([]);
  });

  it('never goes to a boss, an elite captain, the Entity, an authored spawn or a Skeleton', () => {
    const base = { className: 'Fighter', col: 0, row: 0, level: 5 };
    const shut = [
      { ...base, isBoss: true },
      { ...base, isEntity: true },
      { ...base, authoredId: 'varro' },
      { ...base, className: 'Skeleton' },
      { ...base, _noXP: true },
      { ...base, _raisedBy: 'e1' },
    ];
    for (const spawn of shut) expect(isCarrierEligible(spawn), JSON.stringify(spawn)).toBe(false);
    expect(isCarrierEligible(base)).toBe(true);
    for (let seed = 1; seed <= 50; seed++) {
      const spawns = [...shut.map((s, i) => ({ ...s, col: i, row: seed })), { ...base, col: 20, row: seed }]; // prettier-ignore
      roll(spawns, 'act4', 'lunatic', { carryConfig: cfg(1, 3) });
      expect(carriers(spawns).map((s) => s.col)).toEqual([20]);
    }
  });

  it('draws what the act lists: Act I a Vulnerary or pouch, an Elixir from III, a Seal in IV', () => {
    const N = 2500;
    const names = {};
    for (const act of ACTS) {
      names[act] = {};
      for (let seed = 0; seed < N; seed++) {
        const spawns = garrison(seed + 7000 * ACTS.indexOf(act), 3);
        roll(spawns, act, 'lunatic', { carryConfig: cfg(1, 1) });
        const [carrier] = carriers(spawns);
        names[act][carrier.carries] = (names[act][carrier.carries] || 0) + 1;
      }
    }
    const booster = new Set(data.lootTables.act2.statBooster);
    const kinds = (act) => Object.keys(names[act]);
    expect(kinds('act1').sort()).toEqual(['Gold Pouch', 'Vulnerary']);
    expect(kinds('act2').every((n) => ['Vulnerary', 'Gold Pouch'].includes(n) || booster.has(n))).toBe(true); // prettier-ignore
    expect(kinds('act2')).not.toContain('Elixir');
    expect(kinds('act2')).not.toContain('Master Seal');
    expect(kinds('act3')).toContain('Elixir');
    expect(kinds('act3')).not.toContain('Master Seal');
    expect(kinds('act4')).toContain('Master Seal');
    expect(kinds('finalBoss')).toContain('Master Seal');
    // Shares follow the pool weights (Act III: 3/3/3/1 of 10; the booster is one list).
    const total = (act) => Object.values(names[act]).reduce((a, b) => a + b, 0);
    const share = (act, pred) => Object.entries(names[act]).filter(([n]) => pred(n)).reduce((a, [, c]) => a + c, 0) / total(act); // prettier-ignore
    expect(Math.abs(share('act3', (n) => n === 'Elixir') - 0.3)).toBeLessThan(0.04);
    expect(Math.abs(share('act3', (n) => n === 'Gold Pouch') - 0.3)).toBeLessThan(0.04);
    expect(Math.abs(share('act3', (n) => booster.has(n)) - 0.1)).toBeLessThan(0.03);
    expect(Math.abs(share('act4', (n) => n === 'Master Seal') - 1 / 10)).toBeLessThan(0.03);
  });

  it('a Gold Pouch is worth 300, 300, 500, 800 and 800 by act', () => {
    const WORTH = { act1: 300, act2: 300, act3: 500, act4: 800, finalBoss: 800 };
    for (const act of ACTS) {
      const seen = new Set();
      for (let seed = 0; seed < 400; seed++) {
        const spawns = garrison(seed + 31 * ACTS.indexOf(act), 3);
        roll(spawns, act, 'lunatic', { carryConfig: cfg(1, 1) });
        const [carrier] = carriers(spawns);
        if (carrier.carries === 'Gold Pouch') seen.add(carrier.carryValue);
        else expect(carrier.carryValue).toBeUndefined();
      }
      expect([...seen], act).toEqual([WORTH[act]]);
    }
  });

  it('a config without perBattle, or an act with no chance or pool, assigns and draws nothing', () => {
    const draws = vi.spyOn(Math, 'random');
    const spawns = garrison(3);
    assignEnemyCarry(spawns, { act: 'act4', carryConfig: { act4: 1, maxPerBattle: 3 }, lootTables: data.lootTables }); // prettier-ignore
    assignEnemyCarry(spawns, { act: 'act4', carryConfig: cfg(1, 0), lootTables: data.lootTables });
    assignEnemyCarry(spawns, { act: 'act4', carryConfig: cfg(0, 3), lootTables: data.lootTables });
    assignEnemyCarry(spawns, { act: 'act4', carryConfig: cfg(1, 3), lootTables: { act4: {} } });
    assignEnemyCarry(spawns, { act: 'act4', carryConfig: null, lootTables: data.lootTables });
    expect(carriers(spawns)).toEqual([]);
    expect(draws).not.toHaveBeenCalled();
  });
});

describe('in generated maps', () => {
  const gen = (params, seed) => {
    installSeed(seed);
    try {
      const battle = generateBattle({ deployCount: 6, row: 3, ...params }, data);
      return { battle, next: Math.random() };
    } finally {
      restoreMathRandom();
    }
  };

  it('leaves the map and the Math.random cursor exactly as without carriers', () => {
    let carried = 0;
    const strip = (bc) => bc.enemySpawns.map(({ carries: _a, carryValue: _b, ...rest }) => rest);
    for (const rung of ['dusk', 'hard', 'lunatic']) {
      for (const act of ['act2', 'act4']) {
        for (let seed = 1; seed <= 10; seed++) {
          const params = { ...modifiers(rung), difficultyId: rung, act, objective: 'rout' };
          const withCarry = gen(params, seed);
          const without = gen({ ...params, carryConfig: null }, seed);
          expect(withCarry.next, `${rung} ${act} ${seed}`).toBe(without.next);
          expect(withCarry.battle.mapLayout).toEqual(without.battle.mapLayout);
          expect(strip(withCarry.battle)).toEqual(strip(without.battle));
          expect(gen(params, seed).battle).toEqual(withCarry.battle); // deterministic
          carried += carriers(withCarry.battle.enemySpawns).length;
          expect(carriers(without.battle.enemySpawns)).toEqual([]);
        }
      }
    }
    expect(carried).toBeGreaterThan(0);
  });

  it('puts carriers only on field enemies, within the rung max, and none on First Light Act I', () => {
    for (const rung of RUNGS) {
      const m = modifiers(rung);
      for (const act of ['act1', 'act2', 'act3', 'act4']) {
        for (const objective of ['rout', 'seize']) {
          for (let seed = 1; seed <= 12; seed++) {
            const bc = gen({ ...m, difficultyId: rung, act, objective }, seed).battle;
            const found = carriers(bc.enemySpawns);
            expect(found.length).toBeLessThanOrEqual(m.carryConfig.maxPerBattle);
            expect(found.every((s) => !s.isBoss && !s.isEntity), `${rung} ${act} ${objective}`).toBe(true); // prettier-ignore
            if (!(m.carryConfig[act] > 0)) expect(found, `${rung} ${act}`).toEqual([]);
          }
        }
      }
    }
  });

  it('keeps a boss and its elite captain empty-handed on a seize map', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const m = modifiers('lunatic');
      const bc = gen({ ...m, difficultyId: 'lunatic', act: 'act3', objective: 'seize', isElite: true }, seed).battle; // prettier-ignore
      const boss = bc.enemySpawns.filter((s) => s.isBoss);
      expect(boss.length).toBeGreaterThan(0);
      expect(carriers(boss)).toEqual([]);
    }
  });
});

describe('the item a carrier holds', () => {
  const consumables = data.consumables;
  const spawn = (extra = {}) => ({ className: 'Fighter', col: 4, row: 7, level: 5, ...extra });

  it('is a whole item with a uid that draws no Math.random and is the same for the same battle', () => {
    const draws = vi.spyOn(Math, 'random');
    const a = buildCarriedItem(spawn({ carries: 'Vulnerary' }), { consumables, battleKey: 'k1' });
    const b = buildCarriedItem(spawn({ carries: 'Vulnerary' }), { consumables, battleKey: 'k1' });
    const other = buildCarriedItem(spawn({ carries: 'Vulnerary' }), {
      consumables,
      battleKey: 'k2',
    });
    expect(draws).not.toHaveBeenCalled();
    expect(a).toEqual(b);
    expect(a).toMatchObject({ name: 'Vulnerary', type: 'Consumable', effect: 'heal', uses: 2 });
    expect(a.uid).toBe(carriedItemUid(spawn({ carries: 'Vulnerary' }), 'k1'));
    expect(a.uid).toMatch(/^itm_carry_/);
    expect(other.uid).not.toBe(a.uid);
    // A copy: the catalog entry is never the carried item and never changes.
    expect(consumables.find((c) => c.name === 'Vulnerary')).not.toHaveProperty('uid');
  });

  it('reads the run catalog: a Vulnerary has the uses the run gives it', () => {
    const run = new RunManager(data, { vulneraryUses: 3 });
    const item = buildCarriedItem(spawn({ carries: 'Vulnerary' }), { consumables: run.getConsumableCatalog() }); // prettier-ignore
    expect(item.uses).toBe(3);
    expect(buildCarriedItem(spawn({ carries: 'Vulnerary' }), { consumables }).uses).toBe(2);
  });

  it('refuses a name nobody knows, a scroll, or a spawn that carries nothing', () => {
    const weapons = data.weapons;
    expect(
      buildCarriedItem(spawn({ carries: 'Nothing Real' }), { consumables, weapons }),
    ).toBeNull();
    expect(
      buildCarriedItem(spawn({ carries: 'Steal Scroll' }), { consumables, weapons }),
    ).toBeNull();
    expect(buildCarriedItem(spawn(), { consumables, weapons })).toBeNull();
    expect(buildCarriedItem(spawn({ carries: 'Iron Sword' }), { consumables, weapons })?.type).toBe('Sword'); // prettier-ignore
  });

  it('a Gold Pouch gives its gold when used and the same when sold', () => {
    const template = consumables.find((c) => c.name === 'Gold Pouch');
    expect(template).toMatchObject({ effect: 'gold', uses: 1 });
    for (const value of [300, 500, 800]) {
      const item = buildCarriedItem(spawn({ carries: 'Gold Pouch', carryValue: value }), { consumables }); // prettier-ignore
      expect(goldPouchValue(item)).toBe(value);
      expect(getSellPrice(item)).toBe(value); // never worth more sold than spent
      expect(makeGoldPouch(template, value).price).toBe(value * 2);
    }
    // The catalog's own pouch is not edited by making one.
    expect(template.value).toBe(300);
    expect(template.price).toBe(600);
    expect(getSellPrice(template)).toBe(300);
  });

  it('is held apart from the bag: the AI and combat never see it', () => {
    const enemy = { name: 'Brigand', inventory: [], consumables: [], weapon: null };
    applyEnemySpawnGear(enemy, spawn({ carries: 'Elixir' }), { weapons: data.weapons, consumables, battleKey: 'k' }); // prettier-ignore
    expect(enemy.carriedItem).toMatchObject({ name: 'Elixir', effect: 'healFull' });
    expect(enemy.consumables).toEqual([]);
    expect(enemy.inventory).toEqual([]);
  });

  it('is never held by a boss, the Entity, a Skeleton or a spawn without the flag', () => {
    const make = () => ({ name: 'Foe', inventory: [], consumables: [], weapon: null, className: 'Fighter' }); // prettier-ignore
    const deps = { weapons: data.weapons, consumables, battleKey: 'k' };
    for (const extra of [{ isBoss: true }, { isEntity: true }, { className: 'Skeleton' }, {}]) {
      const foe = make();
      applyEnemySpawnGear(foe, spawn(extra), deps); // no `carries`: nothing is built
      expect(foe.carriedItem).toBeUndefined();
    }
    for (const extra of [{ isBoss: true }, { isEntity: true }, { className: 'Skeleton' }]) {
      const foe = make();
      applyEnemySpawnGear(foe, spawn({ carries: 'Elixir', ...extra }), deps);
      expect(foe.carriedItem, JSON.stringify(extra)).toBeUndefined();
    }
    const raised = { ...make(), _raisedBy: 'e1' };
    applyEnemySpawnGear(raised, spawn({ carries: 'Elixir' }), deps);
    expect(raised.carriedItem).toBeUndefined();
  });

  it('a Skeleton a Necromancer raises never carries anything', () => {
    const necromancer = { battleEntityId: 'e9', className: 'Necromancer', level: 14, tier: 'promoted', stats: { HP: 30 } }; // prettier-ignore
    const world = { classes: data.classes, weapons: data.weapons, seed: 5, turn: 2, ordinal: 0 };
    const skeleton = buildRaisedSkeleton(necromancer, { col: 1, row: 1 }, world);
    expect(skeleton).toBeTruthy();
    expect(skeleton.carriedItem).toBeUndefined();
    expect(skeleton.consumables).toEqual([]);
    expect(isCarrierEligible(skeleton)).toBe(false);
  });
});

describe('carried into battle (the harness as the scene)', () => {
  it('a carrier holds the item its spawn names, with its pip data, apart from its bag', () => {
    let found = null;
    for (let seed = 1; seed <= 60 && !found; seed++) {
      installSeed(seed);
      const battle = new HeadlessBattle(data, {
        ...modifiers('lunatic'),
        difficultyId: 'lunatic',
        act: 'act3',
        objective: 'rout',
        battleSeed: 900 + seed,
        deployCount: 6,
      });
      battle.init();
      restoreMathRandom();
      for (const e of battle.enemyUnits) {
        const spawn = battle.battleConfig.enemySpawns.find((s) => s.col === e.col && s.row === e.row && s.carries); // prettier-ignore
        if (spawn) found = { e, spawn, battle };
      }
    }
    expect(found).not.toBeNull();
    expect(found.e.carriedItem.name).toBe(found.spawn.carries);
    expect(found.e.carriedItem.uid).toMatch(/^itm_carry_/);
    expect(found.e.consumables).toEqual([]);
    const others = found.battle.enemyUnits.filter((e) => e !== found.e);
    const names = found.battle.enemyUnits.map((e) => e.carriedItem?.uid).filter(Boolean);
    expect(new Set(names).size).toBe(names.length); // no two carriers share a uid
    expect(others.length).toBeGreaterThan(0);
  });
});

describe('the data', () => {
  it('the shipped carry pools are sound; unsound ones are named', () => {
    const args = { lootTables: data.lootTables, consumables: data.consumables, weapons: data.weapons }; // prettier-ignore
    expect(validateCarryPools(args)).toEqual([]);
    const bad = structuredClone(data.lootTables);
    bad.act1.carryPool = [{ item: 'Nothing Real', weight: 1 }];
    bad.act2.carryPool = [{ item: 'Steal Scroll', weight: 1 }];
    bad.act3.carryPool = [{ item: 'Gold Pouch', weight: 1 }]; // no value
    bad.act4.carryPool = [{ item: 'Vulnerary', weight: 1, value: 5 }]; // a value on a non-pouch
    bad.finalBoss.carryPool = [{ from: 'statBooster', weight: 1 }]; // an empty list in that act
    const problems = validateCarryPools({ ...args, lootTables: bad }).join('\n');
    expect(problems).toMatch(/act1\.carryPool references unknown item "Nothing Real"/);
    expect(problems).toMatch(/act2\.carryPool lists "Steal Scroll": a scroll is never carried/);
    expect(problems).toMatch(/act3\.carryPool "Gold Pouch" must name its gold value/);
    expect(problems).toMatch(/act4\.carryPool "Vulnerary" is not a Gold Pouch and takes no value/);
    expect(problems).toMatch(/finalBoss\.carryPool draws from "statBooster", which is empty/);
    delete bad.act1.carryPool;
    expect(validateCarryPools({ ...args, lootTables: bad }).join('\n')).toMatch(/act1\.carryPool must list at least one entry/); // prettier-ignore
  });
});
