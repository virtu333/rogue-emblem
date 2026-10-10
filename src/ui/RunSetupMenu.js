import { appendDetailScrollControls } from './DetailScrollControls.js';
import { InputAction } from '../utils/InputActions.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { blessingCardContent, difficultyBannerContent } from './choiceContent.js';
import { blessingTerms } from '../engine/BlessingTerms.js';
import { ContextHelp } from './ContextHelp.js';
import {
  blessingTarotCard,
  choiceButton,
  choiceReducedMotion,
  draftRow,
  draftScrollTop,
  fitDraft,
  keepDraftScroll,
  softList,
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
    const scrollTop = draftScrollTop(this.surface.body);
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
    keepDraftScroll(parts[0], scrollTop);
    this.fitStop?.();
    this.fitStop = fitDraft(this.surface.body, '.ch-banner-name, .ch-tarot-name', { min: 10 });
    if (!this.initialFocusSet) {
      confirm.focus();
      this.initialFocusSet = true;
    } else if (oldFocus)
      this.surface.body.querySelector(`[data-focus="${oldFocus}"]`)?.focus({ preventScroll: true });
  }
  /**
   * The whole of a price's terms in a help dialog: the footer's ⓘ (the chosen card) and a
   * press-and-hold on any priced card open it, so a touch player reads every word the
   * footer's three lines may cut. One at a time, never during a transition.
   */
  openPriceHelp(content, terms) {
    if (this.help || this.scene.isTransitioning || !terms.length) return;
    this.help = new ContextHelp(
      this.scene,
      this.surface.root,
      `${content.name}: the price`,
      [{ lead: `${content.costLabel}: ${content.cost}` }, { points: terms }],
      () => {
        this.help = null;
      },
    );
  }
  priceHelpEnabled() {
    return !this.help && !this.scene.isTransitioning;
  }
  /** Shrine blessings as tarot: tier numeral, the Hollow Sun, boon and cost. */
  blessings(lead) {
    const s = this.scene;
    const row = draftRow(s.options.length, 'ch-tarots');
    const termsOf = (content) =>
      content?.cost
        ? blessingTerms([content.cost], {
            burdens: s.gameData?.events?.burdens,
            difficultyId: s.difficultyId,
            pact: content.pact,
          })
        : [];
    s.options.forEach((option, i) => {
      const content = blessingCardContent(option);
      const terms = termsOf(content);
      const card = blessingTarotCard(content, {
        selected: i === s.selectedIndex,
        onSelect: () => s._select(i),
        terms,
        onHold: () => this.openPriceHelp(content, terms),
        holdEnabled: () => this.priceHelpEnabled(),
      });
      card.dataset.focus = `choice-${i}`;
      row.append(card);
    });
    const chosen = blessingCardContent(s.options[s.selectedIndex]);
    // A price that names a burden, shadow or Vision says what it means in place of the lore
    // (the card already says "Pact").
    const allTerms = termsOf(chosen);
    const chosenTerms = allTerms.filter((t) => t.term !== 'Pact');
    if (chosenTerms.length) {
      const terms = element('span', null, 'ch-term');
      for (const t of chosenTerms) terms.append(element('b', `${t.term}:`), ` ${t.text} `);
      // The words themselves open the whole price (a tap, Enter or a click): outside the
      // cards (a card is a button, and buttons can't nest), and no wider than the text,
      // so a short phone's list keeps its room.
      const open = button(null, () => this.openPriceHelp(chosen, allTerms), 'ch-term-open');
      open.setAttribute('aria-label', `About ${chosen.name}'s price`);
      open.dataset.focus = 'price-info';
      open.append(terms);
      lead.append(open);
    } else
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
      // A locked rung says how to open it instead (its reward is in the terms below):
      // four banners leave no room for both.
      if (content.locked) plate.append(element('span', content.lockReason, 'ch-lock'));
      else if (content.rewards.length)
        plate.append(element('span', content.rewards[0], 'ch-banner-reward'));
      card.append(plate);
      row.append(card);
    });
    const chosen = difficultyBannerContent(s.modes[s.selectedIndex], s.selectedIndex);
    // The terms scroll when long (Black Sun upright); their edges fade while there is more.
    const detail = softList(element('article', null, 're-card re-scroll ch-banner-detail'));
    detail.append(element('h3', `${chosen.name || 'Choose an option'} · the terms`));
    if (chosen.road) detail.append(element('p', chosen.road, 'ch-road'));
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
    this.help?.destroy();
    this.help = null;
    this.surface.destroy();
  }
}
