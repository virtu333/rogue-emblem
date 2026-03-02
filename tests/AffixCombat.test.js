import { describe, it, expect, vi } from 'vitest';
import { resolveCombat } from '../src/engine/Combat.js';
import {
  rollDefenseAffixes,
  getWarpCandidates,
  getAffixCombatMods,
  getAffixMovBonus,
} from '../src/engine/AffixSystem.js';
import { getSkillCombatMods } from '../src/engine/SkillSystem.js';
import { loadGameData } from './testData.js';

describe('Affix Combat Interactions', () => {
  const mockSkills = [];
  const mockAffixes = {
    affixes: [
      { id: 'shielded', name: 'Shielded', trigger: 'on-defend', effects: { negateFirstHit: true } },
    ],
  };

  const weapon = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, range: '1' };
  const braveWeapon = {
    name: 'Brave Sword',
    type: 'Sword',
    might: 5,
    hit: 90,
    crit: 0,
    range: '1',
    special: 'twice consecutively',
  };

  const attacker = {
    name: 'Attacker',
    stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
    currentHP: 20,
    weapon: weapon,
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
  };

  const defender = {
    name: 'Defender',
    stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
    currentHP: 20,
    weapon: weapon,
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    affixes: ['shielded'],
  };

  const skillCtx = {
    atkMods: { hitBonus: 0, avoidBonus: 0, critBonus: 0, atkBonus: 0, defBonus: 0 },
    defMods: { hitBonus: 0, avoidBonus: 0, critBonus: 0, atkBonus: 0, defBonus: 0 },
    rollStrikeSkills: (s, d, t, sd) => ({ modifiedDamage: d, activated: [] }),
    rollDefenseAffixes: rollDefenseAffixes,
    affixData: mockAffixes,
    skillsData: mockSkills,
  };

  it('Shielded negates only the first hit in a Brave weapon sequence', () => {
    // Mock Math.random to always hit and not crit
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const result = resolveCombat(attacker, braveWeapon, defender, weapon, 1, null, null, {
      ...skillCtx,
      atkMods: { ...skillCtx.atkMods },
    });

    // Expect at least 2 strikes from attacker (brave)
    const attackerStrikes = result.events.filter((e) => e.attacker === 'Attacker');
    expect(attackerStrikes.length).toBeGreaterThanOrEqual(2);

    // First strike should deal 0 damage (Shielded)
    expect(attackerStrikes[0].damage).toBe(0);
    expect(attackerStrikes[0].skillActivations.some((s) => s.id === 'shielded')).toBe(true);

    // Second strike should deal normal damage (Shielded consumed)
    // Damage = 10 (STR) + 5 (Might) - 5 (DEF) = 10
    expect(attackerStrikes[1].damage).toBe(10);
    expect(attackerStrikes[1].skillActivations.some((s) => s.id === 'shielded')).toBe(false);

    vi.restoreAllMocks();
  });

  it('getAffixCombatMods treats null allAllies as an empty collection', () => {
    const affixData = {
      affixes: [{ id: 'fury', name: 'Fury', trigger: 'passive', effects: { atkBonus: 2 } }],
    };
    const unitWithPassiveAffix = { ...attacker, affixes: ['fury'] };
    const mods = getAffixCombatMods(unitWithPassiveAffix, defender, null, affixData, null);
    expect(mods.atkBonus).toBe(2);
    expect(mods.activated.some((a) => a.id === 'fury')).toBe(true);
  });

  it('getAffixCombatMods no-ops when unit.affixes is not an array', () => {
    const affixData = {
      affixes: [{ id: 'fury', name: 'Fury', trigger: 'passive', effects: { atkBonus: 2 } }],
    };
    const unitWithInvalidAffixes = { ...attacker, affixes: 'fury' };
    const mods = getAffixCombatMods(unitWithInvalidAffixes, defender, [], affixData, null);
    expect(mods.atkBonus).toBe(0);
    expect(mods.activated).toEqual([]);
  });

  it('rollDefenseAffixes no-ops when defender is null', () => {
    const affixData = {
      affixes: [{ id: 'shielded', name: 'Shielded', trigger: 'on-defend', effects: {} }],
    };
    const result = rollDefenseAffixes(null, 12, true, true, affixData);
    expect(result).toEqual({
      modifiedDamage: 12,
      reflectDamage: 0,
      warpRange: 0,
      activated: [],
    });
  });

  it('executeWarp prioritizes tiles farthest from the attacker', async () => {
    const mockGrid = {
      cols: 10,
      rows: 10,
      getMoveCost: () => 1,
    };
    const getUnitAt = () => null;

    const unit = { col: 5, row: 5, moveType: 'Infantry' };
    const attacker = { col: 4, row: 5 }; // Attacker is immediately to the left
    const range = 3;

    // Farthest tiles in range 3 from (4,5) that are reachable from (5,5):
    // Max Manhattan dist from (4,5) is 4.
    const bestPicks = getWarpCandidates(unit, range, attacker, mockGrid, getUnitAt);

    expect(bestPicks.length).toBeGreaterThan(0);
    expect(bestPicks[0].distToAttacker).toBe(4);

    // Check that all returned picks are indeed the optimal distance
    for (const pick of bestPicks) {
      expect(pick.distToAttacker).toBe(4);
    }

    // Check that it identifies specific optimal tiles correctly
    const possibleFarthest = [
      { col: 8, row: 5 },
      { col: 5, row: 8 },
      { col: 5, row: 2 },
      { col: 7, row: 6 },
      { col: 7, row: 4 },
      { col: 6, row: 7 },
      { col: 6, row: 3 },
    ];

    for (const p of possibleFarthest) {
      const match = bestPicks.find((bp) => bp.col === p.col && bp.row === p.row);
      expect(match).toBeDefined();
    }
  });
});

