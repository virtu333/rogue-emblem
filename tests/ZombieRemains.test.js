// Zombie remains rules (engine/ZombieRemains.js): who leaves remains, when they rise,
// what Smash can reach, and that none of it draws on randomness. Ways this can break:
//   - a Light kill, a boss or an already-risen zombie leaves remains (or a normal kill
//     does not)
//   - the countdown drifts from the number of enemy phases actually left (the kill in
//     an enemy phase misses that phase's tick)
//   - a tick mutates the saved list (resume / Vision would replay a changed record)
//   - Smash removes the wrong record, or more than one, or rolls anything
//   - Smash reaches past a weapon's range, lets a staff or a silenced tome smash, or
//     targets remains the fog hides
//   - legacy records (no `seen`) disappear from the board
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REMAINS_RISE_PHASES,
  buildRisenUnit,
  createRemains,
  isRemainsKnown,
  knownRemainsTiles,
  leavesRemains,
  noteRemainsSeen,
  remainsInReach,
  remainsInfoLine,
  riseTile,
  smashRemains,
  tickRemains,
} from '../src/engine/ZombieRemains.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

afterEach(() => vi.restoreAllMocks());

const zombie = (over = {}) => ({
  name: 'Zombie',
  className: 'Zombie',
  level: 7,
  tier: 'base',
  moveType: 'Infantry',
  mov: 4,
  skills: ['zombie_drain'],
  stats: { HP: 31, STR: 9, MAG: 0, SKL: 3, SPD: 2, DEF: 4, RES: 0, LCK: 0, MOV: 4 },
  weapon: { name: 'Claws', type: 'Axe', might: 5 },
  inventory: [{ name: 'Claws', type: 'Axe', might: 5 }],
  proficiencies: [{ type: 'Axe', rank: 'Prof' }],
  ...over,
});
const sword = { weapon: { name: 'Iron Sword', type: 'Sword' } };
const record = (col, row, turnsRemaining = 3, over = {}) => ({
  ...createRemains(zombie(), { col, row }, { seen: true }),
  turnsRemaining,
  ...over,
});

describe('who leaves remains', () => {
  it('a Zombie or Revenant felled by steel, a bow, a tome or nothing at all', () => {
    for (const className of ['Zombie', 'Revenant']) {
      for (const killer of [sword, { weapon: { type: 'Bow' } }, { weapon: { type: 'Tome' } }, null])
        expect(leavesRemains(zombie({ className }), killer)).toBe(true);
    }
  });

  it('never after Light, never a boss, never one that already rose, never other classes', () => {
    expect(leavesRemains(zombie(), { weapon: { type: 'Light' } })).toBe(false);
    expect(leavesRemains(zombie({ isBoss: true }), sword)).toBe(false);
    expect(leavesRemains(zombie({ _revived: true }), sword)).toBe(false);
    expect(leavesRemains(zombie({ className: 'Fighter' }), sword)).toBe(false);
  });

  it('the record keeps the tile, a 3-phase count, whether it was seen and a copy of the unit', () => {
    const unit = zombie();
    const made = createRemains(unit, { col: 4, row: 2 }, { seen: false });
    expect(made).toMatchObject({ col: 4, row: 2, turnsRemaining: 3, seen: false });
    expect(REMAINS_RISE_PHASES).toBe(3);
    unit.weapon.might = 99;
    unit.stats.HP = 1;
    expect(made.snapshot.weapon.might).toBe(5);
    expect(made.snapshot.stats.HP).toBe(31);
  });
});

