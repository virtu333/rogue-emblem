import { forgeImpactLine } from './itemDecisionText.js';
import { equipmentComparison } from './equipmentComparison.js';
import { inventoryDisplayOrder } from '../engine/UnitManager.js';
import { appendItemArtDetails } from './ItemArtDetails.js';
import { formatPerkMods, MASTERY_HELP } from './rosterDisplay.js';
import { ContextHelp, helpPreview } from './ContextHelp.js';
import { attachInfo, bindHold } from './infoAffordance.js';
import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import {
  rewardPresentation,
  rewardIcon,
  isSkipDominated,
  rewardRecipientBlockText,
} from './rewardDisplay.js';
import { rewardForWhom } from './choiceContent.js';
import {
  choiceReducedMotion,
  fadeScroll,
  itemArtSlot,
  keepDraftScroll,
  softList,
} from './choiceCards.js';
import { unitPortrait } from './unitPortrait.js';
import { createXpRow } from './xpBar.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { itemDisplayName } from '../utils/itemNames.js';
import {
  bundleTargetBlock,
  applyRewardBundle,
  applyAccessoryReward,
  rewardWeaponEligible,
  applyRewardForge,
  REWARD_FORGE_STATS,
} from '../engine/LootRewardCommands.js';
import { isImbueStone, getImbueList } from '../engine/ImbueSystem.js';
import { forgeStatBlock } from '../engine/ForgeSystem.js';
import { pushOverlay, removeOverlay } from '../utils/overlayStack.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import { playRewardReveal, rewardRevealPending } from './rewardReveal.js';
import { rewardRerollButtonState } from './rewardRerollButton.js';
import { itemIcon, itemHero } from './itemIcons.js';
import { itemKeywordRow } from './itemKeywordChips.js';
import { itemKeywords, itemBaseLineFor } from '../engine/ItemKeywords.js';
const node = (tag, text, cls = '') => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
// "Legend · Weapon" as two parts, so a narrow card can keep the tier alone in
// view (the category stays in the text and the card's name).
function rarityText({ tier, category, label }) {
  const text = node('span', null, 'ch-rarity-text');
  if (!tier) {
    text.textContent = label;
    return text;
  }
  text.append(
    node('span', tier, 'ch-rarity-tier'),
    node('span', ` · ${category}`, 'ch-rarity-cat'),
  );
  return text;
}
// Reuses the reward controller's commands; never rolls or awards rewards itself.
export class MobileRewards {
  constructor(scene, controller, choices, summary, skipGold) {
    Object.assign(this, { scene, controller, choices, summary, skipGold });
    this.selected = controller.record?.draft?.selected || 0;
    // The spoils turn face up once per battle (the rolled record is already saved).
    this.revealPending = rewardRevealPending(controller.record);
    this.steps = [];
    this.overlayScene = controller.host || scene;
    this.onShutdown = () => this.destroy();
    scene.events.once('shutdown', this.onShutdown);
    this.open();
    this.restoreDraft();
  }
  button(label, action) {
    const b = node('button', label);
    b.type = 'button';
    b.onclick = () => {
      if (!this.busy) action();
    };
    return b;
  }
  open() {
    if (this.visible || this.scene._lootResolving || this.scene._lootCleanedUp) return;
    this.visible = true;
    this.previousFocus = document.activeElement;
    this.overlayToken = pushOverlay(this.overlayScene, {
      name: 'rewards',
      onCancel: () => {
        this.back();
        return true;
      },
    });
    this.root = node('section', null, 'mu-screen');
    this.root.style.zIndex = DOM_UI_DEPTHS.MENU;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Battle rewards');
    for (const type of [...DOM_INPUT_EVENTS, 'keydown'])
      this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
      if (ignoreRepeatedActivation(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.back();
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (['Tab', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        this.moveFocus(e.shiftKey || ['ArrowUp', 'ArrowLeft'].includes(e.key) ? -1 : 1);
      }
    });
    document.getElementById('game-wrapper').append(this.root);
    for (const obj of this.controller.lootGroup) obj.setVisible(false);
    pushInputScope(this, (action, payload) => {
      if (action === InputAction.PAUSE) this.openReference('Menu');
      if (action === InputAction.CANCEL) this.back();
      if (action === InputAction.NAVIGATE) this.moveFocus(payload?.dy || payload?.dx || 1);
      if (action === InputAction.CONFIRM && this.root.contains(document.activeElement))
        document.activeElement.click();
    });
    this.render();
    // render() already placed the list (keepDraftScroll); focus must not move it.
    (
      this.root.querySelector('[aria-pressed="true"]:not(:disabled)') ||
      this.root.querySelector('.reward-card:not(:disabled), .mh-skill:not(:disabled)')
    )?.focus({ preventScroll: true });
  }
  tools(header) {
    const tools = node('div', null, 'reward-tools');
    for (const title of ['Roster', 'Menu']) {
      const b = this.button(title, () => this.openReference(title));
      b.dataset.focus = title;
      tools.append(b);
    }
    if (this.controller.leave) tools.append(this.button('View map', () => this.controller.leave()));
    header.append(tools);
  }
  openReference(title) {
    if (this.busy || this.child) return;
    if (this.controller.saveError) return this.renderSaveFailure();
    if (this.controller.persist && !this.controller.persist()) return this.renderSaveFailure();
    const previous = document.activeElement;
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
    const close = () => {
      this.child?.destroy();
      this.child = null;
      if (!this.visible) return;
      this.root.hidden = false;
      this.root.inert = false;
      this.root.removeAttribute('aria-hidden');
      if (title === 'Roster') {
        if (this.controller.persist && !this.controller.persist()) return this.renderSaveFailure();
        this.render();
        this.root.querySelector('[data-focus="Roster"]')?.focus();
      } else if (previous?.isConnected) previous.focus();
    };
    if (title === 'Menu') {
      // Pause uses the shared menu depth below rewards. Hide, rather than merely
      // dim, this parent while its child owns input; keep the step stack intact.
      this.root.hidden = true;
      this.scene.showPauseMenu({ onResume: close, fromRewards: true });
      const pause = this.scene.pauseOverlay;
      this.child = { destroy: () => pause?.hideForTransition() };
    } else {
      this.child = new MobileRosterSheet({
        scene: this.overlayScene,
        units: this.scene.runManager.roster,
        run: this.scene.runManager,
        gameData: this.scene.gameData,
        // A promotion saves before its rite (the rewards' own persistence).
        persist: () => (this.controller.persist ? this.controller.persist() : true),
        onClose: close,
      });
    }
  }
  /**
   * Every choice rebuilds the screen: note where the spoils and the current step's
   * list were scrolled, so the rebuilt ones (and a step returned to) open there.
   */
  rememberScroll() {
    const draft = this.root.querySelector('.ch-draft');
    if (draft) this.draftScroll = draft.scrollTop;
    const list = this.root.querySelector('.mu-list');
    if (list && this.renderedStep) this.renderedStep.listScroll = list.scrollTop;
  }
  moveFocus(delta) {
    if (this.busy) return;
    const buttons = [...this.root.querySelectorAll('button:not(:disabled),summary')];
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + delta + buttons.length) % buttons.length]?.focus();
  }
  render() {
    if (this.controller.saveError) return this.renderSaveFailure();
    if (this.notice) return this.renderNotice();
    if (this.steps.length) return this.renderStep();
    const scene = this.scene;
    const focus = this.root.contains(document.activeElement)
      ? document.activeElement.dataset.focus
      : null;
    this.rememberScroll();
    this.renderedStep = null;
    this.root.replaceChildren();
    this.root.classList.add('ch-reward-screen');
    this.root.classList.toggle('is-still', choiceReducedMotion(this.overlayScene));
    const header = node('header', null, 'mu-header');
    header.append(
      node('h1', 'Battle rewards'),
      node('span', `${scene.runManager.gold} gold`, 'mu-currency active'),
    );
    this.tools(header);
    if (this.summary) {
      const earnings = node('details', null, 'mu-help');
      earnings.append(node('summary', 'Battle earnings · already added'), node('p', this.summary));
      header.append(earnings);
    }
    const all = [...this.choices, { type: 'skip' }];
    if (!this.controller.isRewardAvailable(this.selected)) {
      const available = all.findIndex((_, i) => this.controller.isRewardAvailable(i));
      if (available >= 0) this.selected = available;
    }
    // A gold card still on offer that pays at least as much makes the skip a loss.
    const skipDominated = isSkipDominated(this.choices, this.skipGold, (i) =>
      this.controller.isRewardAvailable(i),
    );
    const label = (c) =>
      c.type === 'skip'
        ? `Take ${this.skipGold} gold instead`
        : (c.item
            ? `${itemDisplayName(c.item, scene.gameData?.skills)}${c.quantity > 1 ? ` ×${c.quantity}` : ''}`
            : '') || `${c.goldAmount || 0} gold${c.xpAmount ? ` + ${c.xpAmount} team XP` : ''}`;
    const describe = (c) =>
      c.type === 'skip'
        ? skipDominated
          ? 'The gold reward pays more.'
          : 'Pass on the remaining rewards and add this gold to your vault.'
        : c.item
          ? scene._getLootTooltipText(c, c.item)
          : 'Gold is added to your vault. Team XP is shared with your roster.';
    // The spoils as cards: art, rarity frame, what it does, and for whom. Upright
    // they are a list that scrolls, its edges fading while there is more.
    const row = softList(node('div', null, 'ch-draft ch-rewards'));
    row.dataset.count = String(all.length);
    row.style.setProperty('--ch-n', String(all.length));
    all.forEach((c, i) => {
      const presentation = rewardPresentation(c);
      const available = this.controller.isRewardAvailable(i);
      const claimed = !available && Boolean(this.controller.claimed?.has?.(i));
      const b = this.button(null, () => {
        this.selected = i;
        this.saveDraft();
        this.render();
      });
      b.dataset.focus = `reward-${i}`;
      b.className = 'ch-card ch-reward reward-card';
      b.style.setProperty('--reward-color', `var(--re-${presentation.token})`);
      b.dataset.tier =
        presentation.tier || (c.type === 'skip' || c.type === 'gold' ? 'Gold' : 'none');
      b.classList.toggle('reward-legend', presentation.tier === 'Legend');
      b.classList.toggle('is-claimed', claimed);
      b.classList.toggle('is-dominated', c.type === 'skip' && skipDominated);
      const plate = node('span', null, 'ch-plate');
      const top = node('span', null, 'ch-reward-top');
      const rarity = node('span', null, 'ch-rarity reward-quality');
      rarity.append(rewardIcon(presentation.category), rarityText(presentation));
      top.append(itemArtSlot(c, presentation.category, { count: all.length }), rarity);
      const lines = fadeScroll(node('span', null, 'ch-lines'));
      // The tooltip may open with the item's own name: the card already shows it.
      const text = String(describe(c) || '').split('\n');
      if (c.item?.name && text[0]?.trim() === c.item.name) text.shift();
      // The keyword row states the type and the special; the lines don't repeat them.
      const keys = c.item ? itemKeywordRow(c.item) : null;
      const said = new Set();
      if (keys && itemBaseLineFor(c.item) !== null) said.add(c.item.type);
      if (c.item && itemKeywords(c.item).length) said.add(c.item.special);
      for (const line of text)
        if (line.trim() && !said.has(line.trim())) lines.append(node('p', line));
      plate.append(top, node('strong', label(c), 'ch-reward-name'));
      if (keys) plate.append(keys);
      plate.append(lines);
      const whom = rewardForWhom(c, scene.runManager);
      if (whom) {
        const forWhom = node('span', null, `ch-forwhom is-${whom.tone || 'muted'}`);
        forWhom.append(node('b', whom.who));
        if (whom.detail) forWhom.append(node('span', whom.detail));
        plate.append(forWhom);
      }
      b.append(plate);
      if (claimed) b.append(node('span', 'Claimed', 'ch-stamp'));
      b.setAttribute(
        'aria-label',
        [label(c), presentation.label, whom?.who, whom?.detail, claimed ? 'Claimed' : '']
          .filter(Boolean)
          .join(' · '),
      );
      b.setAttribute('aria-pressed', String(this.selected === i));
      b.disabled = !available;
      row.append(b);
    });
    const c = all[this.selected];
    // Notes ride under the cards: this battle's news and the chosen item's art.
    const notes = node('section', null, 'ch-notes');
    notes.setAttribute('aria-label', 'Notes');
    // The chosen item's story, as the shop and roster tell it.
    if (c?.item?.lore) notes.append(node('p', c.item.lore, 'ch-reward-lore'));
    appendItemArtDetails(notes, c?.item, scene.gameData.weaponArts?.arts || [], {
      openHelp: (title, blocks) => {
        if (this.child || this.busy) return;
        this.child = new ContextHelp(this.overlayScene, this.root, title, blocks, () => {
          this.child = null;
        });
      },
    });
    for (const notice of scene.runManager.lastBattleCasualtyNotices || []) {
      notes.append(node('p', notice, 'mu-help'));
    }
    const openMasteryHelp = () => {
      if (this.child || this.busy) return;
      this.child = new ContextHelp(
        this.overlayScene,
        this.root,
        'Class mastery',
        MASTERY_HELP,
        () => {
          this.child = null;
        },
      );
    };
    for (const [index, mastery] of (this.masteryNotices || []).entries()) {
      const notice = node('div', null, 'mu-help mu-mastery-notice');
      const line = node(
        'p',
        `${mastery.name} mastered ${mastery.className}! ${mastery.perk?.name || ''}${mastery.perk?.mods ? ` — ${formatPerkMods(mastery.perk.mods)}` : ''}`,
      );
      line.setAttribute('role', 'status');
      notice.append(line);
      notes.append(notice);
      // One ⓘ for the topic (first notice); every notice answers press-and-hold.
      if (index === 0)
        attachInfo(notice, {
          title: 'class mastery',
          heading: notice,
          preview: helpPreview(MASTERY_HELP),
          open: openMasteryHelp,
          enabled: () => !this.child && !this.busy,
        });
      else bindHold(notice, openMasteryHelp, { enabled: () => !this.child && !this.busy });
    }
    const actions = node('div', null, 'ch-footer ch-rewards-footer');
    const picks = scene._elitePicksRemaining || 1;
    const lead = node(
      'span',
      `${this.rerolled && !this.controller.claimed?.size ? 'New choices drawn · ' : ''}Choose ${picks} reward${picks > 1 ? 's' : ''}${scene.isBoss ? ' · the boss’s spoils' : ''}`,
      'mu-help ch-footer-lead',
    );
    lead.setAttribute('aria-live', 'polite');
    actions.append(lead);
    // Branching Threads (Home Base): redraw every choice before the first pick. Hidden
    // when the run has no rerolls, so the screen is unchanged without the upgrade.
    const rerollState = rewardRerollButtonState(this.controller.rerollStatus?.() || null);
    if (!rerollState.hidden) {
      const reroll = this.button(rerollState.label, () => this.reroll());
      reroll.dataset.focus = 'reroll';
      reroll.className = 'ch-reroll';
      reroll.title = rerollState.reason;
      reroll.disabled = rerollState.disabled;
      actions.append(reroll);
    }
    const claim = this.button(c.type === 'skip' ? 'Take gold' : 'Choose reward', () => {
      if (!this.controller.isRewardAvailable(this.selected)) return;
      if (c.type === 'skip' || c.type === 'gold' || c.item?.type === 'Scroll') {
        this.hide();
        this.controller.activateReward(this.selected);
      } else this.startChoice(c);
    });
    claim.dataset.focus = 'claim';
    claim.className = 'mu-buy';
    claim.disabled = !this.controller.isRewardAvailable(this.selected);
    actions.append(claim);
    if (!header.querySelector('.reward-tools')) this.tools(header);
    this.root.append(header, row);
    if (notes.childElementCount) this.root.append(notes);
    this.root.append(actions);
    keepDraftScroll(row, this.draftScroll || 0);
    if (focus)
      this.root
        .querySelector(`[data-focus="${focus}"]:not(:disabled)`)
        ?.focus({ preventScroll: true });
    if (this.revealPending) this.startReveal(row, all);
    else if (this.replayReveal) {
      // A reroll's new cards turn face up like the first ones (already saved face up).
      this.replayReveal = false;
      this.playReveal(row, all);
    }
  }
  /**
   * Branching Threads: draw the whole set of choices again (the controller saves the new
   * choices and the spent charge in one write; a failed save changes nothing and shows
   * Retry save). Only from the cards, never mid-choice.
   */
  reroll() {
    if (this.busy || this.child || this.notice || this.steps.length || !this.visible) return;
    const result = this.controller.rerollRewards?.();
    if (!result?.ok) {
      if (this.controller.saveError) return this.renderSaveFailure();
      return this.render();
    }
    this.reveal?.skip();
    this.choices = this.controller.choices;
    this.selected = 0;
    this.draftScroll = 0;
    this.rerolled = true;
    this.replayReveal = true;
    this.scene.registry?.get?.('audio')?.playSFX('sfx_confirm');
    this.render();
    // Keep the focus on Reroll while it can go again; else on the first card.
    if (!this.root.contains(document.activeElement) || document.activeElement.disabled)
      this.root.querySelector('.reward-card:not(:disabled)')?.focus({ preventScroll: true });
  }
  /** Reward reveal: Hollow Sun backs turn in order (presentation only; tap skips). */
  startReveal(row, all) {
    this.revealPending = false;
    this.controller.record.revealed = true;
    if (this.controller.persist && !this.controller.persist()) return this.renderSaveFailure();
    this.playReveal(row, all);
  }
  playReveal(row, all) {
    const speed = this.overlayScene.registry?.get?.('settings')?.getBattleSpeed?.();
    this.reveal = playRewardReveal(row, [...row.children], {
      still: choiceReducedMotion(this.overlayScene) || speed === 'instant',
      tiers: all.map((c) => rewardPresentation(c).tier),
      // A card tap only selects: the tap that ends the reveal selects too.
      passThrough: true,
    });
  }
  draftKey(choice) {
    return typeof choice === 'string'
      ? choice
      : choice?.uid || `${choice?.id || choice?.key || choice?.name}:${choice?.className || ''}`;
  }
  saveDraft() {
    if (this.restoringDraft || !this.controller.record || this.controller.saveError) return;
    this.controller.record.draft = {
      selected: this.selected,
      path: this.steps.map((step) => ({
        index: step.choices.indexOf(step.selected),
        key: this.draftKey(step.selected),
      })),
    };
    if (!this.controller.persist()) this.renderSaveFailure();
  }
  restoreDraft() {
    const draft = this.controller.record?.draft;
    if (!draft?.path?.length || !this.choices[this.selected]) return;
    this.restoringDraft = true;
    try {
      this.startChoice(this.choices[this.selected]);
      for (let i = 0; i < draft.path.length; i++) {
        const step = this.steps[i],
          saved = draft.path[i];
        if (!step) break;
        const choice = step.choices[saved.index];
        if (this.draftKey(choice) !== saved.key) break;
        step.selected = choice;
        if (i < draft.path.length - 1 && !step.final && !step.blocked?.(choice)) step.next(choice);
      }
      this.render();
    } finally {
      this.restoringDraft = false;
    }
  }
  renderSaveFailure() {
    this.root.replaceChildren(
      node('h1', 'Reward save interrupted'),
      node(
        'p',
        this.controller.needsFinish
          ? 'Your choice is applied in this session but has not been saved. Retry before leaving; reloading now may lose it.'
          : 'Your latest reward-screen changes have not been saved. Retry before leaving.',
      ),
      this.button('Retry save', () => this.controller.retrySave()),
    );
  }
  /**
   * A claimed reward's news (team XP: who levelled, which class skill was learned or
   * found every slot full), shown before the flow moves on. Continue (or Back) goes on.
   */
  /**
   * A claimed reward's news before the flow moves on. `bars` (optional, one per line):
   * `{ unit, extendedLevelingEnabled }` draws that unit's EXP bar under its line, at
   * its final value (Team XP: docs/specs/exp-bars.md §2.6; a list, not a moment).
   */
  showNotice(title, lines, onContinue, { bars = null } = {}) {
    this.notice = { title, lines, onContinue, bars };
    if (this.visible) this.render();
    else this.open();
    this.root?.querySelector('[data-focus="notice-continue"]')?.focus();
  }
  renderNotice() {
    const { title, lines, bars } = this.notice;
    this.renderedStep = null;
    this.root.replaceChildren();
    this.root.classList.remove('ch-reward-screen');
    const header = node('header', null, 'mu-header');
    header.append(node('h1', title));
    const list = node('ul', null, 'reward-notice');
    lines.forEach((line, i) => {
      const item = node('li', line);
      const bar = bars?.[i];
      const row = bar?.unit
        ? createXpRow(bar.unit, { extendedLevelingEnabled: bar.extendedLevelingEnabled === true })
        : null;
      if (row) {
        row.classList.add('reward-notice-xp');
        item.append(row);
      }
      list.append(item);
    });
    const actions = node('div', null, 'mu-actions');
    const go = this.button('Continue', () => this.closeNotice());
    go.className = 'mu-buy';
    go.dataset.focus = 'notice-continue';
    actions.append(go);
    this.root.append(header, list, actions);
  }
  closeNotice() {
    const notice = this.notice;
    if (!notice) return;
    this.notice = null;
    this.hide();
    notice.onContinue?.();
  }
  back() {
    if (this.notice) return this.closeNotice();
    if (this.busy || !this.steps.length) return;
    this.steps.pop();
    this.saveDraft();
    this.render();
    this.root.querySelector('button:not(:disabled)')?.focus();
  }
  pushStep(step) {
    this.steps.push(step);
    this.renderStep();
    this.saveDraft();
    this.root.querySelector('[aria-pressed="true"]')?.focus();
  }
  renderStep(message = '') {
    if (this.controller.saveError) return this.renderSaveFailure();
    const step = this.steps.at(-1);
    this.rememberScroll();
    this.root.replaceChildren();
    const header = node('header', null, 'mu-header');
    header.append(
      node('h1', 'Battle rewards'),
      this.button('Back', () => this.back()),
    );
    const trail = node('p', ['Rewards', ...this.steps.map((s) => s.title)].join(' › '), 'mu-help');
    this.tools(header);
    const split = node('div', null, 'mu-split');
    const list = softList(node('div', null, 'mu-list'));
    step.selected ??= step.choices[0];
    for (const choice of step.choices) {
      const reason = step.blocked?.(choice);
      const row = this.button(null, () => {
        step.selected = choice;
        this.saveDraft();
        this.renderStep();
        this.root.querySelector('[aria-pressed="true"]')?.focus();
      });
      row.className = 'mh-skill';
      row.setAttribute('aria-pressed', String(step.selected === choice));
      // A unit recipient shows its face beside the comparison.
      const face =
        choice && typeof choice === 'object' && choice.className && choice.stats
          ? unitPortrait(this.overlayScene, this.scene.gameData, choice, 'mr-unit-face')
          : null;
      if (face) {
        row.classList.add('ch-recipient');
        row.append(face);
      }
      // Weapon rows (forge / imbue targets) carry the weapon's socketed icon.
      const subject = face ? null : step.icon?.(choice);
      if (subject) {
        row.classList.add('reward-step-item');
        row.append(itemIcon(subject, { size: 32, className: 'reward-icon' }));
      }
      row.append(
        node('strong', step.label(choice)),
        node('small', reason || step.describe?.(choice) || ''),
      );
      list.append(row);
    }
    const detail = node('section', null, 'mu-detail');
    const copy = node('div', null, 'mu-copy');
    const chosen = step.selected;
    const title = node('h2', chosen ? step.label(chosen) : 'No available choices');
    const line = node(
      'p',
      chosen
        ? step.blocked?.(chosen) || step.describe?.(chosen) || ''
        : 'Go back to choose another reward.',
    );
    // The chosen weapon's picture, else the reward's own (who gets it, which stat).
    const subject = (chosen ? step.icon?.(chosen) : null) || step.subject || null;
    if (subject) {
      // The picture beside the choice's name.
      const head = node('div', null, 'reward-hero');
      const text = node('div', null, 'reward-hero-title');
      text.append(title, line);
      head.append(itemHero(subject, { size: 96 }), text);
      copy.append(head);
    } else copy.append(title, line);
    const status = node('p', message);
    status.setAttribute('role', 'status');
    copy.append(status);
    const actions = node('div', null, 'mu-actions');
    const confirm = this.button(step.final ? 'Apply reward' : 'Continue', () => {
      if (!chosen || step.blocked?.(chosen)) return;
      if (step.final) this.apply(() => step.apply(chosen));
      else step.next(chosen);
    });
    confirm.className = 'mu-buy';
    confirm.disabled = !chosen || !!step.blocked?.(chosen);
    actions.append(confirm);
    detail.append(copy, actions);
    split.append(list, detail);
    if (!header.querySelector('.reward-tools')) this.tools(header);
    this.root.append(header, trail, split);
    this.renderedStep = step;
    list.scrollTop = step.listScroll || 0;
  }
  startChoice(choice) {
    const item = choice.item;
    const run = this.scene.runManager;
    if (choice.type === 'accessory') {
      this.pushStep({
        title: `Equip ${itemDisplayName(item, this.scene.gameData?.skills)}`,
        subject: item,
        choices: [...run.roster, 'pool'],
        label: (unit) => (unit === 'pool' ? 'Keep in shared pool' : unit.name),
        describe: (unit) =>
          unit === 'pool'
            ? 'Choose who equips it later.'
            : `Equip now${unit.accessory ? `; ${itemDisplayName(unit.accessory, this.scene.gameData?.skills)} returns to the shared pool` : ''}.`,
        final: true,
        apply: (unit) => applyAccessoryReward(run, item, unit),
      });
    } else if (choice.type === 'forge') {
      this.pushStep({
        title: item.name,
        subject: item,
        choices: run.roster,
        label: (unit) => unit.name,
        blocked: (unit) =>
          unit.inventory?.some((w) => rewardWeaponEligible(item, w)) ? '' : 'No eligible weapons',
        describe: () => 'Choose the unit carrying the weapon.',
        next: (unit) => this.weaponStep(item, unit),
      });
    } else {
      const booster = item.type === 'Consumable' && item.effect === 'statBoost';
      const compareOptions = {
        arts: this.scene.gameData?.weaponArts?.arts || [],
        imbues: this.scene.gameData?.imbues,
      };
      this.pushStep({
        title: item.name,
        subject: item,
        choices: [...run.roster, ...(booster ? [] : ['convoy'])].sort(
          (a, b) =>
            Number(!!bundleTargetBlock(run, item, a, choice.quantity || 1)) -
            Number(!!bundleTargetBlock(run, item, b, choice.quantity || 1)),
        ),
        label: (unit) => (unit === 'convoy' ? 'Send to Convoy' : unit.name),
        blocked: (unit) =>
          rewardRecipientBlockText(bundleTargetBlock(run, item, unit, choice.quantity || 1)),
        describe: (unit) =>
          unit === 'convoy'
            ? 'Shared storage. Withdraw it to any unit from Roster › Convoy between battles.'
            : booster
              ? `${item.stat}: ${unit.stats[item.stat] || 0} → ${(unit.stats[item.stat] || 0) + item.value}`
              : item.type === 'Consumable'
                ? `${unit.consumables?.length || 0}/3 consumables${choice.quantity > 1 ? ` · ${choice.quantity} items; overflow goes to convoy` : ''}`
                : `Can equip · ${equipmentComparison(unit, item, unit.weapon, compareOptions)} · ${unit.inventory?.length || 0}/5 items`,
        final: true,
        apply: (unit) => applyRewardBundle(run, item, unit, choice.quantity || 1),
      });
    }
  }
  weaponStep(item, unit) {
    const apply = (weapon, selection) =>
      applyRewardForge(this.scene.runManager, this.scene.gameData, item, unit, weapon, selection);
    const needsChoice = item.forgeStat === 'choice' || item.imbueId === 'choice';
    this.pushStep({
      title: unit.name,
      choices: inventoryDisplayOrder(unit).filter((w) => rewardWeaponEligible(item, w)),
      label: (weapon) => `${weapon.name}${weapon === unit.weapon ? ' · Equipped' : ''}`,
      icon: (weapon) => weapon,
      describe: (weapon) =>
        `Might ${weapon.might} · Hit ${weapon.hit} · Crit ${weapon.crit} · Weight ${weapon.weight}`,
      blocked: (weapon) =>
        unit.inventory.includes(weapon) && rewardWeaponEligible(item, weapon)
          ? ''
          : 'Weapon unavailable',
      final: !needsChoice,
      apply: (weapon) => apply(weapon),
      next: (weapon) => {
        const imbue = isImbueStone(item);
        this.pushStep({
          title: weapon.name,
          choices: imbue ? getImbueList(this.scene.gameData.imbues) : REWARD_FORGE_STATS,
          subject: weapon,
          // Each imbue row wears its stone's icon.
          icon: imbue ? (entry) => entry.stone || null : null,
          label: (entry) => (imbue ? entry.name : entry.label),
          describe: (entry) =>
            imbue
              ? entry.description
              : forgeImpactLine(unit, weapon, entry.key) || 'Permanent weapon upgrade.',
          blocked: (entry) => (imbue ? '' : forgeStatBlock(weapon, entry.key)),
          final: true,
          apply: (entry) => apply(weapon, imbue ? entry.id : entry.key),
        });
      },
    });
  }
  async apply(command) {
    if (this.busy || !this.visible) return;
    this.busy = true;
    this.root.setAttribute('aria-busy', 'true');
    for (const button of this.root.querySelectorAll('button')) button.disabled = true;
    try {
      const result = await this.controller.applyNativeReward(this.selected, command);
      if (!this.visible) return;
      if (!result.ok) {
        if (this.controller.saveError) {
          this.renderSaveFailure();
          return;
        }
        this.renderStep(result.reason);
        this.root.querySelector('button:not(:disabled)')?.focus();
        return;
      }
      this.steps = [];
      this.hide();
      this.scene.registry.get('audio')?.playSFX('sfx_gold');
      this.scene.finalizeLootPick(this.controller.lootGroup, this.selected);
    } catch (error) {
      if (this.visible) this.renderStep('Could not apply reward. Please try again.');
      console.error('Reward application failed', error);
    } finally {
      this.busy = false;
      this.root?.removeAttribute('aria-busy');
    }
  }
  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.reveal?.skip();
    this.child?.destroy();
    this.child = null;
    popInputScope(this);
    removeOverlay(this.overlayScene, this.overlayToken);
    this.overlayToken = null;
    this.root.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
  destroy() {
    this.hide();
    this.scene.events.off('shutdown', this.onShutdown);
  }
}
