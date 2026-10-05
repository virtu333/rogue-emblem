# EXP bars

Status: revision 3 (2026-10-05). Takes in the owner's decisions of 2026-10-05 (§6) and
their reference image (a console FE EXP gauge). PR 1 (§5) is implemented; revision 3
corrects §1 against the code and records PR 1's deviations and the notes for PR 2 (§7).

Players can't follow XP. In battle, each gain shows as a faint "+N XP" for 0.8 s. In the
roster it is a number inside a long text line: "Lv 7 Fighter · Base · XP 45/100 · HP
…". This spec adds two things, in the Fire Emblem tradition:

1. **The EXP gauge.** After every action that gives XP, a bar for each unit that gained
   fills from its old XP to its new XP. It wraps at 100 into the level-up card that
   already exists.
2. **The EXP bar in unit profiles.** A bar under the HP bar wherever a player unit's
   profile shows: the roster, battle inspect, shops, church, rewards, colosseum.

## 1. Where we are

### XP rules (no change)

- **Storage.** `unit.xp` holds 0–99 toward the next level; `XP_PER_LEVEL = 100`
  (`constants.js:54`).
- **Applying a gain.** `UnitManager.gainExperience` (1141-1172):
  - adds the XP and wraps once per level, so one gain can give several levels;
  - at the level cap (20, both tiers) it adds **nothing**;
  - a unit that reaches the cap mid-gain **keeps what is left** of the gain (0–99) at
    level 20. Only a leftover of 100 or more is clamped, and only after the loop spends
    another 100 on the refused level-up: `min(leftover − 100, 99)`. That XP can never
    earn a level (the unit is capped, and promotion resets XP to 0), so the bars treat
    it as nothing (§2.5, §3.1). *(Revision 2 said "clamped to 99"; corrected in
    revision 3.)*
  - extended leveling keeps wrapping: only for **promoted** units, and only on rungs
    with `extendedLevelingEnabled` (Nightfall and Black Sun). A base unit at 20 is
    capped even there.
  - Level-ups draw `Math.random`: one draw per stat (`levelUp`), one per extended
    level (`extendedLevelUp`'s stat pick). Anything that only reads a gain draws none.
  - Promotion resets to level 1, XP 0.
- **Where XP comes from.** `BattleScene.awardScaledXP` (8832-8881) applies every
  battle gain:
  - combat, including the defender's minimum and area arts;
  - staff (`HealController._runStaff`) and dance (`MovementActionController`): both
    call it with `present: false` inside the action's settlement and show the float
    themselves from their `present` step (`_presentScaledXP`);
  - Mentor's Band shares, through `awardXP` (8774).

  Arena (`ColosseumOverlay._settleFight`) and Team XP loot (`engine/TeamXp.js`) call
  `gainExperience` directly (`ColosseumEngine` also does, to level mercenaries it
  builds; that is not a gain anyone sees). The debug panel's level-up now goes through
  `applyXpGain` (PR 1).

### What the player sees today

| Where | Today | Problem |
|---|---|---|
| Battle, after XP | `_presentScaledXP` (8883-8905): "+N XP" floats up and fades over 800 ms in `monospace` 12px, at a magic depth 300 | Easy to miss. Fire-and-forget: it ignores battle speed and Reduce motion. It plays during the kill's death fade. It shows the **number awarded even at the level cap**, where nothing was gained |
| Level-up | Queued in `_pendingLevelUpPopups`; `presentQueuedLevelUps` (`BattlePresentationCheckpoint.js:74`) shows each card after the action's checkpoint | The card never says how much XP got there or what is left over |
| Roster / inspect profile (live in every browser) | `MobileRosterSheet.js:431` (before PR 1): `XP ${unit.xp}/${XP_PER_LEVEL}` inside the summary text line | A number in a sentence. Inspected **enemies** show "XP 0/100" |
| Battle hover line | `InputController.js:110-112`: `| XP 55/100`, with 100 hardcoded | Fine as text |
| Canvas fallback panels | `RosterOverlay.js:1067`, `UnitDetailOverlay.js:313` | Headless only; no browser shows them |

### Rules this work must keep

- **XP is applied before anything is drawn.** The gain is durable at the action's
  checkpoint before any presentation. `CombatBoundaryPresentation.test.js` ('level-up')
  and `ActionBoundaryPresentation.test.js` require the same state whether presentation
  runs, is skipped, has no sprites, or every draw call fails. The gauge is presentation
  only: it reads a record of the gain and never touches `unit.xp`.
- **Checkpoints.** `classifyBattleBoundary` (`BattleCheckpointAdapter.js:53`) calls a
  boundary `recovery` while level-up cards are pending. Gauges carry no state worth
  restoring. A refresh mid-gauge loses only the animation, as it does for the float
  today.
- **Speed and motion settings** follow the growth ceremonies (`growthTiming`,
  `growthContent.js:436-447`).

## 2. The EXP gauge (in battle)

### 2.1 What it shows

The gauge is the bar and nothing else, as the owner asked: it appears after every combat
(every attack, both phases) and shows the XP gained. The look follows the classic
console FE gauge: one wide ornamental bar across the map with the word on the left and
the number on the right.

```
        ╭───╮━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╭───╮
        │EXP│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░░░ │ 72│
        ╰───╯━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╰───╯
                                                  +12
         ▓ XP held before   ▒ XP just gained   ░ to go
```

- **Where.** Centred across the map frame, about 70% of its width (a minimum of 320 CSS
  px, the full width less the gutters on a phone).
  - **Vertically, beside the unit that gained:** just below its tile, or just above when
    that would cover the rail or leave the frame.
  - Its position says whose XP it is, so it carries no name. Under Mentor's Band each
    recipient's gauge appears by that recipient.
  - In portrait it uses the same rule on the turned board (`grid.gridToPixel` already
    returns turned coordinates).
- **The frame.** Original art in the game's own gilt style, drawn in CSS/SVG from
  palette tokens:
  - `accent` / `accentText` for the gilt;
  - `void` for the two medallions;
  - `sunken` for the bar bed.

  Like the boss reliquary bar (`BossPresenceController`), it borrows nothing from any
  FE game's assets. A painted frame from the art pipeline can replace it later without
  changing the controller.
- **The bar.**
  - The XP held before the gain shows in the fill colour (`info`). The gained span
    fills in a brighter tone (`accentText`) and settles to the fill colour once the
    gauge closes.
  - The right medallion counts up to the new value in step with the fill.
  - A small "+N" under the right end names the gain. N is the XP actually **gained**
    (§2.5), not the award before the cap.
- **Fill rate.** Constant, about **100 XP per 900 ms** at normal speed, with a short ease
  at the end. A +3 gain is brief; a +60 gain takes longer.
- **Wrapping at 100.**
  - The bar flashes (accent glow), and the right medallion reads "LV↑" for a beat.
  - The bar empties and fills the rest. Several levels from one gain wrap several times.
  - After the last segment the gauge closes and **that unit's level-up cards follow at
    once**, so the fill flows into the card.
- **At the level cap.** No gain, so no gauge and no float. Extended leveling counts as
  not capped.
- **Order with several recipients.** The actor first, then each Mentor's Band recipient
  in award order. One gauge at a time, each followed by its own cards.
- **The "+N XP" float is removed.** The gauge replaces it.

### 2.2 When it plays

The gauge joins the queue that already shows level-up cards. Today's timing (during the
death fade) is earlier than the cards and would split the moment in two.

