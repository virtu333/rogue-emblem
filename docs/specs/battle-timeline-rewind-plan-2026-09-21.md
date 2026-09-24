# Battle timeline and rewind — investigated implementation plan

Date: September 21, 2026
Status: T1–T4 implemented locally September 21, with verification and adversarial review. Fixed outcomes accepted for new battles; T5 is cancelled by Dave (September 21). Build 15 uploaded successfully September 21 at 17:52 Pacific; App Store Connect confirms Testing in Public Playtest, with notes saved and automatic notifications enabled. Physical-phone acceptance remains a tester check.
Source: [original proposal](battle-timeline-rewind-proposal.md). This document supersedes its implementation ordering and safety assumptions; the original remains design history.

## 1. Outcome and recommended scope

Give players a readable account of what happened, a safe board preview, and a deliberate way to spend one rewind charge to return to an earlier completed action. Preserve the game's punishing decisions: reading is free; reversing a committed action is not.

Recommended first release: both-phase history and previews, existing turn-start rewind, and completed **player-action** rewind destinations on Normal/Hard. Lunatic initially keeps turn-start destinations. Enemy actions remain review-only; enemy-action rewind destinations are out of scope by Dave’s September 21 decision. Persistence, migration, and failed-write handling are prerequisites, not a final optional phase.

No general browser playthrough in this investigation. Implementation will receive focused, muted browser contracts and a physical-phone check before release. Cloud expansion, native-store migration, balance changes, free undo, and a new charge economy are outside this project.

## 2. Investigation: what the source actually supports

These are code findings, not claims of newly reproduced production bugs. Line anchors describe this investigation checkout and may move.

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Enemy recovery already exists at selected level-up boundaries. | `BattleScene.js` `startEnemyPhase/onUnitDone` (~10070); `BattleSuspendController.captureCheckpoint/finalizeResume`; `AIController.processEnemyPhase` (~70) skips `hasActed` in array order. | Extend this path; do not build another AI replay loop or identify enemies by name. |
| A saved recovery point may still have a continuation, committed trade, or unfinished Canto. | `BattlePresentationCheckpoint.captureResolvedAction`; `BattleTradeMenu.transfer` (~111); turn-start popup capture (~9366); `BattleActionCompletion.completeBattleAction`. | Recovery points, readable events, and interactive rewind destinations are different concepts. Never delete anti-refresh captures merely because they cannot be offered in the viewer. |
| Live restore is not reversible preview. | `VillageController.restoreFromVisionSnapshot` (~177) removes convoy reward when going backward but does not re-grant it when moving forward. World restore also migrates units and clears danger state. | Reject the proposal's `restore(mode: preview)`. Rendering must use separate data and display objects. |
| Rewind currently debits first, applies, then captures without propagating failed save. | `VisionRewindController.executeRewind`; `BattleScene.applyVisionSnapshot` (~2813); `BattleSuspendController.captureCheckpoint` (~72). | New paid rewind requires one durable candidate transaction before publishing changed live gameplay. |
| Restore reseeding is followed by another reseed during capture. | `VisionRewindController._applySnapshot`; `BattleScene.applyVisionSnapshot`; `BattleSuspendController.captureCheckpoint`. | “Restore seed” alone does not guarantee replay. Persisting an existing boundary must not mint a new RNG boundary. |
| Names are ambiguous and can change. | `UnitManager.createEnemy` uses class names; promotion may rename; `BattlePresentationCheckpoint` finds actors by `unitName`. | Introduce battle entity IDs independent of RNG, retain IDs through transformations, and migrate old continuations conservatively. |
| State lives outside unit arrays. | Village reward writes `RunManager.addToConvoy`; `captureBattleWorldState` stores source references by snapshot-local group/index. | Include the battle-owned run mutation domain and preserve referential identity; not just HP/positions. |
| Death prompt currently intercepts commander/empty-field loss only on enemy phase. | `BattleScene.checkBattleEnd` (~10434). Non-commander lord death is not always game over. | Define fatal interception explicitly, including player counterattack and automatic damage, without changing which losses end a run. |
| Full-map reset is already intentionally allowed. | `RunManager.clearBattleInProgressInSave` (~4201) restores battle-entry charge/count/RNG then clears the suspended battle. | Keep this separate from paid rewind; clear history and prevent battle-earned value surviving reset. Do not advertise absolute prevention of resetting a battle. |
| Version-1 checkpoints already have both player and enemy forms. | `BattleSuspendController._buildCheckpoint`: `version: 1`, `phase`, pending continuation and embedded Vision snapshots. | Migrate by payload capabilities, not build number or an assumption that v1 means player phase. |
| Charge text in the original proposal is stale. | `RunManager.completeBattle` (~2941) grants a charge for act1–act4 bosses. | Preserve current grants; do not silently lose the Act 1 fix. |

Baseline verification: **170 tests passed across five files**: VisionRewindController, BattleSuspendController, BattleSnapshotContracts, BattleScenePhaseRaces, and harness/JourneyCombat. Log: `/tmp/timeline-investigation-tests.log`. Those tests establish the existing baseline; they do not yet verify the proposed timeline. Several fixture paths stub RNG/rendering, so full replay claims require stronger tests below.

### Production integration map

