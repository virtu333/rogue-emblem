## Current local checkpoint — presentation and onboarding

Release verification is reopened after the September 21 slice review. Browser testing and build 12 upload are authorized; current handoff: [build12-review-note.md](build12-review-note.md). The brief current reviewer note is [presentation-checkpoint-review-2026-09-20.md](presentation-checkpoint-review-2026-09-20.md). It supersedes the pending U1/tutorial entries below; older checkpoint notes remain historical.

---

## U4 — level-up presentation and forecast warning follow-up (local)

The shipping DOM result reveals stats at 120ms intervals. Reveal gains completes the display immediately; Continue dismisses it. Reduced motion starts fully revealed without tick sounds. Learned skills and promotion growths remain until dismissed. Scene shutdown clears the timer and settles the popup exactly once; promotion SFX now follows the existing play/stop lifecycle with `finally` cleanup. Promotion Move gains are visible.

Adversarial review found and fixed two issues: multi-level awards previously reused the final unit stats in each popup, and lethal-counter copy ignored weapon-art HP cost. `progressionDisplay.js` reconstructs independent per-level display snapshots without changing the unit or XP; `counterRisk` accepts the existing post-cost HP calculation. No resolution ordering or checkpoint timing changes.

Verification: 5,273 unit tests passed across 295 files; 53 journey checks passed; headed coverage includes four reveal/rotation/input cases, three forecast-input cases, and both real popup reload journeys. Full-run harness, reference, data parity, theme, and production build passed; lint has zero errors and existing warnings. The reload helper was updated to use Save slots when the new single-run Resume button is present. Final screenshot review moved Continue into a fixed footer so long promotion results open at the character heading instead of scrolling to the button. No TestFlight upload for this slice.

Reviewer focus: two levels in one XP award, early Reveal then Continue, reduced motion, shutdown between popups, and promotion/level-up refresh before dismissal. New headed tests drive the real popup; reload contracts separately exercise actual combat/promotion and saved-slot resume. Physical phone audio balance and touch feel remain device checks.

---

## September 20 follow-up — roster touch selection (local, not packaged)

Preserved the incoming roster patch: hover styling only on hover-capable devices, an explicit selected rail/caret, and the level beside each unit name. Replaced its per-button pointer anchor with `bindCancelablePress`, using 24px touch/pen tolerance and 10px mouse tolerance. Pointer cancellation, slide-off, changed context and disconnected controls remain blocked; keyboard activation remains supported. Extended hover guards to cohesion and pause styles while retaining active and keyboard-focus styling.

Regression coverage exercises the real roster: thumb drift accepted, mouse drift rejected, scroll cancellation and slide-off followed by a click rejected, one selected card after switching, and level text present. Browser emulation does not establish the original physical-iOS sticky-hover reproduction; confirm ordinary taps and deliberate scrolling on device.

The previously reported five unit failures were part of the in-flight release work. Corrections include optional scene events for queued hints, matching the updated hint/settings contracts, the rewind banner's headless camera guard, and a ruins-shop fixture using the production `saveShopState` API and `shopBuyItems` fields. Do not treat these as waived failures.

Verification: 5,267 unit tests passed across 294 files; 15 headed roster/shell/desktop checks passed; theme, targeted lint and production build passed. No TestFlight upload in this follow-up.

---

## U6 — Mobile battle planning (local checkpoint)

- One tap switches to another ready ally before movement commitment. Empty out-of-range taps dismiss the initial menu and selection; legal destinations still move.
- Enemy inspection preserves the selected ally, action menu, and movement range. Back dismisses inspection first. Separate threat visuals use the shared Danger Zone calculation (including status staves); the HUD names the selected ally.
- Desktop right-click cancellation, tutorial locks, fog boundaries, committed movement, and submenu guards remain in place. Attack shortcuts remain deferred.
- Verification: 123 targeted unit tests; 22 headed browser tests across planning, combat actions, and forecast input; production build; lint 0 errors (existing warnings). Screenshot: `/tmp/u6-inspection.png`.
- Reviewer focus: inspect → Back → destination; switch allies before moving; no switching after trade/movement; hidden enemies; one-finger drag/pinch cancellation on a physical phone. No TestFlight upload in this slice.

