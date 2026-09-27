// UnarmedBattle.test.js — full headless battles with player units that carry no
// weapon (docs/specs/item-trade.md, "Unarmed units").
//
// Three kinds of "unarmed" are deployed next to an armed commander:
//   bare      — inventory [], weapon null, no supplies
//   supplies  — inventory [], weapon null, a Vulnerary
//   staffOnly — only a Heal staff it has no rank for (weapon null)
// The failures this guards against: a crash anywhere in a battle (menus, targeting,
// the enemy phase, AI scoring, XP, deaths), an unarmed unit offered Attack or
// striking at all (as attacker or as a counter), and invariant breaks.
import { describe, it, expect } from 'vitest';
import { GameDriver } from './GameDriver.js';
import { HEADLESS_STATES } from './HeadlessBattle.js';
import { checkInvariants, createInvariantContext, updateContext } from './Invariants.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { FuzzAgent } from '../agents/FuzzAgent.js';
import { loadFixture } from '../fixtures/battles/index.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

const KINDS = ['bare', 'supplies', 'staffOnly'];

function disarm(unit, kind, gameData) {
  unit.inventory = [];
  unit.weapon = null;
  unit.consumables = [];
  if (kind === 'supplies') {
    unit.consumables = [structuredClone(gameData.consumables.find((c) => c.name === 'Vulnerary'))];
  }
  if (kind === 'staffOnly') {
    unit.proficiencies = unit.proficiencies.filter((p) => p.type !== 'Staff');
    unit.inventory = [structuredClone(gameData.weapons.find((w) => w.name === 'Heal'))];
  }
  unit._unarmedKind = kind;
}

/** A roster fixture's units with every non-commander disarmed, cycling through KINDS. */
function unarmedRoster(rosterFixture, gameData) {
  const roster = loadFixture(rosterFixture).buildRoster(gameData);
  let k = 0;
  for (const unit of roster) {
    if (unit.name === 'Edric') continue;
    disarm(unit, KINDS[k++ % KINDS.length], gameData);
  }
  return roster;
}

/**
 * Drive one battle to its end, recording every strike. Returns the log and result.
 */
async function runBattle(scenario, seed, agentFactory, maxActions = 2500) {
  const [fixtureName, rosterFixture = fixtureName] = scenario;
  installSeed(seed);
  try {
    const gameData = loadGameData();
    const fixture = loadFixture(fixtureName);
    const roster = unarmedRoster(rosterFixture, gameData);
    const unarmed = new Set(roster.filter((u) => u._unarmedKind));
    const driver = new GameDriver(
      gameData,
      { ...fixture.battleParams, runSeed: seed, nodeId: fixtureName },
      roster,
    );
    driver.init();
    const battle = driver.battle;
    const log = { strikesByUnarmed: 0, attackedUnarmed: 0, attackOffered: 0, waits: 0 };
    const record = (attacker, defender, result) => {
      for (const event of result?.events || []) {
        if (event.type !== 'strike') continue;
        const striker = event.attackerSide === 'defender' ? defender : attacker;
        if (unarmed.has(striker)) log.strikesByUnarmed++;
      }
      if (unarmed.has(defender)) log.attackedUnarmed++;
    };
    // Both combat paths (player and enemy initiated) report each resolved exchange
    // to _recordDeedCombat(attacker, defender, result); listen there.
    const recordDeed = battle._recordDeedCombat.bind(battle);
    battle._recordDeedCombat = (attacker, defender, result) => {
      record(attacker, defender, result);
      return recordDeed(attacker, defender, result);
    };
    const agent = agentFactory(driver);
    const context = createInvariantContext();
    let failure = null;
    for (let i = 0; i < maxActions && !driver.isTerminal(); i++) {
      const legal = driver.listLegalActions();
      if (!legal.length) break;
      if (battle.battleState === HEADLESS_STATES.UNIT_ACTION_MENU) {
        const unit = battle.selectedUnit;
        if (unarmed.has(unit)) {
          if (legal.some((a) => a.payload?.label === 'Attack')) log.attackOffered++;
        }
      }
      const action = agent.chooseAction(legal);
      if (!action) break;
      if (
        action.payload?.label === 'Wait' &&
        battle.battleState === HEADLESS_STATES.UNIT_ACTION_MENU &&
        unarmed.has(battle.selectedUnit)
      )
        log.waits++;
      await driver.step(action);
      updateContext(context, action, driver);
      const errors = checkInvariants(driver, context);
      if (errors.length) {
        failure = errors.join('; ');
        break;
      }
    }
    return { log, failure, result: driver.getTerminalResult(), battle, unarmed };
  } finally {
    restoreMathRandom();
  }
}

// [battle fixture, roster fixture]: the act 1 maps have no roster of their own.
const SCENARIOS = [
  ['act1_rout_basic', 'act2_seize_basic'],
  ['act1_village_race', 'healer_heavy'],
  ['act2_seize_basic'],
  ['act2_escape_pursuit'],
  ['healer_heavy'],
];

describe('full battles with unarmed player units', () => {
  for (const scenario of SCENARIOS) {
    const fixtureName = scenario[0];
    for (const seed of [1, 2, 3]) {
      it(`${fixtureName} seed ${seed}: scripted play never arms, offers Attack to, or crashes on an unarmed unit`, async () => {
        const { log, failure, result, unarmed } = await runBattle(
          scenario,
          seed,
          (d) => new ScriptedAgent(d),
        );
        expect(failure).toBeNull();
        expect(['victory', 'defeat', null]).toContain(result);
        expect(log.attackOffered).toBe(0);
        expect(log.strikesByUnarmed).toBe(0);
        // Nobody armed them along the way.
        for (const unit of unarmed) {
          if (unit._unarmedKind === 'staffOnly')
            expect(unit.inventory.map((w) => w.name)).toEqual(['Heal']);
          else expect(unit.inventory).toEqual([]);
          expect(unit.weapon).toBeNull();
        }
      }, 60000);
    }
    it(`${fixtureName}: random legal play with unarmed units keeps every invariant`, async () => {
      for (const seed of [11, 12]) {
        const { log, failure } = await runBattle(scenario, seed, () => new FuzzAgent(), 1500);
        expect(failure).toBeNull();
        expect(log.attackOffered).toBe(0);
        expect(log.strikesByUnarmed).toBe(0);
      }
    }, 60000);
  }

  it('across the seeds, unarmed units were deployed, attacked by enemies and waited', async () => {
    // Calibration: the scenarios above must actually exercise the unarmed paths.
    let attacked = 0;
    let waits = 0;
    let deployed = 0;
    for (const seed of [1, 2, 3]) {
      const { log, battle, unarmed } = await runBattle(
        SCENARIOS[0],
        seed,
        (d) => new ScriptedAgent(d),
      );
      attacked += log.attackedUnarmed;
      waits += log.waits;
      deployed += [...unarmed].filter(
        (u) => battle.playerUnits.includes(u) || u.currentHP <= 0,
      ).length;
    }
    expect(deployed).toBeGreaterThan(0);
    expect(waits).toBeGreaterThan(0);
    expect(attacked).toBeGreaterThan(0);
  }, 120000);
});
