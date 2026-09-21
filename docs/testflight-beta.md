# Mobile beta release

## Build 13 — September 21, 2026 — Testing

Version **0.1.0 (13)** uploaded successfully at **12:08 Pacific** (`/tmp/build13-upload.log`, `EXPORT SUCCEEDED`). Archive: `/tmp/EmblemRogue-Beta-13.xcarchive`. Cloud explicitly disabled. Local commit: `63b85b9`; no GitHub push. App Store Connect confirms **Testing** in **Public Playtest** with four testers, notes saved and automatic notifications enabled. Build ID: `20a38907-4b02-49fa-ac84-70a7c0d8ced5`. Public link: https://testflight.apple.com/join/UeWBYA5n.

Scope: readable mobile inspection, clamped crit/kill quips, service-route spacing, and title button layout. Reviewer note: `docs/build13-review-note.md`. Verification: 5,690 tests / 342 files; nine headed browser cases; 1,000 seeded route-contract maps; targeted lint zero errors, theme/build/sync/archive passed. Tester notes: `/tmp/EmblemRogue-Build13-WhatToTest.txt`. Existing saved routes are preserved.

## Build 12 — September 21, 2026 — Testing

Version **0.1.0 (12)** archived at `/tmp/EmblemRogue-Beta-12.xcarchive`; bundle `com.davechen.emblemrogue` and build number verified. Production assets rebuilt after U7 and synced with cloud explicitly disabled. Signed upload succeeded at **11:28 Pacific** (`/tmp/build12-upload.log`, `EXPORT SUCCEEDED`). Processing and external review completed. App Store Connect confirms **Testing** in **Public Playtest**, with tester notes saved and automatic notifications enabled. Build ID: `0de7fc0d-97ad-409d-acb5-2ce972ad699b`. Public link: https://testflight.apple.com/join/UeWBYA5n.

Scope: remaining presentation/story/gameplay wave, September 21 adversarial-review fixes, and U7 threat intensity/pinning. Brief reviewer handoff: `docs/build12-review-note.md`; tester notes: `/tmp/EmblemRogue-Build12-WhatToTest.txt`. Release changes committed locally as `7273131`; no GitHub push.

Verification: **5,686 combined tests / 342 files**, **47 distinct headed browser cases** across presentation, input, fog, hints, reload and production offline smoke; all PR simulation slices passed earlier in this review wave. Data schemas/reference/theme and 27-file parity pass. Lint zero errors (309 existing warnings); targeted U7 lint clean. Production build, Capacitor sync and archive pass. Initial browser failures were corrected test contracts/setup: trait randomness in the speed matrix, persistent teaching-note acknowledgment, configured server address, stepped-threat record/copy and keyboard frame timing. No product failure was waived. U7 lifecycle/checkpoint/RNG review found no outstanding blocker.

Logs: `/tmp/build12-final-unit.log`, `/tmp/build12-presentation.log`, `/tmp/build12-followups.log`, `/tmp/build12-u7.log`, `/tmp/build12-contracts.log`, `/tmp/build12-final-contracts.log`, `/tmp/build12-reload-final.log`, `/tmp/build12-production-smoke.log`. Physical-phone upgrade/audio/safe-area/gesture checks remain tester priorities.

## Build 11 — September 21, 2026 — Testing

Version **0.1.0 (11)** archived at `/tmp/EmblemRogue-Beta-11.xcarchive`; bundle ID/version verified. Signed upload succeeded at **00:39 Pacific** (`/tmp/build11-upload.log`, `EXPORT SUCCEEDED`). Processing and external review completed. App Store Connect confirms **Testing** in **Public Playtest**, with What to Test saved and automatic tester notifications enabled. Build ID: `4f218261-1924-471e-b4c0-f3c560235162`. Public link: https://testflight.apple.com/join/UeWBYA5n. No GitHub commit/push.

