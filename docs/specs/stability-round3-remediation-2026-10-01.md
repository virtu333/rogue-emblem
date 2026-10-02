# Stability round-three remediation — 2026-10-01

This implements the user-provided re-review and PR 6 design. Review findings are evidence to check against the source; individual green CI runs do not replace the missing scenarios. Original review comments were not posted to GitHub.

| PR | Required work | Release dependency |
| --- | --- | --- |
| #174 | Existing minimal any-base CI trigger; optional concurrency deferred | Merged (`ddf7cc93`); any-base CI enabled |
| #168 | Existing guarded phase completion is sound | Merged; carry Escape checkPlayerPhaseComplete through conflicts |
| #171 | Decide commander/empty-player-field defeat immediately after attributed owner cleanup, before boss/level-up presentation or a commanderless save; retain attribution. Pin removed chain-end decision. Rate limit by label and error name. | Reconcile main; targeted and integrated checks |
| #173 | Enforce six missing-origin contracts using real run state/storage. Pin loot, recruit, death-fade, Ballista and XP continuations; check session before graphic cleanup. | Updated #171/main; construction-only origin limitation disclosed |
| #172 | Observe Promote promise; releaseUnit failure cannot skip old-graphic disposal. Pin both controller wiring, real missing-uses validation and history errors. | Updated #173 |
| #175 | Explicit matrix timeout, real fog refresh, genuine serialized same-build resume cases; correct equivalent mutant and base claims | Updated #173; verify with #172 |
| #167 | S1 warned reservation-release exit; S2 authenticated identity before absence; S3 local-delete/archive/abandon guards pinned; S4 empty canonical slot and overlap-safe native hydration. Preserve raw evidence and cloud on release. | Independent save branch; browser/native-adapter tests |
| 6a | Staff and supported consumables settle targets/cost/equipment/XP before capture and presentation; shared wrapper and proxy | Corrected #175 |
| 6b | Movement/ability/recruit/Dance settlement, double-tap rejection, Ballista damage before shot | 6a |
| #178 (6c) | Frozen save retry, exact gates, explicit degraded/exit choices, 640×480 and phone layout | 6b |

Merge order: #174/#168, #171, #173, #172, #175; #167 after S1–S4 independently. Main integration must retain phase-completion checks for absent/dead actors and Escape, plus originating-session checks. Round-three branch publication and CI are tracked at the exact published heads.

PR 6 decisions are accepted in `stability-pr6-action-settlement.md`: Talk commits recruitment before its ceremony; Keep playing acknowledges last-durable-checkpoint recovery; no mid-battle player-data deletion button; fixed-v1 presentation invariance, same-build legacy stream continuity, no untested cross-build parity claim. Unexpected domain throws report and finish once using existing partial-settlement recovery; transactionality remains PR 8.

PR 7 uses one forward stage key per slot. A foreign/ambiguous newer canonical pair retains evidence and defers; an equal or proven superseding pair permits stage retirement only after sole raw evidence is safely archived elsewhere. Timestamps alone cannot prove compatible progression. Native excludes stage mirroring and recovery planning; canonical timestamps respect native floors.

Verification entries below distinguish targeted tests, integrated local runs, individual-head CI and physical-device checks. Mutation records identify each edit and failing assertion; reported counts are not independent audits.

## Final local integration verification

PR 6a staff/consumables is published as #176 and PR 6b movement/abilities as #177. Save retry (6c) is #178. The local combined branch uses actual merges of the corrected battle stack, #172 and #167; the historical local run used unpublished checkout `4df5e656`. Reproducible equivalent source and tests are available at [published equivalent source/tests `4e54ff267`](https://github.com/virtu333/rogue-emblem/commit/4e54ff26706819ae4c179197a4f6a48810276e7a). That published revision differs only in documentation and ancestry; the historical totals below are local execution reports, not CI results for that published hash.

| Check | Final result | Scope |
| --- | --- | --- |
| Full unit | 579 files / 9,509 tests passed | Combined battle, class-change and save-recovery source; two workers |
| Full harness | 14 files / 226 tests passed | Journey persistence/combat and headless parity; exact local result and optional offline cloud status |
| Simulation tests | 9 files / 41 tests passed | `test:sim`; the strict PR fuzz/full-run suites are listed separately below |
| Battle/action/retry Chromium | 42 unique cases passed, no retries | Real Chromium 145, Vite and assets; committed refresh, rewind, staff/recruit, paused sessions and retry/exit |
| Strict PR harness fuzz | 50 runs passed, no errors/timeouts | Preset PR scenarios |
| Strict full-run PR slices | 4 slices / 42 runs passed, no stuck cases/timeouts | Pressure normal/hard, progression and ambush; expected defeats are allowed |
| Production build | Passed; 258 packaged audio files verified | Full asset checkout, 13.45 seconds |
| Content/reference checks | Passed | Data, audio, UI, references, sprites and e2e lane coverage |
| Full lint | 0 errors / 364 existing warnings | No new lint errors; this is not a warning-free repository claim |
| Slot-picker Chromium | 9 cases passed | Damaged saves and reservation recovery |
| Independent review | 185 targeted tests reported passing | Adversarial battle/save review; targeted evidence, not a full-suite coverage claim |

The first full unit run found 16 failures in eight older test files. Each was checked against the production contract. Fixtures now supply living roster members, owned skills, legal adjacent targets and synchronous domain XP; the Measured Step test uses a supported healing item and also asserts its HP gain and cost. Portrait asserts the explicit origin and `progress:false`. The old consumable Canto test asserted a refund that conflicts with settlement-before-presentation; it now checks the actual serialized settled HP/use, finish continuation, original position, remaining Canto and unchanged fog. These changes retain the relevant gameplay assertions and strengthen action acceptance/completion checks.

Save-retry review caught two presentation/terminal defects: a throwing repaint could strand Retry, and successful save-exit awaits could steal a terminal decision. Retry now keeps its gate until the writer returns, even when the repaint fails; constructor failures independently release partial input/overlay/DOM ownership. Save & Exit checks the originating session and terminal decision before and after its await. Real menu-construction faults and both save outcomes are tested. Reintroducing the repaint and save-exit defects fails the corresponding assertions.

The latest installed checkpoint wins; a stale candidate cannot overwrite newly advanced gameplay. Retry never replays costs, captures another boundary or reseeds RNG. A durable local save with offline/protected cloud backup clears the local retry indication. Keep playing acknowledges the bounded last-durable-save exception on refresh or crash.

These are local results, not CI on the combined branch. CI is queued for the newly published heads. The PR-only change-size note check was skipped outside a PR context; it is not counted as a passed gate. Desktop 640×480 and phone landscape/portrait retry layouts were visually checked. Physical iOS/WebKit and cross-build resume parity remain unverified. Construction-time controller origin propagation remains the disclosed API follow-up. PR 7 forward-staged pair recovery and PR 8 computed combat outcomes remain separate work.
