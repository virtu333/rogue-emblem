// UnitLocator — "where is that unit?" answered on the map.
//
// Brings a ready unit into view (only when it is not comfortably on screen),
// selects it so its move range, the cursor and the unit panel are live, and
// draws an Ink & Ember locator: gold corner brackets that close in on the tile
// and a brief beam of light from above. Reduced motion shows the brackets
// still, then fades them. Presentation plus the ordinary selectUnit(); no RNG.

import { TILE_SIZE } from '../utils/constants.js';
import { UI_HEX } from '../utils/uiStyles.js';

const LOCATOR_DEPTH = 16; // above units (10-11), HP bars (12-13) and pips (14)

/** Living, unacted player units in a stable reading order (row, then column). */
export function readyUnits(scene) {
  return (scene?.playerUnits || [])
    .filter((u) => u && u.currentHP > 0 && !u.hasActed && !u._removing)
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

/** The next ready unit after `current` (wraps), or the first. */
export function nextReadyUnit(scene, current = null) {
  const list = readyUnits(scene);
  if (!list.length) return null;
  const i = current ? list.indexOf(current) : -1;
  return list[(i + 1) % list.length];
}

function isComfortablyVisible(scene, x, y) {
  const view = scene.cameras?.main?.worldView;
  if (!view || !(view.width > 0)) return true;
  const mx = view.width * 0.12;
  const my = view.height * 0.12;
  return x >= view.x + mx && x <= view.right - mx && y >= view.y + my && y <= view.bottom - my;
}

/**
 * Show `unit` to the player. Returns true when the unit was located.
 * @param {Phaser.Scene} scene BattleScene
 * @param {object} unit
 * @param {{ select?: boolean }} [options]
 */
export function locateUnit(scene, unit, { select = true } = {}) {
  if (!scene?.grid || !unit || !(unit.currentHP > 0)) return false;
  const p = scene.grid.gridToPixel(unit.col, unit.row);
  if (!isComfortablyVisible(scene, p.x, p.y)) {
    scene._battleCamera?.clearTouches?.();
    scene.cameras?.main?.centerOn?.(p.x, p.y);
    scene._battleCamera?.clampToBounds?.();
    scene._syncMobileResetViewButton?.();
  }
  scene._mobileTerrainFocus = { col: unit.col, row: unit.row };
  if (select && scene.battleState === 'PLAYER_IDLE' && !unit.hasActed) {
    if (scene.inspectionPanel?.visible) scene.clearInspectionVisuals?.();
    scene.selectUnit(unit);
  } else scene._gridCursor?.snapTo?.(unit.col, unit.row);
  flashLocator(scene, p.x, p.y);
  scene._mobileBattleHud?.sync?.();
  return true;
}

/** Gold brackets closing in on a tile, with a short beam (static under reduced motion). */
export function flashLocator(scene, x, y) {
  const add = scene?.add;
  if (!add?.graphics) return null;
  scene._unitLocator?.destroy?.();
  const reduced = Boolean(scene._reduceMotion?.());
  const g = add.graphics().setDepth(LOCATOR_DEPTH).setPosition(x, y);
  const half = TILE_SIZE / 2 + 2;
  const arm = 8;
  const draw = (color, width) => {
    g.lineStyle(width, color, 1);
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      g.beginPath();
      g.moveTo(sx * half, sy * (half - arm));
      g.lineTo(sx * half, sy * half);
      g.lineTo(sx * (half - arm), sy * half);
      g.strokePath();
    }
  };
  draw(UI_HEX.void, 4);
  draw(UI_HEX.accentText, 2);
  const beam = add
    .graphics()
    .setDepth(LOCATOR_DEPTH - 0.5)
    .setPosition(x, y);
  // A column of light above the unit: stacked bands fading upward.
  for (let i = 0; i < 8; i++) {
    beam.fillStyle(UI_HEX.accentText, 0.28 * (1 - i / 8));
    beam.fillRect(-5, -TILE_SIZE / 2 - (i + 1) * 10, 10, 10);
  }
  const parts = [g, beam];
  const done = () => {
    for (const obj of parts) obj.destroy?.();
    if (scene._unitLocator === handle) scene._unitLocator = null;
  };
  const handle = { destroy: done };
  scene._unitLocator = handle;
  const tweens = scene.tweens;
  if (!tweens?.add) {
    scene.time?.delayedCall?.(1400, done);
    return handle;
  }
  if (reduced) {
    beam.setAlpha(0.6);
    tweens.add({ targets: parts, alpha: 0, delay: 1200, duration: 300, onComplete: done });
    return handle;
  }
  g.setScale(1.9);
  tweens.add({ targets: g, scale: 1, duration: 320, ease: 'Cubic.easeOut' });
  tweens.add({
    targets: g,
    alpha: { from: 1, to: 0.35 },
    delay: 320,
    duration: 260,
    yoyo: true,
    repeat: 2,
  });
  beam.setAlpha(0);
  tweens.add({ targets: beam, alpha: 1, duration: 180, yoyo: true, hold: 420 });
  tweens.add({ targets: parts, alpha: 0, delay: 1650, duration: 320, onComplete: done });
  return handle;
}
