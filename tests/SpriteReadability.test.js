import { describe, it, expect } from 'vitest';
import { liftPlayerPalette, usesPlayerPaletteLift } from '../src/ui/SpriteReadability.js';
describe('legacy player palette lift', () => {
  it('preserves transparency, dark ink, and bright highlights', () => {
    const pixels = new Uint8ClampedArray([70, 80, 90, 0, 10, 15, 20, 255, 240, 245, 250, 200]);
    const before = [...pixels];
    liftPlayerPalette(pixels);
    expect([...pixels]).toEqual(before);
  });
  it('brightens midtones while preserving alpha and warm hue', () => {
    const pixels = new Uint8ClampedArray([110, 75, 50, 255, 45, 60, 80, 128]);
    liftPlayerPalette(pixels);
    expect(pixels[0]).toBeGreaterThan(110);
    expect(pixels[0]).toBeGreaterThan(pixels[1]);
    expect(pixels[1]).toBeGreaterThan(pixels[2]);
    expect(pixels[6]).toBeGreaterThan(80);
    expect(pixels[3]).toBe(255);
    expect(pixels[7]).toBe(128);
  });
  it('only touches the four selected player class textures', () => {
    for (const key of ['archer', 'myrmidon', 'duelist', 'knight']) {
      expect(usesPlayerPaletteLift(key)).toBe(true);
      expect(usesPlayerPaletteLift(`rebuilt-${key}`)).toBe(true);
      expect(usesPlayerPaletteLift(`enemy_${key}`)).toBe(false);
      expect(usesPlayerPaletteLift(`rebuilt-enemy_${key}`)).toBe(false);
    }
    expect(usesPlayerPaletteLift('lord_edric')).toBe(false);
  });
});
