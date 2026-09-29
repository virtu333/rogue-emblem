# Spec: The Veteran Knight (Jeigan archetype)

**Status:** Proposed. Backlog: not scheduled until the balance questions in *Open questions*
are answered and the sim gates in *Validation* pass.
**Size:** Medium. Mostly data plus one new creation path. No combat or XP formula changes
in v1.
**Working name:** Gaspard, `specialChars` id `old_knight` (placeholder; not in the recruit
`namePool`, not a lord).

## Intent

Fire Emblem's Jeigan: a veteran who joins already promoted. His starting stats are good,
but he gains almost no XP and grows almost nothing. He carries the opening and then fades.

Why this game wants him:

1. **A different run shape.** A run can lean on a strong starter and never touch the meta
   tree. The "Meta Upgrades: OFF" toggle already exists but only takes power away; the
   veteran lends some back that does not grow.
2. **The early game is hard with two units** (`docs/design-log.md`, 2026-07-04). That
   difficulty is the root of the "funnel everything into Edric" habit. A third competent
   body in Act 1 addresses the root, not the symptom.
3. It is the first entry of the long-planned *Special Characters* item
   (`ROADMAP.md`, Wave 10: `data/specialChars.json`, named units with fixed growths).

Design targets, from the request:

- The **Iron Sword** (light) lets him double, and so kill outright, a good share of Act 1
  enemies.
- The **Steel Lance** (heavy) slows him too much to double. He wounds most early enemies but
  does not one-shot most of them.
- **Low HP / DEF**: he cannot tank a group.
- **Very low growths.** Home-base growth upgrades reach him at half strength.
- He must **not trivialize First Light (Normal)**.
- He must not turn safe "chip, then let Edric finish" play into a runaway Edric.

## TL;DR of the proposal

| Decision | Proposal |
|---|---|
| What he is | A **recruit-tier named unit** (`isLord: false`), built from a new `data/specialChars.json` entry. Not a lord. |
| How he is offered | A run-start **option at Difficulty Select**, next to the Meta toggle. Default **off**; baseline balance is untouched for anyone who does not take him. |
| Class / level | Paladin, promoted tier, level 1 (XP-effective level 13). |
| Stats | A hand-authored line **per difficulty rung**, so his *role* stays constant as enemies scale. Normal: HP22 STR11 SKL7 SPD10 DEF4 RES2 LCK3 MOV6. |
| Weapons | Steel Lance (**equipped**) + Iron Sword. The player chooses to draw the sword on player phase. |
| Growths | Fixed, not rolled: HP15 STR10 MAG0 SKL10 SPD10 DEF5 RES5 LCK5 (about 1.1 stat points a level). |
| XP | **No new XP code.** The existing promoted +12 effective level already gives him 1 XP per action against every enemy up to level 8, i.e. all of Acts 1–2. |
| Meta | Growth bonuses at **×0.5** (as asked). **No** meta flat-stat bonuses and **no** recruit join perks. Details in *Meta and blessing interactions*. |
| Kill feeding | Leave XP rules alone. The existing diminishing-XP tiers bound how far feeding can push Edric. Neutralise three side effects the veteran *would* cause (recruit-node levels, revival catch-up, sim deploy order), then measure. |
| Black Sun | **Not offered in v1.** No sensible Iron Sword line holds the archetype there (see *Balance numbers*). |

## Current state (verified)

Everything below was read or run against the code on this branch. "Ran" means the number
comes from the real engine functions (`createEnemyUnit`, `generateBattle`,
`getCombatForecast` / `resolveCombat` with skill context, `calculateCombatXP`, `levelUp`)
in ad-hoc scripts. Those scripts are not committed; the implementation PR adds a
reproducible sim.

### A near-identical unit already exists

The Vanguard Cadre meta upgrade (`extra_starting_unit_pool`) at tier 4 can roll a Paladin.

- Pool and creation:
  - `EXTRA_STARTER_CLASS_POOLS[4]`: `src/engine/RunManager.js:124-129`
  - `_createExtraStartingUnit`: `RunManager.js:2731-2799`. It builds a level-1 Cavalier via
    `createRecruitUnit`, then calls `promoteUnit` into Paladin.
- Loadout, `_applyExtraStarterPaladinLoadout` (`RunManager.js:2592-2607`): Iron Sword +
  Steel Lance, Steel Lance equipped.
