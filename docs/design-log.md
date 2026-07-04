# Design Log

Running log of design discussions, decisions, and deferred ideas. Newest entries first.
Each entry links to specs in `docs/specs/` when an idea graduates to implementation.

---

## 2026-07-04 (later) — Next-phase content batch (accessories II, abilities II, staves, imbues II)

Idea dump for the wave after the current five PRs land. Not yet specced. Notes flag
implementation cost, philosophy fit, and collisions with the in-flight wave.

**Latitude (user, same day):** this list is inspiration, not a contract — at spec time, freely
rename, retune numbers, reshape concepts, cut entries that don't earn their complexity, and add
new ones that fit the themes (roster incentives, telegraphed counterplay, build-defining rare
finds). The design principles at the top of the 2026-07-04 entry are the actual constraints.

### Ruling: ally-relocation is staff-exclusive

Verified: no Warp/Rescue staves exist (8 staves total; the utility-staff niche is empty —
Sleep/Silence are enemy-only). Decision: **Warp and Rescue effects ship only as staves**, giving
healers a second high-leverage role (roster-incentive aligned). Self-teleport (Blink, wave 1
scroll) stays a skill. Definitions, FE-classic:
- **Rescue Staff** — pull a distant ally (within MAG-scaled range) to a tile adjacent to the caster.
- **Warp Staff** — send an adjacent ally to a passable tile within MAG-scaled range.
Both use the existing staff plumbing (uses, MAG 8/14/20 bonus uses, staff XP). The "Warp/Recall"
entries in the ability list below are superseded by this ruling.
**Graduated to spec:** `specs/warp-rescue-staves.md` (2026-07-04).

### Accessories, wave 2

