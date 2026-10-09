# Set pieces: authored skeletons, chunks and seeded choices

Status: proposal, revision 1 (2026-10-09). Specs only: no game code or data changes.
Branch `claude/large-maps-specs`. Roadmap phases 4–6 of the [README](README.md).
- Depends on `02` (encounter groups, triggers, contact-relative waves) and `03` (the objective
  model, phases, bonuses, par). This spec writes their fields; it never defines their rules.
- The walk and turn numbers below come from a scratch script that assembles the sketched maps
  from their chunks and runs the shipped `SeizeParFloor.turnsToReach`. They are design
  estimates, not sim results. `sim/pacing.js` measures the real maps in each content PR.

## 1. Where we are

**One generator, one template shape.**
- `generateBattle` (`MapGenerator.js:61`) wraps `generateBattleLayout` (`:72`). The layout
  picks a size from `mapSizes.json` with one draw (`pickMapSize`, `:97`, `:608`), unless a
  template has `fixedSize` (`:115-121`). Only `eldritch_sanctum` has one.
- Terrain is rolled per tile from fractional zones (`generateTerrain`, `:1034`). Then come
  structures, then the hybrid overlay (`:128-129`), then features. A Ballista is placed only
  at Nightfall+ outside Act I (`:138`).
- Enemies: `rollEnemyCount` (`:205`, `:2328`), then `generateEnemies` (`:1972`). The boss
  goes on the throne first, or an elite captain on an elite seize (`:244`, `eliteCaptains`
  `:685`); anchors come next, then the zone fill.
- Then caster gear (`:265`), carried items (`:273`), affixes (`:280`), the Sworn affix
  (`:291`) and elite area arts (`:300`).
- Then the NPC, caravan, village and escape tiles, then `ensureReachability` (`:419`), which
  carves through anything that blocks Infantry (`:2384`). Then cavalry guarantees (`:442`),
  holders (`:495`), the rout ladder (`:510`) and the Hunted wave (`:538`). The config is
  assembled at `:552`.

**Locking.**
- `BattleScene` uses `runManager.getLockedBattleConfig(nodeId)` if one exists. Otherwise it
  builds a prologue chapter, or runs `withBattleSeed(battleParams.battleSeed, () =>
  generateBattle(...))` and locks the result (`BattleScene.js:1503-1520`).
- `withBattleSeed` swaps `Math.random` for a stream seeded by that node's `battleSeed`
  (`:2463`), so every node's map is already hermetic.
- `lockBattleConfig` is write-once (`RunManager.js:3626`).
- The harness generates through the same `generateBattle` (`HeadlessBattle.js:286`), and so
  do `sim/carry.js` and `sim/eclipse.js`.

**Authored maps exist only in the prologue.**
- `parsePrologueMap` (`Prologue.js:411`) reads a legend of character to terrain name plus
  space-separated rows.
- `buildPrologueBattleConfig` (`:472`) returns the `generateBattle` shape with explicit
  spawns.
- It is gated by `isScriptedBattle` (`ScriptedBattle.js:31`: `battleParams.prologueChapter`).
  That gate suppresses the Eclipse, Guidance, deeds, villages, caravans and more, so it is
  the wrong path for standard-run content.

**Hybrid arenas v1** (`docs/specs/act4_hybrid_boss_arena_spec.md`) are absolute:
- `arenaOrigin`, `anchors` and `scriptedWaves` are `[col,row]` on a map whose size is still
  rolled (`resolveHybridAnchors` `:835`, overlay `:851`).
- Overrides apply in `BattleScene.applyDueHybridOverridesForTurn` (`BattleScene.js:2735`),
  and the harness keeps its own copy (`HeadlessBattle.js:1039`).
- Both arenas place a 4x3 Plain/Floor block at the top centre (`[7,0]`, `[6,0]`), away from
  their `right` throne (`data/mapTemplates.json`).

**Node map.**
- `generateNodeMap` (`NodeMapGenerator.js:47`) runs under `_withNodeMapSeed`
  (`RunManager.js:4440`), at run start (`:718`) and in `advanceAct` (`:4458-4466`). Every
  roll is on that one stream.
