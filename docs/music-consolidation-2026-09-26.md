# Music pass 3: consolidation report (26 September 2026)

Branch `claude/game-music-composition-vxrodt`. It is based on `main` at 80cd42d (#114),
merged in at ecb93ec. There are 53 commits. Apart from rendered audio, the diff is 54
files, +7,908 / −240. Most of it is under `tools/music/`; 17 files are outside it,
listed below.

**Status:** complete, and PRs are frozen. The full re-render (49 scores, 30 cues in every
key) is committed to this branch, with no new PR (it rides on #134), and checked (see
"Verification" below).

## What this pass adds

### 1. Six new battle themes, and how battles choose their music
- **The themes:**
  - The Iron Line (Act II elite)
  - The Consecrated (Act III elite)
  - The Emperor's Own (Act IV elite)
  - The Name Is Not Spoken (Act IV battle III)
  - What the Fog Keeps (fog-of-war maps)
  - Coin and Canvas (caravans)
- **Selection:** `src/engine/BattleMusicSelection.js` (pure) gives each act its own elite
  theme through a table keyed by act. Fog and caravan take a share of their battles
  (`THEME_SHARE`). `musicConfig.js` holds the new keys, and
  `tests/BattleMusicSelection.test.js` covers it.
- **Critique pass:** an editor reviewed all six themes and a composer applied the
  fixes. The result: stop bars that stop, tenths under the anthem, a true rest at The
  Consecrated's bar 51, and docstrings that match the code.
- **The Name Is Not Spoken:** its anthem is now the world bible's imperial drill chant.
  It had accidentally been the Emperor's anthem in minor.
- **Mix fixes:** The Name Is Not Spoken was re-mixed after a listener heard it as muddy:
  a drier hall, a thinner ostinato, and the horns' tune given room.

### 2. The palette (which sample library plays each instrument)
- **Mechanism:** `tools/music/engine/palette.py` chooses each instrument's library at
  render time. The registry in `engine/instruments.py` is now the *legacy* palette.
- **The house palette:** the game ships `HOUSE`, the result of two rounds of blind A/B
  with the owner (the "Sound Lab" artifact):
  - Sonatina Symphonic Orchestra 4: string sections, solo violin, oboe, celesta,
    choir and oohs.
  - Virtual Playing Orchestra 3: horns, trumpets, trombones.
  - Legacy (VSCO 2 CE, GeneralUser GS): everything else.
- **Per-score exceptions** (`Score.palette`):
  - the Emperor's theme keeps the legacy strings, brass and choir;
  - the village keeps its legacy fiddle;
  - the Act III map plays an unshaped violin;
  - the colosseum uses a VCSL frame drum.
- **Auditions:** any other `--palette` is an audition. It writes to
  `References/music-lab/` and never touches game assets.
- **The performer:** `engine/perform.py` is a rule-based performer for solo lines. The
  house violin and string sections use its `clean` style (no finger slides, no accent
  bite, no swell inside a note), which the owner, a violinist, asked for.

### 3. Engine fixes (every track changes when re-rendered)
- **Bass guitar at written pitch:** the Growlybass program sounded an octave below its
  keys, and E1–G#1 were silent. It now plays where written. The low end of every track
  with bass guitar changes. The two scores that worked around the silent notes no longer
  do.
- **Tuning:** off-pitch samples are corrected from a measured table
  (`tools/music/tuning.json`, written by `tunecheck.py`).
- **Onsets:**
  - Every note starts early by the time its key and velocity take to speak
    (`onsets.json`, `engine/onsets.py`), SoundFont and sfizz parts included.
  - The GeneralUser choir was about 170 ms late; it is now on time.
  - `onsets.json` is in `.prettierignore` (prettier would reflow it into thousands of
    lines).
- **sfizz renders:** they hold their samples in memory by default. Streaming could drop
  notes on a busy machine.
- **Stem cache:** a build no longer evicts other scores' stems (`--prune-cache DAYS`
  cleans the cache on request). `build.py` can also run as several processes: each one
  merges its loop and cue table entries under a file lock.
- **Percussion:** it sits 1–3 dB lower across the whole soundtrack, with less
  snare crack, duller cymbals and a gentler drum-bus compressor. This was owner feedback
  on four mixes.

### 4. Ceremony cues (game code)
- **The bug:** the owner reported the recruit card playing a click instead of its music.
  The recruit cue was loaded only when the card opened, and it took longer to load than
  the card waited. Other cues had the same gap: promotion, boss felled, arrival, rewind,
  fallen lord, eclipse.
