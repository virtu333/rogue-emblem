import { describe, expect, it } from 'vitest';
import { rankRequirementText } from '../src/ui/rosterDisplay.js';
import { forecastNotes } from '../src/ui/forecastDisplay.js';

describe('plain requirement and forecast wording', () => {
  it('names the weapon type and the rank in words, never Mast/Prof codes', () => {
    expect(rankRequirementText('Sword', 'Prof')).toBe('Needs Sword proficiency');
    expect(rankRequirementText('Tome', 'Mast')).toBe('Needs Tome Master rank');
    expect(rankRequirementText(null, 'Mast')).toBe('Needs Master rank');
    expect(rankRequirementText(undefined, undefined)).toBe('Needs proficiency');
  });

  it('only the attacker side notes a weapon switch, and only when the plan differs', () => {
    const side = { damage: 5, hit: 80, crit: 0, attackCount: 1, canCounter: true, hp: 20 };
    const forecast = { attacker: { ...side }, defender: { ...side } };
    const staff = { name: 'Heal' };
    const lance = { name: 'Iron Lance' };
    const plan = { planned: lance, equipped: staff };
    expect(forecastNotes(forecast, true, 20, plan)[0]).toBe('Confirming equips Iron Lance');
    expect(forecastNotes(forecast, false, 20, plan).join()).not.toContain('Confirming');
    expect(
      forecastNotes(forecast, true, 20, { planned: lance, equipped: lance }).join(),
    ).not.toContain('Confirming');
    expect(forecastNotes(forecast, true, 20).join()).not.toContain('Confirming');
  });
});
