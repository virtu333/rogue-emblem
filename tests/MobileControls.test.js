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
    setDepth() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setFillStyle() {
      return this;
    },
    setSize() {
      return this;
    },
    setPosition() {
      return this;
    },
    setVisible() {
      return this;
    },
    setColor() {
      return this;
    },
    setAlpha() {
      return this;
    },
    setTint() {
      return this;
    },
    setDisplaySize() {
      return this;
    },
    setScale() {
      return this;
    },
    setText() {
      return this;
    },
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
        lineStyle() {
          return this;
        },
        beginPath() {
          return this;
        },
        moveTo() {
          return this;
        },
        lineTo() {
          return this;
        },
        strokePath() {
          return this;
        },
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
      return this.children.filter((c) =>
        String(c.className || '')
          .split(/\s+/)
          .includes('mobile-btn'),
      );
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
        lineStyle() {
          return this;
        },
        beginPath() {
          return this;
        },
        moveTo() {
          return this;
        },
        lineTo() {
          return this;
        },
        strokePath() {
          return this;
        },
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
    _unbindInputHandlers: vi.fn(),
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
    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual([
      'danger',
      'roster',
      'objective',
      'endTurn',
    ]);

    events.emit('mobile:pushContext', { context: 'overlay_tabs' });
    expect(controls._currentContext).toBe('overlay_tabs');
    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual(['prevTab', 'nextTab']);

    events.emit('mobile:popContext');
    expect(controls._currentContext).toBe('battle_idle');
    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual([
      'danger',
      'roster',
      'objective',
      'endTurn',
    ]);
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

  it('two stacked overlays sharing a context pop independently (no drift)', () => {
    // Regression: same-context pushes used to be deduped, so the second
    // overlay's later pop removed an entry belonging to something else.
    const events = createMockEvents();
    const { documentMock } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_idle' });

    const tokenA = Symbol('overlay-a');
    const tokenB = Symbol('overlay-b');
    events.emit('mobile:pushContext', { context: 'overlay_tabs', token: tokenA });
    events.emit('mobile:pushContext', { context: 'overlay_tabs', token: tokenB });
    expect(controls._currentContext).toBe('overlay_tabs');

    // Close B (top): still inside A's overlay context.
    events.emit('mobile:popContext', { token: tokenB });
    expect(controls._currentContext).toBe('overlay_tabs');

    // Close A: back to the base context — pre-fix this underflowed.
    events.emit('mobile:popContext', { token: tokenA });
    expect(controls._currentContext).toBe('battle_idle');
  });

  it('token pops are idempotent and out-of-order safe', () => {
    const events = createMockEvents();
    const { documentMock } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_idle' });

    const tokenA = Symbol('overlay-a');
    const tokenB = Symbol('overlay-b');
    events.emit('mobile:pushContext', { context: 'overlay_tabs', token: tokenA });
    events.emit('mobile:pushContext', { context: 'overlay_unit_detail', token: tokenB });
    expect(controls._currentContext).toBe('overlay_unit_detail');

    // Out-of-order: closing A (below B) keeps B on top.
    events.emit('mobile:popContext', { token: tokenA });
    expect(controls._currentContext).toBe('overlay_unit_detail');

    // Double-pop with a consumed token is a no-op.
    events.emit('mobile:popContext', { token: tokenA });
    expect(controls._currentContext).toBe('overlay_unit_detail');

    events.emit('mobile:popContext', { token: tokenB });
    expect(controls._currentContext).toBe('battle_idle');
  });

  it('battle_player_idle includes inspect action on right panel', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_player_idle' });

    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual([
      'danger',
      'roster',
      'objective',
      'inspect',
      'endTurn',
    ]);
  });

  it('battle_unit_selected excludes inspect action on right panel', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_unit_selected' });

    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual([
      'danger',
      'roster',
      'objective',
      'endTurn',
    ]);
  });

  it('overlay_unit_detail context renders tab and unit cycling buttons', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_player_idle' });
    events.emit('mobile:pushContext', { context: 'overlay_unit_detail' });

    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual([
      'prevTab',
      'nextTab',
      'prevUnit',
      'nextUnit',
    ]);
  });

  it('battle_selected keeps inspect hidden', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_selected' });

    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual(['danger']);
  });

  it('objective button label is Vision', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_player_idle' });

    const objectiveButton = rightPanel.children.find((c) => c.dataset.action === 'objective');
    expect(objectiveButton.children[1]?.textContent).toBe('Vision');
  });

  it('re-renders right panel when button visibility toggles within same context', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();

    events.emit('mobile:setButtonVisible', { action: 'danger', visible: false });
    events.emit('mobile:setContext', { context: 'battle_idle' });
    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual([
      'roster',
      'objective',
      'endTurn',
    ]);

    events.emit('mobile:setButtonVisible', { action: 'danger', visible: true });
    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual([
      'danger',
      'roster',
      'objective',
      'endTurn',
    ]);
  });
});

