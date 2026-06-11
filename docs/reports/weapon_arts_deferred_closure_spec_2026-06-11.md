# Weapon Arts Deferred-Mechanics Closure Spec (2026-06-11)

Status: Implementation-ready (decisions locked with design owner)
Supersedes the remaining scope of `weapon_arts_next_mechanics_plan_2026-02-16.md`.

## Current Inventory (verified against code, not docs)

`data/weaponArts.json` carries **10** `_deferredMechanic` markers, not the 15 the
ROADMAP/status doc still claim. Tier 2 legendary (d3b1e36) and Tier 5
(cce08b5) shipped after those docs were written.

### Stale markers (mechanics already implemented — cleanup only)

| Art | Marker | Reality |
|---|---|---|
| `legend_blood_lance` | `allyBuff(+5 STR)` | `effects.allyBuff` runs via `tier5_ally_buff` pipeline |
| `legend_cataclysm` | `aoeSplash(2-tile fixed dmg)` | `effects.aoeSplash` runs via `tier5_aoe_splash` |
| `legend_tempest` | `aoeSplash` | same |
| `legend_cataclysm_bolt` | `aoeSplash(2-tile)` | same |

Action: delete the 4 markers; no behavior change (covered by `WeaponArtsTier5.test.js`).

### Genuinely unfinished (6 arts)

| Art | Promised mechanic | Today |
|---|---|---|
| `bow_encloser` | Root target 1 turn | placeholder +15 Hit/+5 Atk |
| `bow_ward_arrow` | Silence target 1 turn | placeholder +15 Hit/+5 Atk |
| `magic_silence_strike` | "Full shutdown" 2 turns | placeholder +8 Atk/+10 Hit/+10 Crit |
| `bow_all_or_nothing` | 2x damage on hit, 5 self-dmg on miss | placeholder +15 Atk/-10 Hit |
| `legend_annihilate` | Ignore weapon triangle + kill buff | description already (falsely) claims triangle ignore |
| `legend_divine_flare` | Ignore RES + effective vs dark | description already (falsely) claims both |

Bonus defect found: Luce's weapon special `"Effective vs dark enemies"` never
matched the `Effective vs X (Nx)` parser and "dark" was undefined — the special
is dead text. Fixed as part of Divine Flare work.

## Locked Decisions (design owner, 2026-06-11)

