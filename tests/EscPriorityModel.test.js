import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { PauseOverlay } from '../src/ui/PauseOverlay.js';
import { HowToPlayOverlay } from '../src/ui/HowToPlayOverlay.js';
import { PromotionChoicePanel } from '../src/ui/PromotionChoicePanel.js';
import { consumeEscEvent } from '../src/utils/escPriority.js';

function makeDisplayObject(extra = {}) {
  return {
    handlers: {},
    style: {},
    setDepth() { return this; },
    setInteractive() {
      this.input = this.input || {};
      this.input.enabled = true;
      return this;
    },
    setStrokeStyle() { return this; },
    setOrigin() { return this; },
    setColor(color) { this.style.color = color; return this; },
    setAlpha() { return this; },
    on(event, handler) { this.handlers[event] = handler; return this; },
    once(event, handler) { this.handlers[event] = handler; return this; },
    destroy: vi.fn(),
    ...extra,
  };
}

function makeOverlayScene() {
  return {
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    add: {
      rectangle: (_x, _y, _w, _h, _color, _alpha) => makeDisplayObject(),
      text: (_x, _y, text, style = {}) => makeDisplayObject({ text, style: { ...style } }),
      graphics: () => ({
        ...makeDisplayObject(),
        lineStyle() { return this; },
        beginPath() { return this; },
        moveTo() { return this; },
        lineTo() { return this; },
        strokePath() { return this; },
      }),
      circle: () => makeDisplayObject(),
    },
    input: {
      keyboard: {
        addKey: () => ({ on: vi.fn(), off: vi.fn() }),
        on: vi.fn(),
        off: vi.fn(),
      },
      on: vi.fn(),
      off: vi.fn(),
    },
    game: {
      events: {
        emit: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      },
    },
    tweens: { add: vi.fn() },
  };
}

