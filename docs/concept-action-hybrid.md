# Concept: FE Strategy Layer × Real-Time Action Combat

**Status:** Brainstorm / concept doc — not on the roadmap. Captured from a design discussion (Aug 2026).

## Premise

A tactical RPG in a modern 3D engine (visual/production reference: recent Switch FE titles, e.g. Three Houses). The strategy layer plays like Fire Emblem — grid maps, player/enemy phase, weapon triangle, growths, permadeath. Combat, instead of resolving as dice-and-numbers exchanges, zooms into a 3D real-time action arena — the Clair Obscur: Expedition 33 move, but with the action identity shifted from parry-centric toward Devil May Cry stylish combos plus soulslike dodging/rolling. Combos stay simple, but expressive.

Many Rogue Emblem mechanics transfer (classes, growths, weapon arts, skills, affixes, roguelike run structure). The known hard problem is combat repeatability, addressed below.

## The structural constraint: encounter volume

In FE, one "combat" is a single engagement, and a map has 30–50 of them. E33-style zoom-in combat works because JRPG encounters are few (8–15 per region) and each is the whole party vs a group. Zooming into an arena for every FE engagement means playing the same 45-second fight hundreds of times. Repeatability is not a gap to patch — it is the constraint the design is built around.

### Move 1: A zoom-in is a cluster engagement, not a duel

Engaging an enemy pulls in everything nearby — attack a soldier and that soldier plus adjacent enemies enter the arena together. The grid layer becomes about **engineering engagements**: isolate stragglers for easy fights, or accept a 1v3 to break a line this turn. FE positioning brain stays fully engaged; encounter count per map drops from ~40 to ~8–12. (Precedent from the other direction: Valkyria Chronicles — the hybrid works when the strategic layer sets up *situations*, not individual exchanges.)

### Move 2: Adjacency = assists (the grid↔action bridge)

Adjacent allies join the arena **as assist calls** (DMC / Astral Chain style), not as fully AI-controlled party members. Grid formation determines which assists are available in the action fight: archer adjacent → ranged assist on cooldown; healer within 2 → a heal charge. FE's core skill — formation and adjacency — becomes directly legible *inside* the action combat, and support/pair-up instincts port over nearly for free. Positioning before the fight is the strategy; positioning during the fight is the action. Same verb, two zoom levels.

## Translating the stat sheet

Guardrail (the E33 balance point): **defense is skill, offense is stats.** If execution can beat any stat deficit, levels/growths/loot economy stop mattering and the strategy layer becomes decorative. Damage numbers stay pure FE formula — a skilled underleveled unit can survive fights it shouldn't, but does 3 damage a hit, so the level economy still bites.

| FE mechanic | Action translation |
|---|---|
| Hit rate / Avoid | Not a dice roll — *enemy behavior*. Hit−Avoid difference controls attack stickiness (tracking, how easily enemies sidestep mid-combo). High SKL = combos connect; evasive enemies visibly slip your strings. Converts FE's most-hated RNG into something diegetic; preserves the tension without the coin flip. |
| SPD / doubling | Action economy: recovery frames, combo length before enemy pressure, possibly a stamina/momentum meter. SPD+5 survives as a legible breakpoint — outspeed by enough and enemies visibly can't punish your strings. |
| Crit | Earned, not rolled: a style meter (the DMC DNA) unlocks a cinematic finisher at thresholds. SKL fills the meter faster; LCK could govern meter drain on mistakes. |
| Weapon triangle | Stagger/poise interaction: advantage chips enemy poise faster and interrupts their attacks; disadvantage means they armor through yours. Readable in-action, no tooltip needed. |
| Weapon arts | The special-move list — HP-cost specials is already a DMC-ish economy. (Rogue Emblem has 75 to draw from.) |
| Skills | on-attack / on-defend / on-combat-start triggers become action procs; much of `skills.json` translates line for line. |

## Combat feel & references

Target: DMC's pace and offensive framing without its combo-lab input depth; none of Souls' wait-and-punish pacing. The useful axes are not "fast vs slow" but *animation commitment*, *who is performing*, and *where depth lives*.

