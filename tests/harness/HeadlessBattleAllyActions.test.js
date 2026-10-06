// The harness battle's Canto, Measured Step, Trade, Swap, Shove, Pull and Dance,
// as BattleScene runs them (finishUnitAction / startCantoMove, BattleTradeController,
// MovementActionController): which actions let a unit move on, what each move does to
// whom, and what stays possible after.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { PlaySession } from '../../tools/play/session.js';
import { PlayError } from '../../tools/play/parse.js';
import { isRooted } from '../../src/engine/StatusConditionSystem.js';

let gameData;

/**
 * A battle with a cleared plain block (rows 1..5, columns 1..7), Edric at (2, 3), one
 * ally at (3, 3), every other unit moved off the block; fog off.
 */
function block({ canto = true } = {}) {
  const b = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
  b.init();
  b.cantoEnabled = canto;
  const plain = b.gameData.terrain.findIndex((t) => t.name === 'Plain');
  const edric = b.playerUnits.find((u) => u.name === 'Edric');
  const ally = b.playerUnits.find((u) => u !== edric);
  const others = [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits].filter(
    (u) => u !== edric && u !== ally,
  );
  const r = 3;
  const c0 = 1;
  const inBox = (col, row) => row >= r - 2 && row <= r + 2 && col >= c0 && col <= c0 + 6;
  for (let y = r - 2; y <= r + 2; y++)
    for (let x = c0; x <= c0 + 6; x++) b.grid.mapLayout[y][x] = plain;
  // Anyone else standing in the block steps out of it, onto a free tile.
  const taken = new Set(
    [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits].map((u) => `${u.col},${u.row}`),
  );
  for (const u of others) {
    if (!inBox(u.col, u.row)) continue;
    outer: for (let y = b.grid.rows - 1; y >= 0; y--)
      for (let x = b.grid.cols - 1; x >= 0; x--)
        if (
          !inBox(x, y) &&
          !taken.has(`${x},${y}`) &&
          b.grid.getMoveCost(x, y, u.moveType) !== Infinity
        ) {
          taken.add(`${x},${y}`);
          Object.assign(u, { col: x, row: y });
          break outer;
        }
  }
  Object.assign(edric, { col: c0 + 1, row: r });
  Object.assign(ally, { col: c0 + 2, row: r });
  b.grid.fogEnabled = false;
  return { b, edric, ally, c0, r };
}

const at = (u) => ({ col: u.col, row: u.row });

