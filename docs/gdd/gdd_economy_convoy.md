# Economy & Convoy — GDD Section (v1)

> **Ported from:** `References/GDDExpansion/` (Feb 13, 2026)
> **Implementation status:** Convoy MVP shipped on `main` (5+5 split slots for weapons + supplies, unlimited accessories). Economy tuning is ongoing via playtest data. Status countermeasure items (Herbs, Pure Water, Remedy) deferred until status staves ship.

**Date:** February 11, 2026
**Status:** Convoy MVP shipped; economy tuning ongoing
**Dependencies:** lootTables.json, consumables.json, metaUpgrades.json, RunManager.js, RosterOverlay
**Related docs:** `gdd_units_reclassing.md` (loot restructure in Part 5), `gdd_combat_expansion.md` (new items entering economy)

---

## Part 1: Convoy System

### 1.1 Design Philosophy

With weapon arts, skill scrolls, reclassing seals, status countermeasures, and stat boosters all entering the item pipeline, the current 5-slot unit inventory cannot absorb everything. The convoy provides passive overflow storage — not a separate map entity, just "your bag" that catches items when unit inventories are full and holds them until you need them.

The convoy is deliberately limited to create roguelike tension. Finding a Silver Lance when your convoy weapon slots are full means choosing what to discard. A fallen Knight's entire loadout dumping into a nearly-full convoy creates a painful triage moment.

### 1.2 Convoy Structure

| Slot Type | Base Capacity | Max (Upgraded) | Contents |
|-----------|--------------|----------------|----------|
| Weapons | 5 | 11 | Any weapon (Swords, Lances, Axes, Bows, Tomes, Light, Staves) |
| Consumables & Scrolls | 5 | 11 | Vulnerary, Elixir, Master Seal, stat boosters, skill scrolls, art scrolls, Second Seals, Sickle & Hammer, Herbs, Pure Water, Remedy |
| Accessories | Unlimited | — | All accessories auto-store. Rare enough that unlimited storage is fine. |

**Why split slots:**
- Prevents hoarding 10 weapons and 0 consumables (or vice versa)
- Forces interesting decisions within each category
- Mirrors the unit inventory structure already visible in the roster screen (Inventory section for weapons, Consumables section for items/scrolls)

### 1.3 Access Points

| Context | Access Level | How |
|---------|-------------|-----|
| Node map (roster screen) | Full (deposit + withdraw) | [C] key or "Convoy" button on roster overlay |
| Pre-battle deploy screen | Withdraw only | Convoy panel alongside unit equipment |
| Post-battle loot | Auto-deposit overflow | Items that don't fit unit inventories go to convoy |
| During battle | **No access** | Mid-combat convoy access removes inventory tension |
| Shop nodes | Full (via roster screen) | Player can manage convoy before/after shopping |
| Rest nodes | Full (via roster screen) | Reorganize between battles |

### 1.4 Convoy UI

**Node map roster integration:**

The existing roster screen (visible in screenshot reference) adds a **[C] View Convoy** button or a "Convoy" tab at the bottom of the unit list panel. Pressing [C] or clicking the tab swaps the right panel from unit details to convoy contents:

```
┌─────────────┬──────────────────────────────────────┐
│ Unit List    │  — Convoy Weapons (3/5) —            │
│              │  Silver Lance  Mt12 Ht80 Wt7 Rng1   │
│ Edric  Lv1  │  Killing Edge  Mt8  Ht85 Cr30 Rng1  │
│ Sera   Lv1  │  Hand Axe      Mt5  Ht65 Wt8 Rng1-2 │
│ Galvin Lv2  │  (empty)                              │
│              │  (empty)                              │
│              │                                       │
│              │  — Convoy Supplies (2/5) —            │
│              │  Elixir (1)                           │
│              │  Sol Scroll                           │
│              │  (empty)                              │
│              │  (empty)                              │
│              │  (empty)                              │
│              │                                       │
│              │  — Accessories —                      │
│              │  Speed Ring (+2 SPD)                  │
│              │                                       │
│ [C] Convoy   │  [Give to Unit]  [Discard]           │
└─────────────┴──────────────────────────────────────┘
```

