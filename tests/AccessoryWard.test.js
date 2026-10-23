// The Warden's Buckler (engine/AccessoryWard.js): once a battle, the first blow that lands
// on its wearer for more than 1 damage deals 1.
//
// Numbers worked by hand (CLAUDE.md's formulas; Math.random() = 0 makes every strike land,
// and SKL 0 / LCK 0 with an Iron Sword's 0 Crit makes none crit):
//   the brigand: STR 14 + Might 5 - DEF 4 = 15 a blow; attack speed 20 - (3 - floor(14/5))
//   = 19 against Sera's 8: it doubles. Sera: STR 10 + 5 - DEF 5 = 10 a counter.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { resetUnitForBattle } from '../src/scenes/BattleScene.js';
import { HeadlessBattle } from './harness/HeadlessBattle.js';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import {
  getSkillCombatMods,
  rollDefenseSkills,
  rollStrikeSkills,
} from '../src/engine/SkillSystem.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { serializeUnit } from '../src/engine/UnitSerialization.js';
import { estimateArenaOdds } from '../src/engine/ArenaBout.js';
import { wardReady, wardStrike } from '../src/engine/AccessoryWard.js';
import { forecastNotes, forecastProjection, counterRisk } from '../src/ui/forecastDisplay.js';
import { splitStrikeActivations, fxForActivation } from '../src/ui/ProcVisualTheme.js';
import { formatAccessoryDetail } from '../src/utils/accessoryText.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const buckler = () =>
  structuredClone(gameData.accessories.find((a) => a.name === "Warden's Buckler"));
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));

afterEach(() => vi.restoreAllMocks());

const BASE = { HP: 30, STR: 10, MAG: 0, SKL: 0, SPD: 8, DEF: 4, RES: 3, LCK: 0, MOV: 5 };
function unit(name, faction, stats = {}, extra = {}) {
  const full = { ...BASE, ...stats };
  return {
    name,
    faction,
    level: 5,
    skills: [],
    stats: full,
    currentHP: full.HP,
    col: faction === 'player' ? 0 : 1,
    row: 0,
    weaponRank: 'Prof',
    weapon: weapon('Iron Sword'),
    accessory: null,
    ...extra,
  };
}

const sera = (extra = {}) => unit('Sera', 'player', { DEF: 4 }, { accessory: buckler(), ...extra });
const brigand = () => unit('Brigand', 'enemy', { STR: 14, SPD: 20, DEF: 5 });

const ctx = (a, d) => {
  const args = (x, y, init) => [x, y, [x], [y], gameData.skills, null, init, null, null];
  return {
    skillsData: gameData.skills,
    rollStrikeSkills,
    rollDefenseSkills,
    atkMods: getSkillCombatMods(...args(a, d, true)),
    defMods: getSkillCombatMods(...args(d, a, false)),
  };
};

function fight(attacker, defender, random = 0) {
  vi.spyOn(Math, 'random').mockReturnValue(random);
  const result = resolveCombat(
    attacker,
    attacker.weapon,
    defender,
    defender.weapon,
    1,
    null,
    null,
    ctx(attacker, defender),
  );
  vi.restoreAllMocks();
  return result;
}
const strikes = (r) => r.events.filter((e) => e.type === 'strike');

describe('the catalog row', () => {
  it('drops in Acts III and IV, and says what it does', () => {
    const acts = ['act1', 'act2', 'act3', 'act4'].filter((act) =>
      gameData.lootTables[act].accessories.includes("Warden's Buckler"),
    );
    expect(acts).toEqual(['act3', 'act4']);
    expect(formatAccessoryDetail(buckler())).toContain(
      'Once per map, the first hit on you that would deal more than 1 damage deals 1',
    );
  });
});

