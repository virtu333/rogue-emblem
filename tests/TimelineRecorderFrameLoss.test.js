// A single history frame the validator rejects used to null the whole frame
// archive, so every earlier row fell back to the text sketch. It now costs
// only its own row (which keeps its compact preview), and the next recorded
// row is a keyframe marked as a gap so nothing animates across the hole.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(42);
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture() {
  const driver = new RunDriver(storage, { seed: 42 });
  const run = driver.run;
  run.beginBattleInProgress(run.nodeMap.nodes[0].id, { battleParams: {} });
  const scene = journeyBattleScene(run, driver.data);
  scene.playerUnits = structuredClone(run.roster.slice(0, 2));
  scene.playerUnits.forEach((unit, index) => {
    Object.assign(unit, { col: 1, row: index + 1, faction: 'player', isCommander: index === 0 });
    scene.addUnitGraphic(unit);
  });
  scene._battleCommanderId = scene.playerUnits[0].battleEntityId;
  scene.grid.fogEnabled = false;
  scene._visionController = new VisionRewindController(scene, run);
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint()).toBe(true);
  return { scene };
}

function step(scene, hp) {
  scene.playerUnits[0].currentHP = hp;
  scene._timelineFacts = [`HP ${hp}`];
  return scene._captureSuspendCheckpoint();
}

it('a rejected frame costs one row, never the archive', () => {
  const { scene } = fixture();
  step(scene, 17);
  step(scene, 16);
  const before = scene._battleTimeline.presentation.records.length;
  expect(before).toBeGreaterThanOrEqual(3);
  // A texture key the frame validator refuses (spaces) makes this frame invalid.
  const unit = scene.playerUnits[0];
  const graphic = unit.graphic;
  unit.graphic = { ...(graphic || {}), texture: { key: 'not a key' } };
  step(scene, 15);
  const afterLoss = scene._battleTimeline.presentation;
  expect(afterLoss).not.toBeNull();
  expect(afterLoss.records.length).toBe(before);
  const lostRow = scene._battleTimeline.entries.at(-1);
  expect(lostRow.preview).toBeTruthy(); // compact preview kept for the rebuilt board
  // The next frame records again, as a gap keyframe.
  unit.graphic = graphic;
  step(scene, 14);
  const records = scene._battleTimeline.presentation.records;
  expect(records.length).toBe(before + 1);
  expect(records.at(-1)).toMatchObject({ gap: true });
  expect(records.at(-1).frame).toBeTruthy();
});
