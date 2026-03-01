// Tests for P0/P1 stability hardening (Slice 1)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- localStorage mock ---
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
  setItem: vi.fn((key, val) => {
    store[key] = String(val);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// --- Mocks ---
const mocked = vi.hoisted(() => ({
  fromMock: vi.fn(),
  reportAsyncError: vi.fn(),
  markStartup: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));
vi.mock('../src/utils/SceneRouter.js', async () => {
  const actual = await vi.importActual('../src/utils/SceneRouter.js');
  return { ...actual, transitionToScene: vi.fn(async () => true) };
});
vi.mock('../src/ui/RosterOverlay.js', () => ({
  RosterOverlay: class {
    constructor() {
      this.visible = false;
    }
    show() {
      this.visible = true;
    }
  },
}));
vi.mock('../src/cloud/supabaseClient.js', () => ({
  supabase: { from: mocked.fromMock },
}));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: mocked.reportAsyncError }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: mocked.markStartup }));

import { fetchAllToLocalStorage, __resetCloudSyncStatusForTests } from '../src/cloud/CloudSync.js';
import { BattleScene } from '../src/scenes/BattleScene.js';

// --- Helpers ---

const plainTerrain = {
  name: 'Plain',
  defenseBonus: 0,
  avoidBonus: 0,
  moveCost: { Infantry: '1', Armored: '1', Cavalry: '1', Flying: '1' },
};

function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    col: 2,
    row: 2,
    faction: 'player',
    moveType: 'Infantry',
    className: 'Myrmidon',
    level: 5,
    hasMoved: false,
    hasActed: false,
    currentHP: 25,
    weapon: {
      name: 'Iron Sword',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      range: '1',
      special: '',
    },
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    stats: { HP: 25, STR: 10, MAG: 2, SKL: 8, SPD: 9, DEF: 6, RES: 3, LCK: 5, MOV: 5 },
    accessory: null,
    graphic: { clearTint: vi.fn(), setTint: vi.fn(), setAlpha: vi.fn() },
    label: null,
    hpBar: null,
    ...overrides,
  };
}

function setupScene() {
  const scene = new BattleScene();
  scene.grid = {
    fogEnabled: false,
    getTerrainAt: vi.fn(() => plainTerrain),
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearPath: vi.fn(),
    isVisible: vi.fn(() => true),
    getMovementRange: vi.fn(() => new Map()),
    gridToPixel: () => ({ x: 64, y: 64 }),
    cols: 10,
    rows: 10,
  };
  scene.gameData = { skills: [], affixes: [], weaponArts: { arts: [] }, classes: [] };
  scene.playerUnits = [];
  scene.enemyUnits = [];
  scene.npcUnits = [];
  scene.battleParams = { tutorialMode: false };
  scene.battleState = 'PLAYER_IDLE';
  scene.selectedUnit = null;
  scene.attackTargets = [];
  scene.movementRange = null;
  scene.unitPositions = null;
  scene.turnManager = { endPlayerPhase: vi.fn(), unitActed: vi.fn(), turnNumber: 1 };
  scene.runManager = {
    getActHitBonusForUnit: vi.fn(() => 0),
    getTerrainCombatBonuses: vi.fn(() => []),
    blessingRuntimeModifiers: {},
  };
  scene.animateStrike = vi.fn(async () => {});
  scene.animateSkillActivation = vi.fn(async () => {});
  scene.updateHPBar = vi.fn();
  scene._applyResolvedCombatPostEffects = vi.fn(async () => {});
  scene._checkPhoenixBrooch = vi.fn(async () => {});
  scene._applyRecoilGuardAfterArtUse = vi.fn();
  scene.isDevToolsEnabled = () => false;
  scene.resetFortHealStreak = vi.fn();
  scene.awardXP = vi.fn(async () => {});
  scene.removeUnit = vi.fn(async () => {});
  scene.checkBattleEnd = vi.fn(() => false);
  scene.finishUnitAction = vi.fn();
  scene._clearCombatRollSession = vi.fn();
  scene._clearSelectedWeaponArt = vi.fn();
  scene._getSelectedWeaponArtForUnit = vi.fn(() => null);
  scene._selectEnemyWeaponArt = vi.fn(() => null);
  scene.registry = { get: vi.fn(() => null) };
  scene.inspectionPanel = { hide: vi.fn() };
  scene.deselectUnit = vi.fn();
  scene.dimUnit = vi.fn();
  scene.commitVisionSnapshotIfPending = vi.fn();
  scene.hideActionMenu = vi.fn();
  scene.healTargets = [];
  scene.inEquipMenu = false;
  scene.tradeMutatedThisSession = false;
  return scene;
}