describe('B3 — Teleport affix: once per combat + full escape', () => {
  const teleportAffixData = {
    affixes: [
      { id: 'teleporter', name: 'Teleporter', trigger: 'on-defend', effects: { warpRange: 3 } },
    ],
  };

  const weapon = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, range: '1' };

  it('fast attacker doubles a teleporter — only 1 strike, warp ends combat', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1); // Always hit

    const fastAtk = {
      name: 'FastAtk',
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 20, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 20,
      weapon,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
    };
    const teleDefender = {
      name: 'TeleDef',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 8, SPD: 5, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 30,
      weapon,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      affixes: ['teleporter'],
    };

    const skillCtx = {
      atkMods: {},
      defMods: {},
      rollStrikeSkills: (s, d, t, sd) => ({ modifiedDamage: d, activated: [] }),
      rollDefenseAffixes: rollDefenseAffixes,
      affixData: teleportAffixData,
      skillsData: [],
    };

    const result = resolveCombat(fastAtk, weapon, teleDefender, weapon, 1, null, null, skillCtx);
    const strikes = result.events.filter((e) => e.type === 'strike');

    // Only 1 strike lands (warp cancels the double follow-up)
    expect(strikes.length).toBe(1);
    expect(strikes[0].attacker).toBe('FastAtk');
    // Warp event is on the strike
    expect(strikes[0].warpRange).toBe(3);

    // Temp flags cleaned up
    expect(fastAtk._teleportUsedThisCombat).toBeUndefined();
    expect(teleDefender._teleportUsedThisCombat).toBeUndefined();

    vi.restoreAllMocks();
  });

  it('teleport fires only once even with brave weapon', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const braveWeapon = {
      name: 'Brave Sword',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      range: '1',
      special: 'twice consecutively',
    };

    const braveAtk = {
      name: 'BraveAtk',
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 20,
      weapon: braveWeapon,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
    };
    const teleDefender = {
      name: 'TeleDef',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 8, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 30,
      weapon,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      affixes: ['teleporter'],
    };

    const skillCtx = {
      atkMods: {},
      defMods: {},
      rollStrikeSkills: (s, d, t, sd) => ({ modifiedDamage: d, activated: [] }),
      rollDefenseAffixes: rollDefenseAffixes,
      affixData: teleportAffixData,
      skillsData: [],
    };

    const result = resolveCombat(
      braveAtk,
      braveWeapon,
      teleDefender,
      weapon,
      1,
      null,
      null,
      skillCtx,
    );
    const strikes = result.events.filter((e) => e.type === 'strike');

    // First brave strike triggers warp, second brave strike is cancelled
    expect(strikes.length).toBe(1);
    expect(strikes[0].warpRange).toBe(3);

    vi.restoreAllMocks();
  });
  it('warp suppresses defender poison but attacker poison still applies', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const poisonSword = {
      name: 'Venin Blade',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      range: '1',
      special: 'Poison: target loses 5 HP after combat',
    };

    const atkWithPoison = {
      name: 'PoisonAtk',
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 20,
      weapon: poisonSword,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
    };
    const teleDefWithPoison = {
      name: 'TelePoison',
      stats: { HP: 30, STR: 8, MAG: 0, SKL: 8, SPD: 5, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 30,
      weapon: poisonSword,
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      skills: [],
      affixes: ['teleporter'],
    };

    const skillCtx = {
      atkMods: {},
      defMods: {},
      rollStrikeSkills: (s, d, t, sd) => ({ modifiedDamage: d, activated: [] }),
      rollDefenseAffixes: rollDefenseAffixes,
      affixData: teleportAffixData,
      skillsData: [],
    };

    const result = resolveCombat(
      atkWithPoison,
      poisonSword,
      teleDefWithPoison,
      poisonSword,
      1,
      null,
      null,
      skillCtx,
    );

    // Attacker poison still applies (hit landed before warp)
    const atkPoison = result.poisonEffects.find((p) => p.target === 'defender');
    expect(atkPoison).toBeDefined();
    expect(atkPoison.damage).toBe(5);

    // Defender poison suppressed (they escaped, never struck)
    const defPoison = result.poisonEffects.find((p) => p.target === 'attacker');
    expect(defPoison).toBeUndefined();

    vi.restoreAllMocks();
  });
});

