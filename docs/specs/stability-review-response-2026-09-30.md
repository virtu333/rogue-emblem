# Stability review response: findings, specification and implementation plan (2026-09-30)

## Review basis and recommendation

The original source review covered `main` at `1a6e2d0`. The first version of this response
validated it against `97c8308ae0e1e9d73069e5fcd724c06814837883`, reporting source traces and
temporary reproduction probes. This revision rechecks the proposed fixes against that same
commit. Those earlier probes are evidence reported by the original author; this document does
not claim that the new acceptance tests already exist or pass. Source references below are
pinned to this commit; names are preferable to line numbers as implementation proceeds.

Keep the eight-PR approach and the existing controllers, continuation formats and canonical
save keys. Start with slot inspection and phase guards, then session ownership and combat.
Do not require a permanent save-envelope migration or a complete combat-outcome refactor
before fixing these defects. The pair-write fix does need durable recovery evidence: an
in-memory snapshot and best-effort rollback cannot provide the guarantee originally proposed.

| Finding | Validated scope | Priority / severity |
| --- | --- | --- |
| 1: reading deletes a slot | Invalid/non-object metadata causes deletion of local slot data; cloud rows survive. Missing metadata also makes an orphaned run appear empty. | Medium; preserve data first |
| 2: reclass softlock | Class/history can change before seal consumption, checkpoint and action completion; redraw/setup errors can abort the flow. | Medium |
| 3a: partial combat checkpoint | Strike presentation writes live HP; recovery can save before the exchange and its effects finish. | Medium |
| 3b: effects without costs | Healing, relocation and consumables can lose later cost, equipment-restoration or XP steps. | Medium |
| 3c: incomplete post-combat effects | A cosmetic failure can prevent later removals, leaving third-party enemies at 0 HP and blocking Rout victory. | Medium–High; highest gameplay priority |
| 4: stale continuations | Cancellation resolves waits; shutdown/restart can make old continuations appear alive. Current orientation and Save & Exit gates reduce exposure. | Low–Medium; latent mechanism |
| 4b: repeated phase transitions | TurnManager accepts transitions in the wrong phase. Existing pipeline epochs reduce normal-play exposure. | Low |
| 5: mixed run/meta restore | A successful first write and failed second write can leave a mixed or orphaned slot; local failures are not returned to callers. | Low–Medium; storage recovery work |

These severity adjustments are reasonable, but failure frequency has not been measured.
Lifecycle animation guards normally resolve rather than reject, so a rejected banner is not
the usual trigger. Their setup, nested async methods, imports and modal callbacks can still
throw or reject; not every awaited operation is covered by the guard. Presentation errors,
session cancellation, gameplay errors and storage errors need different recovery behavior.

Promotion provides much of the intended pattern, but is not a complete reference: it redraws
the sprite before granting proficiency weapons and capturing the checkpoint. A redraw error
can therefore skip required state. Include this small ordering correction with reclass.

## Required guarantees and scope

1. **Presentation independence.** For each migrated action path, normal, skipped, timed-out
   and failed presentation produces the same settled gameplay state and resumable continuation.
   Compare HP, positions, statuses/buffs, inventory and equipment identity, costs, XP/growth,
   queued level-ups, rewards/deeds/history, membership of unit lists, action completion and RNG.
   Cover player and enemy combat. This is a staged guarantee, not a claim that every action and
   phase flow has already been migrated.
2. **Original-session ownership.** Work started in a closed or superseded session cannot
   mutate state, save, finish an action or clear fields belonging to a newer session. Ownership
   is checked using the token captured when the work started, including catch/finally paths.
3. **Non-destructive inspection.** Listing, selecting and allocating slots never removes or
   overwrites data. Damaged, unreadable, orphaned and recovery-only slots remain occupied.
4. **Pair restore with recoverable failure.** Readers see a verified old or new run/meta pair.
   If writes and rollback both fail, the slot is explicitly blocked with durable recovery
   evidence until repair succeeds. Do not promise that two independent storage keys are
   physically atomic, or that a failed restoration somehow leaves the old bytes intact.

