# Weapon Arts Tier 2 (Legendary Remainder) Spec

Date: 2026-02-17  
Owner: weapon-arts workstream  
Status: Draft spec (implementation-ready)

## Objective
Implement the remaining Tier 2 mechanics on the 5 deferred legendary arts so Tier 2 is fully closed (standard + legendary), using the existing post-combat pipeline with scene/headless parity.

## Investigation Summary
Current state in `data/weaponArts.json`:
- Tier 2 standard arts are already structured and shipped.
- Remaining Tier 2 deferred arts (5):
  - `legend_phantom_rush` (`postCombatMove, setHpTo5`)
  - `legend_piercing_charge` (`pierceThrough`)
  - `legend_galeforce_assault` (`postCombatMove, setHpTo5`)
  - `legend_storm_blade` (`postCombatMove(retreat)`)
  - `legend_doom_thrust` (`pierceThrough, postCombatMove(push)`)

Current runtime gap:
- Tier 2 parser/executor only supports `afterCombatDamage`, `afterCombatDebuff`, `postCombatMove`.
- No runtime support exists for `pierceThrough` or `setHpTo5`.

Relevant runtime hooks:
- Tier 2 parsing: `src/engine/WeaponArtSystem.js:270`
- Post-combat step build: `src/engine/WeaponArtPostCombat.js:47`
- Scene step application: `src/scenes/BattleScene.js:6680`
- Headless step application: `tests/harness/HeadlessBattle.js:1199`

## Scope
In scope:
- Implement Tier 2 remainder mechanics for the 5 arts above.
- Convert those arts to structured `effects` payloads.
- Remove `_deferredMechanic` from those 5 entries.
- Add scene/headless parity tests.

Out of scope:
- Legacy GDD "move then attack again" chain-combat behavior for Brave Sword/Axe signatures.
- New interactive post-combat movement UI.

## Locked Behavior Decisions
1. `setHpTo5` uses exact-set semantics, not cap semantics.
- If source is alive after combat, set `currentHP` to exactly 5 (clamped to `[1, maxHP]`).
- Does not revive a dead unit.

2. `pierceThrough` damage mirrors landed primary-hit damage.
- For each landed strike by the source side, apply that strike's `damage` to the unit directly behind the primary target (if valid).
- No separate hit/crit roll for the behind unit.

3. Galeforce movement for this closure pass is deterministic `advance 1`.
- This keeps implementation in the existing move resolver and avoids introducing post-combat directional choice UI.

## Data Contract (Structured Effects)
Represent all five arts with `effects.afterCombat` entries and remove `_deferredMechanic`.

### 1) `legend_phantom_rush`
```json
"effects": {
  "afterCombat": [
    { "type": "move", "mode": "retreat", "distance": 1 },
    { "type": "set_hp", "target": "attacker", "value": 5 }
  ]
}
```

### 2) `legend_piercing_charge`
```json
"effects": {
  "afterCombat": [
    { "type": "pierce_through", "target": "defender", "maxTargets": 1 }
  ]
}
```

### 3) `legend_galeforce_assault`
```json
"effects": {
  "afterCombat": [
    { "type": "move", "mode": "advance", "distance": 1 },
    { "type": "set_hp", "target": "attacker", "value": 5 }
  ],
  "allyBuff": {
    "range": 2,
    "durationPhases": 1,
    "stats": { "STR": 3 },
    "includeSelf": false
  }
}
```

### 4) `legend_storm_blade`
```json
"effects": {
  "afterCombat": [
    { "type": "move", "mode": "retreat", "distance": 1 }
  ]
}
```

### 5) `legend_doom_thrust`
```json
"effects": {
  "afterCombat": [
    { "type": "pierce_through", "target": "defender", "maxTargets": 1 },
    { "type": "move", "mode": "push", "distance": 1 }
  ]
}
```

## Runtime Spec

### Step Ordering
Maintain existing post-combat order and extend Tier 2 internal sequencing:
1. `afterCombatDamage`
2. `afterCombatDebuff`
3. `pierceThrough`
4. `postCombatMove`
5. `setHp`

Then apply existing Tier 5 steps (`aoeSplash`, `allyBuff`).

### Hit Gating
- `afterCombatDamage`, `afterCombatDebuff`, `pierceThrough`, and `postCombatMove` require at least one landed strike by that side (same as current Tier 2 gating).
- `setHp` is not hit-gated; it triggers whenever the art was used and source is still alive.

### `pierceThrough` Target Resolution
At application time:
- Determine direction vector from source unit to primary target.
- Require cardinal adjacency; otherwise skip.
- Secondary tile = one tile beyond primary target in that direction.
- Candidate on secondary tile must be:
  - alive,
  - hostile to source,
  - present at resolution time.
- Apply mirrored strike-damage sequence to candidate until damage list exhausted or candidate dies.

### `setHp` Resolution
- Execute after movement for that source side.
- If source is alive, set HP to `value` exactly (`5` here), clamped to `[1, stats.HP]`.

## File-by-File Implementation Plan
1. `data/weaponArts.json`
- Add structured `effects.afterCombat` entries for the five arts above.
- Remove `_deferredMechanic` from those five.

2. `src/engine/WeaponArtSystem.js`
- Extend Tier 2 normalization to parse new `afterCombat` types:
  - `pierce_through`
  - `set_hp`
- Extend `getWeaponArtTier2Effects` return shape:
  - `pierceThrough: []`
  - `setHp: []`

3. `src/engine/WeaponArtPostCombat.js`
- Extend Tier 2 effect order constant to include pierce + setHp.
- Emit new pipeline step types:
  - `tier2_pierce`
  - `tier2_set_hp`
- Add helper to extract landed strike damages for a side from `result.events`.

4. `src/scenes/BattleScene.js`
- Handle `tier2_pierce` in `_applyResolvedCombatPostEffects`:
  - resolve behind-target unit with board occupancy,
  - apply mirrored strike damage,
  - update bars/hints,
  - remove unit if lethal.
- Handle `tier2_set_hp`:
  - exact set to value and HP-bar/hint refresh.

5. `tests/harness/HeadlessBattle.js`
- Mirror scene behavior for `tier2_pierce` and `tier2_set_hp` exactly.

6. `public/data/weaponArts.json`
- Sync from `data/weaponArts.json` after data edit.

## Test Plan

### Unit/Parser
- `tests/WeaponArtsTier2.test.js`
  - Add 5 legendary arts to structured Tier 2 mapping assertions.
  - Assert `_deferredMechanic` is absent for those arts.
  - Add coverage for new effect types (`pierce_through`, `set_hp`) normalization and rejection.

### Scene/Headless Parity
- `tests/BattleWeaponArts.test.js`
  - Piercing Charge: behind-target takes mirrored per-landed-strike damage.
  - Piercing Charge: miss-only sequence does not pierce.
  - Doom Thrust: pierce then push ordering, with push legality checks.
  - Phantom Rush: retreat + set-to-5 behavior.
  - Galeforce Assault: advance + set-to-5 + existing ally buff still applies.
  - Storm Blade: retreat behavior remains deterministic and legal.

### Regression
- `tests/WeaponArtsTier4.test.js`
  - Update deferred-marker expectations for these arts to no longer require `_deferredMechanic`.
- Full test suite must pass after data sync.

## Acceptance Criteria
- Tier 2 deferred legendary count becomes 0.
- All 5 remaining Tier 2 arts use structured effects and no `_deferredMechanic` placeholders.
- Scene/headless parity tests pass for all new behaviors.
- No regressions in existing Tier 2/Tier 4/Tier 5 suites.
