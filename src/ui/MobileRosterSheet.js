import { saveServiceRun } from './serviceSave.js';
import { weaponArtScrollText } from './weaponArtDisplay.js';
import { appendItemArtDetails } from './ItemArtDetails.js';
import { statusDescriptions, statusStaffInfo } from '../engine/BattleInformation.js';
import { classChangePreview } from './classChangeDisplay.js';
import {
  formatWeaponArtEffects,
  weaponArtCostText,
  weaponArtUsesText,
} from './weaponArtDisplay.js';
import { bindCancelablePress } from '../utils/cancelablePress.js';
import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { formatPerkMods, MASTERY_HELP, proficiencyLabel } from './rosterDisplay.js';
import { ContextHelp } from './ContextHelp.js';
import { getForgeDisplayInfo } from '../engine/ForgeSystem.js';
import { getImbueDisplayInfo } from '../engine/ImbueSystem.js';
import { getEffectiveStaffRange } from '../engine/Combat.js';
import {
  getMasteryProgress,
  getMasteryThreshold,
  isMastered,
  getMasteryPerk,
} from '../engine/MasterySystem.js';
import { getUnitTraits } from '../engine/TraitSystem.js';
import { calculateAvoid } from '../engine/Combat.js';
import { STAT_DESCRIPTIONS } from '../data/helpContent.js';
import { rosterArtBlock, bindRosterArt } from '../engine/RosterArtCommands.js';
import { MAX_SKILLS, XP_PER_LEVEL } from '../utils/constants.js';
import {
  teachScrollBlock,
  teachRosterScroll,
  giveRosterItemBlock,
  giveRosterItem,
} from '../engine/RosterTransfers.js';
import { canEquip, isLastCombatWeapon } from '../engine/UnitManager.js';
import { getStaticCombatStats } from '../engine/Combat.js';
import {
  getWeaponArtIds,
  getWeaponArtBindings,
  canUseWeaponArt,
  isWeaponArtCompatibleWithWeapon,
} from '../engine/WeaponArtSystem.js';
import { ChoicePicker } from './ChoicePicker.js';
import { applyRosterClassChange, rosterClassChangeBlock } from '../engine/RosterCommands.js';
import {
  resolvePromotionTargets,
  getReclassTargets,
  getSkillDisplayNames,
} from '../engine/UnitManager.js';
import { unitPortrait } from './unitPortrait.js';
import { createHealthBar } from './healthBar.js';
import { STAT_COLORS } from '../utils/uiStyles.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import {
  rosterItemAction,
  rosterItemBlock,
  rosterAccessoryAction,
} from '../engine/RosterInventory.js';
import { getStaffRemainingUses, getStaffMaxUses } from '../engine/Combat.js';
import { getConsumableDescription, formatUses } from '../utils/consumableText.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { pushInputScope, popInputScope, hasInputFocus } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import { hasDOMHost, DOM_INPUT_EVENTS } from '../utils/domUI.js';

// Movement between pointerdown and click that still counts as a tap, for touch
// and pen. Mice hold a line far tighter, so they keep the original 10px.
const DRAG_SLOP_TOUCH = 24;

export function canShowMobileRoster() {
  return hasDOMHost();
}
function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

