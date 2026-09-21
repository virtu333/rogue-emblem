import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
import { loadGameData } from '../testData.js';
const { popup } = vi.hoisted(() => ({ popup: vi.fn(async () => {}) }));
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { BattleSuspendController } from '../../src/ui/BattleSuspendController.js';
import { presentQueuedLevelUps } from '../../src/ui/BattlePresentationCheckpoint.js';
import { VisionRewindController } from '../../src/ui/VisionRewindController.js';
import { loadRun, clearBattleInProgressInSave } from '../../src/engine/RunManager.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { canInspectUnit } from '../../src/engine/BattleInformation.js';
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

// Rendering-only adapter. Real XP, capture, storage, restore, continuation,
// action completion and rewind methods remain on BattleScene/controllers.
function sceneFor(run, data) {
  const scene = journeyBattleScene(run, data);
  scene._journeyPopup = () => popup();
  return scene;
}

function fixture() {
  const d = new RunDriver(storage);
  d.run.beginBattleInProgress(d.run.nodeMap.nodes[0].id, { battleParams: {} });
  const s = sceneFor(d.run, d.data);
  const unit = createUnit(
    d.data.classes.find((c) => c.name === 'Fighter'),
    14,
    d.data.weapons,
    { name: 'Veteran' },
  );
  Object.assign(unit, { xp: 99, col: 1, row: 1, faction: 'player' });
  s.playerUnits = [unit];
  const enemy = structuredClone(unit);
  Object.assign(enemy, { name: 'Hidden enemy', faction: 'enemy', col: 3, row: 3 });
  s.enemyUnits = [enemy];
  for (const unit of [...s.playerUnits, ...s.enemyUnits]) s.addUnitGraphic(unit);
  expect(s._captureSuspendCheckpoint()).toBe(true);
  return { d, s };
}
function checkpoint() {
  return loadRun(loadGameData(), 1)?.battleInProgress?.checkpoint;
}
// Use the same catalog without creating/saving another fixture.

function reload(d, { finalize = true } = {}) {
  const writes = storage.writes;
  const run = loadRun(d.data, 1);
  expect(storage.writes).toBe(writes);
  const restored = sceneFor(run, d.data);
  const controller = new BattleSuspendController(restored);
  controller.applyUnits(run.battleInProgress.checkpoint);
  if (finalize) controller.finalizeResume(run.battleInProgress.checkpoint);
  return restored;
}
function assertFresh(s) {
  const cp = checkpoint();
  for (const group of ['playerUnits', 'enemyUnits', 'npcUnits']) {
    expect(
      cp[group].map((u) => [
        u.name,
        u.currentHP,
        u.level,
        u.xp,
        u.skills,
        u.hasActed,
        u._conditions || [],
      ]),
    ).toEqual(
      s[group].map((u) => [
        u.name,
        u.currentHP,
        u.level,
        u.xp,
        u.skills,
        u.hasActed === true,
        u._conditions || [],
      ]),
    );
  }
  expect(cp.pendingActionCompletion).toEqual(s._pendingActionCompletion || null);
  return cp;
}

it.each([1, 42, 773])(
  'seed %i: reload during popup resumes post-XP action exactly once',
  async (seed) => {
    installSeed(seed);
    const { d, s } = fixture();
    const unit = s.playerUnits[0];
    // Resolved damage is fixture input; attack targeting/animation belongs to browser contracts.
    unit.currentHP -= 3;
    s.enemyUnits[0].currentHP -= 5;
    await s.awardScaledXP(unit, 20);
    let restored;
    popup.mockImplementation(async () => {
      assertFresh(s);
      restored = reload(d);
      expect(restored.playerUnits[0].level).toBe(15);
      expect(restored.playerUnits[0].skills).toContain('wrath');
      expect(restored.playerUnits[0].hasActed).toBe(true);
      expect(restored.turnManager.unitActedCalls).toBe(1);
      expect(restored.runManager.battleInProgress.checkpoint.pendingActionCompletion).toBeNull();
    });
    await presentQueuedLevelUps(s, { kind: 'combat', unitName: unit.name });
    assertFresh(restored);
    const second = reload(d);
    expect(second.turnManager.unitActedCalls).toBe(0);
    expect(second.playerUnits[0].xp).toBe(unit.xp);
    expect(popup).toHaveBeenCalledTimes(1);
  },
);

