import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { ensureRecruitPreviews } from '../src/engine/RecruitNodeSystem.js';
import { spareRecruitName } from '../src/engine/SpareRecruitName.js';

// A long NG+ ladder can use every name in a thin class pool (Jeff's Dancers). A recruit then
// borrows an unused name from another class's pool before it ever takes a numeral.
describe('a class pool that has run out of names', () => {
  const data = loadGameData();
  const recruits = data.recruits;
  const dancers = recruits.namePool.Dancer;
  const everyName = new Set(Object.values(recruits.namePool).flat());

  const mapOfDancers = () => ({
    actId: 'act1',
    nodes: [{ id: 'n1', type: 'recruit' }],
  });

  it('gives a borrowed name, not "<name> II", when every Dancer name is taken', () => {
    const recruitsOnlyDancers = {
      ...recruits,
      act1: { ...recruits.act1, classPool: ['Dancer'] },
    };
    const map = mapOfDancers();
    ensureRecruitPreviews(map, {
      runSeed: 7,
      recruits: recruitsOnlyDancers,
      usedRecruitNames: { Dancer: [...dancers] },
    });
    const { name, className } = map.nodes[0].recruitPreview;
    expect(className).toBe('Dancer');
    expect(everyName.has(name)).toBe(true);
    expect(dancers).not.toContain(name);
    expect(name).not.toMatch(/ (I|V|X|\d)/);
  });

  it('only numbers a name once every pool name in the game is taken', () => {
    const recruitsOnlyDancers = {
      ...recruits,
      act1: { ...recruits.act1, classPool: ['Dancer'] },
    };
    const map = mapOfDancers();
    ensureRecruitPreviews(map, {
      runSeed: 7,
      recruits: recruitsOnlyDancers,
      usedRecruitNames: { Dancer: [...everyName] },
    });
    expect(map.nodes[0].recruitPreview.name).toMatch(/ II$/);
  });

  it('spareRecruitName skips taken names and reports none left', () => {
    const pool = { A: ['x', 'y'], B: ['y', 'z'] };
    expect(spareRecruitName(pool, new Set(['x', 'y']), () => 0)).toBe('z');
    expect(spareRecruitName(pool, new Set(['x', 'y', 'z']), () => 0)).toBeNull();
  });
});
