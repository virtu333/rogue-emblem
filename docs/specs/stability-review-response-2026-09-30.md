# Stability review response: validated findings and implementation spec (2026-09-30)

An external source review of `main` at `1a6e2d0` reported five defects in how actions commit,
how saves persist and how the scene lifecycle ends. This document checks every claim against
`main` at `97c8308`. Of the files involved, only `BattleScene.js` changed between the two
commits, and the lines at issue did not move. It then sets out an implementation plan in the
order the work should land.

Each claim was traced in source. Most were also reproduced with stubbed vitest probes, which
were deleted afterwards. Line numbers refer to `97c8308`.

## 1. Verdict summary

| # | Review claim | Review severity | Verdict | Our severity | Corrections |
|---|---|---|---|---|---|
| 1 | Reading a slot with corrupt meta deletes the whole slot | High | **Confirmed** | Medium (rare trigger, total loss) | Only unparseable or non-object meta triggers it; `{}` passes. Local keys only; the cloud rows survive. The behaviour is deliberate and pinned by tests. |
| 2 | Reclass can softlock after committing | High | **Confirmed** (probe) | Medium | A realistic trigger is a synchronous throw. The awaited banner cannot reject (see §2.3). The same function also continues after shutdown. |
| 3a | Combat can persist a partly applied exchange | High | **Confirmed** (probe) | Medium | Strikes write HP as each one lands (`_showStrikeResult`, `BattleScene.js:8764`), so a throw loses the rest of the exchange, not all of it. The catch discards the replay intent and saves a checkpoint. |
| 3b | Heal and consumables apply the effect before charging the cost | High | **Confirmed** (probe) | Medium | Also leaves the staff equipped: `restoreCombatWeapon` never runs. `executeHealAll` has no re-entry guard. |
| 3c | Post-combat beats can abort the remaining gameplay | (part of 3) | **Confirmed, worse than stated** | Medium–High | A cosmetic throw before a splash or pierce `remove` beat leaves a 0-HP enemy in `enemyUnits`. The catch only reconciles the attacker and defender, and `checkBattleEnd` counts `enemyUnits.length`. That can block a Rout victory. |
| 4 | Cancelling a lifecycle await looks like completion; stale continuations run | Medium–High | **Confirmed mechanism; no current player path** | Low–Medium (latent) | Orientation switch and Save & Exit only fire at `PLAYER_IDLE` (`canSwitchBattlePresentation`, `utils/portraitBattle.js:190`; `showPauseMenu` gating). Pending timers are removed at shutdown. The gap is continuations already in flight, and every liveness flag the scene has cannot tell a restart apart (§5.1). |
| 4b | TurnManager accepts repeated transitions | (hardening) | **Confirmed** (probe) | Low | A double `endEnemyPhase` skips a turn; a stale `unitActed` in the enemy phase fires the enemy phase twice. No normal-play reproduction. |
| 5 | Cloud hydration writes run and meta without atomicity | Medium | **Confirmed** (probe) | Low–Medium | A failed run write already skips that slot's meta (`skipped` set, `CloudSync.js:111-158`). The open cases are run-applied-then-meta-failed and no reporting. |

**Where we disagree with the review**

- **Severity is lower across the board.** Every awaited presentation goes through
  `_createLifecycleAwaitGuard` (`BattleScene.js:899-952`), whose promise only ever resolves: on
  completion, cancel, timeout and scheduling errors alike. "The banner rejects" therefore really
  means a *synchronous* throw inside animation or setup code, such as a destroyed sprite, a null
  `hpBar` or `this.add.*` after teardown. Those throws are rare, but when one happens the saved
  state is wrong, so the fixes are still worth making.
- **The deeper version of finding 4 is the opposite of a rejection.** Because cancellation
  resolves, code after each await keeps running after shutdown. It then reaches
  `finishUnitAction → completeBattleAction → captureCheckpoint`
  (`BattleSuspendController.js:65`). That function checks `battleInProgress`, the phase and the
  fatal flags, but not shutdown. `_captureSuspendCheckpoint`'s `||=` even rebuilds the suspend
  controller that shutdown nulled.
