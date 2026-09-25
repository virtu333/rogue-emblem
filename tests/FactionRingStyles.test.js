import { describe, it, expect } from 'vitest';
import {
  RING_STYLES,
  RING_KEYLINE,
  selectRingStyle,
  ringGeometry,
  rasterizeRing,
} from '../src/art/factionRingStyles.js';

const hex = (h) => {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const px = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [...img.data.slice(i, i + 4)];
};

describe('selectRingStyle', () => {
  it.each([
    [{ faction: 'player' }, 'player'],
    [{ faction: 'enemy' }, 'enemy'],
    [{ faction: 'enemy', isBoss: true }, 'boss'],
    [{ faction: 'enemy', isBoss: true, isEntity: true }, 'entity'],
    [{ faction: 'npc' }, 'npc'],
    [{ faction: 'npc', isCaravan: true }, 'caravan'],
    [null, 'player'],
  ])('%j → %s', (unit, style) => {
    expect(selectRingStyle(unit)).toBe(style);
  });
});

describe('ring palette', () => {
  it('faction hues are distinct: player steel-blue, enemy crimson, NPC verdigris', () => {
    const [pr, , pb] = hex(RING_STYLES.player.band);
    expect(pb).toBeGreaterThan(pr);
    const [er, eg, eb] = hex(RING_STYLES.enemy.band);
    expect(er).toBeGreaterThan(eg * 2);
    expect(er).toBeGreaterThan(eb * 2);
    const [nr, ng] = hex(RING_STYLES.npc.band);
    expect(ng).toBeGreaterThan(nr);
  });

  it('bosses never borrow the player gold, and read heavier than regular enemies', () => {
    expect(RING_STYLES.boss.band).toBe(RING_STYLES.enemy.band);
    expect(RING_STYLES.boss.bandWidth).toBeGreaterThan(RING_STYLES.enemy.bandWidth);
    expect(RING_STYLES.boss.outer).toBeTruthy();
    expect(ringGeometry('boss').rx).toBeGreaterThan(ringGeometry('enemy').rx);
  });

  it('keyline is dark enough to hold the ring on snow and stone', () => {
    expect(lum(hex(RING_KEYLINE.color))).toBeLessThan(20);
    for (const key of ['player', 'enemy', 'npc']) {
      // The band must stand off the dark keyline over lava and swamp.
      expect(lum(hex(RING_STYLES[key].band)) - lum(hex(RING_KEYLINE.color))).toBeGreaterThan(60);
    }
  });
});

describe('rasterizeRing', () => {
  it('draws translucent fill, opaque band and dark keyline in order from the center', () => {
    const img = rasterizeRing('player');
    const cy = Math.floor(img.cy);
    const center = px(img, Math.floor(img.cx), cy);
    expect(center[3]).toBeGreaterThan(90);
    expect(center[3]).toBeLessThan(170);
    expect(center.slice(0, 3)).toEqual(hex(RING_STYLES.player.fill));
    // Walk right along the horizontal axis: fill → band (opaque) → keyline → empty.
    const row = [];
    for (let x = Math.floor(img.cx); x < img.width; x++) row.push(px(img, x, cy));
    const bandIdx = row.findIndex((p) => p[3] >= 235);
    expect(bandIdx).toBeGreaterThan(5);
    const afterBand = row.slice(bandIdx).find((p) => p[3] > 0 && p[3] < 255 && lum(p) < 40);
    expect(afterBand).toBeTruthy();
    expect(row.at(-1)[3]).toBe(0);
  });

  it('sizes the texture to the ellipse plus keyline and padding', () => {
    const g = ringGeometry('enemy');
    const img = rasterizeRing('enemy', g);
    expect(img.width).toBeGreaterThanOrEqual(g.rx * 2 + 2);
    expect(img.height).toBeGreaterThanOrEqual(g.ry * 2 + 2);
    expect(img.data.length).toBe(img.width * img.height * 4);
  });

  it('boss rings are wider than a tile-footprint enemy ring and carry clasps', () => {
    const boss = rasterizeRing('boss');
    const enemy = rasterizeRing('enemy');
    expect(boss.width).toBeGreaterThan(enemy.width);
    const cy = Math.floor(boss.cy);
    const opaqueRight = [];
    for (let x = 0; x < boss.width; x++) if (px(boss, x, cy)[3] > 200) opaqueRight.push(x);
    // Clasps extend past the ellipse band on both ends.
    expect(Math.min(...opaqueRight)).toBeLessThan(boss.cx - ringGeometry('boss').rx);
    expect(Math.max(...opaqueRight)).toBeGreaterThan(boss.cx + ringGeometry('boss').rx);
  });

  it('entity ring spans the 3×3 footprint', () => {
    const g = ringGeometry('entity');
    expect(g.rx * 2).toBe(3 * 32 - 8);
    const img = rasterizeRing('entity', g);
    expect(img.width).toBeGreaterThan(88);
  });
});
