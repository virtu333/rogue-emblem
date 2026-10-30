// Darkest Before Dawn (the survivors mode): the pure rules in src/engine/survivors.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { loadGameData } from './testData.js';
import {
  STEP,
  chooseOffer,
  createSurvivorsWorld,
  drainEvents,
  makeEnemy,
  offerCandidates,
  passiveLevel,
  stepWorld,
  timeLeft,
} from '../src/engine/survivors/SurvivorsSim.js';
import {
  buildFlowField,
  createField,
  flowStep,
  CELL,
} from '../src/engine/survivors/SurvivorsField.js';
import {
  critChanceOf,
  enemyProfile,
  lordProfile,
  rollLevelGains,
  strike,
  triangleBonus,
} from '../src/engine/survivors/SurvivorsUnits.js';
import { botChoice, botInput } from '../src/engine/survivors/SurvivorsBot.js';
import { validateSurvivorsConfig } from '../src/engine/survivors/SurvivorsConfig.js';

const gameData = loadGameData();
const config = JSON.parse(readFileSync(new URL('../data/survivors.json', import.meta.url), 'utf8'));
const VIEW = { width: 400, height: 860 };

function newWorld(lordName = 'Edric', seed = 11) {
  return createSurvivorsWorld({ config, gameData, lordName, seed, view: VIEW });
}

/** Play with the bot until the night ends or `until` seconds pass. */
function play(world, until = Infinity) {
  while ((world.status === 'playing' || world.status === 'choosing') && world.t < until) {
    if (world.status === 'choosing') chooseOffer(world, botChoice(world));
    else stepWorld(world, botInput(world));
    drainEvents(world);
  }
  return world;
}

