// The act boss's earned-blessing pick (docs/specs/blessings-v3.md §6.4, "as built"): rolled at
// the victory commit, shown after the boss's reward, recruit and lord and before the act
// advances, on the battle scene (PostCombatController.transitionAfterBattle) or, after a reload,
// on the route map (NodeMapScene.checkActComplete / _maybeOpenEarnedPick), through one menu
// (ui/EarnedBlessingPick.js). Real RunManager, real controller and scene methods, the fake DOM
// (tests/helpers/fakeDom.js); only the scene hop and the save are stubs.
//
// Each test names the realistic failure it catches.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (v, min, max) => Math.max(min, Math.min(max, v)) },
  },
}));
vi.mock('../src/utils/SceneRouter.js', async (importOriginal) => ({
  ...(await importOriginal()),
  transitionToScene: vi.fn(async () => true),
}));
vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));
vi.mock('../src/ui/HintDisplay.js', () => ({
  showImportantHint: vi.fn(async () => true),
  showMinorHint: vi.fn(async () => true),
}));
// The battle's own run save is the real BattleScene._persistBattleRunState over a stubbed disk.
vi.mock('../src/engine/RunManager.js', async (importOriginal) => ({
  ...(await importOriginal()),
  saveRun: vi.fn(() => ({ ok: true })),
}));
// Rendering adapters for the route map's overlays: open, visible, and closed through the
// scene's own callbacks (the real _openRoster / showPauseMenu wiring).
vi.mock('../src/ui/RosterOverlay.js', () => ({
  RosterOverlay: class {
    constructor(scene, run, gameData, callbacks = {}) {
      this.onClose = callbacks.onClose || null;
      this.visible = false;
    }
    show() {
      this.visible = true;
    }
    hide() {
      if (!this.visible) return;
      this.visible = false;
      this.onClose?.();
    }
  },
}));
vi.mock('../src/ui/PauseOverlay.js', () => ({
  PauseOverlay: class {
    constructor(scene, callbacks = {}) {
      this.onResume = callbacks.onResume || null;
      this.visible = false;
    }
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
      this.onResume?.();
    }
  },
}));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { RunManager, saveRun } from '../src/engine/RunManager.js';
import {
  earnedPickOwed,
  skipEarnedBlessing,
  takeEarnedBlessing,
} from '../src/engine/EarnedBlessings.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
import { LootFlowController } from '../src/ui/LootFlowController.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { EarnedBlessingPick } from '../src/ui/EarnedBlessingPick.js';
import { earnedPickFooter, earnedPickModel } from '../src/ui/earnedBlessingPickModel.js';
import { blessingTarotCard } from '../src/ui/choiceCards.js';
import { blessingCardContent } from '../src/ui/choiceContent.js';
import { transitionToScene } from '../src/utils/SceneRouter.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { showMinorHint } from '../src/ui/HintDisplay.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { EARNED_PICK_SAVE_FAILED } from '../src/ui/earnedBlessingPickModel.js';
import { InputAction } from '../src/utils/InputActions.js';
import { _resetInputFocus, dispatchInputAction } from '../src/utils/inputFocus.js';
import { DIFFICULTY_IDS } from '../src/engine/DifficultyEngine.js';

const data = loadGameData();

const store = {};
beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
  });
  vi.mocked(transitionToScene).mockClear();
  vi.mocked(saveServiceRun).mockClear();
  vi.mocked(saveServiceRun).mockImplementation(() => '');
  vi.mocked(showMinorHint).mockClear();
  vi.mocked(saveRun).mockClear();
  vi.mocked(saveRun).mockImplementation(() => ({ ok: true }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  _resetInputFocus();
});

function withDom() {
  const dom = installFakeDom(vi);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return dom;
}

function eventsFor() {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    once: (name, fn) => listeners(name).add(fn),
    on: (name, fn) => listeners(name).add(fn),
    off: (name, fn) => listeners(name).delete(fn),
    emit: (name) => [...listeners(name)].forEach((fn) => fn()),
  };
}

function freshRun({ seed = 4242, difficultyId = 'normal' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  return rm;
}

/** Walk the act to its boss and win it, as the route map would. Returns the boss node. */
function winAct(rm) {
  for (let guard = 0; guard < 80 && !rm.isActComplete(); guard++) {
    const node = rm.getAvailableNodes()[0];
    if (!node) break;
    if (['battle', 'boss', 'recruit'].includes(node.type))
      rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 5, turnPar: 7 });
    else rm.markNodeComplete(node.id);
  }
  return rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
}

/**
 * Win every act of a run, leaving Act I's pick owed (a debug advance over it) and skipping the
 * others: the final boss is won, the run is complete, and a stale pick is still owed.
 */
