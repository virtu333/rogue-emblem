// The sims' careful player (sim/lib/TacticianAgent.js) against the Entity's 3×3 body.
//
// The battle measures every range to the Entity from its whole footprint
// (EntitySystem.combatDistance; the anchor is the top-left tile). A planner that measured to
// the anchor alone would miss attacks from beside the rest of the body, plan attacks the battle
// never offers, forecast the counter at the wrong distance, and read the Entity's own strike
// (range 2 from any body tile: AIController._decideEntityAction, ThreatForecast) wrongly both
// ways. Every expected distance below is counted by hand on the map drawn here.
//
//   Entity anchored at (2,2): body cols 2-4, rows 2-4.
//
//        col 0 1 2 3 4 5 6 7
//   row 0    . . . . . . . .
//   row 1    . . . . . . . .
//   row 2    . . E E E . . .
//   row 3    . . E E E . . .
//   row 4    . . E E E . . .
//   row 5    . . . . . . . .
//   row 6    . . . . . . . .
import { describe, it, expect, afterEach } from 'vitest';
import { GameDriver } from '../harness/GameDriver.js';
import { loadFixture } from '../fixtures/battles/index.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { distanceFieldToAdjacent } from '../../sim/lib/RescueAgent.js';
import { getCombatForecast, forecastStrikeGroups } from '../../src/engine/Combat.js';
import { hitProbability } from '../../src/engine/HitRoll.js';
import { loadGameData } from '../testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

afterEach(() => restoreMathRandom());

/** One player unit and the Entity on an open plain (no terrain to blur a distance). */
function entityField() {
  installSeed(11);
  const fixture = loadFixture('act1_rout_basic');
  const driver = new GameDriver(data, { ...fixture.battleParams }, fixture.buildRoster(data));
  driver.init();
  const b = driver.battle;
  expect(b.grid.cols).toBeGreaterThanOrEqual(8);
  expect(b.grid.rows).toBeGreaterThanOrEqual(8);
  for (const row of b.grid.mapLayout) row.fill(0); // Plain
  const hero = b.playerUnits[0];
  b.playerUnits = [hero];
  b.npcUnits = [];
  b.enemyUnits = [];
  const entity = b._addEnemyFromSpawn({
    className: 'Entity',
    level: 20,
    col: 2,
    row: 2,
    isBoss: true,
    isEntity: true,
    name: 'The Entity',
  });
  expect(b.enemyUnits).toEqual([entity]);
  // Strong enough that an attack always outscores waiting, so a plan reads as "the agent saw
  // an attack here"; the Entity's blows still land for a little (a counter worth counting).
  const entityPower = Math.max(entity.stats.STR, entity.stats.MAG);
  const entityMight = Math.max(...entity.inventory.map((w) => Number(w.might) || 0));
  Object.assign(hero.stats, {
    HP: 200,
    STR: 60,
    SKL: 40,
    SPD: 40,
    LCK: 40,
    DEF: entityPower + entityMight - 3,
    RES: entityPower + entityMight - 3,
  });
  hero.currentHP = 200;
  hero.proficiencies = [
    { type: 'Sword', rank: 'Mast' },
    { type: 'Bow', rank: 'Mast' },
  ];
  return { driver, b, hero, entity };
}

/** Puts `unit` on (col, row) unable to move: the plan is about that one tile. */
function standAt(unit, col, row) {
  unit.col = col;
  unit.row = row;
  unit.stats.MOV = 0;
  unit.hasActed = false;
}

const expectedDamage = (side) =>
  forecastStrikeGroups(side).reduce(
    (sum, g) => sum + Math.max(0, Number(g.damage) || 0) * hitProbability(g.hit) * g.count,
    0,
  );