- Result: HP23 STR8 MAG1 SKL6 SPD7 DEF8 RES4 LCK4 MOV6.
  - Growths are the full rolled Cavalier ranges (HP 65-80, STR 40-55, …) plus meta.
  - Construction is unseeded (`Math.random` for class, name and growths).
  - `BlessingSelectScene._rebuildRunManager` calls `startRun` again, so the unit can
    re-roll.
- This is the creation template. The veteran differs in:
  - authored stats and growths
  - determinism
  - meta handling
  - identity

### Class data

- The Paladin (`data/classes.json`) has no `baseStats` and no `growthRanges`, only
  `promotionBonuses` (HP+3 STR+2 MAG+1 SKL+1 SPD+1 DEF+2 RES+2 MOV+1).
- Other class facts:
  - `promotesFrom: Cavalier`
  - `learnableSkills: ride_down @10`
- Class-innate skills, in `data/skills.json`:
  - `aegis`: halves magic damage, SKL% chance
  - `canto`
- `createLordUnit` hardcodes `tier: 'base'` (`src/engine/UnitManager.js:245-248`), and
  `schemas/lords.schema.json` has no notion of a pre-promoted lord.

### XP

- `getXpEffectiveLevel` (`UnitManager.js:1087-1090`) is `level + 12` for promoted units.
- `calculateCombatXP` (`UnitManager.js:1092-1115`) returns `XP_MIN = 1` when the attacker is
  7+ effective levels up.

Ran, XP per action ("kill / non-kill"):

| Veteran level ↓ / enemy level → | 1–8 | 10 | 12 | 15 | 17 |
|---|---|---|---|---|---|
| Promoted L1 | 1 / 1 | 25 / 10 | 35 / 20 | 50 / 35 | 60 / 45 |
| Promoted L5 | 1 / 1 | 1 / 1 | 1 / 1 | 30 / 15 | 40 / 25 |

- Act 1 enemies are levels 1–3 and Act 2 are 3–8 (`ACT_LEVEL_SCALING`,
  `src/engine/NodeMapGenerator.js:20-25`). So through Act 2 he levels only from:
  - roughly 100 actions per level, and
  - team XP from gold loot picks (`LOOT_GOLD_TEAM_XP` = 25, `src/utils/constants.js:239`).
- Level-ups always give at least one stat (`levelUpFallbackStat`, `UnitManager.js:979-991`),
  going to the highest-growth stat.

### Kill credit and XP sharing

- Kill credit (`combatXpAwards`, `src/engine/BattleXp.js:41-90`): the killer gets full kill
  XP whoever did the chip damage. There is no assist split.
- Mentor's Band (`src/engine/XpShare.js:32-58`) shares to adjacent allies at a *strictly
  lower* effective level. Each ally gets half of the XP their own formula would earn.
  - A level-1 veteran (effective 13) is above every base-tier unit, so Edric receives
    shares from his fights until Edric promotes.

### Levels that read the roster

- **Recruit-node join level** (`resolveRecruitNodeLevel`,
  `src/engine/RecruitNodeSystem.js:176-204`):
  - It averages the top-N roster units, counting promoted units as `10 + level`.
  - A level-1 veteran counts as 11. Example: Edric 1, Sera 1, veteran 11 averages to 4, not
    1.
- **Revival catch-up** (`src/engine/RevivalCatchUp.js:13-45`) targets the living roster's
  average effective level.
- **Boss recruits and Colosseum** anchor on the commander (`RecruitScaling.js`), so they are
  unaffected.

### Enemies and deployment

- `restrictOpeningCavaliers` (`src/engine/EarlyEnemyRules.js:4-11`) keeps Cavaliers out
  while roster + fallen < 3 on Normal Act 1. A third starter lifts it from battle 1.
- Enemy count scales with deployed units (`MapGenerator.js:130, 2113-2145`).
- `DEPLOY_LIMITS.act1 = {min: 3, max: 4}` (`constants.js:67-74`). So he always deploys until
  the roster reaches 4, then competes for a slot.

### Meta and blessings

- Meta flat stats and growths reach non-lords through `createRecruitUnit(..., statBonuses,
  growthBonuses)`. Difficulty already scales growth bonuses (`growthBonusMultiplier`
  1 / 0.9 / 0.8 / 0.5 in `data/difficulty.json`; `RunManager._scaleGrowthBonuses`,
  `RunManager.js:4078-4091`).
