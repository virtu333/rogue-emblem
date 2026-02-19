import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { getWeaponArtTier2Effects } from '../src/engine/WeaponArtSystem.js';
import {
  getPostCombatPipelineSteps,
  resolvePostCombatMove,
} from '../src/engine/WeaponArtPostCombat.js';

const gameData = loadGameData();
const artById = new Map(gameData.weaponArts.arts.map((art) => [art.id, art]));

describe('Tier 2 weapon arts', () => {
  it('maps all 16 in-scope arts to structured Tier 2 effects', () => {
    const expected = {
      sword_advancing_strike: { postCombatMove: [{ mode: 'advance', distance: 1 }] },
      sword_lunge: { postCombatMove: [{ mode: 'swap', distance: 1 }] },
      lance_hit_and_run: { postCombatMove: [{ mode: 'retreat', distance: 1 }] },
      lance_overrun: { postCombatMove: [{ mode: 'push', distance: 1 }] },
      axe_rushing_blow: { postCombatMove: [{ mode: 'through', distance: 1 }] },
      sword_seal_speed: { afterCombatDebuff: [{ stat: 'SPD', amount: -4 }] },
      lance_shatter_slash: { afterCombatDebuff: [{ stat: 'DEF', amount: -3 }] },
      bow_break_shot: { afterCombatDebuff: [{ stat: 'DEF', amount: -3 }] },
      bow_waning_shot: { afterCombatDebuff: [{ stat: 'STR', amount: -3 }] },
      bow_seal_magic: { afterCombatDebuff: [{ stat: 'MAG', amount: -4 }] },
      sword_poison_strike: { afterCombatDamage: [{ amount: 5, nonLethal: true }] },
      legend_phantom_rush: {
        postCombatMove: [{ mode: 'retreat', distance: 1 }],
        setHp: [{ target: 'attacker', value: 5 }],
      },
      legend_piercing_charge: {
        pierceThrough: [{ target: 'defender', maxTargets: 1 }],
      },
      legend_galeforce_assault: {
        postCombatMove: [{ mode: 'advance', distance: 1 }],
        setHp: [{ target: 'attacker', value: 5 }],
      },
      legend_storm_blade: {
        postCombatMove: [{ mode: 'retreat', distance: 1 }],
      },
      legend_doom_thrust: {
        pierceThrough: [{ target: 'defender', maxTargets: 1 }],
        postCombatMove: [{ mode: 'push', distance: 1 }],
      },
    };

    for (const [artId, expectation] of Object.entries(expected)) {
      const art = artById.get(artId);
      expect(art).toBeTruthy();
      const effects = getWeaponArtTier2Effects(art);
      if (expectation.afterCombatDamage) {
        expect(effects.afterCombatDamage).toHaveLength(1);
        expect(effects.afterCombatDamage[0].amount).toBe(expectation.afterCombatDamage[0].amount);
        expect(effects.afterCombatDamage[0].nonLethal).toBe(
          expectation.afterCombatDamage[0].nonLethal,
        );
      }
      if (expectation.afterCombatDebuff) {
        expect(effects.afterCombatDebuff).toHaveLength(1);
        expect(effects.afterCombatDebuff[0].stat).toBe(expectation.afterCombatDebuff[0].stat);
        expect(effects.afterCombatDebuff[0].amount).toBe(expectation.afterCombatDebuff[0].amount);
      }
      if (expectation.postCombatMove) {
        expect(effects.postCombatMove).toHaveLength(1);
        expect(effects.postCombatMove[0].mode).toBe(expectation.postCombatMove[0].mode);
        expect(effects.postCombatMove[0].distance).toBe(expectation.postCombatMove[0].distance);
      }
      if (expectation.pierceThrough) {
        expect(effects.pierceThrough).toHaveLength(1);
        expect(effects.pierceThrough[0].target).toBe(expectation.pierceThrough[0].target);
        expect(effects.pierceThrough[0].maxTargets).toBe(expectation.pierceThrough[0].maxTargets);
      }
      if (expectation.setHp) {
        expect(effects.setHp).toHaveLength(1);
        expect(effects.setHp[0].target).toBe(expectation.setHp[0].target);
        expect(effects.setHp[0].value).toBe(expectation.setHp[0].value);
      }
      expect(typeof art._deferredMechanic).toBe('undefined');
    }
  });

  it('normalizes pierce_through and set_hp while rejecting invalid payloads', () => {
    const effects = getWeaponArtTier2Effects({
      effects: {
        afterCombat: [
          { type: 'pierce_through', target: 'defender', maxTargets: 1 },
          { type: 'pierce_through', target: 'defender', maxTargets: 3 },
          { type: 'set_hp', target: 'self', value: 5 },
          { type: 'pierce_through', target: 'defender', maxTargets: 0 },
          { type: 'set_hp', target: 'attacker', value: 0 },
        ],
      },
    });

    expect(effects.pierceThrough).toEqual([
      { target: 'defender', maxTargets: 1 },
      { target: 'defender', maxTargets: 1 },
    ]);
    expect(effects.setHp).toEqual([{ target: 'attacker', value: 5 }]);
  });

  it('builds post-combat steps in canonical order and hit-gates tier2 steps', () => {
    const attacker = { name: 'Atk', col: 0, row: 0 };
    const defender = { name: 'Def', col: 1, row: 0 };
    const art = {
      effects: {
        afterCombat: [
          { type: 'damage', target: 'defender', amount: 5, nonLethal: true },
          { type: 'debuff', target: 'defender', stat: 'SPD', amount: -4 },
          { type: 'pierce_through', target: 'defender', maxTargets: 1 },
          { type: 'move', mode: 'retreat', distance: 1 },
          { type: 'set_hp', target: 'attacker', value: 5 },
        ],
      },
    };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false }],
      poisonEffects: [{ target: 'defender', damage: 5 }],
      debuffEvents: [{ target: 'defender', debuffs: { STR: -2 } }],
      divineChargeHeals: [{ side: 'attacker', percent: 30, range: 2, damageDealt: 10 }],
    };

    const steps = getPostCombatPipelineSteps({
      attacker,
      defender,
      result,
      attackerWeaponArt: art,
    });
    expect(steps.map((step) => step.type)).toEqual([
      'affix',
      'affix',
      'poison',
      'debuff',
      'divine_charge',
      'tier2_damage',
      'tier2_debuff',
      'tier2_pierce',
      'tier2_move',
      'tier2_set_hp',
    ]);

    const missOnly = getPostCombatPipelineSteps({
      attacker,
      defender,
      result: {
        ...result,
        events: [{ type: 'strike', attackerSide: 'attacker', miss: true }],
      },
      attackerWeaponArt: art,
    });
    const missOnlyTier2Types = missOnly
      .filter((step) => step.type.startsWith('tier2_'))
      .map((step) => step.type);
    expect(missOnlyTier2Types).toEqual(['tier2_set_hp']);
  });

  it('captures landed strike damage sequence for tier2 pierce steps', () => {
    const attacker = { name: 'Atk', col: 0, row: 0 };
    const defender = { name: 'Def', col: 1, row: 0 };
    const art = {
      effects: {
        afterCombat: [{ type: 'pierce_through', target: 'defender', maxTargets: 1 }],
      },
    };
    const steps = getPostCombatPipelineSteps({
      attacker,
      defender,
      result: {
        events: [
          { type: 'strike', attackerSide: 'attacker', miss: false, damage: 7 },
          { type: 'strike', attackerSide: 'attacker', miss: true, damage: 999 },
          { type: 'strike', attackerSide: 'attacker', miss: false, damage: 4 },
        ],
      },
      attackerWeaponArt: art,
    });
    const pierce = steps.find((step) => step.type === 'tier2_pierce');
    expect(pierce).toBeTruthy();
    expect(pierce.damages).toEqual([7, 4]);
  });

  it('enforces non-lethal tier2 fixed damage through pipeline metadata', () => {
    const attacker = { name: 'Atk', col: 0, row: 0 };
    const defender = { name: 'Def', col: 1, row: 0 };
    const result = {
      events: [{ type: 'strike', attackerSide: 'attacker', miss: false }],
    };
    const steps = getPostCombatPipelineSteps({
      attacker,
      defender,
      result,
      attackerWeaponArt: artById.get('sword_poison_strike'),
    });
    const damageStep = steps.find((step) => step.type === 'tier2_damage');
    expect(damageStep).toBeTruthy();
    expect(damageStep.nonLethal).toBe(true);
    expect(damageStep.amount).toBe(5);
  });
});

