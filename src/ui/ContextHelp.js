import { MenuSurface, element, button } from './MenuSurface.js';

// A child surface owns input without rebuilding or losing its parent's position.
export class ContextHelp {
  constructor(scene, parent, title, paragraphs, onClose) {
    this.parent = parent;
    this.wasInert = parent.inert;
    this.wasHidden = parent.getAttribute('aria-hidden');
    parent.inert = true;
    parent.setAttribute('aria-hidden', 'true');
    this.surface = new MenuSurface(
      scene,
      title,
      () => {
        this.destroy();
        onClose?.();
      },
      { modal: true },
    );
    this.surface.body.classList.add('re-scroll');
    for (const paragraph of paragraphs) {
      const text = element('p', paragraph);
      text.style.flexShrink = '0';
      this.surface.body.append(text);
    }
    const controls = element('div', null, 're-actions');
    for (const [label, direction] of [
      ['Read above', -1],
      ['Read below', 1],
    ])
      controls.append(button(label, () => this.surface.body.scrollBy({ top: direction * 100 })));
    this.surface.root.append(controls);
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.parent.inert = this.wasInert;
    if (this.wasHidden == null) this.parent.removeAttribute('aria-hidden');
    else this.parent.setAttribute('aria-hidden', this.wasHidden);
    this.surface.destroy();
  }
}
