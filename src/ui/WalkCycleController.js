/**
 * WalkCycleController — dresses a unit's move across the battle map as a walk.
 *
 * Map sprites have no walk cycle, so while a unit crosses its path this runs the idle
 * frames at a step cadence, hops the sprite a pixel or two per tile (a flier glides
 * instead; a slide across Ice glides too), and lands the unit in a small puff of the
 * ground it stops on. The rules and numbers are pure (walkCycleModel.js); this owns the
 * unit's graphic while it moves and gives it back exactly as it was.
 *
 * Hooks (BattleScene): `step(unit, { ms, slide })` as each tile's tween is created and
 * `end(unit, { col, row })` when the move ends (no tile: it was cut short or failed, so
 * no puff). Between them a scene 'postupdate' listener (after the tweens have written
 * the tile's position) adds the lift to the graphic's y and picks the idle frame.
 *
 * Presentation only:
 *   - never Math.random: the puff's variation comes from a seeded generator, and the
 *     Phaser objects it draws are built inside withPresentationRandom (during a battle
 *     Math.random IS the battle RNG); no particle emitters;
 *   - never battle state, order or timing: it adds no wait, no tween and no callback to
 *     the move, and every entry point sits inside safeBattlePresentation, so a render
 *     error cannot stop a move;
 *   - honours reduced motion (no hop, no cycle, no puff), effects quality (low: no puff)
 *     and Instant speed (read from the battle speed: a player tile keeps 80 ms at Instant);
 *   - the puff is drawn only on a tile the player sees (BattleInformation.isUnitSeenAt),
 *     so a hidden unit's landing is never given away;
 *   - the unit's rest frame and height are restored when the move ends, is cut short, or
 *     the walk goes quiet; a destroyed or replaced graphic is simply let go.
 *
 * `g._walkCycle` is set on a walking unit's graphic: the map idle loop (TracedSprites
 * startTracedIdle) leaves such a unit alone, as it does one holding an attack pose.
 */
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import { createSeededRng } from '../engine/BlessingEngine.js';
import { battleSpeed, combatDuration } from '../utils/combatTiming.js';
import { isUnitSeenAt } from '../engine/BattleInformation.js';
import { isEntity } from '../engine/EntitySystem.js';
import { FxMotePool } from './FxMotePool.js';
import { ATTACK_FRAMES, IDLE_FRAMES, TRACED_PREFIX } from './TracedSprites.js';
import {
  advanceWalkPhase,
  puffAllowed,
  puffFamilyFor,
  puffMotes,
  stepCadenceMs,
  walkAllowed,
  walkFrameName,
  walkPose,
  walkProfile,
  isStale,
} from './walkCycleModel.js';

// Layering (CombatFxController): faction rings 8, unit sprites 10..10.9, labels 11. The
// puff sits behind every unit, so it never covers one, and below the fog (90).
export const PUFF_DEPTH = 9.95;
const PUFF_CAPACITY = 36;
/** The unit's feet below its tile centre (world px; CombatFxController's unit points). */
const FEET_OFFSET_Y = 12;

const alive = (g) => Boolean(g && g.scene && g.active !== false);

export default class WalkCycleController {
  constructor(scene) {
    this.scene = scene;
    this._walkers = new Map(); // unit -> walk record
    this._pool = null;
    this._puffs = 0; // puffs drawn: seeds the next one's variation
    this._listening = false;
    this.dead = false;
    this._onPostUpdate = () => this._update();
  }

  create() {
    if (this._listening || this.dead || !this.scene?.events?.on) return;
    this.scene.events.on('postupdate', this._onPostUpdate);
    this._listening = true;
  }

  /** Units walking now (tests, diagnostics). */
  get walking() {
    return this._walkers.size;
  }

  get liveMotes() {
    return this._pool?.liveCount ?? 0;
  }

  // ------------------------------------------------------------------ settings --

  _reduced() {
    return Boolean(this.scene._reduceMotion?.());
  }

  _quality() {
    return this.scene._effectsQuality?.() ?? 'high';
  }

