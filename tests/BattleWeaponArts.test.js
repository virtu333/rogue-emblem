import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadGameData } from './testData.js';
import { calculateKillGold } from '../src/engine/LootSystem.js';

function makeArt(overrides = {}) {
  return {
    id: 'sword_precise_cut',
    name: 'Precise Cut',
    weaponType: 'Sword',
    requiredRank: 'Prof',
    hpCost: 2,
    perTurnLimit: 1,
    perMapLimit: 3,
    combatMods: { hitBonus: 20 },
    ...overrides,
  };
}

function makeUnit(overrides = {}) {
  return {
    name: 'Edric',
    currentHP: 20,
    stats: { HP: 24 },
    weapon: { type: 'Sword' },
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    ...overrides,
  };
}

function setupActionMenuHarness(scene) {
  const labels = [];
  scene._makeMenuTextButton = vi.fn((_x, _y, label) => {
    labels.push(label);
    return {
      label,
      setColor() {
        return this;
      },
      on() {
        return this;
      },
      setOrigin() {
        return this;
      },
      setDepth() {
        return this;
      },
      setInteractive() {
        return this;
      },
    };
  });
  scene._pinToScreen = vi.fn();
  scene.hideActionMenu = vi.fn(() => {
    scene.actionMenu = [];
    scene.inEquipMenu = false;
  });
  scene._clampMenuPosition = vi.fn((x, y) => ({ x, y }));
  scene.add = {
    rectangle: vi.fn(() => ({
      setDepth() {
        return this;
      },
      setStrokeStyle() {
        return this;
      },
    })),
  };
  scene.findHealTargets = vi.fn(() => []);
  scene.getActiveHealStaff = vi.fn(() => null);
  scene.findShoveTargets = vi.fn(() => []);
  scene.findPullTargets = vi.fn(() => []);
  scene.findTradeTargets = vi.fn(() => []);
  scene.findSwapTargets = vi.fn(() => []);
  scene.findDanceTargets = vi.fn(() => []);
  scene.findBreakTargets = vi.fn(() => []);
  scene.npcUnits = [];
  scene.battleConfig = {};
  return labels;
}

