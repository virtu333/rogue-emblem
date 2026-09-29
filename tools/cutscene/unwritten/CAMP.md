# "The Night Before": the quiet scene

Bars 5-12 of "Under the Broken Sun" (12.8 s, from 6.4 s into the track, 150 bpm, a bar is
1.6 s). The opening's beat for these bars: *the camp on the night before; the Thread
across the sky; Edric rises. Logo on the turn into 13.* It is the counterweight to "The
Ford": that scene is violence in a river, this one is three people who are not sleeping.
The craft to show is the other half of anime: acting, stillness with life in it, light,
atmosphere, small gestures that tell character.

**Intent, in two sentences.** Three people keep a fire on the last quiet night before a
battle they may not survive, and each is hiding the same fear in a different way; the only
thing that moves between them is a look. Sera sees the Thread in the sky, Edric feels her
looking, Kira sees him feel it, and Edric gets up.

## Who wants what

| | Wants | Does about it | The gesture (one per shot) |
|---|---|---|---|
| **Sera** (seer, hugging her knees, apart from the fire) | To tell him; she cannot. She has seen how this ends, and she has not slept. | Looks up, away from them, at the Thread only she reads as a line. Keeps her face still. | Her eyes come down from the sky; one slow blink; a breath. |
| **Edric** (lord, sword across his knee) | To be steady for them. He hides being afraid behind being tired. | Stares into the flames; does not look at Sera because he would have to say something. | His eyes lift and meet hers across the fire; a breath out; the ghost of a smile. Then he stands up. |
| **Kira** (scout, on a crate with the map) | A plan that gets everyone home; there is not one. | Works, so as not to look. Taps the map, stops, glances between the other two. | The tapping finger stops. She folds the map: the plan is finished, the night is not. |

Attention is the plot: a chain of eyelines. Sera looks up (S3) -> what she sees (S4) ->
Edric looks up from the fire toward her (S5) -> Kira sees him look (S6) -> he rises (S7).
Every cut goes to whatever the last shot's eyes were pointed at.

## How studios do a quiet scene (what this file copies)

- **Holds with life in them.** Nobody is ever frozen: breathing (a slow squash on the
  chest on threes), hair and cloth in the wind (a warp that follows through), a blink every
  three to five seconds (never in step), the fire flickering across every face, embers,
  smoke. The drawing changes on threes in the holds, on twos in the gestures, the camera on
  ones.
- **Ma.** The pause. The Thread melody rests on bar 8 beat 4 (and after bar 12); the picture
  rests too: Sera's eyes are the only thing that moves in that beat.
- **One gesture per shot**, on the beat or the note, with anticipation (a breath in before
  the eyes move) and a settle.
- **Eyelines and reaction shots.** Screen direction is fixed: Edric on the left facing
  right, Sera on the right facing left, Kira behind the fire; the camera stays on one side
  of the line except for the last low angle.
- **Slow camera on the wide ones, on ones.** Push-ins on faces (1.0 -> 1.06 over a bar). A
  tilt down at the top (the Thread to the camp), a tilt up at the end (the camp to the
  Thread): the scene is bracketed by the sky.
- **The background acts too.** Smoke, sparks, stars twinkling, grass in the gusts, a sentry
  pacing on the far ridge, distant fires, the Thread shimmering.
- **Light is the design.** Firelight is the one warm thing besides the Thread, so it must
  fall the way fire falls: a warm pool on the trampled ground that gutters on twos, warm on
  the faces toward the fire and blue-dark on the far side, a rim of orange on the edge of
  every figure toward the flames, long shadows thrown away from the fire and dancing. The
  Thread is the other light: cold pale gold, thin, stitched through the stars.

## The space (metres; `camp_blocking.js`)

X right, Y up, Z away from the default camera (which looks up +Z from the south). The
fire is the origin, a ring of stones with two logs. **Edric** sits west of it at (-1.55,
0.15), facing +X. **Sera** sits east at (1.45, -0.1), facing -X (the cut-out is flipped).
**Kira** sits on her crate north of the fire at (0.35, 1.7), facing -X (flipped), the map on
her knee. Tents (ochre canvas, doors toward the fire) stand 6-10 m back, a palisade behind
them, a spear tripod and a banner pole to the sides, stumps and a bench near the fire, and
small sentry fires far off. The ridges are dark, a pale glow along the eastern horizon.
The Thread is one long arc across the sky from the western horizon over the camp to the
east.

## Shot list (bars from `at(bar, beat)`)

| # | From | To | Size / move | What happens | Assets |
|---|---|---|---|---|---|
| 1 | 5.1 | 7.1 | Sky -> wide, crane down 2 bars | The crash: stars, the Thread across the sky flares and a bead runs along it on each note of the tune. Tilt down past the ridge to the camp; smoke and embers rise toward the Thread. Three small figures at the fire, alive at the last beat (Kira taps, Edric breathes, Sera's chin up). A sentry paces the ridge. | world, three cut-outs |
| 2 | 7.1 | 8.1 | Medium-wide three-shot, slow push | The geography and the status quo: Kira working, Edric staring at the flames, Sera looking up. Figures on threes, fire flicker on all. | cut-outs + micro-motion |
| 3 | 8.1 | 9.1 | Close-up, push-in | Sera's face in profile, firelit on one side, the sky behind. The long E: a breath, a glint in her eye. On the rest (beat 4) her eyes come down. | `camp_sera_look` |
| 4 | 9.1 | 10.1 | Sky, slow drift | On the crash: what she sees. The Thread flares, beads run along it on each note; embers and smoke pass the lens; stars. | world sky |
| 5 | 10.1 | 11.1 | Medium close-up, slow push | Edric feels it: his eyes lift from the fire and meet hers (screen right). A breath out, the ghost of a smile. Flame at the frame edge, embers drifting across. | `camp_edric_look` |
| 6 | 11.1 | 11.4 | Close-up, tilt from map to eyes | Kira's finger stops; her eyes go from the map to Edric; she folds the map. | `camp_kira_map` |
| 7 | 11.4 | 13.1 | Low angle, tilt up | On the leading tone Edric puts a hand down and rises. The camera follows him up to the sky: the Thread across the stars, the fire flaring at the crash (12.3.5), a second hit on beat 4. He stands looking at it. The last frame leaves the sky above him clear for the logo. | `camp_edric_rise` |

## Systems

| File | What it is |
|---|---|
| `camp_blocking.js` | The plan as data: fire, seats, characters' facing and eyelines, the gestures and their times, the sky's Thread, the score's notes for the pulses. `validate()` checks the eyelines meet and the gestures sit on beats. |
| `camp_previs.js` | A flat plan-view animatic: the layout from above, eyelines as lines, the shot boundaries and gesture times on a score bar. |
| `engine/camp_world.js` | A procedural night camp seen through a real perspective camera: sky, stars, the Thread, ridges, ground, tents, props, grass tufts in wind, the fire (flame, light, flicker, shadows), smoke, embers, figures composited with firelight, rim light and shadows. |
| `camp.js` | The seven shots. |

## Continuity notes

- One design per character: Edric's teal cloak and one pauldron; Sera's purple robe and her
  striped blanket; Kira's crimson coat and white ponytail (reads as neither man nor woman:
  no gendered words in Kira's prompts).
- Scale from the cut-outs' measured heights; seated figures are drawn at the same metres per
  pixel as their standing cut-outs.
- Gold is the Thread's alone. Firelight is orange and red, never the Thread's pale gold, and
  never sparkles.
- The last frame of the whole opening (Edric at the fire looking into the camera, in full
  colour) is not used here. This scene ends with him standing, looking at the sky.
