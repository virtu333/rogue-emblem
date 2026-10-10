// An eclipsed elite's earned-blessing drop on the route map (docs/specs/blessings-v3.md §6.3,
// decision D-7): rolled with the victory, offered as a one-card pick by the route map host PR C
// built (NodeMapScene._maybeOpenEarnedPick), after the loot screen, an event's spoils and a
// contract reward, before anything else. Real RunManager, real scene methods and menu, the fake
// DOM; only the scene hop, the save and the loot screen are stubs.
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
// The loot screen: records its callbacks, so a test can finish it the way the player would.
vi.mock('../src/ui/PendingRewardController.js', () => ({
  PendingRewardController: class {
    constructor(scene, callbacks) {
      scene._lastRewardCallbacks = callbacks;
    }
  },
}));

import { installFakeDom } from './helpers/fakeDom.js';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { earnedPickOwed } from '../src/engine/EarnedBlessings.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { ContractSettlementController } from '../src/ui/ContractSettlementController.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';

const data = loadGameData();

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  vi.mocked(saveServiceRun).mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function withDom() {
  const dom = installFakeDom(vi);
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return dom;
}
const events = () => ({ once() {}, on() {}, off() {}, emit() {} });

/** A run that won an eclipsed elite whose drop is owed (the data's chance set to 1). */
function eliteWon(seed = 5150) {
  const gameData = structuredClone(data);
  gameData.blessings.earnedOffer.eclipsedEliteChance = 1;
  const rm = new RunManager(gameData);
  rm.startRun({ runSeed: seed, difficultyId: 'normal', applyBlessingsAtStart: false });
  const node = rm.getAvailableNodes().find((n) => n.type === 'battle') || rm.getAvailableNodes()[0];
  node.type = 'battle';
  node.battleParams = { ...(node.battleParams || {}), isEclipsed: true, isElite: true };
  node.eclipse = { fromType: 'battle', fellAtShadow: 5, label: 'Eclipsed battle', seen: true };
  rm.currentNodeId = node.id;
  rm.completeBattle(rm.getRoster(), node.id, 0, { turnCount: 5, turnPar: 7 });
  rm.pendingBattleReward = null;
  return { rm, node };
}

/** A kept contract whose reward (100 gold) is owed at the elite the party just won. */
function keptContractAt(rm, node) {
  return {
    battleNodeId: node.id,
    contractNodeId: 'c1',
    eventId: 'mercenary_contract',
    act: rm.currentAct,
    goal: 'underPar',
    kept: true,
    noPar: false,
    losses: 0,
    effects: [{ type: 'gold', value: 100 }],
    seedKey: 'event-contract:1:c1',
    blocked: null,
    failed: null,
  };
}

function mapScene(rm) {
  const scene = Object.create(NodeMapScene.prototype);
  Object.assign(scene, {
    runManager: rm,
    gameData: rm.gameData,
    registry: { get: () => null },
    events: events(),
    sys: { isActive: () => true },
    isSceneReady: true,
    _sceneLifecycleGeneration: 1,
    _earnedPick: null,
    drawMap: vi.fn(),
    persistRunSave: vi.fn(),
    showActCompleteBanner: vi.fn((onComplete) => onComplete()),
    _maybeOpenPendingCaravanShop: vi.fn(() => false),
    _maybeOpenPendingEventSettlement: vi.fn(() => false),
    _maybeOpenPendingContractSettlement: vi.fn(() => false),
  });
  return scene;
}

const dialogs = (doc) =>
  doc.querySelectorAll('section').filter((s) => s.attributes.role === 'dialog');
const dialogNamed = (doc, name) => dialogs(doc).find((d) => d.attributes['aria-label'] === name);
const buttonIn = (root, text) =>
  root.querySelectorAll('button').find((b) => b.textContent === text);
const PICK = 'An earned blessing';