describe('H5 — Haste MOV bonus (not SPD)', () => {
  const hasteAffixData = {
    affixes: [
      { id: 'haste', name: 'Haste', trigger: 'passive', effects: { movBonus: 2 } },
      { id: 'fury', name: 'Fury', trigger: 'passive', effects: { atkBonus: 3 } },
    ],
  };

  it('getAffixMovBonus returns correct total for Haste affix', () => {
    expect(getAffixMovBonus(['haste'], hasteAffixData)).toBe(2);
  });

  it('getAffixMovBonus returns 0 for non-MOV affixes', () => {
    expect(getAffixMovBonus(['fury'], hasteAffixData)).toBe(0);
  });

  it('getAffixMovBonus sums multiple MOV affixes', () => {
    const multiData = {
      affixes: [
        { id: 'haste', name: 'Haste', trigger: 'passive', effects: { movBonus: 2 } },
        { id: 'swift', name: 'Swift', trigger: 'passive', effects: { movBonus: 1 } },
      ],
    };
    expect(getAffixMovBonus(['haste', 'swift'], multiData)).toBe(3);
  });

  it('getAffixMovBonus handles null/missing gracefully', () => {
    expect(getAffixMovBonus(null, hasteAffixData)).toBe(0);
    expect(getAffixMovBonus(['haste'], null)).toBe(0);
    expect(getAffixMovBonus(['haste'], { affixes: null })).toBe(0);
  });

  it('getAffixCombatMods does NOT return movBonus field', () => {
    const unit = {
      col: 0,
      row: 0,
      affixes: ['haste'],
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
    };
    const mods = getAffixCombatMods(unit, {}, [], hasteAffixData, null);
    expect(mods).not.toHaveProperty('movBonus');
  });

  it('getSkillCombatMods with Haste affix does NOT boost spdBonus', () => {
    const gameData = loadGameData();
    const unit = {
      col: 0,
      row: 0,
      skills: [],
      affixes: ['haste'],
      weapon: { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, range: '1' },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 20,
    };
    const opponent = {
      col: 1,
      row: 0,
      skills: [],
      weapon: { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, range: '1' },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 20,
    };
    const mods = getSkillCombatMods(unit, opponent, [], [], gameData.skills, hasteAffixData, null);
    expect(mods.spdBonus).toBe(0);
  });

  it('dead ally aura does not apply to living units (M5)', () => {
    const auraAffixData = {
      affixes: [
        {
          id: 'war_cry',
          name: 'War Cry',
          trigger: 'passive-aura',
          range: 2,
          effects: { atkBonus: 3 },
        },
      ],
    };
    const unit = {
      name: 'Target',
      col: 0,
      row: 0,
      affixes: [],
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 20,
    };
    const deadAlly = {
      name: 'DeadAura',
      col: 1,
      row: 0,
      affixes: ['war_cry'],
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 0,
    };
    const livingAlly = {
      name: 'LivingAura',
      col: 1,
      row: 0,
      affixes: ['war_cry'],
      stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
      currentHP: 15,
    };

    // Dead ally's aura should NOT apply
    const modsWithDead = getAffixCombatMods(unit, null, [deadAlly], auraAffixData);
    expect(modsWithDead.atkBonus).toBe(0);

    // Living ally's aura SHOULD apply
    const modsWithLiving = getAffixCombatMods(unit, null, [livingAlly], auraAffixData);
    expect(modsWithLiving.atkBonus).toBe(3);
  });
});