For reclass, promotion, staff, ability and item actions, the intended order is:

1. Validate choices, targets, data, costs and ownership before mutation.
2. Apply gameplay effects, costs, equipment restoration, XP/growth and history synchronously,
   without graphics calls or awaited presentation. Validate domain operations before starting;
   synchronous code alone does not make a multi-step mutation transactional.
3. Capture the existing resolved-action continuation and checkpoint; preserve stable unit
   identity and the existing `finish`/`combat` resume semantics.
4. Present the captured before/after facts. A cosmetic failure skips presentation; loss of
   ownership stops the old flow. A real player decision is not automatically skipped.
5. Present queued level-ups and complete the action once, using operation-local stage flags.

Checkpoint helpers must return a meaningful persisted/failed/not-applicable result, rather
than discard storage failure. After settlement, a failed save leaves the action settled in
memory and offers save retry without charging costs or applying effects again. Prevent a
second action or destructive transition from overwriting the retry state. No-slot/tutorial
battles can explicitly use the in-memory completion path. A domain failure is not classified
as cosmetic and must not save a partially settled action as successfully complete.

Combat PR 5 preserves its pre-roll intent and current sequencing while removing the identified
presentation dependencies. Full settle-before-presentation for combat is PR 8, not a guarantee
that PR 5 can acquire merely by wrapping the animation loop in a catch.

## WS1: Non-destructive slot inspection and recovery (PR 1)

`src/engine/SlotManager.js` currently deletes invalid-meta slots from summary/allocation paths.
Deletion includes run, metadata, conflict, clock-floor and hint data. It is deliberate and
pinned by `tests/slotCorruption.test.js`. Cloud survival is useful recovery evidence, but does
not make local deletion safe: New Game may reuse the apparently empty slot before hydration.

### Implementation

- Add read-only `inspectSlot(slot)` with `empty`, `valid`, `damaged`, `unreadable` and
  `recovery-required` states. Inspect run, meta and relevant conflict/quarantine/journal
  evidence. Missing meta means empty only when no other slot evidence exists. Preserve the
  healthy summary shape; damaged summaries must not advertise a playable run before validation.
- Make summary/allocation checks non-destructive and keep all nonempty states occupied in
  Title, SlotPicker and New Game. Existing recovery copies also reserve the slot.
- Offer recovery from a validated local backup, native copy, cloud pair or conflict pair.
  Reuse validation rules and show the source and consequences before applying a repair.
  Cloud/native repair can be integrated once the pair helper lands; unavailable sources should
  not appear as working options in PR 1.
- Rebuilding default meta is **progression reset**, not transparent repair: it can lose valor,
  supply, upgrades and payout records. If offered, require an explicit choice explaining that
  loss, archive originals, validate the retained run, and prevent automatic cloud upload from
  replacing the recoverable meta with newly timestamped defaults before that choice.
- Discard must first persist and verify a raw recovery archive, including original strings,
  absence of keys, conflict, clock floors and relevant hints. If backup fails, remove nothing.
  Keep existing key names and the `emblem_rogue_` prefix for any added recovery key.
- Do not overwrite the only archive with another discard or silently free an archived slot.
  Provide an explicit archive-retirement/reuse choice; preserve the only recovery copy until
  that choice. Logout/clear-all behavior must distinguish ordinary cache removal from explicit
  deletion of recovery evidence. Bound archive size without dropping sole recovery evidence.
- Check failures during canonical-key deletion: show recovery-required until cleanup succeeds,
  rather than claiming the slot is empty after only part of the reset completed.

### Acceptance

Snapshot the whole fake store before and after Title/summary/allocation inspection. It must be
byte-identical for valid, malformed, non-object and absent meta with an intact run, conflict-only,
archive-only and journal-only slots. Storage read exceptions delete nothing. Allocation skips
all occupied/recovery states. Inject backup, verification and deletion failures. Check repair
preserves earned metadata when a valid source exists, and reset cannot silently upload defaults.
Verify damaged cards at 640×480 and the CONTINUE-to-picker path. Reintroducing automatic deletion
must fail the preservation tests.

## WS7: TurnManager transition guards (PR 2)