/** A plain world snapshot for comparing two nights. */
function snapshot(world) {
  return {
    t: world.t,
    status: world.status,
    kills: world.kills,
    level: world.player.level,
    hp: world.player.hp,
    x: world.player.x,
    y: world.player.y,
    enemies: world.enemies.map((e) => [e.id, e.className, Math.round(e.x), Math.round(e.y), e.hp]),
    weapons: world.player.weapons.map((w) => `${w.id}${w.level}`),
    passives: world.player.passives.map((p) => `${p.id}${p.level}`),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('survivors.json', () => {
  it('passes its validator against the game data', () => {
    const result = validateSurvivorsConfig(config, gameData);
    expect(result.errors).toEqual([]);
  });

  it('the validator refuses a weapon, class or boss the game does not have', () => {
    const broken = structuredClone(config);
    broken.weapons.sword.levels[0].weapon = 'Spork';
    broken.waves[0].classes = ['Fighter', 'Entity'];
    broken.bosses[0].name = 'Nobody';
    const { ok, errors } = validateSurvivorsConfig(broken, gameData);
    expect(ok).toBe(false);
    expect(errors.join('\n')).toMatch(/unknown weapon Spork/);
    expect(errors.join('\n')).toMatch(/Entity is a boss-tier class/);
    expect(errors.join('\n')).toMatch(/no boss Nobody/);
  });

  it('every music key it names is a track the game ships', async () => {
    const { MUSIC_LOOPS } = await import('../src/utils/musicLoops.js');
    for (const key of [config.music.battle, config.music.win, config.music.lose])
      expect(MUSIC_LOOPS[key] || key === 'music_defeat' || key === 'music_run_win').toBeTruthy();
  });
});

describe('the strike and the level-up', () => {
  it('is (STR or MAG + Might + triangle) - DEF, never below 1; a crit triples it', () => {
    const noCrit = () => 0.99;
    expect(
      strike({ power: 6, might: 5, defense: 4, triangle: 2, critChance: 0.1 }, noCrit),
    ).toEqual({
      damage: 9,
      crit: false,
    });
    expect(strike({ power: 2, might: 1, defense: 20 }, noCrit).damage).toBe(1);
    expect(strike({ power: 6, might: 5, defense: 4, critChance: 0.5 }, () => 0.1)).toEqual({
      damage: 21,
      crit: true,
    });
  });

  it('reads crit as SKL / 2 + weapon crit + bonus - foe LCK, kept within 0..100%', () => {
    expect(critChanceOf(9, 5, 0, 2)).toBeCloseTo(0.07);
    expect(critChanceOf(2, 0, 0, 30)).toBe(0);
    expect(critChanceOf(200, 50, 0, 0)).toBe(1);
  });

  it('keeps the weapon triangle: Sword beats Axe beats Lance beats Sword', () => {
    expect(triangleBonus('Sword', 'Axe', 2)).toBe(2);
    expect(triangleBonus('Axe', 'Sword', 2)).toBe(-2);
    expect(triangleBonus('Lance', 'Sword', 2)).toBe(2);
    expect(triangleBonus('Bow', 'Sword', 2)).toBe(0);
  });

  it('a level that gains nothing gives the stat whose roll came closest', () => {
    const growths = { HP: 50, STR: 40, MAG: 10, SKL: 30, SPD: 30, DEF: 20, RES: 10, LCK: 20 };
    // rolls: each a miss; STR's (0.42 vs 0.40) is the closest
    const rolls = [0.8, 0.42, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9];
    const gains = rollLevelGains(growths, () => rolls.shift());
    expect(Object.values(gains).reduce((a, b) => a + b, 0)).toBe(1);
    expect(gains.STR).toBe(1);
  });

  it('a growth past 100 is a sure point plus a chance at another', () => {
    const gains = rollLevelGains({ HP: 130 }, () => 0.5);
    expect(gains.HP).toBe(1);
    expect(rollLevelGains({ HP: 130 }, () => 0.1).HP).toBe(2);
  });

  it('lords read class growth ranges plus their personal growths', () => {
    const edric = lordProfile(gameData, 'Edric');
    const lordClass = gameData.classes.find((c) => c.name === 'Lord');
    const [lo, hi] = lordClass.growthRanges.STR.split('-').map(Number);
    const personal = gameData.lords.find((l) => l.name === 'Edric').personalGrowths.STR;
    expect(edric.growths.STR).toBe(Math.round((lo + hi) / 2) + personal);
    expect(edric.stats.STR).toBe(gameData.lords.find((l) => l.name === 'Edric').baseStats.STR);
  });

  it('a promoted foe is its base class at 12 plus the promotion bonuses', () => {
    const fighter12 = enemyProfile(gameData, 'Fighter', 12);
    const warrior12 = enemyProfile(gameData, 'Warrior', 12);
    const bonus = gameData.classes.find((c) => c.name === 'Warrior').promotionBonuses;
    expect(warrior12.stats.STR).toBe(fighter12.stats.STR + bonus.STR);
    expect(warrior12.stats.HP).toBe(fighter12.stats.HP + bonus.HP);
    expect(enemyProfile(gameData, 'Warrior', 15).stats.STR).toBeGreaterThan(warrior12.stats.STR);
    // seasoned foes carry steel
    expect(enemyProfile(gameData, 'Fighter', 3).weapon.name).toBe('Iron Axe');
    expect(warrior12.weapon.name).toBe('Steel Axe');
  });
});

describe('the field', () => {
  it('reads movement from terrain.json: water stops walkers, never fliers', () => {
    const field = createField(
      {
        cols: 20,
        rows: 20,
        clearRadius: 0,
        blobs: [{ terrain: 'Water', count: 6, minCells: 4, maxCells: 8 }],
      },
      gameData.terrain,
      (() => {
        let n = 0;
        return () => (n = (n * 9301 + 49297) % 233280) / 233280;
      })(),
    );
    let water = 0;
    for (let r = 0; r < 20; r++)
      for (let c = 0; c < 20; c++) {
        const i = r * 20 + c;
        if (field.names[r][c] === 'Water') {
          water++;
          expect(field.costs.Infantry[i]).toBe(0);
          expect(field.costs.Cavalry[i]).toBe(0);
          expect(field.costs.Flying[i]).toBe(1);
        } else expect(field.costs.Infantry[i]).toBe(1);
      }
    expect(water).toBeGreaterThan(0);
  });

  it('walks a foe around a pond instead of into it, and never cuts its corner', () => {
    const field = createField(
      { cols: 12, rows: 12, clearRadius: 0, blobs: [] },
      gameData.terrain,
      () => 0.5,
    );
    // a wall of water across column 5, rows 0..9 (open at rows 10-11)
    for (let r = 0; r < 10; r++) field.costs.Infantry[r * 12 + 5] = 0;
    const target = 2 * 12 + 9; // col 9, row 2
    const dist = buildFlowField(field, 'Infantry', target);
    let x = 2.5 * CELL;
    let y = 2.5 * CELL;
    const visited = [];
    for (let i = 0; i < 40; i++) {
      const step = flowStep(field, dist, x, y);
      if (!step) break;
      x = step.x;
      y = step.y;
      const c = Math.floor(x / CELL);
      const r = Math.floor(y / CELL);
      visited.push([c, r]);
      expect(field.costs.Infantry[r * 12 + c]).toBeGreaterThan(0);
    }
    // it went round the bottom of the wall
    expect(visited.some(([, r]) => r >= 10)).toBe(true);
    expect(Math.floor(x / CELL)).toBeGreaterThanOrEqual(8);
  });
});

describe('a night', () => {
  it('is the same night for the same seed and stick, and a different one for another seed', () => {
    const a = play(newWorld('Edric', 21), 90);
    const b = play(newWorld('Edric', 21), 90);
    const c = play(newWorld('Edric', 22), 90);
    expect(snapshot(a)).toEqual(snapshot(b));
    expect(snapshot(c)).not.toEqual(snapshot(a));
  });

  it('never draws Math.random (the battle stream)', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random drawn');
    });
    play(newWorld('Kira', 5), 120);
    expect(spy).not.toHaveBeenCalled();
  });

  it('starts each lord with their own weapon', () => {
    expect(newWorld('Edric').player.weapons[0].id).toBe('sword');
    expect(newWorld('Kira').player.weapons[0].id).toBe('fire');
    expect(newWorld('Sera').player.weapons[0].id).toBe('light');
    expect(newWorld('Cael').player.weapons[0].id).toBe('axe');
    expect(newWorld('Voss').player.weapons[0].id).toBe('bow');
  });

  it('brings foes in from past the edge of the screen', () => {
    const world = newWorld('Edric', 3);
    for (let i = 0; i < 60 * 20; i++) {
      const before = new Set(world.enemies.map((e) => e.id));
      stepWorld(world, { x: 0, y: 0 });
      drainEvents(world);
      if (world.status !== 'playing') break;
      for (const e of world.enemies) {
        if (before.has(e.id)) continue;
        const outside =
          Math.abs(e.x - world.player.x) > VIEW.width / 2 ||
          Math.abs(e.y - world.player.y) > VIEW.height / 2;
        expect(outside).toBe(true);
      }
    }
  });

  it('pauses for a level-up, rolls real growths, and plays on after a choice', () => {
    const world = newWorld('Edric', 8);
    const statsBefore = { ...world.player.stats };
    while (world.status === 'playing') stepWorld(world, botInput(world));
    expect(world.status).toBe('choosing');
    const t = world.t;
    stepWorld(world, { x: 1, y: 0 });
    expect(world.t).toBe(t); // a choice holds the night
    expect(world.offer.source).toBe('level');
    const gained = Object.values(world.offer.gains).reduce((a, b) => a + b, 0);
    expect(gained).toBeGreaterThan(0);
    const statSum = (s) => Object.values(s).reduce((a, b) => a + b, 0);
    expect(statSum(world.player.stats)).toBe(statSum(statsBefore) + gained);
    expect(world.offer.choices).toHaveLength(config.offerCount);
    expect(chooseOffer(world, 0)).toBe(true);
    expect(['playing', 'choosing']).toContain(world.status);
  });

  it('an accessory raises its stat, and the max HP keeps the missing share', () => {
    const world = newWorld('Edric', 9);
    world.player.hp -= 10;
    const str = world.player.stats.STR;
    world.status = 'choosing';
    world.offer = {
      source: 'chest',
      choices: [
        { kind: 'passive', id: 'power_ring', level: 1 },
        { kind: 'passive', id: 'life_ring', level: 1 },
      ],
    };
    chooseOffer(world, 0);
    expect(world.player.stats.STR).toBe(str + config.passives.power_ring.perLevel);
    const maxBefore = world.player.maxHp;
    world.status = 'choosing';
    world.offer = { source: 'chest', choices: [{ kind: 'passive', id: 'life_ring', level: 1 }] };
    chooseOffer(world, 0);
    expect(world.player.maxHp - maxBefore).toBe(
      config.passives.life_ring.perLevel * config.player.hpScale,
    );
    expect(world.player.maxHp - world.player.hp).toBe(10);
  });

  it('never offers past a full set of slots or past a weapon’s last level', () => {
    const world = newWorld('Edric', 4);
    const ids = Object.keys(config.weapons).slice(0, config.player.maxWeapons);
    world.player.weapons = ids.map((id) => ({
      id,
      level: config.weapons[id].levels.length,
      cd: 1,
    }));
    world.player.passives = Object.keys(config.passives)
      .slice(0, config.player.maxPassives)
      .map((id) => ({ id, level: config.passives[id].maxLevel }));
    expect(offerCandidates(world)).toEqual([]);
    world.status = 'choosing';
    world.offer = null;
    world.queue.push({ source: 'level', level: 2, gains: {} });
    world.status = 'playing';
    stepWorld(world, { x: 0, y: 0 });
    expect(world.offer.choices).toEqual([{ kind: 'rest', id: 'rest', level: 0 }]);
  });

  it('Miracle leaves the lord at 1 HP once, then the night can end', () => {
    const world = newWorld('Edric', 6);
    world.player.passives.push({ id: 'miracle', level: 1 });
    world.player.hp = 1;
    const brute = makeEnemy(world, 'Warrior', 20);
    brute.x = world.player.x;
    brute.y = world.player.y;
    world.enemies.push(brute);
    stepWorld(world, { x: 0, y: 0 });
    const events = drainEvents(world);
    // the lord starts in the clear middle (plain ground, no avoid), so the blow lands
    expect(events.some((e) => e.type === 'dodge')).toBe(false);
    expect(events.some((e) => e.type === 'miracle')).toBe(true);
    expect(world.player.hp).toBe(1);
    expect(passiveLevel(world, 'miracle')).toBe(1);
    // the next blow, inside the cooldown, ends the night
    for (let i = 0; i < 120 && world.status === 'playing'; i++) {
      brute.x = world.player.x;
      brute.y = world.player.y;
      stepWorld(world, { x: 0, y: 0 });
    }
    expect(world.status).toBe('lost');
  });

  it('brings the bosses on the clock and ends at dawn', () => {
    const world = newWorld('Voss', 2);
    world.player.invuln = 1e9; // no blow lands: hold the night open to dawn
    const seen = [];
    while (world.status === 'playing' || world.status === 'choosing') {
      if (world.status === 'choosing') chooseOffer(world, 0);
      else stepWorld(world, botInput(world));
      for (const e of drainEvents(world)) if (e.type === 'boss') seen.push([e.name, world.t]);
    }
    expect(world.status).toBe('won');
    expect(world.t).toBeGreaterThanOrEqual(config.durationSec);
    expect(world.t).toBeLessThan(config.durationSec + STEP * 2);
    expect(timeLeft(world)).toBe(0);
    expect(seen.map(([name]) => name)).toEqual(config.bosses.map((b) => b.name));
    seen.forEach(([, at], i) =>
      expect(Math.abs(at - config.bosses[i].atSec)).toBeLessThanOrEqual(1),
    );
  }, 60_000);
});
