// The harness battle's fog ambush (BattleScene.moveUnit / _ambushCut / _resolveAmbush,
// engine/FogAmbush.js): a player plans a move on what the fog shows; walking it, a
// unit hidden on the path stops the move on the last tile before it where the mover
// may stand. The move is locked in and the unit may still act.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { loadGameData } from '../testData.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import { PlaySession } from '../../tools/play/session.js';
import { PlayError } from '../../tools/play/parse.js';

let gameData;

/**
 * A fresh battle with a cleared plain strip, row r, columns c0..c0+6 (and the rows
 * beside it), with Edric on its first tile, every other unit off it, and fog on.
 */
function strip() {
  const b = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout', row: 2 });
  b.init();
  const plain = b.gameData.terrain.findIndex((t) => t.name === 'Plain');
  const edric = b.playerUnits.find((u) => u.name === 'Edric');
  const others = [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits].filter((u) => u !== edric);
  for (let r = 1; r < b.grid.rows - 1; r++)
    for (let c0 = 0; c0 + 6 < b.grid.cols; c0++) {
      const inBox = (u) => u.row >= r - 1 && u.row <= r + 1 && u.col >= c0 && u.col <= c0 + 6;
      if (others.some(inBox)) continue;
      for (let y = r - 1; y <= r + 1; y++)
        for (let x = c0; x <= c0 + 6; x++) b.grid.mapLayout[y][x] = plain;
      edric.col = c0;
      edric.row = r;
      b.grid.fogEnabled = true;
      return { b, edric, c0, r };
    }
  throw new Error('no open strip');
}

/** Only these tiles are visible (the fog hides every other). */
function seeOnly(b, tiles) {
  b.grid.visibleSet = new Set(tiles.map(([c, r]) => `${c},${r}`));
}

describe('HeadlessBattle fog ambush', () => {
  beforeEach(() => {
    gameData = loadGameData();
    installSeed(4242);
  });
  afterEach(() => restoreMathRandom());

  it('stops before a hidden enemy, locks the move in, and leaves the unit to act', () => {
    const { b, edric, c0, r } = strip();
    const foe = b.enemyUnits[0];
    foe.col = c0 + 2;
    foe.row = r;
    seeOnly(b, [
      [c0, r],
      [c0 + 1, r],
      [c0 + 3, r],
    ]);
    b.selectUnit(edric);
    // The hidden enemy does not shape the range the player plans with.
    expect(b.movementRange.has(`${c0 + 2},${r}`)).toBe(true);
    b.moveTo(c0 + 3, r);
    expect({ col: edric.col, row: edric.row }).toEqual({ col: c0 + 1, row: r });
    expect(edric._movementSpent).toBe(1);
    expect(edric._movementCommitted).toBe(true);
    expect(edric.hasActed).toBe(false);
    expect(b.lastAmbush.ambusher).toBe(foe);
    expect(b.battleState).toBe(HEADLESS_STATES.UNIT_ACTION_MENU);
    // The fog lifts from where it stands: the ambusher is in view and can be fought.
    expect(b.grid.isVisible(foe.col, foe.row)).toBe(true);
    expect(b.getAvailableActions().map((a) => a.label)).toContain('Attack');

    // Back only deselects; selecting again opens the menu where it stands.
    b.cancel();
    expect(b.battleState).toBe(HEADLESS_STATES.PLAYER_IDLE);
    expect({ col: edric.col, row: edric.row }).toEqual({ col: c0 + 1, row: r });
    b.selectUnit(edric);
    expect(b.battleState).toBe(HEADLESS_STATES.UNIT_ACTION_MENU);
    expect(b.movementRange).toBeNull();
  });

  it('backs up past a tile it may pass but not stop on', () => {
    const { b, edric, c0, r } = strip();
    const ally = b.playerUnits.find((u) => u !== edric);
    const foe = b.enemyUnits[0];
    ally.col = c0 + 1;
    ally.row = r;
    foe.col = c0 + 2;
    foe.row = r;
    seeOnly(b, [
      [c0, r],
      [c0 + 1, r],
      [c0 + 3, r],
    ]);
    b.selectUnit(edric);
    b.moveTo(c0 + 3, r);
    expect({ col: edric.col, row: edric.row }).toEqual({ col: c0, row: r });
    expect(edric._movementSpent).toBe(0);
    expect(edric._movementCommitted).toBe(true);
    expect(b.lastAmbush.ambusher).toBe(foe);
  });

  it('walks the whole path when nothing hides on it, and the move can be undone', () => {
    const { b, edric, c0, r } = strip();
    seeOnly(b, [[c0, r]]);
    b.selectUnit(edric);
    b.moveTo(c0 + 3, r);
    expect({ col: edric.col, row: edric.row }).toEqual({ col: c0 + 3, row: r });
    expect(edric._movementSpent).toBe(3);
    expect(b.lastAmbush).toBeNull();
    b.cancel();
    expect({ col: edric.col, row: edric.row }).toEqual({ col: c0, row: r });
    expect(b.battleState).toBe(HEADLESS_STATES.UNIT_SELECTED);
  });

  it('a new player turn frees a locked-in unit to move again', async () => {
    const { b, edric, c0, r } = strip();
    const foe = b.enemyUnits[0];
    foe.col = c0 + 2;
    foe.row = r;
    seeOnly(b, [[c0, r]]);
    b.selectUnit(edric);
    b.moveTo(c0 + 3, r);
    expect(edric._movementCommitted).toBe(true);
    b.chooseAction('Wait');
    for (const u of b.playerUnits) u.hasActed = true;
    if (b.battleState === HEADLESS_STATES.PLAYER_IDLE) await b.endTurn();
    while (b.battleState === HEADLESS_STATES.ENEMY_PHASE) await b._processEnemyPhase();
    if (b.result) return;
    expect(edric._movementCommitted).toBe(false);
  });
});

