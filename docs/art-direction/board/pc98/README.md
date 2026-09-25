# PC-98 portrait pass — prototype (proposal, not integrated)

> Captures in this folder are a curated subset; see [CAPTURES.md](../../CAPTURES.md) for the full sets.

A code "filter pass" over high-resolution portrait references, proposed as the house style
for dialogue busts and ceremony cut-ins (board Decision 7):

- downscale the reference (rebuilt portraits are 1254px) to the target bust size;
- k-means palette of ~15 colours, snapped to 12-bit (PC-98's 4 bits per channel);
- ordered (Bayer 4×4) dithering between the two nearest palette colours, only when they are
  close, so gradients become checker dithers without cross-hue speckle;
- ink line art from strong luminance edges plus the silhouette outline;
- a two-tone faction backdrop dithered with the figure.

`rebuilt_before_after.png`: the rebuilt set (top as shipped, bottom through the pass).
`legacy_before_after.png`: legacy 128px portraits; the pass unifies rendering but not design —
outliers need new references to trace.

Run: `python3 pc98_prototype.py public/assets/portraits/rebuilt lord_edric lord_sera`
(needs Pillow, numpy, scipy). A production version would live in `tools/art/` (Node + sharp)
and bake into the portrait pipeline.
