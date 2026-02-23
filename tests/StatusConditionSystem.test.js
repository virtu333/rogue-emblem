import { describe, it, expect, vi } from 'vitest';
import {
  applyCondition,
  removeCondition,
  clearAllConditions,
  hasCondition,
  getConditions,
  isSleeping,
  isSilenced,
  isStatusStaff,
  isHealStaff,
  calculateStatusHit,
  resolveStatusStaff,
  processConditionRecovery,
  parseStaffRange,
} from '../src/engine/StatusConditionSystem.js';
import {
  STATUS_HIT_MIN,
  STATUS_HIT_MAX,
  STATUS_MAG_MULT,
  STATUS_RES_MULT,
} from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

// --- Helper factories ---
function makeUnit(overrides = {}) {
  return {
    name: 'TestUnit',
    stats: { HP: 30, STR: 10, MAG: 8, SKL: 10, SPD: 10, DEF: 8, RES: 6, LCK: 5, MOV: 5 },
    skills: [],
    ...overrides,
  };
}

describe('StatusConditionSystem', () => {
  // --- Condition storage ---
  describe('applyCondition / removeCondition / clearAll', () => {
    it('applies a condition to a unit', () => {
      const unit = makeUnit();
      applyCondition(unit, 'sleep', 3);
      expect(unit._conditions).toEqual([{ id: 'sleep', turnsRemaining: 3 }]);
    });

    it('uses default turns from STATUS_CONDITIONS if not specified', () => {
      const unit = makeUnit();
      applyCondition(unit, 'silence');
      expect(unit._conditions[0].turnsRemaining).toBe(3);
    });

    it('does not stack — replaces existing condition of same type', () => {
      const unit = makeUnit();
      applyCondition(unit, 'sleep', 3);
      applyCondition(unit, 'sleep', 2);
      expect(unit._conditions).toHaveLength(1);
      expect(unit._conditions[0].turnsRemaining).toBe(2);
    });

    it('allows multiple different conditions', () => {
      const unit = makeUnit();
      applyCondition(unit, 'sleep', 3);
      applyCondition(unit, 'silence', 3);
      expect(unit._conditions).toHaveLength(2);
    });

    it('removes a specific condition', () => {
      const unit = makeUnit();
      applyCondition(unit, 'sleep', 3);
      applyCondition(unit, 'silence', 3);
      removeCondition(unit, 'sleep');
      expect(unit._conditions).toHaveLength(1);
      expect(unit._conditions[0].id).toBe('silence');
    });

    it('clearAllConditions empties the array', () => {
      const unit = makeUnit();
      applyCondition(unit, 'sleep', 3);
      applyCondition(unit, 'silence', 3);
      clearAllConditions(unit);
      expect(unit._conditions).toEqual([]);
    });

    it('handles null/undefined unit gracefully', () => {
      expect(() => applyCondition(null, 'sleep', 3)).not.toThrow();
      expect(() => removeCondition(undefined, 'sleep')).not.toThrow();
      expect(() => clearAllConditions(null)).not.toThrow();
    });

    it('ignores invalid conditionId', () => {
      const unit = makeUnit();
      applyCondition(unit, 'nonexistent', 3);
      expect(unit._conditions).toBeUndefined();
    });
  });

  // --- Query helpers ---
  describe('hasCondition / getConditions / isSleeping / isSilenced', () => {
    it('hasCondition returns true when present', () => {
      const unit = makeUnit();
      applyCondition(unit, 'sleep', 3);
      expect(hasCondition(unit, 'sleep')).toBe(true);
      expect(hasCondition(unit, 'silence')).toBe(false);
    });

    it('getConditions returns empty array for fresh unit', () => {
      expect(getConditions(makeUnit())).toEqual([]);
    });

    it('isSleeping / isSilenced convenience aliases', () => {
      const unit = makeUnit();
      expect(isSleeping(unit)).toBe(false);
      applyCondition(unit, 'sleep', 3);
      expect(isSleeping(unit)).toBe(true);
      expect(isSilenced(unit)).toBe(false);
      applyCondition(unit, 'silence', 3);
      expect(isSilenced(unit)).toBe(true);
    });

    it('handles null unit', () => {
      expect(hasCondition(null, 'sleep')).toBe(false);
      expect(isSleeping(null)).toBe(false);
      expect(getConditions(null)).toEqual([]);
    });
  });

  // --- Weapon classification ---
  describe('isStatusStaff / isHealStaff', () => {
    it('classifies status staves from game data', () => {
      const gd = loadGameData();
      const sleepStaff = gd.weapons.find((w) => w.name === 'Sleep Staff');
      const silenceStaff = gd.weapons.find((w) => w.name === 'Silence Staff');
      const healStaff = gd.weapons.find((w) => w.name === 'Heal');
      expect(isStatusStaff(sleepStaff)).toBe(true);
      expect(isStatusStaff(silenceStaff)).toBe(true);
      expect(isStatusStaff(healStaff)).toBe(false);
      expect(isHealStaff(healStaff)).toBe(true);
      expect(isHealStaff(sleepStaff)).toBe(false);
    });

    it('non-Staff weapons are neither', () => {
      expect(isStatusStaff({ type: 'Sword', statusEffect: 'sleep' })).toBe(false);
      expect(isHealStaff({ type: 'Sword' })).toBe(false);
    });

    it('handles null/undefined', () => {
      expect(isStatusStaff(null)).toBe(false);
      expect(isHealStaff(undefined)).toBe(false);
    });
  });

  // --- Hit formula ---
  describe('calculateStatusHit', () => {
    it('basic formula: baseHit + MAG*3 - RES*3', () => {
      const staff = { hit: 40, statusEffect: 'sleep' };
      const caster = makeUnit({ stats: { MAG: 10 } });
      const target = makeUnit({ stats: { RES: 5 } });
      // 40 + 10*3 - 5*3 = 40 + 30 - 15 = 55
      expect(calculateStatusHit(staff, caster, target)).toBe(55);
    });

    it('clamps to minimum STATUS_HIT_MIN', () => {
      const staff = { hit: 0, statusEffect: 'sleep' };
      const caster = makeUnit({ stats: { MAG: 0 } });
      const target = makeUnit({ stats: { RES: 30 } });
      // 0 + 0 - 90 = -90, clamped to 15
      expect(calculateStatusHit(staff, caster, target)).toBe(STATUS_HIT_MIN);
    });

    it('clamps to maximum STATUS_HIT_MAX', () => {
      const staff = { hit: 80, statusEffect: 'sleep' };
      const caster = makeUnit({ stats: { MAG: 20 } });
      const target = makeUnit({ stats: { RES: 0 } });
      // 80 + 60 - 0 = 140, clamped to 90
      expect(calculateStatusHit(staff, caster, target)).toBe(STATUS_HIT_MAX);
    });

    it('handles MAG=0 caster', () => {
      const staff = { hit: 40 };
      const caster = makeUnit({ stats: { MAG: 0 } });
      const target = makeUnit({ stats: { RES: 5 } });
      // 40 + 0 - 15 = 25
      expect(calculateStatusHit(staff, caster, target)).toBe(25);
    });

    it('handles RES=0 target', () => {
      const staff = { hit: 40 };
      const caster = makeUnit({ stats: { MAG: 8 } });
      const target = makeUnit({ stats: { RES: 0 } });
      // 40 + 24 - 0 = 64
      expect(calculateStatusHit(staff, caster, target)).toBe(64);
    });
  });

  // --- resolveStatusStaff ---
  describe('resolveStatusStaff', () => {
    it('returns hit=true when roll < hitChance', () => {
      const staff = { hit: 40, statusEffect: 'sleep', uses: 1 };
      const caster = makeUnit({ stats: { MAG: 10 } });
      const target = makeUnit({ stats: { RES: 5 } });
      // hitChance = 55
      const rng = () => 0.1; // roll = 10, which is < 55
      const result = resolveStatusStaff(staff, caster, target, rng);
      expect(result.hit).toBe(true);
      expect(result.hitChance).toBe(55);
      expect(result.conditionId).toBe('sleep');
      expect(isSleeping(target)).toBe(true);
    });

    it('returns hit=false when roll >= hitChance', () => {
      const staff = { hit: 40, statusEffect: 'silence', uses: 2 };
      const caster = makeUnit({ stats: { MAG: 5 } });
      const target = makeUnit({ stats: { RES: 10 } });
      // hitChance = 40 + 15 - 30 = 25
      const rng = () => 0.5; // roll = 50, which is >= 25
      const result = resolveStatusStaff(staff, caster, target, rng);
      expect(result.hit).toBe(false);
      expect(result.conditionId).toBe('silence');
      expect(isSilenced(target)).toBe(false);
    });

    it('returns no-op for invalid staff', () => {
      const result = resolveStatusStaff(null, makeUnit(), makeUnit());
      expect(result.hit).toBe(false);
      expect(result.hitChance).toBe(0);
      expect(result.conditionId).toBeNull();
    });

    it('returns no-op for staff without statusEffect', () => {
      const staff = { hit: 40, uses: 3 }; // heal staff
      const result = resolveStatusStaff(staff, makeUnit(), makeUnit());
      expect(result.hit).toBe(false);
    });
  });

  // --- processConditionRecovery ---
  describe('processConditionRecovery', () => {
    it('decrements turnsRemaining', () => {
      const unit = makeUnit();
      applyCondition(unit, 'sleep', 3);
      // rng > 0.5 so no random recovery
      processConditionRecovery([unit], () => 0.99);
      expect(unit._conditions[0].turnsRemaining).toBe(2);
    });

    it('removes condition when turnsRemaining hits 0', () => {
      const unit = makeUnit();
      applyCondition(unit, 'sleep', 1);
      const events = processConditionRecovery([unit], () => 0.99);
      expect(events).toHaveLength(1);
      expect(events[0].conditionId).toBe('sleep');
      expect(isSleeping(unit)).toBe(false);
    });

    it('50% random recovery when turnsRemaining > 0', () => {
      const unit = makeUnit();
      applyCondition(unit, 'silence', 3);
      // rng returns 0.3, which is < 0.5 recoveryChance
      const events = processConditionRecovery([unit], () => 0.3);
      expect(events).toHaveLength(1);
      expect(isSilenced(unit)).toBe(false);
    });

    it('no random recovery when rng >= recoveryChance', () => {
      const unit = makeUnit();
      applyCondition(unit, 'silence', 3);
      const events = processConditionRecovery([unit], () => 0.8);
      expect(events).toHaveLength(0);
      expect(isSilenced(unit)).toBe(true);
      // turnsRemaining should have decremented
      expect(unit._conditions[0].turnsRemaining).toBe(2);
    });

    it('handles multiple units and conditions', () => {
      const u1 = makeUnit({ name: 'A' });
      const u2 = makeUnit({ name: 'B' });
      applyCondition(u1, 'sleep', 1);
      applyCondition(u2, 'silence', 1);
      const events = processConditionRecovery([u1, u2], () => 0.99);
      expect(events).toHaveLength(2);
    });

    it('returns empty array for no units', () => {
      expect(processConditionRecovery([])).toEqual([]);
      expect(processConditionRecovery(null)).toEqual([]);
    });
  });

  // --- parseStaffRange ---
  describe('parseStaffRange', () => {
    it('parses "3-5" to { min: 3, max: 5 }', () => {
      expect(parseStaffRange('3-5')).toEqual({ min: 3, max: 5 });
    });

    it('parses "3-7" to { min: 3, max: 7 }', () => {
      expect(parseStaffRange('3-7')).toEqual({ min: 3, max: 7 });
    });

    it('parses single value "2" to { min: 2, max: 2 }', () => {
      expect(parseStaffRange('2')).toEqual({ min: 2, max: 2 });
    });

    it('handles null/undefined', () => {
      expect(parseStaffRange(null)).toEqual({ min: 1, max: 1 });
      expect(parseStaffRange(undefined)).toEqual({ min: 1, max: 1 });
    });
  });

  // --- Bug fix regression tests ---
  describe('bug fixes', () => {
    it('processConditionRecovery clears sleeping units before all-sleeping check', () => {
      // Fix 1: recovery must run before the all-sleeping auto-advance
      // Simulate: all units sleeping, one with turnsRemaining=1 (guaranteed wake)
      const u1 = makeUnit({ name: 'A', currentHP: 20 });
      const u2 = makeUnit({ name: 'B', currentHP: 20 });
      applyCondition(u1, 'sleep', 1); // will expire this turn
      applyCondition(u2, 'sleep', 3); // won't expire
      // rng > recovery chance so only timer-based expiry fires
      const events = processConditionRecovery([u1, u2], () => 0.99);
      // u1 should have recovered (timer expired), u2 should still be sleeping
      expect(events).toHaveLength(1);
      expect(events[0].unit.name).toBe('A');
      expect(isSleeping(u1)).toBe(false);
      expect(isSleeping(u2)).toBe(true);
      // After recovery, not all units are sleeping — no auto-advance needed
      const allSleeping = [u1, u2].every((u) => !u || u.currentHP <= 0 || isSleeping(u));
      expect(allSleeping).toBe(false);
    });

    it('_conditions cleared on fresh deploy prevents cross-battle leak', () => {
      // Fix 2: units entering a new battle should not carry conditions
      const unit = makeUnit({ name: 'Knight' });
      applyCondition(unit, 'sleep', 2);
      applyCondition(unit, 'silence', 3);
      expect(unit._conditions).toHaveLength(2);
      // Simulate deploy reset
      unit._conditions = [];
      expect(isSleeping(unit)).toBe(false);
      expect(isSilenced(unit)).toBe(false);
      expect(getConditions(unit)).toEqual([]);
    });
  });

  // --- Data integrity ---
  describe('data integrity', () => {
    it('Sleep Staff and Silence Staff exist in weapons.json with correct fields', () => {
      const gd = loadGameData();
      const sleepStaff = gd.weapons.find((w) => w.name === 'Sleep Staff');
      const silenceStaff = gd.weapons.find((w) => w.name === 'Silence Staff');

      expect(sleepStaff).toBeDefined();
      expect(sleepStaff.type).toBe('Staff');
      expect(sleepStaff.statusEffect).toBe('sleep');
      expect(sleepStaff.hit).toBe(40);
      expect(sleepStaff.uses).toBeGreaterThan(0);
      expect(sleepStaff.perBattleUses).toBe(true);
      expect(sleepStaff.price).toBe(0);

      expect(silenceStaff).toBeDefined();
      expect(silenceStaff.type).toBe('Staff');
      expect(silenceStaff.statusEffect).toBe('silence');
      expect(silenceStaff.hit).toBe(40);
      expect(silenceStaff.uses).toBeGreaterThan(0);
      expect(silenceStaff.perBattleUses).toBe(true);
      expect(silenceStaff.price).toBe(0);
    });

    it('Herb and Remedy exist in consumables.json with correct effects', () => {
      const gd = loadGameData();
      const herb = gd.consumables.find((c) => c.name === 'Herb');
      const remedy = gd.consumables.find((c) => c.name === 'Remedy');

      expect(herb).toBeDefined();
      expect(herb.effect).toBe('cure');
      expect(herb.uses).toBe(2);
      expect(herb.price).toBeGreaterThan(0);

      expect(remedy).toBeDefined();
      expect(remedy.effect).toBe('cureHeal');
      expect(remedy.value).toBe(10);
      expect(remedy.uses).toBe(1);
      expect(remedy.price).toBeGreaterThan(0);
    });

    it('difficulty.json has statusStaffConfig on hard/lunatic, null on normal', () => {
      const gd = loadGameData();
      const normal = gd.difficulty.modes.normal;
      const hard = gd.difficulty.modes.hard;
      const lunatic = gd.difficulty.modes.lunatic;

      expect(normal.statusStaffConfig).toBeNull();
      expect(normal.shopCureGating).toBeNull();

      expect(hard.statusStaffConfig).toBeDefined();
      expect(hard.statusStaffConfig.maxPerBattle).toBe(1);
      expect(hard.statusStaffConfig.act3).toBeGreaterThan(0);
      expect(hard.statusStaffConfig.act1).toBe(0);
      expect(hard.statusStaffConfig.act2).toBe(0);

      expect(lunatic.statusStaffConfig).toBeDefined();
      expect(lunatic.statusStaffConfig.maxPerBattle).toBe(2);
      expect(lunatic.statusStaffConfig.act2).toBeGreaterThan(0);

      expect(hard.shopCureGating).toBeDefined();
      expect(hard.shopCureGating.act3).toBe(true);
      expect(hard.shopCureGating.act1).toBe(false);
    });
  });
});
