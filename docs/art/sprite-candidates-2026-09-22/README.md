# Detailed map sprite candidates — September 22, 2026

## Status

Experimental standalone set, generated with the built-in image-generation tool.
Not installed as shipping art. Another agent's gameplay/balance/history work was
left untouched. Muted isolated browser session and temporary dev server closed.

## Contents

- `sources/`: original transparent generated PNGs for base Edric, base Sera,
  player Archer and enemy Knight. These are enlarged pixel-style sources, not
  guaranteed integer pixel grids or animation sheets.
- `prompts.json`: exact prompts and reference path.
- `reference.png`: user's preferred small on-map reference, copied for durability.
- `validation/*-64.png`: renderer-produced 64×64 candidate textures, cropped and
  sized through the existing spritePlacement function, nearest-neighbor sampling.
- `validation/metrics.json`: alpha bounds and final placement measurements.
- `validation/terrain-comparison.png`: current vs candidate sprites on the actual
  game's Plain/Forest/Floor art at 2× display size.
- `validation/states.png`: crowded adjacent tiles, opacity approximation for acted
  state, and illustrative danger/selection overlays at 3×. These are controlled
  visual checks, not the actual gameplay state implementations.
- `validation/in-game-lords.png`: actual Phaser scene, Edric/Sera textures replaced
  in memory. No save changes or release replacements.
- `capture.cjs`: repeatable isolated browser capture (requires local project and
  local dev server on 127.0.0.1:3016). Playwright is muted, headless and isolated.

## Results and limits

| Unit | Visible box | Notes |
| --- | --- | --- |
| Edric | 32×34 | Recognizable teal/silver. Sword reaches tile edge; still more gold trim than intended for base class. |
| Sera | 23×30 | Strong red hair/cream robe. Visibly narrower than others; character identity survives. |
| Archer | 29×34 | Largest readability improvement: white quiver, curved bow and blue scarf stand out. |
| Enemy Knight | 37×36 | Broad armor reads clearly. Extends beyond 32px tile; weapon/shield approach adjacent figures. |

Feet use existing y=44 baseline in a 64×64 centered texture. Existing tile/grid
size is unchanged. Alpha was inspected with >10 threshold to ignore almost
invisible padding. Full edge/fringe and animation quality have not been certified.

The candidate archer uses the 34px infantry profile, while the legacy comparison
uses its current 36.8px texture-display sizing, so visible body scale is not
identical. Both rendering sizes are intentional and explicit; some readability
improvement comes from larger visible art, not just the new design.

Actual in-scene texture replacement covered the two lords. Archer/Knight were
checked in real-terrain compositions, not through live combat. No movement,
rewind, animation, fog, or hitbox regression suite was run because production
code was not changed. The current worktree belongs to concurrent development;
this is a static art study, not a release gate.

## Suggested next iteration

1. Review this four-unit set before expanding it.
2. Reduce base Edric's gold trim and slightly shorten/bring in his sword.
3. Bring Knight's weapon/shield inside a narrower silhouette without shrinking
   the torso; preserve its stocky class identity.
4. Test the same class across factions (blue player Knight, red enemy Archer)
   to separate class recognition from color recognition.
5. Add two easy-to-confuse infantry classes (Myrmidon vs Duelist) and one flyer,
   preserving distinct silhouettes and common lighting/pixel density.
6. Test actual mobile landscape size, neighboring units, genuine acted tint,
   selection/danger, fog and motion before any production adoption.

The user's preferred direction is the detailed small figures from the A board,
not generic simplified GBA icons or shrunken smooth portraits. Original existing
lord identity stays; ornate armor/robes remain appropriate for promoted variants.