- **No new architecture is needed first.** The project already has the pattern to settle an
  action and then present it:
  - `PromotionController` commits the change, spends the seal and saves the continuation
    (`captureResolvedAction`, `ui/BattlePresentationCheckpoint.js:63`) before any await.
  - It checks `sceneEnded` after each await.
  - It finishes exactly once, through commit flags in its catch.

  Combat already saves a pre-roll intent (`_commitCombatIntent`) and ends through
  `presentQueuedLevelUps` / `completeResolvedAction`. The plan below applies that one pattern to
  every action rather than bringing in a competing "battle session" layer.

## 2. Invariants this spec enforces

1. **I1: presentation cannot change outcomes.** For every player action, the state after a
   normal run, a run with presentation skipped, and a run where presentation throws at any await
   point is identical. That covers HP, positions, conditions and buffs, item and staff uses,
   inventory identity, equipped weapon, XP, level queue, `hasActed`, unit lists, the RNG cursor
   and the persisted checkpoint.
2. **I2: a torn-down session never writes.** After the battle scene shuts down, nothing started
   before the shutdown may mutate battle state, write a checkpoint or touch the next session's
   scene fields.
3. **I3: reads never destroy.** Inspecting or allocating a slot never removes or overwrites a
   storage key. Only an explicit player action discards data.
4. **I4: a slot pair applies all or nothing.** Cloud hydration leaves each slot as the old
   complete pair or the new complete pair, and it reports local write failures separately from
   fetch failures.

### 2.3 How an action runs (shared by WS2–WS4)

```
pre-commit checks ─► COMMIT (sync: effects + costs + XP numbers + history)
                   ─► captureResolvedAction(scene, continuation)   // checkpoint now holds the outcome
                   ─► PRESENT (awaits; any throw = skip remaining presentation; session loss = stop)
                   ─► presentQueuedLevelUps(scene, continuation)
                   ─► completeResolvedAction(scene, continuation)  // exactly once
```

- A failure before COMMIT returns the player to the action menu with nothing spent.
- A failure after COMMIT skips the rest of the presentation and still completes the action,
  exactly once.
- Resume already completes the action from `_pendingActionCompletion`
  (`BattleCheckpointAdapter.js:31,53`).

## 3. Workstreams

They are listed in landing order. Each is one PR with its own tests.

### WS1: Non-destructive slot inspection (Finding 1)

**Validated behaviour**
- `getSlotSummary` (`engine/SlotManager.js:103-117`) and `cleanCorruptSlots` (`:70-84`, called
  by `getNextAvailableSlot` at `:86-87`) call `deleteSlot` whenever `parseMetaObject` returns
  null. That means a JSON parse error or a non-object value (`'null'`, `'[]'`, `'42'`, `''`).
- `deleteSlot` (`:195-206`) removes `_meta`, `_run`, `_run_clock_floor`, `_meta_clock_floor`
  and `_cloud_conflict`, plus the slot's hints.
- The callers are every Title create (`TitleScene.js:119`, `:499`), New Game (`:506`), every
  SlotPicker card draw (`SlotPickerScene.js:59`, `:293`, `:441`) and `RunFlowMenus.js:98`.
- A read-only code path therefore erases an intact run the first time the Title screen loads.
- The cloud rows are not deleted. For a signed-in player, the next `fetchAllToLocalStorage`
  restores the run (`CloudSync.js:131`) unless a New Game in that slot overwrites it first.
- `setItem` writes atomically, so the game's own writers cannot produce truncated meta. The
  trigger is outside tampering, extensions, storage-layer faults or a future writer bug.
- The auto-clean is deliberate and pinned by tests. It already caused one UX bug:
  `docs/integration-review-2026-09-21.md:28` (F6) found that Title computes `hasSlots` before
  the sweep deletes the slot, so "a corrupt-only save renders CONTINUE into an empty picker".
  The fix must not bring that back: a damaged slot counts as occupied everywhere.

