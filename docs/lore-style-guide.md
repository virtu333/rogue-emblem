# Lore, Flavor & Voice Style Guide (v2)

The first variety pass fixed sentence *shapes* but kept one *voice*: a terse,
literary chronicler who says "old kingdom", "the empire", "court circle" and
ends on a wry inversion. Read 20 entries in a row and it is one person talking.

v2 changes the question from "how is this sentence built?" to **"who in this
world wrote or said this?"** Every blurb is a found text: a merchant's tag, a
quartermaster's ledger, a scratch on the haft, a margin note, a folk rhyme, a
drill sergeant, a rumor. The chronicler is still one of the voices — just no
longer the only one.

Applies to `lore` everywhere, and to all spoken lines (`dialogue.json`, incl.
the `unitVoice` section). Pure stat-line descriptions (skills, metaUpgrades,
affixes, `blessings.description`) stay plain — clarity beats voice there.

## Rule 1 — Register tracks rarity

The grand, mythic voice is *earned*. Common gear is common.

| Tier / kind | Default registers |
|---|---|
| Iron, basic consumables | practical, worn, funny, soldier's-eye, shop tag |
| Steel, issue gear | military bureaucracy, ledger, drill yard, supply complaint |
| Silver, fine gear | craftsmanship, provenance, prestige, collector's placard |
| Killer / Brave / slayers | reputation, rumor, grim advice, tavern claim |
| Legendary / relic | myth, chronicle, awe — the old literary voice lives here |
| Scrolls (arts) | margin notes, drill manuals, instructor asides, banned-book notices |
| Staves / Light | liturgy, triage notes, prayer, a tired healer |
| Accessories | former owners, provenance, small personal stories |
| Blessings | pilgrim sayings, shrine rules, prayers, a warning from a priest |
| Consumables | apothecary label, recipe, folk remedy, dosage warnings |

## Rule 2 — The voice palette (rotate; no voice > ~20% of a file)

1. **Plain / sensory** — what it looks, weighs, smells like. `Heavier at the tip than it looks, and it looks heavy.`
2. **Merchant / shop tag** — `Lightly used. Previous owner has no further need of it.`
3. **Ledger / requisition** — `Issued: 400. Returned: 212. See casualty roll, col. 3.`
4. **Carved / scratched / stamped text** — `Scratched into the grip: KEEP SWINGING, TOM.`
5. **Drill sergeant / instructor** — `Pointy end at the horse. Yes. Every time.`
6. **Folk saying / rhyme / children's song** — `Iron for the levy, steel for the line, silver for the lord who gets there in time.`
7. **Overheard exchange** (single quotes) — `'Is it cursed?' 'Only for whoever's in front of it.'`
8. **Letter / diary fragment** — `Mother, they gave me a lance. It is taller than me.`
9. **Scholar / catalog placard** — `Varen forge, second century. Hilt replaced three times.`
10. **Rumor / tall tale** — `Supposedly it once killed a dragon. Supposedly.`
11. **Warning label / instructions** — `Chew, don't swallow. Do not feed to horses.`
12. **Liturgy / prayer fragment** — `Lift them, and let me not be late again.`
13. **Chronicle / myth** — the old voice. Relics and legendaries only.
14. **Grim declarative** — one flat fact that lands hard. Sparingly.

## Rule 3 — Humor is allowed. Aim for one smile per four entries.

The world is dark; the people in it still joke, complain, and haggle. Dry,
character-driven humor (not winking, not modern slang, no memes, no fourth-wall
"RNG" jokes in item lore). A Vulnerary can be funny. Gae Bolg should not be.

## Rule 4 — Ration the tics of v1

- "old kingdom" / "the empire" / "court circle" / "seer(s)": **≤ 1 in 8 entries each.**
  The world can be implied by specifics (a place, a trade, a person) instead.
- Semicolon / em-dash antithesis ("not forgotten; it was spent"): **≤ 15%.**
- Punch-line reversal as the closer: **≤ 20%.**
- Opening on "A/An [noun]": **≤ 25%.**
- Cut decorative second clauses. One sentence is usually enough.

## Hard limits (enforced by tests)

- Item `lore` ≤ **85 chars**; class ≤ 160; boss ≤ 240; battlefield template ≤ 140.
- Single line, no `\n`. **No double quotes inside lore** (the UI wraps lore in
  quotes) — use single quotes for speech.
- `lore` must not equal `description`. Every item/class/boss keeps a non-empty lore.
- Spoken voice lines (`unitVoice`): ≤ **90 chars**, one line, no double quotes.

## Canon ledger — preserve these facts

- **Varen's mark / standard** — the smith-stamp on iron weapons, two centuries running.
- **Old kingdom vs. the empire** — the empire supplanted an older realm; kept its
  tools and drills, dropped its oaths.
