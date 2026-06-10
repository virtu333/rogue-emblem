// Regression tests for Miracle's lethality check (Wave 2 fix):
// resolveCombat tracks HP in locals during multi-strike rounds, so
// defender.currentHP is stale by the second strike. Miracle must judge
// "would this strike kill?" against the LIVE hp passed by rollStrike —
// the old code could let a doubled unit die straight through Miracle
// (under-fire) or burn the once-per-battle charge on a hit the unit
// didn't survive anyway (waste).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { rollDefenseSkills, rollStrikeSkills } from '../src/engine/SkillSystem.js';
import { resolveCombat } from '../src/engine/Combat.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

function makeDefender(overrides = {}) {
  return {
    name: 'Defender',
    skills: ['miracle'],
    stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 100, MOV: 4 },
    currentHP: 20,
    faction: 'player',
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rollDefenseSkills Miracle liveHP', () => {
  it('triggers from live HP when stale currentHP would miss the lethal strike', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // always proc (LCK 100)
    const defender = makeDefender(); // currentHP stale at 20
    // Second strike of a double: live HP is 8, incoming damage 12.
    const result = rollDefenseSkills(defender, 12, true, gameData.skills, 8);
    expect(result.miracleTriggered).toBe(true);
    expect(result.modifiedDamage).toBe(7); // survive at exactly 1 HP from live 8
    expect(defender._miracleUsed).toBe(true);
  });

  it('does not waste the charge on a non-lethal strike judged from live HP', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const defender = makeDefender({ currentHP: 5 }); // stale value looks lethal
    // Live HP 15 (e.g. healed by drain order quirks); 12 damage is not lethal.
    const result = rollDefenseSkills(defender, 12, true, gameData.skills, 15);
    expect(result.miracleTriggered).toBe(false);
    expect(result.modifiedDamage).toBe(12);
    expect(defender._miracleUsed).toBeUndefined();
  });

  it('falls back to defender.currentHP when no live HP is provided', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const defender = makeDefender({ currentHP: 10 });
    const result = rollDefenseSkills(defender, 12, true, gameData.skills);
    expect(result.miracleTriggered).toBe(true);
    expect(result.modifiedDamage).toBe(9);
  });
});

describe('resolveCombat Miracle on multi-strike rounds', () => {
  it('saves a doubled defender on the lethal second strike', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // all hits land, all procs fire, no crits? 0 < crit → crit!
    // Math.random()=0 makes crits fire too; neutralize by zeroing SKL-driven crit below.
    const ironSword = gameData.weapons.find((w) => w.name === 'Iron Sword');

    const attacker = {
      name: 'Attacker',
      skills: [],
      stats: { HP: 30, STR: 10, MAG: 0, SKL: 0, SPD: 20, DEF: 5, RES: 5, LCK: 0, MOV: 4 },
      currentHP: 30,
      faction: 'enemy',
      weapon: { ...ironSword, crit: 0 },
      col: 0,
      row: 0,
    };
    // SPD gap >= 5 → attacker doubles. Each hit: 10 + might - 2 DEF.
    // LCK 30 keeps avoid below the attacker's hit (so strikes land with the
    // mocked roll of 0) while still proccing Miracle (0 < 30).
    const defender = makeDefender({
      weapon: null,
      col: 1,
      row: 0,
      stats: { HP: 20, STR: 5, MAG: 0, SKL: 0, SPD: 5, DEF: 2, RES: 5, LCK: 30, MOV: 4 },
    });
    const perHit = 10 + (ironSword.might || 0) - 2;
    // First strike leaves the defender below perHit so strike 2 is lethal from
    // LIVE hp while stale currentHP (20) would survive it on paper.
    defender.currentHP = perHit + Math.ceil(perHit / 2);
    const staleHP = defender.currentHP;
    expect(staleHP).toBeGreaterThan(perHit); // stale check would NOT see lethal

    // Combat only builds the per-strike context when rollStrikeSkills exists.
    const result = resolveCombat(attacker, attacker.weapon, defender, null, 1, null, null, {
      skillsData: gameData.skills,
      rollStrikeSkills,
      rollDefenseSkills,
    });

    const strikes = result.events.filter((s) => s.type === 'strike' && !s.miss);
    expect(strikes.length).toBeGreaterThanOrEqual(2);
    // Miracle must have fired on the lethal second strike: defender survives at 1 HP.
    expect(result.defenderHP).toBe(1);
    expect(result.defenderDied).toBe(false);
    const miracleStrike = strikes.find((s) => s.skillActivations?.some((a) => a.id === 'miracle'));
    expect(miracleStrike).toBeTruthy();
  });
});
