# "The Ford": the vertical slice

A short clip (bars 28.3–36 of "Under the Broken Sun", about 13.6 s) that shows where the
Unwritten Page engine is heading. It contains one complete future: Edric crosses a ford
under the Hollow Sun, fights the Empire's spearman in the river and loses. Once this
clip works, the method gets folded back into "Again".

## Why: what is rough in "Again" now

Measured frame by frame in `px/again_bars28-56.mp4`:

1. **Treadmill motion.** The generated clips are stabilised on the body, so Edric runs
   on the spot and Rowan gallops on the spot. The plate behind them is still or drifts
   at a speed unrelated to the stride, so the feet slide and nothing carries weight.
2. **Stiff backgrounds.** Every plate is one painted still, panned as a flat card.
   There is no depth, weather or wind, and no water moving.
3. **Figures pasted onto places.** Figures never go into the water or touch the ground:
   there are no reflections, contact shadows or wading lines, and the light on them
   doesn't match the plate.
4. **Presentation, not action.** Most shots present a character (running, pointing)
   instead of showing two sides who both want something. The clash clip stalls after its
   ninth drawing: the model gave up and so did the shot.
5. **Rhythm.** Too many shots are the same size and the same length (about 1 bar), so
   the bursts-and-holds contrast measured in the reference openings is missing.

## How studios make an action scene (what we copy)

The method follows Mayshing's fight-design notes and TV-anime practice:

1. **Reference first.** Real longsword-against-spear fighting: a spear wins at range,
   so the sword has to get past the point. The bind. The *yield* (giving way in the bind
   so the attacker overcommits). Footing in water decides fights.
2. **Gesture drawings on a flat camera.** Plan the whole fight side-on, as stick
   figures on a cross-section of the river, before any dynamic camera. Every position,
   every step, who holds the initiative. That file (`ford_blocking.js`) is the single
   source of truth: the final shots place the fighters from it, so space stays
   continuous across cuts.
3. **Dynamic camera and environment.** Then shoot it: wide, then close, then a detail,
   then wide again. Pull back often enough that the audience knows where everyone is.
   The environment takes part: the water, the stones, the rain.
4. **Both fighters think.** "Bad fights happen when the author only thinks for the
   strong hero." The Warden (the Empire's spearman) has a plan and it works.

The TV-anime craft behind each shot:

| Technique | In this clip |
|---|---|
| **Tame, tsume** (hold, then snap) | Stillness before every hit; the hit lands on the drum. |
| **Hit-stop** | On a hit everything freezes for 2–4 frames: figures, particles, rain. Then it snaps on. |
| **Drawings on twos, camera on ones** | Figures change 12×/s, and 8×/s (threes) in the holds. Camera and particles move 24×/s. |
| **Impact frames** | 1–3 frames, two tones (ink and paper; crimson for the Empire's blow). |
| **Smears and multiples** | On every fast arc (the drop, the yield, the fall). |
| **Follow-through** | Cloak and hair keep moving after the body stops. |
| **Maemono** (foreground passing) | Reeds and stones close to the lens slide past faster than the subject. |
| **Wide backgrounds for pans** | Procedural: the world has no edge, so a pan never runs out. |
| **Aerial perspective** | Each ridge paler and cooler than the one before it. The background is always quieter than the figures (STYLE.md). |
| **Screen direction** | Ours move right, the Empire left. The camera crosses the line only once, when Edric loses control (the yield). |
| **Shot-size contrast** | Never two shots of the same size in a row. |
| **Environment reacts** | Footfall splashes, a spray sheet, ripple rings, a shock ring across the water on the clash, reeds flattening, rain bent by the blow. |

## The fighters' plans

- **Edric** (sword): he has to cross open water under a spear. His plan is to use the
  river: drop under the thrust, throw a sheet of spray to blind the Warden, and come up
  inside the spear's reach.
- **The Warden** (Empire spearman, black helm, crimson): he holds the shallows, where
  Edric has to slow down. He waits, and thrusts at the limit of his reach. When Edric
  gets inside and binds, he doesn't push back. He **yields**: he steps back and turns
  the shaft, and Edric's weight carries him onto a slick stone. Then comes the crimson
  cut. The Empire wins because it is patient and certain, not stronger.

## The ford (world space)

Metres. X runs along the crossing (our bank at X < −8, the Empire's at X > +8; 0 is
midstream). Y is up (the water surface is Y = 0). Z is depth, with the ford's line at
Z = 0. The river flows from the far hills toward the camera along Z, so the upstream
wide shot looks up the river to the ridges, with the Hollow Sun above and reflected in
the water.

Water depth by X: 0 at |X| = 8 (the banks), knee-deep (0.5 m) by |X| = 5, and 0.6 m
midstream. Stones break the surface at X ≈ −6, −1.5, +2, +3.8 (the slick one, where Edric
slips) and upstream.

## Blocking (the flat camera)

Bars and beats on the score (`at(bar, beat)`). One beat is 0.4 s.

| When | Edric | The Warden | The line (Empire) |
|---|---|---|---|
| 28.3 | (the roll: the rush down the Thread) | | |
| 29.1 | X −14, starts running right | X +9, on the bank | X +11…+14, in step |
| 30.1 | X −8.5, enters the water | steps into the shallows | a step, in unison |
| 30.3 | X −7 | X +4.5, plants his feet, levels the spear (reach 2.6 m) | halts |
| 31.1–31.4 | X −6 → −3, running in water: high knees, a splash each footfall | still. Waits. | |
| 32.2 | X −2.2: drops into a slide, a sheet of spray | **thrusts** at full reach: the point passes over Edric | |
| 32.4 | hidden in spray, sliding to X +0.8 | recovers the spear | |
| 33.1 | bursts up at X +2.0, inside the reach: **clash** at X +2.9 | blocks with the shaft at X +3.6 | |
| 33.3–34.3 | **the bind**: pushes | holds, gives ground half a step (X +3.8) | |
| 34.3 | | decides (a tilt of the helm) | |
| 35.1 | overbalances forward, right foot onto the slick stone at X +3.8 | **yields**: steps back to X +4.6, turns the shaft | |
| 35.3 | | **the crimson cut** across Edric's back | |
| 36.1–36.4 | falls onto his back in the river at X +4.2 | stands over him | |
| 36.4 | the paint begins to lift off the page (this future is scraped off) | | |

## Shot list (the dynamic camera)

| # | Bars | Size | Shot |
|---|---|---|---|
| 1 | 28.3–29.1 | — | The rush down the Thread (the roll); white on the crash |
| 2 | 29.1–30.1 | extreme wide | Crane down from the Hollow Sun, through the clouds and ridges, to the upstream wide of the ford: Edric tiny on our bank, starting to run; the Empire's line on the far bank; rain; the sun's reflection breaking in the current |
| 3 | 30.1–30.3 | low, at the water | The Warden's boots step into the shallows (ripple rings), the line behind him stepping in unison |
| 4 | 30.3–31.1 | medium, frontal | The spear levels straight at the lens (the point drawn in code, foreshortened), focus lines. Held |
| 5 | 31.1–31.4 | medium, tracking profile | Edric runs through the ford, feet locked to the riverbed, splashes on each footfall, reeds and stones passing the lens, the far bank sliding slower |
| 6 | 31.4–32.1 | extreme close-up | Edric's eye: the spear point is in it |
| 7 | 32.1–32.3 | over the Warden's shoulder | Edric charges toward camera; **thrust** on 32.2, the spear shooting away from us |
| 8 | 32.3–32.4 | wide, low | Edric drops into a slide, the spray sheet erupts, the point passes through the spray |
| 9 | 32.4, 32.4.5, 32.4.75 | three one-sixteenth cuts | Spray wall, the helm's eye slit, a shape moving in the spray |
| 10 | 33.1–33.3 | medium-wide | **The clash**: Edric bursts through, impact frames, sparks, hit-stop, a shock ring across the river |
| 11 | 33.3–34.3 | tight two-shot | The bind. A slow orbit (background one way, reeds the other), sparks grinding on twos, rain, breath. The hold |
| 12 | 34.3–35.1 | close-up | The helm's eye slit. A tilt. He decides |
| 13 | 35.1–35.3 | medium, **crossing the line** | The yield: the Warden steps away, Edric pitches forward, the slip, a smear; the camera whips round |
| 14 | 35.3–35.4 | — | **The crimson cut**: negative crimson impact frames, hit-stop |
| 15 | 35.4–36.1 | close-up | Edric's face; the spray hangs in the air (time slowed) |
| 16 | 36.1–36.4.x | wide, low | He falls onto his back in the river; the splash settles; ripples; the Hollow Sun in the water; the rain. On the last beat's fill the paint lifts off the page, a stutter at a time |

## Systems

| System | File | What it adds |
|---|---|---|
| The world | `engine/world.js` | A procedural 2.5D place seen through a real perspective camera: sky and clouds, ridges with aerial perspective, mist, the river with current, ripples and reflections, banks, stones, reeds in gusting wind, rain, foreground passing the lens. Actors (figures) are composited into it at their world position: sorted by depth, waded (cut at the waterline, with a ripple ring), reflected. Painted in our materials, and drawable at a paint stage so the rewind still works. |
| Locomotion | `motion/contacts.py`, `engine/locomotion.js` | The feet in each generated clip: which foot is planted, where, and footfall times. The root advances so the planted foot stays put on the ground: the end of the treadmill. |
| Blocking and previs | `ford_blocking.js`, `ford_previs.js` | The flat-camera plan above as data (positions, facing, actions over time), and a stick-figure animatic of it seen side-on. The final shots place the fighters from the same data. |
| The piece | `ford.js` | The 16 shots. |

## What new art would lift it further (for the local session)

The Warden has no generated motion. His drawings come from the clash clip and his
cut-outs. A later batch should add these, as GPT cut-outs on green in the dense Empire
style, then MiniMax clips from them:

- the Warden's guard in the water
- the thrust at full extension
- the yield (a step back, the shaft turning)
- the cut's follow-through
- Edric's slide under the thrust