- Run-start blessings apply to whatever is in the roster *after* it is built:
  - `_applyGrowthDeltaToUnits`: `RunManager.js:834-844`
  - `_applyTargetedGrowthDeltaToUnits`: `RunManager.js:846-857`
  - `_applyStatDeltaToUnits`: `RunManager.js:807-822`
- No-meta mode:
  - Toggle: `DifficultySelectScene.js:451-466`
  - It nulls `metaEffects` (`BlessingSelectScene.js:94-103`) and persists `noMetaMode`
    (`RunManager.js:4289, 4888`).
  - It changes no payout, milestone or record.

### First run and tutorial

- The first-run fast path (`src/utils/firstRunFastPath.js`) skips Difficulty Select. A
  brand-new player never sees the option on run 1.
- The tutorial builds its own roster (`TutorialHelpers.js:40-60`) and is unaffected.

## Design

### 1. Identity: a named recruit-tier unit, not a lord

A lord entry would bring four costs:

- a schema change, since there is no pre-promoted lord
- an eighth voice sheet, finale-rally entries, farewell and recruit lines, plus
  `lord_<name>` portraits and sprites (count-locked in `tests/TracedSprites.test.js:77-85`,
  `UnitVoiceContent.test.js:104`, `FinaleRally.test.js:47`, `DialogueCast.test.js:104-109`)
- Talk and Seize rights, and a duty to reach the escape tile
- a leak into the third-lord, boss-recruit and recruit-node lord pools (`getAvailableLords`)

A recruit-tier unit gets permadeath, church revival, last words and the Paladin class
voice with no new plumbing. That is the right tier for a unit designed to fade.

He is still *named and fixed*:

- a fixed name
- a pinned portrait variant (one of the existing Cavalier/Soldier faces; a bespoke face is
  a later art task)
- a pinned temperament

The veteran flavour already exists in class voice: `recruitLines.Paladin` has "Three
campaigns, two mounts, one oath…".

**New data: `data/specialChars.json`** (+ schema, + `public/data` sync), one entry for now:

```json
{
  "id": "old_knight",
  "name": "Gaspard",
  "archetype": "veteran",
  "className": "Paladin",
  "baseClass": "Cavalier",
  "level": 1,
  "baseStats": { "HP": 22, "STR": 11, "MAG": 0, "SKL": 7, "SPD": 10, "DEF": 4, "RES": 2, "LCK": 3, "MOV": 6 },
  "statDeltasByDifficulty": {
    "normal": {},
    "dusk": { "STR": 1 },
    "hard": { "HP": 2, "STR": 4, "SKL": 1, "SPD": 1, "LCK": 1, "RES": -1 },
    "lunatic": null
  },
  "growths": { "HP": 15, "STR": 10, "MAG": 0, "SKL": 10, "SPD": 10, "DEF": 5, "RES": 5, "LCK": 5 },
  "inventory": ["Steel Lance", "Iron Sword"],
  "equipped": "Steel Lance",
  "metaGrowthScale": 0.5,
  "portraitVariant": "cavalier_c",
  "temperament": "grim",
  "traits": ["old_guard"],
  "classMastery": false,
  "countsTowardRosterLevel": false
}
```

About `statDeltasByDifficulty`:

- A `null` rung means the veteran is not offered on that rung.
- Every rung key must be present, per the CLAUDE.md rule for difficulty-keyed tables.
- The schema should require all four keys (`DIFFICULTY_IDS`) so a future rung cannot
  silently miss an entry.

### 2. How he is offered

A run-start option, **"Veteran: ON/OFF"**, on Difficulty Select beside "Meta Upgrades:
ON/OFF":

- Default is off. It is independent of the Meta toggle; all four combinations are legal.
  "Meta OFF + Veteran ON" is the "win without meta" run the request describes.
- It is hidden, or shown locked, on rungs whose delta is `null` (Black Sun in v1).
- It persists on the run as `veteranMode: boolean`, defaulting to `false` for old saves,
  exactly like `noMetaMode`.
- It is recorded on the run record so history can show "with the Veteran".
- It is offered from the second run on. The fast path skips the screen on run 1 anyway, and
  a crutch is most useful to a player who has just lost once.
  - No milestone gate is proposed (see *Open questions*).