describe('rise timing: the countdown is the number of enemy-phase starts left', () => {
  // Drives the phase order the battle uses: each enemy phase starts with the tick,
  // then the enemies act (a counter kill lands there), then the next player phase.
  function play(killPhase) {
    let list = [];
    const shown = []; // countdown seen during each player phase after the kill
    let rose = null;
    for (let turn = 1; turn <= 6 && rose === null; turn++) {
      if (killPhase === 'player' && turn === 1) list = [record(3, 3)];
      if (list.length) shown.push(list[0].turnsRemaining);
      // Enemy phase of this turn: the tick comes first.
      const { kept, rising } = tickRemains(list);
      list = kept;
      if (rising.length) rose = turn;
      if (killPhase === 'enemy' && turn === 1) list = [record(3, 3)];
    }
    return { rose, shown };
  }

  it('killed in player phase 1: rises at the start of enemy phase 3', () => {
    const { rose, shown } = play('player');
    expect(rose).toBe(3);
    // Player phases 1, 2, 3 show 3, 2, 1: enemy phases 1, 2, 3 are still to come.
    expect(shown).toEqual([3, 2, 1]);
  });

  it('killed by a counter in enemy phase 1 (after its tick): rises at enemy phase 4', () => {
    const { rose, shown } = play('enemy');
    expect(rose).toBe(4);
    // Player phases 2, 3, 4 show 3, 2, 1: enemy phases 2, 3, 4 are still to come.
    expect(shown).toEqual([3, 2, 1]);
  });

  it('a tick never mutates the list it was given', () => {
    const list = [record(1, 1, 2), record(2, 2, 1)];
    const before = JSON.stringify(list);
    const { kept, rising } = tickRemains(list);
    expect(JSON.stringify(list)).toBe(before);
    expect(kept.map((r) => r.turnsRemaining)).toEqual([1]);
    expect(rising.map((r) => [r.col, r.row])).toEqual([[2, 2]]);
  });
});

describe('rising', () => {
  const plain = { moveCost: { Infantry: '1' } };
  const wall = { moveCost: { Infantry: '--' } };
  const world = (layout, occupied = []) => ({
    cols: layout[0].length,
    rows: layout.length,
    isOccupied: (c, r) => occupied.some(([oc, or]) => oc === c && or === r),
    moveCostAt: (c, r, moveType) => layout[r]?.[c]?.moveCost?.[moveType],
  });

  it('on its own tile, else the first open neighbour (left, right, up, down), else nowhere', () => {
    const open = [
      [plain, plain, plain],
      [plain, plain, plain],
      [plain, plain, plain],
    ];
    expect(riseTile(record(1, 1), world(open))).toEqual({ col: 1, row: 1 });
    expect(riseTile(record(1, 1), world(open, [[1, 1]]))).toEqual({ col: 0, row: 1 });
    const boxed = [
      [wall, wall, wall],
      [wall, plain, wall],
      [wall, wall, wall],
    ];
    expect(riseTile(record(1, 1), world(boxed, [[1, 1]]))).toBeNull();
  });

  it('rises at half HP (at least 1), with its weapon only, no affixes and no XP', () => {
    const unit = buildRisenUnit(record(2, 3), { col: 2, row: 3 });
    expect(unit).toMatchObject({
      className: 'Zombie',
      faction: 'enemy',
      col: 2,
      row: 3,
      currentHP: 15,
      affixes: [],
      _revived: true,
      _noXP: true,
    });
    expect(unit.inventory).toEqual([unit.weapon]);
    expect(leavesRemains(unit, sword)).toBe(false);
  });
});

describe('what the player knows', () => {
  const fogged = () => false;

  it('an unseen record is known only while its tile is in sight; seeing it once is enough', () => {
    const hidden = record(5, 5, 3, { seen: false });
    expect(isRemainsKnown(hidden, fogged)).toBe(false);
    expect(isRemainsKnown(hidden, () => true)).toBe(true);
    const list = [hidden];
    const seen = noteRemainsSeen(list, (c, r) => c === 5 && r === 5);
    expect(seen).not.toBe(list);
    expect(list[0].seen).toBe(false); // the old list is untouched
    expect(isRemainsKnown(seen[0], fogged)).toBe(true);
    expect(noteRemainsSeen(seen, () => true)).toBe(seen); // nothing new: same list
  });

  it('legacy records (saved before `seen`) count as seen', () => {
    const { seen, ...legacy } = record(1, 1);
    expect(seen).toBe(true);
    expect(isRemainsKnown(legacy, fogged)).toBe(true);
  });

  it('marker tiles: known records only, one per tile with the soonest count', () => {
    const list = [record(1, 1, 3), record(1, 1, 2), record(4, 4, 1, { seen: false })];
    expect(knownRemainsTiles(list, fogged)).toEqual([
      { col: 1, row: 1, turnsRemaining: 2, count: 2 },
    ]);
  });

  it('inspect line names the class and the phases left', () => {
    expect(remainsInfoLine([record(2, 2, 2)], 2, 2)).toBe(
      'Zombie remains · rises in 2 enemy phases',
    );
    expect(remainsInfoLine([record(2, 2, 1)], 2, 2)).toBe(
      'Zombie remains · rises in 1 enemy phase',
    );
    expect(remainsInfoLine([record(2, 2, 1, { seen: false })], 2, 2, () => false)).toBeNull();
    expect(remainsInfoLine([record(2, 2, 1)], 3, 2)).toBeNull();
  });
});

