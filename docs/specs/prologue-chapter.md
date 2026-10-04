# Prologue: The First Thread — design

Status: Phase 1 built (data format, validator, `engine/Prologue.js`, authored spawn loadouts,
P1's map proven in the harness, `PrologueController`, the defeat intercept; P1 is the title's
practice battle and the tutorial is deleted). Phases 2-4 (the run mode, the route, P2-P4) are
not. Loop ending approved by the user, 2026-10-04.
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

| # | Trigger | Lesson (coach goal / note) |
|---|---|---|
| 1 | Battle start | Coach "Select Edric". Blue units are yours, red are the empire's. |
| 2 | Edric selected | "Move onto the Fort." Cover lowers damage and raises avoid. *Gate* (as today). |
| 3 | On the Fort | Terrain note (existing `battle_terrain`, after the panel refreshes). |
| 4 | First forecast (against `a`) | **One concept: reading a forecast** (`battle_forecast`). Damage per hit, Hit chance, and whether the enemy strikes back. Confirm commits; Cancel goes back. *Gate:* the first confirm. |
| 5 | Edric has acted, turn 1 | **Wait vs End Turn:** "Wait ends Edric's move. End Turn hands every enemy its move. Check who can reach Edric first." `a`'s red reach is shown; `b`'s doesn't reach the Fort. |
| 6 | First enemy phase | "Red units move now. Edric strikes back when attacked, too." |
| 7 | Level-up | The level-up card, with one line: "Levels raise stats at random. Growth rates decide the odds." Edric's XP runs 22, 72, 94, then 144 on `b`'s kill, so this comes last, on the final blow. |
| 8 | Edric walks into `b`'s reach | "Some enemies hold until you come close. Their red reach shows where." `b` wakes. |
| 9 | Second forecast (against `b`) | **One concept: the triangle** (`battle_triangle`, conditional as today). "Swords beat axes. The forecast already includes it." |
| 10 | Edric ≤ 60% HP | "Item → Vulnerary heals 10. You carry few, and they never come back." (existing consumable copy) |
| 11 | Victory | Gaspar rides in (dialogue). |

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

| # | Trigger | Lesson |
|---|---|---|
| 1 | Battle start | Gaspar's intro lines (`p2_gaspar_intro`). |
| 2 | Gaspar selected | The Jagen note (above). Gaspar rides 6 tiles; Measured Step lets him keep moving after a non-combat action. |
| 3 | Gaspar targets the Archer | **Weapon choice and doubling** (`battle_doubling`, one concept: strike count). The lance reads 16 ×1, the sword 12 ×2. |
| 4 | A forecast with no counter | `battle_no_counter`: bows reach two tiles only. |
| 5 | A forecast under 100 Hit | **Forecasts are possibilities** (`p2_forecast_chances`). |
| 6 | Edric's forecast against the Soldier | The triangle against Edric (`p2_lances_beat_swords`): "Let Gaspar open the Soldier; Edric finishes it." |
| 7 | Edric's kill | Marks `veteran_kills` practised. |
| 8 | Turn 2 | Danger (`battle_danger_zone`). |
| 9 | A unit ends on the village | Visit (`p2_village_visit`): gold, and an Iron Bow sent to the convoy. |
| 10 | Victory | The victory lines (`p2_victory`) and the **loot screen** note (`battle_loot`), then the authored rewards. |

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

The schema is documented at the top of `src/engine/Prologue.js`, which is the reference. Shipped
today: the seed, the grant, authored Edric and P1. Sera, Tamsin, P2–P4, `route`, `joins` and
`boss` are schema only (the validator checks them when present) until a later phase authors them.

```jsonc
{
  "version": 1,
  "seed": 1209,
  "grant": { "valor": 60, "supply": 40 },        // one cheap upgrade of each (§12)
  "units": {                                     // keyed by unit name (the key is the name)
    "Edric":  { "lord": "Edric", "level": 1,
                "stats": { /* every stat incl. MOV: his lords.json base */ },
                "growths": { /* class-range midpoint + personal growth */ },
                "traits": [], "inventory": ["Iron Sword", "Vulnerary"] },
    // later: "Sera":   { "lord": "Sera", "level": 1, "proficiencies": ["Light", "Staff"],
    //                    "inventory": ["Glimmer", "Heal", "Vulnerary"] },
    //        "Tamsin": { "className": "Archer", "level": 1, "inventory": [] }
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
      "npc": null,            // P3: { "unit": "Sera", "className": "Light Sage", "col", "row" }
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
  "route": null,   // P2+: { "nodes": [...], "edges": [...] } for buildPrologueNodeMap
  "joins": null,   // { "afterChapter": { "p1_banner_at_dawn": ["old_knight"] }, "atNode": { "prologue_2": ["Tamsin"] } }
  "boss": null     // { "name": "Captain Varro", "className": "Fighter", "level": 3, "weapon": "Iron Axe", "epithet": "..." }
}
```

