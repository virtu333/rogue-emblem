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

    // Legendary arts should carry meaningful HP risk.
    const legendaryArts = arts.filter((art) => Array.isArray(art?.legendaryWeaponIds) && art.legendaryWeaponIds.length > 0);
    expect(legendaryArts.length).toBeGreaterThan(0);
    for (const art of legendaryArts) {
      expect(art.requiredRank).toBe('Mast');
      expect(art.hpCost).toBeGreaterThanOrEqual(5);
      expect(art.perMapLimit).toBeLessThanOrEqual(2);
    }
  });
});
