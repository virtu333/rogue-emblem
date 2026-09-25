// ThreatSightController — "who can reach this tile" while a unit is being moved.
//
// While a player unit is selected, every visible enemy that could strike the
// destination under the cursor / grid cursor (or, with no hover, the unit's own
// tile — after a tap-move that is the tentatively chosen destination) next enemy
// phase gets a crimson eye above its head and a crimson ring at its feet, and a
// short dashed ink line runs from it to the tile. A small tag on the tile gives
// the count; the HUDs print the same count ("2 foes can reach").
//
// Correctness: answers come from ThreatForecast.threatsOnTile — the Danger
// overlay's own computation, evaluated with the mover set down on the tile.
// Fog-hidden enemies are never evaluated. No RNG: construction runs under the
// presentation RNG and nothing here draws randomness.
//
// Cost: a cheap key is compared each frame; the threat query runs only when the
// focus tile, selection, turn or battle state changes, and is memoized per tile
// against a world signature. Graphics are redrawn only when the answer changes.
// Pulses are transform tweens on two small images (static under Reduce Motion).

import { TILE_SIZE } from '../utils/constants.js';
import { UI_HEX, UI_PALETTE, UI_FONT_FAMILIES } from '../utils/uiStyles.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { getFootprint, isEntity } from '../engine/EntitySystem.js';
import {
  threatsOnTile,
  threatSummaryText,
  threatWorldSignature,
} from '../engine/ThreatForecast.js';
import { ensureThreatSigilTexture } from '../art/threatSigil.js';

// World depths (below SCREEN_UI so the phone's pinned UI camera leaves them alone).
export const THREAT_SIGHT_DEPTHS = Object.freeze({
  LINES: 7.6, // above path dots (6) and objective tiles (7), below rings (8)
  FRAMES: 8.5, // corner ticks, just above the faction ring
  SIGILS: 16, // above sprites, HP bars and affix pips
  TAG: 16.5,
});

const ACTIVE_STATES = new Set(['UNIT_SELECTED', 'UNIT_ACTION_MENU']);
const MAX_LINES = 8;

let nextUnitId = 1;
const unitIds = new WeakMap();
const idOf = (unit) => {
  if (!unit || typeof unit !== 'object') return 0;
  if (!unitIds.has(unit)) unitIds.set(unit, nextUnitId++);
  return unitIds.get(unit);
};

export class ThreatSightController {
  constructor(scene) {
    this.scene = scene;
    this.current = null; // { unit, col, row, hovering, result }
    this._key = '';
    this._signature = '';
    this._memo = new Map();
    this._drawnKey = '';
    this.graphics = null;
    this.sigils = [];
    this.tag = null;
    this.tagText = null;
    this.destroyed = false;
    this._tick = () => this.sync();
  }

  create() {
    this.scene.events?.on?.('update', this._tick);
    this.scene.events?.once?.('shutdown', () => this.destroy());
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events?.off?.('update', this._tick);
    this.clear();
    this.graphics?.destroy?.();
    this.graphics = null;
    this.tag?.destroy?.();
    this.tagText?.destroy?.();
    this.tag = null;
    this.tagText = null;
    this._memo.clear();
  }

  /** The unit and tile to read threat for, or null when nothing is being moved. */
  focus() {
    const s = this.scene;
    const unit = s.selectedUnit;
    if (!unit || unit.faction !== 'player' || unit.currentHP <= 0 || unit.hasActed) return null;
    if (!ACTIVE_STATES.has(s.battleState)) return null;
    if (s.turnManager?.currentPhase && s.turnManager.currentPhase !== 'player') return null;
    const hover = s._threatFocusTile;
    if (s.battleState === 'UNIT_SELECTED' && hover && s.movementRange) {
      const entry = s.movementRange.get(`${hover.col},${hover.row}`);
      const own = hover.col === unit.col && hover.row === unit.row;
      if (entry && entry.stoppable !== false && !own)
        return { unit, col: hover.col, row: hover.row, hovering: true };
    }
    return { unit, col: unit.col, row: unit.row, hovering: false };
  }

  /** Memoized threat answer for `unit` standing on (col, row). */
  query(unit, col, row) {
    const s = this.scene;
    if (!s.grid || typeof s.threatContext !== 'function') return null;
    const ctx = s.threatContext();
    const units = [...(s.playerUnits || []), ...(s.enemyUnits || []), ...(s.npcUnits || [])];
    const signature = threatWorldSignature(ctx, units);
    if (signature !== this._signature) {
      this._signature = signature;
      this._memo.clear();
    }
    const key = `${idOf(unit)}@${col},${row}`;
    if (!this._memo.has(key)) this._memo.set(key, threatsOnTile(ctx, col, row, { mover: unit }));
    return this._memo.get(key);
  }