# Local shop re-entry addition

The current completed shop now offers Re-enter shop until the route advances. `RunManager.canReenterShop` keeps this separate from forward-route availability. Leaving stores stock, forge usage, restock escalation and discount state rather than deleting the cache. Re-entry uses the same controller and cached inventory; no restock or completion rewards are granted. Skipped shops, old completed visits without a saved inventory, and one-time caravan rewards do not reopen. Act advancement still clears shop state.

28 targeted shop/persistence checks, 53 journey checks, headed phone route→shop→leave→re-enter verification and production build pass. No TestFlight upload.

---

# Local Compendium Stats addition

Appended Stats after Foes, preserving all existing indices. All/Core/Derived/Growth expose 18 entries through the existing searchable list/detail surface. Source: `src/ui/statReference.js`; booster values come from consumables, shared formulas from generated referenceViewer. Corrected the upstream effectiveness reference (triple Might, not final damage), Mastery disadvantage, boss crit protection, HP costs and conditional extended levels. Kept roster tooltips and Help entry points. Active category now stays in view when selecting entries in a horizontally scrolled tab bar.

68 targeted content/Compendium tests pass. Headed iPhone-SE-sized check covers filters, search, active-tab visibility and real detail scrolling; screenshot reviewed. Reference/data checks, data validation, lint and production build pass. No TestFlight upload.

---

# Local U5 + reward-menu checkpoint

Review `combatTiming.js`, `presentationText.js`, CombatFxController, the two settings surfaces, BattleScene's timing funnels and exchange wrapper, and MobileRewards' pause-menu handoff. Verify: explicit timing allowlist; unchanged watchdogs; transient sprite/camera cleanup; RNG restoration on exceptions; reward parent hiding/input ownership and restoration; explicit forfeiture warning on Save & Return. Gambler's Coin now spells out its 50/50 bonus/penalty.

The real headed combat test compares result, final HP, settled sprites and the next RNG value across all 12 speed/motion/quality combinations. 31 distinct headed cases passed: 23 speed/combat-action/forecast cases plus eight reward completion/menu/save-to-title/reload cases. 53 journey checks and production build pass. Final full unit run had 5,245 passes and one randomized MapGenerator NPC-spacing failure; the isolated file passed all 203 on rerun. This is an open test-stability follow-up, not a clean full-suite claim. Detailed scope and remaining verification limits are in the implementation plan. No TestFlight upload or GitHub commit/push.

---

# Local UX checkpoint — deployment and repeat-run navigation

Review U3 and U2 navigation with the new checkpoint in `docs/implementation-plan-2026-09-20.md`. Focus on commander/cap preservation, missing remembered units, lastDeployment save timing, unlocked difficulty fallback, and Resume routing through existing cloud/suspend guards. Save slots remains separately accessible. Forecast changes are display-only; full HP/KO projections remain deferred after automatic review rejected an engine-order extraction. No combat resolution changes.

5,232 unit tests, 53 journey checks and 17 distinct headed checks pass; phone screenshots reviewed and a title-button overlap corrected. No TestFlight upload or GitHub commit/push.

---

# Local S0 checkpoint — effects and accessibility

Not packaged; TestFlight remains build 10. See the S0 checkpoint in `docs/implementation-plan-2026-09-20.md` for scope and verification. Review conservative local/cloud settings migration, failed-write behavior, independent motion/quality consumers, static readable cut-ins and isolated lord-quip randomness. No renderer uses the deprecated combined settings getter. Check older-phone performance before distributing the new high-quality default; browser verification is not a hardware benchmark.

Full unit suite, targeted migration/effects checks, journey gate, four headed small-phone/menu checks and production build passed. Prior native-service cleanup remains a separate local review checkpoint below. No GitHub commit/push or TestFlight upload.

