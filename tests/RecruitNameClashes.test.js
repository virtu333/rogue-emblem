import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';

// A roster screen shows names side by side, so two names that read alike (Kira /
// Lira / Mira) look like one person. Three ways a pair clashes:
//   1. the same name,
//   2. one letter apart (add, drop or change one letter: Kael / Cael, Sefa / Sera),
//   3. two short (4 letters or fewer) names of equal length that rhyme on their last
//      two letters (Kira / Lira, Vera / Zora).
// Units already in a save keep their stored names, so the old names stay in the
// portrait tables; this holds only the names new recruits are dealt.
const distance = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row.push(
        Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)),
      );
    }
    prev = row;
  }
  return prev[b.length];
};

function nameClash(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y || distance(x, y) <= 1) return 'one letter apart';
  if (x.length <= 4 && x.length === y.length && x.slice(-2) === y.slice(-2)) return 'rhyme';
  return null;
}

describe('names a player meets together', () => {
  const data = loadGameData();
  const pool = Object.values(data.recruits.namePool).flat();
  // Lords and the prologue's authored people share the roster with recruits.
  const story = [
    ...data.lords.map((l) => l.name),
    'Gaspar',
    'Tamsin',
    'Varro',
    'Voss',
    'Rowan',
    'Astrid',
  ];
  const everyone = [...new Set([...pool, ...story])];

  it('has no two names in the recruit pool or the story cast that clash', () => {
    const found = [];
    for (let i = 0; i < everyone.length; i++) {
      for (let j = i + 1; j < everyone.length; j++) {
        // Two authored characters (Kira / Sera) are fixed; only a pool name can move.
        if (story.includes(everyone[i]) && story.includes(everyone[j])) continue;
        const why = nameClash(everyone[i], everyone[j]);
        if (why) found.push(`${everyone[i]} / ${everyone[j]}: ${why}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('never lists a name twice in the pool', () => {
    expect(pool.filter((n, i) => pool.indexOf(n) !== i)).toEqual([]);
  });

  it('catches the clashes it is meant to', () => {
    expect(nameClash('Kira', 'Lira')).toBeTruthy();
    expect(nameClash('Mira', 'Zora')).toBe('rhyme');
    expect(nameClash('Cael', 'Kael')).toBeTruthy();
    expect(nameClash('Galvin', 'Galvin')).toBeTruthy();
    expect(nameClash('Edric', 'Brielle')).toBeNull();
  });
});