describe('in a combat', () => {
  it('the first landed blow deals 1, the next one in full', () => {
    const s = sera();
    const r = fight(brigand(), s);
    const onSera = strikes(r).filter((e) => e.target === 'Sera');
    expect(onSera.map((e) => e.damage)).toEqual([1, 15]);
    expect(onSera[0].buckler).toBe(true);
    expect(onSera[1].buckler).toBeUndefined();
    // 30 - 1 - 15: Sera lives, where 30 - 15 - 15 would have felled her.
    expect(r.defenderHP).toBe(14);
    expect(s._wardSpent).toBe(true);
    expect(wardReady(s)).toBe(false);
  });

  it('Miracle is not spent on a blow the buckler already holds to 1', () => {
    // Failure: Miracle fired on the first blow (it would have killed her at 10 HP), then the
    // buckler cut the same blow to 1, so both were spent and the second blow felled her.
    const s = unit('Sera', 'player', { DEF: 4, LCK: 30 }, { accessory: buckler() });
    s.skills = ['miracle'];
    s.currentHP = 10;
    const r = fight(brigand(), s);
    const onSera = strikes(r).filter((e) => e.target === 'Sera');
    expect(onSera[0].buckler).toBe(true);
    // 10 - 1 = 9, then the second 15-damage blow is Miracle's: she stands at 1.
    expect(r.defenderHP).toBe(1);
    expect(s._miracleUsed).toBe(true);
  });

  it('without the buckler the same fight fells her', () => {
    const s = sera({ accessory: null });
    expect(fight(brigand(), s).defenderHP).toBe(0);
  });

  it('a spent ward stays spent for the rest of the battle', () => {
    const s = sera();
    fight(brigand(), s);
    s.currentHP = 30;
    const again = strikes(fight(brigand(), s)).filter((e) => e.target === 'Sera');
    expect(again.map((e) => e.damage)).toEqual([15, 15]);
  });

  it('a miss leaves it ready', () => {
    const s = sera();
    // Math.random() = 0.999: every strike misses (Hit below 100).
    const r = fight(brigand(), s, 0.999);
    expect(strikes(r).every((e) => e.miss)).toBe(true);
    expect(wardReady(s)).toBe(true);
  });

  it('a blow of 1 or 0 leaves it ready (nothing to ward)', () => {
    const u = sera();
    expect(wardStrike(u, 1)).toEqual({ damage: 1, warded: false });
    expect(wardStrike(u, 0)).toEqual({ damage: 0, warded: false });
    expect(wardReady(u)).toBe(true);
    expect(wardStrike(u, 40)).toEqual({ damage: 1, warded: true });
    expect(wardReady(u)).toBe(false);
  });

  it('wards a crit down to 1 too', () => {
    const s = sera();
    const killer = brigand();
    killer.stats.SKL = 40; // Crit 20 + 0 - 0: certain on a 0 roll
    const first = strikes(fight(killer, s)).find((e) => e.target === 'Sera');
    expect(first.isCrit).toBe(true);
    expect(first.damage).toBe(1);
  });

  it('the strike carries the shield proc for the banner and flash', () => {
    const s = sera();
    const first = strikes(fight(brigand(), s)).find((e) => e.target === 'Sera');
    const { target } = splitStrikeActivations(first.skillActivations, gameData.skills);
    expect(target.map((a) => a.id)).toContain('warden_buckler');
    expect(fxForActivation(target.find((a) => a.id === 'warden_buckler'))).toEqual({
      key: 'fx_shield',
      at: 'target',
    });
  });
});

describe('across a battle', () => {
  it('the battle checkpoint keeps it spent; a run save clears it', () => {
    const s = sera();
    fight(brigand(), s);
    expect(serializeBattleUnit(s)._wardSpent).toBe(true);
    expect('_wardSpent' in serializeBattleUnit(sera())).toBe(false);
    expect('_wardSpent' in serializeUnit(s)).toBe(false);
  });

  it("a new battle's deploy readies it, in the scene and in the harness", () => {
    const s = sera();
    s._wardSpent = true;
    resetUnitForBattle(s);
    expect(wardReady(s)).toBe(true);

    const veteran = sera();
    veteran._wardSpent = true;
    const battle = new HeadlessBattle(gameData, { act: 'act1', objective: 'rout' }, [veteran]);
    battle.init();
    expect(battle.playerUnits).toContain(veteran);
    expect(wardReady(veteran)).toBe(true);
  });

  it('every arena bout the odds play starts with it ready', () => {
    // Arena fighters hold their weapons in a bag they are proficient with.
    const fighter = (u) => {
      u.inventory = [u.weapon];
      u.proficiencies = [{ type: 'Sword', rank: 'Prof' }];
      return u;
    };
    const odds = (u) =>
      estimateArenaOdds(fighter(u), fighter(brigand()), gameData, { trials: 40, maxRounds: 1 });
    const s = sera();
    s._wardSpent = true;
    // One round: Sera strikes, the brigand strikes twice. Warded she lives through two
    // hits (a draw at the cap); unwarded only when one misses, so warded draws are likelier.
    expect(odds(sera()).draw).toBeGreaterThan(odds(sera({ accessory: null })).draw);
    expect(odds(s)).toEqual(odds(sera()));
    // The live unit is never touched by the estimate.
    expect(s._wardSpent).toBe(true);
  });
});

describe('the forecast', () => {
  const forecast = (s) => {
    const b = brigand();
    return getCombatForecast(b, b.weapon, s, s.weapon, 1, null, null, ctx(b, s));
  };

  it('marks a side whose ward is ready', () => {
    expect(forecast(sera()).defender.ward).toBe(true);
    const spent = sera();
    spent._wardSpent = true;
    expect(forecast(spent).defender.ward).toBeUndefined();
  });

  it('projects the first landed blow at 1', () => {
    const f = forecast(sera());
    expect(f.attacker.damage).toBe(15);
    expect(forecastProjection(f).defenderHP).toBe(14);
    const spent = sera();
    spent._wardSpent = true;
    expect(forecastProjection(forecast(spent)).defenderHP).toBe(0);
  });

  it("names it under the wearer's column", () => {
    expect(forecastNotes(forecast(sera()), false, 30).join('\n')).toContain(
      "Warden's Buckler: the first hit that would deal more than 1 deals 1",
    );
  });

  it('a lone counter blow on a warded attacker is no risk', () => {
    const s = sera({});
    s.stats.HP = 20;
    s.currentHP = 12;
    const foe = unit('Brigand', 'enemy', { STR: 14, SPD: 1, DEF: 30 });
    const f = getCombatForecast(s, s.weapon, foe, foe.weapon, 1, null, null, ctx(s, foe));
    expect(f.defender.attackCount).toBe(1);
    expect(counterRisk(f, 12)).toBe('');
    s._wardSpent = true;
    const g = getCombatForecast(s, s.weapon, foe, foe.weapon, 1, null, null, ctx(s, foe));
    expect(counterRisk(g, 12)).toContain('could defeat Sera');
  });
});
