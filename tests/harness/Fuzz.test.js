// Fuzz.test.js — Fuzz testing: random legal actions on seeded battles.

import { describe, it, expect } from 'vitest';
import { ScenarioRunner } from '../agents/ScenarioRunner.js';
import { FuzzAgent } from '../agents/FuzzAgent.js';
import { ScriptedAgent } from '../agents/ScriptedAgent.js';
import { loadFixture } from '../fixtures/battles/index.js';

describe('Fuzz — act1_rout_basic', () => {
  const fixture = loadFixture('act1_rout_basic');

  for (let seed = 1; seed <= 5; seed++) {
    it(`fuzz seed=${seed} completes without invariant violations`, async () => {
      const runner = new ScenarioRunner(seed, fixture, () => new FuzzAgent());
      const replay = await runner.run(2000);
      expect(replay.failure).toBeNull();
      expect(['victory', 'defeat', 'timeout']).toContain(replay.result);
    }, 30000);
  }

  for (let seed = 1; seed <= 5; seed++) {
    it(`scripted seed=${seed} completes without invariant violations`, async () => {
      const runner = new ScenarioRunner(seed, fixture, (driver) => new ScriptedAgent(driver));
      const replay = await runner.run(2000);
      expect(replay.failure).toBeNull();
      expect(['victory', 'defeat', 'timeout']).toContain(replay.result);
    }, 30000);
  }
});

describe('Fuzz — act2_seize_basic', () => {
  const fixture = loadFixture('act2_seize_basic');

  for (let seed = 1; seed <= 3; seed++) {
    it(`fuzz seed=${seed} completes without invariant violations`, async () => {
      const runner = new ScenarioRunner(seed, fixture, () => new FuzzAgent());
      const replay = await runner.run(2000);
      expect(replay.failure).toBeNull();
      expect(['victory', 'defeat', 'timeout']).toContain(replay.result);
    }, 30000);
  }
});
