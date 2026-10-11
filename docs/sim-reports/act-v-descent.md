# Act V, the Descent: sims and tuning

Report of `npm run sim:descent` (2026-10-11) on `claude/descent-tuning`, based on
`claude/descent-integration` at `20261ba3`. The route ships dark: every number here comes from a copy
of the data with `descent.json` `enabled: true` made by the sim, never from the file.

## For the owner (summary)

- 830 runs played Acts I–IV once; Act V then ran twice from each entry state (old two-node act, Descent), same dice, compared run by run. Players buy part of Home Base: without it the scripted player reaches Act V with 2 units.
- Nightfall/Black Sun, mid-strength army: the Descent costs 17 / 27 points of "no commander fall in Act V" (with the gate's second stone). Four more fights at about Act IV's per-fight risk explain it. Counting stalls as losses, clear rate is unchanged (+3 / 0). Strong armies gain 7–16 points (XP, loot, the gate's Vision).
- First Light: the shipped Descent was easier than the old act (+13 for a weak army). The Lieutenant route is now one level up: −3 (CI −11..+5). Strong First Light and Dusk armies clear both versions 97–99% of the time.
- The Rite: shipped numbers sent 52–93% of finales in on Broken. First Light started at 0, so row-1 quieting (the Column at par, the side-stair events) was lost to the floor. Now: start +3 (Pale 3 … Hollow 9), bands 0–4 / 5–9 / 10+, Column at par −2. Nightfall reaches the Entity Broken/Spoken/Answered 28/53/19% (spec: a third/a half). Broken now needs a quick Vigil and a quieting choice.
- The Lieutenant: 1 Revival Stone on Dusk (the Dusk Emperor also has 1) and 2 at the gate on Nightfall and Black Sun (their Emperors have 1 and 2). See "The second gate stone".
- The Landing stays. §11's literal test says it is not needed: without it the gate is lost 12%, the act bosses 31%. But it makes Broken reachable on Nightfall (28% vs 5%) and moves no clear rate (paired −4 to +1, every CI spans 0).
- Needs your eye: (1) the gate is still among the Descent's easiest fights with two stones (10% lost on Nightfall, 13% on Black Sun, 0% for the strong army), and an Answered Rite adds a third stone there; (2) engine issue, not touched: every promoted elite captain spawns about 10 levels low (`captainLevelFor`); the Vigil's Warden is promoted level 1 among level 3–8 guards; (3) the agent stalls most Entity fights at the turn cap, in both arms.
- **A correction found while adding the second stone.** An Act V replay used the Revival Stones table its capture had saved at run start, not the checkout's data. So the earlier tuning replays of Nightfall (the first 150 runs), Black Sun and the Nightfall endgame model played the gate with 0 stones, not the 1 this report named; only the 80 later Nightfall captures carried 1. The sim now reads the table from the data (`--stones` lays a count over it), and every Nightfall and Black Sun table below is re-run with the gate's two stones. Dusk (its legacy and Descent finales are the Lieutenant, 1 stone in the data) re-ran to the same clear rates and Rite bands, with two node rows moving in the second digit. The shipped column and First Light never involved stones.

## What changed

| Number | Before | After | Why (numbers below) |
|---|---|---|---|
| `descent.json` `rite.startByPhase` | Pale 0, Waning 1, Umbral 2, Totality 4, Hollow 6 | 3, 4, 5, 7, 9 | a lowering before the Vigil was lost to the floor (First Light always started at 0) |
| `rite.bands` | Broken 0–4, Spoken 5–11, Answered 12+ | 0–4, 5–9, 10+ | Broken was the default (52–93% of finales); now Nightfall's split is the spec's |
| `rite.underPar.column` | −1 | −2 | makes the fork a Rite decision (the Column ≈ the Seers' finish, above the Lantern) |
| `routes.lieutenant.levelOffset` | [1, 1] | [2, 2] | the First Light / Dusk Descent was easier than the old act for weak and strong armies |
| `difficulty.json` `revivalStones.lieutenant` | Dusk 0, Nightfall 0, Black Sun 0 | Dusk 1, Nightfall 2, Black Sun 2 | the Dusk finale had no stone while the Dusk Emperor (1), one act earlier, has one; the gate was as weightless as an elite. The second gate stone is the owner's call: "The second gate stone" |
| `routes.entity.levelOffset` | [1, 1] | [1, 1] (tested [0, 0]) | one level changes Nightfall's cost by 2 points and Black Sun's by 4: the cost is the number of fights, not their levels |
| `rite.perWordLevel` / `levelCap` (Hollowed) | 4 / 4 | 4 / 4 | the Vigil's clear rate did not move when the +3 start added about one Hollowed level |
| Voice / Circle Adept levels | slot offset 0 | 0 | Voices are meant to be silenced fast; the Vigil is 88–100% for armies that arrive able |
| The Landing row | kept | kept | see "The Landing" |

Engine and sim changes (no game behaviour):
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

## Method

- **Capture (Acts I–IV).** `ClaimingRunDriver`, the blessings report's player: it claims loot, uses
  items, rests at churches, spends Vision rewinds, and plays with a casual commander. It plays up to the
  advance into `finalBoss` (`stopBeforeAct`). The run (`RunManager.toJSON`) and the battle stream's state
  are saved.
- **Act V, paired.** From each entry state, with the stream put back to the same point:
  - `legacy`: the data as shipped (the Ruins and the finale);
  - `descent`: the route switched on;
  - on Nightfall and Black Sun, also `nolanding` (the route minus the Landing row).

  Acts I–IV are identical across the arms (common random numbers). `--phase act5` replays Act V from
  saved entry states, so each retune cost about 20 minutes, not hours. The replay plays the Revival
  Stones table of the checkout's data (a run snapshots its table at its start; `--stones lieutenant=1`
  lays a count over it).
- **Player models.** Without Home Base the scripted player arrives at Act V with a median roster of 2
  (150 First Light runs: median roster 2, shadow 65), which says nothing about the act. So each run buys
  a share of every Home Base upgrade's levels (`--meta quarter|half|endgame`). A player reaches the
  higher rungs only after buying some.

  | Model | Rung, Home Base | Seeds |
  |---|---|---|
  | First Light weak | First Light, quarter | 1–100 |
  | First Light strong | First Light, half | 1–100 |
  | Dusk | Dusk, half | 100001–100150 |
  | Nightfall | Nightfall, half | 200001–200150 and 205001–205080 |
  | Black Sun | Black Sun, endgame | 300001–300150 |
  | Nightfall strong | Nightfall, endgame | 200001–200100 |

  At a quarter, Dusk and above collapse to 2 units as well. Black Sun at half collapses too (roster 3).
- **Measures.** The casual commander lets every run reach its end. The report reads a run with
  permadeath:
  - **strict**: the act is cleared only if every Act V battle is won with no unrewound commander fall
    and no stall at the 30-turn cap;
  - **KO-free**: no commander fall anywhere in the act. A stall counts as the agent's limit, not a death:
    a player plays on.

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

  A capture takes 2–6 s per run and each Act V arm about 1 s, on two workers.

## The runs at Act V entry

| player model | captured | roster | avg level | promoted | Vision | shadow | Act IV battles with a commander fall |
|---|---|---|---|---|---|---|---|
| First Light, quarter meta | 100 | 7.4 | 11.7 | 2.9 | 1.07 | 33 | 29% [25, 33] (Act III) |
| First Light, half meta | 100 | 11.3 | 7.9 | 5.5 | 2.74 | 7 | not recorded |
| Dusk, half meta | 150 | 12.1 | 10.9 | 7.5 | 1.53 | 36 | not recorded |
| Nightfall, half meta | 230 | 7.0 | 13.6 | 3.7 | 1.18 | 74 | 29% [25, 33] |
| Black Sun, endgame meta | 150 | 6.5 | 13.2 | 3.8 | 1.13 | 81 | not recorded |
| Nightfall, endgame meta | 100 | 13.4 | 10.1 | 8.4 | 2.82 | 32 | not recorded |

## Clear rates: the old act against the Descent, before and after the retune

"Before" is the Descent with the shipped numbers; "after" is the Descent with the numbers in this branch
(the gate's two stones on Nightfall and Black Sun, Dusk's one). The legacy column is the old act, which
none of the retune touches (the Dusk stone is in both arms).

| player model | n | legacy | Descent before | Δ before (pts) | Descent after | Δ after (pts) |
|---|---|---|---|---|---|---|
| **strict** | | | | | | |
| First Light, quarter meta | 100 | 25% [18, 34] | 38% [29, 48] | +13.0 [+3.5, +22.5] | 22% [15, 31] | -3.0 [-11.1, +5.1] |
| First Light, half meta | 100 | 94% [88, 97] | 98% [93, 99] | +4.0 [-1.5, +9.5] | 98% [93, 99] | +4.0 [-1.5, +9.5] |
| Dusk, half meta | 150 | 97% [92, 99] | 99% [95, 100] | +2.0 [-0.9, +4.9] | 97% [93, 99] | +0.7 [-2.3, +3.6] |
| Nightfall, half meta | 230 | 16% [12, 21] | 19% [14, 24] | +3.0 [-2.0, +8.1] | 19% [14, 24] | +3.0 [-1.8, +7.9] |
| Black Sun, endgame meta | 150 | 31% [24, 39] | 28% [21, 36] | -3.3 [-10.4, +3.7] | 31% [24, 39] | 0.0 [-7.2, +7.2] |
| Nightfall, endgame meta | 100 | 68% [58, 76] | 82% [73, 88] | +14.0 [+3.9, +24.1] | 84% [76, 90] | +16.0 [+6.9, +25.1] |
| **KO-free** | | | | | | |
| First Light, quarter meta | 100 | 25% [18, 34] | 38% [29, 48] | +13.0 [+3.5, +22.5] | 22% [15, 31] | -3.0 [-11.1, +5.1] |
| First Light, half meta | 100 | 94% [88, 97] | 98% [93, 99] | +4.0 [-1.5, +9.5] | 98% [93, 99] | +4.0 [-1.5, +9.5] |
| Dusk, half meta | 150 | 97% [92, 99] | 99% [95, 100] | +2.0 [-0.9, +4.9] | 97% [93, 99] | +0.7 [-2.3, +3.6] |
| Nightfall, half meta | 230 | 60% [53, 66] | 47% [41, 53] | -12.6 [-20.7, -4.5] | 43% [36, 49] | -17.0 [-24.4, -9.5] |
| Black Sun, endgame meta | 150 | 71% [64, 78] | 47% [40, 55] | -24.0 [-32.8, -15.2] | 45% [37, 53] | -26.7 [-36.1, -17.3] |
| Nightfall, endgame meta | 100 | 87% [79, 92] | 95% [89, 98] | +8.0 [+0.8, +15.2] | 94% [88, 97] | +7.0 [-0.5, +14.5] |

Reading it:
- **First Light.** The old finale (the Lieutenant on `eldritch_sanctum`: 12 foes at 13–18 plus 3 wave
  spawns) is harder than the shipped Glass (8 escorts at Act III's late range plus one). Weak armies
  cleared the shipped Descent 13 points *more* often than the old act. After the +1 level, they clear it
  3 points less often. Strong armies clear either version.
- **Dusk.** It saturates at this strength; the stone and the level leave it at the legacy rate (+0.7).
- **Nightfall and Black Sun (mid-strength).** Both arms stall at the Entity in 65–80% of fights
  (`turns − par` about +17), so the strict rate tells little. The KO-free rate is the cost: −17 and −27
  points with the gate's second stone (−13 and −23 with one; the difference is inside the intervals). There are 4.5 more battles, each with a 7–21% chance of a lost battle (next table). In the
  same models a plain Act IV battle has a commander fall 29% of the time, so no single Descent fight is
  out of line. The cost is the number of fights.
- **Nightfall strong.** +7 KO-free, +16 strict. The Entity is easier after the Descent (85% against 68%)
  even on the Spoken band (81%). The difference is the army: three more fights' XP and loot, and the
  gate's +1 Vision. The Entity rows are fresh dice after the gate, so they move by several points between
  stone counts that cannot change them (strict +9 at one stone, +16 at two).

## The Rite

The words at the finale (Lieutenant or Entity) among the runs that reached it under permadeath, with each
version's own bands:

| player model | finale reached | before: Broken / Spoken / Answered | after: Broken / Spoken / Answered |
|---|---|---|---|
| First Light, quarter meta | 28 | 14% / 70% / 16% | 4% / 71% / 25% |
| First Light, half meta | 99 | 75% / 24% / 1% | 35% / 64% / 1% |
| Dusk, half meta | 147 | 76% / 24% / 0% | 18% / 79% / 3% |
| Nightfall, half meta | 136 | 57% / 41% / 1% | 28% / 53% / 19% |
| Black Sun, endgame meta | 82 | 52% / 47% / 1% | 11% / 71% / 18% |
| Nightfall, endgame meta | 99 | 93% / 7% / 0% | 58% / 42% / 0% |

- The spec's §11 target for Nightfall, about a third Broken and half Spoken, is now met (28 / 53 / 19).
- Broken takes a quick Vigil (median 4 words, IQR 3–6) plus a quieting choice: the Column at par (−2),
  the Seers' finish (−3, needs a staff) or the Lantern left burning (−1). On the side-stair branch the
  Landing's event is a second chance.
- **The floor finding.** With Pale at 0, every row-1 lowering on First Light was logged as `requested`
  and lost: the Column and side-stair events gave 0 words in all 100 First Light runs. The +3 start keeps
  them; with a start of at least 3, no lowering before the Vigil can reach the floor.
- Answered comes from a slow Vigil. It is rare for strong armies and common for the weak First Light
  model (25%), whose Vigil runs a median 6 words, IQR 5–11.

The Vigil (final numbers; the strict-reached Vigils):

| player model | Vigils fought (strict) | words, median (IQR) | Hollowed called, mean | cleared | stalled | Rite start, mean |
|---|---|---|---|---|---|---|
| First Light, quarter | 46 | 6 (5–11) | 6.2 | 61% [46, 74] | 2% [0, 11] | 3.83 |
| First Light, half | 99 | 4 (3–4) | 3.9 | 100% [96, 100] | 0% [0, 4] | 3.00 |
| Dusk, half | 149 | 4 (3–4) | 3.8 | 99% [95, 100] | 0% [0, 3] | 4.03 |
| Nightfall, half | 170 | 4 (3–6) | 4.6 | 89% [83, 93] | 2% [1, 5] | 5.95 |
| Black Sun, endgame | 107 | 4 (3–5) | 4.4 | 88% [80, 93] | 0% [0, 3] | 6.25 |
| Nightfall, endgame | 100 | 4 (3–4) | 3.5 | 99% [95, 100] | 0% [0, 4] | 3.82 |

The finale by band (Nightfall, half meta). These rows are observational: a band is the result of a run's
earlier play, not a random draw, so Broken runs are not the same population as Answered ones.

| node | band | reached | cleared (strict) | no commander fall | deaths/battle |
|---|---|---|---|---|---|
| gate | Broken | 39 | 97% [87, 100] | 97% [87, 100] | 0.21 |
| gate | Spoken | 78 | 92% [84, 96] | 92% [84, 96] | 0.44 |
| gate | Answered | 34 | 76% [60, 88] | 76% [60, 88] | 0.71 |
| Entity | Broken | 38 | 32% [19, 47] | 71% [55, 83] | 1.87 |
| Entity | Spoken | 72 | 39% [28, 50] | 75% [64, 84] | 1.93 |
| Entity | Answered | 26 | 12% [4, 29] | 65% [46, 81] | 3.31 |

The Answered gate (+1 stone on top of the rung's two, so three, and a turn-4 wave of 2 Hollowed) is the
one band effect large enough to see (76% against 92–97%). The Entity's band rows are dominated by stalls.

## Per node (final numbers)

"Cleared" is among the runs that reached the node under permadeath. "No commander fall", "stall",
deaths and `turns − par` are over every battle fought there, including those fought by runs already lost
(the casual commander).

| player model | node | reached | cleared | no commander fall | stall | deaths/battle | turns − par |
|---|---|---|---|---|---|---|---|
| First Light, quarter meta (legacy) | old finale | 100 | 25% [18, 34] | 25% [18, 34] | 19% [13, 28] | 4.54 | +7.2 |
| First Light, quarter meta (descent) | stair | 100 | 57% [47, 66] | 58% [48, 67] | 18% [12, 27] | 2.74 | +3.8 |
| First Light, quarter meta (descent) | column | 31 | 65% [47, 79] | 49% [36, 63] | 16% [9, 29] | 1.14 | +4.0 |
| First Light, quarter meta (descent) | vigil | 46 | 61% [46, 74] | 39% [30, 49] | 6% [3, 12] | 0.76 | -2.2 |
| First Light, quarter meta (descent) | lieutenant | 28 | 79% [60, 90] | 35% [26, 45] | 8% [4, 15] | 2.79 | +6.9 |
| First Light, half meta (legacy) | old finale | 100 | 94% [88, 97] | 94% [88, 97] | 0% [0, 4] | 0.55 | -3.0 |
| First Light, half meta (descent) | stair | 100 | 99% [95, 100] | 99% [95, 100] | 0% [0, 4] | 0.14 | -3.9 |
| First Light, half meta (descent) | column | 48 | 100% [93, 100] | 100% [93, 100] | 0% [0, 7] | 0.31 | -4.0 |
| First Light, half meta (descent) | vigil | 99 | 100% [96, 100] | 100% [96, 100] | 0% [0, 4] | 0.04 | -8.4 |
| First Light, half meta (descent) | lieutenant | 99 | 99% [94, 100] | 99% [95, 100] | 0% [0, 4] | 0.16 | -3.2 |
| Dusk, half meta (legacy) | old finale | 150 | 97% [92, 99] | 97% [92, 99] | 0% [0, 2] | 0.39 | -1.0 |
| Dusk, half meta (descent) | stair | 150 | 99% [96, 100] | 99% [96, 100] | 0% [0, 2] | 0.09 | -3.9 |
| Dusk, half meta (descent) | column | 75 | 100% [95, 100] | 100% [95, 100] | 0% [0, 5] | 0.12 | -3.4 |
| Dusk, half meta (descent) | vigil | 149 | 99% [95, 100] | 98% [94, 99] | 0% [0, 2] | 0.07 | -8.5 |
| Dusk, half meta (descent) | lieutenant | 147 | 99% [96, 100] | 98% [94, 99] | 0% [0, 2] | 0.23 | -1.1 |
| Nightfall, half meta (legacy) | old finale | 230 | 16% [12, 21] | 60% [53, 66] | 81% [75, 85] | 1.91 | +17.4 |
| Nightfall, half meta (descent) | stair | 230 | 79% [73, 84] | 80% [74, 85] | 7% [4, 10] | 0.56 | -1.1 |
| Nightfall, half meta (descent) | column | 89 | 87% [78, 92] | 70% [61, 77] | 9% [5, 15] | 0.46 | +0.3 |
| Nightfall, half meta (descent) | vigil | 170 | 89% [83, 93] | 73% [67, 79] | 5% [3, 8] | 0.25 | -5.2 |
| Nightfall, half meta (descent) | gate | 151 | 90% [84, 94] | 63% [57, 69] | 2% [1, 4] | 0.38 | -1.0 |
| Nightfall, half meta (descent) | entity | 136 | 32% [24, 40] | 58% [52, 64] | 75% [69, 80] | 2.54 | +16.4 |
| Black Sun, endgame meta (legacy) | old finale | 150 | 31% [24, 39] | 71% [64, 78] | 66% [58, 73] | 1.57 | +17.7 |
| Black Sun, endgame meta (descent) | stair | 150 | 77% [70, 83] | 79% [71, 84] | 5% [3, 10] | 0.54 | -0.8 |
| Black Sun, endgame meta (descent) | column | 58 | 84% [73, 92] | 75% [64, 83] | 7% [3, 15] | 0.47 | +0.6 |
| Black Sun, endgame meta (descent) | vigil | 107 | 88% [80, 93] | 70% [62, 77] | 7% [4, 13] | 0.17 | -4.6 |
| Black Sun, endgame meta (descent) | gate | 94 | 87% [79, 93] | 60% [52, 67] | 1% [0, 4] | 0.38 | -1.2 |
| Black Sun, endgame meta (descent) | entity | 82 | 57% [47, 67] | 62% [54, 69] | 59% [51, 66] | 2.04 | +16.3 |
| Nightfall, endgame meta (legacy) | old finale | 100 | 68% [58, 76] | 87% [79, 92] | 27% [19, 36] | 0.89 | +7.2 |
| Nightfall, endgame meta (descent) | stair | 100 | 100% [96, 100] | 100% [96, 100] | 0% [0, 4] | 0.02 | -4.9 |
| Nightfall, endgame meta (descent) | column | 49 | 100% [93, 100] | 100% [93, 100] | 0% [0, 7] | 0.06 | -4.5 |
| Nightfall, endgame meta (descent) | vigil | 100 | 99% [95, 100] | 99% [95, 100] | 0% [0, 4] | 0.02 | -8.7 |
| Nightfall, endgame meta (descent) | gate | 99 | 100% [96, 100] | 100% [96, 100] | 0% [0, 4] | 0.03 | -6.6 |
| Nightfall, endgame meta (descent) | entity | 99 | 85% [76, 91] | 95% [89, 98] | 15% [9, 23] | 0.71 | +4.0 |

Before the retune, the First Light weak model's nodes were: Stair 75%, Column 78%, Vigil 64%,
Lieutenant 88%. The +1 level costs most at the Stair (75% → 57%). For every other model the nodes are
within a point or two of the shipped numbers, except the gate, which is 5 and 7 points lower than the
shipped gate on Nightfall and Black Sun (95% and 94% with no stone, 90% and 87% with two). The Entity
rows are fresh dice after the gate: they differ between stone counts by chance.

## The Landing

Spec §11: keep it only if the gate's loss rate without it is above the act bosses'.

| player model | gate lost, with Landing | gate lost, without | Act V KO-free, with | without | paired Δ (pts) | Broken at finale, with / without | act bosses lost (Acts III–IV, same model) |
|---|---|---|---|---|---|---|---|
| Nightfall, half meta | 10% [6, 16] | 12% [8, 18] | 43% [36, 49] | 46% [40, 53] | -3.5 [-9.4, +2.4] | 28% / 5% | 31% [24, 38] |
| Black Sun, endgame meta | 13% [7, 21] | 11% [6, 18] | 45% [37, 53] | 49% [41, 57] | -4.0 [-11.4, +3.4] | 11% / 4% | 31% [26, 37] |
| Nightfall, endgame meta | 0% [0, 4] | 0% [0, 4] | 94% [88, 97] | 93% [86, 97] | +1.0 [-4.2, +6.2] | 58% / 25% | 2% [1, 4] |

- **By the literal test, the Landing is not needed for the gate.** Without it, the gate is lost 12%
  (Nightfall) and 11% (Black Sun), well below the act bosses' 31%.
- **It stays.** It moves no clear rate (paired Δ −4 to +1 points, every CI spanning 0). On Nightfall
  and Black Sun it is the act's last Rite choice, made after the Vigil's words are known; without it,
  Broken nearly vanishes there (28% → 5%, 11% → 4%).
- If it were cut, the bands would need retuning to keep the §11 target.

## The gate and the Lieutenant's stones

- **Dusk (1, was 0).** The Dusk finale had no stone while the Dusk Emperor, one act earlier, has 1.
  At half meta the legacy finale is cleared 97% of the time and the Descent 99% before the stone and
  97% after (Δ +0.7 against the old act), so the stone matters to weaker armies.
- **The gate (2 on Nightfall and Black Sun, was 0, then 1).** Nightfall's Emperor carries 1 and Black
  Sun's 2, so the gate now stands above Nightfall's Emperor and level with Black Sun's.
  - It stays among the Descent's easier battles: cleared 90% on Nightfall and 87% on Black Sun
    (95% and 94% with no stone), against 79–88% for the Stair and the Vigil and 31% for the act bosses.
  - The defeat objective lets an army go straight for him, so a stone costs little: see "The second
    gate stone" for what the second one cost.

## The second gate stone

The owner approved a second Revival Stone for the Lieutenant at the gate (`revivalStones.lieutenant`
1 → 2 on Nightfall and Black Sun; Dusk stays 1, First Light 0). The kind reaches only him: the gate is
the one boss node that names the Lieutenant on those rungs (the legacy finale seats the Entity, whom the
stone table never touches), and the elite captain and Entity rows read their own entries.

The same entry states played Act V with the gate at one stone and at two (`--stones lieutenant=1`
against the data's 2), the Descent arm and the no-Landing arm. Seeds are those of the models above
(Nightfall half 200001–200150 and 205001–205080, Black Sun endgame 300001–300150, Nightfall endgame
200001–200100). Everything before the gate plays identically in both versions (same stream, same maps),
so the gate fight itself is a clean paired comparison; every battle after it gets fresh dice.

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

For reference, the numbers this report carried before the correction (the replay played 0 stones for
most of these runs): gate cleared 93% / 89% / 100%; Act V strict 20% / 29% / 79%; KO-free 47% / 49% / 95%.

- **The stone costs about one turn and 0–2 points of gate commander falls.** The cleanest reading is the
  gate fight itself: +2.2 points on Nightfall (CI +0.3..+4.1), +0.7 on Black Sun, none for the strong army.
- **Act V moves inside its noise.** Nightfall's KO-free rate is 5 points lower (CI −10.7..+0.3), more
  than the gate's +2.2 falls explain; the rest is the Entity played on different dice. Nightfall
  endgame's strict +7 is the same kind of draw (the Entity's clear rate there is 78% → 85%, a stone
  at the gate cannot have made the Entity easier). Neither is evidence for or against the stone.
- **The gate remains one of the easier fights.** Lost 10% (Nightfall) and 13% (Black Sun) against 31% for
  the act bosses, and 0% for the strong army.
- **An Answered Rite makes it three stones** (the rung's two and the Rite's one): that gate is cleared
  76% of the time on Nightfall (34 fights; 92–97% on the other bands).

## Harness and sim baselines

The parity fix changes which maps the sims play, so two strict slices of `npm run sim:fullrun:pr`
moved past their bounds. No data change in this branch reaches these slices: they are Act I or legacy
Act V on First Light, and First Light keeps no stones.

| slice | metric | before (old driver) | after (this branch) | threshold |
|---|---|---|---|---|
| `act1_pressure_normal` | `avg_units_lost` | 0.75 | 1.67 | 1.25 → 1.80 |
| `progression_invincible` | `avg_gold` | 12994 | 17627 | 17500 → 19500 |

Over 80 seeds the first metric is 1.02 (old driver) against 1.19 (this branch): the 12-seed slice landed
on a high draw, not on a regime change. Threshold note for the PR (`npm run check:threshold-pr-notes`):

- attribution command: `npm run sim:fullrun:triage` (`node tests/sim/fullrun-slice-triage.js`);
- first_bad_sha: `6310af4f` (this branch's commit);
- parent_sha: `20261ba3`;
- failing metrics: `act1_pressure_normal avg_units_lost=1.67 > 1.25`, `progression_invincible avg_gold=17627.33 > 17500`;
- touched files: `tests/sim/RunSimulationDriver.js`, `tests/sim/ClaimingRunDriver.js`,
  `tests/harness/GameDriver.js`, `sim/strategy.js`.

`npm run test:harness:pr` (fuzz scenarios) is unchanged: 50 runs, 0 failures.

## `sim/pacing.js`

It runs on this base. It played five Dusk seeds to the end before I stopped it. The removed
`plantsAmongPositions` import was fixed on main by #306 (`796c55e7`), which is in this base. Draft PR #316
(claude/encounter-pacing) is reworking the pacing sims; nothing here touches them.

## Limits

- **The player is an agent.**
  - The scripted claiming player is far weaker than a person, which is why the models buy Home Base.
  - Its absolute rates are not a person's; the paired differences are the evidence.
  - Its Entity fights stall at the turn cap 65–80% of the time at mid strength, in both arms. That is
    why the KO-free measure carries the Nightfall and Black Sun conclusions.
- **The event policy is rite-first.** Its Broken shares are an upper bound for players who take the
  heal or the Vision charge instead.
- **Act IV yardsticks** (per-act battle counts) were recorded only for the captures made after the
  field was added: Nightfall half (second set) and First Light quarter. The act-boss rates come from
  every capture.
- **Elite captain levels** (not tuned):
  - `SetPieces.captainLevelFor` subtracts 10 for a promoted class, and `createPromotedEnemyUnit`
    treats the spawn level as an effective level (10 + promoted levels).
  - The two together put every promoted elite captain in Acts III–V about 10 levels below the escorts
    around it. The Vigil's Warden of the Rite is promoted level 1 among level 3–8 guards.
  - The fix is an engine rule with a game-wide reach, so it belongs in its own PR. Patching the Warden
    with a +10 slot offset would hide the bug.