---

# Local reviewer checkpoint — journey contracts and native-only services

Not packaged: TestFlight remains 0.1.0 (10). Review the working tree with `docs/journey-persistence-plan.md`; no GitHub commit/push.

Review priorities: save-result propagation in BattleSuspendController/BattleScene, no save-before-reload in JourneyCombat, retained arena settlement/old-board repair, Shop stock/caravan/restock and non-shop notices, and service shutdown/map/roster round trips. Church, arena and Shop now have one renderer each. Canvas-only test assertions were migrated to native callbacks plus engine contracts.

Seven targeted combat checkpoint cases join the service fuzz/replay gate. They are not random battle-journey fuzzing. Adversarial source review found no blocker. Unit, harness/journey, fresh-seed soak, simulations and headed service/keyboard checks passed; detailed counts, limits and logs are in the plan. The browser pass also repaired disconnected keyboard/controller selection handlers in setup/reference menus.

---

# Build 10 reviewer checkpoint — UX contracts and progress safety

Version 0.1.0 (10) uploaded successfully at 18:09 Pacific on September 20. Distribution is complete: App Store Connect confirms **Testing** in **Public Playtest**, with What to Test notes submitted and automatic tester notifications enabled. `docs/testflight-beta.md` is authoritative. No GitHub commit or push.

Review the current working tree with `docs/ux-contract-implementation.md` and `docs/ux-supplement-implementation.md`. Both audit sources remain historical evidence. Main changes: durable service/arena/caravan outcomes, saved post-action presentation continuations, shared fog/status/threat rules, cancelable touch input and panning, clear management/help previews, identifiable saves and guarded cloud conflict/logout flow. New optional checkpoint fields remain compatible with older saves; progression and balance rules are preserved except corrected arena skill-grant timing.

Independent review fixed cloud-pair selection/rollback, failed-backup detection, unresolved-conflict logout, sleeping-party resume, and arena live/reload skill parity. Inspect `BattlePresentationCheckpoint.js`, `BattleSuspendController.js`, `CloudSaveConflict.js`, `backupAllLocalSlots`, `BattleInformation.js` and `cancelablePress.js`. State regressions use real serialization and real engine outcomes; browser fixtures still operate through shipping controls.

Validation so far: 5,291 unit tests, 109 harness tests, PR simulations, parity/reference/theme/build/sync and production offline smoke passed; lint has zero errors (307 warnings). Final combined headed pass: 79/79 passed without retries, plus production offline smoke. Formatting passes; generated Capacitor copies are excluded from source formatting. Upload/distribution confirmation is recorded in the release log. These counts describe the packaged build verification, not subsequent reviewer runs. Physical-phone safe areas, software keyboard, audio interruption and an upgraded saved slot remain tester checks. No new remote telemetry; larger legacy cleanup and invariant-driven random journey fuzzing are documented follow-ups.

---

# Build 9 release checkpoint — input ownership

Build 9 is distributed to Public Playtest; App Store Connect confirms **Testing**. See `docs/testflight-beta.md` for the authoritative release status.

Review focus: `domInputBoundary.js`, the shared/custom menu event boundaries, Title overlay guard, and stale ChoicePicker focus restoration. Compendium/menu presses now remain inside the active DOM surface; recovery owns keyboard/controller input; canvas-to-menu mouse releases cannot leave a held map pointer; repeated Confirm/Back cannot dismiss multiple layers. Gameplay rules and save formats are unchanged.

Validated: 5,201 unit tests, 109 harness tests, PR simulations, 83 unique headed browser cases, production offline smoke, build/sync and parity gates. Physical-phone checks should emphasize touch scrolling/pinch after closing menus, Compendium lord selection, carried-over saves and rapid nested-menu navigation. No GitHub commit/push.

---

## Build 8 reviewer checkpoint — September 20, 2026

