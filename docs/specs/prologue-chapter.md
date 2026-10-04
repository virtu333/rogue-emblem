# Prologue: The First Thread — design

Status: Proposed (design only, nothing built). Loop ending approved by the user, 2026-10-04.
Date: 2026-10-04
Replaces: the practice tutorial battle (`TutorialController`, `TutorialHelpers`) once the
prologue reaches parity. `docs/tutorial-battle-spec.md` is already stale; the shipped tutorial
is described in `docs/specs/tutorial_v2_guided_flow_spec.md` and `docs/onboarding-review-2026-09-20.md`.
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
6. **Short, skippable, replayable.** About 20–25 minutes. Each battle is won in 4–7 turns.
   A fresh slot offers Prologue or Skip, and any chapter can be replayed from the title.

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
Fresh slot ─ New Game ─┬─ Play the Prologue (highlighted, "about 20 minutes")
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
7. *The ritual, seen from far off.* The sacred ground lies east, in the fens (Act 3 country), so
   the catastrophe is not at the quarry. From the gate the army sees it: the ground shudders, the
   sun goes hollow, and a light rises in the east where something under the consecrated stones
   turns over. A pale man watches from the far ridge (the Lieutenant, unnamed). The shock reaches
   the Marches and the land comes apart. Sera grabs the thread: "Not like this. I know this road
   now. Again, from the morning I reached you."
8. *Home Base.* Title text: "Every run is a thread Sera weaves. When one breaks, she weaves
   again. Your army starts over. What you build at Home Base stays."

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

