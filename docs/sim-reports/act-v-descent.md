# Act V, the Descent: sims and tuning

Report of `npm run sim:descent` (2026-10-11) on `claude/descent-tuning`, based on
`claude/descent-integration` at `20261ba3`. The route ships dark: every number here comes from a copy
of the data with `descent.json` `enabled: true` made by the sim, never from the file.

## For the owner (summary)

- 830 runs played Acts I–IV once; Act V then ran twice from each entry state (old two-node act, Descent), same dice, compared run by run. Players buy part of Home Base: without it the scripted player reaches Act V with 2 units.
- Nightfall/Black Sun, mid-strength army: the Descent costs 13 / 23 points of "no commander fall in Act V". Four more fights at about Act IV's per-fight risk explain it. Counting stalls as losses, clear rate is unchanged (+4 / −2). Strong armies gain 8–11 points (XP, loot, the gate's Vision).
- First Light: the shipped Descent was easier than the old act (+13 for a weak army). The Lieutenant route is now one level up: −3 (CI −11..+5). Strong First Light and Dusk armies clear both versions 97–99% of the time.
- The Rite: shipped numbers sent 52–93% of finales in on Broken. First Light started at 0, so row-1 quieting (the Column at par, the side-stair events) was lost to the floor. Now: start +3 (Pale 3 … Hollow 9), bands 0–4 / 5–9 / 10+, Column at par −2. Nightfall reaches the Entity Broken/Spoken/Answered 28/53/19% (spec: a third/a half). Broken now needs a quick Vigil and a quieting choice.
- The Lieutenant: 1 Revival Stone on Dusk (like the Dusk Emperor) and at the gate (Nightfall, Black Sun).
- The Landing stays. §11's literal test says it is not needed: without it the gate is lost 11%, the act bosses 31%. But it makes Broken reachable on Nightfall (28% vs 4%) and moves no clear rate (+2, CI −4..+8).
- Needs your eye: (1) the gate is the Descent's easiest fight (7% lost); (2) engine issue, not touched: every promoted elite captain spawns about 10 levels low (`captainLevelFor`); the Vigil's Warden is promoted level 1 among level 3–8 guards; (3) the agent stalls most Entity fights at the turn cap, in both arms.

## What changed

