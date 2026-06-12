# Status Countermeasures + Restore Staff Spec (2026-06-12)

Status: Implementation-ready
Closes the ROADMAP item "Status Staves + Countermeasures" (item 12) and the
"status staves + countermeasure rollout" deferral that was gated on Wave 4.
Companion to `docs/specs/difficulty_spec.md` §4 (the original plan) and
`docs/reports/weapon_arts_deferred_closure_spec_2026-06-11.md` (which made
art-inflicted root/silence live on every difficulty).

## Current State (verified against code, not the old spec)

More of §4 shipped with the status-staff wave than the docs record:

| §4 plan | Reality today |
|---|---|
| Sleep/Berserk/Plant enemy staves | Sleep + Silence staves shipped (enemy-only, `enemyStatusStaffChance`: 0 Normal / Hard / Lunatic with act gating). Berserk/Plant never built; root now exists via weapon arts instead of a Plant staff. |
| Herbs consumable (cure self, 400g) | **Shipped** as `Herb` (`effect: "cure"`, 2 uses, 400g) with a full battle item flow: self or adjacent-ally targeting, `clearAllConditions` + icon cleanup + undim. |
| Remedy staff (cure ally, 800g) | Shipped as the `Remedy` **consumable** instead (`effect: "cureHeal"`, 10 HP, 1 use, 800g). No cure *staff* exists. |
| Pure Water (+7 RES, 3 turns, 600g) | Never built. |
| Shop availability | `shopCureGating` appends Herb + Remedy to shops — Normal: never, Hard: act3+, Lunatic: act2+. |
| Loot availability | None. No cure item appears in any loot pool. |
| `unit.status` / `statusTurns` fields | Superseded by the `_conditions` array (`StatusConditionSystem.js`) with per-instance `recoveryChance`. |

### Gaps this change closes

1. **No staff-based cure.** A dedicated healer has no action-efficient answer
   to sleep/silence/root; the only cures are consumables that cost the
   *afflicted* unit's neighborhood an action and don't scale with MAG uses.
2. **No proactive counter.** Nothing prevents status; the only play is
   reactive curing or RES-stacking (which art-inflicted statuses bypass
   entirely — they land deterministically on combat hit).
3. **Cure items never drop.** Herb/Remedy are shop-gated only; on Normal they
   are unobtainable even though art-inflicted root/silence (enemy art users)
   now exist on every difficulty.

## Design Decisions

### 1. Restore staff (the headline)

```json
{ "name": "Restore", "type": "Staff", "tier": "Steel", "rankRequired": "Prof",
  "might": 0, "hit": 100, "crit": 0, "weight": 1, "range": "1-2",
  "uses": 2, "perBattleUses": true, "cureConditions": true,
  "special": "Cures all status conditions on an ally", "price": 1200 }
```

- Cure-only (no HP heal) — classic FE Restore; the Remedy consumable already
  owns the cure+heal niche.
- Range 1-2 flat (no Physic-style MAG range scaling — keep that distinctive).
- 2 base uses; MAG 8/14/20 bonus uses and per-battle reset apply automatically
  via the existing staff-use machinery (`getStaffMaxUses`, `_usesSpent = 0` at
  battle start for `perBattleUses`).
- Awards staff XP (`XP_BASE_HEAL`) like a heal — curing is a real action.
- Cannot self-target (consistent with heal staves; Herb covers self-cure).
- Player-only in practice: enemies acquire staves exclusively through the
  `spawn.statusStaff` path, which assigns Sleep/Silence by name.

### 2. Warding Charm accessory (proactive counter — replaces Pure Water)

```json
{ "name": "Warding Charm", "type": "Accessory",
  "combatEffects": { "statusImmunity": true }, "price": 2000 }
```

**Why not Pure Water?** The original +7 RES/3 turns design predates two
shipped realities: (a) art-inflicted statuses land deterministically on
combat hit — RES does nothing against them, so Pure Water would be a
confusing non-counter to the newest status source; (b) it requires brand-new
timed-buff-on-unit machinery (turn countdown, suspend/rewind persistence,
forecast integration). The immunity accessory counters *every* status source
(staves, arts, acid terrain), uses the existing `combatEffects` machinery
end-to-end, and costs a real tradeoff — the accessory slot. Pure Water can
still be added later if a consumable-shaped proactive counter is wanted.

Semantics:

- Blocks **new** condition applications while equipped. Does not cleanse
  conditions already present when equipped (cure tools exist for that).
- Enforced at the engine level inside `applyCondition` (single choke point →
  staves, arts, acid terrain, and the headless harness all inherit it).
  `applyCondition` returns `true` if applied, `false` if blocked/invalid so
  UI call sites can branch (icons/hints only when actually applied).
- `resolveStatusStaff` short-circuits to `{ hit: false, immune: true }` for
  an immune target (no hit roll, no RNG consumed); the enemy-staff banner
  shows a "protected" message instead of Miss.
