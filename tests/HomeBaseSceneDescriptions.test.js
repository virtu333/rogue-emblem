import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';

describe('HomeBaseScene upgrade description helpers', () => {
  it('describes deadly arsenal without legacy weapon-art unlock suffix', () => {
    const scene = new HomeBaseScene();
    const upgrade = {
      description: 'deadly arsenal',
      effects: [{
        deadlyArsenal: 1,
      }],
    };

    const desc = scene._getActionDesc(upgrade);
    expect(desc).toBe('Random Silver/Killer/Brave/Legend weapon');
  });

  it('describes iron/steel/art adept weapon-art spawn upgrades', () => {
    const scene = new HomeBaseScene();

    expect(scene._getActionDesc({ effects: [{ ironArms: 1 }] })).toBe('Iron weapons can spawn with arts');
    expect(scene._getActionDesc({ effects: [{ steelArms: 1 }] })).toBe('Steel weapons can spawn with arts');
    expect(scene._getActionDesc({ effects: [{ artAdept: 1 }] })).toBe('Extra art on a lord starting weapon');
  });

  it('describes upgraded weapon quality economy upgrade', () => {
    const scene = new HomeBaseScene();

    const effect = { lootWeaponQualityBonus: 10 };
    expect(scene._getActionDesc({ effects: [effect] })).toBe('Higher chance for upgraded weapons');
    expect(scene._formatEffectValue(effect)).toBe('+10%');
  });

  it('formats and describes extra starting unit tier upgrade', () => {
    const scene = new HomeBaseScene();

    expect(scene._getActionDesc({ effects: [{ extraStartingUnitTier: 1 }] })).toBe('Extra random starting unit class pool');
    expect(scene._formatEffectValue({ extraStartingUnitTier: 1 })).toBe('Archer');
    expect(scene._formatEffectValue({ extraStartingUnitTier: 4 })).toBe('Archer/Knight/Cavalier/Paladin');
    expect(scene._formatEffectValue({ extraStartingUnitTier: 9 })).toBe('Tier 9');
  });
});
