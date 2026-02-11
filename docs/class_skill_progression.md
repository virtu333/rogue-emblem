# Class Skill Progression Rules

This document defines the current class-skill progression behavior.

## Learnable Skill Thresholds

- Base-class learnable skills unlock at level `15`.
- Promoted-class learnable skills unlock at level `10`.
- If a unit is promoted and reaches level `10`, they also gain any missed learnable skills from their base class.

## Current Notable Class Assignments

- `Mage`: learns `luna` at base level `15`.
- `Thief`: learns `luna` at base level `15`.
- `Sage`: has innate `spell_harmony` (granted by class innate system, not learned by level).

## Sage Innate: Spell Harmony

- Skill ID: `spell_harmony`
- Trigger: `on-combat-start` with `initiating` condition
- Effect: grants `+1 Atk` per adjacent allied `player` unit (no cap)

## Dance/Dancer Safety Contract

- `dance` remains a class-innate skill for `Dancer`.
- The level-based learnable-skill threshold system must not gate or remove `dance`.
- Save migration must preserve `dance` and avoid duplicate insertion.

## Save Migration Behavior

On `RunManager.fromJSON` load:

1. Class-innate migration runs first (including promoted + base innates where applicable).
2. Class-learnable migration then grants skills that now qualify under current thresholds.
3. Skill insertion respects max-skill cap and avoids duplicates.

This keeps old saves compatible when class-skill thresholds or assignments change.
