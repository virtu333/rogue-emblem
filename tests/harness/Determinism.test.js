// Determinism.test.js — Verify same seed + same scenario produces identical results.

import { describe, it, expect } from 'vitest';
import { ScenarioRunner } from '../agents/ScenarioRunner.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { loadFixture } from '../fixtures/battles/index.js';

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
});