describe("an eclipsed elite's drop on the route map", () => {
  it('opens as a one-card pick; Take adds it, saves, and the map carries on (no act advance)', async () => {
    // Failure: the drop is never shown (only an act boss's pick opens), shows two card slots, or
    // its take is not saved.
    const { doc } = withDom();
    const { rm, node } = eliteWon();
    const entry = earnedPickOwed(rm);
    expect(entry).toMatchObject({ key: `elite:${node.id}`, status: 'owed' });
    const scene = mapScene(rm);
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(true);
    const pick = dialogNamed(doc, PICK);
    expect(pick).toBeTruthy();
    const cards = pick.querySelectorAll('.ch-card');
    expect(cards).toHaveLength(1);
    expect(pick.textContent).toContain('Won from an eclipsed elite. Take it, or leave it.');
    cards[0].click();
    buttonIn(pick, 'Take').click();
    await vi.waitFor(() => expect(scene._earnedPick).toBeNull());
    expect(rm.getActiveBlessingIds()).toEqual(entry.offered);
    expect(rm.earnedBlessingPicks[`elite:${node.id}`]).toMatchObject({ status: 'taken' });
    expect(saveServiceRun).toHaveBeenCalled();
    expect(rm.currentAct).toBe('act1');
    expect(scene.showActCompleteBanner).not.toHaveBeenCalled();
    expect(scene._maybeOpenPendingCaravanShop).toHaveBeenCalled();
  });

  it('Skip asks "Leave it?" and leaving it skips for good', async () => {
    // Failure: a one-card drop asks to "Leave them" (both), or a stray Skip loses it silently.
    const { doc } = withDom();
    const { rm, node } = eliteWon(5151);
    const scene = mapScene(rm);
    NodeMapScene.prototype._maybeOpenEarnedPick.call(scene);
    buttonIn(dialogNamed(doc, PICK), 'Skip').click();
    const confirm = dialogNamed(doc, 'Leave it?');
    expect(confirm).toBeTruthy();
    buttonIn(confirm, 'Leave it').click();
    await vi.waitFor(() => expect(scene._earnedPick).toBeNull());
    expect(rm.earnedBlessingPicks[`elite:${node.id}`].status).toBe('skipped');
    expect(rm.getActiveBlessingIds()).toEqual([]);
    expect(earnedPickOwed(rm)).toBeNull();
  });

  it('a node tap opens the owed drop instead of travelling on', () => {
    // Failure: travel continues over an owed drop (it is lost, or opens over the next battle).
    const { doc } = withDom();
    const { rm } = eliteWon(5152);
    const scene = mapScene(rm);
    const next = rm.getAvailableNodes()[0];
    const before = rm.currentNodeId;
    NodeMapScene.prototype.onNodeClick.call(scene, next);
    expect(dialogNamed(doc, PICK)).toBeTruthy();
    expect(rm.currentNodeId).toBe(before);
  });

  it('after the loot screen, an event page and a contract reward come first; then the drop', () => {
    // Failure: the drop opens over the loot screen, or is never opened once the rewards close
    // (the map only checked an act boss's pick).
    const { doc } = withDom();
    const { rm, node } = eliteWon(5153);
    const scene = mapScene(rm);
    rm.pendingBattleReward = { nodeId: node.id, choices: [], claimed: [] };
    NodeMapScene.prototype.openPendingRewards.call(scene);
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(false);
    expect(dialogNamed(doc, PICK)).toBeUndefined();
    rm.pendingBattleReward = null;
    // A kept contract's reward is owed where the party stands: its page opens first.
    rm.contractOwed = keptContractAt(rm, node);
    scene._maybeOpenPendingContractSettlement.mockReturnValueOnce(true);
    scene._lastRewardCallbacks.onComplete();
    expect(dialogNamed(doc, PICK)).toBeUndefined(); // the contract's page first
    rm.contractOwed = null;
    scene._lastRewardCallbacks.onComplete();
    expect(dialogNamed(doc, PICK)).toBeTruthy();
  });

  it("an event's own page comes first too: the drop waits for the spoils it owes", () => {
    // Failure: the drop opens over (or before) an event's spoils page, a second modal surface.
    withDom();
    const { rm } = eliteWon(5156);
    const scene = mapScene(rm);
    const eventNode = rm.nodeMap.nodes.find((n) => n.id !== rm.currentNodeId && !n.completed);
    eventNode.type = 'event';
    eventNode.completed = true;
    rm.eventStateByNodeId = {
      [eventNode.id]: { eventId: 'cartographer', battle: 'pending', results: [], afterVictory: [] },
    };
    rm.pendingEventNodeId = eventNode.id;
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(false);
    rm.pendingEventNodeId = null;
    rm.eventStateByNodeId = {};
    eventNode.completed = false;
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(true);
  });

  it("a contract's Continue (ContractSettlementController.finish) opens the owed drop", () => {
    // Failure: Continue only redraws the map (checkActComplete's last branch), so the drop owed
    // behind the contract's page waits for a reload or a node tap.
    const { doc } = withDom();
    const { rm, node } = eliteWon(5155);
    rm.contractOwed = keptContractAt(rm, node);
    const scene = mapScene(rm);
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(false);
    const contract = new ContractSettlementController(scene);
    const gold = rm.gold;
    expect(contract.claim()).toEqual({ ok: true });
    expect(rm.gold).toBe(gold + 100);
    expect(dialogNamed(doc, PICK)).toBeUndefined();
    contract.finish();
    expect(dialogNamed(doc, PICK)).toBeTruthy();
    expect(scene._earnedPick).toBeTruthy();
    // The caravan waits for the pick (the pick's own close opens it).
    expect(scene._maybeOpenPendingCaravanShop).not.toHaveBeenCalled();
  });

  it('with nothing owed, a page closing on the map still opens the caravan', () => {
    // Failure: the new branch swallows the caravan when there is no pick.
    withDom();
    const { rm, node } = eliteWon(5157);
    rm.earnedBlessingPicks[`elite:${node.id}`].status = 'skipped';
    const scene = mapScene(rm);
    NodeMapScene.prototype.checkActComplete.call(scene);
    expect(scene._earnedPick).toBeNull();
    expect(scene._maybeOpenPendingCaravanShop).toHaveBeenCalledTimes(1);
  });

  it('never opens while the Colosseum stands in front of it', () => {
    // Failure: the pick opens over the arena's menu (two modal surfaces).
    withDom();
    const { rm } = eliteWon(5154);
    const scene = mapScene(rm);
    scene.colosseumOverlay = { visible: true };
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(false);
    scene.colosseumOverlay = { visible: false };
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(true);
  });

  it("never opens while the Colosseum's menu is still loading", () => {
    // Failure: the pick opens in the gap between the arena tap and its menu (the overlay is not
    // built yet), and the arena's menu then opens over it.
    withDom();
    const { rm } = eliteWon(5158);
    const scene = mapScene(rm);
    scene._colosseumLoading = true;
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(false);
    expect(scene._earnedPick).toBeNull();
    scene._colosseumLoading = false;
    expect(NodeMapScene.prototype._maybeOpenEarnedPick.call(scene)).toBe(true);
  });
});