Scope since build 7: first-tap mobile unit selection (including forest/mountain), contextual skill/art/staff descriptions, cancelled-staff combat-weapon restoration, discoverable disabled abilities with uses/reasons and a focusable Back action, and the approved option 1 sprite contrast treatment. The combat-actions development fixture is isolated from saved lord selection. Option 2 sampling was rejected and removed. All unit graphics—including bosses/entities, recruits and promoted units—share the contour path with unchanged sprite dimensions/anchors.

Independent adversarial review found no outstanding release blockers. Earlier findings fixed: all-disabled ability menus lacked a focusable exit; the synthetic fixture could inherit a saved alternate lord pairing. Source review traced contrast through recruitment, reinforcements, promotion, rewind and suspend restoration. Gameplay rules, asset files and save schema are unchanged in this checkpoint.

Review focus: physical-phone sprite contrast over detailed terrain; first-tap selection versus drag/pinch and movement undo; disabled abilities under silence/exhaustion; cancelled Heal/Warp/Rescue followed by an enemy attack; carried-over save resume. Synthetic combat checks exercise action/cost correctness, not campaign balance. Physical-device rendering and audio interruption remain tester checks.

Release evidence and distribution status: `docs/testflight-beta.md`. Detailed coverage: `docs/combat-actions-browser-review.md`. No GitHub push, per user request.

# Build 7 — run recovery and startup UI reviewer handoff

Build 0.1.0 (7) is **Testing** in Public Playtest as of September 20, 2026. Tester notes submitted and automatic notifications enabled.

Review the current working tree; build 6 and earlier notes below are historical. No GitHub push requested.

- Fixed the exact `this.data.drawImage` teardown crash: MenuFocusController no longer repaints destroyed Phaser Text. RunComplete also rejects dialogue continuations after scene shutdown.
- Save selection, resume/delete dialogs, hints and run results now use the shared native UI. Recovery prompts have readable themed controls. Reward settlement and existing save contracts are preserved.
- Staff users restore their previous usable combat weapon after healing, curing or relocation, enabling normal counterattacks. This does not grant an extra action.
- Normal Act 1 excludes Cavaliers until three units have joined, counting fallen units; Hard/Lunatic and later acts are unchanged. Existing generated battles are preserved.
- Foreground audio uses bounded retries and a next-gesture fallback without recreating music or altering mute/volume.
- Independent review confirmed both crash paths and found a save-dialog focus issue, now fixed. Gates: 5,183 unit tests, 109 harness tests, PR simulations, lint/reference/parity/theme/build; 15 headed recovery/progression/scene cases, the full mobile run loop and production offline smoke passed.

Physical playtest: upgrade an existing save, defeat → Home Base → new run, suspend/terminate/resume, iOS app switch with music on/off, and Sera heal → enemy attack at valid range. Audio recovery is verified in Chromium; physical iOS behavior remains unconfirmed.

Details: `docs/run-resume-ui-plan.md`. Distribution: `docs/testflight-beta.md`.

---

Build 6 distribution: App Store Connect reports **Testing** for 0.1.0 (6), assigned to Public Playtest with automatic notifications enabled (September 19, 2026).

# Build 6 — service readability reviewer handoff

Review the latest working tree on `mobile-rebuild-checkpoint`; build 5 notes below are historical. No GitHub push requested.

- Shop now uses persistent item details and explicit Buy/Sell/Forge/recipient confirmations. Transactions and roster returns save; stale stock, ownership, caps, full convoy and duplicate activation are checked.
- Church and arena decision screens now use native, scrollable 14px text and 44px controls. Costs, promotion comparisons, revival equipment notice, opponent forecasts and hiring details stay readable.
- Battle Item/Equip rows include effects/stats; staff uses include the current healer. Service map wording now says current location.
- Adversarial review: 35 new economy/service regression tests. Corrected save gaps, discount clamping, recipient eligibility, comparison loss and stale arena header callbacks.
- Validation: 5,172 unit tests, 109 harness tests, all PR simulations, lint/theme/reference/parity; final phone service/submenu/progression suite 17 passed, six reward cases passed, full touch run/save/resume passed.

