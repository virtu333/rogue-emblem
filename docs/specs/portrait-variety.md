# Portrait variety

Status: implemented on `claude/portrait-variety` (2026-09-25).

## Problem

iPhone playtest: two Fighters, Bram and Roderick, showed the identical bald, bearded PC-98
portrait. Every generic unit of a class shared one face, so a roster with two units of a class
always had twins. Ask: many more faces (sprites stay shared per class) so this happens far less
often.

## Spec (as given)

1. **Variants per generic class.** 4-6 distinct PC-98 portraits per generic (recruitable/enemy)
   class, varying age, gender, hair, skin tone, features and expression, in exactly the
   established style, palette, crop and size of the PC-98 set. Gemini bases with the current
   portraits as style references, then the production pass (palette quantize, dither, crop,
   cleanup) of the existing PC-98 tooling. Lords and bosses keep their portraits. Review every
   output at display size and regenerate anything below the bar; regenerate existing outliers.
2. **Assignment.** Deterministic and stable for a unit's lifetime: store `unit.portraitVariant`
   when a unit is created/recruited/hired/boss-recruited, from a stable hash (name + run seed),
   never consuming battle RNG. Prefer a variant not already used by a roster unit of the same
   class. Legacy units get a stable hash-based variant on load (guarded, idempotent). Promotion
   keeps the same face. Enemies may use variants via a stable hash of their spawn identity.
3. **One helper, every surface.**
4. **Mobile memory budget.** More faces must not raise texture memory: display-sized assets,
   lazy-load, release unused; stay compatible with the memory-budget rules (no image above 3x
   its display size, no raw/backup/unused files under `assets/`).

## What was built

### Faces

- **Player side: 60 people, 175 drawings.** Each base class line (a base class and its
  promotions) has five people; each person is drawn once per class of the line, so a Fighter
  who becomes a Warrior or Berserker keeps their face and changes gear. Cross promotions are
  classes of the line (a Pegasus Knight person also has a Wyvern Lord drawing; a Wyvern Rider
  person a Falcon Knight one), so Falcon Knight and Wyvern Lord have ten people each. Bard
  (Dancer's promotion) gets its own drawings for the first time.
- **Enemy side: 32 human enemy classes x 4 faces**, in the Empire's iron and crimson. Monsters
  (Dragon, Dragon Lord, Zombie, Revenant) and the Entity keep their single portrait; lords and
  bosses keep theirs.
- **Outliers and legacy defaults redrawn.** The class default ids (`generic_<class>`,
  `enemy_<class>`) are kept; the four approved rebuilt generics (Fighter, Sniper, Warlock,
  Battle Monk) are used as is, every other generic and enemy default is remastered from its
  legacy design at the rebuilt quality (the flagged outliers - Trickster, Duelist, Pegasus
  Knight, Bow Knight, Dark Knight, Dancer, Wyvern Lord/Rider, Hunter, Thief, enemy Warrior /
  Great Knight / Paladin - redesigned), so the whole set shares one fidelity.
- **Genders follow the recruit name pools** (`data/recruits.json`, 10 names per class after the
  lore pass): Fighter 3 men / 2 women, Knight 3/2, Mercenary 3/2, Dancer 4 women / 1 man,
  Pegasus 4 women / 1 man, and so on. A name that reads as a man or a woman gets a matching
  face (`NAME_GENDERS` in the catalogue; names that read as either match any face).

Pipeline (`tools/art/portrait-variants/`, README in `docs/art-direction/portraits-variety/`):
`catalog.mjs` (who) -> `plan.mjs` (jobs, ids, runtime table) -> `generate.mjs` (Gemini 3 Pro
Image through `tools/art/gen/geminiImage.mjs`; style sheet of four rebuilt portraits, the
person's first drawing as identity reference, the class default as outfit reference; paced,
backs off on the spend-rate limit; provenance `generations.jsonl`) -> `review.mjs` (accepted
raw hashes in `review.json`; retakes bump `notes.json`) -> `prepare.mjs` (cut out of the white
backdrop, eye line / face size normalised to the approved set via vision-model face boxes,
384 px 256-colour source in `docs/art/portrait-variant-sources/`) -> `tools/art/pc98/build.mjs`
(the unchanged PC-98 pass, all six sizes) -> `sheet.mjs` (contact sheets).

### Assignment (`src/engine/PortraitVariants.js`, pure)

- `unit.portraitVariant` holds a **person id** (`fighter_d`) for player-side units and an
  **enemy face id** (`enemy_fighter__c`) for enemies. Lords and bosses never get one.
- Choice = the class's people ordered by `stableHash(runSeed|name|class|person)` (FNV-1a +
  murmur finaliser), gender-filtered by name, skipping people the roster / units offered with it
  already wear, then people who fell this run, before allowing a repeat. No `Math.random`.
