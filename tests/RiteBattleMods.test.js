// What the Rite's tier writes into a finale's map at generation (docs/specs/act-v-descent.md §4,
// §9.5; engine/RiteBattleMods.js, SeatedBoss.js, MapGenerator.js), so a resume, a rewind and the
// scout all read the same locked map. Every map here is generated twice from the same seed, with
// and without the tier, and compared. Ways this breaks:
//   - a tier moves a stream (the map changes beyond its mods)
//   - Broken drops the wrong escort (not the two highest-level), or drops the boss or a target
//   - Answered's stone is lost, lands on the Entity, or its wave is missing, off-turn, raises par,
//     or stands on a wall, a spawn or off the map
//   - ANY tier, or a forged mod, reaches the Entity's HP, its stones, or anything but its splash
//     count and its waves (the hinge, the hum and the rally read only HP and the boss's identity)
import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { applyGenerationFields, generateSeededBattle } from '../src/engine/BattleScout.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { entitySplashCountFor } from '../src/engine/EntitySystem.js';
import { revivalStonesFor } from '../src/engine/RevivalStones.js';
import {
  buildReinforcementSpawnSpec,
  resolveBattleReinforcements,
} from '../src/engine/ReinforcementSpawns.js';
import { parRaiseForArrivals } from '../src/engine/ReinforcementScheduler.js';
import { ENTITY_SPLASH_COUNT, BASE_CLASS_LEVEL_CAP } from '../src/utils/constants.js';

const baseData = loadGameData();
const RITE = baseData.descent.rite;
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});

function descentRun(difficultyId, runSeed = 13) {
  const rm = new RunManager(descentData());
  rm.startRun({ runSeed, difficultyId, applyBlessingsAtStart: false });
  rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
  rm.advanceAct();
  return rm;
}

/**
 * The map `key` generates with the Rite at `words` (null: no Rite at all), as BattleScene builds
 * it at entry. `forge` replaces the params' riteMods (a forged mod past the run's sanitizing).
 */
function mapAt(difficultyId, key, words, { forge = undefined, runSeed = 13 } = {}) {
  const rm = descentRun(difficultyId, runSeed);
  if (words === null) rm.rite = null;
  else rm.rite = { ...rm.rite, words };
  const node = rm.nodeMap.nodes.find((n) => n.descentKey === key);
  const params = rm.getBattleParams(node);
  if (forge !== undefined) params.riteMods = forge;
  applyGenerationFields(params, { deployCount: 6, isBoss: node.type === 'boss' });
  return { config: generateSeededBattle(params, rm.gameData, params.battleSeed), params, rm };
}

/** Top-level keys whose values differ between two configs. */
function changedKeys(a, b) {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .sort();
}

const passable = (config, col, row) => {
  const tile = baseData.terrain[config.mapLayout?.[row]?.[col]];
  const cost = tile?.moveCost?.Infantry;
  return Boolean(tile) && cost !== '--' && !Number.isNaN(parseInt(cost, 10));
};
const riteWaves = (config) => (config.reinforcements?.scriptedWaves || []).filter((w) => w.rite);
const at = (band) => RITE.bands.find((b) => b.id === band).min;