A chapter has no keys for reinforcements, bandits or fog: the validator rejects unknown fields,
so §8's "no unannounced arrivals" is enforced by the format. Every enemy names its weapon and
its skills (`[]` for none), so no prologue enemy rolls a weapon tier or a skill.

- **Copy.** Spoken lines live in `dialogue.json`'s `prologue` section (`p1_gaspar_arrives`,
  `not_this_thread`; later `bossEncounters['Captain Varro']` for his pre-battle, half-health and
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
  - beats use known triggers, only that trigger's conditions, and known actions with valid
    arguments (tiles on the map, units of the chapter, lesson kinds); beat ids are unique
  - the boss is in no real act's pool; joins name known chapters and units
  - `validateBattleConfig` passes for every chapter's built config

### Pure engine: `src/engine/Prologue.js`

- `buildPrologueBattleConfig(chapter, terrainData)` turns the ASCII map into a battle config with
  terrain indices from the `TERRAIN` order (looked up by name in `terrain.json`, whose order is
  the same). The config has `generateBattle`'s shape (`templateId: 'prologue:<id>'`,
  `prologueChapter`, `parBonus: 0`, no `reinforcements`), so `BattleScene` computes par from it as
  it does for any locked map. Enemy spawns carry `authoredId`, `weapon`, `skills` and the hold
  fields; it also carries `villageTile`, `thronePos` (or the map's single Throne on a seize map)
  and the authored `npcSpawn`. It generalises `TutorialHelpers.buildTutorialBattleConfig`.
- `buildPrologueNodeMap(route)` (P2+, not built yet) returns the literal node map: ids, rows,
  edges, types, titles, and `battleParams` with `prologueChapter`.
- `prologueBeatsFor(chapter, event, state)` is a pure trigger matcher. It returns
  `{ actions, fired, state }`: the matching beats' actions in authored order, each tagged with its
  beat id, and a new state whose `fired` lists the `once` beats spent (the input state is never
  mutated). The vocabulary (documented in the module header):
  - triggers: `battleStart`, `turnStart {turn, phase}` (phase defaults to the player's),
    `unitSelected {unit, turn}`, `afterMove {unit, tile, terrain, dangerFrom, turn}`,
    `forecastOpened {unit, target, nth, concept, turn}`, `combatResolved {unit, target, turn}`,
    `unitActed {unit, turn}`, `unitDefeated {unit}`, `levelUp {unit}`, `hpBelow {unit, pct}`,
    `holdWoken {unit}`, `talk {unit, target}`, `seize {unit}`, `victory`
  - actions: `coach`, `note`, `dialogue` (ids), `gateSelect {unit}`, `gateMove {col, row}`,
    `gateConfirm`, `highlight {tile | unit | reachOf}`, `markLesson {id, kind: shown|practised}`
  - `forecastConcepts(forecast, { weapon })` gives a forecast's concepts (`triangle`, `doubling`,
    `noCounter`, `magic`, `uncertainHit`) for `forecastOpened` events; `dangerFrom` is the list
    of enemy ids whose Danger tiles (player knowledge) hold the tile.
- `buildPrologueUnit(spec, gameData, rng, { name })` builds Edric, Sera and Tamsin from their
  authored specs: lords through `createLordUnit`, generic classes through `createUnit`, then the
  authored stats, growths, traits (`[]`), proficiencies, skills and inventory replace what was
  rolled. Every draw (growths or level-ups the spec leaves out, item uids) comes from `rng`;
  Math.random is never touched (`createLordUnit`, `createUnit` and `rollGrowthRates` take an
  optional `rng`, defaulting to Math.random). `buildPrologueUnits(prologue, gameData, keys)` builds
  by key, each unit on its own stream (`prologueUnitRng(seed, key)`). Sera's kit (Light and Staff
  ranks, Glimmer equipped, Heal usable) is tested from a spec; she is not in the data yet.
