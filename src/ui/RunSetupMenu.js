import { appendDetailScrollControls } from './DetailScrollControls.js';
import { InputAction } from '../utils/InputActions.js';
import { MenuSurface, element, button } from './MenuSurface.js';

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
      if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
        this.navigate(['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1);
        return true;
      }
      if (kind !== 'blessing' && event.key.toLowerCase() === 'm') {
        scene._toggleMetaMode();
        return true;
      }
      return false;
    };
    this.surface.onAction = (action, payload) => {
      if (action === InputAction.NAVIGATE) {
        const delta = payload?.dx || payload?.dy;
        if (delta) this.navigate(Math.sign(delta));
        return true;
      }
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
    const previousScroll = this.list?.scrollTop || 0;
    const choices = blessing
      ? [
          ...s.options,
          { name: 'No blessing', description: 'Begin without a blessing or its cost.' },
        ]
      : s.modes;
    const split = element('div', null, 're-split');
    this.list = element('div', null, 're-menu re-scroll');
    const detail = element('article', null, 're-card re-scroll re-reference-detail');
    choices.forEach((choice, i) => {
      const b = button(
        null,
        () => {
          if (blessing) s._select(i);
          else {
            s.selectedIndex = i;
            s._draw();
          }
        },
        're-btn re-row',
      );
      b.dataset.focus = `choice-${i}`;
      b.setAttribute('aria-pressed', String(i === s.selectedIndex));
      b.dataset.locked = String(!!choice.locked);
      b.append(element('strong', choice.name || choice.label));
      if (choice.tier) {
        b.style.borderLeft = `4px solid var(--re-tier-${choice.tier})`;
        b.append(
          element('small', `Tier ${['', 'I', 'II', 'III', 'IV'][choice.tier] || choice.tier}`),
        );
      }
      if (choice.locked) b.append(element('small', choice.lockReason));
      this.list.append(b);
    });
    const chosen = choices[s.selectedIndex];
    detail.append(element('h3', chosen?.name || chosen?.label || 'Choose an option'));
    if (blessing) {
      detail.append(element('p', chosen?.description || ''));
      if (chosen?.rolledCost?.label)
        detail.append(element('p', `Cost: ${chosen.rolledCost.label}`, 're-note'));
    } else {
      for (const line of chosen?.summary || []) detail.append(element('p', line));
      if (!chosen?.summary?.length)
        detail.append(element('p', 'Standard experience with no difficulty modifiers.'));
      if (chosen?.lockReason) detail.append(element('p', chosen.lockReason));
      const pair = s._noMetaUpgrades
        ? { commander: 'Edric', partner: 'Sera' }
        : s.meta?.getLordSelection?.();
      if (pair)
        detail.append(
          element('p', `Commander: ${pair.commander} · Partner: ${pair.partner}`, 're-note'),
        );
    }
    split.append(this.list, detail);
    const footer = element('footer', null, 're-footer');
    appendDetailScrollControls(footer, detail);
    if (!blessing) {
      const meta = button(`Army upgrades: ${s._noMetaUpgrades ? 'Off' : 'On'}`, () =>
        s._toggleMetaMode(),
      );
      meta.dataset.focus = 'meta';
      meta.setAttribute('aria-pressed', String(!s._noMetaUpgrades));
      footer.append(meta);
    }
    const confirm = button('Confirm', () => s._confirm(), 're-btn re-btn--primary');
    confirm.dataset.focus = 'confirm';
    confirm.disabled = !!chosen?.locked || s.isTransitioning;
    footer.append(confirm);
    this.surface.body.replaceChildren(split, footer);
    this.list.scrollTop = previousScroll;
    if (!this.initialFocusSet) {
      confirm.focus();
      this.initialFocusSet = true;
    } else if (oldFocus)
      this.surface.body.querySelector(`[data-focus="${oldFocus}"]`)?.focus({ preventScroll: true });
  }
  destroy() {
    this.surface.destroy();
  }
}
