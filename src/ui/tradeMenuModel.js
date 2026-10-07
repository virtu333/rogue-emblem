// The item trade menu as data (docs/specs/item-trade.md, "UI"). Pure: no DOM, no
// engine import. The trade rules come in through `engine`
// ({ planTrade, planReorder?, bagItems, bagCapacity }, the shape of
// engine/ItemTrade.js), so a row's blocked reason and warnings are exactly what
// applying it would say.
//
// holder: { kind: 'unit', unit } | { kind: 'convoy' }
// slot:   { holder, bag: 'inventory' | 'consumables' | 'accessory', item | null }
// focus:  { side: 'left' | 'right', index } (a row of the visible tab)
import { itemDisplayName } from '../utils/itemNames.js';

// An item's display name (a Bond Ring shows its rarity and skill; no catalog needed here).
const shown = (item) => itemDisplayName(item);

export const TRADE_BAGS = Object.freeze([
  Object.freeze({ bag: 'inventory', label: 'Weapons' }),
  Object.freeze({ bag: 'consumables', label: 'Supplies' }),
  Object.freeze({ bag: 'accessory', label: 'Accessory' }),
]);

const SIDES = ['left', 'right'];
const otherSide = (side) => (side === 'left' ? 'right' : 'left');

export const isConvoyHolder = (holder) => holder?.kind === 'convoy';
export const holderUnit = (holder) => (holder?.kind === 'unit' ? holder.unit || null : null);

/** The column heading and the ⟨holder⟩ in "Give X to ⟨holder⟩". */
export function holderName(holder) {
  if (isConvoyHolder(holder)) return 'Convoy';
  return holderUnit(holder)?.name || 'Unit';
}

export function sameHolder(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (isConvoyHolder(a) || isConvoyHolder(b)) return isConvoyHolder(a) && isConvoyHolder(b);
  const unit = holderUnit(a);
  return unit != null && unit === holderUnit(b);
}

/** Unit bags match by identity; the convoy also by uid (getConvoyItems returns clones). */
export function sameItem(holder, a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  return isConvoyHolder(holder) && a.uid != null && a.uid === b.uid;
}

const withIndefinite = (noun) => `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;

/**
 * "Sera can't wield Iron Axe" / "Leaves Edric unarmed" / "Leaves Sera without a
 * staff" / "Leaves Kai without a bow" (`weaponType` in plain words); '' for an
 * unknown code. A swap can warn about both items, so each warning names its own.
 */
export function tradeWarningText(warning) {
  const name = warning?.unit?.name || 'This unit';
  if (warning?.code === 'cannot_equip')
    return warning.item?.name
      ? `${name} can't wield ${shown(warning.item)}`
      : `${name} can't wield this`;
  if (warning?.code === 'leaves_unarmed') return `Leaves ${name} unarmed`;
  if (warning?.code === 'leaves_no_staff') return `Leaves ${name} without a staff`;
  if (warning?.code === 'leaves_no_type' && warning.weaponType)
    return `Leaves ${name} without ${withIndefinite(String(warning.weaponType).toLowerCase())}`;
  return '';
}

/** Shown in the header until the acting unit's move is committed (battle only). */
export function tradeNotice(ctx, left) {
  const unit = holderUnit(left);
  if (ctx?.context !== 'battle' || !unit || unit._movementCommitted) return '';
  return `Trading locks in ${unit.name}'s move.`;
}

/**
 * The bags this menu may show, before hiding empty ones. Accessories trade only
 * between two units, and only between battles.
 */
export function tradeBags(ctx, left, right, bags = null) {
  const allowed = Array.isArray(bags) ? bags : TRADE_BAGS.map((b) => b.bag);
  const twoUnits = left?.kind === 'unit' && right?.kind === 'unit';
  return TRADE_BAGS.filter(
    ({ bag }) =>
      allowed.includes(bag) && (bag !== 'accessory' || (ctx?.context === 'roster' && twoUnits)),
  );
}

function bagContents(engine, ctx, holder, bag) {
  const raw = engine.bagItems(ctx, holder, bag);
  const list = Array.isArray(raw) ? raw.filter(Boolean) : [];
  const capacity = Math.max(0, Math.trunc(Number(engine.bagCapacity(ctx, holder, bag))) || 0);
  // Equipped weapon first (UnitManager.inventoryDisplayOrder); the engine keeps it
  // there after every trade, so this only matters for an old save.
  const weapon = bag === 'inventory' ? holderUnit(holder)?.weapon : null;
  const at = weapon ? list.indexOf(weapon) : -1;
  const items = at > 0 ? [weapon, ...list.slice(0, at), ...list.slice(at + 1)] : list;
  // A unit shows every slot; the convoy shows its items plus one free row.
  const empties = isConvoyHolder(holder)
    ? items.length < capacity
      ? 1
      : 0
    : Math.max(0, capacity - items.length);
  return { items, capacity, empties, free: Math.max(0, capacity - items.length) };
}