**Take from DMC:** the conceptual inversion — you are performing, enemies are material. Right frame for generics, since most zoom-ins are fights already won strategically on the grid; the enemy's job is to be interesting to defeat. Also: attacks-as-components (generous cancel windows into dodge), movement/offense blurring, and the idea of a style grade. **Leave behind:** the fighting-game command system (lock-on directional modifiers, jump cancels, pause-timing strings) — execution depth we don't want in 20–45 second fights whose depth budget is already spent on the strategy layer.

**Take from Souls:** commitment as a *tunable dial*, not a philosophy — and put the dial on weapon Weight/Speed. Swords are fluid and cancel-anything; axes have Souls-flavored wind-up/recovery but hit like trucks; lances sit between with reach. The Souls-vs-DMC spectrum becomes *weapon identity*, giving the weapon triangle a feel dimension on top of the poise interaction.

**Core principle — depth lives in loadout, not execution.** DMC's depth is which animations cancel into which; ours is which weapon arts, skills, and adjacency assists you brought into the arena. Same expressive-offense feel, but composition happens at the prep layer, where FE players live. (Hades is the existence proof: trivially simple inputs, enormous build-driven variety, nobody calls it shallow.)

### Reference stack

| Game | What it contributes |
|---|---|
| **NieR: Automata** | Closest reference for generics: two-button combos, no memorization, fast, generous dodge with perfect-dodge counter reward — "DMC feel at 30% of the input complexity." Our skirmish mode, almost exactly. Also the soft auto-lock model. |
| **Bayonetta (Witch Time) / Ys (Flash Move)** | Perfect-dodge-triggers-offense-window as the defensive spine: defense is skill-expressive but its *reward is offense*, so the game never becomes wait-and-punish. Slots into the defense-is-skill / offense-is-stats rule: the dodge window is player skill; what you do with it is your stat sheet. |
| **God of War (2018)** | Combo-light, weighty — and Atreus: squad assists woven into solo action combat is our adjacency-assist system, shipped and proven. Study how assist calls feel like part of your offense rather than an interruption. |
| **Ys VIII/IX** | Pacing benchmark: encounters at exactly our target length; party damage-type swapping vs enemy weaknesses is structurally our weapon triangle; relentless forward tempo. |
| **Sekiro** | *Bosses only.* Posture is our poise/triangle mechanic taken seriously; its rhythm-duel intensity is the texture for the hard-boss tier — more aggressive than Souls, still deliberate. |
| **Hades** | Encounter length, dash-centric defense, and depth-from-buildcraft (boons ≈ weapon arts/skills) under minimal inputs. Roguelike pacing reference. |

### Control sketch

Light attack (cancellable) · heavy/launcher · dodge (perfect dodge → slow-mo offense window) · weapon art button (HP cost, committal — where Souls-weight lives on every weapon) · assist call(s) from grid adjacency · soft auto-lock. No manual jump; air states triggered contextually by launchers. Six meaningful inputs; everything else is loadout.

### Style meter grades tactical flair, not execution

Meter rewards perfect dodges, assist usage, weapon-art variety, triangle-advantage exploitation, no-damage streaks — not string length. Keeps the DMC grading-the-performance dopamine, pointed at things the strategy layer set up, tightening the grid↔arena connection. Deliberate failure-mode choice: a one-combo survival-focused player (the Souls-trained default) only misses style bonus, not the core system — the right failure mode for a strategy-first audience.

## The enemy ladder: pacing between generics and bosses

Risk: if generics play at NieR pace and bosses at Sekiro pace, the first boss is a genre change the player never trained for. Rule: **bosses never introduce new verbs, only new intensity.** Every boss demand — reading a telegraph, punishing a poise break, respecting a committal attack, handling adds mid-duel — is rehearsed at a lower tier first. The enemy ladder is a curriculum:

