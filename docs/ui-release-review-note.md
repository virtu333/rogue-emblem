# Build 10 reviewer checkpoint — UX contracts and progress safety

Version 0.1.0 (10) uploaded successfully at 18:09 Pacific on September 20. The browser App Store Connect session expired; distribution is pending sign-in, Public Playtest assignment and confirmation of Testing. `docs/testflight-beta.md` is authoritative. No GitHub commit or push.

Review the current working tree with `docs/ux-contract-implementation.md` and `docs/ux-supplement-implementation.md`. Both audit sources remain historical evidence. Main changes: durable service/arena/caravan outcomes, saved post-action presentation continuations, shared fog/status/threat rules, cancelable touch input and panning, clear management/help previews, identifiable saves and guarded cloud conflict/logout flow. New optional checkpoint fields remain compatible with older saves; progression and balance rules are preserved except corrected arena skill-grant timing.

Independent review fixed cloud-pair selection/rollback, failed-backup detection, unresolved-conflict logout, sleeping-party resume, and arena live/reload skill parity. Inspect `BattlePresentationCheckpoint.js`, `BattleSuspendController.js`, `CloudSaveConflict.js`, `backupAllLocalSlots`, `BattleInformation.js` and `cancelablePress.js`. State regressions use real serialization and real engine outcomes; browser fixtures still operate through shipping controls.

Validation so far: 5,291 unit tests, 109 harness tests, PR simulations, parity/reference/theme/build/sync and production offline smoke passed; lint has zero errors (307 warnings). Final combined headed pass: 79/79 passed without retries, plus production offline smoke. Formatting passes; generated Capacitor copies are excluded from source formatting. Upload/distribution confirmation follows in the release log. Physical-phone safe areas, software keyboard, audio interruption and an upgraded saved slot remain tester checks. No new remote telemetry; larger legacy cleanup and invariant-driven random journey fuzzing are documented follow-ups.

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