- `buildBattleParams` (`:516`) rolls a mixed row's objective as 28% seize, 12% escape
  (`isElite`) and the rest rout. Then come `battleSeed` (`:598`) and the caravan and village
  rolls, which are drawn even when they are dropped (comment at `:575-580`).
- Template choice is `pickTemplateForNode` (`:614`). Boss nodes draw from the whole seize
  pool, where `bossOnly` only permits the hybrids.
- Later passes: recruit conversion, the colosseum, the service-streak repair (`rebuildNodeAs`
  `:360`) and ambushes. The Eclipse keeps a fallen battle's params and marks it elite
  (`EclipseSystem.js:336-366`).
- Event battles call `convertNodeToRoutBattle` inside `withEclipseSeed`
  (`EventEffects.js:1071`).

**Measured here** (200 seeded node maps per act, scratch):
- An Act III map has about 3.5 non-elite rout battle nodes in rows 2–7 (0.9 of them with a
  village) and 2.8 elite nodes. Act IV has 4.7 and 1.6.
- Any one of those nodes lies on about 35% of root-to-boss paths.
- A procedural Act III seize config at 24x14 serializes to about 2.4 KB (20 seeds).

## 2. The design in one paragraph

A **set piece** is a fixed-size map. It is assembled from:
- an authored **skeleton**: a macro grid of 4–6 cells, named anchors, objectives, encounter
  groups and a deploy region;
- **chunks** from a shared library: authored tile blocks with ports on their edges, which
  may be mirrored;
- **procedural fill** for the cells the skeleton leaves open.

