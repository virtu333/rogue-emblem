import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { UnitInspectionPanel } from '../src/ui/UnitInspectionPanel.js';
import { MobileBattleHUD } from '../src/ui/MobileBattleHUD.js';

const enemy = () => ({ name: 'Archer', faction: 'enemy', col: 1, row: 1, currentHP: 20 });
function node(text) {
  const n = { text, handlers: {}, attributes: {}, children: [] };
  for (const name of ['setOrigin', 'setDepth', 'setStrokeStyle', 'setInteractive'])
    n[name] = () => n;
  n.on = (event, fn) => {
    n.handlers[event] = fn;
    return n;
  };
  n.destroy = vi.fn();
  n.setAttribute = (key, value) => {
    n.attributes[key] = value;
  };
  n.append = (...children) => n.children.push(...children);
  return n;
}
function scene() {
  const s = {
    grid: { fogEnabled: false },
    pinnedThreatEnemies: new Set(),
    add: { rectangle: vi.fn(() => node()), text: vi.fn((_x, _y, text) => node(text)) },
  };
  s.isThreatPinned = (u) => s.pinnedThreatEnemies.has(u);
  s.togglePinnedThreat = vi.fn((u) => {
    if (s.pinnedThreatEnemies.has(u)) s.pinnedThreatEnemies.delete(u);
    else s.pinnedThreatEnemies.add(u);
  });
  return s;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('inspection threat pin controls', () => {
  it('canvas offers a 44px action, updates its label, and isolates presentation RNG', () => {
    const s = scene(),
      u = enemy();
    const battleRandom = vi.fn(() => 0.5);
    const random = vi.spyOn(Math, 'random').mockImplementation(battleRandom);
    s.add.text.mockImplementation((_x, _y, text) => {
      Math.random();
      return node(text);
    });
    const panel = new UnitInspectionPanel(s);
    panel.show(u, null, {});
    expect(battleRandom).not.toHaveBeenCalled();
    const action = s.add.rectangle.mock.results[1].value;
    expect(s.add.rectangle.mock.calls[1][3]).toBe(44);
    expect(s.add.text.mock.calls.some((args) => args[2] === 'Pin range [T]')).toBe(true);
    action.handlers.pointerdown(null, 0, 0, { stopPropagation: vi.fn() });
    expect(s.togglePinnedThreat).toHaveBeenCalledWith(u);
    expect(s.add.text.mock.calls.some((args) => args[2] === 'Unpin range [T]')).toBe(true);
    random.mockRestore();
  });
  it('canvas excludes allies and fog-hidden enemies and explains replacement at the cap', () => {
    const s = scene(),
      panel = new UnitInspectionPanel(s),
      u = enemy();
    panel.show({ ...u, faction: 'player' }, null, {});
    expect(s.add.rectangle).toHaveBeenCalledTimes(1);
    s.grid = { fogEnabled: true, isVisible: () => false };
    panel.show(u, null, {});
    expect(panel.visible).toBe(false);
    s.grid.fogEnabled = false;
    s.pinnedThreatEnemies = new Set([1, 2, 3, 4, 5]);
    panel.show(u, null, {});
    expect(s.add.text.mock.calls.some((args) => args[2] === '5 pinned: replaces oldest.')).toBe(
      true,
    );
  });
  it('DOM exposes pressed state, cap explanation, and guards a stale inspection callback', () => {
    vi.stubGlobal('document', { createElement: () => node() });
    const s = scene(),
      u = enemy();
    s.inspectionPanel = { visible: true, _unit: u };
    s.pinnedThreatEnemies = new Set([1, 2, 3, 4, 5]);
    const hud = Object.create(MobileBattleHUD.prototype);
    hud.scene = s;
    hud.summary = node();
    hud.button = (label, action) => ({ ...node(label), action });
    hud.appendThreatPinControl(u);
    const control = hud.summary.children[0];
    expect(control.text).toBe('Pin range');
    expect(control.attributes['aria-pressed']).toBe('false');
    expect(hud.summary.children[1].textContent).toContain('replaces the oldest');
    control.action();
    expect(s.togglePinnedThreat).toHaveBeenCalledOnce();
    hud.summary.children = [];
    hud.appendThreatPinControl(u);
    expect(hud.summary.children[0].text).toBe('Unpin range');
    expect(hud.summary.children[0].attributes['aria-pressed']).toBe('true');
    s.grid = { fogEnabled: true, isVisible: () => false };
    control.action();
    expect(s.togglePinnedThreat).toHaveBeenCalledOnce();
    hud.summary.children = [];
    hud.appendThreatPinControl(u);
    expect(hud.summary.children).toEqual([]);
  });
});
