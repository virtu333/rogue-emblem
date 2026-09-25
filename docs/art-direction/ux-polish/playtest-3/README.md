# Playtest 3 polish — captures

Spec: [`docs/specs/playtest-polish.md`](../../../specs/playtest-polish.md). Captured by
`tests/e2e/playtest-polish.spec.js` (headless Chromium; palette-reduced to stay small).

| File | What it shows |
|---|---|
| `phone-choose-tile-844.png` | 844×390: select Edric → move → Back. The rail reads "Choose a tile · Edric"; Cancel shares End turn's row; Inspect / Roster / Rewind stay. |
| `desktop-attack-preview-1280.png` | 1280×800: Edric selected, pointer on a Fighter two tiles away. The path dot previews the attack tile; the footer guide reads "Blue tile: move · enemy in reach: attack · unit: actions" beside [X] Cancel. |
| `desktop-attack-forecast-1280.png` | The click: Edric walked to the closest attack tile and the forecast opened (target-first flow). |
| `reward-bundle-1280.png` | Reward cards: "Vulnerary ×3 · 3 uses each" beside a single "Vulnerary · 3 uses". |
| `route-rail-1280.png`, `route-rail-1676.png` | Route map side pane (cropped): 230 px at 1280 wide, 300 px at 1676 wide, body text one step larger. 640×480 and phones are unchanged (184/204 px). |
| `triangle-note-dpr1-crisp.png`, `triangle-note-dpr2-crisp.png` | Iron Sword vs Iron Axe forecast note at 1676×858, DPR 1 and 2, on this branch (crisp canvas text): "Triangle advantage · +1 damage · +10 Hit". |
| `triangle-note-dpr2-nearest-emulated.png` | The same text object re-sampled with NEAREST (the pre-crisp filter): strokes drop ("Trianglc", "·" → "-", "Hi!"). The sign bug the playtest saw was this texel loss, not the copy. |
