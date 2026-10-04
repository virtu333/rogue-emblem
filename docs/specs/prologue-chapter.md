# Prologue: The First Thread — design

Status: Proposed (design only, nothing built)
Date: 2026-10-04
Replaces: the practice tutorial battle (`TutorialController`, `TutorialHelpers`) once the
prologue reaches parity. `docs/tutorial-battle-spec.md` is already stale; the shipped tutorial
is described in `docs/specs/tutorial_v2_guided_flow_spec.md` and `docs/onboarding-review-2026-09-20.md`.
Research: `docs/fire-emblem-tutorial-sequencing.md` (how FE7, FE8, Path of Radiance and Awakening
stage their openings, and the teaching rules adopted in §2).

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
  learner (enemy SKL/LCK and placement), rather than bending combat. Any prepared setup (P3's
  wounds) is disclosed in the fiction and on screen.
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

The rest of this spec assumes B. **Open question 1** asks the user to confirm it.

## 4. Flow

```
Fresh slot ─ New Game ─┬─ Play the Prologue (highlighted, "about 20 minutes")
                       └─ Skip to the first run ──► today's fast path (unchanged)

Prologue:
  P1 Banner at Dawn (battle, no route map yet)
   └► Prologue route map "The Quarry Road"
        row 0  P2 Old Hands ............................ battle
        row 1  Harrow's Crossing: Shop  |  Chapel ...... fork (village; the recruit joins either way)
        row 2  P3 The Seer on the Road ................. battle (Sera joins by Talk)
        row 3  The Old Watchtower ...................... Ruins: Rest or Scavenge
        row 4  P4 The Quarry Gate ...................... boss, seize
   └► Ending: the ritual, the Hollow Sun, the thread breaks
   └► Home Base (first visit; small Valor + Supply grant; spend it)
   └► Begin Run ──► first run: First Light, no blessing, standard roster
```

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
- **Sera** — a seer who fled the court circle when she saw what the ritual would wake. She is
  the Lieutenant's rival.
- **Tamsin** — the watch archer of Harrow's Crossing. A prologue-only recruit; her name is not
  reserved in runs.
- **Captain Varro** — the imperial officer holding the quarry gate. Prologue-only boss.

**Beats.**
1. *Dawn, the quarry road.* Deserters raid a farmstead. Edric rides out alone, and Gaspar
   arrives behind him at the end of P1.
2. *Old hands.* Gaspar insists on riding with Edric, but "the blows that teach you must be your
   own". An imperial outrider squad is camped by the ford.
3. *Harrow's Crossing.* The village is emptying ahead of the columns. Tamsin joins because
   the soldiers burned her watch post.
4. *The seer on the road.* A robed woman runs from imperial soldiers (green unit). Edric reaches
   her and she joins. Sera: "I have seen you before, Edric. Many times. You always come for me."
5. *The watchtower.* Sera describes what the circle is doing. The cold-open vision lines live
   here now (§10).
6. *The quarry gate.* Varro holds the gate. Beat him, seize the gate, and the column breaks.
7. *The ritual.* The ground shakes, the sun goes hollow, and something under the consecrated
   stones turns over. A pale man watches from the far ridge (the Lieutenant, unnamed). The land
   comes apart. Sera grabs the thread: "Not like this. I know this road now. Again — from
   where it began."
8. *Home Base.* Title text: "Every run is a thread Sera weaves. When one breaks, she weaves
   again. Your army starts over. What you build at Home Base stays."

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

Map sketches are proposals; the harness (§9) decides the final tiles. The legend is
`.` Plain, `F` Forest, `T` Fort, `M` Mountain, `~` Water, `=` Bridge, `V` Village, `G` Throne
(the gate), `#` Wall, `E` player start, and lowercase letters are enemies.

The damage numbers below are level-1 base-stat arithmetic (Combat formulas in CLAUDE.md). The
prologue fixes its run seed, so enemy level-ups and every hit roll are the same on every
playthrough. The harness asserts the interactions each beat relies on.

### P1 — Banner at Dawn (Edric alone)

Story: deserters loot a farmstead on the quarry road. Edric rides out alone.

```
. . F . . . . .
. . . . F . a .
E . . T . . . .
. . . . . F b .
. . F . . . . .
. . . . . . F .
```