**Change**
- Add a pure `inspectSlot(slot)` returning
  `{ status: 'empty'|'valid'|'damaged'|'unreadable', hasRunData, runParseable }`.
  A storage exception gives `unreadable`; a missing meta key gives `empty`, as today.
- Make `getSlotSummary` read-only. Damaged meta returns
  `{ slot, metaDamaged: true, hasActiveRun: false, runRecoverable }` instead of deleting and
  returning null. Keep the healthy summary shape unchanged.
- Rename `cleanCorruptSlots` into a non-destructive check. `getNextAvailableSlot` skips
  `damaged` and `unreadable` slots, so a damaged slot counts as occupied.
- Add `quarantineAndResetSlot(slot)`, reachable only from an explicit player action:
  - Copy the raw `_meta`, `_run` and `_cloud_conflict` strings into one
    `emblem_rogue_slot_{n}_quarantine` record `{ meta, run, conflict, at }`. Keep only the
    latest, to bound quota use.
  - Then call `deleteSlot`.
  - Existing key names stay unchanged, as CLAUDE.md requires.
- Add a damaged-slot card to `slotCardModel` / SlotPicker with two options:
  - **Repair**: rebuild default meta and keep the run. `MetaProgressionManager` already starts
    from defaults when the meta fails to parse.
  - **Discard**: run `quarantineAndResetSlot`. Discard keeps today's confirm dialog.
- Title's "has saves" check counts a damaged slot, so CONTINUE opens a picker with the damaged
  card rather than an empty picker.
- `clearAllSlotData` (logout) also removes the quarantine keys.

**Tests** (`tests/slotCorruption.test.js`)
- Rewrite the four tests that pin deletion: `:62`, the `it.each` over non-object values, `:154`
  and `:185`.
- New tests:
  1. Damaged meta with an intact run: `getSlotSummary` and `getNextAvailableSlot` leave every key
     byte-identical. Snapshot the whole fake store before and after.
  2. `getNextAvailableSlot` never returns a damaged slot.
  3. `quarantineAndResetSlot` keeps the raw strings and frees the slot.
  4. Repair keeps the run and `summary.hasActiveRun` becomes true.
  5. A storage exception gives `unreadable` and deletes nothing. The existing test at `:169`
     stays.
  6. `clearAllSlotData` removes the quarantine keys.
  7. `SlotCardModel` renders the damaged state with the longest labels at 640×480.
- Plant the bug: re-add the `deleteSlot` call and test 1 must fail.
- Check that `tests/e2e/save-lifecycle.spec.js:423` and the `NativeSaveMirror` tests hold no
  assumption about corrupt meta.

### WS2: Reclass settles like promotion (Finding 2)

**Validated behaviour**
- `executeReclass` (`BattleScene.js:7582-7633`) does the following, in order:
  - sets `COMBAT_RESOLVING`
  - `reclassUnit` (`:7598`) and history
  - redraws the sprite (`:7609-7610`)
  - grants Iron weapons (`:7613-7622`) and calls `updateHPBar`
  - awaits the banner (`:7626`)
  - consumes the seal (`:7629-7630`)
  - `finishUnitAction` (`:7632`)
- There is no try/catch and no `captureResolvedAction`.
- The picker callback (`:7551`) fires and forgets, so any throw becomes an unhandled rejection
  with the class changed, the seal unspent and the state stuck at `COMBAT_RESOLVING`. That is an
  in-session softlock.
- Separately, a shutdown during the banner resolves the await, and the seal and
  `finishUnitAction` then run on a dead scene.
- Resume is consistent but weaker than promotion. No checkpoint is taken until
  `finishUnitAction`, so a refresh right after the banner quietly reverts the reclass.

