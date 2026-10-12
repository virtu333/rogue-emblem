// The encounter check wakes today's hold packs exactly as HoldActivation.wakeHolders did
// (docs/specs/large-maps/02-encounters-and-pacing.md §3.6, PR 2.1): every wake's turn, unit,
// pack and reason, and every battle's end state, match a golden record taken from the build
// before encounter groups. Scenarios: the Determinism.test.js fixtures, 40 seeded Dusk+ seize
// and escape battles, and both shipped event set pieces on every rung and act their event reaches.
//
// Recording: ENCOUNTER_GOLDEN=write npx vitest run tests/harness/EncounterParity.test.js
// (only ever against a build whose wakes are known good).
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ScenarioRunner } from '../agents/ScenarioRunner.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { buildRoster, loadFixture } from '../fixtures/battles/index.js';
import { TacticianAgent } from '../../sim/lib/TacticianAgent.js';
import { HeadlessBattle } from './HeadlessBattle.js';
import { resolveDifficultyMode } from '../../src/engine/DifficultyEngine.js';
import { findSetPiece } from '../../src/engine/SetPieces.js';
import { loadGameData } from '../testData.js';

const data = loadGameData();
const GOLDEN_PATH = fileURLToPath(new URL('./fixtures/encounterWakeGolden.json', import.meta.url));
const WRITE = process.env.ENCOUNTER_GOLDEN === 'write';

function pacing(difficultyId) {
  const m = resolveDifficultyMode(data.difficulty, difficultyId).modifiers;
  return {
    difficultyId,
    holdShare: m.holdShare ?? null,
    routLadder: m.routLadder ?? null,
    objectiveParOffset: m.objectiveParOffset ?? null,
  };
}

function scenarios() {
  const list = [];
  const fixture = (name, seed) => ({ id: `fixture:${name}:${seed}`, seed, fixture: loadFixture(name) }); // prettier-ignore
  list.push(fixture('act1_rout_basic', 12345), fixture('act2_escape_pursuit', 424242));
  list.push(fixture('act2_seize_basic', 99), fixture('act1_village_race', 7));
  const authored = (id, battleParams, seed) => ({ id, seed, fixture: { id, roster: null, battleParams } }); // prettier-ignore
  // A seasoned army, played by the careful TacticianAgent (advancing on a seize map's boss), so
  // battles run long enough to meet every pack: threats, blows, losses and clocks.
  const army = (id, battleParams, seed) => {
    const level = { act1: 8, act2: 12, act3: 16, act4: 19 }[battleParams.act] || 12;
    const spec = [
      { type: 'lord', name: 'Edric', level, extraWeapons: ['Steel Sword', 'Javelin'] },
      { type: 'lord', name: 'Sera', level, staff: true },
      { type: 'recruit', className: 'Cavalier', name: 'Marcus', level },
      { type: 'recruit', className: 'Knight', name: 'Oswin', level },
      { type: 'recruit', className: 'Archer', name: 'Wil', level },
      { type: 'recruit', className: 'Mage', name: 'Lute', level },
    ];
    return { id, seed, tactician: true, fixture: { id, roster: spec, buildRoster: (gd) => buildRoster(spec, gd), battleParams } }; // prettier-ignore
  };
  list.push(
    authored('act4_reinforcement', { act: 'act4', objective: 'rout', row: 3, templateId: 'frozen_pass', difficultyMod: 1.0, difficultyId: 'normal', reinforcementTurnOffset: -2 }, 777), // prettier-ignore
    authored('act4_boss_intent', { act: 'act4', objective: 'seize', row: 11, templateId: 'act4_boss_intent_bastion', difficultyMod: 1.0, difficultyId: 'normal' }, 1701), // prettier-ignore
    authored('act3_dark_champion', { act: 'act3', objective: 'seize', row: 7, templateId: 'act3_dark_champion_keep', difficultyMod: 1.0, difficultyId: 'normal' }, 1702), // prettier-ignore
  );
  // 40 Dusk+ seize and escape battles: every rung that holds, acts II-IV.
  const rungs = ['dusk', 'hard', 'lunatic'];
  const acts = ['act2', 'act3', 'act4'];
  for (let n = 0; n < 40; n++) {
    const objective = n % 2 === 0 ? 'seize' : 'escape';
    const difficultyId = rungs[n % rungs.length];
    const act = acts[Math.floor(n / 2) % acts.length];
    const id = `garrison:${objective}:${difficultyId}:${act}:${n}`;
    list.push(army(id, { act, objective, deployCount: 6, battleSeed: 3100 + n, ...pacing(difficultyId) }, 5200 + n)); // prettier-ignore
  }
  // The same garrisons met by a reckless charge (ScriptedAgent): ranged blows on a holder.
  for (let n = 0; n < 12; n++) {
    const objective = n % 2 === 0 ? 'seize' : 'escape';
    const difficultyId = rungs[n % rungs.length];
    const act = acts[Math.floor(n / 2) % acts.length];
    const id = `charge:${objective}:${difficultyId}:${act}:${n}`;
    const s = army(id, { act, objective, deployCount: 6, battleSeed: 4100 + n, ...pacing(difficultyId) }, 6200 + n); // prettier-ignore
    list.push({ ...s, tactician: false });
  }
  // The shipped event set pieces (the Toll Bridge event: Acts I-III), on every rung.
  for (const setPiece of ['toll_house', 'toll_crossing']) {
    const deployCap = findSetPiece(data.setPieces, setPiece).deploy.max;
    for (const act of ['act1', 'act2', 'act3']) {
      for (const difficultyId of ['normal', 'dusk', 'hard', 'lunatic']) {
        const id = `setPiece:${setPiece}:${act}:${difficultyId}`;
        list.push(army(id, { act, objective: 'rout', setPiece, deployCap, deployCount: 6, battleSeed: 61, ...pacing(difficultyId) }, 61)); // prettier-ignore
      }
    }
  }
  return list;
}

