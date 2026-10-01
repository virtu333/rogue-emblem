# Stability review response: findings, specification and implementation plan (2026-09-30)

## Review basis and recommendation

The original source review covered `main` at `1a6e2d0`. The first version of this response
validated it against `97c8308ae0e1e9d73069e5fcd724c06814837883`, reporting source traces and
temporary reproduction probes. This revision rechecks the proposed fixes against that same
commit. Those earlier probes are evidence reported by the original author. Source findings remain
pinned to this commit; current implementation and verification evidence are recorded in the
follow-up tranche below. Names are preferable to line numbers as implementation proceeds.

Keep the eight-PR approach and the existing controllers, continuation formats and canonical
save keys. Finish the slot/phase follow-ups, ship the small cosmetic/death hotfix, then session ownership and the remaining action changes.
Do not require a permanent save-envelope migration or a complete combat-outcome refactor
before fixing these defects. The pair-write fix does need durable recovery evidence: an
in-memory snapshot and best-effort rollback cannot provide the guarantee originally proposed.

| Finding                            | Validated scope                                                                                                                                   | Priority / severity                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 1: reading deletes a slot          | Invalid/non-object metadata causes deletion of local slot data; cloud rows survive. Missing metadata also makes an orphaned run appear empty.     | Medium; preserve data first            |
| 2: reclass softlock                | Class/history can change before seal consumption, checkpoint and action completion; redraw/setup errors can abort the flow.                       | Medium                                 |
| 3a: partial combat checkpoint      | Strike presentation writes live HP; recovery can save before the exchange and its effects finish.                                                 | Medium                                 |
| 3b: effects without costs          | Healing, relocation and consumables can lose later cost, equipment-restoration or XP steps.                                                       | Medium                                 |
| 3c: incomplete post-combat effects | A cosmetic failure can prevent later removals, leaving third-party enemies at 0 HP and blocking Rout victory.                                     | Medium–High; highest gameplay priority |
| 4: stale continuations             | Cancellation resolves waits; shutdown/restart can make old continuations appear alive. Current orientation and Save & Exit gates reduce exposure. | Low–Medium; latent mechanism           |
| 4b: repeated phase transitions     | TurnManager accepts transitions in the wrong phase. Existing pipeline epochs reduce normal-play exposure.                                         | Low                                    |
| 5: mixed run/meta restore          | A successful first write and failed second write can leave a mixed or orphaned slot; local failures are not returned to callers.                  | Low–Medium; storage recovery work      |

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
   queued level-ups, rewards/deeds/history, membership of unit lists, action completion and, for fixed-v1 battles, the RNG cursor. Legacy-v1 keeps settlement
   draw order, but canvas text still draws from the battle stream; compare its RNG only
   between live play and resume on the same build.
   Cover player and enemy combat. This is a staged guarantee, not a claim that every action and
   phase flow has already been migrated.
2. **Original-session ownership.** Work started in a closed or superseded session cannot
   mutate state, save, finish an action or clear fields belonging to a newer session. Ownership
   is checked using the token captured when the work started, including catch/finally paths.
3. **Non-destructive inspection.** Listing, selecting and allocating slots never removes or
   overwrites data. Damaged, unreadable, orphaned and recovery-only slots remain occupied.
4. **Pair restore with recoverable failure.** Readers see a verified old or new run/meta pair.
   If writes and rollback both fail, the slot is explicitly blocked with durable recovery
   evidence until repair succeeds. This guarantee covers localStorage; eviction can restore
   canonical native keys without staging evidence. Do not promise that two independent storage keys are
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
memory and exposes save retry without charging costs or applying effects again. The latest
installed checkpoint wins: installing a new checkpoint replaces its failed candidate. A construction failure may retain older recovery evidence, but retry requires matching live gameplay and cannot roll back a newer action. A superseded retry returns
`checkpoint_replaced`. PR 6 integrates a player-facing retry control and makes destructive
exit flows respect the retained failure status. No-slot/tutorial
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
  that choice. Logout/clear-all clears backed-up playable cache while retaining damaged/conflicting data and
  recovery evidence; it must not force archive retirement as a sign-out condition. Partial
  archives can be retaken only before deletion begins; malformed records remain exportable
  and removable under a separate explicit copy-only confirmation. Keep cloud copies on local
  retirement. Exclude recovery slots from optional-history quota cleanup. Bound archive size
  without dropping sole evidence; export remains available when archival cannot fit.
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
- Park lifecycle waits cancelled by shutdown/replacement: do not resolve them, so old
  continuations and their finally blocks cannot resume. Scene teardown owns resource cleanup.
  Recheck original ownership when a completion is already queued before synchronous restart.
  Active timeouts settle with a distinct status; they may finish committed work only while
  ownership remains valid. Direct external UI promises can still resolve on destroy and need
  explicit original-token checks at their awaiting callers and state-mutating catch/finally.
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

