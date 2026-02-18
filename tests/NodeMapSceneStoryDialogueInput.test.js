import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: {
      Clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    },
  },
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

describe('NodeMap story-dialogue node click queue', () => {
  it('queues node click intent while story dialogue is active', () => {
    const hide = vi.fn();
    const scene = {
      isTransitioning: false,
      battleLaunchInFlight: false,
      isSceneReady: false,
      _storyDialogueActive: true,
      dialogueOverlay: { visible: true, hide },
      _pendingNodeSelection: null,
    };
    const node = { id: 'n1', type: 'battle' };

    NodeMapScene.prototype.onNodeClick.call(scene, node);

    expect(scene._pendingNodeSelection).toEqual({ nodeId: 'n1' });
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('does not queue when scene is not ready but story dialogue is inactive', () => {
    const scene = {
      isTransitioning: false,
      battleLaunchInFlight: false,
      isSceneReady: false,
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false, hide: vi.fn() },
      _pendingNodeSelection: null,
    };

    NodeMapScene.prototype.onNodeClick.call(scene, { id: 'n1', type: 'battle' });

    expect(scene._pendingNodeSelection).toBeNull();
  });

  it('replays queued node click after scene becomes ready', () => {
    const node = { id: 'n1', type: 'battle' };
    const onNodeClick = vi.fn();
    const scene = {
      _pendingNodeSelection: { nodeId: 'n1' },
      isSceneReady: true,
      isTransitioning: false,
      battleLaunchInFlight: false,
      runManager: {
        nodeMap: { nodes: [node] },
        getAvailableNodes: () => [node],
      },
      onNodeClick,
    };

    const handled = NodeMapScene.prototype._consumePendingNodeSelection.call(scene);

    expect(handled).toBe(true);
    expect(scene._pendingNodeSelection).toBeNull();
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(node);
  });

  it('drops queued node click when node is no longer available', () => {
    const node = { id: 'n1', type: 'battle' };
    const onNodeClick = vi.fn();
    const scene = {
      _pendingNodeSelection: { nodeId: 'n1' },
      isSceneReady: true,
      isTransitioning: false,
      battleLaunchInFlight: false,
      runManager: {
        nodeMap: { nodes: [node] },
        getAvailableNodes: () => [],
      },
      onNodeClick,
    };

    const handled = NodeMapScene.prototype._consumePendingNodeSelection.call(scene);

    expect(handled).toBe(false);
    expect(scene._pendingNodeSelection).toBeNull();
    expect(onNodeClick).not.toHaveBeenCalled();
  });

  it('finalizeSceneReady consumes queued click after dialogue/hints complete', async () => {
    const node = { id: 'n1', type: 'battle' };
    const onNodeClick = vi.fn();
    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => true },
      input: { enabled: false },
      runManager: {
        hasShownDialogue: vi.fn(() => false),
        markDialogueShown: vi.fn(() => {}),
        getAvailableNodes: () => [node],
        nodeMap: { nodes: [node] },
      },
      gameData: { dialogue: { actTransitions: { runStart: [{ speaker: 'Sera', line: 'Start' }] } } },
      dialogueOverlay: { showSequence: vi.fn(async () => {}), visible: false },
      persistRunSave: vi.fn(() => {}),
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _storyDialogueActive: false,
      isSceneReady: false,
      _pendingNodeSelection: { nodeId: 'n1' },
      _consumePendingNodeSelection: NodeMapScene.prototype._consumePendingNodeSelection,
      onNodeClick,
    };

    await NodeMapScene.prototype.finalizeSceneReady.call(scene);

    expect(scene.input.enabled).toBe(true);
    expect(scene.isSceneReady).toBe(true);
    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(node);
  });

  it('finalizeSceneReady recovers input/readiness when scene becomes inactive', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => false },
      input: { enabled: false },
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _consumePendingNodeSelection: vi.fn(() => false),
      isSceneReady: false,
    };

    await NodeMapScene.prototype.finalizeSceneReady.call(scene);

    expect(scene.input.enabled).toBe(true);
    expect(scene._showPendingNodeMapHints).not.toHaveBeenCalled();
    expect(scene.isSceneReady).toBe(true);
    expect(scene._consumePendingNodeSelection).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      '[NodeMapScene] Scene inactive during finalizeSceneReady - skipping dialogue/hints'
    );
    warnSpy.mockRestore();
  });

  it('finalizeSceneReady still enables readiness when optional flow throws', async () => {
    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => true },
      input: { enabled: false },
      runManager: {
        hasShownDialogue: vi.fn(() => true),
      },
      _showPendingNodeMapHints: vi.fn(async () => {
        throw new Error('hint failure');
      }),
      _consumePendingNodeSelection: vi.fn(() => false),
      isSceneReady: false,
    };

    await expect(NodeMapScene.prototype.finalizeSceneReady.call(scene)).resolves.toBeUndefined();

    expect(scene.input.enabled).toBe(true);
    expect(scene.isSceneReady).toBe(true);
    expect(scene._consumePendingNodeSelection).toHaveBeenCalledTimes(1);
  });

  it('finalizeSceneReady replays queued click before pending ambush auto-open', async () => {
    const queuedNode = { id: 'n1', type: 'battle' };
    const pendingShopNode = { id: 'shop1', type: 'shop' };
    const onNodeClick = vi.fn();
    const handleShop = vi.fn();

    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => true },
      input: { enabled: false },
      runManager: {
        hasShownDialogue: vi.fn(() => true),
        getAvailableNodes: () => [queuedNode, pendingShopNode],
        nodeMap: { nodes: [queuedNode, pendingShopNode] },
        getAmbushPendingNode: vi.fn(() => pendingShopNode),
      },
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      isSceneReady: false,
      isTransitioning: false,
      battleLaunchInFlight: false,
      shopOverlay: null,
      churchOverlay: null,
      rosterOverlay: null,
      pauseOverlay: null,
      settingsOverlay: null,
      _pendingNodeSelection: { nodeId: queuedNode.id },
      _consumePendingNodeSelection: NodeMapScene.prototype._consumePendingNodeSelection,
      _maybeOpenPendingAmbushShop: NodeMapScene.prototype._maybeOpenPendingAmbushShop,
      onNodeClick,
      handleShop,
    };

    await NodeMapScene.prototype.finalizeSceneReady.call(scene);

    expect(onNodeClick).toHaveBeenCalledTimes(1);
    expect(onNodeClick).toHaveBeenCalledWith(queuedNode);
    expect(handleShop).not.toHaveBeenCalled();
  });

  it('finalizeSceneReady auto-opens pending ambush shop when scene is idle', async () => {
    const pendingShopNode = { id: 'shop1', type: 'shop' };
    const nextNode = { id: 'n2', type: 'battle' };
    const handleShop = vi.fn();

    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => true },
      input: { enabled: false },
      runManager: {
        hasShownDialogue: vi.fn(() => true),
        currentNodeId: pendingShopNode.id,
        getAvailableNodes: () => [nextNode],
        nodeMap: { nodes: [pendingShopNode, nextNode] },
        getAmbushPendingNode: vi.fn(() => pendingShopNode),
      },
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      isSceneReady: false,
      isTransitioning: false,
      battleLaunchInFlight: false,
      shopOverlay: null,
      churchOverlay: null,
      rosterOverlay: null,
      pauseOverlay: null,
      settingsOverlay: null,
      _pendingNodeSelection: null,
      _consumePendingNodeSelection: vi.fn(() => false),
      _maybeOpenPendingAmbushShop: NodeMapScene.prototype._maybeOpenPendingAmbushShop,
      handleShop,
    };

    await NodeMapScene.prototype.finalizeSceneReady.call(scene);

    expect(handleShop).toHaveBeenCalledTimes(1);
    expect(handleShop).toHaveBeenCalledWith(pendingShopNode, { ambushDiscount: true, pendingAmbush: true });
  });

  it('finalizeSceneReady auto-opens pending ambush shop from real completeBattle producer state', async () => {
    const rm = new RunManager(loadGameData());
    rm.startRun();
    rm.hasShownDialogue = vi.fn(() => true);

    const ambushShopNode = rm.nodeMap.nodes.find((node) => node.id === rm.nodeMap.startNodeId);
    ambushShopNode.type = 'shop';
    ambushShopNode.isAmbush = true;
    ambushShopNode.ambushCleared = false;

    const applied = rm.completeBattle(rm.getRoster(), ambushShopNode.id, 0);
    expect(applied).toBe(true);
    expect(rm.getAmbushPendingNode()?.id).toBe(ambushShopNode.id);
    expect(rm.currentNodeId).toBe(ambushShopNode.id);

    const handleShop = vi.fn();
    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => true },
      input: { enabled: false },
      runManager: rm,
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      isSceneReady: false,
      isTransitioning: false,
      battleLaunchInFlight: false,
      shopOverlay: null,
      churchOverlay: null,
      rosterOverlay: null,
      pauseOverlay: null,
      settingsOverlay: null,
      _pendingNodeSelection: null,
      _consumePendingNodeSelection: vi.fn(() => false),
      _maybeOpenPendingAmbushShop: NodeMapScene.prototype._maybeOpenPendingAmbushShop,
      handleShop,
    };

    await NodeMapScene.prototype.finalizeSceneReady.call(scene);

    expect(handleShop).toHaveBeenCalledTimes(1);
    expect(handleShop).toHaveBeenCalledWith(ambushShopNode, { ambushDiscount: true, pendingAmbush: true });
  });

  it('finalizeSceneReady does not auto-open stale pending ambush when current node differs', async () => {
    const pendingShopNode = { id: 'shop1', type: 'shop' };
    const handleShop = vi.fn();

    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => true },
      input: { enabled: false },
      runManager: {
        hasShownDialogue: vi.fn(() => true),
        currentNodeId: 'other-node',
        getAvailableNodes: () => [],
        nodeMap: { nodes: [pendingShopNode] },
        getAmbushPendingNode: vi.fn(() => pendingShopNode),
      },
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      isSceneReady: false,
      isTransitioning: false,
      battleLaunchInFlight: false,
      shopOverlay: null,
      churchOverlay: null,
      rosterOverlay: null,
      pauseOverlay: null,
      settingsOverlay: null,
      _pendingNodeSelection: null,
      _consumePendingNodeSelection: vi.fn(() => false),
      _maybeOpenPendingAmbushShop: NodeMapScene.prototype._maybeOpenPendingAmbushShop,
      handleShop,
    };

    await NodeMapScene.prototype.finalizeSceneReady.call(scene);

    expect(handleShop).not.toHaveBeenCalled();
  });

  it('finalizeSceneReady tolerates runManager stubs without ambush helpers', async () => {
    const handleShop = vi.fn();
    const scene = {
      ensureAudioUnlocked: vi.fn(async () => {}),
      sys: { isActive: () => true },
      input: { enabled: false },
      runManager: {
        hasShownDialogue: vi.fn(() => true),
      },
      _showPendingNodeMapHints: vi.fn(async () => {}),
      _storyDialogueActive: false,
      dialogueOverlay: { visible: false },
      isSceneReady: false,
      isTransitioning: false,
      battleLaunchInFlight: false,
      shopOverlay: null,
      churchOverlay: null,
      rosterOverlay: null,
      pauseOverlay: null,
      settingsOverlay: null,
      _pendingNodeSelection: null,
      _consumePendingNodeSelection: vi.fn(() => false),
      _maybeOpenPendingAmbushShop: NodeMapScene.prototype._maybeOpenPendingAmbushShop,
      handleShop,
    };

    await expect(NodeMapScene.prototype.finalizeSceneReady.call(scene)).resolves.toBeUndefined();
    expect(handleShop).not.toHaveBeenCalled();
  });
});
