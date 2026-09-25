import { describe, it, expect } from 'vitest';
import { resolveBattlefieldArtFlags } from '../src/ui/battlefieldArtFlags.js';

describe('resolveBattlefieldArtFlags', () => {
  it('production: terrain, traced sprites and contrast are on for every device', () => {
    for (const search of [
      '',
      '?mobilePreview=1',
      '?terrainArt=classic&spriteArt=classic',
      '?spriteArt=rebuilt',
    ]) {
      expect(resolveBattlefieldArtFlags(search, { dev: false })).toEqual({
        terrain: true,
        sprites: true,
        contrast: true,
        traced: true,
        terrainRenderer: null,
      });
    }
  });

  it('dev: traced is the default; ?spriteArt=rebuilt shows the rebuilt set instead', () => {
    const f = (s) => resolveBattlefieldArtFlags(s, { dev: true });
    expect(f('')).toMatchObject({ sprites: true, contrast: true, traced: true });
    // the old review switch is now simply the default
    expect(f('?spriteArt=traced')).toMatchObject({ sprites: true, traced: true });
    expect(f('?spriteArt=rebuilt')).toMatchObject({ sprites: true, contrast: true, traced: false });
    // classic sprites switch the whole sprite presentation (traced included) off
    expect(f('?spriteArt=classic')).toMatchObject({ sprites: false, traced: false });
    expect(f('?battlefieldArt=classic')).toMatchObject({ sprites: false, traced: false });
    // terrain and contrast switches leave the traced sprites alone
    expect(f('?terrainArt=classic')).toMatchObject({ terrain: false, traced: true });
    expect(f('?battleContrast=original')).toMatchObject({ contrast: false, traced: true });
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
