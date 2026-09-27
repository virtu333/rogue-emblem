# Handoff: the anime opening's reference images (local session)

For a Claude Code session on the owner's machine. The cloud session that planned the
opening can't read the owner's disk, so this job is to sort a large local folder of
GPT-image references, commit a curated, prepared set, and write down what's missing.
The cloud session builds the animation from what you commit, and the owner reviews
each commit.

- **Source folder (local only):** `~/Downloads/anime-op-reference`, many images.
- **Repo:** `~/Documents/rogue-emblem`.
- **Branch:** `claude/kind-carson-97sgvj` (pull it first; push there, no PR).
- **Commit trailer:** as your session's attribution rules say.

## What the opening is (read this before judging images)

**"Again"**: a TV-size anime opening (about 1:30) over *Under the Broken Sun*, the
battle theme (branch `claude/anime-op-broken-sun`,
`tools/music/scores/battle_broken_sun.py`: 150 bpm, E minor, a bar is 1.6 s, 56 bars).
It has no vocals: a J-rock band with lead guitar, and the choir.

The story is one run of the game. The opening plays forward, Edric falls, Sera
rewinds it, and it lands back on the night before. The title comes in the silence
at the end.

| Bars (s) | Music | Picture |
|---|---|---|
| 1–4 (0–6) | Band hits, then the Empire drill in unison | One-frame flashes (an eye, a hilt, the gold thread, the black sun); Empire boots stamping |
| 5–12 (6–19) | The Thread melody on lead guitar | The camp on the night before; the Thread across the sky; Edric rises. Logo on the turn into 13 |
| 13–20 (19–32) | Verse; the choir chants the drill underneath | Cross-cut: our army (cast cards) against the Empire marching in lockstep; the cuts shorten until the lines meet |
| 21–28 (32–45) | Half time; bar 28 a hit and a snare roll | The seers: Sera's eyes, then the Lieutenant's, mirrored. Officers and the Emperor. On the roll: white, rushing down the Thread |
| 29–44 (45–70) | Chorus, sung by the choir | The charge with the black sun behind Edric; Sera's thread fraying; Edric falling on the hits in different places (ford, bridge, fens, stair); the army at first light; he falls, the frame freezes and cracks |
| 45–48 (70–77) | The hymn, the choir almost alone | Stillness drained to violet, Sera's hands on the thread, the opening's own frames drifting backwards |
| 49–52 (77–83) | Band crashes back | The rewind speeds up, stuttering back through every shot to the camp |
| 53–56 (83–90) | Climb to the leading tone, the band cuts, three beats of silence | Edric at the fire looks up at camera. The black sun; ROGUE DAWN |

**How it will be animated** (so you know what makes a useful image): there is no
video model. Each still becomes a layered **cut-out puppet** or a **pan plate**, and
code does the motion: camera moves, parallax, hair and cloak on springs, blinks, mesh
warp for breath and wind, particles (ash, embers, the Thread), speed lines, smears and
impact flashes. Everything is then pixel-converted to 480×270 in the game palette, as
in `tools/cutscene/glass/` (The Far Side of the Glass). So what matters in an image:

- **Big, clear silhouettes and flat, readable colour.** Fine detail and painterly
  texture are lost at 480×270.
- **Layerability:** a character on a plain or green background beats one baked into a
  busy scene.
- **Room to move:** tall or wide plates with space for the camera to travel.
- **Anatomy the code won't have to fix:** held poses, not mid-action tangles.
- **On-model:**
  - Edric: shaggy chestnut-brown hair, deep teal cloak, one steel pauldron.
  - Sera: long wavy crimson hair, purple seer robe with a gold cross.
  - The rest: check the PC-98 portraits in `public/assets/portraits/pc98/192/`.
- **Art bible:** `docs/art-direction/ART_BIBLE.md`. No skulls, spikes, glowing runes or
  grimdark decoration. The gold thread is the only warm light. The black sun is the
  Hollow Sun, a black disc with a thin gold ring.

## The job

### 1. Catalogue everything

Look at every image in the source folder, not a sample. For each, record:

| Field | Values |
|---|---|
| file | original filename |
| kind | `plate` (background or pan), `character` (one figure), `group`, `closeup` (eyes, hands, hilt), `strip` (multi-panel motion), `fx` (thread, sun, smear, impact), `key` (a finished composed shot) |
| subject | who or what, in a few words |
| beat | which row(s) of the table above it could serve, or `none` |
| verdict | `use`, `maybe` or `reject` |
| why | one line: on-model? silhouette? layerable? artefacts (extra fingers, melted armour, text, logos)? |
| size | pixel dimensions |

