# Anime opening: gaps

What we have for each part of "Again", what is missing, and who makes it: a new image
or code. File names are in `refs/` and `cutouts/`; verdicts are in
[catalog.md](catalog.md).

**Short version (after batch 3):** every shot has usable images. No shot is waiting on
a new image. Batch 4 ([prompts-batch-4.md](prompts-batch-4.md)) is for quality:

- distinct faces for the young cast (the owner's note on batch 3);
- soldiers to fill out the army;
- the other lords at the camp.

Everything else that is missing is code.

## By beat

| Bars | We have | Missing | Made by |
|---|---|---|---|
| **1–4** flashes, boots | Edric's eye, the hilt, the Empire boots, the marching soldier | The gold thread and black sun flashes | Code (thread, Hollow Sun). The diagonal-panel layout from the old `18-vocal-chop-drop` is a good template. |
| **5–12** camp, Thread, Edric rises | Camp plate, Edric at the fire, Edric looking up, Edric standing | The Thread across the sky; the logo; the other lords at the camp | Code. Batch 4 D1–D2 (Sera and Kira at the camp). |
| **13–20** cross-cut | Seven lords, the Empire column (soldier, standard-bearer, drill officer, mounted officer), the road plate, the bridge wide shot | Tileable road edges | Code. |
| **21–28** the seers | Sera's eyes and the Lieutenant's eyes (mirrored pair), Sera at the window, Sera close-up, the Lieutenant with the threads and in full, the Emperor, the officers | The white rush down the Thread on the roll | Code. |
| **29–44** chorus | Edric's charge, stumble and collapse; Sera running; the fray strip; ford, bridge, fens, stair, ridge and first-light plates; the cast for the army | The frame freezing and cracking; the Hollow Sun; more soldiers in the army | Code. Batch 4 C1–C2 (allied soldiers). |
| **45–48** the hymn | The hymn plate, the thread-on-paper study, fray strip frame 1 | Sera kneeling; the violet drain | Batch 4 D3. Code (the drain). |
| **49–52** rewind | Every earlier shot | The paint-stage layers | Code. The batch-3 test ruled out generated line redraws: they move shapes. |
| **53–56** ending | Edric's final frame, the thread-in-silence study | The Hollow Sun and ROGUE DAWN title | Code. Batch 4 B1 if Edric's new face is adopted. |

## For the rig

Batch 3 gave turnarounds for all seven lords, and heads for Voss and Cael that can be
used as they are. The other five head sheets are replaced by batch 4 Part A:

- distinct faces, per STYLE.md → Faces;
- all heads facing right;
- the same outline and hair in every head, so heads can swap.

Code adds one mark per head: Edric's eyebrow nick, Astrid's mole, Rowan's freckles.

## Fixes code has to make on images we already have

| Image | Fix |
|---|---|
| `b29_bridge_plate`, `b29_fens_plate` | Remove the sun, cool the grade (tested). |
| `b45_hymn_plate`, `b21_sera_window`, `b13_bridge_hand_in_hand` | Crop the torn paper border; code draws the page edge. |
| `b45_hymn_plate` | Cover the painted thread; code draws it. |
| `cutouts/kira` | Paint out a small pale-blue glint behind the head. |
| `b13_empire_road_plate` | Match the left and right edges so it tiles. |
| `cutouts/astrid`, `cutouts/rowan`, `cutouts/officer_mounted` | Scale about 1.45x against the figures on foot. |
| `ms_edric_heads`, `ms_astrid_heads` | Face left; flip in code if used before batch 4 lands. |
| Head sheets | Align the eyes between heads before swapping (not registered). |

## Villains (batch 5)

The owner extended the Unwritten Page style to every cutscene, so the villains the
cutscene plan puts on screen are in [prompts-batch-5.md](prompts-batch-5.md):

- the Lieutenant (model sheet, back turned, fallen, the Sanctum and the landing);
- the Emperor (model sheet, the hand on the Roll and slipping off it, the throne hall);
- a bust of each of the eight act bosses, for the boss encounter cut-in;
- the Entity's eyes in the dark.

## Later, only if needed

- Face descriptions for the officers, if they get closeups.
