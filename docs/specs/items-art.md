# Items, rewards and services art — production (2026-09-25)

Follows the owner-approved direction from the study
([`items-art-study.md`](items-art-study.md), [`art-direction/items/README.md`](../art-direction/items/README.md)).
Captures and the as-built tour: [`art-direction/items/production/`](../art-direction/items/production/README.md).

## Brief (as given)

1. **Icons — direction A "Forged in code"** for every item, weapon, consumable, accessory,
   whetstone, imbue/stone, scroll, staff, blessing and meta upgrade: procedural pixel icons
   drawn natively per size from the data (`tools/art/icons/lib/pixelIcon.mjs` +
   `itemGrammar.mjs`), set in **direction C's sockets** (socket shape = category, rim =
   tier/rarity). Do the design pass the study flagged: helm plumes too small to carry stat
   colour, the Skills upgrade tab reading as all scrolls, repeated blessing icons, tome
   emblems lost at 16px. Build-time atlases (16/32/48; 48 lazily loaded), an `itemIcon()`
   helper, and a coverage + determinism unit test (every item id in data resolves to an
   icon; output byte-stable).
2. **Hero-size icons — direction B "PC-98 painted"** only where an item is shown large
   (the item detail panel in shop/forge/rewards/convoy/unit details, ~48px+): generated
   paintings via `tools/art/gen/geminiImage.mjs`, keyed and dithered to the art-bible
   palette. Curate every one at display size; fall back to the A icon for any item
   without an approved painting. Mind the generation quota (Pro ~250/day; use
   `gemini-3.1-flash-image` when Pro is exhausted and hold both to the same review bar).
3. **Moments with generated paintings:** 23 tarot-style **blessing cards** (tier frames
   and cost seals in code, painted art per blessing — fix the study's Field Medic
   inner-panel issue) and **6 service vignettes** (forge, church, shop, colosseum, ruins,
   caravan) as backdrops/header bands. Plus the reward-reveal and upgrade-purchase moments,
   with motion (forge sparks, candle flicker, card turn), respecting reduced motion.
4. **Wiring**, in impact order: battle rewards, then shop/forge/church/arena/ruins/
   caravan/village menus, loot choices, convoy, roster Equipment tab, unit details,
   upgrades (HomeBase), blessing select. Delete the 37 unused legacy `icon_*` images loaded
   at every boot. Respect the mobile texture budget (display-sized assets, atlases, lazy
   moment art, one vignette decoded at a time). Report a texture-memory probe before/after.

## As built

### Icons (A in C's sockets)

- `tools/art/icons/lib/catalog.mjs` is the one list: **302 icons** — 81 weapons, 49
  scrolls (each with its own seal glyph), 15 consumables, 33 accessories, 5 whetstones,
  6 imbuing stones + Prismatic, gold, 23 blessings, 72 upgrades and 16 `generic-*`
  fallbacks. Ids: `slug(name)` for items, `blessing-<id>`, `upgrade-<id>`
  (`src/ui/itemIconIds.js`, shared by the build and the runtime).
- `tools/art/icons/build.mjs` renders each natively at 16/32/48 into three palette PNG
  atlases (`assets/ui/items/atlas-{16,32,48}.png`: 14 + 33 + 57 KB; 0.30 + 1.19 + 2.67 MB
  decoded) with our own deterministic PNG encoder (`lib/png.mjs`: exact palette, zlib
  only), and writes `src/ui/itemIconManifest.json` (cell, socket, rim, atlas hashes,
  approved heroes). `--check` fails on stale outputs.
- Design pass: scrolls carry the skill's glyph (22 skill glyphs, `lib/glyphs.mjs`) or the
  weapon family's on the wax seal; the Skills upgrade tab is glyph **medallions**;
  recruit upgrades wear a helm with a tall stat-coloured **crest**, lord upgrades a crown
  over a stat-coloured **cap**; every blessing boon is its own object (new: salve jar,
  lantern, war horn, smith's hammer, scallop token, oak leaf, crossed blades, hourglass,
  chained tome, blood anvil, boot pair); tomes redraw their emblem 1.5x at ≤ 20 px.
- Sockets are CSS (`src/ui/itemArt.css`): weapon = heater, scroll = cartouche, supply =
  roundel, accessory = lozenge, forge = octagon, blessing = sun disc, upgrade = pennant.
  Rims: Iron/Steel/Silver/Rare/Legend (weapons), plain/fine/Rare/Legend (untiered),
  I–IV (blessings). Legend and Rare rims glow. Forge level (`+2`) and the imbue's
  stone (a coloured pip) ride on the icon.
