# Style directions: FE / anime crossed with Souls

This is a follow-up to the first candidate pass (`../`), which read clearly but looked too blocky
and whimsical. These sprites are drawn pixel by pixel from layered text grids
(`tools/sprite-kit/grid.mjs`), not assembled from rectangles. That allows 3/4 poses, tapered
limbs, hair clusters, cloth folds and ragged hems.

Regenerate with `npm run sprites:variants`. Each direction draws the same four subjects: Edric,
Knight, Mage and Fighter. Every non-lord subject has a player (blue) and an enemy (red) version.

| Direction         | Idea                                                                                                                                                              | Source                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **A · Classic FE** | Anime map-sprite lineage. 3/4 pose facing right, ~3.2 heads tall, expressive hair with a shine band, eyes, clean palette.                                         | `tools/sprite-kit/variants/classic.mjs`  |
| **B · Ashen**      | Souls-leaning. ~4 heads tall, small faces in hood or helm shadow, tattered cloth, ash, iron and rust. Faction survives as a narrow saturated tabard, stole or baldric. | `tools/sprite-kit/variants/ashen.mjs`    |
| **C · Twilight**   | Hybrid. A's anatomy and anime faces for allies; muted materials, a cool rim light, and enemies whose faces are covered (closed visor, shadowed hood, iron half-helm). | `tools/sprite-kit/variants/twilight.mjs` |

## Review sheets

- `review-directions-labeled.png`: the line-up per direction at 3x, with notes
- `review-directions-1x.png`: true size, as it appears on the map
- `review-directions-closeup.png`: 6x close-ups. One row per direction, in the order Edric,
  then Knight, Mage and Fighter, each as a player/enemy pair.
- `review-directions-checks.png`: per sprite:
  - on bog
  - grayscale on bog
  - silhouette
  - deuteranopia on meadow
- `<direction>/<faction>_<key>.png`: 64x64 sprites using the same placement contract as the first
  pass

## Findings from the checks

- **A** is the most legible and reads unmistakably as Fire Emblem. It's also the least dark.
- **B** has the strongest mood; knight and hooded mage are the standouts. The cost: player vs enemy
  now leans on a 2px stripe plus the ring. In grayscale on bog, the mage and knight lose the
  most separation from the ground. It needs a brighter rim or a lighter cloth ramp before it
  could ship.
- **C** keeps A's clarity and adds a second side signal. Allies show faces, while enemies are
  helmed or hooded, so the sides differ by silhouette as well as color. That also helps
  colorblind players.
- Mixing is possible: B's proportions and costumes with C's rule of faces for allies and covered
  faces for enemies. The grid pieces are shared, so a hybrid is cheap to try.