- **Roster:** Edric L1, Iron Sword, 1 Vulnerary.
- **Enemies:** Fighter `a` (L1, Iron Axe, advances); Fighter `b` (L1, Iron Axe, `hold`, a
  one-unit pack that wakes when Edric enters its reach).
- **Objective:** Rout. No reinforcements and no fog.
- **Why it works:** Edric's sword beats axes, so he deals 6+5−4+1 = 8. He doubles them (AS 6
  vs 0), for 16 a round against 22 HP. A Fighter deals 9 to him on Plain and 7 on the Fort.
  Two fights in sequence are safe with the Fort and the Vulnerary. Fighting both at once in
  the open is not, and the hold makes "one at a time" the default.

| # | Trigger | Lesson (coach goal / note) |
|---|---|---|
| 1 | Battle start | Coach "Select Edric". Blue units are yours, red are the empire's. |
| 2 | Edric selected | "Move onto the Fort." Cover lowers damage and raises avoid. *Gate* (as today). |
| 3 | On the Fort | Terrain note (existing `battle_terrain`). |
| 4 | Fighter `a` in reach | The forecast lesson (`battle_forecast`), then the triangle (`battle_triangle`) on the same exchange. |
| 5 | Edric doubles | `battle_doubling`. |
| 5b | Edric has acted, turn 1 | **Wait vs End Turn:** "Wait ends Edric's move. End Turn hands every enemy its move. Check who can reach Edric first." Fighter `b`'s red reach is highlighted while the End Turn prompt is up. |
| 6 | First enemy phase | "Red units move now. The red eye showed who could reach you." |
| 7 | Edric ≤ 60% HP | "Item → Vulnerary heals 10. You carry few, and they never come back." (existing consumable copy) |
| 8 | Fighter `b` wakes | "Some enemies hold until you come close. Their red reach shows where." **Reuse:** no prompt for this fight. The player picks the tile and opens the forecast unaided. |
| 9 | Level-up | The level-up card, with one line: "Levels raise stats at random. Growth rates decide the odds." |
| 10 | Victory | Gaspar rides in (dialogue). |

Defeat: Sera's voice, off-screen and unnamed: "Not this thread." The battle restarts. This
foreshadows her and teaches nothing false. Safety: with the fixed seed, the harness confirms that
no sequence of Fighter hits *and* crits can kill Edric from full HP on the Fort within two enemy
phases.

### P2 — Old Hands (Edric + Gaspar): the Jagen lesson

Story: an imperial outrider squad at the ford, with a village the squad hasn't reached.

```
. . F . . ~ . . . F
E . . . . ~ . a . .
. . V . . = . . c .
E . . . F ~ . b . .
. . F . . ~ . . . T
. . . . . ~ F . d .
```

- **Roster:** Edric (carries his P1 level), and Gaspar: the standard special character (Steel
  Lance and Iron Sword, Measured Step, Aegis). His data is unchanged.
- **Enemies:** Archer `a` (L1, Iron Bow), Fighters `b` and `c` (L1), Soldier `d` (L2, Iron Lance,
  `guard` on the Fort).
- **Objective:** Rout. The village is uncontested: no bandits, by design (see §8).

**The Jagen beat** (the heart of P2):
- Gaspar's Steel Lance against the Archer: 10+9−3 = 16 of 18 HP. One hit, because AS 4 against
  the Archer's 3 is no double, and bows can't counter at range 1. The Archer is left on 2 HP.
- Edric finishes it from an adjacent tile: 8 damage, no counter.
- Gaspar's Iron Sword against the same Archer kills it outright (12 × 2, AS 9 doubles). So the
  forecast shows the choice: **the lance chips, the sword kills.**
- The coach and note use the in-run `guide_veteran_kills` copy added in this branch: "Gaspar is
  strong now but barely grows and earns little XP. Weaken enemies with Gaspar, then leave the
  final blow to Edric and your recruits: they grow from it." Showing it here marks that note read.
- The XP shown on the level-up card makes the point: Edric's kill is worth several times
  Gaspar's.

