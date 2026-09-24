import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { drawWeatheredTile, WEATHERED_TERRAINS } from '../src/ui/WeatheredTerrain.js';
import { BATTLEFIELD_LAB_MAPS } from '../src/utils/battlefieldLabMaps.js';
const terrain = JSON.parse(readFileSync(new URL('../data/terrain.json', import.meta.url)));
const templates = JSON.parse(readFileSync(new URL('../data/mapTemplates.json', import.meta.url)));
function context() {
  return Object.fromEntries(
    [
      'drawImage',
      'fillRect',
      'save',
      'restore',
      'beginPath',
      'rect',
      'clip',
      'translate',
      'rotate',
    ].map((name) => [name, vi.fn()]),
  );
}
const art = Object.fromEntries(
  ['meadow-weathered', 'structures-weathered', 'fort-compact', 'hazards-weathered'].map((name) => [
    name,
    {
      width: name === 'hazards-weathered' ? 1536 : 1280,
      height: name === 'hazards-weathered' ? 1024 : 1280,
    },
  ]),
);
describe('weathered terrain coverage', () => {
  it('renders every mechanical terrain without mutating the grid or consuming RNG', () => {
    const random = vi.spyOn(Math, 'random');
    try {
      for (const t of terrain) {
        const ctx = context();
        expect(WEATHERED_TERRAINS.has(t.name), t.name).toBe(true);
        expect(
          drawWeatheredTile(ctx, art, () => t.name, 3, 2),
          t.name,
        ).toBe(true);
        expect(ctx.imageSmoothingEnabled).toBe(false);
      }
      expect(random).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
    }
  });
  it.each(['Ice', 'Lava Crack', 'Swamp', 'Bog', 'Acidic Swamp', 'Acidic Bog'])(
    'uses the correct square atlas cell for %s',
    (name) => {
      const i = ['Ice', 'Lava Crack', 'Swamp', 'Bog', 'Acidic Swamp', 'Acidic Bog'].indexOf(name),
        ctx = context();
      drawWeatheredTile(ctx, art, () => name, 0, 0);
      expect(ctx.drawImage).toHaveBeenCalledExactlyOnceWith(
        art['hazards-weathered'],
        (i % 3) * 512,
        Math.floor(i / 3) * 512,
        512,
        512,
        0,
        0,
        48,
        48,
      );
    },
  );
  it('leaves the original tile available when optional hazard art is absent', () => {
    const ctx = context();
    expect(drawWeatheredTile(ctx, {}, () => 'Ice', 0, 0)).toBe(false);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });
  it.each(['tundra', 'volcano'])('uses %s art without changing terrain meaning', (biome) => {
    const ctx = context(),
      sheet = { width: 1280, height: 1280 };
    drawWeatheredTile(ctx, { ...art, [`meadow-${biome}`]: sheet }, () => 'Plain', 0, 0, { biome });
    expect(ctx.drawImage.mock.calls[0][0]).toBe(sheet);
  });
  it('catalog entries use valid rout templates in a permitted act', () => {
    for (const map of BATTLEFIELD_LAB_MAPS) {
      const template = templates.rout.find((t) => t.id === map.id);
      expect(template, map.id).toBeDefined();
      if (template.acts) expect(template.acts, map.id).toContain(map.act);
    }
  });
});
