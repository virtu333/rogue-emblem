// Reinforcement arrival rules shared by BattleScene and the headless harness
// (ReinforcementScheduler): which waves raise par, which tiles an arrival may take,
// and the harness applying both exactly as the scene does. Failures each test catches:
// a clock wave quietly handing turns back, an Armored copy stuck on Swamp, an arrival
// dropped on Lava or a Ballista, and the harness drifting from the scene's par.
import { describe, it, expect, afterEach } from 'vitest';
import {
  collectEdgeSpawnCandidates,
  parRaiseForArrivals,
  reinforcementMoveTypes,
  scheduleReinforcementsForTurn,
  waveRaisesPar,
} from '../src/engine/ReinforcementScheduler.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadFixture } from './fixtures/battles/index.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const T = Object.fromEntries(data.terrain.map((t, i) => [t.name, i]));

describe('which waves raise par', () => {
  it('procedural and scripted waves do; repeating and ladder waves do not', () => {
    expect(waveRaisesPar({ waveIndex: 0 })).toBe(true);
    expect(waveRaisesPar({ waveIndex: 0, waveType: 'procedural' })).toBe(true);
    expect(waveRaisesPar({ waveIndex: 1, waveType: 'scripted' })).toBe(true);
    expect(waveRaisesPar({ waveIndex: 1000, waveType: 'repeating' })).toBe(false);
    expect(waveRaisesPar({ waveIndex: 0, waveType: 'ladder' })).toBe(false);
    expect(waveRaisesPar({})).toBe(false);
  });

  it('counts each raising wave once however many of its units arrived', () => {
    expect(
      parRaiseForArrivals([
        { waveIndex: 0 },
        { waveIndex: 0 },
        { waveIndex: 0, waveType: 'scripted' }, // scripted wave 0 is a different wave
        { waveIndex: 1, waveType: 'ladder' },
      ]),
    ).toBe(2);
  });
});

describe('where an arrival may stand', () => {
  // Right edge column 5: rows 0..4 = Plain, Swamp, Lava Crack, Ballista, Plain.
  const layout = Array.from({ length: 5 }, () => Array(6).fill(T.Plain));
  layout[1][5] = T.Swamp;
  layout[2][5] = T['Lava Crack'];
  layout[3][5] = T.Ballista;
  const rowsOn = (moveTypes) =>
    collectEdgeSpawnCandidates({
      edge: 'right',
      mapLayout: layout,
      terrain: data.terrain,
      moveTypes,
    }).map((t) => t.row);

  it('never on Lava Crack or a Ballista; Swamp only when every copied class can stand there', () => {
    expect(rowsOn(['Infantry'])).toEqual([0, 1, 4]);
    expect(rowsOn(['Infantry', 'Armored'])).toEqual([0, 4]);
  });

  it('the move types are those of the classes an arrival may copy', () => {
    const pool = [{ className: 'Knight' }, { className: 'Fighter' }, { className: 'Fighter' }];
    expect(reinforcementMoveTypes(pool, data.classes)).toEqual(['Armored', 'Infantry']);
    expect(reinforcementMoveTypes([], data.classes)).toEqual(['Infantry']);
  });

  it('an authored placement is checked against its own class', () => {
    const reinforcements = {
      waves: [],
      scriptedWaves: [{ turn: 1, spawns: [{ col: 5, row: 1, className: 'Knight', level: 1 }] }],
    };
    const schedule = (classMoveType) =>
      scheduleReinforcementsForTurn({
        turn: 1,
        reinforcements,
        mapLayout: layout,
        terrain: data.terrain,
        classMoveType,
      });
    expect(schedule(null).spawns).toHaveLength(1); // Infantry may stand on Swamp
    const knight = schedule((name) => data.classes.find((c) => c.name === name)?.moveType);
    expect(knight.spawns).toHaveLength(0);
    expect(knight.blockedSpawns).toBe(1);
  });
});

describe('the headless harness applies the same arrival rules', () => {
  afterEach(() => restoreMathRandom());

  it('par rises for a procedural wave and not for a ladder wave, as in the scene', () => {
    installSeed(3);
    const fixture = loadFixture('act1_rout_basic');
    const battle = new HeadlessBattle(data, { ...fixture.battleParams }, fixture.buildRoster(data));
    battle.init();
    battle.turnPar = 8;
    battle._resolveReinforcementsForTurn = () => ({
      spawns: [
        { col: 0, row: 0, waveIndex: 0, waveType: 'ladder' },
        { col: 0, row: 1, waveIndex: 1 },
      ],
      dueWaves: [],
      blockedSpawns: 0,
    });
    battle._buildReinforcementSpawnSpec = (s) => ({ ...s, className: 'Fighter', level: 1 });
    battle._applyReinforcementsForTurn(4);
    expect(battle.turnPar).toBe(9);
  });
});
