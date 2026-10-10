# Set pieces: authored skeletons, chunks and seeded choices

Status: proposal, revision 5 (2026-10-10). Takes in the cross-review of the spec set,
`05`'s notes (boss picks, `signatureOverride`, the Parade's wake, the finale share), a
review finding on the old-client guard (§12.1: derived from capabilities, not from `setPiece`)
and the owner's rung ladder of 2026-10-10 (README §6: Dusk takes only set pieces of 20x12 or
less and no boss set piece).
Specs only: no game code or data changes.
Branch `claude/large-maps-specs`. Roadmap phases 4–6 of the [README](README.md).
- Depends on `02` (encounter groups, triggers, contact-relative waves, the par formula, the
  terrain module) and `03` (the objective model, phases, bonuses, the non-walk par terms).
  This spec writes their fields, including `battleConfig.parRoute`; it never defines their
  rules. The exact PRs each map needs are in §14.
- The walk and turn numbers below come from a scratch script that assembles the sketched maps
  from their chunks and runs the shipped `SeizeParFloor.turnsToReach`. They are design
  estimates, not sim results. `sim/pacing.js` measures the real maps in each content PR.

## 1. Where we are

**Generation.**
- `generateBattle` (`MapGenerator.js:61`) wraps `generateBattleLayout` (`:72`): a size from
  `mapSizes.json` (one draw, `:97`), or a template's `fixedSize` (`:115-121`; only
  `eldritch_sanctum`). Then zone terrain (`:1034`), structures, the hybrid overlay
  (`:128-129`), features (Ballista at Nightfall+ outside Act I, `:138`).
- Enemies: `rollEnemyCount` (`:205`), `generateEnemies` (`:1972`; boss or elite captain on the
  throne first, `:244`), then caster gear, carry, affixes, Sworn affix and area arts
  (`:265-305`). Then village/escape tiles, `ensureReachability` (`:419`, which carves through
  anything blocking Infantry), holders (`:495`), the ladder (`:510`), Hunted (`:538`); the
  config is assembled at `:552`.
- `BattleScene` plays a locked config if one exists, else builds a prologue chapter, else runs
  `withBattleSeed(battleSeed, () => generateBattle(...))` and locks it (`BattleScene.js:1503-1520`,
  `:2463`). Each node's map is therefore already hermetic. The harness and `sim/carry.js` /
  `sim/eclipse.js` generate through the same function (`HeadlessBattle.js:286`).

**Authored maps** exist only in the prologue: `parsePrologueMap` (`Prologue.js:411`, a legend
plus space-separated rows) and `buildPrologueBattleConfig` (`:472`). They are gated by
`isScriptedBattle` (`ScriptedBattle.js:31`), which suppresses the Eclipse, Guidance, deeds and
villages: the wrong path for standard-run content.

**Hybrid arenas v1** are absolute: `arenaOrigin`, `anchors` and `scriptedWaves` are `[col,row]`
on a rolled size (`resolveHybridAnchors` `:835`, overlay `:851`). Overrides run in
`BattleScene.applyDueHybridOverridesForTurn` (`:2735`) and in a harness copy
(`HeadlessBattle.js:1039`). Both arenas stamp a 4x3 block at the top centre, away from their
`right` throne (`data/mapTemplates.json`).

**Node map.** `generateNodeMap` (`NodeMapGenerator.js:47`) runs on one seeded stream
(`_withNodeMapSeed`, `RunManager.js:4440`, called at `:718` and `:4466`). `buildBattleParams`
(`:516`) rolls 28% seize / 12% escape (`isElite`), `battleSeed` (`:598`), caravan and village
(always drawn, `:575-580`); `pickTemplateForNode` (`:614`) picks templates, boss nodes from the
whole seize pool. Later passes (recruits, colosseum, `rebuildNodeAs` `:360`, ambushes) rebuild
params; the Eclipse keeps a fallen battle's params as elite (`EclipseSystem.js:359`). Event
battles call `convertNodeToRoutBattle` in a seeded swap (`EventEffects.js:1071`).

**Measured** (scratch, 200 seeded node maps per act): Act III has about 3.5 non-elite rout
battle nodes in rows 2–7 (0.9 with a village) and 2.8 elite nodes; Act IV 4.7 and 1.6. One such
node lies on about 35% of root-to-boss paths. A procedural 24x14 seize config is about 2.4 KB.

## 2. The design in one paragraph

A **set piece** is a fixed-size map. It is assembled from:
- an authored **skeleton**: a macro grid of 4–6 cells, named anchors, objectives, encounter
  groups and a deploy region;
- **chunks** from a shared library: authored tile blocks with ports on their edges, which
  may be mirrored;
- **procedural fill** for the cells the skeleton leaves open.

Seeded **choices** (`oneOf`) pick chunks and toggle groups and bonuses, so each run meets a
different plan on the same named place. A new generator path makes an ordinary locked
`battleConfig` plus `setPiece`, `objectives`, `encounterGroups`, `anchors` and
`parRoute`; it is a standard battle whose enemies come from the act and rung. A validator
in `validate:data` proves every combination connected and inside 5–12 turns. A keyed
post-pass places set pieces without touching the node-map stream.

## 3. The format

### 3.1 Files

| File | Holds | Runtime copy |
|---|---|---|
| `data/setPieces.json` | `{ version, setPieces: [skeleton…] }` | `public/data/` by `sync-data`, as every data file |
| `data/mapChunks.json` | `{ version, legend, ports, chunks: [chunk…] }` | same |
| `difficulty.json` `modes.<rung>.setPieces` | placement chances per rung and Dusk's `maxSize` (§6.1) | snapshotted into `difficultyModifiers`, as `routLadder` |
| `src/data/setPieceContent.js` | telegraph lines, region labels for markers, the node card's line | — |

Two files, not one: chunks are shared across set pieces (a `ford_shallow` serves the Mill
Ford and later the Hunting Party), and a chunk edit must be validated against every set piece
that uses it. The validator reports each failure as `setPiece × combination × chunk`.

### 3.2 Chunks

```json
{
  "id": "ford_shallow",
  "size": [6, 6],
  "biomes": ["grassland", "swamp"],
  "rows": [". . ~ ~ . .", ". F ~ ~ F .", ". . , , . .", ". . , , . .", ". . , , . .", ". . ~ ~ . ."],
  "ports": { "n": "river6", "s": "river6", "w": "open6", "e": "open6" },
  "anchors": {
    "ford": { "rect": [2, 2, 3, 4] },
    "ford_far": { "rect": [4, 1, 5, 4] }
  },
  "transforms": ["mirrorX", "mirrorY", "rot180"],
  "tags": ["river", "crossing"]
}
```

- **Rows and legend.** The prologue's format: space-separated characters
  (`parsePrologueMap`, which this reuses). The shared `legend` in `mapChunks.json` maps one
  character to one `terrain.json` name: `.` Plain, `F` Forest, `M` Mountain, `T` Fort,
  `G` Throne, `#` Wall, `~` Water, `=` Bridge, `,` Bog, `S` Sand, `V` Village, `I` Ice,
  `_` Floor, `p` Pillar, `s` Swamp, `L` Lava Crack. A chunk may add a local `legend`, never
  redefine a shared character.
- **No Ballista character.** A ballista is an anchor with `"feature": "Ballista"`. The
  generator places it under today's rule (Nightfall+, not Act I, `MapGenerator.js:138`) and
  otherwise leaves the tile's own terrain.
- **Village terrain** may sit only on an anchor named in a `visit` bonus, so a decorative
  `V` can never become an unannounced objective.
- **Anchors are chunk-local.** Each is `{ at: [c,r] }` (a point) or `{ rect: [c1,r1,c2,r2] }`
  / `{ tiles: [[c,r]…] }` (a region), with an optional `feature` and `terrain` (a constraint
  the validator checks: a `throne` anchor must sit on Throne). Anchor names are roles
  (`ford_far`, `throne_w`, `drawbridge`). In every combination each name the skeleton uses
  must resolve exactly once.
- **Transforms.** `mirrorX`, `mirrorY` and `rot180` (both). A transform remaps tiles and
  anchors and swaps and reverses ports: `mirrorX` swaps `w`/`e` and reverses `n`/`s`. There
  is no 90° rotation, because cells are not square and terrain art reads in rows. A chunk
  lists the transforms it allows; the default is none.

### 3.3 Ports

`mapChunks.json` `ports` names edge profiles: strings over a port alphabet, one character
per tile along the edge (west to east, or north to south):

| char | the seam tile must be |
|---|---|
| `.` | passable for Infantry, Armored and Cavalry |
| `~` | Water |
| `#` | impassable for every ground move type |
| `*` | anything |

`"river6": "..~~.."` and `"open6": "......"` are examples. Rules:
- Two cells that share an edge must present the **same** profile name, after transforms
  (a reversed profile is its mirror's name, or the profile is a palindrome).
- A chunk's edge tiles must conform to the profile it declares.
- A fill cell takes the profile of the chunk it borders. Its seam tiles under `.` or `~` are
  written as that terrain, not rolled.

So a river that runs through three cells is continuous, and a road meets a road.

### 3.4 Skeleton

```json
{
  "id": "mill_ford", "version": 1,
  "name": "The Mill Ford",
  "lore": "The river turns the old mill. Two ways across, and the raiders know both.",
  "slots": ["ordinary"], "acts": ["act3"], "replaces": ["rout"],
  "objective": "rout", "biome": "grassland", "fog": false, "music": null,
  "grid": { "cols": [7, 6, 7], "rows": [6, 6] },
  "cells": [
    { "id": "w_n", "at": [0, 0], "fill": "bank" },
    { "id": "w_s", "at": [0, 1], "fill": "bank" },
    { "id": "r_n", "at": [1, 0], "chunks": ["bridge_wide", "bridge_narrow"] },
    { "id": "r_s", "at": [1, 1], "chunks": ["ford_shallow", "ford_reeds"] },
    { "id": "e_n", "at": [2, 0], "chunks": ["mill"] },
    { "id": "e_s", "at": [2, 1], "chunks": ["raider_camp"] }
  ],
  "fills": { "bank": { "terrain": { "Plain": 75, "Forest": 20, "Mountain": 5 },
                       "keepOpen": [[0, 2, 6, 3]] } },
  "anchors": { "deploy": { "rect": [0, 3, 2, 8] } },
  "choices": [
    { "id": "crossing", "options": [
      { "id": "bridge_north" },
      { "id": "bridge_south", "cells": {
          "r_n": [{ "chunk": "ford_shallow", "transform": "mirrorY" }, { "chunk": "ford_reeds", "transform": "mirrorY" }],
          "r_s": [{ "chunk": "bridge_wide", "transform": "mirrorY" }, { "chunk": "bridge_narrow", "transform": "mirrorY" }] } } ] },
    { "id": "village", "options": [
      { "id": "north" },
      { "id": "south", "cells": { "e_n": [{ "chunk": "raider_camp", "transform": "mirrorY" }],
                                  "e_s": [{ "chunk": "mill", "transform": "mirrorY" }] } } ] }
  ],
  "deploy": { "anchor": "deploy" },
  "encounterGroups": [ "… §10.1 …" ],
  "objectives": { "primary": [{ "id": "rout", "kind": "rout" }], "bonus": ["… §10.1 …"], "phases": [] },
  "parRoute": [ "… §8.3 …" ],
  "enemyCount": { "scale": 1.3 }, "overflow": "reserve",
  "huntedEntry": "reserve",
  "byRung": { "lunatic": { "groups": { "reserve": { "wake": [{ "kind": "turn", "afterContact": 2, "latest": { "parOffset": -2 } }] } } } }
}
```

- `grid` gives column widths and row heights; their sums are the size, inside the README's
  bands. A cell may `span`. A cell is a chunk-reference list (a name or `{ chunk, transform }`;
  the chunk must fit the cell exactly) or a `fill` id.
- **Skeleton anchors use map coordinates.** The size is fixed, so v1's problem (absolute
  coordinates on a rolled size) cannot occur; only chunk anchors are relative, because chunks
  move. `mirror: ["y"]` adds a whole-map mirror as one more choice.
- `slots` ⊆ `ordinary | elite | event | boss | finale`; `replaces` names the node objectives it
  may stand in for; `objective` is the legacy kind old readers see (`03`).