function makeTableApi({ data = null, selectError = null } = {}) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(async () => {
          if (selectError) return { data: null, error: selectError };
          return { data: data == null ? null : { data }, error: null };
        }),
      })),
    })),
    upsert: vi.fn(async () => ({ error: null })),
    delete: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
  };
}

// --- Tests ---

describe('Fix 1: executeCombat error recovery', () => {
  let scene;

  beforeEach(() => {
    scene = setupScene();
  });

  it('resets battleState to PLAYER_IDLE when _runCombatResolution throws', async () => {
    const attacker = makeUnit({ faction: 'player' });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      throw new Error('test combat error');
    });

    await scene.executeCombat(attacker, defender);

    expect(scene.battleState).toBe('PLAYER_IDLE');
    expect(scene._clearCombatRollSession).toHaveBeenCalled();
    expect(scene._clearSelectedWeaponArt).toHaveBeenCalled();
    expect(scene.selectedUnit).toBeNull();
  });

  it('does not stomp BATTLE_END state on throw', async () => {
    const attacker = makeUnit({ faction: 'player' });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      throw new Error('test combat error');
    });
    // Simulate BATTLE_END already set before catch runs
    scene.battleState = 'BATTLE_END';

    // executeCombat sets COMBAT_RESOLVING first, then throws — but the catch checks current state.
    // We need to make it so the throw happens AFTER battleState is set to something,
    // and then the catch sees BATTLE_END. Let's simulate this by having _runCombatResolution
    // set BATTLE_END before throwing.
    scene._runCombatResolution = vi.fn(async () => {
      scene.battleState = 'BATTLE_END';
      throw new Error('test error after battle end');
    });

    await scene.executeCombat(attacker, defender);

    expect(scene.battleState).toBe('BATTLE_END');
    expect(scene._clearCombatRollSession).toHaveBeenCalled();
  });

  it('calls _clearCombatRollSession in finally on happy path', async () => {
    const attacker = makeUnit({ faction: 'player' });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2, currentHP: 0 });

    scene._runCombatResolution = vi.fn(async () => ({
      result: {
        defenderHP: 0,
        attackerHP: 25,
        events: [],
      },
    }));
    scene.checkBattleEnd = vi.fn(() => true);

    await scene.executeCombat(attacker, defender);

    expect(scene._clearCombatRollSession).toHaveBeenCalled();
    expect(scene._clearSelectedWeaponArt).toHaveBeenCalled();
  });
});

describe('Fix 1: executeEnemyCombat error recovery', () => {
  let scene;

  beforeEach(() => {
    scene = setupScene();
  });

  it('catches errors without propagating', async () => {
    const enemy = makeUnit({ faction: 'enemy', col: 3, row: 2 });
    const target = makeUnit({ faction: 'player' });

    scene._runCombatResolution = vi.fn(async () => {
      throw new Error('test enemy combat error');
    });

    // Should not throw
    await scene.executeEnemyCombat(enemy, target);

    expect(scene._clearCombatRollSession).toHaveBeenCalled();
  });

  it('calls _clearCombatRollSession in finally on happy path', async () => {
    const enemy = makeUnit({ faction: 'enemy', col: 3, row: 2 });
    const target = makeUnit({ faction: 'player' });

    scene._runCombatResolution = vi.fn(async () => ({
      result: {
        attackerHP: 20,
        defenderHP: 15,
        events: [],
      },
    }));

    await scene.executeEnemyCombat(enemy, target);

    expect(scene._clearCombatRollSession).toHaveBeenCalled();
  });
});

