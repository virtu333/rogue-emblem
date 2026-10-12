// Deathburst as one engine step (engine/Deathburst.js `deathburst`), which BattleScene.removeUnit
// drives with presentation and the headless harness's `_removeUnit` drives without. Before this
// step the harness never burst, so a sim kill beside a Deathburst foe left the killer untouched.
// Ways this breaks, one test each:
//   - the harness never bursts, or bursts differently from the scene: who is struck, HP, falls,
//     kill credit, the battle's end
//   - a burst strikes a diagonal, the burster itself, a unit already down, or misses an ally
//     of the burster (it strikes allies and foes alike)
//   - the commander felled by a counter-kill's burst does not lose the battle, or is removed
//     twice (credited once by the burst, again by the combat's owner)
//   - a Revival Stone or the Unbroken Banner is skipped, or HP is written outside UnitHealth
//   - the Entity is measured from its anchor, so a burst beside another body tile misses it
//   - the step takes a draw (it has none to take)
//   - the scene or the harness keeps a copy of the rule
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import './harness/JourneyTestSetup.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { presentationFailureProxy as rendering } from './harness/PresentationFailureProxy.js';
import { splashUnit } from './entitySplashKit.js';
import { deathburst, deathburstEffects, runDeathburstSync } from '../src/engine/Deathburst.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { registerBattleEntity } from '../src/engine/BattleEntityIdentity.js';
import { createBattleBlessings } from '../src/engine/BattleBlessings.js';
import { isolateBattleTextFactory } from '../src/utils/presentationText.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const originalRandom = Math.random;
const BURST = data.affixes.affixes.find((a) => a.id === 'deathburst');

afterEach(() => {
  Math.random = originalRandom;
  vi.restoreAllMocks();
});

function burster(col, row, hp = 0, extra = {}) {
  return splashUnit('Burster', 'enemy', col, row, hp, { affixes: ['deathburst'], ...extra });
}

function entityAt(col, row, hp = 200) {
  return splashUnit('The Entity', 'enemy', col, row, hp, {
    isEntity: true,
    isBoss: true,
    className: 'Entity',
  });
}

describe('the data the step reads', () => {
  it('Deathburst is an adjacent on-death blow the tests below are sized to', () => {
    expect(BURST).toMatchObject({ trigger: 'on-death', range: 1, effects: { aoeDamage: 5 } });
    const effects = deathburstEffects(burster(0, 0), data.affixes);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ type: 'aoe_damage', amount: 5, range: 1 });
    expect(deathburstEffects(splashUnit('Plain', 'enemy', 0, 0, 0), data.affixes)).toEqual([]);
  });
});

