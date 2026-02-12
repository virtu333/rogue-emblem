# Meta Progression Pricing Plan (Alpha)

Date: 2026-02-12

## Baseline Snapshot

Current source-of-truth pricing has been archived at:
- `data/archive/metaUpgrades/metaUpgrades.2026-02-12.alpha-baseline.json`
- `data/archive/metaUpgrades/metaUpgrades.2026-02-12.alpha-baseline.manifest.json`

Baseline totals (from `data/metaUpgrades.json`):
- Total cost (all upgrades, all tiers): **50,350**
- Valor-side total: **25,850**
- Supply-side total: **24,500**
- Full-victory runs to max all on Normal: **49 Valor / 47 Supply**

Interpretation: progression is currently too slow for alpha experimentation.

## Data-Driven Candidate Profiles

Generated report: `docs/reports/meta-pricing-analysis-2026-02-12.json`
Candidate data files: `data/archive/metaUpgrades/proposals-2026-02-12/`

| Profile | Total Cost vs Baseline | Valor Total | Supply Total | Normal Full-Victory Runs to Max (V/S) |
|---|---:|---:|---:|---:|
| Conservative | 77.0% | 19,925 | 18,850 | 38 / 36 |
| Moderate | 61.7% | 15,900 | 15,150 | 30 / 29 |
| Aggressive Alpha | 47.2% | 12,200 | 11,575 | 24 / 22 |
| Sandbox Alpha | 31.8% | 8,300 | 7,700 | 16 / 15 |

## Recommendation

Use **Sandbox Alpha** during current alpha phase.

Reasoning:
- The stated goal is experimentation, not long-term retention pacing.
- 16/15 full-victory runs on Normal is still meaningful but no longer a major blocker.
- It gives room for mixed outcomes (non-victory runs) without making progression feel stalled.

## Rollout Plan

1. Apply `sandbox` candidate prices to live `data/metaUpgrades.json`.
2. Keep the baseline archive immutable for easy rollback/reference.
3. Run 1 week of alpha playtests and track:
   - % of players buying at least 1 upgrade in first 2 runs
   - Median total upgrades purchased by run 5
   - Distribution of spending by category/currency
   - % of players who unlock at least one high-impact node (`deploy_limit`, `weapon_tier`, or level-3 stat nodes)
4. Re-tune from observed data:
   - If progression is still too slow, move to 25-30% total-cost band.
   - If progression is too fast, move toward Aggressive (47.2%) selectively by category.

## Notes

- `data-viewer.html` contains an embedded meta-upgrades copy that is stale for at least one row (`recruit_skill` differs from `data/metaUpgrades.json`).
- Treat `data/metaUpgrades.json` as source-of-truth for balancing changes.