- Assigned at: run start (extra starter), battle placement (`BattleScene.addUnitGraphic` ->
  `placeBattlePortrait`: recruit NPCs, reinforcements, restored checkpoints), colosseum merc
  candidates and boss-recruit candidates (`RunManager.assignPortraitVariants`, together so they
  never share a face), dev presets; `getBattleParams` backfills as a safety net.
- **Legacy saves:** `RunManager.fromJSON` backfills roster and fallen units in roster order,
  idempotent; a save without a run seed hashes with 0 (never the `Date.now()` fallback), so
  reloading without saving shows the same faces.
- **Promotion:** the person is kept; the resolver shows that person's drawing for the new class
  (decision: matched promoted drawings rather than mapping promoted units to their base face -
  the promotion rite and path chooser now show *this* unit in the new class's gear). A reclass
  into another line maps to a stable same-gender counterpart (reversible).
- **Enemies:** face = hash(run seed | node id | battle entity id | class), stored at placement,
  so a refresh restores the same face and nothing reads the battle RNG.
- Victory records now also store `portraitVariant` and `tier` (optional; old records fall back).

### One resolver, every surface

`portraitIdForUnit(unit, gameData)` (`src/ui/portraitArt.js`) puts the unit's own face ahead of
the class chain; every DOM surface already went through it (roster list and details via
`unitPortrait`, battle HUD forecast, level-up card and promotion rite, promotion path chooser,
join card, cut-ins and boss card via `ceremonyPortrait`, Loom party chips, deploy and arrival
rows). The canvas key helpers (`_getPortraitKey` in BattleScene, RosterOverlay and
UnitDetailOverlay were three copies of the class chain) now delegate to `unitPortraitKey`
(`src/ui/RebuiltPortraits.js`), which feeds the desktop forecast, dialogue (recruit lines, last
words), cut-in fallbacks and headless canvas overlays; `dialoguePortraitKey` resolves a speaker on
the field or in the army to its own face. Text lists that named units without a face now show
the same 32 px chip: church revive/promote, colosseum fighters and merc board, shop unit
choosers, recruit/merc detail, victory records.

### Memory

Boot textures are unchanged: the four canvas atlases and the baked 192 px textures still hold
the 94 class defaults. The ~270 variant faces ship as display-sized figures (6 sizes, 4-bit
palette PNGs) that the DOM decodes on demand; the canvas (desktop forecast, fallbacks) composites
a variant with its plate into a small texture on first use (`src/ui/portraitTextures.js`,
40 px = 6.4 KB, capped at 96, released when a battle ends). Provenance moved out of `assets/`.
Probe numbers: `docs/art-direction/portraits-variety/README.md`.

## Deviations

- **Faces added to text lists** (church, colosseum, shop choosers, arrival detail, records):
  these surfaces had no portraits; the spec listed them as resolver surfaces, so they now show
  the unit's face through the same helper, with row text (and accessible names) unchanged.
- **All legacy generic/enemy defaults remastered**, not only the flagged outliers: next to the
  new drawings the 128 px legacy renders read as a different set (small busts, backdrops,
  cut-out holes, glowing eyes, skull faces).
- **Genders follow name pools**; the lore pass (merged mid-task) added women's names to the
  Fighter, Warrior and Hero pools and men's to Dancer and Pegasus, so the lines were rebalanced.
- **Provenance** `assets/portraits/pc98/manifest.json` -> `tools/art/pc98/provenance.json`
  (shipped but never loaded). The memory-budget branch's `RebuiltArtBudget` test reads the old
  path: point it at the new one when both land. Its "PC-98 set < 6 MB" guard still holds (the
  set is 5.4 MB with the variants); `tests/PortraitArtBudget.test.js` enforces the same bound.
