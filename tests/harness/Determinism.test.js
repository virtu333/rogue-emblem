// Determinism.test.js — Verify same seed + same scenario produces identical results.

import { describe, it, expect } from 'vitest';
import { ScenarioRunner } from '../agents/ScenarioRunner.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { loadFixture } from '../fixtures/battles/index.js';

const ACT4_BOSS_INTENT_TEMPLATE_ID = 'act4_boss_intent_bastion';
const ACT3_DARK_CHAMPION_TEMPLATE_ID = 'act3_dark_champion_keep';

describe('Determinism', () => {
  it('same seed produces identical action log and final hash', async () => {
    const fixture = loadFixture('act1_rout_basic');
    const factory = (driver) => new ScriptedAgent(driver);

    const run1 = await new ScenarioRunner(12345, fixture, factory).run(2000);
    const run2 = await new ScenarioRunner(12345, fixture, factory).run(2000);

    // Action logs must be identical
    expect(run1.actions.length).toBe(run2.actions.length);
    for (let i = 0; i < run1.actions.length; i++) {
      expect(run1.actions[i]).toEqual(run2.actions[i]);
    }

    // Final result must match
    expect(run1.result).toBe(run2.result);
  });

  it('periodic snapshots match between identical runs', async () => {
    const fixture = loadFixture('act1_rout_basic');
    const factory = (driver) => new ScriptedAgent(driver);

    const run1 = await new ScenarioRunner(12345, fixture, factory).run(2000);
    const run2 = await new ScenarioRunner(12345, fixture, factory).run(2000);

    // All periodic snapshots must match
    const keys1 = Object.keys(run1.periodicSnapshots);
    const keys2 = Object.keys(run2.periodicSnapshots);
    expect(keys1).toEqual(keys2);
    for (const key of keys1) {
      expect(run1.periodicSnapshots[key]).toBe(run2.periodicSnapshots[key]);
    }
  });

  it('different seeds produce different results', async () => {
    const fixture = loadFixture('act1_rout_basic');
    const factory = (driver) => new ScriptedAgent(driver);

    const run1 = await new ScenarioRunner(12345, fixture, factory).run(2000);
    const run2 = await new ScenarioRunner(12346, fixture, factory).run(2000);

    // At least one of these should differ (extremely unlikely to be identical)
    const differ = run1.initialHash !== run2.initialHash ||
      run1.actions.length !== run2.actions.length ||
      JSON.stringify(run1.actions) !== JSON.stringify(run2.actions);
    expect(differ).toBe(true);
  });

  it('act4 reinforcement scenario is deterministic for same seed', async () => {
    const fixture = {
      id: 'act4_reinforcement_determinism',
      roster: null,
      battleParams: {
        act: 'act4',
        objective: 'rout',
        row: 3,
        templateId: 'frozen_pass',
        difficultyMod: 1.0,
        difficultyId: 'normal',
        reinforcementTurnOffset: -2,
      },
    };
    const factory = (driver) => new ScriptedAgent(driver);

    const run1 = await new ScenarioRunner(777, fixture, factory).run(2200);
    const run2 = await new ScenarioRunner(777, fixture, factory).run(2200);

    expect(run1.actions).toEqual(run2.actions);
    expect(run1.result).toBe(run2.result);
    expect(run1.failure).toEqual(run2.failure);
  });

  it('act4 boss-intent scripted seize scenario is deterministic for same seed', async () => {
    const fixture = {
      id: 'act4_boss_intent_scripted_determinism',
      roster: null,
      battleParams: {
        act: 'act4',
        objective: 'seize',
        row: 11,
        templateId: ACT4_BOSS_INTENT_TEMPLATE_ID,
        difficultyMod: 1.0,
        difficultyId: 'normal',
      },
    };
    const factory = (driver) => new ScriptedAgent(driver);

    const run1 = await new ScenarioRunner(1701, fixture, factory).run(2200);
    const run2 = await new ScenarioRunner(1701, fixture, factory).run(2200);

    expect(run1.resolvedTemplateId).toBe(ACT4_BOSS_INTENT_TEMPLATE_ID);
    expect(run2.resolvedTemplateId).toBe(ACT4_BOSS_INTENT_TEMPLATE_ID);
    expect(run1.actions).toEqual(run2.actions);
    expect(run1.result).toBe(run2.result);
    expect(run1.failure).toEqual(run2.failure);
  });

  it('act3 dark-champion scripted seize scenario is deterministic for same seed', async () => {
    const fixture = {
      id: 'act3_dark_champion_scripted_determinism',
      roster: null,
      battleParams: {
        act: 'act3',
        objective: 'seize',
        row: 7,
        templateId: ACT3_DARK_CHAMPION_TEMPLATE_ID,
        difficultyMod: 1.0,
        difficultyId: 'normal',
      },
    };
    const factory = (driver) => new ScriptedAgent(driver);

    const run1 = await new ScenarioRunner(1702, fixture, factory).run(2200);
    const run2 = await new ScenarioRunner(1702, fixture, factory).run(2200);

    expect(run1.resolvedTemplateId).toBe(ACT3_DARK_CHAMPION_TEMPLATE_ID);
    expect(run2.resolvedTemplateId).toBe(ACT3_DARK_CHAMPION_TEMPLATE_ID);
    expect(run1.actions).toEqual(run2.actions);
    expect(run1.result).toBe(run2.result);
    expect(run1.failure).toEqual(run2.failure);
  });

  it('ScenarioRunner injects default runSeed/nodeId for harness-runtime seed parity', async () => {
    const fixture = loadFixture('act1_rout_basic');
    let capturedParams = null;
    const factory = (driver) => {
      capturedParams = {
        runSeed: driver?.battle?.battleParams?.runSeed,
        nodeId: driver?.battle?.battleParams?.nodeId,
      };
      return new ScriptedAgent(driver);
    };

    await new ScenarioRunner(12345, fixture, factory).run(1);

    expect(capturedParams).toEqual({
      runSeed: 12345 >>> 0,
      nodeId: fixture.id,
    });
  });
});
