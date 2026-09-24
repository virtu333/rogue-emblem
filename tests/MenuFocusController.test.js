import { describe, it, expect, vi } from 'vitest';
import { MenuFocusController } from '../src/ui/MenuFocusController.js';

const FOCUS = '#f3cb6c';
const DEFAULT = '#ece3d0';

function makeButton() {
  return {
    color: null,
    setColor(c) {
      this.color = c;
      return this;
    },
  };
}
function makeItems(labels) {
  return labels.map((label) => ({
    label,
    button: makeButton(),
    onActivate: vi.fn(),
    color: DEFAULT,
  }));
}

describe('MenuFocusController', () => {
  it('focuses and highlights the first item on setItems', () => {
    const c = new MenuFocusController({});
    const items = makeItems(['Attack', 'Item', 'Wait']);
    c.setItems(items);
    expect(c.index).toBe(0);
    expect(c.isActive).toBe(true);
    expect(items[0].button.color).toBe(FOCUS);
    expect(items[1].button.color).toBe(DEFAULT);
  });

  it('move wraps around and moves the highlight', () => {
    const c = new MenuFocusController({});
    const items = makeItems(['Attack', 'Item', 'Wait']);
    c.setItems(items);
    c.move(1); // -> Item
    expect(c.index).toBe(1);
    expect(items[1].button.color).toBe(FOCUS);
    expect(items[0].button.color).toBe(DEFAULT);
    c.move(-1); // back to Attack
    c.move(-1); // wraps to Wait
    expect(c.index).toBe(2);
    expect(items[2].button.color).toBe(FOCUS);
  });

  it('activate invokes only the focused item callback', () => {
    const c = new MenuFocusController({});
    const items = makeItems(['Attack', 'Item', 'Wait']);
    c.setItems(items);
    c.move(1); // Item
    expect(c.activate()).toBe(true);
    expect(items[1].onActivate).toHaveBeenCalledTimes(1);
    expect(items[0].onActivate).not.toHaveBeenCalled();
  });

  it('clear restores default colors and deactivates', () => {
    const c = new MenuFocusController({});
    const items = makeItems(['Attack', 'Wait']);
    c.setItems(items);
    c.clear();
    expect(c.isActive).toBe(false);
    expect(items[0].button.color).toBe(DEFAULT);
  });

  it('is inert with no items', () => {
    const c = new MenuFocusController({});
    c.setItems([]);
    expect(c.isActive).toBe(false);
    c.move(1);
    expect(c.activate()).toBe(false);
  });

  it('uses onFocus/onBlur callbacks instead of setColor when provided', () => {
    const c = new MenuFocusController({});
    const mk = () => ({ onFocus: vi.fn(), onBlur: vi.fn(), onActivate: vi.fn(), button: {} });
    const items = [mk(), mk(), mk()];
    c.setItems(items);
    // index 0 focused, others blurred
    expect(items[0].onFocus).toHaveBeenCalledTimes(1);
    expect(items[0].onBlur).not.toHaveBeenCalled();
    expect(items[1].onBlur).toHaveBeenCalledTimes(1);

    c.move(1); // focus -> 1: blur 0, focus 1
    expect(items[0].onBlur).toHaveBeenCalledTimes(1);
    expect(items[1].onFocus).toHaveBeenCalledTimes(1);

    c.clear(); // blur all
    expect(items[1].onBlur).toHaveBeenCalled();
  });
});

describe('destroyed Phaser objects', () => {
  it('never repaints on teardown after DisplayList destroys Text', () => {
    const c = new MenuFocusController({});
    const item = { button: { scene: {}, frame: { data: {} }, setColor: vi.fn() } };
    c.setItems([item]);
    item.button.scene = undefined;
    item.button.frame.data = null;
    item.button.setColor.mockImplementation(() => {
      throw Error('drawImage');
    });
    expect(() => c.destroy()).not.toThrow();
    expect(c.isActive).toBe(false);
  });
  it('skips stale custom hover and activation during menu replacement', () => {
    const c = new MenuFocusController({});
    const item = {
      button: { scene: null },
      onFocus: vi.fn(),
      onBlur: vi.fn(),
      onActivate: vi.fn(),
    };
    c.setItems([item]);
    c.move(1);
    expect(c.activate()).toBe(false);
    c.clear();
    expect(item.onFocus).not.toHaveBeenCalled();
    expect(item.onBlur).not.toHaveBeenCalled();
    expect(item.onActivate).not.toHaveBeenCalled();
  });

  it('focusIndex follows focus moved by keyboard or pointer without re-activating', () => {
    const c = new MenuFocusController({});
    const items = makeItems(['New Game', 'Save Slots', 'Records']);
    c.setItems(items);
    c.focusIndex(2);
    expect(c.index).toBe(2);
    expect(items[2].button.color).toBe(FOCUS);
    expect(items[0].button.color).toBe(DEFAULT);
    for (const bad of [-1, 3, 1.5, NaN, undefined]) {
      c.focusIndex(bad);
      expect(c.index).toBe(2);
    }
    c.move(1);
    expect(c.index).toBe(0);
    expect(items.every((it) => it.onActivate.mock.calls.length === 0)).toBe(true);
  });
});