Playtest: long item/skill names, full bags, unaffordable items, rapid confirmation, portrait rotation, Church promotion/revival, arena hiring/forecast. Physical-device notch/keyboard/controller behavior remains to check. Arena saves when leaving the visit; its existing save boundary is unchanged and now explained. Legacy headless renderers are retained; no save schema or balance changes.

Plan/coverage: `docs/shop-readability-plan.md`. Distribution status: `docs/testflight-beta.md`.

---

# Build 5 — reviewer handoff

Review the working-tree changes on `mobile-rebuild-checkpoint` against `0a12fb7`.
No GitHub push is planned. Earlier roster/reward checkpoints remain in local history.

## What changed

- Battle Item, Equip, ability and weapon-art menus now register explicit selectable rows, show unavailable reasons, preserve Back behavior and reject stale/double activation. Consumables such as Sera's Vulnerary are visible and usable.
- Level-up, promotion result/choice, rewind, battle trade and transition recovery use the native menu surface with keyboard/controller ownership and shutdown cleanup.
- Rewards add small category glyphs, actual weapon-tier labels/colors, and read-only Roster/Settings round trips without losing the reward step.
- Shop/Forge touch previews persist after finger lift; pointer ownership prevents a completed button action dismissing the service. Colosseum gains keyboard/controller navigation.
- Title actions appear immediately; empty Continue slots explain how to begin a new game.
- Turn-start controls remain locked while banner/effects resolve. A fast End Turn previously skipped healing, acid and ballista effects; readiness now follows effect completion.

## Adversarial review

Independent review checked stale selection, mutation order, modal teardown and input ownership. Fixed: promotion chooser continuing after shutdown (including lazy import), seal consumption before visual awaits, recovery retry focus/fallback after teardown, reward focus after adding header tools, and trade confirmation scrolling on small phones.

The reviewer also reproduced a resume-time generated-text texture-key collision after RNG reseeding. A per-game guard disambiguates only generated canvas UUIDs without consuming additional randomness; named-asset diagnostics remain intact. Real Phaser rendering/cleanup and the full save/resume loop pass.

Final review of turn-start token, rewind, lifecycle, effect-loop and hint ordering found no further blockers.

Final gates and TestFlight distribution are recorded in `docs/testflight-beta.md`.

## Review/playtest focus

Try rapid input during turn banners, long effect animations, promotion and reward confirmation. Check tutorial hints, sleeping units, rewind and scene shutdown. On a physical phone, verify rotation, notch clearance, thumb targets, controller input and an existing save carried over from build 4.

## Deliberate limits

Shop/Church/Colosseum retain their canvas service renderers with targeted interaction fixes. Their full DOM migration/deletion remains separate parity work. Noninteractive combat effects remain canvas. Reward reload retains the win but forfeits unclaimed loot under the existing save contract. Untiered items show category labels rather than invented rarity.

## Verification

5,137 unit tests across 275 files; 109 harness tests; all PR simulation slices; data/reference/theme checks; lint (zero errors, existing warnings); production build and offline iPhone smoke passed. Phone/desktop checks cover battle submenus, six reward completions, progression/rotation, trade/rewind, arena navigation, turn-start early input and the full save/resume loop.

## Distribution

Build **0.1.0 (5)** uploaded September 19, 2026 and App Store Connect reports **Testing** after external review submission to Public Playtest. Automatic tester notifications enabled. No GitHub push performed.


## Build 9 follow-up: input ownership audit (September 20)

See [input-boundary-audit.md](input-boundary-audit.md) for reproduced findings, source coverage and validation. Fixes cover the battle sidebar and standalone surfaces, canvas-to-menu mouse release, held activation/cancel keys, and stale-picker focus. Final unit suite: 5,201 passing; 83 unique headed browser cases passing across the audit and focused reruns. Build 9 release status is recorded in `docs/testflight-beta.md`.

## September 21 local follow-up (not uploaded)

