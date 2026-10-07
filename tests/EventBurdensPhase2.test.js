// Phase 2B burdens (docs/specs/event-nodes-phase2.md §2B): Hunted, Sworn Enemy and Wounded.
//
// Ways this goes wrong:
//   Hunted   - the wave lands on a boss map; it is written with a draw from Math.random (the
//              map shifts); it is not in the locked config (a resume loses it); it counts down on
//              a battle that never had it, on a boss victory, on a revert or a reload; it raises
//              par (so it costs nothing); it moves the other waves of its turn;
//   Sworn    - the affix is not seeded, ignores the rung's exclusions or the class and mutual
//              rules, lands on a non-boss or on the Entity, or the burden outlives the boss;
//   Wounded  - the debuff is not in the stats a forecast reads, hits the wrong unit (names are
//              display text), is not undone with the battle, ticks only when the unit fights,
//              survives its unit's fall, or a church Heal all leaves it;
//   all      - a revert, a resume or a reload changes a burden before a victory commits.
// Numbers by hand; planted bugs are listed in the report of this change.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addBurden,
  battleDebuffsFor,
  burdenEffectsOnVictory,
  describeBurdens,
  huntedWaveFor,
  normalizeBurdens,
  pruneGoneWounds,
  settlementLines,
} from '../src/engine/Burdens.js';
import { enemySideEdge, isHuntedBattle, withHuntedWave } from '../src/engine/HuntedWave.js';
import {
  createSeededRng,
  parRaiseForArrivals,
  scheduleReinforcementsForTurn,
} from '../src/engine/ReinforcementScheduler.js';
import { assignSwornAffix } from '../src/engine/AffixEngine.js';
import {
  applyBattleStartDebuffs,
  clearBattleScopedDeltas,
} from '../src/engine/BattleStatDeltas.js';
import { eclipseHash } from '../src/engine/EclipseSystem.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { getCombatForecast } from '../src/engine/Combat.js';
import { createLordUnit, createUnit } from '../src/engine/UnitManager.js';
import { healRosterAtChurch } from '../src/engine/ChurchCommands.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { RunManager } from '../src/engine/RunManager.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadFixture } from './fixtures/battles/index.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { addUnit, arriveAs, baseData, newRun, runWithEvents, soloEvent } from './eventKit.js';

afterEach(() => {
  vi.restoreAllMocks();
  restoreMathRandom();
});

const WAVE = { turn: 3, count: [2, 2], xpMultiplier: 0.5 };
const HUNTED = { id: 'hunted', battles: 2, wave: WAVE };
const roundTrip = (run) =>
  RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);

const battleNodes = (run) => run.nodeMap.nodes.filter((n) => n.type === 'battle' && !n.completed);
const bossNode = (run) => run.nodeMap.nodes.find((n) => n.type === 'boss');
const win = (run, node) =>
  run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 1, turnPar: 10 });
const lockWithHunted = (run, node) =>
  run.lockBattleConfig(node.id, {
    cols: 8,
    rows: 8,
    objective: 'rout',
    reinforcements: { hunted: { ...WAVE, edges: ['right'] } },
  });

