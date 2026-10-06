// Rewind and suspend/resume after a forced slide, on the production checkpoint /
// timeline / restore path (the journey harness, as tests/RewindSmiteTransfuse.test.js).
// A Smite and a Shove each put a unit on ice and slide it; the timeline records where
// the slide ended, a Vision rewind to before the action puts the unit back on the tile
// it stood on (and the foe's hold-position mark with it), and the checkpoint a slide
// leaves behind resumes to the same board.
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import './harness/JourneyTestSetup.js';

const pickers = vi.hoisted(() => []);
vi.mock('../src/ui/VisionRewindPicker.js', () => ({
  VisionRewindPicker: class {
    constructor(scene, options) {
      this.options = options;
      pickers.push(this);
    }
    destroy() {}
  },
}));

import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { AbilityController } from '../src/ui/AbilityController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { loadRun } from '../src/engine/RunManager.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

let storage;
beforeEach(() => {
  pickers.length = 0;
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(42);
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * A 6x4 board. Rows 1 and 2 each run: plain, plain, ice, ice, ice, plain.
 * Smiter (0,1) beside a holding Brigand (1,1) (pack mate Lurker at (5,3));
 * Shover (0,2) beside Friend (1,2).
 */
function fixture() {
  const driver = new RunDriver(storage, { seed: 42 });
  const run = driver.run;
  run.visionChargesRemaining = 3;
  run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(run, driver.data);
  const terrain = driver.data.terrain;
  const T = Object.fromEntries(terrain.map((t, i) => [t.name, i]));
  const iceRow = [T.Plain, T.Plain, T.Ice, T.Ice, T.Ice, T.Plain];
  const plainRow = Array(6).fill(T.Plain);
  const template = run.roster[1];
  const make = (name, col, row, extra = {}) => {
    const unit = { ...structuredClone(template), name, col, row, hasActed: false, ...extra };
    delete unit.battleEntityId;
    return unit;
  };
  const smiter = make('Smiter', 0, 1, { faction: 'player', isCommander: true, skills: ['smite'] });
  const shover = make('Shover', 0, 2, { faction: 'player', skills: ['shove'] });
  const friend = make('Friend', 1, 2, { faction: 'player' });
  const hold = { aiMode: 'hold', holdPack: 1, holdPackSize: 2 };
  const brigand = make('Brigand', 1, 1, { faction: 'enemy', ...hold });
  const lurker = make('Lurker', 5, 3, { faction: 'enemy', ...hold });
  scene.playerUnits = [smiter, shover, friend];
  scene.enemyUnits = [brigand, lurker];
  for (const unit of [...scene.playerUnits, ...scene.enemyUnits]) scene.addUnitGraphic(unit);
  scene._battleCommanderId = smiter.battleEntityId;
  const mapLayout = [plainRow, iceRow, iceRow, plainRow];
  const terrainAt = (col, row) =>
    col < 0 || col >= 6 || row < 0 || row >= 4 ? null : terrain[mapLayout[row][col]];
  Object.assign(scene.grid, {
    cols: 6,
    rows: 4,
    mapLayout,
    fogEnabled: false,
    getTerrainAt: terrainAt,
    getMoveCost: (col, row, moveType) => {
      const cost = terrainAt(col, row)?.moveCost?.[moveType];
      return cost == null || cost === '--' ? Infinity : parseInt(cost, 10);
    },
  });
  scene._abilityController = new AbilityController(scene);
  scene._visionController = new VisionRewindController(scene, run);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint({ session: scene._battleSession })).toBe(true);
  return { driver, scene, run, smiter, shover, friend, brigand, lurker };
}

const skill = (scene, id) => scene.gameData.skills.find((entry) => entry.id === id);
async function smite(scene, unit, onto) {
  const targeting = scene._abilityController._targeting();
  const target = targeting.find(unit, skill(scene, 'smite')).find((entry) => entry.unit === onto);
  expect(target, `${unit.name} can smite ${onto.name}`).toBeTruthy();
  expect(await targeting.execute(unit, skill(scene, 'smite'), target)).toBe(true);
  scene.battleState = 'PLAYER_IDLE';
}
async function shove(scene, unit, onto) {
  const target = scene.findShoveTargets(unit).find((entry) => entry.ally === onto);
  expect(target, `${unit.name} can shove ${onto.name}`).toBeTruthy();
  expect(await scene.executeShove(unit, target)).toBe(true);
  scene.battleState = 'PLAYER_IDLE';
}
const world = (scene) => ({
  units: [...scene.playerUnits, ...scene.enemyUnits].map((u) => [
    u.name,
    u.col,
    u.row,
    u.currentHP,
    u.hasActed === true,
    u.holdDisturbed ?? null,
    u.aiMode ?? null,
  ]),
  rng: scene._battleRng.getState(),
});

describe('rewinding a forced slide', () => {
  it('a Smite across ice lands where the slide ends, and its rewind row puts the foe back', async () => {
    const { scene, run, smiter, brigand } = fixture();
    const start = world(scene);
    await smite(scene, smiter, brigand);
    // Worked out by hand: pushed from (1,1) onto the ice at (2,1), it slides through (3,1)
    // and (4,1) and ends on the plain tile (5,1). The pack mark is set on the holder.
    expect([brigand.col, brigand.row, brigand.holdDisturbed]).toEqual([5, 1, 'moved']);
    expect(world(scene)).not.toEqual(start);

    expect(scene._visionController.requestRewind({ force: true })).toBe(true);
    const { rows } = pickers.at(-1).options.listing;
    expect(rows.map((r) => r.title)).toEqual(['Before Smiter’s smite on Brigand']);
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(world(scene)).toEqual(start);
    const restored = scene.enemyUnits.find((u) => u.name === 'Brigand');
    expect([restored.col, restored.row, restored.holdDisturbed, restored.aiMode]).toEqual([
      1,
      1,
      undefined,
      'hold',
    ]);
    expect(run.visionChargesRemaining).toBe(2);
  });

  it('a Shove across ice lands where the slide ends, and its rewind row puts the ally back', async () => {
    const { scene, shover, friend } = fixture();
    const start = world(scene);
    await shove(scene, shover, friend);
    // Pushed from (1,2) onto the ice at (2,2): slides through (3,2), (4,2) to (5,2).
    expect([friend.col, friend.row]).toEqual([5, 2]);
    expect([shover.col, shover.row]).toEqual([0, 2]);

    expect(scene._visionController.requestRewind({ force: true })).toBe(true);
    const { rows } = pickers.at(-1).options.listing;
    expect(rows.map((r) => r.title)).toEqual(['Before Shover’s shove on Friend']);
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(world(scene)).toEqual(start);
  });

  it('after both, rewinding to between them leaves the first slide standing', async () => {
    const { scene, smiter, shover, friend, brigand } = fixture();
    await smite(scene, smiter, brigand);
    const afterSmite = world(scene);
    await shove(scene, shover, friend);
    scene._visionController.openRewind();
    const { rows } = pickers.at(-1).options.listing;
    expect(rows.map((r) => r.title)).toEqual([
      'Before Shover’s shove on Friend',
      'Before Smiter’s smite on Brigand',
    ]);
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(world(scene)).toEqual(afterSmite);
  });
});

describe('suspend and resume after a forced slide', () => {
  const resumed = (driver) => {
    const saved = loadRun(driver.data, 1);
    const scene = journeyBattleScene(saved, driver.data);
    const resume = new BattleSuspendController(scene);
    resume.applyUnits(saved.battleInProgress.checkpoint);
    resume.finalizeResume(saved.battleInProgress.checkpoint);
    return scene;
  };

  it('the checkpoint written when the Smite settled holds the tile the slide ended on', async () => {
    const { driver, scene, smiter, brigand } = fixture();
    await smite(scene, smiter, brigand);
    const after = world(scene);
    const again = resumed(driver);
    expect(world(again)).toEqual(after);
    const holder = again.enemyUnits.find((u) => u.name === 'Brigand');
    expect([holder.col, holder.row, holder.holdDisturbed]).toEqual([5, 1, 'moved']);
  });

  it('the checkpoint written when the Shove settled holds the tile the slide ended on', async () => {
    const { driver, scene, shover, friend } = fixture();
    await shove(scene, shover, friend);
    const after = world(scene);
    const again = resumed(driver);
    expect(world(again)).toEqual(after);
    expect(at(again.playerUnits.find((u) => u.name === 'Friend'))).toEqual([5, 2]);
  });
});

const at = (u) => [u.col, u.row];
