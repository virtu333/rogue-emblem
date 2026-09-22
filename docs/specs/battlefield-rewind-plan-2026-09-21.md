# Battlefield rewind: product specification and implementation plan

Date: September 21, 2026
Status: Implementation authorized by the user and implemented in the workspace; verification record below. Physical-device release verification remains outstanding.
Related foundation: [Battle timeline and rewind plan](battle-timeline-rewind-plan-2026-09-21.md)

## 1. Outcome

Opening Rewind should let the player watch the battle move backward and forward on the battlefield itself. The map uses the game's terrain and unit artwork, shows who acted on whom, and makes the selected historical state understandable without interpreting a separate miniature diagram.

The core interaction is action-by-action navigation within turn and phase groups. A short movement/combat presentation connects adjacent recorded states. The player can browse enemy actions to understand a defeat, select an eligible player decision point, and confirm a paid rewind using the existing transaction.

Example: an enemy moved around a wall and defeated Sera. Selecting that action shows its route, the attacker and Sera, the recorded damage, and Sera's disappearance. Stepping backward restores Sera's earlier HP and returns the attacker along the recorded visible route. Moving to the preceding eligible player boundary shows the exact board from which play would resume.

This project improves visual history and navigation. It does not authorize enemy-action rewind destinations, change difficulty rules, change randomness, or alter the charge economy.

## 2. Decisions and assumptions

### Established constraints

- Keep the battle button **Rewind** and viewer title **Battle timeline**.
- Reviewing history is free, including with zero charges.
- Normal and Hard retain completed player-action and player-turn-start destinations; Lunatic retains player-turn-start destinations.
- Enemy actions, unresolved action fragments, and automatic-effect intermediate states remain review-only.
- Fixed-policy battles reproduce the same outcomes for repeated identical committed actions. Legacy battles retain their existing policy.
- Charge consumption, branch truncation, recovery state, and paid restore remain the responsibility of the existing rewind transaction.
- Full-map restart remains a separate flow with its existing rules.
- The user subsequently authorized implementation. Publishing and deployment remain outside this task.

### Product choices used for implementation

The implementation follows the recommended defaults when the user authorized proceeding: brief map cues and extended review within the fixed storage budget. Unlimited or guaranteed whole-battle retention is not promised:

| Question | Planning default | Consequence of another choice |
| --- | --- | --- |
| Animation depth | Brief map movement, combat, healing, and outcome cues | Instant-only reduces presentation work. Full original-animation replay requires a separate scope estimate because existing animations contain gameplay side effects. |
| History length | Aim to review the whole current battle, within measured limits | Retaining only the existing recent-turn window allows omission of the archive expansion milestone. |

Whole-battle **review** does not imply whole-battle **rewind**. This proposal keeps the existing rewind snapshot window and eligibility policy. Expanding actual rewind range would be a separate gameplay decision.

No unconditional unlimited-history promise is made. Long or deliberately stalled battles must degrade predictably under an explicit storage budget.

## 3. Baseline implementation and gaps identified during planning

Source inspection for this plan found:

| Area | Current behavior | Required change |
| --- | --- | --- |
| `src/ui/BattleTimelineView.js` | Full-screen DOM menu; text facts, CSS board, numbered markers | Map-first viewer shell, selected-action description, navigation, and renderer connection |
| `src/engine/BattleTimelineFacts.js` | Visibility-filtered positions, HP, inventory summaries, terrain labels, and string combat facts | Versioned presentation projection with historical appearance, visible map state, structured outcomes, and explicit visibility transitions |
| `src/ui/BattleTimelineRecorder.js` | Captures preview at existing save boundaries; merges finalized player actions with the latest recovery row | Capture structured action fragments and merge them by durable identity; retain settled frame associations |
| `src/engine/BattleTimeline.js` | Version 1; current turn plus three previous turns; at most 500 entries and 512 KiB; prioritizes turn-start snapshots under pressure | Preserve destination logic; introduce compatible presentation data and, if selected, a separate visual-history retention policy |
| `src/ui/VisionRewindController.js` | Sets battle state to `PAUSED`, opens viewer, closes it before confirmation, commits through transaction | Own a history session across viewer and confirmation; keep selected point/camera on Back; avoid briefly releasing gameplay ownership |
| `src/ui/BattleActionCompletion.js` | Final boundary after Canto and village effects, before phase advancement | Keep this authority; attach action recording without moving the boundary |
| `src/ui/BattlePresentationCheckpoint.js` | Durable resolved-action continuation for level-ups and other remaining presentation | Preserve recorded fragments across continuation and merge exactly once |
| `src/engine/Grid.js` | Actual terrain rendering, fog, terrain mutations, pathfinding | Share narrowly extracted visual construction; do not create a second gameplay grid for replay |
| `src/scenes/BattleScene.js` | Sprite creation, movement, combat, and automatic effects intermixed with state changes | Add small observation hooks; extract visual-only construction where necessary |
| `src/utils/BattleCameraController.js` | Touch pan/zoom and bounds helpers | Reuse against the historical camera; supply viewer-specific viewport and bounds |
| `src/ui/RunFlowMenus.js` | Opens the same timeline from a stored defeat report without a live battle | Historical rendering must work without BattleScene or a live unit registry |

Important limitations in current data:

- Position changes do not record the actual path. Recalculating a route later could produce a different route, especially with slides, obstacles, or changed terrain.
- A unit disappearing from a preview may mean death, escape, or loss of visibility. Snapshot differences cannot safely infer which.
- Existing previews omit enough appearance information that exact historical sprites cannot always be reconstructed.
- Terrain labels do not encode complete historical biome, object, or fog presentation. The preview currently combines ever-seen and visible terrain knowledge rather than storing all three visual fog states distinctly.
- String combat facts do not provide a complete ordered action model, especially for healing, displacement, post-combat effects, and multiple targets.
- The current three-turn/byte retention is shared by history and restore snapshots. A larger visual record must not silently displace valuable rewind destinations.

## 4. Player experience

### 4.1 Entering and leaving

Open only through currently permitted Rewind, fatal-decision, or report entry points. This project does not add arbitrary interruption of enemy execution or unresolved player choices.

On entry:

1. Acquire exclusive history input/lifecycle ownership.
2. Preserve the host's camera, focus, relevant UI visibility, and permitted return state.
3. Display a separate historical battlefield using recorded presentation data.
4. Select **Now** for an active battle, or the latest recorded event for a report.
5. Show a persistent **Viewing history** indicator, turn/phase, charge count, and exit control.

Opening the viewer must not make a gameplay checkpoint, reseed RNG, finish an action, allocate gameplay entity IDs, or change the save. If the exact current board has no retained history frame, an in-memory filtered current view may represent Now; it cannot become a new rewind destination.

Back restores the host view and focus exactly where feasible. Fatal-mode Back returns to the fatal decision. Report-mode Back returns to the results menu. Refresh while browsing resumes the already persisted battle/fatal decision; browsing position is not a gameplay save.

### 4.2 Layout

The battlefield is the largest part of the screen. Use DOM controls for readable text and accessible interaction, and Phaser for the historical map. History controls must not obscure the selected actor and target.

At the 640×480 base viewport, start with this layout budget:

- Approximately 48 px for title, turn/phase, charges, and Back.
- Approximately 268 px of map height in compact mode.
- Approximately 164 px for a two-line action summary, action/turn navigation, history access, and the rewind control/reason.
- A History drawer temporarily expands over the map for list browsing. Closing it restores the map area without changing selection.

