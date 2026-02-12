import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

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

describe('BattleScene weapon art helpers', () => {
  it('filters weapon art catalog against run unlock state when available', () => {
    const scene = new BattleScene();
    const unlocked = makeArt({ id: 'art_unlocked' });
    const locked = makeArt({ id: 'art_locked', name: 'Locked Art' });
    scene.gameData = { weaponArts: { arts: [unlocked, locked] } };
    scene.runManager = {
      getUnlockedWeaponArts: () => [unlocked],
    };

    const arts = scene._getWeaponArtCatalog();

    expect(arts).toHaveLength(1);
    expect(arts[0].id).toBe('art_unlocked');
  });

  it('treats empty unlock state as authoritative when runManager exists', () => {
    const scene = new BattleScene();
    scene.gameData = { weaponArts: { arts: [makeArt({ id: 'art_a' }), makeArt({ id: 'art_b' })] } };
    scene.runManager = {
      getUnlockedWeaponArtIds: () => [],
    };

    const arts = scene._getWeaponArtCatalog();

    expect(Array.isArray(arts)).toBe(true);
    expect(arts).toHaveLength(0);
  });

  it('returns selected weapon art when valid for the unit weapon', () => {
    const scene = new BattleScene();
    const art = makeArt();
    const unit = makeUnit();
    scene.gameData = { weaponArts: { arts: [art] } };
    scene.turnManager = { turnNumber: 1 };

    scene._setSelectedWeaponArt(unit, art.id);
    const selected = scene._getSelectedWeaponArtForUnit(unit);

    expect(selected?.id).toBe(art.id);
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
      weapon: { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1', special: '' },
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
      clearAttackHighlights() {},
      getTerrainAt() { return {}; },
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
    scene.finishUnitAction = vi.fn();

    scene._setSelectedWeaponArt(attacker, art.id);
    await BattleScene.prototype.executeCombat.call(scene, attacker, defender);

    expect(attacker.currentHP).toBe(18);
    expect(attacker._battleWeaponArtUsage?.map?.[art.id]).toBe(1);
    expect(attacker._battleWeaponArtUsage?.turn?.[art.id]).toBe(1);
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
    });
    const target = makeUnit({ name: 'Edric', faction: 'player' });
    scene.turnManager = { turnNumber: 1 };
    scene.gameData = { weaponArts: { arts: [blocked, legal] } };

    const picked = scene._selectEnemyWeaponArt(enemy, target);

    expect(picked?.id).toBe('enemy_legal');
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
    scene.runManager = { getUnlockedWeaponArtIds: () => [] };

    const withLegendary = scene._getWeaponArtChoices(unit, unit.weapon);
    expect(withLegendary).toHaveLength(1);
    expect(withLegendary[0].canUse).toBe(true);

    unit.weapon = { type: 'Sword', name: 'Iron Sword' };
    const withIron = scene._getWeaponArtChoices(unit, unit.weapon);
    expect(withIron).toHaveLength(0);
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
      weapon: { id: 'iron_sword', name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, weight: 5, range: '1', special: '' },
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
      getTerrainAt() { return {}; },
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
    expect(scene.buildSkillCtx).toHaveBeenCalledWith(enemy, target, expect.objectContaining({ id: art.id }));
  });
});