describe('headless play: an ambushed order', () => {
  it('reports the ambush, keeps the move, and lets the unit act from where it stopped', async () => {
    const session = await PlaySession.create(loadGameData(), { seed: 3 });
    for (const cmd of ['bless skip', 'go act1_0_2', 'start']) await session.exec(cmd);
    const b = session.game.battle.battle;
    const edric = b.playerUnits.find((u) => u.name === 'Edric');
    const plain = b.gameData.terrain.findIndex((t) => t.name === 'Plain');
    // Clear a strip east of Edric, hide an enemy two tiles along it.
    const { col, row } = edric;
    for (let x = col; x <= col + 3 && x < b.grid.cols; x++) b.grid.mapLayout[row][x] = plain;
    for (const u of [...b.playerUnits, ...b.enemyUnits])
      if (u !== edric && u.row === row && u.col > col && u.col <= col + 3)
        u.row = (row + 3) % b.grid.rows;
    const foe = b.enemyUnits[0];
    foe.col = col + 2;
    foe.row = row;
    b.grid.fogEnabled = true;
    b.grid.visibleSet = new Set([`${col},${row}`, `${col + 1},${row}`]);

    const { lines } = await session.exec(`move Edric ${col + 3},${row} wait`);
    const text = lines.join('\n');
    expect(text).toMatch(/AMBUSH!/);
    expect(text).toMatch(new RegExp(`stops at ${col + 1},${row}`));
    expect(edric.hasActed).toBe(false);
    expect(session.log.at(-1).cmd).toBe(`move Edric ${col + 3},${row} wait`);
    expect(b.battleState).toBe('PLAYER_IDLE');
    // Only acting where it stands is left; any other tile is refused.
    await expect(session.exec(`move Edric ${col},${row} wait`)).rejects.toBeInstanceOf(PlayError);
    await session.exec('move Edric stay wait');
    expect(edric.hasActed).toBe(true);
    expect({ col: edric.col, row: edric.row }).toEqual({ col: col + 1, row });
  });
});
