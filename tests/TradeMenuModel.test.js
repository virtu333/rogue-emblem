// The trade menu as data (docs/specs/item-trade.md, "UI"). The engine is a small
// hand-written fake: the model must show what the engine says, so every
// expectation below is read off the fake's rules, never off the model.
import { describe, expect, it } from 'vitest';
import {
  activateRow,
  baseStatus,
  buildTradeView,
  cancelAction,
  clampFocus,
  commitMessage,
  focusAfterCommit,
  initialFocus,
  navigate,
  rowAt,
  tradeWarningText,
} from '../src/ui/tradeMenuModel.js';

import {
  CONVOY,
  fakeEngine,
  ring,
  supply,
  unit,
  unitHolder,
  weapon,
} from './helpers/fakeTradeEngine.js';

function setup({ context = 'roster', left, right, engine = fakeEngine(), bags = null } = {}) {
  const L = left.kind ? left : unitHolder(left);
  const R = right.kind ? right : unitHolder(right);
  const ctx = { context };
  const view = (opts = {}) => buildTradeView({ ctx, left: L, right: R, bags, engine, ...opts });
  return { L, R, ctx, engine, view };
}

const names = (column) => column.rows.map((r) => (r.empty ? 'Empty' : r.item.name));
const states = (column) => column.rows.map((r) => r.state);

describe('tabs', () => {
  it('labels count each side against its capacity, in bag order', () => {
    const edric = unit('Edric', {
      inventory: [weapon('Iron Sword'), weapon('Steel Sword'), weapon('Rapier')],
      consumables: [supply('Vulnerary')],
    });
    const sera = unit('Sera', { inventory: [weapon('Iron Lance')] });
    const { view } = setup({ left: edric, right: sera });
    expect(view().tabs.map((t) => t.label)).toEqual(['Weapons 3/5 · 1/5', 'Supplies 1/3 · 0/3']);
  });

  it('a convoy column counts against the convoy capacity', () => {
    const edric = unit('Edric', { inventory: [weapon('Iron Sword')] });
    const engine = fakeEngine({
      convoy: { weapons: [weapon('Axe A'), weapon('Axe B')], consumables: [] },
      convoyCaps: { weapons: 40, consumables: 30 },
    });
    const { view } = setup({ left: edric, right: CONVOY, engine });
    expect(view().tabs.map((t) => t.label)).toEqual(['Weapons 1/5 · 2/40']);
  });

  it('hides a tab where nothing could move', () => {
    // No supplies on either side: Supplies is hidden, though both have free slots.
    const edric = unit('Edric', { inventory: [weapon('Iron Sword')] });
    const sera = unit('Sera');
    const { view } = setup({ left: edric, right: sera });
    expect(view().tabs.map((t) => t.bag)).toEqual(['inventory']);
    // Nothing at all: no tabs, an empty view.
    const bare = setup({ left: unit('A'), right: unit('B') }).view();
    expect(bare.tabs).toEqual([]);
    expect(bare.empty).toBe(true);
    expect(bare.columns).toBeNull();
    expect(baseStatus(bare)).toBe('Nothing to trade.');
  });

  it('shows Accessory only in the roster with two units', () => {
    const edric = unit('Edric', {
      inventory: [weapon('Iron Sword')],
      accessory: ring('Power Ring'),
    });
    const sera = unit('Sera', { accessory: ring('Speed Ring') });
    const roster = setup({ left: edric, right: sera }).view();
    expect(roster.tabs.map((t) => t.label)).toEqual(['Weapons 1/5 · 0/5', 'Accessory']);
    const battle = setup({ context: 'battle', left: edric, right: sera }).view();
    expect(battle.tabs.map((t) => t.bag)).toEqual(['inventory']);
    const convoy = setup({ left: edric, right: CONVOY }).view();
    expect(convoy.tabs.map((t) => t.bag)).toEqual(['inventory']);
    // A caller can narrow the bags further (BattleTradeMenu: Weapons and Supplies).
    const narrowed = setup({ left: edric, right: sera, bags: ['accessory'] }).view();
    expect(narrowed.tabs.map((t) => t.bag)).toEqual(['accessory']);
  });

  it('opens on the requested tab, else the held bag, else the first', () => {
    const vuln = supply('Vulnerary');
    const edric = unit('Edric', { inventory: [weapon('Iron Sword')], consumables: [vuln] });
    const { L, view } = setup({ left: edric, right: unit('Sera') });
    expect(view().bag).toBe('inventory');
    expect(view({ bag: 'consumables' }).bag).toBe('consumables');
    expect(view({ held: { holder: L, bag: 'consumables', item: vuln } }).bag).toBe('consumables');
    expect(view({ bag: 'accessory' }).bag).toBe('inventory'); // hidden → first
  });
});

