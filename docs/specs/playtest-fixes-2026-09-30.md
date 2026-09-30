# Playtest fixes — 2026-09-30

Six notes from Dave's and AP's playtests: three about Canto, one about the village shop,
one about lava, and one about an apparently ordinary Iron Lance dealing poison damage.
Items 1–5 are implemented on this branch. Item 6 and the review follow-ups below are
specified for the next implementation pass; this document update changes no gameplay code.

Verdicts: **BUG** · **GAP** (design gap) · **OK** (works as designed, but reads badly)

| # | Note | Verdict | Finding | Fix |
|---|---|---|---|---|
| 1 | "Canto movement is unrestricted by terrain movement" | **OK (feedback)** + latent inconsistency | `startCantoMove` runs the same terrain-aware Dijkstra (`Grid.getMovementRange`) as a normal move, with the unit's `moveType` and Pathfinder modifier. Its budget is `MOV − _movementSpent`, and `_movementSpent` is the path's terrain cost (`computeEffectivePath`). Known enemies block the range, and the game has no ZOC. Three things make it look unrestricted. Fliers pay 1 on every terrain. A unit that acted without moving gets its whole MOV. And Canto drew no path preview, so costs were never shown. The one inconsistency: Canto read `stats.MOV` while `selectUnit` reads `unit.mov`. | Canto's budget now reads `unit.mov ?? stats.MOV`, the same value the move range uses. Hovering a Canto tile draws the walk preview (#3), so terrain cost is visible. A real-Grid test pins that Canto respects terrain. |
| 2 | Canto needs a final Wait to confirm | **GAP** | Tapping a Canto tile moved the unit and ended its turn at once (`completeBattleAction`). A mis-tap cost a rewind. | New state `CANTO_CONFIRM` (see below). |
| 3 | Threat arrows don't show during Canto | **BUG** | `ThreatSightController.focus()` ran only in `UNIT_SELECTED`/`UNIT_ACTION_MENU` and returned null for units with `hasActed`. Canto sets both `CANTO_MOVING` and `hasActed`. The path preview was also gated to `UNIT_SELECTED`. | Threat Sight is active in `CANTO_MOVING` (hovered Canto tile, read from `cantoRange`) and in `CANTO_CONFIRM` (the unit's tile). In those two states `hasActed` does not block it. `updatePathPreview` draws the Canto walk. |
| 4 | "Maxing out forges at a village turned off buying" | **OK (feedback)** | No code ties the forge count to buying. `shopBuyBlock` checks only stock, price and gold. The 1000 G forge left 1161 G, which was below every price in stock: Act 3 prices are ×1.3, the Elixir sits at 1950 and the Act 3 pool has no Vulnerary. The greyed Buy kept its ember fill at 45% opacity, so it still looked live. | Rows priced out of reach show the price in the warn colour (`is-short`). The disabled Buy loses the ember fill (`shop-buy--short`). The reason reads "Not enough gold: N G short.", and a stock that is entirely out of reach says "Nothing here is within X G. Sell, restock or leave." |
| 5 | Lava shouldn't affect fliers | **GAP** | Lava burned every unit (`processTerrainDamage`). Fliers were already immune to acid and ice. | `lavaBurnsUnit(unit)` in `TerrainHazards.js` (false for `moveType: 'Flying'`), used by `BattleScene.processTerrainDamage` and the `HeadlessBattle` mirror. The Lava Crack rule text adds "Flying units are immune". The AI has no lava avoidance, so nothing changes there. |
| 6 | First Light, third-map recruit battle: a Soldier with an Iron Lance dealt unexplained poison | **GAP (disclosure)** + approved balance change | Recruit fights guarantee an affixed hunter even in Act 1 on First Light. `venomous` adds 5 post-combat damage to a unit's attacks without changing its weapon. Its effect is absent from forecast warnings; mobile inspection puts its explanation at the bottom of Stats. Dave confirmed the reported encounter was a recruit battle. | Planned: no enemy affixes in First Light Act 1 recruit fights; keep the extra hunter. Where affixes remain available, explain Venomous in forecasts, put affixes near the inspection header, and distinguish Venomous on the map. See the implementation spec below. |

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

## 6. Early recruit affixes and poison disclosure — implementation spec

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

### Disclosure where Venomous remains available

- **Forecast:** display the source and amount alongside the affected exchange:
  `Venomous: +5 poison after combat if a hit lands; leaves at least 1 HP.` Use the
  affix data's amount, not a second hardcoded 5. Show it for enemy attacks and eligible
  counterattacks. Do not show a counter warning when the enemy cannot counter because
  of range, Sleep, a noncombat weapon or a counter-prevention effect. A landed
  zero-damage hit also triggers it; multiple landed hits apply it once per source
  per combat. Do not require the Venomous source to survive: the current affix
  pipeline can apply its effect after that source fell, if it previously hit.
