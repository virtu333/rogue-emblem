import { InputAction } from '../utils/InputActions.js';
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
    confirmation = false,
    initialChoice = null,
    closeLabel = 'Close',
    preview = null,
  }) {
    Object.assign(this, {
      choices,
      label,
      describe,
      blocked,
      apply,
      onClose,
      confirmation,
      preview,
    });
    this.choices = Array.isArray(choices) ? choices : [];
    this.selected = this.choices.includes(initialChoice) ? initialChoice : this.choices[0];
    this.surface = new MenuSurface(scene, title, () => this.close(), { modal: true });
    this.surface.root.classList.add('re-choice-picker');
    this.surface.header.querySelector('button').textContent = closeLabel;
    if (preview) {
      this.surface.root.classList.add('has-preview');
      const scrollDetail = (direction) => {
        const panel = this.surface.body.querySelector('.re-choice-preview');
        if (panel) panel.scrollTop += direction * Math.max(80, panel.clientHeight * 0.7);
      };
      this.surface.onKey = (event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return false;
        if (!['PageUp', 'PageDown'].includes(event.key)) return false;
        scrollDetail(event.key === 'PageUp' ? -1 : 1);
        return true;
      };
      this.surface.onAction = (action) => {
        if (![InputAction.PREV_UNIT, InputAction.NEXT_UNIT].includes(action)) return false;
        scrollDetail(action === InputAction.PREV_UNIT ? -1 : 1);
        return true;
      };
    }
    this.render();
    const selectedRow = this.surface.body.querySelector('[aria-pressed="true"]');
    if (selectedRow) selectedRow.focus();
    else this.surface.focusContent();
  }
  render(message = '') {
    const body = this.surface.body;
    const listScroll = body.querySelector('.re-choice-list')?.scrollTop || 0;
    body.replaceChildren();
    const list = element('div', null, 're-scroll re-choice-list');
    for (const choice of this.confirmation ? [] : this.choices) {
      const reason = this.blocked(choice);
      const row = button(
        null,
        () => {
          if (this.busy) return;
          this.selected = choice;
          this.render();
          this.surface.body.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
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
    if (this.confirmation && this.selected) {
      list.append(
        element('h3', this.label(this.selected)),
        element('p', this.describe(this.selected)),
      );
    }
    this.status = element('p', message || (this.choices.length ? '' : 'No available choices.'));
    this.status.setAttribute('role', 'status');
    const confirm = button('Confirm', () => this.confirm(), 're-btn re-btn--primary');
    confirm.disabled = !this.selected || !!this.blocked(this.selected) || this.busy;
    if (this.preview) {
      const content = element('div', null, 're-choice-content');
      const detail = element('section', null, 're-scroll re-choice-preview');
      detail.setAttribute('aria-label', 'Selected choice details');
      detail.append(
        element('p', this.selected ? this.preview(this.selected) : 'No available choices.'),
      );
      content.append(list, detail);
      body.append(content, element('small', 'Scroll details · Page Up/Down or controller L/R'));
    } else body.append(list);
    body.append(this.status, confirm);
    list.scrollTop = listScroll;
  }
  async confirm() {
    if (this.busy || this.closed || !this.selected) return;
    const reason = this.blocked(this.selected);
    if (reason) {
      this.render(reason);
      this.surface.focusContent();
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