describe('BattleScene weapon art helpers', () => {
  it('returns full weapon art catalog without unlock gating', () => {
    const scene = new BattleScene();
    const unlocked = makeArt({ id: 'art_unlocked' });
    const locked = makeArt({ id: 'art_locked', name: 'Locked Art' });
    scene.gameData = { weaponArts: { arts: [unlocked, locked] } };

    const arts = scene._getWeaponArtCatalog();

    expect(arts).toHaveLength(2);
    expect(arts.map((a) => a.id)).toEqual(['art_unlocked', 'art_locked']);
  });

  it('does not use run unlock state when building catalog', () => {
    const scene = new BattleScene();
    scene.gameData = { weaponArts: { arts: [makeArt({ id: 'art_a' }), makeArt({ id: 'art_b' })] } };
    scene.runManager = {
      getUnlockedWeaponArtIds: () => [],
    };

    const arts = scene._getWeaponArtCatalog();

    expect(Array.isArray(arts)).toBe(true);
    expect(arts).toHaveLength(2);
  });

  it('shows weapon-bound art even when run unlock state is empty', () => {
    const scene = new BattleScene();
    const bound = makeArt({ id: 'sword_bound_art', name: 'Bound Art' });
    const unit = makeUnit({
      faction: 'player',
      weapon: { type: 'Sword', weaponArtIds: ['sword_bound_art'], weaponArtSources: ['scroll'] },
    });
    scene.gameData = { weaponArts: { arts: [bound] } };
    scene.runManager = { getUnlockedWeaponArtIds: () => [] };

    const arts = scene._getAvailableWeaponArtCatalogForUnit(unit);

    expect(arts.map((art) => art.id)).toContain('sword_bound_art');
  });

  it('does not allow enemy global fallback when weapon has no bound arts', () => {
    const scene = new BattleScene();
    const globalArt = makeArt({ id: 'enemy_global' });
    const enemy = makeUnit({
      faction: 'enemy',
      weapon: { type: 'Sword' },
    });
    scene.gameData = { weaponArts: { arts: [globalArt] } };
    scene.runManager = { getUnlockedWeaponArtIds: () => ['enemy_global'] };

    const arts = scene._getAvailableWeaponArtCatalogForUnit(enemy);

    expect(arts).toHaveLength(0);
  });

  it('returns selected weapon art when valid for the unit weapon', () => {
    const scene = new BattleScene();
    const art = makeArt();
    const unit = makeUnit({
      faction: 'player',
      weapon: { type: 'Sword', weaponArtIds: [art.id], weaponArtSources: ['scroll'] },
    });
    scene.gameData = { weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1 };

    scene._setSelectedWeaponArt(unit, art.id);
    const selected = scene._getSelectedWeaponArtForUnit(unit);

    expect(selected?.id).toBe(art.id);
  });

  it('includes distant targets when selected art grants rangeBonus', () => {
    const scene = new BattleScene();
    const art = makeArt({
      id: 'bow_curved_shot',
      name: 'Curved Shot',
      weaponType: 'Bow',
      combatMods: {
        rangeBonus: 1,
        activated: [{ id: 'weapon_art', name: 'Curved Shot' }],
      },
    });
    const bow = {
      id: 'iron_bow',
      name: 'Iron Bow',
      type: 'Bow',
      range: '2',
      rankRequired: 'Prof',
      might: 6,
      hit: 85,
      crit: 0,
      weight: 5,
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    };
    const unit = makeUnit({
      faction: 'player',
      col: 0,
      row: 0,
      weapon: bow,
      inventory: [bow],
      proficiencies: [{ type: 'Bow', rank: 'Prof' }],
    });
    const enemy = makeUnit({ name: 'Enemy', faction: 'enemy', col: 0, row: 3 });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [art] }, skills: [] };
    scene.grid = { fogEnabled: false };
    scene.enemyUnits = [enemy];
    scene.playerUnits = [unit];

    const baseTargets = scene.findAttackTargets(unit);
    expect(baseTargets).toHaveLength(0);

    scene._setSelectedWeaponArt(unit, art.id, bow);
    const selectedArt = scene._getSelectedWeaponArtForUnit(unit, { isInitiating: true });
    const artTargets = scene.findAttackTargets(unit, { weapon: bow, weaponArt: selectedArt });
    expect(artTargets).toHaveLength(1);
    expect(artTargets[0].name).toBe('Enemy');
  });

  it('rangeOverride numeric value enforces exact attack range for selected art', () => {
    const scene = new BattleScene();
    const art = makeArt({
      id: 'lance_exact_reach',
      name: 'Exact Reach',
      weaponType: 'Lance',
      requiredRank: 'Mast',
      combatMods: {
        rangeOverride: 2,
        activated: [{ id: 'weapon_art', name: 'Exact Reach' }],
      },
    });
    const lance = {
      id: 'iron_lance',
      name: 'Iron Lance',
      type: 'Lance',
      range: '1',
      rankRequired: 'Mast',
      might: 7,
      hit: 85,
      crit: 0,
      weight: 8,
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    };
    const unit = makeUnit({
      faction: 'player',
      col: 0,
      row: 0,
      weapon: lance,
      inventory: [lance],
      proficiencies: [{ type: 'Lance', rank: 'Mast' }],
    });
    const adjacent = makeUnit({ name: 'Adjacent', faction: 'enemy', col: 0, row: 1 });
    const atTwo = makeUnit({ name: 'AtTwo', faction: 'enemy', col: 0, row: 2 });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [art] }, skills: [] };
    scene.grid = { fogEnabled: false };
    scene.enemyUnits = [adjacent, atTwo];
    scene.playerUnits = [unit];

    scene._setSelectedWeaponArt(unit, art.id, lance);
    const selectedArt = scene._getSelectedWeaponArtForUnit(unit, { isInitiating: true });
    const artTargets = scene.findAttackTargets(unit, { weapon: lance, weaponArt: selectedArt });
    expect(artTargets.map((t) => t.name)).toEqual(['AtTwo']);
  });

  it('Longearche supports 1-2 range targeting when selected', () => {
    const scene = new BattleScene();
    const art = makeArt({
      id: 'lance_longearche',
      name: 'Longearche',
      weaponType: 'Lance',
      requiredRank: 'Mast',
      combatMods: {
        rangeOverride: { min: 1, max: 2 },
        activated: [{ id: 'weapon_art', name: 'Longearche' }],
      },
    });
    const lance = {
      id: 'iron_lance',
      name: 'Iron Lance',
      type: 'Lance',
      range: '1',
      rankRequired: 'Mast',
      might: 7,
      hit: 85,
      crit: 0,
      weight: 8,
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    };
    const unit = makeUnit({
      faction: 'player',
      col: 0,
      row: 0,
      weapon: lance,
      inventory: [lance],
      proficiencies: [{ type: 'Lance', rank: 'Mast' }],
    });
    const adjacent = makeUnit({ name: 'Adjacent', faction: 'enemy', col: 0, row: 1 });
    const atTwo = makeUnit({ name: 'AtTwo', faction: 'enemy', col: 0, row: 2 });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [art] }, skills: [] };
    scene.grid = { fogEnabled: false };
    scene.enemyUnits = [adjacent, atTwo];
    scene.playerUnits = [unit];

    scene._setSelectedWeaponArt(unit, art.id, lance);
    const selectedArt = scene._getSelectedWeaponArtForUnit(unit, { isInitiating: true });
    const artTargets = scene.findAttackTargets(unit, { weapon: lance, weaponArt: selectedArt });
    expect(artTargets.map((t) => t.name)).toEqual(['Adjacent', 'AtTwo']);
  });

  it('showActionMenu shows Weapon Art when only art-modified range can target', () => {
    const scene = new BattleScene();
    const art = makeArt({
      id: 'bow_curved_shot',
      name: 'Curved Shot',
      weaponType: 'Bow',
      combatMods: {
        rangeBonus: 1,
        activated: [{ id: 'weapon_art', name: 'Curved Shot' }],
      },
    });
    const bow = {
      id: 'iron_bow',
      name: 'Iron Bow',
      type: 'Bow',
      range: '2',
      rankRequired: 'Prof',
      might: 6,
      hit: 85,
      crit: 0,
      weight: 5,
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    };
    const unit = makeUnit({
      faction: 'player',
      col: 0,
      row: 0,
      weapon: bow,
      inventory: [bow],
      proficiencies: [{ type: 'Bow', rank: 'Prof' }],
      skills: [],
      consumables: [],
    });
    const enemy = makeUnit({ name: 'Enemy', faction: 'enemy', col: 0, row: 3 });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [art] }, skills: [], classes: [], lords: [] };
    scene.grid = {
      fogEnabled: false,
      cols: 10,
      gridToPixel: vi.fn(() => ({ x: 120, y: 120 })),
    };
    scene.enemyUnits = [enemy];
    scene.playerUnits = [unit];
    const labels = setupActionMenuHarness(scene);

    scene.showActionMenu(unit);

    expect(labels).toContain('Weapon Art');
    expect(labels).not.toContain('Attack');
  });

  it('showActionMenu hides Weapon Art when no art has valid targets', () => {
    const scene = new BattleScene();
    const art = makeArt({
      id: 'bow_curved_shot',
      name: 'Curved Shot',
      weaponType: 'Bow',
      combatMods: {
        rangeBonus: 1,
        activated: [{ id: 'weapon_art', name: 'Curved Shot' }],
      },
    });
    const bow = {
      id: 'iron_bow',
      name: 'Iron Bow',
      type: 'Bow',
      range: '2',
      rankRequired: 'Prof',
      might: 6,
      hit: 85,
      crit: 0,
      weight: 5,
      weaponArtIds: [art.id],
      weaponArtSources: ['scroll'],
    };
    const unit = makeUnit({
      faction: 'player',
      col: 0,
      row: 0,
      weapon: bow,
      inventory: [bow],
      proficiencies: [{ type: 'Bow', rank: 'Prof' }],
      skills: [],
      consumables: [],
    });
    const enemy = makeUnit({ name: 'Enemy', faction: 'enemy', col: 0, row: 4 });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [art] }, skills: [], classes: [], lords: [] };
    scene.grid = {
      fogEnabled: false,
      cols: 10,
      gridToPixel: vi.fn(() => ({ x: 120, y: 120 })),
    };
    scene.enemyUnits = [enemy];
    scene.playerUnits = [unit];
    const labels = setupActionMenuHarness(scene);

    scene.showActionMenu(unit);

    expect(labels).not.toContain('Weapon Art');
    expect(labels).not.toContain('Attack');
    expect(labels).toContain('Wait');
  });

  it('resolves selected art to the exact inventory weapon instance when duplicates exist', () => {
    const scene = new BattleScene();
    const art = makeArt({ id: 'shared_art' });
    const firstWeapon = {
      id: 'iron_sword',
      name: 'Iron Sword',
      type: 'Sword',
      rankRequired: 'Prof',
      weaponArtIds: ['shared_art'],
      weaponArtSources: ['scroll'],
    };
    const secondWeapon = {
      id: 'steel_sword',
      name: 'Steel Sword',
      type: 'Sword',
      rankRequired: 'Prof',
      weaponArtIds: ['shared_art'],
      weaponArtSources: ['scroll'],
    };
    const unit = makeUnit({
      faction: 'player',
      inventory: [firstWeapon, secondWeapon],
      weapon: firstWeapon,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    });
    scene.gameData = { weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1 };

    scene._setSelectedWeaponArt(unit, art.id, secondWeapon);
    const selected = scene._getSelectedWeaponArtForUnit(unit);

    expect(selected?.id).toBe('shared_art');
    expect(unit.weapon).toBe(secondWeapon);
  });

  it('clears selected weapon art when weapon becomes incompatible', () => {
    const scene = new BattleScene();
    const art = makeArt();
    const unit = makeUnit();
    scene.gameData = { weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1 };

    scene._setSelectedWeaponArt(unit, art.id);
    unit.weapon = { type: 'Lance' };
    scene._clearSelectedWeaponArtIfInvalid(unit);

    expect(scene._selectedWeaponArt).toBeNull();
  });

  it('marks art unavailable when per-turn limit is reached', () => {
    const scene = new BattleScene();
    const art = makeArt({ perTurnLimit: 1 });
    const unit = makeUnit({
      faction: 'player',
      weapon: { type: 'Sword', weaponArtIds: [art.id], weaponArtSources: ['scroll'] },
      _battleWeaponArtUsage: {
        map: { [art.id]: 0 },
        turn: { [art.id]: 1 },
        turnKey: '1',
      },
    });
    scene.gameData = { weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1 };

    const choices = scene._getWeaponArtChoices(unit, unit.weapon);

    expect(choices).toHaveLength(1);
    expect(choices[0].canUse).toBe(false);
    expect(choices[0].reason).toBe('per_turn_limit');
  });

  it('fails closed on invalid weaponArtId without throwing', () => {
    const scene = new BattleScene();
    const art = makeArt({ id: 'valid_art' });
    const unit = makeUnit({
      faction: 'player',
      weapon: { type: 'Sword', weaponArtIds: ['invalid_art_id'], weaponArtSources: ['scroll'] },
    });
    scene.gameData = { weaponArts: { arts: [art] } };
    scene.runManager = { getUnlockedWeaponArtIds: () => ['valid_art'] };

    expect(() => scene._getWeaponArtChoices(unit, unit.weapon)).not.toThrow();
    expect(scene._getWeaponArtChoices(unit, unit.weapon)).toHaveLength(0);
  });

  it('returns readable reason for initiation-only arts', () => {
    const scene = new BattleScene();
    expect(scene._weaponArtReasonLabel('initiation_only')).toBe('Player phase only');
  });

  it('renders status preview with HP-after-cost and usage counters', () => {
    const scene = new BattleScene();
    const art = makeArt({ hpCost: 3, perTurnLimit: 2, perMapLimit: 4 });
    const unit = makeUnit({
      currentHP: 18,
      _battleWeaponArtUsage: {
        map: { [art.id]: 1 },
        turn: { [art.id]: 1 },
        turnKey: '2',
      },
    });
    scene.turnManager = { turnNumber: 2 };

    const text = scene._getWeaponArtStatusLine(unit, art, { canUse: true, reason: null });

    expect(text).toContain('HP-3 (18->15)');
    expect(text).toContain('Turn 1/2');
    expect(text).toContain('Map 1/4');
  });

  it('renders reduced HP cost in status preview when Blood Gem applies', () => {
    const scene = new BattleScene();
    const art = makeArt({ hpCost: 3, perTurnLimit: 1, perMapLimit: 2 });
    const unit = makeUnit({
      currentHP: 18,
      accessory: { combatEffects: { weaponArtHpCostReduction: 5 } },
      _battleWeaponArtUsage: {
        map: { [art.id]: 0 },
        turn: { [art.id]: 0 },
        turnKey: '3',
      },
    });
    scene.turnManager = { turnNumber: 3 };

    const text = scene._getWeaponArtStatusLine(unit, art, { canUse: true, reason: null });
    expect(text).toContain('HP-1 (base 3) (18->17)');
  });

  it('caches gambler roll per combat session for deterministic forecast/resolve usage', () => {
    const scene = new BattleScene();
    scene.turnManager = { turnNumber: 5, currentPhase: 'player' };
    const attacker = makeUnit({
      name: 'Attacker',
      col: 0,
      row: 0,
      accessory: {
        combatEffects: {
          gambler: { winChance: 0.5, winAtkBonus: 5, lossAtkPenalty: 3 },
        },
      },
    });
    const defender = makeUnit({ name: 'Defender', col: 1, row: 0 });
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const session = scene._ensureCombatRollSession(attacker, defender);
      const first = scene._getGamblerAtkDelta(attacker, session);
      const second = scene._getGamblerAtkDelta(attacker, session);
      expect(first).toBe(-3);
      expect(second).toBe(-3);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('applies bounty bonus as flat +500g without multipliers', () => {
    const scene = new BattleScene();
    scene.runManager = {};
    scene.goldEarned = 0;
    scene.getEnemyRewardMultiplier = vi.fn(() => 1.5);
    scene.getTurnPressureState = vi.fn(() => ({ goldMultiplier: 2 }));
    const enemy = { faction: 'enemy', level: 4, isBoss: false };
    const killer = { accessory: { combatEffects: { bountyGoldOnKill: 500 } } };

    scene._applyKillRewards(enemy, killer);

    const expected = Math.floor(calculateKillGold(enemy) * 1.5 * 2) + 500;
    expect(scene.goldEarned).toBe(expected);
  });

  it('builds forecast skill context using temporary post-cost HP and restores HP', () => {
    const scene = new BattleScene();
    const art = makeArt({ hpCost: 3 });
    const attacker = makeUnit({ currentHP: 10 });
    const defender = makeUnit({ name: 'Enemy' });
    const seenHP = [];
    scene.buildSkillCtx = vi.fn((a) => {
      seenHP.push(a.currentHP);
      return { atkMods: {}, defMods: {} };
    });

    scene._buildForecastSkillCtx(attacker, defender, art);

    expect(seenHP[0]).toBe(7);
    expect(attacker.currentHP).toBe(10);
  });

  it('applies Phoenix heal in forecast context after art cost and restores trigger state', () => {
    const scene = new BattleScene();
    const art = makeArt({ hpCost: 6 });
    const attacker = makeUnit({
      currentHP: 12,
      stats: { HP: 24, DEF: 5, RES: 3 },
      accessory: {
        name: 'Phoenix Brooch',
        combatEffects: { phoenixBrooch: true },
      },
    });
    const defender = makeUnit({ name: 'Enemy' });
    const seenHP = [];
    scene.buildSkillCtx = vi.fn((a) => {
      seenHP.push(a.currentHP);
      return { atkMods: {}, defMods: {} };
    });

    scene._buildForecastSkillCtx(attacker, defender, art);

    expect(seenHP[0]).toBe(16);
    expect(attacker.currentHP).toBe(12);
    expect(attacker._phoenixBroochUsed).toBeUndefined();
  });

  it('applies Recoil Guard buff in forecast context and restores timed buff state', () => {
    const scene = new BattleScene();
    scene.turnManager = { turnNumber: 3, currentPhase: 'player' };
    const art = makeArt({ hpCost: 3 });
    const attacker = makeUnit({
      faction: 'player',
      name: 'Edric',
      currentHP: 20,
      mov: 5,
      stats: { HP: 24, DEF: 5, RES: 2, MOV: 5 },
      accessory: {
        combatEffects: {
          recoilGuard: { stats: { DEF: 3, RES: 2 } },
        },
      },
    });
    const defender = makeUnit({ name: 'Enemy' });
    const seenDef = [];
    const seenRes = [];
    scene.buildSkillCtx = vi.fn((a) => {
      seenDef.push(a.stats.DEF);
      seenRes.push(a.stats.RES);
      return { atkMods: {}, defMods: {} };
    });

    scene._buildForecastSkillCtx(attacker, defender, art);

    expect(seenDef[0]).toBe(8);
    expect(seenRes[0]).toBe(4);
    expect(attacker.stats.DEF).toBe(5);
    expect(attacker.stats.RES).toBe(2);
    expect(attacker.mov).toBe(5);
    expect(attacker._battleTimedWeaponArtBuffs).toBeUndefined();
    expect(attacker._battleTimedWeaponArtAppliedStats).toBeUndefined();
    expect(attacker._battleTimedWeaponArtAppliedCombatMods).toBeUndefined();
  });

  it('does not consume HP or usage when forecast is canceled', () => {
    const scene = new BattleScene();
    const art = makeArt();
    const unit = makeUnit({ currentHP: 20 });
    scene.gameData = { weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1 };
    scene.selectedUnit = unit;
    scene.forecastTarget = makeUnit({ name: 'Enemy' });
    scene.battleState = 'SHOWING_FORECAST';
    scene.registry = { get: () => ({ playSFX() {} }) };
    scene.hideForecast = vi.fn(() => {
      scene.forecastTarget = null;
    });

    scene._setSelectedWeaponArt(unit, art.id);
    BattleScene.prototype.handleCancel.call(scene);

    expect(unit.currentHP).toBe(20);
    expect(unit._battleWeaponArtUsage).toBeUndefined();
  });

  it('does not consume HP or usage when selecting an art before confirm', () => {
    const scene = new BattleScene();
    const art = makeArt();
    const unit = makeUnit({ currentHP: 20 });
    scene.gameData = { weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1 };
    scene.buildSkillCtx = vi.fn(() => ({}));

    scene._setSelectedWeaponArt(unit, art.id);
    scene._buildForecastSkillCtx(unit, makeUnit({ name: 'Enemy' }), art);

    expect(unit.currentHP).toBe(20);
    expect(unit._battleWeaponArtUsage).toBeUndefined();
  });

  it('uses identical post-cost HP context for forecast and execute skill ctx', async () => {
    const scene = new BattleScene();
    const art = makeArt({ hpCost: 3, perTurnLimit: 1, perMapLimit: 3 });
    const attacker = {
      name: 'Edric',
      faction: 'player',
      col: 0,
      row: 0,
      currentHP: 20,
      stats: { HP: 24, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 7, RES: 3, LCK: 5 },
      weaponRank: 'Prof',
      weapon: {
        name: 'Iron Sword',
        type: 'Sword',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 5,
        range: '1',
        special: '',
        weaponArtIds: [art.id],
        weaponArtSources: ['scroll'],
      },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
      _gambitUsedThisTurn: true,
    };
    const defender = {
      name: 'Brigand',
      faction: 'enemy',
      col: 1,
      row: 0,
      currentHP: 24,
      stats: { HP: 24, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: 5, RES: 1, LCK: 2 },
      weaponRank: 'Prof',
      weapon: null,
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      skills: [],
      accessory: null,
    };

    scene.gameData = { skills: [], affixes: [], weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1, currentPhase: 'player' };
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    scene.npcUnits = [];
    scene.grid = {
      clearHighlights() {},
      clearAttackHighlights() {},
      getTerrainAt() {
        return {};
      },
    };
    scene.registry = { get: () => null };
    scene.resetFortHealStreak = () => {};
    const seenHp = [];
    scene.buildSkillCtx = vi.fn((a) => {
      seenHp.push(a.currentHP);
      return {};
    });
    scene.animateSkillActivation = vi.fn(async () => {});
    scene.animateStrike = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.applyOnAttackAffixes = vi.fn(async () => {});
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.awardXP = vi.fn(async () => {});
    scene.removeUnit = vi.fn(async () => {});
    scene.checkBattleEnd = vi.fn(() => false);
    scene.finishUnitAction = vi.fn();

    scene._buildForecastSkillCtx(attacker, defender, art);
    scene._setSelectedWeaponArt(attacker, art.id);
    await BattleScene.prototype.executeCombat.call(scene, attacker, defender);

    expect(seenHp).toHaveLength(2);
    expect(seenHp[0]).toBe(17);
    expect(seenHp[1]).toBe(17);
    expect(attacker.currentHP).toBe(17);
  });

  it('does not consume HP or usage across repeated forecast previews before confirm', () => {
    const scene = new BattleScene();
    const art = makeArt({ hpCost: 4 });
    const attacker = makeUnit({ currentHP: 20 });
    const defender = makeUnit({ name: 'Enemy', faction: 'enemy' });
    scene.turnManager = { turnNumber: 1 };
    scene.buildSkillCtx = vi.fn(() => ({}));

    scene._buildForecastSkillCtx(attacker, defender, art);
    scene._buildForecastSkillCtx(attacker, defender, art);
    scene._buildForecastSkillCtx(attacker, defender, art);

    expect(attacker.currentHP).toBe(20);
    expect(attacker._battleWeaponArtUsage).toBeUndefined();
  });

  it('consumes HP and records usage exactly once on executeCombat', async () => {
    const scene = new BattleScene();
    const art = makeArt({ hpCost: 2, perTurnLimit: 1, perMapLimit: 3 });
    const attacker = {
      name: 'Edric',
      faction: 'player',
      col: 0,
      row: 0,
      currentHP: 20,
      stats: { HP: 24, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 7, RES: 3, LCK: 5 },
      weaponRank: 'Prof',
      weapon: {
        name: 'Iron Sword',
        type: 'Sword',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 5,
        range: '1',
        special: '',
        weaponArtIds: [art.id],
        weaponArtSources: ['scroll'],
      },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
      _gambitUsedThisTurn: true,
    };
    const defender = {
      name: 'Brigand',
      faction: 'enemy',
      col: 1,
      row: 0,
      currentHP: 24,
      stats: { HP: 24, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: 5, RES: 1, LCK: 2 },
      weaponRank: 'Prof',
      weapon: null,
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      skills: [],
      accessory: null,
    };

    scene.gameData = { skills: [], affixes: [], weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1, currentPhase: 'player' };
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    scene.npcUnits = [];
    scene.grid = {
      clearHighlights() {},
      clearAttackHighlights() {},
      getTerrainAt() {
        return {};
      },
    };
    scene.registry = { get: () => null };
    scene.resetFortHealStreak = () => {};
    scene.buildSkillCtx = vi.fn(() => ({}));
    scene.animateSkillActivation = vi.fn(async () => {});
    scene.animateStrike = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.applyOnAttackAffixes = vi.fn(async () => {});
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.awardXP = vi.fn(async () => {});
    scene.removeUnit = vi.fn(async () => {});
    scene.checkBattleEnd = vi.fn(() => false);
    scene.finishUnitAction = vi.fn();

    scene._setSelectedWeaponArt(attacker, art.id);
    await BattleScene.prototype.executeCombat.call(scene, attacker, defender);

    expect(attacker.currentHP).toBe(18);
    expect(attacker._battleWeaponArtUsage?.map?.[art.id]).toBe(1);
    expect(attacker._battleWeaponArtUsage?.turn?.[art.id]).toBe(1);
  });

  it('applies weapon-art HP cost before Soulreaver drain heal during executeCombat', async () => {
    const scene = new BattleScene();
    const art = makeArt({ hpCost: 2, perTurnLimit: 1, perMapLimit: 3 });
    const attacker = {
      name: 'Edric',
      faction: 'player',
      col: 0,
      row: 0,
      currentHP: 20,
      stats: { HP: 24, STR: 18, MAG: 0, SKL: 8, SPD: 8, DEF: 7, RES: 3, LCK: 5 },
      weaponRank: 'Prof',
      weapon: {
        name: 'Soulreaver',
        type: 'Sword',
        might: 12,
        hit: 90,
        crit: 0,
        weight: 6,
        range: '1',
        special: 'Drains HP equal to damage dealt',
      },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
      _gambitUsedThisTurn: true,
    };
    const defender = {
      name: 'Brigand',
      faction: 'enemy',
      col: 1,
      row: 0,
      currentHP: 24,
      stats: { HP: 24, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: 2, RES: 1, LCK: 2 },
      weaponRank: 'Prof',
      weapon: null,
      proficiencies: [{ type: 'Axe', rank: 'Prof' }],
      skills: [],
      accessory: null,
    };

    scene.gameData = { skills: [], affixes: [], weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1, currentPhase: 'player' };
    scene.playerUnits = [attacker];
    scene.enemyUnits = [defender];
    scene.npcUnits = [];
    scene.grid = {
      clearHighlights() {},
      clearAttackHighlights() {},
      getTerrainAt() {
        return {};
      },
    };
    scene.registry = { get: () => null };
    scene.resetFortHealStreak = () => {};
    scene.buildSkillCtx = vi.fn(() => ({}));
    scene.animateSkillActivation = vi.fn(async () => {});
    scene.animateStrike = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.applyOnAttackAffixes = vi.fn(async () => {});
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.awardXP = vi.fn(async () => {});
    scene.removeUnit = vi.fn(async () => {});
    scene.checkBattleEnd = vi.fn(() => false);
    scene.finishUnitAction = vi.fn();

    scene._setSelectedWeaponArt(attacker, art.id);
    await BattleScene.prototype.executeCombat.call(scene, attacker, defender);

    expect(attacker.currentHP).toBeGreaterThan(18);
  });

  it('selects a legal enemy weapon art using AI constraints', () => {
    const scene = new BattleScene();
    const legal = makeArt({
      id: 'enemy_legal',
      hpCost: 2,
      combatMods: { atkBonus: 4, hitBonus: 10 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
      aiMinHpAfterCostPercent: 0.25,
    });
    const blocked = makeArt({
      id: 'enemy_blocked',
      hpCost: 8,
      combatMods: { atkBonus: 10 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
      aiMinHpAfterCostPercent: 0.5,
    });
    const enemy = makeUnit({
      name: 'Bandit',
      faction: 'enemy',
      currentHP: 10,
      stats: { HP: 20 },
      weapon: { type: 'Sword', weaponArtIds: ['enemy_blocked', 'enemy_legal'] },
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [blocked, legal] } };

    const picked = scene._selectEnemyWeaponArt(enemy, target);

    expect(picked?.id).toBe('enemy_legal');
  });

  it('breaks enemy art ties deterministically by lower hpCost then id', () => {
    const scene = new BattleScene();
    const tieB = makeArt({
      id: 'enemy_tie_b',
      hpCost: 2,
      combatMods: { atkBonus: 4, hitBonus: 10 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
    });
    const tieA = makeArt({
      id: 'enemy_tie_a',
      hpCost: 2,
      combatMods: { atkBonus: 4, hitBonus: 10 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
    });
    const enemy = makeUnit({
      name: 'Bandit',
      faction: 'enemy',
      currentHP: 10,
      stats: { HP: 20 },
      weapon: { type: 'Sword', weaponArtIds: ['enemy_tie_b', 'enemy_tie_a'] },
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [tieB, tieA] } };

    const picked = scene._selectEnemyWeaponArt(enemy, target);
    expect(picked?.id).toBe('enemy_tie_a');
  });

  it('does not select lethal self-cost enemy arts', () => {
    const scene = new BattleScene();
    const lethal = makeArt({
      id: 'enemy_lethal',
      hpCost: 5,
      combatMods: { atkBonus: 12, hitBonus: 20 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
    });
    const safe = makeArt({
      id: 'enemy_safe',
      hpCost: 1,
      combatMods: { atkBonus: 2, hitBonus: 5 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
    });
    const enemy = makeUnit({
      name: 'Bandit',
      faction: 'enemy',
      currentHP: 5,
      stats: { HP: 8 },
      weapon: { type: 'Sword', weaponArtIds: ['enemy_lethal', 'enemy_safe'] },
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [lethal, safe] } };

    const picked = scene._selectEnemyWeaponArt(enemy, target);
    expect(picked?.id).toBe('enemy_safe');
  });

  it('ignores illegal enemy-art tie candidates and remains deterministic', () => {
    const scene = new BattleScene();
    const illegalTie = makeArt({
      id: 'enemy_aa_illegal',
      hpCost: 2,
      combatMods: { atkBonus: 4, hitBonus: 10 },
      allowedFactions: ['player'],
      aiEnabled: true,
    });
    const legalTie = makeArt({
      id: 'enemy_bb_legal',
      hpCost: 2,
      combatMods: { atkBonus: 4, hitBonus: 10 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
    });
    const enemy = makeUnit({
      name: 'Bandit',
      faction: 'enemy',
      currentHP: 12,
      stats: { HP: 20 },
      weapon: { type: 'Sword', weaponArtIds: ['enemy_bb_legal', 'enemy_aa_illegal'] },
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [legalTie, illegalTie] } };

    const picked = scene._selectEnemyWeaponArt(enemy, target);
    expect(picked?.id).toBe('enemy_bb_legal');
  });

  it('uses stricter score threshold on normal difficulty than hard', () => {
    const scene = new BattleScene();
    const lowValue = makeArt({
      id: 'enemy_low_value',
      hpCost: 2,
      combatMods: { atkBonus: 1 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
    });
    const enemy = makeUnit({
      name: 'Bandit',
      faction: 'enemy',
      currentHP: 12,
      stats: { HP: 20 },
      weapon: { type: 'Sword', weaponArtIds: ['enemy_low_value'] },
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [lowValue] } };

    scene.battleParams = { difficultyId: 'normal' };
    expect(scene._selectEnemyWeaponArt(enemy, target)).toBeNull();

    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      scene.battleParams = { difficultyId: 'hard' };
      expect(scene._selectEnemyWeaponArt(enemy, target)?.id).toBe('enemy_low_value');
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('uses lower enemy art proc chance on normal than hard', () => {
    const scene = new BattleScene();
    const legal = makeArt({
      id: 'enemy_proc_test',
      hpCost: 2,
      combatMods: { atkBonus: 4, hitBonus: 10 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
    });
    const enemy = makeUnit({
      name: 'Bandit',
      faction: 'enemy',
      currentHP: 12,
      stats: { HP: 20 },
      weapon: { type: 'Sword', weaponArtIds: ['enemy_proc_test'] },
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [legal] } };
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.85);
    try {
      scene.battleParams = { difficultyId: 'normal' };
      expect(scene._selectEnemyWeaponArt(enemy, target)).toBeNull();

      scene.battleParams = { difficultyId: 'hard' };
      expect(scene._selectEnemyWeaponArt(enemy, target)?.id).toBe('enemy_proc_test');
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('uses injected enemy art roll helper when provided and clamps invalid values', () => {
    const scene = new BattleScene();
    const legal = makeArt({
      id: 'enemy_proc_injected',
      hpCost: 2,
      combatMods: { atkBonus: 4, hitBonus: 10 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
    });
    const enemy = makeUnit({
      name: 'Bandit',
      faction: 'enemy',
      currentHP: 12,
      stats: { HP: 20 },
      weapon: { type: 'Sword', weaponArtIds: ['enemy_proc_injected'] },
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [legal] } };
    scene.battleParams = { difficultyId: 'normal' };

    scene._enemyWeaponArtRandom = () => Number.NaN;
    expect(scene._selectEnemyWeaponArt(enemy, target)).toBeNull();

    scene._enemyWeaponArtRandom = () => -10;
    expect(scene._selectEnemyWeaponArt(enemy, target)?.id).toBe('enemy_proc_injected');
  });

  it('shows legendary-bound art only while matching weapon is equipped', () => {
    const scene = new BattleScene();
    const legendaryArt = makeArt({
      id: 'legend_gemini_tempest',
      name: 'Gemini Tempest',
      requiredRank: 'Mast',
      legendaryWeaponIds: ['Gemini'],
      combatMods: { atkBonus: 5, hitBonus: 15 },
    });
    const unit = makeUnit({
      currentHP: 20,
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      weapon: { type: 'Sword', name: 'Gemini' },
    });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [legendaryArt] } };
    scene.runManager = { getUnlockedWeaponArtIds: () => ['legend_gemini_tempest'] };

    const withLegendary = scene._getWeaponArtChoices(unit, unit.weapon);
    expect(withLegendary).toHaveLength(1);
    expect(withLegendary[0].canUse).toBe(true);

    unit.weapon = { type: 'Sword', name: 'Iron Sword' };
    const withIron = scene._getWeaponArtChoices(unit, unit.weapon);
    expect(withIron).toHaveLength(0);
  });

  it('hides globally unlocked legendary arts when no matching weapon is equipped', () => {
    const scene = new BattleScene();
    const legendaryArt = makeArt({
      id: 'legend_gemini_tempest',
      name: 'Gemini Tempest',
      requiredRank: 'Mast',
      legendaryWeaponIds: ['Gemini'],
      combatMods: { atkBonus: 5, hitBonus: 15 },
    });
    const unit = makeUnit({
      currentHP: 20,
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      weapon: { type: 'Sword', name: 'Iron Sword' },
    });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [legendaryArt] } };
    scene.runManager = { getUnlockedWeaponArtIds: () => ['legend_gemini_tempest'] };

    const choices = scene._getWeaponArtChoices(unit, unit.weapon);
    expect(choices).toHaveLength(0);
  });

  it('prevents enemy from selecting player-only legendary arts', () => {
    const scene = new BattleScene();
    const legendaryArt = makeArt({
      id: 'legend_gemini_tempest',
      name: 'Gemini Tempest',
      requiredRank: 'Mast',
      allowedFactions: ['player'],
      legendaryWeaponIds: ['Gemini'],
      combatMods: { atkBonus: 5, hitBonus: 15 },
    });
    const enemy = makeUnit({
      name: 'Enemy',
      faction: 'enemy',
      currentHP: 20,
      stats: { HP: 24 },
      proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      weapon: { type: 'Sword', name: 'Gemini' },
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [legendaryArt] } };

    const picked = scene._selectEnemyWeaponArt(enemy, target);
    expect(picked).toBeNull();
  });

  it('consumes HP and records usage on enemy execute when art is selected', async () => {
    const scene = new BattleScene();
    const art = makeArt({
      id: 'enemy_art',
      hpCost: 2,
      combatMods: { atkBonus: 5, hitBonus: 10 },
      allowedFactions: ['enemy'],
      aiEnabled: true,
      aiMinHpAfterCostPercent: 0.25,
    });
    const enemy = {
      name: 'Bandit',
      faction: 'enemy',
      col: 0,
      row: 0,
      currentHP: 12,
      stats: { HP: 20, STR: 9, MAG: 0, SKL: 7, SPD: 7, DEF: 6, RES: 2, LCK: 3 },
      weaponRank: 'Prof',
      weapon: {
        id: 'iron_sword',
        name: 'Iron Sword',
        type: 'Sword',
        might: 5,
        hit: 90,
        crit: 0,
        weight: 5,
        range: '1',
        special: '',
        weaponArtIds: [art.id],
        weaponArtSources: ['innate'],
      },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
    };
    const target = {
      name: 'Edric',
      faction: 'player',
      col: 1,
      row: 0,
      currentHP: 20,
      stats: { HP: 24, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 7, RES: 3, LCK: 5 },
      weaponRank: 'Prof',
      weapon: null,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      accessory: null,
    };

    scene.gameData = { skills: [], affixes: [], weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 2, currentPhase: 'enemy' };
    scene.playerUnits = [target];
    scene.enemyUnits = [enemy];
    scene.npcUnits = [];
    scene.grid = {
      getTerrainAt() {
        return {};
      },
    };
    scene.resetFortHealStreak = () => {};
    scene.buildSkillCtx = vi.fn(() => ({}));
    scene.animateSkillActivation = vi.fn(async () => {});
    scene.animateStrike = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.applyOnAttackAffixes = vi.fn(async () => {});
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.awardXP = vi.fn(async () => {});
    scene.removeUnit = vi.fn(async () => {});
    scene.checkBattleEnd = vi.fn(() => false);

    await BattleScene.prototype.executeEnemyCombat.call(scene, enemy, target);

    expect(enemy.currentHP).toBe(10);
    expect(enemy._battleWeaponArtUsage?.map?.[art.id]).toBe(1);
    expect(enemy._battleWeaponArtUsage?.turn?.[art.id]).toBe(1);
    expect(scene.buildSkillCtx).toHaveBeenCalledWith(
      enemy,
      target,
      expect.objectContaining({ id: art.id }),
    );
  });

  it('applies Tier 2 debuff steps with scene/headless parity', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'sword_seal_speed');
    const sceneAttacker = {
      name: 'Edric',
      faction: 'player',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 24, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 7, RES: 3, LCK: 5, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Bandit',
      faction: 'enemy',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 24, STR: 9, MAG: 0, SKL: 6, SPD: 10, DEF: 6, RES: 2, LCK: 3, MOV: 5 },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false }],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessDefender = structuredClone(sceneDefender);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.playerUnits = [sceneAttacker];
    scene.enemyUnits = [sceneDefender];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => [];
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.playerUnits = [headlessAttacker];
    headless.enemyUnits = [headlessDefender];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(sceneDefender.stats.SPD).toBe(headlessDefender.stats.SPD);
    expect(sceneDefender.currentHP).toBe(headlessDefender.currentHP);
  });

  it('applies Tier 2 push movement with scene/headless parity', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'lance_overrun');
    const sceneAttacker = {
      name: 'Knight',
      faction: 'enemy',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 6, DEF: 8, RES: 3, LCK: 3, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Edric',
      faction: 'player',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 24, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 7, RES: 3, LCK: 5, MOV: 5 },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false }],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessDefender = structuredClone(sceneDefender);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.playerUnits = [sceneDefender];
    scene.enemyUnits = [sceneAttacker];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => [];
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.playerUnits = [headlessDefender];
    headless.enemyUnits = [headlessAttacker];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(sceneDefender.col).toBe(headlessDefender.col);
    expect(sceneDefender.row).toBe(headlessDefender.row);
    expect(sceneAttacker.col).toBe(headlessAttacker.col);
    expect(sceneAttacker.row).toBe(headlessAttacker.row);
  });

  it('applies lethal Tier 2 advance movement with scene/headless parity before removal', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'sword_advancing_strike');
    const sceneAttacker = {
      name: 'Edric',
      faction: 'player',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 24, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 7, RES: 3, LCK: 5, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Bandit',
      faction: 'enemy',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 0,
      stats: { HP: 24, STR: 9, MAG: 0, SKL: 6, SPD: 10, DEF: 6, RES: 2, LCK: 3, MOV: 5 },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false }],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessDefender = structuredClone(sceneDefender);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.playerUnits = [sceneAttacker];
    scene.enemyUnits = [sceneDefender];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => [];
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.playerUnits = [headlessAttacker];
    headless.enemyUnits = [headlessDefender];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(sceneAttacker.col).toBe(3);
    expect(sceneAttacker.row).toBe(2);
    expect(sceneAttacker.col).toBe(headlessAttacker.col);
    expect(sceneAttacker.row).toBe(headlessAttacker.row);
  });

  it('applies Tier 2 pierce_through mirrored strike damage with scene/headless parity', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'legend_piercing_charge');
    const sceneAttacker = {
      name: 'Sigurd',
      faction: 'player',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 24,
      stats: { HP: 24, STR: 12, MAG: 0, SKL: 10, SPD: 10, DEF: 8, RES: 5, LCK: 6, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Front',
      faction: 'enemy',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 8, DEF: 6, RES: 3, LCK: 3, MOV: 5 },
    };
    const sceneBehind = {
      name: 'Behind',
      faction: 'enemy',
      col: 4,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 7, MAG: 0, SKL: 5, SPD: 6, DEF: 5, RES: 2, LCK: 2, MOV: 5 },
    };
    const result = {
      events: [
        { type: 'strike', attackerSide: 'attacker', miss: false, damage: 7 },
        { type: 'strike', attackerSide: 'attacker', miss: false, damage: 4 },
      ],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessDefender = structuredClone(sceneDefender);
    const headlessBehind = structuredClone(sceneBehind);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.playerUnits = [sceneAttacker];
    scene.enemyUnits = [sceneDefender, sceneBehind];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => [];
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.playerUnits = [headlessAttacker];
    headless.enemyUnits = [headlessDefender, headlessBehind];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(sceneBehind.currentHP).toBe(9);
    expect(sceneBehind.currentHP).toBe(headlessBehind.currentHP);
  });

  it('does not apply tier2_pierce on miss-only sequences', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'legend_piercing_charge');
    const sceneAttacker = {
      name: 'Sigurd',
      faction: 'player',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 24,
      stats: { HP: 24, STR: 12, MAG: 0, SKL: 10, SPD: 10, DEF: 8, RES: 5, LCK: 6, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Front',
      faction: 'enemy',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 8, DEF: 6, RES: 3, LCK: 3, MOV: 5 },
    };
    const sceneBehind = {
      name: 'Behind',
      faction: 'enemy',
      col: 4,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 7, MAG: 0, SKL: 5, SPD: 6, DEF: 5, RES: 2, LCK: 2, MOV: 5 },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: true, damage: 99 }],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessDefender = structuredClone(sceneDefender);
    const headlessBehind = structuredClone(sceneBehind);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.playerUnits = [sceneAttacker];
    scene.enemyUnits = [sceneDefender, sceneBehind];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => [];
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.playerUnits = [headlessAttacker];
    headless.enemyUnits = [headlessDefender, headlessBehind];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(sceneBehind.currentHP).toBe(20);
    expect(sceneBehind.currentHP).toBe(headlessBehind.currentHP);
  });

  it('applies tier2_pierce even when the source unit is dead after combat', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'legend_piercing_charge');
    const sceneAttacker = {
      name: 'Sigurd',
      faction: 'player',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 0,
      stats: { HP: 24, STR: 12, MAG: 0, SKL: 10, SPD: 10, DEF: 8, RES: 5, LCK: 6, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Front',
      faction: 'enemy',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 8, DEF: 6, RES: 3, LCK: 3, MOV: 5 },
    };
    const sceneBehind = {
      name: 'Behind',
      faction: 'enemy',
      col: 4,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 7, MAG: 0, SKL: 5, SPD: 6, DEF: 5, RES: 2, LCK: 2, MOV: 5 },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 6 }],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessDefender = structuredClone(sceneDefender);
    const headlessBehind = structuredClone(sceneBehind);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.playerUnits = [sceneAttacker];
    scene.enemyUnits = [sceneDefender, sceneBehind];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => [];
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.playerUnits = [headlessAttacker];
    headless.enemyUnits = [headlessDefender, headlessBehind];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(sceneBehind.currentHP).toBe(14);
    expect(sceneBehind.currentHP).toBe(headlessBehind.currentHP);
  });

  it('applies Doom Thrust pierce-before-push ordering with scene/headless parity', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'legend_doom_thrust');
    const sceneAttacker = {
      name: 'Doom User',
      faction: 'player',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 22,
      stats: { HP: 22, STR: 12, MAG: 0, SKL: 9, SPD: 8, DEF: 7, RES: 4, LCK: 5, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Front',
      faction: 'enemy',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 8, DEF: 6, RES: 3, LCK: 3, MOV: 5 },
    };
    const sceneBehind = {
      name: 'Behind',
      faction: 'enemy',
      col: 4,
      row: 2,
      moveType: 'Infantry',
      currentHP: 5,
      stats: { HP: 5, STR: 7, MAG: 0, SKL: 5, SPD: 6, DEF: 5, RES: 2, LCK: 2, MOV: 5 },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 6 }],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessDefender = structuredClone(sceneDefender);
    const headlessBehind = structuredClone(sceneBehind);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.playerUnits = [sceneAttacker];
    scene.enemyUnits = [sceneDefender, sceneBehind];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => [];
    scene.removeUnit = vi.fn(async (unit) => {
      const list = unit.faction === 'enemy' ? scene.enemyUnits : scene.playerUnits;
      const idx = list.indexOf(unit);
      if (idx >= 0) list.splice(idx, 1);
    });
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.playerUnits = [headlessAttacker];
    headless.enemyUnits = [headlessDefender, headlessBehind];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(scene.enemyUnits.some((unit) => unit.name === 'Behind')).toBe(false);
    expect(headless.enemyUnits.some((unit) => unit.name === 'Behind')).toBe(false);
    expect(sceneDefender.col).toBe(4);
    expect(sceneDefender.row).toBe(2);
    expect(sceneDefender.col).toBe(headlessDefender.col);
    expect(sceneDefender.row).toBe(headlessDefender.row);
  });

  it('applies Phantom Rush retreat plus set-to-5 with scene/headless parity', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'legend_phantom_rush');
    const sceneAttacker = {
      name: 'Phantom User',
      faction: 'player',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 14,
      stats: { HP: 24, STR: 12, MAG: 0, SKL: 9, SPD: 10, DEF: 7, RES: 4, LCK: 5, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Front',
      faction: 'enemy',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 8, DEF: 6, RES: 3, LCK: 3, MOV: 5 },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 8 }],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessDefender = structuredClone(sceneDefender);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.playerUnits = [sceneAttacker];
    scene.enemyUnits = [sceneDefender];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => [];
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.playerUnits = [headlessAttacker];
    headless.enemyUnits = [headlessDefender];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(sceneAttacker.col).toBe(1);
    expect(sceneAttacker.row).toBe(2);
    expect(sceneAttacker.currentHP).toBe(5);
    expect(sceneAttacker.col).toBe(headlessAttacker.col);
    expect(sceneAttacker.row).toBe(headlessAttacker.row);
    expect(sceneAttacker.currentHP).toBe(headlessAttacker.currentHP);
  });

  it('applies Galeforce Assault advance + set-to-5 while preserving ally buff parity', async () => {
    const gameData = loadGameData();
    const art = gameData.weaponArts.arts.find((entry) => entry.id === 'legend_galeforce_assault');
    const sceneAttacker = {
      name: 'Galeforce User',
      faction: 'player',
      col: 2,
      row: 2,
      moveType: 'Infantry',
      currentHP: 18,
      stats: { HP: 24, STR: 12, MAG: 0, SKL: 9, SPD: 10, DEF: 7, RES: 4, LCK: 5, MOV: 5 },
    };
    const sceneAlly = {
      name: 'Ally',
      faction: 'player',
      col: 2,
      row: 1,
      moveType: 'Infantry',
      currentHP: 20,
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 8, SPD: 8, DEF: 6, RES: 3, LCK: 4, MOV: 5 },
    };
    const sceneDefender = {
      name: 'Front',
      faction: 'enemy',
      col: 3,
      row: 2,
      moveType: 'Infantry',
      currentHP: 0,
      stats: { HP: 20, STR: 8, MAG: 0, SKL: 6, SPD: 8, DEF: 6, RES: 3, LCK: 3, MOV: 5 },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false, damage: 9 }],
      poisonEffects: [],
      debuffEvents: [],
      divineChargeHeals: [],
    };
    const headlessAttacker = structuredClone(sceneAttacker);
    const headlessAlly = structuredClone(sceneAlly);
    const headlessDefender = structuredClone(sceneDefender);

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.turnManager = { turnNumber: 1 };
    scene.playerUnits = [sceneAttacker, sceneAlly];
    scene.enemyUnits = [sceneDefender];
    scene.npcUnits = [];
    scene.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      gridToPixel: () => ({ x: 0, y: 0 }),
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    scene.showMinorHintAt = vi.fn();
    scene.showPoisonDamage = vi.fn(async () => {});
    scene.updateHPBar = vi.fn();
    scene.updateUnitPosition = vi.fn();
    scene.updateEnemyVisibility = vi.fn();
    scene.getDivineChargeAllies = () => scene.playerUnits;
    await BattleScene.prototype._applyResolvedCombatPostEffects.call(scene, {
      attacker: sceneAttacker,
      defender: sceneDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    const headless = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' });
    headless.turnManager = { turnNumber: 1 };
    headless.playerUnits = [headlessAttacker, headlessAlly];
    headless.enemyUnits = [headlessDefender];
    headless.npcUnits = [];
    headless.grid = {
      cols: 8,
      rows: 8,
      fogEnabled: false,
      getMoveCost: () => 1,
      updateFogOfWar() {},
    };
    HeadlessBattle.prototype._applyResolvedCombatPostEffects.call(headless, {
      attacker: headlessAttacker,
      defender: headlessDefender,
      result,
      attackerWeaponArt: art,
      defenderWeaponArt: null,
    });

    expect(sceneAttacker.col).toBe(3);
    expect(sceneAttacker.row).toBe(2);
    expect(sceneAttacker.currentHP).toBe(5);
    expect(sceneAlly.stats.STR).toBe(13);
    expect(sceneAttacker.col).toBe(headlessAttacker.col);
    expect(sceneAttacker.row).toBe(headlessAttacker.row);
    expect(sceneAttacker.currentHP).toBe(headlessAttacker.currentHP);
    expect(sceneAlly.stats.STR).toBe(headlessAlly.stats.STR);
  });
});