`src/engine/TurnManager.js` accepts `endPlayerPhase`, `endEnemyPhase` and `unitActed` without
validating their originating phase. Fixing phase guards is small and independent.

- Reject a phase-ending call unless its source phase is current. Check before battle-end
  detection and callbacks; rejection has no state changes or callback side effects. Return
  consistent accepted/rejected results and update callers where they depend on that result.
- Audit every `unitActed` caller and define its legal phase and current-unit membership.
  Reject stale or removed actors before setting `hasActed`. Preserve any legitimate enemy or
  NPC marking behavior through an explicit contract rather than accepting arbitrary phases.
- Keep the engine independent of browser telemetry; expose an injected diagnostic callback or
  report rejected transitions at the scene boundary.
- A phase check cannot reject old work that arrives during a later turn's same phase.
  Existing epochs and WS5 originating-operation checks cover that case.

Test repeated/wrong-phase transitions, stale membership, callback counts and battle-end
behavior. Run the harness/simulation checks to detect legitimate callers that need adjustment.

## WS5: Session ownership and cancel/timeout semantics (PR 3)

Lifecycle guards currently resolve completion, timeout and cancellation alike. Shutdown removes
pending timers but not continuations already in flight. Phaser can reuse the scene instance;
reset flags and `isActive()` alone cannot distinguish old work after a restart.

### Implementation

- Maintain a monotonic session counter across `init` and shutdown; invalidate ownership at the
  start of shutdown cleanup. Do not reset the counter. Capture it at each operation's entry,
  before the first await or scheduled callback. Also capture the action/phase epoch when a
  newer operation in the same session can supersede it.
- Pass original ownership through controllers, nested helpers, presentation callbacks and
  continuation helpers. Check it before every post-await mutation and inside catch/finally,
  delayed callbacks and recovery. Old finally blocks must not reset new combat speed, selected
  art, audio, pending intent or completion fields.
- Gate `BattleSuspendController.captureCheckpoint`, `completeBattleAction`, resolved-action
  helpers and scene checkpoint wrappers with expected ownership. Do not recreate the suspend
  controller after shutdown. Async callers must supply the originating token; a default that
  samples the current token at save time does not protect an old continuation. Document any
  remaining synchronous callers and unaudited paths instead of declaring them covered.
- Return structured lifecycle wait outcomes: completed, skipped/timeout, or cancelled.
  Timeout may finish committed work only while it still owns the session. Cancellation stops
  that work. Preserve existing callers during migration, but track the ones not yet audited.
- Use operation-specific visual cleanup on timeout: restore intended alpha/position or destroy
  temporary objects safely. Do not generically call tween completion callbacks or copy arbitrary
  end properties: callbacks may mutate gameplay, and yoyo/relative tweens have different ends.
- Scheduled async helpers check session plus any expected phase/turn/epoch before firing and
  recheck after their internal awaits. Post-await callbacks cannot rely on a dispatch-time check.

### Acceptance

Use the real guard with controllable timers: cancel mid-wait, restart the same scene instance,
restore active flags, then flush microtasks. Assert no old mutation, save, finish, intent clear
or next-session field change. Cover catch/finally and controller lazy recreation. Timeout keeps
ownership, repairs only visual state and completes a committed action once. Invalid phase/epoch
callbacks are dropped. Test failed checkpoint retry separately from cosmetic error recovery.

## WS2: Reclass and promotion ordering (PR 4)

Reclass currently redraws, grants weapons and awaits its banner before spending the seal.
Promotion spends the seal early, but also redraws before weapon grants and checkpoint capture.

- Extract reclass into `src/ui/ReclassController.js`, matching the repository's controller
  structure and preserving the scene wrapper.
- Validate class data and seal before mutation. Apply class/oath/deed/history changes, weapon
  grants and `equipIfUnarmed`, then consume/remove the seal and capture the resolved continuation.
  Refresh sprite/HP bars and present the banner only after these required steps.
- Move promotion's graphics refresh after its weapon grants and checkpoint too. Keep genuine
  promotion/oath choices before settlement and guard their callbacks with original ownership.
