# Meta-upgrade balance simulations

This tool evaluates permanent upgrades without changing gameplay, production prices,
saved players, or CI regression thresholds. Run it with `npm run sim:meta-balance -- --help`.
The first measurements and recommendations are in
[the September 30 report](../reports/meta-upgrade-balance-2026-09-30.md).

## Two different questions

1. **Marginal power:** replay an obtainable loadout and a purchase variant on the same
   seeds. Which purchases improve run outcomes, and how much do they cost?
2. **Progression pacing:** start fresh, earn real run rewards, buy legal upgrades,
   and repeat. Which price schedules give useful progress without compressing the
   intended progression curve too far?

Prices alone do not change a fixed army. A fixed-loadout test cannot evaluate a
discount; a campaign simulation must model the intervening purchases. The PR #161
cut applies to the Battalion/capacity category, not Recruit Stats or Economy.
Both currencies currently earn at the same rate but have separate wallets.

## Commands

```bash
# Next-tier marginal audit, with deliberately different player policies
npm run sim:meta-balance -- --profile act1 --agent rescue --seeds 100
npm run sim:meta-balance -- --profile act1 --agent tactician --seeds 100 --seed-start 1001

# Explicit tier changes and synergy bundles (missing upgrade prerequisites are charged)
npm run sim:meta-balance -- --profile mid --agent tactician \
  --variants recruit_spd_flat,recruit_def_flat,lord_spd_flat,recruit_xp,recruit_spd_growth+recruit_xp

# Equal available budgets, separate Supply and Valor; report unused balances
npm run sim:meta-balance -- --mode portfolios --profile act1 --agent tactician \
  --supply-budget 800 --valor-budget 800 --seeds 100

# Fresh-save campaign: prices as fractions of the frozen pre-161 Battalion table
npm run sim:meta-balance -- --mode campaign --agent tactician --seeds 50 --runs 20 \
  --fractions 0.5,0.65,0.8,1 --deploy-costs 150 --buy-policy battalion --buying save

# Isolate Tactical Advantage's special 500 -> 150 cut
npm run sim:meta-balance -- --mode campaign --agent tactician --seeds 30 --runs 20 \
  --fractions 0.5 --deploy-costs 150,500 --buy-policy battalion --buying save

# Impulsive/opportunistic buying can produce very different uptake
npm run sim:meta-balance -- --mode campaign --buying affordable --buy-policy battalion

# Save readable summaries and compressed per-seed/per-run evidence
npm run sim:meta-balance -- --seeds 100 \
  --out /tmp/meta-summary.json --raw-out /tmp/meta-rows.json.gz
```

`--variants id` buys the next tier; `id=N` buys through target tier N;
`id+other` evaluates a bundle. Reports list every changed track, including
prerequisites, and distinguish the cost of entering a track from the next-tier
price. Effects are cumulative: tier 2's displayed total is not added to tier 1.
Milestone locks and already-maxed variants are reported as unavailable, not bypassed.
Unknown IDs and malformed inputs fail loudly.

`--loadout file.json` supplies an audit/portfolio baseline with
`{"purchases":{"upgrade_id":1},"milestones":["beatAct1"]}`. Profiles are declared
progression states, not claims about typical player ownership. Every preset has
legal upgrade prerequisites. `act1` assumes a prior Act I clear; `mid` assumes a
prior game clear; `late` assumes a prior Nightfall clear. Reports preserve exact
purchases and milestone assumptions. Campaigns always start fresh.

`--starter-ids id,id` labels owner-designated intentional bargains in audit output.
It does not alter their prices or infer which upgrades should be starters.

## Buying and price schedules

The `battalion`, `stats`, and `economy` policies change the order of desired Supply
purchases. All use the same Valor order so comparisons can isolate Supply allocation.
These are hypotheses about behavior, not an optimizer or recommended build order.
The tested baskets intentionally exclude effects the agent cannot use; they do not
represent the entire upgrade catalog or its time to completion.

- `save` preserves a currency for its next desired legal purchase. Among eligible
  tracks, it favors lower owned tiers and breaks ties by the policy order. An
  unaffordable target blocks cheaper fallback purchases in that wallet; the other
  wallet remains independent.
- `affordable` scans the policy order, buys a tier of every affordable eligible
  track, and repeats until nothing is affordable. It can starve expensive upgrades
  by spending on cheap fallback tracks. That is a behavior to measure, not evidence
  that unpurchased upgrades have no value.

