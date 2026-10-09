// EnemyPhasePacing — the enemy phase's dead air (docs/specs/large-maps/
// 02-encounters-and-pacing.md §2.5). Presentation only: nothing here changes a unit,
// the grid, the RNG or what the AI decides; it decides how long the player waits and
// what the player is shown.
//
// 1. A beat only after something the player saw. The scene notes, as an enemy's turn
//    plays, whether the player saw any of it (a move through a tile the player sees, a
//    strike, heal, staff or wall break where the player sees either end). The beat
//    after the enemy (`afterUnit`, AIController) waits `enemy_between_units` at the
//    battle speed (Fast halves it, Instant is 1 ms, hold-to-fast-forward counts as
//    Fast) when it did, and not at all when it did not.
// 2. No tween in the dark. `planEnemyMoveSteps` draws a step of a walk only where the
//    player sees both of its tiles; every other step is one position update and the
//    sprite is shown only on a tile the player sees, so the hidden prefix, the hidden
//    suffix and a hidden stretch in between take no time and never draw the unit in
//    the fog. A lone seen tile between two hidden ones is held for one step's time, so
//    a walk that clips the party's vision is drawn there. Seen steps and holds run at
//    the enemy-phase speed (`enemyStepDuration`: hold-to-fast-forward counts as Fast).
// 3. No checkpoint for a turn that resolved nothing (`skipsIdleCheckpoint`; the proof
//    that the anti-refresh guarantee survives it is in engine/EnemyTurnOutcome.js).
// 4. The enemy heal and status-staff banners name a unit only if the player can see it
//    (`enemyHealBanner`, `seenUnitName`).

import { canInspectUnit } from '../engine/BattleInformation.js';
import { isIdleEnemyDecision } from '../engine/EnemyTurnOutcome.js';
import { enemyPhaseSpeed, speedDuration } from '../utils/combatTiming.js';

/** The beat after a seen enemy at Normal speed (the old fixed pause). */
export const ENEMY_BEAT_MS = 300;
export const ENEMY_BEAT_LABEL = 'enemy_between_units';

/** Can the player see this tile now? With fog off every tile is seen. */
export function isTileSeen(grid, col, row) {
  if (!grid?.fogEnabled) return true;
  return grid.isVisible?.(col, row) === true;
}

/**
 * How an enemy's walk is drawn. Step `i` (path[i - 1] → path[i]) is tweened only when
 * the player sees both tiles; otherwise the sprite is set on path[i] with no tween.
 * `shown` is whether the sprite may be drawn on path[i]. `hold` marks a seen tile the
 * walk enters from the fog and leaves into the fog again (an edge of the party's vision
 * clipped by one tile): no step around it is tweened, so without a hold the sprite would
 * be shown and hidden again before a frame is drawn, while `seen` still says the player
 * saw the turn. The scene holds the sprite there for one step's time.
 * @param {Array<{col:number,row:number}>} path the walk, path[0] the start tile
 * @param {(col:number,row:number)=>boolean} seen
 * @returns {{ steps: Array<{ index:number, tween:boolean, shown:boolean, hold:boolean }>,
 *   seen: boolean }} `seen`: the player saw some tile of the walk (the start included)
 */
export function planEnemyMoveSteps(path, seen) {
  const tiles = Array.isArray(path) ? path : [];
  const visible = tiles.map((t) => seen(t.col, t.row) === true);
  const steps = [];
  const last = tiles.length - 1;
  for (let index = 1; index < tiles.length; index++) {
    const tween = visible[index - 1] && visible[index];
    // The sprite's only moment on screen: shown here, hidden by the very next step.
    const hold = !tween && visible[index] && index < last && !visible[index + 1];
    steps.push({ index, tween, shown: visible[index], hold });
  }
  return { steps, seen: visible.some(Boolean) };
}

/**
 * An idle enemy turn (EnemyTurnOutcome.isIdleEnemyDecision) writes no suspend
 * checkpoint and no timeline row. A turn that has XP to present (queued by something
 * earlier in the phase) keeps today's boundary, so its cards are never shown past an
 * unsaved state.
 */
export function skipsIdleCheckpoint(scene, decision) {
  if (!isIdleEnemyDecision(decision)) return false;
  if ((scene?._pendingLevelUpPopups || []).length) return false;
  if ((scene?._pendingXpGauges || []).length) return false;
  return true;
}

/** A walk step's time at Normal speed: a slid tile is quicker than a walked one. */
export const ENEMY_STEP_MS = 80;
export const ENEMY_SLIDE_STEP_MS = 60;
export const ENEMY_STEP_LABEL = 'animate_enemy_move_step';

/**
 * A seen walk step's time now (the tween between two seen tiles, or the hold on a tile
 * the walk only clips): the battle speed with hold-to-fast-forward counted as Fast, as
 * the beat reads it (enemyPhaseSpeed). Read per step, so a hold pressed mid-walk speeds
 * up the rest of it. Instant is 1 ms: still one drawn frame, as the scene awaits it.
 */
export function enemyStepDuration(scene, { slide = false } = {}) {
  const ms = slide ? ENEMY_SLIDE_STEP_MS : ENEMY_STEP_MS;
  return speedDuration(enemyPhaseSpeed(scene), ENEMY_STEP_LABEL, ms);
}

/** The beat's length now: 0 when the player saw nothing of the turn. */
export function enemyBeatDuration(scene, seen) {
  if (!seen) return 0;
  return speedDuration(enemyPhaseSpeed(scene), ENEMY_BEAT_LABEL, ENEMY_BEAT_MS);
}

/** A unit's name for a banner: its own when the player can see it, else `fallback`. */
export function seenUnitName(grid, unit, fallback) {
  return unit && canInspectUnit(grid, unit) ? unit.name : fallback;
}

/**
 * The enemy heal banner, worded from what the player can see: the healed unit's name
 * only when the player sees it, the healer's when the player sees the healer, and no
 * banner when the player sees neither.
 * @returns {string|null}
 */
export function enemyHealBanner(grid, healer, target, amount) {
  if (canInspectUnit(grid, target)) return `${target.name} healed ${amount} HP`;
  if (canInspectUnit(grid, healer)) return `${healer.name} healed an unseen ally`;
  return null;
}

/**
 * Per enemy-phase bookkeeping of what the player saw of the current enemy's turn. The
 * scene calls `beginUnit` as each enemy decides, the `note*` methods from the action
 * callbacks, and awaits `afterUnit` as AIController's beat.
 */
export class EnemyPhasePacing {
  constructor(scene) {
    this.scene = scene;
    this.seen = false;
  }

  beginUnit() {
    this.seen = false;
  }

  noteSeen(seen) {
    if (seen) this.seen = true;
  }

  /** Something happened between these units: seen when the player sees one of them. */
  noteUnits(...units) {
    const grid = this.scene?.grid;
    this.noteSeen(units.some((unit) => unit && canInspectUnit(grid, unit)));
  }

  noteTile(tile) {
    if (tile) this.noteSeen(isTileSeen(this.scene?.grid, tile.col, tile.row));
  }

  /**
   * The beat after an enemy's turn. Resolves at once when the player saw nothing, or
   * when the phase is no longer current.
   * @param {{ isCurrent?: () => boolean }} [options]
   */
  async afterUnit({ isCurrent = () => true } = {}) {
    const ms = enemyBeatDuration(this.scene, this.seen);
    this.seen = false;
    if (!(ms > 0) || !isCurrent()) return;
    await this.scene._awaitSceneDelay?.(ms, { label: ENEMY_BEAT_LABEL, scaled: true });
  }
}
