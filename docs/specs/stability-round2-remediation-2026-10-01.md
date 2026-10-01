# Stability round 2: remediation plan for #167, #168, #171, #172, #173 (2026-10-01)

Follows [the stability review response spec](https://github.com/virtu333/rogue-emblem/blob/docs/stability-review-response/docs/specs/stability-review-response-2026-09-30.md).
Each open draft got an independent review, and the stack also got a cross-PR integration review. The PR 5 design is in
`docs/specs/stability-pr5-combat-boundary.md`.

| Ref | Revision reviewed | Notes |
| --- | --- | --- |
| #168 | `5d02a165` | |
| #167 | `36dff238` | |
| #171 | `019f819e` | |
| #172 | `92cdf11c` | Stacked on #171 |
| #173 | `43c6dc0a` | Stacked on #171 |
| Stack | `8f5c568e` | `test/stability-stack-verification` |

Line numbers refer to the reviewed head of each PR. Use names when you implement.

## Summary

| PR | Verdict | Must fix before merge |
| --- | --- | --- |
| #168 phase guards | Ready to merge | None. One optional harness test. |
| #167 damaged saves | Close | N1 (logout breaks a pending archive), N2 (freed slot loses its cloud run), N3 (iOS export-attest), N4 (test) |
| #171 death cleanup | **Blocked** | B1 (kill attribution lost in normal play), chain depth reset in `init` (A1), unpinned guards |
| #173 session ownership | **Blocked** | A2 (paused scene counts as stale, which breaks Vision rewind), retry cost, required session params |
| #172 reclass/promotion | Not ready | Validation, a partial-failure replay, the unhandled picker promise, the graphic rebuild, the shared session predicate (A3) |

Two of the blockers break normal play. Neither was caught before review:
- **#171 B1:** with a pierce or splash kill that sets off a Deathburst, the kill loses its attribution (bounty gold, Zombie remains, deeds, victory timing).
- **#173 A2:** opening the battle history pauses the scene, which #173 treats as a dead session. Vision rewind then can't save, so a fallen commander can't be rewound and the run is lost.

#173 got no CI because CI only runs on PRs into `main`. Its browser specs fail 12 tests that pass on #171.

## Merge order

1. **#168**, now.
2. **#167**, after the fixes below. It is independent of the battle stack.
3. **#171**, after B1, A1 and the guard tests.
4. **#173**, rebased on merged #171, after A2 and the amendments. Split it if possible (see below).
5. **#172**, rebased on #173. Use `isCurrentBattleSession` instead of its local predicates (A3).
6. **PR 5**, using the design note, on top of #173.

## Process changes (do first)

- **CI on every PR.** Remove the `branches: [main]` filter from `pull_request` in `.github/workflows/ci.yml`, or add the stacked bases, so stacked drafts get the full lint, test, harness and e2e gates.
- **Verification branches are real merges.** `test/stability-stack-verification` is one hand-squashed commit; make it real merges of the PR heads. Before a stacked PR is marked ready, run the browser lanes that cover what it touches (for #173: `battle-history`, `contracts`, `presentation`, `run-flow`). Locally, Playwright needs `launchOptions.executablePath: '/opt/pw-browsers/chromium'`.
- **Every new guard ships with a test that fails when the guard is removed.** Three #171 guards, one #167 check and one #173 clone survived planted regressions this round.

---

## #171: settle battle deaths despite cosmetic failures

### B1 (blocker): the chain-end cleanup pass removes the defender before its attributed removal

`removeUnit`'s Deathburst `finally` (`BattleScene.js` ~9289–9298) runs `_sweepFallenUnits()` and `checkBattleEnd()` when `_deathAffixChainDepth` returns to 0. In `executeCombat` this happens inside `_runCombatResolution` (the `remove` beat for a third-party Deathburst victim). That is before `removeUnit(defender, { killer: attacker })` (~8476). The cleanup pass removes the 0-HP defender with `killer: null`, and the attributed call then returns early on the roster guard (~9100).

The reviewer reproduced this with #171's real-scene fixture:

| | main | #171 |
| --- | --- | --- |
| Gold | 672 | 372 (Bounty Hunter's Mark lost) |
| Zombie remains (Light kill) | 0 | 1, which revive and block Rout |

Also on #171:
- The kill deed is lost.
- History records "fell" instead of "defeated".
- When the defender was the last enemy, victory fires mid-resolution, before Phoenix and XP.

**Fix:** delete the cleanup pass and the `checkBattleEnd()` from the chain's `finally`.
- The cleanup pass can only find units that were already at 0 HP before the chain started; the victims loop skips them. Those are exactly the units an owner is about to remove with attribution.
- Every owner already runs the pass and then checks for battle end after its attributed removals: `executeCombat` (~8481), `executeEnemyCombat` including Entity splash (~10494, ~10512) and both catch paths.
- Ballista has no cleanup pass. Add `_sweepFallenUnits()` before its `checkBattleEnd()` (~9866 in the stack tree).
- Do not add a `_combatSettling` counter. It would be one more piece of state that can leak across sessions (see A1).
- With no `checkBattleEnd` left mid-chain, the `_deathAffixChainDepth > 0` early return in `checkBattleEnd` (~10697) can go. If it stays, reset the depth in `init`.

The chain-end `checkBattleEnd` combined with the HP-based commander check could also fire defeat or the Vision prompt before `_commanderKillerName` / `_fallenCommander` are set. The same deletion removes that path.

### A1 (blocker once #173 lands): chain depth leaks into the next session

Verified with a probe on the stack:
- `_deathAffixChainDepth` is incremented in `removeUnit` and decremented in its `finally`.
- Under #173, shutdown parks a chain waiting at its 150 ms tick, so the `finally` never runs.
- `init()` does not reset the counter. The next session (Resume, portrait re-open, crash resume) starts at depth 1, and `checkBattleEnd` never fires defeat or Rout victory.
- #173's tests miss it: one stubs `removeUnit`, and the other sets the depth after the restart.

**Fix:**
- Reset `_deathAffixChainDepth = 0` in `init` (or delete the counter with B1).
- Add the probe as a test: restart mid-chain, then the next session detects the commander's defeat.
- Audit `init` for every counter or flag that an async operation sets and its `finally` clears. A parked continuation never runs its `finally`, so `init` must reset that state.

### Required tests

- **Attribution through the real entry points.** Drive `executeCombat` / `executeEnemyCombat`, not `_runCombatResolution`. Use a pierce or Tier 5 splash kill that sets off a Deathburst, and assert independently derived values:
  - bounty gold;
  - a Zombie killed by Light leaves no remains;
  - the kill deed;
  - history says "defeated";
  - victory fires after Phoenix and XP.
- **Pin the guards that survived planted regressions:**
  - the chain-`finally` change (it now needs a test that a third-party chain doesn't remove the primary defender);
  - the `_removing = false` reset;
  - the depth early return, if kept.

### Should-fix

- **Ballista visuals** (~9733–9766): guard `updateHPBar`, `add.text` and the tween between `damageUnit` and `removeUnit`.
- **Telemetry.** `safeBattlePresentation` only calls `console.warn`. Report through `reportAsyncError('battle_presentation_failed', …)`, with a per-label rate limit: the per-tile fog guard can log about 400 warnings per update once overlays are destroyed.
- **`updateEnemyVisibility`:** guard per enemy, not around the whole loop.
- **Harness mirrors:** make the commander check in `HeadlessBattle.js:2066` and `tests/harness/Invariants.js:85,131` use HP, like `checkBattleEnd`.

---

## #173: guard battle continuations with their originating session

### A2 (blocker): a paused scene counts as a dead session

`isCurrentBattleSession` (`src/ui/BattleSession.js:8–16`) requires `sys.isActive()` or `settings.active`. `BattleHistorySession` pauses the battle scene, and Phaser's pause clears both. The rewind flow saves while the history session is still open, so `_persistBattleRunState` returns `stale_session` and "Rewind was not saved" loops. In the commander-fallen flow the player can't rewind at all.

Browser runs on #173:

| Spec | Failures |
| --- | --- |
| `rewind-any-action` | 5 of 7 |
| `rewind-action-types` | 3 |
| `battle-timeline` | 1 |
| `timeline-preview` | 2 |
| `battle-contracts:579` | 1 |

All pass on #171. `BattleSessionOwnership.test.js:379` asserts the broken behaviour.

**Fix:**
- Session identity is `session === scene._battleSession && !scene._sceneShutdownCleanedUp`; drop the `isActive` / `settings.active` clause. Phaser's restart runs stop then start synchronously, and the counter plus the cleanup flag already close that race. The clause only widened permission during `create`, so dropping it reopens nothing.
- `_awaitSceneDelay` / `_awaitSceneTween` / `_scheduleSafeDelayedAsync` and the lifecycle guard must tell a stale session (park) from a paused but current one (resolve or skip immediately, as before #173). A wait entered or timed out while paused must not park: a parked chain or enemy-phase tail would strand `_deathAffixChainDepth` or `_reinforcementsPendingThisTurn` for the rest of the session.
- Replace the `:379` assertion with a test that pauses through Phaser's real `SceneManager.pause`, and a rewind-while-history-is-open test that asserts the save succeeds.

### Should-fix

1. **Retry costs every save.** `retryCheckpoint` and `_checkpointPersistenceResult` have no production caller, yet every checkpoint now also runs `structuredClone(rm.toJSON())`.
   - Do `const json = rm.toJSON(); persist(json)`, and keep a deep-cloned retry candidate only when persisting fails. The clone is needed because `toJSON` shares `battleInProgress` by reference (`RunManager.js:69`).
   - Retry goes back through `saveRun` so `computeNextRunSavedAt` re-stamps it. Replaying the stored string could fall below a raised clock floor and would skip `lastRunSaveStamps`.
   - With the quota fallback, the most-trimmed candidate is the retry candidate. When a retry succeeds, adopt the trimmed `battleInProgress` and timeline in memory.
   - Add a test that fails if the clone is removed. That regression currently survives.
2. **Helpers sample the session at call time.** About 40 callers rely on defaults that read the current session: `completeBattleAction`, `captureResolvedAction`, `presentQueuedLevelUps`, `completeResolvedAction`, `finishUnitAction`, `_persistBattleRunState`, `_isSceneActiveForAsync`.
   - Make `session` a required parameter on every helper that can run after an await.
   - Synchronous callers pass `battleSession(scene)` explicitly, so the sampling is visible in review.
   - The spec forbids sampling defaults. No live bug was found, but nothing enforces the rule.
3. **Controllers capture their session at construction.** If old code recreates one lazily with `||=` after a restart, it gets the new session. Capture the session when each operation starts, or refuse `||=` creation when the caller's session is stale.
4. **Two predicates (A3).** `ReclassController.js:12` (`ended`) and `PromotionController.js:27` (`sceneEnded`) are separate copies of the session predicate. Once A2 changes `isCurrentBattleSession`, they diverge: `captureResolvedAction({ session })` succeeds while `sceneEnded` is still true, the flow returns without `finishUnitAction`, and the battle stays stuck in `COMBAT_RESOLVING`. Both must import `isCurrentBattleSession`. Fix it in #172; #173 alone doesn't cover promotion, so say so in its description.
5. **Cloud backup turns off silently (A5).** A background refetch can create a cloud conflict for the active slot, or storage can throw. Under #167, `protectedLocalSlot` then makes `pushRunSave` return silently, `saveRun` (`RunManager.js:5285`) still returns `{ ok: true }`, and #173's status reports "persisted" while cloud backup is off for the session.
   - Have `pushRunSave` return `{ queued: false, reason: 'protected_slot' }`.
   - Have `saveRun` return `{ ok: true, cloud }`.
   - Report it once per slot.
6. **Merge with #168.** It has two textual conflicts (`BattleActionCompletion.js:50–59`, `BattlePresentationCheckpoint.js:153–160`). The stack's resolution is correct: a stale session returns before `unitActed` / `checkPlayerPhaseComplete`.

### Nits

- About 15 guards at the end of functions do nothing (e.g. `BattleScene.js:2287, 9947, 10745`).
- `PostCombatController` repeats checks (`:136–137, 289–290, 315–316, 341–342, 904–905`).
- Returns mix `false` and `undefined`.

### Suggested split

| Part | Contents |
| --- | --- |
| (a) | `BattleSession`, wait parking, gating of the checkpoint / complete / recover helpers, the A2 fix, the A1 restart test |
| (b) | The controller and direct-UI sweep, with required session params |
| (c) | Retry and structured status, at zero cost on success |

Land (a) first.

---

## #172: commit reclass and promotion before animation

1. **Reclass validation is incomplete** (`ReclassController.js:28–34`). The reviewer ran each of these:
   - A null target class burns the seal and changes nothing.
   - An Infantry Seal works on a Cavalier.
   - A Master Seal works as a reclass seal.

   Only the picker UI prevents these. **Fix:**
   - require `seal.effect === 'reclass'` and that `newClassData` is in `getReclassTargets(unit, classes, seal.subEffect)`;
   - re-check the seal's `uses` and that it is still in the unit's consumables (both already checked).
2. **A partial failure leaves a free, repeatable reclass.**
   - `reclassUnit` (`UnitManager.js` ~1543–1551) sets `className` before its weapon step, and the controller counts the change as applied only after the call returns.
   - A throw (verified with `inventory = null`) leaves the class changed and the seal unspent, and the menu offers reclass again.
   - There is also a reverse bug: `applied = true` is set even when `reclassUnit` returned without doing anything. That is item 1's burned seal.
   - `reclassUnit` mutates too much shared state to rebuild as compute-then-assign without a refactor:
     - stats in place;
     - `traitAttackStat`, `currentHP` and growths;
     - class fields through `normalizeUnitClassState`;
     - weapon and inventory order;
     - skills, through `learnSkill`.
   - No rollback helper exists.

   **Fix:**
   - `reclassUnit` checks its inputs and returns `null` before any mutation: `inventory` and `proficiencies` are arrays, `stats` exists, and the target is a legal reclass target. Those cover the throw sites in `getCombatWeapons` / `canEquip`.
   - The controller treats `null` as nothing applied.
   - Any later throw goes through the post-commit recovery path, which settles once, keeps the seal spent and does not show the menu again.
3. **The picker promise is unhandled.** `BattleScene.js:7555` calls `this.executeReclass(...)` without awaiting or catching it. Add `.catch((err) => reportAsyncError('reclass_failed', err, …))`.
4. **A failed sprite refresh leaves a broken unit.**
   - `removeUnitGraphic` runs before `addUnitGraphic`. If the add throws, `unit.graphic` or `unit.hpBar` is null.
   - `updateHPBar` (~3388) and `updateUnitPosition` (~3374) then throw on the next heal, move or hover.
   - **Fix:**
     - build the new graphic before destroying the old one;
     - make both functions null-safe;
     - keep the `registerBattleEntity` call in `addUnitGraphic` on every path.
5. **Shared session predicate (A3).** Replace `ended` / `sceneEnded` with `isCurrentBattleSession` once #173 lands.
6. **Nits:**
   - Undefined `uses` is rejected at entry but treated as `?? 1` elsewhere (`PromotionController.js:101, 200`). Pick one.
   - A silent `return false` leaves the picker open with no feedback.
   - `observeHistoryAction` runs before the capture, so if it throws, recovery runs but the old sprite stays.

---

## #167: preserve damaged save slots

All seven round-1 findings are fixed. Remaining:

- **N2 (should-fix): freeing a slot loses its healthy cloud run.**
  - After Free, the slot looks empty. A new game's `clearSavedRun` calls `deleteRunSave` (`CloudSync.js:385`), which has no protection check. Its callers are `BlessingSelectScene:180`, `NodeMapScene:1046`, `RunCompleteScene:68` and `TransitionRecoveryController:123/264`.
  - Even without that delete, the new game's first `pushRunSave` overwrites the cloud row: `savedAt = now` wins, and `updateSlotInTable` only rejects a newer remote.
  - The dialog says "Cloud saves are kept" (`SlotRecoveryDialog.js:215`).
  - **Fix:**
    - Free keeps the slot reserved as "cloud copy pending" until a cloud fetch has applied or cleared it. The marker key must be registered in `inspectSlot`, `getSlotDataKeys` and `clearAllSlotData`.
    - When online, hydrate that slot right after Free.
    - Independently, `deleteRunSave` deletes a cloud run only when its `runRecordId` matches the local run being cleared. No local run means no cloud delete. Every abandon caller has a local run.
    - If any of this is deferred, correct the dialog copy.
- **N1 (should-fix): logout breaks a pending archive.**
  - `prepareRecoveryLogout` writes the owner-marker key (`SlotManager.js:459`) into a slot whose pending archive recorded that key as absent.
  - Discard then fails with "changed after archived". After `discardStarted`, discard, retake and Free are all refused. This was verified by running it.
  - Excluding the owner key from the change check is not enough: `archiveAndDiscardSlot` would then delete the live marker while the archive says `null`, leaving the slot unassigned so another account can retire it.
  - **Fix:** before writing `discardStarted`, fold the current owner marker into `archive.values[ownerKey]`, as `discardExportedSlot` already does. Then exclude the owner key from the change check and delete it last.
- **N3 (should-fix): export-then-discard is unsafe on iOS.**
  - The export is a blob `download` link, which the iOS web view ignores, yet "I verified the export; discard local data" still removes every key without the on-disk check.
  - It is also the only way out of an archive over 1 MB (`SlotRecovery.js:15`).
  - **Fix:** hide it on native, or route the export through the Share or Filesystem plugin. On native, an oversize archive keeps the slot reserved and offers Keep only.
- **N4 (test):** retake's "original key already removed" check (`SlotRecovery.js:95`) is untested; removing it left 197 tests green. Add a test for a native copy that kept the archive without `discardStarted` after the key removals reached disk.
- **Nits:**
  - **Retake:** it overwrites the original bytes with no warning. Keep them, or confirm first.
  - **Logout on iOS:** it is blocked for good when the device-backup mirror is unavailable (`TitleScene.js:412`). Offer an explicit "recovery data stays on this device" confirmation instead.
  - **Cross-account discard:** account B can discard account A's recovery data. Document the decision.
  - **Silent backup stop:** a background-refetch conflict turns cloud backup off for the slot for the session without telling anyone (see A5).

## #168: phase guards

Ready to merge. Optional: pin `HeadlessBattle.js:1954`'s removed-actor branch in the harness. Reverting it there leaves all 195 harness tests green.

---

## Spec amendments

**WS6 forward staging:**

| Issue | Change |
| --- | --- |
| Key name | #167 already reserves `emblem_rogue_slot_N_pair_journal` as recovery-required (`SlotManager.js:36`). Reuse it, or register the new key in `inspectSlot`, `hasSlotRecoveryRecord`, `getSlotDataKeys` and `clearAllSlotData`. One staging key per slot. |
| Conflict record | `preserveCloudConflict` reads `localMeta` from storage at call time (`CloudSaveConflict.js:44`), so under meta-first ordering it would capture the new progression. Build the record from the raw pre-apply values, inside the stage. Its existing-record branch (`:30–36`) also silently drops a second displaced run. |
| Self-tripping gate | #167 skips any slot with a conflict key, so a staged apply that writes the conflict, run and progression together would block itself. Define the order or exempt the stage. |
| Native mirror | `planRestore` (`nativeSaveMirror.js:208–214`) replaces a canonical key with its native record when that record's `savedAt` is newer. Stamp the candidate no lower than the native stamp, or the next launch undoes it. Keep the staging key out of the mirror (`shouldMirrorKey`). |
| Re-apply | "Newer canonical data: retain and defer" can lock a slot. If canonical equals or supersedes the candidate, drop the stage silently. |
| Second pair writer | `resolveCloudSaveConflict` (`:54–110`) writes run then progression with a best-effort undo. Put it back in scope. |
| Account | Tag the stage with the user, and handle it at logout. |
| Placement | Recovery runs after `nativeSavesReady` and before the cloud pull and Title, offline too. It can't live in `fetchAllToLocalStorage`, which returns early without Supabase (`CloudSync.js:214`). |
| Deferral | `getActiveSlot()` is persisted and never cleared. Define the boundary as an in-memory "managers bound" registry, keep deferred data in memory only, and re-trigger it at that boundary; `backgroundCloudRefetch` stops after one success. |
| Quota | Either allow `setItemFreeingSpace` for the stage write (and say it sheds only valid slots' history) or drop "without changing canonical data". They contradict. |
| Scope | Guarantee 4 holds for localStorage. When the store is evicted, the canonical keys restore from native with no stage evidence. Say so. |

**Progress section:**
- Add #171's verification numbers.
- "Prevent a second action from overwriting the retry state" isn't implemented: the next capture replaces the retry candidate and retry returns `checkpoint_replaced`. Either implement it or state that the latest checkpoint wins.
- Assign the retry UI to a PR.
- Note that the stack branch is one squash commit.

**Guarantee 1:** require RNG equality only for fixed-v1. Legacy battles keep the order of the settlement draws, but their canvas text still draws from the battle stream, so their cursor is compared only between live play and resume on one build.

**Entity splash:** owned by #171, which is done. Remove it from PR 6, and have the PR 5 matrix only add an Entity scenario.

**Teleporter (PR 5):** see the design note. Use `event.targetHPAfter` for whether the target is still alive, draw only when there are candidates, and settle the warp before post-combat effects.

## Acceptance for this round

- The rewind and timeline browser specs that failed on #173 pass. The rewind-while-history-is-open and real-pause unit tests pass.
- The B1 attribution test passes through `executeCombat` / `executeEnemyCombat`. Restoring the chain-`finally` cleanup pass makes it fail.
- The A1 restart-mid-chain test passes. Removing the `init` reset makes it fail.
- On #167, these tests pass and each fails when its fix is reverted:
  - N1: the logout → discard path, including after `discardStarted`;
  - N2: Free → new game keeps the cloud run;
  - N4: the retake check.
- The reclass validation and partial-failure tests pass, and the picker rejection is reported.
- CI runs on every stacked PR, and the browser lanes above are green on each.