describe('the burden records', () => {
  it('resolve their numbers for the rung when taken, and never stack', () => {
    const normal = newRun({ difficulty: 'normal' });
    expect(addBurden(normal, 'hunted').burden).toEqual({
      id: 'hunted',
      battles: 2,
      wave: { turn: 3, count: [1, 2], xpMultiplier: 0.5 },
    });
    const hard = newRun({ difficulty: 'hard' });
    expect(addBurden(hard, 'hunted').burden.wave.count).toEqual([2, 2]);
    const lunatic = newRun({ difficulty: 'lunatic' });
    expect(addBurden(lunatic, 'hunted').burden.wave.count).toEqual([2, 3]);
    // Again: the battles refresh, the larger wave stays, one record.
    addBurden(lunatic, 'hunted', { battles: 5, wave: { count: [1, 1] } });
    expect(lunatic.burdens).toEqual([
      { id: 'hunted', battles: 5, wave: { turn: 3, count: [2, 3], xpMultiplier: 0.5 } },
    ]);
    addBurden(lunatic, 'sworn_enemy');
    addBurden(lunatic, 'sworn_enemy');
    expect(lunatic.burdens.filter((b) => b.id === 'sworn_enemy')).toHaveLength(1);
  });

  it('a wound needs a unit and a stat, never HP, and a new wound replaces the old one', () => {
    const run = newRun();
    expect(addBurden(run, 'wounded', { stat: 'STR' }).ok).toBe(false);
    expect(addBurden(run, 'wounded', { unitUid: 'ru1', stat: 'HP' }).ok).toBe(false);
    const first = addBurden(run, 'wounded', { unitUid: 'ru1', unitName: 'Edric', stat: 'STR' });
    expect(first.burden).toEqual({
      id: 'wounded',
      unitUid: 'ru1',
      unitName: 'Edric',
      stat: 'STR',
      value: -2,
      battles: 2, // First Light is gentler: 2 battles (3 above it)
    });
    addBurden(run, 'wounded', { unitUid: 'ru2', stat: 'SPD', value: -9 });
    expect(run.burdens).toHaveLength(1);
    expect(run.burdens[0]).toMatchObject({ unitUid: 'ru2', stat: 'SPD', value: -5 });
  });

  it('sanitize a save: spent, malformed and unknown records go, ranges are clamped', () => {
    expect(
      normalizeBurdens([
        { id: 'hunted', battles: 0, wave: WAVE },
        { id: 'hunted', battles: 2, wave: { turn: 99, count: [9, 1], xpMultiplier: 7 } },
        { id: 'wounded', unitUid: 'ru1', stat: 'HP', battles: 2 },
        { id: 'wounded', stat: 'STR', battles: 2 },
        { id: 'wounded', unitUid: 'ru1', stat: 'STR', value: 4, battles: 2 },
        { id: 'sworn_enemy', junk: 1 },
        { id: 'sworn_enemy' },
      ]),
    ).toEqual([
      { id: 'hunted', battles: 2, wave: { turn: 12, count: [6, 6], xpMultiplier: 0.5 } },
      { id: 'wounded', unitUid: 'ru1', unitName: '', stat: 'STR', value: -4, battles: 2 },
      { id: 'sworn_enemy' },
    ]);
  });

  it('are described for the chips and the victory band', () => {
    const run = newRun();
    const unit = addUnit(run, 'Archer', { name: 'Hale' });
    run.burdens = [
      HUNTED,
      { id: 'sworn_enemy' },
      {
        id: 'wounded',
        unitUid: unit.unitUid,
        unitName: 'Hale',
        stat: 'SKL',
        value: -2,
        battles: 1,
      },
    ];
    const chips = describeBurdens(run);
    expect(chips.map((c) => [c.label, c.short])).toEqual([
      ['Hunted', '2 left'],
      ['Sworn Enemy', 'Boss'],
      ['Wounded', 'Hale −2 SKL'],
    ]);
    expect(chips[0].detail).toBe(
      '2 battles left: an extra wave of 2 foes on turn 3, boss maps spared',
    );
    expect(chips[2].detail).toBe('Hale fights at −2 SKL, 1 battle left; a church heal ends it');
    expect(chips.every((c) => c.line.length > 0)).toBe(true);
    expect(
      settlementLines({
        hunted: { remaining: 0, ended: true },
        sworn: { ended: true },
        wounded: { name: 'Hale', ended: true },
      }),
    ).toEqual(['Hunted (passed)', 'Sworn Enemy falls', "Hale's wound mends"]);
    expect(settlementLines({ hunted: { remaining: 1, ended: false } })).toEqual([]);
  });
});

