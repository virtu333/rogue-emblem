// A battle level-up card's Reroll (Branching Threads) against the real persistence: the
// production XP, checkpoint capture, rewrite, storage, resume, Vision rewind and Continue from
// Map; only rendering is substituted (JourneyTestSetup). The card's handle is the one
// presentLevelUpCard builds (ui/LevelUpRerollController.js battleLevelUpReroll).
//
// Ways this can fail, one test each:
//   - a refresh after a reroll resumes the old stats (a free reroll) or the new stats with the
//     charge refunded, or the charge spent with the old stats
//   - the rewrite moving the battle's stream: a new seed, a bumped index (every later reseed
//     hashes it), or a draw
//   - a failed write keeping the new stats or the spent charge (in memory or on disk)
//   - a Vision rewind to before the level-up keeping the spent charge; Continue from Map
//     keeping it
//   - after a victory (the battle saved as won) the roster's copy missing the swap
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import './JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './RunDriver.js';
import { journeyBattleScene } from './JourneyBattleScene.js';
import { BattleSuspendController } from '../../src/ui/BattleSuspendController.js';
import {
  completeResolvedAction,
  presentQueuedLevelUps,
} from '../../src/ui/BattlePresentationCheckpoint.js';
import { VisionRewindController } from '../../src/ui/VisionRewindController.js';
import { battleLevelUpReroll } from '../../src/ui/LevelUpRerollController.js';
import {
  clearBattleInProgressInSave,
  loadRun,
  serializeUnit,
} from '../../src/engine/RunManager.js';
import { createUnit } from '../../src/engine/UnitManager.js';
import { installSeed, restoreMathRandom } from '../../sim/lib/SeededRNG.js';

let storage;
let closePopup;
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

function sceneFor(run, data) {
  const scene = journeyBattleScene(run, data);
  scene._journeyPopup = () => new Promise((resolve) => (closePopup = resolve));
  return scene;
}

/** A battle whose unit levels on a resolved attack, its card up (the boundary checkpointed). */
async function levelUpCardUp({ rerolls = 3, beforeXp = null } = {}) {
  const d = new RunDriver(storage);
  d.run.metaEffects = { ...(d.run.metaEffects || {}), rewardRerolls: rerolls };
  d.run.beginBattleInProgress(d.run.nodeMap.nodes[0].id, { battleParams: {} });
  const s = sceneFor(d.run, d.data);
  const unit = createUnit(
    d.data.classes.find((c) => c.name === 'Fighter'),
    14,
    d.data.weapons,
    { name: 'Veteran' },
  );
  Object.assign(unit, { xp: 99, col: 1, row: 1, faction: 'player', unitUid: 'ru77' });
  unit.currentHP = unit.stats.HP - 3;
  s.playerUnits = [unit];
  const enemy = structuredClone(unit);
  Object.assign(enemy, { name: 'Foe', faction: 'enemy', col: 3, row: 3, unitUid: undefined });
  s.enemyUnits = [enemy];
  for (const u of [...s.playerUnits, ...s.enemyUnits]) s.addUnitGraphic(u);
  expect(s._captureSuspendCheckpoint({ session: s._battleSession })).toBe(true);
  beforeXp?.(s);
  await s.awardScaledXP(unit, 20);
  const cards = [...s._pendingLevelUpPopups];
  expect(cards).toHaveLength(1);
  const continuation = { kind: 'combat', unitName: unit.name, unitId: unit.battleEntityId };
  const presentation = presentQueuedLevelUps(s, continuation, { session: s._battleSession });
  expect(closePopup).toBeTypeOf('function');
  const reroll = battleLevelUpReroll(s, cards[0], { session: s._battleSession, cards });
  return { d, s, unit, card: cards[0], reroll, presentation, continuation };
}

const saved = (d) => loadRun(d.data, 1);
function reload(d) {
  const run = loadRun(d.data, 1);
  const restored = sceneFor(run, d.data);
  const controller = new BattleSuspendController(restored);
  controller.applyUnits(run.battleInProgress.checkpoint);
  return { run, scene: restored };
}
const statsOf = (u) => ({ ...u.stats, current: u.currentHP });

it('a refresh after a reroll resumes the rerolled stats with the charge spent', async () => {
  const { d, s, unit, card, reroll } = await levelUpCardUp();
  const before = saved(d).battleInProgress.checkpoint;
  const oldGains = { ...card.levelUp.gains };
  expect(reroll.state()).toMatchObject({ hidden: false, disabled: false, label: 'Reroll (3)' });
  const out = reroll.run();
  expect(out.ok).toBe(true);
  expect(reroll.state().label).toBe('Reroll (2)');
  // The swap, worked from the card: the stats move by new - old.
  for (const stat of Object.keys(oldGains))
    expect(unit.stats[stat] - before.playerUnits[0].stats[stat]).toBe(
      card.levelUp.gains[stat] - oldGains[stat],
    );
  const disk = saved(d);
  expect(disk.rewardRerollsSpent).toBe(1);
  const cp = disk.battleInProgress.checkpoint;
  expect(cp.runBattleState.rewardRerollsSpent).toBe(1);
  expect(statsOf(cp.playerUnits[0])).toEqual(statsOf(unit));
  // The same boundary rewritten: same index, seed and cursor, the continuation kept.
  expect([cp.checkpointIndex, cp.rngSeed, cp.rngState]).toEqual([
    before.checkpointIndex,
    before.rngSeed,
    before.rngState,
  ]);
  expect(cp.pendingActionCompletion).toEqual(before.pendingActionCompletion);
  const { run, scene } = reload(d);
  expect(statsOf(scene.playerUnits[0])).toEqual(statsOf(unit));
  expect(run.rewardRerollsSpent).toBe(1);
  expect(s.runManager.rewardRerollsSpent).toBe(1);
});