describe('Overlay show/hide idempotency', () => {
  let events;
  let scene;
  let popCount;

  beforeEach(() => {
    events = createMockEvents();
    popCount = 0;
    events.on('mobile:popContext', () => {
      popCount++;
    });
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
      name: 'Test',
      faction: 'player',
      className: 'Myrmidon',
      tier: 'base',
      level: 1,
      currentHP: 20,
      stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD: 7, DEF: 3, RES: 2, LCK: 5, MOV: 5 },
      inventory: [],
      consumables: [],
      skills: [],
    };
    overlay.show(unit, null);
    overlay.hide();
    expect(popCount).toBe(1);
  });

  it('UnitDetailOverlay pushes overlay_unit_detail and cycles units via mobile events', async () => {
    const { UnitDetailOverlay } = await import('../src/ui/UnitDetailOverlay.js');
    const pushed = [];
    events.on('mobile:pushContext', (data) => pushed.push(data?.context));
    const makeUnit = (name) => ({
      name,
      faction: 'player',
      className: 'Myrmidon',
      tier: 'base',
      level: 1,
      currentHP: 20,
      stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD: 7, DEF: 3, RES: 2, LCK: 5, MOV: 5 },
      inventory: [],
      consumables: [],
      skills: [],
    });
    const unitA = makeUnit('A');
    const unitB = makeUnit('B');

    const overlay = new UnitDetailOverlay(scene, null);
    overlay.show(unitA, null, null, { rosterUnits: [unitA, unitB], rosterIndex: 0 });
    expect(pushed).toEqual(['overlay_unit_detail']);

    events.emit('mobile:nextUnit');
    expect(overlay._rosterIndex).toBe(1);
    events.emit('mobile:prevUnit');
    expect(overlay._rosterIndex).toBe(0);

    overlay.hide();
    expect(popCount).toBe(1);

    // Without roster cycling the overlay still uses the plain tab context
    overlay.show(unitA, null);
    expect(pushed).toEqual(['overlay_unit_detail', 'overlay_tabs']);
    overlay.hide();
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
    events.on('mobile:cancel', () => {
      fireCount++;
    });

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
      inspectButton: {
        setVisible: vi.fn(),
        setText: vi.fn(),
        setColor: vi.fn(),
        setInteractive: vi.fn(),
        disableInteractive: vi.fn(),
      },
      endTurnButton: {
        setVisible: vi.fn(),
        setColor: vi.fn(),
        setInteractive: vi.fn(),
        disableInteractive: vi.fn(),
      },
      cancelButton: {
        setVisible: vi.fn(),
        setColor: vi.fn(),
        setInteractive: vi.fn(),
        disableInteractive: vi.fn(),
      },
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

  it('NodeMap shutdown unregisters mobile handlers and resets context stack', () => {
    const events = createMockEvents();
    const contexts = [];
    events.on('mobile:setContext', (payload) => contexts.push(payload));
    const scene = createNodeMapDrawSceneStub(events);

    NodeMapScene.prototype.drawMap.call(scene);
    expect(events._listeners['mobile:cancel']?.length ?? 0).toBe(1);
    expect(events._listeners['mobile:menu']?.length ?? 0).toBe(1);
    expect(events._listeners['mobile:roster']?.length ?? 0).toBe(1);

    NodeMapScene.prototype._onSceneShutdown.call(scene);

    expect(scene._unbindInputHandlers).toHaveBeenCalledTimes(1);
    expect(scene._mobileHandlers).toBeNull();
    expect(contexts.at(-1)).toEqual({ context: 'none', resetStack: true });
    expect(events._listeners['mobile:cancel']?.length ?? 0).toBe(0);
    expect(events._listeners['mobile:menu']?.length ?? 0).toBe(0);
    expect(events._listeners['mobile:roster']?.length ?? 0).toBe(0);

    events.emit('mobile:cancel');
    events.emit('mobile:menu');
    events.emit('mobile:roster');
    expect(scene.requestCancel).not.toHaveBeenCalled();
    expect(scene._openRoster).not.toHaveBeenCalled();
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
      canRequestCancel(opts) {
        return NodeMapScene.prototype.canRequestCancel.call(this, opts);
      },
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
    const shutdownHandler = scene.events.once.mock.calls.find(
      ([eventName]) => eventName === 'shutdown',
    )?.[1];
    expect(typeof shutdownHandler).toBe('function');

    shutdownHandler();

    expect(contexts.at(-1)).toEqual({ context: 'none', resetStack: true });
  });
});

