# Stability round-four remediation — 2026-10-01

The latest review was checked against the published heads. Fixes retain the existing controllers and storage keys. Ready PRs merge into main with merge commits; a changed head needs its own checks. #174, #168, #171, #173 and #175 have merged. #172, #176 and #177 precede #178; #167 must also precede #178 for cloud-protection telemetry.

| PR | Remediation | Evidence |
| --- | --- | --- |
| #171 | Existing immediate commander/empty-field defeat decision and attributed cleanup retained | Revised head passed CI and merged as `f5d50165`; included in the integrated unit run |
| #173 | Log omitted checkpoint origins; statically require explicit origin identifiers at every production capture call; reject fatal/defeat/battle-end retries | 107 focused tests; 21 author-run mutations detected; real enemy completion persists acted state; CI passed and merged as `5f2dcc8c` |
| #172 | Inventory Master Seal observes promotion rejection as the command path does | Actual inventory-row regression and catch-removal mutation; new catch preserved through the PR 6a rewrite |
| #175 | Independent HP/gold expectations supplement same-build live/resume equality | Both policies retain attacker HP 20, defender HP 10, gold 0 and Teleporter destination (4,4); matrix/fog/origin tests pass; CI passed and merged as `473ab6c5` |
| #167 | Authentication failure defers reserved slots while hydrating unrelated slots/settings; both startup paths schedule deferred refetch; release an orphan owner without deleting live/cloud bytes | 289 focused tests plus the 22-test API-shape suite; ten author-run mutations; independent 163-test review and native stale-ack probe; 640×480 native presentation adapter browser flow |
| #176 | Pin healing, use cost and restored weapon in actual durable JSON at first healing FX; keep second HealAll selection legal to isolate re-entry rejection; correct Canto save contract | 44 focused tests; weapon/re-entry mutations detected; actual saved-JSON Resume enters a newer session and preserves one village reward and Vision destination |
| #177 | Observe and independently latch the first actual action effect; reject invalid harness Talk | 130 focused utility/headless tests; premature-effect and invalid-Talk mutations detected; independent review reran 17 focused cases |
| #178 | Rejected Retry resolves an exit as Stay; hide Retry without a candidate; retain full frozen history after failed quota trimming | 256 focused tests, 8 real Chromium cases and seven author-run mutations; direct durable-writer hook, consecutive gates, production capture routing and a genuine consumable/retry/exit flow |

The independent #167 review found two additional gaps in the initial fixes. Deferred-only hydration results were handled inside the retry loop but did not start it at login/startup. Both actual call-site predicates are now tested. Failed native acknowledgement rollback now requires the same active dialog, unchanged canonical/evidence bytes, and unchanged empty marker keys. Cancellation, scene replacement, a newer save or replacement recovery data retire the old rollback authority.

Retry uses the latest installed checkpoint. A failed quota attempt retains the full frozen candidate; only a successful trimmed write changes live history. Retrying never recaptures, reseeds RNG, applies an effect/cost again or adds a timeline entry. A durable local write clears local degradation even when cloud backup is offline or protected. Terminal decisions always win over retry/exit.

## Reproducible verification

The post-fix source and tests are published at [integration source `40b31158`](https://github.com/virtu333/rogue-emblem/commit/40b31158e3a3476bf620f145ac95deb13d513b14), tree `18ea1d85aa8a39838d0551b0d8ec9042c9dd4aa9`. Local runs used a checkout with that identical tree. PR #178 additionally carries documentation corrections and a test-only Canto gesture-readiness improvement; gameplay code is unchanged by those follow-ups. No implementation fix is left only on the verification branch once #178 is published.

| Local check | Result | Scope |
| --- | --- | --- |
| Unit | 581 files / 9,540 tests passed | Two workers, all revised battle/save source integrated |
| Harness | 14 files / 248 tests passed | Includes real BattleScene save-retry journey and headless invalid Talk |
| Simulation | 9 files / 41 tests passed | Simulation test suite |
| Staff/consumable contracts | All three updated Canto cases passed | Actual durable JSON, newer-session Resume, restored equipment, fog, one reward and destination |
| Retry browser | 8 cases passed | Actual action, quota failure, unsuccessful/successful Retry and Save & Exit; rejected exit recovery |
| Reservation browser | 1 case passed | Native presentation adapter, actual orphan-owner cleanup failure, 640×480 warned release |
| Full contracts before gesture-readiness follow-up | 74/76 passed | Both failures investigated; never represented as a green full lane |

The Canto Danger fixture could click Wait while the completed hold's release-click guard was still installed. The follow-up waits for actual guard removal and the current HUD menu, preserving PLAYER_IDLE completion and pinned-danger assertions. It passed three repetitions. The separate mobile-shell drag/tap failure reproduces on main `f5d50165` using the same Chromium and harness; it is recorded as a baseline issue, not silently waived as passing. Revised-head GitHub CI is checked separately from these local results.

Historical round-three totals were obtained at unpublished local checkout `4df5e656`. [Published `4e54ff267`](https://github.com/virtu333/rogue-emblem/commit/4e54ff26706819ae4c179197a4f6a48810276e7a) reproduces the equivalent source/tests, differing in documentation and ancestry. Those totals remain historical local execution reports; they are not CI results for that hash.

Physical iOS acknowledgement, WebKit and live Supabase recovery are not covered by native adapters or mocked transport tests. Same-build legacy continuity and fixed-v1 presentation invariance are distinct guarantees; cross-build save compatibility needs a migration test. Construction-time controller origins remain a disclosed broader API follow-up. PR 7 forward-staged pair hydration and PR 8 computed combat outcomes remain separate work.