Changes: presentation/onboarding checkpoint plus escape-map visibility, stat-booster/cure use, item-description audit and art details, revival catch-up, Act 1 boss rewind reward, and Vampiric 15% rounded down. Reviewer handoff: `docs/presentation-checkpoint-review-2026-09-20.md`. What to Test: `/tmp/EmblemRogue-Build11-WhatToTest.txt`.

Verification: 5,317 unit tests, 162 harness tests, all PR full-run simulation slices, 12 latest headed item/roster/escape checks and production offline phone smoke; data/schema/theme gates and production build/Capacitor sync/archive passed. Lint zero errors with existing warnings. Physical-device upgrade/audio/safe-area checks remain tester priorities.

## Build 10 — September 20, 2026 — Testing

Version **0.1.0 (10)** archived at `/tmp/EmblemRogue-Beta-10.xcarchive`; bundle version verified. Upload succeeded at **18:09 Pacific** (`/tmp/build10-upload.log`, `EXPORT SUCCEEDED`). Processing and external review completed. App Store Connect now confirms **Testing**, assigned to **Public Playtest** with automatic tester notifications enabled. What to Test notes were saved and submitted. Build ID: `8e3d4884-cabe-4547-a141-a88d31480fbd`. Distribution was completed after the user restored the App Store Connect session.

Changes: both UX contract audits, including service/arena/caravan persistence, resolved combat/promotion presentation checkpoints, movement/Canto/rewind integrity, shared fog/status/danger rules, contextual management information, cancelable touch controls/panning, save identity/conflict recovery and verified logout backup. Arena now grants threshold skills before saving. New optional save fields are backward-compatible; no new remote telemetry. No GitHub commit/push.

Verification: **5,291 unit tests**, **109 harness tests**, all PR simulation slices, **79 headed browser cases without retries**, production offline mobile smoke; formatting, lint (zero errors, 307 warnings), data/reference/theme parity, production build/Capacitor sync and Xcode archive passed. Independent reviewers found and helped fix cloud save-loss and sleeping-resume edge cases before packaging. Physical iOS behavior remains a tester priority.