describe('the Lieutenant (the gate on the Glass)', () => {
  it('a Spoken rite, or none, leaves his map exactly as it was', () => {
    const none = mapAt('hard', 'gate', null).config;
    expect(mapAt('hard', 'gate', at('spoken')).config).toEqual(none);
    expect(mapAt('hard', 'gate', 0, { forge: {} }).config.enemySpawns).toEqual(
      mapAt('hard', 'gate', null).config.enemySpawns,
    );
  });

  it('Broken: his escort loses its two highest-level members, and nothing else changes', () => {
    const none = mapAt('hard', 'gate', null).config;
    const broken = mapAt('hard', 'gate', at('broken')).config;
    const drop = RITE.mods.broken.lieutenant.escortDrop;
    // Expected, from the untouched map: the escort by level (highest first, the earlier on a tie).
    const dropped = none.enemySpawns
      .map((spawn, index) => ({ spawn, index }))
      .filter(({ spawn }) => !spawn.isBoss)
      .sort((a, b) => b.spawn.level - a.spawn.level || a.index - b.index)
      .slice(0, drop)
      .map((e) => e.spawn);
    expect(broken.enemySpawns).toEqual(none.enemySpawns.filter((s) => !dropped.includes(s)));
    expect(broken.enemySpawns.filter((s) => s.isBoss)).toHaveLength(1);
    expect(changedKeys(none, broken)).toEqual(['enemySpawns', 'riteMods']);
    expect(broken.riteMods).toEqual({ band: 'broken', target: 'lieutenant', escortDropped: drop });
  });

  it('Answered: one more Revival Stone and a par-neutral wave of Hollowed on turn 4', () => {
    const { config: none } = mapAt('hard', 'gate', null);
    const { config: answered, params } = mapAt('hard', 'gate', 20);
    const mods = RITE.mods.answered.lieutenant;
    const boss = (c) => c.enemySpawns.find((s) => s.isBoss);
    expect(boss(none).name).toBe('The Lieutenant');
    expect(boss(none).revivalStones || 0).toBe(
      revivalStonesFor(baseData.difficulty.modes.hard.revivalStones, 'lieutenant'),
    );
    expect(boss(answered).revivalStones).toBe((boss(none).revivalStones || 0) + mods.revivalStones);
    expect(changedKeys(none, answered)).toEqual(['enemySpawns', 'reinforcements', 'riteMods']);
    // The rest of the escort is untouched.
    expect(answered.enemySpawns.filter((s) => !s.isBoss)).toEqual(
      none.enemySpawns.filter((s) => !s.isBoss),
    );
    const [wave] = riteWaves(answered);
    expect(riteWaves(answered)).toHaveLength(1);
    expect(wave).toMatchObject({ turn: mods.waveTurn, parNeutral: true, xpMultiplier: 0.5 });
    expect(wave.spawns).toHaveLength(mods.waveHollowed);
    // Its level: the battle's adjusted range's middle plus the Rite's bonus, never past the cap.
    const lo = params.levelRange[0] + params.enemyLevelBonus;
    const hi = params.levelRange[1] + params.enemyLevelBonus;
    const bonus = Math.min(RITE.levelCap, Math.floor(20 / RITE.perWordLevel));
    const level = Math.min(BASE_CLASS_LEVEL_CAP, Math.floor((lo + hi) / 2) + bonus);
    const taken = new Set(
      [...answered.playerSpawns, ...answered.enemySpawns].map((s) => `${s.col},${s.row}`),
    );
    const tiles = new Set();
    for (const spawn of wave.spawns) {
      expect(spawn).toMatchObject({ className: 'Hollowed', level });
      expect(passable(answered, spawn.col, spawn.row), `${spawn.col},${spawn.row}`).toBe(true);
      expect(taken.has(`${spawn.col},${spawn.row}`)).toBe(false);
      tiles.add(`${spawn.col},${spawn.row}`);
    }
    expect(tiles.size).toBe(wave.spawns.length);
  });

  it('the finale on First Light reads the same tier (his stone comes on a rung with none)', () => {
    const { config } = mapAt('normal', 'lieutenant', 20);
    const boss = config.enemySpawns.find((s) => s.isBoss);
    expect(boss.name).toBe('The Lieutenant');
    expect(boss.revivalStones).toBe(RITE.mods.answered.lieutenant.revivalStones);
    expect(riteWaves(config)).toHaveLength(1);
  });

  it('the same params build the same map (a resume, a rewind and the scout agree)', () => {
    expect(mapAt('hard', 'gate', 20).config).toEqual(mapAt('hard', 'gate', 20).config);
    expect(mapAt('hard', 'gate', 1).config).toEqual(mapAt('hard', 'gate', 1).config);
  });
});

