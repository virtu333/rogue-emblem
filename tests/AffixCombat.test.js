import { describe, it, expect, vi } from 'vitest';
import { resolveCombat } from '../src/engine/Combat.js';
import { rollDefenseAffixes, getWarpCandidates } from '../src/engine/AffixSystem.js';

describe('Affix Combat Interactions', () => {
  const mockSkills = [];
  const mockAffixes = {
    affixes: [
      { id: 'shielded', name: 'Shielded', trigger: 'on-defend', effects: { negateFirstHit: true } }
    ]
  };

  const weapon = { name: 'Iron Sword', type: 'Sword', might: 5, hit: 90, crit: 0, range: '1' };
  const braveWeapon = { name: 'Brave Sword', type: 'Sword', might: 5, hit: 90, crit: 0, range: '1', special: 'twice consecutively' };

  const attacker = {
    name: 'Attacker',
    stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
    currentHP: 20,
    weapon: weapon,
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: []
  };

  const defender = {
    name: 'Defender',
    stats: { HP: 20, STR: 10, MAG: 0, SKL: 10, SPD: 10, DEF: 5, RES: 5, LCK: 5 },
    currentHP: 20,
    weapon: weapon,
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    affixes: ['shielded']
  };

  const skillCtx = {
    atkMods: { hitBonus: 0, avoidBonus: 0, critBonus: 0, atkBonus: 0, defBonus: 0 },
    defMods: { hitBonus: 0, avoidBonus: 0, critBonus: 0, atkBonus: 0, defBonus: 0 },
    rollStrikeSkills: (s, d, t, sd) => ({ modifiedDamage: d, activated: [] }),
    rollDefenseAffixes: rollDefenseAffixes,
    affixData: mockAffixes,
    skillsData: mockSkills
  };

  it('Shielded negates only the first hit in a Brave weapon sequence', () => {
    // Mock Math.random to always hit and not crit
    vi.spyOn(Math, 'random').mockReturnValue(0.1);

    const result = resolveCombat(
      attacker, braveWeapon,
      defender, weapon,
      1, null, null,
      { ...skillCtx, atkMods: { ...skillCtx.atkMods } }
    );

    // Expect at least 2 strikes from attacker (brave)
    const attackerStrikes = result.events.filter(e => e.attacker === 'Attacker');
    expect(attackerStrikes.length).toBeGreaterThanOrEqual(2);

    // First strike should deal 0 damage (Shielded)
    expect(attackerStrikes[0].damage).toBe(0);
    expect(attackerStrikes[0].skillActivations.some(s => s.id === 'shielded')).toBe(true);

    // Second strike should deal normal damage (Shielded consumed)
    // Damage = 10 (STR) + 5 (Might) - 5 (DEF) = 10
    expect(attackerStrikes[1].damage).toBe(10);
    expect(attackerStrikes[1].skillActivations.some(s => s.id === 'shielded')).toBe(false);

    vi.restoreAllMocks();
  });

  it('executeWarp prioritizes tiles farthest from the attacker', async () => {
    const mockGrid = {
      cols: 10, rows: 10,
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
      {col:8, row:5}, {col:5, row:8}, {col:5, row:2}, {col:7, row:6}, {col:7, row:4}, {col:6, row:7}, {col:6, row:3}
    ];
    
    for (const p of possibleFarthest) {
      const match = bestPicks.find(bp => bp.col === p.col && bp.row === p.row);
      expect(match).toBeDefined();
    }
  });
});
