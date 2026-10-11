# Act V: The Descent

Owner request (2026-10-11): build out the final act. Today Act V (`finalBoss`) is two nodes, the
Ruins and the last fight. It should be a fight down to the end: a mini-boss, a few smaller nodes,
special events, and the court circle's summoning broken on the way. The Lieutenant is fought on
every rung that reaches the act.

Status: design agreed with the owner on 2026-10-11 (structure, the Vigil, the Rite carrying into
the finale, no Echoes yet). Numbers marked *tune* are starting values for the sims (§11).

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
5. **The Eclipse.** The start (the Stair), the Vigil, the Lieutenant, the Ruins and the finale are
   exempt from falls. The fork's battle may fall (an eclipsed elite, as anywhere) and its event
   may become a Dark Omen when the event has a `dark` face. The Landing is exempt.

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
  captain, guarding the inner ring) and **Ritual Blade** (Assassin, a hold pack that wakes when a
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
- AI `guard` by default; a Voice is `hold` on its sigil (it returns to it when moved).
- Lore (≤160, drafted in the content PR): the found-text voice of the court circle's own rolls.

### 5.2 Hollowed

Imperial soldiers the rite has emptied: the uniform still on, the person gone out of it. Phase D
of the event set pieces planned them as Eclipse-touched; here the summoning makes them.
- Base tier, Infantry, `Lances/Swords (P)`, low growths, no skills.
- **They grow with the rite.** A Hollowed's level is the battle's adjusted range plus
  `floor(words / 4)` (*tune*), read when it is built (a called Hollowed reads the battle's live
  count). Rewards: XP ×0.5, gold 0, no carry, no deed record (like a raised Skeleton).
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

- `difficultyFilter` → every rung that reaches Act V. He is no longer drawn from
  `bosses.finalBoss`: the route names him (the finale on First Light and Dusk, the gate on
  Nightfall and Black Sun), and the Entity is named by the route too.
- **The Glass** (`the_glass`, his set piece): a long hall of standing mirrors (Pillars), a dais at
  the far end with a Throne. Seize on the finale (as today); on the gate, **defeat him** (the
  objective kind of §9.4 with one name) so the door opens when he falls.
- He keeps his theme, his card, his boss lines and his `lieutenant` Revival Stone kind (§4 adds
  one on Answered).

### 6.2 The gate fight (Nightfall, Black Sun)

A boss fight that does not end the act: boss card, boss theme, half-health and defeat lines,
enrage, Revival Stones. What follows the victory:
- **+1 Vision charge** ("The glass breaks. Sera's sight comes back whole."), the act-boss rule
  applied to the gate.
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

*Filled in from the engine plan.*

### 9.1 The authored route
### 9.2 Set pieces on any node
### 9.3 The gate boss
### 9.4 The defeat-named objective
### 9.5 The Rite and the Vigil mechanic
### 9.6 Act V events
### 9.7 The ladder, the Lieutenant, the endings
### 9.8 Saves, cloud and old clients

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

*PR breakdown filled in from the engine plan.*

## 13. Not in this spec

- Echoes (units this save lost in earlier runs, returning hollowed): the owner said not yet.
- The Lieutenant's foretell (§6.3): a stretch, its own PR.
- The Sanctum of Echoes and the Entity's echo pillars (`05` §8.2, §8.7): compatible with the
  Rite but not part of it.
