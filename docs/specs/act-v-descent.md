# Act V: The Descent

Owner request (2026-10-11): build out the final act. Today Act V (`finalBoss`) is two nodes, the
Ruins and the last fight. It should be a fight down to the end: a mini-boss, a few smaller nodes,
special events, and the court circle's summoning broken on the way. The Lieutenant is fought on
every rung that reaches the act.

Status: design agreed with the owner on 2026-10-11 (structure, the Vigil, the Rite carrying into
the finale, no Echoes yet); engine plan from a read of `main` at 1c4bb64. Numbers marked *tune* are starting values for the sims (§11).

## 1. Today

- `ACT_CONFIG.finalBoss = { name: 'Final Battle', rows: 2 }`. The generator has no final-act case:
  row 0 is `rows-2` and becomes the Ruins, row 1 is the boss (`NodeMapGenerator.pickNodeType`).
  The player sees two nodes and no battle row.
- Who reaches the act:

| Rung | Acts | Act III boss | Last boss | The Lieutenant |
|---|---|---|---|---|
| First Light (`normal`) | I–III, V | Blade Lord / Iron Wall / Berserker King | the Lieutenant | the finale |
| Dusk | I–IV | same | the Emperor | a vision in the Act III boss fight |
| Nightfall (`hard`) / Black Sun (`lunatic`) | I–IV, V | same | the Entity | a vision in the Act III boss fight |

- Both finales are fought on `eldritch_sanctum`. Nothing in the act can fall to the Eclipse, no
  event can be drawn there, its battle loot is gold only, and `elites.finalBoss` does not exist.
- The story already points at what is missing. Sera's cold open: "A ring of robed mages,
  chanting in the dark. Every word they speak falls through the floor and never lands." The court
  circle runs the ritual and has never been fought as a body. Acts I–III say "I can feel the
  lieutenant watching" and "so is the lieutenant" on every road, and on three rungs of four he
  never comes. `enemies.json` `elites.postAct` (Warden of the Rite, Ritual Blade, Ash Magus,
  Oathbreaker) is data that never spawns.

## 2. The shape

The act is an authored route with seeded variety, one per rung group. Ids are save data: the act
stays `finalBoss`. The player-facing name becomes **The Descent** (`ACT_CONFIG.name`, the loom
header, the act card).

### 2.1 First Light and Dusk: the Lieutenant is the end

```
row 0   The Old Kings' Stair        battle (set piece old_kings_stair)
row 1   Mortuary Column | Act V event      fork: battle (set piece mortuary_column) or an event
row 2   The Vigil                   mini-boss (set piece the_vigil)
row 3   The Ruins                   unchanged (rest or scavenge)
row 4   The Lieutenant              finale (set piece the_glass), ends the run
```

- **First Light** comes up from the sacred ground (it has no Act IV): the stair goes down under
  the consecrated stones. The Emperor still lives on this road, so the Lieutenant's "My master's
  work is already done" stands.
- **Dusk** gains Act V (new runs only: a run keeps the act list it started with). The Emperor
  falls at the end of Act IV, the descent opens under the capital, and his seer keeps the rite
  going without him.

### 2.2 Nightfall and Black Sun: the Lieutenant holds the door

```
row 0   The Old Kings' Stair        battle
row 1   Mortuary Column | Act V event      fork
row 2   The Vigil                   mini-boss
row 3   The Landing                 an Act V event (a second draw from the pool) *tune: keep or cut*
row 4   The Lieutenant              GATE boss (set piece the_glass): his card, theme and lines; the run goes on
row 5   The Ruins                   unchanged
row 6   The Entity                  finale (eldritch_sanctum, hinge/hum/rally untouched)
```

The Lieutenant is not killed twice in one breath with the Entity: the Ruins sit between them.
The Landing exists so the Vigil and the Lieutenant are not back to back with no choice in
between; the sims decide whether it stays (§11).

### 2.3 Rules for every Descent node

1. **The fight is the text** (event-set-pieces §2). Every battle node in the Descent is a set
   piece; there is no procedural Act V fight.
2. **Authored, seeded, locked.** The route's shape comes from data; which event fills an event
   node and every set-piece draw come from the run seed on their own keys, never `Math.random`
   and never the node-map stream. Battles lock on first entry like any battle.
3. **Act V loot is real.** `lootTables.finalBoss` today pays gold only. The Descent's battles
   draw from the Act IV tables (First Light: Act III), so a weapon found on the stair can matter
   at the finale.
4. **Heals as today.** HP persists between nodes; the Ruins is the act's rest. `advanceAct` heals
   on entry as it does for every act.
5. **The Eclipse.** Every Descent node is exempt from falls except the Mortuary Column, which may
   fall to an eclipsed elite as anywhere (`fallable: true` in the route data). The fork's event is
   not fallable: the Eclipse already speaks through the Rite's starting value (§4).
6. **No service conversions.** Pilgrim's Road, the start gift's `eclipse_fall_now` and any other
   pass that rewrites nodes skip authored Descent nodes.

## 3. The court circle and the summoning