  /** HUD line for a tile: "2 foes can reach" (null when the tile is not a move preview). */
  describe(col, row) {
    const focus = this.focus();
    if (!focus) return null;
    const s = this.scene;
    const own = focus.unit.col === col && focus.unit.row === row;
    if (!own) {
      if (s.battleState !== 'UNIT_SELECTED') return null;
      const entry = s.movementRange?.get(`${col},${row}`);
      if (!entry || entry.stoppable === false) return null;
    }
    return threatSummaryText(this.query(focus.unit, col, row));
  }

  sync(force = false) {
    if (this.destroyed) return;
    const s = this.scene;
    const focus = this.focus();
    const key = focus
      ? [
          s.battleState,
          idOf(focus.unit),
          focus.unit.col,
          focus.unit.row,
          focus.col,
          focus.row,
          s.turnManager?.turnNumber ?? 0,
          s.grid?.fogEnabled ? (s.grid.visibleSet?.size ?? 0) : 0,
        ].join('|')
      : '';
    if (!force && key === this._key) return;
    this._key = key;
    if (!focus) {
      this.current = null;
      this.clear();
      return;
    }
    const result = this.query(focus.unit, focus.col, focus.row);
    this.current = { ...focus, result };
    this.render(this.current);
  }

  clear() {
    this._drawnKey = '';
    this.graphics?.clear?.();
    this.graphics?.setVisible?.(false);
    for (const sigil of this.sigils) {
      this.scene.tweens?.killTweensOf?.(sigil);
      sigil.destroy?.();
    }
    this.sigils = [];
    this.tag?.setVisible?.(false);
    this.tagText?.setVisible?.(false);
  }