// One presentation for read-only battle inspection and between-battle management.
export class MobileRosterSheet {
  constructor({
    scene,
    units,
    index = 0,
    gameData,
    run = null,
    onClose,
    portraitKey = null,
    terrainForUnit = null,
  }) {
    Object.assign(this, {
      scene,
      units,
      index,
      gameData,
      run,
      onClose,
      portraitKey,
      terrainForUnit,
    });
    this.tab = 'stats';
    this.previousFocus = document.activeElement;
    this.root = el('section', null, 'mr-sheet');
    this.root.style.zIndex = DOM_UI_DEPTHS.MENU;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', run ? 'Manage roster' : 'Inspect roster');
    this.root.tabIndex = -1;
    for (const type of DOM_INPUT_EVENTS)
      this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
      if (ignoreRepeatedActivation(e)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.onClose();
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        this.changeTab(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (['ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        this.moveWithinList(e.key === 'ArrowUp' ? -1 : 1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        this.moveFocus(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.activateFocused();
      }
    });
    document.getElementById('game-wrapper').append(this.root);
    pushInputScope(this, (action, payload) => {
      if (action === InputAction.NAVIGATE) {
        if (payload?.dx) this.changeTab(payload.dx);
        else this.moveWithinList(payload?.dy || 1);
      }
      if (action === InputAction.CONFIRM) this.activateFocused();
      if ([InputAction.CANCEL, InputAction.PAUSE, InputAction.ROSTER].includes(action))
        this.onClose();
      if ([InputAction.PREV_UNIT, InputAction.NEXT_UNIT].includes(action) && this.units.length) {
        this.index =
          (this.index + (action === InputAction.NEXT_UNIT ? 1 : -1) + this.units.length) %
          this.units.length;
        this.tab = 'stats';
        this.render();
      }
    });
    this.shutdown = () => this.destroy();
    scene.events.once('shutdown', this.shutdown);
    this.render();
    this.root.querySelector('.mr-tabs [aria-pressed="true"]')?.focus();
  }
  changeTab(delta) {
    const tabs = [...this.root.querySelectorAll('.mr-tabs button')];
    const index = tabs.findIndex((b) => b.getAttribute('aria-pressed') === 'true');
    tabs[(index + Math.sign(delta) + tabs.length) % tabs.length]?.click();
    this.root.querySelector('.mr-tabs [aria-pressed="true"]')?.focus();
  }
  moveWithinList(delta) {
    const active = document.activeElement;
    const region = active?.closest('.mr-units') || this.root.querySelector('.mr-content');
    const items = this.controls().filter((el) => region?.contains(el));
    if (!items.length) return;
    const index = items.indexOf(active);
    items[
      index < 0
        ? delta < 0
          ? items.length - 1
          : 0
        : (index + Math.sign(delta) + items.length) % items.length
    ]?.focus();
  }
  controls() {
    return [...this.root.querySelectorAll('button:not(:disabled), summary, select')].filter(
      (node) => node.getClientRects().length > 0,
    );
  }
  moveFocus(delta) {
    const controls = this.controls();
    const index = controls.indexOf(document.activeElement);
    controls[(index + delta + controls.length) % controls.length]?.focus();
  }
  activateFocused() {
    const active = document.activeElement;
    if (this.controls().includes(active)) active.click();
  }
  button(label, action, reason = '') {
    const b = el('button', label);
    b.type = 'button';
    b.disabled = !!reason;
    if (reason) b.title = reason;
    bindCancelablePress(b, action, {
      enabled: () => !this.destroyed && hasInputFocus(this),
      context: () => `${this.index}:${this.tab}`,
      threshold: (event) => (event.pointerType === 'mouse' ? 10 : DRAG_SLOP_TOUCH),
    });
    return b;
  }
  portrait(unit, className) {
    return unitPortrait(this.scene, this.gameData, unit, className, this.portraitKey);
  }
  render(message = '') {
    if (this.destroyed) return;
    const oldScroll = this.root.querySelector('.mr-content')?.scrollTop || 0;
    const focusKey = document.activeElement?.dataset?.focusKey;
    this.root.replaceChildren();
    const head = el('header');
    head.append(el('h2', this.run ? 'Roster' : 'Unit details'));
    head.append(this.button('Close', this.onClose));
    this.root.append(head);
    const layout = el('div', null, 'mr-layout');
    const nav = el('nav', null, 'mr-units');
    nav.setAttribute('aria-label', 'Units');
    this.units.forEach((unit, index) => {
      const b = this.button('', () => {
        this.index = index;

        this.render();
      });
      b.classList.add('mr-unit-card');
      const face = this.portrait(unit, 'mr-unit-face');
      if (face) b.append(face);
      const info = el('span', null, 'mr-unit-info');
      // Level rides the name row: the class/HP line already wraps at this column
      // width for longer class names, and another token would wrap it more often.
      const nameRow = el('span', null, 'mr-unit-name');
      nameRow.append(el('strong', unit.name), el('em', `Lv ${getDisplayLevel(unit)}`));
      info.append(nameRow, el('span', `${unit.className} · HP ${unit.currentHP}/${unit.stats.HP}`));
      info.append(createHealthBar(unit));
      b.append(info);
      b.setAttribute('aria-pressed', String(index === this.index));
      nav.append(b);
    });
    if (!this.units.length) nav.append(el('p', 'No units in the roster.'));
    layout.append(nav);
    const pane = el('div', null, 'mr-pane');
    const tabs = el('nav', null, 'mr-tabs');
    tabs.setAttribute('aria-label', 'Roster views');
    for (const [id, label] of [
      ['stats', 'Stats'],
      ['skills', 'Skills'],
      ['gear', 'Equipment'],
      ...(this.run ? [['convoy', 'Convoy']] : []),
    ]) {
      const b = this.button(label, () => {
        this.tab = id;
        this.render();
      });
      b.setAttribute('aria-pressed', String(this.tab === id));
      tabs.append(b);
    }
    head.insertBefore(tabs, head.lastElementChild);
    const body = el('div', null, 'mr-content');
    this.body = body;
    const unit = this.units[this.index];
    if (unit) {
      const summary = el('div', null, 'mr-summary');
      const portrait = this.portrait(unit, 'mr-portrait');
      if (portrait) summary.append(portrait);
      summary.append(
        el('h3', unit.name),
        el(
          'p',
          `Lv ${getDisplayLevel(unit)} ${unit.className} · ${unit.tier === 'promoted' ? 'Promoted' : 'Base'} · XP ${unit.xp || 0}/${XP_PER_LEVEL} · HP ${unit.currentHP}/${unit.stats.HP}`,
        ),
      );
      summary.append(createHealthBar(unit));
      body.append(summary);
      if (this.tab === 'stats') this.stats(unit);
      if (this.tab === 'skills') this.skills(unit);
      if (this.tab === 'gear') this.gear(unit);
    }
    if (this.tab === 'convoy') this.convoy(unit);
    const status = (this.status ||= el('p', '', 'mr-status'));
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.setAttribute('role', 'status');
    body.append(status);
    pane.append(body);
    layout.append(pane);
    this.root.append(layout);
    queueMicrotask(() => {
      if (!this.destroyed) status.textContent = message;
    });
    [...this.root.querySelectorAll('button')].forEach((b, i) => {
      b.dataset.focusKey = String(i);
    });
    body.scrollTop = oldScroll;
    if (focusKey)
      (this.root.querySelector(`[data-focus-key="${focusKey}"]`) || this.root).focus({
        preventScroll: true,
      });
  }
  card(title, description = '') {
    const c = el('article', null, 'mr-card');
    c.append(el('h4', title));
    if (description) c.append(el('p', description));
    this.body.append(c);
    return c;
  }
  stats(unit) {
    const conditions = statusDescriptions(unit);
    if (conditions.length)
      this.card(
        'Conditions',
        `${conditions.join('\n')}\nDurations count down when this unit’s side starts its turn.`,
      );
    const statusStaff = statusStaffInfo(unit);
    if (statusStaff) this.card('Status staff', statusStaff.text);
    const terrain = this.terrainForUnit?.(unit);
    const grid = el('dl', null, 'mr-stats');
    for (const [key, value] of Object.entries(unit.stats || {})) {
      const valueText = el('dd', String(value));
      valueText.style.color = STAT_COLORS[key] || '#e0e0e0';
      grid.append(
        el(
          'dt',
          {
            HP: 'HP',
            STR: 'Strength',
            MAG: 'Magic',
            SKL: 'Skill',
            SPD: 'Speed',
            LCK: 'Luck',
            DEF: 'Defense',
            RES: 'Resistance',
            MOV: 'Move',
          }[key] || key,
        ),
        valueText,
      );
    }
    this.body.append(grid);
    this.card(
      'Proficiencies',
      (unit.proficiencies || []).map(proficiencyLabel).join(' · ') || 'None',
    );
    const combat = getStaticCombatStats(unit, unit.weapon);
    const combatCard = this.card(
      'Combat baseline',
      `Atk ${combat.atk} · AS ${combat.as} · Hit ${combat.hit} · Avo ${terrain ? calculateAvoid(unit, terrain) : unit.stats.SPD * 2 + unit.stats.LCK} · Crit ${combat.crit} · Wt ${combat.weight}`,
    );
    combatCard.append(
      this.button('About combat numbers', () =>
        this.showHelp('Combat baseline', [
          `Equipped: ${unit.weapon?.name || 'Unarmed'}. Weapon weight ${unit.weapon?.weight || 0}; Strength allowance ${Math.floor((unit.stats.STR || 0) / 5)}; effective weight ${combat.weight}. Attack Speed ${combat.as} includes Speed ${unit.stats.SPD}, the effective weight penalty and any weapon Speed bonus. Staves do not impose a weight penalty.`,
          'Attack is your baseline offensive power before enemy defenses. Hit and Crit are ratings, not final percentages against a specific enemy. Avoid reduces enemy hit chance. Effective weight is the penalty after Strength offsets weapon weight, so it can differ from the item’s listed weight.',
          'Conditional skills, mastery, terrain and the opponent can change combat. Review the combat forecast for target-specific damage, Hit rating and follow-up attacks.',
        ]),
      ),
    );
    if (terrain)
      this.card(
        `Terrain: ${terrain.name}`,
        unit.moveType === 'Flying'
          ? 'Flying — no terrain defense or avoid bonus.'
          : `Defense +${parseInt(terrain.defBonus) || 0} · Avoid +${parseInt(terrain.avoidBonus) || 0}`,
      );
    if (unit.faction !== 'enemy') {
      const mastered = isMastered(unit, this.gameData.classes, this.gameData.traits);
      const perk = getMasteryPerk(unit, this.gameData.classes, this.gameData.traits);
      const progress = getMasteryProgress(unit, this.gameData.classes);
      const threshold = getMasteryThreshold(unit, this.gameData.traits);
      const reward = perk ? `${perk.name} · ${formatPerkMods(perk.mods)}` : 'No class perk';
      const mastery = this.card(
        mastered ? 'Class mastered ★' : 'Class mastery',
        `${progress} / ${threshold} battles · ${mastered ? 'Active' : 'Unlock'}: ${reward}`,
      );
      mastery.append(
        this.button('About class mastery', () =>
          this.showHelp('Class mastery', [
            `${unit.name}: ${progress} / ${threshold} battles. ${mastered ? 'Active perk' : 'Unlock'}: ${reward}.`,
            ...MASTERY_HELP,
            'Weapon proficiency is separate: Proficient and Master are class-driven weapon ranks, not a weapon-use experience bar.',
          ]),
        ),
      );
      for (const trait of getUnitTraits(unit, this.gameData.traits))
        this.card(trait.name, trait.description);
    }
    for (const id of unit.affixes || []) {
      const affix = this.gameData.affixes?.affixes?.find((a) => a.id === id);
      this.card(affix?.name || id, affix?.description || '');
    }
    const explanations = el('details', null, 'mr-card');
    explanations.append(el('summary', 'Attribute explanations'));
    for (const [stat, description] of Object.entries(STAT_DESCRIPTIONS))
      explanations.append(el('p', `${stat}: ${description}`));
    this.body.append(explanations);
    if (unit.growths && unit.faction !== 'enemy') {
      const details = el('details', null, 'mr-card');
      details.append(
        el('summary', 'Growths'),
        el(
          'p',
          'Each percentage is the chance of gaining +1 in that stat on a level-up. At least one stat increases: if every roll fails, the highest-growth stat gains +1.',
        ),
        el(
          'p',
          Object.entries(unit.growths)
            .map(([stat, value]) => `${stat} ${value}%`)
            .join(' · '),
        ),
      );
      this.body.append(details);
    }
  }
  skills(unit) {
    this.body.append(el('h3', `Skills · ${unit.skills?.length || 0}/${MAX_SKILLS}`));
    for (const id of unit.skills || []) {
      const skill = this.gameData.skills?.find((s) => s.id === id);
      this.card(
        skill?.name || id,
        `${skill?.trigger === 'passive-aura' ? 'Passive aura · ' : skill?.trigger === 'passive' ? 'Passive · ' : ''}${skill?.description || ''}`,
      );
    }
    if (!(unit.skills || []).length) this.card('Skills', 'No skills learned yet.');
    this.body.append(el('h3', 'Weapon arts'));
    let count = 0;
    for (const weapon of unit.inventory || []) {
      for (const id of getWeaponArtIds(weapon)) {
        const art = this.gameData.weaponArts?.arts?.find((a) => a.id === id);
        this.card(
          `${art?.name || id} · ${weapon.name}`,
          `${formatWeaponArtEffects(art)} · ${weaponArtCostText(unit, art, { weaponArtHpCostDelta: this.scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0 })}`,
        );
        if (art && this.scene.sys?.settings?.key === 'Battle' && this.scene.turnManager) {
          const check = canUseWeaponArt(unit, weapon, art, {
            turnNumber: this.scene.turnManager?.turnNumber,
            isInitiating: true,
            actorFaction: unit.faction,
            weaponArtHpCostDelta:
              this.scene.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
          });
          this.body.lastElementChild.append(
            el(
              'small',
              `${check.ok ? 'Ready' : (check.reason || 'Unavailable').replaceAll('_', ' ')} · ${weaponArtUsesText(unit, art, this.scene.turnManager.turnNumber)}`,
            ),
          );
        } else if (art) {
          const prof = unit.proficiencies?.find((p) => p.type === weapon.type);
          const required = art.requiredRank || 'Prof';
          const qualifies =
            prof &&
            ({ Prof: 0, Mast: 1 }[prof.rank || 'Prof'] ?? -1) >=
              ({ Prof: 0, Mast: 1 }[required] ?? 0);
          this.body.lastElementChild.append(
            el(
              'small',
              !isWeaponArtCompatibleWithWeapon(art, weapon)
                ? 'Incompatible weapon type.'
                : `${qualifies ? 'Meets' : 'Needs'} ${weapon.type} ${required} · Battle usage resets for the next map.`,
            ),
          );
        }
        count++;
      }
    }
    if (count)
      this.body.append(
        this.button('About weapon arts', () =>
          this.showHelp('Weapon arts', [
            'Weapon arts modify the selected attack. Choosing an art does not spend HP or uses; committing its attack does. You must have more HP than the effective cost.',
            'Map uses reset on a new battle. Turn uses reset on a new turn. Availability can also depend on proficiency, rank, silence and the particular weapon. The art’s displayed HP cost includes your equipped accessory and run modifiers.',
            'Battle limits shown here are remaining uses. Outside battle, the sheet shows eligibility and effective cost without carrying over a previous battle’s usage.',
          ]),
        ),
      );
    if (!count) this.card('No weapon arts', 'No arts bound to carried weapons.');
    if (this.run) {
      this.body.append(el('h3', `Team scrolls · ${this.run.scrolls?.length || 0}`));
      for (const scroll of this.run.scrolls || []) {
        const skill = this.gameData.skills.find((s) => s.id === scroll.skillId);
        const card = this.card(
          scroll.name,
          scroll.teachesWeaponArtId
            ? weaponArtScrollText(scroll, this.gameData.weaponArts?.arts || [])
            : skill?.description || scroll.description || '',
        );
        card.classList.add('mr-scroll-description');
        if (!scroll.teachesWeaponArtId)
          card.append(this.button('Teach…', () => this.teachScroll(scroll)));
        else card.append(this.button('Bind to weapon…', () => this.bindArt(scroll)));
      }
    }
  }
  bindArt(scroll) {
    if (this.picker || this.destroyed) return;
    const arts = this.gameData.weaponArts?.arts || [];
    const choices = this.units.flatMap((unit) =>
      (unit.inventory || [])
        .map((weapon) => ({ unit, weapon }))
        .filter(({ weapon }) => {
          const reason = rosterArtBlock(this.run, unit, weapon, scroll, arts);
          return !reason || reason === 'Weapon already has this art.';
        }),
    );
    const artDescription = (id, unit) => {
      const art = arts.find((entry) => entry.id === id);
      return art
        ? `${art.name} · ${weaponArtCostText(unit, art)} · ${art.requiredRank || 'Prof'}\n${formatWeaponArtEffects(art)}`
        : id;
    };
    const sourceLabel = (source) =>
      ({ meta_innate: 'Meta Innate', scroll: 'Scroll', innate: 'Innate' })[source] || 'Innate';
    const flow = { weapon: null, replacement: null, weaponScroll: 0, replacementScroll: 0 };
    const openStep = (options, onApplied, onBack, scrollKey) => {
      if (this.destroyed) return;
      let committed = false;
      const originalApply = options.apply;
      this.picker = new ChoicePicker({
        scene: this.scene,
        ...options,
        closeLabel: onBack ? 'Back' : 'Close',
        apply: (choice) => {
          const result = originalApply(choice);
          if (result.ok) committed = true;
          return result;
        },
        onClose: () => {
          this.picker = null;
          if (this.destroyed) return;
          if (committed) onApplied?.();
          else if (onBack) onBack();
          else this.root.querySelector('button')?.focus();
        },
      });
      const picker = this.picker;
      const list = picker.surface.body.querySelector('.re-choice-list');
      if (scrollKey && list) {
        list.scrollTop = flow[scrollKey];
        // Selection re-renders the list; track scrolling at the stable body.
        picker.surface.body.addEventListener(
          'scroll',
          (event) => {
            if (event.target.classList.contains('re-choice-list'))
              flow[scrollKey] = event.target.scrollTop;
          },
          true,
        );
      }
    };
    const showConfirm = () => {
      const { unit, weapon } = flow.weapon;
      const replacement = flow.replacement;
      const old = replacement ? arts.find((a) => a.id === replacement.id) : null;
      openStep(
        {
          title: old ? `Replace ${old.name}?` : 'Bind weapon art',
          choices: [weapon],
          confirmation: true,
          label: (w) => w.name,
          describe: () =>
            `${unit.name} · Uses one ${scroll.name} on Confirm. Back uses nothing.${replacement ? `\nReplaces ${sourceLabel(replacement.source)} art ${old?.name || replacement.id}.` : ''}`,
          preview: () =>
            `${replacement ? `REMOVE\n${artDescription(replacement.id, unit)}\n\n` : ''}ADD\n${artDescription(scroll.teachesWeaponArtId?.trim(), unit)}`,
          blocked: () => rosterArtBlock(this.run, unit, weapon, scroll, arts),
          apply: () => {
            const result = bindRosterArt(this.run, unit, weapon, scroll, arts, replacement);
            if (result.ok) this.render(`${scroll.name} bound to ${weapon.name}.`);
            return result;
          },
        },
        () => this.root.querySelector('button')?.focus(),
        replacement ? showReplacement : showWeapons,
      );
    };
    const showReplacement = () => {
      const { unit, weapon } = flow.weapon;
      const bindings = getWeaponArtBindings(weapon).map((entry, index) => ({ ...entry, index }));
      const previous = flow.replacement;
      openStep(
        {
          title: 'Choose art to replace',
          choices: bindings,
          initialChoice: bindings.find(
            (b) =>
              b.index === previous?.index && b.id === previous.id && b.source === previous.source,
          ),
          label: (b) => arts.find((a) => a.id === b.id)?.name || b.id,
          describe: (b) => `Slot ${b.index + 1} · ${sourceLabel(b.source)}`,
          preview: (b) =>
            `REMOVE\n${artDescription(b.id, unit)}\n\nADD\n${artDescription(scroll.teachesWeaponArtId?.trim(), unit)}`,
          blocked: () => rosterArtBlock(this.run, unit, weapon, scroll, arts),
          apply: (choice) => {
            flow.replacement = choice;
            return { ok: true };
          },
        },
        showConfirm,
        showWeapons,
        'replacementScroll',
      );
    };
    const showWeapons = () =>
      openStep(
        {
          title: `Choose weapon for ${scroll.name}`,
          choices,
          initialChoice: flow.weapon,
          label: (c) => `${c.unit.name} · ${c.weapon.name}`,
          describe: (c) => `${getWeaponArtBindings(c.weapon).length}/3 art slots`,
          blocked: (c) => rosterArtBlock(this.run, c.unit, c.weapon, scroll, arts),
          apply: (choice) => {
            if (flow.weapon !== choice) flow.replacement = null;
            flow.weapon = choice;
            return { ok: true };
          },
        },
        () => {
          if (getWeaponArtBindings(flow.weapon.weapon).length >= 3) showReplacement();
          else {
            flow.replacement = null;
            showConfirm();
          }
        },
        null,
        'weaponScroll',
      );
    showWeapons();
  }

  chooseUnit(title, blocked, apply, describe = (unit) => unit.className) {
    if (this.picker || this.destroyed) return;
    this.picker = new ChoicePicker({
      scene: this.scene,
      title,
      choices: this.units,
      label: (unit) => unit.name,
      describe,
      blocked,
      apply,
      onClose: () => {
        this.picker = null;
        this.root.querySelector('button')?.focus();
      },
    });
  }
  giveItem(source, item) {
    this.chooseUnit(
      `Give ${item.name}${item.type !== 'Consumable' && isLastCombatWeapon(source, item) ? ' — leaves unit unarmed' : ''}`,
      (target) => giveRosterItemBlock(this.run, source, target, item),
      (target) => {
        const result = giveRosterItem(this.run, source, target, item);
        if (result.ok) this.render(`${item.name} given to ${target.name}.`);
        return result;
      },
      (target) => {
        if (item.type === 'Consumable') return `${target.consumables?.length || 0}/3 supplies`;
        if (!canEquip(target, item))
          return `Needs ${item.type} ${item.rankRequired || 'Prof'} · ${target.inventory.length}/5 items`;
        return `Can equip · AS ${getStaticCombatStats(target, target.weapon).as} → ${getStaticCombatStats(target, item).as} if equipped · ${target.inventory.length}/5 items`;
      },
    );
  }
  teachScroll(scroll) {
    this.chooseUnit(
      `Teach ${scroll.name}`,
      (unit) => teachScrollBlock(this.run, unit, scroll, this.gameData.skills),
      (unit) => {
        const result = teachRosterScroll(this.run, unit, scroll, this.gameData.skills);
        if (result.ok)
          this.render(
            `${unit.name} learned ${this.gameData.skills.find((s) => s.id === scroll.skillId)?.name || scroll.skillId}.`,
          );
        return result;
      },
      (unit) => `${unit.className} · ${unit.skills.length}/${MAX_SKILLS} skills`,
    );
  }
  changeClass(unit, item) {
    if (this.picker || this.destroyed) return;
    const choices =
      item.effect === 'promote'
        ? resolvePromotionTargets(unit, this.gameData.classes, this.gameData.lords)
        : getReclassTargets(unit, this.gameData.classes, item.subEffect);
    this.picker = new ChoicePicker({
      scene: this.scene,
      title: `${item.effect === 'promote' ? 'Promote' : 'Reclass'} ${unit.name}`,
      choices,
      label: (choice) => choice.name,
      describe: (choice) => choice.description || choice.roleChange || choice.role || '',
      preview: (choice) => classChangePreview(unit, item, choice, this.gameData),
      blocked: () => rosterClassChangeBlock(this.run, unit, item, this.gameData),
      apply: (choice) => {
        const result = applyRosterClassChange(this.run, unit, item, choice, this.gameData);
        if (result.ok) {
          const dropped = getSkillDisplayNames(result.droppedSkills, this.gameData.skills);
          this.scene.registry
            .get('audio')
            ?.playSFX(item.effect === 'promote' ? 'sfx_levelup' : 'sfx_confirm');
          this.render(
            `${unit.name} is now ${choice.name}. ${(result.notices || []).join(' ')}${dropped.length ? ` Skill limit: couldn't learn ${dropped.join(', ')}.` : ''}`,
          );
        }
        return result;
      },
      onClose: () => {
        this.picker = null;
        this.root.querySelector('button')?.focus();
      },
    });
  }
  itemDescription(item, unit) {
    if (item.type === 'Consumable')
      return `${getConsumableDescription(item)} · ${formatUses(item)}`;
    if (item.type === 'Staff') {
      const range = getEffectiveStaffRange(item, unit);
      return `Staff · Range ${range.min === range.max ? range.max : `${range.min}–${range.max}`} · Uses ${getStaffRemainingUses(item, unit)}/${getStaffMaxUses(item, unit)}`;
    }
    return `${item.type} · Might ${item.might ?? '—'} · Hit ${item.hit ?? '—'} · Crit ${item.crit ?? '—'} · Weight ${item.weight ?? '—'} · Range ${item.range ?? '—'}`;
  }
  itemCard(item, unit) {
    const forge = getForgeDisplayInfo(item);
    const forgeLevel = forge.level;
    const displayName = forgeLevel
      ? `${forge.baseName.replace(/\s\+\d+$/, '')} +${forgeLevel}`
      : item.name;
    const c = this.card(displayName, this.itemDescription(item, unit));
    if (Object.values(forge.bonuses).some(Boolean))
      c.append(
        el(
          'p',
          `Forge: ${Object.entries(forge.bonuses)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k} ${v > 0 ? '+' : ''}${v}`)
            .join(' · ')}`,
        ),
      );
    const imbue = getImbueDisplayInfo(item, this.gameData.imbues);
    if (imbue) c.append(el('p', `${imbue.name}: ${imbue.description}`));
    if (item === unit.weapon) c.append(el('p', 'Equipped', 'mr-equipped'));
    if (item.special) c.append(el('p', item.special));
    if (item.description) c.append(el('p', item.description));
    appendItemArtDetails(c, item, this.gameData.weaponArts?.arts || []);
    if (item.lore) {
      const d = el('details');
      d.append(el('summary', 'About this item'), el('p', item.lore));
      c.append(d);
    }
    return c;
  }
  action(card, label, unit, item, action) {
    const reason = rosterItemBlock(this.run, unit, item, action);
    card.append(
      this.button(
        label,
        () => {
          if (action === 'use' && item.effect === 'statBoost') {
            this.useBooster(unit, item);
            return;
          }
          const result = rosterItemAction(this.run, unit, item, action);
          if (!result && ['heal', 'healFull', 'cureHeal'].includes(item.effect))
            this.scene.registry.get('audio')?.playSFX('sfx_heal');
          this.render(result || `${label}: ${item.name}${saveServiceRun(this.scene)}`);
        },
        reason,
      ),
    );
    if (reason) card.append(el('small', reason));
  }
  useBooster(unit, item) {
    if (this.picker || this.destroyed) return;
    this.picker = new ChoicePicker({
      scene: this.scene,
      title: `Use ${item.name}?`,
      choices: [item],
      confirmation: true,
      closeLabel: 'Cancel',
      label: () =>
        `${unit.name} · ${item.stat} ${unit.stats[item.stat]} → ${unit.stats[item.stat] + item.value}`,
      describe: () =>
        `Permanently increases ${item.stat} by ${item.value}. Consumes one use of ${item.name}.`,
      blocked: () => rosterItemBlock(this.run, unit, item, 'use'),
      apply: () => {
        const reason = rosterItemAction(this.run, unit, item, 'use');
        if (reason) return { ok: false, reason };
        const warning = saveServiceRun(this.scene);
        this.render(`${unit.name}: +${item.value} ${item.stat} from ${item.name}.${warning}`);
        return { ok: true };
      },
      onClose: () => {
        this.picker = null;
        if (!this.destroyed) this.root.querySelector('button')?.focus();
      },
    });
  }
  gear(unit) {
    this.body.append(el('h3', `Equipment · ${unit.inventory?.length || 0}/5`));
    for (const item of unit.inventory || []) {
      const c = this.itemCard(item, unit);
      if (
        unit.weapon &&
        item !== unit.weapon &&
        item.type === unit.weapon.type &&
        item.type !== 'Staff'
      ) {
        c.append(
          el(
            'p',
            `Compared with ${unit.weapon.name}: ` +
              ['might', 'hit', 'crit', 'weight']
                .map(
                  (k) =>
                    `${k} ${Number(item[k] || 0) - Number(unit.weapon[k] || 0) >= 0 ? '+' : ''}${Number(item[k] || 0) - Number(unit.weapon[k] || 0)}`,
                )
                .join(' · '),
          ),
        );
      }
      if (this.run) {
        if (unit.weapon !== item) this.action(c, 'Equip', unit, item, 'equip');
        c.append(this.button('Give…', () => this.giveItem(unit, item)));
        this.action(c, 'Store', unit, item, 'store');
      }
    }
    if (!unit.inventory?.length)
      this.card('No equipment', 'This unit is not carrying any weapons.');
    this.body.append(
      el('h3', `Consumables · ${unit.consumables?.length || 0}/3`, 'mr-gear-section'),
    );
    for (const item of unit.consumables || []) {
      const c = this.itemCard(item, unit);
      if (this.run) {
        if (['heal', 'healFull', 'cure', 'cureHeal', 'statBoost'].includes(item.effect))
          this.action(c, 'Use', unit, item, 'use');
        if (['promote', 'reclass'].includes(item.effect)) {
          const reason = rosterClassChangeBlock(this.run, unit, item, this.gameData);
          c.append(
            this.button(
              item.effect === 'promote' ? 'Promote' : 'Reclass',
              () => this.changeClass(unit, item),
              reason,
            ),
          );
          if (reason) c.append(el('small', reason));
        }
        c.append(this.button('Give…', () => this.giveItem(unit, item)));
        this.action(c, 'Store', unit, item, 'store');
      }
    }
    if (!unit.consumables?.length)
      this.card('No consumables', 'Withdraw supplies from the convoy between battles.');
    this.body.append(
      el('h3', `Accessories · ${unit.accessory ? 1 : 0}/1 equipped`, 'mr-gear-section'),
    );
    const a = this.card(
      'Equipped accessory',
      unit.accessory
        ? `${unit.accessory.name} · ${formatAccessoryDetail(unit.accessory)}`
        : 'No accessory equipped.',
    );
    if (this.run) {
      if (unit.accessory)
        a.append(
          this.button('Unequip accessory', () =>
            this.render(rosterAccessoryAction(this.run, unit) || 'Accessory returned to the pool.'),
          ),
        );
      if (this.run.accessories?.length)
        this.body.append(el('h4', 'Available accessories · Shared pool'));
      for (const item of this.run.accessories || []) {
        const c = this.card(item.name, formatAccessoryDetail(item));
        c.append(
          this.button('Equip accessory', () =>
            this.render(rosterAccessoryAction(this.run, unit, item) || `${item.name} equipped.`),
          ),
        );
      }
    }
  }
  convoy(unit) {
    const items = this.run.getConvoyItems();
    const counts = this.run.getConvoyCounts();
    const caps = this.run.getConvoyCapacities();
    this.card(
      'Shared convoy',
      `Weapons ${counts.weapons}/${caps.weapons} · Consumables ${counts.consumables}/${caps.consumables}`,
    );
    if (!unit) {
      this.card('No recipient', 'A roster unit is needed to withdraw items.');
      return;
    }
    this.body.append(
      this.button(`Withdraw to: ${unit.name}`, () =>
        this.chooseUnit(
          'Convoy recipient',
          () => '',
          (target) => {
            this.index = this.units.indexOf(target);
            this.render();
            return { ok: true };
          },
        ),
      ),
    );
    for (const item of [...items.weapons, ...items.consumables]) {
      const c = this.itemCard(item, unit);
      this.action(c, 'Withdraw', unit, item, 'withdraw');
    }
    if (!items.weapons.length && !items.consumables.length)
      this.card('Convoy is empty', 'Store carried items here to share them with your roster.');
  }
  showHelp(title, paragraphs) {
    if (this.help || this.picker || this.destroyed) return;
    this.help = new ContextHelp(this.scene, this.root, title, paragraphs, () => {
      this.help = null;
    });
  }
  destroy() {
    this.help?.destroy();
    this.help = null;
    this.picker?.destroy();
    this.picker = null;
    if (this.destroyed) return;
    this.destroyed = true;
    popInputScope(this);
    this.scene.events.off('shutdown', this.shutdown);
    this.root.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
}
