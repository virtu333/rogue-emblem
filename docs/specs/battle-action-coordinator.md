# Battle action coordinator: design note (2026-10-02)

Base: `main` @ `942973ce`; every `file:line` was read there. "Verified" = a throwaway probe (`tests/zzF_*`, deleted) reproduced it; "read-only" = traced in source.

Read with `docs/specs/stability-review-response-2026-09-30.md` (guarantees, checkpoint rules, PR 8), `stability-pr5-combat-boundary.md`, `stability-pr6-action-settlement.md`.

## 0. Summary

Rules are shared (`PostCombatEffects`, `StaffSettlement`, `PerBattleWeapons`, `BattleXp`, `UnitHealth`); orchestration is not. Seven production entry points and two test harnesses each sequence lock → intent → costs → effects → deaths → XP → defeat → swaps → level-ups → checkpoint → completion → recovery by hand. Proposal: one `runBattleAction(host, ctx, action)` in `src/ui/BattleActionCoordinator.js` with a fixed stage list, an operation context bound at acceptance, and a recovery boundary spanning every stage. Combat's remaining presentation-interleaved domain work (`removeUnit`, the strike loop) moves into engine outcome records first, so the pipeline settles before it presents. The headless harness and the journey driver then call the same pipeline with a null presenter. This supersedes PR 8: its "shared combat outcome" becomes two PRs below; the coordinator is what PR 8 lacked.

## 1. Inventory

### 1.1 Entry points

| # | Action | Entry (942973ce) | Orchestration |
| --- | --- | --- | --- |
| P1 | Attack | `confirmForecastCombat` BattleScene.js:4561 → `executeCombat` :8261; resume `resumeCommittedAttack` :8213 | hand-rolled |
| P2 | Chosen-center art | `AreaTargetingController.fire` :390 → `execute` :487; resume `resumeIntent` :446 | copy of P1 |
| P3 | Staff heal/cure/HealAll/relocate | HealController `_runStaff` :393 (`_executeHealing` :486, `executeRelocate` :356) | `settleAndPresent` |
| P4 | Consumable | `useConsumable` :7120 | `settleAndPresent` |
| P5 | Blink; Rally/Circle/Ensnare | AbilityController `executeBlink` :286, `executeSelfCentered` :421 | `settleAndPresent` |
| P6 | Shove/Pull/Swap, Dance, Talk | MovementActionController `executeMove` :27, `executeDance` :93, `executeTalk` :144 | `settleAndPresent` |
| P7 | Reclass | `showReclassClassPicker` :7295 (:7370) → ReclassController `executeReclass` :22 | hand-rolled, stage flags |
| P8 | Promote | `useConsumable` :7124 → PromotionController (`promoteUnit` :191, capture :245, finish :306) | hand-rolled |
| P9 | Wait / Break / Smash / Capture | :6295, `executeBreak` :5301, ZombieRemainsController :161, `_captureBallista` :6374 | direct `finishUnitAction` |
| P10 | Canto confirm, End Turn, deselect | `handleCantoClick` :5645 (:5653, :5769), `confirmCantoMove` :5870, `forceEndTurn` :4271 (:4338–4343), `deselectUnit` :4657 (:4762) | direct `completeBattleAction`/capture |
| P11 | Seize, Escape | :6274–6278 (`onVictory`); EscapeObjectiveController `executeEscape` :92 (capture :134) | hand-rolled |
| P12 | Trade/reorder (no action) | BattleTradeController :100–109, :120–131 | mutate → capture |
| E1 | Enemy attack (enemy area arts via `_prepareCombatContext` :7954) | onAttack :10283 → `executeEnemyCombat` :10523 | hand-rolled |
| E2 | Enemy status staff | onStatusStaff :10279 → `executeEnemyStatusStaff` :10405 | none |
| E3 | Enemy heal | AIController `applyHealDecision` :154 → onHeal :10269 | none |
| E4 | Enemy move / break | `animateEnemyMove` :10357; `executeEnemyBreak` :10671 | none |
| E5 | Entity splash | `_applyEntitySplash` :10631 (inside E1) | inline |
| E6 | Enemy completion | onUnitDone :10292–10325 | inline |
| T1 | Ballista, both phases | `processBallistaFire` :9708 (:9443, :9603) | inline |
| T2 | Turn-start/tail effects, reinforcements, revival | :9614, :9960, :2649, :9814 | pipeline; `_recoverEnemyPhaseError` :10100, `_recoverPlayerHandoff` :10142 |
| H1 | Headless harness | HeadlessBattle `_executeCombat` :1701, `executeAreaStrike` :1830, `_executeHeal` :1885, `_executeTalk` :1929, `_executeEnemyCombat` :2215, `_processEnemyPhase` :2100 | parallel mirror |
| H2 | Journey fuzz driver | JourneyBattleDriver.js:112–118 (own `resolveCombat`, assigns `currentHP`) | third copy |

