# Anime opening: GPT image prompts, batch 1

Style: **The Unwritten Page** (see the sketchbook tests in `~/Downloads/rogue-dawn-sketchbook-tests`).
Each prompt is the preamble plus the shot. Attach the named PC-98 portrait from
`public/assets/portraits/pc98/192/` as the identity reference. The portraits win.

## Preamble (paste first, every time)

> Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
> ink linework inside the figure, one confident thicker contour around the whole
> silhouette, pale transparent watercolour washes that stop short of the lines, smooth
> cool bone-grey vellum with only faint grain. Worn, layered, handled cloth and leather;
> no ornate armour. Full bleed: no torn paper edge, no border, no frame. No gold thread
> unless the shot asks for one. No skulls, spikes, runes, text or signature.

What changed from the test prompt, and why (from the 480×270 pixel previews):

- **Full bleed, no torn edge.** The deckled border gets in the way of camera moves and
  crops. Code will draw the page edge as an overlay.
- **Smooth paper, faint grain.** Heavy grain becomes speckle noise at game size.
- **No thread by default.** At game size the painted thread becomes a dull 1 px brown
  line. The thread must animate anyway (stitch, fray, rush), so code draws it. Ask for it
  only where it is the subject (hands, closeups).
- **Landscape images come back 3:2 (1536×1024).** The game crops them to 16:9, so keep
  the subject in the middle 864 px band.

## Batch 1 (the shots with nothing yet)

| # | File name | Beat | Type | Attach |
|---|---|---|---|---|
| 1 | `b05_camp_night_plate` | 5–12 | tall plate | none |
| 2 | `b05_edric_at_fire` | 5–12, 53–56 | cut-out | `lord_edric.png` |
| 3 | `b53_edric_looks_up` | 53–56 | key (final frame) | `lord_edric.png` |
| 4 | `b01_edric_eye` | 1–4 | closeup | `lord_edric.png` |
| 5 | `b01_hilt` | 1–4 | closeup | `lord_edric.png` |
| 6 | `b13_empire_soldier` | 13–20 | cut-out (tiled by code) | `boss_the_lieutenant.png` (for livery) |
| 7 | `b21_sera_eyes` | 21–28 | closeup | `lord_sera.png` |
| 8 | `b21_lieutenant_eyes` | 21–28 | closeup | `boss_the_lieutenant.png` |
| 9 | `b21_emperor` | 21–28 | cut-out | `boss_the_emperor.png` |
| 10 | `b29_edric_charge` | 29–44 | cut-out | `lord_edric.png` |
| 11 | `b29_edric_falls` | 29–44 | cut-out | `lord_edric.png` |
| 12 | `b29_ford_plate` | 29–44 | plate | none |

### 1. Camp, the night before (tall plate)

> [Preamble] Night. A small war camp in a hollow between low hills: five patched canvas
> tents, a picket line, spears stacked in a tripod, a campfire in the lower third with
> nobody at it yet. Above, a very tall, empty night sky in violet-grey wash, with a clear
> band of bare paper across it where something will later be drawn. Composed for a slow
> vertical tilt from the fire up into the sky. No people. 1024×1536.

### 2. Edric at the fire (cut-out)

> [Preamble] Lord Edric (attached reference: shaggy chestnut-brown hair, deep teal cloak,
> one steel pauldron on his right shoulder), sitting on a low log, forearms on his knees,
> longsword sheathed and leaning against his leg, looking down into an unseen fire in
> front of him. Warm light from below on his face and hands only. Full body, three-quarter
> view, on a flat pure #00FF00 background, no log shadow on the ground. 1024×1536.

### 3. Edric looks up (the final frame)