Alternatives considered:

- Always present: this rebalances every run, which is the outcome the request wants to
  avoid.
- A blessing: this competes with blessings and needs a new effect type. BlessingSelect also
  rebuilds the RunManager.
- A meta purchase: this contradicts the point of "win without meta".

A blessing is a reasonable second delivery channel later.

### 3. Build path

- A new `createSpecialCharacter(def, { difficultyId, metaEffects, rng, gameData })`
  lives in a new pure module `src/engine/SpecialCharacters.js`. `RunManager` should not
  grow further (CLAUDE.md, *God Objects*).
- The flow copies `_createExtraStartingUnit` (Cavalier template, then `promoteUnit` into
  Paladin, so `baseClass`, promoted mastery and class innates are all canonical), then
  **overwrites**:
  - `stats` = `baseStats` + the rung's delta
  - `growths` = `growths` + (meta growth bonuses × difficulty `growthBonusMultiplier` ×
    `metaGrowthScale`), rounded like `_scaleGrowthBonuses`
  - inventory and equipped weapon from the entry
  - `traits` = the entry's list. No `rollAndApplyTraits`, so no random Hardy +3 HP.
  - `specialCharId = 'old_knight'`
- It is **fully deterministic**: no rolls at all, so a `startRun` rebuild yields the same
  unit.
- `createInitialRoster` appends him after the lords, when `veteranMode` is on and the
  rung is not `null`. He is placed before any Vanguard Cadre starter, and the two stack.
- Save shape: `serializeUnit` is `{...unit}`, so `specialCharId` persists with no
  migration. `fromJSON` needs nothing: the lord-flag repair keys on lord names only.

### 4. Stats and weapons

Numbers are from the ad-hoc engine scripts. The Act 1 mix is the real `generateBattle`
level distribution, per class. "ORKO" is the chance to kill from full HP in his own
round, crits ignored. Survival counts fresh enemies attacking in a row with no healing.
Canto is *not* modelled; see the note below.

**Target band for every offered rung**:

| Measure | Target |
|---|---|
| Sword ORKO of Act 1 fodder | about 35–50% |
| Lance ORKO | 15% or less |
| Lance damage | 55–70% of the enemy's HP |
| Survives 2 enemy attacks | at least 85% |
| Survives 3 enemy attacks | about 20–40% |
| Survives 4 enemy attacks | 10% or less |

| Rung | Line | Sword AS / Lance AS | Sword ORKO | Lance ORKO | Lance % HP | Survive 2 / 3 / 4 |
|---|---|---|---|---|---|---|
| First Light | HP22 STR11 SKL7 SPD10 DEF4 RES2 LCK3 | 9 / 4 | 38% | 14% | 69% | 98 / 36 / 8% |
| Dusk | same, STR 12 | 9 / 4 | 37% | 15% | 68% | 93 / 31 / 7% |
| Nightfall | HP24 STR15 SKL8 SPD11 DEF4 RES1 LCK4 | 11 / 6 | 48% | 14% | 65% | 86 / 21 / 4% |
| Black Sun | (not offered) | — | — | — | — | — |

Survival figures are with the sword held.

First Light, by class:

| Enemy | Sword | Steel Lance | Hits him for (sword held / lance held) |
|---|---|---|---|
| Myrmidon | never doubles (AS 7–9); 66% HP | 68% ORKO (triangle) | 6.4 / 5.9; Myrmidon L3+ doubles him when he holds the lance |
| Soldier | doubles, 0% ORKO, 79% HP | 57% HP | 9.2 / 7.6 |
| Fighter | doubles, **100% ORKO** | 56% HP | 6.5 / **11.2** |
| Archer | doubles, 92% ORKO | 80% HP | 6.3 / 6.3 |
| Cavalier | doubles, 0% ORKO, 81% HP | 57% HP | 9.2 / 7.6 |

That is the requested shape:

- The sword kills axe users and archers outright and nearly kills everything else.
- The lance wounds everything except Myrmidons, which it kills through the triangle.
- Which weapon he *ends his turn holding* is a real decision. The sword is safe against
  axes, the lance against lances, and the lance invites Myrmidons to double him.

**Why the Steel Lance is equipped by default.** Lazy enemy-phase play then chips instead
of clearing. Auto-killing on the counter is how FE players over-use Jeigans. Killing with
the sword is a deliberate player-phase choice.

