import { skipsClassProgression } from '../engine/SpecialCharacterPolicy.js';
import { saveServiceRun } from './serviceSave.js';
import { skillScrollText, weaponArtScrollText } from './weaponArtDisplay.js';
import { appendItemArtDetails } from './ItemArtDetails.js';
import { itemUsageText } from '../engine/ItemUsage.js';
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
import { ContextHelp, helpPreview } from './ContextHelp.js';
import {
  attributesHelp,
  combatBaselineHelp,
  convoyHelp,
  DEEDS_HELP,
  SCROLLS_HELP,
  WEAPON_ARTS_HELP,
} from './helpTopics.js';
import { attachInfo, holdTip } from './infoAffordance.js';
import { getForgeDisplayInfo } from '../engine/ForgeSystem.js';
import { getImbueDisplayInfo } from '../engine/ImbueSystem.js';
import { getEffectiveStaffRange } from '../engine/Combat.js';
import {
  getMasteryProgress,
  getMasteryThreshold,
  isMastered,
  getMasteryPerk,
} from '../engine/MasterySystem.js';
import { traitLines } from './traitContent.js';
import { calculateAvoid } from '../engine/Combat.js';
import { rosterArtBlock, bindRosterArt } from '../engine/RosterArtCommands.js';
import { CONSUMABLE_MAX, INVENTORY_MAX, MAX_SKILLS, XP_PER_LEVEL } from '../utils/constants.js';
import { teachScrollBlock, teachRosterScroll } from '../engine/RosterTransfers.js';
import {
  CONVOY_HOLDER,
  applyReorder,
  applyTrade,
  bagCapacity,
  bagItems,
  planReorder,
  planTrade,
  unitHolder,
} from '../engine/ItemTrade.js';
import { TradeMenu } from './TradeMenu.js';
import { commitMessage, reorderMessage, tradeWarningText } from './tradeMenuModel.js';
import {
  partnerHolder,
  partnerLabel,
  rosterTradePartners,
  tradeBagFor,
  tradePartnerItemText,
  tradePartnerText,
} from './rosterTradeChoices.js';
import {
  benchedSkillsNote,
  benchedSkillsOf,
  inventoryDisplayOrder,
} from '../engine/UnitManager.js';
import { equippedBadgeElement } from './equippedBadge.js';
import { weaponComparisonParts } from './equipmentComparison.js';
import { itemKeywordRow } from './itemKeywordChips.js';
import { itemKeywords, itemBaseLine } from '../engine/ItemKeywords.js';
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
import { growthsCard } from './growthsCard.js';
import { crestElement } from './crestArt.js';
import { PromotionPathChooser } from './PromotionPathChooser.js';
import { promotionPathContent, projectUnit } from './growthContent.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import {
  chooseTitle,
  deedsForDisplay,
  deedTallyText,
  epithetText,
  oathOptionsInOrder,
  pledgeOath,
  promotionOathCandidates,
  TITLE_NONE,
  unitDisplayName,
} from '../engine/DeedSystem.js';
import {
  benchSkill,
  benchSkillBlock,
  equipSkill,
  lockedSkillIds,
  markBenchSeen,
  unseenBenchedSkills,
} from '../engine/SkillLoadout.js';
import { actLabel } from './ceremonyContent.js';
import { fitText } from './ceremonyDom.js';
import { createHealthBar } from './healthBar.js';
import { STAT_COLORS, UI_PALETTE } from '../utils/uiStyles.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import {
  rosterItemAction,
  rosterItemBlock,
  rosterItemWarnings,
  rosterAccessoryAction,
} from '../engine/RosterInventory.js';
import { getStaffRemainingUses, getStaffMaxUses } from '../engine/Combat.js';
import { getConsumableDescription, formatUses } from '../utils/consumableText.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { pushInputScope, popInputScope, hasInputFocus } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import { hasDOMHost, DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { unitTemperament } from './unitVoiceDisplay.js';
import { itemIcon, itemHero } from './itemIcons.js';
import { LEVEL_UP_CUE_WAIT_MS, playCue } from './ceremonyMusic.js';
import { portraitListLayout, watchPortraitListLayout } from './portraitListLayout.js';
import { orderedStatKeys } from './statOrder.js';

// Movement between pointerdown and click that still counts as a tap, for touch
// and pen. Mice hold a line far tighter, so they keep the original 10px.
const DRAG_SLOP_TOUCH = 24;

