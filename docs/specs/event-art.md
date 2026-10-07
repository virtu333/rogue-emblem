# Art for the Events wave

Status: **planned** (owner, 2026-10-06: "plan on generating art at some point in this wave for
the event nodes, event pages, any new items and units and skills (eg necro) using our image
gen and trace over process").

The pipeline is the one already in the repo; nothing new is invented here:

- **Generation**: the shared image client under `tools/art/gen` (Gemini image models through
  the environment's proxy; Imagen via `tools/imagen-pipeline/` for batch prompts), house style
  from `docs/art-direction/ART_BIBLE.md` (Ink & Ember), palette remap with
  `tools/art/remapToUiPalette.mjs`.
- **Trace-over** for anything that appears on the battlefield: `tools/art/sprite-trace`
  (`gen-refs.mjs` for references and pose frames, then the trace and `npm run bake:sprites`;
  `docs/specs/traced-sprites.md`). Portraits follow the PC-98 set (`tools/art/pc98`,
  `Pc98PortraitManifest.json`).
- **Illustrations** ("moments", like the blessings' `momentArtManifest.json` entries) for full
  pages.
- **Icons** are drawn in code by the icon grammar (`tools/art/icons`), not generated.
- Budgets: `npm run check:sprites`, `tests/RebuiltArtBudget.test.js`, no image above display ×3,
  no raw/backup files under `assets/`; review contact sheets kept small in
  `docs/art-direction/<topic>/` (≤ ~1.5 MB each).

## What to make

| # | Asset | Where it shows | Process | When |
|---|---|---|---|---|
| 1 | **Event medal** (route map) + its eclipsed **Dark Omen** variant | `NodeArt` / `RouteGraph` `FRAMES`, the canvas fallback `node_event`, the weathered atlas | generate in the concept sheet's style, crop like `NODE_ART_RECTS`; replaces the "?" over the Ruins medal | now (Phase 1 PR follow-up) |
| 2 | **Event vignettes**: one illustration per event (10 now, 12 more with Phase 2), shown as the event page's header band; a dark variant for Dark Omens | `EventMenu` header (`eventView().eventId` → art key), with a plain band fallback | "moments" pipeline: prompt from the event's intro, house style, ≤ display ×2, lazy-loaded | done for the 10 and the twelve Phase 2D events (an event with no painting wears the plain band; `tests/EventArt.test.js` `PAINTING_PENDING` lists any that wait) |
| 3 | **Burden and contract glyphs** (Ill Omen, Debt, Hunted, Sworn Enemy, Wounded, Contract) | burden chips, outcome lines, pause list | icon grammar (code) | with Phase 2 |
| 4 | **Worn-weapon badge** polish | item icons | icon grammar (exists; review only) | now |
| 5 | **New scrolls** (Smite, Transfuse, later shortlist skills) | item icons | icon grammar (Smite/Transfuse exist) | as skills land |
| 6 | **Necromancer** and **Skeleton** (enemy-only classes) | battlefield map sprites (idle, windup, strike, dodge, death), PC-98 portraits, red palette | generated references → sprite-trace → bake; portraits through the PC-98 pass | Phase 3, before the classes ship |
| 7 | **Summoning / crumble fx** | battlefield | procedural fx (`src/art/combatFx`), no generation | Phase 3 |
| 8 | **Revival-stone pips** for multi-bar bosses | HP bars | code | Phase 3 |
| 9 | **Skill proc visuals** for new skills (Lifetaker, Blink Strike...) | proc banner (`ProcVisualTheme`) | code + existing banner art | Phase 3 |

## Rules

- Every generated asset is reviewed at display size on the dusk and night grades; outliers are
  regenerated, not shipped.
- Prompts and picks are recorded (the pipeline's `manifest.json` / `selections.json`), so an
  asset can be regenerated.
- Art never gates play: every slot has a fallback (the current "?" medal, a plain band), so a
  missing file is never a crash.
- Credits/licences: generated art needs none beyond the existing notes; no third-party art.
