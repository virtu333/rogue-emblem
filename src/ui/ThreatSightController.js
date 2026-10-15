// ThreatSightController — "who can reach this tile" while a unit is being moved.
//
// While a player unit is selected, every visible enemy that could strike the
// destination under the cursor / grid cursor (or, with no hover, the unit's own
// tile — after a tap-move that is the tentatively chosen destination) next enemy
// phase gets a small crimson eye above its head and a thin red line from it to
// the tile (Fortune's Weave-style intent: who, not how much — no damage numbers;
// the forecast shows numbers when you actually attack). The HUDs print the count
// ("2 foes can reach · 1 targets you"); nothing else is drawn on the tile.
//
// Reach is not intent: a foe that can reach the tile may still go for someone else. Each
// visible foe's pick comes from the AI itself (EnemyIntent: its decision run on copies of the
// board with the mover set down on the tile, in phase order, no RNG). The eye stays on every
// foe that can reach; the bright line (and a bright eye) only on the ones that would attack
// the mover there; a foe that would go for someone else draws a faint line to that unit and a
// dimmed eye, one that would do nothing (holding, asleep) a dimmed eye and no line.
//
// Correctness: answers come from ThreatForecast.threatsOnTile — the Danger
// overlay's own computation, evaluated with the mover set down on the tile.
// Fog-hidden enemies are never evaluated. No RNG: construction runs under the
// presentation RNG and nothing here draws randomness.
//
// Cost: a cheap key is compared each frame; the threat query runs only when the
// focus tile, selection, turn, battle state, terrain or the mover's weapon reach changes,
// and is memoized per tile against a world signature (units, ballistas and the grid's
// terrain revision). Graphics are redrawn only when the answer changes.
// The eye's bob is a stepped transform tween (static under Reduce Motion).

import { TILE_SIZE } from '../utils/constants.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { getFootprint, isEntity } from '../engine/EntitySystem.js';
import {
  moverReachSignature,
  threatsOnTile,
  threatSummaryText,
  threatWorldSignature,
} from '../engine/ThreatForecast.js';
import { ensureThreatSigilTexture } from '../art/threatSigil.js';
import {
  enemyIntentSignature,
  predictBallistaTargets,
  predictEnemyIntents,
} from '../engine/EnemyIntent.js';

// World depths (below SCREEN_UI so the phone's pinned UI camera leaves them alone).
export const THREAT_SIGHT_DEPTHS = Object.freeze({
  LINES: 7.6, // above path dots (6) and objective tiles (7), below rings (8)
  SIGILS: 16, // above sprites, HP bars and affix pips
});

// Canto too: the unit has acted, but where it ends its turn is still being chosen
// (CANTO_MOVING reads the hovered tile, CANTO_CONFIRM the tile it moved to).
const ACTIVE_STATES = new Set([
  'UNIT_SELECTED',
  'UNIT_ACTION_MENU',
  'CANTO_MOVING',
  'CANTO_CONFIRM',
]);
const CANTO_STATES = new Set(['CANTO_MOVING', 'CANTO_CONFIRM']);