function winRunWithStalePick(rm) {
  winAct(rm);
  for (let act = 1; act < rm.actSequence.length; act++) {
    rm.advanceAct();
    winAct(rm);
    if (rm.earnedBlessingPicks[rm.currentAct]?.status === 'owed')
      skipEarnedBlessing(rm, rm.currentAct);
  }
  return rm;
}

/** A kept contract's reward earned on the act boss and not yet delivered (it holds the party). */
function oweBossContract(rm) {
  const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
  rm.currentNodeId = boss.id;
  rm.contractOwed = {
    battleNodeId: boss.id,
    contractNodeId: 'contract',
    eventId: 'contract',
    act: rm.currentAct,
    goal: 'underPar',
    kept: true,
    noPar: false,
    losses: 0,
    effects: [{ type: 'gold', value: 50 }],
    seedKey: 'event-contract:1:contract',
    blocked: null,
    failed: null,
  };
  return boss;
}

const dialogs = (doc) =>
  doc.querySelectorAll('section').filter((s) => s.attributes.role === 'dialog');
const dialogNamed = (doc, name) => dialogs(doc).find((d) => d.attributes['aria-label'] === name);
const buttonIn = (root, text) =>
  root.querySelectorAll('button').find((b) => b.textContent === text);
const pickCards = (doc) => dialogNamed(doc, 'An earned blessing').querySelectorAll('.ch-card');

/** The battle scene the victory flow runs on (rendering adapters only). */
function battleScene(rm, extra = {}) {
  return {
    _battleSession: 1,
    runManager: rm,
    gameData: data,
    isElite: false,
    battleState: 'BATTLE_END',
    nodeId: rm.nodeMap.bossNodeId,
    registry: { get: () => null },
    events: eventsFor(),
    reportLootError: vi.fn(),
    forceTransitionAfterBattle: vi.fn(),
    _persistBattleRunState: vi.fn(() => ({ ok: true })),
    _showStoryDialogueOnce: vi.fn(async () => {}),
    ...extra,
  };
}

/** The route map, ready, with nothing else open (the real methods under test). */
function mapScene(rm) {
  const scene = Object.create(NodeMapScene.prototype);
  Object.assign(scene, {
    runManager: rm,
    gameData: data,
    registry: { get: () => null },
    events: eventsFor(),
    sys: { isActive: () => true },
    isSceneReady: true,
    _sceneLifecycleGeneration: 1,
    _earnedPick: null,
    drawMap: vi.fn(),
    persistRunSave: vi.fn(),
    showActCompleteBanner: vi.fn((onComplete) => onComplete()),
    showWeaponArtsUnlockedBanner: vi.fn(),
    _showSkillDisplacementWarning: vi.fn(async () => {}),
    _maybeOpenPendingCaravanShop: vi.fn(() => false),
  });
  return scene;
}

// ── Which bosses offer a pick ────────────────────────────────────────────

describe('which victories owe a pick (completeBattle prepares it with the victory)', () => {
  // Failure: the final act's boss (which ends the run) offers a pick nobody can use, or an act
  // boss before it offers none. First Light ends at the Lieutenant (finalBoss), Dusk at the
  // Emperor (act4), Nightfall and Black Sun at the Entity (finalBoss).
  const expected = {
    normal: ['act1', 'act2', 'act3'],
    dusk: ['act1', 'act2', 'act3'],
    hard: ['act1', 'act2', 'act3', 'act4'],
    lunatic: ['act1', 'act2', 'act3', 'act4'],
  };
  it.each(DIFFICULTY_IDS)('%s: every act boss but the last one offers a pick', (difficultyId) => {
    const rm = freshRun({ seed: 9100, difficultyId });
    const offered = [];
    for (let act = 0; act < rm.actSequence.length; act++) {
      winAct(rm);
      expect(rm.isActComplete(), `${rm.currentAct} boss won`).toBe(true);
      const entry = rm.earnedBlessingPicks[rm.currentAct];
      if (entry) {
        offered.push(rm.currentAct);
        // Nothing held yet (every pick below is left): the odds are 1, so a pair is owed.
        expect(entry).toMatchObject({ status: 'owed', actId: rm.currentAct });
        expect(entry.offered).toHaveLength(2);
        expect(skipEarnedBlessing(rm, rm.currentAct).ok).toBe(true);
      }
      if (act < rm.actSequence.length - 1) rm.advanceAct();
    }
    expect(offered).toEqual(expected[difficultyId]);
    expect(rm.actSequence.at(-1)).toBe(difficultyId === 'dusk' ? 'act4' : 'finalBoss');
  });

  it('a non-boss battle, an elite, an event battle and a boss-typed node that is not the act boss owe none', () => {
    // Failure: the pick keys on `type === 'boss'` or `isElite`, so another victory offers it.
    const rm = freshRun({ seed: 9101 });
    const battles = rm.nodeMap.nodes.filter((n) => n.type === 'battle');
    const [plain, elite, eventFight, fakeBoss] = battles;
    elite.battleParams = { ...(elite.battleParams || {}), isElite: true };
    eventFight.eventBattle = true;
    fakeBoss.type = 'boss';
    for (const node of [plain, elite, eventFight, fakeBoss]) {
      rm.currentNodeId = node.id;
      expect(rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 5, turnPar: 7 })).toBe(
        true,
      );
    }
    expect(rm.earnedBlessingPicks).toEqual({});
  });

  it("the prologue's last chapter (Varro) owes none", () => {
    // Failure: the prologue run, whose last boss hands over to Home Base, offers a pick.
    const rm = new RunManager(data);
    rm.startPrologue(data, data.prologue);
    const boss = winAct(rm);
    expect(boss.completed).toBe(true);
    expect(rm.earnedBlessingPicks).toEqual({});
    expect(earnedPickOwed(rm)).toBeNull();
  });
});