Prices come from balance revision 2's frozen `from` table. `0.5` reproduces today's
Battalion prices except Tactical Advantage, whose price is an independent argument.
Only those price fields change. Recruit stats, Economy, and Valor prices stay fixed.
Prices round to the nearest 5; effects and current recruit/deployment rules stay fixed.
Past-buyer refunds and incumbent-save transitions are not modeled by fresh campaigns.

## Runtime and measurement contract

`MetaBalanceDriver` uses the real `RunManager`, `HeadlessBattle`, recruitment,
combat, growth, XP, shops, church promotion/revival, and Eclipse engines. It adds
simulation-only route selection, actual gold/team-XP or skip rewards, mastery
participation, late-pressure completion gold, post-boss recruits, and third-lord
arrivals. It does not enable invincibility or fabricate wins.

Post-boss/third-lord drafts use the runtime preparation/resolution functions. The
policy chooses current combat value, without looking ahead at future random draws.
Starting unlocked skills are assigned exclusively within real slot limits: defensive
skills to the partner first, offensive skills to the commander first, then the other
lord if a slot is available. This fixed assignment policy is recorded, not optimized.

Campaign payouts use `settleEndRunRewards` and real prerequisite/purchase checks.
The simulator overrides only meta persistence writes; it never touches player saves.
Purchases occur after payout and affect the next run. A cohort/run gets the same
seed under every price schedule, independently of prior random consumption.

Measurements include victories, Act I/II clears, completed battles, deaths, turns,
turns over par, final shadow, earned currencies, and beneficiary exposure. Exposure
includes ordinary recruits (separate from Gaspar), deployment of the added slot,
recruit skills/accessories, and post-boss joins. Empty extra slots and absent eligible
recruits produce a `partially_exercised` label and no efficiency ranking.

Per-seed rows are retained; worker-count reproducibility is tested. Global random
overrides run only serially within each worker process and restore in `finally`.
Pairing means common initial seeds, not identical encounters after choices diverge.

Timeout/stuck runs are **censored**, receive no campaign payout, and stop that
cohort. Paired estimates exclude either-side censored pairs and disclose the count.
If censoring differs materially by treatment, those estimates may be biased;
inspect raw outcomes and increase action budgets before using them for pricing.

Audit and portfolio reports give paired differences, standard errors, approximate
95% normal intervals, and nonzero-pair counts. Zero discordant pairs do not prove
equivalence. One observation gets no interval. Efficiency ratios are diagnostics
for supported, exercised, single-currency variants; mixed-currency bundles receive
no invented exchange rate. Portfolio comparisons also compare the competing
baskets directly on paired seeds. Campaign comparisons use the first requested
schedule as baseline and preserve failures to reach milestones as null times,
with success denominators, rather than reporting only successful-player medians.

## Limits and decision gates

The agents do not use consumables, weapon arts, rewinds, reclassing, caravan trades,
colosseum transactions, loot equipment/scrolls, or skill benches. Those directly
affected upgrades are `unmeasured`. Other effects have policy limits: limited
weapon switching, lords-first deployment, gold-focused loot, church-only promotion,
no blessings, no deliberate recruit XP feeding, and no third-lord draft reroll.
Tactician uses the simple rescue policy on seize/escape maps. The simpler agents
charge enemies. Low win rates may measure these policy limitations and attrition,
not player difficulty. Campaigns condition on a fixed difficulty and do not model
the player's learning or difficulty-unlock choices.

Before changing a price:

1. Confirm the effect is implemented and exercised often in the relevant stratum.
2. Check agreement across starting pairs, route/agent policies, and progression profiles.
3. Compare next-tier and entry/bundle costs, prerequisites, and deployment occupancy.
4. Confirm a signal on unused seeds, then compare the progression curves of candidate prices.
5. Preserve explicitly designated starter bargains; seek dominance elsewhere rather
   than demanding identical power per currency across every upgrade.

For rare binary outcomes, use the saved rows for paired bootstrap or discordant-pair
inference, and expand beyond the 100-seed screen. These experiments are reporting
tools, not CI thresholds or an automatic price optimizer. Do not change existing
regression thresholds to make a balance experiment appear successful.

## Validation

`npm run test:sim` includes focused checks for legal loadouts/prerequisite cost,
cumulative tiers, frozen price isolation, separate wallets, savings behavior,
skill assignment, paired identities, unused effects, worker reproducibility,
price invariance for fixed purchases, censoring, real campaign payout accounting,
and post-boss recruitment/reward resolution.