| # | Trigger | Lesson |
|---|---|---|
| 1 | Battle start | Gaspar's intro line. |
| 2 | Gaspar selected | The Jagen note (above). Gaspar rides 6 tiles; Measured Step lets him keep moving after a non-combat action. |
| 3 | Gaspar targets the Archer | Weapon choice in the attack picker: "Each weapon gives a different forecast. Pick the one that fits the job." |
| 4 | Adjacent to the Archer | `battle_no_counter`: bows reach two tiles only. |
| 5 | Edric selected while the Soldier is in reach | The triangle against Edric: "Lances beat swords. Let Gaspar take the Soldier." |
| 6 | Turn 2 | Danger (existing `battle_danger_zone`). |
| 7 | A unit ends on the village | Visit: gold and an item (existing village copy, minus the bandit clause). |
| 8 | Victory | **Loot screen**, first time (existing `battle_loot`, rewritten for the prologue). |

**Reuse:** the guarded Soldier on the Fort is the unprompted check. Edric's sword is at a
disadvantage, so the player has to apply the P2 pattern unaided: Gaspar softens, Edric
finishes, and no Jagen note fires again. **Gaspar doesn't solve the map:** two Fighters with
axes (advantage against his lance) plus the Archer are tuned so that sending Gaspar in alone
loses him. The harness checks a Gaspar-only policy fails.

**The village visit pays a bow.** Its convoy item is a fixed Iron Bow, which sets up row 1.

### Route map, row 1 — Harrow's Crossing (Shop | Chapel)

The first route map appears after P2. Rows 0–4 are visible, and node preview is the lesson:
"Tap a node to see what it holds. Travel commits; you can't come back."

- **The fork** (teaches the choice): *Harrow's Market* (Shop) or *Harrow's Chapel* (Church:
  heal, the revive price list, and the blessing service shown but greyed for the prologue). The
  other service is taught at its first Act 1 visit (new first-visit notes; §11, phase 3).
- **Tamsin joins on arrival, at either node.** This uses the standard recruit card. She is an
  Archer at L1, and **her bow burned with her watch post**: she arrives unarmed. This is
  Awakening's missing-axe trick. The roster has a concrete problem to solve, instead of a menu
  tour. The cause and the remedy are shown together, so she never looks broken: her join line
  says so, and her roster row reads "No weapon. A bow is in the convoy." If P2's village wasn't
  visited, the bow waits at the node (her line: "There's a bow on the rack here. It'll do.").
- **The roster lesson** runs once, the first time the player opens Roster after Tamsin joins.
  Three short steps, each gated on the player doing it:
  1. *Convoy:* withdraw the Iron Bow to Tamsin. "The convoy is shared storage. Units fight
     only with what they carry." This wires up the dead `guide_convoy` copy.
  2. *Equip:* equip it. "Each unit carries up to 5 weapons. The equipped one is the one they
     fight with."
  3. *Trade:* give Tamsin a Vulnerary from Edric. "Trade swaps items between units, between
     battles."
  Each step can be skipped. Travel is never blocked, but an unarmed unit gets the standard
  greyed-Attack reason ("Unarmed") in P3, so the problem stays legible.
- **Shop branch:** buy a Vulnerary with P2's gold. "Shops change stock each visit. Gold also pays
  for revivals and promotions."

### P3 — The Seer on the Road (Sera's chapter)

Story: Sera runs down the road with soldiers behind her. She starts as a green unit two tiles
from the enemy line, so reaching her is the first job.

```
. . . F . . . . F .
E . . . . . s . . a
E . F . . S . . b .
E . . . F . . . . c
. . . T . . . F . .
```
(`S` = Sera, green; `s` = a Soldier already beside her)

- **Roster:** Edric, Gaspar, Tamsin. Edric and Gaspar start at ~70% HP, because HP carries
  between battles. The node map already showed it (`nodemap_hp_persist`). The wounds are
  scripted so that **Heal is useful on Sera's first turn**.
- **Sera** joins by Talk at L1, with Glimmer (Light, 4 might, range 1–2), Heal (3 uses) and
  Renewal Aura.
- **Enemies:** Soldier `s` (L1, attacks Sera first); Fighters `a`, `b` and `c` (L1, Iron Axe,
  melee only).