- Use per-operation settlement/cost/capture/completion stages in normal and recovery paths.
  A cosmetic throw after settlement must neither charge again nor return to a replayable menu.
  A prevalidation failure leaves state untouched. Do not infer complete settlement merely from
  the class having changed when another required domain step failed.
- Observe picker promises and errors so fire-and-forget callbacks cannot create unhandled
  rejections; recovery itself checks the captured ownership.

Test both promotion and reclass with a throwing sprite refresh, HP bar, banner and popup; a
rejected presentation promise; invalid precommit data; checkpoint failure/retry; and shutdown/
restart. Assert weapons/equipment, class, seal and continuation at the checkpoint before any
presentation. Completion and cost occur once. Domain/prevalidation failures have their own
assertions rather than being forced into the presentation-equivalence matrix.

## WS3: Complete combat despite cosmetic failure (PR 5)

### Why an animation-loop catch is insufficient

`_runCombatResolutionAtSpeed` pays art costs and can await Phoenix presentation before
`resolveCombat`; strike callbacks write HP. `animateStrike` also invokes Teleporter
`executeWarp`, which selects a destination with RNG and moves the unit inside fades, and can
return without moving when graphics are missing. Skipping that animation therefore changes
positions and RNG, even if final HP is subsequently applied.

`PostCombatEffects` mutates gameplay while yielding beats. A visual failure can stop its
generator before later effects. `removeUnit` guards a fade, but still mixes required death,
reward and Deathburst work with unguarded visual calls. Catching that whole function and
calling the death handled is unsafe. The current outer combat catch sees only attacker and
defender; a local `result` in the inner helper is not available there after rejection.

### Implementation

1. Keep an explicit operation-owned resolution context shared by the combat helper and its
   caller: intent, rolled result and completed settlement stages. Preserve pre-roll RNG intent.
   A flag for final HP application is not a flag for complete combat settlement; never reapply
   final HP after later effects have changed it.
2. Separate Phoenix gameplay, art costs/usage, XP/growth, status and reward work from their
   visual methods. Cosmetic errors before resolution must not prevent the roll or subsequent
   settlement. Fatal domain failures remain distinct and retain recoverable intent/state.
3. Move Teleporter gameplay out of `animateStrike` in this PR, including destination choice
   and RNG consumption. Process it at the same logical strike point with the same interim HP
   eligibility and RNG ordering as successful play. Record from/to facts for presentation.
   Missing sprites or bars cannot affect movement. Blink/staff relocation follow in PR 6.
4. Catch strike/skill visual failures at narrow presentation boundaries, stop remaining visuals
   and continue required combat steps. During this incremental PR, any contact-based live HP
   writes must converge to the authoritative exchange before post-combat effects begin. Preserve
   existing per-strike behavior and Teleporter decisions; full display-only HP is PR 8.
5. Split post-combat beats into required work and optional drawing. Always exhaust required
   effects while ownership is valid. A moved beat may need fog/cache updates even when its
   graphic refresh failed; status icons and hints must not prevent later remove beats.
6. Audit `removeUnit` and recursive Deathburst: isolate drawing errors around every cosmetic
   call, including damage display before recursive death processing. Preserve kill attribution,
   rewards, on-kill hooks, remains and unit-list removal exactly once; clear re-entry state
   safely. A scan of all faction lists for unprocessed 0-HP units is defense in depth, not a
   substitute for correct death settlement and rewards.
7. Apply the same guarantees to enemy combat and the player tail: XP, level-up queues, victory,
   Canto/action completion and checkpoint. Clear replay intent only after required settlement
   has succeeded. Cosmetic failures must not route through the old half-state-save catch.

### Acceptance

Add a real-path interruption matrix, covering both actors' deaths, counters, multi-strikes,
art HP costs, Phoenix, Teleporter, splash/pierce third-party kills, chained Deathburst, shove,
poison, rewards, XP/growth, victory and Canto. Inject before/after contact, skill drawing, every
post-combat visual beat, recursive death drawing and popup presentation. Compare semantic
snapshots and normalized checkpoint payloads, including positions, health-accessory debt,
fog/visibility, RNG and list membership;
exclude wall-clock timestamps and diagnostic counters only.

