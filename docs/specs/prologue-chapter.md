# Prologue: The First Thread — design

Status: the story is complete (Phases 1-3 built). The prologue runs as a run on a fresh slot:
P1, the route map, P2, the row-2 fork (Tamsin), P3 (Sera), the Old Watchtower, P4 (the Quarry
Gate: deploy, formation, seize, the boss, par), the ritual ending, then Home Base with the
grant; every chapter replays from the title. The Act 1 follow-through notes (§7) are built.
Phase 4 (polish) is open. Loop ending approved by the user, 2026-10-04. A design review the
same day thinned the teaching (§2 "Core and reinforcement": blocking notes 29 → 9), made the
roster lesson's core Withdraw and Equip, asked before leaving the fork with Tamsin unarmed,
said the win before the world breaks and added the handoff (§9), and re-estimated the length
(§9 "How long it takes").
Date: 2026-10-04
Replaced: the practice tutorial battle (`TutorialController`, `TutorialHelpers`), deleted in
phase 1. `docs/tutorial-battle-spec.md` and `docs/specs/tutorial_v2_guided_flow_spec.md` are
history; `docs/onboarding-review-2026-09-20.md` describes the tutorial it reviewed.
Research: `docs/fire-emblem-tutorial-sequencing.md` (how FE7, FE8, Path of Radiance and Awakening
stage their openings, and the teaching rules adopted in §2). Playtest evidence:
`docs/playtest-2026-09-22.md`, `docs/browser-playtest-2026-09-20.md` and
`docs/specs/threat-and-onboarding.md` §2. These are agent playthroughs in a browser, not
human novices, so they say where confusion and deaths happened, not how a person reads the
screen.

## 1. Why

The shipped tutorial is one 2v2 battle on an 8×6 map: Edric and Sera (level 3) against a Fighter
and an Archer. It teaches select, move, the Fort, the forecast (with the triangle and doubling
when they happen), and staff versus consumable lifetimes. After it, a fresh slot goes straight to
the Act 1 route map (`firstRunFastPath.js`), with no Home Base, difficulty or blessing.

What it never teaches (audited 2026-10-04, file references in the survey notes for this spec):

| Never taught in play | Where a new player first meets it |
|---|---|
| Roster: equip, trade, convoy, inventory limits | Alone, from the route map. `guide_convoy` is defined but has no call site. |
| Weapon choice in battle (which weapon to attack with) | Never mentioned. |
| Shop, Church, Ruins (Rest or Scavenge) | Help pages only. |
| Route map choices and node preview | One toast on the first map. |
| Loot screen, level-ups | One toast; the level-up card unexplained. |
| Deploy and formation placement | The first battle that has more units than the deploy cap. |
| Talk / recruiting | A field note in the first recruit battle. |
| Gaspar (the veteran) and why his kills cost you | Nothing. His trait says "low XP and growth". |
| Seize, bosses, par and the turn bonus | Toasts in the first battle that has them. |
| Why the run resets and what carries over | A first real defeat, then a Home Base the player has never seen. |

**The Sera problem, in particular.** Playtesters don't know what to do with Sera in the
tutorial. The cause is structural. Every coach goal is framed around a melee fighter ("Select
{fighter}, move next to a red enemy, then Attack"). Sera's role is never the subject of a beat.
That role is to strike from two tiles with Glimmer, where melee enemies can't counter, to heal
with a staff, and to stay out of the red. The only line about her is "{name} can use a staff on a
highlighted ally", and it shows only once she is already next to someone hurt. A one-battle
tutorial with two units can't give each unit's role its own moment. A chapter structure can.

## 2. Pillars

1. **One unit, one role, one chapter.** The army grows the way Fire Emblem openings do. The
   lord fights alone first (FE7's Lyn, Engage's opening). Then a veteran rides in (the
   Jagen/Seth/Marcus slot). Then the healer joins. Then a full squad deploys. Each new unit
   arrives with the map that teaches its job.
2. **The map is the lesson.** Maps are authored so the right play is the obvious play. Text
   confirms what the player can already see; it rarely instructs. At most one new idea per
   player decision (the field-note rules in `docs/specs/threat-and-onboarding.md` §2 apply).
3. **Real systems, real UI.** The prologue runs on a real `RunManager`, route map, Roster, Shop,
   Church, Ruins, Deploy, Loot and battle suspend. What a player learns transfers one-to-one,
   with no tutorial-only copies of screens.
4. **The story teaches the loop.** The prologue ends with the ritual, the run is lost, and Sera
   re-weaves the thread. The player's first reset is scripted and explained before their first
   real defeat, so the roguelike premise is learned as story, not as punishment.
5. **No dead ends.** A defeat in the prologue never ends anything. Sera says "Not this thread"
   and the battle restarts from its start. The commander rule is still taught, as what *will*
   happen in a real run.
6. **Short, skippable, replayable.** About 30 minutes for a player new to the genre (an
   estimate from the harness, §9 "How long it takes": a playtest hypothesis, not a
   measurement). Each battle is won in 3–4 turns by the harness's policies. A fresh slot
   offers Prologue or Skip, and any chapter can be replayed from the title.

### Teaching rules (from the sequencing research)

- **Need, explanation, action, result, reuse.** Every lesson starts from a situation that needs
  it, explains it in a line or two, lets the player act, and shows the result. A later, unprompted
  situation then asks for the same decision in a different position. Every chapter table below
  names its **reuse** beat. A lesson without one is exposure, not learning.
- **Hard gates only for the very first orders.** The first select, the first move and the first
  attack confirmation are gated (as the tutorial does today). After that, coach goals name a
  tactical aim ("keep Sera out of reach"), never a tile, and any valid solution counts.
- **Explain before the commitment it changes.** Counters while the forecast is open, threat
  before End Turn, consumable lifetime before use. Never cover the subject being explained.
- **Prompts fade.** P1–P3 introduce; P4 introduces only its own new rules (deploy, seize, armor,
  par) and coaches nothing already taught. That is the "play independently" check.
- **Safety keeps the rules honest.** Tune encounters so retaliation and crits can't kill the
  learner (enemy SKL/LCK and placement), rather than bending combat. Any prepared setup is
  disclosed in the fiction and on screen.
- **The veteran supports, never solves.** Gaspar makes the player's plan safer, but no chapter can
  be routed by Gaspar alone without him falling (the Sacred Stones Seth risk).
- **Exposure is not mastery.** Record "shown" and "practised" separately (§8): a note seen is
  not a skill used.

### Core and reinforcement (design review, 2026-10-04)

An external review found the chapters too dense: P2 explained veteran roles, weapon
switching, doubling, counters, hit chance, villages and loot; P3 recruitment, acting at once,
healing, staff refills, safe range, magic against RES, fragile positioning, aura and rewind.
Nearly every one of them was a modal note. Each chapter now has a small **core**, and only the core
blocks:

| Chapter | Core (blocking notes at their decision points, gates, coach goals) |
|---|---|
| P1 | Move (the gated select and Fort), inspect a forecast, commit an action, understand the enemy turn |
| P2 | Use the veteran to support another unit; compare weapon choices |
| P3 | Recruit Sera, heal someone, attack safely from range |
| P4 | Make a deployment choice, and complete the seize with less guidance |

Everything else is one of three things:
- **Reinforcement (a `tip`):** a non-blocking note, shown only when its situation arises. On
  the map it docks in a corner of the battlefield away from the units, as the in-run Guidance
  note does (`GuidanceNote`, kicker "Tip", Got it); raised by a forecast it is one line in
  the forecast's own notes, never over it; on the enemy phase it is a coach nudge. It never
  holds input or the simulation, and is never carried by a suspend checkpoint.
- **Cut, left to Act 1:** P2's loot note (the reward screen explains itself: each card says
  what it is and who can use it, the skip card what it pays; the `battle_loot` hint stays
  unread for the canvas loot screen's own note), P2's no-counter and "forecasts are
  possibilities" notes (the
  forecast prints "Cannot counter · reason" and its "How to read" points, a real run's
  forecast teaches `battle_no_counter` and `battle_counter_risk` inline, and P3's range note
  teaches the rule where it is the lesson), and P3's magic note (the forecast's numbers, then
  Act 1's armor note, "Magic hits RES").