**Change**: mirror `PromotionController` (`ui/PromotionController.js:54-90`, `:166-266`)
- Move reclass into `ui/ReclassController.js`, following the CLAUDE.md rule against inline
  multi-step flows.
- COMMIT, synchronously:
  - `reclassUnit`, history and the weapon grants (`addToInventory` / `equipIfUnarmed`)
  - the seal: `uses--`, and remove it at 0
  - `captureResolvedAction(scene, { kind: 'finish', unitName, unitId })`
- PRESENT:
  - sprite refresh, HP bar and banner
  - after each await, return if `sceneEnded(scene, token)` (see WS5)
- The catch uses commit flags `applied` and `sealConsumed` exactly as promotion does:
  - not applied: restore `UNIT_ACTION_MENU`
  - applied: spend the seal if it has not been spent, then `_recoverUnitActionError`
- The picker callback adds `.catch` → `_recoverUnitActionError`.

**Tests** (new `tests/ReclassErrorRecovery.test.js`, alongside the promotion tests in
`BattleSceneActionErrorRecovery.test.js:165-209`)
- A rejecting banner, and separately a throwing `addUnitGraphic`: the class changed, the seal
  was spent exactly once, the action finished exactly once, the state is not blocking and there
  is no unhandled rejection.
- The checkpoint is written before the banner with the new class, seal count 0 and
  `_pendingActionCompletion.kind === 'finish'`. Mirror `GrowthCheckpointOrder.test.js:71-113`.
- A failure before commit (`oldClassData` missing): the seal is untouched and the menu is
  restored.
- Shutdown during the banner: the seal is already spent, no finish runs and no checkpoint is
  written after shutdown.
- An unarmed unit gets its granted weapon equipped by the time of the checkpoint.

### WS3: Combat and post-combat keep presentation apart from state (Findings 3a, 3c)

**Validated behaviour**
- Before the first animation await in `_runCombatResolutionAtSpeed` (`BattleScene.js:8216-8264`):
  - the art HP cost, art usage, recoil guard and the Phoenix check
  - `resolveCombat`, which draws RNG, spends per-battle weapon uses and removes Sleep on a hit
  - timeline facts and history for every strike
- The strikes then animate (`:8267-8282`), with contact callbacks writing each strike's HP
  (`:8764`).
- After the animations:
  - `_hitByPlayerThisPhase` (`:8291`)
  - `applyCombatHP` (`:8295`)
  - deeds
  - post-combat effects (`:8313`)
  - Phoenix
- Back in `executeCombat`: the intent is cleared (`:8446`), then XP, `removeUnit`, beats, level-ups
  and `completeResolvedAction` (`:8499`).
- The catch (`:8500-8540`):
  - clears the replay intent
  - removes only the attacker or defender at ≤0 HP
  - marks `hasActed`
  - runs `completeBattleAction`, which **saves a checkpoint of the half-applied state**
- The probe produced exactly that: art cost paid, counter, poison, kill and XP missing, and the
  timeline recording strikes that were never applied.
- `_playPostCombatBeats` (`:8566-8568`) is a bare `for await` with no per-beat guard. A throw in
  `updateHPBar`, `showMinorHintAt`, `_addConditionIcon` or `playStatus`:
  - drops every later beat, including state beats: `remove`, emitted by `pierce` at
    `PostCombatEffects.js:294` and by `aoeSplash` at `:370`, and `moved`
  - leaves any victim other than the attacker or defender dead but still in `enemyUnits`

**Change: step 1 (this PR). Keep the current flow and make presentation unable to cut it short.**
1. Divide `_playPostCombatBeat` into its state part and its presentation part:
   - `remove` and `moved` are state. They always run. `removeUnit` already guards its own fade.
   - `hp`, `poison`, `status` and `hint` are presentation, each wrapped in try/catch →
     `reportAsyncError('post_combat_beat_presentation', …)`.
   - The loop keeps going after a presentation failure.
