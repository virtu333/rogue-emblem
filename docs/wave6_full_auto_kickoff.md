# Wave 6 Full-Auto Kickoff

## Status Note (Feb 11, 2026)
1. Wave 6 core plus telemetry integration is merged on `main`.
2. This kickoff doc is retained as historical planning/contract context for replayability and audit trail.
3. Baseline-failure notes in this document refer to pre-merge in-flight state and should not be treated as current `main` status.

## 1. Scope
1. This document defines implementation readiness for a new Codex instance operating full-auto across harness and Wave 2/Wave 6 workflows.
2. Scope is limited to automation setup, coordination, contracts, sequencing, and acceptance gates.
3. This document does not expand into unrelated systems or risk domains.

## 2. Objectives
1. Establish a Codex instance configured for autonomous operation across harness and Wave 2 components.
2. Define sequencing and branch strategy for parallel workflows.
3. Define integration points for data sync and error handling.
4. Define a coordination protocol to prevent conflicts between simultaneous agents.
5. Define acceptance criteria for automated success and error detection.
6. Define weekly stakeholder update cadence.

## 3. Constraints
1. Maintain read-only access to sensitive data sources in initial rollout.
2. Use engine-level integrations over scene-specific hacks.
3. Preserve deterministic behavior for seeded flows and replay surfaces.
4. Keep shared contract changes additive, documented, and backward-compatible during rollout.

## 4. Current Baseline
1. Run-state serialization and migration patterns exist in `src/engine/RunManager.js`.
2. Headless deterministic harness surfaces exist in `tests/harness/GameDriver.js` and `tests/harness/HeadlessBattle.js`.
3. Data ingestion surface exists in `src/engine/DataLoader.js`.
4. Current test baseline is not fully green because `tests/AIController.test.js` has active failures tied to in-flight Wave 2 AI changes.
5. Wave 6 merge gates must enforce no additional regressions beyond current known baseline until Wave 2 baseline is stabilized.

## 5. Sequencing Plan
1. Phase 0 Contract Freeze.
2. Phase 1 Core data and runtime plumbing.
3. Phase 2 Modifier application at stable engine seams.
4. Phase 3 Minimal UX surfaces.
5. Phase 4 Determinism and compatibility tests.
6. Phase 5 Stabilization and handoff.

## 6. Branch Strategy
1. Primary Wave 6 branch is `agent/wave6-blessings`.
2. Rebase daily on `main`.
3. Merge small PRs in this order.
4. PR1 is schema and loader.
5. PR2 is run-state and migration.
6. PR3 is battle and reward integration.
7. PR4 is UI readouts and telemetry.
8. PR5 is balancing and config polish.
9. Merge is blocked unless tests and compatibility gates pass.
10. If Wave 2 conflicts are frequent, use a thin adapter module and keep Wave 6 logic behind it.

## 7. Integration Points
1. Data schema and validation.
2. Save/load schema additions and migration.
3. Run initialization hook.
4. Battle initialization hook.
5. Reward and economy hook.
6. Deterministic RNG hook path.
7. Harness replay metadata compatibility.
8. Error reporting hook to centralized alerts.

## 8. Shared-Contract Rules
1. Do not change harness action schema.
2. Treat Wave 2 map generation, AI behavior, and fog behavior as external input surfaces.
3. Any combat or reward context shape changes must be additive and documented.
4. If a breaking contract change is unavoidable, update docs and provide a compatibility shim in the same PR.

## 9. Blessings Implementation Rules
1. Data-driven first.
2. Each blessing is config, not custom one-off code.
3. Stacking rules are explicit and deterministic.
4. Conflict resolution is deterministic and documented.
5. Clamp and cap behavior is explicit and documented.
6. Modifier order is fixed as base, meta, difficulty, blessings, temporary combat effects.
7. Procs and random rolls must use seeded RNG paths only.
8. Blessing application must be centralized rather than scattered checks.

## 10. Coordination Protocol
1. Every agent posts status updates at workflow step start and completion.
2. Every shared-surface change is announced before implementation starts.
3. Conflicts trigger predefined escalation path and temporary halt on conflicting merges.
4. Daily log review is required for transparency and auditability.
5. Merge order follows contract dependency order rather than completion timestamp.

## 11. Acceptance Criteria
1. Blessings persist across save/load and migrate older saves safely.
2. Same seed and same blessing loadout produce deterministic repeated outcomes.
3. Existing suite passes or remains at known baseline with zero new failures.
4. New blessing tests cover schema validation, stacking, precedence, migration, serialization, and single-application guarantees.
5. Harness compatibility and Wave 2 gameplay flow compatibility are preserved.
6. Parallel agents show non-interference via logs and performance metrics.
7. End-to-end automated workflow completes without manual intervention.

## 12. Weekly Cadence
1. Monday is planning and priority setting.
2. Wednesday is midweek status sync and troubleshooting.
3. Friday is comprehensive review, blocker closure, and next-step commitment.

## 13. Starter Prompt For New Full-Auto Instance
1. You are initializing a Codex instance for full automation of harness tests and Wave 2 plus Wave 6 workflows in parallel.
2. Assume read-only handling for sensitive data sources and preserve safe defaults.
3. Implement Wave 6 Blessings as an engine-layer, data-driven modifier system with deterministic seeded behavior, additive save migration, and strong test coverage.
4. Orchestrate parallel workflows with strict branch strategy, rigorous test gates, and secured integration points.
5. Follow explicit coordination protocol for start and completion updates, conflict escalation, temporary halts, and transparent logs.
6. Use Monday, Wednesday, and Friday update cadence to report progress, unblock issues, and plan next steps.

## 14. No-Touch Boundaries
1. Wave 6 implementation must not edit Wave 2 in-flight files for AI and map logic.
2. Wave 6 implementation must not edit harness contract files under `tests/harness/` and `tests/agents/`.
3. Wave 6 PR scope should stay in blessing data, loader, run manager, and tests unless a documented compatibility shim is required.
4. Any boundary exception requires explicit note in the PR description with compatibility rationale.