Write it as `docs/art-direction/anime-op/catalog.md`, a table sorted by beat and then
verdict. Add `catalog.json` with the same rows, for code. Be strict: a `maybe` must
say what would fix it.

### 2. Commit a curated set, prepared

For each `use` (and the strongest `maybe` where a beat has nothing better):

- `refs/<beat>_<subject>.webp`: a lossy WebP at quality about 88, longest side at
  most 1920 px. Keep the original aspect ratio and don't crop yet. Descriptive
  snake_case names, e.g. `refs/b29_charge_edric.webp`, `refs/b45_sera_hands.webp`.
- **Characters:** also `cutouts/<name>.png`, with the background removed (rembg:
  `pip install rembg`, then `rembg i in.png out.png`; fix halos by hand or with a 1 px
  alpha erode). If the figure cleanly separates into layers (hair, cloak, arm with
  weapon), note the suggested split in the catalogue, but don't hand-cut layers yet.
  The cloud session does that once the rig design is settled.
- **Pixel preview:** run a few of the best through the existing converter to show
  how they survive at game size:
  `python3 tools/cutscene/glass/pixel.py <name> --still <image> --preview 0 --colors 28`.
  It writes a 4× PNG to `References/cutscene/glass/px_preview/`. Copy the results to
  `docs/art-direction/anime-op/px/`. Needs python3 with numpy, opencv-python, scikit-image.
- **Budget:** keep everything you commit under this folder at about 40 MB total.
  Originals stay local. `References/` is gitignored, so don't put committed files
  there.

### 3. A contact sheet

Make `docs/art-direction/anime-op/contact.jpg`: every `use` and `maybe` thumbnail in
beat order, labelled with its filename and verdict, at most about 3000 px wide. Make
more sheets if needed. This is what the owner will look at first.

### 4. The gap list

Write `docs/art-direction/anime-op/gaps.md`: for each row of the table above, what we
have and what is missing. Then draft **GPT image prompts** for the missing pieces, in
the style of these examples:

> **Cut-out:** 1990s TV anime opening cel, hard two-tone shading, thick clean ink
> lines, limited palette. Lord Edric (attached reference: shaggy chestnut-brown hair,
> deep teal cloak, one steel pauldron, longsword low in his right hand) sprinting
> straight toward the camera, low angle, cloak streaming behind, determined face.
> Full body, centred, on a flat pure #00FF00 green background, no ground shadow, no
> text. 1024×1536.

> **Tall pan plate:** 1990s TV anime background painting, dusk. Bottom: an ash-grey
> battlefield with broken spears and a torn blue banner half-buried. Middle: dark
> hills and a line of distant enemy torches. Top: a huge black sun ringed by a thin
> gold corona in a bruised violet sky, ash falling. Composed for a slow vertical tilt
> from the ground up to the sun. No people, no text. 1024×1536.

> **Three-frame strip:** Three panels side by side, identical framing: close-up of a
> young woman's hands (attached reference Sera: purple sleeves, pale skin) holding
> one glowing gold thread pulled taut. 1: the thread is whole. 2: fibres fray at the
> centre, her fingers tighten. 3: half unravelled, strands lifting like hair,
> knuckles white. Dark background, 1990s anime cel, hard shading, no text. 1536×1024.

Say which PC-98 portrait to attach as reference for each prompt. Prefer layer-friendly
requests: a figure on green, a plate with no people, a closeup on a dark field.

## Commit in small, reviewable steps

1. **`Anime opening refs: catalogue and contact sheet`**: `catalog.md`,
   `catalog.json`, `contact.jpg`. Push, and stop so the owner can review the
   verdicts before you prepare files.
2. **`Anime opening refs: curated set`**: `refs/`, `cutouts/`, `px/`.
3. **`Anime opening refs: gaps and prompts`**: `gaps.md`.

Run `npx prettier --write` on the markdown and JSON before committing, since CI checks
formatting. Don't touch game code, `data/`, `public/` or `tools/cutscene/glass/`.

## What not to do

- Don't commit the whole folder or any full-size originals.
- Don't try to animate or build the player. That's the cloud session's next step,
  once these land.
- Don't redesign the characters. Where images disagree with the portraits, the
  portraits win. Flag the disagreement in the catalogue.
