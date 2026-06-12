import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VisionRewindController, hashRewindSeed } from '../src/ui/VisionRewindController.js';

// ── Helpers ──────────────────────────────────────────────────

function makeDisplayObject(seed = {}) {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 14,
    depth: 0,
    visible: true,
    ...seed,
    handlers: {},
    setOrigin(x = 0) {
      return this;
    },
    setDepth(d) {
      this.depth = d;
      return this;
    },
    setInteractive() {
      this.interactive = true;
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setColor(c) {
      this._color = c;
      return this;
    },
    setText(t) {
      this.text = t;
      return this;
    },
    setAlpha(a) {
      this.alpha = a;
      return this;
    },
    setScrollFactor() {
      return this;
    },
    on(event, cb) {
      this.handlers[event] = cb;
      return this;
    },
    destroy: vi.fn(),
  };
}

function makeScene(overrides = {}) {
  return {
    visionSnapshot: null,
    pendingVisionSnapshot: null,
    visionDialog: null,
    visionBaseSeed: null,
    visionHudText: null,
    battleState: 'PLAYER_IDLE',
    prePauseState: null,
    _uiClickBlocked: false,
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    turnManager: { currentPhase: 'player', turnNumber: 1 },
    turnCounterText: null,
    turnPar: null,
    turnBonusConfig: null,
    antiTurtleState: {},
    ballistas: [],
    _zombieTombstones: [],
    grid: {
      fogEnabled: false,
      visibleSet: new Set(),
      everSeenSet: new Set(),
      fogOverlays: [],
      rows: 0,
      cols: 0,
      clearHighlights: vi.fn(),
      clearAttackHighlights: vi.fn(),
      clearPath: vi.fn(),
    },
    cameras: {
      main: { centerX: 320, centerY: 240, width: 640, height: 480 },
    },
    add: {
      rectangle: (...args) =>
        makeDisplayObject({ x: args[0], y: args[1], width: args[2], height: args[3] }),
      text: (...args) => makeDisplayObject({ x: args[0], y: args[1], text: args[2] || '' }),
    },
    tweens: { add: vi.fn() },
    registry: { get: vi.fn(() => null) },
    deriveBattleSeed: vi.fn(() => 42),
    removeUnitGraphic: vi.fn(),
    addUnitGraphic: vi.fn(),
    hideActionMenu: vi.fn(),
    hideForecast: vi.fn(),
    cleanupTradeUI: vi.fn(),
    updateEnemyVisibility: vi.fn(),
    reseedBattleRng: vi.fn(),
    updateObjectiveText: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    updateTopLeftHudLayout: vi.fn(),
    _pinToScreen: vi.fn(),
    isStoryInputLocked: vi.fn(() => false),
    onDefeat: vi.fn(),
    inspectionPanel: null,
    unitDetailOverlay: null,
    pauseOverlay: null,
    objectiveText: null,
    aiController: { setAggressiveMode: vi.fn() },
    getBestLordThroneDistance: vi.fn(() => 5),
    getTurnPressureSummary: vi.fn(() => ''),
    isMobileInput: false,
    applyVisionSnapshot: vi.fn(() => true),
    ...overrides,
  };
}

