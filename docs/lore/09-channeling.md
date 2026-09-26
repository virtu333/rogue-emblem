# 9 · Channeling the History into Play

How the world bible reaches the player. It is ordered from cheapest to most
ambitious, and each idea names the canon it serves, what the player sees, the
code it touches and what it costs. Engineering facts come from a survey of
the narrative code at `336cd41`. The survey's key constraints are
[at the end](#engineering-constraints).

## Principles

1. **Found, not told.** The history lives in objects, places, graffiti,
   half-heard lines and things that change when you come back. Nobody sits
   the player down. Elden Ring's method, in this game's voice.
2. **The name is the reward.** The world's physics is names ([01](01-cosmology.md#names)).
   The most satisfying unlock this game can give is a name coming back.
3. **Reactive over voluminous.** One line that notices what the player did
   beats ten that don't. The save already remembers bosses slain, who killed
   you, lord deaths, acts reached and difficulty. Use it.
4. **Tier III stays hidden.** Hints only. Players should be able to assemble
   the Dawn-in-every-name truth from ten fragments, and argue about it.
5. **Never touch battle RNG, loot draws or node generation for lore.** Derive
   from hashes and commit at victory.

---

## Tier 1 · Data only (no code)

Each is a `data/dialogue.json` or `data/*.json` edit plus `npm run sync-data`.

| # | Idea | Canon | What the player sees |
|---|---|---|---|
| 1.1 | **Reconciliation fixes** ([08 § Recommended edits](08-reconciliation.md#recommended-edits) #1, #2, #4, #7) | The three routes | Lunatic stops hearing a stronghold line after the Emperor is dead; Rowan stops dying as a flier; Normal's last transition mentions the Glass. |
| 1.2 | **The line bank** ([07 § Line bank](07-found-texts.md#line-bank)) into nodeFlavor, shopFlavor, churchFlavor and unitVoice | The name gradient, Hagen, the bells | Around 40 new lines that each point at the history: the bells ringing a name, the slow river, the chalked collar. |
| 1.3 | **Boss lore deepened** within 240 characters, each carrying one tier II fact | [05 § Antagonists](05-dramatis-personae.md#the-antagonists) | The Compendium's Foes tab gains history. E.g. Iron Captain: *"...He surrendered the Ford to save his wardens and paid with his name. He still eats with them."* |
| 1.4 | **Relic lore alternates** for Legend weapons that currently only gesture: Doomblade, Luce, Starfall, Ragnarok | [06 § Legendary arms](06-bestiary-and-relics.md#part-two-the-legendary-arms) | The rare-drop moment carries a piece of chronicle. Watch the Tome combat-FX coupling below. |
| 1.5 | **Déjà vu pool additions** that name things from the history without explaining them: the crow, the bells, the counting | The Sleeper's leaking memory | One in 24 level-ups now points somewhere. |
| 1.6 | **Voss's word.** Replace his Lv 20 line ("The old wardens had a word for it. I forget.") with a pair: forget it at Lv 10, remember it (*the Swallow*) at Lv 20 | Wardens' word for an eclipse | The same line, remembered ten levels later. |
| 1.7 | **Paladin and Cavalier lines** that say the fourth line aloud | The struck line | Recruits keep the Oath the empire deleted. |

**Checks:** `NarrativeScaffold`, `StorySlices`, `DialogueCast` (no literal
"Edric" in story lines), `UnitVoiceContent` (≤ 90 characters, no `"`),
`LoreContent` (budgets), `CombatFxFamilies` (Tome/Breath/Scroll lore changes
the effects), `npm run check:data-parity`.

---

## Tier 2 · Small engineering

| # | Idea | Canon | Touches | Size |
|---|---|---|---|---|
| 2.1 | **Template lore on desktop.** `describeLoomNode` already returns `lore` and `LoomPanels` drops it. Render it on the inspect card. | Every battlefield already has a line of history. | `LoomPanels.js` | S |
| 2.2 | **Seed the Loom's flavor pick with the run seed.** Today the same grid slot shows the same line every run (`stableIndex(node.id)`). | Different threads, different words. | `loomModel.js` | S |
| 2.3 | **Flavor pools for church, ruins and colosseum**, which the Loom currently shows blank | Chapels keep names; ruins are old-kingdom shrines; the Pit is "human, not imperial". | `dialogue.json`, `loomModel.flavorPool` | S |
| 2.4 | **New when-keys:** `lordFellBefore` (the save already stores `lordFalls` and nothing reads it), `partner`, `lastRunDifficulty`, `hasMilestone` | Lords remember losing each other; the cloth thickens after Lunatic. | `NarrativeDirector.js`, its two contract tests | S |
| 2.5 | **Title epigraphs** per key-art variant. *dusk*: "The goddess's name was not forgotten; it was spent." *rising*: "A dawn, made anyway." *ashfall*: "What is, remains. Not for long." | The title variants are chapters. | `titleVariant.js`, `TitleScreen` | S |
| 2.6 | **Lord bios.** Two sentences each from [05](05-dramatis-personae.md#the-seven-lords) on the commander picker and the Compendium Lords tab | Nobody currently tells the player who Cael is. | `lords.json` (new `lore` field + schema), `CompendiumOverlay`, the picker | M |
| 2.7 | **Eclipse narration.** On a phase change, a one-line beat from Kira (the arithmetic) or Sera (the corona). *"Umbral. Kira's sums say midwinter. I'd rather they didn't."* | The Eclipse is the feeding, and Kira knows the date. | `EclipseSystem`/`eclipseContent`, a new dialogue pool | S |
| 2.8 | **Village tales.** Saving a village plays one line: *"The chaplain writes the village's name in the book again. The ink takes."* A razed village gets the other line. | Villages keep names; Eclipse "Burned village". | `VillageController` (currently banner only), new pool; never use `Math.random` in battle | S |
| 2.9 | **Kindle as liturgy.** The Kindle confirmation reads a line of the Vigil of Lamps. | Kindle is a real rite. | `ChurchController`, pool | S |
| 2.10 | **The night before.** Home base gets a single fireside line on entry, keyed by `runsCompleted` and last result: Sera by the ember, the Ford below. | Home base is the fixed point of the loop. | New controller or menu surface; keep `HomeBaseScene` lean | S–M |

---

## Tier 3 · New systems

### 3.1 · Names Returned

*The signature system. Every boss is a title because imperial officers
surrendered their names to the Roll. Killing one gives the name back.*

**What the player sees.**
- The first time a boss falls on a save, after FOE VANQUISHED, a single
  line: **"The Roll gives back a name."** The name follows in Cinzel under
  the epithet: *ANDERS CARROW*.
- The Compendium Foes entry gains a **Name** line and a returned-name
  paragraph ([05](05-dramatis-personae.md#the-antagonists) has all of them).
  Until then it reads **Name: ———**.
- Some names come back only one way. That is where the easter eggs live:

| Boss | Returned when | Moment |
|---|---|---|
| Iron Captain | Slain | If **Voss** lands the blow: *"Anders. Stand down. You're relieved."* |
| Warchief | Slain | Not the Roll's: that night the hill clans sing *Skarde* from the ridge. |
| Knight Commander | Slain | If **Rowan** carries the **Phalanx Band**, he finds its pair on Leofric's arm. |
| Archmage | Slain | His notebook drops as a page ([3.4](#34--the-archmages-notebook)). |
| Dark Rider | Slain | The bag drops: [the Unopened Order](#the-unopened-order). |
| Blade Lord | Slain | *"Master, I'm sorry."* The name comes back with the apology. |
| Iron Wall | Slain | If the Unopened Order was delivered first, a different ending. |
| Berserker King | **Never by the Roll.** He threw his name away. | Visit **Hagen** later in the same run: *"Wat. Drove the salt run. Good with mules."* |
| The Emperor | **Never.** *Name: ———* permanently. | Compendium text: *"He fed it first. It is at the bottom."* |
| The Lieutenant | Only if **Sera** is deployed and alive when he falls | She says **"Tamlin."** The violin coda of his theme is her saying it. |
| The Entity | Never | *"Nobody ever gave it one."* |

**Build.** Persist as namespaced milestones (`name:iron_captain`) written at
the existing victory-time `recordBossSlain`, so they are never written
mid-battle. That gives cross-slot reads for free via `hasAnySlotMilestone`,
as the Foes tab already does. Conditional returns (Voss, Sera, Hagen) are
checked from battle facts at victory, or at the next shop visit for Wat.
**Size M.** Tests: `CompendiumOverlay.test` (counts, gating), a new content
test for the names table, and `BattleBeatsController` for the moment itself.

### 3.2 · The Chronicle (a codex tab)

*The history, found a page at a time.*

A new Compendium tab, **Chronicle**, holding about 40 **pages**. Each page is a
found text from [07](07-found-texts.md): an excerpt of the Oath, a page of the
liturgy, a ledger, a ballad verse, an edict, a letter. It unlocks from
deterministic events the save already records:

| Pages | Unlocked by |
|---|---|
| The Oath at the Ford; the counting rhyme | First run started |
| The Edict of the Roll; the curfew notice | Reaching Act II |
| The First Pages; the shrine posts | Reaching Act III |
| The Crown in the Wend (ballad) | A victory with Edric commanding |
| Voss's ledger, first page | Voss falls in any run (`lordFalls`) |
| The Middle Pages with the Archmage's marginalia | Archmage slain ×3 |
| The Lieutenant's letters | Lieutenant slain |
| The Last Pages, ending mid-sentence | Reaching the Entity |
| *(the last line of the Last Pages, completed)* | **Defeating the Entity.** The page that was always blank now has the rest of the sentence. |
| The skipping rhyme | 10 runs completed |

Locked pages show as "???" (the HomeBase pattern). New pages are listed on the
RunComplete screen beside "Deeds of the March", **after settlement**.

**Build.** A new data file `data/chronicle.json` (pages and unlock rules),
schema, DataLoader and `testData.js` entries. A tab appended to `TAB_DEFS`
(append-only: tab indices are tested) returning `referenceLines` items. Unlocks
are namespaced milestones or, for per-page metadata, a dedicated meta field
with union-merge in both `_adoptForeignDiskStateIfNewer` **and**
`CloudSync.applyMetaSlots` ([constraints](#engineering-constraints)).
**Size M.**

### 3.3 · Named places

*The name gradient as a thing the player feels.*

Each node on the Loom gets a place name, derived at display time from a hash
of run seed and node id over a per-act pool. The pools **follow the
gradient**: Act I places have real names (*Oathford, Birchwick road, the Cut,
Hollin barrows, Wendhall bluff*); Act II mixes old names and numbers (*the
Sallow road · Fourth Province*, *Toll-house 12*); Act III uses descriptions
(*the drowned village, causeway nine, the leaning stone*); Act IV uses none
(*a street*, *a gate*, *the ninth door*). Nobody explains it. A player who
notices the names draining out of the map has understood the world.

**Build.** Pure `nodePlaceName(runSeed, node, places)`. No save migration,
stable across resume and rewind. Show it as the Loom card title, in
`battlePlace()`, and on the slot card's "where". **Never** add draws to
`NodeMapGenerator`, which would shift every seeded map and the sim baselines.
**Size M.**

### 3.4 · The Archmage's notebook

*He is the one enemy who writes the loop down.*

After the Archmage has been fought three times on a save, defeating him drops
a Chronicle page generated from **the player's own history**: *"Rift 9. The
banner-bearer fell at [the act of your last defeat] to [the boss who killed
you]. The seer did not flinch."* Built from `storyFlags` (`defeatedBy`,
`lastRun`, `bossSlain`). The one moment the enemy shows he knows the player.
**Size S–M** once 3.2 exists.

### 3.5 · Hagen remembers

*"You always buy the same things."*

Hagen gets his own pool (`dialogue.hagen`, a sibling key, since
`shopFlavor.<act>` must stay an array) with variants that react to the save:
runs started, the last run's end, whether Sera is in the army ("Serafen.
Still Sera, I see."), whether the Berserker King died this run (the Wat
line). Optional cross-run memory of the most-bought item needs a small meta
counter. **Size S** (per-run) **/ M** (cross-run).

---

## Tier 4 · Cross-act easter eggs

The moments players will tell each other about. Each spans more than one
battle, and each rewards someone who has been paying attention.

### The Unopened Order

The Gentle King's order to fall back has been in the Dark Rider's bag for
thirty-four years ([05](05-dramatis-personae.md#the-dark-rider--the-fourth-rider)).

1. **Act II.** Kill the Dark Rider. The loot screen offers, as its own card, a
   **sealed dispatch, never opened**. Lore: *"Wax stamped with a crown. The
   courier never opened it. Neither should you."*
2. **Act III.** If the Act III boss is the **Iron Wall** and the dispatch is
   in the convoy, a new pre-battle exchange plays. Sera: *"I see the courier
   you never heard arrive. Here."* The Iron Wall reads his order, thirty-four
   years late. Then:
   - He **stands down** ("The walls fall... as they always fall... to you.")
     and the battle becomes a rout of his garrison; or, bigger,
   - he becomes a **boss recruit** (`BossRecruitSystem` exists): *"Forty men
     held that breach. I'll hold one more wall. Yours."*
3. The Compendium adds his returned name with the line *"The order has
   arrived."*

**Build.** A run-state key item (never loot RNG: it is granted by a specific
boss death at victory), a pre-battle variant keyed on a new run-state
when-key, and optionally a recruit path. **Size M.**

### The crown in the Wend

The Morning Crown lies in the river at the Ford **(III)**. The Iron Captain's
order closes the crossing.

- In Act I, **River Crossing** maps become Oathford on some threads (named
  places, 3.3).
- If the **Iron Captain is slain** and a later Act I battle is at Oathford,
  a unit who **ends a turn on a specific ford tile** in shallow water finds
  something in the gravel. The dispatch-style card: *"Gold, under the
  gravel. The river let go of it."*
- With Edric in the army: *"...I'm not putting it on. Not yet. Carry it for
  me?"* He will not be crowned (crowning spends a name). The crown rides in
  the convoy for the rest of the run.
- If the crown is in the convoy at the **Entity**, the finale adds one Edric
  line in the rally: *"Somebody should wear it who'll give it back. Not today."*
- An unlockable **Chronicle** page: *The Crown in the Wend*, with its last verse
  changed: *"...and somebody looked, and somebody tried."*

**Build.** A hash-selected tile on a hash-selected map, a run-state flag, one
card, a few variants. **Size M.**

### Smaller eggs

| Egg | Trigger | Moment |
|---|---|---|
| **Corrie's knot** | Voss equips the **Forest Charm** | A one-time Voss line: *"...That's her knot. That's Corrie's knot."* The charm's lore changes on that save to name her. |
| **The pair** | Rowan carries the **Phalanx Band** into the Knight Commander fight | Leofric's pre-battle line changes: *"Where did you get that? ...He taught you, then. Good. Come on."* |
| **Bess** | Rowan's farewell (see [08](08-reconciliation.md#people)) | The only time her name is said aloud. |
| **The watchword** | Edric and Cael both reach promotion in one run | Cael's promotion line: *"Promoted, not relieved. Different thing. I'll know the word when I hear it."* The watchword is *ember* **(III)**, and it should never be said in game. |
| **The bells** | Act III, Sera in the army, the Lieutenant not yet met | A node flavor line: *"The bells again. Twice, then twice. Sera stops walking."* |
| **The hum** | Sera in the army at a Hagen shop in Act III | Sera: *"He's humming the note that isn't in the hymn. Nobody can hum that note."* Hagen: *"Can't I?"* |
| **Kira's date** | Eclipse reaches Totality with Kira present | *"Midwinter. I did the sums in the hills. I was hoping I'd carried a one."* |
| **The chart** | Astrid promotes | *"From up here it looks like something sleeping. I've always thought so. Never said."* |
| **WE CAME THIS FAR ALSO** | Reaching the final act | A new carving appears after the player's first Lunatic clear: *NOT THIS TIME*, followed on later threads by the player's commander's name. |
| **Déjà vu, named** | A unit named after a unit who fell in a previous run | *"I feel like I've worn this name before."* (Needs `meta` in `voiceContext`.) |

---

## Tier 5 · Larger features the history now supports

| Feature | Canon basis | Notes |
|---|---|---|
| **Special characters** | Old Hessa (drill-mistress: Mentor's Band built in); Ansel the academy survivor (Magic Ring); Piers Tamm the Dark Rider (after the Unopened Order); Hagen as a one-battle cameo | ROADMAP's deferred "Special Characters". Each has a history already written. |
| **Oath promotions** (hidden classes) | Oaths need names, and deeds make names heavier ([01](01-cosmology.md#how-names-are-kept)) | E.g. a Ranger who has *the Last* promotes to **Warden of the Line**; a Cleric with *Lantern of the March* to **Lamp-Keeper**; a Sentinel who held a gate to **Gatewarden**. The design log already calls deeds "the seed of hidden promotions". |
| **New biomes with homes** | The Saltmarch (coastal), the Dry Country (desert), the peak-clan nests (caves) ([03](03-gazetteer.md#beyond-the-realm)) | Each conquered land has a history, a fed name and a reason to be on the route. |
| **Post-game: Naming the Sleeper** | **Luce** was written to name it; the Last Pages' final sentence; the deliberate mystery | Endless or Lunatic+ framing: the Sleeper stirs again, and this time Sera means to finish Luce. Does a named Sleeper die, or wake with a future? The game can finally ask. |
| **The Great Vigil** (event or mode) | The rite that never happened on the Unsworn Night | Every unit's name spoken at once: a defensive map where the objective is to hold shrines while the army "says its names". |
| **West of the Ford** | The March never goes downstream | A mirror campaign, or a later game. |

---

## Suggested order

1. **Slice 1 · data (one PR).** Reconciliation edits #1, #2, #4 and #7; the
   line bank; boss lore deepened; Voss's word. Only content tests are
   affected.
2. **Slice 2 · Names Returned + template lore on desktop.** The signature
   system on the smallest persistence footprint (namespaced milestones).
3. **Slice 3 · the Chronicle tab** with its first 20 pages, and the
   notebook.
4. **Slice 4 · named places, Hagen's pool, Eclipse narration, village tales.**
5. **Slice 5 · the Unopened Order and the crown in the Wend.**
6. **Later:** special characters, oath promotions, biomes, post-game.

---

## Engineering constraints

From the narrative-surface survey. Anyone implementing the above needs these.

- **Only story sequences can see save history today.** `NarrativeDirector`
  gates act transitions, boss lines and run-complete lines. Unit voice, quips,
  node, shop and church flavor, the rally and the Compendium cannot. Adding a
  when-key touches the context, `evaluateWhen`, `KNOWN_WHEN_KEYS` and two
  tests that pin the key list (`NarrativeDirector.test`, `StorySlices.test`).
- **RunComplete builds its context after settlement**, so the save already
  includes the run that just ended.
- **What the save remembers:** bosses slain and bosses that killed you (counts),
  `lordFalls` (written, never read), the last run's result, act, difficulty
  and killer, milestones, runs started and completed, and victory-only
  `runRecords`. Not remembered: recruits met, items found, deeds on defeats,
  places, Eclipse history of lost runs.
- **Never use `Math.random` in a battle for narrative.** In battle it is the
  battle RNG. Use `pickNarrativeLine` or a hash.
- **Never write meta mid-battle.** Battles rewind and revert. Commit at victory
  or at settlement.
- **Never add draws to node generation or loot for lore.** It moves every
  seeded map and the sim and harness baselines.
- **Tome, Breath and Scroll lore is read by the combat-FX picker**
  (`fxFamilies.fxFamilyIdForWeapon`). Rewording can change a spell's effect.
- **`shopFlavor.<act>` must stay an array.** Add sibling keys.
- **Compendium tabs are append-only.** Tests index them.
- **A new meta collection** must union-merge in `_adoptForeignDiskStateIfNewer`
  and `CloudSync.applyMetaSlots`, or entries are lost across devices. Keep it
  bounded.
- **`public/data/dialogue.json` must match `data/dialogue.json` byte for
  byte.** Run `npm run sync-data`.
- **Lore limits:** item ≤ 85, class ≤ 160, boss ≤ 240, template ≤ 140, voice
  ≤ 90, no double quotes, single line. `DeedSystem.test` caps deeds at 20.