| Item | Effect | Notes |
|---|---|---|
| Chronal Locket | Once per battle, survive a lethal hit at 1 HP | Guaranteed Miracle; Sera timeline flavor. Reuse the per-battle usage-counter pattern; interacts with the Miracle skill (must not double-fire — locket consumes first or last, pick and document). Cheap. |
| Shadow Cloak | Enemies won't target holder unless it's the only unit in range | Aggro-drop for fragile mages/healers. Needs an AI hook in `_scoreAttackTarget`; same plumbing as Provoke (aggro-up) below — build both flags at once. |
| Sunstone Band | Heal 20% max HP at start of each turn | Juggernaut enabler — accepted deliberately (roguelikes love a busted find). `turnStartEffects.healSelfPercent` already exists (Soothing Stone) so it's a data-only item. Adopt the suggested "only while no ally adjacent" gate: it creates clean anti-synergy with Phalanx Band/Mentor's Band, so the item declares an identity instead of stacking with formation play. Act3+, expensive. |
| Timeweaver's Pendant | Once per battle, rewind holder to its turn-start position and HP | Item-based personal Vision. Flag: needs a turn-start snapshot + restore path; Vision/BattleSuspend systems are precedent but this is the priciest item here — spec carefully (interaction with kills made, XP gained, statuses since turn start: rewind position/HP only, nothing else). |
| Aegis Mantle | Halve incoming ranged/magic damage | Hard counter to act3 mage stacks/siege; melee still punishes. New combat-mod key, clean Combat.js seam. |
| Berserker's Chain | +30 crit; holder cannot be healed by staves | Glass-cannon enabler with a real cost. Needs a heal-block check in staff targeting (HealController) + clear UI messaging on why the target is invalid. |
| Phantom Step | Ignore enemy zone of control | **Reinterpretation required: the game has no ZoC mechanic** — enemies block tiles outright. Implement as FE "Pass": holder may path *through* enemy-occupied tiles (still can't end on them). Grid/movement flag; moderate. |
| Oathkeeper's Ring | While above 75% HP: immune to crits and effective damage | `above75` condition + `negateEffectiveness` already exist; crit immunity is one new key. Cheap, great tension (protection drops when chipped). |
| Gluttonous Idol | +1 random stat per kill, battle-only | Snowball that resets per map so it can't warp the run. Battle-scoped buff container exists (timed-buff array) — needs a non-expiring-until-battle-end variant. |

### Utility abilities, wave 2 (same action framework as wave 1)

| Ability | Effect | Notes |
|---|---|---|
| Smoke Veil | Allies in radius untargetable until next player phase | Defensive turn-skip. Shares the untargetable-flag AI plumbing with Shadow Cloak. |
| Recall | Swap positions with any ally on the map | Cheap effect, huge ceiling; needs a map-wide ally-pick targeting mode (new but simple — highlight allies, not tiles). |
| ~~Warp~~ | — | Superseded: staff-exclusive (see ruling above). |
| Bulwark | Until next turn, allies adjacent to caster take −50% damage | Mobile fort; strongest once a Defend-style objective exists (future Part B) but fine standalone. Timed aura via the buff container. |
| Time Stop | All enemies skip movement next enemy phase (can still counter) | Movement-only neuter = literally mass `root` — the root status already means "may act, not move," so this is `applyCondition('root')` on all enemies. Trivial to build; price very high, single use. Panic button vs reinforcement dumps. |
| Meteor | Fixed AoE damage, 2-tile radius, anywhere on map | Flat damage (ignores MAG) so it doesn't warp mage builds. **Requires the pick-a-center AOE targeting UI wave 1 explicitly deferred** — this is the feature that justifies building it. |
| Provoke | Enemies in range must target caster next enemy phase | Taunt; pairs with Oathkeeper/Aegis tank. Same AI-scoring hook family as Shadow Cloak. |
| Second Wind | Refresh self (act again), no movement on second action | Self-Dance for ranged units. Watch balance: double Bolting/ballista turns; maybe once per battle and act3+. |

### Imbues, wave 2

| Imbue | Effect | Notes |
|---|---|---|
| Stormcharged | +1 max range, **counter-only** (melee counters at 1-2), halved damage on the extended-range counter | User-refined to defense-only; conditional range needs a counter-context check in Combat.js — the wave-1 combatMods vocabulary has `rangeBonus` but not counter-only. |
| Venomous (20% max HP) | Post-combat poison scaling off target max HP, ignores DEF | **Collision: wave-1 `venom` imbue is flat 5 poison.** Resolve by upgrading the wave-1 imbue to the % version rather than shipping both (percent version is the anti-boss/anti-juggernaut-mirror tool the player wields). |
| Reaver | Reverses weapon triangle | The `"Reverses weapon triangle"` special string is already parsed (Combat.js:535) — nearly free. |
| Lightweight | Weapon weight set to 0 | Trivial to implement; quietly top-tier (frees Silver/Killer doubling) — price accordingly. |
| Piercing | 20% chance per hit to ignore DEF (true damage) | Luna-proc as an imbue; reuse skill-proc infrastructure. |
| Soulbound | +1 might each time the wielder levels up (permanent for the run) | Signature-blade fantasy. Bind to the unit at application (`_soulboundTo`); might only accrues from the bound wielder's level-ups; needs a level-up hook + serialization. Medium. |

### Sequencing notes

- Wave 2 depends on wave 1 landing: abilities II builds on AbilityController; imbues II on
  ImbueSystem; accessories II will re-collide with the accessories count assertions.
- Shadow Cloak + Provoke + Smoke Veil share one AI-targeting-modifier system — spec them together.
- Meteor is the forcing function for pick-a-center targeting; bundle any other center-targeted
  effects into that PR.
- Staves (Warp/Rescue) are self-contained and could ship early in wave 2 — highest
  roster-incentive value per unit of work in this batch.

---

## 2026-07-04 — Early-game difficulty vs. Edric juggernaut

### Problem statement

Two symptoms, one cause:

1. The early game is hard with only Edric + Sera.
2. Funneling everything into Edric (the juggernaut line) is often the dominant strategy — and because the early game is hard with two units, it's also the *taught* strategy.

Heavy-handed anti-juggernaut effects (ambush spawns, % damage, RNG status on your best unit,
"targets your strongest unit" mechanics) are feelbads and are off the table.

### Design principles adopted

- **Pay secondary objectives in a different currency than kills.** Gold, items, recruits,
  and meta-currency reward a second flank without competing with the juggernaut's XP.
  If side objectives paid combat XP, the juggernaut would just collect them too.
- **Punish the clock, not the unit.** The turn-par system (XP/gold decay, boss enrage)
  is the sanctioned juggernaut tax. Effects that make solo play *slower* rather than
  *deadlier* funnel into a pressure system players already understand.
- **Distance-gate + turn-gate split objectives** so one unit mathematically cannot do
  everything; the opportunity cost is visible on the map, never a targeted nerf.
- **No effect that scales off the unit being strong** (e.g. % max-stat damage,
  "targets highest level"). Reads as the game cheating.
- **Make recruits attractive through utility the lord doesn't have** (fliers, thieves,
  tools) and through positive XP incentives — not by nerfing the lord.

### Decisions (graduating to specs / PRs)

