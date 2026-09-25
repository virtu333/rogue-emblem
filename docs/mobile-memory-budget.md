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

## Traced sprites and PC-98 portraits (the art the game loads now)

Since 2026-09-24 the battlefield draws **traced map sprites** by default and the
portraits are the **PC-98 set**, so neither rebuilt set is loaded in normal play:

- **Traced sprites** (`tools/art/sprite-trace`, `docs/art-direction/sprites-v3/`): every
  class × faction, the lords and the bosses — 335 sprites × 6 frames — are trimmed and
  packed into two ≤ 2048 px atlas pages (`assets/sprites/traced/`, ~0.8 MB of PNG,
  **25 MB decoded**). Each sprite registers as its own texture whose frames borrow the
  page's `TextureSource`, so the pages are the only pixels in memory (no per-sprite
  canvases). The tracer reads its references from `docs/` (class sheets, candidates,
  `docs/art/rebuilt-sprite-sources/`), never from `assets/`.
- **Rebuilt sprites** load only with the dev switch `?spriteArt=rebuilt` (baked 64/128 px
  files, as above).
- **PC-98 portraits** (`assets/portraits/pc98/`, 2.8 MB) are rendered at their display
  sizes by `tools/art/pc98` from the full-size originals, which now live in
  `docs/art/rebuilt-portrait-sources/` (not shipped). `assets/portraits/rebuilt/` keeps
  the 512 px copies for the dev switch `?portraitArt=classic`.
- `tests/RebuiltArtBudget.test.js` also guards the traced atlas (pages only, ≤ 2048 px,
  < 40 MB decoded, no sprite above 3× its display size, sources outside `assets/`) and
  the PC-98 set (figures at their display size, < 6 MB, sources in `docs/art/`).

Measured (production build, throttled iPhone-13 profile, `tools/art/sprite-trace/dev/measure-boot.mjs`,
decoded texture pixels counted once per source):

Median of three cold-cache runs each, interleaved (CPU 4× slowdown, 12 Mbps, 60 ms RTT,
844×390 @3×). "Before" is the branch head before the traced default and this merge
(rebuilt sprites from their 1254 px sources); "after" is this branch.

| | Before | After |
| --- | --- | --- |
| Boot → Title | 28.3 s | 6.3 s |
| Transferred by Title | 61.3 MB | 6.5 MB |
| Decoded textures at Title | 227.7 MB (rebuilt sources 216.0) | 35.9 MB (traced pages 25.0, portraits 8.2, other 2.7) |
| JS heap at Title | 23.9 MB | 29.1 MB |
| Decoded textures in a battle | 237.1 MB | 45.3 MB (traced pages 25.0, portraits 10.8, other 9.5) |
| Transferred by the first battle | 69.8 MB | 17.4 MB |
| Travel → units on the map | 0.7 s | 0.8 s (noise: 0.5–1.2 s both ways) |

Against the memory branch alone (baked 64 px rebuilt sprites, ~1 MB), the traced pages
add about 24 MB decoded — the price of every class, faction, lord and boss with six
frames each. They load at boot so battles never wait on them; loading them on the first
battle instead would take them off the Title/map screens but not off the battle peak.

### Re-measured against main (2026-09-25)

Same probe and profile, three cold runs each; "main" is `origin/main` at `ef8027d`
(rebuilt sprites drawn from their 1254 px sources, portraits uncapped), "branch" is
`claude/traced-sprites` after the lord / boss redraws (the atlas stays two pages,
24.8 MB). The machine was shared with other agents (load ~45 on 4 cores), so the
timings are only comparable with each other; the decoded bytes do not depend on load.

| | main | branch |
| --- | --- | --- |
| Boot → Title (median) | 31.8 s | 11.9 s |
| Transferred by Title | 62.5 MB | 5.2 MB |
| Decoded textures at Title | 229.0 MB (rebuilt sources 216.0, portraits 8.2, other 4.0, rebuilt canvases 0.8) | 37.0 MB (traced pages 24.8, portraits 8.2, other 4.0) |
| Decoded textures in the first battle | 241.3 MB (rebuilt sources 216.0, portraits 13.6, other 10.9) | 45.7 MB (traced pages 24.8, portraits 10.8, other 10.0) |
| Transferred by the first battle | 68.0 MB | 17.9 MB |
| Travel → units on the map (median) | 2.1 s | 2.3 s |
| JS heap at Title / battle | 24.6 / 30.5 MB | 26.8 / 27.7 MB |

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
- **Oversized sheets still shipped.** `assets/sprites/nodes/weathered-nodes.png`
  (1254 px, 6.3 MB decoded, loaded for the node map) and the `assets/terrain/weathered/`
  sheets (1254–1536 px, loaded only by the weathered terrain dev switch) are sources
  whose frames are drawn at tile size; they should be baked like the battle sprites.

Done since: the unused files that shipped under `assets/` (the `*_raw.png`
generations, `sprites-v1/`, the tileset backups, and two sprites nothing loads —
356 + 2 files, ~127 MB) moved to `docs/art/raw-sprites/`, `docs/art/sprites-v1/` and
`docs/art/unused-sprites/`, with their `public/assets/` copies removed.
`tools/process_tiles.js` reads the tile generations from there.
`tests/RebuiltArtBudget.test.js` fails on raw / backup names or a retired sprite set
anywhere under `assets/`.

## Memory probe

Build (`npm run build`), serve (`npx vite preview --port 4190`), then in the
page (Playwright with an iPhone profile, or devtools):

```js
const g = window.__emblemRogueGame;
let tex = 0, audio = 0;
const seen = new Set(); // traced sprite textures share their atlas page's source
for (const k of g.textures.getTextureKeys())
  for (const s of g.textures.get(k).source)
    if (!seen.has(s)) {
      seen.add(s);
      tex += s.width * s.height * 4;
    }
for (const k of g.cache.audio.getKeys()) {
  const b = g.cache.audio.get(k);
  if (b?.numberOfChannels) audio += b.length * b.numberOfChannels * 4;
}
console.log({ textureMB: tex / 1e6, decodedAudioMB: audio / 1e6 });
```

Measure at Title, then after playing a few long tracks
(`g.registry.get('audio').playMusic('music_boss_final_3', scene, 0)`).
