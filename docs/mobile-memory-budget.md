# Mobile memory budget (iOS)

iOS kills the WebContent process (the game silently reloads to Title) when it
grows too large. On 3–4 GB iPhones the safe ceiling is well under 1 GB. This doc
records what was measured, what the `claude/memory-texture-budget` branch
changes, and the rules any new art or audio should follow.

## Measured baseline (production build, iPhone 13 profile, 2026-09-24)

| Source | Decoded memory | Why |
| --- | --- | --- |
| Rebuilt battle sprite sources | 226 MB | 36 PNGs at ~1254 px, each only drawn into a 64×64 (entity 128×128) texture at boot, but kept loaded all session |
| Rebuilt portraits | 182 MB | 29 PNGs at 1254×1254, displayed at most 88×104 CSS px |
| Music | 129–197 MB per long track | `AudioManager` decodes whole MP3s to float PCM; mobile caches 3 tracks, so ~500 MB in Act 3 / final boss |
| Everything else (tiles, UI, legacy art, SFX) | ~20 MB textures + ~10 MB SFX | fine |

Worst case: ~930 MB. Texture memory = width × height × 4 bytes per loaded
image, whatever the PNG file size. WebGL also holds a GPU copy.

Measure with the probe at the end of this doc.

## What the branch changes (textures, ~410 MB → ~35 MB)

1. **Bake the rebuilt battle sprites offline.** `tools/bakeRebuiltSprites.mjs`
   renders each non-`texture` manifest entry into its final tile-centred
   64/128 px PNG, using the same nearest-neighbour math as the runtime
   `drawImage`. It matches Chrome's render pixel for pixel on 33 of 36 sprites,
   and differs by 7 pixels in total. The full-size sources move to
   `docs/art/rebuilt-sprite-sources/`, which is not shipped. `preloadRebuiltSprites` loads the baked
   files straight into `rebuilt-<key>`. Manifest entries with `texture` (small
   class sprites) keep the runtime canvas path. The shipped folder goes from
   29 MB to 168 KB. `npm run bake:sprites` regenerates it; `npm run
   check:sprites` (in CI) fails if a baked file is stale.
   The placement math lives in `src/ui/rebuiltSpritePlacement.js` so the tool
   and the runtime share it.
2. **Cap rebuilt portraits at 512 px.** `tools/shrinkRebuiltPortraits.mjs`
   (lanczos3, alpha kept, idempotent) cuts each portrait from 6.3 MB to 1 MB
   decoded (34 MB → 12 MB on disk). The largest on-screen portrait is 88×104 CSS
   px (dialogue), about 312 device px on a 3× phone.
3. **Stop re-encoding portraits for the DOM.** `textureImageSource` used
   `canvas.toDataURL('image/png')` on the full decoded image (128–462 ms of main
   thread per portrait). `retainPortraitDownloads(loader)` keeps the downloaded
   Blob for `portrait_*` / `rebuilt-portrait-*` keys, and the DOM gets an object
   URL of it. It still works offline and after Phaser revokes its own URL.
4. **Guards.** `tests/RebuiltArtBudget.test.js` checks every baked sprite has
   its final size and keeps its source, that no shipped rebuilt sprite exceeds
   64 KB, and that every rebuilt portrait is ≤ 512 px.
   `tests/TextureImageSource.test.js` covers the Blob path.
   `tests/e2e/character-art.spec.js` asserts the roster portrait is a 512 px
   blob.

Verified: full unit suite, the character-art and mobile-roster e2e specs, and
a before/after screenshot diff of the same seeded battle. Only the
mid-animation phase banner differed.

## Rules for new or regenerated art

- **Ship art at the size it is drawn, not the size it was generated.** Budget
  = display size × device pixel ratio (3 on iPhone), rounded up to a
  comfortable power of two. A 1254 px source for a 38 px sprite is ~1000×
  waste.
- **Never keep a large image loaded only to crop or scale it at runtime.** Do
  that step offline (bake) and commit the result; keep sources under `docs/art/`
  (or `References/`), not `assets/`.
- **Anything under `assets/` ships** (it is copied to `public/assets/` and
  into the iOS app). Raw generations, `_raw.png` files and backups should live
  elsewhere.
- **Keep the guards green.** If new sprites or portraits are added, extend
  the manifests, run `npm run bake:sprites` /
  `node tools/shrinkRebuiltPortraits.mjs`, and let
  `tests/RebuiltArtBudget.test.js` enforce the budget. If the art pipeline
  changes so these tools no longer apply, replace them with an equivalent
  budget check rather than deleting it.

## Not done yet

- **Music streaming (largest remaining win, ~500 MB).** Play music through
  an `HTMLAudioElement` routed via `AudioContext.createMediaElementSource` →
  `GainNode` → destination, instead of `decodeAudioData` into the Phaser cache.
  That way:
  - Memory stays a few MB.
  - Volume and fades still work on iOS, where `HTMLMediaElement.volume` is
    read-only.
  - `AudioManager`'s public API (`playMusic`, `stopMusic`, `releaseMusic`,
    `setMusicVolume`, ownership, request sequencing, fades) stays the same.

  Watch for:
  - iOS needs each media element's first `play()` inside a user gesture.
    Unlock two reusable elements (for crossfades) during the existing audio
    unlock, then swap `src`.
  - Pause the elements on `visibilitychange` (the `audioRecovery.js` hooks).
  - SFX stay on decoded Web Audio.
- **Unused assets in the bundle (~150 MB).** 206 `*_raw.png` files (~131 MB),
  `sprites-v1/` (14 MB), and tileset backups ship under `assets/` but are never
  loaded. Move them out of `assets/` (and remove the `public/assets/` copies)
  after confirming each is unreferenced; dynamic keys make grep alone
  insufficient.

## Memory probe

Build (`npm run build`), serve (`npx vite preview --port 4190`), then in the
page (Playwright with an iPhone profile, or devtools):

```js
const g = window.__emblemRogueGame;
let tex = 0, audio = 0;
for (const k of g.textures.getTextureKeys())
  for (const s of g.textures.get(k).source) tex += s.width * s.height * 4;
for (const k of g.cache.audio.getKeys()) {
  const b = g.cache.audio.get(k);
  if (b?.numberOfChannels) audio += b.length * b.numberOfChannels * 4;
}
console.log({ textureMB: tex / 1e6, decodedAudioMB: audio / 1e6 });
```

Measure at Title, then after playing a few long tracks
(`g.registry.get('audio').playMusic('music_boss_final_3', scene, 0)`).
