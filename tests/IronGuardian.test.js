// The Iron Guardian (engine/IronGuardian.js, docs/specs/large-units.md): a 2x2 keeper whose
// plates fall as it is hurt and whose hammer falls where it marked a phase before.
//
// Ways this goes wrong:
//   - the plates shed at the wrong share (one too early, or the last plate sheds at 1 HP), or
//     their mods never reach combat (the forecast and the blow disagree with the card);
//   - the stats by act are read for the wrong act (Act IV's Guardian with Act II's HP), its level
//     stays 1 (so XP is a level-1 boss's), or its own maul is swapped for a tier pick;
//   - the Entity, which has no table, changes on the way;
//   - the slam lands where nothing was marked, hits a unit that stepped out, misses one that
//     stands on a mark with a body tile, or is replayed on a phase already processed (a resume);
//   - the patterns stop alternating, or the front strip faces the wrong side;
//   - a fallen Guardian keeps slamming;
//   - a saved state with junk is trusted, or a slam ever draws from Math.random.
// Expected values are worked out by hand from the boards below.
import { describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { createEnemyUnit } from '../src/engine/UnitManager.js';
import {
  HAMMERFALL_FRONT_DEPTH,
  createHammerfallState,
  facingToward,
  hammerfallConfigFor,
  guardianCardLines,
  hammerfallLine,
  hammerfallPhase,
  hammerfallTiles,
  platesLine,
  platesOf,
  runHammerfallPhaseSync,
  sanitizeHammerfallState,
  slamDamage,
  unitsOnMarks,
} from '../src/engine/IronGuardian.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import { getFootprint } from '../src/engine/EntitySystem.js';
import { isNeverCopiedClass } from '../src/engine/Necromancy.js';

const data = loadGameData();
const guardianClass = data.classes.find((c) => c.name === 'Iron Guardian');
const entityClass = data.classes.find((c) => c.name === 'Entity');

function guardian(act = 'act2', at = { col: 4, row: 4 }) {
  const unit = createEnemyUnit(guardianClass, 9, data.weapons, 1, data.skills, act);
  Object.assign(unit, at);
  return unit;
}
const soldier = (col, row, { hp = 20, def = 6, faction = 'player', name = 'Soldier' } = {}) => ({
  name,
  faction,
  col,
  row,
  currentHP: hp,
  stats: { HP: 30, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: def, RES: 2, LCK: 3, MOV: 5 },
});
const keys = (tiles) => tiles.map((t) => `${t.col},${t.row}`);
const board = { cols: 12, rows: 12 };

describe('the Iron Guardian class', () => {
  it('is a 2x2 body with its own maul, plates and hammer', () => {
    const g = guardian('act2');
    expect(g.footprint).toEqual({ width: 2, height: 2 });
    expect(keys(getFootprint(g))).toEqual(['4,4', '5,4', '4,5', '5,5']);
    expect(g.weapon.name).toBe('Ironfall Maul');
    expect(g.inventory.map((w) => w.name)).toEqual(['Ironfall Maul']);
    expect(g.plates).toEqual({ count: 4, defPerPlate: 3, strPerPlate: 2 });
    expect(g.hammerfall).toEqual({ might: 8 });
    expect(g.mov).toBe(0);
  });

  it('reads each act its own stats, a later act the nearest earlier table', () => {
    expect(guardian('act2').stats.HP).toBe(68);
    expect(guardian('act3').stats.HP).toBe(96);
    expect(guardian('act4').stats.HP).toBe(124);
    expect(guardian('act4').stats.DEF).toBe(21);
    expect(guardian('finalBoss').stats.HP).toBe(124);
    expect(guardian('act1').stats.HP).toBe(68);
    expect(guardian('act4').currentHP).toBe(124);
  });

  it('keeps its spawn level (XP reads it) and its stats are never levelled', () => {
    const g = createEnemyUnit(guardianClass, 14, data.weapons, 1, data.skills, 'act3');
    expect(g.level).toBe(14);
    expect(g.stats.STR).toBe(18);
  });

  it('leaves the Entity as it was: level 1, its one stat block, no body fields', () => {
    const e = createEnemyUnit(entityClass, 20, data.weapons, 1, data.skills, 'finalBoss');
    expect(e.level).toBe(1);
    expect(e.stats).toEqual(entityClass.baseStats);
    expect(e.footprint).toBeUndefined();
    expect(e.plates).toBeUndefined();
  });

  it('draws nothing from Math.random beyond a plain boss-tier unit', () => {
    const spy = vi.spyOn(Math, 'random');
    guardian('act3');
    const guardianDraws = spy.mock.calls.length;
    spy.mockClear();
    createEnemyUnit(entityClass, 9, data.weapons, 1, data.skills, 'act3');
    expect(guardianDraws).toBe(spy.mock.calls.length);
    spy.mockRestore();
  });

  it('is never copied into a wave, a template or the arena', () => {
    expect(isNeverCopiedClass('Iron Guardian')).toBe(true);
  });
});

describe('Iron Plates', () => {
  const at = (hp) => {
    const g = guardian('act2');
    g.currentHP = hp;
    return g;
  };
  it('sheds one plate per quarter of max HP lost, never the last', () => {
    // max 68: a quarter is 17
    expect(platesOf(at(68)).shed).toBe(0);
    expect(platesOf(at(52)).shed).toBe(0);
    expect(platesOf(at(51)).shed).toBe(1);
    expect(platesOf(at(34)).shed).toBe(2);
    expect(platesOf(at(17)).shed).toBe(3);
    expect(platesOf(at(1)).shed).toBe(3);
    expect(platesOf(at(1)).left).toBe(1);
  });

  it('each shed plate is DEF -3 and Might +2, in the combat mods every reader takes', () => {
    const g = at(34);
    expect(platesOf(g)).toMatchObject({ defDelta: -6, strDelta: 4 });
    const mods = getSkillCombatMods(g, soldier(4, 6), [], [], data.skills, null, false);
    const whole = getSkillCombatMods(at(68), soldier(4, 6), [], [], data.skills, null, false);
    expect(mods.defBonus - whole.defBonus).toBe(-6);
    expect(mods.atkBonus - whole.atkBonus).toBe(4);
  });

  it('says so on the card', () => {
    expect(platesLine(at(68))).toBe('Iron Plates: 4 of 4');
    expect(platesLine(at(34))).toBe('Iron Plates: 2 of 4 · DEF -6, Might +4');
    expect(platesLine(soldier(0, 0))).toBe('');
  });
});

describe('Hammerfall tiles', () => {
  const g = guardian('act2'); // body (4,4)-(5,5)

  it('the front strip faces the nearest side, body-wide and three deep', () => {
    expect(HAMMERFALL_FRONT_DEPTH).toBe(3);
    expect(keys(hammerfallTiles(g, 'front', { ...board, toward: soldier(4, 9) }))).toEqual([
      '4,6', '5,6', '4,7', '5,7', '4,8', '5,8',
    ]); // prettier-ignore
    expect(keys(hammerfallTiles(g, 'front', { ...board, toward: soldier(0, 4) }))).toEqual([
      '1,4', '2,4', '3,4', '1,5', '2,5', '3,5',
    ]); // prettier-ignore
    // a diagonal tie (3 across, 3 down) takes the rows
    expect(facingToward(g, soldier(8, 8))).toEqual({ dc: 0, dr: 1 });
    expect(facingToward(g, soldier(5, 1))).toEqual({ dc: 0, dr: -1 });
  });

  it('stops at the board edge and skips tiles nobody can stand on', () => {
    const edge = guardian('act2', { col: 0, row: 9 }); // body (0,9)-(1,10)
    expect(keys(hammerfallTiles(edge, 'front', { ...board, toward: soldier(0, 11) }))).toEqual([
      '0,11', '1,11',
    ]); // prettier-ignore
    const walls = new Set(['4,7']);
    const tiles = hammerfallTiles(g, 'front', {
      ...board,
      toward: soldier(4, 9),
      standable: (c, r) => !walls.has(`${c},${r}`),
    });
    expect(keys(tiles)).not.toContain('4,7');
    expect(tiles).toHaveLength(5);
  });

  it('the shockwave is every tile within 2 of the body: 20 on an open board', () => {
    const tiles = hammerfallTiles(g, 'shock', board);
    expect(tiles).toHaveLength(20);
    expect(keys(tiles)).toContain('4,2');
    expect(keys(tiles)).toContain('3,3');
    expect(keys(tiles)).not.toContain('2,2'); // 2 across and 2 up: 4 away
    expect(keys(tiles)).not.toContain('4,4'); // its own body
  });
});

describe('the slam', () => {
  it('is STR + might - DEF, plates counted, never below 0', () => {
    const g = guardian('act2'); // STR 14, might 8
    expect(slamDamage(g, soldier(0, 0, { def: 6 }))).toBe(16);
    g.currentHP = 34; // two plates off: +4
    expect(slamDamage(g, soldier(0, 0, { def: 6 }))).toBe(20);
    expect(slamDamage(g, soldier(0, 0, { def: 40 }))).toBe(0);
  });

  it('hits a unit with any body tile on a mark', () => {
    const marks = [{ col: 2, row: 2 }];
    const big = { ...soldier(1, 1), footprint: { width: 2, height: 2 } };
    expect(unitsOnMarks(marks, [big, soldier(3, 3)])).toEqual([big]);
  });
});

describe('a battle of phases', () => {
  function world(state, army, enemies, turn) {
    return {
      state,
      enemyUnits: enemies,
      army,
      ...board,
      turn,
    };
  }

  it('marks first, slams the next phase, then alternates front and shock', () => {
    const g = guardian('act2');
    const lancer = soldier(4, 9, { hp: 20, def: 6, name: 'Lancer' });
    const archer = soldier(9, 9, { hp: 20, name: 'Archer' });
    const army = [lancer, archer];

    const one = runHammerfallPhaseSync(world(createHammerfallState(), army, [g], 1));
    expect(one.slam).toBeNull();
    expect(one.state.pattern).toBe('front');
    expect(one.state.next).toBe('shock');
    expect(keys(one.state.marks)).toEqual(['4,6', '5,6', '4,7', '5,7', '4,8', '5,8']);

    // The lancer walks into the strip; the archer stays clear.
    lancer.row = 7;
    const two = runHammerfallPhaseSync(world(one.state, army, [g], 2));
    expect(two.slam.hits.map((h) => h.victim.name)).toEqual(['Lancer']);
    expect(lancer.currentHP).toBe(4); // 20 - 16
    expect(archer.currentHP).toBe(20);
    expect(two.state.pattern).toBe('shock');
    expect(two.state.marks).toHaveLength(20);
    expect(two.state.slams).toBe(1);

    lancer.row = 9; // out of the shock's reach
    const three = runHammerfallPhaseSync(world(two.state, army, [g], 3));
    expect(three.slam.hits).toEqual([]);
    expect(three.state.pattern).toBe('front');
  });

  it('a phase already processed does nothing (a resume never slams twice)', () => {
    const g = guardian('act2');
    const lancer = soldier(4, 6);
    const first = runHammerfallPhaseSync(
      world({ ...createHammerfallState(), marks: [{ col: 4, row: 6 }], pattern: 'front' }, [lancer], [g], 2),
    ); // prettier-ignore
    expect(lancer.currentHP).toBe(4);
    const again = runHammerfallPhaseSync(world(first.state, [lancer], [g], 2));
    expect(again.skipped).toBe(true);
    expect(lancer.currentHP).toBe(4);
  });

  it('removes a fallen victim before the next one is struck', () => {
    const g = guardian('act2');
    const a = soldier(4, 6, { hp: 5, name: 'A' });
    const b = soldier(5, 6, { hp: 30, name: 'B' });
    const removed = [];
    const state = { ...createHammerfallState(), marks: [{ col: 4, row: 6 }, { col: 5, row: 6 }], pattern: 'front' }; // prettier-ignore
    const steps = hammerfallPhase(world(state, [a, b], [g], 2));
    const first = steps.next().value;
    expect(first.victim).toBe(a);
    expect(first.fell).toBe(true);
    removed.push(first.victim.name);
    expect(b.currentHP).toBe(30); // not yet struck
    steps.next();
    expect(b.currentHP).toBe(14);
    expect(removed).toEqual(['A']);
  });

  it('a fallen Guardian slams nothing and leaves no marks', () => {
    const g = guardian('act2');
    g.currentHP = 0;
    const lancer = soldier(4, 6);
    const step = runHammerfallPhaseSync(
      world({ ...createHammerfallState(), marks: [{ col: 4, row: 6 }], pattern: 'front' }, [lancer], [g], 2),
    ); // prettier-ignore
    expect(step.slam).toBeNull();
    expect(step.state.marks).toEqual([]);
    expect(lancer.currentHP).toBe(20);
  });

  it('never draws from Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const g = guardian('act2');
    spy.mockClear();
    const army = [soldier(4, 6), soldier(3, 4)];
    let state = createHammerfallState();
    for (let turn = 1; turn <= 4; turn++)
      state = runHammerfallPhaseSync(world(state, army, [g], turn)).state;
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('saved state', () => {
  it('a junk record reads as fresh; a good one keeps its marks', () => {
    expect(sanitizeHammerfallState(null)).toEqual(createHammerfallState());
    expect(sanitizeHammerfallState({ marks: 'x', next: 'sideways' })).toEqual(
      createHammerfallState(),
    );
    const kept = { marks: [{ col: 1, row: 2 }], pattern: 'shock', next: 'front', slams: 3, lastProcessedTurn: 4 }; // prettier-ignore
    expect(sanitizeHammerfallState(kept)).toEqual(kept);
  });

  it('a map flags it only when it fields a Hammerfall class', () => {
    expect(hammerfallConfigFor([{ className: 'Iron Guardian' }], data.classes)).toEqual({
      hammerfall: { v: 1 },
    });
    expect(hammerfallConfigFor([{ className: 'Fighter' }], data.classes)).toEqual({});
  });

  it('the card names what falls next', () => {
    const g = guardian('act2');
    expect(hammerfallLine(g, { marks: [{ col: 1, row: 1 }], pattern: 'shock' })).toBe(
      'Hammerfall: falls all around next (marked)',
    );
    expect(hammerfallLine(g, createHammerfallState())).toBe(
      'Hammerfall: marks where it falls each turn',
    );
  });

  it('the unit cards read its plates, then its hammer; any other unit reads nothing', () => {
    const g = guardian('act2');
    // 68 HP, 4 plates: losing half sheds two (DEF 3 and STR 2 each), by hand.
    g.currentHP = 34;
    expect(guardianCardLines(g, { marks: [{ col: 1, row: 1 }], pattern: 'front' })).toEqual([
      'Iron Plates: 2 of 4 · DEF -6, Might +4',
      'Hammerfall: falls in front next (marked)',
    ]);
    expect(guardianCardLines(g)).toEqual([
      'Iron Plates: 2 of 4 · DEF -6, Might +4',
      'Hammerfall: marks where it falls each turn',
    ]);
    expect(guardianCardLines(soldier(1, 1))).toEqual([]);
  });
});