- **Not yet built:** the authored NPC-lord spawn (Sera in P3). When it is, it is one builder
  shared by `BattleScene` and `tests/harness/HeadlessBattle.js` (per CLAUDE.md), reading
  `npcSpawn.prologueUnit`.

### Authored spawns and the harness (built)

- `EnemySpawnGear.applySpawnLoadout(enemy, spawn, { weapons, skills })` runs after
  `applyEnemySpawnGear` in `BattleScene.addEnemyFromSpawn` and the harness alike: a spawn's
  `weapon` (by name, specials such as Javelin allowed, refused if the class can't wield it) and
  `skills` (exactly those) replace the rolled kit, and `authoredId` is copied to the unit. The
  new weapon takes the dropped weapon's uid, so the battle's Math.random stream is the same with
  or without an authored kit. Spawns without these fields are built exactly as before
  (`tests/SpawnLoadout.test.js` pins that against a capture taken before the change).
- `HeadlessBattle.init({ battleConfig })` plays a locked config, as `BattleScene` does with
  `RunManager.getLockedBattleConfig`.
- Fort and Throne healing moved to `engine/TerrainHealing.js` and the harness now applies it
  (it never did). P1's safety rests on it.

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
  no `advanceAct` (the suppress list in §8). The ending (`PrologueEnding.commitPrologueEnd`)
  calls `meta.completePrologue({ grant, chaptersCompleted, practised })` instead, which:
  - sets `meta.prologue.state = 'complete'`
  - pays the grant once (the `grantPaid` ledger flag, in the same write as the currencies; a
    failed write rolls back so a retry pays; a paid copy on disk is adopted first)
  - then the run save is cleared
  `meta.prologue` (`{ state, grantPaid, chaptersCompleted, practised }`) rides the meta
  payload to `meta_progression` like the rest of meta, under the `savedAt` freshness guard;
  a merge takes the further state, keeps a paid grant paid and unions the lists
  (`mergePrologueState`).
- **Built (Phase 2A):** `startPrologue` (the roster from the first-row chapter, Edric stamped
  commander, the route from `buildPrologueNodeMap`, every chapter pre-locked, `runStart`
  marked shown so the route map plays no cold open), `getPrologueChapter` /
  `getActivePrologueChapter`, the authored joins committed in `completeBattle`
  (`joins.afterChapter`, once), `grantPrologueVision`, `isPrologueComplete`,
  `restartPrologueBattle`, `mode` in `toJSON` / `fromJSON`.

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
  - `talk` and `seize` are not wired yet (no P1 beat uses them; P3/P4).
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
  Phase 2's run-mode restart (clearing `battleInProgress`, re-entering the node, offering an
  unspent Vision first) is still to build.
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
- An authored lord `npcSpawn` (Sera) that doesn't go through `buildRecruitNodeUnit`'s
  roster-average level.
