// Vision rewind of Smite and Transfuse, on the production checkpoint / timeline /
// restore path (the journey harness, as tests/RewindAnyActionIntegration.test.js):
// each action is a "Before <unit>'s smite on <foe>" point, and confirming it puts back
// the foe's tile, its hold-position pack mark, both units' HP and the action itself.
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
 * A 4x4 board. Smiter (0,1) beside a holding Brigand (1,1), whose pack mate Lurker
 * stands at (3,3); Giver (0,3) beside a hurt Patient (1,3).
 */
function fixture() {
  const driver = new RunDriver(storage, { seed: 42 });
  const run = driver.run;
  run.visionChargesRemaining = 3;
  run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(run, driver.data);
  const template = run.roster[1];
  const make = (name, col, row, extra = {}) => {
    const unit = { ...structuredClone(template), name, col, row, hasActed: false, ...extra };
    delete unit.battleEntityId;
    return unit;
  };
  const smiter = make('Smiter', 0, 1, { faction: 'player', isCommander: true, skills: ['smite'] });
  const giver = make('Giver', 0, 3, { faction: 'player', skills: ['transfuse'] });
  const patient = make('Patient', 1, 3, { faction: 'player' });
  giver.currentHP = giver.stats.HP;
  patient.currentHP = Math.max(1, patient.stats.HP - 12);
  const hold = { aiMode: 'hold', holdPack: 1, holdPackSize: 2 };
  const brigand = make('Brigand', 1, 1, { faction: 'enemy', ...hold });
  const lurker = make('Lurker', 3, 3, { faction: 'enemy', ...hold });
  scene.playerUnits = [smiter, giver, patient];
  scene.enemyUnits = [brigand, lurker];
  for (const unit of [...scene.playerUnits, ...scene.enemyUnits]) scene.addUnitGraphic(unit);
  scene._battleCommanderId = smiter.battleEntityId;
  Object.assign(scene.grid, { fogEnabled: false, getMoveCost: () => 1 });
  scene._abilityController = new AbilityController(scene);
  scene._visionController = new VisionRewindController(scene, run);
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint({ session: scene._battleSession })).toBe(true);
  return { driver, scene, run, smiter, giver, patient, brigand, lurker };
}

const skill = (scene, id) => scene.gameData.skills.find((entry) => entry.id === id);
async function use(scene, unit, id, onto) {
  const targeting = scene._abilityController._targeting();
  const target = targeting.find(unit, skill(scene, id)).find((entry) => entry.unit === onto);
  expect(target, `${unit.name} can ${id} ${onto.name}`).toBeTruthy();
  expect(await targeting.execute(unit, skill(scene, id), target)).toBe(true);
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

describe('rewinding Smite and Transfuse', () => {
  it('each action is a named point, and confirming one restores the board exactly', async () => {
    const { scene, run, smiter, giver, patient, brigand } = fixture();
    const start = world(scene);
    await use(scene, smiter, 'smite', brigand);
    const afterSmite = world(scene);
    await use(scene, giver, 'transfuse', patient);
    const afterTransfuse = world(scene);

    // What the actions did, worked out by hand.
    expect([brigand.col, brigand.row, brigand.holdDisturbed]).toEqual([3, 1, 'moved']);
    expect(giver.currentHP).toBe(giver.stats.HP - 10);
    expect(patient.currentHP).toBe(patient.stats.HP - 12 + 10);
    expect(afterSmite).not.toEqual(start);
    expect(afterTransfuse).not.toEqual(afterSmite);

    expect(scene._visionController.requestRewind({ force: true })).toBe(true);
    const { rows } = pickers.at(-1).options.listing;
    expect(rows.map((r) => r.title)).toEqual([
      'Before Giver’s transfuse on Patient',
      'Before Smiter’s smite on Brigand',
    ]);

    // Before the transfuse: the smite stands, the transfuse is undone.
    pickers.at(-1).options.onConfirm(rows[0].id);
    expect(world(scene)).toEqual(afterSmite);
    expect(run.visionChargesRemaining).toBe(2);

    // Before the smite: the foe is back on its tile and its pack is quiet again.
    scene.battleState = 'PLAYER_IDLE';
    pickers.length = 0;
    scene._visionController.openRewind();
    const earlier = pickers.at(-1).options.listing.rows;
    expect(earlier[0].title).toBe('Before Smiter’s smite on Brigand');
    pickers.at(-1).options.onConfirm(earlier[0].id);
    expect(world(scene)).toEqual(start);
    const restored = scene.enemyUnits.find((u) => u.name === 'Brigand');
    expect([restored.col, restored.row, restored.holdDisturbed, restored.aiMode]).toEqual([
      1,
      1,
      undefined,
      'hold',
    ]);
  });

  it('the checkpoint a rewind leaves behind resumes to the same board', async () => {
    const { scene, driver, smiter, giver, patient, brigand } = fixture();
    await use(scene, smiter, 'smite', brigand);
    const afterSmite = world(scene);
    await use(scene, giver, 'transfuse', patient);

    scene._visionController.openRewind();
    pickers.at(-1).options.onConfirm(pickers.at(-1).options.listing.rows[0].id);
    expect(world(scene)).toEqual(afterSmite);

    const saved = loadRun(driver.data, 1);
    const resumed = journeyBattleScene(saved, driver.data);
    const resume = new BattleSuspendController(resumed);
    resume.applyUnits(saved.battleInProgress.checkpoint);
    resume.finalizeResume(saved.battleInProgress.checkpoint);
    expect(world(resumed)).toEqual(afterSmite);
  });

  it('rewinding a smite clears the disturbance it marked on the holder', async () => {
    const { scene, smiter, brigand, lurker } = fixture();
    await use(scene, smiter, 'smite', brigand);
    // The disturbance is on the pushed holder; its mate wakes with it at the enemy phase.
    expect(brigand.holdDisturbed).toBe('moved');
    expect(lurker.holdDisturbed).toBeUndefined();
    scene._visionController.openRewind();
    pickers.at(-1).options.onConfirm(pickers.at(-1).options.listing.rows[0].id);
    const holder = scene.enemyUnits.find((u) => u.name === 'Brigand');
    expect(holder.holdDisturbed).toBeUndefined();
    expect(holder.aiMode).toBe('hold');
  });
});