These are prototype budgets, not fixed pixel rules. Text wrapping, safe areas, and actual available CSS viewport determine final sizing. Do not shrink controls or force the whole map to an unreadable scale merely to fit a panel.

On wide layouts, the history list may be a persistent side panel. On landscape phones, prefer the compact map plus bottom controls and an expandable history list. Respect safe-area insets and the existing portrait rotation guard. Portrait gameplay is outside this project.

The map viewport is computed from the actual canvas rectangle and any overlapping DOM panels. Camera framing uses that unobscured rectangle. Never assume CSS pixels equal canvas coordinates.

### 4.3 Selection semantics

Every selectable history point represents a recorded frame after a completed action or an explicitly labeled review-only event/committed fragment. Rows follow global battle chronology, even when a unit leaves its logical action unfinished and another unit acts. Turn-start destinations represent the existing boundary after automatic turn-start effects resolve.

- Selecting an action displays **After: Edric attacked Brigand**.
- Stepping backward from action B to action A undoes B visually, then rests on A's after-state.
- Stepping forward from A to B plays B visually, then rests on B's after-state.
- Selecting a distant row or jumping turns reconstructs the destination directly. It does not play every intervening action.
- Turn jumps select the prior/next recorded player-turn-start heading. Enemy-phase headings remain directly selectable when recorded, with review-only status.
- In-progress frames and internal strikes never gain rewind eligibility merely because they are visible.
- An interleaved committed fragment can have a review-only row such as **Edric traded with Sera · action unfinished**. A later row for Edric's attack does not move that trade later in history or replay it again.
- Rewind is disabled during transition. It becomes available only after the displayed board, caption, selected row, and target identity agree.
- A turn-start label explicitly says **Start of player phase · automatic effects resolved** where needed to remove ambiguity.

Do not add a misleading “Before this action” button that silently maps to a different legal destination. The player selects the preceding available point explicitly. A future convenience action would need to name its actual destination.

### 4.4 Navigation and inspection

| Input | Proposed behavior |
| --- | --- |
| Pointer/touch | Previous/next action; previous/next turn; select history row; drag map; pinch zoom; Focus action |
| Keyboard | Left/right step actions when the history map/navigation owns focus; Page Up/Down jump turns; Tab moves controls; Enter activates focused control; Escape backs out |
| Controller | D-pad browses rows/actions according to focus; shoulder buttons jump turns; Confirm activates focused control; Cancel backs out |

Map panning must also have a keyboard/controller path: a focusable **Map** mode uses directional input to pan, with explicit zoom controls. Cancel first leaves Map mode, then closes the viewer. History list navigation must not also pan the camera. Reuse existing abstract input actions and scopes rather than globally rebinding battle commands.

Mouse dragging and touch gestures operate only in the historical viewport. A drag beginning on a history row scrolls the list and never pans the map. Slide-off cancels button activation. Hold/repeat navigation may accelerate, but repeated Confirm must never purchase multiple rewinds.

Selecting a visible historical unit may show a small recorded-only inspector: name/class if known, faction, HP, status, and recorded equipment. Do not open the live unit detail overlay or compute live movement/threat ranges. Text action details remain usable without map inspection.

Manual panning holds until selection changes or the player chooses Focus action. Each new action frames its known participants with minimal camera movement; avoid repeated zoom changes. If participants cannot fit at a readable scale, prioritize the affected target and provide a focus toggle between known participants.

### 4.5 Action animation

Brief animations explain recorded changes. They do not recreate a full combat presentation or run gameplay code.

| Action | Forward presentation | Backward presentation |
| --- | --- | --- |
| Move, Wait, Canto | Follow recorded visible path; show final acted state | Restore acted state and traverse the same visible path backward |
| Attack/counter/follow-up | Highlight actor/target; short strike/projectile cue; recorded miss/crit/damage; HP and death changes | Restore prior HP/presence and reverse displacement; label action being undone; no suggestion of a new attack |
| Heal/drain/status | Known source/target cue; recorded HP/status transitions | Restore earlier HP/status; describe reversal |
| Dance/Gambit | Highlight affected known allies; show refreshed state | Restore earlier action availability |
| Trade/equip/item | Highlight participants; concise item/equipment/status change | Restore prior recorded presentation |
| Warp/rescue/forced movement/slide | Recorded relocation or actual route, distinct from ordinary walking | Reverse the recorded relocation/route |
| Recruitment/promotion/reclass | Recorded faction or appearance change | Restore earlier faction or appearance |
| Escape/death/revival | Explicit exit/death/reappearance cue | Restore/remove presence according to recorded cause |
| Village, destructible terrain, ballista | Highlight known object and show recorded state change | Restore earlier object state |
| Reinforcements and automatic effects | Separate labeled event or grouped phase event with ordered cues | Restore earlier observed state without revealing hidden spawns |

One uninterrupted unit action remains the default row even when it includes movement, combat, XP, and Canto. Underneath that grouping, record globally ordered committed fragments, each connecting consecutive historical frames. Only contiguous fragments may be grouped into one displayed transition; grouping must not hide an eligible destination or cross another unit's action, an intervening battle event, or a continuity gap. Ordered subevents are visible in Details; they are not separate paid destinations.

Logical parent IDs associate related fragments without changing their order. For example, **A moves and trades → C attacks → A attacks** yields separate chronological transitions for A's committed movement/trade, C's attack, and A's later attack. Reversing A's final attack restores the state after C's attack, with A's earlier trade and movement still intact. Details may link A's related fragments, but no whole-parent before/after animation can jump across C's action.

Target duration for a normal adjacent action is roughly 250–600 ms, bounded at 800 ms even for complex exchanges. Long multi-hit sequences summarize their strikes in the caption/details rather than forcing one animation per hit. These are proposed tuning targets.

Rapid input cancels the prior visual transition and renders the newest requested endpoint. Never queue a long chain of animations. Reduced motion and Instant speed render endpoints immediately with static highlights; existing effect settings govern optional particles, shake, and flashes. Default history audio is quiet UI feedback rather than replaying death cries, reward sounds, or phase music.

## 5. Recording contract

### 5.1 Separate gameplay state from presentation

Keep three concepts distinct:

1. **Recovery checkpoint:** authoritative state for resume, including incomplete resolved actions.
2. **Rewind destination:** validated authoritative snapshot at an existing legal boundary.
3. **Historical frame/action record:** filtered presentation data used only to show what happened.

The renderer accepts only the third. It does not receive a RunManager, live unit objects, full restore snapshots, AI controller, or gameplay RNG.

Never reconstruct battle outcomes by replaying commands. All historical changes come from observations of outcomes already resolved in live play. Never parse human-readable strings to recover actor IDs, paths, damage, or causes.

### 5.2 Proposed presentation schema

Introduce a separately versioned presentation archive within a version-2 timeline envelope. Keep the existing core entries/snapshots and their eligibility semantics; extend hydration explicitly rather than adding unrecognized fields to version 1. Module names and exact property spellings may be finalized during implementation, but these contracts are required:

| Record | Required contents |
| --- | --- |
| Timeline presentation metadata | Schema version, battle identity, branch revision, allocation and recording-generation cursors outside prunable segments, compatibility/art metadata, completeness markers |
| Frame | Frame ID, global sequence, incoming fragment association, turn, phase, observable map state, observable units, visible objects, status/acted appearance, known objective state |
| Unit presentation | Stable battle entity reference, permitted displayed name, faction, grid position, footprint, appearance descriptor, HP/max HP, acted state, visible status/affix badges |
| Tile presentation | Coordinates, known terrain identifier, observed object state, fog category: unseen/explored/visible, observation-available flag; no hidden terrain payload under unseen or unavailable cells |
| Parent action record | Stable parent ID, branch, actor reference when observable, ordered fragment references, completion status at the selected boundary, truncation/completeness flags; grouping metadata, not a reversible global transition |
| Chronological fragment | Stable fragment ID, parent ID if applicable, branch, global sequence, consecutive before/after frame references, canonical timeline entry association if present, actor/targets when observable, type, ordered beats, recorded summary, completeness flags |
| Recorder checkpoint metadata | Validated current observation memory, outstanding committed parents and their committed-through sequence at this boundary, recording-generation cursor; optional presentation data, not gameplay continuation authority |
| Beat | Typed movement, strike, heal, status, relocation, appearance/presence, item, object, or phase change; observable before/after values and causes |
| Visibility transition | Known appearance/disappearance and visible path fragments, without hidden endpoints or hidden actor references |

Use logical art descriptors with a validated mapping to bundled textures, not arbitrary saved asset URLs. Record historical class/tier/form distinctions so later promotion or recruitment cannot change earlier sprites. Apply current accessibility contrast settings to historical artwork. Missing old artwork gets a clear faction/footprint fallback, never a guessed present-day unit appearance.

A render keyframe contains the complete filtered frame. Between keyframes, store compact, reversible before/after deltas for chronological fragments. Each fragment's before-frame must equal the preceding fragment's after-frame within a continuous segment, regardless of parent action. Create a new keyframe at phase starts, continuity gaps, and at most every 32 fragments. A random seek reconstructs from its preceding keyframe without simulating any gameplay; an adjacent step can use the already materialized frame. End each animation by applying the exact recorded endpoint, avoiding accumulated interpolation error.

Keep rendered frames and a small seek cache in memory. Store data, not screenshots, canvas captures, Phaser objects, or one bitmap per action.

### 5.3 Action identity and checkpoints

- Allocate parent and chronological-fragment identity at commitment, independently of gameplay RNG and entity ID allocation. Ordering uses a battle-wide sequence, never unit selection order or parent completion order.
- A canceled uncommitted move or canceled forecast produces no committed action. Staged path observations are discarded with the canceled operation.
- A committed trade followed by an attack is not a canceled action: preserve the committed fragment even if later targeting is canceled.
- Persist all outstanding committed parents, fragment identities, and committed-through sequences at every existing checkpoint, including trade-only checkpoints with no `pendingActionCompletion`. Multiple unfinished parents may exist when the player switches units. This optional metadata describes history; it must never cause gameplay to execute an unfinished action automatically.
- Preserve the same identities alongside an existing continuation save when a resolved action needs remaining level-up/promotion/Canto work. Append subsequent fragments in global order and mark the parent complete at the canonical completion boundary. Do not move or rewrite its earlier chronological transitions, and do not rely only on “latest recovery row” to identify its fragments.
- Finalization after reload cannot duplicate strikes, movement, XP descriptions, or rows. Track ordered fragment identity and committed-through sequence explicitly.
- Gameplay progression is never blocked by optional recording failure. The recovery checkpoint still saves; a later presentation segment starts with an explicit gap and a fresh filtered keyframe.
- Recorder hooks observe already computed values. They must not make extra gameplay checkpoints, change checkpoint cadence, roll randomness, allocate gameplay units, or advance phases.
- During rewind, presentation IDs remain monotonic. Scope all frame/action caches by battle and branch so restored entity IDs cannot alias discarded-future artwork.

Keep the next presentation/action ID and recording-generation cursor in the versioned timeline envelope, outside restored gameplay snapshots and outside prunable archive segments. Preserve those small cursors when optional archive content is dropped. If optional history is completely reset, start a new recording generation and invalidate its caches/references; never splice a new segment into an old identity namespace. These cursors are presentation metadata and must not affect gameplay RNG or entity IDs.

Capture each committed fragment's observable before-state before its first mutation, and its after-state when that contiguous fragment settles. Staged movement may supply the before-state and route when the action later commits. A later fragment from the same parent starts from the current global frame, not the parent's original before-state. These observations do not introduce extra gameplay saves. If a before-state or any required intermediate observation is missing, retain the accurate after-state with an endpoint-only flag; do not synthesize a route or reversibility from incomplete data.

On rewind to a point between a parent's fragments, truncate its abandoned future fragments and restore its completion status and outstanding-parent metadata as of that point. For the A trade → C attack → A attack example, rewinding to C's eligible endpoint preserves A's trade but makes A's later attack unrecorded and its parent unfinished again. Reconstruct this metadata only from retained target-associated presentation data. If it is unavailable, begin an explicitly incomplete recording segment; do not copy future parent completion or generate gameplay continuation from it.

### 5.4 Integration inventory

Audit each family before declaring recording complete:

| Family | Existing integration area | Capture requirements |
| --- | --- | --- |
| Player movement and undo | `BattleScene.moveUnit`, `afterMove`, `undoMove` | Effective route including slide segments, staged versus committed distinction, observed visibility along the route |
| Canto | `startCantoMove`, `handleCantoClick`, `completeBattleAction` | Post-action route, final endpoint, one parent action, no early destination |
| Combat | `_runCombatResolutionAtSpeed`, `executeCombat`, `executeEnemyCombat`, post-effect helpers | Ordered already-resolved strike outcomes, counter sides, HP clamping, drain, status, displacement, splash, deaths |
| Enemy movement/actions | `startEnemyPhase` callbacks, `animateEnemyMove`, AI outcome callbacks | Actor identity before removal, actual path, heal/status/break/Wait outcomes, one completion per enemy |
| Healing/staves/items | Player staff controller(s), scene staff dispatch methods, `useConsumable`, enemy staff callbacks | Source and all targets, actual applied HP/status/resource effects and relocations |
| Trade/equip | `BattleTradeMenu`, trade completion/checkpoint path, equipment actions | Committed exchanges and equipment changes; trade-only checkpoint preserves outstanding parents; switching units preserves global order; cancel does not invent an exchange |
| Dance/Gambit | `executeDance`, `completeResolvedAction` | Explicit affected unit IDs and before/after availability |
| Promotion/reclass | `PromotionController`, `executeReclass`, presentation continuation | Historical form before/after, resolved fragment survives reload |
| Death/escape/recruitment | `removeUnit`, `EscapeObjectiveController`, recruit conversion paths | Cause, source when observable, presence transition, final location, faction change |
| Turn and phase effects | `onPhaseChange`, `processTurnStartEffects`, terrain healing, ballista and reinforcement paths | Stable phase ordering, filtered intermediate observations, final control-ready anchor |
| Map objectives | Village/caravan controllers, destructible and temporary terrain paths | Visited/razed/opened/broken/exited/expired states and observable rewards |
| Fatal/terminal | `BattleFatalDecision`, `PostCombatController` | Final lethal beat retained even when normal completion is skipped; no playable terminal frame |

Confirm actual controller filenames and resolution ownership during the recording audit. Instrument the owner of the resolved outcome, not both a dispatch wrapper and its callee. A coverage checklist should identify one responsible hook per outcome and its test fixture.

## 6. Fog and information correctness

Filtering occurs when observations are recorded, before archival storage intended for display. It is not enough to hide a full snapshot in the renderer.

