// Elite seize battles hold a captain scaled to the node, never the act's boss
// (playtest 2026-09-28: a mid-act elite fielded Act III's L17 Blade Lord, and the
// same boss could wait again at the act's end).
import { describe, expect, it } from 'vitest';
import { generateBattle, eliteCaptains } from '../src/engine/MapGenerator.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const bossNames = new Set(Object.values(data.enemies.bosses).flatMap((l) => l.map((b) => b.name)));
const classTier = (name) => data.classes.find((c) => c.name === name)?.tier;

function seize(params, seed = 7) {
  const random = Math.random;
  let s = seed;
  Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  try {
    return generateBattle({ objective: 'seize', ...params }, data);
  } finally {
    Math.random = random;
  }
}
const throneHolder = (config) => config.enemySpawns.find((e) => e.isBoss);

describe('elite captains', () => {
  it('every captain names a real class and never an act boss', () => {
    for (const [act, list] of Object.entries(data.enemies.elites)) {
      expect(list.length, act).toBeGreaterThan(0);
      for (const entry of list) {
        expect(classTier(entry.className), `${act} ${entry.className}`).toBeTruthy();
        expect(bossNames.has(entry.name), entry.name).toBe(false);
      }
    }
  });

  it('an elite seize in Act III holds a captain at the node’s level, not a L17 boss', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const config = seize({ act: 'act3', isElite: true, levelRange: [10, 13] }, seed);
      const holder = throneHolder(config);
      const captain = data.enemies.elites.act3.find((e) => e.name === holder.name);
      expect(captain, holder.name).toBeTruthy();
      // Promoted captains: top of range (13) + 2 − 10 promotion levels = 5.
      expect(holder.level).toBe(classTier(holder.className) === 'promoted' ? 5 : 15);
    }
  });

  it('the act’s boss node still draws the act’s bosses', () => {
    const acts = ['act2', 'act3'];
    for (const act of acts)
      for (let seed = 1; seed <= 6; seed++) {
        const boss = throneHolder(seize({ act, isBoss: true }, seed));
        expect(data.enemies.bosses[act].map((b) => b.name)).toContain(boss.name);
        const plain = throneHolder(seize({ act }, seed)); // no isElite: the boss node
        expect(data.enemies.bosses[act].map((b) => b.name)).toContain(plain.name);
      }
  });

  it('levels: Act I captains stand at the top of the node’s range; base classes +2 later', () => {
    const act1 = eliteCaptains(data.enemies, 'act1', [2, 3], data.classes);
    expect(act1.every((c) => c.level === 3)).toBe(true);
    const act2 = eliteCaptains(data.enemies, 'act2', [5, 8], data.classes);
    expect(act2.every((c) => c.level === 10)).toBe(true);
    // A promoted captain is never below promoted level 1.
    const low = eliteCaptains(data.enemies, 'act3', [1, 2], data.classes);
    expect(low.every((c) => c.level >= 1)).toBe(true);
    // An act without captains keeps the boss list (old data, other campaigns).
    expect(eliteCaptains({ bosses: { act9: [{ name: 'X' }] } }, 'act9', [1, 2])).toEqual([
      { name: 'X' },
    ]);
  });
});