The circle's rite is happening now, under the stones, and the act is the army arriving while it
is still being spoken. Three things carry that: the Vigil fight, the summoning circles, and a
run-level count of how far the rite got (**the Rite**, §4).

### 3.1 The Vigil (row 2, required)

A ring hall. Four **Voices** of the court circle stand on four sigils around a summoning circle;
each Voice is tethered to one smaller circle at the ring's edge.

- **Objective: Break the Vigil.** Silence the four Voices (a new objective kind, §9.4). The guards
  and the summoned do not have to die. The objective strip reads "Silence the Voices (2/4)".
- **The words.** At each enemy phase start, every living Voice standing on its sigil speaks one
  word: the Rite +1 (§4). A banner names it once per phase: "The Voices speak." A Voice pushed,
  pulled or lured off its sigil speaks nothing until it walks back; the AI walks it back.
- **The summoning.** At each enemy phase start, each tethered circle whose Voice still lives calls
  one **Hollowed** (§5.2) onto the circle, unless a unit stands on it. A player unit on a circle
  blocks it (and stands where the guards can reach it). Silencing a Voice closes its circle for
  good. At most `vigil.maxCalled` (*tune* 8) Hollowed are called in a battle.
- **The guards.** The `elites.postAct` names come back: **Warden of the Rite** (Dark Knight, the
  captain, guarding the inner ring; two levels under the elite rule, `level: -2`, so a thin army
  never meets a captain far above his guards) and **Ritual Blade** (Assassin, a hold pack that wakes when a
  Voice is first hurt). The rest is the act's promoted pool. Black Sun adds **Ash Magus** (Sage)
  on the far side of the ring.
- **No boss card, no boss music.** The Vigil has its own theme (§8) and an entry line from the
  Voices. It counts as an elite fight for rewards (4 choices, pick 2). It pays no Vision charge
  (on Nightfall and Black Sun the Lieutenant gate does, §6.2).
- **Par.** Par is the set piece's; the words themselves are the clock.

The four Voices are named Circle Adepts (§5.1), each keeping one part of the rite. The names are
on the slot (`captain`-like `name`, never `isBoss`):

| Voice | Keeps | Line when it falls |
|---|---|---|
| the Voice of the Calling | the summoning itself | *drafted in the dialogue PR* |
| the Voice of the Binding | what holds it below | |
| the Voice of the Feeding | the stone and the dead | |
| the Voice of the Waking | the last word | |

The Waking's word counts double (the Rite +2) while the other three still live: the player who
reads the four plates learns to silence it first, or to ignore it and race the circles.

#### 3.1.1 The bridges and the shields (as built, the difficulty rework)

Playtests found the ring hall too easy: the Voices sat inside four doorways and the Waking could
fall on turn 1. The Vigil is now **The Bridges of the Rite** (16x14, every rung): stone platforms
over the **Abyss** (terrain index 19, appended: impassable on foot, Flying moves 1; the Gate's
reserved index is 20), joined by bridges one tile wide, after FE6's "The Truth of the Legend".
The army deploys on the west platform; the Calling holds the north platform, the Feeding the
south, the Binding the east and the Waking the centre dais with the Warden; each circle stands on
a corner landing across the dark from its Voice (a General and a Hero hold the two near landings,
the far two have hold packs).

- **Wards** (`vigil.wards: true`). A Voice is **warded** while a circle naming it still stands: it
  takes no damage from anything (`unit.warded`, read by `Combat` strikes and forecasts,
  `UnitHealth.damageUnitDetailed`, an art's set-HP, a weapon's after-combat poison). A player or NPC unit standing on a circle at
  the enemy phase's start **breaks** it for good, before the words and the summons: the Voice's
  ward falls and the circle calls no more. `vigilState.broken` = `{ circleId: turn }`, saved only
  once a circle breaks.
- **The choir** (`vigil.choir: true`). The Waking is warded while any other Voice lives, whatever
  its circle.
- **Stamps.** `applyVigilWards(vigil, state, enemyUnits)` is the one writer of `warded` /
  `wardReason` (`circle` | `choir` | `both`): at battle start, after each phase step, after a
  Voice leaves the roster, after a restore (scene and harness). The unit card, forecast note and a
  "Warded" float say it; a break plays "A circle breaks." with `sfx_ward_break` where the player
  sees it.
- **Saves.** Run-format capabilities `vigilWards` (a locked vigil's `wards`/`choir`, a checkpoint's
  `broken`) and `abyss` (an Abyss tile in a map).
- **Tuning.** The piece carries `parBonus: 2` (breaking circles takes structural turns), and the
  General and Hero by the two near landings stand from Dusk up, so First Light's near circles are
  free. `npm run sim:descent -- --until vigil` from the same captured armies, old ring hall → new:
  Nightfall endgame 99% → 92% cleared, 3.4 → 9.3 turns (under par); Nightfall half 84% → 78%;
  Dusk half 88% → 90%; Black Sun half 75% → 67%; First Light quarter 61% → 58% (39% before the
  First Light gates). The scripted player stalls more on the bridges than a person would.

### 3.2 Summoning circles elsewhere

The Stair and the Mortuary Column have no Voices, but the Stair's lower landing has one circle
that a hidden Adept keeps (a hold pack that wakes on contact): a small first lesson of the
Vigil's rule before the Vigil.

