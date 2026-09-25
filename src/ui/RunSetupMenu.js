import { appendDetailScrollControls } from './DetailScrollControls.js';
import { InputAction } from '../utils/InputActions.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { blessingCardContent, difficultyBannerContent } from './choiceContent.js';
import { blessingCardArt, costSeal } from './itemMoments.js';
import {
  choiceButton,
  choiceReducedMotion,
  draftRow,
  fadeScroll,
  fitDraft,
} from './choiceCards.js';

export class RunSetupMenu {
  constructor(scene, kind) {
    this.scene = scene;
    this.kind = kind;
    this.surface = new MenuSurface(
      scene,
      kind === 'blessing' ? 'Choose a blessing' : 'Choose difficulty',
      () => scene._back(),
    );
    this.surface.header.lastChild.textContent = 'Back';
    this.surface.onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (kind !== 'blessing' && event.key.toLowerCase() === 'm') {
        scene._toggleMetaMode();
        return true;
      }
      return false;
    };
    this.surface.onAction = (action) => {
      if (action === InputAction.DANGER && kind !== 'blessing' && !scene.isTransitioning) {
        scene._toggleMetaMode();
        return true;
      }
      return false;
    };
  }
  navigate(delta) {
    if (this.scene.isTransitioning) return;
    const count =
      this.kind === 'blessing' ? this.scene.options.length + 1 : this.scene.modes.length;
    this.scene.selectedIndex = (this.scene.selectedIndex + delta + count) % count;
    this.render();
    (
      this.surface.body.querySelector('[data-focus="confirm"]:not(:disabled)') ||
      this.surface.body.querySelector(`[data-focus="choice-${this.scene.selectedIndex}"]`)
    )?.focus();
  }
  render() {
    const s = this.scene,
      blessing = this.kind === 'blessing';
    const oldFocus = this.surface.body.contains(document.activeElement)
      ? document.activeElement.dataset.focus
      : null;
    this.surface.root.classList.add('ch-setup');
    this.surface.root.classList.toggle('is-still', choiceReducedMotion(s));
    const footer = element('footer', null, 're-footer ch-footer');
    const lead = element('p', null, 'ch-footer-lead');
    const parts = blessing ? this.blessings(lead) : this.difficulties(footer);
    footer.prepend(lead);
    if (blessing) {
      // "No blessing" is a face-down card kept beside the confirm.
      const none = s.options.length;
      const blank = button(null, () => s._select(none), 're-btn ch-blank');
      blank.append(element('span', null, 'ch-blank-back'), element('span', 'No blessing'));
      blank.dataset.focus = `choice-${none}`;
      blank.setAttribute('aria-pressed', String(s.selectedIndex === none));
      footer.append(blank);
    } else {
      const meta = button(`Army upgrades: ${s._noMetaUpgrades ? 'Off' : 'On'}`, () =>
        s._toggleMetaMode(),
      );
      meta.dataset.focus = 'meta';
      meta.setAttribute('aria-pressed', String(!s._noMetaUpgrades));
      footer.append(meta);
    }
    const chosen = blessing ? null : s.modes[s.selectedIndex];
    const confirm = button('Confirm', () => s._confirm(), 're-btn re-btn--primary');
    confirm.dataset.focus = 'confirm';
    confirm.disabled = !!chosen?.locked || s.isTransitioning;
    footer.append(confirm);
    this.surface.body.replaceChildren(...parts, footer);
    this.fitStop?.();
    this.fitStop = fitDraft(this.surface.body, '.ch-banner-name, .ch-tarot-name', { min: 10 });
    if (!this.initialFocusSet) {
      confirm.focus();
      this.initialFocusSet = true;
    } else if (oldFocus)
      this.surface.body.querySelector(`[data-focus="${oldFocus}"]`)?.focus({ preventScroll: true });
  }
  /** Shrine blessings as tarot: tier numeral, the Hollow Sun, boon and cost. */
  blessings(lead) {
    const s = this.scene;
    const row = draftRow(s.options.length, 'ch-tarots');
    s.options.forEach((option, i) => {
      const content = blessingCardContent(option);
      const card = choiceButton(content.name, () => s._select(i), 'ch-card ch-tarot');
      card.dataset.focus = `choice-${i}`;
      card.dataset.tier = String(content.tier);
      card.setAttribute('aria-pressed', String(i === s.selectedIndex));
      card.setAttribute(
        'aria-label',
        [
          content.name,
          content.numeral ? `Tier ${content.numeral}` : '',
          content.boon,
          content.cost ? `${content.costLabel}: ${content.cost}` : 'No cost',
        ]
          .filter(Boolean)
          .join(' · '),
      );
      const plate = element('span', null, 'ch-plate');
      // The tier numeral burns inside the Hollow Sun.
      const sun = element('span', null, 'ch-sun');
      sun.setAttribute('aria-hidden', 'true');
      sun.append(element('span', content.numeral, 'ch-numeral'));
      // The boon reads (and scrolls) above; the cost is always in view below.
      const lines = fadeScroll(element('span', null, 'ch-lines'));
      const boon = element('span', null, 'ch-boon');
      boon.append(element('span', 'Boon', 'ch-boon-k'), element('span', content.boon));
      lines.append(boon);
      const cost = element('span', null, `ch-cost${content.cost ? '' : ' is-none'}`);
      cost.append(
        element('span', content.costLabel, 'ch-boon-k'),
        element('span', content.cost || 'None: a clean gift'),
      );
      // The shrine's painting behind the numeral and the name (items art: blessing cards);
      // the cost wears a wax seal: crimson with a price, verdigris when the gift is clean.
      const art = content.id ? blessingCardArt(content.id) : null;
      if (art) {
        card.classList.add('has-art');
        plate.append(art);
      }
      cost.prepend(costSeal(!content.cost));
      plate.append(sun, element('strong', content.name, 'ch-tarot-name'), lines, cost);
      card.append(plate);
      row.append(card);
    });
    const chosen = blessingCardContent(s.options[s.selectedIndex]);
    lead.append(
      element(
        'span',
        chosen?.lore || 'Begin without a blessing or its cost.',
        chosen?.lore ? 'ch-lore' : '',
      ),
    );
    return [row];
  }
  /** Difficulty as hanging banners, the chosen mode's terms read beneath. */
  difficulties(footer) {
    const s = this.scene;
    const row = draftRow(s.modes.length, 'ch-banners');
    s.modes.forEach((mode, i) => {
      const content = difficultyBannerContent(mode, i);
      const card = choiceButton(
        content.name,
        () => {
          s.selectedIndex = i;
          s._draw();
        },
        'ch-card ch-banner',
      );
      card.dataset.focus = `choice-${i}`;
      card.dataset.mode = content.id;
      card.dataset.locked = String(content.locked);
      card.setAttribute('aria-pressed', String(i === s.selectedIndex));
      card.setAttribute(
        'aria-label',
        [content.name, content.locked ? `Locked · ${content.lockReason}` : '']
          .filter(Boolean)
          .join(' · '),
      );
      const plate = element('span', null, 'ch-plate');
      const threads = element('span', null, 'ch-threads');
      threads.setAttribute('aria-hidden', 'true');
      for (let n = 0; n < content.rank; n++) threads.append(element('i'));
      plate.append(threads, element('strong', content.name, 'ch-banner-name'));
      if (content.tagline) plate.append(element('span', content.tagline, 'ch-banner-tag'));
      if (content.rewards.length)
        plate.append(element('span', content.rewards[0], 'ch-banner-reward'));
      if (content.locked) plate.append(element('span', content.lockReason, 'ch-lock'));
      card.append(plate);
      row.append(card);
    });
    const chosen = difficultyBannerContent(s.modes[s.selectedIndex], s.selectedIndex);
    const detail = element('article', null, 're-card re-scroll ch-banner-detail');
    detail.append(element('h3', `${chosen.name || 'Choose an option'} · the terms`));
    const list = (lines, className = '') => {
      const ul = element('ul', null, className);
      for (const line of lines) ul.append(element('li', line));
      return ul;
    };
    if (chosen.harder.length) detail.append(list(chosen.harder));
    if (chosen.rewards.length) detail.append(list(chosen.rewards, 'ch-pays'));
    if (!chosen.harder.length && !chosen.rewards.length)
      detail.append(element('p', 'Standard experience with no difficulty modifiers.'));
    if (chosen.lockReason) detail.append(element('p', chosen.lockReason));
    const pair = s._noMetaUpgrades
      ? { commander: 'Edric', partner: 'Sera' }
      : s.meta?.getLordSelection?.();
    if (pair)
      detail.append(
        element('p', `Commander: ${pair.commander} · Partner: ${pair.partner}`, 're-note'),
      );
    appendDetailScrollControls(footer, detail);
    return [row, detail];
  }
  destroy() {
    this.fitStop?.();
    this.surface.destroy();
  }
}