Existing `HealthPresentationInvariance` tests stub post-combat/Phoenix and replace strike
animation. They are useful focused checks, not evidence for the full action. Replace or extend
finish-only recovery assertions. Include fixed-v1 and legacy checkpoint/RNG behavior and the
current Canto confirm, Wait, Back and retap paths, plus Commander's Gambit refresh. Do not add
checkpoint calls that change legacy reseeding or the fixed-v1 RNG cursor. Tests must assert
expected kills, costs and rewards independently, not merely compare two equally wrong
implementations.

## WS4: Staff, ability and item settlement (PR 6)

Heal/cure/healAll can apply effects before staff use, weapon restoration and XP. HealAll can
stop after its first target. Staff relocation and Blink move inside fades; consumables can heal
before their uses/removal/history. `awardScaledXP` has no internal await, but creates text/tweens
before applying XP and can throw again before completing its queue work. It is not safe merely
because it runs synchronously.

- Add small engine settlement functions for staff and consumable rules; keep scene wrappers
  and existing data rules. Validate all targets first, then apply every target's heal/cure or
  position, legendary self-heal, one staff/item charge, depletion/removal, history and XP.
  Restore the original combat weapon before capture. Preserve inventory item identity.
- Split XP/growth/skill and level-up queue mutation from XP text, bars and popups. Record the
  presentation facts without creating graphics in the domain function. Reuse this split in
  combat, staff and other affected XP callers.
- Settle Blink usage and movement together. Staff relocation/Blink presentation takes recorded
  from/to coordinates and never writes `col`/`row`. Teleporter was already covered in PR 5.
- Give HealAll a re-entry/ownership guard consistent with the other healing paths. Capture the
  resolved continuation, present under WS5 ownership, then finish once. Save failure uses retry
  without reapplying costs or target effects.

Cover heal, cure, one/three-target healAll, self-heal, relocation, Blink and all consumable
effects. Inject failures on the second target, XP drawing, weapon-display refresh and popups.
Assert all targets, spent uses, inventory/equipment identity, XP/growth/queue, RNG, continuation
and completion. Include shutdown/restart and invalid precommit data as separate cases.

## WS6: Recoverable pair writes and honest cloud reporting (PR 7)

`src/cloud/CloudSync.js` applies run slots and then metadata. A failed run write already skips
that slot's meta, but meta-write failure leaves the first write applied and only logs it.
`rejectedCount` reports fetch failures. `src/main.js` retries based on that count.

### Contract and implementation

- Preserve `emblem_rogue_slot_{n}_meta` and `_run` as canonical keys. The repository's key-name
  requirement does not forbid an additional prefixed recovery journal. A permanent slot envelope
  and cloud-schema migration remain deferred.
- Build a per-slot merge plan first, preserving current timestamp winner selection, run-record
  and lord unions, conflict policy and clock floors. Do not replace that logic with blind cloud
  assignment. Fetch both resources successfully before applying; two successful network requests
  still do not guarantee a single backend revision, so retain existing validation/conflict rules.
- Use one shared local pair-apply helper for hydration and conflict restore. Save a bounded
  write-ahead before-image journal with transaction ID, old raw strings/absences and every
  touched canonical/conflict/floor key. Persist and verify it before changing those keys. If
  quota cannot accommodate recovery evidence, fail unchanged rather than proceed unprotected.
- Apply the computed writes synchronously with no await between them, verify the complete pair,
  then mark the transaction committed before removing the journal. Pending means restore the
  old pair; committed means verify/retain the new pair and finish cleanup. Recovery is idempotent.
  If rollback fails, keep evidence and mark the slot recovery-required. Do not continue play,
  allocate it, construct managers from partial data or push it to cloud.
- Quota shedding may remove optional history, but must never delete the sole pending journal
  or quarantine. A malformed/unreadable journal requires recovery rather than default metadata.
- Recover before startup slot inspection and manager construction. Gate all relevant slot
  readers/writers while recovery is pending. Reuse WS1 damaged-slot UX for unresolved recovery.
  Existing conflict restore's separate rollback path must use this same contract.