**Interactions:**
- Select a convoy item → [Give to Unit] opens unit picker → selected unit receives item (if they have room)
- Select a convoy item → [Discard] removes it permanently (confirmation prompt)
- From unit detail view → select a unit's item → [Send to Convoy] deposits it (if convoy has room)
- Keyboard: [C] toggles convoy view, arrow keys navigate items, [Enter] to give/take, [D] to discard

**Pre-battle deploy screen integration:**

During deploy, a small convoy panel is visible alongside unit equipment. Players can drag/assign convoy items to deploying units. Withdraw only — can't deposit during deploy (simplifies the flow, and you can manage convoy from roster before entering the battle node).

### 1.5 Item Flow — How Items Enter the Convoy

#### Source 1: Loot Overflow

After battle, loot drops are offered to the player. If a unit's inventory is full and the player wants to keep the item:
1. System checks convoy for an open slot of the matching type
2. If room → item auto-stores in convoy, notification: "Silver Lance → Convoy"
3. If no room → **Overflow Selection** (see 1.6)

#### Source 2: Unit Death

When a non-lord unit falls in battle (permadeath):
1. **All items** from the fallen unit attempt to transfer to convoy:
   - Equipped weapon → convoy weapons
   - Unequipped inventory weapons → convoy weapons
   - Consumables/scrolls → convoy supplies
   - Accessory → convoy accessories (always room, unlimited)
2. Items that fit → auto-stored, notification: "Galvin fell. Iron Axe, Vulnerary → Convoy"
3. Items that don't fit → **Overflow Selection** (see 1.6)

#### Source 3: Manual Deposit

Player manually sends a unit's item to convoy via roster screen. Standard inventory management.

#### Source 4: Shop Purchase Overflow

If a player buys an item at a shop but no unit has inventory room:
1. Check convoy for room
2. If room → item goes to convoy
3. If no room → purchase blocked ("Convoy full. Make room first.")

### 1.6 Overflow Selection

When items need to enter the convoy but slots are full, the **Overflow Selection** screen appears:

```
┌──────────────────────────────────────────────┐
│          CONVOY FULL — Choose What to Keep    │
│                                               │
│  Incoming items:                              │
│  ✦ Silver Lance (from fallen Osric)          │
│  ✦ Master Seal (from fallen Osric)           │
│                                               │
│  Convoy Weapons (5/5):                        │
│  [1] Iron Sword                               │
│  [2] Steel Bow                                │
│  [3] Hand Axe                                 │
│  [4] Javelin                                  │
│  [5] Steel Lance                              │
│                                               │
│  → Select a convoy item to REPLACE,           │
│    or [Skip] to discard the incoming item     │
│                                               │
│  [1-5] Replace  |  [S] Skip  |  [A] Skip All │
└──────────────────────────────────────────────┘
```

**Rules:**
- Player must resolve each incoming item individually
- Can replace an existing convoy item (old item discarded, new item stored)
- Can skip (discard the incoming item instead)
- Can "Skip All" to discard all remaining overflow items
- Cannot exit without resolving all items
- Shows item stats for comparison (incoming vs existing)
- This screen appears mid-loot or mid-death-resolution, before returning to node map

### 1.7 Convoy Persistence

- Convoy is **run-state** — saved alongside roster, gold, act progression in RunManager
- Convoy persists across all battles within a run
- Convoy is **empty at run start** (no meta-progression pre-fills convoy, only unit loadouts)
- Convoy is **cleared on run end** (victory or defeat)
- Cloud save includes convoy state

### 1.8 Interaction with Existing Systems

**Trading (roster screen):** The existing [Trade] button on the roster screen works between units. Convoy adds a third option: Trade with Convoy. Select item from unit → Send to Convoy, or select convoy item → Give to Unit.

**Shops:** Shop UI unchanged. If player buys an item and selects a unit whose inventory is full, prompt: "Send to Convoy instead?" If convoy also full, purchase blocked.

**Forging:** Whetstones currently apply immediately on loot pickup — bypass convoy entirely. No change. (Whetstone storage deferred to future roadmap.)

