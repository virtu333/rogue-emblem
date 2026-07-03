# Emblem Rogue — Map System Fixes & Hardening Spec

**Version:** 1.0 — July 3, 2026
**Source:** Full review of the map stack (MapGenerator, MapTemplateEngine, NodeMapGenerator, Grid/AIController consumption, and the four map data files), July 3, 2026. All line references verified against `main` at the time of writing; treat function names as the durable anchor if lines have drifted.
**Scope:** Phases 1–3 are required and well-scoped (confirmed bug fixes, validation hardening, AI pathfinding optimization). Phases 4–6 are recommended follow-ups; Phase 4 is design-sensitive and requires sim validation.
**Out of scope:** New map objectives (Defend/Survive — Roadmap item 13), new biomes beyond template additions listed in Phase 4, campaign system, minimap/rendering rework.

---

## 0. Constraints & Invariants (read first)

These apply to every phase. Violating any of them is a review-blocking defect.

1. **Battle-generation RNG discipline.** `generateBattle` runs under a seeded, monkey-patched `Math.random` (`BattleScene.withBattleSeed`, `src/scenes/BattleScene.js:2028-2052`) and the resulting config is locked per node via `lockBattleConfig`. Bare `Math.random()` inside `src/engine/MapGenerator.js` is therefore seeded — do not "fix" it, and do not introduce conditional RNG draws gated on anything other than run-constant inputs (act, difficulty, template). Adding/removing/reordering draws changes what a given seed generates; that is acceptable (configs already locked in saves are untouched), but never make a draw conditional on transient state.
2. **`NodeMapGenerator` is NOT seeded** (ambient `Math.random`). Do not change that in Phases 1–3; Phase 6 covers it.
3. **Save compatibility.** Locked battle configs and serialized node maps in existing saves must keep loading. Never remove or reorder entries in the positional `TERRAIN` enum (`src/utils/constants.js:98-118`) — it indexes into `terrain.json` by array position.
4. **Data workflow.** Edit `data/*.json` only; run `npm run sync-data` afterward so `public/data/` stays byte-identical. CI gates before PR: `npm test`, `npm run check:reference`, `npm run check:data-parity`, `npm run sim:fullrun:harness:pr`.
5. **Pure-engine pattern.** All engine changes stay Phaser-free and unit-testable via `tests/testData.js` loading real JSON from `data/`.
6. **Behavior freeze unless specified.** Where this spec says "behavior identical", add tests proving it (especially Phase 3 — pathfinding output must not regress).

---

# ═══ PHASE 1 — Confirmed Bug Fixes (required) ═══

## 1.1 `highest_level` anchor never places a unit

**Defect (verified live).** `resolveAnchorUnitClass` (`src/engine/MapGenerator.js:1516-1552`) returns `null` for `case 'highest_level'`; the caller (`generateEnemies`, `:1745-1746`) does `if (!className || anchorTiles.length === 0) continue;`, silently skipping the anchor. `chokepoint` is the only template using it (`data/mapTemplates.json`, rout, anchor `{"position":"center_gap","unit":"highest_level"}`), so its intended max-level chokepoint guard has never spawned. The level branch `anchor.unit === 'highest_level' ? maxLvlAnchor : …` at `:1754-1757` is currently unreachable.

**Fix.**
- In `resolveAnchorUnitClass`, make `case 'highest_level'` return a uniform pick from `pool.base` (same expression as the `default` case: `pool.base[Math.floor(Math.random() * pool.base.length)]`). Do NOT pick from `pool.promoted` — chokepoint runs in all acts and a promoted unit in act1 would be a difficulty spike. The "highest level" semantics come from the existing level branch (`maxLvlAnchor`), which becomes reachable.
- Leave `case 'boss_or_strongest'` as-is (correctly skipped earlier at `:1735`).
- Delete the now-misleading comment "use pool default, level handled separately".

**RNG note.** This adds exactly one draw when a `highest_level` anchor exists. Chokepoint maps generated after this change differ for the same seed — acceptable per Constraint 1.

