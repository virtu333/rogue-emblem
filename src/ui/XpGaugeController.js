// XpGaugeController — the battle's EXP gauge (docs/specs/exp-bars.md §2): after an
// action that gave XP, a gilt bar beside the unit that gained fills from its old XP to
// its new XP, wraps at 100 into the level-up card that follows, and closes.
//
// Presentation only. It plays a gain record (xpGaugeModel.xpGaugeRecord: plain values
// built when the gain was applied) and never reads or writes the unit's XP, a save, a
// checkpoint or the RNG. DOM over the map frame (a non-blocking CeremonyLayer: touches
// go through to the map, the rail stays live); one gauge at a time. Headless (no DOM
// host) it shows nothing and resolves at once.
//
// Speed and motion (§2.3): the fill and hold go through the scaled combat waits
// (xp_gauge_fill / xp_gauge_hold), Fast or hold-to-fast-forward in the enemy phase halves
// them; Instant and Reduce motion show the final state for a hold; Low effects drops the
// glow. A tap, click, Enter / Space / Esc or the pad's Confirm / Cancel skips to the end
// state and closes. A watchdog closes a gauge whose timers never fire. Silent (decision
// 4): the level-up cue on the card marks the wrap.
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { battleSpeed } from '../utils/combatTiming.js';
import { TILE_SIZE, XP_PER_LEVEL } from '../utils/constants.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope, hasInputFocus } from '../utils/inputFocus.js';
import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { findBattleEntity } from '../engine/BattleEntityIdentity.js';
import {
  CeremonyClock,
  CeremonyLayer,
  canRenderCeremony,
  el,
  swallowTrailingClick,
} from './ceremonyDom.js';
import {
  xpGaugeFinal,
  xpGaugeFrame,
  xpGaugePlacement,
  xpGaugePlan,
  xpGaugeTiming,
} from './xpGaugeModel.js';

// A gauge whose fill and hold have not ended this long after they should have is closed.
const WATCHDOG_SLACK_MS = 2000;

const now = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * The speed the gauge plays at: the battle speed, with hold-to-fast-forward counted as
 * Fast in the enemy phase (the gauge plays between exchanges, outside the combat's
 * speed snapshot that battleSpeed reads the hold through).
 */
export function gaugeSpeed(scene) {
  let speed;
  try {
    speed = battleSpeed(scene);
  } catch {
    speed = 'normal';
  }
  if (speed !== 'instant' && scene?._holdBattleFast && scene?.turnManager?.currentPhase === 'enemy')
    return 'fast';
  return speed;
}

/** The gauge's DOM (built once per gauge; render() updates it). */
export function buildXpGauge(record) {
  const gauge = el('div', 'xg-gauge');
  const label = el('span', 'xg-medal xg-medal--label', 'EXP');
  label.setAttribute('aria-hidden', 'true');
  const track = el('span', 'xg-track');
  track.setAttribute('role', 'meter');
  track.setAttribute('aria-label', 'EXP');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(XP_PER_LEVEL));
  const gain = el('span', 'xg-fill xg-fill--gain');
  const held = el('span', 'xg-fill xg-fill--held');
  track.append(gain, held);
  const medal = el('span', 'xg-medal xg-medal--value');
  medal.setAttribute('aria-hidden', 'true');
  const kicker = el('span', 'xg-lvup', 'LV↑');
  const value = el('span', 'xg-value');
  medal.append(kicker, value);
  const plus = el('span', 'xg-plus', `+${record.gained}`);
  gauge.append(label, track, medal, plus);
  return { gauge, track, gain, held, medal, value, plus };
}

/** Draw one frame (xpGaugeModel.xpGaugeFrame) into the gauge's DOM. */
export function renderXpGauge(view, frame, { staticWrap = false } = {}) {
  if (!view || !frame) return;
  const pct = (xp) => String(Math.max(0, Math.min(XP_PER_LEVEL, xp)) / XP_PER_LEVEL);
  view.gauge.style.setProperty('--xg-held', pct(frame.held));
  view.gauge.style.setProperty('--xg-value', pct(frame.value));
  view.gauge.classList.toggle('is-flash', frame.flash === true);
  view.gauge.classList.toggle('is-max', frame.max === true);
  // The beat of a wrap reads LV↑ in the medallion; a static gauge that wrapped keeps a
  // small LV↑ over the number.
  const beat = frame.lvUp && !frame.done;
  view.gauge.classList.toggle('is-beat', beat);
  view.gauge.classList.toggle('is-wrapped', staticWrap && frame.lvUp === true && !frame.max);
  const text = frame.max ? 'MAX' : beat ? '' : String(frame.value);
  if (view.value.textContent !== text) view.value.textContent = text;
  const now = frame.max ? XP_PER_LEVEL : frame.value;
  view.track.setAttribute('aria-valuenow', String(now));
  view.track.setAttribute(
    'aria-valuetext',
    frame.max ? 'EXP MAX, at the level cap' : `${frame.value} of ${XP_PER_LEVEL} EXP`,
  );
}

