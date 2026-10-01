// Enemy area arts (docs/specs/aoe-weapon-arts.md §7, owner decision 2026-10-01): only
// elite battles from Act III at Nightfall or above hand them out, one or two enemies
// each, Sweeping Cleave for axes and swords, Skewer for lances and bows. The ways this
// can go wrong: the gate leaks to another battle, a gated-out battle draws a random
// number (and so generates differently), the wrong art for the class, a boss or siege
// crew gets one, the art never reaches the weapon, the AI cannot use it, or threat
// sight hides it.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { loadGameData } from './testData.js';
import {
  assignEnemyAreaArts,
  bindEnemyAreaArt,
  enemyAreaArtForClass,
  enemyAreaArtsAllowed,
} from '../src/engine/EnemyAreaArts.js';
import { enemyAreaArtOf } from '../src/engine/EnemyArtScoring.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { createEnemyUnit } from '../src/engine/UnitManager.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import {
  threatsOnTile,
  threatSummaryText,
  threatWorldSignature,
} from '../src/engine/ThreatForecast.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { validateCrossReferences } from '../tools/validateCrossReferences.js';

const data = loadGameData();
const arts = data.weaponArts.arts;
const art = (id) => arts.find((a) => a.id === id);
const cls = (name) => data.classes.find((c) => c.name === name);
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
// The shipped rule (enemies.json eliteAreaArts); the expectations below are the owner's.
const config = data.enemies.eliteAreaArts;
const CLEAVE = 'axe_sweeping_cleave';
const SKEWER = 'lance_skewer';

/** A counting random source that replays `values` (then 0). */
function scripted(values = []) {
  const queue = [...values];
  const fn = () => {
    fn.calls++;
    return queue.length ? queue.shift() : 0;
  };
  fn.calls = 0;
  return fn;
}

describe('which battles hand out area arts', () => {
  it.each([
    [{ isElite: true, act: 'act3', difficultyId: 'hard' }, true],
    [{ isElite: true, act: 'act4', difficultyId: 'lunatic' }, true],
    [{ isElite: true, act: 'postAct', difficultyId: 'hard' }, true],
    [{ isElite: true, act: 'act3', difficultyId: 'dusk' }, false],
    [{ isElite: true, act: 'act4', difficultyId: 'normal' }, false],
    [{ isElite: true, act: 'act2', difficultyId: 'lunatic' }, false],
    [{ isElite: true, act: 'act1', difficultyId: 'hard' }, false],
    [{ isElite: false, act: 'act3', difficultyId: 'lunatic' }, false],
    [{ act: 'act4', difficultyId: 'hard' }, false],
    [{ isElite: true, act: 'act3' }, false],
  ])('%o → %s', (battle, expected) => {
    expect(enemyAreaArtsAllowed(battle, config)).toBe(expected);
  });
});

