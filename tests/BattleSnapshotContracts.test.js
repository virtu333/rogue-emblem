import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import { BattleScene, resetUnitForBattle } from '../src/scenes/BattleScene.js';
import { VisionRewindController } from '../src/ui/VisionRewindController.js';
import { BattleSuspendController } from '../src/ui/BattleSuspendController.js';
import { BattleTradeMenu } from '../src/ui/BattleTradeMenu.js';
import { InputController } from '../src/ui/InputController.js';
import { VillageController } from '../src/ui/VillageController.js';
import { Grid } from '../src/engine/Grid.js';
import { addToInventory, removeFromInventory } from '../src/engine/UnitManager.js';
import { canCounter } from '../src/engine/Combat.js';
import { applyCondition } from '../src/engine/StatusConditionSystem.js';
import skills from '../data/skills.json';

const json = (value) => JSON.parse(JSON.stringify(value));
function unit(name = 'Rider', faction = 'player') {
  const sword = {
    uid: `${name}-sword`,
    name: 'Iron Sword',
    type: 'Sword',
    rankRequired: 'Prof',
    range: '1',
  };
  return {
    name,
    faction,
    col: 1,
    row: 1,
    mov: 5,
    moveType: 'Infantry',
    stats: { HP: 20, MOV: 5 },
    currentHP: 20,
    skills: [],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    weapon: sword,
    inventory: [sword],
    consumables: [],
    hasActed: false,
    hasMoved: false,
  };
}
function scene() {
  const s = new BattleScene();
  const grid = Object.create(Grid.prototype);
  Object.assign(grid, {
    cols: 4,
    rows: 4,
    mapLayout: Array.from({ length: 4 }, () => [0, 0, 0, 0]),
    terrainData: [
      { name: 'Plain', moveCost: { Infantry: 1 } },
      { name: 'Wall', moveCost: { Infantry: '--' } },
    ],
    temporaryTerrains: [],
    fogEnabled: false,
    _rerenderTile: vi.fn(),
    clearHighlights: vi.fn(),
    clearAttackHighlights: vi.fn(),
    clearPath: vi.fn(),
    getMovementRange: vi.fn(() => new Map()),
    snapshotFogState: vi.fn(),
    gridToPixel: (col, row) => ({ x: col * 16, y: row * 16 }),
    reconstructIcePath: vi.fn(() => [
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ]),
  });
  Object.assign(s, {
    playerUnits: [unit()],
    enemyUnits: [unit('Waller', 'enemy')],
    npcUnits: [],
    escapedUnits: [],
    grid,
    gameData: { skills: [], affixes: [], consumables: [], lootTables: {} },
    runManager: {
      battleInProgress: {},
      rngSeed: 1,
      visionCount: 0,
      visionChargesRemaining: 2,
      setBattleCheckpoint(cp) {
        this.battleInProgress.checkpoint = json(cp);
      },
    },
    turnManager: { currentPhase: 'player', turnNumber: 2, unitActed: vi.fn() },
    battleState: 'PLAYER_IDLE',
    battleParams: { act: 'act1' },
    visionBaseSeed: 1,
    antiTurtleState: {},
    ballistas: [],
    _zombieTombstones: [],
    registry: { get: () => null },
    scene: { isActive: () => true },
    dangerZone: { hide: vi.fn() },
    dangerZoneStale: false,
    dangerZoneCache: new Set(['3,3']),
    inspectionPanel: { hide: vi.fn() },
    addUnitGraphic: vi.fn(),
    removeUnitGraphic: vi.fn(),
    dimUnit: vi.fn(),
    hideActionMenu: vi.fn(),
    hideForecast: vi.fn(),
    cleanupTradeUI: vi.fn(),
    _clearCombatRollSession: vi.fn(),
    _clearSelectedWeaponArt: vi.fn(),
    updateObjectiveText: vi.fn(),
    refreshEndTurnControl: vi.fn(),
    updateVisionHud: vi.fn(),
    reseedBattleRng: vi.fn(),
    _persistBattleRunState: vi.fn(),
    updateUnitPosition: vi.fn(),
    showBriefBanner: vi.fn(async () => {}),
    showActionMenu: vi.fn(function (u) {
      this.battleState = 'UNIT_ACTION_MENU';
      this.tradeMutatedThisSession = u._movementCommitted === true;
    }),
    time: { delayedCall: vi.fn() },
    tweens: { add: (config) => config.onComplete?.() },
  });
  s._visionController = new VisionRewindController(s, s.runManager);
  s._visionController.playRewindEffect = vi.fn();
  return s;
}