it('the battle stream is the same with and without a reroll', async () => {
  const world = async (rerolled) => {
    storage = new JourneyStorage();
    vi.stubGlobal('localStorage', storage);
    installSeed(42);
    const { d, s, reroll, presentation, continuation } = await levelUpCardUp();
    if (rerolled) expect(reroll.run().ok).toBe(true);
    closePopup();
    await presentation;
    completeResolvedAction(s, continuation, { session: s._battleSession });
    const cp = saved(d).battleInProgress.checkpoint;
    return {
      live: s._battleRng.getState(),
      next: s._battleRng(),
      cp: [cp.checkpointIndex, cp.rngSeed, cp.rngState],
    };
  };
  const plain = await world(false);
  const rerolled = await world(true);
  expect(rerolled).toEqual(plain);
});

it('a failed write changes nothing, in memory or on disk', async () => {
  const { d, s, unit, card, reroll } = await levelUpCardUp();
  const live = { stats: statsOf(unit), gains: { ...card.levelUp.gains } };
  const checkpoint = s.runManager.battleInProgress.checkpoint;
  const disk = storage.values.get('emblem_rogue_slot_1_run');
  storage.failWrites = true;
  const out = reroll.run();
  expect(out).toMatchObject({ ok: false, message: 'Could not save the reroll: nothing changed.' });
  expect(statsOf(unit)).toEqual(live.stats);
  expect(card.levelUp.gains).toEqual(live.gains);
  expect(s.runManager.rewardRerollsSpent).toBe(0);
  expect(s.runManager.battleInProgress.checkpoint).toBe(checkpoint);
  expect(storage.values.get('emblem_rogue_slot_1_run')).toBe(disk);
  // Storage back: the reroll is offered as before.
  storage.failWrites = false;
  expect(reroll.state().label).toBe('Reroll (3)');
  expect(saved(d).rewardRerollsSpent ?? 0).toBe(0);
});

it('a Vision rewind to before the level-up restores the unit and refunds the charge', async () => {
  let v = null;
  let entry = null;
  const { d, s, unit, reroll } = await levelUpCardUp({
    // The rewind point: the settled board before the attack's XP.
    beforeXp: (scene) => {
      scene.runManager.visionChargesRemaining = 2;
      v = new VisionRewindController(scene, scene.runManager);
      scene._visionController = v;
      vi.spyOn(v, 'playRewindEffect').mockImplementation(() => {});
      v.captureSnapshot();
      entry = statsOf(scene.playerUnits[0]);
    },
  });
  expect(reroll.run().ok).toBe(true);
  expect(s.runManager.rewardRerollsSpent).toBe(1);
  expect(statsOf(unit)).not.toEqual(entry);
  closePopup();
  expect(s.visionSnapshot.runBattleState.rewardRerollsSpent).toBe(0);
  expect(v.executeRewind()).toBe(true);
  expect(s.runManager.rewardRerollsSpent).toBe(0);
  expect(statsOf(s.playerUnits[0])).toEqual(entry);
  const disk = saved(d);
  expect(disk.rewardRerollsSpent).toBe(0);
  expect(disk.visionChargesRemaining).toBe(1);
  expect(statsOf(disk.battleInProgress.checkpoint.playerUnits[0])).toEqual(entry);
});

it('Continue from Map restores the battle-entry count (memory and save)', async () => {
  const { d, s, reroll } = await levelUpCardUp();
  expect(reroll.run().ok).toBe(true);
  expect(reroll.run().ok).toBe(true);
  expect(saved(d).rewardRerollsSpent).toBe(2);
  expect(clearBattleInProgressInSave(null, 1).ok).toBe(true);
  expect(saved(d).rewardRerollsSpent).toBe(0);
  expect(s.runManager.revertBattleInProgressToEntry()).toBe(true);
  expect(s.runManager.rewardRerollsSpent).toBe(0);
});

it('after a victory (saved as won) the roster’s copy takes the same swap, and is saved', async () => {
  const { d, s, unit, reroll } = await levelUpCardUp();
  // completeBattle: the flag cleared, the survivors written into the roster.
  s.runManager.clearBattleInProgress();
  s.runManager.roster.push(serializeUnit(unit));
  s.battleState = 'BATTLE_END';
  expect(reroll.run().ok).toBe(true);
  const twin = s.runManager.roster.find((u) => u.unitUid === 'ru77');
  expect(statsOf(twin)).toEqual(statsOf(unit));
  const disk = saved(d);
  expect(disk.rewardRerollsSpent).toBe(1);
  expect(statsOf(disk.roster.find((u) => u.unitUid === 'ru77'))).toEqual(statsOf(unit));
});

it('a run without Branching Threads gets no handle at all', async () => {
  const { reroll } = await levelUpCardUp({ rerolls: 0 });
  expect(reroll).toBeNull();
});
