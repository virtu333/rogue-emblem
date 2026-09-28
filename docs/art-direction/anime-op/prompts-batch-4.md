# Anime opening: GPT image prompts, batch 4

Style: **The Unwritten Page** ([STYLE.md](STYLE.md)). Faces follow the table in
STYLE.md → Faces. Verdicts on batches 1–3 are in [catalog.md](catalog.md).

**Send each prompt exactly as written**, and attach every reference listed. The PC-98
portrait (`public/assets/portraits/pc98/192/`) fixes identity. The earlier images (in
`~/Downloads/…`) fix the costume and the drawing style.

| Part | What | Count |
|---|---|---|
| A | Head sheets with distinct faces (the main job) | 5 |
| B | Closeups redone so their faces match the new heads (optional) | 2 |
| C | Allied foot soldiers for the army at first light | 2 |
| D | The camp and the hymn | 3 |

## Part A: head sheets with distinct faces

These replace the batch-3 heads for Edric, Sera, Kira, Astrid and Rowan. Voss and Cael
keep theirs. Two changes from batch 3:

- **The face is described.** Each character's face shape, eyes, brows, nose and mouth
  are fixed, so the young cast stop sharing one face.
- **The heads are built to swap.** Every head has the same outline, hair and collar;
  only the eyes, brows and mouth change. Code can then swap them for blinks and speech.
  All heads face **right**, the direction our side faces.

| # | File name | Attach |
|---|---|---|
| A1 | `ms2_edric_heads` | `lord_edric.png` + `batch-3/ms_edric_turn.png` + `batch-1/b29_edric_charge.png` |
| A2 | `ms2_sera_heads` | `lord_sera.png` + `batch-3/ms_sera_turn.png` + `batch-2/b13_card_sera.png` |
| A3 | `ms2_kira_heads` | `lord_kira.png` + `batch-3/ms_kira_turn.png` + `batch-2/b13_card_kira.png` |
| A4 | `ms2_astrid_heads` | `lord_astrid.png` + `batch-3/ms_astrid_turn.png` + `batch-2/b13_card_astrid.png` |
| A5 | `ms2_rowan_heads` | `lord_rowan.png` + `batch-3/ms_rowan_turn.png` + `batch-2/b13_card_rowan.png` |

### A1. Edric

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. SIX heads of
Lord Edric (attached references), in two rows of three. HIS FACE: a square jaw, heavy
straight brows set low over deep-set, tired brown eyes, a nose with a slight bend where
it was broken once, a firm plain mouth; a young man who has not slept enough. Dark
chestnut-brown shaggy hair, NOT red or auburn; teal cloak collar at the neck.
EVERY head FACES RIGHT in the same three-quarter view, at EXACTLY THE SAME ANGLE, SIZE
AND POSITION, with IDENTICAL hair, head outline, ear, neck and collar in all six, like
one drawing traced six times; ONLY the eyes, brows and mouth change. Top row: 1 calm,
eyes open; 2 IDENTICAL TO 1 WITH EYES CLOSED; 3 shouting, mouth wide open. Bottom row:
4 teeth gritted in pain; 5 the ghost of a tired smile; 6 speaking, mouth half open. On a
flat pure #00FF00 background, evenly spaced, margin all round. No text, no labels.
1536×1024.
```

### A2. Sera

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. SIX heads of
Sera (attached references), in two rows of three. HER FACE: a long oval face,
heavy-lidded gold-green eyes, a long straight nose, a full, quiet mouth, faint shadows
under the eyes, as if she has seen too much and slept too little; not a generic pretty
face. Long wavy crimson hair, purple robe collar with cream trim.
EVERY head FACES RIGHT in the same three-quarter view, at EXACTLY THE SAME ANGLE, SIZE
AND POSITION, with IDENTICAL hair, head outline, neck and collar in all six, like one
drawing traced six times; ONLY the eyes, brows and mouth change. Top row: 1 calm and
focused, eyes open; 2 IDENTICAL TO 1 WITH EYES CLOSED; 3 crying out, mouth open. Bottom
row: 4 eyes wide, seeing something terrible; 5 a small, sad smile; 6 eyes closed, brows
drawn together in effort. On a flat pure #00FF00 background, evenly spaced, margin all
round. No text, no labels. 1536×1024.
```