describe('battle_action context (Fix 5)', () => {
  const originalDocument = globalThis.document;
  const originalScreen = globalThis.screen;

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.screen = originalScreen;
  });

  it('battle_action context includes danger and roster', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_action' });

    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual(['danger', 'roster']);
  });

  it('battle_selected context has only danger (no roster)', () => {
    const events = createMockEvents();
    const { documentMock, rightPanel } = createMockMobileDom();
    globalThis.document = documentMock;
    globalThis.screen = { orientation: { lock: vi.fn(() => Promise.resolve()) } };

    const controls = new MobileControls({ events });
    controls.show();
    events.emit('mobile:setContext', { context: 'battle_selected' });

    expect(rightPanel.children.map((c) => c.dataset.action)).toEqual(['danger']);
  });
});

describe('BattleScene shutdown mobile context reset (Fix 1)', () => {
  function makeBattleShutdownScene(events, mobileHandlers = null) {
    return {
      isMobileInput: true,
      _mobileHandlers: mobileHandlers,
      game: { events },
      pauseOverlay: null,
      lootSettingsOverlay: null,
      debugOverlay: null,
      dialogueOverlay: null,
      registry: { get: vi.fn(() => null) },
      _stopLevelUpSfx: vi.fn(),
      _clearTutorialGuideHighlights: vi.fn(),
      cancelTouchInspectHold: vi.fn(),
      _hideMenuTooltip: vi.fn(),
      _restoreBattleRng: vi.fn(),
      _clearPostLootTransitionFallback: vi.fn(),
      _unbindGameplayKeyboardHandlers: vi.fn(),
      _deployOverlay: null,
      hideForecast: vi.fn(),
      closeVisionDialog: vi.fn(),
      _teardownBattleCameraSystem: vi.fn(),
    };
  }

  it('emits context reset even when _mobileHandlers is null', () => {
    const events = createMockEvents();
    const contexts = [];
    events.on('mobile:setContext', (payload) => contexts.push(payload));

    const scene = makeBattleShutdownScene(events, null);
    BattleScene.prototype._runSceneShutdownCleanup.call(scene);

    expect(contexts).toEqual(
      expect.arrayContaining([expect.objectContaining({ context: 'none', resetStack: true })]),
    );
  });

  it('emits context reset after unbinding _mobileHandlers', () => {
    const events = createMockEvents();
    const contexts = [];
    events.on('mobile:setContext', (payload) => contexts.push(payload));

    const handler = vi.fn();
    const scene = makeBattleShutdownScene(events, { danger: handler });
    BattleScene.prototype._runSceneShutdownCleanup.call(scene);

    expect(scene._mobileHandlers).toBeNull();
    expect(contexts.at(-1)).toEqual({ context: 'none', resetStack: true });
  });
});

