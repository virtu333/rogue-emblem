# Anime opening: GPT image prompts, batch 3

Style: **The Unwritten Page** ([STYLE.md](STYLE.md)). Verdicts on batches 1–2 are in
[catalog.md](catalog.md).

**Send each prompt exactly as written.** Every prompt is complete and includes the
style text.

**Attach both references where two are listed.** The PC-98 portrait
(`public/assets/portraits/pc98/192/`) fixes identity. The earlier image (in
`~/Downloads/…`) fixes the costume and drawing style we already use, so new images
match the old ones. Where the two disagree, the portrait wins.

Batch 3 has four parts:

- **A:** the five catalogue maybes, redone in style.
- **B:** model sheets for the rig.
- **C:** Empire officers and the Lieutenant.
- **D:** a small test of the rewind idea.

Batch 4 (later, if needed) is listed in [gaps.md](gaps.md).

## Part A: the maybes, redone

| #   | File name                     | Beat         | Type               | Attach                                                 |
| --- | ----------------------------- | ------------ | ------------------ | ------------------------------------------------------ |
| A1  | `b29_sera_run`                | 29–44        | cut-out            | `lord_sera.png` + `batch-2/b13_card_sera.png`          |
| A2  | `b29_sera_hands_fray_strip`   | 29–44, 45–48 | strip (3 frames)   | `lord_sera.png` + `batch-2/b13_card_sera.png`          |
| A3  | `b21_lieutenant_threads`      | 21–28        | key                | `boss_the_lieutenant.png` + `batch-1/b21_lieutenant_eyes.png` |
| A4  | `b29_first_light_plate`       | 29–44        | plate              | none                                                   |
| A5  | `b21_sera_closeup`            | 21–28        | closeup            | `lord_sera.png` + `rogue-dawn-sketchbook-tests/03-sera-window.png` |

### A1. Sera running (pairs with Edric's charge)

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
ink linework inside the figure, one confident thicker contour around the whole
silhouette, pale transparent watercolour washes, worn cloth and leather, no ornate
armour. Sera, a young seer (attached references: long wavy crimson hair, gold-green
eyes, purple seer robe with cream trim, a gold cross on the chest, brown belt, cream
underskirt, brown boots; match the costume in the attached full-body image exactly),
RUNNING TO THE RIGHT in side view, skirts gathered in her left hand, right arm reaching
forward with fingers open, hair and sleeves streaming behind her, face set and
determined. A held, readable pose: both feet visible, no limbs crossing the body. Full
body, centred, on a flat pure #00FF00 background, no ground shadow, margin all round.
No text, no gold thread. 1024×1536.
```

### A2. Sera's hands as the thread frays (three-frame strip)

```
Three panels side by side, IDENTICAL FRAMING AND HAND POSITION in all three, like
three frames of one animation. Hand-drawn in the manner of a Renaissance sketchbook:
fine sepia ink lines, one thicker contour around the hands, pale transparent
watercolour. Close-up of a young woman's two hands (attached references Sera: pale
skin, loose purple sleeves with cream trim) holding ONE GOLD-LEAF THREAD pulled taut
horizontally between them, the only warm, bright thing in the image.
Panel 1: the thread is whole and straight.
Panel 2: fibres fray apart at the centre; her fingers tighten.
Panel 3: the thread is half unravelled at the centre, loose strands lifting like hair;
knuckles white.
Background in every panel: plain dark violet-grey wash, nothing else. Thin even gutters
between panels. No text, no border. 1536×1024.
```

### A3. The Lieutenant holds the threads (medium shot)

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, thick outer contour. Symmetrical medium shot, waist up, facing the camera
straight on: the Lieutenant (attached references: black hair with a single white
streak, fine crimson cracks across the left side of his face, his left eye red, dark
iron armour, crimson cloak with round cross clasps at the collar). His gloved hands
are raised in front of his chest, and between his fingers he holds several fine
threads: the ones in his right hand are gold and whole, the ones in his left hand are
crimson and snapped, hanging loose. Cold, certain expression. Plain dark crimson-black
wash background, nothing else. Figure centred inside the middle 16:9 band. No text, no
border. 1536×1024.
```