- `awardScaledXP` still applies the gain synchronously, as now, and pushes a **gain
  record** onto a new queue, `scene._pendingXpGauges`, **whatever `present` says**: staff
  and dance pass `present: false` (their settlement applies the gain, their `present`
  step shows it), so a record pushed only when `present` is true would never reach
  them (revision 3, §7).
- `presentQueuedLevelUps` becomes `presentQueuedProgress` (old name kept as an alias).
  For each unit in award order, it plays that unit's gauge, then that unit's queued
  cards.
- **Every place that shows cards today now shows gauges first:**
  - the end of `executeCombat`;
  - the area strike;
  - `settleAndPresent` for staff and dance;
  - after each enemy's action in the enemy phase;
  - player turn start;
  - victory.
- `_pendingXpGauges` is **not** counted by `classifyBattleBoundary`. Pending gauges alone
  never make a boundary `recovery`.
- `_pendingXpGauges` is cleared wherever `_pendingLevelUpPopups` is cleared:
  - Vision rewind (`VisionRewindController.js:348`);
  - fatal paths (`BattleFatalDecision.js:17, 92`);
  - scene shutdown.

### 2.3 Speed, motion and skipping

| Setting | Gauge |
|---|---|
| Battle speed Normal | Full fill, a 350 ms hold at the end |
| Fast (or hold-to-fast-forward in the enemy phase) | All timings ×0.5 |
| Instant | No fill. The gauge shows the final state for a 400 ms hold, so the number still registers |
| Reduce motion | No fill or flash. Final state with the gained span marked, a 600 ms hold. A wrap shows "LV↑" in the medallion |
| Low effects | No glow on the flash |
| Tap, click, Confirm or Cancel | Skips to the end state, then closes |

