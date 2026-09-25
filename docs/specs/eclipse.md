# The Eclipse — a visible run clock

Status: built (branch `claude/eclipse`). Approved direction (user, 2026-09-25); owner:
gameplay wave 1. This document is the spec as given, refined to what shipped. Every
deviation is listed in [Deviations](#deviations-from-the-approved-spec) with its reason.

## Why

Today the clock is hidden: turn par quietly decays XP and gold ("late pressure")
two turns over par, and players learn about it from a footnote. The design log's
rule is *punish the clock, not the unit*. The Eclipse makes that rule visible and
strategic: every turn spent in battle darkens the Hollow Sun, and the darkness
visibly takes the land ahead of you. Fast, clean play keeps the map open; slow
play loses villages, chapels and recruits — but the eclipsed nodes that replace
them are harder fights with better spoils, so darkness is also opportunity.

## Vocabulary (player-facing)

- **Eclipse** — the meter. Drawn as the Hollow Sun with an ink disc eating it.
- **Shadow** — the number, 0–100 for the run. Never shown as a percentage.
- **Phases** (by run shadow): **Pale** 0–24, **Waning** 25–49, **Umbral** 50–74,
  **Totality** 75–99, **Hollow** 100 (cap).
- **Eclipsed** — a node the dark has taken.

## Rules

### 1. Gaining shadow (only battle time darkens the sun)

At battle **victory commit** (`RunManager.completeBattle`, next to `totalTurns`;
callers pass `{ turnCount, turnPar }`):

```
grace = eclipse.graceUnderPar                         // 3
gain  = max(0, turnsTaken - max(1, par - grace))
gain  = min(gain, eclipse.maxGainPerBattle)           // 6
gain  = round(gain * eclipse.difficultyGain[difficultyId])   // 1 / 1 / 1
```

An S-rank clear (par−3 or better) adds nothing ("Sun held"); each turn past that adds 1.
Battles with no par add `eclipse.noParGain` (1). A caller that passes no turn count adds
nothing. Tutorial runs never gain shadow (`startRun({ tutorialMode: true })` disables the
Eclipse; the tutorial battle itself has no RunManager).

Committed at victory only — never mid-battle — so Vision rewind, suspend/resume and
"Continue from Map" are correct for free (they restore `turnNumber`/`turnPar`; the run
value is untouched until the win). Defeat ends the run.

During battle the HUD shows the **projected** gain for the current turn
(`RunManager.projectShadowGain(turnNumber, turnPar)`, recomputed every frame), e.g.
`Shadow +2`, or `Sun holds` while inside the grace window.

### 2. Losing shadow (the sun flares)

- Act boss defeated: `−eclipse.bossRelief` (3), applied at the same commit, after the
  battle's gain. Includes the final act's boss.
- Church **Kindle** service: pay `eclipse.kindlePrice[act]` (400/700/1000/1300/1500)
  to remove `eclipse.kindleAmount` (8) shadow, once per church node (not at the pre-boss
  Ruins). A real gold sink.
- Floor 0, cap 100 (`eclipse.cap`, applied to the gain before relief). Shadow changes
  nowhere else.

### 3. The dark takes the map (per act)

Each act remembers `actStartShadow` (shadow when its map was generated).
`actShadow = max(0, shadow - actStartShadow)` drives node falls for this act, so every act
opens on a fresh land and then darkens as you spend time in it. (Kindle therefore delays
this act's falls by its full amount.)

Every node has a deterministic **fall threshold** in act-shadow units, computed (never
stored — legacy saves need no node migration):

```
laneBase  = { outer (lanes 0,4): 5, inner (1,3): 12, center (2): 22 }
rowTerm   = round(eclipse.rowBias * (1 - row / (rows - 1)))      // rowBias 4
jitter    = fnv1a(`eclipse:${runSeed}:${nodeId}`) mod (eclipse.jitter + 1)   // 0..4
threshold = laneBase + rowTerm + jitter
```

After every shadow change (victory commit, boss relief, Kindle, act start, and
idempotently on load) `applyEclipse` runs. A node **falls** when
`actShadow >= threshold` and it is none of: the start node, the boss, the pre-boss RUINS,
completed, the current node (`currentNodeId`), the battle in progress
(`battleInProgress.nodeId`), `encounterLocked`, or already eclipsed.

Falling **transforms** the node, never deletes it: the graph, edges and boss reachability
are untouched.

| Was | Becomes | Label (`data/eclipse.json` `falls`) |
|---|---|---|
| BATTLE | same encounter, `battleParams.isEclipsed`, `isElite` | Eclipsed battle |
| SHOP (incl. ambush) | rout BATTLE, `isEclipsed`, `isElite` (ambush flags dropped) | Burned village |
| CHURCH | rout BATTLE, `isEclipsed`, `isElite` | Desecrated chapel |
| RECRUIT | rout BATTLE (no recruit), `isEclipsed`, `isElite` | Lost to the dark |
| COLOSSEUM | rout BATTLE, `isEclipsed`, `isElite` | Silent arena |

`node.eclipse = { fellAtShadow, fromType, label, seen: false }` lets the Loom play the fall
once and say what was lost.

Converted battle params come from `convertNodeToRoutBattle` — the village-ambush
conversion, extracted from `NodeMapGenerator` into a shared helper (rout params, per-row
level range, biome-rolled template, fog roll, battle seed; draw order preserved) — run
under its own seeded stream `eclipse-node:${runSeed}:${nodeId}` with the
`_withNodeMapSeed` install/restore pattern. The node-map and battle RNG streams are never
consumed; `generateNodeMap` output is byte-identical to before for every seed (verified
across 6000 generator calls, and by `RunManagerEclipse.test.js`).

Eclipsed battles: elite loot (4 choose 2) and elite gold (keyed off `isElite`), plus
`eclipse.eclipsedEnemyLevelBonus` (+1), and at least one tier-1 affix on up to
`eclipse.eclipsedAffixCount` (2) enemies whatever the difficulty's chance or act gating.
Caravan/village micro-objectives never appear on converted service nodes (fresh params);
a fallen battle keeps its own.

### 4. The sun darkens the world (global phase)

The run phase adds, via `RunManager.getBattleParams` (keys only added when non-zero, so a
Pale run's params are unchanged):

- `enemyLevelBonus` += `eclipse.phaseEnemyLevelBonus[phase]` ([0,0,1,1,2]).
- `eclipseAffix`: Normal uses Hard's affix gating from Umbral on; every difficulty gets +1
  max affix per unit at Totality and Hollow (`eclipse.phaseAffix`).
- `eclipsePhaseIndex`: the battle's atmosphere darkens per phase (exposure, vignette,
  saturation, night darkness nudges in `atmosphereConfig.ECLIPSE_PHASE_NUDGE`) —
  presentation only, never in the tutorial.

### 5. Replacing the hidden clock

While the Eclipse is active, `getLatePressureState(…, { eclipseActive: true })` forces
the XP and gold multipliers to 1 (no silent decay; the "Taking too long" hint and the
pressure suffix on the turn label disappear). Par, the S/A/B/C rating and rating bonus
gold stay. Boss enrage and the anti-turtle AI stay (visible in the boss bar). With the
Eclipse off (tutorial, or no data) late pressure is unchanged.

## State

`RunManager.eclipse = { version: 1, shadow: 0, actStartShadow: 0, enabled: true, kindledNodeIds: [] }`

- Constructor default; reset in `startRun` (disabled for `tutorialMode`); `advanceAct`
  sets `actStartShadow = shadow`, then applies; serialized in `toJSON`; guarded
  `normalizeEclipseState` in `fromJSON` (legacy saves: enabled, shadow 0, actStartShadow
  0 — a mid-run legacy save simply starts its clock now).
- Save → load → save is byte-identical (`PersistenceBoundaryContracts` green;
  `RunManagerEclipse.test.js`).
- `lastEclipseCommit` (not persisted) records `{ before, gain, relief, after, fell }` for
  the sims.

## Data

`data/eclipse.json` (+ `public/data` mirror, `DataLoader`, `tests/testData.js`,
`DataLoaderBlessings` mock map, `schemas/eclipse.schema.json` under `validate:data`):
`cap`, `graceUnderPar`, `maxGainPerBattle`, `noParGain`, `difficultyGain`, `bossRelief`,
`kindleAmount`, `kindlePrice`, `laneBase`, `rowBias`, `jitter`, `fallWarning`, `phases`,
`phaseEnemyLevelBonus`, `phaseAffix`, `eclipsedEnemyLevelBonus`, `eclipsedAffixCount`,
`eclipsedAffixTier`, `falls` (labels + toast nouns). With no Eclipse data the system is
inert.

## Presentation (Ink & Ember)

Captures: `docs/art-direction/gameplay/eclipse/`.

- **Loom header** — a medallion (`src/art/eclipse/eclipseSun.js`, the Hollow Sun
  corona language of the title and the Loom): a gold sun with an ink disc sliding across
  it in proportion to shadow; crimson fractures from Umbral; at 100 only the corona is
  left. Phase in Press Start 2P, the number beside it. Collapses to a 28px glyph + number
  at ≤900px. Opens the explainer card (what darkens it, what this phase does now, how much
  shadow until the next knot within reach falls, the five-phase scale) over the loom.
- **Loom nodes** — eclipsed: black medal, thin gold corona rim, ember cracks, the place's
  silhouette burnt brown, a small hollow sun painted under it on the weave; `ECLIPSED`
  under reachable ones. Nodes within `fallWarning` (3) act shadow of falling get a crescent
  bite on the frame (deeper as the fall nears); the inspect card says "The dark takes this
  in N more shadow". The fallen lanes' ground darkens (ink dither swallowing grain and warp
  threads, an unlight bruise pooling in from the fallen outer edge) and the futures past
  the next choices dissolve further.
- **Fall ceremony** — on the loom's first visible frame, unseen falls bleed to ink one
  after another (rim flare, ink bloom, cracks ignite) with ember sparks on the fx layer,
  then one line names the loss ("The dark takes the village and 2 more."). Reduced motion:
  instant swap + the line. Marked seen and saved when it has played; covering the loom
  finishes it early. A one-time teaching note follows the first fall of a save.
- **Battle HUD** — desktop status plate (a painted eclipsed-sun glyph + `Shadow +N`) and
  the phone counters row (a separate element under the parsed counters). The
  `Turn: N / Par: P (R)` label is unchanged. A one-time contextual hint the first time a
  projection rises above 0.
- **Victory band** — appends `Sun held` or `Shadow +N`, and `Sun flares −3` on an act boss.
- **Act card** — "ACT III · UMBRAL".
- **Run end + records** — the run-end card and result menu show the final phase and shadow;
  victory records keep `shadow` (whitelisted in `mergeRunRecords`) and the records menu
  shows it.
- **Help** — `runReference` entry "The Eclipse" and a Goals-tab page.
- **Canvas fallbacks** — the Phaser node map lists "Phase · shadow" and tints eclipsed
  nodes; the in-battle canvas campaign map draws them as ink discs with a gold rim.

## Tuning (sim evidence)

`node sim/eclipse.js --seeds 60 [--difficulty hard|lunatic]` walks real node maps with
RunManager (real par from generated battles, real commits and falls) under fixed rating
profiles. Normal, act-end shadow (average; phase mix):

| Profile | Act I | Act II | Act III | Final | Knots taken / run (ahead) | Services lost (ahead) |
|---|---|---|---|---|---|---|
| S (par−3) | 0 Pale | 0 Pale | 0 Pale | 0 Pale | 0 | 0 |
| A (par) | 14.4 Pale | 29.6 Waning 83% | 45.4 Waning 75% / Umbral 25% | 45.4 | 18.7 (3.3) | 8.6 (1.7) |
| B (par+2) | 26.9 Waning 68% | 57.3 Umbral 78% | 86.8 Totality 98% | 88.5 | 35.5 (12.3) | 15.1 (6.0) |
| C (par+5) | 34.0 Waning | 71.9 Umbral 62% / Totality 37% | 96.5 Totality | 96.7 | 36.5 (15.8) | 15.9 (7.7) |

Hard/Lunatic (four acts): A ends Act IV at 60.9 (Umbral 97%). "Ahead" counts knots still
reachable by the party when they fell. Targets met: A-rank ends Act I Pale, reaches Waning
in Act II and ends the run around Umbral (Waning/Umbral border on Normal's three acts,
Umbral on Hard/Lunatic); S-rank keeps every map whole; consistent C-rank reaches Totality
by Act III (usually during Act II).

Full-run harness (`sim:fullrun:pr`): the driver now passes `turnCount`/`turnPar` and
HeadlessBattle tracks par (same formula and wave bumps as BattleScene). The scripted agent
is a very slow player (~10 turns a battle on Normal, ~26 on the Hard invincible slice):
`progression_invincible` ends at 29.5 shadow (act ends 0 / 11.7 / 29.2), the Hard ambush
slice at 97 (Totality by Act III). The ambush slice's `max_avg_gold` window moved
33000 → 52200 (see `docs/harness-thresholds.md` for the attribution).

## Deviations from the approved spec

1. **`maxGainPerBattle` 10 → 6, `bossRelief` 10 → 3.** With the spec's numbers an at-par
   A-rank player ended the run at ~17 shadow (Pale) and C-rank sat pinned at the cap from
   Act II. Relief is the only lever that moves A without breaking "S-rank holds the sun",
   and the cap is what keeps a turtle from hitting Hollow in Act I. Sim table above.
2. **`rowBias` 4, `jitter` 4, `fallWarning` 3** — values the spec left open or implied.
3. **Guaranteed affixes** respect the difficulty's own affix exclusions (Normal never gets
   Haste/Deathburst/Teleporter) and the class/mutual exclusion rules; an enemy that already
   rolled an affix counts toward the guarantee.
