# Slice review resolution — September 21

This supersedes the earlier completion claim for release readiness. Implementation fixes are local; Dave has resumed browser verification and authorized build 12 upload. Build 11 remains distributed until that completes. The original review is retained in `slice-review-2026-09-21.md`.

## Findings and decisions

- **R1:** All level-up/promotion popup Text allocations use `presentationText`. A regression models Phaser UUID draws and compares subsequent hit/crit randomness with a checkpoint-resume path. Canvas hint text is isolated too.
- **R2/R10:** Menu/heal lessons defer until playable idle instead of being dropped. Pending work cleans up on shutdown. Caravan acknowledgment follows the same reading contract; inline forecast notes require visible reading exposure, not just creation. Cross-review additionally covers fresh scene creation before deployment and notes outside a scroller's viewport.
- **R3:** The seed-11 test incorrectly required reaching the boss despite legitimate earlier combat losses after balance changes. Retain that full-run seed as a no-timeout/terminal-state check, and isolate the actual cleared-throne wall geometry in a direct regression. The scripted player's throne approach now uses terrain path cost, as its enemy pursuit already does. No difficulty, action-budget, or simulation threshold was weakened.
- **R4:** Reopening the mobile menu from the unit's own tile after undo registers selection ownership and restores movement highlighting. Pre-commit taps can transfer selection, dismiss, or inspect acted allies/NPCs; committed movement/trade restrictions remain.
- **R5:** A held fast-forward gesture survives gaps between enemy exchanges; only active combat is accelerated by the hold. Cancellation, capture failure, blur, visibility loss and teardown clear it. Strike effects are disposed even when the player releases the hold before cleanup.
- **R6/R7:** Fast/Instant cover hazards, death chains, splash, break pauses, ballista effects, enemy movement and skill banners. Generic informational/error banners deliberately retain reading time. Fast shortens stat reveal; Instant starts fully revealed, with one Continue press. No stats/events are skipped.
- **R8:** Multi-tile anchor placement respects the one-Cleric cap and assigns healing AI. Main placement and guard assignment retain the same restriction.
- **R9:** Ballista now uses shared 2RN, closing the undocumented exception. Its rating remains 85; actual hit probability is 95.5%, consistent with other attacks. Critical/status/proc rolls remain unchanged.
- **R11:** The Act 1 boss table was intentional: Dave explicitly requested stronger rewards after a Vulnerary/Steel Sword/Armorslayer offer. Retain the curated policy; deterministic sampling verifies three unique upgraded choices and preserves ordinary-node healing rewards.
- **R12:** Required new source/data files remain local and untracked alongside the rest of this uncommitted release work. Production build and data parity include them. No commit/push was requested for this pass; any future repository handoff must include all new imports, source data and public mirrors, not merely tracked diffs.
- **R13:** Low-quality cut-ins intentionally preserve readable identity with static presentation; the code now explains why. Removed unused combined effects accessors and updated lifecycle fixtures to the independent settings. Cloud refetch timing remains deferred for local-only builds. Deployment-name migration and broader legacy-renderer parity remain separate follow-ups, not resolved by this pass. “Clear optional selections” clears the current draft; “Same as last battle” deliberately retains the prior battle choice.
- **R14:** Valid victory metadata survives a malformed/missing roster as an empty roster; save round-trip covered. Dialogue-condition data contracts now check value types and supported commander/difficulty/result values, not just key spelling. Current supported-mode enemy caps remain unchanged; hypothetical future-mode defaults are not release blockers. Refresh during a level-up presentation keeps applied stats/checkpoint state but may omit the already-applied visual replay.
- **R15:** Lore documentation names the battlefield-template test separately from item-lore tests. Test scopes are explicit below: the older 5,443 figure was `test:unit` (excluding harness/sim); 5,641 was the combined suite. Those counts alone do not establish that new code landed after verification. The failing simulation test was real regardless.

## Verification

- `npm test`: **5,667 passed / 339 files**, including unit, harness and simulation tests; browser specs excluded by configuration.
- `npm run sim:fullrun:harness:pr`: all four slices passed with unchanged seeds, budgets and thresholds.
- Production build passed, including the new local source/data files.
- Data schemas, 27-file data parity, generated reference and theme checks passed.
- Lint: **0 errors, 309 warnings**. `git diff --check` clean.
- Independent cross-review caught the first-create caravan and offscreen-note cases above; both have regressions. Input/timing/settings/records cross-review found no further concrete defect.

Browser verification resumed in the build 12 pass; see `build12-review-note.md` and `testflight-beta.md` for current evidence. This earlier checkpoint did not certify physical-device behavior. No TestFlight upload or GitHub commit/push occurred. Logs: `/tmp/review-sep21-final-tests.log`, `/tmp/review-sep21-final-build.log`, `/tmp/review-sep21-final-lint.log`, `/tmp/review-sep21-sim.log`.