- **Timing.** The fill and hold go through the scaled waits: new `COMBAT_WAITS` labels
  `xp_gauge_fill` and `xp_gauge_hold` in `combatTiming.js`, with entries in
  `CombatTiming.test.js`. A watchdog closes the gauge if its promise never settles,
  like every other battle wait.
- **Enemy phase.** A unit that survives an attack gains at least 1 XP, so a gauge
  plays after every enemy attack that lands on a living player unit. That matches FE,
  where the bar appears after every exchange. A +1 gain at normal speed adds about
  0.4 s per enemy combat; Fast and hold-to-fast-forward halve it.

### 2.4 How it is built

- **DOM on the map frame.** A non-blocking `CeremonyLayer` (`frame: 'map'`,
  `blocking: false`):
  - it follows resize and rotation as the level card does;
  - text is crisp on retina;
  - portrait comes from the layer's frame and CSS;
  - the handoff to the level card (also DOM) is seamless.
- **Fill.** A transform: `transform: scaleX(var(--xp-fill))`, as `.ch-bar` does in
  `choice.css:339-355`.
- **Driver.** The fill is driven from JS (a requestAnimationFrame counter, as
  `BossPresenceController` does), so the number and the bar stay in step and skipping is
  exact.
- **New file.** `src/ui/XpGaugeController.js` with the `create` / `destroy` pattern
  (CLAUDE.md God Objects rule: no new inline flows in BattleScene). Its CSS goes in
  `src/ui/xpGauge.css`, depth from `DOM_UI_DEPTHS` (under `CEREMONY`, over `BOSSBAR`).
  Upright rules go inside `@media (orientation: portrait)` and are keyed on
  `html.portrait-ui`.
- **Headless.** No DOM host means no gauge: `canRenderCeremony()` is false, so the
  controller returns at once. The harness and unit tests see no change.
- **Failures.** Every call goes through `safeBattlePresentation('xp gauge', ...)`. A gauge
  that throws never blocks the cards or the action.

### 2.5 The pure part: `engine/XpProgress.js`

The gauge needs the XP **before** the gain, and nothing records it today.
`applyXpGain` (`BattleXp.js:122`) returned only the result before PR 1.

- **`xpSnapshot(unit, { extendedLevelingEnabled })`** returns
  `{ level, extendedLevels, xp, capped }`.
- **`applyXpGain`** takes a snapshot before calling `gainExperience` and returns
  `before`, `after` and `gained` along with what it returns today.
  - `gained` is the XP that counted toward levels: 0 at the cap, less than awarded when
    the gain reaches the cap.
  - `awardScaledXP` keeps returning the scaled award: Mentor's Band, tutorials and tests
    rely on it. The gauge reads `gained`.
- **`xpGainSegments(before, after, levelUps)`** returns the fill segments, for example
  `[{ from: 72, to: 100, level: 7, wraps: true }, { from: 0, to: 15, level: 8 }]`
  (each segment also carries `extendedLevels` and `label`, the level as shown).
  - Reaching the cap: the gain ends on the wrap into it, which carries `capped: true`
    (`{ from: 90, to: 100, level: 19, wraps: true, capped: true }`). Nothing fills past
    it: the gauge flashes LV↑, then shows the MAX state. The XP the unit keeps at the
    cap is not filled and not counted (§1). *(Revision 2 had a last segment ending at
    99; there is no such state in the code.)*
  - For extended levels: the level label is `20+N`, via `getDisplayLevel`.
  - `gained` is the sum of the segments' spans (`xpGained`): the award in full below
    the cap, the part up to the wrap into the cap when the gain reaches it, 0 at it.
  - The function is pure, and the gauge only plays what it returns.
- **The gain record** on `_pendingXpGauges` is
  `{ unitId, unitName, before, after, gained, segments }`. It is built from plain values,
  so later changes to the unit (death, promotion) can't change what plays.

### 2.6 Arena and Team XP (PR 3)

- **Arena result** (`ArenaMenu.result`, "XP +N"): the same bar inside the result card,
  filling once and handing off to the arena's level card (`ColosseumOverlay.js:450-484`).
- **Team XP notice** ("+N XP All"): one small bar per unit in the notice list, drawn at
  the final value. There is no fill animation: it is a list, not a moment.

## 3. EXP bar in unit profiles

### 3.1 `MobileRosterSheet` (every browser profile)