### A4. First light (plate for the army)

```
Hand-drawn fantasy landscape in the manner of a Renaissance sketchbook, pale
transparent watercolour on bone-grey paper, LARGE SIMPLE SHAPES AND SOFT WASH, NO
HATCHING OR FINE TEXTURE. The very first light before dawn, cold and pale: a broad
grassy hilltop in the foreground, flat and open across the whole width of the frame,
then a wide valley of mist below, far blue-grey hills. The sky is pale cool grey
lightening to a faint silver at the horizon. NO SUN, no sun disc, no orange or gold
anywhere. The foreground hilltop is empty and wide enough for a row of seven figures
standing side by side. No people, no text, no border. 1536×1024.
```

### A5. Sera close-up, redone

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook: fine sepia
ink linework, one confident thicker contour, pale transparent watercolour washes on
bone-grey paper. Close-up, three-quarter view facing right: Sera (attached references:
long wavy crimson hair, gold-green eyes, purple seer robe with cream trim) raises one
hand near her face and winds a single fine gold-leaf thread once around two fingers,
watching it closely; a faint gold glint reflected in her eye. Calm, private, a little
sad. Background: plain pale violet-grey wash, nothing else. Face inside the middle
16:9 band. No text, no border. 1536×1024.
```

## Part B: model sheets (character profiles)

These lock each character's look across batches (for example, Edric's hair keeps
drifting red). They also give the rig its parts: turnarounds for turning shots, and
heads at the **same angle as the cast card** so code can swap them for blinks, shouts
and smiles.

Two sheets per character:

- **Turnaround:** four full-body views in one row.
- **Heads:** 6 heads for Edric and Sera; 4 heads for the others.

| #   | Character | Turnaround file  | Heads file   | Attach                                                              |
| --- | --------- | ---------------- | ------------ | ------------------------------------------------------------------- |
| B1  | Edric     | `ms_edric_turn`  | `ms_edric_heads`  | `lord_edric.png` + `rogue-dawn-sketchbook-tests/01-edric-standing-greenscreen.png` |
| B2  | Sera      | `ms_sera_turn`   | `ms_sera_heads`   | `lord_sera.png` + `batch-2/b13_card_sera.png`   |
| B3  | Kira      | `ms_kira_turn`   | `ms_kira_heads`   | `lord_kira.png` + `batch-2/b13_card_kira.png`   |
| B4  | Astrid    | `ms_astrid_turn` | `ms_astrid_heads` | `lord_astrid.png` + `batch-2/b13_card_astrid.png` |
| B5  | Voss      | `ms_voss_turn`   | `ms_voss_heads`   | `lord_voss.png` + `batch-2/b13_card_voss.png`   |
| B6  | Rowan     | `ms_rowan_turn`  | `ms_rowan_heads`  | `lord_rowan.png` + `batch-2/b13_card_rowan.png` |
| B7  | Cael      | `ms_cael_turn`   | `ms_cael_heads`   | `lord_cael.png` + `batch-2/b13_card_cael.png`   |

### B1. Edric

**Turnaround**

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one confident thicker contour around each figure, pale transparent
watercolour washes, worn cloth and leather. Lord Edric (attached references: dark
chestnut-brown shaggy hair, NOT red or auburn; brown eyes; deep teal cloak wrapped at
the neck; one steel pauldron on his RIGHT shoulder only; dark tunic, brown leather
straps and belt, brown boots; a plain longsword sheathed at his left hip; match the
costume in the attached full-body image exactly). FOUR full-body views of the same
man in one row, left to right: front view, three-quarter view facing right, side view
facing right, back view. Neutral standing pose, arms relaxed at his sides, all four
exactly the same height, evenly spaced, feet on the same invisible line. On a flat pure
#00FF00 background, no ground shadow, margin all round. No text, no labels. 1536×1024.
```

