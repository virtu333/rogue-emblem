import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

import { HomeBaseScene } from '../src/scenes/HomeBaseScene.js';

describe('HomeBaseScene upgrade description helpers', () => {
  it('describes deadly arsenal split tiers', () => {
    const scene = new HomeBaseScene();
    expect(scene._getActionDesc({ effects: [{ deadlyArsenalTier: 1 }] })).toBe('Edric starting sword upgrades');
    expect(scene._formatEffectValue({ deadlyArsenalTier: 1 })).toBe('Tier 1');
    expect(scene._formatEffectValue({ deadlyArsenalTier: 2 })).toBe('Tier 2');
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

  it('formats and describes lethal armory upgrades', () => {
    const scene = new HomeBaseScene();

    expect(scene._getActionDesc({ effects: [{ lethalArmoryTier: 1 }] })).toBe('Recruits can gain extra weapons');
    expect(scene._formatEffectValue({ lethalArmoryTier: 2 })).toBe('Tier 2');
    expect(scene._formatEffectValue({ lethalArmoryTier: 3 })).toBe('Tier 3');
  });

  it('formats and describes recruit field supplies upgrade', () => {
    const scene = new HomeBaseScene();

    expect(scene._getActionDesc({ effects: [{ recruitStartingVulnerary: 1 }] })).toBe('Recruits start with Vulnerary');
    expect(scene._formatEffectValue({ recruitStartingVulnerary: 1 })).toBe('+1');
  });
});