- **The fix, in `src/utils/AudioManager.js`:**
  - every cue's file is fetched ahead whenever a track starts;
  - the common cues (level-ups, recruit, promotion, sealed, deed) are decoded ahead and
    pinned in memory; the pinning comes from main's #109;
  - a cue not decoded yet waits up to 700 ms before its fallback plays.
- **Verification:** in a browser, all eight ceremony cues sound 0–42 ms after the call.
- **The fallback sound:** `sfx_levelup.mp3` is a copy of `stinger_levelup_D.mp3`
  (#109). The stinger build now copies it, and `MusicLibrary.test.js` holds the two
  files byte-identical.

### 5. The iOS app's music
- **Where:** the TestFlight workflow gained an `ios-music` job,
  `tools/ios/compactMusic.mjs`, tested by `tests/CompactMusic.test.js`.
- **What it does:** it re-encodes every music track at LAME V6 for the app bundle
  (137 MB → 106 MB measured), to stay under Apple's 200 MB cellular download prompt. The
  web keeps the build's V4 encode.
- **When it runs:** only where a build follows, under the same conditions as the
  workflow's CI wait.

### 6. Credits and licences (owner decisions)
- **What needs credit:**
  - Sonatina 4 is CC Sampling Plus 1.0: attribution is required, and there is a
    "no advertising" clause.
  - VPO3's horns, trumpets and trombones come from CC BY-SA 3.0 / 4.0 samples.
- **Decisions taken:** the owner accepted both. The soundtrack is therefore declared
  **CC BY-SA 4.0** (the music only, not the game).
- **Where the credit lives:**
  - the help overlay's Meta tab, *Music Credits* page (`src/data/helpContent.js`);
  - `docs/music-credits.md`;
  - `tests/MusicCredits.test.js` keeps the credit in step with the palette.
- **Open question:** whether a trailer or store video counts under Sonatina's
  advertising clause is unsettled. It is flagged in the doc.
- **Not used:** VPO3's solo violin (its licence may be non-commercial).

### 7. Lore alignment
The world bible (`claude/kind-ride-yejupz`, a3c900e) was read against the score:
- Ashfall's note now reads "Night on the Hearth" (its reconciliation edit #8).
- The anthem uses the canon drill chant (see §1).
- No music text used the retired "ring" or "shattered" wording.

## After the report: pass 4 (27 September)

Committed to this branch after the freeze report, still with no new PR:

- **Four second themes**, one each for escape maps, recruit rescues, fog of war and castles,
  written by four composers, measured by an editor, and revised once:
  - *We Came This Far Also* (`battle_escape_2`, F minor): an endless Shepard–Risset climb.
  - *Quick, Quick, Quick, Slow* (`battle_rescue_2`, E Dorian, 9/8): the army adopts a
    stranger's 2+2+2+3.
  - *Out of Step* (`battle_fog_2`, D): an Imperial band off stage in 2/4 against the army's
    3/4.
  - *Every Voice at Its Post* (`battle_castle_2`, G minor): a fugue on the Empire's drill.
- **Selection by act.** `BattleMusicSelection.js`: escape and place entries may be a key, a
  pool or a table by act, like the situations, and a pool is walked by node row.
  `musicConfig.js` splits the four map types by act (the table is in SCORE.md, "Which battle
  theme plays").
- **Verified points from the external review** (`codex/soundtrack-review`):
  - `LoopedMusic.stop()` releases over 25 ms instead of cutting mid-waveform;
  - the Entity's hum tops out at 0.9;
  - Iron Rain's calm mix keeps its motor 6 dB down;
  - SCORE.md and the shrine's docstring corrected.
  - The items that need the owner to listen first are not done.
- **`palette.py`:** two VCSL candidates for the rescue's zither and darbuka (CC0, credited in
  `docs/music-credits.md`).
- **Size:** 96 music files; the iOS re-encode adds about 9 MB (about 164 MB app).
- **Gates:** the unit suite (7,666), lint, format, `check:reference`, `check:data-parity`,
  build and `sim:fullrun:harness:pr` all pass.

## Files outside `tools/music/` (check these for conflicts)

| File | Change |
|---|---|
| `src/utils/AudioManager.js` | stinger prefetch; minimum wait; merged with #109's pinning |
| `src/utils/musicConfig.js` | new battle keys, per-act elite table, `STINGER_PRELOAD` (+ recruit, promotion) |
| `src/utils/musicLoops.js` | generated by `build.py`; never hand-edit |
| `src/engine/BattleMusicSelection.js` | elite by act, fog, caravan |
| `src/data/helpContent.js` | a *Music Credits* page added to the **Meta** tab (the tab bar is full at 10) |
| `.github/workflows/testflight.yml` | `ios-music` job; `build` needs it (merged with #104/#105's validate/status modes) |
| `tools/ios/compactMusic.mjs`, `tools/pwa/offlineCachePolicy.js` | the app's music encode; a comment count |
| `tests/*` | BattleMusicSelection, CompactMusic, MusicCredits, MusicLayerCache (a stub), MusicLibrary, Stingers |
| `CLAUDE.md` | Music section: palette, selection, iOS bullets, counts |
| `docs/music-credits.md`, this report | new |
| `.prettierignore` | `tools/music/onsets.json` |

**Binary assets:** `assets/audio/music/*.mp3`, `assets/audio/stingers/*.mp3`,
`assets/audio/sfx/sfx_levelup.mp3` and their `public/` copies. If `main` changes any of
them before this merges, don't resolve binaries by hand. Take this branch's copies and
re-run `npm run sync-assets`, or re-render with `python3 tools/music/build.py`.

## Verification

Done:
- Music unit tests: BattleMusicSelection, MusicLibrary, MusicLayerCache, Stingers,
  CeremonyMusic, GrowthCeremonyController, BattleMusicController, CompactMusic,
  MusicCredits.
- Full unit suite before the last merge: 7,479 of 7,481 pass (see known issues for the
  other two).
- Every changed score passes its form check (no bar where nothing sounds). Semitone lint
  counts are before/after-checked, and every intended clash is named in its docstring.
- The credits page was screenshotted at 640×480 and in phone landscape.
- The ceremony cues were probed in a real browser session.

After the render (committed to this branch, no new PR):
- All 88 music files, 142 cues and `sfx_levelup.mp3` were re-rendered and synced to `public/`.
  Every loop-table entry matches its file's decoded length. The level-up fallback is
  byte-identical to its cue.
- The full unit suite passes: 7,660 of 7,660, in 470 files.
- The gates pass: `check:reference`, `check:data-parity`, `lint`, `format:check`,
  `sim:fullrun:harness:pr` ("All runs passed"), and `npm run build`.
- Size: the web build (`dist/`) is 185 MB, of which music is 131 MB. The iOS app's music
  re-encodes to 105 MB, putting the app at about 155 MB, under Apple's 200 MB cellular
  prompt.
- One score needed a fix mid-render: The Consecrated's hymn trumpets went above their
  range after the critique pass (694415b). Every score was then checked for
  out-of-range notes; none remain.

## Known issues and open items

- **`tests/sim/RunSimulationDriver.test.js`** failed once mid-pass (it also failed with
  this branch's `src/` and `tests/` reverted). It passes in the final full run, so treat
  it as intermittent in `main`.
- **The first full-suite run** also failed `MusicLayerCache` › "nothing is refetched",
  because the new prefetch tripped its fetch log. The test's stub is fixed and it passes
  now.
- **Muted brass:** VPO3 has no mutes, so muted brass notes still play VSCO samples
  (`keep_arts`). This is intended, but it is a mixed-library seam.
- **`violins2`** sets `tune_cents=4`, which the sampler never reads. This is
  pre-existing, and it doesn't matter while `violins2` plays Sonatina.
- **Library setup:** `bash tools/music/fetch_libraries.sh` fetches about 11 GB into
  `References/music-libs/`. A full render also needs `sfizz_render` and FluidSynth.
- **Cache size:** stems are about 0.5–1 GB per score with the house palette. A full
  `--all` build on a small disk needs `--prune-cache`, or deleting each score's stems
  after it exports.
- **Deferred:** a web "mixing desk" (per-part faders and notes), and bringing in the MIDI
  exporter from `claude/music-kit-midi-generation-qbyeyi`. Both were proposed; the owner
  hasn't decided.

## Suggested review order

1. `src/utils/AudioManager.js` and `tests/Stingers.test.js`: runtime behaviour players
   hear.
2. `src/engine/BattleMusicSelection.js`, `src/utils/musicConfig.js` and their tests:
   which track plays.
3. `.github/workflows/testflight.yml`: the iOS pipeline.
4. `src/data/helpContent.js` and `docs/music-credits.md`: the licence obligations.
5. `tools/music/` last: offline tooling, no runtime effect beyond the files it writes.
