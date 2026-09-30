# Permanent-upgrade balance: first simulation pass

**Recommendation: keep the current prices pending selective follow-up.** The first
pass supports useful progression from cheaper Battalion purchases, and identifies
Vanguard Cadre and flat DEF tracks for closer review. It does not establish that
the blanket cut is too large, or justify a new global multiplier. Gameplay prices
are unchanged by this PR.

The experiment code is published as GitHub commit `d7d8921`, based on gameplay/data
commit `97c8308`. The runs record local analysis commit `3362e34`; its source tree
`4d5f7dfbfc6e82d29d77a07cc7d34851a1dbb81c` is byte-identical to the published
code tree (verified through Git blob/tree hashes).
We ran **14,682 simulated runs** across marginal audits, equal-budget portfolios,
an independent Vanguard holdout, and repeated-run pricing experiments. This is
simulation volume, not 14,682 independent players: campaign runs share a cohort's
progression, and audit treatments share seeds.

See [the method, commands, and limits](../specs/meta-upgrade-balance-simulation.md).
All experiments below use First Light, Edric/Sera, recruitment-first routing,
and no selected blessings. Prices are fractions of the frozen pre-161 Battalion
table; Tactical Advantage is independent. Recruit Stats, Economy, and Valor prices
are fixed. The historical roster-cap refund is outside these fresh-save experiments.

## Findings

### Vanguard Cadre I has a reproducible opening benefit

The early profile owns four small Valor upgrades and assumes a prior Act I clear.
It includes Gaspar through the real starting-roster rules; Vanguard adds another
unit rather than being tested against an army consisting only of two lords.

| Experiment | Eligible pairs | Added completed battles/run | Approximate 95% interval |
|---|---:|---:|---:|
| Rescue agent screen, seeds 1–100 | 100 | +0.100 | −0.137 to +0.337 |
| Tactician screen, seeds 1001–1100 | 99 | +0.818 | +0.372 to +1.264 |
| Tactician independent holdout, seeds 2001–2500 | 496 | **+0.456** | **+0.250 to +0.661** |

On the holdout, baseline armies completed 3.282 battles/run and Vanguard armies
3.738, among complete pairs. Four pairs were censored by an agent timeout. The
current entry price is 200 Supply. This confirms useful opening power under this
policy; it does **not** establish that 200 is too cheap. If Vanguard is designated
an intentional starter bargain, preserve that exception and scrutinize later tiers
separately. Those later tiers widen the class pool; they do not add another unit.

### Flat DEF deserves closer comparison with flat SPD

The middle profile owns tier-3 growth tracks and tier-1 flat tracks, Vanguard I,
some lord equipment, and two starting-skill unlocks. Each stat variant buys tier 2,
so the additional stat bonus is +2, not the cumulative +3 shown for tier 2.

| Next-tier purchase | Marginal cost | Added battles/run | Approximate 95% interval | Censored pairs / 100 |
|---|---:|---:|---:|---:|
| Recruit Armor II: +2 DEF | 315 Supply | +0.898 | +0.163 to +1.633 | 2 |
| Recruit Agility II: +2 SPD | 365 Supply | −0.101 | −0.836 to +0.634 | 1 |
| Lord Fortitude II: +2 DEF | 605 Valor | +2.187 | +1.213 to +3.161 | 9 |
| Lord Celerity II: +2 SPD | 695 Valor | +0.379 | −0.480 to +1.238 | 5 |

This is a **candidate ranking for follow-up**, not four price recommendations.
DEF appears stronger despite costing less than the parallel SPD tier. Attrition,
enemy thresholds, and the bot's limited healing can amplify DEF's measured value.
Lord DEF also has materially more censored pairs, so its complete-pair estimate
may be biased. Confirm these tracks with holdout seeds, different starting pairs,
and an agent that handles stalls and resource use before changing their prices.

The other middle-profile candidates—Skilled Recruits, Outfitted Recruits, Training
Doctrine, and the growth/XP bundle—have broad intervals spanning zero. The current
screen does not justify nerfing them.

### Tactical Advantage's low early value reflects deployment occupancy

The extra slot was filled in only 4/100 early Tactician runs and 0/100 Rescue runs.
The latter is labeled partially exercised and receives no efficiency ratio.
Occupancy rises to 44/99 complete pairs in the middle profile, but its marginal
battle estimate remains uncertain: −0.010, interval −0.522 to +0.501.