describe('Hunted: the wave in the battle config', () => {
  it('rides getBattleParams for a battle, never for a boss, and is absent when not hunted', () => {
    const run = newRun();
    const node = battleNodes(run)[0];
    expect('huntedWave' in run.getBattleParams(node)).toBe(false);
    run.burdens = [HUNTED];
    expect(run.getBattleParams(node).huntedWave).toEqual(WAVE);
    expect('huntedWave' in run.getBattleParams(bossNode(run))).toBe(false);
    expect(huntedWaveFor(run, { isBoss: true })).toBeNull();
  });

  it('the enemy side of the map is where it comes from, unless the map names an edge', () => {
    const map = {
      cols: 10,
      rows: 8,
      playerSpawns: [
        { col: 0, row: 3 },
        { col: 0, row: 4 },
      ],
      enemySpawns: [
        { col: 9, row: 3 },
        { col: 9, row: 4 },
      ],
    };
    // Right mid (9, 3.5): 9 from the army, 0 from the enemy = +9; left is -9; top and bottom 0.
    expect(enemySideEdge(map)).toBe('right');
    expect(
      enemySideEdge({
        ...map,
        enemySpawns: [{ col: 0, row: 7 }],
        playerSpawns: [{ col: 9, row: 0 }],
      }),
    ).toBe('left');
    expect(withHuntedWave(undefined, WAVE, map).hunted).toEqual({ ...WAVE, edges: ['right'] });
    expect(withHuntedWave({ spawnEdges: ['top', 'bottom'] }, WAVE, map).hunted.edges).toEqual([
      'top',
      'bottom',
    ]);
    expect(withHuntedWave({ ladder: { front: 'left' } }, WAVE, map).hunted.edges).toEqual(['left']);
    // The input block is untouched and its other waves stay.
    const block = { spawnEdges: ['top'], waves: [{ turn: 5, count: [1, 1] }] };
    const out = withHuntedWave(block, WAVE, map);
    expect(block.hunted).toBeUndefined();
    expect(out.waves).toEqual(block.waves);
  });

  it('is written by the generator without touching Math.random, and never on a boss map', () => {
    const make = (extra, seed = 5) => {
      installSeed(seed);
      const config = generateBattle(
        { act: 'act2', objective: 'rout', deployCount: 4, difficultyId: 'normal', ...extra },
        baseData,
      );
      return { config, cursor: Math.random() };
    };
    for (const seed of [1, 2, 3, 4]) {
      const plain = make({}, seed);
      const hunted = make({ huntedWave: WAVE }, seed);
      expect(isHuntedBattle(hunted.config)).toBe(true);
      expect(hunted.config.reinforcements.hunted).toMatchObject({ turn: 3, count: [2, 2] });
      expect(['left', 'right', 'top', 'bottom']).toContain(
        hunted.config.reinforcements.hunted.edges[0],
      );
      // Same map, same units, same next draw: the wave is the only difference.
      expect(hunted.cursor).toBe(plain.cursor);
      const rest = structuredClone(hunted.config);
      delete rest.reinforcements.hunted;
      if (Object.keys(rest.reinforcements).length === 0) delete rest.reinforcements;
      expect(rest).toEqual(plain.config);
      const boss = make({ huntedWave: WAVE, isBoss: true, objective: 'seize' }, seed);
      expect(isHuntedBattle(boss.config)).toBe(false);
    }
  });

  it('arrives on its turn at its edge, two foes, half rewards, and does not raise par', () => {
    const terrain = [{ name: 'Plain', moveCost: { Infantry: '1' } }];
    const mapLayout = Array.from({ length: 6 }, () => Array(6).fill(0));
    const call = (turn, reinforcements, seed = 11) =>
      scheduleReinforcementsForTurn({ turn, seed, reinforcements, mapLayout, terrain });
    const hunted = { ...WAVE, edges: ['right'] };
    expect(call(2, { hunted }).spawns).toEqual([]);
    expect(call(4, { hunted }).spawns).toEqual([]);
    const result = call(3, { hunted });
    expect(result.spawns).toHaveLength(2);
    for (const spawn of result.spawns) {
      expect(spawn).toMatchObject({ waveType: 'hunted', edge: 'right', col: 5, xpMultiplier: 0.5 });
    }
    expect(new Set(result.spawns.map((s) => s.row)).size).toBe(2);
    expect(parRaiseForArrivals(result.spawns)).toBe(0);
    expect(call(3, { hunted }, 11).spawns).toEqual(result.spawns);
  });

  it("comes after the turn's other waves: they draw exactly as without it", () => {
    const terrain = [{ name: 'Plain', moveCost: { Infantry: '1' } }];
    const mapLayout = Array.from({ length: 8 }, () => Array(8).fill(0));
    const procedural = { spawnEdges: ['left'], waves: [{ turn: 3, count: [2, 2] }] };
    const run = (extra) =>
      scheduleReinforcementsForTurn({
        turn: 3,
        seed: 21,
        reinforcements: { ...procedural, ...extra },
        mapLayout,
        terrain,
      });
    const plain = run({});
    const both = run({ hunted: { ...WAVE, edges: ['right'] } });
    expect(both.spawns.filter((s) => s.waveType !== 'hunted')).toEqual(plain.spawns);
    expect(both.spawns.filter((s) => s.waveType === 'hunted')).toHaveLength(2);
    // Procedural waves still raise par (+1); the hunted ones add nothing.
    expect(parRaiseForArrivals(both.spawns)).toBe(1);
  });
});

