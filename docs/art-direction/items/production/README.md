# Items, rewards and services — production

The owner-approved direction from the [study](../README.md): **A · Forged in code** for every
icon, set in **C's sockets**; **B · PC-98 painted** heroes where an item is shown large;
generated paintings for the blessing cards and the service vignettes. Spec and deviations:
[`docs/specs/items-art.md`](../../../specs/items-art.md).

Captures: phone 844×390 (`mobilePreview`, DPR 2) and desktop 1280×800, before (`before/`)
and after (`after/`). All art in the captures is the shipping build's; nothing is composited.

## What ships

| Asset | Count | Form | Size |
|---|---|---|---|
| Pixel icons (items, scrolls, stones, blessings, upgrades, fallbacks) | 302 | 3 palette atlases, 16/32/48 px | 14 + 33 + 57 KB; 0.30 / 1.19 / 2.67 MB decoded, each loaded only when shown |
| Painted heroes (weapons, supplies, accessories, forge items) | 139 | 96 px palette PNGs | 560 KB total, 1–4 KB each, one decoded at a time |
| Blessing card paintings | 23 | 192×256 palette PNGs | 5–16 KB each |
| Service vignettes | 6 | 640×360 palette PNGs | 23–45 KB each, one decoded at a time |
| Legacy `icon_*` textures loaded at boot | −37 | deleted | −277 KB download, −0.58 MB decoded, −37 textures |

![Every icon, socketed, at 32 px](catalog-icons-32.webp)

![Every painted hero on its plate, 96 px](catalog-heroes-96.webp)

![Blessing cards and service vignettes, treated](moments-cards-vignettes.webp)

## Surfaces

| Surface | Before | After |
|---|---|---|
| Battle rewards (phone) | ![](before/rewards-mixed-844x390.webp) | ![](after/rewards-mixed-844x390.webp) |
| Battle rewards (desktop) | ![](before/rewards-mixed-1280x800.webp) | ![](after/rewards-mixed-1280x800.webp) |
| Blessing select (phone) | ![](before/blessing-hand-844x390.webp) | ![](after/blessing-hand-844x390.webp) |
| Blessing select (desktop) | ![](before/blessing-hand-1280x800.webp) | ![](after/blessing-hand-1280x800.webp) |
| Shop (phone) | ![](before/shop-buy-844x390.webp) | ![](after/shop-buy-844x390.webp) |
| Shop (desktop) | ![](before/shop-buy-1280x800.webp) | ![](after/shop-buy-1280x800.webp) |
| Forge tab | ![](before/shop-forge-844x390.webp) | ![](after/shop-forge-1280x800.webp) |
| Church | ![](before/church-844x390.webp) | ![](after/church-844x390.webp) |
| Colosseum | ![](before/arena-844x390.webp) | ![](after/arena-1280x800.webp) |
| Army upgrades | ![](before/upgrades-844x390.webp) | ![](after/upgrades-844x390.webp) |
| Roster equipment | ![](before/roster-equipment-844x390.webp) | ![](after/roster-equipment-844x390.webp) |
| Convoy | ![](before/convoy-844x390.webp) | ![](after/convoy-844x390.webp) |

More: the whetstone's weapon step ([phone](after/rewards-step-844x390.webp)), blessing
select on the short screens ([667×375](after/blessing-hand-667x375.webp),
[640×480](after/blessing-hand-640x480.webp)), caravan ([phone](after/caravan-844x390.webp), [desktop](after/caravan-1280x800.webp)),
ruins ([phone](after/ruins-844x390.webp)), the Skills tab
([phone](after/upgrades-skills-844x390.webp), [desktop](after/upgrades-skills-1280x800.webp)),
the purchase moment ([phone](after/upgrade-bought-844x390.webp),
[desktop](after/upgrade-bought-1280x800.webp)), and the short phones
([shop 667×375](after/shop-buy-667x375.webp), [640×480](after/shop-buy-640x480.webp)).

## Motion

- **Forge sparks:** 12 ember motes rise over the forge (band on desktop, pane on phones).
- **Candle flicker:** warm glows breathe over the church and the ruins; torches at the gate.
- **Upgrade bought:** TIER *n* stamps in (420 ms), the socket flares, the new gem ignites.
- **Reward reveal:** Hollow Sun backs turn in order (180 ms each, 90 ms stagger), the
  rarest flashes ember; a tap skips (and selects the card it lands on). Once per battle —
  a resume shows the spoils face up. Frames at 0 / 240 / 520 ms and settled:

  ![Reward reveal, phone](reward-reveal-strip-844x390.webp)

All of it is CSS on DOM that stops when its menu closes; under **Reduce motion** (the game
setting or the OS preference) the still painting and the end state show instead.

## Memory probe

`node tools/art/icons/memoryProbe.mjs` (dev build, phone 844×390 @3 and desktop 1280×800),
against `origin/main` 1e6c366 (before) and this branch (after): Phaser textures (each
decoded image counted once — traced sprites share pages) and the item art actually
displayed on each screen, decoded once.

| Screen | Phaser textures before → after (phone / desktop) | Item art on screen after |
|---|---|---|
| Node map | 560 → 523 textures; 32.90 → 32.32 MB / 51.48 → 50.90 MB | none (no atlas is fetched) |
| Shop | same | 32 px atlas 1.19 MB + one vignette 0.88 MB + one hero 0.04 MB = 2.10 MB |
| Church | same | one vignette 0.88 MB |
| Army upgrades | same | 32 px atlas 1.19 MB (the 64 px detail icon is the 32 px cell at 2x) |
| Battle rewards | 577 → 540; 34.61 → 34.03 MB / 52.25 → 51.68 MB | phone: 32 px atlas 1.19 MB; desktop: five heroes 0.18 MB |
| Blessing select | 560 → 523; 32.90 → 32.32 MB / 51.48 → 50.90 MB | three card paintings 0.56 MB |

The 37 legacy `icon_*` textures (0.58 MB decoded, 277 KB download) are gone from boot.
The 48 px atlas (2.67 MB decoded) loads only where a 48 px icon shows (a reward draft of
four or fewer cards on a phone, hero fallbacks for scrolls).

## Reproduce

```
node tools/art/icons/build.mjs                 # atlases + manifest (deterministic; --check)
node tools/art/icons/preview.mjs --groups Tome # design review sheet (16/32/48, nearest x3)
node tools/art/icons/hero/generate.mjs         # raw heroes (Pro -> Flash on quota), References/
node tools/art/icons/hero/treat.mjs            # candidates + contact sheets at display size
node tools/art/icons/hero/select.mjs           # curation decisions -> selections.json
node tools/art/icons/hero/treat.mjs --publish  # approved heroes -> assets/ui/items/hero
node tools/art/moments/generate.mjs            # raw cards + vignettes
node tools/art/moments/treat.mjs --sheet       # curated picks -> assets/ui/moments
node tools/art/icons/captureSurfaces.mjs --tag after   # screens via the study's dev drivers
node tools/art/icons/exportProduction.mjs      # -> this folder (WebP)
```

Dev pages: `/tools/art/icons/gallery.html` (every icon socketed; `?heroes=1`, `?only=`,
`?size=`).
