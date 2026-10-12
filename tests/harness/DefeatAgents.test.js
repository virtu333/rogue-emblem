// The agents on a defeat map (act-v-descent §9.4: "ScriptedAgent and sim/lib/TacticianAgent: targets
// take boss priority, or the Vigil times out while the circles call"). A defeat map is won by its
// targets alone, so an agent that charges "the nearest foe" spends its turns on guards that need
// not fall, and one that waits for contact never reaches a target on a post.
//
// Ways this goes wrong, a test each:
//   - ScriptedAgent strikes a nearer guard before a target it could strike (priority lost);
//   - it walks to the nearest foe, not the nearest target, so the guards fall first;
//   - it never finishes a defeat map, or finishes it only by routing the field;
//   - the Tactician waits for contact (bait-and-punish) while the target sits on its post;
//   - the Tactician scores a target no higher than a guard it could strike;
//   - a map with no objectives model gives the agents' old choices (rout, seize unchanged).
import { afterEach, describe, expect, it } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { GameDriver } from './GameDriver.js';
import { checkInvariants } from './Invariants.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { withSetPieces } from '../setPieceFixtures.js';

/**
 * Two Mages on posts at the far end (the targets), two Fighter posts nearer the army on the
 * far rows (guards: the nearest foes, and no part of the objective). The army starts at the left.
 */
const GORGE = {
  id: 'fixture_gorge',
  title: 'Fixture Gorge',
  lore: 'A test gorge.',
  objective: 'rout',
  objectives: {
    version: 1,
    primary: [
      { id: 'voices', kind: 'defeat', targets: ['voice_a', 'voice_b'], label: 'the Voices' },
    ],
  },
  deploy: { max: 2 },
  variants: [
    {
      id: 'a',
      map: {
        legend: { '.': 'Plain' },
        rows: [
          '. . . . . . . . . . . .',
          '. . . . . . . . . . . .',
          '. . . . . . . . . . . .',
          '. . . . . . . . . . . .',
          '. . . . . . . . . . . .',
          '. . . . . . . . . . . .',
          '. . . . . . . . . . . .',
        ],
      },
      playerSpawns: [
        { col: 0, row: 3 },
        { col: 0, row: 2 },
      ],
      enemies: [
        { col: 10, row: 2, classes: ['Mage'], id: 'voice_a', name: 'Voice A', target: true, aiMode: 'post' }, // prettier-ignore
        { col: 10, row: 4, classes: ['Mage'], id: 'voice_b', name: 'Voice B', target: true, aiMode: 'post' }, // prettier-ignore
        { col: 3, row: 0, classes: ['Fighter'], aiMode: 'post' },
        { col: 3, row: 6, classes: ['Fighter'], aiMode: 'post' },
      ],
    },
  ],
};

const data = withSetPieces(loadGameData(), GORGE);
afterEach(() => restoreMathRandom());

/** A strong army (the test is the agents' priority, not the fight's balance). */
function gorge(seed) {
  installSeed(seed);
  const driver = new GameDriver(data, {
    difficultyId: 'normal',
    battleSeed: seed,
    act: 'act1',
    objective: 'rout',
    setPiece: 'fixture_gorge',
    deployCount: 2,
    levelRange: [1, 1],
  });
  driver.init();
  for (const u of driver.battle.playerUnits) {
    u.stats.HP += 40;
    u.currentHP += 40;
    u.stats.STR += 8;
    u.stats.DEF += 6;
    u.stats.RES += 6;
    u.stats.SPD += 6;
  }
  return driver;
}

async function play(driver, agent, cap = 600) {
  const b = driver.battle;
  for (let i = 0; i < cap && b.result === null; i++) {
    const legal = driver.listLegalActions();
    if (!legal.length) break;
    await driver.step(agent.chooseAction(legal));
  }
  return b;
}

const targetsOf = (b) => b.enemyUnits.filter((u) => u.authoredId);
const guardsOf = (b) => b.enemyUnits.filter((u) => !u.authoredId);