Blocking modal notes per chapter (the authored maximum, `prologueNoteBudget`; the deploy
screen's note counts for P4; the enemy-phase nudge never did):

| Chapter | Before | After | The blocking notes now |
|---|---|---|---|
| P1 | 7 | 2 | `battle_forecast`, `p1_wait_or_end_turn` |
| P2 | 8 | 2 | `p2_veteran_kills`, `battle_doubling` |
| P3 | 10 (9 beats; the threat count twice) | 3 | `p3_recruit`, `p3_heal`, `p3_range` |
| P4 | 4 | 2 | `p4_deploy`, `p4_seize_par` |

**The slot's hints stay truthful.** A blocking note marks the in-run hints it stands in for
(`NOTE_HINT_IDS`) when the player acknowledges it; a tip only once it is read (Got it, its
extra button, or on screen long enough to read: `hintReadingPolicy`); a forecast tip when
the player confirms or cancels that forecast (a forecast closed by End Turn or a rewind
leaves it unread). A tip that stepped aside unread, or a cut note, marks nothing, so the run's
own point-of-use note still teaches it in Act 1 (`tests/PrologueDensity.test.js` names each
teacher; terrain has none: P1's gated Fort step already says what cover does).

The rules above still hold: one concept per decision (a tip counts: `oneNote` lets one note,
line or tip speak per move or forecast), the reuse beats (P2's Soldier, P4's unprompted
heal and 2-tile strikes) and the fading in P4 (its only blocking notes are its own new rules:
deploy, then seize and par; the throne and the gate's change are tips).

**For a player who knows the genre (playtest, 2026-10-10).** The Settings → Guidance level
thins the prologue without skipping its story (`engine/Guidance.js`
`prologueGuidanceAllows`, read live by `PrologueController` and the deploy note, so a change
mid-chapter applies to what comes next): **Full** shows everything; **Light** drops the
tips; **Off** drops the blocking notes (the deploy note too) and the guided steps as well
(P1 plays as after Skip step; a pending note is dropped unread; a `reachOf` highlight goes
with the note or tip it was drawn for). The spoken lines, joins, the coach's goal line
(foldable to its Guide chip) and the exits stay. Auto resolves as everywhere (Full until the
slot finishes a run). Nothing hidden is marked read, so Act 1 still teaches it where its
own level allows.

### Why a chapter run, not only a longer practice battle

The research recommends a short practice battle followed by contextual lessons in the first run,
and warns against a Lyn Mode-length course in a roguelike. This design keeps both properties:
- **P1 is the practice battle.** It runs about 5 minutes and covers stages 1–3 and part of 5
  (one order, predicting an exchange, reading the next phase). The title's replay entry opens it
  directly.
- **The full prologue plays once per slot and is skippable.** It is the only place the run layer
  (roster, route, services, deploy, Home Base) and the story's premise can be taught before they
  matter.
- **Everything else stays contextual.** Promotion, skills, arts, objectives beyond seize, and so
  on remain first-occurrence field notes in Act 1 (§7).

## 3. The decision that shapes everything: loop, not carry-over

Two shapes were considered.

**A. Carry-over:** the prologue is "Act 0" of the first run, and its roster, levels and items
flow into Act 1. It reads like a classic FE prologue, but in a roguelike it is wrong on three
counts:
- It unbalances the first run: extra XP, items and a recruit. Skippers would then need a
  canned equivalent, and that becomes a balance change to every run.
- It needs a new act id. About 15 act-keyed tables (enemy pools, deploy limits, loot gold,
  music, ceremonies, `KNOWN_ACT_IDS`) would need entries.
- The first time the run resets, it still happens as an unexplained real defeat.

**B. Loop (recommended):** the prologue is the *first thread*, a short self-contained run that
ends in the ritual's catastrophe. Sera pulls the army back to the morning it began. The player
lands in Home Base for the first time, with a small grant of Valor and Supply to spend. Then
they start the real first run with the standard roster.

This matches the canon ("runs are threads Sera re-weaves; bosses half-remember dying",
`docs/lore-style-guide.md`). It changes no run balance, and it teaches the single most important
roguelike rule: the army starts over, and what you buy at Home Base stays. It also gives the
existing first-run cold open (Sera's vision of the ritual) a scene to happen in.

**Decided (user, 2026-10-04): B, the loop.**

## 4. Flow

```
Fresh slot ─ New Game ─┬─ Play the Prologue (highlighted, "about 30 minutes")
                       └─ Skip to the first run ──► today's fast path (unchanged)

Prologue (one literal route map, "The Quarry Road"; hidden until P1 is won):
  row 0  P1 Banner at Dawn ........................ battle (the map is not shown before it)
  row 1  P2 Old Hands ............................. battle (first node the player travels to)
  row 2  Harrow's Market (Shop) | Harrow's Chapel ... fork; the recruit joins either way
  row 3  P3 The Seer on the Road .................. battle (Sera joins by Talk)
  row 4  The Old Watchtower ....................... Ruins: Rest or Scavenge
  row 5  P4 The Quarry Gate ....................... boss, seize
   └► Ending: the ritual seen from the gate, the Hollow Sun, the thread breaks
   └► Home Base (first visit; small Valor + Supply grant; spend it)
   └► Begin Run ──► first run: First Light, no blessing, standard roster
```

P1 is node row 0 so that its victory commits through `completeBattle` like any other battle:
Edric keeps his XP and level, and a refresh mid-P1 has a node to resume (code review, 2026-10-04).
The route map is first shown after P1, on the way to P2.

A refresh at any point resumes where the player was. The prologue is a real run, so it uses
the run save and the battle suspend checkpoints.

## 5. Story

**Setting.** Act 1 country: the Border Marches and the quarries. Imperial columns are crossing the
border to take the quarries. The court circle needs consecrated stone for the ritual, though
nobody in the Marches knows that yet. Imperial deserters run ahead of the columns and loot as
they go.

**Cast.**
- **Edric** — banner-lord of the Marches. Earnest, counts his people.
- **Gaspar** — Edric's father's old knight, retired. His bio already reads "He rides ahead so the
  young can learn to follow", which makes him the natural Jagen.
- **Sera** — a seer of the order (Light Sage). She has seen what the court circle's ritual will
  wake, and she is running to the one person her visions keep showing her: Edric. She is the
  Lieutenant's rival.
- **Tamsin** — the watch archer of Harrow's Crossing, a prologue recruit. Her name is already in
  the Archer name pool, so an Archer called Tamsin can turn up in a real run. That is
  deliberate: the faint déjà vu the lore guide allows ("I've felt this exact ache before").
- **Captain Varro** — the imperial officer holding the quarry gate. Prologue-only boss.

**Beats.**
1. *Dawn, the quarry road.* Deserters raid a farmstead. Edric rides out alone, and Gaspar
   arrives behind him at the end of P1.
2. *Old hands.* Gaspar insists on riding with Edric, but "the blows that teach you must be your
   own". An imperial outrider squad is camped by the ford.
3. *Harrow's Crossing.* The village is emptying ahead of the columns. Tamsin joins because
   the soldiers burned her watch post, and her bow with it.
4. *The seer on the road.* A robed woman runs from imperial soldiers (green unit). Edric reaches
   her and she joins. Sera: "I have seen you before, Edric. Many times. You always come for me."
5. *The watchtower.* Sera describes what the circle is doing. The cold-open vision lines live
   here now (§10).
6. *The quarry gate.* Varro holds the gate. Beat him, seize the gate, and the column breaks.
7. *The gate held, then the ritual, seen from far off.* The army wins first: PROLOGUE
   COMPLETE, "The gate is yours, Edric. Well fought." Then the sacred ground lies east, in the fens (Act 3 country), so
   the catastrophe is not at the quarry. From the gate the army sees it: the ground shudders, the
   sun goes hollow, and a light rises in the east where something under the consecrated stones
   turns over. A pale man watches from the far ridge (the Lieutenant, unnamed). The shock reaches
   the Marches and the land comes apart. Sera grabs the thread: "Not like this. I know this road
   now. Again, from the morning I reached you."
8. *Home Base.* First the handoff (§9 "The handoff"): the title text, "Every run is a thread
   Sera weaves. When one breaks, she weaves again. This one broke in the east, not by your
   hand.", leads the rules that hold from the first run on. Then Home Base.

Why Sera is with Edric from a real run's first morning: on every thread after the first, she
goes straight to him. The first run's opening line says so (§10).

Lines follow the voice sheet (lore style guide): ≤ 90 characters, one line, no double quotes.
Samples:

- Gaspar, joining: "I will ride ahead. Watch my hands, then choose your own stroke." (his
  existing intro; it moves here)
- Gaspar, the chip lesson: "I leave the opening. You take the blow that teaches."
- Edric, after P1: "Gaspar? You swore you were done with saddles." Gaspar: "The saddle was not
  consulted."
- Sera, on Glimmer: "I don't stand at the front. I stand where they can't reach me."
- Varro, pre-battle: "Lord of a border? There is no border. There is only the road east."

## 6. Chapters

Map sketches are proposals, except P1's, which is the shipped map (`data/prologue.json`). The
legend is `.` Plain, `F` Forest, `T` Fort, `~` Water, `=` Bridge, `V` Village, `G` Throne (the
gate), `#` Wall, `E` player start, and lowercase letters are enemies. In `data/prologue.json` the
map rows hold terrain only; spawns are coordinates.

**Numbers.** Damage, hit and strike counts below come from `getCombatForecast` on real data, with
level-1 base stats, no meta and no traits (verified 2026-10-04). They hold only for the authored
units of §9, which have fixed stats, growths and traits, `metaEffects: null` and seeded growth
rolls. The same actions give the same rolls; different actions don't. **The harness owns the
final tiles and asserts every interaction a beat relies on**, including each enemy's path.

**Every named unit is protected.** Edric, Gaspar, Sera (before and after she joins) and Tamsin
falling all trigger "Not this thread": the chapter restarts from its start (§9, defeat). Later
chapters and the ending assume all four, so there is no way to lose one for the rest of the
prologue.

### P1 — Banner at Dawn (Edric alone)

Story: deserters loot a farmstead on the quarry road. Edric rides out alone.

```
. . F . . . . .
. . . . F . . .
E . . T a F . .
. . . . . . F F
. . F . . T . .
. . . . F . F b
```

- **Roster:** Edric L1, Iron Sword, 1 Vulnerary.
- **Enemies:** Fighter `a` (L1, Iron Axe), next to the Fort. Fighter `b` (L1, Iron Axe, `hold`,
  `holdPack: 0`, `holdPackSize: 1`) in the far corner, behind Forest.
- **Placement rule:** the Fort is outside `b`'s Danger tiles (move 4 plus range 1, by path cost),
  so `b` stays asleep until Edric walks toward it. The first draft put the Fort 3 moves from `b`,
  which woke it on turn 1 and made both Fighters attack at once (code review, 2026-10-04).
- **A second Fort inside `b`'s reach** (5,4) is the fight with `b`'s cover, and the reuse of the
  terrain lesson. The harness found the first sketch unsafe (2026-10-04): a lone Edric can take
  three Fighter strikes before `b` falls (`a`'s counter on turn 1, `a`'s attack on enemy phase 1,
  `b`'s first attack), and 7 + 7 + 9 = 23 is more than his 20 HP plus the Fort's 2. The naive
  policy walked onto Plain at (7,2) and lost 4% of seeds. With the second Fort, `b`'s strike is
  7 too (21 against 22): the naive policy's turn-2 walk ends there (it is the only tile at
  distance 3 from `b` within reach; Forests at (5,2), (6,3) and (4,5) close the others), and every
  tile `b` can strike it from is Plain, so Edric's counters always land.
- **Objective:** Rout. No reinforcements and no fog.
- **Verified numbers:** Edric's sword against a Fighter is 8 per hit (triangle advantage), and he
  doubles (AS 6 vs 0): 16 a round against 22 HP. A Fighter hits Edric for 9 at 56% on Plain, or
  7 at 36% on the Fort.

The intended turn 1: Edric moves onto the Fort and attacks `a` from it (the first forecast), and
`a` is left on 6 (Edric's 1% crit can end it at once). On the enemy phase `a` attacks and Edric's
counter kills it. That shows a counter is not just something enemies do. Turn 2: Edric steps onto
the second Fort, inside `b`'s red reach; `b` wakes and attacks, Edric's counters leave it on 6, and
turn 3 finishes it.

**Core:** move, inspect a forecast, commit an action, understand the enemy turn (§2 "Core and
reinforcement"). Weight: *core* is a gate, a coach goal or a blocking note at its decision
point; *tip* is non-blocking reinforcement, shown only when its situation arises.

| # | Trigger | Lesson (coach goal / note) | Weight |
|---|---|---|---|
| 1 | Battle start | Coach "Select Edric". Blue units are yours, red are the empire's. | core (gate) |
| 2 | Edric selected | "Move onto the Fort." Cover lowers damage and raises avoid. *Gate* (as today). | core (gate) |
| 3 | On the Fort | Terrain (existing `battle_terrain`, after the panel refreshes). | tip |
| 4 | First forecast (against `a`) | **One concept: reading a forecast** (`battle_forecast`). Damage per hit, Hit chance, and whether the enemy strikes back. Confirm commits; Cancel goes back. *Gate:* the first confirm. | core (note) |
| 5 | Edric has acted, turn 1 | **Wait vs End Turn:** "Wait ends Edric's move. End Turn hands every enemy its move. Check who can reach Edric first." `a`'s red reach is shown; `b`'s doesn't reach the Fort. | core (note) |
| 6 | First enemy phase | "Red units move now. Edric strikes back when attacked, too." | core (enemy-phase nudge, never modal) |
| 7 | Level-up | After the level-up card: "Levels raise stats at random. Growth rates decide the odds." Edric's XP runs 22, 72, 94, then 144 on `b`'s kill, so this comes last, on the final blow. | tip |
| 8 | Edric walks into `b`'s reach | "Some enemies hold until you come close. Their red reach shows where." `b` wakes. | tip |
| 9 | Second forecast (against `b`) | **The triangle** (`battle_triangle`, conditional as today): one line in the forecast's own notes, "Swords beat axes, axes beat lances, lances beat swords. These numbers include it." | tip (forecast) |
| 10 | Edric ≤ 60% HP | "Item → Vulnerary heals 10. You carry few, and they never come back." (existing consumable copy) | tip |
| 11 | Victory | Gaspar rides in (dialogue). | story |

**Reuse:** the fight with `b` is unprompted beyond its two notes. The player picks the tile and
reads the forecast unaided. Doubling (the ×2 on Edric's forecasts) is explained in P2, where a
weapon choice changes it, so no P1 forecast carries two concepts (the shipped one-concept rule,
`tutorialLessons.js`).

**Safety:** the harness confirms that no run of Fighter hits and crits kills Edric within two
enemy phases from the Fort, or from the tile the naive policy leaves him on (the second Fort),
computed from the forecasts: the Fighters' crit is 0, `a` strikes at most twice, `b` can't reach
the Fort on enemy phase 1, and the Fort heals 2 on turn 2, so the worst case leaves him on 1. It
also confirms that the intended play and the naive policy win every one of 300 battle seeds
(`tests/harness/PrologueP1.test.js`).

### P2 — Old Hands (Edric + Gaspar): the Jagen lesson

Story: an imperial outrider squad at the ford, with a village the squad hasn't reached.

**As built (Phase 2A, `data/prologue.json` `p2_old_hands`; the harness in
`tests/harness/PrologueP2.test.js` pins every number below):**

```
. . . F . ~ . . . .
. . . . . ~ . . . .
. . . . . = . . . .
. . . . . ~ . F F .
. . . V . ~ ~ ~ . .
. . F . . ~ . . . .
```
Edric spawns at (0, 2) and Gaspar at (0, 3). Archer `a` (L1, Iron Bow) stands at (3, 1) on the
west bank; Fighter `b` (L1, Iron Axe) holds the bridgehead at (8, 2) as a `hold` pack of one;
Soldier `d` (L1, Iron Lance) `guard`s at (9, 0) on Plain. The village is (3, 4).

- **Roster:** Edric at level 2 (`rosterLevels`: P1's reward, replayed standalone with seeded
  level-ups), and Gaspar: the standard special character (Steel Lance and Iron Sword, Measured
  Step, Aegis). His data is unchanged.
- **Village:** an authored `villageTile` (painting `V` terrain alone is not a visitable village).
  It's uncontested: no bandit squad (§8). The visit reward is a fixed Iron Bow (`reward`),
  delivered to the convoy as village rewards always are. It sets up row 2.
- **Loot:** an authored offer, not a random draw: an Iron Lance, three Vulneraries, or 150 gold
  (`loot`; `buildPrologueLootChoices`). The Store step at row 2 needs a weapon to exist.
- **Objective:** Rout. No par (`showPar: false`): no HUD Par, no turn bonus, no late pressure.

**The Jagen beat** (verified on real data, `getCombatForecast`):
- Gaspar's Steel Lance against the Archer: 16 of 18 HP at 88 Hit, one strike (no double), and
  no counter at range 1. The Archer is left on 2.
- Edric finishes it from an adjacent tile: 8 at 100 Hit, no counter.
- Gaspar's Iron Sword against the same Archer: 12 ×2 at 100 Hit, a kill. So the forecast shows
  the choice: **the lance chips, the sword kills.**
- The note is the in-run `guide_veteran_kills` (`p2_veteran_kills`): "Gaspar is strong now but
  barely grows and earns little XP. Weaken enemies with Gaspar, then leave the final blow to
  Edric and your recruits: they grow from it." In the prologue run, showing it marks the slot's
  hint as read.
- The Fighter hits Gaspar (lance) for 10 at 75%; Gaspar's sword takes the Fighter at 13 ×2.
  The Soldier hits Edric for 8 and Edric's sword is at a triangle disadvantage against it;
  Gaspar's lance opens the Soldier for 13. No enemy can crit Edric (LCK 6).
- The Archer starts on the west bank so the Jagen beat lands on turn 1, before the bridge.

**Core:** use the veteran to support another unit; compare weapon choices.

| # | Trigger | Lesson | Weight |
|---|---|---|---|
| 1 | Battle start | Gaspar's intro lines (`p2_gaspar_intro`). | story |
| 2 | Gaspar selected | The Jagen note (above), the veteran lesson alone (the Measured Step clause is cut: his skill text says it). | core (note) |
| 3 | Gaspar targets the Archer | **Weapon choice and doubling** (`battle_doubling`, one concept: strike count). The lance reads 16 ×1, the sword 12 ×2. | core (note) |
| 4 | A forecast with no counter | `battle_no_counter`: bows reach two tiles only. | **cut**: the forecast already prints "Cannot counter · reason"; P3's range note teaches the rule where it is the lesson, and a real run's forecast teaches it inline (`forecastTeachingHints`) |
| 5 | A forecast under 100 Hit | Forecasts are possibilities (`p2_forecast_chances`). | **cut**: the forecast's own "How to read this forecast" points, and a real run's inline counter-risk note (`battle_counter_risk`) |
| 6 | Edric's forecast against the Soldier | The triangle against Edric (`p2_lances_beat_swords`): "Lances beat swords. Let Gaspar open the Soldier; Edric finishes it." One line in the forecast's notes. | tip (forecast) |
| 7 | Edric's kill of a foe Gaspar already damaged | Marks `veteran_kills` practised (`p2_chip_then_finish`: `kill` and `damagedBy: "Gaspar"`; review, 2026-10-04). The controller keeps who damaged which foe from each exchange's HP before and after, the attack or the counter alike, and `combatResolved` carries it (`damagedBy`) with the committed `distance`; a kill on an untouched foe leaves the beat unspent. The ledger rides the suspend snapshot. | ledger |
| 8 | Turn 2 | Danger (`battle_danger_zone`; P1's turn note already named it). | tip |
| 9 | A unit moves onto the village (`terrain: Village`; the tip shows before the Wait that visits) | Visit (`p2_village_visit`): gold, and an Iron Bow sent to the convoy. Optional discovery: nothing points at the village; Tamsin's bow comes at row 2 either way. | tip |
| 10 | Victory | The victory lines (`p2_victory`), then the authored rewards. | story; the **loot** note is **cut**: the reward screen explains itself (each card says what it is and who can use it) |

Forecast notes fire one concept per forecast (`prologueBeatsFor`'s `oneNote`): the first
matching note beat shows, the rest wait for a later forecast.

**Reuse:** the guarded Soldier is the unprompted check. Edric's sword is at a disadvantage, so
the player has to apply the P2 pattern unaided: Gaspar softens, Edric finishes, and no Jagen
note fires again.

**Gaspar doesn't solve the map.** The harness proofs (300 seeds unless noted):
- the intended script (lance chip so Edric finishes, sword kills only when Edric can't reach,
  crit-free safety margins) wins 300/300; Edric's lowest HP 7, Gaspar's 3; Edric finished the
  Archer in 295/300; the village was visited in 299/300; 3–8 turns;
- a naive policy (path-distance nearest, equipped weapon, Vulnerary at ≤60% as P1 taught)
  wins 298/300, and 295/300 with Edric at P1's stats;
- a Gaspar-only policy (Gaspar rides ahead alone) loses him in 91/100;
- no enemy-phase sequence (hits and crits) kills Edric from where the intended script leaves him
  (the exposure guard asserts worst-case damage below his HP at every player-phase end);
- P1 is unchanged by P2's data: 300/300 for both policies.

Deviations from the first draft (each a proof result): one Fighter instead of two (two woke
together and killed Gaspar on the bridge); the Soldier at L1 on Plain, not L2 on a Fort (the
Fort's heal and +2 DEF stalled a naive Edric at low HP); the Archer on the west bank (across
the bridge it drained Gaspar before the lesson); Myrmidons were tried for the Fighters and
rejected (Gaspar soloed them, 98/100).

### Route map, row 2 — Harrow's Crossing (Market | Chapel)

The route map first appears after P1. Here it shows its first real choice, and node preview is
the lesson.

**As built (Phase 2B; `data/prologue.json` `route`, `joins.atNode`, `units.Tamsin`):**

- **The fork.** `prologue_1` (P2) leads to `prologue_2a` *Harrow's Market* (Shop, row 2, col 1)
  and `prologue_2b` *Harrow's Chapel* (Church, col 3); both lead to `prologue_3` (P3). The first
  route map with two live nodes in the prologue run shows the fork note once per slot (hint
  `prologue_fork`, `PROLOGUE_FORK_NOTE`): "Tap a node to see what it holds. Travel commits; you
  can't come back." Each node's card reads its authored `preview` (≤ 160 characters) in place of
  the generic service line (`describeLoomNode`): the Market's "Spend your gold on fixed stock: no
  restock here. The crossing's watch archer waits at either stop.", the Chapel's "Heal the whole
  army for free; revive the fallen for gold. …". The other service is taught at its first Act 1
  visit (§11, phase 3).
- **The Market** sells its authored `stock` (Vulnerary, Vulnerary, Iron Sword, Iron Lance,
  Javelin; 1–8 priced items, shop nodes only, validated): `buildPrologueShopStock` prices each as
  an Act 1 shop does (`actShopPrice`), then the run's own price rules apply as for any shop. No
  random Act 1 draw, and no Restock (`ShopController.canReroll` is false in the prologue run;
  the menu hides the button). Its status line: "This market's stock is fixed while you're here.
  Every shop node stocks its own. Gold also pays for revivals and promotions."
- **The Chapel:** Heal all (free) and revival (for gold) work as in a run. The blessing altar is
  shown, every offer greyed with "Blessings begin with your first run." (`churchBlessingBlock`).
  No Kindle: the Eclipse is off in the prologue, so the Kindle row never draws. Its status line
  says the same.
- **Tamsin joins on arrival, at either node** (`joins.atNode`: both nodes; an arrival join needs a
  `join` spec and a service node, validated). `RunManager.arriveAtPrologueNode` adds her once
  (a reload at the node adds nothing) and, when the army holds no `join.needs` item (an Iron Bow
  in the convoy or any unit's bag: P2's village wasn't visited), puts one in the convoy.
  `ui/PrologueArrival.js` saves the run, then shows the standard recruit card with her authored
  line, before the service opens. She is an authored Archer at L1, **unarmed: her bow burned with
  her watch post** (Awakening's missing-axe trick). Her lines: "My bow burned with the watch
  post. Hand me the one in your convoy and I'll earn my keep." or, with the node's bow, "…There's
  one on the rack here. It'll do." Her roster card reads "No weapon. A bow is in the convoy."
  (`unarmedConvoyLine`, whenever the convoy holds a weapon an unarmed unit can use).
- **The roster lesson** (`engine/PrologueRosterLesson.js`, pure; `ui/PrologueRosterCoach.js`, the
  strip at the top of the roster sheet) runs once, the first time Roster opens at the node where
  Tamsin joined. Every Roster in a browser is the same sheet (`MobileRosterSheet`: the route
  map's Roster on desktop and phone, the Market's and the Chapel's Roster buttons), so the
  lesson lives there. Its **core is two goals, Withdraw and Equip** ("Roster lesson · 1 of 2");
  then **Trade and Store are offered as more**, never as steps ("More, if you like: Trade and
  Store … Optional: the road waits either way", *Show me* / *Done*; review, 2026-10-04). Each
  goal is completed by the real button (in any order: a goal met early counts, so a trade or
  store made during the core leaves nothing to offer, and the lesson ends with the core):
  1. *Withdraw:* give Tamsin the Iron Bow from the convoy. The step's text leads with the in-run
     `guide_convoy` copy ("The convoy is shared storage…"), and starting the lesson marks that
     hint read. It completes only when a combat weapon she can wield reached her bag (the
     sheet reports the item; a Vulnerary or a lance withdrawn to her is not the lesson;
     review, 2026-10-04).
  2. *Equip:* a unit with nothing equipped takes the first weapon it gets, so Withdraw already
     armed Tamsin. The practice is another unit's spare: "Equip Gaspar's Iron Sword". "Each unit
     carries up to 5 weapons. The equipped one is the one they fight with." It completes
     only when the named unit really fights with the named weapon afterwards.
  3. *Trade* (more): give Tamsin a carried consumable, the commander's first ("Give Tamsin Edric's
     Vulnerary"), else anyone's. When nobody carries one (Edric drank his Vulnerary in P1) the
     step skips itself with the reason ("Nobody carries a spare item to trade. You can trade in
     battle with an adjacent ally, too.").
  4. *Store* (more): a spare weapon (one its holder isn't fighting with), else a consumable. "Store puts
     a carried item in the convoy. Withdraw hands it back." (threat-and-onboarding §2: a
     playtester understood neither word.)
  "Skip step" and "Skip lesson" are always there (in the optional part, "Done" ends it);
  Close leaves the lesson where it was. The ledger (`RunManager.prologueRosterLesson`:
  completed, skipped, dismissed, `more`: null | accepted | declined; a save from before the
  offer reads null) is saved with the run. Nothing blocks travel: the lesson is live only while
  the party stands on that node. An unarmed unit in P3 gets the greyed Attack reason
  "Unarmed: no weapon to attack with" (in a prologue chapter the greyed-Attack reasons show
  whatever the Guidance level; `GuidanceController.reasonLevel`).
- **Leaving unarmed asks, never blocks** (review, 2026-10-04). Because the lesson can be skipped
  and never gates the road, a player could reach P3 with the bow still in the convoy. Travelling
  on from the node where Tamsin joined while she carries no combat weapon she can use
  (`engine/PrologueDeparture.js` `unarmedDeparture`: a staff, a Vulnerary or a lance she
  can't wield is no weapon) offers a choice (`ui/PrologueDepartureWarning.js`): "Tamsin has no
  usable weapon. She can't attack in the next battle until she carries one." *Open Roster*
  (the roster, on her; the lesson attaches if it is still live) or *Continue anyway* (travel
  now). It is asked once per Travel attempt (the attempt that continues is not asked again);
  Escape leaves the map as it was; without a DOM the road is open. It sits in
  `NodeMapScene.onNodeClick`, which every route-map travel path reaches (the loom's Travel
  button, a click and a phone's tap-tap on a node). `tests/PrologueDeparture.test.js`.

### P3 — The Seer on the Road (Sera's chapter)

Story: Sera runs down the road with soldiers behind her.

**As built (Phase 2B, `data/prologue.json` `p3_seer_on_the_road`; the harness in
`tests/harness/PrologueP3.test.js` pins every number below):**

```
. . . . . . . F . . . .
E . . . . . F . . . a .
E . F . S s F . . . b .
E . . . . . . . . F . .
. . T . . . . . . . . .
```
(`S` = Sera, green; `s` = Soldier, next to her; the `E` column is the three fixed spawns.)

- **Roster:** Edric (0, 2), Gaspar (0, 1), Tamsin (0, 3). In the run they enter with whatever
  HP, levels and kit P2 and the row-2 choice left them; there are no scripted wounds (the first
  draft's clashed with the Chapel's free heal). A title replay builds Edric at level 3
  (`rosterLevels`), the standard Gaspar, and Tamsin with an Iron Bow (`rosterItems`: a replay's
  extra kit; her authored spec stays unarmed).
- **Fixed spawns, no formation.** `playerSpawns` holds exactly the three units, so formation
  placement doesn't run and Edric's turn-1 reach to Sera stays authored. Formation is P4's.
- **Sera** (`units.Sera`; the chapter's `npc`, built by `buildPrologueNpcUnit`, the one builder
  `BattleScene` and `HeadlessBattle` share, never the recruit node's roster-average roll):
  Light Sage L1, HP 18, MAG 6, RES 7, LCK 6, MOV 4; Light and Staff ranks; Glimmer equipped,
  Heal carried, a Vulnerary; Renewal Aura (her lord skill). Talk joins her at once
  (`p3_sera_joins`: "I have seen you before, Edric. Many times. You always come for me.") and she
  acts the same turn. She is protected green or blue: her fall restarts the chapter.
- **Enemies:** three Soldiers (L1, Iron Lance, melee only). `s` (5, 2) stands beside Sera and is
  the only enemy that reaches her on enemy phase 1, and the only one that reaches any tile where
  Edric can Talk; `a` (10, 1) chases; `b` (10, 2) holds (a `hold` pack of one) until someone
  enters its reach. Enemies do attack NPCs, so the placement is what protects her.
- **Objective:** Rout, and Sera must have joined (`requiredRecruits: ["Sera"]`; review,
  2026-10-04). A plain rout ended the moment the third Soldier fell, even with Sera still
  green: the victory flow carried the player units only, `completeBattle` replaced the
  roster with them, and no join recovered her, so P4's 4-for-3 deploy lesson and the
  watchtower lines could run without her. Now the one rout predicate
  (`engine/RoutObjective.js` `isRoutComplete`, read by `BattleScene.checkBattleEnd` and
  the harness alike) holds the rout open while a required recruit is outside the army.
  If the Soldiers fall first the battle stays playable (an empty enemy phase passes), the
  objective line reads "Rout: Sera must join to win" beside the recruit beacon's
  "Recruit: reach Sera with a lord · Talk", the coach's goal is "Reach Sera and Talk"
  whatever else is open, and the Talk itself checks the battle's end, so victory fires
  the moment she joins. The validator allows `requiredRecruits` only on a rout, naming
  the chapter's `npc`; a standard run never sets it, so its recruit rules are untouched.
  No par.

**The numbers** (`getCombatForecast` on real data, the harness's first test):
- Glimmer against a Soldier from 2 tiles: 9, and the lance can't answer (No counter).
- Edric's sword against the same Soldier: 4 (DEF 6 and the triangle against him). Magic past
  armour is more than twice the blade.
- A Soldier on Sera: 9 of her 18, one strike, 0 crit: one hit never kills her.
- The threat exercise: the Forest pair at the front, (6, 1) and (6, 2), is reached by exactly
  the two far Soldiers; the plain tile (4, 3) behind the line by none.

**Sera's lessons** (each a beat; one note per move, `oneNote`, the first matching note speaks):

**Core:** recruit Sera, heal someone, attack safely from range.

| # | Trigger | Lesson | Weight |
|---|---|---|---|
| 1 | Battle start | Gaspar's and Edric's lines (`p3_intro`), the coach "Reach Sera and Talk" (Sera highlighted), then the recruit note (`guide_recruit_on_map`): "Sera (Light Sage) under the gold banner can join you. … Only the Soldier beside her can reach her this turn. Lords alone can Talk." | core (note) |
| 2 | Talk with Sera | Her line on the recruit card, then the coach "Sera acts right away"; it clears when she acts. With the Soldiers already down, her join is the win. | core (coach) |
| 3 | Sera selected while an ally is hurt | **Heal** (`guide_healer_heals`): "Sera heals with her staff: move next to {ally}, choose Heal. Staff uses refill after every battle; a Vulnerary is spent for good." {ally} is the most hurt. | core (note) |
| 4 | Sera moved where nothing is in reach | **Planning and cancelling** (`guide_no_attack`): her menu shows "Attack · No target in range 1–2"; "Nothing is in reach from here, so Attack is greyed out. Esc or right-click (Back) undoes the move… Try a tile 2 away from a foe." | tip |
| 5 | Sera 2 tiles from a foe | **Range** (`battle_no_counter`): "Glimmer reaches 2 tiles. From 2 tiles away, a lance or an axe can't hit back." Coach: "Open the forecast, then Cancel. Looking is free." Practised (`p3_glimmer`) only by a strike she commits from 2 tiles (`distance: 2`; review, 2026-10-04): an adjacent strike is not the lesson. | core (note) |
| 6 | A forecast showing magic | Magic against RES. | **cut**: the forecast's numbers show it (9 against the blade's 4); Act 1's armor note (`guide_armor`, "Magic hits RES") teaches it where it decides a fight. Not folded into the range note: that note stays one concept |
| 7 | Sera or Tamsin moved into reach | **Count every enemy that reaches you** (`guide_fragile_in_reach`): "Cover isn't safety. {n} enemies can reach {unit} here… Count the red eyes, not the trees." The action menu stays live: Back is the advice. | tip |
| 8 | Sera ends next to an ally | **Aura:** "Renewal Aura: allies next to Sera heal 3 HP at the start of your turn." | tip |
| 9 | Player turn 2 begins with someone hurt | **Recover by changing the plan**, optional. The run's one Vision charge is granted (`grantVision`; `RunManager.grantPrologueVision`, once per run, reverted with the battle), then the tip: "{ally} is hurt. Sera grants one Vision. Rewind takes back moves…", with an *Open Rewind* button. After a rewind, the first move that ends out of every enemy's reach: "Same turn, better plan." (tip). Declining is fine; the charge stays for P4. | tip |
| 10 | Victory | Sera: "I don't stand at the front. I stand where they can't reach me." Edric: "Then stand behind us. We hold the road, you hold us together." (`p3_victory`). | story |

**The harness proofs** (300 seeds unless noted):
- the intended script (the lessons as a player would apply them: Talk on turn 1, Sera heals the
  most hurt and strikes from 2 tiles, strikes only where the worst case leaves the striker
  standing, a counter accepted only for a sure kill, the commander pulled back at half HP) wins
  300/300 from the replay roster (lowest HP Edric 8, Gaspar 5, Tamsin 12, Sera 18; 3 turns);
  from every end state the intended P2 leaves it wins 299/300 through the Market (one seed lost
  Edric) and 100/100 through the Chapel;
- a naive policy (nearest enemy with the equipped weapon, plus only what the notes say: Talk,
  heal the hurt, back out of a fragile tile, no strike into a lethal counter, the commander
  pulls back at half HP) wins 300/300 from the replay; from the naive P2's end states, 99/100
  through the Market with Tamsin armed, 99/100 with her unarmed, 100/100 through the Chapel;
- no enemy-phase sequence (hits and crits) kills Edric or Sera from where the intended script
  leaves them;
- battles last 2–6 turns (the replay's intended play: 3).

Deviations from the first draft (each a proof result): Soldiers instead of Fighters (Fighters
reached Sera and Edric on enemy phase 1, and axe pairs killed a naive Gaspar: an axe hits his
lance for 10, a Soldier's lance for 6); two far enemies, one chasing and one holding, instead
of three Fighters; a 12 × 5 map; the rewind exercise starts on player turn 2 (the same moment
as "after enemy phase 1"); the magic note names armour (Soldiers) rather than axes; the replay
enters with Edric at level 3 (P1 always ends him at level 2 at least, so P2's "Edric at P1
stats" floor has no P3 counterpart).

### Route map, row 4 — The Old Watchtower (Ruins)

This mirrors the real pre-boss Ruins. *Rest* (heal all, free) or *Scavenge* (the ruins shop).
The choice commits behind the real Ruins confirmation ("This cannot be undone"; RuinsCommands,
kept on the run). Sera tells the vision here (§10).

**As built (Phase 3).** Node `prologue_4` (`type: "ruins"`, title "The Old Watchtower"; preview
"Rest heals the whole army, free. Scavenge opens the tower's old stores instead. The ruins
allow one."). Its `stock` (Vulnerary ×2, Javelin, Steel Sword) is the Scavenge wares, priced as
an Act 1 shop and marked up as every ruins is. Its `lines: "watchtower_vision"` play on arrival
(`ui/PrologueArrival.js`), marked spoken and saved before the first line, so a refresh never
replays them. The sanctuary's status line says what the tower holds
(`PROLOGUE_SERVICE_LINES.ruins`; the wares' line `ruinsWares`).

### P4 — The Quarry Gate (deploy, formation, seize, boss, par)

```
# # # # # # # # # G # # #      G = the gate (Throne), Varro on it
# # # # # # # # T T T # #      T = Fort
. . . . F . . . . . . . .
. . . . . . . F . k . . .      k = Fighter (guards the gate's approach)
3 . T . . . . . . . F . .      1-3 = the spawns in deploy order: the commander is 1
2 . . . . F . . . . . . .
1 . . . . T . . a . . . .      a = Fighter (comes for the army, along row 6)
```
(13 × 7, exact in `data/prologue.json`. Spawns (0,6), (0,5), (0,4) in that order; formation
spares (1,4), (1,6).)

- **Route preview names the boss:** "Boss · Captain Varro · Fighter · Iron Axe (reach 1)"
  (`prologueBossLine`, on the loom card). The deploy screen shows no boss, and the boss card
  plays after deploy, so the route preview is where the deploy choice gets its information.
- **Deploy screen, first time:** four units (Edric, Gaspar, Tamsin, Sera), three slots, Edric
  locked, at least two. Its note (`p4_deploy`, once per slot; it marks `battle_deploy` read):
  "Your commander always deploys. Choose who fights: 3 slots. / Varro and his men carry axes,
  and swords beat axes: Roster equips before you deploy. / Varro's axe reaches 1 tile: who can
  hit from 2? / Gaspar still fights well: let him weaken foes, and let the others finish them."
  (A replay has no Roster button, so its note leaves that clause out.) The last line is P2's
  veteran lesson as it was meant: it was about his kills, never about leaving him out. This
  is the first deploy screen, where the misreading ("Gaspar barely grows, so bench him")
  would first be acted on, and every Act 1 deploy screen after it inherits the answer. It
  adds no rule, so the note still carries one decision (who fights) and the facts that
  decide it.
- **Formation, first time:** three deployed opens formation placement; the panel adds "Tap a
  start tile to move a unit there. Who stands in front takes the first blow."
  (`chapter.formation.tiles` gives the spares; `FormationController` opens for a chapter that
  names them.) The boss card and Varro's lines play over the empty field first, as in any
  formation battle. The deploy screen fields in roster order, so the commander takes the first
  spawn, the bottom one on the row the Fighter `a` walks in by, and the last unit picked (Sera
  or Tamsin) the top one: the default formation is already a sane one, and Auto-place keeps it.
- **Boss: Captain Varro.** A Fighter at **level 1** with `BOSS_STAT_BONUS` and an Iron Axe,
  his STR and SKL authored (`stats` on his spawn, applied after the boss bonus by
  `EnemySpawnGear.applySpawnLoadout`): HP 24, STR 7, SKL 3, SPD 7, DEF 6, RES 3, LCK 4. The
  bonus goes to his guard, not his axe. He is the prologue's own boss (`prologue.boss`, in no
  act pool; the boss card reads his epithet "Keeper of the Quarry Gate" from there). Lines:
  `bossEncounters['Captain Varro']` (pre-battle with Edric's reply, half health, defeat at
  victory). He has no enrage layer: the act's boss theme plays, and turn pressure leaves it
  as is.
- **The throne:** Varro is clamped to it and the tiles beside it (the boss AI on a seize map:
  here only the gate's step, (9,1), a Fort); on it he gets +15 avoid and +3 defence, applied
  against magic as well, and heals 10% a turn. From the step he reaches the tiles 2 from the
  throne, so striking from 2 is safe from his counter, and from his next blow only while
  someone holds the step.
- **Verified numbers** (the replay army: Edric L3, Gaspar L1, Sera L2, Tamsin L1; pinned by
  `tests/harness/PrologueP4.test.js` where they are rules):

  | Attacker | Varro on the throne | Varro on plain |
  |---|---|---|
  | Gaspar, Iron Sword | 8 ×2 (100%), counter 7 (61%) | 11 ×2 |
  | Gaspar, Steel Lance | 9 (64%), counter 9 (81%) | 12 |
  | Sera, Glimmer at range 2 | 5 (76%), **no counter** | 8 |
  | Tamsin, Iron Bow at range 2 | 1, no counter | 4 |
  | Edric, Iron Sword | 3 ×2, counter 8 (60%) | 6 ×2 |

  Varro's own blow: 8 on Edric, 7 on Gaspar, 11 on Sera and on Tamsin (a Fighter's: 9, 8,
  12, 12). Par 10; the boss enrages on turn max(par + 1, min(12, par + 2)) = 12.
- **Enemies:** Fighter `k` (`guard` at (9,3): it charges anything within 3 tiles of its post),
  Fighter `a` (chases). Both are the class at level 1 with an Iron Axe: every foe on the map
  carries an axe, so swords (Edric, Gaspar) have the triangle and the bow and the light
  (Tamsin, Sera) strike from 2 without an answer.
- **Objective:** Seize. Defeat Varro, then a lord stands on the gate and chooses Seize (any
  lord; the Seize command raises the chapter's `seize` beat before the victory flow).

**Core:** make a deployment choice, and complete the seize with less guidance.

| # | Trigger | Lesson | Weight |
|---|---|---|---|
| 1 | Deploy screen | Choose who fights, the axes, the reach, Gaspar's lesson as meant (above). | core (note) |
| 2 | Battle start | Seize and par, with this battle's par: "Seize: defeat Captain Varro, then a lord steps onto the gate and chooses Seize. / Par: win in 10 turns or fewer for bonus gold. Safety first; speed pays." (marks `battle_seize`, `battle_par` read) | core (note) |
| 3 | First forecast against Varro on the throne (`forecastOpened` with `targetTerrain: "Throne"`) | One line in the forecast's notes: "The throne guards Captain Varro: harder to hurt, and he heals. Strike from 2." | tip (forecast) |
| 4 | Varro below half | His half-health line (existing boss beat). | story |
| 5 | Varro falls | Edric: "Varro is down. The gate is ours to take, before the column regroups." The coach turns to "A lord: step onto the gate and Seize", the gate is highlighted, and then the tip "Captain Varro has fallen. Now a lord: step onto the gate and Seize." (marks `guide_objective_changed` read once read; unread, Act 1's first seize teaches it) | coach (core) + tip |
| 6 | Seize | Varro's defeat lines (a boss's defeat lines play at victory), then the ending (§5 beat 7). | story |

**Prompts fade here.** The coach shows only the objective ("Defeat Captain Varro, then Seize
the gate"), with no goals for moving, attacking, healing, weapons or ranges. Choosing Gaspar's
weapon, striking from 2 tiles and healing are the unprompted reuse of P2 and P3.

**Winnable with any deploy** (`tests/harness/PrologueP4.test.js` after the watchtower's Rest,
`tests/harness/PrologueP4Scavenge.test.js` after its Scavenge; 100 seeds a cell, the entering
army cycling over 60 P3 end states; a win = seized with nobody falling, before the enrage
turn). The policies (`tests/harness/prologueP4Policies.js`):
- **naive:** §8's habits plus what the notes say: the deploy note's sword against axes, P2's
  "watch the ×2" weapon switch and "let Gaspar open the Soldier", heal at 60%, drink at 60%,
  no strike into a killing counter, Edric pulls back at half HP, Sera and Tamsin keep out of
  reach where they can, strike the throne from 2 where you can, a lord walks to the gate.
- **intended:** the same habits with every lesson applied: the weapon that answers the
  nearest foe in hand, Sera heals under 75%, and P1's "check who can reach you" and P3's
  "count every enemy that reaches you" for every unit: a strike or a move ends only where
  its counter and everything that can reach the tile, every blow landing, leave the unit
  standing (Edric with a margin of 4), the least exposed such tile first.
- Both: a non-lord never parks on the gate once Varro falls (the note gives it to a lord).

Floors: Rest, every deploy: intended ≥ 95, naive ≥ 92 (the replay: ≥ 95 for both, 300 seeds
for the recommended deploy). Scavenge with Sera fielded: intended ≥ 95, naive ≥ 85. Scavenge
with no healer: intended ≥ 85, naive ≥ 80 (below §8's bar; see below).

| After Rest (intended / naive) | Edric+Gaspar+Sera | Edric+Gaspar+Tamsin | Edric+Tamsin+Sera | Edric+Gaspar |
|---|---|---|---|---|
| Replay | 300/300 / 100 | 100 / 97 | 100 / 100 | 100 / 95 |
| Intended P3's end states | 100 / 100 | 100 / 96 | 100 / 100 | 100 / 97 |
| Naive P3's end states | 100 / 100 | 100 / 96 | 100 / 100 | 100 / 97 |

| After Scavenge (intended / naive) | Edric+Gaspar+Sera | Edric+Gaspar+Tamsin | Edric+Tamsin+Sera | Edric+Gaspar |
|---|---|---|---|---|
| Intended P3's end states | 100 / 100 | 92 / 84 | 100 / 100 | 93 / 83 |
| Naive P3's end states | 100 / 95 | 88 / 86 | 100 / 100 | 86 / 88 |

Before this tuning (the same policies' predecessors, 2026-10-04): Edric+Tamsin+Sera won 14/50
rested; Scavenge without a healer about a third; Scavenge with Sera 87/100.

**Scavenge without a healer stays below §8's bar, on purpose.** Scavenge carries P3's wounds,
and with Sera benched nothing on the field mends them: Fort and throne heal 10% a turn, and
Edric's Vulnerary is the army's only other heal. With Edric+Gaspar+Tamsin, 21 of the 100
seeds after the intended P3 and 41 after the naive one enter crippled: Gaspar at 8 HP or
less, or Edric at half or less with no Vulnerary. The intended play's losses are almost all
there (18 of 20); the naive play's are too after the naive P3 (12 of 14), and after the
intended P3 most are a Gaspar entering at 10-13 HP whom it walks up to the gate's step.
Lifting those seeds to 85/95 needs a garrison that cannot hurt a wounded Gaspar: tried
(Varro at STR 6), it does that (the naive play 86 with and without the intended P3), and it
also lets Gaspar take the gate alone 97 times in 100 and a reckless play with him win 97-100,
which §2 ("the veteran supports, never solves") and this chapter's lessons rule out. The gap
is the route's lesson instead: the watchtower's preview says Rest heals the whole army, a
fall restarts P4 at its deploy screen with Sera on the bench to pick, and the run's own Ruins
work the same way.

**The chapter still needs positioning.** A reckless play (every unit strikes the nearest foe
from the cheapest tile, whatever the forecast or the Danger says; nobody heals, drinks or
pulls back) loses Gaspar in 8 of 100 with Sera, 6 with Tamsin, and loses 33 of 100 without
Gaspar; Gaspar riding at the garrison alone falls 9 times in 100 from the replay and 12 after
P3. With the recommended deploy no run of hits and crits can kill Edric where the intended
play leaves him.

**The deploy note's sword.** Without its habit (the naive play leaving Gaspar on the lance
P3 handed him) the naive play wins 84/100 with Edric+Gaspar+Tamsin against 96 on the sword:
why the note says it, and why the replay's Gaspar holds his sword (`rosterEquip`).

**Deviations from the draft (each a proof result).** Varro is level 1, not 3: at L3 with the
boss bonus he hit Edric for 12-16 on the throne while Edric did 1-3, and no army P1-P3 can
build won reliably. The map is 13 × 7 with the gate in the wall's line (the draft's Varro
"beside the gate" never sat on the throne). The deploy note also teaches equipping against
axes (the draft had no weapon advice, and Gaspar's lance against axes is a loss mode no other
habit fixed). Sera's line at Varro's fall became Edric's (she may not be deployed); the
half-health and defeat lines are Varro's.

**Retune for every deploy (2026-10-04).** As first built (Varro at the full boss bonus, STR
10; a Soldier at the gate; an Archer and a second guarding Fighter on the road; spawns top
first) the chapter won 93-97% with Gaspar and failed without him: the throne made Varro a wall
only Gaspar's sword broke (Tamsin 1 a hit, Edric 3 with an 11-point counter, Sera 5, against a
2-point heal), the Archer kited Edric and Sera, the Soldier's lance beat both swords, and a
benched Gaspar (the misreading P2's note invites) met a 28% chapter on the first deploy screen
a player ever sees. Each change below is a proof result:
- **The Archer and the far Fighter are gone; the gate's Soldier is a Fighter.** Removing the
  Archer alone lifted Edric+Tamsin+Sera from 7-32% to 40-83% across the cells; with the Soldier kept
  at the gate, Edric+Gaspar+Tamsin after Scavenge won about a third with the naive play (his
  sword against its lance) where the Fighter gives four fifths. Every foe now carries an axe,
  which the deploy note can say plainly, and par is 10 (enrage still on 12).
- **Varro's STR 7 and SKL 3.** His blow on a hurt Gaspar holding the step decides most losses
  with Gaspar fielded (at the full bonus, STR 10 and SKL 5, Edric+Gaspar+Tamsin won 59 and 65
  of 100 after Scavenge and fell under 95 rested); at STR 6 Gaspar solos the chapter (above).
  SKL 3 lowers his hit by 4.
- **The commander's spawn first and at the bottom.** With the top spawn first, the last unit
  picked (Sera or Tamsin) stood on the row the Fighter walks in by and took its first blow
  (without Gaspar: 63-100% across the cells instead of 100%).
- **The intended play counts every reach**, and a non-lord never parks on the gate: the old
  intended play let a 5-HP Gaspar walk up to Varro, and Tamsin could stand on the gate and
  block the seize.

The armor lesson ("Knights shrug off swords. Magic hits RES.") moves to the first Knight a run
meets (§7).

## 7. What the prologue teaches, and what it leaves to Act 1

| Mechanic | Where (core = a blocking note, gate or coach goal; tip = non-blocking, when it arises) |
|---|---|
| Select, move, attack, forecast, end turn, enemy phase, counters | P1 (core) |
| Terrain, weapon triangle | P1 (tips; the triangle again as a forecast tip in P2, and the deploy note's "swords beat axes" in P4) |
| Consumables are permanent | P1 (tip, at ≤ 60% HP); P3's heal note says it again |
| Holding enemies and reach | P1 (tip) |
| Level-ups and growths | P1 (a tip at turn 2, once Edric has fought: the EXP bar, then what a level does) |
| Doubling and attack speed, weapon choice | P2 (core) |
| No counter (bows), forecasts are chances | cut from P2: the forecast's own lines; P3's range note (core); a real run's inline forecast notes |
| Danger | P1's turn note (core); P2 turn 2 (tip) |
| Gaspar: chip, don't kill | P2 (core), plus the in-run note |
| Villages (visit) | P2 (tip, optional discovery; uncontested) |
| Loot screen | P2's rewards (the screen explains itself; the loot note is cut) |
| Route map, preview, path choice | after P1; the fork at row 2 |
| Shop or Church | row 2 (the other in Act 1) |
| Roster: withdraw, equip | row 2 (core of the roster lesson) |
| Roster: trade, store | row 2 (offered as more); in-run `guide_convoy` |
| Recruiting by Talk | P3 (core) |
| Sera: heal, 2-tile strike | P3 (core) |
| Sera: fragility (counting threats), aura | P3 (tips) |
| Magic vs RES | cut from P3: Act 1's armor note (`guide_armor`) |
| Planning and cancelling | P3 (tip) |
| HP carries between battles | P3 (whatever P2 left), and Act 1 |
| Staves refill | P3 (the heal note, core) |
| Vision and rewind | P3 (tip with Open Rewind); the handoff ("charges last the whole run") |
| Ruins: Rest or Scavenge | row 4 |
| Deploy and formation | P4 (core) |
| Seize, bosses, par | P4 (core); thrones and the objective's change: tips |
| Commander rule (taught, never enforced) | P1 coach, P3 and P4 notes, the handoff, the first run's route note |
| The loop: the run resets, Home Base persists | ending and the handoff |
| Home Base and meta upgrades | the handoff, then Home Base |

Taught again in Act 1 at the point of use, because the prologue can only introduce them
(playtest-backed; built in Phase 3). Each is a Guidance note (`engine/Guidance.js`,
`essential` tier: Full and Light, never Off), once per save slot (HintManager ids), never in a
scripted battle or the prologue run, and shown where it never covers its subject; the
prologue's own lesson marks the same id read where it taught the subject
(`TUTORIAL_HINT_IDS`):
- **First Shop / first Church** (`guide_first_shop`, `guide_first_church`): whichever the
  player did not visit in the prologue gets its note as the service menu's status line on the
  first visit (the prologue's Market or Chapel marks its own read). Skippers get both.
- **Between-battle preparation** (`guide_prepare`, replacing the old `nodemap_hp_persist`
  note). At the first route map after a battle where someone ended below half HP: HP carries,
  staves refill, consumables don't, and Roster › Item heals now (it names the most hurt unit).
  A playtester's Sera entered a third battle at 3/18 HP.
- **Objective changes** (`guide_objective_changed`). The moment an objective changes
  mid-battle (a seize map's boss dies and the throne is left to capture), a short instruction
  names the new goal and points at the throne, at the next idle moment. Escape maps' exits are
  open from the first turn in this engine, so they have no mid-battle change to announce.
- **The first specialist's job** (`guide_specialist_dance`, `guide_specialist_flyer`). When the
  first Dancer (anyone with Dance) or flyer is first selected in a battle, one concrete job to
  try: Dance refreshes an ally who has already acted; a flyer crosses water and mountains (and
  bows strike it hard). Both mattered a lot in playtests.
- **Armor** (`guide_armor`). The first forecast of a weapon that hits DEF against a Knight (or
  any armoured foe: Armored, or DEF ≥ 9 and at least 6 above RES): "Knights shrug off swords.
  Magic hits RES." (other armour names its DEF and RES). It sits in the forecast's notes, never
  over it, and is read when the player confirms or cancels.

Left to Act 1 field notes (existing or §11 phase 3): promotion, skills and scrolls, weapon arts,
blessings, difficulty rungs, Colosseum, forge, escape maps, fog, affixes, status staves,
caravans, village bandits, the Eclipse's mechanics, and reinforcements.

### Not tutorial problems

The playtests also hit confusion that more teaching won't fix. These belong on the UI-fix
list, not in the prologue:
- objective text that goes stale
- commands hidden below the fold at phone size (the hire price, lower actions under the
  selection header)
- inconsistent inventory access: the reward screen's Roster is read-only, while the route
  map's Roster can manage and use items
- the battle timeline opening at the start instead of the latest event, with the casualty buried
  in expanded detail
- roster order changing after an escape

## 8. Rules for prologue battles

- **No unannounced arrivals.** No reinforcements, no bandit squads, no fog. The first-run
  feedback that triggered this spec named early reinforcements as the problem. (This branch
  also stops villages from rolling in First Light's first three Act 1 rows; see
  `docs/specs/village-bandit-objectives.md`.)
- **Authored and seeded.** Units have authored stats, growths and traits, no meta
  (`metaEffects: null`, replays included), and growth rolls seeded from the prologue seed.
  Enemy kits come from authored spawns, never from random weapon tiers or skills. The same
  actions give the same rolls.
- **Forgiving.** Each chapter must be winnable by a naive policy (move toward the nearest enemy,
  attack with the equipped weapon) with no named unit falling. The intended play wins with
  margin. The harness checks both. P4 is checked with every deploy the screen allows, after
  the watchtower's Rest and its Scavenge; Scavenge with no healer fielded is the recorded
  exception (§6 P4).
- **No named unit is lost.** Any named unit falling restarts the chapter (§6).
- **No Eclipse shadow, no deeds, no affixes, no run counters.** The prologue doesn't count as a
  run started or finished (`runsStarted`, `runsCompleted`), so Guidance stays on Full for the
  real first run (`isVeteranMeta`).
- **Run-layer events the prologue suppresses.** A real run's systems would otherwise fire on top
  of the coach (code review, 2026-10-04):
  - in-battle hints: `battle_par` and `battle_vision_scope_v2` on turn 1, `battle_danger_zone`
    on turn 2 (the prologue shows its own versions at its own beats)
  - all `GuidanceController` notes (it switched off only for the deleted tutorial's `tutorialMode`; now `isScriptedBattle`)
  - the route map's `runStart` cold open, the Act I card, Gaspar's run-start intro, and the
    `recordLinesPlayed` meta write
  - deed ceremonies; Church Kindle (Eclipse is off)
  - the third-lord trigger, the boss recruit screen, the boss's `+1 Vision`, `advanceAct`
  - `commanderFall` last words
  - Abandon Run, which would settle the run; the pause menu offers "Skip the rest of the
    prologue" instead
- **Lessons are recorded, as two facts.** A lesson *shown* marks its HintManager id read on this
  slot (as `applyCompletedTutorialHints` does today), so the first run doesn't repeat the text.
  A lesson *practised* (the player healed, struck from 2 tiles, chipped for a finish, deployed)
  is a separate record on the slot's meta, `prologue.practised: [ids]`. It is for playtest
  analysis and for re-offering a lesson in Act 1 when it was shown but never practised. Skipped
  and cancelled lessons never block progress.

## 9. Engineering plan

Findings this rests on (code survey and an adversarial code review, 2026-10-04, which
checked the combat numbers with `getCombatForecast` on real data):
- The engine has no fixed-map or fixed-route support except the tutorial's literal config.
- A run can carry hand-authored battles through `RunManager.battleConfigsByNodeId`. That is the
  locked-config path `BattleScene` checks before `generateBattle`. A locked map also caps
  deployment at its spawn count.
- A literal `nodeMap` (`{actId, nodes, startNodeId, bossNodeId}`) is plain serialized data.

### Data: `data/prologue.json` (validated, synced to `public/data`)

The schema is documented at the top of `src/engine/Prologue.js`, which is the reference. Shipped
(Phase 2B): the seed, the grant, authored Edric, Sera and Tamsin, P1–P3, the route through row 3
(`route`, with row 2's `preview` and `stock`), `joins` (`afterChapter`: Gaspar after P1;
`atNode`: Tamsin at either fork node), and (Phase 3) row 4's watchtower (`stock`, `lines`), P4
(`deploy`, `formation`, `rosterEquip`, its boss), `boss` and the `ending`'s scenes.

```jsonc
{
  "version": 1,
  "seed": 1209,
  "grant": { "valor": 50, "supply": 35 },        // one cheap upgrade of each (§12)
  "units": {                                     // keyed by unit name (the key is the name)
    "Edric":  { "lord": "Edric", "level": 1,
                "stats": { /* every stat incl. MOV: his lords.json base */ },
                "growths": { /* class-range midpoint + personal growth */ },
                "traits": [], "inventory": ["Iron Sword", "Vulnerary"] },
    "Sera":   { "lord": "Sera", "level": 1, "stats": { /* … */ }, "growths": { /* … */ },
                "traits": [], "proficiencies": ["Light", "Staff"],
                "inventory": ["Glimmer", "Heal", "Vulnerary"] },
    "Tamsin": { "className": "Archer", "level": 1, "stats": { /* … */ }, "growths": { /* … */ },
                "traits": [], "inventory": [],
                "join": { "line": "tamsin_joins", "needs": "Iron Bow",
                          "lineIfGranted": "tamsin_joins_bow_rack" } },
    // Gaspar: createVeteranKnight, unchanged (never built from this file)
  },
  "chapters": [
    {
      "id": "p1_banner_at_dawn",
      "node": "prologue_0",
      "title": "Banner at Dawn",
      "objective": "rout",
      "map": { "legend": { ".": "Plain", "F": "Forest", "T": "Fort" },
               "rows": [". . F . . . . .", "..."] },   // terrain only, space-separated
      "playerSpawns": [{ "col": 0, "row": 2 }],
      "enemies": [                                     // `id` names the enemy in beats
        { "id": "a", "className": "Fighter", "level": 1, "col": 4, "row": 2,
          "weapon": "Iron Axe", "skills": [] },
        { "id": "b", "className": "Fighter", "level": 1, "col": 7, "row": 5,
          "weapon": "Iron Axe", "skills": [], "aiMode": "hold", "holdPack": 0, "holdPackSize": 1 }
      ],
      "npc": null,            // P3: { "unit": "Sera", "className": "Light Sage", "col", "row", "line" }
      // P3 also: "rosterLevels": { "Edric": 3 }, "rosterItems": { "Tamsin": ["Iron Bow"] } (a replay's kit)
      "villageTile": null,
      "loot": null,
      "beats": [
        { "id": "p1_select_edric", "on": "battleStart", "once": true,
          "do": [{ "coach": "p1_select_edric" }, { "gateSelect": { "unit": "Edric" } }] },
        { "id": "p1_move_to_fort", "on": "unitSelected", "unit": "Edric", "once": true,
          "do": [{ "coach": "p1_move_to_fort" }, { "gateMove": { "col": 3, "row": 2 } }] }
      ]
    }
  ],
  "route": { "title": "The Quarry Road", "nodes": [ /* …, { "id": "prologue_2a", "row": 2, "col": 1,
             "type": "shop", "title": "Harrow's Market", "preview": "…", "stock": ["Vulnerary", …] } */ ],
             "edges": [ /* ["prologue_1", "prologue_2a"], … */ ] },
  "joins": { "afterChapter": { "p1_banner_at_dawn": ["old_knight"] },
             "atNode": { "prologue_2a": ["Tamsin"], "prologue_2b": ["Tamsin"] } },
  "boss": { "name": "Captain Varro", "className": "Fighter", "level": 1, "weapon": "Iron Axe",
            "epithet": "Keeper of the Quarry Gate", "lore": "…" },
  "ending": { "music": "music_explore_deep",
              "scenes": [ { "dialogue": "ending_gate_held", "card": "complete", "cue": "sealed", "won": true },
                          { "dialogue": "ending_east", "cue": "eclipse", "shake": true, "veil": "hollow_sun" },
                          { "dialogue": "ending_ridge" },
                          { "dialogue": "ending_thread", "cue": "rewind", "veil": "thread" } ],
              "titleCard": "Every run is a thread Sera weaves. …" }
}
```

A chapter has no keys for reinforcements, bandits or fog: the validator rejects unknown fields,
so §8's "no unannounced arrivals" is enforced by the format. Every enemy names its weapon and
its skills (`[]` for none), so no prologue enemy rolls a weapon tier or a skill.

- **Copy.** Spoken lines live in `dialogue.json`'s `prologue` section (`p1_gaspar_arrives`,
  `not_this_thread`, `watchtower_vision`, `p4_gate_open`, `ending_east` / `ending_ridge` /
  `ending_thread`; `bossEncounters['Captain Varro']` for his pre-battle, half-health and
  defeat lines). Coach goals, field notes and gate nudges live in `src/data/prologueContent.js`,
  each a function of a plain context (touch or desktop verbs, the lord's name, the arrived
  terrain's bonuses, the consumable's real numbers). Beat actions name copy by id (`coach`,
  `note`, `dialogue`); `tests/PrologueContent.test.js` checks every id a beat names has copy and
  every line keeps to the voice sheet. `NOTE_HINT_IDS` maps a note to the in-run field notes it
  stands in for (`battle_terrain`, `battle_forecast`, `battle_triangle`,
  `battle_consumable_supply`; P1's turn note mentions Danger, so `battle_danger_zone`).
- **A chapter names its `roster`** (unit keys, at most one per spawn; validated). The title
  builds it with `buildPrologueUnits` and the defeat restart builds it again.
- **Varro** is in a prologue-owned boss list. Boss-card epithets read `enemies.bosses`, and
  adding him to `bosses.act1` would put him in the real Act 1 boss pool (code review, 2026-10-04). The
  boss card's epithet lookup takes the prologue list as a fallback.
- **The validator** (`validatePrologueConfig`, run by `npm run validate:data`;
  `tests/PrologueValidator.test.js` breaks each rule on its own) checks:
  - map rows are rectangular and the legend resolves to terrain names
  - spawns are in bounds; player spawns are passable for Infantry, Armored and Cavalry (any
    unit the prologue can deploy), enemy spawns for their class's move type
  - authored weapons and items exist and the unit (its class, or its authored proficiencies)
    can wield them; at most 5 weapons and 3 consumables
  - enemy skills, unit skills and traits exist; a hold pack's `holdPackSize` is its holder count
  - an enemy's authored `stats` name real stats (HP..LCK, MOV) as integers (HP and MOV ≥ 1)
  - beats use known triggers, only that trigger's conditions, and known actions with valid
    arguments (tiles on the map, units of the chapter, lesson kinds); beat ids are unique
  - beats hold to their chapter: a `unit`/`target` is in this chapter's roster, NPC or
    enemies, on the side its trigger is raised for; a `tile` is ground a unit can stand on;
    a `terrain`/`targetTerrain` is on the map and agrees with the beat's `tile`; a beat
    whose copy or lesson is about a place (`PROLOGUE_TERRAIN_INTENT`: the village, the
    throne, P1's Fort) points only at it, a village beat at the chapter's `villageTile`, and
    an `afterMove` one names the tile or terrain it waits for (review, 2026-10-04: P2's
    village note waited on a Plain tile)
  - the boss is in no real act's pool; joins name known chapters and units
  - an arrival join (`joins.atNode`) is at a service node and its unit has a `join` spec
    (`line`; `needs` a real item and `lineIfGranted` go together)
  - every dialogue key a unit, an NPC or a beat names has lines in `dialogue.json` `prologue`
    (when the dialogue is loaded, as `validate:data` does)
  - a chapter's `npc` is an authored unit, of its unit's class, on the map, not in the roster;
    `rosterItems` names authored units of the roster and real items
  - a route node's `preview` is at most 160 characters; a `stock` is a shop's, 1–8 priced items
  - `grantVision` and `clearCoach` take only `true`
  - `validateBattleConfig` passes for every chapter's built config

### Pure engine: `src/engine/Prologue.js`

- `buildPrologueBattleConfig(chapter, terrainData)` turns the ASCII map into a battle config with
  terrain indices from the `TERRAIN` order (looked up by name in `terrain.json`, whose order is
  the same). The config has `generateBattle`'s shape (`templateId: 'prologue:<id>'`,
  `prologueChapter`, `parBonus: 0`, no `reinforcements`), so `BattleScene` computes par from it as
  it does for any locked map. Enemy spawns carry `authoredId`, `weapon`, `skills` and the hold
  fields; it also carries `villageTile`, `thronePos` (or the map's single Throne on a seize map)
  and the authored `npcSpawn`. It generalises `TutorialHelpers.buildTutorialBattleConfig`.
- `buildPrologueNodeMap(prologue)` (built) returns the literal node map: ids, rows, edges, types,
  titles, a node's `preview` and a shop's `prologueStock`, and `battleParams` with
  `prologueChapter`. `buildPrologueShopStock(stock, gameData, { rng })` turns a stock into shop
  entries at Act 1 prices; `prologueJoinsAtNode` / `isArrivalJoin` read `joins.atNode`.
- `prologueBeatsFor(chapter, event, state)` is a pure trigger matcher. It returns
  `{ actions, fired, state }`: the matching beats' actions in authored order, each tagged with its
  beat id, and a new state whose `fired` lists the `once` beats spent (the input state is never
  mutated). The vocabulary (documented in the module header):
  - triggers: `battleStart`, `turnStart {turn, phase}` (phase defaults to the player's),
    `unitSelected {unit, turn}`, `afterMove {unit, tile, terrain, dangerFrom, turn}`,
    `forecastOpened {unit, target, nth, concept, turn}`, `forecastCancelled {unit, target, turn}`
    (the player backed out of an open forecast; P3's `p3_looked` ends "open it, then Cancel"
    there, from every cancel input), `combatResolved {unit, target, turn}`,
    `unitActed {unit, turn}`, `unitDefeated {unit}`, `levelUp {unit}`, `hpBelow {unit, pct}`,
    `holdWoken {unit}`, `talk {unit, target}`, `healed {unit, target}`, `rewound`,
    `seize {unit}`, `victory`; Phase 2B added `hurt` (someone below full HP) to `turnStart` and
    `unitSelected`, and `safe` (no enemy reaches the tile), `inRange` (a foe is in attack reach
    from here), `foeDistance` (one visible foe is that many tiles away), `besideAlly` and
    `afterRewind` to `afterMove`
  - actions: `coach`, `note` (blocking), `tip` (non-blocking), `dialogue` (ids),
    `gateSelect {unit}`, `gateMove {col, row}`, `gateConfirm`, `highlight {tile | unit | reachOf}`, `markLesson {id, kind: shown|practised}`,
    `grantVision` (the prologue's one Vision charge, once), `clearCoach` (drop a goal no gate
    holds)
  - `forecastConcepts(forecast, { weapon })` gives a forecast's concepts (`triangle`, `doubling`,
    `noCounter`, `magic`, `uncertainHit`) for `forecastOpened` events; `dangerFrom` is the list
    of enemy ids whose Danger tiles (player knowledge) hold the tile.
- `buildPrologueUnit(spec, gameData, rng, { name })` builds Edric, Sera and Tamsin from their
  authored specs: lords through `createLordUnit`, generic classes through `createUnit`, then the
  authored stats, growths, traits (`[]`), proficiencies, skills and inventory replace what was
  rolled. Every draw (growths or level-ups the spec leaves out, item uids) comes from `rng`;
  Math.random is never touched (`createLordUnit`, `createUnit` and `rollGrowthRates` take an
  optional `rng`, defaulting to Math.random). `buildPrologueUnits(prologue, gameData, keys)` builds
  by key, each unit on its own stream (`prologueUnitRng(seed, key)`), with a chapter's
  `rosterItems` for a replay.
- **The authored NPC spawn (built, Phase 2B):** `buildPrologueNpcUnit(npcSpawn, gameData)` builds
  the unit `npcSpawn.prologueUnit` names from its spec (green, on its tile), and is the one
  builder `BattleScene` and `tests/harness/HeadlessBattle.js` both call (the recruit node's
  roster-average level never touches it).

### Authored spawns and the harness (built)

- `EnemySpawnGear.applySpawnLoadout(enemy, spawn, { weapons, skills })` runs after
  `applyEnemySpawnGear` in `BattleScene.addEnemyFromSpawn` and the harness alike: a spawn's
  `weapon` (by name, specials such as Javelin allowed, refused if the class can't wield it) and
  `skills` (exactly those) replace the rolled kit, `stats` (`{ <stat>: integer }`) replace
  those stats after the class, level and boss bonus (HP refills; P4's Varro), and `authoredId`
  is copied to the unit. The new weapon takes the dropped weapon's uid, so the battle's
  Math.random stream is the same with or without an authored kit. Spawns without these fields are built exactly as before
  (`tests/SpawnLoadout.test.js` pins that against a capture taken before the change).
- `HeadlessBattle.init({ battleConfig })` plays a locked config, as `BattleScene` does with
  `RunManager.getLockedBattleConfig`.
- Fort and Throne healing moved to `engine/TerrainHealing.js` and the harness now applies it
  (it never did). P1's safety rests on it.

### RunManager

- A new serialized field, `mode: 'standard' | 'prologue'`. `fromJSON` defaults it to
  `'standard'`, so old saves are untouched.
- **The prologue's run save stays on the device** (`CloudSync.isLocalOnlyRunSave`; review,
  2026-10-04). A client from before the prologue (an un-updated TestFlight build) reads
  `run_saves` without knowing `mode` and would open a prologue save as a standard run on the
  seven-node authored map. So `pushRunSave` never sends one, logout's backup leaves it out,
  and "Use this device save" with a prologue run deletes the cloud run it was chosen over
  (identity-guarded) instead of pushing. The slot's meta syncs as usual: a device without the
  run save sees `in_progress` with no run and gets the offer again (`routeForSlot`), and an
  old client sees a fresh slot. A prologue row an earlier build pushed is removed on the
  first prologue save of a session (only while the row is itself a prologue run). The cost:
  signing out mid-prologue, or moving device, restarts the prologue from the offer.
- **Signing out with an unfinished prologue** (review, 2026-10-05). Sign-out clears the
  slot cache (`SlotManager.clearAllSlotData`) so another account never inherits a save, and
  the prologue's run save cannot reach the cloud, so a confirmed backup is never consent to
  discard it. `CloudSync.backupAllLocalSlots` returns `{ ok, localOnly }`: `ok` vouches only
  for the batch it could carry (every meta, every standard run), and `localOnly`
  (`listLocalOnlySaves`) names each slot sign-out would clear whose run save is local-only
  (`[{ slot, kind: 'prologue' }]`; a slot logout keeps, `SlotManager.isSlotKeptAtLogout`, is
  never named). `TitleScene._handleLogout` then asks, after the rest is uploaded: "Sign
  out?" with "Your unfinished prologue on Slot N stays on this device and can't be backed
  up. Signing out discards it; it starts again from the beginning." and Keep playing
  (default) / Sign out anyway. A failed backup's "Discard local saves?" names the prologue
  too. `_finishLogout` reads the list again and asks about any save nobody agreed to (another
  tab), so none is cleared unseen; without a DOM nothing is discarded. On the same account's
  next sign-in the slot's meta comes back `in_progress` with no run, and `routeForSlot`
  offers the prologue again. The run is not kept in account-bound storage for a later
  sign-in: a whole slot (run, suspend checkpoint, clock floors, the device mirror) would have
  to be parked beside another account's cache and restored only into an empty slot whose
  meta still matches, for a chapter or two of replay; the warning is the contract
  (`tests/LogoutLocalOnlySaves.test.js`).
- `startPrologue(gameData, prologueData)`:
  - sets the prologue seed
  - starts the roster as authored Edric alone
  - sets `visionChargesRemaining: 0` (the constructor defaults to 1; a P1 death would otherwise
    offer a rewind and spend the charge P3's exercise needs)
  - builds the literal node map
  - pre-locks every chapter config in `battleConfigsByNodeId`
  - disables Eclipse (`createEclipseState({ enabled: false })`, the existing switch)
- `grantPrologueVision()` adds P3's charge on the RunManager, so it is saved like any charge. The
  tutorial's grant writes only `_standaloneVisionState`.
- It reuses `act1` as the act id for its tables (enemy pools, deploy limits, music), to avoid
  the ~15 act tables a new id would need.
- **Boss completion branches on mode.** No boss recruit screen, no third lord, no `+1 Vision`,
  no `advanceAct` (the suppress list in §8). The ending (`PrologueEnding.commitPrologueEnd`)
  calls `meta.completePrologue({ grant, chaptersCompleted, practised })` instead, which:
  - sets `meta.prologue.state = 'complete'`
  - pays the grant once (the `grantPaid` ledger flag, in the same write as the currencies; a
    failed write rolls back so a retry pays; a paid copy on disk is adopted first)
  - then the run save is cleared
  `meta.prologue` (`{ state, grantPaid, chaptersCompleted, practised }`) rides the meta
  payload to `meta_progression` like the rest of meta, under the `savedAt` freshness guard.
  **The grant's receipt travels with the economy that holds its effect** (review,
  2026-10-05). The cloud fetch (`CloudSync.applyMetaSlots`) keeps one payload whole by
  `savedAt` (its currencies and upgrades), so `grantPaid` comes from that payload alone,
  while the state (the further one), the chapters and the lessons union freely
  (`reconcilePickedPrologue`). When the union is `complete` and the kept payload never paid
  (the other copy finished; its grant went with its economy), the grant (`prologue.json`
  `grant`) is added to the kept currencies once and the receipt set, and the copy is written
  as a new save (newer than both, so the next fetch keeps it): never by taking a larger
  balance, which would restore spent currency. A kept payload with no record or `none`
  cannot vouch for a receipt (a client from before the prologue drops the record and keeps a
  fetched grant), so the other copy's receipt is kept and nothing is added. That is
  conservative on purpose: when the kept copy is an untouched new-client slot (`none`, saved
  after the other copy completed and paid), the slot ends `complete` with `grantPaid` set
  but without the grant in its currencies. The grant is lost there rather than ever paid
  twice, since a `none` record cannot be told apart from an old client's copy that already
  holds it (`MetaProgressionManager.reconcilePickedPrologue`). The local
  adopt-merge (`_adoptForeignDiskStateIfNewer`) keeps both economies at their max, so its
  receipt is the union (`mergePrologueState`): taking it from the newer copy there would pay
  twice. No transaction id: at most one payload's economy survives a pick, and the boolean on
  it is its receipt (`tests/PrologueGrantMerge.test.js`).
- **Built (Phase 2A):** `startPrologue` (the roster from the first-row chapter, Edric stamped
  commander, the route from `buildPrologueNodeMap`, every chapter pre-locked, `runStart`
  marked shown so the route map plays no cold open), `getPrologueChapter` /
  `getActivePrologueChapter`, the authored joins committed in `completeBattle`
  (`joins.afterChapter`, once), `grantPrologueVision`, `isPrologueComplete`,
  `restartPrologueBattle`, `mode` in `toJSON` / `fromJSON`.
- **Built (Phase 2B):** `arriveAtPrologueNode(nodeId)` (the arrival joins, once, and the `needs`
  item when the army lacks it); `prologueRosterLesson` (the roster lesson's ledger) and
  `prologueVisionGranted` (P3's charge, once per run) saved in prologue mode; the battle entry
  records `prologueVisionGrantedAtEntry`, so a chapter restart or a Continue from Map gives the
  charge back with the battle (`battleEntryRevertPatch`); `failRun` refuses in the prologue (a
  prologue run never fails: every fall restarts its chapter).

### BattleScene: `PrologueController` (built; `src/ui/PrologueController.js`)

- Owns the coach (`PrologueCoach`, the former `TutorialCoach`, now fed the live guided step's
  goal by the controller; `prologueCoachModel` derives the free-play goals), the gates, the
  highlights, the field notes and the spoken lines, all driven by `prologueBeatsFor`.
  `TutorialController`, `TutorialHelpers`, `tutorialLessons`, `tutorialCoachModel` and
  `tutorialForecastLayout` are deleted, not kept beside it (`prologueLessons.js`,
  `prologueForecastLayout.js`).
- A beat's actions apply in two passes: gates, the coach goal, highlights and the lesson ledger
  at once, then its notes and lines one at a time, so what a note points at (the Fort's ring,
  a Fighter's red reach) is on screen while it shows. A note is a modal Field note (battle state
  `TUTORIAL_HINT`, the rail inert); on the enemy phase it is a coach nudge (a notice band without
  a coach); raised at a phase start it waits until the player can act.
- **Tips** (a beat's `tip`, review 2026-10-04: §2 "Core and reinforcement") run after the
  beat's notes and lines and are never awaited, never pending and never in a checkpoint. On
  the map: `ui/PrologueTip.js` docks a `GuidanceNote` (kicker "Tip", Got it, an extra button
  from `PROLOGUE_NOTE_ACTIONS`: P3's Open Rewind) away from the units, one at a time (a new
  one replaces the last). One raised by `afterMove` or `unitSelected` is about that unit's
  moment and steps aside unread when that moment ends (`syncTip` each frame: the unit acts,
  is deselected or moves Back to another tile, a forecast opens, the phase changes); the
  others stay until read, dismissed or replaced. A blocking note or a line set closes any
  open tip first: a tip is never counted as read under a modal. Raised by a
  forecast: `AttackFlowController.showForecast` asks `prepareForecast` before the first
  render, so the beats are matched (one concept per forecast) and the tip is drawn into the
  attacker's notes (`forecast.attacker.lessonNote`, the armor note's slot) on every render
  until the forecast closes; `hideForecast({ acknowledge })` hands `onForecastClosed` the
  player's Confirm or Cancel, the only close that reads it. On the enemy phase: a coach nudge.
  A tip marks its `NOTE_HINT_IDS` only once read; with no DOM it shows and marks nothing.
- Gates: `gateSelect` and `gateMove` block free play (the scene asks `allowsSelect` /
  `allowsMoveTo`, and refuses with a nudge); `gateConfirm` only blocks weapon and target cycling
  on the open forecast and lifts when it closes. Skip step releases the gates for the chapter.
- The hooks, each a line or two at an existing site (`scene._prologue?.…`):
  - `onPhaseStart` from `onPhaseChange` (both phases); the first player phase raises
    `battleStart` at once and reveals the coach through the phase's guarded runner after the
    banner (1500 ms), so the gate is live from the first frame
  - `onUnitSelected` (end of `selectUnit`), `onAfterMove` (awaited in `afterMove`, before the
    action menu), `onForecastOpened` (awaited in `AttackFlowController.showForecast`, first open
    only), `onForecastClosed` (`hideForecast`)
  - `onCombatResolved` at both combat sites (the player's attack and the enemy's), awaited; it
    raises `combatResolved` for a player-started exchange and `hpBelow` when a player unit's HP
    changed
  - `beforeUnitActionCompletes` at the end of `finishUnitAction`: a `unitActed` note holds the
    action's completion (and so the turn's end) until it is read. With Edric alone the player
    phase ends as soon as he has acted, so P1's "Wait vs End Turn" note reads there.
  - `onLevelUp` after each card in `presentQueuedLevelUps`, `onHoldersWoke` from the AI's
    callback, `onUnitDefeated` from `removeUnit`
  - `onDefeatIntercept` in `checkBattleEnd`, before the lord-death prompt and `onDefeat`
  - `onVictory` from `PostCombatController` after the victory band
  - `onTalk` after the Talk card (`MovementActionController`; `talkLine(npc)` gives the
    authored recruit line), `onHealed` after a staff heal (`HealController`), `onRewound` after a
    Vision rewind lands (`VisionRewindController`; it also re-arms the rewind offer). `onSeize`
    from the Seize command, before the victory flow (P4).
  - **Teaching state rides the suspend checkpoint** (Phase 2B; code review of 1B/2A):
    `BattleSuspendController` stores `prologueState: snapshot()` (beats fired, the gate, the
    coach goal, the forecast count, the lesson ledgers, the rewind and Vision flags, and the
    unread teaching) and `finalizeResume` hands it to `onResume`, so Resume Battle (and a
    rotation's re-open) keeps the chapter where it was. `battleStart` belongs to turn 1 of a
    fresh battle only; a checkpoint without teaching state (older saves) resumes as a started
    chapter. An opening that holds the turn (lines, a note) outlasts the banner-timed coach
    reveal, which is guarded to an idle battle, so the opening's end reveals the coach.

  **Who owns the screen (the hook contract; review, 2026-10-04).** Every hook returns a
  task that settles once the beat's notes and lines are read (at once when nothing shows),
  and the scene awaits it through `safeBattlePresentation` at the site the beat belongs
  to, so a blocking sequence owns that interval of the simulation instead of racing it
  (Varro's fall used to launch his line and the seize note while combat and the enemy
  phase went on underneath; the overlay blocked input, not the simulation). The controller
  counts what it has on screen: a whole immediate sequence, from its first line to its
  last note, never a note waiting for a playable turn (those would deadlock the pipeline
  that makes the turn playable). The player turn-start pipeline awaits `idle()` before it
  reads the battle state, so a sequence that spans the turn start (a fall on the enemy
  phase, the line still open) delays the pipeline instead of defeating it (it used to
  find the note's `TUTORIAL_HINT` state, return, and the note then restored
  `TURN_START_RESOLVING` with nothing left to hand the turn over: a soft-lock).
  `tests/PrologueBeatOwnership.test.js` drives each case.

  | Hook | Awaited at | A note or line raised here |
  |---|---|---|
  | `onPhaseStart` (player) | `onPhaseChange`, before the banner | lines: block input only, the pipeline waits for `idle()`; notes wait for a playable turn (deferred), then block input |
  | `onPhaseStart` (enemy) | `onPhaseChange` | decorative: a coach nudge or band, never awaited, never pending |
  | `onUnitSelected` | end of `selectUnit` | blocks input only (nothing of the scene's runs until the player acts) |
  | `onAfterMove` | `afterMove`, before the action menu | blocks simulation |
  | `onForecastOpened` | `AttackFlowController.showForecast` | blocks simulation |
  | `onCombatResolved` | both combat sites, before the casualties leave | blocks simulation |
  | `beforeUnitActionCompletes` | `finishUnitAction` | blocks simulation (holds the action's completion and the turn's end) |
  | `onUnitDefeated` | `removeUnit`, after the death's objective update, before its side effects | blocks simulation (the combat that caused it and the enemy phase wait) |
  | `onLevelUp` | `presentQueuedLevelUps`, after the card | blocks simulation |
  | `onHoldersWoke` | the AI's callback | blocks simulation (the enemy phase waits) |
  | `onTalk`, `onHealed` | the Talk and Heal presentations, before the action completes | blocks simulation |
  | `onSeize` | the Seize command, before `onVictory` | blocks simulation |
  | `deployed` (raised by the controller's `create` from the deploy screen's confirmation, `scene._deployConfirmation`: reset in `BattleScene.init`, since Phaser reuses the scene object, and cleared once read) | `beginBattle`, before the first phase | its lesson mark is sync; a note here would wait for a playable turn. Never raised by an auto-deploy or a resume: P4's `deploy` is practised by the choice, not by `battleStart` |
  | `onRewound` | `VisionRewindController`, after the board is restored | blocks input only |
  | `onVictory` | `PostCombatController`, after the band | blocks simulation (the victory flow waits) |
  | gate nudges (`rejectSelect`, `rejectMove`, `rejectStep`) | input | decorative |

  **What survives suspend (`snapshot()` version 2; review, 2026-10-04).** A checkpoint
  used to record a beat as fired and its hints as taught the moment it matched, while
  its line was still open or its note still waiting for a playable turn (the P3 opening
  under the turn-start pipeline's checkpoint; P4's seize/par note scheduled before the
  first checkpoint): a reload resumed a chapter whose lesson was never seen, and the
  taught hint ids then suppressed the in-run explanation for good. Unread teaching is
  now data (`pending`: beat id, kind, note id and text, the event, status `scheduled`
  or `displayed`), and the replay semantics are decided per kind:

  | State | In the checkpoint | On resume |
  |---|---|---|
  | beats spent (`once`) | yes | never replayed |
  | the gate, the coach goal, gates skipped, the forecast count | yes | restored; the gate's ring redrawn |
  | the lesson ledger (`markLesson` shown / practised) | yes, marked when the beat matches | restored (a beat that fired counts as exposure; its note comes back below) |
  | taught hint ids (`NOTE_HINT_IDS`, the slot's `markSeen`) | only notes the player acknowledged (Continue, Leave, Open Rewind) and enemy-phase nudges | restored; a resumed note marks them when acknowledged |
  | the Vision grant | the run (`prologueVisionGranted`) or the standalone flag | idempotent, never twice |
  | the damage ledger (`damaged`: who damaged which foe, for `combatResolved.damagedBy`) | yes | restored; a version-1 checkpoint resumes with nobody damaged |
  | pending notes and line sets | yes, in order, with status | shown again as one sequence once the player can act: a line set replays whole (its seen-key is marked only when it completes), a note keeps the text it had; a note torn down unread (shutdown resolves it `false`) stays `displayed` |
  | highlights (a unit's ring, an enemy's reach) | no | the gate's ring only |
  | enemy-phase nudges | no (shown is read) | nothing |

  A deferred task (`defer`) settles with its result or, when cancelled by a restart, a
  rewind, a skip or destroy, with `false`; a cancelled task never runs, so it can never
  touch a replacement session, and the pending records it carried are dropped with it
  (a rewind forgets the notes of the turn it undid, as before).
  `tests/PrologueSuspendTeaching.test.js` covers the two reloads, acknowledgement and
  cancellation.
- **Prologue defeat (built for the standalone chapter).** The existing "Continue from Map"
  revert can't restart a battle: `VisionRewindController.showLordDeathPrompt` saves a
  `fatal_pending` checkpoint, and Accept Fate runs `onDefeat`, `failRun` and RunComplete, which
  counts a finished run and pays Valor and Supply (§8). So the commander's fall is intercepted in
  `checkBattleEnd` *before* the lord-death prompt and `onDefeat` (`onDefeatIntercept`):
  1. `commanderFall` last words don't play (`isScriptedBattle`).
  2. The battle state goes to `BATTLE_END` (the enemy phase stops) and the "Not this thread"
     lines play, speaker `???` (Sera's voice, unnamed), no portrait.
  3. The scene restarts (`restartScene`, same `battleParams`, the chapter's `roster` built
     again with `buildPrologueUnits`), so the chapter begins again from its start. No Vision is
     granted in P1 (the tutorial's lord-fall grant is gone).
  The run-mode restart is built (Phase 2A, below). A protected non-commander's fall is kept as
  `scene._prologueFallen` for the rewind prompt; the battle's commander fields
  (`_battleCommanderName`, `_fallenCommander`) are never overwritten by it.
- **The suppress predicate.** `engine/ScriptedBattle.js` `isScriptedBattle(battleParams)` is
  true for `battleParams.prologueChapter` and nothing else (the `tutorialMode` flag is gone).
  Every former `tutorialMode` reader (the Eclipse clock and atmosphere, Guidance, contextual
  hints, deeds and fallen records, formation and Back to Map, caravans and villages, story beats,
  the commander's last words, suspend checkpoints and combat/area-strike intents, the portrait
  re-open, the first-battle theme, locked spawn counts) reads it;
  `tests/ScriptedBattleSuppression.test.js` drives each one with P1's params and fails if any
  source file reads a `tutorialMode` of its own. The standalone chapter has no RunManager, so
  `_persistBattleRunState` returns `missing_run` and nothing reaches a slot; the controller
  never calls the registry's `HintManager` (a stale slot's manager would have written that
  slot's meta): new slots read the device-wide lesson keys instead.

### Engine gaps to close (small)

- ~~`addEnemyFromSpawn` honours an authored `weapon` (by name) and `skills`.~~ Done
  (`applySpawnLoadout`, above).
- ~~An authored lord `npcSpawn` (Sera) that doesn't go through `buildRecruitNodeUnit`'s
  roster-average level.~~ Done (`buildPrologueNpcUnit`).
- ~~Prologue route node titles.~~ Done: an authored node's `title` names it on the loom
  (`describeLoomNode`), and the loom header reads "Prologue · The Quarry Road"
  (`loomHeader`'s `act` / `title` overrides). The boss preview line: done (P4's
  `prologueBossLine`).
- ~~The Chapel's blessing service greyed in prologue mode.~~ Done (`churchBlessingBlock`).

### Title, slot, routing and meta (built, Phase 2A)

- **The routing table** is pure: `src/engine/PrologueRouting.js` (`routeForSlot(summary)` →
  `offer | resume | homeBase | fastPath`, `routeForBeginRun(meta)` → `fastPath | standard`;
  `tests/PrologueRouting.test.js`). `SlotManager.getSlotSummary` carries `prologue` (the
  meta's state, `none` for an old save). `isFirstRunSlot` looks only at the run counters, so
  it stays true after the prologue; routing reads `meta.prologue` as well:
  - `none` (or an old save): offer the prologue;
  - `in_progress`: Continue resumes it (`hasActiveRun`); with no run save left (the prologue
    never reached a battle) the offer again;
  - `complete`: Home Base; Begin Run takes the fast path while `runsStarted` and
    `runsCompleted` are 0, then the ordinary road;
  - `skipped`: today's fast path;
  - a slot that started or finished a run is never offered the prologue (Home Base).
- **The offer** (`PROLOGUE_OFFER` in `src/data/prologueContent.js`): "Begin the first thread?"
  with "Play the Prologue · about 30 minutes" (an estimate, "How long it takes" below) and
  "Skip to the first run". It comes from both
  entry points, `TitleScene.handleNewGame` (a MenuSurface; `start: 'prologue' | 'skip'`) and
  `SlotPickerScene.selectSlot` (a slot dialog). Playing it is the highlighted default on a
  device that has not finished the prologue (`emblem_rogue_tutorial_completed`); after that,
  Skip is. Without a DOM the offer is the skip.
- **The starts** (`src/utils/firstRunFastPath.js`): `startPrologueRun` builds the run
  (`RunManager.startPrologue`), clears the slot's stale run save and opens P1 at once (the
  route map is first drawn when P1 is won; `NodeMapScene._launchPrologueOpening` re-opens it
  the same way after a Continue from Map), then records `in_progress`;
  `skipPrologueToFirstRun` is today's fast path plus the `skipped` record. Nothing counts:
  `runsStarted` moves only with the first real run.
- **A fresh device's title item** "Prologue · Start here" starts the prologue run in a new slot.
  With saves, "Prologue" opens a menu (`TitleScene._showPrologueMenu`, copy
  `PROLOGUE_TITLE_MENU`): Continue the prologue (a slot whose run is the prologue's), Play the
  Prologue as a new save in the next free slot (New Game's prologue start, no offer; with
  every slot full it says so), then Replay a chapter, the chapter select (every chapter on
  the route, in order): a replay runs standalone with the authored roster at the chapter's expected levels
  (`buildPrologueRoster`; P2 brings Gaspar), with the title's `activeSlot`, `meta` and
  `hints` set aside in the registry (`prologueReplayStash`) and restored by the title on
  return; no grant, no meta write.
- **Home Base after the prologue:** the existing `homebase_intro` and `homebase_begin` notes,
  plus one line (`PROLOGUE_HOME_BASE_NOTE`, hint `homebase_prologue_grant`): "This is what
  stays between runs. Spend the Valor and Supply from the first thread." Begin Run goes through
  `HomeBaseScene.startRunFromHomeBase` (desktop button and `MobileHomeBase`), which reads
  `routeForBeginRun`.
- **The handoff** (review, 2026-10-04; `ui/PrologueHandoff.js`, copy
  `prologueHandoffContent`). The tutorial's protection ends at Home Base, and a first defeat
  is the worst place to learn its rules, so one screen says them before Home Base, in plain
  words, after the ending's last line and before the one meta write. Its title "From here, it
  counts", its kicker "Prologue complete" (after a skip: "The prologue ends"), the ending's
  title card as its lead, then five rules, a term beside one sentence each:

  | Term | Rule |
  |---|---|
  | Losing your commander | ends the run. Edric leads your first run. |
  | Fallen allies | stay down until a Church revives them for gold. |
  | Starts over | each run: a fresh army, with levels, items and gold reset. |
  | Stays | Valor and Supply you earn, and the Home Base upgrades they buy. |
  | Vision | charges last the whole run. Spend them on the turn that went wrong. |

  "To Home Base" (or Escape) continues; it never asks anything. It plays once with the ending
  (a retry after a failed write only commits and leaves; a refresh after the write lands in
  Home Base). Each rule fits one line of 90 characters (`tests/PrologueHandoff.test.js`).
- **The fast path's route-map note** has a prologue-player version
  (`PROLOGUE_FIRST_RUN_ROUTE_NOTE`): Home Base is already known, and it says the one rule the
  run now enforces: "Your first run begins here, and now it counts: if Edric falls, the run
  ends. Tap a node to preview; Travel commits."
- **Skip mid-way:** "Skip Prologue" in the pause menu (battle and route map; the coach's Skip
  and a field note's "Skip prologue" open the same confirmation) jumps to the ending
  (`src/ui/PrologueEnding.js`: the `prologue.ending` scenes, the title card, one meta write,
  the run save cleared), then Home Base with the grant. The prologue run has no Abandon Run.
  An exit asked for is honoured, never dropped (`PrologueController.requestLeave`): over an
  uncommitted forecast or target choice (the first forecast's note) the plan backs out to the
  action menu, the forecast closed unread and no attack made, and the confirmation opens;
  where it cannot open yet (the note before the turn passes to the enemy, the enemy phase)
  the coach says so and the request waits, opening the confirmation at the next point the
  player can act (`flushLeave`, before any deferred note). Nothing is committed or advanced
  to make room for it.
- **The ending** is reached from the last chapter's victory (after its authored loot) in
  `PostCombatController.transitionAfterBattle`, or from the route map after a reload
  (`NodeMapScene.checkActComplete`), and never RunComplete or a settlement.
- **The defeat intercept in the run:** any protected unit's fall (every unit of the chapter's
  roster, and the commander) is intercepted in `PrologueController.onUnitDefeated` /
  `onDefeatIntercept` before the lord-death prompt and `onDefeat`; the commander's last words
  stay suppressed. With an unspent Vision charge the rewind is offered first (the prompt says
  "Accepting fate restarts this chapter"); Accept Fate comes back through
  `PostCombatController.onDefeat`, which hands a prologue chapter to the intercept before
  anything is persisted. The restart (`RunManager.restartPrologueBattle`) reverts to the
  battle's entry snapshot even past a `fatal_pending` checkpoint (the standard run's
  `revertBattleInProgressToEntry` guard is untouched), clears the scene's fatal state, saves,
  and re-opens the node from its locked config.
- **Unreadable or fatal checkpoints in the prologue** (Phase 2B): the slot picker never offers
  Accept Fate for a prologue run; a `fatal_pending` checkpoint's Continue from Map restarts the
  chapter (`restartPrologueBattle`, saved, with Retry on a failed write), and
  `BattleScene._abandonUnrestorableResume` restarts it too, so neither path reaches `failRun`.
- **Failed skips and endings** (Phase 2B): a Skip whose save fails leaves the battle or the map
  playable (the leaving flag, the coach and `isTransitioning` restored) and offers a real Retry
  (`offerSkipRetry`); the ending's lines and card play once per scene (a retry after a failed
  meta write or transition only commits and leaves).

### Tests

- **Data:** the `validate:data` rules above.
- **Pure:**
  - the battle config builder (exact terrain indices from hand-written maps)
  - the node map shape
  - the beat matcher
  - the unit builders (Sera has a staff rank and Heal)
  - save round-trips of `mode`
- **Harness:**
  - For each chapter, the intended script wins with margin and a naive policy also wins.
  - P4 is won before the enrage turn with any deploy, after Rest or Scavenge (built:
    `tests/harness/PrologueP4.test.js` and `PrologueP4Scavenge.test.js`, the tables in §6 P4;
    Scavenge without a healer holds a lower floor, as recorded there), a reckless play and
    Gaspar alone still lose a share.
  - The P1 Fort is outside `b`'s Danger tiles (built, with the rest of P1's harness checks:
    `tests/harness/PrologueP1.test.js`).
  - P2: Gaspar's lance leaves the Archer at 2 HP and Edric's hit kills it.
  - P3: Edric reaches Sera on turn 1, and only the Soldier reaches her on enemy phase 1.
  - The Gaspar-only policy loses P2.
  - No enemy-phase sequence (hits and crits) kills Edric from where the intended script leaves
    him.
- **Persistence:**
  - Refresh mid-P1 and mid-P3 resumes the battle. Refresh at the watchtower keeps the vision
    spoken and the choice (made or open); refresh at P4's deploy screen returns to the map
    with the gate to travel to; mid-P4 resumes as left; a P4 fall restarts it at its deploy
    screen; the ending commits once.
  - Refresh on the route map resumes the map.
  - Every named unit's death restarts its chapter and never reaches RunComplete or settlement.
  - `runsStarted` and `runsCompleted` don't move.
  - The grant pays once, even across a refresh and a cloud sync, and a cloud merge never
    keeps the receipt without the currency (`PrologueGrantMerge`).
  - Sign-out never discards an unfinished prologue without asking (`LogoutLocalOnlySaves`).
  - A replay never touches the slot.
- **Flow:**
  - Skip equals today's fast path exactly.
  - A completed prologue routes to Home Base, then the fast path.
  - A completed prologue's lesson ids are read in the first run.
  - The suppress list holds (no `battle_par`, no Guidance note and no cold open in prologue mode).
- **e2e:** the `prologue` lane (`tests/e2e/lanes.json`; the ordinary-play specs are listed
  under "Ordinary play" below): `prologue-run.spec.js` (the offer,
  P1 as a run, the route, P2, the ending, Home Base, Begin Run's fast path; Skip; a refresh
  mid-P1 with Resume Battle and Continue from Map), `prologue-exit.spec.js` (Skip from the
  coach, the pause and a note; the restart in the run; the chapter select and a replay that
  never touches the slot), `prologue-lessons.spec.js` (P1's notes on a phone, in the run).
  Phase 2B extends `prologue-run.spec.js`: P2's win opens the fork (its note), Harrow's Market
  brings Tamsin in (the card, the bow-rack line, the join saved first), the roster lesson's
  Withdraw done with the real button, then P3 (Sera green, Edric moves beside her and Talks,
  her card and her acting goal), the ending after P3; the refresh-mid-P1 case teaches a step
  and checks Resume Battle brings the coach and the gate back as left.
  Phase 3 extends it: P3's win opens the watchtower (Sera's vision, Rest behind its
  confirmation), P4's preview names Varro, the deploy note and screen, Varro's lines over the
  empty field, the formation (Auto-place, Start battle), the seize/par note, Varro's fall
  (Edric's line, the note, the coach on the gate), a scripted seize, Varro's last words, the
  ending (its nine lines, the Hollow Sun's veil, THE THREAD IS CUT, the title card, nothing
  written before it is read), Home Base with the grant; a new case seeds a run before the gate
  and refreshes at the deploy screen and mid-battle. `prologue-exit.spec.js` reads the new
  ending after a P1 skip (Sera unnamed, the unmet left out) and replays the Quarry Gate from
  the chapter select.

**Built in Phase 2A** (unit): `RunManagerPrologueMode` (start, save round-trip, old saves,
joins, the restart), `MetaProgressionPrologue` (the record, the grant paid once across a
refresh and a cloud merge, the counters), `PrologueRouting`, `PrologueEnding`,
`ScriptedBattleSuppression` (every reader in both modes, no private flag),
`PrologueController` (both modes), `firstRunFastPath` (the two starts),
`TitleSceneNewGameFlow` (the offer, the chapter select, the replay stash),
`NarrativeDirector` (the `prologue` key). Harness: `tests/harness/PrologueP2.test.js`.

**Built in Phase 2B** (unit): `PrologueRow2P3` (the fork's nodes, the Market's stock, P3's
replay roster and Sera, the new conditions, P3's beats in order), `PrologueValidator` (the new
rules), `PrologueRosterLesson` (the ledger: every step, any order, auto-complete and auto-skip,
the robust trade, persistence), `PrologueRosterCoach` (the strip in the roster sheet: each step
on the real button, Skip step / Skip lesson, once, the desktop entry), `PrologueArrival`,
`ShopControllerPrologue`, `ChurchVow` (the greyed altar, no Kindle, revival), `LoomModel` (the
preview), `Guidance` (the reasons in a chapter), `PrologueControllerP3` (Talk, protection, the
notes, the Vision grant, the rewind exercise, resume, failed skips),
`BattleSuspendController` (teaching state in the checkpoint), `SlotPickerContinueRouting` and
`BattleResumeFailureRevert` (the prologue's fatal and unrestorable resumes),
`NodeMapPrologueSkip`, `PrologueEnding` (the ending once), `RunManagerPrologueMode` (the fork,
arrivals, the Vision grant, `failRun` refused, the restart's exact restoration),
`ScriptedBattleSuppression` (a standard-battle control row). Harness:
`tests/harness/PrologueP3.test.js` (P2's policies moved to `tests/harness/prologueP2Policies.js`
so P3 starts from P2's real end states).

**Built in Phase 3** (unit): `PrologueValidator` (deploy, formation, `rosterEquip`, the boss
field by field, the ruins stock and lines, the ending's scenes, `targetTerrain`),
`RunManagerPrologueMode` (the route through the gate, P4's victory ends the prologue, the
watchtower and the gate across a refresh), `PrologueArrival` (the vision once, saved first),
`PrologueControllerP4` (the opening's coach and par note, the throne note once and only on the
throne, Varro's fall, the seize ledger, protection and the restart to the deploy screen, the
boss line, the epithet fallback, the music fallback), `PrologueEnding` (the scenes in order,
the cues, the shake and Reduce motion, the veils, the army-aware lines after a skip, a scene
leaving mid-ending), `CloudSync` (the prologue record merged), `HomeBaseLostPrologue` (the
lost-save offer), `PrologueRouting`, `TitleKeyArt` and `SlotCardModel` (the prologue run's
labels), `NarrativeScaffold` (Gaspar's intro only skipped in the first real run),
`GuidanceFollowThrough` and `GuidanceFirstChurch` (§7's notes: once, the right state, never
scripted, Guidance Off). Harness: `tests/harness/PrologueP4.test.js` and
`PrologueP4Scavenge.test.js` (P3's policies moved to `tests/harness/prologueP3Policies.js`;
P4's are `prologueP4Policies.js`).

**Design review, 2026-10-04** (unit): `PrologueDensity` (the core notes per chapter, at their
decision points; the tips conditional; the cut copy gone; each demoted hint's Act 1 teacher;
forecast tips one line), `PrologueController` / `PrologueControllerP3` / `PrologueControllerP4`
(a tip never holds the move, the forecast or the fall; marks its hint only once read; a
forecast tip read only on Confirm or Cancel; a scoped tip steps aside unread),
`PrologueBeatOwnership` (the hook contract pinned on a blocking fixture; the shipped fall
settles on Varro's line alone), `PrologueSuspendTeaching` (a tip is never pending),
`PrologueRosterLesson` / `PrologueRosterCoach` (the core of two, the offer, Done, nothing to
offer), `PrologueDeparture` (asks when unarmed, not when armed, both route paths, once per
attempt, never blocks), `PrologueEnding` (PROLOGUE COMPLETE only after a win, THE THREAD
BREAKS, the handoff once), `PrologueHandoff` (the five rules, plain and short), `PrologueValidator`
(`tip`, the ending's `card` and `won`). Browser: the `prologue` lane reads the tips, the forecast's
triangle line, the departure's choice, the roster lesson's "1 of 2", the seize tip, PROLOGUE
COMPLETE, THE THREAD BREAKS and the handoff.

**Review fixes, 2026-10-04** (each with a test that fails before it): `RoutObjective` and
`PrologueRequiredRecruit` (P3 cannot end without Sera: the predicate the scene and the
harness share, the headless regression, the coach's goal, the validator's rules;
`BattleSceneActionErrorRecovery` holds a standard run's Talk away from `checkBattleEnd`),
`PrologueBeatOwnership` (the hook contract: Varro's fall as a task, `removeUnit` awaiting
it, the turn-start pipeline under an open line or note), `PrologueSuspendTeaching` (unread
teaching as data across a reload, hints marked on acknowledgement, cancelled deferred tasks
settled), `PrologueLessonPredicates` (the chip-then-finish ledger by attack and by counter,
across a checkpoint; range two at a committed distance of 2; deploy from the confirmation)
with `PrologueRosterLesson` performing the real Withdraw and Equip, `PrologueEnding` (the
grant under faults: a refused lesson record, a throwing meta write, a throwing transition
after the payment, a crash before the save cleared, two attempts at once). Browser: the
`prologue` lane routs P3's Soldiers before the Talk and lets the join win, and lets Varro
fall to Gaspar's counter on the enemy phase (in `prologue-run.spec.js` by setting the
board up; through ordinary play since the review below).

**Ordinary play (review, 2026-10-05).** `prologue-run.spec.js` stays the fast flow test
(it calls `onVictory()` and sets Varro's HP to reach each screen). Beside it, the lane
plays the thread the way a player does: nothing calls `onVictory`, `removeUnit`,
`completeBattle` or a setter. `tests/e2e/prologueDriver.js` clicks or taps board tiles
(after the camera brings them into view; a docked tip over a tile is read first, anything
else covering the board fails), works the desktop's canvas action menu by keyboard and the
phone's rail by taps, confirms or cancels the forecast (the tile, Esc, or the phone's
buttons; ◀ ▶ choose its weapon), and reads past notes, lines, cards and level-ups while it
waits on state, logging each so a spec can count what was taught; a small planner reads the
live board (blue range, forecasts, Danger) to choose each unit's move.
`tests/e2e/prologueJourney.js` plays each chapter on top of it. Specs:
`prologue-journey-market.spec.js` (New Game's offer to Home Base: P1, P2 the lesson's way,
the reward card, the Market's roster lesson Withdraw and Equip, P3 Talk first, the
watchtower's Rest, P4's deploy and formation, Varro felled by the player's own strike, the
Seize from Edric's action menu, the ending once, the grant, a refresh paying nothing twice);
`prologue-journey-chapel.spec.js` (the wrong way round: P1's wrong tiles and a forecast
cancelled three times, P2 with Gaspar taking every kill (completes, `veteran_kills` never
practised), the Chapel, Withdraw skipped and the lesson dropped, the departure's Continue
anyway, Tamsin's greyed "Unarmed" Attack, the rout before the Talk (the battle playable,
the objective and the coach on Sera), the Talk from her far side winning it, Scavenge, P4
without Tamsin and Varro to Gaspar's counter on the enemy phase, the next turn playable,
the Seize, Home Base); `prologue-falls.spec.js` (Gaspar falls on P2's enemy phase: "Not this
thread", P2 from its entry; in P3 the chapter's Vision charge offers the rewind first,
Rewind spends it, the next fall restarts P3 with the grant reverted);
`prologue-resume.spec.js` (refreshes at P2's reward screen (Return to rewards, paid once),
on P3's opening note, after Sera's join, on the turn the Vision charge is granted, and on
P4's seize/par note: each unread note back once, nothing taught or paid twice);
`prologue-skip.spec.js` (Skip on P1's first forecast note backs out with no attack made and
opens the confirmation; Skip on the note before the enemy-phase handoff opens it at the next
player turn; P2's pause and the fork's route-map pause skip to the ending and Home Base with
the grant once; a replay's Leave on the same note). `portrait-prologue.spec.js` (the
`portrait` lane, with every upright spec): P1 by taps on the turned board, P2, the fork and
its roster lesson on a phone. Found and fixed on the way: Skip on a note over a forecast or
before the handoff was dropped with "You can leave once your turn is back"
(`PrologueController.requestLeave` now backs out of the uncommitted forecast, or queues the
exit until the player can act); a fall's offer read "A vision fractures!" with Sera on the
field before the roster took her in (`VisionRewindController`); on an upright phone the coach
docked over the board hid a whole row that no pan could bring out (the battle camera now
takes the coach's strip as covered: `BattleCameraController` `getInsets`,
`PrologueController.coveredInsets`; `portrait-prologue.spec.js` checks every tile can be
brought clear and tapped).

### Novice playtest (the measure that matters)

From the research doc: can a novice make a safe decision in a new position once guidance fades?
Watch for these:
- whether they cancel a forecast and say what damage and retaliation mean
- whether they check reach before exposing Sera or ending the turn
- whether they heal without directions and tell staff charges from consumables
- whether they finish P4 unprompted and recognise seize as the goal
- whether lessons stay readable at 640×480 and on touch

Record wrong commitments, help requests, repeated explanations and successful reuse. Completion
time is secondary.

**The metrics to collect** (review, 2026-10-04), per player and per chapter:
- time to the first meaningful action (P1's first committed attack, from Play the Prologue)
- time spent in mandatory explanations (blocking notes, lines, the handoff: open to dismissed)
- chapter retries ("Not this thread" restarts) and Vision rewinds
- mistaken cancellations (a forecast or move backed out of, then the same order given again)
- tips read (Got it, or on screen long enough) against tips shown
- total time, and time per chapter
- comprehension after Home Base, asked in the player's words: what ends a run, what happens
  to a fallen ally, what starts over, what stays, how long Vision lasts (the handoff's five)

**How long it takes: a hypothesis, not a promise.** The offer says "about 30 minutes". The
estimate (2026-10-04) is built from the harness's own counts, not from people:

| Chapter | Turns (median, naive and intended) | Unit actions |
|---|---|---|
| P1 | 3 | 3 |
| P2 | 4 | 7–8 |
| P3 | 3 | 10–11 |
| P4 | 4 (replay army, Edric+Gaspar+Sera) | 10 |
| Total | 14 | about 31 |

At 25–40 seconds an action for a player new to the genre (select, read the blue range, move,
open and read a forecast, confirm, watch the exchange): 13–21 minutes; the enemy phases 3; about
37 spoken lines at 4 seconds: 2.5; the 9 blocking notes, the fork's note and the deploy note:
2–3; the route map, the service, the roster lesson, the watchtower, deploy and formation: 5–6;
level-up cards, recruit cards, the boss card and rewards: 2.5; the ending and the handoff: 2.
That is 30–38 minutes for a first-timer (20–25 for a player who knows the genre, at 10–15
seconds an action), so the offer's earlier "about 20 minutes" was the experienced figure.
Before the density pass, the 29 blocking notes alone added about 4 minutes. The playtest's
total time per player decides the copy: if the median first-timer lands outside 25–35
minutes, change it.

## 10. Narrative wiring

- The first-run cold open (`actTransitions.runStart`, the `maxRunsStarted: 1` variant: the
  robed mages, the crowned man, the sleeper) moves into the watchtower and ending scenes
  (built: `watchtower_vision`; skippers keep the cold open).
- **A new NarrativeDirector `when` key,** `prologue: 'none' | 'complete' | 'skipped'`, added to
  `KNOWN_WHEN_KEYS` (the contract tests check that set). It lets the first real run open on a
  post-loop line:
  - Sera: "I came straight to you this time. I know this road now. It ended once."
  - Edric: "Then we walk it again. Everyone count off."
- **Variant order matters.** The first matching variant wins, and the existing cold-open variant
  (`{maxRunsStarted: 1, lastRunResult: 'none'}`) also matches the first run after the prologue.
  So the `prologue: 'complete'` variant comes first, and the cold open gains
  `prologue: 'none' | 'skipped'`.
- Skippers keep today's cold open.
- Gaspar's run-start intro line is skipped only in the first real run after a prologue that
  introduced him (`firstRunAfterPrologue`: the run being played counts, as the cold open's
  `maxRunsStarted: 1` reads it); every later run introduces him as before.

**The ending as built (Phase 3; the win said first, review 2026-10-04).** `ui/PrologueEnding.js`
plays `prologue.ending.scenes` with existing tools only: the music crossfades to
`music_explore_deep` (the Entity's road: the route map before the final boss, the thing the
ritual wakes); scene 0 (`won: true`: only when P4 was won, never after a skip): the `sealed`
cue and the gold run-end card PROLOGUE COMPLETE ("The Quarry Gate is held", "4 chapters won";
`card: 'complete'`, `prologueCompleteCard`, held over its lines for its reading window, then
gone), Gaspar ("The gate is yours, Edric. Well fought."), Edric ("Everyone is still standing.
I counted twice."), Tamsin; scene 1 ("the ritual seen far off in the east"): the `eclipse`
cue, a camera shake (none under Reduce motion), the `hollow_sun` veil (CSS: the sky darkens
from the east around a sun gone dark, ringed in pale fire; `CeremonyController.showVeil`),
Gaspar, Sera, Tamsin, Edric, Sera; scene 2: the pale man on the far ridge (Gaspar, Sera);
scene 3: the `rewind` cue and the run-end card in the prologue's words, never the game
over's: THE THREAD BREAKS, "The gate held. The world did not.", "Prologue complete · Sera
weaves again" (after a skip: "The world did not hold", "Prologue · Sera weaves again";
`prologueThreadCard`), Edric, then Sera: "No sword could stop this from here, Edric. It was
never yours to stop." and "Not like this. I know this road now. Again, from the morning I
reached you." Then the handoff (§9) led by the title card ("… This one broke in the east, not
by your hand."), the one meta write, Home Base. The player won; the world broke for the
story's reasons, and every piece of the ending says so. A skip plays the ending before the
army met everyone: a cast member not in the army never speaks or is named, and Sera's lines
marked `unmet: "???"` are a voice not yet met (`endingLinesFor`).

## 11. Phases

| Phase | Scope | Notes |
|---|---|---|
| 0 (this branch) | First Light: no villages in Act 1 rows 0–2. Gaspar's `guide_veteran_kills` note and help line. This spec. | Shipped |
| 0b (optional, small) | Interim Sera fix in the current tutorial: a Sera-specific coach goal ("Sera strikes from 2 tiles, where melee can't hit back, and heals with her staff. Keep her behind Edric.") | Throwaway once P3 ships |
| 1 | Data format and validator, `Prologue.js`, spawn weapon overrides, authored units, `PrologueController`, the defeat intercept. P1 playable from the title as the practice battle, replacing the tutorial. | Shipped 2026-10-04. `TutorialController`, `TutorialHelpers`, the tutorial coach model, lessons and forecast layout deleted; e2e `prologue-exit` / `prologue-lessons` (desktop and phone) and the portrait prologue tests replace the tutorial specs. Deviations: `talk`/`seize` hooks wait for P3/P4; the `practised` ledger is kept on the controller, not on slot meta (no slot in a standalone chapter); the enemy-phase note is a nudge, not a modal. |
| 2A | Run mode and routing, the suppress list in both modes, the literal route map, P2, the ending stub, Home Base handoff and grant, skip and replay flows. | Shipped 2026-10-04. The slice: fresh slot → (Prologue \| Skip) → P1 (row 0, map hidden) → Gaspar joins → route map → P2 → **temporary (until 2B):** P2's victory completes the prologue → ending stub (data: `prologue.ending`) → Home Base (grant) → Begin Run → the fast path. Later phases insert row 2, P3, the Ruins and P4 by adding data. Deviations: P2 as built above (one Fighter, the Soldier on Plain, the Archer on the west bank); the title's "Prologue · Start here" on a fresh device starts the prologue run rather than a standalone P1; a standalone replay ends with "Back to title" only (the Start First Run handoff is gone: New Game owns the offer); the `practised` ledger lands on slot meta at each chapter's victory in the run (`recordPrologueChapter` / `recordProloguePractised`); the ending is a four-line unnamed sequence plus the title card, not yet the ritual scene. |
| 2B | Row 2 (fork, Tamsin, roster lesson), P3 | Shipped 2026-10-04. The slice now runs P1 → Gaspar → P2 → the fork (Market \| Chapel; Tamsin joins at either) → P3 (Sera) → the ending → Home Base; P3's victory completes the prologue until Phase 3 adds the Ruins and P4. The title's chapter select lists P3 (replay roster: Edric L3, Gaspar, Tamsin with her bow). Deviations: P3 as built above (three Soldiers, not Fighters; two far, one holding; 12 × 5; the rewind exercise on player turn 2); the roster lesson's Equip step practises on another unit's spare (Withdraw already arms an unarmed unit), its Trade step gives the commander's first consumable and skips itself with a reason when nobody carries one, and every step completes in any order; Tamsin's lines as authored (`tamsin_joins`, `tamsin_joins_bow_rack`); the fork note is a once-per-slot route-map note. Review fixes (Phases 1B/2A), each with a test that fails before it: teaching state rides the suspend checkpoint and `battleStart` never replays; a prologue `fatal_pending` or unrestorable resume restarts the chapter (never `failRun`, which now refuses in the prologue); a successful rewind re-arms the rewind offer; a protected fall never renames the commander; a failed Skip leaves the battle or map playable with a real Retry; the ending plays once across retries; the restart test restores real state exactly; the suppression table has a standard-battle control. Found by the browser run: the coach stayed hidden after an opening that held the turn (fixed). |
| 3 | Ruins, P4, the ritual ending scene. First-visit notes for whichever of Shop and Church the player skipped; the Act 1 point-of-use notes in §7. | Shipped 2026-10-04: the story is complete. The run is P1 → P2 → the fork → P3 → the Old Watchtower (§6 row 4) → P4 (§6 P4) → the ending (§10) → Home Base; the chapter select lists P4 (replay: the four-unit roster, Gaspar on his sword). The follow-through notes as §7. Leftovers fixed: the cloud fetch merges `meta.prologue` (`mergePrologueState`); the title and slot cards say "Resume · Prologue" / "Continue prologue" for the prologue's run, and New Game is never "Start First Run" while the build ships the prologue (it opens the offer, Skip first on a device that finished it); a prologue run save that cannot be read (state left `in_progress`) gets the offer again at Begin Run (Restart the Prologue from P1, Skip to the first run without the grant, or Back), never the ordinary road; Gaspar's intro is skipped only in the first real run after the prologue. Deviations: Varro at level 1 (§6 P4); P4 retuned so every deploy wins (§6 P4, "Retune for every deploy"); the deploy note's sword against axes and the replay's `rosterEquip`; Sera's line at Varro's fall is Edric's; the throne lesson's trigger is a forecast condition (`targetTerrain`); escape maps get no objective-change note (their exits never open mid-battle); the ending's lines adapt to a skip (above). |
| 4 | Polish: prologue music picks (existing tracks, then optional cues), the ritual scene staging, copy pass against the lore guide | Open. Done in the review of 2026-10-04: the density pass (§2: each chapter's core blocks, the rest are tips; cut notes left to Act 1), the roster lesson's core and its offer of more, the unarmed departure's choice, PROLOGUE COMPLETE and THE THREAD BREAKS, the handoff, "about 30 minutes" as a hypothesis with the metrics to collect (§9). |

## 12. Decisions (user, 2026-10-04)

1. **Loop, not carry-over** (§3).
2. **The prologue is the default.** Every fresh slot offers it, highlighted. It is never forced,
   and it can be skipped at the start or mid-way.
3. **The Home Base grant is small:** one cheap upgrade of each currency. Lord upgrades start
   at 50 Valor and recruit upgrades at 35 Supply, so the grant is 50 Valor and 35 Supply (it was
   60 and 40 until the owner's retune of 2026-10-07, which also lowered First Light's run earnings).
4. **The row-2 fork stays** (Market or Chapel). It is the prologue's only real route choice, and
   whichever service the player skips gets a first-visit note in Act 1.
5. **Tamsin keeps her name** as a faint loop echo, unless the user asks otherwise.
6. **Tamsin is the fourth unit** for the deploy lesson.