function tabLabel(label, bag, a, b) {
  if (bag === 'accessory') return label;
  return `${label} ${a.items.length}/${a.capacity} · ${b.items.length}/${b.capacity}`;
}

/**
 * A tab is shown only when something could move in it: one side has an item and
 * the other has an item (a swap) or a free slot (a give).
 */
function tradePossible(a, b) {
  return (
    (a.items.length > 0 && (b.items.length > 0 || b.free > 0)) || (b.items.length > 0 && a.free > 0)
  );
}

// A unit's empty slots all look alike, so each one's accessible name carries its slot
// number (1-based); the convoy shows a single empty row and needs none.
function emptySlotSuffix(row) {
  return isConvoyHolder(row.slot?.holder) ? '' : `, slot ${row.index + 1}`;
}

function rowName(row, held) {
  if (row.state === 'reorder')
    return row.equips
      ? `Equip ${shown(row.equips)}`
      : `Swap ${shown(held.item)} with ${shown(row.item)}`;
  if (row.state === 'commit') {
    return row.empty
      ? `Give ${shown(held.item)} to ${holderName(row.slot.holder)}${emptySlotSuffix(row)}`
      : `Trade ${shown(held.item)} for ${shown(row.item)}`;
  }
  if (row.empty) return isConvoyHolder(row.slot?.holder) ? 'Empty' : `Empty slot ${row.index + 1}`;
  return row.equipped ? `${shown(row.item)}, equipped` : shown(row.item);
}

function plan(engine, ctx, from, to, method = 'planTrade') {
  try {
    return engine[method](ctx, from, to) || { ok: false, reason: 'Cannot trade here.' };
  } catch (error) {
    console.error('Trade plan failed', error);
    return { ok: false, reason: 'Cannot trade here.' };
  }
}

/**
 * With an item held in a unit's column, another item in that column is a reorder: the
 * two swap places. The first weapon slot is the equipped one, so a swap that touches it
 * equips whichever item lands there (row.equips; the engine refuses one the unit can't
 * wield). Read from the rows, so a refused reorder is still named for what it would do.
 */
function reorderEquips(bag, heldRow, row, heldSlot) {
  if (bag !== 'inventory') return null;
  if (row.index === 0) return heldSlot.item;
  if (heldRow.index === 0) return row.item;
  return null;
}

/**
 * Everything the renderer draws.
 * @param {{ ctx, left, right, bags?: string[]|null, bag?: string|null, held?: object|null,
 *   reorder?: boolean, engine: { planTrade, planReorder?, bagItems, bagCapacity } }} options
 *   `left`/`right` are holders; `held` is a slot of one of them (or null). With
 *   `reorder` (and engine.planReorder), the other items in a held unit's column are
 *   'reorder' rows; otherwise (and always in the convoy's column) they switch.
 * @returns {{ ctx, left, right, bag: string|null, tabs: object[], columns: object|null,
 *   held: object|null, heldRow: {side, index}|null, heldNotes: string[], notice: string,
 *   empty: boolean }}
 *   `held` is re-resolved against the bags: the current instance, or null when the
 *   item left (or its bag is not the visible tab).
 */
