# Attack flow: target first, weapon second (+ equipped-first inventories)

Status: **built** on `claude/attack-flow` (2026-09-25). Source: iPhone playtesting and
`docs/playtest-2026-09-22.md` notes #5, #8, #16, #23, #35.

## Goal

A crisp, Fire Emblem-style attack: pick whom to hit, then read and tune the exchange.

## 1. Target first, weapon second

```
Action menu ─Attack─▶ SELECTING_TARGET ─pick─▶ SHOWING_FORECAST ─confirm─▶ combat
      ▲                    │   ▲                       │
      └────── Back ────────┘   └── Cancel (same target) ┘
```

- **Attack** highlights every enemy the unit can attack from its tile with **any usable
  weapon** — the range union. "Usable" = proficient combat weapon (no staves, scrolls,
  consumables), not magic while Silenced, not a per-battle weapon with no uses left; range
  includes skill bonuses (Foresight). Fog hides unseen enemies as before. There is no
  weapon submenu any more.
- **Picking a target** opens the forecast on the **default weapon**: the equipped weapon if
  it can attack that target at that distance, otherwise the first weapon in inventory
  order that can (equipped-first order, so "first" skips only the equipped one).
- **In the forecast** the player switches:
  - weapons — ◀ ▶ (canvas arrows / phone stepper beside the weapon name), swipe left/right
    on the phone forecast, Left/Right keys, L1/R1 on a pad. Only weapons that can hit
    *this* target at *this* distance are offered, equipped first; a counter shows `2/3`
    and an **E** badge marks the equipped weapon. Numbers (damage, hit, crit, AS,
    doubling, counter, projected HP/KO) are recomputed live from the pure
    `getCombatForecast`.
  - targets — ▲ ▼ (canvas) / the enemy-side stepper (phone), Up/Down keys, d-pad
    up/down on a pad, or tapping/clicking another highlighted enemy (desktop). FE
    convention: **every target starts from the equipped weapon**, not from the weapon
    previewed on the previous target.
- **Cancel** in the forecast returns to target selection with the cursor on the same
  target and the equipped weapon restored. **Back** from target selection returns to the
  action menu (weapon and bag order exactly as before Attack).
- **Confirm** commits: the chosen weapon becomes the equipped weapon and moves to the top
  of the inventory, then combat resolves as before.

### Crisp input

| | Target selection | Forecast |
|---|---|---|
| Touch | tap a red tile or a target button in the side pane (focused target outlined) | ◀ ▶ weapon stepper, swipe, ◀ ▶ target stepper, Cancel / Confirm |
| Mouse | click a target | click another target to switch, click the target again or CONFIRM ATTACK |
| Keyboard | arrows cycle targets, Enter/Space opens the forecast, Esc = Back | Left/Right weapon, Up/Down target, Enter/Space confirm, Esc = Cancel |
| Pad | d-pad / L1 R1 cycle targets, A opens, B back | d-pad ←→ weapon, ↑↓ target, L1/R1 weapon, A confirm, B cancel (phone dialog keeps its focus navigation; L1/R1 = weapon) |

- **Minimal taps:** after moving, tapping (or clicking) an enemy in reach opens its
  forecast directly (skips Attack → target). Only from the post-move top-level menu when
  Attack is offered and enabled; the unmoved planning menu keeps tap-to-inspect.
  Desktop (pointer/pad) also attacks from the pre-move selection: clicking an enemy in
  reach — now or after moving to the closest attack tile — opens its forecast
  (`specs/playtest-polish.md` §2).
- A pulsing ember **reticle** (corner brackets; static under Reduce Motion) marks the
  focused target on the map during target selection and the forecast; the grid cursor
  snaps to it (the camera follows).
- The phone forecast leads with the outcome: `HP 18 / 18 → 10` (or `→ KO`) beside the
  current HP. Rebuilding the forecast keeps the focused control and the scroll position,
  so switching weapons neither flickers nor jumps focus.
- The danger/threat overlays are untouched (target highlights use the existing attack
  layer).

### Weapon arts and staves

- **Weapon arts stay their own action.** An art is bound to its weapon, so its forecast
  has no weapon switching; its targets are the ones that art's weapon reaches.
  "Normal Attack" in the art picker enters the new target-first flow.
