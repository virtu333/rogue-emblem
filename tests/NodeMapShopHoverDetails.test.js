import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
    BlendModes: { ADD: 1 },
  },
}));

import { NodeMapScene } from '../src/scenes/NodeMapScene.js';

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setInteractive(opts) {
      this._interactive = opts;
      return this;
    },
    setOrigin() {
      return this;
    },
    setColor(color) {
      this._color = color;
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy() {
      this._destroyed = true;
    },
  };
}

describe('Shop item detail formatting', () => {
  it('formats detail text for accessory and weapon shop entries', () => {
    const accessoryText = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'accessory',
        item: { name: 'Power Ring', type: 'Accessory', effects: { STR: 2 } },
      },
    );
    expect(accessoryText).toContain('+2 STR');

    const conditionalAccessoryText = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'accessory',
        item: {
          name: 'Vanguard Crest',
          type: 'Accessory',
          combatEffects: { atkBonus: 4, condition: 'no_ally_within_2' },
        },
      },
    );
    expect(conditionalAccessoryText).toBe('+4 Atk when no ally is within 2 tiles');

    const weaponText = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'weapon',
        item: {
          name: 'Venin Blade',
          might: 8,
          hit: 90,
          crit: 0,
          weight: 3,
          range: '1',
          special: 'Poison',
        },
      },
    );
    expect(weaponText).toContain('Mt: 8');
    expect(weaponText).toContain('Wt: 3');
    expect(weaponText).toContain('Special: Poison');
  });
  it('includes weapon art lines in weapon detail text', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {
        gameData: {
          weaponArts: {
            arts: [
              {
                id: 'bow_curved_shot',
                name: 'Curved Shot',
                combatMods: { rangeBonus: 1, hitBonus: 15 },
              },
            ],
          },
        },
      },
      {
        type: 'weapon',
        item: {
          name: 'Iron Bow',
          type: 'Bow',
          might: 6,
          hit: 85,
          crit: 0,
          weight: 5,
          range: '2',
          weaponArtId: 'bow_curved_shot',
        },
      },
    );
    expect(text).toContain('Art: Curved Shot - Hit +15, Range +1');
  });
  it('formats detail text for scroll entries with skill descriptions', () => {
    const skills = [
      {
        id: 'adept',
        description: 'SPD% chance for an extra follow-up strike at full damage (once per combat)',
      },
    ];
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      { gameData: { skills } },
      {
        type: 'scroll',
        item: { name: 'Adept Scroll', type: 'Scroll', skillId: 'adept', special: 'Teaches Adept' },
      },
    );
    expect(text).toContain('Teaches Adept');
    expect(text).toContain('SPD% chance');
    expect(text.split('\n')).toHaveLength(2);
  });
  it('formats detail text for cure consumable (Herb)', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'consumable',
        item: { name: 'Herb', type: 'Consumable', effect: 'cure', uses: 2 },
      },
    );
    expect(text).toBe('Cure all status conditions (2 uses)');
  });
  it('formats detail text for cureHeal consumable (Remedy)', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'consumable',
        item: { name: 'Remedy', type: 'Consumable', effect: 'cureHeal', value: 15, uses: 1 },
      },
    );
    expect(text).toBe('Cure conditions & restore 15 HP (1 use)');
  });
  it('includes weapon type in detail text', () => {
    const text = NodeMapScene.prototype._getShopItemDetailText.call(
      {},
      {
        type: 'weapon',
        item: {
          name: 'Iron Sword',
          type: 'Sword',
          might: 5,
          hit: 90,
          crit: 0,
          weight: 5,
          range: '1',
        },
      },
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('Sword');
    expect(lines[1]).toContain('Mt: 5');
  });
});