**Accessories:** One accessory equipped per unit. Extras auto-store in convoy (unlimited accessory storage). From convoy, player can assign accessories to units via roster screen.

**Scrolls (skill + art):** These are consumable items — stored in convoy supply slots until used. Skill scrolls are used from inventory to teach a skill. Art scrolls are used from inventory to add an art to a weapon. Both are consumed on use.

---

## Part 2: Meta-Progression — Convoy Upgrades

### 2.1 New Upgrades

```json
[
  {
    "id": "convoy_weapons",
    "name": "Supply Wagon",
    "description": "+2 convoy weapon slots per level",
    "category": "capacity",
    "maxLevel": 3,
    "costs": [100, 100, 100],
    "effects": [
      { "convoyWeaponSlots": 7 },
      { "convoyWeaponSlots": 9 },
      { "convoyWeaponSlots": 11 }
    ]
  },
  {
    "id": "convoy_supplies",
    "name": "Field Satchel",
    "description": "+2 convoy supply slots per level",
    "category": "capacity",
    "maxLevel": 3,
    "costs": [100, 100, 100],
    "effects": [
      { "convoySupplySlots": 7 },
      { "convoySupplySlots": 9 },
      { "convoySupplySlots": 11 }
    ]
  }
]
```

**Pricing rationale:** 100 Supply per tier is cheap because convoy expansion is quality-of-life, not combat power. Total investment: 300 per track, 600 total for max convoy. Compare to combat upgrades like Deploy Limit (1000) or Deadly Arsenal (1500). Players should feel good about buying convoy space early — it prevents frustrating discard moments without making runs easier.

**Category:** Both go in `capacity` alongside existing Deploy Limit, Roster Cap, and Vision Charges upgrades.

### 2.2 Updated Capacity Tab

The Home Base **Battalion** tab (capacity category) would show:

```
Tactical Advantage    — +1 deploy slot          [1000] (requires Beat Act 2)
Expanded Ranks        — +2 max roster           [600]  (requires Beat Act 1)
Prophet's Glimpse     — +1 Vision charge         [750]
Sera's Revelation     — +1 Vision charge         [1500] (requires Prophet's Glimpse)
Skilled Recruits      — Random combat skill      [500]
Supply Wagon          — +2 convoy weapon slots   [100/100/100]  ★ NEW
Field Satchel         — +2 convoy supply slots   [100/100/100]  ★ NEW
```

---

## Part 3: Loot Table Restructure (Reference)

Full loot table restructure design is documented in `gdd_units_reclassing.md`, Part 5.

**Summary of changes:**
- `lootTables.json` splits the old `rare` pool into typed sub-pools: `skill_scrolls`, `art_scrolls`, `legendary`, `special_items`
- Each sub-pool has independent weight in the top-level `weights` object
- `special_items` pool supports internal per-item weights (Infantry Second Seal weight 3, Mount Second Seal weight 2, Sickle & Hammer weight 1)
- Art scrolls are roster-filtered with 5% leak rate (95% chance only weapon types matching roster, 5% any)
- Act 1 gets Iron-tier art scrolls at low weight for early excitement
- Gold ranges updated: Act 1 = 300–500, Act 2 = 600–900, Act 3 = 900–1400, Final = 1200–1800

**Convoy integration:** When loot drops and no unit has room, items auto-deposit to convoy. If convoy is also full, Overflow Selection triggers.

---

## Part 4: Shop System (Current State)

### 4.1 Current Implementation

Shops appear at SHOP nodes on the node map. Inventory is generated per-visit based on act and available item pools.

**Current shop behavior (no changes proposed — documenting for reference):**
- Weapons filtered by roster proficiencies
- Guaranteed Vulnerary and Elixir in stock
- Item count scales by act
- Prices from data files (weapons.json, consumables.json, accessories.json)
- Difficulty modifier: `shopPriceMultiplier` (Normal 1.0, Hard 1.15, Lunatic 1.25)

### 4.2 New Shop Items (from other GDD docs)