describe('Smash reach', () => {
  const unitWith = (items, profs, over = {}) => {
    const inventory = items.map(weapon);
    return {
      name: 'Tester',
      faction: 'player',
      col: 5,
      row: 5,
      skills: [],
      weapon: inventory[0],
      inventory,
      proficiencies: profs.map((type) => ({ type, rank: 'Prof' })),
      ...over,
    };
  };
  const at = (list) => list.map((r) => [r.col, r.row]).sort();

  it('a bow reaches 2 tiles and not 1 or 3; a sword reaches 1', () => {
    const list = [record(5, 6), record(5, 7), record(5, 8), record(4, 5)];
    expect(at(remainsInReach(unitWith(['Iron Bow'], ['Bow']), list))).toEqual([[5, 7]]);
    expect(at(remainsInReach(unitWith(['Iron Sword'], ['Sword']), list))).toEqual([
      [4, 5],
      [5, 6],
    ]);
  });

  it('a staff alone never smashes; a silenced mage cannot, a silenced sword-mage can', () => {
    const list = [record(5, 6)];
    expect(remainsInReach(unitWith(['Heal'], ['Staff']), list)).toEqual([]);
    const mage = unitWith(['Fire'], ['Tome']);
    expect(at(remainsInReach(mage, list))).toEqual([[5, 6]]);
    applyCondition(mage, 'silence', 2);
    expect(remainsInReach(mage, list)).toEqual([]);
    const spellblade = unitWith(['Fire', 'Iron Sword'], ['Tome', 'Sword']);
    applyCondition(spellblade, 'silence', 2);
    expect(at(remainsInReach(spellblade, list))).toEqual([[5, 6]]);
  });

  it('a fogged record is never a target, seen or not; an occupied tile is not either', () => {
    const sworder = unitWith(['Iron Sword'], ['Sword']);
    const list = [record(5, 6, 3, { seen: true }), record(4, 5, 3, { seen: false })];
    expect(remainsInReach(sworder, list, { isVisible: () => false })).toEqual([]);
    expect(at(remainsInReach(sworder, list, { isOccupied: (c, r) => c === 5 && r === 6 }))).toEqual(
      [[4, 5]],
    );
  });

  it('bones under the unit itself can be stamped out (any usable weapon)', () => {
    const list = [record(5, 5)];
    const occupied = () => true; // the unit stands there
    expect(
      at(remainsInReach(unitWith(['Iron Bow'], ['Bow']), list, { isOccupied: occupied })),
    ).toEqual([[5, 5]]);
    expect(remainsInReach(unitWith(['Heal'], ['Staff']), list, { isOccupied: occupied })).toEqual(
      [],
    );
  });
});

describe('Smash', () => {
  it('removes every record on the tile (a stacked pile is one pile), and only there', () => {
    const a = record(2, 2, 3);
    const b = record(2, 2, 1);
    const c = record(3, 3, 1);
    const list = [a, b, c];
    const { list: next, smashed } = smashRemains(list, { col: 2, row: 2 });
    expect(smashed).toEqual([a, b]);
    expect(next).toEqual([c]);
    expect(list).toEqual([a, b, c]); // input untouched
  });

  it('an empty tile smashes nothing', () => {
    const list = [record(2, 2)];
    expect(smashRemains(list, { col: 9, row: 9 })).toEqual({ list, smashed: null });
  });

  it('draws no randomness anywhere in the rules', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('remains rules consumed Math.random');
    });
    const list = [record(5, 6), record(1, 1, 1)];
    const unit = {
      faction: 'player',
      col: 5,
      row: 5,
      skills: [],
      weapon: weapon('Iron Sword'),
      inventory: [weapon('Iron Sword')],
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    };
    const [target] = remainsInReach(unit, list);
    expect(smashRemains(list, target).list).toHaveLength(1);
    const { rising } = tickRemains(list);
    expect(rising).toHaveLength(1);
    expect(leavesRemains(zombie(), sword)).toBe(true);
    expect(Math.random).not.toHaveBeenCalled();
  });
});
