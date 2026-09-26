# Playtest round 3 — fix plan (2026-09-26)

Status: **planned, not built.** An implementation spec for an agent to pick up.

**Source.** The round-3 playtest and code review on branch `docs/playtest-round3-2026-09-26`,
under `docs/playtests/2026-09-26-round3/`: `review.md` (consolidated), `code-review.md`,
`save-ui-review.md`, `desktop.md`, `mobile-notes.md` and the `.mjs` probes. That review tested
commit `336cd41` (main through PR #113).

**Re-verified on main at `b8e13bf` (through PR #123).** Every finding below was re-checked on
that commit. Each has a status: **present** means reproduced or confirmed in source. None of the
findings in scope turned out to be fixed by PRs #114–#123.

To re-run the probes, check the docs directory out into this tree without committing it:
`git checkout origin/docs/playtest-round3-2026-09-26 -- docs/playtests/2026-09-26-round3`.

## Ground rules for the implementer

- Follow `CLAUDE.md` → Testing → *Writing tests*:
  - Every fix gets a test that **fails before the fix**. Prove it by planting the bug once.
  - Assert outcomes (persisted state, visible text), not call order.
  - Derive expected values independently of the code under test.
- Run the relevant CI gates before each push. At minimum: `format:check`, `lint`, `test:unit`,
  `validate:data` (when `data/*.json` changes), and the touched e2e lane.
  - A new e2e spec must go into a lane in `tests/e2e/lanes.json`.
- Edit `data/*.json`, then `npm run sync-data`. Never hand-edit `public/data/`.
- `BattleScene.js` is a god object. Put new multi-step UI in a controller or pure helper, not inline.
- Suggested PR split: one PR per workstream (WS1–WS8), in the order below. WS1 and WS2 are
  correctness fixes; ship them first.

---

## WS1 — Legacy recruit/mercenary name collision loses the real casualty (P2, present)

**Symptom.** Consider a suspend checkpoint saved before #98, the change that introduced `unitUid`.
It can hold a hired mercenary and a Talk recruit with the same name, neither with a `unitUid`.
If the mercenary dies and the recruit survives:

- the surviving recruit is recorded as **both living and fallen**;
- the dead mercenary (its level, stats and items) disappears.

Reproduced on `b8e13bf` with `legacy-recruit-collision-probe.mjs`: run seed 2, mercenary RNG 10,
two Archers named Linnet, record `entityId` u9.

**Root cause.**

1. `RunManager.fromJSON` → `ensureUnitUids` (`RunManager.js:2433-2451`) stamps only the roster and
   fallen units.
2. Checkpoint units and `_battleRecruits` records are restored without UIDs by both restore paths:
   - `BattleSuspendController.applyUnits` (`src/ui/BattleSuspendController.js:136-207`);
   - `VisionRewindController._applySnapshot` (`src/ui/VisionRewindController.js:186-251`), which
     timeline rewinds also use.
3. The link that survives both restores is the record's `entityId` matching the battle unit's
   `battleEntityId` (both `u9`). It is never used, and it is thrown away:
   - at `BattleRecruits.js:107`, where the record is reduced to `entry.unit` (`serializeUnit`
     deletes `battleEntityId`);
   - at `PostCombatController.js:156`, where survivors are serialized.
4. `matchUnitsToSurvivors` (`UnitIdentity.js:84-92`) then falls back to names, roster first. The
   roster mercenary (`ru3`) claims the surviving recruit, and the recruit's record is left
   unmatched, so it is treated as "fallen".
5. `completeBattle` (`RunManager.js:3430-3460`) repeats the same pairing.

**Fix.**

1. Add a pure helper in `src/engine/BattleRecruits.js`:
   `reconcileRecruitIdentities(records, battleUnits, allocate)`, where `allocate` is
   `runManager.assignUnitUid`. For each record:
   - Find the battle unit (from any `BATTLE_UNIT_GROUPS` array) with
     `battleEntityId === entry.entityId` **and** the same `name`.
   - Unit found and the unit has a UID → copy it onto the record:
     `entry.unit.unitUid = allocate(unit)`.
   - Unit found without a UID → `unit.unitUid = allocate(entry.unit)`. This reuses the record's
     UID if it has one, otherwise allocates a fresh one.
   - No unit found (the recruit already fell) → `allocate(entry.unit)`.
   - `allocate` missing (tutorial, stubs) → do nothing.
   - The helper is idempotent and consumes no gameplay RNG.
   - Do **not** stamp roster-origin battle units by name. Without a record, the name is exactly the
     ambiguous link. Once the recruit has a UID, `UnitIdentity.js:89-90` keeps the roster unit from
     claiming it.
2. Call it at the end of `restoreBattleWorldState` (`src/engine/BattleSnapshotState.js`, after the
   `_battleRecruits` copy at about line 56). That function is shared by resume, Vision rewind and
   timeline rewind.
3. Optionally, as a safety net, call it again in `PostCombatController` before survivors are
   serialized (about line 156).

**Invariants.**

- Every record has a UID whenever a run manager exists.
- A record whose `entityId` names a living same-name battle unit shares that unit's UID.
- A recruit UID never equals a roster or fallen UID. The counter is past them after `fromJSON`.
- The replay/rewind fingerprint is unchanged: `rewindFingerprint` ignores `unitUid`.

**Tests** (in `tests/RecruitIdentity.test.js` unless noted).

1. **Reviewer scenario through the real boundary.** Legacy save → `fromJSON` → checkpoint JSON →
   `restoreBattleWorldState` / `applyUnits` → serialize survivors → `fallenBattleRecruits` →
   `completeBattle`.
   - Expect the fallen pool to be exactly the level-4 mercenary: its own stats, items to the
     convoy, its roster UID.
   - Expect the level-2 recruit alive, with a different UID.
   - Expect no UID to be both living and fallen.
   - The probe itself calls `fallenBattleRecruits` directly and skips the restore step, so it keeps
     reproducing even after the fix. The test must go through the restore step.
2. **Table-driven cases:** merc dies / recruit dies / both die / both live / no collision. For
   every case assert:
   - living UIDs and fallen UIDs are disjoint;
   - all UIDs are distinct;
   - living ∪ fallen (name, level) equals the set of units that entered.
3. **Helper unit tests:**
   - Unit found without a UID: it and the record get the same fresh UID.
   - Unit absent: only the record is stamped.
   - Record has a UID but the unit does not (rewind case): the unit gets the record's UID.
   - Idempotent: a second call changes nothing and does not move the counter.
   - Same `entityId` but a different name: not linked.
   - No allocator: no-op.
   - A record already holding `ru7` with the counter at 5: the counter moves to 8.
   - `Math.random` is never called.
4. **`tests/BattleSuspendController.test.js`:** an old checkpoint with a real `RunManager` ends with
   the recruit and its record sharing a UID and roster units unstamped. Capture and resume again:
   the UID is stable and the counter does not move again.
5. **Rewind:** restoring an old Vision snapshot re-links the pair. A snapshot from before the Talk
   stamps nothing.
6. **`tests/FallenRecruitRevival.test.js`:** in the both-die case, revival by UID brings back the
   chosen Linnet.

**Out of scope.** Checkpoints from before #83 have no `battleRecruits` list. They cannot be repaired
and keep the name fallback. The window is one day.

---

## WS2 — Native save mirror: a second deletion keeps the first tombstone's stamp (P3, present)

**Symptom** (reproduced by `native-redelete-probe.mjs` on `b8e13bf`).

1. The native record is a tombstone with `deletedSavedAt: 100`.
2. A new run (`savedAt: 200`) is written and then removed before the next flush.
3. The flush sees `previous.value === value` (both `null`) and skips the write, so the tombstone
   stays at 100.
4. If WebKit later keeps run 200 but loses its removal, restore treats 200 as newer than the
   tombstone. The deleted run is resurrected and re-mirrored.

**Root cause.** `NativeSaveMirror.flush` (`src/utils/nativeSaveMirror.js:512`) decides whether
anything changed by comparing values only. Record entries (`records.set` at :380 in `restore` and
:532 in `flush`) do not remember the `deletedSavedAt` last written, so an advanced deletion stamp
never counts as a change.

**Fix.**

- Store `deletedSavedAt` on each record entry:
  - in `restore`, from `record.deletedSavedAt`;
  - in `flush`, the value actually encoded.
- In `flush`, compute `deletedSavedAt` **before** the unchanged check. Skip only when:
  `previous.value === value && (value !== null || (previous.deletedSavedAt ?? null) === deletedSavedAt)`.
- The `UNWRITTEN` retry path is unaffected.

**Tests** (`tests/NativeSaveMirror.test.js`).

- Port the probe sequence: tombstone at 100 → write 200 → remove → flush. The on-disk tombstone must
  be `deletedSavedAt: 200` with an advanced `seq`.
- Relaunch with the local store still holding run 200. The run is removed.
- Negative case: tombstone at 100, no new stamp seen, flush again → no write. Assert the backend
  write count.

---

## WS3 — "The Last" is awarded after a casualty-free victory (P3, present — design change)

**Symptom.** Edric, Sera and Voss (lords) and Leona (recruit) all survived at full HP, and Leona
still received **The Last**: "Came back alone, carrying the names of the rest." Reproduced by
`last-deed-probe.mjs`.

**Cause.** The rule itself is the problem:

- `docs/specs/deeds-epithets.md:84`: "the only non-lord alive … with ≥4 deployed".
- `DeedSystem.js:586-587` sets `battle.lastStanding = deployed` for the sole living non-lord.
- `data/deeds.json:241-247` requires `lastStanding` ≥ 4.
- Nothing requires anyone to have died. The implementation matches the spec, and the spec
  contradicts the lore.

**New rule (recommended).** The sole surviving non-lord of a battle with ≥ 4 deployed, in which
**at least 2 allies fell**. Any player unit counts as an ally here, lords included, as do Talk
recruits who joined and then fell.

**Fix.**

- `DeedController.commitVictory` (`src/ui/DeedController.js:142-147`) passes
  `fallenCount: s._playerDeathsThisBattle`.
  - That counter already exists (`BattleScene.js:9087`, incremented for player faction only).
  - It is persisted in checkpoints and snapshots (`BattleSnapshotState.js:18,49`;
    `BattleSuspendController.js:201`) and restored by rewind.
- In `commitBattleDeeds`, for the sole living non-lord only, set `battle.fallenAllies = fallenCount`
  alongside `lastStanding`.
  - Add `fallenAllies` to `BATTLE_NUMBER_KEYS` (`DeedSystem.js:~60`).
  - Check whether `mergeRunStats` folds battle keys into run stats. If so, keep `fallenAllies` out of
    run tallies, or make sure nothing reads the sum.
- Change `data/deeds.json` `last_of_them.condition` to:
  `{ "type": "all", "of": [ { "type": "battleStat", "stat": "lastStanding", "min": 4 }, { "type": "battleStat", "stat": "fallenAllies", "min": 2 } ] }`.
  `all` is already supported (`DeedSystem.js:485`).
- Update `docs/specs/deeds-epithets.md:84`.

**Tests** (`tests/DeedSystem.test.js:271-282`).

- Keep the existing positive case, now passing `fallenCount: 2`.
- Negative: 3 lords + 1 recruit alive, `deployedCount: 4`, `fallenCount: 0`. This is the playtest
  case, and it must fail on current code.
- Negative: `fallenCount: 1`.
- Positive: deployed 6, 1 lord + 1 recruit alive, `fallenCount: 4`.
- Idempotence per `battleKey` still holds.
- `validate:data` passes on the new condition shape.

**Decision for the owner.** The 2-death threshold is a proposal. An alternative is "all other
deployed non-lords fell, and at least 2 of them", which is stricter.

---

## WS4 — "Lean level" lines claim nothing was gained (P3, present — broader than reported)

**Finding.**

- `levelUp()` guarantees at least +1 to some stat (`UnitManager.js:926-927`; the fallback is the
  highest growth).
- `levelUpKind` (`src/ui/growthContent.js:224-229`) classifies total ≤ 1 as `blank`.
- So **every `blank` level has exactly +1**. Zero gains cannot happen.
- Yet most of the 174 `levelUp.blank` lines in `data/dialogue.json` `unitVoice` say otherwise:
  "Nothing.", "No change.", "Unchanged.", "Nothing gained.", "learned nothing", "Not a thing".
  This covers all 7 lords, 8 temperaments and 41 classes, plus 8 narrator `beats.blank` lines.
- The review's suggestion to separate zero from one gain is moot; there is no zero case.

**Fix (content).**

- Rewrite every `levelUp.blank` line that asserts zero growth so it is true for a single +1: "only a
  little", "one small step", "barely".
- Keep the voice rules (`docs/lore-style-guide.md`) and the ≤ 90 character limit.
- Lines that are already true stay: "A slow step is still a step forward", "Steady means steady",
  most `beats.blank` lines. Check "The loom paused, and waited."
- Optional: let a line name the one stat through a new `{stat}` token. That needs `UnitVoice.js`
  token support and a test. Do not do it in this PR unless it is cheap.
- Fix `growthContent.js:220-221`'s comment ("one stat or none") and the header comment above
  `levelUp` (`UnitManager.js:909`) for accuracy.

**Tests.**

- Content guard in `tests/UnitVoiceContent.test.js`: no `levelUp.blank` or `beats.blank` line
  matches
  `/\b(nothing|no change|unchanged|no gain|no improvement|no progress|not a thing|learned nothing|blank\.)/i`.
  It must fail on the current data. Tune the regex so a legitimate "nothing lost" is allowed, or
  allow-list it explicitly.
- Engine test pinning the premise: `levelUp` with all growths at 0 returns exactly one +1.
- Existing `UnitVoice` and `UnitVoiceContent` tests stay green: pool sizes and token rules.

---

## WS5 — Desktop battle HUD (P2/P3, all present)

### 5a. The [R] rewind shortcut never shows on desktop (P2)

**Cause.**

- The canvas is always 640 px wide in camera space, whatever the window size, so the failure is
  independent of resolution.
- `DesktopBattleHud.layout()` (`src/ui/DesktopBattleHud.js:242-261`):
  - D, O and E occupy up to x = 259.
  - `right` is `cancel.x − 12` = 550 even when [X] Cancel is **hidden**, because line 258 does not
    check `cancel.visible`.
  - The idle hint `DESKTOP_HINT_TEXT` (line 30) measures 355 px against 291 available.
  - Line 260 then hides the **whole** hint. The Danger button is always visible on desktop, so this
    happens in every idle state.
- R itself works (`BattleScene.js:1165`, handler 1106).
- The top-left "Eye: N left this run" (`VisionRewindController.js:1114`) is already a click target
  (`_bindHudPress`, 1119-1130), but nothing says so.

**Fix.**

1. The Vision HUD plate reads `[R] Rewind · N left` (desktop) instead of `Eye: N left this run`.
   - Update mobile's rewrite regex (`MobileBattleHUD.js:915`, which currently turns "Eye:" into
     "Rewinds:") so mobile still shows its own label with no key badge.
2. Footer hint degrades by segment instead of all-or-nothing.
   - Add a pure `fitHintSegments(segments, maxWidth, measure)` that keeps the longest prefix that
     fits, in priority order: `[R] Rewind`, `[N] next ready`, `[V]/right-click details`,
     `Esc cancel`.
   - Compute `right` from `cancel.visible ? cancel.x : W − MARGIN`.
3. One player-facing word. Recommendation: **Rewind** for the action, **charges** for the resource.
   This matches the picker (`VisionRewindPicker.js:47,99`), the confirm dialog
   (`VisionRewindController.js:466`) and the mobile button (`MobileBattleHUD.js:1078`). Align:
   - the footer (`DesktopBattleHud.js:31`);
   - help (`src/data/helpContent.js:541`);
   - the tutorial (`TutorialController.js:372`);
   - the meta upgrade copy (`data/metaUpgrades.json:1100`, "+1 Vision charge").
   The internal names (`VisionRewindController` and similar) stay as they are.
   **Owner decision:** keep "Vision" as the lore name instead, if preferred. Either way, use one word.

**Tests.**

- `tests/DesktopBattleHud.test.js` currently uses unrealistic mock text widths. Give the mock
  realistic widths (about 4.5 px per character at the footer font, or the measured 355 px). Then in
  PLAYER_IDLE with Danger visible and Cancel hidden, assert the hint is visible and contains `[R]`.
  This fails today.
- Add a unit test for `fitHintSegments`.
- Update `tests/VisionRewindController.test.js:1176`, `tests/DesktopBattleHud.test.js:68` and
  `tests/e2e/battlefield-presentation.spec.js:264` for the new label.
- In that e2e spec at 1308×735, assert that `[R]` is visible somewhere: in the plate or the footer.

### 5b. Hover info keeps pre-combat HP (P2)

**Cause.**

- `infoText` is written only by `InputController.refreshTileInfo()` (`src/ui/InputController.js:71-104`).
- It is called only from:
  - pointer move (37-66);
  - the gamepad cursor (`BattleScene.js:780-786`);
  - a mobile tap (`InputController.js:336`);
  - the tutorial.
- Nothing refreshes it when HP changes. `updateHPBar` (`BattleScene.js:3248`) and `removeUnit`
  (9042) do not touch it, and Phaser emits no pointermove while the mouse is still.
- This was confirmed live: a hovered Cavalier kept "HP 3/22" after `updateHPBar` and `removeUnit`.
- The same happens in the enemy phase (`executeEnemyCombat`, 10464), with heals, poison and terrain
  damage, and when an enemy walks onto or off the hovered tile.

**Fix.**

- InputController records `_hoverTile = {col,row}` whenever pointer move or the grid cursor refreshes
  the panel, and clears it when the pointer leaves the grid.
- Add `refreshHoverInfo()`: re-run `refreshTileInfo` for `_hoverTile`, or clear the panel. Make it a
  no-op in BATTLE_END.
- Call it at the end of `updateHPBar`, after the splice in `removeUnit`, and at the end of unit
  movement animation.
- Do not reuse `_mobileTerrainFocus` as the hover tile; it is not cleared when the pointer leaves the
  grid.

**Tests** (`tests/InputController.test.js`, near the `refreshTileInfo` tests at about line 462).

- Hover a unit, change its `currentHP`, trigger the HP-bar path → the panel shows the new HP.
- Remove the unit → no unit line.
- Pointer off the grid, then a refresh → the panel stays empty.

### 5c. The desktop Item menu lacks the effect and action cost (P2)

**Cause.** `BattleScene.showItemMenu` (6708-6810) labels rows `name (uses)` plus a disabled reason.
Mobile has shown `battleItemBrief` since #114 (`src/ui/battleItemSummary.js:18-28`, e.g. "Restore
10 HP"). Neither side says that using an item ends the unit's action.

**Fix.**

- Desktop rows get a second, muted, non-interactive line: `reason || battleItemBrief(item, unit)`.
  - Raise `itemHeight` from 28 to about 34.
  - Do not fold the brief into the button label or `_menuDescription`. Mobile reads both, and would
    duplicate the brief or lose its own.
  - Text objects without `_action` are ignored by mobile (`MobileBattleHUD.js:278`).
- Export `ITEM_ACTION_NOTE = "Using an item ends this unit's action · uses don't refill"` from
  `battleItemSummary.js`. Show it above Back on desktop and in the mobile item submenu.
- Optional: a hover tooltip with `battleItemSummary`, mirroring the weapon tooltip
  (`_showWeaponDetailTooltip`, 5843).

**Tests.**

- A desktop `showItemMenu` test with a Vulnerary: a text contains "Restore 10 HP", and the note is
  present.
- Extend `tests/e2e/battle-submenus.spec.js` with a desktop case.

### 5d. Confirm Attack looks disabled (P3)

**Cause.** `ForecastOverlay.js:706-728`:

- Idle: `hpHigh` fill with `good` text. WCAG contrast is **1.33:1**.
- Hover: 4.11:1. The more readable state is the hover state, which is backwards.

**Fix.** Use the house primary style (the same as mobile `.mb-primary` and `reliquary.css:36-48`):

- Idle: `UI_HEX.accent` fill, `UI_PALETTE.bg` text (8.47:1), `UI_HEX.accentText` stroke.
- Hover: `accentText` fill with `bg` text (12.55:1).
- Replace the raw `0x4dff77` and `0x2c7b3a` with palette keys.
- Keep the creation order: e2e specs click the last interactive rectangle
  (`weapon-selection.spec.js:142`, `battle-invariants.spec.js:51`).

**Test.** In `tests/ForecastOverlay.test.js`, make the rectangle mock record its fill. Assert that the
contrast between the confirm text and the fill is at least 4.5:1. This fails today.

---

## WS6 — Heal target preview on desktop and mobile (P3, present)

**Cause.**

- `startHealTargetSelection` (`src/ui/HealController.js:142-190`) only highlights tiles.
- A click goes `InputController.js:354` → `handleHealTargetClick` (271-277) → `executeHeal`
  immediately.
- Mobile shows only "Tap a highlighted target. Cancel to go back." (`MobileBattleHUD.js:1022-1025`),
  but the button says **Back**.
- The target list (`appendTargetList`, 1148-1178) is built only for attacks.
- The heal is deterministic: `resolveHeal(staff, healer, target, getHealOptions())`
  (`Combat.js:447`; options from `HealController.js:88-93`) is exactly what `executeHeal` applies
  (412-416).

**Fix.**

- Add a pure `healTargetPreview(staff, healer, target, opts)` returning `{ from, to, max, amount }`.
- Desktop: while selecting a heal target, hovering a unit in `scene.healTargets` appends
  `Heal +N → to/max` to the tile info.
- Mobile: `appendHealTargetList()` mirrors `appendTargetList`. Each row shows
  `Name  HP a/b → c/b (+N)`; tapping it calls `executeHeal`, guarded on the state and on
  `healTargets` membership.
  - Cure staves show the conditions removed instead of an HP delta.
  - Add `healTargets` and their HP to the HUD snapshot key (about line 751), the same way
    `targetListKey` is included.
  - Copy:
    - Add a `SELECTING_HEAL_TARGET` entry to `HINTS` (`MobileBattleHUD.js:60-70`): "Choose an ally
      to heal — tap a row or the map. Back to choose another action."
    - Change the generic fallback at line 1024 to say **Back**, matching the button
      (`BattlefieldLab.js:59`).

**Tests.**

- Helper: the blessing multiplier and the cap at max HP.
- Desktop hover shows the "+N →" line.
- Mobile e2e at 844×390, staff user with a wounded ally:
  - a row contains "12/20 → 18";
  - tapping it gives HP 18 and uses one staff charge;
  - no text matches `/Cancel to go back/` while the Back button is shown.

---

## WS7 — Phone forecast, route roster, forecast modifiers, service re-entry (all present)

### 7a. The player's own Hit/Crit falls below the fold on the phone forecast (P2)

**Cause.** `forecastSide` (`MobileBattleHUD.js:447-557`) renders in this order:

1. eyebrow and portrait;
2. name;
3. target stepper (enemy side, 2+ targets) or weapon stepper (ally side, 2+ weapons; 44 px tall);
4. HP → projected HP, and the health bar;
5. `dl.mb-stats`: 5 tiles in 2 columns, 3 rows;
6. notes, which repeat the projection as "If all hits land".

Measured at 844×390 (attack-flow fixture, 2 weapons):

- The readable area of the sides runs from y = 79 to about 295, because of the 16 px fade at
  `battleRail.css:303-307`.
- The ally Hit/Crit row sits at 287-332, so it is cut off. The enemy's row sits at 257-302.
- With 2+ targets the enemy side loses its row too.

**Fix.**

- In `forecastSide`, move `mb-stats` directly under the HP line and health bar, **above** the
  steppers. Everything above the stats is then the same height on both sides, so the two sides' rows
  align.
- Make the stats one row of 4 tiles: `Damage ×hits | Hit | Crit | AS`. Each side's content is about
  286 px wide, so each tile gets about 67 px.
- Drop the duplicate "If all hits land" note when the HP arrow is shown.
- Under `@media (max-height: 480px)`: portrait 32 px and the eyebrow inline with the name.
  Optionally remove the Read above/below buttons, since scrolling and the fade already work.
- Two places depend on the tile labels and need updating:
  - `tutorialForecastLayout.js:17-26` selects tiles by label text. Switch it to `data-stat` keys.
  - `tests/e2e/attack-flow.spec.js` reads the 'Damage per hit' label.

**Test** (phone section of `tests/e2e/attack-flow.spec.js`). Open a forecast with 2 weapons and 2
targets. At `scrollTop 0`, on both `.mb-ally` and `.mb-enemy`, check that the damage, hits, Hit and
Crit values lie inside `[sides.top, sides.bottom − 16]`. This fails today (ally bottom 332 > 295).

### 7b. Weapon-art forecasts omit the projected HP/KO line (P3)

**Cause.**

- `Combat.js:1037-1040` sets `simpleExchange` to false whenever `hasWeaponArtActivation(m)` is true.
- `forecastProjection` (`forecastDisplay.js:22`) then returns null, which removes the HP arrow, the
  projected bar and the note on both the phone and the canvas forecast.
- The exclusion looks unnecessary. Art forecasts are computed in the post-HP-cost state
  (`BattleScene._withForecastArtState`, about 7545).
- A scratch parity run forced an art in every matchup, with drain arts excluded. Over 1,707
  exchanges where the art was the only blocker, the projection matched the resolved HP with 0
  mismatches.

**Fix.**

- Remove `|| hasWeaponArtActivation(m)` from the predicate. Drain arts stay excluded by the existing
  `drainPercent` check.
- **Precondition:** first extend `tests/ForecastResolutionParity.test.js` with a pass that forces an
  art (100% instead of 25%, drain excluded), and show it is green with the change.

**Test.** In `tests/ForecastProjection.test.js`, a deterministic 2-strike art whose damage × 2 is at
least the target's HP projects `defenderHP 0`.

### 7c. A route lord chip opens the first roster unit (P3)

**Cause.**

- `NodeMapMenu.js:225`: every chip calls `s._openRoster()` with no unit.
- `NodeMapScene.js:1443` `_openRoster()` takes no argument.
- `RosterOverlay.js:131` hard-codes `index: 0`. `show()` at 179-189 passes it to
  `MobileRosterSheet`, which already accepts `index`.
- The DOM route and roster are used on desktop browsers too, so one fix covers both.

**Fix.**

- Chip: `() => s._openRoster(unit)`.
- `_openRoster(unit = null)` passes `{ onClose, initialUnit: unit }`.
- `RosterOverlay` sets `selection.index` to the index of `initialUnit`, matched by identity first
  and then by `unitUid` (see `UnitIdentity.js`, not name), falling back to 0.
- The Roster button and the ROSTER key/pad action keep calling with no argument.

**Tests.**

- Unit: `new RosterOverlay(…, { initialUnit: roster[1] }).selection.index === 1`.
- `tests/e2e/loom-route.spec.js`: tapping the second `.re-node-unit` opens the roster with Sera
  selected (`aria-pressed="true"`).

### 7d. Forecast traits and skills are bare names (P3)

**Cause.** `MobileBattleHUD.js:537-541` and `ForecastOverlay.js:566-584` render
`info.skills.map(s => s.name)` as plain text. Entries are `{ id, name }`, with ids:

- `trait_<id>` (`TraitSystem.js:402`);
- `mastery` (`MasterySystem.js:192`);
- affix ids (`AffixSystem.js:46`);
- skill ids (`SkillSystem.js:328`).

No PR since #113 added details to the forecast. The #114 long-press swallow listens on `this.root`,
not on the forecast's `this.wrapper`, so reusing it here would misfire.

**Fix.**

- Add a pure `forecastModifierText(entry, unit, gameData)` in `forecastDisplay.js`:
  - `trait_` → `traitEffectText` (`traitContent.js:87`);
  - `mastery` → the perk text;
  - affixes → `affixes.json`;
  - skills → `skills.json`.
- Phone: render each entry as `<details class="mb-modifier"><summary>Shieldmate</summary><p>…</p></details>`,
  the same pattern as the forecast's existing "How to read this forecast". It works with a tap and
  needs no new gesture.
- Desktop: add the short effect text inline, or as a hover tooltip.

**Tests.**

- Unit: every trait with `combatMods`, every combat skill, every affix and a mastery entry resolves
  to non-empty text.
- e2e: a forecast with Shieldmate active expands to show "+10 Avo".

### 7e. No way back into a Church or Ruins after leaving (P3 — owner confirms the contract)

**Cause.**

- Only `canReenterShop` nodes can be re-entered (`NodeMapMenu.js:114-119, 279-297`;
  `RunManager.js:3119-3129` requires `type === 'shop'`).
- Leaving a church completes the node (`ChurchController.js:40-53`). Selection stays there, so Travel
  shows as disabled.
- Revive trap: the revive message says "Use Heal all, then Roster to re-equip"
  (`ChurchCommands.js:62`). A player who leaves first strands the revived unit at 1 HP.

**Everything limited is already recorded per node and saved:**

- Heal all is free and unlimited, and HP cannot change on the node.
- Promotions are counted by `_churchPromotionTracker` (`RunManager.js:2164-2173`).
- Kindle is once per node (`kindledNodeIds`).
- Revive is limited by gold and the roster cap.
- Ruins stock, forges and rerolls are saved (`ShopController._saveShopState`, 273-286).

**Recommended contract.** While you stand on a completed service node, you can step back in, and
nothing refreshes.

**Fix.**

- Generalise `canReenterShop` to `canReenterService(nodeId)`: the current node, completed,
  `!battleInProgress`, and a shop with saved state, a church or ruins.
- Button labels: "Re-enter church" and "Return to ruins".
- Optionally, when the selected node can neither be travelled to nor re-entered, move selection to
  the first available node.

**Tests.**

- `RunManager` unit: true for the current completed church or ruins; false after travelling on or
  while `battleInProgress`.
- e2e: Church → Leave → "Re-enter church" is enabled → the menu reopens; Kindle still reads
  "Already kindled"; the promotion count is unchanged.

---

## WS8 — Copy, content and small UI (P3, all present)

### 8a. Scout flavour text makes concrete claims that aren't derived from the encounter

**Cause.** `nodeFlavor.*` lines in `data/dialogue.json` are picked by hashing the node id
(`loomModel.js:299-308, 431-433`). They are shown as a scout quote (`LoomPanels.js:254`) and a
banner (`NodeMapScene._showNodeFlavor`, 1990-2010). None of their specifics come from the battle.

**Lines to rewrite** (drop counts, weapons, classes and specific places):

- battle.act1[5]: "six at the ford … Quarry picks"
- battle.act1[3]: "picks to war"
- battle.act2[5]: "Soldiers, forty"
- elite.act2[3]: "One captain, veteran"
- elite.act3[4]: "walked through the bog"
- elite.act4[4]: "household knights … parade plate"
- boss.act1[5]: "bridge post … CROSSING CLOSED"
- boss.act2[4]: "wagons circled three deep"
- recruit.act1[3]: "quarryman … hammer"
- recruit.act3[1]: "A fighter" (the recruit card shows the real class)
- recruit.act3[4]: "one survivor. Well armed"
- recruit.act3[5]: "one passenger and far too many weapons"

**Alternative.** Tag lines with `requires: { biome, weaponType }` and filter by the real encounter.
That is heavier; rewrite first.

**Test.** A data lint over `nodeFlavor.*` that fails on number words or digits followed by a noun, and
on weapon or class nouns, with an explicit allowlist for figurative lines.

### 8b. Unexplained terms: "Hunters +1", "Captain", "Prof"

- **The tags** come from `loomModel.js:416-423` via `getRecruitNodeBattleMods`
  (`RunManager.js:2899-2906`). On Normal they mean +1 enemy, and 1 enemy guaranteed an affix
  (`difficulty.json:36-37`). They render as bare list items (`LoomPanels.js:239-243`).
  - Give each tag a `detail`: "One extra enemy hunts the recruit" and "One hunter carries an affix —
    inspect it in battle".
  - Render the detail as a note or through `attachInfo`.
  - Test: `describeLoomNode` returns tags with their details.
- **"Prof" on reward tooltips** (`LootScreenController.js:1542`, also used by
  `PendingRewardController.js:23`). Show "Needs Sword rank", or "Master rank" when the weapon needs
  it. Reuse the phrasing at `choiceContent.js:300`.

### 8c. Shop header "Requires Prof" on skill scrolls

**Cause.**

- `ShopMenu.js:262` prints `Requires ${item.rankRequired}` for any item with the field.
- All 49 scrolls in `weapons.json` have `rankRequired: "Prof"`, apparently left over from the
  spreadsheet import.
- Skill scrolls have no proficiency check at all (`RosterTransfers.js:11-19`).
- Art scrolls check the rank for the art's weapon type (`RosterArtCommands.js:14-17`). Their
  mechanics text already says so ("Requires Sword · Proficient", `weaponArtDisplay.js:172`).

**Fix.** Add a pure `shopRequirementLabel(item)`:

- '' for `type === 'Scroll'`;
- "Requires Lance rank" / "Master" wording for weapons.
- Optionally remove `rankRequired` from the scroll entries in the data. Check `validate:data` and any
  reader first.

**Test.** A unit test of `shopRequirementLabel`: '' for Sol Scroll and for Hexblade Scroll; the rank
wording for a Mast lance.

### 8d. Scroll binding on phone: two Confirms and a keyboard hint

**Cause.**

- `MobileRosterSheet.bindArt` (583-720): the weapon step's Confirm only selects
  (`showWeapons`, 696-719); `showConfirm` (634-660) then binds on a second Confirm.
- `ChoicePicker.js:95` always labels its button "Confirm".
- `ChoicePicker.js:109` always shows "Page Up/Down or controller L/R" when a preview is present, on
  touch devices too. This affects every picker with a preview.

**Fix.**

- When the weapon has fewer than 3 arts, bind straight from the weapon step. That step carries the
  art preview and the "Uses one X on Confirm" note.
- Keep a separate step only for replacements, labelled "Replace".
- Add a `confirmLabel` option to `ChoicePicker`.
- Route the Page Up hint through `inputHint(scene, desktopText, null)` (`src/utils/inputHint.js`).

**Test.** `tests/e2e/management-contracts.spec.js:113-168` pins today's steps; update it. New
assertions:

- one Confirm binds: scroll count −1, and the art is on the weapon;
- no "Page Up" text is shown in a touch runtime.

### 8e. Tutorial copy and the casualty dialog

- **The fallen dialog** (`TutorialController.js:366-372`, and the first-hit hint at 344) says "gone
  for good -- only a Church can revive them … one Vision". It contradicts itself.
  - Replace it with: "In a real run, a fallen unit stays down until a Church revives them for gold.
    Here, fate grants one Rewind to your last turn." Use the WS5a word.
  - The dialog is a full-height `MenuSurface` (`VisionRewindController.js:813-828`). Size it to its
    content, like #117's `ContextHelp`.
- **The coach** (`tutorialCoachModel.js:141, 149`) says "move next to a red enemy" for every unit.
  - Add `maxRange` per unit to the coach snapshot (`TutorialCoach.js:97-124`).
  - Ranged units get "move into weapon range of a red enemy (1–2 tiles)".
  - Test: a ranged ready unit's advice does not contain "next to".

### 8f. Forge screens preview only the Weight forge

**Cause.** `ShopMenu.js:464-489` appends `equipmentComparison` only when
`stat.key === 'weight'`. The reward whetstone step (`MobileRewards.js:529-560`) shows only current
stats.

**Fix.** Add `forgeImpactLine(owner, weapon, key)`:

- It clones the weapon, applies the real `ForgeSystem.applyForge` to the clone, and diffs
  `getStaticCombatStats`.
- Might → "Attack a → b"; Hit → "Hit a → b"; Crit → "Crit a → b"; Weight → Attack and AS, as today.
- Use it in both the shop forge and the reward forge steps.

**Test.** A unit test with expected values worked out by hand, e.g. STR 7 + Steel Sword Mt 8 →
"Attack 15 → 16", plus a Weight case where AS changes.

---

## Decisions for the owner before implementation

1. **WS3:** the threshold for The Last. The recommendation is at least 2 allies fallen.
2. **WS5a / 8e:** one player-facing word for the rewind resource. The recommendation is "Rewind",
   with "charges".
3. **WS7e:** make Church and Ruins re-enterable while standing on them. The recommendation is yes,
   with nothing refreshing.

## Suggested order

1. WS1 (identity), then WS2 (native save). Correctness first.
2. WS5a and WS5b (desktop rewind hint, stale hover): high visibility, small changes.
3. WS7a and WS7c (phone forecast fold, route chip).
4. WS3 and WS4 (deed rule, lean-level lines: data and content).
5. WS5c, WS5d, WS6 and WS7b.
6. WS7d, WS7e and WS8.

---

## Not in this plan (tracked separately)

- **Shared desktop/mobile battle panel.** A responsive DOM dock reusing MobileBattleHUD's view data,
  with keyboard badges and focus. This is a design exploration, not a fix; WS5c and WS6 reduce the
  drift in the meantime. Do not turn on the touch camera or touch input globally.
- **PR #99 portrait mode.** It has its own test track.
- **Planted-bug mutation coverage.** See `docs/specs/compression-plan-2026-09-25.md`.
- **Balance notes.** Leona's lone Steel Lance, AS 0. A single roll; a sim question, not a fix.
- **Other readability notes.** Swamp and bog tile contrast, enemy silhouette readability, and the
  transient legacy-tile flash on resume. These are art or subjective; no defect is confirmed.