**Heads**

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. SIX heads of
Lord Edric (attached references: dark chestnut-brown shaggy hair, NOT red or auburn;
brown eyes; teal cloak collar at the neck), in two rows of three. EVERY head is at
EXACTLY THE SAME ANGLE: three-quarter view facing right, as in the attached full-body
image; same size, same lighting, head and neck only. Top row: 1 calm and neutral,
eyes open; 2 IDENTICAL TO 1 BUT WITH EYES CLOSED; 3 shouting, mouth wide open. Bottom
row: 4 teeth gritted in pain, eyes squeezed; 5 the ghost of a tired smile; 6 looking
up, eyes lifted, lips parted. On a flat pure #00FF00 background, evenly spaced, margin
all round. No text, no labels. 1536×1024.
```

### B2. Sera

**Turnaround**

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one confident thicker contour around each figure, pale transparent
watercolour washes, worn cloth. Sera, a young seer (attached references: long wavy
crimson hair to the waist, gold-green eyes, purple seer robe with wide bell sleeves and
cream trim, a gold cross on the chest, brown belt, cream underskirt, brown boots; match
the costume in the attached full-body image exactly). FOUR full-body views of the same
woman in one row, left to right: front view, three-quarter view facing right, side view
facing right, back view (showing the full length of her hair). Neutral standing pose,
arms relaxed, all four exactly the same height, evenly spaced, feet on the same
invisible line. On a flat pure #00FF00 background, no ground shadow, margin all round.
No text, no labels. 1536×1024.
```

**Heads**

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. SIX heads of
Sera (attached references: long wavy crimson hair, gold-green eyes, purple robe collar
with cream trim), in two rows of three. EVERY head is at EXACTLY THE SAME ANGLE:
three-quarter view facing right, as in the attached full-body image; same size, same
lighting, head, neck and a little hair. Top row: 1 calm and focused, eyes open;
2 IDENTICAL TO 1 BUT WITH EYES CLOSED; 3 crying out, mouth open. Bottom row: 4 eyes
wide, seeing something terrible; 5 a small gentle smile; 6 eyes closed, brows drawn
together in effort, as if holding something together. On a flat pure #00FF00
background, evenly spaced, margin all round. No text, no labels. 1536×1024.
```

### B3. Kira

**Turnaround**

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one confident thicker contour around each figure, pale transparent
watercolour washes, worn cloth and leather. Kira, a tactician and battle mage
(attached references: silver-white hair tied in a high ponytail, sharp grey eyes, long
dark oxblood coat with a high collar, black scarf, one dark steel pauldron, a
leather-bound tome at the belt; match the costume in the attached full-body image
exactly). FOUR full-body views of the same person in one row, left to right: front
view, three-quarter view facing right, side view facing right, back view. Neutral
standing pose, arms relaxed, all four exactly the same height, evenly spaced, feet on
the same invisible line. On a flat pure #00FF00 background, no ground shadow, margin
all round. No text, no labels. 1536×1024.
```

**Heads**

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. FOUR heads of
Kira (attached references: silver-white hair in a high ponytail, sharp grey eyes, black
scarf, high oxblood collar), in one row. EVERY head is at EXACTLY THE SAME ANGLE:
three-quarter view facing right, as in the attached full-body image; same size, same
lighting, head and neck only. 1 dry, confident, neutral; 2 IDENTICAL TO 1 BUT WITH EYES
CLOSED; 3 calling out an order, mouth open; 4 a small knowing smile. On a flat pure
#00FF00 background, evenly spaced, margin all round. No text, no labels. 1536×1024.
```

### B4. Astrid

**Turnaround** (on foot; the winged horse is already on her cast card)

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one confident thicker contour around each figure, pale transparent
watercolour washes, worn cloth and leather. Astrid, a sky lancer, ON FOOT (attached
references: blonde hair in a high ponytail tied with a blue ribbon, blue eyes, blue
scarf, light white-and-steel armour, brown leather riding boots, a lance held upright;
match the costume in the attached image exactly). FOUR full-body views of the same
woman in one row, left to right: front view, three-quarter view facing right, side view
facing right, back view. Neutral standing pose, all four exactly the same height,
evenly spaced, feet on the same invisible line. On a flat pure #00FF00 background, no
ground shadow, margin all round. No text, no labels. 1536×1024.
```

