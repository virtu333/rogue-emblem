# Large maps and map variety

Status: proposal, revision 6 (2026-10-10). Takes in the notes of specs 01–05, a cross-review
of the whole set, a review finding on the old-client guard and the owner's decisions of
2026-10-10 (§6: the desktop view, the minimap, the rung ladder). Specs only: no game code or
data changes yet.
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
| [`04-set-pieces.md`](04-set-pieces.md) | the set-piece format (authored skeleton, chunk library, procedural fill, seeded choices), the validator, where set pieces appear in a run, the catalogue, the first maps, and the run-format guard for older clients (§12.1) |
| [`05-boss-maps.md`](05-boss-maps.md) | enhancing every boss battle (phases, signature mechanics, arena variants, bonus objectives, the finale) and more boss set pieces |
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
| Large set piece (Act III–IV ordinary node, elite, event battle) | 20x12 – 22x14 | about two phone screens at tactical zoom. The format also serves smaller authored maps: Rival Band, an elite, is 18x10. Dusk takes only those of 20x12 or less (§6, 2026-10-10) |
| Act boss set piece (Act III, Act IV) | 20x12 – 24x14 | an approach plus an authored arena (hybrid v2); `05`'s Dueling Halls is 22x12. Nightfall and Black Sun only (§6, 2026-10-10) |
| Finale variant | up to 24x16 | Sanctum of Echoes, Black Sun only (`05` §8.7) |
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
  - `battleConfig.bossKit` and `battleConfig.bossSignature` (`05` §4.1, §10.2): the boss
    kit a boss map was compiled from (`{ id, version }`, for display and records) and its
    one signature, resolved for the rung and locked. Everything else a kit says is
    compiled into the fields above (`objectives.phases`, `encounterGroups`, `anchors`,
    `triggeredWaves`). A resume reads the config, never the kit.

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
- objective and bonus progress;
- the boss's signature and finale state (`bossState`, `05` §5.1, §10.2: the pending tell,
  the signature count, the marked unit, the held pillars, the music latch). An old
  checkpoint without it derives it empty.

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
| `bossBar` | `{ broken: n \| 'last', fallback }` (`05` §4.3): the kit's boss has broken at least `n` Revival Stones (`'last'`: it is on its last bar). The required `fallback` (a `bossHp` or `turn` trigger, never `bossBar`) stands in, decided at compile, on a rung where the boss carries fewer than `n` stones (none, for `'last'`) | 0 |
| `bossHp` | `{ below: share }` (`05` §4.3): the kit's boss stands at `currentHP < maxHP × share` on its current bar (at 0.5, `checkBossHalfHealth`'s own test); a bar broken since the last check counts as crossed | 0 |

- `02` §3.4 defines contact precisely and deterministically.
- Each trigger fires once.
- **Default delays.** The column is a group wake's default when the trigger names none. A
  triggered wave's `delay` and a phase `until`'s default to 0 for every kind (`02` §3.4).
- **The boss kinds** are noted like `hurt` (the player's blow causes them) and read at the
  next check. Both count a fallen boss as true and may carry `latest` (a `parOffset`, or
  a legacy `{ turn: n }`), firing at the earlier.
- **A phase `until` may be a list** of triggers, any one firing (as a group's `wake` list
  is). `04`'s Long Road drawbridge needs it (`03` §6).
- **Every trigger and every phase advance is evaluated at one point**: once per enemy
  phase, at its start, with `>=` comparisons, in `02` §3.4's fixed order.
  - Group wakes and waves that name `bossBar` / `bossHp` sit right after `hurt` (slot
    2b). A phase's `until` sits after `objective` and before `turn`, whatever its kind,
    and the boss signature (`05` §5.1) resolves and plans right after the phase (slot
    7b), before `turn`.
  - Every effect of a phase's `onEnter` (terrain, wakes, and a boss kit's own effects,
    `05` §4.1) applies there.
  - The board never changes under the player's own turn. When the last primary of a
    phase resolves, the NEW OBJECTIVE band may show at once, but the change waits for the
    enemy phase (`03` §6).
  - **Phases that keep the primary** (`05` §4.5, `03` §4): when the current phase's
    primaries are the same objectives (same ids) as every later phase's, completing them is
    victory at once, in any phase. An advance between such phases shows the phase's own
    `onEnter.line` band at the check, not NEW OBJECTIVE.
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
| `engine/BossKit.js` | `05` | generation only: compiles a boss kit into the fields above, derives a procedural boss map's anchors, and places the boss arenas after the node map (`assignBossArenas`) |
| `engine/BossSignature.js` | `05` | play: resolves, plans and views the boss's one telegraphed action in `02`'s check (slot 7b); owns `bossState.signature` |

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

