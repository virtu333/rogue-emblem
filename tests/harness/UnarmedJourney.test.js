// UnarmedJourney.test.js — an unarmed player unit through the production battle
// lifecycle: a level-up (XP from an ally's Mentor's Band share, the real awardXP),
// the suspend checkpoint, a reload (Resume Battle), a sanctioned Rewind, and the
// run save / load around the battle. Rendering is the only stubbed layer
// (JourneyBattleScene); XP, capture, storage, restore and rewind are real.
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
const { popup } = vi.hoisted(() => ({ popup: vi.fn(async () => {}) }));
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { BattleSuspendController } from '../../src/ui/BattleSuspendController.js';
import { presentQueuedLevelUps } from '../../src/ui/BattlePresentationCheckpoint.js';
import { VisionRewindController } from '../../src/ui/VisionRewindController.js';
import { loadRun, saveRun } from '../../src/engine/RunManager.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  installSeed(42);
  popup.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  restoreMathRandom();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function sceneFor(run, data) {
  const scene = journeyBattleScene(run, data);
  scene._journeyPopup = () => popup();
  return scene;
}

/** A battle with an armed mentor and an unarmed trainee beside him. */
function fixture() {
  const d = new RunDriver(storage);
  d.run.beginBattleInProgress(d.run.nodeMap.nodes[0].id, { battleParams: {} });
  const s = sceneFor(d.run, d.data);
  const fighter = d.data.classes.find((c) => c.name === 'Fighter');
  const mentor = createUnit(fighter, 14, d.data.weapons, { name: 'Mentor' });
  const band = structuredClone(d.data.accessories.find((a) => a.combatEffects?.xpShare));
  Object.assign(mentor, { col: 1, row: 1, faction: 'player', accessory: band });
  const trainee = createUnit(fighter, 3, d.data.weapons, { name: 'Trainee' });
  Object.assign(trainee, {
    col: 2,
    row: 1,
    faction: 'player',
    xp: 99,
    inventory: [],
    weapon: null,
  });
  const enemy = createUnit(fighter, 3, d.data.weapons, { name: 'Raider' });
  Object.assign(enemy, { col: 3, row: 3, faction: 'enemy' });
  s.playerUnits = [mentor, trainee];
  s.enemyUnits = [enemy];
  for (const unit of [...s.playerUnits, ...s.enemyUnits]) s.addUnitGraphic(unit);
  expect(s._captureSuspendCheckpoint({ session: s._battleSession })).toBe(true);
  return { d, s, mentor, trainee, enemy };
}

function reload(d) {
  const run = loadRun(d.data, 1);
  const restored = sceneFor(run, d.data);
  const controller = new BattleSuspendController(restored);
  controller.applyUnits(run.battleInProgress.checkpoint);
  controller.finalizeResume(run.battleInProgress.checkpoint);
  return restored;
}

const traineeOf = (scene) => scene.playerUnits.find((u) => u.name === 'Trainee');

it('an unarmed trainee levels up from a Mentor share, and resume keeps it unarmed', async () => {
  const { d, s, mentor, trainee, enemy } = fixture();
  expect(mentor.accessory?.combatEffects?.xpShare).toBeGreaterThan(0);
  const levelBefore = trainee.level;
  // The mentor kills the raider: the adjacent, lower-level trainee gets a share
  // (floor 1 XP), and 99 + at least 1 crosses the 100 XP line.
  enemy.currentHP = 0;
  await s.awardXP(mentor, enemy, true);
  await presentQueuedLevelUps(
    s,
    { kind: 'combat', unitName: mentor.name },
    { session: s._battleSession },
  );
  expect(trainee.level).toBe(levelBefore + 1);
  expect(trainee.weapon).toBeNull();
  expect(trainee.inventory).toEqual([]);
  s._captureSuspendCheckpoint({ session: s._battleSession });

  const restored = reload(d);
  const back = traineeOf(restored);
  expect(back.level).toBe(levelBefore + 1);
  expect(back.xp).toBe(trainee.xp);
  expect(back.weapon).toBeNull();
  expect(back.inventory).toEqual([]);
  expect('equippedInventoryIndex' in back).toBe(false);
  // The armed mentor still points at a carried weapon.
  const m = restored.playerUnits.find((u) => u.name === 'Mentor');
  expect(m.inventory).toContain(m.weapon);
});

it('Rewind restores an unarmed unit exactly (HP, bag, weapon: null)', () => {
  const { d, s, trainee } = fixture();
  s.runManager.visionChargesRemaining = 2;
  s.runManager.clearBattleInProgress();
  s.runManager.beginBattleInProgress(d.run.nodeMap.nodes[0].id, { battleParams: {} });
  const v = new VisionRewindController(s, s.runManager);
  s._visionController = v;
  vi.spyOn(v, 'playRewindEffect').mockImplementation(() => {});
  v.captureSnapshot();
  const hp = trainee.currentHP;
  // The move being undone: the trainee is hurt and handed a sword.
  const sword = structuredClone(d.data.weapons.find((w) => w.name === 'Iron Sword'));
  trainee.currentHP = 1;
  trainee.inventory = [sword];
  trainee.weapon = sword;
  s._captureSuspendCheckpoint({ session: s._battleSession });
  expect(v.executeRewind()).toBe(true);
  const live = traineeOf(s);
  expect(live.currentHP).toBe(hp);
  expect(live.inventory).toEqual([]);
  expect(live.weapon).toBeNull();
  const restored = traineeOf(reload(d));
  expect(restored.currentHP).toBe(hp);
  expect(restored.inventory).toEqual([]);
  expect(restored.weapon).toBeNull();
});

it('the run save between battles keeps an unarmed roster unit unarmed', () => {
  const d = new RunDriver(storage);
  const unit = d.run.roster.find((u) => !u.isLord) || d.run.roster[1];
  unit.inventory = [];
  unit.weapon = null;
  saveRun(d.run, null, 1);
  const run = loadRun(d.data, 1);
  const back = run.roster.find((u) => u.name === unit.name);
  expect(back.inventory).toEqual([]);
  expect(back.weapon).toBeNull();
});
