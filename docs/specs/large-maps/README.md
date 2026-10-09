# Large maps and map variety

Status: proposal, revision 3 (2026-10-09). Takes in the notes of specs 01–04 and a cross-review
of the whole set. Specs only: no game code or data changes yet.
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
   centres the grid on the fixed 640x480 canvas (`Grid.js:534`), so 20x15 is the most it
   can show, at zoom 1 with no margin. Today's 20x13 maps already put the desktop HUD
   plates over the board's corners.
2. **Space is not used.**
   - Enemy count does not grow with area: about 11.5 enemies from 20x13 to 40x24.
   - Every rout enemy chases the nearest player from turn 1. There is no aggro radius,
     patrol or trigger.
   - Hold packs exist only on Dusk+ seize and escape maps.
   - The result on a big map: a walk of 3–5 turns, then a trickle of enemies. On 40x24 the
     first attacks spread over T5–T11, and 10–40% of enemies never reach the player.
   - At set-piece sizes (16x12–22x14) the walk is not the problem. First contact is still
     T2–T4, and 73–79% of rout enemies engage by T6. The problem is that the whole army
     arrives as one undifferentiated wave (`02` §1.5).
3. **Clocks are absolute.**
   - Boss enrage is `min(12, par + 2)`, while par grows with area.
   - At 40x24 a seize map enrages 6–8 turns before par.
   - Within the 24x16 ceiling the cap binds only on First Light. There it applies on every
     boss map, and from 22x14 up every boss map enrages at or before par (`02` §1.5,
     §2.1).
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
   land inside the player's deploy zone.
   - There is also a **live bug, confirmed** on the real `HeadlessBattle` (`02` §2.2). A
     phase override turns an anchor tile into Wall on the same turn a scripted wave spawns
     there.
   - On First Light and Dusk, half of each scripted wave is blocked.
   - On Nightfall and Black Sun, the wall is raised under a guard that has already
     arrived.
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
   - Par is computed from the primary objective's route. `02` §5.2 owns the formula, and
     its walk term comes from `battleConfig.parRoute` (§3).
   - A bonus objective costs turns on purpose, and the strip says roughly how many.
   - Bonuses pay in a different currency from the clock: gold, items, a forge step, rarely
     Vision. Never XP.
7. **Nothing wakes or arrives unannounced.** Every wake is visible or told:
   - A dormant group's reach is outlined on the board at all times, not only under the
     Danger overlay (`02` §3.8).
   - Otherwise the wake is told ("The garrison stirs", a horn from the gate).
   - The design log rejects ambush spawns that aren't telegraphed (`docs/design-log.md`).
8. **Same rules everywhere.** Every new rule lives in a pure engine module that `BattleScene`
   and `HeadlessBattle` both call, as `HoldActivation` and `PostCombatEffects` do. The sims
   keep measuring the real game.

### Size bands

| Use | Size | Notes |
|---|---|---|
| Ordinary procedural battles | unchanged (10x8 … 18x13) | `mapSizes.json` keeps its entries |
| Large set piece (Act III–IV ordinary node, elite, event battle) | 20x12 – 22x14 | about two phone screens at tactical zoom. The format also serves smaller authored maps: Rival Band, an elite, is 18x10 |
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
  - `battleConfig.encounterGroups` (`02` §3.2): a list of
    `{ id, members, state, wake, onWake, route, loop, telegraph }`.
    - `state` is `picket | dormant | patrol | awake`. It was `asleep` in revision 1,
      renamed so it can't be confused with the Sleep status. The player never reads the
      word; they see "Holding" or "Unaware".
  - `battleConfig.anchors` (`04`): `{ <name>: { tiles } }`, the named points and regions
    resolved to tiles at generation. Markers (`01`), triggers (`02`) and objectives
    (`03`) all read this one field.
  - `battleConfig.setPiece` (`04`): `{ id, version, choices, chunks }`, the set piece,
    the seeded choices it took and the chunks it picked. Read for display and records,
    never for rules: the rules read the fields above.
  - `battleConfig.parRoute` (`02` §5.2, `04` §8.3): the legs of the primary route, used for
    the walk term `W` in par.
    - Set pieces write it at generation.
    - Legacy maps derive it: seize → the throne, escape → the nearest exit, rout → the
      group posts.
    - `03`'s `parAdjust` carries only terms that are not walking (survive turns, a
      structure's `parTurns`, boss bars). It is added inside `02`'s formula, so the walk
      is never paid twice.

**Unit fields.**
- An enemy carries its group's id in `unit.encounterGroupId`. The id rides
  `serializeBattleUnit`, as `holdPack` and `_raisedCount` do.
