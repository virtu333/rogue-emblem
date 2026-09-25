// TutorialCoach — the tutorial's persistent, non-modal objective line.
//
// One goal at a time (tutorialCoachModel), docked over the map area on the side
// away from what it points at, with chapter pips, a "Skip step" for the guided
// movement lesson and an always-visible "Leave". Gate nudges replace the old
// blocking "finish this step first" notes. Presentation only: it reads scene
// state each frame and calls back into TutorialController for actions.

import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { COACH_CHAPTERS, coachChapterIndex, tutorialCoachState } from './tutorialCoachModel.js';

const COVERING_STATES = new Set([
  'TUTORIAL_HINT',
  'PAUSED',
  'BATTLE_END',
  'DEPLOY_SELECTION',
  'SHOWING_FORECAST',
  'CONFIRMING_ATTACK',
]);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export class TutorialCoach {
  /**
   * @param {Phaser.Scene} scene  BattleScene in tutorial mode
   * @param {{ onLeave: Function, onSkipStep: Function }} actions
   */
  constructor(scene, { onLeave, onSkipStep }) {
    this.scene = scene;
    this.onLeave = onLeave;
    this.onSkipStep = onSkipStep;
    this.wrapper = document.getElementById('game-wrapper');
    this.root = el('section', 're-coach');
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Tutorial guide');
    this.root.hidden = true;
    for (const type of DOM_INPUT_EVENTS)
      this.root.addEventListener(type, (event) => event.stopPropagation());
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    this.root.addEventListener('keyup', (event) => event.stopPropagation());

    const top = el('div', 're-coach-top');
    const kicker = el('span', 're-coach-kicker', 'Tutorial');
    this.pips = el('ol', 're-coach-pips');
    this.pips.setAttribute('aria-label', 'Tutorial progress');
    for (const chapter of COACH_CHAPTERS) {
      const pip = el('li');
      pip.dataset.chapter = chapter.id;
      pip.append(el('span', 're-visually-hidden', chapter.label));
      this.pips.append(pip);
    }
    const actions = el('div', 're-coach-actions');
    this.skip = el('button', 're-coach-btn', 'Skip step');
    this.skip.type = 'button';
    this.skip.addEventListener('click', () => this.onSkipStep?.());
    this.leave = el('button', 're-coach-btn re-coach-leave', 'Leave');
    this.leave.type = 'button';
    this.leave.setAttribute('aria-label', 'Leave tutorial');
    this.leave.addEventListener('click', () => this.onLeave?.());
    actions.append(this.skip, this.leave);
    this.goal = el('p', 're-coach-goal');
    this.goal.setAttribute('aria-live', 'polite');
    const lead = el('div', 're-coach-lead');
    const meta = el('div', 're-coach-meta');
    meta.append(kicker, this.pips);
    lead.append(meta, this.goal);
    top.append(lead, actions);

    this.detail = el('p', 're-coach-detail');
    this.nudgeLine = el('p', 're-coach-nudge');
    this.nudgeLine.setAttribute('role', 'alert');
    this.nudgeLine.hidden = true;
    this.root.append(top, this.detail, this.nudgeLine);
    this.wrapper?.append(this.root);

    this.tick = () => this.sync();
    scene.game?.events?.on?.('poststep', this.tick);
    this.shutdown = () => this.destroy();
    scene.events?.once?.('shutdown', this.shutdown);
    this.lastKey = '';
    // Hidden until the controller reveals it (after the phase banner clears).
    this.revealed = false;
    this.sync();
  }

  reveal() {
    this.revealed = true;
    this.lastKey = '';
    this.sync();
  }

  snapshot() {
    const s = this.scene;
    const units = (s.playerUnits || []).map((u) => ({
      name: u.name,
      acted: Boolean(u.hasActed),
      hp: Number(u.currentHP) || 0,
      maxHp: Number(u.stats?.HP) || 1,
      healer: (u.inventory || []).some((item) => item?.type === 'Staff' && !item.relocate),
    }));
    const commander = (s.playerUnits || []).find((u) => u.isCommander) || null;
    const menu =
      s._mobileBattleHud?.menu?.items?.map((item) => item.label) ||
      s.actionMenu?.map?.((entry) => entry?.label).filter(Boolean) ||
      [];
    return {
      step: Number(s.tutorialStep),
      gateReleased: Boolean(s._tutorialStrictGateReleased),
      phase: s.turnManager?.currentPhase || 'player',
      state: s.battleState || '',
      touch: Boolean(s.isMobileInput),
      commanderName: commander?.name || 'Edric',
      units,
      enemies: (s.enemyUnits || []).filter((u) => u.currentHP > 0).length,
      menu,
      selected: s.selectedUnit?.name || null,
      selectionMenu: Boolean(s._inputController?.isSelectionMenu?.()),
    };
  }

  covered() {
    const s = this.scene;
    return Boolean(
      COVERING_STATES.has(s.battleState) ||
      s.pauseOverlay?.visible ||
      s.unitDetailOverlay?.visible ||
      s.rosterOverlay?.visible ||
      s.visionDialog ||
      s._ceremonies?.isBlocking?.() ||
      document.querySelector('.mr-sheet, .re-modal-shield, .mp-backdrop:not([hidden])'),
    );
  }

  /** Screen rect of the map area (the canvas), in CSS px. */
  mapRect() {
    const canvas = this.scene.game?.canvas;
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect || rect.width < 1) return null;
    return rect;
  }

  /** CSS-px center of a grid tile, or null. */
  tileScreen(col, row) {
    const s = this.scene;
    const canvas = s.game?.canvas;
    if (!canvas || !s.grid?.gridToPixel || typeof s._worldToScreen !== 'function') return null;
    const world = s.grid.gridToPixel(col, row);
    const p = s._worldToScreen(world.x, world.y);
    const r = canvas.getBoundingClientRect();
    return {
      x: r.x + (p.x * r.width) / s.scale.width,
      y: r.y + (p.y * r.height) / s.scale.height,
    };
  }

  anchorPoint(anchor) {
    const s = this.scene;
    if (!anchor) return null;
    if (anchor.kind === 'unit') {
      const unit = (s.playerUnits || []).find((u) => u.name === anchor.name);
      return unit ? this.tileScreen(unit.col, unit.row) : null;
    }
    if (anchor.kind === 'fort') {
      const fort = s._getTutorialFortTile?.();
      return fort ? this.tileScreen(fort.col, fort.row) : null;
    }
    return null;
  }

  sync() {
    if (this.destroyed) return;
    const hidden = !this.revealed || this.covered();
    const state = hidden ? null : tutorialCoachState(this.snapshot());
    // The rail's matching command glows while the coach points at it.
    const hud = this.scene._mobileBattleHud?.root;
    if (hud) {
      const target = state?.anchor?.kind === 'hud' ? state.anchor.hud : '';
      if ((hud.dataset.coachTarget || '') !== target) {
        if (target) hud.dataset.coachTarget = target;
        else delete hud.dataset.coachTarget;
      }
    }
    // Unit anchors outside the guided steps get a ring (the gate draws its own).
    const ringUnit =
      state?.anchor?.kind === 'unit' && this.scene._tutorialStrictGateReleased
        ? (this.scene.playerUnits || []).find((u) => u.name === state.anchor.name)
        : null;
    this.scene._tutorialController?.markAnchor?.(ringUnit || null);
    if (!state) {
      this.root.hidden = true;
      this.lastKey = '';
      return;
    }
    // A correction belongs to the step it corrected.
    if (state.id !== this.stepId) {
      if (this.stepId && this.message?.tone === 'warn') {
        clearTimeout(this.nudgeTimer);
        this.message = null;
        this.root.classList.remove('is-nudged');
      }
      this.stepId = state.id;
    }
    this.renderMessage(true);
    const map = this.mapRect();
    const point = this.anchorPoint(state.anchor);
    // Dock away from the anchor: an anchor in the upper half sends the coach down.
    const bottom = Boolean(map && point && point.y < map.top + map.height * 0.5);
    const key = JSON.stringify([
      state.id,
      state.goal,
      state.detail,
      bottom,
      map && [
        Math.round(map.left),
        Math.round(map.top),
        Math.round(map.width),
        Math.round(map.height),
      ],
      this.message?.text,
    ]);
    this.root.hidden = false;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.goal.textContent = state.goal;
    this.detail.textContent = state.detail;
    this.skip.hidden = !state.canSkip;
    const current = coachChapterIndex(state.chapter);
    [...this.pips.children].forEach((pip, index) => {
      pip.classList.toggle('is-done', index < current);
      if (index === current) pip.setAttribute('aria-current', 'step');
      else pip.removeAttribute('aria-current');
    });
    this.root.dataset.step = state.id;
    this.root.classList.toggle('is-bottom', bottom);
    if (map) {
      // Phone rail layout: the canvas is the map pane, dock in its corner. Desktop:
      // the canvas carries HUD plates at its edges, so center and clear them.
      const pane = this.wrapper?.classList?.contains('battlefield-lab');
      const inset = pane ? 8 : Math.round(map.height * 0.1);
      const width = Math.min(pane ? 500 : 480, Math.max(220, map.width - 16));
      const left = pane ? map.left + 8 : map.left + (map.width - width) / 2;
      this.root.style.left = `${Math.round(left)}px`;
      this.root.style.width = `${Math.round(width)}px`;
      if (bottom) {
        this.root.style.top = '';
        this.root.style.bottom = `${Math.round(globalThis.innerHeight - map.bottom + inset)}px`;
      } else {
        this.root.style.bottom = '';
        this.root.style.top = `${Math.round(map.top + inset)}px`;
      }
    }
  }

  /**
   * A short line under the goal: 'warn' corrects an input the step does not allow,
   * 'info' explains something in passing. Queued until the coach is next on
   * screen, then shown for a few seconds. Returns false only when destroyed.
   */
  nudge(text, tone = 'warn') {
    if (this.destroyed) return false;
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = null;
    this.message = { text, tone, shown: false };
    this.revealed = true;
    this.lastKey = '';
    this.sync();
    return true;
  }

  renderMessage(visible) {
    const message = this.message;
    if (!message || !visible) {
      if (!message) this.nudgeLine.hidden = true;
      return;
    }
    this.nudgeLine.textContent = message.text;
    this.nudgeLine.dataset.tone = message.tone;
    this.nudgeLine.setAttribute('role', message.tone === 'warn' ? 'alert' : 'status');
    this.nudgeLine.hidden = false;
    if (message.shown) return;
    message.shown = true;
    if (message.tone === 'warn') {
      this.root.classList.remove('is-nudged');
      void this.root.offsetWidth; // restart the shake
      this.root.classList.add('is-nudged');
    }
    this.nudgeTimer = setTimeout(
      () => {
        if (this.message !== message) return;
        this.message = null;
        this.nudgeLine.hidden = true;
        this.root.classList.remove('is-nudged');
        this.lastKey = '';
      },
      message.tone === 'warn' ? 3600 : 5200,
    );
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.nudgeTimer);
    this.scene.game?.events?.off?.('poststep', this.tick);
    this.scene.events?.off?.('shutdown', this.shutdown);
    const hud = this.scene._mobileBattleHud?.root;
    if (hud) delete hud.dataset.coachTarget;
    this.root.remove();
  }
}
