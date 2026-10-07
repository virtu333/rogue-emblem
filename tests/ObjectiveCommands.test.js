// Seize and Escape win the battle, so both battle menus mark them apart (playtest
// 2026-10-07: they looked like any other command). One rule, isObjectiveCommand; the
// rail gives the button `mb-win-command` (the exits' green, cohesion.css), the canvas
// colours the row's text. A greyed row is never marked.
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { readFileSync } from 'node:fs';
import { MobileBattleHUD } from '../src/ui/MobileBattleHUD.js';
import { isObjectiveCommand, OBJECTIVE_COMMAND_IDS } from '../src/ui/battleMenuModel.js';

function fakeElement(tag) {
  const node = {
    tag,
    className: '',
    textContent: '',
    children: [],
    attributes: {},
    listeners: {},
    dataset: {},
    style: {},
    hidden: false,
    disabled: false,
  };
  node.classList = {
    add: (...names) => names.forEach((n) => node.classList.toggle(n, true)),
    toggle: (name, on) => {
      const set = new Set(node.className.split(/\s+/).filter(Boolean));
      if (on ?? !set.has(name)) set.add(name);
      else set.delete(name);
      node.className = [...set].join(' ');
    },
    contains: (name) => node.className.split(/\s+/).includes(name),
  };
  node.append = (...kids) => node.children.push(...kids);
  node.prepend = (...kids) => node.children.unshift(...kids);
  node.replaceChildren = (...kids) => (node.children = [...kids]);
  node.setAttribute = (key, value) => (node.attributes[key] = String(value));
  node.addEventListener = (type, fn) => (node.listeners[type] ||= []).push(fn);
  node.querySelector = () => null;
  return node;
}

afterEach(() => vi.unstubAllGlobals());

describe('isObjectiveCommand', () => {
  it('is Seize and Escape, choosable, and nothing else', () => {
    expect(OBJECTIVE_COMMAND_IDS).toEqual(['seize', 'escape']);
    expect(isObjectiveCommand({ id: 'seize' })).toBe(true);
    expect(isObjectiveCommand({ id: 'escape' })).toBe(true);
    for (const id of ['attack', 'wait', 'capture', 'talk', 'item', 'equip', null])
      expect(isObjectiveCommand({ id }), String(id)).toBe(false);
    expect(isObjectiveCommand({ id: 'seize', disabled: true })).toBe(false);
    expect(isObjectiveCommand(null)).toBe(false);
  });
});

describe('the phone rail', () => {
  const buttonFor = (id, label, disabled = false) => {
    vi.stubGlobal('document', { createElement: fakeElement });
    const hud = Object.create(MobileBattleHUD.prototype);
    hud.scene = { battleState: 'UNIT_ACTION_MENU' };
    const unit = { name: 'Edric' };
    const item = { id, label, disabled, onActivate: vi.fn() };
    return hud.menuButton({ items: [item], objects: [], unit }, item);
  };

  it('marks Seize and Escape mb-win-command, never Attack, Wait or a greyed Seize', () => {
    expect(buttonFor('seize', 'Seize').className).toContain('mb-win-command');
    expect(buttonFor('escape', 'Escape').className).toContain('mb-win-command');
    expect(buttonFor('attack', 'Attack').className).not.toContain('mb-win-command');
    expect(buttonFor('attack', 'Attack').className).toContain('mb-primary');
    expect(buttonFor('wait', 'Wait').className).not.toContain('mb-win-command');
    expect(buttonFor('seize', 'Seize', true).className).not.toContain('mb-win-command');
  });

  it('styles mb-win-command from the palette tokens (the exits are drawn in good green)', () => {
    const css = readFileSync(new URL('../src/ui/cohesion.css', import.meta.url), 'utf8');
    const rule =
      css.match(/\.mobile-battle-hud \.mb-button\.mb-win-command \{([^}]*)\}/)?.[1] || '';
    expect(rule).toContain('background: var(--re-verdigris-deep)');
    expect(rule).toContain('border: 1px solid var(--re-good)');
  });
});