- Use event-time visibility, including changes within a move or multi-effect action.
- Store only visible movement fragments. Do not store a hidden endpoint and merely fade the sprite near it.
- If visibility begins halfway through a route, the unit appears at the first observed location. If it ends, the unit disappears at the last observed location.
- Offscreen attacks on visible allies may describe the observed effect and “Unseen enemy.” They must not provide a camera coordinate, name, sprite descriptor, target line origin, hidden skill list, or stable hidden-unit reference that reveals the source.
- A disappearing enemy is “left view” unless death/escape was independently observed. A newly observed enemy is not automatically labeled a reinforcement.
- A base map/keyframe cannot contain future terrain knowledge. Explored terrain uses its last validated observation at that time. If that observation is unavailable, show the explicit unavailable state below; changes made out of sight are never substituted.
- Initial archive metadata must not contain a global dictionary of future enemies or objects. Observable descriptors enter history at their first permitted appearance.
- Multi-tile entities use the game's existing visibility policy consistently for frames, paths, labels, and camera focus; do not introduce a new origin-tile shortcut.
- Text descriptions, accessibility labels, tooltips, portrait thumbnails, and focus helpers use the same filtered projection as the map.

Where existing visibility behavior is ambiguous, document and test the intended observable behavior before implementing a cue. Do not recompute historical visibility using the current party or current fog.

### 6.1 Observation memory and loss of history

Current gameplay fog stores visible and ever-seen coordinates, not the last-observed terrain/object values. The history recorder therefore owns a separate, filtered observation map. It updates a cell only when that cell is observed through the approved event-time visibility policy; out-of-sight changes do not update it. This is presentation state and does not change live fog gameplay or become required recovery data.

- Save the current observation map as bounded recorder checkpoint metadata at existing save boundaries. Keyframes also contain the observations needed for their own historical frame. Keep current observation memory independent of old segment retention so pruning the oldest segment does not automatically erase current knowledge.
- Stage observation changes caused by an uncommitted move with that move's recording data. Cancel/rollback discards them alongside the staged route and restores the prior observation map; a committed trade keeps the observations belonging to its committed movement. Never retain canceled discoveries in a later frame simply because the recorder briefly saw them.
- During normal reload, accept only validated observation metadata associated with the saved battle, branch, and checkpoint. Do not load a newer recording head into an older checkpoint.
- During rewind, prepare observation memory from the target's filtered frame/metadata. Do not carry later discoveries or object states back from the abandoned future. If target metadata has been pruned, use the unavailable fallback rather than rejecting a valid gameplay rewind.
- During segment pruning, materialize the first retained keyframe before removing its dependencies. Persist its observation values and unavailable flags together with its other frame data.
- Observation memory is optional and counts toward the presentation budget. Quota fallback, corruption, older saves, or a complete archive reset may remove it. Recording restarts with currently visible cells only; never backfill explored-but-hidden cells from the live terrain array, full restore snapshot, or later history.
- An explored cell without a validated observation keeps its explored fog category but has `observationAvailable = false`. Render a neutral tile with no inferred object/terrain details and explain **Earlier terrain appearance unavailable**. Reobservation fills that cell for new frames only; it does not repair older frames retroactively.
- Report keyframes must be self-contained; a stored report cannot depend on the active recorder's current memory. Inspection text, map art, and camera/object cues all honor unavailable observations.

This explicit degradation is the selected correctness fallback for the plan. It avoids making additional historical knowledge mandatory for saving or resuming gameplay. It applies to a fresh recording segment and its Now view after metadata loss as well as to older rows.

## 7. Rendering and lifecycle architecture

### 7.1 Components

Proposed new responsibilities, with tentative filenames:

| Component | Responsibility |
| --- | --- |
| `src/engine/BattleHistoryPresentation.js` | Schema validation, filtered frame representation, reversible deltas, keyframe materialization, pure summary helpers |
| `src/engine/BattleHistoryRetention.js` | Optional archive budget, segment pruning, rebase/keyframe rules, completeness flags |
| `src/ui/BattleHistoryRecorder.js` | Observation adapters, filtered observation memory, globally ordered committed fragments, outstanding parent metadata; small hooks in existing controllers |
| `src/ui/BattleHistorySession.js` | Viewer lifecycle, selection, input ownership, host freeze/restore, confirmation handoff |
| `src/scenes/BattleHistoryScene.js` | Presentation-only Phaser scene, dedicated camera, map viewport, no battle simulation |
| `src/ui/BattleHistoryRenderer.js` | Materialize/diff sprites, terrain, fog, objects, highlights, and short cancellable transitions |
| Existing `BattleTimelineView.js` | Accessible DOM shell, list, controls, reasons, action details; no restore decisions inside drawing code |

Extract only the visual factories needed to share terrain and unit appearance with normal battle rendering. `addUnitGraphic` currently registers entities and attaches graphics to live units; it is not a safe history renderer. `Grid` owns gameplay state and pathfinding; avoid constructing a replay Grid as a shortcut.

Shared factories accept plain appearance parameters and return display objects with explicit disposal. They do not register entities, mutate units, update fog, trigger affixes, play gameplay sounds, or access RNG. Normal battle wrappers keep their existing behavior. Keep this extraction narrow and verify visual parity before building animated history on top of it.

### 7.2 Ownership and state transitions

Session states: **opening → browsing ↔ animating → confirming → committing → restoring → closed**. Pre-commit setup/write failures have a recoverable error path. A durable commit followed by failed restoration enters a distinct **committed-needs-reload** state with no path back to browsing the old playable battle. Presentation state is separate from the battle's gameplay state machine.

- The session acquires input and lifecycle ownership once. Transitions between viewer and confirmation keep that ownership.
- Audit host update loops, timers, tweens, effect loops, and async continuations. A `battleState = PAUSED` assignment alone is not proof of a frozen host. Prefer pausing the host Phaser scene while the dedicated history scene runs, paired with existing continuation guards; verify effects of pause/wake callbacks before selecting the final mechanism.
- Async callbacks already awaiting promises must remain harmless while history owns the host. Opening is limited to settled existing entry points; fatal execution is already superseded through existing guards.
- The viewer has its own camera; live camera movement, danger ranges, threat pins, tooltips, battle HUD, and grid cursor remain inactive beneath it.
- Use existing `uiDepths`, overlay stack, input focus scopes, and ESC priority conventions. Add named depth/ownership entries if needed; do not invent local z-index or cancel precedence.
- DOM-to-map pointer routing is owned by the session. A transparent map area must never pass clicks through to BattleScene.
- Every seek increments a presentation generation token. Stale tween callbacks cannot alter selection, release input, or re-enable rewind.
- Closing, host shutdown, successful commit, scene replacement, and construction failure all dispose renderer objects, DOM listeners, scope tokens, tweens, timers, and pointer captures exactly once.
- Restore host state only if the original host/battle/revision is still current. Never wake a superseded battle after a successful rewind or terminal transition.

### 7.3 Confirmation and transaction handoff

The confirmation remains explicit: turn, phase, **after the named action** or **start of player phase**, one charge, and abandonment of later actions. Show “Enemies act next” when applicable.

Capture the selected canonical entry and expected battle/revision at confirmation. Revalidate at commit. Do not accept a visual frame as authority for eligibility or restore contents.

Back from confirmation returns to the same row, map position/zoom, history scroll, and details state. It must not snap to Now as the current reconstruction flow can do.

Before writing, prepare a detached transaction candidate that truncates abandoned chronological fragments and keyframes alongside the existing timeline branch, restores target-time parent completion and observation metadata, and creates a fresh branch keyframe where data permits. Keep the small rewind marker. Persist these changes with the selected gameplay target and debit; publish them only after the write succeeds, then invalidate caches/queued transitions. Optional data loss under quota may drop visual history but may not move the chosen gameplay destination or refund/duplicate the charge.