describe('onPointerUp drag-disarm', () => {
  it('clears both two-tap latches when touch drag exceeds threshold', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: { x: 100, y: 100 },
      _tapMoveThreshold: 12,
      _touchPreviewedNodeId: 'n1',
      _touchPreviewedShopEntry: { type: 'weapon', item: { name: 'Iron Sword' } },
      _churchMapViewSuppressCancel: false,
      _isPointerOverInteractive: vi.fn(() => false),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
    };

    // Pointer moved 20px — exceeds threshold
    const pointer = { wasTouch: true, button: 0, x: 100, y: 120 };
    NodeMapScene.prototype.onPointerUp.call(scene, pointer);

    expect(scene._touchTapDown).toBeNull();
    expect(scene._touchPreviewedNodeId).toBeNull();
    expect(scene._touchPreviewedShopEntry).toBeNull();
    // Should have returned early — requestCancel not called
    expect(scene.requestCancel).not.toHaveBeenCalled();
  });
});

describe('node touch two-tap navigation', () => {
  const touchPointer = () => ({ button: 0, wasTouch: true, x: 100, y: 100 });

  let realDateNow;
  let mockNow;

  beforeEach(() => {
    realDateNow = Date.now;
    mockNow = 1000;
    Date.now = () => mockNow;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  function bindNode(scene, node, pos, isAvailable) {
    const nodeObj = makeDisplayObject();
    NodeMapScene.prototype._bindNodeTouchHandlers.call(scene, nodeObj, node, pos, isAvailable);
    return nodeObj;
  }

  it('first tap shows tooltip, second tap within 3s navigates', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const pos = { x: 100, y: 200 };
    const nodeObj = bindNode(scene, node, pos, true);

    // First tap → preview
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.showNodeTooltip).toHaveBeenCalledWith(node, pos);
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Second tap within 3s → navigate
    mockNow = 2500;
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).toHaveBeenCalledWith(node);
    expect(scene._touchPreviewedNodeId).toBeNull();
  });

  it('second tap after 3s re-previews instead of navigating', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const nodeObj = bindNode(scene, node, { x: 100, y: 200 }, true);

    nodeObj.handlers.pointerdown(touchPointer());
    mockNow = 4500;
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n1');
  });

  it('tapping locked node disarms navigation latch', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const nodeA = { id: 'n1', type: 'battle' };
    const lockedNode = { id: 'n2', type: 'battle' };
    const nodeObjA = bindNode(scene, nodeA, { x: 100, y: 200 }, true);
    const nodeObjLocked = bindNode(scene, lockedNode, { x: 200, y: 200 }, false);

    // First tap on available A → preview latched
    nodeObjA.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Tap locked node → latch cleared
    nodeObjLocked.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBeNull();

    // Tap A again → should NOT navigate (re-previews instead)
    mockNow = 2000;
    nodeObjA.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n1');
  });

  it('tapping a different available node resets latch to new node', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const nodeA = { id: 'n1', type: 'battle' };
    const nodeB = { id: 'n2', type: 'shop' };
    const nodeObjA = bindNode(scene, nodeA, { x: 100, y: 200 }, true);
    const nodeObjB = bindNode(scene, nodeB, { x: 200, y: 200 }, true);

    // Tap A → latched to n1
    nodeObjA.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Tap B → latched to n2 (not navigate A)
    mockNow = 2000;
    nodeObjB.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n2');
  });

  it('tapping interactive UI between node taps disarms latch', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      _touchDownLatchKind: null,
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: { x: 100, y: 100 },
      _tapMoveThreshold: 12,
      _touchPreviewedShopEntry: null,
      _churchMapViewSuppressCancel: false,
      _isPointerOverInteractive: vi.fn(() => true),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const pos = { x: 100, y: 200 };
    const nodeObj = bindNode(scene, node, pos, true);

    // First tap on node → game-object pointerdown sets kind + arms latch
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');
    expect(scene._touchDownLatchKind).toBe('node');

    // Scene onPointerDown (kind='node') → preserves node latch
    const ptr1 = { wasTouch: true, button: 0, x: 100, y: 100 };
    NodeMapScene.prototype.onPointerDown.call(scene, ptr1);
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // onPointerUp over interactive → returns early, latch preserved
    NodeMapScene.prototype.onPointerUp.call(scene, ptr1);
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Now simulate gear-icon tap (no game-object sets kind → kind=null)
    // Scene onPointerDown (kind=null) → clears both latches
    const gearPtr = { wasTouch: true, button: 0, x: 200, y: 200 };
    NodeMapScene.prototype.onPointerDown.call(scene, gearPtr);
    expect(scene._touchPreviewedNodeId).toBeNull();

    // onPointerUp over interactive → early return
    NodeMapScene.prototype.onPointerUp.call(scene, gearPtr);
    expect(scene.requestCancel).not.toHaveBeenCalled();

    // Second tap on same node within 3s → should NOT navigate (re-previews)
    mockNow = 2500;
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).not.toHaveBeenCalled();
    expect(scene._touchPreviewedNodeId).toBe('n1');
  });

  it('mouse click navigates immediately without showing tooltip', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const pos = { x: 100, y: 200 };
    const nodeObj = bindNode(scene, node, pos, true);

    // Mouse click (no wasTouch) → immediate navigate
    nodeObj.handlers.pointerdown({ button: 0 });
    expect(scene.onNodeClick).toHaveBeenCalledWith(node);
    expect(scene.showNodeTooltip).not.toHaveBeenCalled();
  });

  it('pointerover shows tooltip and pointerout hides it', () => {
    const scene = {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
    };
    const node = { id: 'n1', type: 'battle' };
    const pos = { x: 100, y: 200 };
    const nodeObj = bindNode(scene, node, pos, true);

    nodeObj.handlers.pointerover();
    expect(scene.showNodeTooltip).toHaveBeenCalledWith(node, pos);

    nodeObj.handlers.pointerout();
    expect(scene.hideNodeTooltip).toHaveBeenCalledTimes(1);
  });
});