describe('Hunted: counted down at the victory commit only', () => {
  it('a battle that carried the wave counts one; one that did not, and a boss, do not', () => {
    const run = newRun();
    run.burdens = [{ ...HUNTED, battles: 2 }];
    const [a, b, c] = battleNodes(run);
    lockWithHunted(run, a);
    run.lockBattleConfig(b.id, { cols: 8, rows: 8, objective: 'rout' }); // locked without it
    lockWithHunted(run, c);
    win(run, a);
    expect(run.burdens).toEqual([{ ...HUNTED, battles: 1 }]);
    expect(run.lastBurdenSettlement.hunted).toEqual({ remaining: 1, ended: false });
    win(run, b);
    expect(run.burdens).toEqual([{ ...HUNTED, battles: 1 }]);
    win(run, bossNode(run));
    expect(run.burdens).toEqual([{ ...HUNTED, battles: 1 }]);
    win(run, c);
    expect(run.burdens).toEqual([]);
    expect(run.lastBurdenSettlement.hunted).toEqual({ remaining: 0, ended: true });
  });

  it('without a locked map (the sims) every non-boss victory counts', () => {
    const run = newRun();
    run.burdens = [{ ...HUNTED, battles: 1 }];
    win(run, battleNodes(run)[0]);
    expect(run.burdens).toEqual([]);
  });

  it('a revert leaves it as it was, the locked wave stays, and a reload keeps both', () => {
    const run = newRun();
    run.burdens = [HUNTED];
    const node = battleNodes(run)[0];
    lockWithHunted(run, node);
    run.beginBattleInProgress(node.id, { battleParams: run.getBattleParams(node) });
    run.setBattleCheckpoint({ turn: 4 });
    expect(run.revertBattleInProgressToEntry()).toBe(true);
    expect(run.burdens).toEqual([HUNTED]);
    expect(isHuntedBattle(run.getLockedBattleConfig(node.id))).toBe(true);
    const loaded = roundTrip(run);
    expect(loaded.burdens).toEqual([HUNTED]);
    expect(isHuntedBattle(loaded.getLockedBattleConfig(node.id))).toBe(true);
    win(loaded, node);
    expect(loaded.burdens).toEqual([{ ...HUNTED, battles: 1 }]);
  });

  it('burdenEffectsOnVictory is told what the battle was, and mutates nothing', () => {
    const run = newRun();
    run.burdens = [HUNTED, { id: 'sworn_enemy' }];
    const before = structuredClone(run.burdens);
    expect(burdenEffectsOnVictory(run, { battle: {} }).burdens).toEqual(before);
    expect(burdenEffectsOnVictory(run, { battle: { hunted: true } }).burdens).toEqual([
      { ...HUNTED, battles: 1 },
      { id: 'sworn_enemy' },
    ]);
    expect(burdenEffectsOnVictory(run, { battle: { boss: true } }).burdens).toEqual([HUNTED]);
    expect(run.burdens).toEqual(before);
    // Nothing to settle: no record at all.
    expect(burdenEffectsOnVictory(run, { battle: {} }).record).toBeNull();
  });
});

