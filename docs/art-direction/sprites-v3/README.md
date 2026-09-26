# Map sprites v3: the traced roster is the battlefield art

> Captures in this folder are a curated subset; see [CAPTURES.md](../CAPTURES.md).

Owner direction (2026-09-24): *"they look great, make them the default"* — the traced
look reads as "modern pixel sprites, not toylike". Since then every unit on the
battlefield is a traced map sprite (`tools/art/sprite-trace`, pipeline in
[`../sprites-v2/README.md`](../sprites-v2/README.md)). `?spriteArt=rebuilt` (dev) shows the
previous rebuilt set and `?spriteArt=classic` the classic class sprites.

## What ships

- **312 sprites × 6 frames** (`idle0..3`, `windup`, `strike`): every generic class once
  per portrait person of that class (175, see *Portrait people on the map* below), enemy,
  corrupted enemy and NPC; the enemy-only creatures (also as reclassed players); the seven
  lords base and promoted; the eleven named bosses; the Entity.
  `tests/TracedSprites.test.js` fails if the data can spawn a unit without one, and
  `tracedKeyFor` falls back boss/corrupt → class enemy, NPC person → class NPC → player
  person, unknown person → the portrait fallback person → any person of the class,
  promoted lord → base lord, then the classic class sprite, so no class or state ever
  draws a missing texture.
- **Two atlas pages** (`assets/sprites/traced/`, 2046×2015 + 2046×941, 0.77 MB of PNG,
  **23.1 MB decoded**; 24.8 MB before the portrait people). Each sprite is a texture whose
  frames borrow its page's `TextureSource` — no per-sprite canvases (budget in
  `docs/mobile-memory-budget.md`); the only canvases are the NPC people shown in a battle
  (below), about 0.1 MB each.
- **Motion**: the map idle loop at 260 ms per frame (reduced motion holds `idle0`); the
  combat choreography (`src/ui/CombatChoreography.js`, `CombatFxController.setPose`) holds
  `windup` through the lunge and `strike` from contact until the strike finishes. The idle
  ticker yields to a held pose (`_fxPose`), and a rewind mid-lunge now stops the lunge
  tween so the striker ends on its tile.

## Portrait people on the map (2026-09-26)

Owner report from the iOS build: *"a sprite is black but the matching portrait is not."*
A generic unit's sprite and its portrait were chosen by two independent pickers: the
sprite was one of six seeded identities by `hash(name) % 6`, the portrait the unit's
stored person (`unit.portraitVariant`, `src/data/portraitVariants.json`). On main 78 % of
person × class × name combinations showed a sprite whose skin family differed from the
portrait's.

Now the sprite **is** the portrait person:

- **One resolver.** `PortraitVariants.displayedPerson(unit)` returns the person whose face
  the unit shows (the stored person; the name-hash fallback for previews; for a unit
  reclassed out of its line, the same-gender counterpart `variantPortraitId` shows).
  `variantPortraitId` and `TracedSprites.tracedKeyFor` both call it, so face and figure
  cannot diverge. `projectedSpriteUnit` (promotion previews) now carries `portraitVariant`.
- **One sprite per class × person**, key `<class>-<person>` (e.g. `fighter-fighter_d`),
  175 in all (the Falcon Knight and Wyvern Lord pools hold both the Pegasus and the Wyvern
  lines). The person's look is data next to their portrait description
  (`tools/art/portrait-variants/catalog.mjs`, `sprite: { skin, hair, bald }`), picked
  against the drawn portraits; new hair ramps in `lib/ramps.mjs` (dark/light brown, sandy,
  blond, copper, grey-auburn, plum, blue-black, salt-and-pepper, grey). A bald person's
  crown becomes scalp and their sides or beard keep the hair ramp (`identity.mjs makeBald`).
  Skin shading is centred on the face (the upper figure), so a design drawn dark-faced
  with pale palms still wears the person's face tone.
- **Design by gender.** The class-sheet prompts put the man on design A and the woman on
  design B everywhere except the player-set-3 Pegasus Knight (A a woman, B a bearded man),
  `roster.mjs DESIGN_GENDER`. Every class has a design of each gender.