On a pre-commit persistence failure, retain the exact candidate and current safe retry semantics. Do not show a playable restored board or debit a charge until the transaction is durably committed. The historical preview can remain visible with a clear failure/retry message.

Once persistence succeeds, mark the transaction durably committed before applying/restoring the live scene or tearing down the history session. If snapshot application, sprite construction, camera setup, or session handoff then throws, preserve the saved target and exactly one spent charge. Enter **committed-needs-reload**, supersede old callbacks, and keep the old battlefield non-interactive. Show **Rewind saved · Reload to finish restoring this battle** with Reload as the recovery action. Back, Escape, controller Cancel, and teardown must not resume the old battle, offer purchase Retry, refund the charge, or repeat the debit. Reload adopts the committed checkpoint through ordinary recovery. This preserves the existing `VisionRewindController.executeRewind` distinction between write failure and reconstruction failure.

## 8. History retention and compatibility

### 8.1 Two retention policies

Keep the existing core rewind entries/snapshots recent and bounded. The optional visual archive may retain presentation-only records for older turns whose rewind snapshots no longer exist. Formerly eligible rows without their snapshot say **Review only · rewind state no longer retained**. Enemy, intermediate, and difficulty-restricted rows keep their appropriate reasons; do not imply that they were once eligible.

Link a visual action to a canonical destination entry only while that entry and its valid snapshot exist. Pruning the core never leaves a stale enabled rewind control. Pruning visual records never deletes an otherwise valid destination; a recent endpoint fallback remains available from its existing filtered preview.

For the first implementation, retain the existing 512 KiB total timeline safety ceiling. Give the optional presentation data, including archive, observation memory, and outstanding parent metadata, a ceiling of 128 KiB as an initial tuning limit, using only space remaining after core retention; this is not a reservation taken away from core snapshots. Prune optional archive detail before displacing core snapshots. These are initial engineering limits, not proof that a whole battle fits. Keep the existing core limit of 500 entries; permit a separately bounded visual archive up to 4,096 chronological fragments, also constraining parent records, bytes, and per-record validation limits.

Measure short, typical, reinforcement-heavy, large-map, fog-heavy, and long-stalled battles. Record total save bytes, core bytes, archive bytes, serialized write time, hydration time, and retained span. Only raise limits in a reviewed storage change that accounts for all save slots, terminal reports, and existing cloud payload validation.

Whole-battle review is a release claim only after representative long battles meet retention and performance targets. If it does not fit, choose explicitly between a documented bounded history or a later storage project. IndexedDB/native storage and split-file cloud synchronization are not silently included here.

### 8.2 Pruning and degradation

Degrade optional presentation in this order:

1. Remove cosmetic beat detail while keeping accurate endpoint frames and summaries; mark the action endpoint-only.
2. Drop oldest complete archive segments, rebasing the first surviving frame into a self-contained keyframe.
3. Drop the archive entirely if necessary; preserve core filtered previews and required recovery state.
4. Follow existing core quota fallback only if required to save authoritative progress.

Never retain a delta whose base was pruned. Never animate across a continuity gap. Prune or rebase parent-to-fragment references as well; a retained parent may explicitly have missing earlier detail but must not reference a nonexistent playable transition. Retain independently valid current observation metadata when possible; if it is also dropped, use section 6.1's unavailable fallback. Do not infer events removed by pruning. A gap says **Earlier visual history unavailable** or **Detailed animation unavailable**, depending on what is missing.

Paid rewind quota fallback protects the selected authoritative target and charge transaction. Terminal-report storage remains optional and may be dropped under the existing defeat-save fallback.

### 8.3 Old saves and damaged optional data

- Accept version-1 timelines through an explicit compatibility adapter. Preserve eligibility, policy, IDs, snapshots, and facts.
- Older entries may support only endpoint diagrams/text because historical art, path, and fog data were never recorded. Label this as limited older history. Do not borrow current positions, class, map changes, or hidden snapshot contents to invent a richer past.
- Newly recorded segments in an already-active battle may use the new presentation format while keeping the battle's existing rewind/randomness policy.
- Validate the core and optional archive separately. A malformed archive is dropped without discarding valid rewind snapshots or the recovery checkpoint.
- Bound strings, coordinates, footprints, path lengths, beat counts, keyframe chain length, allocations, and total bytes before materialization. Missing/invalid frame references produce a gap rather than executing a partial reconstruction.
- History-only reports include filtered presentation metadata, keyframes, and records but no restore snapshots or actionable destinations. They must open after reload from the results screen without BattleScene.
- This project preserves the existing report entry points. A campaign-wide replay gallery or automatic archive of every completed battle is out of scope.

## 9. Delivery sequence

Implement one reviewable milestone at a time. The dependency order is V0 → V1 → V2 → V3 → V4 → optional V5 → V6. Each milestone includes its focused checks before proceeding. Safe persistence, branch truncation, and bounded retention are mandatory for recent-turn history and cannot be deferred to optional V5. Before a new format is exposed through paid rewind, its candidate serialization, truncation, quota fallback, and reload gates must pass. A temporary compatibility fallback may remain during development; the core feature is not complete until animated actor/target history works on the real map.

### V0 — Finalize contracts and measure the baseline

Tasks:

- Confirm the two product preferences, or record the implementation assumption explicitly if proceeding is authorized without answers.
- Audit all outcome owners in section 5.4 and identify exact observation hooks.
- Produce representative save/turn/action size measurements from existing fixtures.
- Verify scene pause/input/DOM viewport integration with a small design spike; identify any ongoing callbacks at permitted entry points.
- Finalize global fragment ordering versus parent grouping, ID ownership, observation-memory loss behavior, and storage envelope/migration design.

Gate: no ambiguity about before/after selection semantics, safe host ownership, hidden-path filtering, or which boundary can become a paid destination. Record benchmark evidence and finalized limits in this spec before claiming whole-battle retention.

### V1 — Historical frames and static battlefield renderer

Tasks:

- Add the versioned filtered frame codec and compatibility adapter.
- Capture appearance, terrain/object state, fog categories, and stable unit references at existing boundaries.
- Implement filtered observation memory and the unavailable-terrain fallback for reload, rewind, corruption, and loss of optional history.
- Implement mandatory presentation budgeting, frame retention, detached transaction truncation, filtered report serialization, and quota fallback for the initial frame format. Verify migration, cold reload, and corrupted optional data before enabling new records in paid rewind.
- Extract minimal shared terrain/unit visual factories and add a detached history scene/renderer.
- Build the map-first shell, Now/Back, row selection, camera framing, map pan/zoom, recorded text, and eligible-point indication.
- Support active battle, fatal decision, and stored report hosts.

Gate: endpoint appearance matches valid recorded observations for representative units/terrain; browsing and canceling are state/RNG/save neutral; no hidden information; missing observations and old visuals degrade honestly; no lifecycle leaks. New-format paid rewind, quota fallback, report cold load, and pre-commit versus post-commit failure recovery pass before V1 is considered complete.

### V2 — Structured recording for core actions

Tasks:

- Add durable parent/fragment identity, a global chronological sequence, consecutive frame edges, and keyframe/delta associations.
- Capture actual committed player/enemy routes, Wait, attack/counter/follow-up, heal, death, and the committed trade path needed to verify interleaving.
- Persist multiple outstanding parents at all existing checkpoints, including trade-only saves; integrate recovery continuation and final completion without changing save cadence.
- Extend the mandatory V1 persistence work to fragment graphs: bounded deltas, keyframe rebase, parent references, target-time metadata, branch truncation, report serialization, and corruption/quota handling. Verify these before new fragment records are used by paid rewind; none of this waits for V5.
- Add clear actor-action-target labels generated from structured data; preserve readable legacy facts.

Gate: a move → attack → counter → death sequence can be inspected with exact endpoints and ordered results; resume during a level-up finalizes one parent without duplicate fragments; canceled moves/forecasts do not appear as committed play; all existing fixed-outcome checks pass. A trade → C attack → A attack retains global order through sequential/reverse/random navigation, trade-only reload, and rewind to C's eligible endpoint. No dangling frame/parent references or abandoned-future records remain after pruning or rewind.

### V3 — Remaining gameplay and fog completeness

Tasks:

- Complete Canto, remaining trade/equip outcomes, consumables, staves/relocation, dance/Gambit, recruitment, promotion/reclass, escape, revival, splash/affixes, and multi-tile entities.
- Cover automatic effects, reinforcement/visibility changes, villages, temporary terrain, destructibles, ballistas, and caravan events.
- Persist fatal/terminal records when ordinary completion is skipped.
- Complete the outcome-owner coverage checklist and mid-action visibility handling.

Gate: no supported gameplay family silently renders a fabricated cause or route. A missing specialized animation may use an explicitly endpoint-only cue, but actor/target, visible outcome, and final frame remain correct. Whole action families cannot be omitted from the recorder.

### V4 — Animated stepping and interaction polish

Tasks:

- Implement cancellable forward/backward movement and outcome cues from recorded beats.
- Add action/turn stepping, distant seeks, history drawer, Details, Focus action, and recorded-only inspection.
- Preserve selection/camera across confirmation Back and failed save/retry.
- Verify animated-session cleanup and camera handoff preserve the committed-needs-reload path if reconstruction fails after a successful write; stale callbacks cannot release the old battle.
- Apply compact/wide layouts, controller/keyboard routing, touch cancellation, effect settings, and reduced motion.

Gate: scrubbing during movement/death/Canto repeatedly settles on the exact latest selection, with no obsolete callbacks or camera jumps; confirm cannot commit a different frame; all controls remain usable at 640×480 and landscape phone sizes.

### V5 — Extend visual retention to the whole battle, if selected

Tasks:

- Extend the already independently bounded presentation retention beyond the recent rewind window; keep old rows review-only when snapshots are gone.
- Tune the existing segment/keyframe policy and bounded seek cache for longer archives without weakening V1/V2 pruning, transaction, report, and reload guarantees.
- Exercise the existing migration, corruption, quota, and branch tests at the larger retained span, including old review-only fragments and partially retained parents.
- Benchmark representative full battles and publish retained-span evidence.

Gate: storage pressure cannot remove a legal recent snapshot merely to preserve optional older animation; old review-only rows never become destinations; cold reload and post-rewind branching reconstruct correctly; whole-battle availability claim matches measured retention.

### V6 — Release verification and cleanup

Tasks:

- Complete the acceptance matrix below, then broaden to the repository's required merge gates.
- Run a focused code review of recording fidelity, information filtering, transaction boundaries, lifecycle cleanup, and renderer reuse.
- Perform visible desktop and muted landscape-phone browser journeys, followed by physical iPhone verification for gestures, rotation, app background/resume, and performance.
- Remove temporary debug hooks and update help/tutorial wording to the implemented behavior and measured retention limits.
- Record remaining compatibility limitations and exact validation evidence. Do not silently broaden this milestone into release publishing.

Gate: all core acceptance criteria pass; any remaining limitation is explicit and does not violate history accuracy, gameplay isolation, or rewind safety.

## 10. Verification matrix

Tests should prove behavior and invariants, not mirror renderer implementation. Start with touched-area checks; run broader gates only after the focused checks pass.

| Area | Required evidence |
| --- | --- |
| Neutral browsing | Digest all five unit groups, world/object state, run-owned battle value, RNG, current checkpoint/save bytes, charges, and IDs before/after repeated browse/close; no changes |
| Frame parity | Compare materialized presentation endpoints to the filtered live observation captured at each boundary; compare sequential, reverse, and random seeks |
| Action meaning | Duplicate unit names, repeated targets, misses, crits, counters, multi-hit, overkill/clamped HP, drain, death before counter, simultaneous/multiple effects |
| Interleaved chronology | A moves/trades → deselect → C attacks → A attacks; forward/backward/random seek connects consecutive frames; reload after trade-only checkpoint with no pending continuation; multiple outstanding parents; rewind to C keeps A's trade, discards A's later attack, and restores target-time parent status |
| Movement | Actual route around obstacles, slides, forced movement, canceled movement, committed trade then action, Canto, escape, unseen route segments |
| Phase effects | Terrain healing/damage, status ticking/expiry, ballista, reinforcement, village raze, commander death before control, phase-tail events exactly once |
| Visibility | Hidden actor attacks visible ally; hidden spawn; newly visible enemy; enemy leaves view; unexplored tile; unseen terrain change; multi-tile entity; text/DOM contains no leaked identities/coordinates |
| Observation loss | Observe terrain/object → leave vision → hidden change → drop archive/observation metadata → reload: explored cell is explicitly unavailable, never current hidden terrain; reobservation changes new frames only; rewind uses target-time knowledge or unavailable fallback, never future discoveries; canceled movement discards staged discoveries |
| Appearance | Promotion/reclass, recruitment faction swap, acted/sleep state, large footprint, contrast settings, missing old asset descriptor |
| Continuation | Reload after resolved combat before level-up/Canto completion; stable parent/fragment identity; no duplicate beats or lost committed trade; outstanding parents survive ordinary and trade-only checkpoints without becoming executable gameplay continuations |
| Rewind policy | Normal/Hard action targets, Lunatic turn starts, legacy battles, zero charges, current point, enemy/recovery/report points disabled |
| Transaction | Double Confirm, failed write/retry, quota failure, refresh before/after commit, stale battle revision, repeated rewind then divergent branch |
| Committed restoration failure | Inject failure after durable write during snapshot application, sprite/camera reconstruction, and session handoff; exactly one debit; old battle remains inert; Back/ESC/Cancel cannot return to it or retry purchase; reload restores committed checkpoint |
| Lifecycle | Rapid open/close, cancel during tween, resize, rotation, background/resume, host shutdown, renderer setup failure, confirmation Back, no input leaks or late callbacks |
| Archive | Budget boundary, huge fragment, complete-segment pruning, keyframe rebasing, parent-reference pruning, dropped optional archive, bad references, mixed schemas, old report, cold random seek; run mandatory persistence suite with V5 disabled as well as with extended retention |
| UI | Empty/single/long lists; long actor/item/class names; scroll retention; touch slide-off; keyboard and controller-only use; static/reduced-motion equivalent |

Extend existing `BattleTimeline`, integration, view, rewind transaction, RNG, and journey suites. Add focused tests for pure presentation reconstruction/visibility/retention and session lifecycle. Extend `tests/e2e/battle-timeline.spec.js` for actual canvas appearance and interactions; add new browser files to the enumerated UX gate if split out.

Use gameplay fixtures that exercise real combat resolution for fidelity checks. A view test built entirely from handcrafted strings cannot establish actor/target or HP correctness. Capture representative screenshots for visual review, while keeping state assertions authoritative for exact results.

