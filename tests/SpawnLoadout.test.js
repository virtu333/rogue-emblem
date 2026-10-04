// Authored spawn loadouts (engine/EnemySpawnGear.applySpawnLoadout): a spawn's own
// `weapon` and `skills` win over the class's rolled kit, for BattleScene and the
// headless harness alike, and a spawn without them is built exactly as before.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { loadGameData } from './testData.js';
import { applySpawnLoadout } from '../src/engine/EnemySpawnGear.js';
import { createEnemyUnit, createPromotedEnemyUnit } from '../src/engine/UnitManager.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';

const data = loadGameData();
const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});

const cls = (name) => data.classes.find((c) => c.name === name);

// Generated-style spawns only: none carries `weapon`, `skills` or `authoredId`.
const LEGACY_SPAWNS = [
  { className: 'Fighter', level: 1, col: 1, row: 1 },
  { className: 'Soldier', level: 7, col: 2, row: 1, aiMode: 'guard' },
  { className: 'Archer', level: 4, col: 3, row: 1, isBoss: true, name: 'Iron Captain' },
  { className: 'Hero', level: 14, col: 4, row: 1 },
  { className: 'Sage', level: 15, col: 5, row: 1, siegeWeapon: 'Breachbolt' },
  { className: 'Fighter', level: 6, col: 6, row: 1, sunderWeapon: true },
  { className: 'Mage', level: 8, col: 7, row: 1, statusStaff: 'sleep' },
  { className: 'Myrmidon', level: 9, col: 8, row: 1, aiMode: 'hold', holdPack: 0, holdPackSize: 2 },
  { className: 'Ranger', level: 12, col: 9, row: 1 },
];
const PARAMS = [
  { act: 'act1', difficultyId: 'normal' },
  { act: 'act3', difficultyId: 'hard', enemySkillChance: 0.3, enemyStatBonus: 1 },
];

function fingerprint(enemy) {
  const stats = Object.values(enemy.stats).join(',');
  const inv = (enemy.inventory || []).map((w) => w.name).join('+');
  return [
    enemy.name,
    enemy.className,
    `L${enemy.level}`,
    stats,
    enemy.currentHP,
    enemy.weapon?.name ?? '-',
    inv,
    (enemy.skills || []).join('+'),
    enemy.aiMode ?? '-',
    enemy.statusStaff?.name ?? '-',
    enemy.holdPack ?? '-',
    enemy.authoredId ?? '-',
  ].join('|');
}

function sceneFor(params) {
  const scene = new BattleScene();
  scene.gameData = data;
  scene.battleParams = { ...params };
  scene.enemyUnits = [];
  scene.addUnitGraphic = () => {};
  return { add: (spawn) => scene.addEnemyFromSpawn(spawn) };
}

function harnessFor(params) {
  const battle = new HeadlessBattle(data, { ...params });
  battle.enemyUnits = [];
  return { add: (spawn) => battle._addEnemyFromSpawn(spawn) };
}

/** Every legacy spawn built under one seeded stream, and where that stream stands after. */
function build(makeBuilder, params, seed) {
  Math.random = createSeededRng(seed);
  const builder = makeBuilder(params);
  const lines = LEGACY_SPAWNS.map((spawn) => fingerprint(builder.add(structuredClone(spawn))));
  const cursor = Math.random();
  Math.random = realRandom;
  return { lines, cursor };
}

