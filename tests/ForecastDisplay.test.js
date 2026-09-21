import { describe, expect, it, vi } from 'vitest';
import { rollStrikeSkills, rollDefenseSkills } from '../src/engine/SkillSystem.js';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import {
  forecastProjection,
  counterRisk,
  forecastTeachingHints,
} from '../src/ui/forecastDisplay.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
const sword = {
  name: 'Sword',
  type: 'Sword',
  range: '1',
  might: 5,
  hit: 100,
  crit: 0,
  weight: 0,
  special: '',
};
function unit(name, weapon = { ...sword }) {
  return {
    name,
    weapon,
    faction: name === 'A' ? 'player' : 'enemy',
    className: 'Myrmidon',
    skills: [],
    currentHP: 20,
    stats: { HP: 20, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 4, RES: 3, LCK: 20 },
    weaponRank: 'Prof',
  };
}
const forecast = (a, d) =>
  getCombatForecast(a, a.weapon, d, d.weapon, 1, null, null, {
    skillsData: data.skills,
    imbuesData: data.imbues,
  });
describe('conservative forecast estimates', () => {
  it.each(['aether', 'flare', 'seraph_strike'])('warns about %s on a counter', (skill) => {
    const a = unit('A'),
      d = unit('D');
    d.skills = [skill];
    expect(counterRisk(forecast(a, d))).toContain('Enemy skills');
  });
  it('explains a weaponless forecast without a misleading HP estimate', () => {
    const f = forecast(unit('A', null), unit('D'));
    expect(forecastProjection(f)).toBeNull();
    expect(f.display.counterReason).toBe('No attacking combat weapon equipped');
  });
  it.each([
    'dragon_scale',
    'drain',
    'zombie_drain',
    'pavise',
    'aegis',
    'aether',
    'flare',
    'seraph_strike',
  ])('omits %s on a unit or passed weapon', (skill) => {
    const a = unit('A'),
      d = unit('D');
    d.skills = [skill];
    expect(forecastProjection(forecast(a, d))).toBeNull();
    d.skills = [];
    const passed = { ...d.weapon, _grantedSkill: skill };
    expect(forecastProjection(getCombatForecast(a, a.weapon, d, passed, 1, null, null))).toBeNull();
  });
  it.each(['venomous', 'deathburst'])('omits %s whose damage is applied by the scene', (affix) => {
    const a = unit('A'),
      d = unit('D');
    d.affixes = [affix];
    expect(forecastProjection(forecast(a, d))).toBeNull();
  });
  it('omits poison imbues rather than showing pre-poison HP', () => {
    const a = unit('A'),
      d = unit('D');
    a.weapon._imbueId = data.imbues.imbues.find((i) => i.effect?.type === 'postCombatPoison')?.id;
    expect(a.weapon._imbueId).toBeTruthy();
    expect(forecastProjection(forecast(a, d))).toBeNull();
  });
  it('keeps lethal counter warning when a defense proc can prevent the predicted KO', () => {
    const a = unit('A'),
      d = unit('D');
    a.currentHP = 10;
    a.stats.STR = 20;
    d.stats.STR = 20;
    a.stats.SKL = d.stats.SKL = 100;
    a.stats.LCK = d.stats.LCK = 100;
    d.skills = ['pavise'];
    const f = forecast(a, d);
    expect(f.attacker.hit).toBe(100);
    expect(f.attacker.damage).toBeGreaterThanOrEqual(d.currentHP);
    expect(counterRisk(f)).toContain('could defeat A');
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      const r = resolveCombat(a, a.weapon, d, d.weapon, 1, null, null, {
        skillsData: data.skills,
        rollStrikeSkills,
        rollDefenseSkills,
      });
      expect(r.attackerHP).toBe(0);
      expect(r.defenderHP).toBeGreaterThan(0);
    } finally {
      random.mockRestore();
    }
  });
  it('suppresses impossible ordinary counter and leaves projected actual HP untouched', () => {
    const a = unit('A'),
      d = unit('D');
    a.stats.SKL = 100;
    a.stats.STR = 30;
    d.stats.STR = 30;
    const before = JSON.stringify([a, d]);
    const f = forecast(a, d);
    expect(forecastProjection(f)).toEqual({ attackerHP: 20, defenderHP: 0 });
    expect(counterRisk(f)).toBe('');
    expect(JSON.stringify([a, d])).toBe(before);
  });
  it('offers targeted teaching without changing forecast state', () => {
    const a = unit('A'),
      d = unit('D');
    a.stats.SPD = 20;
    const f = forecast(a, d);
    const before = JSON.stringify(f);
    expect(forecastTeachingHints(f).some((h) => h.id === 'battle_doubling')).toBe(true);
    expect(JSON.stringify(f)).toBe(before);
  });
});