Reviewer focus: enemy-phase level-ups now interrupt at the earning combat with a durable enemy-action checkpoint; resuming must skip already-acted enemies and preserve the original RNG base. Field Medic grants on later joins once. Normal Act 1 enemy counts stop scaling after three deployed units and omit the recruit bonus. Long hints require acknowledgement. Victory Records, blue merchant art, hold-to-speed, history-aware dialogue and battlefield place descriptions are included.

Integration review fixes include proc-safe forecast projections, resume timer cleanup, title Resume priority, and a dedicated presentation CI bundle. Cloud-only findings are not TestFlight blockers: the shipping default is local-only. Narrow sync safeguards already implemented remain covered, but further cloud work is deferred. Native save migration is separately planned; no save backend migration ships here.

Verification so far: 5,369 unit tests, 53 journey tests, 23 presentation browser cases plus four phone follow-up cases, data/reference/theme validation and production build. Adversarial review found and closed stale live-manager and hold-control issues. Full-run simulation initially exposed a scripted-player bug: after clearing a seize map it waited beside the throne. The harness now targets the throne; 13 focused tests and the unchanged 12-seed Normal slice pass. Final full simulation rerun pending. Physical iOS upgrade, safe-area and interruption checks remain device-only coverage.

Final simulation follow-up: all four PR full-run slices pass with unchanged seeds and thresholds after the scripted-agent seize fix. The settled place banner and blue merchant sprite also passed headed visual review. Gameplay G-wave and native-save migration remain unimplemented follow-ups; no additional TestFlight upload in this checkpoint.

## September 21 — prior slice-plan handoff (verification reopened; not uploaded)

Review the remaining U2/G-wave with `docs/gameplay-slices-2026-09-21.md`. Adds opt-in acknowledged-story skipping, usable class/lord/meta progression, distinct late loot, modest later shop pricing, richer route choices, forecast-based enemy planning, bounded enemy healers, and symmetric two-roll attacks. Earlier local presentation/story/playtest work remains included. The economy target was revised after comparing the approximate model against real run orchestration; Act 1 prices and existing difficulty routes remain intact.

Adversarial fixes include fresh-recruit/load innate-skill parity, status-cure loot reachability, sleeping enemy action prevention, and imbue-aware AI forecasts. A wall-detour stall was in the scripted test player, not an unreachable map; its pathfinding now has a regression.

Non-browser verification: 5,443 unit tests, 165 harness tests (including 56 journey checks), four PR simulation slices, 15 none/mid/max-meta samples without timeouts, data/schema/parity/reference/theme checks, production build; lint0errors/310existingwarnings. Simulations validate stability; they do not establish player difficulty or pacing.

Browser playtesting was stopped at Dave’s request. Earlier phone checks passed for seen dialogue, enemy healing, Act1 guard/Menu/Resume, enemy level-up checkpoint, Records and hold speed. Resume after check-in: interrupted Act3 guard case, final Hit-rating display parity, combined presentation bundle and broader gameplay pacing. No new TestFlight upload or GitHub commit/push. Build11 stays live.

Final extended gate: five-minute journey soak passed 6,387 fresh seeds with zero invariant failures. Fixed test-only mock retention exposed by the first soak; default heap limit retained, final heap194MB/peak346MB. No browser testing resumed.

## September 21 — follow-up review fixes (local, browser validation pending)

Fixed popup RNG drift, deferred/acknowledged teaching hints (including create-before-deploy and offscreen-note cases), undo-menu ownership, held-fast-forward continuity/cleanup, missing timing labels, Instant stat reveal, anchor healer caps/AI, and ballista 2RN consistency. Added direct throne-detour and stronger boss-reward coverage; retained old victory metadata when roster data is malformed. Full disposition: [slice-review-resolution-2026-09-21.md](slice-review-resolution-2026-09-21.md).

Fresh combined gate: **5,667 tests / 339 files pass**, all four PR simulation slices pass, production build and data/reference/theme checks pass, lint has zero errors. No browser playtesting resumed. Remaining physical/headed checks prevent a release-ready claim; build 11 remains live and no upload occurred.
