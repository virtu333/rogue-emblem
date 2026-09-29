# Item Trade (Fire Emblem-style)

Status: approved for the round-3 TestFlight wave (2026-09-27). Replaces "give only" moves with FE trading:
**give** moves an item into a free slot; **trade** exchanges two items, and works even when both
bags are full. Playtest 2026-09-29 (`docs/playtest-triage-2026-09-29.md`, rows 9-10) added
**reorder** (two items swap places in one unit's bag; the first weapon slot is the equipped one)
and a menu that opens with nothing held or highlighted.

## Before this change

- **Battle.** The Trade command (`BattleScene.findTradeTargets`, `executeTrade`,
  `BattleTradeMenu.js`) is give-only. It is offered only when one side has space, so two units
  with full bags can't trade at all. The first transfer sets `tradeMutatedThisSession`,
  `left._movementCommitted`, `preMoveLoc = null` and calls `commitVisionSnapshotIfPending()`.
  Each transfer records `observeHistoryAction(scene, 'traded with', …)` and
  `_captureSuspendCheckpoint()`. Trading is a free action and never sets `hasActed`. The canvas
  fallback (`BattleScene` ~5254-5436) exists for headless tests.
- **Roster.** `MobileRosterSheet` is the roster in every browser, desktop included, and it has
  **Give…** only (`giveRosterItemBlock` / `giveRosterItem` in `RosterTransfers.js`). Convoy
  Store/Withdraw lives in `RosterInventory.js`: Store refuses to take a unit's last combat
  weapon, and Withdraw into a full bag is blocked. Accessories move only through the shared pool
  (`run.accessories`). The canvas `RosterOverlay` / `RosterTradeController` is a headless
  fallback.
- **Shop and rewards.** When the bag is full, a shop purchase goes to the convoy automatically
  and rewards offer "Send to Convoy".

## Engine: `src/engine/ItemTrade.js` (pure)

```
ctx:    { context: 'battle' | 'roster', run?: RunManager }
holder: { kind: 'unit', unit } | CONVOY_HOLDER ({ kind: 'convoy' })
slot:   { holder, bag: 'inventory' | 'consumables' | 'accessory', item: object | null }  // null = empty slot

unitHolder(unit), CONVOY_HOLDER
bagItems(ctx, holder, bag), bagCapacity(ctx, holder, bag)   // 5 / 3 / 1; convoy from run.getConvoyCapacities()
planTrade(ctx, from, to)  -> { ok: true, kind: 'give' | 'swap', warnings: [{ code, unit }], detail }
                           | { ok: false, reason }
applyTrade(ctx, from, to) -> same shape; re-plans first, then mutates
planReorder(ctx, from, to)  -> { ok: true, kind: 'reorder', equips: item | null, warnings: [], detail }
                             | { ok: false, reason }
applyReorder(ctx, from, to) -> same shape; re-plans first, then mutates
canTradeBetween(a, b)     // true if either unit carries anything in inventory or consumables
settleEquipped(unit, preferred)
```

### Validation (first failure wins; the reason is the UI string)

1. **Battle context.** Both holders are player units. A convoy holder gets "The convoy is
   available between battles." The accessory bag gets "Accessories can be traded between
   battles."
2. **Roster context.** Each unit is in `run.roster` (check with `includes`, never by array
   identity), otherwise "Unit is no longer in the roster."
3. **Same holder:** "Choose another unit."
4. **Different bags:** "Items trade only within the same bag." Weapons never exchange with
   supplies or accessories.
5. **Stale items.** `from.item` (and a non-null `to.item`) must still be in that bag, otherwise
   "Item is no longer available." Unit bags match by identity. Convoy matches by identity, then
   by `uid`, because `getConvoyItems` returns clones.
6. **Type sanity.** `inventory` never receives Consumable or Scroll. `consumables` receives only
   `type === 'Consumable'`. `accessory` receives only `type === 'Accessory'`.
7. **Capacity.** A **give** (`to.item === null`) needs room: "Bag full." for units, or
   `run.canAddToConvoy(item)` → "Convoy is full." A **swap never needs capacity**.
8. **Warnings** never block:
   - `cannot_equip`: a weapon lands on a unit whose `canEquip` is false; the unit can still
     carry it.
   - `leaves_unarmed`: a unit that had a combat weapon ends with none, whether the other side
     is a unit or the convoy. A unit may carry nothing at all (see "Unarmed units" below).

   (Until 2026-09-27 a trade into the convoy that left a unit with no combat weapon was
   refused, "Keep at least one combat weapon."; that rule and `TRADE_REASONS.keepWeapon` are
   gone.)

### Apply

- **Re-plan, then write.** Resolve all indices first, then do only writes that cannot fail.
  Never add, check, then remove.
- **Items move as the same instance** (no clone). `uid`, `_usesSpent`, `_imbueId`, forge fields
  and `weaponArtIds` / `weaponArtSources` travel with the item. Call `ensureItemUid` defensively.
- **Give:** splice from the source, push onto the target (an append).
- **Swap:** `src[i] = toItem; dst[j] = fromItem`, so each item takes the slot the other left.
- **Convoy:** write `run.convoy.weapons` / `.consumables` directly. Capacity was already checked
  in the plan, and a swap is capacity-neutral.
- After an `inventory` change, call `settleEquipped(unit, incoming)` for every unit holder:
  1. keep `unit.weapon` if it is still carried and equippable;
  2. otherwise the incoming item, if it is a combat weapon the unit can equip;
  3. otherwise `getCombatWeapons(unit)[0]`;
  4. otherwise the first staff the unit can equip (staff-only classes; matches `relinkWeapon`);
  5. otherwise `null`.

  Then call `normalizeEquippedFirst(unit)`.
- **Accessories** (roster only). A swap unequips both, then equips crosswise
  (`unequipAccessory` / `equipAccessory`). A give unequips from A and equips on B. Moves to and
  from the pool stay `rosterAccessoryAction`.
- **Staves.** Spent uses stay with the staff, and remaining uses follow the new holder's MAG, as
  today.

### Accessory fixes shipped with trade

- **Unequip HP** (`UnitManager.applyAccessoryStats`, unequip branch). Keep missing HP constant,
  floor at 1, and never raise HP (a unit at 0 stays at 0):
  `currentHP = min(stats.HP, max(min(currentHP, 1), currentHP - hp))`. This closes the free-heal
  loop: before, 10/20 → equip Seraph Robe 15/25 → unequip 15/20 → …; after, 10/20 → 15/25 →
  10/20. A full-HP unit is unchanged.
- **Fallen units.** `RunManager._transferFallenUnitItems` unequips the accessory, reversing its
  stats, before returning it to the pool.

`giveRosterItemBlock` / `giveRosterItem` stay as thin wrappers (unit-to-unit give) and keep the
"Bag full." wording.

### Reorder (one unit's own bag)

`planTrade` still refuses two slots of one holder ("Choose another unit."); swapping two items
inside one unit's bag is `planReorder` / `applyReorder`. The equipped weapon is the one in the
first weapon slot (`normalizeEquippedFirst`), so a reorder can change what is equipped.

Validation (first failure wins; the reason is the UI string):

1. An accessory bag: "Only weapons and supplies can be reordered."
2. A convoy holder: "Only a unit's own items can be reordered." (The convoy's order is its own.)
3. Two different units: "Reorder items within one unit's bag."
4. Context: a player unit in battle; between battles, a unit still in `run.roster`
   ("Unit is no longer in the roster.").
5. Two bags: "Items trade only within the same bag."
6. An empty target, or the same item twice: "Choose another item to swap with."
7. Stale items (unit bags match by identity): "Item is no longer available."
8. The two items trade places in **display order** (`inventoryDisplayOrder`: the equipped weapon
   first, so an old save whose equipped weapon sits later is read the way every view draws it).
   If the first weapon slot changes, the item that lands there must be one the unit can wield
   (`canEquip`: a staff with its rank too, as the battle Equip menu allows; never a scroll), or
   the reorder is refused with "⟨unit⟩ can't wield ⟨item⟩." Otherwise it is order only.

Apply writes the new order into the unit's own array in place (the same array and the same
instances: `uid`, `_usesSpent`, `_imbueId`, forge fields and arts stay) and, when the first
weapon slot changed, sets `unit.weapon` to the item there (`equips`). `detail` is "Equipped
⟨item⟩" or "Swapped ⟨a⟩ and ⟨b⟩". Supplies reorder the same way and never touch the weapon.

## UI: `src/ui/tradeMenuModel.js` (pure) + `src/ui/TradeMenu.js` + `src/ui/trade.css`

**Tabs**
- "Weapons n/5 · m/5" and "Supplies n/3 · m/3".
- "Accessory" appears only in the roster context with two units.
- A tab is hidden when neither side has an item or a free slot in it.

**Columns**
- One per holder, headed by the name (or "Convoy") and its count.
- A unit column shows a fixed 5 or 3 slots: items first, then "Empty" placeholders.
- The convoy column shows its items plus one empty row when it has room.

**Rows**
- Nothing held:
  - item rows hold an item;
  - empty rows are inert.
- An item held:
  - its own row releases it;
  - rows in the other column commit, and are named:
    - "Trade ⟨held⟩ for ⟨item⟩" for an item row;
    - "Give ⟨held⟩ to ⟨holder⟩" for an empty row;
  - other item rows in the same column:
    - in a unit's column (when the caller wires `reorder`) **reorder**: the two items swap
      places. A swap that touches the first weapon slot is named "Equip ⟨item⟩" for the item that
      lands there, any other "Swap ⟨held⟩ with ⟨item⟩"; the plan comes from `planReorder`, so a
      refused one ("Sera can't wield Iron Axe.") is blocked like any other target;
    - in the convoy's column (or without `reorder`) **switch** which item is held;
  - empty rows in the same column stay inert.
- Blocked targets:
  - use `aria-disabled` (not `disabled`), so they stay focusable;
  - put their reason in the `role=status` line.
- Warnings sit on a second line, e.g. "Sera can't wield Iron Axe" or "Leaves Edric
  unarmed".

**Committing and closing**
- The second tap commits (or reorders), as in FE. There is no extra confirm step. A reorder's
  message is "⟨item⟩ is now equipped." or "Swapped ⟨a⟩ and ⟨b⟩."; the cursor stays on the slot
  the held item moved into.
- Rows use `bindCancelablePress`, so a swipe to scroll never commits.
- `ignoreRepeatedActivation` and an `applying` flag prevent a double commit.
- Cancel (Esc / B / rail Back / overlay) releases a held item first; with nothing held, it closes.
- The title stays "Trade items", with a **Done** button.

**Opening: nothing held, nothing highlighted**
- Players tap an item to start a trade, so no caller opens the menu with an item held (item
  card, convoy card, Trade with…, battle Trade; the `held` prop remains for tests and future
  callers) and no row is highlighted on open.
- The cursor is logical until the first key or pad press: on open the dialog itself (tabIndex −1,
  no outline) holds DOM focus, so keys still arrive, and the cursor sits on `initialFocus` (the
  first item), or on the source item's row when an item card or convoy card opened the menu
  (`cursor`), scrolled into view.
- The first arrow, D-pad, Tab, Enter, Space or A press shows the cursor where it is: it focuses
  that row without moving or activating anything. Later presses act as usual.
- Pointer taps never leave a focus ring: a click with a click count (`event.detail > 0`) is a
  pointer; Enter, Space and the pad's A click with none. After a pointer activation the dialog
  keeps focus (the tapped row becomes the logical cursor); after a key or pad activation the
  focused row stays the visible cursor, and a re-render refocuses it.

**Input and layout**
- Keyboard and gamepad:
  - arrows move in 2D (within a column; across columns keeping the row index);
  - Enter/Space activate;
  - Q/E, PageUp/PageDown or L1/R1 switch tabs.
- After a commit, the cursor returns to the same slot index in the originating column.
- Rows are at least 44 px on a coarse pointer and 32 px on a fine one.
- It must fit 568×320 (header + tabs + 5 rows + status) with no horizontal overflow; each column
  scrolls on its own.
- In battle, until the unit's move is committed, the header reads "Trading locks in ⟨unit⟩'s
  move."

**Upright phones (portrait mode, `docs/portrait-battles.md`)**
- The menu fills the screen inside the notch and home bar. The header has two rows: the title and
  Done, then the bag tabs at full width.
- The two holders stack, one above the other, each full width and scrolling on its own. Each gets
  half the height; a holder that needs less gives the rest to the other, so two full 5-slot bags
  show whole at 375×667 and a long convoy scrolls in the room the unit leaves.
- A list with more rows below fades at its lower edge; a focused or held row scrolls clear of the
  fade. Item briefs wrap at full width.
- Keyboard and gamepad: Left/Right still switch holders; Up/Down also cross between the holders
  where they meet. The menu measures whether the holders are stacked, so side-by-side columns keep
  the behaviour above.
- Turning the phone restyles the menu without a re-render: the held item and focus stay, and both
  rows are scrolled back into their resized lists.

## Battle: `src/ui/BattleTradeController.js` (`create`/`destroy`)

`commit(left, right, from, to)`:

1. **Guard.** All of these must hold, or it returns `{ ok: false }` without committing movement:
   - `battleState === 'TRADING'`;
   - the player phase;
   - `selectedUnit === left`;
   - `!left.hasActed`;
   - both units are in `playerUnits`;
   - the two units are still adjacent.
2. **Apply.** `applyTrade({ context: 'battle' }, from, to)`. If it isn't ok, return with
   movement still uncommitted.
3. **First success in the session only**, keep today's commitment steps:
   - `tradeMutatedThisSession = true`;
   - `left._movementCommitted = true`;
   - `preMoveLoc = null`;
   - `commitVisionSnapshotIfPending()`.
4. **Record.** `observeHistoryAction(scene, 'traded with', left, right, detail)`. The detail is
   the item name for a give, or "Iron Sword for Steel Lance" for a swap.
5. **Checkpoint.** `_captureSuspendCheckpoint()`.

Never touch the partner's `hasActed`, `hasMoved` or `_movementCommitted`. Trading stays a free,
pre-action command (Attack, Item and Wait remain), and it is never offered after Canto.

`reorder(left, right, from, to)` reorders the acting unit's or the partner's own bag:

1. **Guard.** The same session rules as `commit`, and both slots belong to one unit, which is
   `left` or `right`; otherwise `{ ok: false }` without committing movement.
2. **Apply.** `applyReorder({ context: 'battle' }, from, to)`; a refusal commits nothing.
3. **First success in the session** locks the move exactly as a trade does (shared with
   `commit`, so a trade then a reorder, or the reverse, locks once).
4. **Record.** `observeHistoryAction(scene, 'changed equipment', left, null, detail)`: the
   acting unit is always the actor, so the rewind point reads "Before ⟨left⟩'s equipment
   change" (`RewindDestinations` maps the beat to `equip`; a trade in the same activation
   outranks it). For the partner's bag the detail ends "for ⟨partner⟩".