- Native mirroring is a release gate: `nativeSaveMirror` debounces per-key writes and flushes
  them asynchronously. A correct local pair can still become mixed on native restore. Make
  mirroring transaction-aware, with durable native recovery evidence before pair-file writes,
  a completion marker after both, and ordered recovery before restored data becomes readable.
  Specify batching/serialization and crash recovery before enabling the helper in native builds;
  deleting the local journal before the mirror sees it must not erase native recovery evidence.
- Defer hydration of the actively loaded slot in `backgroundCloudRefetch`; apply other slots.
  Resume deferred application at an explicit safe boundary before fresh managers load. An
  alternative requires deliberate live-manager reconciliation, not a half-pair check alone.
- Return fetch failures, local apply failures and deferred slots separately, retaining existing
  `rejectedCount` meaning. Include failed slot, stage and rollback/recovery status. Bound retries
  for storage failures; do not hammer a full store or treat intentional deferral as an outage.
  Surface actionable storage/recovery status in existing UI and report `cloud_apply_local`.

### Acceptance

Fault-inject at journal creation/verification, conflict/meta/run/floor writes, committed marker,
cleanup and each rollback step. Successful rollback restores exact prior bytes; failed rollback
leaves a blocked, recoverable slot with intact evidence. Simulate process interruption after
every write and repeat startup recovery. Include fresh slots, absent keys, malformed journals,
merge/conflict behavior, quota shedding, unrelated slots, active-slot deferral and reporting.
For native storage, fail/interrupt after every individual mirrored write, restart/restore, and
assert a complete old/new pair or an explicitly blocked recovery state. Do not assert impossible
byte equality when the injected fault also prevents restoration.

## WS3 follow-up: Compute a full combat outcome (PR 8)

After PR 5's matrix pins semantics, extract shared engine combat settlement, covering strikes,
interim HP, RNG decisions, Teleporter/displacements, statuses, Phoenix, third-party deaths,
rewards and XP. Design its exact boundaries before implementation; avoid introducing a second
copy of domain rules in a new outcome builder. Apply a complete outcome, capture the continuation
and then present recorded facts. `_showStrikeResult` becomes display-only using a new display-HP
projection/helper; `setDisplayedHP` is not an existing API in the reviewed source.

Replace the harness's duplicated combat flow with the shared engine path. Keep independent
scenario assertions and expected outcomes so sharing code does not make tests tautological.
Preserve continuation compatibility, RNG order, Canto and victory sequencing.

## Delivery order, size and dependencies

| PR | Scope | Size | Dependencies |
| --- | --- | --- | --- |
| 1 | WS1: read-only slots, occupied damaged states, safe archive/recovery UX | S–M | None; pair repair integration follows PR 7 |
| 2 | WS7: TurnManager guards and caller audit | S | None |
| 3 | WS5: original session/operation ownership, wait outcomes, checkpoint status/retry | M | None; base for battle changes |
| 4 | WS2: reclass controller plus promotion grant/checkpoint ordering | S–M | PR 3 |
| 5 | WS3: combat isolation, Teleporter/Phoenix/death-chain correctness, full-state matrix | M–L | PR 3; shared XP split coordinated with PR 6 |
| 6 | WS4: staff, ability, item and XP settle-first paths | M–L | PR 3; matrix/helper reuse from PR 5 |
| 7 | WS6: journaled pair helper, recovery, native mirror, conflict/background integration | M–L | PR 1 recovery UX; may proceed alongside battle work |
| 8 | WS3 follow-up: shared complete combat outcome, harness duplication removal | L | PRs 5–6 and design review |

PRs 1 and 2 remain the starting recommendation. PR 3 enables safe interruption handling;
prioritize PR 5's third-party deaths after it. PR 7 is no longer described as independent or
low risk: its failure recovery and native integration are part of correctness, not optional
hardening. Keep commits narrow within each PR when controller and engine changes need separation.

## Verification and deferred work

- Run repository-required formatting, lint, data validation, build and unit checks for each
  implementation PR. Run relevant harness/simulation checks for phase, lifecycle and gameplay
  changes, using the scripts present when the PR lands.