| Surface or boundary | Current owner | Work required |
| --- | --- | --- |
| Normal attack, counterattack, proc/crit/HP/post-effects | `BattleScene._runCombatResolutionAtSpeed`, `executeCombat`, `executeEnemyCombat` | Capture authoritative event facts plus final post-effects; do not stop at forecast or raw strike damage. |
| XP and learned skills, pending reveals | `BattleScene.awardScaledXP`; `BattlePresentationCheckpoint` | Attach grants to the same action ID across recovery; never grant while replaying UI. |
| Action completion, Canto, Gambit | `BattleActionCompletion`; `BattleScene.finishUnitAction`; `completeResolvedAction` | Finalize only after full action obligations; keep current continuations. |
| Explicit End Turn | `BattleScene.forceEndTurn` | One end-phase event and recovery boundary; automatic enemy handoff remains explicit. |
| Trade and committed equipment | `BattleTradeMenu.transfer`; native/legacy equip callbacks in `BattleScene` (~5316, ~5358) | Record actual mutations; preserve commitment; no synthetic landed action after a partial trade. |
| Healing, cure, relocation, multi-target staves | `HealController` | Record all actual targets, HP/condition/position changes and uses, not just the caster. |
| Blink and other abilities, weapon arts, promotion | `AbilityController`, `WeaponArtController`, `PromotionController` | Record costs and secondary effects; promotion selection/reveal cannot become a destination. |
| Talk/recruit, shove/pull/swap/dance, items, ballista | Their `BattleScene` execute paths and shared completion | Separate producer coverage rows per action during T1; completion alone cannot infer what happened. |
| Village visit/raze, caravan exit, escape | `VillageController`, `CaravanController`, `EscapeObjectiveController` | Include convoy provenance, unit removal/escape, cash, objectives and visible event projection. |
| Enemy action variants and phase tail | `AIController` callbacks; `BattleScene.startEnemyPhase` | Include heal/status/break/asleep events; keep caravan, terrain and reinforcement stage ordering. |
| Automatic damage, deaths and resurrection | `processTurnStartEffects`, `processTerrainDamage`, `processBallistaFire`, `removeUnit`, tombstone revival | Capture causal child events and settle death chains before fatal decision or destination. |
| Victory and post-battle arrivals/rewards | `PostCombatController`, `BossRecruitOverlay`, `PendingRewardController` | Boundary is final. Boss recruit is post-victory, not the mid-battle Talk path. Do not rewind completed run settlement. |
| Entry, resume, sanctioned reset, fatal exit | `RunManager.beginBattleInProgress/fromJSON/clearBattleInProgressInSave`, Title/slot resume UI, `PostCombatController.onDefeat` | Dispatch new recovery kinds correctly; clear battle domain/history together; never route fatal state through ordinary all-acted resume. |
| Input ownership | `MenuSurface`, `InputController`, `MobileBattleHUD`, `utils/MobileControls`, `escPriority`, tutorial controller | Shared availability and one modal scope; prevent grid/rail/hotkey activation underneath. |

This is the investigated ownership map, not a claim that all producer hooks already exist. T1 must turn each row into explicit supported action coverage and record any missing fields before implementing destinations.

## 3. Player-facing contract

### Names, navigation and preview

- Use **Rewind** for the existing battle button, with a visible charge count; title the screen **Battle timeline**. Explain once that these are Sera's Vision charges. Avoid replacing a familiar verb with an unexplained resource name throughout the interface.
- Opening history never spends a charge and remains available at zero charges. Separate `canOpenHistory` from `canCommitRewind` and `canLandAt(entry)`.
- Landscape phone: map preview on the left, scrollable history/details on the right, fixed Back and explicit **Rewind here · 1 charge** control. Portrait: bounded preview above the list, fixed controls, safe-area padding. Prefer latest-first phase groups with a visible **Now** row.
- Tap or keyboard/controller focus on a history row selects/previews it. A second tap/Confirm on that row still only selects. Only the dedicated rewind button opens the confirmation. Scrolling, slide-off, long press, focus changes, and background taps cannot spend a charge.
- Confirmation identifies the destination and cost: e.g. “Return to Turn 3, after Sera healed Edric? Spend 1 charge (2 remaining).” Cancel restores row focus. Selecting **Now** or the unchanged current destination cannot spend.
- Preview says **Preview · Turn N · Player/Enemy phase**. Show HP, positions, visible terrain/conditions and relevant outcome details; no forecasts, AI predictions, hidden stats, active terrain taps, or active danger controls.
- Back closes preview without changing selected unit, provisional movement, equipment preview, camera, highlights, pins, RNG, save bytes, or the prior input scope. A successful rewind deliberately clears stale planning state and pins and explains the destination.
- Support ordinary idle and pre-move planning states first. Do not open on top of trade/item/promotion/level-up modals or mid-action/Canto. A disabled control says “Finish this action to review the timeline.” Never cancel a committed move just to open history.
- Fatal prompt is a special frozen entry path; closing history returns to the fatal prompt, not to a controllable dead board.

### What counts as a destination

Three explicit categories:

1. **Event:** a historical outcome, possibly view-only. A miss, death, level-up, or reinforcement can appear inside a parent action's details without being its own destination.
2. **Recovery point:** data sufficient for crash/resume, including continuations. Existing saves continue here even if the timeline cannot land there.
3. **Rewind destination:** a validated completed action boundary with no unresolved continuation, movement choice, death chain, presentation, or external reward transition.

Player destinations include playable turn starts and completed actions after Canto/Gambit and automatic action-end grants finish. Trade transfers save and log immediately but initially become a destination only when the initiating action is fully complete. Log Equip changes that are committed; preview-only equipment changes are not actions. End Turn is one explicit boundary, not one invented Wait event per unit.

The last player's completed action may immediately hand control to the enemy phase. Label it **Before enemy phase** and state that enemies act next. Do not grant an extra player action. Final escape/seize/rout victory has no rewind destination beyond the committed battle result; rewards remain final.

### Charge and randomness recommendations

- Keep current per-run charges, upgrades, and boss replenishment. One successful rewind costs one charge regardless of distance. No free action undo. Existing pre-commit movement cancellation remains free.
- Normal/Hard: completed player-action destinations. Lunatic: turn starts. All modes can read retained history.
- Recommend fixed randomness at each destination: repeating the same **committed gameplay actions** reproduces outcomes; changing those actions may change them. Read-only forecast browsing does not count as a changed plan. No automatic promise that replaying a fatal plan survives. Explain this in the tutorial and confirm help.
- This is a deliberate change from the intended current paid-reroll design and needs Dave's acceptance. Do not add unused free-undo/reroll configuration variants just for hypothetical flexibility. Store the selected policy/version on the battle, so an upgrade cannot silently reinterpret an active battle.

## 4. Data and architecture

### Canonical data, separate effects

Do not call a function taking a Phaser scene “pure.” Use a thin scene capture adapter to assemble plain data; a pure validator/codec handles cloning, references, versions and bounds. Keep rendering and runtime reconstruction in UI controllers.

Proposed modules (names may follow local conventions):

- `engine/BattleStateSnapshot.js`: history-free canonical state, validation and normalization. Share state contracts with existing `BattleSnapshotState`; avoid another competing serializer.
- `engine/BattleTimeline.js`: entries, snapshot references, branch truncation, bounded retention, migration. No scene, storage, RNG or wall clock dependency.
- `engine/BattleLogFormatter.js`: plain immutable facts → readable summaries/details. No inference from current units or re-running combat.
- `ui/BattleCheckpointAdapter.js`: capture scene state and publish an already validated restored state; reuse suspend's relinking and world reconstruction with in-place unit-array updates to preserve TurnManager references.
- `ui/BattleTimelineController.js`: begin/finish action records, availability, dialog ownership, frozen fatal context and commit coordination.
- `ui/BattleTimelinePreview.js`: isolated display projection. It cannot call scene gameplay setters, `removeUnit`, `restoreFromVisionSnapshot`, persistence, or RNG. Use a dedicated preview surface/render layer with its own camera/objects; the live board remains untouched behind the modal.
- Keep `BattleSuspendController` responsible for recovery scheduling/continuations and `VisionRewindController` as a compatibility facade until old callers migrate. One shared commit path, no second canvas timeline implementation. A no-DOM environment retains legacy rewind **presentation only**, using the same transactional backend and battle policy; it must not retain the old debit/apply/save ordering.

### Identity and ownership

Assign `battleEntityId` at initial spawn/recruit/reinforcement with a persisted deterministic counter. Names are display labels only. Retain identity through class/name/faction change and escape; define resurrection identity explicitly (returning entity versus newly spawned replacement). Unit/item IDs, event IDs, branch IDs and RNG state are separate domains. Use existing item UIDs and `relinkWeapon`; assign missing IDs at creation/migration, never while previewing/serializing.

Canonical snapshot inventory must enumerate:

- Player/enemy/NPC/escaped/non-deployed unit data; live stats, item identity, equipment, flags, conditions, action/movement state, once-per-battle uses, buffs and source references.
- Turn/phase and phase-stage, recovery continuation, objectives, gold earned, deaths, terrain/temporary terrain, fog, ballistas, tombstones, village/caravan state, reinforcements and pressure/AI state.
- Battle-owned RunManager changes: convoy, any mid-battle roster/economy mutation, and provenance needed to undo them. Prefer exact snapshots of the small battle-owned domain to one-off reverse hooks. Inventory every writer reachable from battle before deciding fields. Do not snapshot the entire RunManager or historical charge balances.
- RNG state/version and logical action position. Monotonic history IDs and pruning never drive randomness.
- Separate narrative/tutorial policy: dismissed instructions stay dismissed; cosmetic dialogue history does not refund charges or replay rewards. Reset stale fatal attribution when restoring; log its original visible facts by value.

Store one current recovery state and separate timeline entries/snapshot table. Historical state cannot embed `visionSnapshot`, `pendingVisionSnapshot`, `battleInProgress`, or another timeline. No recursive snapshots. Snapshot references are immutable and validated after JSON load.

### RNG boundary work

Current global `Math.random` replacement and per-save reseeding need an explicit contract before action rewind:

1. Add an exportable battle RNG cursor/state adapter using the existing algorithm; verify its output against `createSeededRng`. Keep this scoped to battle ownership, not a whole-engine dependency-injection rewrite.
2. Separate pure capture, fresh gameplay boundary handling, and persistence of an existing boundary. Preview, serialization, retry, IDs, restore graphics, and pruning consume zero battle draws. Publish the target RNG cursor only after reconstruction so graphics cannot alter the next roll.
3. Preserve legacy checkpoint initialization from `rngSeed` for old saves. New cursor snapshots carry a schema/algorithm version. Fixed-policy restores must not be followed by the old “increment checkpoint index and reseed” path; retries persist the same candidate.
4. Make read-only forecast sampling non-consuming. `_getGamblerAtkDelta` currently draws from `Math.random`, and changing targets replaces the cached session. Use a stable forecast sample keyed to the persisted gameplay boundary, actor/target IDs and relevant rule inputs, or a rigorously tested peek/commit mechanism. Never key to history entry IDs, pruning or UI visits. The displayed Gambler result must equal the value used by resolution. Direct attack and forecast A→B→A→attack, cancel/reopen, and weapon cycling back to the original choice must yield the same final committed result and subsequent gameplay stream. A committed weapon change remains a gameplay action.
5. A history viewer must not invalidate a live cached forecast roll. Clear/rebuild sessions only on committed restore. Test forecast sampling through rewind and reload as well as direct combat. Fixed-outcome eligibility is blocked until these properties hold; do not narrow the user promise to require repeating UI browsing.

Do not infer RNG integrity from the existing journey fixture, which replaces `reseedBattleRng` with a counter/seed recorder. Add real-stream production-orchestration tests, and compare Normal/Fast/Instant plus open/close-preview variants.

### Durable commit protocol

Paid rewind is a transaction over **target recovery state + battle-owned run data + current charge debit/count + truncated history + RNG policy/state**.

1. Hold modal/input ownership; reject duplicate activation and revalidate target, current run/battle, destination policy, charge balance and branch revision.
2. Construct and validate a detached candidate using current non-rewindable run metadata and the target's rewindable domain. Charges come from the current ledger, never from history.
3. Write the candidate to the existing slot's single run record through the save service. Preserve normal savedAt ordering and cloud callback behavior. Current local success is authoritative; cloud is not required.
4. On local failure, publish nothing: same live board, charges, history and RNG; show Retry/Cancel. Retry the same validated intent without duplicate debit. If retention pruning changes the candidate, revalidate selected-target retention.
5. After local success, invalidate superseded async work and adopt the candidate once. Restore the board and phase using existing reconstruction. No action/grant/resolution is re-executed merely to render. If reconstruction fails, keep input locked and recover by reloading the committed checkpoint, rather than refunding/debiting again.
6. Refresh at any point yields either the complete old state or complete new state. No second “save after apply” that replaces the target RNG. Later natural gameplay boundaries save normally.

Fatal contexts must quiesce the entire action/phase continuation, not merely set `visionDialog`. A pause flag can cause current AI loops to exit; closing a read-only viewer must not accidentally resume a dead action or trigger the tail. Establish one fatal-decision token, retain it through nested confirmation, and settle with Rewind or Accept Fate exactly once.

### Fatal recovery and accepted defeat

Charged fatal review needs an explicit persisted recovery kind, **`fatal_pending`**, separate from playable/continuation recovery and accepted defeat. Store the original commander entity ID, settled fatal board and visible event facts, phase/action completion status, the current charge ledger, and available validated destinations. Persist this envelope before making the fatal prompt interactive. It is not a rewind destination itself.

- Resume of `fatal_pending` opens the frozen fatal prompt; never start AI, replay the fatal attack, run all-acted auto-advance, or make another surviving lord commander. In particular, bypass the existing `RunManager.fromJSON` survivor-based `stampCommanderFlag` repair for explicit new-schema commander identity. A dead commander with living Sera is a required regression case.
- A refresh from the prompt, timeline or nested confirmation returns to the same fatal decision. Do not allow **Continue from map** to clear `fatal_pending`: the existing sanctioned reset applies before resolved terminal loss. Ordinary nonfatal restarts retain their current policy.
- A failed fatal-envelope write holds the outcome locked with an explicit save failure/retry state, allowing no gameplay or charge spend. State honestly that force-closing before a successful write may restore the last durable save; storage failure cannot be made durable by UI promises. Reuse the same envelope on retry.
- Accept Fate uses the existing defeat settlement pipeline exactly once, with a durable outcome/decision identity; after accepted defeat, refresh must route to game over and cannot reopen charged rewind. Audit run/meta reward finalization for idempotence rather than assuming multi-key writes are atomic.
- At zero charges (or no compatible destinations), preserve the existing immediate durable defeat lock and expose a **read-only terminal report** afterward. Retain only bounded player-visible history/projections for this report, not usable rewind targets. Reading does not defer loss or unlock the board. Terminal write failure needs the same explicit retry treatment.
- Tutorial standalone death/retry remains scene-scoped; never invent a run save for it. Update its teaching flow against the same input/charge rules where applicable.

### Fog and truthful event recording