### A3. Kira

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. SIX heads of
Kira (attached references), in two rows of three. THE FACE IS ANDROGYNOUS: it reads as
neither clearly a young man nor a young woman. A long, narrow face, straight level
brows, narrow hooded grey eyes, a thin straight mouth, the chin as in the attached
references; cool, dry, quick. Silver-white hair in a high ponytail, black scarf, high
oxblood collar.
EVERY head FACES RIGHT in the same three-quarter view, at EXACTLY THE SAME ANGLE, SIZE
AND POSITION, with IDENTICAL hair, head outline, neck and collar in all six, like one
drawing traced six times; ONLY the eyes, brows and mouth change. Top row: 1 dry and
neutral, eyes open; 2 IDENTICAL TO 1 WITH EYES CLOSED; 3 calling out an order, mouth
open. Bottom row: 4 eyes narrowed, calculating; 5 a small knowing smile; 6 speaking,
mouth half open. On a flat pure #00FF00 background, evenly spaced, margin all round. No
text, no labels. 1536×1024.
```

### A4. Astrid

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. SIX heads of
Astrid (attached references), in two rows of three. HER FACE: a heart-shaped face,
large round blue eyes, a short upturned nose, a wide mouth, strong eyebrows; bold and
open. Blonde high ponytail tied with a blue ribbon, blue scarf.
EVERY head FACES RIGHT in the same three-quarter view, at EXACTLY THE SAME ANGLE, SIZE
AND POSITION, with IDENTICAL hair, ribbon, head outline, neck and scarf in all six,
like one drawing traced six times; ONLY the eyes, brows and mouth change. Top row:
1 alert, eyes open; 2 IDENTICAL TO 1 WITH EYES CLOSED; 3 battle cry, mouth open. Bottom
row: 4 a bright, fearless grin; 5 worried, brows raised; 6 speaking, mouth half open. On
a flat pure #00FF00 background, evenly spaced, margin all round. No text, no labels.
1536×1024.
```

### A5. Rowan

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. SIX heads of
Rowan (attached references), in two rows of three. HIS FACE: a broad, round face, a
wide nose, an easy grin with a small gap between the front teeth, warm brown eyes;
friendly and a little rough. Tousled copper-orange hair, cream scarf.
EVERY head FACES RIGHT in the same three-quarter view, at EXACTLY THE SAME ANGLE, SIZE
AND POSITION, with IDENTICAL hair, head outline, neck and scarf in all six, like one
drawing traced six times; ONLY the eyes, brows and mouth change. Top row: 1 easy grin,
eyes open; 2 IDENTICAL TO 1 WITH EYES CLOSED; 3 charging yell, mouth open, the tooth gap
visible. Bottom row: 4 serious and determined; 5 laughing; 6 speaking, mouth half open.
On a flat pure #00FF00 background, evenly spaced, margin all round. No text, no labels.
1536×1024.
```

## Part B: closeups redone with the new faces (optional)

Only if the new faces in Part A are clearly better. Otherwise the batch-2 and batch-3
closeups stay.

| # | File name | Replaces | Attach |
|---|---|---|---|
| B1 | `b53_edric_final_frame_v2` | `batch-2/b53_edric_final_frame` | `lord_edric.png` + `batch-2/b53_edric_final_frame.png` + the A1 sheet |
| B2 | `b21_sera_closeup_v2` | `batch-3/b21_sera_closeup` | `lord_sera.png` + `batch-3/b21_sera_closeup.png` + the A2 sheet |

### B1. Edric's final frame

```
Medium close-up portrait, painted in full, rich, opaque gouache colour, unlike a pale
sketch: this is the one finished painting in a book of pale studies. Fine sepia ink
contours, one thicker outline around the figure. Keep the composition, pose, light and
colour of the attached final-frame painting EXACTLY, and repaint only the face to match
the attached expression sheet: a square jaw, heavy straight brows low over deep-set
tired brown eyes, a nose with a slight bend where it was broken once, a small nick
through one eyebrow. Lord Edric at a campfire at night looks STRAIGHT INTO THE CAMERA:
calm, tired, resolved, the ghost of a smile. Dark chestnut hair, NOT red or auburn;
teal cloak; steel pauldron. Warm firelight from below. Dark violet night, a few embers.
No text, no border, no gold thread. 1536×1024.
```

### B2. Sera close-up

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
ink linework, one confident thicker contour, pale transparent watercolour washes on
bone-grey paper. Keep the composition, pose, hand and thread of the attached close-up
EXACTLY, and repaint only the face to match the attached expression sheet: a long oval
face, heavy-lidded gold-green eyes, a long straight nose, a full quiet mouth, faint
shadows under the eyes. Smooth, even skin wash with no mottling on the face. Sera winds
a single fine gold-leaf thread around two fingers, watching it closely; calm, private,
a little sad. Plain pale violet-grey wash background. No text, no border. 1536×1024.
```