- **Objective:** Rout. Sera must survive: she is a lord, and her fall triggers the Vision lesson
  (below).

**Sera's lessons, the gap this spec exists to close.** Each one is a beat, not a footnote:

| # | Trigger | Lesson |
|---|---|---|
| 1 | Battle start | "Sera is the green unit. Move Edric next to her and choose Talk." (`guide_recruit_on_map` copy; lords only.) |
| 2 | Sera joins | Sera's line, then the coach: "Sera's turn. She acts right away." |
| 3 | Sera selected, ally hurt | **Heal:** "Sera heals with her staff: move next to Edric, choose Heal. Staff uses refill every battle." |
| 4 | Sera selected, a foe 2 tiles off | **Range:** "Glimmer reaches 2 tiles. From 2 tiles away, an axe or a lance can't hit back. Strike from there." The forecast shows "No counter". |
| 5 | Sera moved into enemy reach | **Fragile:** `guide_fragile_in_reach`, made mandatory here. "Sera would be in reach of 2 enemies. Tap Back." |
| 6 | Glimmer forecast | **Magic:** "Glimmer is magic: it hits RES, not DEF. Axe-wielders have almost none." 6+4−1 = 9 against a Fighter, no counter. |
| 7 | Sera ends next to an ally | **Aura:** "Renewal Aura: allies next to Sera heal 3 HP at the start of your turn." |
| 8 | First enemy phase ends with an ally hurt | **Rewind, as a prepared, optional exercise** (research: don't make the player let Sera die to discover it). The prologue run holds 1 Vision charge. "Rewind takes back moves. Browse the timeline for free, and spend a charge to return. In a real run, charges last the whole run." Declining is fine; the charge stays for P4. |
| 9 | Sera falls (if) | "Sera has fallen." The prologue's no-dead-end rule restarts the battle ("Not this thread"); the coach suggests the charge first if one is left. |

**Reuse:** on turn 3, Gaspar comes back wounded from the Fighter pair. Healing him is unprompted
(the `guide_healer_heals` note is already read), and so is choosing a 2-tile tile for Glimmer.

The fight is tuned so Edric and Gaspar hold a line two tiles ahead while Sera heals and chips
from behind. A player who walks Sera to the front sees the fragile note and the red eyes before
committing.

### Route map, row 3 — The Old Watchtower (Ruins)

This mirrors the real pre-boss Ruins. *Rest* (heal all, free) or *Scavenge* (the ruins shop).
The choice commits ("This choice is final for these ruins."). Sera tells the vision here (§10).

### P4 — The Quarry Gate (deploy, seize, boss, par)

```
# # # # G # # # # #
# . . . . . . . . #
. . F . k . F . . .
. . . . . . . . F .
E . T . . F . . . .
E . . . F . . T . .
E . . . . . . . . .
```

- **Deploy screen, first time:** four units, three slots, and Edric locked. "Your commander
  always deploys. Choose who fights. Check the boss first." The boss card (pre-battle) shows
  Varro: a Knight with very high DEF. Formation placement follows (the existing
  `FormationPanel` copy, plus one line: "Tap a start tile to move a unit there").
- **Boss:** Captain Varro (Knight, L3 + boss bonus, Javelin with range 1–2), on the gate.
  He stays near the throne (existing seize-boss clamp) and hits two tiles out.
- **Enemies:** Soldier `k` (`guard`), two Fighters, one Archer.
- **Objective:** Seize. Defeat the boss, then move Edric onto the gate and choose Seize.
  Par is shown, and explained here for the first time.

| # | Trigger | Lesson |
|---|---|---|
| 1 | Deploy screen | Choose who fights (above). |
| 2 | Battle start | Seize (existing `battle_seize`), and par: "Par: win in N turns or fewer for bonus gold. Safety first; speed pays." |
| 3 | Edric forecasts against Varro | **Armor:** "0 damage. Knights shrug off swords. Magic hits RES, and Varro has little." This points to Sera (deployed or not; see below). |
| 4 | A unit enters Javelin range 2 | "Varro's Javelin reaches 2 tiles. Even Sera takes a counter here." |
| 5 | Varro below half | His half-health line (existing boss beat). |
| 6 | Varro falls | "Now Edric: step onto the gate and Seize." |
| 7 | Seize | The ending (§5 beat 7). |

Prompts fade here. The coach shows only the objective ("Defeat Varro, then Seize the gate"),
with no goals for moving, attacking, healing or ranges.

If the player leaves Sera out, Gaspar's lance still scratches Varro (about 19−13 = 6 a hit,
depending on the boss bonus), so P4 stays winnable and the armor note teaches the deploy choice
for next time. A defeat restarts P4 at the deploy screen.

