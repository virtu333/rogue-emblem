// The phone battle panel resizes under a live camera (the rail settles, the phone
// turns, the browser bars slide). A resize must keep a map tile the same size on
// screen: the player zoomed in to read the board, not to a canvas ratio.
import { describe, it, expect } from 'vitest';
import { BattlefieldLab, battleCanvasSize, resizedZoom } from '../src/ui/BattlefieldLab.js';

// Screen size of one world unit (CSS px): camera zoom x CSS px per canvas px.
const tileCss = (zoom, cssHeight, canvasHeight) => (zoom * cssHeight) / canvasHeight;

describe('resizedZoom', () => {
  it('keeps the zoom when a portrait panel only grows taller (its canvas grows too)', () => {
    // 390 wide: the canvas stays 640 wide; 600 -> 650 CSS tall.
    const before = battleCanvasSize(390, 600);
    const after = battleCanvasSize(390, 650);
    const zoom = resizedZoom(
      2.4,
      { cssHeight: 600, canvasHeight: before.height },
      { cssHeight: 650, canvasHeight: after.height },
    );
    // 2.4 x 390/640 = 1.4625 CSS px per world px either way (46.8 px per 32 px tile).
    expect(tileCss(zoom, 650, after.height) * 32).toBeCloseTo(46.8, 1);
    expect(zoom).toBeCloseTo(2.4, 2);
  });

  it('matches the landscape rule (fixed 480 canvas height)', () => {
    expect(
      resizedZoom(2, { cssHeight: 360, canvasHeight: 480 }, { cssHeight: 390, canvasHeight: 480 }),
    ).toBeCloseTo((2 * 360) / 390, 6);
  });

  it('keeps tiles across a render-scale change and a landscape -> portrait turn', () => {
    // Same CSS panel, backing store doubled: the zoom doubles, the tile does not move.
    expect(
      resizedZoom(2, { cssHeight: 390, canvasHeight: 480 }, { cssHeight: 390, canvasHeight: 960 }),
    ).toBeCloseTo(4, 6);
    const land = battleCanvasSize(622, 390);
    const port = battleCanvasSize(390, 582);
    const zoom = resizedZoom(
      2,
      { cssHeight: 390, canvasHeight: land.height },
      { cssHeight: 582, canvasHeight: port.height },
    );
    expect(tileCss(zoom, 582, port.height)).toBeCloseTo(tileCss(2, 390, land.height), 2);
  });

  it('leaves the zoom alone when a size is unknown', () => {
    expect(
      resizedZoom(2, { cssHeight: 0, canvasHeight: 480 }, { cssHeight: 390, canvasHeight: 480 }),
    ).toBe(2);
  });
});

// BattlefieldLab.resize on a stand-in scene: the real method, a fake camera.
function fakeLab(rect) {
  const cam = {
    zoom: 1,
    scrollX: 0,
    scrollY: 0,
    width: 640,
    height: 480,
    setZoom(z) {
      this.zoom = z;
    },
    setSize(w, h) {
      this.width = w;
      this.height = h;
    },
    centerOn(x, y) {
      this.scrollX = x - this.width / 2;
      this.scrollY = y - this.height / 2;
    },
  };
  const battleCamera = {
    minZoom: 0.5,
    maxZoom: 3,
    resetView() {
      cam.setZoom(this.minZoom);
    },
    clampToBounds() {},
    clearTouches() {},
  };
  const scene = {
    cameras: { main: cam },
    scale: { setGameSize() {}, getParentBounds() {}, refresh() {}, width: 640, height: 480 },
    _battleCamera: battleCamera,
    _getBattleMapBounds: () => ({ width: 13 * 32, height: 16 * 32 }),
    playerUnits: [],
  };
  const lab = Object.create(BattlefieldLab.prototype);
  Object.assign(lab, {
    scene,
    container: { getBoundingClientRect: () => ({ ...rect.current }) },
    syncUiCamera() {},
    recenter() {},
  });
  return { lab, cam };
}

describe('BattlefieldLab.resize', () => {
  it('a height-only resize of the upright panel keeps the tile size (zoomed in)', () => {
    const rect = { current: { width: 390, height: 600 } };
    const { lab, cam } = fakeLab(rect);
    lab.resize();
    cam.setZoom(2.4); // zoomed past overview
    const before = tileCss(cam.zoom, 600, cam.height);
    rect.current = { width: 390, height: 650 };
    lab.resize();
    const after = tileCss(cam.zoom, 650, cam.height);
    expect(after).toBeCloseTo(before, 2);
  });

  it('a landscape height change still scales the zoom as before', () => {
    const rect = { current: { width: 622, height: 360 } };
    const { lab, cam } = fakeLab(rect);
    lab.resize();
    cam.setZoom(2);
    rect.current = { width: 674, height: 390 };
    lab.resize();
    expect(cam.zoom).toBeCloseTo((2 * 360) / 390, 3);
  });

  it('an overview camera stays in overview', () => {
    const rect = { current: { width: 390, height: 600 } };
    const { lab, cam } = fakeLab(rect);
    lab.resize();
    cam.setZoom(lab.scene._battleCamera.minZoom);
    rect.current = { width: 390, height: 700 };
    lab.resize();
    expect(cam.zoom).toBe(lab.scene._battleCamera.minZoom);
  });
});
