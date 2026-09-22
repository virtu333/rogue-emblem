import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Existing menu tests use small DOM adapters: no browser emulator dependency.
// Keep the real cancelable press primitive so canceled gestures exercise its gate.
const dom = vi.hoisted(() => {
  const state = { activeElement: null };
  const node = (tag, text = '', className = '') => {
    const listeners = new Map();
    const el = {
      tag,
      textContent: text ?? '',
      className,
      children: [],
      attributes: {},
      style: { setProperty: vi.fn() },
      isConnected: true,
      disabled: false,
      classList: { add: vi.fn() },
      append(...children) {
        this.children.push(...children);
      },
      insertBefore(child, reference) {
        const index = this.children.indexOf(reference);
        if (index < 0) this.children.push(child);
        else this.children.splice(index, 0, child);
      },
      replaceChildren(...children) {
        this.children = children;
      },
      setAttribute(key, value) {
        this.attributes[key] = value;
      },
      addEventListener(name, callback) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(callback);
      },
      removeEventListener(name, callback) {
        listeners.get(name)?.delete(callback);
      },
      dispatch(name, data = {}) {
        const event = { preventDefault() {}, stopPropagation() {}, ...data };
        for (const callback of listeners.get(name) || []) callback(event);
      },
      focus() {
        state.activeElement = this;
        this.dispatch('focus');
      },
      click(detail = 0) {
        this.dispatch('click', { detail });
      },
      closest: () => null,
      getClientRects: () => [1],
      getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 60 }),
      querySelector: function () {
        return this.children.find((item) => item.tag === 'button');
      },
    };
    return el;
  };
  return { state, node };
});
vi.mock('../src/ui/MenuSurface.js', () => ({
  element: dom.node,
  MenuSurface: class {
    constructor(scene, title, onClose) {
      this.root = dom.node('section', title);
      this.header = dom.node('header');
      this.body = dom.node('main');
      const close = dom.node('button', 'Close');
      close.addEventListener('click', onClose);
      this.header.append(close);
      this.root.append(this.header, this.body);
      this.destroy = vi.fn();
    }
  },
}));
import { BattleTimelineView } from '../src/ui/BattleTimelineView.js';

const text = (node) => [node.textContent, ...node.children.map(text)].join(' ');
const preview = {
  cols: 3,
  rows: 2,
  tiles: [{ col: 0, row: 0, label: 'Forest' }],
  units: [{ id: 'u1', name: 'Sera', faction: 'player', col: 0, row: 0, hp: 15, maxHP: 20 }],
  summary: ['Sera healed Edric.', 'Edric recovered 10 HP.'],
};
const history = () => ({
  policy: 'fixed-v1',
  entries: [
    {
      id: 1,
      kind: 'turn_start',
      turnNumber: 1,
      phase: 'player',
      destination: true,
      snapshotId: 's1',
      preview,
    },
    {
      id: 2,
      kind: 'player_action',
      turnNumber: 1,
      phase: 'player',
      destination: true,
      snapshotId: 's2',
      preview,
    },
    {
      id: 3,
      kind: 'enemy_action',
      turnNumber: 1,
      phase: 'enemy',
      destination: false,
      preview: { ...preview, summary: ['Unseen enemy attacked.'] },
    },
  ],
  snapshots: {
    s1: { phase: 'player', enemyUnits: [{ name: 'Secret enemy', col: 2, row: 1 }] },
    s2: { phase: 'player' },
  },
});
const make = (options = {}) =>
  new BattleTimelineView(
    {},
    {
      history: history(),
      charges: 2,
      allowPlayerActions: true,
      onClose: vi.fn(),
      onRewind: vi.fn(),
      ...options,
    },
  );
beforeEach(() => vi.stubGlobal('getComputedStyle', () => ({ visibility: 'visible' })));
afterEach(() => vi.unstubAllGlobals());