Map sketches are proposals. The legend is `.` Plain, `F` Forest, `T` Fort, `~` Water,
`=` Bridge, `V` Village, `G` Throne (the gate), `#` Wall, `E` player start, and lowercase
letters are enemies.

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
E . . T a . . .
. . . . . F . .
. . F . . . F .
. . . . . F . b
```

- **Roster:** Edric L1, Iron Sword, 1 Vulnerary.
- **Enemies:** Fighter `a` (L1, Iron Axe), next to the Fort. Fighter `b` (L1, Iron Axe, `hold`,
  `holdPack: 0`, `holdPackSize: 1`) in the far corner, behind Forest.
- **Placement rule:** the Fort is outside `b`'s Danger tiles (move 4 plus range 1, by path cost),
  so `b` stays asleep until Edric walks toward it. The first draft put the Fort 3 moves from `b`,
  which woke it on turn 1 and made both Fighters attack at once (code review, 2026-10-04).
- **Objective:** Rout. No reinforcements and no fog.
- **Verified numbers:** Edric's sword against a Fighter is 8 per hit (triangle advantage), and he
  doubles (AS 6 vs 0): 16 a round against 22 HP. A Fighter hits Edric for 9 at 56% on Plain, or
  7 at 36% on the Fort.

The intended turn 1: Edric moves onto the Fort and attacks `a` from it (the first forecast), and
`a` is left on 6. On the enemy phase `a` attacks and Edric's counter kills it. That shows a
counter is not just something enemies do.

| # | Trigger | Lesson (coach goal / note) |
|---|---|---|
| 1 | Battle start | Coach "Select Edric". Blue units are yours, red are the empire's. |
| 2 | Edric selected | "Move onto the Fort." Cover lowers damage and raises avoid. *Gate* (as today). |
| 3 | On the Fort | Terrain note (existing `battle_terrain`, after the panel refreshes). |
| 4 | First forecast (against `a`) | **One concept: reading a forecast** (`battle_forecast`). Damage per hit, Hit chance, and whether the enemy strikes back. Confirm commits; Cancel goes back. *Gate:* the first confirm. |
| 5 | Edric has acted, turn 1 | **Wait vs End Turn:** "Wait ends Edric's move. End Turn hands every enemy its move. Check who can reach Edric first." `a`'s red reach is shown; `b`'s doesn't reach the Fort. |
| 6 | First enemy phase | "Red units move now. Edric strikes back when attacked, too." |
| 7 | Level-up | The level-up card, with one line: "Levels raise stats at random. Growth rates decide the odds." |
| 8 | Edric walks into `b`'s reach | "Some enemies hold until you come close. Their red reach shows where." `b` wakes. |
| 9 | Second forecast (against `b`) | **One concept: the triangle** (`battle_triangle`, conditional as today). "Swords beat axes. The forecast already includes it." |
| 10 | Edric ≤ 60% HP | "Item → Vulnerary heals 10. You carry few, and they never come back." (existing consumable copy) |
| 11 | Victory | Gaspar rides in (dialogue). |

**Reuse:** the fight with `b` is unprompted beyond its two notes. The player picks the tile and
reads the forecast unaided. Doubling (the ×2 on Edric's forecasts) is explained in P2, where a
weapon choice changes it, so no P1 forecast carries two concepts (the shipped one-concept rule,
`tutorialLessons.js`).

**Safety:** the harness confirms that no run of Fighter hits and crits kills Edric within two
enemy phases from the Fort, or from the tile the naive policy leaves him on.

### P2 — Old Hands (Edric + Gaspar): the Jagen lesson

Story: an imperial outrider squad at the ford, with a village the squad hasn't reached.

```
. . F . . ~ . . . F
E . . . . ~ . a . .
. . V . . = . . c .
E . . . F ~ . b . .
. . F . . ~ . . . .
. . . . . ~ F . . T
```
(Soldier `d` stands on the Fort at the bottom right.)

- **Roster:** Edric (carries his P1 level), and Gaspar: the standard special character (Steel
  Lance and Iron Sword, Measured Step, Aegis). His data is unchanged.
- **Enemies:** Archer `a` (L1, Iron Bow); Fighters `b` and `c` (L1, Iron Axe); Soldier `d` (L2,
  Iron Lance, `guard` on the Fort).
- **Village:** an authored `villageTile` (painting `V` terrain alone is not a visitable village).
  It's uncontested: no bandit squad (§8). The visit reward is a fixed Iron Bow, delivered to the
  convoy as village rewards always are. It sets up row 2.
- **Loot:** an authored offer, not a random draw: an Iron Lance, a Vulnerary, or gold. The Store
  step at row 2 needs a weapon to exist.
- **Objective:** Rout.

**The Jagen beat** (verified):
- Gaspar's Steel Lance against the Archer: 16 of 18 HP, one strike (AS 4 against the Archer's 3
  is no double), and no counter at range 1. The Archer is left on 2.
- Edric finishes it from an adjacent tile: 8, no counter.
- Gaspar's Iron Sword against the same Archer: 12 ×2 (AS 9 doubles), a kill. So the forecast
  shows the choice: **the lance chips, the sword kills.**
- The note is the in-run `guide_veteran_kills` (this branch): "Gaspar is strong now but barely
  grows and earns little XP. Weaken enemies with Gaspar, then leave the final blow to Edric and
  your recruits: they grow from it." Showing it here marks it read.
- The XP numbers make the point. Gaspar counts as promoted (effective level +12), so a kill
  earns him the minimum `XP_MIN`, while the same kill earns Edric about 40.
- The bridge is one tile wide, so Edric may need two turns to reach the Archer. Whether the
  chip-then-finish lands on one turn depends on where the AI walks it, and the harness pins
  that.

| # | Trigger | Lesson |
|---|---|---|
| 1 | Battle start | Gaspar's intro line. |
| 2 | Gaspar selected | The Jagen note (above). Gaspar rides 6 tiles; Measured Step lets him keep moving after a non-combat action. |
| 3 | Gaspar targets the Archer | **Weapon choice and doubling** (`battle_doubling`, one concept: strike count). The lance reads 16 ×1, the sword 12 ×2. "Attack speed decides a second strike, and heavy weapons slow you. Switch weapons and watch the ×2." (A playtester made the same call with Iron 8×2 against Steel 11×1.) |
| 4 | Adjacent to the Archer | `battle_no_counter`: bows reach two tiles only. |
| 5 | First forecast under 100 Hit after that | **Forecasts are possibilities.** "Hit is a chance, not a promise. Pick a plan that still holds if this misses. A counter only comes if the defender survives." (Playtests: a 91-Hit attack missed, and a displayed counter never came because the enemy died first.) |
| 6 | Edric selected while the Soldier is in reach | The triangle against Edric: "Lances beat swords. Let Gaspar take the Soldier." |
| 7 | Turn 2 | Danger (existing `battle_danger_zone`). |
| 8 | A unit ends on the village | Visit: gold, and an Iron Bow sent to the convoy (existing village copy, minus the bandit clause). |
| 9 | Victory | **Loot screen**, first time (existing `battle_loot`, rewritten for the prologue). |

**Reuse:** the guarded Soldier on the Fort is the unprompted check. Edric's sword is at a
disadvantage, so the player has to apply the P2 pattern unaided: Gaspar softens, Edric
finishes, and no Jagen note fires again.

**Gaspar doesn't solve the map.** Sending Gaspar over the bridge alone should lose him: two
Fighters hit him for 10 at 75% each, and the Archer for 4, against 18 HP. Losing him restarts
the chapter. The harness checks that a Gaspar-only policy fails.

### Route map, row 2 — Harrow's Crossing (Market | Chapel)

The route map first appears after P1. Here it shows its first real choice, and node preview is
the lesson: "Tap a node to see what it holds. Travel commits; you can't come back."

- **The fork** (teaches the choice): *Harrow's Market* (Shop) or *Harrow's Chapel* (Church: heal
  all, the revive price list, and the blessing service shown but greyed for the prologue). The
  other service is taught at its first Act 1 visit (new first-visit notes; §11, phase 3).
- **Tamsin joins on arrival, at either node.** This uses the standard recruit card. She is an
  authored Archer at L1, and **her bow burned with her watch post**: she arrives unarmed. This is
  Awakening's missing-axe trick. The roster has a concrete problem to solve, instead of a menu
  tour. The cause and the remedy show together, so she never looks broken: her join line says
  so, and her roster row reads "No weapon. A bow is in the convoy." If P2's village wasn't
  visited, the bow waits at the node (her line: "There's a bow on the rack here. It'll do.").
- **The roster lesson** runs once, the first time the player opens Roster after Tamsin joins.
  Each step is a goal the player does:
  1. *Withdraw:* give Tamsin the Iron Bow from the convoy. "The convoy is shared storage. Units
     fight only with what they carry." This wires up the dead `guide_convoy` copy.
  2. *Equip:* equip it. "Each unit carries up to 5 weapons. The equipped one is the one they
     fight with."
  3. *Trade:* give Tamsin Edric's Vulnerary (from his P1 kit; a carried item, so this is a Trade,
     not a Withdraw). "Trade swaps carried items between units. You can also trade in battle,
     with an adjacent ally."
  4. *Store:* put P2's loot weapon in the convoy, or any spare. "Store puts a carried item in
     the convoy. Withdraw hands it back." A playtester reported not understanding either word
     (threat-and-onboarding §2), so the prologue has the player do both.
  Each step can be skipped. Travel is never blocked, but an unarmed unit gets the standard
  greyed-Attack reason ("Unarmed") in P3, so the problem stays legible.
- **Market branch:** buy a Vulnerary with P2's gold. "This market's stock is fixed while you're
  here. Every shop node stocks its own. Gold also pays for revivals and promotions."

### P3 — The Seer on the Road (Sera's chapter)

Story: Sera runs down the road with soldiers behind her.

```
. . . F . . . . . F
E . . . . . . . . a
E . F . S s . . b .
E . . F F . . . . .
. . . T . . . F . c
```
(`S` = Sera, green; `s` = Soldier, next to her)

- **Roster:** Edric, Gaspar, Tamsin. They enter with whatever HP P2 and the row-2 choice left
  them. There are no scripted wounds; the first draft's scripted wounds clashed with the Chapel's
  free heal (code review, 2026-10-04).
- **Fixed spawns, no formation.** `playerSpawns` holds exactly the three units, so formation
  placement (which opens at 3 units) doesn't run. That keeps Edric's turn-1 reach to Sera
  authored. Formation is first taught in P4.
- **Sera:**
  - Turn-1 reach: she stands where Edric can reach a tile next to her on turn 1. The harness
    asserts this; the first draft needed 5 or more move-cost (code review, 2026-10-04).
  - Kit: built like the run's starting Sera (`_buildStartingLord`): Light (P) plus Staff (P),
    Glimmer (Light, 4 might, range 1–2), Heal (3 uses), a Vulnerary, and Renewal Aura.
    `createLordUnit` alone gives her no staff rank (code review, 2026-10-04).
  - She joins by Talk (lords only; a lord NPC joins through `lordRecruitLines` and acts right
    away).
- **Enemies:** Soldier `s` (L1, Iron Lance), the only enemy that can reach Sera on enemy phase 1.
  One hit is 9, against her 18 HP. Fighters `a`, `b` and `c` (L1, Iron Axe, melee only) start
  outside her reach for turn 1. Enemies do attack NPCs, so the placement is what protects her.
- **Objective:** Rout. Sera falling at any point, green or blue, restarts the chapter.

**Sera's lessons, the gap this spec exists to close.** Each one is a beat, not a footnote:

| # | Trigger | Lesson |
|---|---|---|
| 1 | Battle start | "Sera is the green unit. Move Edric next to her and choose Talk." (`guide_recruit_on_map` copy; lords only.) |
| 2 | Sera joins | Sera's line, then the coach: "Sera acts right away." |
| 3 | Sera selected, an ally hurt | **Heal:** "Sera heals with her staff: move next to {ally}, choose Heal. Staff uses refill every battle." Fires on turn 1 if someone came in hurt, otherwise after enemy phase 1. |
| 4 | Sera moved where no foe is in range | **Planning and cancelling.** Playtests show players concluded Sera couldn't attack because Attack vanished without a target. Her menu shows the greyed "Attack · No target in range 1–2". Coach: "Nothing in reach from here. Back undoes the move. Nothing is final until you confirm." Then: "Try a tile 2 away from a Fighter." |
| 5 | Sera 2 tiles from a Fighter | **Range:** "Glimmer reaches 2 tiles. From 2 tiles away, an axe or a lance can't hit back." The forecast shows "No counter". Coach: "Open the forecast, then Cancel. Looking is free." |
| 6 | Glimmer forecast | **Magic:** "Glimmer is magic: it hits RES, not DEF. Axe-wielders have almost none." Verified: 9 against a Fighter, no counter. |
| 7 | Sera moved into enemy reach | **Count every enemy that reaches you** (the two-enemy threat exercise). The Forest pair at the front is reached by two Fighters; the plain tile behind Gaspar by none. `guide_fragile_in_reach` is mandatory here: "Cover isn't safety. 2 enemies can reach this forest. Count the red eyes, not the trees. Tap Back." (Playtests: a recruit in a forest took 16 from one doubling enemy, and another died to two cavalry after an advance.) |
| 8 | Sera ends next to an ally | **Aura:** "Renewal Aura: allies next to Sera heal 3 HP at the start of your turn." |
| 9 | First enemy phase ends with an ally hurt | **Recover by changing the plan**, a prepared, optional exercise (research: don't make the player let Sera die to discover rewinding). The RunManager grants the prologue's one Vision charge here (§9). "Rewind takes back moves. Browse the timeline for free: find the move that put {unit} in reach. Spend the charge to return there, then choose a different tile." After the rewind, the coach watches the replayed move. If the unit ends out of reach: "Same turn, better plan." In a real run, charges last the whole run. Declining is fine; the charge stays for P4. |

**Reuse:** a later wounded ally is healed without a prompt (the heal note is read by then), and
the player picks a 2-tile Glimmer tile again unaided.

The fight is tuned so Edric and Gaspar hold a line two tiles ahead while Sera heals and chips
from behind. A player who walks Sera to the front sees the fragile note and the red eyes before
committing.

### Route map, row 4 — The Old Watchtower (Ruins)

This mirrors the real pre-boss Ruins. *Rest* (heal all, free) or *Scavenge* (the ruins shop).
The choice commits ("This choice is final for these ruins."). Sera tells the vision here (§10).

### P4 — The Quarry Gate (deploy, formation, seize, boss, par)

```
# # # # G # # # # #
# . . . v . . . . #
. . F . . . F . r .
. . . . k . . . F .
E . T . . F . . . .
E . . . F . . T . .
E . . . . . . . . .
```
(`v` = Varro, beside the gate; `k` = Soldier, `guard`; `r` = Archer)

- **Route preview names the boss:** "Captain Varro · Fighter · Iron Axe (reach 1)". The deploy
  screen shows no boss, and the boss card plays after deploy, so the route preview is where the
  deploy choice gets its information.
- **Deploy screen, first time:** four units, three slots, Edric locked. "Your commander always
  deploys. Choose who fights. Varro's axe reaches 1 tile: who can hit from 2?"
- **Formation, first time:** three or more deployed opens formation placement (existing
  `FormationPanel` copy, plus "Tap a start tile to move a unit there").
- **Boss: Captain Varro.** He is a Fighter, Act 1's own boss class: Knights are not in the
  Act 1 pool, and the first draft's Knight was unwinnable (code review, 2026-10-04). He is L3 with
  `BOSS_STAT_BONUS` and an authored Iron Axe, melee only, so a Hand Axe can't counter at 2.
- **The throne:** Varro is clamped near it, and on it he gets +3 DEF, applied against magic as
  well, and heals 10% a turn.
- **Verified numbers** (L1 attackers; the real party is a few levels higher by P4):

  | Attacker | Varro on the throne | Varro on plain |
  |---|---|---|
  | Gaspar's Steel Lance | 9 (62%), counter 13 | 12 |
  | Sera's Glimmer at range 2 | 4 (74%), **no counter** | 7 |
  | Edric | 3 | 6 |

  Gaspar's sword may double. The harness pins that and the weapon choice.
- **Enemies:** Soldier `k` (`guard`; it charges anything within 3 tiles of its post). Archer
  `r`. Two Fighters.
- **Objective:** Seize. Defeat Varro, then a lord (Edric or Sera) stands on the gate and
  chooses Seize. Par is shown, and explained here for the first time.

| # | Trigger | Lesson |
|---|---|---|
| 1 | Deploy screen | Choose who fights (above). |
| 2 | Battle start | Seize (existing `battle_seize`), and par: "Par: win in N turns or fewer for bonus gold. Safety first; speed pays." |
| 3 | First forecast against Varro on the throne | **Bosses and thrones:** "The throne guards Varro: harder to hurt, and he heals each turn. His axe reaches 1 tile. Strike from 2 where you can." This points to Sera and Tamsin, deployed or not. |
| 4 | Varro below half | His half-health line (existing boss beat). |
| 5 | Varro falls | "Now a lord: step onto the gate and Seize." |
| 6 | Seize | The ending (§5 beat 7). |

**Prompts fade here.** The coach shows only the objective ("Defeat Varro, then Seize the gate"),
with no goals for moving, attacking, healing, weapons or ranges. Choosing Gaspar's weapon,
striking from 2 tiles and healing are the unprompted reuse of P2 and P3.

**Winnable without the best deploy.** The harness requires a win before the boss enrage turn,
min(12, par + 2) (`turnBonus.json`), for the intended play and for the naive policy, with any
deploy that includes Gaspar. A deploy without Sera and Tamsin still wins on Gaspar's lance plus
Edric, slower. A defeat restarts P4 at the deploy screen.

The armor lesson ("Knights shrug off swords; magic hits RES") moves to the first Knight a run
meets (§7).

## 7. What the prologue teaches, and what it leaves to Act 1

| Mechanic | Where |
|---|---|
| Select, move, attack, forecast, end turn, enemy phase, counters | P1 |
| Terrain, weapon triangle | P1 (triangle again in P2) |
| Consumables are permanent | P1 (Vulnerary) |
| Holding enemies and reach | P1 |
| Level-ups and growths | P1 |
| Doubling and attack speed, weapon choice | P2 |
| No counter (bows), forecasts are chances, Danger | P2 |
| Gaspar: chip, don't kill | P2, plus the in-run note |
| Villages (visit) | P2 (uncontested) |
| Loot screen | after P2 |
| Route map, preview, path choice | after P1; the fork at row 2 |
| Shop or Church | row 2 (the other in Act 1) |
| Roster: withdraw, equip, trade, store | row 2 |
| Recruiting by Talk | P3 |
| Sera: heal, 2-tile strike, magic vs RES, fragility, aura | P3 |
| Planning and cancelling; counting threats | P3 |
| HP carries between battles | P3 (whatever P2 left), and Act 1 |
| Staves refill, Vision and rewind | P3 |
| Ruins: Rest or Scavenge | row 4 |
| Deploy and formation | P4 |
| Seize, bosses, thrones, par | P4 |
| Commander rule (taught, never enforced) | P1 coach, P3 and P4 notes |
| The loop: the run resets, Home Base persists | ending |
| Home Base and meta upgrades | after the ending |

Taught again in Act 1 at the point of use, because the prologue can only introduce them
(playtest-backed; §11 phase 3):
- **Between-battle preparation.** At the first route map after a battle where someone ended
  below half HP: HP carries, staves refill, consumables don't, and Roster › Item heals now.
  A playtester's Sera entered a third battle at 3/18 HP.
- **Objective changes.** The moment an objective changes mid-battle (a boss dies and the
  throne is left to capture; an escape's exits open), a short instruction names the new goal
  and where it is.
- **The first specialist's job.** When the first Dancer or flyer joins or is hired, one concrete
  job to try: Dance refreshes an ally who has already acted; a flyer crosses water and
  mountains. Both mattered a lot in playtests.
- **Armor.** The first forecast against a Knight (or any high-DEF unit): "Knights shrug off
  swords. Magic hits RES."

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
  margin. The harness checks both.
- **No named unit is lost.** Any named unit falling restarts the chapter (§6).
- **No Eclipse shadow, no deeds, no affixes, no run counters.** The prologue doesn't count as a
  run started or finished (`runsStarted`, `runsCompleted`), so Guidance stays on Full for the
  real first run (`isVeteranMeta`).
- **Run-layer events the prologue suppresses.** A real run's systems would otherwise fire on top
  of the coach (code review, 2026-10-04):
  - in-battle hints: `battle_par` and `battle_vision_scope_v2` on turn 1, `battle_danger_zone`
    on turn 2 (the prologue shows its own versions at its own beats)
  - all `GuidanceController` notes; it switches off today only for `tutorialMode`
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

```jsonc
{
  "seed": 1209,
  "grant": { "valor": 60, "supply": 60 },        // tune to one cheap upgrade each
  "units": {
    "Edric":  { "lord": "Edric", "level": 1, "stats": { /* authored */ }, "growths": { /* authored */ },
                "traits": [], "inventory": ["Iron Sword", "Vulnerary"] },
    "Sera":   { "lord": "Sera", "level": 1, "proficiencies": ["Light", "Staff"],
                "inventory": ["Glimmer", "Heal", "Vulnerary"] },
    "Tamsin": { "className": "Archer", "level": 1, "inventory": [] }
    // Gaspar: createVeteranKnight, unchanged
  },
  "chapters": [
    {
      "id": "p1_banner_at_dawn",
      "node": "prologue_0",
      "map": { "rows": [". . F . . . . .", "..."], "legend": { ".": "Plain", "F": "Forest", "T": "Fort" } },
      "objective": "rout",
      "playerSpawns": [{ "col": 0, "row": 2 }],
      "enemies": [
        { "className": "Fighter", "level": 1, "col": 4, "row": 2, "weapon": "Iron Axe", "skills": [] },
        { "className": "Fighter", "level": 1, "col": 7, "row": 5, "weapon": "Iron Axe", "skills": [],
          "aiMode": "hold", "holdPack": 0, "holdPackSize": 1 }
      ],
      "loot": null,
      "beats": [
        { "on": "battleStart", "do": [{ "coach": "select_commander" }] },
        { "on": "unitSelected", "unit": "Edric", "once": true, "do": [{ "gateMove": { "col": 3, "row": 2 } }] }
      ]
    }
  ],
  "route": { "nodes": [ /* fixed node list, edges, titles; P1 = row 0, hidden until won */ ] },
  "joins": { "afterChapter": { "p1_banner_at_dawn": ["old_knight"] }, "atNode": { "prologue_2": ["Tamsin"] } },
  "boss": { "name": "Captain Varro", "className": "Fighter", "level": 3, "weapon": "Iron Axe", "epithet": "..." }
}
```

- **Copy** lives in `dialogue.json`: a `prologue` section, plus `bossEncounters['Captain Varro']`
  for his pre-battle, half-health and defeat lines.
- **Varro** is in a prologue-owned boss list. Boss-card epithets read `enemies.bosses`, and
  adding him to `bosses.act1` would put him in the real Act 1 boss pool (code review, 2026-10-04). The
  boss card's epithet lookup takes the prologue list as a fallback.
- **The validator checks:**
  - map rows are rectangular and the legend resolves to terrain names
  - spawns are in bounds and passable
  - authored weapons exist and the unit can wield them
  - beats reference known triggers and actions
  - the boss is in no real act's pool
  - `validateBattleConfig` passes for every chapter

### Pure engine: `src/engine/Prologue.js`

- `buildPrologueBattleConfig(chapter, terrain)` turns the ASCII map into a battle config with
  terrain indices from the `TERRAIN` order. It also carries `villageTile`, `thronePos` and the
  authored `npcSpawn`. It generalises `TutorialHelpers.buildTutorialBattleConfig`.
- `buildPrologueNodeMap(route)` returns the literal node map: ids, rows, edges, types, titles,
  and `battleParams` with `prologueChapter`.
- `prologueBeatsFor(chapter, event, state)` is a pure trigger matcher. It returns the actions to
  run, needs no Phaser, and the harness and unit tests drive it directly.
- `buildPrologueUnit(spec, gameData, rng)` builds Edric, Sera and Tamsin from their authored
  specs, with seeded growth rolls. The authored NPC-lord builder is shared by `BattleScene` and
  `tests/harness/HeadlessBattle.js` (one extracted builder, not two copies, per CLAUDE.md).

### RunManager

- A new serialized field, `mode: 'standard' | 'prologue'`. `fromJSON` defaults it to
  `'standard'`, so old saves are untouched.
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
  no `advanceAct` (the suppress list in §8). It calls `completePrologue()` instead, which:
  - sets `meta.prologue = { state: 'complete' }`
  - pays the grant once (ledger flag)
  - clears the run save
  `meta.prologue` and the grant ledger sync to `meta_progression` like the rest of meta.

### BattleScene: `PrologueController` (new; `create(scene)` / `destroy()`)

- Owns the coach, gates, highlights and notes, driven by `prologueBeatsFor`.
- Absorbs the reusable parts of `TutorialController`: the strict gate, forecast lessons and
  resource lessons. `TutorialController` is deleted when the prologue ships, not kept beside it.
- New trigger points are small hooks the scene already has neighbours for:
  - `unitSelected` (BattleScene 4649)
  - `afterMove` (4955)
  - forecast open (AttackFlowController 468)
  - combat resolved (8314)
  - turn start (`scheduleTurnStartHints`)
  - unit defeated (9087 and up)
  - `hpBelow`
  - `talk`
  - `seize`
- **Prologue defeat (code review, 2026-10-04).** The first draft said the existing "Continue from Map"
  revert would restart a battle. It can't:
  - `VisionRewindController.showLordDeathPrompt` saves a `fatal_pending` checkpoint, which
    `revertBattleInProgressToEntry` refuses.
  - Accept Fate runs `onDefeat`, then `failRun`, then RunComplete, which counts a finished run
    and pays Valor and Supply. That breaks §8.
  So in prologue mode, a named unit's death is intercepted *before* the lord-death prompt and
  `onDefeat`:
  1. `commanderFall` last words don't play.
  2. The "Not this thread" dialogue plays.
  3. A prologue-only restart clears `battleInProgress` (even a `fatal_pending` one) and
     re-enters the node from its locked config and the roster as it entered.
  4. If a Vision charge is unspent, the dialogue offers the rewind first.

### Engine gaps to close (small)

- `addEnemyFromSpawn` honours an authored `weapon` (by name) and `skills`. Today it ignores
  `spawn.weapon`, and the tier picker skips weapons with a `special`, so a Javelin can't be
  reached any other way.
- An authored lord `npcSpawn` (Sera) that doesn't go through `buildRecruitNodeUnit`'s
  roster-average level.
- Prologue route node titles ("Harrow's Market") and the boss preview line.
- The Chapel's blessing service greyed in prologue mode.

### Title, slot, routing and meta

- **Fresh device:** the title's primary item becomes "Prologue · start here" (today it is
  Tutorial). New Game on a fresh slot asks Prologue / Skip, with the prologue highlighted.
- **Routing on `meta.prologue`** (code review, 2026-10-04):
  - `isFirstRunSlot` looks only at the run counters, so it stays true after the prologue.
    Routing reads `meta.prologue` as well.
  - `none`: offer the prologue.
  - `in_progress`: Continue resumes it (`hasActiveRun` is true).
  - `complete`: go to Home Base.
  - `skipped`: today's fast path.
- **Home Base after the prologue:** the existing `homebase_intro` and `homebase_begin` notes, plus
  one line: "This is what persists. Spend the Valor and Supply from the first thread." Begin
  Run then takes a new branch into today's fast path (First Light, no blessing), skipping
  DifficultySelect and BlessingSelect for this run only.
- **The fast path's route-map note** ("Home Base upgrades, difficulty and blessings unlock after
  it ends") gets a second version for prologue players, who have already seen Home Base.
- **Replay:** the Title item "Prologue" opens a chapter select. Replays:
  - run with `activeSlot` cleared, because `_persistBattleRunState` saves whenever `activeSlot`
    is an integer;
  - use a canned roster per chapter (the authored units at that chapter's expected levels);
  - make no grant and no meta writes.
- **Skip mid-way:** "Skip the rest of the prologue" in the pause menu jumps to the ending, then
  Home Base, with the grant.

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
  - P4 is won before the enrage turn with any deploy that includes Gaspar.
  - The P1 Fort is outside `b`'s Danger tiles.
  - P2: Gaspar's lance leaves the Archer at 2 HP and Edric's hit kills it.
  - P3: Edric reaches Sera on turn 1, and only the Soldier reaches her on enemy phase 1.
  - The Gaspar-only policy loses P2.
  - No enemy-phase sequence (hits and crits) kills Edric from where the intended script leaves
    him.
- **Persistence:**
  - Refresh mid-P1 and mid-P3 resumes the battle.
  - Refresh on the route map resumes the map.
  - Every named unit's death restarts its chapter and never reaches RunComplete or settlement.
  - `runsStarted` and `runsCompleted` don't move.
  - The grant pays once, even across a refresh and a cloud sync.
  - A replay never touches the slot.
- **Flow:**
  - Skip equals today's fast path exactly.
  - A completed prologue routes to Home Base, then the fast path.
  - A completed prologue's lesson ids are read in the first run.
  - The suppress list holds (no `battle_par`, no Guidance note and no cold open in prologue mode).
- **e2e:** a new `prologue` lane plays P1 and P3 on desktop and in portrait, waiting on state
  (`tests/e2e/lanes.json`).

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

## 10. Narrative wiring

- The first-run cold open (`actTransitions.runStart`, the `maxRunsStarted: 1` variant: the
  robed mages, the crowned man, the sleeper) moves into the watchtower and ending scenes.
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
- Gaspar's run-start intro line plays only when the prologue didn't already introduce him.

## 11. Phases

| Phase | Scope | Notes |
|---|---|---|
| 0 (this branch) | First Light: no villages in Act 1 rows 0–2. Gaspar's `guide_veteran_kills` note and help line. This spec. | Shipped |
| 0b (optional, small) | Interim Sera fix in the current tutorial: a Sera-specific coach goal ("Sera strikes from 2 tiles, where melee can't hit back, and heals with her staff. Keep her behind Edric.") | Throwaway once P3 ships |
| 1 | Data format and validator, `Prologue.js`, spawn weapon overrides, authored units, `PrologueController` skeleton, the defeat intercept. P1 playable from the title as the practice battle, replacing the tutorial. | Delete `TutorialHelpers` |
| 2 | Run mode and routing, the suppress list, the literal route map, P2, row 2 (fork, Tamsin, roster lesson), P3 | The bulk |
| 3 | Ruins, P4, the ending, Home Base handoff and grant, skip and replay flows. First-visit notes for whichever of Shop and Church the player skipped; the Act 1 point-of-use notes in §7. | Story complete |
| 4 | Polish: prologue music picks (existing tracks, then optional cues), the ritual scene staging, copy pass against the lore guide | |

## 12. Open questions for the user

1. ~~Loop or carry-over~~. Decided: the loop (§3).
2. **Prologue by default?** Recommended: offered on every fresh slot with the prologue
   highlighted, never forced, and skippable mid-way.
3. **A fourth unit for the deploy lesson.** Tamsin is an authored Archer. The alternative is
   deploying 2 of 3 (Edric plus one of Gaspar and Sera), which is a weaker choice and
   teaches less.
4. **The grant.** About one cheap upgrade of each currency (Lord upgrades start at 50 Valor,
   recruit upgrades at 35 Supply). Or nothing, and Home Base is only shown.
5. **Fork at row 2** (Market or Chapel) versus a linear route that visits both. The fork teaches
   path choice; linear teaches both services.
6. **Tamsin's name.** She shares the Archer name pool on purpose, as a faint loop echo. Or she
   gets a name the pool doesn't use.
