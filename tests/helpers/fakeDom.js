// Minimal DOM for unit-testing DOM presenters under Node (no jsdom in this
// repo). Implements only what the ceremony/menu surfaces touch: elements with
// classList/style/dataset/attributes, a tree with append/remove/replace,
// simple selectors (tag, #id, .class, :not(:disabled), comma lists),
// focus, and EventTarget-style listeners on window, document and elements.

class FakeClassList {
  constructor(el) {
    this.el = el;
  }
  _list() {
    return String(this.el.className || '')
      .split(/\s+/)
      .filter(Boolean);
  }
  _set(list) {
    this.el.className = [...new Set(list)].join(' ');
  }
  add(...names) {
    this._set([...this._list(), ...names]);
  }
  remove(...names) {
    this._set(this._list().filter((n) => !names.includes(n)));
  }
  contains(name) {
    return this._list().includes(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.contains(name) : Boolean(force);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

class FakeStyle {
  constructor() {
    this._props = {};
  }
  setProperty(name, value) {
    this._props[name] = String(value);
  }
  getPropertyValue(name) {
    return this._props[name] ?? '';
  }
  removeProperty(name) {
    delete this._props[name];
  }
}

class FakeEventTarget {
  constructor() {
    this._listeners = new Map();
  }
  addEventListener(type, fn, options) {
    const capture = options === true || Boolean(options?.capture);
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    const list = this._listeners.get(type);
    if (!list.some((entry) => entry.fn === fn && entry.capture === capture))
      list.push({ fn, capture, once: Boolean(options?.once) });
  }
  removeEventListener(type, fn, options) {
    const capture = options === true || Boolean(options?.capture);
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.findIndex((entry) => entry.fn === fn && entry.capture === capture);
    if (i >= 0) list.splice(i, 1);
  }
  listenerCount(type) {
    return this._listeners.get(type)?.length || 0;
  }
  totalListeners() {
    let n = 0;
    for (const list of this._listeners.values()) n += list.length;
    return n;
  }
  _fire(event, capture) {
    for (const entry of [...(this._listeners.get(event.type) || [])]) {
      if (entry.capture !== capture) continue;
      if (event._immediateStopped) return;
      entry.fn.call(this, event);
      if (entry.once) this.removeEventListener(event.type, entry.fn, entry.capture);
    }
  }
}

export class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    Object.assign(this, init);
    this.defaultPrevented = false;
    this._stopped = false;
  }
  preventDefault() {
    this.defaultPrevented = true;
  }
  stopPropagation() {
    this._stopped = true;
  }
  stopImmediatePropagation() {
    this._stopped = true;
    this._immediateStopped = true;
  }
}

function matchesSimple(el, selector) {
  let rest = selector.trim();
  if (!rest) return false;
  let notDisabled = false;
  rest = rest.replace(/:not\(:disabled\)/g, () => {
    notDisabled = true;
    return '';
  });
  if (notDisabled && el.disabled) return false;
  const tag = /^[a-zA-Z][\w-]*/.exec(rest)?.[0];
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const [, id] of rest.matchAll(/#([\w-]+)/g)) if (el.id !== id) return false;
  for (const [, cls] of rest.matchAll(/\.([\w-]+)/g)) if (!el.classList.contains(cls)) return false;
  return true;
}

export class FakeElement extends FakeEventTarget {
  constructor(tagName, doc) {
    super();
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.id = '';
    this.style = new FakeStyle();
    this.dataset = {};
    this.attributes = {};
    this._text = '';
    this.hidden = false;
    this.inert = false;
    this.disabled = false;
    this.classList = new FakeClassList(this);
    this.rect = { left: 0, top: 0, width: 640, height: 480 };
  }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    this.children = [];
    this._text = value == null ? '' : String(value);
  }
  get isConnected() {
    let node = this;
    while (node) {
      if (node === this.ownerDocument?.body) return true;
      node = node.parentNode;
    }
    return false;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  hasAttribute(name) {
    return name in this.attributes;
  }
  _adopt(child) {
    if (typeof child === 'string') {
      const text = new FakeElement('#text', this.ownerDocument);
      text._text = child;
      child = text;
    }
    child.parentNode?._detach(child);
    child.parentNode = this;
    return child;
  }
  _detach(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
  }
  append(...nodes) {
    for (const node of nodes) this.children.push(this._adopt(node));
  }
  appendChild(node) {
    this.append(node);
    return node;
  }
  prepend(...nodes) {
    this.children.unshift(...nodes.map((n) => this._adopt(n)));
  }
  insertBefore(node, reference) {
    const child = this._adopt(node);
    const i = reference ? this.children.indexOf(reference) : -1;
    if (i < 0) this.children.push(child);
    else this.children.splice(i, 0, child);
    return node;
  }
  get lastChild() {
    return this.children.at(-1) || null;
  }
  get lastElementChild() {
    return this.children.filter((c) => c.tagName !== '#TEXT').at(-1) || null;
  }
  get firstElementChild() {
    return this.children.find((c) => c.tagName !== '#TEXT') || null;
  }
  get childElementCount() {
    return this.children.filter((c) => c.tagName !== '#TEXT').length;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) this._detach(child);
    this.append(...nodes);
  }
  remove() {
    this.parentNode?._detach(this);
  }
  contains(node) {
    while (node) {
      if (node === this) return true;
      node = node.parentNode;
    }
    return false;
  }
  _descendants() {
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  matches(selector) {
    return selector.split(',').some((s) => matchesSimple(this, s));
  }
  // Ancestor-or-self lookup. Bare attribute selectors ([hidden], [inert])
  // test the attribute or the matching boolean property.
  closest(selector) {
    const test = (el, part) => {
      const attr = /^\s*\[([\w-]+)\]\s*$/.exec(part);
      if (attr) return el.hasAttribute(attr[1]) || el[attr[1]] === true;
      return matchesSimple(el, part);
    };
    for (let node = this; node && node.tagName; node = node.parentNode) {
      if (node.tagName !== '#TEXT' && selector.split(',').some((part) => test(node, part)))
        return node;
    }
    return null;
  }
  getClientRects() {
    return this.isConnected ? [this.getBoundingClientRect()] : [];
  }
  querySelectorAll(selector) {
    return this._descendants().filter((el) => el.tagName !== '#TEXT' && el.matches(selector));
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
  }
  click() {
    this.dispatchEvent(new FakeEvent('click', { button: 0 }));
    this.onclick?.(new FakeEvent('click'));
  }
  getBoundingClientRect() {
    const { left, top, width, height } = this.rect;
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height };
  }
  get scrollWidth() {
    return 0;
  }
  get clientWidth() {
    return 0;
  }
  dispatchEvent(event) {
    event.target ||= this;
    const path = [];
    let node = this;
    while (node) {
      path.unshift(node);
      node = node.parentNode;
    }
    const win = this.ownerDocument?.defaultView;
    const chain = [win, this.ownerDocument, ...path].filter(Boolean);
    for (const target of chain) {
      if (event._stopped) break;
      event.currentTarget = target;
      target._fire(event, true);
    }
    for (const target of [...chain].reverse()) {
      if (event._stopped) break;
      event.currentTarget = target;
      target._fire(event, false);
    }
    return !event.defaultPrevented;
  }
}

class FakeDocument extends FakeEventTarget {
  constructor(win) {
    super();
    this.defaultView = win;
    this.body = new FakeElement('body', this);
    this.activeElement = this.body;
    this.fonts = { load: () => Promise.resolve([]) };
  }
  createElement(tag) {
    return new FakeElement(tag, this);
  }
  createTextNode(text) {
    const node = new FakeElement('#text', this);
    node._text = String(text);
    return node;
  }
  getElementById(id) {
    return this.body._descendants().find((el) => el.id === id) || null;
  }
  querySelector(selector) {
    return this.body.querySelector(selector);
  }
  querySelectorAll(selector) {
    return this.body.querySelectorAll(selector);
  }
}

class FakeWindow extends FakeEventTarget {}

/**
 * Install a fake window/document on globalThis. Returns helpers; call
 * `restore()` (or vi.unstubAllGlobals) afterwards.
 */
export function installFakeDom(vi, { wrapper = true } = {}) {
  const win = new FakeWindow();
  const doc = new FakeDocument(win);
  const originals = {};
  const stub = (name, value) => {
    originals[name] = globalThis[name];
    vi.stubGlobal(name, value);
  };
  stub('document', doc);
  stub('window', win);
  stub('addEventListener', win.addEventListener.bind(win));
  stub('removeEventListener', win.removeEventListener.bind(win));
  stub('getComputedStyle', () => ({ fontSize: '16px' }));
  stub('innerWidth', 844);
  stub('innerHeight', 390);
  let host = null;
  let container = null;
  let canvas = null;
  if (wrapper) {
    host = doc.createElement('div');
    host.id = 'game-wrapper';
    host.rect = { left: 0, top: 0, width: 844, height: 390 };
    container = doc.createElement('div');
    container.id = 'game-container';
    container.rect = { left: 0, top: 0, width: 622, height: 390 };
    canvas = doc.createElement('canvas');
    canvas.rect = { left: 0, top: 0, width: 622, height: 390 };
    container.append(canvas);
    host.append(container);
    doc.body.append(host);
  }
  const key = (keyName, init = {}) => {
    const event = new FakeEvent('keydown', { key: keyName, ...init });
    (doc.activeElement || doc.body).dispatchEvent(event);
    return event;
  };
  return { win, doc, host, container, canvas, key, FakeEvent };
}
