// Regression tests for unit-action error recovery (follow-up wave):
// executeTalk / executeHeal / executeHealAll / executePromotion set blocking
// battle states ('COMBAT_RESOLVING' / 'HEAL_RESOLVING') and used to have no
// try/catch — any thrown error (failed dynamic import, animation error, bad
// data) softlocked the battle in that state forever.

import { afterEach, describe, expect, it, vi } from 'vitest';

const { promoteUnitMock, resolvePromotionTargetsMock } = vi.hoisted(() => ({
  promoteUnitMock: vi.fn(),
  resolvePromotionTargetsMock: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/UnitManager.js', async () => {
  const actual = await vi.importActual('../src/engine/UnitManager.js');
  return {
    ...actual,
    promoteUnit: promoteUnitMock,
    resolvePromotionTargets: resolvePromotionTargetsMock,
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function makeScene() {
  const scene = new BattleScene();
  scene.battleState = 'UNIT_ACTION_MENU';
  scene.grid = { clearHighlights: vi.fn(), clearAttackHighlights: vi.fn() };
  scene.finishUnitAction = vi.fn();
  scene.showActionMenu = vi.fn();
  scene.hideActionMenu = vi.fn();
  scene.updateHPBar = vi.fn();
  scene.removeUnitGraphic = vi.fn();
  scene.addUnitGraphic = vi.fn();
  scene.showBriefBanner = vi.fn(async () => {});
  scene.showPromotionBanner = vi.fn(async () => {});
  scene.registry = { get: vi.fn(() => null) };
  scene.gameData = { lords: [], weapons: [], skills: [], classes: [], dialogue: {} };
  return scene;
}

function makeUnit(overrides = {}) {
  return {
    name: 'Unit',
    faction: 'player',
    hasActed: false,
    hasMoved: true,
    skills: [],
    proficiencies: [],
    inventory: [],
    consumables: [],
    stats: { HP: 20, STR: 5, MAG: 5, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 5, MOV: 4 },
    currentHP: 20,
    col: 0,
    row: 0,
    ...overrides,
  };
}

describe('executeTalk error recovery', () => {
  it('consumes the action instead of softlocking when the dialogue overlay throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = makeScene();
    const lord = makeUnit({ name: 'Edric', isLord: true });
    const npc = makeUnit({ name: 'Recruit', faction: 'npc' });
    scene.npcUnits = [npc];
    scene.playerUnits = [lord];
    scene.findTalkTarget = vi.fn(() => npc);
    scene._getPortraitKey = vi.fn(() => null);
    scene.dialogueOverlay = { show: vi.fn(async () => Promise.reject(new Error('overlay boom'))) };

    await scene.executeTalk(lord);

    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(lord, { skipCanto: true });
  });
});

describe('executeHeal error recovery', () => {
  it('finishes the healer action when the heal flow throws mid-way', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = makeScene();
    const healer = makeUnit({ name: 'Cleric', weapon: null }); // resolveHeal(null, ...) throws
    const target = makeUnit({ name: 'Hurt', currentHP: 5 });

    await scene.executeHeal(healer, target);

    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(healer, { skipCanto: true });
  });

  it('does not double-finish when the inner XP award throws after finishUnitAction ran', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = makeScene();
    const staff = { name: 'Heal', type: 'Staff', healPower: 10, uses: 20, _usesSpent: 0 };
    const healer = makeUnit({ name: 'Cleric', weapon: staff, inventory: [staff] });
    const target = makeUnit({ name: 'Hurt', currentHP: 5 });
    scene.finishUnitAction = vi.fn((unit) => {
      unit.hasActed = true;
      scene.battleState = 'PLAYER_IDLE';
    });
    scene.animateHeal = vi.fn(async () => {});
    scene.awardScaledXP = vi.fn(async () => {
      throw new Error('xp boom');
    });

    await scene.executeHeal(healer, target);

    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });
});

describe('executeHealAll error recovery', () => {
  it('finishes the healer action when a target animation throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = makeScene();
    const staff = { name: 'Fortify', type: 'Staff', healPower: 10, uses: 20, _usesSpent: 0 };
    const healer = makeUnit({ name: 'Bishop', weapon: staff, inventory: [staff] });
    const target = makeUnit({ name: 'Hurt', currentHP: 5 });
    scene.animateHeal = vi.fn(async () => {
      throw new Error('anim boom');
    });

    await scene.executeHealAll(healer, [target]);

    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(healer, { skipCanto: true });
  });
});

describe('executePromotion error recovery', () => {
  it('returns the unit to its action menu when nothing was committed yet', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = makeScene();
    const unit = makeUnit({ name: 'Knight' });
    const seal = { name: 'Master Seal', effect: 'promote', uses: 1 };
    unit.consumables = [seal];
    resolvePromotionTargetsMock.mockImplementation(() => {
      throw new Error('targets boom');
    });

    const didPromote = await scene.executePromotion(unit, seal);

    expect(didPromote).toBe(false);
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
    expect(scene.showActionMenu).toHaveBeenCalledWith(unit);
    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(seal.uses).toBe(1); // seal untouched — promotion never happened
    expect(promoteUnitMock).not.toHaveBeenCalled();
  });

  it('consumes the seal and the action when an error lands after promoteUnit applied', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = makeScene();
    const unit = makeUnit({ name: 'Knight' });
    const seal = { name: 'Master Seal', effect: 'promote', uses: 1 };
    unit.consumables = [seal];
    resolvePromotionTargetsMock.mockReturnValue([
      { name: 'General', promotionBonuses: { HP: 3, DEF: 2 } },
    ]);
    scene.showPromotionBanner = vi.fn(async () => {
      throw new Error('banner boom');
    });

    const didPromote = await scene.executePromotion(unit, seal);

    expect(didPromote).toBe(true);
    expect(promoteUnitMock).toHaveBeenCalledTimes(1);
    // Seal consumed exactly once (uses 1 → 0, removed from consumables).
    expect(seal.uses).toBe(0);
    expect(unit.consumables).not.toContain(seal);
    expect(scene.finishUnitAction).toHaveBeenCalledTimes(1);
    expect(scene.finishUnitAction).toHaveBeenCalledWith(unit, { skipCanto: true });
  });
});

describe('_recoverUnitActionError', () => {
  it('forces PLAYER_IDLE when the unit already acted and the state is blocking', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = makeScene();
    scene.battleState = 'COMBAT_RESOLVING';
    const unit = makeUnit({ hasActed: true });

    scene._recoverUnitActionError(unit, 'test', new Error('boom'));

    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('PLAYER_IDLE');
  });

  it('leaves BATTLE_END untouched', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scene = makeScene();
    scene.battleState = 'BATTLE_END';
    const unit = makeUnit();

    scene._recoverUnitActionError(unit, 'test', new Error('boom'));

    expect(scene.finishUnitAction).not.toHaveBeenCalled();
    expect(scene.battleState).toBe('BATTLE_END');
  });
});