describe('TacticianAgent: the Entity is its whole body', () => {
  it('attacks from beside a body tile far from the anchor, and the battle takes the attack', async () => {
    const { driver, hero, entity } = entityField();
    entity.currentHP = 1;
    hero.inventory = [weapon('Iron Sword')];
    hero.weapon = hero.inventory[0];
    // Right of the bottom-right body tile (4,4): 1 from the body, 5 from the anchor.
    standAt(hero, 5, 4);
    const agent = new TacticianAgent(driver);
    let struck = false;
    // One unit's turn: select, move, choose, target (or Wait, which ends it).
    for (let i = 0; i < 6 && !struck && !hero.hasActed; i++) {
      const legal = driver.listLegalActions();
      const action = agent.chooseAction(legal);
      if (action.type === 'choose_target') {
        // The harness offered the Entity and the agent took it.
        expect(legal.map((a) => a.payload.targetName)).toContain('The Entity');
        expect(action.payload.targetName).toBe('The Entity');
        struck = true;
      }
      await driver.step(action);
    }
    expect(agent.plan).toMatchObject({ action: 'Attack', target: entity, d: 1 });
    expect(struck).toBe(true);
  });

  it('sees an attack from exactly the tiles the battle offers one from (sword and bow)', () => {
    for (const kit of [['Iron Sword'], ['Iron Bow'], ['Iron Sword', 'Iron Bow']]) {
      const { driver, b, hero, entity } = entityField();
      entity.currentHP = 1;
      hero.inventory = kit.map(weapon);
      hero.weapon = hero.inventory[0];
      const agent = new TacticianAgent(driver);
      const mismatches = [];
      let offered = 0;
      for (let col = 0; col <= 7; col++) {
        for (let row = 0; row <= 7; row++) {
          if (col >= 2 && col <= 4 && row >= 2 && row <= 4) continue; // the body
          standAt(hero, col, row);
          const legal = b._findAttackTargets(hero).includes(entity);
          if (legal) offered++;
          const plan = agent._planFor(hero, agent._threats(), false);
          const planned = plan?.action === 'Attack' && plan.target === entity;
          if (planned !== legal) mismatches.push({ col, row, legal, planned });
        }
      }
      // Sword: the 12 tiles touching the body. Bow (range 2): the 16 tiles two away.
      const want = { 'Iron Sword': 12, 'Iron Bow': 16, 'Iron Sword,Iron Bow': 28 }[kit.join()];
      expect(offered).toBe(want);
      expect(mismatches).toEqual([]);
    }
  });

  it('forecasts the counter at the distance from the body', () => {
    const { driver, hero, entity } = entityField();
    entity.currentHP = 1;
    hero.inventory = [weapon('Iron Bow')];
    hero.weapon = hero.inventory[0];
    // Two below the bottom-middle body tile (3,4): 2 from the body, 5 from the anchor.
    standAt(hero, 3, 6);
    const agent = new TacticianAgent(driver);
    const plan = agent._planFor(hero, agent._threats(), false);
    expect(plan).toMatchObject({ action: 'Attack', target: entity, d: 2 });
    // The Entity's weapons reach 1-4, so it answers a bow from two tiles.
    const fc = getCombatForecast(
      { ...hero, weapon: hero.weapon },
      hero.weapon,
      entity,
      entity.weapon,
      2,
      null,
      null,
      { skillsData: data.skills },
    );
    expect(fc.defender.canCounter).toBe(true);
    expect(plan.taken).toBeGreaterThan(0);
    expect(plan.taken).toBeCloseTo(expectedDamage(fc.defender), 6);
  });

  it("reads the Entity's strike as range 2 from any body tile", () => {
    const { driver, hero } = entityField();
    standAt(hero, 0, 7);
    const agent = new TacticianAgent(driver);
    const threats = agent._threats();
    const attackers = (col, row) => agent._danger(hero, { col, row }, threats).attackers;
    // Two below the bottom-right body tile (4,4): 2 from the body, 6 from the anchor.
    expect(attackers(4, 6)).toBe(1);
    // Two right of the middle-right body tile (4,3): 2 from the body, 5 from the anchor.
    expect(attackers(6, 3)).toBe(1);
    // Up-left of the anchor: 3 from the body (the anchor is its nearest tile). Inside the
    // Entity's weapon range (1-4) but outside the range it strikes at (2).
    expect(attackers(0, 1)).toBe(0);
    // Three right of the body: out of reach.
    expect(attackers(7, 3)).toBe(0);
  });

  it("advances to the body's edge, not the anchor's neighbours (seize boss field)", () => {
    const { b, entity } = entityField();
    const field = distanceFieldToAdjacent(b.grid, entity, 'Infantry');
    const at = (col, row) => field.get(`${col},${row}`);
    // Every tile touching the body is a goal (12 of them), wherever it is.
    for (const [col, row] of [
      [1, 2],
      [2, 1],
      [5, 4],
      [4, 5],
      [5, 2],
      [1, 4],
    ])
      expect(at(col, row)).toBe(0);
    // The body is never a goal nor a road.
    for (let col = 2; col <= 4; col++)
      for (let row = 2; row <= 4; row++) expect(at(col, row)).toBeUndefined();
    // Two right of the body: one step to the edge (Plain costs 1).
    expect(at(6, 3)).toBe(1);
    expect([...field.values()].filter((d) => d === 0)).toHaveLength(12);
  });
});