Seeded **choices** (`oneOf`) pick chunks and toggle groups and bonuses, so each run meets a
different plan on the same named place. A new generator path turns the set piece into an
ordinary locked `battleConfig` that also carries `setPiece`, `objectives`, `encounterGroups`
and resolved `anchors`. It is a standard battle: the Eclipse, Guidance, deeds, par, loot,
carried items, affixes and revival stones all apply, and enemy levels and classes come from
the act and the rung as on a procedural map. A pure validator in `npm run validate:data`
proves every combination is connected, overlap-free and inside the 5–12 turn band. A keyed
post-pass after node-map generation places set pieces without touching the node-map stream.

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
  "enemyCount": { "bonus": 2 },
  "huntedEntry": "reserve",
  "byRung": { "lunatic": { "groups": { "reserve": { "wake": [{ "kind": "turn", "afterContact": 2 }] } } } }
}
```

- `grid`: column widths and row heights. The map size is their sums, inside the README's
  bands (validated). A cell may `span: [cols, rows]`.
- A cell is a list of chunk references (a name, or `{ chunk, transform }`) or a `fill` id.
  A chunk must exactly fit its cell.
- Choice options carry `cells` patches. Unpatched cells keep their own list.
- **Skeleton anchors use map coordinates.** A set piece's size is fixed, so the v1 problem
  (absolute coordinates on a rolled size) cannot occur. Only chunk anchors are relative,
  because chunks move.
- `mirror: ["y"]` (optional) adds a whole-map mirror as one more choice. It remaps skeleton
  anchors, the deploy region and every chunk.
- `slots` is one or more of `ordinary`, `elite`, `event`, `boss`, `finale`. `replaces` names
  the node objectives it may stand in for. `objective` is the legacy primary kind every old
  reader sees (`03`).
- `enemyCount.bonus` is added to the act and rung count (§4.3).
- `byRung` patches groups, choices (`options[].rungs`) and bonuses for a rung and the rungs
  above it, the same hold-from-here-up rule as `events.json` `weightByRung`.
- `name` and `lore` follow the template rules (one line, ≤ 140 characters). Region labels
  and lines live in `setPieceContent.js`, under the lore style guide.

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

- **Objectives** are `03`'s model. The set piece writes `{ primary, bonus, phases }` with
  anchor names, and the generator replaces each name with its resolved tiles.
- A **phase** may carry `setTiles: [{ anchor, terrain }]`. This is how hybrid v2 changes
  terrain (§7).
- This spec uses the kinds `rout`, `seize`, `escape`, `defeat`, `protect`, `capture` and
  `destroy` for primaries, and `visit`, `protect` and `defeat` (before a turn) for bonuses. If
  `03` names them differently, the data follows `03`.
- **Encounter groups** are `02`'s `{ id, members, state, wake, onWake, telegraph }`. A set
  piece adds:
  - `region`: an anchor, where members spawn;
  - `members`: `{ min, max, share, weights?, promoted?, levelBonus?, classes? }`
    (composition, §4.3);
  - `route`: for a patrol or column, an anchor list.
- Triggers use the README vocabulary only, with anchor names resolved at generation.

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

1. Resolve choices and chunk picks on their keyed streams (§3.5). A `force` from the dev
   route wins. It is validated against the options and refused outside dev.
2. Assemble the layout: chunks with their transforms, then fills, then the whole-map
   mirror. Resolve every anchor to map tiles.
3. Features: Throne tiles come from chunks. `thronePos` is the throne of the first `seize`
   primary, for legacy readers. Ballista anchors follow §3.2.
4. Player spawns: `deployCount` tiles from the deploy region, nearest to the region's front
   (the anchor's `front` edge) first, ties by row then column. No draw.
   `formationSpares` is the rest of the region, so `FormationController` takes the authored
   branch it already has (`FormationController.js:197-205`).
5. Enemies (§4.3), then the shared gear chain unchanged: `assignCasterGear`,
   `assignEnemyCarry`, `assignAffixesToEnemySpawns`, `assignSwornAffix` and
   `assignEnemyAreaArts`, called exactly as at `MapGenerator.js:265-305`. They key on
   `templateId`, which is `setpiece:<id>`.
6. Village (when a `visit` bonus names one): `villageTile` is written from its anchor and its
   raiders are the named group. The node's `hasVillage` flag is ignored here (§6.4).
   Caravans and recruit NPCs never appear on a set piece in v1.
7. `ensureReachability` on fill tiles only (§3.6), then `validateBattleConfig` in tests.
8. Write `objectives`, `encounterGroups` (resolved regions, routes and triggers), `anchors`
   and `setPiece`.
9. Waves: `02`'s contact-relative waves become `reinforcements` (contract v1) with resolved
   spawn tiles. Set pieces never take the rout ladder (`ladder: false`) or `assignHolders`:
   their groups replace both, and rung pressure comes from `byRung`. The Hunted burden
   writes its wave at the `huntedEntry` region's nearest edge through `withHuntedWave`, so a
   Hunted run still counts its victory (`RunManager.js:4067-4078`). A set piece without
   `huntedEntry` may not take an ordinary or elite slot (validated).
10. Par fields: `parInflation`, and `parOffset` / `parFloor` as `parOffsetConfig` (`:3129`)
    computes them. `parRoute` is written as resolved legs for `03`'s par.

### 4.3 Enemies come from the act and the rung

**How many.**
- The total is `rollEnemyCount(...)` (one draw, as today) plus `enemyCount.bonus`, capped by
  `enemyCountByTiles`.
- The rung's `enemyCountBonus` and `enemyCountBase`, the deploy count and boss-node offsets
  therefore act exactly as on a procedural map.
- The total is split across the enabled groups: each takes its `min`, then the rest goes by
  `share` with the largest remainder, capped by `max` and by the region's standable tiles.
  No draw.
- Patrol and column groups count. Boss and captain slots are extra (as the boss is today).

**Which classes and levels.**
- Classes come from `enemies.pools[act]` after `filterClassPoolByDifficulty` and
  `earlyEnemyAllowed`.
- Each class is drawn through `weightedClassPick` with the group's `weights` and the pool's
  `promotedShare` (or the group's `promoted: always | never`).
- `mapExtraNecromancer` applies across the whole map.
- Levels are drawn uniformly in the act's row range plus the rung's `enemyLevelBonus` (the
  `adjustedLevelRange` of `:221-228`), plus the group's `levelBonus`.
- A group may pin `classes` only from the act's pool, or to an enemy-only class its rung
  allows (validated against `DIFFICULTY_GATED_CLASSES`). So a gated class still never appears
  early.
- Each group's draws run inside a scoped swap of `Math.random` to
  `keyedBattleRandom(battleSeed, 'setpiece:<id>:group:<groupId>')`, the `withEclipseSeed`
  pattern. The shared helpers need no RNG parameter, and editing one group never rerolls
  another.

**Spawn tiles.** Members are seated in their region by `scoreSpawnTile` (`:1654`) on the
group's stream.

**Bosses and captains.**
- A boss slot draws from `enemies.bosses[act]` with its `difficultyFilter`, the rung's
  `bossLevelBonus`, and revival stones through `revivalStoneKind` (actBoss, emperor or
  lieutenant), as `generateEnemies` does at `:1993-2090`.
- An elite slot draws from `eliteCaptains` with `isEliteCaptain` stones.
- Two captains on one map (Two Towers) are drawn without replacement on
  `'setpiece:<id>:captains'`.

**Unit fields.** Every member carries `encounterGroupId`. Group state is never a private
flag (README §3).

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

- With these numbers and the node counts of §1, a Nightfall run whose route ignored the tags
  would meet about 0.4 ordinary and 0.5 elite set pieces in Acts III–IV, plus about one boss
  set piece. The tags let a player seek them out or avoid them.
- Why a per-act chance and not a per-node one (README §4 says "per-node"): with 3–5 eligible
  nodes, a per-node chance mostly sets "one per act, always". The per-act chance is the knob
  that means something.

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
               n.battleParams.objective = sp.objective     (legacy kind; isElite unchanged)
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

- `loomModel` (`:527-553`): a node with `battleParams.setPiece` takes its set piece's `name` as
  the place, its `lore` as the line, and a `Large map` tag (`tone: 'info'`, detail "About two
  screens. Several objectives.").
- The objective row shows the primary's verb and "+ bonus" when one exists.
- Choices are **not** shown. The deploy screen shows the whole board, and Pillar 5 is about
  meeting a different plan, not reading it on a card.
- `NodeMapScene` draws a small pennant pip on the node beside the elite aura.
- A boss card shows the boss and the set piece name.

### 6.4 Later changes to a node

- **The Eclipse** keeps a fallen battle's params and marks it elite (`EclipseSystem.js:360`).
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
| `scriptedWaves.spawns[{ col,row }]` | `02` groups: asleep members already on the map, or contact-relative waves `{ region: anchor }` |

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

**Migration: none.**
- `act3_dark_champion_keep` and `act4_boss_intent_bastion` stay v1 templates in
  `mapTemplates.json`, with Phase 0's fix.
- Migrating them would change their maps for the same seed, and old locked configs carry
  `hybridArena`, `hybridAnchors` and `phaseTerrainOverrides`, so the v1 runtime must stay
  anyway.
- Long Road (§10.3) and the Parade (§10.4) are v2 from the start. Whether the v1 arenas stay
  in the boss pool is README Q4. The recommendation is to keep them at their current share
  and give each boss set piece `bossShare` 0.5, then retire the v1 arenas after a playtest
  round if players never pick them out.

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
  16 + 96 + 8 + 8 = 128 combinations, about 0.4 s.

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
   the spread across combinations is ≤ 2 turns per rung.
8. **References:** chunk, fill, choice, group and objective ids exist. Classes are allowed
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
- `03`'s par reads the same resolved `parRoute`.
- The validator checks the estimate, not par. One extra assertion: on every rung, the par
  `03` computes for the combination is at least the estimate + 3, so a direct push can reach
  an S, as the seize floor guarantees today.

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
| 16 | Rival Band | **keep** (Phase 6) | the cheapest elite: no new engine needs; at 18x10 it is below the large band, which the format allows for elite slots |

The kept ones:

| Set piece | Size | Slot | Primary / bonus (`03`) | Groups and triggers (`02`) | Choices | Reuses | New engine needs |
|---|---|---|---|---|---|---|---|
| The Mill Ford | 20x12 | ordinary III | rout / visit mill (race) | ford picket (awake), bridge hold (`danger`,`hurt`), mill guard (`groupWoken` bridge, delay 1), raiders (awake, seek village), reserve (`tile` village, `objective` mill, `turn parOffset −3`) | crossing N/S; mill N/S; bridge and ford variants | VillageSystem raze, Ballista feature, hold rules | none beyond `02`/`03` |
| Two Towers | 20x12 | elite III–IV | `defeat` both captains / `defeat` the second before turn T | road patrol (awake), two garrisons (`danger`,`hurt`), the other wakes on `objective` first captain | tower rows (4); fillers; stone bearer (Black Sun) | `eliteCaptains`, revival stones | two captains on one map |
| Long Road to the Keep | 22x14 | boss III | seize / — | road picket, outer camp (`danger`), gate guard (hold), sally (`groupWoken` camp delay 1, or `turn parOffset −4`), throne guard; phase *drawbridge* on the sally trigger | road ridge/marsh; postern N/S; variants | throne clamp, actBoss stones | `TerrainPhases` extraction |
| The Emperor's Parade | 24x14 | boss IV | seize / `defeat` the Emperor before he is seated | column (route to the throne, `danger`/`hurt` → chase), two side pods (`groupWoken` column delay 1), palace guard (hold), gate wave (Nightfall+, `turn afterContact 3`) | avenue or north street; strong flank N/S; palace variant; start delay by rung | emperor stones, seek_tile | the throne clamp skips a marching boss; arrival `tile` trigger for an enemy group (Notes) |
| Caravan Under Siege | 20x12 | event, ordinary III | `protect` the caravan to the exit / the caravan above half HP | ring (awake), two flank waves (`turn afterContact 2/4`, side relative to the caravan) | exit edge; start chunk; chaser weights | CaravanSystem walk, escape tiles | caravan as a primary (`03`) |
| Hunting Party | 20x13 | elite III | `defeat` the target before it escapes / no lord below half HP | the target's escort (moving), lane pickets (`sight`/`danger`) | 2–3 lanes; exit edge; escort class | seek_tile, escape tiles | an enemy that exits (`03`) |
| Break the Gate | 22x12 | ordinary/event IV | `destroy` the gate or `defeat` its captain, then seize / capture a ballista | outer pod (awake), inner hold, sally at `turn parOffset −2` if not breached | gate L/C/R; postern; ballista side; bridge segments | ballista, hold | a structure tile with HP |
| The Burning Village | 18x12 | event II–III | rout / `protect` villages (save 2 of 3) | raider bands per village (awake, seek) | which villages; raider classes | VillageSystem ×3 | `villages[]` instead of one `villageTile` |
| Rival Band | 18x10 | elite III–IV | rout / none | one band, `danger` | fort sides; band composition | elite captain | none |
| Sanctum of Echoes | 24x16 | finale (Entity) | `defeat` the Entity / `capture` pillars | pillar wardens (hold), echoes (waves `afterContact`) | which pillars are lit; approach chunks | Entity footprint and AI | held pillars debuff the Entity |

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

**Groups** (Nightfall Act III, total 15):

| Group | Region | Members | Start | Wake |
|---|---|---|---|---|
| ford picket | `ford_far` | 2 | awake | — |
| bridge hold | `bridge_far` | 4 | asleep | `danger`, `hurt` |
| mill guard | `village` | 3 | asleep | `groupWoken: bridge_hold` (delay 1), `danger` |
| raiders | `camp` | 3 | awake, seek `village` | — |
| reserve | `reserve` | 3 | asleep | `tile: village`, `objective: mill`, `turn: parOffset −3` |

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
- Black Sun: the reserve also wakes at `turn afterContact 2`.

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
| road patrol | 2 | awake | — |
| garrison W | 3 | asleep, `holdPack` | `danger`, `hurt`, `objective: captain_e` |
| garrison E | 3 | asleep, `holdPack` | `danger`, `hurt`, `objective: captain_w` |
| captains | 2 | throne-bound | — |

**Choices:**
- tower rows: both north, both south, or the two diagonals;
- the filler shared by the two non-tower side cells (courtyard, rubble or orchard);
- a tower chunk variant per tower (two interiors with the same gates);
- the stone bearer, on Black Sun only, where `eliteCaptain` stones are 1; on other rungs
  the stones are 0 and the choice is not offered.

That is 4 × 3 × 4 = 48 combinations, 96 on Black Sun.

**Estimate.** 9 (same row) to 11 (diagonal), from the best order.
- A first sketch with a south-gate tower variant measured 9–12. The validator would refuse
  it, since the spread was 3, so the gate variants were dropped.
- An earlier sketch with the towers in the east and deploy in the west measured 14–17, above
  the band. That is why the army now starts between the towers.

**Primary.** `defeat` both captains, not a double seize: a double seize forces one lord to
walk both thrones and added two turns in the sketch. The bonus `defeat` the second captain
before turn T rewards a fast swing.

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
- **Phase `drawbridge`.** It sets `drawbridge` (4 tiles) from Water to Bridge on the sally's
  trigger: `groupWoken: outer_camp` (delay 1), or `turn: parOffset −4`, whichever comes first.
- The sally group is already asleep in the courtyard. It wakes; nothing spawns. So the v1
  wall-on-spawn bug cannot happen, and the validator would refuse a target under a seat.
- Fliers can cross the moat and the gate pit before the bridge drops.

**Groups:**

| Group | Members |
|---|---|
| road picket (awake) | 2 |
| outer camp (`danger`, `hurt`) | 3 |
| gate guard (hold) | 2 |
| sally | 3 |
| throne guard (hold) | 2 |
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

**Why this one.**
- The Emperor is Act IV's only boss (`enemies.json` `bosses.act4`), and every run that
  reaches Act IV fights him. It is the last battle of a Dusk run.
- Only the bastion (about 17% of Act IV boss maps) gives his fight a shape. So this map
  changes the most-repeated fight in the game.
- It is also the one first map that proves a *moving* objective (`02`'s routed group),
  which Caravan Under Siege and Hunting Party then reuse.

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
- A **phase** `seated` (`tile: throne` by the column's leader) turns the column into a
  holding group and re-arms the throne clamp. Legacy `seize` holds throughout: the Seize
  command needs no living boss (appendix §1.2), so a lord cannot steal the empty throne and
  win.

**Groups:**

| Group | Members | Behaviour |
|---|---|---|
| column | Emperor + 3 (Generals and Paladins) | `route: [gate, avenue_mid \| north_street, steps, throne]`, wakes to chase on `danger`/`hurt` |
| side pod N | 2–4 | `groupWoken: column` (delay 1) |
| side pod S | 2–4 | `groupWoken: column` (delay 1) |
| palace guard | 2 | hold |
| gate wave | 2 | Nightfall+, `turn afterContact 3` at `east_gate` |

**Choices:**
- the route (avenue or north street);
- the strong flank (pod sizes 4/2 or 2/4);
- the palace variant (parade ground or gardens);
- the start delay (the column marches from T1, or T2 on First Light).

That is 8 combinations.

**Bonus.** `defeat` the Emperor before the `seated` phase: an act forge item.

**Engine needs:**
- `AIController`'s throne clamp (`AIController.js:341-353`) runs before seek-tile and filters
  its candidates. A marching boss would stand still, so the clamp must skip a unit whose
  group is on a route until `seated`.
- An arrival trigger for an enemy group (Notes for the README).

**Rungs:** emperor stones 0 / 1 / 1 / 2; the gate wave from Nightfall.

## 11. Authoring workflow and tooling

**Workflow per set piece:**
- About ½ day of skeleton design, 1 day of chunks (about 1 hour each), and 1 day of harness
  and sim tuning.
- The order: sketch on paper → chunks plus skeleton JSON → `npm run validate:data` → preview
  every combination → play two opposite combinations on the dev route → harness → `sim/pacing`.

**Preview.** Extend `tools/generateMapPreviews.js`:
- `--setPiece <id> [--combos all|<n>] [--difficulty <rung>] [--seed <s>]` renders one PNG per
  combination under `test-results/map-previews/setpieces/<id>/`.
- Each PNG overlays anchors (outlines), group regions (coloured by start state), routes
  (arrows), phase targets (hatched) and the deploy region, with the estimate printed in a
  caption.
- `tools/map-review` gains set-piece cases (`cases.json`) so the field-trial page can embed
  them.

**Dev route.**
`?devScene=battle&preset=late_act&setPiece=mill_ford&choices=crossing:bridge_south,village:north&cells=r_s:bridge_narrow&act=3&difficulty=hard&seed=42`.
- `parseDevStartupConfig` (`devStartup.js:580`) gains `setPiece`, `choices` and `cells`.
- `buildDevStartupRoute` puts `setPiece: { id, force }` on the battle node's params.
- `force` is honoured only when `devRoutesEnabled()`.

**Harness.** `tests/harness/SetPieces.test.js`:
- For every set piece, every combination, First Light and Nightfall counts (Black Sun for
  rung-only options), and 2 fill seeds, it generates the config.
- `validateBattleConfig` must report no violations, and `generateSetPieceBattle` must have
  carved no authored tile.
- `HeadlessBattle` with `ScriptedAgent` must finish within 25 turns. Turns and stalls are
  recorded.
- The full matrix runs in `test:harness`; the PR slice takes 4 combinations per set piece.

**Sims.**
- `sim/pacing.js` gains `--setPiece <id>`, which forces the set piece onto every node it
  fits, and `--setPieceShare <p>`.
- Targets per set piece, on 48 paired seeds:
  - the push median is within par − 4 … par − 2;
  - the turtle is at least 1.5 turns slower than the push (the Dusk spec's gap);
  - push turns across choices spread ≤ 2;
  - force-won stalls are no more than on the act's procedural maps.
- The TacticianAgent needs an `objectives` mode for `defeat` and for routed groups, as it
  gained for seize in Dusk PR 3.

**Art and biome.**
- One biome per map, which is what `Grid` takes today. Mill Ford, Two Towers and the Parade
  are grassland (castle walls render as plain Wall); Long Road is castle.
- The painter needs review at seams: river bends, moat corners, the drawbridge repaint
  through `Grid.setTerrainAt`, as hybrid overrides already do.
- A pennant node pip.
- A "Shallows" terrain is optional: the ford is Bog in v1.

**Music.** `music` names a key in a new `MUSIC.battleSetPiece` table or is `null`, in which
case `BattleMusicSelection` picks by biome and situation. Boss set pieces keep the boss
theme and its enrage layer.

## 12. Persistence and save size

**The config holds:**
- every procedural field (with `templateId: 'setpiece:<id>'`);
- `setPiece: { id, version, choices: { choiceId: optionId }, chunks: { cellId: { chunk, transform } } }`;
- `anchors` (tiles);
- `objectives`, `encounterGroups` and `formationSpares`.

**It never holds** chunk matrices, option lists, the skeleton or fill tables.

**Size:**
- A procedural 24x14 config measures 2.4 KB.
- A set piece adds about 1.4 KB for 15 spawns with `encounterGroupId`, about 0.6 KB for groups
  with triggers and routes, about 0.4 KB for anchors and about 0.4 KB for objectives, phases
  and the record. That is about 5 KB in all.
- An act holds at most four (one ordinary, two elite, the boss), so +12 KB worst case.
  Phase 0 prunes `battleConfigsByNodeId` at `advanceAct`, so only the current act's configs
  ride the save.

**Battle state that changes during play** rides the checkpoint, the rewind snapshot and the
snapshot validator with `02`/`03`, from the first PR: woken groups, fired triggers, the
phase, objective progress and the column's next route index. The checkpoint grows by under
1 KB.

**Run state:** `run.setPiecesOffered` (a list of ids), serialized. An old save has none.

## 13. Tests

Realistic failures first; each line is one test.

**Placement and streams:**
1. *Placement moves the node-map stream.* For 50 seeds × Acts III–IV, generate node maps
   with and without `setPieces` data. Every node's `type`, `battleSeed`, `templateId`,
   `objective`, `edges` and flags is equal, except the fields `assign` writes on assigned
   nodes.
2. *A set piece changes another node's map.* Lock and serialize the configs of every
   unassigned node on both sides of test 1: equal.
3. *Adding a set piece changes which node is chosen.* Add a dummy eligible set piece: the
   assigned node ids are unchanged.

**The validator:**

4. *A combination disconnects a lord.* Replant Long Road's first sketch: the validator names
   the combination and the move types.
5. *Seams don't line up.* Mirror a river chunk without its port: the port error names both
   cells.
6. *A transform misplaces an anchor.* In every transform of every chunk, a `throne` anchor
   lands on Throne terrain and regions keep their size.
7. *A wall rises on a seat.* A phase target inside a group region fails validation, and
   `TerrainPhases` skips an occupied tile at runtime.
8. *The estimate is out of band.* Replant Two Towers' east-only sketch (14–17): fails band
   and spread.

**Generation and play:**

9. *The same seed gives the same map.* `generateSetPieceBattle` twice with one seed: deep
   equal. A resume uses the locked config verbatim.
10. *Treated as scripted.* The `ScriptedBattleSuppression` row: Eclipse gain, Guidance, deeds
    and last words all run on a set piece.
11. *The rung leaks.* Class gates hold: no Necromancer before its act, `difficultyFilter`
    bosses, and stones per rung, all read off the spawns.
12. *Counts ignore the rung.* The total equals `rollEnemyCount` + bonus on each rung, and the
    split is stable.
13. *A data edit changes an entered map.* Lock a config, then edit its chunk in data: the
    locked map is unchanged. An unknown id falls back to the procedural template without
    throwing.

**Run layer:**

14. *Placement limits.* ≤ 1 ordinary and ≤ 2 elite per act, never adjacent, none on First
    Light ordinary (table), none in the prologue, none after `fromJSON` of an old save.
15. *Later changes to a node.* The Eclipse keeps the set piece (elite); `rebuildNodeAs` drops
    it; `hasVillage` matches the set piece.
16. *Events.* `battle.setPiece` outside the set piece's acts or slot fails `EventValidation`.
    On a gated rung the event fights a procedural rout.

**Harness and saves:**

17. *Harness parity.* Every combination plays to the end (§11), and the scene and the harness
    generate equal configs (`GridParity` style).
18. *Save size.* Every set-piece config is ≤ 8 KB serialized.

Each test is shown to fail once by planting its bug (CLAUDE.md).

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

1. **`setPiece` is refined** to `{ id, version, choices, chunks }`. `chunks` records the
   chunk picks, for the dev route and bug reports. It is still read for display and records
   only.
2. **The anchors field.** The README says anchors are resolved "on the config" but names no
   field. This spec writes `battleConfig.anchors: { name: { col,row } | { tiles: [...] } }`.
   The README's shared names should list it so `02` and `03` read the same one.
3. **An arrival trigger.** The Parade needs "an enemy group's leader ends a move on an
   anchor". The vocabulary's `tile` is player-only. Proposal: `tile` takes an optional
   `group` (default: the player's units). The alternative is a routed group's `onArrive` in
   `02`.
4. **"Per-node chance" (§4)** is implemented as a per-act chance for ordinary nodes and a
   per-node chance for elite nodes (§6.1, with the reason). The effect the README describes
   is unchanged.
5. **The rung chances live in `difficulty.json`**, not `setPieces.json`, per CLAUDE.md
   "Difficulty is data-driven". So every rung needs an entry.
6. **Elite slots may be smaller than the large band.** Rival Band is 18x10. The README's
   bands describe large set pieces; the format also serves small authored maps.