## Part C: allied foot soldiers

The army at first light is seven lords. These soldiers, repeated and flipped in code,
turn it into an army. They're drawn like our side: pale wash, bare paper showing, not
the Empire's dense paint. Faces are small and mostly hidden, so they don't need face
descriptions.

| # | File name | Attach |
|---|---|---|
| C1 | `b29_ally_spear` | `batch-2/b13_card_voss.png` (for the drawing style) |
| C2 | `b29_ally_sword_shield` | same |

### C1. Spear

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
ink linework inside the figure, one confident thicker contour, pale transparent
watercolour washes with bare paper showing through, worn cloth and leather, no ornate
armour. A plain militia soldier of a small free army: padded grey-blue gambeson, a
dented open kettle helm, a patched teal armband, a spear held upright, a small pack on
the back. Standing at ease, three-quarter view FACING RIGHT, looking toward the right,
face partly shaded by the helm brim. Full body, centred, on a flat pure #00FF00
background, no ground shadow, margin all round. No text. 1024×1536.
```

### C2. Sword and shield

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
ink linework inside the figure, one confident thicker contour, pale transparent
watercolour washes with bare paper showing through, worn cloth and leather, no ornate
armour. A plain militia soldier of a small free army: a short mail shirt over a brown
tunic, a hood down on the shoulders, a patched teal armband, a round wooden shield with
no emblem on the left arm and a short sword sheathed at the hip. Standing at ease,
three-quarter view FACING RIGHT, looking toward the right. Full body, centred, on a flat
pure #00FF00 background, no ground shadow, margin all round. No text. 1024×1536.
```

## Part D: the camp and the hymn

| # | File name | Beat | Attach |
|---|---|---|---|
| D1 | `b05_sera_at_camp` | 5–12 | `lord_sera.png` + `batch-3/ms_sera_turn.png` |
| D2 | `b05_kira_at_camp` | 5–12 | `lord_kira.png` + `batch-3/ms_kira_turn.png` |
| D3 | `b45_sera_hymn_kneel` | 45–48 | `lord_sera.png` + `batch-3/ms_sera_turn.png` |

### D1. Sera at the camp

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
ink linework inside the figure, one confident thicker contour, pale transparent
watercolour washes, worn cloth. Sera (attached references: long wavy crimson hair,
gold-green eyes, a long oval face with heavy-lidded eyes; purple seer robe with cream
trim and a gold cross), sitting on the ground with her knees drawn up and a blanket
round her shoulders, looking up at the night sky to the right, still and watchful.
Warm light from below-left on her face and hands only. Full body, three-quarter view
facing right, on a flat pure #00FF00 background, no ground shadow, margin all round.
No text. 1024×1536.
```

### D2. Kira at the camp

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
ink linework inside the figure, one confident thicker contour, pale transparent
watercolour washes, worn cloth and leather. Kira (attached references: an androgynous
face that reads as neither clearly a young man nor a young woman, long and narrow, with
level brows and narrow hooded grey eyes; silver-white hair in a high ponytail, long
oxblood coat, black scarf), sitting on a low crate, leaning forward over a map spread
across the knees, one finger on it, working out tomorrow. Warm light from below-left on
the face, hands and map only. Full body, three-quarter view facing right, on a flat
pure #00FF00 background, no ground shadow, margin all round. No text. 1024×1536.
```

### D3. Sera kneels in the hymn

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
ink linework, one confident thicker contour, pale transparent watercolour washes, worn
cloth, colour drained toward violet-grey. Sera (attached references: long wavy crimson
hair, a long oval face with heavy-lidded eyes; purple seer robe with cream trim and a
gold cross), kneeling, eyes closed, both hands held in front of her chest as if drawing
a thread back toward herself, hair and sleeves lifting slightly as in a still wind.
Side view facing right. Full body, centred, on a flat pure #00FF00 background, no
ground shadow, margin all round. No text, no gold thread. 1024×1536.
```