describe('Battle timeline view', () => {
  it('focuses the latest row; repeated row activation and focus never request a rewind', () => {
    const view = make();
    expect(dom.state.activeElement).toBe(view.rows.get(3));
    expect(view.selectedId).toBe(3);
    view.rows.get(2).focus();
    view.rows.get(2).click();
    view.rows.get(2).click();
    expect(view.selectedId).toBe(2);
    expect(view.rows.get(1).attributes['aria-pressed']).toBe('false');
    expect(view.rows.get(2).attributes['aria-pressed']).toBe('true');
    expect(view.onRewind).not.toHaveBeenCalled();
    view.rewindButton.click();
    expect(view.onRewind).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('opens the current row when supplied, without requesting a rewind', () => {
    const view = make({ currentEntryId: 2 });
    expect(dom.state.activeElement).toBe(view.rows.get(2));
    expect(view.selectedId).toBe(2);
    expect(view.rewindButton.disabled).toBe(true);
    expect(view.onRewind).not.toHaveBeenCalled();
  });

  it('uses recorded outcome facts for row labels and details, including casualties and misses', () => {
    const h = history();
    h.entries[2].facts = [
      'Enemy action completed.',
      'Archer critically hit Sera for 18 damage.',
      'Sera missed Archer.',
      'Sera fell.',
    ];
    h.entries[2].preview.summary = ['Turn 1 · Enemy phase', '20 battle gold'];
    const view = make({ history: h });
    expect(text(view.rows.get(3))).toContain('Archer critically hit Sera for 18 damage.');
    expect(text(view.rows.get(3))).not.toContain('Turn 1');
    expect(text(view.previewPanel)).toContain('Sera missed Archer.');
    expect(text(view.previewPanel)).toContain('Sera fell.');
    expect(text(view.previewPanel)).toContain('20 battle gold');
  });

  it('shows a generic rewind title for branch objects without exposing their internal fields', () => {
    const h = history();
    h.entries[2].kind = 'rewind';
    h.entries[2].facts = [{ type: 'rewind', targetId: 1 }];
    const view = make({ history: h });
    expect(text(view.rows.get(3))).toContain('Rewound here');
    expect(text(view.previewPanel)).toContain('Rewound here');
    expect(text(view.root)).not.toContain('targetId');
    expect(text(view.root)).not.toContain('[object Object]');
  });

  it('leaves explicit unknown terrain tiles masked', () => {
    const h = history();
    h.entries[2].preview.tiles = [{ col: 0, row: 0, label: 'Unknown' }];
    const view = make({ history: h });
    const board = view.previewPanel.children.find((node) => node.className === 'bt-board');
    expect(board.children.some((node) => node.className === 'bt-tile')).toBe(false);
    expect(text(view.previewPanel)).toContain('Unknown terrain');
  });

  it('renders only the saved visible projection, without touching scene, save, or RNG', () => {
    const scene = new Proxy(
      {},
      {
        get() {
          throw new Error('Live scene read');
        },
      },
    );
    const h = history();
    const before = JSON.stringify(h);
    const rng = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('RNG read');
    });
    try {
      const view = new BattleTimelineView(scene, { history: h, charges: 1 });
      view.select(3);
      const content = text(view.root);
      expect(content).toContain('Unseen enemy attacked.');
      expect(content).toContain('Sera · Ally · 15/20 HP · Column 1, row 1 · Forest');
      expect(content).not.toContain('Secret enemy');
      expect(content).toContain('Hatched tiles were unknown.');
      expect(JSON.stringify(h)).toBe(before);
      view.destroy();
    } finally {
      rng.mockRestore();
    }
  });

  it.each([
    [{ charges: 0 }, 1, 'No rewind charges'],
    [{ difficulty: 'lunatic' }, 2, 'Lunatic allows'],
    [{ allowPlayerActions: false }, 2, 'turn starts only'],
    [{ currentEntryId: 1 }, 1, 'already here'],
    [{}, 3, 'View only'],
  ])('explains unavailable destinations and blocks commit (%j)', (options, id, reason) => {
    const view = make(options);
    view.select(id);
    expect(view.rewindButton.disabled).toBe(true);
    expect(view.reason.textContent).toContain(reason);
    view.rewindButton.click();
    expect(view.onRewind).not.toHaveBeenCalled();
  });

  it('rechecks charge eligibility when the dedicated action is activated', () => {
    const view = make();
    view.select(1);
    expect(view.rewindButton.disabled).toBe(false);
    view.charges = 0;
    view.rewindButton.click();
    expect(view.onRewind).not.toHaveBeenCalled();
  });

  it('cancels slide-off and scrolling releases without a rewind request', () => {
    const view = make();
    view.select(1);
    const control = view.rewindButton;
    const pointer = { pointerId: 1, pointerType: 'touch', clientX: 20, clientY: 20 };
    control.dispatch('pointerdown', pointer);
    control.dispatch('pointermove', { ...pointer, clientY: 90 });
    control.dispatch('pointerup', { ...pointer, clientY: 90 });
    control.click(1);
    expect(view.onRewind).not.toHaveBeenCalled();
    control.dispatch('pointerdown', pointer);
    control.dispatch('pointercancel', pointer);
    control.click(1);
    expect(view.onRewind).not.toHaveBeenCalled();
    control.click(0); // Accessible/keyboard activation remains usable afterward.
    expect(view.onRewind).toHaveBeenCalledOnce();
  });

  it('handles empty and pruned histories, unavailable previews, and long literal text', () => {
    const empty = make({ history: { entries: [], snapshots: {} } });
    expect(empty.rewindButton.disabled).toBe(true);
    expect(text(empty.root)).toContain('History begins');
    const h = history();
    h.earlierHistoryUnavailable = true;
    h.entries[0].preview = { summary: ['<script>not markup</script>'.repeat(40)] };
    const view = make({ history: h });
    view.select(1);
    expect(text(view.root)).toContain('Earlier history unavailable.');
    expect(text(view.root)).toContain('No recorded board preview');
    expect(text(view.root)).toContain('<script>not markup</script>');
  });

  it('Back returns through the caller, including fatal context, and cleanup is idempotent', () => {
    const view = make({ fatal: true });
    expect(view.surface.header.querySelector('button').textContent).toBe('Back to decision');
    view.close();
    view.close();
    view.rewindButton.click();
    expect(view.onClose).toHaveBeenCalledOnce();
    expect(view.onRewind).not.toHaveBeenCalled();
  });
});