  sourcePoint(source) {
    const grid = this.scene.grid;
    if (isEntity(source)) {
      const tiles = getFootprint(source);
      const col = tiles.reduce((sum, t) => sum + t.col, 0) / tiles.length;
      const row = tiles.reduce((sum, t) => sum + t.row, 0) / tiles.length;
      const a = grid.gridToPixel(Math.floor(col), Math.floor(row));
      const b = grid.gridToPixel(Math.ceil(col), Math.ceil(row));
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, top: Math.min(a.y, b.y) - TILE_SIZE / 2 };
    }
    const p = grid.gridToPixel(source.col, source.row);
    // The tile's top edge sits at head height for 32px sprites and just under the
    // head of taller rebuilt sprites; transparent sprite padding is ignored.
    const top = p.y - TILE_SIZE / 2;
    return { x: p.x, y: p.y, top };
  }

  render(current) {
    const s = this.scene;
    const { result } = current;
    const sources = [
      ...result.damage.map((unit) => ({ unit, kind: 'damage' })),
      ...result.ballistas.map((unit) => ({ unit, kind: 'damage', ballista: true })),
      ...result.status.map((unit) => ({ unit, kind: 'status' })),
    ];
    const drawnKey = `${current.col},${current.row}|${sources
      .map((src) => `${idOf(src.unit)}:${src.kind}:${src.unit.col},${src.unit.row}`)
      .join(';')}`;
    if (drawnKey === this._drawnKey) return;
    this.clear();
    this._drawnKey = drawnKey;
    if (!sources.length || !s.add || !s.grid) return;
    withPresentationRandom(() => this._draw(current, sources));
  }

  _draw(current, sources) {
    const s = this.scene;
    const reduce = Boolean(s._reduceMotion?.());
    const target = s.grid.gridToPixel(current.col, current.row);
    if (!this.graphics) this.graphics = s.add.graphics().setDepth(THREAT_SIGHT_DEPTHS.LINES);
    const g = this.graphics;
    g.clear();
    g.setVisible(true);

    sources.slice(0, MAX_LINES).forEach(({ unit, kind }) => {
      const from = this.sourcePoint(unit);
      this._drawLine(g, from, target, kind);
    });
    for (const { unit, kind } of sources) {
      const from = this.sourcePoint(unit);
      this._drawFrame(g, unit, kind);
      this._placeSigil(from, kind, reduce);
    }
    this._placeTag(target, current.result.count);
  }

  _drawLine(g, from, to, kind) {
    const edge = kind === 'status' ? UI_HEX.threatStatus : UI_HEX.threatEdge;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < TILE_SIZE * 0.75) return; // adjacent: the ring and eye say enough
    const ux = dx / length;
    const uy = dy / length;
    // Start clear of the enemy sprite; stop at the target tile's edge.
    const half = TILE_SIZE / 2 - 2;
    const exit = Math.min(
      Math.abs(ux) > 1e-6 ? half / Math.abs(ux) : Infinity,
      Math.abs(uy) > 1e-6 ? half / Math.abs(uy) : Infinity,
    );
    const start = TILE_SIZE * 0.42;
    const end = length - exit;
    if (end - start < 6) return;
    const dash = 5;
    const gap = 3;
    const segments = [];
    for (let t = start; t < end; t += dash + gap) segments.push([t, Math.min(end, t + dash)]);
    // Ink underlay first, then the crimson thread over it.
    for (const [width, color, alpha] of [
      [4, UI_HEX.threatInk, 0.85],
      [2, edge, 1],
    ]) {
      g.lineStyle(width, color, alpha);
      for (const [a, b] of segments) {
        g.lineBetween(from.x + ux * a, from.y + uy * a, from.x + ux * b, from.y + uy * b);
      }
    }
    // Arrowhead at the tile edge.
    const tip = { x: from.x + ux * end, y: from.y + uy * end };
    const back = { x: tip.x - ux * 6, y: tip.y - uy * 6 };
    const px = -uy * 4;
    const py = ux * 4;
    const tri = [tip.x, tip.y, back.x + px, back.y + py, back.x - px, back.y - py];
    g.fillStyle(UI_HEX.threatInk, 0.9);
    g.fillTriangle(
      tip.x + ux * 1.5,
      tip.y + uy * 1.5,
      back.x + px * 1.45 - ux,
      back.y + py * 1.45 - uy,
      back.x - px * 1.45 - ux,
      back.y - py * 1.45 - uy,
    );
    g.fillStyle(edge, 1);
    g.fillTriangle(...tri);
  }

  /** Crimson corner ticks framing the threatening source's tile(s). */
  _drawFrame(g, unit, kind) {
    const edge = kind === 'status' ? UI_HEX.threatStatus : UI_HEX.threatEdge;
    const tiles = isEntity(unit) ? getFootprint(unit) : [unit];
    const grid = this.scene.grid;
    const points = tiles.map((t) => grid.gridToPixel(t.col, t.row));
    const half = TILE_SIZE / 2;
    const left = Math.min(...points.map((p) => p.x)) - half + 1;
    const right = Math.max(...points.map((p) => p.x)) + half - 1;
    const top = Math.min(...points.map((p) => p.y)) - half + 1;
    const bottom = Math.max(...points.map((p) => p.y)) + half - 1;
    const arm = 6;
    const corners = [
      [left, top, 1, 1],
      [right, top, -1, 1],
      [left, bottom, 1, -1],
      [right, bottom, -1, -1],
    ];
    for (const [width, color, alpha] of [
      [4, UI_HEX.threatInk, 0.85],
      [2, edge, 1],
    ]) {
      g.lineStyle(width, color, alpha);
      for (const [x, y, sx, sy] of corners) {
        g.beginPath();
        g.moveTo(x + sx * arm, y);
        g.lineTo(x, y);
        g.lineTo(x, y + sy * arm);
        g.strokePath();
      }
    }
  }

  _placeSigil(from, kind, reduce) {
    const s = this.scene;
    const key = ensureThreatSigilTexture(s, kind);
    if (!key || typeof s.add.image !== 'function') return;
    const y = Math.max(Math.round(from.top - 4), 7);
    const sigil = s.add.image(Math.round(from.x), y, key).setDepth(THREAT_SIGHT_DEPTHS.SIGILS);
    sigil.setName?.('threat-sigil');
    sigil.threatKind = kind;
    this.sigils.push(sigil);
    // A slow 2-art-pixel bob: movement draws the eye without resampling the art.
    if (!reduce && s.tweens?.add) {
      s.tweens.add({
        targets: sigil,
        y: y - 2,
        duration: 480,
        yoyo: true,
        repeat: -1,
        ease: 'Stepped',
        easeParams: [2],
      });
    }
  }

  _placeTag(target, count) {
    const s = this.scene;
    if (!count) {
      this.tag?.setVisible?.(false);
      this.tagText?.setVisible?.(false);
      return;
    }
    if (!this.tagText) {
      this.tagText = s.add
        .text(0, 0, '', {
          fontFamily: UI_FONT_FAMILIES.pixel,
          fontSize: '8px',
          color: UI_PALETTE.emberPale,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(THREAT_SIGHT_DEPTHS.TAG + 0.01);
      this.tag = s.add.graphics().setDepth(THREAT_SIGHT_DEPTHS.TAG);
    }
    const label = String(count);
    this.tagText.setText(label);
    const w = Math.max(10, label.length * 8 + 4);
    const h = 10;
    const x = Math.round(target.x + TILE_SIZE / 2 - w / 2 - 1);
    const y = Math.round(target.y - TILE_SIZE / 2 + h / 2 + 1);
    this.tag.clear();
    this.tag.fillStyle(UI_HEX.threatInk, 0.95);
    this.tag.fillRect(x - w / 2 - 1, y - h / 2 - 1, w + 2, h + 2);
    this.tag.fillStyle(UI_HEX.threatFill, 1);
    this.tag.fillRect(x - w / 2, y - h / 2, w, h);
    this.tag.setVisible(true);
    this.tagText.setPosition(x + 0.5, y + 0.5).setVisible(true);
  }
}