> [Preamble, but replace "pale transparent watercolour washes" with "full, rich, opaque
> gouache colour"] Medium close-up of Lord Edric (attached reference) at night beside a
> campfire, lit warm from below, who has just looked up from the fire straight into the
> camera: calm, tired, resolved. Dark violet night behind him, a few embers rising. This
> is the only fully painted frame in a sketchbook of pale studies. Subject centred in the
> middle 16:9 band. 1536×1024.

### 4. Edric's eye (flash)

> [Preamble] Extreme close-up of one eye of Lord Edric (attached reference: brown eye,
> shaggy chestnut hair falling across the brow), open wide, the iris reflecting a thin
> gold ring. Horizontal strip composition filling the middle of the frame, plain dark
> ink-wash field above and below. 1536×1024.

### 5. The hilt (flash)

> [Preamble] Extreme close-up of a gloved right hand closing on a plain steel longsword
> hilt: worn leather grip, simple crossguard, a single turn of gold thread tied around
> the wrist. Plain dark ink-wash field. 1536×1024.

### 6. Empire soldier (cut-out, tiled by code into marching ranks)

> [Preamble, but the soldier is drawn in dense, flat iron-gall black and crimson
> lacquer, fully painted, no paper showing through] An imperial infantryman marching in
> strict drill step, left foot forward, pike held upright at his right side, closed iron
> helm hiding the face, crimson lacquered cuirass and tabard. Strict side profile facing
> right. Full body, centred, on a flat pure #00FF00 background, no ground shadow.
> 1024×1536.

### 7. Sera's eyes (mirrored pair, 1 of 2)

> [Preamble] Extreme close-up of Sera's eyes (attached reference: gold-green eyes, long
> wavy crimson hair across the brow), looking straight at the camera, a thin gold thread
> reflected across both irises. Horizontal strip across the middle of the frame, plain
> dark violet wash above and below. 1536×1024.

### 8. The Lieutenant's eyes (mirrored pair, 2 of 2)

> [Preamble] Same framing as a matching shot of a woman's eyes: extreme close-up of the
> Lieutenant's eyes (attached reference: black hair with a white streak, crimson cracks
> across the left side of his face, the left eye red), looking straight at the camera,
> a snapped crimson thread reflected across the irises. Horizontal strip across the middle
> of the frame, plain dark crimson-black wash above and below. 1536×1024.

### 9. The Emperor (cut-out)

> [Preamble, but the Emperor is drawn in dense, fully painted black, gold and crimson,
> no paper showing through] The Emperor (attached reference: older man, stern, gold
> crown, dark blue-black plate armour with gold trim, crimson cloak), seated upright on a
> plain stone throne, hands on its arms, looking down at the viewer. Low angle. Full body
> and throne, centred, on a flat pure #00FF00 background. 1024×1536.

### 10. Edric charges (cut-out)

> [Preamble] Lord Edric (attached reference) running straight toward the camera, low
> angle, longsword held low in his right hand, teal cloak streaming behind him, mouth
> open in a shout. A held, readable pose: both feet visible, no limbs crossing the body.
> Full body, centred, on a flat pure #00FF00 background, no ground shadow. 1024×1536.

### 11. Edric falls (cut-out)

> [Preamble] Lord Edric (attached reference) fallen to one knee, the longsword point
> driven into the ground and both hands on the hilt holding him up, head bowed, cloak
> torn and pooled around him. Side view facing right. Full body, centred, on a flat pure
> #00FF00 background, no ground shadow. 1536×1024.

### 12. The ford (plate; Edric's fall is composited on it)

> [Preamble] A shallow river ford at dusk seen from ground height: flat stones crossing
> the water, broken spears and a torn blue banner caught against the stones, reeds, low
> hills behind. Open ground centre-left where a kneeling figure will be placed. No
> people. 1536×1024.

## Batch 2 (after batch 1 is reviewed)

- Cast cards on green for the other lords: Sera, Kira (Tactician), Astrid (Sky Lancer,
  with her winged mount), Voss (Ranger), Rowan (Chevalier), Cael (Sentinel).
- Fall plates to match the ford: bridge, fens, stair.
- One or two officers, and a lockstep Empire column plate (no people, only the road)
  for the tiled soldiers.
- The white rush down the thread (bar 28) and the frame cracking (bar 44) are FX in
  code, not images.
