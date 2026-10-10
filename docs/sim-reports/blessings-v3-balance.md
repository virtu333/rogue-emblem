# Blessings v3 balance, with policies that claim the cards

Report of `npm run sim:blessings` (2026-10-10). The 1000 runs were played from scratch on this
branch merged with main `9f12dcf6` (#278, and #283: Fiendish Blow +5 ATK, which changes battles).
The claiming driver and policies are those of `a5dee778`. Three stored runs were re-played on
`45fa08ae` and came out identical. Every table below is printed by
`npm run sim:blessings -- --from ...` at `45fa08ae`; none is edited by hand.

**No card data was changed for this report.** It measures the cards; it does not retune them.

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
| Event grants (#268, #270: event policies skipped them) | Crest of the Road, Smith's Covenant, Thief's Lantern | `chooseClaimEventPlan`: a choice that may grant an earned card first | 13% of runs (Smith's Covenant 127, Crest 6, Thief's Lantern 0) |
| Colosseum card and Ledger fees (#270) | Mercenary Ledger | `playColosseum`: arena bouts at 60%+ win odds through the overlay's engine calls; the first gold/platinum win offers the card | 27% of runs fight; 176 Ledgers taken |
| Battle loot (#267: "takes no loot") | Lottery Loot, Dawn Tithe, Hollow Sun's Favor's loot gold | `claimBattleRewards`: `prepareBattleRewards`, then the best card by a simple value through the reward commands | every battle |
| Steal (#267) | Cutpurse's Luck, Thief's Lantern | harness Steal (opt-in, `HeadlessBattle` `steal`), planned by `ClaimingAgent` | 186 steals in 1000 runs (10% of runs) |
| Swap a candidate (#267) | Open Roll | `chooseRecruitCandidate`: meet the alternate when the engine-built unit is stronger | 40 alternates offered, 17 swaps |
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
- **Comparisons.**
  - **Start cards and gifts:** the runs that took it against the runs offered it that took
    something else (another card, the gift or nothing), over the whole run.
  - **Earned cards from a pair** (act boss, sanctum): judged at the run's FIRST offer of the card.
    Took it there, against passed it there and took the other card. Both groups read their battles
    from that first offer on. A run that passed it and took it at a later offer counts with those
    who passed it (intention to treat at the first offer; the earned table's `took later` column
    counts them).
  - **Eclipsed elite's card** (always taken): the runs whose first eclipsed-elite drop was this
    card, against those whose first drop was another. A few of these cards also turn up in a
    sanctum pair (5 of Hollow Hourglass's 671 offers); those pair offers are left out, since the
    card is compared on the source that hands it out most.
  - **Why the comparison is approximate.** Which card a run takes of an offer is keyed by seed. But
    whether a run is offered an earned card at all follows the snowball guard (fewer offers to a
    run already holding earned cards), which depends on the run's history. So these are
    observational comparisons, close to randomized but not randomized trials.
  - **Pooling and intervals.** Per-rung differences are pooled with weights nA·nB/(nA+nB);
    intervals are 95% (Welch standard errors).
  - An earned card's difference is **relative to the alternative card it was offered with**, not
    to "no card".
- **Outcomes.** `koBattle%`: share of battles with a commander KO. `ko/battle`: commander KOs per
  battle (severity; a restored commander can fall again). `deaths/battle`: other units' falls.
  `winsBeforeKO`: battles won before the first commander KO. `stall%`: share of battles unwon at
  turn 30. `gold`: gold at the run's end. Lower is better for the first four ko/death/stall
  measures, higher for `winsBeforeKO` and `gold`.
- **Exercised.** For a card with a detector (a Banner hold, a lantern heal, a steal, a swap, a
  second vow, a lottery card, Dawn Tithe gold, a free forge, a tithe, a halved arena fee, a rewind
  while a Vision card is held, ...): the share of runs holding it where it fired. A passive card
  counts as exercised when held in a battle.
- **Flags.**
  - **Nominal:** a 95% interval that excludes 0, with at least 10 takers. With about 65 cards and
    6 outcomes, roughly 20 nominal flags are expected by chance alone.
  - **Family-wise (FW):** |z| ≥ 3.83 with at least 30 takers.
  - **How the cutoff is set.** It is computed from the comparisons the report makes: 65 cards × 6
    outcomes = 390, Bonferroni, each two-sided test at 0.05 / 390 (`familyCutoff` in
    `sim/lib/BlessingReport.js`). An earlier draft used 3.66, which is the cutoff for about 200
    comparisons.
  - **Why 30 takers.** A cutoff that far out in the tail of a normal approximation is not
    trustworthy for a handful of runs.
  - Only FW flags are strong evidence. The flags table prints each flag's z.
- **Reproduce.** `npm run sim:blessings -- --trials 300 --difficulty normal --out fl.jsonl` (and
  `dusk` 300, `hard` 200, `lunatic` 200), then `npm run sim:blessings -- --from fl.jsonl,dusk.jsonl,nf.jsonl,bs.jsonl --md tables.md`.
  `--workers 2` splits one batch over two processes.

## How hard the runs are for this player

The agent loses badly above First Light. Read every difference on Nightfall and Black Sun as close
to uninformative: nearly every battle there has a commander KO, and 41% (Nightfall) and 61% (Black
Sun) of battles hit the turn cap.

| rung | runs | battles | koBattle% | ko/battle | deaths/battle | winsBeforeKO | stall% | clean% | gold | rewinds | stalls |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| First Light | 300 | 22 | 41 | 1.57 | 0.77 | 6.27 | 10.2 | 0.3 | 5077 | 5.2 | 2.26 |
| Dusk | 300 | 30.1 | 72.4 | 4.37 | 0.6 | 1.76 | 23.8 | 0 | 7955 | 6.36 | 7.17 |
| Nightfall | 200 | 31.3 | 93.1 | 9.01 | 0.63 | 0.15 | 41.1 | 0 | 6007 | 8.31 | 12.88 |
| Black Sun | 200 | 31.4 | 98.1 | 21.29 | 0.68 | 0.01 | 60.6 | 0 | 7041 | 8.39 | 19.03 |

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
| lotteryCardsOffered | 0.74 | 4% |
| lotteryCardsTaken | 0.3 | 4% |
| dawnTitheGold | 15.3 | 2% |
| steals | 0.19 | 10% |
| stealsSpeedWaived | 0 | 0% |
| recruitAlternatesOffered | 0.04 | 2% |
| recruitSwaps | 0.02 | 1% |
| talkRecruits | 2.42 | 93% |
| visionRewinds | 6.81 | 100% |
| visionGraceRewinds | 0.04 | 1% |
| replayMismatches | 0 | 0% |
| churchVisits | 1.11 | 71% |
| secondVows | 0.01 | 1% |
| cleanses | 0.01 | 1% |
| churchBlessings | 0.6 | 47% |
| churchPromotions | 0.31 | 21% |
| freePromotions | 0.13 | 7% |
| revives | 10.98 | 99% |
| titheGold | 11 | 5% |
| colosseumBouts | 0.57 | 27% |
| colosseumWins | 0.56 | 26% |
| ledgerFeeSaved | 2.85 | 1% |
| freeForges | 0.07 | 5% |
| paidForges | 0.73 | 55% |
| itemHeals | 8.94 | 100% |
| convoyElixirHeals | 0.8 | 56% |
| goldPouches | 0.03 | 2% |
| boostersUsed | 0.06 | 6% |
| skillScrollsLearned | 1.26 | 65% |
| artScrollsBound | 1.15 | 60% |
| accessoriesEquipped | 10.71 | 97% |
| sealPromotions | 0.22 | 21% |
| sealsRefused | 0.27 | 2% |
| bossRecruits | 3.4 | 100% |
| ruinsRests | 4.4 | 100% |
| bannerHolds | 5.5 | 48% |
| lanternHeals | 5.29 | 46% |
| staffHeals | 5 | 78% |
| carriersSeen | 12.28 | 99% |
| stalls | 9.21 | 93% |
| battleLosses | 0 | 0% |

### Start cards and gifts

Took it − offered it and took something else (or nothing), over the whole run.

| card | kind | offered | taken | exercised | ΔkoBattle% | Δko/battle | Δdeaths/battle | ΔwinsBeforeKO | Δstall% | Δgold | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 268 | 72 | 100% passive | −2.4 [−5.6, 0.8] | 0.43 [−0.83, 1.68] | 0.02 [−0.01, 0.05] | 0.33 [−0.32, 0.98] | 2.2 [−1.9, 6.2] | 328 [−721, 1378] |  |
| Advance Pay | T1 | 238 | 60 | 100% detected | −0.5 [−4.1, 3.2] | −1.30 [−2.59, 0.00] | 0.02 [−0.01, 0.05] | −0.02 [−0.76, 0.72] | −4.0 [−8.4, 0.4] | 1584 [−3161, 6329] |  |
| Blessed Vigor | T1 | 258 | 63 | 100% passive | −5.1 [−8.5, −1.6] | −1.48 [−2.70, −0.27] | 0.03 [−0.01, 0.07] | 0.89 [0.13, 1.65] | −1.6 [−5.5, 2.4] | −670 [−5552, 4212] | koBattle% stronger; ko/battle stronger; winsBeforeKO stronger |
| Swift Instinct | T2 | 54 | 10 | 100% passive | −5.6 [−19.3, 8.1] | −1.45 [−3.48, 0.58] | −0.04 [−0.11, 0.04] | −0.16 [−1.74, 1.43] | −2.2 [−13.1, 8.6] | −795 [−2919, 1329] |  |
| Field Medic | T1 | 236 | 52 | 100% detected | 2.0 [−1.5, 5.5] | 1.58 [0.21, 2.96] | −0.02 [−0.05, 0.01] | 0.02 [−0.77, 0.81] | 5.1 [0.8, 9.4] | −825 [−2293, 643] | ko/battle weaker; stall% weaker |
| Iron Oath | T3 | 54 | 13 | 100% passive | −2.7 [−10.7, 5.4] | 0.92 [−0.76, 2.61] | −0.04 [−0.11, 0.03] | 0.74 [−1.34, 2.82] | 1.6 [−7.0, 10.3] | −825 [−2089, 439] |  |
| Scout Blessing | T2 | 52 | 10 | 100% passive | −6.1 [−11.7, −0.6] | −0.89 [−6.09, 4.32] | 0.02 [−0.04, 0.09] | 0.38 [−0.94, 1.71] | −8.3 [−19.3, 2.8] | 604 [−1280, 2488] | koBattle% stronger |
| Scholar's Vow | T4 | 66 | 17 | 100% passive | −2.8 [−11.3, 5.7] | −1.93 [−3.77, −0.09] | −0.02 [−0.07, 0.04] | −0.30 [−1.73, 1.13] | −10.0 [−18.4, −1.6] | −1001 [−2732, 730] | ko/battle stronger; stall% stronger |
| Rally Cry | T2 | 48 | 5 | 100% passive | −5.5 [−20.1, 9.0] | −1.81 [−4.55, 0.94] | 0.00 [−0.07, 0.08] | 2.86 [1.07, 4.66] | −0.5 [−4.7, 3.7] | 3152 [1815, 4489] |  |
| War Veteran | T3 | 44 | 6 | 100% passive | −5.8 [−23.6, 12.0] | −2.44 [−4.69, −0.20] | 0.05 [−0.04, 0.14] | −2.25 [−3.12, −1.39] | −9.4 [−15.4, −3.4] | 1053 [−335, 2442] |  |
| Smith's Mark | T2 | 55 | 8 | 38% detected | 5.5 [−0.2, 11.2] | 1.43 [−1.78, 4.64] | 0.00 [−0.07, 0.08] | 0.11 [−0.35, 0.57] | −2.9 [−14.2, 8.4] | 776 [−562, 2114] |  |
| Arsenal Pact | T4 | 73 | 19 | 100% passive | −3.0 [−10.0, 4.1] | −1.25 [−3.01, 0.52] | −0.05 [−0.11, 0.01] | 1.03 [−0.54, 2.60] | −0.9 [−9.8, 8.0] | −5096 [−11777, 1586] |  |
| Pilgrim's Road | T2 | 68 | 14 | 50% detected | 1.4 [−4.2, 7.0] | 0.27 [−1.68, 2.22] | −0.03 [−0.07, 0.01] | −0.13 [−1.10, 0.84] | −3.5 [−10.2, 3.2] | −1733 [−4525, 1060] |  |
| Merchant Bane | T3 | 48 | 9 | 100% passive | 7.0 [−3.9, 17.8] | 1.47 [−0.71, 3.65] | 0.04 [−0.02, 0.10] | −1.71 [−3.19, −0.23] | 0.8 [−8.8, 10.4] | 339 [−1343, 2021] |  |
| Nomad's Pact | T3 | 44 | 10 | 100% detected | 0.9 [−4.0, 5.7] | −0.53 [−3.75, 2.69] | −0.03 [−0.11, 0.06] | 0.60 [−0.83, 2.03] | 6.2 [−4.1, 16.4] | −207 [−1533, 1119] |  |
| Hold the Line | T2 | 47 | 14 | 100% passive | −6.0 [−13.1, 1.0] | 0.58 [−3.88, 5.04] | −0.01 [−0.06, 0.04] | 0.66 [−1.24, 2.56] | 5.6 [−6.9, 18.1] | 232 [−1040, 1504] |  |
| Quartermaster Cache | T2 | 52 | 15 | 100% detected | −3.0 [−12.3, 6.4] | −1.52 [−4.91, 1.88] | −0.00 [−0.05, 0.04] | −0.30 [−1.28, 0.68] | −4.8 [−15.8, 6.1] | 50 [−1226, 1325] |  |
| Forbidden Tome | T4 | 57 | 10 | 100% passive | −10.4 [−17.8, −3.1] | −2.22 [−3.44, −0.99] | −0.38 [−0.45, −0.31] | 0.22 [−3.00, 3.44] | −11.8 [−18.7, −4.9] | 38495 [32157, 44833] | koBattle% stronger; ko/battle stronger; deaths/battle stronger; stall% stronger; gold stronger |
| Blood Forge | T2 | 67 | 15 | 100% passive | 5.1 [−3.3, 13.5] | 1.19 [−0.84, 3.23] | −0.02 [−0.07, 0.03] | −0.10 [−1.85, 1.65] | 4.2 [−2.4, 10.8] | −2895 [−6851, 1060] |  |
| War Tutelage | T4 | 74 | 17 | 100% passive | −1.1 [−9.2, 6.9] | 0.68 [−1.63, 2.99] | 0.01 [−0.04, 0.05] | −0.54 [−1.30, 0.22] | −1.8 [−7.9, 4.3] | 1028 [−429, 2484] |  |
| Armory Stash | T4 | 0 | 0 | - | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Scroll Archive | T4 | 51 | 10 | not reached: its art scrolls are bound, but the battle agent never uses a weapon art | −2.4 [−9.8, 5.0] | 2.14 [−1.89, 6.17] | 0.01 [−0.04, 0.07] | 1.27 [−0.90, 3.44] | 0.1 [−11.3, 11.4] | −124 [−1523, 1276] |  |
| Focused Curriculum | T3 | 65 | 15 | 100% passive | −2.8 [−9.0, 3.4] | −1.98 [−3.83, −0.12] | −0.01 [−0.07, 0.05] | −0.96 [−1.87, −0.05] | −2.1 [−10.7, 6.4] | −261 [−1326, 804] | ko/battle stronger; winsBeforeKO weaker |
| Slow Fuse | T2 | 64 | 18 | 100% passive | 4.4 [−2.6, 11.4] | −0.03 [−2.33, 2.28] | 0.01 [−0.05, 0.07] | −0.93 [−1.54, −0.32] | 2.2 [−5.3, 9.8] | −1807 [−2737, −877] | winsBeforeKO weaker; gold weaker |
| Gambler's Toss | T3 | 62 | 13 | 100% detected | 1.7 [−6.6, 9.9] | 0.31 [−1.49, 2.10] | 0.09 [0.02, 0.15] | −0.42 [−2.13, 1.30] | −0.8 [−10.0, 8.4] | −2383 [−7322, 2556] | deaths/battle weaker |
| Bloodless Art | T2 | 53 | 10 | not reached: the battle agent never uses a weapon art | 4.6 [−6.6, 15.8] | 0.08 [−1.31, 1.48] | −0.04 [−0.10, 0.02] | −0.27 [−2.48, 1.93] | 6.4 [−1.6, 14.3] | −1139 [−2496, 217] |  |
| Phalanx Rite | T3 | 46 | 12 | 100% passive | −0.2 [−8.2, 7.8] | 1.83 [−2.53, 6.19] | −0.01 [−0.07, 0.04] | −0.88 [−2.15, 0.38] | −0.3 [−14.0, 13.3] | 913 [−399, 2226] |  |
| Duelist's Creed | T3 | 68 | 18 | 100% passive | −3.8 [−10.2, 2.6] | −1.43 [−3.75, 0.90] | −0.02 [−0.08, 0.04] | 0.98 [−0.70, 2.67] | 6.2 [−1.8, 14.2] | −1993 [−6433, 2446] |  |
| Late Bloom | T3 | 54 | 10 | 100% detected | −0.2 [−11.8, 11.4] | 1.15 [−1.81, 4.12] | −0.04 [−0.11, 0.02] | 1.40 [−1.71, 4.51] | 1.9 [−12.4, 16.3] | −2973 [−6406, 460] |  |
| Dawn Tithe | T2 | 54 | 18 | 89% detected | 2.4 [−4.1, 8.9] | 1.02 [−1.04, 3.09] | −0.04 [−0.11, 0.02] | −0.64 [−1.67, 0.40] | 5.1 [−2.7, 12.9] | −2309 [−6092, 1473] |  |
| Lone Banner | T3 | 52 | 18 | 100% passive | −1.2 [−8.2, 5.8] | 0.56 [−2.46, 3.57] | −0.03 [−0.10, 0.05] | 1.05 [−0.61, 2.70] | 0.0 [−9.0, 9.1] | −637 [−1938, 665] |  |
| Cavalier's Hour | T3 | 46 | 6 | 100% passive | −4.8 [−25.2, 15.6] | −0.37 [−1.40, 0.65] | −0.00 [−0.09, 0.08] | 4.86 [1.05, 8.67] | 2.9 [−10.4, 16.1] | −1808 [−3300, −316] |  |
| Saint's Reserve | T2 | 55 | 6 | 100% detected | −5.5 [−30.5, 19.4] | −0.18 [−1.58, 1.21] | 0.08 [−0.05, 0.21] | 0.46 [−4.34, 5.27] | 1.2 [−7.2, 9.7] | −2487 [−8807, 3832] |  |
| Cutpurse's Luck | T3 | 62 | 9 | 11% detected | 2.8 [−7.6, 13.2] | 0.16 [−1.10, 1.42] | 0.03 [−0.03, 0.10] | −0.64 [−2.72, 1.45] | 5.7 [0.6, 10.7] | 1384 [−6853, 9622] |  |
| Open Roll | T3 | 50 | 11 | 91% detected | −5.4 [−13.3, 2.6] | 0.16 [−1.16, 1.48] | −0.03 [−0.12, 0.07] | −0.17 [−2.16, 1.82] | 1.6 [−5.3, 8.4] | −1116 [−2972, 740] |  |
| Watcher's Grace | T2 | 65 | 9 | 100% detected | 5.4 [−4.2, 14.9] | −0.58 [−4.10, 2.93] | 0.02 [−0.03, 0.06] | −1.08 [−2.24, 0.09] | −5.4 [−15.5, 4.7] | 449 [−876, 1775] |  |
| Patient Dawn | T3 | 57 | 22 | 100% detected | −6.4 [−14.5, 1.8] | 0.36 [−2.33, 3.05] | 0.04 [−0.00, 0.09] | 0.65 [−0.33, 1.63] | 0.7 [−8.8, 10.2] | −383 [−2104, 1338] |  |
| Twin Chapel | T2 | 61 | 15 | 40% detected | 1.7 [−6.5, 9.9] | −0.02 [−2.78, 2.74] | −0.01 [−0.07, 0.05] | −1.25 [−2.55, 0.05] | −3.9 [−12.4, 4.6] | −418 [−1728, 892] |  |
| Omen Reader | T2 | 64 | 14 | not reached: the route policy does not read the omen marks (the spared recruit nodes still act) | 6.6 [0.9, 12.3] | −0.22 [−3.57, 3.13] | 0.10 [0.05, 0.15] | 0.01 [−0.46, 0.48] | 6.3 [−4.0, 16.7] | −2422 [−5951, 1108] | koBattle% weaker; deaths/battle weaker |
| Lottery Loot | T3 | 68 | 15 | 100% detected | 7.3 [1.8, 12.7] | 1.63 [−2.23, 5.50] | −0.03 [−0.07, 0.02] | 0.07 [−1.01, 1.15] | 0.8 [−8.5, 10.0] | −3187 [−7644, 1271] | koBattle% weaker |
| Sealed Reliquary | gift | 87 | 21 | 100% granted | −1.3 [−6.0, 3.3] | −1.35 [−3.94, 1.24] | −0.02 [−0.08, 0.04] | 0.07 [−0.97, 1.11] | −5.0 [−13.1, 3.1] | 798 [−892, 2488] |  |
| Fallen Hoard | gift | 74 | 14 | 100% granted | 0.6 [−6.0, 7.2] | 0.26 [−1.50, 2.02] | −0.00 [−0.05, 0.05] | 0.15 [−0.91, 1.22] | 4.9 [−2.7, 12.6] | 15076 [−6100, 36252] |  |
| Stranger's Scroll | gift | 86 | 22 | 100% granted | 0.4 [−5.4, 6.1] | −0.02 [−2.22, 2.17] | −0.01 [−0.06, 0.03] | 0.11 [−1.05, 1.26] | 1.9 [−5.5, 9.3] | −345 [−2057, 1368] |  |
| Marked Blade | gift | 81 | 8 | 100% granted | 0.4 [−10.1, 10.9] | −1.40 [−6.18, 3.37] | −0.04 [−0.08, 0.00] | −1.20 [−1.95, −0.45] | 3.2 [−3.7, 10.1] | −3717 [−10672, 3238] |  |
| Pilgrim's Wager | gift | 89 | 16 | 100% granted | 1.9 [−2.5, 6.3] | 1.24 [−0.79, 3.27] | 0.02 [−0.04, 0.07] | 0.89 [−0.32, 2.11] | −1.8 [−9.5, 6.0] | 2038 [−7314, 11391] |  |
| Armory Stash | gift | 92 | 12 | 100% granted | 1.6 [−4.8, 8.0] | −2.68 [−4.79, −0.56] | 0.01 [−0.09, 0.12] | −0.77 [−2.83, 1.28] | −4.7 [−12.6, 3.2] | −137 [−1682, 1407] | ko/battle stronger |

### Earned cards

Took it at its first offer − passed it at its first offer (a run that passed it and took it at a later offer counts with those who passed it: `took later`), over the run's battles from that first offer on; a card its source offers alone (an eclipsed elite's drop, the Colosseum's) is compared at each run's first offer from that source (this card first against another card first), whenever that source hands it out more often than pairs do (its few pair offers are then left out). `granted`: given by an event (no choice, not compared).

| card | kind | offered | taken | took later | granted | compared with | exercised | ΔkoBattle% | Δko/battle | Δdeaths/battle | ΔwinsBeforeKO | Δstall% | Δgold | flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Unbroken Banner | earned | 771 | 391 | 93 | 0 | the other card | 99% detected | 0.5 [−2.5, 3.5] | 0.55 [−0.56, 1.67] | −0.03 [−0.14, 0.08] | −0.04 [−0.26, 0.19] | 4.2 [0.7, 7.6] | −531 [−2230, 1167] | stall% weaker |
| Second Dawn | earned | 177 | 177 | - | 0 | source peers | 93% detected | −2.7 [−5.5, −0.0] | −1.11 [−2.09, −0.13] | −0.04 [−0.10, 0.01] | 0.09 [−0.15, 0.33] | −3.6 [−6.6, −0.5] | 1287 [−737, 3311] | koBattle% stronger; ko/battle stronger; stall% stronger |
| Ember Lantern | earned | 729 | 357 | 98 | 0 | the other card | 100% detected | 1.4 [−1.5, 4.3] | 1.00 [−0.19, 2.18] | −0.09 [−0.21, 0.03] | −0.00 [−0.21, 0.20] | 3.8 [0.3, 7.3] | 205 [−1555, 1965] | stall% weaker |
| Captain's Whistle | earned | 740 | 362 | 93 | 0 | the other card | 100% passive | 0.8 [−2.2, 3.8] | 0.49 [−0.68, 1.67] | −0.03 [−0.14, 0.07] | 0.01 [−0.20, 0.22] | 1.2 [−2.4, 4.7] | −420 [−2020, 1180] |  |
| Standard of the Sun | earned | 310 | 162 | 0 | 0 | the other card | 100% passive | 3.0 [−0.1, 6.1] | 0.17 [−0.93, 1.28] | −0.02 [−0.05, 0.01] | −0.16 [−0.50, 0.19] | 2.5 [−1.3, 6.3] | −773 [−4296, 2751] |  |
| Hollow Hourglass | earned | 222 | 222 | - | 0 | source peers | 100% detected | 0.4 [−2.2, 2.9] | 1.14 [0.15, 2.14] | 0.00 [−0.06, 0.07] | −0.06 [−0.28, 0.17] | 5.6 [2.2, 9.1] | −666 [−2719, 1387] | ko/battle weaker; stall% weaker |
| Chronicle | earned | 301 | 143 | 0 | 0 | the other card | 100% detected | 0.7 [−3.0, 4.3] | 0.02 [−1.51, 1.54] | 0.03 [−0.03, 0.09] | −0.09 [−0.27, 0.09] | 0.2 [−5.0, 5.3] | −1148 [−4821, 2525] |  |
| Tithe Box | earned | 248 | 145 | 5 | 0 | the other card | 31% detected | −3.7 [−7.8, 0.5] | −1.30 [−3.24, 0.63] | 0.05 [−0.06, 0.16] | −0.09 [−0.37, 0.18] | −1.6 [−6.7, 3.4] | −1189 [−2857, 479] |  |
| Lantern of the Road | earned | 248 | 248 | - | 0 | source peers | 84% detected | 0.8 [−1.6, 3.1] | −0.31 [−1.22, 0.60] | 0.03 [−0.03, 0.09] | 0.00 [−0.20, 0.21] | −1.2 [−4.3, 2.0] | 452 [−1393, 2296] |  |
| Crest of the Road | earned | 0 | 0 | - | 6 | - | 100% detected | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Saint's Reliquary | earned | 248 | 103 | 7 | 0 | the other card | 31% detected | 3.7 [−0.5, 7.8] | 1.30 [−0.63, 3.24] | −0.05 [−0.16, 0.06] | 0.09 [−0.18, 0.37] | 1.6 [−3.4, 6.7] | 1189 [−479, 2857] |  |
| Mercenary Ledger | earned | 176 | 176 | - | 0 | - | 5% detected | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Smith's Covenant | earned | 0 | 0 | - | 127 | - | 39% detected | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Thief's Lantern | earned | 0 | 0 | - | 0 | - | - | n/a | n/a | n/a | n/a | n/a | n/a |  |
| Seer's Eye | earned | 238 | 238 | - | 0 | source peers | 81% detected | 1.1 [−1.1, 3.4] | 0.14 [−0.81, 1.09] | −0.00 [−0.06, 0.05] | −0.03 [−0.21, 0.16] | −1.3 [−4.5, 2.0] | −886 [−2400, 629] |  |
| Darkened Dawn | twisted | 262 | 140 | 7 | 0 | the other card | 100% detected | −2.4 [−7.8, 2.9] | 0.11 [−2.01, 2.23] | −0.07 [−0.25, 0.11] | −0.19 [−0.58, 0.19] | −4.0 [−10.2, 2.3] | −1086 [−3536, 1364] |  |
| Blood Covenant | twisted | 460 | 241 | 25 | 0 | the other card | 100% passive | −7.5 [−11.9, −3.2] | −2.27 [−3.80, −0.73] | 0.09 [−0.07, 0.24] | 0.59 [0.29, 0.89] | −8.7 [−13.1, −4.4] | −570 [−2649, 1510] | koBattle% stronger; ko/battle stronger; winsBeforeKO stronger (FW); stall% stronger (FW) |
| Kingmaker's Oath | twisted | 472 | 250 | 25 | 0 | the other card | 27% detected | −1.2 [−5.1, 2.7] | 0.04 [−1.43, 1.52] | 0.06 [−0.07, 0.19] | −0.05 [−0.24, 0.15] | −4.2 [−8.9, 0.4] | 759 [−1348, 2865] |  |
| Hollow Sun's Favor | twisted | 462 | 227 | 30 | 0 | the other card | 56% detected | 1.6 [−2.1, 5.3] | −0.79 [−2.29, 0.70] | 0.17 [0.08, 0.27] | −0.27 [−0.47, −0.07] | −0.7 [−5.2, 3.8] | 1231 [−1053, 3515] | deaths/battle weaker; winsBeforeKO weaker |

### Flags

| card | taken | outcome | reading | level | delta | z |
| --- | --- | --- | --- | --- | --- | --- |
| Blessed Vigor | 63 | koBattle% | stronger | nominal | -5.05 [-8.54, -1.57] | -2.84 |
| Blessed Vigor | 63 | ko/battle | stronger | nominal | -1.48 [-2.70, -0.27] | -2.40 |
| Blessed Vigor | 63 | winsBeforeKO | stronger | nominal | 0.89 [0.13, 1.65] | 2.29 |
| Field Medic | 52 | ko/battle | weaker | nominal | 1.58 [0.21, 2.96] | 2.25 |
| Field Medic | 52 | stall% | weaker | nominal | 5.09 [0.75, 9.43] | 2.30 |
| Scout Blessing | 10 | koBattle% | stronger | nominal | -6.13 [-11.68, -0.57] | -2.16 |
| Scholar's Vow | 17 | ko/battle | stronger | nominal | -1.93 [-3.77, -0.09] | -2.05 |
| Scholar's Vow | 17 | stall% | stronger | nominal | -9.97 [-18.38, -1.57] | -2.33 |
| Forbidden Tome | 10 | koBattle% | stronger | nominal | -10.42 [-17.76, -3.08] | -2.78 |
| Forbidden Tome | 10 | ko/battle | stronger | nominal | -2.22 [-3.44, -0.99] | -3.55 |
| Forbidden Tome | 10 | deaths/battle | stronger | nominal | -0.38 [-0.45, -0.31] | -10.35 |
| Forbidden Tome | 10 | stall% | stronger | nominal | -11.81 [-18.70, -4.92] | -3.36 |
| Forbidden Tome | 10 | gold | stronger | nominal | 38494.82 [32156.67, 44832.97] | 11.90 |
| Focused Curriculum | 15 | ko/battle | stronger | nominal | -1.98 [-3.83, -0.12] | -2.09 |
| Focused Curriculum | 15 | winsBeforeKO | weaker | nominal | -0.96 [-1.87, -0.05] | -2.07 |
| Slow Fuse | 18 | winsBeforeKO | weaker | nominal | -0.93 [-1.54, -0.32] | -2.99 |
| Slow Fuse | 18 | gold | weaker | nominal | -1807.19 [-2736.95, -877.42] | -3.81 |
| Gambler's Toss | 13 | deaths/battle | weaker | nominal | 0.09 [0.02, 0.15] | 2.69 |
| Omen Reader | 14 | koBattle% | weaker | nominal | 6.58 [0.90, 12.26] | 2.27 |
| Omen Reader | 14 | deaths/battle | weaker | nominal | 0.10 [0.05, 0.15] | 3.87 |
| Lottery Loot | 15 | koBattle% | weaker | nominal | 7.27 [1.81, 12.72] | 2.61 |
| Armory Stash | 12 | ko/battle | stronger | nominal | -2.68 [-4.79, -0.56] | -2.48 |
| Unbroken Banner | 391 | stall% | weaker | nominal | 4.15 [0.70, 7.61] | 2.36 |
| Second Dawn | 177 | koBattle% | stronger | nominal | -2.74 [-5.48, -0.01] | -1.97 |
| Second Dawn | 177 | ko/battle | stronger | nominal | -1.11 [-2.09, -0.13] | -2.23 |
| Second Dawn | 177 | stall% | stronger | nominal | -3.56 [-6.60, -0.52] | -2.29 |
| Ember Lantern | 357 | stall% | weaker | nominal | 3.79 [0.30, 7.28] | 2.13 |
| Hollow Hourglass | 222 | ko/battle | weaker | nominal | 1.14 [0.15, 2.14] | 2.25 |
| Hollow Hourglass | 222 | stall% | weaker | nominal | 5.64 [2.22, 9.06] | 3.23 |
| Blood Covenant | 241 | koBattle% | stronger | nominal | -7.53 [-11.86, -3.20] | -3.41 |
| Blood Covenant | 241 | ko/battle | stronger | nominal | -2.27 [-3.80, -0.73] | -2.89 |
| Blood Covenant | 241 | winsBeforeKO | stronger | family-wise | 0.59 [0.29, 0.89] | 3.88 |
| Blood Covenant | 241 | stall% | stronger | family-wise | -8.73 [-13.08, -4.38] | -3.93 |
| Hollow Sun's Favor | 227 | deaths/battle | weaker | nominal | 0.17 [0.08, 0.27] | 3.63 |
| Hollow Sun's Favor | 227 | winsBeforeKO | weaker | nominal | -0.27 [-0.47, -0.07] | -2.64 |

## Outliers

Ordered by strength of evidence. With about 65 cards and 6 outcomes, roughly 20 nominal flags are
expected by chance alone, so any single nominal line below may be one of them.

**Family-wise (|z| ≥ 3.83 over 390 comparisons, at least 30 takers): one card, Blood Covenant,
on two outcomes, both just past the cutoff.**

1. **Blood Covenant: family-wise on winsBeforeKO and stall%, barely.** It was taken at its first
   offer in 241 runs, against 219 runs that took the other card there (25 of them took Blood
   Covenant later and count with the decliners).
   - winsBeforeKO +0.59 [0.29, 0.89] (z 3.88): **family-wise**
   - stall −8.7 points [−13.1, −4.4] (z −3.93): **family-wise**
   - koBattle −7.5 points [−11.9, −3.2] (z −3.41): nominal
   - ko/battle −2.3 [−3.8, −0.7] (z −2.89): nominal

   **Does the family-wise finding stand?** In this batch, yes: through winsBeforeKO and stall%,
   not koBattle%. But it stands by a hair (|z| 3.88 and 3.93 against a 3.83 cutoff), and it is not
   stable:
   - The previous 1000-run batch used the same seeds on main `003de6cc`, the game before #283
     (Fiendish Blow +5 ATK). There no outcome reached the cutoff: koBattle z −3.64, winsBeforeKO
     3.55, stall −3.16.
   - So one balance change elsewhere in the game moved these z values by 0.2 to 0.8.

   Read it as a consistent, strong-leaning signal sitting on the family-wise line, not as an
   established effect.

   - **By rung.** koBattle is −12.0 on First Light and −14.9 on Dusk, then −2.5 on Nightfall and
     +1.9 on Black Sun. The stall reduction holds on the first three rungs (−11.9, −9.8, −11.6)
     and is flat on Black Sun (−0.4).
   - **Its twist** is an Ill Omen that never ends. It shows no measured cost (gold −570
     [−2649, 1510]).
   - It stays the card most worth a closer look, as a candidate too strong for a twisted card.

**The largest nominal signals:**

2. **Forbidden Tome: a policy artifact, not evidence.** It had only 10 takers, below the 30 a
   family-wise flag needs, so every flag is nominal, however large its z: deaths/battle −0.38
   (z −10.4), gold +38,495 (z 11.9), stall −11.8 points.
   - Its pact forbids church revives. The claiming church revives about 11 fallen units a run at
     full price, and revived units come back weak (catch-up growths minus 10) and fall again.
   - With the Tome, the gold stays in the purse and the weak revived units never return.
   - The sim cannot price what the pact really costs, the fallen units themselves. Treat the Tome
     as unmeasured.
3. **Hollow Sun's Favor: its Hunted twist bites.**
   - Deaths +0.17 [0.08, 0.27] (z 3.63) and winsBeforeKO −0.27 [−0.47, −0.07].
   - The gold it pays does not show: +1231 [−1053, 3515].
4. **Hollow Hourglass costs this player** (222 runs, against another first eclipsed-elite card):
   - stall +5.6 points [2.2, 9.1] (z 3.23) and ko/battle +1.14 [0.15, 2.14].
   - Delayed reinforcements make battles last longer.
5. **Second Dawn helps a little** (177 runs, against another first eclipsed-elite card):
   - koBattle −2.7 [−5.5, −0.0], ko/battle −1.1 [−2.1, −0.1], stall −3.6 [−6.6, −0.5].
6. **The act-boss cards barely separate from one another.** Judged at the first offer:
   - Unbroken Banner (391 takers, 93 later takers counted as decliners): koBattle +0.5
     [−2.5, 3.5], deaths −0.03 [−0.14, 0.08], stall +4.2 [0.7, 7.6] (nominal).
   - Ember Lantern (357): stall +3.8 [0.3, 7.3] (nominal), nothing else.
   - Captain's Whistle (362) and Standard of the Sun (162): no flag.
   - About half of their pair partners are twisted cards (Kingmaker's Oath, Blood Covenant,
     Hollow Sun's Favor, Darkened Dawn), and the twisted cards mostly show fewer stalls than what
     they were offered with (Blood Covenant −8.7, Kingmaker's Oath −4.2, Darkened Dawn −4.0). So
     "more stalls" here possibly mirrors that rather than anything the Banner or the Lantern does.
   - The Banner fired in 99% of the runs that held it.
7. **Start cards:**
   - Blessed Vigor (63 takers): koBattle −5.1 [−8.5, −1.6], ko/battle −1.5, winsBeforeKO +0.9,
     almost all of it on First Light (koBattle −17.5 there).
   - Field Medic (52): ko/battle +1.6, stall +5.1. "Took something else" is mostly another tier I
     card, so these rank tier I cards against each other.
   - Advance Pay (60): no flag (ko/battle −1.3 [−2.6, 0.0]).
   - Scholar's Vow (17): ko/battle −1.9, stall −10.0.
   - Omen Reader (14): koBattle +6.6, deaths +0.10 (z 3.87, past the cutoff but with 14 takers,
     not the 30 a family-wise flag needs). This measures its price only: the route never reads
     its marks.
   - Lottery Loot (15): koBattle +7.3. Slow Fuse (18): winsBeforeKO −0.9, gold −1807. Gambler's
     Toss (13): deaths +0.09. Scout Blessing (10): koBattle −6.1. Focused Curriculum (15):
     ko/battle −2.0 but winsBeforeKO −1.0. Armory Stash gift (12): ko/battle −2.7.
   - All of these are nominal, on small samples.

**Mechanics the policies reach rarely (coverage, not balance):**

- **Cutpurse's Luck:** carriers doubled as designed (22 a run against 12), but its 29 holder runs
  made only 4 steals. A Thief is rare in the army: it comes from Act II's recruit pool, and the
  deploy policy seldom fields it. Its speed waiver never decided a steal: of 186 steals in all runs,
  0 needed it, because Thieves are fast. Its value depends on owning and fielding a Thief.
- **Thief's Lantern** was never granted: the Collectors' fight was never reached. It is untested.
- **Twin Chapel:** a second vow in 6 of 15 holder runs. It needs Promotion or Cleanse beside the
  Blessing; with nothing to promote or cleanse, a church takes one vow.
- **Services after the take:** each of these cards needs a service node after it is taken, and the
  share of holder runs where it fired was low:
  - Mercenary Ledger: taken 176 times, but a later bout used the halved fee in only 5% of those
    runs (few colosseums follow the first gold win).
  - Tithe Box 31%, Saint's Reliquary 31%, Kingmaker's Oath 27%.
  - Smith's Mark 38%, Smith's Covenant 39%.
- **Open Roll:** 40 second candidates offered, 17 swapped. **Watcher's Grace:** 36 rewinds spent a
  boss map's charge, in 9 of its holder runs.

## Limits

- **Agent strength.** On Nightfall and Black Sun, 93-98% of battles have a commander KO and 41-61%
  hit the turn cap, so differences there are mostly noise. First Light (41% KO battles) and Dusk
  (72%) carry the signal. One run in 1000 (on First Light) is clean of commander KOs, so a
  would-be win rate cannot be measured with this player.
- **Take rates are the policy's**, a keyed-random pick, not a preference. They exist to make the
  with/without comparison fair. They say nothing about how attractive a card is.
- **Earned-card differences are relative** to the card offered alongside, never to "no card". A
  card always offered next to a strong one looks weak.
- **Later takers dilute.** 11-26% of an act-boss card's first-offer decliners took it at a later
  offer (Banner 93 of 380, Ember Lantern 98 of 372, Whistle 93 of 378, Kingmaker's Oath 25 of 222,
  Blood Covenant 25 of 219).
  They count as decliners (intention to treat at the first offer). This can only pull a difference
  toward zero, never invent one.
- **One game change moves the borderline cases.** The batch before #283 had the same seeds and the
  same policies; Blood Covenant's z values moved by up to 0.8 between the two. A card within about
  half a z of the cutoff can land on either side of it.
- **Gold is dominated by revive spending** (about 11 revives a run): a card that changes deaths
  changes gold.
- **Sample sizes.**
  - Start cards: 5-22 takers each; tier I cards 52-72.
  - Gifts: 8-22 takers each.
  - Act-boss and sanctum cards: 103-391 first-offer takers.

  Intervals are wide; most cards show no difference that this sample can detect.
- **Not modelled:** weapon arts in battle, items used in battle, route choice by scout, preview or
  omen, merc hiring, Branching Threads (meta), and the Master Seal purchases a human would make.

## Appendix: per rung

Each card's takers and differences within one rung (same comparisons, one stratum).

### First Light (300 runs)

| card | kind | offered | taken | ΔkoBattle% | Δdeaths/battle | ΔwinsBeforeKO | Δstall% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 82 | 19 | −0.8 [−7.8, 6.2] | 0.05 [−0.02, 0.11] | 0.61 [−1.55, 2.78] | 2.0 [−2.5, 6.5] |
| Advance Pay | T1 | 69 | 16 | −4.5 [−13.1, 4.1] | 0.03 [−0.04, 0.11] | 1.23 [−1.34, 3.81] | −4.1 [−8.4, 0.1] |
| Blessed Vigor | T1 | 83 | 14 | −17.5 [−26.8, −8.2] | 0.05 [−0.05, 0.15] | 3.43 [0.60, 6.25] | −3.7 [−7.8, 0.3] |
| Swift Instinct | T2 | 16 | 4 | −4.1 [−26.5, 18.2] | 0.00 [−0.11, 0.11] | −0.33 [−3.91, 3.24] | 5.8 [−14.2, 25.7] |
| Field Medic | T1 | 66 | 15 | 11.3 [2.5, 20.1] | −0.08 [−0.16, 0.00] | 0.13 [−2.45, 2.71] | 6.8 [1.7, 12.0] |
| Iron Oath | T3 | 15 | 4 | −10.7 [−33.1, 11.8] | −0.02 [−0.20, 0.17] | 1.48 [−4.27, 7.22] | −0.4 [−10.7, 9.9] |
| Scout Blessing | T2 | 7 | 1 | n/a | n/a | n/a | n/a |
| Scholar's Vow | T4 | 20 | 7 | 4.1 [−11.2, 19.3] | −0.05 [−0.16, 0.06] | 0.10 [−2.99, 3.19] | −3.0 [−11.4, 5.4] |
| Rally Cry | T2 | 16 | 1 | n/a | n/a | n/a | n/a |
| War Veteran | T3 | 13 | 2 | 9.6 [−2.7, 21.9] | 0.06 [−0.04, 0.16] | −5.91 [−8.41, −3.41] | −5.6 [−12.7, 1.6] |
| Smith's Mark | T2 | 12 | 1 | n/a | n/a | n/a | n/a |
| Arsenal Pact | T4 | 24 | 6 | 4.6 [−11.8, 21.0] | −0.04 [−0.19, 0.11] | −0.50 [−4.31, 3.31] | 0.5 [−12.1, 13.2] |
| Pilgrim's Road | T2 | 20 | 5 | −1.6 [−11.8, 8.6] | −0.06 [−0.14, 0.03] | 0.60 [−2.05, 3.25] | −4.3 [−10.4, 1.8] |
| Merchant Bane | T3 | 17 | 3 | 7.7 [−17.8, 33.2] | −0.04 [−0.14, 0.06] | −5.12 [−8.34, −1.90] | −2.1 [−15.0, 10.8] |
| Nomad's Pact | T3 | 10 | 1 | n/a | n/a | n/a | n/a |
| Hold the Line | T2 | 15 | 5 | −13.0 [−28.4, 2.3] | −0.02 [−0.12, 0.07] | 1.50 [−2.81, 5.81] | 1.5 [−10.5, 13.5] |
| Quartermaster Cache | T2 | 20 | 2 | 3.8 [−22.5, 30.1] | −0.12 [−0.17, −0.07] | −4.28 [−6.66, −1.89] | 9.9 [−14.5, 34.2] |
| Forbidden Tome | T4 | 20 | 4 | −15.4 [−26.6, −4.1] | −0.32 [−0.47, −0.17] | 1.75 [−5.31, 8.81] | −8.1 [−16.7, 0.5] |
| Blood Forge | T2 | 26 | 4 | 5.8 [−15.9, 27.5] | 0.03 [−0.08, 0.15] | 1.00 [−4.44, 6.44] | −3.5 [−11.4, 4.3] |
| War Tutelage | T4 | 21 | 6 | −1.2 [−19.5, 17.1] | −0.02 [−0.12, 0.08] | −0.77 [−2.96, 1.43] | −1.7 [−7.9, 4.5] |
| Armory Stash | T4 | 0 | 0 | n/a | n/a | n/a | n/a |
| Scroll Archive | T4 | 17 | 4 | −10.7 [−25.0, 3.6] | 0.05 [−0.02, 0.12] | 3.13 [−1.52, 7.79] | −6.9 [−16.2, 2.4] |
| Focused Curriculum | T3 | 22 | 6 | −0.1 [−10.6, 10.5] | −0.05 [−0.20, 0.10] | −2.48 [−4.72, −0.24] | 0.3 [−10.5, 11.0] |
| Slow Fuse | T2 | 14 | 3 | 1.1 [−16.3, 18.6] | 0.05 [−0.13, 0.23] | −3.24 [−5.88, −0.60] | −9.3 [−18.9, 0.3] |
| Gambler's Toss | T3 | 16 | 4 | 4.6 [−7.2, 16.3] | 0.11 [0.02, 0.20] | −0.08 [−5.08, 4.92] | 1.0 [−7.5, 9.5] |
| Bloodless Art | T2 | 16 | 3 | −3.5 [−20.8, 13.8] | −0.00 [−0.12, 0.11] | −1.36 [−4.86, 2.14] | −2.2 [−8.3, 4.0] |
| Phalanx Rite | T3 | 15 | 5 | −0.8 [−11.4, 9.7] | −0.03 [−0.13, 0.07] | −2.70 [−5.53, 0.13] | −0.9 [−7.9, 6.1] |
| Duelist's Creed | T3 | 17 | 7 | −17.7 [−32.4, −3.1] | 0.07 [−0.07, 0.20] | 3.49 [−1.60, 8.57] | −4.1 [−12.7, 4.6] |
| Late Bloom | T3 | 17 | 3 | −9.1 [−38.2, 20.0] | −0.06 [−0.18, 0.05] | 2.07 [−5.96, 10.10] | 7.1 [−5.1, 19.3] |
| Dawn Tithe | T2 | 16 | 5 | 10.7 [−4.9, 26.2] | −0.09 [−0.24, 0.06] | −1.96 [−5.43, 1.50] | 1.4 [−6.2, 9.0] |
| Lone Banner | T3 | 23 | 7 | −8.7 [−22.5, 5.2] | −0.02 [−0.17, 0.13] | 2.50 [−1.33, 6.33] | 0.8 [−8.3, 9.9] |
| Cavalier's Hour | T3 | 11 | 3 | −7.5 [−41.5, 26.6] | 0.04 [−0.11, 0.19] | 5.00 [−0.63, 10.63] | 6.6 [−12.3, 25.6] |
| Saint's Reserve | T2 | 21 | 3 | 1.8 [−7.9, 11.5] | 0.14 [−0.08, 0.35] | −1.17 [−5.66, 3.33] | 0.7 [−12.1, 13.5] |
| Cutpurse's Luck | T3 | 17 | 3 | −3.9 [−23.4, 15.5] | 0.02 [−0.09, 0.13] | −1.07 [−6.62, 4.48] | 0.7 [−10.1, 11.4] |
| Open Roll | T3 | 21 | 6 | −10.1 [−20.6, 0.4] | −0.02 [−0.14, 0.11] | 0.03 [−2.72, 2.78] | −3.8 [−13.1, 5.5] |
| Watcher's Grace | T2 | 24 | 3 | 5.1 [−21.9, 32.2] | 0.07 [−0.01, 0.14] | −3.00 [−6.34, 0.34] | −1.9 [−13.3, 9.4] |
| Patient Dawn | T3 | 12 | 6 | −13.0 [−34.3, 8.2] | 0.16 [0.05, 0.27] | 1.83 [−1.90, 5.57] | 2.0 [−8.2, 12.3] |
| Twin Chapel | T2 | 18 | 4 | 13.9 [−8.4, 36.2] | −0.07 [−0.21, 0.08] | −4.68 [−8.65, −0.71] | −0.3 [−7.2, 6.5] |
| Omen Reader | T2 | 17 | 1 | n/a | n/a | n/a | n/a |
| Lottery Loot | T3 | 14 | 4 | 9.2 [−7.4, 25.7] | −0.10 [−0.21, 0.02] | 0.75 [−3.14, 4.64] | −0.9 [−8.7, 7.0] |
| Sealed Reliquary | gift | 26 | 7 | −3.7 [−15.3, 7.8] | −0.02 [−0.16, 0.12] | 0.08 [−2.84, 3.01] | −4.9 [−12.7, 2.9] |
| Fallen Hoard | gift | 28 | 5 | 9.4 [−1.8, 20.6] | −0.12 [−0.18, −0.06] | −0.32 [−2.09, 1.45] | 2.3 [−6.9, 11.5] |
| Stranger's Scroll | gift | 25 | 6 | −0.7 [−13.5, 12.1] | 0.02 [−0.10, 0.14] | 1.25 [−2.72, 5.22] | 2.9 [−6.6, 12.3] |
| Marked Blade | gift | 33 | 2 | −3.8 [−37.7, 30.0] | −0.06 [−0.12, 0.00] | −3.65 [−6.06, −1.23] | −3.7 [−7.9, 0.5] |
| Pilgrim's Wager | gift | 24 | 4 | −0.2 [−11.3, 11.0] | −0.11 [−0.23, 0.00] | 1.85 [−1.11, 4.81] | 5.9 [−2.9, 14.7] |
| Armory Stash | gift | 30 | 3 | −4.9 [−24.6, 14.7] | 0.03 [−0.32, 0.37] | −1.81 [−9.26, 5.63] | −4.6 [−10.8, 1.6] |
| Unbroken Banner | earned | 219 | 115 | 2.2 [−5.3, 9.8] | −0.09 [−0.39, 0.22] | −0.14 [−0.84, 0.56] | 5.2 [−1.1, 11.5] |
| Second Dawn | earned | 37 | 37 | −3.7 [−12.1, 4.7] | −0.18 [−0.39, 0.04] | 0.38 [−0.42, 1.18] | −7.5 [−13.3, −1.7] |
| Ember Lantern | earned | 208 | 108 | −0.8 [−8.4, 6.7] | −0.16 [−0.53, 0.20] | 0.25 [−0.36, 0.86] | 2.1 [−4.2, 8.4] |
| Captain's Whistle | earned | 209 | 103 | −3.1 [−10.5, 4.3] | −0.09 [−0.41, 0.22] | 0.23 [−0.40, 0.87] | 0.0 [−7.0, 7.1] |
| Standard of the Sun | earned | 103 | 47 | 9.3 [2.4, 16.2] | −0.05 [−0.12, 0.02] | −0.41 [−1.23, 0.42] | 6.4 [1.5, 11.3] |
| Hollow Hourglass | earned | 59 | 59 | 2.7 [−4.8, 10.1] | 0.01 [−0.22, 0.23] | −0.23 [−0.88, 0.42] | 6.4 [−0.6, 13.4] |
| Chronicle | earned | 91 | 39 | 4.2 [−5.1, 13.6] | 0.12 [−0.06, 0.29] | −0.36 [−0.89, 0.17] | −5.0 [−12.0, 2.0] |
| Tithe Box | earned | 91 | 58 | −6.4 [−16.7, 3.8] | 0.19 [−0.09, 0.46] | −0.10 [−0.83, 0.63] | −2.9 [−10.4, 4.7] |
| Lantern of the Road | earned | 57 | 57 | 0.0 [−7.6, 7.6] | 0.04 [−0.19, 0.26] | 0.08 [−0.62, 0.77] | −1.1 [−7.5, 5.3] |
| Crest of the Road | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reliquary | earned | 91 | 33 | 6.4 [−3.8, 16.7] | −0.19 [−0.46, 0.09] | 0.10 [−0.63, 0.83] | 2.9 [−4.7, 10.4] |
| Mercenary Ledger | earned | 55 | 55 | n/a | n/a | n/a | n/a |
| Smith's Covenant | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Thief's Lantern | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Seer's Eye | earned | 38 | 38 | 0.1 [−8.2, 8.3] | 0.12 [−0.17, 0.40] | −0.16 [−0.88, 0.55] | 0.3 [−7.6, 8.2] |
| Darkened Dawn | twisted | 88 | 51 | 3.8 [−8.4, 16.0] | −0.31 [−0.84, 0.23] | −0.73 [−1.77, 0.31] | −0.3 [−13.2, 12.6] |
| Blood Covenant | twisted | 139 | 72 | −12.0 [−21.6, −2.3] | 0.40 [−0.02, 0.82] | 1.13 [0.24, 2.03] | −11.9 [−18.9, −4.8] |
| Kingmaker's Oath | twisted | 118 | 57 | −4.3 [−14.7, 6.1] | 0.07 [−0.39, 0.54] | −0.20 [−0.90, 0.50] | 0.2 [−9.9, 10.3] |
| Hollow Sun's Favor | twisted | 116 | 52 | 4.8 [−4.8, 14.5] | 0.24 [−0.07, 0.55] | −0.57 [−1.25, 0.12] | −7.8 [−16.8, 1.2] |

### Dusk (300 runs)

| card | kind | offered | taken | ΔkoBattle% | Δdeaths/battle | ΔwinsBeforeKO | Δstall% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 77 | 24 | −7.9 [−15.5, −0.3] | 0.02 [−0.02, 0.06] | 0.46 [−0.28, 1.20] | −1.7 [−8.3, 4.8] |
| Advance Pay | T1 | 62 | 17 | 1.3 [−7.8, 10.4] | −0.01 [−0.07, 0.04] | −1.14 [−1.93, −0.36] | −5.2 [−13.6, 3.2] |
| Blessed Vigor | T1 | 85 | 21 | −1.7 [−8.6, 5.2] | 0.04 [−0.02, 0.10] | −0.00 [−0.84, 0.84] | 0.9 [−5.0, 6.8] |
| Swift Instinct | T2 | 16 | 4 | −3.7 [−21.5, 14.0] | −0.12 [−0.27, 0.03] | 0.00 [−1.83, 1.83] | −1.1 [−11.6, 9.4] |
| Field Medic | T1 | 76 | 15 | −4.5 [−12.0, 3.0] | 0.04 [−0.01, 0.09] | −0.12 [−1.02, 0.78] | −2.2 [−10.4, 6.0] |
| Iron Oath | T3 | 17 | 4 | 2.0 [−12.1, 16.0] | 0.01 [−0.10, 0.11] | 0.90 [−2.83, 4.64] | −5.7 [−16.2, 4.8] |
| Scout Blessing | T2 | 22 | 4 | −13.2 [−23.4, −3.1] | −0.03 [−0.07, 0.02] | 0.72 [−1.79, 3.23] | −6.7 [−19.8, 6.4] |
| Scholar's Vow | T4 | 16 | 4 | −15.1 [−32.2, 2.0] | −0.00 [−0.04, 0.04] | −0.75 [−2.73, 1.23] | −9.9 [−22.7, 2.8] |
| Rally Cry | T2 | 13 | 2 | −5.5 [−20.1, 9.0] | 0.00 [−0.07, 0.08] | 2.86 [1.07, 4.66] | −0.5 [−4.7, 3.7] |
| War Veteran | T3 | 12 | 2 | −26.2 [−77.7, 25.2] | 0.01 [−0.05, 0.07] | −0.70 [−1.12, −0.28] | −9.2 [−17.8, −0.6] |
| Smith's Mark | T2 | 22 | 4 | 9.0 [1.1, 16.9] | 0.04 [−0.04, 0.11] | 0.17 [−0.52, 0.85] | −5.8 [−18.9, 7.3] |
| Arsenal Pact | T4 | 25 | 8 | −8.1 [−18.8, 2.6] | −0.06 [−0.12, 0.01] | 2.79 [0.34, 5.24] | −0.3 [−11.2, 10.6] |
| Pilgrim's Road | T2 | 16 | 4 | 4.9 [−10.6, 20.4] | −0.03 [−0.11, 0.05] | −1.67 [−2.81, −0.52] | −0.5 [−16.3, 15.3] |
| Merchant Bane | T3 | 12 | 3 | 9.4 [−1.2, 19.9] | 0.04 [−0.07, 0.14] | 0.89 [−1.19, 2.97] | −2.3 [−15.3, 10.7] |
| Nomad's Pact | T3 | 16 | 4 | 0.7 [−8.0, 9.4] | 0.05 [−0.06, 0.16] | 1.08 [−2.03, 4.20] | 10.5 [−2.0, 23.0] |
| Hold the Line | T2 | 13 | 1 | n/a | n/a | n/a | n/a |
| Quartermaster Cache | T2 | 13 | 4 | −0.4 [−21.5, 20.7] | 0.05 [−0.07, 0.17] | 1.08 [−1.56, 3.72] | −14.2 [−31.6, 3.1] |
| Forbidden Tome | T4 | 15 | 3 | −8.7 [−23.6, 6.1] | −0.42 [−0.47, −0.37] | −1.67 [−3.56, 0.23] | −10.2 [−24.7, 4.2] |
| Blood Forge | T2 | 18 | 6 | 7.7 [−6.5, 21.9] | −0.03 [−0.10, 0.04] | −1.00 [−2.72, 0.72] | 1.9 [−11.4, 15.2] |
| War Tutelage | T4 | 24 | 4 | −0.2 [−18.1, 17.8] | −0.09 [−0.18, −0.00] | −1.00 [−1.51, −0.49] | 2.3 [−9.4, 14.0] |
| Armory Stash | T4 | 0 | 0 | n/a | n/a | n/a | n/a |
| Scroll Archive | T4 | 14 | 2 | 7.5 [−5.5, 20.6] | −0.02 [−0.12, 0.09] | −0.58 [−2.76, 1.59] | 4.0 [−23.0, 30.9] |
| Focused Curriculum | T3 | 18 | 3 | −5.9 [−24.0, 12.3] | 0.10 [0.01, 0.18] | 0.20 [−1.19, 1.59] | 3.1 [−15.2, 21.4] |
| Slow Fuse | T2 | 24 | 9 | 10.1 [−3.4, 23.7] | 0.01 [−0.10, 0.11] | −0.64 [−1.44, 0.15] | −0.1 [−10.5, 10.3] |
| Gambler's Toss | T3 | 20 | 4 | −0.1 [−19.7, 19.4] | 0.04 [−0.10, 0.18] | −1.06 [−2.22, 0.09] | −4.8 [−22.7, 13.1] |
| Bloodless Art | T2 | 20 | 6 | 9.3 [−5.3, 23.9] | −0.07 [−0.14, 0.00] | 0.36 [−2.47, 3.19] | 11.3 [−0.7, 23.4] |
| Phalanx Rite | T3 | 16 | 3 | 0.2 [−21.1, 21.4] | −0.03 [−0.12, 0.06] | 0.85 [−0.44, 2.14] | 5.1 [−20.2, 30.5] |
| Duelist's Creed | T3 | 21 | 4 | 8.0 [−3.6, 19.5] | −0.12 [−0.17, −0.07] | −0.81 [−2.00, 0.38] | 11.5 [−5.2, 28.2] |
| Late Bloom | T3 | 14 | 3 | 6.0 [−19.4, 31.4] | −0.07 [−0.21, 0.07] | 2.79 [−3.86, 9.43] | 2.3 [−18.9, 23.5] |
| Dawn Tithe | T2 | 15 | 6 | 2.8 [−7.9, 13.6] | 0.03 [−0.07, 0.14] | −0.22 [−1.12, 0.68] | 5.8 [−4.9, 16.6] |
| Lone Banner | T3 | 9 | 3 | 13.7 [−6.8, 34.3] | −0.05 [−0.20, 0.10] | −0.33 [−1.99, 1.32] | 10.7 [−9.6, 31.0] |
| Cavalier's Hour | T3 | 18 | 2 | −1.5 [−19.2, 16.3] | −0.05 [−0.10, −0.00] | 4.69 [−0.24, 9.61] | −1.8 [−19.8, 16.3] |
| Saint's Reserve | T2 | 16 | 2 | −16.2 [−76.1, 43.6] | 0.00 [−0.06, 0.07] | 2.86 [−7.00, 12.71] | 2.1 [−7.0, 11.1] |
| Cutpurse's Luck | T3 | 17 | 3 | 9.7 [−10.4, 29.8] | 0.09 [−0.05, 0.23] | −0.50 [−1.58, 0.58] | 8.4 [0.9, 16.0] |
| Open Roll | T3 | 13 | 2 | 6.6 [−2.5, 15.7] | −0.06 [−0.14, 0.03] | −0.68 [−1.72, 0.36] | 15.1 [9.5, 20.8] |
| Watcher's Grace | T2 | 14 | 2 | 11.5 [0.2, 22.9] | −0.03 [−0.09, 0.03] | −0.17 [−1.34, 1.01] | −5.3 [−38.0, 27.3] |
| Patient Dawn | T3 | 20 | 8 | −5.0 [−20.8, 10.8] | 0.08 [−0.01, 0.17] | 0.50 [−0.81, 1.81] | −6.4 [−19.4, 6.5] |
| Twin Chapel | T2 | 15 | 4 | −9.5 [−25.6, 6.6] | 0.04 [−0.05, 0.13] | 0.57 [−1.22, 2.36] | −11.0 [−24.6, 2.5] |
| Omen Reader | T2 | 23 | 5 | 12.7 [0.1, 25.2] | 0.11 [0.03, 0.19] | 0.02 [−1.09, 1.13] | 4.3 [−12.2, 20.8] |
| Lottery Loot | T3 | 23 | 4 | 10.0 [−1.2, 21.3] | −0.05 [−0.13, 0.03] | −0.39 [−1.96, 1.17] | 10.9 [−6.9, 28.7] |
| Sealed Reliquary | gift | 14 | 1 | n/a | n/a | n/a | n/a |
| Fallen Hoard | gift | 17 | 4 | −13.0 [−26.5, 0.4] | 0.09 [−0.01, 0.19] | 1.21 [−1.32, 3.75] | −7.0 [−21.6, 7.6] |
| Stranger's Scroll | gift | 31 | 7 | −0.6 [−13.6, 12.5] | −0.04 [−0.10, 0.02] | −0.66 [−1.58, 0.26] | 4.2 [−11.1, 19.5] |
| Marked Blade | gift | 16 | 1 | n/a | n/a | n/a | n/a |
| Pilgrim's Wager | gift | 18 | 2 | −0.3 [−12.4, 11.9] | 0.10 [−0.02, 0.22] | 2.31 [−2.74, 7.36] | −15.2 [−22.1, −8.4] |
| Armory Stash | gift | 29 | 2 | 14.3 [1.4, 27.2] | 0.07 [−0.01, 0.16] | −1.13 [−2.30, 0.04] | −12.7 [−18.9, −6.6] |
| Unbroken Banner | earned | 208 | 108 | 1.0 [−4.5, 6.5] | −0.05 [−0.09, −0.00] | −0.02 [−0.40, 0.35] | 3.2 [−2.7, 9.1] |
| Second Dawn | earned | 68 | 68 | −4.9 [−9.9, 0.1] | −0.02 [−0.07, 0.03] | 0.13 [−0.31, 0.58] | −4.0 [−8.9, 0.8] |
| Ember Lantern | earned | 202 | 95 | 5.0 [−0.7, 10.6] | −0.04 [−0.08, 0.01] | −0.27 [−0.62, 0.07] | 8.2 [2.1, 14.3] |
| Captain's Whistle | earned | 208 | 101 | 0.9 [−3.8, 5.5] | −0.02 [−0.06, 0.02] | −0.16 [−0.47, 0.14] | 1.1 [−4.5, 6.8] |
| Standard of the Sun | earned | 95 | 50 | 0.8 [−5.3, 6.9] | 0.05 [−0.01, 0.10] | −0.02 [−0.66, 0.61] | −1.1 [−8.2, 6.0] |
| Hollow Hourglass | earned | 71 | 71 | −0.5 [−5.4, 4.4] | −0.05 [−0.09, −0.01] | −0.02 [−0.48, 0.44] | 5.1 [−0.4, 10.7] |
| Chronicle | earned | 102 | 53 | −1.2 [−7.2, 4.9] | 0.02 [−0.04, 0.08] | 0.06 [−0.16, 0.28] | 1.7 [−7.3, 10.8] |
| Tithe Box | earned | 56 | 27 | −2.9 [−10.2, 4.5] | 0.03 [−0.03, 0.10] | −0.19 [−0.58, 0.19] | 6.3 [−3.6, 16.2] |
| Lantern of the Road | earned | 74 | 74 | 2.1 [−2.3, 6.6] | 0.08 [0.01, 0.16] | −0.16 [−0.51, 0.20] | −1.1 [−6.3, 4.2] |
| Crest of the Road | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reliquary | earned | 56 | 29 | 2.9 [−4.5, 10.2] | −0.03 [−0.10, 0.03] | 0.19 [−0.19, 0.58] | −6.3 [−16.2, 3.6] |
| Mercenary Ledger | earned | 61 | 61 | n/a | n/a | n/a | n/a |
| Smith's Covenant | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Thief's Lantern | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Seer's Eye | earned | 83 | 83 | 2.7 [−1.5, 7.0] | −0.02 [−0.06, 0.03] | 0.05 [−0.33, 0.42] | −0.1 [−5.7, 5.5] |
| Darkened Dawn | twisted | 77 | 40 | −6.2 [−14.8, 2.5] | −0.00 [−0.06, 0.05] | 0.10 [−0.46, 0.65] | −7.7 [−17.0, 1.6] |
| Blood Covenant | twisted | 115 | 55 | −14.9 [−22.4, −7.4] | 0.03 [−0.02, 0.09] | 0.80 [0.33, 1.27] | −9.8 [−18.0, −1.6] |
| Kingmaker's Oath | twisted | 131 | 65 | −0.1 [−6.7, 6.6] | −0.05 [−0.11, 0.01] | 0.02 [−0.27, 0.32] | −8.1 [−15.7, −0.5] |
| Hollow Sun's Favor | twisted | 114 | 54 | 6.4 [−0.4, 13.2] | 0.10 [0.04, 0.16] | −0.57 [−0.93, −0.21] | 1.0 [−7.6, 9.6] |

### Nightfall (200 runs)

| card | kind | offered | taken | ΔkoBattle% | Δdeaths/battle | ΔwinsBeforeKO | Δstall% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 57 | 16 | 1.6 [−1.3, 4.5] | −0.00 [−0.05, 0.04] | 0.05 [−0.13, 0.24] | 8.8 [−1.9, 19.6] |
| Advance Pay | T1 | 49 | 14 | 4.2 [0.1, 8.2] | 0.04 [−0.01, 0.09] | −0.20 [−0.46, 0.06] | 0.6 [−10.1, 11.4] |
| Blessed Vigor | T1 | 46 | 13 | −0.6 [−6.1, 4.9] | −0.01 [−0.07, 0.05] | 0.19 [−0.10, 0.47] | −2.6 [−13.9, 8.7] |
| Swift Instinct | T2 | 10 | 2 | −11.8 [−48.5, 24.9] | 0.03 [−0.02, 0.09] | −0.13 [−0.37, 0.12] | −19.4 [−48.7, 10.0] |
| Field Medic | T1 | 48 | 11 | −0.9 [−5.7, 3.9] | −0.01 [−0.06, 0.04] | 0.13 [−0.12, 0.38] | 7.5 [−2.9, 17.9] |
| Iron Oath | T3 | 11 | 3 | −0.6 [−3.5, 2.3] | −0.08 [−0.19, 0.03] | 0.08 [−0.64, 0.81] | 5.3 [−25.2, 35.9] |
| Scout Blessing | T2 | 8 | 1 | n/a | n/a | n/a | n/a |
| Scholar's Vow | T4 | 14 | 5 | −1.0 [−10.7, 8.8] | 0.02 [−0.05, 0.10] | −0.44 [−0.92, 0.03] | −19.9 [−42.5, 2.7] |
| Rally Cry | T2 | 11 | 1 | n/a | n/a | n/a | n/a |
| War Veteran | T3 | 9 | 0 | n/a | n/a | n/a | n/a |
| Smith's Mark | T2 | 10 | 1 | n/a | n/a | n/a | n/a |
| Arsenal Pact | T4 | 16 | 3 | −8.5 [−18.7, 1.7] | −0.09 [−0.19, 0.01] | 0.59 [−0.08, 1.26] | 2.3 [−22.1, 26.7] |
| Pilgrim's Road | T2 | 18 | 2 | 3.2 [−2.9, 9.3] | 0.00 [−0.07, 0.07] | 0.75 [0.53, 0.97] | 2.9 [−15.0, 20.7] |
| Merchant Bane | T3 | 11 | 1 | n/a | n/a | n/a | n/a |
| Nomad's Pact | T3 | 11 | 3 | 1.3 [−7.2, 9.8] | −0.12 [−0.25, 0.01] | 0.33 [−0.32, 0.99] | −6.0 [−30.0, 18.1] |
| Hold the Line | T2 | 8 | 2 | −1.6 [−8.1, 4.9] | 0.02 [−0.04, 0.08] | 0.00 [0.00, 0.00] | 6.4 [−34.1, 46.9] |
| Quartermaster Cache | T2 | 9 | 3 | −16.6 [−34.9, 1.7] | −0.04 [−0.11, 0.02] | 1.00 [−0.13, 2.13] | −6.6 [−32.1, 18.8] |
| Forbidden Tome | T4 | 9 | 2 | −2.8 [−11.8, 6.2] | −0.44 [−0.54, −0.35] | 0.00 [0.00, 0.00] | −21.9 [−35.7, −8.1] |
| Blood Forge | T2 | 11 | 3 | 0.1 [−6.2, 6.5] | −0.01 [−0.10, 0.07] | −0.25 [−0.57, 0.07] | 9.4 [−2.0, 20.7] |
| War Tutelage | T4 | 15 | 2 | −2.9 [−12.6, 6.7] | 0.09 [−0.01, 0.20] | −0.08 [−0.23, 0.07] | 0.5 [−18.9, 19.8] |
| Armory Stash | T4 | 0 | 0 | n/a | n/a | n/a | n/a |
| Scroll Archive | T4 | 11 | 1 | n/a | n/a | n/a | n/a |
| Focused Curriculum | T3 | 14 | 3 | −5.7 [−16.2, 4.7] | −0.01 [−0.06, 0.03] | −0.27 [−0.55, 0.00] | 1.1 [−11.8, 14.0] |
| Slow Fuse | T2 | 13 | 3 | −1.7 [−7.8, 4.3] | 0.04 [−0.03, 0.12] | −0.10 [−0.30, 0.10] | 6.5 [−9.1, 22.2] |
| Gambler's Toss | T3 | 14 | 4 | 0.7 [−6.3, 7.7] | 0.12 [0.03, 0.22] | −0.05 [−0.62, 0.52] | 1.7 [−17.4, 20.9] |
| Bloodless Art | T2 | 13 | 0 | n/a | n/a | n/a | n/a |
| Phalanx Rite | T3 | 5 | 1 | n/a | n/a | n/a | n/a |
| Duelist's Creed | T3 | 14 | 4 | 5.7 [−0.2, 11.5] | −0.03 [−0.13, 0.07] | 0.25 [−0.24, 0.74] | 11.9 [−9.2, 33.0] |
| Late Bloom | T3 | 13 | 2 | 2.7 [−3.7, 9.1] | −0.02 [−0.15, 0.11] | −0.18 [−0.42, 0.06] | 0.9 [−56.8, 58.5] |
| Dawn Tithe | T2 | 12 | 4 | −7.0 [−20.6, 6.6] | −0.01 [−0.10, 0.08] | 0.00 [0.00, 0.00] | 5.3 [−14.0, 24.6] |
| Lone Banner | T3 | 10 | 3 | 2.6 [−0.7, 5.9] | −0.04 [−0.12, 0.04] | 0.00 [0.00, 0.00] | −4.5 [−21.5, 12.5] |
| Cavalier's Hour | T3 | 6 | 1 | n/a | n/a | n/a | n/a |
| Saint's Reserve | T2 | 10 | 0 | n/a | n/a | n/a | n/a |
| Cutpurse's Luck | T3 | 16 | 2 | 2.6 [−1.8, 6.9] | −0.03 [−0.09, 0.04] | −0.21 [−0.44, 0.01] | 8.9 [3.6, 14.1] |
| Open Roll | T3 | 13 | 1 | n/a | n/a | n/a | n/a |
| Watcher's Grace | T2 | 12 | 2 | 5.1 [2.8, 7.5] | 0.06 [−0.02, 0.14] | −0.10 [−0.30, 0.10] | −17.9 [−35.0, −0.9] |
| Patient Dawn | T3 | 12 | 4 | −8.2 [−23.8, 7.5] | −0.04 [−0.08, 0.01] | 0.25 [−0.40, 0.90] | −5.9 [−42.5, 30.7] |
| Twin Chapel | T2 | 7 | 1 | n/a | n/a | n/a | n/a |
| Omen Reader | T2 | 12 | 4 | 3.8 [−3.2, 10.8] | 0.08 [−0.01, 0.16] | 0.00 [0.00, 0.00] | 18.2 [2.5, 33.9] |
| Lottery Loot | T3 | 12 | 4 | 5.9 [0.9, 11.0] | 0.07 [−0.04, 0.19] | 0.00 [0.00, 0.00] | 0.5 [−19.4, 20.4] |
| Sealed Reliquary | gift | 29 | 8 | −0.4 [−5.8, 5.0] | −0.05 [−0.11, 0.01] | 0.11 [−0.25, 0.46] | 0.1 [−11.3, 11.4] |
| Fallen Hoard | gift | 14 | 4 | 2.4 [−5.8, 10.7] | 0.08 [−0.04, 0.20] | −0.30 [−0.60, −0.00] | 21.5 [4.4, 38.6] |
| Stranger's Scroll | gift | 12 | 4 | 0.7 [−5.7, 7.1] | 0.02 [−0.07, 0.12] | −0.13 [−0.37, 0.12] | −11.6 [−24.0, 0.8] |
| Marked Blade | gift | 13 | 2 | 2.7 [−0.8, 6.3] | −0.06 [−0.11, −0.00] | −0.27 [−0.55, 0.00] | −2.6 [−16.2, 10.9] |
| Pilgrim's Wager | gift | 27 | 9 | 3.7 [−0.1, 7.6] | 0.07 [−0.00, 0.13] | −0.06 [−0.34, 0.23] | −2.0 [−15.4, 11.4] |
| Armory Stash | gift | 17 | 5 | 2.3 [−4.3, 8.9] | −0.03 [−0.10, 0.03] | −0.17 [−0.39, 0.05] | 2.3 [−16.2, 20.9] |
| Unbroken Banner | earned | 172 | 82 | 1.6 [−3.3, 6.5] | 0.12 [−0.10, 0.35] | 0.02 [−0.12, 0.15] | 6.3 [−2.4, 14.9] |
| Second Dawn | earned | 38 | 38 | 1.2 [−2.1, 4.5] | −0.03 [−0.08, 0.02] | −0.18 [−0.39, 0.03] | −0.2 [−7.0, 6.6] |
| Ember Lantern | earned | 155 | 71 | 4.3 [0.9, 7.6] | −0.05 [−0.18, 0.07] | −0.02 [−0.15, 0.12] | 6.3 [−2.0, 14.5] |
| Captain's Whistle | earned | 157 | 76 | 0.9 [−4.8, 6.6] | 0.01 [−0.16, 0.17] | −0.00 [−0.26, 0.26] | 1.5 [−7.0, 10.0] |
| Standard of the Sun | earned | 51 | 26 | 1.1 [−3.2, 5.4] | −0.03 [−0.09, 0.02] | −0.09 [−0.37, 0.19] | −0.7 [−10.5, 9.1] |
| Hollow Hourglass | earned | 55 | 55 | −0.2 [−3.0, 2.6] | 0.05 [−0.03, 0.13] | 0.02 [−0.22, 0.25] | 4.3 [−3.2, 11.9] |
| Chronicle | earned | 51 | 22 | −0.7 [−6.5, 5.1] | 0.00 [−0.08, 0.08] | −0.02 [−0.15, 0.11] | 0.5 [−14.3, 15.4] |
| Tithe Box | earned | 46 | 26 | −5.0 [−9.7, −0.3] | −0.02 [−0.18, 0.14] | −0.05 [−0.15, 0.05] | −8.7 [−21.8, 4.5] |
| Lantern of the Road | earned | 55 | 55 | −0.9 [−3.9, 2.2] | −0.00 [−0.06, 0.05] | 0.19 [−0.08, 0.47] | −3.3 [−10.4, 3.8] |
| Crest of the Road | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reliquary | earned | 46 | 20 | 5.0 [0.3, 9.7] | 0.02 [−0.14, 0.18] | 0.05 [−0.05, 0.15] | 8.7 [−4.5, 21.8] |
| Mercenary Ledger | earned | 30 | 30 | n/a | n/a | n/a | n/a |
| Smith's Covenant | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Thief's Lantern | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Seer's Eye | earned | 50 | 50 | 0.1 [−3.4, 3.7] | −0.02 [−0.07, 0.02] | −0.08 [−0.28, 0.12] | −1.0 [−7.9, 6.0] |
| Darkened Dawn | twisted | 50 | 23 | −11.0 [−22.7, 0.7] | 0.01 [−0.08, 0.10] | 0.08 [−0.16, 0.31] | −6.7 [−21.0, 7.6] |
| Blood Covenant | twisted | 104 | 61 | −2.5 [−11.1, 6.0] | −0.31 [−0.60, −0.02] | 0.22 [0.08, 0.35] | −11.6 [−22.8, −0.4] |
| Kingmaker's Oath | twisted | 107 | 65 | −0.4 [−9.0, 8.1] | 0.02 [−0.14, 0.18] | −0.01 [−0.17, 0.15] | −4.1 [−15.4, 7.2] |
| Hollow Sun's Favor | twisted | 125 | 65 | −2.5 [−8.5, 3.4] | 0.11 [−0.02, 0.24] | 0.00 [−0.17, 0.17] | −3.9 [−13.1, 5.3] |

### Black Sun (200 runs)

| card | kind | offered | taken | ΔkoBattle% | Δdeaths/battle | ΔwinsBeforeKO | Δstall% |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Keen Eye | T1 | 52 | 13 | −0.2 [−2.6, 2.2] | 0.01 [−0.05, 0.07] | 0.00 [0.00, 0.00] | 1.1 [−10.7, 13.0] |
| Advance Pay | T1 | 58 | 13 | −2.3 [−5.9, 1.2] | 0.03 [−0.02, 0.07] | 0.00 [0.00, 0.00] | −6.9 [−18.3, 4.6] |
| Blessed Vigor | T1 | 44 | 15 | 0.0 [−1.8, 1.9] | 0.02 [−0.04, 0.09] | 0.00 [0.00, 0.00] | −2.2 [−13.2, 8.9] |
| Swift Instinct | T2 | 12 | 0 | n/a | n/a | n/a | n/a |
| Field Medic | T1 | 46 | 11 | 1.3 [−0.1, 2.8] | −0.04 [−0.10, 0.02] | −0.03 [−0.08, 0.03] | 10.8 [−1.1, 22.6] |
| Iron Oath | T3 | 11 | 2 | 0.3 [−3.0, 3.5] | −0.09 [−0.15, −0.04] | 0.00 [0.00, 0.00] | 14.0 [−3.7, 31.7] |
| Scout Blessing | T2 | 15 | 4 | 1.8 [−1.5, 5.1] | 0.08 [−0.05, 0.22] | 0.00 [0.00, 0.00] | −10.1 [−28.3, 8.1] |
| Scholar's Vow | T4 | 16 | 1 | n/a | n/a | n/a | n/a |
| Rally Cry | T2 | 8 | 1 | n/a | n/a | n/a | n/a |
| War Veteran | T3 | 10 | 2 | −0.8 [−4.2, 2.6] | 0.08 [−0.17, 0.33] | 0.00 [0.00, 0.00] | −13.7 [−28.1, 0.7] |
| Smith's Mark | T2 | 11 | 2 | −1.6 [−8.4, 5.3] | −0.06 [−0.23, 0.12] | 0.00 [0.00, 0.00] | 2.9 [−18.6, 24.4] |
| Arsenal Pact | T4 | 8 | 2 | 2.0 [−0.8, 4.9] | −0.01 [−0.09, 0.06] | 0.00 [0.00, 0.00] | −12.6 [−59.3, 34.1] |
| Pilgrim's Road | T2 | 14 | 3 | 0.4 [−2.0, 2.8] | −0.02 [−0.05, 0.01] | 0.00 [0.00, 0.00] | −10.7 [−27.5, 6.1] |
| Merchant Bane | T3 | 8 | 2 | 2.2 [−1.1, 5.5] | 0.18 [0.05, 0.30] | 0.00 [0.00, 0.00] | 10.2 [−17.5, 37.8] |
| Nomad's Pact | T3 | 7 | 2 | 0.6 [−0.5, 1.7] | −0.03 [−0.26, 0.20] | 0.00 [0.00, 0.00] | 15.5 [1.6, 29.5] |
| Hold the Line | T2 | 11 | 6 | 0.1 [−4.0, 4.2] | −0.01 [−0.07, 0.06] | 0.00 [0.00, 0.00] | 10.2 [−11.9, 32.4] |
| Quartermaster Cache | T2 | 10 | 6 | 0.4 [−1.8, 2.6] | 0.05 [−0.04, 0.15] | 0.00 [0.00, 0.00] | −3.5 [−25.6, 18.5] |
| Forbidden Tome | T4 | 13 | 1 | n/a | n/a | n/a | n/a |
| Blood Forge | T2 | 12 | 2 | 3.9 [−0.0, 7.8] | −0.10 [−0.21, 0.02] | 0.00 [0.00, 0.00] | 18.9 [−3.1, 40.9] |
| War Tutelage | T4 | 14 | 5 | −1.2 [−5.4, 3.1] | 0.10 [0.01, 0.19] | 0.00 [0.00, 0.00] | −7.5 [−23.2, 8.3] |
| Armory Stash | T4 | 0 | 0 | n/a | n/a | n/a | n/a |
| Scroll Archive | T4 | 9 | 3 | 1.8 [−2.2, 5.9] | −0.01 [−0.13, 0.11] | 0.00 [0.00, 0.00] | 7.4 [−20.0, 34.7] |
| Focused Curriculum | T3 | 11 | 3 | −1.5 [−8.1, 5.1] | −0.05 [−0.16, 0.06] | 0.00 [0.00, 0.00] | −16.5 [−46.8, 13.7] |
| Slow Fuse | T2 | 13 | 3 | −0.1 [−2.6, 2.4] | −0.07 [−0.17, 0.03] | −0.10 [−0.30, 0.10] | 15.4 [−11.5, 42.3] |
| Gambler's Toss | T3 | 12 | 1 | n/a | n/a | n/a | n/a |
| Bloodless Art | T2 | 4 | 1 | n/a | n/a | n/a | n/a |
| Phalanx Rite | T3 | 10 | 3 | 0.3 [−2.3, 3.0] | 0.04 [−0.04, 0.12] | 0.00 [0.00, 0.00] | −5.8 [−46.0, 34.4] |
| Duelist's Creed | T3 | 16 | 3 | −7.0 [−21.0, 6.9] | −0.03 [−0.18, 0.12] | 0.00 [0.00, 0.00] | 9.9 [−10.1, 29.9] |
| Late Bloom | T3 | 10 | 2 | 1.2 [0.0, 2.4] | 0.01 [−0.09, 0.11] | 0.00 [0.00, 0.00] | −5.4 [−21.7, 10.9] |
| Dawn Tithe | T2 | 11 | 3 | 0.1 [−7.2, 7.4] | −0.14 [−0.28, 0.00] | 0.00 [0.00, 0.00] | 9.5 [−18.6, 37.5] |
| Lone Banner | T3 | 10 | 5 | −1.8 [−5.9, 2.2] | −0.02 [−0.13, 0.10] | 0.20 [−0.19, 0.59] | −6.1 [−36.8, 24.6] |
| Cavalier's Hour | T3 | 11 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reserve | T2 | 8 | 1 | n/a | n/a | n/a | n/a |
| Cutpurse's Luck | T3 | 12 | 1 | n/a | n/a | n/a | n/a |
| Open Roll | T3 | 3 | 2 | n/a | n/a | n/a | n/a |
| Watcher's Grace | T2 | 15 | 2 | −0.1 [−3.4, 3.3] | −0.06 [−0.20, 0.07] | 0.00 [0.00, 0.00] | 1.4 [−19.3, 22.1] |
| Patient Dawn | T3 | 13 | 4 | 0.3 [−3.2, 3.7] | −0.07 [−0.17, 0.03] | 0.00 [0.00, 0.00] | 18.2 [4.3, 32.0] |
| Twin Chapel | T2 | 21 | 6 | 0.4 [−2.2, 3.0] | −0.00 [−0.08, 0.08] | 0.00 [0.00, 0.00] | −1.6 [−19.2, 16.0] |
| Omen Reader | T2 | 12 | 4 | 0.4 [−0.3, 1.1] | 0.10 [0.01, 0.20] | 0.00 [0.00, 0.00] | −2.4 [−24.0, 19.1] |
| Lottery Loot | T3 | 19 | 3 | 2.9 [0.3, 5.6] | −0.02 [−0.07, 0.03] | 0.00 [0.00, 0.00] | −10.3 [−36.3, 15.7] |
| Sealed Reliquary | gift | 18 | 5 | 0.7 [−1.4, 2.7] | 0.03 [−0.09, 0.15] | 0.00 [0.00, 0.00] | −13.2 [−37.9, 11.5] |
| Fallen Hoard | gift | 15 | 1 | n/a | n/a | n/a | n/a |
| Stranger's Scroll | gift | 18 | 5 | 2.8 [−0.3, 6.0] | −0.04 [−0.12, 0.04] | 0.00 [0.00, 0.00] | 7.3 [−11.4, 25.9] |
| Marked Blade | gift | 19 | 3 | 2.0 [−0.1, 4.2] | −0.02 [−0.10, 0.06] | 0.00 [0.00, 0.00] | 12.3 [−1.3, 25.9] |
| Pilgrim's Wager | gift | 20 | 1 | n/a | n/a | n/a | n/a |
| Armory Stash | gift | 16 | 2 | −3.2 [−6.0, −0.4] | 0.02 [−0.13, 0.18] | 0.00 [0.00, 0.00] | −10.5 [−31.7, 10.7] |
| Unbroken Banner | earned | 172 | 86 | −3.4 [−7.8, 1.0] | −0.09 [−0.25, 0.08] | 0.01 [−0.04, 0.06] | 1.9 [−5.1, 9.0] |
| Second Dawn | earned | 34 | 34 | −2.0 [−4.7, 0.7] | 0.04 [−0.03, 0.10] | 0.01 [−0.05, 0.07] | −2.2 [−9.7, 5.4] |
| Ember Lantern | earned | 164 | 83 | −2.7 [−6.7, 1.2] | −0.09 [−0.30, 0.11] | 0.01 [−0.03, 0.05] | −1.8 [−9.6, 5.9] |
| Captain's Whistle | earned | 166 | 82 | 5.5 [0.1, 10.9] | −0.01 [−0.19, 0.17] | −0.05 [−0.10, 0.01] | 2.3 [−5.1, 9.8] |
| Standard of the Sun | earned | 61 | 39 | −3.1 [−5.9, −0.3] | −0.06 [−0.12, −0.00] | 0.00 [0.00, 0.00] | 4.5 [−6.4, 15.4] |
| Hollow Hourglass | earned | 37 | 37 | −0.4 [−2.9, 2.0] | 0.04 [−0.03, 0.11] | 0.01 [−0.05, 0.07] | 7.3 [−0.5, 15.0] |
| Chronicle | earned | 57 | 29 | −0.4 [−3.8, 3.0] | −0.04 [−0.12, 0.03] | 0.00 [0.00, 0.00] | 5.1 [−7.8, 18.0] |
| Tithe Box | earned | 55 | 34 | 1.1 [−1.1, 3.4] | −0.10 [−0.24, 0.05] | 0.00 [0.00, 0.00] | −2.0 [−13.7, 9.7] |
| Lantern of the Road | earned | 62 | 62 | 1.2 [−0.0, 2.5] | −0.01 [−0.05, 0.03] | −0.03 [−0.06, −0.00] | 0.6 [−5.9, 7.1] |
| Crest of the Road | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Saint's Reliquary | earned | 55 | 21 | −1.1 [−3.4, 1.1] | 0.10 [−0.05, 0.24] | 0.00 [0.00, 0.00] | 2.0 [−9.7, 13.7] |
| Mercenary Ledger | earned | 30 | 30 | n/a | n/a | n/a | n/a |
| Smith's Covenant | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Thief's Lantern | earned | 0 | 0 | n/a | n/a | n/a | n/a |
| Seer's Eye | earned | 67 | 67 | 0.4 [−1.0, 1.8] | −0.04 [−0.09, 0.00] | 0.01 [−0.03, 0.06] | −4.1 [−10.2, 1.9] |
| Darkened Dawn | twisted | 47 | 26 | 1.2 [−2.7, 5.2] | 0.15 [−0.01, 0.31] | 0.04 [−0.04, 0.11] | −1.7 [−15.1, 11.7] |
| Blood Covenant | twisted | 102 | 53 | 1.9 [−5.9, 9.7] | 0.11 [−0.17, 0.40] | −0.00 [−0.08, 0.07] | −0.4 [−9.3, 8.6] |
| Kingmaker's Oath | twisted | 116 | 63 | −0.1 [−4.5, 4.2] | 0.21 [0.05, 0.38] | −0.00 [−0.05, 0.05] | −4.5 [−13.0, 4.0] |
| Hollow Sun's Favor | twisted | 107 | 56 | −2.1 [−9.0, 4.9] | 0.25 [0.10, 0.40] | 0.05 [−0.03, 0.13] | 8.8 [−0.7, 18.4] |