**Tests.**
- New test in `tests/MapGenerator.test.js`: generate the `chokepoint` template (use `templateId` pre-assignment) across several seeds; assert at least one enemy spawn sits inside the resolved `center_gap` anchor tiles with `level === levelRange[1]` and is not a boss.
- Regression: assert `boss_or_strongest` anchors still place no extra unit beyond the seize boss.

## 1.2 `enemyWeights.flying` is silently ignored

**Defect (verified live).** `resolveClassWeight` (`src/engine/MapGenerator.js:1561-1621`) handles `infantry`, `cavalry`, `archer`, `mage`, `knight`, `armored`, `lance` — no `flying`. `mire_crossing` sets `"enemyWeights": { …, "flying": 1.3 }`, intending extra fliers over impassable swamp; the weight is a no-op.

**Fix.**
- Add a `flying` branch mirroring `cavalry`: `if (enemyWeights.flying !== undefined && moveType === 'Flying') { composite *= enemyWeights.flying; matched.push('flying'); }`.
- Validator side is covered in Phase 2.4 (key whitelist).

**Tests.**
- Unit test on `resolveClassWeight` indirectly via `generateBattle` with a stub template weighting `flying: 100`: assert flier classes (Pegasus Knight / Wyvern Rider per `classes.json` moveType) dominate the spawn composition. Also assert `flying: 0.0001`-style suppression works.

## 1.3 Reinforcement gating: Normal semantics made explicit; postAct fixed

**Defect (verified live + latent).** In `cloneReinforcementConfig` (`src/engine/MapGenerator.js:445-454`):
- (a) Templates carrying `"minActByDifficulty": { "hard": "act2", "lunatic": "act2" }` (all 10 standard templates: open_field, river_crossing, forest_ambush, chokepoint, corridor_siege, castle_ruins, mire_crossing, castle_assault, great_hall, hilltop_fortress) drop the entire reinforcement block on Normal because `gating['normal']` is `undefined`. The four act4 biome templates (frozen_pass, caldera, glacier_fortress, eruption_point) omit the key and DO reinforce on Normal. The data schema cannot express intent.
- (b) `meetsActThreshold` (`:439-443`) uses `ACT_GATE_ORDER = ['act1','act2','act3','act4']`; `act === 'postAct'` yields index `-1` → gated templates never reinforce in postAct at any difficulty, despite castle_assault/hilltop_fortress listing `"postAct"` in `acts`. Latent today (postAct vestigial) but will bite when Post-Act ships.

**Fix — behavior-preserving on Normal, explicit in data:**
1. Extend `ACT_GATE_ORDER` to `['act1','act2','act3','act4','postAct','finalBoss']`. This fixes (b): a `hard: "act2"` gate now passes in postAct.
2. Introduce an explicit `"never"` sentinel: in `cloneReinforcementConfig`, treat `gating[difficultyId] === 'never'` exactly like the current missing-key path (return `{}`). Keep missing-key → `{}` as defensive behavior.
3. **Data migration:** add `"normal": "never"` to `minActByDifficulty` on all 10 gated templates. This preserves current Normal gameplay exactly while making the intent visible.
4. **Validator:** in `MapTemplateEngine.js` `validateReinforcements` (`:380-396`), when `minActByDifficulty` is present, (i) require all three difficulty keys, (ii) allow values in `{'act1','act2','act3','act4','postAct','finalBoss','never'}`.

**Design flag (do NOT resolve in this PR — surface to the owner):** whether the act4 biome templates *should* reinforce on Normal is an open balance question. This spec intentionally keeps their current behavior (they do). Note it in the PR description.

**Tests.**
- `cloneReinforcementConfig` is not exported; test through `generateBattle`: (i) Normal + gated template → config has no `reinforcements` key; (ii) Hard + gated template + act1 → none; act2 → present; (iii) Hard + gated template + `act: 'postAct'` → present (this is the behavior change); (iv) Normal + frozen_pass → present (unchanged).
- Validator tests: missing `normal` key now fails; `"never"` value passes; unknown value fails.