- `src/ui/itemIcons.js`: `itemIcon(subject, {size, socket, kind})` and
  `itemHero(subject, {size})`. `subject` is anything the game shows (item, reward choice,
  blessing, upgrade, name); forged/imbued names resolve to the base item; unknown items
  fall back by type. Integer scales only (64 = 32 atlas 2x, 96 = 48 atlas 2x); atlases are
  CSS backgrounds, so an atlas downloads and decodes only when an icon of that size is
  on screen.

### Painted heroes (B)

- `tools/art/icons/hero/`: `prompts.mjs` (139 subjects: every weapon but the enemy-only
  breaths, consumables, accessories, whetstones, stones, gold), `generate.mjs` (magenta
  ground, Pro → Flash fallback on quota), `treat.mjs` (flood-key the ground, crop, resize
  to 96, PC-98 figure pass, palette snapped to the art-bible ramps, `--publish`),
  `select.mjs` (curation decisions + notes) → `selections.json`.
- **139 approved**, `assets/ui/items/hero/<id>.png`, 96 px palette PNGs, 1–4 KB each
  (560 KB for the set), drawn at 1x on a chamfered plate with the tier rim; never shrunk
  (a 64 px slot shows the pixel icon at 2x). Scrolls, blessings and upgrades use their
  pixel icon at 2x — the glyph is the point.

### Moments

- `tools/art/moments/`: prompts from the shrine lore and places, `generate.mjs`,
  curated `selections.json`, `treat.mjs` (PC-98 scene treatment) →
  `assets/ui/moments/cards/<blessing>.png` (192×256, 23) and
  `assets/ui/moments/vignettes/<service>.png` (640×360, 6), `src/ui/momentArtManifest.json`.
- Field Medic: a close-up of the sister's hands pressing the salve jar into a palm, no
  doorway — no inner panel.
- Vignettes (`src/ui/itemMoments.js`): desktop gets a 150 px header band at 2x with the
  service name in Cinzel and its services as a kicker; phones get the painting at 1x
  behind the detail pane (shop) or the whole menu (church, arena), fading to ink under
  text. Only one of the two layouts displays, so one vignette decodes. Forge sparks,
  church/ruins candle flicker, colosseum torch glow; all stop under Reduce motion (the
  game setting or the OS preference).
- Upgrade purchase (`MobileUpgradeMenu`): rows gain their icon (a locked upgrade shows a
  silhouette), the rim shows progress (plain → bronze → gilt at max), pips are gems;
  buying stamps **TIER n** across the detail in Cinzel, flares the row socket and
  ignites the new gem.
- Reward reveal (`src/ui/rewardReveal.js`): Hollow Sun card backs turn in order, 180 ms
  with a 90 ms stagger, the rarest flashes ember; a tap skips (and never selects),
  Reduce motion and Instant speed show the end state. Presentation only.

### Wiring

| Surface | What changed |
| --- | --- |
| Shop / forge / caravan / ruins market (`ShopMenu`) | socketed 32 px icons on every row; detail leads with the hero beside kicker, name and numbers; lore as a quote (no "Item story" tap); vignette (shop, forge on the Forge tab, caravan, ruins) |
| Church / ruins sanctuary (`ChurchMenu`) | vignette band / backdrop, candle flicker |
| Colosseum (`ArenaMenu`) | the gate behind every arena screen, torch glow |
| Roster equipment, consumables, accessories, convoy, team scrolls (`MobileRosterSheet`; also the unit details sheet) | item cards lead with the socketed icon; About this item shows the hero beside the story (lazy) |
| Army upgrades (`MobileUpgradeMenu`) | icons, gem pips, the purchase moment |
| Boot | the 37 `icon_*` textures are no longer loaded; files deleted |

## Deviations

- Hero paintings stop at 96 px on a plate (the pane is ~205 px tall at 844×390); on short
  phones the plate rim is 8 px instead of 16. The numbers sit beside the picture so a
  phone reads them without scrolling.
- The study's "C" plaques are sockets behind the A icon (not engraved sigils); the icon
  may overhang the plaque.
- All generations came from the Flash model: the shared Pro quota was spent before this
  work started (one Pro image went through, then 429 "per day, limit 250"). Every image
  was held to the same bar at display size; failures were re-prompted (see
  `hero/select.mjs`).