- **The court circle** — the mages running the ritual. **The ritual / the summoning**
  — the catastrophe. **The sacred ground** — consecrated to keep something asleep;
  the ritual overfed it. **The Entity** — what sleeps there.
- **The Lieutenant** — the emperor's seer, Sera's rival; sees futures.
- **The loop** — runs are threads Sera re-weaves. Bosses half-remember dying.
  Ordinary soldiers may feel déjà vu. Keep it faint and rare.
- **One faith; the goddess's name "was spent"** — Goddess Icon's line keeps it.
  The seer order and its liturgy are that faith's remnant.
- **Geography**: act1 border & quarries (the Marches), act2 imperial provinces & roads,
  act3 the fens and sacred ground (the "Imperial Heartland"), act4 the Hearth and
  the capital on it, then below.
- **The mounted seal** covers horses AND fliers — say "mount", not "horse".
- **The berserk school**, **the dueling halls**, **the war colleges**, **the sky
  legions**, **the mountain clans** (wyverns), **border wardens** (rangers).

### The world bible

The full history now lives in [`docs/lore/`](lore/README.md). This guide
decides how things are *written*; the bible decides what is *true*. Before
writing lore, check the bible's facts; before inventing a fact, check it isn't
already there. The ledger's additions, briefly:

- **Names are the world's substance.** Every name is part of the
  goddess's spent name, her *change* (never state this; it is hidden canon). Names are kept
  by shrines, ledgers, iron, songs and soldiers' nicknames; spent by their
  holders; **fed** to the Sleeper by the empire. The world's scarcity of proper
  nouns is deliberate and diegetic: keep it.
- **The name gradient.** Proper names are common on the border (Act I), rare on
  the Roads (II: provinces are numbered), faded in the fens (III), absent at
  the Seat (IV). Write to it.
- **Imperial officers have no names.** They surrender them to the Roll on
  commission and answer to rank; every boss is a title for this reason. Don't
  give a boss a name in game text except through the name-return moment.
- **Two dating systems**: years *of the Oath* (O, border and faith) and *of the
  Seat* (S, imperial). The March is S 34 / O 646. The empire is 34 years old;
  the border fell 6 years ago.
- **The Sleeper** (the Entity) is the Stillness beneath the land: not evil, not a
  god, no voice. It hums. It breathes at the Glass in the fens and its heart
  beats under the Hearth, the mountain the Seat is built on.
- **The Eclipse** is the court circle feeding names from the Roll, seen as ink
  across the Hollow Sun. It is human work; keep it apart from the Sleeper.
- **The Lieutenant is "he."** In-world speakers who have never met him may stay
  neutral.
- **"Rogue dawn"** is the empire's broadsheet phrase for the warband: lights
  lit against the curfew. The warband adopted it.
- **Hagen** is the one character allowed to be openly loop-aware in common
  speech. He never explains why.

## Unit voices (level-up, promotion, last words)

Every recruit speaks with **class** (their trade), **traits** (their profile),
and a **temperament** derived per run (earnest, wry, grim, proud, nervous,
devout, mercenary, dreamer). Lords speak only in their own voices.

- Lines react to *what happened*: a perfect level, a blank level, a big stat
  jump, reaching Lv 10 or 20, learning a skill.
- Be truthful to the game: a Knight's speed jump is a miracle; a Mage gaining
  STR is suspicious; a Cleric does not fight.
- `{leader}` = the run's commander (recruit pools only). `{skill}` = the skill
  just learned. `{name}` = the speaker.
- The loop may surface as déjà vu ("I've felt this exact ache before."), rarely.

### Lord voice sheet

- **Edric** (Lord → Great Lord) — earnest banner-lord; counts his people; warm,
  plain, protective; never boastful; humor is gentle and self-deprecating.
- **Kira** (Tactician → Grandmaster) — chess and moves; dry, quick, confident,
  hates endings; treats growth as a better position.
- **Voss** (Ranger → Vanguard) — weary border warden; terse; "still standing";
  keeps a ledger of the dead; bleak humor.
- **Sera** (Light Sage → Light Priestess) — seer; threads and visions; gentle,
  a little eerie; rival of the Lieutenant; carries the loop's weight.
- **Rowan** (Chevalier → Holy Knight) — cocky rider who insists his luck is
  skill ("blessed lance — the aim's all me"); loves his mount; cheerful.
- **Astrid** (Sky Lancer → Seraph Knight) — loner of the sky legions; wind and
  distance; clipped; sees from above; quietly funny.
- **Cael** (Sentinel → Champion) — the wall; holds the line; deadpan; teases the
  back rank; stubborn as stone.