- **Boss slots** (`05` §8.3, §8.6) may carry `boss: { weights: { <boss name>: w } }`, the
  set piece's boss pick (§4.3; absent, every boss of the act's pool weighs 1), and
  `signatureOverride`, a boss kit `signature` (`05` §5) that replaces the kit's on this map.
  `signatureOverride` is allowed only on a set piece that pins its boss (one name with a
  weight above 0, or an act pool of one, as Act IV's Emperor), so the override always meets
  the boss it was written for (validated, with `05`'s kit checks).
- `byRung` patches groups, choices (`options[].rungs`) and bonuses from a rung up, the
  `events.json` `weightByRung` rule. `name`/`lore` follow the template rules (≤ 140
  characters); labels and lines live in `setPieceContent.js` under the lore style guide.

### 3.5 Choices

- A choice is one draw from `keyedBattleRandom(battleSeed, 'setpiece:<id>:choice:<choiceId>')`
  over its options' `weight` (default 1). Options whose `rungs` exclude the current rung are
  left out.
- An option may patch:
  - `cells`;
  - `groups`, by id: `enabled`, `region`, `state`, `wake` or `members`;
  - `bonus`, by id: `enabled`;
  - `anchors` aliases, e.g. `stoneBearer: "throne_e"`.
- After the choices, every cell whose list still has more than one entry draws its chunk on
  `'setpiece:<id>:cell:<cellId>'`.
- Choices are the **structure**: which crossing is good, which tower is near, which avenue the
  column takes. Chunk variants are texture inside a structure. Pillar 5 counts only the first.
  A set piece that ships needs at least two choices that change a decision (reviewed by
  playing opposite options twice, §11).

### 3.6 Procedural fill

A fill cell is painted with today's zone machinery, scoped to the cell:
- `fills.<id>.terrain` is a zone weight table. It goes through the same `weightedRandom`
  as `generateTerrain`, on the battle's seeded `Math.random`, cell by cell in row-major cell
  order.
- `keepOpen` rects (cell-local) are written as the biome's base passable terrain
  (`getFallbackPassable`, `MapGenerator.js:919`) after painting.
- Seam tiles follow §3.3.
- Optional `structures` reuse `applyStructures` (`:930`) with cell-relative rects.
- `ensureReachability` runs as today, but **may carve only fill tiles**. The validator has
  already proved the authored tiles connected (§8), so a carve in an authored chunk is a bug.
  It throws under the test-only `strict` flag and is skipped in play.
- No `MAX_FORTS` cap, cavalry carve budget or bridge minimum applies to set pieces. Their
  structure is authored.
- The toxic overlay and fog are off unless the skeleton sets `toxic` / `fog` (the brainstorm:
  big fogged maps fail).

### 3.7 Objectives and encounter groups

- **Objectives** are `03` §3's model (`{ version, primary, bonus, phases, parAdjust }`),
  written with anchor names and unit refs (`spawn.objectiveRef`) that the generator resolves.
  Kinds are `03`'s: primaries `rout`, `seize` (one or more `thrones`), `escape`, `defeat`,
  `assassinate`, `escort`, `capture`, `destroy`, the `protect` clause and the phase-only
  `survive`; bonuses (≤ 2) `visit`, `caravan`, `rescue`, `slay`, `protect`, `unbloodied`,
  `claim` (`03` renamed the bonus so it never shares a name with the `capture` primary),
  `reach`. A tile bonus may carry `03` §7.1's optional authored `race: { group, fastMov,
  slowMov }`, which only this spec's validator reads (§8.2 check 6). The skeleton's
  `objective` must equal `03`'s `legacyObjectiveKind(objectives)`.
- **Written only when it says more than the legacy derivation.** A set piece whose
  objectives are exactly what `03` §3.2 derives from the legacy fields (a rout, a
  one-throne seize or an escape, plus at most the village as `villageTile` or the caravan)
  writes no `objectives` into the config: the derived model is the same, its ids are the
  derived ones (`rout`, `village`), and the config stays playable by a client from before
  `03` PR 1. The skeleton still authors them, since the validator reads them (`race`,
  check 9). The Mill Ford is such a map (§10.1).
- **`objective` triggers always state `on`** in this spec's data (`done | failed |
  either`; it defaults to `done`, README §3).
- **`battleConfig.parRoute`** (README §3) is written for every set piece, whatever its
  primary: the legs of §8.3's cheapest plan on the locked layout (§4.2 step 10).
- Terrain changes are `03` phases' `onEnter.setTiles: [{ anchor, terrain }]` (§7). A phase
  may keep the same primary (by the same id) and exist only to change terrain and wake
  groups. Completing a primary that every later phase shares wins at once, in any phase,
  and the advance shows the phase's own `onEnter.line` band, not NEW OBJECTIVE (`03` §4,
  §6; `05` §4.5). Such a phase needs an `until`, which may be a list (any one fires).
- **Encounter groups** are authored here and written as `02` §3.2's schema
  (`{ id, members: [spawn indices], state, wake, onWake, route, loop, telegraph }`). The
  authoring form replaces `members` with `region` (an anchor, where they spawn) and `size:
  { min, max, share, weights?, promoted?, levelBonus?, classes? }` (§4.3), plus the
  skeleton's `overflow` group id. States are `02`'s `picket | dormant | patrol | awake`
  (README §3); `onWake` modes `hunt | guard | seek | retake` in `02` §3.7's shapes
  (`{ mode: 'seek', anchor, then }`, `{ mode: 'retake', point }`); a column is a `patrol`
  with `loop: false`.
- **A group that starts `awake` applies its `onWake` at battle start** (`02` §3.3, PR 2.1):
  the generator writes it onto the members' spawns, as `aiMode: 'seek_tile'` plus
  `aiTargetTile` for `seek`, exactly as the village's bandit wave carries them today
  (`VillageSystem.buildBanditScriptedWave`). The scene and the harness already copy both
  fields from any spawn (`BattleScene.addEnemyFromSpawn`, `:2638-2646`;
  `HeadlessBattle.js:958-966`), and `clearSeekTileBandits` already turns them to chase once
  the village resolves. So an awake seeker needs no patrol code (`02` PR 2.4).
- Arrivals are `02` §4's `triggeredWaves`, with `side: 'anchor:<name>'` where authored.
- Triggers are the README vocabulary as `02` §3.4 specifies it, anchors resolved at
  generation.

## 4. Generation: from set piece to locked config

### 4.1 Entry point

- A node holding a set piece carries `battleParams.setPiece = { id }`. The dev route may add
  `force: { choices, cells }`.
- `generateBattle` gains one branch at the top: `if (params.setPiece) return
  generateSetPieceBattle(params, deps)`. The scene, the harness and the sims all generate
  through `generateBattle` already, so all of them get set pieces with no second call site.
- `deps` gains `setPieces` and `mapChunks`. `HeadlessBattle._generateBattleConfig` passes an
  explicit list, so add the two there.
- If the id is unknown (data removed after a save), the branch logs a warning, deletes
  `setPiece`, restores the params `assign` overwrote from `battleParams.setPieceFallback`
  (`objective`, `hasVillage`, `fogEnabled`, §6.2) and falls through to the procedural path
  with the node's kept `templateId` (§6.4). Without the restore an elite node would play
  its seize template as a rout.
- `generateSetPieceBattle` lives in `engine/SetPieceGenerator.js` (pure, no Phaser). Its
  helpers live in `engine/SetPieceFormat.js` (parse, transform, assemble, resolve anchors,
  enumerate combinations), which the validator shares.

### 4.2 Steps

All of this runs inside the caller's `withBattleSeed(battleSeed)`.

1. Choices and chunk picks on their keyed streams (§3.5). A dev `force` wins; it is validated
   and refused outside dev.
2. Assemble: chunks with transforms, fills, the whole-map mirror. Resolve every anchor.
3. Features: Throne tiles come from chunks; `thronePos` is the first `seize` primary's throne,
   for legacy readers; Ballista anchors follow §3.2.
4. Player spawns: `deployCount` tiles of the deploy region, front edge first, ties by row then
   column, no draw. The rest become `formationSpares`, so `FormationController` takes its
   authored branch (`FormationController.js:197-205`).
5. Enemies (§4.3), then the gear chain unchanged (`assignCasterGear`, `assignEnemyCarry`,
   `assignAffixesToEnemySpawns`, `assignSwornAffix`, `assignEnemyAreaArts`, as at
   `MapGenerator.js:265-305`), keyed on `templateId: 'setpiece:<id>'`.
6. A `visit` bonus writes `villageTile` from its anchor; its raiders are the named group,
   so the procedural bandit wave (`calibrateBanditSpawn` / `buildBanditScriptedWave`,
   `MapGenerator.js:463-490`) is never built. No caravans or recruit NPCs in v1.
7. `ensureReachability` on fill tiles only (§3.6).
8. Write `objectives`, `encounterGroups` (resolved regions, routes, triggers), `anchors`
   (README §3: `{ <name>: { tiles } }`, a point being one tile), `setPiece`.
9. Waves: authored arrivals become `reinforcements.triggeredWaves` (`02` §4). No rout
   ladder (`ladder: false`) and no `assignHolders`: groups replace both, and rung pressure
   comes from `byRung`. Hunted writes its wave at the `huntedEntry` region's
   nearest edge through `withHuntedWave`, so a Hunted victory still counts
   (`RunManager.js:4067-4078`); ordinary and elite set pieces must declare `huntedEntry`.
10. Par route and par. The generator resolves the skeleton's `parRoute` (§8.3) on the
    locked layout at the rung's counts, keeps the cheapest of its `plans`, and writes that
    plan's legs as `battleConfig.parRoute` (each `to` an anchor name in
    `battleConfig.anchors`, each `group` a group id). Par is then `02` §5.2's `groups-v1`
    and nothing else: W walks `parRoute`, S counts the engagements on it, and `03`'s
    `parAdjust` (non-walk terms only: boss bars, survive turns, a structure's `parTurns`,
    escort pace) is added inside `groups-v1` in the order `02` §5.2 fixes (after the 0.8
    and the rung multiplier, before the rung's inflation, bonus and offset, `02`'s S
    floor `1 + W + parAdjust + bossTurns + 3` and the First Light cap). This spec adds no
    walk term of its own and `03` adds none either, so the walk is counted once. The rung
    pipeline (`parInflation`, `parOffsetConfig`, `:3129`) is the one `02` §5.2 lists. The
    same `parRoute` feeds the §8.3 estimate.

### 4.3 Enemies come from the act and the rung

- **How many** (`02` §5.1's budget). `base = rollEnemyCount(...)` with `enemyCountBonus: 0`
  (one draw, as today), so the deploy count, `enemyCountBase` and boss offsets act as on a
  procedural map. The total is `min(round(enemyCount.scale × base), 1.6 × base)` (`scale`
  default 1.3), split over enabled groups: each takes its `min`, the rest by `share` (largest
  remainder, ties on `'setpiece:<id>:split'`), capped by `max` and the region's standable
  tiles. The rung's `enemyCountBonus` then goes to the `overflow` group (default the picket).
  The members **awake at start** stay ≤ `base` by `02` §5.1's one rule (an enemy that can act
  against the army by the check of turn 2 whatever the player does; validated, check 7).
  Bosses and captains are extra, as today.
- **Classes and levels.** From `enemies.pools[act]` after `filterClassPoolByDifficulty` and
  `earlyEnemyAllowed`, through `weightedClassPick` with the group's `weights` and the pool's
  `promotedShare` (or `promoted: always | never`); `mapExtraNecromancer` holds map-wide.
  Levels are uniform in `adjustedLevelRange` (`:223-231`, the row range + `enemyLevelBonus`)
  + the group's `levelBonus`. Pinned `classes` must be in the act's pool or an enemy-only
  class the rung allows (`DIFFICULTY_GATED_CLASSES`).
- **Streams.** Each group's draws and seats (`scoreSpawnTile`, `:1654`) run in a scoped swap of
  `Math.random` to `keyedBattleRandom(battleSeed, 'setpiece:<id>:group:<groupId>')`, the
  `withEclipseSeed` pattern: the helpers need no RNG parameter, and editing one group never
  rerolls another.
- **Bosses and captains.** `enemies.bosses[act]` with `difficultyFilter`, `bossLevelBonus` and
  revival stones by `revivalStoneKind` (as `generateEnemies` at `:1992-2090`). On the
  set-piece path the boss is drawn on `keyedBattleRandom(battleSeed, 'setpiece:<id>:boss')`
  over the skeleton's `boss.weights` (§3.4), replacing `generateEnemies`' `Math.random`
  pick; the procedural path keeps its pick (`05` §8.3). The boss's kit is then compiled by
  `05`'s `BossKit.compile` into the config's fields, its courts named by `region`; elite slots
  from `eliteCaptains` with `isEliteCaptain` stones. Two captains are drawn without
  replacement on `'setpiece:<id>:captains'`. Every boss and captain spawn carries
  `isBoss: true`, as `generateEnemies` writes the throne boss (`MapGenerator.js:2046`; elite
  captains "still hold the throne as the map's boss", `:680`), so boss enrage, the boss bar
  and the boss AI treat them as today. A member a `slay` bonus names is never `isBoss`
  (§8.2 check 9).
- Every member carries `encounterGroupId`; group state is never a private flag (README §3).

### 4.4 Not a scripted battle

- The set piece path never sets `prologueChapter`, so `isScriptedBattle` stays false. The
  Eclipse gain, Guidance, contextual hints, deeds, commander last words, par, ratings, loot
  (elite loot on an elite node), carried items and Steal all run.
- `tests/ScriptedBattleSuppression.test.js` gains a set-piece row: every reader it drives
  must behave as in a standard battle.
- Readers that name a battle from `templateId` gain a set-piece branch through one helper,
  `setPieceForConfig`: `placeDisplay.js:11`, `slotCardModel.js:77`, `loomModel.js:530` and
  `FormationController.js:207`.

## 5. Determinism

| Draw | Stream | Moves any other draw? |
|---|---|---|
| which node holds a set piece, which set piece | `keyedBattleRandom(runSeed, 'setpiece:<act>:<purpose>[:<nodeId>]')`, after the node map is built | no: the node-map stream is finished, and no `Math.random` is called |
| choices, chunk picks | `keyedBattleRandom(battleSeed, 'setpiece:<id>:choice:<c>' / 'cell:<cell>')` | no |
| group composition and seats | `keyedBattleRandom(battleSeed, 'setpiece:<id>:group:<g>')`, scoped swap | no |
| a boss slot's boss | `keyedBattleRandom(battleSeed, 'setpiece:<id>:boss')` over `boss.weights` (§4.3) | no: the procedural pick on the battle stream is skipped on this path only |
| fill terrain, enemy count, affixes | the node's `withBattleSeed` stream, as every map | only this node's map, which is the set piece |
| caster gear, carry | their own hashes of spawns and `templateId` (`CasterGear.js:55`, `EnemyCarry.js:30`) | no |

- **Adding a set piece to the data** changes, at most, which set piece the one chosen node
  holds, or turns a node with no fitting set piece into one with a fit. The *choice of node*
  depends only on slot eligibility (§6.2), never on the set-piece list. No other node's
  `battleParams`, `battleSeed`, template or map moves.
- **Editing one option list** (adding a third crossing) changes that choice's draw only.
- **The locked config is self-contained.** It holds the resolved layout, spawns, anchors,
  groups and objectives, never chunk references to re-read. A later edit to
  `mapChunks.json` never changes a map already entered.

## 6. Where set pieces appear

### 6.1 Rules per slot

| Slot | Nodes | How often | Limits |
|---|---|---|---|
| **ordinary** | `battle` nodes, rows 2..`rows-3`, not elite, objective in `replaces` (rout), no caravan, not ambush or recruit; a village node only for a set piece with a `visit` bonus | a per-act chance, then one node | ≤ 1 per act |
| **elite** | `battle` nodes with `isElite` (seize/escape rows) whose objective is in `replaces` | each eligible node rolls its own chance | ≤ 2 per act |
| **event** | an event's `battle` effect names `setPiece` (§6.5) | always, when eligible for the act and rung | — |
| **boss** | the act's boss node, Act III and Act IV | a share of the boss pool | 1 (the boss) |
| **finale** | the `finalBoss` boss node on rungs whose finale is the Entity | a share | 1 |

- Two set-piece battle nodes are never joined by an edge, so a path never chains two long
  battles.
- A set piece offered in an earlier act of the run (`run.setPiecesOffered`, ids, saved) is
  skipped when another fits. (Deferrable: with one ordinary and one elite set piece in
  the first shipment it changes nothing, §14.)
- `fog` false (the default) deletes the node's `fogEnabled`. The fog roll was already drawn,
  so the stream does not move.

**Proposed rung table** (`difficulty.json` `modes.<id>.setPieces`; every rung needs an entry,
validated like the other rung tables):

| Rung | ordinary chance per act (III / IV) | elite chance per node | boss share (III / IV) | finale share | largest set piece (`maxSize`) |
|---|---|---|---|---|---|
| First Light | 0 / — | 0 | 0 / — | — (the Lieutenant) | — (none placed) |
| Dusk | 0.5 / 0.5 | 0.25 | **0 / 0** (owner decision, 2026-10-10) | — (ends at the Emperor) | **20x12** (owner decision, 2026-10-10) |
| Nightfall | 0.6 / 0.6 | 0.3 | 0.5 / 0.5 | 0 (Sanctum of Echoes is Black Sun's, `05` §8.2) | absent: README §2's bands |
| Black Sun | 0.7 / 0.7 | 0.35 | 0.5 / 0.5 | 0.5 | absent: README §2's bands |

First Light's runs have no Act IV (`difficulty.json` `normal.actsIncluded` is Acts I–III
and the final boss), so its Act IV cells are "—". With §1's node counts, a Nightfall route that ignored the tags would meet about 0.4 ordinary
and 0.5 elite set pieces in Acts III–IV, plus about one boss set piece. The tags let a player
seek them out or avoid them. (Why per act, not per node: Notes 2.)

**The rung ladder** (owner decision, 2026-10-10, README §6): no set piece on First Light;
on Dusk only ordinary, elite and event set pieces of standard size and no boss set piece;
every set piece from Nightfall, the finale variant on Black Sun only.
- **`maxSize: [cols, rows]`** is a rung gate. `pick` (§6.2) and the event hook (§6.5) leave
  out a set piece whose size exceeds either figure. Absent, README §2's bands bound the rung.
- **Validated** like First Light's zeros: the validator refuses a Dusk entry with a boss or
  finale share above 0, or with no `maxSize` or one above `[20, 12]`.
- **What Dusk meets:** The Mill Ford (20x12), Two Towers (20x12), Rival Band (18x10),
  Caravan Under Siege (20x12) and The Burning Village (18x12). Hunting Party (20x13) and
  Break the Gate (22x12) are over the size, so they are Nightfall and up as sketched;
  trimming Hunting Party to 20x12 would bring it to Dusk (a content decision for its PR).
  Act IV's ordinary slot has nothing that fits on Dusk until an Act IV ordinary set piece of
  that size exists; the keyed draw is still taken, so nothing moves.
- **Dusk's boss maps** are `05`'s kits on today's maps and the arena variants (`05` §9.5).
  A Dusk route therefore meets ordinary and elite set pieces only, and every board it meets
  fits the desktop at zoom 1 (`01` §5).

### 6.2 Assignment: a keyed post-pass

`engine/SetPiecePlacement.js` exports `assignSetPieces(nodeMap, ctx)`. It is pure. RunManager
calls it right after both `_withNodeMapSeed(generateNodeMap…)` sites (`RunManager.js:718`,
`:4466`) and never in a prologue run.

```
r(key) = keyedBattleRandom(runSeed, `setpiece:${act}:${key}`)()
boss:     if bossFits && r('boss') < bossShare            -> assign(boss, pick(r('boss-piece')))
ordinary: E = eligibleOrdinary(nodes) sorted by id
          if E && r('ordinary') < chance                  -> n = E[floor(r('ordinary-node')·|E|)]
                                                             assign(n, pick(fits(n), r('ordinary-piece')))
elite:    for n in eligibleElite(nodes) sorted by id, not adjacent to an assigned node:
            if count < 2 && r(`elite:${n.id}`) < p         -> assign(n, pick(fits(n), r(`elite-piece:${n.id}`)))
assign(n, sp): n.battleParams.setPieceFallback = { objective, hasVillage, fogEnabled }   (what assign overwrites)
               n.battleParams.setPiece = { id: sp.id }
               n.battleParams.objective = sp.objective     (03's legacyObjectiveKind; isElite unchanged)
               n.battleParams.objectivePreview = { primary: [kinds], bonus: [kinds] }   (03 §11)
               n.battleParams.hasVillage = sp has a visit bonus
               delete n.fogEnabled unless sp.fog
               (node.templateId is kept as the fallback)
```

- `pick` is weighted by each set piece's `weight`, after `acts`, `slots`, `replaces`, rung
  gates (the rung's `maxSize` included, §6.1) and `setPiecesOffered`.
- `05`'s arena post-pass (`BossKit.assignBossArenas`, `05` §4.4) runs right after this one
  at both sites, on its own keys; a boss node this pass gave a set piece keeps it.
- Every call builds a fresh keyed generator. There is no shared cursor, so the order of the
  passes cannot leak.
- Old saves are never re-assigned: `fromJSON` does not call it, and a run saved before this
  has no `setPieces` modifiers (no set pieces), as `routLadder` works today.

### 6.3 The route map tells the player

- `loomModel` (`:527-553`): the set piece's `name` is the place, its `lore` the line, plus a
  `Large map` tag (`tone: 'info'`, "About two screens. Several objectives.") and the primary's
  verb with "+ bonus". A boss card adds the set piece's name.
- `NodeMapScene` draws a pennant pip beside the elite aura.
- Choices are **not** shown: the deploy screen shows the whole board, and Pillar 5 is about
  meeting a different plan, not reading it on a card (open question 4).

### 6.4 Later changes to a node

- **The Eclipse** keeps a fallen battle's params and marks it elite (`EclipseSystem.js:359`).
  A set piece stays a set piece, with elite pay.
- **A route edit** (`rebuildNodeAs`) or a fallen *service* node rebuilds params, so the set
  piece is gone. The act may end with none. It is never moved to another node.
- **`hasVillage`** is rewritten by `assign` (no draw), so the Village tag tells the truth.
- **An unknown set-piece id on load**: the node plays its procedural template. Once a map is
  locked, its config needs no data.

### 6.5 Event battles

`events.json` `battle` gains `setPiece: "<id>"`:
- `applyBattle` (`EventEffects.js:1071`) runs `convertNodeToRoutBattle` exactly as today,
  inside the same seeded swap.
- Then, if the set piece fits the act and rung (the rung's `maxSize` included, §6.1), it sets
  `battleParams.setPiece` and the legacy `objective`. Otherwise the event fights its
  procedural rout, so the event still works on a rung where the set piece is gated.
- `EventValidation` checks that the id exists, that the set piece has the `event` slot, and
  that its acts cover the event's acts.

## 7. The hybrid arena contract v2

v1's three absolute pieces become relative:

| v1 (template) | v2 (set piece) |
|---|---|
| `arenaOrigin: [c,r]` on a rolled size | the arena is a chunk in a cell of a fixed-size skeleton |
| `anchors: { name: [c,r] }` global | chunk-local anchors, resolved at generation into `battleConfig.anchors` |
| `phaseTerrainOverrides[{ turn, setTiles }]`, absolute turns | `03` phases: `{ trigger, setTiles: [{ anchor, terrain }] }`, with triggers from the README vocabulary (contact- or par-relative) |
| `scriptedWaves.spawns[{ col,row }]` | `02` groups: dormant members already on the map, or `triggeredWaves` with `side: 'anchor:<name>'` |

**Runtime.**
- A v2 config carries resolved tiles only. Phase terrain changes **call** `02`'s
  `engine/TerrainPhases.js`, `applyTerrainSetTiles(grid, setTiles, anchors, { occupants })`,
  through `03`'s phases (`onEnter.setTiles`). `02` PR 0b creates the module and deletes the
  harness copy (`HeadlessBattle.js:1039`); this spec extracts nothing and adds no second
  terrain path.
- The module keeps v1's ordering (terrain first, then arrivals) and never writes terrain an
  occupant can't stand on; it returns those entries, which `03`'s phases record and skip
  (v1 hybrid overrides defer them instead, `02` §2.2).
- A phase's `until` and its `onEnter` effects (terrain, wakes) are evaluated and applied at
  `02`'s one enemy-phase check, in the `phase` slot after `objective` and before `turn`
  (README §3): the board never changes under the player's own turn.
- Fired phases ride the checkpoint, the rewind snapshot and the validator with `02`/`03`'s
  fired-trigger ledger. v1's `appliedHybridOverrideTurns` stays for v1 configs.

**Validation that v1 lacked.**
- A phase target may not lie inside any group region, wave tile or deploy tile.
- After every phase, the §8 connectivity checks pass on the changed layout.

That removes the class of bug the README reports: a wall raised on a wave's spawn tile, the
Phase 0 fix.

**Migration: none.** `act3_dark_champion_keep` and `act4_boss_intent_bastion` stay v1
templates with Phase 0's fix. Migrating would change their maps for the same seed, and old
locked configs carry `hybridArena` / `hybridAnchors` / `phaseTerrainOverrides`, so the v1
runtime stays anyway. Long Road and the Parade are v2 from the start. Recommendation for
README Q4: keep the v1 arenas at their share beside a 0.5 boss-set-piece share, and retire them
after a playtest round if players never pick them out.

## 8. The validator

`engine/SetPieceValidation.js`, `validateSetPiecesConfig(setPieces, mapChunks, gameData)`,
called from `tools/validateSchemas.js` beside the prologue and events validators
(`tools/validateSchemas.js:71-96`). It never throws and returns `{ valid, errors, warnings }`.

### 8.1 Per chunk

- The rows are rectangular and match `size`; every character is in the legend.
- Ports exist, have the edge's length, and the edge tiles conform to them.
- Anchors are in bounds, regions are non-empty, and `terrain` constraints hold.
- A `V` tile sits only on an anchor. Transforms are from the allowed set.

### 8.2 Per set piece × combination × rung

**Enumeration.** Combinations are the product over choices (options open on the rung) of
the product over each cell's remaining chunk list, times the whole-map mirror.
- More than **256** combinations is an error: bind cells to a choice instead. (The cap and
  its timing budget are deferrable for the first shipment: the Mill Ford has 16
  combinations. Two Towers' 192 bring them back, §14.)
- Per combination, the work is:
  - assembly;
  - 4 BFS per layout state (start, then after each phase; ~0.05 ms each at 24x16);
  - 4–8 route legs (§8.3) at 0.4 ms each (`turnsToReach`, measured at 24x16).
- That is about 3 ms per combination, under 1 s at the cap. The first four set pieces have
  16 + 192 + 8 + 8 = 224 combinations on Black Sun, about 0.7 s.

**Fill is taken at its worst.**
- A fill tile counts as impassable for move type M if any terrain in its weight table is
  impassable for M. The exceptions are `keepOpen` and seam tiles, which are fixed.
- So the proof holds for every roll of the fill, and the harness (§11) covers what the
  rolls actually make.

**Checks:**
1. Every anchor name resolves exactly once and in bounds. The size is inside the slot's band.
   Seams match their ports.
2. The deploy region has at least `DEPLOY_LIMITS[act].max + 2` tiles standable by
   Infantry, Armored and Cavalry: 9 in Act III, 10 in Act IV (`constants.js:71-78`: max 7
   and 8).
3. **Paths from the deploy region,** at start and after each phase in trigger order:
   - every primary anchor: `seize`, `defeat` and `capture` for each lord move type
     (Infantry, Cavalry, Flying: `lords.json` has all three); `escape` exits for all four
     (`ESCAPE_TILE_MOVE_TYPES`);
   - every group region for Infantry, so a rout can be completed;
   - every bonus anchor for Infantry.
   - A path may need a phase to open it only if that phase's trigger has a turn fallback.
4. **Groups:**
   - each region seats its `max` members for every class its weights allow;
   - a patrol or column route is walkable for its members' move types;
   - regions do not overlap the deploy region or each other.
5. **Overlaps:** no phase target in a group region, wave tile, deploy tile or primary anchor
   (§7). No feature anchor (Throne, Ballista, Village) under a group seat.
6. **Races** declared by a tile bonus (`race: { group, fastMov, slowMov }`, `03` §7.1's
   optional authored field; `03`'s validator checks only its shape): a unit at `fastMov`
   reaches the anchor before the group's arrival phase, and one at `slowMov` does not. The
   arrival phase is the enemy phase in which the group's `seek` path, at its slowest
   member's MOV, first ends on the anchor. The check is static (`turnsToReach` on the
   assembled layout) and needs nothing at runtime: no visit derivation (`03` PR 3) and no
   race state in battle. The race is part of the design, so the validator holds it.
7. **The turn band** (§8.3): the estimate is in [5, 12] for every combination and rung, and
   the spread across combinations is ≤ 2 turns per rung. `02` §5.1's budget holds at the
   rung's smallest and largest base: the members awake at start, by `02` §5.1's one rule
   (cited, not restated here), ≤ base, and the total ≤ 1.6 × base.
8. **References:** chunk, fill, choice, group and objective ids exist; `03`'s objective
   validator passes on the resolved model (≤ 2 bonuses, legacy kind, refs). Classes are allowed
   for the acts and rungs. `byRung` keys are rungs. Every slot requirement holds
   (`huntedEntry` for ordinary and elite).
9. **A bonus never fights the primary** (`03` §7.2's two rules, on every combination and
   rung):
   - on a map whose primaries are all kill-shaped (`rout`, `defeat`, `assassinate`: the
     legacy `rout` family), every tile bonus's anchor (`visit`, `rescue`, `claim`, `reach`)
     has a walk (`turnsToReach` from the deploy region, MOV 4 Infantry) at most the last
     `parRoute` leg's target's walk. The last kill ends the battle at once, so a bonus past
     it would ask the player not to win;
   - a `slay` bonus never names a primary's target or a throne's guard (for `'@boss'`, any
     `isBoss` spawn).
   The Mill Ford (the mill 4–5 turns, the reserve 5–6) and Two Towers (the armoury inside
   the first tower, every combination) hold the first rule; the Parade's `slay` names a
   General who is no throne guard (§10.4). Revision 1's Two Towers armoury, behind the far
   tower's back door, is the failure this check catches (test 20).

### 8.3 The turn estimate (pure)

`estimateSetPieceTurns(config, parRoute)` walks `parRoute`, a list of legs, and keeps the
cheapest of its `plans` when a set piece names alternatives (Long Road's gate or postern):

```
leg = { to?: anchor, group?: id, meet?: true, extra?: n }
walk(leg)  = turnsToReach(from, to, MOV 4, Infantry) − 1     (0 when meet: the group comes to you)
fight(leg) = ceil(members(group, rung) / 3) + extra           (bosses: 1 + revival stones; seize: +1)
estimate   = Σ walk + fight, from the deploy region
```

- MOV 4 Infantry is the seize floor's slowest lord (`SeizeParFloor.js:17-20`).
- Three kills a turn is a 6–8 unit army's rate in today's harness battles (18x13 routs end in
  4–7 turns with 10–11 enemies and 2–3 turns of walking).
- The estimate is the turn the battle ends: a leg arrives during turn `turnsToReach`, so
  its fight starts that turn (a walk of t − 1 plus a fight of f ends on turn t − 1 + f).
- `02` §5.2's W is the same Σ walk over the same written `parRoute` (its `walk(leg)` is
  this one), so par and the estimate cannot disagree about the walk.
- **The parRoute written** (§4.2 step 10) is the cheapest plan's legs, with `plans`
  resolved away; on rout and `defeat` maps its first leg's target is also `03` §7.5's
  primary anchor for a bonus's detour.
- The validator checks the estimate, not par. One extra assertion: on every rung, the locked
  par (`02` §5.2's `groups-v1`, `parAdjust` inside it) is at least the estimate + 3, so a
  direct push can reach an S. `02` §5.2's own floor (`1 + W + parAdjust + bossTurns + 3`,
  the arrival turn plus the boss plus S's 3) equals the estimate + 3 on a one-leg seize
  (walk t − 1, the boss, the Seize turn) and is lower wherever fights stand on the route,
  so this assertion is the stronger one and holds the fights too.

## 9. The catalogue

| # | Brainstorm concept | Verdict | Reason |
|---|---|---|---|
| 1 | The Mill Ford | **keep** (Phase 4) | the cheapest real decision: one river, two crossings, a race for the mill |
| 2 | Caravan Under Siege | **keep** (Phase 6) | reuses the Merchant Caravan's walk (`CaravanSystem.advanceCaravan`); the README names it for events |
| 3 | Two Towers | **keep** (Phase 4) | multi-target, no new terrain; elite captains exist |
| 4 | Break the Gate | **keep**, absorbs #9 and #14 (Phase 6) | one "structure with HP" engine need serves all three; ballistae as capture points become its choice |
| 5 | The Burning Village | **keep**, fire spread cut (Phase 6) | three villages under the existing raze machine; spreading fire is a new hazard system for one map |
| 6 | Hunting Party | **keep** (Phase 6) | `defeat` with an escape tile; pays off Hunted and Sworn Enemy |
| 7 | The Ice Causeway | **cut** | an endless-pursuit escape on a large map is the walk problem; slides make the estimate unreliable; procedural tundra escapes exist |
| 8 | Hold the Pass Until the Signal | **cut** as a map; its phase switch lives on in Long Road's sally | defend-for-N is the turtle the Dusk work removed |
| 9 | The Siege Engines | **merged** into #4 | capture-the-ballista is a choice of Break the Gate |
| 10 | Night at the Monastery | **deferred** (small set piece) | fog belongs on small maps; the format supports 16x12 later |
| 11 | The Deserters' Camp | **deferred** | needs a faction flip; a payoff for the Deserters' Revenge event, after Phase 6 |
| 12 | Long Road to the Keep | **keep** (Phase 5) | Act III boss, hybrid v2 |
| 13 | The Emperor's Parade | **keep** (Phase 5) | Act IV's only boss gets a second shape |
| 14 | The Bridge Must Fall | **merged** into #4 | same engine need as the gate; one destroy map first |
| 15 | Sanctum of Echoes | **keep** (Phase 6, Black Sun; `05` §8.7) | the finale variant; capture points that weaken the Entity |
| 16 | Rival Band | **keep** (Phase 6) | the cheapest elite: no new engine needs (18x10: Notes 5) |

The kept ones:

| Set piece | Size | Slot | Primary / bonus (`03`) | Groups and triggers (`02`) | Choices | Reuses | New engine needs |
|---|---|---|---|---|---|---|---|
| The Mill Ford | 20x12 | ordinary III | rout / `visit` the mill (race) | ford picket (`picket`), bridge hold (`dormant`: `danger`, `hurt`), mill guard (`dormant`: `groupWoken` bridge, `danger`, `hurt`), raiders (`awake`, `seek` village, written on the spawns), reserve (`dormant`: `danger`, `hurt`, `objective` village `on: done`, `turn parOffset −3`) | crossing N/S; mill N/S; bridge and ford variants | VillageSystem raze, Ballista feature | none beyond `02`/`03` |
| Two Towers | 20x12 | elite III–IV | `defeat` both captains / `reach` the armoury inside the first tower | road patrol (`patrol`), two garrisons (`dormant`: `danger`, `hurt`, `objective` the other captain `on: done`) | tower rows (4); fillers; armoury tower; stone bearer (Black Sun) | `eliteCaptains`, stones, `03`'s per-unit `clampTile` | none beyond `02`/`03` |
| Long Road to the Keep | 22x14 | boss III (Nightfall+) | seize / `claim` the gatehouse ballista, `05` §8.3 (the `reach` armoury stays authored as the fallback where no ballista is placed) | road picket, outer camp (`dormant`), gate and throne guards (`dormant`), sally (`dormant`: `groupWoken` camp, `turn parOffset −4`); phase *drawbridge* on the sally's trigger | road ridge/marsh; postern N/S; variants | throne clamp, actBoss stones | `TerrainPhases` (`02` §2.2) |
| The Emperor's Parade | 24x14 | boss IV (Nightfall+) | seize / `slay` the standard-bearer (a column General, not the guard) before the column would be seated | column (`patrol`, `loop: false`, route to the throne), two side pods (`dormant`: `groupWoken` column), palace guard (`dormant`), gate wave (Nightfall+, `triggeredWaves` `afterContact 3`) | avenue or north street; strong flank; palace variant | emperor stones, `02`'s column, `tile by: group` | the clamp waits for a marching column (§10.4) |
| Caravan Under Siege | 20x12 | event, ordinary III | `escort` the caravan / `slay` the raid captain | ring (`picket`), two flank waves (`triggeredWaves`, side relative to the caravan) | exit edge; start chunk; chaser weights | CaravanSystem, `03`'s `advanceEscort` | none beyond `03` |
| Hunting Party | 20x13 | elite III | `assassinate` the target / `unbloodied` | the target's escort (`dormant`, `onWake: seek` exit), lane pickets (`sight`, `danger`) | 2–3 lanes; exit edge; escort class | `03`'s `calibrateFlight` | none beyond `03` |
| Break the Gate | 22x12 | ordinary/event IV | `destroy` the gate, then seize (phases) / `claim` a ballista | outer pod (`picket`), inner `dormant`, sally `turn parOffset −2` if not breached | gate L/C/R; postern; ballista side; bridge segments | `03`'s Gate and Strike | none beyond `03` |
| The Burning Village | 18x12 | event II–III | rout / `rescue` 2 of 3 villages | raider bands per village (`awake`, `seek`) | which villages; raider classes | VillageSystem | several villages on one map (`03`'s `rescue`) |
| Rival Band | 18x10 | elite III–IV | rout / — | one band (`dormant`: `danger`) | fort sides; band composition | elite captain | none |
| Sanctum of Echoes | 24x16 | finale (Entity, Black Sun) | `defeat` the Entity / `claim` 2 of the pillars, a feat (`05` §6) | pillar wardens (`dormant`), echoes (`triggeredWaves`) | which pillars are lit; approach chunks | Entity footprint and AI | held pillars weaken the Entity |

`05` §8 adds two boss set pieces to this catalogue, the Dueling Halls (Act III, 22x12) and
the Battery (Act IV, 24x14, Nightfall+), refines Long Road, the Parade and Sanctum of Echoes
(below and `05` §8.3, §8.4, §8.7), and lists them in `05` §8.8.

**By rung** (§6.1, owner decision 2026-10-10): every boss set piece is Nightfall and up, and
Sanctum of Echoes Black Sun only. Dusk takes the kept maps of 20x12 or less (The Mill Ford,
Two Towers, Rival Band, Caravan Under Siege, The Burning Village); Hunting Party (20x13) and
Break the Gate (22x12) wait for Nightfall as sketched. First Light takes none.

## 10. The first four

The four phase 4–5 maps. Each sketch is one combination printed by the scratch assembler.
Turn figures are the §8.3 estimate at Nightfall counts. Rung differences come from the
count rule (§4.3) unless listed.

### 10.1 The Mill Ford (Act III ordinary, 20x12)

```
macro grid (cols 7|6|7, rows 6|6)        combination: bridge north, mill north, wide bridge, shallow ford
+--------+-------+--------+               0         1
| w_n    | r_n   | e_n    |               01234567890123456789
| fill   | bridge| mill   |            0  ..F......~~.F...M...
| deploy | /ford |  /camp |            1  .........~~..F..VT..   V = mill (anchor village)
+--------+-------+--------+            2  .F......T==.........   bridge, garrison on its far end
| w_s    | r_s   | e_s    |            3  .........==T.....#..
| fill   | ford  | camp   |            4  ....F..F.~~...F..#..
| deploy | /bridg| /mill  |            5  .........~~.........
+--------+-------+--------+            6  .........~~.........
deploy region: cols 0-2, rows 3-8      7  ..F.....F~~F...F....
                                       8  .........,,.........   , = the ford (Bog)
                                       9  .........,,....T..F.   T = raider camp
                                      10  ....F....,,.........
                                      11  .........~~..F......
```

**Decision.** Cross as one at the bridge into its garrison, or split. The ford costs 2 per
tile (3 for horses and armour), but it leads straight to the raiders. And a fast unit must
reach the mill before the raiders do.

**Groups** (Nightfall Act III, deploy 7: base 10–11, about 15 in all):

| Group | Region | Members | Start | Wake |
|---|---|---|---|---|
| ford picket | `ford_far` | 2 | `picket` | — |
| bridge hold | `bridge_far` | 4 | `dormant` | `danger`, `hurt` |
| mill guard | `village` | 3 | `dormant` | `groupWoken: bridge_hold` (delay 1), `danger`, `hurt` |
| raiders | `camp` | 3 | `awake`, `onWake: { mode: 'seek', anchor: 'village' }`, applied at battle start | — |
| reserve | `reserve` | 3 | `dormant` (the `overflow` group) | `danger`, `hurt`, `objective: { id: 'village', on: 'done' }` (delay 1), `turn: parOffset −3` |

- **The raiders start awake** with their `onWake` written onto their spawns at generation
  (`aiMode: 'seek_tile'`, `aiTargetTile` the mill), as the village's bandit wave carries it
  today (§3.7, `02` §3.3). When the mill is visited or razed they turn to chase
  (`clearSeekTileBandits`). No patrol code (`02` PR 2.4) is needed.
- **The reserve taxes the bonus once.** Taking the mill wakes it one enemy phase later; a
  razed mill does not (`on: 'done'`), so losing the race is not paid for twice. Revision 1
  also woke it on `tile: village`, which charged the same visit twice; that wake is gone.
  The `turn parOffset −3` clock wakes it whatever the player does, so a turtle meets it
  too. `danger` and `hurt`, as on every procedural pod (`02` §3.5), mean the reserve can't
  be picked off one member at a time.
- **The ids are the derived ones.** The Mill Ford is a rout plus the village, exactly what
  `03` §3.2 derives, so it writes no `objectives` (§3.7) and the trigger names `03`'s
  derived bonus id `village`.
- **Until `02` PR 2.2b and `03` PR 4,** nothing emits `objective` events. PR C's data
  therefore ships the reserve without the `objective` wake (it wakes on `danger`, `hurt`
  and its `turn parOffset −3` clock); the PR that brings both adds it to `setPieces.json`
  with a skeleton `version` bump. Configs already locked keep their wakes. The slice's
  playtest therefore prices the mill one wake cheaper than the finished map.

**Bonus.** `visit` the mill (village gold plus the act's convoy item, as `VillageSystem`
pays). The raiders reach it in their third enemy phase. Of the player's units, a MOV 6 rider
or flier gets there on turn 3; MOV 5 and infantry arrive on turn 4 and must kill the raiders
instead. That is `race: { group: 'raiders', fastMov: 6, slowMov: 5 }` (`03` §7.1's
optional field, held by §8.2 check 6). The mill lies before the last par-route target on
every combination (mill walk 4–5 turns, the reserve 5–6), so check 9 holds.

**Estimate.** 16 combinations: 9–11 by the bridge (the ford plan is 11–13 and is not the par
route). All four move types reach every anchor.

**Rungs:**
- First Light: not placed (table §6.1).
- Dusk: as above with Dusk counts.
- Nightfall: the Ballista anchor on the mill is live.
- Black Sun: the reserve also wakes at `turn afterContact 2` (`latest: parOffset −2`).
  This is a `byRung` patch and an `afterContact` clock (`02` PR 2.2b), so it waits for both;
  until then Black Sun plays the base wakes with Black Sun's counts.

### 10.2 Two Towers (elite, Acts III–IV, 20x12)

```
macro grid (cols 7|6|7, rows 6|6)       combination: west tower north, east tower north (same row)
+--------+--------+--------+             .#####...F....#####.     G = captain on a throne
| w_n    | m_n    | e_n    |             .#_G_#........#_G_#.     each tower: a side gate facing
| tower/ | cross  | tower/ |             .#_p__........__p_#.     the middle and a back door
| filler | deploy | filler |             .#___#..F.....#___#.
+--------+--------+--------+             .##_##........##_##.
| w_s    | m_s    | e_s    |             ....................
| tower/ | cross  | tower/ |             ...#............#...     filler: rubble
| filler | deploy | filler |             .#............#.....
+--------+--------+--------+             .....#.....F......#.
deploy region: cols 7-12, rows 4-7       ..#............#....
(the army arrives between the towers)    .....#............#.
                                         .#.......F....#.....
```

**Decision.** Which tower first. The player starts in the middle, so the other garrison is
at their back.
- Both garrisons hold until disturbed.
- Defeating the first captain wakes the other garrison (`objective` trigger), which sallies
  toward the player: one front at a time, by the player's choice (Pillar 4).
- The diagonal layouts make the second walk longer: 4 versus 6 turns throne to throne.

**Groups:**

| Group | Members | Start | Wake |
|---|---|---|---|
| road patrol | 2 | `patrol`, route between the gates | — |
| garrison W | 3 | `dormant` | `danger`, `hurt`, `objective: { id: 'captain_e', on: 'done' }` |
| garrison E | 3 | `dormant` | `danger`, `hurt`, `objective: { id: 'captain_w', on: 'done' }` |
| captains | 2 | `dormant`, each with its own `clampTile` (`03` PR 1b) | as their garrison |

- **The road patrol is a real `patrol`** (`02` PR 2.4): it walks the road between the two
  side gates, so the middle is not a safe staging ground, and its route is the one place
  the format's patrols are proved before the Parade's column needs them. It is in the
  estimate as an awake group that meets the army, so a `picket` in its place would play
  the same estimate; that is the fallback if PR D must ship before 2.4.
- **Boss enrage is the map's anti-turtle.** The captains are elite captains, `isBoss: true`
  (§4.3), so `TurnPressure` sees a living boss (`hasLivingBoss`, `TurnPressure.js:54`) and
  enrage applies from `getBossEnrageTurn(par)` (`TurnBonusCalculator.js:180`). Enrage wakes
  every dormant and patrol group (`02` §3.4), so both garrisons sally at once on that turn
  whether or not the player has touched them. Today that is `min(12, par + 2)`; with
  `02` PR 0a it is never before par + 1, and at Two Towers' par (at least the estimate
  + 3, so 12–14) it is **par + 1**. Waiting between the towers therefore buys nothing but
  both fronts at once. The 3-phase anti-turtle never wakes a group (`02` §3.4), so enrage is
  the only battle-wide clock here.

**Choices:**
- tower rows: both north, both south, or the two diagonals;
- the filler shared by the two non-tower side cells (courtyard, rubble or orchard);
- a tower chunk variant per tower (two interiors with the same gates);
- which tower holds the armoury (the `reach` bonus: a cache in that tower's back room,
  inside its walls, behind the pillar);
- the stone bearer, on Black Sun only, where `eliteCaptain` stones are 1; on other rungs
  the stones are 0 and the choice is not offered.

That is 4 × 3 × 4 × 2 = 96 combinations, 192 on Black Sun.

**Estimate.** 9 (same row) to 11 (diagonal), from the best order (revision 2's scratch
assembler, with the two final interiors: 96 combinations, all four move types reach both
thrones and the armoury).
- On every combination the two orders tie, and the par route takes the armoury tower
  first (the tie-break), so `parRoute`'s first leg is the armoury tower's captain.
- A first sketch with a south-gate tower variant measured 9–12. The validator would refuse
  it, since the spread was 3, so the gate variants were dropped.
- An earlier sketch with the towers in the east and deploy in the west measured 14–15 in
  the best order, above the band. That is why the army now starts between the towers.

**Primary.** Two `defeat` objectives, `captain_w` and `captain_e`, both required (legacy
`rout`), so each fall emits its own `objective` event for the other garrison's wake. Not
`03` §5.2's double seize: a lord would have to walk throne to throne (4–6 turns), which puts
the estimate at 12–14.

**Bonus.** `reach` the armoury, inside the first tower's walls.
- **Why it moved.** Revision 1 put the armoury behind the far tower's back door. Victory is
  taken on the second captain's fall (`03` §4), so the cache sat past the last target: the
  player had to hold off winning to take it. `03` §7.2's rule and §8.2 check 9 now refuse
  that. In revision 2 the cache is inside a tower, so it is always reached before that
  tower's captain falls, whichever order is played: on the way in as the first tower, or
  on the way to the last captain otherwise. On every combination its walk from the deploy
  region (2 turns for the slowest lord, scratch) equals the last captain's (2), so check 9
  holds with no margin to spare: a later chunk that pushes the cache deeper fails it.
- **Why not `unbloodied`.** It also fits the rule, but it has no place, so it adds nothing
  to the map's one decision. The armoury does: a seeded choice of tower that pulls the
  army toward one front first (Pillar 5).
- **Cost.** A unit spends its action inside the garrison's reach, on a tile off the
  gate-to-throne path. The strip says about 1 turn (`03` §7.5's minimum for a tile bonus;
  the detour measures under one turn).
- Reward: the act's item (`03` §7.4). It needs `03` PR 3 and PR 5; the map can ship first
  without its bonus (§14).

### 10.3 Long Road to the Keep (Act III boss, 22x14, hybrid v2)

```
macro grid (cols 6|6|10, rows 7|7)       combination: ridge road, postern north (before the drawbridge drops)
+-------+--------+-----------+           ......MMFMMM~#########
| a_n   | m_n    |           |           ..F.........~#__p___p#
| fill  | ridge/ |   keep    |           ......M..MM.==_#___T_#   == postern (1-wide)
| deploy| crags  | (10x14,   |           ....F.......~#_#_____#
+-------+--------+  spans    |           ......MM.M..~###__p__#
| a_s   | m_s    |  2 rows)  |           .F....M.....~#T______#
| fill  | fen/   |           |           ......MMM..M~~_____G_#   ~~ raised drawbridge -> == on the sally
| deploy| marsh  |           |           ......,F,,F,~~_______#   G = the act boss
+-------+--------+-----------+           ...F..F,,F,,~#T______#
                                         ......,,F,,F~###__p__#
                                         ......,F,,,F~#_______#
                                         .F...FF,,F,,~#__p___p#
                                         ......,,,F,,~#_______#
                                         ......F,,,F,~#########
```

**Decision.** Squeeze through the one-tile postern now, or break the outer camp and take the
wide gate once the garrison lowers the drawbridge to sally.
- **Phase `drawbridge`** (`03` §6, same seize primary): `until` is a list, whichever comes
  first (`03` §6): `[{ kind: 'groupWoken', group: 'outer_camp', delay: 1 }, { kind: 'turn',
  parOffset: -4 }, { kind: 'bossBar', broken: 1, fallback: { kind: 'bossHp', below: 0.5 } }]`
  (the last from `05` §8.3: breaking the boss's first bar from the postern side opens the
  gate behind you). The next phase's `onEnter` sets `drawbridge` (4 tiles) from Water to
  Bridge, wakes `sally` (the kit's `posterns` court when the boss is the Iron Wall, `05`
  §8.3) and shows its own band. Both the `until` and the `onEnter` effects resolve at `02`'s
  enemy-phase check (the `phase` slot, README §3), through `02`'s `applyTerrainSetTiles`.
- **Both phases carry the one seize by the same id**, so a lord who comes through the
  postern and seizes before the drop wins at once; the drop never enters (`03` §4's shared
  primary).
- **The boss** is drawn by `boss: { weights: { 'Iron Wall': 3, 'Blade Lord': 1, 'Berserker
  King': 1 } }` (§3.4, `05` §8.3): the keep is the Holder of the Breach's map; the other two
  can hold it.
- The sally group already stands dormant in the courtyard. It wakes; nothing spawns. So the v1
  wall-on-spawn bug cannot happen, and the validator would refuse a target under a seat.
- Fliers can cross the moat and the gate pit before the bridge drops.

**Groups:**

| Group | Members |
|---|---|
| road picket (`picket`) | 2 |
| outer camp (`dormant`: `danger`, `hurt`) | 3 |
| gate guard (`dormant`) | 2 |
| sally (`dormant`, `onWake: { mode: 'seek', anchor: 'gate' }`, the `overflow` group) | 3 |
| throne guard (`dormant`) | 2 |
| boss | from `bosses.act3`, actBoss stones |

**Estimate.** 8 combinations (road ridge or marsh × postern north or south × the variant of
the good road): 10–11, as the cheaper of the gate and postern plans (gate 11; postern 10–12).
- The first sketch was 24 wide and measured 11–13. With the marsh road and the postern
  north, it also cut **Cavalry and Armored off the throne** until the bridge dropped. The
  validator's check 3 catches exactly that: the drawbridge trigger has a turn fallback, but
  lords must reach a primary anchor at start.
- The 22-wide version gives the crags a goat track, and all four move types reach the throne
  at start.

**Rungs:**
- Placed on Nightfall and Black Sun only (§6.1, owner decision 2026-10-10).
- Stones: 1 on both (`actBoss`), so the boss leg is +1. Black Sun's extra members go to the
  sally, which comes to the player, so the estimate stays ≤ 12.
- The sally fallback is `turn parOffset −5`.
- **Bonus** (`05` §8.3): `claim` the gatehouse ballista (under §3.2's Ballista anchor rule,
  which places it on every rung this map meets; it covers the moat). The `reach` armoury,
  written for Dusk before Dusk lost boss set pieces, stays authored as the fallback should
  the ballista not be placed.

### 10.4 The Emperor's Parade (Act IV boss, 24x14)

**Why this one.** The Emperor is Act IV's only boss (`enemies.json` `bosses.act4`): every run
that reaches Act IV fights him, and on Dusk it is the last battle (fought there on today's
maps with his kit, never the Parade: §6.1). Only the bastion (about 17% of Act IV boss maps)
gives that fight a shape today. It is also the first map to prove a
*moving* objective (`02`'s routed group), which Caravan Under Siege and Hunting Party reuse.

```
macro grid (cols 8|8|8, rows 7|7)        combination: avenue route, parade-ground palace
+--------+---------+--------+             .#..#.F.##########.##.##
| nw     | n       | ne     |             .#....#.#_T_G_T##..#...#   G = the empty throne
| houses | palace  | north  |             ...##...#______#...#.#..
|        | (throne)| street |             .F....#.#_p__p_#.##...#.
+--------+---------+--------+             ..#.....###__###........   palace gate (steps below)
| sw     | s       | se     |             ....#......__....#.##.#.
| old    | market  | south  |             ........................   the avenue (rows 6-7, a port
| quarter| square  | streets|             ........................   profile shared by four cells)
| deploy |         | + gate |             ..F.#....p..p..T.#.##.#.
+--------+---------+--------+             ...................#....
deploy: cols 1-4, rows 8-12               .#.......T..p..p.##..#.#
column: east gate, cols 20-23, rows 6-7   ....F.#.............#...
                                          .........#..#..#.#.....#
                                          .#..#...........##.##.##
```

**Decision.** Pick your ground.
- The column (the Emperor and his honour guard) marches from the east gate to the palace and
  reaches the steps in its third enemy phase (Armored MOV 4: 3 turns by either route).
  Infantry from the old quarter reach the steps on turn 3.
- **Storm the palace first:** take the forts at the steps and fight the column as it arrives.
  Estimate 8.
- **Intercept on the avenue:** fight the Emperor off the throne, in the open, with both side
  pods joining. Estimate 11.
- **Let him sit:** he takes the throne's bonuses and his guard becomes a hold pack.
- The column is `02`'s `patrol` with `loop: false`: at the throne it stops and holds.
  **Seated is a wake, not a phase** (`05` §8.4): the palace guard wakes on `{ kind: 'tile',
  anchor: 'throne', by: { group: 'column' } }` (`02` §3.4), and the Emperor's `clampTile`
  engages on arrival through the clamp gate below, which needs no phase. The phases are his
  bars (`05` §7.4, §8.4: `until: bossBar broken 1`, then the last bar), so an intercepted
  column, which never seats, never leaves the phase machine waiting. Seize holds throughout:
  Seize needs no living `isBoss` (appendix §1.2), so a lord cannot take the empty throne and
  win.

**Groups:**

| Group | Members | Behaviour |
|---|---|---|
| column | Emperor + 3: the standard-bearer (a General, `objectiveRef: 'standard_bearer'`, never `isBoss`) and two of General / Paladin | `patrol`, `loop: false`, `route: [gate, avenue_mid \| north_street, steps, throne]`; wakes to `hunt` on `danger`/`hurt` |
| side pod N | 2–4 | `dormant`: `groupWoken: column` (delay 1) |
| side pod S | 2–4 | `dormant`: `groupWoken: column` (delay 1) |
| palace guard | 2 | `dormant`: `tile` on `throne` `by: { group: 'column' }` (seated); bar 1 also wakes it (`05` §8.4) |
| gate wave | 2 | Nightfall+, `triggeredWaves` `afterContact 3` (`latest: parOffset −2`), `side: 'anchor:east_gate'` |

**Choices:**
- the route (avenue or north street);
- the strong flank (pod sizes 4/2 or 2/4);
- the palace variant (parade ground or gardens).

That is 8 combinations. (Revision 1 also listed a start delay, "T2 on First Light"; First
Light runs have no Act IV, so the column marches from turn 1 on every rung that meets it.)

**Bonus.** `slay` the standard-bearer before the column would be seated (gold + forge
step, `03` §7.4; on Act IV the reward choice may lock `vision: 1` instead, `05` §8.4).
- **Why not the Emperor** (revision 1). He is the throne's guard (`'@boss'`): killing him is
  a step of the primary, so a bonus on him paid twice for the push par already rewards,
  and it pulled only toward storming the palace, deciding the map's one choice. `03` §7.2
  now refuses a `slay` on a primary's target or a throne's guard (§8.2 check 9).
- **Why not `protect` the market square's villagers.** It would need `03`'s `npcAllies`
  and `ObjectiveNpc` (deferred with escort), and a third thing to defend in the market
  beside the column and the pods breaks Pillar 4's two fronts.
- **The deadline.** `byTurn` is locked at generation to the turn the column would take the
  throne unopposed: its Armored members (MOV 4) reach it in their 4th enemy phase by
  either route (scratch, both palace variants). So `byTurn` is 4, the strip reads "by
  turn 4", and the bonus fails when the player phase of turn 4 ends with him alive.
  (`03` §7.1's default is `par − k`; this map writes the integer from its column's route
  instead, open question 8.)
- **What it does to the decision.** Storming the palace meets the column at the steps on
  turn 4 and can still take him with a focused strike on an armoured target; intercepting
  on the avenue takes him earlier at more risk; letting the Emperor sit never earns it. So
  each plan keeps a price, and the bonus asks which unit to strike first, not which plan.

**Engine need.** The throne clamp (`AIController.js:341-353`) filters candidates before the
seek-tile pipeline, so a boss with a `clampTile` would never march. `03`'s per-unit
`clampTile` is written for the Emperor, but the clamp skips a member of a `patrol` group
until its column reaches its last anchor. The arrival trigger is `02`'s `tile` with
`by: { group }`. The clamp gate ships first in `05` K2, for the Dark Rider's patrol (one
boss, one route); PR F reuses it (if PR F lands first, it ships the gate and K2 reuses it).

**Rungs:** placed on Nightfall and Black Sun only (§6.1, owner decision 2026-10-10);
emperor stones 1 / 2 there (`difficulty.json` `revivalStones.emperor`); the gate wave on
both.

## 11. Authoring workflow and tooling

**Workflow** (about ½ day of skeleton, 1 day of chunks at about an hour each, 1 day of tuning):
sketch → chunks and skeleton JSON → `npm run validate:data` → preview every combination →
play two opposite combinations on the dev route → harness → `sim/pacing`.

**Preview.** `tools/generateMapPreviews.js --setPiece <id> [--combos all|<n>] [--difficulty
<rung>] [--seed <s>]` renders one PNG per combination (`test-results/map-previews/setpieces/<id>/`)
with anchors, group regions coloured by start state, routes, phase targets and the deploy
region overlaid, and the estimate in the caption. `tools/map-review/cases.json` gains
set-piece cases for the field-trial page.

**Dev route.**
`?devScene=battle&preset=late_act&setPiece=mill_ford&choices=crossing:bridge_south,village:north&cells=r_s:bridge_narrow&act=3&difficulty=hard&seed=42`:
`parseDevStartupConfig` (`devStartup.js:578`) reads the three new keys, `buildDevStartupRoute`
puts `setPiece: { id, force }` on the node, and `force` is honoured only when
`devRoutesEnabled()`.

**Harness.** `tests/harness/SetPieces.test.js`: every set piece × combination × First Light
and Nightfall (Black Sun for rung-only options) × 2 fill seeds. `validateBattleConfig` reports
nothing, no authored tile was carved, and `HeadlessBattle` with `ScriptedAgent` finishes within
25 turns. The full matrix runs in `test:harness`; the PR slice takes 4 combinations each.

**Sims.** `sim/pacing.js --setPiece <id>` forces the set piece onto every node it fits
(`--setPieceShare <p>` for a share). Targets on 48 paired seeds: push median within par − 4 …
par − 2; turtle at least 1.5 turns slower than push (the Dusk gap); push turns across choices
spread ≤ 2; no more force-won stalls than the act's procedural maps.

**Agents: this spec only runs them.** It adds no agent code. `02` PR 2.0 ships
`TacticianAgent`'s seek mode for sleeping groups (and with it the awake seekers and
patrols the first maps field); each `03` kind PR ships the agents' read of its kind
(`goalTiles`: `defeat` targets with PR 1b, Strike with PR 7, escort pacing with escort).
A set piece that needs an agent behaviour no PR has shipped waits for that PR.

**Art.** One biome per map, as `Grid` takes today: grassland for the Mill Ford, Two Towers and
the Parade, castle for Long Road. The painter needs a review at seams (river bends, moat
corners) and of the drawbridge repaint through `Grid.setTerrainAt`, which hybrid overrides
already use. A pennant node pip. The ford is Bog in v1; a "Shallows" terrain is optional.

**Music.** `music` names a key in a new `MUSIC.battleSetPiece` table, or is `null` and
`BattleMusicSelection` picks by biome and situation. Boss set pieces keep the boss theme and
its enrage layer (the caller picks a boss's theme before `selectBattleMusic` runs).
- **Precedence.** `selectBattleMusic` (`BattleMusicSelection.js`) answers the most specific
  thing true of a battle: escape, then the Eclipse (`isEclipsed`), then the ambushed
  village, the recruit rescue and the elite company, then the biome and the shares. The set
  piece's own theme goes **after escape and the Eclipse, before everything else**: a named
  place is more specific than "elite" or a biome, but an eclipsed set-piece node plays the
  eclipsed theme like any eclipsed battle, because the Eclipse taking a node is run state
  the player must hear. An escape set piece plays the pursuit theme, as every escape does.
- `battleMusicContext` reads the key from `setPieces.json` by `battleConfig.setPiece.id`
  (presentation, not rules: an unknown id or a `null` key falls through to the order above),
  and the pick stays hashed from the run seed, so a resumed battle plays what it played
  before. `MusicLibrary.test.js` checks every `battleSetPiece` key is a real adaptive
  score.

## 12. Persistence and save size

**The config holds:**
- every procedural field (with `templateId: 'setpiece:<id>'`);
- `setPiece: { id, version, choices: { choiceId: optionId }, chunks: { cellId: { chunk, transform } } }`;
- `anchors` (tiles);
- `parRoute` (§4.2 step 10) and `02`'s locked `parModel` inputs;
- `objectives` (when they say more than the legacy derivation, §3.7), `encounterGroups`
  and `formationSpares`.

**It never holds** chunk matrices, option lists, the skeleton or fill tables.

**Size.** A procedural 24x14 config measures 2.4 KB. A set piece adds about 1.4 KB (15
spawns with `encounterGroupId`), 0.6 KB (groups, triggers, routes), 0.4 KB (anchors) and 0.4 KB
(objectives, phases, the record): about 5 KB. An act holds at most four (one ordinary, two
elite, the boss), +12 KB worst case, and Phase 0's prune at `advanceAct` keeps only the current
act's configs in the save.

**Battle state that changes during play** rides the checkpoint, the rewind snapshot and the
snapshot validator with `02`/`03`, from the first PR: woken groups, fired triggers, the
phase, objective progress and the column's next route index. The checkpoint grows by under
1 KB.

**Run state:** `run.setPiecesOffered` (a list of ids), serialized; a node's
`battleParams.setPieceFallback` (§6.2); `requiresClient` and `requiresCapabilities` (§12.1), which
any capability writes, not only a set piece. An old save has none of them.

### 12.1 Older clients never load a run they can't play

**The risk.** A client from before this work reads a run save without knowing what these
specs add. Set pieces are one case. On a node that holds one but is not yet entered it would
generate the kept procedural template with the rewritten `objective` (an elite seize
template played as a rout). On a locked set-piece config or a suspend checkpoint inside one
it would play the config with no group, objective or phase rules: a `defeat` map as a rout
of every holder, and, from `03` PR 7, a `Gate` tile (terrain index 19) it does not know.
Saves cross clients through the cloud (`run_saves`): an iOS build that has not updated, or a
stale web tab, fetches the row another device pushed.

**It is not only set pieces.** The same specs put new mechanics on maps that are not set
pieces: encounter groups beyond today's hold packs (`02` §3.5), phases and `groups-v1` par
on any config with written `objectives` (`03`, `02` §5.2), and `05`'s boss kits, signatures
and arena variants on every boss battle, First Light included (`05` §9.5). The boss
enhancements also ship on their own track, before any set piece (`05` §12). A marker keyed
on `setPiece` misses all of them. The failure it lets through:
1. A new client starts a First Light Act II boss battle with the Archmage's kit
   (`05` §7.2; Act I's bosses carry no kit on any rung, owner decision 2026-10-10).
2. First Light never gets set pieces, so no `setPiece` is anywhere and the marker stays
   absent.
3. The run syncs as an ordinary format-1 save.
4. An older client loads it, plays the old boss rules, and writes a checkpoint that drops the
   kit's state (`bossState`: the pending tell, the signature count). The next resume on a
   newer client finds a phase with no signature state.

So the required format is **derived from the mechanics the run holds**, not from any one
feature's field.

**How the prologue does it.** `CloudSync.isLocalOnlyRunSave(run)` (`CloudSync.js:584`) is
true for a prologue run (`isPrologueRun`), and every path that would put a run in the
cloud asks it: `pushRunSave` returns `{ queued: false, reason: 'prologue_local' }` and
retires a prologue copy an earlier build pushed (`retireCloudPrologueRun`, a delete that
holds only while the row is itself a prologue run); `pushChosenLocalRun` deletes the cloud
run it was chosen over instead of pushing; logout's backup leaves it out and reports it
(`listLocalOnlySaves`, `backupAllLocalSlots` → `localOnly`, `kind: 'prologue'`,
`CloudSync.js:844-864`), so sign-out asks before discarding it (`TitleScene.js:348-359`).
An old client therefore never sees the save. It works without the old client's help,
which is the only way to protect a client that already shipped.

**The equivalent: a capability list, a marker derived from it, and the prologue's hold-back
while the marker is new.**

**Names.** What exists, and what is proposed (new in PR A0; nothing here is built):

| Exists today | Proposed |
|---|---|
| `RunManager.toJSON` writes `version: 1` (`RunManager.js:4972`). Nothing reads it: `fromJSON`, `loadRun` and `SlotManager` ignore it, so an older client ignores any number put there and it can't carry the guard | `requiresClient` (an integer) and `requiresCapabilities` (sorted ids), beside it in the same object; `engine/RunFormat.js` (pure): `requiredRunFormat(saved)`, `runFormatBlock(saved)`, `RunFormatError`, the capability table, `RUN_FORMAT_FIELDS`; `RUN_FORMAT` and `CLIENT_CAPABILITIES` |
| `loadRun` (`RunManager.js:6064`: parse, then `fromJSON`); `SlotManager.getSlotSummary` (`prologueRun`, `SlotManager.js:304`) | the loader refusal, and the summary's `needsNewerClient` |
| `isLocalOnlyRunSave` (`CloudSync.js:584`: `isPrologueRun(run)`), `retireCloudPrologueRun`, `reason: 'prologue_local'`, `listLocalOnlySaves` (`kind: 'prologue'`) | `CLOUD_SAFE_RUN_FORMAT` in `CloudSync`, the widened predicate, `reason: 'format_local'`, `kind: 'newFormat'`; the retire helper loses "Prologue" from its name |

**1. The capabilities.** A capability is a mechanic an older client would misplay or drop. The
list is part of the guard; a PR that adds a mechanic adds its row (step 8 keeps that honest).
Every capability maps to **format 2**, the first format whose clients honour the list; a
capability gets no number of its own, because the list is the exact door (step 3): a client
that has the guard but not the capability refuses by id. (Revision 3's "the `Gate` terrain:
3" is now the id `gateTerrain`.)

| id | What an older client would do | Spec |
|---|---|---|
| `encounters` | play groups as awake chasers, ignore wakes, patrols and triggered waves, and drop `encounterState` on its next checkpoint | `02`, `05` courts |
| `parModel` | price par with `calculatePar` instead of the locked `groups-v1` inputs, so boss enrage (`min(12, par + 2)`) lands on another turn | `02` §5.2 |
| `objectives` | read `objective` alone: a multi-throne, `defeat` or phased map as a rout or a single seize; drop `objectiveState` and the bonus ledger | `03` |
| `gateTerrain` | meet a `Gate` tile and its structure HP | `03` PR 7 |
| `bossKit` | play the old boss rules and drop `bossState` | `05` |
| `arena` | generate an unentered boss node from a rewritten `templateId` or variant it doesn't have | `05` K0 |
| `setPiece` | generate the kept template with the rewritten `objective` | this spec |

**2. Where each is detected.** `requiredRunFormat(saved)` is pure and reads the **serialized**
run (what `toJSON` writes and `isLocalOnlyRunSave` is handed), never a `RunManager`, so the
loader, the slot summary and the cloud predicate call it on the raw payload before
`fromJSON`'s migrations mutate it. It returns `{ format: 1 | 2, capabilities: [ids] }` and
looks in four places: the node map (`nodeMap.nodes[*].battleParams` of nodes not yet
complete), the locked configs (`battleConfigsByNodeId[*]`, the current act's, which is all
Phase 0's prune leaves), the battle checkpoint (`battleInProgress`: its `battleParams` and
state objects, read together with the node's locked config, and the same objects inside
`checkpoint.visionSnapshot`, `pendingVisionSnapshot` and the rewind `timeline` rows), and
top-level run fields.

| id | Node map | Locked config | Battle checkpoint | Run fields |
|---|---|---|---|---|
| `encounters` | — (the plan reaches generation through the run field) | `encounterGroups` holding a group that is not a legacy hold pack (id not `hold:<pack>`, a `wake` outside `[danger, hurt]`, or an `onWake.mode` other than `hunt`); `reinforcements.triggeredWaves` non-empty; a spawn with `patrolIndex` | `encounterState.groups` or `.fired` with a key not rooted in a `hold:` group; a unit with an `encounterGroupId` that is not `hold:`; `patrolIndex` | `difficultyModifiers.encounterPlan` with a non-null entry (`02` PR 2.6; `null` until then) |
| `parModel` | — | `parModel` (any value) | via the config | — |
| `objectives` | `battleParams.objectivePreview` | `objectives` that `normalizeObjectives` would not derive from the same config: more than one primary, a kind outside rout / seize / escape, any `phases`, a bonus other than the derived `village` / `caravan`, `parAdjust` ≠ 0; `npcAllies`; a spawn with `clampTile` or `objectiveRef` | `objectiveState` with `phase` > 0, an entry in `points`, `escorted`, `fled` or `floors`, a `thrones` or `status` id the derivation would not hold, or a `structures` entry | `bonusVisionActs` (`03` §12: saved only when Vision rewards are on) |
| `gateTerrain` | — | `structures` non-empty | terrain index 19 anywhere in `mapLayout` | — |
| `bossKit` | a `boss` node of Act II or later, once the run field holds: an unentered boss node there is a kit boss (Act I's bosses are `kitless`) | `bossKit`, `bossSignature`; a boss spawn with `bossKit` | `bossState` with any entry (`signature.pending`, `firedTurns`, `count`, `marked`, `pillars`, `musicLatch`); a unit with `bossKit` | `difficultyModifiers.bossKits.enabled` is true (`05` §10.1's snapshot, taken at run start; true on any rung with kits switched on, First Light included) |
| `arena` | `battleParams.arenaVariant` (`05` §4.4's post-pass writes it on every node it rewrites, variant 0 included, so detection never needs the template catalogue) | `arenaVariant` in the params the config came from | `battleInProgress.battleParams.arenaVariant` | — |
| `setPiece` | `battleParams.setPiece` or `setPieceFallback`; `objectivePreview` | `setPiece`; a `templateId` beginning `setpiece:`; `formationSpares` | via the config | `setPiecesOffered` |

**Never counted** (legacy-equivalent: an older client plays them correctly today):
- `encounterGroups` made only of `hold:<pack>` groups, and the unit-level hold fields
  `02` §3.6 writes beside them, so a build without the module still plays them;
- an `encounterState` or `objectiveState` that only mirrors those groups, `villageState` and
  `caravanExited` (`03` PR 3 writes `objectiveState` on every battle), and an empty
  `bossState`;
- `anchors`, `encounterVersion` and a `parRoute` on their own: inert data that no old reader
  looks at. They always arrive with a capability above, which holds the run;
- the prologue: it stays local-only by mode, `kind: 'prologue'`, and carries no marker.

**Detection errs toward holding.** A false positive keeps one run off the cloud until the
lift (step 5). A miss lets an older client corrupt a run.

**3. The marker.**
- `toJSON` writes `requiresClient: 2` and `requiresCapabilities: [ids]`, sorted, from
  `requiredRunFormat`. Both are absent when the list is empty, so a run with no capability
  stays format 1 and every client keeps reading it.
- **Ratchet.** A run keeps every id it has ever written: `fromJSON` loads the saved ids as a
  floor and `toJSON` writes floor ∪ derived. A locked config pruned at `advanceAct`, or a
  finished boss node, never lets a run drop back to format 1 and be pushed mid-life.

**4. Clients from the marker on honour it.** `loadRun` calls `runFormatBlock(saved)` on the
parsed save **before** `RunManager.fromJSON`. It blocks when the larger of the stored and the
derived format exceeds `RUN_FORMAT`, or when any stored or derived id is not in
`CLIENT_CAPABILITIES`. It then returns null and writes nothing. `fromJSON` itself throws
`RunFormatError` for such a save, so a sim, test or later caller can't load it by another
door. Reading both sides is the point: a save whose writer left the marker out is still
caught by a client that knows the capability (the derived side), and a stored id this client
has never heard of is caught by id (the stored side). `SlotManager`'s slot summary calls the
same function on the raw save and marks the slot `needsNewerClient`: the slot card says "This
run needs a newer version of the game", Continue is not offered, and New Game on that slot
asks before it replaces the save. The run key is never written by a client that refused it.
`CloudSync.applyRunSlots` stores such a cloud run locally like any other (an updated client
then plays it); since the client never loads it, it never pushes over it.

**An invariant the guard needs: a client never writes what it can't read.** Every id
`requiredRunFormat` can return is in the same build's `CLIENT_CAPABILITIES`, and the PR that
adds a writer adds the id in both places (test 24).

**5. Clients from before the marker can't honour it**, so while they may still be in use the
run stays on its device, by the prologue's own predicate:
`isLocalOnlyRunSave(run) = isCloudSlotPayload(run) && (isPrologueRun(run) || requiredRunFormat(run).format > CLOUD_SAFE_RUN_FORMAT)`,
with `CLOUD_SAFE_RUN_FORMAT = 1` in `CloudSync`. The predicate recomputes the format from the
payload instead of trusting the stored marker alone, so a missing marker can't release a run.
Every hold-back path above then covers every capability unchanged: no push (`reason:
'format_local'`), the stale cloud copy of that run retired (the `expected` predicate widens
with it), logout's `localOnly` report (`kind` becomes `'prologue'` or `'newFormat'`, and
sign-out's question names a run in progress rather than the prologue for the second), and
sign-out's Keep playing / Sign out anyway. The slot's meta still syncs.

**6. Lifting it.** Once a client that carries the guard is the oldest in use (the TestFlight
build that carries it has replaced the earlier builds, and one web deploy has passed), the
owner raises `CLOUD_SAFE_RUN_FORMAT` to 2 in a one-line PR: capability runs back up again,
and step 4 alone protects the clients that have the guard. Because step 4 refuses by id, one
lift covers every capability added later; a later capability needs a new format number only
if the marker's own contract changes.

**7. Ordering.** PR A0 (§14) holds steps 1–6 and writes no capability itself. It is a
dependency of **the earliest PR, in any spec, that can generate any capability**:
- `05` K0 (`arena`) and K1 (`bossKit`, with the courts and phases it compiles);
- `02` PR 2.3 (`triggeredWaves`), 2.4 (patrols, columns), 2.6 (pods), and 2.5 as soon as a
  writer locks `groups-v1`;
- `03` PR 1b (`clampTile`), 4 (phases), 5, 6, 7 (`gateTerrain`);
- this spec's PRs B and C (`setPiece`, including the dev route that locks a set-piece config).

PRs that write nothing a capability detects (`02` 0a–0e, 2.0, 2.1, 2.2a, 2.2b; `03` PRs 1–3)
don't wait for it. The earliest of the writers are `05` K0, `02` PR 2.3 and `03` PR 1b, so
A0 precedes all three, whether or not any set piece ever ships. It also ships a release
before a writer is **turned on**: writers merge dark (README §5 "Rollout gates": every
switch starts off), and none is switched on until the release carrying A0 has reached
clients. Placement (PR C) in particular does not ship while `CLOUD_SAFE_RUN_FORMAT` would
leave a capability run pushed to a client older than the marker.

**8. Keeping the list complete.** The original miss was a new mechanic with no marker. A
registry makes the next one fail a test instead: `RUN_FORMAT_FIELDS` classifies every key
these specs add to a node's `battleParams`, a locked config, a checkpoint's state objects
and the run's top level as **inert**, **legacy-equivalent** or owned by a capability id. Test
24 generates the corpus with every switch on and fails on a key the registry doesn't list.

**The regression fixture** is test 23 (§13): a First Light, non-set-piece boss run with a
boss kit. It must require the newer client and be held back by the cloud hold-back, with no
`setPiece` anywhere in it.

## 13. Tests

Realistic failures first; each is one test, and each is shown to fail once by planting its bug.

| # | Failure | Test |
|---|---|---|
| 1 | placement moves the node-map stream | 50 seeds × Acts III–IV, node maps with and without `setPieces` data: every node's type, `battleSeed`, `templateId`, objective, edges and flags equal, except what `assign` writes |
| 2 | a set piece changes another node's map | the locked configs of every unassigned node on both sides of test 1 are equal |
| 3 | a new set piece moves which node is chosen | add a dummy eligible set piece: the assigned node ids are unchanged |
| 4 | a combination cuts a lord off | replant Long Road's first sketch: the error names the combination and the move types |
| 5 | seams don't line up | mirror a river chunk without its port: the error names both cells |
| 6 | a transform misplaces an anchor | in every allowed transform a `throne` anchor lands on Throne and regions keep their size |
| 7 | a wall rises on a seat | a phase target in a group region fails validation; `TerrainPhases` skips an occupied tile |
| 8 | out of the turn band | replant Two Towers' east-only sketch (14–15): fails band and spread |
| 9 | not deterministic | two generations with one seed are deep-equal; a resume plays the locked config verbatim |
| 10 | treated as scripted | a `ScriptedBattleSuppression` row: Eclipse gain, Guidance, deeds and last words run |
| 11 | the rung leaks | class gates, `difficultyFilter` bosses and stones per rung, read off the spawns |
| 12 | counts ignore the rung | the total is `rollEnemyCount` + bonus on each rung; the split is stable |
| 13 | a data edit changes an entered map | edit a locked map's chunk in data: the map is unchanged; an unknown id falls back to the template without throwing |
| 14 | placement limits broken | ≤ 1 ordinary and ≤ 2 elite per act, never adjacent, none on First Light (any slot), on Dusk none above 20x12 and no boss or finale set piece (an event naming Break the Gate fights its procedural rout there), none in the prologue or after `fromJSON` of an old save; the validator refuses a Dusk entry with a boss share above 0 or a `maxSize` above `[20, 12]` |
| 15 | later changes to a node | the Eclipse keeps the set piece as elite; `rebuildNodeAs` drops it; `hasVillage` matches |
| 16 | a bad event hook | `battle.setPiece` outside the acts or slot fails `EventValidation`; a gated rung fights a procedural rout |
| 17 | scene and harness differ | every combination plays to the end (§11); scene and harness generate equal configs (`GridParity` style) |
| 18 | the save grows | every set-piece config is ≤ 8 KB serialized |
| 19 | an older client plays a run it can't | a save with `requiresClient` above `RUN_FORMAT`, or a `requiresCapabilities` id missing from `CLIENT_CAPABILITIES` (narrowed in the test): `loadRun` returns null and the stored string is byte-identical after; `fromJSON` throws `RunFormatError`; the slot summary says `needsNewerClient`; with `CLOUD_SAFE_RUN_FORMAT` 1 a held run is never pushed, its stale row is retired only while it is that run, logout lists it `newFormat`; a run with no capability writes neither field. This row runs the Mill Ford (the `setPiece` capability); test 23 runs the case with no set piece |
| 20 | a bonus fights the primary | replant revision 1's Two Towers armoury (behind the far tower's back door): check 9 fails and names the combination; a `slay` on the Emperor fails check 9 |
| 21 | the fallback plays the wrong map | an elite node with an unknown set-piece id plays its seize template as a seize (`setPieceFallback` restored), not as a rout |
| 22 | par counts the walk twice | a Two Towers config: locked par equals `02` §5.2's `groups-v1` on the written `parRoute` (hand-computed W and S), and `parAdjust` equals the hand-summed non-walk terms only (0 on Dusk; 1 on Black Sun, the stone bearer's bar) |
| 23 | a mechanic that is not a set piece slips past the guard (the review's P1) | **Regression fixture: a First Light, non-set-piece boss run with a boss kit.** `difficultyId: 'normal'`, Act II (Act I's bosses have no kit on any rung, owner decision 2026-10-10), a procedural seize template, the Archmage's compiled First Light kit (`05` §7.2, §9.5: the circle an awake guard, a 2-tile volley that cannot kill), and First Light's `bossKits.arenaShare` 0 (validated) so `arena` is not what holds it. Three states: (a) Act II start, the snapshot has `bossKits.enabled` and the boss node is unentered; (b) the boss config locked; (c) a suspend checkpoint after the Archmage's first Calculation tell. A deep key scan asserts none of `setPiece`, `setPieceFallback`, `setPiecesOffered`, `objectivePreview` or a `setpiece:` template id appears in any state. Required, by hand from the kit's data: (a) `requiredRunFormat` = format 2, `['bossKit']`; (b) and (c) add `encounters` (the `circle` court, an awake `guard` group, not a `hold:` pack), `objectives` (the phase record) and `parModel` (`groups-v1`). `toJSON` writes `requiresClient: 2` and the ids; a copy with both fields deleted still scores format 2, so `isLocalOnlyRunSave` is true; **the cloud hold-back holds it**: `pushRunSave` returns `{ queued: false, reason: 'format_local' }` and queues nothing, `pushChosenLocalRun` deletes the replaced cloud run instead of pushing, `listLocalOnlySaves` and `backupAllLocalSlots` report it `newFormat` and leave it out of the batch. A client simulated at `RUN_FORMAT` 1, or one whose `CLIENT_CAPABILITIES` lacks `bossKit`, gets null from `loadRun` and its slot string is unchanged. Plant: derive the format from `setPiece` alone, and all three states fail |
| 24 | a new mechanic or field nobody classified | `RunFormatRegistry.test.js`: a key census over a corpus (every template × rung × act, 50 seeds, every data switch on). Every key in a node's `battleParams`, a locked config, a checkpoint's state objects and the run's top level is in `RUN_FORMAT_FIELDS` as inert, legacy-equivalent or owned by a capability id; an unlisted key fails with its path. Every id `requiredRunFormat` returns is in `CLIENT_CAPABILITIES` (a client never writes what it can't read). Plant: add a config key with no registry line |
| 25 | a legacy-equivalent run is held (the false positive) | Dusk+ seize and escape maps with hold packs (`hold:<pack>` groups, derived village and caravan, a mirroring `objectiveState`, an empty `bossState`, kits and arenas switched off): `requiredRunFormat` = format 1, no ids, no marker written, the run pushes as before. The prologue stays local-only with `kind: 'prologue'`, unmarked. Plant: count any `encounterGroups` as `encounters` |
| 26 | a run falls back to format 1 mid-life | the ratchet: a run holding `bossKit` that advances its act (configs pruned, boss node done) still writes `requiresClient: 2` with the ids it had; a run loaded from a format-1 save gains none. Plant: write only the derived ids |

**Browser specs** (each in a lane of `tests/e2e/lanes.json`, so `npm run check:e2e-lanes`
holds them):
- `set-piece-mill-ford.spec.js`, lane `run-flow`: on a seeded run routed to the Mill Ford
  (the dev route, a fixed `seed` and `choices`), the route card shows the place and the
  Large map tag; the battle is then played on the real board to the victory band, at
  desktop (a 1280x800 viewport, the 640x480 canvas) and on an 844x390 landscape phone
  (`?portrait=0`). It plays only through clicks, taps and keys, as the prologue's
  ordinary-play specs do (`tests/e2e/prologueDriver.js`'s board planner, generalised to a
  set-piece driver), waits on state, never on time, and refreshes once mid-battle to check
  Resume Battle restores the woken groups and the bridge hold's state. It never calls
  `onVictory`, `removeUnit`, `completeBattle` or a setter.
- `portrait-set-piece.spec.js`, lane `portrait` (shared helpers
  `tests/e2e/portraitHelpers.js`): the same battle upright on a 390x844 phone, to the
  victory band.

## 14. PR breakdown

PR numbers of the other specs are theirs: `01` §5, `02` §8, `03` §14. **Later** marks a part
that stays specified here but that nothing in the first shipment waits on.

| PR | Content | Needs | Effort |
|---|---|---|---|
| A0 | **The run-format guard** (§12.1), in this spec because the first writer was a set piece, but owned by no one feature: `engine/RunFormat.js` (the capability table, `requiredRunFormat`, `runFormatBlock`, `RUN_FORMAT_FIELDS`), `RUN_FORMAT` and `CLIENT_CAPABILITIES`, the `toJSON` marker and its ratchet, the loader refusal and `RunFormatError`, the slot card (`needsNewerClient`), `CLOUD_SAFE_RUN_FORMAT` and the widened `isLocalOnlyRunSave` (`reason: 'format_local'`, `kind: 'newFormat'`); tests 19, 23–26. It writes no capability itself | nothing | 2–3 days |
| A | Format and validator: the two data files with test chunks only, `SetPieceFormat.js`, `SetPieceValidation.js` in `validate:data` (checks 1–9), sync, parity; tests 4–8, 20. **Later**: `mirrorX` and `rot180` (`mirrorY` and the whole-map mirror stay), `byRung` patches, the 256-combination cap and its timing budget | nothing | 2–3 days (2 trimmed) |
| B | Generator: `generateBattle` dispatch, `SetPieceGenerator.js` (assembly, fill scope, groups to spawns, awake `onWake` on spawns, gear chain, `formationSpares`, `parRoute`, `setPieceFallback`, config fields), `HeadlessBattle` deps, the dev route, the preview tool; tests 9–13, 17–18, 21 | A, A0; `02` PR 2.1 (the group schema, initially awake `onWake`), `02` PR 2.5 (the par PR: `groups-v1` over `parRoute`; or `02`'s stopgap, `max(calculatePar(rout), estimate + 3)`, calibrated later). Not `03`: the Mill Ford writes no `objectives` (§3.7) | 4–5 days |
| C | The Mill Ford and placement: `SetPiecePlacement.js`, the `difficulty.json` table (with Dusk's `maxSize` and the ladder's validation, §6.1), the RunManager hooks, the loom tag and place helper, the node pip, `sim/pacing --setPiece`, the two browser specs (§13); tests 1–3, 14–15, 22. **Later**: `setPiecesOffered` | B; `02` PRs 0a (enrage floor), 0d (dead air: on the critical path, a 15-enemy map of holders is unplayable on a phone without it), 2.1, 2.2a (`groupWoken`, `turn parOffset`, warn bands, always-on dormant outlines; its `tile` is no longer used by the Mill Ford), 2.5; `01` PR 1 (the [N] clamp) and, on phones, PR 8 (pointers). Nothing from `03` (§10.1). Not `02` 2.2b: the reserve's `objective` wake and Black Sun's `afterContact` clock wait for it (§10.1) | 4 days + 1 tuning |
| D | Two Towers: elite placement, two captains, the road patrol, the `objective` wakes, the armoury | C; `03` PR 1 (the model: `defeat` is not a legacy kind), PR 1b (`defeat`, per-unit `clampTile`); `objective` events: `03` places them in PR 4, which also needs `02` PR 0b. Recommended instead: PR 1b notes `defeat`'s own `objective` events into `02` 2.2b's hook, so Two Towers needs nothing from PR 4 or 0b (a note for `03`); `02` PR 2.2b (the `objective` hook), PR 2.4 (the patrol; a `picket` is the fallback, same estimate). The bonus: `03` PR 3 and PR 5 (`reach`); the map can ship first without it | 3 days + 1 tuning |
| E | Hybrid v2 and Long Road to the Keep: phase validation (§7: targets off seats, connectivity after each phase), the drawbridge through `02`'s `applyTerrainSetTiles` (no extraction: `02` PR 0b owns the module and deleted the harness copy); `boss.weights` and the keyed boss pick. `05` K7 adds the drawbridge's `bossBar` member and the bonus | D; `02` PRs 0b, 2.2b (the `phase` slot), 2.4 (the sally's `seek`); `03` PRs 3, 4 (phases); `01` PRs 3–5 (desktop camera), 7 (enemy-phase follow), 8 (pointers): 22x14 doesn't fit the desktop canvas at zoom 1 | 4 days |
| F | The Emperor's Parade: the throne clamp gate for a marching column (unless `05` K2 shipped it), the routed column, the seated wake, the arrival trigger, the `slay` bonus. `05` K8 adds the bar phases | E; `02` PRs 2.2a (`tile` with `by: { group }`), 2.2b (`afterContact`), 2.3 (the gate wave), 2.4 (the column); `03` PRs 1b (`clampTile`), 4, 5 (`slay`); `01` as E (24x14) | 5 days |
| G… | Phase 6, one PR each. **Later**: the event `setPiece` hook (test 16) with Caravan Under Siege, Hunting Party, Rival Band, The Burning Village (`villages[]`), Break the Gate (structure HP), and the finale (Sanctum of Echoes) | each the `03` kind it uses (escort, assassinate, `claim`, destroy) | 3–6 days each |

PRs A0, A and B can land before any content; C is the first a player sees. **A0 lands
first, ahead of every PR in the set that can write a capability**, not only this spec's: `05`
K0 and K1, `02` PRs 2.3, 2.4 and 2.6, `03` PRs 1b and 4–7 (§12.1 step 7). Its guard must
reach clients a release before any writer is switched on, and a boss kit on First Light
needs it as much as a set piece does.

**Deferrable for the first shipment** (none of these blocks the Mill Ford or Two Towers):
- the `mirrorX` and `rot180` transforms (keep `mirrorY`: both first maps use it);
- `byRung` patches (Black Sun's extra reserve clock waits for them);
- the event hook (§6.5), the finale slot and Sanctum of Echoes;
- `run.setPiecesOffered` (one ordinary and one elite set piece cannot repeat across acts in
  a way it would stop);
- the 256-combination cap and its timing budget (the Mill Ford has 16; Two Towers' 192 on
  Black Sun bring them back with PR D).

### 14.1 Vertical slice: a seeded, resumable, sim-measured Mill Ford on Dusk and up

The shortest path to a playtest, about 22 working days (the guard is its own PR, A0), in
order:

| Step | PR | Effort |
|---|---|---|
| 0 | `04` PR A0: the run-format guard (§12.1). Before any writer; the Mill Ford is the first thing this slice writes | 2–3 days |
| 1 | `02` PR 0a (enrage floor; the Mill Ford has no boss, but it is half a day and every later set piece needs it) and PR 0d (dead air) | 2 days |
| 2 | `02` PR 2.1 (groups, `danger` / `hurt`, the hold-pack adapter, `encounterState`, golden parity, awake `onWake` on spawns) and PR 2.2a (`groupWoken`, `turn parOffset`, warn bands, always-on dormant outlines) | 4 days |
| 3 | `02` PR 2.5 (`groups-v1` with W from `parRoute`), or its stopgap | 2 days (1 for the stopgap) |
| 4 | `04` PR A trimmed: the format, `mirrorY` only, no `byRung`, validator checks 1–5, 7, 8. Checks 6 (the race) and 9 (bonus before the last target) follow in PR D; both hold on the Mill Ford by the scratch numbers in §10.1 | 2 days |
| 5 | `04` PR B: the generator, the dev route, the preview | 4 days |
| 6 | `04` PR C: the Mill Ford, placement, the loom tag, `sim/pacing --setPiece`, the browser specs | 4 days + 1 tuning |
| 7 | `01` PR 1 (the [N] clamp); `01` PR 8's phone pointers once the playtest shows two fronts off-screen | 1 day |

Nothing from `03`: the Mill Ford is a rout plus the legacy village, which today's predicate,
strip and in-battle payout handle. In the slice its reserve wakes on `danger`, `hurt` and
`turn parOffset −3` only (§10.1); the `objective` wake joins with `02` PR 2.2b and `03`
PR 4. It is placed on Dusk, Nightfall and Black Sun (never First Light, owner decision). The slice
is also the **proof the rest of the catalogue waits on**: its exit criteria (README §5
"Rollout gates") are met before Two Towers, the boss set pieces, any boss-kit switch or rout
pods are turned on.

Then **Two Towers** (PR D, about 12 more days with `03` PR 1, PR 1b and `02` PRs 2.2b and
2.4), and, before **Long Road**, the first board that doesn't fit the desktop canvas,
`01`'s desktop camera, enemy-phase follow and pointers.

## 15. Open questions for the owner

1. **Decided (2026-10-09): no set pieces on First Light**, ordinary, elite or boss. It is
   the intro difficulty. The table's First Light row is all zeros and the validator refuses
   a non-zero entry there. What follows is the reasoning that preceded the decision.
   (`05` covers boss enhancements that are not set pieces, which First Light may still get.)
   Revision 1's table gave First Light boss set pieces (Long
   Road at a 0.5 share; it has no Act IV) but no ordinary or elite ones, so the most-played
   rung would meet dormant groups, a phase switch and a bonus's cost for the first time at
   an act boss, where the enrage cap binds hardest (`02` §1.5). Two ways out:
   - (a) keep First Light's boss maps on today's arenas (boss share 0, the table now) until
     the at-point-of-use Guidance notes ship (`02` §3.8 `guide_holding`, `03` §11.2's phase
     and bonus-cost notes);
   - (b) allow one ordinary set piece per run on First Light (the Mill Ford, at First
     Light's counts, Act III), so the mechanics are met on an ordinary map before any boss.
   **Recommendation:** (a) now, then (b) once the notes ship, and only then a First Light
   boss share. (Superseded on 2026-10-10 by the owner's rung ladder, README §6: First Light
   takes no set piece of any kind, and its boss maps stay today's maps, so (b) is off the
   table with the rest.)
2. **Decided (2026-10-09): at most one set piece per act on ordinary nodes, plus a chance
   on elite nodes**, as the table proposes; the exact chances are tuned in PR C. The
   original question: does 0.5–0.7 per act on ordinary nodes, plus about 0.3 per elite
   node, give the right frequency? That is about two large maps per run, counting bosses.
   (README Q1.)
3. **Decided (2026-10-09): keep and enhance the boss maps, don't replace them.** The
   hybrid arenas stay in the boss pool beside Long Road and the Parade. `05-boss-maps.md`
   plans how to enhance every boss battle (phases, signature mechanics, arena variants,
   bonus objectives) and adds more boss set pieces.
4. **Showing choices.** Should the route card hint at the plan ("the bridge is held") or only
   name the place? This spec names the place only.
5. **Decided (2026-10-10): no Parade on Dusk** (README §6, the rung ladder). Dusk takes no
   boss set piece at all (§6.1: boss share 0, validated); its last battle is the Emperor's
   kit on today's maps and the bastion's variants (`05` §8.4). The original question: should
   Dusk, where the Emperor is the run's final battle, always get the Parade as a finale
   rather than a 0.5 share?
6. **Two Towers' primary.** Is `defeat` both captains (recommended) acceptable, or must it
   read as a double seize?
7. **The finale variant.** Should Sanctum of Echoes replace the Entity's sanctum at a share,
   or only on Black Sun? Recommended (`05` §8.2): Black Sun only, at 0.5, so §6.1's
   Nightfall finale share is 0; Nightfall keeps the procedural sanctum with `05`'s echo
   pillars, and can be added if the owner wants it.
8. **A `slay` deadline from a column.** The Parade locks its `slay` bonus's `byTurn` from the
   column's unopposed arrival (turn 4), not `03` §7.1's default `par − k`. Is a
   generator-written integer acceptable for `byTurn` (recommended: it is still locked and
   still a real number on the strip), or should the map pick a `k`?
9. **Kits hold the whole run, or only the boss.** §12.1's `bossKit` capability is detected
   from the run's snapshot (`bossKits.enabled`) as well as from a locked config, so every run
   started with kits on is local-only from its first save until `CLOUD_SAFE_RUN_FORMAT` is
   raised, not from its boss fight. That is the safe reading (an older client would otherwise
   play the unentered boss on the old rules, and the run's par, bonus ledger and records would
   differ by device). The cheaper reading detects only a locked config or checkpoint, and
   leaves the cloud backup on until then. **Recommendation:** the safe reading; the lift is a
   one-line PR (step 6) and the window is one release.

## Notes for the README

Revisions 2 and 3 of the README took in this spec's `battleConfig.anchors`, `tile` with
`by: { group }`, `engine/TerrainPhases.js`, `battleConfig.parRoute` and the vertical slice.

1. **Resolved (README rev 2):** `setPiece` is `{ id, version, choices, chunks }`. `chunks`
   records the chunk picks, for the dev route and bug reports; it is read for display and
   records only.
2. **Resolved (README rev 2):** "per-node chance" is a per-act chance for ordinary nodes,
   then one node, and a per-node chance for elite nodes (§6.1, README §4).
3. **Resolved (README rev 2):** the rung chances live in `difficulty.json`
   (`modes.<rung>.setPieces`), so every rung needs an entry.
4. **Two Towers is `defeat`, not a double seize.** Taken in by `03` §5.2 and README rev 3's
   roadmap (Phase 4: "Two Towers adds `03`'s model and `defeat`"); the owner's choice stays
   open question 6.
5. **Resolved (README rev 2):** elite slots may be smaller than the large band (Rival Band is
   18x10); the size table says so.
6. **Open: the slice's trimmed `02` 2.2.** README §5's vertical slice lists `tile` among the
   Mill Ford's triggers. Since the reserve dropped `tile: village` (§10.1) the Mill Ford
   uses no `tile` trigger; its `objective` wake needs `02` 2.2b and `03` PR 4's events and
   is left out of the slice's data. `02` §8 already says so; the README's step 2 could drop
   `tile` and say the reserve wakes on its clock until then.
7. **Resolved (README rev 5): old clients** (§12.1). README §3 "Old clients" now says the
   marker is derived from capabilities, of which a set piece is one, so a boss kit on First
   Light is held too; `isLocalOnlyRunSave` holds it on its device until
   `CLOUD_SAFE_RUN_FORMAT` is raised.
8. **Resolved (README rev 6): First Light has no Act IV.** README Q2's recommendation
   (today's arenas on First Light's boss maps until the Guidance notes ship) concerned only
   Act III's boss there; the owner's rung ladder of 2026-10-10 makes it permanent on every
   act (First Light's arena share is 0, `05` §9.5).

## Revision 2 changelog (2026-10-09)

Takes in the cross-review of the spec set.
- **Par (B1).** Every set piece writes `battleConfig.parRoute`, the cheapest plan's legs
  (§4.2 step 10, §8.3). Par is `02` §5.2's `groups-v1` with W from `parRoute` and `03`'s
  `parAdjust` (non-walk terms only) inside it, in `02`'s order, with `02`'s corrected floor
  `1 + W + parAdjust + bossTurns + 3`; the walk is counted once. The estimate's `+ 3`
  assertion is kept and explained against that floor.
- **TerrainPhases (B2).** `02` PR 0b owns `engine/TerrainPhases.js` and deletes the harness
  copy; PR E calls `applyTerrainSetTiles(grid, setTiles, anchors, { occupants })` and
  extracts nothing. Phase effects resolve at `02`'s enemy-phase check.
- **Bonuses that fought the primary (B5).** Two Towers' armoury moved inside the first
  tower (recomputed: 96 combinations, 9–11, the armoury tower first on every par route,
  its walk equal to the last captain's). The Parade's bonus is `slay` the standard-bearer, a
  column General, by turn 4 (the column's unopposed arrival, recomputed), never the
  Emperor. New validator check 9 holds both of `03` §7.2's rules; test 20.
- **The Mill Ford (S4, S5).** The raiders start awake with `onWake` written onto their
  spawns, as the village's bandits are, so no patrol PR; the reserve no longer wakes on
  `tile: village`, gains `danger` and `hurt`, keeps `objective` (the derived id `village`,
  `on: 'done'`) and the `parOffset −3` clock; until `02` 2.2b and `03` PR 4 it ships
  without the `objective` wake. It writes no `objectives` (the legacy derivation is the
  same). Its estimates are unchanged (9–11); the mill's walk (4–5) is within the reserve's
  (5–6), so check 9 holds.
- **Triggers (S3).** Every `objective` trigger states `on`.
- **Dependencies (S9, S10).** §14 names each map's PRs in `01`, `02` and `03`; the vertical
  slice (§14.1) is about 20–21 working days. 20x12 maps need only `01` PR 1 and phone
  pointers; Long Road and the Parade need `01`'s desktop camera, enemy-phase follow and
  pointers. Deferrable items are marked.
- **`race` (S11)** is `03` §7.1's optional authored field; check 6 is static.
- **Old clients (S12).** §12.1: `requiresClient`, the loader refusal and slot card, and the
  prologue's hold-back (`isLocalOnlyRunSave`) until `CLOUD_SAFE_RUN_FORMAT` is raised;
  test 19. The unknown-id fallback now restores what placement overwrote
  (`setPieceFallback`, test 21).
- **Agents (S13).** This spec only runs them: `02` PR 2.0 ships seek, `03`'s kind PRs ship
  the kind reads.
- **First Light (S15)** is open question 1 with a recommendation; First Light has no Act IV,
  so the table and the Parade's First Light notes were corrected (the start-delay option
  is gone).
- **Smaller fixes.** Check 2's tile count is 9 in Act III, 10 in Act IV; the awake-at-start
  rule cites `02` §5.1; elite captains are `isBoss`, so boss enrage (par + 1 at Two Towers'
  par) is that map's anti-turtle; the bonus `capture` is now `claim`; music precedence
  for an eclipsed set piece; browser specs in lanes `run-flow` and `portrait`.

## Revision 3 changelog (2026-10-09)

- Takes in `05`'s notes: `boss: { weights }` with a keyed boss pick and `signatureOverride`
  (§3.4, §4.3, §5); shared-primary phases and `until` lists (§3.7, Long Road's drawbridge);
  the Parade's seated wake and bar phases; the clamp gate first in `05` K2; the Nightfall
  finale share 0; `05`'s set pieces and bonuses in the catalogue.

## Revision 4 changelog (2026-10-09)

Takes in a review finding (P1): the old-client guard fired only for `setPiece`, so mechanics
on maps that are not set pieces (boss kits and signatures on First Light, encounter groups,
non-legacy objectives and phases) reached older clients as ordinary format-1 saves.
- **§12.1 rewritten.** The required format is derived from a capability list (`encounters`,
  `parModel`, `objectives`, `gateTerrain`, `bossKit`, `arena`, `setPiece`), each detected in
  the node map, the locked configs, the battle checkpoint and the run fields, all mapping to
  format 2, with the ids as the exact door (a client refuses an id it lacks). `requiresClient`
  gains `requiresCapabilities`; the marker ratchets; `isLocalOnlyRunSave` recomputes the
  format from the payload. Existing names are used (`isLocalOnlyRunSave`, `pushRunSave`,
  `listLocalOnlySaves`, `loadRun`, `getSlotSummary`); the rest are marked proposed. The run
  save's existing `version: 1` is unread, so it is not reused. Revision 3's "Gate: format 3"
  became the id `gateTerrain`.
- **PR A0** splits the guard out of PR A and makes it a dependency of the earliest PR in any
  spec that can write a capability (`05` K0 and K1, `02` 2.3, 2.4, 2.6, `03` 1b, 4–7).
- **Tests 23–26.** 23 is the regression fixture (a First Light, non-set-piece boss run with a
  boss kit: requires format 2 and is held back by the cloud hold-back); 24 the key census;
  25 the false positive; 26 the ratchet. Test 19 now also covers an unknown id.
- **Slice** gains step 0 (A0), A trimmed shrinks to 2 days, the total is about 22 days, and
  the slice is the proof the rest of the catalogue waits on (README §5 "Rollout gates").
- **Open question 9** asks whether kits hold the whole run or only the boss.

## Revision 5 changelog (2026-10-10)

Takes in the owner's rung ladder (README §6, 2026-10-10).
- **§6.1.** Dusk's boss share is 0 and its set pieces are 20x12 or less (`maxSize`, a rung
  gate read by `pick` and the event hook); both validated like First Light's zeros. Dusk meets
  The Mill Ford, Two Towers, Rival Band, Caravan Under Siege and The Burning Village; Hunting
  Party (20x13) and Break the Gate (22x12) are Nightfall and up as sketched. The boss set
  pieces are Nightfall and up, Sanctum of Echoes Black Sun only.
- **§9, §10.3, §10.4.** Long Road and the Parade are marked Nightfall+ (their Dusk stones and
  Long Road's Dusk bonus note are gone; the armoury `reach` stays as the fallback).
- **§12.1, tests 14 and 23.** Act I's bosses carry no kit on any rung, so the failure story and
  test 23's regression fixture move to a First Light Act II boss (the Archmage); the
  `bossKit` node-map detection names Act II and later. Test 14 holds Dusk's limits.
- **§15.** Q5 decided (no Parade on Dusk); Q1's option (b) superseded; Notes 8 resolved.
