# Stability round-three remediation — 2026-10-01

This implements the user-provided re-review and PR 6 design. Review findings are evidence to check against the source; individual green CI runs do not replace the missing scenarios. Original review comments were not posted to GitHub.

| PR | Required work | Release dependency |
| --- | --- | --- |
| #174 | Existing minimal any-base CI trigger; optional concurrency deferred | Merge approval; existing CI green |
| #168 | Existing guarded phase completion is sound | Merged; carry Escape checkPlayerPhaseComplete through conflicts |
| #171 | Decide commander/empty-player-field defeat immediately after attributed owner cleanup, before boss/level-up presentation or a commanderless save; retain attribution. Pin removed chain-end decision. Rate limit by label and error name. | Reconcile main; targeted and integrated checks |
| #173 | Enforce six missing-origin contracts using real run state/storage. Pin loot, recruit, death-fade, Ballista and XP continuations; check session before graphic cleanup. | Updated #171/main; construction-only origin limitation disclosed |
| #172 | Observe Promote promise; releaseUnit failure cannot skip old-graphic disposal. Pin both controller wiring, real missing-uses validation and history errors. | Updated #173 |
| #175 | Explicit matrix timeout, real fog refresh, genuine serialized same-build resume cases; correct equivalent mutant and base claims | Updated #173; verify with #172 |
| #167 | S1 warned reservation-release exit; S2 authenticated identity before absence; S3 local-delete/archive/abandon guards pinned; S4 empty canonical slot and overlap-safe native hydration. Preserve raw evidence and cloud on release. | Independent save branch; browser/native-adapter tests |
| 6a | Staff and supported consumables settle targets/cost/equipment/XP before capture and presentation; shared wrapper and proxy | Corrected #175 |
| 6b | Movement/ability/recruit/Dance settlement, double-tap rejection, Ballista damage before shot | 6a |
| 6c | Frozen save retry, exact gates, explicit degraded/exit choices, 640×480 and phone layout | 6b |

Merge order: #174/#168, #171, #173, #172, #175; #167 after S1–S4 independently. Main integration must retain phase-completion checks for absent/dead actors and Escape, plus originating-session checks. Round-three branch publication and CI are tracked at the exact published heads.

PR 6 decisions are accepted in `stability-pr6-action-settlement.md`: Talk commits recruitment before its ceremony; Keep playing acknowledges last-durable-checkpoint recovery; no mid-battle player-data deletion button; fixed-v1 presentation invariance, same-build legacy stream continuity, no untested cross-build parity claim. Unexpected domain throws report and finish once using existing partial-settlement recovery; transactionality remains PR 8.

PR 7 uses one forward stage key per slot. A foreign/ambiguous newer canonical pair retains evidence and defers; an equal or proven superseding pair permits stage retirement only after sole raw evidence is safely archived elsewhere. Timestamps alone cannot prove compatible progression. Native excludes stage mirroring and recovery planning; canonical timestamps respect native floors.

Verification entries below distinguish targeted tests, integrated local runs, individual-head CI and physical-device checks. Mutation records identify each edit and failing assertion; reported counts are not independent audits.
