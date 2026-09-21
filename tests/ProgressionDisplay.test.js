import { describe, it, expect } from 'vitest';
import { levelUpDisplayResults, progressionRows } from '../src/ui/progressionDisplay.js';

describe('progression display snapshots', () => {
  it('shows each earned level once without changing the final unit or results', () => {
    const stats = { HP: 24, STR: 12, MAG: 3, SKL: 6, SPD: 8, DEF: 4, RES: 3, LCK: 4, MOV: 5 };
    const levels = [
      { newLevel: 2, gains: { STR: 1, HP: 1 } },
      { newLevel: 3, gains: { STR: 1, HP: 1 } },
    ];
    const before = JSON.stringify({ stats, levels });
    const displays = levelUpDisplayResults(stats, levels);
    const first = progressionRows({ stats }, displays[0]);
    const second = progressionRows({ stats }, displays[1]);
    expect(first.find((r) => r.stat === 'STR')).toMatchObject({ before: 10, after: 11, gain: 1 });
    expect(second.find((r) => r.stat === 'STR')).toMatchObject({ before: 11, after: 12, gain: 1 });
    expect(first.map((r) => r.at)).toEqual([120, 240, 360, 480, 600, 720, 840, 960]);
    expect(JSON.stringify({ stats, levels })).toBe(before);
    displays[0].displayStats.STR = 999;
    expect(displays[1].displayStats.STR).toBe(12);
    expect(stats.STR).toBe(12);
  });
  it('shows promotion movement gains, but ordinary level-ups never include MOV', () => {
    const unit = { stats: { HP: 25, MOV: 7 } },
      result = { gains: { MOV: 2 } };
    expect(progressionRows(unit, result, true).at(-1)).toMatchObject({
      stat: 'MOV',
      before: 5,
      after: 7,
    });
    expect(progressionRows(unit, result).some((r) => r.stat === 'MOV')).toBe(false);
  });
});
