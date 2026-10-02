import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindHoverPreview, FINE_HOVER_MEDIA } from '../src/ui/infoAffordance.js';

// A tiny element stand-in: just what bindHoverPreview touches.
function makeEl({ popover = true } = {}) {
  const el = {
    attrs: {},
    listeners: {},
    dataset: {},
    style: {},
    children: [],
    isConnected: false,
    textContent: '',
    mountedAfter: null,
    setAttribute(k, v) {
      el.attrs[k] = String(v);
    },
    getAttribute: (k) => el.attrs[k] ?? null,
    addEventListener(type, fn) {
      el.listeners[type] = fn;
    },
    after(node) {
      node.isConnected = true;
      el.mountedAfter = node;
    },
    closest: () => null,
    matches: () => false,
    replaceChildren(...nodes) {
      el.children = nodes;
      el.textContent = nodes.map((n) => n.textContent).join('');
    },
    getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 20, height: 20 }),
  };
  if (popover) {
    el.showPopover = vi.fn(() => {
      el.open = true;
    });
    el.hidePopover = vi.fn();
  }
  return el;
}

let popoverSupported;
let tips;
beforeEach(() => {
  popoverSupported = true;
  tips = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const tip = makeEl({ popover: popoverSupported });
      tips.push(tip);
      return tip;
    },
  });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 800);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('bindHoverPreview accessibility wiring', () => {
  it('a static preview is described from creation, before any hover', () => {
    const target = makeEl();
    const tip = bindHoverPreview(target, 'Mastery: the class bonus.');
    const described = target.getAttribute('aria-describedby');
    expect(described).toBe(tip.id);
    // The node the description points at already holds the text.
    expect(tip.textContent).toBe('Mastery: the class bonus.');
    expect(tip.dataset.footer).toBe('Click ⓘ for more');
  });

  it('a lazy preview points at nothing until its popover is mounted and filled', () => {
    vi.useFakeTimers();
    const target = makeEl();
    target.isConnected = true;
    const tip = bindHoverPreview(target, () => ({ content: 'Cost 5 HP', footer: 'Click' }), {
      media: FINE_HOVER_MEDIA,
    });
    // Touch never opens it, so no dangling id.
    expect(target.getAttribute('aria-describedby')).toBeNull();
    target.listeners.pointerenter({ pointerType: 'touch' });
    vi.advanceTimersByTime(1000);
    expect(target.getAttribute('aria-describedby')).toBeNull();
    expect(tip.isConnected).toBe(false);
    // A mouse opens it: now the id resolves to a mounted node with text.
    target.listeners.pointerenter({ pointerType: 'mouse' });
    vi.advanceTimersByTime(300);
    expect(tip.showPopover).toHaveBeenCalledOnce();
    expect(target.mountedAfter).toBe(tip);
    expect(target.getAttribute('aria-describedby')).toBe(tip.id);
    expect(tip.textContent).toBe('Cost 5 HP');
    expect(tip.dataset.footer).toBe('Click');
  });

  it('a skipped preview (null content) leaves no description behind', () => {
    vi.useFakeTimers();
    const target = makeEl();
    target.isConnected = true;
    bindHoverPreview(target, () => null);
    target.listeners.pointerenter({ pointerType: 'mouse' });
    vi.advanceTimersByTime(300);
    expect(target.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('bindHoverPreview without the Popover API', () => {
  it('falls back to a title with the content, unwrapping {content, footer}', () => {
    popoverSupported = false;
    const target = makeEl();
    expect(
      bindHoverPreview(target, () => ({ content: 'Cost 5 HP · 3 per battle', footer: 'x' })),
    ).toBeNull();
    expect(target.title).toBe('Cost 5 HP · 3 per battle');
  });

  it('joins node content and still handles static text', () => {
    popoverSupported = false;
    const rows = makeEl();
    bindHoverPreview(rows, () => ({
      content: [{ textContent: 'Cost 5 HP' }, { textContent: 'Needs Tome' }],
    }));
    expect(rows.title).toBe('Cost 5 HP Needs Tome');
    const plain = makeEl();
    bindHoverPreview(plain, 'About mastery');
    expect(plain.title).toBe('About mastery');
  });
});