- Enemy status-staff AI skips immune targets (won't waste limited uses).
  Enemy weapon-art scoring is left as-is: status arts also deal damage, so
  using one into an immune target is suboptimal but not nonsensical.

### 3. Availability rollout

Principle (from difficulty spec §4.2): countermeasures must be obtainable at
or before the act where status pressure appears (Lunatic: act2; Hard: act3;
Normal: art-inflicted only, any act).

- **Loot pools** (`lootTables.json`, difficulty-independent):
  - `healing`: + Herb (act2, act3, act4), + Remedy (act3, act4)
  - `weapons`: + Restore (act2, act3, act4)
  - `accessories`: + Warding Charm (act2, act3, act4)
- **Shops**: Warding Charm and Restore flow in through the normal loot-pool
  draw. The `shopCureGating` guaranteed-append list grows from
  [Herb, Remedy] to [Herb, Remedy, Restore] so a gated shop always stocks
  the full reactive kit (the append lookup is extended to search weapons as
  well as consumables).
- `getConsumableLootCategory` learns `cure`/`cureHeal` → `healing` so cure
  items survive legacy-pool splitting and categorize correctly.
- `shopCureGating` per-difficulty values are unchanged (Normal keeps no
  guaranteed cure append; Herb now drops as act2+ loot there instead).

## Engine Changes

- `src/engine/StatusConditionSystem.js`:
  - `isCureStaff(weapon)` — Staff with `cureConditions: true`.
  - `isHealStaff(weapon)` — now excludes cure staves (Staff && !statusEffect
    && !cureConditions).
  - `isStatusImmune(unit)` — `unit.accessory?.combatEffects?.statusImmunity`.
  - `applyCondition` — immune gate; boolean return (true = applied).
  - `resolveStatusStaff` — immune early-out with `immune: true` in result.
- `src/ui/HealController.js`:
  - `findHealTargets` — cure-staff branch: allies (not self, alive) in staff
    range with at least one condition; heal staves unchanged.
  - `executeHeal` — cure-staff branch: `clearAllConditions`, remove condition
    icons, undim (a slept ally cured during player phase can act this turn —
    the selection gate reads `isSleeping` live), `animateCure`, spend use,
    re-equip combat weapon on depletion, award `XP_BASE_HEAL`.
  - `animateCure` — green flash + floating "Cured!" (mirrors `animateHeal`).
- `src/scenes/BattleScene.js`:
  - `tier2_status` case — branch on `applyCondition`'s return: icon + status
    hint only when applied; "Immune!" hint when blocked.
  - Acid terrain application — icon + banner only when `applyCondition`
    returns true.
  - `executeEnemyStatusStaff` — `result.immune` → "`X` is protected!" banner.
- `src/engine/AIController.js` — status-staff target filter adds
  `!isStatusImmune(u)`.
- `src/engine/LootSystem.js` — cure category mapping; cure-gating append list
  + weapon-aware lookup.
- `src/utils/accessoryText.js` — `statusImmunity` added to
  `HANDLED_ACCESSORY_COMBAT_EFFECT_KEYS` + renders "Immune to status
  conditions" (contract validator enforces both).

Headless-harness parity: immunity lives inside `applyCondition`, so the
harness mirror of `tier2_status` inherits it with no harness change. The
harness has no staff-cure agent behavior (same accepted limitation profile as
root enforcement for scripted player movement).

## Test Plan

New `tests/StatusCountermeasures.test.js`:

- Data: Restore/Warding Charm shapes; loot pools reference only known items
  (existing contract validator covers); cure items categorize as `healing`.
- Classification: `isCureStaff` / `isHealStaff` / `isStatusStaff` are
  mutually exclusive across all staves in weapons.json.
- Restore flow: `findHealTargets` returns only conditioned allies in range
  1-2; executeHeal cure path clears conditions, spends a use, awards XP,
  re-equips on depletion (mock-scene pattern from the existing controller
  tests).
- Immunity: `applyCondition` blocked + returns false (no `_conditions`
  mutation); applied path returns true; `resolveStatusStaff` immune result
  applies nothing; art `tier2_status` vs immune defender applies nothing in
  scene-equivalent + harness paths; acid gate; AI staff targeting skips
  immune units; sleep/silence/root all blocked.
- Shop/loot: cure-gating append includes Restore (weapon lookup path);
  Herb/Remedy/Restore/Warding Charm reachable in their acts' pools.
- Text: accessory detail renders for Warding Charm; consumable text already
  covers cure/cureHeal (existing tests).
- Full gates: `npm test`, `check:reference`, `check:data-parity`,
  `sim:fullrun:harness:pr`, prettier, eslint.

## Doc Cleanup (same change)

- ROADMAP item 12 marked shipped with corrected contents (Sleep/Silence
  staves + Herb/Remedy/Restore/Warding Charm; Berserk/Plant/Pure Water
  superseded — rationale here).
- CLAUDE.md data-file counts (114 weapons, 30 accessories).

## Explicitly Out of Scope

- Berserk/Plant staves (root via arts covers the Plant niche; Berserk needs
  AI-override machinery — separate feature if ever).
- Pure Water (see rationale above; re-evaluate after playtesting).
- Player-usable offensive status staves (difficulty spec "later scope").
- Enemy AI curing its own statused units.
- Boss status immunity tuning (bosses can currently be rooted/silenced by
  design — revisit with playtest feedback).
