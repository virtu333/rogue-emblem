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

## Shot list (bars from `at(bar, beat)`; the cameras are data, `CAMERA` in `camp_blocking.js`)

| # | From | To | Size / move | What happens | Assets |
|---|---|---|---|---|---|
| 1 | 5.1 | 7.1 | Sky -> wide, a tilt down that starts after a held breath | The crash (two frames of white). The Thread across the stars, a bead running along it on every note (the wave in it swells on each note and settles in the rests). The sky drifts even while the camera waits. Tilt down past the ridge to the camp, smoke and embers rising toward the Thread; a torchbearer walks behind the tents. Three small figures at the fire, each alive (their own hair and breath). | world; Sera and Kira from their clips' first drawings, Edric a cut-out with idle warps |
| 2 | 7.1 | 8.1 | Medium three-shot, slow push | The geography and the status quo: Kira with the map, Edric staring at the flames, Sera with her chin up. On bar 7 beat 2 Edric puts his sword out toward the flames once, as if to prod a log, and draws it back (`camp_edric_fire`). Figures on threes; the fire's flicker on every face; the long shadows thrown away from the flames. | as 1, Edric from `camp_edric_fire` |
| 3 | 8.1 | 9.1 | Close-up from the south-east, slow push in | Sera's face lit from the left, Kira behind her shoulder watching. The long E: a breath, the Thread as a glint in her eye. On the rest (beat 4) the glint goes out, her lids close and her eyes come down. | `camp_sera_look` |
| 4 | 9.1 | 10.1 | Sky, wide, canted, a slow drift | On the crash, what she sees: the Thread flares (the halo opens to two pixels), beads with a four-point glint run along it on each note, the wave in it sings; embers and smoke rise past the tent tops; stars. A small camera jolt on the crash. | world |
| 5 | 10.1 | 11.1 | Medium close-up from the south-west, slow push | Edric stares at the fire, feels it, his head snaps up (twos) and turns to her; he settles, meets her look, the ghost of a smile. Flame at the frame's edge, embers drifting across, Kira small behind him. | `camp_edric_look` |
| 6 | 11.1 | 11.4 | Close-up from the south-east, slow push | Kira works, stops, lifts her eyes from the map to Edric (the ponytail swings through). The fire is behind us and lights her face. | `camp_kira_map` |
| 7 | 11.4 | 13.1 | Low and close, a tilt up with him, then one move back and up that lands on the hit | On the leading tone Edric puts a hand down and rises; the fill under it. The camera makes one move on the fill: a small dolly in (anticipation, 0.55-0.72 s), a smootherstep pull back and up (a fast middle, a long settle) that arrives on the big hit (12.3.5). A paper-white two-frame flash covers the change from the rise clip to the standing cut-out: he stands under the Thread with his face lifted (his head rises a little more and holds), Kira and Sera at the fire, the sky clear above him for the logo. The camera never quite stops. | `camp_edric_rise`, then `edric_standing` |

## How it was made

- The world is procedural (`engine/camp_world.js`, `engine/camp_billboards.js`) and drawn as ink and
  wash (the Unwritten Page, STYLE.md): the sky is washes laid in bands whose edges wander, clouds are
  two flat tones, ridge crests are a line of ink where found, a pooled darker wash where soft and
  haze where lost, the ground two overlapping washes with the fire's pool in flat bands that breathe
  with the flame, and the vellum's grain is multiplied through every wash. The dither snap is kept.
- Tents are ray-cast ridge tents (sagging ridge, panel seams, fold lines from the pole tips, a scalloped
  hem, guy ropes and pegs, the fire-facing side a warm band, the far side cool, one flap open), their
  edges drawn as depth-tested ink strokes. The fire is eight drawings of flat tongues (darker outer,
  paler inner, one small pale core, ink at the tips only), logs standing in it, faceted stones
  blackened on the fire side, heat shimmer and sparks. Nothing warm is yellow except the core.