## 4. The Rite

**What it is.** `run.rite` (saved): `{ words, log[] }`. The number of words the circle has
spoken. It starts at Act V entry, rises in the Vigil and through events, and is read by the
finale. It never decreases below 0 and is never written outside the Descent.

**Sources.**

| Source | Change | When |
|---|---|---|
| The Eclipse at Act V entry | Pale 0, Waning +1, Umbral +2, Totality +4, Hollow +6 (*tune*) | `advanceAct` into `finalBoss`, once |
| The Vigil | +1 per Voice per enemy phase on its sigil (the Waking +2 while the others live) | committed at the Vigil's victory, like shadow |
| Act V events | ±1 to ±3 by choice | when the event's effects apply |
| The Mortuary Column | −1 if won at or under par (*tune*) | at victory |

Words spoken in a battle are counted there and committed only at victory (as the Eclipse's
shadow is), so a Vision rewind, a resume or a Continue from Map never counts a word twice or
loses one.

**Tiers, read by the finale.** Shown as a chip on the route map from Act V entry ("The Rite: 7
words · Spoken") and on the finale's node preview, with what the tier does.

| Tier | Words (*tune*) | The Lieutenant (finale or gate) | The Entity |
|---|---|---|---|
| **Broken** | 0–4 | his escort loses its two highest-level members | its splash strikes one tile fewer |
| **Spoken** | 5–11 | as today | as today |
| **Answered** | 12+ | +1 Revival Stone; the T4 wave adds 2 Hollowed | its splash strikes one tile more; every template wave adds 2 Hollowed |

On Nightfall and Black Sun the Lieutenant gate fight reads the tier too (he guards the rite's
door), and the Entity reads it again: the tier is a state, not a charge.

**What the Rite never touches.** The Entity's hinge (first wound → silence → the answer → the
finale), the hum's HP contract and the rally. A tier never changes a boss's HP. A Broken rite
does not wound the Entity (that would fire the hinge at turn 0).

## 5. New enemies

Both are enemy-only classes, validated and gated like the Necromancer and the Skeleton
(`ENEMY_ONLY_CLASS_NAMES`, `DIFFICULTY_GATED_CLASSES`, never a reclass target, never in an arena,
never a reinforcement template unless named, traced sprites before data can spawn them).

### 5.1 Circle Adept

