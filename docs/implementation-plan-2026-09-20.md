# Implementation Plan — Presentation, Gameplay Tiers 1–2, Story Wave (September 20, 2026)

Source: `docs/improvement-opportunities-2026-09-20.md`. Scope per Dave: the effects-flag split first; then gameplay Tier 1 and Tier 2, forecast upgrades, repeat-player efficiency, the level-up moment, and five story items (run-history variants, cause-aware defeat epilogues, act 4 + secret act voices, anti-repeat shuffle-bag, place names). Everything else from the opportunities report is logged in the backlog at the bottom.

## Next project — battle timeline and rewind (September 21)

Dave approved execution of the [investigated timeline/rewind plan](specs/battle-timeline-rewind-plan-2026-09-21.md). T1–T4 are now implemented locally: canonical state and identities, durable rewind transactions with fixed outcomes, free historical previews, player-action destinations, and fatal-decision recovery. Code-focused adversarial review and focused muted browser checks are complete; see that plan's execution record for exact verification and phone-only release checks. Enemy-action destinations (T5) remain separate. The deferred-timeline notes in prior wave records below describe those earlier releases, not the current status.

The entries below are historical checkpoints. For release status use `testflight-beta.md`; for the completed fresh-player wave see the final implementation and release-verification sections below. Older upload/commit/browser restrictions in this historical text are superseded by Dave's later explicit instructions.

## Historical slice status — September 21

Build 11 is the current distributed TestFlight build. The sections below preserve the original specs and historical checkpoints; they are not the current completion ledger.

- Presentation S0/U1–U6, onboarding, P1–P6 playtest fixes, and D1–D5 story are implemented locally or shipped in build 11. U2's opt-in acknowledged-dialogue skipping is now implemented locally; node-flavor toasts remain visible because they have no reliable acknowledgement.
- All G1–G10 slices are implemented locally. G5, G8 and G6 each received separate verification checkpoints; adversarial findings were addressed.
- Randomized combat journeys now cover real resolution/XP/checkpoint/popup/reload through production orchestration, with omitted-save calibration and deterministic trace replay.
- Grounded deviations, baseline limitations and the final verification ledger are recorded in [gameplay-slices-2026-09-21.md](gameplay-slices-2026-09-21.md). Unit/harness/full-run/build verification and the five-minute journey soak are complete (6,387 fresh seeds passed). Browser playtesting is paused at Dave’s request; remaining browser checks are listed there for after check-in.
- Check in with Dave when the slices are complete, before upload. No GitHub commit/push. Cloud expansion, native-storage migration, telemetry, and the explicit backlog remain separate projects; existing difficulty act routes are unchanged.

## Execution review — September 20

This roadmap is queued after the locally verified combat-checkpoint/service-cleanup work documented in `journey-persistence-plan.md`. That work has not shipped in build 10. Keep its release checkpoint separate from presentation and balance changes so phone findings can be attributed to the correct build. This review changes the plan only; it does not implement effects, story or balance changes.

Validated against current source: mobile UA currently defaults `reducedEffects` on; saving any setting serializes that default too, so an old saved `true` does not prove an explicit user choice. Combat forecasts currently expose counts and chances, not an ordered exchange. The journey harness temporarily seeds global `Math.random`, so it is not an isolated presentation RNG. Deployment and progression already use `PartyMenus` and `ProgressionMenus` in browsers; old canvas line references are not implementation targets.

Execution priorities:
1. Close the existing stability checkpoint and review phone feedback. Preserve the explicit journey gate and failed-save calibrations.
2. S0 alone: separate accessibility from effects quality, migrate conservatively, and measure full effects on an older phone before calling high quality a safe universal default. Low quality should simplify expensive visuals, not suppress readable dialogue or essential combat information.
3. U1, U3 and the explicit resume/difficulty parts of U2, in small reviewed slices. U5 phase 1 now precedes U4 with user-controlled dismissal. Keep optional story skipping opt-in.
4. Story D1–D5 as a separate content checkpoint, with isolated presentation randomness and save/reload contracts for repeat tracking.
5. Establish fresh balance baselines, then G1/G10 and subsequent economy/loot/affix changes one at a time. Proposed surplus and growth totals are hypotheses to validate against human runs, not automatic acceptance thresholds. Preserve forgiving early Normal encounters and existing act routes.
6. G5, G6 and G8 separately, with G7/G9 scheduled after their dependencies. AI and 2RN change game rules and must not be bundled into a presentation release. Extend random journey coverage into combat before these changes; targeted popup contracts alone are insufficient. Runtime telemetry remains a separate scoped follow-up.

For every slice: verify actual shipping entry points, list touched behavior callers, preserve save/input contracts, and use the existing journey gate as well as relevant unit, headed and simulation checks. Do not restore deleted service renderers to satisfy stale plan references. Time estimates below are provisional, especially forecast sequencing and effects migration.

**Ground rules for every slice**
- Engine changes stay pure and renderer-free; presentation changes must respect the new `reduceMotion` flag from Slice 0.
- Data edits go in `data/*.json` and rely on `npm run sync-data` (auto in build); run `npm run check:data-parity`.
- New dialogue `when` keys must be added to `KNOWN_WHEN_KEYS` (`src/engine/NarrativeDirector.js:20-29`) — the contract test fails on unknown keys, which is the safety net, not an obstacle.
- New prose respects `docs/lore-style-guide.md`; `tests/LoreContent.test.js` enforces limits.
- Gates before each PR: `npm test`, `npm run check:reference`, `npm run check:data-parity`, `npm run sim:fullrun:harness:pr`. Balance-touching slices also run the named sims below and record before/after numbers in the PR description.
- Save-schema additions must be optional fields tolerated by older saves (the build-10 pattern).

---

## Wave 0 — Slice 0: split `reducedEffects` (ship alone, first)

### S0 implementation checkpoint — local, not packaged

Implemented September 20. `SettingsManager.normalizeSettings` is shared by local migration and cloud hydration. Old true maps conservatively to reduced motion + low quality; explicit valid new keys win independently, malformed keys fall back, and failed migration writes report failure without replacing the durable blob. New settings use the OS motion preference and high quality. Deprecated combined accessors remain for integrations, but no shipping renderer calls them.

Settings exposes separate Reduce motion and Effects quality controls with explanations (including the headless canvas fallback). BattleScene, CombatFxController, ProcBannerController, HealController, VillageController, EscapeObjectiveController and TutorialController now read motion separately. Reduced motion removes lunges, recoil/scale pops, camera punches and sliding banners, keeps floating combat information still and uses static overlay art at high quality. Low quality omits overlay art and uses static portrait cut-ins; it does not hide combat labels or dialogue.

BattleBeatsController quips previously drew from global gameplay randomness and were disabled by the old flag. They now use an injected independent seeded presentation stream and remain visible in every setting. This prevents an effects preference from changing subsequent combat rolls. This is RNG isolation only; D4 anti-repeat/save continuity is still future work.

Verification: full unit suite 5,228 passed before the final small cleanup/cloud test; subsequent targeted settings/cloud/effects tests 53 passed, journey gate 53 passed, and four headed phone/menu regression checks passed. Browser checks use 667×375 and an iPhone UA, exercise OS preference, both controls, scroll access, reload persistence and animated/static cut-ins. Screenshots visually inspected. Production build, theme, reference and data parity pass; ESLint has zero errors and existing warnings. Logs: `/tmp/s0-*`. No balance/content data changes, iOS archive or TestFlight upload. Build 10 remains the distributed build.

Remaining release check: measure high-quality effects on an older physical iPhone; browser emulation does not establish frame-rate, thermals or battery cost. Keep this slice separate in review from the prior native-service cleanup. Next implementation slice is U1 forecast semantics, followed by deployment memory; do not begin AI/2RN until the documented combat-journey integration is complete.

### S0 follow-up: migration remap (implemented locally, September 20)
Adjust `normalizeSettings` legacy mapping: old `reducedEffects: true` → `effectsQuality: 'low'` and `reduceMotion` from the OS preference alone (drop the `legacyReduced ||` term in the motion branch). Explicit new keys and fresh-install behavior are already correct and unchanged. Rationale: low quality now preserves readable cut-ins and dialogue, so legacy users lose no information, and forcing an accessibility flag on testers who only adjusted volume is the wrong default. Delta: one branch in `normalizeSettings` + two rows of the migration test matrix in `tests/SettingsManager.test.js` (`[{reducedEffects:true}, false, 'low']` with OS pref stubbed off, and the OS-pref-on variant).



**Problem.** `DEFAULTS.reducedEffects: detectMobileUA()` (`src/utils/SettingsManager.js:18`) means every mobile/TestFlight user gets crit cut-ins, camera shake/zoom, proc art, weapon-art bursts and lord quips disabled and all FX durations halved, with a settings label ("Reduced effects") that gives no hint this is why.

**Design.** Two flags replace one:
- `reduceMotion` (accessibility): default `false`, but initialize from `window.matchMedia('(prefers-reduced-motion: reduce)')` when available. Gates *motion*: camera shake/zoom punch, lunges, screen-level tweens dropping to minimal durations.
- `effectsQuality` (`'high' | 'low'`): default `'high'` on all platforms. Gates expensive visual embellishment: cut-in animation, proc effect art, weapon-art bursts and overlay FX. Preserve static readable cut-ins/skill information and lord dialogue at low quality; motion and narrative are separate concerns.

