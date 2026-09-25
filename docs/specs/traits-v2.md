# Traits v2 — audit and redesign

Status: implemented on `claude/traits-audit` (2026-09-25).
Code: `src/engine/TraitSystem.js` (rolling, creation mods, combat mods, migration),
`src/engine/MasterySystem.js` (perk amplification), `src/ui/traitContent.js`
(per-unit text), `data/traits.json`, `schemas/traits.schema.json`,
`sim/traits.js` (`npm run sim:traits`).

## Why

The user saw a boss-recruit Cavalier offered with *Reckless — "When mastered, gains
+2 ATK / -1 DEF instead of the class perk"* and asked whether traits needed a
balance and design pass. Playtest #30 (2026-09-22) had already flagged Brawny
(+1 STR, −5% SPD growth) as downside-only on a tome mage. Improvement
opportunity #9 asked for lord traits with sharper identity. Design principles
that constrain the answer (design log 2026-07-04): roster incentives, telegraphed
counterplay, no feelbads, punish the clock not the unit.

## How the numbers were measured

`sim/traits.js` (new) uses common random numbers: for every (class, trial) the
unit, its enemies and all combat rolls come from the same seeds with and without
the trait, so each delta is the trait's own effect. Each recruitable base class is
built at Lv1, the trait is baked in, and it levels to Lv6 (act 2, vs the act-2
pool) or Lv13 (act 3, vs the act-3 pool including promoted foes) with its tier
weapon. Three measures, 400 trials per cell:

- **win**: attrition duel. The unit initiates, then the enemy does, for up to 5 rounds.
- **kill**: one player-phase exchange from full HP.
- **surv**: one enemy phase in which two fresh enemies attack the unit.

