# iOS development setup

## Current setup

- Capacitor 8.5.2 with Swift Package Manager; Xcode 26 or newer and Node 22 or newer.
- Native project: `ios/App/App.xcodeproj`.
- App name: Rogue Dawn (was Emblem Rogue; `appName` in `capacitor.config.json`, `CFBundleDisplayName` in `Info.plist`). Bundle ID: `com.davechen.emblemrogue` — unchanged by the rename, and must stay so the App Store Connect record, TestFlight builds and on-device saves carry over.
- Version 0.1.0, build 1; landscape on iPhone and iPad, full screen.
- The app packages `dist` locally. No live website URL is configured.
- David Chen selected as the signing team using Xcode.

## Development workflow

```sh
npm ci
npm run ios:sync
npm run ios:open
```

`ios:sync` builds the web game and copies it into the native project. Run it after web changes. It does not archive or upload the iOS app. In Xcode choose a simulator for initial testing.

Offline play and local saves are now the explicit defaults for both web and iOS. The game skips login and never creates a Supabase client unless the build explicitly sets `VITE_CLOUD_ENABLED=true` and provides both Supabase values. Credentials alone do not enable cloud behavior. Existing local save keys and formats are unchanged; no saves or account data are cleared.

For an intentionally cloud-enabled build only, configure `.env.local` using `.env.example` and enable that flag before syncing. Never put a Supabase service-role key in a Vite environment variable.

Local saves belong to this app installation (or this browser origin on the web). They do not sync between devices or between browser and native app. Deleting app data or uninstalling can remove them; there is no new cloud backup or export feature in this pass. The iOS app bundles game media and the pixel font. A browser still needs an initial online visit to obtain the app and cache assets; the packaged iOS game does not.

Commit the native sources, Capacitor config, and dependency lockfile. The generated native `public` bundle and per-user Xcode state are ignored by `ios/.gitignore`.

## Saves on iOS (closing the app, storage eviction)

Saves stay in `localStorage` (3 slots: `emblem_rogue_slot_{n}_meta/run`, plus settings) on every platform, written synchronously when a change applies: battle checkpoints after every action, shop buys/sells/forges, church services, reward claims, node travel, every roster-sheet change (equip, store, withdraw, give, scroll, weapon-art bind, reclass/promotion, accessories), settings and meta. Two iOS-specific layers sit on top (`src/utils/saveLifecycle.js`, `src/utils/nativeSaveMirror.js`):

