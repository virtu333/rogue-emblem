// The trade menu's DOM (src/ui/TradeMenu.js) on the fake DOM: what each input does,
// what the rows say to assistive tech, and that one intent commits at most once.
// The engine is the hand-written fake; `commit` applies moves the way the spec says
// ItemTrade does (give appends, swap keeps both slots).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeDom, FakeEvent } from './helpers/fakeDom.js';
import {
  CONVOY,
  applyFakeReorder,
  fakeEngine,
  supply,
  unit,
  weapon,
} from './helpers/fakeTradeEngine.js';
import { TradeMenu, tradeItemBrief } from '../src/ui/TradeMenu.js';
import { InputAction } from '../src/utils/InputActions.js';
import { _resetInputFocus, dispatchInputAction } from '../src/utils/inputFocus.js';
import { cancelTopOverlay } from '../src/utils/overlayStack.js';

function eventsFor() {
  const handlers = new Map();
  const listeners = (name) => handlers.get(name) || handlers.set(name, new Set()).get(name);
  return {
    once: (name, fn) => listeners(name).add(fn),
    on: (name, fn) => listeners(name).add(fn),
    off: (name, fn) => listeners(name).delete(fn),
    emit: (name) => [...listeners(name)].forEach((fn) => fn()),
  };
}

let dom;
beforeEach(() => {
  dom = installFakeDom(vi);
  _resetInputFocus();
});
afterEach(() => {
  vi.unstubAllGlobals();
  _resetInputFocus();
});

/** Moves between two units' bags the way applyTrade does. */
function applyMove(from, to) {
  const src = from.holder.unit[from.bag];
  const dst = to.holder.unit[to.bag];
  const i = src.indexOf(from.item);
  if (to.item) {
    const j = dst.indexOf(to.item);
    src[i] = to.item;
    dst[j] = from.item;
  } else {
    src.splice(i, 1);
    dst.push(from.item);
  }
}

function open({
  context = 'roster',
  left,
  right,
  held = null,
  cursor = null,
  engine = fakeEngine(),
  commit = null,
  reorder = undefined,
  bag = null,
} = {}) {
  const scene = { events: eventsFor() };
  const commits = [];
  const reorders = [];
  const onClose = vi.fn();
  const menu = new TradeMenu({
    scene,
    ctx: { context },
    left,
    right,
    bag,
    held,
    cursor,
    engine,
    onClose,
    commit:
      commit ||
      ((from, to) => {
        commits.push({ from, to });
        applyMove(from, to);
        return { ok: true };
      }),
    // `reorder: true` wires the default reorder (the fake apply); a function is used as is.
    reorder:
      reorder === true
        ? (from, to) => {
            reorders.push({ from, to });
            applyFakeReorder(from, to);
            return { ok: true };
          }
        : reorder,
  });
  return { menu, scene, commits, reorders, onClose, root: menu.surface.root };
}

const rowsOf = (root) => root.querySelectorAll('.tm-row');
const row = (root, side, index) =>
  rowsOf(root).find((el) => el.dataset.side === side && el.dataset.index === String(index));
const labels = (root, side) =>
  rowsOf(root)
    .filter((el) => el.dataset.side === side)
    .map((el) => el.getAttribute('aria-label'));
const status = (root) => root.querySelector('.tm-status');
const tabs = (root) => root.querySelectorAll('.tm-tab');
const focused = () => {
  const el = document.activeElement;
  if (el?.classList?.contains('tm-trade')) return 'dialog';
  return el?.dataset?.side ? `${el.dataset.side}:${el.dataset.index}` : el?.textContent;
};
const pressedRows = (root) =>
  rowsOf(root).filter((el) => el.getAttribute('aria-pressed') === 'true');
/** A pointer tap: a click with a click count (Enter, Space and pad A click with none). */
const tap = (el) => el.dispatchEvent(new FakeEvent('click', { detail: 1, button: 0 }));

function pair() {
  const iron = weapon('Iron Sword');
  const rapier = weapon('Rapier');
  const lance = weapon('Iron Lance');
  const edric = unit('Edric', { inventory: [iron, rapier], consumables: [supply('Vulnerary')] });
  const sera = unit('Sera', { inventory: [lance], cannotEquip: ['Rapier'] });
  return { iron, rapier, lance, edric, sera };
}

