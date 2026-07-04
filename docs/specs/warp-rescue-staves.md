# Spec: Warp & Rescue Staves

**Design log entry:** `docs/design-log.md` (2026-07-04, later — "ally-relocation is staff-exclusive" ruling)
**Branch:** `claude/rogue-emblem-early-game-5djnaz-staves`
**Size:** Medium

## Intent

Classic FE utility staves. Ally-relocation is staff-exclusive by design ruling: it gives healers a
second high-leverage job (roster incentive), and keeps teleportation gated by staff ranks, uses,
and gold. Player-only — enemies never relocate player units (feelbad rule).

- **Rescue Staff** (defensive): pull a distant ally within MAG-scaled range to a tile adjacent to
  the caster. Yank an overextended trainee out of danger; ferry a slow unit.
- **Warp Staff** (aggressive, famously strong): send an **adjacent** ally to a passable tile
  within MAG-scaled radius of the caster. Gated hard: Mastery rank (promoted staff users only),
  1 use, act3+, premium price. The par-bonus system already rewards what Warp enables — scarcity,
  not nerfs, is the balance lever.

## Current state (verified)

- Staff flow is owned by `src/ui/HealController.js`: `getUsableStaves` (:27), multi-staff picker
  `showStaffPicker` (:95), `findHealTargets` (:40 — branches on staff kind; staves cannot
  self-target), `startHealTargetSelection` (:64), `executeHeal`/`executeHealAll` (:175/:237) with
  the `try/finally finishUnitAction` + staff XP pattern (`awardScaledXP(healer, XP_BASE_HEAL)`).
- Menu entry built at `BattleScene.showActionMenu` :5578-5616 (`Heal (rem/max)` label, silence
  gate); click routing at :5745-5757.
- Uses/MAG mechanics in `src/engine/Combat.js`: `calculateBonusUses` (:421, thresholds 8/14/20),
  `getStaffMaxUses` (:426), `getStaffRemainingUses` (:432), `spendStaffUse` (:438, `_usesSpent`),
  **`getEffectiveStaffRange` (:464) — MAG-scaled via the `rangeBonuses` field** (Physic precedent:
  `range "2"` + `[{mag:10,bonus:1},{mag:18,bonus:1}]`).
- `schemas/weapons.schema.json` is `additionalProperties:false` — new staff fields MUST be added
  to the schema or `tests/SchemaValidation.test.js` fails.
- Relocation primitives: `BattleScene.executeWarp` (:8323, fade → set col/row →
  `updateUnitPosition` (:3032) → fade) and `AffixSystem.getWarpCandidates` (:235 — note it
  returns only the max-distance ring; player-chosen destinations need the FULL passable-unoccupied
  diamond). The utility-abilities branch has `getBlinkTiles` (full diamond) but is **not on
  main** — if it has merged by implementation time, reuse it; otherwise implement an equivalent
  pure helper (e.g. `getRelocationTiles` in a small `src/engine/StaffRelocation.js`).
- Enemy AI reads only `enemy.statusStaff` (AIController :281-341) — player-only scoping is free.
- Economy: staves ride the per-act `weapons` loot pools in `lootTables.json` and the shop draws
  from the same pools; Sera's starting staff comes from `STARTING_STAFF_TIERS` (unchanged here).

## Data

Two staves in `weapons.json` (+ schema additions + `public/data` sync). New fields:
`relocate: "rescue" | "warp"` (add to schema). **Range semantics per kind** (documented in
`mechanicsReference.json`):

- For **Rescue**, `range` (+ `rangeBonuses`) = the ally-*targeting* range; the destination is a
  free tile adjacent to the caster.
- For **Warp**, the ally target is always adjacent (distance 1); `range` (+ `rangeBonuses`) = the
  *destination radius* around the caster. This reuses `getEffectiveStaffRange` unmodified for the
  MAG scaling in both cases.

| Field | Rescue Staff | Warp Staff |
|---|---|---|
| tier / rank | Steel / Prof | Legend / **Mast** |
| range | "3" | "4" |
| rangeBonuses | `[{mag:10,bonus:1},{mag:18,bonus:1}]` | `[{mag:12,bonus:1},{mag:18,bonus:1}]` |
| uses | 2 | 1 |
| price | 2400 | 5000 |
| loot/shop pools | act2/act3/act4 `weapons` | act3/act4 `weapons` |
| special (display) | "Pulls a distant ally to your side" | "Sends an adjacent ally across the field" |

