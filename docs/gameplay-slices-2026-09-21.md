# Gameplay slice execution — September 21

This is the execution record for the remaining U2/G-wave, after the presentation/story checkpoint. Build 11 remains live; check in before distribution.

## Grounded adjustments to the proposal

- G1: most listed "dead" skills already work as promotion innates. Preserve them. Add genuinely missing progression opportunities and move base-class level-15 learning to level 10. Enemy creation must not inherit the player curriculum outside its difficulty gate.
- G2: the old approximate economy model reports ~24k balanced surplus, but it assumes maximum deployment counts and simplified purchasing, while the actual full-run harness reports much less. Do not force a 4× price increase to hit that model's 6k hypothesis. Preserve Act 1, mark up new Act 2/3/4 offers by 15/30/40%; retain item base prices for resale. Existing quoted stock stays stable. Revisit broader gold tuning with actual player purchase/forge behavior. This is an intentional revision of the original numerical target, not a claim that it was met.
- G3: Light arts already exist. Add eight genuinely Act-4-exclusive specialist scrolls, including two Light arts; prevent early innate grants with explicit `scrollOnly` eligibility.
- G4: retain current act inclusion per difficulty. Act 2 and 4 row scaling stays within their existing enemy pool limits (3–8 and 11–17). Normal Act 1 has no affixes; later Normal gets a 5% base chance of one tier-1 affix, excluding deathburst/haste/teleporter. Keep forced node guarantees; optional Act 1 rolls favor more services, later acts offer more arena opportunities.
- G9: use existing starting-skill unlock and assignment machinery instead of introducing a second progression system or silently granting lord Mastery.

## Baselines and checks

- Pre-G-wave matchups: `/tmp/slices-baseline-matchups.log`.
- Approximate economy, 500 trials: balanced mean 24,191 → 23,335; buy-weapons 16,011 → 15,336; balanced spending 6,351 → 7,296. Act-2 promotion affordability 99.8% → 99.2% balanced. These are sensitivity results, not realistic full-run forecasts.
- G2 focused tests: 141 passed. G4 focused tests: 97 passed.
- G1/G10: 173 targeted checks passed; Normal class matchup matrix unchanged.
- G3: 226 targeted checks, schemas and data parity passed.
- Combat journey safety net: 55 journey tests, 164 harness tests; 113 fresh-seed journeys in a short soak. Real resolution/XP/checkpoint, held-popup reload, resume, and deliberately omitted-save calibration. Synthetic sparring fixtures do not replace headed targeting or AI-turn checks.

## Completion status

Implementation is present, but the September 21 follow-up review reopened release verification (R1–R15 in `slice-review-2026-09-21.md`). The historical results below do not certify the current tree. Browser checks remain paused at Dave’s request.

## Final implementation decisions and adversarial findings

All planned U/G/D/P slices are implemented. U2 tracks acknowledged run openings/act transitions by content-sensitive key with an explicit default-off setting. Unacknowledged flavor toasts still show. G7 gives lords exactly one eligible trait (Clever respects proficiency; Lazy/Reckless excluded). G9 adds first-clear Pavise/Aegis/Renewal unlocks through existing assignment slots; meta cost 53,428 → 54,928 (+2.81%).

G5 was verified before G8, and G6 after both, so the two-roll RNG change had its own checkpoint. G6 is symmetric continuous 2RN, consuming two combat RNG draws per attack; critical hits, status staves and skill rolls remain unchanged. AI scoring uses the actual two-roll probability. Forecasts now say **Hit rating**, not a misleading literal percentage; shared explanations give 75 → 87.5% and 25 → 12.5% examples. Matchup matrices changed by 0.81 percentage points on average (absolute), maximum 16.5; this is a simulation observation, not proof of player balance.

Review findings addressed:
- Restored Act 4 Restore and specialist Witchfire/Sunflare options; Remedy retains status-cure coverage while healing too.
- Fresh promoted recruits now receive the same innate skills as restored saves, before optional meta skills consume slots. Audited all production/harness creation paths; 30 class regression cases.
- Sleeping enemies cannot act/heal; heal apply revalidates uses, silence, sleep, life and range.
- Enemy target forecasts include imbue data.
- Guard identity/post survives pursuit; guards return when threats leave. At most one Cleric from Act 2 onward, never Act 1.
- Simulation max-meta seed 43 exposed greedy Manhattan pursuit stuck behind a wall. The map was reachable. ScriptedAgent now uses real paths, with a wall-detour regression; unchanged-budget rerun and the 15-run none/mid/max sweep have no timeouts. The sweep's defeats demonstrate that these checks are stability coverage, not a claim of easy player balance.

## Browser-testing pause

Dave requested browser playtesting stop during the final review because it disrupts computer use. All browser runs were stopped; no further browser testing or upload will occur before check-in.

Completed earlier: phone seen-dialogue/default-off/variant/critical-story checks, Act 2 real healer phase, Act 1 guard return + Menu/Resume, enemy level-up checkpoint, Records and hold-speed checks. Remaining after check-in: corrected Act 3 guard case (interrupted), final Hit-rating layout/forecast parity, combined presentation bundle, broader target-selection/healer pacing. Physical-phone safe-area/audio/storage/performance checks remain outside automation.

## Prior non-browser verification (superseded for release readiness)

- 5,443 unit tests / 319 files passed.
- 165 harness tests passed, including 56 journey contracts, calibrated failures and replay checks.
- All four PR full-run slices passed with unchanged thresholds; separate 15-run none/mid/max samples completed without timeout or invalid shop stock.
- Production build, data/schema/parity, reference/theme checks passed; lint has zero errors and 310 existing warnings.
- The first five-minute soak exposed harness-only memory retention in Vitest spy histories/registered per-scene mocks. Replaced unnecessary per-scene spies with counters and clear call histories in journey finalization; success/failure retention regression passes. The normal-memory-limit five-minute rerun passed: **6,387 fresh seeded journeys, zero failures, 300.03 seconds**. Final heap 194 MB, peak 346 MB, late-run GC minima about 95 MB. Log: `/tmp/journey-memory-fixed-soak.log`; seed/coverage samples: `/tmp/journey-memory-fixed-soak/soak-summary.json`.

No browser testing has resumed. No upload has occurred.

Meta sampling reproduction: Normal seeds 42–46 at no upgrades, floor-half levels of every upgrade, and max levels; all unlock milestones available, max assigns Pavise to Edric and Renewal to Sera through the real assignment API. Uses real RunSimulationDriver with ScriptedAgent and the normal action budget, no invincibility. The final sample had 15 ordinary defeats and zero timeouts/exceptions; max-meta progressed substantially farther. This sample is too small and the agent too simple to infer human win rates.

## Follow-up review resolution

R1–R10 are fixed and R11–R15 dispositions are recorded in [slice-review-resolution-2026-09-21.md](slice-review-resolution-2026-09-21.md). Fresh combined non-browser suite: 5,667 tests / 339 files; all four PR simulation slices, production build, data/reference/theme gates pass; lint 0 errors / 309 warnings. Earlier unit-only counts are historical and use a narrower scope. Browser verification and upload remain held; do not treat code completion as device/release certification.
