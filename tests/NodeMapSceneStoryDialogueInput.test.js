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
});

