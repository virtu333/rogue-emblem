# "The Roll": the opening cutscene

Status: **draft 1, rendered** (2026-09-27). Source in `tools/cutscene/hook/`.
It replaces the pilot prologue ("The Night Before", `tools/cutscene/pilot/`) as the
candidate for cutscene 2 in [cutscenes.md](cutscenes.md). The pilot was a history
lesson on the title theme and read as too cryptic; this is a hook.

## The hook in one paragraph

A girl braids her mother's hair by the fire. Both have their names written beside
them in gold. There is a knock. A clerk of the Empire opens a ledger and writes the
mother's name in red, and she comes apart into red thread from the top down. The
girl is left braiding air, and she can't remember what she's missing. *When the
Empire writes your name, the world forgets you.* The names are read into a pit at
the heart of the capital, under a black sun. Then the quill writes **EDRIC**. At a
river at night a young man watches his hand begin to fray, and a woman catches his
wrist. The thread pulls taut. *"Not this time."* She has watched him die here
thirty-one times, and every time she pulls the thread back to the night before:
the roguelike loop, in the fiction, in one image. Then the march: a tactical grid
snaps over the world, one hero per bar, the Roll's red levy struck through; *lose
who you must*; *remember every name*; the army's names brighten the corona of the
Hollow Sun. Black. The ring is drawn in one stroke. **ROGUE DAWN.** *Take back every
name.*

What it answers in two minutes: what this world's evil is (it erases people), what
the player is (the one name the Roll could not keep), why death repeats (Sera), what
the game is (a tactics march with an army you keep or lose), and what you are
fighting for (names). What it keeps back: what the dark under the capital is, why
the sun is hollow, who the Emperor is, what Sera pays.

## The look

Nothing is shown as generated footage. Every figure is **rotoscoped**: a Veo clip
is generated from a lit keyframe, traced into polygons, and redrawn by our own code
as engraved ink. The generated video is scaffolding for motion, anatomy and camera,
as live action is under a rotoscope. The viewer only ever sees the drawing.

- **Ground:** near-black paper with a 12 fps grain.
- **Figures:** a dark body with a boiling rim line; midtones engraved as hatching,
  lights as flat ink, ink lines over everything lit. Drawings change on twos (12 fps).
- **Palettes carry meaning:** gold is a name someone holds (the hearth, Sera, the
  heroes); red is the Roll (the clerk, the ledger, the mother once she is written,
  the enemy); night blue is Edric alone; mist is loss; dusk is the capital and the
  march under the Hollow Sun.
- **One thread runs through all of it:** the first thing drawn (on the four notes of
  the Thread motif), then the mother's braid, then the red threads she comes apart
  into, then Edric's fraying, the string pulled taut at the grab, Sera's branching
  sight, the grid of the tactical map, and finally the ring of the Hollow Sun.
- **Two faces:** Cinzel capitals, set and slammed on hits; Cormorant Garamond
  italic, written glyph by glyph, for names and speech. Words sit inside the picture
  (names annotate figures with a hairline), not in subtitles.
- **Camera:** the drawings are vectors, so push-ins, reframes and rewinds are free
  and stay sharp.

## Beat sheet

Times are from the score (`cues.json`); the score was written for this picture.

| Bars | Time | Music | Picture | Words |
|---|---|---|---|---|
| 1–2 | 0:00 | Celesta: the Thread cell (A-D-E-A), a high held A | Black. A gold thread draws itself through the four notes | *Every name is written down.* |
| 3–6 | 0:04 | The lullaby, 3/4, harp and soft strings | The hearth (gold): a girl braids her mother's hair; a drawn fire | *Maren*, *Wren* annotate them in gold |
| 7–9 | 0:13 | The lullaby climbs to the leading tone | Close on the hands in the hair | |
| 10 | 0:19 | **Three knocks** on the downbeat where D should be | Black; a red crack of light widens with each knock | |
| 11 | 0:21 | The Empire's drill (trombones, celli), drone | The clerk in the doorway (red) | |
| 12 | 0:25 | The eclipse bell; pizzicato ticks on the Empire's semitone | The ledger (red); the quill | *Maren* written in red |
| 13 | 0:29 | Tremolo cluster, reverse swell, choir | The mother turns red and comes apart top-down into red thread; the girl is left braiding air | *Maren* struck through |
| 14 | 0:33 | The girl hums the lullaby and loses the note | Wren looks at her empty hands | *When the Empire writes your name,* |
| 15 | 0:37 | **Boom** | Black | **THE WORLD FORGETS YOU.** (the letters erode away) |
| 15–16 | 0:39 | Choir and horns: the drill; taiko heartbeat; riser | The capital (dusk): rings of black stone round a pit, the Hollow Sun; red threads from everywhere pour into the pit | *They read the names into the dark.* |
| 17 | 0:45 | **Hit**: boom, timpani, low brass, the bell | The ledger | **EDRIC** stamped in red |
| 18 | 0:48 | Tremolo, riser, heartbeat | Edric at the river (night) staring at his hand; it frays into red thread | *Edric*, gold, turning red letter by letter |
| 19 | 0:52 | **The grab**: a hit, then one held violin A | A hand catches his wrist; a gold string snaps taut and rings | *Edric* turns gold again. **Sera:** *Not this time.* |
| 20–23 | 0:55 | Sera's Thread theme; harp | Sera opens her eyes; a thread forks from her eye, again and again; 31 branches end in red crosses, one runs on | **Sera:** *I have watched you die here thirty-one times.* / *Every time, I pull the thread back to the night before.* |
| 23 (b. 3) | 1:07 | The rewind: the Thread backwards | Everything runs backwards; the branches retract | |
| 24 | 1:09 | Accelerando, 72 → 120 | The thread snaps flat; a grid builds on the taiko hits | |
| 25–26 | 1:11 | The Old Kingdom horn call; drums | Kira at the war table under the grid | **GATHER WHO YOU CAN.** · KIRA *Tactician* |
| 27–31 | 1:15 | The Thread theme at full drive, one hero per bar | Rowan's charge, Astrid's dive, Cael's shield, Voss's shot, Sera's light | Each name and class |
| 32–33 | 1:25 | The theme's end | Edric locks blades with a levy soldier (red half of frame) | EDRIC *Lord*; the Roll's levy numbers struck through |
| 34 | 1:29 | The leading tone, unresolved | The seven names in a column | |
| 35–36 | 1:31 | Drums out; soft strings; the thread, alone | A helmet in the river at dawn (mist) | **LOSE WHO YOU MUST.** |
| 37–39 | 1:35 | The horn call, everyone; the dominant | The column on the ridge under the Hollow Sun; names rise over the riders; each brightens the corona | **REMEMBER EVERY NAME.** |
| 40 | 1:41 | **Tutti hit**, then silence | White, then black | |
| 41–44 | 1:43 | B-flat major 7 with the high A; the bells' A-G-E, and no D | The ring of the Hollow Sun drawn in one stroke on the Thread cell | **ROGUE DAWN** · *Take back every name.* |