it('calibration: omitting the presentation checkpoint save exposes the stale combat state', async () => {
  const { s } = fixture();
  await s.awardScaledXP(s.playerUnits[0], 20);
  vi.spyOn(s, '_persistBattleRunState').mockReturnValue({ ok: true });
  popup.mockImplementation(async () => expect(() => assertFresh(s)).toThrow());
  await presentQueuedLevelUps(s, { kind: 'combat', unitName: s.playerUnits[0].name });
  expect(popup).toHaveBeenCalledTimes(1);
});

it('failed checkpoint writes are not reported durable; retry persists without repeating XP', async () => {
  const { d, s } = fixture();
  const prior = checkpoint();
  await s.awardScaledXP(s.playerUnits[0], 20);
  storage.failWrites = true;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(s._captureSuspendCheckpoint()).toBe(false);
  expect(checkpoint()).toEqual(prior);
  expect(reload(d).playerUnits[0].level).toBe(14);
  storage.failWrites = false;
  expect(s._captureSuspendCheckpoint()).toBe(true);
  expect(reload(d).playerUnits[0].level).toBe(15);
  assertFresh(s);
});

it('resume preserves conditions, usage, movement, terrain and fog without revealing hidden units', () => {
  const { d, s } = fixture();
  Object.assign(s.playerUnits[0], {
    hasMoved: true,
    _movementCommitted: true,
    _movementSpent: 3,
    _conditions: [{ id: 'silence', turnsRemaining: 2 }],
    _battleAbilityUsage: { test: 1 },
    _battleWeaponArtUsage: { test: { map: 1 } },
    _miracleUsed: true,
  });
  s.grid.mapLayout[1][1] = 2;
  s._captureSuspendCheckpoint();
  const r = reload(d);
  for (const key of [
    '_movementSpent',
    '_movementCommitted',
    '_conditions',
    '_battleAbilityUsage',
    '_battleWeaponArtUsage',
    '_miracleUsed',
  ])
    expect(r.playerUnits[0][key]).toEqual(s.playerUnits[0][key]);
  expect(r.playerUnits[0].inventory).toContain(r.playerUnits[0].weapon);
  expect(r.grid.mapLayout).toEqual(s.grid.mapLayout);
  expect(r.grid.visibleSet).toEqual(s.grid.visibleSet);
  expect(canInspectUnit(r.grid, r.enemyUnits[0])).toBe(false);
});

it('sanctioned Rewind persists restored state and spent charge; map continuation restores entry charges', () => {
  const { d, s } = fixture();
  s.runManager.visionChargesRemaining = 2;
  // Re-enter so the entry contract includes the controlled charge fixture.
  s.runManager.clearBattleInProgress();
  s.runManager.beginBattleInProgress(d.run.nodeMap.nodes[0].id, { battleParams: {} });
  const v = new VisionRewindController(s, s.runManager);
  s._visionController = v;
  vi.spyOn(v, 'playRewindEffect').mockImplementation(() => {});
  v.captureSnapshot();
  const hp = s.playerUnits[0].currentHP;
  s.playerUnits[0].currentHP = 1;
  s._captureSuspendCheckpoint();
  expect(v.executeRewind()).toBe(true);
  const r = reload(d);
  expect(r.playerUnits[0].currentHP).toBe(hp);
  expect(r.runManager.visionChargesRemaining).toBe(1);
  expect(clearBattleInProgressInSave(null, 1).ok).toBe(true);
  const map = loadRun(d.data, 1);
  expect(map.battleInProgress).toBeNull();
  expect(map.visionChargesRemaining).toBe(2);
  expect(map.roster.map((u) => [u.name, u.currentHP, u.xp])).toEqual(
    d.run.roster.map((u) => [u.name, u.currentHP, u.xp]),
  );
});
