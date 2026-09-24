# Staff recovery and legendary lord traits

## Scope and sequence

User requested staff recovery first, then legendary lord trait design, with a
TestFlight update before any portrait work. Portrait replacement is excluded.
Legendary mechanics were approved and implemented locally September 21; build 16 verification/release is in progress.

## Staff recovery — implemented locally

- Successful `RunManager.completeBattle` clears spent uses on per-battle equipment
  in the surviving roster, fallen-unit retained equipment, and weapon convoy.
- Completion precedes reward preparation and persistence. Deployment's existing
  reset remains as a defensive fallback. Ordinary consumables do not refill.
- Serialization, suspend/resume and rewinds must retain spent uses. No blanket
  load-time refill: old interrupted battles must not gain charges.
- Mobile roster staff summaries explicitly say "Refills after battle".
- Validation: 306 tests across RunManager, StaffDefense and
  RunManagerBattleInterruption pass, including completion/reload, stored staff,
  invalid completion, consumable preservation and unmodified battle input.

## Existing lord traits

Build 12 introduced one eligible ordinary trait for each starting/newly joining
lord. Build 11 runs are not retroactively assigned traits. Ordinary recruits use
their own 0–2 trait distribution. This feature extends lord rolls; it does not
replace the underlying guarantee of one trait.

## Recommended first set: one signature trait per lord

Values are initial balance proposals. All bonuses are in combat unless stated.

| Lord | Trait | Exact proposed effect | Theme / tradeoff |
| --- | --- | --- | --- |
| Edric | Standard Bearer | +2 ATK and +2 DEF while adjacent to another living allied unit. | Rewards formation rather than solo Edric. Self-only; no recursive aura stacking. |
| Sera | Overflowing Grace | When her healing staff actually restores HP to another unit, Sera also restores 3 HP to herself, once per player phase. | Sustains a healer under pressure; full-HP targets cannot farm it. |
| Kira | Calculated Opening | +15 Hit on initiating combat against a foe currently at full HP. | Accurate opening attacks; no extra range on top of Foresight. |
| Voss | Unbroken | +2 RES and +10 Hit at half maximum HP or less. | Supports Resolve's risky wounded play without adding another STR/DEF multiplier. |
| Rowan | Riding Guard | +2 DEF and +2 RES during combat he initiates after spending at least 3 movement cost. | Supports Ride Down without a second damage spike or extra action. |
| Astrid | Open Skies | +10 Hit and +5 Crit when initiating with no adjacent allied unit. | Supports Skyward's independent flanking without adding more avoid. |
| Cael | Dread Presence | +10 Hit while defending. | Rewards standing ground; uses the approved simpler alternative because Intimidate source provenance is not retained. |

Faction predicates should reuse existing allied-unit semantics, exclude self,
dead and escaped units, and count Manhattan adjacency. HP thresholds reuse
existing trait/personal-skill rules. Rowan uses the existing movement-cost
condition rather than inventing a separate distance measurement.

Cael uses the approved defensive alternative (+10 Hit when defending). Intimidate source provenance is not retained, so this release does not broaden the debuff model for that one trait.

## Approved roll and progression

- Legendary replaces the ordinary trait roll; it is not a second stacking trait.
- Proposed base chance 5%, with two permanent Valor tiers adding 5 percentage
  points each (10%, then 15%). Costs: 300 then 600 Valor, compared with existing lord upgrades. No real-money purchase mechanism.
- Same chance for starting and later-joining lords. Capture the effective chance
  in run modifiers so upgrades cannot change a run already in progress.
- Roll once per lord creation, persist the result before offering player control.
  Reloading, deployment, promotion, revival and rewind must never reroll.
- No retroactive random traits on existing saves. Existing ordinary traits and
  their baked stat bonuses remain untouched.
- Present a clear Traits heading in roster Stats; label signature traits
  Legendary and show the full condition/effect. Show starting traits before the
  first battle, without offering an in-place reroll button.
- Monitor restart fishing. Keep ordinary starts viable; no pity system or free
  reroll feature in this first slice.

## Implementation and verification checklist

1. Add lord-specific data eligibility and explicit legendary rarity; exclude
   these entries from ordinary recruit and ordinary lord pools.
2. Add creation-time weighted roll and meta upgrade effects, snapshotting chance
   into the run. Use run-creation randomness, never presentation randomness.
3. Implement condition checks through shared combat modifiers so forecasts and
   resolution agree. Sera's phase-limited heal needs checkpointed usage state and
   actual-healing event integration; do not implement it as display-only logic.
4. Add roster/setup explanations and Compendium entries, then verify long text.
5. Verify zero/base/capped roll boundaries, every lord's eligibility, no duplicate
   baked bonuses, unchanged legacy saves, creation/save/reload and late recruits.
   Combat cases cover forecast parity, healing at caps, phase reset, death and
   rewind restoration. No battle or presentation RNG draws for displaying traits.
6. Review the focused diff, run relevant persistence/timeline gates, then a brief
   muted mobile browser pass. Build and distribute to TestFlight after verification.

## Deferred

Second signature traits per lord, portrait candidates, and any migration granting
traits to older traitless lords. None is necessary to ship the staff recovery fix.

## Release verification

- Full unit pass: 5,646 tests / 335 files before two additional passing staff-controller cases.
- Timeline: 219 tests / 8 files. Journey: 56 tests / 3 files.
- Legendary boundary/persistence/conditions and production heal paths: 24 tests.
- Muted headed phone-layout roster/Compendium/staff-recovery check passed.
- Data validation, data parity and production build passed.
- Portrait assets unchanged; existing saves retain their traits.

- Strengthened headed test initially failed because the dev fixture had already completed its start node. Corrected to require successful completion of an unfinished battle; full/full displayed staff uses and legendary text then passed. No product change was needed.

- Released as **0.1.0 (16)** to Public Playtest on September 21, 2026. App Store Connect confirms **Testing**; source commit `49c7402`. Tester notes saved and automatic notifications enabled.