describe('Sworn Enemy', () => {
  const config = {
    affixes: [
      { id: 'a', tier: 1, weight: 1 },
      { id: 'b', tier: 1, weight: 1 },
      { id: 'c', tier: 2, weight: 1 },
      { id: 'd', tier: 1, weight: 1 },
      { id: 'e', tier: 1, weight: 1 },
    ],
    config: {
      difficultyGating: { normal: { excludedAffixes: ['e'] } },
      exclusions: [
        { rule: 'mutually_exclusive', affixes: ['a', 'b'] },
        { rule: 'class_exclude', affix: 'd', classes: ['General'] },
      ],
    },
  };
  const spawns = (boss) => [
    { className: 'Soldier', level: 3 },
    { className: 'General', level: 9, isBoss: true, ...boss },
  ];

  it('picks one tier-1 affix the rules allow, by weight from the seeded stream', () => {
    // General: d is class-excluded, c is tier 2, e is the rung's: the pool is [a, b].
    const first = assignSwornAffix(spawns(), { affixConfig: config, random: () => 0 });
    expect(first[1].affixes).toEqual(['a']);
    const second = assignSwornAffix(spawns(), { affixConfig: config, random: () => 0.99 });
    expect(second[1].affixes).toEqual(['b']);
    // The soldier is untouched; the input list is not mutated.
    expect(first[0]).toEqual({ className: 'Soldier', level: 3 });
    expect(spawns()[1].affixes).toBeUndefined();
    // A boss already carrying a leaves nothing: b is mutually exclusive with it.
    const carrying = spawns({ affixes: ['a'] });
    expect(assignSwornAffix(carrying, { affixConfig: config, random: () => 0 })).toEqual(carrying);
  });

  it('never reads Math.random, leaves the Entity and a bossless field alone', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random was read');
    });
    expect(() =>
      assignSwornAffix(spawns(), { affixConfig: config, random: () => 0.3 }),
    ).not.toThrow();
    expect(() => assignSwornAffix(spawns(), { affixConfig: config })).toThrow(/seeded/);
    const entity = spawns({ isEntity: true });
    expect(assignSwornAffix(entity, { affixConfig: config, random: () => 0 })).toEqual(entity);
    const none = [{ className: 'Soldier' }];
    expect(assignSwornAffix(none, { affixConfig: config, random: () => 0 })).toEqual(none);
  });

  it("with the real data: tier 1 only, the rung's exclusions and a class's hold, over many draws", () => {
    const tierOne = new Set(baseData.affixes.affixes.filter((a) => a.tier === 1).map((a) => a.id));
    const seen = { normal: new Set(), lunatic: new Set() };
    for (let seed = 1; seed <= 150; seed++) {
      const random = createSeededRng(seed * 7919);
      for (const difficultyId of ['normal', 'lunatic']) {
        const [, boss] = assignSwornAffix(
          [{ className: 'x' }, { className: 'Cavalier', isBoss: true }],
          { affixConfig: baseData.affixes, difficultyId, random },
        );
        expect(boss.affixes).toHaveLength(1);
        seen[difficultyId].add(boss.affixes[0]);
      }
    }
    for (const id of [...seen.normal, ...seen.lunatic]) expect(tierOne.has(id)).toBe(true);
    // Normal excludes haste, teleporter and deathburst; a Cavalier is never hasted at all.
    expect(seen.normal.has('haste')).toBe(false);
    expect(seen.lunatic.has('haste')).toBe(false);
    expect(seen.normal.size).toBeGreaterThan(3);
  });

  it('rides getBattleParams for the boss only, seeded by run and node', () => {
    const run = newRun({ seed: 55 });
    run.burdens = [{ id: 'sworn_enemy' }];
    const boss = bossNode(run);
    expect(run.getBattleParams(boss).swornEnemy).toEqual({
      seed: eclipseHash(`sworn:55:${boss.id}`),
    });
    expect('swornEnemy' in run.getBattleParams(battleNodes(run)[0])).toBe(false);
    run.burdens = [];
    expect('swornEnemy' in run.getBattleParams(boss)).toBe(false);
  });

  it('the generated boss carries one affix, the same each time, and nothing else moves', () => {
    const make = (extra, seed) => {
      installSeed(seed);
      const run = newRun({ seed: 55 });
      const params = {
        ...run.getBattleParams(bossNode(run)),
        isBoss: true,
        deployCount: 4,
        ...extra,
      };
      const config = generateBattle(params, baseData);
      return { config, cursor: Math.random() };
    };
    for (const seed of [3, 4, 5]) {
      const plain = make({}, seed);
      const sworn = make({ swornEnemy: { seed: 12345 } }, seed);
      const again = make({ swornEnemy: { seed: 12345 } }, seed);
      const boss = (r) => r.config.enemySpawns.find((s) => s.isBoss);
      expect(boss(sworn).affixes).toHaveLength(1);
      expect(boss(sworn).affixes).toEqual(boss(again).affixes);
      expect(sworn.cursor).toBe(plain.cursor);
      const stripped = structuredClone(sworn.config);
      delete stripped.enemySpawns.find((s) => s.isBoss).affixes;
      const original = structuredClone(plain.config);
      delete original.enemySpawns.find((s) => s.isBoss)?.affixes;
      expect(stripped).toEqual(original);
    }
  });

  it("ends at the act boss's victory and at no other", () => {
    const run = newRun();
    run.burdens = [{ id: 'sworn_enemy' }];
    win(run, battleNodes(run)[0]);
    expect(run.burdens).toEqual([{ id: 'sworn_enemy' }]);
    win(run, bossNode(run));
    expect(run.burdens).toEqual([]);
    expect(run.lastBurdenSettlement.sworn).toEqual({ ended: true });
  });

  it('a revert and a reload leave it standing', () => {
    const run = newRun();
    run.burdens = [{ id: 'sworn_enemy' }];
    const boss = bossNode(run);
    run.beginBattleInProgress(boss.id, { battleParams: run.getBattleParams(boss), isBoss: true });
    run.setBattleCheckpoint({ turn: 2 });
    expect(run.revertBattleInProgressToEntry()).toBe(true);
    expect(roundTrip(run).burdens).toEqual([{ id: 'sworn_enemy' }]);
  });
});