4. **"Normal uses Hard gating"** means Hard's whole gating row (chance, max, tier pool —
   and therefore no Act I exclusion).
5. **Unknown turn count adds nothing** (legacy callers that omit `turnCount`); a known turn
   count without a par adds `noParGain`.
6. **The battle in progress is exempt** from falls (load-time application with a suspended
   battle), alongside the spec's list.
7. **Kindle is church-only** (not the pre-boss Ruins camp, which also opens the church
   menu).
8. **Boss card unchanged**; only the act card carries the phase.
9. **Atmosphere nudges are code constants** (`ECLIPSE_PHASE_NUDGE`), like the rest of
   `atmosphereConfig`: presentation, not game data.
10. The explainer's "next fall" counts only knots the party can still reach (what the player
    can act on); the view model also reports the next fall anywhere.

## Tests

- `tests/EclipseSystem.test.js` — gain (S/A/B/C, no par, cap, tutorial, difficulty
  scale), phases, state normalization, threshold determinism/range/row bias, exemptions,
  the transformation table, idempotence, the caller's `Math.random` never touched and
  conversions independent of ambient RNG, outer lanes first, battle modifiers, Kindle,
  view model, toast copy.
- `tests/RunManagerEclipse.test.js` — commit gain/relief/cap/off, falls at commit, edges
  and boss reachability after any falls, `advanceAct`, node-map generation unchanged,
  battle params, save round trip + legacy defaults + load application sparing the battle in
  progress, seen marking, victory record, late pressure neutral/unchanged, church Kindle.
- `tests/AffixEngineEclipse.test.js` — unchanged without overrides, guarantee, Hard gating,
  +1 max affix.
- `tests/EclipseUi.test.js` — Loom model/labels/frames, copy, victory band, act card, run
  end, sidebar parser, HUD projection, records whitelist, atmosphere, medallion art
  determinism (no `Math.random`).
- `tests/e2e/eclipse.spec.js` — Loom medallion + eclipsed nodes + ceremony (plays once,
  saved seen) + inspect + explainer at 1280×800 and 844×390; reduced motion; battle HUD
  projection on desktop and phone.
