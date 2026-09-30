# Playtest fixes — 2026-09-30

Six notes from Dave's and AP's playtests: three about Canto, one about the village shop,
one about lava, and one about an apparently ordinary Iron Lance dealing poison damage.
Items 1–5 are implemented on this branch. Items 6–7 and the review follow-ups below are
specified for the next implementation pass; this document update changes no gameplay code.

Verdicts: **BUG** · **GAP** (design gap) · **OK** (works as designed, but reads badly)

| # | Note | Verdict | Finding | Fix |
|---|---|---|---|---|
| 1 | "Canto movement is unrestricted by terrain movement" | **OK (feedback)** + latent inconsistency | `startCantoMove` runs the same terrain-aware Dijkstra (`Grid.getMovementRange`) as a normal move, with the unit's `moveType` and Pathfinder modifier. Its budget is `MOV − _movementSpent`, and `_movementSpent` is the path's terrain cost (`computeEffectivePath`). Known enemies block the range, and the game has no ZOC. Three things make it look unrestricted. Fliers pay 1 on every terrain. A unit that acted without moving gets its whole MOV. And Canto drew no path preview, so costs were never shown. The one inconsistency: Canto read `stats.MOV` while `selectUnit` reads `unit.mov`. | Canto's budget now reads `unit.mov ?? stats.MOV`, the same value the move range uses. Hovering a Canto tile draws the walk preview (#3), so terrain cost is visible. A real-Grid test pins that Canto respects terrain. |
| 2 | Canto needs a final Wait to confirm | **GAP** | Tapping a Canto tile moved the unit and ended its turn at once (`completeBattleAction`). A mis-tap cost a rewind. | New state `CANTO_CONFIRM` (see below). |
| 3 | Threat arrows don't show during Canto | **BUG** | `ThreatSightController.focus()` ran only in `UNIT_SELECTED`/`UNIT_ACTION_MENU` and returned null for units with `hasActed`. Canto sets both `CANTO_MOVING` and `hasActed`. The path preview was also gated to `UNIT_SELECTED`. | Threat Sight is active in `CANTO_MOVING` (hovered Canto tile, read from `cantoRange`) and in `CANTO_CONFIRM` (the unit's tile). In those two states `hasActed` does not block it. `updatePathPreview` draws the Canto walk. |
| 4 | "Maxing out forges at a village turned off buying" | **OK (feedback)** | No code ties the forge count to buying. `shopBuyBlock` checks only stock, price and gold. The 1000 G forge left 1161 G, which was below every price in stock: Act 3 prices are ×1.3, the Elixir sits at 1950 and the Act 3 pool has no Vulnerary. The greyed Buy kept its ember fill at 45% opacity, so it still looked live. | Rows priced out of reach show the price in the warn colour (`is-short`). The disabled Buy loses the ember fill (`shop-buy--short`). The reason reads "Not enough gold: N G short.", and a stock that is entirely out of reach says "Nothing here is within X G. Sell, restock or leave." |
| 5 | Lava shouldn't affect fliers | **GAP** | Lava burned every unit (`processTerrainDamage`). Fliers were already immune to acid and ice. | `lavaBurnsUnit(unit)` in `TerrainHazards.js` (false for `moveType: 'Flying'`), used by `BattleScene.processTerrainDamage` and the `HeadlessBattle` mirror. The Lava Crack rule text adds "Flying units are immune". The AI has no lava avoidance, so nothing changes there. |
| 6 | First Light, third-map recruit battle: a Soldier with an Iron Lance dealt unexplained poison | **GAP (disclosure)** + approved balance change | Recruit fights guarantee an affixed hunter even in Act 1 on First Light. `venomous` adds 5 post-combat damage to a unit's attacks without changing its weapon. Its effect is absent from forecast warnings; mobile inspection puts its explanation at the bottom of Stats. Dave confirmed the reported encounter was a recruit battle. | Implemented: no enemy affixes in First Light Act 1 recruit fights; keep the extra hunter. Disclose every affix that changes the exchange in the fight preview, driven by affix data (one quiet line each), and move affixes to the top of inspection. See the implementation spec below. |
| 7 | (Review) Danger does nothing during Canto | **BUG** | Found in review of items 2–3. The phone dock shows Danger beside Wait in `CANTO_CONFIRM`, and the legacy controls show it in `CANTO_MOVING` (`battle_selected`), but `_onDangerClick` and `togglePersistentDanger` accept only idle, selection, the action menu and formation. A tap or hold, and the desktop Danger key, are ignored while Canto is being chosen or confirmed. That is exactly when a safe tile is being picked. | Implemented one shared predicate for the states where Danger works, adding both Canto states and excluding enemy phases. See §7 below. |

