# 8 · Reconciliation

Every contradiction the September 2026 inventory found in shipped text, art
notes, score notes and design docs, with a ruling and, where one is needed,
the edit. Most seams close without touching data, because the bible's history
already explains both sides. Recommended edits are collected in
[the table at the end](#recommended-edits).

---

## The three routes

**Problem.** Each difficulty walks a different act list (`difficulty.json`):

| Mode | Acts | Final boss |
|---|---|---|
| Normal | I, II, III, final | The Lieutenant, in the Sanctum |
| Hard | I, II, III, IV | The Emperor (Act IV boss ends the run) |
| Lunatic | I, II, III, IV, final | The Entity, in the Sanctum |

So Normal never sees the capital, Hard never meets the Lieutenant but is told
"the lieutenant is gone", Lunatic hears "The emperor's stronghold..." after
the Emperor is already dead, and `finalBoss_to_secretAct` and
`secretAct_start` never play.

**Ruling.** The difficulties are **different threads of the same March**, and
each thread's shape is canon. The difficulty taglines already say so.

- **Normal, "The road as it was walked."** The first thread Sera ever found. At
  the end of Act III the warband reaches the Hallow and goes **down through
  the Glass**. The far side of the Glass is the Sanctum under the Seat
  ([Cosmology](01-cosmology.md#the-hallow-and-the-hearth)), so they never cross
  the capital, and they meet the Lieutenant where he has always lived. His
  epithet is literal. Killing him blinds the empire; the Sleeper still stirs.
  "Something deeper still stirs."
- **Hard, "The empire answers in kind."** Threads where the Emperor sees the
  warband coming. When the Lieutenant's champions fall (the Act III boss), the
  Emperor **spends his own seer** to complete the Great Feeding before the
  warband can reach the Glass. The Lieutenant is "gone". Kira's line is exact:
  "Then the emperor has moved ahead of his own seer." The ritual is completed
  and the warband must go to the Seat overland (Act IV). The Emperor tells them
  they killed his seer ("You think you've won something by killing my
  seer?"). It is the lie he needs. Killing him breaks the ritual, "mostly":
  the Sleeper is overfed and his hand is off the leash.
- **Lunatic, "Every thread drawn taut."** The Hard thread, carried one step
  further. With the Emperor dead, nothing holds the overfed Sleeper. The ground
  shakes; the warband goes **down the stair** under the palace to the
  Sanctum, and past it into the Deep.

**Edits.**
1. Add a `difficulty: "lunatic"` variant to `actTransitions.act4_to_finalBoss`
   that uses the unused `finalBoss_to_secretAct` text ("Wait - the ground is
   shaking. The ritual fed it too much. It's waking up. We have to go down
   there. Now.") in place of the stronghold line. Variants are matched top-down
   and `difficulty` is already a known when-key.
2. Optionally add a Normal-only variant to `act3_to_finalBoss_normal` that
   mentions the Glass, e.g. Sera: *"The Glass. He's on the other side of it. He
   always has been."*
3. Retire `finalBoss_to_secretAct` and `secretAct_start` from the GDD's
   sequence, or keep them as the text source for (1).

---

## Geography

**Problem.** `regions.json` calls Act III the "Imperial Heartland" while all
Act III content is the fens; the Act III map *Dark Champion Keep* guards "the
last road into the imperial heartland"; Act IV is "Ashen Frontier" but its
dialogue is the capital; the score calls Act IV "Night on the Empire's
heartland"; `ACT_CONFIG` has a third set of names.

**Ruling.** No change to `regions.json`.
- The **Imperial Heartland** is the fens: crown demesne, the old kingdom's
  heart, closed since S 25. *Dark Champion Keep* is the Lieutenant's keep at
  the fen's edge, guarding the causeway **into** it; it sits in Act III as
  its gate.
- The **Ashen Frontier** is the Hearth massif, with the capital on its
  shoulder and frozen passes behind. It is a frontier because the peak clans
  and the Dry Country lie past it, and because to the seers it is the edge
  of the Deep.
- **The Imperial Seat** (the final act) is the palace and what lies beneath it.
- `ACT_CONFIG` names are internal and never shown; leave them.

**Edit.** In `tools/music/SCORE.md` and the Ashfall score docstring, "Night on
the Empire's heartland" would read better as "Night on the Hearth". Cosmetic
only.

**Where the Entity sleeps** (fens, or under the capital): both. The Glass is
its breath, the Hearthstone its heart; the Sleeper's body lies between them.
The two are the same opening seen from two ends ([Cosmology](01-cosmology.md#the-hallow-and-the-hearth)).

**Mire templates in Acts II and IV.** The fens creep west down the Wend and
the Hearth's foothills are boggy. Fine as shipped.

---

## Time

**Problem.** The conquest reads as both recent ("This border belongs to the
empire *now*", "new terms", a young Edric, Cael's gate "years ago") and old
("Twenty years on the border", "held the dark back for decades", a household
crest "older than the empire").

**Ruling.** Two conquests, 28 years apart. The empire took the kingdom's core
on the Unsworn Night (S 0) and has held it for 34 years. The Marches held out
as the Border Crown until the Second Push (S 28–30), six years ago. The border
is the empire's "now"; the empire is decades old. The Iron Captain and Voss
have both been on the border twenty years, as sworn brothers, on different
sides for the last six. See [02](02-chronicle.md#master-timeline).

---

## People

| Seam | Ruling | Edit |
|---|---|---|
| **The Lieutenant's gender.** "He" in `enemies.json` and the score; "they" in the GDD; neutral in dialogue. | He. Born Tamlin, a fen novice. The dialogue's neutrality is in-world: nobody who talks about him has met him. | Update GDD §2.2 to "he". Leave dialogue neutral. |
| **The Lieutenant is a Hero, not a seer class.** | He was trained with the sword from eleven by the Blade Lord. He is both. | None. |
| **Whose "master" does the Blade Lord mean?** | The Lieutenant, his pupil. The pupil became the master. | None. |
| **The Lieutenant's "my master"** | The Emperor. | None. |
| **Iron Wall: imperial or old kingdom?** | Old kingdom. Bertil Stane, royal knight, held the Breach at the old capital at the Nine Days. The empire captured him and adopted him and his stand. | None. |
| **"The old capital" vs "the capital."** | Two cities. The old capital is the ruin at the eastern end of the Roads; the capital is the Seat on the Hearth. "The siege of the capital" (Bolting) and "the east gate held nine days" (Last Bastion) are the Nine Days at the old capital. | Optional: Bolting could say "the old capital". |
| **"Warden" on both sides.** | The Iron Captain was a border warden. His imperial title *Warden of the March* is the empire's theft of the wardens' word. | None. |
| **Kira's schooling: "academy" (GDD) vs "war colleges" (dialogue).** | The war colleges, specifically the Ford College. The academy is the mages'. | Update GDD §2.5. |
| **Voss "I brought an axe" before promotion.** | He carries a woodsman's axe for doors and has since Birchwick. Promotion makes it his weapon. | None. |
| **Rowan's farewell reads like a flier's** ("The sky was beautiful from up there. Keep looking up."). | A slip. Astrid's line. | Replace with a Rowan line. Canon suggestion: *"Her name's Bess. Say it to her. Somebody should."* The one time he says his mare's name aloud ([05](05-dramatis-personae.md#rowan--the-blessed-lance)). |
| **Edric: "Power stolen from a sleeping god. We're here to return it."** Clashes with "the liturgy has no name for it". | Keep. The power the Emperor stole is the Dawn's, fed to him one name at a time. The Dawn sleeps in every name. Edric is more right than he knows. | None. |
| **Edric to the Entity: "we end the cycle here."** | Sera has told him about the threads. He is the one person she tells. | None. |
| **The act2→act3 sacred-ground line is Edric in base and early variants, Sera in the commander defaults.** | Either works; `DialogueCast` recasts anyway. | Low priority: pick one speaker for consistency. |
| **Hagen's trembling hands** vs his breezy finalBoss line. | Not every merchant is Hagen. Caravans and stall-keepers exist. The trembling one isn't him. | None. |
| **The Emperor scorns visions but says "The ritual showed me your corpse".** | He hears the hum and does not call what it shows him *visions*. | None. |

---

## Institutions

| Seam | Ruling |
|---|---|
| **War colleges closed, yet "the war colleges still teach" the Knight Commander's doctrine.** | The free colleges were closed in S 2 (the border's in S 28). One Imperial War College remains in the Seat and teaches the *Doctrine*. Its graduates say "the war colleges" out of habit. |
| **Paladin oath's fourth line "hummed" vs "struck".** | Both. The Edict struck it; paladins hum it. |
| **"The crown" under an emperor** (Archer: "I owed the crown a quiver this season"). | The yeomanry of the Marches owed the Border Crown, and some still count it owed to Edric. |
| **Border clans vs mountain clans.** | Two peoples: the hill clans (Warchief, south-west, blood-song) and the peak clans (wyverns, north-east, the moot). [04](04-powers.md#the-clans). |
| **Berserker King "crowned" vs "The clans crown no kings."** | He is not a clansman. He was crowned by his school at the fens' edge. |
| **"The March" as an authority** (CROSSING CLOSED BY ORDER OF THE MARCH). | The imperial border administration under the Warden of the March. Also, deliberately, the warband's word for the run. |
| **"Every kingdom this land has had"** (Dragon Lord). | The barrow kingdoms before the Oath, the old kingdom and the empire. |

---

## The metaphysics

| Seam | Ruling |
|---|---|
| **Who drives the ritual: Emperor and Lieutenant (GDD) or the court circle (lore)?** | The circle performs it; the Emperor commands it; the Lieutenant defends it by sealing futures. |
| **The ritual "completed" (act3→act4), "already done" (Lieutenant), "broken... mostly" (Hard win), and still waking after the Emperor dies.** | One timeline: the Great Feeding has been running since S 25. On Hard threads it is completed by spending the Lieutenant. Completion does not wake the Sleeper; it makes it heavy and near, held on the Emperor's leash. His death breaks the leash (the ritual is "broken"), and on the tightest thread the Sleeper wakes. |
| **The Emperor as awakener and restrainer** ("I held the dark back for decades"). | Both are true. Feeding kept it quiet and made it heavier. |
| **Source of the rifts: Sera (Archmage), the Lieutenant (GDD) or the ritual (Emperor)?** | A rift is the circle's word for a cut thread. Sera's threads are cut (the Archmage is right), the Lieutenant cuts them (the GDD is right), and they fall into the Sleeper the ritual feeds (the Emperor is right). |
| **The goddess vs "a sleeping god".** | Two sleepers: the Dawn within, the Stillness below. Keep the phrase *sleeping god* for the Dawn or for loose talk; the liturgy never calls the Sleeper a god. |
| **Dragons slept below the sacred ground; so does the Entity.** | The dragons lie *on* the Sleeper, as the stones of the Hallow. They are its lid, and now its lid is waking. |
| **What the loop is: Sera discarding futures (GDD) or a literal time loop with a keeper (Chronophage spec).** | Sera walks threads of one year. Cut threads fall into the Sleeper, which keeps them; that is why memory leaks. There is no separate keeper. Sera keeps the loom and the Sleeper keeps the scraps. The Chronophage concept is retired; its best idea, "the cycle has a keeper", survives as Hagen, who has walked more threads than Sera. |
| **The Lunatic win says "The cycle is broken", but the next runStart says "the wound beneath is not closed".** | "A single thread holds nothing. A cloth holds." ([01](01-cosmology.md#why-winning-does-not-end-it)). Later threads thicken the weave. **Edit:** a `lastRunDifficulty` when-key (the last run's difficulty is already stored in `storyFlags.lastRun`) would let runStart say so after a Lunatic win. |
| **Hagen's loop-awareness exceeds "faint and rare".** | Hagen is the stated exception. He drowned in the Glass twice. |
| **The Eclipse vs the Entity (the score keeps them apart).** | The Eclipse is the court circle's feeding, human work with a human bell. The Entity is what is being fed. |
| **Real-world relic names** (Excalibur, Gae Bolg, Ragnarok, Delphi, Luce...). | Old Tongue words that sound like other-world myth by coincidence. Don't rename them. Give them in-world glosses when lore needs one ([06](06-bestiary-and-relics.md)). |
| **Chronophage, Temple of Fate, Throne of Corruption, Temporal Guardian** (older GDD names). | Retired. The Sanctum is the throne; the Hallow is the temple. |

---

## Small data notes

- **Ansel and Mira** (Magic Ring) share names with the recruit pool. Harmless;
  a recruit named Ansel carrying the Magic Ring is a found coincidence. Leave it.
- **`deeds.json` maps the Throne tile to "the Gate".** Canon-safe: the throne
  room of the Seat opens off the palace gate.
- **CLAUDE.md content counts are stale** (weapons 130, templates 23, skills 56,
  weapon arts 83). Not lore; noted for whoever next edits it.

---

## Recommended edits

| # | Edit | Where | Size | Priority |
|---|---|---|---|---|
| 1 | Lunatic variant of `act4_to_finalBoss` using the descent line | `data/dialogue.json` | S | High: it currently plays a stronghold line after the Emperor is dead |
| 2 | Replace Rowan's flier farewell | `data/dialogue.json` `lordFarewell.Rowan` | S | High: out of character |
| 3 | Canon ledger additions and name rules | `docs/lore-style-guide.md` | S | High (done in this change) |
| 4 | Normal variant of `act3_to_finalBoss_normal` naming the Glass | `data/dialogue.json` | S | Medium |
| 5 | `lastRunDifficulty` when-key, and a post-Lunatic runStart variant | `NarrativeDirector.js`, tests, `dialogue.json` | M | Medium |
| 6 | GDD §2.2 and §2.5 notes (Lieutenant "he"; Kira's college) | `docs/gdd/gdd_difficulty_narrative_v2.md` | S | Low |
| 7 | One speaker for the act2→act3 sacred-ground line | `data/dialogue.json` | S | Low |
| 8 | "Night on the Hearth" in the Ashfall note | `tools/music/SCORE.md` | S | Low |