Relevant commands during implementation:

- Focused `npm test -- tests/<touched-suite>.test.js` and new presentation suites.
- `npm run test:timeline` (explicitly add any new required suites).
- `npm run test:journey` and relevant harness checks.
- `npm run test:ux-contracts` with the new browser cases included.
- Before release readiness: existing scene-lifecycle merge gate, lint, format check, production build, and reference/theme checks where affected.
- No gameplay-data edits are planned. If implementation changes source data, follow `sync-data`, `validate:data`, and data parity requirements.

## 11. Performance and responsiveness targets

These are proposed acceptance targets to validate on a named reference desktop/browser and physical phone; they are not measured results:

- Active-battle viewer opens within 250 ms for an already-loaded recent history.
- Adjacent instant navigation reaches its settled frame within 50 ms at the 95th percentile.
- Cold seek within the supported archive budget reaches its settled frame within 150 ms at the 95th percentile.
- Repeated navigation has a bounded queue of one latest request; no accumulated playback delay.
- At most 31 chronological-fragment deltas follow the nearest keyframe during ordinary seek reconstruction, regardless of how many parent actions the UI groups together.
- Maintain smooth brief animations on the reference phone; investigate sustained frame times above 33 ms.
- After 50 open/browse/close cycles, active display objects/listeners/timers/scopes return to baseline; document heap observations rather than requiring exact GC-dependent byte equality.
- Measure save capture, serialization, write, and hydrate costs separately. New archive work must not cause visible recurring stalls at action completion.

If targets are missed, first reduce cosmetic work, materialize only needed sprites, bound caches, and simplify effects. Do not solve a performance problem by rerunning gameplay, showing hidden state, or weakening durable save boundaries.

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Shared graphics extraction changes ordinary battle appearance | Narrow visual factory extraction; before/after representative battle screenshots and existing camera/HP/contrast checks |
| Preview accidentally mutates live battle | Presentation-only scene and data contract; no live unit references; broad neutrality digests |
| A path or camera pan exposes unseen enemies | Capture observable path fragments and focus targets at event time; test all output channels |
| Recorded action is attributed to the wrong unit | Stable entity/action references; explicit sources and targets; never parse names or infer causes from absence |
| Interleaved parents reorder or undo another unit's action | Globally consecutive fragment edges; parent IDs group details only; trade/interleave/reload/rewind fixtures |
| Save/resume splits or duplicates one action | Durable fragment identity and outstanding-parent metadata at all existing checkpoints; idempotent finalization |
| Observation history is lost under quota or rewind | Independently owned filtered observation memory with target-time restore; explicit unavailable-cell fallback when metadata is gone |
| Rich history consumes rewind capacity | Separate optional archive budget; prune presentation before core snapshots; benchmark total save envelope |
| Rapid scrubbing/confirmation releases battle early | Session-owned lock, generation tokens, exact endpoint before commit, one cleanup path |
| Reconstruction fails after a rewind is saved | Separate committed-needs-reload state; preserve debit and target; no return to old battle or purchase Retry |
| Stored report depends on a missing live scene | Self-contained filtered render metadata and dedicated history scene; results-screen cold-load test |
| Whole-battle scope grows into save-system replacement | Keep bounded JSON storage initially; explicit decision gate if measured limits cannot meet desired retention |

## 13. Definition of done

For newly recorded supported history, the player can recognize the real battlefield, step through both sides' actions, see who acted on whom and what changed, and reverse those visual changes without altering the live battle. The displayed settled point and any confirmed rewind target agree exactly. Cancel is harmless. Hidden information stays hidden. Save/resume, defeat, zero-charge review, and failed-write recovery retain their existing guarantees.

The complete feature includes action recording, animated map navigation, compatible persistence, and mobile/input verification. A static map preview alone completes V1, not this project. Whole-battle review is included only if the provisional preference is retained and V5's measured gate passes.

## 14. Planning record

- Inspected current timeline, recorder, rewind controller, snapshot adapters, scene rendering/movement, camera/input infrastructure, report entry point, and existing timeline tests.
- Used the earlier approved rewind plan for established policy decisions; did not reopen enemy-action rewind or change charge/randomness rules.
- The older mobile controls document is contextual guidance; current source and actual supported layouts take precedence over its historical implementation status.
- No runtime code or gameplay data changed and no tests/builds were run for this planning-only document.

## 15. Adversarial review disposition

The delegated read-only review identified the following planning issues. They are incorporated into the normative requirements and milestones above, rather than left as implementation reminders. **Addressed in the spec** does not mean implemented or independently re-reviewed.

| Finding | Integrated correction | Required implementation evidence |
| --- | --- | --- |
| R1 — P1: logical parent actions can interleave across units | Sections 4.3–5.3 separate chronological fragments from parent grouping; checkpoint all outstanding parents; restore parent status at the selected rewind boundary | Mandatory V2 trade/interleave/reload/rewind sequence and consecutive-frame parity |
| R2 — P1: optional V5 contained mandatory persistence work | V1 owns safe frame persistence and paid-rewind integration; V2 extends it to fragment graphs; V5 only extends retained span | V1/V2 quota, pruning, branch, report, migration, and reload gates pass with V5 omitted |
| R3 — P2: last-observed terrain lacks durable ownership after history loss | Section 6.1 defines recorder-owned optional observation memory and unavailable explored cells when that memory cannot be recovered | V1 observation-loss fixture, target-time rewind knowledge, and no hidden-terrain substitution |
| R4 — lifecycle clarification: durable commit followed by reconstruction failure | Sections 7.2–7.3 distinguish pre-commit retry from committed-needs-reload; the latter preserves one debit and cannot return to the old battle | V1 failure injection after durability; V4 session/camera handoff checks; reload adopts committed checkpoint |


## 16. Implementation record

### Delivered behavior

The timeline now presents a separate Phaser battlefield using the bundled terrain and historical unit artwork. Landscape/mobile history uses the same weathered terrain painter and contrast treatment as the battle. Opening history pauses and hides the host scene synchronously, expands the map into the former command-rail area, and retains the host camera for restoration. It does not call a gameplay restore or make a checkpoint.

Action and turn navigation, a History drawer, expandable details, recorded-only unit/tile inspection, touch pan/pinch, zoom buttons, keyboard Map mode, and existing controller input scopes are connected. Adjacent observed movement uses recorded routes; combat and healing show known participant connections and recorded HP changes. Backward navigation restores the earlier endpoint, with an Undoing indicator during animation. Rapid input cancels obsolete transitions. Instant speed/reduced motion uses static endpoint cues. Missing route observations remain endpoint-only.

The session survives confirmation Back, preserving selection, camera, drawer and scroll position. Closing removes its scene, temporary terrain textures, observers and handlers. Paid rewind keeps the existing durable transaction, charge policy and snapshot eligibility. A failure after a successful write offers Reload with the debit preserved; it cannot retry the purchase or return to the old battle.

### Final data model