## Canto confirm (`CANTO_CONFIRM`)

After a Canto move the unit stands on its new tile, but nothing is settled yet: no fog lifts,
no village is visited, nothing is saved, no history beat is written and `turnManager.unitActed`
is not called. The scene holds `_cantoPending = { unit, origin, remaining, range, path }` and
opens a one-row menu with **Wait**. It is built from `menuRow` and registered with
`_registerActionMenu(rows, { state: CANTO_CONFIRM_STATE })`, so the desktop canvas, the phone
rail (Wait pinned to the dock), the keyboard and the gamepad all use the same row.

- **Wait** (the menu row, `W`, the phone's Menu, or a tap on the unit's own tile) calls
  `confirmCantoMove()`. It records the path and then runs `completeBattleAction`, which lifts
  the fog, handles the village, saves and ends the unit's turn.
- **Back** (ESC, the rail's Back, right-click) calls `undoCantoMove()`. The unit returns to the
  tile where the Canto began and `startCantoMove` re-opens the choice with the same remaining
  budget. Back again (`CANTO_MOVING`) still skips the Canto and ends the turn there, as before.
- **A tap on another Canto tile** during the confirm is Back followed by a move there. The new
  move also waits for Wait.
- **End Turn** during the confirm settles the move where the unit stands.
- **Fog ambush:** a Canto move that a hidden unit stopped has shown something, so it is locked
  in and completes at once, as before.
- A refresh during the confirm resumes from the last suspend checkpoint, before the tentative
  Canto move. That checkpoint is action-dependent: a saved combat continuation can restore the
  resolved action and reopen Canto, but the consumable flow currently saves only after the final
  action completion. In that case it can roll back the item use as well. Do not promise that
  every resume returns directly to Canto; add the real-checkpoint coverage described below.

`isUnitMenuState(state)` (`battleMenuModel.js`) is true for `UNIT_ACTION_MENU` and
`CANTO_CONFIRM`. The rail's menu rendering, the dock pin, keyboard and pad menu navigation all
read it. States that end an interaction (cancel, End Turn, camera gestures, the mobile context)
list `CANTO_CONFIRM` next to `CANTO_MOVING`.

## 6. Early recruit affixes and affix disclosure — implementation spec

### Confirmed cause and reproduction

The affected encounter was a recruit battle on the latest iOS build, on First Light
(`normal`). Pale names the Eclipse phase, not the selected difficulty.

The matching engine case is reproducible on branch head `b644573`: create a Normal run
with seed 12, set `completedBattles = 2`, choose its row-2 recruit node `act1_2_3`, and
generate its battle with a separately installed Mulberry32 layout stream seeded 12 and
`deployCount = 3`. This is a controlled engine fixture, not a promise that entering
run seed 12 in the app will produce that exact layout after the player's preceding actions.

The generator produces a level-2 Soldier with `affixes: ['venomous']`. Its equipped
weapon is `Iron Lance`, with `special: ''`; the run's Eclipse shadow is 0. With a
scripted landed, non-critical hit, the Soldier deals 9 strike damage to a fresh Edric,
then the shared post-combat pipeline deals 5 more: HP 20 → 11 → 6. Both forecast
warning arrays are empty. The forecast already hides its simple HP projection for
Venomous, but hiding a projection does not explain the extra damage.

The relevant path is `RunManager.getRecruitNodeBattleMods` → `getBattleParams` →
`MapGenerator.generateBattle` → `AffixEngine.ensureGuaranteedAffixes` →
`PostCombatEffects.onAttackAffixes`. Guaranteed assignment deliberately bypasses
`excludedActs: ['act1']`; setting `enemyPoisonChance` to zero does not disable it.
`MobileRosterSheet.stats` does render the affix description, so this is missing
forecast disclosure and poor discoverability, rather than an entirely absent inspector.

### Approved encounter policy

| Encounter | Affix policy after this change | Other recruitment rules |
|---|---|---|
| First Light, Act 1, actual recruit fight | No enemy affixes, whether rolled or guaranteed | Keep the extra hunter, recruit quality and rewards |
| First Light, Act 2 onward, recruit fight | Existing affix rules | Existing rules |
| Dusk, Nightfall or Black Sun, recruit fight | Existing affix rules | Existing rules |
| Ordinary/elite/Eclipsed battle without a recruit | Existing affix rules | Existing rules |

Resolve this from the actual difficulty ID, encounter act and recruit-fight flag.
An Eclipsed node that has lost its recruit and become a battle follows battle rules;
an encounter that still is a recruit fight must not regain affixes through Eclipse
chance/guarantee overrides. The exclusion applies before both affix assignment paths.

Keep the policy in the engine. Prefer a difficulty-data act exclusion for recruit
affixes (for example `recruitAffixExcludedActs: ['act1']` on Normal, empty otherwise),
resolved once into battle generation and passed to `AffixEngine` as an explicit veto.
`getRecruitNodeBattleMods` must report `affixCount: 0` for the excluded encounter, so
the Loom no longer advertises a Captain there. Do not set Normal's global
`recruitAffixCount` to zero, because that would also weaken later acts.
Update applicable schema/content checks and mirror data with `npm run sync-data`.

Use the encounter's `act`/node act, not an unrelated currently selected act. Restored
runs that lack the new policy field must obtain the canonical default. Apply the
policy to newly generated encounters, including future nodes in an existing run.
Preserve already locked layouts and suspended battles: do not strip a saved enemy's
affix mid-fight or reroll its map. The disclosure changes cover those saved enemies.

### Affix disclosure in the fight preview (all affixes)

The Venomous report is one case of a general gap. Only 3 of the 12 affixes reach the forecast
(Shielded, Thorns and Teleporter, through hand-written `[BLOCK]` / `[REFLECT]` / `[WARP]` labels on
desktop and raw ids on the phone). Venomous, Corrosive, Grievous and Deathburst change the outcome
of the exchange the player is about to commit to and say nothing. Deathburst is the worst case:
its 5 damage has no HP floor (`BattleScene` death effects call `damageUnit` without `floor`), so
killing it can kill the attacker or any ally standing next to it, and the forecast is silent.

Fix the class of bug, not the instance. Every affix declares in data how the forecast treats it,
and one pure function turns that into at most one short line per affix.

**Data.** Add `forecast` to each entry in `affixes.json`, validated by `validate:data` (an affix
without it fails the build, so a new affix cannot ship undisclosed):

| Mode | Affixes | Forecast shows |
|---|---|---|
| `numbers` | Berserker, Anchored, Rally | Nothing extra: they already change the Atk/Def numbers. Name the source where it is missing (a Rally aura is folded into Atk today with no name). |
| `exchange` | Shielded, Thorns, Teleporter, Venomous, Corrosive, Grievous, Deathburst | One line when its condition holds for this exchange (table below). |
| `field` | Regenerator, Waller, Haste | Nothing. They act on the map, not in this exchange; inspection covers them. |

`exchange` entries also carry `forecastText`, a short consequence phrased from the player's side,
with amounts read from `effects` (never a second hardcoded 5):

| Affix | Condition (this exchange) | Line |
|---|---|---|
| Shielded | you attack it; not yet hit this phase | Your first hit deals 0 |
| Thorns | your hits land at range 1 for 4+ damage | 25% of your damage reflects |
| Teleporter | your hit deals damage | Warps up to 3 tiles when hit |
| Venomous | it attacks or counters (can counter, in range, awake) | +5 after combat if it hits · never kills |
| Corrosive | it attacks or counters | −2 DEF once after combat if it hits; stacks across combats |
| Grievous | it attacks or counters | Wounded 2 turns if it hits |
| Deathburst | your best case (every hit lands, crits where possible) kills it and a living known unit is within its blast radius | Dies: 5 damage to every unit next to it · can kill |

**Engine.** `affixForecastNotes(attacker, defender, forecast, affixData, { visibleUnits })` in `AffixSystem.js` is a
pure function (implemented in `AffixForecast.js`, re-exported here to avoid a Combat import cycle) that returns `[{ affixId, name, text, description, tone }]` per side. Optional `visibleUnits` contains
only known living candidates for a death blast; the opponent is checked directly. It uses the forecast's own
`canCounter`, damage and distance, so counter rules (Sleep, range, counter prevention) come from
one place. It replaces the hand-built `atkWarnings` / `defWarnings`; `simpleExchange` hides the HP
projection for exchange-affix effects it cannot model (the affix data replaces the hard-coded list).
Thorns declares `forecastProjectionSafe: true`: the existing rounded, nonlethal reflection calculation
still supplies its conservative HP projection. Unknown affixes suppress projections. Forecast reads draw no gameplay RNG and mutate nothing.

**Presentation — quiet by default.**
- Each note is one line under the enemy's column: the affix name in the affix colour, then the
  consequence (`Venomous · +5 after combat if it hits`). Eclipse can raise the ordinary
  two-affix cap, so render every applicable note and size from wrapped text. No boxes, badges
  or all-caps tags.
- Canvas and phone render the same notes (`ForecastOverlay` and `MobileBattleHUD.forecastSide`
  both read `info.affixNotes`). Wrap long lines and measure their height, rather than
  assuming 14px rows.
- The first time a player meets a given affix in a forecast, its full rule is visible
  inside the forecast before confirmation, alongside the short consequence. On the phone
  it is an open disclosure; on canvas it is wrapped text. This does not use the contextual
  hint queue or its per-battle budget. All new affixes in the exchange show their rules.
- Weapon/target cycling keeps these explanations expanded. Confirming or canceling the
  forecast marks every displayed affix lesson read through the save slot's HintManager.
  Later forecasts show the short consequence; the phone disclosure can be reopened.
- `field` affixes stay off the forecast. A player who wants them taps the enemy, which opens
  inspection.

**Inspection.** Enemy Affixes sits right under name/HP on mobile and desktop, with each affix's
name and rule text, instead of at the bottom of Stats. The canvas fallback uses compact
consequence rows with full-rule hover/long-press tooltips to keep tabs and Gear above
the fixed footer at 640×480. Keep the real weapon name (`Iron Lance`);
the effect belongs to the unit.

**Map.** Keep the existing single pip per affix. Per-affix glyphs on a 32px tile read as noise on
a phone, and no affix icon art exists (the `icon` fields are unused). The forecast and inspection
carry the specifics. Revisit only if playtests show affixed enemies are still missed on the map.

**Rule text.** Fix descriptions that misstate behaviour. Venomous: "Hits deal 5 more damage
after combat (never below 1 HP)". Deathburst: say it hits allies and enemies alike and can kill.
Corrosive and Grievous: say "hits", since they need a landed hit. Do not change affix behaviour
in this fix.

### Acceptance and focused regression coverage

1. Generate First Light Act 1 recruit fights across fixed seeds with production
   data: no initial enemy receives an affix, and the +1 hunter/recruit rewards remain.
   A targeted case with an incoming guaranteed-affix override also stays affix-free;
   a rolled-affix override cannot bypass the veto. Cover reinforcement template
   inheritance so it cannot introduce a forbidden affix into that fight.
2. First Light Act 2 recruit fights still guarantee a captain; Dusk/Nightfall/Black
   Sun recruitment and non-recruit Eclipsed battles retain their existing rules.
   The Loom omits Captain only for the excluded encounter. A legacy run without
   the new field adopts the policy for an ungenerated node; a locked/suspended
   Venomous enemy is preserved and clearly disclosed.
3. Data: every affix has a valid `forecast` mode, and every `exchange` affix has `forecastText`.
   Removing either fails `validate:data`.
4. Table-driven over `affixes.json`: each `exchange` affix yields exactly one note when its
   condition holds and none otherwise. Cover a counter blocked by range, Sleep or counter
   prevention; Thorns at range 2 and under 4 damage; Shielded after the first hit this phase;
   Deathburst when your damage cannot kill it. `numbers` and `field`
   affixes never yield notes. An Iron Lance without affixes gets none.
5. Behaviour still matches the text. Venomous applies once per source per combat after a landed
   hit, including a zero-damage hit, and leaves the target at 1 HP. Deathburst can kill an
   adjacent unit. No affix damage on all misses.
6. Renderers: the desktop forecast and the native phone forecast show the same notes, with long
   names and three affixes, above the confirm control, without clipping or pushing it offscreen.
   Full rules are visible before confirmation for every unseen affix, stay expanded through
   cycling, and are acknowledged on confirm or cancel. Later previews collapse them.
7. A fog-hidden enemy exposes no notes or inspector details. Forecast and inspection reads leave
   unit state and battle RNG untouched.

Run the focused generation, affix, post-combat and forecast suites, the relevant portrait and
mobile browser contracts, and data validation and parity. On the built iOS app, check the early
recruit encounter (no affix) and one later Venomous or Deathburst encounter before the next upload.

## 7. Danger during Canto — implementation spec

**Cause.** Danger has three entry points, and they disagree about when it works.
- **The phone HUD** draws Danger in the dock whenever `planning` holds (`renderDock`: idle,
  selection, or `isUnitMenuState`, which now includes `CANTO_CONFIRM`). The legacy controls
  show it in `battle_selected`, which covers `CANTO_MOVING`.
- **A tap, the `danger` key and the pad** reach `BattleScene._onDangerClick`.
- **A hold (pin)** reaches `togglePersistentDanger`.

The last two each hard-code `['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU', FORMATION_STATE]`,
so in both Canto states the button is drawn but does nothing.

**Fix.**
- Add `DANGER_STATES` in `battleMenuModel.js`: `PLAYER_IDLE`, `UNIT_SELECTED`,
  `UNIT_ACTION_MENU`, `CANTO_MOVING`, `CANTO_CONFIRM`, formation. Add `canUseDanger(scene)` over
  it, keeping the story-lock, tutorial and enemy-phase guards.
- `_onDangerClick`, `togglePersistentDanger` and the dock's Danger button all read `canUseDanger`,
  so the button is shown exactly when it works.
- `SELECTING_*` target states and the forecast keep Danger off, as today. The legacy
  `battle_selected` context therefore stops offering it outside Canto: give Canto its own context
  (`battle_canto: ['danger']`) rather than showing a dead button in the target-selection states.

**Behaviour.**
- Toggling Danger during Canto overlays the enemy reach on the blue Canto range. It draws on its
  own layer, so neither hides the other.
- A pin survives the Canto move, Back and Wait, as it survives a normal move.
- An unpinned overlay follows the same rule as after an ordinary action: it stays until toggled
  off, and selecting the next unit hides it (`selectUnit`).
- Danger reads `calculateDangerZone`, which already uses only what the player knows, so a
  fog-hidden enemy adds no reach.
- Toggling it changes no game state and draws no RNG. The unit stays where it is, Back still
  returns it to the Canto origin, and the confirm menu stays open.

**Tests.**
1. Drive the real event route in `CANTO_MOVING` and `CANTO_CONFIRM`: a `mobile:danger` tap and
   the `danger` key show and hide the overlay, and a hold pins it. Checking only that the button
   is rendered missed this bug.
2. In a `SELECTING_*` state and the forecast, no Danger button is drawn and the handlers do
   nothing, so the shown and working states cannot drift apart again.
3. In `CANTO_CONFIRM`, with Danger toggled, the state, the unit's tile, `_cantoPending` and the
   RNG cursor are unchanged; Back still restores the origin and Wait still settles once.
4. The pin survives Back and Wait.
5. A fog-hidden enemy adds no Danger tiles during Canto.
6. Plant the bug (drop the Canto states from `DANGER_STATES`) and watch tests 1 and 3 fail.

## Review follow-ups on implemented items 1–5

Reviewed source head: `b644573`. The existing focused suites passed: Canto confirm,
movement recovery, Threat Sight, lava banner/hazards, native shop and rail pinning
(137 tests). The controlled poison reproduction above also passed against this branch.

### Resume and input coverage before release

The new Canto scene tests cover real terrain costs, fog withholding, Back, retargeting,
Wait, End Turn and animation/recovery paths well. The test named for the W key/mobile
Menu calls `confirmCantoMove` directly, so it does not validate either input binding.
The rail test verifies that Wait/Danger render, but does not activate Danger (now item 7).

Add a real checkpoint/resume case from `CANTO_CONFIRM` after a resolved attack and
after a consumable. Check HP, item uses, origin/location, fog, history and remaining
movement; document the different rollback boundary instead of promising that every
resume lands directly in Canto. Exercise actual W/Enter/Back/mobile Wait bindings,
including repeated activation and a stale menu callback after Back.
Verified: the existing shared menu wrapper refuses a callback once its menu has been
closed or replaced. A regression covers Back, a later Canto choice and repeated activation;
no additional Canto-specific guard is needed. These are focused
integration checks rather than another full-run simulation requirement.

Browser revalidation in this review was blocked before test execution: Chromium was
absent and its download returned a truncated archive. This does not contradict the
author's reported contracts-lane pass, but this review did not independently reproduce
that browser result or run on a physical iOS device.

### Implementation verification (2026-09-30)

Items 6–7 are implemented. Policy is evaluated from canonical difficulty data and the
encounter act. It blocks initial rolled/guaranteed affixes and strips scripted reinforcement
affixes from cloned templates; already locked encounters are preserved. The extra hunter
and recruit remain. Exchange forecasts now have conditional source-side notes, including
critical-hit and follow-up possibilities for Deathburst, zero-damage hits for hit-triggered
effects, and no Wounded warning against status immunity. Rally's numeric aura now names its
source. Enemy affixes show full rules immediately below HP in inspection on every tab.

Real RunManager checkpoint/JSON-restore tests confirm the refresh boundaries: after resolved
combat, HP/weapon state survives and the unit resumes Canto at its origin with its original
remaining movement; after a consumable, the earlier checkpoint restores pre-item HP and uses
and returns to idle. Neither restore reveals the unconfirmed Canto destination's fog.
Browser tests exercise mobile Danger events, the D key, hold-to-pin, Back and mobile Wait;
forecast/inspection coverage includes three exchange affixes. The earlier browser-download
block was resolved using the official Chrome for Testing artifact. A physical iOS check remains
part of release validation.

Validation: 8,973 unit tests, 192 harness tests and 41 simulation tests passed. The browser
contracts lane completed all 74 cases; one scene-boot timeout passed on retry before its
Canto assertions ran. An independent browser run passed 41 cases covering the new portrait
forecast, Canto input, inspection, phone HUD and rotation. Mutation checks caught removal of
the recruit veto, Canto Danger states and the existing shared stale-menu guard. Build, lint
(0 errors), formatting, schema validation, generated-reference checks, content integrity and
30-file data parity passed.


## Review follow-up (40b5392e)

The delayed full-rule hint was a spec miss. Full explanations now belong to the forecast
itself, independent of optional contextual hints. The regular desktop roster already uses
the scrolling DOM sheet; the supported canvas fallback did overlap its footer with Thorns,
Deathburst and a full Gear tab. Its affix rows are compact, with full rules on hover/long press.

Deathburst retains its possible-kill check, but now also needs a living known unit in the
blast radius. The preview receives only inspectable units, so hidden occupants cannot
change the warning. All factions count, matching the actual blast. Suppression is about
known victims, not a guarantee that unseen tiles are safe.

The obsolete forecast `warnings` field is removed; Thorns projection uses affix ids from
`affixNotes`. Difficulty resolution and encounter generation share one legacy exclusion
fallback (First Light Act 1 only). The Combat header/import ordering is corrected.

Validation results are recorded in the review document. Physical iOS checks remain a
release task; browser emulation does not replace them.