describe('the shipped rule', () => {
  it('is Nightfall+, Act III on, one or two enemies, Cleave and Skewer only', () => {
    expect(config).toEqual({
      minDifficulty: 'hard',
      acts: ['act3', 'act4', 'postAct', 'finalBoss'],
      count: [1, 2],
      byWeaponType: { Axe: CLEAVE, Sword: CLEAVE, Lance: SKEWER, Bow: SKEWER },
    });
  });

  it('no rule, no arts', () => {
    expect(enemyAreaArtsAllowed({ isElite: true, act: 'act4', difficultyId: 'lunatic' })).toBe(
      false,
    );
    const random = scripted();
    const spawns = [{ className: 'Fighter', col: 0, row: 0 }];
    const battle = { isElite: true, act: 'act4', difficultyId: 'lunatic', classes: data.classes };
    expect(assignEnemyAreaArts(spawns, { ...battle, random })).toBe(spawns);
    expect(random.calls).toBe(0);
  });

  it('the validator refuses a knockback, a wrong weapon, an aimed art or a bad rung', () => {
    const enemies = structuredClone(data.enemies);
    enemies.eliteAreaArts.byWeaponType = {
      Lance: 'lance_battering_ram', // moves units, and player-only
      Tome: CLEAVE, // a tome cannot swing it
      Axe: 'legend_cataclysm', // a legendary's own art, never on a common axe
      Bow: 'no_such_art',
    };
    enemies.eliteAreaArts.minDifficulty = 'nightfall'; // the label, not the id
    enemies.eliteAreaArts.count = [2, 1];
    const { errors } = validateCrossReferences({ ...data, enemies });
    const has = (...parts) => errors.some((e) => parts.every((p) => e.includes(p)));
    expect(has('byWeaponType.Lance', 'moves units')).toBe(true);
    expect(has('byWeaponType.Lance', 'not open to enemies')).toBe(true);
    expect(has('byWeaponType.Tome', 'cannot be used with a Tome')).toBe(true);
    expect(has('byWeaponType.Bow', 'unknown art')).toBe(true);
    expect(has('byWeaponType.Axe', 'legendary weapon')).toBe(true);
    expect(has('minDifficulty')).toBe(true);
    expect(has('count')).toBe(true);
    expect(validateCrossReferences(data).errors.filter((e) => e.includes('eliteAreaArts'))).toEqual(
      [],
    );
  });
});

describe('which art a class carries', () => {
  it.each([
    ['Fighter', CLEAVE], // Axes
    ['Myrmidon', CLEAVE], // Swords
    ['Soldier', SKEWER], // Lances
    ['Archer', SKEWER], // Bows
    ['Paladin', SKEWER], // Lances (M) first
    ['Hero', CLEAVE], // Swords (M) first
    ['Battle Monk', CLEAVE], // Staves first: the first weapon is Axes
    ['Mage', null], // Tomes
    ['Cleric', null], // Staves only
  ])('%s → %s', (name, expected) => {
    expect(enemyAreaArtForClass(cls(name), config)).toBe(expected);
  });
});

describe('assigning arts to spawns', () => {
  const elite = {
    isElite: true,
    act: 'act3',
    difficultyId: 'hard',
    classes: data.classes,
    config,
  };
  const spawns = () => [
    { className: 'Fighter', col: 1, row: 1 },
    { className: 'Cleric', col: 2, row: 1 },
    { className: 'Soldier', col: 3, row: 1 },
    { className: 'Hero', col: 4, row: 1, isBoss: true },
    { className: 'Archer', col: 5, row: 1, siegeWeapon: 'Ballista Bolt' },
    { className: 'Myrmidon', col: 6, row: 1 },
  ];

  it('a battle that does not qualify is untouched and draws nothing', () => {
    for (const battle of [
      { ...elite, difficultyId: 'dusk' },
      { ...elite, act: 'act2' },
      { ...elite, isElite: false },
    ]) {
      const random = scripted([0.9, 0.9, 0.9]);
      const input = spawns();
      expect(assignEnemyAreaArts(input, { ...battle, random })).toBe(input);
      expect(random.calls).toBe(0);
    }
  });

  it('one or two eligible enemies, picked by the battle seed; never a boss, siege crew or healer', () => {
    // Eligible, in order: Fighter (0), Soldier (2), Myrmidon (5).
    // Count roll 0.2 → 1 + floor(0.2 × 2) = 1; pick 0.5 → floor(0.5 × 3) = 1 → Soldier.
    let random = scripted([0.2, 0.5]);
    let out = assignEnemyAreaArts(spawns(), { ...elite, random });
    expect(out.map((s) => s.areaArt ?? null)).toEqual([null, null, SKEWER, null, null, null]);
    expect(random.calls).toBe(2);
    // Count roll 0.7 → 2; picks 0.9 → index 2 of 3 (Myrmidon), then 0 → Fighter.
    random = scripted([0.7, 0.9, 0]);
    out = assignEnemyAreaArts(spawns(), { ...elite, random });
    expect(out.map((s) => s.areaArt ?? null)).toEqual([CLEAVE, null, null, null, null, CLEAVE]);
    expect(random.calls).toBe(3);
  });

  it('never more enemies than can carry one, and no draw when none can', () => {
    const one = [
      { className: 'Archer', col: 0, row: 0 },
      { className: 'Mage', col: 1, row: 0 },
    ];
    const random = scripted([0.99, 0.99]);
    const out = assignEnemyAreaArts(one, { ...elite, random });
    expect(out.map((s) => s.areaArt ?? null)).toEqual([SKEWER, null]);
    const none = [{ className: 'Mage', col: 1, row: 0 }];
    const quiet = scripted();
    expect(assignEnemyAreaArts(none, { ...elite, random: quiet })).toBe(none);
    expect(quiet.calls).toBe(0);
  });
});