/** Every unit that changed from holding to woken during an enemy phase, as it happened. */
async function recordWakes(scenario) {
  const wakes = [];
  const original = HeadlessBattle.prototype._processEnemyPhase;
  HeadlessBattle.prototype._processEnemyPhase = async function recorded() {
    const turn = this.turnManager?.turnNumber ?? null;
    const before = new Map(this.enemyUnits.map((u) => [u, u.aiMode === 'hold']));
    try {
      return await original.call(this);
    } finally {
      for (const [unit, held] of before) {
        if (held && unit.aiMode !== 'hold' && unit.holdWoke) {
          wakes.push([turn, unit.name, unit.col, unit.row, unit.holdPack, unit.holdWoke]);
        }
      }
    }
  };
  try {
    const run = await new ScenarioRunner(
      scenario.seed,
      scenario.fixture,
      scenario.tactician
        ? (driver) => new TacticianAgent(driver, { rescue: false, objectives: true })
        : (driver) => new ScriptedAgent(driver),
    ).run(4000);
    return {
      wakes,
      result: run.result,
      actions: run.actions.length,
      initialHash: run.initialHash,
      snapshots: run.periodicSnapshots,
      failure: run.failure?.invariant ?? null,
    };
  } finally {
    HeadlessBattle.prototype._processEnemyPhase = original;
  }
}

describe('encounter groups play today hold packs exactly as before (golden record)', () => {
  const list = scenarios();
  const golden = WRITE ? {} : JSON.parse(readFileSync(GOLDEN_PATH, 'utf8'));

  it('the record covers every scenario and holds wakes of each reason the scenarios reach', () => {
    if (WRITE) return;
    expect(Object.keys(golden).sort()).toEqual(list.map((s) => s.id).sort());
    const reasons = new Set(Object.values(golden).flatMap((g) => g.wakes.map((w) => w[5])));
    // Threats, blows, losses and boss enrage all wake packs, and the Toll Crossing's
    // authored clock wakes its pack on turn 4.
    for (const reason of ['threat', 'hurt', 'fallen', 'turn', 'enrage'])
      expect(reasons).toContain(reason);
  });

  for (const scenario of list) {
    it(
      scenario.id,
      async () => {
        const got = await recordWakes(scenario);
        if (WRITE) {
          golden[scenario.id] = got;
          writeFileSync(GOLDEN_PATH, `${JSON.stringify(golden, null, 1)}\n`);
          return;
        }
        expect(got).toEqual(golden[scenario.id]);
      },
      120_000,
    );
  }
});
