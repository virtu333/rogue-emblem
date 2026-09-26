import { detectMobileRuntime } from '../utils/runtimeFlags.js';
import { deploymentFrame } from '../utils/deploymentCamera.js';
import { TILE_SIZE } from '../utils/constants.js';
import { UI_PALETTE } from '../utils/uiStyles.js';

/**
 * Dev-only canvas backing scale for the phone battlefield (?renderScale=device|<n>).
 * The phone canvas is 480 px tall whatever the screen, so a 32 px tile at the tactical
 * zoom is ~45 canvas px that the browser then stretches ~2.4x to device pixels. With
 * 'device' the backing store matches the panel (CSS height x DPR, capped at 3x) so
 * map art is sampled once, straight to device pixels. See
 * docs/art-direction/sprites-v2/PIXEL_BUDGET.md. Pure.
 */
export function battleRenderScale(
  cssHeight,
  dpr = 1,
  search = globalThis.location?.search || '',
  dev = Boolean(import.meta.env?.DEV),
) {
  if (!dev) return 1;
  const value = new URLSearchParams(search || '').get('renderScale');
  if (!value) return 1;
  const k = value === 'device' ? (cssHeight * Math.min(3, Math.max(1, dpr))) / 480 : Number(value);
  return Number.isFinite(k) && k > 1 ? Math.min(4, k) : 1;
}

/**
 * Logical canvas for the phone battle panel (CSS width x height). Landscape keeps a
 * 480 px tall canvas; a portrait panel keeps 640 px of width (the pinned Phaser UI's
 * design width) and grows tall. Uniform scale either way, so tiles stay square. Pure.
 */
export function battleCanvasSize(cssWidth, cssHeight, k = 1) {
  const portrait = cssHeight > cssWidth;
  if (portrait) {
    return {
      portrait,
      width: Math.round(640 * k),
      height: Math.max(Math.round(480 * k), Math.round((640 * k * cssHeight) / cssWidth)),
    };
  }
  return {
    portrait,
    width: Math.round((480 * k * cssWidth) / cssHeight),
    height: Math.round(480 * k),
  };
}

/** Vertical band (canvas px) holding the 640x480 pinned layout on a tall canvas. Pure. */
export function uiBand(width, height, k = 1) {
  const bandHeight = Math.min(height, Math.round(480 * k));
  return { y: Math.max(0, Math.round((height - bandHeight) / 2)), height: bandHeight };
}

export function battlefieldLabEnabled() {
  return (
    detectMobileRuntime() ||
    (import.meta.env.DEV &&
      new URLSearchParams(globalThis.location?.search || '').get('battleLab') === '1')
  );
}

