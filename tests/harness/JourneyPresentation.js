// Rendering-only substitutes. Production menus still create their real action
// callbacks; this is NOT a DOM/input/layout emulator (headed tests own those).
export class PresentationNode {
  constructor(tag = 'div', text = '', classes = '') {
    this.tag = tag;
    this.textContent = text || '';
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.className = classes;
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.scrollTop = 0;
  }
  append(...nodes) {
    for (const node of nodes) {
      node?.remove?.();
      if (node && typeof node === 'object') node.parent = this;
      this.children.push(node);
    }
  }
  prepend(...nodes) {
    this.children.unshift(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  insertBefore(node) {
    this.prepend(node);
  }
  setAttribute(key, value) {
    this.attributes[key] = value;
  }
  focus() {}
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
    this.parent = null;
  }
  get lastChild() {
    return this.children.at(-1);
  }
  all() {
    return [this, ...this.children.flatMap((n) => n?.all?.() || [])];
  }
  querySelector(selector) {
    if (selector === 'button') return this.all().find((n) => n.tag === 'button') || null;
    if (selector === '.shop-tabs [aria-pressed="true"]')
      return (
        this.all().find((n) => n.tag === 'button' && n.attributes['aria-pressed'] === 'true') ||
        null
      );
    return null;
  }
  querySelectorAll() {
    return [];
  }
}
export const element = (tag, text, classes) => new PresentationNode(tag, text, classes);
export function button(text, action, classes) {
  const node = element('button', text, classes);
  node.onclick = action;
  return node;
}
export class MenuSurface {
  constructor(scene, title, onClose) {
    scene._journeySurface = this;
    this.title = title;
    this.onClose = onClose;
    this.root = element('section');
    this.header = element('header');
    this.header.append(button('Close', onClose));
    this.body = element('main');
    this.root.append(this.header, this.body);
  }
  focusContent() {}
  destroy() {
    this.destroyed = true;
  }
}
export class ChoicePicker {
  constructor(options) {
    this.options = options;
  }
  destroy() {
    this.destroyed = true;
  }
  close() {
    this.destroy();
    this.options.onClose?.();
  }
}
export class PauseOverlay {
  constructor(scene, options) {
    this.options = options;
  }
  show() {
    this.visible = true;
  }
}
