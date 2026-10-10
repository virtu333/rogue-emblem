// UnitLocator moves the camera only through the battle camera controller
// (docs/specs/large-maps/01-camera-and-navigation.md §1.5.1, §4 "UnitLocatorClamp").
//
// Desktop has no battle camera: the board is centred on the main camera once and every
// plate of the desktop HUD is drawn in world space at scroll 0. [N] on a unit near the
// view's edge used to `centerOn` the main camera with nothing to clamp it, scrolling the
// whole battle (HUD included) about 270 px and leaving it there. Without a controller
// the locator must leave the camera exactly where it is; with one (phones) it keeps
// today's centre-then-clamp.
import { describe, it, expect, vi } from 'vitest';
import { locateUnit } from '../src/ui/UnitLocator.js';
import { BattleCameraController } from '../src/utils/BattleCameraController.js';

const TILE = 32;

// A Phaser-like main camera: centerOn puts the point at the viewport's centre
// (scroll = point - size / 2 at any zoom), and worldView is the visible world rect,
// centred on (scroll + size / 2) and size / zoom across.
function fakeCamera({ width = 640, height = 480, zoom = 1, scrollX = 0, scrollY = 0 } = {}) {
  return {
    x: 0,
    y: 0,
    width,
    height,
    zoom,
    scrollX,
    scrollY,
    centerOnCalls: 0,
    setZoom(z) {
      this.zoom = z;
      return this;
    },
    setScroll(x, y) {
      this.scrollX = x;
      this.scrollY = y;
      return this;
    },
    centerOn(x, y) {
      this.centerOnCalls += 1;
      this.scrollX = x - this.width / 2;
      this.scrollY = y - this.height / 2;
      return this;
    },
    get worldView() {
      const w = this.width / this.zoom;
      const h = this.height / this.zoom;
      const x = this.scrollX + this.width / 2 - w / 2;
      const y = this.scrollY + this.height / 2 - h / 2;
      return { x, y, width: w, height: h, right: x + w, bottom: y + h };
    },
  };
}

function fakeGraphics(drawn) {
  const g = {
    x: 0,
    y: 0,
    setDepth: () => g,
    setPosition(x, y) {
      g.x = x;
      g.y = y;
      return g;
    },
    setScale: () => g,
    setAlpha: () => g,
    lineStyle: () => g,
    beginPath: () => g,
    moveTo: () => g,
    lineTo: () => g,
    strokePath: () => g,
    fillStyle: () => g,
    fillRect: () => g,
    destroy: () => {},
  };
  drawn.push(g);
  return g;
}

// An 18x13 board centred on a 640x480 canvas, as Grid does: offset (32, 32).
function fakeScene({ camera, battleCamera = null, units }) {
  const drawn = [];
  const scene = {
    battleState: 'PLAYER_IDLE',
    playerUnits: units,
    cameras: { main: camera },
    grid: {
      cols: 18,
      rows: 13,
      offsetX: 32,
      offsetY: 32,
      gridToPixel(col, row) {
        return { x: 32 + col * TILE + TILE / 2, y: 32 + row * TILE + TILE / 2 };
      },
    },
    add: { graphics: () => fakeGraphics(drawn) },
    tweens: { add: () => ({}) },
    selected: null,
    selectUnit(u) {
      this.selected = u;
      this.battleState = 'UNIT_SELECTED';
    },
    _syncMobileResetViewButton: vi.fn(),
    _drawn: drawn,
  };
  if (battleCamera) scene._battleCamera = battleCamera;
  return scene;
}

function unitAt(col, row, name = `u${col}_${row}`) {
  return { name, col, row, currentHP: 20, hasActed: false };
}