describe('generated battles', () => {
  const params = (over = {}) => ({
    act: 'act3',
    objective: 'seize',
    isElite: true,
    difficultyId: 'hard',
    row: 3,
    ...over,
  });
  const generate = (p, seed) => {
    const prev = Math.random;
    Math.random = createSeededRng(seed);
    try {
      return generateBattle(p, data);
    } finally {
      Math.random = prev;
    }
  };
  const carriers = (bc) => bc.enemySpawns.filter((s) => s.areaArt);

  it('an elite Act III battle at Nightfall arms one or two enemies, the same ones every time', () => {
    let armedBattles = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const a = carriers(generate(params(), seed));
      const b = carriers(generate(params(), seed));
      expect(a).toEqual(b);
      expect(a.length).toBeLessThanOrEqual(2);
      for (const spawn of a) {
        expect(spawn.isBoss).toBeFalsy();
        expect(spawn.areaArt).toBe(enemyAreaArtForClass(cls(spawn.className), config));
      }
      if (a.length > 0) armedBattles++;
    }
    expect(armedBattles).toBeGreaterThan(6);
  });

  it.each([
    ['Dusk', { difficultyId: 'dusk' }],
    ['Act II', { act: 'act2' }],
    ['a plain battle', { isElite: false, objective: 'rout' }],
  ])('%s arms nobody', (_label, over) => {
    for (let seed = 1; seed <= 12; seed++)
      expect(carriers(generate(params(over), seed))).toEqual([]);
  });
});

describe('binding the art to the weapon', () => {
  const enemyOf = (name) => createEnemyUnit(cls(name), 12, data.weapons, 1.0, null, 'act3');

  it('lands on the equipped weapon, where the AI finds it', () => {
    const fighter = enemyOf('Fighter');
    expect(bindEnemyAreaArt(fighter, CLEAVE, arts)).toBe(fighter.weapon);
    expect(fighter.weapon.weaponArtIds).toEqual([CLEAVE]);
    const archer = enemyOf('Archer');
    expect(bindEnemyAreaArt(archer, SKEWER, arts)).toBe(archer.weapon);
    expect(archer.weapon.weaponArtIds).toEqual([SKEWER]);
  });

  it('the scene arms the spawn it builds (and only that one)', () => {
    const scene = new BattleScene();
    scene.gameData = data;
    scene.battleParams = { act: 'act3', difficultyId: 'hard', isElite: true };
    scene.enemyUnits = [];
    scene.addUnitGraphic = () => {};
    const armed = scene.addEnemyFromSpawn({
      className: 'Soldier',
      level: 12,
      col: 1,
      row: 1,
      areaArt: SKEWER,
    });
    const plain = scene.addEnemyFromSpawn({ className: 'Soldier', level: 12, col: 2, row: 1 });
    expect(armed.weapon.weaponArtIds).toEqual([SKEWER]);
    expect(plain.weapon.weaponArtIds ?? []).toEqual([]);
  });

  it('the harness arms the same enemies its battle generated', () => {
    const prev = Math.random;
    let battle = null;
    // The first seed whose battle arms someone (most do).
    for (let seed = 1; seed <= 12 && !battle; seed++) {
      Math.random = createSeededRng(seed);
      try {
        const b = new HeadlessBattle(
          data,
          { act: 'act3', objective: 'seize', isElite: true, difficultyId: 'hard', row: 3 },
          [],
        );
        b.init();
        if (b.battleConfig.enemySpawns.some((s) => s.areaArt)) battle = b;
      } finally {
        Math.random = prev;
      }
    }
    expect(battle).not.toBeNull();
    for (const spawn of battle.battleConfig.enemySpawns) {
      const enemy = battle.enemyUnits.find((u) => u.col === spawn.col && u.row === spawn.row);
      const ids = enemy?.inventory.flatMap((w) => w.weaponArtIds || []) ?? [];
      expect(ids.includes(CLEAVE) || ids.includes(SKEWER)).toBe(Boolean(spawn.areaArt));
    }
  });

  it('skips a weapon that cannot carry it, and adds nothing to a full weapon', () => {
    const mage = enemyOf('Mage');
    expect(bindEnemyAreaArt(mage, CLEAVE, arts)).toBeNull();
    expect(mage.weapon.weaponArtIds ?? []).toEqual([]);
    const fighter = enemyOf('Fighter');
    fighter.weapon.weaponArtIds = ['axe_smash', 'axe_helm_splitter', 'axe_wild_swing'];
    expect(bindEnemyAreaArt(fighter, CLEAVE, arts)).toBeNull();
    expect(fighter.weapon.weaponArtIds).not.toContain(CLEAVE);
  });
});