### 1.2 Stage matrix

M = mutation, P = presentation, D = durable write.

| Stage | P1 attack | P2 area strike | P3–P6 (`settleAndPresent`) | P7 reclass | E1 enemy attack | E2 status staff |
| --- | --- | --- | --- | --- | --- | --- |
| Lock | `COMBAT_RESOLVING` :8263, no re-entry check | :497 after `_legal` :491 | refuses `RESOLVING`/enemy phase, sets state :24–31 | WeakSet + state :74 | none (serial AI loop) | none |
| Session | sampled at entry :8262 | sampled :489, compared to **construction-time** `this.session` :74/:490; `commitIntent` samples again :425 | **default param** `session = battleSession(scene)` :21 | sampled :24 | :10524 | :10406 |
| Intent (D) | `_commitCombatIntent` :8267 (`commitIntent`, no reseed) | `commitIntent` :499 | none | none | none (per-enemy checkpoint is the boundary) | none |
| Retry gate | :8268–8279 | :503–514 | after settle capture :67–76 | none | onUnitDone :10311–10322 | none |
| Costs (M) | art cost/recoil :8003–8013, Phoenix awaited :8011 | equip/cost/shot/use :519–524 | inside `settle()` | seal :91 after `reclassUnit` | :8003 | `spendStaffUse` :10418 |
| Effects (M) | `resolveCombat` :8017; `applyStrikeHP` :8066; warp :8078; `applyCombatHP` :8110; shots :8113; deeds :8127; beats :8135 (`remove`/`moved` required, rest guarded :8478–8486) | `areaStrikeEffects` via beats :530 | `settle()` :54, synchronous | `reclassUnit` :77 | as P1 (:10531) | `resolveStatusStaff` :10409 |
| Deaths (M+P) | `removeUnit` :8338/:8342 (async: fade :9062, dialogues :9101/:9121/:9146, Deathburst chain :9201–9250); sweep :8345 | `remove` beats; sweep :562 | n/a | n/a | :10554/:10556, splash :10561, sweep :10564 | n/a |
| XP (M) | `awardXP` :8302 before removals | :559 after beats | `awardScaledXP(…,{present:false})` in settle (HealController :413, Dance :110) | none | defender :10540 | none |
| Defeat | `hasBattleDefeat` → `checkBattleEnd` :8349 | :564 | not checked | n/a | :10568 | n/a |
| Spent-weapon swap | :8363 | :576 | n/a | n/a | :10582 | n/a |
| Capture (D) + level-ups (P) | `presentQueuedLevelUps(…, continuation)` :8393 — **captures `combat` only when the queue is non-empty** (BattlePresentationCheckpoint.js:78–80) | :594, same | capture `finish` **before** presentation :66 (`preserveRng`); level-ups :93 | capture :106, then present | onUnitDone checkpoint :10305–10310, level-ups :10323 | none |
| Completion | `completeResolvedAction` :8395 → `finishUnitAction` :5018 → Canto / `completeBattleAction` :5073 (checkpoint :48, `unitActed` :50) | :596 | `finishUnitAction` once :96 | :119 | onUnitDone marks acted :10294 | via onUnitDone |
| Boundary | `try` :8284–8450; catch :8396–8444 clears intent, reports, removes dead, consumes action | `try` :517–604; **:515–516 outside**; `finally` :603 unguarded | `try` :44–103 → `_recoverUnitActionError` :5082 | `try` :72–139 with `applied/sealSpent/captured` | `try` :10529–10627 | none: escapes to `_scheduleSafeDelayedAsync` onError → `_recoverEnemyPhaseError` :10100 |

Promotion (P8) follows P7's shape (seal :203–205 before weapons, capture :245, presentation `try` :257–304, finish :306).

### 1.3 Divergences and latent defects