describe('Fix 2: handleSelectedClick null guard', () => {
  it('calls deselectUnit when selectedUnit is null', () => {
    const scene = setupScene();
    scene.battleState = 'UNIT_SELECTED';
    scene.selectedUnit = null;

    scene.handleSelectedClick({ col: 3, row: 3 });

    expect(scene.deselectUnit).toHaveBeenCalled();
  });
});

describe('Fix 3: CloudSync localStorage guards', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    mocked.fromMock.mockReset();
    mocked.reportAsyncError.mockReset();
    mocked.markStartup.mockReset();
    __resetCloudSyncStatusForTests();
  });

  it('applyRunSlots does not throw on QuotaExceededError', async () => {
    const quotaError = new DOMException('quota exceeded', 'QuotaExceededError');
    localStorageMock.setItem.mockImplementation(() => {
      throw quotaError;
    });

    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') {
        return makeTableApi({ data: { 1: { savedAt: Date.now() } } });
      }
      return makeTableApi();
    });

    // Should not throw
    await fetchAllToLocalStorage('user-1');
  });

  it('applyMetaSlots does not throw on QuotaExceededError', async () => {
    const quotaError = new DOMException('quota exceeded', 'QuotaExceededError');
    localStorageMock.setItem.mockImplementation(() => {
      throw quotaError;
    });

    mocked.fromMock.mockImplementation((table) => {
      if (table === 'meta_progression') {
        return makeTableApi({ data: { 1: { savedAt: Date.now() } } });
      }
      return makeTableApi();
    });

    // Should not throw
    await fetchAllToLocalStorage('user-1');
  });

  it('applySettings does not throw on QuotaExceededError', async () => {
    const quotaError = new DOMException('quota exceeded', 'QuotaExceededError');
    localStorageMock.setItem.mockImplementation(() => {
      throw quotaError;
    });

    mocked.fromMock.mockImplementation((table) => {
      if (table === 'user_settings') {
        return makeTableApi({ data: { sfxVolume: 0.5 } });
      }
      return makeTableApi();
    });

    // Should not throw
    await fetchAllToLocalStorage('user-1');
  });
});

describe('Fix 4: fetchAllToLocalStorage returns rejectedCount', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    mocked.fromMock.mockReset();
    mocked.reportAsyncError.mockReset();
    mocked.markStartup.mockReset();
    __resetCloudSyncStatusForTests();
  });

  it('returns rejectedCount 0 when all fetches succeed', async () => {
    mocked.fromMock.mockImplementation(() => makeTableApi());
    const result = await fetchAllToLocalStorage('user-1');
    expect(result).toEqual({ rejectedCount: 0 });
  });

  it('returns rejectedCount > 0 when a fetch rejects', async () => {
    mocked.fromMock.mockImplementation((table) => {
      if (table === 'run_saves') {
        return makeTableApi({ selectError: new Error('network fail') });
      }
      return makeTableApi();
    });
    const result = await fetchAllToLocalStorage('user-1');
    expect(result.rejectedCount).toBe(1);
  });
});

describe('Fix 1a: executeCombat zombie reconciliation', () => {
  let scene;

  beforeEach(() => {
    scene = setupScene();
  });

  it('removes dead defender when _runCombatResolution throws after HP applied', async () => {
    const attacker = makeUnit({ faction: 'player' });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      defender.currentHP = 0;
      throw new Error('post-effects explosion');
    });

    await scene.executeCombat(attacker, defender);

    expect(scene.removeUnit).toHaveBeenCalledWith(defender, { killer: attacker });
  });

  it('removes dead attacker when _runCombatResolution throws after HP applied', async () => {
    const attacker = makeUnit({ faction: 'player' });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      attacker.currentHP = 0;
      throw new Error('post-effects explosion');
    });

    await scene.executeCombat(attacker, defender);

    expect(scene.removeUnit).toHaveBeenCalledWith(attacker, { killer: defender });
  });

  it('calls checkBattleEnd after reconciliation', async () => {
    const attacker = makeUnit({ faction: 'player' });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      defender.currentHP = 0;
      throw new Error('mid-combat throw');
    });

    await scene.executeCombat(attacker, defender);

    expect(scene.checkBattleEnd).toHaveBeenCalled();
  });

  it('does not remove units that are still alive', async () => {
    const attacker = makeUnit({ faction: 'player', currentHP: 20 });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2, currentHP: 15 });

    scene._runCombatResolution = vi.fn(async () => {
      throw new Error('non-lethal throw');
    });

    await scene.executeCombat(attacker, defender);

    expect(scene.removeUnit).not.toHaveBeenCalled();
    expect(scene.checkBattleEnd).toHaveBeenCalled();
  });
});