describe('locateUnit without a battle camera (desktop)', () => {
  const edgeTiles = [
    ['column 0', 0, 6],
    ['the top row', 8, 0],
    ['the bottom row', 8, 12],
    ['the last column', 17, 6],
    ['a corner', 0, 12],
  ];

  for (const [label, col, row] of edgeTiles) {
    it(`leaves the main camera untouched for a unit on ${label}`, () => {
      const camera = fakeCamera();
      const unit = unitAt(col, row);
      const scene = fakeScene({ camera, units: [unit] });

      expect(locateUnit(scene, unit)).toBe(true);

      expect({ x: camera.scrollX, y: camera.scrollY, zoom: camera.zoom }).toEqual({
        x: 0,
        y: 0,
        zoom: 1,
      });
      expect(camera.centerOnCalls).toBe(0);
      // The rest of locating still happens: selected, and the brackets on its tile.
      expect(scene.selected).toBe(unit);
      expect(scene._mobileTerrainFocus).toEqual({ col, row });
      expect({ x: scene._drawn[0].x, y: scene._drawn[0].y }).toEqual({
        x: 32 + col * TILE + 16,
        y: 32 + row * TILE + 16,
      });
    });
  }

  it('leaves a camera that is not at scroll 0 where it is', () => {
    // Whatever placed the camera (the history viewer restores it), [N] does not own it.
    const camera = fakeCamera({ scrollX: 12, scrollY: -7 });
    const unit = unitAt(0, 0);
    const scene = fakeScene({ camera, units: [unit] });

    locateUnit(scene, unit);

    expect({ x: camera.scrollX, y: camera.scrollY }).toEqual({ x: 12, y: -7 });
  });
});

describe('locateUnit with a battle camera (phones): unchanged', () => {
  const bounds = { left: 32, top: 32, width: 18 * TILE, height: 13 * TILE };

  function phoneCamera() {
    // Zoom 2 on a 640x480 viewport: 320x240 world px visible, centred on the board
    // centre (320, 240), i.e. scroll (0, 0) and the world view x 160..480, y 120..360.
    const camera = fakeCamera({ zoom: 2 });
    const controller = new BattleCameraController(camera, { getBounds: () => bounds });
    const clearTouches = vi.spyOn(controller, 'clearTouches');
    return { camera, controller, clearTouches };
  }

  it('centres an uncomfortable unit, then clamps the view to the board', () => {
    const { camera, controller, clearTouches } = phoneCamera();
    const unit = unitAt(0, 0); // world (48, 48)
    const scene = fakeScene({ camera, battleCamera: controller, units: [unit] });

    locateUnit(scene, unit);

    // centerOn(48, 48) -> scroll (-272, -192): the open view's left/top at -112/-72.
    // Clamped to the board's left/top (32, 32): scroll = 32 - 160 = -128 and
    // 32 - 120 = -88, so the visible world is x 32..352, y 32..272.
    expect({ x: camera.scrollX, y: camera.scrollY, zoom: camera.zoom }).toEqual({
      x: -128,
      y: -88,
      zoom: 2,
    });
    expect(camera.centerOnCalls).toBe(1);
    expect(clearTouches).toHaveBeenCalledTimes(1);
    expect(scene._syncMobileResetViewButton).toHaveBeenCalledTimes(1);
    expect(scene.selected).toBe(unit);
  });

  it('centres a unit near the far corner, then clamps to the far edges', () => {
    const { camera, controller } = phoneCamera();
    const unit = unitAt(13, 9); // world (464, 336): past the comfortable box (441.6, 331.2)
    const scene = fakeScene({ camera, battleCamera: controller, units: [unit] });

    locateUnit(scene, unit);

    // centerOn(464, 336) -> scroll (144, 96): the open view's left/top at 304/216.
    // The board allows left up to 32 + 576 - 320 = 288 and top up to 32 + 416 - 240 = 208,
    // so scroll = 288 - 160 = 128 and 208 - 120 = 88.
    expect({ x: camera.scrollX, y: camera.scrollY }).toEqual({ x: 128, y: 88 });
  });

  it('does not move the view for a unit already comfortably in it', () => {
    const { camera, controller, clearTouches } = phoneCamera();
    const unit = unitAt(9, 6); // world (336, 240): the view's centre
    const scene = fakeScene({ camera, battleCamera: controller, units: [unit] });

    locateUnit(scene, unit);

    expect({ x: camera.scrollX, y: camera.scrollY }).toEqual({ x: 0, y: 0 });
    expect(camera.centerOnCalls).toBe(0);
    expect(clearTouches).not.toHaveBeenCalled();
    expect(scene._syncMobileResetViewButton).not.toHaveBeenCalled();
  });
});