describe('item lines', () => {
  it('a staff in the convoy (no wielder) shows its base range instead of breaking', () => {
    const staff = { name: 'Silence Staff', type: 'Staff', range: '3-7', uses: 2 };
    expect(tradeItemBrief(staff, null)).toBe('Staff · Rng 3-7');
    expect(tradeItemBrief(staff, undefined)).toBe('Staff · Rng 3-7');
  });
});

describe('structure', () => {
  it('a titled dialog with bag tabs, two labelled columns, a live status and Done', () => {
    const { edric, sera } = pair();
    const { root } = open({ left: edric, right: sera });
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-label')).toBe('Trade items');
    expect(root.querySelector('h2').textContent).toBe('Trade items');
    expect(root.querySelector('.tm-done').textContent).toBe('Done');
    expect(
      tabs(root).map((t) => [
        t.textContent,
        t.getAttribute('role'),
        t.getAttribute('aria-selected'),
      ]),
    ).toEqual([
      ['Weapons 2/5 · 1/5', 'tab', 'true'],
      ['Supplies 1/3 · 0/3', 'tab', 'false'],
    ]);
    const groups = root.querySelectorAll('.tm-col');
    expect(groups.map((g) => g.getAttribute('role'))).toEqual(['group', 'group']);
    const heads = groups.map(
      (g) => document.getElementById(g.getAttribute('aria-labelledby')).textContent,
    );
    expect(heads).toEqual(['Edric2/5', 'Sera1/5']);
    expect(status(root).getAttribute('role')).toBe('status');
    expect(status(root).getAttribute('aria-live')).toBe('polite');
    expect(status(root).textContent).toBe('Choose an item to trade.');
    expect(labels(root, 'left')).toEqual([
      'Iron Sword, equipped',
      'Rapier',
      'Empty slot 3',
      'Empty slot 4',
      'Empty slot 5',
    ]);
    expect(root.querySelector('.tm-notice').hidden).toBe(true);
    // Rows are never natively disabled: blocked and empty rows stay focusable.
    expect(rowsOf(root).every((el) => el.tagName === 'BUTTON' && el.disabled === false)).toBe(true);
    expect(row(root, 'left', 2).getAttribute('aria-disabled')).toBe('true');
    // Nothing is highlighted on open: the dialog itself has focus, so keys arrive.
    expect(focused()).toBe('dialog');
    expect(root.tabIndex).toBe(-1);
  });

  it('battle: the header says trading locks in the move', () => {
    const { edric, sera } = pair();
    const { root } = open({ context: 'battle', left: edric, right: sera });
    expect(root.querySelector('.tm-notice').textContent).toBe("Trading locks in Edric's move.");
    expect(root.querySelector('.tm-notice').hidden).toBe(false);
  });

  it('nothing to trade: an empty state, focus on Done', () => {
    const { root } = open({ left: unit('Ana'), right: unit('Bo') });
    expect(root.querySelector('.tm-empty').textContent).toBe('Nothing to trade.');
    expect(root.querySelector('.tm-tabs').hidden).toBe(true);
    expect(rowsOf(root)).toEqual([]);
    expect(focused()).toBe('Done');
  });
});

