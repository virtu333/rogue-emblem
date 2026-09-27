# Cutscenes — "The Thread, Seen"

Status: **plan** (2026-09-27). Nothing here is built yet except the pilot in
`tools/cutscene/` (see [The pilot](#the-pilot)) and a first draft of a new opening,
**"The Roll"** ([cutscene-the-roll.md](cutscene-the-roll.md)): a hook that replaces
the pilot's history-lesson prologue, in a new rotoscoped ink style on its own score;
and a second candidate, **"The Far Side of the Glass"** ([cutscene-far-side.md](cutscene-far-side.md)):
a narrated story trailer told by the Lieutenant, in pixel art traced from anime cels.

Rogue Dawn has no cutscenes. Its story reaches the player as a dialogue box over an
act card, a boss card, and a run-end band. This spec decides which cutscenes to
add, when they play, what they feel like, and how to make them. It is built on:

- the world bible in PR 119 (`docs/lore/` on `claude/kind-ride-yejupz`), which is
  stale only in item names (see [Canon source](#canon-source));
- the art bible (`docs/art-direction/ART_BIBLE.md`) and the assets it produced;
- the score (`tools/music/SCORE.md`), which is composed in code, so every bar's
  time is known exactly;
- a survey of the narrative code (hooks listed in [Where they attach](#where-they-attach));
- two public Claude-made music videos: JohnHeibel/PDoomVideo (p5.brush, storyboard
  by lyric, contact-sheet review) and mexicat/pdoom-video (three.js, cuts computed
  from measured beats, type inside the image). Lessons in
  [What we take from the music videos](#what-we-take-from-the-music-videos).

---

## The idea in one paragraph

The world's physics is names. The Dawn spent her name; the empire feeds names to the
thing under the ground; the finale's choir is the names coming back. So the
cutscenes are **a history book being read aloud by the music**: painted PC-98 plates
from the same pipeline as the Historia and the blessing cards, moved by
deterministic code in time with the game's own score, with the words written into
the picture in three hands (ceremony capitals, spoken lines, and a pen for found
texts). One gold thread runs through every one of them, as it runs through the
UI: Sera's sight, the player's agency. The picture never resolves the Hollow Sun
until the music resolves D, which happens once in the whole game. And the true
ending finishes the Last Pages' broken sentence *not with words but with the names
of the player's own army*, because saying everyone's names together is the only
thing in this world that works.

---

## Principles

1. **A roguelike repeats; a cutscene must earn its second viewing.** Every cutscene
   has a *full* form (first time on a save) and a *brief* form (every later time, a
   few seconds, usually one plate and the existing lines). A setting chooses
   Auto / Full / Brief / Off. On a repeat Normal run, forced cutscene time is under
   30 seconds, all of it skippable.
2. **Found, not told** (bible 09). The cutscenes show places and things; people say
   little. No narrator. Text is sparse: an in-world document, a line of liturgy, a
   character's line from `dialogue.json`. Nothing explains the cosmology.
3. **Tier III stays sealed** (bible 01 § Hidden canon). A cutscene may *point at* a
   sealed fact by juxtaposition, never state it. The finale choir is never called
   the freed names; the old kingdom's name is a silence, never a word; Sera's long
   name never appears. Earned facts (Tamlin) appear only in their earned moment.
   Tests enforce the strings ([Tests](#tests)).
4. **One medium.** Painted plates (PC-98 treatment, the art-bible palette), traced
   map sprites, PC-98 portraits, procedural light. No raw generated video on screen,
   no smooth AI morphs, no sub-pixel drift on pixel art, no text baked into art.
5. **The music is the clock.** Cuts land on bars and beats taken from the score, not
   from seconds typed by hand. If a cue is re-scored, the picture follows.
6. **Reactive where it matters.** The endings and the Lieutenant's approach use the
   save: who marched, who fell, who killed you before. A pre-rendered video can't
   do that, which is one of the reasons these are rendered live.
7. **Presentation only.** Like the ceremonies: never touch game state, RNG, saves
   (except the seen flag), or checkpoint timing; never replay on resume; tap to
   advance, hold or Skip to leave; reduced motion shows stills with cuts; Instant
   speed means Brief.

---

## The vibe

**Illuminated chronicle, SNES/PC-98 era.** Think of the opening narrations of 16-bit
tactics games and PC-98 adventure intros: a still painting, slow parallax, fire and
water that move by palette cycling, words that arrive one line at a time, a hard cut
on a drum hit. Melancholy, warm at the centre, dark at the edges. Never an anime
opening: no speed-line montage, no characters posing at the camera.

### Visual grammar

| Element | Rule |
|---|---|
| Frame | A 21:9 plate (640×272 art pixels) in the 4:3 game frame, with ink bands above and below for type. On phone landscape (about 2.16:1) the plate nearly fills the screen. |
| Camera | Integer art-pixel pans, parallax between 2–4 layers, pushes by whole-pixel scale steps. No rotation, no 3D turns. Camera moves ease *into* downbeats. |
| Life | Palette cycling for water, fire, torches, the Glass, the corona (free and true to the era; the plates are already indexed PNGs). Raster distortion for heat and the Glass (SNES HDMA-style line offsets). Embers, ash and gold motes on the art-pixel grid. Figures animate "on twos" (8–12 fps). |
| Cuts | Hard cuts on downbeats. **Dither dissolves** (ordered-Bayer, not alpha) for time passing. **Thread match-cuts** for chapter changes: the gold thread in one shot becomes the river, the rope on the Loom, a line of writing. |
| Light | The art bible's key light: low, warm, upper left. Your people carry light; the empire carries none. |
| The Hollow Sun | Black disc, thin gold corona, in every sky. It fills **once**: in the true ending, on the resolved D. |

### Colour arc

Ember gold only for names held and for the player. Crimson is the Roll's ink.
Verdigris is names kept by others. Unlight violet is what the Sleeper has swallowed.
Across the whole set, the palette walks the name gradient: Ember Dusk (Act I) →
Iron Rain → Bleached Rite → Ashfall (night) → the Deep, then back to gold once.

### Typography: three hands

| Hand | Face | Used for |
|---|---|---|
| Ceremony | Cinzel (already shipped), capitals, ≥14 px | Act and chapter titles, names in the Roll of the March, the game's name |
| Speech | the body face, as the dialogue box uses | Lines from `dialogue.json`, portrait optional |
| The pen | a book face (italic) written stroke by stroke; red ink for the empire | Found texts: the Oath, the First Pages, the Edict, the broadsheet, Voss's ledger, names on the Roll |

The pen is what makes this set its own. Names are *written* (gold), *entered* in the
Roll (red), *struck through* (a red line drawn on a beat), and, when a boss falls,
*un-struck* (the line withdrawn). The same gesture carries the whole story.

### Visual leitmotifs, paired with the score's

| Score motif | Picture |
|---|---|
| The Thread (A-D-E-A) | The gold thread. Where it is drawn during a Thread statement, its curve follows the melody's pitch contour. |
| The Hollow Sun (climbs, stops) | The corona. It brightens with the phrase and gutters on the missing note. |
| The Old Kingdom horn | Firelight widening; banners lifting; the pen writing an oath. |
| The Empire drill | Crimson columns in step; red ink; a stamp coming down on the beat. |
| The Lieutenant (a tritone shadow, a beat late) | The image doubled: a crimson ghost of the frame one beat behind. |
| Unlight (the hum) | Colour drains toward violet; raster ripples on the hum's pulse; slices of the image drift apart (as the Entity's boss card already does). |
| The Eclipse bell | A bell swings. No answer: the next beat is still. |

### What makes it look generated (banned)

Adapted from ClaudeAnimationBase's checklist and pdoom-video's "not slop" rules:
glows and gradients laid over the pixel art; plates morphing into each other;
letters or runes inside generated art; lords' faces regenerated per shot (plates
show figures small, from behind or in silhouette; faces come from the approved
portraits); every element moving at once, crowds moving in sync; reads that are over
before they land ("fast actions, slow meanings"); hard cuts everywhere, or a
cutscene that just starts and stops; a different world in every shot with nothing
linking them; the sun whole anywhere but the one place.

---

## The cutscenes

Fifteen, in six kinds. Lengths are the full form.

| # | Id | Kind | When | Full | Brief |
|---|---|---|---|---|---|
| 1 | `cold_open` | Myth | First launch on a device, before the title; afterwards the title's attract mode (60 s idle) | ~50 s | — |
| 2 | `prologue` | History | First run on a save slot | ~2 min | — |
| 3 | `again` | The loop | Every later run start | ~8 s | ~5 s |
| 4 | `road_act2` | Passage | Act I → II | ~25 s | ~6 s |
| 5 | `road_act3` | Passage | Act II → III | ~25 s | ~6 s |
| 6 | `road_glass` | Passage | Act III → final (Normal) | ~25 s | ~6 s |
| 7 | `road_shut` | Passage | Act III → IV (Hard, Lunatic) | ~25 s | ~6 s |
| 8 | `road_stair` | Passage | Act IV → final (Lunatic) | ~25 s | ~6 s |
| 9 | `approach_lieutenant` | Approach | Before the Lieutenant | ~20 s | card only |
| 10 | `approach_emperor` | Approach | Before the Emperor | ~20 s | card only |
| — | *(the Entity)* | Approach | *Deliberately none.* Its card's silence is the cutscene. | | |
| 11 | `end_normal` | Ending | Normal victory | ~45 s | ~10 s |
| 12 | `end_hard` | Ending | Hard victory | ~45 s | ~10 s |
| 13 | `end_true` | Ending | Lunatic victory | ~90 s | ~20 s |
| 14 | `roll_of_the_march` | Epilogue | After every ending | scales with roster | same |
| 15 | `thread_cut` | Defeat | Run lost | ~7 s | ~3 s |

Later, once the bible's systems exist: **earned vignettes** staged on the
battlefield with traced sprites (Names Returned, *Tamlin*, the Unopened Order, the
crown in the Wend). They use the same player (see [Later](#later-earned-vignettes)).

### 1 · Cold open — "Before Her"

*Deep time. Plays over the title's own intro and hands off into the title screen.*

| Read | Picture | Words (the pen, First Pages) |
|---|---|---|
| Nothing | Black. A single held high note (the title's thread A6). | *Before her, nothing came next.* |
| The answer | One gold point opens in the black; warmth spreads into a flat marsh. | *She asked the dark a question, and the dark had no answer, so she was the answer…* |
| The Starfall | Bells A-G-E: three gold lights fall, then a shower of them. The Spending plate (a kneeling figure of light, the pool opening, dragons lying down in a ring). | — |
| The price | The pool goes black and still. | *…she had nothing left to give but her name, and she paid it out.* |
| The rim | Tilt up to the sky: the Hollow Sun forms, disc first, corona last. | *Look up. The rim is what is left.* |
| Hand-off | The sun holds; the plate dissolves into the procedural title key art (`hollowSun.js`) at the same screen position: a match cut into the title. | — |

### 2 · Prologue — "The Night Before"

*History, O 1 to S 34, in two minutes. First run on a slot, before the Act I card.
The first-run fast path (`firstRunFastPath.js`) goes straight to the route map, so
the prologue plays there.*

The title theme's form tells this story almost bar for bar, which is why the pilot
uses it as the temp score (a dedicated cue can replace it later, keeping the marks):

| Bars (title theme) | Music | Read | Picture | Words |
|---|---|---|---|---|
| 1–4 | Drone, the held thread, bells A-G-E | The Spending (a short reprise of the cold open) | Spending plate | *Before her, nothing came next.* |
| 5–12 | Solo violin: the Thread | The seers find her sight in the Glass | The Hallow: ring of stones, black mirror water, bell posts. The gold thread is drawn across the water, following the violin's contour. | *The fen children looked into the water and saw what had not happened yet.* |
| 13–20 | Horns: the Old Kingdom call | The Oath at the Ford (O 1) | Ford plate: barrow-lords knee-deep, a horn raised, torches | The Oath, one line per two bars, in gold: *The strong serve the weak. / Every name is kept. / The crown is a debt, and the king pays first. / What sleeps is not woken, and what wakes it is not suffered.* |
| 21–24 | Tutti: the Thread, hollow | Six centuries; the Seat (S 0) | Hearth plate: the mountain city, crimson lamps, ash | The Edict, in red: *Every soul within the Empire shall be entered in the Roll.* then *WHAT IS, REMAINS.* stamped |
| 25–27 | Tutti climbs, tempo slows | The Unsworn Night | Unsworn plate: the circle reading red scrolls, one man kneeling | Red ink writes names down a scroll; each is struck through on a beat, faster as the tempo falls |
| 28 | **The hole**: a silent bar | The kingdom's name is spent | Black. One red stroke through an empty line. | *(nothing)* |
| 29–32 | The dark returns; celesta Thread | Thirty-four years on: the warband by the ember | Night Before plate: seven round a fire above the Ford, the burned hall on the bluff | The broadsheet, stamped: *A ROGUE DAWN IN THE WEST.* Then **ROGUE DAWN** in Cinzel. Then the existing `runStart` lines take over and the Act I card follows. |

Bar 28 is the sealed fact the bible says can only ever be shown as "a line, a held
breath, a bell". The score already has the silence; the picture gives it the line.

### 3 · "Again" — the loop

*Every run after the first. The existing `runStart` variants (they already react to
how the last run ended) stay the words; this gives them a picture.*

The Night Before plate, the fire low. The gold thread runs back into frame *from the
place the last thread was cut*: its frayed end carries the colour of what cut it
(crimson for a boss, violet for the Entity), and a knot forms at the fire. The
`runStart` and `runStartCommander` lines play over it. After a victory the thread
arrives whole and a second strand lies beside it: the cloth thickening.

Possible pointer at sealed fact 4, for players who look: after many runs on a slot,
the novice roll open beside Sera shows *SERA* with a smudged tail after it. Never
more than that, never a letter of the rest.

### 4–8 · The road down — act passages

*The name gradient made visible. Each passage ends on the existing act card (ACT n ·
region · grade), which becomes the last frame, and the existing transition lines
play over it.*

| Id | Title | What we see |
|---|---|---|
| `road_act2` | Numbers | The Marches' named river and ford give way to the Roads. A mile marker counts down to the Seat. A roadside sign's old village name is painted over with a province number. Crimson levy columns march in step to the Empire drill. The Iron Rain grade washes in. |
| `road_act3` | The words thin | A shrine board: its letters fade one at a time ("the paint didn't fade; the words did"). Bells on fen posts ring *twice, then silence, then twice*. The Glass breathes: the water rises and falls under a raster ripple. Colour drains to Bleached Rite. |
| `road_glass` | Through the Glass | *Normal.* The warband walks into the black mirror. The frame inverts into its reflection and the camera keeps descending until the water becomes stone: the landing under the Seat. Hagen's cart is already there. The Lieutenant's doubled-frame ghost, a beat behind. |
| `road_shut` | The Glass shuts | *Hard and Lunatic.* Far off, a light on the far side of the Glass goes out (the Emperor has spent his seer; never said). The water hardens black and cold; a hand on it finds stone. Then the Hearth at night: *CURFEW AT NOON* pasted over *DUSK*. |
| `road_stair` | The stair | *Lunatic.* The ground shakes. The coronation stair going down; carved in the rock, *WE CAME THIS FAR ALSO*, and beside it *NOT THIS TIME*. Colour drains out of the frame from the edges in; the last thing with colour is the gold thread, going down. |

### 9–10 · Approaches

- **`approach_lieutenant` — "Every future you could reach".** The Sanctum. He is
  waiting, facing away. Around him, hanging in the dark, are threads seen from
  underneath, and they are *this save's* cut threads: one per run lost, each frayed
  in the colour of its killer, labelled nothing. On a save that has never lost, there
  is one thread, and it is yours. His letters appear in the pen, one word each on the
  motif's beats: *HOLD. · WAIT. · NOT YET. · NOW.* Then the boss card and his
  existing pre-battle line ("I've seen every future you could reach…", or its
  variants for `bossKilledYouBefore` / `bossSlainBefore`).
- **`approach_emperor` — "What I kept".** The throne hall. The Roll lies open, vast;
  a gold-gauntleted hand rests on it. Red names; the gold tithe he kept glows under
  his hand. The drill in the halls below, in step. Then his card and line.
- **The Entity — none.** Its card is already "· · ·" and a hole in the music. Adding
  a cutscene would give it a voice. The absence is the design.

### 11–13 · Endings

- **`end_normal` — "The visions clear".** The Lieutenant falls on the landing. If
  **Sera** is deployed and alive when he falls, the earned moment (bible 01, earned
  fact 8): she kneels and says, once, *"Tamlin."* The violin coda of his theme is her
  saying it. Otherwise nothing is said. Then the Glass from below, still, and one
  bubble rising through it: *something deeper still stirs* (the existing
  `victory_normal` line, Sera). Into the Roll of the March.
- **`end_hard` — "Mostly".** The Emperor falls. His hand slides off the Roll. The red
  names stay struck: the Roll cannot give back what was fed. Below the hall, the
  Hearth's warmth beats once, heavier. The existing `victory_hard` line ("…mostly…").
  Into the Roll of the March.
- **`end_true` — "A dawn, made anyway".** The killing blow starts The Last Light.
  1. The hum stops. The Deep's texture of eyes closes, one by one, from the edges.
  2. Gold motes rise out of the dark, thousands, up the stair, out through the
     Hearth into the sky. Nothing labels them.
  3. The Hollow Sun: the motes join the corona. The corona thickens. On the resolved
     D, for one chord, **the disc fills**. The only whole sun in the game.
  4. The Last Pages lie open at the leaf that ends mid-sentence in every copy: *And
     when all her names are said at once, not by one mouth but by* — and the pen
     finishes the sentence **with the names of the player's army**, commander first,
     the fallen included, in gold, one per beat. That list *is* the Roll of the March.
  5. Dawn at the Ford. The fire has burned out; nobody needs it. The sun sits low
     behind the hills, so whether it is still hollow is not shown. Sera's existing
     line: *"For the first time... I can't see what comes next. And that's beautiful."*

### 14 · The Roll of the March — the epilogue

*Every victory ends here. It is different every run because the army is.*

A dark field, the gold thread drawn down the middle. Every unit that marched in this
run is written into the Roll by the pen, commander first, then in order of joining:
PC-98 portrait, **NAME** in Cinzel, class, epithet from the Deeds system.

- The living are written in gold.
- The fallen are written in gold too, with a small ember and *fell at {place},
  {act}*. They are never struck through. This is Voss's ledger of the dead, which
  holds names so the dark cannot take them.
- Bosses slain this run, once Names Returned exists (bible 09 § 3.1): their titles
  are entered in red, struck, and then the strike is withdrawn and the returned
  name written beside it.
- Lords get a one-line epilogue, Fire Emblem style, chosen by fate: survived / fell /
  commander. A new pool `dialogue.json` `epilogue` (lords by name; recruits by
  temperament, like `finaleRally`), picked by hash of the run seed, voice rules as
  `unitVoice` (≤ 90 chars).

Spacing is computed from the roster size so the last name lands on the cue's
cadence: one name per beat for a big army, one per two beats for a small one. Then
THE THREAD HOLDS and the results menu.

### 15 · The thread is cut — defeat

*The most frequent cutscene, so the tightest.* It extends the existing THE THREAD IS
CUT ceremony: the gold thread snaps in the frame. The cut end falls into black, and
for a moment the dark behind it shows eyes (the Sleeper keeps every cut thread).
Then an ember catches: the fire at the Ford relights, the loop's promise. Brief form:
the snap and the ember only. The existing `defeat` lines (63 variants) play after.

---

## Where they attach

From the code survey (line numbers as of `d5cc876`).

| Cutscene | Hook | Notes |
|---|---|---|
| `cold_open` | `TitleScene` create, before the menu; idle timer for attract mode | Global (per device) seen flag, like the title variant (`titleVariant.js` reads all slots) |
| `prologue`, `again` | `NodeMapScene.finalizeSceneReady` (426–487), in place of the act card + `runStart` sequence | `hasShownDialogue('runStart')` already makes it once per run; `meta.runsStarted === 1` picks the prologue. Works for the first-run fast path. |
| Passages | `PostCombatController.transitionAfterBattle` (364–399), after `advanceAct()`, before the act card | Key from `getActTransitionKey` (`RunManager.js:130`) |
| Passages (gap) | `NodeMapScene.checkActComplete` (2014–2054) | The resume fallback currently advances the act behind a plain "Act Complete!" banner with **no act card or story at all**. Fix regardless of cutscenes. |
| Approaches | `BattleScene._presentBossEncounter` (2086), before the boss card, fresh battles only | Never on resume, as today |
| Endings + Roll | `RunCompleteScene` (104–130), before `showRunEnd` and the `runComplete` lines | Context is built after settlement, so the save already includes this run |
| `thread_cut` | `CeremonyController.showRunEnd` (defeat) in `RunCompleteScene` | Abandon skips RunComplete today; keep it that way |

**Orientation.** The app is landscape-locked (manifest, Info.plist). Portrait battles
(beta) turn only the battlefield, and cutscenes never play inside a battle except
the approaches, which use the `'screen'` frame and follow rotation like the act card.
In portrait the plate letterboxes with the type below it.

**Depth.** A new `DOM_UI_DEPTHS.CUTSCENE` between `CEREMONY` (980) and `DIALOGUE`
(1200), so the dialogue box can sit over a cutscene's last frame.

---

## How it runs: the player

A real-time, deterministic player in the game, not video files. The case:

| | Pre-rendered video | Live player (chosen) |
|---|---|---|
| Size | ~3–8 MB per minute, per cutscene | Plates are 20–50 KB each (the Historia's six are 190 KB together); a 2-minute prologue is well under 1 MB of art |
| Reacts to the run | No | Yes: roster, fallen, killers, commander, epithets |
| Text | Baked in; a reword means a re-render | Live, from `dialogue.json`; fits the frame |
| Pixel fidelity | 4:2:0 chroma smears pixel art | Exact, integer-scaled |
| Music | A second audio track that drifts | Clocked from the music itself |
| Cost | Nothing at runtime | A small engine to build and test |

A video *export* still exists (for review, trailers and the store page): the same
player rendered headlessly.

### Modules

```
src/cutscene/
  cutsceneTimeline.js   pure: script + cue sheet + context → shots in seconds; evaluate(t) → a frame description
  cutsceneFx.js         pure helpers: keys/ease/prog, beat pulses, dither masks, palette-cycle tables, raster offsets
  CutsceneRenderer.js   draws a frame description: pixel layer (Canvas 2D at art resolution, integer-scaled, smoothing off) + type layer (DOM, crisp)
  CutsceneOverlay.js    DOM host: canvas, type, Skip, tap/hold input, safe areas
  CutsceneController.js create(scene, id, context) / destroy(); audio, policies, seen flags, preload/release
data/cutscenes/*.json   one script per cutscene (synced to public/data like every data file)
```

- **Output is a pure function of time.** `evaluate(script, t, ctx)` returns the same
  frame for the same `t`. Randomness comes from hashes of the run seed and element
  ids (the project already bans `Math.random` in battle; the cutscene player bans it
  everywhere). Flicker and boil are keyed to a frame index quantised to 12 fps. This
  gives scrubbing, `?cutscene=<id>&t=<s>` dev seeking, screenshot tests and the video
  export for free (the pdoom-video contract).
- **Scripts are data.** A script is a list of shots. Each names its start and end by
  a **cue mark** or `{bar, beat}` (never seconds), its plate layers and parallax, a
  camera key list, effects from a closed set (`paletteCycle`, `raster`, `particles`,
  `dither`, `threadCurve`, `ghost`, `drain`, `slices`), sprites (traced map sprites
  by unit id and action), and text (`hand: ceremony | speech | pen`, a literal or a
  `dialogue:` reference, tokens like `{commander}`, a `when` from
  `NarrativeDirector`). Casting for the Roll and the Lieutenant's threads comes from
  a context object built once, before playback.
- **The clock is the music.** The controller starts the cue through `AudioManager`
  and reads its position each frame (a new `audio.getMusicTime()` on `LoopedMusic`),
  falling back to a wall clock when Web Audio is unavailable or muted.
- **Cue sheets come from the score.** `tools/music/build.py` already knows every
  bar's time (`Score.seconds(beat)`, tempo ramps included). It will also write
  `src/utils/musicCueSheets.js`: per cue, bar start times, beats per bar and named
  marks declared in the score (`s.mark('oath', 13)`). Scripts refer to `@oath`.
  Re-score the cue, rebuild, and the picture moves with it. No audio analysis is
  needed: the pdoom-video stack spends most of its effort measuring beats we
  already know.
- **Palette cycling** needs palette indices. Plates are treated to indexed PNGs
  already; the treatment step also writes each plate's index buffer and palette so
  the renderer can rotate palette ranges without per-frame image work.

### Policies

- **Seen flags:** `meta.seenDialogueKeys` already stores hashed keys (the 200 most
  recent, union-merged by cloud sync). Widen `seenDialogueKey` with a `cutscene`
  category. The flag is written when the last shot begins, so skipping counts as
  seen and a crash mid-cutscene replays it once. `cold_open` uses a device-level key,
  since it plays before a slot is chosen.
- **Setting:** `cutscenes: auto | full | brief | off` in `SettingsManager` (Auto =
  full the first time on a slot, brief after). Sits beside "Skip seen dialogue".
- **Input:** tap, click, Enter or Space advances to the next hold; holding for half a
  second, Escape or the Skip button leaves; gamepad as ceremonies. `escPriority`.
- **Reduced motion:** each shot's key frame as a still, hard cuts, text shown whole.
  **Instant speed:** brief. **Atmosphere off / Canvas renderer:** no raster or
  particle effects.
- **Memory:** plates load when the cutscene is queued (the passage's plates during
  the boss battle before it) and are released on `destroy()`. Stay within
  `docs/mobile-memory-budget.md`. PWA: runtime-cached, not precached.
- **Replay:** a **Chronicle** entry in the Compendium (bible 09 § 3.2) lists every
  cutscene seen on the slot and replays it. Tabs there are append-only.

---

## How they are made: the production loop

The user's sketch of the method (storyboard to the beat → art bible → controlled
characters and places → video models for cinematography and motion → rebuild in
deterministic code → kinetic type → composite → QC and regenerate) maps onto tools
this repo mostly already has:

| Step | Tool | Exists? |
|---|---|---|
| 1. Treatment and reads | `docs/cutscenes/<id>/STORYBOARD.md`: a table of Bar · Read · Picture · Motion · Words · Sound · Out | new |
| 2. Score and marks | `tools/music/scores/*` + `s.mark()`; cue sheet export | engine exists; marks and export new |
| 3. Animatic | The player with placeholder cards (each shot's read as text on a flat colour) on the cue. Timing is approved *before* any art. | new (the pilot's player) |
| 4. Plates | `tools/art/gen/geminiImage.mjs` (`gemini-3-pro-image`, refs for identity and style), prompts from `WORLD` (`tools/art/moments/prompts.mjs`) plus a plate grammar | exists (the Historia's `art.mjs` is the template) |
| 5. Treatment | `tools/art/icons/lib/sceneTreat.mjs` (PC-98, the game palette, ordered dither) | exists |
| 6. Layers | Image edit of the treated plate ("the same picture without the figures") for a clean background; the difference is the figure layer; depth by hand-picked bands | new, small |
| 7. Motion | Procedural first (parallax, palette cycles, raster, particles, traced sprites). Video models only for shots where a figure must act (below) | player new; sprites exist |
| 8. Type | The three hands, in the script | new |
| 9. QC | Stills at every cut, contact sheets, a vision critic, a human pass | `describeImage` exists; the rest new |
| 10. Export | Playwright drives the player's `renderAt(t)`; ffmpeg encodes | new (the pilot has it) |

### Video models: reference, never footage

Veo 3.1 (`veo-3.1-*-generate-preview`, 4–8 s, first/last-frame conditioning) and
Gemini Omni Flash (a 360p draft tier) are reachable on this key. **Imagen 4 is not:**
it was shut down on the Gemini API in August 2026, so `tools/imagen-pipeline/` (and
`npm run imagen:generate`) is dead and should be retired in favour of
`tools/art/gen`, which already uses Nano Banana Pro and Nano Banana 2.

Their output never reaches the screen. It is used two ways:

1. **Camera reference.** Generate from a treated plate as first frame; estimate the
   frame-to-frame transform (a homography over matched features); keep only the
   camera path as keys for the plate's parallax layers. Cinematography solved by the
   model, rendered by our code.
2. **Figure motion reference.** For a figure that must act (a rider, a cloak in wind,
   Sera kneeling): drop to 12 fps, isolate the figure, reduce it to map-sprite scale
   with `tools/art/sprite-trace` (which already reduces generated references to the
   game's pixel grid and palette), lock the palette with ordered dither, hold any
   pixel that barely changed from the previous frame, and clean by hand. The result
   is a short sprite strip, drawn on twos.

Honest status: nobody we could find has published a working "video reference →
traced deterministic animation" pipeline; the music videos above are fully
procedural. So this is a **pilot on two shots** (the ford horn-bearer, Sera kneeling
in `end_normal`) before any cutscene depends on it. If it fails, those shots use
traced sprites and procedural motion, and nothing else changes.

### QC

- **Stills and sheets:** `tools/cutscene/render.mjs --stills` at every cut (first and
  last frame of every shot) and `--sheet` contact sheets. The agent reads them, as
  both music videos did.
- **Vision critic:** `describeImage` over each still with a checklist: identity
  (Edric teal, Sera cream and red hair…), the Hollow Sun correct, no text or runes in
  the art, no skulls or spikes (art bible), faction colours right, the read legible.
- **Automatic checks:** see [Tests](#tests).
- **Human pass** on the animatic (timing) and on the first full render (look).
- Regenerate and repeat until coherent.

### Cost and size

- **Plates:** about 60–80 final plates across the set, 2–4 takes each. At Nano Banana
  Pro prices this is tens of dollars.
- **Motion pilot:** two shots, a handful of 6 s drafts at the 360p tier and a few at
  720p: well under $20. (Prices from third-party summaries; Google's pages are
  blocked in this container.)
- **Download:** art under 1 MB per cutscene; new music at roughly 1 MB per minute of
  cue. Loaded lazily, never precached.

---

## What we take from the music videos

- **Storyboard by the read, timed to the music** (PDoomVideo `STORYBOARD.md`; the
  ClaudeAnimationBase lesson that *timing is where models fail most*: write the reads
  one at a time, fast actions and slow meanings, and let the last read land).
- **Output as a pure function of time**, with a frame index quantised for boil
  (both).
- **Cuts placed by content and snapped to the grid**, looked up by name, never typed
  as seconds (pdoom-video `timeline.ts`). Our grid is exact from the score.
- **Words inside the picture**, each moment with its own typographic idea, not a
  subtitle strip (pdoom-video). Ours is the pen.
- **One recurring motif through every shot** (pdoom-video's orange spark; our gold
  thread) and **match cuts through shared geometry**.
- **A strict owned palette**, one accent used almost never (their orange; our whole
  sun).
- **Contact-sheet QC and a written revision history** in the design doc.
- **Parallel authors with file ownership** (one script and one storyboard per
  cutscene) and a lead who owns the player.

Not taken: sub-frame motion blur, HDR bloom and halation (they fight hard pixel
edges), audio analysis (we compose the music).

---

## Tests

- `cutsceneTimeline` is deterministic: the same `t` gives the same frame; every shot
  resolves; no gaps or overlaps unless declared.
- Every script validates against a schema; every plate, sprite, portrait, cue and
  cue mark it names exists.
- **Canon guard:** no sealed string in any script or its `dialogue` references
  (`Serafen`; the watchword; any spelling of the old kingdom's name). `Tamlin` only
  in a shot marked `earned: 'tamlin'`, which only `end_normal` may contain. Lines
  follow `unitVoice` limits (≤ 90 chars, no double quotes). No literal lord names in
  lines that `DialogueCast` recasts.
- **Palette lock:** every plate uses only the art-bible palette.
- **Fit:** every text line fits its band at 667×375 with the longest tokens (the
  ceremony tests' pattern), and the Roll of the March lands on the cadence for 1 to
  the maximum roster size.
- **No state:** an e2e lane plays and skips each cutscene hook; save bytes match
  before and after except the seen key; a reload mid-cutscene does not replay it on
  resume; reduced motion and Instant show the documented forms.
- The `tests/e2e/lanes.json` rules apply to every new spec.

---

## Canon source

The cutscenes quote the bible (Tier I/II) and must not contradict it, so PR 119
should land first, refreshed against main:

- `#132` renamed 11 relics the bible names (Oathblade, Twinsworn, Oathlance, Oathaxe,
  Oathbow, Namethief, Hermit's Bow, Tidebreaker, Firstwind, Breachbolt, Endword).
- **Tidebreaker's lore now contradicts the chronicle:** it used to be carried down in
  the Storm-Year (O 519); it now "held the clan pass when the empire came up like a
  tide". Chronicle § The Storm-Year and 06's entry need rewriting, not find-and-replace.
- 08's ruling "don't rename real-world relic names" is out of date (Excalibur and
  Luce were renamed; Ragnarok, Gae Bolg, Delphi kept).
- Small gaps: the new Soldier class; Sage and Battle Monk now use Light.
- Its `dialogue.json` edits merge with main without conflict.

None of the cutscene beats above depend on a renamed item.

---

## Build order

1. **Slice 0 · the pilot (done on this branch, offline).** A standalone player in
   `tools/cutscene/` plays the prologue's first draft on the title theme, from the
   Historia's six plates and the score's real bar times, and exports an MP4. It proves
   the look, the clock and the pen before any game code changes. No API spend.
2. **Slice 1 · the player in the game.** `src/cutscene/`, cue-sheet export from
   `build.py`, the setting, seen flags, skip and reduced-motion forms, the Chronicle
   list. First content: `thread_cut` and `again` (the most-seen, the cheapest). Also
   fix the `checkActComplete` gap.
3. **Slice 2 · the prologue and the cold open.** New plates where the Historia's
   don't fit; the motion pilot on the ford shot; a dedicated prologue cue if the
   title theme is kept for the title.
4. **Slice 3 · the five passages.**
5. **Slice 4 · endings and the Roll of the March** (with the `epilogue` pool).
6. **Slice 5 · approaches**, then **earned vignettes** once Names Returned and the
   Unopened Order exist.

### Later: earned vignettes

Short (5–15 s) scenes staged on the battlefield itself with traced sprites and the
same player, the camera on the map: a boss's name returning (the red strike
withdrawn over the fallen sprite), Sera saying *Tamlin*, the Iron Wall reading his
order thirty-four years late, a unit lifting the crown from the ford's gravel. Each
is earned by play and plays once per save.

---

## Questions for the owner

1. **Prologue forced once (skippable) on a slot's first run, or offered?**
   Recommendation: forced once, skippable, replayable from the Chronicle.
2. **The cold open on first launch plus the title's attract mode?** Recommendation:
   yes; it makes the title's key art the last shot of a story.
3. **Text only, no voice?** Recommendation: text only. The score is the voice.
4. **A small API budget** for plates and the two-shot motion pilot (tens of dollars
   total)?
5. **Land PR 119 (refreshed for the renames) first**, as the canon the scripts cite?
6. **Temp score:** keep the title theme under the prologue (its form fits the story
   bar for bar), or compose a dedicated prologue cue and keep the title theme for the
   title?

---

## The pilot

`tools/cutscene/` (dev tool, not shipped):

- `pilot/` — a standalone player page and the prologue draft script, run through the
  Vite dev server. The frame is a pure function of `t`.
- `cuesheet.py` — prints bar start times for a score straight from
  `tools/music/scores` (the export `build.py` will do in slice 1).
- `render.mjs` — Playwright renders frames or stills; ffmpeg muxes the title theme.

See `tools/cutscene/README.md` for how to run it and what it does and does not prove.
