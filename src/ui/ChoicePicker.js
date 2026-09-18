import { MenuSurface, element, button } from './MenuSurface.js';

// Presentation shared by unit, class and item choices. Eligibility belongs to
// each operation and is checked again immediately before applying a choice.
export class ChoicePicker {
  constructor({
    scene,
    title,
    choices,
    label,
    describe = () => '',
    blocked = () => '',
    apply,
    onClose,
  }) {
    Object.assign(this, { choices, label, describe, blocked, apply, onClose });
    this.selected = choices[0];
    this.surface = new MenuSurface(scene, title, () => this.close(), { modal: true });
    this.surface.root.classList.add('re-choice-picker');
    this.render();
    this.surface.focusContent();
  }
  render(message = '') {
    const body = this.surface.body;
    body.replaceChildren();
    const list = element('div', null, 're-scroll');
    for (const choice of this.choices) {
      const reason = this.blocked(choice);
      const row = button(
        null,
        () => {
          if (this.busy) return;
          this.selected = choice;
          this.render();
          this.surface.body.querySelector('[aria-pressed="true"]')?.focus();
        },
        're-btn re-row',
      );
      row.append(
        element('strong', this.label(choice)),
        element('small', reason || this.describe(choice)),
      );
      row.setAttribute('aria-pressed', String(this.selected === choice));
      list.append(row);
    }
    this.status = element('p', message);
    this.status.setAttribute('role', 'status');
    const confirm = button('Confirm', () => this.confirm(), 're-btn re-btn--primary');
    confirm.disabled = !this.selected || !!this.blocked(this.selected) || this.busy;
    body.append(list, this.status, confirm);
  }
  async confirm() {
    if (this.busy || this.closed || !this.selected) return;
    const reason = this.blocked(this.selected);
    if (reason) {
      this.render(reason);
      return;
    }
    this.busy = true;
    this.surface.root.setAttribute('aria-busy', 'true');
    for (const button of this.surface.root.querySelectorAll('button')) button.disabled = true;
    try {
      const result = await this.apply(this.selected);
      if (this.closed) return;
      if (result?.ok === false) {
        this.busy = false;
        this.surface.root.removeAttribute('aria-busy');
        this.surface.header.querySelector('button').disabled = false;
        this.render(result.reason);
        this.surface.focusContent();
      } else {
        this.busy = false;
        this.close();
      }
    } catch (error) {
      this.busy = false;
      if (!this.closed) {
        this.surface.root.removeAttribute('aria-busy');
        this.surface.header.querySelector('button').disabled = false;
        this.render('Could not apply this choice. Please try again.');
        this.surface.focusContent();
      }
      console.error('Choice application failed', error);
    }
  }
  close() {
    if (this.busy || this.closed) return;
    this.destroy();
    this.onClose?.();
  }
  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.surface.destroy();
  }
}