- The palette snap (`camp_palette.js`) leaves out the earth ramp: dim warm tones used to drift olive.
- The three characters are the batch-4 cut-outs and five MiniMax H3 clips made from them
  (`motion/camp_jobs.json`, `motion/camp_minimax.mjs`, packed by `clip.py`, trimmed by
  `trim_atlas.py`): Sera lowering her eyes, Edric looking up and across the fire, Kira with the map,
  Edric rising, Edric at the fire (breath, a glance, the sword put out toward the flames).
  $2.80 in all: five 5 s clips at H3 768P, the first Sera clip regenerated, and two variants of the
  fire clip ($0.80; the one with a loop-closing last frame did little and is unused).
- Edric's cut-outs face left as drawn and are flipped to face Sera; Sera and Kira face right and are
  flipped to face the fire. His hair is painted auburn in the seated cut-out and the clips made from
  it: it is retoned to chestnut at load (`retoneHair`), and firelight keeps its hue (`hueHold`).

## What would lift it further

- A drawing of Edric facing right (no flip) and a blink patch for the close-ups: Edric's blinks in the
  wides come from his clip (a lowered lid mid-clip), not a patch on the cut-out.
- Sera's eye close-up with the Thread in it, and a hand insert (batch 8 prompts).
- A painted camp prop sheet (tent fronts, tripod, barrels) to replace the ray-tested props.

## Grounding (what carries whom)

The owner's test is "is it real?": every figure and object rests on something you can see. Measured, not
guessed (cut 4 made the two seats real objects, not shapes):

| Who | What carries them | How it was made and measured |
|---|---|---|
| Edric | A rough block of sandstone (`SET.seats`, drawn by `engine/camp_seats.js`): 1.1 m x 0.7 m, 0.25 m high, an irregular ring of 17 sides in two tiers (steep foot, shoulders leaning in), worn chamfers, a broken corner, a crown that tilts away from where he sits, strata, cracks, soil grown up its foot, a lower step fused behind its left end, a block broken off at its foot, pebbles, grass rooted at its base. Sunk into the ground. | The clips do not all sit at the same x (lower-body centres: fire clip -1.40, look clip -1.77, crouch -1.67..-1.88, measured from the atlases), so the rock is centred where the fire, rise and standing drawings all put their boots (-1.5), the fire clip is moved 0.1 m and the rise 0.1 m to meet it, and the standing cut-out's anchor row is the boots' soles (1392), not the sword's point (1462: it hovered 0.09 m over the crown). The crown is the contact plane (`Y = top`). |
| Sera | A folded wool blanket (height field): a fold that is a rounded tube along the front edge, a top sheet with a ragged raw edge over a base sheet that shows at the ends, a corner turned over with the plain reverse showing, stripes that follow the fold (measured from it, so top and base line up), crease lines, a dip where she sits with wrinkles running from it. About 7 cm thick at the fold. | Her clip ends on row 396; the blanket's front edge is 0.2 m in front of her hem and its top under her is 0.06 m. |
| Kira | Her painted crate (it is in her drawing; a second one would double). | The crate base is row 345-350, her near boot row 393 (0.2 m nearer). The contact line follows each column's lowest pixel. |
| The torchbearer | The ground at his depth; a contact under each foot and a torch pool round him; tents in front hide him through the depth buffer. | |
| Props | Every stone, barrel, crate, tent, post, tripod leg and seat has a contact-occlusion footprint (`camp_ground.js`, a grid built once); stumps, barrels, crates, the bench and both seats throw a shadow. The bench is a plank on two end blocks (dark under the seat), not a solid block. | |

