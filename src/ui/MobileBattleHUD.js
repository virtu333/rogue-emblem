import { sceneHealPreview } from './healTargetPreview.js';
import { visionLabel } from './visionLabel.js';
import { ContextHelp } from './ContextHelp.js';
import { contractHelpBlocks } from './contractHudModel.js';
import { renderFormationPanel, startButton } from './FormationPanel.js';
import { objectiveHelp, terrainHelp } from './helpTopics.js';
import { locateUnit, nextReadyUnit, readyUnits } from './UnitLocator.js';
import {
  compactBattleObjective,
  secondaryObjectiveStatus,
  sideObjectiveInputs,
  sidebarCounters,
} from './battleSidebarDisplay.js';
import { battlePlace } from './placeDisplay.js';
import { bindHoldBattleSpeed, canHoldBattleSpeed } from './HoldBattleSpeed.js';
import { syncPrologueForecastLayout } from './prologueForecastLayout.js';
import { isScriptedBattle } from '../engine/ScriptedBattle.js';
import { hasEffectiveSkill } from '../engine/EffectiveSkills.js';
import {
  showContextualHint,
  claimContextualHint,
  observeContextualHint,
  isHintTextVisible,
} from './HintDisplay.js';
import {
  forecastProjection,
  projectedFallText,
  forecastModifierText,
  forecastNotes,
  forecastReadingPoints,
  forecastTeachingHints,
  formatCritChance,
  formatHitChance,
  formatDamageStrikes,
} from './forecastDisplay.js';
import {
  canInspectUnit,
  statusDescriptions,
  statusStaffInfo,
  carriedItemInfo,
  terrainRuleLines,
} from '../engine/BattleInformation.js';
import { bindCancelablePress } from '../utils/cancelablePress.js';
import { isUnitMenuState, canUseDanger } from './battleMenuModel.js';
import { formatWeaponArtEffects, weaponArtUsesText } from './weaponArtDisplay.js';
import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { battleItemBrief, battleItemSummary, ITEM_ACTION_NOTE } from './battleItemSummary.js';
import { BattlefieldLab, battlefieldLabEnabled } from './BattlefieldLab.js';
import { createHealthBar } from './healthBar.js';
import { textureImageSource } from './textureImageSource.js';
import { hasInputFocus, pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import { getEffectivenessMultiplier } from '../engine/Combat.js';
import { threatSummaryText, threatSummaryTone } from '../engine/ThreatForecast.js';
import { relocatePrompt } from '../engine/StaffRelocation.js';
import { pc98PortraitElement, portraitFaction, portraitIdForUnit, usePc98 } from './portraitArt.js';
import { equippedBadgeElement, EQUIPPED_MARKER } from './equippedBadge.js';
import { itemIcon } from './itemIcons.js';

// A horizontal swipe this long (and clearly more horizontal than vertical)
// across the forecast switches weapons; shorter drags stay taps/scrolls.
const FORECAST_SWIPE_MIN_PX = 44;

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
  'CANTO_CONFIRM',
]);
const HINTS = {
  PLAYER_IDLE: 'Tap a unit to begin. Pinch to zoom the map.',
  SELECTING_HEAL_TARGET: 'Choose an ally here or on the map. Back returns without using the staff.',
  SELECTING_REMAINS_TARGET: 'Tap the highlighted remains to smash them. Back to go back.',
  SELECTING_AREA_CENTER: 'Tap a lit tile to aim; tap it again or Fire to cast. Back to go back.',
  UNIT_MOVING: 'Moving…',
  UNIT_SELECTED: 'Tap a highlighted tile to move.',
  UNIT_ACTION_MENU: 'Choose an action for this unit.',
  CANTO_MOVING: 'Tap a tile to reposition, or choose Menu to finish.',
  CANTO_CONFIRM: 'Wait to end the turn here, or Back to choose another tile.',
  ENEMY_PHASE: 'Enemy turn',
  COMBAT_RESOLVING: 'Resolving combat…',
  TURN_START_RESOLVING: 'Applying turn-start effects…',
  SHOWING_FORECAST: 'Review the forecast before committing.',
};

// Warp/Rescue: step 1 names the ally to pick, step 2 where the chosen ally lands.
function staffRelocateHint(s, state) {
  if (state !== 'SELECTING_STAFF_ALLY' && state !== 'SELECTING_STAFF_TILE') return null;
  const caster = s.selectedUnit;
  const ally = state === 'SELECTING_STAFF_TILE' ? s.staffRelocateAlly : null;
  return relocatePrompt(caster?.weapon, caster, ally);
}

// Blink Strike: step 1 names the tile to warp to, step 2 the foe to strike from it.
function warpStrikeHint(s, state) {
  if (state !== 'SELECTING_ABILITY_TILE') return null;
  const step = s._pendingAbility?.step;
  if (step === 'destination')
    return 'Tap a lit tile to warp to: you strike a foe from there. Back to go back.';
  if (step === 'target') return 'Tap a foe to strike from the outlined tile. Back to choose another tile.'; // prettier-ignore
  return null;
}

