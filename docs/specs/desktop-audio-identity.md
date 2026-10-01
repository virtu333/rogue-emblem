# Desktop audio identity and adaptive layers

## Problem

The pre-fix service worker serves audio through `StaleWhileRevalidate` under
stable filenames. The soundtrack replacement in PR #80 reused battle filenames.
A returning player can therefore decode a historical placeholder while running
current game code. Full/calm recordings are cached independently, so they can also
come from different releases. Duration and loop geometry cannot identify a
recording.

The investigation reproduced that stale response using the historical
`music_battle_act1_2.mp3` from commit `1e6c3661e2e910a048ac536120cb2dbc44bedd35`.
The existing shared Web Audio clock was already correct for compatible layers;
ordinary clock drift with the current shipped recordings was not established.

## Behavior and implementation

1. **A build selects exact recordings.** `tools/buildAudioAssets.mjs` generates a
   bundled manifest containing each logical key, SHA-256, physical hashed URL and
   declared timeline group. It validates music, adaptive/enrage/finale pairs,
   stingers and SFX references. Game audio resolves URLs through `audioAssets.js`;
   Vite injects just the login recording URL into its classic HTML script.
2. **Music and stinger fetches verify bytes before decoding.** Native
   `crypto.subtle.digest` is preferred, with a portable SHA-256 fallback for
   WebViews where it is absent or unusable. Decoded music buffers carry recording
   identity in a shared WeakMap. An unverified cache entry is removed and loaded
   again. A fetch/decode failure never retries through a path that bypasses the
   verifier. HTML audio and the non-Web-Audio Phaser fallback use immutable URLs;
   the build checks their packaged bytes.
3. **Adaptive layers share an authored timeline and one clock.** Primary music
   must have valid declared loop metadata. Optional layers require verified
   identity, the primary's declared group and valid loop geometry. Invalid layers
   leave the primary playing. Crossfades and late attachment preserve the existing
   playhead. Loopless layers must have periods within one sample rather than
   250 ms, preventing cumulative drift. A replacement voice is constructed and
   started before stopping the current voice; a constructor/start failure preserves
   its owner and layers instead of introducing silence.
4. **Offline playback uses exact versions.** Audio uses `CacheFirst` in
   `er-audio-assets-v2`, with 800 entries, 60-day expiration and quota eviction.
   Hashed URLs cannot match legacy recordings. An unwarmed version is unavailable
   offline. The existing prompted worker activation, image policy and saves are
   preserved. Only the legacy `er-audio-assets` cache is deleted on activation,
   never while the new worker is waiting. Other caches and saves are preserved.
5. **Hash the bytes actually shipped.** Desktop builds use source recordings.
   TestFlight passes `ER_MUSIC_ASSET_DIR` containing the already compacted music
   into the build before Vite compiles the manifest. The exact logical track set
   and final packaged digests are checked before Capacitor sync. Original audio
   sources are never overwritten. Web builds retain unversioned audio paths for
   old tabs during the transition release. Only TestFlight opts into removing
   duplicates with `ER_PRUNE_LEGACY_AUDIO=1` to preserve the app's size benefit.
6. **Failures are inspectable.** `await window.__emblemDumpAudioDiag()` reports
   the manifest revision, current keys/owner/intensity, recording hashes, loop
   geometry, shared start time, voices and worker state. AudioManager retains at
   most 64 recent load/rejection/start events. No player data is collected.

## Asset workflow

- Run `npm run build:audio` after changing audio or its declared loop/group
  configuration. Commit `src/utils/AudioAssetManifest.json` with those changes.
- `npm run check:audio` checks that committed manifest without rewriting it. CI
  runs it before the desktop build.
- `npm run build` stages immutable assets, bundles the manifest and checks every
  packaged digest. Vite's `configResolved` hook generates development staging
  before the public-directory snapshot, including a clean `npx vite` startup.
  `vite preview` serves the existing build without regenerating its manifest.
- To build the compact profile, run the existing `tools/ios/compactMusic.mjs`
  first, then `ER_MUSIC_ASSET_DIR=<compact-dir> ER_PRUNE_LEGACY_AUDIO=1 npm run build`. The compactor
  checks each re-encode's decoded sample count against its source.
- Restore the desktop manifest with `npm run build:audio` before committing a
  compact-profile experiment.

## Regression coverage

| Requirement | Coverage |
| --- | --- |
| Reject different bytes with identical length | AudioAssets integrity test |
| Missing references or inconsistent groups fail | AudioAssets catalog tests |
| Final compact bytes determine URL; source stays intact | AudioAssets packaging and CompactMusic workflow tests |
| Invalid primary is rejected; invalid layer leaves primary | AudioManagerLayers and LoopedMusic tests |
| No unverified cache or decode fallback bypass | AudioManager and MusicLayerCache tests |
| Existing ownership, memory budgets and handoff survive | AudioManagerLayers, MusicLayerCache, Stingers and battle-entry browser tests |
| A returning install ignores one or both stale layers | Production `audio-upgrade.spec.js` with real previous-policy/current Workbox workers and native Web Audio decoding |
| Warmed exact versions work offline; legacy-only version fails | Production upgrade browser test |
| Waiting old clients can load legacy URLs; only legacy audio cache is removed on activation | Production upgrade browser test |
| Intro, repeated wraps, crossfades and late layer stay aligned | Native OfflineAudioContext pulse regression, within one sample |

The production upgrade fixture uses a different valid shipped recording in the
legacy cache rather than downloading historical assets during CI. It checks
recording hashes and native decoded buffers. Offline verification refuses every
connection at the test origin, including service-worker fetches; it does not rely
on a browser-context offline toggle. The timing fixture is synthetic and
tests scheduling, not the artistic alignment within authored recordings.

## Deployment boundary

This transition release retains the legacy web paths, so tabs still running
pre-manifest code can load an uncached recording before accepting the update.
Future releases that replace hashed recordings still need hosting retention of
previous immutable generations for old tabs. Hashed URLs must never redirect to
different recordings. Warmed browser cache
entries remain usable until expiration or eviction. The fix takes effect when
the player accepts the existing prompted application update.

Browser validation in this change uses desktop Chromium. Safari and an actual
iOS/Capacitor device still require a device smoke test; compact-byte package
verification does not substitute for that check.

## Prefetch scope

The stinger catalog contains 142 recordings across keys, but each music start
prefetches one recording per cue in the current key: 30 cues. Its 48-entry compressed
cache holds that set, and repeated same-key prefetch reuses those bytes. Switching
through enough different keys can still cause bounded LRU eviction. Native hashing
reduces verification work without weakening recording identity or expanding the
mobile memory budget.