function restoreCheckpoint(cp) {
  const restored = scene();
  restored.playerUnits = [];
  restored.enemyUnits = [];
  restored.npcUnits = [];
  new BattleSuspendController(restored).applyUnits(json(cp));
  return restored;
}

describe('battle commitment and Canto completion contracts', () => {
  it.each([false, true])(
    'trade commitment survives submenu cancellation and reselection (mobile=%s)',
    (mobile) => {
      const s = scene();
      s.isMobileInput = mobile;
      const u = s.playerUnits[0],
        recipient = unit('Ally');
      u.hasMoved = true;
      u._movementSpent = 3;
      s.selectedUnit = u;
      s.preMoveLoc = { col: 0, row: 0 };
      const menu = Object.create(BattleTradeMenu.prototype);
      Object.assign(menu, {
        scene: s,
        left: u,
        selection: { owner: u, recipient, item: u.inventory[0], key: 'inventory', cap: 5 },
        render: vi.fn(),
        surface: { focusContent: vi.fn() },
      });
      menu.transfer();
      expect(u._movementCommitted).toBe(true);
      expect(u.inventory).toHaveLength(0);
      expect(recipient.inventory).toHaveLength(2);
      s.battleState = 'UNIT_ACTION_MENU';
      s.inEquipMenu = true;
      s.handleCancel(); // submenu -> action menu
      s.handleCancel(); // action menu -> idle
      expect(s.battleState).toBe('PLAYER_IDLE');
      s.selectUnit(u);
      expect(s.grid.getMovementRange).not.toHaveBeenCalled();
      expect(s.battleState).toBe('UNIT_ACTION_MENU');
      s.handleCancel();
      // Even stale selection input must not mint a new movement allowance.
      s.selectedUnit = u;
      s.battleState = 'UNIT_SELECTED';
      s.moveUnit = vi.fn();
      new InputController(s).handleSelectedClick({ col: 3, row: 1 });
      expect(s.moveUnit).not.toHaveBeenCalled();
      expect(u).toMatchObject({
        col: 1,
        row: 1,
        _movementSpent: 3,
        hasMoved: true,
        hasActed: false,
      });
      const restored = restoreCheckpoint(s.runManager.battleInProgress.checkpoint);
      expect(restored.playerUnits[0]._movementCommitted).toBe(true);
      resetUnitForBattle(u);
      expect(u._movementCommitted).toBe(false);
    },
  );

  it.each(['ordinary', 'canto_cancel', 'canto_same_tile', 'canto_move', 'canto_force_end'])(
    '%s visits the final village and saves before advancing, exactly once',
    (mode) => {
      const s = scene(),
        u = s.playerUnits[0];
      s._villageState = { col: mode === 'canto_move' ? 2 : 1, row: 1, status: 'intact' };
      s._villageController = new VillageController(s);
      s._villageController._resolveTile = vi.fn();
      s._villageController._showFloat = vi.fn();
      const visit = vi.spyOn(s._villageController, 'handleUnitActionEnd');
      const persist = s._persistBattleRunState;
      s.turnManager.unitActed.mockImplementation(() => {
        expect(s.runManager.battleInProgress.checkpoint.villageState.status).toBe('visited');
        expect(persist).toHaveBeenCalledOnce();
      });
      if (mode !== 'ordinary') u.skills = ['canto'];
      s.selectedUnit = u;
      s.finishUnitAction(u);
      if (mode !== 'ordinary') {
        expect(persist).not.toHaveBeenCalled();
        expect(visit).not.toHaveBeenCalled();
        if (mode === 'canto_cancel') s.handleCancel();
        else if (mode === 'canto_force_end') {
          s.canForceEndTurn = () => true;
          s.forceEndTurn();
        } else {
          s.cantoRange = new Map([['2,1', { cost: 1 }]]);
          s.handleCantoClick({ col: mode === 'canto_move' ? 2 : 1, row: 1 });
        }
      }
      expect(visit).toHaveBeenCalledOnce();
      expect(persist).toHaveBeenCalledOnce();
      expect(s.turnManager.unitActed).toHaveBeenCalledOnce();
      const cp = s.runManager.battleInProgress.checkpoint;
      const resumed = restoreCheckpoint(cp);
      expect(resumed._villageState.status).toBe('visited');
      expect(resumed.goldEarned).toBeGreaterThan(0);
      expect(resumed.playerUnits[0]).toMatchObject({
        hasActed: true,
        col: s._villageState.col,
        row: 1,
      });
    },
  );
});