describe('HeadlessBattle Canto and Measured Step', () => {
  beforeEach(() => {
    gameData = loadGameData();
    installSeed(4242);
  });
  afterEach(() => restoreMathRandom());

  it('Canto moves on with the movement left after a noncombat action, then completes', () => {
    const { b, edric, c0, r } = block();
    edric.skills.push('canto');
    edric.currentHP -= 10;
    b.selectUnit(edric);
    b.moveTo(c0 + 1, r - 1); // one tile
    b.useItem(edric.consumables.find((i) => i.name === 'Vulnerary'));
    expect(b.battleState).toBe(HEADLESS_STATES.CANTO_MOVING);
    expect(b.cantoRemaining).toBe((edric.mov ?? edric.stats.MOV) - 1);
    expect(edric.hasActed).toBe(true);
    b.cantoMoveTo(c0, r - 2);
    expect(at(edric)).toEqual({ col: c0, row: r - 2 });
    expect(edric._movementSpent).toBe(1); // a Canto move does not add to it
    expect(b.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
    expect(b.selectedUnit).toBeNull();
  });

  it('Wait never moves on; nor does anything when the battle leaves Canto off', () => {
    const on = block();
    on.edric.skills.push('canto');
    on.b.selectUnit(on.edric);
    on.b.moveTo(on.c0 + 1, on.r - 1);
    on.b.chooseAction('Wait');
    expect(on.b.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);

    const off = block({ canto: false });
    off.edric.skills.push('canto');
    off.edric.currentHP -= 10;
    off.b.selectUnit(off.edric);
    off.b.moveTo(off.c0 + 1, off.r - 1);
    off.b.useItem(off.edric.consumables.find((i) => i.name === 'Vulnerary'));
    expect(off.b.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
  });

  it('Measured Step moves on after a noncombat action but not after a fight; Canto does both', () => {
    for (const [skill, after] of [
      ['measured_step', HEADLESS_STATES.PLAYER_IDLE],
      ['canto', HEADLESS_STATES.CANTO_MOVING],
    ]) {
      const { b, edric, c0, r } = block();
      edric.skills.push(skill);
      const foe = b.enemyUnits[0];
      Object.assign(foe, { col: c0 + 1, row: r + 2, currentHP: 99 });
      foe.stats = { ...foe.stats, HP: 99 };
      foe.weapon = null; // no counter: the test is about what follows the fight
      b.selectUnit(edric);
      b.moveTo(c0 + 1, r + 1);
      b.chooseAction('Attack');
      b.chooseAttackTarget(foe);
      expect(b.battleState, skill).toBe(after);
    }
  });

  it('Back while moving on leaves the unit where it acted', () => {
    const { b, edric, c0, r } = block();
    edric.skills.push('canto');
    edric.currentHP -= 10;
    b.selectUnit(edric);
    b.moveTo(c0 + 1, r - 1);
    b.useItem(edric.consumables.find((i) => i.name === 'Vulnerary'));
    expect(b.battleState).toBe(HEADLESS_STATES.CANTO_MOVING);
    b.cancel();
    expect(at(edric)).toEqual({ col: c0 + 1, row: r - 1 });
    expect(b.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
    expect(edric.hasActed).toBe(true);
  });
});

describe('HeadlessBattle Trade, Swap, Shove, Pull and Dance', () => {
  beforeEach(() => {
    gameData = loadGameData();
    installSeed(4242);
  });
  afterEach(() => restoreMathRandom());

  it('Trade gives an item, locks the move in, and leaves the unit its action', () => {
    const { b, edric, ally } = block();
    const vulnerary = edric.consumables.find((i) => i.name === 'Vulnerary');
    const had = ally.consumables.length;
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    const result = b.trade(ally, vulnerary);
    expect(result).toMatchObject({ ok: true, kind: 'give' });
    expect(edric.consumables).not.toContain(vulnerary);
    expect(ally.consumables).toHaveLength(had + 1);
    expect(edric._movementCommitted).toBe(true);
    expect(edric.hasActed).toBe(false);
    expect(b.battleState).toBe(HEADLESS_STATES.UNIT_ACTION_MENU);
    // Weapons and supplies never exchange.
    expect(b.trade(ally, edric.inventory[0], ally.consumables[0]).ok).toBe(false);
    b.cancel(); // only deselects now
    expect(at(edric)).toEqual({ col: edric.col, row: edric.row });
    expect(b.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
  });

  it('Swap exchanges places and ends the action', () => {
    const { b, edric, ally, c0, r } = block({ canto: false });
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    b.reposition('swap', ally);
    expect(at(edric)).toEqual({ col: c0 + 2, row: r });
    expect(at(ally)).toEqual({ col: c0 + 1, row: r });
    expect(edric.hasActed).toBe(true);
    expect(ally.hasActed).toBe(false);
  });

  it('Shove pushes the ally one tile on; Pull steps back and draws the ally in', () => {
    const shove = block({ canto: false });
    shove.edric.skills.push('shove');
    shove.b.selectUnit(shove.edric);
    shove.b.moveTo(shove.edric.col, shove.edric.row);
    shove.b.reposition('shove', shove.ally);
    expect(at(shove.ally)).toEqual({ col: shove.c0 + 3, row: shove.r });
    expect(at(shove.edric)).toEqual({ col: shove.c0 + 1, row: shove.r });

    const pull = block({ canto: false });
    pull.edric.skills.push('pull');
    pull.b.selectUnit(pull.edric);
    pull.b.moveTo(pull.edric.col, pull.edric.row);
    pull.b.reposition('pull', pull.ally);
    expect(at(pull.edric)).toEqual({ col: pull.c0, row: pull.r });
    expect(at(pull.ally)).toEqual({ col: pull.c0 + 1, row: pull.r });
  });

  it('Shove never pushes into fog: a hidden foe must not show by the option missing', () => {
    const { b, edric, ally, c0, r } = block();
    edric.skills.push('shove');
    b.grid.fogEnabled = true;
    b.grid.visibleSet = new Set([`${c0 + 1},${r}`, `${c0 + 2},${r}`]);
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    expect(b._findShoveTargets(edric)).toEqual([]);
    expect(() => b.reposition('shove', ally)).toThrow(/cannot shove/);
  });

  it('Dance lets an acted ally act again and earns the dancer XP', () => {
    const { b, edric, ally } = block({ canto: false });
    edric.skills.push('dance');
    ally.hasActed = true;
    ally.hasMoved = true;
    const xp = edric.xp || 0;
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    b.dance(ally);
    expect(ally.hasActed).toBe(false);
    expect(ally.hasMoved).toBe(false);
    expect((edric.xp || 0) + 100 * (edric.level - 1)).toBeGreaterThan(xp);
    expect(edric.hasActed).toBe(true);
  });
});

describe('HeadlessBattle abilities', () => {
  beforeEach(() => {
    gameData = loadGameData();
    installSeed(4242);
  });
  afterEach(() => restoreMathRandom());

  it('Blink moves the unit to an open tile in view, once per battle', () => {
    const { b, edric, c0, r } = block({ canto: false });
    edric.skills.push('blink');
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    expect(() => b.useAbility('blink', { col: c0 + 2, row: r })).toThrow(/cannot reach/); // the ally's tile
    b.useAbility('blink', { col: c0 + 5, row: r });
    expect(at(edric)).toEqual({ col: c0 + 5, row: r });
    expect(edric.hasActed).toBe(true);
    const entry = b.abilityEntries(edric).find((e) => e.skill.id === 'blink');
    expect(entry).toMatchObject({ canUse: false, reason: 'per_map_limit' });
  });

  it('Healing Circle heals the unit and allies in its radius by its amount', () => {
    const { b, edric, ally } = block({ canto: false });
    edric.skills.push('healing_circle');
    const amount = gameData.skills.find((x) => x.id === 'healing_circle').actionAbility.amount;
    edric.stats.HP = Math.max(edric.stats.HP, amount + 10);
    edric.currentHP = edric.stats.HP - amount - 5;
    ally.currentHP = ally.stats.HP - 3;
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    b.useAbility('healing_circle');
    expect(edric.currentHP).toBe(edric.stats.HP - 5);
    expect(ally.currentHP).toBe(ally.stats.HP);
  });

  it('Ensnare roots enemies in its radius; with none in sight it cannot be used', () => {
    const { b, edric, c0, r } = block({ canto: false });
    edric.skills.push('ensnare');
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    expect(b.abilityEntries(edric)[0]).toMatchObject({ canUse: false, reason: 'no_targets' });
    b.cancel(); // back to choosing a tile
    b.cancel(); // and deselected
    const foe = b.enemyUnits[0];
    Object.assign(foe, { col: c0 + 1, row: r + 2 });
    b._refreshFogVisibility();
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    const facts = b.useAbility('ensnare');
    expect(facts.targets.map((t) => t.unit)).toEqual([foe]);
    expect(
      foe.statusConditions?.some?.((c) => c.id === 'root') ?? JSON.stringify(foe).includes('root'),
    ).toBe(true);
  });

  it('Rally Cry raises the stats of allies in its radius', () => {
    const { b, edric, ally } = block({ canto: false });
    edric.skills.push('rally_cry_skill');
    const stats = gameData.skills.find((x) => x.id === 'rally_cry_skill').actionAbility.stats;
    const before = { ...ally.stats };
    b.selectUnit(edric);
    b.moveTo(edric.col, edric.row);
    b.useAbility('rally_cry_skill');
    for (const [k, v] of Object.entries(stats)) expect(ally.stats[k], k).toBe(before[k] + v);
  });
});

describe('headless play: ally moves and moving on', () => {
  async function battle() {
    const session = await PlaySession.create(loadGameData(), { seed: 3 });
    for (const cmd of ['bless skip', 'go act1_0_2', 'start']) await session.exec(cmd);
    return session;
  }

  it("Gaspar's Measured Step: a swap leaves him free to move on, by canto or by then", async () => {
    const session = await battle();
    const b = session.game.battle.battle;
    const gaspar = b.playerUnits.find((u) => u.name === 'Gaspar');
    const edric = b.playerUnits.find((u) => u.name === 'Edric');
    const plain = b.gameData.terrain.findIndex((t) => t.name === 'Plain');
    // Clear a block around Gaspar and stand Edric beside him.
    for (let y = gaspar.row - 2; y <= gaspar.row + 2; y++)
      for (let x = gaspar.col - 2; x <= gaspar.col + 2; x++)
        if (b.grid.mapLayout[y]?.[x] !== undefined) b.grid.mapLayout[y][x] = plain;
    for (const u of [...b.playerUnits, ...b.enemyUnits])
      if (u !== gaspar && Math.abs(u.col - gaspar.col) + Math.abs(u.row - gaspar.row) <= 3)
        u.row = (u.row + 6) % b.grid.rows;
    Object.assign(edric, { col: gaspar.col + 1, row: gaspar.row });
    const start = at(gaspar);

    await expect(session.exec('canto stay')).rejects.toBeInstanceOf(PlayError);
    const { lines } = await session.exec('move Gaspar stay swap Edric');
    expect(lines.join('\n')).toMatch(/may move on up to \d+ tile\(s\) \(Measured Step\)/);
    expect(at(gaspar)).toEqual({ col: start.col + 1, row: start.row });
    expect(at(edric)).toEqual(start);
    // Nothing else until he has moved on (or the turn ends).
    await expect(session.exec('move Edric stay wait')).rejects.toThrow(/canto/);
    expect(await session.query('options Gaspar')).toMatch(/may move on/);
    const [onward] = [...b.cantoRange]
      .filter(([key, e]) => e?.stoppable !== false && key !== `${gaspar.col},${gaspar.row}`)
      .map(([key]) => key.split(',').map(Number));
    await session.exec(`canto ${onward[0]},${onward[1]}`);
    expect(at(gaspar)).toEqual({ col: onward[0], row: onward[1] });
    expect(gaspar.hasActed).toBe(true);
    expect(b.battleState).toBe('PLAYER_IDLE');

    // Measured Step never follows a fight; "then" is refused for a unit without it.
    await expect(session.exec('move Edric stay wait then 1,1')).rejects.toThrow(
      /no Canto or Measured Step/,
    );
  });

  it('a trade keeps the action; the next order acts from the same tile', async () => {
    const session = await battle();
    const b = session.game.battle.battle;
    const edric = b.playerUnits.find((u) => u.name === 'Edric');
    const sera = b.playerUnits.find((u) => u.name === 'Sera');
    Object.assign(sera, { col: edric.col, row: edric.row + 1 });
    if (b.grid.getMoveCost(sera.col, sera.row, sera.moveType) === Infinity)
      Object.assign(sera, { col: edric.col, row: edric.row - 1 });
    const { lines } = await session.exec('move Edric stay trade Sera give Vulnerary');
    expect(lines.join('\n')).toMatch(/trades with .*Sera: Vulnerary/);
    expect(sera.consumables.filter((i) => i.name === 'Vulnerary')).toHaveLength(2);
    expect(edric.hasActed).toBe(false);
    await expect(session.exec('move Edric 0,0 wait')).rejects.toBeInstanceOf(PlayError);
    await session.exec('move Edric stay wait');
    expect(edric.hasActed).toBe(true);
  });
});
