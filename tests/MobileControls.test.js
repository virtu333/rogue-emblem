// MobileControls.test.js - Mobile virtual control behavior coverage
// Covers: context stack restoration, overlay push/pop idempotency, scene wiring, and mobile battle guard.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MobileControls } from '../src/utils/MobileControls.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: {
      Clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    },
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';

function createMockEvents() {
  const listeners = {};
  return {
    on(event, fn) {
      (listeners[event] ||= []).push(fn);
    },
    off(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((f) => f !== fn);
    },
    emit(event, ...args) {
      for (const fn of listeners[event] || []) fn(...args);
    },
    _listeners: listeners,
  };
}

function createDisplayObject() {
  return {
    setDepth() { return this; },
    setInteractive() { return this; },
    setStrokeStyle() { return this; },
    setOrigin() { return this; },
    setFillStyle() { return this; },
    setSize() { return this; },
    setPosition() { return this; },
    setVisible() { return this; },
    setColor() { return this; },
    setAlpha() { return this; },
    setTint() { return this; },
    setDisplaySize() { return this; },
    setScale() { return this; },
    setText() { return this; },
    destroy: vi.fn(),
    on: vi.fn(),
    width: 50,
    height: 20,
    x: 0,
    y: 0,
  };
}

function createMockScene(game) {
  return {
    game,
    add: {
      rectangle: () => createDisplayObject(),
      text: () => createDisplayObject(),
      graphics: () => ({
        ...createDisplayObject(),
        lineStyle() { return this; },
        beginPath() { return this; },
        moveTo() { return this; },
        lineTo() { return this; },
        strokePath() { return this; },
      }),
      image: () => createDisplayObject(),
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
    cameras: { main: { centerX: 320, centerY: 240 } },
    textures: { exists: () => false },
    events: { on: vi.fn() },
    time: {
      delayedCall: () => ({ remove: vi.fn() }),
    },
  };
}

function createDomElement(tagName = 'div') {
  const listeners = {};
  const element = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    dataset: {},
    className: '',
    textContent: '',
    children: [],
    parentNode: null,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    },
    addEventListener(event, fn) {
      (listeners[event] ||= []).push(fn);
    },
    removeEventListener(event, fn) {
      if (!listeners[event]) return;
      listeners[event] = listeners[event].filter((f) => f !== fn);
    },
    dispatch(event, payload = { preventDefault() {}, stopPropagation() {} }) {
      for (const fn of listeners[event] || []) fn(payload);
    },
    querySelectorAll(selector) {
      if (selector !== '.mobile-btn') return [];
      return this.children.filter((c) => String(c.className || '').split(/\s+/).includes('mobile-btn'));
    },
    _listeners: listeners,
  };
  return element;
}

function createMockMobileDom() {
  const leftPanel = createDomElement('div');
  const rightPanel = createDomElement('div');
  const rotatePrompt = createDomElement('div');

  const cancelBtn = createDomElement('button');
  cancelBtn.className = 'mobile-btn';
  cancelBtn.dataset.action = 'cancel';
  const menuBtn = createDomElement('button');
  menuBtn.className = 'mobile-btn';
  menuBtn.dataset.action = 'menu';
  leftPanel.appendChild(cancelBtn);
  leftPanel.appendChild(menuBtn);

  const elementsById = {
    'mobile-left-panel': leftPanel,
    'mobile-right-panel': rightPanel,
    'rotate-prompt': rotatePrompt,
  };

  const documentMock = {
    getElementById: (id) => elementsById[id] || null,
    createElement: (tag) => createDomElement(tag),
    documentElement: {
      requestFullscreen: vi.fn(() => Promise.resolve()),
    },
  };

  return { documentMock, leftPanel, rightPanel, rotatePrompt };
}

function createNodeMapDrawSceneStub(events) {
  const textObj = createDisplayObject();
  textObj.width = 120;
  return {
    children: { removeAll: vi.fn() },
    add: {
      text: vi.fn(() => createDisplayObject()),
      rectangle: vi.fn(() => createDisplayObject()),
      circle: vi.fn(() => createDisplayObject()),
      line: vi.fn(() => createDisplayObject()),
      image: vi.fn(() => textObj),
      graphics: vi.fn(() => ({
        ...createDisplayObject(),
        lineStyle() { return this; },
        beginPath() { return this; },
        moveTo() { return this; },
        lineTo() { return this; },
        strokePath() { return this; },
      })),
    },
    cameras: { main: { width: 640, height: 480, centerX: 320 } },
    registry: {
      get: vi.fn((key) => {
        if (key === 'startupFlags') return { isMobile: true };
        return null;
      }),
    },
    game: { events },
    runManager: {
      nodeMap: { nodes: [], edges: [] },
      getAvailableNodes: () => [],
      roster: [],
      actIndex: 0,
      currentAct: 'act1',
      gold: 0,
      difficultyModifiers: null,
    },
    drawRoster: vi.fn(),
    requestCancel: vi.fn(),
    _openRoster: vi.fn(),
    onNodeClick: vi.fn(),
    showNodeTooltip: vi.fn(),
    hideNodeTooltip: vi.fn(),
    tweens: { add: vi.fn() },
  };
}

