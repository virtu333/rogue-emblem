// EntityRallyController — plays the Entity finale's rally (engine/FinaleRally.js) as portrait cards.
//
// The music keeps the time: the first card lands on the finale's downbeat (`leadMs` from the
// call), then one every two bars (rallySchedule). Each card holds until the next beat, and the
// last one fades. The speaker's unit is marked on the board as each card lands (the locator's
// gold brackets), so the player sees who is talking. The battle is never paused and no input scope
// is taken: the card is click-through but for its Skip button, and Cancel (Esc, the pad's B,
// Android Back) reaches it through BattleScene.requestCancel only when nothing else in the battle
// has something to close (`yieldsCancel`).
//
// A line is skipped if its speaker has fallen by its beat; a card ends the moment its speaker falls
// or the battle ends. Skipping (the button or Cancel) drops every line still to come and every
// timer; the choice lives on this controller, which is the battle's, so it is per battle and a
// resumed battle (which never rallies) is unaffected. Without a DOM host (a headless run) each line
// falls back to `fallback(unit, line)`, the floating text over its unit.
//
// Presentation only: no game state, no RNG.

import { flashLocator } from './UnitLocator.js';
import { createRallyCard } from './RallyCard.js';
import { canInspectUnit } from '../engine/BattleInformation.js';
import { RALLY_FADE_MS, rallyCardEdge, rallyCardModel, rallySchedule } from './rallyCardModel.js';

const TICK_MS = 200;

const speaking = (unit) => Number(unit?.currentHP) > 0;

export default class EntityRallyController {
  /**
   * @param {object} scene BattleScene
   * @param {{ fallback?: (unit: object, line: string) => void }} [options]
   */
  constructor(scene, { fallback = null } = {}) {
    this.scene = scene;
    this._fallback = fallback;
    this._rally = [];
    this._timers = [];
    this._tick = null;
    this._finishTimer = null;
    this._card = null;
    this._current = null; // { unit, index } of the card on show
    this._placed = false;
    this.skipped = false;
    this.destroyed = false;
  }

  /** A card is on screen: what Cancel would dismiss. */
  get cardVisible() {
    return Boolean(this._card?.visible);
  }

  /**
   * Begin the rally: `rally` is composeFinaleRally's [{ unit, speaker, line }]; the first card
   * is due `leadMs` from now, the bar is `barMs` long.
   */
  start(rally, { leadMs = 0, barMs } = {}) {
    if (this.destroyed || this.skipped) return;
    this._rally = Array.isArray(rally) ? rally : [];
    for (const step of rallySchedule(this._rally.length, { leadMs, barMs })) {
      const timer = setTimeout(() => {
        this._timers = this._timers.filter((t) => t !== timer);
        this._beat(step);
      }, step.atMs);
      this._timers.push(timer);
    }
  }

  /**
   * Whether the card takes this Cancel: it is on screen and the battle has nothing else to back out
   * of (`somethingToClose`: an open menu, forecast, selection, overlay or panel).
   */
  yieldsCancel(somethingToClose) {
    return this.cardVisible && !somethingToClose;
  }

  /** Dismiss every remaining line (Skip, Cancel). Returns whether anything was on show or due. */
  skip() {
    if (this.destroyed) return false;
    const had = this.cardVisible || this._timers.length > 0;
    this.skipped = true;
    this._clearTimers();
    this._endCard({ fade: false });
    return had;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._clearTimers();
    this._card?.destroy();
    this._card = null;
    this._current = null;
  }

  // ---------------------------------------------------------------- beats