describe('Overlay shutdown mobile cleanup (Fix 8)', () => {
  let events;
  let scene;
  let popCount;

  beforeEach(() => {
    events = createMockEvents();
    popCount = 0;
    events.on('mobile:popContext', () => popCount++);
    scene = createMockScene({ events });
  });

  it('HelpOverlay shutdown cleans up mobile listeners', async () => {
    const { HelpOverlay } = await import('../src/ui/HelpOverlay.js');
    const overlay = new HelpOverlay(scene, vi.fn());
    overlay.show();
    expect(overlay._mobileContextPushed).toBe(true);

    // Simulate scene shutdown instead of normal hide
    const shutdownCb = scene.events.on.mock.calls.find(([ev]) => ev === 'shutdown')?.[1];
    expect(typeof shutdownCb).toBe('function');
    shutdownCb();

    expect(overlay._mobilePrev).toBeNull();
    expect(overlay._mobileNext).toBeNull();
    expect(overlay._mobileContextPushed).toBe(false);
    expect(popCount).toBe(1);
  });

  it('HowToPlayOverlay shutdown cleans up mobile listeners', async () => {
    const { HowToPlayOverlay } = await import('../src/ui/HowToPlayOverlay.js');
    const overlay = new HowToPlayOverlay(scene, vi.fn());
    overlay.show();
    expect(overlay._mobileContextPushed).toBe(true);

    const shutdownCb = scene.events.on.mock.calls.find(([ev]) => ev === 'shutdown')?.[1];
    expect(typeof shutdownCb).toBe('function');
    shutdownCb();

    expect(overlay._mobilePrev).toBeNull();
    expect(overlay._mobileNext).toBeNull();
    expect(overlay._mobileContextPushed).toBe(false);
    expect(popCount).toBe(1);
  });

  it('CompendiumOverlay shutdown cleans up mobile listeners', async () => {
    const { CompendiumOverlay } = await import('../src/ui/CompendiumOverlay.js');
    const overlay = new CompendiumOverlay(scene, null, vi.fn());
    overlay.show();
    expect(overlay._mobileContextPushed).toBe(true);

    const shutdownCb = scene.events.on.mock.calls.find(([ev]) => ev === 'shutdown')?.[1];
    expect(typeof shutdownCb).toBe('function');
    shutdownCb();

    expect(overlay._mobilePrev).toBeNull();
    expect(overlay._mobileNext).toBeNull();
    expect(overlay._mobileContextPushed).toBe(false);
    expect(popCount).toBe(1);
  });

  it('UnitDetailOverlay shutdown cleans up mobile listeners', async () => {
    const { UnitDetailOverlay } = await import('../src/ui/UnitDetailOverlay.js');
    const overlay = new UnitDetailOverlay(scene, null);
    const unit = {
      name: 'Test',
      faction: 'player',
      className: 'Myrmidon',
      tier: 'base',
      level: 1,
      currentHP: 20,
      stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD: 7, DEF: 3, RES: 2, LCK: 5, MOV: 5 },
      inventory: [],
      consumables: [],
      skills: [],
    };
    overlay.show(unit, null);
    expect(overlay._mobileContextPushed).toBe(true);

    const shutdownCb = scene.events.on.mock.calls.find(([ev]) => ev === 'shutdown')?.[1];
    expect(typeof shutdownCb).toBe('function');
    shutdownCb();

    expect(overlay._mobilePrev).toBeNull();
    expect(overlay._mobileNext).toBeNull();
    expect(overlay._mobileContextPushed).toBe(false);
    expect(popCount).toBe(1);
  });
});
