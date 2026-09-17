import { BattlefieldLab, battlefieldLabEnabled } from './BattlefieldLab.js';
import { createHealthBar } from './healthBar.js';
import { textureImageSource } from './textureImageSource.js';
import { hasInputFocus } from '../utils/inputFocus.js';
import { getEffectivenessMultiplier } from '../engine/Combat.js';

const PLAY_STATES = new Set([
  'PLAYER_IDLE',
  'UNIT_SELECTED',
  'UNIT_MOVING',
  'UNIT_MOVED',
  'UNIT_ACTION_MENU',
  'SHOWING_FORECAST',
  'CONFIRMING_ATTACK',
  'ENEMY_PHASE',
  'COMBAT_RESOLVING',
  'CANTO_MOVING',
]);
const HINTS = {
  PLAYER_IDLE: 'Tap a unit to begin. Pinch to zoom the map.',
  UNIT_MOVING: 'Moving…',
  UNIT_SELECTED: 'Tap a highlighted tile to move.',
  UNIT_ACTION_MENU: 'Choose an action for this unit.',
  CANTO_MOVING: 'Tap a tile to reposition, or choose Menu to finish.',
  ENEMY_PHASE: 'Enemy turn',
  COMBAT_RESOLVING: 'Resolving combat…',
  SHOWING_FORECAST: 'Review the forecast before committing.',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

// A view over BattleScene's existing actions. Combat calculations and move rules
// remain in the scene/engine; this layer only owns DOM presentation and gestures.
export class MobileBattleHUD {
  constructor(scene) {
    this.scene = scene;
    this.wrapper = document.getElementById('game-wrapper');
    this.root = el('aside', 'mobile-battle-hud');
    this.root.setAttribute('aria-label', 'Battle commands');
    this.root.hidden = true;
    this.phase = el('div', 'mb-phase');
    this.summary = el('div', 'mb-summary');
    this.body = el('div', 'mb-body');
    this.root.append(this.phase, this.summary, this.body);
    this.wrapper.append(this.root);
    this.menu = null;
    this.forecast = null;
    this.endTurnPending = null;
    this.visible = false;
    this.lastSnapshot = '';
    if (battlefieldLabEnabled()) this.lab = new BattlefieldLab(this);
  }

  available() {
    const s = this.scene;
    return (
      hasInputFocus(s) &&
      !s.isStoryInputLocked() &&
      !s.pauseOverlay?.visible &&
      !s.unitDetailOverlay?.visible &&
      !s.visionDialog &&
      !s.rosterOverlay?.visible &&
      !s.lootSettingsOverlay
    );
  }

  button(label, action, className = '') {
    const button = el('button', `mb-button ${className}`, label);
    button.type = 'button';
    // Native click handles keyboard activation and cancels a scrolling touch.
    // Also reject a dragged pointer explicitly, including mouse emulation.
    let start = null;
    let dragged = false;
    button.addEventListener('pointerdown', (event) => {
      start = { x: event.clientX, y: event.clientY };
      dragged = false;
      event.stopPropagation();
    });
    button.addEventListener('pointermove', (event) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
        dragged = true;
    });
    button.addEventListener('pointercancel', () => {
      dragged = true;
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if ((event.detail !== 0 && dragged) || !this.available()) return;
      action();
      this.lastSnapshot = '';
      this.sync();
    });
    return button;
  }

  showMenu(items, objects) {
    this.menu = { items, objects, unit: this.scene.selectedUnit };
    for (const object of objects) object.setVisible(false);
    this.lastSnapshot = '';
    this.sync();
  }

  hideMenu() {
    this.menu = null;
    this.lastSnapshot = '';
  }

  showForecast(config) {
    this.hideForecast();
    this.forecast = config;
    const modal = el('div', 'mb-forecast-backdrop');
    const panel = el('section', 'mb-forecast');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Combat forecast');
    panel.append(el('h2', '', 'Combat forecast'));
    const sides = el('div', 'mb-forecast-sides');
    sides.append(
      this.forecastSide(config.attacker, config.defender, config.forecast.attacker, true, config),
      this.forecastSide(config.defender, config.attacker, config.forecast.defender, false, config),
    );
    panel.append(sides);
    const footer = el('div', 'mb-forecast-footer');
    footer.append(this.button('Cancel', () => this.scene.requestCancel({ allowPause: false })));
    if (config.validWeapons.length > 1) {
      footer.append(this.button('‹ Weapon', () => this.scene._cycleForecastWeapon(-1)));
      footer.append(this.button('Weapon ›', () => this.scene._cycleForecastWeapon(1)));
    }
    footer.append(
      this.button(
        'Confirm attack',
        () => {
          if (this.forecast !== config || this.scene.battleState !== 'SHOWING_FORECAST') return;
          this.scene.confirmForecastCombat();
        },
        'mb-primary',
      ),
    );
    panel.append(footer);
    // The backdrop intercepts taps; only the explicit confirm action commits.
    for (const type of ['pointerdown', 'pointerup', 'click'])
      modal.addEventListener(type, (event) => event.stopPropagation());
    modal.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (this.available()) this.scene.requestCancel({ allowPause: false });
      } else if (event.key === 'Tab') {
        const buttons = [...panel.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement);
        const next = (index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        event.preventDefault();
        buttons[next]?.focus();
      }
    });
    modal.append(panel);
    this.wrapper.append(modal);
    this.modal = modal;
    this.lastSnapshot = '';
    this.sync();
    if (!modal.hidden) footer.querySelector('button')?.focus({ preventScroll: true });
  }

  forecastSide(unit, opponent, info, attacking, config) {
    const side = el('article', `mb-forecast-side ${attacking ? 'mb-ally' : 'mb-enemy'}`);
    side.append(el('div', 'mb-eyebrow', attacking ? 'Your attack' : 'Enemy response'));
    const portraitKey = this.scene._getPortraitKey(unit);
    if (portraitKey && this.scene.textures.exists(portraitKey)) {
      const source = textureImageSource(this.scene.textures.get(portraitKey));
      if (source) {
        const portrait = el('img', 'mb-portrait');
        portrait.src = source;
        portrait.alt = '';
        side.append(portrait);
      }
    }
    side.append(el('h3', '', unit.name));
    side.append(el('div', 'mb-weapon', unit.weapon?.name || 'Unarmed'));
    side.append(el('div', 'mb-hp', `HP ${unit.currentHP} / ${unit.stats.HP}`));
    side.append(createHealthBar(unit));
    if (!attacking && !info.canCounter) side.append(el('p', 'mb-notice', 'Cannot counter'));
    else {
      const stats = el('dl', 'mb-stats');
      for (const [name, value] of [
        ['Damage', `${info.damage} × ${info.attackCount || 1}`],
        ['Hit', `${info.hit}%`],
        ['Critical', `${info.crit}%`],
        ['Attack speed', info.as],
      ]) {
        const pair = el('div');
        pair.append(el('dt', '', name), el('dd', '', value));
        stats.append(pair);
      }
      side.append(stats);
    }
    if (
      unit.weapon &&
      (attacking || info.canCounter) &&
      getEffectivenessMultiplier(unit.weapon, opponent) > 1
    )
      side.append(el('p', 'mb-notice', 'Effective damage'));
    const skills = (info.skills || []).map((skill) => skill.name);
    if (unit.skills?.some((skill) => (typeof skill === 'string' ? skill : skill?.id) === 'miracle'))
      skills.push(`Miracle: ${unit._miracleUsed ? 'used' : 'ready'}`);
    if (skills.length) side.append(el('p', 'mb-detail', skills.join(' · ')));
    if (attacking && config.weaponArt) {
      const cost = this.scene._formatWeaponArtCostLabel(unit, config.weaponArt);
      const after = this.scene._getWeaponArtHpAfterCost(unit, config.weaponArt);
      side.append(
        el(
          'p',
          'mb-notice',
          `${config.weaponArt.name} · HP cost ${cost} (${unit.currentHP} → ${after})`,
        ),
      );
    }
    if (attacking && config.gamblerLine) side.append(el('p', 'mb-notice', config.gamblerLine));
    for (const warning of info.warnings || []) side.append(el('p', 'mb-notice', warning));
    return side;
  }

  hideForecast() {
    this.modal?.remove();
    this.modal = null;
    this.forecast = null;
    this.lastSnapshot = '';
  }

  sync() {
    const s = this.scene;
    const state = s.battleState || '';
    // Capture nested weapon/equipment pickers as well as the primary action list.
    // Their callbacks remain owned by BattleScene, including equip/cancel rules.
    if (
      this.lab &&
      state === 'UNIT_ACTION_MENU' &&
      s.actionMenu &&
      this.menu?.objects !== s.actionMenu
    ) {
      const items = s.actionMenu
        .filter((object) => typeof object?._action === 'function')
        .map((object) => ({ label: object.text, onActivate: object._action }));
      if (items.length) {
        this.menu = { items, objects: s.actionMenu, unit: s.selectedUnit };
        for (const object of s.actionMenu) object.setVisible(false);
        s._hideWeaponDetailTooltip();
        this.lastSnapshot = '';
      }
    }
    const supported = PLAY_STATES.has(state) || state.startsWith('SELECTING_');
    const show = supported && this.available();
    // The lab reserves its viewport for the entire battle, including modal/animation states.
    if (this.lab) {
      this.root.inert = !show;
      this.root.classList.toggle('bl-inactive', !show);
    }
    if (show !== this.visible) {
      this.visible = show;
      this.root.hidden = this.lab ? false : !show;
      this.wrapper.classList.toggle('mobile-battle-layout', this.lab ? true : show);
      s.scale?.getParentBounds();
      s.scale?.refresh();
    }
    if (this.modal) this.modal.hidden = !show || state !== 'SHOWING_FORECAST';
    if (!show) {
      if (!this.lab) this.restoreLabels();
      this.endTurnPending = null;
      return;
    }
    // Keep source text updated by the game, but present it at a readable CSS size.
    const canvasLabels = [s.infoText, s.objectiveText, s.turnCounterText, s.visionHudText];
    for (const label of canvasLabels) {
      if (!label) continue;
      this.hiddenLabels ||= new Map();
      if (!this.hiddenLabels.has(label)) this.hiddenLabels.set(label, label.visible);
      label.setVisible(false);
    }
    const unit = s.selectedUnit || (s.inspectionPanel?.visible ? s.inspectionPanel._unit : null);
    const turn = s.turnManager?.turnNumber || 1;
    const remaining = (s.playerUnits || []).filter((u) => u.currentHP > 0 && !u.hasActed).length;
    const key = JSON.stringify([
      state,
      turn,
      remaining,
      unit?.name,
      unit?.currentHP,
      unit?.weapon?.name,
      s.inspectMode,
      s.dangerZone?.visible,
      Boolean(this.menu),
      Boolean(this.endTurnPending),
      s.infoText?.text,
      s._mobileTerrainFocus,
      s.objectiveText?.text,
      s.turnCounterText?.text,
      s.visionHudText?.text,
    ]);
    if (key === this.lastSnapshot) return;
    if (
      this.endTurnPending &&
      (this.endTurnPending.state !== state || this.endTurnPending.turn !== turn)
    )
      this.endTurnPending = null;
    this.lastSnapshot = key;
    this.phase.textContent = `TURN ${turn}  /  ${s.turnManager?.currentPhase === 'enemy' ? 'ENEMY' : 'PLAYER'}`;
    this.summary.replaceChildren();
    const focus = s._mobileTerrainFocus || unit;
    if (unit) {
      this.summary.append(el('h2', '', unit.name));
      this.summary.append(
        el('div', 'mb-detail', `${unit.className} · ${unit.weapon?.name || 'Unarmed'}`),
      );
      const hp = createHealthBar(unit);
      this.summary.append(hp, el('span', 'mb-hp', `${unit.currentHP} / ${unit.stats.HP} HP`));
    } else {
      if (!this.lab)
        this.summary.append(el('h2', '', s.inspectMode ? 'Inspect a unit' : 'Your battlefield'));
      if (!this.lab || !focus)
        this.summary.append(el('div', 'mb-detail', `${remaining} units ready`));
    }
    if (this.lab && focus) {
      const terrain = s.grid.getTerrainAt(focus.col, focus.row);
      if (terrain) {
        const visibleUnit = s.grid.isVisible(focus.col, focus.row)
          ? s.getUnitAt(focus.col, focus.row)
          : null;
        const moveType = s.selectedUnit?.moveType || visibleUnit?.moveType || 'Infantry';
        const cost = terrain.moveCost?.[moveType];
        const bonus = (value) =>
          Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? '+' : ''}${Number(value)}` : '—';
        const card = el('div', 'mb-terrain');
        card.setAttribute('aria-label', 'Terrain advantages');
        card.append(el('strong', '', terrain.name));
        card.append(
          el('span', '', `Move ${Number.isFinite(Number(cost)) ? cost : 'blocked'} · ${moveType}`),
        );
        card.append(
          el('span', '', `Def ${bonus(terrain.defBonus)} · Avoid ${bonus(terrain.avoidBonus)}`),
        );
        if (terrain.special) {
          const effect = terrain.special.replace(
            'Slide: non-flying units slide in entry direction until non-Ice tile',
            'Slide straight until off ice (non-flying).',
          );
          card.append(el('small', '', effect));
        }
        this.summary.append(card);
      }
    }
    const expanded = this.body.querySelector('.mb-battle-info')?.open || false;
    this.body.replaceChildren();
    this.body.append(
      el('p', 'mb-objective', s.objectiveText?.text || s.battleConfig?.objective || 'Battle'),
    );
    const details = el('details', 'mb-battle-info');
    details.open = expanded;
    details.append(el('summary', '', this.lab ? 'More' : 'Battle info'));
    const info = [
      s.turnCounterText?.text,
      s.visionHudText?.text?.replace(/^Eye:/, 'Rewinds:'),
      s.infoText?.text,
    ]
      .filter(Boolean)
      .join('\n');
    const detailContent = el('div', 'mb-more-content');
    detailContent.append(el('pre', '', info || 'Tap a tile to inspect terrain.'));
    details.append(detailContent);
    if (!this.menu && !this.endTurnPending) this.body.append(details);
    if (this.endTurnPending) {
      this.body.append(el('p', 'mb-hint', `End your turn? ${remaining} units still have actions.`));
      const token = this.endTurnPending;
      this.body.append(
        this.button('Keep playing', () => {
          this.endTurnPending = null;
        }),
      );
      this.body.append(
        this.button(
          'End turn now',
          () => {
            if (
              this.endTurnPending !== token ||
              s.battleState !== token.state ||
              s.turnManager?.turnNumber !== token.turn
            )
              return;
            this.endTurnPending = null;
            s.forceEndTurn();
          },
          'mb-danger',
        ),
      );
      return;
    }
    if (!this.lab || !['PLAYER_IDLE', 'UNIT_SELECTED'].includes(state))
      this.body.append(
        el(
          'p',
          'mb-hint',
          s.inspectMode
            ? 'Tap an ally or enemy to view their details.'
            : HINTS[state] ||
                (state.startsWith('SELECTING_')
                  ? 'Tap a highlighted target. Cancel to go back.'
                  : 'Choose an action on the battlefield.'),
        ),
      );
    if (state === 'UNIT_ACTION_MENU' && this.menu) {
      const menu = this.menu;
      const list = el('div', 'mb-actions');
      for (const item of menu.items) {
        list.append(
          this.button(
            item.label,
            () => {
              if (
                this.menu !== menu ||
                s.actionMenu !== menu.objects ||
                s.selectedUnit !== menu.unit ||
                s.battleState !== 'UNIT_ACTION_MENU'
              )
                return;
              this.hideMenu();
              item.onActivate();
            },
            item.label === 'Attack' ? 'mb-primary' : '',
          ),
        );
      }
      this.body.append(list);
      return;
    }
    if (['PLAYER_IDLE', 'UNIT_SELECTED'].includes(state)) {
      const commands = el('div', 'mb-command-grid');
      for (const [label, action, active] of [
        ['Danger', 'danger', s.dangerZone?.visible],
        ['Inspect', 'inspect', s.inspectMode],
        ['Roster', 'roster', null],
        ['Rewind', 'objective', null],
      ]) {
        const button = this.button(label, () => {
          if (action === 'inspect' && s.selectedUnit) {
            const unit = s.selectedUnit;
            const living = s.playerUnits.filter((u) => u.currentHP > 0);
            s.unitDetailOverlay.show(unit, s.grid.getTerrainAt(unit.col, unit.row), s.gameData, {
              rosterUnits: living,
              rosterIndex: Math.max(0, living.indexOf(unit)),
            });
            s.refreshEndTurnControl();
          } else s.game.events.emit(`mobile:${action}`);
        });
        if (active != null) button.setAttribute('aria-pressed', String(Boolean(active)));
        commands.append(button);
      }
      this.body.append(commands);
      this.body.append(
        this.button(
          'End turn…',
          () => {
            if (!s.canForceEndTurn()) return;
            this.endTurnPending = { state: s.battleState, turn: s.turnManager.turnNumber };
          },
          'mb-end-turn',
        ),
      );
    }
  }

  restoreLabels() {
    for (const [label, visible] of this.hiddenLabels || []) label.setVisible?.(visible);
    this.hiddenLabels?.clear();
  }

  destroy() {
    this.lab?.destroy();
    this.restoreLabels();
    this.hideForecast();
    this.root.remove();
    this.wrapper.classList.remove('mobile-battle-layout');
    this.scene.scale?.getParentBounds();
    this.scene.scale?.refresh();
    this.menu = null;
  }
}
