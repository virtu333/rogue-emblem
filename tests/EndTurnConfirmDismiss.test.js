import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

// The phone's end-turn confirm (End turn… with units still to act) offers "Show <unit>" and
// "End turn now" and no Keep playing button. It must never be a trap: Back, Escape, a tap off
// the map and a tap on the board each close it without ending the turn, and Back never opens
// Pause while it is up.
const { BattleScene } = await import('../src/scenes/BattleScene.js');
const { InputController } = await import('../src/ui/InputController.js');
const { MobileBattleHUD } = await import('../src/ui/MobileBattleHUD.js');

function hudWithPending() {
  const hud = Object.create(MobileBattleHUD.prototype);
  hud.endTurnPending = { state: 'PLAYER_IDLE', turn: 1 };
  hud.lastSnapshot = 'stale';
  hud.sync = vi.fn();
  return hud;
}

function idleScene(hud) {
  return {
    isStoryInputLocked: () => false,
    _isPrologueGateActive: () => false,
    isDevToolsEnabled: () => false,
    isMobileInput: true,
    inspectMode: false,
    battleState: 'PLAYER_IDLE',
    visionDialog: null,
    unitDetailOverlay: null,
    inspectionPanel: { visible: false, hide: vi.fn() },
    pauseOverlay: null,
    lootRosterVisible: false,
    lootGroup: [],
    debugOverlay: null,
    selectedUnit: null,
    forceEndTurn: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    showPauseMenu: vi.fn(),
    handleCancel: vi.fn(),
    clearInspectionVisuals: vi.fn(),
    _mobileBattleHud: hud,
    canRequestCancel(opts) {
      return BattleScene.prototype.canRequestCancel.call(this, opts);
    },
    isCancelableBattleState() {
      return BattleScene.prototype.isCancelableBattleState.call(this);
    },
    requestCancel(opts) {
      return BattleScene.prototype.requestCancel.call(this, opts);
    },
  };
}

describe('end-turn confirm dismissal', () => {
  it('cancelEndTurn closes a pending confirm and re-renders the rail', () => {
    const hud = hudWithPending();
    expect(hud.cancelEndTurn()).toBe(true);
    expect(hud.endTurnPending).toBeNull();
    expect(hud.lastSnapshot).toBe('');
    expect(hud.sync).toHaveBeenCalledTimes(1);
    // nothing left to close
    expect(hud.cancelEndTurn()).toBe(false);
    expect(hud.sync).toHaveBeenCalledTimes(1);
  });

  it('Back or Escape closes the confirm instead of opening Pause, and ends no turn', () => {
    const hud = hudWithPending();
    const scene = idleScene(hud);
    expect(scene.canRequestCancel({ allowPause: false })).toBe(true);
    expect(scene.requestCancel({ cancelAction: true })).toBe(true);
    expect(hud.endTurnPending).toBeNull();
    expect(scene.showPauseMenu).not.toHaveBeenCalled();
    expect(scene.forceEndTurn).not.toHaveBeenCalled();
    // the next Back at idle is the ordinary one again: Pause
    expect(scene.requestCancel({ cancelAction: true })).toBe(true);
    expect(scene.showPauseMenu).toHaveBeenCalledTimes(1);
  });

  it('a tap off the map closes the confirm', () => {
    const hud = hudWithPending();
    const scene = idleScene(hud);
    scene.grid = { pixelToGrid: () => null };
    const input = new InputController(scene);
    input._screenToWorld = (x, y) => ({ x, y });
    input._isPointerOverInteractive = () => false;
    input.onClick({ x: -10, y: -10 });
    expect(hud.endTurnPending).toBeNull();
    expect(scene.forceEndTurn).not.toHaveBeenCalled();
  });

  it('a tap on the board closes the confirm and still acts as a tap', () => {
    const hud = hudWithPending();
    const scene = idleScene(hud);
    scene.grid = { pixelToGrid: () => ({ col: 2, row: 3 }) };
    const input = new InputController(scene);
    input._screenToWorld = (x, y) => ({ x, y });
    input.refreshTileInfo = vi.fn();
    input.handleIdleClick = vi.fn();
    input.onClick({ x: 80, y: 112 });
    expect(hud.endTurnPending).toBeNull();
    expect(input.handleIdleClick).toHaveBeenCalledWith({ col: 2, row: 3 });
    expect(scene.forceEndTurn).not.toHaveBeenCalled();
  });
});
