# Generated frames: previs, keys, takes, cut

The method behind `ford_gen` and `camp_gen` (Oct 2026). The code-drawn versions (`ford.js`,
`camp.js`) composited still cut-outs into a procedural world, and figures kept floating or
facing the wrong way because nothing in a cut-out was ever standing on that ground. Here the
video model draws whole frames with the ground, the contact and the light in them, and it
works from a 3D blocking, so who faces whom and where each foot lands is decided before any
art.

## The steps

| Step | Tool | Output (References/, not in git) |
|---|---|---|
| 1. Blocking | `ford_blocking.js`, `camp_blocking.js` (validate() checks reach, contact, timing on the score) | |
| 2. 3D previs | `previs3d/export_*.mjs`, then `blender -b -P previs3d/*_scene.py` (mannequins with a yellow nose and chest plate for facing, the real ground, the shot cameras) | `cutscene/previs3d/` |
| 3. Storyboard | `boards/<scene>.json`: takes (one camera, 4 s or more), each with its action and reaction to the second | |
| 4. Previs per take | `previs3d/takes.py previs` | `cutscene/takes/<scene>/<id>/previs.mp4`, `first.png` |
| 5. Keys | `takes.py keys`: Nano Banana Pro and Seedream v5 redraw the previs frame with the cast refs; `previs3d/keysheet.py` tiles them; copy the pick to `key.png` | `key_*.png` |
| 6. Motion | `takes.py motion`: Seedance 2.5 reference-to-video (key as the look, previs as @Video1); close-ups without a previs run image-to-video | `motion_480p.mp4` |
| 7. QA | `takes.py sheet`: 12 frames beside the previs. Check facing, contact, extra people, mannequins leaking in | `motion_480p_sheet.png` |
| 8. Edit | `boards/make_edits.py` writes `boards/<scene>_edit.json`: each cut a slice of a take (`src`, `rate`, `hold`) with the engine's hit-stops, shakes, impact frames and camera | |
| 9. Cut | `previs3d/cut_clips.py <scene>` packs each cut's span as a plate clip | `cutscene/gen_motion/` |
| 10. Render | `node tools/cutscene/render.mjs --piece ford_gen --video out.mp4` (`gen.js`) | |

`motion/fal.mjs` runs any fal.ai model (local files are uploaded); `motion/fal_spend.py`
estimates spend from its log. `previs3d/dailies.py` lays takes side by side with shot names.

## What we learned on the first pass

- **The model follows the blocking video closely**: timing, facing and contacts from the
  previs come through (the clash, the slip, the cut across the chest, the fall).
- **A key that disagrees with the previs wins at the start and loses later**: when a camera move
  reveals what the key left out, the model invents it (a second Sera). Draw the key from the
  previs frame, with the same people in frame.
- **Mannequins can leak** into the picture where the previs shows one the key does not: every
  prompt now says there are none.
- **Generated timing drifts**: actions land up to 2 s from where the prompt put them. The edit
  list places each cut on the score with `dsrc`/`src`, so a take is never regenerated for timing.
- **480p drafts are enough**: the engine draws at 480x270.
- **A take may add people near its end**: use the part before, and `hold` a drawing.