GitHub: the branch is published as [PR #64](https://github.com/virtu333/rogue-emblem/pull/64) on September 21, 2026. The first CI run failed only in `e2e-smoke`: three contract specs pinned `http://127.0.0.1:3000` while the shared Playwright server binds `localhost`, which the Linux runner resolves to IPv6. The specs now use the shared base URL, two keyboard-traversal expectations in `ui-review-regressions.spec.js` were updated to the current focus contract, and the reclass reload contract dismisses the first-battle Field notes hint before tapping the map.

Reviewer note: `docs/ui-release-review-note.md`. Implementation/evidence: `docs/ux-contract-implementation.md`, `docs/ux-supplement-implementation.md`. Final browser artifacts: `/tmp/build10-final-browser`; tests log: `/tmp/build10-final-browser.log`. Submitted tester notes: `/tmp/EmblemRogue-Build10-WhatToTest.txt`. Public link: https://testflight.apple.com/join/UeWBYA5n

## Build 9 — September 20, 2026

Version 0.1.0 (9) archived at `/tmp/EmblemRogue-Beta-9.xcarchive`; CFBundleVersion and bundle identity verified. Upload succeeded September 20, 2026 at 13:51 Pacific; App Store Connect reports **Testing**, assigned to **Public Playtest**, with automatic tester notifications enabled and 4 invitations. Build ID: `88b75d02-2753-4a7b-9858-d019ff3414ab`. Processing and external review completed. Public link: https://testflight.apple.com/join/UeWBYA5n Upload log: `/tmp/build9-upload.log`.

Changes since build 8: prevent Compendium and other DOM menu taps from reaching covered game controls; isolate the full battle sidebar, compatibility rails and recovery UI; recover a canvas mouse press released over a menu; prevent held Confirm/Back from activating multiple layers; preserve focus when a picker choice becomes unavailable. No save schema or balance changes. No GitHub push.

Verification: 5,201 unit tests; 109 harness tests; all PR simulation slices; data/reference/theme parity; production build and Capacitor sync; lint zero errors (existing warnings); 83 unique headed browser cases across the audit and corrected test reruns; production offline phone smoke passed. Physical iOS validation remains a tester priority.

Tester notes: `/tmp/EmblemRogue-Build9-WhatToTest.txt`. Reviewer handoff: `docs/ui-release-review-note.md`. Detailed evidence: `docs/input-boundary-audit.md` and `docs/compendium-input-fix.md`.

## Build 8 — September 20, 2026

Version 0.1.0 (8) archived at `/tmp/EmblemRogue-Beta-8.xcarchive` with CFBundleVersion verified as 8. Upload succeeded September 20, 2026 at 12:42 Pacific (`/tmp/build8-upload.log`, `EXPORT SUCCEEDED`). Processing and external review completed. App Store Connect reports **Testing**, assigned to **Public Playtest**, with automatic tester notifications enabled. Build ID: `d4b93bb4-fceb-44b4-9d7d-3b29d4cffd72`. Public link: https://testflight.apple.com/join/UeWBYA5n

Changes since build 7: one-tap mobile unit actions on all terrain; contextual combat action descriptions; combat-weapon restoration when staff targeting is cancelled; unavailable abilities remain visible with uses/reasons and a working Back action; approved option 1 contrast outlines across battle sprites, lighter spent-unit tint and quieter Plain terrain. The option 2 density experiment was removed. No sprite size, save schema or balance changes in this checkpoint. No GitHub push.

Verification: 5,198 unit tests, 109 harness tests, all PR simulation slices, reference/data/theme parity, lint zero errors (existing warnings), production build and Capacitor sync. Headed browser release selection: 29 unique checks passed across the main run and corrected sprite-test rerun; production offline phone smoke passed. Two stale test assertions were updated for contrast texture names and independent portrait preload. Independent adversarial review found no outstanding blockers.

Tester notes: `/tmp/EmblemRogue-Build8-WhatToTest.txt`. Reviewer handoff: `docs/ui-release-review-note.md`. Combat coverage: `docs/combat-actions-browser-review.md`. Physical-device thumb input, sprite readability, controller use and carried-over saves remain playtest priorities.

## Build 7 — September 20, 2026

Version 0.1.0 (7) archived and uploaded successfully to App Store Connect at 09:39 Pacific. Archive: `/tmp/EmblemRogue-Beta-7.xcarchive`. Upload log: `/tmp/build7-upload.log` (`EXPORT SUCCEEDED`).

**Distribution complete:** App Store Connect reports **Testing** for 0.1.0 (7), assigned to Public Playtest on September 20, 2026 with automatic tester notifications enabled. What to Test notes were submitted. Build ID: `af6f2a11-503d-47ff-91db-57ab78f9f561`. Public link: https://testflight.apple.com/join/UeWBYA5n

Changes: result-screen teardown crash and post-dialogue shutdown race; native save/resume/result/hint UI; foreground audio recovery; combat-weapon restoration after staff actions; Normal Act 1 Cavalier exclusion until a third unit has joined. No save schema change, no GitHub push.

Verification: 5,183 unit tests; 109 harness tests; PR simulations; lint (zero errors), theme/reference/data parity and production build; 15 headed recovery/progression/scene cases, full mobile run loop and offline production smoke. Independent adversarial review completed and findings fixed.

### What to Test for build 7

- Resume an existing saved battle and start another run after defeat. Save selection, resume choices and results now use the updated interface.
- Switch to another app and return with music on, and repeat with music muted. If iOS requires it, the next tap should restore audio without resetting the track or volume.
- Have Sera heal, then receive an enemy attack at a valid tome range. She should re-equip her combat weapon after the staff action.
- On Normal, early Act 1 encounters should have no Cavaliers until another unit has joined. Existing generated battle saves are unchanged.
- Report unreadable text, stuck controls, or crashes with the build number and the preceding steps.

Review handoff: `docs/ui-release-review-note.md`. Plan and visible audit: `docs/run-resume-ui-plan.md`.

## Implemented

- Touch Home Base: commander/partner portraits, unlock states, starting-skill assignments and slot limits, upgrades, Begin Run, and return navigation. Existing meta progression methods own every mutation.
- Touch battle rewards: readable choices/descriptions and explicit confirmation, with existing recipient and reward rules.
- Shop: larger rows, tabs, recipient buttons and forge choices; clipped scrolling rows and separate footer actions. Touch drags do not sell/forge or choose a recipient.
- Shared weathered palette for roster/pause/Home Base/rewards. Mobile production builds enable rebuilt battle presentation; deterministic lab maps remain development-only.
- Scene cleanup fixes for reward transitions, and mobile Cancel advances campaign dialogue.
- Local-only play remains the default. The existing first-run shortcut goes directly to the campaign; Home Base becomes available on returning runs.

## Verification

Targeted unit coverage: 353 tests across meta progression, Home Base, loot, shop, dialogue and touch activation. Mobile browser coverage: 15 tests across Home Base, upgrades, roster and a scripted campaign loop. The separate production smoke test blocks external requests and starts a battle without dev/lab query flags.

The scripted loop uses isolated save data, a deterministic shop itinerary, and a fixture to finish combat. It checks real touch commands, reward navigation, spending, equipment, next-battle navigation and local persistence. It is not a combat balance or full-campaign playtest. Native iOS Simulator launch and an existing suspended-battle resume were also checked.

Run:

```sh
npx playwright test tests/e2e/mobile-home-base.spec.js tests/e2e/mobile-upgrades.spec.js tests/e2e/mobile-roster.spec.js tests/e2e/mobile-run-loop.spec.js
npm run ios:sync
npx playwright test --config playwright.release.config.js
```

## Packaging

- Bundle ID: `com.davechen.emblemrogue`
- Version/build: `0.1.0 (3)`
- Apple team: `Y463W47P77`
- Landscape iPhone/iPad Capacitor app; assets bundled, no development server URL.
- Game app icon replaces the Capacitor placeholder.
- Uses no non-exempt encryption (`ITSAppUsesNonExemptEncryption = false`).

The first beta was archived with signing disabled at archive time, then successfully signed during the normal App Store Connect export using the account's Cloud Managed Apple Distribution certificate. Development provisioning currently has no registered device. The exported IPA is signed; the source archive is unsigned and Xcode Organizer cannot distribute it directly while its Team metadata is empty. Do not edit that metadata to bypass Organizer checks. The command-line export handles team selection using ExportOptions.

```sh
npm run ios:sync
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/EmblemRogue-Beta.xcarchive \
  CODE_SIGNING_ALLOWED=NO archive
xcodebuild -exportArchive -archivePath /tmp/EmblemRogue-Beta.xcarchive \
  -exportOptionsPlist /path/to/ExportOptions.plist \
  -exportPath /tmp/EmblemRogue-Beta-export -allowProvisioningUpdates
```

ExportOptions values: method `app-store-connect`, destination `export`, teamID `Y463W47P77`, signingStyle `automatic`, manageAppVersionAndBuildNumber `false`. Use destination `upload` after the app record exists. Increment the build number before replacing a build already accepted by Apple.

## Release history

- Build 1: upload succeeded on September 17, 2026 (verified in the Xcode upload log).
- Build 2: UI cohesion and review fixes `82db34b`; release metadata `0d5a863`.
  Archived and uploaded September 18, 2026 at 14:25 Pacific. Apple completed
  processing and approved external beta review. Assigned to `Public Playtest`,
  with What to Test saved and automatic tester notification enabled.
  Verified **Testing** in the external group after approval.
  Public link: https://testflight.apple.com/join/UeWBYA5n

## Build 2 gates

- 5,100 unit tests; 109 harness tests; all PR full-run simulation slices passed.
- Reference/data parity and theme parity passed.
- 13 mobile browser checks and production offline/style check passed.
- ESLint has zero errors (existing warnings remain).

## Build 2: What to Test

This build unifies menus, dialogue, and route-map presentation and fixes mobile
service controls, combat forecasts, keyboard navigation, and scrolling behavior.

Please focus on:

- A complete Home Base → battle → rewards → shop/equipment → next battle loop.
- Physical iPhone: Compendium search with the software keyboard open, notch/home
  indicator clearance, and normal thumb taps versus scroll gestures in Shop/Church.
- Shop, Church, Colosseum, loot sub-screens, and Advanced management: overflowing
  text, clipped rows, missed taps, and reliable Back/Close behavior.
- Combat forecast: portrait size, scrollable details, weapon switching, Cancel,
  and explicit Confirm attack.
- Resume an existing save carried over from the previous TestFlight build.
  Please do not uninstall first; progress is saved locally.
- Older phones: cold-launch time and first route-map loading.
- Desktop keyboard, if available: Home Base → Difficulty → Blessing → Node map →
  Compendium → Settings, including arrows, Enter, Escape, M, and / for search.

When reporting a problem, include phone model, iOS version, the screen/action,
expected versus actual behavior, and a screenshot or recording when possible.

## Later maintenance (not release blockers)

- Migrate compatibility palette aliases to canonical names before removing them.
- Explicitly decide whether to retain non-DOM Phaser Home Base/node-map paths as
  test fallbacks or remove them together with dependent tests.

## First tester focus

- Small phone touch targets, notch clearance, readable descriptions and scroll/selection behavior.
- First-run tutorial and returning-player loadout, skill slots and upgrade costs.
- Rewards, inventory/convoy transfers, shop buy/sell/forge, and recipient cancellation.
- Suspend, force close, relaunch and Continue; airplane-mode play and save/resume.
- Real-device audio interruptions, performance, heat and battery. These have not yet been physically tested.
- Saves are device-local; uninstalling the app can remove progress. No cloud-sync promise.

Keep map sizes and balance unchanged for this beta. Further art and menu polish should follow tester feedback.

## Git publication status

The release commits are on local `mobile-rebuild-checkpoint`. Pushing to
`virtu333/rogue-emblem` returned HTTP 403: the active GitHub CLI account
`davechenbhh` lacks write access. No merge was performed.

## Build 3 title-screen hotfix

Solid selected-button fill, separated title-menu rows, a pixel-font cursor instead
of an emoji, and repositioned sound hint. Text texture resolution is synchronized
with text style resolution for correct Canvas fallback rendering.

Validated: 5,100 unit tests; title-screen browser check at 844px and 667px widths;
visual screenshot review and touch navigation; production offline smoke passed.
Build 3 uploaded September 18, 2026 at 14:51 Pacific, approved and verified
**Testing** in Public Playtest. Hotfix notes saved; automatic notifications enabled.
Source commit: `9aeb140`. GitHub retry was blocked by automatic approval review
pending explicit destination/payload approval; the earlier account-access blocker
also remains.

## Build 4: native roster, party and rewards

Build 4 completes the rebuilt roster, deployment, recruitment and reward menus, with compact controls and unified styling.

Please test:
- Roster: promotion/reclass, skill and weapon-art scrolls, equipment, trading and convoy transfers, including full bags and blocked choices.
- Deployment and recruitment: inspect units, open/close Roster, retain selected units, skip optional recruits and reroll lord choices.
- Rewards: recipient selection, Back, forge/imbue/booster choices and both picks after elite battles. Try rapid taps and cancellation.
- Rotate with a menu open; check small-phone text, scrolling, notch clearance and the software keyboard in Compendium.
- Resume a save from build 3 without uninstalling; complete a battle-to-shop-to-next-battle loop offline.

Known behavior: closing/reloading during rewards retains the win but forfeits unclaimed loot. Saves are local to this device.

Please include phone model, iOS version, screen/action and a screenshot or recording with feedback.

Validation: checkpoint gates passed (5,117 unit tests, 109 harness tests, PR
simulation slices, parity/theme and browser suites). Independent adversarial
review found one elite reward focus issue; fixed and all six reward regressions
passed. Production offline smoke passed after iOS sync.

Distribution status: build 0.1.0 (4) uploaded successfully September 18, 2026
at 23:14 Pacific. External review submitted with Public Playtest selected and
automatic tester notifications enabled; App Store Connect reports **Testing**.
Build ID: `7b6b4e3f-fc71-488d-a81a-02ee09c3d797`.
Public link: https://testflight.apple.com/join/UeWBYA5n
No GitHub push requested or performed.

## Build 5: battle interaction and turn-start fixes

Build 5 fixes consumable and battle submenu interactions, adds native progression,
rewind and trade menus, improves reward icons/reference menus, and repairs Shop
preview and Colosseum input behavior.

A fast action during the turn banner could previously skip turn-start effects.
Player controls now unlock after effects finish, with stale-phase checks for
rewind, defeat and shutdown. Resume also protects generated text texture keys
against collisions after RNG reseeding, without changing gameplay randomness.

Validation: 5,137 unit tests across 275 files; 109 harness tests; all PR simulation
slices; data/reference/theme checks; lint zero errors (existing warnings remain);
production build and offline iPhone smoke. Final combined menu/reward/run-loop
suite: 13 passed; battle submenu phone/desktop: 9 passed. Independent review also
verified generated-text rendering/cleanup and the full save/resume loop, with no
remaining blocking findings.

Tester notes: `/tmp/EmblemRogue-Build5-WhatToTest.txt`.
Reviewer handoff: `docs/ui-release-review-note.md`.
Archive: `/tmp/EmblemRogue-Beta-5.xcarchive` (verified CFBundleVersion 5).
GitHub push skipped as requested. Physical-device playtesting remains the next
validation step for touch, controller, notch/rotation and carried-over saves.

Upload succeeded September 19, 2026 at 10:07 Pacific. App Store Connect build ID:
`41819793-220f-4d7b-b88a-af48ee8e9ac3`. Processing completed; external review submitted with Public Playtest selected
and automatic tester notifications enabled. App Store Connect reports **Testing**.
Public link: https://testflight.apple.com/join/UeWBYA5n

## Build 6: service readability and gameplay audit

Native Shop Buy/Sell/Forge and recipient confirmations replace scaled canvas
item tooltips. Church and Colosseum decision screens now use the same readable
menu kit. Battle equipment/consumable choices include stat/effect summaries.
Shop transactions/restocks and roster returns persist; promotions/revival retain
canonical costs, limits and eligibility with stale-choice checks.

Adversarial review added 35 command tests and checked economy parity, input
ownership, cleanup and save boundaries. Fixed roster/restock save gaps, combined
forge-discount cap, full-convoy recipient gating, promotion comparison details,
and arena header labels/stale callbacks. Final browser verification also caught
and fixed the staff summary's healer context.

Validation: 5,172 unit tests / 277 files; 109 harness tests; all PR simulation
slices; reference/data parity/theme gates; lint zero errors; production build.
Final phone service/submenu/progression suite 17 passed, native reward suite six
passed, complete touch run/shop/next-battle/local-resume passed, three desktop
checks passed, production offline smoke passed.

Archive `/tmp/EmblemRogue-Beta-6.xcarchive` verified CFBundleVersion 6.
Tester notes `/tmp/EmblemRogue-Build6-WhatToTest.txt`.
Coverage/plan `docs/shop-readability-plan.md`; reviewer handoff
`docs/ui-release-review-note.md`.

Arena intentionally retains save-on-Leave; persisting intermediate arena actions
also requires persisting per-visit fight/hire/XP limits. No balance/save-schema
changes. Physical-device testing remains for thumb accuracy, notch/rotation and
controller behavior. GitHub push skipped as requested.

Upload succeeded September 19, 2026 at 17:12:49 Pacific. App Store Connect build
ID: `6f7a106e-6713-4b31-a43b-5252f7a83257`. External review submitted with
Public Playtest selected and automatic tester notifications enabled. App Store
Connect reports **Testing** for 0.1.0 (6).
Public link: https://testflight.apple.com/join/UeWBYA5n
