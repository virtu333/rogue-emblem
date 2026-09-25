// BossPresenceController — the boss's own health bar, on the map.
//
// A compact reliquary bar rides the boss unit in place of its ordinary HP bar
// (feet, where every unit's bar sits, so it never covers the unit on the tile
// above): wider, gilt-framed, crimson fill, a gold chunk that shows the damage
// just dealt and then drains, a crest diamond, and the enrage state (ember
// frame plus a flame pip) from the existing turn-pressure enrage. It follows
// the boss through move tweens, fog and multi-tile Entity footprints.
//
// The full reading (name, HP, enrage timing) lives off-map in summaryLine():
// the phone rail's Battle details and the desktop objective plate show it.
//
// It only ever *reads* battle state. Damage/heal arrive through
// BattleScene.updateHPBar → onUnitHp(); resume and rewind call
// sync({ silent: true }) so a restored battle shows the bar without any
// animation or "just lost" chunk. Removed on boss death, battle end and
// scene shutdown. Presentation only: no RNG, no saves.

import { ENTITY_FOOTPRINT, TILE_SIZE } from '../utils/constants.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { getBossEnrageTurn } from '../engine/TurnBonusCalculator.js';
import { isEntity } from '../engine/EntitySystem.js';
import {
  bossBarView,
  bossPressureStatus,
  createBossBarState,
  isWordlessBoss,
  reduceBossBar,
} from './ceremonyContent.js';

const DRAIN_DELAY_MS = 450;
const DRAIN_MS = 650;
const FELLED_FADE_MS = 900;
// Above unit HP bars (12/13) and affix pips (14); below labels/HUD.
export const BOSS_BAR_DEPTH = 14.5;
const BAR_H = 4; // fill height (ordinary bars are 3)

export class BossPresenceController {
  constructor(scene) {
    this.scene = scene;
    this.state = createBossBarState();
    this.bar = null;
    this.glow = null;
    this._timers = new Set();
    this._lostShown = 0;
    this.destroyed = false;
  }

  create() {
    if (this.destroyed || this.bar) return this;
    const add = this.scene?.add;
    if (!add?.graphics) return this;
    this.bar = add.graphics().setDepth(BOSS_BAR_DEPTH).setVisible(false);
    this.glow = add
      .graphics()
      .setDepth(BOSS_BAR_DEPTH - 0.05)
      .setVisible(false);
    this._onPostUpdate = () => this._follow();
    this.scene.events?.on?.('postupdate', this._onPostUpdate);
    this._onShutdown = () => this.destroy();
    this.scene.events?.once?.('shutdown', this._onShutdown);
    return this;
  }

  _reducedMotion() {
    return Boolean(this.scene?.registry?.get?.('settings')?.getReduceMotion?.());
  }

  _bossUnit() {
    return (this.scene?.enemyUnits || []).find((u) => u?.isBoss && u.currentHP > 0) || null;
  }

  _snapshot(boss) {
    if (!boss) return null;
    return {
      key: boss.battleEntityId || boss.name,
      name: boss.name,
      hp: boss.currentHP,
      max: boss.stats?.HP,
      wordless: isWordlessBoss(boss, this.scene.gameData?.enemies),
    };
  }

  /** Current view model (tests, the rail and the desktop plate read it). */
  view() {
    return bossBarView(this.state);
  }

  /**
   * One line for off-map readers: "Warchief · 26/26 HP · Enrages on turn 12".
   * Empty when no boss is on the field.
   */
  summaryLine() {
    const v = this.view();
    if (!v.visible || v.felled) return '';
    return [v.name, v.hpText ? `${v.hpText.replace(' / ', '/')} HP` : '', v.status]
      .filter(Boolean)
      .join(' · ');
  }

  /** Re-read the boss from battle state. `silent`: no chunk, no motion. */
  sync({ silent = false } = {}) {
    if (this.destroyed) return;
    const scene = this.scene;
    const boss = this._bossUnit();
    this.boss = boss;
    const grid = scene.grid;
    const concealed = Boolean(
      boss &&
      grid?.fogEnabled &&
      typeof grid.isVisible === 'function' &&
      !grid.isVisible(boss.col, boss.row),
    );
    const enraged = Boolean(boss && scene.antiTurtleState?.turnEnrageActive);
    const threshold = getBossEnrageTurn(scene.turnPar, scene.turnBonusConfig);
    const status = boss
      ? bossPressureStatus({
          turn: scene.getCurrentTurnNumber?.() ?? scene.turnManager?.turnNumber,
          threshold,
          enraged,
        })
      : '';
    if (silent) this._clearTimers();
    this._dispatch(
      { type: 'sync', boss: this._snapshot(boss), enraged, status, silent, concealed },
      { silent },
    );
    this._follow();
  }

