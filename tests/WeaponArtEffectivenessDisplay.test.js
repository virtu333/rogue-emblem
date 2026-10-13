import { describe, it, expect } from 'vitest';
import {
  formatWeaponArtEffects,
  weaponArtDetailLines,
  weaponArtEffectivenessText,
} from '../src/ui/weaponArtDisplay.js';
import { summarizeWeaponArtEffect } from '../src/ui/WeaponArtVisibility.js';
import { getCombinedEffectivenessMultiplier } from '../src/engine/Combat.js';
import { getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { DARK_CLASSES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const art = (id) => data.weaponArts.arts.find((a) => a.id === id);
const weapon = (name) => data.weapons.find((w) => w.name === name);

// Endword and Firstwind are already 3x against the foes their arts name, and an art's 3x
// on top of a weapon's 3x is dealt as 5x (the cap): the text must say what is dealt.
describe('a legendary art reads the multiplier its weapon deals', () => {
  it("Divine Flare covers every dark class Endword's own effectiveness does", () => {
    const named = art('legend_divine_flare').combatMods.effectiveness.classNames;
    expect([...named].sort()).toEqual([...DARK_CLASSES].sort());
  });

  it('Divine Flare deals 5x to a Necromancer and a Circle Adept, as to a Dark Knight', () => {
    const mods = getWeaponArtCombatMods(art('legend_divine_flare'));
    for (const className of ['Necromancer', 'Circle Adept', 'Dark Knight'])
      expect(getCombinedEffectivenessMultiplier(weapon('Endword'), { className }, mods)).toBe(5);
  });

  it('Divine Flare on Endword says x5 against every dark class', () => {
    const text = formatWeaponArtEffects(art('legend_divine_flare'), { weapon: weapon('Endword') });
    expect(text).toContain(
      "×5 weapon might against Dark Knight, Warlock, Necromancer, Circle Adept, Zombie, Revenant, Dragon, Dragon Lord, Entity (with the weapon's own)",
    );
    expect(text).not.toContain('×3');
  });

  it('Tempest on Firstwind says x5 against fliers', () => {
    expect(weaponArtEffectivenessText(art('legend_tempest'), weapon('Firstwind'))).toBe(
      "×5 weapon might against flying (with the weapon's own)",
    );
    expect(
      weaponArtDetailLines(art('legend_tempest'), { weapon: weapon('Firstwind') }).join('\n'),
    ).toContain("×5 weapon might against flying (with the weapon's own)");
  });

  it('Blood Lance on Gae Bolg stays x3 against cavalry (the lance has no effectiveness)', () => {
    expect(weaponArtEffectivenessText(art('legend_blood_lance'), weapon('Gae Bolg'))).toBe(
      '×3 weapon might against cavalry',
    );
  });

  it("the compact summary reads the weapon's multiplier too", () => {
    expect(
      summarizeWeaponArtEffect(art('legend_tempest'), { weapon: weapon('Firstwind') }),
    ).toContain('×5 weapon might against flying');
  });

  it('with no weapon the art says only its own multiplier', () => {
    expect(weaponArtEffectivenessText(art('legend_tempest'))).toBe(
      '×3 weapon might against flying',
    );
    expect(weaponArtEffectivenessText(art('lance_countering_strike'), weapon('Javelin'))).toBe('');
  });
});