- Follow `CLAUDE.md`: test externally observable outcomes, include independent expected facts,
  and demonstrate that each regression test fails with the relevant bug deliberately restored.
  Presentation-failure, storage-failure, domain-failure and cancellation matrices are distinct.
- Extend existing run-flow, contracts, portrait, battle-history and presentation/input browser
  coverage as relevant; register new specs in `tests/e2e/lanes.json`. Do not assume a lane named
  `save-lifecycle` exists because a save-lifecycle spec does.
- Keep broader controller command/query restrictions and TypeScript migration deferred. Add
  useful JSDoc boundary types with the individual PRs, not a preliminary type project.
- A dedicated WebKit CI lane can remain follow-up work. Native/iOS smoke checks for background,
  restart, orientation, save/resume and storage recovery belong to PRs 3/7 release validation;
  do not defer those lifecycle checks with the browser-lane investment.

## Source index (reviewed at `97c8308`)

- Slot policy and recovery: `src/engine/SlotManager.js`, `src/engine/SaveSpace.js`,
  `src/engine/CloudSaveConflict.js`, `tests/slotCorruption.test.js`.
- Gameplay settlement: `src/scenes/BattleScene.js` (`executeReclass`,
  `_runCombatResolutionAtSpeed`, `executeCombat`, `_playPostCombatBeats`, `animateStrike`,
  `executeWarp`, `awardScaledXP`, `removeUnit`), `src/engine/PostCombatEffects.js`,
  `src/ui/PromotionController.js`, `src/ui/HealController.js`, `src/ui/AbilityController.js`.
- Continuation/lifecycle: `src/ui/BattleSuspendController.js`,
  `src/ui/BattlePresentationCheckpoint.js`, `src/ui/BattleActionCompletion.js`,
  `src/utils/portraitBattle.js`, `src/engine/TurnManager.js`.
- Persistence: `src/cloud/CloudSync.js`, `src/main.js`, `src/utils/nativeSaveMirror.js`,
  `src/engine/MetaProgressionManager.js`, `src/engine/RunManager.js`.
- Test limitations: `tests/HealthPresentationInvariance.test.js`; implementation should also
  strengthen existing action recovery, cloud, native mirror and checkpoint-order tests.

## Implementation progress — 2026-09-30

The first two independent implementation PRs are open as drafts against `main` at
`97c8308`. Nothing has been merged.

- [PR #167: preserve damaged save slots](https://github.com/virtu333/rogue-emblem/pull/167)
  implements read-only inspection/allocation, occupied damaged and orphaned slots, safe entry
  guards, recovery cards, verified raw archival with resumable discard, separate archive
  retirement, native disk acknowledgement, and logout/cloud protection for recovery records.
  Clock-floor and hint keys alone remain cleanup bookkeeping and do not reserve an empty slot;
  inspection still preserves those bytes. Applying validated local/native/cloud recovery pairs
  remains in PR 7; unavailable repair sources are not advertised in this tranche.
- [PR #168: guard phase transitions](https://github.com/virtu333/rogue-emblem/pull/168)
  implements source-phase/current-roster guards and optional injected rejection diagnostics.
  Escape and removed-actor completion explicitly check the remaining players. Standalone
  terminal callbacks finish once; reversible scene Vision decisions can resume phase flow.
  Original session/turn ownership remains in PR 3.

Local validation: PR #167 passed 563 unit files / 9,013 tests; PR #168 passed 562 unit files /
8,987 tests. Phase/action checks plus all harness/simulation suites passed 27 files / 331 tests;
strict PR fuzz and full-run simulations passed. Deliberately restoring destructive reads or
removing the phase guard made the regression tests fail. Formatting, lint (existing warnings,
no errors), builds and the relevant data/content checks passed.

Both PRs await CI and review. Playwright Chromium downloads returned truncated archives, so
browser recovery/layout checks could not execute locally. Native acknowledgement and relaunch
have unit coverage; physical iOS validation remains outstanding. PRs 3–8 remain the next
implementation work, in the dependency order above.
