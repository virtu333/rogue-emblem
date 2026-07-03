# Spec: Ruins — Guaranteed Pre-Boss Prep Node

**Date:** 2026-07-02
**Status:** Approved design, ready to implement
**Evidence checked at:** main (post PR #39 merge)

## Summary

Player feedback: there should be a guaranteed shop/church stop before each act's final
battle. Today only the finalBoss act has one (a full-power Village forced at its row 0);
acts 1–4 leave it to node-type RNG, and a path can miss every shop and church in an act.

This feature adds a new **RUINS** node type: a single mandatory center-lane node inserted
directly before the boss row of every act (acts 1–4 get a new row; the finalBoss act's
existing forced shop converts). The Ruins is a one-stop prep camp with deliberately
scarcer wares than a Village.

### Approved decisions (user, 2026-07-02)

1. **Placement:** mandatory single node before the boss row, on every path (Slay-the-Spire
   campfire pattern). Acts 1–4 gain one row; battle counts per path are unchanged.
2. **Services:** combined "Ruins" = limited shop + the church's free Heal All + Revive.
   **No Promote** — promotion stays a mid-act Church exclusive so churches keep a role.
3. **Ruins shop rules:** smaller stock (5–6 items), **no Forge tab**, **+25% price markup**.
   **Reroll stays available** (explicit user choice — it is the gold sink; escalating cost
   plus markup bounds it).
4. **finalBoss act:** converts to Ruins too (delegated decision): same rules but
   **Village-sized stock (8–10)** — the "last camp" stays well-supplied yet themed and
   forge-less. It also gains Heal All / Revive, which the finalBoss act currently lacks
   entirely (verified: nothing auto-heals the roster between battles or acts —
   `advanceAct()` in RunManager.js ~L2886 does not touch `currentHP`; the church's Heal All
   is the only free recovery). This is a deliberate, visible trade: less shopping power,
   but you no longer limp into the final battle because act 4 rolled no late church.

## Current behavior (verified, file:line)

- **Node types:** `NODE_TYPES` in src/utils/constants.js:143 (BATTLE, BOSS, SHOP, RECRUIT,
  CHURCH, COLOSSEUM). `NODE_GOLD_MULTIPLIER` at :153 must have an entry per type.
- **Act rows:** `ACT_CONFIG` constants.js:135 — act1: 7, act2–4: 8, finalBoss: 2.
- **Type assignment:** `pickNodeType()` NodeMapGenerator.js:314 — finalBoss row 0 is
  hardcoded SHOP (:315); row 0 = BATTLE, last row = BOSS, row 1 = BATTLE, rest random
  (act1 80/15/5, acts 2+ 60/25/15 battle/shop/church).
- **Lane layout:** `generateNodeMap()` Step 1 (NodeMapGenerator.js:68-77) — rows 0 and
  rows-1 are `[CENTER_COL]`, middle rows get 2–4 lanes. A backward pass (:79-97) ensures
  the penultimate row can reach the boss.
- **Edges:** `connectRows()` :451 — when either row has a single node, `skipConstraints`
  relaxes the ±1 column rule and every node connects (crossings impossible). This is what
  makes a forced single-node row structurally free.
- **Post-processing:** recruit conversion (:166-189) only converts `[BATTLE, SHOP]` types;
  colosseum (:191-211) only BATTLE; village ambush (:213-256) only SHOP and already exempts
  finalBoss. All are type-gated, so a new RUINS type is untouched by all three.
- **Shop stock:** `generateShopInventory()` LootSystem.js:988 — `SHOP_ITEM_COUNT`
  {min:8, max:10} (constants.js:198) + blessing `itemCountBonus`; guarantees ≥1 weapon,
  a healing/promotion consumable, Vulnerary+Elixir, and the cure kit under
  `shopCureGating`. No passive restock; the **Reroll button**
  (ShopController.js:1796-1900, 150G +50G escalation, constants.js:203-204) regenerates
  stock to the original slot count — this is the "infinite stock" generosity valve.
- **Shop open/caching:** `handleShop()` ShopController.js:90 — consumes the
  `skipFirstShop` blessing (:97), generates or restores cached stock via
  `rm.getShopState(node.id)` (RunManager.js:2556; `shopStateByNodeId` reset each act,
  RunManager.js:2903), applies `applyDifficultyShopPricing` (:140 — difficulty multiplier ×
  blessing discount) and ambush discount.
- **Shop completion:** leaving the shop marks the node complete and clears shop state
  (ShopController.js:328-333); the skip-blessing path also completes the node (:97-102).
- **Church:** ChurchController.js — Heal All free (:109-131, sets `currentHP = stats.HP`),
  Revive rows using `getReviveCost` (500 + 300/level, ×2.5 promoted; constants.js:181-183),
  Promote (3500G, constants.js:180).
- **Node rendering:** NodeMapScene.js — icon chars :120-123, colors :129-132, sprite key
  `node_${type}` with CHURCH→`node_rest` (:1233), click dispatch :1487-1493 and :1594-1600.
  Node sprites live in assets/sprites/nodes/ (battle, boss, boss_final, colosseum, elite,
  recruit, rest, shop). Row Y is proportional: `MAP_TOP(60) + yFrac * 340` (:55-56, :1158),
  so extra rows compress spacing rather than overflow.
- **Sim:** sim/fullrun.js:332-343 walks edges and only simulates BATTLE/BOSS/RECRUIT;
  unknown/non-combat types pass through (note: :455 references `NODE_TYPES.REST`, which no
  longer exists — dead code, harmless). sim/economy.js:172 models SHOP spending only.
  Ruins therefore requires **no sim changes** for the `sim:fullrun:harness:pr` gate; battle
  counts per path are unchanged (the new row is non-combat).

## Design

### 1. New node type + map generation (src/utils/constants.js, src/engine/NodeMapGenerator.js)

- `NODE_TYPES.RUINS = 'ruins'`; `NODE_GOLD_MULTIPLIER.ruins = 0`.
- `ACT_CONFIG` rows: act1 7→8, act2/3/4 8→9, finalBoss stays 2. Per-path battle counts are
  unchanged: random rows remain rows 2..(rows-3), one node visited per row either way.
  (`canSeizeAtRow` is also unchanged in effect: `ceil(7/2)=ceil(8/2)=4` for act1; act2/act3
  use fixed row thresholds.)
- `pickNodeType()` — replace the finalBoss special case with a general rule, ordered:
  ```
  if (row === totalRows - 1) return NODE_TYPES.BOSS;
  if (row === totalRows - 2) return NODE_TYPES.RUINS;   // covers finalBoss row 0 (2 rows)
  if (row === 0 || row === 1) return NODE_TYPES.BATTLE;
  ... existing random distribution ...
  ```
- Lane layout Step 1: force the ruins row to center —
  `if (r === 0 || r === rows - 1 || r === rows - 2) rowCols.push([CENTER_COL])`.
  The existing backward pass (:79-97) becomes a guaranteed no-op (penultimate = center is
  within ±1 of the boss) — leave it in place, don't churn it. `connectRows` single-node
  relaxation guarantees every last-random-row node → ruins and ruins → boss, so **every
  path passes through the Ruins**.
- `buildBattleParams`: RUINS returns `null` (non-combat), same as SHOP/CHURCH.
- Post-processing needs **no changes** (all three passes are type-gated, see evidence).

### 2. Ruins services overlay (src/ui/ChurchController.js, reuse — no new controller)

`handleRuins(node)` = `handleChurch(node, { ruinsMode: true })`:

- Title "Ruins" (plus one flavor line, see §5); hide Promote rows entirely.
- Keep Heal All (free) and Revive rows verbatim (same `getReviveCost`).
- Add a **[ Browse Wares ]** fixed button that closes the church-style overlay and calls
  `shopController.handleShop(node, { ruins: true })`.
- **Completion semantics:** the node is marked complete only when the player leaves the
  Ruins hub. In ruins mode, the shop's Leave button must NOT run the
  markNodeComplete/clearShopState path (ShopController.js:328-333) — instead it closes the
  shop and re-opens the Ruins hub (`handleRuins(node)` again; cached shop state preserves
  stock/reroll count/forgesUsed-n/a). Save & Exit mid-ruins is safe: node incomplete →
  re-offered on resume; `_saveShopState` already persists stock.
- Gamepad: hub slots follow the existing church slot-list pattern (:274-283) with Browse
  Wares as another fixed slot.

Alternative considered and rejected: a "Camp" tab inside the shop overlay — would push new
rendering/input/gamepad wiring into the 2,000-line ShopController instead of reusing the
church's existing revive UI.

### 3. Ruins shop rules (src/engine/LootSystem.js, src/ui/ShopController.js, constants)

New constants:
```
RUINS_SHOP_ITEM_COUNT = { min: 5, max: 6 };
RUINS_SHOP_ITEM_COUNT_FINAL = { min: 8, max: 10 };   // finalBoss act
RUINS_SHOP_MARKUP = 1.25;
```
- `generateShopInventory(...)`: add `generateOptions.itemCountRange` override for the
  base roll (falls back to `SHOP_ITEM_COUNT`). No pool/weighting changes — the existing
  guarantees (1 weapon, healing consumable, Vulnerary/Elixir, cure kit) already make a
  5–6 slot shop read as scavenged consumable-leaning stock.
- `handleShop(node, { ruins: true })`:
  - **Skip the `consumeSkipFirstShop` branch** — the blessing drawback targets Villages;
    silently consuming it on the mandatory prep node (or worse, skipping the Ruins) is
    wrong. Guard: `if (!options.ruins && rm.consumeSkipFirstShop()) ...`.
  - Pass the ruins item-count range (finalBoss vs other acts by `rm.currentAct`).
  - Apply markup after difficulty pricing: track `scene._currentShopIsRuins` (same pattern
    as `_currentShopHasAmbushDiscount`) and multiply prices by `RUINS_SHOP_MARKUP` in a
    small `applyRuinsMarkup(items)`; **the reroll path must apply it too**
    (ShopController.js:1844-1848 already re-applies difficulty pricing + ambush discount —
    add ruins markup there).
  - Blessing `itemCountBonus` and shop price discounts apply normally (they're run-level
    modifiers the player earned).
  - **No Forge tab:** build the tab list conditionally (Buy/Sell only). Check every place
    that iterates or indexes tabs — tab drawing, click handlers, gamepad tab cycling,
    `shopScrollOffsets` keys — so a missing forge tab can't leave a dangling focus target.
  - Reroll button: kept, unchanged mechanics (user decision). It regenerates to the
    original slot count, so ruins stock size is preserved across rerolls via
    `_shopOriginalSlotCount`.
  - Title: "Ruins" (not "Village"); ambush discount/title branches never apply (ruins
    nodes are not SHOP type, so the ambush post-process already can't mark them).
- Shop state caching (`getShopState`/`saveShopState`) works unchanged — keyed by node id.

### 4. Node map UI (src/scenes/NodeMapScene.js + assets)

- Icon char (e.g. `'⌂'` ⌂ or similar), color (muted stone/grey-gold, distinct from
  shop yellow and church white), entries in the :120-132 tables.
- Sprite: add `node_ruins.png` (assets/sprites/nodes/ + **public/assets mirror**).
  Preferred: generate via the existing icon pipeline (tools/process_node_icons_v2.js /
  Imagen manifest) — a ruined arch/broken pillar at the same 32px style. Acceptable
  fallback for the first cut: map RUINS→`node_rest` in the :1233 spriteKey branch with the
  distinct tint/color, and do the art pass separately.
- Click dispatch (:1487-1493, :1594-1600): RUINS → `churchController.handleRuins(node)`.
- Hover/label text: "Ruins".
- **Vertical density check:** 9 rows compresses row spacing from ~48.5px to ~42.5px
  (340 / (rows-1)). Node sprites are 32px — verify no sprite/label overlap on the busiest
  act-2+ map in live smoke; if cramped, shrink node label font before touching layout.

### 5. Flavor + help (src/data/helpContent.js, data/dialogue.json — optional but cheap)

- helpContent.js: the node-type list (Village at :374, "Visit Rest or Church nodes to heal
  up." at :469) gains Ruins ("Ruins: last camp before the boss — scarce wares at scavenger
  prices, rest and revive.").
- One flavor line on the Ruins hub, drawn from the established nouns ledger (memory:
  narrative-depth.md) — e.g. the old kingdom / roadside shrines register:
  "Whoever kept this place kept it stocked. The prices are the empire's." Keep it to one
  line, ≤ the overlay width at 9px monospace budget (~8px/char).
- If adding lines to data/dialogue.json: **line-level insertion only** (data/*.json is
  .prettierignore'd; never parse→stringify), then `npm run sync-data`.

## Side-effects & invariants (verified)

- **Recruit/colosseum/ambush post-processing:** type-gated; RUINS untouched. Village
  ambush's finalBoss exemption comment (:215) should be updated (the pre-boss node is no
  longer SHOP type — the exemption is now structural).
- **Serialization/saves:** nodeMap nodes are plain JSON — the new type string rides along.
  Old mid-run saves keep their already-generated maps (no ruins until the next
  `advanceAct()`); no migration needed. Battle suspend/resume untouched (ruins is
  non-combat).
- **Sim gates:** fullrun/economy walk past non-battle types; battle counts per path are
  unchanged; harness thresholds should be unaffected. (economy.js models SHOP spending
  only — ruins spending is simply not modeled; fine.)
- **Gold economy:** `NODE_GOLD_MULTIPLIER.ruins = 0` required — `calculateBattleGold`
  reads it per node type.
- **skipFirstShop blessing:** must not fire on ruins (see §3).
- **`getShopItemCountDelta` / price discounts:** apply normally.

## Tests

Update (these currently pin the old finalBoss SHOP):
- tests/NodeMapGenerator.test.js:173-205 — "generateNodeMap — finalBoss" suite expects a
  SHOP node; retarget to RUINS (same structural assertions: 2 nodes, ruins→boss edge,
  null battleParams).
- Grep tests for `ACT_CONFIG` row-count assertions and any node-type distribution
  assertions over acts 1–4; update for rows+1 and the forced ruins row.

New:
- NodeMapGenerator: for each of act1–act4 across many seeds/iterations —
  (a) exactly one RUINS node, at `row === rows - 2`, `col === CENTER_COL`;
  (b) every node in row rows-3 has an edge to the ruins node;
  (c) the ruins node's edges contain the boss node;
  (d) recruit/colosseum/ambush passes never convert the ruins node.
- LootSystem: `itemCountRange` option respected (5–6 items; existing guarantees still
  present at the smaller count).
- ShopController (existing stub-scene test patterns): ruins mode → no Forge tab, markup
  applied on initial stock AND after reroll, `consumeSkipFirstShop` NOT consumed, Leave
  returns to hub without marking node complete.
- ChurchController: ruinsMode → no promote rows, Browse Wares slot present, node completes
  on hub Leave.
- constants: `NODE_GOLD_MULTIPLIER` has an entry for every `NODE_TYPES` value (cheap
  completeness guard).

## Verification

1. `npm test` (full suite), `npm run validate:data` (only needed if dialogue.json edited —
   no schema change required for flavor arrays), `npm run check:data-parity` (after any
   data/ edit + sync-data), `npm run check:reference`, `npm run sim:fullrun:harness:pr`.
2. Live smoke (dev server, `?devScene=` / dev routing): act 1 map shows the ruins row;
   enter ruins → heal/revive/browse; shop shows 5–6 items, Buy/Sell tabs only, marked-up
   prices, reroll works and stays marked-up; leave shop → hub; leave hub → node complete,
   boss row unlocked. finalBoss act: ruins with 8–10 items + heal. Check 9-row map spacing
   for overlap. Gamepad: tab cycling in the forge-less shop, hub slot navigation.

## Repo gotchas (standing)

- data/*.json: surgical line edits only, never parse→stringify; sync to public/data via
  `npm run sync-data`. Assets must be mirrored to public/assets/.
- Never add multi-step flows inline in scenes — reuse/extend controllers (this spec reuses
  ChurchController + ShopController with option flags; state stays on the scene per the
  existing delegating-shim pattern).
- Overlay depths via uiDepths.js; ESC stacking via escPriority.js; test max-length names.
- Branch from main; PR to main (never direct push). Security-scan staged files before
  commit. Commit messages explain what/why.