// Item rows teach their long press once: the hint line shows until the player
// has opened a row's details (per device; storage blocked = never nag).
const ITEM_HOLD_KEY = 'emblem_rogue_tip_hold_item';
function itemHoldLearned() {
  try {
    return localStorage.getItem(ITEM_HOLD_KEY) === '1';
  } catch {
    return true;
  }
}
function markItemHoldLearned() {
  try {
    localStorage.setItem(ITEM_HOLD_KEY, '1');
  } catch {
    /* optional */
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/**
 * The terrain card's move preview: how many visible foes could strike this tile next
 * phase. Crimson when one can; violet (the status eyes' colour) when only status
 * staves can, so that tile never looks safe; plain otherwise. Each " · " clause is
 * its own unbreakable span with a plain space between, so a narrow card wraps
 * between clauses ("… can reach" / "· fog may hide more"), never inside one; the
 * line's text stays exactly threatSummaryText.
 */
export function threatPreviewLine(result) {
  const tone = threatSummaryTone(result);
  const line = el(
    'span',
    tone === 'clear' ? 'mb-threat-line' : `mb-threat-line mb-threat-line--${tone}`,
  );
  threatSummaryText(result)
    .split(' · ')
    .forEach((clause, i) => {
      if (i) line.append(' ');
      line.append(el('span', 'mb-threat-clause', i ? `· ${clause}` : clause));
    });
  line.dataset.threatCount = String(result?.count ?? 0);
  return line;
}

/** The forecast attacker's planned weapon (confirm equips it); else the equipped one. */
function forecastWeapon(config) {
  return config?.weapon !== undefined ? config.weapon : config?.attacker?.weapon || null;
}

/**
 * The action-menu command pinned in the fixed dock beside Danger, so it never needs a
 * scroll: Wait, the most common command (playtest 4: a six-command menu pushed it below
 * the fold at 844×390). Only the unit's own action menu pins it; submenus, the
 * end-turn prompt and every other state keep the dock as it was. The command keeps its
 * place in the menu's focus order (last, as on the desktop canvas menu), which is also
 * where the dock sits: below the scrolling list.
 */
export function pinnedRailCommand(menu, { state, submenu = false, endTurnPending = false } = {}) {
  if (!isUnitMenuState(state) || submenu || endTurnPending || !menu?.items) return null;
  return menu.items.find((item) => item?.id === 'wait') || null;
}

/**
 * The upright rail (portrait mode, portraitBattle.css) is a short strip under the
 * board: terrain details or a Cancel row pushed End turn below the fold at 375×667
 * (playtest 2026-09-26). There End turn joins the fixed dock beside a compact Danger
 * whenever it is offered, as Wait does in a unit's menu. The sideways rail is tall
 * and keeps End turn in the command stack.
 */
export function dockedEndTurn({ state, uprightRail = false, endTurnPending = false } = {}) {
  return (
    Boolean(uprightRail) && !endTurnPending && ['PLAYER_IDLE', 'UNIT_SELECTED'].includes(state)
  );
}

/** The rail is laid out upright (the portrait-battle-capable rules in portraitBattle.css). */
export function uprightBattleRail(env = globalThis) {
  const root = env?.document?.documentElement;
  if (!root?.classList.contains('portrait-battle-capable') || !root.classList.contains('touch-ui'))
    return false;
  try {
    return env.matchMedia?.('(orientation: portrait)')?.matches === true;
  } catch {
    return false;
  }
}

// A unit is being moved or acted with: the upright rail gives its header to that unit
// (portraitBattle.css hides the turn and objective row) so its commands, lists and
// the tile it chose fit the short strip without a scroll.
const UNIT_FOCUS_STATES = new Set([
  'UNIT_SELECTED',
  'UNIT_MOVING',
  'UNIT_ACTION_MENU',
  'CANTO_MOVING',
  'CANTO_CONFIRM',
  'SHOWING_FORECAST',
  'CONFIRMING_ATTACK',
]);

/** The rail is about one unit's action (its header yields to it on the upright rail). */
export function unitFocusedRail({ state = '', selected = false, menu = false } = {}) {
  if (!selected) return false;
  if (isUnitMenuState(state)) return Boolean(menu);
  return UNIT_FOCUS_STATES.has(state) || state.startsWith('SELECTING_');
}

/**
 * Column spans (of six) for a unit's usable commands on the upright rail, so every row
 * is filled: three across, a last pair split in halves, and never one command alone
 * beside empty cells (four read as two pairs, seven as three, two and two). Pure.
 */
export function commandSpans(count) {
  const n = Math.max(0, Math.floor(count) || 0);
  if (n === 1) return [6];
  const spans = Array(n).fill(2);
  const wide = n % 3 === 2 ? 2 : n % 3 === 1 ? 4 : 0;
  for (let i = n - wide; i < n; i++) spans[i] = 3;
  return spans;
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
    // The open contract (ContractHudController) has its own row under the turn counters: the
    // upright rail gives it the rail's whole width, so the longest wording keeps one line.
    this.contractSlot = el('div', 'mb-contract-slot');
    this.summary = el('div', 'mb-summary');
    this.objective = el('div', 'mb-objective-slot');
    this.terrain = el('div', 'mb-terrain-slot');
    this.body = el('div', 'mb-body');
    this.speedHold = el('button', 'mb-button', 'Hold to speed up');
    this.speedHold.type = 'button';
    this.speedHold.hidden = true;
    this.speedHold.setAttribute('aria-pressed', 'false');
    this.disposeSpeedHold = bindHoldBattleSpeed(this.speedHold, scene);
    // Fixed dock under the scrolling command stack: Danger never needs a scroll.
    this.dock = el('div', 'mb-dock');
    this.moreCue = el('div', 'mb-scroll-cue');
    this.moreCue.setAttribute('aria-hidden', 'true');
    this.moreCue.hidden = true;
    // Edge fades are overlays, not a mask: a mask would also hide the Battle
    // details popover, which escapes the scroll box.
    this.fadeTop = el('div', 'mb-scroll-fade is-top');
    this.fadeBottom = el('div', 'mb-scroll-fade is-bottom');
    for (const fade of [this.fadeTop, this.fadeBottom]) {
      fade.setAttribute('aria-hidden', 'true');
      fade.hidden = true;
    }
    this.root.append(
      this.phase,
      this.contractSlot,
      this.objective,
      this.terrain,
      this.summary,
      this.speedHold,
      this.body,
      this.fadeTop,
      this.fadeBottom,
      this.moreCue,
      this.dock,
    );
    this.body.addEventListener('scroll', () => this.syncScrollCues(), { passive: true });
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
      if (!this.menu || !isUnitMenuState(this.scene.battleState)) return;
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
    // An EXP gauge holds the pad over the scene but blocks nothing: the rail stays live
    // (and lit) under it, and a press on it skips the gauge first (XpGaugeController).
    const sceneInput = hasInputFocus(s) || s._xpGauge?.holdsFocusOf?.(s) === true;
    return (
      (sceneInput || (this.modal && hasInputFocus(this))) &&
      (!s.isStoryInputLocked() || (allowTurnStart && s.battleState === 'TURN_START_RESOLVING')) &&
      !s.pauseOverlay?.visible &&
      !s.unitDetailOverlay?.visible &&
      !s.visionDialog &&
      !s.rosterOverlay?.visible &&
      !s.lootSettingsOverlay
    );
  }

  /**
   * The open contract's line in the counters row ("Contract · Under par", "— missed"): a compact
   * button whose tap opens the terms (the objective's pattern). Hover and long-press read its title.
   */
  contractLine(model) {
    const s = this.scene;
    const line = this.button(
      model.text,
      () => {
        this.help = new ContextHelp(s, this.root, 'Contract', contractHelpBlocks(model), () => {
          this.help = null;
          this.lastSnapshot = '';
          this.sync();
          this.contractSlot.querySelector('.mb-contract')?.focus({ preventScroll: true });
        });
      },
      `mb-contract is-${model.status}`,
    );
    line.title = model.title;
    line.dataset.contract = model.goal;
    line.setAttribute('aria-label', model.title);
    return line;
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
              // The hold usually rebuilds the rail: the lifting finger's click
              // would land on the new copy of this control (which never saw
              // the press) and fire its tap action too. Swallow that one click.
              this.swallowNextClick();
            }
          : null,
      },
    );
    return button;
  }

  /** Ignore the click that follows a completed hold, wherever in the rail it lands. */
  swallowNextClick(ms = 600) {
    const root = this.root;
    if (!root?.addEventListener) return;
    const swallow = (event) => {
      event.preventDefault();
      event.stopPropagation();
      done();
    };
    const timer = setTimeout(() => done(), ms);
    const done = () => {
      clearTimeout(timer);
      root.removeEventListener('click', swallow, true);
    };
    root.addEventListener('click', swallow, true);
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
    this.expandedItem = null; // a new menu opens with every row brief
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

  /** Focus a menu row's rail button: `source` is the row's item, or (older menus) its canvas row. */
  focusMenuItem(source) {
    if (!source) return;
    const item = this.menu?.items.find((entry) => entry === source || entry.button === source);
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
    const forecastNote = el('ul', 'mb-detail mb-reading');
    for (const point of forecastReadingPoints(config.forecast))
      forecastNote.append(el('li', '', point));
    forecastNote.style.gridColumn = '1 / -1';
    const explanation = el('details', 'mb-detail');
    explanation.append(el('summary', '', 'How to read this forecast'), forecastNote);
    explanation.style.gridColumn = '1 / -1';
    sides.append(explanation);
    if (forecastProjection(config.forecast))
      panel.append(
        el(
          'p',
          'mb-projection-assumption mb-detail',
          'HP estimate: if all hits land; no crits/procs.',
        ),
      );
    panel.append(sides);
    const footer = el('div', 'mb-forecast-footer');
    const cancel = this.button('Cancel', () => this.scene.requestCancel({ allowPause: false }));
    cancel.dataset.forecastRole = 'cancel';
    const confirm = this.button(
      'Confirm attack',
      () => {
        if (this.forecast !== config || this.scene.battleState !== 'SHOWING_FORECAST') return;
        this.scene.confirmForecastCombat();
      },
      'mb-primary',
    );
    confirm.dataset.forecastRole = 'confirm';
    footer.append(cancel, confirm);
    panel.append(footer);
    this.bindForecastSwipe(sides, config);
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
      } else if (
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
        config.validWeapons.length > 1 &&
        !event.shiftKey
      ) {
        event.preventDefault();
        if (this.available()) this.scene._cycleForecastWeapon(event.key === 'ArrowLeft' ? -1 : 1);
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
    // The attacker fights with the planned weapon, which is not equipped until confirm.
    const weapon = attacking ? forecastWeapon(config) : unit.weapon;
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
    // The name and HP line share a wrapper: `display: contents` on the landscape sheet
    // (unchanged layout); the upright sheet sets them on one row (portraitBattle.css).
    const who = el('div', 'mb-forecast-who');
    who.append(el('h3', '', unit.name));
    side.append(who);
    const projection = forecastProjection(config.forecast);
    const hpAfter = projection ? (attacking ? projection.attackerHP : projection.defenderHP) : null;
    const hp = el('div', 'mb-hp', `HP ${unit.currentHP} / ${unit.stats.HP}`);
    // Lead with the outcome: the projected HP (or KO) right beside current HP.
    if (Number.isFinite(hpAfter) && hpAfter !== unit.currentHP)
      hp.append(
        el(
          'span',
          `mb-hp-after${hpAfter === 0 ? ' mb-hp-ko' : ''}`,
          hpAfter === 0
            ? ` → ${projectedFallText(projection, attacking ? 'attacker' : 'defender')}`
            : ` → ${hpAfter}`,
        ),
      );
    who.append(hp);
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
      // Each kind of number has its own shape: damage plain and largest,
      // strikes as a multiplier, chances as percentages.
      for (const [name, value, kind] of [
        ['Damage × hits', formatDamageStrikes(info), 'damage'],
        ['Hit', formatHitChance(info.hit), 'hit'],
        ['Crit', formatCritChance(info.crit), 'crit'],
        ['AS', `${info.as}`, 'speed'],
      ]) {
        const pair = el('div', `mb-stat-${kind}`);
        pair.dataset.stat = kind;
        pair.append(el('dt', '', name), el('dd', '', value));
        stats.append(pair);
      }
      side.append(stats);
    }
    if (!attacking && config.targetCount >= 2 && config.targetIndex >= 0)
      side.append(this.forecastStepper('target', config));
    if (attacking && !config.weaponArt && config.validWeapons.length > 1)
      side.append(this.forecastStepper('weapon', config));
    else {
      const label = el('div', 'mb-weapon', weapon?.name || 'Unarmed');
      if (attacking && weapon && weapon === config.equippedWeapon)
        label.append(equippedBadgeElement());
      side.append(label);
    }
    for (const note of forecastNotes(config.forecast, attacking, afterCost, {
      planned: weapon,
      equipped: config.equippedWeapon,
    }).filter((n) => !n.startsWith('If all hits land:')))
      side.append(el('p', 'mb-notice', note));
    if (
      weapon &&
      (attacking || info.canCounter) &&
      getEffectivenessMultiplier(weapon, opponent) > 1
    )
      side.append(el('p', 'mb-notice', 'Effective damage'));
    for (const skill of info.skills || []) {
      const detail = forecastModifierText(skill, unit, this.scene.gameData);
      if (detail) {
        const disclosure = el('details', 'mb-detail mb-modifier');
        disclosure.append(el('summary', '', skill.name), el('p', '', detail));
        side.append(disclosure);
      } else side.append(el('p', 'mb-detail', skill.name));
    }
    if (hasEffectiveSkill(unit, 'miracle', { weapon }))
      side.append(el('p', 'mb-detail', `Miracle: ${unit._miracleUsed ? 'used' : 'ready'}`));
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
    for (const note of info.affixNotes || []) {
      const disclosure = el('details', 'mb-detail mb-affix');
      disclosure.open = Boolean(note.showDescription);
      disclosure.append(
        el('summary', 'mb-notice', `${note.name} · ${note.text}`),
        el('p', '', note.description),
      );
      side.append(disclosure);
    }
    return side;
  }

  /**
   * ◀ value ▶ stepper for the forecast: 'weapon' (attacker side — the weapons
   * that can hit this target, equipped first, [E] on the equipped one) or
   * 'target' (enemy side — the attackable targets).
   */
  forecastStepper(kind, config) {
    const weaponKind = kind === 'weapon';
    const group = el('div', `mb-stepper mb-${kind}-switch`);
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', weaponKind ? 'Weapon' : 'Target');
    const cycle = (direction) =>
      weaponKind
        ? this.scene._cycleForecastWeapon(direction)
        : this.scene._cycleForecastTarget?.(direction);
    const step = (direction) => {
      const label = `${direction < 0 ? 'Previous' : 'Next'} ${weaponKind ? 'weapon' : 'target'}`;
      const button = this.button(direction < 0 ? '◀' : '▶', () => {
        if (this.forecast !== config || this.scene.battleState !== 'SHOWING_FORECAST') return;
        cycle(direction);
      });
      button.classList.add('mb-step');
      button.setAttribute('aria-label', label);
      button.dataset.forecastRole = `${kind}-${direction < 0 ? 'prev' : 'next'}`;
      return button;
    };
    const current = el('div', 'mb-step-value');
    current.setAttribute('aria-live', 'polite');
    if (weaponKind) {
      const weapon = forecastWeapon(config);
      const list = config.validWeapons;
      current.append(el('span', 'mb-step-name', weapon?.name || 'Unarmed'));
      if (weapon && weapon === config.equippedWeapon) current.append(equippedBadgeElement());
      current.append(
        el('span', 'mb-step-count', `${Math.max(1, list.indexOf(weapon) + 1)}/${list.length}`),
      );
    } else {
      current.append(
        el('span', 'mb-step-name', `Target ${config.targetIndex + 1} of ${config.targetCount}`),
      );
    }
    group.append(step(-1), current, step(1));
    return group;
  }

  bindForecastSwipe(surface, config) {
    if (config.validWeapons.length < 2 || config.weaponArt) return;
    let start = null;
    surface.addEventListener('pointerdown', (event) => {
      start = event.isPrimary ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
    });
    surface.addEventListener('pointercancel', () => {
      start = null;
    });
    surface.addEventListener('pointerup', (event) => {
      const from = start;
      start = null;
      if (!from || from.id !== event.pointerId) return;
      const dx = event.clientX - from.x;
      const dy = event.clientY - from.y;
      if (Math.abs(dx) < FORECAST_SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (this.forecast !== config || this.scene.battleState !== 'SHOWING_FORECAST') return;
      if (!this.available()) return;
      // Swipe left = next weapon, like paging a carousel.
      this.scene._cycleForecastWeapon(dx < 0 ? 1 : -1);
    });
  }

  /** Remember the focused control + scroll so a rebuilt forecast reads the same. */
  captureForecastView() {
    if (!this.modal) return null;
    const active = this.modal.contains(document.activeElement) ? document.activeElement : null;
    return {
      role: active?.dataset?.forecastRole || null,
      scrollTop: this.modal.querySelector('.mb-forecast-sides')?.scrollTop || 0,
    };
  }

  restoreForecastView(view) {
    if (!view || !this.modal) return;
    const sides = this.modal.querySelector('.mb-forecast-sides');
    if (sides) sides.scrollTop = view.scrollTop;
    if (!view.role || this.modal.hidden) return;
    const control =
      this.modal.querySelector(`[data-forecast-role="${view.role}"]`) ||
      this.modal.querySelector('[data-forecast-role="cancel"]');
    control?.focus({ preventScroll: true });
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
    // A prologue note (PrologueController) holds the rail inert under it.
    const tutorialHint = isScriptedBattle(s.battleParams) && state === 'TUTORIAL_HINT';
    // Placement before turn 1 (FormationController) runs its controls in the rail.
    const formation = state === 'DEPLOY_POSITIONING' && Boolean(s._formation?.ready);
    const supported = PLAY_STATES.has(state) || state.startsWith('SELECTING_') || formation;
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
      syncPrologueForecastLayout(this.modal, s, tutorialHint);
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
    const upright = uprightBattleRail();
    // The open contract and where it stands (ContractHudController): derived on every read.
    const contract = s._contractHud?.model?.() || null;
    // Village and caravan: the compact objective keeps only the main line (upright shows these).
    const sideStatus = secondaryObjectiveStatus(sideObjectiveInputs(s, (this._sideMemory ||= {})));
    const key = JSON.stringify([
      upright,
      sideStatus.map((part) => part.text),
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
      carriedItemInfo(unit)?.text,
      [s.getBossPressureWarning?.(), s._bossPresence?.summaryLine?.()].join('|'),
      s.inspectMode,
      Boolean(s.inspectionPanel?.visible),
      // Danger's state line counts allies in reach: re-render when either side moves.
      s.dangerZone?.visible &&
        `${(s.dangerZone.tiles || []).reduce((a, t) => (a * 33 + t.col * 97 + t.row * 13 + t.tier) % 1e9, 7)}:${(s.playerUnits || []).map((u) => `${u.col},${u.row},${u.currentHP > 0}`).join(';')}`,
      Boolean(s.keepDangerVisible),
      Boolean(s.isThreatPinned?.(unit)),
      s.pinnedThreatEnemies?.size,
      Boolean(this.menu),
      s._combatSpeedSnapshot !== undefined,
      Boolean(s._inputController?.isSelectionMenu()),
      Boolean(this.endTurnPending),
      s.infoText?.text,
      s._mobileTerrainFocus,
      s._remainsCtrl?.markers?._key,
      s.objectiveText?.text,
      s.turnCounterText?.text,
      s.visionHudText?.text,
      s._eclipseHud?.label?.(),
      contract?.title,
      state === 'SELECTING_TARGET' ? this.targetListKey() : null,
      state === 'SELECTING_HEAL_TARGET'
        ? (s.healTargets || []).map((t) => [
            t.battleEntityId || t.name,
            t.currentHP,
            t._conditions,
            sceneHealPreview(s, t)?.text,
          ])
        : null,
      formation ? s._formation.version : null,
      formation ? Boolean(s.dangerZone?.visible) : null,
      state === 'SELECTING_STAFF_TILE' ? s.staffRelocateAlly?.name : null,
      state === 'SELECTING_AREA_CENTER' ? s._areaTargetingController?.locked : null,
    ]);
    if (key === this.lastSnapshot) return;
    if (
      this.endTurnPending &&
      (this.endTurnPending.state !== state || this.endTurnPending.turn !== turn)
    )
      this.endTurnPending = null;
    this.lastSnapshot = key;
    this.phase.textContent = formation
      ? 'FORMATION'
      : `TURN ${turn}  /  ${s.turnManager?.currentPhase === 'enemy' ? 'ENEMY' : 'PLAYER'}`;
    const counters = el(
      'div',
      'mb-counters',
      sidebarCounters(s.turnCounterText?.text, s.getVisionChargesRemaining?.()),
    );
    // The Eclipse projection rides its own element (the counters text above is parsed
    // from the turn label and must keep its format).
    const shadow = s._eclipseHud?.label?.();
    if (shadow) counters.append(el('span', `mb-shadow is-${s._eclipseHud.tone()}`, shadow));
    this.contractSlot.replaceChildren(...(contract ? [this.contractLine(contract)] : []));
    this.phase.append(counters);
    this.objective.replaceChildren();
    const objectiveText = s.objectiveText?.text || s.battleConfig?.objective || 'Battle';
    const objective = this.button(
      compactBattleObjective(objectiveText),
      () => {
        this.help = new ContextHelp(
          s,
          this.root,
          'Battle objective',
          objectiveHelp(objectiveText, s._bossPresence?.summaryLine?.(), s.battleConfig?.objective),
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
    if (sideStatus.length) {
      const status = el('p', 'mb-objective-status');
      for (const part of sideStatus) {
        const chip = el('span', `mb-objective-part is-${part.tone}`, part.text);
        chip.dataset.objective = part.id;
        status.append(chip);
      }
      this.objective.append(status);
    }
    this.terrain.replaceChildren();
    this.summary.replaceChildren();
    if (s._inputController?._planningInspection && s.selectedUnit) {
      this.summary.append(el('p', 'mb-detail', `Inspecting · Selected: ${s.selectedUnit.name}`));
    }
    const focus = isUnitMenuState(state) && unit ? unit : s._mobileTerrainFocus || unit;
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
        this.summary.append(
          el('div', 'mb-detail', `${remaining} ${remaining === 1 ? 'unit' : 'units'} ready`),
        );
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
        if (threat && threat.col === focus.col && threat.row === focus.row)
          card.append(threatPreviewLine(threat.result));
        // Zombie remains the player knows of on this tile, and when they rise.
        const remains = s._zombieTombstones?.length
          ? s._zombieRemains?.().infoLine(focus.col, focus.row)
          : null;
        if (remains) card.append(el('span', 'mb-remains', remains));
        if (terrainRuleLines(terrain).length) {
          const help = this.button(
            'Terrain details ⓘ',
            () => {
              this.help = new ContextHelp(
                s,
                this.root,
                terrain.name,
                terrainHelp(terrain, moveType),
                () => {
                  this.help = null;
                  this.lastSnapshot = '';
                  this.sync();
                },
              );
            },
            'mb-terrain-help',
          );
          card.append(help);
        }
        this.terrain.append(card);
      }
    }
    const expanded = this.body.querySelector('.mb-battle-info')?.open || false;
    const restoreMenuFocus =
      this.body.contains(document.activeElement) ||
      Boolean(this.menu?.items?.some((item) => item.domButton === document.activeElement));
    const pinned = pinnedRailCommand(this.menu, {
      state,
      submenu: Boolean(s.inEquipMenu),
      endTurnPending: Boolean(this.endTurnPending),
    });
    const endTurnDocked = dockedEndTurn({
      state,
      uprightRail: upright,
      endTurnPending: Boolean(this.endTurnPending),
    });
    // A new menu or state starts at the top (its primary action first); a
    // re-render of the same menu keeps the player's scroll position.
    const scrollKey = [
      state,
      this.menu?.items?.map((item) => item.label).join(',') || '',
      Boolean(this.endTurnPending),
      Boolean(s.inEquipMenu),
    ].join('|');
    const keepScroll = scrollKey === this._scrollKey ? this.body.scrollTop : 0;
    this._scrollKey = scrollKey;
    this.root.classList.toggle('has-unit', Boolean(unit));
    this.root.classList.toggle('in-formation', formation);
    this.root.classList.toggle('in-menu', isUnitMenuState(state) && Boolean(this.menu));
    // A submenu (Equip, Item, a staff or art pick) lists rows with stat briefs.
    this.root.classList.toggle(
      'in-submenu',
      state === 'UNIT_ACTION_MENU' && Boolean(this.menu) && Boolean(s.inEquipMenu),
    );
    this.root.classList.toggle(
      'is-acting',
      unitFocusedRail({ state, selected: Boolean(s.selectedUnit), menu: Boolean(this.menu) }),
    );
    this.syncDock(state, pinned, endTurnDocked);
    queueMicrotask(() => {
      if (!this.body.isConnected) return;
      this.body.scrollTop = keepScroll;
      // Keyboard/gamepad focus always stays in view.
      if (this.body.contains(document.activeElement))
        document.activeElement.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      this.syncScrollCues();
    });
    this.body.replaceChildren();

    if (formation) {
      this.summary.replaceChildren();
      renderFormationPanel(
        this.body,
        s._formation,
        (label, action, cls) => this.button(label, action, cls),
        { withStart: false },
      );
      if (restoreMenuFocus) this.body.querySelector('button')?.focus({ preventScroll: true });
      return;
    }

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
      visionLabel(s.getVisionChargesRemaining?.() ?? s.runManager?.visionChargesRemaining),
      s.infoText?.text,
    ]
      .filter(Boolean)
      .join('\n');
    const detailContent = el('div', 'mb-more-content');
    // The boss's full reading lives here; the map carries only its compact bar.
    const bossLine = s._bossPresence?.summaryLine?.();
    if (bossLine) detailContent.append(el('p', 'mb-boss-line', bossLine));
    // The open contract, with its terms and where it stands.
    const contractLine = s._contractHud?.model?.();
    if (contractLine) detailContent.append(el('p', 'mb-contract-detail', contractLine.title));
    if (s.dangerZone?.visible)
      detailContent.append(el('p', '', 'Darker: more enemies · Purple outline: status staff'));
    if (s.pinnedThreatEnemies?.size >= 5)
      detailContent.append(
        el('p', '', '5 ranges pinned. Pinning another enemy replaces the oldest.'),
      );
    const staffInfo = statusStaffInfo(unit);
    if (staffInfo) detailContent.append(el('p', '', staffInfo.text));
    const carrying = carriedItemInfo(unit);
    if (carrying) detailContent.append(el('p', '', carrying.text));
    detailContent.append(el('pre', '', info || 'Tap a tile to inspect terrain.'));
    if (canUseDanger(s)) {
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
      // One locator that walks the ready units in reading order: it names who
      // it will show, brings them into view, selects them and marks the tile.
      const readyList = readyUnits(s);
      const ready = nextReadyUnit(s, this._lastLocated) || readyList[0];
      if (ready) {
        const position = readyList.indexOf(ready) + 1;
        const label =
          readyList.length > 1
            ? `Show ${ready.name} · ${position} of ${readyList.length}`
            : `Show ${ready.name}`;
        const show = this.button(label, () => {
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
          this._lastLocated = ready;
          locateUnit(s, ready);
        });
        show.classList.add('mb-locate');
        this.body.append(show);
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
    // UNIT_SELECTED names its task in the tile-choice row below instead.
    const tileChoice = state === 'UNIT_SELECTED' && s.selectedUnit && !s.inspectMode;
    if (
      !tileChoice &&
      (!this.lab || !['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU'].includes(state))
    )
      this.body.append(
        el(
          'p',
          'mb-hint',
          s.inspectMode
            ? 'Tap an ally or enemy to view their details.'
            : staffRelocateHint(s, state) ||
                warpStrikeHint(s, state) ||
                HINTS[state] ||
                (state.startsWith('SELECTING_')
                  ? 'Tap a highlighted target. Back to go back.'
                  : 'Choose an action on the battlefield.'),
        ),
      );
    if (state === 'SELECTING_TARGET') this.appendTargetList();
    if (state === 'SELECTING_HEAL_TARGET') this.appendHealTargetList();
    if (state === 'SELECTING_AREA_CENTER') this.appendAreaTargeting();
    if (isUnitMenuState(state) && this.menu) {
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
      if (
        s.inEquipMenu &&
        !itemHoldLearned() &&
        menu.items.some((entry) => entry.item && !entry.description)
      )
        this.body.append(el('p', 'mb-detail mb-hold-hint', 'Hold a row for its full details.'));
      // The pinned command (Wait) was built into the dock by syncDock.
      for (const item of menu.items) if (item !== pinned) list.append(this.menuButton(menu, item));
      if (!s.inEquipMenu) {
        // Usable commands fill their rows upright; a greyed one with its reason takes a row.
        const usable = [...list.children].filter(
          (b) => !(b.disabled && b.querySelector('.mb-item-summary')),
        );
        commandSpans(usable.length).forEach((span, i) => (usable[i].dataset.span = span));
      }
      if (menu.items.some((entry) => entry.item?.type === 'Consumable'))
        this.body.append(el('p', 'mb-detail', ITEM_ACTION_NOTE));
      this.body.append(list);
      if (s._escapeController)
        this.body.append(
          this.button('Show exits', () => s._escapeController.showExits(), 'mb-secondary'),
        );
      // Danger joins the action grid (it fills the odd cell) so the rail never
      // overflows into the bottom tools with an open unit menu.
      this.body.append(details);
      if (restoreMenuFocus) this.focusMenuItem(s._menuFocus?.items[s._menuFocus.index]);
      return;
    }
    if (['PLAYER_IDLE', 'UNIT_SELECTED'].includes(state)) {
      const commands = el('div', 'mb-command-grid');
      const secondary = el('div', 'mb-command-grid mb-secondary-grid');
      const inspecting = s.inspectionPanel?.visible && s.inspectionPanel._unit === unit && unit;
      // A unit is still selected (e.g. after Back undid its move): the rail says so and
      // offers an explicit Cancel, like the desktop [X] Cancel footer.
      const cancel =
        state === 'UNIT_SELECTED' && s.selectedUnit ? this.appendTileChoice(s.selectedUnit) : null;
      if (inspecting) {
        const view = this.button('View unit', () => s.openUnitDetailOverlay());
        view.setAttribute('aria-label', 'View unit details');
        commands.append(view);
        this.appendThreatPinControl(unit, commands);
      }
      const trio = el('div', 'mb-command-row');
      for (const [label, action, active] of [
        ['Inspect', 'inspect', s.inspectMode],
        ['Roster', 'roster', null],
        ['Rewind', 'objective', null],
      ]) {
        if (inspecting && action === 'inspect') continue;
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
        (inspecting && ['roster', 'objective'].includes(action) ? secondary : trio).append(button);
      }
      if (trio.childElementCount) commands.append(trio);
      // On the upright rail End turn waits in the dock (syncDock) instead.
      const endTurn = endTurnDocked ? null : this.endTurnButton();
      if (inspecting && endTurn) commands.append(endTurn);
      // Cancel pairs with End turn (or joins the inspection grid): one row, no scroll.
      if (cancel && inspecting) commands.append(cancel);
      this.body.append(commands);
      if (inspecting) this.body.append(secondary);
      else if (cancel && endTurn) {
        const pair = el('div', 'mb-command-grid mb-tile-choice-actions');
        pair.append(cancel, endTurn);
        this.body.append(pair);
      } else if (cancel || endTurn) this.body.append(cancel || endTurn);
      if (s._escapeController)
        this.body.append(
          this.button('Show exits', () => s._escapeController.showExits(), 'mb-secondary'),
        );
    }
    if (!this.menu && !this.endTurnPending) this.body.append(details);
  }

  /**
   * UNIT_SELECTED: a "Choose a tile · <name>" line, and a Cancel that deselects
   * (returned for the caller to place; null during a prologue guided step).
   */
  appendTileChoice(selected) {
    const s = this.scene;
    this.body.append(el('p', 'mb-hint mb-choose-tile', `Choose a tile · ${selected.name}`));
    if (s._isPrologueGateActive?.()) return null;
    const cancel = this.button(
      'Cancel',
      () => {
        if (s.battleState !== 'UNIT_SELECTED' || s.selectedUnit !== selected) return;
        // One press deselects, even while an enemy is being inspected.
        s._inputController?.clearPlanningInspection?.();
        s.requestCancel({ allowPause: false });
      },
      'mb-cancel-selection',
    );
    cancel.setAttribute('aria-label', 'Cancel selection');
    return cancel;
  }

  appendHealTargetList() {
    const s = this.scene;
    const healer = s.selectedUnit;
    if (!healer) return;
    const list = el('div', 'mb-actions mb-heal-targets');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Heal targets');
    for (const target of s.healTargets || []) {
      const preview = sceneHealPreview(s, target);
      if (!preview) continue;
      const button = this.button(target.name, () => {
        if (
          s.battleState !== 'SELECTING_HEAL_TARGET' ||
          s.selectedUnit !== healer ||
          !s.healTargets?.includes(target) ||
          target.currentHP <= 0 ||
          target._removing
        )
          return;
        s.executeHeal(healer, target);
      });
      button.append(
        el(
          'small',
          'mb-item-summary',
          preview.conditions
            ? preview.text
            : `HP ${preview.from}/${preview.max} → ${preview.to}/${preview.max} (+${preview.amount})`,
        ),
      );
      list.append(button);
    }
    this.body.append(list);
  }

  targetListKey() {
    const s = this.scene;
    return [
      (s.attackTargets || []).map((t) => `${t.battleEntityId || t.name}:${t.currentHP}`).join(),
      s._attackFlowController?.focusedTarget?.battleEntityId ||
        s._attackFlowController?.focusedTarget?.name ||
        '',
    ].join('|');
  }

  /** Target selection: each attackable enemy as a button (tap = forecast). */
  /**
   * Aiming a chosen-center art (AreaTargetingController): ◀ Foe ▶ step through the foes
   * in reach; with a tile locked, the prompt's rows (Fire, Back).
   */
  appendAreaTargeting() {
    const s = this.scene;
    const area = s._areaTargetingController;
    if (!area?.active) return;
    if (area.locked && this.menu) {
      // The prompt is registered under the aiming state, not a unit menu (menuButton's
      // guard), so its rows act only while that same prompt is up.
      const menu = this.menu;
      const list = el('div', 'mb-actions');
      for (const item of menu.items)
        list.append(
          this.button(
            item.label,
            () => {
              if (this.menu !== menu || s.battleState !== 'SELECTING_AREA_CENTER') return;
              item.onActivate();
            },
            item.id === 'area:fire' ? 'mb-primary' : '',
          ),
        );
      this.body.append(list);
      return;
    }
    const foes = el('div', 'mb-command-row');
    foes.append(
      this.button('◀ Foe', () => s.game.events.emit('mobile:prevFoe')),
      this.button('Foe ▶', () => s.game.events.emit('mobile:nextFoe')),
    );
    this.body.append(foes);
  }

  appendTargetList() {
    const s = this.scene;
    const unit = s.selectedUnit;
    const targets = s.attackTargets || [];
    if (!unit || !targets.length) return;
    this.body.append(el('p', 'mb-detail', 'Choose a target — tap it here or on the map.'));
    const list = el('div', 'mb-actions mb-targets');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Attack targets');
    const focused = s._attackFlowController?.focusedTarget;
    for (const target of targets) {
      const button = this.button(
        target.name,
        () => {
          if (s.battleState !== 'SELECTING_TARGET' || !s.attackTargets?.includes(target)) return;
          s._attackFlow().openForecast(unit, target);
        },
        target === focused ? 'mb-target-focused' : '',
      );
      const cls =
        target.className && target.className !== target.name ? `${target.className} · ` : '';
      button.append(
        el('small', 'mb-item-summary', `${cls}HP ${target.currentHP}/${target.stats?.HP ?? '?'}`),
      );
      list.append(button);
    }
    this.body.append(list);
  }

  /**
   * The Danger toggle: a crimson-hatched swatch, the command, and a state line that
   * says what the overlay shows (allies in reach) or how to pin it. Tap toggles,
   * hold pins/unpins — unchanged gestures; the name stays 'Danger' / 'Danger · pinned'.
   */
  /** Top/bottom fades and a "more" cue when the command stack scrolls. */
  syncScrollCues() {
    const body = this.body;
    if (!body?.isConnected) return;
    const above = body.scrollTop > 2;
    const below = body.scrollTop + body.clientHeight < body.scrollHeight - 2;
    body.classList.toggle('has-more-above', above);
    body.classList.toggle('has-more-below', below);
    // One cue, pointing where the rest is: below first, else back up.
    const cue = this.moreCue;
    cue.hidden = !(below || above) || this.root.hidden;
    if (!cue.hidden) {
      cue.textContent = below ? 'more ▾' : 'more ▴';
      cue.classList.toggle('is-up', !below);
      cue.style.top = `${Math.round(below ? body.offsetTop + body.clientHeight - 16 : body.offsetTop + 2)}px`;
    }
    const place = (fade, show, top) => {
      fade.hidden = !show || this.root.hidden;
      if (fade.hidden) return;
      fade.style.top = `${Math.round(top)}px`;
      fade.style.left = `${body.offsetLeft}px`;
      fade.style.width = `${body.clientWidth}px`;
    };
    place(this.fadeTop, above, body.offsetTop);
    place(this.fadeBottom, below, body.offsetTop + body.clientHeight - 22);
  }

  /** One action-menu command as a rail button (the list and the dock share it). */
  menuButton(menu, item, className = '') {
    const s = this.scene;
    // Canvas rows prefix the equipped weapon with "E "; show the badge instead.
    const equippedRow =
      Boolean(item.item) &&
      item.item === menu.unit?.weapon &&
      item.label.startsWith(EQUIPPED_MARKER);
    // Weapon and item rows show a one-line brief; a long press opens the row's
    // full stats and effect in place (and closes it again).
    const detail = item.description ? '' : battleItemSummary(item.item, menu.unit);
    const expanded = Boolean(detail) && this.expandedItem === item.item;
    const button = this.button(
      equippedRow ? item.label.slice(EQUIPPED_MARKER.length) : item.label,
      () => {
        if (
          this.menu !== menu ||
          s.actionMenu !== menu.objects ||
          s.selectedUnit !== menu.unit ||
          !isUnitMenuState(s.battleState) ||
          item.disabled
        )
          return;
        item.onActivate();
      },
      [
        item.id === 'attack' && !item.disabled ? 'mb-primary' : '',
        expanded ? 'is-expanded' : '',
        className,
      ]
        .filter(Boolean)
        .join(' '),
      detail
        ? () => {
            if (this.menu !== menu) return;
            this.expandedItem = this.expandedItem === item.item ? null : item.item;
            markItemHoldLearned();
          }
        : null,
    );
    // Weapon and item rows lead with the item's socketed icon, as every menu outside battle does.
    if (item.item?.name && item.item.type)
      button.prepend(itemIcon(item.item, { size: 16, className: 'mb-item-icon' }));
    if (equippedRow) button.append(equippedBadgeElement());
    if (item.description) button.append(el('small', 'mb-item-summary', item.description));
    else if (item.note) {
      // A note (Wait on an intact village) informs without renaming the command:
      // the button is still announced and found as its label.
      button.append(el('small', 'mb-item-summary mb-item-note', item.note));
      button.setAttribute('aria-label', item.label);
      button.setAttribute('aria-description', item.note);
    } else if (detail) {
      const brief = battleItemBrief(item.item, menu.unit);
      button.append(el('small', 'mb-item-summary', expanded ? detail : brief));
      // Screen readers always hear every stat and the effect.
      button.setAttribute('aria-description', detail);
    }
    button.disabled = item.disabled;
    item.domButton = button;
    button.addEventListener('focus', () => {
      const index = s._menuFocus?.items.indexOf(item);
      if (index >= 0) s._menuFocus.index = index;
      for (const entry of menu.items) {
        entry.domButton?.classList.toggle('mb-menu-focused', entry === item);
      }
    });
    return button;
  }

  endTurnButton(className = '') {
    return this.button('End turn…', () => this.requestEndTurn(), `mb-end-turn ${className}`.trim());
  }

  /**
   * The fixed dock: Danger whenever a turn is being planned. In a unit's action menu
   * the pinned command (Wait) shares the row with a compact Danger, so the dock stays
   * one row high and the scroll region keeps its height; on the upright rail End turn
   * does the same while no unit menu is open (dockedEndTurn).
   */
  syncDock(state, pinned = null, endTurn = false) {
    const s = this.scene;
    this.dock.replaceChildren();
    if (state === 'DEPLOY_POSITIONING' && s._formation?.ready) {
      // Placement: Start stays in view under the waiting units, beside Danger.
      this.dock.hidden = false;
      this.dock.classList.toggle('has-pinned', false);
      this.dock.append(
        startButton(s._formation, (label, action, cls) => this.button(label, action, cls)),
        ...(canUseDanger(s) ? [this.dangerToggle({ compact: true, viaEvent: true })] : []),
      );
      this.dock.classList.toggle('is-formation', true);
      return;
    }
    this.dock.classList.toggle('is-formation', false);
    const planning =
      (['PLAYER_IDLE', 'UNIT_SELECTED'].includes(state) || isUnitMenuState(state)) &&
      s.turnManager?.currentPhase !== 'enemy';
    this.dock.hidden = !planning && !canUseDanger(s);
    const pin = planning && pinned && this.menu ? pinned : null;
    const dockEndTurn = planning && !pin && endTurn;
    this.dock.classList.toggle('has-pinned', Boolean(pin || dockEndTurn));
    if (!planning && !canUseDanger(s)) return;
    if (pin) this.dock.append(this.menuButton(this.menu, pin, 'mb-pinned-command'));
    else if (dockEndTurn) this.dock.append(this.endTurnButton('mb-pinned-command'));
    if (canUseDanger(s))
      this.dock.append(
        this.dangerToggle({
          compact: Boolean(pin || dockEndTurn),
          viaEvent: !isUnitMenuState(state),
        }),
      );
  }

  dangerToggle({ compact = false, viaEvent = false } = {}) {
    const s = this.scene;
    const pinned = Boolean(s.keepDangerVisible);
    const shown = Boolean(s.dangerZone?.visible);
    const label = pinned ? 'Danger · pinned' : 'Danger';
    const button = this.button(
      '',
      () => (viaEvent ? s.game.events.emit('mobile:danger') : s._onDangerClick()),
      `mb-danger-toggle${compact ? ' is-compact' : ''}${shown ? ' is-on' : ''}${pinned ? ' is-pinned' : ''}`,
      () => s.togglePersistentDanger(),
    );
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(shown));
    const swatch = el('span', 'mb-danger-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    const text = el('span', 'mb-danger-text');
    text.append(el('strong', '', compact ? 'Danger' : label));
    let state;
    if (shown) {
      const tiles = new Set(
        (s.dangerZone?.tiles || []).filter((t) => t.tier > 0).map((t) => `${t.col},${t.row}`),
      );
      const exposed = (s.playerUnits || []).filter(
        (u) => u.currentHP > 0 && tiles.has(`${u.col},${u.row}`),
      ).length;
      const reach = exposed ? `${exposed} in reach` : 'None in reach';
      // Half a dock row (beside the pinned Wait): the reading, without the gesture.
      state = compact ? reach : `${reach} · ${pinned ? 'hold to unpin' : 'hold to pin'}`;
    } else state = compact ? 'Hold to pin' : 'Enemy reach · hold to pin';
    text.append(el('small', 'mb-hold-cue', state));
    button.append(swatch, text);
    return button;
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