export function buildTradeView({
  ctx,
  left,
  right,
  bags = null,
  bag = null,
  held = null,
  reorder = false,
  engine,
}) {
  const canReorder = reorder === true && typeof engine?.planReorder === 'function';
  const holders = { left, right };
  const tabs = [];
  const contents = new Map();
  for (const { bag: id, label } of tradeBags(ctx, left, right, bags)) {
    const a = bagContents(engine, ctx, left, id);
    const b = bagContents(engine, ctx, right, id);
    contents.set(id, { left: a, right: b });
    if (!tradePossible(a, b)) continue;
    tabs.push({
      bag: id,
      label: tabLabel(label, id, a, b),
      rowCounts: { left: a.items.length + a.empties, right: b.items.length + b.empties },
    });
  }
  const visible = (id) => tabs.some((t) => t.bag === id);
  const current = visible(bag) ? bag : visible(held?.bag) ? held.bag : tabs[0]?.bag || null;
  const notice = tradeNotice(ctx, left);
  if (!current) {
    return {
      ctx,
      left,
      right,
      bag: null,
      tabs,
      columns: null,
      held: null,
      heldRow: null,
      notice,
      empty: true,
    };
  }

  const columns = {};
  for (const side of SIDES) {
    const holder = holders[side];
    const { items, capacity, empties } = contents.get(current)[side];
    const unit = holderUnit(holder);
    const rows = items.map((item, index) => ({
      key: `${side}:${index}`,
      side,
      index,
      item,
      empty: false,
      equipped: current === 'inventory' && unit?.weapon === item,
      slot: { holder, bag: current, item },
    }));
    for (let i = 0; i < empties; i++) {
      const index = rows.length;
      rows.push({
        key: `${side}:${index}`,
        side,
        index,
        item: null,
        empty: true,
        equipped: false,
        slot: { holder, bag: current, item: null },
      });
    }
    const title = holderName(holder);
    const count = `${items.length}/${capacity}`;
    columns[side] = { side, holder, title, count, label: `${title} ${count}`, rows };
  }

  // Resolve the held item to its row in the visible tab (fresh instance for the convoy).
  let heldRow = null;
  if (held?.item && held.bag === current) {
    const side = sameHolder(held.holder, left)
      ? 'left'
      : sameHolder(held.holder, right)
        ? 'right'
        : null;
    const row = side && columns[side].rows.find((r) => sameItem(held.holder, r.item, held.item));
    if (row) heldRow = { side, index: row.index };
  }
  const heldSlot = heldRow ? columns[heldRow.side].rows[heldRow.index].slot : null;
  const heldNotes = new Set();

  const heldReorders = canReorder && heldRow && !isConvoyHolder(columns[heldRow.side].holder);
  for (const side of SIDES) {
    for (const row of columns[side].rows) {
      let state;
      if (!heldRow) state = row.empty ? 'inert' : 'hold';
      else if (side === heldRow.side)
        state =
          row.index === heldRow.index
            ? 'release'
            : row.empty
              ? 'inert'
              : heldReorders
                ? 'reorder'
                : 'switch';
      else state = 'commit';
      row.state = state;
      row.blocked = null;
      row.warnings = [];
      row.kind = null;
      row.equips = null;
      if (state === 'reorder') {
        const result = plan(engine, ctx, heldSlot, row.slot, 'planReorder');
        row.equips = reorderEquips(current, heldRow, row, heldSlot);
        if (result.ok) row.kind = 'reorder';
        else row.blocked = result.reason || 'Cannot reorder here.';
      }
      if (state === 'commit') {
        const result = plan(engine, ctx, heldSlot, row.slot);
        if (result.ok) {
          row.kind = result.kind || (row.empty ? 'give' : 'swap');
          // The receiver's "can't wield" about the held item is the same on every target
          // row: it is said once, in the status line (heldNotes), not on each row.
          const own = [];
          for (const warning of result.warnings || []) {
            const text = tradeWarningText(warning);
            if (!text) continue;
            if (warning.code === 'cannot_equip' && warning.item && warning.item === heldSlot.item)
              heldNotes.add(text);
            else own.push(text);
          }
          row.warnings = own;
        } else row.blocked = result.reason || 'Cannot trade here.';
      }
      row.disabled = state === 'inert' || row.blocked != null;
      // Toggle semantics for rows that hold; commit, reorder and empty rows are plain actions.
      row.pressed = ['hold', 'switch', 'release'].includes(state) ? state === 'release' : null;
      row.name = rowName(row, heldSlot);
    }
  }

  return {
    ctx,
    left,
    right,
    bag: current,
    tabs,
    columns,
    held: heldSlot,
    heldRow,
    heldNotes: [...heldNotes],
    notice,
    empty: false,
  };
}

/** The row at `focus`, or null. */
export function rowAt(view, focus) {
  if (!view?.columns || !focus) return null;
  return view.columns[focus.side]?.rows[focus.index] || null;
}

function clampTo(counts, focus) {
  let side = focus?.side === 'right' ? 'right' : 'left';
  if (!(counts[side] > 0)) side = otherSide(side);
  const length = counts[side] || 0;
  if (!length) return null;
  const index = Math.min(Math.max(0, Math.trunc(Number(focus?.index)) || 0), length - 1);
  return { side, index };
}

const rowCounts = (view) =>
  view?.columns
    ? { left: view.columns.left.rows.length, right: view.columns.right.rows.length }
    : { left: 0, right: 0 };

/** `focus` moved onto a real row: same side (the other when that column is empty), index clamped. */
export function clampFocus(view, focus) {
  return clampTo(rowCounts(view), focus);
}

/**
 * Keyboard / gamepad movement. `input`: 'up' | 'down' | 'left' | 'right' |
 * 'prevTab' | 'nextTab'. Up/down stay in the column and stop at its ends;
 * left/right cross to the other column keeping the row index (clamped); tab
 * inputs wrap through the visible tabs and keep side and index (clamped).
 * `stacked` (an upright phone: the right holder drawn below the left, trade.css):
 * down from the left holder's last row steps to the right holder's first row, and
 * up from the right holder's first row to the left holder's last row, so the
 * arrows follow the screen; the outer ends still stop.
 * @returns {{ bag: string|null, focus: {side, index}|null }}
 */
