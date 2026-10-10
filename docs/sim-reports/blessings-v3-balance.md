# Blessings v3 balance, with policies that claim the cards

Report of `npm run sim:blessings` (2026-10-10). The runs were played at `1a11bb2c` (main
`7c9a9305`, which has the #272 Talk-recruit fix, merged into this branch). The tables were
aggregated by `fc5a1936`, which changes only how the report compares cards. **No card data was changed for this report.** It
measures the cards; it does not retune them.

## Why

The v3 PRs (#264, #267-#271) shipped 59 blessings and 6 gifts. Their full-run simulations never
took an earned pick or an event grant, never stole, swapped, rewound or made a second church vow,
and never chose a start blessing or a gift. The green CI sims were evidence that existing paths
did not regress. They were not evidence about the new cards. This report plays runs where a player
claims all of those, and asks two questions of each card:

- Is its mechanic actually exercised?
- Do runs that took it end better or worse than comparable runs that did not?

## What the stock sims could not reach, and what now reaches it

| Mechanic (PR) | Cards | Now exercised by | Per run (1000 runs) |
|---|---|---|---|
| Start blessing (the sims took none) | all 39 shrine cards | `chooseStartOffer`: a keyed-random pick among the offered cards, the gift and "no blessing" | blessing 69%, gift 9%, none 22% |
| Gifts (#271: sims passed no `runsStarted`) | 6 gifts | the driver starts runs as a returning player (`runsStarted: 1`); the gift is one of the shrine's options | offered 51%, taken 9% |
| Owed earned picks (#264, #268-#270: skipped) | act boss pair, eclipsed elite, Colosseum | `takeOwedEarnedPicks`: one card of each owed pick, by the engine's take | 5.4 picks taken a run |
| Old Sanctum vow (#268, #270) | Tithe Box, Saint's Reliquary + filler | `playChurch` takes one of the sanctum's pair as the church vow; the route prefers a visible sanctum | 25% of runs |
| Event grants (#268, #270: event policies skipped them) | Crest of the Road, Smith's Covenant, Thief's Lantern | `chooseClaimEventPlan`: a choice that may grant an earned card first | 13% of runs (Smith's Covenant 128, Crest 6, Thief's Lantern 0) |
| Colosseum card and Ledger fees (#270) | Mercenary Ledger | `playColosseum`: arena bouts at 60%+ win odds through the overlay's engine calls; the first gold/platinum win offers the card | 28% of runs fight; 185 Ledgers taken |
| Battle loot (#267: "takes no loot") | Lottery Loot, Dawn Tithe, Hollow Sun's Favor's loot gold | `claimBattleRewards`: `prepareBattleRewards`, then the best card by a simple value through the reward commands | every battle |
| Steal (#267) | Cutpurse's Luck, Thief's Lantern | harness Steal (opt-in, `HeadlessBattle` `steal`), planned by `ClaimingAgent` | 179 steals in 1000 runs (10% of runs) |
| Swap a candidate (#267) | Open Roll | `chooseRecruitCandidate`: meet the alternate when the engine-built unit is stronger | 40 alternates offered, 16 swaps |
| Rewind (#267: "never rewinds") | Watcher's Grace, Second Dawn, Darkened Dawn, the base charge | Vision rule: spend a charge on a fall the policy judges worth it; replay the battle with the same dice, then play that turn cautiously | 6.8 rewinds a run; 36 on a Watcher's Grace charge |
| Second church vow (#267: "makes one vow") | Twin Chapel | `playChurch`: vows in order sanctum card, Promotion, Cleanse, Blessing, each different | 8 second vows (6 of 15 Twin Chapel runs) |
| Talk recruits | Open Roll, Nomad's Pact, Crest of the Road, Blood Covenant joiners | TacticianAgent `rescue` (lords walk to the recruit and Talk), now counted | 2.4 a run |
| Church services | Kingmaker's Oath (free promotion), Tithe Box | `promoteAtChurch`, `payChurchTithe` on entry (the stock church promoted by hand) | 0.3 promotions a run |
| Shop forge | Smith's Mark, Smith's Covenant | `forgeAtShop`: every free forge, one paid forge when gold is 3000+ | 5% of runs forge free |
| Between battles | Field Medic, Quartermaster Cache, Fallen Hoard, Stranger's Scroll, Scroll Archive, Kingmaker's seal ban | items (heal below 60%, Gold Pouches, boosters), accessories, scrolls, Master Seals | heals 8.9, scrolls 2.4 a run |
| Lone Banner's XP (#267) | Lone Banner, War Veteran, Chronicle | the driver passes the run's XP delta to every battle (the strategy sim did not) | passive |

Not reached (see "Limits"): a Thief's Lantern or Seer's Eye route scout (the route policy does not
read previews), Omen Reader's marks (same), weapon arts (Bloodless Art, Scroll Archive: the battle
agent never uses an art), Branching Threads rerolls (a meta upgrade: these runs have no meta).

## Method

- **Runs.** `sim/blessings.js` plays seeded full runs with `tests/sim/ClaimingRunDriver.js` and
  every policy in `tests/sim/ClaimingPolicies.js` on. 1000 runs: First Light 300, Dusk 300,
  Nightfall 200, Black Sun 200 (two processes, about 40 minutes: First Light 2 s a run, Black Sun
  7 s). Each rung uses its own seed range (`--seed 1`, offsets of 100000 per rung), so the shrine's
  offers differ between rungs.
- **Battles.** `ClaimingAgent`: the strategy sim's TacticianAgent, plus a Steal plan and a
  cautious mode after a rewind. The run is attached to each battle, so blessing combat modifiers,
  staff and art options act as in the scene. **Casual commander**, as `sim:strategy` does: a
  commander KO is counted (the run would have ended) and the commander is restored, so every run
  reaches its end. Every other fall is real permadeath; the church policy revives the fallen when
  it can pay. A battle still unwon at turn 30 is completed as won and counted as a stall.
- **Vision.** On a fall the policy spends a charge if the commander fell, if a lord fell, if the
  battle is a boss map (a Watcher's Grace charge fades, an act boss returns one), or when two or
  more charges are left. The rewind goes to the start of that turn's player phase (the previous
  turn if this one was rewound already); at most 3 rewinds a battle. It is replayed from the
  battle's entry state with the same dice (a stateful Math.random put back, as the fixed-v1
  rewind puts its stream back) and the recorded actions; the run's convoy, accessories, gold,
  next uid and blessing modifiers are put back with it. Replays were checked identical to a replay
  in which the agent re-chooses every action (`verifyReplay`, 0 mismatches, also in the guard
  test). The rewound turn is then played cautiously (every unit plans against the worst case).
- **Choices are keyed.** Every policy choice between equals (which offered card, which pair card)
  is a hash of the run seed and a key, never Math.random. So whether a run takes a card does not
  depend on how the run is going.
- **Comparisons.** For a start card or gift: the runs that took it against the runs offered it
  that took something else (another card, the gift or nothing), over the whole run. For an
  earned card from a pair (act boss, sanctum): took it against took the other card of the same
  pick, over the battles from that offer on. For an eclipsed elite's card (always taken): the runs
  whose first eclipsed-elite drop was this card against those whose first drop was another. Because
  the picks are keyed by seed, these are randomized comparisons. Per-rung differences are pooled
  with weights nA·nB/(nA+nB); intervals are 95% (Welch standard errors). An earned card's
  difference is **relative to the alternative card it was offered with**, not to "no card".
- **Outcomes.** `koBattle%`: share of battles with a commander KO. `ko/battle`: commander KOs per
  battle (severity; a restored commander can fall again). `deaths/battle`: other units' falls.
  `winsBeforeKO`: battles won before the first commander KO. `stall%`: share of battles unwon at
  turn 30. `gold`: gold at the run's end. Lower is better for the first four ko/death/stall
  measures, higher for `winsBeforeKO` and `gold`.
- **Exercised.** For a card with a detector (a Banner hold, a lantern heal, a steal, a swap, a
  second vow, a lottery card, Dawn Tithe gold, a free forge, a tithe, a halved arena fee, a rewind
  while a Vision card is held, ...): the share of runs holding it where it fired. A passive card
  counts as exercised when held in a battle.
- **Flags.** "nominal": a 95% interval that excludes 0, with at least 10 takers. With about 65 cards
  and 6 outcomes, roughly 20 nominal flags are expected by chance alone. "family-wise" (FW): |z| ≥
  3.66 (Bonferroni at 0.05 over about 400 comparisons). Only FW flags are strong evidence.
- **Reproduce.** `npm run sim:blessings -- --trials 300 --difficulty normal --out fl.jsonl` (and
  `dusk` 300, `hard` 200, `lunatic` 200), then `npm run sim:blessings -- --from fl.jsonl,dusk.jsonl,nf.jsonl,bs.jsonl --md tables.md`.
  `--workers 2` splits one batch over two processes.

## How hard the runs are for this player

The agent loses badly above First Light. Read every difference on Nightfall and Black Sun as close
to uninformative: nearly every battle there has a commander KO, and 41% (Nightfall) and 60% (Black
Sun) of battles hit the turn cap.

| rung | runs | battles | koBattle% | ko/battle | deaths/battle | winsBeforeKO | stall% | clean% | gold | rewinds | stalls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| First Light | 300 | 22 | 41.1 | 1.6 | 0.78 | 6.25 | 10.3 | 0 | 5095 | 5.2 | 2.29 |
| Dusk | 300 | 30.1 | 72.7 | 4.43 | 0.6 | 1.76 | 24.2 | 0 | 7975 | 6.33 | 7.28 |
| Nightfall | 200 | 31.3 | 92.9 | 8.89 | 0.63 | 0.15 | 40.8 | 0 | 5951 | 8.3 | 12.79 |
| Black Sun | 200 | 31.4 | 97.6 | 20.64 | 0.68 | 0.01 | 60 | 0 | 6294 | 8.35 | 18.82 |

## Results

### Claiming policy coverage

| claim | per run | runs with any |
| --- | --- | --- |
| startBlessings | 0.69 | 69% |
| startNone | 0.22 | 22% |
| giftsOffered | 0.51 | 51% |
| giftsTaken | 0.09 | 9% |
| giftRefusals | 0 | 0% |
| earnedOffers | 5.41 | 100% |
| earnedTaken | 5.41 | 100% |
| eventEarnedGrants | 0.13 | 13% |
| sanctumTaken | 0.27 | 25% |
| rewardClaims | 27.17 | 100% |
| lotteryCardsOffered | 0.73 | 4% |
| lotteryCardsTaken | 0.3 | 4% |
| dawnTitheGold | 15.1 | 2% |
| steals | 0.18 | 10% |
| stealsSpeedWaived | 0 | 0% |
| recruitAlternatesOffered | 0.04 | 2% |
| recruitSwaps | 0.02 | 1% |
| talkRecruits | 2.43 | 94% |
| visionRewinds | 6.79 | 100% |
| visionGraceRewinds | 0.04 | 1% |
| replayMismatches | 0 | 0% |
| churchVisits | 1.12 | 71% |
| secondVows | 0.01 | 1% |
| cleanses | 0.01 | 2% |
| churchBlessings | 0.59 | 47% |
| churchPromotions | 0.31 | 22% |
| freePromotions | 0.13 | 6% |
| revives | 10.98 | 99% |
| titheGold | 11.2 | 5% |
| colosseumBouts | 0.59 | 28% |
| colosseumWins | 0.57 | 27% |
| ledgerFeeSaved | 2.65 | 1% |
| freeForges | 0.07 | 5% |
| paidForges | 0.72 | 54% |
| itemHeals | 8.95 | 100% |
| convoyElixirHeals | 0.79 | 55% |
| goldPouches | 0.03 | 2% |
| boostersUsed | 0.07 | 6% |
| skillScrollsLearned | 1.32 | 67% |
| artScrollsBound | 1.08 | 57% |
| accessoriesEquipped | 10.75 | 97% |
| sealPromotions | 0.23 | 22% |
| sealsRefused | 0.28 | 2% |
| bossRecruits | 3.4 | 100% |
| ruinsRests | 4.4 | 100% |
| bannerHolds | 5.49 | 48% |
| lanternHeals | 5.29 | 46% |
| staffHeals | 4.92 | 77% |
| carriersSeen | 12.26 | 99% |
| stalls | 9.19 | 93% |
| battleLosses | 0 | 0% |

### Start cards and gifts

Took it − offered it and took something else (or nothing), over the whole run.

| card | kind | offered | taken | exercised | ΔkoBattle% | Δko/battle | Δdeaths/battle | ΔwinsBeforeKO | Δstall% | Δgold | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 268 | 72 | 100% passive | −2.4 [−5.5, 0.6] | 0.57 [−0.67, 1.81] | 0.03 [0.00, 0.06] | 0.25 [−0.32, 0.83] | 3.1 [−0.7, 7.0] | 94 [−741, 928] | deaths/battle weaker |
| Advance Pay | T1 | 238 | 60 | 100% detected | −0.4 [−4.1, 3.2] | −1.82 [−3.07, −0.57] | 0.03 [−0.00, 0.06] | −0.04 [−0.79, 0.71] | −5.5 [−10.1, −0.9] | 1454 [−2616, 5524] | ko/battle stronger; stall% stronger |
| Blessed Vigor | T1 | 258 | 63 | 100% passive | −5.7 [−9.5, −1.9] | −1.66 [−2.91, −0.42] | 0.03 [−0.01, 0.07] | 0.88 [0.14, 1.62] | −1.5 [−5.5, 2.5] | 522 [−3493, 4537] | koBattle% stronger; ko/battle stronger; winsBeforeKO stronger |
| Swift Instinct | T2 | 54 | 10 | 100% passive | −3.2 [−15.1, 8.7] | −1.12 [−2.87, 0.62] | −0.05 [−0.13, 0.02] | −0.16 [−1.74, 1.43] | −0.6 [−10.5, 9.3] | −1026 [−2974, 923] |  |
| Field Medic | T1 | 236 | 52 | 100% detected | 2.4 [−0.8, 5.6] | 1.49 [0.08, 2.90] | −0.02 [−0.05, 0.01] | 0.03 [−0.76, 0.81] | 5.9 [1.8, 10.0] | −998 [−2450, 453] | ko/battle weaker; stall% weaker |
| Iron Oath | T3 | 54 | 13 | 100% passive | −3.8 [−11.8, 4.3] | 0.63 [−0.92, 2.18] | −0.04 [−0.11, 0.03] | 0.74 [−1.34, 2.82] | −0.8 [−9.9, 8.3] | −1053 [−2289, 183] |  |
| Scout Blessing | T2 | 52 | 10 | 100% passive | −9.3 [−19.1, 0.5] | −0.40 [−5.87, 5.08] | 0.03 [−0.03, 0.10] | 0.38 [−0.94, 1.71] | −9.7 [−19.2, −0.1] | 477 [−1109, 2063] | stall% stronger |
| Scholar's Vow | T4 | 66 | 17 | 100% passive | −4.2 [−13.0, 4.6] | −2.10 [−3.97, −0.23] | −0.00 [−0.06, 0.05] | −0.30 [−1.73, 1.13] | −11.4 [−19.6, −3.3] | −961 [−2671, 749] | ko/battle stronger; stall% stronger |
| Rally Cry | T2 | 48 | 5 | 100% passive | −5.2 [−22.3, 11.8] | −1.46 [−5.43, 2.50] | 0.03 [−0.13, 0.20] | 2.86 [1.07, 4.66] | 1.3 [−16.4, 19.0] | 1511 [28, 2994] |  |
| War Veteran | T3 | 44 | 6 | 100% passive | −3.2 [−15.3, 9.0] | −2.15 [−4.67, 0.36] | 0.04 [−0.06, 0.15] | −2.25 [−3.12, −1.39] | −11.9 [−17.5, −6.3] | 177 [−1204, 1558] |  |
| Smith's Mark | T2 | 55 | 8 | 38% detected | 5.2 [−1.1, 11.6] | 1.11 [−2.29, 4.52] | −0.01 [−0.08, 0.07] | 0.11 [−0.35, 0.57] | −3.3 [−14.0, 7.4] | 1230 [−257, 2716] |  |
| Arsenal Pact | T4 | 73 | 19 | 100% passive | −5.2 [−13.4, 2.9] | −1.18 [−3.15, 0.80] | −0.05 [−0.11, 0.00] | 1.03 [−0.54, 2.60] | −2.2 [−12.1, 7.7] | −4059 [−9753, 1634] |  |
| Pilgrim's Road | T2 | 68 | 14 | 50% detected | 1.4 [−3.6, 6.4] | 0.02 [−2.18, 2.22] | −0.04 [−0.07, −0.00] | −0.13 [−1.10, 0.84] | −1.1 [−6.5, 4.3] | −1804 [−4855, 1247] | deaths/battle stronger |
| Merchant Bane | T3 | 48 | 9 | 100% passive | 1.4 [−8.9, 11.7] | 1.53 [−0.72, 3.79] | 0.05 [−0.02, 0.11] | −1.63 [−3.04, −0.21] | 1.1 [−8.1, 10.2] | −99 [−1802, 1603] |  |
| Nomad's Pact | T3 | 44 | 10 | 100% detected | 2.8 [−3.1, 8.8] | −0.19 [−4.49, 4.11] | −0.02 [−0.09, 0.05] | 0.60 [−0.83, 2.03] | 8.4 [−0.8, 17.6] | −673 [−2236, 889] |  |
| Hold the Line | T2 | 47 | 14 | 100% passive | −4.9 [−10.8, 1.0] | 0.58 [−3.91, 5.06] | −0.02 [−0.06, 0.03] | 0.66 [−1.24, 2.56] | 7.4 [−6.2, 21.0] | 347 [−1039, 1733] |  |
| Quartermaster Cache | T2 | 52 | 15 | 100% detected | −2.2 [−11.5, 7.1] | −0.92 [−4.43, 2.59] | −0.01 [−0.05, 0.04] | −0.25 [−1.20, 0.71] | −3.1 [−14.1, 7.8] | −111 [−1594, 1372] |  |
| Forbidden Tome | T4 | 57 | 10 | 100% passive | −13.1 [−21.9, −4.3] | −2.31 [−3.54, −1.07] | −0.36 [−0.42, −0.31] | 0.56 [−3.06, 4.18] | −12.9 [−19.8, −6.1] | 38975 [32405, 45545] | koBattle% stronger; ko/battle stronger; deaths/battle stronger (FW); stall% stronger (FW); gold stronger (FW) |
| Blood Forge | T2 | 67 | 15 | 100% passive | 5.4 [−3.1, 13.8] | 1.54 [−0.52, 3.60] | −0.02 [−0.07, 0.03] | −0.10 [−1.85, 1.65] | 3.1 [−3.0, 9.2] | −2588 [−6500, 1323] |  |
| War Tutelage | T4 | 74 | 17 | 100% passive | −1.0 [−9.1, 7.0] | 0.67 [−1.77, 3.11] | 0.01 [−0.05, 0.06] | −0.54 [−1.30, 0.22] | −2.6 [−8.8, 3.5] | 587 [−706, 1880] |  |
| Armory Stash | T4 | 0 | 0 | - | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Scroll Archive | T4 | 51 | 10 | not reached: its art scrolls are bound, but the battle agent never uses a weapon art | −0.7 [−7.7, 6.2] | 0.78 [−3.55, 5.12] | −0.02 [−0.08, 0.04] | 1.27 [−0.90, 3.44] | −1.7 [−11.3, 7.9] | −201 [−1647, 1245] |  |
| Focused Curriculum | T3 | 65 | 15 | 100% passive | −4.0 [−10.2, 2.2] | −2.28 [−4.01, −0.54] | −0.02 [−0.09, 0.04] | −0.96 [−1.87, −0.05] | −3.4 [−12.1, 5.4] | −716 [−1681, 249] | ko/battle stronger; winsBeforeKO weaker |
| Slow Fuse | T2 | 64 | 18 | 100% passive | 3.7 [−3.1, 10.5] | 0.09 [−2.24, 2.41] | 0.02 [−0.04, 0.08] | −0.93 [−1.54, −0.32] | 1.4 [−6.9, 9.7] | −1764 [−2807, −720] | winsBeforeKO weaker; gold weaker |
| Gambler's Toss | T3 | 62 | 13 | 100% detected | 5.1 [−1.3, 11.5] | 0.59 [−1.33, 2.50] | 0.07 [0.01, 0.13] | −0.42 [−2.13, 1.30] | 1.7 [−8.0, 11.4] | −2321 [−7420, 2779] | deaths/battle weaker |
| Bloodless Art | T2 | 53 | 10 | not reached: the battle agent never uses a weapon art | 5.3 [−5.4, 15.9] | −0.06 [−1.49, 1.37] | −0.06 [−0.13, 0.01] | −0.22 [−2.40, 1.97] | 3.6 [−4.1, 11.3] | −1032 [−2406, 341] |  |
| Phalanx Rite | T3 | 46 | 12 | 100% passive | −1.6 [−9.7, 6.5] | 1.96 [−2.49, 6.40] | 0.00 [−0.06, 0.06] | −0.88 [−2.15, 0.38] | −1.3 [−16.2, 13.5] | 666 [−833, 2164] |  |
| Duelist's Creed | T3 | 68 | 18 | 100% passive | −4.2 [−10.2, 1.8] | −1.76 [−3.98, 0.46] | −0.05 [−0.10, 0.01] | 0.98 [−0.70, 2.67] | 2.4 [−5.1, 9.9] | −863 [−4726, 2999] |  |
| Late Bloom | T3 | 54 | 10 | 100% detected | −1.2 [−11.9, 9.6] | 0.98 [−1.98, 3.94] | −0.06 [−0.13, 0.02] | 1.40 [−1.71, 4.51] | 3.7 [−9.1, 16.4] | −705 [−4125, 2715] |  |
| Dawn Tithe | T2 | 54 | 18 | 89% detected | −1.2 [−8.7, 6.4] | 1.21 [−0.92, 3.35] | −0.04 [−0.10, 0.02] | −0.64 [−1.67, 0.40] | 4.1 [−3.5, 11.7] | −2188 [−5509, 1134] |  |
| Lone Banner | T3 | 52 | 18 | 100% passive | −1.2 [−8.3, 6.0] | 0.49 [−2.36, 3.34] | −0.03 [−0.10, 0.05] | 0.99 [−0.63, 2.61] | −1.0 [−10.1, 8.2] | −360 [−1702, 983] |  |
| Cavalier's Hour | T3 | 46 | 6 | 100% passive | −6.0 [−26.4, 14.4] | −0.45 [−1.46, 0.56] | −0.03 [−0.12, 0.05] | 4.86 [1.05, 8.67] | 4.2 [−8.5, 16.8] | −1545 [−3044, −45] |  |
| Saint's Reserve | T2 | 55 | 6 | 83% detected | 2.2 [−11.5, 15.9] | 0.04 [−0.81, 0.89] | 0.08 [−0.05, 0.21] | 0.46 [−4.34, 5.27] | 0.4 [−7.9, 8.7] | −4063 [−10294, 2167] |  |
| Cutpurse's Luck | T3 | 62 | 9 | 11% detected | 4.3 [−6.1, 14.7] | 0.34 [−0.80, 1.48] | 0.04 [−0.03, 0.10] | −0.64 [−2.72, 1.45] | 5.8 [0.7, 10.8] | 2949 [−5831, 11730] |  |
| Open Roll | T3 | 50 | 11 | 91% detected | −3.5 [−10.5, 3.5] | −0.00 [−0.78, 0.77] | −0.01 [−0.09, 0.07] | −0.17 [−2.16, 1.82] | 1.2 [−5.5, 7.9] | −505 [−2459, 1449] |  |
| Watcher's Grace | T2 | 65 | 9 | 100% detected | 7.7 [1.2, 14.1] | −1.02 [−3.63, 1.58] | 0.01 [−0.05, 0.07] | −1.06 [−2.21, 0.09] | −2.7 [−13.5, 8.1] | −46 [−799, 707] |  |
| Patient Dawn | T3 | 57 | 22 | 100% detected | −4.2 [−10.9, 2.4] | 0.96 [−1.53, 3.44] | 0.04 [−0.01, 0.09] | 0.69 [−0.33, 1.70] | 2.2 [−6.5, 11.0] | −81 [−1263, 1100] |  |
| Twin Chapel | T2 | 61 | 15 | 40% detected | 3.4 [−4.8, 11.6] | 0.39 [−2.18, 2.95] | −0.01 [−0.06, 0.04] | −1.23 [−2.52, 0.07] | −1.9 [−9.1, 5.3] | −470 [−1937, 998] |  |
| Omen Reader | T2 | 64 | 14 | not reached: the route policy does not read the omen marks (the spared recruit nodes still act) | 6.3 [0.2, 12.3] | 0.84 [−2.71, 4.39] | 0.10 [0.04, 0.15] | 0.01 [−0.46, 0.48] | 10.4 [1.0, 19.7] | −3064 [−6577, 449] | koBattle% weaker; deaths/battle weaker; stall% weaker |
| Lottery Loot | T3 | 68 | 15 | 100% detected | 6.9 [1.1, 12.7] | 1.72 [−2.05, 5.49] | −0.04 [−0.08, 0.01] | 0.07 [−1.01, 1.15] | 1.3 [−8.2, 10.8] | −2951 [−7425, 1523] | koBattle% weaker |
| Sealed Reliquary | gift | 87 | 21 | 100% granted | −2.2 [−6.9, 2.4] | −2.04 [−4.35, 0.27] | −0.03 [−0.09, 0.02] | 0.07 [−0.97, 1.11] | −4.6 [−12.4, 3.2] | 844 [−821, 2510] |  |
| Fallen Hoard | gift | 74 | 14 | 100% granted | −0.2 [−7.4, 7.0] | 0.40 [−1.48, 2.28] | −0.01 [−0.06, 0.05] | 0.15 [−0.91, 1.22] | 5.8 [−1.7, 13.2] | 14976 [−6113, 36066] |  |
| Stranger's Scroll | gift | 86 | 22 | 100% granted | 0.1 [−6.0, 6.1] | 0.10 [−2.27, 2.47] | −0.02 [−0.07, 0.02] | 0.11 [−1.05, 1.26] | 2.5 [−4.6, 9.6] | −706 [−2548, 1135] |  |
| Marked Blade | gift | 81 | 8 | 100% granted | −0.3 [−10.9, 10.3] | 0.02 [−3.58, 3.62] | −0.08 [−0.11, −0.04] | −1.19 [−1.93, −0.44] | 5.9 [0.6, 11.2] | −3063 [−10128, 4003] |  |
| Pilgrim's Wager | gift | 89 | 16 | 100% granted | 1.2 [−3.3, 5.7] | 1.17 [−0.93, 3.26] | 0.03 [−0.03, 0.09] | 0.89 [−0.32, 2.11] | 0.2 [−6.8, 7.2] | 1360 [−7193, 9912] |  |
| Armory Stash | gift | 92 | 12 | 100% granted | 1.6 [−5.0, 8.2] | −2.37 [−4.82, 0.09] | 0.03 [−0.07, 0.13] | −0.77 [−2.83, 1.28] | −4.0 [−13.4, 5.3] | −1641 [−3161, −121] | gold weaker |

### Earned cards

Took it − offered it in a pick and took the other card, over the run's battles from that offer on; a card its source offers alone (an eclipsed elite's drop, the Colosseum's) is compared at each run's first offer from that source (this card first against another card first). `granted`: given by an event (no choice, not compared).

| card | kind | offered | taken | granted | compared with | exercised | ΔkoBattle% | Δko/battle | Δdeaths/battle | ΔwinsBeforeKO | Δstall% | Δgold | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Unbroken Banner | earned | 771 | 484 | 0 | the other card | 100% detected | −4.1 [−7.0, −1.1] | 0.17 [−1.05, 1.39] | −0.17 [−0.29, −0.05] | 0.26 [0.03, 0.49] | 0.0 [−3.7, 3.7] | −716 [−2036, 604] | koBattle% stronger; deaths/battle stronger; winsBeforeKO stronger |
| Second Dawn | earned | 177 | 177 | 0 | source peers | 94% detected | −0.8 [−3.5, 1.9] | −0.91 [−1.88, 0.07] | −0.06 [−0.11, −0.01] | 0.04 [−0.19, 0.28] | −3.6 [−6.7, −0.5] | 1535 [−419, 3490] | deaths/battle stronger; stall% stronger |
| Ember Lantern | earned | 729 | 455 | 0 | the other card | 100% detected | −1.2 [−4.3, 2.0] | 0.59 [−0.64, 1.82] | −0.18 [−0.31, −0.06] | 0.12 [−0.09, 0.34] | 2.2 [−1.4, 5.9] | −478 [−1926, 969] | deaths/battle stronger |
| Captain's Whistle | earned | 739 | 454 | 0 | the other card | 100% passive | 0.3 [−3.3, 3.9] | 0.54 [−0.79, 1.86] | −0.15 [−0.27, −0.04] | 0.05 [−0.20, 0.30] | −2.4 [−6.3, 1.4] | −692 [−2041, 656] | deaths/battle stronger |
| Standard of the Sun | earned | 310 | 162 | 0 | the other card | 100% passive | 3.8 [0.5, 7.1] | 0.88 [−0.23, 1.99] | −0.02 [−0.06, 0.01] | −0.20 [−0.57, 0.17] | 3.3 [−0.4, 7.0] | 687 [−870, 2245] | koBattle% weaker |
| Hollow Hourglass | earned | 220 | 220 | 0 | source peers | 100% detected | −0.8 [−3.5, 1.9] | 0.91 [−0.10, 1.92] | −0.00 [−0.06, 0.06] | −0.02 [−0.25, 0.22] | 4.6 [1.3, 8.0] | −1348 [−2179, −518] | stall% weaker; gold weaker |
| Chronicle | earned | 301 | 143 | 0 | the other card | 100% detected | −0.6 [−4.3, 3.2] | −0.25 [−1.81, 1.31] | 0.05 [−0.01, 0.11] | −0.05 [−0.23, 0.13] | −2.2 [−7.2, 2.7] | −281 [−2744, 2182] |  |
| Tithe Box | earned | 253 | 153 | 0 | the other card | 31% detected | −2.3 [−6.7, 2.0] | −1.02 [−3.09, 1.05] | 0.02 [−0.09, 0.13] | 0.03 [−0.26, 0.32] | −2.4 [−7.5, 2.7] | −1545 [−3243, 153] |  |
| Lantern of the Road | earned | 250 | 250 | 0 | source peers | 83% detected | 0.6 [−1.7, 3.0] | −0.19 [−1.14, 0.77] | 0.05 [−0.01, 0.11] | −0.02 [−0.22, 0.18] | −1.8 [−4.8, 1.2] | 413 [−1175, 2000] |  |
| Crest of the Road | earned | 0 | 0 | 6 | - | 100% detected | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Saint's Reliquary | earned | 253 | 111 | 0 | the other card | 32% detected | 2.4 [−1.9, 6.7] | 1.13 [−0.84, 3.10] | −0.06 [−0.17, 0.04] | 0.01 [−0.28, 0.30] | 3.0 [−1.9, 8.0] | 1363 [−188, 2915] |  |
| Mercenary Ledger | earned | 185 | 185 | 0 | - | 4% detected | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Smith's Covenant | earned | 0 | 0 | 128 | - | 38% detected | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Thief's Lantern | earned | 0 | 0 | 0 | - | - | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Seer's Eye | earned | 239 | 239 | 0 | source peers | 81% detected | 0.7 [−1.6, 3.1] | 0.07 [−0.86, 1.00] | −0.00 [−0.06, 0.05] | 0.00 [−0.19, 0.20] | 0.4 [−2.7, 3.6] | −403 [−1696, 891] |  |
| Darkened Dawn | twisted | 264 | 148 | 0 | the other card | 100% detected | −1.2 [−6.2, 3.8] | −0.04 [−2.13, 2.05] | −0.10 [−0.28, 0.08] | −0.17 [−0.51, 0.16] | −3.9 [−9.9, 2.1] | −956 [−3493, 1582] |  |
| Blood Covenant | twisted | 460 | 267 | 0 | the other card | 100% passive | −8.1 [−12.5, −3.7] | −2.47 [−4.00, −0.95] | 0.04 [−0.11, 0.19] | 0.58 [0.28, 0.88] | −9.8 [−14.3, −5.3] | 248 [−1823, 2319] | koBattle% stronger; ko/battle stronger; winsBeforeKO stronger (FW); stall% stronger (FW) |
| Kingmaker's Oath | twisted | 471 | 274 | 0 | the other card | 27% detected | 0.2 [−3.9, 4.3] | 0.15 [−1.41, 1.71] | −0.02 [−0.16, 0.11] | 0.02 [−0.20, 0.24] | −2.4 [−7.0, 2.3] | 286 [−1270, 1842] |  |
| Hollow Sun's Favor | twisted | 462 | 257 | 0 | the other card | 59% detected | 2.9 [−0.8, 6.6] | −0.72 [−2.27, 0.84] | 0.11 [0.00, 0.22] | −0.27 [−0.47, −0.06] | −1.4 [−5.7, 3.0] | 1914 [597, 3230] | deaths/battle weaker; winsBeforeKO weaker; gold stronger |

### Flags

| card | taken | outcome | reading | level | delta |
| --- | --- | --- | --- | --- | --- |
| Keen Eye | 72 | deaths/battle | weaker | nominal | 0.03 [0.00, 0.06] |
| Advance Pay | 60 | ko/battle | stronger | nominal | -1.82 [-3.07, -0.57] |
| Advance Pay | 60 | stall% | stronger | nominal | -5.52 [-10.13, -0.92] |
| Blessed Vigor | 63 | koBattle% | stronger | nominal | -5.70 [-9.47, -1.93] |
| Blessed Vigor | 63 | ko/battle | stronger | nominal | -1.66 [-2.91, -0.42] |
| Blessed Vigor | 63 | winsBeforeKO | stronger | nominal | 0.88 [0.14, 1.62] |
| Field Medic | 52 | ko/battle | weaker | nominal | 1.49 [0.08, 2.90] |
| Field Medic | 52 | stall% | weaker | nominal | 5.90 [1.80, 9.99] |
| Scout Blessing | 10 | stall% | stronger | nominal | -9.66 [-19.16, -0.15] |
| Scholar's Vow | 17 | ko/battle | stronger | nominal | -2.10 [-3.97, -0.23] |
| Scholar's Vow | 17 | stall% | stronger | nominal | -11.44 [-19.59, -3.28] |
| Pilgrim's Road | 14 | deaths/battle | stronger | nominal | -0.04 [-0.07, -0.00] |
| Forbidden Tome | 10 | koBattle% | stronger | nominal | -13.06 [-21.86, -4.25] |
| Forbidden Tome | 10 | ko/battle | stronger | nominal | -2.31 [-3.54, -1.07] |
| Forbidden Tome | 10 | deaths/battle | stronger | family-wise | -0.36 [-0.42, -0.31] |
| Forbidden Tome | 10 | stall% | stronger | family-wise | -12.94 [-19.82, -6.05] |
| Forbidden Tome | 10 | gold | stronger | family-wise | 38975.20 [32405.15, 45545.25] |
| Focused Curriculum | 15 | ko/battle | stronger | nominal | -2.28 [-4.01, -0.54] |
| Focused Curriculum | 15 | winsBeforeKO | weaker | nominal | -0.96 [-1.87, -0.05] |
| Slow Fuse | 18 | winsBeforeKO | weaker | nominal | -0.93 [-1.54, -0.32] |
| Slow Fuse | 18 | gold | weaker | nominal | -1763.65 [-2807.39, -719.92] |
| Gambler's Toss | 13 | deaths/battle | weaker | nominal | 0.07 [0.01, 0.13] |
| Omen Reader | 14 | koBattle% | weaker | nominal | 6.27 [0.22, 12.32] |
| Omen Reader | 14 | deaths/battle | weaker | nominal | 0.10 [0.04, 0.15] |
| Omen Reader | 14 | stall% | weaker | nominal | 10.37 [1.00, 19.73] |
| Lottery Loot | 15 | koBattle% | weaker | nominal | 6.87 [1.06, 12.68] |
| Armory Stash | 12 | gold | weaker | nominal | -1640.92 [-3161.29, -120.55] |
| Unbroken Banner | 484 | koBattle% | stronger | nominal | -4.05 [-6.99, -1.12] |
| Unbroken Banner | 484 | deaths/battle | stronger | nominal | -0.17 [-0.29, -0.05] |
| Unbroken Banner | 484 | winsBeforeKO | stronger | nominal | 0.26 [0.03, 0.49] |
| Second Dawn | 177 | deaths/battle | stronger | nominal | -0.06 [-0.11, -0.01] |
| Second Dawn | 177 | stall% | stronger | nominal | -3.60 [-6.71, -0.50] |
| Ember Lantern | 455 | deaths/battle | stronger | nominal | -0.18 [-0.31, -0.06] |
| Captain's Whistle | 454 | deaths/battle | stronger | nominal | -0.15 [-0.27, -0.04] |
| Standard of the Sun | 162 | koBattle% | weaker | nominal | 3.81 [0.55, 7.06] |
| Hollow Hourglass | 220 | stall% | weaker | nominal | 4.64 [1.29, 7.98] |
| Hollow Hourglass | 220 | gold | weaker | nominal | -1348.34 [-2178.76, -517.91] |
| Blood Covenant | 267 | koBattle% | stronger | nominal | -8.10 [-12.49, -3.70] |
| Blood Covenant | 267 | ko/battle | stronger | nominal | -2.47 [-4.00, -0.95] |
| Blood Covenant | 267 | winsBeforeKO | stronger | family-wise | 0.58 [0.28, 0.88] |
| Blood Covenant | 267 | stall% | stronger | family-wise | -9.79 [-14.27, -5.30] |
| Hollow Sun's Favor | 257 | deaths/battle | weaker | nominal | 0.11 [0.00, 0.22] |
| Hollow Sun's Favor | 257 | winsBeforeKO | weaker | nominal | -0.27 [-0.47, -0.06] |
| Hollow Sun's Favor | 257 | gold | stronger | nominal | 1913.54 [597.03, 3230.06] |

## Outliers

Ordered by strength of evidence. Unless a line says FW, the evidence is a nominal flag. Each one
could be one of the roughly 20 chance flags this many comparisons produce.

**Strong (family-wise):**

1. **Blood Covenant looks too strong for a twisted card.** Compared with the card it was offered
   with (267 takers): koBattle −8.1 points [−12.5, −3.7], ko/battle −2.5 [−4.0, −1.0],
   winsBeforeKO +0.58 [0.28, 0.88] (FW), stall −9.8 points [−14.3, −5.3] (FW). The direction is
   the same on First Light, Dusk and Nightfall (koBattle −10.4, −9.9, −9.4). Its twist, an Ill
   Omen that never ends (+1 shadow a victory), shows no cost in any outcome measured here,
   gold included (+248 [−1823, 2319]). +1 to every stat for every unit outweighs the extra
   Eclipse pressure for this player.
2. **Forbidden Tome's numbers are a policy artifact, not evidence.** FW on deaths/battle −0.36,
   stall −12.9 points and gold +38,975, but from only 10 takers. Its pact forbids church revives.
   The claiming church revives about 11 fallen units a run at full price, and revived units come
   back weak (catch-up growths minus 10) and fall again. With the Tome, the gold stays in the purse
   and the weak revived units never return, so the run looks richer and loses fewer units. The
   sim cannot price what the pact really costs (the fallen units themselves). Treat the Tome as
   unmeasured.

**Nominal, worth a look:**

3. **Unbroken Banner is the strongest pure act-boss card.** Against the other card of its pair
   (484 takers): koBattle −4.1 [−7.0, −1.1], deaths −0.17 [−0.29, −0.05], winsBeforeKO
   +0.26 [0.03, 0.49]. It is largest on First Light (koBattle −8.5, deaths −0.43). It fired in every
   run that held it (5.5 holds a run).
4. **Ember Lantern and Captain's Whistle also cut deaths.** Against the card they were offered with:
   −0.18 [−0.31, −0.06] and −0.15 [−0.27, −0.04] deaths a battle. Their pairs are often each
   other or the Banner, so these are differences among the act-boss cards.
5. **Standard of the Sun is the weakest Act I boss card.** koBattle +3.8 [0.5, 7.1] against the
   card offered with it (162 takers), +8.6 on First Light. Its aura (+5 Hit and Avoid near the
   commander) possibly does little for this agent's positioning.
6. **Hollow Hourglass costs this player.** Against another first eclipsed-elite card (220 runs):
   stall +4.6 points [1.3, 8.0], gold −1348 [−2179, −518]. Delayed reinforcements make battles last
   longer. A player who wants to clear a map before waves arrive may value it; this agent does not.
7. **Hollow Sun's Favor trades as designed.** Gold +1914 [597, 3230], but deaths +0.11
   [0.00, 0.22] and winsBeforeKO −0.27 [−0.47, −0.06]: its Hunted twist bites.
8. **Blessed Vigor (tier I) looks strong for a free card.** koBattle −5.7 [−9.5, −1.9],
   ko/battle −1.7, winsBeforeKO +0.9 (63 takers), almost all of it on First Light (koBattle −16.8,
   14 takers). This needs a larger sample before acting on it.
9. **Advance Pay (tier I):** ko/battle −1.8 [−3.1, −0.6], stall −5.5 [−10.1, −0.9]. **Field
   Medic (tier I)** reads the other way: ko/battle +1.5 [0.1, 2.9], stall +5.9 [1.8, 10.0]. Possibly
   because Field Medic's Vulneraries add little to what the item policy already buys. "Took something else" is mostly
   another tier I card, so these are tier I cards ranked against each other.
10. **Scholar's Vow (17 takers):** ko/battle −2.1 [−4.0, −0.2], stall −11.4 [−19.6, −3.3]. This
    is consistent with the spec's "best card in the game", but the sample is small.
11. **Omen Reader (14 takers):** koBattle +6.3, deaths +0.10, stall +10.4, all nominal. The route
    policy never reads its marks, so this measures its price (+8 shadow) without its benefit. It
    does not show the card is weak.
12. **Lottery Loot (15 takers):** koBattle +6.9 [1.1, 12.7]. **Slow Fuse (18):** winsBeforeKO
    −0.9, gold −1764. **Gambler's Toss (13):** deaths +0.07. **Armory Stash gift (12):** gold
    −1641. These samples are small and any of them is plausibly chance.

**Mechanics the policies reach rarely (coverage, not balance):**

- **Cutpurse's Luck:** carriers doubled as designed (22 a run against 12), but its 29 holder runs
  made only 4 steals. A Thief is rare in the army: Act II's recruit pool, and the deploy policy
  seldom fields it. Its speed waiver never decided a steal: of 179 steals in all runs, 0 needed
  it, because Thieves are fast. Its value depends on owning and fielding a Thief.
- **Thief's Lantern** was never granted: the Collectors' fight was never reached. It is untested.
- **Twin Chapel:** a second vow in 6 of 15 holder runs (Blessing plus Promotion or Cleanse; with
  nothing to promote or cleanse there is one vow).
- **Mercenary Ledger:** taken 185 times, but a later bout used the halved fee in only 4% of those
  runs (few colosseums follow the first gold win). **Tithe Box** 31%, **Saint's Reliquary** 32%,
  **Kingmaker's Oath** 27%, **Smith's Mark** and **Smith's Covenant** 38%: each needs a service
  node after the take.
- **Open Roll:** 40 second candidates offered, 16 swapped. **Watcher's Grace:** 36 rewinds spent
  a boss map's charge, in 9 of its holder runs.

## Limits

- **Agent strength.** On Nightfall and Black Sun 93-98% of battles have a commander KO and 41-60%
  hit the turn cap, so differences there are mostly noise. First Light (41% KO battles) and Dusk
  (73%) carry the signal. No run is clean of commander KOs: a would-be win rate cannot be measured
  with this player.
- **Take rates are the policy's**, a keyed-random pick, not a preference. They exist to make the
  with/without comparison fair. They say nothing about how attractive a card is.
- **Earned-card differences are relative** to the card offered alongside, never to "no card". A card
  always offered next to a strong one looks weak.
- **Gold is dominated by revive spending** (about 11 revives a run): a card that changes deaths
  changes gold.
- **Sample sizes.** Start cards have 5-22 takers each (tier I 52-72), gifts 8-22, act-boss cards
  110-480. Intervals are wide; most cards show no difference that this sample can detect.
- **Not modelled:** weapon arts in battle, items used in battle, route choice by scout, preview or
  omen, merc hiring, Branching Threads (meta), and the Master Seal purchases a human would make.

## Appendix: per rung

Each card's takers and differences within one rung (same comparisons, one stratum).

### First Light (300 runs)

| card | kind | offered | taken | ΔkoBattle% | Δdeaths/battle | ΔwinsBeforeKO | Δstall% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 82 | 19 | 0.1 [−6.1, 6.3] | 0.06 [0.00, 0.12] | 0.35 [−1.54, 2.25] | 1.9 [−2.5, 6.3] |
| Advance Pay | T1 | 69 | 16 | −4.2 [−12.5, 4.1] | 0.04 [−0.02, 0.10] | 1.16 [−1.44, 3.75] | −4.5 [−8.6, −0.4] |
| Blessed Vigor | T1 | 83 | 14 | −16.8 [−26.9, −6.8] | 0.04 [−0.07, 0.15] | 3.38 [0.65, 6.12] | −4.4 [−9.1, 0.4] |
| Swift Instinct | T2 | 16 | 4 | −2.6 [−23.6, 18.4] | −0.03 [−0.14, 0.08] | −0.33 [−3.91, 3.24] | 7.6 [−10.5, 25.6] |
| Field Medic | T1 | 66 | 15 | 11.5 [3.0, 20.0] | −0.09 [−0.17, −0.01] | 0.15 [−2.42, 2.73] | 5.8 [0.7, 11.0] |
| Iron Oath | T3 | 15 | 4 | −13.8 [−35.9, 8.3] | −0.02 [−0.21, 0.16] | 1.48 [−4.27, 7.22] | −2.4 [−11.6, 6.7] |
| Scout Blessing | T2 | 7 | 1 | n/a | n/a | n/a | n/a |
| Scholar's Vow | T4 | 20 | 7 | 1.9 [−15.1, 18.9] | −0.03 [−0.14, 0.08] | 0.10 [−2.99, 3.19] | −3.4 [−11.5, 4.8] |
| Rally Cry | T2 | 16 | 1 | n/a | n/a | n/a | n/a |
| War Veteran | T3 | 13 | 2 | 9.8 [−2.6, 22.1] | 0.06 [−0.04, 0.16] | −5.91 [−8.41, −3.41] | −5.0 [−12.0, 1.9] |
| Smith's Mark | T2 | 12 | 1 | n/a | n/a | n/a | n/a |
| Arsenal Pact | T4 | 24 | 6 | 2.3 [−16.0, 20.7] | −0.02 [−0.16, 0.12] | −0.50 [−4.31, 3.31] | 2.4 [−9.8, 14.6] |
| Pilgrim's Road | T2 | 20 | 5 | −2.4 [−13.8, 9.0] | −0.07 [−0.15, 0.01] | 0.60 [−2.05, 3.25] | −4.6 [−10.6, 1.3] |
| Merchant Bane | T3 | 17 | 3 | −2.4 [−27.5, 22.7] | −0.04 [−0.16, 0.08] | −4.90 [−7.92, −1.89] | −0.8 [−13.8, 12.1] |
| Nomad's Pact | T3 | 10 | 1 | n/a | n/a | n/a | n/a |
| Hold the Line | T2 | 15 | 5 | −11.7 [−24.8, 1.3] | −0.03 [−0.12, 0.07] | 1.50 [−2.81, 5.81] | 3.7 [−6.0, 13.5] |
| Quartermaster Cache | T2 | 20 | 2 | 1.9 [−24.1, 27.9] | −0.13 [−0.17, −0.08] | −4.00 [−6.11, −1.89] | 10.4 [−13.8, 34.7] |
| Forbidden Tome | T4 | 20 | 4 | −19.7 [−36.2, −3.2] | −0.29 [−0.39, −0.18] | 2.50 [−5.47, 10.47] | −8.4 [−16.9, 0.1] |
| Blood Forge | T2 | 26 | 4 | 7.2 [−14.8, 29.3] | 0.04 [−0.07, 0.16] | 1.00 [−4.44, 6.44] | −3.0 [−11.0, 5.0] |
| War Tutelage | T4 | 21 | 6 | −0.2 [−18.0, 17.6] | 0.00 [−0.11, 0.12] | −0.77 [−2.96, 1.43] | −0.8 [−6.6, 5.0] |
| Armory Stash | T4 | 0 | 0 | n/a | n/a | n/a | n/a |
| Scroll Archive | T4 | 17 | 4 | −6.3 [−20.2, 7.7] | −0.00 [−0.09, 0.09] | 3.13 [−1.52, 7.79] | −4.4 [−13.9, 5.2] |
| Focused Curriculum | T3 | 22 | 6 | −1.6 [−11.8, 8.6] | −0.05 [−0.19, 0.09] | −2.48 [−4.72, −0.24] | −0.1 [−10.7, 10.6] |
| Slow Fuse | T2 | 14 | 3 | 3.0 [−14.1, 20.2] | 0.07 [−0.09, 0.23] | −3.24 [−5.88, −0.60] | −13.2 [−23.3, −3.1] |
| Gambler's Toss | T3 | 16 | 4 | 4.8 [−6.7, 16.3] | 0.10 [0.02, 0.19] | −0.08 [−5.08, 4.92] | 4.9 [−5.7, 15.4] |
| Bloodless Art | T2 | 16 | 3 | −1.7 [−15.2, 11.7] | −0.02 [−0.15, 0.11] | −1.21 [−4.60, 2.19] | −5.3 [−12.3, 1.8] |
| Phalanx Rite | T3 | 15 | 5 | −1.9 [−10.5, 6.7] | −0.00 [−0.10, 0.10] | −2.70 [−5.53, 0.13] | −1.0 [−7.9, 6.0] |
| Duelist's Creed | T3 | 17 | 7 | −17.8 [−32.5, −3.0] | 0.03 [−0.10, 0.16] | 3.49 [−1.60, 8.57] | −5.2 [−13.4, 3.0] |
| Late Bloom | T3 | 17 | 3 | −10.7 [−39.6, 18.2] | −0.06 [−0.18, 0.05] | 2.07 [−5.96, 10.10] | 7.0 [−5.4, 19.4] |
| Dawn Tithe | T2 | 16 | 5 | 4.9 [−9.4, 19.3] | −0.07 [−0.20, 0.06] | −1.96 [−5.43, 1.50] | −0.7 [−9.1, 7.7] |
| Lone Banner | T3 | 23 | 7 | −7.0 [−20.1, 6.1] | −0.02 [−0.17, 0.13] | 2.36 [−1.39, 6.10] | 1.9 [−6.1, 10.0] |
| Cavalier's Hour | T3 | 11 | 3 | −8.9 [−43.1, 25.3] | −0.02 [−0.16, 0.13] | 5.00 [−0.63, 10.63] | 10.0 [−8.0, 28.0] |
| Saint's Reserve | T2 | 21 | 3 | 1.8 [−7.9, 11.6] | 0.13 [−0.08, 0.34] | −1.17 [−5.66, 3.33] | 0.9 [−11.9, 13.7] |
| Cutpurse's Luck | T3 | 17 | 3 | −2.3 [−21.1, 16.4] | 0.04 [−0.07, 0.14] | −1.07 [−6.62, 4.48] | −1.0 [−11.9, 9.9] |
| Open Roll | T3 | 21 | 6 | −8.0 [−17.0, 0.9] | 0.02 [−0.09, 0.13] | 0.03 [−2.72, 2.78] | −4.1 [−13.2, 5.0] |
| Watcher's Grace | T2 | 24 | 3 | 11.9 [−4.0, 27.8] | 0.06 [−0.07, 0.19] | −2.95 [−6.26, 0.35] | −1.5 [−12.9, 9.9] |
| Patient Dawn | T3 | 12 | 6 | −12.9 [−34.1, 8.3] | 0.17 [0.06, 0.28] | 2.00 [−1.90, 5.90] | 0.4 [−10.7, 11.5] |
| Twin Chapel | T2 | 18 | 4 | 13.3 [−10.1, 36.8] | −0.05 [−0.16, 0.06] | −4.61 [−8.56, −0.66] | −1.7 [−8.5, 5.2] |
| Omen Reader | T2 | 17 | 1 | n/a | n/a | n/a | n/a |
| Lottery Loot | T3 | 14 | 4 | 9.9 [−8.0, 27.7] | −0.12 [−0.25, 0.00] | 0.75 [−3.14, 4.64] | −0.4 [−8.3, 7.6] |
| Sealed Reliquary | gift | 26 | 7 | −4.9 [−16.8, 7.0] | −0.04 [−0.17, 0.09] | 0.08 [−2.84, 3.01] | −4.1 [−11.8, 3.6] |
| Fallen Hoard | gift | 28 | 5 | 10.4 [−0.9, 21.7] | −0.12 [−0.18, −0.06] | −0.32 [−2.09, 1.45] | 2.2 [−7.0, 11.5] |
| Stranger's Scroll | gift | 25 | 6 | −0.6 [−14.9, 13.8] | −0.01 [−0.14, 0.12] | 1.25 [−2.72, 5.22] | 4.9 [−3.9, 13.6] |
| Marked Blade | gift | 33 | 2 | −3.9 [−37.7, 30.0] | −0.06 [−0.12, −0.00] | −3.61 [−6.02, −1.21] | −3.9 [−8.1, 0.4] |
| Pilgrim's Wager | gift | 24 | 4 | −1.3 [−12.8, 10.2] | −0.12 [−0.23, −0.01] | 1.85 [−1.11, 4.81] | 5.9 [−2.3, 14.1] |
| Armory Stash | gift | 30 | 3 | −9.5 [−30.6, 11.5] | 0.00 [−0.30, 0.30] | −1.81 [−9.26, 5.63] | −3.2 [−9.0, 2.7] |
| Unbroken Banner | earned | 219 | 138 | −8.5 [−16.2, −0.7] | −0.43 [−0.81, −0.05] | 0.37 [−0.34, 1.08] | −2.1 [−9.3, 5.1] |
| Second Dawn | earned | 37 | 37 | 3.9 [−4.3, 12.0] | −0.22 [−0.42, −0.03] | 0.17 [−0.57, 0.92] | −3.5 [−10.0, 3.0] |
| Ember Lantern | earned | 208 | 126 | −6.9 [−14.2, 0.4] | −0.29 [−0.65, 0.07] | 0.70 [0.11, 1.29] | 5.9 [−0.9, 12.7] |
| Captain's Whistle | earned | 208 | 120 | −4.9 [−12.6, 2.7] | −0.19 [−0.52, 0.13] | 0.48 [−0.18, 1.14] | −3.3 [−11.4, 4.8] |
| Standard of the Sun | earned | 103 | 47 | 8.6 [1.3, 15.8] | −0.05 [−0.11, 0.01] | −0.50 [−1.37, 0.38] | 4.7 [−0.1, 9.5] |
| Hollow Hourglass | earned | 57 | 57 | 1.2 [−6.4, 8.8] | 0.00 [−0.21, 0.21] | −0.23 [−0.84, 0.38] | 5.8 [−1.2, 12.7] |
| Chronicle | earned | 91 | 39 | 1.0 [−8.2, 10.3] | 0.17 [0.01, 0.33] | −0.22 [−0.76, 0.32] | −5.7 [−12.7, 1.3] |
| Tithe Box | earned | 92 | 62 | −3.5 [−13.7, 6.7] | 0.12 [−0.16, 0.40] | −0.05 [−0.86, 0.76] | −3.7 [−11.5, 4.2] |
| Lantern of the Road | earned | 59 | 59 | −0.0 [−7.6, 7.5] | 0.08 [−0.14, 0.29] | 0.01 [−0.64, 0.65] | −2.6 [−8.3, 3.2] |
| Crest of the Road | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reliquary | earned | 92 | 36 | 4.3 [−5.6, 14.1] | −0.23 [−0.49, 0.02] | −0.01 [−0.78, 0.77] | 5.2 [−2.2, 12.5] |
| Mercenary Ledger | earned | 56 | 56 | n/a | n/a | n/a | n/a |
| Smith's Covenant | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Thief's Lantern | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Seer's Eye | earned | 39 | 39 | −5.2 [−14.4, 3.9] | 0.11 [−0.16, 0.38] | 0.12 [−0.63, 0.87] | −0.7 [−8.2, 6.7] |
| Darkened Dawn | twisted | 90 | 54 | 2.7 [−8.7, 14.1] | −0.38 [−0.90, 0.15] | −0.53 [−1.38, 0.32] | −0.0 [−11.7, 11.7] |
| Blood Covenant | twisted | 139 | 79 | −10.4 [−20.0, −0.8] | 0.34 [−0.05, 0.73] | 1.04 [0.16, 1.91] | −8.4 [−16.9, 0.1] |
| Kingmaker's Oath | twisted | 117 | 65 | −4.5 [−14.8, 5.8] | −0.26 [−0.73, 0.21] | 0.23 [−0.49, 0.96] | 1.9 [−8.3, 12.2] |
| Hollow Sun's Favor | twisted | 116 | 58 | 5.2 [−4.8, 15.2] | −0.05 [−0.40, 0.30] | −0.45 [−1.13, 0.24] | −4.5 [−13.6, 4.6] |

### Dusk (300 runs)

| card | kind | offered | taken | ΔkoBattle% | Δdeaths/battle | ΔwinsBeforeKO | Δstall% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 77 | 24 | −9.1 [−16.8, −1.5] | 0.03 [−0.01, 0.08] | 0.46 [−0.28, 1.20] | −1.6 [−7.6, 4.4] |
| Advance Pay | T1 | 62 | 17 | 1.9 [−7.6, 11.5] | −0.00 [−0.07, 0.07] | −1.14 [−1.93, −0.36] | −4.8 [−13.0, 3.3] |
| Blessed Vigor | T1 | 85 | 21 | −2.3 [−9.5, 4.9] | 0.03 [−0.02, 0.09] | −0.00 [−0.84, 0.84] | 3.0 [−3.3, 9.2] |
| Swift Instinct | T2 | 16 | 4 | −3.4 [−21.2, 14.5] | −0.11 [−0.26, 0.04] | 0.00 [−1.83, 1.83] | 0.9 [−9.9, 11.6] |
| Field Medic | T1 | 76 | 15 | −0.9 [−6.5, 4.6] | 0.05 [−0.01, 0.10] | −0.12 [−1.02, 0.78] | 3.8 [−2.2, 9.8] |
| Iron Oath | T3 | 17 | 4 | 0.3 [−12.9, 13.6] | 0.01 [−0.11, 0.13] | 0.90 [−2.83, 4.64] | −8.3 [−18.5, 1.8] |
| Scout Blessing | T2 | 22 | 4 | −16.6 [−34.7, 1.5] | −0.02 [−0.06, 0.02] | 0.72 [−1.79, 3.23] | −8.5 [−15.6, −1.4] |
| Scholar's Vow | T4 | 16 | 4 | −16.6 [−31.7, −1.4] | 0.02 [−0.03, 0.06] | −0.75 [−2.73, 1.23] | −13.4 [−26.0, −0.9] |
| Rally Cry | T2 | 13 | 2 | −5.2 [−22.3, 11.8] | 0.03 [−0.13, 0.20] | 2.86 [1.07, 4.66] | 1.3 [−16.4, 19.0] |
| War Veteran | T3 | 12 | 2 | −16.4 [−49.8, 17.1] | −0.03 [−0.14, 0.09] | −0.70 [−1.12, −0.28] | −11.9 [−20.8, −3.0] |
| Smith's Mark | T2 | 22 | 4 | 8.1 [−0.7, 16.9] | 0.02 [−0.06, 0.11] | 0.17 [−0.52, 0.85] | −7.9 [−21.1, 5.2] |
| Arsenal Pact | T4 | 25 | 8 | −10.5 [−21.5, 0.5] | −0.08 [−0.16, 0.00] | 2.79 [0.34, 5.24] | −4.6 [−14.8, 5.6] |
| Pilgrim's Road | T2 | 16 | 4 | 6.8 [−3.7, 17.3] | −0.03 [−0.09, 0.04] | −1.67 [−2.81, −0.52] | 2.4 [−10.5, 15.3] |
| Merchant Bane | T3 | 12 | 3 | 5.2 [−2.2, 12.5] | 0.05 [−0.05, 0.16] | 0.89 [−1.19, 2.97] | −4.3 [−16.6, 8.0] |
| Nomad's Pact | T3 | 16 | 4 | −0.3 [−8.7, 8.1] | 0.05 [−0.06, 0.16] | 1.08 [−2.03, 4.20] | 10.9 [−1.6, 23.4] |
| Hold the Line | T2 | 13 | 1 | n/a | n/a | n/a | n/a |
| Quartermaster Cache | T2 | 13 | 4 | 1.0 [−21.0, 23.1] | 0.04 [−0.08, 0.16] | 1.08 [−1.56, 3.72] | −10.3 [−26.9, 6.3] |
| Forbidden Tome | T4 | 15 | 3 | −9.7 [−23.8, 4.3] | −0.41 [−0.47, −0.36] | −1.67 [−3.56, 0.23] | −13.1 [−27.3, 1.2] |
| Blood Forge | T2 | 18 | 6 | 6.6 [−7.9, 21.1] | −0.03 [−0.10, 0.04] | −1.00 [−2.72, 0.72] | −0.1 [−11.9, 11.8] |
| War Tutelage | T4 | 24 | 4 | −2.1 [−20.9, 16.6] | −0.12 [−0.20, −0.05] | −1.00 [−1.51, −0.49] | 1.6 [−9.9, 13.0] |
| Armory Stash | T4 | 0 | 0 | n/a | n/a | n/a | n/a |
| Scroll Archive | T4 | 14 | 2 | 6.2 [−4.1, 16.5] | −0.04 [−0.15, 0.08] | −0.58 [−2.76, 1.59] | −2.3 [−17.4, 12.9] |
| Focused Curriculum | T3 | 18 | 3 | −4.7 [−22.9, 13.6] | 0.07 [−0.04, 0.19] | 0.20 [−1.19, 1.59] | −0.7 [−20.4, 18.9] |
| Slow Fuse | T2 | 24 | 9 | 7.1 [−5.9, 20.0] | 0.01 [−0.09, 0.11] | −0.64 [−1.44, 0.15] | 0.3 [−11.1, 11.7] |
| Gambler's Toss | T3 | 20 | 4 | 7.4 [−6.1, 20.9] | 0.00 [−0.12, 0.13] | −1.06 [−2.22, 0.09] | −3.6 [−23.4, 16.2] |
| Bloodless Art | T2 | 20 | 6 | 9.4 [−5.5, 24.2] | −0.09 [−0.16, −0.01] | 0.36 [−2.47, 3.19] | 8.8 [−2.7, 20.2] |
| Phalanx Rite | T3 | 16 | 3 | −2.8 [−26.1, 20.5] | −0.03 [−0.15, 0.09] | 0.85 [−0.44, 2.14] | 3.9 [−21.5, 29.2] |
| Duelist's Creed | T3 | 21 | 4 | 6.4 [−5.2, 18.0] | −0.14 [−0.20, −0.07] | −0.81 [−2.00, 0.38] | 10.5 [−6.0, 27.1] |
| Late Bloom | T3 | 14 | 3 | 3.7 [−16.7, 24.2] | −0.13 [−0.32, 0.06] | 2.79 [−3.86, 9.43] | 4.5 [−2.5, 11.4] |
| Dawn Tithe | T2 | 15 | 6 | 3.5 [−7.5, 14.4] | 0.02 [−0.10, 0.13] | −0.22 [−1.12, 0.68] | 3.1 [−6.2, 12.4] |
| Lone Banner | T3 | 9 | 3 | 17.5 [−3.3, 38.3] | −0.05 [−0.20, 0.10] | −0.33 [−1.99, 1.32] | 6.6 [−15.5, 28.7] |
| Cavalier's Hour | T3 | 18 | 2 | −2.5 [−19.9, 14.9] | −0.06 [−0.10, −0.01] | 4.69 [−0.24, 9.61] | −3.0 [−20.5, 14.6] |
| Saint's Reserve | T2 | 16 | 2 | 2.7 [−28.0, 33.3] | 0.01 [−0.04, 0.06] | 2.86 [−7.00, 12.71] | −0.3 [−8.7, 8.1] |
| Cutpurse's Luck | T3 | 17 | 3 | 11.2 [−9.5, 32.0] | 0.08 [−0.06, 0.23] | −0.50 [−1.58, 0.58] | 10.0 [2.4, 17.7] |
| Open Roll | T3 | 13 | 2 | 7.9 [−1.7, 17.6] | −0.08 [−0.13, −0.03] | −0.68 [−1.72, 0.36] | 14.5 [8.8, 20.2] |
| Watcher's Grace | T2 | 14 | 2 | 13.6 [−1.6, 28.9] | −0.02 [−0.10, 0.07] | −0.17 [−1.34, 1.01] | 1.2 [−28.5, 30.9] |
| Patient Dawn | T3 | 20 | 8 | −3.3 [−15.2, 8.7] | 0.07 [−0.02, 0.16] | 0.50 [−0.81, 1.81] | −3.0 [−13.8, 7.9] |
| Twin Chapel | T2 | 15 | 4 | −5.9 [−19.7, 8.0] | 0.02 [−0.08, 0.12] | 0.57 [−1.22, 2.36] | −9.9 [−24.6, 4.9] |
| Omen Reader | T2 | 23 | 5 | 13.1 [0.7, 25.5] | 0.13 [0.04, 0.21] | 0.02 [−1.09, 1.13] | 5.2 [−8.0, 18.4] |
| Lottery Loot | T3 | 23 | 4 | 8.5 [−3.2, 20.2] | −0.02 [−0.07, 0.02] | −0.39 [−1.96, 1.17] | 6.9 [−12.0, 25.8] |
| Sealed Reliquary | gift | 14 | 1 | n/a | n/a | n/a | n/a |
| Fallen Hoard | gift | 17 | 4 | −15.4 [−29.2, −1.6] | 0.07 [−0.01, 0.15] | 1.21 [−1.32, 3.75] | −2.4 [−11.0, 6.2] |
| Stranger's Scroll | gift | 31 | 7 | −1.4 [−14.4, 11.7] | −0.05 [−0.12, 0.02] | −0.66 [−1.58, 0.26] | 3.1 [−10.1, 16.3] |
| Marked Blade | gift | 16 | 1 | n/a | n/a | n/a | n/a |
| Pilgrim's Wager | gift | 18 | 2 | −1.7 [−13.1, 9.7] | 0.17 [−0.06, 0.40] | 2.31 [−2.74, 7.36] | −10.7 [−18.4, −3.0] |
| Armory Stash | gift | 29 | 2 | 15.1 [5.1, 25.0] | 0.13 [−0.05, 0.32] | −1.13 [−2.30, 0.04] | −8.1 [−19.7, 3.6] |
| Unbroken Banner | earned | 208 | 128 | −3.3 [−8.5, 1.8] | −0.06 [−0.10, −0.01] | 0.49 [0.10, 0.89] | 0.6 [−5.3, 6.5] |
| Second Dawn | earned | 68 | 68 | −5.3 [−10.4, −0.2] | −0.02 [−0.08, 0.03] | 0.12 [−0.34, 0.58] | −4.0 [−8.5, 0.4] |
| Ember Lantern | earned | 202 | 122 | 3.6 [−2.7, 9.9] | −0.03 [−0.09, 0.02] | −0.31 [−0.73, 0.10] | 3.3 [−3.0, 9.6] |
| Captain's Whistle | earned | 208 | 125 | 1.0 [−4.2, 6.2] | 0.04 [−0.00, 0.08] | −0.31 [−0.82, 0.21] | −2.0 [−7.5, 3.4] |
| Standard of the Sun | earned | 95 | 50 | 1.0 [−5.0, 7.0] | 0.04 [−0.01, 0.10] | −0.07 [−0.76, 0.62] | 0.6 [−6.5, 7.6] |
| Hollow Hourglass | earned | 71 | 71 | −1.7 [−6.8, 3.4] | −0.05 [−0.10, −0.00] | 0.10 [−0.43, 0.62] | 4.9 [−0.5, 10.2] |
| Chronicle | earned | 102 | 53 | −2.6 [−8.9, 3.7] | 0.03 [−0.04, 0.10] | 0.04 [−0.19, 0.27] | 0.1 [−8.4, 8.6] |
| Tithe Box | earned | 58 | 30 | −1.5 [−9.0, 6.0] | 0.05 [−0.01, 0.11] | 0.29 [−0.08, 0.66] | 6.3 [−2.7, 15.3] |
| Lantern of the Road | earned | 74 | 74 | 3.6 [−0.7, 7.9] | 0.10 [−0.00, 0.20] | −0.21 [−0.59, 0.16] | −1.6 [−6.6, 3.4] |
| Crest of the Road | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reliquary | earned | 58 | 29 | 0.6 [−6.9, 8.0] | −0.04 [−0.11, 0.02] | −0.03 [−0.42, 0.35] | −6.3 [−15.2, 2.6] |
| Mercenary Ledger | earned | 60 | 60 | n/a | n/a | n/a | n/a |
| Smith's Covenant | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Thief's Lantern | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Seer's Eye | earned | 83 | 83 | 2.8 [−1.5, 7.1] | −0.02 [−0.07, 0.03] | 0.00 [−0.38, 0.39] | 0.6 [−4.8, 6.0] |
| Darkened Dawn | twisted | 77 | 42 | −5.5 [−13.5, 2.5] | −0.03 [−0.08, 0.03] | 0.11 [−0.44, 0.67] | −9.0 [−18.0, 0.1] |
| Blood Covenant | twisted | 115 | 61 | −9.9 [−17.7, −2.0] | 0.02 [−0.04, 0.08] | 0.78 [0.30, 1.25] | −8.2 [−16.2, −0.1] |
| Kingmaker's Oath | twisted | 131 | 70 | 2.4 [−4.6, 9.3] | −0.05 [−0.11, 0.01] | −0.06 [−0.44, 0.33] | −2.5 [−9.6, 4.5] |
| Hollow Sun's Favor | twisted | 114 | 57 | 8.6 [1.4, 15.8] | 0.08 [0.01, 0.15] | −0.56 [−0.92, −0.20] | 2.6 [−5.4, 10.6] |

### Nightfall (200 runs)

| card | kind | offered | taken | ΔkoBattle% | Δdeaths/battle | ΔwinsBeforeKO | Δstall% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 57 | 16 | 1.5 [−1.2, 4.2] | 0.00 [−0.05, 0.05] | 0.05 [−0.13, 0.24] | 13.1 [2.4, 23.9] |
| Advance Pay | T1 | 49 | 14 | 3.6 [−0.7, 7.9] | 0.05 [0.00, 0.10] | −0.20 [−0.46, 0.06] | −1.1 [−12.1, 9.9] |
| Blessed Vigor | T1 | 46 | 13 | −0.7 [−6.9, 5.5] | −0.01 [−0.07, 0.05] | 0.19 [−0.10, 0.47] | −2.5 [−13.8, 8.7] |
| Swift Instinct | T2 | 10 | 2 | −4.0 [−26.4, 18.4] | 0.01 [−0.12, 0.14] | −0.13 [−0.37, 0.12] | −18.7 [−44.7, 7.3] |
| Field Medic | T1 | 48 | 11 | −3.4 [−9.2, 2.4] | −0.01 [−0.06, 0.05] | 0.13 [−0.12, 0.38] | 4.1 [−6.5, 14.7] |
| Iron Oath | T3 | 11 | 3 | 0.7 [−8.0, 9.4] | −0.08 [−0.21, 0.04] | 0.08 [−0.64, 0.81] | 3.4 [−27.7, 34.6] |
| Scout Blessing | T2 | 8 | 1 | n/a | n/a | n/a | n/a |
| Scholar's Vow | T4 | 14 | 5 | −1.4 [−11.1, 8.3] | 0.01 [−0.07, 0.09] | −0.44 [−0.92, 0.03] | −21.0 [−42.8, 0.8] |
| Rally Cry | T2 | 11 | 1 | n/a | n/a | n/a | n/a |
| War Veteran | T3 | 9 | 0 | n/a | n/a | n/a | n/a |
| Smith's Mark | T2 | 10 | 1 | n/a | n/a | n/a | n/a |
| Arsenal Pact | T4 | 16 | 3 | −13.1 [−32.2, 6.1] | −0.09 [−0.17, −0.01] | 0.59 [−0.08, 1.26] | −0.8 [−30.0, 28.4] |
| Pilgrim's Road | T2 | 18 | 2 | 1.0 [−3.9, 5.9] | 0.01 [−0.06, 0.08] | 0.75 [0.53, 0.97] | 5.9 [−6.1, 17.8] |
| Merchant Bane | T3 | 11 | 1 | n/a | n/a | n/a | n/a |
| Nomad's Pact | T3 | 11 | 3 | 7.7 [−6.1, 21.5] | −0.09 [−0.19, 0.01] | 0.33 [−0.32, 0.99] | −1.7 [−14.6, 11.3] |
| Hold the Line | T2 | 8 | 2 | −0.0 [−3.3, 3.2] | −0.01 [−0.07, 0.05] | 0.00 [0.00, 0.00] | −0.4 [−52.9, 52.1] |
| Quartermaster Cache | T2 | 9 | 3 | −15.1 [−30.7, 0.6] | −0.01 [−0.08, 0.06] | 1.00 [−0.13, 2.13] | −2.4 [−27.3, 22.6] |
| Forbidden Tome | T4 | 9 | 2 | −4.5 [−9.4, 0.4] | −0.43 [−0.54, −0.33] | 0.00 [0.00, 0.00] | −22.1 [−36.6, −7.6] |
| Blood Forge | T2 | 11 | 3 | 2.0 [−3.1, 7.1] | −0.02 [−0.10, 0.06] | −0.25 [−0.57, 0.07] | 5.4 [−4.5, 15.2] |
| War Tutelage | T4 | 15 | 2 | −5.5 [−12.6, 1.6] | 0.10 [−0.01, 0.21] | −0.08 [−0.23, 0.07] | 0.8 [−18.3, 19.9] |
| Armory Stash | T4 | 0 | 0 | n/a | n/a | n/a | n/a |
| Scroll Archive | T4 | 11 | 1 | n/a | n/a | n/a | n/a |
| Focused Curriculum | T3 | 14 | 3 | −7.5 [−16.8, 1.9] | −0.04 [−0.09, −0.00] | −0.27 [−0.55, 0.00] | −2.1 [−13.6, 9.5] |
| Slow Fuse | T2 | 13 | 3 | −1.8 [−8.1, 4.5] | 0.05 [−0.05, 0.15] | −0.10 [−0.30, 0.10] | 5.0 [−13.3, 23.3] |
| Gambler's Toss | T3 | 14 | 4 | 2.7 [−3.5, 8.9] | 0.12 [0.01, 0.22] | −0.05 [−0.62, 0.52] | 4.4 [−13.7, 22.4] |
| Bloodless Art | T2 | 13 | 0 | n/a | n/a | n/a | n/a |
| Phalanx Rite | T3 | 5 | 1 | n/a | n/a | n/a | n/a |
| Duelist's Creed | T3 | 14 | 4 | 2.9 [−3.4, 9.1] | −0.07 [−0.15, 0.00] | 0.25 [−0.24, 0.74] | −1.9 [−18.0, 14.2] |
| Late Bloom | T3 | 13 | 2 | 3.4 [−4.2, 10.9] | −0.02 [−0.15, 0.12] | −0.18 [−0.42, 0.06] | 3.7 [−51.0, 58.5] |
| Dawn Tithe | T2 | 12 | 4 | −15.8 [−38.6, 7.0] | −0.02 [−0.10, 0.06] | 0.00 [0.00, 0.00] | 3.4 [−16.3, 23.0] |
| Lone Banner | T3 | 10 | 3 | 2.2 [−1.0, 5.4] | −0.05 [−0.13, 0.02] | 0.00 [0.00, 0.00] | −7.3 [−24.4, 9.8] |
| Cavalier's Hour | T3 | 6 | 1 | n/a | n/a | n/a | n/a |
| Saint's Reserve | T2 | 10 | 0 | n/a | n/a | n/a | n/a |
| Cutpurse's Luck | T3 | 16 | 2 | 3.9 [−1.1, 9.0] | −0.03 [−0.09, 0.03] | −0.21 [−0.44, 0.01] | 9.3 [4.6, 13.9] |
| Open Roll | T3 | 13 | 1 | n/a | n/a | n/a | n/a |
| Watcher's Grace | T2 | 12 | 2 | 2.9 [−0.6, 6.4] | 0.06 [−0.02, 0.13] | −0.10 [−0.30, 0.10] | −14.5 [−42.4, 13.4] |
| Patient Dawn | T3 | 12 | 4 | −0.9 [−7.2, 5.5] | −0.00 [−0.06, 0.06] | 0.25 [−0.40, 0.90] | −2.3 [−34.9, 30.3] |
| Twin Chapel | T2 | 7 | 1 | n/a | n/a | n/a | n/a |
| Omen Reader | T2 | 12 | 4 | 0.9 [−9.4, 11.1] | 0.05 [−0.02, 0.13] | 0.00 [0.00, 0.00] | 24.3 [10.9, 37.7] |
| Lottery Loot | T3 | 12 | 4 | 5.5 [0.7, 10.3] | 0.04 [−0.08, 0.17] | 0.00 [0.00, 0.00] | 0.0 [−19.2, 19.3] |
| Sealed Reliquary | gift | 29 | 8 | −2.3 [−7.0, 2.4] | −0.05 [−0.12, 0.01] | 0.11 [−0.25, 0.46] | −0.2 [−9.5, 9.0] |
| Fallen Hoard | gift | 14 | 4 | 0.8 [−11.7, 13.3] | 0.07 [−0.07, 0.21] | −0.30 [−0.60, −0.00] | 19.6 [−1.1, 40.2] |
| Stranger's Scroll | gift | 12 | 4 | 1.1 [−5.4, 7.6] | 0.02 [−0.07, 0.10] | −0.13 [−0.37, 0.12] | −6.7 [−23.8, 10.4] |
| Marked Blade | gift | 13 | 2 | −0.9 [−4.9, 3.1] | −0.07 [−0.10, −0.04] | −0.27 [−0.55, 0.00] | 3.5 [−7.4, 14.5] |
| Pilgrim's Wager | gift | 27 | 9 | 3.4 [−0.7, 7.6] | 0.07 [0.00, 0.14] | −0.06 [−0.34, 0.23] | 0.2 [−11.7, 12.1] |
| Armory Stash | gift | 17 | 5 | 3.5 [−3.7, 10.7] | −0.01 [−0.09, 0.07] | −0.17 [−0.39, 0.05] | 1.1 [−20.2, 22.4] |
| Unbroken Banner | earned | 172 | 103 | −1.4 [−5.6, 2.8] | −0.06 [−0.28, 0.16] | 0.07 [−0.06, 0.20] | 1.3 [−7.7, 10.4] |
| Second Dawn | earned | 38 | 38 | 2.9 [−0.1, 5.9] | −0.05 [−0.10, 0.00] | −0.18 [−0.39, 0.03] | −3.2 [−10.6, 4.2] |
| Ember Lantern | earned | 155 | 100 | −0.2 [−5.3, 4.9] | −0.19 [−0.37, −0.01] | −0.02 [−0.17, 0.12] | 2.6 [−5.8, 10.9] |
| Captain's Whistle | earned | 157 | 106 | 2.5 [−6.0, 11.0] | −0.17 [−0.38, 0.04] | 0.06 [−0.10, 0.22] | −6.0 [−15.7, 3.7] |
| Standard of the Sun | earned | 51 | 26 | 4.6 [0.2, 9.0] | −0.05 [−0.11, 0.01] | −0.09 [−0.36, 0.18] | 3.1 [−7.3, 13.5] |
| Hollow Hourglass | earned | 55 | 55 | −2.3 [−5.9, 1.3] | 0.05 [−0.03, 0.14] | 0.02 [−0.22, 0.25] | 2.9 [−4.2, 10.1] |
| Chronicle | earned | 51 | 22 | −0.3 [−5.7, 5.1] | −0.00 [−0.08, 0.08] | 0.01 [−0.10, 0.12] | −4.4 [−19.3, 10.4] |
| Tithe Box | earned | 47 | 26 | −6.4 [−11.9, −1.0] | −0.02 [−0.17, 0.14] | −0.05 [−0.14, 0.05] | −6.6 [−20.7, 7.5] |
| Lantern of the Road | earned | 55 | 55 | −3.2 [−7.1, 0.7] | 0.01 [−0.04, 0.07] | 0.22 [−0.05, 0.49] | −4.5 [−11.7, 2.7] |
| Crest of the Road | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reliquary | earned | 47 | 23 | 6.4 [0.7, 12.1] | 0.01 [−0.14, 0.15] | 0.04 [−0.04, 0.13] | 9.5 [−4.1, 23.1] |
| Mercenary Ledger | earned | 33 | 33 | n/a | n/a | n/a | n/a |
| Smith's Covenant | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Thief's Lantern | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Seer's Eye | earned | 50 | 50 | 3.4 [0.8, 6.0] | −0.03 [−0.08, 0.02] | −0.10 [−0.30, 0.09] | 4.3 [−2.6, 11.1] |
| Darkened Dawn | twisted | 50 | 25 | 1.9 [−6.6, 10.3] | 0.08 [−0.09, 0.25] | −0.20 [−0.57, 0.17] | −2.4 [−17.2, 12.3] |
| Blood Covenant | twisted | 104 | 67 | −9.4 [−17.9, −0.9] | −0.29 [−0.57, −0.01] | 0.21 [0.08, 0.34] | −21.0 [−31.5, −10.5] |
| Kingmaker's Oath | twisted | 107 | 73 | 4.5 [−5.6, 14.5] | 0.04 [−0.17, 0.24] | −0.10 [−0.30, 0.10] | −9.0 [−20.5, 2.5] |
| Hollow Sun's Favor | twisted | 125 | 75 | 1.1 [−4.5, 6.7] | 0.16 [0.02, 0.31] | −0.06 [−0.24, 0.12] | −4.5 [−13.1, 4.1] |

### Black Sun (200 runs)

| card | kind | offered | taken | ΔkoBattle% | Δdeaths/battle | ΔwinsBeforeKO | Δstall% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 52 | 13 | 0.4 [−2.5, 3.2] | 0.02 [−0.04, 0.08] | 0.00 [0.00, 0.00] | 1.3 [−9.7, 12.2] |
| Advance Pay | T1 | 58 | 13 | −2.8 [−5.7, 0.2] | 0.03 [−0.03, 0.09] | 0.00 [0.00, 0.00] | −12.0 [−25.2, 1.2] |
| Blessed Vigor | T1 | 44 | 15 | −2.7 [−6.1, 0.6] | 0.04 [−0.03, 0.10] | 0.00 [0.00, 0.00] | −4.2 [−14.8, 6.5] |
| Swift Instinct | T2 | 12 | 0 | n/a | n/a | n/a | n/a |
| Field Medic | T1 | 46 | 11 | 0.4 [−2.3, 3.2] | −0.03 [−0.09, 0.04] | −0.03 [−0.08, 0.03] | 10.8 [−1.6, 23.1] |
| Iron Oath | T3 | 11 | 2 | 0.6 [−3.1, 4.2] | −0.09 [−0.17, −0.01] | 0.00 [0.00, 0.00] | 10.6 [−14.2, 35.4] |
| Scout Blessing | T2 | 15 | 4 | −1.1 [−5.8, 3.5] | 0.09 [−0.04, 0.22] | 0.00 [0.00, 0.00] | −11.0 [−29.5, 7.5] |
| Scholar's Vow | T4 | 16 | 1 | n/a | n/a | n/a | n/a |
| Rally Cry | T2 | 8 | 1 | n/a | n/a | n/a | n/a |
| War Veteran | T3 | 10 | 2 | −3.1 [−9.3, 3.0] | 0.10 [−0.18, 0.38] | 0.00 [0.00, 0.00] | −19.2 [−31.9, −6.5] |
| Smith's Mark | T2 | 11 | 2 | −0.5 [−7.8, 6.8] | −0.07 [−0.21, 0.08] | 0.00 [0.00, 0.00] | 5.9 [−12.6, 24.5] |
| Arsenal Pact | T4 | 8 | 2 | 4.0 [−2.6, 10.5] | −0.02 [−0.11, 0.06] | 0.00 [0.00, 0.00] | −9.8 [−68.0, 48.4] |
| Pilgrim's Road | T2 | 14 | 3 | 0.8 [−2.1, 3.6] | −0.04 [−0.06, −0.01] | 0.00 [0.00, 0.00] | −5.2 [−18.3, 7.9] |
| Merchant Bane | T3 | 8 | 2 | 2.0 [0.1, 4.0] | 0.17 [0.08, 0.26] | 0.00 [0.00, 0.00] | 12.2 [−12.9, 37.3] |
| Nomad's Pact | T3 | 7 | 2 | 2.0 [−0.7, 4.7] | −0.08 [−0.25, 0.10] | 0.00 [0.00, 0.00] | 18.5 [−8.7, 45.8] |
| Hold the Line | T2 | 11 | 6 | 0.7 [−2.6, 3.9] | −0.01 [−0.07, 0.04] | 0.00 [0.00, 0.00] | 16.2 [−4.9, 37.2] |
| Quartermaster Cache | T2 | 10 | 6 | 1.8 [−1.3, 4.9] | 0.04 [−0.05, 0.14] | 0.00 [0.00, 0.00] | −5.7 [−28.9, 17.4] |
| Forbidden Tome | T4 | 13 | 1 | n/a | n/a | n/a | n/a |
| Blood Forge | T2 | 12 | 2 | 3.0 [0.3, 5.7] | −0.12 [−0.27, 0.02] | 0.00 [0.00, 0.00] | 20.3 [−1.0, 41.6] |
| War Tutelage | T4 | 14 | 5 | 1.4 [−3.8, 6.6] | 0.09 [0.01, 0.18] | 0.00 [0.00, 0.00] | −11.2 [−27.6, 5.2] |
| Armory Stash | T4 | 0 | 0 | n/a | n/a | n/a | n/a |
| Scroll Archive | T4 | 9 | 3 | 1.8 [−2.1, 5.7] | −0.03 [−0.15, 0.10] | 0.00 [0.00, 0.00] | 2.9 [−22.9, 28.7] |
| Focused Curriculum | T3 | 11 | 3 | −4.3 [−14.7, 6.0] | −0.04 [−0.18, 0.09] | 0.00 [0.00, 0.00] | −14.4 [−45.4, 16.6] |
| Slow Fuse | T2 | 13 | 3 | 1.9 [−3.7, 7.5] | −0.06 [−0.16, 0.05] | −0.10 [−0.30, 0.10] | 15.5 [−13.6, 44.6] |
| Gambler's Toss | T3 | 12 | 1 | n/a | n/a | n/a | n/a |
| Bloodless Art | T2 | 4 | 1 | n/a | n/a | n/a | n/a |
| Phalanx Rite | T3 | 10 | 3 | 0.3 [−2.3, 3.0] | 0.05 [−0.04, 0.13] | 0.00 [0.00, 0.00] | −8.0 [−54.0, 38.0] |
| Duelist's Creed | T3 | 16 | 3 | −3.8 [−11.5, 3.9] | −0.03 [−0.18, 0.12] | 0.00 [0.00, 0.00] | 9.5 [−12.4, 31.4] |
| Late Bloom | T3 | 10 | 2 | 1.6 [−0.0, 3.2] | 0.01 [−0.09, 0.11] | 0.00 [0.00, 0.00] | −2.8 [−21.3, 15.7] |
| Dawn Tithe | T2 | 11 | 3 | −0.6 [−9.6, 8.5] | −0.12 [−0.26, 0.03] | 0.00 [0.00, 0.00] | 14.2 [−12.6, 41.1] |
| Lone Banner | T3 | 10 | 5 | −7.5 [−19.1, 4.1] | −0.01 [−0.12, 0.09] | 0.20 [−0.19, 0.59] | −7.4 [−38.9, 24.2] |
| Cavalier's Hour | T3 | 11 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reserve | T2 | 8 | 1 | n/a | n/a | n/a | n/a |
| Cutpurse's Luck | T3 | 12 | 1 | n/a | n/a | n/a | n/a |
| Open Roll | T3 | 3 | 2 | n/a | n/a | n/a | n/a |
| Watcher's Grace | T2 | 15 | 2 | −0.1 [−3.5, 3.3] | −0.06 [−0.20, 0.07] | 0.00 [0.00, 0.00] | 3.0 [−18.0, 24.0] |
| Patient Dawn | T3 | 13 | 4 | 0.2 [−5.2, 5.6] | −0.11 [−0.23, 0.01] | 0.00 [0.00, 0.00] | 17.5 [1.1, 34.0] |
| Twin Chapel | T2 | 21 | 6 | 2.5 [−1.2, 6.2] | −0.00 [−0.08, 0.07] | 0.00 [0.00, 0.00] | 3.4 [−9.9, 16.7] |
| Omen Reader | T2 | 12 | 4 | 1.7 [−0.2, 3.5] | 0.10 [−0.02, 0.22] | 0.00 [0.00, 0.00] | 4.0 [−18.3, 26.4] |
| Lottery Loot | T3 | 19 | 3 | 2.7 [−1.2, 6.7] | −0.04 [−0.08, 0.01] | 0.00 [0.00, 0.00] | −3.0 [−29.8, 23.9] |
| Sealed Reliquary | gift | 18 | 5 | 1.6 [−0.5, 3.6] | 0.01 [−0.07, 0.09] | 0.00 [0.00, 0.00] | −12.4 [−37.7, 13.0] |
| Fallen Hoard | gift | 15 | 1 | n/a | n/a | n/a | n/a |
| Stranger's Scroll | gift | 18 | 5 | 2.4 [−0.4, 5.2] | −0.03 [−0.11, 0.05] | 0.00 [0.00, 0.00] | 5.4 [−13.3, 24.1] |
| Marked Blade | gift | 19 | 3 | 2.7 [−0.3, 5.7] | −0.09 [−0.15, −0.03] | 0.00 [0.00, 0.00] | 14.8 [4.9, 24.8] |
| Pilgrim's Wager | gift | 20 | 1 | n/a | n/a | n/a | n/a |
| Armory Stash | gift | 16 | 2 | 0.5 [−3.3, 4.2] | 0.04 [−0.09, 0.17] | 0.00 [0.00, 0.00] | −11.4 [−37.6, 14.9] |
| Unbroken Banner | earned | 172 | 115 | −1.9 [−6.3, 2.4] | −0.08 [−0.21, 0.05] | 0.01 [−0.04, 0.05] | 0.7 [−7.0, 8.4] |
| Second Dawn | earned | 34 | 34 | −1.4 [−4.3, 1.5] | 0.03 [−0.03, 0.10] | 0.01 [−0.05, 0.07] | −3.4 [−11.2, 4.4] |
| Ember Lantern | earned | 164 | 107 | −0.6 [−5.7, 4.5] | −0.23 [−0.48, 0.02] | 0.07 [−0.04, 0.17] | −4.4 [−12.9, 4.1] |
| Captain's Whistle | earned | 166 | 103 | 4.5 [−3.0, 11.9] | −0.34 [−0.55, −0.12] | −0.06 [−0.14, 0.03] | 1.4 [−6.5, 9.3] |
| Standard of the Sun | earned | 61 | 39 | −0.8 [−4.8, 3.3] | −0.07 [−0.13, −0.01] | 0.00 [0.00, 0.00] | 5.5 [−4.3, 15.4] |
| Hollow Hourglass | earned | 37 | 37 | 0.0 [−2.5, 2.5] | 0.01 [−0.06, 0.08] | 0.01 [−0.05, 0.07] | 5.0 [−3.0, 12.9] |
| Chronicle | earned | 57 | 29 | 0.4 [−4.1, 4.9] | −0.04 [−0.12, 0.04] | 0.00 [0.00, 0.00] | 1.0 [−11.2, 13.3] |
| Tithe Box | earned | 56 | 35 | 2.2 [−4.9, 9.2] | −0.14 [−0.32, 0.04] | −0.07 [−0.26, 0.13] | −6.2 [−17.7, 5.4] |
| Lantern of the Road | earned | 62 | 62 | 1.0 [−0.7, 2.7] | 0.00 [−0.04, 0.05] | −0.03 [−0.06, −0.00] | 1.1 [−5.5, 7.7] |
| Crest of the Road | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reliquary | earned | 56 | 23 | −2.0 [−8.6, 4.6] | 0.12 [−0.04, 0.29] | 0.06 [−0.12, 0.24] | 4.1 [−7.4, 15.6] |
| Mercenary Ledger | earned | 36 | 36 | n/a | n/a | n/a | n/a |
| Smith's Covenant | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Thief's Lantern | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Seer's Eye | earned | 67 | 67 | −0.1 [−2.0, 1.9] | −0.03 [−0.08, 0.02] | 0.01 [−0.03, 0.06] | −2.3 [−8.3, 3.7] |
| Darkened Dawn | twisted | 47 | 27 | −4.5 [−13.6, 4.5] | 0.09 [−0.04, 0.22] | 0.04 [−0.04, 0.11] | −4.5 [−18.0, 9.0] |
| Blood Covenant | twisted | 102 | 60 | −1.6 [−9.7, 6.5] | −0.03 [−0.33, 0.28] | 0.06 [−0.13, 0.25] | −2.8 [−11.8, 6.2] |
| Kingmaker's Oath | twisted | 116 | 66 | −1.0 [−6.4, 4.3] | 0.19 [0.01, 0.37] | −0.00 [−0.05, 0.04] | −1.2 [−10.2, 7.9] |
| Hollow Sun's Favor | twisted | 107 | 67 | −4.0 [−9.7, 1.7] | 0.28 [0.09, 0.47] | 0.03 [−0.04, 0.11] | 1.4 [−7.5, 10.3] |

