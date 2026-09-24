import { createBattleRng } from '../../src/engine/BattleRng.js';
import { registerBattleEntity } from '../../src/engine/BattleEntityIdentity.js';
// Rendering-only fixture; production XP/checkpoint/restore/continuation methods remain real.
import { BattleScene } from '../../src/scenes/BattleScene.js';
export function journeyBattleScene(run, data) {
  const scene = new BattleScene();
  const noop = () => {};
  const grid = {
    rows: 4,
    cols: 4,
    mapLayout: Array.from({ length: 4 }, () => [0, 0, 0, 0]),
    temporaryTerrains: [],
    fogEnabled: true,
    visibleSet: new Set(['1,1']),
    everSeenSet: new Set(['1,1', '2,1']),
    fogOverlays: [],
    isVisible(col, row) {
      return this.visibleSet.has(`${col},${row}`);
    },
    setTerrainAt(col, row, value) {
      this.mapLayout[row][col] = value;
    },
    gridToPixel: () => ({ x: 0, y: 0 }),
    clearAttackHighlights: noop,
    clearHighlights: noop,
    clearPath: noop,
  };
  Object.assign(scene, {
    runManager: run,
    gameData: data,
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    battleState: 'PLAYER_IDLE',
    battleParams: {},
    grid,
    visionBaseSeed: 42,
    _battleRewindPolicy: run.battleInProgress?.rewindPolicy || 'legacy-v1',
    _battleRng: createBattleRng(42),
    registry: { get: (key) => (key === 'activeSlot' ? 1 : null) },
    turnManager: {
      currentPhase: 'player',
      turnNumber: 1,
      // Plain counters avoid registering two long-lived Vitest mocks for every
      // restored scene in a soak; retaining call arguments would pin whole units.
      unitActedCalls: 0,
      endPlayerPhaseCalls: 0,
      unitActed() {
        this.unitActedCalls++;
      },
      endPlayerPhase() {
        this.endPlayerPhaseCalls++;
      },
    },
    add: {
      text: () => ({
        setOrigin() {
          return this;
        },
        setDepth() {
          return this;
        },
        destroy: noop,
      }),
    },
    tweens: { add: noop },
    reseedBattleRng: (seed, state) => {
      scene.lastSeed = seed;
      scene._battleRng = createBattleRng(seed, state);
    },
    addUnitGraphic: (unit) => registerBattleEntity(scene, unit),
    removeUnitGraphic: noop,
    dimUnit: noop,
    updateHPBar: noop,
    _playLevelUpSfx: noop,
    _stopLevelUpSfx: noop,
    checkBattleEnd: () => false,
    _clearCombatRollSession: noop,
    hideActionMenu: noop,
    _clearSelectedWeaponArt: noop,
    updateEnemyVisibility: noop,
    updateObjectiveText: noop,
    updateVisionHud: noop,
    refreshEndTurnControl: noop,
    hideForecast: noop,
    cleanupTradeUI: noop,
  });
  return scene;
}
