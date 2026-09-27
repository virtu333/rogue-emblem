# Normal / Hard continuation — September 26

Exact baseline: combined portrait stack `7689a2c8840cd73707b561f03ee6debe8d87f47a`, based on main `b8e13bf`, integrating PRs #99, #122, #124, #125, #126, #128, #129. Does not include subsequent merges. Include this baseline in every progress/report update at the user's request.

Same isolated origin localhost:3099 and combined portrait stack as preceding report. 390x844 desktop-hosted portrait, sound off. No physical phone or latest-main claim.

## Act 1 boss
- Began with Edric Lv5, Sera Lv5, Cael Lv4, 1754 gold, one rewind.
- Clear seize tutorial. Split deployment; regrouped. Cael countered archer, gained Lv5. Iron Sword doubled where forged Steel did not; Sera Lightning doubled Cavalier.
- Genuine turn-4 positioning error: Cael occupied melee finishing tile, Edric could not finish with Wind Sword. Restored Start of turn 4 using Rewind, exactly one charge consumed, units returned to their previous positions and HP.
- Revised sequence: Cael Hand Axe through wall (8 damage, 50% displayed), Sera Lightning 12, Edric Steel Sword 7 finishing blow. Boss fell. Edric Lv6.
- Seized turn5 rankS with all three alive/full HP; another defender remained alive. Objective updated from defeat boss to capture throne.
- Deed Bossbane awarded Edric, Fiendish Blow oath at promotion; portrait presentation fitted.
- Boss draft: Hollis Mercenary / Voss Ranger / Ysolt Wyvern. Chose Voss because party lacked archer. **Confirmed clarity gap**: draft says Your army lacks an archer but Voss starts with only Steel Sword, no bow. Bow proficiency yes; immediate ranged role no. Roster equipment 1/5 confirms.
- Chose Killing Edge, assigned Edric. Gold3192. Entered Act2, shadow0. Rewind replenishment not yet checked.

## Act 2 battle 1
- Rewinds correctly replenished to1 after act1boss.
- Fog/forest map, split Voss western spawn, four party members. Won turn5, no deaths. Gold4425 after payout. Chose Longbow for Voss over948gold+25teamXP and MightWhetstone: distinct range2-3 utility worth immediate gold opportunity cost.
- Healing staff refilled4/4. Sera healed Edric and used Vulnerary (9->19HP) while other units cleared threats; recovery room existed.
- Enemy Cleric advanced and healed Thief. Prioritized Cleric, a meaningful change in target priority. Thief used forest/mountain cover causing very low axe hit (12% Hand Axe/30% Iron Axe from mountain target), but dealt0 toCael. Cael landed the30% finish; don't portray this as guaranteed safe speed clear.
- Selected Edric forest attack against Fighter: forgedSteel98%/11x2; KillingEdge96%/11x2/33crit. No crit; Fighter left3HP, Cael finished. Good weapon tradeoffs, accuracy forge still mattered.
- No crash/blocked menu. Low-HP enemy + defensive terrain + healer prolonged cleanup but not unfair trap. Safety text explicitly notes fog may hide more.
- User requests broader experiential assessment: distinguish intended first-run difficulty from friction, track recovery room, resource pressure and meaningful decision tradeoffs.

## Act 2 battle 2 — Corridor Siege
- Won turn4, all four alive. Gold5799. Cael absorbed6damage on enemyturn2 and countered cavalry/fighter; party cleared them next turn. Sera took9 from Myrmidon but survived comfortably, Voss safely finished it with Longbow.
- Iron Sword10x2 at100% killed19HP Cleric, while forgedSteel13x1 did not. Good ongoing reason to retain lower-tier gear.
- Chose Physic (range2,2uses/battle) over PowerRing+2STR and Aura (+6 displayed attack) to address healing reach. Received correctly in Sera fifth equipment slot. Heal refilled4/4, Mend3/3, Physic2/2 after battle.
- Used Vulnerary between battles from roster: Sera12/21 ->21/21, uses2->1, Use disabled with HP-full explanation.

## Act 2 battle 3 — Mire Crossing (ongoing)
- Selected Astrid recruit over regular battle; wanted flying mobility and another lord. Eight enemies, par12, Hunters+1/Captain labels.
- Astrid safely behind party in southeast, enemies all far north. Edric could move adjacent and Talk turn1 without danger. Wording implies urgency that this map does not immediately deliver. Observation, not general map-generation conclusion.
- Bog makes movement slow and reachable range irregular. Party regrouping with no combat on turn1. Astrid starts SteelLance,19HP,Lv7; recruited successfully and can act same turn.

### Mire Crossing result
- Won turn7, all5alive,7600gold. Astrid contributed two finishing kills. Staff healing and Vulneraries provided recovery after mistakes; no rewind needed.
- Edric fell to3HP after poor positioning against a SteelLanceKnight. Mend recovered him; this was a tactical mistake with a recoverable consequence, not an unfair difficulty finding. He did0 WindSword damage to that Knight. Cael and Voss (Resolve at below50%HP) chipped/killed armor instead.
- Physic successfully healed Astrid from2tiles. Used Mend on Cael before finishing lastKnight. Voss13/28 aftermap, used oneVulnerary ->23/28,2usesleft.
- Silhouette readability: mistook Thief for Mage, and Mage for Archer before forecast identification. Small portrait map sprites remain difficult to classify confidently by silhouette. This is subjective perception evidence, not wrong-asset verification.
- HelmSplitter chosen overPowerRing/InfantrySeal/gold. Expanded reward detail explicitly explained ×3weaponmight,4HPcost,3charges,binding, and no ordinary speedfollowup. Binding worked viaSkills->Teamscrolls->IronAxe->confirmation;scrollcount1->0 with successmessage.
- Edric/Sera masteredclasses after8battles; reward notes visible.
- Next choice two EliteSeize/HilltopFortress options: village vs caravan. Chose caravan to find gear with7600bankedgold. Screenshot act2-elite-approach.png.

