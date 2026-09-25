// Regression: the run-blessing heal multiplier ("Staff healing -20% effective")
// must scale the staff's OUTPUT before the missing-HP cap, never the capped
// amount. Before the fix a 29/30 target healed 0 (floor(1 * 0.8)) and still
// cost a staff use + heal XP; 25/30 healed 4 instead of topping off.
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import {
  calculateHealAmount,
  calculateStaffHealOutput,
  normalizeHealingMultiplier,
  resolveHeal,
} from '../src/engine/Combat.js';
import { AIController } from '../src/engine/AIController.js';
import { BattleScene } from '../src/scenes/BattleScene.js';
import { HealController } from '../src/ui/HealController.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const HEAL_STAVES = data.weapons.filter((w) => w.type === 'Staff' && Number.isFinite(w.healBase));

/** MAG 5 + healBase 5 = a 10-HP raw heal (the bug report's numbers). */
function tenHpStaff() {
  return structuredClone(data.weapons.find((w) => w.name === 'Heal'));
}

function healer(staff, MAG = 5) {
  return {
    name: 'Sera',
    faction: 'player',
    col: 1,
    row: 1,
    currentHP: 20,
    stats: { HP: 20, MAG },
    weapon: staff,
    inventory: [staff],
    proficiencies: [{ type: 'Staff', rank: 'Prof' }],
    traits: [],
  };
}

function target(currentHP, maxHP = 30, extra = {}) {
  return {
    name: 'Ally',
    faction: 'player',
    col: 2,
    row: 1,
    currentHP,
    stats: { HP: maxHP },
    ...extra,
  };
}