## WS3: Narrow combat presentation boundaries (PR 5)

### Why an animation-loop catch is insufficient

`_runCombatResolutionAtSpeed` pays art costs and can await Phoenix presentation before
`resolveCombat`; strike callbacks write HP. `animateStrike` also invokes Teleporter
`executeWarp`, which selects a destination with RNG and moves the unit inside fades, and throws when HP-bar graphics are missing. Skipping that animation therefore changes
positions and RNG, even if final HP is subsequently applied.

`PostCombatEffects` mutates gameplay while yielding beats. A visual failure can stop its
generator before later effects. `removeUnit` guards a fade, but still mixes required death,
reward and Deathburst work with unguarded visual calls. Catching that whole function and
calling the death handled is unsafe. The current outer combat catch sees only attacker and
defender; a local `result` in the inner helper is not available there after rejection.

### Implementation

- Ship the small 3c hotfix first: isolate generator beats labelled optional, required unit
  removal and movement still run. Guard visual sites in removal, Deathburst and Entity splash;
  sweep zero-HP units across all three rosters at awaited settlement boundaries before
  synchronous battle-end checks. Commander survival requires positive HP, not membership alone.
  Preserve Phoenix, casualty accounting, rewards and Zombie remains through the existing
  removal path. Do not replace death settlement with array filtering.
- Include shared action completion in that first battle PR: village rewards and fog model
  updates are required; dimming, popups and overlay rendering cannot stop the checkpoint or
  phase handoff. Apply XP/growth/skill and level-up queue changes inside `awardScaledXP`
  before its floating text. This is a reordering, not a new XP subsystem.
- In PR 5, separate required Phoenix/art-cost and other domain work from cosmetic calls at
  narrow boundaries. Catch only presentation failures and continue required settlement while
  original ownership remains valid. Domain errors are reported and keep existing partial-settlement recovery: the catch clears
  the committed intent and consumes the action. Full domain-atomic settlement belongs to PR 8.
- Extract Teleporter destination choice, RNG and movement from `animateStrike` at the same
  logical strike point, preserving interim-HP eligibility and successful-play RNG order.
  Record from/to coordinates for presentation; missing sprites/bars cannot decide movement.
- Keep this PR to those boundaries, Teleporter and its failure matrix. Do not introduce a
  staged combat-resolution context or final-HP catch-up pass; PR 8 replaces that incremental
  architecture with shared complete combat settlement. Do not save half-applied domain work
  through a generic animation-error catch.

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
finish-only recovery assertions. Build the matrix on `tests/harness/JourneyBattleScene.js`, which runs the real BattleScene
with stubbed rendering; the headless harness lacks Teleporter. Use a presentation proxy that
throws at the nth visual call, including all-call failures, rather than an enumerated list
that silently misses new visual sites. Presentation/RNG invariance is required for fixed-v1;
older battles still draw RNG from direct text rendering. For both policies, live play and
resume must use the same RNG stream; retry re-persists the exact captured candidate without
recapturing or reseeding. Include the
current Canto confirm, Wait, Back and retap paths, plus Commander's Gambit refresh. Additional captures are permitted at durable action boundaries provided live/resume stream
identity is preserved; they are not permitted as a save-retry mechanism. Tests must assert
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
- Reuse the first battle PR's XP-before-text ordering in combat, staff and ability callers.
  No separate XP architecture is required here.
- Settle Blink usage and movement together. Staff relocation/Blink presentation takes recorded
  from/to coordinates and never writes `col`/`row`. Teleporter was already covered in PR 5.
- Settle Shove/Pull/Swap movement and cost before tweens; Rally, Healing Circle and Ensnare
  settle all targets before drawing; Dance refreshes before effects; Talk commits recruitment
  before consuming the lord's action; Ballista damage precedes the shot animation. Entity
  splash is already settled before guarded effects in #171; PR 5 only adds its matrix scenario.
  Preserve successful-play rules and costs.
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