Tuning knobs, in order of use:

1. **STR** (11–13) moves sword ORKO. First Light at STR 13 gives sword 64% / lance 31%,
   which is too strong.
2. **SPD 10** is load-bearing: with STR 10–14 the Steel Lance is AS 4 and never doubles.
   At SPD 11 the lance doubles Fighters about 59% of the time.
3. **HP/DEF.** DEF 3 or HP 20 drops survival of 2 attacks to about 68%, which is
   too fragile.

Other stat decisions:

- **Skills:** class innates only (`aegis`, `canto`).
  - Strip `ride_down`, which is +3 ATK after moving 3 and would blow the sword band.
  - He will realistically never reach promoted level 10. The explicit strip also stops
    the base-line `sol` from arriving via `checkLevelUpSkills`.
- **No class mastery** (`classMastery: false`). Cavalier-family Wayfarer (+1 ATK, +1 SPD
  after 8 battles) would push the lance to AS 5, where it doubles about 12% of Act 1
  enemies.
  - Flavour: a veteran has nothing left to learn from the class.
  - Needs a small `MasterySystem` guard.

**Canto is the biggest unmodelled factor.** Hit-and-retreat hides the fragility these
tables measure. Keep it, because it is class-innate and the FE-true choice. The sims below
must run with it, and if First Light is too easy, removing Canto for this unit is lever #1
before touching stats.

**Act 1 bosses (First Light, STR 11).**

| Boss | Sword | Lance | Threat to him |
|---|---|---|---|
| Iron Captain | 32% HP | 38% HP | about 12 per hit |
| Warchief | 84% HP (2% ORKO) | 38% HP | about 15 per hit while he holds the lance: two hits kill |

Neither boss is soloable.

**Fall-off.** Ran with the static First Light line (STR 11) against Act 2, First Light:

| Enemy level | Best-weapon ORKO | Hits him for (per attack) | Notes |
|---|---|---|---|
| 3 | 41% | 8.5 | Still carrying |
| 4–5 | 23–32% | 9–10 | No longer a "kills most" unit |
| 6–8 (Steel weapons) | 13–34% | 12–14 | Two or three hits kill him |
| Act 2 boss (Knight Commander, L12) | — | about 20–25 | One-shots him from 22 HP |

- With the STR 13 line the same table reads 57% → 28%, so STR mostly shifts *when* he
  fades, by roughly one row of the map.
- With eight levels of the proposed growths (expected HP27 STR12 SKL8 SPD11) he gains a few
  points of ORKO but does not recover.
- **His window is Act 1 and the opening rows of Act 2.**

On First Light, which ends at the Lieutenant after Act 3, that window is roughly 40% of the
run. This is why First Light gets the weakest line.

### 5. Growth and XP

- **Growths are fixed and low:** HP15 STR10 MAG0 SKL10 SPD10 DEF5 RES5 LCK5, total 60,
  against about 305 (range midpoints) for a rolled Cavalier.
  - Expected gain is about 1.1 stat points per level, against 3–4 for a normal unit.
  - The guaranteed-one-stat fallback lands on HP, the highest growth, which is the least
    snowbally stat for a fragile unit.
- **XP needs no new code.** At promoted effective level 13 he earns 1 XP per action in Acts
  1–2 and real XP only from level-10+ enemies (Act 3).
  - Team XP from gold picks (25 each) is his main early source, about one level per four
    picks. That is fine: at 1.1 points per level it is noise.
- **Do not add an XP multiplier below 1** in v1.
  - It is redundant through Act 2.
  - It would also miss team-XP loot and Colosseum XP, which bypass `scaledXp`
    (`LootScreenController.js:340-345`, `PendingRewardController.js:73-77`,
    `ColosseumOverlay.js:398`).
  - If Act 3+ leveling proves too generous, add an `xpMultiplier` on the `old_guard` trait.
    The existing Hungry (×1.2) path handles it with no engine change.

### 6. Meta and blessing interactions

The design rule: **his join state is nearly meta-invariant.** He substitutes for meta
progress rather than scaling with it. The one concession is the requested half-rate
growths.