describe('the step', () => {
  function run(units, { dead, blessings = null } = {}) {
    const removed = [];
    const roster = [...units];
    const record = runDeathburstSync(
      dead,
      { col: dead.col, row: dead.row },
      { affixes: data.affixes, units: () => roster, battleBlessings: blessings },
      {
        remove: (victim, { killer }) => {
          removed.push(`${victim.name}<${killer.name}`);
          roster.splice(roster.indexOf(victim), 1);
        },
      },
    );
    return { record, removed };
  }

  it('strikes every orthogonal neighbour, ally of the burster or foe, and nothing else', () => {
    const dead = burster(4, 4);
    const units = [
      splashUnit('North', 'player', 4, 3, 30),
      splashUnit('EastFoe', 'enemy', 5, 4, 30),
      splashUnit('SouthGreen', 'npc', 4, 5, 30),
      splashUnit('Diagonal', 'player', 5, 5, 30),
      splashUnit('Far', 'player', 6, 4, 30),
      splashUnit('Down', 'player', 3, 4, 0),
    ];
    let draws = 0;
    Math.random = () => {
      draws++;
      return 0.5;
    };
    const { record } = run([dead, ...units], { dead });
    expect(draws).toBe(0);
    expect(units.map((u) => `${u.name}:${u.currentHP}`)).toEqual([
      'North:25',
      'EastFoe:25',
      'SouthGreen:25',
      'Diagonal:30',
      'Far:30',
      'Down:0',
    ]);
    expect(record.blows.map((b) => b.victim.name)).toEqual(['North', 'EastFoe', 'SouthGreen']);
  });

  it('a lethal blow is removed with the burster’s credit before the next victim', () => {
    const dead = burster(4, 4);
    const frail = splashUnit('Frail', 'player', 4, 3, 5);
    const sturdy = splashUnit('Sturdy', 'player', 4, 5, 30);
    const order = [];
    const steps = deathburst(
      dead,
      { col: 4, row: 4 },
      { affixes: data.affixes, units: () => [frail, sturdy] },
    );
    for (const step of steps) {
      order.push(`${step.kind}:${step.victim?.name ?? '-'}:${sturdy.currentHP}`);
    }
    // The frail victim's blow is seen before the sturdy one is struck.
    expect(order).toEqual(['blow:Frail:30', 'blow:Sturdy:25', 'burst:-:25']);
    const again = [splashUnit('Frail', 'player', 4, 3, 5)];
    const { removed } = run([dead, ...again], { dead });
    expect(removed).toEqual(['Frail<Burster']);
  });

  it('a Revival Stone refills the bar instead of a fall', () => {
    const dead = burster(4, 4);
    const boss = splashUnit('Boss', 'enemy', 4, 3, 3, { isBoss: true, revivalStones: 1 });
    const { removed, record } = run([dead, boss], { dead });
    expect(removed).toEqual([]);
    expect(boss.currentHP).toBe(boss.stats.HP);
    expect(boss.revivalStones).toBe(0);
    expect(record.blows[0]).toMatchObject({ stoneBroken: true, fell: false });
  });

  it('the Unbroken Banner holds a player unit at 1', () => {
    const dead = burster(4, 4);
    const ally = splashUnit('Ally', 'player', 4, 3, 4);
    const blessings = createBattleBlessings({ lastStand: 1 });
    const { removed, record } = run([dead, ally], { dead, blessings });
    expect(removed).toEqual([]);
    expect(ally.currentHP).toBe(1);
    expect(record.blows[0]).toMatchObject({ bannerHeld: true, fell: false });
  });

  it('catches the Entity beside a body tile that is not its anchor', () => {
    // The body is (1..3, 3..5); (4,5) is beside (3,5) and 4 tiles from the anchor (1,3).
    const entity = entityAt(1, 3);
    const dead = burster(4, 5);
    run([entity, dead], { dead });
    expect(entity.currentHP).toBe(195);
    const far = entityAt(1, 3);
    const diagonal = burster(4, 6); // diagonal to the body's corner (3,5)
    run([far, diagonal], { dead: diagonal });
    expect(far.currentHP).toBe(200);
  });

  it('changes HP only through UnitHealth, handing the banner its chance', () => {
    const code = readFileSync('src/engine/Deathburst.js', 'utf8').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bcurrentHP\s*(?:[-+*/]?=(?!=)|\+\+|--)/);
    expect(code).toMatch(
      /damageUnitDetailed\(victim, damage, \{\s*blessings: world\.battleBlessings/,
    );
  });
});

// --- The scene and the harness on the same boards -------------------------------------------

/** The board through the scene (BattleScene.removeUnit / executeEnemyCombat). */
function sceneWorld(units, { blessings = null } = {}) {
  const scene = journeyBattleScene({}, data);
  scene.runManager = null;
  scene._battleRewindPolicy = 'fixed-v1';
  const plain = data.terrain.find((t) => t.name === 'Plain');
  Object.assign(scene.grid, {
    cols: 9,
    rows: 9,
    fogEnabled: false,
    clearTemporaryTerrainsBySource: () => {},
    getMoveCost: () => 1,
    getTerrainAt: () => plain,
  });
  scene.battleConfig = { objective: 'rout' };
  scene.goldEarned = 0;
  scene.turnPar = 99;
  scene.turnBonusConfig = data.turnBonus;
  scene.getCurrentTurnNumber = () => 1;
  scene.playerUnits = units.filter((u) => u.faction === 'player');
  scene.enemyUnits = units.filter((u) => u.faction === 'enemy');
  scene.npcUnits = units.filter((u) => u.faction === 'npc');
  scene._battleBlessings = blessings;
  for (const u of units) registerBattleEntity(scene, u);
  rendering(scene, 0);
  isolateBattleTextFactory(scene);
  scene._getSelectedWeaponArtForUnit = () => null;
  scene.animateStrike = async () => {};
  scene.animateSkillActivation = async () => {};
  scene._battleBeats.checkBossHalfHealth = async () => {};
  scene._battleBeats.onChipLance = () => {};
  scene._battleBeats.onLowHealth = () => {};
  scene.sys = { isActive: () => true };
  scene.scene = { isActive: () => true };
  scene.onVictory = () => {
    scene.battleState = 'BATTLE_END';
  };
  scene.onDefeat = () => {
    scene.result = 'defeat';
    scene.battleState = 'BATTLE_END';
  };
  scene.awardScaledXP = async () => {};
  scene.checkBattleEnd = BattleScene.prototype.checkBattleEnd;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const removed = [];
  const realRemove = scene.removeUnit.bind(scene);
  scene.removeUnit = async (unit, options) => {
    removed.push(`${unit.name}<${options?.killer?.name ?? '-'}`);
    return realRemove(unit, options);
  };
  return {
    removed,
    remove: (unit, killer) => scene.removeUnit(unit, { killer }),
    attack: (enemy, target) => scene.executeEnemyCombat(enemy, target),
    roster: () => [...scene.playerUnits, ...scene.enemyUnits, ...scene.npcUnits].map((u) => u.name),
    defeated: () => scene.result === 'defeat',
  };
}

/** The same board through the headless harness (HeadlessBattle._removeUnit / _executeEnemyCombat). */
function harnessWorld(units, { blessings = null } = {}) {
  const battle = new HeadlessBattle(structuredClone(data), { act: 'act1', objective: 'rout' });
  battle.turnManager = { turnNumber: 1, unitActed() {} };
  battle.battleConfig = { objective: 'rout' };
  battle.turnPar = 99;
  battle.goldEarned = 0;
  battle.playerUnits = units.filter((u) => u.faction === 'player');
  battle.enemyUnits = units.filter((u) => u.faction === 'enemy');
  battle.npcUnits = units.filter((u) => u.faction === 'npc');
  battle._battleBlessings = blessings;
  const plain = data.terrain.find((t) => t.name === 'Plain');
  battle.grid = {
    cols: 9,
    rows: 9,
    fogEnabled: false,
    getTerrainAt: () => plain,
    getMoveCost: () => 1,
    updateFogOfWar() {},
  };
  battle._grantScaledXP = () => {};
  let defeated = false;
  battle._onDefeat = () => {
    defeated = true;
    battle.battleState = 'BATTLE_END';
  };
  const removed = [];
  const realRemove = battle._removeUnit.bind(battle);
  battle._removeUnit = (unit, options) => {
    removed.push(`${unit.name}<${options?.killer?.name ?? '-'}`);
    return realRemove(unit, options);
  };
  return {
    removed,
    remove: async (unit, killer) => battle._removeUnit(unit, { killer }),
    attack: async (enemy, target) => battle._executeEnemyCombat(enemy, target),
    playerAttack: async (unit, target) => battle._executeCombat(unit, target),
    roster: () =>
      [...battle.playerUnits, ...battle.enemyUnits, ...battle.npcUnits].map((u) => u.name),
    defeated: () => defeated,
  };
}

const WORLDS = [
  ['the scene', sceneWorld],
  ['the harness', harnessWorld],
];

/**
 * What both worlds must agree on: HP, who was removed (and by whom), who stands, the end. Not
 * gold: the scene fixture has no run, so it pays none for any kill (`_applyKillRewards`).
 */
function outcome(world, units) {
  return {
    hp: units.map((u) => `${u.name}:${u.currentHP}`).join(','),
    removed: world.removed.join('+'),
    roster: world.roster().join(','),
    defeated: world.defeated(),
  };
}

/** Boards where the burster falls to a killer standing beside it. */
const BOARDS = {
  // An adjacent ally of the killer is felled by the burst; a foe beside it is hurt.
  lethal: () => {
    const killer = splashUnit('Killer', 'player', 4, 3, 30);
    const frail = splashUnit('Frail', 'player', 3, 4, 4);
    const foe = splashUnit('Foe', 'enemy', 5, 4, 20);
    const dead = burster(4, 4);
    return { killer, dead, units: [killer, frail, foe, dead] };
  },
  // A stoned boss beside the burster spends its stone.
  stone: () => {
    const killer = splashUnit('Killer', 'player', 4, 3, 30);
    const boss = splashUnit('Boss', 'enemy', 5, 4, 2, {
      isBoss: true,
      revivalStones: 1,
      revivalStonesMax: 1,
    });
    const dead = burster(4, 4);
    return { killer, dead, units: [killer, boss, dead] };
  },
  // The Entity's body is (1..3, 3..5): the burster falls beside (3,5), far from the anchor.
  entity: () => {
    const killer = splashUnit('Killer', 'player', 6, 5, 30);
    const entity = entityAt(1, 3);
    const dead = burster(4, 5);
    return { killer, dead, units: [killer, entity, dead] };
  },
  // A chain: the burst fells a second burster, whose own burst fells the killer's neighbour.
  chain: () => {
    const killer = splashUnit('Killer', 'player', 4, 3, 30);
    const second = burster(5, 4, 3, { name: 'Second' });
    const frail = splashUnit('Frail', 'player', 6, 4, 5);
    const dead = burster(4, 4);
    return { killer, dead, units: [killer, second, frail, dead] };
  },
};

describe('the scene and the harness burst alike when a Deathburst foe falls', () => {
  it.each(Object.keys(BOARDS))('%s', async (kind) => {
    const results = [];
    for (const [, makeWorld] of WORLDS) {
      const { killer, dead, units } = BOARDS[kind]();
      const before = units.filter((u) => u !== dead).map((u) => u.currentHP);
      const world = makeWorld(units);
      await world.remove(dead, killer);
      results.push(outcome(world, units));
      // Each board is worth testing: the burst reached someone.
      expect(units.filter((u) => u !== dead).map((u) => u.currentHP)).not.toEqual(before);
    }
    const [scene, harness] = results;
    expect(harness).toEqual(scene);
  });

  it('pins what each board does', async () => {
    const play = async (kind) => {
      const { killer, dead, units } = BOARDS[kind]();
      const world = harnessWorld(units);
      await world.remove(dead, killer);
      return outcome(world, units);
    };
    expect(await play('lethal')).toMatchObject({
      hp: 'Killer:25,Frail:0,Foe:15,Burster:0',
      removed: 'Burster<Killer+Frail<Burster',
    });
    expect(await play('stone')).toMatchObject({ hp: 'Killer:25,Boss:40,Burster:0' });
    expect(await play('entity')).toMatchObject({ hp: 'Killer:30,The Entity:195,Burster:0' });
    expect(await play('chain')).toMatchObject({
      hp: 'Killer:25,Second:0,Frail:0,Burster:0',
      removed: 'Burster<Killer+Second<Burster+Frail<Second',
    });
  });
});

/** The commander counters a Deathburst foe to death and stands beside its burst. */
function counterBoard(edricHp) {
  const sword = structuredClone(data.weapons.find((w) => w.name === 'Iron Sword'));
  const edric = splashUnit('Edric', 'player', 4, 4, edricHp, {
    isCommander: true,
    isLord: true,
    stats: { HP: 40, STR: 20, MAG: 0, SKL: 30, SPD: 20, DEF: 40, RES: 10, LCK: 30, MOV: 5 },
    weapon: sword,
    inventory: [sword],
  });
  const lance = structuredClone(data.weapons.find((w) => w.name === 'Iron Lance'));
  const foe = burster(4, 3, 1, {
    stats: { HP: 20, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0, MOV: 5 },
    className: 'Soldier',
    weapon: lance,
    inventory: [lance],
  });
  const ally = splashUnit('Ally', 'player', 7, 7, 30);
  return { edric, foe, units: [foe, edric, ally] };
}

describe('the commander felled by a counter-kill’s burst', () => {
  it.each(WORLDS)('%s loses the battle, the fall credited once', async (_l, makeWorld) => {
    let lost = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { edric, foe, units } = counterBoard(5);
      const world = makeWorld(units);
      Math.random = createBattleRng(seed);
      try {
        await world.attack(foe, edric);
      } finally {
        Math.random = originalRandom;
      }
      if (foe.currentHP > 0) continue; // the counter missed: nothing burst
      expect(edric.currentHP, `seed ${seed}`).toBe(0);
      expect(world.removed.filter((r) => r.startsWith('Edric<'))).toEqual(['Edric<Burster']);
      expect(world.defeated(), `seed ${seed}`).toBe(true);
      lost++;
    }
    expect(lost).toBeGreaterThan(0);
  });

  it('the scene and the harness agree seed by seed', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const results = [];
      for (const [, makeWorld] of WORLDS) {
        const { edric, foe, units } = counterBoard(5);
        const world = makeWorld(units);
        const stream = createBattleRng(seed);
        Math.random = stream;
        try {
          await world.attack(foe, edric);
        } finally {
          Math.random = originalRandom;
        }
        results.push({ ...outcome(world, units), cursor: stream.getState().cursor });
      }
      expect(results[1], `seed ${seed}`).toEqual(results[0]);
    }
  });

  it.each(WORLDS)('%s: a sturdier commander survives the burst', async (_l, makeWorld) => {
    const { edric, foe, units } = counterBoard(30);
    const world = makeWorld(units);
    Math.random = () => 0; // every roll hits
    try {
      await world.attack(foe, edric);
    } finally {
      Math.random = originalRandom;
    }
    expect(foe.currentHP).toBe(0);
    expect(edric.currentHP).toBe(25);
    expect(world.defeated()).toBe(false);
  });
});