describe('hold and commit', () => {
  it('first tap holds, second tap commits once; focus returns to the held slot', () => {
    const { edric, sera, rapier } = pair();
    const { root, commits } = open({ left: edric, right: sera });
    row(root, 'left', 1).click();
    expect(row(root, 'left', 1).getAttribute('aria-pressed')).toBe('true');
    expect(row(root, 'left', 0).getAttribute('aria-pressed')).toBe('false');
    expect(status(root).textContent).toBe(
      "Holding Rapier. Sera can't wield Rapier. Choose where it goes.",
    );
    expect(labels(root, 'right')).toEqual([
      'Trade Rapier for Iron Lance',
      'Give Rapier to Sera, slot 2',
      'Give Rapier to Sera, slot 3',
      'Give Rapier to Sera, slot 4',
      'Give Rapier to Sera, slot 5',
    ]);
    // Sera can't wield the held Rapier whichever slot takes it: the status line says so
    // once (above), and the target rows carry no repeated warning line.
    const target = row(root, 'right', 1);
    expect(target.querySelector('.tm-warn')).toBeNull();
    expect(commits).toHaveLength(0);

    target.click();
    expect(commits).toHaveLength(1);
    expect(commits[0].from.item).toBe(rapier);
    expect(commits[0].from.holder.unit).toBe(edric);
    expect(commits[0].to).toMatchObject({ bag: 'inventory', item: null });
    expect(commits[0].to.holder.unit).toBe(sera);
    expect(sera.inventory.at(-1)).toBe(rapier);
    expect(status(root).textContent).toBe('Gave Rapier to Sera.');
    expect(rowsOf(root).some((el) => el.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(focused()).toBe('left:1');
    expect(tabs(root)[0].textContent).toBe('Weapons 1/5 · 2/5');
  });

  it('a swap between two full bags keeps both slots', () => {
    const left = ['A', 'B', 'C', 'D', 'E'].map((n) => weapon(n));
    const right = ['V', 'W', 'X', 'Y', 'Z'].map((n) => weapon(n));
    const edric = unit('Edric', { inventory: [...left] });
    const sera = unit('Sera', { inventory: [...right] });
    const { root } = open({ left: edric, right: sera });
    row(root, 'left', 2).click();
    row(root, 'right', 4).click();
    expect(edric.inventory.map((i) => i.name)).toEqual(['A', 'B', 'Z', 'D', 'E']);
    expect(sera.inventory.map((i) => i.name)).toEqual(['V', 'W', 'X', 'Y', 'C']);
    expect(status(root).textContent).toBe('Traded C for Z.');
    expect(focused()).toBe('left:2');
  });

  it('tapping another item in the held column switches; tapping the held row releases', () => {
    const { edric, sera } = pair();
    const { root, commits } = open({ left: edric, right: sera });
    row(root, 'left', 1).click();
    row(root, 'left', 0).click();
    expect(row(root, 'left', 0).getAttribute('aria-pressed')).toBe('true');
    expect(row(root, 'left', 1).getAttribute('aria-pressed')).toBe('false');
    expect(labels(root, 'right')[0]).toBe('Trade Iron Sword for Iron Lance');
    row(root, 'left', 0).click();
    expect(rowsOf(root).some((el) => el.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(status(root).textContent).toBe('Choose an item to trade.');
    expect(commits).toHaveLength(0);
  });

  it('a blocked target explains itself in the status line and never commits', () => {
    const breath = weapon('Fire Breath', { noConvoy: true });
    const edric = unit('Edric', { inventory: [breath, weapon('Iron Sword')] });
    const engine = fakeEngine({ convoy: { weapons: [weapon('Axe')], consumables: [] } });
    const commit = vi.fn(() => ({ ok: true }));
    const { root } = open({ left: edric, right: CONVOY, engine, commit });
    row(root, 'left', 0).click();
    const give = row(root, 'right', 1);
    expect(give.getAttribute('aria-label')).toBe('Give Fire Breath to Convoy');
    expect(give.getAttribute('aria-disabled')).toBe('true');
    expect(give.disabled).toBe(false);
    give.click();
    expect(commit).not.toHaveBeenCalled();
    expect(status(root).textContent).toBe('The convoy cannot store this item.');
    // Focus alone says why too; an open row restores the line.
    row(root, 'left', 0).dispatchEvent(new FakeEvent('focus'));
    expect(status(root).textContent).toBe('Holding Fire Breath. Choose where it goes.');
    give.dispatchEvent(new FakeEvent('focus'));
    expect(status(root).textContent).toBe('The convoy cannot store this item.');
  });

  it('a refused commit keeps the item held and shows the reason', () => {
    const { edric, sera } = pair();
    const commit = vi.fn(() => ({ ok: false, reason: 'Unit is no longer in the roster.' }));
    const { root } = open({ left: edric, right: sera, commit });
    row(root, 'left', 1).click();
    row(root, 'right', 2).click();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(status(root).textContent).toBe('Unit is no longer in the roster.');
    expect(row(root, 'left', 1).getAttribute('aria-pressed')).toBe('true');
    expect(focused()).toBe('right:2');
  });

  it('while a commit is applying, more taps, cancel and Done do nothing', async () => {
    const { edric, sera, rapier } = pair();
    let resolve;
    const commit = vi.fn((from, to) => {
      applyMove(from, to);
      return new Promise((r) => (resolve = r));
    });
    const { root, onClose } = open({ left: edric, right: sera, commit });
    row(root, 'left', 1).click();
    const target = row(root, 'right', 1);
    target.click();
    target.click();
    dom.key('Escape');
    root.querySelector('.tm-done').click();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(root.getAttribute('aria-busy')).toBe('true');
    expect(onClose).not.toHaveBeenCalled();
    resolve({ ok: true, message: 'Rapier to Sera.' });
    await Promise.resolve();
    await Promise.resolve();
    expect(root.hasAttribute('aria-busy')).toBe(false);
    expect(status(root).textContent).toBe('Rapier to Sera.');
    expect(sera.inventory).toContain(rapier);
  });

  it('a scroll swipe that starts on a row never commits', () => {
    const { edric, sera } = pair();
    const commit = vi.fn(() => ({ ok: true }));
    const { root } = open({ left: edric, right: sera, commit });
    row(root, 'left', 1).click();
    const target = row(root, 'right', 1);
    target.rect = { left: 300, top: 100, width: 260, height: 44 };
    const at = (type, y) =>
      target.dispatchEvent(
        new FakeEvent(type, { pointerId: 1, clientX: 320, clientY: y, isPrimary: true, button: 0 }),
      );
    at('pointerdown', 110);
    at('pointermove', 140);
    at('pointerup', 140);
    target.dispatchEvent(new FakeEvent('click', { detail: 1, button: 0 }));
    expect(commit).not.toHaveBeenCalled();
    // A still tap on the same row commits.
    at('pointerdown', 110);
    at('pointerup', 111);
    target.dispatchEvent(new FakeEvent('click', { detail: 1, button: 0 }));
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

describe('cancel and close', () => {
  it('Escape releases the held item first, then closes', () => {
    const { edric, sera } = pair();
    const { root, onClose } = open({ left: edric, right: sera });
    row(root, 'left', 1).click();
    dom.key('Escape');
    expect(rowsOf(root).some((el) => el.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(focused()).toBe('left:1');
    expect(onClose).not.toHaveBeenCalled();
    dom.key('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.isConnected).toBe(false);
  });

  it('B and the overlay stack (rail Back) cancel the same way', () => {
    const { edric, sera } = pair();
    const { root, onClose, scene } = open({ left: edric, right: sera });
    row(root, 'left', 1).click();
    dispatchInputAction(InputAction.CANCEL);
    expect(rowsOf(root).some((el) => el.getAttribute('aria-pressed') === 'true')).toBe(false);
    row(root, 'left', 0).click();
    cancelTopOverlay(scene);
    expect(rowsOf(root).some((el) => el.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    cancelTopOverlay(scene);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Done closes even with an item held', () => {
    const { edric, sera } = pair();
    const { root, onClose } = open({ left: edric, right: sera });
    row(root, 'left', 1).click();
    root.querySelector('.tm-done').click();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(root.isConnected).toBe(false);
  });
});

describe('keyboard and gamepad', () => {
  it('arrows move in 2D and clamp; Enter activates the focused row', () => {
    const { edric } = pair();
    const engine = fakeEngine({ convoy: { weapons: [weapon('Axe')], consumables: [] } });
    const { root } = open({ left: edric, right: CONVOY, engine });
    dom.key('ArrowDown'); // shows the cursor on the first item
    expect(focused()).toBe('left:0');
    dom.key('ArrowDown');
    dom.key('ArrowDown');
    dom.key('ArrowDown');
    expect(focused()).toBe('left:3');
    dom.key('ArrowRight'); // convoy: Axe + one empty row
    expect(focused()).toBe('right:1');
    dom.key('ArrowDown');
    expect(focused()).toBe('right:1');
    dom.key('ArrowUp');
    dom.key('ArrowLeft');
    expect(focused()).toBe('left:0');
    dom.key('Enter');
    expect(row(root, 'left', 0).getAttribute('aria-pressed')).toBe('true');
  });

  it('Q/E and PageUp/PageDown switch tabs and release the held item', () => {
    const { edric, sera } = pair();
    const { root } = open({ left: edric, right: sera });
    dom.key('ArrowDown'); // shows the cursor
    dom.key('ArrowDown');
    dom.key('Enter');
    expect(row(root, 'left', 1).getAttribute('aria-pressed')).toBe('true');
    dom.key('e');
    expect(tabs(root).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(labels(root, 'left')).toEqual(['Vulnerary', 'Empty slot 2', 'Empty slot 3']);
    expect(rowsOf(root).some((el) => el.getAttribute('aria-pressed') === 'true')).toBe(false);
    expect(focused()).toBe('left:1');
    dom.key('PageUp');
    expect(tabs(root).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
    dom.key('Q');
    expect(tabs(root).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    dom.key('PageDown');
    expect(tabs(root).map((t) => t.getAttribute('aria-selected'))).toEqual(['true', 'false']);
  });

  it('gamepad: NAVIGATE moves, L1/R1 switch tabs, A activates', () => {
    const { edric, sera } = pair();
    const { root } = open({ left: edric, right: sera });
    dispatchInputAction(InputAction.NAVIGATE, { dx: 0, dy: 1 }); // shows the cursor
    expect(focused()).toBe('left:0');
    dispatchInputAction(InputAction.NAVIGATE, { dx: 0, dy: 1 });
    expect(focused()).toBe('left:1');
    dispatchInputAction(InputAction.CONFIRM);
    expect(row(root, 'left', 1).getAttribute('aria-pressed')).toBe('true');
    dispatchInputAction(InputAction.NAVIGATE, { dx: 1, dy: 0 });
    expect(focused()).toBe('right:1');
    dispatchInputAction(InputAction.NEXT_UNIT);
    expect(tabs(root)[1].getAttribute('aria-selected')).toBe('true');
    dispatchInputAction(InputAction.PREV_UNIT);
    expect(tabs(root)[0].getAttribute('aria-selected')).toBe('true');
  });

  it('stacked holders (upright): Down at the end of the upper one reaches the lower one', () => {
    const { edric, sera } = pair();
    const { root } = open({ left: edric, right: sera });
    // Lay the columns out one above the other, as trade.css does upright.
    const stack = () => {
      root.querySelector('.tm-col-left').rect = { left: 0, top: 100, width: 375, height: 250 };
      root.querySelector('.tm-col-right').rect = { left: 0, top: 358, width: 375, height: 250 };
    };
    stack();
    dom.key('ArrowDown'); // shows the cursor on left:0
    for (let i = 0; i < 4; i++) dom.key('ArrowDown');
    expect(focused()).toBe('left:4');
    dom.key('ArrowDown');
    expect(focused()).toBe('right:0');
    dom.key('ArrowUp');
    expect(focused()).toBe('left:4');
    // Side by side (the default boxes), the same key stays in the column.
    root.querySelector('.tm-col-right').rect = { left: 190, top: 100, width: 180, height: 250 };
    dom.key('ArrowDown');
    expect(focused()).toBe('left:4');
    // The gamepad follows the same layout.
    stack();
    dispatchInputAction(InputAction.NAVIGATE, { dx: 0, dy: 1 });
    expect(focused()).toBe('right:0');
  });

  it('opened with an item held: the cursor starts on the other column', () => {
    const { edric, sera, rapier } = pair();
    const { root } = open({
      left: edric,
      right: sera,
      held: { holder: { kind: 'unit', unit: edric }, bag: 'inventory', item: rapier },
    });
    expect(row(root, 'left', 1).getAttribute('aria-pressed')).toBe('true');
    expect(focused()).toBe('dialog');
    dom.key('ArrowDown'); // shows it without moving
    expect(focused()).toBe('right:1');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Give Rapier to Sera, slot 2');
  });
});

describe('the cursor is hidden until the first key or pad press', () => {
  it('on open, no row is focused or pressed; the dialog takes the keys', () => {
    const { edric, sera } = pair();
    const { root } = open({ left: edric, right: sera });
    expect(focused()).toBe('dialog');
    expect(pressedRows(root)).toEqual([]);
    expect(status(root).textContent).toBe('Choose an item to trade.');
  });

  it.each([
    ['ArrowDown', () => dom.key('ArrowDown')],
    ['ArrowRight', () => dom.key('ArrowRight')],
    ['Tab', () => dom.key('Tab')],
    ['Shift+Tab', () => dom.key('Tab', { shiftKey: true })],
    ['Enter', () => dom.key('Enter')],
    ['Space', () => dom.key(' ')],
    ['pad D-pad', () => dispatchInputAction(InputAction.NAVIGATE, { dx: 1, dy: 0 })],
    ['pad A', () => dispatchInputAction(InputAction.CONFIRM)],
  ])('%s shows the cursor where it is, without moving or activating', (_name, press) => {
    const { edric, sera } = pair();
    const { root, commits } = open({ left: edric, right: sera });
    press();
    expect(focused()).toBe('left:0');
    expect(pressedRows(root)).toEqual([]);
    expect(commits).toEqual([]);
    // The next press acts as usual.
    dom.key('Enter');
    expect(pressedRows(root).map((el) => `${el.dataset.side}:${el.dataset.index}`)).toEqual([
      'left:0',
    ]);
  });

  it('opened from an item card: nothing held, the hidden cursor on that item', () => {
    const { edric, sera, rapier } = pair();
    const { root, commits } = open({
      left: edric,
      right: sera,
      cursor: { holder: { kind: 'unit', unit: edric }, bag: 'inventory', item: rapier },
    });
    expect(pressedRows(root)).toEqual([]);
    expect(focused()).toBe('dialog');
    expect(status(root).textContent).toBe('Choose an item to trade.');
    dom.key('ArrowUp'); // shows the cursor on Rapier, not above it
    expect(focused()).toBe('left:1');
    expect(commits).toEqual([]);
  });

  it('a cursor on a convoy item (a clone) finds its row; the tab follows its bag', () => {
    const { edric } = pair();
    const axe = weapon('Axe');
    const tonic = supply('Tonic');
    const engine = fakeEngine({ convoy: { weapons: [axe], consumables: [supply('Herb'), tonic] } });
    const { root } = open({
      left: edric,
      right: CONVOY,
      engine,
      cursor: { holder: CONVOY, bag: 'consumables', item: { ...tonic } },
    });
    expect(tabs(root).map((t) => t.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    expect(pressedRows(root)).toEqual([]);
    dom.key('Enter');
    expect(focused()).toBe('right:1');
    expect(pressedRows(root)).toEqual([]);
  });

  it('a pointer tap holds and commits without leaving a row focused', () => {
    const { edric, sera, rapier } = pair();
    const { root, commits } = open({ left: edric, right: sera });
    tap(row(root, 'left', 1));
    expect(pressedRows(root).map((el) => el.dataset.index)).toEqual(['1']);
    expect(focused()).toBe('dialog');
    tap(row(root, 'right', 1));
    expect(commits).toHaveLength(1);
    expect(sera.inventory.at(-1)).toBe(rapier);
    expect(focused()).toBe('dialog');
    // Holding and releasing by tap leave no row focused either.
    tap(row(root, 'left', 0));
    tap(row(root, 'left', 0)); // release
    expect(focused()).toBe('dialog');
    // A browser focuses a pressed button: a tap on an inert row still ends on the dialog.
    const empty = row(root, 'left', 3);
    empty.focus();
    tap(empty);
    expect(focused()).toBe('dialog');
    // The first key after taps shows the cursor on the last row tapped.
    dom.key('ArrowDown');
    expect(focused()).toBe('left:3');
  });

  it('a key press after a tap keeps the focused row as the cursor (Enter clicks with no count)', () => {
    const { edric, sera } = pair();
    const { root } = open({ left: edric, right: sera });
    tap(row(root, 'left', 1));
    dom.key('Enter'); // shows the cursor on Rapier; does not release it
    expect(focused()).toBe('left:1');
    expect(pressedRows(root).map((el) => el.dataset.index)).toEqual(['1']);
    dom.key('ArrowRight');
    dom.key('Enter');
    expect(focused()).toBe('left:1');
    expect(sera.inventory.map((i) => i.name)).toEqual(['Iron Lance', 'Rapier']);
  });

  it('Escape with the cursor hidden releases without showing it', () => {
    const { edric, sera } = pair();
    const { root } = open({ left: edric, right: sera });
    tap(row(root, 'left', 1));
    dom.key('Escape');
    expect(pressedRows(root)).toEqual([]);
    expect(focused()).toBe('dialog');
  });
});

describe('reorder within a unit', () => {
  it('two taps in a unit column swap places; a swap into slot 1 equips', () => {
    const { edric, sera, iron, rapier } = pair();
    const extra = weapon('Steel Sword');
    edric.inventory.push(extra);
    const { root, commits, reorders } = open({ left: edric, right: sera, reorder: true });
    row(root, 'left', 2).click();
    expect(labels(root, 'left').slice(0, 3)).toEqual([
      'Equip Steel Sword',
      'Swap Steel Sword with Rapier',
      'Steel Sword',
    ]);
    expect(row(root, 'left', 0).dataset.state).toBe('reorder');
    expect(row(root, 'left', 0).hasAttribute('aria-pressed')).toBe(false);
    row(root, 'left', 0).click();
    expect(reorders).toHaveLength(1);
    expect(commits).toEqual([]);
    expect(edric.inventory).toEqual([extra, rapier, iron]);
    expect(edric.weapon).toBe(extra);
    expect(status(root).textContent).toBe('Steel Sword is now equipped.');
    expect(pressedRows(root)).toEqual([]);
    expect(labels(root, 'left')[0]).toBe('Steel Sword, equipped');
    expect(focused()).toBe('left:0');
    // A swap away from slot 1 changes order only.
    row(root, 'left', 1).click();
    row(root, 'left', 2).click();
    expect(edric.inventory).toEqual([extra, iron, rapier]);
    expect(edric.weapon).toBe(extra);
    expect(status(root).textContent).toBe('Swapped Rapier and Iron Sword.');
  });

  it('a slot-1 swap the unit cannot wield is blocked with the reason', () => {
    const lance = weapon('Iron Lance');
    const axe = weapon('Iron Axe');
    const sera = unit('Sera', { inventory: [lance, axe], cannotEquip: ['Iron Axe'] });
    const edric = unit('Edric', { inventory: [weapon('Iron Sword')] });
    const reorder = vi.fn(() => ({ ok: true }));
    const { root } = open({ left: edric, right: sera, reorder });
    row(root, 'right', 1).click();
    const first = row(root, 'right', 0);
    expect(first.getAttribute('aria-label')).toBe('Equip Iron Axe');
    expect(first.getAttribute('aria-disabled')).toBe('true');
    first.focus(); // as a browser does on press
    tap(first);
    expect(reorder).not.toHaveBeenCalled();
    expect(status(root).textContent).toBe("Sera can't wield Iron Axe.");
    expect(focused()).toBe('dialog');
    expect(sera.inventory).toEqual([lance, axe]);
  });

  it('the convoy column keeps switching what is held', () => {
    const { edric } = pair();
    const engine = fakeEngine({
      convoy: { weapons: [weapon('Axe'), weapon('Bow')], consumables: [] },
    });
    const { root, reorders } = open({ left: edric, right: CONVOY, engine, reorder: true });
    row(root, 'right', 0).click();
    expect(row(root, 'right', 1).dataset.state).toBe('switch');
    row(root, 'right', 1).click();
    expect(reorders).toEqual([]);
    expect(pressedRows(root).map((el) => `${el.dataset.side}:${el.dataset.index}`)).toEqual([
      'right:1',
    ]);
  });

  it('a refused reorder keeps the item held and says why', () => {
    const { edric, sera, iron, rapier } = pair();
    const reorder = vi.fn(() => ({ ok: false, reason: 'Trading is no longer available.' }));
    const { root } = open({ left: edric, right: sera, reorder });
    row(root, 'left', 1).click();
    row(root, 'left', 0).click();
    expect(reorder).toHaveBeenCalledOnce();
    expect(edric.inventory).toEqual([iron, rapier]);
    expect(status(root).textContent).toBe('Trading is no longer available.');
    expect(pressedRows(root).map((el) => el.dataset.index)).toEqual(['1']);
  });
});
