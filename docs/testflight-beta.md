# Mobile beta release

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
- Version/build: `0.1.0 (2)`
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
- Build 2: UI cohesion and review fixes committed as `82db34b`. Packaging in progress;
  processing and external testing availability must be verified in App Store Connect.

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