2. In `_runCombatResolutionAtSpeed`, wrap the strike and skill animation loop in try/catch. A
   throw sets `presentationFailed = true`, stops animating, and carries on to `applyCombatHP`.
   That is the same code path as skipped strikes, which `HealthPresentationInvariance` already
   covers.
3. Add a `resultApplied` flag. If a throw still reaches the catch in `executeCombat` after
   `resolveCombat` returned but before `applyCombatHP` ran, apply the result there, from the
   result object, never from animation state.
4. The catch's reconcile walks every unit list for `currentHP <= 0`, not only the attacker and
   defender.
5. Apply the WS5 session checks after each await in `executeCombat`. The current check at
   `:8499` cannot see a restart.

**Change: step 2 (follow-up, needs its own design review). Settle, then present.**
- Pure `engine/CombatSettlement.js` returns a `CombatOutcome`:
  - strikes with HP before and after each one
  - deaths, including third parties
  - displacements, statuses and buffs
  - the XP award
- The scene applies the outcome and then presents it. `_showStrikeResult` becomes display-only,
  driven by the per-strike display HP it already receives (`setDisplayedHP`).
- This deletes the harness's mirror of the combat path, per the CLAUDE.md residual-gap rule.
- It changes when HP bars and death removals become true, so it waits until the step 1 matrix
  exists to catch regressions.

**Tests** (new `tests/CombatInterruptionMatrix.test.js`)
- Modes:
  - normal
  - skipped presentation
  - throw before and after each strike's contact
  - throw inside a skill activation
  - throw in each post-combat presentation beat
  - throw in `removeUnit`
  - throw in the level-up popup
- Scenarios:
  - a two-strike lethal exchange
  - a counter kill
  - a weapon art with an HP cost
  - an `aoeSplash` two-target kill and a pierce kill
  - a shove
  - poison
- Each mode's full semantic snapshot must equal the normal snapshot. The snapshot covers HP,
  positions, conditions, buffs, the unit lists, `hasActed`, weapon uses, art usage, XP and the
  level queue, the RNG cursor, `_pendingCommittedAction`, and the persisted checkpoint payload.
- Replace the finish-only assertions in `StabilityHardening.test.js:183-300`.
- Plant the bug: remove each new try/catch in turn and its matrix cells must fail.

### WS4: Staff, ability and item actions settle first (Finding 3b)

**Validated behaviour** (probed against the real controller with presentation stubbed to throw)

| Flow | Mutations before the first await | Mutations after it (lost on a throw) |
|---|---|---|
| `executeHeal` (`HealController.js:412-480`) | target HP, deeds, history, legendary self-heal | `spendStaffUse`, `restoreCombatWeapon`, XP |
| `executeHeal` cure branch (`:421-440`) | conditions cleared, icons | `spendStaffUse`, `restoreCombatWeapon`, XP |
| `executeHealAll` (`:482-525`) | first target only | targets 2..n, the staff use, weapon restore, XP |
| `executeRelocate` (`:349-379`) | nothing (the move happens *inside* `animateRelocate`, `:400-402`) | move, staff use, restore, XP |
| `useConsumable` (`BattleScene.js:7323-7380`) | heal or cure | history, `uses--`, item removal |
| `AbilityController.executeBlink` (`:279-319`) | `markUsed` | the move (between two fades) |
| `executeWarp` (Teleporter affix, `BattleScene.js:8824-8858`) | nothing | the move (between fades); dereferences `hpBar.bg` unguarded |

Every one of these recovers through `_recoverUnitActionError`, which only finishes the action.
`finishUnitAction` then saves a checkpoint, so the free heal, the partial target list or the held
staff is persisted.

**Change**
- Pure `engine/StaffActions.js` exports `settleStaffHeal`, `settleStaffCure`,
  `settleStaffHealAll` and `settleStaffRelocate`. Each applies every effect and cost at once:
  - all targets' HP, the self-heal and the cures
  - positions, for relocate
  - one `spendStaffUse`
  - history
  - It returns an outcome `{ steps: [{ target, before, after, amount }], selfHeal, cured, moved, xpBase }`.
