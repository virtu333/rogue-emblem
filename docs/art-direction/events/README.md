# Event art (route-map medal and event vignettes)

Plan: `docs/specs/event-art.md` items 1 and 2. House style: `docs/art-direction/ART_BIBLE.md`.
Everything was generated with the shared Gemini client (`tools/art/gen`, model
`gemini-3-pro-image` for every shipped picture), then treated into the game palette in code.
Raw generations live in `References/` (gitignored); only the treated, display-size files ship.

## What ships

| Asset | File | Size | Wired in |
| --- | --- | --- | --- |
| Event medal + Dark Omen (frames 9 and 10, 96 px) | `assets/sprites/nodes/event-nodes.png` | 192x96, 3.1 KB | `src/ui/NodeArt.js` (CSS sprite), `RouteGraph.js` `FRAMES.event`, `nodeFrame()` |
| Canvas-fallback medal `node_event` | `assets/sprites/nodes/node_event.png` | 48x48, 0.7 KB | `BootScene` node icons, `NodeMapScene` `node_${type}` |
| 22 event vignettes (ten Phase 1, twelve Phase 2D) | `assets/ui/moments/events/<eventId>.png` | 640x200, 12-27 KB each | `src/ui/eventBand.js` from `EventMenu.js`, lazy; manifest `src/ui/momentArtManifest.json` `events` |

Both asset trees (`assets/` and `public/assets/`) hold identical bytes. Nothing is loaded at boot
except the 48 px canvas fallback; the vignettes are fetched when the event page opens.

## How to regenerate

- Medal: `node tools/art/nodes/generateMedal.mjs` (concepts: signpost, cairn, lantern), then
  `--dark <picked raw>` for the Dark Omen; `node tools/art/nodes/bakeMedals.mjs` keys the white
  field out, fits both medals with one shared transform and writes the sheet and fallback.
  Prompts: `tools/art/nodes/prompts.mjs`; picks: `tools/art/nodes/selections.json`
  (`event` = `lantern-t1`, `dark` = `dark-t1`).
- Vignettes: `node tools/art/moments/generate.mjs --kind event [--only id,id] [--takes 4]
  [--from 5] [--no-fallback]`, then `node tools/art/moments/treat.mjs --only event [--ids id,id]`. Prompts:
  `EVENT` and `EVENTS` in `tools/art/moments/prompts.mjs` (one subject per event, composed from
  its intro; 21:9 raw, cropped to 3.2:1 by the pick's `crop`); picks and crops:
  `tools/art/moments/selections.json` `events` (an optional `focus` is the band's vertical focal
  point on a short, wide page).
- Review captures: `tools/art/nodes/captureEvents.mjs` (dev server on 3107; the Chromium path is
  an argument). The sheets here came from it.

## Picks and why

Prompt shape (vignettes): one house-style paragraph (`WORLD`) plus "ultra-wide cinematic header,
subject right of centre, left third quieter and darker, people small and anonymous, no writing at
all", then the event's subject. The page puts the title over the quiet left third.

| Event | Pick | Note |
| --- | --- | --- |
| old_swordmaster | t3 | Woman with a white braid splitting a log with a wooden practice sword; lit window. |
| abandoned_armory | t2 | Ajar door, boots, cold pot, racks, a barred inner door with violet light under it. |
| twin_altar | t3, crop, `focus 0%` | Two-faced stone, dawn on one side, eclipse and more candles on the other. The disc sits at the top edge, so the band keeps the top on a short page. |
| wounded_courier | t4 (this pass), crop 10% / 17% | See below. |
| deserters_fire | t2 | Six deserters around a small fire, armour dropped in the grass, nobody armed. |
| the_echo | t1 | Cairn with a helmet, pale-violet ghost soldier seen from behind. |
| toll_bridge | t1 | Rope bridge, toll hut, crossbowman reading a ledger. |
| moneylender | t1 | Gilded cart, guards, a thin man in fine gloves with a ledger. |
| drill_yard | t6 (this pass), crop 16% / 12.6% | See below. |
| quiet_road | t2 | Empty road, well, birds on the rim. |

Rejections, recorded for the two redone this pass (4 takes each, all `gemini-3-pro-image`):

- wounded_courier: t1 had no arrow at all; t2 put the arrow in a tree-trunk composition with a
  green fletching and a face hidden by the helmet; t3 was good but added an unrequested hooded
  smith with an anvil to the left, which reads as a second story; **t4 kept**: slumped against the
  milestone, arrow through the thigh, the dispatch in his hand, horse in silhouette, lantern at
  his side. The first crop cut his head against the band's top edge on a 640 px page, so the crop
  was moved down for headroom (the boots give way to the page's ink fade instead).
- drill_yard: the earlier pick had an orange glow ring round the sand pit that read as lava and
  figures in the foreground, wrong for an *abandoned* yard. Takes 1-4 with the old prompt put a
  man by a fire in three of four (t3 was the best of them), so the prompt now says "empty, nobody
  in it, no people at all" (takes 5-8): t5 a crowd of straw men drilling in ranks (too busy, no
  quiet left third), t7 big foreground dummies with a candle and a pit (fine, but busier and
  brighter than the other nine), t8 letterboxed with black bars and a red barn wall; **t6 kept**:
  empty yard, smoking fire pit, blank sign, blades, sand pit, shuttered barracks.
- Raw generations for the other eight vignettes and the medal were in the container that
  restarted; their picks above are the ones the previous pass made and reviewed (the shipped PNGs
  are the source of truth, and the manifest hash is checked by `tests/EventArt.test.js`). Their
  rejected takes were not recorded.

## Review at display size

Checked on the loom and the page at 640x480, 844x390 (landscape phone) and 390x844 (upright phone):

- `route-map.png`: live Events beside a fallen one. The lantern post reads at 29 px as an
  Event and not as the Ruins; the Dark Omen (violet flame, eclipse disc, ember cracks) reads at
  the same size and the ink rim is eased on it so the art shows. The Ruins medal's old "?" is
  gone; it remains only as the fallback when `event-nodes.png` is missing.
- `event-pages.png`: the head of three pages (rows: Drill Yard, Toll Bridge, Twin Altar; columns:
  640x480, 844x390, 390x844). Stacked over the title on a phone, laid behind the title with the
  ink dissolving on the left on a wide screen. Findings fixed in this pass: the Twin Altar's
  eclipse disc was cropped on a short band (a `focus` point now keeps the top), the courier's
  head touched the band's top edge (re-cropped), and the band had a raw `z-index` that the UI
  theme check refuses (the hero is now simply painted after the band).
- `vignettes.png`: all ten as shipped. `medal.png`: the Event medal and its Dark Omen at 3x
  beside the Church, Shop and Ruins medals, for the line weight and palette.

Not covered: the Echo's page (it needs a fallen ally to be picked, so the review route drew a
different event); its painting was reviewed on its own in the sheet.