function makeEscEvent() {
  return {
    key: 'Escape',
    repeat: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

function createNodeMapEscScene(keyboardOverride = null) {
  const overlay = makeOverlayScene();
  const scene = {
    ...overlay,
    input: keyboardOverride
      ? { ...overlay.input, keyboard: keyboardOverride }
      : overlay.input,
    _storyDialogueActive: false,
    dialogueOverlay: { visible: false },
    isDevToolsEnabled: () => false,
    debugOverlay: null,
    forgePicker: null,
    unitPicker: null,
    unitPickerState: null,
    settingsOverlay: null,
    rosterOverlay: null,
    pauseOverlay: null,
    shopOverlay: null,
    churchOverlay: null,
    _shopViewingMap: false,
    _churchViewingMap: false,
    showPauseMenu: vi.fn(),
    leaveShopNode: vi.fn(),
    leaveChurchNode: vi.fn(),
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onWheel: vi.fn(),
    _unbindInputHandlers: NodeMapScene.prototype._unbindInputHandlers,
    canRequestCancel(opts) {
      return NodeMapScene.prototype.canRequestCancel.call(this, opts);
    },
  };

  scene.requestCancel = vi.fn((opts) => NodeMapScene.prototype.requestCancel.call(scene, opts));
  NodeMapScene.prototype._bindInputHandlers.call(scene);
  return scene;
}

function createEmitter() {
  const listeners = new Map();
  return {
    on(eventName, handler) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(handler);
      return this;
    },
    off(eventName, handler) {
      const handlers = listeners.get(eventName);
      if (!handlers) return this;
      if (handler) handlers.delete(handler);
      else handlers.clear();
      if (handlers.size === 0) listeners.delete(eventName);
      return this;
    },
    emit(eventName, ...args) {
      for (const handler of Array.from(listeners.get(eventName) || [])) {
        handler(...args);
      }
    },
  };
}

function createBattleKeyboardEmitter() {
  const keyboard = createEmitter();
  const keys = new Map();
  keyboard.addKey = vi.fn((keyCode) => {
    if (!keys.has(keyCode)) keys.set(keyCode, createEmitter());
    return keys.get(keyCode);
  });
  return keyboard;
}

function setupBattleShortcutContext(scene, keyboard) {
  scene.registry = { get: vi.fn(() => null) };
  scene.input = { keyboard };
  scene.isStoryInputLocked = () => false;
  scene.inspectionPanel = { visible: false, _unit: null };
  scene.unitDetailOverlay = { visible: false };
  scene.requestCancel = vi.fn(() => true);
  scene.requestVisionRewind = vi.fn();
  scene._onRosterClick = vi.fn();
  scene._onDangerClick = vi.fn();
  scene.forceEndTurn = vi.fn();
  scene.refreshEndTurnControl = vi.fn();
  scene.hideLootRoster = vi.fn();
  scene.showLootRoster = vi.fn();
  scene._hideLootTooltip = vi.fn();
  scene._cycleForecastWeapon = vi.fn();
  scene.grid = { clearHighlights: vi.fn() };
  scene.turnManager = { unitActed: vi.fn() };
  scene.dimUnit = vi.fn();
  scene.selectedUnit = null;
  scene.lootGroup = null;
  scene.runManager = {};
  scene.battleState = 'PLAYER_IDLE';
}

describe('ESC priority model', () => {
  it('NodeMap: first ESC closes Help child only, second ESC closes Pause', async () => {
    const scene = createNodeMapEscScene();
    let resumeCount = 0;
    const pause = new PauseOverlay(scene, {
      onResume: () => {
        resumeCount++;
        scene.pauseOverlay = null;
      },
    });
    pause.show();
    scene.pauseOverlay = pause;

    const helpBtn = pause.objects.find((obj) => obj.text === 'More Info');
    helpBtn.handlers.pointerdown();
    expect(pause.helpOverlay?.visible).toBe(true);

    const firstEsc = makeEscEvent();
    pause.helpOverlay._onEsc(null, firstEsc);
    scene._onEsc(firstEsc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(0);
    expect(scene.pauseOverlay?.visible).toBe(true);
    expect(scene.pauseOverlay?.helpOverlay).toBeNull();

    await Promise.resolve();

    const secondEsc = makeEscEvent();
    scene._onEsc(secondEsc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
    expect(scene.pauseOverlay).toBeNull();
    expect(resumeCount).toBe(1);
  });

  it('NodeMap: first ESC closes Campaign Map child only, second ESC closes Pause', async () => {
    const scene = createNodeMapEscScene();
    let resumeCount = 0;
    const pause = new PauseOverlay(scene, {
      onResume: () => {
        resumeCount++;
        scene.pauseOverlay = null;
      },
      campaignMapData: {
        nodeMap: { nodes: [] },
        currentNodeId: null,
        actId: 'act1',
        activeNodeId: null,
      },
    });
    pause.show();
    scene.pauseOverlay = pause;

    const mapBtn = pause.objects.find((obj) => obj.text === 'Campaign Map');
    mapBtn.handlers.pointerdown();
    expect(pause.campaignMapOverlay?.visible).toBe(true);

    const firstEsc = makeEscEvent();
    pause.campaignMapOverlay._onEsc(null, firstEsc);
    scene._onEsc(firstEsc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(0);
    expect(scene.pauseOverlay?.visible).toBe(true);
    expect(scene.pauseOverlay?.campaignMapOverlay).toBeNull();

    await Promise.resolve();

    const secondEsc = makeEscEvent();
    scene._onEsc(secondEsc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
    expect(scene.pauseOverlay).toBeNull();
    expect(resumeCount).toBe(1);
  });

  it('NodeMap: pointer-closing Campaign Map does not consume next ESC', () => {
    const scene = createNodeMapEscScene();
    let resumeCount = 0;
    const pause = new PauseOverlay(scene, {
      onResume: () => {
        resumeCount++;
        scene.pauseOverlay = null;
      },
      campaignMapData: {
        nodeMap: { nodes: [] },
        currentNodeId: null,
        actId: 'act1',
        activeNodeId: null,
      },
    });
    pause.show();
    scene.pauseOverlay = pause;

    const mapBtn = pause.objects.find((obj) => obj.text === 'Campaign Map');
    mapBtn.handlers.pointerdown();
    expect(pause.campaignMapOverlay?.visible).toBe(true);

    const closeBtn = pause.campaignMapOverlay.objects.find((obj) => obj.text === '[X]');
    closeBtn.handlers.pointerdown();
    expect(scene.pauseOverlay?.campaignMapOverlay).toBeNull();

    const esc = makeEscEvent();
    scene._onEsc(esc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
    expect(scene.pauseOverlay).toBeNull();
    expect(resumeCount).toBe(1);
  });

  it('Battle: first ESC closes Help child only, second ESC closes Pause', async () => {
    const overlayScene = makeOverlayScene();
    const keyboard = createBattleKeyboardEmitter();
    const scene = new BattleScene();
    scene.init({ gameData: { skills: [] }, battleParams: { act: 'act1' } });
    setupBattleShortcutContext(scene, keyboard);
    scene.cameras = overlayScene.cameras;
    scene.add = overlayScene.add;
    scene.game = overlayScene.game;
    scene.tweens = overlayScene.tweens;
    scene.isDevToolsEnabled = () => false;
    scene._isTutorialStrictGateActive = () => false;
    scene.requestCancel = vi.fn((opts) => BattleScene.prototype.requestCancel.call(scene, opts));
    scene._bindGameplayKeyboardHandlers();

    let resumeCount = 0;
    const pause = new PauseOverlay(scene, {
      onResume: () => {
        resumeCount++;
        scene.pauseOverlay = null;
      },
    });
    pause.show();
    scene.pauseOverlay = pause;

    const helpBtn = pause.objects.find((obj) => obj.text === 'More Info');
    helpBtn.handlers.pointerdown();
    expect(pause.helpOverlay?.visible).toBe(true);

    const firstEsc = makeEscEvent();
    pause.helpOverlay._onEsc(null, firstEsc);
    keyboard.emit('keydown-ESC', firstEsc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(0);
    expect(scene.pauseOverlay?.visible).toBe(true);
    expect(scene.pauseOverlay?.helpOverlay).toBeNull();

    await Promise.resolve();

    const secondEsc = makeEscEvent();
    keyboard.emit('keydown-ESC', secondEsc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
    expect(scene.pauseOverlay).toBeNull();
    expect(resumeCount).toBe(1);
  });

  it('Battle ESC handler ignores keydown already consumed by higher-priority overlay', async () => {
    const keyboard = createBattleKeyboardEmitter();
    const scene = new BattleScene();
    scene.init({ gameData: { skills: [] }, battleParams: { act: 'act1' } });
    setupBattleShortcutContext(scene, keyboard);
    scene._bindGameplayKeyboardHandlers();

    const consumedEsc = makeEscEvent();
    consumeEscEvent(scene, consumedEsc);
    keyboard.emit('keydown-ESC', consumedEsc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(0);

    await Promise.resolve();

    const normalEsc = makeEscEvent();
    keyboard.emit('keydown-ESC', normalEsc);
    expect(scene.requestCancel).toHaveBeenCalledTimes(1);
  });

  it('HowToPlay ESC respects consumed-event contract (topmost layer only)', async () => {
    const scene = makeOverlayScene();
    const overlay = new HowToPlayOverlay(scene, vi.fn());
    overlay.show();
    expect(overlay.visible).toBe(true);

    const consumedEsc = makeEscEvent();
    consumeEscEvent(scene, consumedEsc);
    overlay._onEsc(null, consumedEsc);
    expect(overlay.visible).toBe(true);

    await Promise.resolve();

    const ownEsc = makeEscEvent();
    overlay._onEsc(null, ownEsc);
    expect(ownEsc.preventDefault).toHaveBeenCalledTimes(1);
    expect(ownEsc.stopPropagation).toHaveBeenCalledTimes(1);
    expect(overlay.visible).toBe(false);
  });

  it('PromotionChoicePanel ESC respects consumed-event contract', async () => {
    const overlayScene = makeOverlayScene();
    const keyboard = createBattleKeyboardEmitter();
    const scene = {
      ...overlayScene,
      input: {
        ...overlayScene.input,
        keyboard,
      },
    };

    const unit = {
      name: 'Test Unit',
      className: 'Myrmidon',
      moveType: 'infantry',
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 8, SPD: 10, LCK: 5, DEF: 6, RES: 3, MOV: 5 },
    };
    const targets = [
      {
        name: 'Swordmaster',
        promotionBonuses: { STR: 1, SKL: 2, SPD: 2 },
        weaponProficiencies: 'Sword',
        moveType: 'infantry',
      },
      {
        name: 'Duelist',
        promotionBonuses: { STR: 2, SPD: 1, RES: 1 },
        weaponProficiencies: 'Sword,Lance',
        moveType: 'infantry',
      },
    ];
    const skills = [
      { id: 'crit_plus_15', name: 'Crit +15', description: 'Gain +15 crit.', classInnate: 'Swordmaster' },
      { id: 'duelist_stance', name: 'Duelist Stance', description: 'Defending grants avoid and defenses.', classInnate: 'Duelist' },
    ];

    const panel = new PromotionChoicePanel(scene, unit, targets, skills);
    const resultPromise = panel.show();

    const consumedEsc = makeEscEvent();
    consumeEscEvent(scene, consumedEsc);
    keyboard.emit('keydown-ESC', consumedEsc);
    expect(panel.objects.length).toBeGreaterThan(0);

    await Promise.resolve();

    const ownEsc = makeEscEvent();
    keyboard.emit('keydown-ESC', ownEsc);
    await expect(resultPromise).resolves.toBeNull();
    expect(ownEsc.preventDefault).toHaveBeenCalledTimes(1);
    expect(ownEsc.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('NodeMap ESC does not bubble cancel while PromotionChoicePanel is open', async () => {
    const keyboard = createBattleKeyboardEmitter();
    const scene = createNodeMapEscScene(keyboard);
    scene.churchOverlay = [makeDisplayObject()];
    scene.requestCancel = vi.fn(() => true);

    const unit = {
      name: 'Test Unit',
      className: 'Knight',
      moveType: 'infantry',
      stats: { HP: 24, STR: 9, MAG: 0, SKL: 6, SPD: 5, LCK: 4, DEF: 10, RES: 2, MOV: 4 },
    };
    const targets = [
      {
        name: 'General',
        promotionBonuses: { HP: 3, DEF: 2, STR: 1 },
        weaponProficiencies: 'Lance,Axe',
        moveType: 'infantry',
      },
      {
        name: 'Great Knight',
        promotionBonuses: { HP: 2, STR: 2, MOV: 1 },
        weaponProficiencies: 'Lance,Axe,Sword',
        moveType: 'cavalry',
      },
    ];
    const skills = [
      { id: 'pavise', name: 'Pavise', description: 'Halve physical damage sometimes.', classInnate: 'General' },
      { id: 'armored_blow', name: 'Armored Blow', description: 'Initiating grants +4 DEF.', classInnate: 'Great Knight' },
    ];

    const panel = new PromotionChoicePanel(scene, unit, targets, skills);
    const resultPromise = panel.show();

    const esc = makeEscEvent();
    keyboard.emit('keydown-ESC', esc);

    await expect(resultPromise).resolves.toBeNull();
    expect(scene.requestCancel).toHaveBeenCalledTimes(0);
    expect(esc.preventDefault).toHaveBeenCalledTimes(1);
    expect(esc.stopPropagation).toHaveBeenCalledTimes(1);
    expect(scene._promotionChoicePanelOpen).toBe(0);
  });

  it('NodeMap requestCancel is a no-op while PromotionChoicePanel is open', () => {
    const scene = createNodeMapEscScene();
    scene.churchOverlay = [makeDisplayObject()];
    scene._promotionChoicePanelOpen = 1;

    const handledWhileOpen = NodeMapScene.prototype.requestCancel.call(scene, { allowPause: false });
    expect(handledWhileOpen).toBe(false);
    expect(scene.leaveChurchNode).not.toHaveBeenCalled();

    scene._promotionChoicePanelOpen = 0;
    const handledAfterClose = NodeMapScene.prototype.requestCancel.call(scene, { allowPause: false });
    expect(handledAfterClose).toBe(true);
    expect(scene.leaveChurchNode).toHaveBeenCalledTimes(1);
  });

  it('NodeMap shutdown clears PromotionChoicePanel open counter', () => {
    const scene = {
      _sceneShutdownCleanedUp: false,
      _sceneShuttingDown: false,
      _promotionChoicePanelOpen: 2,
      registry: { get: vi.fn(() => null) },
      sound: null,
      _sceneTimers: new Set(),
      _pendingNodeMapHints: { showIntro: true },
      _storyDialogueActive: true,
      _churchMessageTimer: null,
      _transientMessageTimer: null,
      pauseOverlay: null,
      settingsOverlay: null,
      rosterOverlay: null,
      debugOverlay: null,
      shopOverlay: null,
      churchOverlay: null,
      transientMessage: null,
      churchMessage: null,
      nodeTooltip: null,
      dialogueOverlay: null,
      _pendingNodeSelection: null,
      _unbindInputHandlers: vi.fn(),
      isMobileInput: false,
    };

    NodeMapScene.prototype._onSceneShutdown.call(scene);
    expect(scene._promotionChoicePanelOpen).toBe(0);
  });
});