  /** updateHPBar hook: only the tracked boss matters. */
  onUnitHp(unit) {
    if (!unit?.isBoss || unit.faction !== 'enemy') return;
    this.sync();
  }

  /** The boss died: drain to empty and fade the bar out. */
  onBossDefeated() {
    if (this.destroyed) return;
    this._dispatch({ type: 'defeated' });
    this._later(DRAIN_DELAY_MS, () => this._dispatch({ type: 'drain' }));
    this._later(DRAIN_DELAY_MS + DRAIN_MS, () => {
      this._fadeOut(this._reducedMotion() ? 0 : FELLED_FADE_MS);
      this._later(this._reducedMotion() ? 0 : FELLED_FADE_MS, () =>
        this._dispatch({ type: 'hide' }),
      );
    });
  }

  /** Battle over: take the bar down. */
  hide() {
    this._clearTimers();
    this._dispatch({ type: 'hide' });
  }

  _dispatch(event, { silent = false } = {}) {
    const next = reduceBossBar(this.state, event);
    if (next === this.state) return;
    this.state = next;
    const view = this.view();
    // The gold chunk drains smoothly unless motion is reduced or the sync is silent.
    const animate = event.type === 'drain' && !silent && !this._reducedMotion();
    if (animate && this.scene?.tweens?.addCounter) {
      const from = this._lostShown;
      this.scene.tweens.addCounter({
        from,
        to: view.lostPct,
        duration: DRAIN_MS,
        ease: 'Cubic.easeOut',
        onUpdate: (tween) => {
          this._lostShown = tween.getValue();
          this._draw();
        },
      });
    } else this._lostShown = view.lostPct;
    if (next.visible && !event.type.startsWith('hide')) this.bar?.setAlpha?.(1);
    this._draw();
    this._follow();
    if (next.visible && !next.felled && next.lostFrom > next.hp) {
      this._clearTimers();
      this._later(DRAIN_DELAY_MS, () => this._dispatch({ type: 'drain' }));
    }
  }

  /** Bar width (world px): wider than a unit's, spanning an Entity's footprint. */
  _width() {
    const boss = this.boss;
    if (boss && isEntity(boss)) return TILE_SIZE * ENTITY_FOOTPRINT.width - 6;
    return TILE_SIZE + 4;
  }