- **Whole-figure skin and hair.** The reviewed designs were drawn as particular people
  (dark-skinned women, red-haired swordswomen); the colour rules found their faces but read
  bare arms as leather, a ponytail as coat, black curls as line work. `person-fits.mjs`
  extends skin and hair to the whole figure per design (colour matches grown from the
  crown, boxes, a colour-family filter for the class sheets' vivid red hair); checked with
  `dev/slots-sheet.mjs`, `dev/slot-probe.mjs` and `dev/person-sheet.mjs`. Enemy, lord and
  boss sprites are byte-identical to before.
- **Promotion** keeps the person and adds the gold circlet, as before.
- **NPCs** (a recruitable villager) wear their person in verdigris, so recruitment no longer
  changes the figure. They are not baked (another 175 sprites, ~13 MB decoded): the bake
  learns the player → NPC colour swap from both renders of every person (8 colours; 0.4 % of
  person pixels differ slightly from a baked NPC) and stores it in the
  manifest (`npcSwap`); `TracedSprites.npcTexture` recolours the person's frames into one
  small canvas (about 0.1 MB decoded) the first time a battle shows that NPC. The baked `npc_<class>` stays the
  fallback.
- **Tests**: `tests/TracedPersonSprites.test.js` holds every person × every class (own line
  and reclass counterparts) to the portrait person, every baked person sprite's recorded
  identity (manifest `person`) to the catalogue, the catalogue's ramps to its own words,
  promotion / preview / reclass / recruitment, and the fallbacks.

[`people_contact.png`](people_contact.png): every class, each person's PC-98 portrait next to
the sprite that ships (read from the atlas), and the runtime NPC recolour of eight of them.
Regenerate with `python3 tools/art/sprite-trace/dev/people-contact.py
docs/art-direction/sprites-v3/people_contact.png --zoom 2 --portrait 64 --npc`.

Known limits (the designs, not the mapping):

- **General**: both reviewed designs wear closed helms, so the five people look alike (only
  the tabard and helm show). **Great Knight** men read mostly as helm and visor.
- **Knight** women: the open helm hides the hair; skin shows in the face opening only.
- **Beards** follow the design, not the person (1–3 px at map size): a design drawn
  bearded (Fighter A, Mercenary A) gives every man of the line a beard in his hair colour,
  a clean-shaven design shows none.
- **Hooded and masked** designs (Thief, Assassin A) show a fringe and a face only.
- **Pegasus Knight** B (the line's one man, pegasus_d) is drawn bearded; the portrait is not.
- Map-size faces are 6–10 px: age (the elderly clerics, the grey knights) reads through
  hair colour, not features.

## Map-size redraws (2026-09-25)

The lords and bosses traced from the ~128 px rebuilt art ran at a trace scale of
0.11–0.45: faces collapsed into a skin blob, straps and trims into mottling (the
v2 "honest assessment"). `tools/art/sprite-trace/gen-refs.mjs` asks the shared image
client (`tools/art/gen/geminiImage.mjs`) for the same unit **redrawn at map size** on a
clean pixel grid:

- image 1: the owner's on-map style board (`sprite-candidates-2026-09-22/reference.png`);
- image 2: an approved map sprite for pixel scale (base Edric; for a promoted lord, the
  chosen base redraw of the same person; for a mounted boss, a reviewed mounted figure);
- then the unit's identity: its rebuilt sprite and PC-98 portrait (for the promoted lords
  the large sprite is left out, since the model otherwise copies its resolution; the
  costume comes from the text).

A flat backdrop is keyed to alpha, the grid recovered, and the chosen take is stored as
its recovered grid at 6× (`docs/art/sprite-candidates-2026-09-25/sources/`, 10–20 KB each,
provenance in `prompts.json`). Raw generations stay out of git (`References/`). About
100 takes were reviewed (`dev/takes-sheet.mjs`, `dev/takes-scales.mjs`); a take was chosen
for identity first (face, hair, colours, signature weapon), then trace scale, then how the
windup/strike frames read.

| Unit | Before (source, scale) | After (scale) | Why this take |
|---|---|---|---|
| Kira | rebuilt, 0.45 | 0.55 | ponytail, plum coat, open tome, pointing hand survive |
| Kira+ | rebuilt, 0.22 | 0.61 | gold-trimmed greatcoat, face lit |
| Voss | rebuilt, 0.36 | 0.65 | beard, moss mantle, greatsword, bow on back |
| Voss+ | rebuilt, 0.17 | 0.66 | same man in plate under the mantle |
| Cael | rebuilt, 0.15 | 0.72 | kettle helm, crimson scarf and cross tabard, poleaxe |
| Cael+ | rebuilt, 0.11 | 0.64 | the same veteran, heavier plate, spear-headed poleaxe |
| Sera+ | Light Priestess sheet, 0.28 | 0.73 | cream robe and red hair of her base sprite, star staff |
| Astrid | Sky Lancer sheet, 0.54 | 0.58 | the lance is finally visible (the sheet figure lunged without one) |
| Astrid+ | Seraph Knight sheet, 0.42 | 0.60 | winged circlet, lance level past the pegasus head |
| Iron Captain | rebuilt, 0.41 | 0.65 | pennant lance, bay horse, crimson caparison |
| Knight Commander | rebuilt, 0.42 | 0.78 | grey dapple horse, silver hair, gold of rank kept |
| Dark Rider | rebuilt, 0.43 | 0.42 | not a scale gain: legs, halberd and pale face read where the old trace was a mass |
| Warchief | rebuilt, 0.41 | 0.57 | red crest, bare arms, war axe |
| Archmage | rebuilt, 0.43 | 0.67 | white beard, red-orb staff, crimson tome |
| Blade Lord | rebuilt, 0.45 | 0.78 | pale face under long black hair, crimson longcoat, sabre |
| Iron Wall | rebuilt, 0.37 | 0.63 | great helm, striped tower shield, spear |
| Berserker King | rebuilt, 0.56 | 0.57 | the overhead double axe gives the clearest chop in motion |
| The Emperor | rebuilt, 0.41 | 0.75 | crown, gold plate and eagle shield (kept gold, see below) |
| The Lieutenant | rebuilt, 0.45 | 0.70 | scarred face, crimson-lined black plate, long cape |

Recipe notes (`roster.mjs`, `GENERATED`): each `<id>_g` reuses the unit's recipe; the
Blade Lord's bloodless face reads as plate to the colour rules, so a skin box restores it;
Voss+'s auto head box landed on the bow tip; the Emperor keeps his own gold trim and plate
and the Knight Commander his gold (`keep`, a new `paletteFor` option) instead of the
empire's iron swap. Edric, Sera, Rowan and the generic classes already traced at 0.55–0.9
from the reviewed sheets and candidates and are unchanged.

## Sheets in this folder

| File | What it shows |
|---|---|
| [`redraws.webp`](redraws.webp) | Every redrawn unit: the redraw's recovered grid, the sprite before (what shipped at the start of this pass) and after, 3×, with trace scales |
| [`lord_sources.webp`](lord_sources.webp) | The seven lords: class-sheet figure, rebuilt art and redraw, all traced; the chosen source is marked |
| [`roster_lords_bosses.webp`](roster_lords_bosses.webp) | Enemy-only creatures (and corrupted), the lords base and promoted, the bosses, the Entity |
| [`people_contact.png`](people_contact.png) | Every class × portrait person: portrait next to the shipped sprite, plus the runtime NPC recolour (2026-09-26) |
| [`roster_a.webp`](roster_a.webp), [`roster_b.webp`](roster_b.webp) | Every generic class: the six seeded recruits of 2026-09-24 (superseded by the portrait people), enemy, corrupted, NPC |
| [`motion_1.webp`](motion_1.webp) … `motion_3` | The six frames of every class line, lord and boss |
| [`anim/`](anim) | Idle loop then the attack, 4×, for a class, three lords and two bosses |
| [`grades_dusk.webp`](grades_dusk.webp), [`grades_night.webp`](grades_night.webp) | The whole roster in the running game at 844×390 DPR 3, under Act I Ember Dusk and the Act IV night (Ashfall on the caldera), every unit kind adjacent to others |
| [`choreography.webp`](choreography.webp) | The Combat v2 choreography on traced frames, frame-exact (`tools/art/combat-fx/capture.mjs`, 844×390 DPR 3): Edric's windup → strike → hit-stop → recover; a lethal strike → hit flash → ember dissolve |
| [`desktop_1280x800_dusk.webp`](desktop_1280x800_dusk.webp) | The mixed v3 cast on the desktop battlefield (1280×800) under dusk |
| [`silhouette_test.webp`](silhouette_test.webp) | Unlabeled class silhouettes (key in `silhouette_test_key.txt`) |

## Display-size review (dusk and night)

Every unit kind was staged in the running game (`dev/capture-game.mjs --cast all --chunk
i/6 --atmosphere act1|act4`) and reviewed at phone size. Findings:

- The redraws fixed the only outliers that read as wrong at display size (the collapsed
  lord and boss faces, Kira+'s mottled coat, the Knight Commander's blotchy gold, the
  Emperor's greyed shield, Cael's missing helm and scarf).
- Dark mounted units (Dark Knight, Dark Rider) stay the darkest masses on the map at
  night; faction rings and HP bars carry them, and the rider's pale face and weapon read.
  Left as designed (their identity is black armour on a black horse).
- Everything else holds its faction area, face and weapon line under both grades.

## Reproduce

```bash
node tools/art/sprite-trace/gen-refs.mjs --only kira --takes 2          # generate (cached)
node tools/art/sprite-trace/dev/takes-sheet.mjs /tmp/takes.png --ids kira --still
node tools/art/sprite-trace/gen-refs.mjs --choose kira:3                # store the chosen grid
node tools/art/sprite-trace/cli.mjs bake                                # atlas + manifest
node tools/art/sprite-trace/review-v3.mjs --only extra,sources,motion,outliers
node tools/art/sprite-trace/dev/person-sheet.mjs /tmp/people.png --classes fighter,warrior --zoom 3
python3 tools/art/sprite-trace/dev/people-contact.py docs/art-direction/sprites-v3/people_contact.png --zoom 2 --portrait 64 --npc
node tools/art/sprite-trace/dev/capture-game.mjs OUT --cast all --chunk 0/6 --atmosphere act1 \
  --maps river_crossing --viewports 844x390 --dprs 3 --variants traced --cells 11x5
```
