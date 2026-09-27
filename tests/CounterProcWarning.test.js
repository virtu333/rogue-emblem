import { describe, expect, it } from 'vitest';
import { getCombatForecast } from '../src/engine/Combat.js';
import { counterRisk } from '../src/ui/forecastDisplay.js';

// A blade with no crit, so only the counter's skill can surprise.
const blade = {
  name: 'Test Sword',
  type: 'Sword',
  might: 5,
  hit: 100,
  crit: 0,
  weight: 0,
  range: '1',
};
const unit = (name, stats, skills = []) => ({
  name,
  className: 'Myrmidon',
  currentHP: stats.HP,
  stats: { MAG: 0, SKL: 0, SPD: 5, RES: 0, LCK: 0, ...stats },
  skills,
  weapon: blade,
  weaponRank: 'Prof',
  faction: name === 'Edric' ? 'player' : 'enemy',
});

describe('the forecast warns when an enemy skill can change counter damage', () => {
  // The reviewer's case: 8 HP / 20 DEF against 25 attack. The plain counter deals
  // 5, but Luna ignores DEF and would deal 15 and kill.
  const edric = unit('Edric', { HP: 8, STR: 5, DEF: 20, SKL: 20 });
  const forecastAgainst = (skills) =>
    getCombatForecast(edric, blade, unit('Brute', { HP: 40, STR: 20, DEF: 0 }, skills), blade, 1);

  it('without a proc skill the proc-free counter is not lethal and there is no warning', () => {
    const f = forecastAgainst([]);
    expect(f.defender.damage).toBe(5);
    expect(counterRisk(f)).toBe('');
  });

  for (const skill of ['luna', 'lethality', 'adept', 'astra', 'aether', 'flare', 'seraph_strike'])
    it(`${skill} raises the warning`, () => {
      const f = forecastAgainst([skill]);
      expect(f.display.counterHasDamageProc).toBe(true);
      expect(counterRisk(f)).toBe('Enemy skills can change counterattack damage.');
    });

  it('a skill that cannot raise counter damage does not', () => {
    expect(forecastAgainst(['sol']).display.counterHasDamageProc).toBe(false);
  });
});