  _now() {
    return this.scene.time?.now ?? 0;
  }

  _safe(label, fn) {
    return safeBattlePresentation(label, fn, { scene: this.scene });
  }

  // ------------------------------------------------------------------ the hooks --

  /**
   * A tile's step begins (its tween is being created): `ms` is the tween's time, `slide`
   * whether the step is a slide across Ice. The first step of a move starts its walk.
   */
  step(unit, { ms, slide = false } = {}) {
    this._safe('walk step', () => {
      if (this.dead) return;
      const g = unit?.graphic;
      if (!alive(g) || isEntity(unit)) return;
      let walk = this._walkers.get(unit);
      const speed = battleSpeed(this.scene);
      if (!walkAllowed({ reduced: this._reduced(), stepMs: ms, speed })) {
        // a move that was a walk but is not drawn as one now (Instant, reduced motion)
        if (walk) this._restore(walk);
        return;
      }
      this.create();
      if (walk && walk.graphic !== g) {
        this._restore(walk);
        walk = null;
      }
      const now = this._now();
      if (!walk) walk = this._begin(unit, g, now);
      this._unlift(walk); // the new tween reads the tile's own height as its start
      walk.stepStart = now;
      walk.stepMs = ms;
      walk.slide = Boolean(slide);
      walk.cadence = stepCadenceMs(ms, walk.profile);
    });
  }

  /**
   * The move ended. The unit's frame and height are put back; with the tile it landed on
   * (`col`, `row`) a puff of that ground is drawn if the player sees it. Without a tile
   * (cut short, failed, superseded) nothing is drawn.
   */
  end(unit, { col, row } = {}) {
    const walk = this._walkers.get(unit);
    if (!walk) return;
    const gait = walk.profile.gait;
    this._safe('walk end', () => this._restore(walk));
    this._walkers.delete(unit);
    if (!Number.isFinite(col) || !Number.isFinite(row)) return;
    this._safe('landing puff', () => this._landingPuff(unit, col, row, gait));
  }

  /** A graphic is going away or being replaced (death, rewind): let go of it. */
  releaseUnit(unit) {
    const walk = this._walkers.get(unit);
    if (!walk) return;
    this._safe('walk release', () => this._restore(walk));
    this._walkers.delete(unit);
  }

  /** Put every walking unit back and hide the puffs (checkpoint restore, rewind). */
  reset() {
    for (const walk of [...this._walkers.values()])
      this._safe('walk reset', () => this._restore(walk));
    this._walkers.clear();
    this._pool?.releaseAll();
  }

  destroy() {
    this.reset();
    this.dead = true;
    if (this._listening) this.scene?.events?.off?.('postupdate', this._onPostUpdate);
    this._listening = false;
    this._pool?.destroy();
    this._pool = null;
  }

  // ------------------------------------------------------------------ walking --

  _begin(unit, g, now) {
    const restFrame = g.frame?.name ?? null;
    // Only a traced sprite has idle frames to cycle, and never over a held attack pose.
    const posed = g._fxPose || ATTACK_FRAMES.includes(restFrame) || g.data?.get?.('tracedPose');
    const cycle = Boolean(g.texture?.key?.startsWith?.(TRACED_PREFIX) && g.setFrame && !posed);
    const walk = {
      unit,
      graphic: g,
      profile: walkProfile(unit.moveType),
      start: now,
      stepStart: now,
      stepMs: 0,
      slide: false,
      cadence: 100,
      phase: Math.max(0, IDLE_FRAMES.indexOf(restFrame)),
      lastNow: now,
      cycle,
      restFrame,
      baseY: null,
      appliedY: null,
    };
    g._walkCycle = true;
    this._walkers.set(unit, walk);
    return walk;
  }