**Old clients.** A run carries a `requiresClient` marker and a `requiresCapabilities` list
when it holds **any** mechanic these specs add, not only a set piece (`04` §12.1):
- The format is **derived from capabilities**, each detected in the node map, the locked
  configs, the battle checkpoint and the run fields: `encounters` (groups beyond today's
  hold packs), `parModel`, `objectives` (non-legacy objectives and phases), `gateTerrain`,
  `bossKit` (kits and signatures), `arena`, `setPiece`. All map to format 2. A First Light
  boss kit is held although First Light has no set piece.
- A client too old to play it refuses to load it, and writes nothing.
- Its run save stays local-only through the prologue's existing hold-back,
  `CloudSync.isLocalOnlyRunSave`, widened to read the derived format.
- The guard is its own PR (`04` PR A0) and a dependency of the earliest PR in any spec that
  can write a capability (§5).

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
- **Never on First Light** (owner decision): its row of the table is all zeros.
- **Dusk: standard size only** (owner decision, 2026-10-10): ordinary, elite and event set
  pieces of 20x12 or less (The Mill Ford, Two Towers, Rival Band, Caravan Under Siege, The
  Burning Village), never a boss set piece. Dusk's entry carries `maxSize: [20, 12]` and a
  boss share of 0, both validated (`04` §6.1).
- **The chances are per rung**, in `difficulty.json` (`modes.<rung>.setPieces`). Every rung
  needs an entry, including `dusk`.
- **Placement is a keyed pass after node-map generation**, on hashes of the run seed and
  node id. It never draws on the node-map stream (`04` §6).
- **Event battles:** events may name a set piece (The Burning Village, Caravan Under Siege).
- **Act III and Act IV boss nodes:** boss set pieces join the boss template pool beside the
  hybrid arenas, never instead of them (owner decision 4): Long Road to the Keep and the
  Dueling Halls in Act III, The Emperor's Parade and the Battery in Act IV (`05` §8).
  **Nightfall and Black Sun only** (owner decision, 2026-10-10): Dusk meets its Act III and
  IV bosses, the Emperor included, on today's maps with their kits.
- **Boss arenas in Acts II–IV, Dusk and up** (`05` §4.4; not set pieces): today's two hybrid
  arenas gain structural variants, Act II gains one arena (`act2_doctrine_yard`), and a
  keyed post-pass gives boss nodes an arena of the drawn biome at the rung's share
  (`difficulty.json` `bossKits.arenaShare`: First Light 0, validated; Dusk and up 0.75). A
  boss set piece placed by `04`'s pass wins. First Light keeps today's v1 arenas exactly as
  they are (variant 0, where the ordinary draw picks them). Act I's arena
  (`act1_border_post`) is deferred, out of scope by owner decision.