- `engine/ItemUse.js`: `settleConsumable` applies the effect, `uses--` and removal at 0 in one go.
- The controllers:
  - settle
  - call `restoreCombatWeapon`
  - award XP
  - `captureResolvedAction`
  - present the outcome under the WS5 session checks
  - `presentQueuedLevelUps`
  - `completeResolvedAction`

  Before implementing, confirm that `awardScaledXP` has no internal await (validation says it
  applies synchronously and only queues popups).
- `animateRelocate`, blink and warp become pure fades around a move that has already happened.
  They take `from` and `to` and never write `col` or `row`.
- Give `executeHealAll` the same `HEAL_RESOLVING` re-entry guard as `executeHeal`.
- Guard `executeWarp` against a null `hpBar`.

**Tests** (new `tests/StaffActionInterruptionMatrix.test.js`, plus pure tests for the settle
functions)
- Cover heal, cure, healAll with one and with three targets, relocate, blink, and consumable
  heal, healFull, cure and cureHeal.
- For each, cover these modes:
  - normal
  - skipped
  - a throw at each await, including the second of three target animations and the self-heal
    animation
  - an XP throw
  - shutdown mid-flow
- Each must give an identical snapshot: every target's HP, conditions, staff `_usesSpent`,
  consumable identity and count, the equipped weapon, XP, `hasActed`, `battleState` and the
  checkpoint payload.
- Strengthen `BattleSceneActionErrorRecovery.test.js:112-163` and `HealXP.test.js:130-162`,
  which today only assert that `finishUnitAction` was called.

### WS5: A battle-session token and a cancel/skip split (Finding 4)

**Validated behaviour**
- `guard.cancel` resolves with no value (`BattleScene.js:924-938`), the same as completion. The
  watchdog timeout goes through `cancel('timeout')`.
- `_scheduleSafeDelayedAsync` (`:1049-1099`) checks only `scene.isActive()`; `phase` and `turn`
  are used for diagnostics only. Pending timers *are* removed at shutdown (`:606`, `:617-619`), so
  the real exposure is continuations already in flight.
- Phaser reuses the scene instance, and `restart` runs stop and then start in one synchronous
  `processQueue`. `BattleScene` has no `preload`, so `create()` runs synchronously and
  `init` resets `_sceneShutdownCleanedUp = false` (`:516`). Then the queued continuations run.
- So `isActive()`, `_sceneShutdownCleanedUp` and `sceneEnded()` all read "alive" for a stale
  continuation after a restart. That includes the existing guards at `:5098`, `:5102`, `:6744`
  and `:8499`, `PromotionController.js:27` and `BattlePresentationCheckpoint.js:77`.
- Only the enemy-phase epoch (`_enemyPhaseEpoch`) and the turn-start token are safe across a
  restart.
- No current player path shuts the scene down mid-action: the orientation switch and pause
  require `PLAYER_IDLE`. The remaining windows are a victory or transition-recovery shutdown
  racing a tail, a future restart path, and a backgrounded tab. In the last case the watchdog
  timeout removes a tween partway through a fade and can leave a sprite partly transparent.

**Change**
- Add `this._battleSession = (this._battleSession || 0) + 1` in `init` and again in
  `_runSceneShutdownCleanup`. Never reset it.
- Add helpers `scene._sessionToken()` and `scene._ownsSession(token)`, which check that the
  token matches and that the shutdown flag is clear.
- Change `sceneEnded(scene)` in `PromotionController` and `BattlePresentationCheckpoint` to
  `sceneEnded(scene, token)`, keeping the old flag check as well.
- Lifecycle guards resolve with a status: `'done' | 'timeout' | 'cancelled'`.
  `_awaitSceneTween` / `_awaitSceneDelay` return it; callers that ignore it behave as before.
  - `timeout` means presentation was skipped. Snap the targets to their end values (fixing the
    partly transparent sprite) and continue the committed action.
  - `cancelled` means the session is gone. Flows check `_ownsSession(token)` and stop.