describe('Vision world state and hydration', () => {
  it('save -> resume -> Vision -> equipped weapon trade removes the exact forged/art item', () => {
    const s = scene(),
      u = s.playerUnits[0];
    u.inventory.push({
      ...u.weapon,
      uid: 'second-sword',
      might: 99,
      weaponArtIds: ['sword_wrath_strike'],
    });
    u.weapon = u.inventory[1];
    s.captureVisionSnapshot();
    s._captureSuspendCheckpoint();
    const cp = json(s.runManager.battleInProgress.checkpoint);
    const resumed = restoreCheckpoint(cp);
    resumed.visionSnapshot = cp.visionSnapshot; // same nested restore as finalizeResume
    resumed._visionController._applySnapshot();
    const owner = resumed.playerUnits[0],
      recipient = unit('Recipient');
    expect(owner.weapon).toBe(owner.inventory[1]);
    const equipped = owner.weapon;
    addToInventory(recipient, equipped);
    removeFromInventory(owner, equipped);
    expect(owner.weapon).toBe(owner.inventory[0]);
    expect(owner.weapon.uid).toBe(u.inventory[0].uid);
    expect(recipient.inventory.at(-1)).toMatchObject({
      uid: 'second-sword',
      might: 99,
      weaponArtIds: ['sword_wrath_strike'],
    });
    removeFromInventory(owner, owner.inventory[0]);
    expect(owner.weapon).toBeNull();
    expect(canCounter(owner, owner.weapon, 1)).toBe(false);
  });

  it.each([false, true])(
    'rewinds walls, owner identity, hybrid changes, casualties and threat state (fog=%s)',
    (fog) => {
      const s = scene();
      s.grid.fogEnabled = fog;
      if (fog)
        Object.assign(s.grid, {
          visibleSet: new Set(['1,1']),
          everSeenSet: new Set(['1,1']),
          fogOverlays: [],
        });
      s.updateEnemyVisibility = vi.fn();
      // Duplicate enemy names cannot confuse source ownership.
      s.enemyUnits.push(unit('Waller', 'enemy'));
      const owner = s.enemyUnits[1];
      s.grid.setTemporaryTerrain(2, 2, 'Wall', 2, owner);
      s._playerDeathsThisBattle = 0;
      s.appliedHybridOverrideTurns = new Set([1]);
      s.captureVisionSnapshot();
      s.grid.clearTemporaryTerrainAt(2, 2);
      s.grid.setTerrainAt(3, 3, 1);
      s._playerDeathsThisBattle = 1;
      s.appliedHybridOverrideTurns.add(2);
      s._visionController._applySnapshot();
      expect(s.grid.mapLayout[2][2]).toBe(1);
      expect(s.grid.mapLayout[3][3]).toBe(0);
      expect(s.grid.temporaryTerrains[0]).toMatchObject({
        remainingTurns: 2,
        sourceUnit: s.enemyUnits[1],
      });
      expect(s.grid.temporaryTerrains[0].sourceUnit).not.toBe(owner);
      expect(s._playerDeathsThisBattle).toBe(0);
      expect([...s.appliedHybridOverrideTurns]).toEqual([1]);
      expect(s.dangerZoneStale).toBe(true);
      expect(s.dangerZoneCache).toBeNull();
      expect(s.dangerZone.hide).toHaveBeenCalled();
      expect(s.grid.clearTemporaryTerrainsBySource(s.enemyUnits[0])).toBe(0);
      expect(s.grid.clearTemporaryTerrainsBySource(s.enemyUnits[1])).toBe(1);
      expect(s.grid.mapLayout[2][2]).toBe(0);
    },
  );

  it('suspend JSON preserves temporary terrain lifetime and owner references', () => {
    const s = scene();
    s.grid.setTemporaryTerrain(2, 2, 'Wall', 2, s.enemyUnits[0]);
    s._captureSuspendCheckpoint();
    const restored = restoreCheckpoint(s.runManager.battleInProgress.checkpoint);
    expect(restored.grid.mapLayout[2][2]).toBe(1);
    expect(restored.grid.temporaryTerrains[0].sourceUnit).toBe(restored.enemyUnits[0]);
    restored.grid.tickTemporaryTerrains();
    expect(restored.grid.mapLayout[2][2]).toBe(1);
    restored.grid.tickTemporaryTerrains();
    expect(restored.grid.mapLayout[2][2]).toBe(0);
  });

  it('accepts old Vision snapshots without terrain/casualty fields', () => {
    const s = scene();
    s.captureVisionSnapshot();
    for (const key of [
      'mapLayout',
      'temporaryTerrains',
      'playerDeathsThisBattle',
      'appliedHybridOverrideTurns',
      'latePressureWarningShown',
    ])
      delete s.visionSnapshot[key];
    expect(() => s._visionController._applySnapshot()).not.toThrow();
    expect(s.grid.mapLayout).toHaveLength(4);
  });
});