- The group's wake state lives in battle state (`02` §6: `encounterState`), never in a
  private flag on a unit. It rides the suspend checkpoint.

**Battle state that changes during play** rides the suspend checkpoint, the Vision rewind
snapshot and the snapshot validator together, from the first PR. It covers:
- woken groups;
- fired triggers;
- the current phase and the turn it started (`objectiveState.phaseStartedTurn`, `03`);
- objective and bonus progress.

**Triggers.** One vocabulary, used by group wakes, waves and phases. `delay` counts whole
enemy phases.

| kind | fires when | default `delay` |
|---|---|---|
| `danger` | a player unit stands in a member's move+attack reach, as the player sees it | 0 |
| `sight` | a member sees a player unit (fog maps) | 0 |
| `hurt` | a member is damaged, moved, killed or given a status (today's hold rule, `HoldDisturbance`) | 0 |
| `groupWoken` | another named group wakes | 1 |
| `tile` | a player unit (or, with `by: { group }`, a named enemy group) ends a move on a named anchor or region | 0 |
| `objective` | a named primary or bonus objective is `done` or `failed` (`03`'s words); `on` defaults to `done` | 1 |
| `turn` | a turn **relative to contact, par or phase**: `{ afterContact: n, latest: { parOffset } }` (`latest` is required, so a turtle can't postpone it), `{ parOffset: -k }`, or `{ afterPhase: n }` (`03`). An absolute `{ turn: n }` exists only for legacy waves | 1 |

- `02` §3.4 defines contact precisely and deterministically.
- Each trigger fires once.
- **Every trigger and every phase advance is evaluated at one point**: once per enemy
  phase, at its start, with `>=` comparisons, in `02` §3.4's fixed order.
  - A phase's `until` sits after `objective` and before `turn`.
  - Every effect of a phase's `onEnter` (terrain, wakes) applies there.
  - The board never changes under the player's own turn. When the last primary of a
    phase resolves, the NEW OBJECTIVE band may show at once, but the change waits for the
    enemy phase (`03` §6).
- A group that starts `awake` applies its `onWake` at battle start. For example,
  raiders seeking a village are written onto their spawns as `aiMode` / `aiTargetTile`,
  exactly as the village's bandits are today (`02` §3.3).
- Fired triggers are recorded in battle state, so a resume or rewind replays nothing and
  skips nothing.
- Boss enrage is not a trigger kind. It stays the battle-wide wake it is today.
- **Two kinds of clock** (`02` §2.1):
  - Clocks that punish waiting count from par.
  - Clocks that answer an attack count from contact, and always carry a `latest` bound
    based on par.

**Shared modules.** Each is pure and called by both `BattleScene` and `HeadlessBattle`:

| Module | Spec | Role |
|---|---|---|
| `engine/EncounterGroups.js` | `02` | groups, wake, `onWake` |
| `engine/EncounterTriggers.js` | `02` | evaluates triggers for groups, waves and phases |
| `engine/TerrainPhases.js` | `02` | `applyTerrainSetTiles(grid, setTiles, anchors, { occupants })`: the one terrain override, used by hybrid arenas and `03`'s phases. It never writes a tile its occupant can't stand on. `02` PR 0b extracts it; `03` and `04` only call it |
| `engine/BattleObjectives.js` | `03` | the one victory, failure and progress predicate |
| `engine/BonusSettlement.js` | `03` | judges bonuses once, at the victory commit |

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
- **Act III and IV ordinary nodes:** a per-act chance that one ordinary node takes a set
  piece (at most one per act).
- **Elite nodes** (mid-act seize and escape, today's `isElite`): a chance per node, at most
  two per act, from the elite set pieces (Two Towers, Hunting Party, Rival Band).
- **No two set-piece nodes are joined by an edge.**
- **The chances are per rung**, in `difficulty.json` (`modes.<rung>.setPieces`). Every rung
  needs an entry, including `dusk`.
- **Placement is a keyed pass after node-map generation**, on hashes of the run seed and
  node id. It never draws on the node-map stream (`04` §6).
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
| 0 | **Fixes worth doing anyway** (`02` §2): enrage never before par + 1 (`max(par+1, min(12, par+2))`); the confirmed hybrid-arena wall/wave bug; an exact binary-heap A* and an exact branch-and-bound recovery fallback; no 300 ms pause, tween or checkpoint for enemy actions the player cannot see or that do nothing, pause scaled by battle speed; prune locked configs at `advanceAct`; two bugs found by `01` (desktop [N] scrolls the HUD away, `01` §1.5.1; the enemy heal banner names a hidden target, `01` §1.5.2) | — |
| 1 | **Camera and navigation** (`01`): desktop camera; enemy-phase follow; objective markers and off-screen pointers; jump controls; Recenter in portrait; danger overlay and fog hardening | — |
| 2 | **Encounter groups** (`02`): groups, wake triggers, contact-relative waves, and the par model `groups-v1` in its own PR. Pickets and sleeping pods on today's rout maps stay owner-gated until `sim/pacing.js` shows par holds (`02` §1.5, §9) | 0 (enrage, dead air) |
| 3 | **Objective model v2** (`03`): `objectives` with phases and bonuses; the objective strip; bonus rewards at the victory commit. First on today's maps: the village becomes a bonus objective (it keeps its in-battle payout for compatibility, `03` §9), multi-seize | 2 |
| 4 | **Set-piece format and the first two maps** (`04`): skeleton, chunks, seeded choices, validator; The Mill Ford (Act III ordinary) and Two Towers (elite) | the PRs in the vertical slice below; Two Towers adds `03`'s model and `defeat` |
| 5 | **Boss set pieces**: Long Road to the Keep (Act III, 22x14), The Emperor's Parade (Act IV, 24x14) | 4, and **1**: these boards don't fit desktop at zoom 1, so they need the desktop camera, enemy-phase follow and pointers |
| 6 | **More set pieces**: Caravan Under Siege, Hunting Party, Break the Gate (needs a gate tile), The Burning Village, the finale variant | 4, plus the `03` kind each one uses |

**Ordering.**
- **Phases 0 and 1 can run in parallel.** The enemy-phase camera does not wait for
  Phase 0; only the time they save adds up.
- **The dead-air fix is on the critical path,** even though it is Phase 0. A 15–25-enemy
  set piece with dormant groups that do nothing is unplayable on a phone without it.
- **20x12 boards need little from `01`.** They fit the desktop at zoom 1 (640x480 / 32 px
  = 20x15). The first two maps need only `01` PR 1 (the [N] clamp) and, on phones, the
  off-screen pointers (`01` PR 8).

### Vertical slice: The Mill Ford, Dusk and up

The shortest path to a playtestable, seeded, resumable large map, measured in the sims.
About 20 working days.

1. **`02` Phase 0, two items only:** the enrage floor and the dead-air fix. The A*, the
   recovery fallback and pruning can follow later.
2. **`02` encounter groups, trimmed:**
   - groups, the `danger` and `hurt` wakes, the hold-pack adapter, `encounterState`, and
     parity with today's holds;
   - the `groupWoken` and `tile` triggers, `turn` with `parOffset`, warn bands, and
     always-on dormant outlines.
   - No `sight`, no patrols. The Mill Ford's raiders are a group that starts awake with
     `seek_tile`, like today's village bandits.
3. **`02` par:** `groups-v1`, with `W` from `parRoute`, in its own PR.
4. **`04` format:**
   - Trimmed: `mirrorY` only, no `byRung` patches, the core validator checks.
   - Then the generator, dev route and preview.
   - Then The Mill Ford itself: placement, the route-map tag, `sim/pacing --setPiece`.
5. **`03` is not needed:** the Mill Ford is rout plus the legacy village, which today's
   predicate, strip and payout already handle.
6. **`01` PR 1 only** (and the phone pointers once two fronts go off-screen).

Then **Two Towers** (about 9 more days): `03`'s model PR, `defeat` with per-unit
`clampTile`, and the map itself. Before **Long Road**, the first board that doesn't fit:
`01`'s desktop camera, enemy-phase follow and pointers.

## 6. Open questions for the owner

1. **How often:** at most one large set piece per act on ordinary nodes, or more?
2. **First Light:** do set pieces appear there, or from Dusk up only? As written, `04` gives
   First Light boss set pieces but no ordinary or elite ones. The most-played rung would
   then meet sleeping groups and phases first at an act boss. Recommendation: keep First
   Light's boss maps on today's arenas until the at-point-of-use Guidance notes ship
   (`02` §3.8, `03` §11.2). Then allow one ordinary set piece on First Light, so the
   mechanics are met before the boss.
3. **Bonus rewards:** may a bonus pay Vision charges (rare, Act III+), or only gold, items and
   forge steps?
4. **Boss maps:** do boss set pieces join the pool beside today's hybrid arenas, or replace
   them?
5. **Desktop default view:** open on the whole board (fit), or at tactical zoom framed on the
   army like the phone? `01` recommends the whole board: every map up to 20x13 then opens
   exactly as today.
6. **Minimap:** a corner minimap, or rely on the objective strip, jump controls, pointers and
   Overview? `01` recommends no minimap until the first set pieces are playtested.

Each spec ends with its own open questions; these six are the ones that shape more than
one spec.