describe('two-tap latch lifecycle with full pointerdown-pointerup cycle', () => {
  const touchPointer = (x = 100, y = 100) => ({ button: 0, wasTouch: true, x, y });

  let realDateNow;
  let mockNow;

  beforeEach(() => {
    realDateNow = Date.now;
    mockNow = 1000;
    Date.now = () => mockNow;
  });

  afterEach(() => {
    Date.now = realDateNow;
  });

  function bindNode(scene, node, pos, isAvailable) {
    const nodeObj = makeDisplayObject();
    NodeMapScene.prototype._bindNodeTouchHandlers.call(scene, nodeObj, node, pos, isAvailable);
    return nodeObj;
  }

  function makeLifecycleScene(overrides = {}) {
    return {
      _touchPreviewedNodeId: null,
      _touchPreviewedAt: null,
      _touchPreviewedShopEntry: null,
      _touchPreviewedShopAt: null,
      _touchDownLatchKind: null,
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: { x: 100, y: 100 },
      _tapMoveThreshold: 12,
      _churchMapViewSuppressCancel: false,
      _isPointerOverInteractive: vi.fn(() => true),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
      onNodeClick: vi.fn(),
      showNodeTooltip: vi.fn(),
      hideNodeTooltip: vi.fn(),
      ...overrides,
    };
  }

  it('node two-tap with full pointerdown-pointerup cycle navigates', () => {
    const scene = makeLifecycleScene();
    const node = { id: 'n1', type: 'battle' };
    const nodeObj = bindNode(scene, node, { x: 100, y: 200 }, true);

    // Tap 1: game-object pointerdown → arms latch + sets kind
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');
    expect(scene._touchDownLatchKind).toBe('node');

    // Scene onPointerDown (kind='node') → preserves node latch
    NodeMapScene.prototype.onPointerDown.call(scene, touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // onPointerUp over interactive → early return, latch preserved
    NodeMapScene.prototype.onPointerUp.call(scene, touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Tap 2: game-object pointerdown → latch matches → navigate
    mockNow = 2000;
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene.onNodeClick).toHaveBeenCalledWith(node);
  });

  it('cross-type tap clears mismatched latch', () => {
    const scene = makeLifecycleScene();
    const node = { id: 'n1', type: 'battle' };
    const nodeObj = bindNode(scene, node, { x: 100, y: 200 }, true);

    // Arm node latch
    nodeObj.handlers.pointerdown(touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Scene onPointerDown (kind='node') → preserves
    NodeMapScene.prototype.onPointerDown.call(scene, touchPointer());
    expect(scene._touchPreviewedNodeId).toBe('n1');

    // Now simulate shop item tap (kind='shop')
    scene._touchDownLatchKind = 'shop';
    NodeMapScene.prototype.onPointerDown.call(scene, touchPointer());

    // Node latch cleared because kind was 'shop', not 'node'
    expect(scene._touchPreviewedNodeId).toBeNull();
  });
});

describe('drawMap node handler delegation', () => {
  it('calls _bindNodeTouchHandlers for available and locked nodes', () => {
    const availableNode = {
      id: 'n0',
      row: 0,
      col: 2,
      type: 'battle',
      completed: false,
      edges: ['n1'],
    };
    const lockedNode = {
      id: 'n1',
      row: 1,
      col: 2,
      type: 'battle',
      completed: false,
      edges: ['n0'],
    };

    const chainable = () => {
      const obj = makeDisplayObject();
      obj.setDisplaySize = function () {
        return this;
      };
      obj.setTint = function () {
        return this;
      };
      obj.setAlpha = function () {
        return this;
      };
      obj.setBlendMode = function () {
        return this;
      };
      return obj;
    };

    const scene = {
      children: { removeAll: vi.fn() },
      cameras: { main: { centerX: 320, width: 640 } },
      textures: { exists: vi.fn(() => false) },
      tweens: { add: vi.fn() },
      registry: { get: vi.fn(() => null) },
      add: {
        text: () => chainable(),
        graphics: () => ({
          lineStyle: vi.fn(),
          lineBetween: vi.fn(),
        }),
        rectangle: () => chainable(),
        circle: () => chainable(),
        image: () => chainable(),
      },
      runManager: {
        nodeMap: {
          actId: 'act1',
          startNodeId: 'n0',
          nodes: [availableNode, lockedNode],
        },
        currentAct: 'act1',
        actIndex: 0,
        currentNodeId: null,
        gold: 500,
        difficultyModifiers: null,
        noMetaMode: false,
        winStreak: 0,
        getAvailableNodes: () => [availableNode],
      },
      _bindNodeTouchHandlers: vi.fn(),
      drawRoster: vi.fn(),
    };

    NodeMapScene.prototype.drawMap.call(scene);

    expect(scene._bindNodeTouchHandlers).toHaveBeenCalledTimes(2);
    // Available node: isAvailable = true
    expect(scene._bindNodeTouchHandlers).toHaveBeenCalledWith(
      expect.any(Object),
      availableNode,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      true,
    );
    // Locked node: isAvailable = false
    expect(scene._bindNodeTouchHandlers).toHaveBeenCalledWith(
      expect.any(Object),
      lockedNode,
      expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
      false,
    );
  });
});

describe('pointerupoutside lifecycle', () => {
  it('resets touch state without calling requestCancel', () => {
    const scene = {
      _touchScrollDrag: { type: 'church', startY: 100, startOffset: 0 },
      _touchTapDown: { x: 50, y: 50 },
      _touchDownLatchKind: 'node',
      _churchMapViewSuppressCancel: true,
      _touchPreviewedNodeId: 'n3',
      _touchPreviewedShopEntry: { type: 'weapon', item: { name: 'Iron Sword' } },
      requestCancel: vi.fn(),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
    };

    NodeMapScene.prototype.onPointerUpOutside.call(scene, { button: 0, x: -10, y: -10 });

    expect(scene._touchScrollDrag).toBeNull();
    expect(scene._touchTapDown).toBeNull();
    expect(scene._touchDownLatchKind).toBeNull();
    expect(scene._churchMapViewSuppressCancel).toBe(false);
    expect(scene._touchPreviewedNodeId).toBeNull();
    expect(scene._touchPreviewedShopEntry).toBeNull();
    expect(scene.requestCancel).not.toHaveBeenCalled();
  });

  it('blank-map tap clears latches and calls requestCancel', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: null,
      _tapMoveThreshold: 12,
      _touchDownLatchKind: null,
      _churchMapViewSuppressCancel: false,
      _touchPreviewedNodeId: 'n2',
      _touchPreviewedShopEntry: { type: 'weapon', item: { name: 'Steel Axe' } },
      _isPointerOverInteractive: vi.fn(() => false),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
    };

    NodeMapScene.prototype.onPointerUp.call(scene, { button: 0, x: 200, y: 200 });

    expect(scene._touchPreviewedNodeId).toBeNull();
    expect(scene._touchPreviewedShopEntry).toBeNull();
    expect(scene.requestCancel).toHaveBeenCalledWith({ allowPause: false });
  });

  it('_touchDownLatchKind is cleared in onPointerUp as safety net', () => {
    const scene = {
      _storyDialogueActive: false,
      dialogueOverlay: null,
      _touchScrollDrag: null,
      _touchTapDown: null,
      _tapMoveThreshold: 12,
      _touchDownLatchKind: 'node',
      _churchMapViewSuppressCancel: false,
      _isPointerOverInteractive: vi.fn(() => true),
      _clearTouchPreviewLatches: NodeMapScene.prototype._clearTouchPreviewLatches,
      requestCancel: vi.fn(),
    };

    NodeMapScene.prototype.onPointerUp.call(scene, { button: 0, x: 100, y: 100 });

    expect(scene._touchDownLatchKind).toBeNull();
  });

  it('_touchDownLatchKind is cleared on story-dialogue early return', () => {
    const scene = {
      _storyDialogueActive: true,
      dialogueOverlay: null,
      _touchDownLatchKind: 'shop',
      requestCancel: vi.fn(),
    };

    NodeMapScene.prototype.onPointerUp.call(scene, { button: 0, x: 100, y: 100 });

    expect(scene._touchDownLatchKind).toBeNull();
    expect(scene.requestCancel).not.toHaveBeenCalled();
  });
});

