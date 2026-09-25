# Traced map sprites v3 — the battlefield default

Status: built (branch `claude/traced-sprites`, 2026-09-25). Records: `docs/art-direction/sprites-v3/`.

## Brief (as given)

Resume the stopped traced-sprites v3 work on the newest main and finish it.

1. **Port onto main.** Main squash-merged the art direction (#67) and Combat v2 (#69,
   procedural FX + `CombatChoreography` / strike poses that play traced `windup` / `strike`
   frames). Apply the earlier branch's own changes, integrate with the combat sprite-frame
   plumbing (the idle ticker must not overwrite a choreography pose), make sure binary
   assets transfer.
2. **Traced sprites are the battlefield default for every unit** — players, enemies, lords,
   bosses, recruits, promoted classes; `?spriteArt=rebuilt` (and `classic`) still select the
   previous art. Full coverage: no class or state falls back to a missing texture.
3. **Quality bar is high** ("modern pixel sprites, not toylike"). Use generated references
   and pose frames through the shared image client where they raise quality; review every
   class at display size on dusk / night grades and fix outliers. Deliver the contact
   sheets in `docs/art-direction/sprites-v3/` (≤ ~1.5 MB).
4. **Memory budget** (user-approved handoff): re-run `npm run bake:sprites` and
   `node tools/shrinkRebuiltPortraits.mjs`; keep `tests/RebuiltArtBudget.test.js`;
   `npm run check:sprites` and the character-art portrait assertion green; no image above
   display ×3; no raw / backup / unused files under `assets/`; report the texture-memory
   probe before/after vs main. Music streaming out of scope.
5. **Combat choreography** from #69 plays correctly with traced frames (windup, strike,
   hit-stop, dodge, death): `tests/e2e/combat-fx.spec.js` and the RNG-parity checks.
6. Portrait changes limited to what the memory budget requires (a parallel branch adds
   portrait variety and stays compatible with the portrait-cap tooling).

## What was built

- Port: `3c247e6..e9b94c4` applied on main (1346 paths incl. binaries, three text merges:
  `BattleScene`, `BootScene`, `vite.config.js`), then main `ef8027d` (#70) merged in.
- `startTracedIdle` skips a graphic while `CombatFxController` holds a pose on it
  (`_fxPose`) — the beat before the pose frame is painted included.
- **Map-size redraws** for the 19 lord / boss sprites that traced at scale 0.11–0.45
  (`tools/art/sprite-trace/gen-refs.mjs`; details and the before/after table in the
  sprites-v3 README). The atlas is re-baked: 335 sprites, 2 pages, 24.8 MB decoded.
- `paletteFor(..., { keep })`: a named boss keeps its own gold / plate through the
  empire's faction swap (Emperor, Knight Commander).
- Review tooling: `dev/takes-sheet.mjs`, `dev/takes-scales.mjs`, `capture-game.mjs --cast
  all --chunk --atmosphere`, and the `redraws` / three-way `lord_sources` sheets.

## Deviations and findings

- **Rewind mid-lunge (Combat v2 bug, surfaced by the traced default).** With traced
  sprites the striker holds a pose from the start of its lunge, so `combat-fx.spec.js`'s
  "cut short" probe now lands mid-lunge instead of after contact. That exposed that
  `CombatFxController.reset()` left the scene's lunge tween running, carrying the striker
  up to 10 px off its tile after a rewind. `reset()` now stops the in-flight scene tweens of
  the units it owns before settling them home (unit test in `CombatChoreography.test.js`).
  The spec's mid-strike check counts a held pose (the same signal its `striking()` wait
  already used), and it lets the self-destroying damage numbers of the strikes that this
  harness lets run on after the reset finish before counting leftovers.
- The spec's sprite matrix is now `traced (default)` / `rebuilt (?spriteArt=rebuilt)`; the
  old `default` / `?spriteArt=traced` pair tested the same art twice after the switch.
- Image quota: the pro image model's daily quota ran out mid-way; the last passes used the
  flash model. Rowan, Edric and Sera base, and the generic classes were not regenerated —
  they already trace at 0.55–0.9 from reviewed sheets / candidates.
- The Dark Rider redraw is not a scale gain (0.43 → 0.42); it was chosen because its
  legs, halberd and face read where the old trace was a dark mass.
