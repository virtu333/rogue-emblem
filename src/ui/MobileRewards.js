import { equipmentComparison } from './equipmentComparison.js';
import { appendItemArtDetails } from './ItemArtDetails.js';
import { formatPerkMods, MASTERY_HELP } from './rosterDisplay.js';
import { ContextHelp } from './ContextHelp.js';
import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { rewardPresentation, rewardIcon } from './rewardDisplay.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
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
const node = (tag, text, cls = '') => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
// Reuses the reward controller's commands; never rolls or awards rewards itself.
export class MobileRewards {
  constructor(scene, controller, choices, summary, skipGold) {
    Object.assign(this, { scene, controller, choices, summary, skipGold });
    this.selected = controller.record?.draft?.selected || 0;
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
    this.root.querySelector('.mh-skill:not(:disabled)')?.focus();
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
        onClose: close,
      });
    }
  }
  moveFocus(delta) {
    if (this.busy) return;
    const buttons = [...this.root.querySelectorAll('button:not(:disabled),summary')];
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + delta + buttons.length) % buttons.length]?.focus();
  }
  render() {
    if (this.controller.saveError) return this.renderSaveFailure();
    if (this.steps.length) return this.renderStep();
    const scene = this.scene;
    const focus = this.root.contains(document.activeElement)
      ? document.activeElement.dataset.focus
      : null;
    this.root.replaceChildren();
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
    const split = node('div', null, 'mu-split');
    const list = node('div', null, 'mu-list');
    const detail = node('section', null, 'mu-detail');
    const all = [...this.choices, { type: 'skip' }];
    if (!this.controller.isRewardAvailable(this.selected)) {
      const available = all.findIndex((_, i) => this.controller.isRewardAvailable(i));
      if (available >= 0) this.selected = available;
    }
    const label = (c) =>
      c.type === 'skip'
        ? `Take ${this.skipGold} gold instead`
        : (c.item ? `${c.item.name}${c.quantity > 1 ? ` ×${c.quantity}` : ''}` : '') ||
          `${c.goldAmount || 0} gold${c.xpAmount ? ` + ${c.xpAmount} team XP` : ''}`;
    all.forEach((c, i) => {
      const b = this.button(label(c), () => {
        this.selected = i;
        this.saveDraft();
        this.render();
      });
      b.dataset.focus = `reward-${i}`;
      b.className = 'mh-skill reward-card';
      const presentation = rewardPresentation(c);
      b.style.setProperty('--reward-color', `var(--re-${presentation.token})`);
      b.classList.toggle('reward-legend', presentation.tier === 'Legend');
      b.replaceChildren(
        rewardIcon(presentation.category),
        node('strong', label(c)),
        node('small', presentation.label, 'reward-quality'),
      );
      b.setAttribute('aria-pressed', String(this.selected === i));
      b.disabled = !this.controller.isRewardAvailable(i);
      list.append(b);
    });
    const c = all[this.selected];
    const copy = node('div', null, 'mu-copy');
    copy.append(node('h2', label(c)), node('p', rewardPresentation(c).label, 'mu-help'));
    const description =
      c.type === 'skip'
        ? 'Pass on the remaining rewards and add this gold to your vault.'
        : c.item
          ? scene._getLootTooltipText(c, c.item)
          : 'Gold is added to your vault. Team XP is shared with your roster.';
    copy.append(node('p', description));
    appendItemArtDetails(copy, c.item, scene.gameData.weaponArts?.arts || []);
    for (const notice of scene.runManager.lastBattleCasualtyNotices || []) {
      copy.append(node('p', notice, 'mu-help'));
    }
    for (const mastery of this.masteryNotices || []) {
      const notice = node(
        'p',
        `${mastery.name} mastered ${mastery.className}! ${mastery.perk?.name || ''}${mastery.perk?.mods ? ` — ${formatPerkMods(mastery.perk.mods)}` : ''}`,
        'mu-help',
      );
      notice.setAttribute('role', 'status');
      copy.append(notice);
    }
    if (this.masteryNotices?.length)
      copy.append(
        this.button('About class mastery', () => {
          if (this.child) return;
          this.child = new ContextHelp(
            this.overlayScene,
            this.root,
            'Class mastery',
            MASTERY_HELP,
            () => {
              this.child = null;
            },
          );
        }),
      );
    const actions = node('div', null, 'mu-actions');
    actions.append(
      node(
        'span',
        `Choose ${scene._elitePicksRemaining || 1} reward${scene._elitePicksRemaining > 1 ? 's' : ''}`,
        'mu-help',
      ),
    );
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
    detail.append(copy, actions);
    split.append(list, detail);
    if (!header.querySelector('.reward-tools')) this.tools(header);
    this.root.append(header, split);
    if (focus) this.root.querySelector(`[data-focus="${focus}"]:not(:disabled)`)?.focus();
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
  back() {
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
    this.root.replaceChildren();
    const header = node('header', null, 'mu-header');
    header.append(
      node('h1', 'Battle rewards'),
      this.button('Back', () => this.back()),
    );
    const trail = node('p', ['Rewards', ...this.steps.map((s) => s.title)].join(' › '), 'mu-help');
    this.tools(header);
    const split = node('div', null, 'mu-split');
    const list = node('div', null, 'mu-list');
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
      row.append(
        node('strong', step.label(choice)),
        node('small', reason || step.describe?.(choice) || ''),
      );
      list.append(row);
    }
    const detail = node('section', null, 'mu-detail');
    const copy = node('div', null, 'mu-copy');
    const chosen = step.selected;
    copy.append(
      node('h2', chosen ? step.label(chosen) : 'No available choices'),
      node(
        'p',
        chosen
          ? step.blocked?.(chosen) || step.describe?.(chosen) || ''
          : 'Go back to choose another reward.',
      ),
    );
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
  }
  startChoice(choice) {
    const item = choice.item;
    const run = this.scene.runManager;
    if (choice.type === 'accessory') {
      this.pushStep({
        title: `Equip ${item.name}`,
        choices: [...run.roster, 'pool'],
        label: (unit) => (unit === 'pool' ? 'Keep in shared pool' : unit.name),
        describe: (unit) =>
          unit === 'pool'
            ? 'Choose who equips it later.'
            : `Equip now${unit.accessory ? `; ${unit.accessory.name} returns to the shared pool` : ''}.`,
        final: true,
        apply: (unit) => applyAccessoryReward(run, item, unit),
      });
    } else if (choice.type === 'forge') {
      this.pushStep({
        title: item.name,
        choices: run.roster,
        label: (unit) => unit.name,
        blocked: (unit) =>
          unit.inventory?.some((w) => rewardWeaponEligible(item, w)) ? '' : 'No eligible weapons',
        describe: () => 'Choose the unit carrying the weapon.',
        next: (unit) => this.weaponStep(item, unit),
      });
    } else {
      const booster = item.type === 'Consumable' && item.effect === 'statBoost';
      this.pushStep({
        title: item.name,
        choices: [...run.roster, ...(booster ? [] : ['convoy'])].sort(
          (a, b) =>
            Number(!!bundleTargetBlock(run, item, a, choice.quantity || 1)) -
            Number(!!bundleTargetBlock(run, item, b, choice.quantity || 1)),
        ),
        label: (unit) => (unit === 'convoy' ? 'Send to Convoy' : unit.name),
        blocked: (unit) => bundleTargetBlock(run, item, unit, choice.quantity || 1),
        describe: (unit) =>
          unit === 'convoy'
            ? 'Store for later.'
            : booster
              ? `${item.stat}: ${unit.stats[item.stat] || 0} → ${(unit.stats[item.stat] || 0) + item.value}`
              : item.type === 'Consumable'
                ? `${unit.consumables?.length || 0}/3 consumables${choice.quantity > 1 ? ` · ${choice.quantity} items; overflow goes to convoy` : ''}`
                : `Can equip · ${equipmentComparison(unit, item)} · ${unit.inventory?.length || 0}/5 items`,
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
      choices: unit.inventory.filter((w) => rewardWeaponEligible(item, w)),
      label: (weapon) => weapon.name,
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
          label: (entry) => (imbue ? entry.name : entry.label),
          describe: (entry) => (imbue ? entry.description : 'Permanent weapon upgrade.'),
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