| # | Idea | Notes | Spec |
|---|------|-------|------|
| 1 | **Village & bandit secondary objectives** | Classic FE: village/cache tile on the far side of the map; scripted bandit squad beelines for it; player reaching it first earns gold/item, bandits raze it. Optional, no punishment for ignoring. Builds on the Merchant Caravan micro-objective framework (PR #54). ~1 secondary objective per map max — avoid checklist fatigue. | `specs/village-bandit-objectives.md` |
| 2 | **Recruit-focused meta upgrades + lord upgrade cost rebalance** | New expensive recruit upgrades (flagship: recruits join with a forged weapon). Lord base-stat and growth upgrades become more expensive than the recruit equivalents, tilting long-term meta investment toward roster width. | `specs/recruit-meta-upgrades.md` |
| 3 | **Weapon imbues** | Rare weapon blessings that attach a special effect to a specific weapon (lifesteal, anti-armor, on-hit status chance, etc.). Delivered like whetstones / via forge-adjacent flow. Persist through save/load. | `specs/weapon-imbues.md` |
| 4 | **Legendary accessories (incl. EXP Share, Mercury Sandals)** | EXP Share: the *strong* unit equips it and gives up their accessory slot; adjacent lower-level allies siphon XP from the holder's combats. Turns juggernaut turns into roster development with a real cost. Mercury Sandals: infantry holder gains flying-type movement. Plus 2-4 more build-around legendaries. **Amendment (same day):** Mentor's Band must NOT be rare — as a catch-up enabler its value decays with lateness, and it's self-limiting, so it ships act2+ in loot AND shops at a moderate price; only the power items (Sandals/Phalanx/Pursuit) stay act3+ legendary-rare. | `specs/legendary-accessories.md` |
| 5 | **Utility abilities (single-use action skills)** | New battle actions alongside Fight/Item/Weapon Art/Wait: Teleport N tiles, Rally (temp party buff), AOE heal, AOE root. Weapon-art-like but utility-driven; charge-limited per battle or per run. Granted via rare loot (scroll-like items) and/or legendary accessories. | `specs/utility-abilities.md` |

### Liked, deferred (revisit later)

- **Full support/bond system** (adjacency-accrued ranks granting hit/avoid auras).
  Very FE-coded and the strongest long-term "roster > one unit" lever, but a large
  system (pair tracking, rank UI, balance). The EXP Share accessory (#4) is the
  cheap probe of the same design space — ship it first, see how adjacency play feels.
- **Mentor/assist XP** (adjacent lower-level ally gains trickle XP on lord kills)
  as a baseline mechanic. Overlaps with EXP Share; if EXP Share proves the loop,
  consider promoting a small baseline version later.
- **Wary AI** — enemies that can't hurt the juggernaut stop suiciding into him and
  instead hold chokes / guard objectives / drift toward squishies. Deep fix (the AI
  currently *feeds* the juggernaut) and reads as "smart enemies," not a nerf; slower
  solo clears get taxed by the existing par system. Needs careful AIController work +
  sim validation — schedule as its own investigation.
- **Rescue-recruits** (green unit escort → joins roster). Merchant Caravan (#54)
  already probes escort mechanics; extend to recruit rewards once villages land.
- **Hold-point bonus objectives** (hold a shrine N turns → blessing shard/discount).
- **Twin-pincer rout template** (two converging enemy clusters — geometry-driven
  anti-turtle pressure).
- **Underdog XP surfacing** — the +6-level underdog XP bonus already exists in
  `calculateCombatXP` but is invisible; add a "Underdog!" toast so it works as an
  incentive. Cheap; bundle into any XP-adjacent PR.
- **Raise Corrosive/Thorns/Rally affix weights**, and consider low-chance tier-1
  affixes on Normal in act 3+ (currently Normal = 0% — Normal players juggernaut
  hardest). Pure data tweak; wants sim validation.
- **Weapon-economy pressure on soloists** (occasional `sunderWeapon` enemies outside
  scripted boss waves). Taxes juggernauts through gold, not death.

### Explicitly rejected

- End-of-battle ratings scoring "distinct units used" — checklist feelbad.
- Untelegraphed ambush spawns, flat % damage, RNG sleep-lock on the player's carry,
  and anything that targets "your strongest unit" by rule.

### Existing systems these build on

- Turn par / late pressure: `data/turnBonus.json`, `TurnBonusCalculator.js` (XP/gold
  decay 2+ turns over par, boss enrage) — the sanctioned slow-play tax.
- XP diminishing returns: `UnitManager.calculateCombatXP` (steep decay at +4..+6
  level advantage, flat minimum at +7; underdog bonus capped at +6).
- Affix engine (`data/affixes.json`) — telegraphed anti-solo-tank effects already
  exist (Corrosive, Thorns, Rally).
- Micro-objective framework from Merchant Caravan (PR #54).
- Class Mastery + Trait system (PR #53) — new accessories/skills must compose with it.