describe('resolveHeal: multiplier applies before the missing-HP cap', () => {
  const staff = tenHpStaff();
  const sera = healer(staff);

  it.each([
    // [currentHP, multiplier, expected heal, expected HP after]
    [29, 0.8, 1, 30], // 1 HP missing: was 0
    [25, 0.8, 5, 30], // 5 missing, 8 effective: was 4
    [15, 0.8, 8, 23], // partially injured: floor(10 * 0.8)
    [1, 0.8, 8, 9],
    [30, 0.8, 0, 30], // full health: nothing to restore
    [29, 1, 1, 30],
    [25, 1, 5, 30],
    [15, 1, 10, 25],
    [30, 1, 0, 30],
    [29, 1.5, 1, 30], // bonus never over-heals
    [25, 1.5, 5, 30],
    [15, 1.5, 15, 30],
    [10, 1.5, 15, 25],
    [10, 2, 20, 30],
  ])('%i/30 at x%s heals %i -> %i', (hp, healingMultiplier, heal, after) => {
    const unit = target(hp);
    const result = resolveHeal(staff, sera, unit, { healingMultiplier });
    expect(result).toEqual({ healAmount: heal, targetHPAfter: after });
    expect(calculateHealAmount(staff, sera, unit, { healingMultiplier })).toBe(heal);
    expect(result.targetHPAfter).toBeLessThanOrEqual(unit.stats.HP);
    expect(unit.currentHP).toBe(hp); // pure
  });

  it('is identical to min(MAG + healBase, missing) when the multiplier is 1 or absent', () => {
    const mismatches = [];
    for (const s of HEAL_STAVES) {
      for (let MAG = 0; MAG <= 30; MAG++) {
        for (let hp = 1; hp <= 40; hp++) {
          const unit = target(hp, 40);
          const expected = Math.min(MAG + s.healBase, 40 - hp);
          const h = healer(s, MAG);
          const got = [
            resolveHeal(s, h, unit).healAmount,
            resolveHeal(s, h, unit, {}).healAmount,
            resolveHeal(s, h, unit, { healingMultiplier: 1 }).healAmount,
            calculateHealAmount(s, h, unit),
          ];
          if (got.some((v) => v !== expected)) mismatches.push({ staff: s.name, MAG, hp, got });
        }
      }
    }
    expect(HEAL_STAVES.length).toBeGreaterThanOrEqual(5);
    expect(mismatches).toEqual([]);
  });

  it('every heal staff restores at least 1 HP to any injured ally under the real -20% blessing', () => {
    const multiplier = 1 + -0.2; // exactly what RunManager accumulates from blessings.json
    const bad = [];
    for (const s of HEAL_STAVES) {
      for (let MAG = 0; MAG <= 30; MAG++) {
        for (let hp = 1; hp < 40; hp++) {
          const unit = target(hp, 40);
          const { healAmount, targetHPAfter } = resolveHeal(s, healer(s, MAG), unit, {
            healingMultiplier: multiplier,
          });
          const expected = Math.min(40 - hp, Math.floor((MAG + s.healBase) * 0.8));
          if (healAmount < 1 || healAmount !== expected || targetHPAfter > 40)
            bad.push({ staff: s.name, MAG, hp, healAmount, targetHPAfter });
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('never lowers HP of a target already above max HP', () => {
    const result = resolveHeal(staff, sera, target(33, 30), { healingMultiplier: 1.5 });
    expect(result).toEqual({ healAmount: 0, targetHPAfter: 33 });
  });

  it('normalizes pathological multipliers', () => {
    expect(normalizeHealingMultiplier(undefined)).toBe(1);
    expect(normalizeHealingMultiplier(null)).toBe(1);
    expect(normalizeHealingMultiplier(Number.NaN)).toBe(1);
    expect(normalizeHealingMultiplier(Infinity)).toBe(1);
    expect(normalizeHealingMultiplier(-0.5)).toBe(0);
    expect(calculateStaffHealOutput(staff, sera, { healingMultiplier: Number.NaN })).toBe(10);
    expect(calculateStaffHealOutput(staff, sera, { healingMultiplier: -1 })).toBe(0);
    expect(resolveHeal(staff, sera, target(10), { healingMultiplier: 0 }).healAmount).toBe(0);
  });

  it('does not lose a point to float error in accumulated multipliers', () => {
    // 1 - 0.9 === 0.09999999999999998; 10 * that must still floor to 1.
    expect(calculateStaffHealOutput(staff, sera, { healingMultiplier: 1 - 0.9 })).toBe(1);
    expect(calculateStaffHealOutput(staff, sera, { healingMultiplier: 1 - 0.1 - 0.1 })).toBe(8);
  });

  it('still throws on a missing staff (scene action-error recovery relies on it)', () => {
    expect(() => resolveHeal(null, sera, target(10))).toThrow();
  });
});

// --- Production player flow (HealController through BattleScene wrappers) ---

function makeSceneCtx(multiplier, playerUnits = []) {
  const textStub = {
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    destroy() {},
  };
  return {
    battleParams: {},
    battleState: '',
    playerUnits,
    runManager: { blessingRuntimeModifiers: { healingEffectivenessMultiplier: multiplier } },
    registry: { get: () => ({ playSFX() {} }) },
    grid: { clearAttackHighlights() {}, gridToPixel: () => ({ x: 0, y: 0 }) },
    add: { text: () => textStub },
    time: { delayedCall: (_ms, cb) => cb() },
    tweens: { add: ({ onComplete }) => onComplete?.() },
    _reduceMotion: () => true,
    turnManager: { turnNumber: 1, currentPhase: 'player' },
    gameData: data,
    hideActionMenu() {},
    undimUnit() {},
    updateHPBar() {},
    animateHeal: vi.fn(async () => {}),
    awardScaledXP: vi.fn(async () => {}),
    finishUnitAction: vi.fn(),
    _recoverUnitActionError: vi.fn((_u, _k, err) => {
      throw err;
    }),
  };
}

describe('HealController applies the fixed resolver on every path', () => {
  it('single target: 29/30 under -20% tops off to 30 and animates +1', async () => {
    const staff = tenHpStaff();
    const sera = healer(staff);
    const ally = target(29);
    const ctx = makeSceneCtx(0.8, [sera, ally]);
    await BattleScene.prototype.executeHeal.call(ctx, sera, ally);
    expect(ally.currentHP).toBe(30);
    expect(ctx.animateHeal).toHaveBeenCalledWith(ally, 1, sera);
    expect(staff._usesSpent).toBe(1);
    expect(ctx.finishUnitAction).toHaveBeenCalledWith(sera);
    expect(ctx._recoverUnitActionError).not.toHaveBeenCalled();
  });

  it('single target: 25/30 under -20% heals 5 (not 4)', async () => {
    const staff = tenHpStaff();
    const sera = healer(staff);
    const ally = target(25);
    const ctx = makeSceneCtx(0.8, [sera, ally]);
    await BattleScene.prototype.executeHeal.call(ctx, sera, ally);
    expect(ally.currentHP).toBe(30);
    expect(ctx.animateHeal).toHaveBeenCalledWith(ally, 5, sera);
  });

  it('single target: a >1 multiplier never pushes past max HP', async () => {
    const staff = tenHpStaff();
    const sera = healer(staff);
    const ally = target(25);
    const ctx = makeSceneCtx(1.5, [sera, ally]);
    await BattleScene.prototype.executeHeal.call(ctx, sera, ally);
    expect(ally.currentHP).toBe(30);
  });

  it('heal-all: every target resolves with the multiplier before the cap, one use total', async () => {
    const staff = structuredClone(data.weapons.find((w) => w.name === 'Fortify'));
    const sera = healer(staff); // MAG 5 + 5 = 10 raw, 8 effective
    const allies = [target(29), target(25, 30, { row: 2 }), target(10, 30, { row: 3 })];
    const ctx = makeSceneCtx(0.8, [sera, ...allies]);
    await BattleScene.prototype.executeHealAll.call(ctx, sera, allies);
    expect(allies.map((a) => a.currentHP)).toEqual([30, 30, 18]);
    expect(ctx.animateHeal.mock.calls.map((c) => c[1])).toEqual([1, 5, 8]);
    expect(staff._usesSpent).toBe(1);
  });

  it('targeting keeps injured allies under the penalty and still skips full-HP allies', () => {
    const staff = tenHpStaff();
    const sera = healer(staff);
    const nearlyFull = target(29);
    const full = target(30, 30, { col: 1, row: 2 });
    const ctrl = new HealController(makeSceneCtx(0.8, [sera, nearlyFull, full]));
    ctrl.scene.getActiveHealStaff = (u) => ctrl.getActiveHealStaff(u);
    ctrl.scene.getUsableStaves = (u) => ctrl.getUsableStaves(u);
    expect(ctrl.findHealTargets(sera, staff)).toEqual([nearlyFull]);
  });

  it('targeting never offers an ally a heal that would resolve to 0 HP', () => {
    const staff = tenHpStaff();
    const sera = healer(staff);
    const injured = target(10);
    const ctrl = new HealController(makeSceneCtx(0, [sera, injured]));
    expect(ctrl.findHealTargets(sera, staff)).toEqual([]);
  });
});

// --- Headless harness parity (drives sims / journey tests) ---

describe('HeadlessBattle heal parity', () => {
  function harnessCtx(multiplier, units) {
    const ctx = Object.create(HeadlessBattle.prototype);
    ctx.playerUnits = units;
    ctx.gameData = { ...data, deeds: null };
    ctx.runManager = { blessingRuntimeModifiers: { healingEffectivenessMultiplier: multiplier } };
    ctx._finishUnitAction = vi.fn();
    return ctx;
  }

  it('resolves 29/30 and 25/30 to full under -20%, matching the scene', () => {
    for (const hp of [29, 25]) {
      const staff = tenHpStaff();
      const sera = healer(staff);
      const ally = target(hp);
      const ctx = harnessCtx(0.8, [sera, ally]);
      expect(ctx._findHealTargets(sera)).toEqual([ally]);
      ctx._executeHeal(sera, ally);
      expect(ally.currentHP).toBe(30);
      expect(staff._usesSpent).toBe(1);
    }
  });

  it('never offers a 0-HP heal target', () => {
    const staff = tenHpStaff();
    const sera = healer(staff);
    const ctx = harnessCtx(0, [sera, target(10)]);
    expect(ctx._findHealTargets(sera)).toEqual([]);
  });
});

// --- Enemy AI: scoring and resolution use the same resolver (no player blessing) ---

describe('AI enemy healing parity', () => {
  it('tops off a 1-HP-missing enemy ally by exactly 1 and never over-heals', () => {
    const staff = tenHpStaff();
    const cleric = { ...healer(staff), faction: 'enemy' };
    const ally = { ...target(29), faction: 'enemy' };
    const ai = new AIController({ getMovementRange: () => new Map() }, data);
    const result = ai.applyHealDecision(cleric, ally, staff);
    expect(result).toEqual({ healAmount: 1, targetHPAfter: 30 });
    expect(ally.currentHP).toBe(30);
  });
});
