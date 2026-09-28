# The Ford — batch 7 reference art

[Review gallery](index.html) · [Exact branch prompts](prompts-batch-7.md)

Six generated images for the Ford vertical slice, using every reference named in the prompts. The four pose sheets use green backgrounds normalized to exact `#00FF00`; the two close-ups keep their dark violet-grey fields. Each prompt was sent in full as written. For the pose sheets, a second generation with the same prompt was reviewed where framing or separation was weak; the selected versions are below.

| Image | Beat | Review |
|---|---|---|
| [f_warden_poses.png](f_warden_poses.png) | Guard, thrust, recover, decide | On-model helm, crimson tabard and cross clasps. **Needs manual pose separation:** the thrusting spear extends through the guard figure's space, so a simple vertical cut cannot isolate both poses. The guard and thrust silhouettes also touch near the feet. |
| [f_warden_cut.png](f_warden_cut.png) | Yield, wind-up, cut | All three actions read, but cloak and spear come close to adjacent poses. Check masks and boundaries before code splitting. |
| [f_edric_slide_burst.png](f_edric_slide_burst.png) | Slide, rise, cut | Selected repeat keeps the third sword and boot within frame. The slide's extended leg and cloak approach the middle pose; separate with a hand mask rather than a column cut. |
| [f_edric_slip_fall.png](f_edric_slip_fall.png) | Overbalance, struck, fall | Clear sequence and complete figure silhouettes. The dropped sword appears between poses as a separate element, so assign it to pose 2 when extracting. |
| [f_warden_helm.png](f_warden_helm.png) | The decision close-up | Eye slit, wet iron and crimson collar on dark wash. |
| [f_edric_struck.png](f_edric_struck.png) | Hit close-up | Right-facing Edric with dark chestnut hair, teal cloak and water suspended around his face. |

These are **reference paintings, not extracted animation layers**. The selected sheets preserve the pose concepts, but the generator did not maintain identical scale or a clean green column between every action. Hand-mask and align the figures before using them as start/end motion frames. The source cut-outs in `../cutouts/` remain the authority for character identity. The four sheets have not been installed as runtime `cutouts/` or added to `catalog.json`; those steps belong with the slicing and motion integration after mask review.

All six images are 1536×1024 PNGs. The first Warden sheet was one pixel narrow on generation and received a one-pixel green canvas pad; no figure pixels were scaled. Green normalization changes only the background. The exact supplied prompts are copied from the branch's `prompts-batch-7.md`.