| Id | Finding | Status |
| --- | --- | --- |
| D1 | `AreaTargetingController.execute`: `resetFortHealStreak` :515 and `_musicCtrl?.onCombat?.()` :516 sit outside the `try` :517. A throwing music controller rejects the promise (unhandled: `void this.fire()` :265/:306) and leaves `COMBAT_RESOLVING`; nothing spent. `executeCombat` guards the same call (:7974). With a run active the `area_strike` intent is already persisted (:499), so only a refresh frees the battle. | **Verified**: rejected, state `COMBAT_RESOLVING`, caster HP 32, target HP 30 |
| D2 | Same controller, `finally` :603 unguarded: a throwing `onCombatResolved` rejects `execute` after completion (`PLAYER_IDLE`, acted). | **Verified** |
| D3 | `executeEnemyStatusStaff`: condition and use settle (:10409, :10418) before three unguarded awaited banners (:10420/:10433/:10452); a throw escapes the action and `_recoverEnemyPhaseError` ends the phase; the enemy is never marked acted, no checkpoint. | **Verified**: rejected, `_usesSpent` 1 |
| D4 | `executeCombat` with the same music throw recovers (`PLAYER_IDLE`, acted): the asymmetry the reviewer named. | **Verified** |
| D5 | Three session styles: default-at-invocation (:21; MovementActionController :27/:93/:144), entry sample vs construction-time field (HealController :396, AbilityController :289, AreaTargeting :490), entry sample alone (Reclass :24). A controller recreated lazily after `init` (`||=`, :6700) gets the new session, so the construction-time check catches an old *controller*, never an old continuation through a new one. | read-only |
| D6 | P1/P2 have no durable boundary between the pre-roll intent and `completeBattleAction` unless level-ups queue (:78–80); P3–P8 capture before presenting. A refresh during Canto replays the whole attack (deterministic, correct), but "a resolved action" has two durability contracts. | read-only |
| D7 | `executeCombat` catch cleanup :8437–8438 is unguarded inside the catch; a throw there after `hasActed = true` :8427 skips `completeBattleAction` :8442, so `unitActed` never runs and the phase cannot auto-end. | read-only |
| D8 | `_announceWeaponSwaps` :7231–7235 swallows banner errors with a bare `try/catch`, no telemetry. | read-only |
| D9 | `animateEnemyMove` writes `col/row` after awaited tweens (:10399–10400); `updateUnitPosition` :10401 and onUnitDone's `dimUnit` :10295 (before the checkpoint :10305) are unguarded; any throw takes D3's path. | read-only |
| D10 | `executeEscape` has no boundary and hand-copies completion obligations (:126–136) instead of `completeBattleAction`. | read-only |
| D11 | Harness mirrors diverge: `_removeUnit` :2015 has no Deathburst cascade or commander/killer tracking; `_checkBattleEnd` :2071 ignores `_deathAffixChainDepth` and the Vision prompt; `_finishUnitAction` :1943 has no Canto (`CANTO_DISABLED` :184) or checkpoint; `_processEnemyPhase` :2100 has no per-enemy checkpoint and inlines status staves :2132–2137. JourneyBattleDriver.js:112–118 is a third combat copy. | read-only |
| D12 | Reclass marks `applied = true` :76 before `reclassUnit` :77; a partial throw inside it is reported as settled and the seal spent (:124). Deliberate in PR 4; §4 fixes it. | read-only |

## 2. Coordinator design

### 2.1 Shape

```js
// src/ui/BattleActionCoordinator.js — scene-free: takes a host (§2.6)
export async function runBattleAction(host, ctx, action) → { ok, stage, outcome } | false

action = {
  kind, lockState,            // 'COMBAT_RESOLVING' | 'HEAL_RESOLVING'
  validate(),                 // sync pure read → boolean
  intent?(),                  // sync → pendingCommittedAction (P1, P2 only)
  resolve(),                  // sync domain settlement → outcome { facts, beats, credits, continuation? }
  present?(outcome, ctx),     // async; every call under safeBattlePresentation
  onInvalid?(),               // e.g. restoreCombatWeapon
  rollback: 'none' | 'unit-scoped',   // §4
}
```

### 2.2 Stages and ordering contract