describe('the commander killing a Deathburst foe on its own attack', () => {
  // The harness removes the defender, then an attacker at 0 HP: the burst has already removed
  // the attacker by then, so a second removal would credit its fall twice.
  it('the harness removes the commander once and loses the battle', async () => {
    const { edric, foe, units } = counterBoard(5);
    const world = harnessWorld(units);
    Math.random = () => 0; // every roll hits
    try {
      await world.playerAttack(edric, foe);
    } finally {
      Math.random = originalRandom;
    }
    expect(foe.currentHP).toBe(0);
    expect(edric.currentHP).toBe(0);
    expect(world.removed.slice(0, 2)).toEqual(['Burster<Edric', 'Edric<Burster']);
    // The owner's later call for the attacker finds it gone: its fall is recorded once.
    expect(foe._slewAllies).toEqual(['Edric']);
    expect(world.roster()).toEqual(['Ally']);
    expect(world.defeated()).toBe(true);
  });
});

describe('the rule has one home', () => {
  const methodBody = (text, name) => {
    const at = text.search(new RegExp(`\\n  (?:async )?${name}\\(`));
    let i = text.indexOf('{', text.indexOf(')', at));
    const start = i;
    let depth = 0;
    do {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') depth--;
      i++;
    } while (i < text.length && depth > 0);
    return text.slice(start, i);
  };

  it.each([
    ['src/scenes/BattleScene.js', 'removeUnit', /\bdeathburst\(/],
    ['tests/harness/HeadlessBattle.js', '_removeUnit', /runDeathburstSync\(/],
  ])('%s %s drives the step and keeps no copy of the rule', (file, name, drives) => {
    const body = methodBody(readFileSync(file, 'utf8'), name);
    expect(body).toMatch(drives);
    for (const copy of [/deathburstVictims/, /getOnDeathAffixes/, /damageUnit/])
      expect(body).not.toMatch(copy);
  });
});
