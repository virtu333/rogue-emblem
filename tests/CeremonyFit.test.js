// Ceremony cards that outgrow a phone frame compact instead of squashing
// their words: fitSteps applies the compaction classes in order until the
// content fits, and flowOverflow measures a centred flex column including a
// reserved (padding) row. Layout itself is proven in
// tests/e2e/ux-ceremony-framing.spec.js; these pin the decisions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fitSteps, flowOverflow } from '../src/ui/ceremonyDom.js';

function classRoot(initial = []) {
  const set = new Set(initial);
  return {
    set,
    classList: {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
    },
  };
}

describe('fitSteps', () => {
  const steps = ['is-tight', 'is-tighter'];

  it('applies nothing when the content already fits', () => {
    const root = classRoot();
    expect(fitSteps(root, steps, () => 0)).toEqual({ applied: 0, fits: true });
    expect([...root.set]).toEqual([]);
  });

  it('stops at the first step that makes it fit', () => {
    const root = classRoot();
    // 30 px too tall; the first step saves 40.
    const over = () => (root.set.has('is-tight') ? -10 : 30);
    expect(fitSteps(root, steps, over)).toEqual({ applied: 1, fits: true });
    expect([...root.set]).toEqual(['is-tight']);
  });

  it('applies every step and reports when even that is not enough', () => {
    const root = classRoot();
    expect(fitSteps(root, steps, () => 12)).toEqual({ applied: 2, fits: false });
    expect([...root.set]).toEqual(['is-tight', 'is-tighter']);
  });

  it('clears earlier steps first: a larger frame (rotation) takes them back off', () => {
    const root = classRoot(['is-tight', 'is-tighter', 'keep-me']);
    expect(fitSteps(root, steps, () => 0)).toEqual({ applied: 0, fits: true });
    expect([...root.set]).toEqual(['keep-me']);
  });

  it('half a pixel of rounding is not an overflow', () => {
    expect(fitSteps(classRoot(), steps, () => 0.5)).toEqual({ applied: 0, fits: true });
  });

  it('ignores a missing root or measure', () => {
    expect(fitSteps(null, steps, () => 1)).toBeNull();
    expect(fitSteps(classRoot(), steps, null)).toBeNull();
  });
});

describe('flowOverflow', () => {
  afterEach(() => vi.unstubAllGlobals());
  const styles = new Map();
  const node = (offsetTop, offsetHeight, style = {}) => {
    const n = { offsetTop, offsetHeight };
    styles.set(n, { position: 'static', ...style });
    return n;
  };
  const box = (clientHeight, children, padding = [0, 0]) => {
    const b = { clientHeight, children };
    styles.set(b, { paddingTop: `${padding[0]}px`, paddingBottom: `${padding[1]}px` });
    return b;
  };
  const stub = () => vi.stubGlobal('getComputedStyle', (n) => styles.get(n) || {});

  it('counts the reserved end padding a scrollHeight on a visible box leaves out', () => {
    stub();
    // Centred content 20..300 (280 px) in a 320 px column with a 48 px button row.
    const kids = [node(20, 40), node(64, 180), node(250, 50)];
    expect(flowOverflow(box(320, kids, [0, 48]))).toBe(280 + 48 - 320);
  });

  it('ignores the centring offset and absolutely placed children', () => {
    stub();
    const kids = [node(100, 30), node(134, 30), node(0, 400, { position: 'absolute' })];
    expect(flowOverflow(box(300, kids))).toBe(64 - 300);
  });

  it('skips hidden (zero-height) children; an empty box never overflows', () => {
    stub();
    expect(flowOverflow(box(100, [node(0, 0), node(10, 20)]))).toBe(20 - 100);
    expect(flowOverflow(box(100, []))).toBe(0);
    expect(flowOverflow(null)).toBe(0);
  });
});