describe('Wounded', () => {
  function woundedRun(overrides = {}) {
    const run = newRun();
    const unit = addUnit(run, 'Myrmidon', { name: 'Hale', level: 3 });
    run.burdens = [
      {
        id: 'wounded',
        unitUid: unit.unitUid,
        unitName: 'Hale',
        stat: 'STR',
        value: -2,
        battles: 3,
        ...overrides,
      },
    ];
    return { run, unit };
  }

  it('is a battle debuff in the params, for the one unit by uid', () => {
    const { run, unit } = woundedRun();
    const node = battleNodes(run)[0];
    expect(run.getBattleParams(node).battleDebuffs).toEqual([
      { unitUid: unit.unitUid, stat: 'STR', value: -2, source: 'wounded' },
    ]);
    run.burdens = [];
    expect('battleDebuffs' in run.getBattleParams(node)).toBe(false);
    expect(battleDebuffsFor(run)).toEqual([]);
  });

  it('lands on the unit with that uid (not its namesake), and a forecast sees it', () => {
    const run = newRun();
    const classData = baseData.classes.find((c) => c.name === 'Myrmidon');
    const sword = baseData.weapons.find((w) => w.name === 'Iron Sword');
    const make = (uid) => {
      const unit = createUnit(classData, 3, baseData.weapons, { name: 'Hale' });
      unit.unitUid = uid;
      unit.weapon = sword;
      return unit;
    };
    const wounded = make('ru7');
    const namesake = structuredClone(wounded);
    namesake.unitUid = 'ru8';
    const foe = make('ru9');
    const damage = (u) => getCombatForecast(u, sword, foe, sword, 1, null, null).attacker.damage;
    const before = damage(wounded);
    const strBefore = wounded.stats.STR;
    const landed = applyBattleStartDebuffs(
      [namesake, wounded],
      [{ unitUid: 'ru7', stat: 'STR', value: -2, source: 'wounded' }],
    );
    expect(landed).toHaveLength(1);
    expect(landed[0]).toMatchObject({ stat: 'STR', applied: -2, source: 'wounded' });
    expect(wounded.stats.STR).toBe(strBefore - 2);
    expect(namesake.stats.STR).toBe(strBefore);
    // Same sword, same foe: two points of Strength are two points of damage.
    expect(damage(wounded)).toBe(before - 2);
    expect(damage(namesake)).toBe(before);
    // A unit not on the field takes nothing, and the battle's end takes it back exactly.
    expect(
      applyBattleStartDebuffs([namesake], [{ unitUid: 'ru7', stat: 'STR', value: -2 }]),
    ).toEqual([]);
    clearBattleScopedDeltas([wounded]);
    expect(wounded.stats.STR).toBe(strBefore);
    expect(wounded._battleDeltas).toBeUndefined();
    void run;
  });

  it('the floor clamps and is undone exactly', () => {
    const unit = { unitUid: 'ru1', stats: { STR: 1, MOV: 5 } };
    applyBattleStartDebuffs([unit], [{ unitUid: 'ru1', stat: 'STR', value: -2 }]);
    expect(unit.stats.STR).toBe(0);
    expect(unit._battleDeltas.STR).toBe(-1);
    clearBattleScopedDeltas([unit]);
    expect(unit.stats.STR).toBe(1);
  });

  it('the headless harness sees it too', () => {
    const fixture = loadFixture('act1_village_race');
    const lord = baseData.lords.find((l) => l.name === 'Edric');
    const classData = baseData.classes.find((c) => c.name === lord.class);
    const edric = createLordUnit(lord, classData, baseData.weapons);
    edric.unitUid = 'ru1';
    const strBefore = edric.stats.STR;
    installSeed(9);
    const battle = new HeadlessBattle(
      baseData,
      {
        ...fixture.battleParams,
        battleDebuffs: [{ unitUid: 'ru1', stat: 'STR', value: -2, source: 'wounded' }],
      },
      [edric],
    );
    battle.init();
    const fielded = battle.playerUnits.find((u) => u.unitUid === 'ru1');
    expect(fielded.stats.STR).toBe(strBefore - 2);
    // A battle with no wound starts every unit whole.
    installSeed(9);
    const plain = new HeadlessBattle(baseData, { ...fixture.battleParams }, [
      createLordUnit(lord, classData, baseData.weapons),
    ]);
    plain.init();
    expect(plain.playerUnits[0].stats.STR).toBe(strBefore);
  });

  it('counts down on every victory, deployed or not, and mends at zero', () => {
    const { run } = woundedRun({ battles: 2 });
    const [a, b] = battleNodes(run);
    win(run, a);
    expect(run.burdens[0].battles).toBe(1);
    expect(run.lastBurdenSettlement.wounded).toMatchObject({ name: 'Hale', remaining: 1 });
    win(run, b);
    expect(run.burdens).toEqual([]);
    expect(run.lastBurdenSettlement.wounded.ended).toBe(true);
    expect(settlementLines(run.lastBurdenSettlement)).toContain("Hale's wound mends");
  });

  it('a revert and a reload leave the count where it was', () => {
    const { run } = woundedRun();
    const node = battleNodes(run)[0];
    run.beginBattleInProgress(node.id, { battleParams: run.getBattleParams(node) });
    run.setBattleCheckpoint({ turn: 3 });
    expect(run.revertBattleInProgressToEntry()).toBe(true);
    expect(run.burdens[0].battles).toBe(3);
    expect(roundTrip(run).burdens).toEqual(run.burdens);
  });

  it('ends with its unit: fallen in the battle, or gone from the roster', () => {
    const { run, unit } = woundedRun();
    const survivors = run.getRoster().filter((u) => u.unitUid !== unit.unitUid);
    run.completeBattle(survivors, battleNodes(run)[0].id, 100, { turnCount: 1, turnPar: 10 });
    expect(run.burdens).toEqual([]);
    expect(
      pruneGoneWounds(
        [{ id: 'wounded', unitUid: 'ru99', stat: 'STR', value: -2, battles: 2 }],
        run.roster,
      ),
    ).toEqual([]);
  });

  it('a church Heal all ends it, healing anyone else does not need to', () => {
    const { run } = woundedRun();
    run.roster[0].currentHP = 1;
    const result = healRosterAtChurch(run);
    expect(result.message).toBe("All units healed. Hale's wound mends.");
    expect(run.burdens).toEqual([]);
    expect(run.roster.every((u) => u.currentHP === u.stats.HP)).toBe(true);
    // Nothing wounded: the plain message.
    expect(healRosterAtChurch(run).message).toBe('All units healed.');
  });
});