1. **Generics** — combo material, NieR pace, the player's performance space.
2. **Promoted units** — first enemies with real telegraphs and one attack you shouldn't tank. Teach "watch the enemy" without slowing the fight. Free from existing data (promoted classes), and FE players already read "promoted" as a threat flag.
3. **Affixed elites** — each affix maps to one boss-grammar mechanic (enrage timer, armor phase, punishable super). Affixes are visible on the grid pre-engagement, so the player *chose* the rehearsal — never an ambush.
4. **Minibosses / throne & leader units** — dress rehearsal: full arena tier, duel framing, a subset of the act boss's actual moveset. Seize maps provide these naturally — the throne unit was always a mini-boss; now it plays like one. Give act leaders literal moves from the act boss's kit so the player has fought its pieces before the boss door.
5. **Act bosses** — full Sekiro-lean setpiece assembling only previously-taught grammar at higher intensity.

Side benefit: the ladder gives the middle of each act texture — a rhythm of performance fights and test fights instead of "generics, generics, BOSS" — and maps cleanly onto the resolution tiers (generics auto/skirmish-eligible; promoted skirmish/full; elites and above always full arena).

## Enemy phase

Half of FE is enemy phase. If every enemy-phase attack triggers a zoom-in, the player plays dozens of defensive arena fights per map. Options:

- **(a) Auto-resolve** enemy-phase attacks via the forecast — counter stats do the work, keeping enemy-phase tank builds viable. **Preferred for generics.**
- **(b) Short defense-only interaction** — a single parry/dodge sequence, ~10 seconds, more E33 than DMC. Reserve for when an elite initiates on you.

Whatever the mix, counterattacks must stay profitable or the bait-and-counter pillar of FE strategy is deleted.

## Resolution tiers (the "fast mode" idea, formalized)

Three tiers, gated by the combat forecast — which becomes a load-bearing mechanic, not just information:

1. **Auto-resolve** — forecast dominance above a threshold (or generics N levels below you): instant, grid-level animation only. Keeps late-game maps fast. (Yakuza: Like a Dragon's trash-fight solution.)
2. **Skirmish mode** — contested generic fights: compressed arena fight, 20–30 seconds, simplified moveset, possibly an objective ("break poise before the timer").
3. **Full arena** — elites, affixed enemies, bosses, and any fight the player opts into: complete action combat, phases, soulslike difficulty for bosses.

Refinements:
- Players can always opt **down** (auto-resolve anything auto-resolvable), but opting **up** is rewarded: style-meter performance grants bonus EXP or a loot-quality bump. Playing fights manually is a wager, not a chore.
- Affixes are natural "worth zooming into" flags. Bosses as much harder action setpieces is where the soulslike identity lives; generics stay DMC-flavored power fantasy.

## Permadeath

Losing a unit to a flubbed dodge feels fairer than a 3% crit — action combat arguably makes permadeath *more* palatable. But risk concentrates in fights the player personally pilots rather than distributing across the roster via the map. Middle ground worth considering: losing an arena fight wounds/retreats the unit (out for the map, stat scar for the run), with true death reserved for Lord-down or explicit stakes — otherwise long runs end to execution variance in a way that feels cheap.

## Honest cost assessment

This is a different order of production from Rogue Emblem. 3D character action needs animation-heavy movesets per weapon type (eight weapon types = eight full kits), enemy AI with readable telegraphs, arena environments per biome, camera work, and hit-feel tuning — the most expensive genre per minute of content, and "simple but stylish" is harder than it sounds because stylish *is* depth.

The design itself is coherent — more than most SRPG/action hybrids — because the adjacency-assist bridge and the offense-is-stats rule keep the strategy layer causally connected to the action layer instead of being a level-select screen for it.

## Cheapest validation slice

Prototype **one** engagement loop:

- 6×6 grid; engage a 3-enemy cluster
- Zoom to a graybox arena with one weapon kit and one adjacency assist
- Forecast-gated auto-resolve available for the rematch

That single vertical slice answers the two make-or-break questions:
1. Does engineering engagements on the grid feel strategic?
2. Does the fiftieth skirmish still feel worth playing?

## What transfers from Rogue Emblem

- Class/promotion trees (`classes.json`), rolled growths → unique unit instances
- Weapon arts (`weaponArts.json`) → special-move kits
- Skill trigger system (`skills.json`) → action procs
- Affixes (`affixes.json`) → elite fights that flag "zoom in"
- Blessings, loot, roguelike run structure → run-shaping layer, unchanged in principle
- Combat formulas stay the damage backbone (offense-is-stats rule)
