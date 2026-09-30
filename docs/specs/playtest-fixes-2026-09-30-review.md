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

- [x] #1 and #2, addressed and browser-verified.
- [x] Run the `portrait` and `mobile-ui` lanes, plus `battle-information.spec.js`.
- [ ] iOS: the Act 1 First Light recruit fight has no affix, a later Venomous or Deathburst forecast
      reads cleanly, and Danger works while Canto is confirming.

## Resolution

Findings 1–3 and the actionable nits are addressed on this branch:

- Full affix rules appear inside the forecast before confirmation. All unseen affixes
  expand, without spending the general hint budget. Cycling weapons or targets keeps
  them expanded; confirm/cancel acknowledges every displayed rule through HintManager.
  Subsequent phone forecasts retain a reopenable disclosure.
- The regular desktop details view uses the same scrolling DOM sheet as mobile.
  The canvas fallback did overlap its footer in the reported two-affix/full-Gear case.
  It now has one compact line per affix and the full rule on hover/long press.
- Deathburst needs a possible kill and a living known unit in the blast radius.
  Player, enemy and NPC victims all count. The scene passes only inspectable units,
  so an unseen neighbor cannot disclose its position through the warning.
- Combat's header/import order is corrected. The obsolete `warnings` field is removed;
  Thorns projection reads `affixNotes` by id. Difficulty resolution and recruit policy
  share their missing-key fallback.

Regression coverage checks cancel and confirm, cycling, multiple new affixes, the real
HintManager acknowledgment, fog boundaries, all victim factions, legacy difficulty
resolution, and actual canvas/phone layout. The long-forecast browser fixtures now
exercise `affixNotes` rather than the unused `warnings` property.


**Follow-up validation:** 8,978 unit tests, 192 harness tests and 41 simulations passed.
Browser checks passed on their first attempts: all 280 portrait-lane cases, all 36
mobile-ui cases, 7 battle-information cases and 3 forecast-input contracts (326 total).
Build, formatting, lint (0 errors; existing warnings), schema validation, data parity,
generated-reference and content checks passed. Mutation checks caught disabling the
inline explanations and exposing a hidden blast neighbor. A physical iOS smoke test
is still outstanding before release.

## Second pass: fb1dd61b

I re-ran `test:unit` here: 8,977 passed, 1 skipped. Findings 1–3 are fixed as described. I found
nothing that blocks merging. Two small follow-ups, both optional:

- **Acknowledgement can happen without the player reading the rule (low).** `hideForecast()` marks
  every shown rule as seen, and it runs on paths the player did not choose. Examples: scene
  shutdown (~line 627, which includes the portrait/landscape switch) and End Turn. If a forecast
  is open at that moment, its first-time explanation collapses unread. Suggested fix: mark rules
  seen only from confirm and cancel (`cancelForecast`, the confirm path), and let the other
  `hideForecast` callers discard `_affixLessonsShown` instead.
- **Field affixes truncate in the canvas inspection line (low).** Regenerator, Waller and Haste
  have no `forecastText`, so the compact row falls back to the full description and cuts it with
  an ellipsis (Waller loses most of its sentence). The tooltip still has the full rule. A short
  `summary` string for these three (e.g. "Heals 20% HP each enemy phase") would read better.
  Validate it the same way as `forecastText`.

The only remaining release item is the physical iOS smoke test.

### Second-pass follow-ups: resolved

- **Only a player's choice acknowledges a rule.** `hideForecast({ acknowledge })`: Confirm (all
  three exits of `confirmForecastCombat`) and Cancel (`cancelForecast`) mark the shown rules
  seen. End Turn, rewind and scene shutdown close the forecast without marking anything, so the
  rule shows in full next time. `AttackFlowController.test.js` covers an unchosen close followed
  by a Cancel; the test fails if acknowledgement is unconditional again.
- **Short inspection lines for every affix.** Affixes without a forecast line (`numbers` and
  `field`) now require a `summary`, enforced by the schema, and it is filled from their effects.
  - `affixSummaryText` gives the forecast line, or the summary, for the canvas inspection row.
  - An unknown `{placeholder}` now stays visible instead of printing as an empty value, so the
    contract test catches it.
  - Every line, including the affix name, is at most 66 characters (Berserker and Anchored were
    73 and 77).

Checks: 8,980 unit tests, data validation and parity, reference, UI theme, format, lint and
build. Browser lanes were not re-run for this patch; it changes only the canvas row's text and
when rules are marked seen.