| Item | Shop Availability | Price | Source Doc |
|------|-------------------|-------|------------|
| Infantry Second Seal | Act 3+ shops, all difficulties | 3000 | Units & Reclassing |
| Herb | Hard Act 3+ / Lunatic Act 2+ | 400 | Combat Expansion |
| Pure Water | Hard Act 3+ / Lunatic Act 2+ | 600 | Combat Expansion |
| Remedy | Hard Act 3+ / Lunatic Act 2+ | 800 | Combat Expansion |
| Restore Staff | Hard Act 3+ / Lunatic Act 2+ | 1500 | Combat Expansion |

These items appear in shop inventory when conditions are met. No other shop generation changes needed.

### 4.3 Shop + Convoy Interaction

When buying from a shop:
1. Player selects item to purchase
2. Player selects a unit to receive it
3. If unit has room → item goes to unit, gold deducted
4. If unit is full → prompt "Send to Convoy?" → if convoy has room, deposited there
5. If both full → "No room. Manage inventory first." Purchase blocked.

---

## Part 5: Gold Economy (Current State — Defer Tuning)

### 5.1 Earning

| Source | Amount | Notes |
|--------|--------|-------|
| Kill gold | Per-enemy, scales by act/difficulty | `goldMultiplier` from difficulty.json |
| Turn bonus | S/A/B/C rating × base bonus per act | Act 1: 100, Act 2: 200, Act 3: 300, Final: 400 |
| Loot gold drops | Gold category in loot table | Act 1: 300–500, Act 2: 600–900, Act 3: 900–1400 |
| Meta: War Chest | +100/+200/+300 starting gold | 3 tiers |
| Meta: Plunder | +20%/+40% battle gold | 2 tiers |
| Blessing: Coin of Fate | +100 starting gold | Tier 1 blessing |
| Blessing: Merchant Bane | +15% battle gold (but skip first shop) | Tier 3 blessing |

### 5.2 Spending

| Sink | Cost Range | Notes |
|------|-----------|-------|
| Weapons (shop) | 500–2500 | Iron 500, Steel 1000, Silver 2000, special +300 |
| Consumables (shop) | 300–2500 | Vulnerary 300, Elixir 1500, Master Seal 2500 |
| Accessories (shop) | 1000–3000 | Boots most expensive at 3000 |
| Church: Revive | 1000 | Restore fallen unit |
| Church: Promote | 3000 | Class promotion |
| Infantry Second Seal (shop) | 3000 | Act 3+ |
| Status countermeasures (shop) | 400–1500 | Difficulty-gated |
| Stat boosters (shop) | 2000–2500 | Act 2+ |

### 5.3 Economy Health Assessment

**Not tuned in this document.** Current gold economy is being tracked via the economy rebalance stream (separate agent plan per ROADMAP.md). Key concern areas for future tuning:

- **New spending sinks** from combat expansion (art scrolls at 1500–2500 in shops if we add shop availability) may create gold pressure in Act 2–3
- **Second Seal at 3000** is a major purchase — comparable to Church promotion. Intentionally expensive.
- **Status countermeasures are cheap** (400–800) — shouldn't distort economy on Hard/Lunatic
- **Convoy upgrades are trivially cheap** (100 each) — won't affect economy

**Recommendation:** Playtest with current earn rates + new sinks. If Act 3 feels too tight, increase turn bonus gold or loot gold ranges. If too loose, increase shop price multiplier or reduce loot gold weight.

---

## Part 6: Inventory Management (Current State)

### 6.1 Per-Unit Inventory

| Slot Type | Capacity | Notes |
|-----------|----------|-------|
| Weapons | INVENTORY_MAX (5) | Includes equipped weapon |
| Consumables | Shared with weapons in current impl | Part of the 5-slot inventory |
| Accessory | 1 | Separate slot, always 1 |

**Note:** The current implementation stores weapons and consumables in a shared 5-slot inventory. The roster screen UI already visually separates them (Inventory section for weapons, Consumables section for items) but the underlying data model is a single array.

### 6.2 No Changes Proposed

Unit inventory capacity stays at 5. The convoy absorbs overflow pressure. If playtesting reveals that 5 is too tight with weapon arts (weapons now have arts attached, making each weapon more valuable and harder to discard), this can be revisited.