- **Every boss battle from Act II on**, set piece or not, gets `05`'s boss kit: phases, a
  signature, a court, a bonus. First Light gets it gently (`05` §9.5: at most one gentle,
  telegraphed, never-lethal signature, no sleeping court, today's maps).
- **Act I's boss battles stay as they are on every rung** (owner decision, 2026-10-10):
  today's map, no arena, no kit, no signature, no court. Phase 0's fixes still apply.
- **Finale:** Sanctum of Echoes, the Entity's variant, on Black Sun only (`05` §8.2, §8.7;
  `04` §6.1's Nightfall finale share is 0). Nightfall and Black Sun's procedural sanctum
  gains the echo pillars.

The route map tells the player a node holds a large map before they choose it (a tag on the
node, `04`).

## 5. Roadmap

Each phase is shippable alone and leaves the game better even if the next never comes.

| Phase | What | Depends on |
|---|---|---|
| 0 | **Fixes worth doing anyway** (`02` §2): enrage never before par + 1 (`max(par+1, min(12, par+2))`); the confirmed hybrid-arena wall/wave bug; an exact binary-heap A* and an exact branch-and-bound recovery fallback; no 300 ms pause, tween or checkpoint for enemy actions the player cannot see or that do nothing, pause scaled by battle speed; prune locked configs at `advanceAct`; two bugs found by `01` (desktop [N] scrolls the HUD away, `01` §1.5.1; the enemy heal banner names a hidden target, `01` §1.5.2) | — |
| 0g | **Run-format guard** (`04` PR A0, §12.1): the capability list and its detection in the node map, locked configs, checkpoint and run fields; the `requiresClient` / `requiresCapabilities` marker; the loader refusal and slot card; `CLOUD_SAFE_RUN_FORMAT` and the widened `isLocalOnlyRunSave`. Writes no capability itself | — |
| 1 | **Camera and navigation** (`01`): desktop camera; enemy-phase follow; objective markers and off-screen pointers; jump controls; Recenter in portrait; danger overlay and fog hardening | — |
| 2 | **Encounter groups** (`02`): groups, wake triggers, contact-relative waves, and the par model `groups-v1` in its own PR. Pickets and sleeping pods on today's rout maps stay owner-gated until `sim/pacing.js` shows par holds (`02` §1.5, §9) | 0 (enrage, dead air); **0g** for PRs 2.3, 2.4, 2.6 and the first writer of `groups-v1` |
| 3 | **Objective model v2** (`03`): `objectives` with phases and bonuses; the objective strip; bonus rewards at the victory commit. First on today's maps: the village becomes a bonus objective (it keeps its in-battle payout for compatibility, `03` §9), multi-seize | 2; **0g** for PRs 1b and 4–7 |
| 4 | **Set-piece format and the first two maps** (`04`): skeleton, chunks, seeded choices, validator; The Mill Ford (Act III ordinary) and Two Towers (elite) | **0g**, and the PRs in the vertical slice below; Two Towers adds `03`'s model and `defeat` |
| 5a | **Boss enhancements on today's maps** (`05` K0–K6), from Act II (Act I stays as today on every rung): K0 arenas (variants, the Act II arena, the share, the card's third line; Dusk and up, First Light's share 0); K1 kit data, compile, the `bossBar` / `bossHp` triggers, `bossState`, the shared-primary rule, the core signature module and the Knight Commander's kit; K2–K4 the other Act II–IV kits; K5 boss-map bonuses and Vision; K6 the finale (the Lieutenant's foretell, the Entity's echo pillars, the harness's splash) | **0g for K0 and K1** (and every later K that writes a capability). K0: `02` PR 0b only. K1: `02` PRs 2.1, 2.2a, 2.2b, 2.4, 2.5 and `03` PRs 1, 1b, 3, 4 (or a trimmed **K1-lite**: `02` 2.1, 2.2a, 2.4 and the two trigger kinds). K2: K1 and `02` 2.3; K3, K4: K2; K5: K1 and `03` PR 5; K6: K2 (its pillar bonus also `03` PRs 5, 7). **No camera work**: everything plays on today's sizes. Its switches (`bossKits.enabled`, `arenaShare`) ship off and are gated apart from set pieces ("Rollout gates") |
| 5 | **Boss set pieces** (Nightfall and Black Sun only): Long Road to the Keep (Act III, 22x14), The Emperor's Parade (Act IV, 24x14), refined by `05` K7–K8 (boss weights, the drawbridge's `until` list, the Parade's bar phases) | 4 (`04` PRs E, F; the K7–K8 refinements also need 5a's K2 and K4), and **1**: these boards don't fit desktop at zoom 1, so they need the desktop camera, enemy-phase follow and pointers (`01` PRs 3–5, 7, 8) |
| 6 | **More set pieces**: Caravan Under Siege, Hunting Party, Break the Gate (needs a gate tile), The Burning Village, Rival Band; `05`'s Dueling Halls (K9) and the Battery (K10); the finale variant, Sanctum of Echoes on Black Sun (K11) | 4, plus the `03` kind each one uses; `05`'s three also 5a (K3–K6) and `01` as Phase 5 |

**Ordering.**
- **0g comes before every writer.** The run-format guard lands before the earliest PR, in
  any spec, that can write a capability (`04` §12.1 step 7): `05` K0, `02` PR 2.3 and `03`
  PR 1b are the first three, whether or not a set piece ever ships. PRs that write nothing a
  capability detects (`02` 0a–0e, 2.0, 2.1, 2.2a, 2.2b; `03` PRs 1–3) don't wait for it.
- **Phases 0 and 1 can run in parallel.** The enemy-phase camera does not wait for
  Phase 0; only the time they save adds up.
- **The dead-air fix is on the critical path,** even though it is Phase 0. A 15–25-enemy
  set piece with dormant groups that do nothing is unplayable on a phone without it.
- **20x12 boards need little from `01`.** They fit the desktop at zoom 1 (640x480 / 32 px
  = 20x15). The first two maps need only `01` PR 1 (the [N] clamp) and, on phones, the
  off-screen pointers (`01` PR 8).
- **Phase 5a runs beside the slice.** K0 needs only `02` PR 0b (and 0g) and changes Act II–IV
  boss maps on Dusk and up (First Light and Act I keep today's maps); K1 lands with `02`'s
  Phase 2 core and `03` PRs 1, 1b, 3 and 4, the same PRs Two Towers and Long Road need. Only
  `05`'s set pieces (K7–K11) wait for the camera. K0 then K1 is the cheapest large change in
  the set (`05` §12).

### Vertical slice: The Mill Ford, Dusk and up

The shortest path to a playtestable, seeded, resumable large map, measured in the sims.
About 22 working days.

0. **`04` PR A0, the run-format guard (0g):** before any writer. The Mill Ford is the first
   capability the slice writes (`setPiece`, with `parModel` and `encounters`).
1. **`02` Phase 0, two items only (PRs 0a, 0d):** the enrage floor and the dead-air fix. The A*, the
   recovery fallback and pruning can follow later.
2. **`02` encounter groups, trimmed (PRs 2.1, 2.2a):**
   - groups, the `danger` and `hurt` wakes, the hold-pack adapter, `encounterState`, and
     parity with today's holds;
   - the `groupWoken` trigger, `turn` with `parOffset`, warn bands, and always-on dormant
     outlines (`tile` ships in the same PR but the Mill Ford doesn't use it).
   - No `sight`, no patrols. The Mill Ford's raiders are a group that starts awake with
     `seek_tile`, like today's village bandits.
3. **`02` par (PR 2.5):** `groups-v1`, with `W` from `parRoute`, in its own PR.
   - Until `02` PR 2.2b and `03` PR 4 land, the Mill Ford's reserve wakes on its
     `turn parOffset` clock alone.
4. **`04` format:**
   - Trimmed: `mirrorY` only, no `byRung` patches, the core validator checks (the guard is
     step 0).
   - Then the generator, dev route and preview.
   - Then The Mill Ford itself: placement, the route-map tag, `sim/pacing --setPiece`.
5. **`03` is not needed:** the Mill Ford is rout plus the legacy village, which today's
   predicate, strip and payout already handle.
6. **`01` PR 1 only** (and the phone pointers once two fronts go off-screen).

Then **Two Towers** (about 12 more days, `04` §14.1): `03` PR 1 (the model), `03` PR 1b (`defeat` with
per-unit `clampTile`) and the map itself. Its bonus can follow with `03` PRs 3 and 5. Before **Long Road**, the first board that doesn't fit:
`01`'s desktop camera, enemy-phase follow and pointers.

### Rollout gates

Code and switches ship apart. Every mechanic these specs add is written by code that can
merge once its dependencies have, but it plays only when a data switch turns it on. The
switches are separate, so a change in difficulty can be traced to one of them.

| Switch | Data | Ships | Numbers owned by |
|---|---|---|---|
| set pieces | `difficulty.json` `modes.<rung>.setPieces` | all zero; then the Mill Ford alone, on Dusk and up | `04` PR C |
| boss kits | `modes.<rung>.bossKits.enabled` | `false` on every rung | `05` K1–K6 |
| boss arenas | `modes.<rung>.bossKits.arenaShare` | 0 on every rung; First Light's stays 0 for good (validated, §6 2026-10-10) | `05` K0 |
| rout pods | `encounterPlan.rout` | `null` | `02` PR 2.6 (owner-gated already) |

- **Guard first.** No switch is turned on until the release that carries `04` PR A0 has
  reached clients (the wait `04` §12.1 step 7 states). A writer merging dark needs no wait.
- **Prove the slice before the catalogue.** The Mill Ford is the bounded slice: encounter
  groups, `groups-v1` par from `parRoute`, a locked and resumable config, and the guard in the
  field. No other switch is turned on until its exit criteria hold, none of them new:
  - `sim/pacing.js --setPiece` meets `04` §10.1's estimates and `02` §7's measures on Dusk,
    Nightfall and Black Sun (turn band, turtle − push gap, force-won stalls no worse than
    today's);
  - both browser specs (`04` §13) pass, including the refresh mid-battle;
  - test 23 (the First Light boss-kit run held back) and test 19 pass in CI, and a Mill Ford
    run on the dev route is seen to stay out of `run_saves`;
  - the owner has played it.

  Only then Two Towers, the boss set pieces, `bossKits.enabled`, `arenaShare` and
  `encounterPlan.rout`, each in its own change with its own sim report.
- **Boss kits are their own rollout.** Kits change the difficulty of Act II–IV and finale boss
  battles on every rung, First Light included (gently), whereas set pieces are rare and never
  on First Light. A
  set-piece change never turns kits on and a kit change never raises a set-piece chance, so a
  move in boss win rates, par or enrage can be pinned on one change. `bossKits.enabled` goes on
  rung by rung, each with `05` §11's `sim/pacing.js --bossKits` report.

## 6. Owner decisions

### Owner decisions (2026-10-09)

1. **How often:** at most one set piece per act on ordinary nodes, plus a chance on elite
   nodes (`04` §6.1's table; the chances are tuned in its PR C).
2. **First Light:** no set pieces at all. It is the intro difficulty. First Light may still
   get the boss enhancements that are not set pieces (`05`). **Narrowed on 2026-10-10** (the
   ladder below): no Act I kit or arena, no new arena or arena variant, a 0 arena share, at
   most one gentle signature; `05` §9.5 now reads: from Act II, the kits with gentler values
   and no sleeping or patrolling courts, on today's maps exactly as they are (the procedural
   seize templates, the v1 hybrid arenas at variant 0, the sanctum); one kit bonus per boss
   map, never paying Vision. This answers `05` Q1 and Q10. The old-client guard does not
   exempt it: a First Light boss kit requires the newer client like any other capability
   (`04` §12.1).
3. **Bonus rewards:** a bonus may pay a Vision charge. Act III+, at most once per act,
   never on First Light (`03` §7.4). It may be offered on any Act III+ set-piece or
   boss-map bonus; `05`'s boss-map bonuses offer it on half their draws (`05` §6).
4. **Boss maps:** enhance today's boss maps rather than replace them. The hybrid arenas stay
   in the pool. `05-boss-maps.md` plans the enhancements and more boss set pieces.
5. **Desktop default view: decided 2026-10-10** (below): open on the whole board, so every
   map up to 20x13 opens exactly as today.
6. **Minimap: decided 2026-10-10** (below): none until the first set pieces are playtested.

### Owner decisions (2026-10-10)

1. **Desktop default view:** a battle opens on the whole board (`01` §2.3's recommendation,
   `01` Q1). Every map up to 20x13 opens exactly as today; a larger board opens at Overview.
2. **Minimap:** none until the first set pieces are playtested (`01` §2.9's
   recommendation, `01` Q2). Overview, pointers, jumps and `03`'s strip carry navigation.
3. **The rung ladder for boss enhancements and set pieces.** The owner left the details to
   the specs and agreed this rule: **the Act I boss stays simple everywhere; scale grows with
   the rung.**

   | Rung | Act I boss | Act II boss | Act III–IV bosses | Ordinary / elite set pieces | Boss set pieces |
   |---|---|---|---|---|---|
   | First Light | today's map, nothing new | today's map; at most one gentle, telegraphed, never-lethal signature; no sleeping court; no new arena or arena variant | today's arenas (variant 0) + that gentle signature; no sleeping court | none | none |
   | Dusk | today's map, nothing new | new arenas, arena variants, sleeping courts and the full signature start here | full boss enhancements on today's arenas and their variants | standard size only (20x12 or less: The Mill Ford, Two Towers, Rival Band and the other maps of that size) | none (no Long Road, Parade, Dueling Halls or Battery) |
   | Nightfall / Black Sun | today's map, nothing new | as Dusk | full enhancements | all | all the large boss set pieces (Long Road 22x14, The Emperor's Parade 24x14, the Dueling Halls, the Battery); the finale variant (Sanctum of Echoes) on Black Sun only |

   - **"Act I boss: today's map, nothing new"** means no Act I arena, no Act I kit or
     signature and no court, on every rung. Phase 0's fixes (`02` §2) still apply. `05`
     keeps its Act I designs (§7.1, `act1_border_post`) marked deferred, out of scope by
     this decision; K0 and K1 no longer deliver them, and the Act I bosses are `kitless`.
   - **First Light's arena share is 0** (validated), so it meets no new arena and no variant.
     Today's v1 hybrid arenas stay as they are where the ordinary template draw picks them.
     The new Act II arena is reached only through the share post-pass (`05` §4.4), so the
     ordinary draw never brings it to First Light either.
   - **"Full signature" on Dusk** is read as the kit's own values (its tile counts, aura
     values, wave sizes), not First Light's gentler ones. Whether Dusk's volley may kill
     stays `05` Q2; until it is answered `volleyLethal` stays false on Dusk.
   - **First Light's kit, otherwise,** keeps `05` §9.5's gentle reading (courts compiled to
     awake guards, a tier-1 affix at most at the half, one bonus that never pays Vision).
   - **Dusk's set-piece row** carries `maxSize: [20, 12]` and a boss share of 0, both
     validated (`04` §6.1). `04` Q5 (the Parade always on Dusk?) is answered no: Dusk's last
     battle is the Emperor's kit on today's maps and the bastion's variants. Hunting Party
     (20x13) and Break the Gate (22x12) are over the size, so they are Nightfall and up as
     sketched.
   - **The guard is unchanged.** A First Light run with kits on still holds the `bossKit`
     capability and requires the newer client (`04` §12.1); test 23's fixture moves from
     Act I to a First Light Act II boss (the Archmage), since Act I has no kit.
   - `05` Q1 and Q10 are answered by this ladder (`05` §9.5, §13).

Each spec ends with its own open questions.

**Next.** Phase 0 is being implemented as small, separately reviewed PRs from `main`.

## Changelog

- **Revision 4 (2026-10-09):** takes in `05`'s notes: the `bossBar` / `bossHp` trigger kinds
  (slot 2b), the signature slot (7b), `until` lists, the shared-primary phase rule,
  `bossKit` / `bossSignature` / `bossState`, `BossKit.js` and `BossSignature.js`, boss arenas
  in every act, Sanctum of Echoes on Black Sun only, First Light's reading of `05` §9.5,
  Vision on any Act III+ set-piece or boss-map bonus, the boss band from 20x12, and roadmap
  Phase 5a.

- **Revision 5 (2026-10-09):** takes in a review finding (P1) on the old-client guard. The
  required client format is now **derived from the capabilities a run holds** (`encounters`,
  `parModel`, `objectives`, `gateTerrain`, `bossKit`, `arena`, `setPiece`), detected in the node
  map, locked configs, battle checkpoint and run fields, not from `setPiece` alone, so a First
  Light boss kit is held back with no set piece anywhere (`04` §12.1, tests 23–26). The guard
  is its own PR, `04` A0 (roadmap 0g), and a dependency of the earliest PR in any spec that can
  write a capability (`05` K0 and K1, `02` 2.3, 2.4, 2.6, `03` 1b and 4–7). New "Rollout gates":
  separate data switches, boss kits gated apart from set pieces, and the Mill Ford slice
  proven before the broader catalogue is switched on. The slice is about 22 days.

- **Revision 6 (2026-10-10):** the owner's decisions of 2026-10-10 (§6): the desktop opens on
  the whole board; no minimap until the set pieces are playtested; the rung ladder (Act I's
  boss stays today's map on every rung; First Light from Act II gets at most one gentle
  signature on today's maps, arena share 0; Dusk adds the Act II arena, variants, sleeping
  courts and full signatures, and only set pieces of 20x12 or less; the boss set pieces are
  Nightfall and up, the finale variant Black Sun only). §2's size bands, §4, the roadmap's
  Phases 5a and 5 and the rollout gates follow.
