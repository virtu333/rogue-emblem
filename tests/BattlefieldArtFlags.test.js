import { describe, it, expect } from 'vitest';
import { resolveBattlefieldArtFlags } from '../src/ui/battlefieldArtFlags.js';

describe('resolveBattlefieldArtFlags', () => {
  it('production: terrain, sprites and contrast are on for every device', () => {
    for (const search of ['', '?mobilePreview=1', '?terrainArt=classic&spriteArt=classic']) {
      expect(resolveBattlefieldArtFlags(search, { dev: false })).toEqual({
        terrain: true,
        sprites: true,
        contrast: true,
        terrainRenderer: null,
      });
    }
  });

  it('dev escape hatches switch pieces back to classic independently', () => {
    const f = (s) => resolveBattlefieldArtFlags(s, { dev: true });
    expect(f('')).toMatchObject({ terrain: true, sprites: true, contrast: true });
    expect(f('?terrainArt=classic')).toMatchObject({ terrain: false, sprites: true });
    expect(f('?spriteArt=classic')).toMatchObject({
      terrain: true,
      sprites: false,
      contrast: false,
    });
    expect(f('?battleContrast=original')).toMatchObject({ sprites: true, contrast: false });
    expect(f('?battlefieldArt=classic')).toMatchObject({
      terrain: false,
      sprites: false,
      contrast: false,
    });
  });

  it('dev ?terrainArt=<id> requests a registered renderer', () => {
    expect(
      resolveBattlefieldArtFlags('?terrainArt=procedural', { dev: true }).terrainRenderer,
    ).toBe('procedural');
    expect(resolveBattlefieldArtFlags('?terrainArt=classic', { dev: true }).terrainRenderer).toBe(
      null,
    );
  });
});