// ── Saved and reloaded ───────────────────────────────────────────────────

describe('the pick survives a reload, once', () => {
  it('a reload between the boss and the pick shows the same pair (it is in the victory save)', () => {
    // Failure: the pair is rolled when the menu opens, so a reload re-rolls it.
    const rm = freshRun({ seed: 9200 });
    winAct(rm);
    const owed = earnedPickOwed(rm);
    expect(owed?.offered).toHaveLength(2);
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(earnedPickOwed(loaded)).toEqual(owed);
  });

  it('a save from before the feature, sitting between the boss and the act advance, is offered the same pair on the route map', () => {
    // Failure: an old save (no ledger) between the boss and the advance loses its pick, or rolls
    // a different pair from the one the victory would have.
    const rm = freshRun({ seed: 9201 });
    winAct(rm);
    const atVictory = [...earnedPickOwed(rm).offered];
    const old = JSON.parse(JSON.stringify(rm.toJSON()));
    delete old.earnedBlessingPicks;
    const loaded = RunManager.fromJSON(old, data);
    expect(earnedPickOwed(loaded)).toBeNull();
    const scene = mapScene(loaded); // no document: the pick cannot open, so the act holds
    NodeMapScene.prototype.checkActComplete.call(scene);
    expect(earnedPickOwed(loaded)?.offered).toEqual(atVictory);
    expect(saveServiceRun).toHaveBeenCalled(); // the lazily rolled pick is saved
    expect(loaded.currentAct).toBe('act1');
    expect(scene.showActCompleteBanner).not.toHaveBeenCalled();
  });

  it.each(['taken', 'skipped'])('a reload after the pick was %s never offers it again', (how) => {
    // Failure: the ledger loses the decision on save, so the route map re-offers the pick.
    const rm = freshRun({ seed: 9202 });
    winAct(rm);
    const owed = earnedPickOwed(rm);
    if (how === 'taken') expect(takeEarnedBlessing(rm, owed.actId, owed.offered[0]).ok).toBe(true);
    else expect(skipEarnedBlessing(rm, owed.actId).ok).toBe(true);
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(earnedPickOwed(loaded)).toBeNull();
    const scene = mapScene(loaded);
    NodeMapScene.prototype.checkActComplete.call(scene);
    expect(loaded.currentAct).toBe('act2'); // straight on to the advance
    expect(loaded.earnedBlessingPicks.act1.status).toBe(how);
  });
});

// ── The battle path ──────────────────────────────────────────────────────