describe('MobileControls context stack', () => {
  const originalDocument = globalThis.document;
  const originalScreen = globalThis.screen;

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.screen = originalScreen;
  });

  it('restores previous context after push then pop', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_idle' });
    expect(controls._currentContext).toBe('battle_idle');
    expect(rightPanel.children.map((c) => c.dataset.action))
      .toEqual(['danger', 'roster', 'objective', 'endTurn']);

    events.emit('mobile:pushContext', { context: 'overlay_tabs' });
    expect(controls._currentContext).toBe('overlay_tabs');
    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual(['prevTab', 'nextTab']);

    events.emit('mobile:popContext');
    expect(controls._currentContext).toBe('battle_idle');
    expect(rightPanel.children.map((c) => c.dataset.action))
      .toEqual(['danger', 'roster', 'objective', 'endTurn']);
  });

  it('pop on empty stack resolves to base context', () => {
    const events = createMockEvents();
    const { documentMock } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_idle' });
    events.emit('mobile:popContext');
    expect(controls._currentContext).toBe('battle_idle');
  });
});

describe('Overlay show/hide idempotency', () => {
  let events;
  let scene;
  let popCount;

  beforeEach(() => {
    events = createMockEvents();
    popCount = 0;
    events.on('mobile:popContext', () => { popCount++; });
    scene = createMockScene({ events });
  });

  it('HelpOverlay hide() without prior show() does not emit popContext', async () => {
    const { HelpOverlay } = await import('../src/ui/HelpOverlay.js');
    const overlay = new HelpOverlay(scene, vi.fn());
    overlay.hide();
    expect(popCount).toBe(0);
  });

  it('HelpOverlay show->hide emits exactly one popContext', async () => {
    const { HelpOverlay } = await import('../src/ui/HelpOverlay.js');
    const overlay = new HelpOverlay(scene, vi.fn());
    overlay.show();
    overlay.hide();
    expect(popCount).toBe(1);
  });

  it('HowToPlayOverlay hide() without prior show() does not emit popContext', async () => {
    const { HowToPlayOverlay } = await import('../src/ui/HowToPlayOverlay.js');
    const overlay = new HowToPlayOverlay(scene, vi.fn());
    overlay.hide();
    expect(popCount).toBe(0);
  });

  it('HowToPlayOverlay show->hide emits exactly one popContext', async () => {
    const { HowToPlayOverlay } = await import('../src/ui/HowToPlayOverlay.js');
    const overlay = new HowToPlayOverlay(scene, vi.fn());
    overlay.show();
    overlay.hide();
    expect(popCount).toBe(1);
  });

  it('UnitDetailOverlay hide() without prior show() does not emit popContext', async () => {
    const { UnitDetailOverlay } = await import('../src/ui/UnitDetailOverlay.js');
    const overlay = new UnitDetailOverlay(scene, null);
    overlay.hide();
    expect(popCount).toBe(0);
  });

  it('UnitDetailOverlay show->hide emits exactly one popContext', async () => {
    const { UnitDetailOverlay } = await import('../src/ui/UnitDetailOverlay.js');
    const overlay = new UnitDetailOverlay(scene, null);
    const unit = {
      name: 'Test', faction: 'player', className: 'Myrmidon', tier: 'base',
      level: 1, currentHP: 20, stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD: 7, DEF: 3, RES: 2, LCK: 5, MOV: 5 },
      inventory: [], consumables: [], skills: [],
    };
    overlay.show(unit, null);
    overlay.hide();
    expect(popCount).toBe(1);
  });
});

describe('Ghost-click double-fire prevention', () => {
  const originalDocument = globalThis.document;
  const originalScreen = globalThis.screen;

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.screen = originalScreen;
  });

  it('touch sequence (touchstart → touchend → click) fires handler exactly once', () => {
    const events = createMockEvents();
    const { documentMock, leftPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    const cancelBtn = leftPanel.children.find((c) => c.dataset.action === 'cancel');

    let fireCount = 0;
    events.on('mobile:cancel', () => { fireCount++; });

    const evt = { preventDefault() {}, stopPropagation() {} };
    cancelBtn.dispatch('touchstart', evt);
    cancelBtn.dispatch('touchend', evt);
    // Simulate ghost click arriving immediately after touchend
    cancelBtn.dispatch('click', evt);

    expect(fireCount).toBe(1);

    controls.destroy();
  });
});

