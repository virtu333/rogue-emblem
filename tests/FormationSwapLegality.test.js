import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { FormationController } from '../src/ui/FormationController.js';
import { createFormation, placeUnit } from '../src/engine/FormationPlacement.js';

// Tile 0 is a Mountain (no Cavalry), tile 1 a Plain, tile 2 a spare Plain.
const tiles = [
  { col: 0, row: 0 },
  { col: 1, row: 0 },
  { col: 2, row: 0 },
];
const mountain = 0;
function controller() {
  const c = Object.create(FormationController.prototype);
  c.units = [
    { name: 'Astrid', moveType: 'Flying' },
    { name: 'Rowan', moveType: 'Cavalry' },
  ];
  c.tiles = tiles;
  c.leniency = ['strict', 'strict'];
  c.rules = {
    issue: (moveType, t) =>
      moveType === 'Cavalry' && t === mountain ? "Cavalry units can't stand on Mountain." : '',
  };
  c.syncField = () => {};
  c.formation = createFormation(2, tiles);
  return c;
}

describe('formation swaps respect where the displaced unit may stand', () => {
  it('placeUnit benches an occupant that may not take the vacated tile', () => {
    let f = createFormation(2, tiles);
    f = placeUnit(f, 0, 0);
    f = placeUnit(f, 1, 1);
    const allowed = (u, t) => !(u === 1 && t === mountain);
    expect(placeUnit(f, 0, 1, allowed).at).toEqual([1, null]);
    // Allowed swaps still swap.
    expect(placeUnit(f, 0, 1).at).toEqual([1, 0]);
  });

  it('moving a flier onto a cavalier never puts the cavalier on a mountain', () => {
    const c = controller();
    expect(c.assign(0, mountain)).toBe(true);
    expect(c.assign(1, 1)).toBe(true);
    expect(c.complete()).toBe(true);
    // The picker warns before the pick: the cavalier would wait, not swap.
    expect(c.displaces(0, 1)).toBe(true);
    expect(c.assign(0, 1)).toBe(true);
    expect(c.formation.at).toEqual([1, null]);
    // Start stays off until the cavalier is placed somewhere it can stand.
    expect(c.complete()).toBe(false);
    expect(c.assign(1, mountain)).toBe(false);
    expect(c.assign(1, 2)).toBe(true);
    expect(c.complete()).toBe(true);
  });

  it('a legal swap still swaps', () => {
    const c = controller();
    c.assign(0, 1);
    c.assign(1, 2);
    expect(c.displaces(0, 2)).toBe(false);
    c.assign(0, 2);
    expect(c.formation.at).toEqual([2, 1]);
  });

  it('Start stays off for an illegal layout however it arose', () => {
    const c = controller();
    c.formation = { ...c.formation, at: [1, mountain] };
    expect(c.complete()).toBe(false);
  });
});