describe('the battle path: the pick before the act advance', () => {
  it('an owed pick that cannot be shown (no document) goes to the route map with the act unadvanced', async () => {
    // Failure: transitionAfterBattle advances the act over an owed pick.
    const rm = freshRun({ seed: 9300 });
    winAct(rm);
    expect(earnedPickOwed(rm)).toBeTruthy();
    const scene = battleScene(rm);
    expect(await new PostCombatController(scene).transitionAfterBattle()).toBe(true);
    expect(rm.currentAct).toBe('act1');
    expect(earnedPickOwed(rm)).toBeTruthy();
    expect(vi.mocked(transitionToScene).mock.calls.map((c) => c[1])).toEqual(['NodeMap']);
    expect(scene.reportLootError).not.toHaveBeenCalled();
  });

  it('Second Dawn taken over the won battle belongs to this act and pays from the next', async () => {
    // Failure: the act advances before the pick (the take is stamped with the next act, so its
    // first Vision is lost), or the take is not saved before the advance.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9301 });
    winAct(rm);
    rm.earnedBlessingPicks.act1.offered = ['captains_whistle', 'second_dawn'];
    const visionAfterBoss = rm.visionChargesRemaining;
    const savedActs = [];
    const scene = battleScene(rm, {
      _persistBattleRunState: vi.fn(() => {
        savedActs.push([rm.currentAct, rm.getActiveBlessingIds().includes('second_dawn')]);
        return { ok: true };
      }),
    });
    const done = new PostCombatController(scene).transitionAfterBattle();
    await vi.waitFor(() => expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy());
    expect(scene._earnedPickActive).toBe(true);
    expect(rm.currentAct).toBe('act1');
    const take = buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take');
    expect(take.disabled).toBe(true); // nothing chosen yet
    pickCards(doc)
      .find((c) => c.dataset.blessing === 'second_dawn')
      .click();
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take').click();
    expect(await done).toBe(true);
    // Saved with the blessing while still in Act I, then again with the advance.
    expect(savedActs[0]).toEqual(['act1', true]);
    expect(savedActs.at(-1)).toEqual(['act2', true]);
    expect(rm.currentAct).toBe('act2');
    expect(rm.visionChargesRemaining).toBe(visionAfterBoss + 1);
    expect(rm.earnedBlessingPicks.act1).toMatchObject({ status: 'taken', chosen: 'second_dawn' });
    expect(scene._earnedPickActive).toBe(false);
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
  });

  it('a double tap on Take takes one blessing, once', async () => {
    // Failure: no busy guard, so two taps add the blessing twice or take both cards.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9302 });
    winAct(rm);
    const [first, second] = earnedPickOwed(rm).offered;
    const scene = battleScene(rm);
    const done = new PostCombatController(scene).transitionAfterBattle();
    await vi.waitFor(() => expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy());
    const menu = dialogNamed(doc, 'An earned blessing');
    pickCards(doc)[0].click();
    const take = buttonIn(menu, 'Take');
    take.onclick();
    take.onclick();
    pickCards(doc)[1]?.onclick?.(); // a stray tap on the other card after the take
    take.onclick();
    // While the taken card seals, the menu stays as it was: no second take reaches the engine
    // (whose refusal would flash "No pick is owed."), and the stray tap moved nothing.
    const sealing = dialogNamed(doc, 'An earned blessing');
    expect(sealing.textContent).not.toContain('No pick is owed');
    expect(pickCards(doc)[0].attributes['aria-pressed']).toBe('true');
    expect(pickCards(doc)[1].attributes['aria-pressed']).toBe('false');
    await done;
    const held = rm.getActiveBlessingIds();
    expect(held.filter((id) => id === first)).toHaveLength(1);
    expect(held).not.toContain(second);
    expect(rm.blessingHistory.filter((e) => e.eventType === 'earned_pick')).toHaveLength(1);
  });

  it('a reward left unclaimed (View map) goes to the route map without opening the pick', async () => {
    // Failure: the pick opens before the boss's reward is claimed.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9303 });
    winAct(rm);
    rm.pendingBattleReward = { nodeId: rm.nodeMap.bossNodeId, choices: [], claimed: [] };
    const scene = battleScene(rm);
    await new PostCombatController(scene).transitionAfterBattle();
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    expect(rm.currentAct).toBe('act1');
    expect(earnedPickOwed(rm)).toBeTruthy();
  });
});

describe('the battle path: what comes before the pick, and its save', () => {
  it('a contract reward owed at the boss goes to the route map first, act unadvanced and the pick unshown', async () => {
    // Failure: the battle shows the pick (and advances the act) over the boss's owed contract
    // reward, so the map's order (contract, pick, advance) is broken on this path.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9320 });
    winAct(rm);
    oweBossContract(rm);
    const scene = battleScene(rm);
    expect(await new PostCombatController(scene).transitionAfterBattle()).toBe(true);
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    expect(rm.currentAct).toBe('act1');
    expect(earnedPickOwed(rm)).toBeTruthy();
    expect(vi.mocked(transitionToScene).mock.calls.map((c) => c[1])).toEqual(['NodeMap']);
    // On the map: the contract's page first, never the pick, never the advance.
    const map = mapScene(rm);
    map.handleContractSettlement = vi.fn(() => true);
    NodeMapScene.prototype.checkActComplete.call(map);
    expect(map.handleContractSettlement).toHaveBeenCalledWith({ auto: true });
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    expect(rm.currentAct).toBe('act1');
  });

  it('the take is written by the real battle save, for this battle session', async () => {
    // Failure: the pick's save is called without `{ session }`, so _persistBattleRunState refuses
    // it as a stale session and nothing reaches the disk until the act advance.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9321 });
    winAct(rm);
    const written = [];
    vi.mocked(saveRun).mockImplementation((run) => {
      written.push([run.currentAct, run.earnedBlessingPicks.act1.status]);
      return { ok: true };
    });
    const scene = battleScene(rm, {
      registry: { get: (key) => (key === 'activeSlot' ? 2 : null) },
      _persistBattleRunState: BattleScene.prototype._persistBattleRunState,
    });
    const done = new PostCombatController(scene).transitionAfterBattle();
    await vi.waitFor(() => expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy());
    pickCards(doc)[0].click();
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take').click();
    expect(await done).toBe(true);
    expect(written[0]).toEqual(['act1', 'taken']); // the pick's own write, before the advance
    expect(written.at(-1)).toEqual(['act2', 'taken']);
    expect(saveRun.mock.calls[0][2]).toBe(2); // the active slot
  });

  it.each([
    ['quota', true],
    ['write_error', true],
    ['missing_slot', false],
  ])('a pick save refused with %s says so: %s', async (reason, warned) => {
    // Failure: a refused write after Take is silent (the player believes the choice is kept),
    // or a dev route with no slot warns about a save it never meant to make.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9322 });
    winAct(rm);
    let first = true;
    const scene = battleScene(rm, {
      _persistBattleRunState: vi.fn(() => {
        if (!first) return { ok: true };
        first = false;
        return { ok: false, reason };
      }),
    });
    const done = new PostCombatController(scene).transitionAfterBattle();
    await vi.waitFor(() => expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy());
    pickCards(doc)[0].click();
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take').click();
    await done;
    const hints = vi.mocked(showMinorHint).mock.calls.map((c) => c[1]);
    expect(hints.includes(EARNED_PICK_SAVE_FAILED)).toBe(warned);
    expect(rm.currentAct).toBe('act2'); // the act advance's save tries again
  });
});