describe('BattleScene refreshEndTurnControl mobile guard', () => {
  it('does not re-show canvas buttons when isMobileInput is true', () => {
    const scene = {
      isMobileInput: true,
      inspectButton: { setVisible: vi.fn(), setText: vi.fn(), setColor: vi.fn(), setInteractive: vi.fn(), disableInteractive: vi.fn() },
      endTurnButton: { setVisible: vi.fn(), setColor: vi.fn(), setInteractive: vi.fn(), disableInteractive: vi.fn() },
      cancelButton: { setVisible: vi.fn(), setColor: vi.fn(), setInteractive: vi.fn(), disableInteractive: vi.fn() },
      _emitMobileContext: vi.fn(),
      canForceEndTurn: () => true,
      canRequestCancel: () => true,
      battleState: 'PLAYER_IDLE',
      inspectMode: false,
      pauseOverlay: null,
      unitDetailOverlay: null,
      lootSettingsOverlay: null,
    };

    BattleScene.prototype.refreshEndTurnControl.call(scene);

    expect(scene._emitMobileContext).toHaveBeenCalledOnce();
    expect(scene.inspectButton.setVisible).not.toHaveBeenCalled();
    expect(scene.endTurnButton.setVisible).not.toHaveBeenCalled();
    expect(scene.cancelButton.setVisible).not.toHaveBeenCalled();
  });
});

describe('Cancel vs Menu semantic parity', () => {
  it('NodeMap mobile handlers map cancel to allowPause:false and menu to default', () => {
    const events = createMockEvents();
    const scene = createNodeMapDrawSceneStub(events);

    NodeMapScene.prototype.drawMap.call(scene);

    events.emit('mobile:cancel');
    events.emit('mobile:menu');

    expect(scene.requestCancel).toHaveBeenNthCalledWith(1, { allowPause: false });
    expect(scene.requestCancel).toHaveBeenNthCalledWith(2);
  });

  it('NodeMap redraw does not duplicate mobile handlers', () => {
    const events = createMockEvents();
    const scene = createNodeMapDrawSceneStub(events);

    NodeMapScene.prototype.drawMap.call(scene);
    NodeMapScene.prototype.drawMap.call(scene);

    events.emit('mobile:cancel');
    events.emit('mobile:menu');

    expect(scene.requestCancel).toHaveBeenCalledTimes(2);
    expect(scene.requestCancel).toHaveBeenNthCalledWith(1, { allowPause: false });
    expect(scene.requestCancel).toHaveBeenNthCalledWith(2);
  });

  it('NodeMap requestCancel does not open pause when allowPause is false', () => {
    const scene = {
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
      showPauseMenu: vi.fn(),
      canRequestCancel(opts) { return NodeMapScene.prototype.canRequestCancel.call(this, opts); },
    };

    const handled = NodeMapScene.prototype.requestCancel.call(scene, { allowPause: false });

    expect(handled).toBe(false);
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
  });

  it('HomeBase create wires cancel/menu to allowExit false/true respectively', () => {
    const events = createMockEvents();
    const scene = {
      registry: {
        get: vi.fn((key) => {
          if (key === 'startupFlags') return { isMobile: true };
          return null;
        }),
      },
      events: { once: vi.fn() },
      game: { events },
      input: {
        keyboard: { on: vi.fn() },
        on: vi.fn(),
      },
      requestCancel: vi.fn(),
      drawUI: vi.fn(),
      add: {
        rectangle: vi.fn(() => createDisplayObject()),
        text: vi.fn(() => createDisplayObject()),
      },
      cameras: { main: { width: 640, height: 480 } },
    };

    HomeBaseScene.prototype.create.call(scene);
    events.emit('mobile:cancel');
    events.emit('mobile:menu');

    expect(scene.requestCancel).toHaveBeenNthCalledWith(1, { allowExit: false });
    expect(scene.requestCancel).toHaveBeenNthCalledWith(2, { allowExit: true });
  });

  it('HomeBase shutdown resets mobile context with stack reset', () => {
    const events = createMockEvents();
    const contexts = [];
    events.on('mobile:setContext', (payload) => contexts.push(payload));
    const scene = {
      registry: {
        get: vi.fn((key) => {
          if (key === 'startupFlags') return { isMobile: true };
          return null;
        }),
      },
      events: { once: vi.fn() },
      game: { events },
      input: {
        keyboard: { on: vi.fn(), off: vi.fn() },
        on: vi.fn(),
        off: vi.fn(),
      },
      requestCancel: vi.fn(),
      drawUI: vi.fn(),
      _hideRefundConfirm: vi.fn(),
      add: {
        rectangle: vi.fn(() => createDisplayObject()),
        text: vi.fn(() => createDisplayObject()),
      },
      cameras: { main: { width: 640, height: 480 } },
    };

    HomeBaseScene.prototype.create.call(scene);
    const shutdownHandler = scene.events.once.mock.calls.find(([eventName]) => eventName === 'shutdown')?.[1];
    expect(typeof shutdownHandler).toBe('function');

    shutdownHandler();

    expect(contexts.at(-1)).toEqual({ context: 'none', resetStack: true });
  });
});