// Captured from the code before applySpawnLoadout existed (2026-10-04). A change here
// means a generated spawn is no longer built as it was.
const GOLDEN = [
  {
    lines: [
      'Fighter|Fighter|L1|22,8,0,3,5,4,1,2,4|22|Iron Axe|Iron Axe||-|-|-|-',
      'Soldier|Soldier|L7|27,8,1,7,7,9,1,5,4|27|Steel Lance|Steel Lance|luna|guard|-|-|-',
      'Iron Captain|Archer|L4|21,7,2,10,8,7,6,6,6|21|Iron Bow|Iron Bow||-|-|-|-',
      'Hero|Hero|L3|33,17,2,12,18,14,4,9,5|33|Silver Sword|Silver Sword|vigilance|-|-|-|-',
      'Sage|Sage|L4|25,3,18,12,14,4,12,5,5|25|Breachbolt|Breachbolt+Conflagration|spell_harmony|-|-|-|-',
      'Fighter|Fighter|L6|25,11,0,5,7,5,2,4,4|25|Sunder Axe|Sunder Axe||-|-|-|-',
      'Mage|Mage|L8|19,2,10,6,8,3,6,5,4|19|Wildfire|Wildfire||-|Sleep Staff|-|-',
      'Myrmidon|Myrmidon|L9|25,9,2,15,13,3,4,7,4|25|Steel Sword|Steel Sword||hold|-|0|-',
      'Ranger|Ranger|L12|33,13,2,12,9,9,3,6,4|33|Steel Sword|Steel Sword||-|-|-|-',
    ],
    cursor: 0.4992423567455262,
  },
  {
    lines: [
      'Fighter|Fighter|L1|24,9,1,4,6,5,2,3,4|24|Iron Axe|Iron Axe||-|-|-|-',
      'Soldier|Soldier|L7|29,12,1,6,10,8,2,5,4|29|Steel Lance|Steel Lance|sol|guard|-|-|-',
      'Iron Captain|Archer|L4|23,8,3,12,9,8,5,10,6|23|Iron Bow|Iron Bow||-|-|-|-',
      'Hero|Hero|L3|33,16,2,17,15,15,10,12,5|33|Silver Sword|Silver Sword+Silver Axe|vigilance+vantage|-|-|-|-',
      'Sage|Sage|L4|31,3,21,15,14,8,13,6,5|31|Breachbolt|Breachbolt+Conflagration|spell_harmony+adept|-|-|-|-',
      'Fighter|Fighter|L6|28,10,1,6,9,6,2,5,4|28|Sunder Axe|Sunder Axe|luna|-|-|-|-',
      'Mage|Mage|L8|21,2,11,7,13,4,6,7,4|21|Wildfire|Wildfire||-|Sleep Staff|-|-',
      'Myrmidon|Myrmidon|L9|24,9,2,13,15,5,3,7,4|24|Steel Sword|Steel Sword|adept|hold|-|0|-',
      'Ranger|Ranger|L12|30,17,4,11,8,13,5,4,4|30|Steel Sword|Steel Sword+Steel Bow||-|-|-|-',
    ],
    cursor: 0.9189824869390577,
  },
];

describe('spawns without an authored loadout are built as before', () => {
  for (const [label, makeBuilder] of [
    ['BattleScene', sceneFor],
    ['the harness', harnessFor],
  ]) {
    it(`${label}: same units, same stream position`, () => {
      const out = PARAMS.map((params, i) => build(makeBuilder, params, 4101 + i));
      expect(out).toEqual(GOLDEN);
    });
  }
});

