# Fire Emblem tutorial sequencing and lessons for Rogue Dawn

Research date: October 3, 2026  
Status: Design research and proposed sequence, not an implementation spec

A good Fire Emblem tutorial gradually changes what the player is responsible for: first commanding one unit, then predicting danger, then coordinating allies, then managing a campaign. The map, roster, and enemy placement should make each new idea useful immediately. Instructions explain the situation; a second, less guided situation checks that the player understood it.

For Rogue Dawn, the recommendation is a short optional practice battle followed by contextual lessons during the first run. Preserve Fire Emblem's progression from simple actions to tactical decisions, but distribute the lessons across the run rather than reproducing Lyn Mode's campaign length.

## Evidence and scope

This document combines three kinds of evidence, kept separate below:

- **Direct viewing:** sampled visible gameplay from Toothache42's FE7 Lyn Mode playlist in the browser provided by Dave: Prologue and Chapters 1, 3, and 5. These were short playback samples and sought frames, not complete chapter viewings. Auto-generated captions were unsuitable for game text and were not used.
- **Reference research:** chapter descriptions and data for selected openings in The Blazing Blade, The Sacred Stones, Path of Radiance, and Awakening, plus Nintendo's Awakening instruction sheet. The fan-maintained references establish map content and reported tutorial behavior; they do not establish that a particular teaching method improves retention.
- **Design interpretation:** the proposed lesson order, pacing, assessment, and Rogue Dawn adaptation are recommendations, not claims about developer intent or measured player outcomes.

