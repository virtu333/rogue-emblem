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
  with a 90 ms stagger (rows of a list turn over their long axis), the rarest (Silver and
  up) flashes ember; a tap or key skips. A reward card tap only selects, so the tap that
  skips also selects (`passThrough`; by default the skipping tap is swallowed). Reduce
  motion and Instant speed show the end state. It plays **once per battle**: the reward record
  gains `revealed: true` (saved with the record; records saved before this have no flag
  and reveal once), and a resume, a restored half-made choice or a later pick never
  replays it (`rewardRevealPending`). Presentation only — no RNG, no game state.
- Blessing tarot cards (the choice screens' draft): the shrine painting fills the top of
  each card behind the tier numeral and the name, fading into the ink where the boon and
  cost are read; 1x on phones (a phone card is wider than the painting, so the same
  painting blurred and dimmed fills the margins), 2x on desktop. Tier IV adds a dotted
  ember inner frame. The cost wears a wax seal: crimson for a price, verdigris for a clean
  gift. Cards set aside dim with their painting.

### Wiring

| Surface | What changed |
| --- | --- |
| Shop / forge / caravan / ruins market (`ShopMenu`) | socketed 32 px icons on every row; detail leads with the hero beside kicker, name and numbers; lore as a quote (no "Item story" tap); vignette (shop, forge on the Forge tab, caravan, ruins) |
| Church / ruins sanctuary (`ChurchMenu`) | vignette band / backdrop, candle flicker |
| Colosseum (`ArenaMenu`) | the gate behind every arena screen, torch glow |
| Roster equipment, consumables, accessories, convoy, team scrolls (`MobileRosterSheet`; also the unit details sheet) | item cards lead with the socketed icon; About this item shows the hero beside the story (lazy). The equipped accessory and the shared pool are full item cards (name as title, equipped badge, picture and story; until 2026-09-26 the equipped one was a generic "Equipped accessory" card with no art or lore); team scrolls tell their story too |
| Army upgrades (`MobileUpgradeMenu`) | icons, gem pips, the purchase moment |
| Battle rewards (`MobileRewards`, `choiceCards.itemArtSlot`) | each reward card's art slot (`.ch-item-art[data-item-art-hook="item-icon"]`) shows the socketed icon on phones (48 px; 32 px in a five-card draft) and the painted 96 px hero on desktop, replacing the deleted `icon_*` images; the reveal; forge/imbue weapon steps carry the weapon's icon and picture |
| Battle rewards, notes and follow-up steps | the chosen reward's lore under the cards (as the shop sets it); the equip / send / forge-recipient steps show the reward's picture beside the choice; imbue rows wear their stone's icon |
| Battle trade (`BattleTradeMenu`) and the phone action rail's Equip / Item submenus (`MobileBattleHUD`) | trade rows lead with the 32 px socketed icon (`re-row--item`); submenu rows with a 16 px icon before the name (the row keeps its height and its one-line brief) |
| Compendium (`ReferenceMenu` via `compendiumEntries`) | Arms, Items and Bless entries lead with their icon; the detail floats the item's picture (painted hero, else the 2x pixel icon) with the text wrapping beside it; accessories read as in the shop, not as effect codes |
| Blessing select (`RunSetupMenu`) | tarot cards carry the shrine painting, the tier IV frame and the wax cost seal |
| Boot | the 37 `icon_*` textures are no longer loaded; files deleted |

## Generation

All through `tools/art/gen/geminiImage.mjs` (provenance in each raw folder's
`generations.jsonl`, under `References/items-art/`, not shipped):

| Set | Images generated | Approved |
| --- | --- | --- |
| Hero paintings | 157 (Flash) | 139 — 18 were re-prompts of rejected takes |
| Blessing cards | 47 (Flash) + 1 (Pro, the quota probe; not used) | 23 |
| Service vignettes | 14 (Flash) | 6 |

## Deviations

- The reward and blessing screens were redesigned on main (the choice screens) while this
  was in progress; the item art targets the new cards. Before they landed, the older
  reward list and blessing list were wired and verified too, then that wiring was dropped
  in the merge.
- Canvas surfaces (the in-battle loot banner and HUD item names) keep text; the item
  art is DOM-only.
- Hero paintings stop at 96 px on a plate (the pane is ~205 px tall at 844×390); on short
  phones the plate rim is 8 px instead of 16. The numbers sit beside the picture so a
  phone reads them without scrolling.
- The study's "C" plaques are sockets behind the A icon (not engraved sigils); the icon
  may overhang the plaque.
- All generations came from the Flash model: the shared Pro quota was spent before this
  work started (one Pro image went through, then 429 "per day, limit 250"). Every image
  was held to the same bar at display size; failures were re-prompted (see
  `hero/select.mjs`).