Record facts at the production action hooks before objects disappear, then finalize the parent action after all effects resolve. Combat `result.events` supplies strikes/procs, but does **not** replace post-effects/XP/death/phoenix/terrain/loot accounting. Record actual final HP deltas and grants after their owning code applies them. Enemy heal/status/break, player staff/item/ability/ballista/talk/escape, phase effects, caravan steps, and reinforcement visibility need explicit producers.

Persist a player-visible projection at event time. Do not format historical rows by consulting today's visibility. Hidden enemy moves, exact positions, stats, identity, reinforcements, and AI reasons must not leak into text, accessibility labels, preview objects, or exports. An observable hit from an unseen attacker may say **Unseen enemy** with the observed damage, without exposing its location. Internal restore state may contain all enemies; the UI must never receive that unfiltered object. Selecting an old row must not reveal information learned only later.

Use a durable action ID to merge event fragments across continuation saves and resume. Reload during a level-up must complete the action once without duplicating its damage/XP/log row. Truncate abandoned-future rows and snapshots on rewind; keep a small explicit rewind marker and current charge ledger outside the discarded future. Do not present the abandoned future as a prediction.

### Retention, migration and reset

- Same retention contract before and after reload. Start by targeting current turn plus three previous turns of action destinations; under byte pressure evict oldest action snapshots first, preferring recent turn starts. Never evict the latest recovery state or a target in an in-progress commit.
- Bound **both** event count and snapshot bytes. Proposed initial caps for measurement: 500 parent events, 512 KiB optional history per slot, with a separate total-run-size guard. These are provisional engineering budgets, not claims about universal iOS quota. Measure realistic 20/40-unit inventories and 30/100-turn battles before finalizing.
- Display **Earlier history unavailable** for pruned information; do not label rows rewindable without their snapshots. Do not invent exact per-strike board snapshots: first-release board previews correspond to finalized events/action boundaries; strike details remain text under their parent.
- Quota fallback strips optional history before retrying the required latest recovery save. A paid rewind may never silently downgrade to a different destination. Preserve a safe turn-start anchor when possible; explain when retained history is shortened.
- Version-1 migration preserves the existing latest recovery point, including enemy `hasActed` and continuations. Missing-policy saves map explicitly to **legacy policy for the entire already-active battle**. Initialize fixed policy only on the next new battle; normal capture cannot switch policies. Old battles may gain readable history, but action destinations remain unavailable. Migrate legacy turn-start anchors only when their restore domain can be proven complete; otherwise keep the verified legacy destination under the new transaction backend and clearly limit history to **History begins here**. If an anchor cannot be safely adapted, disable it with an explanation rather than inventing missing convoy state or matching duplicate names heuristically. Never mix legacy and fixed anchors in one battle.
- Corrupt/oversized/unknown history is discarded independently of a valid current recovery save. Validate before allocations and cap arrays/strings/references. An invalid current state must use existing recovery UX, never silently initialize a new run.
- “Continue from map” is still the sanctioned full restart, with entry-time charge/RNG semantics. It must discard timeline and all battle-owned earned value together. Audit its existing convoy rollback limitation as a prerequisite; add an entry-domain snapshot if needed. Cloud-on serialization must remain compatible, but broad sync work is deferred.

## 5. Delivery slices and acceptance gates

Each slice is a local reviewable commit. Keep the released game playable between slices; do not expose incomplete destinations. No calendar estimates until the first two slices settle state inventory and size measurements.

### T1 — State inventory, identity, and recovery contract

- Enumerate all checkpoint captures, outcome producers, battle-owned run writers and restore readers in a checked-in coverage table.
- Introduce IDs, history-free state codec, explicit recovery/destination classification and capture adapter; preserve existing recovery/rewind behavior.
- Cover duplicate names, promotion, faction change, item relinking, trade/Canto/Gambit and every unit/world flag. Measure representative state sizes and record evidence.
- Gate: current focused baseline plus canonical state round-trip and deliberately omitted-field calibration. Old save fixtures continue to resume.

### T2 — Transactional rewind, RNG and bounded persistence

- Implement detached candidate persistence/adoption, fixed-policy RNG state, non-consuming forecast/Gambler sampling, branch identity, retention and capability-based migration.
- Prove current turn-start rewind through the new path first; do not yet expose arbitrary action targets. Preserve legacy policy for the entirety of already-active battles; new policy starts next battle. DOM and no-DOM entry points must share transaction and failed-write rules.
- Correct battle-domain rollback for the existing map-restart path if the inventory audit confirms earned value survives it.
- Gate: real RNG replay, failed-write and interruption matrix, current charge ledger across repeated rewinds, size limits, malformed optional history, legacy v1 player/enemy/continuation saves. Adversarial code review before UI integration.

### T3 — Event log and isolated mobile viewer

- Record both phases and all action kinds through real producers; persist fragments at existing anti-refresh boundaries. Add preview projections at finalized visible boundaries and a bounded DOM history view.
- Read at zero charges; show and confirm only currently supported turn-start destinations. Wire HUD, keyboard/controller, input scopes and tutorial terminology. No live-board preview mutation.
- Gate: preview purity (including village rewards and forecast cache), fog privacy, read-only zero-charge history, ordering/duplication after resume, phone/portrait/rotation/long text/input ownership. Use focused browser scenarios, not a full campaign.

### T4 — Player-action destinations and fatal-decision flow