| # | Stage | Rules |
| --- | --- | --- |
| 0 | accept | `isOperationCurrent(host, ctx)`; refuse when `battleState ∈ RESOLVING` or phase/turn/epoch moved; set `battleState = lockState` synchronously; `commitVisionSnapshotIfPending`. Nothing mutated. |
| 1 | validate | Pure read with the menu's finders. Failure: restore prior state, `onInvalid`, `showActionMenu` (guarded), return `false`. |
| 2 | intent (D) | If `action.intent`: set `_pendingCommittedAction`, `captureCheckpoint({ commitIntent: true, session })`; then the save-retry gate; then stage 0's checks again. |
| 3 | resolve (M) | One synchronous call: costs, rolls, HP, positions, statuses, shots, XP (`applyXpGain` through `awardScaledXP(…,{present:false})`), deaths (§2.3), credits, deeds, history, spent-weapon swaps. The only stage that draws from the battle stream. |
| 4 | terminal | `_sweepFallenUnits`; `hasBattleDefeat` → `checkBattleEnd()` (persist-first fatal/defeat) and stop. Clear `_pendingCommittedAction`. Rout/escape victory stays where completion checks it (`completeResolvedAction` :169; enemy :10603). |
| 5 | capture (D) | `captureResolvedAction(host, continuation, { session, preserveRng: true })`, always. Retryable failure → gate → recheck ctx and terminal flags. |
| 6 | present (P) | `present(outcome)` under `safeBattlePresentation`; ctx check after each await; may not change gameplay state. |
| 7 | level-ups (P) | `presentQueuedLevelUps(host, null, { session })`, no second capture. |
| 8 | complete | Once: `completeResolvedAction` (Gambit/Galeforce/Canto/finish) → `completeBattleAction` → completion checkpoint (legacy reseed as today) → `unitActed`. Enemy ctx: mark acted, enemy-action checkpoint, gate, level-ups (today's onUnitDone). |
| R | recover(error) | Spans 2–8 including presentation, music and cleanup. By `ctx.stage`: before `resolved` → restore prior state, clear intent, menu; at or after → `reportAsyncError('battle_action_domain_error')`, unit-scoped rollback where declared (§4), else forward invariants: sweep fallen, defeat check, consume action once, complete once, never exit in `RESOLVING`. Ownership rechecked in catch/finally. |

Test-asserted invariants: no `await` between stages 3 and 5; fixed-v1 cursor unchanged across 5–8; `battleState` leaves `lockState` on every path; `hasActed` flips at most once.

### 2.3 Settle, then present: the generator split

`PostCombatEffects` yields `remove`/`moved` (required) and `hp`/`poison`/`status`/`hint` (presentation) beats (PostCombatEffects.js:5–16); `runPostCombatEffectsSync` :469 drains them headlessly. The coordinator generalises this: **stage 3 drains every generator to completion and records the beats; stage 6 replays the recorded beats to the presenter.** Two combat pieces still interleave awaited presentation with domain work and must be split first:

1. **Deaths.** `removeUnit` :9026 mixes splice/rewards/remains/Deathburst damage with fades, dialogues and a 150 ms tick. Extract `engine/UnitRemoval.js`: `function* removeUnitEffects(unit, { killer }, world)` does the domain work (commander/killer tracking, splice, `_playerDeathsThisBattle`, kill rewards, remains, Deathburst damage with recursive `remove` beats, temporary-terrain cleanup) and yields `{ kind: 'fell', unit, killer, lines, boss }` and `{ kind: 'burst', victim, amount }`. The scene's `presentUnitRemoval(beat)` plays fade, last words, farewells, quips, banners. The chain-depth guard in `checkBattleEnd` :10814 becomes dead (the chain is synchronous); keep the `init` reset.
2. **Strikes.** `_runCombatResolutionAtSpeed` :8054–8097 applies `applyStrikeHP` per event, awaits `animateStrike`, then settles the warp. Move the domain half into `engine/CombatOutcome.js`: `settleCombat({ attacker, defender, ctx, world, random })` → `{ result, strikes: [{ event, hpRows, warp }], beats, phoenix, spentShots, swaps, credits }`, drawing in today's order (hit/crit in `resolveCombat`, one warp draw per candidate set after strike *i*, growths in `applyXpGain`). `animateStrike` reads `strikes[i]` plus a display-HP projection, never live HP (the PR 8 note's display-only `_showStrikeResult`).

Visual consequence: bars already settle at contact (PR 5); only a Deathburst chain's numbers and fades now play after the chain's damage is final. Beat order is preserved.

### 2.4 Resumable decisions

| Decision | Today | Under the coordinator |
| --- | --- | --- |
| Level-up cards | `_pendingLevelUpPopups`, not persisted (`captureBattleState` :5–48 omits it); stats are in the checkpoint; resume drops the card | unchanged, stage 7 |
| Canto, Gambit, Galeforce | `pendingActionCompletion` `combat`/`finish` + flags (`ActionContinuation.js`); resume → `completeResolvedAction` :430 | unchanged, stage 8 input |
| Commander fallen: rewind or defeat | `persistFatalDecision` (BattleFatalDecision.js:8) writes `recoveryKind: 'fatal_pending'`; resume → `resumeFatalDecision` :71 | stage 4; persist-first; ends the operation |
| Committed attack / strike | `pendingCommittedAction`; resume replays | stage 2; `resumeCommittedAttack` :8213 / `resumeIntent` :446 re-enter `runBattleAction` with a fresh ctx |
| Talk line, rite, banner | skippable ceremonies | stage 6 |