// Phone battlefield layout: full-height map, side command pane, camera tools. The
// terrain art itself is painted by BattleScene through the shared BattlefieldArt seam
// (desktop uses the same art without this layout). The same Grid, units, ranges and
// Combat rules run underneath.
export class BattlefieldLab {
  constructor(hud) {
    this.hud = hud;
    this.scene = hud.scene;
    this.container = document.getElementById('game-container');
    hud.wrapper.classList.add('battlefield-lab');
    this.originalSize = { width: this.scene.scale.width, height: this.scene.scale.height };
    this.originalBackground = this.scene.cameras.main.backgroundColor.rgba;
    this.scene.cameras.main.setBackgroundColor(UI_PALETTE.sunken);
    this.tools = document.createElement('nav');
    this.tools.className = 'bl-tools';
    this.tools.setAttribute('aria-label', 'Battle utilities');
    const tool = (id, label, action) => {
      const button = hud.button(label, action);
      button.dataset.tool = id;
      return button;
    };
    this.tools.append(
      tool('overview', 'Overview', () => this.scene.resetBattleCameraView()),
      tool('recenter', 'Recenter', () => this.recenter()),
      tool('back', 'Back', () => this.scene.requestCancel({ allowPause: false })),
      tool('menu', 'Menu', () => this.scene.game.events.emit('mobile:menu')),
    );
    hud.root.append(this.tools);
    const painting = this.scene._battlefieldTerrain;
    this.artReady = Promise.resolve(painting?.ready).then((painted) => {
      if (!this.destroyed && painted) hud.wrapper.dataset.terrainArt = painting.rendererId;
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.container);
    this.resize();
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const k = battleRenderScale(rect.height, globalThis.devicePixelRatio || 1);
    const { width, height, portrait } = battleCanvasSize(rect.width, rect.height, k);
    const viewportKey = `${width}:${height}:${Math.round(rect.height)}:${k}`;
    if (viewportKey === this.lastViewportKey) return;
    this.lastViewportKey = viewportKey;
    const s = this.scene;
    const cam = s.cameras.main;
    const previous = this.viewHeight
      ? {
          x: cam.scrollX + cam.width / 2,
          y: cam.scrollY + cam.height / 2,
          zoom: (cam.zoom * this.viewHeight) / rect.height,
          overview: Math.abs(cam.zoom - s._battleCamera?.minZoom) < 0.001,
        }
      : null;
    this.viewHeight = rect.height;
    this.renderScale = k;
    this.portrait = portrait;
    s.scale.setGameSize(width, height);
    s.cameras.main.setSize(width, height);
    this.syncUiCamera();
    const bounds = s._getBattleMapBounds();
    if (s._battleCamera && bounds) {
      // Overview fits the whole board with a half-tile margin on each side.
      const fit = Math.min((width - 32 * k) / bounds.width, (height - 32 * k) / bounds.height);
      s._battleCamera.minZoom = Math.max(0.5 * k, fit);
      s._battleCamera.maxZoom = Math.max(3 * k, fit * 2.5);
      if (!previous) this.recenter();
      else if (previous.overview) s._battleCamera.resetView();
      else {
        cam.setZoom(
          Math.max(s._battleCamera.minZoom, Math.min(s._battleCamera.maxZoom, previous.zoom)),
        );
        cam.centerOn(previous.x, previous.y);
      }
      s._battleCamera.clampToBounds();
    }
    s.scale.getParentBounds();
    s.scale.refresh();
  }

  /**
   * Pinned Phaser UI keeps its 640x480 layout: the UI camera magnifies it by the
   * render scale. A portrait canvas is 640 wide and taller, so that layout rides a
   * band centered on the map (the DOM command rail stays below the canvas).
   */
  syncUiCamera() {
    const s = this.scene,
      cam = s._uiCamera;
    if (!cam) return;
    const width = s.scale.width,
      height = s.scale.height;
    const k = this.renderScale || 1;
    const band = this.portrait ? uiBand(width, height, k) : { y: 0, height };
    cam.setOrigin(0, 0).setZoom(k);
    cam.setViewport(0, band.y, width, band.height);
  }

  recenter() {
    const s = this.scene,
      cam = s.cameras.main,
      controller = s._battleCamera;
    if (!controller || !this.viewHeight) return;
    const selected = s.selectedUnit?.currentHP > 0 ? s.selectedUnit : null;
    const units = selected ? [selected] : (s.playerUnits || []).filter((u) => u.currentHP > 0);
    const points = units.map((u) => s.grid.gridToPixel(u.col, u.row));
    const frame = deploymentFrame(points, {
      width: cam.width,
      height: cam.height,
      tileSize: TILE_SIZE,
      cssHeight: this.viewHeight,
      minZoom: controller.minZoom,
      maxZoom: controller.maxZoom,
    });
    if (!frame) return;
    controller.clearTouches();
    cam.setZoom(frame.zoom);
    cam.centerOn(frame.x, frame.y);
    controller.clampToBounds();
    s._syncMobileResetViewButton();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer.disconnect();
    this.tools.remove();
    this.hud.wrapper.classList.remove('battlefield-lab');
    delete this.hud.wrapper.dataset.terrainArt;
    this.scene.cameras?.main?.setBackgroundColor(this.originalBackground);
    this.scene.scale.setGameSize(this.originalSize.width, this.originalSize.height);
  }
}