  _beat(step) {
    if (this.destroyed || this.skipped) return;
    const entry = this._rally[step.index];
    if (!entry) return;
    // The previous card's hold ends on this beat whatever happens next.
    if (this._finishTimer) {
      clearTimeout(this._finishTimer);
      this._finishTimer = null;
    }
    // A unit that falls before its line leaves it unsaid.
    if (!speaking(entry.unit) || this._battleOver()) {
      this._endCard({ fade: false, final: step.last });
      return;
    }
    const model = rallyCardModel(entry, { index: step.index, total: this._rally.length });
    if (!this._card) {
      this._card = createRallyCard(this.scene, {
        onSkip: () => this.skip(),
        reduceMotion: this._reduced(),
      });
    }
    if (!this._card) {
      this._fallback?.(entry.unit, entry.line);
      return;
    }
    // the first card picks its edge fresh; later ones keep it unless the other is clearly emptier
    const placed = this._placed;
    this._card.show(model, entry.unit);
    this._card.setEdge(this._edge(placed ? this._card.edge : null));
    this._placed = true;
    this._current = { unit: entry.unit, index: step.index };
    this._mark(entry.unit);
    this._tick ||= setInterval(() => this._watch(), TICK_MS);
    if (step.last) {
      this._finishTimer = setTimeout(() => {
        this._finishTimer = null;
        this._endCard({ fade: true, final: true });
      }, step.holdMs);
    }
  }

  /** Each tick: the speaker fell, the battle ended, or a menu opened where the card sits. */
  _watch() {
    if (this.destroyed || !this._current) return;
    if (this._battleOver()) {
      this.skip();
      return;
    }
    if (!speaking(this._current.unit)) {
      this._endCard({ fade: false });
      return;
    }
    if (this._card) this._card.setEdge(this._edge(this._card.edge));
  }

  /** End the card on show; `final` also takes the card down (nothing more to say). */
  _endCard({ fade, final = false }) {
    if (this._finishTimer) {
      clearTimeout(this._finishTimer);
      this._finishTimer = null;
    }
    this._current = null;
    if (this._tick) clearInterval(this._tick);
    this._tick = null;
    const card = this._card;
    if (!card) return;
    card.hide({ fade });
    if (!final && !this.skipped) return;
    if (!fade) {
      card.destroy();
      this._card = null;
      return;
    }
    // let the fade play out, then take the layer down
    this._finishTimer = setTimeout(() => {
      this._finishTimer = null;
      card.destroy();
      if (this._card === card) this._card = null;
    }, RALLY_FADE_MS + 20);
  }

  _clearTimers() {
    for (const t of this._timers) clearTimeout(t);
    this._timers = [];
    if (this._finishTimer) clearTimeout(this._finishTimer);
    this._finishTimer = null;
    if (this._tick) clearInterval(this._tick);
    this._tick = null;
  }

  // ---------------------------------------------------------------- scene reads

  _reduced() {
    try {
      return Boolean(this.scene?._reduceMotion?.());
    } catch {
      return false;
    }
  }

  _battleOver() {
    const s = this.scene;
    return s?.battleState === 'BATTLE_END' || Boolean(s?.isTransitioningOut);
  }

  /**
   * The edge that covers fewer units (the army and the foes in view); on the desktop a selected
   * unit counts for more, its canvas menu opening beside it (the phone's menus live in its rail,
   * off the map). See rallyCardEdge.
   */
  _edge(current = null) {
    const s = this.scene;
    try {
      const metrics = this._card?.metrics();
      if (!metrics) return current || 'bottom';
      const point = (u) => s._guidance?.screenPoint?.(u) || null;
      const { frame } = metrics;
      const inFrame = (p) => p && p.x >= frame.left && p.x <= frame.left + frame.width;
      const seen = (u) => u?.currentHP > 0 && (!s.grid || canInspectUnit(s.grid, u));
      const ys = [...(s.playerUnits || []), ...(s.enemyUnits || [])]
        .filter(seen)
        .map(point)
        .filter(inFrame)
        .map((p) => p.y);
      const selected =
        !s._mobileBattleHud && s.selectedUnit && s.battleState !== 'PLAYER_IDLE'
          ? point(s.selectedUnit)
          : null;
      return rallyCardEdge({
        ys,
        selectedY: inFrame(selected) ? selected.y : null,
        frame,
        insets: metrics.insets,
        cardHeight: metrics.height,
        current,
      });
    } catch {
      return current || 'bottom';
    }
  }

  /** The speaker's tile: the locator's gold brackets, never a camera move. */
  _mark(unit) {
    try {
      const pos = this.scene?.grid?.gridToPixel?.(unit.col, unit.row);
      if (pos) flashLocator(this.scene, pos.x, pos.y);
    } catch {
      /* a cue is decoration */
    }
  }
}