1. **Annihilate**: implement BOTH triangle ignore and kill buff (+4 STR/+4 SPD
   until the start of the user's next phase, on kill).
2. **Silence Strike "full shutdown"** = existing Silence condition, 2 full
   phases (no magic attacks, no staves, no skill procs/auras).
3. **Dark classes** = Dark Knight, Warlock, Zombie, Revenant, Dragon,
   Dragon Lord, Entity (new `DARK_CLASSES` constant; used by both the art
   effectiveness and Luce's weapon special).
4. **All or Nothing self-damage is non-lethal** (floors at 1 HP, same as
   weapon-art HP costs).

## Status Condition Framework Extensions

The status-staff framework (`StatusConditionSystem.js`) is reused; weapon arts
inflict conditions **deterministically on landed hit** (no RES-based status
roll — the art already costs HP and must land a combat hit).

- New condition `root`: unit may act but not move. Enforcement:
  - Player: movement range collapses to current tile (`BattleScene` select
    path + `InputController` preview), Canto suppressed in `finishUnitAction`.
  - Enemy: `AIController._decideAction` computes movement with `mov = 0`
    (current tile stays a candidate; attacks from place still work).
  - Danger-zone/threat ranges use effective MOV 0 while rooted.
- Duration semantics: `processConditionRecovery` decrements at the start of
  the afflicted side's phase **before** the unit acts, so a condition meant to
  last N full phases is stored with `turnsRemaining = N + 1`. The data field
  `duration` means "full phases"; the runtime does the +1.
- Deterministic durations: `applyCondition` gains an options bag with a
  per-instance `recoveryChance` override (stored on the condition instance);
  art-inflicted conditions use `recoveryChance: 0` so the staff framework's
  50% early-recovery roll does not apply. Staff behavior unchanged.
- UI: condition icon map gains `root` ('Rt'); recovery banner labels gain root.
- Persistence: `_conditions` already survives battle suspend
  (`BattleSuspendController`) and is stripped from run saves; root inherits
  both behaviors for free.

## Data Contract

### Tier 3 status arts

```json
"effects": { "afterCombat": [ { "type": "status", "target": "defender", "status": "root", "duration": 1 } ] }
```

- `bow_encloser`: root, duration 1; keeps a real +10 Hit (pinning shot must
  land); placeholder +5 Atk removed.
- `bow_ward_arrow`: silence, duration 1; keeps +10 Hit; +5 Atk removed.
- `magic_silence_strike`: silence, duration 2; keeps +10 Hit; +8 Atk/+10 Crit
  removed.

Per the Tier 2 precedent, placeholder stat padding is dropped when the real
mechanic ships; the retained hit bonus is intrinsic to "a shot that must land".

### Bespoke arts

- `bow_all_or_nothing`:
  `combatMods.damageMultiplier: 2` (applies to the art user's strike damage,
  after all additive math, before per-strike crit), plus
  `effects.selfDamageOnMiss: 5` (5 damage per missed strike by the art user,
  non-lethal floor 1 HP). Placeholder +15 Atk/-10 Hit removed (the description
  never promised a hit malus).
- `legend_annihilate`:
  `combatMods.ignoreWeaponTriangle: true` — the entire combat is resolved with
  both sides' triangle bonuses zeroed (hit and damage), plus
  `effects.killBuff: { "durationPhases": 1, "stats": { "STR": 4, "SPD": 4 } }`
  — if the art user lands a hit and the opponent is dead when the post-combat
  pipeline reaches the step, the user gains a timed self-buff via the existing
  Tier 5 timed-buff machinery (same expiry rules as ally buffs).
- `legend_divine_flare`:
  `combatMods.ignoreRES: true` — for the art user's strikes, defender
  RES is treated as 0 (only meaningful for RES-targeting attacks; terrain DEF
  still applies), plus
  `combatMods.effectiveness: { "classNames": ["Dark Knight", "Warlock", "Zombie", "Revenant", "Dragon", "Dragon Lord", "Entity"], "multiplier": 3 }`
  — art effectiveness extended to support class-name matching alongside
  moveTypes. The existing 5x art+weapon effectiveness stacking cap applies.

### Weapon fix

`getEffectivenessMultiplier` gains a branch: specials matching
`Effective vs dark enemies` → 3x when `DARK_CLASSES.has(defender.className)`.
This makes Luce's always-on weapon special real (not just during the art).

## Engine Changes

- `src/utils/constants.js`: `STATUS_CONDITIONS.root`, `DARK_CLASSES`.
- `src/engine/StatusConditionSystem.js`: `applyCondition(unit, id, turns, opts)`
  instance `recoveryChance`; `isRooted`.
- `src/engine/WeaponArtSystem.js`: Tier 2 parser accepts `type: "status"`
  (`inflictStatus` bucket: target/status/duration validated against known
  conditions); `getWeaponArtCombatMods` adds `damageMultiplier`,
  `ignoreWeaponTriangle`, `ignoreRES`; `normalizeEffectiveness` accepts
  `classNames`; new getters `getWeaponArtMissEffects` (selfDamageOnMiss) and
  `getWeaponArtKillEffects` (killBuff).
- `src/engine/Combat.js`: new mods normalized/merged; `calculateDamage`
  options `ignoreRES` + `ignoreTriangle`; forecast + resolve apply
  `damageMultiplier` and zero both triangles under `ignoreWeaponTriangle`;
  art effectiveness matches classNames; weapon special dark branch.
- `src/engine/WeaponArtPostCombat.js`: emits hit-gated `tier2_status` steps,
  `art_miss_self_damage` (per missed strike by the art user), and
  `art_kill_buff` (hit-gated; death checked at application time).
- `src/scenes/BattleScene.js` + `tests/harness/HeadlessBattle.js`: apply the
  three new step types with parity; root gating; recovery labels; icon map.
- `src/ui/WeaponArtVisibility.js`: effect summaries for all new mechanics
  (menu/tooltip disclosure before any animation work).
- `src/ui/WeaponArtController.js`: enemy AI art scoring weights for status
  infliction, damage multiplier, triangle/RES ignore, kill buff, and a malus
  for miss self-damage.

## Test Plan

- `tests/StatusConditionSystem.test.js`: instance recoveryChance override;
  root helpers.
- `tests/WeaponArtSystem.test.js`: new normalizers (status effects, miss/kill
  getters, new mods, classNames effectiveness).
- `tests/Combat.test.js`: damageMultiplier math + forecast/resolve parity;
  ignoreWeaponTriangle zeroes both sides; ignoreRES; dark effectiveness via
  art classNames and via Luce's weapon special; 5x stacking cap.
- `tests/WeaponArtPostCombat.test.js` (or Tier-pipeline suite): tier2_status
  hit-gating; miss self-damage counting; kill-buff step emission.
- Scene/harness parity tests in the existing Tier-style suites for status
  application, gambit self-damage, and kill buff.
- Root movement gating: AIController candidate collapse; canto suppression.
- Full gates: `npm test`, `check:reference`, `check:data-parity`,
  `sim:fullrun:harness:pr`.

## Doc Cleanup (same change)

- ROADMAP.md: "15 deferred" → 0 after this change (counts corrected).
- `docs/weapon-arts-expansion-status.md`: new snapshot — 75/75 implemented.
- `data/weaponArts.json` `mvp.notes`: drop the deferred-placeholder note.