---

## Part 7: Implementation Sequencing

### Phase 1: Convoy Data Model
1. Add `convoy` object to run state in RunManager: `{ weapons: [], supplies: [], accessories: [] }`
2. Add convoy capacity constants: `CONVOY_WEAPON_BASE = 5`, `CONVOY_SUPPLY_BASE = 5`
3. Wire meta-progression effects for convoy expansion (`convoyWeaponSlots`, `convoySupplySlots`)
4. Add convoy to save/load serialization
5. Tests: convoy init, capacity with meta, serialization round-trip

### Phase 2: Convoy UI
6. Add [C] View Convoy toggle to RosterOverlay
7. Build convoy panel: weapon list, supply list, accessory list with slot counts
8. Implement Give to Unit / Send to Convoy / Discard actions
9. Keyboard navigation: [C] toggle, arrows, [Enter], [D] discard
10. Tests: UI state transitions, item transfer correctness

### Phase 3: Item Flow Integration
11. Post-battle loot: auto-deposit to convoy when unit inventory full
12. Unit death: dump all items to convoy
13. Overflow Selection screen for when convoy is also full
14. Shop purchase → convoy fallback when unit full
15. Tests: loot overflow, death dump, overflow selection, shop-to-convoy

### Phase 4: Deploy Screen Integration
16. Add convoy panel to pre-battle deploy screen (withdraw only)
17. Allow equipping convoy items to deploying units
18. Tests: deploy withdraw, convoy state after deploy

### Phase 5: Meta-Progression
19. Add Supply Wagon + Field Satchel to metaUpgrades.json
20. Wire capacity effects in MetaProgressionManager
21. Update Home Base Battalion tab UI
22. Tests: upgrade purchase, capacity scaling, effect persistence

---

## Part 8: Deferred Items

| Item | Status | Notes |
|------|--------|-------|
| Gold economy tuning | Defer to playtest | Economy rebalance stream active per ROADMAP.md |
| Shop generation rework | Not needed | Current system handles new items via availability gating |
| Whetstone storage | Defer to future roadmap | Currently apply-on-pickup; storable whetstones add UI complexity |
| Art scroll shop availability | Defer to playtest | Currently loot-only; may add to Act 3+ shops if acquisition feels too random |
| Relics system | Defer to future roadmap | Passive team effects, separate from convoy |
| Sell items to shop | Not planned | FE traditionally doesn't have sell; convoy + discard covers inventory management |

---

## Appendix A: Resolved Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Convoy type | Passive overflow (not a map node) | Simpler; items just "exist" in your run state |
| Convoy slot split | Weapons + Supplies (separate) | Prevents hoarding one type; mirrors unit inventory structure |
| Accessory storage | Unlimited | Accessories are rare enough that limiting them adds pain without meaningful tension |
| Convoy access during battle | No | Mid-combat convoy removes inventory commitment decisions |
| Meta upgrade pricing | 100/100/100 per track | QoL, not combat power. Should feel cheap and obvious to buy |
| Overflow resolution | Mandatory before continuing | Can't leave items in limbo; forces the roguelike discard decision |
| Unit death item dump | Everything (equipped + unequipped) | Dead unit's gear is your team's inheritance |
| Deploy screen access | Withdraw only | Full management happens on node map roster; deploy is grab-and-go |
| Starting convoy | Empty | Meta fills unit loadouts, not convoy. Convoy catches overflow during the run. |
| Convoy per save slot | Yes (part of run state) | Each save slot's active run has its own convoy |

## Appendix B: Data Changes Summary

| File | Changes |
|------|---------|
| `metaUpgrades.json` | +2 entries (Supply Wagon, Field Satchel) in capacity category |
| `RunManager.js` | Add convoy object to run state, save/load serialization |
| `constants.js` | Add `CONVOY_WEAPON_BASE = 5`, `CONVOY_SUPPLY_BASE = 5` |
| `lootTables.json` | Restructure per `gdd_units_reclassing.md` Part 5 (sub-pools) |
| `consumables.json` | New items per `gdd_units_reclassing.md` Part 5.6 |