HP conditions play out naturally. Positional conditions (cover, adjacent ally, no
ally near) are switched on for both the baseline and the trait run, and the
finisher trait meets a foe already at half HP. Those rows therefore show value
*while active*. Mastery traits are compared on a mastered unit against its class
perk alone. Movement and XP traits have no combat effect in this model.
"Mean" is taken over the classes the live roll rules can actually give the trait
to. The v1 numbers come from the v1 code (`sim/traits.js --traits` pointed at the
v1 data, run before the engine change, so Reckless's perk override is included).

## Audit (rules v1, 15 regular + 7 legendary)

| v1 trait | What the code did | Problem found | v1 act-2 win / surv (mean) |
|---|---|---|---|
| Steady | +1 DEF, +5% HP growth (baked) | Overlaps Hardy (both HP growth). Fine but bland | +3.8 / +6.9 |
| Nimble | +1 SPD, +5% SPD growth | Fine; +5% growth is barely felt | +3.6 / +3.8 |
| Hardy | +2 HP, +10% HP growth | Fine | +4.2 / +8.2 |
| Keen | +1 SKL, +5% SKL growth | **Weakest trait**: ~+2 Hit, +0.5 Crit | +1.0 / 0.0 |
| Brawny | +1 STR, −5% SPD growth; physical-only since #64 | Survival negative on every class it rolls on (−0.5 act 2, −1.1 act 3). Legacy saves still carry it on tome mages (playtest #30: Elara), where it is **downside-only** (−1.0 win) | +2.7 / −0.5 |
| Clever | +1 MAG, +5% MAG growth; magic/staff only | Weak (+1.1 on Mage); only real use is +1 heal on Clerics | +1.1 / 0.0 |
| Lucky | +2 LCK, +5% LCK growth | Weak: +2 Hit, +2 Avo, −2 enemy Crit | +1.7 / +1.9 |
| Cornered | +15 Crit at ≤50% HP | Weak: low uptime, crit only | +1.2 / +0.1 |
| Vigorous | +2 Atk above 75% HP | Fine | +3.2 / +0.3 |
| Lone Wolf | +10 Avo, no ally within 2 | Fine for fighters. **Trap on healers**: staves heal at range 1, so the condition is off whenever the unit does its job. Rolls on lords, feeding the lone-lord juggernaut | +4.8 / +8.3 (active) |
| Woodsman | +2 DEF on Forest | Strong while active, but **only 34 of 60 generated act-2/3 maps have any forest or mountain** (castle maps have none) | +6.7 / +8.6 (active) |
| Studious | Mastery threshold −2 (8 → 6) | Fine | n/a |
| Lazy | +1 STR, +1 DEF; mastery +2 (8 → 10) | No eligibility filter: **+1 STR is dead on casters** (Mage +2.8 win vs +6.5 average), and the mastery delay is pure cost | +6.5 / +6.3 |
| Reckless | Mastery perk **replaced** by +2 Atk / −1 Def | Worse than the perk it replaces for 11 of 12 recruit classes (table below); dead on Clerics and Dancers, who rarely attack | **−3.1 / −10.2** |
| Quick Study | ×1.15 battle XP | Text said "XP"; arena and reward XP were never multiplied | n/a |
| 7 legendaries | Lord-only, 5–15% | Behaviour correct. Text used shouted caps (ATK/DEF); Overflowing Grace ran 100 chars | — |

### Reckless against every class perk (v1, mastered unit, Δ vs the class perk)

| Class | Class perk it replaced | Act-2 win / surv | Act-3 win / surv | Verdict |
|---|---|---|---|---|
| Myrmidon | Duelist's Edge +10 Crit | −3.3 / −5.5 | +3.8 / −2.5 | sidegrade late, loss early |
| Mercenary | Veteran +5 Hit +5 Crit | +1.0 / −6.8 | −3.0 / −4.3 | loss |
| Fighter | Frenzy +2 Atk | −3.8 / −9.3 | −3.5 / −5.5 | **strictly worse** (same +2 Atk, plus −1 Def) |
| Knight | Bulwark +2 Def | −2.8 / −1.8 | −4.1 / −8.8 | −3 Def swing on a wall |
| Cavalier | Wayfarer +1 Atk +1 Spd | −4.0 / −11.3 | −1.7 / −7.0 | loss (the user's screenshot) |
| Archer | Deadeye +10 Hit +5 Crit | −2.8 / −8.0 | −2.4 / −3.8 | loss |
| Thief | Evasion +10 Avo | −2.0 / −17.5 | −3.6 / −14.3 | loss |
| Pegasus Knight | Tailwind +1 Spd +5 Avo | −6.3 / −14.3 | −5.5 / −10.8 | loss |
| Wyvern Rider | Iron Scales +2 Def | −5.3 / −16.0 | −4.0 / −18.5 | loss |
| Mage | Focus +2 Atk | −3.5 / −3.8 | −2.5 / −1.5 | **strictly worse** |
| Cleric | Devotion +2 Res +5 Avo | n/a / −12.0 | n/a / −6.0 | dead (cannot attack) |
| Dancer | Grace +8 Avo +1 Spd | −2.0 / −16.0 | −2.4 / −16.0 | dead-ish |

### Code-level findings

1. **Reclass silently erased trait growths.** `reclassUnit` re-rolls growths from
   the new class, dropping every baked trait growth (Hardy +10% HP, Nimble, Steady,
   Keen, Clever, Lucky, and Brawny's −5% SPD). Fixed: trait growth mods are
   re-baked after the re-roll.
2. **Promoted recruits rolled against their base class.** Boss recruits, colosseum
   mercs and promoted battle NPCs are built on the base class and then promoted, so
   a Cleric→Bishop was judged as a Cleric. Fixed: the promotion target is passed
   as the roll profile (`traitClassData`).
3. **Unknown combat conditions fire.** `SkillSystem.isAccessoryConditionMet`
   returns `true` for an unknown condition, so a typo in a trait condition would be
   always-on. Trait conditions now fail closed, and the schema and tests whitelist them.
4. **Combat `defBonus` also cuts magic damage** (Combat.js subtracts `defBonus` from
   every hit and adds `resBonus` against magic). This applies to every Def-type
   combat mod (Bulwark, Iron Scales, Standard Bearer, Stalwart, Old Campaigner).
   It predates this work and affects the whole game, so it is only flagged here.
5. Stale copy: the help page said "Recruits (not lords)", although lords have rolled
   one trait since #64, and a UnitDetailOverlay comment said the same.
6. Not trait code, flagged only: reclass also drops meta growth bonuses (same
   re-roll), and `_createExtraStartingUnit` builds units with an unseeded `Math.random`.

## Rules v2

### The set (15 regular, 7 legendary unchanged, 6 retired)

| id → v2 name | Effect (one line) | Roll rules | Rationale |
|---|---|---|---|
| hardy → **Hard to Kill** | +3 HP, +10% HP growth | all | Absorbs Steady's role; one clear HP identity |
| nimble → **Quicksilver** | +1 Spd, +10% Spd growth | armored ×0.5 | Growth doubled so the unit actually becomes fast |
| **gifted → Kindled** (new) | +1 Str or Mag, whichever it fights with, and +10% growth to it | all | Replaces Brawny and Clever. A stat trait scaled to the class's attack stat, so it cannot be dead |
| **fleet → Long Stride** (new) | +1 Move | weight 5, mounted ×0.5 | Real tactical identity, kept rarer |
| vigorous → **Unscarred** | +2 Atk above 75% HP | attacker; support ×0.5 | Unchanged numbers, renamed |
| cornered → **Last Ember** | +2 Atk, +15 Crit at ≤50% HP | attacker; support ×0.5 | A comeback that actually swings a fight |
| **bloodhound → Scent of Blood** (new) | +2 Atk, +10 Hit vs foes at ≤50% HP | attacker; support ×0.5 | Finisher that rewards chip-then-kill team play |
| reckless → **Reckless** | +3 Atk when it initiates; −2 Def when an enemy initiates | attacker, not support, not lords | A tradeoff you play around by positioning. **No longer touches mastery** |
| **stalwart → Stalwart** (new) | +2 Def when an enemy initiates | all | Enemy-phase wall; mirrors Reckless |
| lone_wolf → **Lone Wolf** | +10 Avo, no ally within 2 | not support, not lords | Kept; removed from healers and lords |
| **shieldmate → Shieldmate** (new) | +10 Avo beside an ally | support ×2 | Formation twin of Lone Wolf; a roster incentive |
| woodsman → **Old Campaigner** | +2 Def in cover (forest, mountain, fort, pillar) | all | Same bonus, but it now works on every map |
| studious → **Studious** | Masters its class 2 battles sooner | all | Unchanged |
| **slow_oath → Slow Oath** (new) | Masters 2 battles later, but its perk is doubled | not lords | Replaces Lazy. Adds to mastery, never replaces it |
| quick_study → **Hungry** | +20% battle XP | support ×2 | Buffed from 15%; text now says *battle* XP |

Retired (never rolled, still defined so any save loads): Steady, Keen, Lucky (grandfathered
as-is); Brawny, Clever, Lazy (converted by migration, below). "Attacker" means
the class has a non-staff weapon. "Support" means staff-only, or carries Dance.

### Class-aware rolling

- `roll.requires` / `roll.excludes` filter by role; `roll.weight` (default 10) ×
  `roll.roleWeights` bias the pick; `roll.lords: false` keeps a trait out of the
  lord pool. Roles: attacker, support, caster, physical, infantry, armored,
  cavalry, flying, mounted, lord.
- Every recruitable base class keeps 15 eligible traits except Cleric (10: no
  attack traits, no Lone Wolf or Reckless) and Dancer (13: no Lone Wolf or Reckless).
  Healers see Hungry and Shieldmate at 17% per pick, not 7%.
- Stat traits never hard-code STR or MAG. `ATTACK` resolves to the class's attack
  stat: its first non-staff weapon decides; a staff-only unit resolves to MAG
  (heal power). The resolved stat is stored on the unit (`traitAttackStat`), so
  promotion never retargets it, and reclass moves it (see below).
- Lord pool: legendary chance unchanged. Otherwise any eligible trait except
  Reckless, Lone Wolf (no lone-lord juggernaut) and Slow Oath (a doubled lord perk
  stays legendary territory).

### Mastery

Traits only strengthen mastery: `masteryBattlesDelta` shifts the threshold
(floor 4), and `masteryPerkMultiplier` scales the class perk (Slow Oath ×2, name
tagged "Wayfarer ×2"). `masteryPerkOverride` is gone; the schema rejects it.
Studious + Slow Oath can roll together: an 8-battle mastery with a doubled perk.

### Reclass

With `traitsData`, `reclassUnit` and its preview (`getReclassStats`):
- re-bake every trait growth mod after the growth re-roll;
- move an ATTACK stat bonus to the new class's attack stat (a Kindled fighter who
  becomes a mage keeps +1 in the stat it now uses). The preview matches the result.

### RNG contract (unchanged in cost)

A recruit's traits come from the rng its caller already passes (the battle-seeded
stream during battle setup, the colosseum rng, and so on). Rolling v2 costs exactly
one draw for the count plus one draw per pick, the same as v1. Weighted picks spend
a single draw, and with equal weights they choose exactly v1's
`floor(r × n)` index. Nothing drawn after a trait roll shifts, and the tests pin
the draw budget. No new `Math.random` calls were added anywhere.

### Migration (saves)

`migrateUnitTraits` runs on roster, fallen and battle-snapshot units (replacing the
`migrateCleverTrait` call sites; the Clever repair still runs first). It runs once per unit
(`traitRulesVersion = 2`) and only ever adds:

| Legacy id | Becomes | Baked top-up |
|---|---|---|
| hardy | hardy | +1 HP (and current HP) |
| nimble | nimble | +5% SPD growth |
| brawny (physical) | gifted (STR) | +10% STR growth, +5% SPD growth (refund) |
| brawny (caster, legacy bug) | gifted (MAG) | +1 MAG, +10% MAG growth, +5% SPD growth; the stray +1 STR stays |
| clever | gifted (MAG) | +5% MAG growth |
| lazy | slow_oath | none. Same +2 threshold, perk now doubled; its baked +1 STR/+1 DEF stay |
| reckless | reckless | none. The perk override stops, combat trade starts |
| steady, keen, lucky | unchanged (retired, grandfathered) | none |
| all others | unchanged ids | none (rebalanced at combat time) |

The migration never lowers a mastery threshold a unit had, never removes a
stat, never tops up the same v2 trait twice, and is idempotent across
`fromJSON → toJSON → fromJSON` (tests cover all of this).

### Surfacing

`src/ui/traitContent.js` turns each trait into one concrete line for the unit
being shown. The recruit/boss-recruit card (`PartyMenus.describeUnit`), the roster
sheet and the unit-details tooltip now call it. Only the text changed; no layout was touched.
Examples: *Kindled: +1 Mag and +10% Mag growth (the stat it heals with).*
*Slow Oath: Masters its class in 10 battles, not 8; Wayfarer becomes +2 Atk, +2
Spd (from +1 Atk, +1 Spd).* The Phaser fallback boss-recruit overlay (no DOM host)
still lists trait names only.

Unit voices (`dialogue.json unitVoice.traits`): new pools for gifted, fleet,
bloodhound, stalwart, shieldmate and slow_oath, and Old Campaigner's pool was
rewritten for cover. Retired ids keep their pools because legacy units still carry them.

## Before / after (400 trials, mean over rollable classes)

Act 2 (recruit Lv6 vs act-2 pool). Δ win / Δ kill / Δ surv, in percentage points:

| v1 | win | surv | | v2 | win | kill | surv |
|---|---|---|---|---|---|---|---|
| Steady | +3.8 | +6.9 | | Hard to Kill | +5.7 | +0.1 | +11.1 |
| Nimble | +3.6 | +3.8 | | Quicksilver | +4.3 | +2.8 | +4.5 |
| Hardy | +4.2 | +8.2 | | Kindled | +4.5 | +5.0 | +0.6 |
| Keen | +1.0 | 0.0 | | Unscarred | +3.2 | +6.0 | +0.3 |
| Brawny | +2.7 | −0.5 | | Last Ember | +3.0 | 0.0 | +0.1 |
| Clever | +1.1 | 0.0 | | Scent of Blood* | +6.8 | +16.0 | 0.0 |
| Lucky | +1.7 | +1.9 | | Reckless | +2.4 | +10.6 | −12.0 |
| Cornered | +1.2 | +0.1 | | Stalwart | +4.3 | 0.0 | +13.4 |
| Vigorous | +3.2 | +0.3 | | Lone Wolf* | +4.8 | 0.0 | +7.8 |
| Lone Wolf* | +4.8 | +8.3 | | Shieldmate* | +4.8 | 0.0 | +8.3 |
| Woodsman* | +6.7 | +8.6 | | Old Campaigner* | +6.7 | 0.0 | +8.6 |
| Lazy | +6.5 | +6.3 | | Slow Oath (mastered) | +4.6 | +3.5 | +4.0 |
| Reckless (mastered) | **−3.1** | **−10.2** | | | | | |

Act 3 (Lv13 vs act-3 pool): v2 Hard to Kill +5.1/0/+9.5; Quicksilver +5.8/+4.6/+6.9;
Kindled +5.5/+7.5/+0.6; Unscarred +3.2/+6.3/+0.2; Last Ember +2.6/0/+0.2; Scent of
Blood +7.4/+12.7/0; Reckless +3.0/+9.2/−7.4; Stalwart +2.8/0/+9.0; Lone Wolf
+5.2/0/+9.9; Shieldmate +4.8/0/+9.3; Old Campaigner +4.1/+0.1/+7.3; Slow Oath
+5.0/+3.5/+4.8. v1 act 3: Keen +0.8/−0.1, Clever +1.0/+0.1, Cornered +1.3/+0.2,
Brawny +1.5/−1.1, Reckless −2.6/−8.2.

\* while active (positional or finisher condition).

What changed:
- **Floor.** v1 had five traits under +2 on both win and survival (Keen, Clever,
  Lucky, Cornered; Brawny with negative survival), plus Reckless negative on both.
  In v2 every rollable trait gives at least +2.4 win on average, and the weakest
  (Last Ember, a comeback trait) is +3.0 / +2.6.
- **Worst single class cell.** v1: Reckless −6.3 win (Pegasus Knight) and −17.5
  survival. v2: the only negative cells are Reckless's intended enemy-phase cost
  (−3.5 to −20 survival; −1.3 win on the fragile Mage). Its player-phase kill gain
  is +2.5 to +18.3. No other trait has a negative cell beyond sampling noise (≤0.5).
- **Downside-only rolls: none.** Offensive traits need an attacker. Stat traits
  follow the attack stat. Healers cannot roll Lone Wolf. No trait replaces a perk.
- Legendary traits are unchanged.

## Deviations from the brief

- Reckless keeps its name but is now a player-phase / enemy-phase trade instead of
  a mastery modifier. The additive-mastery slot went to the new Slow Oath, which
  replaces Lazy. Lazy saves keep their exact threshold (no unit loses mastery).
- Steady, Keen and Lucky are grandfathered as retired traits rather than converted:
  their baked bonuses were honest, and converting them would have handed old saves
  stat windfalls.
- The BattleScene edits are two one-line option additions (`traitClassData` for
  promoted NPC recruits, `traitsData` for reclass). No flow was added.
