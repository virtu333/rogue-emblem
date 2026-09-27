# Attempting to beat Normal: playthrough and decision report

## Executive summary

**One fresh Normal run, continued across several testing sessions; no Normal victory.** I won 13 battles, cleared Acts 1 and 2, and lost in Act 3's second battle on enemy turn 4 when Edric fell to a Paladin. This report concerns that single continuous run on the portrait integration build. Earlier, separate playtest saves are not counted as additional attempts in this report.

**Tested baseline:** main `b8e13bf` plus portrait integration stack `7689a2c8840cd73707b561f03ee6debe8d87f47a` (#99, #122, #124–126, #128, #129). These are observations on that version, not the latest main. Predominantly 390×844 desktop-hosted phone presentation, with smaller-phone and landscape spot checks; not physical iPhone testing. Isolated save at localhost:3099, sound muted. Visible player controls; no injected resources, forced wins, deliberate deaths, or reloads to change combat rolls.

The campaign offered meaningful weapon, party-role, healing and route decisions. My strongest strategy was a durable Cael frontline supported by Sera, then a promoted hired mage and Dance. My failure was not insufficient cash: it was inadequate protection of support units, a fragile unpromoted commander, and failure to stop a mobile Paladin after the formation broke. Several choices were locally obvious, but only one recorded reward pair was strictly dominated in its immediate payout.

## Runs, progression and outcome

| Stage | What actually happened |
|---|---|
| Fresh Normal attempt | Edric and Sera; no purchased Army upgrades in this fresh save |
| Act 1 | Five wins including boss; Cael recruited; no player deaths |
| Act 2 | Seven further wins including boss; expanded roster; no player deaths |
| Act 3, first battle | Win 13; Voss died; one rewind saved Adela from a lethal critical |
| Act 3, second battle | Ottoline and Jaro died; Edric then died, ending the run |
| Defeat payout | 310 Valor + 310 Supply |
| After defeat | Purchased upgrades below; no second run started |
| Hard | Unlock requirement inspected; no Hard gameplay and no unlocked fixture created |

Three genuine rewind restores were recorded: an Act 1 boss positioning mistake, an unsuccessful Act 2 merchant-rescue attempt, and Adela's Act 3 death. Act-boss charge replenishment worked. Returning to a save or reopening the browser continued this same run; it did not constitute a new attempt.

New-run blessing selection was not covered in the final continuation, and the initial blessing choice is not identified in the retained decision notes. I cannot reliably attribute the outcome to a particular blessing or compare blessing strength from this run.

## Permanent upgrades selected after defeat

These upgrades **did not contribute to the Normal result**. They were purchased for the next attempt, originally intended to be Hard.

| Upgrade | Cost | Reason for choosing it |
|---|---:|---|
| Prophet's Glimpse, tier 1 | 200 Valor | An additional rewind gives another chance to correct a costly positioning error. That had immediate demonstrated value in this run. |
| Lord Swiftness, tier 1 | 75 Valor | +5% SPD growth offers potential follow-up/avoid benefits over a campaign. A modest long-term choice, not a guaranteed immediate stat point. |
| Field Supplies | 100 Supply | Extra starting Vulnerary offers healing independent of Sera's action and position—useful after seeing how strained a single healer can become. |
| War Chest, tier 1 | 75 Supply | +500 starting gold gives early flexibility for a weapon or service. Not selected because late-run gold was scarce. |
| Quick Feet, tiers 1 and 2 | 50 + 50 Supply | +10% recruit SPD growth total, with progress toward the prerequisite for Recruit Agility. I initially considered the immediate +1 SPD upgrade, but it requires Quick Feet level 3. |
| Remaining | 35 Valor / 35 Supply | Unspent |

The payout felt substantial enough to motivate a restart: it funded several understandable improvements. Purchases correctly updated currencies and tiers. However, Prophet's Glimpse displayed `Next: ?` before purchase and `Current: ?` afterward. Recruit Agility's prerequisite was revealed only after selecting its apparently purchasable list row. Speed help also describes doubling with raw SPD rather than explaining attack speed and weapon weight.

I did not systematically compare every upgrade or test refunds. These are my purchase priorities, not a proven optimal build.

## Key campaign decisions

### Act 1: immediate survival and role coverage

- **First reward: gold (+590).** Built an early budget; the retained notes do not preserve all alternatives, so I cannot call this dominant.
- **Wind Sword for Edric:** chose range flexibility over three Vulneraries, Armorslayer and fallback gold. It helped reach targets but its low damage and weight later made it a poor default in some matchups.
- **700 gold + 25 team XP:** chose this over a +5 Hit whetstone and Armorslayer. The extra resources and team development were more useful to the current party. Its separate 271-gold fallback was strictly inferior for that roll.
- **Mend over Master Seal and Goddess Icon:** prioritized immediate healing while Sera was only level 5. This matters in hindsight: I passed up an early promotion resource. The later absence of promoted starting lords cannot fairly be blamed solely on loot availability.
- **Hand Axe for Cael, 700 G:** added ranged access to the defensive anchor. Bought +5 Hit on Edric's Steel Sword for 250 G and Shine for Sera for 1,500 G.
- **Cael recruitment:** his 27 HP / 11 DEF immediately opened safer enemy-phase options. Low axe accuracy against evasive forest enemies prevented him from solving every encounter effortlessly.
- **Act 1 boss:** regrouped split deployment; rewound after blocking the needed finishing tile with Cael. Revised sequence used Hand Axe, Lightning, then Edric's Steel Sword. Seized on turn 5, rank S.
- **Voss boss draft:** selected the Ranger because the party lacked an archer. He arrived with only Steel Sword, so the role advice overstated his immediate contribution. Chose Killing Edge for Edric afterward.

### Act 2: build a supported frontline

- **Longbow for Voss over 948 G + 25 team XP and Might Whetstone:** bought a missing tactical role rather than more money; range 2–3 justified a real opportunity cost.
- **Physic over Power Ring and Aura:** healing reach was more valuable than raw offense. Its benefit was demonstrated when healing Astrid at range.
- **Astrid recruit route:** wanted flight and another lord. She contributed safe finishes, though recruiting her on this particular map was much less urgent than the route wording suggested.
- **Helm Splitter:** selected an anti-armor tool and bound it to Cael's Iron Axe. I still declined it when the cost, counterattack and surrounding enemies made the attack unsafe. Its availability did not make every use correct.
- **Caravan elite route:** selected it with 7,600 G because a merchant could turn savings into useful equipment. The caravan died before I could save it; an attempted Physic rescue did not expose a Heal action. That eligibility needs investigation. Won the main objective on turn 8, rank S.
- **Warded imbue on Cael over Vampiric:** preferred consistent +2 DEF/+2 RES on the frontline to small per-strike healing. Also reduced Shine's weight by one with Silver Whetstone.
- **Hired Ottoline for 1,052 G:** a promoted Sage with 13 MAG and Elfire was a very attractive immediate addition. Gave her Sera's Heal staff. Deployment cap forced a real tradeoff: benched wounded Astrid to field the mage.
- **Declined Arena:** Edric's preview with Wind Sword was poor (3×2 damage versus a 13-damage counter). No obvious in-preview weapon selector; changing gear required leaving for Roster. I did not play an arena match.
- **Jaro recruitment / Dance:** extra actions helped recover from a missed shot and increased tactical flexibility. Not free value: Jaro still needed a deployment slot and safe positioning.
- **Warding Charm over Healing Light:** status immunity looked more dependable for Cael. Healing Light's 7 HP upfront cost and 30% healing looked weak at ordinary damage values.
- **Talisman on Cael:** raised low RES rather than following the reward's highest-growth suggestion for Ottoline. Addressed an actual frontline weakness.
- **Witchfire for Ottoline, 3,306 G:** same main weapon stats as Elfire, but +30 crit and Mire. Bought Life Ring for Edric for 2,875 G to help offense and defense while above 75% HP. Paid 150 G and 200 G for restocks; retained 5,799 G entering the boss approach.
- **Act 2 boss:** combined multiple units' damage rather than relying on one carry; won turn 8, rank S, everyone alive. Drafted Adela and chose Hexblade for Edric's Steel Sword.

### Act 3: tactical collapse

The first map punished my formation more sharply. Edric needed repeated healing; I left Voss at 14 HP in danger and lost him. Adela died to a forecast-warned critical on a risky attack; I spent the available rewind and changed that decision. Won turn 6, then chose **Spirit Dust for Sera (MAG 10→12)** over Rescue Staff or 1,792 G + 25 team XP.

On the second map, I headed toward a Church with revival/promotion in mind. Edric visited a village for 500 G and Dracoshield. Ottoline used Mire twice with Dance to kill a Sniper without taking its counterattack—but I failed to protect her from the following enemy phase. A Paladin killed her, then killed Jaro on the next turn even after he had been healed. Edric took 19 from a General, retreated at 2 HP, received 23 healing, and then fell after an Archer hit followed by the Paladin.

The central error was evaluating safe individual attacks without sufficiently securing the whole enemy phase. Mire protected Ottoline from the Sniper's counter, not from later cavalry. Healing Jaro to full did not make a fragile dancer safe. Removing those support units then reduced both healing and action economy, making recovery much harder.

## Choices that felt dominated or overly obvious

“Strictly dominated” here means a known alternative is no worse on the relevant immediate outcome. Most observations below are instead party-dependent preferences or pricing concerns.

| Choice | Strength of evidence | Assessment |
|---|---|---|
| 271 fallback gold versus offered 700 gold + 25 team XP | **Strictly dominated immediate payout** | Both were visible in one reward roll. Keep fallback's intended role, but hide/de-emphasize it when an offered reward is already better gold plus XP. No need to buff fallback universally. |
| Keeping Elfire as Ottoline's default after obtaining Witchfire | **Clear local equipment upgrade** | Same observed might/hit/weight, with added crit and Mire. Paying 3,306 G remained a meaningful purchase decision; once owned, normal use strongly favored Witchfire. Progression upgrades are allowed to supersede older gear. |
| Healing Light versus Warding Charm for this party | **Strong situational preference** | At 20 damage, 30% heals 6 against 7 HP upfront. No ordinary speed follow-up. Crits/high damage could improve it, so not universally dominated. Its ordinary-use payoff deserves review. |
| Hiring promoted Ottoline for 1,052 G versus buying another ordinary weapon | **Potentially disproportionate value** | Far more immediate capability than the earlier 1,500 G Shine purchase. Different services, availability and deployment limits prevent a clean dominance claim. Sample more hire prices before changing them. |
| Warded versus Vampiric for Cael | **Role-specific preference** | Reliable mitigation favored my tank. A stronger attacker with many strikes could value Vampiric differently. No blanket rebalance recommendation. |
| Church followed by Ruins | **Overlapping route value** | Both offered healing/revival. The second service felt less distinctive; Ruins' market retained a purpose. Review service-function sequences, not just duplicate node names. |
| Late extra gold versus missing capabilities | **Campaign-state preference** | With substantial reserves, Longbow, Physic, a recruit, or a stat booster often addressed a real need more directly. This does not make gold globally weak. |

## Decisions that remained healthy and interesting

- **Iron versus Steel was not a simple tier ladder.** Iron's speed enabled 10×2 to kill a 19-HP Cleric where Steel's 13×1 did not. Keeping both was rational.
- **Range versus damage/speed:** Wind Sword and Longbow gave useful reach, but weight and counterattack exposure mattered.
- **Utility versus stats:** Physic over Power Ring/Aura was a genuine tradeoff that paid off in later maps.
- **Arts versus ordinary attacks:** Helm Splitter's HP cost, effectiveness category and lost normal follow-up made previewing necessary. Mire had a clear safe-range niche.
- **Deployment limits:** adding a strong hire or dancer meant leaving another useful unit behind.
- **Secondary objectives:** rescuing villages or a caravan competed with regrouping safely; failure was not automatically evidence of unfairness.

## What I would change in my next attempt

1. Treat an early Master Seal as a campaign investment and plan promotion access before Act 3, rather than prioritizing immediate healing in every reward decision.
2. Budget actions and movement for the *entire* enemy phase, particularly against mobile cavalry; fragile units must leave danger even after a successful attack.
3. Use Iron/default equipment deliberately before enemy phase, and avoid interpreting a favorable single forecast as a survival guarantee.
4. Spend banked gold on readiness when a real opportunity exists; extra cash cannot compensate for losing healing and Dance.
5. Keep growth/stat advice subordinate to the party's current role gaps, especially frontline RES and commander durability.

## Recommendations and limits

Prioritize information quality: complete shop comparisons, visible attack speed in Equip, clearer recruit loadouts, useful secondary-objective status, and the progression copy defects. The separate patch handoff contains reproduction notes and stability findings.

Do **not** infer from this one defeat that Normal needs broad weakening. Acts 1–2 were recoverable and often cleared quickly; Act 3 exposed mistakes that earlier encounters tolerated. Promotion timing and hired-unit pricing warrant targeted follow-up. The completed sample is one campaign, one first post-defeat shopping visit, and no Hard battles. No claim is made about long-run upgrade efficiency, blessing balance, promoted lord performance, or physical phone acceptance.