describe('the post-loot fallback never cuts the pick off, nor what follows it', () => {
  function fallbackScene(extra = {}) {
    return {
      _battleSession: 1,
      _earnedPickActive: true,
      _storyLocked: false,
      isStoryInputLocked() {
        return this._storyLocked;
      },
      forceTransitionAfterBattle: vi.fn(),
      // The transition is waiting on the pick: it never settles in these tests.
      transitionAfterBattle: () => new Promise(() => {}),
      ...extra,
    };
  }

  it('holds while the pick is open; once it closes, a story beat keeps its 30 s from the close', async () => {
    // Failure: the 8 s fallback forces the route map under an open pick, or (the pick open past
    // the 30 s grace) fires the moment it closes, cutting the act card and story off.
    vi.useFakeTimers();
    const scene = fallbackScene();
    new LootFlowController(scene)._startPostLootTransition();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scene.forceTransitionAfterBattle).not.toHaveBeenCalled();
    scene._earnedPickActive = false; // Take: the act transition's story begins
    scene._storyLocked = true;
    await vi.advanceTimersByTimeAsync(29_000);
    expect(scene.forceTransitionAfterBattle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(scene.forceTransitionAfterBattle).toHaveBeenCalledTimes(1);
  });

  it('once the pick closes with no story beat, the transition still has its own 8 s', async () => {
    // Failure: the re-check ignores POST_LOOT_TRANSITION_TIMEOUT_MS after a long pick, so the
    // fallback fires within a quarter second of the close (the act advance and its save are
    // still running).
    vi.useFakeTimers();
    const scene = fallbackScene();
    new LootFlowController(scene)._startPostLootTransition();
    await vi.advanceTimersByTimeAsync(20_000);
    scene._earnedPickActive = false;
    await vi.advanceTimersByTimeAsync(7_000);
    expect(scene.forceTransitionAfterBattle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(scene.forceTransitionAfterBattle).toHaveBeenCalledTimes(1);
  });

  it('a pick held 40 s, then Take: the act story plays out and the fallback never fires', async () => {
    // Failure (the review's repro): the grace was counted from the transition's start, so the
    // story that follows a long pick (_storyDialogueActive) is cut off by a forced exit.
    vi.useFakeTimers();
    const { doc } = withDom();
    const rm = freshRun({ seed: 9310 });
    winAct(rm);
    const scene = battleScene(rm, {
      isStoryInputLocked: () => scene._storyDialogueActive === true,
      _showStoryDialogueOnce: vi.fn(() => {
        scene._storyDialogueActive = true;
        return new Promise((resolve) =>
          setTimeout(() => {
            scene._storyDialogueActive = false;
            resolve();
          }, 20_000),
        );
      }),
    });
    const controller = new PostCombatController(scene);
    scene.transitionAfterBattle = () => controller.transitionAfterBattle();
    new LootFlowController(scene)._startPostLootTransition();
    await vi.advanceTimersByTimeAsync(0);
    expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(40_000);
    pickCards(doc)[0].click();
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take').click();
    await vi.advanceTimersByTimeAsync(1_000); // the seal, then the act story begins
    expect(rm.currentAct).toBe('act2');
    expect(scene._storyDialogueActive).toBe(true);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(scene._storyDialogueActive).toBe(true);
    expect(scene.forceTransitionAfterBattle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000); // the story ends; the route map opens
    expect(vi.mocked(transitionToScene).mock.calls.map((c) => c[1])).toEqual(['NodeMap']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(scene.forceTransitionAfterBattle).not.toHaveBeenCalled();
  });

  it('a scene shut down under an open pick, and the next battle, hold nothing', async () => {
    // Failure: the pick's promise never settles on shutdown, so `_earnedPickActive` stays true on
    // the reused scene and the next battle's post-loot fallback never fires.
    withDom();
    const rm = freshRun({ seed: 9311 });
    winAct(rm);
    const scene = battleScene(rm);
    void new PostCombatController(scene).transitionAfterBattle();
    await vi.waitFor(() => expect(scene._earnedPickActive).toBe(true));
    scene._battleSession = 2; // the scene is left (a quit, a crash recovery)
    scene.events.emit('shutdown');
    expect(scene._earnedPickActive).toBe(false);

    const reused = Object.create(BattleScene.prototype);
    reused._earnedPickActive = true;
    BattleScene.prototype.init.call(reused, { gameData: { skills: [] } });
    expect(reused._earnedPickActive).toBe(false);
  });
});

// ── The route map path ───────────────────────────────────────────────────

describe('the route map path', () => {
  it('rewards first, then the pick, then the act advance', async () => {
    // Failure: checkActComplete advances over the pick, or opens it over unclaimed rewards.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9400 });
    winAct(rm);
    const scene = mapScene(rm);
    rm.pendingBattleReward = { nodeId: rm.nodeMap.bossNodeId, choices: [], claimed: [] };
    NodeMapScene.prototype.checkActComplete.call(scene);
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(false);
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    rm.pendingBattleReward = null; // claimed
    NodeMapScene.prototype.checkActComplete.call(scene);
    expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy();
    expect(scene.showActCompleteBanner).not.toHaveBeenCalled();
    expect(rm.currentAct).toBe('act1');
    // A second caller (the finalize chain) finds it open: one menu, never two.
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(true);
    expect(
      dialogs(doc).filter((d) => d.attributes['aria-label'] === 'An earned blessing'),
    ).toHaveLength(1);
    // Leave them (confirmed), and the act completes.
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Skip').click();
    buttonIn(dialogNamed(doc, 'Leave them?'), 'Leave them').click();
    await vi.waitFor(() => expect(rm.currentAct).toBe('act2'));
    expect(scene.showActCompleteBanner).toHaveBeenCalledTimes(1);
    expect(saveServiceRun).toHaveBeenCalled();
    expect(rm.earnedBlessingPicks.act1.status).toBe('skipped');
  });

  it('a pick left owed from an earlier act is shown on the route map, and the map carries on', async () => {
    // Failure: only the current act's pick is ever looked for, so a stale one is never shown.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9401 });
    winAct(rm);
    rm.advanceAct(); // a debug advance over the owed pick (never the game's own paths)
    expect(rm.currentAct).toBe('act2');
    expect(earnedPickOwed(rm)?.actId).toBe('act1');
    const scene = mapScene(rm);
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(true);
    const offered = earnedPickOwed(rm).offered;
    pickCards(doc)[1].click();
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take').click();
    await vi.waitFor(() => expect(scene._earnedPick).toBeNull());
    expect(rm.getActiveBlessingIds()).toContain(offered[1]);
    expect(rm.currentAct).toBe('act2');
    expect(scene.showActCompleteBanner).not.toHaveBeenCalled();
    expect(scene._maybeOpenPendingCaravanShop).toHaveBeenCalled();
  });

  it('a tap on the route map opens an owed pick when nothing holds it', () => {
    // Failure: a pick that failed to open leaves no way back to it but a reload.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9408 });
    winAct(rm);
    const scene = mapScene(rm);
    const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
    NodeMapScene.prototype.onNodeClick.call(scene, boss);
    expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy();
  });

  it('a pick refused because the Roster was open opens when the Roster closes', () => {
    // Failure: an owed pick the map refused once (an overlay in front of it) stays stuck until a
    // reload: nothing tries it again when the overlay closes.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9402 });
    winAct(rm);
    const scene = mapScene(rm);
    NodeMapScene.prototype._openRoster.call(scene);
    expect(scene.rosterOverlay.visible).toBe(true);
    NodeMapScene.prototype.checkActComplete.call(scene); // the finalize chain, under the Roster
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    expect(rm.currentAct).toBe('act1');
    scene.rosterOverlay.hide(); // the player closes the Roster
    expect(scene.rosterOverlay).toBeNull();
    expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy();
    expect(rm.currentAct).toBe('act1');
  });

  it('a pick refused under the pause menu opens when it resumes', () => {
    // Failure: the pause menu's Resume leaves a refused pick stuck.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9403 });
    winAct(rm);
    const scene = mapScene(rm);
    NodeMapScene.prototype.showPauseMenu.call(scene);
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(false);
    scene.pauseOverlay.hide();
    expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy();
  });

  it('closing the Roster with a contract reward owed at the boss opens the contract page, never the pick', () => {
    // Failure: the retry opens the pick straight away, ahead of the boss's owed contract reward
    // (the map's order is contract, pick, advance).
    const { doc } = withDom();
    const rm = freshRun({ seed: 9404 });
    winAct(rm);
    oweBossContract(rm);
    const scene = mapScene(rm);
    scene.handleContractSettlement = vi.fn(() => true);
    NodeMapScene.prototype._openRoster.call(scene);
    scene.rosterOverlay.hide();
    expect(scene.handleContractSettlement).toHaveBeenCalledWith({ auto: true });
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    expect(rm.currentAct).toBe('act1');
  });

  it('a tap with a contract reward owed where the party stands opens that page, not the pick', () => {
    // Failure: _maybeOpenEarnedPick ignores the held contract, so a tap opens the pick first.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9405 });
    winAct(rm);
    const boss = oweBossContract(rm);
    const scene = mapScene(rm);
    scene.handleContractSettlement = vi.fn(() => true);
    NodeMapScene.prototype.onNodeClick.call(scene, boss);
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    expect(scene.handleContractSettlement).toHaveBeenCalledWith({ manual: true });
  });

  it('a take the device refuses to save says so on the route map', async () => {
    // Failure: saveServiceRun's warning is dropped, so a refused write after Take is silent.
    const { doc } = withDom();
    const rm = freshRun({ seed: 9406 });
    winAct(rm);
    vi.mocked(saveServiceRun).mockImplementation(
      () => ' Save failed: device storage may be full or unavailable.',
    );
    const scene = mapScene(rm);
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(true);
    pickCards(doc)[0].click();
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take').click();
    await vi.waitFor(() => expect(scene._earnedPick).toBeNull());
    expect(vi.mocked(showMinorHint)).toHaveBeenCalledWith(
      scene,
      'Save failed: device storage may be full or unavailable.',
    );
  });

  it('a finished run with a stale pick owed settles (RunComplete) and never opens the pick', () => {
    // Failure: checkActComplete (without its `!isRunComplete()` guard) or _maybeOpenEarnedPick
    // opens a pick over the won run, and the run never reaches its settlement.
    const { doc } = withDom();
    const rm = winRunWithStalePick(freshRun({ seed: 9407 }));
    expect(rm.isRunComplete()).toBe(true);
    expect(earnedPickOwed(rm)?.actId).toBe('act1');
    const scene = mapScene(rm);
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(false);
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    NodeMapScene.prototype.checkActComplete.call(scene);
    expect(dialogNamed(doc, 'An earned blessing')).toBeUndefined();
    expect(rm.status).toBe('victory');
    expect(vi.mocked(transitionToScene).mock.calls.map((c) => c[1])).toEqual(['RunComplete']);
  });
});

// ── The menu ─────────────────────────────────────────────────────────────

describe('the pick menu: nothing skips it silently', () => {
  function openPick(seed = 9500) {
    const dom = withDom();
    const rm = freshRun({ seed });
    winAct(rm);
    const scene = { registry: { get: () => null }, events: eventsFor() };
    const onDone = vi.fn();
    const save = vi.fn();
    const pick = new EarnedBlessingPick(scene, { run: rm, save, onDone });
    expect(pick.create()).toBe(true);
    return { ...dom, rm, pick, onDone, save };
  }

  it('Escape opens the confirmation; Back returns with the pick still owed', () => {
    // Failure: a stray Escape (the menu's close) skips the pick.
    const { doc, key, rm, onDone, save } = openPick();
    key('Escape');
    const confirm = dialogNamed(doc, 'Leave them?');
    expect(confirm).toBeTruthy();
    expect(confirm.textContent).toContain('gone for good');
    expect(earnedPickOwed(rm)).toBeTruthy();
    buttonIn(confirm, 'Back').click();
    expect(dialogNamed(doc, 'Leave them?')).toBeUndefined();
    expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy();
    expect(earnedPickOwed(rm)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("a controller's Cancel asks too, and Pause is swallowed", () => {
    // Failure: Cancel or Pause reaches MenuSurface's default (close), skipping the pick, or
    // Pause opens the pause menu over it.
    const { doc, rm, onDone } = openPick(9501);
    dispatchInputAction(InputAction.PAUSE);
    expect(dialogNamed(doc, 'Leave them?')).toBeUndefined();
    expect(dialogNamed(doc, 'An earned blessing')).toBeTruthy();
    dispatchInputAction(InputAction.CANCEL);
    expect(dialogNamed(doc, 'Leave them?')).toBeTruthy();
    expect(earnedPickOwed(rm)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('the confirmation opens on Back: a stray Enter or Confirm keeps the pick', () => {
    // Failure: focus lands on "Leave them" (the confirmation's first content button), so the
    // Enter that opened Skip, or the next one, throws both blessings away.
    const { doc, key, rm, onDone } = openPick(9504);
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Skip').click();
    const confirm = dialogNamed(doc, 'Leave them?');
    expect(doc.activeElement).toBe(buttonIn(confirm, 'Back'));
    key('Enter');
    expect(dialogNamed(doc, 'Leave them?')).toBeUndefined();
    expect(earnedPickOwed(rm)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a refused take leaves the menu whole: Skip, Take and focus come back, and a take still works', async () => {
    // Failure: a refused take leaves the header's Skip disabled, or `busy` set (every card and
    // Take then dead: a menu nothing can leave), or focus on a disabled button.
    const { doc, rm, onDone } = openPick(9505);
    const [first, second] = earnedPickOwed(rm).offered;
    rm.addBlessingMidRun(first, { earned: true }); // already held: the engine refuses it
    pickCards(doc)
      .find((c) => c.dataset.blessing === first)
      .click();
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take').click();
    const menu = dialogNamed(doc, 'An earned blessing');
    expect(menu).toBeTruthy();
    expect(earnedPickOwed(rm)).toBeTruthy();
    expect(buttonIn(menu, 'Skip').disabled).toBe(false);
    expect(buttonIn(menu, 'Take').disabled).toBe(false);
    expect(menu.contains(doc.activeElement)).toBe(true);
    expect(doc.activeElement.disabled).not.toBe(true);
    pickCards(doc)
      .find((c) => c.dataset.blessing === second)
      .click();
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Take').click();
    await vi.waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ outcome: 'taken', blessingId: second }),
    );
    expect(rm.earnedBlessingPicks.act1).toMatchObject({ status: 'taken', chosen: second });
  });

  it('Leave them skips for good, saves, and closes both menus', async () => {
    // Failure: the skip is not saved (a reload offers it again) or the menu is left behind.
    const { doc, rm, onDone, save } = openPick(9502);
    buttonIn(dialogNamed(doc, 'An earned blessing'), 'Skip').click();
    buttonIn(dialogNamed(doc, 'Leave them?'), 'Leave them').click();
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith({ outcome: 'skipped' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(rm.earnedBlessingPicks.act1.status).toBe('skipped');
    expect(dialogs(doc)).toEqual([]);
  });

  it('the footer reads the chosen card: its terms when it names Vision, else its lore', () => {
    // Failure: the footer explains nothing (Vision unexplained) or shows the wrong card's lore.
    const rm = freshRun({ seed: 9503 });
    winAct(rm);
    rm.earnedBlessingPicks.act1.offered = ['second_dawn', 'ember_lantern'];
    const model = earnedPickModel(rm);
    expect(earnedPickFooter(model, null)).toEqual({
      kind: 'prompt',
      text: 'Won from the Act I boss. Take one, or leave them both.',
    });
    const dawn = earnedPickFooter(model, 'second_dawn');
    expect(dawn.kind).toBe('terms');
    expect(dawn.terms.map((t) => t.term)).toEqual(['Vision']);
    const lantern = data.blessings.blessings.find((b) => b.id === 'ember_lantern');
    expect(earnedPickFooter(model, 'ember_lantern')).toEqual({ kind: 'lore', text: lantern.lore });
  });
});

describe('the tarot card the shrine and the pick share', () => {
  it('a tiered card burns its numeral; an earned card a star, and says it was earned', () => {
    // Failure: the extraction changed the shrine's card, or an earned card shows a numeral or a
    // font glyph Cinzel lacks.
    withDom();
    const tiered = blessingTarotCard(
      blessingCardContent({
        ...data.blessings.blessings.find((b) => b.tier === 3),
        rolledCost: { label: '-20% battle gold' },
      }),
      { selected: true },
    );
    expect(tiered.dataset.tier).toBe('3');
    expect(tiered.attributes['aria-pressed']).toBe('true');
    expect(tiered.querySelector('.ch-numeral').textContent).toBe('III');
    expect(tiered.querySelector('.ch-star')).toBeNull();
    expect(tiered.querySelector('.ch-cost').textContent).toBe('Cost-20% battle gold');
    const plate = tiered.querySelector('.ch-plate');
    // The shrine's painting (when the card has one) first, then the face.
    expect(plate.children.map((c) => c.className).filter((c) => c !== 'ia-card-art')).toEqual([
      'ch-sun',
      'ch-tarot-name',
      'ch-lines',
      'ch-cost',
    ]);

    const earned = blessingTarotCard(
      blessingCardContent(data.blessings.blessings.find((b) => b.id === 'unbroken_banner')),
    );
    expect(earned.dataset.tier).toBe('earned');
    expect(earned.attributes['aria-pressed']).toBe('false');
    expect(earned.querySelector('.ch-numeral').textContent).toBe('');
    expect(earned.querySelector('.ch-numeral').querySelector('.ch-star')).toBeTruthy();
    expect(earned.querySelector('.ch-cost').textContent).toBe('EarnedNo cost: won, never bought');
    expect(earned.attributes['aria-label']).toContain('Unbroken Banner · Earned');
  });
});