| Modifier | Normal non-lord | Veteran |
|---|---|---|
| Meta growth upgrades (`recruit_*_growth`) | full × difficulty mult | **×0.5** × difficulty mult (as requested) |
| Meta flat stats (`recruit_*_flat`, up to +10 HP) | full | **none**. This matters more than growths: +10 HP would break the fragility target outright, while growths barely act before Act 3. |
| Recruit join perks: Lethal Armory, Quartermaster's Craft forge, Outfitted Recruits accessory, recruit skill, field supplies, Master of Arms | yes | **none** (fixed kit) |
| Training Doctrine (`recruitXpBonus`) | yes | yes. Harmless: +20% of 1 is still 1. |
| Blessing `all_growths_delta`, `targeted_growths_delta` (recruit scope) | full | **×0.5**, the same carve-out as meta growths |
| Blessing stat deltas (`all_units_stat_delta`, Rally Cry, run-start max HP) | yes | yes. Run-wide effects the player chose. Revisit if the sims flag it. |
| Lord-only blessings | no | no |
| Difficulty `growthBonusMultiplier` | applies | applies, multiplied by the 0.5 |

Where the carve-outs hook in:

- The creation function, for meta.
- A `growthBonusScale(unit)` helper consulted by `_applyGrowthDeltaToUnits` and
  `_applyTargetedGrowthDeltaToUnits`, for blessings.
- The join-perk block, which the special path simply does not call.

### 7. Side effects to neutralise (`countsTowardRosterLevel: false`)

1. **Recruit-node join level.**
   - Exclude special characters with `countsTowardRosterLevel: false` from
     `resolveRecruitNodeLevel`'s top-N.
   - Without this, the veteran would make Act 1 node recruits join about 3 levels higher.
     That is a hidden power boost larger than anything in his own stat line.
2. **Revival catch-up target** (`RevivalCatchUp.js`): exclude for the same reason.
3. **`resolveTeamAverageLevel`** (`RecruitScaling.js:42-52`): currently only tests call it.
   Exclude anyway, so a future caller inherits the rule.
4. **Opening-Cavalier protection.** Recommendation: **let him count.** The rule's own
   comment says cavalry arrives "after help has joined", and he is help. The earlier
   cavalry is also a free counterweight on First Light. (Open question.)
5. **Enemy count:** deploying him adds enemies through the existing deploy-count scaling.
   Keep it: it is the "punish the clock" tax, applied honestly.

### 8. Kill feeding

What a veteran enables:

- **Chip then finish.** The Steel Lance leaves Act 1 enemies at 30–45% HP. Edric (or any
  recruit) takes the kill for full XP, with no assist split.
- **Mentor's Band on the veteran.** Adjacent allies get half their own XP formula on every
  fight he takes, including enemy-phase counters.
  - This is capped at half of a self-kill.
  - It stops for Edric once Edric promotes.
  - The Band is act2+ loot and shops.

Why v1 changes nothing here. The existing diminishing-XP tiers bound how far feeding can
push Edric. Past three effective levels above the enemy, XP falls fast: 25 → 9 → 1 per
kill. Ran, with Edric taking a given share of all kills in a First Light Act 1 + Act 2 path
(kill XP only):

| Edric's share of kills | Edric level, end of Act 1 | End of Act 2 |
|---|---|---|
| 33% | 4.4 | 9.5 |
| 50% | 5.7 | 11.1 |
| 75% | 6.9 | 12.1 |
| 100% (perfect feeding) | 7.4 | 12.4 |

- Going from "Edric takes half the kills" to "Edric takes every kill" is worth about
  **+1.7 levels by the Act 1 boss and +1.3 by the end of Act 2**.
- Edric then promotes at 10 or more, and effective 22 gives him little from Act 2–3
  enemies. Feeding saturates.
- The real risk the veteran adds is **safety**: fewer resets, fewer losses. That is his job.
  Whether that safety is too much on First Light is what the sims must answer. XP
  mechanics are the wrong tool for it.
- The design log's principles agree: punish the clock, not the unit; nothing that scales
  off the unit being strong.

**Mentor's Band:** allow it. The design log's stated purpose for the Band is "the strong
unit equips it … turns juggernaut turns into roster development". A veteran training
recruits is the most FE-true use it has.

If the sims show feeding runs away, levers in order:

1. Weaken the lance chip (lower STR). This narrows how often the chip leaves a
   one-hit-kill for a weak unit.
2. Remove Canto from the veteran.
3. Add one enemy on maps where he is deployed. This is a clock tax, in line with the
   design log.