No new persisted decision.

### 2.5 Checkpoints and save-retry

Three durable points, all existing: intent (2), resolved (5, `preserveRng`), completion (8, reseeds legacy as today). Stage 5 is new only for P1/P2 without level-ups (D6); its resume path is the one level-up resumes already take. The gate is awaited at 2 and 5 only, never in `finally` (PR 6c). Latest-wins retry is untouched.

### 2.6 Enemy phase and the host

Enemy actions run the same pipeline with `ctx.phase = 'enemy'`, `ctx.epoch = _enemyPhaseEpoch`, no intent, and stage 8 = today's onUnitDone body. Stage R for an enemy op settles the dead, checks defeat, marks the enemy acted, writes the enemy-action checkpoint and returns normally so `AIController._processOneEnemy` :122 continues with the next enemy. `_recoverEnemyPhaseError` :10100 remains the backstop for the tail (terrain, reinforcements, handoff). Behaviour change (D3): one enemy's cosmetic failure no longer ends the phase — decision O1.

The coordinator depends on a host, not on Phaser:

```js
/** @typedef {object} BattleHost
 *  playerUnits, enemyUnits, npcUnits, escapedUnits, battleState, turnManager, runManager, grid
 *  _postCombatWorld(), getUnitAt(), _getTier5HostileUnitsFor(), getDivineChargeAllies()
 *  _captureSuspendCheckpoint(opts), _saveRetryGate(session), checkBattleEnd(), commitVisionSnapshotIfPending()
 *  finishUnitAction(u, opts)   // + completeBattleAction from BattleActionCompletion
 *  presenter: null | { beat(), strike(), removal() }   // null = headless, pipeline runs synchronously
 */
```

BattleScene already satisfies it (these are what `settleAndPresent` and the controllers call). HeadlessBattle mirrors most of it (`_postCombatWorld` :1661, `_checkBattleEnd` :2071, `turnManager`); PR H makes it a host with `presenter = null` and deletes its mirrors. Canto stays disabled there (`skipCanto: true`), stated at `CANTO_DISABLED`.

## 3. Operation context

```js
/** @typedef {object} BattleOperationContext
 *  @property {number} session   battleSession at acceptance (BattleSession.js:4)
 *  @property {number} opId      monotonic per scene instance, diagnostics only
 *  @property {'player'|'enemy'} phase
 *  @property {number} turn
 *  @property {number|null} epoch   _enemyPhaseEpoch for enemy ops
 *  @property {string|null} actorId battleEntityId
 *  @property {string} kind
 *  @property {'accepted'|'intent'|'resolved'|'captured'|'terminal'|'completed'|'recovered'} stage */
export function beginBattleOperation(host, { kind, actor, phase }) → ctx | null
export function isOperationCurrent(host, ctx) → boolean   // session ∧ !shutdown ∧ phase ∧ turn ∧ epoch
```

Created by the code that accepts the input (menu `invoke`, `fire()`, `confirmForecastCombat`, `handleStaffTileClick`, the AI callbacks) and passed down; nothing below samples `battleSession` again. Validated at stage 0, after every await, in catch/finally. `isCurrentBattleSession(scene, ctx.session)` stays the primitive; `isOperationCurrent` adds the phase/turn/epoch check that only `_scheduleSafeDelayedAsync` and `startEnemyPhase` make today.

Replacing D5: `settleAndPresent`'s default (:21) and MovementActionController's defaults become a required `ctx`; construction-time `this.session` fields (AreaTargeting :74, HealController, AbilityController) are deleted; `captureResolvedAction`, `presentQueuedLevelUps`, `completeResolvedAction`, `completeBattleAction`, `finishUnitAction` accept `{ ctx }` (deriving `session`), keeping `{ session }` for P9–P12 and resume. A sampling default stays legal only in a synchronous shim that passes it on at once (`_awaitSceneTween` :1061).

Enforcement: JSDoc typedefs plus an AST test suffice, no TypeScript. Extend `tests/BattleCheckpointOriginContract.test.js` (it already walks the AST for `_captureSuspendCheckpoint` calls lacking a session) with two rules over `src/ui/*.js` and `src/scenes/BattleScene.js`: (a) a function containing `await` may not default a parameter to `battleSession(`; (b) `this.session` may not appear in a controller that calls `runBattleAction`. Each rule ships a fixture that fails it.

