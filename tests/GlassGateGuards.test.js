// The Glass at the Descent's gate (docs/sim-reports/act-v-descent.md "Follow-up on main"): on
// Nightfall and Black Sun the Lieutenant's door is held by four guards two levels over the battle's
// range (two Generals on post beside him, two Snipers on the dais) and a turn-2 wave closes on the
// army from the hall's top and bottom edges (a second Hero on Black Sun). First Light and Dusk, where
// the Glass is the finale, field none of it. Ways this breaks:
//   - a rung gate slips and the finale on First Light or Dusk gains the guards or the wave
//   - the guards lose their post, their level offset, or their place beside the throne
//   - the wave stops arriving on turn 2, or Black Sun loses its extra Hero
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { buildSetPieceBattle, findSetPiece } from '../src/engine/SetPieces.js';

const data = loadGameData();
const glass = findSetPiece(data.setPieces, 'the_glass');
const LEVELS = [16, 16];

function build(difficultyId, mirrored = false) {
  // The Glass has one variant; the first draw is the mirror roll (below 0.5 mirrors), then two
  // per slot. A fixed 0.75 after the mirror roll keeps every class pick and level roll fixed.
  let first = true;
  const random = () => {
    if (first) {
      first = false;
      return mirrored ? 0.25 : 0.75;
    }
    return 0.75;
  };
  return buildSetPieceBattle({
    setPiece: glass,
    act: 'finalBoss',
    difficultyId,
    levelRange: LEVELS,
    deployCount: 8,
    classes: data.classes,
    terrain: data.terrain,
    random,
    seatBoss: () => ({ className: 'Hero', level: 23, name: 'The Lieutenant', isBoss: true }),
  });
}

const at = (spawns, col, row) => spawns.find((s) => s.col === col && s.row === row);
const wave = (built) => built.reinforcements?.reinforcements?.scriptedWaves || [];

describe('the Glass: the gate’s guards and wave', () => {
  it('First Light and Dusk field neither (the Glass is their finale)', () => {
    for (const rung of ['normal', 'dusk']) {
      const built = build(rung);
      expect(at(built.enemySpawns, 14, 5), rung).toBeUndefined();
      expect(at(built.enemySpawns, 14, 7), rung).toBeUndefined();
      expect(at(built.enemySpawns, 14, 3), rung).toBeUndefined();
      expect(at(built.enemySpawns, 14, 9), rung).toBeUndefined();
      expect(wave(built), rung).toEqual([]);
    }
  });

  it('Nightfall holds the door: Generals on post beside him, Snipers on the dais, all at +2', () => {
    const built = build('hard');
    const boss = at(built.enemySpawns, 14, 6);
    expect(boss.isBoss).toBe(true);
    for (const [col, row, className, aiMode] of [
      [14, 5, 'General', 'post'],
      [14, 7, 'General', 'post'],
      [14, 3, 'Sniper', undefined],
      [14, 9, 'Sniper', undefined],
    ]) {
      const guard = at(built.enemySpawns, col, row);
      expect(guard, `${col},${row}`).toMatchObject({ className, level: 18 });
      expect(guard.aiMode).toBe(aiMode);
    }
  });

  it('a turn-2 wave arrives from the hall’s top and bottom edges, one more Hero on Black Sun', () => {
    const nightfall = wave(build('hard'));
    expect(nightfall).toHaveLength(1);
    expect(nightfall[0].turn).toBe(2);
    expect(nightfall[0].spawns.map((s) => [s.className, s.col, s.row, s.level])).toEqual([
      ['Swordmaster', 6, 1, 18],
      ['Hero', 6, 12, 18],
      ['Sniper', 7, 1, 18],
      ['Sage', 7, 12, 18],
    ]);
    const blackSun = wave(build('lunatic'))[0].spawns;
    expect(blackSun).toHaveLength(5);
    expect(blackSun.at(-1)).toMatchObject({ className: 'Hero', col: 5, row: 1, level: 18 });
  });

  it('mirrored, the guards still stand beside him and the wave still comes from both edges', () => {
    const built = build('hard', true);
    const boss = built.enemySpawns.find((s) => s.isBoss);
    expect(boss).toMatchObject({ col: 1, row: 6 });
    expect(at(built.enemySpawns, 1, 5)).toMatchObject({ className: 'General', aiMode: 'post' });
    expect(at(built.enemySpawns, 1, 7)).toMatchObject({ className: 'General', aiMode: 'post' });
    expect(wave(built)[0].spawns.map((s) => [s.col, s.row])).toEqual([
      [9, 1],
      [9, 12],
      [8, 1],
      [8, 12],
    ]);
  });
});