describe('columns', () => {
  it('a unit shows every slot: items first, then Empty placeholders', () => {
    const edric = unit('Edric', {
      inventory: [weapon('Iron Sword'), weapon('Rapier')],
      consumables: [supply('Vulnerary')],
    });
    const sera = unit('Sera', {
      inventory: [weapon('A'), weapon('B'), weapon('C'), weapon('D'), weapon('E')],
    });
    const { view } = setup({ left: edric, right: sera });
    const v = view();
    expect(names(v.columns.left)).toEqual(['Iron Sword', 'Rapier', 'Empty', 'Empty', 'Empty']);
    expect(names(v.columns.right)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(v.columns.left.title).toBe('Edric');
    expect(v.columns.left.count).toBe('2/5');
    expect(v.columns.right.count).toBe('5/5');
    const s = view({ bag: 'consumables' });
    expect(names(s.columns.left)).toEqual(['Vulnerary', 'Empty', 'Empty']);
    expect(names(s.columns.right)).toEqual(['Empty', 'Empty', 'Empty']);
  });

  it('the convoy shows its items plus one empty row, none when full', () => {
    const edric = unit('Edric', { inventory: [weapon('Iron Sword')] });
    const room = setup({
      left: edric,
      right: CONVOY,
      engine: fakeEngine({ convoy: { weapons: [weapon('Axe'), weapon('Bow')], consumables: [] } }),
    }).view();
    expect(names(room.columns.right)).toEqual(['Axe', 'Bow', 'Empty']);
    expect(room.columns.right.title).toBe('Convoy');
    expect(room.columns.right.count).toBe('2/6');
    const full = setup({
      left: edric,
      right: CONVOY,
      engine: fakeEngine({
        convoy: { weapons: [weapon('Axe'), weapon('Bow')], consumables: [] },
        convoyCaps: { weapons: 2, consumables: 4 },
      }),
    }).view();
    expect(names(full.columns.right)).toEqual(['Axe', 'Bow']);
  });

  it('the accessory tab is one slot per unit', () => {
    const edric = unit('Edric', { accessory: ring('Power Ring') });
    const v = setup({ left: edric, right: unit('Sera') }).view({ bag: 'accessory' });
    expect(names(v.columns.left)).toEqual(['Power Ring']);
    expect(names(v.columns.right)).toEqual(['Empty']);
  });

  it('the equipped weapon leads and is marked', () => {
    const iron = weapon('Iron Sword');
    const steel = weapon('Steel Sword');
    const edric = unit('Edric', { inventory: [iron, steel] });
    edric.weapon = steel; // an old save: equipped weapon not first
    const v = setup({ left: edric, right: unit('Sera') }).view();
    expect(names(v.columns.left).slice(0, 2)).toEqual(['Steel Sword', 'Iron Sword']);
    expect(v.columns.left.rows[0].equipped).toBe(true);
    expect(v.columns.left.rows[0].name).toBe('Steel Sword, equipped');
    expect(v.columns.left.rows[1].name).toBe('Iron Sword');
  });
});

describe('rows', () => {
  const pair = () => {
    const iron = weapon('Iron Sword');
    const rapier = weapon('Rapier');
    const lance = weapon('Iron Lance');
    const edric = unit('Edric', { inventory: [iron, rapier] });
    const sera = unit('Sera', { inventory: [lance], cannotEquip: ['Rapier'] });
    return { iron, rapier, lance, edric, sera, ...setup({ left: edric, right: sera }) };
  };

  it('nothing held: items hold, empty slots are inert', () => {
    const { view } = pair();
    const v = view();
    expect(states(v.columns.left)).toEqual(['hold', 'hold', 'inert', 'inert', 'inert']);
    expect(states(v.columns.right)).toEqual(['hold', 'inert', 'inert', 'inert', 'inert']);
    expect(v.columns.left.rows.map((r) => r.pressed)).toEqual([false, false, null, null, null]);
    expect(v.columns.left.rows.map((r) => r.disabled)).toEqual([false, false, true, true, true]);
    // Empty slots are told apart by number (the third of Edric's five slots).
    expect(v.columns.left.rows[2].name).toBe('Empty slot 3');
    expect(baseStatus(v)).toBe('Choose an item to trade.');
  });

  it('an item held: its row releases, its column switches, the other column commits', () => {
    const { L, R, rapier, view, engine } = pair();
    const v = view({ held: { holder: L, bag: 'inventory', item: rapier } });
    expect(v.heldRow).toEqual({ side: 'left', index: 1 });
    expect(states(v.columns.left)).toEqual(['switch', 'release', 'inert', 'inert', 'inert']);
    expect(states(v.columns.right)).toEqual(['commit', 'commit', 'commit', 'commit', 'commit']);
    expect(v.columns.left.rows.map((r) => r.pressed)).toEqual([false, true, null, null, null]);
    expect(v.columns.right.rows.map((r) => r.pressed)).toEqual([null, null, null, null, null]);
    // Accessible names: a swap names both items, a give names the holder.
    expect(v.columns.right.rows[0].name).toBe('Trade Rapier for Iron Lance');
    expect(v.columns.right.rows[1].name).toBe('Give Rapier to Sera, slot 2');
    // Sera can't wield the held Rapier: said once, in the status line, not on each row.
    expect(baseStatus(v)).toBe("Holding Rapier. Sera can't wield Rapier. Choose where it goes.");
    // Every target was planned from the held slot to that row's slot.
    expect(engine.calls).toHaveLength(5);
    expect(engine.calls[0].from).toEqual({ holder: L, bag: 'inventory', item: rapier });
    expect(engine.calls[0].to.holder).toBe(R);
    expect(engine.calls[0].to.item.name).toBe('Iron Lance');
    expect(engine.calls[1].to).toEqual({ holder: R, bag: 'inventory', item: null });
  });

  it('carries the plan: kind and warning lines', () => {
    const { L, rapier, view } = pair();
    const v = view({ held: { holder: L, bag: 'inventory', item: rapier } });
    expect(v.columns.right.rows[0].kind).toBe('swap');
    expect(v.columns.right.rows[1].kind).toBe('give');
    expect(v.columns.right.rows[1].warnings).toEqual([]);
    expect(v.heldNotes).toEqual(["Sera can't wield Rapier"]);
  });

  it('no two rows in a column share an accessible name, held or not', () => {
    const { L, rapier, view } = pair();
    for (const v of [view(), view({ held: { holder: L, bag: 'inventory', item: rapier } })]) {
      for (const side of ['left', 'right']) {
        const names = v.columns[side].rows.map((r) => r.name);
        expect(new Set(names).size, `${side}: ${names.join(' | ')}`).toBe(names.length);
      }
    }
  });

  it('a unit left unarmed is warned about, not blocked', () => {
    const lance = weapon('Iron Lance');
    const sera = unit('Sera', { inventory: [lance] });
    const { R, view } = setup({
      left: unit('Edric', { inventory: [weapon('Iron Sword')] }),
      right: sera,
    });
    const v = view({ held: { holder: R, bag: 'inventory', item: lance } });
    const give = v.columns.left.rows[1];
    expect(give.name).toBe('Give Iron Lance to Edric, slot 2');
    expect(give.blocked).toBeNull();
    expect(give.disabled).toBe(false);
    expect(give.warnings).toEqual(['Leaves Sera unarmed']);
  });

  it('blocked targets carry the engine reason and stay rows (aria-disabled)', () => {
    const iron = weapon('Iron Sword');
    const edric = unit('Edric', { inventory: [iron] });
    edric.keepLast = true;
    const engine = fakeEngine({ convoy: { weapons: [weapon('Axe')], consumables: [] } });
    const { L, view } = setup({ left: edric, right: CONVOY, engine });
    const v = view({ held: { holder: L, bag: 'inventory', item: iron } });
    const [swap, give] = v.columns.right.rows;
    expect(swap.blocked).toBeNull();
    expect(give.blocked).toBe('Keep at least one combat weapon.');
    expect(give.disabled).toBe(true);
    expect(give.name).toBe('Give Iron Sword to Convoy');
    expect(give.warnings).toEqual([]);
    expect(activateRow(v, give)).toEqual({
      type: 'blocked',
      reason: 'Keep at least one combat weapon.',
    });
  });

  it('a give into a full bag is blocked with "Bag full." while swaps stay open', () => {
    const items = ['A', 'B', 'C', 'D', 'E'].map((n) => weapon(n));
    const sera = unit('Sera', { inventory: items });
    const rapier = weapon('Rapier');
    const edric = unit('Edric', { inventory: [rapier] });
    const { L, view } = setup({ left: edric, right: sera });
    const v = view({ held: { holder: L, bag: 'inventory', item: rapier } });
    // Sera is 5/5: no empty rows, every row is a swap and none is blocked.
    expect(v.columns.right.rows.map((r) => [r.name, r.blocked])).toEqual(
      items.map((i) => [`Trade Rapier for ${i.name}`, null]),
    );
    // From Sera's side, Edric's empty slots take a give.
    const back = view({ held: { holder: unitHolder(sera), bag: 'inventory', item: items[0] } });
    expect(back.columns.left.rows[1].name).toBe('Give A to Edric, slot 2');
    expect(back.columns.left.rows[1].blocked).toBeNull();
  });

  it('battle reasons come through as they are', () => {
    const iron = weapon('Iron Sword');
    const engine = fakeEngine({ convoy: { weapons: [weapon('Axe')], consumables: [] } });
    const { L, view } = setup({
      context: 'battle',
      left: unit('Edric', { inventory: [iron] }),
      right: CONVOY,
      engine,
    });
    const v = view({ held: { holder: L, bag: 'inventory', item: iron } });
    expect(v.columns.right.rows.map((r) => r.blocked)).toEqual([
      'The convoy is available between battles.',
      'The convoy is available between battles.',
    ]);
  });

  it('an engine that throws blocks the row instead of breaking the menu', () => {
    const iron = weapon('Iron Sword');
    const engine = fakeEngine();
    engine.planTrade = () => {
      throw new Error('boom');
    };
    const { L, view } = setup({
      left: unit('Edric', { inventory: [iron] }),
      right: unit('Sera'),
      engine,
    });
    const quiet = console.error;
    console.error = () => {};
    try {
      const v = view({ held: { holder: L, bag: 'inventory', item: iron } });
      expect(v.columns.right.rows[0].blocked).toBe('Cannot trade here.');
    } finally {
      console.error = quiet;
    }
  });

  it('the held convoy item is found again by uid (the convoy hands out clones)', () => {
    const axe = weapon('Axe');
    const engine = fakeEngine({ convoy: { weapons: [weapon('Bow'), axe], consumables: [] } });
    const { R, view } = setup({
      left: unit('Edric', { inventory: [weapon('Iron Sword')] }),
      right: CONVOY,
      engine,
    });
    const v = view({ held: { holder: R, bag: 'inventory', item: { ...axe } } });
    expect(v.heldRow).toEqual({ side: 'right', index: 1 });
    expect(v.held.item).not.toBe(axe);
    expect(v.held.item.uid).toBe(axe.uid);
    expect(v.held.holder).toBe(R);
  });

  it('unit items match by identity only; a gone item drops the hold', () => {
    const iron = weapon('Iron Sword');
    const edric = unit('Edric', { inventory: [iron] });
    const { L, view } = setup({
      left: edric,
      right: unit('Sera', { inventory: [weapon('Lance')] }),
    });
    const lookalike = { ...iron };
    const v = view({ held: { holder: L, bag: 'inventory', item: lookalike } });
    expect(v.held).toBeNull();
    expect(v.heldRow).toBeNull();
    expect(states(v.columns.left)[0]).toBe('hold');
  });

  it('a held item of another bag is not held on this tab', () => {
    const vuln = supply('Vulnerary');
    const edric = unit('Edric', { inventory: [weapon('Iron Sword')], consumables: [vuln] });
    const { L, view } = setup({ left: edric, right: unit('Sera') });
    const v = view({ bag: 'inventory', held: { holder: L, bag: 'consumables', item: vuln } });
    expect(v.bag).toBe('inventory');
    expect(v.held).toBeNull();
  });

  it('activating: hold, switch, release, commit, inert', () => {
    const { L, R, iron, rapier, view } = pair();
    const idle = view();
    expect(activateRow(idle, idle.columns.left.rows[1])).toEqual({
      type: 'hold',
      held: { holder: L, bag: 'inventory', item: rapier },
    });
    expect(activateRow(idle, idle.columns.left.rows[3])).toEqual({ type: 'none' });
    const held = view({ held: { holder: L, bag: 'inventory', item: rapier } });
    expect(activateRow(held, held.columns.left.rows[0])).toEqual({
      type: 'hold',
      held: { holder: L, bag: 'inventory', item: iron },
    });
    expect(activateRow(held, held.columns.left.rows[1])).toEqual({ type: 'release' });
    expect(activateRow(held, held.columns.left.rows[2])).toEqual({ type: 'none' });
    const give = activateRow(held, held.columns.right.rows[2]);
    expect(give).toEqual({
      type: 'commit',
      from: { holder: L, bag: 'inventory', item: rapier },
      to: { holder: R, bag: 'inventory', item: null },
      kind: 'give',
    });
    expect(activateRow(held, null)).toEqual({ type: 'none' });
  });
});

describe('cancel and messages', () => {
  it('cancel releases a held item first, then closes', () => {
    const iron = weapon('Iron Sword');
    const { L, view } = setup({ left: unit('Edric', { inventory: [iron] }), right: unit('Sera') });
    expect(cancelAction(view({ held: { holder: L, bag: 'inventory', item: iron } }))).toBe(
      'release',
    );
    expect(cancelAction(view())).toBe('close');
  });

  it('commit messages name both items for a swap, the holder for a give', () => {
    const L = unitHolder(unit('Edric'));
    const R = unitHolder(unit('Sera'));
    const from = { holder: L, bag: 'inventory', item: weapon('Iron Sword') };
    expect(
      commitMessage(from, { holder: R, bag: 'inventory', item: weapon('Steel Lance') }, 'swap'),
    ).toBe('Traded Iron Sword for Steel Lance.');
    expect(commitMessage(from, { holder: R, bag: 'inventory', item: null }, 'give')).toBe(
      'Gave Iron Sword to Sera.',
    );
    expect(commitMessage(from, { holder: CONVOY, bag: 'inventory', item: null }, 'give')).toBe(
      'Gave Iron Sword to Convoy.',
    );
  });

  it('warning codes read as sentences; unknown codes say nothing', () => {
    expect(
      tradeWarningText({
        code: 'cannot_equip',
        unit: { name: 'Sera' },
        item: { name: 'Iron Axe' },
      }),
    ).toBe("Sera can't wield Iron Axe");
    expect(tradeWarningText({ code: 'cannot_equip', unit: { name: 'Sera' } })).toBe(
      "Sera can't wield this",
    );
    expect(tradeWarningText({ code: 'leaves_unarmed', unit: { name: 'Edric' } })).toBe(
      'Leaves Edric unarmed',
    );
    expect(tradeWarningText({ code: 'mystery', unit: { name: 'Edric' } })).toBe('');
  });
});

describe('battle notice', () => {
  it('reads until the acting unit has committed its move, battle only', () => {
    const edric = unit('Edric', { inventory: [weapon('Iron Sword')] });
    const sera = unit('Sera');
    expect(setup({ context: 'battle', left: edric, right: sera }).view().notice).toBe(
      "Trading locks in Edric's move.",
    );
    edric._movementCommitted = true;
    expect(setup({ context: 'battle', left: edric, right: sera }).view().notice).toBe('');
    edric._movementCommitted = false;
    expect(setup({ context: 'roster', left: edric, right: sera }).view().notice).toBe('');
    // The notice shows even when there is nothing to trade.
    expect(setup({ context: 'battle', left: unit('Ana'), right: unit('Bo') }).view().notice).toBe(
      "Trading locks in Ana's move.",
    );
  });
});

describe('navigation', () => {
  // Left: 5 weapon slots, 3 supply slots. Right: the convoy with 2 weapons (+1 empty
  // row) and no supplies (+1 empty row).
  const board = () => {
    const edric = unit('Edric', {
      inventory: [weapon('Iron Sword'), weapon('Rapier')],
      consumables: [supply('Vulnerary')],
      accessory: ring('Power Ring'),
    });
    const engine = fakeEngine({
      convoy: { weapons: [weapon('Axe'), weapon('Bow')], consumables: [] },
    });
    return setup({ left: edric, right: CONVOY, engine });
  };

  it('up and down stay in the column and stop at its ends', () => {
    const v = board().view();
    expect(navigate(v, { side: 'left', index: 0 }, 'up').focus).toEqual({ side: 'left', index: 0 });
    expect(navigate(v, { side: 'left', index: 0 }, 'down').focus).toEqual({
      side: 'left',
      index: 1,
    });
    expect(navigate(v, { side: 'left', index: 4 }, 'down').focus).toEqual({
      side: 'left',
      index: 4,
    });
    expect(navigate(v, { side: 'right', index: 2 }, 'down').focus).toEqual({
      side: 'right',
      index: 2,
    });
  });

  it('left and right cross columns keeping the row, clamped to the shorter column', () => {
    const v = board().view();
    expect(navigate(v, { side: 'left', index: 1 }, 'right').focus).toEqual({
      side: 'right',
      index: 1,
    });
    expect(navigate(v, { side: 'left', index: 4 }, 'right').focus).toEqual({
      side: 'right',
      index: 2,
    });
    expect(navigate(v, { side: 'right', index: 2 }, 'left').focus).toEqual({
      side: 'left',
      index: 2,
    });
    expect(navigate(v, { side: 'left', index: 3 }, 'left').focus).toEqual({
      side: 'left',
      index: 3,
    });
    expect(navigate(v, { side: 'right', index: 0 }, 'right').focus).toEqual({
      side: 'right',
      index: 0,
    });
  });

  it('tab inputs wrap through visible tabs and clamp the focus to the new tab', () => {
    const v = board().view();
    expect(v.tabs.map((t) => t.bag)).toEqual(['inventory', 'consumables']);
    expect(v.tabs.map((t) => t.rowCounts)).toEqual([
      { left: 5, right: 3 },
      { left: 3, right: 1 },
    ]);
    expect(navigate(v, { side: 'left', index: 4 }, 'nextTab')).toEqual({
      bag: 'consumables',
      focus: { side: 'left', index: 2 },
    });
    expect(navigate(v, { side: 'right', index: 2 }, 'prevTab')).toEqual({
      bag: 'consumables',
      focus: { side: 'right', index: 0 },
    });
    const s = board().view({ bag: 'consumables' });
    expect(navigate(s, { side: 'left', index: 2 }, 'nextTab')).toEqual({
      bag: 'inventory',
      focus: { side: 'left', index: 2 },
    });
  });

  it('a single tab does not switch', () => {
    const edric = unit('Edric', { inventory: [weapon('Iron Sword')] });
    const v = setup({ left: edric, right: unit('Sera') }).view();
    expect(navigate(v, { side: 'right', index: 3 }, 'nextTab')).toEqual({
      bag: 'inventory',
      focus: { side: 'right', index: 3 },
    });
  });

  it('clamps stale focus and handles an empty view', () => {
    const v = board().view();
    expect(clampFocus(v, { side: 'right', index: 9 })).toEqual({ side: 'right', index: 2 });
    expect(clampFocus(v, null)).toEqual({ side: 'left', index: 0 });
    expect(rowAt(v, { side: 'right', index: 1 }).item.name).toBe('Bow');
    const bare = setup({ left: unit('A'), right: unit('B') }).view();
    expect(clampFocus(bare, { side: 'left', index: 0 })).toBeNull();
    expect(navigate(bare, { side: 'left', index: 0 }, 'down')).toEqual({ bag: null, focus: null });
    expect(initialFocus(bare)).toBeNull();
  });
});

describe('focus', () => {
  it('opens on the first item: left column, else right', () => {
    const iron = weapon('Iron Sword');
    const a = setup({ left: unit('Edric', { inventory: [iron] }), right: unit('Sera') }).view();
    expect(initialFocus(a)).toEqual({ side: 'left', index: 0 });
    const b = setup({ left: unit('Edric'), right: unit('Sera', { inventory: [iron] }) }).view();
    expect(initialFocus(b)).toEqual({ side: 'right', index: 0 });
  });

  it('with an item held, opens on the other column: same row if open, else the first open row', () => {
    const rapier = weapon('Rapier');
    const edric = unit('Edric', { inventory: [weapon('Iron Sword'), rapier] });
    const sera = unit('Sera', { inventory: [weapon('Lance')] });
    const { L, view } = setup({ left: edric, right: sera });
    expect(initialFocus(view({ held: { holder: L, bag: 'inventory', item: rapier } }))).toEqual({
      side: 'right',
      index: 1,
    });
    // Every target blocked: stay on the held row.
    const iron = weapon('Iron Sword');
    const engine = fakeEngine({ convoy: { weapons: [weapon('Axe')], consumables: [] } });
    const battle = setup({
      context: 'battle',
      left: unit('Edric', { inventory: [iron] }),
      right: CONVOY,
      engine,
    });
    expect(
      initialFocus(battle.view({ held: { holder: battle.L, bag: 'inventory', item: iron } })),
    ).toEqual({
      side: 'left',
      index: 0,
    });
  });

  it('first open row when the same row is blocked', () => {
    const iron = weapon('Iron Sword');
    const bow = weapon('Bow');
    const edric = unit('Edric', { inventory: [weapon('Lance'), iron] });
    const engine = fakeEngine({
      convoy: { weapons: [weapon('Axe'), bow], consumables: [] },
      convoyCaps: { weapons: 2, consumables: 4 },
    });
    const { L, view } = setup({ left: edric, right: CONVOY, engine });
    // Convoy full (no empty row): both rows are swaps. Make row 1 blocked by the engine.
    const plan = engine.planTrade;
    engine.planTrade = (ctx, from, to) =>
      to.item?.name === 'Bow' ? { ok: false, reason: 'No.' } : plan(ctx, from, to);
    expect(initialFocus(view({ held: { holder: L, bag: 'inventory', item: iron } }))).toEqual({
      side: 'right',
      index: 0,
    });
  });

  it('after a commit, focus returns to the same slot of the originating column', () => {
    // Before: Edric [Iron, Rapier, Steel], held Rapier (left, 1); give to Sera.
    const iron = weapon('Iron Sword');
    const rapier = weapon('Rapier');
    const steel = weapon('Steel Sword');
    const edric = unit('Edric', { inventory: [iron, steel] }); // after the give
    const sera = unit('Sera', { inventory: [rapier] });
    const after = setup({ left: edric, right: sera }).view();
    expect(focusAfterCommit(after, { side: 'left', index: 1 })).toEqual({ side: 'left', index: 1 });
    expect(rowAt(after, { side: 'left', index: 1 }).item).toBe(steel);
    // A convoy column that shrank past the old index clamps to its last row.
    const engine = fakeEngine({
      convoy: { weapons: [weapon('Axe')], consumables: [] },
      convoyCaps: { weapons: 1, consumables: 1 },
    });
    const convoy = setup({
      left: unit('Edric', { inventory: [weapon('X')] }),
      right: CONVOY,
      engine,
    }).view();
    expect(focusAfterCommit(convoy, { side: 'right', index: 3 })).toEqual({
      side: 'right',
      index: 0,
    });
  });
});
