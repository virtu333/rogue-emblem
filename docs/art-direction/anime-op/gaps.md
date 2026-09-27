# Anime opening: gaps

What we have for each part of "Again", what is missing, and who makes it: a new image
(batch 3 or 4) or code. File names are in `refs/` and `cutouts/`; verdicts are in
[catalog.md](catalog.md).

**Short version:** every beat has usable images now. Batch 3
([prompts-batch-3.md](prompts-batch-3.md)) fills the remaining shot gaps and adds model
sheets for the rig. Everything else that is missing is code.

## By beat

| Bars | We have | Missing | Made by |
|---|---|---|---|
| **1–4** flashes, boots | Edric's eye, the hilt, the Empire boots, the marching soldier (for boots stamping in rank) | The gold thread and black sun flashes | Code (thread, Hollow Sun). The diagonal-panel layout from the old `18-vocal-chop-drop` is a good template. |
| **5–12** camp, Thread, Edric rises | Camp plate (tall, with a sky band for the Thread), Edric at the fire, Edric looking up, Edric standing | The Thread across the sky; the logo | Code. Batch 4 could add the other lords at the camp. |
| **13–20** cross-cut | Six cast cards, Edric charging and standing, the bridge wide shot, the marching soldier, the front-on soldier, the road plate | Officers; tileable road edges | Batch 3 C1–C3 (officers). Code matches the road edges. |
| **21–28** the seers | Sera's eyes and the Lieutenant's eyes (mirrored pair), Sera at the window, the Emperor | A Lieutenant medium shot and a full body in style; a Sera closeup in style; the white rush down the Thread on the roll | Batch 3 A3, A5, C4. Code (the rush). |
| **29–44** chorus | Edric charge, stumble and collapse; ford, bridge, fens, stair and ridge plates; the cast for the army | Sera running beside Edric; Sera's hands as the thread frays; the army at first light (plate); the frame freezing and cracking; the Hollow Sun behind the charge | Batch 3 A1, A2, A4. Code (the crack, the sun, sunset removal on the bridge and fens). |
| **45–48** the hymn | The hymn plate, the thread-on-paper study | Sera's hands on the thread (A2 frame 1 doubles for it); the violet drain | Batch 3 A2. Code (the drain). |
| **49–52** rewind | Every earlier shot | The paint-stage layers (wash, line, pencil, paper) for each shot | Code, unless the batch 3 Part D test shows the image model can redraw a shot as lines without moving anything. |
| **53–56** ending | Edric's final frame (looks into the camera, full colour), the thread-in-silence study | The Hollow Sun and ROGUE DAWN title | Code. |

## For the rig (batch 3 Part B)

Model sheets for all seven lords: a four-view turnaround (front, three-quarter, side,
back) and heads at the cast card's exact angle, with eyes closed and mouth open for
blinks and shouts. They also fix the look so later images stop drifting, above all
Edric's hair.

## Fixes code has to make on images we already have

| Image | Fix |
|---|---|
| `b29_bridge_plate`, `b29_fens_plate` | Remove the sun, cool the grade (tested). |
| `b45_hymn_plate`, `b21_sera_window`, `b13_bridge_hand_in_hand` | Crop the torn paper border; code draws the page edge. |
| `b45_hymn_plate` | Cover the painted thread; code draws it. |
| `cutouts/kira` | Paint out a small pale-blue glint behind the head. |
| `b13_empire_road_plate` | Match the left and right edges so it tiles. |
| `cutouts/astrid`, `cutouts/rowan` | Scale about 1.45x against the figures on foot. |

## Batch 4 (only if needed)

Candidates, none written yet:

- Allied foot soldiers, two or three variants facing right, so the army at first light
  is more than seven people.
- The other lords at the camp on the night before (seated, on green).
- Sera kneeling in the hymn, eyes closed, pulling the thread back.
- An Empire throne hall plate for the Emperor, painted dense and flat.
- Model sheets for the Emperor and the Lieutenant.
- Line and pencil redraws of every shot, if the Part D test works.
- Anything batch 3 misses.
