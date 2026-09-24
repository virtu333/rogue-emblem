# Full class sprite review — September 22, 2026

## Start here

Open **index.html** for the searchable review gallery. Each generic class sheet
reads **Player A / Player B / Enemy** from left to right. Named lords have two
same-character design alternatives. Enemy-only creatures have one design.

Scope: **52 class entries, 132 designs** (33 generic classes × 3, 14 named-lord
classes × 2, 5 enemy-only entries × 1). This includes base and promoted tiers.
An additional `edric-base-revised.png` is the explicit armor-removal revision.
Dancer/Bard enemy treatments are exploratory faction variants, not new spawn
rules. No game art, class data, enemy spawns or saves were modified.

## Edric correction

The standalone revised base Edric removes the plate chest, shoulders, forearms
and knees, keeping a plain tunic, leather equipment and teal cloak. The Lord
class pair follows the same unarmored brief. Great Lord remains armored.

## Assets and provenance

- `sheets/`: original generated transparent class review sheets.
- `sprites/`: individual renderer-sized PNG candidates, 64×64 for regular units,
  128×128 for Entity; rendered from the original sources using the game's current
  spritePlacement and nearest-neighbor sampling. Number suffix matches left to
  right order, not an installed game identifier.
- `catalog.json`: exact generation prompts, class metadata and source references.
- `validation/contact-1.png` through `contact-5.png`: real game terrain previews
  at current placement sizes, enlarged 2× for inspection. Entity alone is fitted
  to the small contact card; inspect its 128px candidate separately.
- `validation/metrics.json`: measured bounds, rendering placements and any cut
  boundary warnings.
- `capture-review.cjs`: reproducible, muted isolated browser renderer; requires
  local Rogue Emblem dependencies and a local development server on port 3016.
- `build-review.cjs`: rebuilds the static searchable gallery.

Generation used the built-in image-generation tool. The user's cropped A-board
map figures supplied the primary style reference. Named lord sources were also
used to preserve character identity where available. These are original review
candidates; not a shipped replacement atlas or complete animation set.

## Verification

The renderer uses actual WeatheredTerrain Plain/Floor textures and current
spritePlacement code. Transparent gutters are used to separate class-sheet
characters because generated sheets do not always obey exact equal-width cells.
Source PNGs are preserved. Gameplay code and another agent's balance/history
changes remain untouched.

This pass checks asset coverage, separation, class silhouettes and static scale.
It does not certify animation, attack poses, faction recoloring, fog or acted
state behavior, or mobile playability for the entire roster. Full promotion
continuity and lore/portrait matching still need art-direction review.

## Review priorities

1. Base Edric should stay lightly equipped; Great Lord can carry full plate.
2. Knight/General correctly carry lances, following class proficiencies, rather
   than the sword from the earliest experiment.
3. Several A/B recruit pairs repeat brown-haired/red-haired appearances. Select
   desired silhouettes first, then diversify hair, skin tone and outfit details.
4. Myrmidon/Swordmaster/Duelist and Mage/Sage/Warlock must remain distinguishable
   at actual phone size; detail visible only in large sheets is not enough.
5. Mounted/flying figures require strict width and foot/tile checks. Tiny riders
   and overlong lances can weaken class recognition after scaling.
6. Some armored variants are mostly differentiated by crest, helmet or shield;
   choose whether that is sufficient before expanding individual identities.
7. Enemy red can become dark against forests. Test the selected candidates with
   real faction rings, HP bars, danger overlays and acted tint before adoption.

These are options for review. No automatic choice between A/B has been made.

Final checks: all **52 source sheets / 132 extracted candidates** present; no
transparent-cut boundary warnings after gutter-aware separation. Gallery search,
tier filter and all source/thumbnail image links checked (zero broken images).
Mounted contact previews include full lance height. Browser checks were muted
and isolated; temporary game server was shut down afterward.


Map/identity follow-up: see [map-review.html](map-review.html) for staged actual-renderer comparisons, revised archer identities, and the corrected nonhumanoid 3×3 Entity. Exact built-in imagegen prompts: revision-prompts.json. Production assets unchanged; full boss-scene validation remains pending.