Both: `type "Staff"`, might 0, hit 100, crit 0, `perBattleUses: true` (matching all staves).
Neither joins `STARTING_STAFF_TIERS` or enemy pools.

## Flow

Two-phase targeting, shared by both staves (two new battle states serve both):

1. **`SELECTING_STAFF_ALLY`** — extend `findHealTargets`' kind-branching (heal / cure / relocate):
   - Rescue: living allies within effective range, **excluding** allies already adjacent to the
     caster (no-op), and only if ≥1 free adjacent destination tile exists for that ally's moveType.
   - Warp: living adjacent allies, only if ≥1 valid destination tile exists in the radius.
   - Never self. Never NPCs (green units) v1.
2. **`SELECTING_STAFF_TILE`** — highlight destination candidates (`grid.showAttackRange` pattern):
   - Rescue: free, passable-for-the-*ally's*-moveType tiles adjacent to the caster.
   - Warp: full passable-unoccupied diamond of effective radius around the caster (by ally's
     moveType). Exclude the ally's current tile.
   - Cancel from phase 2 returns to phase 1.
3. **Resolve** (reuse the existing `HEAL_RESOLVING` guard state — no new resolving state): fade
   the ally out, set `col/row`, `updateUnitPosition`, fade in (executeWarp pattern, alpha respects
   `hasActed` dim). Then `spendStaffUse`, depletion auto-swap, staff XP
   (`awardScaledXP(healer, XP_BASE_HEAL)`), all inside the try/finally-finishUnitAction pattern
   from `executeHeal`. The **moved ally's** acted state is untouched (FE-classic: an un-acted ally
   can still act after being moved).

**State registration (all 8 sites, per the verified checklist):** InputController click switch
(:301-344), `isCancelableBattleState` (BattleScene :3513), ESC/cancel recovery chain (:3619),
`playerInputStates` (:3699 — do NOT copy the SELECTING_BREAK_TARGET omission), `_emitMobileContext`
(:3736), the input-guard array (:3826), `VisionRewindController` allowed states (:336). Suspend
mid-selection is already safe (selection states aren't checkpointed mid-flow; resolution is
atomic before the checkpoint, same as heals).

**Action menu:** relocate staves surface through the existing staff entry. When the preferred
usable staff is a relocate staff, label the entry `Staff (rem/max)` instead of `Heal (rem/max)`
(update `tests/BattleSceneEquipMenuText.test.js`). The multi-staff picker already shows per-staff
name/uses/range and handles mixed kits (healer carrying Heal + Rescue).

**Edge cases to handle + test:** destination legality by the *ally's* moveType (a rescued Knight
can't land on a Mountain; a flier can); no valid destinations → ally filtered out in phase 1;
commander relocation is allowed (it's not an escape/seize trigger — those require actions);
silence blocks staff use (existing gate); `_usesSpent` persists through battle suspend/resume
(existing mechanism — add a round-trip assertion).

## Tests

- `Combat.test.js` additions: effective-range resolution for both staves at MAG breakpoints.
- New `tests/StaffRelocation.test.js` (pure): candidate tiles (bounds/occupancy/passability by
  moveType/full-diamond vs adjacent), phase-1 target predicates for both kinds.
- Execution tests via the `HealXP.test.js` scene-stub pattern (`makeSceneCtx`): relocation sets
  col/row + calls updateUnitPosition, use spent once, XP awarded once, finishUnitAction always
  runs on error (`BattleSceneMovementRecovery.test.js` pattern), acted-state of moved ally
  untouched, depletion auto-swap.
- Menu label test update; schema validation (new `relocate` field declared); loot pool resolution.
- `npm run sync-data`; gates: `npm test`, `check:data-parity`, `check:reference`,
  `sim:fullrun:harness:pr` (no harness mirror needed — player-action only, no combat-resolution
  change).

## Out of scope

- Enemy/AI staff relocation; warping NPCs/green units; Rescue-carry (unit-carrying) mechanics;
  Hammerne/repair staves; changes to starting staff tiers or the staff_upgrade meta track.