function makeRunManager(overrides = {}) {
  return {
    rngSeed: 12345,
    visionChargesRemaining: 2,
    visionCount: 0,
    getBaseVisionCharges: vi.fn(() => 3),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('hashRewindSeed', () => {
  it('is deterministic: same inputs produce same output', () => {
    const a = hashRewindSeed(100, 1);
    const b = hashRewindSeed(100, 1);
    expect(a).toBe(b);
    expect(typeof a).toBe('number');
  });

  it('different rewind counts produce different seeds', () => {
    const a = hashRewindSeed(100, 0);
    const b = hashRewindSeed(100, 1);
    const c = hashRewindSeed(100, 2);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
  });

  it('handles zero seed and count', () => {
    const result = hashRewindSeed(0, 0);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('handles negative count (clamped to 0)', () => {
    const a = hashRewindSeed(100, -5);
    const b = hashRewindSeed(100, 0);
    expect(a).toBe(b);
  });

  it('returns unsigned 32-bit integer', () => {
    const result = hashRewindSeed(999999, 50);
    expect(result >>> 0).toBe(result);
  });
});

describe('VisionRewindController', () => {
  let scene;
  let runManager;
  let controller;

  beforeEach(() => {
    scene = makeScene();
    runManager = makeRunManager();
    controller = new VisionRewindController(scene, runManager);
  });

  // ── initialize ──────────────────────────────────────────

  describe('initialize', () => {
    it('sets visionBaseSeed from runManager.rngSeed when finite', () => {
      runManager.rngSeed = 77;
      controller.initialize();
      expect(scene.visionBaseSeed).toBe(77);
      expect(runManager.rngSeed).toBe(77);
    });

    it('falls back to deriveBattleSeed when rngSeed is NaN', () => {
      runManager.rngSeed = NaN;
      scene.deriveBattleSeed = vi.fn(() => 1234);
      controller.initialize();
      expect(scene.visionBaseSeed).toBe(1234);
      expect(runManager.rngSeed).toBe(1234);
    });

    it('calls getBaseVisionCharges when charges are non-finite', () => {
      runManager.visionChargesRemaining = NaN;
      runManager.getBaseVisionCharges = vi.fn(() => 6);
      controller.initialize();
      expect(runManager.getBaseVisionCharges).toHaveBeenCalledTimes(1);
      expect(runManager.visionChargesRemaining).toBe(6);
    });

    it('preserves existing finite charges', () => {
      runManager.visionChargesRemaining = 4;
      runManager.getBaseVisionCharges = vi.fn(() => 99);
      controller.initialize();
      expect(runManager.getBaseVisionCharges).not.toHaveBeenCalled();
      expect(runManager.visionChargesRemaining).toBe(4);
    });

    it('initializes visionCount to 0 when non-finite', () => {
      runManager.visionCount = NaN;
      controller.initialize();
      expect(runManager.visionCount).toBe(0);
    });

    it('preserves existing finite visionCount', () => {
      runManager.visionCount = 3;
      controller.initialize();
      expect(runManager.visionCount).toBe(3);
    });

    it('falls back to deriveBattleSeed when no runManager', () => {
      const ctrl = new VisionRewindController(scene, null);
      scene.deriveBattleSeed = vi.fn(() => 9999);
      ctrl.initialize();
      expect(scene.visionBaseSeed).toBe(9999);
    });

    it('defaults to 1 charge when getBaseVisionCharges is not a function', () => {
      runManager.visionChargesRemaining = NaN;
      runManager.getBaseVisionCharges = 'not a function';
      controller.initialize();
      expect(runManager.visionChargesRemaining).toBe(1);
    });
  });

  // ── getChargesRemaining ─────────────────────────────────

  describe('getChargesRemaining', () => {
    it('returns charge count from runManager', () => {
      runManager.visionChargesRemaining = 3;
      expect(controller.getChargesRemaining()).toBe(3);
    });

    it('returns 0 when no runManager', () => {
      const ctrl = new VisionRewindController(scene, null);
      expect(ctrl.getChargesRemaining()).toBe(0);
    });

    it('floors non-integer values', () => {
      runManager.visionChargesRemaining = 2.7;
      expect(controller.getChargesRemaining()).toBe(2);
    });

    it('clamps negative to 0', () => {
      runManager.visionChargesRemaining = -1;
      expect(controller.getChargesRemaining()).toBe(0);
    });
  });

  // ── standalone charge host (tutorial: no runManager) ─────

  describe('standalone charge host', () => {
    it('reads granted charges from the scene-scoped store', () => {
      const ctrl = new VisionRewindController(scene, null);
      expect(ctrl.getChargesRemaining()).toBe(0);
      scene._standaloneVisionState.visionChargesRemaining += 1;
      expect(ctrl.getChargesRemaining()).toBe(1);
    });

    it('executeRewind works without a runManager when a charge was granted', () => {
      const ctrl = new VisionRewindController(scene, null);
      scene.visionSnapshot = { rngSeed: 7 };
      scene._standaloneVisionState = { visionChargesRemaining: 1, visionCount: 0 };
      expect(ctrl.executeRewind()).toBe(true);
      expect(scene.applyVisionSnapshot).toHaveBeenCalled();
      expect(scene._standaloneVisionState.visionChargesRemaining).toBe(0);
      expect(scene._standaloneVisionState.visionCount).toBe(1);
    });

    it('executeRewind refuses without charges or without a snapshot', () => {
      const ctrl = new VisionRewindController(scene, null);
      scene.visionSnapshot = { rngSeed: 7 };
      expect(ctrl.executeRewind()).toBe(false); // 0 charges
      scene._standaloneVisionState.visionChargesRemaining = 1;
      scene.visionSnapshot = null;
      expect(ctrl.executeRewind()).toBe(false); // no snapshot
      expect(scene._standaloneVisionState.visionChargesRemaining).toBe(1);
    });

    it('run battles are unaffected: charges still come from the runManager', () => {
      runManager.visionChargesRemaining = 2;
      scene.visionSnapshot = { rngSeed: 7 };
      expect(controller.executeRewind()).toBe(true);
      expect(runManager.visionChargesRemaining).toBe(1);
      expect(scene._standaloneVisionState).toBeUndefined();
    });
  });

  // ── captureSnapshot ─────────────────────────────────────

  describe('captureSnapshot', () => {
    it('first capture goes to visionSnapshot', () => {
      scene.playerUnits = [{ name: 'Edric', stats: {}, currentHP: 20, skills: [], col: 0, row: 0 }];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      controller.captureSnapshot();
      expect(scene.visionSnapshot).not.toBeNull();
      expect(scene.pendingVisionSnapshot).toBeNull();
      expect(scene.visionSnapshot.playerUnits[0].name).toBe('Edric');
    });

    it('second capture goes to pendingVisionSnapshot', () => {
      scene.playerUnits = [{ name: 'Edric', stats: {}, currentHP: 20, skills: [], col: 0, row: 0 }];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      controller.captureSnapshot();
      const first = scene.visionSnapshot;

      scene.playerUnits[0].currentHP = 15;
      controller.captureSnapshot();
      expect(scene.visionSnapshot).toBe(first);
      expect(scene.pendingVisionSnapshot).not.toBeNull();
      expect(scene.pendingVisionSnapshot.playerUnits[0].currentHP).toBe(15);
    });

    it('captures turn number and phase', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.turnManager = { turnNumber: 5, currentPhase: 'player' };
      controller.captureSnapshot();
      expect(scene.visionSnapshot.turnNumber).toBe(5);
      expect(scene.visionSnapshot.phase).toBe('player');
    });

    it('captures fog state when fog enabled', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.grid.fogEnabled = true;
      scene.grid.visibleSet = new Set(['1,2', '3,4']);
      scene.grid.everSeenSet = new Set(['1,2', '3,4', '5,6']);
      controller.captureSnapshot();
      expect(scene.visionSnapshot.fog).toBeTruthy();
      expect(scene.visionSnapshot.fog.visible).toEqual(['1,2', '3,4']);
      expect(scene.visionSnapshot.fog.everSeen).toContain('5,6');
    });

    it('fog is null when fog disabled', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.grid.fogEnabled = false;
      controller.captureSnapshot();
      expect(scene.visionSnapshot.fog).toBeNull();
    });

    it('captures RNG seed', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      runManager.rngSeed = 42;
      controller.captureSnapshot();
      expect(scene.visionSnapshot.rngSeed).toBe(42);
    });

    it('captures turnPar', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.turnPar = 8;
      controller.captureSnapshot();
      expect(scene.visionSnapshot.turnPar).toBe(8);
    });

    it('captures null turnPar', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.turnPar = null;
      controller.captureSnapshot();
      expect(scene.visionSnapshot.turnPar).toBeNull();
    });

    it('keeps mid-battle state serializeUnit strips for between-battle reuse', () => {
      // A rewind reverts to the start of the current player phase — it must
      // not refund once-per-battle Miracle/Phoenix Brooch consumed on earlier
      // turns, drop perMapLimit art usage, or unwind live timed-buff stats.
      scene.playerUnits = [
        {
          name: 'Edric',
          stats: { HP: 20, STR: 8 },
          currentHP: 20,
          skills: [],
          col: 0,
          row: 0,
          _miracleUsed: true,
          _phoenixBroochUsed: true,
          _battleWeaponArtUsage: { map: { surge: 1 }, turn: {} },
          _battleTimedWeaponArtAppliedStats: { STR: 3 },
        },
      ];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      controller.captureSnapshot();
      const snap = scene.visionSnapshot.playerUnits[0];
      expect(snap._miracleUsed).toBe(true);
      expect(snap._phoenixBroochUsed).toBe(true);
      expect(snap._battleWeaponArtUsage).toEqual({ map: { surge: 1 }, turn: {} });
      expect(snap.stats.STR).toBe(8); // live (buffed) value, not unwound
    });
  });

  // ── commitSnapshotIfPending ─────────────────────────────

  describe('commitSnapshotIfPending', () => {
    it('promotes pending to active during player phase', () => {
      const pending = { playerUnits: [], turnNumber: 2, id: 'pending' };
      scene.pendingVisionSnapshot = pending;
      scene.visionSnapshot = { id: 'old' };
      scene.turnManager.currentPhase = 'player';
      const result = controller.commitSnapshotIfPending();
      expect(result).toBe(true);
      expect(scene.visionSnapshot).toBe(pending);
      expect(scene.pendingVisionSnapshot).toBeNull();
    });

    it('returns false during enemy phase', () => {
      scene.pendingVisionSnapshot = { id: 'pending' };
      scene.turnManager.currentPhase = 'enemy';
      expect(controller.commitSnapshotIfPending()).toBe(false);
    });

    it('returns false when no pending snapshot', () => {
      scene.pendingVisionSnapshot = null;
      expect(controller.commitSnapshotIfPending()).toBe(false);
    });
  });

  // ── canUseNow ───────────────────────────────────────────

  describe('canUseNow', () => {
    beforeEach(() => {
      scene.turnManager.currentPhase = 'player';
      scene.battleState = 'PLAYER_IDLE';
      scene.visionSnapshot = { id: 'snap' };
      runManager.visionChargesRemaining = 2;
    });

    it('returns true when all conditions met', () => {
      expect(controller.canUseNow()).toBe(true);
    });

    it('returns false during enemy phase', () => {
      scene.turnManager.currentPhase = 'enemy';
      expect(controller.canUseNow()).toBe(false);
    });

    it('returns false when in disallowed state', () => {
      scene.battleState = 'ENEMY_ACTING';
      expect(controller.canUseNow()).toBe(false);
    });

    it('returns false when pause overlay visible', () => {
      scene.pauseOverlay = { visible: true };
      expect(controller.canUseNow()).toBe(false);
    });

    it('returns false when vision dialog open', () => {
      scene.visionDialog = { group: [] };
      expect(controller.canUseNow()).toBe(false);
    });

    it('returns false when no charges', () => {
      runManager.visionChargesRemaining = 0;
      expect(controller.canUseNow()).toBe(false);
    });

    it('returns false when no snapshot', () => {
      scene.visionSnapshot = null;
      expect(controller.canUseNow()).toBe(false);
    });

    it.each([
      'UNIT_SELECTED',
      'UNIT_ACTION_MENU',
      'SHOWING_FORECAST',
      'SELECTING_TARGET',
      'SELECTING_HEAL_TARGET',
      'TRADING',
      'CANTO_MOVING',
    ])('returns true for allowed state %s', (state) => {
      scene.battleState = state;
      expect(controller.canUseNow()).toBe(true);
    });
  });

  // ── Dialog flow ─────────────────────────────────────────

  describe('dialog flow', () => {
    it('showDialog creates visionDialog with correct shape', () => {
      const onConfirm = vi.fn();
      const onCancel = vi.fn();
      controller.showDialog({
        title: 'Test',
        body: 'Body text',
        confirmLabel: 'OK',
        cancelLabel: 'No',
        onConfirm,
        onCancel,
      });
      expect(scene.visionDialog).not.toBeNull();
      expect(scene.visionDialog.group).toBeInstanceOf(Array);
      expect(scene.visionDialog.group.length).toBeGreaterThan(0);
      expect(scene.visionDialog.onConfirm).toBe(onConfirm);
      expect(scene.visionDialog.onCancel).toBe(onCancel);
      expect(scene.visionDialog.prevState).toBe('PLAYER_IDLE');
    });

    it('showDialog sets battleState to PAUSED', () => {
      controller.showDialog({
        title: 'T',
        body: 'B',
        confirmLabel: 'Y',
        cancelLabel: 'N',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(scene.battleState).toBe('PAUSED');
    });

    it('showDialog pins group to screen', () => {
      controller.showDialog({
        title: 'T',
        body: 'B',
        confirmLabel: 'Y',
        cancelLabel: 'N',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(scene._pinToScreen).toHaveBeenCalledWith(scene.visionDialog.group);
    });

    it('showDialog closes existing dialog first', () => {
      const firstGroup = [makeDisplayObject()];
      scene.visionDialog = {
        group: firstGroup,
        prevState: 'PLAYER_IDLE',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };
      controller.showDialog({
        title: 'New',
        body: 'New body',
        confirmLabel: 'Y',
        cancelLabel: 'N',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(firstGroup[0].destroy).toHaveBeenCalled();
    });

    it('confirmDialog calls onConfirm callback', () => {
      const onConfirm = vi.fn();
      scene.visionDialog = {
        group: [makeDisplayObject()],
        prevState: 'PLAYER_IDLE',
        onConfirm,
        onCancel: vi.fn(),
      };
      controller.confirmDialog();
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(scene.visionDialog).toBeNull();
    });

    it('cancelDialog calls onCancel callback', () => {
      const onCancel = vi.fn();
      scene.visionDialog = {
        group: [makeDisplayObject()],
        prevState: 'PLAYER_IDLE',
        onConfirm: vi.fn(),
        onCancel,
      };
      controller.cancelDialog();
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(scene.visionDialog).toBeNull();
    });

    it('closeDialog destroys group objects and nulls visionDialog', () => {
      const obj = makeDisplayObject();
      scene.visionDialog = {
        group: [obj],
        prevState: 'UNIT_SELECTED',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };
      controller.closeDialog();
      expect(obj.destroy).toHaveBeenCalled();
      expect(scene.visionDialog).toBeNull();
    });

    it('closeDialog restores prevState from dialog', () => {
      scene.battleState = 'PAUSED';
      scene.visionDialog = {
        group: [makeDisplayObject()],
        prevState: 'UNIT_SELECTED',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };
      controller.closeDialog();
      expect(scene.battleState).toBe('UNIT_SELECTED');
    });

    it('showDialog captures battleState before overwriting and closeDialog restores it', () => {
      scene.battleState = 'UNIT_SELECTED';
      controller.showDialog({
        title: 'Test',
        body: 'body',
        confirmLabel: 'Yes',
        cancelLabel: 'No',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      });
      expect(scene.battleState).toBe('PAUSED');
      expect(scene.visionDialog.prevState).toBe('UNIT_SELECTED');
      controller.closeDialog();
      expect(scene.battleState).toBe('UNIT_SELECTED');
    });

    it('closeDialog is idempotent (no-op when no dialog)', () => {
      scene.visionDialog = null;
      expect(() => controller.closeDialog()).not.toThrow();
    });

    it('closeDialog calls refreshEndTurnControl', () => {
      scene.visionDialog = {
        group: [makeDisplayObject()],
        prevState: 'PLAYER_IDLE',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      };
      controller.closeDialog();
      expect(scene.refreshEndTurnControl).toHaveBeenCalled();
    });

    it('confirmDialog is no-op when no dialog open', () => {
      scene.visionDialog = null;
      expect(() => controller.confirmDialog()).not.toThrow();
    });

    it('cancelDialog is no-op when no dialog open', () => {
      scene.visionDialog = null;
      expect(() => controller.cancelDialog()).not.toThrow();
    });
  });

  // ── requestRewind ───────────────────────────────────────

  describe('requestRewind', () => {
    beforeEach(() => {
      scene.turnManager.currentPhase = 'player';
      scene.battleState = 'PLAYER_IDLE';
      scene.visionSnapshot = { id: 'snap' };
      runManager.visionChargesRemaining = 2;
    });

    it('returns true and creates dialog when conditions met', () => {
      const result = controller.requestRewind();
      expect(result).toBe(true);
      expect(scene.visionDialog).not.toBeNull();
    });

    it('returns false when story input locked', () => {
      scene.isStoryInputLocked = vi.fn(() => true);
      expect(controller.requestRewind()).toBe(false);
      expect(scene.visionDialog).toBeNull();
    });

    it('returns false when canUseNow fails (no force)', () => {
      scene.battleState = 'ENEMY_ACTING';
      expect(controller.requestRewind()).toBe(false);
    });

    it('bypasses canUseNow with force=true', () => {
      scene.battleState = 'ENEMY_ACTING';
      const result = controller.requestRewind({ force: true });
      expect(result).toBe(true);
    });

    it('returns false when no snapshot', () => {
      scene.visionSnapshot = null;
      expect(controller.requestRewind()).toBe(false);
    });

    it('returns false when no charges', () => {
      runManager.visionChargesRemaining = 0;
      expect(controller.requestRewind()).toBe(false);
    });
  });

  // ── showLordDeathPrompt ─────────────────────────────────

  describe('showLordDeathPrompt', () => {
    it('returns true and shows dialog when charges available', () => {
      scene.visionSnapshot = { id: 'snap' };
      runManager.visionChargesRemaining = 1;
      const result = controller.showLordDeathPrompt();
      expect(result).toBe(true);
      expect(scene.visionDialog).not.toBeNull();
    });

    it('returns false when no charges', () => {
      scene.visionSnapshot = { id: 'snap' };
      runManager.visionChargesRemaining = 0;
      expect(controller.showLordDeathPrompt()).toBe(false);
    });

    it('returns false when no snapshot', () => {
      scene.visionSnapshot = null;
      runManager.visionChargesRemaining = 1;
      expect(controller.showLordDeathPrompt()).toBe(false);
    });
  });

  // ── executeRewind ───────────────────────────────────────

  describe('executeRewind', () => {
    beforeEach(() => {
      scene.playerUnits = [{ name: 'A', stats: {}, currentHP: 10, skills: [], col: 0, row: 0 }];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.visionSnapshot = {
        playerUnits: [{ name: 'A', stats: {}, currentHP: 20, skills: [], col: 0, row: 0 }],
        enemyUnits: [],
        npcUnits: [],
        turnNumber: 1,
        phase: 'player',
        antiTurtleState: {},
        rngSeed: 42,
        fog: null,
        ballistas: [],
        zombieTombstones: [],
      };
      runManager.visionChargesRemaining = 2;
      runManager.visionCount = 0;
    });

    it('decrements charges and increments count', () => {
      controller.executeRewind();
      expect(runManager.visionChargesRemaining).toBe(1);
      expect(runManager.visionCount).toBe(1);
    });

    it('clears pendingVisionSnapshot', () => {
      scene.pendingVisionSnapshot = { id: 'pending' };
      controller.executeRewind();
      expect(scene.pendingVisionSnapshot).toBeNull();
    });

    it('returns true on success', () => {
      expect(controller.executeRewind()).toBe(true);
    });

    it('returns false when no snapshot', () => {
      scene.visionSnapshot = null;
      expect(controller.executeRewind()).toBe(false);
    });

    it('returns false when no runManager', () => {
      const ctrl = new VisionRewindController(scene, null);
      expect(ctrl.executeRewind()).toBe(false);
    });

    it('returns false when no charges remaining', () => {
      runManager.visionChargesRemaining = 0;
      expect(controller.executeRewind()).toBe(false);
    });

    it('routes through scene.applyVisionSnapshot', () => {
      scene.applyVisionSnapshot = vi.fn(() => true);
      controller.executeRewind();
      expect(scene.applyVisionSnapshot).toHaveBeenCalledTimes(1);
    });
  });

  // ── _applySnapshot ──────────────────────────────────────

  describe('_applySnapshot', () => {
    it('returns false if no snapshot', () => {
      scene.visionSnapshot = null;
      expect(controller._applySnapshot()).toBe(false);
    });

    it('restores unit positions via removeUnitGraphic/addUnitGraphic', () => {
      const oldUnit = { name: 'Old' };
      scene.playerUnits = [oldUnit];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.visionSnapshot = {
        playerUnits: [{ name: 'Edric', col: 1, row: 2, stats: {} }],
        enemyUnits: [],
        npcUnits: [],
        turnNumber: 1,
        phase: 'player',
        antiTurtleState: {},
        rngSeed: 42,
        fog: null,
        ballistas: [],
        zombieTombstones: [],
      };
      controller._applySnapshot();
      expect(scene.removeUnitGraphic).toHaveBeenCalledWith(oldUnit);
      expect(scene.addUnitGraphic).toHaveBeenCalled();
      expect(scene.playerUnits[0].name).toBe('Edric');
    });

    it('resets selection and target state', () => {
      scene.selectedUnit = { name: 'Some' };
      scene.attackTargets = [1, 2];
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.visionSnapshot = {
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        turnNumber: 1,
        phase: 'player',
        antiTurtleState: {},
        rngSeed: 42,
        fog: null,
        ballistas: [],
        zombieTombstones: [],
      };
      controller._applySnapshot();
      expect(scene.selectedUnit).toBeNull();
      expect(scene.attackTargets).toEqual([]);
      expect(scene.healTargets).toEqual([]);
    });

    it('restores fog visibility when fog enabled', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.grid.fogEnabled = true;
      scene.grid.rows = 2;
      scene.grid.cols = 2;
      const overlay00 = { setAlpha: vi.fn() };
      const overlay01 = { setAlpha: vi.fn() };
      const overlay10 = { setAlpha: vi.fn() };
      const overlay11 = { setAlpha: vi.fn() };
      scene.grid.fogOverlays = [
        [overlay00, overlay01],
        [overlay10, overlay11],
      ];
      scene.visionSnapshot = {
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        turnNumber: 1,
        phase: 'player',
        antiTurtleState: {},
        rngSeed: 42,
        fog: { visible: ['0,0'], everSeen: ['0,0', '1,0'] },
        ballistas: [],
        zombieTombstones: [],
      };
      controller._applySnapshot();
      expect(scene.grid.visibleSet.has('0,0')).toBe(true);
      expect(scene.grid.everSeenSet.has('1,0')).toBe(true);
      expect(overlay00.setAlpha).toHaveBeenCalledWith(0); // visible
      // key '1,0' = col=1,row=0 → fogOverlays[0][1] = overlay01
      expect(overlay01.setAlpha).toHaveBeenCalledWith(0.3); // ever seen only
      expect(scene.updateEnemyVisibility).toHaveBeenCalled();
    });

    it('sets battleState to PLAYER_IDLE', () => {
      scene.battleState = 'ENEMY_PHASE';
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.visionSnapshot = {
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        turnNumber: 1,
        phase: 'player',
        antiTurtleState: {},
        rngSeed: 42,
        fog: null,
        ballistas: [],
        zombieTombstones: [],
      };
      controller._applySnapshot();
      expect(scene.battleState).toBe('PLAYER_IDLE');
    });

    it('restores turnPar from snapshot on rewind', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.turnPar = 12; // bumped by reinforcements
      scene.visionSnapshot = {
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        turnNumber: 1,
        phase: 'player',
        turnPar: 8, // original par before reinforcements
        antiTurtleState: {},
        rngSeed: 42,
        fog: null,
        ballistas: [],
        zombieTombstones: [],
      };
      controller._applySnapshot();
      expect(scene.turnPar).toBe(8);
    });

    it('preserves turnPar when snapshot has no turnPar (legacy fallback)', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.turnPar = 10;
      scene.visionSnapshot = {
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        turnNumber: 1,
        phase: 'player',
        // no turnPar field — legacy snapshot
        antiTurtleState: {},
        rngSeed: 42,
        fog: null,
        ballistas: [],
        zombieTombstones: [],
      };
      controller._applySnapshot();
      expect(scene.turnPar).toBe(10); // preserved via 'in' fallback
    });

    it('restores explicit null turnPar from snapshot', () => {
      scene.playerUnits = [];
      scene.enemyUnits = [];
      scene.npcUnits = [];
      scene.turnPar = 5; // current value
      scene.visionSnapshot = {
        playerUnits: [],
        enemyUnits: [],
        npcUnits: [],
        turnNumber: 1,
        phase: 'player',
        turnPar: null, // explicit null (unknown-objective battle)
        antiTurtleState: {},
        rngSeed: 42,
        fog: null,
        ballistas: [],
        zombieTombstones: [],
      };
      controller._applySnapshot();
      expect(scene.turnPar).toBeNull(); // null restored, not 5
    });
  });

  // ── updateHud ───────────────────────────────────────────

  describe('updateHud', () => {
    it('sets text with charge count', () => {
      scene.visionHudText = makeDisplayObject({ text: '' });
      runManager.visionChargesRemaining = 3;
      controller.updateHud();
      expect(scene.visionHudText.text).toBe('Eye: 3 (rewind current turn)');
    });

    it('sets cyan color when charges > 0', () => {
      scene.visionHudText = makeDisplayObject({ text: '' });
      runManager.visionChargesRemaining = 1;
      controller.updateHud();
      expect(scene.visionHudText._color).toBe('#9ed8ff');
    });

    it('sets gray color when charges = 0', () => {
      scene.visionHudText = makeDisplayObject({ text: '' });
      runManager.visionChargesRemaining = 0;
      controller.updateHud();
      expect(scene.visionHudText._color).toBe('#777777');
    });

    it('calls updateTopLeftHudLayout', () => {
      scene.visionHudText = makeDisplayObject({ text: '' });
      controller.updateHud();
      expect(scene.updateTopLeftHudLayout).toHaveBeenCalled();
    });

    it('no-ops when visionHudText is null', () => {
      scene.visionHudText = null;
      expect(() => controller.updateHud()).not.toThrow();
    });
  });

  // ── playRewindEffect ────────────────────────────────────

  describe('playRewindEffect', () => {
    it('creates flash rectangle and tween', () => {
      controller.playRewindEffect();
      expect(scene._pinToScreen).toHaveBeenCalled();
      expect(scene.tweens.add).toHaveBeenCalledWith(
        expect.objectContaining({
          alpha: 0.22,
          duration: 140,
          yoyo: true,
        }),
      );
    });
  });

  // ── Right-click guard in showDialog ─────────────────────

  describe('button pointer guard', () => {
    it('right-click on button does nothing', () => {
      const onConfirm = vi.fn();
      controller.showDialog({
        title: 'T',
        body: 'B',
        confirmLabel: 'OK',
        cancelLabel: 'No',
        onConfirm,
        onCancel: vi.fn(),
      });
      // Find buttons in the group (interactive text objects)
      const buttons = scene.visionDialog.group.filter(
        (obj) => obj.interactive && obj.handlers?.pointerdown,
      );
      expect(buttons.length).toBe(2);

      // Right-click (button !== 0) should not fire callback
      buttons[0].handlers.pointerdown({ button: 2 });
      expect(scene._uiClickBlocked).toBe(false);
    });

    it('left-click on confirm button sets _uiClickBlocked', () => {
      controller.showDialog({
        title: 'T',
        body: 'B',
        confirmLabel: 'OK',
        cancelLabel: 'No',
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
      });
      const buttons = scene.visionDialog.group.filter(
        (obj) => obj.interactive && obj.handlers?.pointerdown,
      );

      // Need to set up visionDialog for confirmDialog to work
      buttons[0].handlers.pointerdown({ button: 0 });
      expect(scene._uiClickBlocked).toBe(true);
    });
  });
});