**Heads**

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. FOUR heads of
Astrid (attached references: blonde high ponytail with a blue ribbon, blue eyes, blue
scarf), in one row. EVERY head is at EXACTLY THE SAME ANGLE: three-quarter view facing
right, as in the attached image; same size, same lighting, head and neck only. 1 alert
and neutral; 2 IDENTICAL TO 1 BUT WITH EYES CLOSED; 3 battle cry, mouth open; 4 a bright
fearless grin. On a flat pure #00FF00 background, evenly spaced, margin all round. No
text, no labels. 1536×1024.
```

### B5. Voss

**Turnaround**

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one confident thicker contour around each figure, pale transparent
watercolour washes, worn cloth and leather. Voss, a veteran ranger (attached
references: older man, long dark-brown hair tied back, stubble beard, a scar across the
cheek, ragged moss-green hooded cloak, brown leathers, a quiver of arrows on his back,
a longbow and a sword at his hip; match the costume in the attached full-body image
exactly). FOUR full-body views of the same man in one row, left to right: front view,
three-quarter view facing right, side view facing right, back view. Neutral standing
pose, bow held low, all four exactly the same height, evenly spaced, feet on the same
invisible line. On a flat pure #00FF00 background, no ground shadow, margin all round.
No text, no labels. 1536×1024.
```

**Heads**

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. FOUR heads of
Voss (attached references: older man, long dark-brown hair tied back, stubble beard,
scar across the cheek, moss-green hood down at the neck), in one row. EVERY head is at
EXACTLY THE SAME ANGLE: three-quarter view facing right, as in the attached full-body
image; same size, same lighting, head and neck only. 1 weary and watchful; 2 IDENTICAL
TO 1 BUT WITH EYES CLOSED; 3 shouting a warning, mouth open; 4 a grim half smile. On a
flat pure #00FF00 background, evenly spaced, margin all round. No text, no labels.
1536×1024.
```

### B6. Rowan

**Turnaround** (on foot; the horse is already on his cast card)

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one confident thicker contour around each figure, pale transparent
watercolour washes, worn cloth and leather. Rowan, a young cavalry knight, ON FOOT
(attached references: tousled copper-orange hair, easy confident smile, cream scarf,
brown leather jerkin over chainmail, steel pauldrons, riding boots, a lance held
upright; match the costume in the attached image exactly). FOUR full-body views of the
same man in one row, left to right: front view, three-quarter view facing right, side
view facing right, back view. Neutral standing pose, all four exactly the same height,
evenly spaced, feet on the same invisible line. On a flat pure #00FF00 background, no
ground shadow, margin all round. No text, no labels. 1536×1024.
```

**Heads**

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. FOUR heads of
Rowan (attached references: tousled copper-orange hair, cream scarf), in one row. EVERY
head is at EXACTLY THE SAME ANGLE: three-quarter view facing right, as in the attached
image; same size, same lighting, head and neck only. 1 easy confident smile; 2 IDENTICAL
TO 1 BUT WITH EYES CLOSED; 3 charging yell, mouth open; 4 serious and determined. On a
flat pure #00FF00 background, evenly spaced, margin all round. No text, no labels.
1536×1024.
```

### B7. Cael

**Turnaround**

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one confident thicker contour around each figure, pale transparent
watercolour washes, worn cloth and dented metal. Cael, a heavy sentinel (attached
references: older, broad, stern face, open-faced steel helm with cheek guards, dark red
scarf, heavy dented plate armour, a large axe; match the costume in the attached
full-body image exactly). FOUR full-body views of the same man in one row, left to
right: front view, three-quarter view facing right, side view facing right, back view.
Neutral standing pose, axe held head-down at his side, all four exactly the same
height, evenly spaced, feet on the same invisible line. On a flat pure #00FF00
background, no ground shadow, margin all round. No text, no labels. 1536×1024.
```

**Heads**