/**
 * Drive a gauge's fill (xpGaugeFrame frame by frame, on the animation clock) from the
 * held XP to the end state; static timings draw the end state at once. `onFilled` runs
 * once the end state is drawn (not after `cancel`, nor after `finish({ silent: true })`).
 * The battle gauge and the arena's result card share it.
 * @returns {{ plan: object, finish: (o?: { silent?: boolean }) => void, cancel: () => void,
 *   isDone: () => boolean }}
 */
export function fillXpGauge(view, record, timing, { onFilled = null } = {}) {
  const plan = xpGaugePlan(record, timing);
  const draw = (frame) => renderXpGauge(view, frame, { staticWrap: !timing.animate });
  let raf = null;
  let done = false;
  const stop = () => {
    if (raf != null) cancelFrame(raf);
    raf = null;
  };
  const finish = ({ silent = false } = {}) => {
    if (done) return;
    done = true;
    stop();
    draw(xpGaugeFinal(record));
    if (!silent) onFilled?.();
  };
  const cancel = () => {
    done = true;
    stop();
  };
  if (!timing.animate || !(plan.fillMs > 0)) {
    finish();
    return { plan, finish, cancel, isDone: () => done };
  }
  draw(xpGaugeFrame(record, plan, 0));
  const start = now();
  const step = () => {
    raf = null;
    if (done) return;
    const elapsed = now() - start;
    if (elapsed >= plan.fillMs) {
      finish();
      return;
    }
    draw(xpGaugeFrame(record, plan, elapsed));
    raf = schedule(step);
  };
  raf = schedule(step);
  return { plan, finish, cancel, isDone: () => done };
}

export class XpGaugeController {
  constructor(scene) {
    this.scene = scene;
    this.destroyed = false;
    this._active = null;
    this._clock = new CeremonyClock(scene);
    this._onShutdown = () => this.destroy();
    scene?.events?.once?.('shutdown', this._onShutdown);
  }

  /** Nothing to build until a gauge plays (the create/destroy contract). */
  create() {
    return this;
  }

  static available() {
    return canRenderCeremony();
  }

  prefs() {
    const settings = this.scene?.registry?.get?.('settings');
    return {
      speed: gaugeSpeed(this.scene),
      reducedMotion: Boolean(settings?.getReduceMotion?.()),
      lowEffects: settings?.getEffectsQuality?.() === 'low',
    };
  }

  /** True while a gauge is on screen. */
  isShowing() {
    return Boolean(this._active && !this._active.closed);
  }

  /**
   * Play one gain record. Resolves true once the gauge has closed (filled and held, or
   * skipped), false when nothing was shown (headless, no gain, destroyed).
   */
  play(record) {
    if (
      this.destroyed ||
      !record ||
      !(record.gained > 0) ||
      !record.segments?.length ||
      !canRenderCeremony()
    )
      return Promise.resolve(false);
    this._closeActive();
    const prefs = this.prefs();
    const timing = xpGaugeTiming(prefs);
    const plan = xpGaugePlan(record, timing);
    const layer = new CeremonyLayer(this.scene, {
      frame: 'map',
      className: 'xg-layer',
      blocking: false,
      depth: DOM_UI_DEPTHS.XP_GAUGE,
      label: 'EXP gained',
    });
    // A meter that counts every frame is not news: the layer announces nothing.
    layer.root.setAttribute('aria-live', 'off');
    layer.root.classList.toggle('is-static', !timing.animate);
    layer.root.classList.toggle('is-low-fx', prefs.lowEffects);
    layer.root.dataset.fillMs = String(Math.round(timing.animate ? plan.fillMs : 0));
    layer.root.dataset.holdMs = String(Math.round(plan.holdMs));
    const view = buildXpGauge(record);
    layer.root.append(view.gauge);
    layer.addFitter(() => this._place(layer, view, record));

    return new Promise((resolve) => {
      const gauge = { layer, view, record, closed: false };
      this._active = gauge;
      let watchdog = null;
      let unbind = () => {};
      let fill = null;
      const close = () => {
        if (gauge.closed) return;
        gauge.closed = true;
        fill?.cancel();
        clearTimeout(watchdog);
        unbind();
        // The gained span settles to the fill colour as the gauge closes.
        view.gauge.classList.add('is-settled');
        layer.destroy();
        if (this._active === gauge) this._active = null;
        resolve(true);
      };
      gauge.close = close;
      const finish = () => {
        if (gauge.closed) return;
        fill?.finish({ silent: true });
        close();
      };
      gauge.finish = finish;
      unbind = this._bindSkip(gauge, finish);
      watchdog = setTimeout(
        finish,
        (timing.animate ? plan.fillMs : 0) + plan.holdMs + WATCHDOG_SLACK_MS,
      );
      if (typeof watchdog?.unref === 'function') watchdog.unref();
      fill = fillXpGauge(view, record, timing, {
        onFilled: () => {
          if (gauge.closed) return;
          void this._clock.wait(plan.holdMs).then(() => close());
        },
      });
    });
  }

