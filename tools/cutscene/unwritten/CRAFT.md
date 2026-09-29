# Craft: what works, from "The Ford"

Rules learned the hard way while hand-editing "The Ford" (FORD.md, `ford.js`). Read this
before writing or polishing any shot. ENGINE.md says how the engine works; this says how
to make it look right.

## The method

1. **Plan before shooting.** Write the direction (what reads wrong now, what each
   character wants), then block it flat as data (`*_blocking.js`, with a stick-figure
   previs), then shoot the dynamic camera from that data. Positions, reach and timing
   come from the blocking, so space stays continuous across cuts.
2. **Review frame by frame, at 24 fps, at full size.** A contact sheet at 2 fps hides
   almost everything the owner notices. For every shot, render its range as a tile
   (`seg.sh`-style: render the range, `ffmpeg -vf fps=24,tile=...`) and look at each
   frame. Then render full-size stills of the key frames. Judge at 1× and 4×.
3. **Fix by hand, then look again.** Every fix gets re-rendered and re-read before it is
   kept. Most first fixes are wrong in some small way.
4. **Commit each fix with a message that says what was wrong and what changed.**

## Motion

- **No treadmills.** Anything that walks or runs is locked to the ground by its clip's
  measured contacts (`Stride`, `lockToWorld`), with a splash or dust puff on each footfall.
- **No sliding stills.** A still cut-out carried along the ground reads as hopping or
  skating. Use a clip made from that character's own drawing (MiniMax, first/last frame)
  or a skinned pose (`skin.js`, small bends only). Never a bob on a still.
- **Hold, snap, settle.** Anticipation before every strike, the strike in one or two
  drawings, overshoot and settle after (`keyMove`). Figures on twos (threes in holds),
  camera on ones.
- **Hit-stop** on hits: freeze figures, particles, rain and water together, then catch
  up (`hitStop`). The camera keeps the score's clock.
- **Contact has consequences.** A blow rocks the one who takes it back and carries the
  one who gives it through. A slip pitches the body before the fall. Characters never
  freeze while the other acts.
- **A fall is gravity plus rotation**, with the camera following, the landing on a drum,
  a splash that covers the change of drawing, and a settle (bob, rock).
- **Use only the good part of a generated clip.** Models wander, float, straighten up
  or add an overhead wind-up. Schedule drawings (`frameAt`) to the part that reads, skip
  single bad drawings, and hand-fix the atlas when needed (`motion/fix_*.py`).

## Continuity (what the owner catches first)

- **One design per character across cuts.** Same costume, same cape or no cape, same
  weapon. A generic clip standing in for a named character breaks the cut.
- **Props keep their size.** The Warden's spear is about 2.4 m in every shot. Measure it
  in metres on each drawing (helm-to-sole = 1.9 m gives metres per px) and fix drawings
  that disagree.
- **One weapon, held.** No floating second shaft, no stub, no weapon a code prop draws
  over a painted one that doesn't meet the hands. A code-drawn prop must attach to the
  painted hands exactly, or not be used.
- **Scale is consistent.** Every clip and cut-out has its metres-per-px (`mpp`) measured
  on the drawing, not guessed.

## Environment

- **Figures are in the world, not on it.** Wading: the legs show through the water,
  refracted and tinted, with a wet band and broken foam at the surface. On land: a
  contact shadow. Reflections in water.
- **Anime water is flat white blobs under one ink contour**, with a pale shadow side,
  stretched a little along their motion, capped in size so it never turns to polka dots.
  Never dithered noise, never picket-fence streaks.
- **The background is quieter than the figures.** Distant figures lose their contour and
  thin to lines (a far spear is one pixel, not a pillar).
- **Entropy at the scale of the picture:** uneven ridges, a river that bends, no ruled
  horizons, found/soft/lost edges.
- **Nothing reveals the page by accident.** A plate that rotates or shakes is overscanned
  over a dark underlay.

## Grounding (the owner's test: "is it real?")

Every figure and object must be physically held up by something you can see, and touch
the world where it rests. Check each one, every shot:

- **What carries the weight?** A seated or crouching figure sits on a visible log, crate,
  rock or the ground, with the seat drawn and occluding correctly. A squatting figure's
  heels and toes are on the ground. Nothing hovers.
- **Contact points** (feet, knees, hands, a seat, a spear butt) sit exactly on the
  surface: no gap, no overlap into it. Measure the lowest opaque pixels of the drawing
  against the ground at that depth.
- **Contact shadows** under every contact: a small dark, tight shadow right at the
  contact (ambient occlusion), and, where there is a light source, a cast shadow in the
  direction away from it (the fire), longer and softer farther from the contact.
- **Light matches the place.** A figure by a fire is lit from the fire's side, rim-lit on
  that side, dark on the far side; the ground under it takes the same light pool.
- **Weight shows in motion.** A foot sinks a little on landing, cloth settles after a
  move, a figure that sits shifts its weight onto the seat.
- **Scale and depth agree.** A figure's size, its foot height on screen and its shadow
  must all agree with the camera and its distance. Background figures stand on the
  ground at their depth, overlap and are overlapped by what is in front of them, and
  take the same haze as the ground around them.
- **Background figures are grounded too.** A rank of soldiers stands on the bank with
  feet on it, shadows under them, reflections in water when near it, the bank edge in
  front of their boots where the terrain would hide them. No floating clump.

## Effects

- **Focus and speed lines are seasoning.** Thin, few, kept off faces and helms. If the
  effect is the first thing you see, it is too strong.
- **Impact frames** are 1–3 frames, two tones (ink/paper, or crimson for the Empire).
- **The Empire's cut is a crimson crescent**, swept in one drawing, held, then broken with
  spatter. Not a bar lying on the figure.
- **Gold is the thread's alone.** No gold droplets, sparks or highlights elsewhere.

## Close-ups

- A still close-up must still act: a head snap on a hit (two drawings), a breath, a lift
  and snap of a helm about its neck, an eye that catches the light. Move the drawing, not
  only the camera.

## Tools

- `render.mjs --piece <p> --stills a,b --out dir` and `--video file --from a --to b`
  (clear `<file>.frames` first: the renderer reuses cached frames). Chromium:
  `CHROMIUM_PATH=/opt/pw-browsers/chromium`.
- MiniMax clips: `motion/jobs.json`, `motion/minimax.mjs` (the key comes from the
  environment's proxy; node needs `NODE_USE_ENV_PROXY=1
  NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`), `motion/clip.py`, `motion/contacts.py`.
  H3 768P is about $0.40 per 5 s clip. Make first and last frames from the character's
  own cut-outs; give the move room in `place`.
- MiniMax `image-01` cannot hold this style. New stills come from GPT prompts the owner
  runs (see the `prompts-batch-*.md` files).