- **Staves stay pick-staff-then-target when several can be used.** Staff ranges, targets
  (allies, cure, relocation) and effects differ per staff, so choosing the staff first
  keeps the target highlights truthful; with one usable staff it goes straight to
  targets as before. Using a staff is **not** an equipment change: the staff is held
  provisionally and the prior weapon comes back afterwards (no bag reorder). A unit that
  had a staff equipped still switches to its first combat weapon afterwards (existing
  counter-readiness rule), which is a real equip and moves that weapon to the top.

## 2. Equipped weapon always first

Like FE, the equipped weapon is inventory slot 1 and moves there whenever the equipped
weapon changes:

- `equipWeapon(unit, w)` moves `w` to the top; everything else keeps its relative order.
  `{ reorder: false }` exists only for provisional holds (forecast preview, staff use).
- Every path that changes the equipped weapon normalizes: roster/unit-details/battle
  Equip, confirming an attack with another weapon, trade/give (the giver's next weapon;
  an **unarmed** receiver now equips a received usable weapon), store/sell/remove of the
  equipped weapon, promotion/reclass invalidation, Lethal Armory and run-start grants,
  boss-recruit lords, fallen/revived units, the dev presets.
- In place (no reorder): forge, whetstones, imbues, staff `_usesSpent`, weapon arts on
  items.
- **Views** (battle Equip and staff menus (the Item menu lists consumables only), canvas + DOM trade, unit details, roster
  Equipment and trade screens, phone roster sheet, forge/imbue pickers, reward weapon
  pickers, shop sell/forge lists, party summaries, the forecast) list the equipped weapon
  first with an **E** mark (`E ` prefix on canvas, `.re-equipped-badge` in DOM). Views use
  `inventoryDisplayOrder()`, so enemies (whose AI swaps weapons without reordering, to
  keep AI tie-breaks and determinism unchanged) and legacy checkpoints also read
  equipped-first.

### Persistence decision: normalize on load (run level), restore battles exactly

- **Run-level boundaries normalize** (guarded, deterministic, RNG-free, idempotent):
  `RunManager.fromJSON` (legacy saves), `serializeUnit` (the run save and battle-end roster
  sync — it reorders its copy only), `getRoster` (deployment), `completeBattle`, revive,
  fallen-unit transfer. A legacy save therefore shows equipped-first as soon as it loads,
  with no player action required — normalizing only "on next equip" would leave legacy
  bags visibly wrong in every inventory view until then.
- **Battle checkpoints and rewind snapshots restore exactly.** They carry index-based state
  (`equippedInventoryIndex`, a committed attack's weapon-art `weaponIndex`) and "Resume
  Battle" promises an exact restore, so they are never reordered on load. New checkpoints
  are equipped-first anyway (every in-battle equip normalizes); a legacy mid-battle
  checkpoint normalizes on the next equip and at battle end, and its views still read
  equipped-first through `inventoryDisplayOrder`.
- Weapon-art selections (and committed-attack intents) now also carry the weapon's `uid`
  (`weaponUid`, optional, validated) and resolve by uid first, then index; confirming an
  art attack re-derives the index after the reorder. Old intents without a uid resolve as
  before.
- Reordering never consumes battle RNG (pure array moves; tests spy `Math.random` and the
  battle RNG cursor).

## 3. Forecast HP/KO projection (playtest #23, #35)

Cause found in the forecast: `simpleExchange` hid the "If all hits land" projection when
**either weapon had any special text** (Lightning's "Lightest magic") or **any combat
accessory** was worn (Soothing Stone). Now only specials that change HP outside the shown
numbers (drain, post-combat poison — a defender's only if it can counter) and accessories
that act inside the exchange (Vampire's Bloodshard per-hit heal, Phoenix Brooch, unknown
keys) suppress it. Guard tests classify every weapon special and accessory in the data.

## Deviations / notes

- The canvas desktop forecast keeps its bottom-centre panel; target cycling there is via
  keys/pad/▲▼ glyphs or clicking another highlighted target (the map stays visible).
- Enemy AI weapon choice is unchanged and does not reorder enemy bags (AI determinism);
  enemy views are display-ordered instead.
- Bolting's `perBattleUses` is respected by the attack options, but no code spends a
  per-battle weapon use today (pre-existing gap, out of scope).
- Legacy (non-fixed-v1) battles roll Gambler's Coin from the live stream when a forecast
  opens for a new target; switching targets in the forecast is equivalent to the
  existing Cancel → pick another target and adds no new kind of draw. fixed-v1 battles
  use keyed randoms (no draw).
