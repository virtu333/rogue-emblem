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
   stingers and SFX references. All audio consumers resolve URLs through
   `audioAssets.js`, including the login element and Phaser loaders.
2. **Music and stinger fetches verify bytes before decoding.** A portable SHA-256
   verifier works without `crypto.subtle`. Decoded music buffers carry recording
   identity in a shared WeakMap. An unverified cache entry is removed and loaded
   again. A fetch/decode failure never retries through a path that bypasses the
   verifier. HTML audio and the non-Web-Audio Phaser fallback use immutable URLs;
   the build checks their packaged bytes.
3. **Adaptive layers share an authored timeline and one clock.** Primary music
   must have valid declared loop metadata. Optional layers require verified
   identity, the primary's declared group and valid loop geometry. Invalid layers
   leave the primary playing. Crossfades and late attachment preserve the existing
   playhead. Loopless layers must have periods within one sample rather than
   250 ms, preventing cumulative drift.
4. **Offline playback uses exact versions.** Audio uses `CacheFirst` in
   `er-audio-assets-v2`, with 800 entries, 60-day expiration and quota eviction.
   Hashed URLs cannot match legacy recordings. An unwarmed version is unavailable
   offline. The existing prompted worker activation, image policy and saves are
   preserved; this change does not clear origin storage.
5. **Hash the bytes actually shipped.** Desktop builds use source recordings.
   TestFlight passes `ER_MUSIC_ASSET_DIR` containing the already compacted music
   into the build before Vite compiles the manifest. The exact logical track set
   and final packaged digests are checked before Capacitor sync. Original audio
   sources are never overwritten. Duplicate unversioned audio is removed from
   the final package to preserve the compact application's size benefit.
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
  packaged digest. Development also generates fresh staging at startup.
- To build the compact profile, run the existing `tools/ios/compactMusic.mjs`
  first, then `ER_MUSIC_ASSET_DIR=<compact-dir> npm run build`. The compactor
  checks each re-encode's decoded sample count against its source.
- Restore the desktop manifest with `npm run build:audio` before committing a
  compact-profile experiment.

## Regression coverage

| Requirement | Coverage |
| --- | --- |
| Reject different bytes with identical length | AudioAssets integrity test |
| Missing references or inconsistent groups fail | AudioAssets catalog tests |
| Final compact bytes determine URL; source stays intact | AudioAssets packaging and CompactMusic workflow tests |
| Invalid primary stops; invalid layer leaves primary | AudioManagerLayers and LoopedMusic tests |
| No unverified cache or decode fallback bypass | AudioManager and MusicLayerCache tests |
| Existing ownership, memory budgets and handoff survive | AudioManagerLayers, MusicLayerCache, Stingers and battle-entry browser tests |
| A returning install ignores one or both stale layers | Production `audio-upgrade.spec.js` with real previous-policy/current Workbox workers and native Web Audio decoding |
| Warmed exact versions work offline; legacy-only version fails | Production upgrade browser test |
| Intro, repeated wraps, crossfades and late layer stay aligned | Native OfflineAudioContext pulse regression, within one sample |

The production upgrade fixture uses a different valid shipped recording in the
legacy cache rather than downloading historical assets during CI. It checks
recording hashes and native decoded buffers. The timing fixture is synthetic and
tests scheduling, not the artistic alignment within authored recordings.

## Deployment boundary

This change stages the current generation only. Retaining previous immutable
audio generations on the server remains a hosting concern. A still-open old build
requesting an uncached recording after deployment may receive a 404 and remain
silent; it must never be redirected to a newer recording. Warmed browser cache
entries remain usable until expiration or eviction. The fix takes effect when
the player accepts the existing prompted application update.

Browser validation in this change uses desktop Chromium. Safari and an actual
iOS/Capacitor device still require a device smoke test; compact-byte package
verification does not substitute for that check.
