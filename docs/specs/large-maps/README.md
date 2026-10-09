# Large maps and map variety

Status: proposal, revision 1 (2026-10-09). Specs only: no game code or data changes yet.
Branch `claude/large-maps-specs`.

This folder plans bigger, more ambitious battle maps: more kinds of maps, more than one
objective on a map, bonus objectives, staged encounters, flanks and multiple fronts. Large
maps are mostly **set pieces**: a few larger Act III–IV maps (special maps and elite fights)
and bigger boss and endgame maps. Ordinary procedural battles keep their sizes.

| Doc | What it covers |
|---|---|
| this README | why, the evaluation, the pillars, shared names and rules, the roadmap, open questions |
| [`01-camera-and-navigation.md`](01-camera-and-navigation.md) | the desktop battle camera, the enemy-phase camera, objective markers, off-screen pointers, jump controls, the tactical overview, low-zoom readability, rendering cost |
| [`02-encounters-and-pacing.md`](02-encounters-and-pacing.md) | encounter groups (pickets, sleeping pods, patrols), wake triggers, waves timed by contact rather than absolute turns, enemy count, par and enrage on big maps, enemy-phase dead air, pathfinding cost |
| [`03-objectives.md`](03-objectives.md) | the objective model: primary objectives (new kinds), phases, bonus objectives, rewards, the objective strip, par |
| [`04-set-pieces.md`](04-set-pieces.md) | the set-piece format (authored skeleton, chunk library, procedural fill, seeded choices), the validator, where set pieces appear in a run, the catalogue, the first maps |
| [`appendix-current-systems.md`](appendix-current-systems.md) | a reference to today's code for objectives, battle config, AI modes, reinforcements, node map, NPCs and rewards (snapshot of 2026-10-08; line numbers drift) |

## 1. Evaluation (2026-10-08)

Four read-only investigations, with benchmarks run on the real `HeadlessBattle` and
`AIController`.

**What already holds:**
- **Generation.** `generateBattle` over every template at 24x16, 32x20 and 40x24 (990
  configs per size): no throws, no new `validateBattleConfig` violations, under 16 ms each.
  Zones, structures and escape zones are fractions of the map, so they scale.
- **No size cap.** The 20x13 maximum is only what `mapSizes.json` lists.
- **Logic is cheap.** An enemy phase costs 11–16 ms at 18x13 and about 23 ms at 40x24
  (about 80 ms with 35 enemies), on desktop.
- **Saves.** A locked config grows from about 2.4 KB to 4 KB, and a suspend checkpoint by
  10–15 KB at 40x24.
- **Phones already pan.** Above about 16x11, the whole board on an 844x390 phone is less
  than the readable 30 CSS px per tile, so most Act III maps already need pan and zoom.

**What blocks or plays badly:**
1. **Desktop has no battle camera.** `BattleCameraController` is built only when
   `mobileCameraEnabled`, which defaults to `isMobile` (`runtimeFlags.js:72`). Desktop
   centres the grid on the fixed 640x480 canvas (`Grid.js:534`), so 20x15 is a hard limit.
2. **Space is not used.**
   - Enemy count does not grow with area: about 11.5 enemies from 20x13 to 40x24.
   - Every rout enemy chases the nearest player from turn 1. There is no aggro radius,
     patrol or trigger.
   - Hold packs exist only on Dusk+ seize and escape maps.
   - The result on a big map: a walk of 3–5 turns, then a trickle of enemies. On 40x24 the
     first attacks spread over T5–T11, and 10–40% of enemies never reach the player.
3. **Clocks are absolute.**
   - Boss enrage is `min(12, par + 2)`, while par grows with area. A large seize map
     enrages 6–8 turns before par; at 20x13 it is already slightly before.
   - Template waves (T5/T8), the rout ladder and anti-turtle pressure all assume today's
     walking distances.
4. **Enemy-phase dead air.**
   - Every enemy, idle or hidden, costs a fixed 300 ms that the speed setting does not
     scale (`AIController.js:129`).
   - Hidden enemies still tween.
   - Nothing moves the camera during the enemy phase.
5. **Big procedural maps are featureless.** Terrain is rolled per tile; `MAX_FORTS = 4`,
   the cavalry carve budget is 16, and bridge count is fixed.
6. **Absolute coordinates in the two hybrid boss arenas.** On wide maps their scripted waves
   land inside the player's deploy zone. Reading the code also suggests a live bug: a phase
   override turns an anchor tile into Wall on the same turn a scripted wave spawns there
   (`02` §8).