## 4. Domain consistency

Three guarantees, kept distinct:

1. **Presentation independence** — stages 3→5→6 plus `safeBattlePresentation`; already the matrix property (`CombatBoundaryPresentation`, `ActionBoundaryPresentation`).
2. **Domain consistency** — no half-committed action:

| Option | Fit | Verdict |
| --- | --- | --- |
| Compute-then-commit plans | Exists for combat (`resolveCombat` → `applyCombatHP`), area blows (`planAreaBlows`), staff/consumable/move settlements. Not feasible for death cascades (rewards, remains, recursion over scene and run state) or growth rolls (`applyXpGain` mutates while drawing). | Use where it exists; build no second rule copy (the response doc's warning). |
| Snapshot/rollback via JSON | `captureBattleState` and `rm.toJSON` exist and are already paid per checkpoint. Restore must be **in place** (`Object.assign` by `battleEntityId`): TurnManager, `selectedUnit` and graphics hold references. `rngState` restores exactly under both policies (BattleCheckpointAdapter :16, `reseedBattleRng` :2473). A full rollback is brittle (`goldEarned`, tombstones, fog, deeds); a partial one is worse than forward recovery. | **Unit-scoped rollback** for synchronous settlements with an enumerable write set (actor, named targets, their items, `runManager.gold/convoy` when touched): snapshot `serializeBattleUnit` of the set and the RNG state before stage 3; on a stage-3 throw restore in place, restore RNG, reopen the menu. |
| Recover forward with invariants | Cascades reach arbitrary units. | Default for P1/P2/E1/E2/E5/T1. Invariants: every 0-HP unit removed with attribution where known; defeat decided before any capture; action consumed once; intent cleared; never left `RESOLVING`; a domain error is never saved as a clean completion (PR 5/6 policy unchanged). |

Per action: P3–P8 → unit-scoped rollback (fixes D12); P1, P2, E1, E2, E5, T1 → forward recovery; P9–P12 → none needed (one sync mutation then capture).

3. **Durability** — stages 2/5/8 plus save-retry; contract unchanged.

RNG: fixed-v1 asserts cursor equality across presentation worlds (text isolated by `isolateBattleTextFactory`); legacy-v1 only live-vs-resume on one build (canvas text draws from the stream). Stage 5 must pass `preserveRng: true` so legacy is not reseeded mid-action (`captureCheckpoint` :98–102); completion keeps reseeding. Rollback restores the saved cursor; under legacy any text already drawn is undone with the action. Hidden-roll actions (P1, P2) keep their pre-roll intent, so they never need rollback: a replay reproduces the outcome.

Save format: unchanged. Continuation kinds stay `combat`/`finish`, intents `attack`/`area_strike`. `opId` is not written to the checkpoint (fixed-v1 `validateBattleState` would need a migration story for new fields).

## 5. Migration plan

Each PR merges on its own and ships tests that fail before it.

| PR | Scope | Files | Fails-before acceptance | Risk |
| --- | --- | --- | --- | --- |
| **A** | Fix D1/D2/D7/D8 in place: move :515–516 inside the boundary, guard the `finally`, observe `fire()` rejections, guard the catch cleanup, report swap banners. | AreaTargetingController.js, BattleScene.js | §1.3 probe as a test: throwing `onCombat` → `PLAYER_IDLE`, 8 HP and one shot spent, acted, `battle_presentation_failed` reported; throwing `onCombatResolved` → resolved promise. | S |
| **A2** | `BattleOperationContext`, `beginBattleOperation`/`isOperationCurrent` (`src/ui/BattleOperation.js`); AST rules (§3). No behaviour change. | new file, BattleCheckpointOriginContract.test.js | Rule fixtures fail the suite. | S |
| **B** | `engine/UnitRemoval.js`; `removeUnit` = drain then present; `_sweepFallenUnits` drives it; depth guard removed. | engine, BattleScene.js | Matrix green; Deathburst chain with every removal visual failing still yields the hand-derived rewards, remains, deeds and "defeated" history (round-2 B1); identical cursor. Planted: drop the recursive `remove` beat. | M (victory timing: owner removes primaries first) |
| **C** | `engine/CombatOutcome.js` `settleCombat`; `_runCombatResolutionAtSpeed` = settle → present rows; display-HP projection. **PR 8's engine half.** | engine, BattleScene.js, HealthPresentationInvariance.test.js | Fixed-v1 cursor equal across shown/skipped/all-failed/every-nth; Teleporter draw count by hand; planted live-HP read in `_showStrikeResult` fails the skipped world. | M–L |
| **D** | `runBattleAction`; migrate P1 and P2; delete `_recover`; stage 5 always. **PR 8's orchestration half.** | new file, BattleScene.js, AreaTargetingController.js | J1, J2; the same injected failure per stage gives the same outcome for P1 and P2; checkpoint index +1 for a no-level-up attack (planted: skip stage 5). | M |
| **E** | P3–P6, P9 (and Escape, O10) onto the coordinator with unit-scoped rollback; `settleAndPresent` deleted. | BattleActionSettlement.js, Heal/Ability/MovementAction controllers | `ActionBoundaryPresentation` green; a throw planted after `settleStaffHeal` before XP leaves HP, use, cursor at pre-action values and the menu open (today: HP applied, use spent, action consumed). | M |
| **F** | P7, P8 onto the coordinator; stage flags → `ctx.stage`; D12 rolled back. | Reclass/PromotionController | `ClassChangePresentationSafety` green; planted throw inside `reclassUnit` → class unchanged, seal intact. | S–M |
| **G** | E1, E2, E5, E6, T1 with enemy ctx; action-level recovery (O1). | BattleScene.js | J4; D3 regression: banner throw → enemy acted, checkpoint written, next enemy acts, phase ends normally. | M (AI loop semantics) |
| **H** | Harness switch: HeadlessBattle and JourneyBattleDriver call `runBattleAction` with `presenter: null`; delete `_executeCombat`, `executeAreaStrike`, `_executeHeal`, `_executeTalk`, `_executeEnemyCombat`, the inline status staff, `_removeUnit`'s reward copy. | tests/harness | J6 parity; `HarnessPhaseParity`, fuzz, `sim:fullrun:pr` unchanged; a planted `CombatOutcome` mutation is caught by the harness suite (today its own copy hides it). | M (headless drive must stay synchronous when `presenter === null`) |

Order: A → A2 → B → C → D → (E ∥ F) → G → H. PR 8 is superseded by B + C + D; record it in the response doc. PR 7 is independent.

## 6. Test strategy

Layers: unit with real modules (engine functions, coordinator with a fake host); **JourneyBattleScene** (real `BattleScene`, `RunDriver` + `JourneyStorage`, real `TurnManager`, `PresentationFailureProxy`); e2e (`contracts` lane). Every journey asserts hand-derived facts and compares a `semanticSnapshot()` across worlds: HP, positions, conditions, inventory identity and uses, XP/level/stats/skills, roster membership, gold and `goldEarned`, deeds, tombstones, `hasActed/hasMoved`, `battleState`, phase/turn, `pendingActionCompletion`, `pendingCommittedAction`, fog sets, RNG cursor (fixed-v1), durable run JSON minus `savedAt`.

| J | Journey | Asserts | Layer |
| --- | --- | --- | --- |
| J1 | Stormcall on the last Breachbolt shot kills two, a Deathburst finishes a third, swap to the next tome, level-up; stage-5 capture fails → Keep playing → `retryCheckpoint` → reload from stored JSON | 8 HP, `_usesSpent` 3, three attributed removals, bounty once, swap after deaths, one card, `combat` continuation, cursor equal across worlds, resumed state equals live | JourneyBattleScene |
| J2 | Attack whose counter (or splash chain) kills the commander | `fatal_pending` persisted before XP/cards; no completion checkpoint; resume shows the prompt; rewind restores the pre-action snapshot and cursor | JourneyBattleScene |
| J3 | HealAll with one full target, level-up, failing storage, shutdown + `init` mid-card | two heals, one use, one XP grant, `finish` continuation durable before FX, old continuation parked, new session clean | JourneyBattleScene |
| J4 | Enemy phase: enemy Cleave kills a unit and spends its last shot (swap), status staff miss, Entity splash; presentation throw on enemy 2; reload after enemy 2's checkpoint | enemies 3..n act (O1), per-enemy checkpoints, resumed replay equals live, survivor XP once | JourneyBattleScene + real AIController |
| J5 | Reclass: throwing sprite rebuild; then a throw inside `reclassUnit` | class changed, seal once, checkpoint before presentation, finished once; then nothing changed, seal intact, menu back | unit |
| J6 | Same seed and script (attack, Stormcall, heal, Talk, End Turn, enemy phase) on HeadlessBattle and JourneyBattleScene | identical snapshot and cursor | harness |
| e2e | Fire Stormcall, reload mid-blast; Resume replays to the same board | browser | `contracts` lane |

Fault-injection extension (`PresentationFailureProxy`): stage-indexed injection — `{ stage: 'present', call: n }` (today's nth call), `{ stage: 'resolve', after: 'xp' }` (domain throw via a host hook), `{ stage: 'capture', index: k }` (k-th write fails), `{ stage: 'await', n }` (shutdown + `init` at the n-th awaited boundary). Required: presentation worlds equal; domain-throw worlds equal the rollback expectation (P3–P8) or the forward-invariant expectation (P1/P2/E1); capture-failure worlds equal after retry; await-shutdown worlds leave the new session untouched. Every injected site is counted, so a new unguarded call fails the zero-telemetry baseline.

## 7. Open decisions

| O | Decision | Recommendation |
| --- | --- | --- |
| O1 | After a cosmetic failure in one enemy's action: remaining enemies act (coordinator) or the phase ends early (today, D3)? | Action-level recovery, phase backstop kept. Today's behaviour rewards the player for a renderer bug and skips checkpoints. |
| O2 | Capture a resolved-action checkpoint for every attack/strike (one extra `toJSON` + write) or only with level-ups? | Always, `preserveRng: true`; measure on a phone in PR D; unifies D6. |
| O3 | Unit-scoped in-place rollback for P3–P8, or forward recovery everywhere? | Rollback for P3–P8 only; never for combat/area/enemy. |
| O4 | Death presentation after full settlement (chain numbers and fades after the chain's damage is final)? | Accept; beat order preserved. |
| O5 | Strike animation reads recorded rows only (display-HP projection)? | Proceed (PR C). |
| O6 | Harness keeps Canto disabled under the shared pipeline? | Yes; Canto stays covered by JourneyBattleScene/e2e. |
| O7 | `opId` in the checkpoint? | No; telemetry context only. |
| O8 | Formally supersede PR 8? | Yes (B + C + D). |
| O9 | Enforcement by vitest AST test or ESLint rule? | AST test (existing pattern). |
| O10 | P9–P12, Seize, Escape onto the coordinator? | Wait/Break/Smash/Capture/Escape in PR E (fixes D10); Seize (victory) and Trade (not an action) stay. |

## 8. Review notes (2026-10-02)

Reviewed against `942973ce`; D1–D4 reproduced independently, D7 confirmed by reading (`grid.clearHighlights()` / `clearAttackHighlights()` in the `executeCombat` catch are unguarded).

1. **PR A = fix brief item 1.** `stability-round6-fix-brief-2026-10-02.md` item 1 now carries D1, D2, D7 and D8. Ship it first, independently of the rest of this note.
2. **O3 (rollback): ship forward recovery first.** In-place restore must keep object identity: `unit.weapon` must stay the same object as its inventory entry (`restoreEquippedReference` exists for this), and TurnManager and `selectedUnit` hold live references. Take this path:
   - Land PR E with the forward invariants only.
   - Add unit-scoped rollback in a follow-up only if `battle_action_domain_error` telemetry shows real throws.
   - Exception: D12 (reclass partial throw). Fix it in PR F by making `reclassUnit` compute first, then assign in one throw-free block (round-2 plan). It does not need generic rollback.
3. **Synchronous core for the harness.** `runBattleAction` is async, but PR H needs a synchronous drive. Split it in two:
   - a synchronous `settleBattleAction(host, ctx, action)` covering stages 0–5;
   - the async wrapper covering stages 6–8 and R.

   The harness calls only the synchronous core and then completes the action synchronously. Decide this in PR D, not PR H, so the API does not change twice.
4. **O2 (capture per attack).** Measure the write cost on a phone in PR D before making it unconditional. The baseline is about 2× serialization per checkpoint since #173.
5. **O1:** agree. One enemy's cosmetic failure should not end the enemy phase.

## 9. Owner decisions (2026-10-02)

- **O1:** action-level enemy recovery, with the phase-level backstop kept.
- **O2:** always capture a resolved-action checkpoint, measured on a phone in PR D first.
- **O3:** defer unit-scoped rollback. Ship forward recovery and revisit on telemetry. D12 is fixed by compute-then-assign in PR F.
- **O4:** accept. Deathburst chain presentation plays after the chain has settled.
- **O8:** PR 8 is superseded by B + C + D.
- **O5, O6, O7, O9, O10:** as recommended in §7.