describe('Tier 2 move legality', () => {
  function makeBoard(units = [], blocked = new Set()) {
    const byKey = new Map(units.map((unit) => [`${unit.col},${unit.row}`, unit]));
    return {
      cols: 8,
      rows: 8,
      getUnitAt(col, row) {
        return byKey.get(`${col},${row}`) || null;
      },
      getMoveCost(col, row) {
        return blocked.has(`${col},${row}`) ? Number.POSITIVE_INFINITY : 1;
      },
    };
  }

  it('allows through movement only when the destination is legal', () => {
    const source = { col: 2, row: 2, moveType: 'Infantry', currentHP: 20 };
    const target = { col: 3, row: 2, moveType: 'Infantry', currentHP: 20 };
    const board = makeBoard([source, target]);
    const result = resolvePostCombatMove({
      sourceUnit: source,
      targetUnit: target,
      mode: 'through',
      distance: 1,
      cols: board.cols,
      rows: board.rows,
      getMoveCost: board.getMoveCost,
      getUnitAt: board.getUnitAt,
    });
    expect(result.ok).toBe(true);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].col).toBe(4);
    expect(result.assignments[0].row).toBe(2);
  });

  it('rejects swap/push/through when target is dead or displaced', () => {
    const source = { col: 2, row: 2, moveType: 'Infantry', currentHP: 20 };
    const deadTarget = { col: 3, row: 2, moveType: 'Infantry', currentHP: 0 };
    const board = makeBoard([source, deadTarget]);
    const result = resolvePostCombatMove({
      sourceUnit: source,
      targetUnit: deadTarget,
      mode: 'swap',
      distance: 1,
      cols: board.cols,
      rows: board.rows,
      getMoveCost: board.getMoveCost,
      getUnitAt: board.getUnitAt,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_target');
  });

  it('allows advance into a dead target tile before removal', () => {
    const source = { col: 2, row: 2, moveType: 'Infantry', currentHP: 20 };
    const deadTarget = { col: 3, row: 2, moveType: 'Infantry', currentHP: 0 };
    const board = makeBoard([source, deadTarget]);
    const result = resolvePostCombatMove({
      sourceUnit: source,
      targetUnit: deadTarget,
      mode: 'advance',
      distance: 1,
      cols: board.cols,
      rows: board.rows,
      getMoveCost: board.getMoveCost,
      getUnitAt: board.getUnitAt,
    });
    expect(result.ok).toBe(true);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].col).toBe(3);
    expect(result.assignments[0].row).toBe(2);
  });
});