export function canShowMobileRoster() {
  return hasDOMHost();
}
// Scroll the portrait unit strip just enough to show the selected card whole.
function revealInStrip(strip, card) {
  if (!card) return;
  const fade = 28; // the strip's right padding, under its fade-out edge
  const box = strip.getBoundingClientRect();
  const rect = card.getBoundingClientRect();
  const left = rect.left - box.left - strip.clientLeft + strip.scrollLeft;
  const right = left + rect.width;
  if (left < strip.scrollLeft) strip.scrollLeft = left;
  else if (right > strip.scrollLeft + strip.clientWidth - fade)
    strip.scrollLeft = right - strip.clientWidth + fade;
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
    persist = null,
    tips = true,
  }) {
    Object.assign(this, {
      tips,
      persist,
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
    // Opening a unit's Skills (between battles) is seeing its bench: the news clears
    // before the list and pip are drawn, and saves. The tab still marks what was new.
    const shown = this.units?.[this.index];
    if (this.tab === 'skills' && this.run && shown) {
      const fresh = unseenBenchedSkills(shown);
      if (fresh.length) this._freshBench = { unit: shown, ids: new Set(fresh) };
      if (markBenchSeen(shown)) this.persistNow();
    }
    const oldScroll = this.root.querySelector('.mr-content')?.scrollTop || 0;
    // Upright, the unit list is a sideways strip; keep its position across renders.
    const oldStrip = this.root.querySelector('.mr-units')?.scrollLeft || 0;
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
      info.append(nameRow);
      const epithet = epithetText(unit);
      if (epithet) {
        const line = el('span', epithet, 're-epithet mr-unit-epithet');
        line.title = unitDisplayName(unit, { epithet: true });
        info.append(line);
      }
      // Class on its own line (ellipsized, full name in the label); HP numbers ride
      // the health bar so neither wraps in the narrow list column.
      const classLine = el('span', unit.className, 'mr-unit-class');
      classLine.title = unit.className;
      const hpRow = el('span', null, 'mr-unit-hp');
      hpRow.append(createHealthBar(unit), el('small', `${unit.currentHP}/${unit.stats.HP}`));
      info.append(classLine, hpRow);
      // A skill that arrived with every slot full waits on the bench: the list says so
      // until the player has seen it on Skills.
      const benchNews = Boolean(this.run && unseenBenchedSkills(unit).length);
      if (benchNews) info.append(el('span', 'New skill benched', 'mr-unit-flag'));
      b.setAttribute(
        'aria-label',
        `${unit.name}, Level ${getDisplayLevel(unit)} ${unit.className}, HP ${unit.currentHP} of ${unit.stats.HP}${benchNews ? ', new skill benched' : ''}`,
      );
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
      const name = el('h3', unit.name);
      const crest = crestElement(unit.className, { className: 'mr-crest', label: true });
      if (crest) name.prepend(crest);
      summary.append(name);
      const epithet = epithetText(unit);
      if (epithet) {
        const line = el('p', epithet, 're-epithet mr-epithet');
        line.setAttribute('aria-label', `Known as ${unitDisplayName(unit, { epithet: true })}`);
        summary.append(line);
        queueMicrotask(() => fitText(line, { min: 11 }));
      }
      summary.append(
        el(
          'p',
          `Lv ${getDisplayLevel(unit)} ${unit.className} · ${unit.tier === 'promoted' ? 'Promoted' : 'Base'} · XP ${unit.xp || 0}/${XP_PER_LEVEL} · HP ${unit.currentHP}/${unit.stats.HP}`,
        ),
      );
      summary.append(createHealthBar(unit));
      body.append(summary);
      for (const id of unit.affixes || []) {
        const affix = this.gameData.affixes?.affixes?.find((a) => a.id === id);
        this.card(affix?.name || id, affix?.description || '');
      }

      this.benchCallout(unit);
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
    nav.scrollLeft = oldStrip;
    if (portraitListLayout()) revealInStrip(nav, nav.querySelector('[aria-pressed="true"]'));
    if (focusKey)
      (this.root.querySelector(`[data-focus-key="${focusKey}"]`) || this.root).focus({
        preventScroll: true,
      });
  }
  card(title, description = '', item = null, { keys = null } = {}) {
    const c = el('article', null, 'mr-card');
    if (item) {
      // Item cards lead with the item's socketed icon, then what it is and its rules.
      c.classList.add('mr-item-card');
      const head = el('div', null, 'mr-card-head');
      head.append(itemIcon(item, { size: 32 }), el('h4', title));
      c.append(head);
      if (keys) c.append(keys);
    } else c.append(el('h4', title));
    if (description) c.append(el('p', description));
    this.body.append(c);
    return c;
  }
  /** Re-render the stats tab if the phone turns while it is open (its order follows the columns). */
  watchStatOrder(twoColumn) {
    this.statOrderTwoColumn = twoColumn;
    this.stopStatOrderWatch ||= watchPortraitListLayout((now) => {
      if (this.destroyed || this.tab !== 'stats' || now === this.statOrderTwoColumn) return;
      this.render();
    });
  }
  stats(unit) {
    if (unit.specialCharId) {
      const def = this.gameData.specialChars?.find((entry) => entry.id === unit.specialCharId);
      this.card('Biography', def?.bio || '');
    }
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
    // Two pairs per row upright (the portrait .mr-stats rule), three in landscape.
    const twoColumn = portraitListLayout();
    grid.dataset.statOrder = twoColumn ? 'two-column' : 'fe';
    this.watchStatOrder(twoColumn);
    for (const key of orderedStatKeys(unit.stats, { twoColumn })) {
      const value = unit.stats[key];
      const valueText = el('dd', String(value));
      valueText.style.color = STAT_COLORS[key] || UI_PALETTE.text;
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
    this.explain(
      grid,
      'attributes',
      'Attributes',
      attributesHelp(),
      'What each attribute does in combat and on the map.',
    );
    this.card(
      'Proficiencies',
      (unit.proficiencies || []).map(proficiencyLabel).join(' · ') || 'None',
    );
    const combat = getStaticCombatStats(unit, unit.weapon);
    const avoid = terrain ? calculateAvoid(unit, terrain) : unit.stats.SPD * 2 + unit.stats.LCK;
    const combatCard = this.card(
      'Combat baseline',
      `Atk ${combat.atk} · AS ${combat.as} · Hit ${combat.hit} · Avo ${avoid} · Crit ${combat.crit} · Wt ${combat.weight}`,
    );
    this.explain(
      combatCard,
      'combat numbers',
      'Combat baseline',
      combatBaselineHelp(unit, { avoid, onTile: Boolean(terrain) }),
      'Baseline Attack, speed and ratings before a specific enemy, terrain or skills are applied.',
    );
    if (terrain)
      this.card(
        `Terrain: ${terrain.name}`,
        unit.moveType === 'Flying'
          ? 'Flying — no terrain defense or avoid bonus.'
          : `Defense +${parseInt(terrain.defBonus) || 0} · Avoid +${parseInt(terrain.avoidBonus) || 0}`,
      );
    if (unit.faction !== 'enemy' && !skipsClassProgression(unit)) {
      const mastered = isMastered(unit, this.gameData.classes, this.gameData.traits);
      const perk = getMasteryPerk(unit, this.gameData.classes, this.gameData.traits);
      const progress = getMasteryProgress(unit, this.gameData.classes);
      const threshold = getMasteryThreshold(unit, this.gameData.traits);
      const reward = perk ? `${perk.name} · ${formatPerkMods(perk.mods)}` : 'No class perk';
      const mastery = this.card(
        mastered ? 'Class mastered ★' : 'Class mastery',
        `${progress} / ${threshold} battles · ${mastered ? 'Active' : 'Unlock'}: ${reward}`,
      );
      this.explain(
        mastery,
        'class mastery',
        'Class mastery',
        [
          {
            stats: [
              { label: 'Battles', value: `${progress}/${threshold}` },
              {
                label: mastered ? 'Perk active' : 'Unlocks',
                value: perk?.name || 'None',
                note: perk ? formatPerkMods(perk.mods) : '',
                text: true,
              },
            ],
          },
          ...MASTERY_HELP.slice(1),
          {
            tip: 'Weapon ranks (Proficient, Master) come from the class, not from weapon use.',
          },
        ],
        helpPreview(MASTERY_HELP),
      );
    }
    if (unit.faction !== 'enemy') {
      const traits = traitLines(unit, this.gameData);
      if (traits.length) this.body.append(el('h3', 'Traits', 'mr-section'));
      for (const trait of traits)
        this.card(
          `${trait.legendary ? 'Legendary · ' : trait.special ? 'Special · ' : ''}${trait.name}`,
          trait.text,
        );
      // Flavor only: how this recruit talks (level-ups, promotion, last words).
      const temperament = unit.isLord ? null : unitTemperament(this.scene, unit);
      if (temperament)
        this.card(
          `Temperament · ${temperament}`,
          'Colors what they say when they grow, promote or fall. No effect in battle.',
        ).classList.add('mr-flavor');
      // Who they are (traits, temperament), then what they have done.
      if (unit.faction === 'player') this.deeds(unit);
    }
    if (unit.growths && unit.faction !== 'enemy') this.body.append(growthsCard(unit.growths));
  }
  // Deeds & Epithets: the titles this unit earned, the title first, then newest, with the
  // run's tallies and its Oath. Between battles the player picks the title the unit goes
  // by and, before promotion, which deed's Oath it will swear (saved at once).
  deeds(unit) {
    const list = deedsForDisplay(unit, this.gameData.deeds);
    const heading = el('h3', list.length ? `Deeds · ${list.length}` : 'Deeds');
    this.body.append(heading);
    if (list.length) this.explain(heading, 'deeds', 'Deeds', DEEDS_HELP);
    const tally = deedTallyText(unit);
    if (tally) this.body.append(el('p', `This march: ${tally}`, 'mr-deed-tally'));
    const skillText = (id) => {
      const skill = this.gameData.skills?.find((s) => s.id === id);
      return `${skill?.name || id}${skill?.description ? ` — ${skill.description}` : ''}`;
    };
    // Choices are run state: only the manage view (between battles) makes them.
    const manage = Boolean(this.run?.roster?.includes(unit));
    const choose = (change, done) => {
      if (!change()) return;
      this.render(`${done}${this.persistNow()}`);
    };
    const sworn = unit.deeds?.oath;
    if (sworn?.skillId)
      this.card(
        `${sworn.name || 'Oath'} · sworn${benchedSkillsOf(unit).includes(sworn.skillId) ? ' · on the bench' : ''}`,
        skillText(sworn.skillId),
      );
    else if (unit.tier !== 'promoted') {
      const options = promotionOathCandidates(unit, this.gameData.deeds, this.gameData.skills);
      if (options.length === 1)
        this.card(`${options[0].name} · sworn at promotion`, skillText(options[0].skillId));
      else if (options.length > 1) {
        // One Oath per unit: the player picks which deed it swears on.
        const card = this.card(
          'Oath at promotion',
          'Choose the deed this unit swears on. Only one Oath, ever.',
        );
        card.classList.add('mr-oath-choice');
        // A stable order (greatest first); the one it will swear is marked.
        for (const option of oathOptionsInOrder(options)) {
          const chosen = option.deedId === options[0].deedId;
          const b = manage
            ? this.button(`${option.name} · ${option.skillName}`, () =>
                choose(
                  () => pledgeOath(unit, option.deedId),
                  `${unit.name} will swear ${option.name}.`,
                ),
              )
            : el('p', `${option.name} · ${option.skillName}`);
          b.classList.add('mr-oath-option');
          if (manage) b.setAttribute('aria-pressed', String(chosen));
          else if (chosen) b.classList.add('is-chosen');
          if (option.skillDescription) b.title = option.skillDescription;
          card.append(b);
        }
        card.append(el('p', skillText(options[0].skillId), 'mr-deed-meta'));
      }
    }
    if (!list.length) {
      this.card('No deeds yet', 'Titles come from what a unit does in battle, not from a list.');
      return;
    }
    const chosenTitle = unit.deeds?.chosenTitle ?? null;
    if (manage) {
      const mode = el(
        'p',
        chosenTitle === TITLE_NONE
          ? 'Title: none. Goes by name alone.'
          : chosenTitle
            ? 'Title: chosen by you.'
            : 'Title: the greatest deed (automatic).',
        'mr-deed-mode',
      );
      if (chosenTitle)
        mode.append(
          this.button('Greatest deed', () =>
            choose(
              () => chooseTitle(unit, null),
              `${unit.name}'s title follows the greatest deed.`,
            ),
          ),
        );
      if (chosenTitle !== TITLE_NONE)
        mode.append(
          this.button('No title', () =>
            choose(() => chooseTitle(unit, TITLE_NONE), `${unit.name} goes by name alone.`),
          ),
        );
      this.body.append(mode);
    }
    for (const deed of list) {
      const card = el('article', null, `mr-card mr-deed${deed.isTitle ? ' is-title' : ''}`);
      const head = el('h4', deed.name);
      if (deed.isTitle) head.append(el('small', 'Title'));
      card.append(head, el('p', deed.epithet, 're-epithet'));
      if (deed.lore) card.append(el('p', deed.lore, 'mr-deed-lore'));
      const at = deed.awardedAt || {};
      const meta = [actLabel(at.act), Number.isFinite(at.battle) ? `Battle ${at.battle}` : '']
        .filter(Boolean)
        .join(' · ');
      if (meta) card.append(el('p', meta, 'mr-deed-meta'));
      if (manage && !deed.isTitle)
        card.append(
          this.button('Use as title', () =>
            choose(() => chooseTitle(unit, deed.id), `${unit.name} now goes by ${deed.epithet}.`),
          ),
        );
      this.body.append(card);
    }
  }
  /**
   * A skill that arrived with every slot full is on the unit's bench: until the
   * player has looked at Skills, the top of the pane says so on every other tab and
   * takes them there. The first time a save meets one, it also says what the bench
   * is (playtest 2026-09-28: skills used to be lost at the cap).
   */
  benchCallout(unit) {
    if (!this.run || this.tab === 'skills') return;
    const fresh = unseenBenchedSkills(unit);
    if (!fresh.length) return;
    const names = fresh.map((id) => this.gameData.skills?.find((sk) => sk.id === id)?.name || id);
    const box = el('aside', null, 'mr-callout mr-bench-callout');
    box.setAttribute('aria-label', `${unit.name} has a new skill on the bench`);
    box.append(
      el('h4', `New on ${unit.name}'s bench: ${names.join(', ')}`),
      el(
        'p',
        `It arrived with all ${MAX_SKILLS} skill slots full, so it waits on the bench. Swap it in on Skills.`,
      ),
    );
    // Told once per save; it stays up for as long as this sheet is open.
    const hints = this.scene?.registry?.get?.('hints');
    if (this._benchLesson === undefined)
      this._benchLesson = Boolean(hints?.shouldShow?.('roster_skill_benched'));
    if (this._benchLesson)
      box.append(
        el(
          'p',
          'New: a unit keeps every skill it learns. Only five go into battle; the rest wait on its bench, and you can swap them between battles. Personal and class skills can’t be benched.',
          'mr-callout-lesson',
        ),
      );
    box.append(
      this.button('Go to Skills', () => {
        this.tab = 'skills';
        this.render();
        this.root.querySelector('.mr-bench-new button')?.focus({ preventScroll: true });
      }),
    );
    this.body.append(box);
  }
  /** One skill's card text: its kind and what it does. */
  skillLine(id) {
    const skill = this.gameData.skills?.find((s) => s.id === id);
    return `${skill?.trigger === 'passive-aura' ? 'Passive aura · ' : skill?.trigger === 'passive' ? 'Passive · ' : ''}${skill?.description || ''}`;
  }
  skillName(id) {
    return this.gameData.skills?.find((s) => s.id === id)?.name || id;
  }
  /**
   * Equip a benched skill; with every slot full the player picks the skill it
   * replaces (that one goes to the bench).
   */
  swapInSkill(unit, id) {
    if (this.picker || this.destroyed) return;
    if ((unit.skills?.length || 0) < MAX_SKILLS) {
      const reason = equipSkill(unit, id, null, this.gameData);
      this.render(reason || `${this.skillName(id)} equipped.${this.persistNow()}`);
      return;
    }
    const locked = lockedSkillIds(unit, this.gameData);
    let message = '';
    this.picker = new ChoicePicker({
      scene: this.scene,
      title: `Equip ${this.skillName(id)} in place of`,
      choices: [...unit.skills],
      closeLabel: 'Cancel',
      label: (out) => this.skillName(out),
      describe: (out) => this.skillLine(out),
      blocked: (out) => (locked.has(out) ? benchSkillBlock(unit, out, this.gameData) : ''),
      apply: (out) => {
        const reason = equipSkill(unit, id, out, this.gameData);
        if (reason) return { ok: false, reason };
        message = `${this.skillName(id)} in, ${this.skillName(out)} to the bench.${this.persistNow()}`;
        return { ok: true };
      },
      onClose: () => {
        this.picker = null;
        if (!this.destroyed) this.render(message);
      },
    });
  }
  skills(unit) {
    // Marked new until the player leaves this unit's Skills (render clears the news).
    const fresh = this._freshBench?.unit === unit ? this._freshBench.ids : new Set();
    // Loadout choices are run state: only the manage view (between battles) makes them.
    const manage = Boolean(this.run?.roster?.includes(unit));
    const locked = lockedSkillIds(unit, this.gameData);
    this.body.append(el('h3', `Equipped · ${unit.skills?.length || 0}/${MAX_SKILLS}`));
    for (const id of unit.skills || []) {
      const c = this.card(this.skillName(id), this.skillLine(id));
      if (!manage) continue;
      if (locked.has(id))
        c.append(el('small', benchSkillBlock(unit, id, this.gameData), 'mr-skill-locked'));
      else
        c.append(
          this.button('Bench', () =>
            this.render(
              benchSkill(unit, id, this.gameData) ||
                `${this.skillName(id)} to the bench.${this.persistNow()}`,
            ),
          ),
        );
    }
    if (!(unit.skills || []).length) this.card('Skills', 'No skills learned yet.');
    const bench = benchedSkillsOf(unit);
    if (bench.length || manage) {
      this.body.append(el('h3', `Bench · ${bench.length}`, 'mr-section'));
      if (!bench.length)
        this.card(
          'Bench is empty',
          `Skills learned with all ${MAX_SKILLS} slots full wait here, never lost. Bench a skill to make room for another.`,
        );
    }
    for (const id of bench) {
      const c = this.card(this.skillName(id), this.skillLine(id));
      if (fresh.has(id)) {
        c.classList.add('mr-bench-new');
        c.querySelector('h4')?.append(el('small', 'New', 'mr-new-tag'));
      }
      if (!manage) continue;
      const full = (unit.skills?.length || 0) >= MAX_SKILLS;
      c.append(this.button(full ? 'Swap in…' : 'Equip', () => this.swapInSkill(unit, id)));
    }
    const artsHeading = el('h3', 'Weapon arts', 'mr-section');
    this.body.append(artsHeading);
    let count = 0;
    for (const weapon of inventoryDisplayOrder(unit)) {
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
    if (count) this.explain(artsHeading, 'weapon arts', 'Weapon arts', WEAPON_ARTS_HELP);
    if (!count) this.card('No weapon arts', 'No arts bound to carried weapons.');
    if (this.run) {
      const scrolls = this.run.scrolls || [];
      const heading = el('h3', `Team scrolls · ${scrolls.length}`);
      this.body.append(heading);
      if (scrolls.length) this.explain(heading, 'scrolls', 'Scrolls', SCROLLS_HELP);
      // Skill scrolls, then art scrolls, each under its own name: Blink is a skill.
      const groups = [
        ['Skill scrolls', scrolls.filter((s) => !s.teachesWeaponArtId)],
        ['Weapon art scrolls', scrolls.filter((s) => s.teachesWeaponArtId)],
      ];
      for (const [title, list] of groups) {
        if (!list.length) continue;
        this.body.append(el('h4', `${title} · ${list.length}`, 'mr-scroll-group'));
        for (const scroll of list) {
          const card = this.card(
            scroll.name,
            scroll.teachesWeaponArtId
              ? weaponArtScrollText(scroll, this.gameData.weaponArts?.arts || [])
              : skillScrollText(scroll, this.gameData.skills),
            scroll,
          );
          card.classList.add('mr-scroll-description');
          this.aboutItem(card, scroll);
          if (!scroll.teachesWeaponArtId)
            card.append(this.button('Teach…', () => this.teachScroll(scroll)));
          else card.append(this.button('Bind to weapon…', () => this.bindArt(scroll)));
        }
      }
    }
  }
  bindArt(scroll) {
    if (this.picker || this.destroyed) return;
    const arts = this.gameData.weaponArts?.arts || [];
    const choices = this.units.flatMap((unit) =>
      inventoryDisplayOrder(unit)
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
    const flow = {
      weapon: null,
      replacement: null,
      bound: false,
      weaponScroll: 0,
      replacementScroll: 0,
    };
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
          if (scrollKey === 'replacementScroll') flow.replacement = this.picker?.selected;
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
    const bind = (unit, weapon, replacement = null) => {
      const result = bindRosterArt(this.run, unit, weapon, scroll, arts, replacement);
      if (result.ok) {
        flow.bound = true;
        this.render(`${scroll.name} bound to ${weapon.name}.${this.persistNow()}`);
      }
      return result;
    };
    const showReplacement = () => {
      const { unit, weapon } = flow.weapon;
      const bindings = getWeaponArtBindings(weapon).map((entry, index) => ({ ...entry, index }));
      const previous = flow.replacement;
      openStep(
        {
          title: 'Choose art to replace',
          confirmLabel: 'Replace',
          choices: bindings,
          initialChoice: bindings.find(
            (b) =>
              b.index === previous?.index && b.id === previous.id && b.source === previous.source,
          ),
          label: (b) => arts.find((a) => a.id === b.id)?.name || b.id,
          describe: (b) =>
            `Slot ${b.index + 1} · ${sourceLabel(b.source)}. Uses one ${scroll.name} on Replace. Back uses nothing.`,
          preview: (b) =>
            `REMOVE\n${artDescription(b.id, unit)}\n\nADD\n${artDescription(scroll.teachesWeaponArtId?.trim(), unit)}`,
          blocked: () => rosterArtBlock(this.run, unit, weapon, scroll, arts),
          apply: (choice) => {
            flow.replacement = choice;
            return bind(unit, weapon, choice);
          },
        },
        () => this.root.querySelector('button')?.focus(),
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
          describe: (c) =>
            `${getWeaponArtBindings(c.weapon).length}/3 art slots. ${getWeaponArtBindings(c.weapon).length < 3 ? `Uses one ${scroll.name} on Confirm. Back uses nothing.` : 'Next: choose an art to replace.'}`,
          preview: (c) => artDescription(scroll.teachesWeaponArtId?.trim(), c.unit),
          blocked: (c) => rosterArtBlock(this.run, c.unit, c.weapon, scroll, arts),
          apply: (choice) => {
            if (flow.weapon !== choice) flow.replacement = null;
            flow.weapon = choice;
            return getWeaponArtBindings(choice.weapon).length < 3
              ? bind(choice.unit, choice.weapon)
              : { ok: true };
          },
        },
        () => {
          if (!flow.bound) showReplacement();
          else {
            flow.replacement = null;
            this.root.querySelector('button')?.focus();
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
  tradeCtx() {
    return { context: 'roster', run: this.run };
  }
  /**
   * Choose a trade partner (other units, then the convoy), then run `open(partner)`
   * once the picker is gone. The picker blocks nobody: the trade menu's rows say
   * why a slot is closed.
   */
  chooseTradePartner(title, partners, describe, open) {
    if (this.picker || this.destroyed || !this.run) return;
    let chosen = null;
    this.picker = new ChoicePicker({
      scene: this.scene,
      title,
      choices: partners,
      label: partnerLabel,
      describe,
      confirmLabel: 'Trade',
      apply: (partner) => {
        chosen = partner;
        return { ok: true };
      },
      onClose: () => {
        this.picker = null;
        if (this.destroyed) return;
        if (chosen) open(chosen);
        else this.root.querySelector('button')?.focus();
      },
    });
  }
  /**
   * Trade… on an item card: pick a partner, then trade. Nothing is held on open (a
   * first tap picks the item); the hidden cursor starts on this item's row.
   */
  tradeItem(source, item) {
    const bag = tradeBagFor(item);
    const ctx = this.tradeCtx();
    this.chooseTradePartner(
      `Trade ${item.name} with…`,
      rosterTradePartners(this.units, source, bag),
      (partner) => tradePartnerItemText(ctx, partner, item),
      (partner) =>
        this.openTrade(source, partnerHolder(partner), {
          cursor: { holder: unitHolder(source), bag, item },
          bag,
        }),
    );
  }
  /** Trade with… in the Equipment heading: pick a partner, open with nothing held. */
  tradeWith(unit) {
    const ctx = this.tradeCtx();
    this.chooseTradePartner(
      `${unit.name}: trade with…`,
      rosterTradePartners(this.units, unit),
      (partner) => tradePartnerText(ctx, partner),
      (partner) => this.openTrade(unit, partnerHolder(partner)),
    );
  }
  /**
   * The trade menu over this sheet. It lives in `picker`, so the sheet's guards and
   * destroy() cover it. Each commit or reorder applies at once and saves the run the
   * moment it lands (the context's persist when given); the sheet re-renders on close.
   */
  openTrade(left, right, { cursor = null, bag = null } = {}) {
    if (this.picker || this.destroyed || !this.run) return;
    const ctx = this.tradeCtx();
    let message = '';
    this.picker = new TradeMenu({
      scene: this.scene,
      ctx,
      left,
      right,
      cursor,
      bag,
      engine: { planTrade, planReorder, bagItems, bagCapacity, unitHolder },
      commit: (from, to) => {
        const result = applyTrade(ctx, from, to);
        if (!result.ok) return result;
        const warnings = result.warnings
          .map(tradeWarningText)
          .filter(Boolean)
          .map((text) => ` ${text}.`)
          .join('');
        message = `${commitMessage(from, to, result.kind)}${warnings}${this.persistNow()}`;
        return { ok: true, message };
      },
      // Two items in one unit's bag swap places; a new first weapon is equipped.
      reorder: (from, to) => {
        const result = applyReorder(ctx, from, to);
        if (!result.ok) return result;
        message = `${reorderMessage(from, to, result.equips)}${this.persistNow()}`;
        return { ok: true, message };
      },
      onClose: () => {
        this.picker = null;
        if (!this.destroyed) this.render(message);
      },
    });
  }
  teachScroll(scroll) {
    this.chooseUnit(
      `Teach ${scroll.name}`,
      (unit) => teachScrollBlock(this.run, unit, scroll, this.gameData.skills),
      (unit) => {
        const result = teachRosterScroll(this.run, unit, scroll, this.gameData.skills);
        if (result.ok) {
          const skillName =
            this.gameData.skills.find((s) => s.id === scroll.skillId)?.name || scroll.skillId;
          this.render(
            `${unit.name} learned ${skillName}${result.benched ? ` (on the bench: all ${MAX_SKILLS} slots are full)` : ''}.${this.persistNow()}`,
          );
          growthCeremonies(this.scene)?.showSealed({
            title: `${unit.name} learned ${skillName}`,
            detail: 'New skill',
            skillId: scroll.skillId,
          });
        }
        return result;
      },
      (unit) => `${unit.className} · ${unit.skills.length}/${MAX_SKILLS} skills`,
    );
  }
  /**
   * Save a roster change the moment it applies — before any ceremony, and
   * without waiting for the sheet to close, so closing or killing the app
   * cannot drop it. The menu's context decides how (rewards pass their own
   * persist); otherwise the run is saved directly. Management only exists
   * between battles (in battle the sheet is read-only), so the run is never
   * written mid-fight from here. Returns a notice ('' when saved).
   */
  persistNow() {
    if (!this.run) return '';
    try {
      if (typeof this.persist === 'function')
        return this.persist() === false ? ' Save failed.' : '';
      return saveServiceRun(this.scene);
    } catch (error) {
      console.warn('[MobileRosterSheet] roster save failed:', error);
      return ' Save failed.';
    }
  }
  promoteWithSeal(unit, item) {
    if (this.picker || this.destroyed) return;
    const targets = resolvePromotionTargets(unit, this.gameData.classes, this.gameData.lords);
    let rite = null;
    let message = '';
    this.picker = new PromotionPathChooser({
      scene: this.scene,
      unit,
      targets,
      gameData: this.gameData,
      title: `Promote ${unit.name}`,
      closeLabel: 'Close',
      note: `Uses 1 ${item.name || 'Master Seal'}`,
      blocked: () => rosterClassChangeBlock(this.run, unit, item, this.gameData),
      apply: (choice) => {
        const content = promotionPathContent(unit, choice, this.gameData);
        const before = projectUnit(unit);
        const result = applyRosterClassChange(this.run, unit, item, choice, this.gameData);
        if (!result.ok) return result;
        const dropped = getSkillDisplayNames(result.droppedSkills, this.gameData.skills);
        message = `${unit.name} is now ${choice.name}. ${(result.notices || []).join(' ')}${dropped.length ? ` ${benchedSkillsNote(dropped)}` : ''}${this.persistNow()}`;
        rite = { content, before };
        return result;
      },
      onClose: (choice) => {
        this.picker = null;
        const done = () => {
          if (this.destroyed) return;
          if (choice) this.render(message);
          this.root.querySelector('button')?.focus();
        };
        const growth = choice && rite?.content ? growthCeremonies(this.scene) : null;
        if (!growth) {
          if (choice)
            void playCue(this.scene, 'promotion_crown', {
              fallbackSfx: 'sfx_levelup',
              waitMs: LEVEL_UP_CUE_WAIT_MS,
            });
          done();
          return;
        }
        // Rendered underneath first, so the sheet is current when the rite ends.
        done();
        void growth.showPromotionRite({
          unit,
          content: rite.content,
          beforeUnit: rite.before,
          frame: 'screen',
        });
      },
    });
  }
  changeClass(unit, item) {
    if (this.picker || this.destroyed) return;
    if (item.effect === 'promote') return this.promoteWithSeal(unit, item);
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
          if (item.effect === 'promote')
            void playCue(this.scene, 'promotion_crown', {
              fallbackSfx: 'sfx_levelup',
              waitMs: LEVEL_UP_CUE_WAIT_MS,
            });
          else this.scene.registry.get('audio')?.playSFX('sfx_confirm');
          this.render(
            `${unit.name} is now ${choice.name}. ${(result.notices || []).join(' ')}${dropped.length ? ` ${benchedSkillsNote(dropped)}` : ''}${this.persistNow()}`,
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
    if (item.type === 'Accessory') return formatAccessoryDetail(item);
    if (item.type === 'Consumable')
      return `${getConsumableDescription(item)} · ${formatUses(item)}`;
    if (item.type === 'Staff') {
      const range = getEffectiveStaffRange(item, unit);
      return `Staff · Range ${range.min === range.max ? range.max : `${range.min}–${range.max}`} · Uses ${getStaffRemainingUses(item, unit)}/${getStaffMaxUses(item, unit)}${item.perBattleUses ? ' · Refills after battle' : ''}`;
    }
    // The keyword row above already names the type ("Silver Sword").
    const kind = itemBaseLine(item) ? '' : `${item.type} · `;
    return `${kind}Might ${item.might ?? '—'} · Hit ${item.hit ?? '—'} · Crit ${item.crit ?? '—'} · Weight ${item.weight ?? '—'} · Range ${item.range ?? '—'}`;
  }
  itemCard(item, unit) {
    const forge = getForgeDisplayInfo(item);
    const forgeLevel = forge.level;
    const displayName = forgeLevel
      ? `${forge.baseName.replace(/\s\+\d+$/, '')} +${forgeLevel}`
      : item.name;
    const c = this.card(displayName, this.itemDescription(item, unit), item, {
      keys: itemKeywordRow(item, { displayName }),
    });
    const equipped = !!unit && (item === unit.weapon || item === unit.accessory);
    if (equipped) c.querySelector('h4')?.append(equippedBadgeElement());
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
    // How much this very item has been used ("Used in 14 strikes · 3 kills").
    const usage = itemUsageText(item);
    if (usage) c.append(el('p', usage, 'mr-usage'));
    if (equipped) c.append(el('p', 'Equipped', 'mr-equipped'));
    // A special the tags already state isn't repeated; staves and flavour keep theirs.
    if (item.special && !itemKeywords(item).length) c.append(el('p', item.special));
    if (item.description) c.append(el('p', item.description));
    appendItemArtDetails(c, item, this.gameData.weaponArts?.arts || [], {
      openHelp: (title, blocks) => this.showHelp(title, blocks),
    });
    this.aboutItem(c, item);
    return c;
  }
  // The item's picture beside its story, one tap away (the hero decodes only when opened).
  aboutItem(card, item) {
    if (!item?.lore) return;
    const d = el('details');
    const about = el('div', null, 'mr-about');
    about.append(itemHero(item, { size: 96 }), el('p', item.lore, 'mr-lore'));
    d.append(el('summary', 'About this item'), about);
    card.append(d);
  }
  action(card, label, unit, item, action) {
    const reason = rosterItemBlock(this.run, unit, item, action);
    // An allowed action can still cost something ("Leaves Edric unarmed"): the
    // button carries it as its description and the card says it beside the button.
    const warning = rosterItemWarnings(this.run, unit, item, action)
      .map(tradeWarningText)
      .filter(Boolean)
      .map((text) => `${text}.`)
      .join(' ');
    const b = this.button(
      label,
      () => {
        if (action === 'use' && item.effect === 'statBoost') {
          this.useBooster(unit, item);
          return;
        }
        const result = rosterItemAction(this.run, unit, item, action);
        if (!result && ['heal', 'healFull', 'cureHeal'].includes(item.effect))
          this.scene.registry.get('audio')?.playSFX('sfx_heal');
        this.render(
          result || `${label}: ${item.name}${warning ? `. ${warning}` : ''}${this.persistNow()}`,
        );
      },
      reason,
    );
    card.append(b);
    if (reason) card.append(el('small', reason));
    else if (warning) {
      b.setAttribute('aria-description', warning);
      b.title = warning;
      card.append(el('small', warning, 'mr-warn'));
    }
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
        const warning = this.persistNow();
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
    const heading = el('h3', `Equipment · ${unit.inventory?.length || 0}/5`);
    if (this.run) {
      // Trade with… opens the trade menu with nothing held (after picking a partner).
      const row = el('div', null, 'mr-heading-row');
      row.append(
        heading,
        this.button('Trade with…', () => this.tradeWith(unit)),
      );
      this.body.append(row);
    } else this.body.append(heading);
    for (const item of inventoryDisplayOrder(unit)) {
      const c = this.itemCard(item, unit);
      if (
        unit.weapon &&
        item !== unit.weapon &&
        item.type === unit.weapon.type &&
        item.type !== 'Staff'
      ) {
        // The shop and reward screen compare with the same helper, so all three agree.
        const parts = weaponComparisonParts(unit, item, unit.weapon, {
          arts: this.gameData?.weaponArts?.arts || [],
          imbues: this.gameData?.imbues,
        });
        c.append(el('p', `Compared with ${unit.weapon.name}: ${parts.join(' · ')}`));
      }
      if (this.run) {
        if (unit.weapon !== item) this.action(c, 'Equip', unit, item, 'equip');
        c.append(this.button('Trade…', () => this.tradeItem(unit, item)));
        this.action(c, 'Store', unit, item, 'store');
      }
    }
    if (!unit.inventory?.length)
      this.card(
        'No equipment',
        'Unarmed: this unit cannot attack or counterattack until it carries a weapon.',
      );
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
        c.append(this.button('Trade…', () => this.tradeItem(unit, item)));
        this.action(c, 'Store', unit, item, 'store');
      }
    }
    if (!unit.consumables?.length)
      this.card('No consumables', 'Withdraw supplies from the convoy between battles.');
    this.body.append(
      el('h3', `Accessories · ${unit.accessory ? 1 : 0}/1 equipped`, 'mr-gear-section'),
    );
    // The equipped accessory is an item card like any other: its name, its picture and
    // its story (it used to be a generic "Equipped accessory" card).
    const a = unit.accessory
      ? this.itemCard(unit.accessory, unit)
      : this.card('No accessory', 'No accessory equipped.');
    if (this.run) {
      if (unit.accessory) {
        a.append(
          this.button('Unequip accessory', () =>
            this.render(
              rosterAccessoryAction(this.run, unit) ||
                `Accessory returned to the pool.${this.persistNow()}`,
            ),
          ),
        );
        // Accessories trade only between units (the Accessory tab).
        if (this.units.some((other) => other !== unit))
          a.append(this.button('Trade…', () => this.tradeItem(unit, unit.accessory)));
      }
      if (this.run.accessories?.length)
        this.body.append(el('h4', 'Available accessories · Shared pool'));
      for (const item of this.run.accessories || []) {
        const c = this.itemCard(item, unit);
        c.append(
          this.button('Equip accessory', () =>
            this.render(
              rosterAccessoryAction(this.run, unit, item) ||
                `${item.name} equipped.${this.persistNow()}`,
            ),
          ),
        );
      }
    }
  }
  /** A convoy consumable's Use (or Promote / Reclass) on `unit`, without withdrawing it. */
  convoyUse(card, unit, item) {
    if (['heal', 'healFull', 'cure', 'cureHeal', 'statBoost'].includes(item.effect))
      this.action(card, `Use on ${unit.name}`, unit, item, 'use');
    if (['promote', 'reclass'].includes(item.effect)) {
      const reason = rosterClassChangeBlock(this.run, unit, item, this.gameData);
      card.append(
        this.button(
          `${item.effect === 'promote' ? 'Promote' : 'Reclass'} ${unit.name}`,
          () => this.changeClass(unit, item),
          reason,
        ),
      );
      if (reason) card.append(el('small', reason));
    }
  }
  convoy(unit) {
    const items = this.run.getConvoyItems();
    const counts = this.run.getConvoyCounts();
    const caps = this.run.getConvoyCapacities();
    const shared = this.card(
      'Shared convoy',
      `Weapons ${counts.weapons}/${caps.weapons} · Consumables ${counts.consumables}/${caps.consumables}`,
    );
    // Plain words for new players: what the convoy is and what Store / Withdraw do,
    // with the longer explanation one gesture away (ⓘ / press and hold).
    shared.append(
      el(
        'p',
        'Storage shared by the whole army between battles. Store puts a carried item here; Withdraw gives it to the unit below, or Trade… swaps it when their bag is full. Heals, boosters and seals can be used from here on that unit.',
        'mr-convoy-explain',
      ),
    );
    this.explain(
      shared,
      'the convoy',
      'Convoy',
      convoyHelp({ weapons: INVENTORY_MAX, consumables: CONSUMABLE_MAX }),
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
    // getConvoyItems hands out clones in convoy order; a trade holds the live item.
    const live = [...this.run.convoy.weapons, ...this.run.convoy.consumables];
    [...items.weapons, ...items.consumables].forEach((item, index) => {
      const c = this.itemCard(item, unit);
      // Heals, boosters and seals work straight from the convoy on the unit below.
      if (item.type === 'Consumable') this.convoyUse(c, unit, live[index]);
      const bag = tradeBagFor(item);
      const holder = unitHolder(unit);
      if (
        bagItems(this.tradeCtx(), holder, bag).length < bagCapacity(this.tradeCtx(), holder, bag)
      ) {
        this.action(c, 'Withdraw', unit, item, 'withdraw');
        return;
      }
      // A full bag: Withdraw becomes Trade…, a swap with one of the unit's items.
      c.append(
        this.button('Trade…', () =>
          this.openTrade(unit, CONVOY_HOLDER, {
            cursor: { holder: CONVOY_HOLDER, bag, item: live[index] },
            bag,
          }),
        ),
        el(
          'small',
          `${bag === 'consumables' ? 'Consumables' : 'Equipment'} full: trade to swap it for a carried item.`,
        ),
      );
    });
    if (!items.weapons.length && !items.consumables.length)
      this.card('Convoy is empty', 'Store carried items here to share them with your roster.');
  }
  // Compact explanation: ⓘ in the heading plus press-and-hold on the card.
  explain(target, topic, title, paragraphs, preview = helpPreview(paragraphs)) {
    const card = target.matches('h2, h3, h4') ? null : target;
    const open = () => this.showHelp(title, paragraphs);
    attachInfo(card || target, {
      title: topic,
      heading: card ? undefined : target,
      preview,
      open,
      enabled: () => !this.destroyed && !this.help && !this.picker && hasInputFocus(this),
      decorate: (info) =>
        bindCancelablePress(info, open, {
          enabled: () => !this.destroyed && hasInputFocus(this),
          context: () => `${this.index}:${this.tab}`,
          threshold: (event) => (event.pointerType === 'mouse' ? 10 : DRAG_SLOP_TOUCH),
        }),
    });
    // The one-time hold tip stays for this sheet's lifetime (renders rebuild the body).
    // `tips: false` (the boss reward's details) never shows or spends it.
    if (this.holdTipEl === undefined) this.holdTipEl = this.tips ? holdTip() : null;
    if (this.holdTipEl && !this.holdTipEl.isConnected)
      this.body.querySelector('.mr-summary')?.after(this.holdTipEl);
  }
  showHelp(title, paragraphs) {
    if (this.help || this.picker || this.destroyed) return;
    this.help = new ContextHelp(this.scene, this.root, title, paragraphs, () => {
      this.help = null;
    });
  }
  destroy() {
    this.stopStatOrderWatch?.();
    this.stopStatOrderWatch = null;
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