---

# ═══ PHASE 2 — Validation Hardening (required) ═══

Rationale: several latent defects produce a **silently broken battle that gets locked into the save**. Every current template happens to be safe; nothing keeps it that way. This phase converts all of them into fail-fast errors at data-check/test time, plus two production guards.

## 2.1 New: `validateBattleConfig(config, deps)` output assertion

Add an exported pure function to `src/engine/MapGenerator.js` (or a sibling `MapValidation.js` if MapGenerator length is a concern) that checks a generated battle config:

- `playerSpawns.length === requested deployCount` (see 2.2 for the current silent-clamp path).
- No two spawns (player ∪ enemy ∪ npc) share a tile; no spawn is out of bounds; every spawn tile is passable for that unit's moveType (resolve moveType from `classes.json` for enemies/NPC; players use the generic force-passable guarantee, so check Infantry-passability of player spawn tiles).
- `objective === 'seize'` ⇒ `thronePos` non-null AND at least one `isBoss` enemy spawn exists.
- `objective === 'escape'` ⇒ `escapeTiles` non-empty and each tile passable for all four move types (mirror `sanitizeEscapeTilePassability` rules, `MapGenerator.js:1145`).
- Infantry connectivity from `playerSpawns[0]` to every enemy spawn, npcSpawn, thronePos, and escape tile (re-run the existing `bfsFromSources` machinery; this asserts `ensureReachability` did its job rather than trusting it).
- Map rectangularity: every row array has length exactly `cols` (catches the 2.3 footprint bug class).

**Wiring — do not throw in production.** Call it:
- In a new property test `tests/MapGeneratorFuzz.test.js`: generate the full matrix {act1..act4, finalBoss} × {rout, seize, escape} × {normal, hard, lunatic} × ≥25 seeds each (seed `Math.random` with Mulberry32 per the sim pattern, `sim/lib/SeededRNG.js`), assert zero violations. Include `isBoss: true` rolls and recruit battles (`isRecruitBattle: true`).
- In `generateBattle` itself behind the existing `DEBUG_MAP_GEN` flag → `console.warn` on violations (never throw — a throw during `BattleScene.create` would brick the run).

## 2.2 Player spawn capacity: fail loudly

`findPassableTiles` (`MapGenerator.js:1274-1300`) silently returns fewer tiles than requested when the `playerSpawn` zone is too small. After the existing fallback pass, if `playerSpawns.length < spawnCount`, `console.warn` with template id + zone bounds. The fuzz test (2.1) asserts it never actually happens with shipped data.

## 2.3 Entity-boss footprint: guard columns

`generateEnemies` (`MapGenerator.js:1683-1690`) guards `mapLayout[er + dr]` (row) but writes `[ec + dc]` unguarded — a template with `entitySpawn` near the right edge extends row arrays past `cols`.

- Production fix: add `&& ec + dc < cols` (and `er + dr < rows` explicitly rather than relying on the row-existence check) around both the `usedPositions.add` and the terrain write; if any footprint tile is out of bounds, `console.warn` and skip entity placement entirely (fall through to the standard-boss `console.warn` path).
- Validator fix: in `MapTemplateEngine.js` (`:839-861`), `entitySpawn` **requires** `fixedSize` (error when absent — currently footprint bounds are only checked when `fixedSize` happens to be present).

## 2.4 Close the MapTemplateEngine whitelist/validation gaps

The validator whitelists these keys but never validates them (all in `validateMapTemplatesConfig`, `src/engine/MapTemplateEngine.js:740-762`). Add:

- **`features`** — new `validateFeatures`: must be an array of objects with `type` in a known set (`Throne`, `Ballista` at minimum — derive the set from what `generateBattle:90-104` handles) and a valid `position` spec. **Rule: every `seize` template must include exactly one `Throne` feature** (mirrors the existing escape/escapeZone rule at `:470`). This kills the "seize with no throne and no boss = unwinnable" latent bug.
- **`enemyWeights`** — keys ⊆ `{infantry, cavalry, archer, mage, knight, armored, lance, flying}`; values finite and `>= 0`. (Zero stays legal but note: `weightedPick`/`weightedClassPick` return the first entry when total weight is 0 — document, don't change.)
- **`anchors`** — array of objects; `position` in the known set handled by `resolveAnchorPositions` (`throne`, `gate_adjacent`, `center_gap`, `bridge_ends`, …— enumerate from the switch at `MapGenerator.js:1415`); `unit` in the set handled by `resolveAnchorUnitClass`; optional `count` positive integer.
- **`minBridges` / `minBridgesByAct`** — positive integer, or per-act value that is a positive integer or `[min,max]` with `min <= max`.
- **`fogChance`** — finite number in `[0,1]`.
- **Scripted-wave coordinates** — when the template has `fixedSize`, validate each `scriptedWaves[].spawns[].col/row` against it.

## 2.5 Terrain-name cross-checking

Zone terrain typos are silently swallowed (`generateTerrain` does `if (idx !== -1)`, `MapGenerator.js:759`) while structures/hybridArena/phase-overrides throw. Unify at data-check time:

- Give `validateMapTemplatesConfig` an optional `options.terrainNames` (a `Set<string>`). When provided, validate **every** terrain-name reference: `zones[].terrain` keys, `structures[].terrain/interior/wallTerrain/floor/pillar`, `hybridArena.arenaTiles`, `phaseTerrainOverrides[].setTiles[].terrain`, `features[].type/terrain`.
- `tests/MapTemplateEngine.test.js` already validates the real data file — pass real `terrain.json` names there so any future typo fails CI.
- Do not change the runtime silent-skip in `generateTerrain` (a throw there is a run-bricker); the CI check is the guard.

**Acceptance for Phase 2:** all shipped data passes; each new rule has a failing-fixture test; fuzz test green over the full matrix; `npm run check:data-parity` green.

---

# ═══ PHASE 3 — AI Pathfinding: Reconstruct-First (required) ═══

## 3.1 The problem (verified)

`AIController._decideAction` builds candidate plans by calling `_buildPath` → `_findPathWithIceFallback` (`src/engine/AIController.js:249-257`, `:732-788`) for **every stoppable tile in the enemy's movement range** — and that helper always runs a full A* (`grid.findPath`) first. With mov 6-8 that is ~60-145 A* runs per enemy, ~1,000-2,000 per enemy phase late-act. `Grid.findPath` (`src/engine/Grid.js:579-639`) uses a sort-per-pop array open list with no closed set (O(V²·log V) with re-expansions). Meanwhile the Dijkstra `moveRange` computed once per enemy (`:212-220`) already contains optimal parent chains, and `grid.reconstructIcePath(moveRange, …)` — currently the *fallback* (`:787`) — produces the same optimal, ice-correct path in O(path length).

## 3.2 The change

In `_findPathWithIceFallback`:
- When `moveRange` is provided AND `moveRange.has(goalKey)`: use `reconstructIcePath` **first** and return its result. Skip A* entirely.
- When the goal is outside `moveRange` (multi-turn chase targets — `_findPathAwareChaseTile` `:562-571`, `_findShortestPathToTiles` `:649-663` call without a covering range): keep the current A*-then-validate-then-Dijkstra order unchanged.
- `_buildPath` already passes `moveRange`; verify the two chase helpers pass it where the goal can be in range, but do not force it.

This also removes the "never trust raw findPath near ice" caller-discipline hazard from the hottest call site: reconstruct-from-Dijkstra is ice-correct by construction (the range itself is computed ice-aware).

## 3.3 Secondary (same PR, optional if risky): priority queues

- Replace the sort-per-pop pattern in `Grid.getMovementRange` (`:444`) and `Grid.findPath` (`:596-598`) with a binary min-heap (small local class or inline array-heap helpers in `Grid.js` — no new dependency). Add a proper closed set to `findPath`.
- **Tie-breaking must stay deterministic** and should match current behavior where observable: current code breaks ties by insertion order after a stable sort. Give the heap a monotonic insertion counter as the tie-break key. AI decisions may not shift on equal-cost ties.

## 3.4 Behavior-freeze proof (required)

- New `tests/GridPathfinding.test.js` (this doubles as Phase 5's biggest gap): on hand-authored small layouts using real `terrain.json`, assert exact expected costs/paths for terrain-cost accounting, enemy-blocking vs ally pass-through, `stoppable` marking, ice-slide landings, and cost-modifier (`getTerrainCostReduction`) handling.
- Equivalence property test: for N random seeded layouts (with and without Ice), for every tile in `moveRange`, `reconstructIcePath` total cost === A*+`computeEffectivePath` validated cost. Run pre-change to establish the invariant, keep post-change.
- `harness/GridParity.test.js` must stay green (HeadlessGrid needs the same heap change if it shares the algorithm — check `tests/harness/`).
- `npm run sim:fullrun:harness:pr` must be behavior-identical (same seeds → same outcomes). If any sim diverges, the tie-breaking is wrong — fix that, do not re-baseline.

**Acceptance:** all above green; add a micro-benchmark note in the PR body (time for one enemy phase, 18×12 map, ~15 enemies, before/after — a simple `performance.now()` harness in a scratch test is fine, not committed).

---

# ═══ PHASE 4 — Balance & Variety (recommended, design-sensitive) ═══

Everything here changes gameplay. Each item ships behind sim evidence (`npm run sim:fullrun -- --trials N` comparisons) and gets its own commit so the owner can drop any single item.

## 4.1 Par is blind to indoor/hazard terrain

`turnBonus.json` `difficultTerrainTypes` omits Pillar (moveCost 2 for all move types), Ice, and Lava Crack; Wall (impassable) distorts real path lengths but is not a "crossing cost". Castle templates (corridor_siege/castle_ruins/great_hall, 25-35% Wall + 10-25% Pillar) get zero terrain penalty in `TurnBonusCalculator.calculatePar()` while being the slowest maps; mire_crossing got a manual `parBonus: 2`, the castle templates got none.

- Add `"Pillar"` to `difficultTerrainTypes`. Consider Ice/Lava Crack only if sims show par misses on tundra/volcano maps (hazard avoidance costs turns indirectly).
- Add `parBonus: 1` to corridor_siege and great_hall, `parBonus: 2` to castle_ruins (highest Wall density). Tune with `sim:fullrun` — target: castle-map par-hit rates within a few points of open_field's at the same act/difficulty.

## 4.2 Act 4 / escape variety collapse

`ACT_BIOME_WEIGHTS.act4` sends ~60% of rolls to tundra+volcano, which have exactly one rout and one seize template each; the escape pool has zero non-grassland templates so every act2-4 escape falls back to a grassland map regardless of run biome.

- Author 2-3 new templates in `data/mapTemplates.json`: one tundra rout variant, one volcano rout variant, one biome escape (e.g., `frozen_flight`, tundra, escape). Follow the existing schema exactly (Phase 2's validator will enforce it); reuse the reinforcement stanza shape from the sibling template of the same biome.
- Add optional per-template `weight` (positive number, default 1) consumed by `pickTemplate` (`MapGenerator.js:403-420`, replace the uniform pick with `weightedPick` over the filtered pool) and validated by MapTemplateEngine. This is the knob future variety tuning needs.
- **RNG note:** the weighted pick still consumes exactly one draw; keep it that way.

## 4.3 Node-map service guarantees (needs owner sign-off on intent)

`pickNodeType` (`src/engine/NodeMapGenerator.js:314-328`) is purely probabilistic; act1 has ≈60% chance of zero churches graph-wide, and all guarantees are graph-wide rather than per-path. If the design intends "every act offers at least one shop and one church", add a post-pass (mirroring the existing recruit-guarantee pass at `:166-189`) that converts a random mid-row BATTLE node when the graph has zero of the type. Per-path guarantees are a bigger change — flag as a follow-up decision, do not implement speculatively.

---

# ═══ PHASE 5 — Test Coverage (recommended) ═══

- `tests/GridPathfinding.test.js` — created in Phase 3.4; extend with `getAttackRange` and `getVisionRange` cases if quick.
- **AIController vs real Grid:** the existing 49 tests use a mock grid whose return shape doesn't match the real one (raw costs vs `{cost, parent, stoppable}` entries). Add `tests/AIControllerRealGrid.test.js`: instantiate the real `Grid` headlessly (it needs a scene stub for rendering — reuse whatever `harness/GridParity.test.js` does) and cover: candidate generation matches `moveRange` stoppable entries, boss throne clamping, ice-diverted movement, acidic-tile avoidance.
- Fuzz test from Phase 2.1 lives here too.

---

# ═══ PHASE 6 — Cleanup (optional, low risk) ═══

Each item is independent; commit separately.

1. **Dead code — NodeMapGenerator:** delete the unreachable `rows === 1` finalBoss branch (`src/engine/NodeMapGenerator.js:41-65`; `ACT_CONFIG.finalBoss.rows === 2`) and the never-firing backward pass (`:79-97`; row `rows-2` is always `[CENTER_COL]`). Fix the stale comments.
2. **Dead code — MapGenerator:** after 1.1, remove any remaining unreachable `highest_level` handling; delete the likely-dead old-structure `recruitPool.pool` fallback in `generateNPCSpawn` (`:2497-2530`) **only after** confirming no test or save-migration path feeds the old shape.
3. **Stale node metadata:** when a BATTLE node converts to RECRUIT/COLOSSEUM (`NodeMapGenerator.js:176-177`, `:207-208`), clear `node.templateId` (it no longer matches `battleParams`). Decide the fog asymmetry (converted recruit nodes keep the old fog roll; SHOP→RECRUIT never rolls fog): simplest is to re-roll or clear `fogEnabled` on conversion — behavior change, note in PR.
4. **Dead data:** remove `deployLimit` from `data/mapSizes.json` (real limits live in `DEPLOY_LIMITS`, `constants.js:56-63`; the Post-Act/Final Boss values are stale and misleading); keep `notes`. Remove the unused `name` field from templates or start reading it (dealer's choice; removing is cleaner). Do NOT remove the Village terrain entry (positional enum, Constraint 3) — instead add a comment in `constants.js` above `TERRAIN` documenting the positional coupling.
5. **Docs drift:** CLAUDE.md says "15 terrain types"; `terrain.json` has 19. Fix the count and mention Ice/Lava/Acidic additions.
6. **Seeded node maps (prerequisite for daily runs):** wrap `generateNodeMap` calls in `RunManager` (`:452`, `:2892`) with a seeded-RNG scope derived from `runSeed` (same install/restore pattern as `withBattleSeed`). Zero player-visible change today; unblocks seeded-run features. Needs a determinism test: same runSeed → identical node graph.
7. **Micro-perf in generation (only if touching these files anyway):** hoist `classData.find` in `scoreSpawnTile`/`resolveClassWeight` and `terrainNameToIndex` into per-`generateBattle` Maps; use the existing `resolveNormalizedRectBounds` in the 4 places that hand-roll rect→tile math (`generateTerrain:741`, `placeSpawns:1256`, `generateEnemies:1779`, `placeEscapeTiles:1175`).

---

## Deliverable & PR guidance

- One PR per phase (Phases 1+2 may combine; 3 must be its own PR given the behavior-freeze proof burden).
- Every data edit → `npm run sync-data` before committing.
- PR bodies must list: which spec section each commit implements, the design flags explicitly deferred to the owner (1.3 Normal-reinforcement question, 4.3 service guarantees, 6.3 fog asymmetry), and for Phase 3 the before/after enemy-phase timing.
- Full gate before each PR: `npm test && npm run check:reference && npm run check:data-parity && npm run sim:fullrun:harness:pr`.
