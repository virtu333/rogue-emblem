# Set pieces: authored skeletons, chunks and seeded choices

Status: proposal, revision 1 (2026-10-09). Specs only: no game code or data changes.
Branch `claude/large-maps-specs`. Roadmap phases 4–6 of the [README](README.md).
- Depends on `02` (encounter groups, triggers, contact-relative waves) and `03` (the objective
  model, phases, bonuses, par). This spec writes their fields; it never defines their rules.
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
`battleConfig` plus `setPiece`, `objectives`, `encounterGroups` and `anchors`; it is a
standard battle whose enemies come from the act and rung. A validator in `validate:data`
proves every combination connected and inside 5–12 turns. A keyed post-pass places set
pieces without touching the node-map stream.

## 3. The format

### 3.1 Files

| File | Holds | Runtime copy |
|---|---|---|
| `data/setPieces.json` | `{ version, setPieces: [skeleton…] }` | `public/data/` by `sync-data`, as every data file |
| `data/mapChunks.json` | `{ version, legend, ports, chunks: [chunk…] }` | same |
| `difficulty.json` `modes.<rung>.setPieces` | placement chances per rung (§6) | snapshotted into `difficultyModifiers`, as `routLadder` |
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
  `capture`, `reach`. The skeleton's `objective` must equal `03`'s
  `legacyObjectiveKind(objectives)`.
- Terrain changes are `03` phases' `onEnter.setTiles: [{ anchor, terrain }]` (§7). A phase
  may keep the same primary and exist only to change terrain and wake groups.
- **Encounter groups** are authored here and written as `02` §3.2's schema
  (`{ id, members: [spawn indices], state, wake, onWake, route, loop, telegraph }`). The
  authoring form replaces `members` with `region` (an anchor, where they spawn) and `size:
  { min, max, share, weights?, promoted?, levelBonus?, classes? }` (§4.3), plus the
  skeleton's `overflow` group id. States are `02`'s `picket | dormant | patrol | awake`
  (README §3); `onWake` modes `hunt | guard | seek | retake`; a column is a `patrol` with
  `loop: false`.
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
  `setPiece` and falls through to the procedural path with the node's kept `templateId`
  (§6.4).
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
6. A `visit` bonus writes `villageTile` from its anchor; its raiders are the named group. No
   caravans or recruit NPCs in v1.
7. `ensureReachability` on fill tiles only (§3.6).
8. Write `objectives`, `encounterGroups` (resolved regions, routes, triggers), `anchors`
   (README §3: `{ <name>: { tiles } }`, a point being one tile), `setPiece`.
9. Waves: authored arrivals become `reinforcements.triggeredWaves` (`02` §4). No rout
   ladder (`ladder: false`) and no `assignHolders`: groups replace both, and rung pressure
   comes from `byRung`. Hunted writes its wave at the `huntedEntry` region's
   nearest edge through `withHuntedWave`, so a Hunted victory still counts
   (`RunManager.js:4067-4078`); ordinary and elite set pieces must declare `huntedEntry`.
10. Par: a set piece has `dormant`/`patrol` groups, so it takes `02` §5.2's `groups-v1` model
    (W from the primary route, S from the engagements on it) plus `03`'s `parAdjust`, with
    `parInflation` and `parOffsetConfig` (`:3129`) as today. The resolved `parRoute` legs feed
    `02`'s W and the §8.3 estimate alike.

### 4.3 Enemies come from the act and the rung