Adding Tactical Advantage to Vanguard also increases occupancy (17/98 early
complete pairs), but the bundle's broad outcome signal is close to Vanguard alone.
These data do not establish that the 500 → 150 cut is excessive. Extra troops can
also change generated enemy counts; measure resulting outcomes, not just count
the added player actions.

In a separate 30-cohort, 20-run campaign with Battalion prices held at 50%, pricing
Tactical Advantage at 150 versus 500 gives an uncertain cumulative-battle difference:
the 500-cost treatment is −0.36 battles over the campaign, interval −2.67 to +1.95,
on 25 complete cohort pairs. Both schedules recorded an Act I clear in 22/30 cohorts.
Three versus five cohorts were censored. This is insufficient to select a deploy price.

### Purchase behavior materially changes the effect of the discount

The saving-policy experiment simulates 50 fresh cohorts, each for up to 20 runs.
It preserves Supply for desired Battalion purchases instead of spending every small
balance on a cheap fallback. Tactical Advantage remains 150 in all four schedules.

| Battalion prices vs pre-161 | Cohorts reaching Act I clear by run 20 / 50 | Censored cohorts | Mean owned tiers entering run 20* | Mean battles in run 20* |
|---|---:|---:|---:|---:|
| 50%: current | 39 | 7 | 12.91 | 4.60 |
| 65% | 36 | 7 | 11.19 | 4.07 |
| 80% | 36 | 2 | 10.35 | 3.85 |
| 100% | 35 | 1 | 9.82 | 3.69 |

\* These checkpoint means use observed, non-censored cohorts in each schedule;
they are descriptive and are **not** matched-sample treatment estimates.
Owned tiers count both currencies and are a breadth measure, not a calibrated power score.
Some censored cohorts had already cleared Act I, so the milestone count retains
their observed achievement; later outcomes remain unknown.

Among 43 complete paired cohorts, the full-price schedule completed 4.49 fewer
battles **summed over all 20 runs** than current prices (interval −7.55 to −1.43).
The 65% schedule's difference is −2.37, interval −4.89 to +0.15, on 41 complete pairs.
Differential censoring limits both comparisons. There is no robust evidence here
that 65% is superior to 50%, and lower prices clearly do not create an instant
completion of the tested upgrade basket.

The opportunistic Rescue buyer provides an important counterexample: all four
schedules have identical outcomes and purchases. Its low earnings get spent on
unchanged cheap fallback upgrades before it saves enough for the changed Battalion
prices. That experiment barely exposes the treatment; identical outcomes are not
evidence that the prices are equivalent.

A stats-first saving policy (30 cohorts) also gives a much weaker price signal:
the full-price schedule's cumulative-battle difference is −1.88, interval −5.13 to
+1.36, on 26 complete pairs. Thus an economy or purchasing assumption can matter
as much as the headline discount.

### Equal available budgets show no clear dominant basket

With 800 additional Supply and 800 additional Valor above the early profile, the
saving policies produce different baskets and leave unused balances. They use the
same Valor order. Budgets are caps, not a claim that every basket spends exactly 800.

| Portfolio | Supply spent | Supply unspent | Valor spent | Added battles vs baseline |
|---|---:|---:|---:|---:|
| Battalion | 600 | 200 | 790 | +1.09 |
| Recruit stats first | 800 | 0 | 790 | +1.14 |
| Economy first | 675 | 125 | 790 | +1.32 |

Direct paired differences against Battalion are inconclusive: stats +0.113
(−0.138 to +0.365; 97 pairs), economy +0.230 (−0.249 to +0.709; 100 pairs).
This gives no basis for declaring Battalion the dominant use of Supply at these budgets.
These gains include the common Valor investments; do not attribute the entire
baseline difference to Supply. The direct basket comparisons isolate their differing
Supply investments conditional on that common Valor loadout.

## Model limits and next decisions

Fresh campaigns produced no full-game victories under these policies; the middle
audit produced occasional victories. The bots' limited item use, promotion,
weapon switching, and tactical choices make first-full-clear timing uncalibrated.
Zero campaign wins cannot support a claim that human progression is slow or safe.