- Defence in depth:
  - `BattleSuspendController.captureCheckpoint` and `completeBattleAction` refuse to run when the
    scene has shut down.
  - `_captureSuspendCheckpoint` no longer recreates the controller after shutdown.
  - This is what enforces I2 even in a flow nobody has audited.
- `_scheduleSafeDelayedAsync` captures the token when it schedules. When it fires it checks
  `_ownsSession(token)`, plus `phase` and `turn` against `turnManager` when they are given.
- Rollout order, with the most exposed sites first: relocate, blink, heal and cure, warp,
  reclass (WS2), the combat tail, and `animateEnemyMove` (`:10294`).

**Tests** (new `tests/BattleSessionLifecycle.test.js`, using the real guard implementation)
- Cancel mid-tween and flush microtasks. Assert no mutation and no checkpoint.
- Also cover the restart sequence: cancel, flip `isActive` back to true and reset the shutdown
  flag, then flush microtasks. The same asserts must hold. This is the case today's flags miss.
- Timeout: the tween snaps to its end value and the flow completes.
- A `_scheduleSafeDelayedAsync` callback is dropped on a session or phase mismatch.
- Plant the bug: remove the token check and the restart-sequence test must fail.

### WS6: Pair-safe cloud hydration and honest reporting (Finding 5)

**Validated behaviour**
- `fetchAllToLocalStorage` (`cloud/CloudSync.js:213-261`) runs `applyRunSlots` over every slot,
  and then `applyMetaSlots`.
- A failed run write adds the slot to `skipped`, so its meta is not applied. That direction is
  safe and is tested at `tests/CloudSync.test.js:219`.
- A failed meta write (`:178-186`) is only logged. It is not rolled back, not reported and not
  retried.
- The function returns `{ rejectedCount }`, which counts fetch failures only. `main.js:415` and
  `:431` retry only on that count.
- Both writes use a raw `setItem`, not the quota-shedding `setItemFreeingSpace` used by the play
  path (`engine/SaveSpace.js`).
- `preserveCloudConflict` writes a large `_cloud_conflict` record just before the pair, which
  adds quota pressure.
- The consequences, checked by probe:
  - **Fresh slot**: the run exists without meta. The slot reads as empty because slot presence
    is defined by the meta key, and New Game silently overwrites the run.
  - **Existing slot**: a new run sits next to old meta. The next meta save stamps
    `savedAt = max(Date.now(), …)` (`MetaProgressionManager.js:1425`), so that stale meta then
    wins `shouldPreferLocalMeta` (`CloudSync.js:917-926`) and can be pushed over the newer cloud
    meta. Only lists that are merged as unions survive. This path was derived from code, not
    probed end to end.
- Likelihood is low. It needs a quota-class failure on the second write. It is most plausible on
  iOS WebKit with suspended battles in several slots plus conflict records.

**Change (option A: snapshot and roll back, with no key or format change)**
- Replace the two passes with a per-slot `applySlotPair(slot, cloudRun, cloudMeta)`:
  1. Snapshot the raw `_run`, `_meta` and `_cloud_conflict` strings.
  2. Write the conflict record if one is needed, then the meta, then the run, each through
     `setItemFreeingSpace`.
  3. If any write throws, restore all three from the snapshot (`removeItem` where a key did not
     exist before) and skip the slot.
- The result becomes
  `{ rejectedCount, localApplyFailures, failedSlots: [{ slot, reason }] }`.
  - `main.js` treats `localApplyFailures > 0` like a rejection for the background retry.
  - It calls `reportCloudFailure('cloud_apply_local', …)` and shows the existing storage-full
    hint.
- Option B (one envelope key per slot) is rejected: CLAUDE.md fixes the
  `emblem_rogue_slot_{n}_meta/run` key names, and the native mirror and cloud schema assume two
  keys.
