// battleParams.deployCount: how many units a battle deployed. A resumed battle has no
// deployment (its units come from the checkpoint) and must keep the recorded count, or
// the Last (four or more deployed) can never be earned in a resumed battle.
import { describe, expect, it } from 'vitest';
import {
  battleDeployCount,
  resolveDeployLimits,
  rosterDeploySlots,
} from '../src/engine/BattleDeployCount.js';
import { DEPLOY_LIMITS } from '../src/utils/constants.js';

const roster = (n) => Array.from({ length: n }, (_, i) => ({ name: `U${i}` }));

describe('battleDeployCount', () => {
  it('a fresh battle counts the deployed roster', () => {
    expect(battleDeployCount({ deployedRoster: roster(5) })).toBe(5);
    expect(battleDeployCount({ deployedRoster: roster(1), recorded: 6 })).toBe(1);
  });

  it('a resumed battle keeps the count recorded when it began', () => {
    expect(battleDeployCount({ resuming: true, recorded: 5 })).toBe(5);
    expect(battleDeployCount({ resuming: true, recorded: 8 })).toBe(8);
  });

  it('a resumed battle without a usable record falls back to 2', () => {
    for (const recorded of [undefined, null, 0, -3, 2.5, 'x'])
      expect(battleDeployCount({ resuming: true, recorded })).toBe(2);
  });

  it('a standalone battle without a roster is two', () => {
    expect(battleDeployCount({ recorded: 5 })).toBe(2);
  });
});

describe('resolveDeployLimits', () => {
  const act3 = { min: 5, max: 6 };

  it('adds the deploy bonus to the max only: a bonus opens slots, never requires units', () => {
    expect(resolveDeployLimits({ base: act3, deployBonus: 1 })).toEqual({
      min: 5,
      max: 7,
      lockedTo: null,
    });
    // Tactical Advantage and the Scout Blessing together.
    expect(resolveDeployLimits({ base: { min: 5, max: 8 }, deployBonus: 2 })).toEqual({
      min: 5,
      max: 10,
      lockedTo: null,
    });
  });

  it('the act table: Acts 1-2 unchanged, Act 3 5-7, Act 4 and the endgame 5-8', () => {
    expect(DEPLOY_LIMITS.act1).toEqual({ min: 3, max: 4 });
    expect(DEPLOY_LIMITS.act2).toEqual({ min: 4, max: 5 });
    expect(DEPLOY_LIMITS.act3).toEqual({ min: 5, max: 7 });
    for (const act of ['act4', 'postAct', 'finalBoss'])
      expect(DEPLOY_LIMITS[act], act).toEqual({ min: 5, max: 8 });
  });

  it('a bonus on a locked map still cannot deploy past its spawns', () => {
    expect(resolveDeployLimits({ base: act3, deployBonus: 2, lockedSpawnCount: 7 })).toEqual({
      min: 5,
      max: 7,
      lockedTo: 7,
    });
  });

  it('a locked map with fewer spawns lowers the cap (and the minimum with it)', () => {
    expect(resolveDeployLimits({ base: act3, lockedSpawnCount: 5 })).toEqual({
      min: 5,
      max: 5,
      lockedTo: 5,
    });
    expect(resolveDeployLimits({ base: act3, lockedSpawnCount: 3 })).toEqual({
      min: 3,
      max: 3,
      lockedTo: 3,
    });
  });

  it('a lock at or above the cap, or no usable lock, changes nothing', () => {
    for (const lockedSpawnCount of [6, 9, null, undefined, 0, -1, 2.5])
      expect(resolveDeployLimits({ base: act3, lockedSpawnCount })).toEqual({
        min: 5,
        max: 6,
        lockedTo: null,
      });
  });
});

// The roster header shows how many units the act's battles field: the deploy screen's
// max (the act's max plus the deploy bonus), for the run's current act.
describe('rosterDeploySlots', () => {
  const run = ({ act = 'act1', bonus = 0, units = 6, mode = 'standard' } = {}) => ({
    mode,
    currentAct: act,
    getDeployBonus: () => bonus,
    roster: roster(units),
  });

  it("is the current act's max (Act I 4, Act II 5, Act III 7, Act IV 8)", () => {
    expect(rosterDeploySlots(run({ act: 'act1' }))).toEqual({ slots: 4, bonus: 0, units: 6 });
    expect(rosterDeploySlots(run({ act: 'act2' })).slots).toBe(5);
    expect(rosterDeploySlots(run({ act: 'act3' })).slots).toBe(7);
    expect(rosterDeploySlots(run({ act: 'act4' })).slots).toBe(8);
    expect(rosterDeploySlots(run({ act: 'finalBoss' })).slots).toBe(8);
  });

  it('adds the deploy bonus (Tactical Advantage, Scout Blessing)', () => {
    expect(rosterDeploySlots(run({ act: 'act2', bonus: 2 }))).toMatchObject({
      slots: 7,
      bonus: 2,
    });
  });

  it('is the same max the deploy screen opens on an unlocked battle', () => {
    for (const act of Object.keys(DEPLOY_LIMITS))
      expect(rosterDeploySlots(run({ act, bonus: 1 })).slots).toBe(
        resolveDeployLimits({ base: DEPLOY_LIMITS[act], deployBonus: 1 }).max,
      );
  });

  it('is null with no run and in the prologue, whose chapters author their deploys', () => {
    expect(rosterDeploySlots(null)).toBeNull();
    expect(rosterDeploySlots(run({ mode: 'prologue' }))).toBeNull();
  });
});
