# Title (The Hollow Sun) and route map (the Loom): build captures

> Captures in this folder are a curated subset; see [CAPTURES.md](../../CAPTURES.md) for the full sets.

Screens captured from the running game after implementing the approved studies:

- Title key art: `docs/art-direction/board/keyart/` → `src/art/keyart/hollowSun.js`, mounted
  by `src/art/keyart/keyArtBackdrop.js`, presented by `src/ui/TitleScreen.js`.
- The Loom: `docs/art-direction/board/loom/` → `src/ui/loomModel.js` (pure model),
  `src/art/loom/loomThreads.js` (canvas), `src/ui/RouteGraph.js`, `src/ui/NodeMapMenu.js` and
  `src/ui/CampaignMapMenu.js`.

Re-shoot with a dev server running: `node docs/art-direction/build/title-loom/capture.mjs
http://127.0.0.1:<port> [chromium]` (`ONLY=<regex>` limits the set). Phones are captured at
2x device pixels, desktop at 1x.

## Title

| File                                                  | What                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `title_dusk_phone.png`                                | 844×390, fresh profile: dusk, Tutorial promoted with "Start here", How to Play marked new          |
| `title_rising_phone.png`                              | 844×390 after a Normal victory (`beatGame`): rising variant, returning-player menu         |
| `title_ashfall_phone.png`                             | 844×390 after a Hard victory (`beatHard`): ashfall variant                                        |
| `title_*_phone_small.png`                             | The same three at 667×375                                                                          |
| `title_*_desktop.png`                                 | The same three at 960×720 (4:3 stage over the letterboxed canvas, 320×240 crop at 3x)              |
| `title_resume_phone.png`, `title_resume_phone_small.png` | The longest menu: one suspended run (Resume · Act n leads), New Game, Save Slots, Tutorial (new) |
| `auth_phone.png`, `auth_phone_portrait.png`, `auth_desktop.png` | The cloud-build sign-in gate, same art through the same helper (stub client, no network) |

Notes:

- **Art fills the phone.** On touch devices the plate covers the whole viewport behind the
  letterboxed game canvas (844×390 shows the study's 422×195 crop at an exact 2x/6x device
  scale). The device-pixel scale snaps to an integer whenever that crops at most 30% more on
  phones (12% on desktop); 667×375 therefore keeps the same 2x plate as 844×390. Desktop uses
  the study's 4:3 crop inside the canvas rectangle.
- **Lockup** is DOM (crisp at any DPR): "ROGUE EMBLEM" in Cinzel 700, a gold hairline with a
  centre diamond, "The Hollow Sun" in Cinzel 500. The same markup/CSS is used by the auth
  screen.
- **Menu** moved to DOM reliquary plates (chamfered ink, gold thread on focus, ember fill for
  the recommended action) so targets are real 44px CSS pixels on phones (the Phaser menu was
  34px after letterboxing). Run actions stack under the lockup; guides and records sit in the
  lower-right cluster, clear of the figure, the threads and the sun. Focus order, the
  single-run Resume shortcut, "Tutorial / Start here", NEW badges, Settings, Log Out,
  tap-for-sound, version, alpha tag, local-save note and logout/cloud notices are unchanged
  in behaviour (`src/ui/titleMenuModel.js` is the tested model).
- **Variants** (`src/art/keyart/titleVariant.js`): dusk by default, rising once any slot
  records a Normal victory (`beatGame`), ashfall once it records a Hard victory
  (`beatHard`). Owner decision 2026-09-24.
- **Motion**: 30 fps, paused while the page is hidden or an opaque screen covers the title,
  one frozen frame under reduced motion (OS setting or the in-game Reduce Motion), all
  canvases released on scene shutdown.

## The Loom

| File                                  | What                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `loom_first_choice_phone.png`         | 844×390, first choice after the opening battle (board state `choice`)                        |
| `loom_mid_elite_phone.png`            | 844×390 mid-act: woven route, frayed branches, the elite selected (board state `mid`)        |
| `loom_vision_phone.png`               | 844×390, a future elite inspected: Sera's vision traces every route to it (state `future`)   |
| `loom_frayed_phone.png`               | 844×390, a frayed (out of reach) knot inspected (state `cut`)                                |
| `loom_first_choice_phone_small.png`   | 667×375: 184px pane, 36px medals, still a side column                                        |
| `loom_mid_elite_desktop.png`          | 960×720 desktop (44px medals on tall looms, one chip per row with class names)               |
| `loom_vision_desktop.png`             | 960×720, vision trace                                                                        |
| `loom_campaign_battle_phone.png`      | The read-only Campaign Map opened from the in-battle pause menu, 844×390                     |
| `loom_campaign_battle_desktop.png`    | The same at 960×720                                                                          |

The Loom captures load the board's act (the real generator with seed 6, exactly as
`board/loom/gen/generate-graph.mjs`) so each image can be compared with the approved PNG of the
same state. Differences from the study are intentional:

- Title reads `Act I · Border Marches` (owner-confirmed region name, `regions.json`); the
  subline carries the act name and row (`BORDER SKIRMISHES · ROW 2 OF 8`).
- Inspect tags say `Foes Lv 1–2` (including the difficulty level offset). Fog follows the
  first-battle rule, and a village that hides an ambush never shows battle details.
- Future and frayed medals sit at ≤68% / ≤60% opacity (the dither still dissolves them
  further), matching the existing "futures read as quiet" contract.
- Choice labels hide when lanes are too tight for them (short in-battle Campaign Map).
