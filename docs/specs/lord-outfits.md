# Lord outfits (the Wardrobe)

A Valor sink that buys choice, never power (owner, 2026-10-21; price set 2026-10-27).
Design notes: `/mnt/project-files/reviews/valor-sinks.md` §2.

## Rules

- One alternate outfit per lord (`data/lordOutfits.json`): Edric Ashen Crown, Kira Field
  Marshal, Voss Winter Ranger, Sera Hollow Sun Vestments, Rowan Black Banner, Astrid Storm
  Rider, Cael Old Guard. Looks only: the portrait (base and promoted, every size) and the
  map sprite (base and promoted). Stats, crest, kit, voice: unchanged.
- **6,000 Valor** each (`price`), bought once per save slot, never refunded.
- Buyable only after a run **won with that lord alive** (a survivor of the victory);
  Edric after any win. The unlock is the milestone `wonWith:<Lord>`, written in
  `recordRunEnd` for every surviving lord of a victory record; a save from before it
  unlocks from its victory records (`LordOutfits.hasWonWithLord`). The milestone outlives
  the records, which age out at 50.
- Buying wears it. The Wardrobe switches each lord between the outfit and the own look;
  the choice applies to every run on the slot, NG+ included, from the next screen drawn.
- A lord the save has not met is not listed.

## Saved

- Ownership: `purchasedUpgrades.lord_outfit_<id> = 1`. It travels with the economy that paid
  for it: the cloud fetch and the local adopt keep one payload's economy whole, and an older
  build copies `purchasedUpgrades` whole, so it is never dropped. No refund path names it.
- The choice: `lordOutfitsWorn` (`{ <lord>: <outfit id> }`), a meta field adopted whole from
  the newer copy; on load an entry is kept only for an owned outfit of that lord.
- Never in the run save: the run is drawn with whatever the slot's meta says.
- Every change goes through `MetaProgressionManager._commit` (`buyLordOutfit`,
  `setLordOutfit`): checked after a newer disk copy is adopted, rolled back on a failed write.

## Runtime

- `src/engine/LordOutfits.js` (pure): catalog, ids, unlock rule, validator
  (`npm run validate:data`).
- `src/ui/lordOutfitArt.js`: the one reader of what a lord wears (`wornOutfitFor(unit)`),
  fed by the registry's meta (`main.js`). Enemy and NPC units never wear one.
- Portraits: `portraitArt.portraitCandidates` puts `lord_<name>[_promoted]__<outfit>` first
  when the figure exists (a promoted lord without the promoted drawing keeps the base
  outfit). Outfit figures are lazily loaded PC-98 variants (no atlas, no baked texture).
- Map sprites: `TracedSprites.tracedKeyFor` takes `lord_<name>[_promoted]__<outfit>` when
  the sprite exists, else the lord's own figure.
- UI: Home Base's Wardrobe tab (`ui/WardrobePanel.js`, words in `ui/wardrobeModel.js`); Buy
  asks once ("Spend 6,000 Valor?"). Review route `?devScene=homebase&preset=wardrobe`.

## Art

`tools/art/lord-outfits/`: `generate.mjs` (four takes per outfit, the house style sheet and
the lord's rebuilt portrait as references), `sheet.mjs` (contact sheets), `picks.json` (the
shipped take per outfit and tier), `portraitJobs.mjs` (feeds the picks to
`tools/art/portrait-variants/prepare.mjs` and `tools/art/pc98/build.mjs`).

Tests: `tests/LordOutfits.test.js`, `tests/e2e/wardrobe.spec.js` (the Home Base lane in
`tests/e2e/lanes.json`).