describe('the burden effect of an event', () => {
  const wound = (params, choice = {}) =>
    soloEvent([{ type: 'burden', id: 'wounded', params }], { choice });

  it('wounds the chosen unit, with the stat named', () => {
    const run = runWithEvents([
      wound({ scope: 'target', stat: 'DEF' }, { target: { prompt: 'Who?' } }),
    ]);
    const unit = addUnit(run, 'Fighter', { name: 'Bram' });
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go', { targetUid: unit.unitUid });
    expect(result.ok, result.reason).toBe(true);
    expect(run.burdens).toEqual([
      {
        id: 'wounded',
        unitUid: unit.unitUid,
        unitName: 'Bram',
        stat: 'DEF',
        value: -2,
        battles: 2,
      },
    ]);
    expect(result.results[0]).toMatchObject({ kind: 'burden', id: 'wounded', label: 'Wounded' });
    expect(result.results[0].detail).toBe(
      'Bram fights at −2 DEF, 2 battles left; a church heal ends it',
    );
  });

  it('a seeded unit and stat are the same on every run of the seed, and vary across seeds', () => {
    const pick = (seed) => {
      const run = runWithEvents([wound({ scope: 'randomUnit', stat: 'random' })], { seed });
      addUnit(run, 'Fighter', { name: 'Bram' });
      addUnit(run, 'Archer', { name: 'Hale' });
      const node = arriveAs(run, 'solo');
      expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
      return run.burdens[0];
    };
    const seeds = Array.from({ length: 24 }, (_, i) => i + 1);
    const picks = seeds.map(pick);
    expect(seeds.map(pick)).toEqual(picks);
    expect(new Set(picks.map((p) => p.stat)).size).toBeGreaterThan(2);
    expect(new Set(picks.map((p) => p.unitUid)).size).toBeGreaterThan(2);
  });

  it("attack names the unit's own attack stat", () => {
    const run = runWithEvents([
      wound({ scope: 'target', stat: 'attack' }, { target: { prompt: 'Who?' } }),
    ]);
    const mage = addUnit(run, 'Mage', { name: 'Ione' });
    const node = arriveAs(run, 'solo');
    expect(chooseEventOption(run, node.id, 'go', { targetUid: mage.unitUid }).ok).toBe(true);
    expect(run.burdens[0].stat).toBe('MAG');
  });

  it("Hunted and Sworn Enemy are taken with their rung's numbers", () => {
    const run = runWithEvents(
      [
        soloEvent([
          { type: 'burden', id: 'hunted' },
          { type: 'burden', id: 'sworn_enemy' },
        ]),
      ],
      { difficulty: 'hard' },
    );
    const node = arriveAs(run, 'solo');
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
    expect(run.burdens).toEqual([
      { id: 'hunted', battles: 2, wave: { turn: 3, count: [2, 2], xpMultiplier: 0.5 } },
      { id: 'sworn_enemy' },
    ]);
  });
});

