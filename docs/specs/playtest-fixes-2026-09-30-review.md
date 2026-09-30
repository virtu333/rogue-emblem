# Review: 93bbaa14 (recruit affixes, affix forecast notes, Canto Danger)

Reviewed against `b3a6e816`, the spec commit before it. Nothing blocks merging, but #1 misses what the spec asked for.

**Checks run here, all passing:**
- `validate:data`, `check:data-parity`, `format:check` and `lint` (warnings only).
- `test:unit`: 8,972 tests.
- `test:harness`: 192 tests.
- `test:sim`: 41 tests.

**Not run:** the browser lanes and the device check.

## What holds up

- **Recruit policy.**
  - `recruitAffixesAllowed` reads the encounter's act. Recruit node `battleParams` always carry
    `act` (`NodeMapGenerator.buildBattleParams`), so the `'act1'` fallback is only reached by data
    with no act.
  - The veto sits before both the rolled pass and the Eclipse guaranteed pass
    (`allowAffixes === false`). That covers Eclipse overrides.
  - Scripted reinforcement waves are stripped from the clone. Affixes only enter a battle through
    spawn data (`BattleScene` line ~2588 copies `spawn.affixes`), so no other path exists.
  - The Loom's `affixCount` agrees with the generator.
- **Forecast notes.**
  - Each condition follows the engine's own rules:
    - Counters use `canCounter`.
    - Thorns needs range 1 and a reflect of at least 1.
    - Shielded takes its hit out of the damaging-hit count, for Thorns, Teleporter and Deathburst.
    - Grievous is skipped against status immunity.
  - `forecastProjectionSafe` keeps Thorns' HP projection.
  - A unit whose affix data is missing still hides the projection, which is conservative.
- **Danger.** `canUseDanger` is the single gate. The tap, the hold, the dock and the older phone
  controls all read it, and target selection no longer shows a Danger button that does nothing.
- **Canto resume tests** now pin the real checkpoint boundary, both after combat and after a
  consumable.

## Findings

### 1. The first-time affix rule text shows after the attack, not in the forecast (medium)

`AttackFlowController` calls `showContextualHint(scene, 'affix_<id>', …)` when the forecast
opens. That helper holds the hint until `battleState === 'PLAYER_IDLE'` (`HintDisplay.js` ~374).
It also shows at most one contextual hint per battle, shared with the staff and consumable
lessons.

The result: a player's first Deathburst or Venomous rule appears after they have already attacked,
and a second new affix in the same battle waits for a later battle. The spec wanted the full rule
at decision time.

**Suggested fix:** leave the global hint queue alone. The first time an affix id appears in a
forecast (`hints.hasSeen('affix_<id>')` is false), render that note's `description` under its
one-liner in the forecast itself: canvas text, or an open `<details>` on the phone. Mark it seen
when the forecast closes (confirm or cancel). After that it collapses back to the one line.

### 2. The desktop enemy detail panel can overflow at 640×480 (medium, unverified)

`UnitDetailOverlay` now puts every affix's full description (9px, wrapped to 376px) above the
tabs. That pushes the Stats and Gear content down.

The panel grows downward from a fixed top (`CY − 185`) with no scrolling. The footer line is
drawn at a fixed `top + OVERLAY_H − 18`, so longer content runs under the footer text and can go
past the bottom of the screen.

Two long affixes (Thorns is about 200 characters) add roughly 50–60px. The new e2e covers only
the phone sheet.

**Suggested fix:** check it at 640×480 with Thorns plus Deathburst on a unit with a full Gear tab.
If it overflows, show `Name — forecastText` (one line each) above the tabs and keep the full text
in a tooltip. Or keep the full text and move the footer below the content.

### 3. Deathburst's line shows even when nobody can be hit (low; readability)

The `lethal` condition fires at any range. With a bow at range 2 and no unit next to the enemy,
the line warns about damage that cannot land.

**Suggested fix:** also require a unit the player can see on a tile next to the enemy.
`forecastText` could then say "hits Edric" when the attacker stands there. This follows the
"quiet by default" goal.

### 4. Small clean-ups (nits)

- `Combat.js`: the new import sits above the file's header comment. Move it into the import block.
- `atkWarnings` / `defWarnings`:
  - The comment says "legacy consumers read warnings", but no renderer reads them any more.
  - `warnings` now only feeds the internal Thorns check. It also holds the source's own
    `on-attack` affixes, so its meaning has flipped.
  - Either drop `warnings` from the forecast object and read `affixNotes` inside Combat, or
    rename the field.
- `DIFFICULTY_DEFAULTS.recruitAffixExcludedActs = ['act1']`, while `recruitAffixesAllowed` treats
  a non-Normal mode that lacks the key as `[]`. `resolveDifficultyMode` would therefore merge
  `['act1']` into such a mode. No code reads it that way today. Pick one default, or keep the key
  out of `DIFFICULTY_DEFAULTS`.
- `canUseDanger` adds the tutorial strict gate to the tap path, which the tap path did not have
  before. That matches the spec. The tutorial never teaches Danger, so nothing breaks.

## Before release

- [ ] #1 and #2, or a decision to ship without them.
- [ ] Run the `portrait` and `mobile-ui` lanes, plus `battle-information.spec.js`.
- [ ] iOS: the Act 1 First Light recruit fight has no affix, a later Venomous or Deathburst forecast
      reads cleanly, and Danger works while Canto is confirming.