**Implementation.**
1. `SettingsManager.js`: add both defaults + getters/setters; keep `getReducedEffects()` as a deprecated alias returning `reduceMotion || effectsQuality === 'low'` until call sites migrate. **Migration:** validate and preserve each explicit new key independently. For an old stored `reducedEffects: true`, retain low quality and initialize motion from the OS preference alone. Old false or no stored legacy key receives the new high-quality default, with motion also initialized from the OS preference. Users with explicit valid new keys retain them. Earlier local S0 migrations already wrote those keys without provenance; they cannot be retroactively reset without also resetting deliberate choices. Build 10 predates S0, so its legacy settings still receive the corrected mapping. Normalize local and cloud-loaded settings through the same migration, test partial/malformed new keys, and do not report migration persistence as successful after a failed write.
2. `BattleScene._isReducedEffects()` (`src/scenes/BattleScene.js:5821`) is the single funnel for `CombatFxController`, `ProcBannerController`, `VillageController`, `EscapeObjectiveController`, `TutorialController`, `BattleBeatsController`. Replace it with `_reduceMotion()` and `_effectsQuality()`, then classify each consumer: duration-halving and shake/zoom → motion; art/cut-ins/bursts/quips → quality. Remove the quality-based quip suppression; preserve narrative regardless of graphics quality. Include HealController and all direct getter callers in the migration inventory. Retire the temporary combined alias once all consumers are classified; leaving it in use would re-couple accessibility and content.
3. `SettingsOverlay.js:95` (and the mobile settings menu): replace the one row with two — "Reduce motion" toggle, "Effects quality" High/Low.
4. Cloud settings sync (`user_settings` table via `onSave`) carries the new keys automatically since it serializes `this.data`; verify fetch-side merge tolerates old blobs.

**Tests.** Unit: migration matrix (old-true, old-false, absent, mixed), alias behavior, matchMedia fallback when `matchMedia` is undefined. Update any tests asserting `reducedEffects`. Headed spot-check: crit cut-in appears on a mobile-UA fixture.

**Size:** S. Independent of everything below; every later presentation slice keys off these flags, so it merges first.

---

## UX checkpoint — U3, U2 navigation, U1 wording (local)

Implemented September 20, not uploaded:
- U3: optional `lastDeployment` run field, normalized on save/load/reset. Production battle entry persists selected names with its existing encounter save; resume does not overwrite it. Shared selection resolver keeps the commander, stored order and current cap, drops missing units and never silently fills missing selections. Native deployment adds Same as last battle / Clear optional selections; minimum still gates Deploy. Roster round trips remain supported.
- U2 navigation: optional per-slot meta `lastDifficulty` survives reload/cloud payloads and only preselects an unlocked mode. It is remembered after successful forward navigation. A single active run gets Resume with its act; the existing SlotPicker selection path retains cloud-conflict and suspended-battle prompts. Multiple runs retain Continue. Separate Save slots access remains available, including controller focus. Seen-dialogue tracking/automatic skipping is not implemented in this checkpoint.
- U1 initial clarity only: the shipping forecast separates damage per hit from planned hits and explains hit chance, critical/special effects and interrupted strike sequences. No combat mechanics, HP projections, ghost bars or new triangle indicators were added. Full U1 remains open.

Automatic approval review rejected the proposed combat-order extraction as substantial unverified gameplay-regression risk beyond the bounded UX changes. That command did not execute. The safer display-only forecast update was implemented instead; `Combat.js` is unchanged. Before retrying full U1, prepare a bounded, independently validated ordering/projection design, or obtain explicit approval for the engine extraction. Do not bypass the rejection via another execution path.