- Enable validated action destinations and difficulty policy; show consequences of landing at end-of-player-phase. Keep incomplete-action recovery records non-selectable as destinations.
- Integrate commander/fatal loss in either phase and automatic-effect sources after asynchronous death chains have settled. Implement the durable `fatal_pending` envelope, explicit commander identity and dedicated resume routing above. Preserve current non-commander death rules. At zero charges, retain immediate defeat settlement and provide a read-only terminal report afterward.
- Teach preview versus commit, one-charge cost and fixed outcomes. No free undo; no enemy-action landings yet.
- Gate: lethal player counterattack/enemy attack/terrain/death-affix cases, Back→fatal prompt, refresh in prompt/viewer/confirmation, dead commander with surviving lord on load, fatal/terminal save failure and retry, zero-charge terminal report, duplicate Accept Fate/rewind, Canto/trade/dance/Gambit, final escape/victory boundary, repeated rewind→reload. Independent adversarial review and muted browser verification. **Recommended first complete feature release.**

### T5 — Enemy-action destinations (cancelled September 21)

Dave chose to skip this feature. The original design below is retained for history, not planned work.

- Extend current completed-enemy boundary using ordered persistent IDs and acted flags; explicit stage is `enemy_actions`. Do not offer checkpoints inside caravan movement, terrain damage, reinforcement insertion, turn transition or pending popups.
- Reuse `startEnemyPhase({resume:true})` semantics and validate ordering rather than creating a second AI controller. Determine whether extra order metadata is required from real tests; names are never sufficient.
- Explain “Enemies continue from here.” No player action is granted at an enemy landing. Quiesce the old epoch before publishing; guard both the remaining AI and the tail.
- Gate: enemy heal/status/attack/break/raze/sleep/death; revived/new entities; last enemy then terrain/reinforcements exactly once; refresh immediately after commit; same remaining results and no repeated caravan step. Separate review focused on async continuation.

## 6. Verification strategy

Production methods and real storage adapters remain under test. Stub only presentation when testing state; use real RNG, AI and orchestration for replay claims. Reload always reads the last application write—never save as part of the test's reload action.

Required invariants:

1. Open/select/scroll/close preview leaves canonical live state, run-owned resources, RNG continuation, charge ledger and persisted bytes identical.
2. Successful rewind is one atomic durable state with exactly one debit. Failed write is none. Refresh and repeated Retry cannot duplicate items, XP, gold, recruits, charge debits or log rows.
3. At **fixed-policy destinations**, the same committed actions reproduce canonical outcomes, including after reload. UI speed, read-only forecast/preview navigation, history pruning and entry-ID generation do not change those outcomes. Legacy-policy paid rewinds retain their explicitly versioned behavior; ordinary resume still reproduces the stored continuation under either policy.
4. Recovery continuation retains its anti-refresh guarantee even when not a rewind destination. Last-action/phase-tail work executes exactly once.
5. Visible historical text and board projection contain only knowledge available at that recorded moment.
6. Retention/migration never destroys the valid latest recovery state, fabricates missing history, or recursively embeds history.

Calibrate each invariant with targeted mutations: remove one convoy field; debit outside the saved candidate; recapture/reseed after restore; format with current visibility; duplicate continuation finalization; delete enemy acted marker; skip tail guard; exceed/cycle snapshot refs. The relevant test must fail for the intended reason.

Extend `tests/harness/JourneyCombat.test.js` and journey actions with open/close history, legal selected rewind, save failure/retry, reload and branch divergence. Persist seed, fixture, resolved action trace, policy/version and first state diff. Report per-action coverage so repeated Back does not masquerade as meaningful fuzzing.

Add a dedicated timeline test command to `package.json` and explicitly include it in the merge gate; `test:unit` excludes harness tests. Add new browser specs explicitly to `test:ux-contracts` (its current file list is enumerated). Run focused suites per slice; before release run unit, journey, relevant harness/full-run gates, data/reference/theme checks where touched, build, code adversarial review, and focused browser specs. Physical iPhone validation covers touch scrolling/slide-off, notch/rotation, resume existing save and long-history performance.

## 7. Decisions proposed for Dave

1. Release through T4; enemy-action rewind cancelled by Dave on September 21.
2. Fixed outcomes for repeated identical inputs; no paid reroll, no free same-phase undo.
3. Keep current charge economy; Normal/Hard action destinations, Lunatic turn starts.
4. Keep battle button **Rewind**; screen **Battle timeline**; Vision stays explanatory flavor/resource terminology.
5. Keep the full-map restart option and its existing refund policy separate from paid rewind.

Dave approved these decisions before execution, including fixed randomness for new battles. The implementation record below distinguishes shipped behavior, verification evidence, and remaining release checks.

## 8. Adversarial review disposition

Two independent passes completed: a source-focused state audit and an adversarial review of the revised plan. No gameplay changes were made during either review.

State audit findings incorporated: unsafe live preview, incomplete recovery boundaries, ambiguous names, run-owned convoy domain, non-atomic debit, double reseeding, nested-history risk, old-save capabilities, and existing enemy resume/reset semantics.

