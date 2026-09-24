import { detectMobileRuntime } from '../utils/runtimeFlags.js';
import { deploymentFrame } from '../utils/deploymentCamera.js';
import { TILE_SIZE } from '../utils/constants.js';
import { UI_PALETTE } from '../utils/uiStyles.js';

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
    this.tools.append(
      hud.button('Overview', () => this.scene.resetBattleCameraView()),
      hud.button('Recenter', () => this.recenter()),
      hud.button('Back', () => this.scene.requestCancel({ allowPause: false })),
      hud.button('Menu', () => this.scene.game.events.emit('mobile:menu')),
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
    const width = Math.round((480 * rect.width) / rect.height);
    const viewportKey = `${width}:${Math.round(rect.height)}`;
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
    s.scale.setGameSize(width, 480);
    s.cameras.main.setSize(width, 480);
    s._uiCamera?.setSize(width, 480);
    const bounds = s._getBattleMapBounds();
    if (s._battleCamera && bounds) {
      const fit = Math.min((width - 32) / bounds.width, 448 / bounds.height);
      s._battleCamera.minZoom = Math.max(0.5, fit);
      s._battleCamera.maxZoom = Math.max(3, fit * 2.5);
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