describe('an armed enemy in battle (harness)', () => {
  const unit = (name, faction, col, row, stats = {}, extra = {}) => ({
    name,
    faction,
    col,
    row,
    level: 10,
    tier: 'base',
    moveType: 'Infantry',
    currentHP: stats.HP ?? 30,
    stats: { HP: 30, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5, ...stats },
    skills: [],
    accessory: null,
    inventory: [],
    proficiencies: [],
    ...extra,
  });

  // Brute: Iron Axe 7 + STR 12 = a 19 blow on DEF 0, half of it (9) to a foe beside it.
  // SKL 99 lands the strike; the targets' LCK 99 rules out a crit; the target is unarmed.
  function fight(besideHP) {
    const axe = weapon('Iron Axe');
    const brute = unit(
      'Brute',
      'enemy',
      2,
      2,
      { STR: 12, SKL: 99, HP: 40 },
      { weapon: axe, inventory: [axe], proficiencies: [{ type: 'Axe', rank: 'Prof' }] },
    );
    bindEnemyAreaArt(brute, CLEAVE, arts);
    const target = unit('Target', 'player', 3, 2, { LCK: 99 }, { isCommander: true });
    const beside = unit('Beside', 'player', 2, 1, { LCK: 99, HP: besideHP });
    const battle = new HeadlessBattle(data, { act: 'act3', objective: 'rout' });
    battle.battleParams = { act: 'act3', difficultyId: 'hard', isElite: true };
    battle.turnManager = { turnNumber: 1, unitActed() {} };
    battle.battleConfig = { objective: 'rout' };
    battle.playerUnits = [target, beside];
    battle.enemyUnits = [brute];
    battle.npcUnits = [];
    battle.grid = {
      cols: 8,
      rows: 6,
      fogEnabled: false,
      getTerrainAt: () => ({}),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    battle._enemyWeaponArtRandom = () => 0;
    battle._executeEnemyCombat(brute, target);
    return { battle, brute, target, beside };
  }

  it('swings Sweeping Cleave when the arc kills: pays 6 HP, the foe beside it falls', () => {
    // Nightfall's bar is 0.75. Cleave alone: 5 Hit × 0.35 − 6 HP × 0.75 = −2.75; the
    // kill beside adds 0.8 × (8/8 × 4 + 6) = 8. Total 5.25: it swings.
    const { battle, brute, target, beside } = fight(8);
    expect(brute.currentHP).toBe(40 - 6);
    expect(target.currentHP).toBe(30 - 19);
    expect(beside.currentHP).toBe(0);
    expect(battle.playerUnits).toEqual([target]);
    expect(brute._battleWeaponArtUsage.map[CLEAVE]).toBe(1);
  });

  it('holds it back when the arc would only scratch: 9 of 30 scores −2.75 + 0.96', () => {
    const { brute, target, beside } = fight(30);
    expect([brute.currentHP, target.currentHP, beside.currentHP]).toEqual([40, 30 - 19, 30]);
  });
});

describe('threat sight names the foes that carry one', () => {
  it('picks only a usable, aimed-by-attack area art', () => {
    const plain = { id: 'plain', combatMods: {} };
    const aimed = { ...art('legend_cataclysm'), targeting: 'chosen_center' };
    expect(enemyAreaArtOf([{ art: plain, canUse: true }])).toBeNull();
    expect(enemyAreaArtOf([{ art: art(CLEAVE), canUse: false }])).toBeNull();
    expect(enemyAreaArtOf([{ art: aimed, canUse: true }])).toBeNull();
    expect(enemyAreaArtOf([{ art: plain }, { art: art(SKEWER), canUse: true }])?.id).toBe(SKEWER);
  });

  it('"2 foes can reach · 1 with an area art", and the line changes once it is spent', () => {
    const foe = (name, col) => ({
      name,
      faction: 'enemy',
      col,
      row: 0,
      currentHP: 20,
      mov: 2,
      stats: { MOV: 2, HP: 20 },
      moveType: 'Infantry',
      weapon: { name: 'Iron Axe', type: 'Axe', range: '1' },
    });
    const armed = foe('Armed', 3);
    const plain = foe('Plain', 5);
    let spent = false;
    const grid = {
      cols: 8,
      rows: 1,
      fogEnabled: false,
      isVisible: () => true,
      getMovementRange: (c, r, mov) => {
        const out = new Map();
        for (let col = 0; col < 8; col++)
          if (Math.abs(col - c) <= mov) out.set(`${col},${r}`, { cost: Math.abs(col - c) });
        return out;
      },
      getAttackRange: (c, r) => [
        { col: c - 1, row: r },
        { col: c + 1, row: r },
      ],
    };
    const ctx = {
      grid,
      enemyUnits: [armed, plain],
      ballistas: [],
      positions: () => new Map(),
      costModifier: () => 0,
      areaArtOf: (u) => (u === armed && !spent ? art(CLEAVE) : null),
    };
    const result = threatsOnTile(ctx, 4, 0);
    expect(result.damage).toEqual([armed, plain]);
    expect(threatSummaryText(result)).toBe('2 foes can reach · 1 with an area art');
    const before = threatWorldSignature(ctx, [armed, plain]);
    spent = true;
    expect(threatWorldSignature(ctx, [armed, plain])).not.toBe(before);
    expect(threatSummaryText(threatsOnTile(ctx, 4, 0))).toBe('2 foes can reach');
  });

  it("the scene's threat view asks the enemy's own arts: usable, then spent", () => {
    const scene = new BattleScene();
    scene.gameData = { weaponArts: { arts } };
    scene.turnManager = { turnNumber: 1 };
    const axe = weapon('Iron Axe');
    const brute = {
      name: 'Brute',
      faction: 'enemy',
      currentHP: 40,
      stats: { HP: 40 },
      weapon: axe,
      inventory: [axe],
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
    };
    const ctx = scene.threatContext();
    expect(ctx.areaArtOf(brute)).toBeNull();
    bindEnemyAreaArt(brute, CLEAVE, arts);
    expect(ctx.areaArtOf(brute)?.id).toBe(CLEAVE);
    // Its two uses this map spent, it is no longer a threat.
    brute._battleWeaponArtUsage = { map: { [CLEAVE]: 2 }, turn: {}, turnKey: null };
    expect(ctx.areaArtOf(brute)).toBeNull();
  });
});