// Exercises the gamepad focus-entry generation INSIDE the real draw fns (the
// regression-prone half the synthetic ShopControllerGamepad tests inject around):
// which rows are registered as focusable, that off-screen rows still register, and
// that only rendered rows carry the _shopFocusKey tag the ring resolves against.
describe('node gesture ownership', () => {
  const touch = () => ({ wasTouch: true, button: 0, x: 100, y: 100 });
  function boundScene() {
    const scene = Object.create(NodeMapScene.prototype);
    scene.input = { on: vi.fn(), off: vi.fn(), hitTestPointer: () => [] };
    scene._tapMoveThreshold = 12;
    scene.requestCancel = vi.fn();
    scene._bindInputHandlers();
    return scene;
  }

  it('consumes release owned by a control that destroyed itself on press', () => {
    const scene = boundScene();
    const pointer = touch();
    // Phaser preserves the original hit list even after the object callback destroys it.
    scene._onPointerDown(pointer, [{ active: false, visible: false }]);
    scene._onPointerUp(pointer);
    expect(scene.requestCancel).not.toHaveBeenCalled();
    expect(scene._pointerGesture).toBeNull();
    const outside = touch();
    scene._onPointerDown(outside, []);
    scene._onPointerUp(outside);
    expect(scene.requestCancel).toHaveBeenCalledWith({ allowPause: false });
  });
});