describe('saves', () => {
  /** The run as a pre-2B build wrote it: literal burden, vow and event records. */
  function preTwoB() {
    const saved = JSON.parse(JSON.stringify(newRun({ seed: 7 }).toJSON()));
    saved.burdens = [
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
      { id: 'debt', owed: 120, garnish: 0.25 },
    ];
    saved.churchVowByNodeId = { act1_3_1: 'promote', act1_4_0: 'blessing' };
    saved.eventStateByNodeId = {
      act1_2_1: {
        eventId: 'twin_altar',
        arrivedAct: 'act1',
        choiceId: 'dawn',
        outcomeId: 'answered',
        text: 'Warmth on the back of the neck, like a hand.',
        results: [{ kind: 'blessing', id: 'steady_hands' }],
        victoryResults: [],
        battle: null,
        afterVictory: [],
        left: true,
      },
    };
    return saved;
  }

  it('a record written before 2B loads exactly as it was written', () => {
    const loaded = RunManager.fromJSON(preTwoB(), baseData);
    expect(loaded.burdens).toEqual([
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
      { id: 'debt', owed: 120, garnish: 0.25 },
    ]);
    expect(loaded.churchVowByNodeId).toEqual({ act1_3_1: 'promote', act1_4_0: 'blessing' });
    const state = loaded.eventStateByNodeId.act1_2_1;
    expect(state).toMatchObject({ eventId: 'twin_altar', choiceId: 'dawn', left: true });
    expect(state.dark).toBeUndefined();
    // And saving it again writes the same fields back.
    const again = JSON.parse(JSON.stringify(loaded.toJSON()));
    expect(again.burdens).toEqual(preTwoB().burdens);
    expect(again.churchVowByNodeId).toEqual(preTwoB().churchVowByNodeId);
    expect(again.eventStateByNodeId).toEqual(preTwoB().eventStateByNodeId);
  });

  it('the new burdens, the cleanse vow and a dark state round trip', () => {
    const saved = preTwoB();
    saved.burdens = [
      { id: 'hunted', battles: 1, wave: { turn: 3, count: [1, 2], xpMultiplier: 0.5 } },
      { id: 'sworn_enemy' },
      { id: 'wounded', unitUid: 'ru2', unitName: 'Hale', stat: 'SKL', value: -2, battles: 3 },
    ];
    saved.churchVowByNodeId = { act1_3_1: 'cleanse' };
    saved.eventStateByNodeId.act1_2_1.dark = true;
    const loaded = RunManager.fromJSON(saved, baseData);
    expect(loaded.burdens).toEqual(saved.burdens);
    expect(loaded.churchVowByNodeId).toEqual({ act1_3_1: 'cleanse' });
    expect(loaded.eventStateByNodeId.act1_2_1.dark).toBe(true);
    expect(JSON.parse(JSON.stringify(loaded.toJSON())).burdens).toEqual(saved.burdens);
  });

  it('malformed 2B records are dropped, not trusted', () => {
    const saved = preTwoB();
    saved.burdens = [
      { id: 'hunted', battles: 'many', wave: 'big' },
      { id: 'wounded', battles: 2 },
      { id: 'sworn_enemy' },
      { id: 'vanished' },
    ];
    saved.eventStateByNodeId.act1_2_1.dark = 'yes';
    const loaded = RunManager.fromJSON(saved, baseData);
    expect(loaded.burdens).toEqual([{ id: 'sworn_enemy' }]);
    expect(loaded.eventStateByNodeId.act1_2_1.dark).toBeUndefined();
  });
});
