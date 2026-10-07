import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

function readWeaponArts(path) {
  const payload = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(payload?.arts) ? payload.arts : [];
}

describe('weapon arts data guards', () => {
  it('keeps data and public weapon-arts JSON in sync', () => {
    const source = JSON.parse(readFileSync('data/weaponArts.json', 'utf8'));
    const publicCopy = JSON.parse(readFileSync('public/data/weaponArts.json', 'utf8'));
    expect(publicCopy).toEqual(source);
  });

  it('enforces alpha balance guardrails for high-confidence arts', () => {
    const arts = readWeaponArts('data/weaponArts.json');
    const byId = new Map(arts.map((art) => [art.id, art]));

    // Longshot should not be a near-free, always-pick crit package.
    const longshot = byId.get('bow_longshot');
    expect(longshot).toBeTruthy();
    expect(longshot.hpCost).toBeGreaterThanOrEqual(3);
    expect(longshot.perMapLimit).toBeLessThanOrEqual(2);
    expect(longshot.combatMods?.hitBonus ?? 0).toBeLessThanOrEqual(12);
    expect(longshot.combatMods?.critBonus ?? 0).toBeLessThanOrEqual(8);

    // Legendary arts should carry meaningful HP risk and remain Mast-gated.
    const legendaryArts = arts.filter(
      (art) => Array.isArray(art?.legendaryWeaponIds) && art.legendaryWeaponIds.length > 0,
    );
    expect(legendaryArts.length).toBeGreaterThan(0);
    const lightLegendaryIds = ['legend_gemini_tempest', 'legend_starfall_volley'];
    for (const art of legendaryArts) {
      expect(art.requiredRank).toBe('Mast');
      expect(art.hpCost).toBeGreaterThanOrEqual(5);
      if (lightLegendaryIds.includes(art.id)) {
        expect(art.perMapLimit).toBeLessThanOrEqual(3);
      } else {
        expect(art.perMapLimit).toBeLessThanOrEqual(2);
      }
    }

    // Non-legendary arts are Prof-gated, except Override (docs/specs/phase3.md 3F): a
    // Silver art that asks for Master rank and carries the same HP risk as a legendary.
    const nonLegendaryArts = arts.filter(
      (art) => !Array.isArray(art?.legendaryWeaponIds) || art.legendaryWeaponIds.length === 0,
    );
    expect(nonLegendaryArts.length).toBeGreaterThan(0);
    for (const art of nonLegendaryArts) {
      expect(art.requiredRank).toBe(art.id === 'lance_override' ? 'Mast' : 'Prof');
    }

    // Every other Mast art is legendary-only and distribution remains stable.
    const mastArts = arts.filter((art) => art?.requiredRank === 'Mast');
    expect(mastArts.length).toBe(17);
    for (const art of mastArts.filter((a) => a.id !== 'lance_override')) {
      expect(Array.isArray(art?.legendaryWeaponIds)).toBe(true);
      expect(art.legendaryWeaponIds.length).toBeGreaterThan(0);
    }
    const override = byId.get('lance_override');
    expect(override.hpCost).toBeGreaterThanOrEqual(5);
    expect(override.perMapLimit).toBeLessThanOrEqual(2);

    const profArts = arts.filter((art) => art?.requiredRank === 'Prof');
    expect(profArts.length).toBe(73);

    const nonLegendaryMastArts = arts.filter(
      (art) =>
        art?.requiredRank === 'Mast' &&
        (!Array.isArray(art?.legendaryWeaponIds) || art.legendaryWeaponIds.length === 0),
    );
    expect(nonLegendaryMastArts.map((art) => art.id)).toEqual(['lance_override']);
  });
});
