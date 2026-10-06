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
| Ten event vignettes | `assets/ui/moments/events/<eventId>.png` | 640x200, 13-27 KB each | `src/ui/eventBand.js` from `EventMenu.js`, lazy; manifest `src/ui/momentArtManifest.json` `events` |

Both asset trees (`assets/` and `public/assets/`) hold identical bytes. Nothing is loaded at boot
except the 48 px canvas fallback; the vignettes are fetched when the event page opens.

## How to regenerate

- Medal: `node tools/art/nodes/generateMedal.mjs` (concepts: signpost, cairn, lantern), then
  `--dark <picked raw>` for the Dark Omen; `node tools/art/nodes/bakeMedals.mjs` keys the white
  field out, fits both medals with one shared transform and writes the sheet and fallback.
  Prompts: `tools/art/nodes/prompts.mjs`; picks: `tools/art/nodes/selections.json`
  (`event` = `lantern-t1`, `dark` = `dark-t1`).
- Vignettes: `node tools/art/moments/generate.mjs --kind event [--only id,id] [--takes 4]
  [--from 5]`, then `node tools/art/moments/treat.mjs --only event [--ids id,id]`. Prompts:
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
