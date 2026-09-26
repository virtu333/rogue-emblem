import { describe, expect, it, vi } from 'vitest';
import { rollStrikeSkills, rollDefenseSkills } from '../src/engine/SkillSystem.js';
import { getCombatForecast, resolveCombat } from '../src/engine/Combat.js';
import {
  forecastProjection,
  formatCritChance,
  formatHitChance,
  formatStrikes,
  hitChancePercent,
  counterRisk,
  forecastTeachingHints,
  triangleText,
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

describe('triangle note sign (playtest 3: "Triangle advantage · −1 damage")', () => {
  const real = (name) => structuredClone(data.weapons.find((w) => w.name === name));
  it.each([
    ['Iron Sword', 'Iron Axe', 'Prof', 'Triangle advantage · +1 damage · +10 Hit'],
    ['Iron Axe', 'Iron Sword', 'Prof', 'Triangle disadvantage · -1 damage · -10 Hit'],
    ['Iron Sword', 'Iron Axe', 'Mast', 'Triangle advantage · +2 damage · +15 Hit'],
    ['Iron Axe', 'Iron Sword', 'Mast', 'Triangle disadvantage · -1 damage · -5 Hit'],
  ])('%s vs %s (%s) reads with matching label and signs', (atk, def, rank, text) => {
    const a = unit('A', real(atk));
    a.weaponRank = rank;
    expect(triangleText(forecast(a, unit('D', real(def))))).toBe(text);
  });
  it('the label always agrees with both signs', () => {
    for (const damage of [-2, -1, 1, 2])
      for (const hit of [-15, -10, -5, 5, 10, 15].filter(
        (h) => Math.sign(h) === Math.sign(damage),
      )) {
        const text = triangleText({ display: { triangle: { damage, hit } } });
        const advantage = text.includes('advantage') && !text.includes('disadvantage');
        expect(advantage).toBe(damage > 0);
        expect(text).toContain(`${damage > 0 ? '+' : ''}${damage} damage`);
      }
  });
});

describe('forecast number formats', () => {
  it('shows Hit as the real two-roll chance, not the raw rating', () => {
    // Hand-computed from the average-of-two-rolls CDF (HitRoll.js):
    // 72 -> 1 - 2(0.28)^2 = 84.3%; 75 -> 87.5%; 25 -> 12.5%; 50 -> 50%.
    expect(hitChancePercent(72)).toBe(84);
    expect(hitChancePercent(75)).toBe(88);
    expect(hitChancePercent(25)).toBe(13);
    expect(hitChancePercent(50)).toBe(50);
    expect(formatHitChance(72)).toBe('84%');
  });
  it('only a certain strike reads 100% and only an impossible one 0%', () => {
    expect(hitChancePercent(100)).toBe(100);
    expect(hitChancePercent(140)).toBe(100);
    expect(hitChancePercent(99.9)).toBe(99);
    expect(hitChancePercent(0)).toBe(0);
    expect(hitChancePercent(-10)).toBe(0);
    expect(hitChancePercent(0.5)).toBe(1);
  });
  it('gives each kind of number its own shape', () => {
    expect(formatStrikes(2)).toBe('×2');
    expect(formatStrikes(0)).toBe('×1');
    expect(formatStrikes(undefined)).toBe('×1');
    expect(formatCritChance(0)).toBe('0%');
    expect(formatCritChance(12)).toBe('12%');
    // damage 15, strikes ×1, hit 84%, crit 0% never read alike
    const shown = [String(15), formatStrikes(1), formatHitChance(72), formatCritChance(0)];
    expect(new Set(shown).size).toBe(4);
    expect(shown[0]).toMatch(/^\d+$/);
    expect(shown[1]).toMatch(/^×\d+$/);
    expect(shown[2]).toMatch(/^\d+%$/);
  });
});
