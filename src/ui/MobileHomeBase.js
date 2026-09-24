import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { MobileUpgradeMenu } from './MobileUpgradeMenu.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import {
  transitionToSceneWithBlockedRetry,
  TRANSITION_REASONS,
  TRANSITION_RESULTS,
} from '../utils/SceneRouter.js';
import portraitManifest from './RebuiltPortraitManifest.json';
import { hasPc98, pc98PortraitElement, usePc98 } from './portraitArt.js';
const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};

// Presentation only: selection, unlocks, assignment, and persistence remain owned by meta.
export class MobileHomeBase {
  constructor(scene) {
    this.scene = scene;
    this.meta = scene.meta;
    this.role = 'commander';
    this.tab = 'lords';
    const hints = scene.registry.get('hints');
    this.onboarding = [];
    if (hints?.shouldShow('homebase_intro'))
      this.onboarding.push(
        'Spend Valor and Supply in Upgrades to strengthen your army across runs.',
      );
    if (hints?.shouldShow('homebase_begin'))
      this.onboarding.push('Choose your starting lords and skills, then Begin Run.');
    scene.mobileUpgrades = new MobileUpgradeMenu(scene, {
      embedded: true,
      onClose: () => this.open(),
    });
    this.open();
  }
  button(label, action, pressed) {
    const b = node('button', '', label);
    b.type = 'button';
    b.onclick = action;
    if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
    return b;
  }
  open() {
    if (this.visible) return;
    this.visible = true;
    this.previousInput = this.scene.input.enabled;
    this.scene.input.enabled = false;
    this.root = node('section', 'mu-screen mh-screen');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Home base');
    this.root.tabIndex = -1;
    for (const name of DOM_INPUT_EVENTS)
      this.root.addEventListener(name, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
      if (ignoreRepeatedActivation(e)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.back();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        this.moveFocus(e.shiftKey ? -1 : 1);
      }
    });
    document.getElementById('game-wrapper').append(this.root);
    pushInputScope(this, (action, payload) => {
      if ([InputAction.CANCEL, InputAction.PAUSE].includes(action)) this.back();
      if (action === InputAction.NAVIGATE) this.moveFocus(payload?.dy || payload?.dx || 1);
      if (action === InputAction.CONFIRM && this.root.contains(document.activeElement))
        document.activeElement.click();
    });
    this.render();
    this.root.querySelector('button')?.focus();
  }
  moveFocus(delta) {
    const buttons = [...this.root.querySelectorAll('button:not(:disabled)')];
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + delta + buttons.length) % buttons.length]?.focus();
  }
  hide() {
    if (!this.visible) return;
    this.visible = false;
    popInputScope(this);
    this.root.remove();
    this.scene.input.enabled = this.previousInput;
  }
  back({ allowExit = true } = {}) {
    if (this.tab !== 'lords') {
      this.tab = 'lords';
      this.render('lords');
    } else if (allowExit) void this.transition('Title');
    else return false;
    return true;
  }
  async transition(target) {
    if (this.pending) return;
    this.pending = true;
    this.render();
    const ok = await this.scene.runTransition(async () => {
      if (target === 'Title') this.scene.registry.get('audio')?.stopMusic(this.scene, 0);
      return (
        (
          await transitionToSceneWithBlockedRetry(
            this.scene,
            target,
            { gameData: this.scene.gameData },
            {
              reason: target === 'Title' ? TRANSITION_REASONS.BACK : TRANSITION_REASONS.BEGIN_RUN,
            },
          )
        ).status === TRANSITION_RESULTS.STARTED
      );
    });
    if (!ok && this.visible) {
      this.pending = false;
      this.scene.input.enabled = false;
      this.message = 'Could not continue. Please try again.';
      this.render();
    }
  }
  portrait(lord, size = 48) {
    const id = `lord_${lord.name.toLowerCase()}`;
    if (usePc98() && hasPc98(id))
      return pc98PortraitElement({
        id,
        size,
        faction: 'ember',
        className: 'mh-portrait',
        alt: lord.name,
      });
    const img = node('img', 'mh-portrait');
    img.alt = lord.name;
    const file = portraitManifest[id]?.file;
    if (file) img.src = `${import.meta.env.BASE_URL}assets/portraits/rebuilt/${file}`;
    return img;
  }
  render(preferredFocus = null) {
    if (!this.visible) return;
    const ownedFocus = this.root.contains(document.activeElement);
    const focus = preferredFocus || (ownedFocus ? document.activeElement?.dataset?.focus : null);
    const scroll = this.root.querySelector('.mu-list')?.scrollTop || 0;
    const selection = this.scene._getHealedLordSelection();
    const tier = this.meta.getCommanderChoiceTier();
    const lords = this.scene.gameData.lords || [];
    const lord = lords.find((l) => l.name === selection[this.role]);
    this.root.replaceChildren();
    const header = node('header', 'mu-header');
    header.append(
      node('h1', '', 'Home base'),
      this.button('Upgrades', () => {
        this.hide();
        this.scene.mobileUpgrades.open();
      }),
      this.button('Title', () => void this.transition('Title')),
    );
    const tabs = node('nav', 'mu-tabs');
    tabs.setAttribute('aria-label', 'Loadout');
    for (const [key, label] of [
      ['lords', 'Starting lords'],
      ['skills', 'Starting skills'],
    ]) {
      const b = this.button(
        label,
        () => {
          this.tab = key;
          this.render();
        },
        this.tab === key,
      );
      b.dataset.focus = key;
      tabs.append(b);
    }
    for (const [key, label] of [
      ['commander', 'Commander'],
      ['partner', 'Partner'],
    ]) {
      const b = this.button(
        `${label}: ${selection[key]}`,
        () => {
          this.role = key;
          this.render();
        },
        this.role === key,
      );
      b.dataset.focus = key;
      tabs.append(b);
    }
    const split = node('div', 'mu-split');
    const list = node('div', 'mu-list');
    const detail = node('section', 'mu-detail');
    const copy = node('div', 'mu-copy');
    if (lord) {
      const identity = node('div', 'mh-identity');
      identity.append(this.portrait(lord, 64), node('h2', '', `${lord.name} · ${lord.class}`));
      copy.append(
        identity,
        node('p', '', lord.personalSkill),
        node('p', 'mu-help', `${lord.weapon} · Movement ${lord.baseStats.MOV}`),
      );
    }
    if (this.tab === 'lords') {
      const unlocked = tier >= (this.role === 'commander' ? 1 : 2);
      copy.append(
        node(
          'p',
          'mu-help',
          this.role === 'commander'
            ? 'Leads the run. If your commander falls, the run ends.'
            : 'Your second starting lord.',
        ),
      );
      if (!unlocked)
        copy.append(
          node(
            'p',
            'mu-requirements',
            this.role === 'commander'
              ? 'Unlock Banner of Command in Upgrades → Lords to change commander.'
              : 'Unlock Chosen Companions in Upgrades → Lords to change partner.',
          ),
        );
      for (const candidate of lords) {
        const current = candidate.name === selection[this.role];
        const blocked = this.role === 'partner' && candidate.name === selection.commander;
        const b = this.button(
          '',
          () => {
            const ok =
              this.role === 'commander'
                ? this.meta.setCommander(candidate.name)
                : this.meta.setPartner(candidate.name);
            if (ok) {
              this.message = `${candidate.name} selected.`;
              this.render();
            }
          },
          current,
        );
        b.className = 'mh-lord';
        b.dataset.focus = `lord-${candidate.name}`;
        b.disabled = !unlocked || blocked;
        b.append(
          this.portrait(candidate),
          node('strong', '', candidate.name),
          node('span', '', current ? 'Selected' : blocked ? 'Commander' : candidate.class),
        );
        list.append(b);
      }
    } else {
      const name = lord?.name;
      const assigned = this.meta.getSkillAssignments()[name] || [];
      const limit = this.meta.getStartingSkillSlots();
      const skills = this.scene.gameData.skills || [];
      copy.append(node('h2', 'mh-slots', `${assigned.length} / ${limit} starting slots used`));
      copy.append(
        node('p', 'mu-help', 'Personal skills are always active and do not use a starting slot.'),
      );
      for (const id of assigned) {
        const skill = skills.find((s) => s.id === id);
        const remove = this.button(`Remove ${skill?.name || id}`, () => {
          this.meta.unassignSkill(name, id);
          this.message = 'Skill removed.';
          this.render(`skill-${id}`);
        });
        remove.dataset.focus = `remove-${id}`;
        copy.append(remove);
      }
      if (assigned.length >= limit)
        copy.append(node('p', 'mu-requirements', 'Slots full. Remove a skill to choose another.'));
      const unlocked = this.meta.getUnlockedSkills();
      if (!unlocked.length)
        list.append(
          node('p', '', 'No starting skills unlocked yet. Visit Upgrades → Skills to unlock them.'),
        );
      for (const id of unlocked) {
        const skill = skills.find((s) => s.id === id);
        const active = assigned.includes(id);
        const b = this.button(
          '',
          () => {
            const ok = this.meta.assignSkill(name, id);
            this.message = ok
              ? `${skill?.name || id} assigned to ${name}.`
              : 'Unable to assign this skill.';
            this.render(ok ? `remove-${id}` : `skill-${id}`);
          },
          active,
        );
        b.className = 'mh-skill';
        b.dataset.focus = `skill-${id}`;
        b.disabled = active || assigned.length >= limit;
        b.append(
          node('strong', '', `${skill?.name || id}${active ? ' · Assigned' : ''}`),
          node('span', '', skill?.description || ''),
        );
        list.append(b);
      }
    }
    const actions = node('div', 'mu-actions');
    actions.append(node('span', 'mu-help', `${selection.commander} + ${selection.partner}`));
    const begin = this.button('Begin Run', () => void this.transition('DifficultySelect'));
    begin.className = 'mu-buy';
    begin.dataset.focus = 'begin';
    actions.append(begin);
    detail.append(copy, actions);
    split.append(list, detail);
    const status = node('div', 'mu-status', this.message || 'Progress stored on this device.');
    status.setAttribute('role', 'status');
    this.root.append(header, tabs, split);
    if (this.onboarding.length) {
      const hint = node('aside', 'mh-onboarding');
      hint.append(
        node('span', '', this.onboarding.join(' ')),
        this.button('Got it', () => {
          this.onboarding = [];
          this.render();
          this.root.querySelector('[data-focus="begin"]')?.focus();
        }),
      );
      this.root.append(hint);
    }
    this.root.append(status);
    list.scrollTop = scroll;
    if (this.pending) for (const b of this.root.querySelectorAll('button')) b.disabled = true;
    if (ownedFocus || preferredFocus) {
      const buttons = [...this.root.querySelectorAll('button:not(:disabled)')];
      const target =
        buttons.find((b) => b.dataset.focus === focus) ||
        buttons.find((b) => b.dataset.focus === this.tab) ||
        buttons[0] ||
        this.root;
      target.focus({ preventScroll: true });
    }
  }
  destroy() {
    this.hide();
  }
}