  /** Skip the gauge on screen to its end state and close it. */
  skip() {
    this._active?.finish?.();
  }

  /** Below the gaining unit's tile, or above it; centred when the unit is not on the map. */
  _place(layer, view, record) {
    if (layer.destroyed) return;
    const frame = layer.root.getBoundingClientRect?.();
    const height = view.gauge.getBoundingClientRect?.().height || view.gauge.offsetHeight || 0;
    const tile = this._tileRect(record, frame);
    const { top, side } = xpGaugePlacement(frame, tile, height);
    view.gauge.style.top = `${top}px`;
    view.gauge.dataset.side = side;
  }

  /** The gaining unit's tile in CSS px relative to the frame, or null. */
  _tileRect(record, frame) {
    const scene = this.scene;
    try {
      const unit = findBattleEntity(scene, record, ['playerUnits']);
      if (!unit || !scene?.grid || typeof scene._worldToScreen !== 'function') return null;
      const canvas = scene.game?.canvas?.getBoundingClientRect?.();
      const sw = scene.scale?.width;
      const sh = scene.scale?.height;
      if (!canvas || !sw || !sh || !frame) return null;
      const centre = scene.grid.gridToPixel(unit.col, unit.row);
      const half = TILE_SIZE / 2;
      const a = scene._worldToScreen(centre.x, centre.y - half);
      const b = scene._worldToScreen(centre.x, centre.y + half);
      if (!a || !b) return null;
      const y = (p) => canvas.top + (p.y * canvas.height) / sh - frame.top;
      const top = Math.min(y(a), y(b));
      const bottom = Math.max(y(a), y(b));
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
      return { top, bottom };
    } catch {
      return null;
    }
  }

  /**
   * Skips while a gauge shows: a press anywhere (the layer lets it through to the map,
   * which must not read it as a tap once the battle is playable again), Enter / Space /
   * Esc, or the pad's Confirm / Cancel. Returns the unbind function.
   */
  _bindSkip(gauge, finish) {
    const scene = this.scene;
    const owner = { xpGauge: gauge };
    const doc = globalThis.document;
    const press = (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      // The press reaches the map under the gauge; its release must not select a tile
      // on the board the skip hands back.
      const canvas = scene?.game?.canvas;
      if (event.target && event.target === canvas) {
        scene._uiClickBlocked = true;
        // Lifted off the map (the board never sees that release): nothing to block.
        const lift = (up) => {
          if (event.pointerId !== undefined && up.pointerId !== event.pointerId) return;
          doc?.removeEventListener?.('pointerup', lift, true);
          doc?.removeEventListener?.('pointercancel', lift, true);
          if (up.target !== canvas && scene) scene._uiClickBlocked = false;
        };
        doc?.addEventListener?.('pointerup', lift, true);
        doc?.addEventListener?.('pointercancel', lift, true);
      }
      swallowTrailingClick(event);
      finish();
    };
    const key = (event) => {
      if (!hasInputFocus(owner)) return;
      if (ignoreRepeatedActivation(event)) return;
      if (!['Enter', ' ', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      finish();
    };
    doc?.addEventListener?.('pointerdown', press, true);
    globalThis.addEventListener?.('keydown', key, true);
    pushInputScope(owner, (action) => {
      if ([InputAction.CONFIRM, InputAction.CANCEL, InputAction.PAUSE].includes(action)) finish();
    });
    let bound = true;
    return () => {
      if (!bound) return;
      bound = false;
      doc?.removeEventListener?.('pointerdown', press, true);
      globalThis.removeEventListener?.('keydown', key, true);
      popInputScope(owner);
    };
  }

  _closeActive() {
    const active = this._active;
    this._active = null;
    active?.close?.();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene?.events?.off?.('shutdown', this._onShutdown);
    this._closeActive();
    this._clock.cancelAll();
    if (this.scene?._xpGauge === this) this.scene._xpGauge = null;
    this.scene = null;
  }
}

// The animation clock, with a timer where there is none (Node, tests).
const raf = () => typeof globalThis.requestAnimationFrame === 'function';
function schedule(fn) {
  return raf() ? globalThis.requestAnimationFrame(fn) : setTimeout(fn, 16);
}
function cancelFrame(handle) {
  if (raf()) globalThis.cancelAnimationFrame?.(handle);
  else clearTimeout(handle);
}

/** The scene's EXP gauge (created on demand, gone with the scene); null headless. */
export function xpGaugeFor(scene) {
  if (!scene) return null;
  const existing = scene._xpGauge;
  if (existing && existing.destroyed !== true) return existing;
  if (!canRenderCeremony()) return null;
  scene._xpGauge = new XpGaugeController(scene).create();
  return scene._xpGauge;
}