## 7. What the prologue teaches, and what it leaves to Act 1

| Mechanic | Where |
|---|---|
| Select, move, attack, forecast, end turn, enemy phase | P1 |
| Terrain, weapon triangle, doubling and attack speed | P1 (triangle again in P2) |
| Consumables are permanent | P1 (Vulnerary) |
| Holding enemies and reach | P1 |
| Level-ups and growths | P1 |
| Weapon choice in battle, no counter (bows), Danger | P2 |
| Gaspar: chip, don't kill | P2, plus the in-run note |
| Villages (visit) | P2 (uncontested) |
| Loot screen | after P2 |
| Route map, preview, path choice | row 1 |
| Shop or Church | row 1 (the other in Act 1) |
| Roster: equip, trade, convoy | row 1 |
| Recruiting by Talk | P3 |
| Sera: heal, 2-tile strike, magic vs RES, fragility, aura | P3 |
| HP carries between battles | P3 (scripted wounds) |
| Staves refill, Vision and rewind | P3 |
| Ruins: Rest or Scavenge | row 3 |
| Deploy and formation | P4 |
| Seize, bosses, armor, 1–2 range, par | P4 |
| Commander rule (taught, never enforced) | P1 coach, P3 and P4 notes |
| The loop: the run resets, Home Base persists | ending |
| Home Base and meta upgrades | after the ending |

Left to Act 1 field notes (existing or §11 phase 3): promotion, skills and scrolls, weapon arts,
blessings, difficulty rungs, Colosseum, forge, escape maps, fog, affixes, status staves,
caravans, village bandits, the Eclipse's mechanics, and reinforcements.

## 8. Rules for prologue battles

- **No unannounced arrivals.** No reinforcements, no bandit squads, no fog. The first-run
  feedback that triggered this spec named early reinforcements as the problem. (This branch
  also stops villages from rolling in First Light's first three Act 1 rows; see
  `docs/specs/village-bandit-objectives.md`.)
- **Deterministic.** Fixed run seed, so the same actions give the same outcomes. Enemy kits come
  from authored spawns, never from random weapon tiers or skills.
- **Forgiving.** Each chapter must be winnable by a naive policy (move toward the nearest enemy,
  attack with the equipped weapon) with Edric surviving. The intended play wins with margin.
  The harness checks both.
- **No Eclipse shadow, no deeds, no affixes, no run counters.** The prologue doesn't count as a
  run started or finished (`runsStarted`, `runsCompleted`), so Guidance stays on Full for the
  real first run (`isVeteranMeta`).
- **Lessons are recorded, as two facts.** A lesson *shown* marks its HintManager id read on this
  slot (as `applyCompletedTutorialHints` does today), so the first run doesn't repeat the text.
  A lesson *practised* (the player healed, struck from 2 tiles, chipped for a finish, deployed)
  is a separate record on the slot's meta, `prologue.practised: [ids]`. It is for playtest
  analysis and for re-offering a lesson in Act 1 when it was shown but never practised. Skipped
  and cancelled lessons never block progress.

## 9. Engineering plan

Findings this rests on (survey, 2026-10-04):
- The engine has no fixed-map or fixed-route support except the tutorial's literal config.
- A run can carry hand-authored battles through `RunManager.battleConfigsByNodeId` (the
  locked-config path BattleScene checks before `generateBattle`).
- A literal `nodeMap` (`{actId, nodes, startNodeId, bossNodeId}`) is plain serialized data.

### Data: `data/prologue.json` (validated, synced to `public/data`)