- ~~Prologue route node titles.~~ Done: an authored node's `title` names it on the loom
  (`describeLoomNode`), and the loom header reads "Prologue · The Quarry Road"
  (`loomHeader`'s `act` / `title` overrides). The boss preview line waits for P4.
- The Chapel's blessing service greyed in prologue mode.

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
  with "Play the Prologue · about 20 minutes" and "Skip to the first run". It comes from both
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
  With saves, "Prologue" opens the chapter select (every chapter on the route, in order):
  a replay runs standalone with the authored roster at the chapter's expected levels
  (`buildPrologueRoster`; P2 brings Gaspar), with the title's `activeSlot`, `meta` and
  `hints` set aside in the registry (`prologueReplayStash`) and restored by the title on
  return; no grant, no meta write.
- **Home Base after the prologue:** the existing `homebase_intro` and `homebase_begin` notes,
  plus one line (`PROLOGUE_HOME_BASE_NOTE`, hint `homebase_prologue_grant`): "This is what
  persists. Spend the Valor and Supply from the first thread." Begin Run goes through
  `HomeBaseScene.startRunFromHomeBase` (desktop button and `MobileHomeBase`), which reads
  `routeForBeginRun`.
- **The fast path's route-map note** has a prologue-player version
  (`PROLOGUE_FIRST_RUN_ROUTE_NOTE`): Home Base is already known.
- **Skip mid-way:** "Skip Prologue" in the pause menu (battle and route map; the coach's Skip
  and a field note's "Skip prologue" open the same confirmation) jumps to the ending
  (`src/ui/PrologueEnding.js`: the `prologue.ending` lines, the title card, one meta write,
  the run save cleared), then Home Base with the grant. The prologue run has no Abandon Run.
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
  - The P1 Fort is outside `b`'s Danger tiles (built, with the rest of P1's harness checks:
    `tests/harness/PrologueP1.test.js`).
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
- **e2e:** the `prologue` lane (`tests/e2e/lanes.json`): `prologue-run.spec.js` (the offer,
  P1 as a run, the route, P2, the ending, Home Base, Begin Run's fast path; Skip; a refresh
  mid-P1 with Resume Battle and Continue from Map), `prologue-exit.spec.js` (Skip from the
  coach, the pause and a note; the restart in the run; the chapter select and a replay that
  never touches the slot), `prologue-lessons.spec.js` (P1's notes on a phone, in the run).
  Phase 2B adds P3 and the portrait specs.

**Built in Phase 2A** (unit): `RunManagerPrologueMode` (start, save round-trip, old saves,
joins, the restart), `MetaProgressionPrologue` (the record, the grant paid once across a
refresh and a cloud merge, the counters), `PrologueRouting`, `PrologueEnding`,
`ScriptedBattleSuppression` (every reader in both modes, no private flag),
`PrologueController` (both modes), `firstRunFastPath` (the two starts),
`TitleSceneNewGameFlow` (the offer, the chapter select, the replay stash),
`NarrativeDirector` (the `prologue` key). Harness: `tests/harness/PrologueP2.test.js`.

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
| 1 | Data format and validator, `Prologue.js`, spawn weapon overrides, authored units, `PrologueController`, the defeat intercept. P1 playable from the title as the practice battle, replacing the tutorial. | Shipped 2026-10-04. `TutorialController`, `TutorialHelpers`, the tutorial coach model, lessons and forecast layout deleted; e2e `prologue-exit` / `prologue-lessons` (desktop and phone) and the portrait prologue tests replace the tutorial specs. Deviations: `talk`/`seize` hooks wait for P3/P4; the `practised` ledger is kept on the controller, not on slot meta (no slot in a standalone chapter); the enemy-phase note is a nudge, not a modal. |
| 2A | Run mode and routing, the suppress list in both modes, the literal route map, P2, the ending stub, Home Base handoff and grant, skip and replay flows. | Shipped 2026-10-04. The slice: fresh slot → (Prologue \| Skip) → P1 (row 0, map hidden) → Gaspar joins → route map → P2 → **temporary:** P2's victory completes the prologue → ending stub (data: `prologue.ending`) → Home Base (grant) → Begin Run → the fast path. Later phases insert row 2, P3, the Ruins and P4 by adding data. Deviations: P2 as built above (one Fighter, the Soldier on Plain, the Archer on the west bank); the title's "Prologue · Start here" on a fresh device starts the prologue run rather than a standalone P1; a standalone replay ends with "Back to title" only (the Start First Run handoff is gone: New Game owns the offer); the `practised` ledger lands on slot meta at each chapter's victory in the run (`recordPrologueChapter` / `recordProloguePractised`); the ending is a four-line unnamed sequence plus the title card, not yet the ritual scene. |
| 2B | Row 2 (fork, Tamsin, roster lesson), P3 | |
| 3 | Ruins, P4, the ritual ending scene. First-visit notes for whichever of Shop and Church the player skipped; the Act 1 point-of-use notes in §7. | Story complete |
| 4 | Polish: prologue music picks (existing tracks, then optional cues), the ritual scene staging, copy pass against the lore guide | |

## 12. Decisions (user, 2026-10-04)

1. **Loop, not carry-over** (§3).
2. **The prologue is the default.** Every fresh slot offers it, highlighted. It is never forced,
   and it can be skipped at the start or mid-way.
3. **The Home Base grant is small:** about one cheap upgrade of each currency. Lord upgrades start
   at 50 Valor and recruit upgrades at 35 Supply, so the grant is 60 Valor and 40 Supply.
4. **The row-2 fork stays** (Market or Chapel). It is the prologue's only real route choice, and
   whichever service the player skips gets a first-visit note in Act 1.
5. **Tamsin keeps her name** as a faint loop echo, unless the user asks otherwise.
6. **Tamsin is the fourth unit** for the deploy lesson.