Both seats are lit by the fire (`lightRock` for stone: a sky term that favours what faces up, the fire in three
flat steps, a warm fill on the low sides from the trampled ground, the sky's blue washed out of what the fire
reaches so lit stone lands on the ember ramp and not on salmon), take the figure's cast shadow, are inked on their
contours (found on the dark side and at the foot, thin on the lit lip, lost in patches: `passSeatInk`) and are
drawn under the person who sits on them (the actor pass draws over a seat's ids).

Shadows (`engine/camp_ground.js`, `shadeGround`): a contact shadow under every touching column of a drawing (tight,
3 px), and a cast shadow thrown away from the fire from the figure's own drawing (each pixel at height y is thrown
2 y along the ground), fanning out with its length (a point of light), darker near the contact and fainter with height
and length. On the ground it is drawn, not blended: a mid tone and a dark core through an ordered dither, cooler than
the earth round it, so it reads at game size (the low cameras see it as a dark fan running away from the fire beside
each person). Weight in shot 7: the hand and the planted boot put up ash and grit when he pushes off (a few ragged
clouds that pop open in three drawings, rise, thin on the dither and settle over 0.5 s, with grit on arcs that lands and
lies there); on the hit the body squashes 3.5 % and rebounds, the cloak settles and each boot puts up a ring of
dust (`camp_fx.js`, world space, on twos, depth-tested against the figure but allowed to lie in front of it). Where the
effects go is taken from the drawings: the hand's cell point and the standing cut-out's boot pixels are unprojected
onto the card's plane. The last shot's first second keeps its camera low (the target rises only after the push-off) so
the crown, the hand's ash and the boot are in frame.

## Systems

| File | What it is |
|---|---|
| `camp_blocking.js` | The plan as data (tents included: size, yaw, sag, open flap): fire, seats, characters' facing and eyelines, the gestures and their times, the sky's Thread, the score's notes for the pulses, the seven cameras. `validate()` checks the eyelines meet and the cuts sit on notes. |
| `camp_previs.js` | A flat plan-view animatic (`?piece=camp_previs`): the layout from above, eyelines as dashed rays, each shot's lens as a wedge, the shot boundaries, the tune's notes and the crashes on a score bar. |
| `engine/camp_world.js` | A procedural night camp seen through a real perspective camera: sky, stars, the Thread, ridges, ground, tents, props, grass tufts in wind, the fire (flame, light, flicker, shadows), smoke, embers, figures composited with firelight, rim light and shadows. |
| `engine/camp_seats.js` | The two seats: the rock (planes, exact) and the blanket (height field), their lighting, ink, footprints and cast shadows, the pebbles and grass at the rock's foot. |
| `engine/camp_ground.js` | Contact occlusion, cast shadows (from the fire, from each figure's drawing and from the seats) and marks on the ground (decals). |
| `camp_fx.js` | Ash and dust kicked up by a hand or a boot (`puff`). |
| `motion/camp_blade.py` | Finds each drawing's sword blade (a line in cell px, in the clip's JSON) so camp.js repaints it as a clean two-pixel steel blade with a highlight line; the fast smear drawings keep their paint. |
| `camp_palette.js` | The camp's palette snap: the master ramps without the olive earth ramp. |
| `camp.js` | The seven shots (`?piece=camp`; `node tools/cutscene/render.mjs --piece camp --video out.mp4`). |

## Continuity notes

- One design per character: Edric's teal cloak and one pauldron; Sera's purple robe and her
  striped blanket; Kira's crimson coat and white ponytail (reads as neither man nor woman:
  no gendered words in Kira's prompts).
- Scale from the cut-outs' measured heights; seated figures are drawn at the same metres per
  pixel as their standing cut-outs.
- Gold is the Thread's alone. Firelight is orange and red, never the Thread's pale gold, and
  never sparkles.
- The Thread is written in the palette's own colours (halo goldHi, stitches paper, core goldWhite), never
  a blend of gold over the dark sky: a blend lands on the ember browns (the fire's) or the verdigris greens.
- The heat over the flames is a one-pixel ripple mixed half with its neighbour, over the background only:
  it has no colour of its own (a full row copy turned the torch-lit stakes into orange ribbons).
- The last frame of the whole opening (Edric at the fire looking into the camera, in full
  colour) is not used here. This scene ends with him standing, looking at the sky.