We reproduced a Tactician timeout at run seed `6000035`: after 284 turns, three
players were holding outside three guarded Knights on a Rout map. There were no
zombie remains or NPCs. This is a conservative-policy stall, not a player defeat.
Adding action budget alone may not fix it. Stronger armies can survive long enough
to hit these stalemates, which helps explain treatment-dependent censoring.

Recommended follow-up order:

1. Resolve/calibrate the conservative agent's stall behavior and add realistic
   resource/promotion choices. Preserve genuine deaths and avoid invincible pricing estimates.
2. Confirm the flat DEF-versus-SPD signal across unused seeds, commanders, difficulty
   strata, and deployable-roster states. The current estimates identify candidates,
   not a universal damage-stat exchange rate.
3. Decide whether Vanguard I is an intentional starter bargain; assess its later
   tiers independently, including chosen class pools and their option value.
4. Repeat the 50/65/80/100% campaign curves with savings and opportunistic buying,
   reported censoring, and empirical playtest benchmarks for act-clear pacing.
5. Change individual outliers first. Preserve starter exceptions explicitly. No
   blanket price adjustment is supported by this first pass.

## Reproduction and evidence

Each JSON summary records exact options, baseline purchases/milestones, skipped
variants, coverage, estimates, and the paired comparisons. Each accompanying
`*.rows.json.gz` contains compressed raw rows and can be read with Python's
`gzip.open`/`json.load` or Node's `gunzipSync`. Raw campaign histories preserve
per-run earned rewards, purchases before/after, milestones, balances, and censoring.

| Experiment | Summary | Raw rows | Simulated runs |
|---|---|---|---:|
| Early Rescue audit | [JSON](meta-balance-2026-09-30-audit-act1-rescue.json) | [Gzip](meta-balance-2026-09-30-audit-act1-rescue.rows.json.gz) | 1,200 |
| Early Tactician audit | [JSON](meta-balance-2026-09-30-audit-act1-tactician.json) | [Gzip](meta-balance-2026-09-30-audit-act1-tactician.rows.json.gz) | 900 |
| Vanguard holdout | [JSON](meta-balance-2026-09-30-vanguard-holdout.json) | [Gzip](meta-balance-2026-09-30-vanguard-holdout.rows.json.gz) | 1,000 |
| Middle audit | [JSON](meta-balance-2026-09-30-audit-mid.json) | [Gzip](meta-balance-2026-09-30-audit-mid.rows.json.gz) | 1,000 |
| Equal-budget portfolios | [JSON](meta-balance-2026-09-30-portfolios.json) | [Gzip](meta-balance-2026-09-30-portfolios.rows.json.gz) | 400 |
| Opportunistic buyer | [JSON](meta-balance-2026-09-30-campaign-battalion.json) | [Gzip](meta-balance-2026-09-30-campaign-battalion.rows.json.gz) | 4,000 |
| Battalion-saving buyer | [JSON](meta-balance-2026-09-30-campaign-saving.json) | [Gzip](meta-balance-2026-09-30-campaign-saving.rows.json.gz) | 3,899 |
| Stats-saving buyer | [JSON](meta-balance-2026-09-30-campaign-stats.json) | [Gzip](meta-balance-2026-09-30-campaign-stats.rows.json.gz) | 1,173 |
| Independent deploy prices | [JSON](meta-balance-2026-09-30-campaign-deploy.json) | [Gzip](meta-balance-2026-09-30-campaign-deploy.rows.json.gz) | 1,110 |

Re-run a saved report using its `options` fields. Worker count can change without
changing outcomes. The 500-seed holdout uses disjoint seeds from screening.
Intervals are approximate normal paired intervals, not multiplicity-adjusted
confirmation for the whole catalog. The holdout confirms only the selected Vanguard
hypothesis under the declared policy.

## Validation

- All 54 simulation tests pass, including 13 new experiment-integrity checks.
- The targeted manager/Battalion/reward/run-driver suites pass (190 tests).
- Existing full-run PR slices pass without threshold changes.
- Reference-content and data-parity checks pass.
- New/changed JavaScript passes ESLint with zero warnings. Repository-wide lint
  reports zero errors and 370 warnings in existing files.
- Formatting checks pass after formatting the generated JSON summaries.
- Browser/device lanes were not run: this PR adds offline research tooling and
  documentation, with no production gameplay/UI changes.