- **Lifecycle flush.** When the page is hidden (`visibilitychange`), torn down (`pagehide`), frozen (`freeze`), or the app resigns active / pauses (Capacitor App `appStateChange` / `pause`), the route map saves its in-memory state — only while the stored run is still the one this session last wrote, so a stale browser tab never overwrites a newer save or resurrects an ended run — and pending native writes are dispatched (on every signal of the burst). A swipe-kill from the app switcher always follows backgrounding. Battles are not re-saved here: they are checkpointed after every resolved action, and a free change inside a turn (moving without acting, an equip swap) can revert on resume, as before.
- **Native mirror.** WKWebView keeps `localStorage` in WebKit's website-data store; iOS can evict it under storage pressure, and a kill can drop WebKit's last unflushed writes. With the Filesystem plugin present, every `emblem_rogue_*` key written to `localStorage` is copied to `Library/emblem-rogue-saves/` (backed up with the device, never evicted) — debounced 0.6 s (at most 3 s), deletions immediately, and flushed on backgrounding. Each key is double-buffered (`<key>.a.txt` / `.b.txt`, header with sequence number and length). The plugin's `writeFile` is not atomic (and its `rename` deletes the destination first), so the buffer holding the newest complete record is never written: every write, including overlapping ones, goes to the other buffer, which becomes the newest only once the last write in flight succeeds — a torn or failed write keeps the previous copy. Before the game boots the copy is read back: if `localStorage` lost its sentinel key (evicted) every mirrored key is restored and deleted keys stay deleted; otherwise only a strictly newer run/meta save (by its monotonic `savedAt`) replaces the local copy, and a key missing locally is never resurrected. A read-back that fails or takes over 2.5 s boots without mirroring for that session, so it can never overwrite the native copy with a fresh-looking store; a folder that exists but cannot be listed counts as a failure, never as empty. After an eviction the sentinel is only re-set once every mirrored save is back: a save that could not be read or written back (quota) keeps its native copy and is restored on a later launch instead of being taken for a deletion.
- **Migration.** The first launch with the mirror copies the existing saves to native storage; nothing is moved or deleted. Web builds have no native bridge and never start the mirror.
- **Native wiring.** `@capacitor/app` and `@capacitor/filesystem` are dependencies so `cap sync` adds their Swift packages to `ios/App/CapApp-SPM/Package.swift` (checked in, identical to the generated file). The game calls them through the injected bridge (`Capacitor.nativePromise` / `addListener`) and bundles none of their JS. After pulling: `npm ci && npm run ios:sync`, then let Xcode resolve packages (Filesystem pulls `ion-ios-filesystem`). Without the native plugins everything above is feature-detected off.
- **Quota and save size.** WebKit's `localStorage` quota is about 5 MB per origin, counted in bytes of the stored strings (two per character once a save holds non-Latin-1 text such as the `→` in battle history). Measured in a 21-unit battle: a suspended-battle run save is ~0.45–0.65 M characters, of which the optional rewind timeline is up to 512 K (snapshots ~0.1–0.15 M, per-row board previews ~0.2–0.25 M, frame archive ≤128 K); a route-map run save is ~17–60 K. Three slots with suspended battles can therefore fill the quota. Every run and meta write goes through `setItemFreeingSpace` (`src/engine/SaveSpace.js`): on a quota error it sheds the *other* slots' optional history in stages — frame archives, then rewind points before their current turn, then their whole timeline (their battles still resume from the checkpoint) — and retries. The slot being written degrades its own battle history through `persistWithTimelineFallback` (archive → earlier turns → timeline). Only when nothing optional is left does the save report `quota` (the route map then says “storage full”).

## Outstanding before device distribution

On 2026-09-15 Xcode selected the David Chen team but Apple returned: “You are not allowed to perform this operation.” No matching development provisioning profile was available. Check active paid membership, any outstanding agreements, and team permissions in the Apple Developer account. No archive or upload was attempted.

Finalize the bundle ID before the first App Store Connect record. Replace the Capacitor template icon and launch screen with the game's approved assets. Verify appropriate status bar/safe-area behavior, privacy declarations and cloud configuration before a release.

## Mobile design pass (proposed)

The old iOS and mobile-control specs are historical drafts. The current source already includes mobile side controls, inspect actions, camera gestures, safe-area CSS and viewport tests. Treat the actual implementation as the baseline.

### 1. Prototype one complete battle interaction

Keep landscape and the pixel-art battlefield initially. Put the selected unit summary, movement/action choices and combat forecast in a responsive UI that does not shrink with the game canvas. Prefer direct tap selection, a visible cancel action and clear confirmation before committing attacks or ending a turn. Keep inspection available through an explicit control; long press can remain a shortcut. Distinguish camera drag and pinch from unit selection so releasing a gesture cannot accidentally commit an action.

Code evidence: `index.html` uses 9px mobile button labels; `BattleScene.js` has many 8–12px canvas labels. The 640x480 canvas shrinks on phones, further reducing effective text size. Existing side buttons have 48px minimum dimensions, but this does not guarantee usable canvas menus.

Acceptance: select a unit, inspect enemies, move, compare weapons, attack, cancel, and end a turn without keyboard input. Test on a small landscape iPhone and a larger phone; controls and text must remain readable without zooming the UI.

### 2. Extend the visual system