5. **Checkpoint.** `_captureSuspendCheckpoint()`. Units serialize their bags in order and the
   equipped index, so a resumed battle has the new order and weapon; the rewind fingerprint
   covers inventory order and the equipped index, so a pure reorder is a change.

`BattleTradeMenu` wraps `TradeMenu` with the battle context and the Weapons and Supplies tabs,
and wires `reorder` to the controller.
`close()` still returns to `showActionMenu(left)`. `findTradeTargets` uses `canTradeBetween` and
keeps its adjacency check. The canvas fallback stays give-only, but its mutations go through the
controller.

Rewind, suspend and history need no new state: units serialize full bags and the equipped index,
and the timeline fingerprint already covers bags.

## Roster (between battles)

- **Item cards.** **Trade…** replaces **Give…** on weapon and supply cards. It opens a picker of
  the other units plus "Convoy" (units only for an accessory), then `TradeMenu` on that item's
  tab with **nothing held** (the hidden cursor starts on the item's row; the first tap picks it).
  The picker blocks nobody; a full bag shows e.g. "Items 5/5 · full: pick an item to trade".
- **Trade with…** in the Equipment heading opens `TradeMenu` with nothing held.
- **Convoy tab.** When the unit's bag is full, Withdraw becomes **Trade…**: `TradeMenu(unit,
  Convoy)` with nothing held, the cursor on the convoy item's row, scrolled into view.
- **Store** (`RosterInventory.rosterItemBlock` / `rosterItemAction`) may take a unit's last
  combat weapon. `rosterItemWarnings` returns the same `leaves_unarmed` warning, and the Store
  button carries it as its description, with "Leaves ⟨unit⟩ unarmed." beside it and in the
  message after the store. Removing the equipped weapon re-equips the first combat weapon, else
  a usable staff, else nothing (`UnitManager.removeFromInventory`, as `settleEquipped`).
- **Accessory card.** Gets **Trade…**, which leads to the Accessory tab. Pool Equip / Unequip
  are unchanged.
- **Wiring.** `TradeMenu` is stored in the sheet's `picker`, so the existing guards and
  `destroy()` cover it. Every successful commit or reorder calls `persistNow()` once, which
  honours the shop, rewards and church persist hooks. The sheet re-renders when the menu closes.
- **Canvas.** `RosterTradeController` routes its two give paths through `applyTrade`.
- **Shop and rewards copy only:**
  - shop: "Full: sent to convoy · trade it in from Roster";
  - a full-bag reward row: "Bag full: send to convoy, or trade in Roster" (a UI string; the
    engine string is unchanged).

## Unarmed units

A player unit may carry no weapon at all (`inventory: []`, `weapon: null`), or only items it can't
attack with (a staff, a weapon it can't wield, supplies). Such a unit deploys and plays normally:
it can move, Wait, Trade, use items, heal with a staff it can use, Talk, Seize, Escape and visit.
It can't attack, never counterattacks (the forecast says "No combat weapon equipped"), earns only
the survival minimum when attacked and it lives (`XP_DEFEND_SURVIVE`, 1 XP: more combat XP needs
damage dealt), and enemies target it freely.

- Battle menu: Attack is hidden, as in FE. With Guidance on Full, a unit that has a combat
  proficiency but nothing it can wield shows a greyed Attack, "Unarmed: no weapon to attack
  with".
- Deploy list, Formation bench and picker: the unit is marked "Unarmed".
- Arena: a fighter needs a combat weapon it can wield. The fight uses the equipped weapon, or
  the first carried combat weapon when a staff is equipped, and equips it on Fight. A unit with
  none can't enter ("⟨unit⟩ has no weapon to fight with."); before, such a fight was an empty
  draw that still paid draw XP.
- Shop: selling a unit's last combat weapon is allowed too (`ShopCommands.shopSellWarnings`):
  the sell pane and the confirm say "Leaves ⟨unit⟩ unarmed.", and the message after the sale
  says the unit is now unarmed. (Before, "Keep at least one combat weapon." refused the sale.)
- A usable combat weapon that reaches an unarmed unit is equipped (`equipIfUnarmed`): a trade,
  Withdraw, a battle reward, a shop purchase, and a weapon granted by an in-battle promotion or
  reclass. Before, the last three left `weapon: null`, so the unit read "Unarmed" and could not
  counter until it attacked.
- Saves, battle checkpoints, rewind and the timeline keep `weapon: null` and an empty bag.

## Out of scope (this wave)

- Accessories in battle. Per-unit `_phoenixBroochUsed` / `_miracleUsed` flags could be reused by
  passing the item around, and MOV, move type and max HP would change mid-turn.
- Convoy access in battle.
- A swap step inside the shop or reward pickers.
- Discarding items.
- Reordering the convoy or moving an item into an empty slot of its own bag.
- Scroll and accessory pools as trade holders.
- Trading after Canto.
- Deleting the canvas fallbacks.

## Tests

- **Engine** (`tests/ItemTrade.test.js`). Hand-built units, with every expectation derived by
  hand:
  - give with room: the same instance, uid kept, appended;
  - giving away the equipped weapon: re-equip at slot 0, or `null` + `leaves_unarmed`;
  - an unarmed receiver equips a usable weapon (an unusable one gets `cannot_equip`); a staff-only
    unit equips its staff;
  - a give into a full bag is rejected with the state deep-equal;
  - a swap between two 5/5 bags keeps slot indices;
  - swap cases where equipped weapons are involved:
    - trading away the equipped weapon for a usable one;
    - for an unusable one;
    - both units' equipped weapons;
  - supplies at 3/3;
  - cross-bag, stale, and same-holder requests are rejected with no mutation;
  - context rules (battle: no convoy or accessory; roster: unit not in the roster);
  - convoy:
    - Store (capacity, uid; the last combat weapon is allowed with `leaves_unarmed`);
    - a swap when both the convoy and the bag are full;
    - Withdraw equips an unarmed unit;
    - clones are found by uid;
  - accessory swap: stats by hand, Mercury Sandals move type, Seraph Robe missing HP, full HP,
    0 HP;
  - instance fields deep-equal after a move;
  - `canTradeBetween`;
  - no heal from an equip/unequip loop;
  - a fallen unit's stats return to base;
  - reorder: slot 1 ↔ 3 equips the item moved in (in the same array); slot 2 ↔ 4 keeps the
    weapon; an unwieldable weapon or a scroll is refused for slot 1; a staff with its rank is
    allowed; instance fields survive; an old save's display order; an unarmed unit equips;
    supplies; the convoy, the accessory slot, an empty slot, two units, two bags, stale items, an
    enemy and a unit off the roster are refused with nothing changed; `planTrade` still refuses
    one holder's two items.
- **Model** (`tests/TradeMenuModel.test.js`):
  - labels and accessible names;
  - slot counts;
  - disabled reasons;
  - hold / switch / release;
  - cancel order;
  - 2D navigation and tabs;
  - focus after a commit;
  - accessory tab and battle notice visibility;
  - reorder rows (names, `equips`, blocked reasons, activation), the convoy column still
    switching, and reorder off without `reorder` or `planReorder`.
- **Menu** (`tests/TradeMenu.test.js`): nothing focused or pressed on open; each first key or
  pad press shows the cursor without moving or activating; a card's `cursor`; pointer taps leave
  the dialog focused; two taps reorder; a refused reorder.
- **Controller** (`tests/BattleTradeController.test.js`):
  - the session flags and the snapshot happen once;
  - history detail and checkpoint;
  - the guards;
  - a failed plan never commits movement;
  - the partner is untouched;
  - reorder: guards, the shared move lock, the "changed equipment" beat and its rewind label,
    the checkpoint, serialize → resume, and the fingerprint seeing a pure reorder.
- **e2e:**
  - `battle-contracts.spec.js` (contracts):
    - nothing highlighted on open; the first key shows the cursor;
    - a full–full swap of the equipped weapon;
    - a keyboard reorder that equips Rapier, checkpointed, and a refused one;
    - Attack still offered after Done;
    - Wait acts once;
    - the checkpoint is committed;
    - keyboard only.
  - `rewind-any-action.spec.js` (battle-history):
    - rewind to "Before X's trade with Y" restores bags, uids and the equipped index exactly;
    - refresh then Resume after a trade.
  - New `item-trade.spec.js` (menus), at 1280×800, 640×480, 844×390 and 568×320:
    - a full–full roster trade;
    - each commit persisted (reload);
    - a convoy swap with both sides full;
    - an accessory swap (stats and HP);
    - opened from the shop and the rewards Roster buttons;
    - a card's Trade… opens with nothing held; the first tap holds and commits nothing, and
      leaves no row focused;
    - a reorder that equips (saved) and a refused one;
    - gamepad (the first A shows the cursor);
    - layout.
  - Update `compact-route-roster.spec.js` (Give… → Trade…) and `ui-completion.spec.js`.
