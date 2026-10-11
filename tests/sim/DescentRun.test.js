// A headless run through the Descent (docs/specs/act-v-descent.md §2) on each route, with the
// route switched on for the test: the full-run driver walks Act V from its first node to the
// finale through the real RunManager, HeadlessBattle maps (every set piece, the defeat and
// seize objectives, the Entity's template) and event commands. The army is made strong and
// invincible (the driver's own option) so the walk tests the route's flow, not the balance: every
// battle must still end in a real victory (its objective met), never the driver's forced one.
import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { RunSimulationDriver } from './RunSimulationDriver.js';

const baseData = loadGameData();
const descentData = () => ({
  ...baseData,
  descent: { ...structuredClone(baseData.descent), enabled: true },
});

async function walkTheDescent(difficultyId, seed) {
  installSeed(seed);
  try {
    const driver = new RunSimulationDriver(descentData(), {
      runOptions: { runSeed: seed, difficultyId, autoSelectBlessing: false },
      invincibility: true,
      maxBattleActions: 1500,
    });
    driver.init();
    const run = driver.runManager;
    run.actIndex = run.actSequence.indexOf('finalBoss') - 1;
    run.advanceAct();
    for (const unit of run.roster) {
      Object.assign(unit.stats, { HP: 80, STR: 45, MAG: 45, SKL: 40, SPD: 40, DEF: 40, RES: 40 });
      unit.currentHP = unit.stats.HP;
    }
    const visionAtEntry = run.visionChargesRemaining;
    const result = await driver.run();
    return { result, run, visionAtEntry };
  } finally {
    restoreMathRandom();
  }
}

const keysWalked = (run, result) =>
  result.trace.map((step) => run.nodeMap.nodes.find((n) => n.id === step.nodeId)?.descentKey);

/** Every battle the walk fought ended on its objective (no forced win, no timeout). */
function expectRealVictories(result) {
  const battles = result.trace.filter((step) => ['battle', 'boss'].includes(step.nodeType));
  expect(battles.length).toBeGreaterThan(0);
  for (const step of battles) expect(step.result, step.nodeId).toBe('victory');
  expect(result.metrics.forcedBattleWins || 0).toBe(0);
}

describe('a headless run through the Descent', () => {
  it('First Light: the stair, the Column, the Vigil, the Ruins, then the Lieutenant ends it', async () => {
    const { result, run } = await walkTheDescent('normal', 41);
    expect(result.result).toBe('victory');
    expect(run.status).not.toBe('defeat');
    expect(run.nodeMap.descent.routeId).toBe('lieutenant');
    expect(keysWalked(run, result)).toEqual(['stair', 'column', 'vigil', 'ruins', 'lieutenant']);
    expectRealVictories(result);
    expect(run.isRunComplete()).toBe(true);
  }, 120_000);

  it('Nightfall: past the Landing, the gate opens on the Ruins and the Entity ends it', async () => {
    const { result, run, visionAtEntry } = await walkTheDescent('hard', 43);
    expect(result.result).toBe('victory');
    expect(run.nodeMap.descent.routeId).toBe('entity');
    expect(keysWalked(run, result)).toEqual([
      'stair',
      'column',
      'vigil',
      'landing',
      'gate',
      'ruins',
      'entity',
    ]);
    expectRealVictories(result);
    // The gate's charge (+1), and nothing at the finale.
    expect(run.visionChargesRemaining).toBe(visionAtEntry + 1);
    expect(run.isRunComplete()).toBe(true);
    // The Landing met the Descent's pool.
    const landing = run.nodeMap.nodes.find((n) => n.descentKey === 'landing');
    expect(run.eventStateByNodeId[landing.id]?.eventId).toBe('came_this_far');
  }, 120_000);
});