Use the battle prototype to establish readable type, consistent touch targets, selected/disabled states, clear faction and danger indicators, and coherent icons. Current controls use Unicode/emoji icons, whose appearance varies by platform. Revisit portraits, sprites, effects and terrain only where real-device testing shows legibility problems; decide broader art direction with the user before generating replacements.

Apply the same patterns to roster, inventory, shops, home base and save-slot flows. Dense information can use scrollable sheets and progressive disclosure.

### 3. Native reliability and release checks

- Verify music and effects after app backgrounding, interruptions and device lock.
- Verify saves across app restart and upgrade; browser localStorage is separate from native app storage. On device: background the app mid-battle and mid-shop, swipe-kill it, relaunch; and with Settings → General → iPhone Storage → Offload/low-storage conditions, confirm the native mirror restores (startup telemetry `save_mirror_restore`).
- Test offline boot and configured cloud login/sync independently.
- Audit the PWA service-worker update prompt for the packaged native environment.
- Profile memory and frame rate; the source media currently totals about 235 MB.
- Review dependency audit findings separately before release; installation reported 21 advisories including one critical, without a force upgrade.

## Validation performed

Web build and Capacitor sync succeeded; Xcode resolved capacitor-swift-pm 8.5.2 and opened the native target. An unsigned Debug build for the iOS simulator compiled successfully and launched through the tutorial. The rebuilt iPhone 17 Pro simulator app was visually checked in landscape: tutorial controls and the battle command panel remain clear of the camera cutout, and tutorial prompts say “Tap to continue.” Physical-device execution and TestFlight distribution have not yet been validated.


## Battle prototype and desktop preview

The first mobile battle implementation is in `src/ui/MobileBattleHUD.js` and `src/ui/mobileBattle.css`. It reuses scene actions and the existing combat forecast. Desktop still uses the original canvas controls. See `docs/mobile-review-backlog.md` for the remaining mobile work and review proposals.

Run the development server and open `/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1` for an explicitly labeled mobile preview on a Mac. This preview flag is gated by Vite development mode and is unavailable in production builds. A mouse can select and activate controls; actual multi-touch gestures still need touch-device testing.

Phone interaction tests: `npx playwright test tests/e2e/mobile-battle-hud.spec.js`. The initial implementation passed the full 5,064-test unit suite and desktop scene-transition tests. Input-copy changes have separate targeted coverage. Test logs live in the working task directory.

## Roster and inventory mobile pass

`MobileRosterSheet` provides read-only battle inspection and between-battle roster management. `RosterInventory` guards transfers and item use through existing engine operations. The world-map view supports equip, store, withdraw, healing and accessories; promotion/scroll/trade screens remain accessible through Advanced management. The 15 mobile browser tests, 5 inventory guard tests and 47 existing roster tests passed; the updated simulator build compiled successfully.

Native roster verification: iPhone 17 Pro landscape inspection and equipment sheets remain clear of the camera cutout. Portraits now render from decoded game textures, avoiding revoked loader URLs; the regression test passes.

## Visual refinement and local-play validation

The mobile roster and battle/forecast panels share `mobileTheme.css`: deep navy, sharp borders, gold selection/title accents, restrained pixel typography, HP bars and the existing stat colors. Short headings use the bundled Press Start 2P font; body and action text remain readable. The PWA shell now precaches the font files and no longer fetches Google Fonts.

Validation: 332 targeted unit tests and 16 browser tests passed, including a local save/reload with external requests blocked, explicit cloud opt-in behavior even when credentials exist, roster transfers, small-phone scrolling and battle confirmations. Production web build, Capacitor sync and iOS simulator compilation succeeded.

Final native check: the bundled pixel font renders correctly from startup, and the themed battle and roster panels, HP bars, portraits and stat colors remain clear of the iPhone 17 Pro camera cutout. Font readiness has a bounded fallback so it cannot block startup indefinitely.
