// BossPresenceController — the boss bar.
//
// A thin crimson bar docked at the bottom of the map area (phones: left of
// the command rail; desktop: inside the letterboxed canvas, clear of the
// command row). Boss name in Cinzel above, HP numbers, a gold chunk that
// shows the damage just dealt and then drains, and the enrage state (ember
// bar + status line) from the existing turn-pressure enrage.
//
// It only ever *reads* battle state. Damage/heal arrive through
// BattleScene.updateHPBar → onUnitHp(); resume and rewind call
// sync({ silent: true }) so a restored battle shows its bar without any
// animation or "just lost" chunk. Removed on boss death, battle end and
// scene shutdown. Hidden while menus, forecasts or dialogue need the space.

import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { getBossEnrageTurn } from '../engine/TurnBonusCalculator.js';
import {
  bossBarView,
  bossPressureStatus,
  createBossBarState,
  isWordlessBoss,
  reduceBossBar,
} from './ceremonyContent.js';
import { CeremonyLayer, canRenderCeremony, el } from './ceremonyDom.js';

const DRAIN_DELAY_MS = 450;
const DRAIN_MS = 650;
const FELLED_FADE_MS = 900;

export class BossPresenceController {
  constructor(scene) {
    this.scene = scene;
    this.state = createBossBarState();
    this.layer = null;
    this._timers = new Set();
    this._suppressed = false;
    this.destroyed = false;
  }

  create() {
    if (this.destroyed || this.layer || !canRenderCeremony()) return this;
    this.layer = new CeremonyLayer(this.scene, {
      frame: 'map',
      className: `ce-bossbar-layer${this.scene.isMobileInput ? '' : ' ce-bossbar-layer--desktop'}`,
      depth: DOM_UI_DEPTHS.BOSSBAR,
    });
    this.layer.root.removeAttribute('role');
    const bar = el('div', 'ce-bossbar');
    bar.hidden = true;
    const label = el('div', 'ce-bossbar-label');
    this._name = el('span', 'ce-bossbar-name');
    this._hp = el('span', 'ce-bossbar-hp');
    label.append(this._name, this._hp);
    const track = el('div', 'ce-bossbar-track');
    this._lost = el('div', 'ce-bossbar-lost');
    this._fill = el('div', 'ce-bossbar-fill');
    track.append(this._lost, this._fill);
    this._status = el('div', 'ce-bossbar-status');
    bar.append(label, track, this._status);
    bar.setAttribute('role', 'meter');
    bar.setAttribute('aria-valuemin', '0');
    this.bar = bar;
    this.layer.root.append(bar);
    this._onPostUpdate = () => this._updateSuppression();
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

  /** Re-read the boss from battle state. `silent`: no chunk, no motion. */
  sync({ silent = false } = {}) {
    if (this.destroyed || !this.layer) return;
    const scene = this.scene;
    const boss = this._bossUnit();
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
    this._updateSuppression();
  }

  /** updateHPBar hook: only the tracked boss matters. */
  onUnitHp(unit) {
    if (!unit?.isBoss || unit.faction !== 'enemy') return;
    this.sync();
  }

  /** The boss died: drain to empty and fade the bar out. */
  onBossDefeated() {
    if (this.destroyed || !this.layer) return;
    this._dispatch({ type: 'defeated' });
    this._later(DRAIN_DELAY_MS, () => this._dispatch({ type: 'drain' }));
    this._later(DRAIN_DELAY_MS + DRAIN_MS, () => {
      this.bar?.classList.add('is-leaving');
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
    const prev = this.state;
    this.state = next;
    this._render(prev, { silent });
    if (next.visible && !next.felled && next.lostFrom > next.hp) {
      this._clearTimers();
      this._later(DRAIN_DELAY_MS, () => this._dispatch({ type: 'drain' }));
    }
  }

  _render(prev, { silent }) {
    const bar = this.bar;
    if (!bar) return;
    const view = bossBarView(this.state);
    const appearing = view.visible && !prev.visible;
    bar.hidden = !view.visible;
    if (!view.visible) {
      bar.classList.remove('is-leaving', 'is-entering');
      return;
    }
    bar.classList.toggle('is-entering', appearing && !silent && !this._reducedMotion());
    if (!view.felled) bar.classList.remove('is-leaving');
    bar.classList.toggle('is-ember', view.tone === 'ember');
    bar.classList.toggle('is-unlight', view.tone === 'unlight');
    bar.classList.toggle('is-felled', view.felled);
    bar.classList.toggle('is-static', silent || this._reducedMotion());
    this._name.textContent = view.name;
    this._hp.textContent = view.hpText;
    this._fill.style.width = `${view.fillPct}%`;
    this._lost.style.width = `${view.lostPct}%`;
    this._status.textContent = view.status;
    this._status.hidden = !view.status;
    bar.setAttribute('aria-label', this.state.wordless ? 'Unknown foe' : this.state.name);
    bar.setAttribute('aria-valuemax', String(this.state.max));
    bar.setAttribute('aria-valuenow', String(this.state.hp));
    if (view.hpText) bar.setAttribute('aria-valuetext', `${view.hpText} HP`);
    else bar.removeAttribute('aria-valuetext');
  }

  // Canvas panels (desktop forecast, unit details, loot) and paused states
  // share the bottom of the map; the bar steps aside rather than cover them.
  _updateSuppression() {
    const s = this.scene;
    if (!s || !this.bar) return;
    const suppressed = Boolean(
      s._forecastOverlay ||
      s.battleState === 'PAUSED' ||
      s.battleState === 'DEPLOY_SELECTION' ||
      s.battleState === 'BATTLE_END' ||
      s.unitDetailOverlay?.visible ||
      s.lootGroup ||
      s.dialogueOverlay?.visible ||
      s._ceremonies?.isBlocking?.(),
    );
    if (suppressed === this._suppressed) return;
    this._suppressed = suppressed;
    this.bar.classList.toggle('is-suppressed', suppressed);
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
    this.scene?.events?.off?.('postupdate', this._onPostUpdate);
    this.scene?.events?.off?.('shutdown', this._onShutdown);
    this.layer?.destroy();
    this.layer = null;
    this.bar = null;
    this.scene = null;
  }
}
