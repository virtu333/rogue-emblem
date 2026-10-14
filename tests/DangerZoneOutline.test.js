// The Danger button's outline mode: a second press draws only the zone's outer edge, a third
// hides it. Failure modes covered: outline still paints the count-tier fill or hatching; outline
// loses an edge (crimson border, status violet, counter dashes); a redraw while shown (an
// action, fog, a refresh) drops back to filled; the cycle skips a step, or a pin survives Off;
// a zone hidden by an action comes back as an outline on the next press.
import { describe, it, expect, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { BattleScene } from '../src/scenes/BattleScene.js';
import { DangerZoneOverlay, nextDangerMode, DANGER_MODES } from '../src/ui/DangerZoneOverlay.js';

function overlayFixture(options) {
  const layers = [];
  const makeGraphics = () => {
    const g = {
      calls: [],
      setDepth: vi.fn(() => g),
      fillStyle: vi.fn((c, a) => g.calls.push(['fillStyle', c, a])),
      fillRect: vi.fn((...a) => g.calls.push(['fillRect', ...a])),
      lineStyle: vi.fn((w, c, a) => g.calls.push(['lineStyle', w, c, a])),
      lineBetween: vi.fn((...a) => g.calls.push(['line', ...a])),
      strokeRect: vi.fn((...a) => g.calls.push(['strokeRect', ...a])),
      clear: vi.fn(() => (g.calls = [])),
      destroy: vi.fn(),
    };
    layers.push(g);
    return g;
  };
  const scene = { add: { graphics: vi.fn(makeGraphics) } };
  const grid = { gridToPixel: (col, row) => ({ x: col * 32 + 16, y: row * 32 + 16 }) };
  return { overlay: new DangerZoneOverlay(scene, grid, options), layers };
}

// A zone with every kind of tile: one, two and three damage sources, a status staff's reach
// and the Entity's counter-only band.
const ZONE = [
  { col: 1, row: 1, count: 1, damageThreat: true },
  { col: 2, row: 1, count: 2, damageThreat: true },
  { col: 3, row: 1, count: 3, damageThreat: true, statusThreat: true },
  { col: 1, row: 2, count: 0, damageThreat: false, statusThreat: true },
  { col: 4, row: 1, count: 0, damageThreat: false, counterThreat: true },
];

const draw = (outline) => {
  const { overlay, layers } = overlayFixture();
  overlay.setOutline(outline);
  overlay.show(ZONE);
  const [fill, edge] = layers;
  return { overlay, fill: fill.calls, edge: edge.calls };
};

describe('Danger outline mode', () => {
  it('draws no fill or hatching, only the edges the filled zone draws', () => {
    const filled = draw(false);
    const outline = draw(true);
    expect(filled.fill.length).toBeGreaterThan(0);
    expect(outline.fill).toEqual([]);
    // The crimson border, the status staff's violet boxes and the counter band's dashes:
    // exactly the filled zone's edge layer.
    expect(outline.edge).toEqual(filled.edge);
    expect(outline.edge.filter((c) => c[0] === 'strokeRect')).toHaveLength(2);
    expect(outline.edge.filter((c) => c[0] === 'line').length).toBeGreaterThan(0);
  });

  it('keeps each tile’s tier for readers (allies in reach) with no fill alpha', () => {
    const { overlay } = draw(true);
    expect(overlay.tiles.map((t) => t.tier)).toEqual([1, 2, 3, 0, 0]);
    expect(overlay.tiles.every((t) => t.fillAlpha === 0)).toBe(true);
    expect(overlay.mode).toBe('outline');
  });

  it('redraws in place when switched while shown, and stays an outline through redraws', () => {
    const { overlay, layers } = overlayFixture();
    overlay.show(ZONE);
    expect(overlay.mode).toBe('filled');
    overlay.setOutline(true);
    expect(overlay.visible).toBe(true);
    expect(layers[0].calls).toEqual([]);
    expect(overlay.tiles).toHaveLength(ZONE.length);
    // A refresh after an action redraws the new tiles, still as an outline.
    overlay.show(ZONE.slice(0, 2));
    expect(layers[0].calls).toEqual([]);
    expect(overlay.tiles).toHaveLength(2);
    overlay.hide();
    expect(overlay.mode).toBe('off');
  });

  it('cycles Off, Filled, Outline, Off', () => {
    expect(DANGER_MODES).toEqual(['off', 'filled', 'outline']);
    expect(nextDangerMode('off')).toBe('filled');
    expect(nextDangerMode('filled')).toBe('outline');
    expect(nextDangerMode('outline')).toBe('off');
  });
});

describe('the Danger button', () => {
  const sceneFixture = () => {
    const scene = new BattleScene();
    const { overlay, layers } = overlayFixture();
    scene.dangerZone = overlay;
    scene.battleState = 'PLAYER_IDLE';
    scene.turnManager = { currentPhase: 'player' };
    scene.isStoryInputLocked = () => false;
    scene._isPrologueGateActive = () => false;
    scene.calculateDangerZone = vi.fn(() => ZONE);
    scene.dangerZoneStale = true;
    scene.dangerZoneCache = null;
    scene.keepDangerVisible = false;
    return { scene, overlay, fill: () => layers[0].calls };
  };

  it('steps Filled, then Outline, then Off on each press', () => {
    const { scene, overlay, fill } = sceneFixture();
    scene._onDangerClick();
    expect(overlay.mode).toBe('filled');
    expect(fill().length).toBeGreaterThan(0);
    scene._onDangerClick();
    expect(overlay.mode).toBe('outline');
    expect(fill()).toEqual([]);
    scene._onDangerClick();
    expect(overlay.mode).toBe('off');
    scene._onDangerClick();
    expect(overlay.mode).toBe('filled');
  });

  it('keeps a pin from Filled to Outline and ends it at Off', () => {
    const { scene, overlay } = sceneFixture();
    scene.togglePersistentDanger();
    expect(scene.keepDangerVisible).toBe(true);
    expect(overlay.mode).toBe('filled');
    scene._onDangerClick();
    expect(overlay.mode).toBe('outline');
    expect(scene.keepDangerVisible).toBe(true);
    scene._onDangerClick();
    expect(overlay.mode).toBe('off');
    expect(scene.keepDangerVisible).toBe(false);
  });

  it('pins an outline as an outline, and shows a hidden zone filled when pinned', () => {
    const { scene, overlay } = sceneFixture();
    scene._onDangerClick();
    scene._onDangerClick();
    scene.togglePersistentDanger();
    expect(overlay.mode).toBe('outline');
    scene.togglePersistentDanger(); // unpin: the zone stays as it is
    overlay.hide(); // an action hides an unpinned zone
    scene.togglePersistentDanger();
    expect(overlay.mode).toBe('filled');
  });

  it('starts from Filled again after an action hid an outlined zone', () => {
    const { scene, overlay } = sceneFixture();
    scene._onDangerClick();
    scene._onDangerClick();
    overlay.hide();
    scene._onDangerClick();
    expect(overlay.mode).toBe('filled');
  });
});