The court circle's ritualists: robed, hooded, a tome bound in grey cord.
- Promoted tier, `Tomes (M)`; a dark class (Dark Knight's tome line). Carries an enemy-only tome
  (*name in the content PR*, price 0, in no loot table, validated like Gravesong).
- AI `guard` by default; a Voice is `post` on its sigil (below).
- Lore (≤160, drafted in the content PR): the found-text voice of the court circle's own rolls.
- A Voice stands on its sigil and strikes from it (AI `post`: movement 0). A Voice the player moves
  off its sigil (Shove, Smite, a push art) walks back to it (`seek_tile`) and speaks again only
  once it stands there.

### 5.2 Hollowed

Imperial soldiers the rite has emptied: the uniform still on, the person gone out of it. Phase D
of the event set pieces planned them as Eclipse-touched; here the summoning makes them.
- Base tier, Infantry, `Lances/Swords (P)`, low growths, no skills.
- **They grow with the rite.** A Hollowed's level is the battle's adjusted range plus
  `min(4, floor(words / 4))` (*tune*), read when it is built (a called Hollowed reads the Rite at
  battle entry plus the words spoken so far in that battle). Called Hollowed act on the phase they
  appear, as raised Skeletons do. Rewards: XP ×0.5, gold 0, no carry, no deed record (like a raised Skeleton).
- Built on a keyed stream (`keyedBattleRandom(battleSeed, 'called:<circle>:<turn>')`), never the
  battle stream, so a call never moves it and a resume or rewind replays it.

### 5.3 Reused

- `elites.postAct` → the Vigil's guards (§3.1). `elites.finalBoss` gains entries so the code's
  fallback to `bosses.finalBoss` (which would seat the Lieutenant or the Entity as an elite
  captain) can never happen.
- The Necromancer leads the Mortuary Column on the rungs that field it; First Light's column has
  a Bishop at its head (the slot's `minRung` gate).

## 6. The Lieutenant on every rung

### 6.1 Rules

- The route seats him **by name** (`battleParams.bossName`): the finale on First Light and Dusk,
  the gate on Nightfall and Black Sun. His `difficultyFilter` keeps its meaning, "the finale
  pick" (`normal`, `dusk`), and is not widened: the legacy random boss pick and
  `victoryEndingKey` both read it, and a Nightfall save already in Act V on the old 2-node map
  must keep drawing the Entity.
- **The Glass** (`the_glass`, his set piece): a long hall of standing mirrors (Pillars), a dais at
  the far end with a Throne. Seize on the finale (as today); on the gate, **defeat him** (the
  objective kind of §9.4 with one name) so the door opens when he falls.
- He keeps his theme, his card, his boss lines and his `lieutenant` Revival Stone kind (§4 adds
  one on Answered).

### 6.2 The gate fight (Nightfall, Black Sun)

A boss fight that does not end the act: boss card, boss theme, half-health and defeat lines,
enrage, Revival Stones. What follows the victory:
- **+1 Vision charge** ("The glass breaks. Sera's sight comes back whole."), the act-boss rule
  applied to the gate: an explicit grant, since every existing grant keys on `bossNodeId`. No
  Eclipse boss relief.
- No earned-blessing pick (the act's last boss never offers one; neither does the gate).
- No boss recruit, no third lord, no `advanceAct`; the route map opens on the Ruins.

### 6.3 Stretch: the Far Side of the Glass

The boss-maps spec's signature (`05` §8.1): through the player phase his next decision is shown
(the tile he will move to, the unit he will strike), redrawn after each player action. The one AI
change is `previewDecision`. It ships after the Descent, in its own PR, if the base act plays well.

## 7. Act V events

Two or three events eligible only in the Descent (`acts: ['finalBoss']`), drawn for the fork and
the Landing from a small pool on the node's own key. Each may carry a `dark` face. Their effects
use the existing vocabulary plus one new effect, `rite: N` (§9.6). Drafts (final text in the
content PR, under the lore style guide):

- **The Last Lantern.** "No scout returns from below. The last one's lantern still burns on the
  steps." Carry it down (the rest of the Descent's fog maps open with a revealed radius, Lantern
  of the Road's rule) / leave it burning for the next army (the Rite −1) / read the scout's last
  page (the Vigil's map is shown on the route preview).
- **The Seers' Last Page.** "The seers' notes end mid-sentence here. In every copy they ever
  made." Finish the sentence (needs Sera, a Light Priestess or a Bishop in the army: the Rite −3) /
  burn the copies (the Rite −1, a unit takes a Lingering Injury from the smoke) / keep a copy
  (an item).
- **We Came This Far Also.** The carving on the stair, and under it names: armies that came
  before. Carve your own (each living unit +5 Hit for the Descent's next battle) / read the names
  (one is a name you almost know: +1 Vision) / walk on.

## 8. Presentation

- **Route map.** The Descent's loom keeps "The Loom: Unlight". The Rite chip sits beside the
  burden chips from Act V entry. The finale's node preview lists the tier's effects.
- **Battle themes.** The Stair, the Column and the Landing: a new Act V battle theme (the
  Descent; adaptive, calm/full). The Vigil: its own theme with the circle's chant (the palette's
  choir), and a cue when a Voice falls. Built with the score engine if the container can render
  (`tools/music`); otherwise the Act IV pool stands in and the scores follow.
- **Art.** Circle Adept and Hollowed map sprites (traced atlas) and portraits (pc98); vignettes
  for each Act V event (`docs/art-direction/events/`); sigil and summoning-circle markers drawn as
  tile overlays (no new terrain art). The Glass needs no new tiles (Pillars, Floor, Throne).
- **Banners.** "The Voices speak." (enemy phase, once), "The circle calls." (a Hollowed called),
  "A Voice falls silent." (a Voice silenced), "The vigil is broken." (victory).

## 9. Engine

File:line references are to `main` at 1c4bb64 and will drift; read the code before trusting them.

### 9.1 The authored route

- **`data/descent.json`** (new; loaded in `DataLoader` beside `setPieces`, validated in
  `npm run validate:data`, synced to `public/data`):

  ```
  { version: 1, enabled: true,
    routeByRung: { normal: "lieutenant", dusk: "lieutenant", hard: "entity", lunatic: "entity" },
    routes: { <id>: { finale: "lieutenant" | "entity",
       levelOffset: [lo, hi],     // over ACT_LEVEL_SCALING of the act before finalBoss
       rows: [ { nodes: [ NodeSpec | { oneOf: [NodeSpec...], weights?: [...] } ] } ] } },
    rite: { startByPhase: {...}, bands: [...], mods: {...}, perWordLevel, levelCap } }
  ```

  NodeSpec: `{ key, type: battle|event|ruins|boss, setPiece?, templateId?, objective?, elite?,
  eventPool?, boss?, bossRole?: gate|finale, riteTarget?, fallable?, title?, preview?, bossLine? }`.
- **`engine/Descent.js`** (pure; modelled on `Prologue.buildPrologueNodeMap`):
  `buildDescentNodeMap(config, { runSeed, difficultyId, actSequence, gameData })` returns the
  `generateNodeMap` shape plus `nodeMap.descent = { v: 1, routeId, finale }`.
  - Node ids `finalBoss_<row>_<col>` (ids are parsed elsewhere and key the battle stream).
    Columns: one node → 2; two → 1 and 3; at most three per row. Edges: full fan when either row
    has one node; otherwise explicit, checked with `edgeCrosses`.
  - **No `Math.random`, no node-map stream.** Each node's `battleSeed` is
    `keyedBattleRandom(runSeed, 'descent-node:<id>')` (as `prologueNodeBattleSeed`); a `oneOf`
    picks on `descent-row:<seed>:<route>:<row>:<i>`. The builder is not wrapped in
    `_withNodeMapSeed`.
  - Set-piece nodes go through `convertNodeToSetPieceBattle`, extended to take the keyed seed
    instead of its `rollBattleSeed()` draw and to skip the fog roll when the set piece forces fog.
  - The Entity finale is `{ type: 'boss', templateId: 'eldritch_sanctum', objective: 'seize',
    boss: 'The Entity', bossRole: 'finale' }` with no `levelRange`, so its escorts use the pool
    range exactly as today.
  - Every node is stamped `authored: 'descent'`.
- **Validation** (`validateDescentConfig`): every rung whose `actsIncluded` has `finalBoss` maps
  to a route; the route's finale agrees with that rung's `difficultyFilter` pick; row 0 and the
  last row have one node and the last is the finale boss; every node is reachable both ways;
  every set piece, template, boss and event pool resolves; set pieces validate at `finalBoss` for
  each rung the route serves; an always-eligible event exists in each named pool.
- **RunManager.** One `_buildActNodeMap()` replaces the two `generateNodeMap` call sites
  (`startRun`, `advanceAct`): the Descent when `!isPrologueRun && act === 'finalBoss' && descent
  enabled && a route exists for the rung`, else today's call unchanged. `ACT_CONFIG.finalBoss.rows`
  stays 2 and `generateNodeMap('finalBoss')` stays the legacy path, so the tests that pin the
  2-node act keep passing and describe the fallback. `fromJSON` never rebuilds a map: a save
  already in Act V keeps its 2-node map, and every new reader handles a `finalBoss` map without
  `descent` and `run.rite === null`. Dev routes take `bossNodeId`, never the first `BOSS` node.

### 9.2 Set pieces on any node

- `SetPieces.js`: a set piece may name `objectives` (the large-maps model, §9.4) beside its
  legacy `objective` (`rout` | `seize`); the act ids gain
  `finalBoss` (and `postAct`). New slot keys: `boss: true` (seats the battle's boss, at most one,
  always in play, keeps its two slot draws), `name` (a named unit that is not a boss),
  `target: true` (counts for `defeat`; needs a name; always in play; never `hold`),
  `aiMode: 'post'`. Variant-level `vigil: { sigils: [{id,col,row,target}], circles:
  [{id,col,row,voice}] }`, placed through `place()` so a mirror flips them.
- Validator: seize needs exactly one Throne with the `boss` slot on it and no `captain`; defeat
  needs at least one target; each sigil has its target slot on it; circles are standable for
  Infantry and reachable; Descent references are walked beside event references. Map size: the
  cap rises to 16×14 for `finalBoss` set pieces only (the Glass replaces a 16×14 arena).
- `MapGenerator.generateSetPieceLayout`: `thronePos` from the authored Throne (`throneTiles`
  moves from `Prologue.js` into `AuthoredMap.js`); `finishReinforcements` gets
  `isBoss: params.isBoss === true`, so no Hunted wave lands on a boss map. The boss slot and the
  template path both go through one `resolveSeatedBoss(params, deps)`: `params.bossName` looks the
  boss up in `enemies.bosses[act]` by name, bypassing the filter but **still consuming the legacy
  pick's single draw** (so a named Entity config is byte-identical to today's); level
  `bossDef.level + bossLevelBonus`; stones from `revivalStoneKind` plus the Rite's (§9.5), never
  on the Entity. The config gains `objectiveTargets` and `vigil`. An unknown set piece's
  fallback maps any non-template objective to `rout`.
- `EnemySpawnGear.applySpawnLoadout` (scene and harness share it) sets `enemy.name` from
  `spawn.name` for named non-boss units. `AIController`: mode `post` is movement range 0, striking
  from the tile, built as `holdsPost` is so scene and harness agree.
- Voices are never `isBoss` (no boss stats, no boss gold, no boss bar). `elites.finalBoss` gains
  entries so `eliteCaptains` never falls back to `bosses.finalBoss`.

### 9.3 The gate boss

A node with `type: 'boss'`, `bossRole: 'gate'` and an id other than `bossNodeId`.

| Reader | Today's result for the gate | Change |
|---|---|---|
| `isActComplete` / `isRunComplete` | read `bossNodeId`: not ended | none |
| `handleBattle` `isBoss: node.type === BOSS`, `BattleScout`, `firstRunFastPath` | boss card, music by boss name, pre-battle lines, boss bar | none |
| `getBattleParams` `bossBattle` | no Hunted; Sworn affix applies | none |
| `completeBattle` boss node | ends Sworn Enemy; boss gold ×1.5 | none |
| `_commitBattleShadow`, `isActBossVictory` | no relief, no Vision, no earned pick | **explicit +1 Vision** for the gate (§6.2) |
| `PostCombatController` boss victory → boss recruit | finalBoss has no recruit | **gate branch**: loot and the third lord as the elite path |
| Defeat lines, `recordBossSlain` | as any boss | role variants (§9.7) |
| `RouteGraph`, `NodeMapScene` final-boss art | keyed on `act === 'finalBoss'` | read `bossRole` |
| `EclipseSystem.nodeFallExemption` | exempt (authored, §9.1) | none |

### 9.4 The defeat objective (the large-maps model, its first kind)

The large-maps specs (`docs/specs/large-maps/03-objectives.md`, with #304's §16 reconciling them
with the shipped set pieces) define the objective model this uses; the Descent builds its first
kind, `defeat` (`03` §5.4), and nothing else of it. One format, never two:
- **Config.** `objectives: { version: 1, primary: [{ id, kind: 'defeat', targets: [ref],
  need? }] }` beside the legacy `objective` string, which stays `rout` (`03` §3.3: defeat is in
  the rout family). A ref is a spawn's `authoredId` or `'@boss'` (every living `isBoss` enemy).
  The Vigil: four Voices. The gate: `['@boss']` (the Lieutenant).
- **`engine/BattleObjectives.js`** (pure, no RNG, `03` §4's module and its names): for now
  `objectivesOf(config)` (the config's model, or none for a legacy map), `evaluateObjectives`
  returning `{ outcome: 'victory' | null }` for `defeat`, `remainingTargets`, and the strip's
  `statusView` words. The large-maps PR 1 extends this module (phases, `objectiveState`, the
  derived legacy model); it must not fork it.
- **Rule readers.** `BattleScene.checkBattleEnd` and `HeadlessBattle._checkBattleEnd` ask the
  module first when the config carries `objectives`, else the legacy rules as today;
  `tests/harness/Invariants.js`; `ScriptedAgent` and `sim/lib/TacticianAgent.js` (targets take
  boss priority, or the Vigil times out while the circles call). `isRoutFieldClear` stays as it
  is, so waves keep coming on a defeat map. A target's Revival Stones hold as usual.
- **Degrades safely.** A client without the model reads `objective: 'rout'` and plays the map as
  a rout (kill everything), which is winnable; this is why the legacy string is `rout`.
- **Par.** `turnBonus.json` gains `defeat` (`03` §5.4: base 4, adjustment 1); par reads the
  primary kind when the config carries `objectives`.
- **Words.** "Defeat · the Voices (2/4)" on the strip, "Defeat {name}. The rest need not fall."
  in the help and deploy banners, victory word SLAIN (`03` §5.4's wording table):
  `updateObjectiveText`, `battleSidebarDisplay.compactBattleObjective`, `helpTopics`
  `OBJECTIVE_GOALS`, `DeployScreenOverlay` `OBJECTIVE_BANNERS`, `PartyMenus`, `ceremonyContent`
  `OBJECTIVE_WORDS` and the felled band ("2 Voices remain"), `loomModel`, the node tooltip.
- **Authored pieces on authored nodes.** #304 §16.4 places authored (`variants`) set pieces only
  through events, and assembled ones on route slots. The Descent is a third, explicit placement:
  an authored route names authored set pieces on its own nodes (§9.1). It is never §6.2's rolled
  placement and never counts toward its limits; #304's spec should say so when it merges.

### 9.5 The Rite and the Vigil mechanic

- **State.** `run.rite = { v: 1, words, start, log: [{ source: 'eclipse'|'vigil'|'event'|'battle',
  delta, nodeId?, eventId? }] } | null`, in **`engine/Rite.js`** (pure: `createRite`,
  `riteStartFromEclipse`, `applyRiteDelta`, `riteBand`, `riteModsFor(run, node)`, `sanitizeRite`,
  `riteView`). Created in `advanceAct` only when the Descent is built, after `beginActShadow` and
  before `applyEclipseNow`, from the global meter's phase (0 with the Eclipse off). Saved in
  `toJSON` / `fromJSON`; old saves read null.
- **Settled once, at victory.** The battle never writes `run.rite`. The Vigil's victory commits
  `options.riteWords` in `completeBattle`, gated on the locked config carrying `vigil`;
  `completeBattle` refuses a node already done, so nothing double-counts, and a suspend, a Vision
  rewind or Continue from Map needs nothing extra.
- **The Vigil step.** **`engine/Vigil.js`** (pure, modelled on `Necromancy.js`):
  `vigilPhaseStep({ vigil, state, enemyUnits, playerUnits, isOccupied, moveCostAt, turn, seed,
  riteAtEntry, ... })` → `{ words: [voiceIds], summons: [{ circleId, tile, unit }] }`. Words: each
  living target on its sigil (the Waking ×2 while the others live); no draw. Summons: each circle
  whose Voice lives and that no player unit covers calls a Hollowed onto the circle or its first
  free passable neighbour (`riseTile` order), built on
  `keyedBattleRandom(seed, 'summon:<circle>:<turn>:<n>')`; caps per circle and per battle;
  `_summonedBy: 'circle:<id>'`; a `lastProcessedTurn` guard.
- **State in the battle.** `vigilState = { words, summoned, lastProcessedTurn }` rides
  `captureBattleWorldState` / `restoreBattleWorldState`, so the suspend checkpoint and the Vision
  snapshot both carry it (with field validation in `BattleStateSnapshot`). An enemy-phase resume
  skips the turn-start pipeline, so the step never replays.
- **Scene and harness.** `ui/VigilController.js` (create/destroy: sigil and circle markers,
  banners, fog-aware through `canInspectUnit`) is driven from the enemy turn-start pipeline right
  after `processNecromancy`; the harness calls `_processVigil()` right after `_processNecromancy()`.
- **Conjured units.** One `isConjuredUnit` predicate (raised or summoned) for gold 0, the XP
  multiplier, no survival XP, no deed, no carry, never a reinforcement template.
- **Finale modifiers.** `getBattleParams` adds `riteMods` (keys only when non-empty) and
  `riteAtEntry` for a `riteTarget` node or the Vigil. `MapGenerator` writes them into the locked
  config at generation: boss stones through `resolveSeatedBoss`; a `riteWave` (a `scriptedWaves`
  entry of Hollowed, placed like `HuntedWave.withHuntedWave` but allowed on boss maps);
  `entitySplashCount` (`ENTITY_SPLASH_COUNT` ± 1, clamped 0..4). The locked config holds them, so
  resume, rewind and the scout agree. `rollSplashTiles` takes the same draws whatever the count.
  The validator refuses any mod that touches the Entity's HP, puts stones on it, or reaches the
  hinge, the hum or the rally.
- **The Entity's splash** moves out of `BattleScene._applyEntitySplash` into a pure
  `EntitySystem` step the scene drives with presentation and the harness without (the harness
  never splashed: `05` §1.3 item 8). Harness finale results will move: `test:harness:pr` and
  threshold notes.

### 9.6 Act V events

- `EVENT_ACTS` stays act1–4 as the default; validation accepts `finalBoss`. An event may carry
  `pool: 'descent'`; `eventBlock` refuses a pooled event at a node with another or no
  `eventPool`, and an unpooled event at a node that names one. `pickEvent` and `hasDarkOmen`
  inherit it. With nothing eligible, the existing fallback event stands in (the validator makes
  that unreachable).
- New effect **`rite: { delta }`**: plan and apply cases in `EventEffects`, a no-op record when
  `run.rite` is null, a preview phrase ("The rite: −1 word"), a `describeResult` line. Valid only
  in pooled `finalBoss` events; no `routeEdit`, `contract` or `join` in Descent events. The sims'
  event policy handles it.

### 9.7 The ladder, the Lieutenant, the endings

- `difficulty.json`: `dusk.actsIncluded += finalBoss` (new runs; saved runs keep their act list)
  and the `road` text. Side effects to accept and document: Dusk's Act IV can now hold an Old
  Sanctum, and the Emperor now owes an earned-blessing pick on Dusk (the act boss of a non-final
  act). CLAUDE.md lines that say "Dusk ends at the Emperor" / "Dusk act1-3" change.
- `getActTransitionKey(from, to, { finale })`: Act IV → `finalBoss` plays a new
  `act4_to_finalBoss_lieutenant` on a Lieutenant road, today's `finalBoss_to_secretAct` on an
  Entity road.
- The Act III vision plays when the run includes Act IV (not when `victoryEndingKey` is the
  Lieutenant's, which Dusk now is).
- `victoryEndingKey` is unchanged (Dusk already resolves to `victory_lieutenant`).
- `NarrativeDirector` `KNOWN_WHEN_KEYS` gains `bossRole` (`gate` | `finale`, from
  `battleParams.bossRole`), `roadThroughEmperor` (the run includes Act IV) and `riteBand`.

### 9.8 Saves, cloud and old clients

No run-format guard (owner decision, 2026-10-11). An older client cannot play a Descent run (an
unentered Descent node's set piece falls back to a template it may not have, the Vigil plays as a
plain rout, a
Nightfall gate draws the Entity, `run.rite` is lost on its next save), but no older client can
reach one today:
- the iOS and Android apps are local-only: their builds leave `VITE_CLOUD_ENABLED` unset, so
  `supabaseClient.js` creates no client and a cloud run never reaches an app build (checked on the
  TestFlight build of 2026-10-10);
- the web game loads the new build on reload. The remaining gap, a tab left open across a deploy,
  is the one every save-format change already carries.

Saved runs still need care inside one client: `fromJSON` never rebuilds a map, so a save already
in Act V keeps its 2-node map, `run.rite` reads null on an old save, and every new reader handles
both (§9.1). **Revisit this section if the apps are ever built cloud-enabled**: a run-format check
(`requiredRunFormat` over the saved payload, refused by a client that lacks a capability, held back
from the cloud above a safe format) would then be needed before the Descent reaches players.
The large-maps workstream is building that guard anyway (#305, its PR A0). If it lands first, the
Descent registers what it writes (`nodeMap.descent`, `run.rite`, `objectives`, `vigil`,
`vigilState`) in its `CLIENT_CAPABILITIES` and its saved-key census, and depends on nothing else
of it.

## 10. Narrative

What changes because the Lieutenant is fought on every rung, and what the Descent adds. Every
line follows `docs/lore-style-guide.md` (≤90 characters, one line, lords in their own voices).

1. **The Act III vision** (`bossEncounters['The Lieutenant'].vision`). Sera's closing "He's gone.
   For the first time since this began, no other sight presses against mine." now says he has
   gone *below*: he withdrew to wherever the rite is, and she will find him there. His "I stand
   where none of your roads can reach" becomes a promise the game keeps. It plays on Dusk,
   Nightfall and Black Sun (the roads with an Act IV between him and the army); First Light, which
   meets him straight after Act III, never sees it. The rule moves from "the run does not end at
   him" (`victoryEndingKey`, which Dusk would now fail) to "the run includes Act IV".
2. **His lines by role.** A new narrative condition `lieutenantRole: 'finale' | 'gate'` and
   `emperorSlain: true | false` (`NarrativeDirector`). First Light keeps today's lines. Dusk
   (the Emperor dead): variants of preBattle, halfHealth and defeat ("His Majesty is ash. His work
   is not."). The gate: lines that cannot sound final ("Go down, then. It is awake, and it
   remembers you."). About 20–30 new lines across the commanders' exchanges.
3. **Endings.** `victory_lieutenant` teases "a harder road… runs to the Emperor's door", wrong on
   Dusk: Dusk gets its own variants (both the master and the seer have fallen; something below
   still turns over), keyed on `emperorSlain`. `victory_emperor` ends no run any more: its best
   lines become **the Act IV close**, played when the Emperor falls, before the descent
   (`finalBoss_to_secretAct`). `victory_entity` and the finale rally gain a few lines that
   remember the glass breaking.
4. **Transitions.** `finalBoss_to_secretAct` (Act IV → V; keys are internal and stay) plays on
   Dusk too, and gains Sera feeling his sight press against hers again. `act3_to_finalBoss_normal`
   (First Light) gains the stair.
5. **The Descent's own words.** The Vigil's entry line and each Voice's fall; the Rite chip and
   tier text; node flavor for the new nodes (the stair carvings already in `nodeFlavor` are the
   register to match); the three events; class and set-piece lore.
6. **Labels.** `difficulty.json` `road`: Dusk "Acts I–IV, then the Lieutenant."; Nightfall and
   Black Sun "Acts I–IV, the Lieutenant, then the Entity."

## 11. Balance and sims

- `sim:fullrun` per rung with the Descent: the finale's win rate, the act's HP and unit losses,
  the median Rite at the finale and its tier split. Targets (*tune*): about a third of
  Nightfall runs reach the Entity on Broken, half on Spoken.
- Dusk gets longer (Act IV then the Descent): re-check its `currencyMultiplier` and its run
  length against First Light and Nightfall.
- The Landing: keep it only if the Lieutenant gate's loss rate without it is above the act
  bosses' (*tune*).
- `tests/sim` driver: event nodes in the Descent use the existing policies; the Vigil and the
  gate need harness support (§9.5).

## 12. Delivery

Each PR goes to `main` on its own, green on the CI gates. The Descent ships dark (`descent.json`
`enabled: false`) until the content PR switches it on. Implementer column: who builds it (an Opus
agent for cross-cutting engine work, a Sonnet agent for scoped data, content and words), always
reviewed before the PR opens.

| # | PR | Needs | Implementer | Scope |
|---|---|---|---|---|
| 2 | Set pieces v2 + the `defeat` objective | — | Opus | §9.2, §9.4 module and rule readers; draw-parity test for a named boss |
| 3 | Circle Adept and Hollowed | — | Sonnet | §5: data, enemy-only plumbing (split `isNecromancyClass` into a never-copied predicate), sprites and portraits |
| 4 | The Entity's splash as a pure step | — | Opus | §9.5 last item; harness parity, threshold notes |
| 5 | Dusk goes on to the Lieutenant | — | Sonnet | §9.7 data and transition/vision rules, with the legacy 2-node Act V; tests that pin Dusk's act list |
| 6 | `defeat` words and agents | 2 | Sonnet | §9.4 word readers, `ScriptedAgent` / `TacticianAgent` targeting |
| 7 | The Descent route and the gate boss | 2 | Opus | §9.1, §9.3, §9.6 pools, Eclipse and Pilgrim's Road exemptions; ships dark |
| 8 | The Vigil mechanic | 2, 3 | Opus | §9.5 Vigil step, controller, harness, conjured units |
| 9 | The Rite | 4, 7, 8 | Opus | §9.5 state and modifiers, the `rite` effect, `when` keys, `riteView` |
| 10 | Content and switch-on | 3, 5, 9 | Sonnet + Opus review | the four set pieces, the routes, the events and vignettes, dialogue (§10), loot, CLAUDE.md; `enabled: true` |
| 11 | UI polish | 9 | Sonnet | the Rite chip, the finale preview, markers, phone and portrait checks, an e2e spec in a lane |
| 12 | Sims and tuning | 10 | Opus | §11; the sim driver's `applyGenerationFields` parity; slice re-baselines |
| 13 | Music | — | Sonnet | the Descent and the Vigil themes (§8), any time after the pipeline is set up |

Wave 1 (2, 3, 4, 5, 13) runs in parallel; wave 2 (6, 7, 8); wave 3 (9, 10, 11, 12).

## 13. Not in this spec

- Echoes (units this save lost in earlier runs, returning hollowed): the owner said not yet.
- The Lieutenant's foretell (§6.3): a stretch, its own PR.
- The Sanctum of Echoes and the Entity's echo pillars (`05` §8.2, §8.7): compatible with the
  Rite but not part of it.