describe('Vision playable turn boundary', () => {
  it.each(['renewal', 'acid'])(
    'captures resolved %s once without replaying it on rewind',
    async (effect) => {
      const s = scene(),
        u = s.playerUnits[0];
      s.gameData.skills = skills;
      u.currentHP = 10;
      if (effect === 'renewal') u.skills = ['renewal'];
      else applyCondition(u, 'acid', 4, { recoveryChance: 0 });
      s.showPhaseBanner = vi.fn();
      s.undimUnit = vi.fn();
      s.updateHPBar = vi.fn();
      s.animateHeal = vi.fn(async () => {});
      s.showAcidDamage = vi.fn(async () => {});
      s.getTurnPressureState = () => ({ active: false });
      s._expireTimedWeaponArtBuffs = vi.fn();
      s.processBallistaFire = vi.fn(async () => {});
      const callbacks = [];
      s.time.delayedCall = (ms, cb) => {
        callbacks.push({ ms, cb });
        return {};
      };
      // Preserve last turn's snapshot until this playable turn commits an action.
      s.captureVisionSnapshot();
      const previous = s.visionSnapshot;
      s.turnManager.turnNumber = 3;
      s.onPhaseChange('player', 3);
      expect(s.pendingVisionSnapshot).toBeNull();
      await callbacks.find((entry) => entry.ms === 1200).cb();
      const hp = u.currentHP;
      expect(hp === 10).toBe(false);
      expect(s.pendingVisionSnapshot.playerUnits[0].currentHP).toBe(hp);
      expect(s.visionSnapshot).toBe(previous);
      s.commitVisionSnapshotIfPending();
      u.currentHP = 1;
      s._visionController._applySnapshot();
      expect(s.playerUnits[0].currentHP).toBe(hp);
      expect(s.battleState).toBe('PLAYER_IDLE');
      expect(s.processBallistaFire).toHaveBeenCalledOnce();
      expect(effect === 'renewal' ? s.animateHeal : s.showAcidDamage).toHaveBeenCalledOnce();
      // Only one scheduled effect pipeline; applying Vision consumes no extra effect RNG.
      expect(callbacks.filter((entry) => entry.ms === 1200)).toHaveLength(1);
    },
  );
});

describe('deed progress (Deeds & Epithets)', () => {
  const crit = { type: 'strike', attackerSide: 'attacker', miss: false, isCrit: true, damage: 4 };
  it('rolls back with a Vision rewind and survives a suspend/resume', async () => {
    const { recordCombat, recordKill } = await import('../src/engine/DeedSystem.js');
    const s = scene();
    const [hero] = s.playerUnits;
    const [foe] = s.enemyUnits;
    recordCombat({ events: [crit] }, hero, foe, { phase: 'player' });
    recordKill(unit('Mira'), foe, {});
    s.captureVisionSnapshot();
    recordCombat({ events: [crit, crit] }, hero, foe, { phase: 'player' });
    recordKill(foe, hero, { terrain: 'Plain' });
    expect(hero._battleDeeds).toMatchObject({ crits: 3, kills: 1, avenged: 1 });
    s._visionController._applySnapshot();
    expect(s.playerUnits[0]._battleDeeds).toMatchObject({ crits: 1, kills: 0, avenged: 0 });
    expect(s.enemyUnits[0]._slewAllies).toEqual(['Mira']);

    recordCombat({ events: [crit] }, s.playerUnits[0], s.enemyUnits[0], { phase: 'player' });
    s._captureSuspendCheckpoint();
    const resumed = restoreCheckpoint(s.runManager.battleInProgress.checkpoint);
    expect(resumed.playerUnits[0]._battleDeeds).toMatchObject({ crits: 2 });
    expect(resumed.enemyUnits[0]._slewAllies).toEqual(['Mira']);
  });
});
