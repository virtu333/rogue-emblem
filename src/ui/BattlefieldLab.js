import { battleContrastEnabled, softenGrassTexture } from './BattleContrast.js';
import { detectMobileRuntime } from '../utils/runtimeFlags.js';
import { loadWeatheredArt, drawWeatheredTile, WEATHERED_TILE_SIZE } from './WeatheredTerrain.js';
import { deploymentFrame } from '../utils/deploymentCamera.js';
import { TILE_SIZE } from '../utils/constants.js';

export function battlefieldLabEnabled() {
  return (
    detectMobileRuntime() ||
    (import.meta.env.DEV &&
      new URLSearchParams(globalThis.location?.search || '').get('battleLab') === '1')
  );
}

// Experimental presentation only. The same Grid, units, ranges, and Combat rules run underneath.
export class BattlefieldLab {
  constructor(hud) {
    this.hud = hud;
    this.scene = hud.scene;
    this.container = document.getElementById('game-container');
    hud.wrapper.classList.add('battlefield-lab');
    this.originalSize = { width: this.scene.scale.width, height: this.scene.scale.height };
    this.originalBackground = this.scene.cameras.main.backgroundColor.rgba;
    this.scene.cameras.main.setBackgroundColor('#263e40');
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
    this.originalTiles = [];
    this.textureKeys = [];
    this.artReady = loadWeatheredArt(`${import.meta.env.BASE_URL}assets/terrain/weathered`)
      .then((art) => {
        if (!this.destroyed) this.paintTerrain(art);
      })
      .catch((error) => {
        if (!this.destroyed) console.warn(error.message);
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

  paintTerrain(art) {
    const { grid, textures } = this.scene;
    const at = (col, row) => grid.terrainData[grid.mapLayout[row]?.[col]]?.name;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const tile = grid.tiles[row][col];
        if (!tile?.setTexture) continue;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = WEATHERED_TILE_SIZE;
        if (!drawWeatheredTile(canvas.getContext('2d'), art, at, col, row, { biome: grid.biome }))
          continue;
        if (battleContrastEnabled() && at(col, row) === 'Plain')
          softenGrassTexture(canvas.getContext('2d'), WEATHERED_TILE_SIZE);
        const key = `battle-lab-${col}-${row}`;
        textures.addCanvas(key, canvas);
        this.textureKeys.push(key);
        this.originalTiles.push({ tile, key: tile.texture.key, frame: tile.frame.name });
        tile.setTexture(key).setDisplaySize(TILE_SIZE, TILE_SIZE);
      }
    }
    this.hud.wrapper.dataset.terrainArt = 'weathered';
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer.disconnect();
    this.tools.remove();
    for (const { tile, key, frame } of this.originalTiles) {
      if (tile.scene) tile.setTexture(key, frame).setDisplaySize(TILE_SIZE, TILE_SIZE);
    }
    for (const key of this.textureKeys) this.scene.textures.remove(key);
    this.hud.wrapper.classList.remove('battlefield-lab');
    delete this.hud.wrapper.dataset.terrainArt;
    this.scene.cameras?.main?.setBackgroundColor(this.originalBackground);
    this.scene.scale.setGameSize(this.originalSize.width, this.originalSize.height);
  }
}
