import { describe, expect, it } from 'vitest';
import { forgeImpactLine, shopRequirementLabel } from '../src/ui/itemDecisionText.js';
import { forecastModifierText } from '../src/ui/forecastDisplay.js';
import { tutorialCoachState } from '../src/ui/tutorialCoachModel.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
describe('decision details', () => {
  it('does not impose weapon proficiency on scrolls', () => {
    expect(shopRequirementLabel({ name: 'Sol Scroll', type: 'Scroll', rankRequired: 'Prof' })).toBe(
      '',
    );
    expect(
      shopRequirementLabel({ name: 'Hexblade Scroll', type: 'Scroll', rankRequired: 'Mast' }),
    ).toBe('');
    // Same wording as every other rank line (rankRequirementText).
    expect(shopRequirementLabel({ type: 'Lance', rankRequired: 'Mast' })).toBe(
      'Needs Lance Master rank',
    );
    expect(shopRequirementLabel({ type: 'Sword', rankRequired: 'Prof' })).toBe(
      'Needs Sword proficiency',
    );
    expect(shopRequirementLabel({ type: 'Sword' })).toBe('');
  });
  it('previews real forge impact without mutating inventory', () => {
    const owner = {
      stats: { STR: 7, MAG: 2, SPD: 10, SKL: 8, LCK: 3 },
      proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    };
    const weapon = {
      name: 'Steel Sword',
      type: 'Sword',
      tier: 'Steel',
      might: 8,
      hit: 80,
      crit: 0,
      weight: 10,
      range: '1',
    };
    const before = JSON.stringify(weapon);
    expect(forgeImpactLine(owner, weapon, 'might')).toBe('Attack 15 → 16');
    expect(forgeImpactLine(owner, weapon, 'hit')).toBe('Hit 99 → 104');
    expect(forgeImpactLine(owner, weapon, 'crit')).toBe('Crit 4 → 9');
    expect(forgeImpactLine(owner, weapon, 'weight')).toBe('Attack 15 → 15 · AS 1 → 2');
    expect(JSON.stringify(weapon)).toBe(before);
  });
  it('explains catalog combat modifiers and class mastery', () => {
    for (const trait of data.traits.filter((t) => t.combatMods))
      expect(forecastModifierText({ id: `trait_${trait.id}` }, {}, data), trait.id).not.toBe('');
    for (const skill of data.skills.filter((s) =>
      ['passive', 'passive-aura', 'on-combat-start', 'on-attack', 'on-defend'].includes(s.trigger),
    ))
      expect(forecastModifierText(skill, {}, data), skill.id).not.toBe('');
    for (const affix of data.affixes.affixes)
      expect(forecastModifierText(affix, {}, data), affix.id).not.toBe('');
    expect(forecastModifierText({ id: 'mastery' }, { className: 'Lord' }, data)).toContain('+1');
  });
  it('teaches a ranged unit its actual range', () => {
    const info = tutorialCoachState({
      step: 4,
      gateReleased: true,
      phase: 'player',
      state: 'PLAYER_IDLE',
      enemies: 2,
      units: [{ name: 'Sera', hp: 20, maxHp: 20, attackRange: { min: 1, max: 2 } }],
    });
    expect(info.detail).toContain('1–2 tiles');
    expect(info.detail).not.toContain('next to');
  });
});
