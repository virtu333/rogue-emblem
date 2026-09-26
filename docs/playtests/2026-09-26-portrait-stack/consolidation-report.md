# Portrait stack: consolidation report (2026-09-26)

This report is for the agent consolidating the open PRs. It covers:
- the portrait-mode PRs and what each one does;
- the order to merge them;
- what the combined build was tested with;
- the fixes made today after the combined build and the playtest;
- what is still open.

Main at the time of writing: `33537d86` (#126 and #121 have landed).

## The PRs

| PR | Branch | Head | Base | What it does |
|---|---|---|---|---|
| #99 | `claude/friendly-mccarthy-1vscnn` | `87839a49` | main | Portrait battles (beta). The board is drawn a quarter turn (Grid presentation transform, `boardOrientation.js`). The rail sits under the board. Turning the phone re-opens the battle from its checkpoint at the next clean idle boundary. It is only available behind `?portrait=1`, and Settings shows the toggle only to someone already opted in. |
| #122 | `claude/portrait-shell` | `de18f550` | #99 | The shell. `installPortraitUi` sets `html.portrait-ui` only when all four conditions hold: opted in, a phone browser tab (not a landscape-locked shell), a coarse pointer, and an upright viewport. It also retires the rotate prompt in portrait mode, and adds the shared kit rules (`portraitMode.css`) and the plan doc. **Every other portrait layout keys off this class.** |
| #129 | `claude/portrait-battle-edges` | `bd919d03` | #122 | An upright battle stays upright through its rewards and "View map". History, timeline and rewind previews are drawn on the turned board. On the upright rail, End turn sits in the fixed dock. |
| #124 | `claude/portrait-loom` | `4035faf7` | main | The route map (Loom) runs bottom to top over a bottom sheet. |
| #125 | `claude/portrait-cards` | `6fd50ee2` | main | Card-choice screens become lists of full-width rows: difficulty, blessings, rewards, recruits, lord arrival and mercenaries. |
| #128 | `claude/portrait-lists` | `5792d638` | main | List and detail screens: Home base, the Compendium/Help, the roster sheet and the route-map header. |
| ~~#126~~ | — | merged | — | The DOM boot loader (upright and small phones). |
| #131 | `claude/portrait-preview` | (this branch) | main | **Preview only, do not merge.** Main plus every PR above, used for the Netlify deploy preview. |

## Merge order

1. **#99**, then retarget #122 to main.
2. **#122**, then retarget #129 to main. #129 has had no CI yet, because it has always been stacked, so let CI run on it once it is retargeted.
3. **#129**, **#124**, **#125** and **#128**, in any order.

Checks behind this order:
- Each branch merges cleanly with main `33537d86`, and the whole stack merges together without manual conflict resolution.
- #124, #125 and #128 do not depend on #122 to build, because their specs set the class themselves as well as opting in. Without #122, though, nothing sets `portrait-ui` on a real phone, so their layouts only appear once #122 lands.

Close #131 once everything has landed.

## Verification on the combined build (#131 = main `33537d86` + all of the above)

- `build`, `format:check`, `lint`, `check:ui-theme` and `check:e2e-lanes` all pass. `test:unit` passes: 458 files, 7,569 tests.
- Browser specs pass locally: 82 across portrait-battle, loom-portrait, portrait-cards, portrait-lists, loading-progress-contract, formation, reload-contracts and mobile-battle-hud. Other dock-related specs also pass (battle-contracts, battle-sidebar, escape-exits, mobile-shell-contracts, rewind-action-types, ui-completion and ux-rail-and-info, 35 tests), plus battlefield-lab and playtest-polish.
- Each changed spec also passes on its own branch, without the shell.
- Formation (#121, merged) with portrait battles, probed on the combined build:
  - A tap on the turned board places the unit on the tile under the finger.
  - Start is on screen at 390×844.
  - Turning the phone mid-Formation shows "The board turns back when your turn is ready". At turn 1 the battle re-opens sideways with the chosen placement unchanged.
  - This behaviour is not yet covered by a committed test; see Open items.

## Conflicts the combined build exposed, and the fixes (all pushed)

Before these fixes, 13 browser tests failed on the combined build even though every PR was green on its own.

| Symptom | Root cause | Fix | Where |
|---|---|---|---|
| Card screens not laid out as rows in portrait (8 tests) | The specs forced `portrait-ui` before the shell started. The shell's first sync removed the class, because the specs never opted in. | The specs opt in for real (`emblem_rogue_portrait_battles=on`) and still force the class for builds without the shell. | #125, #128 and #124 specs |
| Compendium tabs moved in landscape when the class was forced (2 tests) | The shell's kit rules had no orientation guard, while #128's own CSS and specs treat the class as inert on a landscape page. | The rules in `portraitMode.css` now sit inside `@media (orientation: portrait)`, as #128's rules already do. | #122 |
| The loom scrolled at 390×844 (1 test) | #128 lets the act title take its own header line, which costs about 21px. The 8-row act then no longer fits, and the spec assumed a fixed header height. | The spec now requires a fit at 430×932 and scrolling at 375×667. At 390×844 either is accepted, provided the scroll cues match what the loom is doing. | #124 spec |
| Mercenary board showed 2 cards instead of the pinned 3 (2 tests) | Other code calls `Math.random` every frame, so the seeded stream's position depended on how long boot took. The faster DOM boot loader (#126) moved it. | The spec restarts the seeded stream just before the roll. The expected boxes were re-derived on main's code and are unchanged. | #125 spec |

## Playtest findings (`docs/playtests/2026-09-26-portrait-stack/review.md` on `docs/playtest-round3-2026-09-26`)

- **P2, End turn clipped at 375×667: fixed in #129.**
  - On the upright rail, End turn joins the fixed dock beside a compact Danger in idle and unit-selected states, the same way Wait is pinned in a unit's menu.
  - Terrain details stay in place, as the playtest asked. The sideways (landscape) rail is unchanged.
  - Tests:
    - `MobileBattleRailPin.test.js` has four new unit tests.
    - The upright-rail browser test now reproduces the terrain condition at 375, 390 and 430 widths, and taps End turn → Keep playing.
    - The browser test fails at 375×667 when the fix is removed.
- **P3, stale teaching hint: not addressed.** This is not portrait-specific. The hint queue should drop a contextual hint once its unit or action state changes.
- **Polish, Compendium controls take about half the view at 375×667: not addressed.** This belongs to #128, for example a compact category selector.

## Main CI is red since the Formation merge (not caused by the portrait PRs)

Main's own CI run for `e92add8f` (#121 Formation) failed. [Run 36272800885](https://github.com/virtu333/rogue-emblem/actions/runs/36272800885):
- `e2e (contracts)`: four tests failed, all with 30s timeouts:
  - `battle-contracts.spec.js:91`, phone and desktop;
  - `battle-contracts.spec.js:215`;
  - `mobile-shell-contracts.spec.js:220`.
  
  `management-contracts.spec.js:184` was also flaky.
- `e2e (run-flow-1of3)`: `guidance-notes.spec.js:284` times out waiting for `PLAYER_IDLE`.

The same tests fail the same way on #125 and #128, whose latest pushes changed only their own spec files. I've commented on both PRs.

They can't be reproduced locally on main:
- the failing tests pass when run on their own;
- the whole `contracts` lane passes, 53/53 with 2 workers.

So the failures look CI-environment dependent: a slower runner, or `formation.spec.js` newly sharing the contracts lane. I couldn't re-run the jobs (403). Someone who can should re-run them once. If they fail again, check the uploaded failure screenshots and traces (artifacts `e2e-failures-contracts` and `e2e-failures-run-flow-1of3`) before merging anything else.

## Open items (not blocking the merge)

1. A committed browser test for Formation on an upright board, covering tile tap placement and a phone turn mid-Formation. It needs #121's `finishFormation` helper, so it belongs after #99 and #122 have taken main.
2. The release step, held until a phone test of the full stack:
   - unlock the orientation locks in `manifest.webmanifest` and iOS `Info.plist`, and remove `isLandscapeLockedShell`;
   - retire the "Use landscape" button;
   - update the tutorial's direction copy;
   - offer the setting to everyone.
3. The minor follow-ups each of #124, #125 and #128 lists as left open.
4. Not yet exercised in portrait:
   - Home Base after a finished run;
   - shops and churches;
   - promotion;
   - long inventories;
   - an actual rewind restore;
   - late-game maps;
   - a physical iPhone (Safari pointer detection, safe areas, OS rotation).