| Adversarial finding | Resolution in this plan |
| --- | --- |
| **R1 — High:** fatal dialogs had runtime quiescence but no durable recovery kind; survivor migration could promote Sera to commander after the original commander's death. | Explicit `fatal_pending` envelope, original commander ID, dedicated resume, fatal/terminal save failure behavior, no fatal map-reset bypass, immediate zero-charge defeat with read-only terminal report, and dedicated regression matrix. |
| **R2 — High:** fixed-outcome promise excluded forecast browsing, which currently consumes Gambler RNG. | Non-consuming keyed/peek forecast sampling is a T2 prerequisite. Direct action versus A→B→A/cancel/weapon-cycle must match, including displayed result, later stream, reload and rewind. |
| **R3 — Medium:** legacy battle policy and no-DOM fallback could accidentally retain unsafe old commit ordering or switch policy mid-battle. | Explicit policy adoption on the next battle only; no-DOM means presentation fallback, with shared transaction backend. No mixed-policy action destinations. |

Reviewer judged the revised sequencing sound as a multi-slice feature project, with enemy-action rewind kept separate. A narrow recheck confirmed R1–R3 resolved with no remaining material planning blocker; its final clarification limiting identical-action replay to fixed-policy destinations is incorporated in invariant 3. These are resolved planning findings; implementation still needs code-level adversarial passes and the acceptance evidence above.

## Execution record

### T1 — canonical state foundation

Implemented history-free capture, battle entity IDs, exact equipped-inventory references, shared presentation-field exclusion, recovery/destination classification, and a canonical state validator. Compatibility envelopes retain the existing Vision anchors for old callers; the pure captured state never embeds history.

Battle-owned run writer inventory: village rewards append to convoy; field inventories, recruitment, combat XP, conditions, and skill uses belong to the five battle unit groups; kill/escape rewards accumulate in scene goldEarned until settlement. Convoy, accessories, and gold form the explicit run-domain whitelist. Dialogue-shown flags stay outside rewind. PostCombat completion/reward/fallen-item transfers are settlement and therefore outside valid destinations. Existing one-way village rollback will be replaced by exact domain adoption in T2.

Adversarial review caught and fixed non-cloneable affixPips, legacy player/enemy name collisions in continuations, incomplete off-field identity registration, and overly weak validator shapes. The shared serializer now excludes affix pips; legacy continuation lookup is player-scoped; restore reserves all existing roster IDs before allocating missing IDs.

Verification: 187 targeted tests passed across seven state/RNG/recovery/phase/journey suites. The earlier broad foundation run passed 5,518 unit tests; that count predates the review regressions. Approximate JSON size with five weapons and three supplies per unit: 47,700 bytes for 20 units, 94,100 bytes for 40. This confirms that optional-history retention must budget snapshots, not just rows; 512 KiB cannot promise four complete turns of action snapshots in a crowded map.

T2–T4 remain unfinished. No timeline UI or paid-action rewind is enabled by this foundation slice alone.

### T2 — transaction and randomness foundation

New battles select fixed-v1; resumed flags without a policy retain legacy-v1. Stateful Mulberry32 cursors match the prior generator, pure checkpoint capture no longer reseeds fixed-policy battles, and Gambler forecasts use a stable keyed draw independent of combat draws. A scoped Phaser text factory prevents legacy text UUID allocation from advancing battle randomness. Between-battle UI is unaffected.

Paid run rewinds now prepare a detached run record, write the target/domain/charge debit together, and reconstruct only after local success. Confirmation intents bind to battle identity and a persisted rewind revision. Failed writes retain the old battle/charge; fatal-origin cancellation returns to the fatal decision. Restoration failure offers reload of the committed checkpoint rather than a second debit. Tutorial-only rewinds remain memory-only. Full-map reset restores the battle-entry convoy/accessories/gold.

The bounded pure history module is ready for recorder integration: 32 tests cover pruning, references, migration, revision/ID behavior and representative inventory budgets. T3 wires it into production boundaries and supplies the viewer; it is not exposed by the T2 foundation alone.

Review regressions cover fatal-failure cancellation and repeated confirmation. Real save-service tests verify one slot write contains both target and charge spend, plus write/quota failure, stale intent, incompatible policy/cursor, and full-map reset domain rollback. Further feature-level adversarial review remains required after T3/T4.


### T3/T4 — timeline viewer, player-action rewind and fatal recovery

Implemented the first feature release locally. The battle Rewind control opens a free, isolated historical preview, including when charges are exhausted. Event-time fog filtering applies to map markers, terrain knowledge, unit lists, and combat text. Selecting a row never reconstructs the live board. A separate confirmation commits a selected destination and exactly one charge together. Normal/Hard support completed player actions; Lunatic and legacy-policy battles retain turn-start destinations. Enemy actions appear in history but are never rewind destinations in this release.

History is produced at existing completed player/enemy action and turn-start boundaries, with recovery fragments for interrupted actions. Combat rows use actual strike outcomes; completion records include resulting HP, level, position, inventory, equipment and status changes. Escape, refresh, death and terminal defeat have explicit facts. A resumed action fragment keeps its durable row ID and is finalized once. Some utility actions use their resulting state changes plus a generic completion label; the history is a factual action summary, not a full animation transcript or AI explanation. The preview uses an independent small board with terrain abbreviations and numbered visible-unit markers; it deliberately does not redraw the live Phaser battlefield.