The provided [playlist's opening video](https://www.youtube.com/watch?v=9ZXb3w6mTYE&list=PLB1E7FB4B2C9B4F33) explicitly describes a Hard Mode playthrough. Lyn Normal's prologue is scripted; Hard removes that tutorial. Therefore this footage is evidence of battlefield structure and gameplay, not a recording of the Normal Mode prompts. [Prologue reference](https://fireemblemwiki.org/wiki/A_Girl_from_the_Plains).

Coverage is deepest for FE7. The other games are selected comparisons, not exhaustive audits of their opening chapters, regions, or difficulty modes. FE7 Chapters 4 and 6 onward were not directly inspected for this document.

## How the openings build responsibility

### The Blazing Blade

The selected chapters show a progression from one character to a team with distinct jobs. Chapter facts are sourced; the final column interprets their teaching value.

| Chapter | Verified content | Design interpretation |
| --- | --- | --- |
| Prologue, A Girl from the Plains | Lyn alone, two enemies, a seize objective. Normal guides movement, attacking, healing, and seizing; death is impossible in its scripted sequence. [Reference](https://fireemblemwiki.org/wiki/A_Girl_from_the_Plains) | Remove unit-choice complexity while establishing the full action loop. A boss defeat and an objective interaction are distinct actions. |
| 1, Footsteps of Fate | Kent and Sain join; three allies face five enemies. The chapter introduces weapon triangle and terrain advantages. [Reference](https://fireemblemwiki.org/wiki/Footsteps_of_Fate) | Familiar actions become decisions: which unit, which weapon, and which tile? New allies supply concrete alternatives. |
| 2, Sword of Spirits | Same three-unit roster, a seize objective, houses, forts, mountains, and a breakable wall. Normal requires house visits and terrain instruction before allowing freer play. [Reference](https://fireemblemwiki.org/wiki/Sword_of_Spirits) | Keep the roster stable while expanding interaction with the map. Reuse known commands to solve a new spatial problem. |
| 3, Band of Mercenaries | Florina and Wil join. Ranged combat, flying units, durability, and shops are introduced. [Reference](https://fireemblemwiki.org/wiki/Band_of_Mercenaries) | Specialist units broaden the meaning of reach and safety. This is a larger information jump; a shorter tutorial should split it across encounters. |
| 5, Beyond the Borders | Recruit Serra and Erk. Normal requires healing the wounded Erk with Serra, then attacking an archer with Erk, before releasing control. [Reference](https://fireemblemwiki.org/wiki/Beyond_the_Borders) | Give the new unit an immediate job. Existing damage makes healing useful, rather than an abstract menu explanation. |

The useful pattern is not a rigid rule of one mechanic per chapter: some chapters introduce several. It is that **new capabilities arrive with situations that demonstrate why they matter**, while previously learned actions continue to be used.

The cost of strict scripting is also clear as a design tradeoff. A player can follow the required cursor path without learning how to choose that path. Borrow the focused first demonstration, then release control and ask for a comparable decision in a different position.

### The Sacred Stones

The prologue begins with Eirika and Seth against three enemies. Easy provides a scripted sequence that cannot be lost; Normal and Difficult permit ordinary play. Chapter 1 introduces Franz and Gilliam during battle and uses a castle-seize objective. Vanessa and Moulder are granted at the end of that chapter. Chapter 3 adds Neimi's archery and Colm's thief role, including a lockpick and recruitment through conversation. [Prologue](https://fireemblemwiki.org/wiki/The_Fall_of_Renais), [Chapter 1](https://fireemblemwiki.org/wiki/Escape!), [Chapter 3](https://fireemblemwiki.org/wiki/The_Bandits_of_Borgo).

**Interpretation:** Seth offers a powerful fallback alongside the novice protagonist, and later additions broaden the team's jobs. The opportunity is to let the player recover from imperfect choices without a reset. The risk is that an overwhelmingly strong fallback can solve the map without the learner practicing coordination. A practice map should let support make the learner's plan safer, while leaving the learner meaningful work.

### Path of Radiance

The prologue explicitly frames play as training: Ike spars first with Boyd and then Greil, with Anna tutorials offered along the way. A Vulnerary is given after the Boyd fight. Chapter 1 moves into a real mission with Titania, Oscar, and Boyd and a seize objective. Experienced mercenaries teach and support Ike in the story. [Prologue](https://fireemblemwiki.org/wiki/Mercenaries), [Chapter 1](https://fireemblemwiki.org/wiki/The_Battle_Begins).

**Interpretation:** a training fiction makes restricted scope and recovery feel natural. The second opponent also creates a chance to reuse an action immediately. The next mission changes the social and tactical setting while preserving the basic loop. Rogue Dawn could use a brief in-world instruction to give the player a reason to care, without requiring a long narrative prologue.

### Awakening

Nintendo's instruction sheet says Normal difficulty presents battle tutorials through Slide Guides and documents a control for showing enemy movement and attack ranges. In Chapter 2, Stahl and Vaike join, and Miriel arrives on turn 2. Vaike initially lacks his weapon; Miriel brings his axe. [Nintendo instruction sheet](https://csassets.nintendo.com/noaext/image/private/t_KA_PDF/3DS_Fire_Emblem_Awakenings_single_sheet_en?_a=DATAg1AAZAA0), [Chapter 2](https://fireemblem.fandom.com/wiki/Shepherds_(Chapter)).

**Interpretation:** the missing axe turns inventory into a concrete problem, rather than a menu tour. This is a useful template for contextual learning: introduce a command when the player has a reason to use it. However, a unit unable to act can look broken if the explanation is missed. Show the cause and the remedy at the same time. This comparison does not establish the exact introduction order of Pair Up or other Awakening systems.

## Notes from the provided Lyn Mode footage

Timestamps below identify sampled scenes, approximately. They are anchors into this particular run, not durations for completing a lesson. Viewing notes describe what was visible; implications are interpretations.

| Sample | Visible evidence | Implication |
| --- | --- | --- |
| [Prologue around 1:36](https://www.youtube.com/watch?v=9ZXb3w6mTYE&t=96s) | Bandit versus Lyn combat displays each side's weapon, HP, Hit, damage, and critical chance. | Teach one prediction from the exchange before explaining every statistic. Start with damage and retaliation. |
| [Prologue around 2:01](https://www.youtube.com/watch?v=9ZXb3w6mTYE&t=121s) | Lyn fights Batta after the ordinary bandit encounter. | The ordinary enemy and boss offer successive uses of the same combat model. |
| [Prologue around 2:49](https://www.youtube.com/watch?v=9ZXb3w6mTYE&t=169s) | Lyn's level-up panel follows combat. | Show growth as a reward for doing the action. Detailed growth formulas can wait. |
| [Chapter 1 around 4:01 to 4:50](https://www.youtube.com/watch?v=MH5Stoy2GZM&t=241s) | The battlefield has forests, a river, and bridges; a later sample shows Kent fighting an axe bandit with an Iron Sword. | Unit selection, equipment, and geography now vary within the familiar loop. The sample alone does not prove the tutorial explanation of those choices. |
| [Chapter 3 around 5:02](https://www.youtube.com/watch?v=pVkvFOzK3kA&t=302s) | A village interaction awards 2,000 gold on a map containing walls, buildings, and separated routes. | A noncombat interaction has an immediate, readable payoff. Teach visiting through a visible opportunity. |
| [Chapter 5 around 3:07](https://www.youtube.com/watch?v=AypsdJz8To4&t=187s) | Sain's attack forecast against an Iron Bow archer shows no retaliation values on the archer's side. | Range restrictions can be taught with a concrete safe matchup, once the player understands ordinary counters. |

The Chapter 5 Normal-mode heal-then-magic sequence in the comparison table comes from the chapter reference, not these Hard Mode samples. No claim is made that the viewed player needed guidance or learned from these actions.

## Recommended sequence for a Fire Emblem style tutorial

These are learning stages, not necessarily separate maps. One small battle can cover the first several, but it should pause at natural decision points rather than front-load their explanations.

| Stage | Playable situation | What to teach | Evidence of understanding |
| --- | --- | --- | --- |
| 1. Give one order | One active ally, one reachable enemy, obvious objective | Select, move, open Attack; distinguish planning from confirmation | Player opens a forecast and knows they can cancel before committing. |
| 2. Predict an exchange | A survivable melee matchup | Damage per hit, remaining HP, counterattack when in range; Hit is a chance | Player identifies whether the attack can finish the enemy and whether retaliation is safe. |
| 3. Read the next phase | A remaining enemy can reach a careless destination | Threat range, Wait, End Turn, enemy phase | Player checks reach and chooses a safe tile or deliberate bait before ending the turn. |
| 4. Coordinate two units | Frontline ally is wounded; support can help | Action order, healing, keeping a fragile ally out of danger | Player heals and protects support without a prescribed tile-by-tile path. |
| 5. Compare tactical options | Alternate cover and weapon matchups; then a ranged enemy | Terrain, weapon triangle, attack and counter ranges, follow-up attacks as they appear | Player compares forecasts or destinations and selects a survivable option. |
| 6. Fulfill a different objective | A small seize, defend, or escape scenario | Read the win condition; fighting is a means to it | Player completes the objective instead of assuming every enemy must die. |
| 7. Manage persistence | First meaningful reward, supply use, or route choice | What refills, what is spent, what carries forward | Player can distinguish battle resources from run resources before spending them. |
| 8. Play independently | Familiar mechanics in a new layout | No new core rule; prompts fade | Player completes an encounter without directed selections or destinations. |

For a conventional campaign, these stages could span a handful of early chapters, with roster expansion marking the transitions. For a roguelike, separate the reusable practice from contextual instruction so a new run does not restart a long course.

### How each lesson should behave

Use a recurring rhythm: **need → brief explanation → action → visible result → independent reuse**. For example, a wounded ally creates the need for healing; the staff's effect and range explain the action; restored HP confirms it; another wounded ally later checks transfer.

Hard gates are most useful for the first selection, move, and attack confirmation. After that, guide toward a tactical goal and accept multiple valid solutions. An instruction such as “keep Sera outside enemy reach” teaches more than insisting on a single tile, provided the threat display makes the goal legible.

Teach information before the commitment it changes. Explain counters while the forecast is open; explain threat range before End Turn; explain consumable lifetime before use. Keep the subject visible and current. At 640×480, a lesson that covers the forecast or the unit it names defeats its own purpose.

Distinguish exposure from mastery. Opening a hint is evidence that the hint appeared, not that its lesson was learned. Track actions and decisions separately from displayed explanations. Cancellation, alternate valid actions, and skipped lessons should not break progression.

Safety should preserve the rules being taught. Tune the practice matchup to avoid lethal retaliation and unexpected critical deaths; verify miss and repeat-turn outcomes. If a demonstration needs guaranteed damage or a prepared wound, disclose the setup. Do not silently misrepresent normal combat to force the lesson.

## Proposed adaptation for Rogue Dawn

The existing tutorial already has useful infrastructure: a fixed 8×6 rout map; Edric and Sera; a Fighter and Archer; a Fort; a persistent coach; initial Edric-to-Fort guidance; conditional forecast lessons; staff-versus-consumable instruction; and recovery guidance. Sera is currently a **Light Sage with Glimmer and Heal**, rather than the Cleric described in the older tutorial draft. This is established from the current source, not a new browser playtest.

Relevant implementation references:

- [Tutorial setup](../src/engine/TutorialHelpers.js)
- [Coach goals](../src/ui/tutorialCoachModel.js)
- [Tutorial controller](../src/ui/TutorialController.js)
- [Forecast lessons and displayed-lesson tracking](../src/ui/tutorialLessons.js)
- [Earlier onboarding review](onboarding-review-2026-09-20.md)

### Practice battle

Proposed target: roughly 4–6 minutes for a novice, to be measured in playtests rather than treated as an established completion time.

1. State the rout objective and identify Edric as commander. Give a brief reason to practice safely before a run.
2. Select Edric and move onto the Fort. Explain cover only after the terrain panel shows the arrived tile. Release the exact-movement gate.
3. Open an attack forecast. Teach damage, confirmation/cancel, and whether the enemy can counter. Let the player inspect and back out.
4. Before ending the first turn, check the remaining enemy's threat. Explain Wait and End Turn separately: ending one unit's action is different from handing control to all enemies.
5. On a later player phase, use Sera to heal a wounded ally while keeping her safe. Display “refills each battle” for staff uses and “spent permanently” for consumables before either is committed. If no wound occurs, provide a clearly explained optional healing exercise rather than silently marking healing complete.
6. Approach the Archer using what the player now knows about attack and counter range. Introduce triangle or doubling only when a relevant forecast appears, one concept at a time. A skipped opportunity remains eligible in the first run.
7. Finish without selecting the player's final unit or destination for them. Confirm completion and provide a direct first-run handoff and replay option.

This order is a proposal. It does not claim that the current two-enemy layout guarantees every exercise. Before implementation, verify that enemy placement and all relevant combat outcomes allow at least one enemy phase, a healing opportunity, and independent reuse. If the battle ends too early, change the encounter structure rather than adding explanations after victory.

### Recovery and the first run

Explain commander loss and ally loss before the player is exposed to them. Offer an optional prepared rewind exercise after basic combat literacy; do not require the player to deliberately kill Sera to discover Vision. The current controller introduces a death-triggered tutorial charge, so a prepared exercise would be a deliberate behavior change requiring a separate implementation decision. Explain that real-run charges last the run and that the timeline can be inspected before spending.

Keep advanced lessons tied to actual first occurrences:

| Moment | Proposed instruction |
| --- | --- |
| First route choice | Identify the node types actually present and the immediate consequence of choosing a path. |
| First deployment or recruit | Explain how this unit changes the team's options, with one concrete job to try. |
| First reward | Explain the offered benefit and what persists. Introduce turn/par rewards here, after survival is understood. |
| First new battle objective | Explain its success condition before the first order, with the relevant location or counter visible. |
| First shop, promotion, skill, or unusual enemy | Explain the decision at that surface; keep detailed rules available in Help. |

These are proposed trigger locations, not a fixed number of battles. Do not promise a Church, shop, or particular recruit if the generated run does not provide one. Preserve the current principle of suppressing only explanations actually displayed, while recognizing that displayed-lesson tracking is not mastery assessment.

### What to verify in a novice playtest

The central question is whether the player can make a safe decision in a new position after guidance fades.

- Can they cancel a forecast and explain what damage and retaliation imply?
- Do they inspect enemy reach before exposing Sera or ending the turn?
- Can they heal without a directed tile sequence and distinguish staff charges from consumable supply?
- Can they complete an unguided encounter and recognize a different objective?
- Do lessons remain readable at 640×480 and on touch controls, including long names and visible highlights?
- Do skip, leave, retry, cancellation, and rewind preserve a coherent lesson state?

Record wrong commitments, requests for help, repeated explanations, and success on independent reuse. Completion time is useful, but a fast click-through is not evidence of tactical understanding.

The next design decision is whether the existing practice battle can reliably support this sequence or needs a small second exercise. That should be resolved through encounter checks and novice observation before committing to a larger tutorial campaign.
