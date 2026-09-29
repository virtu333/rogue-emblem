# Playtest triage — 2026-09-29

The owner's notes after PR #159 (Waves 3–4). Eight read-only investigations each checked their findings on main (b5ecdb9) and on PR #159's head. Line numbers are main unless marked.

**Priorities, owner's order:** (1) recruit efficacy, because lords are too strong; (2) bugs; (3) everything else.

## Findings

| # | Note | Verdict | Root cause / evidence | Proposed fix |
|---|---|---|---|---|
| 1 | Promoting at church took me to menu (Act 3), saved fine | **BUG — ghost click (reproduced)** | `bindCeremonySkip` (`ui/ceremonyDom.js:418-424`) dismisses on *pointerdown*, the rite goes `inert` (`GrowthCeremonyController.js:64-72`), and ChurchMenu re-renders before the finger lifts. The trailing `click` lands underneath. At the top right that is **Leave**: `leaveChurchNode` marks the node complete, saves, and returns to the route map, which in portrait is the "menu". In the middle of the list it opens another unit's Promote. Not specific to Act 3. Still reproduces on #159, where it also throws away the vow. | Swallow the next click (≤600 ms) at **document** capture inside `bindCeremonySkip` (as `rewardReveal.js:93-103` and `MobileBattleHUD.swallowNextClick` do). This covers every ceremony (seal rite, Colosseum, battle cards). e2e: tap the rite over Leave → church stays open, node not completed. |
| 2 | Finishing Act 2 took me to menu, then resumed Act 2 | **BUG — the same ghost click (reproduced)** | The "joins your army" card (`GrowthCeremonyController.showRecruit`) skips on pointerdown. Its layer is destroyed and the rewards screen is built under the finger. The trailing click hits **View map** (→ `PendingRewardController.leave()` → the Act 2 route map, reward pending) or **Menu** (→ Pause). Reproduced at Fast speed, with Reduce Motion, and with a tap held longer than the 300 ms exit at Normal speed. Claiming the pending reward from the map later shows "Act Complete!", which is the "resumed act 2". Also exposed: deed cards (click can hit **Recruit** or **Skip recruit** on the boss recruit menu) and level-up rites. Separate hardening: `transitionAfterBattle` (`PostCombatController.js:366`; #159 :370) calls `advanceAct()` without saving before the act card and story, so a reload there resumes on the finished Act 2 map. | Same fix as #1, but the swallow must listen on **`document` (capture)**: the layer is gone before the click arrives, so a root-scoped swallow fails (tested both). Unit test: pointerdown on the root, remove it, click a sibling → the handler doesn't run. Portrait e2e: Fast speed, touch on the join card over View map → still "Battle rewards". Plus: save right after `advanceAct()`, and persist the pending boss-recruit choice. |
| 3 | Thorns may not be working | **BUG in the playtested build; fixed by #154** | Builds with #152 but without #154 undid Thorns. Example: Edric with the Vampiric Rapier +1 against a Thorns Fighter ends at 19/28 (as if Thorns didn't exist); on main he ends at 13/28. Vampiric was not the cause. Still open: (a) the affix order: `['thorns','shielded']` reflects damage that Shielded then removed (`AffixEngine.js:204-234`); (b) readability: a bare red "3", the chip shows at 0, and the drain "+2" shows at full HP; (c) the help text omits "can't kill, rounds down, crits and overkill count, hits your counter". | Reflect after the damage-changing affixes; "−3 Thorns" label; hide a 0 chip; show only the drain actually healed; reflect in the forecast; help text. |
| 4 | Dragons too strong on Dusk | **BUG (gate) + BAL** | `filterClassPoolByDifficulty` (`constants.js:339-343`) opened Dragon, Dragon Lord, Zombie and Revenant to Dusk in **every act** (#152 meant Act IV only). So 48% of Dusk Act III battles have a Dragon (0% on First Light). The breath jumps from 8 to 15 might at L13 (`UnitManager.js:442,1550`). Dusk's +1 level pushes 53% of them past it, and one breath kills Edric from full 39–61% of the time. | **A:** `dusk.gatedEnemyClassActs: ["act4"]` + pass the act into the filter (Act III dragons and Act II zombies → 0% on Dusk). **B (optional):** cap Dusk dragons at Fire Breath. Also: `enemySkillChance` and `deployLimitBonus` in difficulty.json are read by nothing. |
| 5 | Lords too strong; Battalion cheaper; extra deploy slot even cheaper | **BAL** | Level for level the stat gap is small (+6–8% from Act 2 on, +13% in Act 1). Drivers: **Valor buys only lord power** (33.8k, with nothing else to buy); lord-only skills and gear; promotion is the bottleneck (3,500 g; the #159 vow makes it scarcer; Act 3/4 recruit nodes join promoted only 40% of the time); the Act 1 base-stat head start (+8). Recruit stat upgrades already cost about half the lord versions. | See Wave A. |
| 6 | 6 deploy in Acts 3–4 too low, 7 with the upgrade | **BAL** | `DEPLOY_LIMITS` (`constants.js:67-74`) act3 5–6, act4 6–6; the bonus is added to min *and* max. Spawn zones fit 8 in every act and 10 in Acts 3+. | act3 5–7, act4/finale/postAct 5–8; bonus on max only; raise the enemy caps for large maps to keep pressure. |
| 7 | Remove Expanded Ranks, infinite roster | **Owner: remove the cap, refund** | The cap checks are listed in the Wave A plan. | Refund 175 Supply once, with a `retiredUpgradeRefunds` ledger that survives the cloud and disk max-merge. |
| 8 | Sniper seems bad | **BAL** | Act 4 kill rate 57% vs Hero 73%; loses 38% HP per enemy attack; can't counter at range 1; promotion gives only +11 stats; Sure Shot is weak; recruited Snipers arrive with a Longbow. | Player-only `death_blow` class skill (58 → 73%); promotion STR +3 / SPD +3 / DEF +2, growth bonus SPD/STR; recruits get Steel or Recurve Bow; Recurve and Keen Bow in Act 3/4 loot. Optional code: "Point Blank" (range 1). |
| 9 | Trade opens highlighted | **UX** | The item card's and convoy's "Trade…" open with the source item **held** (`MobileRosterSheet.js:1016,1462`), so the first tap commits. Every open also puts DOM focus on row 1 (`TradeMenu.js:135`). | Open with nothing held; the cursor is logical until the first key or pad press; a pointer tap never leaves a focus ring. |
| 10 | Reorder and equip in trade | **FEATURE** | Same-unit swaps are rejected (`ItemTrade.js:201`); equipped = `inventory[0]`. | `planReorder`/`applyReorder`; same-column taps swap, and slot 0 becomes equipped if the unit can wield it. In battle: lock the move, write a "changed equipment" history beat, and save a checkpoint. |
| 11 | Skeleton revive indicator, attack to finish | **FEATURE** | Zombie and Revenant records (`scene._zombieTombstones`) have no marker and no interaction, and they block a Rout win. | `engine/ZombieRemains.js` (pure, shared with the harness), `RemainsMarkerController` (bone pile + countdown, fog-aware), a **Smash** verb (no roll, no RNG, can win a Rout). |
| 12 | Hints on the boss reward units | **UX** | The "Your army lacks a healer" cue strip and the "Best in draft / Grows fastest" legend and marks (`choiceCards.js`, `PartyMenus.js:188`). | `hints:false` on the boss arrival only; lord arrival and the arena keep them. |
| 13 | Caravan placement is sus | **BUG** | `pickCaravanSpawnTile` (`CaravanSystem.js:62-134`) spawns within 3 tiles of the enemies in 64% of maps and always walks toward the enemy edge. | Neutral band (≥6 from both sides, reachable), exit toward the player. |
| 14 | STR / MAG swap in the stat panel | **UX** | `MobileRosterSheet.stats()` flows `Object.entries(unit.stats)` row-major into 2 columns in portrait. | Display-only order helper; portrait: HP MAG STR SKL SPD DEF RES LCK MOV (left column HP/STR/SPD/RES/MOV). |
| 15 | Non-starting lords visible in home base | **Owner: hide until met** | No met-lord record exists; the Starting lords tab, the canvas picker, the Compendium and ReferenceMenu list all 7. | `lordsMet` meta (union-merged), written on every join path; `???` silhouette; Commander/Partner refuse unmet lords; backfill from records, and all lords count as met if Banner of Command is owned. |
| 16 | Buff Gambler's Coin | **BAL** | EV about +1 damage per strike; the Moontide Amulet (same price) beats it outright. Rolls are per tile and target, so they can be scouted. | 50% +6 / else −2 (EV +2, data only) and read the text from the data. Decision: keep scouting or roll once per unit per turn. |
| 17 | Vampiric and Warded too strong | **BAL + BUG** | Always on, both phases, and they add up across a battle. **Bug:** `defBonus` also reduces magic damage, so Warded cuts magic by 4 (`Combat.js:922-925,1448-1451,1555-1557`, global). | Vampiric 10% / max 1 HP per hit; Warded +1/+1; fix the DEF-on-magic double-dip (global); optionally buff Binding and Venomous. |
| 18 | Rapier equivalents for other lords | **BAL** | Deadly Arsenal gives a signature *by weapon type*. The Rapier is the only clear upgrade; Rowan, Astrid and Cael get heavy Horsebane or Hammer. | Personal weapons: Godsend (Rowan), Windward (Astrid), Holdfast (Cael), Endgame (Kira), Threadlight (Sera), optional Last Watch (Voss). |
| 19 | Story without Edric or Sera | **POLISH** | `DialogueCast` recasts Sera's seer lines onto any partner ("Hello, Sera." in #159's Lieutenant vision). A fallen Sera still speaks. | Gate seer lines on `when:{partner}` or Sera present, and add neutral variants. |

Also found: `sim/matchups.js` never passes `isInitiating`, so Death Blow and the other initiating skills never fire in `sim:matchups`.

## Plan (after PR #159 merges; each wave is its own PR)

**Wave A — Recruit efficacy (priority 1)**
1. Deploy curve: act3 5–7, act4/finale/postAct 5–8, bonus on max only; enemy caps 192:[7,14] 216:[8,15] 252:[9,16]; hold the recruit-node join average at 6.
2. Battalion prices: halved, Tactical Advantage 500 → 150 (gate beatAct1); revision-2 credit of the old − new price to past buyers. Tree total 11,575 → 5,600 Supply.
3. Remove the roster cap; retire Expanded Ranks with a one-time 175 Supply refund (ledgered).
4. Sniper: player-only Death Blow, promotion and growth bonuses, better bow on join, bows in Act 3/4 loot.
5. Recruit buffs (owner picks): non-lord church promotion 2,000 g; the Act 3 join bonus for every recruit source; recruit-node promotion chance 0.4 → 0.65; seasoned growths for boss recruits, mercenaries and the Vanguard Cadre; Skilled Recruits for boss recruits; recruit stat upgrades for mercenaries.

**Wave B — Bugs (priority 2)**: #1 ghost click, #2 save after the act advance (+ boss-recruit persistence), #4A Dusk act gate, #3 Thorns order and readability, #13 caravan, #17 DEF-on-magic double-dip, the sim `isInitiating` fix.

**Wave C — UX**: #9 and #10 trade, #14 stat order, #15 hidden lords, #12 boss-reward hints, #11 skeleton remains + Smash.

**Wave D — Items and lords**: #16 Coin, #17 Vampiric and Warded numbers, #18 personal weapons (+ icon atlas), #19 story gating.

## Owner decisions (2026-09-29)
- Hidden lords: only Edric and Sera show at the start; others appear once met and recruited (omitted, not silhouetted; Banner owners aren't auto-marked).
- Skeleton remains + Smash: approved. No runtime error box was seen (both "menu" reports were the ghost click).
- Dusk: no Dragons before Act IV (Zombie/Revenant unchanged). Gambler's Coin: better than Power Ring, and no fishing.
- Vampiric: 1 HP per hit that deals damage. Warded +1 DEF / +2 RES. Binding 50%. Venomous 7.
- Personal weapons approved; Voss gets a short bow, not the Rapier. Story without Edric/Sera: backlog.
- Battalion half price, more deploy slots, no roster cap (Expanded Ranks refunded). All extra recruit buffs.
- Sniper: player-only buffs (enemy Snipers are scary): no promotion boost, no extra bows.
- Stat panel: literal swap.

## Status: implemented on `claude/playtest-2026-09-29` (PR #159 + PR #160 + this batch)
| # | Done | Notes |
|---|---|---|
| 1, 2 | Ghost click swallowed at document capture after any pointer skip (`ceremonyDom.bindCeremonySkip`); save right after `advanceAct()`; boss-recruit draft saved and re-offered after a reload (`engine/PendingBossRecruit.js`). | Third-lord arrival has the same reload gap (follow-up). |
| 3 | Shielded settles before Thorns/Teleporter; "−N Thorns"; no 0 chip; drain shows HP actually healed; forecast projects the reflect; help text. | |
| 4 | `difficulty.json` `enemyClassEarliestAct` (Dusk: Dragon → act4). Dusk Act III dragon battles 48% → 0%. | |
| 5–7 | Deploy act3 5–7, act4/finale/postAct 5–8, bonus on max only; enemy caps raised; recruit join level averages the top 6. Battalion halved (Tactical Advantage 150, beatAct1), revision-2 credit. Roster cap removed; Expanded Ranks refunded 175 Supply once (ledgered). | No in-game notice of refunds/credits. |
| 5, 8 | Recruit promotion 2000 G (lords 3500); promoted joins 0.4 → 0.65; failed-roll join level follows the commander's effective level; join bonus for every base-class recruit source (Act 1 +8, later +6); boss recruits/mercs/Vanguard Cadre get seasoned growths, Skilled Recruits, recruit meta upgrades. Sniper: player-only Death Blow, joins with a Recurve Bow. `sim/matchups.js` and `sim/fullrun.js` pass `isInitiating`. | Open: Act 2 recruits now out-kill lords with no meta (+6 → +4?); promoted recruits still −7..−9 stat points vs lords (extend the bonus?). |
| 9, 10 | Trade opens with nothing held; cursor is logical until a key/pad press; same-unit reorder in trade (slot 0 = equipped), roster and battle (move lock, "changed equipment" beat, checkpoint). | |
| 11 | `engine/ZombieRemains.js`, `RemainsMarkerController`, `ZombieRemainsController`; Smash (no roll, no RNG, can win a Rout); fog-aware; harness shares the module. | |
| 12 | Boss arrival: no cue strip, legend, best/grows marks or hold tip. | |
| 13 | Caravan: ≥6 from enemy spawns, 6 (≥4) from the army, reachable, exits away from the enemy; caravan nodes avoid great_hall/chokepoint (`"caravan": false`), redraw up to 8 layouts, and a tag with no caravan is cleared. 0 misses in 37,716 generations. | |
| 14 | `ui/statOrder.js`: portrait 2-column order HP MAG STR SKL SPD DEF RES LCK MOV. | |
| 15 | `engine/LordsMet.js` + `MetaProgressionManager.lordsMet` (union-merged, backfilled); unmet lords omitted in home base, picker and Compendium. | |
| 16 | Gambler's Coin 50% +8 / −3, one flip per unit per phase; saved coins migrate on load (`engine/AccessoryCatalogMigration.js`). | |
| 17 | Vampiric 1 HP per damaging hit; Warded +1/+2; Binding 50%; Venomous 7. DEF bonuses no longer reduce magic damage (the bonus follows the stat the strike targets). | |
| 18 | Personal weapons via `signatureOf`: Godsend, Windward, Holdfast, Endgame, Threadlight, Last Watch (Voss). | Threadlight tests weakest; optional small RES bonus. |
| 19 | Backlog. | |