7. **Navigation.**
   - No minimap, no off-screen pointers, no jump to boss or objective, no framing of a
     selected unit's range.
   - At 32x20 the whole-board Overview is 12–15 CSS px per tile.
8. **Pathfinding hitches.** A* re-sorts its open set with no heap. The stuck-enemy recovery
   fallback runs up to 13 A* per target: 75–155 ms at 40x24 on desktop, so about 0.4–0.8 s
   on a phone.

**History.**
- Rows were cut to 13 in February for HUD readability, and the specs of that time ruled out
  a camera redesign.
- "Map sizes: keep" (`dusk-pressure.md`) and the TestFlight beta froze sizes.
- No playtester has asked for bigger maps. This is a design bet, not a fix, which is why
  §5 builds the shared foundations first and proves the concept on a few maps.

## 2. Pillars

1. **Size is bought with decisions, not tiles.** Every 40 or so tiles of a large map hold
   something the player would route for or around: a village, a ford, a ballista, a second
   throne, a flank road. A region with nothing to decide about is cut.
2. **The clock is the enemy, not the walk.** At MOV 3–5 an army crosses 20–40 tiles in a
   whole battle. On a large map the enemy comes in stages (pods that wake, fronts that open),
   or the player starts inside the action. Never an edge facing an empty field.
3. **Readable as two or three named regions** ("the ford", "the mill", "the ridge road"). Big
   maps get authored macrostructure with procedural detail, never procedural noise at
   scale.
4. **Two fronts at most.** A deploy of 5–8 splits into two groups of 3–4. One front can be
   delayed (a timed gate, a sleeping pod), so splitting is a choice rather than a
   requirement.
5. **Variation is structural.** Per run, the plan changes: which gate is open, which flank the
   wave uses, which chunk is the ford, where the village sits. Rerolled terrain noise does
   not count.
6. **Fair under par.**
   - Par is computed from the primary objective's route.
   - A bonus objective costs turns on purpose, and the strip says roughly how many.
   - Bonuses pay in a different currency from the clock: gold, items, a forge step, rarely
     Vision. Never XP.
7. **Nothing wakes or arrives unannounced.** Every wake is visible (Danger draws it) or
   told ("The garrison stirs", a horn from the gate). The design log rejects untelegraphed
   ambush spawns (`docs/design-log.md`).
8. **Same rules everywhere.** Every new rule lives in a pure engine module that `BattleScene`
   and `HeadlessBattle` both call, as `HoldActivation` and `PostCombatEffects` do. The sims
   keep measuring the real game.

### Size bands

| Use | Size | Notes |
|---|---|---|
| Ordinary procedural battles | unchanged (10x8 … 18x13) | `mapSizes.json` keeps its entries |
| Large set piece (Act III–IV ordinary node, elite, event battle) | 20x12 – 22x14 | about two phone screens at tactical zoom |
| Act boss set piece (Act III, Act IV) | 20x14 – 24x14 | an approach plus an authored arena (hybrid v2) |
| Finale variant | up to 24x16 | optional, per rung |
| Ceiling | 24x16 (384 tiles) | beyond this the walk dominates even with staging; 40x24 is out |

## 3. Shared names and rules

The four specs use these names. A spec may refine a field but not rename it.

**Battle config.**
- New fields are written at generation and locked into `run.battleConfigsByNodeId` like
  every other field. Nothing is re-rolled on load.
- A config without them behaves exactly as today. Old saves and old locked maps never
  change.
- `battleConfig.objective` (the string `rout | seize | escape`) stays. It remains the
  primary kind for every legacy reader. The new fields are:
  - `battleConfig.objectives` (`03`): `{ primary: [...], bonus: [...], phases: [...] }`.
  - `battleConfig.encounterGroups` (`02`): a list of
    `{ id, members, state, wake, onWake, telegraph }`.
  - `battleConfig.setPiece` (`04`): `{ id, choices }`, the set piece and the seeded
    choices it took. Read for display and records, never for rules: the rules read the
    fields above.

**Unit fields.**
- An enemy carries its group in `unit.encounterGroupId`.
- Wake state lives on the group's battle state (`02`), never in a private flag.
- It rides `serializeBattleUnit` and the suspend checkpoint, as `holdPack` and
  `_raisedCount` do.

**Battle state that changes during play** rides the suspend checkpoint, the Vision rewind
snapshot and the snapshot validator together, from the first PR. It covers:
- woken groups;
- fired triggers;
- the current phase;
- objective and bonus progress.

**Triggers.** One vocabulary, used by group wakes, waves and phases:

| kind | fires when |
|---|---|
| `danger` | a player unit stands in a member's move+attack reach, as the player sees it |
| `sight` | a member sees a player unit (fog maps) |
| `hurt` | a member is damaged, moved or killed (today's hold rule) |
| `groupWoken` | another named group wakes; carries `delay` (whole enemy phases, default 1) |
| `tile` | a player unit ends a move on a named anchor or region |
| `objective` | a named primary or bonus objective completes or fails |
| `turn` | a turn **relative to contact or par**: `{ afterContact: n }` or `{ parOffset: -k }`. An absolute `{ turn: n }` exists only for legacy waves |

- Each trigger fires once.
- Fired triggers are recorded in battle state, so a resume or rewind replays nothing and
  skips nothing.

**Anchors.**
- Named points and regions (`throne`, `gate`, `ford`, `village_a`, `exit`, `camp`) are
  resolved at generation into tile coordinates on the config.
- Rules read the resolved tiles, never fractions or template data.

**Determinism.**
- No new draw on any existing stream.
- Set-piece choices, chunk picks and group composition use keyed streams
  (`keyedBattleRandom`-style hashes of the run seed, node id and a purpose key), as
  `EnemyCarry` and `AccessorySkills` do.
- Adding a set piece to the game never changes another map for the same seed.

**Prologue.** It is unchanged. Set pieces are standard-run content; `isScriptedBattle`
keeps meaning the prologue.

**Names stay data.**
- Set-piece names, region names and objective verbs live in data and content files.
- Player-facing words follow `docs/lore-style-guide.md`.

## 4. Where large maps appear

`04` has the rules; in short:
- **Act III and IV ordinary nodes:** a set piece replaces the procedural map at a small
  per-node chance, at most one per act, from Act III on.
- **Elite nodes** (mid-act seize and escape, today's `isElite`): a higher chance, and the
  elite set pieces (Two Towers, Hunting Party, Rival Band).
- **Event battles:** events may name a set piece (The Burning Village, Caravan Under Siege).
- **Act III and Act IV boss nodes:** boss set pieces join the boss template pool beside the
  hybrid arenas (Long Road to the Keep, The Emperor's Parade).
- **Finale:** an optional Entity variant, gated by rung.

The route map tells the player a node holds a large map before they choose it (a tag on the
node, `04`).

## 5. Roadmap

Each phase is shippable alone and leaves the game better even if the next never comes.

| Phase | What | Depends on |
|---|---|---|
| 0 | **Fixes worth doing anyway** (`02`): par-relative enrage; the hybrid-arena wall/wave fix; a binary-heap A* and a capped recovery fallback; no 300 ms or tween for idle or hidden enemies, delay scaled by battle speed; prune locked configs at `advanceAct` | — |
| 1 | **Camera and navigation** (`01`): desktop camera; enemy-phase follow; objective markers and off-screen pointers; jump controls; Recenter in portrait; danger overlay and fog hardening | — |
| 2 | **Encounter groups on today's templates** (`02`): pickets and sleeping pods on every objective, wake triggers, contact-relative waves. Measured with `sim/pacing.js` before and after | 0 |
| 3 | **Objective model v2** (`03`): `objectives` with phases and bonuses; the objective strip; bonus rewards at the victory commit. First on today's maps: the village becomes a bonus objective, multi-seize | 2 |
| 4 | **Set-piece format and the first two maps** (`04`): skeleton, chunks, seeded choices, validator; The Mill Ford (Act III ordinary) and Two Towers (elite) | 1, 2, 3 |
| 5 | **Boss set pieces**: Long Road to the Keep (Act III), The Emperor's Parade (Act IV) | 4 |
| 6 | **More set pieces**: Caravan Under Siege, Hunting Party, Break the Gate (needs a gate tile), The Burning Village, the finale variant | 4 |

Phases 0 and 1 can run in parallel. Phases 2 and 3 are the expensive design work, and every
later phase depends on them.

## 6. Open questions for the owner

1. **How often:** at most one large set piece per act on ordinary nodes, or more?
2. **First Light:** do set pieces appear there, or from Dusk up only?
3. **Bonus rewards:** may a bonus pay Vision charges (rare, Act III+), or only gold, items and
   forge steps?
4. **Boss maps:** do boss set pieces join the pool beside today's hybrid arenas, or replace
   them?
5. **Desktop default view:** open on the whole board (fit), or at tactical zoom framed on the
   army like the phone?
6. **Minimap:** a corner minimap, or rely on the objective strip, jump controls and Overview?
   (`01` recommends the latter first.)