- Retain canonical `emblem_rogue_slot_{n}_meta/run` keys and existing timestamp winner,
  run-record/lord union, conflict and clock-floor policies. Compute and validate a selected
  candidate before storage writes; successful fetches do not prove one backend revision.
- Replace the undo journal with exactly one forward-staging key per slot holding one candidate, its ownership and recovery evidence. Persist and verify it, then
  write and verify readable progression before the run. Keep the candidate until all writes
  verify; retry/startup recovery applies the same candidate forward, without new timestamps.
  Reuse the registered per-slot `pair_journal` key, or register its replacement in every
  inspection, cleanup and upload gate. Stage removal failure is idempotently retryable. Pending recovery reserves the slot and
  blocks manager construction, play, New Game, quota cleanup and uploads.
- A simple progression-first ordering alone is insufficient for cross-device pair recovery:
  cloud selection replaces whole progression records, and purchases/refunds/assignments are
  not monotonic. A mixed pair from ordinary live saves is not evidence that an arbitrary
  selected cloud run is compatible with old local progression.
- Preserve displaced evidence deliberately: `preserveCloudConflict` covers validated,
  materially different runs, not malformed runs, absent runs, metadata-only displacement or
  identical-run/different-meta choices. Capture raw pre-apply run and meta inside the stage
  before progression is written; retain every displaced run rather than dropping a second
  conflict. Use raw archival where evidence would be lost. Permit only the owning stage to
  pass its own conflict/recovery gate while applying.
  Measure actual serialized peak bytes; stage/backup quota failure must defer visibly without
  changing canonical gameplay fields. Optional history shedding may change valid unrelated
  slots only when explicitly using `setItemFreeingSpace`; measure and disclose that exception.
  Do not delete sole evidence to create space.
- Detect newer foreign canonical data before replaying an old stage. Retain evidence and defer
  rather than overwrite newer data. If validated canonical data equals or demonstrably supersedes the candidate,
  retire the stale stage only after any sole displaced raw evidence has a verified archive elsewhere. Newer timestamps alone do not prove compatibility. Foreign or ambiguous data retains the evidence and defers application visibly; explicit recovery/release remains available. Tag stages with account ownership and
  preserve it during logout. Recover offline too, after `nativeSavesReady` and before cloud
  pull, Title and ordinary readers or managers load.
- Exclude the temporary stage key from native mirror writes **and restore planning**, including
  already-mirrored stale records. Canonical native mirroring stays unchanged. Full native pair
  transactions are not this PR's release gate; stale stage resurrection must not roll back
  newer canonical data. Floor candidate canonical timestamps at the applicable native
  stamps so native restore cannot undo recovery. Native raw-discard acknowledgement in PR 1 remains separate.
- Track loaded-slot ownership explicitly in memory, register/release it at session entry/exit,
  and recheck at application time. Persistent `getActiveSlot()` is a preference, not ownership;
  registry values alone also outlive transitions. Use an in-memory managers-bound registry;
  keep deferred fetch results in memory and re-trigger application when managers release the
  slot, rather than relying on one successful background refetch.
- Put `resolveCloudSaveConflict` on the same recoverable pair writer; its current run-first
  best-effort undo is in scope. Protect hydration, conflict selection, `healLocalMetaFromRemote`, `pushAllLocalSlots` and
  `backupAllLocalSlots` under the same pending-recovery/ownership rule. Never upload a run
  without validated progression; where required, await progression upload success before run
  upload rather than assuming independent table queues preserve call order.
- Report network failures, local apply failures and intentionally deferred slots separately.
  Keep `rejectedCount` as fetch failures and do not treat it reaching zero as successful slot
  application. Bound storage retries and surface actionable recovery/space status.

### Acceptance

Inject failure at stage write/readback, progression write/readback, run write/readback and
stage removal; restart after every step and assert exact candidate forward recovery. Include
refunded/lower-tier progression, invalid/missing progression, malformed stages, quota pressure,
unchanged original bytes on preparation failure, conflicting evidence, unrelated slots,
selection during an outstanding fetch, upload ordering and metadata healing. Retry preserves
candidate timestamps and RNG; it never overwrites newer canonical state. Stale native stages
must be ignored with intact and evicted localStorage. Recovery precedes default-manager entry.

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