export function navigate(view, focus, input, { stacked = false } = {}) {
  const bag = view?.bag ?? null;
  const here = clampFocus(view, focus);
  if (input === 'prevTab' || input === 'nextTab') {
    const tabs = view?.tabs || [];
    if (tabs.length < 2) return { bag, focus: here };
    const at = Math.max(
      0,
      tabs.findIndex((t) => t.bag === bag),
    );
    const next = tabs[(at + (input === 'prevTab' ? -1 : 1) + tabs.length) % tabs.length];
    return { bag: next.bag, focus: clampTo(next.rowCounts, here || focus) };
  }
  if (!here) return { bag, focus: null };
  const counts = rowCounts(view);
  if (input === 'up') {
    if (stacked && here.side === 'right' && here.index === 0 && counts.left > 0)
      return { bag, focus: { side: 'left', index: counts.left - 1 } };
    return { bag, focus: { ...here, index: Math.max(0, here.index - 1) } };
  }
  if (input === 'down') {
    if (stacked && here.side === 'left' && here.index === counts.left - 1 && counts.right > 0)
      return { bag, focus: { side: 'right', index: 0 } };
    return { bag, focus: { ...here, index: Math.min(counts[here.side] - 1, here.index + 1) } };
  }
  const target = input === 'left' ? 'left' : input === 'right' ? 'right' : here.side;
  if (target === here.side || !counts[target]) return { bag, focus: here };
  return { bag, focus: { side: target, index: Math.min(here.index, counts[target] - 1) } };
}

/**
 * Where focus starts. With an item held (opened from an item card): the other
 * column, same row if it can take the item, else its first open row, else the
 * held row. Nothing held: the first item on the left, then on the right.
 */
export function initialFocus(view) {
  if (!view?.columns) return null;
  if (view.heldRow) {
    const rows = view.columns[otherSide(view.heldRow.side)].rows;
    const same = rows[Math.min(view.heldRow.index, rows.length - 1)];
    const open = same && !same.disabled ? same : rows.find((r) => !r.disabled);
    return open ? { side: open.side, index: open.index } : { ...view.heldRow };
  }
  for (const side of SIDES) {
    const first = view.columns[side].rows.find((r) => !r.empty);
    if (first) return { side, index: first.index };
  }
  return clampFocus(view, { side: 'left', index: 0 });
}

/** After a commit: the held item's old slot index in its (originating) column. */
export function focusAfterCommit(view, origin) {
  return clampFocus(view, origin);
}

/**
 * What activating a row means.
 * @returns {{ type: 'hold', held } | { type: 'release' } | { type: 'commit', from, to, kind }
 *   | { type: 'reorder', from, to, equips } | { type: 'blocked', reason } | { type: 'none' }}
 */
export function activateRow(view, row) {
  if (!row) return { type: 'none' };
  switch (row.state) {
    case 'hold':
    case 'switch':
      return { type: 'hold', held: row.slot };
    case 'release':
      return { type: 'release' };
    case 'commit':
      return row.blocked
        ? { type: 'blocked', reason: row.blocked }
        : { type: 'commit', from: view.held, to: row.slot, kind: row.kind };
    case 'reorder':
      return row.blocked
        ? { type: 'blocked', reason: row.blocked }
        : { type: 'reorder', from: view.held, to: row.slot, equips: row.equips };
    default:
      return { type: 'none' };
  }
}

/** Cancel (Esc / B / Back / overlay): release a held item first; with nothing held, close. */
export function cancelAction(view) {
  return view?.held ? 'release' : 'close';
}

/** The status line when nothing else is being said. */
export function baseStatus(view) {
  if (!view || view.empty) return 'Nothing to trade.';
  if (view.held) {
    const notes = (view.heldNotes || []).map((note) => `${note}. `).join('');
    return `Holding ${shown(view.held.item)}. ${notes}Choose where it goes.`;
  }
  return 'Choose an item to trade.';
}

/** The status line after a successful commit (when the caller gives no message). */
export function commitMessage(from, to, kind) {
  if (to?.item && kind !== 'give') return `Traded ${shown(from.item)} for ${shown(to.item)}.`;
  return `Gave ${shown(from.item)} to ${holderName(to?.holder)}.`;
}

/** The status line after a reorder (when the caller gives no message). */
export function reorderMessage(from, to, equips) {
  if (equips) return `${shown(equips)} is now equipped.`;
  return `Swapped ${shown(from.item)} and ${shown(to.item)}.`;
}