describe('ScriptedAgent on a defeat map', () => {
  it('wins with the guards standing, within par and a margin', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const driver = gorge(seed);
      const b = driver.battle;
      expect(b.battleConfig.objectives).toBeTruthy();
      const par = b.turnPar;
      expect(Number.isFinite(par)).toBe(true);
      await play(driver, new ScriptedAgent(driver));
      expect(b.result, `seed ${seed}`).toBe('victory');
      // The targets are down, both posted guards still stand: the rest need not fall.
      expect(targetsOf(b), `seed ${seed}`).toEqual([]);
      expect(guardsOf(b).length, `seed ${seed}`).toBe(2);
      expect(b.turnManager.turnNumber, `seed ${seed}`).toBeLessThanOrEqual(par + 2);
      expect(checkInvariants(driver)).toEqual([]);
    }
  });

  it('a target in reach is struck before a guard that is nearer, weaker and killable', () => {
    const driver = gorge(1);
    const b = driver.battle;
    const [guard] = guardsOf(b);
    const target = b.enemyUnits.find((u) => u.authoredId === 'voice_a');
    guard.currentHP = 1;
    target.currentHP = 30;
    const legal = [
      { type: 'choose_target', payload: { targetName: guard.name } },
      { type: 'choose_target', payload: { targetName: target.name } },
    ];
    expect(new ScriptedAgent(driver).chooseAction(legal).payload.targetName).toBe(target.name);
    // Two targets in reach: the weaker one.
    const other = b.enemyUnits.find((u) => u.authoredId === 'voice_b');
    other.currentHP = 5;
    const both = [
      { type: 'choose_target', payload: { targetName: target.name } },
      { type: 'choose_target', payload: { targetName: other.name } },
      { type: 'choose_target', payload: { targetName: guard.name } },
    ];
    expect(new ScriptedAgent(driver).chooseAction(both).payload.targetName).toBe(other.name);
  });

  it('walks toward the nearest target, not the nearest foe', () => {
    const driver = gorge(2);
    const b = driver.battle;
    const agent = new ScriptedAgent(driver);
    const unit = b.playerUnits[0];
    // The guards are nearer than either Voice.
    const near = guardsOf(b).map((g) => Math.abs(g.col - unit.col) + Math.abs(g.row - unit.row));
    const far = targetsOf(b).map((t) => Math.abs(t.col - unit.col) + Math.abs(t.row - unit.row));
    expect(Math.min(...near)).toBeLessThan(Math.min(...far));
    expect(agent._findNearestEnemy(unit).authoredId).toMatch(/^voice_/);
    // Once the targets are down the old rule stands: the nearest foe.
    for (const t of targetsOf(b)) b.enemyUnits.splice(b.enemyUnits.indexOf(t), 1);
    expect(agent._findNearestEnemy(unit).authoredId).toBeUndefined();
  });

  it('a map with no objectives model keeps the nearest foe and the old strike order', () => {
    const driver = gorge(3);
    const b = driver.battle;
    delete b.battleConfig.objectives;
    const agent = new ScriptedAgent(driver);
    const unit = b.playerUnits[0];
    expect(agent._findNearestEnemy(unit).authoredId).toBeUndefined(); // a guard
    const [guard] = guardsOf(b);
    const target = b.enemyUnits.find((u) => u.authoredId === 'voice_a');
    guard.currentHP = 5;
    target.currentHP = 30;
    const legal = [
      { type: 'choose_target', payload: { targetName: target.name } },
      { type: 'choose_target', payload: { targetName: guard.name } },
    ];
    // Lowest HP first, as before.
    expect(agent.chooseAction(legal).payload.targetName).toBe(guard.name);
  });
});

describe('TacticianAgent on a defeat map', () => {
  it('advances on the targets and wins within par and a margin', async () => {
    for (const seed of [1, 2, 3]) {
      const driver = gorge(seed);
      const b = driver.battle;
      const par = b.turnPar;
      await play(driver, new TacticianAgent(driver));
      expect(b.result, `seed ${seed}`).toBe('victory');
      expect(targetsOf(b), `seed ${seed}`).toEqual([]);
      expect(b.turnManager.turnNumber, `seed ${seed}`).toBeLessThanOrEqual(par + 2);
      expect(checkInvariants(driver)).toEqual([]);
    }
  });

  it('advances from turn one while a target stands, and holds (bait and punish) without a model', () => {
    const driver = gorge(4);
    const b = driver.battle;
    const agent = new TacticianAgent(driver);
    expect(agent._defeatTargets().map((u) => u.authoredId)).toEqual(['voice_a', 'voice_b']);
    expect(b.turnManager.turnNumber).toBe(1);
    expect(agent._advancing(1)).toBe(true);
    // Every target down: the objective is met, and the old rule is all that is left.
    for (const t of targetsOf(b)) b.enemyUnits.splice(b.enemyUnits.indexOf(t), 1);
    expect(agent._defeatTargets()).toEqual([]);
    expect(agent._advancing(1)).toBe(false);
    expect(agent._advancing(3)).toBe(true); // two quiet turns
    // A map with no model reads the old rule too.
    const plain = gorge(4);
    delete plain.battle.battleConfig.objectives;
    expect(new TacticianAgent(plain)._advancing(1)).toBe(false);
  });

  it('with nothing to strike, it closes on the targets, not on the nearer guard', () => {
    const driver = gorge(4);
    const b = driver.battle;
    const unit = b.playerUnits[0];
    b.playerUnits = [unit];
    unit.weapon = null; // nothing in reach is worth striking: only the advance is scored
    unit.inventory = [];
    Object.assign(unit, { col: 0, row: 3 });
    const toTarget = (tile) =>
      Math.min(...targetsOf(b).map((t) => Math.abs(t.col - tile.col) + Math.abs(t.row - tile.row)));
    const plan = new TacticianAgent(driver)._bestPlan();
    expect(plan.action).toBe('Wait');
    // The guards sit at column 3, the Voices at column 10: a squad that closed on the nearest
    // foe would sidle toward row 0 or 6 and stay as far from the Voices as it began.
    expect(toTarget(plan.tile)).toBeLessThanOrEqual(toTarget(unit) - 3);
  });

  it('scores a strike on a target above the same strike on a guard', () => {
    const driver = gorge(5);
    const b = driver.battle;
    const agent = new TacticianAgent(driver);
    const unit = b.playerUnits[0];
    const guard = guardsOf(b)[0];
    const target = b.enemyUnits.find((u) => u.authoredId === 'voice_a');
    // Both foes beside the unit, the same class and HP, so only the objective tells them apart.
    guard.className = target.className;
    Object.assign(guard, { stats: { ...target.stats }, weapon: target.weapon });
    guard.currentHP = target.currentHP;
    unit.col = 5;
    unit.row = 3;
    Object.assign(guard, { col: 6, row: 3 });
    Object.assign(target, { col: 4, row: 3 });
    for (const e of b.enemyUnits) if (e !== guard && e !== target) e.currentHP = 0;
    // The guard first: with equal scores the plan keeps the first foe it considers.
    b.enemyUnits = [guard, target];
    b.playerUnits = [unit];
    const plan = agent._planFor(unit, agent._threats(), false);
    expect(plan.action).toBe('Attack');
    expect(plan.target).toBe(target);
  });
});