```
Character expression sheet, hand-drawn in the manner of a Renaissance sketchbook: fine
sepia ink linework, one thicker contour, pale transparent watercolour. FOUR heads of
Cael (attached references: older, broad, stern face, open-faced steel helm with cheek
guards, dark red scarf), in one row. EVERY head is at EXACTLY THE SAME ANGLE:
three-quarter view facing right, as in the attached full-body image; same size, same
lighting, head and neck only. 1 stern and neutral; 2 IDENTICAL TO 1 BUT WITH EYES
CLOSED; 3 roaring, mouth open; 4 a rare, gruff smile. On a flat pure #00FF00
background, evenly spaced, margin all round. No text, no labels. 1536×1024.
```

## Part C: the Empire's officers and the Lieutenant

The Empire faces and moves **left**, and is painted dense and flat.

| #   | File name                  | Beat         | Attach                                                       |
| --- | -------------------------- | ------------ | ------------------------------------------------------------ |
| C1  | `b21_officer_drill`        | 13–28        | `boss_the_lieutenant.png` (for livery) + `batch-2/b13_empire_soldier_march.png` |
| C2  | `b21_officer_standard`     | 13–28        | same                                                         |
| C3  | `b21_officer_mounted`      | 13–28        | same                                                         |
| C4  | `b21_lieutenant_full`      | 21–28        | `boss_the_lieutenant.png` + `batch-1/b21_lieutenant_eyes.png` |

### C1. Drill officer

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, thick outer contour. An imperial drill officer in
the same livery as the attached soldier (black iron plate, crimson tabard, round cross
clasps), but bareheaded: close-cropped grey hair, hard lined face. He stands facing
LEFT in three-quarter view, a slim officer's sword raised straight up in his right hand
to call the step, mouth open shouting the count. Full body, centred, on a flat pure
#00FF00 background, no ground shadow, margin all round. No text. 1024×1536.
```

### C2. Standard-bearer

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, thick outer contour. An imperial standard-bearer in
the same livery as the attached soldier (closed iron helm, black iron plate, crimson
tabard, round cross clasps), marching in STRICT SIDE PROFILE FACING LEFT, carrying a
very tall pole with a long crimson banner hanging straight down; on the banner, one
plain black sword shape, point down. No other emblem. The whole pole and banner inside
the frame. Full body, on a flat pure #00FF00 background, no ground shadow, margin all
round. No text. 1024×1536.
```

### C3. Mounted officer

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but horse
and rider are painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, thick outer contour. An imperial officer in black
iron plate and a crimson cloak with round cross clasps, closed helm, mounted on a
black warhorse with a plain crimson caparison, both in STRICT SIDE PROFILE FACING LEFT,
the horse walking in a slow, measured step, one foreleg raised. The rider sits
upright, a sword sheathed. Horse and rider fully inside the frame, all hooves visible.
On a flat pure #00FF00 background, no ground shadow, margin all round. No text.
1536×1024.
```

### C4. The Lieutenant, full body

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, thick outer contour. The Lieutenant (attached references: tall, lean, black
hair with a single white streak, fine crimson cracks across the left side of his face,
his left eye red, dark iron armour, long crimson cloak with round cross clasps at the
collar, black gloves) standing still, three-quarter view facing LEFT, one gloved hand
raised a little in front of him with the fingers loosely open, mirroring a seer
feeling for a thread; cold, patient. Full body, centred, on a flat pure #00FF00
background, no ground shadow, margin all round. No text. 1024×1536.
```

## Part D: rewind test (two images)

The rewind strips each shot back through the stages it was painted in: wash, then lines,
then pencil, then paper. Code can fake the stages. A matching line-only redraw would
look better, but only if every shape stays in the same place. These two images test
that. If the shapes shift, we drop the idea and code does it.

| #   | File name                   | Attach                          |
| --- | --------------------------- | ------------------------------- |
| D1  | `rw_camp_lines`             | `batch-1/b05_camp_night_plate.png` |
| D2  | `rw_edric_final_lines`      | `batch-2/b53_edric_final_frame.png` |

### D1 and D2 (same prompt, different attachment)

```
Redraw the attached image EXACTLY, keeping every shape, edge and object in precisely
the same position and size, as clean sepia ink linework only on bare pale bone-grey
paper: no colour, no wash, no shading fills, just the ink contours and a few interior
lines, as if the painting had not been coloured yet. Same framing, same canvas size.
No text, no border.
```