## Elite Hilltop Fortress (ongoing)
- Split starting deployment: Edric/Cael west, Sera/Voss east, Astrid between. Retreat/regroup rather than exposing Edric to overlapping enemies.
- Actionable UI gap: Equip menu lists Mt/Hit/Crit/Range but omits weight or resulting attack speed, precisely when selecting a safer enemy-phase weapon. Forecast has AS, but no attack target available at this point.
- Merchant was attacked for18 on enemyturn1, defeated on enemyturn2. History clearly recorded Merchant moved, Fighter hit Merchant18, Fighter defeatedMerchant. Main objective panel only discussed seize/boss; status was discoverable in timeline. Did not continuously observe all animations, so do not assert no transient death message existed.
- Used one rewind toStartturn2 to try Physic rescue; turn restored and1->0charge. Sera reached8,6, exactly2tiles fromMerchant8,4 withPhysic2/2 carried, but noHeal action appeared. Needs investigation of NPC-healing eligibility; not yet a confirmed bug. Revised attack usedLightning instead ofShine, remaining actions repeated safe regroup.
- Declined HelmSplitter from exposed tile: forecast19damage vs26HPKnight, cost4HP, counter8, fivefoes couldreach. Clear decision against using the art here, despite newly binding it.

## Continuation after patch handoff
- Published patch-handoff.md and chronological notes to docs/playtest-round3-2026-09-26, commit cc9aae1. Baseline unchanged.
- Reopened isolated save after old tab closed. Resume restored Turn3,0rewinds,2ready. Initial IAB viewport mismatch caused pointer issues; fresh tab fixed it. Exclude those from game findings.
- Elite Hilltop Fortress won Turn8 RankS; all5survived. Victory explicitly displayed Caravan destroyed. SeraBossbane deed granted. Cael HelmSplitter->VossLongbow safely killed regularKnight; bossKnightCommander was cavalry, not assumed armored. Astrid withdrew at5HP, usedVulnerary. Bossdefeated thenEdricSeize.
- 9792gold, chose2rewards: Warded imbue onCaelIronAxe (+2DEF/+2RES) and SilverWhetstone->SeraShineweight-1. Roster confirmed both and existingHelmSplitter preserved. ChoseWardedoverVampiric because smallperhit healing vs consistentmitigation.
- Colosseum row5: hiredOttoline promotedSageLv1,26HP13MAG7SPD5DEF9RES for1052G,8740remaining. Strongvalue besideearlier1500GShine purchase; onecomparison only. ShecamewithElfireonly; gaveSeraHealstafftoher. Arena remainedavailable afterhire. PreviewedEdricSilvermatch:WindSword3x2 vsCavalier13counter;declined. No obviousweaponselectorinArena forecast; hadtoreturnRoster to changeequipment. Didnotfightarena.
- CaelVulnerary15->25HP; EdricIronSwordequippedfromRoster. NextJaroDancerrecruit onlyrouteavailable.
- Deploymentcap5 meantbenchwoundedAstrid fornewSage;meaningfulrosterchoice. JaroDancerLv9recruitedTurn1;DancesuccessfullyrefreshedEdric same turn. CorridorSiege9foes,par10. Turn2 regroup;CaelWardedtank at4,8; enemiesclustered.
- Jaro Corridor Siege won Turn5 RankS, all7 roster alive. Dance refreshed Voss for a second attack after a 91% miss; promoted Ottoline one-shot a Knight with Elfire and adjacent-ally Spell Harmony. No progression blocker.
- 10722G after victory. Healing Light reward details: 7HP cost, heals30% damage, +10Hit,2uses/battle,no ordinary speed followup. At20damage that heals6, net-1HP: unattractive for this party beside status immunity, though higher damage/crit could change value. Chose WardingCharm forCael.
- Entered Act2row7 RiverCrossing fog Rout7/par9 with Edric,Sera,Cael,Voss,Ottoline. Jaro/Astrid benched under5cap. Full deployedHP. No rewinds. Normal attempt ongoing; Hard/progression coverage not yet done.
- River Crossing won Turn5; all7 alive. Timeline confirmed Voss98% miss and Cael97% miss (not evidence of RNG defect); later Voss hit17 leaving cleric2HP. Recovery healing before final kill restored deployed party. Cael mastery unlocked. Talisman reward appliedCaelRES3->5 rather than suggestedOttoline (highestgrowth advice is not necessarily best immediate recipient).
- Unexpected page reload at approximately03:25:52UTC whileVossmovingTurn4. No capturederror, Vite reconnected; checkout still7689a2c. Resume restoredTurn4/oneenemy/oneunitready with completedactionsintact. Unknowncause, notclassifiedconfirmedgamecrash.
- Sera leanlevel gained+1SPD butquote said Nothing gained; lowpriorityflavor mismatch.
- Ruins freeheal restoredreserves. Restock150G producedWitchfire3306G (ElfireidenticalMt/Hit/weight but+30crit andMire); boughtforOttoline. Shopcompare onlyAtk20->20/AS3->3 hidmeaningfulcritimprovement;Rostercomparison correctlyshowedcrit+30. BoughtLifeRing2875forEdric(+2Atk/+2DEFabove75%HP). Restock200 revealedAura/InfantrySeal;sealclearlyreclass,notpromotion. Reserved5799G. NoMasterSealoffered; startinglordsstillbaseLv10/12enteringAct2boss.