describe('the Entity: its splash and its waves, and nothing else, for every tier', () => {
  const none = () => mapAt('hard', 'entity', null).config;
  const entityOf = (config) => config.enemySpawns.find((s) => s.isEntity);
  /** The Entity as the battle builds it from a config (HP, stones, identity). */
  function entityUnit(config) {
    installSeed(99);
    try {
      const rm = descentRun('hard');
      const battle = new HeadlessBattle(
        rm.gameData,
        rm.getBattleParams(rm.nodeMap.nodes.at(-1)),
        rm.getRoster().slice(0, 4),
      );
      battle.init({ battleConfig: config });
      const entity = battle.enemyUnits.find((u) => u.isEntity);
      return {
        name: entity.name,
        className: entity.className,
        level: entity.level,
        maxHP: entity.stats.HP,
        currentHP: entity.currentHP,
        stones: entity.revivalStones ?? 0,
        stonesMax: entity.revivalStonesMax ?? 0,
      };
    } finally {
      restoreMathRandom();
    }
  }

  const cases = [
    ['broken', at('broken'), undefined],
    ['spoken', at('spoken'), undefined],
    ['answered', 20, undefined],
    // Forged past the run's own sanitizing: the writers still refuse what the Entity may not take.
    [
      'forged',
      20,
      {
        band: 'answered',
        target: 'entity',
        splashDelta: 1,
        waveHollowed: 2,
        revivalStones: 3,
        hp: 99,
        hpBonus: 40,
        hinge: 1,
        hum: 0,
        rally: 0,
        escortDrop: 4,
      },
    ],
    // A Lieutenant's mods aimed at the Entity's map do nothing there either.
    [
      'misaimed',
      20,
      { band: 'answered', target: 'lieutenant', revivalStones: 3, escortDrop: 2, waveHollowed: 2 },
    ],
  ];

  it.each(cases)(
    '%s: only the splash count, the waves and the record may change',
    (_, words, forge) => {
      const base = none();
      const { config } = mapAt('hard', 'entity', words, { forge });
      for (const key of changedKeys(base, config))
        expect(['entitySplashCount', 'reinforcements', 'riteMods'], key).toContain(key);
      // The reinforcements gain waves, nothing else.
      const { scriptedWaves: a = [], ...restA } = base.reinforcements;
      const { scriptedWaves: b = [], ...restB } = config.reinforcements;
      expect(restB).toEqual(restA);
      expect(b.slice(0, a.length)).toEqual(a);
      // The spawns, the Entity's first of all, are untouched: no stone, no other level or class.
      expect(config.enemySpawns).toEqual(base.enemySpawns);
      expect(entityOf(config).revivalStones).toBeUndefined();
      expect(entityUnit(config)).toEqual(entityUnit(base));
      expect(entityUnit(config).stones).toBe(0);
    },
  );

  it('the splash strikes one tile fewer on Broken, as written on Spoken, one more on Answered', () => {
    expect(entitySplashCountFor(none())).toBe(ENTITY_SPLASH_COUNT);
    const delta = (band) => RITE.mods[band]?.entity?.splashDelta || 0;
    expect(entitySplashCountFor(mapAt('hard', 'entity', at('broken')).config)).toBe(
      ENTITY_SPLASH_COUNT + delta('broken'),
    );
    expect(mapAt('hard', 'entity', at('spoken')).config).not.toHaveProperty('entitySplashCount');
    expect(entitySplashCountFor(mapAt('hard', 'entity', 20).config)).toBe(
      ENTITY_SPLASH_COUNT + delta('answered'),
    );
  });

  it('Answered: two Hollowed beside every template wave, on its turn, at its edges', () => {
    const { config } = mapAt('hard', 'entity', 20);
    const template = config.reinforcements.waves;
    const waves = riteWaves(config);
    expect(template.length).toBeGreaterThan(0);
    expect(waves.map((w) => w.turn)).toEqual(template.map((w) => w.turn));
    const onEdge = (edge, s) =>
      ({
        left: s.col === 0,
        right: s.col === config.cols - 1,
        top: s.row === 0,
        bottom: s.row === config.rows - 1,
      })[edge];
    waves.forEach((wave, i) => {
      const edges = template[i].edges || config.reinforcements.spawnEdges;
      expect(wave).toMatchObject({ parNeutral: true, xpMultiplier: 0.5 });
      expect(wave.spawns).toHaveLength(RITE.mods.answered.entity.waveHollowed);
      for (const s of wave.spawns) {
        expect(s.className).toBe('Hollowed');
        expect(
          edges.some((edge) => onEdge(edge, s)),
          JSON.stringify(s),
        ).toBe(true);
        expect(passable(config, s.col, s.row)).toBe(true);
      }
    });
  });
});

describe('a Rite wave arrives as Hollowed and never raises par', () => {
  it('the scheduler and the spawn spec keep the class, and the arrivals are par-neutral', () => {
    const { config, params } = mapAt('hard', 'entity', 20);
    const wave = riteWaves(config)[0];
    const plain = { ...wave, parNeutral: undefined, rite: undefined };
    const resolve = (battleConfig) =>
      resolveBattleReinforcements({
        turn: wave.turn,
        seed: 7,
        battleConfig,
        battleParams: params,
        gameData: baseData,
        templates: [{ className: 'Hero', level: 10 }],
        playerUnits: [],
        enemyUnits: [],
      });
    const only = (w) => ({
      ...config,
      reinforcements: { scriptedWaves: [w] },
    });
    const arrivals = resolve(only(wave)).spawns;
    expect(arrivals).toHaveLength(wave.spawns.length);
    expect(arrivals.every((s) => s.parNeutral === true)).toBe(true);
    expect(parRaiseForArrivals(arrivals)).toBe(0);
    // Control: the same wave without the mark raises par by one.
    expect(parRaiseForArrivals(resolve(only(plain)).spawns)).toBe(1);
    const spec = buildReinforcementSpawnSpec({
      scheduledSpawn: arrivals[0],
      battleConfig: config,
      battleParams: params,
      gameData: baseData,
      templates: [{ className: 'Hero', level: 10 }],
    });
    expect(spec).toMatchObject({ className: 'Hollowed', level: wave.spawns[0].level });
  });
});
