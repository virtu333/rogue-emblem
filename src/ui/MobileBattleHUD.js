import { ContextHelp } from './ContextHelp.js';
import { compactBattleObjective, sidebarCounters } from './battleSidebarDisplay.js';
import { battlePlace } from './placeDisplay.js';
import { bindHoldBattleSpeed, canHoldBattleSpeed } from './HoldBattleSpeed.js';
import { syncTutorialForecastLayout } from './tutorialForecastLayout.js';
import { TutorialController } from './TutorialController.js';
import {
  showContextualHint,
  claimContextualHint,
  observeContextualHint,
  isHintTextVisible,
} from './HintDisplay.js';
import { forecastProjection, forecastNotes, forecastTeachingHints } from './forecastDisplay.js';
import {
  canInspectUnit,
  statusDescriptions,
  statusStaffInfo,
} from '../engine/BattleInformation.js';
import { bindCancelablePress } from '../utils/cancelablePress.js';
import { formatWeaponArtEffects, weaponArtUsesText } from './weaponArtDisplay.js';
import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { battleItemSummary } from './battleItemSummary.js';
import { BattlefieldLab, battlefieldLabEnabled } from './BattlefieldLab.js';
import { createHealthBar } from './healthBar.js';
import { textureImageSource } from './textureImageSource.js';
import { hasInputFocus, pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import { getEffectivenessMultiplier } from '../engine/Combat.js';
import { threatSummaryText } from '../engine/ThreatForecast.js';
import { pc98PortraitElement, portraitFaction, portraitIdForUnit, usePc98 } from './portraitArt.js';

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
  'TURN_START_RESOLVING',
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
  TURN_START_RESOLVING: 'Applying turn-start effects…',
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
    this.root.tabIndex = -1;
    this.phase = el('div', 'mb-phase');
    this.summary = el('div', 'mb-summary');
    this.objective = el('div', 'mb-objective-slot');
    this.terrain = el('div', 'mb-terrain-slot');
    this.body = el('div', 'mb-body');
    this.speedHold = el('button', 'mb-button', 'Hold to speed up');
    this.speedHold.type = 'button';
    this.speedHold.hidden = true;
    this.speedHold.setAttribute('aria-pressed', 'false');
    this.disposeSpeedHold = bindHoldBattleSpeed(this.speedHold, scene);
    this.root.append(
      this.phase,
      this.objective,
      this.terrain,
      this.summary,
      this.speedHold,
      this.body,
    );
    this.wrapper.append(this.root);
    for (const type of DOM_INPUT_EVENTS)
      this.root.addEventListener(type, (event) => event.stopPropagation());
    this.root.addEventListener('keyup', (event) => event.stopPropagation());
    this.root.addEventListener('keydown', (event) => {
      if (ignoreRepeatedActivation(event)) return;
      if (!this.available()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.scene.requestCancel();
        return;
      }
      if (!this.menu || this.scene.battleState !== 'UNIT_ACTION_MENU') return;
      // Keep native Enter/Space activation and Tab, but prevent the scene from
      // also acting on this key after the DOM control has handled it.
      event.stopPropagation();
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.scene._menuFocus?.move(event.key === 'ArrowDown' ? 1 : -1);
      }
    });
    this.menu = null;
    this.forecast = null;
    this.endTurnPending = null;
    this.visible = false;
    this.lastSnapshot = '';
    if (battlefieldLabEnabled()) this.lab = new BattlefieldLab(this);
  }

  available({ allowTurnStart = false } = {}) {
    const s = this.scene;
    return (
      (hasInputFocus(s) || (this.modal && hasInputFocus(this))) &&
      (!s.isStoryInputLocked() || (allowTurnStart && s.battleState === 'TURN_START_RESOLVING')) &&
      !s.pauseOverlay?.visible &&
      !s.unitDetailOverlay?.visible &&
      !s.visionDialog &&
      !s.rosterOverlay?.visible &&
      !s.lootSettingsOverlay
    );
  }

  button(label, action, className = '', onLongPress = null) {
    const button = el('button', `mb-button ${className}`, label);
    button.type = 'button';
    bindCancelablePress(
      button,
      () => {
        action();
        this.lastSnapshot = '';
        this.sync();
      },
      {
        enabled: () => this.available() && (!hasInputFocus(this) || this.modal?.contains(button)),
        onLongPress: onLongPress
          ? () => {
              onLongPress();
              this.lastSnapshot = '';
              this.sync();
            }
          : null,
      },
    );
    return button;
  }

  requestEndTurn() {
    const s = this.scene;
    if (!this.available() || !s.canForceEndTurn()) return false;
    this.endTurnPending = { state: s.battleState, turn: s.turnManager.turnNumber };
    this.lastSnapshot = '';
    this.sync();
    this.body.querySelector('button')?.focus({ preventScroll: true });
    return true;
  }

  showMenu(items, objects) {
    this.menu = { items, objects, unit: this.scene.selectedUnit };
    if (this.scene.battleParams?.tutorialMode && this.scene._tutorialStrictGateReleased)
      void (this.scene._tutorialController ||= new TutorialController(
        this.scene,
      )).showResourceLesson(items);
    if (items.some((entry) => entry.item?.type === 'Consumable'))
      showContextualHint(
        this.scene,
        'battle_consumable_supply',
        'Consumable uses do not refill. Check the effect and remaining uses before spending your run supply.',
      );
    else if (items.some((entry) => entry.item?.type === 'Staff'))
      showContextualHint(
        this.scene,
        'battle_staff_scope',
        'Staff uses refill at the start of every battle. Use healing now when it helps your army.',
      );
    for (const object of objects || []) object.setVisible?.(false);
    this.scene._hideWeaponDetailTooltip();
    this.lastSnapshot = '';
    this.sync();
  }

  focusMenuItem(sourceButton) {
    const item = this.menu?.items.find((entry) => entry.button === sourceButton);
    if (!item?.domButton || !this.available()) return;
    item.domButton.focus({ preventScroll: true });
    item.domButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    const heading = el('header', 'mb-forecast-footer');
    const title = el('h2', '', 'Combat forecast');
    title.style.flex = '2';
    title.style.alignSelf = 'center';
    heading.append(title);
    panel.append(heading);
    const sides = el('div', 'mb-forecast-sides');
    sides.append(
      this.forecastSide(config.attacker, config.defender, config.forecast.attacker, true, config),
      this.forecastSide(config.defender, config.attacker, config.forecast.defender, false, config),
    );
    const scroll = (direction) => {
      sides.scrollTop += direction * Math.max(48, sides.clientHeight * 0.75);
    };
    for (const [label, direction] of [
      ['Read above', -1],
      ['Read below', 1],
    ]) {
      const control = this.button(label, () => scroll(direction));
      control.setAttribute(
        'aria-label',
        direction < 0 ? 'Scroll forecast up' : 'Scroll forecast down',
      );
      heading.append(control);
    }
    const forecastNote = el(
      'p',
      'mb-detail',
      'Hit rating uses the average of two rolls per strike, for both sides: 75 Hit succeeds about 87.5% of the time. Crit uses one roll. Critical hits and special effects can change damage. A defeated unit cannot finish its remaining strikes.',
    );
    forecastNote.style.gridColumn = '1 / -1';
    const explanation = el('details', 'mb-detail');
    explanation.append(el('summary', '', 'How to read this forecast'), forecastNote);
    explanation.style.gridColumn = '1 / -1';
    sides.append(explanation);
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
    for (const type of DOM_INPUT_EVENTS)
      modal.addEventListener(type, (event) => event.stopPropagation());
    const moveFocus = (delta) => {
      const buttons = [...panel.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement);
      buttons[(index + delta + buttons.length) % buttons.length]?.focus({ preventScroll: true });
    };
    modal.addEventListener('keyup', (event) => event.stopPropagation());
    modal.addEventListener('keydown', (event) => {
      if (ignoreRepeatedActivation(event)) return;
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        if (this.available()) this.scene.requestCancel({ allowPause: false });
      } else if (event.key === 'Tab' || event.key.startsWith('Arrow')) {
        event.preventDefault();
        moveFocus(event.shiftKey || ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1);
      } else if (event.key === 'PageDown' || event.key === 'PageUp') {
        event.preventDefault();
        scroll(event.key === 'PageDown' ? 1 : -1);
      }
    });
    modal.append(panel);
    this.wrapper.append(modal);
    this.modal = modal;
    if (this.available() && this.scene.battleState === 'SHOWING_FORECAST') {
      const hp = config.weaponArt
        ? this.scene._getWeaponArtHpAfterCost(config.attacker, config.weaponArt)
        : config.forecast.attacker.hp;
      for (const hint of forecastTeachingHints(config.forecast, hp)) {
        if (!claimContextualHint(this.scene, hint.id)) continue;
        const note = el('p', 'mb-detail', hint.text);
        note.style.gridColumn = '1 / -1';
        note.setAttribute('role', 'status');
        sides.append(note);
        this._stopForecastHint = observeContextualHint(
          this.scene,
          hint.id,
          hint.text,
          () =>
            isHintTextVisible(note) &&
            !modal.hidden &&
            !modal.inert &&
            this.scene.battleState === 'SHOWING_FORECAST',
        );
        break;
      }
    }

    // The shared bus dispatches to its top scope only. BattleScene retains its
    // base scope, so one pad press cannot also move/confirm the map cursor.
    let previousControl = null;
    pushInputScope(
      this,
      (action, payload) => {
        if (
          this.forecast !== config ||
          this.scene.battleState !== 'SHOWING_FORECAST' ||
          !this.available()
        )
          return;
        if (action === InputAction.NAVIGATE) moveFocus(payload?.dy || payload?.dx || 1);
        else if (action === InputAction.CONFIRM && panel.contains(document.activeElement))
          document.activeElement.click();
        else if ([InputAction.CANCEL, InputAction.PAUSE].includes(action))
          this.scene.requestCancel({ allowPause: false });
        else if (action === InputAction.PREV_UNIT) this.scene._cycleForecastWeapon(-1);
        else if (action === InputAction.NEXT_UNIT) this.scene._cycleForecastWeapon(1);
      },
      (isTop) => {
        if (!isTop && panel.contains(document.activeElement))
          previousControl = document.activeElement;
        this.sync();
        if (isTop && !modal.hidden)
          (previousControl?.isConnected ? previousControl : footer.querySelector('button'))?.focus({
            preventScroll: true,
          });
      },
    );
    this.lastSnapshot = '';
    this.sync();
    if (!modal.hidden) footer.querySelector('button')?.focus({ preventScroll: true });
  }

  forecastSide(unit, opponent, info, attacking, config) {
    const side = el('article', `mb-forecast-side ${attacking ? 'mb-ally' : 'mb-enemy'}`);
    side.append(el('div', 'mb-eyebrow', attacking ? 'Your attack' : 'Enemy response'));
    const portraitKey = this.scene._getPortraitKey(unit);
    const pc98Id = usePc98() ? portraitIdForUnit(unit, this.scene.gameData || {}) : null;
    if (pc98Id) {
      side.append(
        pc98PortraitElement({
          id: pc98Id,
          size: 48,
          faction: portraitFaction(unit, pc98Id),
          className: 'mb-portrait',
        }),
      );
    } else if (portraitKey && this.scene.textures.exists(portraitKey)) {
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
    const projection = forecastProjection(config.forecast);
    side.append(
      createHealthBar(
        unit,
        projection ? (attacking ? projection.attackerHP : projection.defenderHP) : null,
      ),
    );
    const afterCost = config.weaponArt
      ? this.scene._getWeaponArtHpAfterCost(config.attacker, config.weaponArt)
      : config.forecast.attacker.hp;
    if (attacking || info.canCounter) {
      const stats = el('dl', 'mb-stats');
      for (const [name, value] of [
        ['Damage per hit', `${info.damage}`],
        ['Planned hits', `${info.attackCount || 1}x`],
        ['Hit rating', `${info.hit}`],
        ['Critical', `${info.crit}%`],
        ['Attack speed', info.as],
      ]) {
        const pair = el('div');
        pair.append(el('dt', '', name), el('dd', '', value));
        stats.append(pair);
      }
      side.append(stats);
    }
    for (const note of forecastNotes(config.forecast, attacking, afterCost))
      side.append(el('p', 'mb-notice', note));
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
    if (attacking && config.weaponArt) {
      side.append(el('p', 'mb-detail', formatWeaponArtEffects(config.weaponArt)));
      side.append(
        el(
          'p',
          'mb-detail',
          weaponArtUsesText(unit, config.weaponArt, this.scene.turnManager?.turnNumber),
        ),
      );
    }
    if (attacking && config.gamblerLine) side.append(el('p', 'mb-notice', config.gamblerLine));
    for (const warning of info.warnings || []) side.append(el('p', 'mb-notice', warning));
    return side;
  }

  hideForecast() {
    const ownedFocus = this.modal?.contains(document.activeElement);
    popInputScope(this);
    this._stopForecastHint?.();
    this._stopForecastHint = null;
    this.modal?.remove();
    this.modal = null;
    this.forecast = null;
    this.lastSnapshot = '';
    // Keep the release/held key inside the DOM boundary after Cancel removes
    // its button. A rebuilding forecast immediately focuses its new Cancel.
    if (ownedFocus && hasInputFocus(this.scene) && this.root.isConnected) {
      this.root.inert = false;
      this.root.focus({ preventScroll: true });
    }
  }

  sync() {
    if (this.help && !this.help.destroyed) return;
    const s = this.scene;
    const state = s.battleState || '';
    const tutorialHint = s.battleParams?.tutorialMode && state === 'TUTORIAL_HINT';
    const supported = PLAY_STATES.has(state) || state.startsWith('SELECTING_');
    const turnStarting = state === 'TURN_START_RESOLVING';
    // A blocking ceremony covers the map only: the rail stays in view, inert.
    const ceremony = Boolean(s._ceremonies?.isBlocking?.());
    const show =
      tutorialHint || (supported && (ceremony || this.available({ allowTurnStart: true })));
    this.root.inert = !show || tutorialHint || turnStarting || ceremony || Boolean(this.modal);
    this.root.setAttribute('aria-hidden', String(!show));
    // The lab reserves its viewport for the entire battle, including modal/animation states.
    if (this.lab) {
      this.root.classList.toggle('bl-inactive', !show);
    }
    if (show !== this.visible) {
      this.visible = show;
      this.root.hidden = this.lab ? false : !show;
      this.wrapper.classList.toggle('mobile-battle-layout', this.lab ? true : show);
      s.scale?.getParentBounds();
      s.scale?.refresh();
    }
    if (this.modal) {
      this.modal.hidden = !show || (state !== 'SHOWING_FORECAST' && !tutorialHint);
      this.modal.inert = Boolean(tutorialHint);
      syncTutorialForecastLayout(this.modal, s, tutorialHint);
    }
    this.speedHold.hidden = !show || Boolean(this.modal) || !canHoldBattleSpeed(s);
    if (this.speedHold.hidden) {
      s._holdBattleFast = false;
      this.speedHold.setAttribute('aria-pressed', 'false');
    }
    if (tutorialHint) return;
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
    if (s.dangerZone?.visible && s.dangerZoneStale) s.refreshVisibleDangerZone?.();
    const candidate =
      (s.inspectionPanel?.visible ? s.inspectionPanel._unit : null) || s.selectedUnit;
    const unit = canInspectUnit(s.grid, candidate) ? candidate : null;
    const turn = s.turnManager?.turnNumber || 1;
    const remaining = (s.playerUnits || []).filter((u) => u.currentHP > 0 && !u.hasActed).length;
    const threat = s._threatSight?.current || null;
    const key = JSON.stringify([
      threat ? [threat.col, threat.row, threat.result?.count, threat.result?.status?.length] : null,
      state,
      turn,
      remaining,
      unit?.name,
      unit?.currentHP,
      unit?.col,
      unit?.row,
      unit?.weapon?.name,
      unit?._conditions,
      statusStaffInfo(unit)?.text,
      s.getBossPressureWarning?.(),
      s.inspectMode,
      Boolean(s.inspectionPanel?.visible),
      s.dangerZone?.visible,
      Boolean(s.keepDangerVisible),
      Boolean(s.isThreatPinned?.(unit)),
      s.pinnedThreatEnemies?.size,
      Boolean(this.menu),
      s._combatSpeedSnapshot !== undefined,
      Boolean(s._inputController?.isSelectionMenu()),
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
    this.phase.append(
      el(
        'div',
        'mb-counters',
        sidebarCounters(s.turnCounterText?.text, s.getVisionChargesRemaining?.()),
      ),
    );
    this.objective.replaceChildren();
    const objectiveText = s.objectiveText?.text || s.battleConfig?.objective || 'Battle';
    const objective = this.button(
      compactBattleObjective(objectiveText),
      () => {
        this.help = new ContextHelp(
          s,
          this.root,
          'Battle objective',
          objectiveText.split('\n'),
          () => {
            this.help = null;
            this.lastSnapshot = '';
            this.sync();
            this.objective.querySelector('button')?.focus({ preventScroll: true });
          },
        );
      },
      'mb-objective',
    );
    objective.setAttribute(
      'aria-label',
      `Objective details: ${compactBattleObjective(objectiveText)}`,
    );
    objective.append(el('span', 'mb-info-cue', 'ⓘ'));
    this.objective.append(objective);
    this.terrain.replaceChildren();
    this.summary.replaceChildren();
    if (s._inputController?._planningInspection && s.selectedUnit) {
      this.summary.append(el('p', 'mb-detail', `Inspecting · Selected: ${s.selectedUnit.name}`));
    }
    const focus = state === 'UNIT_ACTION_MENU' && unit ? unit : s._mobileTerrainFocus || unit;
    if (unit) {
      this.summary.append(el('h2', '', unit.name));
      this.summary.append(
        el('div', 'mb-detail', `${unit.className} · ${unit.weapon?.name || 'Unarmed'}`),
      );
      this.summary.append(el('span', 'mb-hp', `${unit.currentHP}/${unit.stats.HP} HP`));
      const conditions = statusDescriptions(unit);
      if (conditions.length) this.summary.append(el('p', 'mb-status', conditions.join(' · ')));
    } else {
      if (!this.lab)
        this.summary.append(el('h2', '', s.inspectMode ? 'Inspect a unit' : 'Your battlefield'));
      if (!this.lab || !focus)
        this.summary.append(el('div', 'mb-detail', `${remaining} units ready`));
    }
    if (focus) {
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
        // Move preview: how many visible foes could strike this tile next phase.
        if (threat && threat.col === focus.col && threat.row === focus.row) {
          const line = el('span', 'mb-threat-line', threatSummaryText(threat.result));
          line.dataset.threatCount = String(threat.result.count);
          if (threat.result.count > 0) line.classList.add('mb-threat-line--reached');
          card.append(line);
        }
        if (terrain.special) {
          const help = this.button(
            'Terrain details ⓘ',
            () => {
              this.help = new ContextHelp(s, this.root, terrain.name, [terrain.special], () => {
                this.help = null;
                this.lastSnapshot = '';
                this.sync();
              });
            },
            'mb-terrain-help',
          );
          card.append(help);
        }
        this.terrain.append(card);
      }
    }
    const expanded = this.body.querySelector('.mb-battle-info')?.open || false;
    const restoreMenuFocus = this.body.contains(document.activeElement);
    this.body.replaceChildren();

    const warning = s.getBossPressureWarning?.();
    if (warning) this.body.append(el('p', 'mb-hint', warning));

    if (turnStarting) {
      this.body.append(el('p', 'mb-hint', HINTS.TURN_START_RESOLVING));
      return;
    }
    const details = el('details', 'mb-battle-info');
    details.open = expanded;
    details.append(el('summary', '', 'Battle details'));
    const place = battlePlace(s.gameData, s.battleConfig, s.battleParams?.act);
    const info = [
      place.title,
      place.lore,
      s.turnCounterText?.text,
      s.visionHudText?.text?.replace(/^Eye:/, 'Rewinds:'),
      s.infoText?.text,
    ]
      .filter(Boolean)
      .join('\n');
    const detailContent = el('div', 'mb-more-content');
    if (s.dangerZone?.visible)
      detailContent.append(el('p', '', 'Darker: more enemies · Purple outline: status staff'));
    if (s.pinnedThreatEnemies?.size >= 5)
      detailContent.append(
        el('p', '', '5 ranges pinned. Pinning another enemy replaces the oldest.'),
      );
    const staffInfo = statusStaffInfo(unit);
    if (staffInfo) detailContent.append(el('p', '', staffInfo.text));
    detailContent.append(el('pre', '', info || 'Tap a tile to inspect terrain.'));
    if (['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU'].includes(state)) {
      detailContent.append(
        this.button(
          s.keepDangerVisible ? 'Unpin global Danger' : 'Keep global Danger visible',
          () => s.togglePersistentDanger(),
        ),
      );
      detailContent.append(
        el(
          'p',
          '',
          'You can also hold Danger to pin it. Tap Danger to hide it. Resets each battle.',
        ),
      );
    }
    details.append(detailContent);

    if (this.endTurnPending) {
      this.body.append(
        el(
          'p',
          'mb-hint',
          `End your turn? ${remaining} ${remaining === 1 ? 'unit still has' : 'units still have'} actions.`,
        ),
      );
      const token = this.endTurnPending;
      this.body.append(
        this.button('Keep playing', () => {
          this.endTurnPending = null;
        }),
      );
      for (const ready of (s.playerUnits || []).filter(
        (u) => u.currentHP > 0 && !u.hasActed && !u._removing,
      )) {
        this.body.append(
          this.button(`Show ${ready.name}`, () => {
            if (
              this.endTurnPending !== token ||
              s.battleState !== token.state ||
              s.turnManager?.turnNumber !== token.turn ||
              ready.hasActed ||
              ready.currentHP <= 0 ||
              ready._removing
            )
              return;
            this.endTurnPending = null;
            const point = s.grid.gridToPixel(ready.col, ready.row);
            s._battleCamera?.clearTouches();
            s.cameras.main.centerOn(point.x, point.y);
            s._battleCamera?.clampToBounds();
            s._mobileTerrainFocus = { col: ready.col, row: ready.row };
            s._syncMobileResetViewButton?.();
          }),
        );
      }
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
      if (restoreMenuFocus) this.body.querySelector('button')?.focus({ preventScroll: true });
      return;
    }
    if (!this.lab || !['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU'].includes(state))
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
      if (s._inputController?._planningInspection && unit) {
        const inspection = el('div', 'mb-command-grid');
        inspection.append(this.button('View unit details', () => s.openUnitDetailOverlay()));
        this.appendThreatPinControl(unit, inspection);
        this.body.append(inspection);
      }
      if (s._inputController?.isSelectionMenu()) {
        this.body.append(el('p', 'mb-detail', 'Tap a blue tile to move.'));
      }
      const list = el('div', s.inEquipMenu ? 'mb-actions mb-submenu' : 'mb-actions');
      for (const item of menu.items) {
        const button = this.button(
          item.label,
          () => {
            if (
              this.menu !== menu ||
              s.actionMenu !== menu.objects ||
              s.selectedUnit !== menu.unit ||
              s.battleState !== 'UNIT_ACTION_MENU' ||
              item.disabled
            )
              return;
            item.onActivate();
          },
          item.label === 'Attack' && !item.disabled ? 'mb-primary' : '',
        );
        const description = item.description || battleItemSummary(item.item, menu.unit);
        if (description) button.append(el('small', 'mb-item-summary', description));
        button.disabled = item.disabled;
        item.domButton = button;
        button.addEventListener('focus', () => {
          const index = s._menuFocus?.items.indexOf(item);
          if (index >= 0) s._menuFocus.index = index;
          for (const entry of menu.items) {
            entry.domButton?.classList.toggle('mb-menu-focused', entry === item);
          }
        });
        list.append(button);
      }
      this.body.append(list);
      if (s._escapeController)
        this.body.append(
          this.button('Show exits', () => s._escapeController.showExits(), 'mb-secondary'),
        );
      const danger = this.button(
        s.keepDangerVisible ? 'Danger · pinned' : 'Danger',
        () => s._onDangerClick(),
        'mb-secondary',
        () => s.togglePersistentDanger(),
      );
      danger.setAttribute('aria-label', s.keepDangerVisible ? 'Danger · pinned' : 'Danger');
      danger.append(
        el('small', 'mb-hold-cue', s.keepDangerVisible ? 'Hold to unpin' : 'Hold to pin'),
      );
      this.body.append(danger, details);
      if (restoreMenuFocus) this.focusMenuItem(s._menuFocus?.items[s._menuFocus.index]?.button);
      return;
    }
    if (['PLAYER_IDLE', 'UNIT_SELECTED'].includes(state)) {
      const commands = el('div', 'mb-command-grid');
      const secondary = el('div', 'mb-command-grid mb-secondary-grid');
      const inspecting = s.inspectionPanel?.visible && s.inspectionPanel._unit === unit && unit;
      if (inspecting) {
        const view = this.button('View unit', () => s.openUnitDetailOverlay());
        view.setAttribute('aria-label', 'View unit details');
        commands.append(view);
        this.appendThreatPinControl(unit, commands);
      }
      for (const [label, action, active] of [
        [s.keepDangerVisible ? 'Danger · pinned' : 'Danger', 'danger', s.dangerZone?.visible],
        ['Inspect', 'inspect', s.inspectMode],
        ['Roster', 'roster', null],
        ['Rewind', 'objective', null],
      ]) {
        if (inspecting && action === 'inspect') continue;
        const button = this.button(
          label,
          () => {
            if (action === 'inspect' && s.selectedUnit) {
              const unit = s.selectedUnit;
              const living = s.playerUnits.filter((u) => u.currentHP > 0);
              s.unitDetailOverlay.show(unit, s.grid.getTerrainAt(unit.col, unit.row), s.gameData, {
                rosterUnits: living,
                rosterIndex: Math.max(0, living.indexOf(unit)),
              });
              s.refreshEndTurnControl();
            } else s.game.events.emit(`mobile:${action}`);
          },
          '',
          action === 'danger' ? () => s.togglePersistentDanger() : null,
        );
        if (action === 'danger') {
          button.setAttribute('aria-label', label);
          button.append(
            el('small', 'mb-hold-cue', s.keepDangerVisible ? 'Hold to unpin' : 'Hold to pin'),
          );
        }
        if (active != null) button.setAttribute('aria-pressed', String(Boolean(active)));
        (inspecting && ['roster', 'objective'].includes(action) ? secondary : commands).append(
          button,
        );
      }
      const endTurn = this.button('End turn…', () => this.requestEndTurn(), 'mb-end-turn');
      if (inspecting) commands.append(endTurn);
      this.body.append(commands);
      if (inspecting) this.body.append(secondary);
      else this.body.append(endTurn);
      if (s._escapeController)
        this.body.append(
          this.button('Show exits', () => s._escapeController.showExits(), 'mb-secondary'),
        );
    }
    if (!this.menu && !this.endTurnPending) this.body.append(details);
  }

  appendThreatPinControl(unit, container = this.summary) {
    const s = this.scene;
    if (
      unit?.faction !== 'enemy' ||
      !(unit.currentHP > 0) ||
      !s.inspectionPanel?.visible ||
      s.inspectionPanel._unit !== unit ||
      !canInspectUnit(s.grid, unit) ||
      typeof s.togglePinnedThreat !== 'function'
    )
      return;
    const pinned = Boolean(s.isThreatPinned?.(unit));
    const control = this.button(pinned ? 'Unpin range' : 'Pin range', () => {
      if (
        s.inspectionPanel?.visible &&
        s.inspectionPanel._unit === unit &&
        canInspectUnit(s.grid, unit)
      )
        s.togglePinnedThreat(unit);
    });
    control.setAttribute('aria-pressed', String(pinned));
    control.setAttribute(
      'aria-description',
      !pinned && s.pinnedThreatEnemies?.size >= 5
        ? '5 ranges pinned. Pinning this enemy replaces the oldest.'
        : 'Keep this enemy’s threat visible during planning. Pins reset on reload.',
    );
    container.append(control);
  }

  restoreLabels() {
    for (const [label, visible] of this.hiddenLabels || []) label.setVisible?.(visible);
    this.hiddenLabels?.clear();
  }

  destroy() {
    this.help?.destroy();
    this.disposeSpeedHold?.();
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