- Option C (staged revision plus pointer) is also rejected: it doubles quota use at exactly the
  moment quota is the failure.

**Tests** (extend `tests/CloudSync.test.js`, reusing `SaveSpaceQuota`'s quota storage stub)
- Fail at each write boundary: the conflict record, the meta, the run, and a failing restore.
  The previous raw run, meta and conflict strings stay byte-identical, `failedSlots` includes the
  slot, and `rejectedCount` is still 0.
- A fresh slot whose apply fails leaves no orphan run key.
- A slot that fails does not block the other slots from applying.
- `setItemFreeingSpace` sheds optional history before giving up.
- Plant the bug: drop the restore and the tests must fail.

**Adjacent, not in scope:** `backgroundCloudRefetch` (`main.js:428-446`) can apply cloud data
while the game is already running. Separately confirm that a live `RunManager` never reads a pair
that was half-applied under it.

### WS7: TurnManager transition guards (Finding 4b)

**Validated behaviour** (`engine/TurnManager.js`, 88 lines)
- `unitActed`, `endPlayerPhase` and `endEnemyPhase` never check `currentPhase`.
- Probes: two `endEnemyPhase` calls reach turn 3, and `endEnemyPhase` during the player phase
  skips a turn.
- There are ten call sites and none of them checks the phase first. The enemy-phase and
  turn-start pipelines are protected by epochs.

**Change**
- `endPlayerPhase` returns `false` and does nothing unless `currentPhase === 'player'`.
  `endEnemyPhase` does the same unless the phase is `'enemy'`.
- `unitActed` still sets `hasActed` in any phase, but ends the phase only during the player
  phase.
- Report a rejected transition with `reportAsyncError('turn_transition_rejected', …)` so it shows
  up in telemetry rather than being swallowed silently.

**Tests**
- Pure `TurnManager` tests for the four probe cases.
- Run the harness and sim lanes (`test:harness`, `sim:fullrun:pr`) to confirm no legitimate
  caller relied on a transition from the wrong phase.

## 4. Order and sizing

| PR | Workstream | Size | Depends on |
|---|---|---|---|
| 1 | WS1 slot inspection | S | none |
| 2 | WS7 TurnManager guards | S | none |
| 3 | WS5 session token and guard status (helpers, checkpoint gate, delayed helper) | M | none |
| 4 | WS2 reclass controller | S | 3 (token) |
| 5 | WS3 step 1: combat presentation isolation and interruption matrix | M | 3 |
| 6 | WS4 staff, ability and item settle-first | M–L | 3; reuses the matrix helpers from 5 |
| 7 | WS6 pair-safe hydration | S–M | none (can land in parallel) |
| 8 | WS3 step 2: `CombatOutcome` settle-then-present, delete the harness mirror | L | 5, 6 |

PRs 1, 2 and 7 are independent and low risk. PR 3 is the base for the in-battle work.

## 5. Review recommendations we would defer

- **Narrowing controller access** (explicit queries and commands instead of the whole scene).
  This is the right direction, but only after WS3 step 2 gives controllers an outcome object to
  consume. Doing it earlier moves methods without changing who owns the state.
- **Incremental types at the boundaries** (`ActionContinuation`, `CombatOutcome`, the slot
  inspection result). Add JSDoc `@typedef`s when each workstream adds its type. No TypeScript
  migration.
- **A WebKit browser lane and an iOS smoke checklist** (backgrounding, orientation, save and
  resume). Worth adding next to WS5, since the backgrounded-tab timeout is the most plausible
  real-world trigger found. It needs the CI-cost trade-off decided in `tests/e2e/lanes.json`.

## 6. Verification checklist per PR

- `npm run format:check`, `lint`, `validate:data`, `build`, `test:unit`.
- `test:harness` and `test:sim` for WS3, WS4, WS5 and WS7.
- Each new test is shown to fail once against a planted bug (CLAUDE.md testing rules).
- The e2e lanes that touch saves (`save-lifecycle`), the portrait switch and battle entry pass.