4. Exclude the **commander** from receiving the veteran's Band share: a one-line filter in
   `getXpShareRecipients`, keyed on `specialCharId`.

**Rejected:** an assist rule such as "kills of enemies the veteran wounded this turn give no
kill bonus". It is opaque, it punishes the correct FE play, and it breaks the design log's
"no targeted nerfs" principle.

### 9. Death, voice, UI

- **Death:** an ordinary recruit death, with class and temperament last words, a deed
  announcement, and church revival.
  - He is excluded from the revival catch-up *target*.
  - His own revival follows the normal rule (`RevivalCatchUp.js:16-26`). At effective
    level 13 he is above any early roster average, so catch-up does nothing for him early.
  - Later (Act 3+) it can raise him toward the roster average. It rolls at growths −10,
    clamped at 0, so each level gives only the one guaranteed stat point.
- **Voice:** the class Paladin pools plus a pinned temperament.
  - `temperamentFor` needs a special-character override. Today temperament is derived
    from name + run seed (`UnitVoice.js:84-89`).
  - Optional later: a small `unitVoice.special.old_knight` pool for level-ups ("Another
    year, another notch on the belt.") and last words. It is not required for v1.
- **Trait `old_guard`** (`data/traits.json` + `src/ui/traitContent.js`):
  - Never rolled (roll weight 0) and has no creation mods.
  - It is the UI carrier that explains him everywhere traits already show: the roster, unit
    detail, mobile sheet and growth card.
  - Suggested text: "Past his prime. Joins promoted, learns little, grows slowly."
  - Do not call it "Veteran": that is already the deed "Veteran of the March".
- **Difficulty Select:** the toggle row plus a one-line description. Help → Meta-Progression
  (or Promotion) gets a short paragraph.
- **Deploy screen:** nothing new. He is optional once the roster exceeds the minimum.

## Implementation plan

| Area | Files | Change |
|---|---|---|
| Data | `data/specialChars.json` (new), `schemas/specialChars.schema.json` (new), `public/data/…` via `npm run sync-data`; data loader; `validate:data` / `check:data-parity` pick it up | One entry. The schema requires every `DIFFICULTY_IDS` key in `statDeltasByDifficulty`. |
| Creation | `src/engine/SpecialCharacters.js` (new, pure) | `createSpecialCharacter`, `growthBonusScale(unit)`, `countsTowardRosterLevel(unit)`, `isSpecialCharOffered(def, difficultyId)` |
| Run start | `src/engine/RunManager.js` | Add `veteranMode` (ctor, `startRun` options, `toJSON` / `fromJSON` defaulting to false). `createInitialRoster` appends the unit. Blessing growth loops consult `growthBonusScale`. The victory record gets a `veteran` field, plus the `RunRecords.js` whitelist. |
| Menus | `src/scenes/DifficultySelectScene.js`, `BlessingSelectScene.js` (passes the flag through its rebuild), `firstRunFastPath.js` (stays off) | Toggle beside the Meta toggle |
| Levels | `RecruitNodeSystem.js:176-204`, `RevivalCatchUp.js`, `RecruitScaling.js:42-52` | Exclude units with `countsTowardRosterLevel` false |
| Mastery / skills | `MasterySystem.js`, `UnitManager.checkLevelUpSkills` | Respect `classMastery: false`. Skip learnable skills for special characters that opt out. |
| Voice / traits | `UnitVoice.js` (temperament override), `data/traits.json` + `src/ui/traitContent.js` (`old_guard`) | |
| Help | `src/data/helpContent.js` | One paragraph (watch the about-15-lines page limit) |
| Sims | `tests/sim/RunPolicies.js:26-35`, `tests/sim/fullrun-runner.js`, `sim/strategy.js` | Deploy order sorts by `getXpEffectiveLevel`, not raw `level`: the current sort would bench a level-1 promoted unit. Add a `--veteran` flag. |

No changes to `Combat.js`, `BattleXp.js`, `XpShare.js` (unless lever 4 is pulled) or
`difficulty.json`.

## Tests

Each test catches one realistic failure:

1. **Determinism:** two `startRun` calls with the same seed produce identical veteran units.
   `BlessingSelect` rebuilds must not re-roll him.
2. **Per-rung stats:** stats equal base + delta for each offered rung, and Black Sun does
   not create him. Expected values are written out by hand, not recomputed.
3. **Meta invariance:** with endgame meta (every upgrade maxed), his stats equal the
   no-meta stats, and his growths equal base + ⌊0.5 × meta × difficulty mult⌉. No forge,
   no accessory, no extra skill.
4. **Blessing carve-out:** on First Light, Scholar's Vow (+5 all growths) adds exactly +3
   (`Math.round(2.5)`, matching `_scaleGrowthBonuses`) to him and +5 to a normal recruit.
5. **Recruit-node level:** Edric 1 + Sera 1 + veteran gives node level 1, not 4. A test that
   fails before the exclusion is added.
6. **Revival catch-up** ignores him in the target average.
7. **Save round trip:** `specialCharId`, the growths and `veteranMode` survive
   `toJSON` / `fromJSON`. An old save with no `veteranMode` loads as false.
8. **Loadout:** the Steel Lance is equipped and the Iron Sword is in inventory; `ride_down`
   is never learned; mastery never applies.
9. **XP pin:** a promoted L1 unit earns exactly 1 XP killing a level-8 enemy. This guards
   the property the design relies on in case someone retunes the +12.

## Validation (sim gates before shipping)

Use the real-engine harness (`tests/sim/RunSimulationDriver.js`, `ScriptedAgent`, Canto on
where the harness allows) with the deploy-sort fix. Run at least 200 seeded runs per
arm on First Light and Dusk, with meta off and with the `endgame` preset.

| Metric | Gate |
|---|---|
| Win rate, veteran ON vs OFF, **meta off** | ON may be higher, but less than the win-rate gap between meta off and meta `endgame`. He substitutes for meta and never beats it. |
| Win rate, veteran ON, **meta endgame**, First Light | ≤ +5 points over OFF. He must not stack into a trivial mode. |
| Act 1 battles won with zero player losses | Report it; this is the "trivialises Normal" signal. |
| Edric level at the Act 1 boss and at the end of Act 2 | ≤ +1.5 over OFF with a **feeder policy**: a `ScriptedAgent` variant that chips with the veteran and hands kills to Edric |
| Veteran's share of kills, by act | Must fall steeply by Act 2's second half (the fade) |
| Veteran death rate by act | Nonzero in Act 2. If he never dies, he is too safe. |

The existing `sim/fullrun.js` abstract sim cannot see chip damage, the Band, par or Canto.
Use it only as a smoke test.

## Open questions for the designer

1. **Opt-in or always present?** This spec says opt-in, off by default. If you want him in
   every run (the FE norm), the whole baseline needs the rebalance you anticipated, and
   First Light probably wants STR 10 and no Canto.
2. **Black Sun:** not offered, as proposed? The alternative is offering the Nightfall line
   as "a helper, not the archetype": sword ORKO about 10% there even at STR 17.
3. **Unlock:** available from run 2 with no gate, as proposed? Alternatives are `beatAct1`,
   or "after a loss".
4. **Should "Meta OFF + Veteran ON" pay anything?** No-meta runs are unrewarded today. A
   milestone or record badge is cheap; payout changes are not in scope.
5. **Opening-Cavalier ban:** let him lift it (proposed), or exclude him from the count?
6. **Canto:** keep (proposed) and remove it only if the sims say so, or cut it up front?
7. **Name, face and voice:** Gaspard is a placeholder. A bespoke portrait and voice pool are
   optional follow-ups.
8. **Vanguard Cadre overlap:** tier 4 can roll a second, much tankier and higher-growth
   Paladin. Should that pool drop Paladin now that a Paladin special exists?

## Rejected alternatives

- **A lord entry.** Schema, portrait and voice cost, plus leaks into lord recruit pools. See
  *Design*, section 1.
- **Rolled "bad" growths** (Cavalier ranges minus N): non-deterministic, and indistinguishable
  from an unlucky Vanguard roll. Fixed growths make the archetype legible.
- **A per-unit XP multiplier below 1:** redundant through Act 2 and bypassed by team XP.
  Kept as a later lever on the trait.
- **Assist or anti-feed XP rules:** see *Kill feeding*.
- **Scaling his stats by act** (a "keeps up" veteran): that defeats the archetype. Scaling by
  *difficulty rung* keeps his role constant. Scaling by *act* would erase the fade.
