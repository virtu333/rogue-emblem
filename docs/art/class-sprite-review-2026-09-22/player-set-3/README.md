# Player sprite set 3 — review candidates

Scope: two player appearances each for Cavalier, Pegasus Knight, Wyvern Rider and
Dancer; plus a near-white-bow revision of both set-2 Archers. Existing lord art is
held fixed. Sources and built-in image-generation prompts are archived together.

The new appearance briefs broaden East, Southeast, South and West Asian-inspired
features across several classes, keeping the same fantasy clothing language.
These are intended design directions, not reliable visual ancestry labels for
map-sized sprites. Review the range of faces/undertones and hair on the source
sheets; class silhouettes should carry recognition on the map.

Archer is an equipment-readability edit: retain existing faces, outfits and body
size while making the bow near-white with a more prominent curve. Its large body
relative to other infantry remains explicitly on the size-standardization backlog.

## Deferred size pass

Use body/head scale separately from total weapon or mount bounds. Review mounted
rider readability, wing width, lance overhang, Archer body height and Mage size.
Do not solve these by enlarging tiles. Current captures use existing placement
rules to expose disparities rather than hide them. Group spacing in this mounted
batch is intentionally wider; tightly packed formations still need testing.

## Review method

Isolated muted browser, actual game renderer/camera, staged art probes and existing
terrain. HUD counts still describe the original development fixture. Floor view
is a visual overlay. No gameplay changes, production asset replacement or save edits.
Grayscale and silhouette views are diagnostics, not a substitute for device testing.
Live acted states, fog, danger overlays, animation and dense formations remain pending.

Verification: ten extracted textures, no alpha-cut boundary warnings. The initial Dancer preview appeared hazy, but sampled surrounding pixels have alpha zero and the map render shows no background haze. Original Dancer sheet retained; a background-removal experiment was not selected.
