// RemainsMarkerController — draws the remains a fallen Zombie or Revenant leaves
// (engine/ZombieRemains.js): a small bone pile on the tile and a countdown badge with
// the number of enemy phases before it rises. "1" turns red and pulses: it rises at
// the start of the next enemy phase.
//
// Rendering only: no game state lives here, and nothing here changes it. `sync()`
// re-derives every marker from scene._zombieTombstones each frame (like
// RecruitBeaconController), so a kill, a tick, a rise, a dropped record, a Smash, a
// Vision rewind or a resume all just work. Markers are placed with grid.gridToPixel,
// so the portrait board's quarter turn moves them with their tiles.
//
// What the player knows (PlayerKnowledge's rule): only remains the player has seen
// are drawn (record.seen, or a tile they see now). A zombie that fell in the fog
// leaves no marker until its tile is seen. Markers sit below the fog layer, so a
// seen pile in fog is dimmed with its tile like the terrain under it.

import { knownRemainsTiles } from '../engine/ZombieRemains.js';
import { TILE_SIZE } from '../utils/constants.js';
import { UI_FONT_FAMILIES, UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

// Above the terrain (0), below the fog (3), range highlights (5) and units (10+).
export const REMAINS_MARKER_DEPTH = 2;
const BADGE_DEPTH = 2.2;

export class RemainsMarkerController {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    /** What is drawn: [{ col, row, turnsRemaining, count, x, y }] (tests, review). */
    this.shown = [];
    this._key = null;
  }

  create() {
    this.sync();
    return this;
  }

  /** Cheap per-frame reconciliation with scene._zombieTombstones and the fog. */
  sync() {
    const scene = this.scene;
    if (!scene?.grid) return;
    const grid = scene.grid;
    const isVisible = (col, row) =>
      typeof grid.isVisible === 'function' ? grid.isVisible(col, row) : true;
    const tiles = knownRemainsTiles(scene._zombieTombstones || [], isVisible);
    const key = tiles.map((t) => `${t.col},${t.row}:${t.turnsRemaining}x${t.count}`).join(';');
    if (key === this._key) return;
    this._key = key;
    this._clear();
    for (const tile of tiles) this._draw(tile);
    // Pinned-UI camera filters need to learn about new world objects.
    scene._cameraFilterDirty = true;
  }

  _draw(tile) {
    const scene = this.scene;
    if (!scene?.grid?.gridToPixel) return;
    const { x, y } = scene.grid.gridToPixel(tile.col, tile.row);
    this.shown.push({ ...tile, x, y });
    if (!scene.add?.graphics) return;
    try {
      const pile = scene.add.graphics();
      pile.setDepth?.(REMAINS_MARKER_DEPTH);
      pile.name = 'remains-pile';
      drawBonePile(pile, x, y + 3);
      this.objects.push(pile);

      const urgent = tile.turnsRemaining <= 1;
      const edge = urgent ? UI_HEX.alarm : UI_HEX.accent;
      const bx = x + TILE_SIZE / 2 - 7;
      const by = y - TILE_SIZE / 2 + 7;
      const badge = scene.add.graphics();
      badge.setDepth?.(BADGE_DEPTH);
      badge.name = 'remains-badge';
      badge.fillStyle?.(UI_HEX.void, 0.92);
      badge.fillCircle?.(bx, by, 6);
      badge.lineStyle?.(1, edge, 1);
      badge.strokeCircle?.(bx, by, 6);
      this.objects.push(badge);
      const label = scene.add
        .text(bx, by + 0.5, String(tile.turnsRemaining), {
          fontFamily: UI_FONT_FAMILIES.pixel,
          fontSize: '7px',
          color: urgent ? UI_PALETTE.alarm : UI_PALETTE.accentText,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(BADGE_DEPTH + 0.01);
      label.name = 'remains-countdown';
      this.objects.push(label);
      if (urgent && !scene._reduceMotion?.()) {
        scene.tweens?.add?.({
          targets: [badge, label],
          alpha: 0.35,
          duration: 520,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    } catch {
      /* cosmetic only */
    }
  }

  _clear() {
    for (const obj of this.objects) {
      try {
        this.scene?.tweens?.killTweensOf?.(obj);
        obj.destroy?.();
      } catch {
        /* already destroyed */
      }
    }
    this.objects = [];
    this.shown = [];
  }

  destroy() {
    this._clear();
    this._key = null;
    this.scene = null;
  }
}

/**
 * A skull over two crossed bones, about 20 px wide, in parchment with a dark rim so
 * it reads on grass, stone, sand and snow alike. (x, y) is the pile's centre.
 */
function drawBonePile(g, x, y) {
  const bone = UI_HEX.parchment;
  const shade = UI_HEX.parchmentDim;
  const rim = UI_HEX.void;
  // Crossed bones: a dark underlay, then the shafts and their knuckles.
  for (const [width, color] of [
    [5, rim],
    [3, bone],
  ]) {
    g.lineStyle?.(width, color, 1);
    g.lineBetween?.(x - 9, y + 7, x + 9, y + 1);
    g.lineBetween?.(x - 9, y + 1, x + 9, y + 7);
  }
  for (const [kx, ky] of [
    [x - 9, y + 7],
    [x + 9, y + 1],
    [x - 9, y + 1],
    [x + 9, y + 7],
  ]) {
    g.fillStyle?.(rim, 1);
    g.fillCircle?.(kx, ky, 3);
    g.fillStyle?.(shade, 1);
    g.fillCircle?.(kx, ky, 2);
  }
  // The skull: dome, jaw, two dark sockets and a nose notch.
  g.fillStyle?.(rim, 1);
  g.fillCircle?.(x, y - 5, 7);
  g.fillRect?.(x - 5, y - 2, 10, 6);
  g.fillStyle?.(bone, 1);
  g.fillCircle?.(x, y - 5, 6);
  g.fillRect?.(x - 4, y - 2, 8, 5);
  g.fillStyle?.(rim, 1);
  g.fillRect?.(x - 4, y - 6, 3, 3);
  g.fillRect?.(x + 1, y - 6, 3, 3);
  g.fillRect?.(x - 1, y - 2, 2, 2);
  g.fillStyle?.(shade, 1);
  g.fillRect?.(x - 3, y + 2, 1, 1);
  g.fillRect?.(x - 1, y + 2, 1, 1);
  g.fillRect?.(x + 1, y + 2, 1, 1);
}