```jsonc
{
  "runSeed": 1209,
  "grant": { "valor": 60, "supply": 60 },        // tune to one cheap upgrade each
  "chapters": [
    {
      "id": "p1_banner_at_dawn",
      "title": "Banner at Dawn",
      "map": { "rows": [". . F . . . . .", "..."], "legend": { ".": "Plain", "F": "Forest", "T": "Fort" } },
      "objective": "rout",
      "playerSpawns": [{ "col": 0, "row": 2 }],
      "enemies": [
        { "className": "Fighter", "level": 1, "col": 6, "row": 1, "weapon": "Iron Axe" },
        { "className": "Fighter", "level": 1, "col": 6, "row": 3, "weapon": "Iron Axe",
          "aiMode": "hold", "holdPack": 0, "holdPackSize": 1 }
      ],
      "beats": [
        { "on": "battleStart", "do": [{ "coach": "select_commander" }] },
        { "on": "unitSelected", "unit": "Edric", "once": true, "do": [{ "gateMove": { "col": 3, "row": 2 } }] }
      ]
    }
  ],
  "route": { "nodes": [ /* fixed node list, edges, node titles */ ] },
  "joins": { "afterChapter": { "p1_banner_at_dawn": ["old_knight"] }, "atNode": { "row1": ["Tamsin"] } },
  "dialogue": { /* or keys into dialogue.json under a new "prologue" section */ }
}
```

All copy lives in `dialogue.json` (a `prologue` section) and `src/data/helpContent.js`-style
modules, not in code. The validator checks:
- map rows are rectangular and the legend resolves to terrain names
- spawns are in bounds and passable
- authored weapons exist and the class can wield them
- beats reference known triggers and actions
- `validateBattleConfig` passes for every chapter

### Pure engine: `src/engine/Prologue.js`

- `buildPrologueBattleConfig(chapter, terrain)` turns the ASCII map into a battle config with
  terrain indices from the `TERRAIN` order. It generalises `TutorialHelpers.buildTutorialBattleConfig`.
- `buildPrologueNodeMap(route)` returns a literal node map: ids, rows, edges, types, and
  `battleParams` with `prologueChapter`.
- `prologueBeatsFor(chapter, event, state)` is a pure trigger matcher. It returns the actions to
  run and needs no Phaser, so the harness and unit tests drive it directly.
- Join helpers. Gaspar comes from `createVeteranKnight`, unchanged. Tamsin is built from her
  authored spec, and Sera through `createLordUnit` at L1.

### RunManager

- A new serialized field, `mode: 'standard' | 'prologue'`. `fromJSON` defaults it to
  `'standard'`, so old saves are untouched.
- `startPrologue(gameData, prologueData)`:
  - sets the fixed seed
  - starts the roster as Edric alone
  - builds the literal node map
  - pre-locks every chapter config in `battleConfigsByNodeId`
  - disables Eclipse (`createEclipseState({ enabled: false })`, the existing switch)
- It reuses `act1` as the act id for its tables (enemy pools, deploy limits, music), to avoid
  the ~15 act tables a new id would need.
- **Boss completion branches on mode.** No boss recruit screen, no third lord, no `+1 Vision`,
  no `advanceAct`. It calls `completePrologue()` instead, which:
  - sets `meta.prologue = { state: 'complete' }`
  - pays the grant once (ledger flag)
  - clears the run save

### BattleScene: `PrologueController` (new; `create(scene)` / `destroy()`)

- Owns the coach, gates, highlights and notes, driven by `prologueBeatsFor`.
- Absorbs the reusable parts of `TutorialController`: the strict gate, forecast lessons,
  resource lessons and the lord-fall Vision grant. `TutorialController` is deleted when the
  prologue ships, not kept beside it.
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
- **Prologue defeat:** PostCombatController branches on `runManager.mode === 'prologue'`. It
  shows the "Not this thread" dialogue, then restarts the battle from its entry. The existing
  sanctioned "Continue from Map" revert does the work, and the scene re-enters the node.
  There is no RunComplete.

### Engine gaps to close (small)

- `addEnemyFromSpawn` honours an authored `weapon` (by name) and `skills: []`. Today weapons
  come from `pickEnemyWeaponTier` and level-5+ enemies may roll a skill.
- An authored recruit spec, where `buildRecruitNodeUnit` currently derives the level from the
  roster average, and an authored `npcSpawn` for Sera as a lord.
- Prologue-specific route map node titles ("Harrow's Market").

