# September 26 playtest results — round 3

Start with [the consolidated report](review.md). Supporting mobile/desktop notes, code-review findings, probe outputs and a checkpoint screenshot are included.

## Version boundary

Tested commit: `336cd41d98611a755485a8641fcc95cd83b36428` (main through PR #113).

Published on a documentation branch based on newer main. **This is historical evidence, not a review of the publishing branch or a current release approval.** Subsequent changes may have resolved findings. In particular, main now includes PR #123's forecast-equipment purity work; the report's proposed sequencing describes the state when tested. PR #99 portrait results are not included in this batch.

## Evidence and reproduction

The `.mjs` files are manual review probes, not installed application code or additions to the automated test suite. Imports are repository-relative for portability. To reproduce the recorded results, put this directory at `docs/playtests/2026-09-26-round3` in a checkout of the tested commit, install its dependencies, and run a probe from the repository root, for example:

```sh
node docs/playtests/2026-09-26-round3/legacy-recruit-collision-probe.mjs
```

The recruit-placement probe generates 1,504 maps. The native-save probe uses an in-memory backend and does not read or alter real saves. Captured JSON/text outputs reflect the reviewed snapshot; later code may produce different results.

Coverage: tutorial plus nine mobile Normal wins (Act II, unfinished), two desktop wins, focused code checks. No physical iPhone acceptance or complete Normal victory. No production save data or credentials are included.
