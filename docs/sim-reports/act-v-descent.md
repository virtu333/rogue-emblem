# Act V, the Descent: sims and tuning

Report of `npm run sim:descent`, **re-run 2026-10-12 after #342 (elite captain levels)** on
`claude/descent-retune-warden`, based on `claude/release-candidate` at `f4cc3de6` (main plus the Act V
stack). Same protocol, cohorts, seeds and trial counts as the first run; every table below is the
re-run. The route ships dark: every number here comes from a copy of the data with `descent.json`
`enabled: true` made by the sim, never from the file.

**Provenance of the old numbers.** The first run (2026-10-11, PR #337, `claude/descent-tuning` on
`claude/descent-integration` at `20261ba3`) tuned the Rite, the Lieutenant route and the gate's stones
while every promoted elite captain spawned about 10 levels low. Its key numbers are kept in short
"Published" notes beside each table. Between the two bases more than #342 changed: Acts III and IV's
elite captains (#342, so the armies arrive weaker), the growth upgrades (#312: +3% a tier, so a Home Base
preset buys less), the agent's Entity geometry (#347) and the Entity's footprint and counter rules
(#349, #321). The differences below are this base against the published report, not #342 alone; the
Vigil's Warden is measured on its own in "The Warden".

## For the owner (summary)

- 830 runs played Acts I–IV once; Act V then ran twice from each entry state (old two-node act, Descent), same dice, compared run by run. Players buy part of Home Base: without it the scripted player reaches Act V with 2 units.
- **The armies arrive weaker and darker on this base.** Nightfall half meta: roster 4.8 (was 7.0), shadow 86 (was 74), and 46% of Act IV battles have a commander fall (was 29%). Black Sun: roster 4.3 (was 6.5). The strong models barely moved.
- **The Warden does not move the Vigil above First Light.** The same entry states with the Warden at his old level: Vigil clear Δ −2.4 (Nightfall), +1.1 (Black Sun), −1.5 (Dusk), every CI spanning 0. On First Light he costs the weak army 18 points of Vigil clears (CI −31..−5) and 6 points of Act V (CI −11..−1). He is at the elite rule the spec names him for; no Warden number changed.
- **One number changed: `rite.bands` Broken 0–5 / Spoken 6–9 / Answered 10+ (was 0–4 / 5–9 / 10+).** On this base the Nightfall half model reached the Entity Broken/Spoken/Answered 13/63/24% (published 28/53/19, spec: a third / a half); the Broken share fell outside the published interval. With the new edge: 22/53/24 (Broken CI 15–32). Moving the edges to Broken 0–6 / Spoken 7–10 would hit a third (33/51/16 offline) but make Broken the default for every other model (First Light strong 63%, Dusk 60%, Nightfall strong 78%), the problem #337's retune fixed. The +1 edge keeps the strong models where #337 left them (Nightfall strong 59%, published 58%).
- Nightfall/Black Sun, mid-strength army: the Descent costs 23 / 22 points of "no commander fall in Act V" (published 17 / 27). Wins are level (strict +1.7 / +4.0); legacy stalls become commander falls (+20 / +21). Strong Nightfall armies win 14 points more often (published 16).
- **First Light weak: the Descent is now 9 points harder than the old act** (11% against 20%, CI −15..−3; published −3, CI −11..+5). The Warden explains about 6 points of it. Lowering the Lieutenant route's filler half a level (`levelOffset` [1, 2]) was tried and not kept: +5 for this model, −4 for Dusk, both inside noise. Strong First Light (+2) and Dusk (−4.7, CI −10..+1) are unchanged within noise.
- The Landing stays (gate lost 14% with it, 17% without, act bosses 30%; Broken at the Entity 22% with it, 12% without).
- Needs your eye: (1) whether First Light's weak model should be at parity (the lever is the Warden's slot level, a design call, see "The Warden"); (2) the gate is still among the easiest fights (lost 14% Nightfall, 13% Black Sun, 1% strong); (3) Entity fights still stall at the cap: Nightfall 47% (legacy) and 56% (Descent), Black Sun 35% and 23% (the agent's limit, "Limits").

## What changed

| Number | Before | After | Why (numbers below) |
|---|---|---|---|
| `rite.bands` (this re-run) | Broken 0–4, Spoken 5–9, Answered 10+ | 0–5, 6–9, 10+ | after #342 Nightfall's Broken share at the Entity fell to 13% (published 28%); the smallest edge move back inside noise without Broken becoming the strong models' default |
| `routes.lieutenant.levelOffset` (this re-run) | [2, 2] | [2, 2] (tested [1, 2]) | the First Light weak gap: +5 for that model, −4 for Dusk, both inside noise; not kept |
| Warden of the Rite level (this re-run) | the elite rule (#342) | unchanged | paired: no effect above First Light; see "The Warden" |
| `descent.json` `rite.startByPhase` (#337) | Pale 0, Waning 1, Umbral 2, Totality 4, Hollow 6 | 3, 4, 5, 7, 9 | a lowering before the Vigil was lost to the floor (First Light always started at 0) |
| `rite.bands` (#337) | Broken 0–4, Spoken 5–11, Answered 12+ | 0–4, 5–9, 10+ | Broken was the default (52–93% of finales); the re-run moved it again (first row) |
| `rite.underPar.column` (#337) | −1 | −2 | makes the fork a Rite decision (the Column ≈ the Seers' finish, above the Lantern) |
| `routes.lieutenant.levelOffset` (#337) | [1, 1] | [2, 2] | the First Light / Dusk Descent was easier than the old act for weak and strong armies |
| `difficulty.json` `revivalStones.lieutenant` (#337) | Dusk 0, Nightfall 0, Black Sun 0 | Dusk 1, Nightfall 2, Black Sun 2 | the Dusk finale had no stone while the Dusk Emperor (1), one act earlier, has one; the gate was as weightless as an elite. The second gate stone is the owner's call: "The second gate stone" |
| `routes.entity.levelOffset` (#337) | [1, 1] | [1, 1] (tested [0, 0]) | one level changes Nightfall's cost by 2 points and Black Sun's by 4: the cost is the number of fights, not their levels |
| `rite.perWordLevel` / `levelCap` (Hollowed) | 4 / 4 | 4 / 4 | the Vigil's clear rate did not move when the +3 start added about one Hollowed level |
| Voice / Circle Adept levels | slot offset 0 | 0 | Voices are meant to be silenced fast; the Vigil is 87–99% for armies that arrive able |
| The Landing row | kept | kept | see "The Landing" |

The re-run changes no engine or sim code. Two unit tests that typed the band edges (`tests/Rite.test.js`,
`tests/DescentValidation.test.js`) now read them from `descent.json`, as `tests/RiteUi.test.js` does.

Engine and sim changes made by #337 (no game behaviour):
- **Sim map parity.** The full-run drivers let the harness generate each map from the sim's own
  `Math.random` and never passed `isBoss`, so a boss map got a non-boss par and Hunted rule. The
  claiming driver also ignored a set piece's deploy cap. Now `RunSimulationDriver.battleConfigForNode`
  makes the map with `BattleScene.beginBattle`'s calls (`applyGenerationFields`,
  `battleGenerationSeed`, `generateSeededBattle`) and locks it, and every driver hands that map to the
  harness (`GameDriver.init({ battleConfig })`). That covers the stock, claiming and strategy-protected
  drivers; there is no second generation path. `tests/sim/SimBattleMapParity.test.js`.
- **The claiming player** prefers a choice that is sure to lower the Rite (the stock policy's rule).
  It never takes a boss recruit at the gate (PostCombatController's rule). Its battle log records the
  Descent key, the Rite at entry and the Vigil's count.
- `sim/descent.js` (`npm run sim:descent`). `fullrun-runner` gains the `quarter` and `half` meta presets.
- **Pairing by trial (review fix).** Records carry `fork`, `agent` and `ruleset` beside `meta` and
  `stones`; arms pair by the whole identity (`sim/lib/DescentTrials.js`), every table is grouped by
  cell, a duplicate identity throws and an unpaired record is counted. `tests/sim/DescentTrials.test.js`.
- **A correction found while adding the second stone.** An Act V replay used the Revival Stones table
  its capture had saved at run start, not the checkout's data. The sim now reads the table from the
  data (`--stones` lays a count over it).

## Method

- **Capture (Acts I–IV).** `ClaimingRunDriver`, the blessings report's player: it claims loot, uses
  items, rests at churches, spends Vision rewinds, and plays with a casual commander. It plays up to the
  advance into `finalBoss` (`stopBeforeAct`). The run (`RunManager.toJSON`) and the battle stream's state
  are saved.
- **Act V, paired.** From each entry state, with the stream put back to the same point:
  - `legacy`: the route switched off on a copy of the data (the Ruins and the finale);
  - `descent`: the route switched on;
  - on Nightfall and Black Sun, also `nolanding` (the route minus the Landing row).

  Acts I–IV are identical across the arms (common random numbers). `--phase act5` replays Act V from
  saved entry states, so a retune never replays Acts I–IV. The replay plays the Revival Stones table of
  the checkout's data (`--stones lieutenant=1` lays a count over it).
- **Player models.** Without Home Base the scripted player arrives at Act V with a median roster of 2,
  which says nothing about the act. So each run buys a share of every Home Base upgrade's levels
  (`--meta quarter|half|endgame`). A player reaches the higher rungs only after buying some.

  | Model | Rung, Home Base | Seeds |
  |---|---|---|
  | First Light weak | First Light, quarter | 1–100 |
  | First Light strong | First Light, half | 1–100 |
  | Dusk | Dusk, half | 100001–100150 |
  | Nightfall | Nightfall, half | 200001–200150 and 205001–205080 |
  | Black Sun | Black Sun, endgame | 300001–300150 |
  | Nightfall strong | Nightfall, endgame | 200001–200100 |

- **Measures.** The casual commander lets every run reach its end. The report reads a run with
  permadeath:
  - **strict**: the act is cleared only if every Act V battle is won with no unrewound commander fall
    and no stall at the 30-turn cap;
  - **KO-free**: no commander fall anywhere in the act. A stall counts as the agent's limit, not a death:
    a player plays on. **KO-free is not a win rate**: a run that stalled at the cap counts as not lost;
  - **outcome**: each run at its first lost battle, as a win, a commander loss (a fall no Vision rewind
    took back) or a stall (the cap with no such fall). See "Win, commander loss, stall".

  Records pair by trial, not by seed (`sim/lib/DescentTrials.js`): rung, Home Base preset, fork, agent,
  the Revival Stones table, the ruleset (a hash of the game data the replay played) and the seed. Every
  table is per cell (all of those but the seed). A duplicate identity throws; a record with no partner
  arm is counted and left out. All 830 trials paired; no record failed.

  Per-node rates are among the runs that reached the node under permadeath. Intervals are 95%: Wilson
  for rates, normal for means and paired differences. The paired Δ is (Descent − legacy) per run, so the
  shared Acts I–IV cancel.
- **Reproduce.**

  ```
  npm run sim:descent -- --phase capture --difficulty hard --meta half --trials 150 --seed 1 --workers 2 --out nf.jsonl
  npm run sim:descent -- --phase act5 --difficulty hard --arms legacy,descent,nolanding --from nf.jsonl --out nf-a5.jsonl --workers 2
  npm run sim:descent -- --from nf.jsonl,nf-a5.jsonl --md tables.md
  npm run sim:descent -- --phase act5 --difficulty hard --arms legacy,descent --stones lieutenant=1 --from nf.jsonl --out nf-1stone.jsonl --workers 2
  ```
  `--stones` replays the Act V under a different stone count; without it the replay reads the data.

  The re-run's wall time on a 4-core machine shared with other sessions (load 4–10): the 830 captures
  took 45 minutes (two queues of two workers); each full set of Act V replays 25–40 minutes (four
  single-worker queues); the Warden check and the two candidate retunes another 50 minutes. About two
  hours in all. Skipped: the one-stone gate replay of "The second gate stone" (its numbers are #337's).

## The runs at Act V entry

| player model | captured | roster | avg level | promoted | Vision | shadow | last act before V: battles with a commander fall |
|---|---|---|---|---|---|---|---|
| First Light, quarter meta | 100 | 6.1 | 12.2 | 2.4 | 1.11 | 39 | 37% [33, 40] (Act III) |
| First Light, half meta | 100 | 11.1 | 7.9 | 5.5 | 2.34 | 8 | 4% [3, 6] (Act III) |
| Dusk, half meta | 150 | 9.9 | 12.0 | 6.0 | 1.31 | 49 | 10% [8, 12] |
| Nightfall, half meta | 230 | 4.8 | 14.1 | 2.4 | 1.12 | 86 | 46% [44, 48] |
| Black Sun, endgame meta | 150 | 4.3 | 13.0 | 2.6 | 1.07 | 90 | 56% [53, 59] |
| Nightfall, endgame meta | 100 | 12.7 | 10.9 | 7.9 | 1.88 | 42 | 2% [1, 3] |

Every capture reached Act V. Published (pre-#342), roster / shadow: First Light quarter 7.4 / 33, half
11.3 / 7, Dusk 12.1 / 36, Nightfall half 7.0 / 74 (Act IV commander-fall battles 29%), Black Sun 6.5 / 81,
Nightfall endgame 13.4 / 32. The mid-strength models lost two units and gained about a tenth of the
Eclipse; the strong models are where they were.

## Clear rates: the old act against the Descent, before and after the retune

"Before" is the Descent with #337's numbers on this base; "after" is the Descent with this branch's
bands. The legacy column is the old act, which the bands never touch. The bands only change the gate's
and the finale's mods, so before and after differ only in the runs that reach a boss on a moved edge.

| player model | n | legacy | Descent before | Δ before (pts) | Descent after | Δ after (pts) |
|---|---|---|---|---|---|---|
| **strict** | | | | | | |
| First Light, quarter meta | 100 | 20% [13, 29] | 10% [6, 17] | -10.0 [-16.5, -3.5] | 11% [6, 19] | -9.0 [-15.3, -2.7] |
| First Light, half meta | 100 | 93% [86, 97] | 94% [88, 97] | +1.0 [-6.1, +8.1] | 95% [89, 98] | +2.0 [-4.8, +8.8] |
| Dusk, half meta | 150 | 84% [77, 89] | 79% [72, 85] | -4.7 [-10.3, +1.0] | 79% [72, 85] | -4.7 [-10.3, +1.0] |
| Nightfall, half meta | 230 | 11% [7, 16] | 14% [10, 19] | +3.0 [-0.9, +6.9] | 13% [9, 18] | +1.7 [-2.1, +5.6] |
| Black Sun, endgame meta | 150 | 19% [13, 26] | 22% [16, 29] | +3.3 [-3.5, +10.1] | 23% [17, 30] | +4.0 [-2.7, +10.7] |
| Nightfall, endgame meta | 100 | 58% [48, 67] | 72% [63, 80] | +14.0 [+4.8, +23.2] | 72% [63, 80] | +14.0 [+4.8, +23.2] |
| **KO-free** | | | | | | |
| First Light, quarter meta | 100 | 20% [13, 29] | 10% [6, 17] | -10.0 [-16.5, -3.5] | 11% [6, 19] | -9.0 [-15.3, -2.7] |
| First Light, half meta | 100 | 93% [86, 97] | 94% [88, 97] | +1.0 [-6.1, +8.1] | 95% [89, 98] | +2.0 [-4.8, +8.8] |
| Dusk, half meta | 150 | 84% [77, 89] | 79% [72, 85] | -4.7 [-10.3, +1.0] | 79% [72, 85] | -4.7 [-10.3, +1.0] |
| Nightfall, half meta | 230 | 58% [52, 64] | 36% [30, 42] | -22.6 [-29.6, -15.7] | 36% [30, 42] | -22.6 [-29.6, -15.7] |
| Black Sun, endgame meta | 150 | 54% [46, 62] | 31% [24, 39] | -22.7 [-31.4, -13.9] | 32% [25, 40] | -22.0 [-30.7, -13.3] |
| Nightfall, endgame meta | 100 | 90% [83, 94] | 91% [84, 95] | +1.0 [-6.1, +8.1] | 91% [84, 95] | +1.0 [-6.1, +8.1] |

Published (pre-#342, after #337's retune), legacy / Descent / Δ strict: First Light quarter 25 / 22 / −3.0,
half 94 / 98 / +4.0, Dusk 97 / 97 / +0.7, Nightfall half 16 / 19 / +3.0, Black Sun 31 / 31 / 0.0,
Nightfall endgame 68 / 84 / +16.0; KO-free Δ Nightfall half −17.0, Black Sun −26.7, Nightfall endgame +7.0.

Reading it:
- **First Light weak.** Both arms are harder (legacy 20%, was 25%), the Descent more so: −9 points, the
  interval clear of 0. The Vigil costs most (41% cleared, was 61%), and the Warden is most of that
  ("The Warden"). The Lieutenant route at `levelOffset` [1, 2] gave +5 here and −4 on Dusk (paired against
  this branch, both CIs spanning 0), so no level was moved.
- **First Light strong and Dusk.** Inside noise of parity. Dusk no longer saturates (legacy 84%, was 97%).
- **Nightfall and Black Sun (mid-strength).** Wins are level; the KO-free cost is −23 and −22 points (the
  published −17 and −27 lie inside these intervals). There are 4.5 more battles, each with
  an 11–42% chance of a lost battle (per node table); the same models' Act IV battles have a commander fall
  46% and 56% of the time, so no single Descent fight is out of line.
- **Nightfall strong.** +14 strict, +1 KO-free: the Entity is easier after the Descent (75% against 58%),
  the army having three more fights' XP and loot and the gate's +1 Vision.

## Win, commander loss, stall

Each run read at its first lost battle (the strict reading split three ways). Same runs as "after"
above; paired Δ is Descent − legacy in points.

| player model | arm | n | win | commander loss | stall | Δ win | Δ commander loss | Δ stall |
|---|---|---|---|---|---|---|---|---|
| Nightfall, half meta | legacy | 230 | 11% [7, 16] | 42% [36, 48] | 47% [41, 54] | | | |
| Nightfall, half meta | Descent | 230 | 13% [9, 18] | 62% [55, 68] | 26% [20, 32] | +1.7 [-2.1, +5.6] | +20.0 [+12.9, +27.1] | -21.7 [-29.1, -14.3] |
| Black Sun, endgame meta | legacy | 150 | 19% [13, 26] | 46% [38, 54] | 35% [28, 43] | | | |
| Black Sun, endgame meta | Descent | 150 | 23% [17, 30] | 67% [59, 74] | 11% [7, 17] | +4.0 [-2.7, +10.7] | +20.7 [+11.9, +29.4] | -24.7 [-32.9, -16.4] |
| Nightfall, endgame meta | legacy | 100 | 58% [48, 67] | 10% [6, 17] | 32% [24, 42] | | | |
| Nightfall, endgame meta | Descent | 100 | 72% [63, 80] | 9% [5, 16] | 19% [13, 28] | +14.0 [+4.8, +23.2] | -1.0 [-8.1, +6.1] | -13.0 [-20.7, -5.3] |

First Light and Dusk almost never stall in Act V (0–2%): their strict rate is their win rate (table above).
Published Δ commander loss: Nightfall half +15.2, Black Sun +25.3, Nightfall endgame −7.0.

The two boss fights, among the runs that reached them under permadeath:

| player model | fight | reached | win | commander loss | stall |
|---|---|---|---|---|---|
| Nightfall, half meta | Entity (legacy finale) | 230 | 11% [7, 16] | 42% [36, 48] | 47% [41, 54] |
| Nightfall, half meta | Lieutenant gate (Descent) | 109 | 86% [79, 91] | 14% [9, 21] | 0% [0, 3] |
| Nightfall, half meta | Entity (Descent) | 94 | 31% [22, 41] | 13% [7, 21] | 56% [46, 66] |
| Black Sun, endgame meta | Entity (legacy finale) | 150 | 19% [13, 26] | 46% [38, 54] | 35% [28, 43] |
| Black Sun, endgame meta | Lieutenant gate (Descent) | 69 | 87% [77, 93] | 13% [7, 23] | 0% [0, 5] |
| Black Sun, endgame meta | Entity (Descent) | 60 | 57% [44, 68] | 20% [12, 32] | 23% [14, 35] |
| Nightfall, endgame meta | Entity (legacy finale) | 100 | 58% [48, 67] | 10% [6, 17] | 32% [24, 42] |
| Nightfall, endgame meta | Lieutenant gate (Descent) | 97 | 99% [94, 100] | 1% [0, 6] | 0% [0, 4] |
| Nightfall, endgame meta | Entity (Descent) | 96 | 75% [65, 83] | 5% [2, 12] | 20% [13, 29] |

- **Mid-strength armies: the Descent trades stalls for commander losses, not wins for losses.** Wins
  are level (+1.7, +4.0). The legacy act's stalls at the Entity become commander falls on the way down:
  +20 points on Nightfall, +21 on Black Sun.
- **Strong army:** +14 wins, with fewer stalls.
- **The Entity, once reached, is no harder after the Descent.** The runs that reach it there are the
  ones that survived four fights, so these rows are not a paired comparison.
- A stalled Entity fight runs 20–23 turns past par: the cap, not a near miss. See "Limits" for why.
- Published: gate cleared 90% / 87% / 100%, Entity (Descent) 32% / 57% / 85%.

## The Rite

The words at the finale (Lieutenant or Entity) among the runs that reached it under permadeath, with each
version's own bands. "Before" is #337's bands (0–4 / 5–9 / 10+) on this base, "after" this branch's
(0–5 / 6–9 / 10+).

| player model | finale reached | published (pre-#342): Broken / Spoken / Answered | before | after |
|---|---|---|---|---|
| First Light, quarter meta | 14 | 4% / 71% / 25% (28 reached) | 7% / 57% / 36% | 14% / 50% / 36% |
| First Light, half meta | 95 | 35% / 64% / 1% | 29% / 67% / 3% | 49% / 47% / 3% |
| Dusk, half meta | 124 | 18% / 79% / 3% | 21% / 67% / 12% | 42% / 46% / 12% |
| Nightfall, half meta | 94 | 28% / 53% / 19% (136 reached) | 13% / 63% / 24% | 22% / 53% / 24% |
| Black Sun, endgame meta | 60 | 11% / 71% / 18% (82 reached) | 5% / 62% / 33% | 12% / 55% / 33% |
| Nightfall, endgame meta | 96 | 58% / 42% / 0% | 41% / 58% / 1% | 59% / 40% / 1% |

- **The target.** Spec §11: about a third of Nightfall runs reach the Entity on Broken, half on Spoken.
  #337 met it at 28 / 53 / 19. On this base, #337's bands gave 13% Broken (CI 7–21): outside the published
  interval (21–36) and far from a third. The +1 edge gives 22 / 53 / 24 (Broken CI 15–32).
- **Why the Broken share fell.** Not the Vigil: among the runs that reach it the Vigil is as quick as
  before (median 5 words, was 4) and the Warden moves nothing ("The Warden"). The runs start darker: at the
  Entity half the Nightfall runs entered Act V in Totality (start 7) and another third in Umbral (5); from 7,
  Broken needs a Vigil of about two words. Lowering Totality's start to 5 or 6 moves Broken by a point
  (offline), because the Broken runs are the Umbral starts.
- **Why not further.** Broken 0–6 / Spoken 7–10 hits the target (33 / 51 / 16, offline over the same runs)
  and sends 63% of First Light strong, 60% of Dusk and 78% of Nightfall strong finales in on Broken. The
  Column at −3 alone gives Nightfall 17% Broken; with the +1 edge 26%, but Nightfall strong 70% and Dusk
  53%: two numbers moved for four points.
- Broken still takes a quick Vigil plus a quieting choice: the Column at par (−2), the Seers' finish
  (−3, needs a staff) or the Lantern left burning (−1). On the side-stair branch the Landing's event is a
  second chance. With a start of at least 3, no lowering before the Vigil can reach the floor.
- Answered comes from a slow Vigil. It is common for the weak models (First Light quarter 36%, Black Sun
  33%), whose Vigils run long.

The Vigil (the strict-reached Vigils; the bands do not touch it, so before and after are the same):

| player model | Vigils fought (strict) | words, median (IQR) | Hollowed called, mean | cleared | stalled | Rite start, mean |
|---|---|---|---|---|---|---|
| First Light, quarter | 34 | 12 (6–25) | 7.0 | 41% [26, 58] | 6% [2, 19] | 3.94 |
| First Light, half | 99 | 4 (3–5) | 4.5 | 96% [90, 98] | 0% [0, 4] | 3.02 |
| Dusk, half | 132 | 4 (3–5) | 4.1 | 94% [88, 97] | 0% [0, 3] | 4.51 |
| Nightfall, half | 125 | 5 (4–6) | 5.0 | 87% [80, 92] | 4% [2, 9] | 6.19 |
| Black Sun, endgame | 89 | 5 (4–12) | 5.4 | 78% [68, 85] | 2% [1, 8] | 6.66 |
| Nightfall, endgame | 98 | 4 (3–4) | 3.6 | 99% [94, 100] | 0% [0, 4] | 4.28 |

Published cleared: 61% / 100% / 99% / 89% / 88% / 99% (words median 6 / 4 / 4 / 4 / 4 / 4).

### The Warden

The Warden of the Rite (Dark Knight, `guard`, the inner ring) is the only promoted captain in the
Descent's set pieces (the gate's Lieutenant is a seated boss at his route's level). #342 put him at the
elite rule, the battle's range top plus one, about ten levels above where he stood. To measure him alone,
every capture replayed the Descent with his slot at `level: -10` (his pre-#342 level) in a scratch copy of
the data, paired against this base (same entry states, same stream):

| player model | Vigil cleared, Warden now / old | Vigil cleared, paired Δ (pts) | Act V strict, paired Δ (pts) |
|---|---|---|---|
| First Light, quarter meta | 41% / 59% | -17.6 [-30.7, -4.6] (34) | -6.0 [-10.7, -1.3] |
| First Light, half meta | 96% / 100% | -4.0 [-7.9, -0.1] (99) | -4.0 [-8.8, +0.8] |
| Dusk, half meta | 94% / 95% | -1.5 [-5.2, +2.1] (132) | +0.7 [-4.1, +5.4] |
| Nightfall, half meta | 87% / 90% | -2.4 [-8.5, +3.7] (125) | +1.7 [-2.4, +5.9] |
| Black Sun, endgame meta | 78% / 76% | +1.1 [-6.9, +9.1] (89) | -2.0 [-6.7, +2.7] |

- He bites only on First Light, where a weak army meets him at the centre of the ring. From Dusk up the
  guards and the Voices decide the Vigil; Nightfall's Rite at the Entity is 12 / 66 / 22 with the old
  Warden against 13 / 63 / 24 now.
- The spec names him "the captain, guarding the inner ring": the elite rule is his intended level. A slot
  `level` below it would be a design choice for First Light, not a bug fix, so it is left to the owner.
- **Owner's call (after this report):** his slot carries `level: -2` on every rung, so he stands two
  levels under the elite rule, among his guards rather than above them (First Light: promoted level 5,
  was 7; the strongest guard is a level-6 Sniper). Not re-simmed: the rows above are the elite rule.

The finale by band (Nightfall, half meta). These rows are observational: a band is the result of a run's
earlier play, not a random draw, so Broken runs are not the same population as Answered ones.

| node | band | reached | cleared (strict) | no commander fall | deaths/battle |
|---|---|---|---|---|---|
| gate | Broken | 21 | 100% [85, 100] | 100% [85, 100] | 0.33 |
| gate | Spoken | 53 | 94% [85, 98] | 94% [85, 98] | 0.57 |
| gate | Answered | 35 | 66% [49, 79] | 66% [49, 79] | 0.60 |
| Entity | Broken | 21 | 19% [8, 40] | 81% [60, 92] | 0.95 |
| Entity | Spoken | 50 | 36% [24, 50] | 90% [79, 96] | 1.24 |
| Entity | Answered | 23 | 30% [16, 51] | 87% [68, 95] | 1.74 |

The Answered gate (+1 stone on top of the rung's two, so three, and a turn-4 wave of 2 Hollowed) is the
one band effect large enough to see (66% against 94–100%). The Entity's band rows are dominated by stalls.

## Per node (final numbers)

"Cleared" is among the runs that reached the node under permadeath. "No commander fall", "stall",
deaths and `turns − par` are over every battle fought there, including those fought by runs already lost
(the casual commander).

| player model | node | reached | cleared | no commander fall | stall | deaths/battle | turns − par |
|---|---|---|---|---|---|---|---|
| First Light, quarter meta (legacy) | old finale | 100 | 20% [13, 29] | 20% [13, 29] | 21% [14, 30] | 4.33 | +8.5 |
| First Light, quarter meta (descent) | stair | 100 | 45% [36, 55] | 45% [36, 55] | 22% [15, 31] | 2.75 | +5.2 |
| First Light, quarter meta (descent) | column | 21 | 48% [28, 68] | 24% [15, 38] | 29% [18, 42] | 1.16 | +7.5 |
| First Light, quarter meta (descent) | vigil | 34 | 41% [26, 58] | 21% [14, 30] | 13% [8, 21] | 0.58 | +2.1 |
| First Light, quarter meta (descent) | lieutenant | 14 | 79% [52, 92] | 22% [15, 31] | 8% [4, 15] | 2.73 | +8.7 |
| First Light, half meta (legacy) | old finale | 100 | 93% [86, 97] | 93% [86, 97] | 0% [0, 4] | 1.07 | -1.7 |
| First Light, half meta (descent) | stair | 100 | 99% [95, 100] | 99% [95, 100] | 0% [0, 4] | 0.30 | -3.6 |
| First Light, half meta (descent) | column | 48 | 100% [93, 100] | 100% [93, 100] | 0% [0, 7] | 0.37 | -3.9 |
| First Light, half meta (descent) | vigil | 99 | 96% [90, 98] | 96% [90, 98] | 0% [0, 4] | 0.24 | -7.9 |
| First Light, half meta (descent) | lieutenant | 95 | 100% [96, 100] | 100% [96, 100] | 0% [0, 4] | 0.26 | -2.5 |
| Dusk, half meta (legacy) | old finale | 150 | 84% [77, 89] | 84% [77, 89] | 1% [0, 5] | 0.91 | +0.9 |
| Dusk, half meta (descent) | stair | 150 | 91% [85, 94] | 91% [86, 95] | 1% [0, 4] | 0.35 | -2.7 |
| Dusk, half meta (descent) | column | 70 | 94% [86, 98] | 92% [84, 96] | 1% [0, 7] | 0.23 | -1.9 |
| Dusk, half meta (descent) | vigil | 132 | 94% [88, 97] | 84% [77, 89] | 2% [1, 6] | 0.26 | -6.8 |
| Dusk, half meta (descent) | lieutenant | 124 | 96% [91, 98] | 87% [81, 92] | 0% [0, 2] | 0.69 | +0.9 |
| Nightfall, half meta (legacy) | old finale | 230 | 11% [7, 16] | 58% [52, 64] | 87% [82, 90] | 1.30 | +17.8 |
| Nightfall, half meta (descent) | stair | 230 | 58% [52, 64] | 60% [54, 66] | 15% [11, 20] | 0.67 | +1.9 |
| Nightfall, half meta (descent) | column | 66 | 86% [76, 93] | 54% [45, 63] | 17% [12, 25] | 0.41 | +3.8 |
| Nightfall, half meta (descent) | vigil | 125 | 87% [80, 92] | 54% [48, 61] | 11% [8, 16] | 0.26 | -1.9 |
| Nightfall, half meta (descent) | gate | 109 | 86% [79, 91] | 43% [37, 50] | 3% [1, 6] | 0.27 | +1.5 |
| Nightfall, half meta (descent) | entity | 94 | 31% [22, 41] | 55% [49, 62] | 83% [78, 87] | 2.13 | +17.1 |
| Black Sun, endgame meta (legacy) | old finale | 150 | 19% [13, 26] | 54% [46, 62] | 77% [70, 83] | 1.25 | +19.2 |
| Black Sun, endgame meta (descent) | stair | 150 | 63% [55, 70] | 63% [55, 71] | 14% [9, 20] | 0.67 | +2.5 |
| Black Sun, endgame meta (descent) | column | 46 | 89% [77, 95] | 56% [45, 67] | 13% [7, 23] | 0.31 | +3.5 |
| Black Sun, endgame meta (descent) | vigil | 89 | 78% [68, 85] | 51% [43, 59] | 10% [6, 16] | 0.14 | -1.8 |
| Black Sun, endgame meta (descent) | gate | 69 | 87% [77, 93] | 45% [37, 53] | 1% [0, 5] | 0.25 | +2.1 |
| Black Sun, endgame meta (descent) | entity | 60 | 57% [44, 68] | 45% [38, 53] | 72% [64, 79] | 2.41 | +18.1 |
| Nightfall, endgame meta (legacy) | old finale | 100 | 58% [48, 67] | 90% [83, 94] | 34% [25, 44] | 0.76 | +7.8 |
| Nightfall, endgame meta (descent) | stair | 100 | 100% [96, 100] | 100% [96, 100] | 0% [0, 4] | 0.07 | -4.7 |
| Nightfall, endgame meta (descent) | column | 49 | 96% [86, 99] | 96% [86, 99] | 0% [0, 7] | 0.18 | -4.1 |
| Nightfall, endgame meta (descent) | vigil | 98 | 99% [94, 100] | 97% [92, 99] | 0% [0, 4] | 0.08 | -8.5 |
| Nightfall, endgame meta (descent) | gate | 97 | 99% [94, 100] | 97% [92, 99] | 0% [0, 4] | 0.12 | -6.0 |
| Nightfall, endgame meta (descent) | entity | 96 | 75% [65, 83] | 93% [86, 97] | 23% [16, 32] | 0.62 | +5.1 |

Published "cleared" (Stair / Vigil / gate or Lieutenant / Entity): First Light quarter 57 / 61 / 79,
half 99 / 100 / 99, Dusk 99 / 99 / 99, Nightfall half 79 / 89 / 90 / 32, Black Sun 77 / 88 / 87 / 57,
Nightfall endgame 100 / 99 / 100 / 85. The mid-strength models lose most at the Stair (the first fight,
21 and 14 points lower): the army that arrives is smaller.

## The Landing

Spec §11: keep it only if the gate's loss rate without it is above the act bosses'.

| player model | gate lost, with Landing | gate lost, without | Act V KO-free, with | without | paired Δ (pts) | Broken at finale, with / without | act bosses lost (Acts I–IV, same model) |
|---|---|---|---|---|---|---|---|
| Nightfall, half meta | 14% [9, 21] | 17% [11, 25] | 36% [30, 42] | 34% [28, 40] | +1.7 [-2.6, +6.1] | 22% / 12% | 30% [27, 33] |
| Black Sun, endgame meta | 13% [7, 23] | 19% [11, 30] | 32% [25, 40] | 34% [27, 42] | -2.0 [-7.7, +3.7] | 12% / 5% | 32% [29, 36] |
| Nightfall, endgame meta | 1% [0, 6] | 0% [0, 4] | 91% [84, 95] | 96% [90, 98] | -5.0 [-9.3, -0.7] | 59% / 38% | 3% [2, 5] |

- **By the literal test, the Landing is not needed for the gate.** Without it, the gate is lost 17%
  (Nightfall) and 19% (Black Sun), below the act bosses' 30–32%.
- **It stays.** It moves no mid-strength clear rate (paired Δ +2 and −2, both CIs spanning 0; the strong
  army's −5 is a draw at the Entity, fresh dice after the gate). On Nightfall and Black Sun it is the act's
  last Rite choice, made after the Vigil's words are known; without it Broken falls to 12% and 5%.
- Published: gate lost 10% / 13% / 0% with, 12% / 11% / 0% without; Broken with / without 28 / 5, 11 / 4,
  58 / 25.

## The gate and the Lieutenant's stones

- **Dusk (1).** The Dusk finale carries one stone, as the Dusk Emperor one act earlier. At half meta the
  Descent's Lieutenant is cleared 96% of the time by the runs that reach him (the legacy finale 84%).
- **The gate (2 on Nightfall and Black Sun).** Nightfall's Emperor carries 1 and Black Sun's 2, so the
  gate stands above Nightfall's Emperor and level with Black Sun's.
  - It stays among the Descent's easier battles: cleared 86% on Nightfall and 87% on Black Sun, against
    58–89% for the Stair, the Column and the Vigil and 30–32% for the act bosses.
  - The defeat objective lets an army go straight for him, so a stone costs little: see "The second
    gate stone" for what the second one cost.

## The second gate stone

Not re-run: these are #337's numbers (pre-#342 entry states). The comparison is the gate fight itself,
which #342 does not reach; the gate's loss rates on this base are in the tables above.

The owner approved a second Revival Stone for the Lieutenant at the gate (`revivalStones.lieutenant`
1 → 2 on Nightfall and Black Sun; Dusk stays 1, First Light 0). The kind reaches only him: the gate is
the one boss node that names the Lieutenant on those rungs (the legacy finale seats the Entity, whom the
stone table never touches), and the elite captain and Entity rows read their own entries.

The same entry states played Act V with the gate at one stone and at two (`--stones lieutenant=1`
against the data's 2), the Descent arm and the no-Landing arm. Everything before the gate plays
identically in both versions (same stream, same maps), so the gate fight itself is a clean paired
comparison; every battle after it gets fresh dice.

| player model | n | gate lost, 1 stone | gate lost, 2 stones | gate commander falls, paired Δ (pts) | gate turns, Δ | gate deaths/battle |
|---|---|---|---|---|---|---|
| Nightfall, half meta | 151 reached | 7% [4, 13] | 10% [6, 16] | +2.2 [+0.3, +4.1] | +0.8 | 0.36 → 0.44 |
| Black Sun, endgame meta | 94 reached | 13% [7, 21] | 13% [7, 21] | +0.7 [-0.6, +2.0] | +0.8 | 0.48 → 0.54 |
| Nightfall, endgame meta | 99 reached | 0% [0, 4] | 0% [0, 4] | 0.0 [0.0, 0.0] | +0.3 | 0.02 → 0.03 |

"Gate commander falls, paired" is over every run that fought the gate under both versions (230, 150 and
100), casual commander included. Act V as a whole, same runs, paired 2 stones minus 1 stone:

| player model | n | strict, 1 stone | strict, 2 stones | Δ (pts) | KO-free, 1 stone | KO-free, 2 stones | Δ (pts) |
|---|---|---|---|---|---|---|---|
| Nightfall, half meta | 230 | 18% [14, 24] | 19% [14, 24] | +0.4 [-3.7, +4.5] | 48% [41, 54] | 43% [36, 49] | -5.2 [-10.7, +0.3] |
| Black Sun, endgame meta | 150 | 31% [24, 38] | 31% [24, 39] | +0.7 [-5.6, +7.0] | 45% [38, 53] | 45% [37, 53] | -0.7 [-7.5, +6.1] |
| Nightfall, endgame meta | 100 | 77% [68, 84] | 84% [76, 90] | +7.0 [-1.5, +15.5] | 95% [89, 98] | 94% [88, 97] | -1.0 [-6.2, +4.2] |

- **The stone costs about one turn and 0–2 points of gate commander falls.** The cleanest reading is the
  gate fight itself: +2.2 points on Nightfall (CI +0.3..+4.1), +0.7 on Black Sun, none for the strong army.
- **Act V moves inside its noise.** Neither Act V difference is evidence for or against the stone.
- **An Answered Rite makes it three stones** (the rung's two and the Rite's one): on this base that gate
  is cleared 66% of the time on Nightfall (35 fights; 94–100% on the other bands).

## Harness and sim baselines

From #337 (its parity fix changed which maps the sims play, so two strict slices of
`npm run sim:fullrun:pr` moved past their bounds; no data change reached them):

| slice | metric | before (old driver) | after (#337) | threshold |
|---|---|---|---|---|
| `act1_pressure_normal` | `avg_units_lost` | 0.75 | 1.67 | 1.25 → 1.80 |
| `progression_invincible` | `avg_gold` | 12994 | 17627 | 17500 → 19500 |

Over 80 seeds the first metric is 1.02 (old driver) against 1.19: the 12-seed slice landed on a high draw,
not on a regime change. The re-run's bands change reaches no `sim:fullrun:pr` slice (the Descent ships
dark, and no slice turns it on).

## `sim/pacing.js`

It runs on #337's base: it played five Dusk seeds to the end before it was stopped. Draft PR #316
(claude/encounter-pacing) is reworking the pacing sims; nothing here touches them.

## Limits

- **The player is an agent.**
  - The scripted claiming player is far weaker than a person, which is why the models buy Home Base.
  - Its absolute rates are not a person's; the paired differences are the evidence.
  - Its Entity fights stall at the turn cap in a quarter to a half of mid-strength fights, in both arms.
    That is why the KO-free measure carries the Nightfall and Black Sun conclusions.
- **Why the Entity stalls** (#337's instrumented read, pre-#342 states): the agent refuses the trade. Its
  own forecast of the best Entity attack averaged 10 expected damage dealt against 22 taken from the
  counter, so the attack score is negative and the unit holds. It has no rule for wearing a boss down by
  rotating and healing, which a person would use.
- **The geometry fix is in this base.** #337 found that `TacticianAgent` measured range to the Entity's
  anchor tile, not its 3×3 body, and predicted that the fix would turn Entity commander falls into stalls.
  #347 made that fix; on this base the legacy Entity's commander-loss share is 42% / 46% (Nightfall half,
  Black Sun), and Descent-reached Entity fights 13% / 20%, with stalls 56% and 23%.
- **The event policy is rite-first.** Its Broken shares are an upper bound for players who take the
  heal or the Vision charge instead.
- **The model drifted under the targets.** The Nightfall half model's army is two units smaller than when
  the bands were first tuned (#342's Act III–IV captains, #312's cheaper, smaller growth upgrades). The
  bands were moved one word to hold the §11 target for this model; if the model is re-anchored (a larger
  Home Base share for Nightfall), the bands should be read again.
- **Elite captain levels** (#342, in this base): the Warden stands at the elite rule; see "The Warden".