## Lore it adds or bends

The bible (PR 119) is in flux; these are the edits the cutscene assumes. None
touches a Tier III fact.

1. **Being fed means being forgotten**, visibly and at once. The bible already has
   feeding as "someone else spends a name"; this makes the cost concrete: when your
   name is read into the dark, the people who loved you lose you. The body is left
   (Maren is gone from Wren's memory, not killed). This is the hook, so it is stated.
2. **Edric's name is on the Roll.** The court circle has entered the heir; Sera's
   thread is what holds his name to him. It gives the "you" of the game a personal
   stake from the first minute, and explains why the Empire's feeding and the
   March's clock are the same clock.
3. **Thirty-one.** Sera's count of Edric's deaths at the Ford (the bible's "ten
   turns of the weave" was a lower bound; the new number reads as a veteran player's
   death count). The branching graphic has exactly 32 leaves: 31 crosses and one
   thread.
4. **Maren and Wren**, a mother and daughter of the Marches (new, minor). The
   capital's pit is the Hearthstone's reading-floor, seen from above.
5. **Heroes' classes** are shown as they are in game (Tactician, Chevalier, Sky
   Lancer, Sentinel, Ranger, Light Sage, Lord), so the montage reads as a roster.

## How it is made

```
shots.mjs ──► gen.mjs --keys ──► keyframes (Gemini 3 Pro Image, lit for the tracer)
                     │
                     └─► gen.mjs --clips ──► Veo 3.1 clips (image-to-video)
                                                   │
score.py ──► music.py ──► the_roll.mp3 + cues.json │
                              │                    ▼
                              │         trace.py ──► traces/*.json.gz (polygons, 12 fps)
                              ▼                    │
                     roll.js (timeline) ◄──────────┘
                     trace.js (ink) · fx.js (thread, fire, grid, sun) · type.js (words)
                              │
                     render.mjs --piece hook ──► MP4 (frames are a pure function of t)
```

- **Keyframes** are prompted for the tracer, not for beauty: one hard warm key
  light, black falloff, a rim, uncluttered silhouettes. Lord portraits are passed
  as identity references; a keyframe can reference another keyframe for continuity
  (Wren's close-up from the hearth), and a keyframe can be an edit of another
  (the empty hearth is the hearth with the mother removed, so the framing matches
  exactly and the unravel can composite the two).
- **Tracing** (`trace.py`): IS-Net foreground matte per frame (rembg); tone
  thresholds from percentiles of the whole clip's figure luminance, so tones hold
  still while the line boils; ink lines from a difference of Gaussians after local
  contrast equalisation; glow from the brightest light; optional simplified
  background tones. Polygons are simplified and delta-encoded.
- **Score** (`score.py`): composed in the game's own engine (`tools/music`), so
  every hit is where the picture needs it, and the cue sheet is exact.
- **Iteration loop:** contact sheets of every shot's first and last frame, stills
  at the hits, an audio critique (`tools/music/listen.py`) for glaring problems,
  and per-bar loudness to check the dynamic arc.

Costs for draft 1: 18 keyframes plus 5 regenerations (Gemini 3 Pro Image, 2K),
18 Veo clips (Veo 3.1 for the slow shots, Veo 3.1 Fast for the action), about
100 s of generated video. The traces are about 8 MB; the audio is 2 MB.

## What is not done

- It plays offline only (the dev player and exporter). The in-game player, skip,
  seen flags and reduced motion are slice 1 of [cutscenes.md](cutscenes.md).
- The trace data is big for shipping (about 8 MB); a shipped version would trim
  each trace to the frames it uses and quantise harder.
- Faces are traced, not drawn: at close-up the likeness depends on the clip.