/** The destinations a hovered tile may preview in this state (null: the unit's own tile). */
function previewRange(s) {
  if (s.battleState === 'UNIT_SELECTED') return s.movementRange;
  if (s.battleState === 'CANTO_MOVING') return s.cantoRange;
  return null;
}
const MAX_LINES = 8;
// A foe that can reach but would not go for the mover: a quieter thread and eye.
const ASIDE_LINE_ALPHA = 0.45;
const ASIDE_SIGIL_ALPHA = 0.5;

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
    this._memo.clear();
  }

  /** The unit and tile to read threat for, or null when nothing is being moved. */
  focus() {
    const s = this.scene;
    const unit = s.selectedUnit;
    if (!unit || unit.faction !== 'player' || unit.currentHP <= 0) return null;
    if (unit.hasActed && !CANTO_STATES.has(s.battleState)) return null;
    if (!ACTIVE_STATES.has(s.battleState)) return null;
    if (s.turnManager?.currentPhase && s.turnManager.currentPhase !== 'player') return null;
    const hover = s._threatFocusTile;
    const range = previewRange(s);
    if (hover && range) {
      const entry = range.get(`${hover.col},${hover.row}`);
      const own = hover.col === unit.col && hover.row === unit.row;
      if (entry && entry.stoppable !== false && !own)
        return { unit, col: hover.col, row: hover.row, hovering: true };
    }
    return { unit, col: unit.col, row: unit.row, hovering: false };
  }

  /** Memoized threat answer for `unit` standing on (col, row), with the foes' intents. */
  query(unit, col, row) {
    const s = this.scene;
    if (!s.grid || typeof s.threatContext !== 'function') return null;
    const ctx = s.threatContext();
    const units = [...(s.playerUnits || []), ...(s.enemyUnits || []), ...(s.npcUnits || [])];
    const turn = s.turnManager?.turnNumber ?? null;
    const flags = s.aiController ? s.nextEnemyPhaseAiFlags?.() || {} : {};
    const signature = `${threatWorldSignature(ctx, units)}#${
      s.aiController ? enemyIntentSignature(units, { turn, ...flags }) : ''
    }`;
    if (signature !== this._signature) {
      this._signature = signature;
      this._memo.clear();
    }
    const key = `${idOf(unit)}@${col},${row}`;
    if (!this._memo.has(key)) {
      const result = threatsOnTile(ctx, col, row, { mover: unit });
      this._memo.set(key, this._withIntents(result, ctx, unit, col, row, turn, flags));
    }
    return this._memo.get(key);
  }

  /**
   * The AI's pick for each visible foe (EnemyIntent), folded into the reach answer:
   * `intents` (Map foe -> { kind, target }) and `aimed`, how many would go for the mover.
   * Without the battle's AI the answer is reach alone, as before.
   */
  _withIntents(result, ctx, mover, col, row, turn, flags) {
    const ai = this.scene.aiController;
    if (!ai || !result) return result;
    const intents = predictEnemyIntents({
      ai,
      ctx,
      playerUnits: this.scene.playerUnits || [],
      npcUnits: this.scene.npcUnits || [],
      mover,
      col,
      row,
      turn,
      ...flags,
    });
    const aimsAtMover = (intent) =>
      intent?.target === mover && (intent.kind === 'attack' || intent.kind === 'status');
    // Ballistas are no AI unit: processBallistaFire shoots the army's nearest, lowest-HP unit.
    const ballistaTargets = predictBallistaTargets({
      ballistas: ctx.ballistas || [],
      playerUnits: this.scene.playerUnits || [],
      mover,
      col,
      row,
    });
    let aimed = 0;
    for (const intent of intents.values()) if (aimsAtMover(intent)) aimed++;
    for (const ballista of result.ballistas || []) {
      if (ballistaTargets.get(ballista) === mover) aimed++;
    }
    // A foe the AI sends at the mover is a threat to it whatever the reach check said.
    const listed = new Set([...result.damage, ...result.status]);
    const damage = [...result.damage];
    const status = [...result.status];
    for (const [foe, intent] of intents) {
      if (!aimsAtMover(intent) || listed.has(foe)) continue;
      (intent.kind === 'status' ? status : damage).push(foe);
    }
    const added = damage.length - result.damage.length;
    return {
      ...result,
      damage,
      status,
      count: result.count + added,
      intents,
      ballistaTargets,
      aimed,
    };
  }

  /** HUD line for a tile: "2 foes can reach" (null when the tile is not a move preview). */
  describe(col, row) {
    const focus = this.focus();
    if (!focus) return null;
    const s = this.scene;
    const own = focus.unit.col === col && focus.unit.row === row;
    if (!own) {
      const entry = previewRange(s)?.get(`${col},${row}`);
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
          s.grid?.terrainRevision ?? 0,
          // An Equip or Trade that changes the mover's reach leaves it on its tile, but
          // "counters from here" reads it: the line is asked again.
          moverReachSignature(focus.unit),
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

  /**
   * Where a foe's thread goes: 'mover' (it would attack the mover there, or no intent is known),
   * 'aside' with the unit it would go for instead, or 'none' (it would not attack at all).
   */
  aimOf(result, unit, mover) {
    const intent = result.intents?.get(unit);
    if (!intent) return { aim: 'mover' };
    if (intent.target === mover && (intent.kind === 'attack' || intent.kind === 'status'))
      return { aim: 'mover' };
    if (intent.target && (intent.kind === 'attack' || intent.kind === 'status'))
      return { aim: 'aside', target: intent.target };
    return { aim: 'none' };
  }

  render(current) {
    const s = this.scene;
    const { result, unit: mover } = current;
    const sources = [
      ...result.damage.map((unit) => ({
        unit,
        kind: 'damage',
        ...this.aimOf(result, unit, mover),
      })),
      ...result.ballistas.map((unit) => {
        const pick = result.ballistaTargets?.get(unit);
        // Its shot goes to the nearest unit in reach: the mover's tile may not be it.
        if (result.ballistaTargets && pick && pick !== mover)
          return { unit, kind: 'damage', ballista: true, aim: 'aside', target: pick };
        return { unit, kind: 'damage', ballista: true, aim: 'mover' };
      }),
      ...result.status.map((unit) => ({
        unit,
        kind: 'status',
        ...this.aimOf(result, unit, mover),
      })),
      // The Entity cannot strike this tile but would answer a blow from it: a fainter thread, no eye.
      ...(result.counter || []).map((unit) => ({ unit, kind: 'counter', aim: 'mover' })),
    ];
    const drawnKey = `${current.col},${current.row}|${sources
      .map(
        (src) =>
          `${idOf(src.unit)}:${src.kind}:${src.unit.col},${src.unit.row}:${src.aim}:${
            src.target ? `${idOf(src.target)}@${src.target.col},${src.target.row}` : ''
          }`,
      )
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

    // The threads that point at the mover first: they are what the cap must keep.
    const threads = [
      ...sources.filter((src) => src.aim === 'mover'),
      ...sources.filter((src) => src.aim === 'aside'),
    ];
    threads.slice(0, MAX_LINES).forEach(({ unit, kind, aim, target: other }) => {
      const from = this.sourcePoint(unit);
      if (aim === 'aside') {
        const to = s.grid.gridToPixel(other.col, other.row);
        this._drawLine(g, from, to, kind, ASIDE_LINE_ALPHA);
      } else this._drawLine(g, from, target, kind);
    });
    for (const { unit, kind, aim } of sources) {
      if (kind === 'counter') continue;
      const from = this.sourcePoint(unit);
      this._placeSigil(from, kind, reduce, aim === 'mover' ? 1 : ASIDE_SIGIL_ALPHA);
    }
  }

  _drawLine(g, from, to, kind, alpha = 1) {
    const edge =
      kind === 'status'
        ? UI_HEX.threatStatus
        : kind === 'counter'
          ? UI_HEX.threatCounter
          : UI_HEX.threatEdge;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < TILE_SIZE * 0.75) return; // adjacent: the eye says enough
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
    // A thin red thread over a faint ink shadow so it reads on every grade.
    for (const [width, color, strength] of [
      [3, UI_HEX.threatInk, 0.55],
      [1, edge, 0.95],
    ]) {
      g.lineStyle(width, color, strength * alpha);
      g.lineBetween(from.x + ux * start, from.y + uy * start, from.x + ux * end, from.y + uy * end);
    }
    // A small arrowhead at the tile edge says which way the threat points.
    const tip = { x: from.x + ux * end, y: from.y + uy * end };
    const back = { x: tip.x - ux * 4, y: tip.y - uy * 4 };
    const px = -uy * 2.5;
    const py = ux * 2.5;
    g.fillStyle(edge, 0.95 * alpha);
    g.fillTriangle(tip.x, tip.y, back.x + px, back.y + py, back.x - px, back.y - py);
  }

  _placeSigil(from, kind, reduce, alpha = 1) {
    const s = this.scene;
    const key = ensureThreatSigilTexture(s, kind);
    if (!key || typeof s.add.image !== 'function') return;
    const y = Math.max(Math.round(from.top - 4), 7);
    const sigil = s.add.image(Math.round(from.x), y, key).setDepth(THREAT_SIGHT_DEPTHS.SIGILS);
    sigil.setName?.('threat-sigil');
    if (alpha < 1) sigil.setAlpha?.(alpha);
    sigil.threatKind = kind;
    sigil.threatAim = alpha < 1 ? 'aside' : 'mover';
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
}