## Phase 2D vignettes (the twelve added with the second wave)

Same pipeline and house prompt (`EVENT`), `gemini-3-pro-image` for every take (generated with
`--no-fallback`, so no Flash take can slip in), subjects composed from each event's intro in
`data/events.json`. Four takes each first; an event whose first four had a fixable problem got
four more with a re-prompt. Re-prompts live in `EVENT_RETAKES` (`prompts.mjs`; `eventSubject(id,
take)` picks the subject, so takes 1-4 keep the original wording and stay reproducible; a take
from `from` on uses the retake). Regenerate one take with e.g.
`node tools/art/moments/generate.mjs --kind event --only turncoat --from 8 --takes 8 --no-fallback`.

A raw is 21:9 (about 2.36:1); the band is 3.2:1, so a centred "cover" crop throws away 26% of the
height and had cut heads and eclipses off the tops of several picks. Each pick therefore carries an
explicit `crop` (`[0, top, 0, bottom]`, top + bottom = 0.263 for an exact 3.2:1 window with no
further crop) chosen on the raw with the window marked. On the page the band is shorter than the
file (150 px on a 640 px page, 100 px on a short phone), so the window's lower quarter is also
under the page's ink fade: nothing that carries the story sits there.

| Event | Pick (crop top / bottom) | Why, and what was rejected |
| --- | --- | --- |
| sunken_mine | t5 (15% / 11.3%) | Timber frame with torches, rope ladder dropping into black water, mist over it, quiet dark rock on the left. Rejected: t1 (green and white rock, off palette), t2 (good flooded pit but the frame touches the top edge and the water sits under the ink fade), t3 / t7 (moss green, no water), t4 / t8 (pale slabs), t6 (purple cast). |
| plague_village | t2 (4% / 22.3%) | Gate with a grey rag, shuttered street, one candle, mist, one hooded figure sitting by the wall (the cough). Rejected: t1 (a procession of hooded figures, a second story), t3 (house lit orange, too bright, nothing reads as dead), t4 (flat grey, no light). |
| merc_contract | t3 (4% / 22.3%) | Captain in side view leaning on the milestone, blank paper pinned to it, company at a small fire, ember road. Rejected: t1 (sits on a rock facing the viewer), t2 (bright red, blue sky), t4 (washed grey), retakes t5-t8 (headroom asked for; t5 plain, t6 banded purple stripes, t7 hooded so he stops reading as a captain, t8 a rainbow-banded sky). The raw t3 already had his head clear of the frame; the crop keeps it that way. |
| cartographer | t2 (3% / 23.3%) | Woman inking a map on the tailboard under a lantern, two pens, rolled maps, far lanterns on the road, left third dark. The map shows lines only, no writing. Rejected: t1 (hood hides her, too grey), t3 (too close and bright), t4 (cave-like frame on the left, busy). |
| chained_shelf | t4 (10% / 16.3%) | Open book on a short chain on the sill, violet fire lifting its pages, candles, shuttered door on the left. Rejected: t1 (red book, blue and red cast), t2 (two passers-by, saturated purple sky), t3 (four hooded figures in the road), retakes t5-t8 (book centred as asked, but cooler and flatter than the other pictures; t5 is the runner-up). |
| hollow_herald | t10 (3% / 23.3%) | Hooded man from behind, palms to a black eclipse with a gold corona, ember horizon behind ruins, left third empty and dark. Needed two rounds: t1-t4 and t5-t8 came out grey and hazy (t2 the best, with an unrequested pot on a fire; t3 had a campfire, lantern and shovel; t4 a modern road with a white centre line; t6 a lurid radial sun; t5/t7/t8 centred and bright). The second prompt (`from: 9`: very dark, no mist, no haze, no grey sky, left third empty) gave t9-t12; t10 is the darkest, t12 the runner-up (figure larger, rocks on the left); t11 was one transient upstream failure, regenerated. |
| wandering_smith | t1 (10% / 16.3%) | Smith in dark profile hammering a blade, handcart forge glowing, broken wall, winding road on the left. Rejected: t2 / t4 (extra hooded onlookers), t3 (ivy green and blue sky, brighter than the rest). |
| turncoat | t8 (8% / 18.3%) | Man in plain grey sitting calmly at dusk, looking away down a rutted road, boots and helmet beside him, nothing in his hands. Rejected: t1 / t3 (white painted road stripes, read as a modern highway), t2 (a campfire and a cloak; reads as a camp scene, the same beat as Deserters' Fire), t4 (red road, candle on a stone). Retakes (no markings, no fire): t5 (open hands, but a red-violet road that reads as blood), t6 / t7 (road too red, figure small). |
| old_faces | t4 (4% / 22.3%) | Small ragged figure running from the viewer with an arm raised, riders in crimson armour fanning out against an ember sky, a distant fire on the left. Rejected: t1 (lantern and a green hill, riders cut at the top), t2 (blue cast), t3 (riders tiny); retakes with the riders fully inside the frame (t5-t8) kept the idea but lost the glow and put the riders in the left half. |
| deserters_revenge | t2 (5% / 21.3%) | Sunken lane at dusk, rope strung across it and over a leaning tree, anonymous watchers on the bank tops, one gold lantern. Rejected: t1 (bright blue night), t3 (big crouching men, too much figure), t4 (too dark to read the ropes). |
| collectors | t3 (10% / 16.3%) | Four men in long dark coats seen from behind, gloved hands clasped, a cart standing in the ford, the clerk with an abacus at a folding table, a lantern on a pole. Rejected: t1 (three men facing the viewer, pale faces), t2 (three men, the clerk hunched out of the light), t4 (a covered wagon, men too dark). |
| bad_map | t2 (7% / 19.3%) | Crossroads with the signboard and its map (drawn lines and small crosses, no letters), a lantern, a cliff-edged road, a seated figure studying it. Rejected: t1 (a figure at a fire, map small), t3 (two figures, giant arrows), t4 (two figures and a campfire, busier). |

The Phase 1 notes about unrecorded raws do not apply to these: the raws for all twelve are in
`References/items-art/moments/event/` while the container lives (gitignored, so a restart loses
them); the shipped PNGs and the prompts above regenerate any of them. `vignettes-2d-takes.png`
keeps every take (treated, the pick outlined) as the permanent record of what was rejected.

Review at display size (640x480, 844x390 landscape phone, 390x844 upright phone, on the real
Event page through `captureEvents.mjs`): `event-pages-2d.png` shows the Cartographer, Mercenary
Contract, Wandering Smith and Plague Village pages. Stacked over the title on a phone, laid behind
it on a wide page, the subject right of centre and the title over the dark left third. Only those
four could be captured through the review route (an event the preset cannot make eligible, such
as the Sunken Mine, falls back to A Quiet Road there; the payoffs need a flag); the rest were checked
with the band simulation (the 640x200 file beside its 640x150 page band with the page's ink and the
358x112 phone band).

Sheets: `vignettes-all.png` is the family check (the ten Phase 1 pictures, then the twelve new,
labels in gold), `vignettes-2d-takes.png` every take, `event-pages-2d.png` the pages.
