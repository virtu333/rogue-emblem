# Cutscene art: GPT image prompts, batch 5 (the villains)

Style: **The Unwritten Page** ([STYLE.md](STYLE.md)), now used for all cutscenes. This
batch covers every villain the cutscene plan (`docs/specs/cutscenes.md`) puts on
screen:

- the anime opening;
- `approach_lieutenant`, `approach_emperor`;
- `end_normal`, `end_hard`;
- the boss encounter cut-in (the art bible's "boss bust breaking the frame");
- the defeat and the true ending (the Entity's eyes).

**Send each prompt exactly as written**, and attach every reference listed. The PC-98
portrait (`public/assets/portraits/pc98/192/`) fixes identity and costume. Where an
image disagrees with it, the portrait wins.

**Empire rules**, already in every prompt:

- The Empire is painted **dense and flat**: iron-gall black and crimson lacquer, fully
  coloured, no paper showing through.
- It faces and moves **left**.
- It carries no light of its own, and nothing it owns glows.
- Each face is described, so no villain shares the young cast's face.

| Part | What | Count |
|---|---|---|
| A | The Lieutenant: model sheet, two story poses, two plates | 6 |
| B | The Emperor: model sheet, the Roll, the throne hall | 5 |
| C | The eight act bosses: one bust each | 8 |
| D | The Entity | 1 (+1 optional) |

## Part A: the Lieutenant

**His face (in every prompt):** a long, gaunt face, sharp cheekbones, thin lips, a
narrow straight nose, and the **same faint shadows under the eyes as Sera**, his rival
seer. He looks like someone who has seen every future and slept through none of them.
Black hair with a single white streak. Fine crimson cracks across the left side of his
face; his left eye is red.

| # | File name | Used in | Attach |
|---|---|---|---|
| A1 | `ms_lieutenant_turn` | rig | `boss_the_lieutenant.png` + `batch-3/b21_lieutenant_full.png` |
| A2 | `ms_lieutenant_heads` | rig | same + `batch-1/b21_lieutenant_eyes.png` |
| A3 | `v_lieutenant_waiting` | `approach_lieutenant` | `boss_the_lieutenant.png` + `batch-3/b21_lieutenant_full.png` |
| A4 | `v_lieutenant_fallen` | `end_normal` | same |
| A5 | `v_sanctum_plate` | `approach_lieutenant` | none |
| A6 | `v_landing_plate` | `end_normal` | none |

### A1. Turnaround

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook, but the
figures are painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, fine sepia ink lines, one thick outer contour. The
Lieutenant (attached references: tall and lean; a long, gaunt face, sharp cheekbones,
thin lips, a narrow straight nose, faint shadows under the eyes; black hair with a
single white streak; fine crimson cracks across the left side of his face, his left eye
red; dark iron armour, a long crimson cloak with round cross clasps at the collar,
black gloves; match the costume in the attached full-body image exactly). FOUR
full-body views of the same man in one row, left to right: front view, three-quarter
view facing LEFT, side view facing LEFT, back view (the full cloak). Neutral standing
pose, arms at his sides, all four exactly the same height, evenly spaced, feet on the
same invisible line. On a flat pure #00FF00 background, no ground shadow, margin all
round. No text, no labels. 1536×1024.
```

### A2. Heads

```
Character expression sheet, fine sepia ink linework, one thicker contour, the face
painted in flat, cool colour, no paper texture. SIX heads of the Lieutenant (attached
references), in two rows of three. HIS FACE: a long, gaunt face, sharp cheekbones, thin
lips, a narrow straight nose, faint shadows under the eyes; black hair with a single
white streak; fine crimson cracks across the left side of his face, his left eye red;
high dark iron collar. EVERY head FACES LEFT in the same three-quarter view, at EXACTLY
THE SAME ANGLE, SIZE AND POSITION, with IDENTICAL hair, head outline, cracks, neck and
collar in all six, like one drawing traced six times; ONLY the eyes, brows and mouth
change. Top row: 1 cold and patient, eyes open; 2 IDENTICAL TO 1 WITH EYES CLOSED;
3 speaking, mouth half open. Bottom row: 4 a thin, knowing smile; 5 eyes wide, the
first doubt he has ever felt; 6 pain, teeth set, eyes closing. On a flat pure #00FF00
background, evenly spaced, margin all round. No text, no labels. 1536×1024.
```

### A3. Waiting, back turned (`approach_lieutenant`)

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, thick outer contour. The Lieutenant (attached references: tall and lean,
black hair with a single white streak, dark iron armour, long crimson cloak, black
gloves) standing perfectly still with HIS BACK TO THE VIEWER, head tilted very slightly
up, as if looking at something hanging in the dark above him. His left hand is raised
a little at his side with the fingers loosely open. The cloak falls straight. Full
body, centred, on a flat pure #00FF00 background, no ground shadow, margin all round.
No threads, no text. 1024×1536.
```

### A4. Fallen (`end_normal`)

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, thick outer contour. The Lieutenant (attached references: a long, gaunt
face, sharp cheekbones, faint shadows under the eyes; black hair with a single white
streak; crimson cracks across the left side of his face; dark iron armour, crimson
cloak), fallen: sitting on the ground, his back half against an unseen wall, legs out,
his crimson cloak spread around him, one gloved hand open and empty on the ground
beside him, head turned slightly down and to the LEFT, eyes half open. Not wounded
gore: exhausted, emptied, strangely calm. Side view facing LEFT. Full body, centred, on
a flat pure #00FF00 background, no ground shadow, margin all round. No text.
1536×1024.
```

### A5. The Sanctum (plate)

```
Hand-drawn fantasy landscape in the manner of a Renaissance sketchbook, LARGE SIMPLE
SHAPES AND SOFT WASH, NO HATCHING OR FINE TEXTURE, colour drained toward violet-grey. A
vast, dark, empty stone chamber deep underground: a round floor of worn flagstones in
the lower third, a few plain columns fading into darkness at the sides, and ABOVE, a
huge empty darkness filling the upper two thirds of the frame, where things will later
be hung. A faint cold light pools on the centre of the floor where one figure will
stand. No people, no threads, no light sources, no text, no border. 1536×1024.
```

### A6. The landing under the Seat (plate)

```
Hand-drawn fantasy landscape in the manner of a Renaissance sketchbook, LARGE SIMPLE
SHAPES AND SOFT WASH, NO HATCHING OR FINE TEXTURE. A broad stone landing at the foot
of a stair, deep underground, seen from ground height. Behind it, a wall of perfectly
still, black mirror-like water standing upright like a pane of dark glass, faintly
reflecting the landing. Plain stone wall at the left edge. Open ground centre-left
where a seated figure will be placed. Cool, quiet, grey-violet. No people, no text, no
border. 1536×1024.
```

## Part B: the Emperor

**His face (in every prompt):** older, a square, heavy face, deep lines from nose to
mouth, heavy-lidded eyes that have stopped expecting to be surprised, short grey hair,
a gold crown. Dark blue-black plate armour with gold trim, a crimson cloak.

| # | File name | Used in | Attach |
|---|---|---|---|
| B1 | `ms_emperor_turn` | rig | `boss_the_emperor.png` + `batch-1/b21_emperor.png` |
| B2 | `ms_emperor_heads` | rig | same |
| B3 | `v_emperor_hand_on_roll` | `approach_emperor` | `boss_the_emperor.png` + `batch-1/b21_emperor.png` |
| B4 | `v_emperor_hand_slips` | `end_hard` | same + the B3 image |
| B5 | `v_throne_hall_plate` | `approach_emperor`, `end_hard` | none |

### B1. Turnaround

```
Character model sheet, hand-drawn in the manner of a Renaissance sketchbook, but the
figures are painted DENSE AND FLAT: solid dark blue-black, gold trim and crimson
lacquer, fully coloured, no paper showing through, fine sepia ink lines, one thick
outer contour. The Emperor (attached references: older; a square, heavy face, deep
lines from nose to mouth, heavy-lidded eyes, short grey hair, a gold crown; dark
blue-black plate armour with gold trim, a crimson cloak, a sceptre; match the costume
in the attached full-body image exactly). FOUR full-body views of the same man in one
row, left to right: front view, three-quarter view facing LEFT, side view facing LEFT,
back view. Standing upright, the sceptre held at his side, all four exactly the same
height, evenly spaced, feet on the same invisible line. On a flat pure #00FF00
background, no ground shadow, margin all round. No text, no labels. 1536×1024.
```

### B2. Heads

```
Character expression sheet, fine sepia ink linework, one thicker contour, the face
painted in flat colour, no paper texture. FOUR heads of the Emperor (attached
references: older; a square, heavy face, deep lines from nose to mouth, heavy-lidded
eyes, short grey hair, a gold crown, a high gold-trimmed collar), in one row. EVERY
head FACES LEFT in the same three-quarter view, at EXACTLY THE SAME ANGLE, SIZE AND
POSITION, with IDENTICAL crown, hair, head outline and collar in all four, like one
drawing traced four times; ONLY the eyes, brows and mouth change. 1 stern, unmoved;
2 IDENTICAL TO 1 WITH EYES CLOSED; 3 speaking, mouth half open; 4 a weary contempt. On
a flat pure #00FF00 background, evenly spaced, margin all round. No text, no labels.
1536×1024.
```

### B3. The hand on the Roll (`approach_emperor`)

```
Hand-drawn fantasy illustration, painted DENSE AND FLAT in dark blue-black, gold trim
and crimson, thick outer contours, fine sepia ink lines. Close-up, seen from slightly
above: a huge old book lies open on a dark stone lectern, its pages filling the lower
two thirds of the frame, covered edge to edge in rows of small crimson handwriting that
is NOT READABLE: marks and strokes only, no real letters, and many rows struck through
with a single red line. A heavy gauntlet of dark blue-black plate with gold trim rests
flat on the right-hand page, fingers spread, possessive. Nothing glows. Plain dark
background beyond the book. No readable text, no border. 1536×1024.
```

### B4. The hand slips (`end_hard`)

```
Hand-drawn fantasy illustration, painted DENSE AND FLAT in dark blue-black, gold trim
and crimson, thick outer contours, fine sepia ink lines. EXACTLY THE SAME FRAMING,
BOOK, LECTERN AND LIGHT AS THE ATTACHED IMAGE, like the next frame of the same shot:
the gauntleted hand now slides off the edge of the page, fingers trailing, the wrist
already past the book's edge, as if the arm has lost its strength. The crimson rows
and their strike-through lines are unchanged. Nothing glows. No readable text, no
border. 1536×1024.
```

### B5. The throne hall (plate)

```
Hand-drawn fantasy interior, painted DENSE AND FLAT in dark stone grey, blue-black and
crimson, LARGE SIMPLE SHAPES, NO HATCHING OR FINE TEXTURE. A long, cold throne hall
seen from the entrance, perfectly symmetrical: a straight crimson carpet running to a
plain stone throne on a few broad steps at the far end, tall square pillars in two
rows, long crimson banners hanging still between them, each with one plain black sword
shape, point down. High narrow windows with grey daylight. The throne is empty. No
people, no candles, nothing glowing, no text, no border. 1536×1024.
```

## Part C: the eight act bosses

One bust each, for the boss encounter cut-in: waist up, facing **left**, on green, so
code can place it breaking out of its frame. Each has a face description taken from
their portrait and title. All are painted dense and flat. Code adds the name and title;
there is no text in the image.

| # | File name | Boss (class, title) | Attach |
|---|---|---|---|
| C1 | `boss_iron_captain` | Iron Captain (Cavalier), Warden of the Unrelieved Line | `boss_iron_captain.png` |
| C2 | `boss_warchief` | Warchief (Fighter), Breaker of the Old Treaties | `boss_warchief.png` |
| C3 | `boss_knight_commander` | Knight Commander (Paladin), First Lance of the Second Push | `boss_knight_commander.png` |
| C4 | `boss_archmage` | Archmage (Sage), Keeper of the Middle Pages | `boss_archmage.png` |
| C5 | `boss_dark_rider` | Dark Rider (Dark Knight), Bearer of the Sealed Orders | `boss_dark_rider.png` |
| C6 | `boss_blade_lord` | Blade Lord (Swordmaster), Proof of the Dueling Halls | `boss_blade_lord.png` |
| C7 | `boss_iron_wall` | Iron Wall (General), Holder of the Breach | `boss_iron_wall.png` |
| C8 | `boss_berserker_king` | Berserker King (Berserker), Crowned by Frightened Acclaim | `boss_berserker_king.png` |

All eight prompts start with the same opening:

> Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
> figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
> coloured, no paper showing through, fine sepia ink lines, one thick outer contour.

Each prompt below already includes it.

### C1. Iron Captain

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, fine sepia ink lines, one thick outer contour. The
Iron Captain (attached reference): an old soldier who was never relieved. A wide, flat
face, heavy jowls, a flattened, broken nose, small hard eyes, grey stubble, deep tired
lines. An open steel sallet helm with a brim, steel plate, a worn crimson cloak. Waist
up, three-quarter view FACING LEFT, gauntleted hands resting on the pommel of a sword
held point-down in front of him, staring past the viewer. Centred, on a flat pure
#00FF00 background, margin all round. No text. 1024×1536.
```

### C2. Warchief

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, fine sepia ink lines, one thick outer contour. The
Warchief (attached reference): a broad, low-browed face, a thick neck, a heavy old scar
across the left brow and cheek, a sneer; head shaved at the sides with a red crest of
hair tied back, a gold ring in one ear. Studded leather, one steel pauldron. Waist up,
three-quarter view FACING LEFT, a heavy axe resting on his shoulder, chin raised in
contempt. Centred, on a flat pure #00FF00 background, margin all round. No text.
1024×1536.
```

### C3. Knight Commander

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, fine sepia ink lines, one thick outer contour. The
Knight Commander (attached reference): a parade officer. A long, lean, clean-shaven
face, a straight nose, hard lines beside the mouth, cold level eyes, grey hair swept
back. Polished steel plate, a dark tabard with a plain gold four-pointed star emblem, a crimson
collar. Waist up, three-quarter view FACING LEFT, a lance held upright beside him,
perfectly straight-backed. Centred, on a flat pure #00FF00 background, margin all
round. No text. 1024×1536.
```

### C4. Archmage

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: deep violet-black and crimson, fully coloured, no
paper showing through, fine sepia ink lines, one thick outer contour. The Archmage
(attached reference): very old. A gaunt face, hollow cheeks, a long hooked nose,
deep-set pale eyes, long thin white hair. Heavy violet-black robes with a plain woven
border, a closed book held against his chest in one hand, the other hand raised to his
chin, thinking. Waist up, three-quarter view FACING LEFT. Nothing glows. Centred, on a
flat pure #00FF00 background, margin all round. No text. 1024×1536.
```

### C5. Dark Rider

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, fine sepia ink lines, one thick outer contour. The
Dark Rider (attached reference): a pale, narrow face, half-lidded sleepy eyes, a thin
mouth, long black hair falling from under a dark helm with a smooth swept-back crest
(not spiked). Black plate and a crimson cloak. He holds up a sealed letter with a
plain crimson wax seal, unopened, between two gloved fingers. Waist up, three-quarter
view FACING LEFT. Centred, on a flat pure #00FF00 background, margin all round. No
text. 1024×1536.
```

### C6. Blade Lord

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson lacquer, fully
coloured, no paper showing through, fine sepia ink lines, one thick outer contour. The
Blade Lord (attached reference): a duellist. A fine-boned, long face, calm narrow eyes,
a faint thin scar along one cheekbone, long black hair loosely tied back. A dark coat
with crimson trim, one gloved hand at the collar. A slim sword held low and relaxed in
the other hand. Waist up, three-quarter view FACING LEFT, unhurried. Centred, on a flat
pure #00FF00 background, margin all round. No text. 1024×1536.
```

### C7. Iron Wall

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black, dull steel and crimson
lacquer, fully coloured, no paper showing through, fine sepia ink lines, one thick
outer contour. The Iron Wall (attached reference): a massive armoured general in a
fully closed, flat-topped great helm with a single narrow eye slit, no face visible.
Broad dented plate, a crimson surcoat. A huge rectangular tower shield held in front of
the body, the top edge at chest height. Waist up, three-quarter view FACING LEFT,
immovable. Centred, on a flat pure #00FF00 background, margin all round. No text.
1024×1536.
```

### C8. Berserker King

```
Hand-drawn fantasy illustration in the manner of a Renaissance sketchbook, but this
figure is painted DENSE AND FLAT: solid iron-gall black and crimson, fully coloured,
no paper showing through, fine sepia ink lines, one thick outer contour. The Berserker
King (attached reference): a wild mane of red hair, a heavy brow, red war-paint
stripes across the eyes, a scarred bare chest and arms, a leather strap across the
chest, a cord of boar tusks at the neck. Waist up, three-quarter view FACING LEFT, a
great axe gripped in both hands, eyes a little too wide: fierce, and underneath,
frightened. Centred, on a flat pure #00FF00 background, margin all round. No text.
1024×1536.
```

## Part D: the Entity

The cutscene plan gives the Entity **no scene and no voice**. It is shown only as eyes
in the dark (the defeat, `thread_cut`, and the true ending, `end_true`). So it gets a
plate, not a character. It is drawn the Unwritten Page's way: not painted darkness, but
the page scraped back and the colour drained.

| # | File name | Used in | Attach |
|---|---|---|---|
| D1 | `v_entity_eyes_plate` | `thread_cut`, `end_true` | `enemy_entity.png` |
| D2 | `v_entity_form` (optional) | the boss card only | `boss_the_entity.png` |

### D1. Eyes in the dark

```
Hand-drawn fantasy illustration on bone-grey paper, drained of colour: a field of deep
violet-black wash that fills the whole frame, uneven and soft-edged, as if the page had
been soaked and scraped. Scattered through it, many small eyes of different sizes,
drawn in fine sepia ink lines with a faint crimson iris, some fully open, some half
open, some only a closed lid, in no pattern. Calm, patient, not grotesque: no mouths,
no teeth, no skulls, no veins, no gore. Nothing glows. No text, no border. 1536×1024.
```

### D2. The form (optional)

```
Hand-drawn fantasy illustration on bone-grey paper. Not a monster: a SHAPE WHERE THE
PAGE HAS BEEN SCRAPED AWAY, in the silhouette of vast pale folds, like cloth or
something asleep, filling the frame, with the bare paper texture showing through. At
its centre, one closed eye, drawn in fine ink. At the edges, the colour drains into
violet-black. Still, silent, enormous. No mouth, no teeth, no claws, no skulls, no
text, no border. 1536×1024.
```

## Budget note

The committed folder is at 27 MB of the handoff's 40 MB. Batches 4 and 5 add about
15 MB of refs and cut-outs, which would pass the budget. Before they land, drop the
`refs/` copies of model sheets (the keyed `cutouts/sheets/` versions carry the same
image), and consider q80 for plates.