  _draw() {
    const g = this.bar;
    if (!g) return;
    const v = this.view();
    g.clear();
    this.glow?.clear?.();
    if (!v.visible) return;
    const w = this._width();
    const half = w / 2;
    const top = -BAR_H / 2;
    const frame =
      v.tone === 'ember'
        ? UI_HEX.emberPale
        : v.tone === 'unlight'
          ? UI_HEX.rarityEpic
          : UI_HEX.accent;
    // HP stays crimson when enraged (gold is the damage chunk); the frame and halo say "enraged".
    const fill = v.tone === 'unlight' ? UI_HEX.rarityEpic : UI_HEX.hpLow;
    // Ink bed with a one-pixel gilt frame (chamfered ends).
    g.fillStyle(UI_HEX.void, 0.92);
    g.fillRect(-half - 2, top - 2, w + 4, BAR_H + 4);
    g.lineStyle(1, frame, 1);
    g.beginPath();
    g.moveTo(-half, top - 1.5);
    g.lineTo(half, top - 1.5);
    g.lineTo(half + 1.5, top);
    g.lineTo(half + 1.5, top + BAR_H);
    g.lineTo(half, top + BAR_H + 1.5);
    g.lineTo(-half, top + BAR_H + 1.5);
    g.lineTo(-half - 1.5, top + BAR_H);
    g.lineTo(-half - 1.5, top);
    g.closePath();
    g.strokePath();
    // Gold "just lost" chunk under the crimson fill.
    const lost = Math.max(v.fillPct, this._lostShown);
    if (lost > v.fillPct) {
      g.fillStyle(UI_HEX.accentText, 1);
      g.fillRect(-half, top, (w * lost) / 100, BAR_H);
    }
    g.fillStyle(fill, 1);
    g.fillRect(-half, top, (w * v.fillPct) / 100, BAR_H);
    // Highlight line for a jewel-like read at small sizes.
    g.fillStyle(UI_HEX.parchment, 0.22);
    g.fillRect(-half, top, (w * v.fillPct) / 100, 1);
    // Crest diamond at the left end marks the bar as the boss's.
    g.fillStyle(frame, 1);
    g.fillPoints(
      [
        { x: -half - 4, y: 0 },
        { x: -half, y: -4 },
        { x: -half + 4, y: 0 },
        { x: -half, y: 4 },
      ],
      true,
    );
    g.fillStyle(UI_HEX.void, 1);
    g.fillRect(-half - 1, -1, 2, 2);
    if (v.tone === 'ember' && this.glow) {
      // Enraged: ember halo around the bar and a flame pip at the right end.
      this.glow.fillStyle(UI_HEX.accent, 0.35);
      this.glow.fillRect(-half - 4, top - 4, w + 8, BAR_H + 8);
      g.fillStyle(UI_HEX.emberPale, 1);
      g.fillPoints(
        [
          { x: half + 2, y: 3 },
          { x: half + 5, y: -5 },
          { x: half + 8, y: 3 },
        ],
        true,
      );
    }
    this._ensurePulse(v.tone === 'ember');
  }

  _ensurePulse(on) {
    const tweens = this.scene?.tweens;
    if (!this.glow || !tweens) return;
    if (on && !this._pulse && !this._reducedMotion()) {
      this._pulse = tweens.add({
        targets: this.glow,
        alpha: { from: 0.35, to: 1 },
        duration: 700,
        yoyo: true,
        repeat: -1,
      });
    } else if ((!on || this._reducedMotion()) && this._pulse) {
      this._pulse.stop?.();
      this._pulse = null;
      this.glow.setAlpha?.(1);
    }
  }

  // Follow the boss's own HP bar: it is tweened with the sprite on every move,
  // hidden by fog with it, and already knows an Entity's footprint centre.
  _follow() {
    const g = this.bar;
    if (!g) return;
    const v = this.view();
    if (!v.visible) {
      if (g.visible) g.setVisible(false);
      this.glow?.setVisible?.(false);
      return;
    }
    const boss = this.boss;
    const anchor = boss?.hpBar?.bg;
    let shown;
    if (anchor && anchor.active !== false) {
      // The ordinary bar steps aside (alpha only: fog owns its visibility).
      if (anchor.alpha !== 0) anchor.setAlpha?.(0);
      if (boss.hpBar.fill && boss.hpBar.fill.alpha !== 0) boss.hpBar.fill.setAlpha?.(0);
      g.setPosition(anchor.x, anchor.y + 1);
      this.glow?.setPosition?.(anchor.x, anchor.y + 1);
      shown = boss.graphic?.visible !== false && anchor.visible !== false;
    } else shown = v.felled; // the fallen boss's bar drains where it stood
    if (g.visible !== shown) g.setVisible(shown);
    this.glow?.setVisible?.(shown && v.tone === 'ember');
  }

  _fadeOut(ms) {
    const g = this.bar;
    if (!g) return;
    if (!ms || !this.scene?.tweens?.add) {
      g.setAlpha?.(0);
      return;
    }
    this.scene.tweens.add({ targets: [g, this.glow].filter(Boolean), alpha: 0, duration: ms });
  }

  _later(ms, fn) {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      if (!this.destroyed) fn();
    }, ms);
    this._timers.add(timer);
  }

  _clearTimers() {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._clearTimers();
    this._pulse?.stop?.();
    this._pulse = null;
    this.scene?.events?.off?.('postupdate', this._onPostUpdate);
    this.scene?.events?.off?.('shutdown', this._onShutdown);
    const anchor = this.boss?.hpBar;
    anchor?.bg?.setAlpha?.(1);
    anchor?.fill?.setAlpha?.(1);
    this.bar?.destroy?.();
    this.glow?.destroy?.();
    this.bar = null;
    this.glow = null;
    this.scene = null;
  }
}