- **Forecast presentation:** produce the same read-only warning metadata for the
  canvas forecast and `MobileBattleHUD.forecastSide`. Both consume `info.warnings`
  today. Use readable wrapped text or a short label with an accessible explanation;
  account for text height rather than assuming every warning fits one 14px row.
  Keep poison separate from per-strike damage and retain the conservative HP
  projection policy. Forecast reads must consume no gameplay RNG or mutate units.
- **Inspection:** show an Enemy Affixes section immediately below the name/HP on
  mobile and desktop, including name and rule text. Make the explanation visible
  without hover or switching to Gear. Avoid repeating the same block at the bottom
  of Stats. Keep the actual weapon name `Iron Lance`; the effect belongs to the unit.
- **Map:** give Venomous a distinct symbol or badge using the existing affix icon
  hook, with a text label in inspection. A generic tier-coloured pip alone is too
  easy to miss and says nothing about the effect. Do not rely only on green colour;
  test at phone display size and respect enemy visibility/fog rules.
- **Rule wording:** say that it applies after a landed hit and cannot kill. This is
  immediate post-combat damage, not an ongoing Poison condition or an Antidote cure
  prompt. Do not change the damage, hit gate, floor or counter behavior in this fix.

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
3. An Iron Lance without Venomous gets no Venomous warning or affix damage. A
   Venomous attack/counter gets one warning and one post-combat application after
   a hit, including a zero-damage hit; all misses get no damage. Out-of-range,
   sleeping and prevented counters get no counter warning. Targets remain at 1 HP
   when the nominal poison would finish them. Cover a source that fell after hitting.
4. Exercise the actual desktop forecast and native mobile forecast/inspection
   renderers, with long names and a second affix: warning text is legible, above
   the attack confirmation, and does not clip or push the confirm control offscreen.
   A player can learn the effect by tapping an enemy without needing a hover gesture.
5. A fog-hidden enemy exposes no badge, inspector details or forecast warning.
   Forecast and inspection reads preserve unit state and battle RNG state.

Run the focused generation/affix/post-combat/forecast suites, relevant portrait and
mobile browser contracts, data validation and parity. Validate the built iOS app on
the early recruit encounter and one later Venomous encounter before the next upload.

## Review follow-ups on implemented items 1–5

Reviewed source head: `b644573`. The existing focused suites passed: Canto confirm,
movement recovery, Threat Sight, lava banner/hazards, native shop and rail pinning
(137 tests). The controlled poison reproduction above also passed against this branch.

### P2 — Danger is displayed but inert in Canto confirmation

`MobileBattleHUD.renderDock` now renders a Danger button beside Wait in
`CANTO_CONFIRM`. Its tap emits `mobile:danger`, which reaches `_onDangerClick`.
That method still permits only idle, selection, the ordinary action menu and formation.
`togglePersistentDanger` has the same omission, so holding Danger to pin it also does
nothing. Two temporary reproducer assertions fail: no toggle call, and no pin/show call.

Allow `CANTO_CONFIRM` in both Danger entry points (or share one planning-state
predicate with the HUD). Keep overlay/story/tutorial input guards. Add a test that
activates the displayed native button through its event route and checks the overlay,
plus a hold/pin test; merely testing that the button is rendered misses this bug.
Also verify the intended behavior in `CANTO_MOVING`, while the player chooses a tile.

### Resume and input coverage before release

The new Canto scene tests cover real terrain costs, fog withholding, Back, retargeting,
Wait, End Turn and animation/recovery paths well. The test named for the W key/mobile
Menu calls `confirmCantoMove` directly, so it does not validate either input binding.
The rail test verifies that Wait/Danger render, but does not activate Danger.

Add a real checkpoint/resume case from `CANTO_CONFIRM` after a resolved attack and
after a consumable. Check HP, item uses, origin/location, fog, history and remaining
movement; document the different rollback boundary instead of promising that every
resume lands directly in Canto. Exercise actual W/Enter/Back/mobile Wait bindings,
including repeated activation and a stale menu callback after Back. These are focused
integration checks rather than another full-run simulation requirement.

Browser revalidation in this review was blocked before test execution: Chromium was
absent and its download returned a truncated archive. This does not contradict the
author's reported contracts-lane pass, but this review did not independently reproduce
that browser result or run on a physical iOS device.
