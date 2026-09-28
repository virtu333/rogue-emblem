# Cutscene style: The Unwritten Page

Owner-approved direction (2026-09-27), influenced by Shadows of Valentia's hand-drawn
art. It began with the anime opening "Again". The owner then extended it to **all
cutscenes** (boss approaches, endings, boss encounter cut-ins). Where
`docs/specs/cutscenes.md` → The vibe says otherwise (PC-98 plates, "never an anime
opening"), this file wins. It adds to `docs/art-direction/ART_BIBLE.md`; it does not
replace it.

**The idea:** the opening is a page in Sera's book of futures. Each shot is painted the
way she sees it. When she rewinds, the paint comes off the page.

## The look

| Element | Rule |
|---|---|
| Paper | Cool bone-grey vellum, smooth, with faint grain only. Not warm cream: the gold thread must stay the only warm light. |
| Our side | Fine sepia ink inside the figure, one thicker contour around the silhouette, pale transparent watercolour that stops short of the lines. Worn cloth and leather, no ornate armour. The thick contour is what keeps a figure readable at 480×270. |
| The Empire | Dense, flat iron-gall black and crimson lacquer, fully painted, no paper showing. Heavy and certain; we look like a sketch that isn't finished. |
| The gold thread | Gold leaf stitched through the paper. The only thing that shines. **Drawn in code**, not painted: at game size a painted thread becomes a dull 1 px line, and it has to stitch, fray and rush. |
| The Hollow Sun | Black disc, thin gold ring. **Drawn in code.** No visible ordinary sun in any plate. |
| The unlight | The page scraped back to bare paper, colour drained. We don't paint darkness. |
| Backgrounds | Large simple shapes, soft wash, no hatching. Always quieter than the figures. |
| The final frame | Edric at the fire looking into the camera is the **only** frame in full, opaque colour: this future is finally painted in for real. |

## How the story uses it

- **Rewind (bars 45–52):** each shot runs backward through the stages it was painted
  in: full wash, lines only, pencil, blank paper. Build every shot as three layers
  (wash, line, paper) so code can do this.
- **Edric's falls (bars 29–44):** each fall is painted over the last; earlier falls
  show through faintly, like a reused page.
- **Cast cards (bars 13–20):** each lord is painted alone on bare paper, then stacked.
  The full group doubles as the army at first light.

## Composition rules

- Our side faces and moves **right**; the Empire faces and moves **left**.
- Cut-outs: flat `#00FF00`, no ground shadow, the whole figure in frame with a margin.
- Mounted figures (Astrid, Rowan) scale about 1.45× against figures on foot.
- Landscape images come back 3:2 (1536×1024); the game crops to 16:9, so keep the
  subject in the middle 864 px band.
- Code draws the page edge. Crop any torn paper border off a generated image.
- Identity: the PC-98 portraits in `public/assets/portraits/pc98/192/` win. Edric's hair
  is dark chestnut, not red or auburn (it drifts; check every image).

## Faces

Owner review of batch 3: the young cast (Edric, Kira, Astrid, Rowan) share one face, so
they read apart only by hair and colour. Each character now has a fixed face
description that goes into every prompt that shows the face, and one mark that code adds.

| Character | Face (in every prompt) | Mark (added in code, once per rig head) |
|---|---|---|
| Edric | Square jaw, heavy straight brows, deep-set tired eyes, a nose broken once. | A small nick through one eyebrow. |
| Sera | Long oval face, heavy-lidded eyes, a long straight nose, faint shadows under the eyes (a seer who doesn't sleep). | none |
| Kira | Androgynous: long narrow face, straight level brows, narrow hooded eyes, a thin straight mouth, the chin as in the reference. Reads as neither clearly a young man nor a young woman. No gendered words in Kira's prompts. | none |
| Astrid | Heart-shaped face, large round eyes, a short upturned nose, a wide mouth. | A mole beside one eye. |
| Rowan | Broad round face, a wide nose, an easy grin (no tooth gap: owner, after a first output). | Freckles across the nose and cheeks. |
| Voss, Cael | Already distinct (age, beard, scar; helm, heavy brow). Keep as drawn. | none |

A code test on the batch-3 heads showed:

- **Marks work.** Freckles and a mole change a face at a glance.
- **Warps don't carry the change.** Moving the jaw or narrowing the eyes is too subtle to
  notice, and pushed further it looks deformed. Kira's sharper chin was rejected.
- **The structure has to come from generation.** That is why each face is in the prompt.

Code edits need face positions placed by hand, so they are made once per rig head, not
per shot. The rig puts these heads on every body, so fixing the heads fixes every
animated shot. Single-image closeups (eyes, final frame) keep the face they were painted
with.

## Converting to game pixels

`tools/cutscene/glass/pixel.py <name> --still <image> --preview 0 --colors 28`

| Layer | Settings | Why |
|---|---|---|
| Figures, closeups, keys | defaults | The ink pass keeps the line work. |
| Plates | `--no-ink --bilateral 6 --dither 0.3` | With the defaults, fine texture and hatching turn into black speckle. |

In large faces (for example `b21_sera_closeup`), watercolour mottling on the skin dithers
into speckle that reads as freckles. Convert big faces with `--dither 0.2`.

Soft plates behind crisp figures also give the shots depth. Where a plate shows a warm
sunset (bridge, fens), take the sun out and cool the grade before conversion.

## Prompting

Every prompt is sent complete, including the style text; the batch-1 shots that were
sent as a table row alone missed their key requirement. The current full prompts are
in the newest `prompts-batch-*.md` (batch 5: the villains), and verdicts on everything generated so far
are in [catalog.md](catalog.md).