| PR               | Scope                                                                                                                | Size | Dependencies                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| 1 (#167)         | WS1: read-only slots, damaged-run protection, bounded raw recovery, account-safe logout/cloud guards                 | M    | None; pair repair integration follows PR 7                                       |
| 2 (#168)         | WS7: phase guards, removed/dead actor completion, production and strict harness diagnostics                          | S    | None                                                                             |
| 3c hotfix (#171) | Cosmetic isolation, third-party death cleanup, shared completion and XP model ordering                               | S–M  | None; ship before PR 3                                                           |
| 3 (#173)         | WS5: monotonic session ownership, parked cancellation waits, external dialogue/timer guards, checkpoint status/retry | M–L  | Stacked on #171; verify with #168                                                |
| 4 (#172)         | WS2: reclass controller plus promotion cost/weapon/checkpoint ordering                                               | S–M  | Rebased on #173; shared session contract required |
| 5 (#175)         | WS3: narrow required/cosmetic boundaries, Teleporter extraction and real-scene failure matrix                        | M    | PR 3 and hotfix; no staged combat context or HP catch-up layer                   |
| 6a / 6b / 6c    | WS4: staff/items; movement/abilities/recruitment/Dance/Ballista; local save retry UI | M each | Stack on corrected #175, then 6a → 6b → 6c |
| 7                | WS6: single forward-staged candidate, ownership, recovery and all hydration/upload paths                             | M–L  | PR 1 recovery UX; independent of battle work                                     |
| 8                | WS3 follow-up: shared full combat outcome and harness duplication removal                                            | L    | PRs 5–6 and design review                                                        |

PR 3 remains guards/API work rather than a settlement redesign, but the external UI promises
and terminal timers discovered during adversarial review make its actual patch medium-large.
Cancellation parking alone cannot protect promises owned by dialogue overlays or nested helpers;
those continuations also need originating-session checks. Keep the hotfix separate so this
audit cannot delay the confirmed dead-commander fix.

PR 7 excludes transient staging keys from both native writes and native restore planning.
Canonical native data continues to mirror as before; a new atomic native-pair protocol is
not a release gate. Browser storage recovery and account/live-slot ownership remain required.

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

## Implementation progress — initial tranche (historical)

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

The original heads passed CI; follow-up heads require their own checks. Playwright Chromium downloads returned truncated archives, so
browser recovery/layout checks could not execute locally. Native acknowledgement and relaunch
have unit coverage; physical iOS validation remains outstanding. The updated tranche and remaining PRs are listed below.

## Updated sequencing — 2026-10-01 implementation

First close the #167/#168 gaps, then ship the isolated 3c death/action/XP hotfix ahead of PR 3.
PR 3 covers originating-session cancellation and checkpoint retries. PR 4 reclass/promotion
can be developed independently; its acceptance is also run with session guards. PR 5 is the
narrow combat/Teleporter matrix, PR 6 the remaining actions, PR 7 forward recovery, and PR 8
shared full combat settlement. PR 7 can proceed independently of the battle work.

The real-scene matrix and adversarial restart verification are release evidence; test counts
and headless parity alone are not. `_persistBattleRunState` already returns `{ok, reason}`;
the wrappers that suppress failures are `captureCheckpoint`, `captureResolvedAction` and
`completeBattleAction`, so their caller contracts and explicit retry paths need the audit.

## Follow-up acceptance notes

Logout records a small verified account-ownership marker before signing out and retains damaged,
conflicting and archived bytes. Native logout requires a bounded disk acknowledgement of that
marker. A different account cannot hydrate or upload retained recovery bytes; malformed or
unreadable ownership fails closed. The original account can explicitly choose a preserved
cloud version. This is distinct from live-slot ownership required by PR 7.

Each raw archive is limited to 1 MiB of serialized UTF-16 bytes. Oversize/quota failure keeps
originals unchanged. Export remains available for malformed records. An additional discard
route requires the player to save, open and explicitly verify the exact exported bundle first;
it refuses changed bytes, shrinks the largest eligible meta/run/conflict value to a damaged-state marker if
space is needed, then writes a small reservation before deletion. It stores no second full
copy locally. The reservation states that originals live in the verified external file.
Freeing a slot or removing a recovery copy keeps the cloud copy.

## Published follow-up tranche — 2026-10-01

- #167 closes recovery dead ends, damaged-run entry, quota cleanup, cloud-copy retention,
  account-safe logout, bounded native acknowledgements and conflict-only choice routing.
  Adversarial verification caught additional stale Delete callbacks and full-quota export
  anchoring; these are covered by the follow-up regressions. The final follow-up head passed
  9,066 unit tests across 564 files and 197 targeted recovery/native/cloud tests, with format,
  lint (existing warnings), build, data/parity/content and e2e lane checks passing.
- [#168](https://github.com/virtu333/rogue-emblem/pull/168) adds real TurnManager coverage for
  removed/dead actors and resumed completion, production rejection reports and strict harness
  rejection handling. Its follow-up passed 8,995 unit tests and 234 harness/simulation tests.
- [#171](https://github.com/virtu333/rogue-emblem/pull/171) is the separate cosmetic/death hotfix,
  including shared completion, village/fog ordering and XP model changes before text.
- [#172](https://github.com/virtu333/rogue-emblem/pull/172) is PR 4, reclass/promotion commit
  ordering, stacked on #171. Its stack passed 9,004 unit tests and 218 targeted tests.
- [#173](https://github.com/virtu333/rogue-emblem/pull/173) is PR 3, session ownership and exact
  checkpoint retry, stacked on #171. Its stack passed 9,011 unit tests and 192 harness tests.
  Capture remains boolean for existing callers with structured retained status; explicit retry
  re-persists the frozen candidate. A player-facing retry UI remains later integration work.

Combined battle verification is preserved at
[`test/stability-stack-verification`](https://github.com/virtu333/rogue-emblem/tree/test/stability-stack-verification).
The combined source and actual shutdown/init class tests passed 9,038 unit tests, 193 harness
tests, 170 targeted tests and a production build. This branch is verification evidence, not
an additional implementation PR. Each implementation PR remains separately reviewable.

Planted regressions caught both the original phase/lifecycle defects and the follow-up save
rechecks, account guards, export reservation and class ordering defects. Presentation RNG
invariance is limited to fixed-v1; legacy live/resume stream continuity still applies.

Nothing has merged to main. The repository CI trigger currently targets pull requests into
main; #167/#168/#171 have queued new-head runs, while the stacked #172/#173 drafts will gain CI
when retargeted to main after their base lands; they have no CI run under the current branch filter yet. Chromium downloads were truncated locally,
so browser recovery/layout and physical iOS checks remain pending. PRs 5–8 are planned work,
not implemented by this tranche.


## Round-two implementation — 2026-10-01

See `stability-round2-remediation-2026-10-01.md` and
`stability-pr5-combat-boundary.md` for the reviewed fixes and PR 5 design.
CI PR #174 removes the base-branch filter so stacked PRs run the same checks.
The earlier verification branch was a squash aggregate; replace it with real merge
commits linking the published implementation heads. The round-three order is #174 and #168, then corrected #171, #173, #172 and #175. #167 lands separately after S1–S4. After #168 lands, merge main into #171/#173 and carry the verified phase/session resolutions; Escape must use checkPlayerPhaseComplete().

Freeing a local recovery copy retains an account-owned cloud-pending reservation until
a paired fetch applies or clears it. An unknown owner cannot be silently rebound.
A device user signed into another account can explicitly retire an old account's local
copy, but cannot release its reservation using the new account's cloud data. Native
blob downloads cannot attest an external archive; unavailable native mirroring offers
an explicit device-only logout choice that retains local evidence and ownership.

Verification results for the final heads are reported in their PR descriptions. Earlier
counts and unavailable-browser notes above are historical, not current-head evidence.


PR 5 implements `applyStrikeHP` before each strike's presentation and pure Teleporter
settlement before post-combat effects. Narrow guards cover art bars, strikes/skills,
XP/tutorial/story beats, level-up popups, Gambit tint and Canto/completion overlays.
Warp cleanup restores each target's original opacity on current-session failures.
The real-entry matrix has 22 scenarios and 11 focused lifecycle/retry/domain/contact/
opacity/Canto tests; normal baselines require actual impacts and zero error telemetry.
Every scenario compares settled and durable state across shown, skipped, paused,
missing-sprite, all-failure and every-nth-failure worlds. Seven non-equivalent combat
mutations were caught; two inner story-reporting mutants and the actual parked-chain
depth-reset mutant were also caught. Physical iOS and WebKit remain unverified.


### Final combined verification for round two

PR 5 is open as [#175](https://github.com/virtu333/rogue-emblem/pull/175); CI coverage
is [#174](https://github.com/virtu333/rogue-emblem/pull/174). Updated #167, #171, #173
and #172 retain separate reviewable heads; #172 targets #173. The verification
branch links the published heads as actual merge parents rather than a squash copy.

The merged source passed 574 unit files / 9,284 tests, 23 harness/simulation files /
236 tests, strict PR fuzz and full-run slices, all data/audio/content/lane checks,
formatting, lint and the production build. The final combined Chromium pass passed
22 tests without retries, including a real Teleporter normal/missing-bar/renderer-error
comparison of live and durable state. A temporary renderer-dependent warp mutation
failed that browser regression. Earlier independent branch passes covered 57 battle
and 22 save browser cases. Physical iOS and WebKit remain outstanding.

The full unit pass found constructor-free fixtures missing the now-required session
counter; those fixtures were updated without changing gameplay assertions. Current
main also added an opacity regression calling the removed `executeWarp`; it now uses
real settlement followed by `_presentWarp`, preserving its movement/opacity assertions.
The final unit rerun passed. CI is green on #167, #171 and #174; the final #173/#172/#175
heads are rerunning checks after fixture updates. Main remains unchanged.


## Round-three progress and release rules — 2026-10-01

The review and accepted PR 6 design are in `stability-round3-remediation-2026-10-01.md` and `stability-pr6-action-settlement.md`. #168 has merged (`31fb3524`); #174 remains open pending merge approval. All seven individual heads had green CI before the round-three fixes. Green CI does not establish the missing guard or reservation scenarios.

The latest installed checkpoint wins. Retry writes its frozen candidate through saveRun and cannot reapply costs, recapture, reseed, or append a timeline row. Retain an older failed candidate across a pre-install construction failure only as recovery evidence; retry must refuse it if live gameplay has advanced. Once a newer checkpoint installs, the older candidate is discarded. Local storage failure can return a refresh/crash to the last durable checkpoint; Retry or Keep playing makes that bounded exception explicit. Cloud upload protection with a durable local save does not trigger the local-save modal.

The prior round-two combined numbers (9,284 unit, 236 harness/simulation, 22 final Chromium cases) are local verification, not CI on the combined branch. Mutation counts are reports of executed checks, not independent coverage statistics. Same-build legacy live/resume and fixed-v1 presentation parity are distinct guarantees; cross-build resume parity requires a migration test and is not asserted by the live-play matrix. Physical iOS/WebKit remain unverified.

Known follow-up: construction-time controller sessions cannot identify an older continuation that lazily constructs a new controller after restart. Existing waits and continuation checks are guarded; full operation-origin propagation remains a separate audited API change. Paused current-session delayed helpers may settle immediately; shutdown/replacement waits park.


## PR 6 implementation and final local verification

Staff and consumables, movement/abilities/recruitment, and local save retry now implement the accepted settlement design. PR 6a is #176 and PR 6b is #177. Costs, HP/positions, growth and recruitment settle synchronously before the continuation checkpoint and optional presentation. Save retry keeps a frozen candidate, gates the next pipeline boundary, supports Keep playing and warned exit, and checks terminal/session ownership. Renderer failure cannot retain inaccessible modal/input ownership or prevent the retry writer.

The actual combined merges at source `4df5e656` passed 579 unit files / 9,509 tests, 14 harness files / 226 tests and 9 simulation files / 41 tests. Real Chromium verification passed 42 unique battle/action/retry cases without retries plus 9 slot-picker cases; retry layouts were inspected at 640×480 and phone landscape/portrait. Independent review reported 185 passing targeted tests. Physical iOS/WebKit and cross-build resume parity are not covered by those numbers. The strict PR harness fuzz suite passed 50 runs and the four strict full-run PR slices passed 42 runs without stuck cases or timeouts. These are local checks; CI on the published heads is queued.

The old fixture failures and the two independent retry review findings are documented in `stability-round3-remediation-2026-10-01.md`. The class-change, phase and damaged-save fixes are included in the combined source. No further architecture is introduced: construction-only controller origin propagation remains a disclosed follow-up; PR 7 pair recovery and PR 8 computed combat outcomes remain to implement.