- **How many** (`02` §5.1's budget). `base = rollEnemyCount(...)` with `enemyCountBonus: 0`
  (one draw, as today), so the deploy count, `enemyCountBase` and boss offsets act as on a
  procedural map. The total is `min(round(enemyCount.scale × base), 1.6 × base)` (`scale`
  default 1.3), split over enabled groups: each takes its `min`, the rest by `share` (largest
  remainder, ties on `'setpiece:<id>:split'`), capped by `max` and the region's standable
  tiles. The rung's `enemyCountBonus` then goes to the `overflow` group (default the picket).
  Awake-at-start members stay ≤ `base` (validated). Bosses and captains are extra, as today.
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
  revival stones by `revivalStoneKind` (as `generateEnemies` at `:1992-2090`); elite slots
  from `eliteCaptains` with `isEliteCaptain` stones. Two captains are drawn without
  replacement on `'setpiece:<id>:captains'`.
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
  skipped when another fits.
- `fog` false (the default) deletes the node's `fogEnabled`. The fog roll was already drawn,
  so the stream does not move.

**Proposed rung table** (`difficulty.json` `modes.<id>.setPieces`; every rung needs an entry,
validated like the other rung tables):

| Rung | ordinary chance per act (III / IV) | elite chance per node | boss share (III / IV) | finale share |
|---|---|---|---|---|
| First Light | 0 / 0 (README Q2) | 0 | 0.5 / 0.5 | — (the Lieutenant) |
| Dusk | 0.5 / 0.5 | 0.25 | 0.5 / 0.5 | — (ends at the Emperor) |
| Nightfall | 0.6 / 0.6 | 0.3 | 0.5 / 0.5 | 0.5 |
| Black Sun | 0.7 / 0.7 | 0.35 | 0.5 / 0.5 | 0.5 |

With §1's node counts, a Nightfall route that ignored the tags would meet about 0.4 ordinary
and 0.5 elite set pieces in Acts III–IV, plus about one boss set piece. The tags let a player
seek them out or avoid them. (Why per act, not per node: Notes 2.)

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
assign(n, sp): n.battleParams.setPiece = { id: sp.id }
               n.battleParams.objective = sp.objective     (03's legacyObjectiveKind; isElite unchanged)
               n.battleParams.objectivePreview = { primary: [kinds], bonus: [kinds] }   (03 §11)
               n.battleParams.hasVillage = sp has a visit bonus
               delete n.fogEnabled unless sp.fog
               (node.templateId is kept as the fallback)
```

- `pick` is weighted by each set piece's `weight`, after `acts`, `slots`, `replaces`, rung
  gates and `setPiecesOffered`.
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
- Then, if the set piece fits the act and rung, it sets `battleParams.setPiece` and the
  legacy `objective`. Otherwise the event fights its procedural rout, so the event still
  works on a rung where the set piece is gated.
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
- A v2 config carries resolved tiles only. Phase terrain changes run in one pure module,
  `engine/TerrainPhases.js`, extracted from `BattleScene.applyDueHybridOverridesForTurn`
  (`:2735`) and the harness copy (`HeadlessBattle.js:1039`). The harness copy is then deleted
  (CLAUDE.md "residual gap").
- The module keeps v1's ordering (terrain first, then arrivals) and checks occupancy: a
  `setTiles` target under a unit is skipped and logged.
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
- More than **256** combinations is an error: bind cells to a choice instead.
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
2. The deploy region has at least `DEPLOY_LIMITS[act].max + 2` (10) tiles standable by
   Infantry, Armored and Cavalry.
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
6. **Races** declared by a bonus (`race: { group, fastMov, slowMov }`): a unit at `fastMov`
   reaches the anchor before the group's arrival phase, and one at `slowMov` does not. The
   race is part of the design, so the validator holds it.
7. **The turn band** (§8.3): the estimate is in [5, 12] for every combination and rung, and
   the spread across combinations is ≤ 2 turns per rung. `02` §5.1's budget holds (awake at
   start ≤ base, total ≤ 1.6 × base) at the rung's smallest and largest base.
8. **References:** chunk, fill, choice, group and objective ids exist; `03`'s objective
   validator passes on the resolved model (≤ 2 bonuses, legacy kind, refs). Classes are allowed
   for the acts and rungs. `byRung` keys are rungs. Every slot requirement holds
   (`huntedEntry` for ordinary and elite).

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
- `02` §5.2's W reads the same resolved `parRoute`.
- The validator checks the estimate, not par. One extra assertion: on every rung, the locked
  par (`groups-v1` + `parAdjust`) is at least the estimate + 3, so a direct push can reach an
  S, as the seize floor and `02`'s `W + 3 + bossTurns` floor intend.

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
| 15 | Sanctum of Echoes | **keep** (Phase 6, Nightfall+) | the finale variant; capture points that weaken the Entity |
| 16 | Rival Band | **keep** (Phase 6) | the cheapest elite: no new engine needs (18x10: Notes 5) |

The kept ones:

| Set piece | Size | Slot | Primary / bonus (`03`) | Groups and triggers (`02`) | Choices | Reuses | New engine needs |
|---|---|---|---|---|---|---|---|
| The Mill Ford | 20x12 | ordinary III | rout / `visit` the mill (race) | ford picket (`picket`), bridge hold (`dormant`: `danger`, `hurt`), mill guard (`dormant`: `groupWoken` bridge), raiders (`awake`, `seek` village), reserve (`dormant`: `tile` village, `objective` mill, `turn parOffset −3`) | crossing N/S; mill N/S; bridge and ford variants | VillageSystem raze, Ballista feature | none beyond `02`/`03` |
| Two Towers | 20x12 | elite III–IV | `defeat` both captains / `reach` the armoury | road patrol (`patrol`), two garrisons (`dormant`: `danger`, `hurt`, `objective` the other captain) | tower rows (4); fillers; armoury tower; stone bearer (Black Sun) | `eliteCaptains`, stones, `03`'s per-unit `clampTile` | none beyond `02`/`03` |
| Long Road to the Keep | 22x14 | boss III | seize / — | road picket, outer camp (`dormant`), gate and throne guards (`dormant`), sally (`dormant`: `groupWoken` camp, `turn parOffset −4`); phase *drawbridge* on the sally's trigger | road ridge/marsh; postern N/S; variants | throne clamp, actBoss stones | `TerrainPhases` (`02` §2.2) |
| The Emperor's Parade | 24x14 | boss IV | seize / `slay` the Emperor by turn par − 4 | column (`patrol`, `loop: false`, route to the throne), two side pods (`dormant`: `groupWoken` column), palace guard (`dormant`), gate wave (Nightfall+, `triggeredWaves` `afterContact 3`) | avenue or north street; strong flank; palace variant; start delay | emperor stones, `02`'s column, `tile by: group` | the clamp waits for a marching column (§10.4) |
| Caravan Under Siege | 20x12 | event, ordinary III | `escort` the caravan / `slay` the raid captain | ring (`picket`), two flank waves (`triggeredWaves`, side relative to the caravan) | exit edge; start chunk; chaser weights | CaravanSystem, `03`'s `advanceEscort` | none beyond `03` |
| Hunting Party | 20x13 | elite III | `assassinate` the target / `unbloodied` | the target's escort (`dormant`, `onWake: seek` exit), lane pickets (`sight`, `danger`) | 2–3 lanes; exit edge; escort class | `03`'s `calibrateFlight` | none beyond `03` |
| Break the Gate | 22x12 | ordinary/event IV | `destroy` the gate, then seize (phases) / `capture` a ballista | outer pod (`picket`), inner `dormant`, sally `turn parOffset −2` if not breached | gate L/C/R; postern; ballista side; bridge segments | `03`'s Gate and Strike | none beyond `03` |
| The Burning Village | 18x12 | event II–III | rout / `rescue` 2 of 3 villages | raider bands per village (`awake`, `seek`) | which villages; raider classes | VillageSystem | several villages on one map (`03`'s `rescue`) |
| Rival Band | 18x10 | elite III–IV | rout / — | one band (`dormant`: `danger`) | fort sides; band composition | elite captain | none |
| Sanctum of Echoes | 24x16 | finale (Entity) | `defeat` the Entity / `capture` the pillars | pillar wardens (`dormant`), echoes (`triggeredWaves`) | which pillars are lit; approach chunks | Entity footprint and AI | held pillars weaken the Entity |

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
| mill guard | `village` | 3 | `dormant` | `groupWoken: bridge_hold` (delay 1), `danger` |
| raiders | `camp` | 3 | `awake`, `onWake: { mode: 'seek', anchor: 'village' }` | — |
| reserve | `reserve` | 3 | `dormant` (the `overflow` group) | `tile: village`, `objective: mill`, `turn: parOffset −3` |

**Bonus.** `visit` the mill (village gold plus the act's convoy item, as `VillageSystem`
pays). The raiders reach it in their third enemy phase. Of the player's units, a MOV 6 rider
or flier gets there on turn 3; MOV 5 and infantry arrive on turn 4 and must kill the raiders
instead. That is `race: { fastMov: 6, slowMov: 5 }`.

**Estimate.** 16 combinations: 9–11 by the bridge (the ford plan is 11–13 and is not the par
route). All four move types reach every anchor.

**Rungs:**
- First Light: not placed (table §6.1).
- Dusk: as above with Dusk counts.
- Nightfall: the Ballista anchor on the mill is live.
- Black Sun: the reserve also wakes at `turn afterContact 2` (`latest: parOffset −2`).

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
| garrison W | 3 | `dormant` | `danger`, `hurt`, `objective: captain_e` |
| garrison E | 3 | `dormant` | `danger`, `hurt`, `objective: captain_w` |
| captains | 2 | `dormant`, each with its own `clampTile` (`03` §5.2) | as their garrison |

**Choices:**
- tower rows: both north, both south, or the two diagonals;
- the filler shared by the two non-tower side cells (courtyard, rubble or orchard);
- a tower chunk variant per tower (two interiors with the same gates);
- which tower holds the armoury (the `reach` bonus, a back-room cache);
- the stone bearer, on Black Sun only, where `eliteCaptain` stones are 1; on other rungs
  the stones are 0 and the choice is not offered.

That is 4 × 3 × 4 × 2 = 96 combinations, 192 on Black Sun.

**Estimate.** 9 (same row) to 11 (diagonal), from the best order.
- A first sketch with a south-gate tower variant measured 9–12. The validator would refuse
  it, since the spread was 3, so the gate variants were dropped.
- An earlier sketch with the towers in the east and deploy in the west measured 14–15 in
  the best order, above the band. That is why the army now starts between the towers.

**Primary.** Two `defeat` objectives, `captain_w` and `captain_e`, both required (legacy
`rout`), so each fall emits its own `objective` event for the other garrison's wake. Not
`03` §5.2's double seize: a lord would have to walk throne to throne (4–6 turns), which puts
the estimate at 12–14. The `reach` bonus is the detour: the armoury sits behind the far
tower's back door.

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
- **Phase `drawbridge`** (`03` §6, same seize primary): `until` is the sally's trigger
  (`groupWoken: outer_camp`, delay 1, or `turn: parOffset −4`, whichever comes first), and the
  next phase's `onEnter` sets `drawbridge` (4 tiles) from Water to Bridge and wakes `sally`.
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
- Stones: 0 on First Light and Dusk, 1 on Nightfall and Black Sun, so the boss leg is +1 there.
  Black Sun's extra members go to the sally, which comes to the player, so the estimate stays
  ≤ 12.
- Nightfall+: the sally fallback is `turn parOffset −5`.

### 10.4 The Emperor's Parade (Act IV boss, 24x14)

**Why this one.** The Emperor is Act IV's only boss (`enemies.json` `bosses.act4`): every run
that reaches Act IV fights him, and on Dusk it is the last battle. Only the bastion (about 17%
of Act IV boss maps) gives that fight a shape today. It is also the first map to prove a
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
- The column is `02`'s `patrol` with `loop: false`: at the throne it stops and holds. A phase
  `seated` (`until: { kind: 'tile', anchor: 'throne', by: { group: 'column' } }`, `02` §3.4)
  wakes the palace guard and arms the Emperor's `clampTile`. Seize holds throughout: Seize
  needs no living `isBoss` (appendix §1.2), so a lord cannot take the empty throne and win.

**Groups:**

| Group | Members | Behaviour |
|---|---|---|
| column | Emperor + 3 (Generals and Paladins) | `patrol`, `loop: false`, `route: [gate, avenue_mid \| north_street, steps, throne]`; wakes to `hunt` on `danger`/`hurt` |
| side pod N | 2–4 | `dormant`: `groupWoken: column` (delay 1) |
| side pod S | 2–4 | `dormant`: `groupWoken: column` (delay 1) |
| palace guard | 2 | `dormant` |
| gate wave | 2 | Nightfall+, `triggeredWaves` `afterContact 3` (`latest: parOffset −2`), `side: 'anchor:east_gate'` |

**Choices:**
- the route (avenue or north street);
- the strong flank (pod sizes 4/2 or 2/4);
- the palace variant (parade ground or gardens);
- the start delay (the column marches from T1, or T2 on First Light).

That is 8 combinations.

**Bonus.** `slay` the Emperor by turn par − 4, about when he would be seated (gold + forge
step, `03` §7.4).

**Engine need.** The throne clamp (`AIController.js:341-353`) filters candidates before the
seek-tile pipeline, so a boss with a `clampTile` would never march. `03`'s per-unit
`clampTile` is written for the Emperor, but the clamp skips a member of a `patrol` group
until its column reaches its last anchor. The arrival trigger is `02`'s `tile` with
`by: { group }`.

**Rungs:** emperor stones 0 / 1 / 1 / 2; the gate wave from Nightfall.

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
spread ≤ 2; no more force-won stalls than the act's procedural maps. `TacticianAgent` needs an
`objectives` mode for `defeat` and routed groups, as it gained one for seize in Dusk PR 3.

**Art.** One biome per map, as `Grid` takes today: grassland for the Mill Ford, Two Towers and
the Parade, castle for Long Road. The painter needs a review at seams (river bends, moat
corners) and of the drawbridge repaint through `Grid.setTerrainAt`, which hybrid overrides
already use. A pennant node pip. The ford is Bog in v1; a "Shallows" terrain is optional.

**Music.** `music` names a key in a new `MUSIC.battleSetPiece` table, or is `null` and
`BattleMusicSelection` picks by biome and situation. Boss set pieces keep the boss theme and
its enrage layer.

## 12. Persistence and save size

**The config holds:**
- every procedural field (with `templateId: 'setpiece:<id>'`);
- `setPiece: { id, version, choices: { choiceId: optionId }, chunks: { cellId: { chunk, transform } } }`;
- `anchors` (tiles);
- `objectives`, `encounterGroups` and `formationSpares`.

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

**Run state:** `run.setPiecesOffered` (a list of ids), serialized. An old save has none.

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
| 14 | placement limits broken | ≤ 1 ordinary and ≤ 2 elite per act, never adjacent, none on First Light ordinary, none in the prologue or after `fromJSON` of an old save |
| 15 | later changes to a node | the Eclipse keeps the set piece as elite; `rebuildNodeAs` drops it; `hasVillage` matches |
| 16 | a bad event hook | `battle.setPiece` outside the acts or slot fails `EventValidation`; a gated rung fights a procedural rout |
| 17 | scene and harness differ | every combination plays to the end (§11); scene and harness generate equal configs (`GridParity` style) |
| 18 | the save grows | every set-piece config is ≤ 8 KB serialized |

## 14. PR breakdown

| PR | Content | Effort |
|---|---|---|
| A | Format and validator: the two data files with test chunks only, `SetPieceFormat.js`, `SetPieceValidation.js` in `validate:data`, sync, parity; tests 4–8 | 4–5 days |
| B | Generator: `generateBattle` dispatch, `SetPieceGenerator.js` (assembly, fill scope, groups to spawns, gear chain, `formationSpares`, config fields), `HeadlessBattle` deps, the dev route, the preview tool; tests 9–13, 17–18. Needs `02` and `03` PR 1 | 5 days |
| C | The Mill Ford and placement: `SetPiecePlacement.js`, the `difficulty.json` table, the RunManager hooks, `setPiecesOffered`, the loom tag and place helper, the node pip, `sim/pacing --setPiece`; tests 1–3, 14–15 | 4 days + 1 tuning |
| D | Two Towers: elite placement, two captains, the `objective` trigger use | 3 days + 1 tuning |
| E | Hybrid v2: the `TerrainPhases.js` extraction (delete the harness copy), occupancy check, phase validation; Long Road to the Keep | 5 days |
| F | The Emperor's Parade: the throne clamp gate, routed column, `seated` phase, arrival trigger | 5 days |
| G… | Phase 6, one PR each: the event `setPiece` hook (test 16) with Caravan Under Siege, Hunting Party, Rival Band, The Burning Village (`villages[]`), Break the Gate (structure HP), Sanctum of Echoes | 3–6 days each |

PRs A and B can land before any content; C is the first a player sees.

## 15. Open questions for the owner

1. **First Light.** Boss set pieces on every rung but ordinary and elite ones from Dusk up
   (the table)? Or none at all on First Light? (README Q2.)
2. **The per-act chance.** Does 0.5–0.7 per act on ordinary nodes, plus about 0.3 per elite
   node, give the right frequency? That is about two large maps per run, counting bosses.
   (README Q1.)
3. **The hybrid arenas.** Keep them in the boss pool beside Long Road and the Parade, at a
   0.5 share each, or retire them once the boss set pieces ship? (README Q4.)
4. **Showing choices.** Should the route card hint at the plan ("the bridge is held") or only
   name the place? This spec names the place only.
5. **The Parade on Dusk.** It is the run's final battle there. Should Dusk always get the
   Parade, as a finale, rather than a 0.5 share?
6. **Two Towers' primary.** Is `defeat` both captains (recommended) acceptable, or must it
   read as a double seize?
7. **The finale variant.** Should Sanctum of Echoes replace the Entity's sanctum at a share,
   or only on Black Sun?

## Notes for the README

Revision 2 of the README already takes in this spec's `battleConfig.anchors`, `tile` with
`by: { group }` and `engine/TerrainPhases.js`. What remains:

1. **`setPiece` is refined** to `{ id, version, choices, chunks }`. `chunks` records the
   chunk picks, for the dev route and bug reports. It is still read for display and records
   only.
2. **"Per-node chance" (§4)** is implemented as a per-act chance for ordinary nodes, then
   one node, and a per-node chance for elite nodes (§6.1). With 3–5 eligible ordinary nodes
   an act, a per-node chance mostly means "one per act, always"; the per-act chance is the
   knob that means something. The effect the README describes is unchanged.
3. **The rung chances live in `difficulty.json`** (`modes.<rung>.setPieces`), not
   `setPieces.json`, per CLAUDE.md "Difficulty is data-driven", so every rung needs an entry.
4. **Two Towers is `defeat`, not a double seize.** `03` §5.2 names Two Towers as its
   multi-seize example. With the army between the towers, a lord walking throne to throne
   puts the estimate at 12–14 turns, at or over the band, so the first map uses `defeat`
   both captains (legacy `rout`) and keeps multi-seize for a later, tighter map (open
   question 6).
5. **Elite slots may be smaller than the large band.** Rival Band is 18x10. The README's
   bands describe large set pieces; the format also serves small authored maps.