| Number | Before | After | Why (numbers below) |
|---|---|---|---|
| `descent.json` `rite.startByPhase` | Pale 0, Waning 1, Umbral 2, Totality 4, Hollow 6 | 3, 4, 5, 7, 9 | a lowering before the Vigil was lost to the floor (First Light always started at 0) |
| `rite.bands` | Broken 0–4, Spoken 5–11, Answered 12+ | 0–4, 5–9, 10+ | Broken was the default (52–93% of finales); now Nightfall's split is the spec's |
| `rite.underPar.column` | −1 | −2 | makes the fork a Rite decision (the Column ≈ the Seers' finish, above the Lantern) |
| `routes.lieutenant.levelOffset` | [1, 1] | [2, 2] | the First Light / Dusk Descent was easier than the old act for weak and strong armies |
| `difficulty.json` `revivalStones.lieutenant` | Dusk 0, Nightfall 0, Black Sun 0 | 1, 1, 1 | the Dusk finale with fewer stones than the Dusk Emperor; the gate as weightless as an elite |
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
  saved entry states, so each retune cost about 20 minutes, not hours.
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
  ```

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

"Before" is the Descent with the shipped numbers; "after" is the Descent with the numbers in this branch.
The legacy column is the old act, which none of the retune touches (the Dusk stone is in both arms).

| player model | n | legacy | Descent before | Δ before (pts) | Descent after | Δ after (pts) |
|---|---|---|---|---|---|---|
| **strict** | | | | | | |
| First Light, quarter meta | 100 | 25% [18, 34] | 38% [29, 48] | +13.0 [+3.5, +22.5] | 22% [15, 31] | -3.0 [-11.1, +5.1] |
| First Light, half meta | 100 | 94% [88, 97] | 98% [93, 99] | +4.0 [-1.5, +9.5] | 98% [93, 99] | +4.0 [-1.5, +9.5] |
| Dusk, half meta | 150 | 97% [92, 99] | 99% [95, 100] | +2.0 [-0.9, +4.9] | 97% [93, 99] | +0.7 [-2.3, +3.6] |
| Nightfall, half meta | 230 | 16% [12, 21] | 19% [14, 24] | +3.0 [-2.0, +8.1] | 20% [15, 25] | +3.9 [-1.3, +9.1] |
| Black Sun, endgame meta | 150 | 31% [24, 39] | 28% [21, 36] | -3.3 [-10.4, +3.7] | 29% [23, 37] | -2.0 [-9.7, +5.7] |
| Nightfall, endgame meta | 100 | 68% [58, 76] | 82% [73, 88] | +14.0 [+3.9, +24.1] | 79% [70, 86] | +11.0 [+1.0, +21.0] |
| **KO-free** | | | | | | |
| First Light, quarter meta | 100 | 25% [18, 34] | 38% [29, 48] | +13.0 [+3.5, +22.5] | 22% [15, 31] | -3.0 [-11.1, +5.1] |
| First Light, half meta | 100 | 94% [88, 97] | 98% [93, 99] | +4.0 [-1.5, +9.5] | 98% [93, 99] | +4.0 [-1.5, +9.5] |
| Dusk, half meta | 150 | 97% [92, 99] | 99% [95, 100] | +2.0 [-0.9, +4.9] | 97% [93, 99] | +0.7 [-2.3, +3.6] |
| Nightfall, half meta | 230 | 60% [53, 66] | 47% [41, 53] | -12.6 [-20.7, -4.5] | 47% [40, 53] | -13.0 [-20.7, -5.4] |
| Black Sun, endgame meta | 150 | 71% [64, 78] | 47% [40, 55] | -24.0 [-32.8, -15.2] | 49% [41, 57] | -22.7 [-31.6, -13.7] |
| Nightfall, endgame meta | 100 | 87% [79, 92] | 95% [89, 98] | +8.0 [+0.8, +15.2] | 95% [89, 98] | +8.0 [+0.3, +15.7] |

Reading it:
- **First Light.** The old finale (the Lieutenant on `eldritch_sanctum`: 12 foes at 13–18 plus 3 wave
  spawns) is harder than the shipped Glass (8 escorts at Act III's late range plus one). Weak armies
  cleared the shipped Descent 13 points *more* often than the old act. After the +1 level, they clear it
  3 points less often. Strong armies clear either version.
- **Dusk.** It saturates at this strength; the stone and the level leave it at the legacy rate (+0.7).
- **Nightfall and Black Sun (mid-strength).** Both arms stall at the Entity in 65–80% of fights
  (`turns − par` about +17), so the strict rate tells little. The KO-free rate is the cost: −13 and −23
  points. There are 4.5 more battles, each with a 7–21% chance of a lost battle (next table). In the
  same models a plain Act IV battle has a commander fall 29% of the time, so no single Descent fight is
  out of line. The cost is the number of fights.
- **Nightfall strong.** +8 KO-free, +11 strict. The Entity is easier after the Descent (80% against 68%)
  even on the Spoken band (79%). The difference is the army: three more fights' XP and loot, and the
  gate's +1 Vision.

## The Rite

The words at the finale (Lieutenant or Entity) among the runs that reached it under permadeath, with each
version's own bands:

| player model | finale reached | before: Broken / Spoken / Answered | after: Broken / Spoken / Answered |
|---|---|---|---|
| First Light, quarter meta | 28 | 14% / 70% / 16% | 4% / 71% / 25% |
| First Light, half meta | 99 | 75% / 24% / 1% | 35% / 64% / 1% |
| Dusk, half meta | 147 | 76% / 24% / 0% | 18% / 79% / 3% |
| Nightfall, half meta | 140 | 57% / 41% / 1% | 28% / 53% / 19% |
| Black Sun, endgame meta | 84 | 52% / 47% / 1% | 11% / 70% / 19% |
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
| gate | Broken | 39 | 100% [91, 100] | 100% [91, 100] | 0.18 |
| gate | Spoken | 78 | 95% [88, 98] | 95% [88, 98] | 0.31 |
| gate | Answered | 34 | 79% [63, 90] | 79% [63, 90] | 0.56 |
| Entity | Broken | 39 | 23% [13, 38] | 62% [46, 75] | 1.64 |
| Entity | Spoken | 74 | 43% [33, 55] | 82% [72, 89] | 1.73 |
| Entity | Answered | 27 | 15% [6, 32] | 81% [63, 92] | 3.22 |

The Answered gate (+1 stone, a turn-4 wave of 2 Hollowed) is the one band effect large enough to see
(79% against 95%). The Entity's band rows are dominated by stalls.

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
| Dusk, half meta (legacy) | old finale | 150 | 97% [92, 99] | 97% [92, 99] | 0% [0, 2] | 0.35 | -1.8 |
| Dusk, half meta (descent) | stair | 150 | 99% [96, 100] | 99% [96, 100] | 0% [0, 2] | 0.09 | -3.9 |
| Dusk, half meta (descent) | column | 75 | 100% [95, 100] | 100% [95, 100] | 0% [0, 5] | 0.12 | -3.4 |
| Dusk, half meta (descent) | vigil | 149 | 99% [95, 100] | 98% [94, 99] | 0% [0, 2] | 0.07 | -8.5 |
| Dusk, half meta (descent) | lieutenant | 147 | 99% [96, 100] | 98% [94, 99] | 0% [0, 2] | 0.19 | -1.8 |
| Nightfall, half meta (legacy) | old finale | 230 | 16% [12, 21] | 60% [53, 66] | 81% [75, 85] | 1.91 | +17.4 |
| Nightfall, half meta (descent) | stair | 230 | 79% [73, 84] | 80% [74, 85] | 7% [4, 10] | 0.56 | -1.1 |
| Nightfall, half meta (descent) | column | 89 | 87% [78, 92] | 70% [61, 77] | 9% [5, 15] | 0.46 | +0.3 |
| Nightfall, half meta (descent) | vigil | 170 | 89% [83, 93] | 73% [67, 79] | 5% [3, 8] | 0.25 | -5.2 |
| Nightfall, half meta (descent) | gate | 151 | 93% [87, 96] | 65% [59, 71] | 2% [1, 4] | 0.31 | -2.3 |
| Nightfall, half meta (descent) | entity | 140 | 32% [25, 40] | 62% [56, 68] | 75% [69, 80] | 2.40 | +16.4 |
| Black Sun, endgame meta (legacy) | old finale | 150 | 31% [24, 39] | 71% [64, 78] | 66% [58, 73] | 1.57 | +17.7 |
| Black Sun, endgame meta (descent) | stair | 150 | 77% [70, 83] | 79% [71, 84] | 5% [3, 10] | 0.54 | -0.8 |
| Black Sun, endgame meta (descent) | column | 58 | 84% [73, 92] | 75% [64, 83] | 7% [3, 15] | 0.47 | +0.6 |
| Black Sun, endgame meta (descent) | vigil | 107 | 88% [80, 93] | 70% [62, 77] | 7% [4, 13] | 0.17 | -4.6 |
| Black Sun, endgame meta (descent) | gate | 94 | 89% [82, 94] | 63% [55, 70] | 0% [0, 2] | 0.32 | -2.9 |
| Black Sun, endgame meta (descent) | entity | 84 | 52% [42, 63] | 65% [57, 72] | 65% [57, 72] | 2.37 | +18.0 |
| Nightfall, endgame meta (legacy) | old finale | 100 | 68% [58, 76] | 87% [79, 92] | 27% [19, 36] | 0.89 | +7.2 |
| Nightfall, endgame meta (descent) | stair | 100 | 100% [96, 100] | 100% [96, 100] | 0% [0, 4] | 0.02 | -4.9 |
| Nightfall, endgame meta (descent) | column | 49 | 100% [93, 100] | 100% [93, 100] | 0% [0, 7] | 0.06 | -4.5 |
| Nightfall, endgame meta (descent) | vigil | 100 | 99% [95, 100] | 99% [95, 100] | 0% [0, 4] | 0.02 | -8.7 |
| Nightfall, endgame meta (descent) | gate | 99 | 100% [96, 100] | 100% [96, 100] | 0% [0, 4] | 0.02 | -7.4 |
| Nightfall, endgame meta (descent) | entity | 99 | 80% [71, 87] | 96% [90, 98] | 18% [12, 27] | 0.53 | +4.3 |

Before the retune, the First Light weak model's nodes were: Stair 75%, Column 78%, Vigil 64%,
Lieutenant 88%. The +1 level costs most at the Stair (75% → 57%). For every other model the nodes are
within a point or two of the shipped numbers, except the gate, which lost 1–5 points to its stone.

## The Landing

Spec §11: keep it only if the gate's loss rate without it is above the act bosses'.

| player model | gate lost, with Landing | gate lost, without | Act V KO-free, with | without | paired Δ (pts) | Broken at finale, with / without | act bosses lost (Acts III–IV, same model) |
|---|---|---|---|---|---|---|---|
| Nightfall, half meta | 7% [4, 13] | 11% [7, 17] | 47% [40, 53] | 44% [38, 51] | +2.2 [-3.5, +7.9] | 28% / 4% | 31% [24, 38] |
| Black Sun, endgame meta | 11% [6, 18] | 7% [4, 15] | 49% [41, 57] | 47% [40, 55] | +1.3 [-5.1, +7.8] | 11% / 3% | 31% [26, 37] |
| Nightfall, endgame meta | 0% [0, 4] | 0% [0, 4] | 95% [89, 98] | 91% [84, 95] | +4.0 [-2.8, +10.8] | 58% / 25% | 2% [1, 4] |

- **By the literal test, the Landing is not needed for the gate.** Without it, the gate is lost 11%
  (Nightfall) and 7% (Black Sun), well below the act bosses' 31%.
- **It stays.** It moves no clear rate (paired Δ +1 to +4 points, every CI spanning 0). On Nightfall
  and Black Sun it is the act's last Rite choice, made after the Vigil's words are known; without it,
  Broken nearly vanishes there (28% → 4%, 11% → 3%).
- If it were cut, the bands would need retuning to keep the §11 target.

## The gate and the Lieutenant's stones

- **Dusk (1, was 0).** The Dusk finale had fewer stones than the Dusk Emperor (1) one act earlier.
  At half meta the legacy and Descent Dusk finales are 97% and 99% before and after, so the stone
  matters to weaker armies.
- **The gate (1 on Nightfall and Black Sun, was 0).**
  - It is the Descent's easiest battle: 93% cleared on Nightfall and 89% on Black Sun (95% and 94%
    before the stone), against 79–88% for the Stair and the Vigil and 31% for the act bosses.
  - The defeat objective lets an army go straight for him, so a second stone would cost little.
  - I stopped at the act bosses' 1. A heavier gate is an owner's call, because it would add to the
    Nightfall and Black Sun cost above.

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
