# Items, rewards and services — art direction study (brief)

Status: **study delivered**, awaiting the owner's choice of direction. Results:
`docs/art-direction/items/README.md`.

## Brief (from the owner, via the lead)

Gambler's Coin made the owner notice that art is missing across the gameplay flow:
blessings, rewards, forge, church, "etc. there are more we could do as well like items and
upgrades too — we should be bold". An image-generation key is available: "use image
generation to tackle anything you didn't think met our high bar".

Deliver a direction study:

1. **Audit.** Find every surface that shows an item, service or upgrade with no art or with
   weak art: weapons (8 types incl. staves and scrolls), consumables, accessories,
   whetstones, imbues and stones, blessings (23, tiered, with costs), meta upgrades (72 in
   6 categories), the rewards screen, the shop/forge/church/arena/ruins/caravan menus, loot
   choices and the convoy. Screenshot each at 844×390 and on desktop.
2. **Icon grammar.** Show 2–3 distinct directions for a coherent icon system, each with a
   sample of about 24 icons across categories, at real display sizes (16/24/32/48) on real
   backgrounds. Procedural in code is preferred where it meets the bar; use image
   generation (`tools/art/gen/geminiImage.mjs`) for what procedural can't reach.
3. **Moments.** Bold treatments for blessings (cards with tier frames and cost seals),
   service vignettes, the reward reveal and the upgrade purchase, mocked into the real
   screens.
4. **Recommendation.** One direction, with a production plan: asset count, pipeline,
   memory-budget impact, and what is generated versus procedural.

## Constraints

- Study only: no game-code changes. Mockups composite the art into the real DOM through dev
  routes.
- Images compressed, about 4 MB or less in the repo; full-resolution originals stay in
  `References/` (gitignored).
- Ink & Ember language (ART_BIBLE): key light upper-left, art-bible ramps, Cinzel only for
  ceremonial words.

## Deviations

- The Gemini Pro image model hit its daily quota (250 requests, shared) partway through.
  B's last three icons and all the moments art (cards and vignettes) come from the Flash
  model. Re-generating with Pro is part of the production plan.
- Motion (forge sparks, candle flicker, card turns) is drawn as static frames and
  specified in the README. It is not animated in the mockups.
