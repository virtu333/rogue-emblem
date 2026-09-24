import { resolveCombat, getCombatForecast } from '../src/engine/Combat.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { rollStrikeSkills, rollDefenseSkills } from '../src/engine/SkillSystem.js';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { BattleScene } from '../src/scenes/BattleScene.js';

import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { journeyBattleScene } from './harness/JourneyBattleScene.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import {
  presentQueuedLevelUps,
  captureResolvedAction,
} from '../src/ui/BattlePresentationCheckpoint.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { persistFatalDecision } from '../src/ui/BattleFatalDecision.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { completeBattleAction } from '../src/ui/BattleActionCompletion.js';
import { battleTimelinePreview, combatTimelineFacts } from '../src/engine/BattleTimelineFacts.js';
import {
  canRewindToEntry,
  getEntryState,
  branchBattleTimeline,
} from '../src/engine/BattleTimeline.js';
import { loadRun, clearBattleInProgressInSave } from '../src/engine/RunManager.js';
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
  run.visionChargesRemaining = 3;
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
  vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
  scene.captureVisionSnapshot();
  scene._timelineBoundary = 'turn_start';
  expect(scene._captureSuspendCheckpoint()).toBe(true);
  return { driver, scene, run };
}
describe('production timeline boundaries and recovery', () => {
  it.each([1, 42, 773])(
    'seed %i: bounded wait → preview → failed write/retry → rewind → reload journeys',
    (seed) => {
      const initial = fixture();
      const { driver } = initial;
      let scene = initial.scene;
      const choose = createBattleRng(seed); // Never consumes the gameplay stream.
      const counts = { wait: 0, preview: 0, failedWrite: 0, rewind: 0, reload: 0 };
      const trace = driver.trace;
      vi.spyOn(scene._visionController, 'showDialog').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        for (let round = 0; round < 2; round++) {
          const ready = scene.playerUnits.filter((unit) => !unit.hasActed);
          const actor = ready[Math.floor(choose() * ready.length)];
          trace.push({ action: 'wait', actorId: actor.battleEntityId });
          completeBattleAction(scene, actor);
          counts.wait++;
          const history = scene._battleTimeline;
          const destinations = history.entries.filter(
            (entry) =>
              entry.id !== scene._timelineCurrentEntryId &&
              canRewindToEntry(history, entry.id, {
                difficulty: 'normal',
                allowPlayerActions: true,
              }),
          );
          const id = destinations[Math.floor(choose() * destinations.length)].id;
          const target = getEntryState(history, id);
          const branch = branchBattleTimeline(history, id);
          const raw = storage.getItem('emblem_rogue_slot_1_run');
          const cursor = scene._battleRng.getState();
          const historyBefore = structuredClone(history);
          trace.push({ action: 'preview', entryId: id });
          const preview = battleTimelinePreview(target, driver.data.terrain);
          preview.units[0].name = 'Detached preview';
          expect(scene._battleTimeline).toEqual(historyBefore);
          expect(scene._battleRng.getState()).toEqual(cursor);
          expect(storage.getItem('emblem_rogue_slot_1_run')).toBe(raw);
          counts.preview++;
          const intent = scene._visionController.createRewindIntent(target);
          const charges = scene.runManager.visionChargesRemaining;
          storage.failWrites = true;
          trace.push({ action: 'rewind', entryId: id, injectedWriteFailure: true });
          expect(scene._visionController.executeRewind(target, branch, intent)).toBe(false);
          expect(scene.runManager.visionChargesRemaining).toBe(charges);
          expect(storage.getItem('emblem_rogue_slot_1_run')).toBe(raw);
          counts.failedWrite++;
          storage.failWrites = false;
          trace.push({ action: 'retryRewind', entryId: id });
          expect(scene._visionController.executeRewind(target, branch, intent)).toBe(true);
          counts.rewind++;
          const writes = storage.writes;
          trace.push({ action: 'reload' });
          const restored = loadRun(driver.data, 1);
          expect(storage.writes).toBe(writes);
          expect(restored.visionChargesRemaining).toBe(charges - 1);
          expect(restored.battleInProgress.checkpoint.rngState).toEqual(target.rngState);
          expect(restored.battleInProgress.checkpoint.playerUnits).toEqual(target.playerUnits);
          expect(restored.battleInProgress.timeline.revision).toBe(round + 1);
          expect(new Set(restored.battleInProgress.timeline.entries.map((e) => e.id)).size).toBe(
            restored.battleInProgress.timeline.entries.length,
          );
          // Discard the old scene and continue from the application's last
          // write. These assignments mirror BattleScene's rendering-only boot.
          scene = journeyBattleScene(restored, driver.data);
          scene.grid.fogEnabled = false;
          scene._battleTimeline = restored.battleInProgress.timeline;
          scene._timelineCurrentEntryId = restored.battleInProgress.timelineCurrentEntryId;
          scene._battleCommanderId = restored.battleInProgress.checkpoint.commanderEntityId;
          scene._visionController = new VisionRewindController(scene, restored);
          vi.spyOn(scene._visionController, 'playRewindEffect').mockImplementation(() => {});
          vi.spyOn(scene._visionController, 'showDialog').mockImplementation(() => {});
          const resume = new BattleSuspendController(scene);
          resume.applyUnits(restored.battleInProgress.checkpoint);
          resume.finalizeResume(restored.battleInProgress.checkpoint);
          expect(scene._battleRng.getState()).toEqual(target.rngState);
          counts.reload++;
        }
        expect(counts).toEqual({ wait: 2, preview: 2, failedWrite: 2, rewind: 2, reload: 2 });
      } catch (error) {
        throw new Error(`Timeline journey failed: ${JSON.stringify({ seed, trace, counts })}`, {
          cause: error,
        });
      }
    },
  );
  it('records completed actions, preserves spent actions, and restricts Lunatic destinations', () => {
    const { scene } = fixture();
    completeBattleAction(scene, scene.playerUnits[0]);
    const history = scene._battleTimeline;
    expect(history.entries.map((e) => e.kind)).toEqual(['turn_start', 'player_action']);
    expect(canRewindToEntry(history, 2, { allowPlayerActions: true, difficulty: 'normal' })).toBe(
      true,
    );
    expect(canRewindToEntry(history, 2, { allowPlayerActions: true, difficulty: 'lunatic' })).toBe(
      false,
    );
    expect(getEntryState(history, 2).playerUnits[0].hasActed).toBe(true);
    scene._pendingActionCompletion = { kind: 'combat', unitName: scene.playerUnits[1].name };
    scene._timelineFacts = ['Combat resolved before level-up.'];
    scene._captureSuspendCheckpoint();
    expect(scene._battleTimeline.entries.at(-1).destination).toBe(false);
  });
  it('fatal checkpoint reload preserves dead commander identity and never starts AI', () => {
    const { driver, scene, run } = fixture();
    const commander = scene.playerUnits.shift();
    scene._battleCommanderName = commander.name;
    scene.turnManager.currentPhase = 'enemy';
    expect(persistFatalDecision(scene).ok).toBe(true);
    const restoredRun = loadRun(driver.data, 1);
    const cp = restoredRun.battleInProgress.checkpoint;
    expect(cp.recoveryKind).toBe('fatal_pending');
    expect(cp.commanderEntityId).toBe(commander.battleEntityId);
    expect(cp.playerUnits.some((u) => u.isCommander)).toBe(false);
    expect(restoredRun.status).toBe('active');
    const resumed = journeyBattleScene(restoredRun, driver.data);
    resumed.showLordDeathVisionPrompt = vi.fn(() => true);
    resumed.startEnemyPhase = vi.fn();
    const controller = new BattleSuspendController(resumed);
    controller.applyUnits(cp);
    controller.finalizeResume(cp);
    expect(resumed.showLordDeathVisionPrompt).toHaveBeenCalledOnce();
    expect(resumed.startEnemyPhase).not.toHaveBeenCalled();
    expect(resumed.turnManager.endPlayerPhaseCalls).toBe(0);
    expect(resumed._fatalDecision.durable).toBe(true);
    // The reloaded prompt names the fallen commander, not "Your commander".
    expect(cp.commanderName).toBe(commander.name);
    expect(resumed._battleCommanderName).toBe(commander.name);
    expect(clearBattleInProgressInSave(null, 1).reason).toBe('fatal_pending');
    expect(run.visionChargesRemaining).toBe(3);
  });
  it('failed fatal save freezes once and retries the same settled candidate', () => {
    const { scene, driver } = fixture();
    scene.playerUnits.shift();
    storage.failWrites = true;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(persistFatalDecision(scene).ok).toBe(false);
    const candidate = scene._fatalDecision.candidate;
    expect(scene.battleState).toBe('PAUSED');
    expect(loadRun(driver.data, 1).battleInProgress.checkpoint.recoveryKind).not.toBe(
      'fatal_pending',
    );
    storage.failWrites = false;
    expect(persistFatalDecision(scene).ok).toBe(true);
    expect(scene._fatalDecision.candidate).toBe(candidate);
    expect(loadRun(driver.data, 1).battleInProgress.checkpoint.recoveryKind).toBe('fatal_pending');
  });
  it('fatal retry that must prune the only destinations settles defeat instead of leaving a frozen board', () => {
    const { scene, driver } = fixture();
    scene.visionSnapshot = null;
    scene.playerUnits.shift();
    scene.onDefeat = vi.fn();
    const controller = scene._visionController;
    const dialog = vi.spyOn(controller, 'showDialog').mockImplementation(() => {});
    const write = scene._persistBattleRunState.bind(scene);
    const persist = vi
      .spyOn(scene, '_persistBattleRunState')
      .mockReturnValue({ ok: false, reason: 'write_error' });
    expect(controller.showLordDeathPrompt()).toBe(true);
    expect(scene.onDefeat).not.toHaveBeenCalled();
    const retry = dialog.mock.calls.at(-1)[0].onConfirm;
    persist.mockImplementation((candidate) =>
      candidate.battleInProgress.timeline.entries.length
        ? { ok: false, reason: 'quota' }
        : write(candidate),
    );
    retry();
    expect(scene.onDefeat).toHaveBeenCalledOnce();
    const saved = loadRun(driver.data, 1);
    expect(saved.battleInProgress.checkpoint.recoveryKind).toBe('fatal_pending');
    expect(saved.battleInProgress.timeline.entries).toHaveLength(0);
    expect(saved.visionChargesRemaining).toBe(3);
  });
  it('fatal rewind persists branch/debit and restores commander without recapture', () => {
    const { scene, driver, run } = fixture();
    const target = getEntryState(scene._battleTimeline, 1);
    const branch = branchBattleTimeline(scene._battleTimeline, 1);
    scene.playerUnits.shift();
    scene.turnManager.currentPhase = 'enemy';
    persistFatalDecision(scene);
    const write = vi.spyOn(scene, '_persistBattleRunState');
    expect(scene._visionController.executeRewind(target, branch)).toBe(true);
    expect(write).toHaveBeenCalledOnce();
    expect(scene._fatalDecision).toBeNull();
    expect(scene.playerUnits[0].isCommander).toBe(true);
    expect(run.visionChargesRemaining).toBe(2);
    const cp = loadRun(driver.data, 1).battleInProgress.checkpoint;
    expect(cp.recoveryKind).toBe('playable');
    expect(cp.rngState).toEqual(target.rngState);
    expect(run.battleInProgress.timelineCurrentEntryId).toBe(1);
  });
  it('restoring an exhausted player phase hands off once, including after reload', () => {
    const { scene, driver } = fixture();
    for (const unit of scene.playerUnits) completeBattleAction(scene, unit);
    const history = scene._battleTimeline;
    const id = history.entries.at(-1).id;
    const state = getEntryState(history, id);
    scene.turnManager.endPlayerPhaseCalls = 0;
    expect(scene._visionController.executeRewind(state, branchBattleTimeline(history, id))).toBe(
      true,
    );
    expect(scene.turnManager.endPlayerPhaseCalls).toBe(1);
    const run = loadRun(driver.data, 1),
      resumed = journeyBattleScene(run, driver.data),
      controller = new BattleSuspendController(resumed);
    controller.applyUnits(run.battleInProgress.checkpoint);
    controller.finalizeResume(run.battleInProgress.checkpoint);
    expect(resumed.turnManager.endPlayerPhaseCalls).toBe(1);
  });
  it('history masks hidden units forever and previewing does not mutate live or saved data', () => {
    const { scene, run } = fixture();
    const hidden = {
      ...structuredClone(scene.playerUnits[0]),
      name: 'Secret General',
      faction: 'enemy',
      col: 3,
      row: 3,
      battleEntityId: 'u99',
    };
    scene.enemyUnits = [hidden];
    scene.grid.fogEnabled = true;
    scene._timelineFacts = combatTimelineFacts(scene, hidden, scene.playerUnits[0], {
      events: [{ type: 'strike', attackerSide: 'attacker', damage: 9, isCrit: true }],
    });
    scene._timelineBoundary = 'enemy_action';
    scene.turnManager.currentPhase = 'enemy';
    scene._enemyActionCheckpoint = true;
    scene._captureSuspendCheckpoint();
    const row = scene._battleTimeline.entries.at(-1);
    expect(JSON.stringify(row)).not.toContain('Secret General');
    expect(row.facts.join(' ')).toContain('Unseen enemy critically hit');
    const before = JSON.stringify(run.toJSON()),
      cursor = scene._battleRng.getState();
    const state = getEntryState(scene._battleTimeline, 1);
    for (let i = 0; i < 20; i++) battleTimelinePreview(state, scene.gameData.terrain);
    expect(JSON.stringify(run.toJSON())).toBe(before);
    expect(scene._battleRng.getState()).toEqual(cursor);
    scene.grid.visibleSet.add('3,3');
    expect(JSON.stringify(row)).not.toContain('Secret General');
  });
  it('ordinary popup/continuation saves cannot overwrite a fatal checkpoint', async () => {
    const { scene, driver } = fixture();
    scene.playerUnits.shift();
    persistFatalDecision(scene);
    const raw = storage.getItem('emblem_rogue_slot_1_run');
    scene._pendingLevelUpPopups = [
      { unitName: scene.playerUnits[0].name, levelUp: { gains: { HP: 1 } } },
    ];
    const continuation = { kind: 'combat', unitName: scene.playerUnits[0].name };
    captureResolvedAction(scene, continuation);
    await presentQueuedLevelUps(scene, continuation);
    expect(scene._captureSuspendCheckpoint()).toBe(false);
    expect(storage.getItem('emblem_rogue_slot_1_run')).toBe(raw);
    expect(loadRun(driver.data, 1).battleInProgress.checkpoint.recoveryKind).toBe('fatal_pending');
  });
  it('Accept Fate waits for a durable defeat and records the actual terminal report once', () => {
    const { scene, driver, run } = fixture();
    scene.playerUnits.shift();
    persistFatalDecision(scene);
    scene.clearInspectionVisuals = vi.fn();
    scene._pinToScreen = vi.fn();
    scene.clearBattleScopedDeltas = vi.fn();
    scene.cameras = { main: { centerX: 0, centerY: 0 } };
    scene.time = { delayedCall: vi.fn() };
    scene.showVisionDialog = vi.fn();
    const persist = scene._persistBattleRunState.bind(scene);
    vi.spyOn(scene, '_persistBattleRunState').mockReturnValue({ ok: false, reason: 'write_error' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = new PostCombatController(scene);
    controller.onDefeat();
    expect(run.status).toBe('active');
    expect(scene.battleState).toBe('PAUSED');
    expect(scene.time.delayedCall).not.toHaveBeenCalled();
    expect(loadRun(driver.data, 1).status).toBe('active');
    scene._persistBattleRunState.mockImplementation(persist);
    controller.onDefeat();
    const loaded = loadRun(driver.data, 1);
    expect(loaded.status).toBe('defeat');
    expect(loaded.battleInProgress).toBeNull();
    expect(loaded.lastBattleReport.entries.at(-1).facts).toContain('Defeat. The run has ended.');
    expect(Object.keys(loaded.lastBattleReport.snapshots)).toHaveLength(0);
    expect(scene.time.delayedCall).toHaveBeenCalledOnce();
    controller.onDefeat();
    expect(scene.time.delayedCall).toHaveBeenCalledOnce();
  });
  it.each(['recovery', 'fatal', 'rewind'])(
    'quota drops optional history but keeps exact %s record',
    (mode) => {
      const { scene, driver, run } = fixture();
      const target = getEntryState(scene._battleTimeline, 1);
      const write = scene._persistBattleRunState.bind(scene);
      vi.spyOn(scene, '_persistBattleRunState').mockImplementation((candidate) => {
        const data = candidate || run.toJSON();
        if (data.battleInProgress.timeline?.entries.length) return { ok: false, reason: 'quota' };
        return write(candidate);
      });
      if (mode === 'fatal') {
        scene.playerUnits.shift();
        expect(persistFatalDecision(scene).ok).toBe(true);
      } else if (mode === 'rewind')
        expect(
          scene._visionController.executeRewind(
            target,
            branchBattleTimeline(scene._battleTimeline, 1),
          ),
        ).toBe(true);
      else expect(scene._captureSuspendCheckpoint()).toBe(true);
      const saved = loadRun(driver.data, 1);
      expect(saved.battleInProgress.timeline.entries).toHaveLength(0);
      expect(saved.battleInProgress.timeline.earlierHistoryUnavailable).toBe(true);
      expect(saved.visionChargesRemaining).toBe(mode === 'rewind' ? 2 : 3);
      expect(saved.battleInProgress.checkpoint.rngState).toEqual(target.rngState);
      if (mode === 'fatal')
        expect(saved.battleInProgress.checkpoint.recoveryKind).toBe('fatal_pending');
    },
  );
  it('a corrupt optional destination cannot poison valid current recovery', () => {
    const { driver, run } = fixture();
    const data = run.toJSON();
    const snapshot = Object.values(data.battleInProgress.timeline.snapshots)[0];
    snapshot.fog = { visible: 3, everSeen: [] };
    storage.setItem('emblem_rogue_slot_1_run', JSON.stringify(data));
    const restored = loadRun(driver.data, 1);
    expect(restored._battleRecoveryInvalid).toBe(false);
    expect(restored.battleInProgress.timeline).toBeNull();
    data.battleInProgress.checkpoint.fog = { visible: 3, everSeen: [] };
    storage.setItem('emblem_rogue_slot_1_run', JSON.stringify(data));
    const corrupt = loadRun(driver.data, 1);
    expect(corrupt._battleRecoveryInvalid).toBe(true);
    expect(corrupt.battleInProgress).not.toBeNull();
  });
  it.each(['null unit', 'future version'])(
    'preserves rejected current saves for recovery without migrating them: %s',
    (corruption) => {
      const { driver, run } = fixture();
      const data = run.toJSON();
      const checkpoint = data.battleInProgress.checkpoint;
      if (corruption === 'null unit') checkpoint.playerUnits = [null];
      else checkpoint.version = 999;
      const raw = JSON.stringify(data);
      storage.setItem('emblem_rogue_slot_1_run', raw);
      const restored = loadRun(driver.data, 1);
      expect(restored).not.toBeNull();
      expect(restored._battleRecoveryInvalid).toBe(true);
      expect(restored.battleInProgress.checkpoint).toEqual(checkpoint);
      expect(storage.getItem('emblem_rogue_slot_1_run')).toBe(raw);
    },
  );
  it('real hit/crit/proc outcomes match after paid rewind and reload despite forecast browsing', () => {
    const { scene, driver, run } = fixture();
    scene.reseedBattleRng = BattleScene.prototype.reseedBattleRng.bind(scene);
    scene.reseedBattleRng(42);
    const attacker = scene.playerUnits[0];
    attacker.skills = ['luna', 'sol', 'adept'];
    attacker.stats.SKL = 30;
    const enemy = structuredClone(attacker);
    Object.assign(enemy, {
      name: 'Replay foe',
      faction: 'enemy',
      col: 2,
      row: 1,
      battleEntityId: 'u99',
      isCommander: false,
      skills: ['pavise'],
    });
    enemy.stats.HP = 70;
    enemy.currentHP = 70;
    scene.enemyUnits = [enemy];
    scene.addUnitGraphic(enemy);
    scene._timelineBoundary = 'turn_start';
    scene._captureSuspendCheckpoint();
    const targetId = scene._timelineCurrentEntryId,
      target = getEntryState(scene._battleTimeline, targetId);
    const ctx = { rollStrikeSkills, rollDefenseSkills, skillsData: driver.data.skills };
    const terrain = { defense: 0, avoid: 0 };
    const resolve = (s, browse = false) => {
      const a = s.playerUnits[0],
        d = s.enemyUnits[0];
      if (browse)
        for (let i = 0; i < 8; i++)
          getCombatForecast(a, a.weapon, d, d.weapon, 1, terrain, terrain, ctx);
      return resolveCombat(a, a.weapon, d, d.weapon, 1, terrain, terrain, ctx);
    };
    const direct = resolve(scene);
    expect(direct.events.length).toBeGreaterThan(0);
    expect(
      scene._visionController.executeRewind(
        target,
        branchBattleTimeline(scene._battleTimeline, targetId),
      ),
    ).toBe(true);
    expect(resolve(scene, true)).toEqual(direct);
    const restored = loadRun(driver.data, 1),
      resumed = journeyBattleScene(restored, driver.data);
    resumed.reseedBattleRng = BattleScene.prototype.reseedBattleRng.bind(resumed);
    const controller = new BattleSuspendController(resumed);
    controller.applyUnits(restored.battleInProgress.checkpoint);
    controller.finalizeResume(restored.battleInProgress.checkpoint);
    expect(resolve(resumed, true)).toEqual(direct);
    expect(run.visionChargesRemaining).toBe(2);
  });
  it('resume merges an in-progress action fragment once under its durable row ID', () => {
    const { scene, driver } = fixture();
    const unit = scene.playerUnits[0];
    const continuation = { kind: 'finish', unitName: unit.name, unitId: unit.battleEntityId };
    scene._timelineFacts = [`${unit.name} hit Enemy for 5 damage.`];
    captureResolvedAction(scene, continuation);
    const fragmentId = scene._battleTimeline.entries.at(-1).id;
    const restored = loadRun(driver.data, 1),
      resumed = journeyBattleScene(restored, driver.data);
    resumed._battleTimeline = restored.battleInProgress.timeline;
    resumed.finishUnitAction = (unit) => completeBattleAction(resumed, unit);
    const controller = new BattleSuspendController(resumed);
    controller.applyUnits(restored.battleInProgress.checkpoint);
    controller.finalizeResume(restored.battleInProgress.checkpoint);
    const rows = resumed._battleTimeline.entries;
    expect(rows.at(-1).id).toBe(fragmentId);
    expect(rows.at(-1).kind).toBe('player_action');
    expect(
      rows.flatMap((row) => row.facts).filter((fact) => fact.includes('hit Enemy')),
    ).toHaveLength(1);
    expect(restored._battleRecoveryInvalid).toBe(false);
  });
});

describe('battlefield presentation integration', () => {
  it('preserves A trade → C action → A action chronology and parent identity across reload', async () => {
    const { scene, run } = fixture();
    const { BattleTradeMenu } = await import('../src/ui/BattleTradeMenu.js');
    const { rememberHistoryPath } = await import('../src/ui/BattleHistoryRecorder.js');
    const { hydrateBattleTimeline } = await import('../src/engine/BattleTimeline.js');
    const { historyFrameAt } = await import('../src/engine/BattleHistoryPresentation.js');
    const [a, c] = scene.playerUnits;
    const origin = { col: a.col, row: a.row };
    rememberHistoryPath(scene, a, [origin, { col: a.col + 1, row: a.row }]);
    a.col++;
    const item = { name: 'Vulnerary', uses: 3 };
    a.consumables = [item];
    c.consumables = [];
    scene.battleState = 'TRADING';
    BattleTradeMenu.prototype.transfer.call({
      scene,
      left: a,
      right: c,
      selection: { owner: a, recipient: c, item, key: 'consumables', cap: 3 },
      render() {},
      surface: { focusContent() {} },
    });
    let archive = scene._battleTimeline.presentation;
    expect(archive).not.toBeNull();
    const trade = archive.records.at(-1);
    expect(trade.kind).toBe('recovery');
    expect(trade.beats[0].path).toEqual([origin, { col: a.col, row: a.row }]);
    expect(trade.beats[1].type).toBe('traded with');
    // The optional parent registry is recovered from the same persisted history.
    scene._battleTimeline = hydrateBattleTimeline(
      JSON.parse(JSON.stringify(scene._battleTimeline)),
    );
    run.battleInProgress.timeline = scene._battleTimeline;
    completeBattleAction(scene, c);
    const afterC = structuredClone(scene._battleTimeline);
    const cId = scene._timelineCurrentEntryId;
    completeBattleAction(scene, a);
    archive = scene._battleTimeline.presentation;
    const last = archive.records.at(-1);
    expect(last.actorId).toBe(a.battleEntityId);
    expect(last.parentId).toBe(trade.parentId);
    expect(archive.records.map((r) => r.actorId).filter(Boolean)).toEqual([
      a.battleEntityId,
      c.battleEntityId,
      a.battleEntityId,
    ]);
    const branch = branchBattleTimeline(scene._battleTimeline, cId);
    expect(branch.presentation.records.at(-1).parents[a.battleEntityId]).toBe(trade.parentId);
    expect(historyFrameAt(branch.presentation, branch.presentation.records.length - 1)).toEqual(
      historyFrameAt(afterC.presentation, afterC.presentation.records.length - 1),
    );
    expect(branch.presentation.nextId).toBe(archive.nextId);
  });

  it('keeps a committed debit and exposes reload when presentation teardown fails', () => {
    const { scene, run } = fixture();
    const controller = scene._visionController;
    const target = scene._battleTimeline.entries[0].id;
    const state = getEntryState(scene._battleTimeline, target);
    const dialog = vi.spyOn(controller, 'showDialog').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    controller._historySession = {
      destroy() {
        throw new Error('renderer teardown failed');
      },
    };
    expect(
      controller.executeRewind(state, branchBattleTimeline(scene._battleTimeline, target)),
    ).toBe(false);
    expect(run.visionChargesRemaining).toBe(2);
    expect(JSON.parse(storage.getItem('emblem_rogue_slot_1_run')).visionChargesRemaining).toBe(2);
    expect(dialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Rewind saved',
        confirmLabel: 'Reload',
        cancelLabel: 'Reload',
      }),
    );
    expect(scene.battleState).toBe('PAUSED');
  });
});
