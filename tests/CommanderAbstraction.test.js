import { describe, it, expect } from 'vitest';
import {
  findCommander,
  stampCommanderFlag,
  DEFAULT_STARTING_LORD_NAMES,
} from '../src/engine/Commander.js';
import { RunManager } from '../src/engine/RunManager.js';
import { resolveRecruitScalingTargets } from '../src/engine/RecruitScaling.js';
import { getAvailableLords } from '../src/engine/BossRecruitSystem.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('Commander module', () => {
  it('findCommander prefers the isCommander flag over Edric by name', () => {
    const kira = { name: 'Kira', isLord: true, isCommander: true };
    const edric = { name: 'Edric', isLord: true };
    expect(findCommander([edric, kira])).toBe(kira);
  });

  it('findCommander falls back to Edric by name (case/whitespace-insensitive)', () => {
    const edric = { name: '  edric ', isLord: true };
    expect(findCommander([{ name: 'Sera', isLord: true }, edric])).toBe(edric);
  });

  it('findCommander never promotes another lord (no flag, no Edric -> null)', () => {
    expect(findCommander([{ name: 'Sera', isLord: true }])).toBe(null);
    expect(findCommander([])).toBe(null);
    expect(findCommander(null)).toBe(null);
  });

  it('stampCommanderFlag stamps Edric in an unflagged pool', () => {
    const edric = { name: 'Edric', isLord: true };
    const sera = { name: 'Sera', isLord: true };
    expect(stampCommanderFlag([sera, edric])).toBe(edric);
    expect(edric.isCommander).toBe(true);
    expect(sera.isCommander).toBeUndefined();
  });

  it('stampCommanderFlag falls back to the first lord when Edric is absent', () => {
    const recruit = { name: 'Mira', isLord: false };
    const sera = { name: 'Sera', isLord: true };
    expect(stampCommanderFlag([recruit, sera])).toBe(sera);
    expect(sera.isCommander).toBe(true);
  });

  it('stampCommanderFlag clears stray duplicate flags', () => {
    const edric = { name: 'Edric', isLord: true, isCommander: true };
    const stray = { name: 'Voss', isLord: true, isCommander: true };
    // Edric appears first, so the flag scan finds him; Voss's flag is a stray.
    expect(stampCommanderFlag([edric, stray])).toBe(edric);
    expect(edric.isCommander).toBe(true);
    expect(stray.isCommander).toBe(false);
  });

  it('stampCommanderFlag returns null for pools without any lord', () => {
    const recruit = { name: 'Mira', isLord: false };
    expect(stampCommanderFlag([recruit])).toBe(null);
    expect(recruit.isCommander).toBeUndefined();
    expect(stampCommanderFlag([])).toBe(null);
  });
});

describe('RunManager commander integration', () => {
  it('createInitialRoster flags exactly one commander (Edric)', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const flagged = rm.roster.filter((u) => u.isCommander === true);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].name).toBe('Edric');
    expect(rm.getCommander()).toBe(flagged[0]);
    expect(rm.getCommanderName()).toBe('Edric');
  });

  it('getStartingLordNames returns a defensive copy of the default pair', () => {
    const rm = new RunManager(gameData);
    const names = rm.getStartingLordNames();
    expect(names).toEqual(['Edric', 'Sera']);
    names.push('Cael');
    expect(rm.getStartingLordNames()).toEqual(['Edric', 'Sera']);
    expect(DEFAULT_STARTING_LORD_NAMES).toEqual(['Edric', 'Sera']);
  });

  it('isCommander survives a serialize/deserialize round-trip', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const restored = RunManager.fromJSON(rm.toJSON(), gameData);
    const flagged = restored.roster.filter((u) => u.isCommander === true);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].name).toBe('Edric');
  });

  it('fromJSON heals a legacy save without commander flags', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();
    for (const unit of saved.roster) delete unit.isCommander;
    const restored = RunManager.fromJSON(saved, gameData);
    expect(restored.getCommander()?.name).toBe('Edric');
    expect(restored.roster.filter((u) => u.isCommander === true)).toHaveLength(1);
  });

  it('fromJSON heals legacy suspend-checkpoint pools, including an escaped commander', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const saved = rm.toJSON();
    for (const unit of saved.roster) delete unit.isCommander;
    // Legacy checkpoint: Edric already escaped, Sera still on the field.
    const [edric, sera] = saved.roster;
    saved.battleInProgress = {
      nodeId: 'node-1',
      checkpoint: {
        playerUnits: [structuredClone(sera)],
        escapedUnits: [structuredClone(edric)],
      },
    };
    const restored = RunManager.fromJSON(saved, gameData);
    const checkpoint = restored.battleInProgress.checkpoint;
    expect(checkpoint.escapedUnits[0].isCommander).toBe(true);
    expect(checkpoint.playerUnits[0].isCommander).not.toBe(true);
  });
});

describe('RecruitScaling commander anchor', () => {
  it('flagged commander takes precedence over Edric by name', () => {
    const result = resolveRecruitScalingTargets([
      { name: 'Edric', tier: 'base', level: 2 },
      { name: 'Kira', tier: 'base', level: 7, isCommander: true },
    ]);
    expect(result.recruitTargetLevel).toBe(7);
  });

  it('a promoted non-Edric commander anchors scaling like promoted Edric would', () => {
    const asCommander = resolveRecruitScalingTargets([
      { name: 'Cael', tier: 'promoted', level: 5, isCommander: true },
    ]);
    const asEdric = resolveRecruitScalingTargets([{ name: 'Edric', tier: 'promoted', level: 5 }]);
    expect(asCommander).toEqual(asEdric);
  });

  it('exposes anchorPromotedLevel with edricPromotedLevel as a deprecated alias', () => {
    const result = resolveRecruitScalingTargets([{ name: 'Edric', tier: 'promoted', level: 3 }]);
    expect(result.anchorPromotedLevel).toBe(3);
    expect(result.edricPromotedLevel).toBe(3);
  });
});

describe('getAvailableLords startingLordNames', () => {
  const lordName = (l) => l.name;

  it('defaults to excluding Edric and Sera', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }];
    const names = getAvailableLords(roster, gameData.lords).map(lordName);
    expect(names).not.toContain('Edric');
    expect(names).not.toContain('Sera');
    expect(names).toContain('Kira');
  });

  it('a custom starting pair frees Edric/Sera for the mid-run pool', () => {
    const roster = [{ name: 'Cael' }, { name: 'Sera' }];
    const names = getAvailableLords(roster, gameData.lords, [], ['Cael', 'Sera']).map(lordName);
    expect(names).toContain('Edric');
    expect(names).not.toContain('Cael'); // excluded as starting lord (and in roster)
    expect(names).not.toContain('Sera');
  });
});