  /** The walk's frame and lift, once a frame (after the tweens have written positions). */
  _update() {
    if (!this._walkers.size) return;
    this._safe('walk cycle', () => {
      const now = this._now();
      const reduced = this._reduced();
      let failure = null;
      for (const walk of [...this._walkers.values()]) {
        try {
          const g = walk.graphic;
          if (!alive(g) || walk.unit.graphic !== g) {
            this._walkers.delete(walk.unit); // nothing of ours left on it to restore
            continue;
          }
          if (reduced || isStale(now, walk.stepStart)) {
            this._restore(walk);
            this._walkers.delete(walk.unit);
            continue;
          }
          const pose = walkPose({
            profile: walk.profile,
            now,
            startMs: walk.start,
            stepStart: walk.stepStart,
            stepMs: walk.stepMs,
            slide: walk.slide,
          });
          if (pose.cycling) {
            walk.phase = advanceWalkPhase(walk.phase, now - walk.lastNow, walk.cadence);
            if (walk.cycle) {
              const name = walkFrameName(walk.phase, IDLE_FRAMES);
              if (name && g.frame?.name !== name) g.setFrame(name, false, false);
            }
          }
          walk.lastNow = now;
          this._lift(walk, pose.lift);
        } catch (error) {
          failure ||= error;
          this._walkers.delete(walk.unit);
          try {
            this._restore(walk);
          } catch {
            // the graphic is gone: nothing to put back
          }
        }
      }
      if (failure) throw failure; // reported once, the other walkers already served
    });
  }

  /**
   * Hold the graphic `lift` px above its tile. The tween writes y as an absolute each
   * frame, so what this added is only still there when y is exactly what it left.
   */
  _lift(walk, lift) {
    const g = walk.graphic;
    const base = walk.appliedY !== null && g.y === walk.appliedY ? walk.baseY : g.y;
    const y = base - lift;
    g.y = y;
    walk.baseY = base;
    walk.appliedY = y;
  }

  /** Take back the lift, if it is still on the graphic. */
  _unlift(walk) {
    const g = walk.graphic;
    if (walk.appliedY !== null && alive(g) && g.y === walk.appliedY) g.y = walk.baseY;
    walk.appliedY = null;
  }

  /** The unit as it was before the walk: its rest frame and its height. */
  _restore(walk) {
    const g = walk.graphic;
    this._walkers.delete(walk.unit);
    if (g) g._walkCycle = false;
    if (!alive(g)) return;
    this._unlift(walk);
    if (walk.cycle && walk.restFrame && g.frame?.name !== walk.restFrame) {
      const held =
        g._fxPose || ATTACK_FRAMES.includes(g.frame?.name) || g.data?.get?.('tracedPose');
      if (!held) g.setFrame(walk.restFrame, false, false);
    }
  }

  // ------------------------------------------------------------------ the puff --

  _landingPuff(unit, col, row, gait) {
    const scene = this.scene;
    const grid = scene.grid;
    const g = unit.graphic;
    if (this.dead || !grid || !alive(g) || g.visible === false) return;
    const speed = battleSpeed(scene);
    const seen = isUnitSeenAt(grid, unit, col, row);
    if (!puffAllowed({ reduced: this._reduced(), quality: this._quality(), speed, gait, seen }))
      return;
    if (!scene.add?.image || !scene.textures?.exists?.('fx_atlas')) return;
    const terrain = grid.getTerrainAt?.(col, row)?.name;
    const biome = scene.battleConfig?.biome || grid.biome || null;
    const family = puffFamilyFor(terrain, biome);
    const pos = grid.gridToPixel(col, row);
    const seed =
      (Math.imul(col + 1, 73856093) ^
        Math.imul(row + 1, 19349663) ^
        Math.imul(++this._puffs, 83492791)) >>>
      0;
    const lifeScale = combatDuration(scene, 100) / 100;
    const motes = puffMotes(family, pos.x, pos.y + FEET_OFFSET_Y, createSeededRng(seed), lifeScale);
    // Phaser draws UUIDs and random values from Math.random while it builds an object:
    // the pool's lazily made images are made on the presentation stream.
    withPresentationRandom(() => {
      this._pool ||= new FxMotePool(scene, { capacity: PUFF_CAPACITY, depth: PUFF_DEPTH });
      for (const mote of motes) this._pool.spawn(mote);
    });
  }
}