describe('an authored spawn carries exactly its own kit', () => {
  const freshFighter = (level) =>
    createEnemyUnit(cls('Fighter'), level, data.weapons, 1.0, data.skills, 'act1');

  it('equips the named weapon, dropping the rolled one, and keeps a uid', () => {
    Math.random = createSeededRng(9);
    const enemy = freshFighter(7); // level 7 rolls a Steel Axe
    Math.random = realRandom;
    expect(enemy.weapon.name).toBe('Steel Axe');
    const rolledUid = enemy.weapon.uid;
    const report = applySpawnLoadout(enemy, { weapon: 'Iron Axe' }, { weapons: data.weapons });
    expect(report.weapon).toBe('equipped');
    expect(enemy.weapon.name).toBe('Iron Axe');
    expect(enemy.inventory).toEqual([enemy.weapon]);
    expect(enemy.weapon.uid).toBe(rolledUid);
    // An instance, not the catalog entry.
    expect(enemy.weapon).not.toBe(data.weapons.find((w) => w.name === 'Iron Axe'));
  });

  it('a special the tier picker never chooses (Javelin) is allowed; a foreign type is refused', () => {
    const soldier = createEnemyUnit(cls('Soldier'), 1, data.weapons, 1.0, null, 'act1');
    expect(
      applySpawnLoadout(soldier, { weapon: 'Javelin' }, { weapons: data.weapons }).weapon,
    ).toBe('equipped');
    expect(soldier.weapon.name).toBe('Javelin');

    const fighter = freshFighter(1);
    const before = structuredClone(fighter);
    const report = applySpawnLoadout(fighter, { weapon: 'Javelin' }, { weapons: data.weapons });
    expect(report.weapon).toBe('refused');
    expect(fighter).toEqual(before);
    expect(
      applySpawnLoadout(fighter, { weapon: 'No Such Axe' }, { weapons: data.weapons }).weapon,
    ).toBe('unknown');
  });

  it('sets exactly the authored skills, class-innate ones included; [] means none', () => {
    const hero = createPromotedEnemyUnit(
      cls('Hero'),
      14,
      data.weapons,
      1.0,
      data.skills,
      'act1',
      data.classes,
    );
    // The class-innate skill a promoted enemy is given (the pin above: vigilance).
    expect(hero.skills).toContain('vigilance');
    applySpawnLoadout(hero, { skills: [] }, { weapons: data.weapons, skills: data.skills });
    expect(hero.skills).toEqual([]);
    applySpawnLoadout(hero, { skills: ['luna', 'not_a_skill'] }, { skills: data.skills });
    expect(hero.skills).toEqual(['luna']);
  });

  it('copies the authored id; a spawn without fields leaves the enemy untouched, drawing nothing', () => {
    const enemy = freshFighter(1);
    const before = structuredClone(enemy);
    Math.random = () => {
      throw new Error('Math.random was drawn');
    };
    applySpawnLoadout(enemy, { className: 'Fighter', level: 1, col: 0, row: 0 }, data);
    expect(enemy).toEqual(before);
    applySpawnLoadout(enemy, { authoredId: 'b', weapon: 'Iron Axe', skills: [] }, data);
    Math.random = realRandom;
    expect(enemy.authoredId).toBe('b');
  });

  for (const [label, makeBuilder] of [
    ['BattleScene', sceneFor],
    ['the harness', harnessFor],
  ]) {
    it(`${label} builds an authored spawn with its kit, on the same stream as without it`, () => {
      const authored = {
        className: 'Fighter',
        level: 7,
        col: 1,
        row: 1,
        authoredId: 'a',
        weapon: 'Iron Axe',
        skills: [],
      };
      const plain = { className: 'Fighter', level: 7, col: 1, row: 1 };
      const params = { act: 'act3', difficultyId: 'hard', enemySkillChance: 1 };
      Math.random = createSeededRng(31);
      const withKit = makeBuilder(params).add(structuredClone(authored));
      const cursorWith = Math.random();
      Math.random = createSeededRng(31);
      const without = makeBuilder(params).add(structuredClone(plain));
      const cursorWithout = Math.random();
      Math.random = realRandom;
      // Nightfall would add secondaries and a skill; the authored kit replaces both.
      expect(without.skills.length).toBeGreaterThan(0);
      expect(withKit.weapon.name).toBe('Iron Axe');
      expect(withKit.inventory.map((w) => w.name)).toEqual(['Iron Axe']);
      expect(withKit.skills).toEqual([]);
      expect(withKit.authoredId).toBe('a');
      // Same stats: the authored kit changes the kit only.
      expect(withKit.stats).toEqual(without.stats);
      expect(cursorWith).toBe(cursorWithout);
    });
  }
});