Verification: 5,232 unit tests / 291 files; 53 journey checks; 17 distinct headed checks across forecast-input, party-menus, save-choice and UI-review suites passed (the new Resume case rerun after removing a fixture's incorrect hardcoded Act 1 assumption). Screenshots reviewed at phone size. The first title screenshot exposed Save slots overlapping Tap for sound; its final footer position was corrected and visually verified. Production build, theme/data parity and targeted ESLint passed (zero errors, existing warnings). Logs `/tmp/slices-*`. This is a local checkpoint on top of S0/native-service cleanup; build 10 remains distributed. Next: remaining forecast design review and U4 player-controlled level-up presentation, then separate story work.

## Wave 1 — UX slices (parallel, independent)

### Slice U1: forecast upgrades
Predicted-outcome display in both forecast surfaces.
- **Data source:** `Combat.getCombatForecast` already returns per-side `hp`, `damage`, `attackCount` (see `src/engine/Combat.js:711+`). Add a small pure helper `src/engine/ForecastSummary.js`: `summarizeForecast(forecast)` → `{ attackerEndHp, defenderEndHp, attackerKO, defenderKO, triangle: 'adv'|'dis'|null, effective }` so both UIs and tests share one implementation. Triangle comes from the existing triangle computation (`Combat.js:534-668`) — expose it on the forecast object if it isn't already.
- **Canvas UI** (`src/ui/ForecastOverlay.js:181-201`): ghost segment on each HP bar from current→predicted HP; `KO` label in red when predicted ≤ 0, else `→ N HP`; ▲ (green) / ▼ (red) glyph beside the weapon name; tint effective-damage numbers.
- **DOM UI** (`src/ui/MobileBattleHUD.js:279-295`): same fields in the HUD forecast block; 44px touch rules unaffected (display only).
- **Multi-hit correctness:** predicted HP must reflect the full exchange order (attacker strike → counter → doubles), the current forecast does not return a simulated exchange sequence. Extract a shared pure ordering model rather than run randomized resolution during preview. Cover brave/multi-hit, ordering skills, drain and relevant conditional effects. Label the projection “If all hits land” (with its non-critical assumptions), never guaranteed end HP or KO when misses/crits/procs can change it; omit unsupported projections until modeled. Do not recompute `damage × attackCount` naively if the defender can die before countering.
- **Tests:** unit-test `summarizeForecast` across: kill before counter, double kills, 0-damage, triangle both directions, effective 3×. UI smoke via existing forecast harness tests.
- **Size:** S/M. Depends on nothing.

### Slice U2: run-start friction (repeat-player efficiency, part 1)
- **Last difficulty preselect:** persist `lastDifficulty` in meta (optional field); `DifficultySelectScene.js:79` initializes `selectedIndex` from it instead of hardcoded 0. Confirm flow unchanged.
- **Title resume:** when exactly one slot has an active run (the slot cards already compute "Battle suspended — resume" state, `src/ui/RunFlowMenus.js:88-92`), insert a top Title button `RESUME — Act N[, battle suspended]` that routes straight to that slot's restore path (same code path as SlotPicker selection — no new restore logic). With 2+ active slots, fall back to plain Continue.
- **Seen-dialogue meta scope:** `RunManager.shownDialogueKeys` resets on `startRun` (`RunManager.js:354,480`). Add a meta-scoped `seenDialogueKeys` set (persisted in meta save, capped, additive-only) consulted for *skippable* categories only — act-transition and node-flavor keys, never boss beats or first-run tutorials. Seen entries render with an immediate "Skip" affordance or auto-collapse; do not silently drop story for players who want it — gate behind a settings toggle `Skip seen dialogue` (default off, explicitly enabled by the player; keep a manual Skip affordance).
- **Tests:** meta round-trip for both new fields (old saves without them load clean); Title-button state matrix (0/1/2 active slots, suspended vs map); RunManager contract test that battle-critical keys are never auto-skipped.
- **Size:** S/M.

### Slice U3: deploy memory (repeat-player efficiency, part 2)
- Persist the deployed roster names on the run save after each battle start (optional field, e.g. `runManager.lastDeployment`). Pass it through the current DeployScreenOverlay owner to `PartyMenus.showDeploymentMenu` via a shared pure selection resolver, which preselects survivors still on the roster (dead/absent names silently dropped; commander always forced in as today).
- Overlay gains two buttons: **Same as last battle** (re-apply stored list) and **Clear optional selections** (retain required commander and enforce minimum/cap).
- Edge cases to test: stored unit died; roster shrank below min; deploy cap changed between acts (trim to cap deterministically — keep stored order); first battle of a run (no stored list → current behavior).
- **Tests:** unit tests on the preselection resolver (pure function taking `storedNames, roster, limits`); serialization round-trip; harness check that suspend/resume mid-deploy is unaffected.
- **Size:** M. Independent of U2.

### Slice U5: battle speed (pulled forward by Dave, Sep 20 — before U4 and further presentation polish)
Rationale: the old reduced mode halved combat durations; with full effects now the mobile default, battles run slower than the build-10 feel testers know. Ship the throttle before more presentation work.
- **Setting:** `battleSpeed: 'normal' | 'fast' | 'instant'`, a third independent control in `SettingsManager` + both settings surfaces. Orthogonal to S0's flags: speed is pacing, `reduceMotion` is accessibility, `effectsQuality` is fidelity. Persisted/cloud-synced like the others.
- **Scope rule:** the multiplier applies to **combat animation waits only** — never dialogue, decision windows, tutorial hints, or level-up reveals. Implementation hook: combat waits already flow through `_awaitSceneTween`/`_awaitSceneDelay` with string labels (`combat_fx_*`, `proc_banner_*`, strike/heal/effect labels). Apply the multiplier at that funnel keyed on a combat-label allowlist (fast ≈ 0.5×, instant ≈ 0) rather than editing dozens of call sites; audit fire-and-forget `tweens.add` FX (recoil/dodge/brace) separately since they don't pass the funnel — scale their durations via one shared helper.
- **Instant resolves, never skips:** positions settle via the existing `settle()`, every combat event still fires in order, and `BattlePresentationCheckpoint` semantics are untouched — instant means duration ≈ 0, not bypassing the pipeline. SFX still plays.
- **Phase 2 (same slice, after the multiplier proves out):** hold-anywhere-to-fast-forward during `COMBAT_RESOLVING` (temporary fast multiplier while held), touch + keyboard.
- **Tests:** unit-test the multiplier helper (label allowlist, non-combat labels untouched, instant floor); presentation-checkpoint harness green at all three speeds; a seeded battle resolves to identical state at normal vs instant (speed must never change outcomes); headed spot-check of fast/instant on a phone viewport.
- **Implementation review / acceptance constraints:** use an explicit label allowlist and one timing helper. Define Normal 1×, Fast 0.5×, Instant as a small positive scheduling floor rather than relying on zero-duration tween semantics. Scale animation duration/delay/hold together where appropriate, without scaling lifecycle watchdog timeouts or global Phaser time. Snapshot speed for an exchange so mid-animation preference changes cannot desynchronize paired effects.
- **Lifecycle gap to close first:** `CombatFxController.lungeBack` currently assumes recoil/dodge/pop finish during the hit hold. Instant invalidates that assumption. At the end of each strike, cancel/settle the affected sprites and any camera zoom/shake, and dispose owned pending bursts; do not kill unrelated scene tweens. Audit spritesheet playback rate and delayed overlay spawns as well as `tweens.add`. Information chips must remain legible without leaking across actions. Preserve outcome state and callback/cancellation ordering.
- **Audio:** Instant retains combat sound feedback but must avoid an unbounded simultaneous SFX burst. Coalesce or limit presentation sounds without dropping gameplay events or dialogue audio. This needs a headed listening check in addition to state assertions.
- **Phase-2 input restriction:** COMBAT_RESOLVING alone is insufficient; level-up/story/other modal surfaces can own input in that state. Do not capture their press/release events for fast-forward. Clear the held state on pointercancel, blur, app background, scene shutdown and modal ownership changes; do not let the release activate a later control.
- **Verification additions:** compare serialized resolved state and RNG continuation across all three speeds with actual production presentation orchestration (not only an engine-only test). Include brave/doubles, miss/crit, death, healing, proc banners, reduced motion × quality combinations, shutdown/cancel, and refresh at a level-up checkpoint. Assert no surviving transient FX, stale camera zoom or stranded sprite positions after Instant. Dialog/decision/level-up reading time remains unchanged.
- **Size:** M, provisional after the FX ownership audit. Depends on S0 only. Ship phase 1 before considering hold-to-fast-forward.

### Slice U6: battle selection ergonomics (from Dave's playtest feedback, Sep 20)
**Local implementation complete:** mobile-first ally transfer, empty out-of-range deselect, and selection-preserving enemy inspection. Desktop right-click cancellation remains unchanged. Single-enemy threats reuse the existing danger calculation, with a separate overlay; inspection dismissal preserves movement highlights. HUD identifies the still-selected ally while showing enemy information. Verified with 123 targeted unit tests and 22 headed browser tests (phone planning, combat actions, forecast keyboard/controller contracts), production build, and lint (0 errors). Physical-device feel remains to be checked. Not yet distributed to TestFlight.
Root causes, verified in source: (1) tapping another ready ally while a unit is selected deselects instead of transferring (`InputController.handleSelectedClick`, `src/ui/InputController.js:445-453`); (2) on mobile the native HUD enters `UNIT_ACTION_MENU` immediately on selection (`:372-383`) and `handleActionMenuClick` (`:481-485`) silently ignores out-of-range taps — empty-tile taps are dead, Back is the only exit; (3) inspect-while-selected is impossible — desktop right-click runs `requestCancel` before inspection (`:250-253`), and mobile enemy-tap inspection exists only in the idle handler (`:394-406`), so checking a threat range always destroys selection state.
- **A. One-tap selection transfer:** in `UNIT_SELECTED` and the pre-commit selection-menu state (guarded by `isSelectionMenu()`), a tap on another ready, non-sleeping player unit deselects the current unit and selects the new one in a single gesture. Never during committed movement, target selection, or submenus.
- **B. Empty-tile tap cancels the selection menu:** in `handleActionMenuClick`, an out-of-range tap behaves like Back (close menu, deselect, cancel sfx) instead of returning silently. Pre-commit state only — nothing can be lost.
- **C. Inspect without deselect (mobile first):** keep desktop right-click cancellation unchanged; mobile enemy taps in pre-move selected states show inspection + that enemy's threat range overlaid on the existing movement highlights, selection intact. Dismissing inspection returns to the selected state unchanged. Pairs with the flagged per-enemy-threat-range backlog item — same surface; implement together if convenient.
- **D. Deferred (do not build yet):** enemy-tap-to-attack shortcut (move + forecast in one gesture). Revisit after A–C land and Dave replays.
- **Contracts to preserve:** these touch input paths hardened by both audits — tutorial strict gates, cancelable-press/pan interplay (`bindCancelablePress`), fog inspection gate (`canInspectUnit`), double-dismiss protection, and the selection-menu movement grant (`isSelectionMenu` must still refuse post-commit moves). Tests: unit tests per state transition (ally-transfer matrix: ready/acted/sleeping/enemy/NPC targets in each state), headed passes on both desktop and mobile input modes covering select→inspect→move, select→switch, menu→empty-tap, and rapid tap sequences.
- **Implementation constraints:** separate inspection threat visuals from movement highlights; reuse Danger Zone rules for a single enemy (including status staves). Empty out-of-range taps explicitly dismiss the initial menu and selection; legal destinations still move. Back dismisses inspection first. Never bypass tutorial, fog, gesture, submenu, or commitment guards.
- **Size:** M. Independent; can ship with or after U5.

### Slice U7: per-enemy threat range — pinning + intensity stepping (verified for build 12, Sep 21)

Builds directly on U6-C, which already shipped the transient half of this item: an idle enemy tap shows that enemy's move+attack range (`InputController._showInspectionAtPixel`, `src/ui/InputController.js:738-775`), and a planning-state enemy tap overlays a single enemy's full danger zone via `calculateDangerZone(onlyEnemy)` on a separate `DangerZoneOverlay` without deselecting (`:733-735`). What remains from the original opportunity (#13) is exactly two things: the transient views vanish on dismissal, and the global [D] danger zone is a flat union at 0.25 alpha with no overlap information — easy to miss on a phone and silent about "how many enemies reach this tile."

- **A. Threat-intensity stepping (global [D] overlay).** `calculateDangerZone` (`src/scenes/BattleScene.js:10453`) collapses per-enemy results into two Sets, losing counts. Change it to accumulate a per-tile count: return entries `{col, row, count, statusThreat, damageThreat}` where `count` is the number of distinct enemies whose damage threat covers the tile (status-staff-only coverage keeps the existing purple stroke and does not increment `count`). An entity counts once regardless of footprint tiles. `DangerZoneOverlay.show` renders stepped alpha by count — 1 → 0.18, 2 → 0.30, 3+ → 0.42 (same 0xff8800; tune in review) — so overlap depth reads at a glance and the 3+ band is unmissable at small viewports. Single-enemy calls (`onlyEnemy`) naturally produce count 1 everywhere and keep today's look. Static rectangles only: no motion, no Text objects (no `presentationText` concern), depth stays 4, neutral to all reduceMotion/effectsQuality/battleSpeed combinations.
- **B. Pinned per-enemy threat.** A session-scoped `pinnedThreatEnemies` set (unit refs or stable ids) on BattleScene, rendered by one dedicated overlay instance (`pinnedThreat`, same stepped renderer as A, distinct hue — 0xd8342c at the same alphas — so pins read differently from the global orange). Toggling: in the enemy inspection panel (both idle and planning inspection), add a `PIN RANGE` / `UNPIN RANGE` action (DOM and canvas surfaces; desktop keyboard: `T` while an enemy is inspected). A pinned enemy's threat persists across deselect, selection, movement, action menus, and inspection dismissal — that is the entire point — and re-renders whenever the existing staleness sites fire (`dangerZoneStale = true` already marks every mutation: unit move/death/terrain change; reuse the same invalidation for the pinned overlay rather than adding a second scheme). Pins clear when the enemy dies or becomes uninspectable under fog (`canInspectUnit` re-checked at render, mirroring `calculateDangerZone`'s own gate); stale refs are dropped silently. [D] behavior is unchanged and independent: global union and pins can be visible together (pins draw above, depth 4.5).
- **C. Scope limits.** No enemy-phase camera work (separate backlog item). No serialization: pins are presentation state, deliberately absent from the suspend checkpoint (`BattleSuspendController._buildCheckpoint`) — a resume starts unpinned, same as a fresh battle; document this in the pin control's absence after reload rather than persisting. No AI or combat-rule reads from pins.
- **Contracts to preserve:** fog gate (`canInspectUnit`) both at pin time and re-render; `calculateDangerZone`'s rooted-preview rule (`willRemainRootedNextPhase`) and stoppable-tile exclusion unchanged; the U6 planning-inspection state machine (`isPlanningSelection`, `clearPlanningInspection`) untouched except that dismissing an inspection no longer hides a *pinned* enemy's overlay; `dangerZoneCache` staleness discipline (recompute only when stale AND visible — extend the same lazy pattern to the pinned overlay so an all-pins battle doesn't recompute every enemy per action); no gameplay RNG or Text allocation anywhere in the render path.
- **Perf note:** pinned recompute is per-pinned-enemy (`calculateDangerZone(enemy)` per pin, cached per enemy, invalidated by the shared staleness flag). Cap pins at 5 with a cancel-oldest rule to bound worst-case recompute; surface the cap in the control label if hit.
- **Tests:** unit — count accumulation (two overlapping enemies → count 2; entity footprint counts once; status-only tiles keep count 0 and statusThreat true); pin lifecycle (pin → move enemy → overlay re-renders at new position; enemy death → pin removed; fog hides enemy → pin removed; reveal requires a new pin); cap eviction; [D] + pins coexistence. Input-state — pin action available from idle inspection and planning inspection, absent for player units/NPCs; U6 transfer/empty-tap/back contracts re-run unchanged. Headed (after browser testing resumes): phone-viewport pass confirming stepped alpha legibility and pin persistence across a full player phase.
- **Size:** M (A is S on its own; B carries the surface work). Independent of the R1–R4 patch batch; touches `InputController` inspection paths, so land after the R4 dead-tap fix to avoid conflicts.

### Slice U4: level-up moment
- Implement in the shipping `ProgressionMenus.progressionResult` path used by LevelUpPopup: staggered per-stat reveal (~120ms apart), tick SFX per gained stat and a brief highlight. Confirm during reveal completes the reveal; a subsequent confirm dismisses. Do not auto-dismiss learned skills or promotion information. Under `reduceMotion`, render all stats immediately without motion and avoid simultaneous stacked tick sounds. Any future automatic advance requires an explicit preference and sufficient reading time.
- Keep `BattlePresentationCheckpoint` semantics untouched — this slice changes only how the queued popup *presents*, not when it is queued or persisted. The refresh-safety contract (`presentQueuedLevelUps`) must pass unchanged.
- Fix the silent in-battle promotion: `PromotionController.js:184-198` gets the `_playLevelUpSfx` call the Church/roster paths already have.
- SFX: reuse an existing UI tick if available; if adding an asset, route through the audio manifest and `check:reference`.
- **Tests:** presentation-checkpoint harness tests stay green; unit test the reveal scheduler as a pure sequence (list of `(delay, statIndex)`); reduceMotion branch. Headed: one level-up and one promotion case.
- **Size:** M. Depends on Slice 0 (reduceMotion flag).

---

## Wave 2 — Story slices

D1–D3 are data-only and can ship as one PR or three; D4 and D5 carry small code.

### Slice D1: run-history variants on act transitions
- `data/dialogue.json`: for `act1_to_act2`, `act2_to_act3`, `act3_to_finalBoss_normal` (and `runComplete.victory` if variant-shaped), add 2–3 history variants per commander tier using existing keys (`minRunsCompleted`, `lastRunResult`) — e.g. `{"commander":"Edric","minRunsCompleted":5}`. **Order matters:** `selectDialogueEntries` matches top-down, so more-specific `when` objects go before the plain `{"commander":X}` entries. ~60–80 lines.
- **Tests:** existing dialogue contract test validates keys; add one selection test per transition proving the specific variant wins at `minRunsCompleted:5` and the base wins at 0. Prose passes `LoreContent.test.js`.
- **Size:** S.

### Slice D2: cause-aware defeat epilogues
- `runComplete.defeat` in `dialogue.json`: add a `defeatedByKnown`-style variant set per commander using the `{lastFoe}` token. Verify `applyNarrativeTokens()` receives `lastRun.defeatedBy` in the RunComplete context (`RunCompleteScene.js:301-309` already routes through `selectDialogueEntries`); if the token context isn't plumbed there, that's a ~5-line plumb, mirroring `runStart`. Distinguish at minimum: boss-tier foe vs generic, act-1 loss vs late loss (via existing keys if available; add a key only if necessary, updating `KNOWN_WHEN_KEYS` + contract test).
- **Tests:** selection test for known-foe vs unknown; token substitution test with a boss name and with missing data (graceful fallback to base line).
- **Size:** S.

### Slice D3: act 4 + secret act commander voices
- Convert `act3_to_act4`, `act4_to_finalBoss`, `finalBoss_to_secretAct`, `secretAct_start` from plain arrays to `{base, variants}` with 7 commander variants each (~28 lines + bases).
- Extend `preBattleReply` (currently 4 of 11 bosses) to the remaining bosses in `enemies.json` — 7 commander replies each where it makes sense; `BattleBeatsController.getBossPreBattleEntries()` already composes and tolerates absence.
- **Tests:** dialogue contract + lore style tests; one playback test that a converted section still renders for a non-default commander.
- **Size:** S.

### Slice D4: anti-repeat shuffle-bag
- New `src/utils/pickFresh.js`: `pickFresh(pool, key, seenState, rng)` — returns a pool entry not in `seenState[key]` until the pool is exhausted, then resets that key's set. Pure; injectable RNG so seeded tests are deterministic; must not consume gameplay RNG (use a dedicated presentation RNG stream or a stable namespace-derived seed; do not pass global `Math.random`, which the current harness seeds for gameplay).
- Seen-state lives on `runManager` beside `shownDialogueKeys` (optional field, serialized; missing → empty).
- Swap 4 call sites: `NodeMapScene.js:2171` (node flavor), `BattleBeatsController._maybeQuip()` (~line 132), BattleScene recruit lines (~6241), lord farewell (~8947).
- **Tests:** unit — no repeat until exhaustion, reset-after-exhaustion, pool mutation between calls, serialization round-trip; determinism with injected RNG. One integration test per call site category confirming lines still surface.
- **Size:** S/M.

### Slice D5: place names
- Name one region per act (worldbuilding must stay consistent with existing nouns: "the empire", "old kingdom", "court circle", "Varen"). Store as an `acts`/region block (new small `data` entry or a field in existing act config — prefer data over `constants.js` per the data-driven rule).
- Add a one-line `lore` field to each of the 23 templates in `data/mapTemplates.json`.
- Surface: battle-intro banner gains a subtitle line (`the Vaelen Reach — Frozen Pass`); node-map header already shows the act title and can append the region. Keep the banner change minimal — text only, existing surface.
- **Tests:** data-parity + reference checks; `LoreContent.test.js` coverage extends to the new field (add the file to its scan list); banner render smoke test with the longest name (UI overflow checklist: budget ~8px/char at 9px Press Start 2P).
- **Size:** M (writing-heavy, code-light).

---

## Wave 3 — Gameplay Tier 1 (data-only, sim-validated)

Each slice = one PR with before/after sim numbers.

### Slice G1: wire up the dead skills
- `data/classes.json`: add `learnableSkills` to promoted classes with identity fits — starting set: General→`pavise`, Sniper→`sure_shot`, Assassin→`lethality`, Berserker→`fury`, Swordmaster→`crit_plus_15` or `duelist_stance`, Falcon Knight→`skyward`, Dragon Lord→`draconic_aura`, Bishop→`renewal`, Paladin→`aegis`, Wyvern Lord→`intimidate`, plus the rest of the 20 distributed for coverage (`colossus`, `discipline`, `vigilance`, `spell_harmony`, `ride_down`, `armored_blow`, `fiendish_blow`, `skirmisher`, `fortify_aura`). Learn levels 5–15 post-promotion so promotion choice matters immediately vs later.
- Reconsider base-class learn levels vs `PROMOTION_MIN_LEVEL = 10`: move base learns to level 8–10 so unpromoted play sees them (do not change the constant).
- Optionally add 3–5 of the strongest as scrolls in `weapons.json` + act3/act4 `lootTables.json` pools.
- **Validation:** `npm run sim:matchups` and `sim:fullrun` harness before/after; the engine handlers are already implemented and unit-tested, so risk is balance, not correctness. Watch enemy-side inheritance: confirm whether enemies of these classes now gain the skills via the same path (`enemySkillChance` gating on difficulty) and decide intentionally.
- **Size:** S data, M including balance iteration.

### Slice G2: gold sinks / economy tension
- Target: balanced-strategy end-of-run surplus drops from ~24k to under ~6k on Normal without starving act-1 purchases.
- Knobs, in preferred order: (1) per-act shop price escalation (multiplier in `difficulty.json` or lootTable-adjacent config — new small data field read by ShopController pricing), (2) trim `turnBonus.json` `baseBonusGold` late-act values, (3) trim `GOLD_BATTLE_BONUS`/`GOLD_BOSS_BONUS`, (4) leave `GOLD_PER_KILL_BASE` alone (it rewards play, not time).
- Explicitly out of scope: weapon durability (design change, backlog).
- **Validation:** `npm run sim:economy --trials 500` per strategy; acceptance = save-for-seal can still afford Master Seal by mid-act-3 (not act 2), buy-weapons ends under ~5k surplus. Record the table in the PR. Coordinate with G1 if scrolls added (they're a sink too).
- **Size:** S/M (iteration-heavy).

### Slice G3: Act 4 distinctness
- `data/lootTables.json`: differentiate act4 pools from act3 — bias toward legendary/forge, drop iron-tier, introduce 2–3 act4-only entries.
- `data/weaponArts.json`: a tranche of `unlockAct: "act4"` arts (~8–10) and first Light-type arts (3–4) so Sera/Bishop lines join the system; the `combatMods` schema already supports what's needed. Staff/Breath arts remain backlog.
- **Validation:** `check:data-parity`, loot-table unit tests (weighted-pool contracts exist), `sim:fullrun` harness. Art descriptions must state the no-doubling rule (free clarity fix riding along — add one sentence to art description template where missing).
- **Size:** S/M.

### Slice G4: Normal-mode texture + node-map choice depth
Two coordinated data changes, one PR:
- **Normal affixes:** `data/affixes.json` `difficultyGating.normal` → `{ affixChance: 0.05, maxAffixesPerUnit: 1, tierPool: [1] }`, act2+ via the existing act1 ×0.5 scaling (the existing ×0.5 does not zero act1; explicitly exclude act1 for this proposed Normal increase and test it). Exclude the nastiest tier-1s from Normal's pool if any feel punitive (`deathburst` candidate).
- **Node rolls:** `NodeMapGenerator.pickNodeType` weights — Act 1 to ~70/20/10 battle/shop/church; Acts 2+ nudge colosseum `spawnChance` toward 0.7. Add `ACT_LEVEL_SCALING` entries for act2 and act4 (mirror act1/act3 shape: early rows at the range floor, ramping to the full range).
- **Open question to flag in the PR, not decide silently:** `difficulty.json` Normal skips act4 and Hard skips finalBoss — confirm intended with Dave before touching.
- **Validation:** NodeMapGenerator seeded tests (distribution assertions over N generations), AffixEngine exclusion tests, `sim:fullrun` harness on Normal.
- **Size:** S.

### Slice G10: Archer/Fighter recruit value + Dancer trim (approved by Dave, Sep 20)
Constraint: enemy Archers/Fighters must stay easy in Normal early encounters, and `classes.json` is shared — `createEnemyUnit` copies `baseStats` and rolls the same `growthRanges` (`UnitManager.js:392,416`), so no class-wide buffs. Precedent: Archer/Sniper recruits already get a free Longbow (`UnitManager.js:610-616`).
- **Fighter recruit grant:** give Fighter recruits a Hand Axe in the recruit creation path, directly mirroring the Longbow block (scoped to class name `Fighter`; decide whether Warrior joins the way Sniper joined Archer's).
- **Enemy per-class difficulty bonuses:** add `classStatBonuses` to `difficulty.json` modes — hard: `{ "Fighter": 1, "Archer": 1 }`, lunatic: `{ "Fighter": 2, "Archer": 2 }` — applied in `applyEnemyDifficultyModifiers` (`UnitManager.js:318`) beside the flat `enemyStatBonus`. Normal untouched. Wire the key through `DifficultyEngine`'s known-keys list and its difficulty-summary lines.
- **Dancer growth trim:** reduce Dancer's growth totals (332.5, game's highest) toward utility-appropriate (~280–290), cutting combat growths (STR/SKL) rather than survivability (HP/SPD/LCK). Safe class-wide — no enemy Dancers.
- **Tests/validation:** unit tests for the Hand Axe grant (Fighter gets it, others don't, missing-weapon tolerance like the Longbow path) and for `classStatBonuses` application per mode; `check:data-parity`; `sim:matchups` before/after on the affected classes.
- **Size:** S.

---

## Wave 4 — Gameplay Tier 2 (engine)

### Slice G5: AI combat-math target scoring (+ guard latch)
The highest-value engine change; keep it surgical.
- Replace `_scoreAttackTarget` (`src/engine/AIController.js:1019-1040`) with forecast-based scoring: `expectedDamage = forecastDamage × hit% × attackCount` (use `getCombatForecast` — pure), plus a decisive kill bonus when predicted KO, minus expected counter damage weighted by own-HP fraction, small bonuses for triangle advantage and target-on-low-avoid-terrain. Keep the wounded-target term as a tiebreak, not the driver.
- **Perf guard:** forecasts run per candidate target per enemy per turn; cache per (attacker, defender, weapon) within a turn if profiling shows cost on 14-enemy maps.
- Fix the guard one-way latch (`AIController.js:183`): guards re-evaluate and return to post when no player unit is inside the guard radius.
- **Explicitly deferred to backlog:** aggro leash / group activation (bigger behavior change deserving its own tuning pass).
- **Validation:** this changes enemy behavior everywhere — new unit tests for the scorer (kill-preferred-over-wounded-tank, 0-damage target avoided, counter-risk aversion at low HP, guard returns to post); seeded AI snapshot tests will churn — update deliberately, reviewing each changed decision; `sim:matchups` + `sim:fullrun` harness before/after; a headed act-1 and act-3 battle to sanity-check feel. Difficulty note: consider gating the kill-bonus weight by difficulty (`difficulty.json` already layers modifiers) so Normal stays forgiving.
- **Size:** M.

### Slice G6: 2RN hit rolls
- `Combat.rollStrike` (`src/engine/Combat.js:996`): `(rng() + rng())/2 × 100` vs single roll. Use the combat RNG stream (two draws instead of one — this shifts every subsequent seeded outcome, so expect broad seeded-test churn; update baselines in one commit with no other logic changes so the diff is auditable).
- Decide and document: applies to both sides (symmetric, standard GBA behavior) — yes.
- **Validation:** distribution test (displayed 75 → ~87.5% true over 100k draws for the proposed mean of two continuous uniform rolls; distinguish this from a discrete-integer 2RN implementation); suspend/resume RNG-reseed harness stays green; `sim:matchups` before/after (win rates will shift slightly toward the better-hit side — acceptable).
- **Size:** S code, M test churn. Merge before or after G5, not simultaneously (both churn seeded baselines — sequence them).

### Slice G7: lord traits
- `src/engine/TraitSystem.js`: remove the lord exclusion behind a new roll path — lords roll exactly 1 trait from a lord-eligible pool (start: reuse the existing 15 minus any that undermine lord identity; a distinct lord pool is backlog). Roll at run start, persisted with the lord.
- UI already displays traits in 10 files for non-lords; verify lord surfaces (roster, deploy, compendium lord card) render it.
- **Validation:** trait-roll seeded tests, serialization round-trip, `sim:progression` before/after; confirm meta-upgrade stat stacking order with trait modifiers is well-defined (traits apply at creation like recruits — same code path).
- **Size:** S/M.

### Slice G8: enemy self-preservation
- Add a `heal` AI archetype: enemy staff users with a heal staff prioritize healing the most-valuable wounded ally in range (mirror the existing status-staff targeting structure at `AIController.js:300-362`; `isHealStaff` exists in `StatusConditionSystem.js:99`). Assign the archetype in `enemies.json` to cleric-type entries act2+.
- Landing-tile terrain preference: in the landing-tile scorer (`AIController.js:370-389`), add a small tiebreak for terrain avoid/DEF when scores are otherwise equal, weighted up when the unit is below ~50% HP. No full retreat behavior (backlog).
- **Validation:** unit tests (heals in range chosen over attack when ally < threshold; terrain tiebreak deterministic); seeded snapshot churn contained to affected archetypes; headed act-2 battle with a cleric.
- **Size:** M. Sequence after G5 (same file, same test baselines).

### Slice G9: meta-progression texture
- Depends on G1. Replace/augment the `starting_skills` category so unlocks draw on the newly-reachable skill set (e.g. unlock `pavise`/`lethality`-tier scrolls in the starting-equipment pool at high tiers), and add 2–3 ROADMAP-Wave-10 upgrades that change play (class innate skill unlock, lord weapon proficiency bump). Keep total currency curve intact (`metaUpgrades.json` costs sum ~53k — hold roughly there).
- **Validation:** meta round-trip tests, upgrade contract tests, `sim:fullrun` harness at meta tiers 0/mid/max.
- **Size:** M.

---

## Sequencing summary

| Order | Checkpoint | Constraint |
|---|---|---|
| 0 | Existing combat/service stability work | Review phone feedback and release separately |
| 1 | S0 | Migration + accessibility + phone performance verification |
| 2 | U1 → U3 → U2 → **U5 (battle speed; S0 remap now local)** → **U6 (selection ergonomics)** → U4 | Small reviewed UI slices; preserve checkpoint contracts |
| 3 | D1–D5 | Separate story checkpoint; isolated RNG and repeat-state persistence |
| 4 | G1/G10, then G2/G3/G4 | Baseline first; one balance change at a time |
| 5 | G5 → G6 → G8, then G7/G9 as dependencies allow | Combat journey coverage first; independent simulation comparisons |

Random combat-journey integration is still open despite targeted checkpoint contracts passing. Larger balance changes depend on that safety net. Act inclusion changes remain deferred for Dave's decision; retain existing routes meanwhile. Shrines are backlog: if pursued, persist generated offers before preview and persist selection/cost atomically so reload cannot reroll or duplicate rewards.

---

## Backlog (logged, not in this plan)

**UX:** haptics (Capacitor plugin); touch path preview (two-tap move); shop stat-delta comparison + multi-sell + refund-friction flip; audio gaps (miss/proc/XP/promotion/victory sfx, `sfx_dark` wiring, music layers); accessibility pass (text size/rem, colorblind faction glyphs, left-hand mode); hint-driven teaching (HintManager keys for triangle/double/promotion/forge/blessing + node-map guided beat, diagram help pages); node-map strategic tooltip (foe count/level band/loot tier) + node iconography.

**Flagged by Dave for a future dig (priority within backlog):** ~~per-enemy threat range + threat-intensity stepping~~ (promoted to Slice U7, Sep 21); enemy-phase camera follow; branch-foreclosure dimming on the node map.

**Gameplay:** shrine node / mid-run blessings — design sketch in the appendix below; biggest deferred item, revisit after the G-wave lands; aggro leash + group activation; percent-based weapon-art HP costs; roster-cap-vs-deploy bench role; enemy retreat behavior; distinct lord trait pool; Normal act4/Hard finalBoss `actsIncluded` question (needs Dave's call).

**Deferred by decision (Dave, Sep 20):** weapon durability — cut entirely, not just deferred. Imbue downsides — only revisit as part of a larger package, e.g. an ascension system (post-win stacked difficulty tiers, currently absent as a post-win hook) where higher ascensions unlock stronger imbue effects that carry downsides, or a tier above the current six imbues; no standalone nerf pass.

---

## Appendix: shrine node design sketch (backlog — pre-scoped)

A mid-run node offering **2 blessing choices, pick at most one, leave freely**. Reuses existing, contract-tested machinery: `selectBlessingOptions` generates offers, `costPools` rolls downsides, RunManager blessing stacking applies them. The build cost is placement + tiering + one overlay, not engine work.

- **Placement:** mirror colosseum gating — max 1 per act, spawn chance ~0.55–0.6, rows 2..rows-3. Include act 1 but weight its shrines to tiers 1–2. Serves the G4 choice-depth goal: shrine-vs-shop forks.
- **Offers:** `selectBlessingOptions({ count: 2, forceTier1: false })`, tier weights scaled by act (act1→1–2, act2→2–3, act3-4→2–4), excluding already-active blessings. Every mid-run offer rolls a cost from `costPools` — the pre-run pick stays the free one. Declining is free.
- **Optional mechanics (decide at build time):** gold-cost offering reroll (300/500/800 by act — doubles as a G2 gold sink); cap active blessings at ~4–5 to prevent modifier soup.
- **Persistence contract:** accept = one per-transaction boundary (blessing + cost + `saveServiceRun`-pattern save together); reload after accept shows blessing exactly once, cost exactly once. Node completes on leave.
- **UI:** native overlay (MenuSurface, church-decision pattern): two cards (effect, rolled cost, tier), confirm step, Leave always focusable; test longest blessing/cost strings. Shrine flavor lines join the `nodeFlavor` pools (shuffle-bag applies).
- **Tests:** generator distribution, offer tiering, persistence boundary, stacking cap. **Size: M.**

**Story:** recruit namePool hygiene (quick — good rider on any story PR); lord lore + motivation fields; trait voice lines; two-lord banter at transitions; roster-aware epilogue roll-call (`{topKiller}`/`{fallenLord}` tokens); skill/terrain/trait lore coverage; Sera's ledger cross-run codex (L).


## U5 phase 1 — local implementation checkpoint (September 20)

Implemented independent Normal/Fast/Instant settings in local/cloud normalization and both settings surfaces. Old saves default to Normal. Explicit combat-wait allowlist scales duration/delay/hold at the lifecycle funnels; watchdog timeouts, movement, dialogue, decisions and level-up waits remain unchanged. Speed is captured for each exchange. Instant uses a 1ms scheduling floor and still runs the production resolution/presentation pipeline.

Owned reaction tweens and camera pulses explicitly settle at strike completion. Fast sprite overlays run at 2x; Instant uses a static frame and pending bursts are canceled at strike end. Informational floating damage/proc text retains reading time. Instant repeated strike SFX is limited per sound to 100ms. Hold-to-fast-forward remains phase 2, not implemented.

The RNG-continuation check caught two cosmetic dependencies on gameplay randomness: Phaser camera shake and Phaser Text UUID allocation (including optional quips/cut-ins). Crit feedback now uses a fixed tiny camera oscillation, and synchronous combat text creation uses an isolated UUID RNG. Neither changes combat rules. `presentationText` restores the original RNG even if allocation throws; it never wraps an async or gameplay operation.

Two requested small additions ride with this checkpoint:
- Gambler's Coin shared detail: “Gambler: each combat, 50% chance of +5 Attack; otherwise -3 Attack.” Matches current engine odds.
- Rewards offer Roster + Menu. Menu reuses the full pause surface, including Compendium, Help, Settings, campaign map, Save & Return and Abandon. Parent rewards are hidden/inert while browsing; the step stack and focused control restore on Resume. Busy apply cannot open the menu. Existing persistence semantics remain: unclaimed rewards are not saved; Save & Return explicitly warns that they are forfeited, while the completed battle and claimed rewards survive. Persisting pending reward choices would be a separate save-contract change.

Verification: 23 headed cases across speed settings, real combat presentation, abilities/staves/weapon arts and forecast input passed. The final speed test additionally checks RNG continuation for all 12 speed × motion × quality combinations. Unit suite before the final text-RNG patch: 5,245 pass. Final suite: 5,245 pass / 1 failure in the unrelated unseeded MapGenerator NPC-distance test; its isolated 203-test file passes on rerun. Track this flaky spacing assertion rather than claiming the final full run was green. 53 journey checks and production build pass; focused text-RNG/effects tests pass. Eight final headed reward-menu/claim/reload cases passed, including actual Save & Return with no orphaned surfaces and an unchanged durable save. Logs: `/tmp/u5-*`.

Limits: physical-device audio/performance, exhaustive brave/death/level-up combinations at each speed, and hold-to-fast-forward remain follow-ups. Existing combat-action and checkpoint suites pass but are not an exhaustive cross-speed matrix. Full display-only U1 HP/KO estimates and U4 remain the next presentation slices. No GitHub commit/push or TestFlight upload for this local checkpoint.

## Playtest feedback batch — September 21 (Dave; specs verified against source)

### P1: caravan merchant sprite (S — art pipeline)
Merlinus-style pack merchant, blue player palette, 32×32. Add a manifest entry to `tools/imagen-pipeline/manifest.json`, run `imagen:generate`/`imagen:process`, select via `compare.html`, wire the chosen sprite into the caravan surface (`src/ui/CaravanController.js`). Follow the sprite-contrast contour path all unit graphics share.

### P2: Normal enemy-count feel with recruits (S — data + one line)
Finding: no roster-size scaling exists. The only recruit-linked mechanism is `recruitBonus = isRecruitBattle ? 1 : 0` (`src/engine/MapGenerator.js:175-177`). Perceived harshness is likely high `enemyCountByTiles` rolls (80 tiles → 2–8) + the recruit +1 + protecting the NPC. Spec: (1) seeded distribution sim of act-1 Normal node enemy counts, recorded in the PR; (2) drop the recruit-battle +1 on Normal (keep Hard/Lunatic — wire through the difficulty config, not a hardcode); (3) tighten small-map count ceilings for act 1 if the distribution supports it. Preserve forgiving early Normal per standing rule.

### P3: hint readability (S)
Confirmed: `battle_vision_scope` is ~40 words auto-dismissed in 2.9s canvas / 4s DOM (`src/ui/HintDisplay.js:157,187`) and `claimContextualHint` marks it seen on display — a missed hint never returns. Spec: hints over ~12 words render tap-to-dismiss (role=status toast gains a button/tap target; keyboard/gamepad confirm dismisses); shorter hints scale duration by word count (~250ms/word, floor 4s); "seen" is claimed only on explicit dismissal or after the full scaled duration elapsed unobscured. Applies to `showMinorHint` generally — audit other long hints (`battle_escape`, `battle_par`) ride along.

### P4: real-time level-ups (amendment to U4 — binding requirement)
Enemy-phase and queued level-ups must present at the triggering combat ("real time"), both phases, not after enemy phase ends. `BattlePresentationCheckpoint` remains as crash-safety persistence (refresh mid-popup can never lose a level-up) but no longer defers presentation. U4's stagger/auto-dismiss work builds on this ordering.

### P5: Field Medic recruit gap (S — confirmed bug)
`starting_consumable_all` applies once at `run_start` to the then-current roster (`src/engine/RunManager.js:1292-1312`); later recruits never receive the Vulnerary, contradicting lore/description. Fix: persist an active-blessing runtime modifier (e.g. `blessingRuntimeModifiers.startingConsumableAll = name`), grant on every roster-join path (recruits, boss recruit, colosseum hires), serialize with the run, and align the description ("All units — including later recruits — carry a Vulnerary."). Tests: join-after-blessing grant, save/reload idempotence (no duplicate grants), convoy-full fallback.

### P6: victory archive on Title (M)
Meta-scoped run records: on `runComplete` (victory required; defeats as a counter only), append `{ endedAt, difficulty, lords, rosterSnapshot: [{name, className, level}], actsCleared, totalTurns, runSeed }` to `meta.runRecords`, capped at 50 (drop oldest), optional field tolerated by old saves, cloud-synced with meta. Title gains a `RECORDS` entry rendering wins newest-first with roster detail on select. Text-overflow checklist applies (long class names × 12-unit rosters). Future hooks: roster-aware epilogues (D-wave) and the Sera's-ledger backlog item read from the same records.

### September 21 phone-feedback follow-up — implemented and verified locally

Completed: visible escape destinations and Show exits; roster stat-booster/cure Use actions; tappable weapon-art details and explicit art-scroll instructions; shared item-description audit; revival catch-up with temporary −10-percentage-point growth penalty; +1 rewind after every act boss (including Act 1); Vampiric 15% per strike rounded down. See `presentation-checkpoint-review-2026-09-20.md` for mechanics, limitations and verification evidence. TestFlight **0.1.0 (11)** is Testing in Public Playtest as of September 21.


### September 21 next checkpoint — P3/P5 and plan reconciliation

The supplied status recap was stale: U6, U4 presentation, and conservative display-only U1 HP/KO are already implemented (see the status at the top). P4 enemy-phase timing is a separate unresolved requirement: `finishUnitAction` explicitly defers queued popups during the enemy phase. Preserve the durable continuation contract when moving that presentation earlier.

P5 implemented: grant Field Medic at battle recruitment, boss recruitment, third-lord arrival and arena hire. Read the already-persisted active blessing, so existing saves work without adding a redundant modifier. Each unit records successful grants to prevent replay duplication; full consumable bags fall back to convoy. If both are full, nothing is overwritten. Revival does not grant it again. Updated the blessing description.

P3 implemented: notes longer than 12 words use the existing accessible Field notes/Continue surface with a 500ms opening-input guard. No automatic dismissal. Contextual notes reserve the encounter budget on display but become seen only on acknowledgement; shutdown leaves them unseen. Short hints retain at least four seconds, and a hidden document does not count as read. Only open contextual notes while the battle is idle to avoid interrupting combat or decision overlays.

**P2 correction:** the earlier assertion of no deployment scaling is false. `rollEnemyCount` uses `enemyCountBase > 0 ? enemyCountBase : deployCount`, then adds act/row offsets and difficulty bonus. `enemyCountByTiles` supplies a maximum, not a uniform random 2–8 distribution. Trace difficulty overrides and run a seeded deployment-count distribution before choosing a Normal Act 1 cap; do not tune against the earlier claimed formula.

Next order: P2 measurement/Normal tuning → P4 per-combat level-ups and resume tests → P1 merchant art → P6 victory archive → remaining U5 hold-to-fast-forward and story/gameplay slices. P6 requires stable run-record identity and cloud merge deduplication, not merely appending an array. Build 11 stays the live release while this next checkpoint is verified.

Verification for P3/P5: 5,324 unit tests across 303 files passed; headed iPhone SE hint acknowledgement check passed with no retries; schema/reference validation and all 25 mirrored-data files passed; targeted lint has zero errors (eight existing warnings). Logs: `/tmp/playtest-next-unit.log`, `/tmp/playtest-hint-headed.log`, `/tmp/playtest-data.log`. These changes are local, not included in build 11.


## Integration review disposition — September 21 (next local checkpoint)

Source: `integration-review-2026-09-21.md`. Cloud is opt-in (`VITE_CLOUD_ENABLED=true` plus credentials); the current default web/iOS build is local-only. **F1/F2/F4 are latent cloud issues, not current TestFlight blockers.** Narrow fixes already underway are retained and tested; broader cloud work is deferred until cloud enablement is planned. Verify the release build keeps cloud disabled.

- F1/F2: timestamped settings, live manager adoption, migration upload, and remote freshness check before upload. Accepted untimestamped cloud preferences receive a timestamp. Focused tests cover legacy/stale/newer settings. No new account or login flow.
- F3: Aether, Flare and Seraph Strike suppress deterministic HP projections; counter proc warning uses raw skill ownership, including weapon grants. Weaponless forecasts have explicit display metadata. Regression cases added.
- F4: hints piggyback on slot meta, and a live HintManager adopts newer state before reads/writes. Explicit resets remain authoritative. Keep `isNew=false` on reset: it prevents completed-tutorial defaults from immediately marking cleared lessons seen again.
- F5/F6: auto-resume timer is tracked/canceled on scene shutdown; title slot presence is checked after corrupt-slot cleanup. Cloud-conflict timing remains a cloud-enabled follow-up. Resume owns first position/focus when present.
- F7/F9: do not blindly extend battle-speed scaling to dialogue, promotion decisions, level-up reveals, or movement. These were explicitly excluded from U5. Keep reveal/acknowledgement separate so results remain readable. Audit noninteractive damage-effect waits separately.
- F8: removed the duplicate reduce-motion scaling on strike holds.
- F10: not reproduced as described. `lastRevivalResult` is consumed synchronously immediately after `reviveFallenUnit` to create the success notice; Church does not reconstruct that notice on reload. Durable unit/skill changes are already saved. Do not persist a stale transient notice merely to satisfy this claim.
- F11: explicit `test:e2e:presentation` bundle added to CI. Legacy settings accessor/test cleanup is separate from release-critical behavior.
- F12–F15: retain as follow-up audit items; static low-quality cut-ins intentionally preserve information with less motion. Do not treat them as accidental full-quality animations.

P2 implementation caps Normal Act 1 deployment-based enemy scaling at three deployed units and removes its recruit +1; Hard/Lunatic retain their bonus. A 1,000-seed count-formula sample on 80-tile row-3 maps averaged 3.496 enemies for 3+ deployed Normal units (previously 4.496 with four, 5.496 with five), without weakening the two-unit regular-map baseline. This is count-formula sampling, not a full tactical difficulty proof.

P4 now pauses after each enemy combat for earned level-ups with an explicit durable enemy-action checkpoint, preserving acted flags and the original battle RNG base seed. Presentation-only AI target references are stripped from saves. P1 adds an original blue-canopy merchant sprite. P6 adds bounded, deduplicated victory records and a Title Records surface; merged cloud records advance freshness so a live manager cannot erase them. U5 phase 2 uses a dedicated hold control that survives HP updates; it never captures map gestures. D4 uses serialized namespace-local shuffle bags without consuming gameplay RNG.

### Native local-save durability follow-up

Evaluate Capacitor-native persistence as a separate storage slice, ahead of widening the local-only beta. First inventory all run/meta/settings/hints/backup/conflict keys and async startup assumptions. Require versioned migration that copies and validates existing data before changing the source of truth, restart/interruption/quota tests, export/recovery capability, and an actual iOS upgrade test. Do not remove localStorage copies until migration verification succeeds. Browser storage remains supported. This is not bundled into the current gameplay patch, and cloud sync is not a prerequisite.


Integration verification update: 5,349 unit tests passed before the final small deployment/XP changes; 175 focused meta/pacing/XP cases passed afterward. Three headed phone follow-up cases passed, including keeping a speed hold active across HP-driven HUD rerenders. Adversarial review found and fixed live hint/history overwrite and hold-control lifetime issues. F12's zero-cap selection guard, F13's isolated XP text allocation, and F14's adopt-before-setting difficulty ordering are now fixed. Clear optional selections continues to mean the current deployment draft; it does not erase the explicitly named “Same as last battle” history. Broader presentation bundle is running. No new TestFlight upload yet.

### September 21 story checkpoint — local

D1–D3 implemented: history-aware transitions for seven commanders; known-boss/generic-foe/early/late defeat responses; commander voices in all late-act transitions and replies for all 11 bosses. First-clear victory retains precedence even after many losing runs. New conditions read settled narrative state and current persisted defeat context. D4 shuffle bags are persisted and use namespace-local deterministic selection. D5 adds six region labels and lore for all 23 battlefield templates, first-turn place subtitles, and persistent Battle info details. The template validator explicitly allows bounded one-line lore; headed boot checks caught and closed that integration gap. Phase banners replace an existing banner and use brighter text; static introductory place text remains for 2.2 seconds.

Verification: 5,369 unit tests / 308 files passed; 53 journey persistence/combat/fuzz checks passed; 23 headed presentation cases passed before the story slice, followed by four phone follow-up cases after the story slice. Production build, data/schema/reference/theme checks passed. Adversarial review completed. The full-run PR simulation exposed a scripted-agent seize-navigation gap (seed 11 cleared the map then waited beside the throne); fix the harness and rerun unchanged seeds/thresholds before calling the combined checkpoint release-ready. All changes remain local; build 11 is still live.

Remaining execution: fresh gameplay balance baselines → G1/G10 and subsequent G-wave slices, kept separate from presentation changes. Native save durability is a planned migration project; broader cloud work is deferred while shipping local-only. Runtime telemetry must not imply that local-only builds upload player data.

Storage reference: Capacitor's official Preferences documentation explicitly recommends native key/value storage over `window.localStorage` for lightweight mobile data and notes that uninstalling still clears it: https://github.com/ionic-team/capacitor-plugins/blob/main/preferences/README.md . Evaluate actual serialized checkpoint size/write frequency before selecting Preferences versus a native file store; do not assume one plugin fits all save payloads.

Final simulation follow-up: all four PR full-run slices pass with unchanged seeds and thresholds after the scripted-agent seize fix. The settled place banner and blue merchant sprite also passed headed visual review. Gameplay G-wave and native-save migration remain unimplemented follow-ups; no additional TestFlight upload in this checkpoint.

## September 21 — post-completion review checkpoint

See [slice-review-resolution-2026-09-21.md](slice-review-resolution-2026-09-21.md) for R1–R15 disposition and fresh verification. Code fixes and non-browser gates are complete; browser playtesting remains paused at Dave's request and release readiness is pending those checks. Keep cloud refetch timing, deployment-name migration/legacy parity, and native save durability as explicit follow-ups rather than implying every historical observation is resolved.

## September 21 — fresh-player audit: approved next wave

This section supersedes conflicting recommendations in the fresh-player audit. Implementation is now local; see the verification record below. Audit evidence: tutorial, one natural Act 1 boss defeat, permanent upgrade/restart, three second-run wins, arena plus hire, shop and elite-battle suspend. Preserve intentional old-school punishment, limited warning for throne retaliation, and FE vocabulary with optional explanations.

### Sequence and acceptance criteria

1. **Pre-move submenu cancellation.** Fix Item → Back → reachable tile doing nothing until deselect/reselect; cover forecast, Equip and heal cancellation as sibling paths. Restore movement/selection transfer only when uncommitted. Test post-move Back separately to retain undo semantics.
2. **Durable pending rewards.** Allow leaving/reopening the reward screen and save/title/resume without forfeiting unclaimed choices. Persist rolled choices, selected/claimed identity and multi-step progress; prevent reroll/double claim. Returning to the campaign map must offer a clear way back to pending rewards. Define whether advancing is blocked until rewards are resolved; recommended first version blocks advancement while allowing menu/roster/reference browsing.
3. **Arena explanation and information fixes.** Explain single-exchange resolution, draws, HP consequences and XP eligibility before Fight. Arena and hiring remain independently usable in one visit: both already worked in the playtest; no exclusivity change. Explain mercenary traits before hiring, review duplicate candidate names, and preserve clear pricing. Correct stale recruitment objective, exact rewind destination turn, Recenter wording, singular enemy count and shop-ambush wording.
4. **Sticky global Danger, opt-in.** Keep ordinary tap behavior unchanged. Long-press Danger toggles a persistent global-danger mode through ally selection/movement/menu navigation. Distinguish it from individual enemy pins. Add explicit visual/text state and an accessible equivalent action; explain the gesture briefly in tutorial/help. Use shared cancelable press handling: long press must consume the gesture without firing the ordinary tap, scrolling/pointercancel must abort it. Recompute through existing stale sites, preserve fog gates, and allow an obvious unpin action. Presentation-only state; decide resume behavior explicitly rather than quietly adding it to gameplay checkpoints.
5. **Out-of-battle equipment contract.** Roster Equip on the route screen must determine the weapon carried equipped into battle independent of inventory order. This exact path passed live with second-slot Steel Sword; retain a targeted regression covering save/load and deployment. Investigate reported exceptions before adding a redundant control. Separately, previewing another weapon and canceling currently retains it: restore original equipment on an uncommitted preview cancellation unless the player explicitly used Equip. A committed attack can keep its used weapon; do not introduce an automatic post-attack reset without a separate design decision. Review unarmed revival/withdrawal and eligible-recipient defaults. Reuse combat/AS comparisons across shop, forge and rewards; show staff uses/map and accurate category labels.
6. **Small reward/economy calibration.** Use existing gold values to select a Vulnerary bundle of 2 or 3, with minimal checks rather than a large balance simulation. At 300G each, compare 600G/900G against nearby rewards and expected progress. Verify overflow handling and one-time bundle claim, not exhaustive tactical balance. Fallback gold remains intentionally a backup. Calibrate the first Act 1 boss-reaching payout against affordable upgrade prices; consider a modest once-per-run milestone bonus, persisted/idempotent and settled through all defeat/abandon paths. Do not reward repeated entry/reload.
7. **Stock differentiation.** Act 1 pool is small: prefer reducing avoidable overlap between nearby shops, preserving essential supplies and seeded generation; do not guarantee every shop is wholly unique or silently inflate rare supply. Keep stock stable across re-entry/reload. Small samples and targeted invariants are sufficient initially.

### Casualty feedback and timeline: deferred proposal

**Execution update:** Dave deferred the entire timeline update, including the lightweight history/log, until a later wave. Implement the other seven slices first, with code-focused adversarial review and extensive browser checks only after implementation.

Source reviewed: `/Users/davechen/Downloads/battle-timeline-rewind-proposal.md`. Local file is only 34 lines and ends during section 2; remaining spec is not available locally. Reported remote commit: `cd5dc26` on `mobile-rebuild-checkpoint`; not fetched or merged during this planning-only task. Before the next commit, inspect/fetch and reconcile that proposal with current local work rather than blindly pulling over edits. Current local HEAD when reviewed: `41e9f6d`.

- **First, lightweight history independent of charges.** Persistent casualty notice/battle-end casualty summary plus a read-only battle log covering both phases. Allow reading with zero Vision charges; disabled restore action explains why. Record resolved outcomes, not predicted outcomes, with turn/phase/actor/target, damage/heal/status/death and relevant progression. Stable unit IDs distinguish duplicate names. Only expose events visible to the player under fog.
- **Then, timeline previews.** Browse backward/forward through historical views without modifying live battle state, consuming RNG, triggering events, or spending charges. Returning to the current battle restores focus/selection and leaves state unchanged. Bound retained history by measured save size; evaluate native storage separately. Explain which entries are informational versus restorable.
- **Then, action-level player-phase rewind.** Reuse checkpoint machinery only after auditing snapshot completeness and atomicity; an existing latest-checkpoint facility is not proof that arbitrary history restoration is safe. Restore only stable player-phase boundaries after all action consequences/turn-start effects resolve. Spend one charge only on confirmed successful restore; discard the abandoned future branch. Keep charge consumption outside rollback to avoid refunds. Preserve current deliberate rewind reseeding unless separately approved; preview is RNG-neutral, ordinary resume preserves its original continuation.
- Cover death/game-over interception, pending level-ups/rewards, recruitment/trade/inventory, map objectives, enemy-phase cancellation, serialization and failed writes. Verify rewind cannot duplicate currency/items or replay grants, and history never leaks hidden enemies. Retain a lightweight casualty summary even if the full timeline is deferred.
- Enemy-phase restore remains a later slice because resumable AI ordering and in-flight presentation increase risk. No need to block browsing history on charge availability.

Proposal correction: its charge summary is stale. Current RunManager grants +1 after every Act 1–4 boss, including Act 1; keep that rule. Existing Vision rewind deliberately reseeds via hashRewindSeed; do not confuse that with anti-refresh resume preserving randomness.

### Party balance direction

Juggernaut Edric is a legitimate powerful strategy, not a bug to erase. Use existing counterplay (including Sunder), varied enemy roles and spatial/multi-objective pressure while also rewarding a broader roster. Avoid hard counters specifically generated to invalidate the player's build, surprise unavoidable early spikes, or raising all enemy stats to punish investment. Review when multi-objective incentives arrive and whether smaller early incentives can teach distributed participation. Keep this as a separate measured balance slice after UI/input fixes; do not bundle major enemy tuning into the casualty/timeline work.

### Verification and release boundary

Use focused tests per slice, then a short headed mobile journey covering canceled menus, long-press versus tap/scroll, pending-reward leave/reload, out-of-battle Equip → deployment, and service persistence. Add adversarial review for reward-history/rewind restoration before release. Do not claim the full timeline or broader party balance is implemented by landing the lightweight summary. Physical touch remains a device check. No TestFlight upload in this wave yet. Timeline and broad party-balance work remain deferred.

### Fresh-player wave implementation checkpoint

All seven slices above are implemented locally. The timeline (including a lightweight log) is deferred in full.

- **Selection:** main pre-move menu registration is shared, including returning from Item/Equip. Committed movement and tutorial guards remain in force.
- **Rewards:** the native reward flow persists rolled choices, elite claims and selection/recipient/forge draft. View map and Return to rewards preserve choices; advancement is blocked until claims are resolved. Claim value and claim metadata share one save. Failed writes block further claims and leaving, with retry that does not repeat grants. A completed-act reload can finish the act transition after the last claim. The legacy canvas fallback is unchanged; the new durable flow targets the native UI used by mobile. Rolls use the victorious roster before post-battle arrivals.
- **Information:** arena consequences, mercenary traits and unique candidate names, recruitment objective, exact rewind turn, Recenter, singular counts and shop-ambush wording updated. Arena and Hire remain independent.
- **Danger:** hold toggles persistent global Danger; More contains an equivalent action. Tap still toggles visibility. State is explicit and resets with battle/rewind restoration; no gameplay checkpoint field was added.
- **Equipment:** successful roster mutations persist; an empty combat slot auto-equips an eligible withdrawn combat weapon. Attack previews restore original equipment when canceled; confirmed attacks retain their selected weapon. Shop/forge/rewards use shared Attack/AS comparisons; staff descriptions identify uses per map.
- **Economy:** native Vulnerary rewards grant two (600G catalog value), preflight combined unit/convoy capacity, and generate distinct item identities. Reaching the Act 1 boss records a once-per-run +15 Valor/+15 Supply milestone before difficulty scaling, settled through existing end-run reward paths. Existing old saves do not infer the milestone retroactively.
- **Stock:** new ordinary shops prefer valid stock not offered in earlier shops, with fallback to the small existing pool. Essential supplies and cached re-entry stock are retained; caravan stock is excluded from this preference.

Two code-focused adversarial passes covered input/equipment and reward persistence. Findings fixed include submenu registration, preview cancellation, roster mutation saves, empty-slot withdrawal, stale controller/overlay ownership, final-claim act-transition recovery, invalid fresh-stock candidates, and initial/claim save-failure navigation.

Verification: 5,510 unit tests pass (327 files); 56 journey tests pass. Production build and theme check pass. Full lint reports zero errors and 309 warnings; targeted lint also passed. A muted 844×390 browser smoke pass confirmed resumed combat, accessible Danger pin state through selection, and Item → Back → direct movement. It also confirmed undo and pause navigation. The run was left paused with its temporary viewport reset. Extensive reward leave/reload/menu and full service journeys remain the next browser verification pass; physical long-press behavior remains a phone check. This checkpoint is implementation-complete, not a TestFlight readiness claim.

Release verification follow-up: at 844×390, a separate muted origin verified multistep forge draft → map → reopen, reward-menu Compendium, and a normal Slot 1 run with pending Vulnerary bundle → fresh page load without manual saving → Resume → same selected Sera recipient → claim → exactly three carried Vulneraries (one existing plus two new) and advancement unlocked. The initial standalone dev fixture had no active slot and was used only for in-memory navigation; durable verification used the normal New Game flow. Remote cd5dc26 and its preceding test fixes were fetched and reconciled before the release commit; the complete timeline proposal is now local but remains unimplemented.