- **The summary** (`.mr-summary`): drop "XP n/100" from the text line, which becomes
  "Lv 7 Fighter · Base · HP 18/24". Add an EXP row under the HP bar:

  ```
  [HP bar ▓▓▓▓▓▓▓▓░░]
  EXP [▓▓▓▓▓░░░░░] 45/100
  ```

  - New `src/ui/xpBar.js` `createXpBar(unit)`, alongside `healthBar.js`:
    - a `span.re-xp[role=meter]` with `aria-valuemin=0`, `aria-valuemax=100`,
      `aria-valuenow=xp`, and `aria-valuetext="45 of 100 EXP"`;
    - the same 7px bed and border as `.re-health`, `max-width: 160px`;
    - fill colour `--re-info` (today's XP colour);
    - "EXP" label and value in `--re-t-small`.
  - **At the level cap:** a full bar in the muted colour, value "MAX".
  - **Extended leveling:** a normal bar; the level reads `20+N` as today.
  - **Enemies and NPCs:** no EXP row. This also fixes "XP 0/100" on inspected enemies.
- **The unit list cards:** a 2px EXP line under the HP row of each card. Players can see
  at a glance who is near a level, for example when picking who takes a kill or who goes
  to the arena. See decision 3 in §6.
- **Upright:** the summary has no portrait rules today and the row fits the strip
  layout's width. Pin it in the `portrait-lists.spec.js` geometry checks.

### 3.2 Smaller places

- **Battle hover line:** keep the text, but use `XP_PER_LEVEL` instead of the hardcoded
  100.
- **Canvas fallbacks** (`RosterOverlay` / `UnitDetailOverlay`): draw the same bar with
  the 180×8 HP-bar code, so headless snapshots match the DOM. Low priority: no browser
  shows them.
- **`DebugOverlay`:** its `gainExperience(unit, xpNeeded, classes, skills)` call uses an
  old signature. Fix it in passing.
- **Level-up card:** no change. The gauge before it now carries the XP story.

## 4. Testing

Each test catches one realistic failure (CLAUDE.md "Writing tests"):

| Failure | Test |
|---|---|
| Segments are wrong at the edges | `XpProgress.test.js`, with expected values worked out by hand: plain gain; gain ending exactly at 100; one wrap; two wraps; a cap clamp to 99; already capped (`gained 0`, no segments); extended leveling past 20; a Mentor's Band share |
| The gauge changes game state | Add a gauge to the `'level-up'` entry of `CombatBoundaryPresentation.test.js` and to the heal/dance cases of `ActionBoundaryPresentation.test.js`. The snapshot must stay identical when gauges play, are skipped, or every nth gauge call fails |
| Something writes `unit.xp` from UI | `tests/XpWriteBoundary.test.js`, the analog of `HpWriteBoundary.test.js`: no `.xp =` / `+=` / `++` in `src/scenes` or `src/ui` |
| A pending gauge blocks a checkpoint | `classifyBattleBoundary` returns `destination` with only gauges pending. Rewind and fatal paths clear the queue |
| Order is wrong | Scene test: a kill with Mentor's Band that levels both units plays gauge A, cards A, gauge B, cards B |
| Speed settings are ignored | `CombatTiming.test.js` gets the two new labels. e2e checks Instant shows the static gauge and Fast finishes within its window |
| A float is shown at the cap | Scene test: a capped unit gains → no gauge and no float |
| Profile bar is wrong | Unit test of `createXpBar`: aria values, MAX at cap, nothing for enemies |

**Browser specs.** Each new spec goes in a lane in `tests/e2e/lanes.json`, and the specs
wait on state, never on time.
- `xp-gauge.spec.js` (presentation lane):
  - a real kill shows the gauge;
  - its `aria-valuenow` ends at the unit's saved `xp`;
  - a wrap hands off to the level card;
  - a tap skips to the end.
- `portrait-ceremonies.spec.js`: the gauge's geometry upright at 375×667, inside the map
  frame and clear of the rail.
- `mobile-roster.spec.js`: the profile's meter matches `unit.xp`; an inspected enemy has
  none.
- `item-trade.spec.js:429`: asserts `.mr-summary` text `HP x/y`, so check it still
  matches after the text line changes.

## 5. Delivery

| PR | Content |
|---|---|
| 1 | `XpProgress.js`, `applyXpGain` returning `before`/`after`/`gained`, `createXpBar`, the roster EXP row, list-card lines, enemy fix, hover constant, write-boundary test |
| 2 | `XpGaugeController`, the queue and `presentQueuedProgress`, timing labels, removing the float, presentation-invariance tests, e2e in presentation and portrait lanes |
| 3 | Arena result bar, Team XP notice bars, canvas fallbacks |

PR 1 alone answers the roster half of the request and ships with no battle-flow risk.

## 6. Owner decisions (2026-10-05)

1. **The gauge is the bar alone.** It appears after every combat, every attack and both
   phases, showing the XP gained, styled after the console FE gauge (§2.1). Placement
   (delegated): centred across the map, beside the unit that gained.
2. **Enemy phase: every attack.**
3. **List-card EXP lines: yes** (§3.1).
4. **Sound (delegated): a silent fill.** The level-up cue already marks the wrap. A
   fill tick can come later as an sfx without changing the controller.

## 7. Revision 3: implementation notes (PR 1)

### What PR 1 built

- `engine/XpProgress.js`: `xpSnapshot`, `isXpCapped`, `xpLevelCap`, `xpGainSegments`,
  `xpGained`. Pure; reads a unit, never writes one.
- `applyXpGain` also returns `before`, `after` (xpSnapshots either side of the gain)
  and `gained`. Everything it returned before, the unit's state and the `Math.random`
  draws are unchanged (pinned in `BattleXp.test.js` before the change). It does not
  return `segments`: PR 2 builds them with `xpGainSegments(before, after,
  result.levelUps)` when it makes the gain record.
- `ui/xpBar.js`: `createXpBar(unit, { extendedLevelingEnabled })`, `createXpRow`,
  `xpBarFacts`, `showsXp`. Styles in `reKit.css` (`.re-xp`, `.re-xp-row`), the card line
  in `mobileRoster.css` (`.mr-unit-bars`, `.re-xp.is-line`).
- `MobileRosterSheet`: the summary line drops XP and gains the EXP row under the HP bar;
  each card's HP bar and 2px EXP line share a `.mr-unit-bars` column; enemies and NPCs
  get neither.
- The battle hover line, `DebugOverlay`, `XpWriteBoundary.test.js` (no exceptions: the
  heal settlement's presentation fact `facts.xp` became `facts.awardedXp`).

### Deviations from §3.1

- **`createXpBar` takes the run's extended leveling** (`{ extendedLevelingEnabled }`):
  from `unit` alone a promoted unit at 20 on Nightfall cannot be told from a capped one.
  The sheet reads it from its `run`, or from `scene.runManager` when it has none
  (battle inspect, the church's fallen).
- **At the cap** the meter's `aria-valuenow` is 100 (the bar is full) and its
  `aria-valuetext` is "EXP MAX, at the level cap"; the stored XP there means nothing
  (§1). Below the cap `aria-valuenow` is `unit.xp`, as specified.
- **The card line** is `aria-hidden` (a button's children are presentational); the
  card's accessible name gains ", 45 of 100 EXP" (or ", EXP MAX, at the level cap").
- **The battle hover line** reads "XP MAX" at the cap instead of the meaningless
  leftover, as the profile does.
- The EXP label is in the info colour, the value in the text colour (the muted colour
  at MAX).

### Notes for PR 2

- **Staff and dance pass `present: false`** (§1, §2.2): push the gain record whenever a
  gain is applied, not only when `present` is true.
- **Gauge-only queues must present.** Today's presenters run only when
  `_pendingLevelUpPopups` is non-empty: `finishUnitAction` (BattleScene ~4988), the
  player turn start (~9438), `PostCombatController` (~277). Each needs to present when
  only gauges are queued, while `classifyBattleBoundary` keeps ignoring them.
- **The prologue's level-up beat.** `presentQueuedLevelUps` awaits
  `scene._prologue.onLevelUp(unit)` right after each unit's card (a blocking note in P1
  to P4). When it becomes `presentQueuedProgress` the order stays **gauge → that unit's
  cards → the prologue beat**, and a gauge must not open over a blocking prologue note:
  the next unit's gauge waits for the beat's task to settle (and for
  `scene._prologue.idle()` if a note is already showing when the queue starts).
- **Prologue chapter restart.** `PrologueController.restartChapter` calls
  `RunManager.restartPrologueBattle` and then restarts the scene; it clears the fatal
  and committed-action state but not the presentation queues (the scene's init resets
  `_pendingLevelUpPopups`, BattleScene ~537). `_pendingXpGauges` must be reset in that
  same init and cleared in `restartChapter` with the rest, so a gauge recorded before
  the fall never plays over the restarted chapter.
- **Turn start.** The player turn-start pipeline already awaits the prologue's
  `idle()` before it reads the battle state (BattleScene ~9425); gauges queued at turn
  start drain in that pipeline after it, with the cards (~9438), never over a prologue
  note.