Fatal decisions freeze only after settled effects, preserve the original commander ID, and write a dedicated fatal recovery checkpoint before offering choices. Reload returns to the decision; map restart cannot bypass it. Accept Fate writes a detached terminal result before publishing defeat or settlement. A failed fatal/terminal save stays paused and offers Retry. With no charges or compatible destination, defeat proceeds to a free, read-only battle report. Optional history is pruned under storage pressure before sacrificing the authoritative recovery write; the already-selected paid rewind target and debit remain in that recovery record. If quota pruning removes the only fatal destination and there is no fallback anchor, the normal no-destination defeat path runs rather than leaving a frozen screen.

Malformed current checkpoints retain the raw save and lead to recovery guidance. Corrupt optional history is independently discarded. An unsupported declared checkpoint version is not treated as a legacy record. Old rewind anchors that lack the battle-owned inventory domain are unavailable until a complete new turn-start point exists; we do not invent past inventory from current inventory.

Interaction starts from idle or pre-move selection. Nested target/forecast/trade menus, post-move action menus, Canto and pending progression reveals must finish first. Returning from review restores the prior input ownership. Keyboard/controller focus selects a preview only; the separate confirmation remains required. Portrait uses the application's existing rotation guard; returning to landscape is tested. A portrait-specific gameplay redesign is outside this release.

#### Review dispositions

Code-focused adversarial review caught and resolved: ordinary checkpoint/popup writes overwriting fatal state; publishing defeat before its save succeeded; incomplete malformed-state validation; optional history blocking authoritative saves; premature/misplaced death facts; Canto Wait bypassing the shared completion boundary; a missing old anchor hiding valid timeline destinations; corrupt null units throwing before the recovery screen; and quota fallback during Retry stranding a paused fatal decision. Each persistence/recovery finding has a targeted regression. No outstanding code-review blocker remains.

#### Verification and release boundaries

- Dedicated `test:timeline` explicitly participates in the lifecycle merge gate; the timeline browser spec is included in `test:ux-contracts`.
- Seeded bounded journeys use a separate chooser stream, resolved actor/entry IDs, a failure trace and action counts. Each exercises Wait, detached preview, failed write/retry, a paid rewind, actual reload without a save, scene reconstruction, and continued play on the new branch. Coverage is asserted; repeatedly browsing Back cannot satisfy it. This is a bounded feature regression tier, not an exhaustive campaign fuzzer.
- Real combat tests compare hit/crit/skill results after rewind and after reload, with intervening forecast browsing. Existing battle-speed tests remain the pacing regression gate; the new browser cases run Instant for focused navigation.
- Muted headed Chromium checks cover tap/selection without mutation, cancel/confirm, normal Title → Slot Picker → saved battle resume, zero-charge review, rotation and return at 667×375, anchorless fatal reload, Back to the decision, accepted defeat, and the free terminal report at 640×480. They use an isolated local origin/profile and synthetic battle setup, with real UI and save flows afterward.
- Broad unit and harness runs, focused timeline gates, production build, lint and format checks are recorded in the completion entry below. Broad runs exposed the existing unseeded Colosseum probability-tolerance test twice. Its regression now uses a fixed chooser seed and 5,000 trials with the same acceptance bounds; the final broad run passed. No combat balance was changed to mask that fluctuation.
- Still required before claiming phone acceptance: physical iPhone touch scrolling/slide-off, notch/rotation, an existing on-device save upgrade, and long-history responsiveness. Desktop Chromium does not prove those device behaviors.
- T5 enemy-action destinations are cancelled. Dave authorized distribution after a narrow adversarial spot-check.


#### Completion verification — September 21

- Unit suite: **5,629 passed across 334 files** (`/tmp/timeline-unit-accepted.log`).
- Timeline gate: **219 passed across eight files**, including three seeded multi-step rewind/reload journeys (`/tmp/timeline-gate-verified.log`). These overlap the unit/harness totals and are not additional unique tests.
- Harness suite: **165 passed across 11 files**; journey subset: **56 passed** (`/tmp/timeline-harness-final.log`, `/tmp/timeline-journey-final.log`).
- Muted headed browser: **four passed**, including zero-charge defeat report at the base resolution (`/tmp/timeline-browser-verified.log`). Portrait testing verifies the rotation guard and return to landscape, not a portrait gameplay screen.
- Production build passed; lint passed with **0 errors / 313 existing warnings**. Changed-file formatting and whitespace checks passed. No data or content balance changed.

Dave authorized distribution September 21. A fresh adversarial spot-check of commit 31242d0 found no blockers; 39 focused tests passed across transactions, integration, and the viewer. Physical-phone acceptance remains a tester check; T5 is cancelled.


#### Build 15 distribution

Uploaded version 0.1.0 (15) September 21 at 17:52 Pacific after one Apple server-error retry. Archive assets (818 files), bundle/version and no development-server configuration verified. Release preparation commit: `641e4fc`. After sign-in was restored, Public Playtest assignment and external submission completed; App Store Connect confirms Testing. Tester notes are saved and automatic notifications enabled. Build ID: `7fc13e09-f2b0-4050-8899-3404c57db150`. See `docs/testflight-beta.md`.