### Title, slot and meta

- **Fresh device:** the title's primary item becomes "Prologue · start here" (today it is
  Tutorial). New Game on a fresh slot asks Prologue / Skip, with the prologue highlighted.
- **Replay:** the Title item "Prologue" opens a chapter select. Replays run in a sandbox: a
  `RunManager` never written to the slot, no grant, and no meta writes.
- **Prologue in progress:** Continue resumes it. "Skip the rest of the prologue" in the pause
  menu jumps to the ending, then Home Base, with the grant.
- **After the prologue:** the first Home Base visit uses the existing `homebase_intro` and
  `homebase_begin` notes, plus one line: "This is what persists. Spend the Valor and Supply
  from the first thread." Begin Run then runs today's fast path (First Light, no blessing);
  only the Home Base skip goes away.

### Tests

- **Data:** the `validate:data` rules above.
- **Pure:** the battle config builder (exact terrain indices from hand-written maps), the node
  map shape, the beat matcher, and save round-trips of `mode`.
- **Harness:** for each chapter, the intended script wins with margin and a naive policy also
  wins. The P2 Jagen numbers hold: Gaspar's lance leaves the Archer at 2 HP and Edric's hit
  kills it. The P3 Sera numbers hold.
- **Persistence:**
  - Refresh mid-P3 resumes the battle.
  - Refresh on the route map resumes the map.
  - A prologue defeat restarts the chapter and never reaches RunComplete.
  - `runsStarted` and `runsCompleted` don't move.
  - The grant pays once, even across a refresh.
- **Flow:** Skip equals today's fast path exactly. A completed prologue's lesson ids are read
  in the first run.
- **e2e:** a new `prologue` lane plays P1 and P3 on desktop and in portrait, waiting on state
  (`tests/e2e/lanes.json`).
- **Harness safety:** for P1–P3, no enemy-phase sequence (hits and crits) kills Edric from the
  position the intended script leaves him. The Gaspar-only policy loses P2.

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
- A new NarrativeDirector `when` key, `prologue: 'complete' | 'skipped'`, lets the first real
  run open on a post-loop line:
  - Sera: "I know this road now. It ended once. It doesn't have to."
  - Edric: "Then we walk it again. Everyone count off."
- Skippers keep today's cold open.
- Gaspar's run-start intro line plays only when the prologue didn't already introduce him.

## 11. Phases

| Phase | Scope | Notes |
|---|---|---|
| 0 (this branch) | First Light: no villages in Act 1 rows 0–2. Gaspar's `guide_veteran_kills` note and help line. This spec. | Shipping now |
| 0b (optional, small) | Interim Sera fix in the current tutorial: a Sera-specific coach goal ("Sera strikes from 2 tiles, where melee can't hit back, and heals with her staff. Keep her behind Edric.") | Throwaway once P3 ships |
| 1 | Data format and validator, `Prologue.js`, spawn weapon overrides, `PrologueController` skeleton. P1 playable from the title, replacing the tutorial battle. | Delete `TutorialHelpers` |
| 2 | Run mode, the literal route map, P2, row 1 (fork, Tamsin, roster lesson), P3 | The bulk |
| 3 | Ruins, P4, the ending, Home Base handoff and grant, skip and replay flows. First-visit notes for whichever of Shop and Church the player skipped. | Story complete |
| 4 | Polish: prologue music picks (existing tracks, then optional cues), the ritual scene staging, copy pass against the lore guide | |

## 12. Open questions for the user

1. **Loop or carry-over** (§3). Recommended: the loop.
2. **Prologue by default?** Recommended: offered on every fresh slot with the prologue
   highlighted, never forced, and skippable mid-way.
3. **A fourth unit for the deploy lesson.** Tamsin is a prologue-only Archer. The alternative is
   deploying 2 of 3 (Edric plus one of Gaspar and Sera), which is a weaker choice and
   teaches less.
4. **The grant.** About one cheap upgrade of each currency (Lord upgrades start at 50 Valor,
   recruit upgrades at 35 Supply). Or nothing, and Home Base is only shown.
5. **Fork at row 1** (Shop or Church) versus a linear route that visits both. The fork teaches
   path choice; linear teaches both services.
