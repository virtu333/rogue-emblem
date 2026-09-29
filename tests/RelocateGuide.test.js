// Warp/Rescue feedback (playtest 2026-09-28, phone test #1): once an ally is picked,
// it wears a shimmering gold outline and every landing tile is a gold square, and the
// phone rail says what to tap. Every way out of the step must take the marks with it.
import { describe, expect, it, vi } from 'vitest';
import { Grid } from '../src/engine/Grid.js';
import { relocatePrompt } from '../src/engine/StaffRelocation.js';
import { UI_HEX } from '../src/utils/uiStyles.js';
import { TILE_SIZE } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const PLAIN = gameData.terrain.findIndex((t) => t.name === 'Plain');
const RESCUE = gameData.weapons.find((w) => w.name === 'Deliverance Staff');
const WARP = gameData.weapons.find((w) => w.name === 'Fold Staff');
const GOLD = { fill: UI_HEX.accent, edge: UI_HEX.accentText };

function fakeScene() {
  const created = [];
  const tweens = [];
  const rect = (x, y, w, h, fill, alpha) => {
    const r = {
      x,
      y,
      w,
      h,
      fill,
      alpha,
      destroyed: false,
      setStrokeStyle(width, color, strokeAlpha = 1) {
        this.stroke = { width, color, strokeAlpha };
        return this;
      },
      setDepth(d) {
        this.depth = d;
        return this;
      },
      destroy() {
        this.destroyed = true;
      },
    };
    created.push(r);
    return r;
  };
  const stub = () => new Proxy({}, { get: () => () => stub() });
  return {
    created,
    tweenLog: tweens,
    cameras: { main: { width: 640, height: 480 } },
    add: { rectangle: rect, image: stub, text: stub, container: stub },
    textures: { exists: () => false },
    tweens: {
      add: (cfg) => {
        const tween = { ...cfg, killed: false };
        tweens.push(tween);
        return tween;
      },
      killTweensOf: (target) => {
        for (const t of tweens) if (t.targets === target) t.killed = true;
      },
    },
  };
}

function makeGrid(scene) {
  const map = Array.from({ length: 5 }, () => Array(5).fill(PLAIN));
  const grid = new Grid(scene, 5, 5, gameData.terrain, map, false);
  scene.created.length = 0; // only what the guide draws
  return grid;
}

describe('Grid.showRelocateGuide', () => {
  const ally = { name: 'Sera', col: 4, row: 4 };
  const tiles = [
    { col: 1, row: 2 },
    { col: 3, row: 2 },
  ];

  it('draws a gold square on each landing tile and a pulsing gold outline on the ally', () => {
    const scene = fakeScene();
    const grid = makeGrid(scene);
    grid.showRelocateGuide(ally, tiles, GOLD);

    const squares = scene.created.filter((r) => r.fill === UI_HEX.accent);
    expect(squares.map((r) => [r.x, r.y])).toEqual(
      tiles.map((t) => {
        const p = grid.gridToPixel(t.col, t.row);
        return [p.x, p.y];
      }),
    );
    for (const sq of squares) expect(sq.stroke.color).toBe(UI_HEX.accentText);

    const outline = scene.created.find((r) => r.fill === undefined);
    const at = grid.gridToPixel(ally.col, ally.row);
    expect([outline.x, outline.y]).toEqual([at.x, at.y]);
    expect(outline.w).toBe(TILE_SIZE - 2);
    expect(outline.stroke).toMatchObject({ width: 3, color: UI_HEX.accentText });
    expect(outline.depth).toBeGreaterThan(10); // over the unit graphic
    expect(scene.tweenLog).toHaveLength(1);
    expect(scene.tweenLog[0]).toMatchObject({ targets: outline, yoyo: true, repeat: -1 });
  });

  it('holds the outline still under reduced motion', () => {
    const scene = fakeScene();
    const grid = makeGrid(scene);
    grid.showRelocateGuide(ally, tiles, { ...GOLD, reduceMotion: true });
    expect(scene.created.find((r) => r.fill === undefined)).toBeTruthy();
    expect(scene.tweenLog).toHaveLength(0);
  });

  it('is removed, pulse and all, by clearing the attack highlights (cancel, commit, turn end)', () => {
    const scene = fakeScene();
    const grid = makeGrid(scene);
    grid.showRelocateGuide(ally, tiles, GOLD);
    grid.clearAttackHighlights();
    expect(scene.created.every((r) => r.destroyed)).toBe(true);
    expect(scene.tweenLog.every((t) => t.killed)).toBe(true);
    expect(grid.attackHighlightTiles).toEqual([]);
  });

  it('is replaced when Back re-shows the ally choices', () => {
    const scene = fakeScene();
    const grid = makeGrid(scene);
    grid.showRelocateGuide(ally, tiles, GOLD);
    const guide = [...scene.created];
    grid.showHealRange([{ col: ally.col, row: ally.row }]);
    expect(guide.every((r) => r.destroyed)).toBe(true);
    expect(scene.tweenLog.every((t) => t.killed)).toBe(true);
    expect(grid.attackHighlightTiles).toHaveLength(1);
  });
});

describe('relocatePrompt', () => {
  const caster = { name: 'Sera' };
  const ally = { name: 'Bramwell' };

  it('step 1 asks for the ally, per staff', () => {
    expect(relocatePrompt(RESCUE, caster)).toMatch(/^Rescue: tap a green ally/);
    expect(relocatePrompt(WARP, caster)).toMatch(/^Warp: tap a green ally beside you/);
  });

  it('step 2 names the chosen ally and the gold squares', () => {
    expect(relocatePrompt(RESCUE, caster, ally)).toBe(
      'Bramwell chosen. Tap a gold square beside Sera to set them down. Back picks another ally.',
    );
    expect(relocatePrompt(WARP, caster, ally)).toBe(
      'Bramwell chosen. Tap a gold square to send them there. Back picks another ally.',
    );
  });

  it('says nothing for a staff that does not relocate', () => {
    const heal = gameData.weapons.find((w) => w.name === 'Heal');
    expect(relocatePrompt(heal, caster, ally)).toBeNull();
    expect(relocatePrompt(null, caster)).toBeNull();
  });
});