- Timeline envelope version **2**, accepting version-1 saves; optional archive version **1**, decoded frame version **2**.
- The battle identity remains owned by the enclosing `battleInProgress` record. Timeline revision scopes branches; `presentationNextId` and `presentationGeneration` survive archive removal. Viewer caches belong to one session and are discarded on close.
- The archive contains globally ordered fragments, visible actor/target IDs and event positions, typed outcome values, recorded routes, canonical entry associations and outstanding parent IDs at each endpoint. Parent completion is represented by removing that actor from the outstanding-parent map. No parent registry drives gameplay.
- Contiguous unfinished fragments can group into a completed action. An intervening actor, gap or legal destination prevents grouping. A reused canonical recovery row detaches the older visual fragment from that destination without moving it in chronology.
- Keyframes occur at turn starts, gaps, map changes and at most every 32 fragments. Repeated tile descriptors use a palette/run encoding. Unit deltas store changed fields; additions/removals retain complete visible unit descriptors. Before/after deltas support exact reverse reconstruction. A viewer caches at most eight decoded frames.
- The latest complete filtered frame is also the recorder's observation memory. Pruning rebases the first surviving keyframe and retains the current endpoint; losing the entire optional archive restarts hidden explored cells as explicitly unavailable. No current hidden terrain is substituted. Canceled paths are discarded on undo and movement fault recovery.
- The 128 KiB optional archive cap uses only room left within the existing 512 KiB timeline cap. Core snapshot retention takes priority. Quota fallback sheds presentation first, then core history if necessary, preserving the authoritative recovery record and presentation allocation cursors. Old archive rows without snapshots are review-only.
- Hydration rejects unknown display fields, malformed coordinates, art keys, fragment references and inconsistent reversible deltas. Retained canonical associations must match turn/phase/kind/revision and the compact endpoint. Invalid optional data is discarded independently of recovery.

### Outcome coverage

| Family | Recording owner / presentation |
| --- | --- |
| Move, Wait, Canto, undo | `BattleScene` movement observation and `BattleActionCompletion`; committed effective routes, acted state, staged-path cancellation |
| Combat, counters, misses, critical hits, deaths | Resolved combat events and `removeUnit`; observed identities/positions, typed damage and miss/critical flags, final HP/presence |
| Heal, cure, relocation, enemy status staff | `HealController` and enemy callbacks; known source/target, applied healing/status and relocation endpoint |
| Abilities, Dance, Gambit | `AbilityController`, dance resolution and `BattlePresentationCheckpoint`; affected participants, HP/status/stat effects and refreshed availability |
| Trade, equipment, consumables | Both trade interfaces, item resolution and filtered endpoint differences; exact committed items and equipment |
| Shove, Pull, Swap, Blink | Resolved action hooks; known participants and relocation endpoints; no invented walking route |
| Promotion, reclass, recruitment | Controller/conversion hooks; historical class, sprite and faction |
| Escape, caravan exit, revival, reinforcements | Corresponding controllers/scene hooks; explicitly observed presence changes, caravan step route |
| Village, ballista, temporary/destructible terrain, exits | Filtered object/tile observations, village/capture/break hooks; recorded object details and terrain appearance |
| Automatic effects and affix/splash consequences | Visible HP/status/stat/terrain endpoint deltas plus existing resolved action facts; grouped at existing stable boundaries |
| Fatal/terminal/report | Existing fatal and post-combat persistence paths; same standalone history renderer with no live BattleScene dependency |

Complex automatic effects and forced relocation use concise endpoint cues rather than recreating every original effect animation. A unit leaving visibility is not inferred to have died, and a newly visible unit is not inferred to be a reinforcement. Actual scene hooks provide explicit causes where observed.

### Retention measurements

Synthetic codec fixtures on the local macOS/Node 25 host, using 20 events per turn, fixed unit inventories and one changed actor per event. These exercise storage and reconstruction, not gameplay balance or physical-phone performance. Numbers below measure the optional archive alone; less space can be available when core snapshots fill the shared envelope. Real combat details, varied terrain and inventory changes affect retained span.

| Fixture | Map / units | Input events | Retained events | Archive bytes |
| --- | --- | ---: | ---: | ---: |
| Short | 12×10 / 12 | 30 | 30 | 15,047 |
| Typical five-turn sequence | 18×14 / 24 | 100 | 100 | 73,782 |
| Large / reinforcement-sized roster | 24×20 / 40 | 180 | 131 | 131,020 |
| Fog | 18×14 / 24 | 100 | 100 | 82,038 |
| Long stalled battle | 18×14 / 24 | 300 | 172 | 127,104 |

A smaller action fixture retains the whole battle; large or stalled cases explicitly trim older review data. This supports bounded extended review, not a universal whole-battle guarantee. Timing collected while other browser tests were running is diagnostic only; the physical-device timing targets in section 11 remain release checks.

### Verification and remaining release checks

- The targeted timeline suite covers migration, quota fallback, strict frame/delta validation, reverse/random seeks, repeated keyframe pruning, interleaved trade/action/reload/branching, canceled and hidden routes, contiguous grouping, endpoint associations, post-commit teardown failure, synchronous session acquisition and stale callbacks.
- Browser checks cover paid rewind/reload, confirmation Back, zero charges, fatal decision/report paths, 640×480 and landscape layouts, actual movement recording, rapid scrubbing and exact camera restoration. Additional combat and 50-session leak checks are recorded with the final test results below.
- The broad unit/harness suites, full-run simulation slices and production build were exercised. The broad browser suite is not green; its results and limits are listed separately below.
- Physical iPhone gestures, app background/resume, audio/device performance and heap profiling have not been verified in this workspace. The browser checks do not substitute for that release gate.
- Older saves and points whose optional art has been pruned keep their existing compact preview or an unavailable indication. History never invents missing old routes, appearances or hidden terrain.

Final workspace verification (September 21, 2026):

| Check | Result |
| --- | --- |
| Targeted timeline suite | 238 tests passed across 10 files |
| Full unit suite | 5,675 tests passed across 338 files |
| Harness suite | 165 tests passed across 11 files |
| Full-run simulation PR gate | All four slices passed |
| Rewind and battle action browser contracts | All 13 tests passed, with no retries in the final run |
| Production build | Passed; existing bundle-size advisory remains |
| Changed-source formatting and lint | Formatting passed; no lint errors; BattleScene retains the same 40 warnings as HEAD |

The 50-session browser test caught a terrain-texture leak: Phaser scene removal emits `destroy` without necessarily emitting `shutdown`. The history renderer now releases its resources on either event, idempotently. The final test checks for no new retained textures, zero history textures/scenes, stable shutdown listeners, restored battle input ownership and unchanged gameplay state. Existing host textures may expire during the test. This is a resource-count check, not physical-device heap profiling.

The earlier full browser run finished with 216 passed, 48 failed, 2 flaky and 1 skipped. One failure was the Vision healing fixture using the old confirmation flow without a real save slot; the updated fixture passes in the final focused run. Other failures span touch setup, selection expectations, menus, rewards and run-loop flows. Inspected examples include calls to `tap()` without a touch-enabled context and selection assertions expecting `UNIT_SELECTED` where the current UI enters `UNIT_ACTION_MENU`. Those examples do not establish that every remaining failure predates this change: the full browser release gate remains unresolved, and the full suite was not repeated after the focused fixes. Concurrent unrelated workspace changes were preserved.

Implementation is complete in the workspace. Release readiness still requires triage of the broad browser failures and the physical-iPhone checks above. No commit or deployment was performed.

## 17. Release review follow-up

The subsequent review found and fixed a history-rendering RNG regression missed by the original Instant/condition-free browser fixtures. All history text now uses the presentation-only text helper. The new failing-before/passing-after browser case checks status labels and animated HP cues against the live RNG, save and unit state.

The recent end-turn locator also retains Keep playing as its default focus. The updated evidence and explicit broad-browser baseline comparison are recorded in [the release review](../battlefield-rewind-release-review-2026-09-21.md). No enemy-action rewind destinations were added.
