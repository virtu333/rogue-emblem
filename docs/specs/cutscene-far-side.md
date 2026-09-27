# "The Far Side of the Glass": the opening, second prototype

Status: **draft 2, rendered** (2026-09-27): draft 1 plus a transition pass and a
colder voice (see [Draft 2](#draft-2)). Source in `tools/cutscene/glass/`.
A second candidate for the opening in [cutscenes.md](cutscenes.md), beside
**"The Roll"** ([cutscene-the-roll.md](cutscene-the-roll.md)). The Roll is a hook in
engraved ink that looks like nothing else in the game; this one is a narrated story
trailer in the game's own medium, pixel art, drawn from anime cels.

## The idea

A history told by the one person who has already watched it end every way.

A soft, tired voice tells the world's story like a myth: the Dawn weaving the first
morning, naming the dragons, then fire, then rivers, then us; the thing beneath the
world turning over; the Dawn spending her name to the last syllable; the sun rising
hollow. Then a man with one list goes down a stair and writes his own name first,
every oath in the kingdom breaks at midnight, and by noon there is an Emperor. The
last king dies in the river where the first one swore, and his crown is still down
there. Names are written in red and read into the dark. The officers, one per beat,
each with a title. *"I know how every one of them dies."*

Then it narrows to a boy carried out of a burning hall with a banner and a coal in a
pot, who grows up counting two hundred and twelve names, and a girl at the Glass who
looks into the water and sees, not her reflection, but the narrator. *"I saw her
seeing."* He has watched the boy die at the Ford, on the bridge, in the fens, at his
feet; every time she takes him back to the fire. Then we sink through the Glass and
find him on the stair under the mountain: the Lieutenant. *"I have seen every way
this ends."* The letterbox opens. *"Go on, then. Show me one I haven't seen."*
**ROGUE DAWN.**

The last line is the roguelike's invitation, spoken by the enemy who can see every
ending but his own, and wants, underneath, to be surprised.

**Why the Lieutenant narrates.** He sees every future that ends and none of his own.
That makes him the one character who can tell the whole history with authority and
the loop with weariness, and it makes the reveal a hook rather than a spoiler: the
player meets their final opponent as a voice first. His name stays sealed (bible 01
§ Hidden canon, earned fact 8): he is never named, only seen.

**How it follows the Elden Ring trailer, and where it doesn't.** The shape is the
same: a narrator recalling an age, a theft that breaks the world, the fall of the
great, a roll of the mightiest, a fractured present, and the narrator revealed with a
question for the player. The difference is that the narrator is the antagonist, the
question is a dare, and the history ends on the player: the boy who counts, and the
loop.

## The look

- **Medium:** every frame is pixel art at **480×270** art pixels (4× at 1080p),
  palette-indexed, about 28 colours per shot pulled halfway toward the art bible's
  ramps so every shot shares the game's colours.
- **Source:** a keyframe per shot painted as a 1990s dark-fantasy anime OVA (Record
  of Lodoss War, Berserk 1997), with the current PC-98 portraits
  (`public/assets/portraits/pc98/192/`) as character references, animated with Veo.
  The clip is never shown: `pixel.py` redraws each frame (on twos) in the shot's
  palette, keeps the anime's own ink lines as 1-pixel strokes, dithers only smooth
  gradients (Bayer), and holds colours still between frames (hysteresis).
- **Frame:** letterboxed 2.35:1 inside 16:9; the narrator's lines sit in the lower
  bar in **Press Start 2P** at its native 8 px (the game's own font). The bars open
  once, for the last line.
- **Transitions:** ordered-dither dissolves and fades, never alpha. White flashes
  only on hits (the oaths breaking, each officer, each death, the title).
- **Drawn by the player, not traced:** the opening thread (it follows the Thread
  motif's pitch contour, A-D-E-A), the trembling thread and its snapping on each
  death, the mirror composite, and the Hollow Sun and the title (Cinzel snapped to
  the pixel grid, in the ember ramp).

## Beat sheet

Times are seconds on the score's clock (60 bpm, so bars are four seconds), as in
draft 1: draft 2 inserts 4 s at 0:32 and 4 s after the oath's horn call, so every
time after 0:32 is 4 s later and every time after 1:28 is 8 s later.

| Time | Music | Picture | Narration |
|---|---|---|---|
| 0:00 | The thread's high A alone | Black; a point of gold; the thread draws itself | *Before her, nothing came next.* |
| 0:10 | The Thread cell on celesta, harp | The Dawn weaves gold threads across the dark | *She asked the dark a question. The dark had no answer… so she became one.* |
| 0:20 | The first morning, in F: flute, strings | Dragons over a young valley under a whole sun; a mother lifts her child to the light | *She named the dragons first. Then fire, and wind, and the rivers. And last of all, us.* |
| 0:32 | **Boom**; taiko; D against E-flat | The land heaves; a mountain splits | *Then the thing beneath the world turned over in its sleep.* |
| 0:38 | Soft strings, choir | The Dawn kneels in the storm, the only light | *She could not fight it. It was the floor she stood on.* |
| 0:46 | Celesta and harp falling, rising choir | She comes apart into falling stars; the Glass opens | *So she did the only thing a name can do. She spent herself… down to the last syllable.* |
| 0:54 | The Thread slowed, horns | The dragons lie down around the Glass and turn to stone | |
| 1:00 | The Hollow Sun: climbs to C-sharp… a bar of silence; one bell, F | The sun rises hollow over the stones | *The next morning, the sun rose hollow. It has risen that way ever since.* |
| 1:12 | The Old Kingdom horn call | The oath at the Ford | *For six hundred years, the kings kept one oath. Every name is kept.* |
| 1:22 | The hum (D and its shadow), pizzicato quill | The stair into the mountain; the list | *It took one man, one night… and one list. He wrote his own name first. That was the price of the door.* |
| 1:32 | Heartbeat, low choir | The Hearthstone; the circle reads names into the dark | |
| 1:40 | Three bells; a **crack** on "broke" | A knight wakes unsworn and stares at his hands | *At midnight, every oath in the kingdom broke at once.* |
| 1:48 | The Empire drill, full | The Marshal on the wall under the Hollow Sun | *By noon he had no name at all. He called himself the Emperor.* |
| 1:56 | War drums, cut off | The old capital burns | |
| 2:02 | A cello lament; the crown sinks on celesta | The last king dies in the river; the crown sinks | *The last king died in the river where the first one swore. His crown is still down there… somewhere.* |
| 2:13 | The Empire's semitone ticking; choir drill | The Roll: names in red; cantors read them into the pit | *Now they write your name in red. And when they need it… they read it into the dark.* |
| 2:24 | Taiko and spiccato, a brass stab every two beats | Seven officers, one per stab, each titled | *His officers gave up their names to serve him.* |
| 2:38 | Organ chord, choir | THE EMPEROR opens his eyes | *I know how every one of them dies.* |
| 2:44 | Tremolo, a broken horn call | Wendhall burns; the smith carries the boy out with the banner and the ember | *They burned the last hall in the west. A boy got out with a banner… and a coal in a pot.* |
| 2:55 | The home fire: nylon guitar, harp, flute in F | Edric by the fire, counting | *He still counts the dead. Two hundred and twelve names. He knows them all.* |
| 3:04 | Sera's Thread on the violins | Sera at the Glass | *And a girl at the Glass looked into the water… and saw him coming.* |
| 3:11 | The Lieutenant's motif (A-D-C-A) and its shadow a tritone off, a beat late | In the water, not her reflection: him, upside down | *I saw her seeing.* |
| 3:16 | Heartbeat; a hit on each death | The thread trembles; Edric dies four times, each cut on its word, the thread snapping | *I have watched him die at the Ford. On the bridge. In the fens. At my feet.* |
| 3:25 | A reversed swell, the Thread backwards; the home fire | Sera pulls the thread; sparks fall back into the fire; the seven at the camp | *And every time, she takes him back to the fire. To the night before.* |
| 3:36 | Everything drops; the hum | Sinking through the Glass to the stair under the mountain | |
| 3:42 | His motif on the violins, the shadow in the violas | The Lieutenant lifts his head; the letterbox opens | *I have seen every way this ends.* / *Go on, then. Show me one I haven't seen.* |
| 3:52 | **Hit**; the bells' A-G-E; the Hollow Sun cadence, stopping on C-sharp | The Hollow Sun drawn on the Thread cell; ROGUE DAWN | |

## Draft 2

**Transitions.** Time was inserted where the picture had no room (`WARP` in `score.py`
and `edit.mjs`; notes held across an insertion are held longer, later cues move, and
each gap has its own music):

- **After "last of all, us" (+4 s).** The morning holds; the harp's last F chord rings
  out; then the colour drains toward unlight violet (a palette slide, in steps) and the
  frame shudders by a pixel while a hum, a timpani roll, a riser and a reversed swell
  climb into the boom of the Sleeper turning.
- **After the oath (+4 s).** The Old Kingdom call finishes; the oath fades out; a beat
  of dark with the hum, one bell and the low choir; the stair rises out of black; then
  "It took one man".
- A pass over every boundary (the `IN` / `FADE_IN` / `FADE_OUT` tables in `glass.js`):
  dissolves where time flows (kneel into the starfall, the ledger into the reading), a
  fade to black before midnight, the king rising out of black after the siege is cut
  off, and hard cuts kept only for hits (the quake, "one list", the drill, the
  officers, the deaths).
- l06 no longer starts under the end of l05 (draft 1 overlapped them by half a second).

**The voice.** Draft 1's narrator read as neutral. The Lieutenant's motif is shadowed a
beat late a tritone away (a seer who sees two futures at once), so his voice now has
the same shadow: a copy a tritone down, a beat (110 ms) behind, dark and low-passed.
It is barely there in the myth (−22 dB) and grows when he speaks of himself ("I know
how every one of them dies" −15, "I saw her seeing" −13, the last two lines −12 and
−11). The voice itself is a little deeper (−0.8 semitones), drier and closer (less
low-mid warmth, more presence, compressed). This is processing on draft 1's takes
(`music.py` `treat()`); the delivery is still draft 1's.

**Not done: new takes.** A cold direction is written (`STYLES.cold` and `COLD_NOTES` in
`script.mjs`: precise, calculating, faintly amused, menace by restraint, with notes for
the key lines) but not recorded: the Gemini project is at its spending cap. Once it is
raised: audition voices with `tts.mjs --audition --style cold`, record with
`tts.mjs --style cold`, and mix with `VOICE_TAKES=voice_cold python3 music.py --mix`.

## Lore

This version follows the bible (PR 119) closely; it adds nothing The Roll's lore
edits need. What it relies on: the Dawn's naming order and her spending (01), the
Unsworn Night and the Marshal's list with his own name first (02), the crown in the
Wend (02, 05), the Roll and feeding (01), the seven officers as titles (05), the
burning of Wendhall, Brannoc and the ember pot, and the 212 names (05), Sera seeing
the Thread while the Lieutenant sees her seeing (02), and the loop returning to the
fire on the night before (01). Sealed facts stay sealed: the Lieutenant is never
named; the Dawn's face is never shown; the old kingdom's name is never said.

One liberty: Sera is drawn in the purple robe of her current portrait, not the
bible's undyed cream, so she matches the game.

## How it is made

```
script.mjs ──► tts.mjs ──► narration takes (Gemini TTS, one voice, one WAV per line)
                                  │ (lengths and phrase onsets)
shots.mjs ──► gen.mjs --keys ──► anime keyframes (Gemini 3 Pro Image, PC-98 portraits as refs)
                     └─► gen.mjs --clips ──► Veo 3.1 clips
                                                  │
edit.mjs (the cut) ──► trace.mjs ──► pixel.py ──► px/<shot>.webp + .json (indexed sheets)
                                                  │
score.py ──► music.py ──► far_side.mp3 (score + narration, ducked, limited) + cues.json
                                                  │
                         glass.js (player: 480x270 buffer, dither, text, thread, sun)
                                                  │
                         render.mjs --piece glass ──► MP4 (1920x1080, 4x pixels)
```

- **Narration:** Gemini TTS (`gemini-2.5-pro-preview-tts`, voice *Charon*),
  auditioned against five other voices and checked line by line for exact words and
  delivery (`judge.py`); four lines were re-recorded. The newer TTS model read the
  style prompt aloud, so it is not used.
- **The clock:** the score is written at 60 bpm so a beat is a second. Each line
  starts on a beat (`score.LINES`); cuts land on bars, beats, or measured word onsets
  within a take (the four deaths).
- **Score:** composed in the game's engine, in D minor, never resolving to D.
  Rendered with the engine on the music branch (`claude/game-music-composition-vxrodt`:
  `MUSIC_ENGINE=<that checkout>/tools/music python3 tools/cutscene/glass/music.py`),
  so it plays the **house palette**: Sonatina (SSO4) string sections, choir, celesta
  and the performed solo violin (Sera's Thread, the Lieutenant's motif, the closing
  phrase), with that engine's tuning corrections and onset compensation. The brass
  stays on the legacy VSCO instruments (`score.palette`), because VPO3's SFZ edition
  is not fetchable from here (its repo carries only the DecentSampler edition). Run
  without `MUSIC_ENGINE`, the older engine on this branch renders the same score. It quotes the Thread, the Hollow Sun, the Old Kingdom call, the
  Empire drill, the hum, the Eclipse bell, the home-base fire and the Lieutenant's
  motif with its shadow.
- **Mix:** narration laid in at its times, music ducked 8 dB under the voice, a
  look-ahead limiter at −1 dBFS.
- **Pixel pass:** `pixel.py` per shot over only the frames the cut uses.

Costs for draft 1: 53 keyframe generations (Gemini 3 Pro Image, 2K; 40 shots, 11
redone or tests), 42 Veo clips (about 260 s; Veo 3.1 for faces and slow shots, Fast
for action), 38 TTS takes (24 lines, auditions, re-records). The project
reached its monthly spending cap at the end of generation.

## What is not done

- **Weak spots:** the dragons turning to stone use only the first seconds of a clip
  that morphs into another scene (slowed, with a pan); a regeneration was blocked by
  the spending cap. Several clips drift late (the Hollow Sun blows out, Edric's eyes
  glow, Sera sinks toward the water); the cut uses only their good stretches.
- **No audio critique of the final mix yet** (the cap). Levels were checked by
  measurement: speech sits 8–10 dB over the ducked score.
- **Size:** the sheets are about 29 MB. Shipping it would need harder trimming, fewer
  drawings on held shots, or a video codec for the frames.
- **Length:** 4:16. As a first-run opening it is long; the officers and the Roll are
  the obvious places to cut if it needs to be under three minutes.
- Offline only, like The Roll: no in-game player, skip or seen flag yet.