describe('Fix 1a: executeEnemyCombat zombie reconciliation', () => {
  let scene;

  beforeEach(() => {
    scene = setupScene();
  });

  it('removes dead units when _runCombatResolution throws after HP applied', async () => {
    const enemy = makeUnit({ faction: 'enemy', col: 3, row: 2 });
    const target = makeUnit({ faction: 'player' });

    scene._runCombatResolution = vi.fn(async () => {
      target.currentHP = 0;
      throw new Error('enemy post-effects explosion');
    });

    await scene.executeEnemyCombat(enemy, target);

    expect(scene.removeUnit).toHaveBeenCalledWith(target, { killer: enemy });
    expect(scene.checkBattleEnd).toHaveBeenCalled();
  });
});

describe('Fix 1b: executeCombat error recovery consumes attacker action', () => {
  let scene;

  beforeEach(() => {
    scene = setupScene();
  });

  it('sets attacker.hasActed and calls turnManager.unitActed on error recovery', async () => {
    const attacker = makeUnit({ faction: 'player', currentHP: 25 });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      throw new Error('post-effects explosion');
    });

    await scene.executeCombat(attacker, defender);

    expect(attacker.hasActed).toBe(true);
    expect(scene.dimUnit).toHaveBeenCalledWith(attacker);
    expect(scene.turnManager.unitActed).toHaveBeenCalledWith(attacker);
  });

  it('does not consume action for dead attacker', async () => {
    const attacker = makeUnit({ faction: 'player' });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      attacker.currentHP = 0;
      throw new Error('attacker died');
    });

    await scene.executeCombat(attacker, defender);

    // Dead attacker should not have action consumed
    expect(scene.dimUnit).not.toHaveBeenCalled();
  });

  it('does not consume action for enemy attacker', async () => {
    const attacker = makeUnit({ faction: 'enemy', col: 3, row: 2 });
    const defender = makeUnit({ faction: 'player' });

    scene._runCombatResolution = vi.fn(async () => {
      throw new Error('enemy combat error');
    });

    await scene.executeCombat(attacker, defender);

    expect(scene.dimUnit).not.toHaveBeenCalled();
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
  });

  it('skips action consumption when BATTLE_END is set', async () => {
    const attacker = makeUnit({ faction: 'player', currentHP: 25 });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      scene.battleState = 'BATTLE_END';
      throw new Error('battle ended during error');
    });

    await scene.executeCombat(attacker, defender);

    expect(attacker.hasActed).toBe(false);
    expect(scene.dimUnit).not.toHaveBeenCalled();
  });

  it('is idempotent if hasActed already set', async () => {
    const attacker = makeUnit({ faction: 'player', currentHP: 25, hasActed: true });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });

    scene._runCombatResolution = vi.fn(async () => {
      throw new Error('second error');
    });

    await scene.executeCombat(attacker, defender);

    // Should not call dimUnit or unitActed again
    expect(scene.dimUnit).not.toHaveBeenCalled();
    expect(scene.turnManager.unitActed).not.toHaveBeenCalled();
  });

  it('does not stomp ENEMY_PHASE when unitActed triggers phase transition', async () => {
    const attacker = makeUnit({ faction: 'player', currentHP: 25 });
    const defender = makeUnit({ faction: 'enemy', col: 3, row: 2 });
    scene.playerUnits = [attacker];

    scene._runCombatResolution = vi.fn(async () => {
      throw new Error('error on last unit');
    });
    // Simulate unitActed triggering endPlayerPhase → onPhaseChange('enemy')
    scene.turnManager.unitActed = vi.fn(() => {
      scene.battleState = 'ENEMY_PHASE';
    });

    await scene.executeCombat(attacker, defender);

    expect(scene.battleState).toBe('ENEMY_PHASE');
    expect(attacker.hasActed).toBe(true);
  });
});
