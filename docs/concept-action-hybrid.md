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
