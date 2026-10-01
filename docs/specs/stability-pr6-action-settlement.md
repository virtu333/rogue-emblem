# PR 6 design note: settle remaining actions before presentation, and save-retry UI (2026-10-01)

Part of the stability effort. Read with:
- `docs/specs/stability-review-response-2026-09-30.md` (WS4, guarantees, checkpoint rules)
- `docs/specs/stability-round2-remediation-2026-10-01.md`
- `docs/specs/stability-pr5-combat-boundary.md` (matrix infrastructure)

**Line references.** All `file:line` refer to `test/stability-stack-verification` at `c56d0ef7`, a faithful merge of main `c5f0c603` with the #168, #167, #171, #173, #172 and #175 heads. The line numbers will shift once the round-3 fixes land.

**Base.** PR 6 stacks on #175 (`fix/stability-combat-boundaries`). It reuses `tests/harness/PresentationFailureProxy.js` and the combat matrix.


**Implementation baseline and verification (2026-10-01).** This note was reviewed from the user-pushed `claude/serene-noether-oyjjec` file. Historical line references below describe the reviewed integration tree; implementation starts from PR #175 head `8d0eef99`, with the round-three fixes and #168 phase resolutions integrated before release. PR #168 is merged; #174 remains open because its merge requires approval. The old combined-stack test totals are local results, not CI results for the combined branch. Every individual published PR head had green CI before round-three changes. Mutation counts are execution reports; retain the actual mutation, failing assertion, and restored check in the verification record. Same-build fixed-v1 and legacy suspend/resume are tested separately; no cross-build parity claim is made without a version migration test.

The shared action wrapper validates before charging, changes the resolving state synchronously to refuse re-entry, applies every target and cost, captures once with `preserveRng`, then presents. Gameplay exceptions preserve existing exactly-once partial-settlement recovery and are reported; transactional rollback is PR 8. Presentation failures are reported and cannot change costs or prevent other targets settling.

## Summary

| Sub-PR | Scope | Size | Order |
| --- | --- | --- | --- |
| 6a | Staff heal / cure / HealAll / relocation, consumables, XP reuse. Introduces the shared wrapper (`src/ui/BattleActionSettlement.js`), the `preserveRng` capture option and the proxy extensions. | M | 1st |
| 6b | Blink, Shove/Pull/Swap, Rally / Healing Circle / Ensnare, Dance, Talk, Ballista reorder | M | 2nd |
| 6c | Save-retry dialog, "Not saved" indicator, retry fixes in `BattleSuspendController`, gates for the enemy phase and committed attacks | M | 3rd |

**Scope corrections found while writing this:**
- **Ballista** is a turn-start process, not a unit action. Only `damageUnit` moves, to before the awaited shot.
- **`awardScaledXP`** already settles before drawing text. 6a moves the call and separates its guarded text from synchronous XP settlement.
- **Promote/Reclass** already follow the pattern, and are the template.
- **Battle consumables** are only heal, healFull, cure and cureHeal.

**New defects found** (fix in the sub-PR named):
- **6b:** a double tap on Shove/Pull/Swap runs the action twice, because the state doesn't change until the tween's `onComplete`.
- **6a:** `grid.clearAttackHighlights` sits outside `executeHeal`'s `try`. A throw there rejects the promise and leaves the battle stuck in `HEAL_RESOLVING`.
- **6a:** `_pendingCureTarget` is never reset in `init`, so a stale target can be cured in the next battle.
- **6a:** a stat booster used in battle would be burned with no effect. Prevalidation now refuses it.
- **6a:** `presentQueuedLevelUps`' promise is never awaited by the staff paths (HealController.js:502). `await executeHeal(...)` returns while the battle is still `COMBAT_RESOLVING`.
- **6c:** `_checkpointPersistenceResult` is not reset in `init`.
- **6c:** a newer capture drops the older failed candidate even when it throws before installing its own checkpoint (G1).
- **6c:** `retryCheckpoint` lacks the battle-end, fatal and defeat guards (G3).

**Hand-off between 6a/6b and 6c:**
- **What 6a/6b do:** settle the action, then `captureResolvedAction(..., { session, preserveRng: true })`. Only if that returns `false` with a retryable reason (`quota`, `write_error`), await `scene._saveRetryGate?.(session)` before any presentation, outside any `finally`.
- **The gate:** it returns `null` when nothing is pending (including `no_battle`/`missing_slot`), so the normal path adds no microtask. Until 6c lands, `_saveRetryGate` is undefined and the call is a no-op.
- **Retries:** they never re-run settlement. A retry re-persists the frozen candidate through `saveRun`, so no cost or effect is applied twice.

**Accepted decisions:**
1. **Talk settles the recruit before the card and dialogue.** Today a failed dialogue spends the lord's action with no recruit. `BattleSceneActionErrorRecovery.test.js:94` changes meaning.
2. **A refresh or crash while a save is unpersisted returns to the last durable checkpoint.** This is a bounded exception to the anti-refresh guarantee: it applies only when storage refuses writes. Note it in the CLAUDE.md Persistence bullet.
3. **No "Free space" button.** Automatic shedding already runs on every attempt, and everything left in storage is player data.
4. **Legacy-v1 battles only:** the heal/cure/Dance canvas text now draws after the growth rolls instead of before. A legacy level-up from those actions rolls different stats than today's build at the same cursor. This is acceptable under the one-build live-vs-resume promise. Fixed-v1 is unaffected: its cursor equality is argued per action, and a probe confirmed it for `executeHeal`.

**Shared lessons applied throughout:**
- Drive real entry points.
- Every new guard ships with a test that fails when it is removed.
- Give matrix cases explicit `{ timeout: 20_000 }`.
- Capture the session at operation entry and pass it explicitly.
- `init` resets any state an async operation sets and its `finally` clears.
- Run battle end right after required removals.

# Part 1: 6a/6b, staff, item, ability, movement, Talk and Ballista settlement

## Scope corrections against the current tree

- **Ballista is not a unit action.** `processBallistaFire` (BattleScene.js:9917) runs from the player turn-start pipeline (:9665) and the enemy phase (:9813). `resolveBallistaStrike` (:9928; one `rollHit` call (two symmetric-2RN draws), BallistaEngine.js:103) runs first, the bolt is awaited (:9930–9938), then `damageUnit` (:9941). The reorder is real and small; it has no continuation and no `finishUnitAction`. `_captureBallista` (:6652) is already synchronous and settles before `finishUnitAction`: nothing to do.
- **`awardScaledXP` is settle-before-text** (BattleScene.js:9119: `applyXpGain` :9141, popups queued :9158–9163, the only drawing inside `safeBattlePresentation` :9165). It has no internal await; `async` only makes callers yield a microtask. PR 6 reuses the XP rules and moves the call. `awardScaledXP` becomes synchronous and accepts `{ present: false }`; `_presentScaledXP` draws the recorded XP after capture, so XP text is also behind the persistence boundary.
- **Promote/Reclass are out**: PromotionController.js:245 and ReclassController.js:61 already settle, `captureResolvedAction`, then present. They are the pattern to copy. `useConsumable` delegates `promote` (:7443) and `reclass` (:7448) before anything else.
- **Consumable effects reachable in battle** (data/consumables.json): `heal` (Vulnerary 10, 3 uses), `healFull` (Elixir), `cure` (Herb, 2 uses), `cureHeal` (Remedy 10). `statBoost` is applied at loot (`applyStatBoost`, UnitManager.js:1877) or on the route map and never enters a battle inventory by any flow found; today `useConsumable` would burn such an item with no effect (no branch :7459–7486, then `uses--` :7490). Prevalidation rejects unsupported effects.
- **No action in the list is missing.** Blink lives in AbilityController (`executeBlink` :281), not HealController.
- A **re-entry defect not in the inputs**: Shove/Pull/Swap never leave `SELECTING_*_TARGET` until the tween completes (:5423–5444, :5447–5483, :5737–5779), so a second tap within the 80–120 ms tween runs the action twice (two moves, two `finishUnitAction`). HealAll, relocation, Blink, abilities, consumables, Dance and Talk also lack the `HEAL_RESOLVING` early-return that `executeHeal` has (:434); their state write is synchronous, so only programmatic re-entry reaches them.
- `_pendingCureTarget` (:6934, :6961, read :7472) is never reset in `init` (:446–540): a stale target from a previous session can be cured by the next battle's first Herb. Reset it with `_pendingCureItem/_pendingCureUser`.

## Evidence (scratch probe, journey fixture + PresentationFailureProxy, `executeHeal`, Heal staff MAG 6 on a 5/20 target, healer at 95 XP, fixed-v1 seed 7)

| world | target HP | staff `_usesSpent` | healer xp/level | action | reported |
| --- | --- | --- | --- | --- | --- |
| shown | 16 | 1 | 15 / 6 (8 draws: one per stat, UnitManager.js:1020) | finished, popups queued | — |
| skipped (`_live` false) | 16 | 1 | 15 / 6, same cursor | finished | — |
| no sprite (`target.graphic` undefined → `setTint` throws, HealController.js:613) | **16** | **undefined** | **95 / 5** | consumed via recovery | `console.error` only |
| `_combatFx.playHeal` throws (:616) | **16** | **undefined** | **95 / 5** | consumed | `console.error` only |
| `grid.clearAttackHighlights` throws (:436, outside the `try`) | — | — | — | **promise rejects, state stays `HEAL_RESOLVING`** | nothing |

Presentation draws nothing from the battle stream in fixed-v1: every `add.text` goes through `isolateBattleTextFactory` (BattleScene.js:2403; presentationText.js:18), fx are seeded (`healSource` seed, HealController.js:46–53; CombatFxController.js:20), quips hashed. Legacy-v1 draws one UUID per canvas text.

## Inventory

Entry points: action menu `staff` (:6418–6430 → `showStaffPicker` or `startHealTargetSelection`), `item` (:6512 → `showItemMenu` :7253 → `useConsumable` :7438 or `_startCureTargetSelection` :6938), `ability` (:6530 → AbilityController picker → `executeBlink`/`executeSelfCentered`), `shove`/`pull`/`swap`/`dance` (:6515–6526 → `start*TargetSelection` → InputController.js:464–476 click handlers → `execute*`), `talk` (:6541 → `executeTalk` :6830). Every `execute*` is reachable from tests as a real entry (the matrix drives them, not inner helpers).

| action | order today (M = mutation, P = presentation, A = await) | defect at the await |
| --- | --- | --- |
| **Heal** (HealController.js:429) | P clear highlights :436 (outside `try`) · M `resolveHeal`+`setUnitHP` :467–471 · M deeds :472 · M history :473 · P bar :476 · M legendary self-heal :477 (healUnit, `_legendaryGraceTurn`) · P/A `animateHeal` :488/:490 (`setTint` :613, `playHeal` :616, `add.text` :621, two delays :639/:642) · M `spendStaffUse` :494 · M `restoreCombatWeapon` :495 · M XP :498 (growth draws) · `finishUnitAction` in `finally` :502 | throw/skip in the animation: HP and deed applied, no use spent, staff stays provisionally equipped (counter-weapon not restored until recovery's finish; `restoreCombatWeapon` is never called), no XP; shutdown mid-delay: same in memory |
| **Cure** (:441) | M `clearAllConditions` :444 · M history :445 · P icons :446, undim :449 · P/A `animateCure` :450 · M spend :453 · restore :454 · XP :457 · finish :461 | same shape |
| **HealAll / Fortify** (:510, no re-entry guard) | per target: M heal/deed/history :523–529, P bar, M legendary :531, P/A animate :540/:542 (session check returns) · M spend :547 · restore :548 · XP :551 · finish :555 | stops after the first target that throws; later targets unhealed, use unspent |
| **Relocation** (:351) | P/A `animateRelocate` :365 (fade-out :411 → **M col/row :417** → P position :419 → fade-in :421) · M history :367 · P danger :371 · M spend :374 · restore :375 · XP :378 · finish :382 | a failed fade-out leaves the ally in place and charges nothing; a failed fade-in moves it and charges nothing; a shutdown between fades moves it in memory only |
| **Blink** (AbilityController.js:281) | M state :289, vision commit :290 · **M `markUsed` :292** · A fade-out :302 · M history :308 · M col/row :309 · P :311 · A fade-in :313 · P danger :321 · finish :322 | fade-out failure: use spent, no move; the player loses the one-per-map ability |
| **Rally / Healing Circle / Ensnare** (:418) | M `markUsed` :429 · Rally: P `playBuff` per ally :459–462, history :463, `allyBuff` generator :466 driven by `_playPostCombatBeats` (BattleScene.js:8744; buffs applied one ally per yielded hint beat) · Circle: per ally M `healUnit` :488, deeds :490, history :491, P bar :492, P `playHeal` :494, P `showMinorHintAt` :495 (`add.text`, BattleScene.js:10111) · Ensnare: per enemy M `applyCondition` :510, history :516, P icon :518 (`_addConditionIcon` also refreshes danger, :10645), `playStatus` :519, hint :520 · M danger stale :523 · finish :442 | Circle/Ensnare: a throw on target 1's FX leaves targets 2..n untouched, the use spent; Rally: per-ally guarded, but a stale session mid-loop leaves later allies unbuffed |
| **Shove** (BattleScene.js:5423) | M vision commit :5425 · P tween :5433 · **inside `onComplete`** :5439: history, col/row, position, finish | `tweens.killAll` on shutdown (:628) or a tween failure: no move, no finish, state stays `SELECTING_SHOVE_TARGET` |
| **Pull** (:5447) / **Swap** (:5737) | same, two tweens; Swap re-dims an acted ally :5778 | same |
| **Dance** (:5791) | P `playBuff` :5799, `add.circle` :5801, tween/delay · M history :5815, deeds :5816, refresh flags :5818–5820 · P undim · M XP :5825 (inside `try`) · finish :5829 | the three `add`/`tweens` calls sit **before** the `try`: a throw rejects the promise, nothing refreshed, state unchanged |
| **Talk** (:6830) | M state :6837 · M `pickNarrativeLine` :6845 (hashed, `narrativeSeen` only) · A recruit card :6853 / dialogue :6856 · M npc→player :6860–6864, history :6865 · P graphics :6868–6869 · M blessing consumables :6872, push :6873, flags :6876, uid :6880, `_battleRecruits` :6881 · finish :6883 | a throw in the card/dialogue consumes the lord's action with **no recruit** (BattleSceneActionErrorRecovery.test.js:94 pins this) |
| **Consumables** (:7438) | M state :7455, vision commit · M `healUnit`/`healUnitFully`/`clearAllConditions` :7460–7475 · P bar/icons/undim · A `showBriefBanner` :7462/:7466/:7479/:7484 · M history :7488 · **M `uses--`, removal :7490–7491** · finish :7493 | banner failure: effect applied, item not charged (free Elixir) |
| **Ballista** (:9917) | M roll :9928 · A shot :9930 · `isCurrent` :9939 · M `damageUnit` :9941 · P number · M `removeUnit` :9977, sweep :9980, `checkBattleEnd` :9982 | shot failure is guarded; a stale `isCurrent` after the shot drops the damage although the hit was rolled (resume replays from the turn-start checkpoint, so only memory diverges) |

Checkpoints today: none of these capture before `finishUnitAction` (:5179). With queued level-ups it captures a `finish` continuation inside `presentQueuedLevelUps` (BattlePresentationCheckpoint.js:79) and returns a **promise the callers never await** (HealController.js:502; the probe read `COMBAT_RESOLVING` after `await executeHeal`); without, `completeBattleAction` (BattleActionCompletion.js:46) captures and returns `saved`.

## The design

### Settlement functions (pure, `src/engine/`)

Each takes validated inputs, mutates synchronously, draws nothing, and returns the recorded facts presentation reads. These are synchronous domain commands, not referentially pure functions. Each has a `validate*` twin that returns `null` (nothing touched) when the input is stale.

```js
// engine/StaffSettlement.js
settleStaffHeal({ staff, healer, targets, healOpts, traits, turn, phase })
  // targets: [unit]; for every target in order: resolveHeal → setUnitHP, then
  // applyLegendaryStaffHeal (TraitSystem.js:522; at most once per turn) — same per-target
  // order as :523–539; then spendStaffUse once (Combat.js:528).
  → { kind: 'heal', staff, targets: [{ unit, hpBefore, hpAfter, healAmount }], selfHeal: [{ turnIndex, amount }], usesSpent }
settleStaffCure({ staff, healer, target })        → { kind: 'cure', target, cleared: [...conditions] }
settleStaffRelocation({ staff, ally, dest })       → { kind: 'relocate', moves: [{ unit, from, to }], usesSpent: 1 }
validateStaffAction(scene-free world: { staff, healer, target(s)/dest, usable, wouldMend, destinations }) → null | ok

// engine/ConsumableSettlement.js
validateConsumable(unit, item, target)  // item ∈ unit.consumables, uses > 0, effect ∈ {heal, healFull, cure, cureHeal},
                                        // heal/healFull: target not full, !isWounded (StatusConditionSystem.js:60) — the menu rule :7300–7303
settleConsumable(unit, item, target)    → { effect, target, hpBefore, hpAfter, healed, cleared, usesLeft, removed }  // healUnit/healUnitFully/clearAllConditions, then uses--, removeFromConsumables (UnitManager.js:1712)

// engine/ActionMovement.js
settleMoves([{ unit, to }])             → [{ unit, from, to }]   // Shove, Pull, Swap, Blink, relocation; the only writer of col/row

// engine/ActionAbilitySystem.js (beside markUsed :67 / collectAffected :109)
settleBlink(unit, skill, tile)          → { moves, usage }           // markUsed + settleMoves together
settleHealingCircle(unit, ability, pool)→ [{ unit, hpBefore, hpAfter, healed }]   // all targets, then nothing
settleEnsnare(unit, ability, pool)      → [{ unit, rooted: bool }]   // applyCondition per target (:510 semantics)
settleRally(step, unit, world)          → beats = [...allyBuff(step, unit, world)]   // drain the generator: every buff lands, hint beats returned (PostCombatEffects.js:378–423 yields hints only)

// engine/BattleRecruits.js (beside recordBattleRecruit :85)
settleRecruitJoin({ npc, lord, npcUnits, playerUnits, battleRecruits, runManager })
  → { npc, battleRecruits }   // splice/push, faction, flags, grantRecruitBlessingConsumables, assignUnitUid, recordBattleRecruit (:6860–6881 minus graphics)
```

Dance settles inline in the scene (three flag writes + `deedsFor().onRefresh`, :5816–5820); no engine function is worth it.

### Scene wrapper order (every action; one shared helper `settleAndPresent` in `src/ui/BattleActionSettlement.js`)

1. `session = battleSession(scene)`; refuse if `RESOLVING_STATES` (`HEAL_RESOLVING`, `COMBAT_RESOLVING`, `CANTO_MOVING`, `BATTLE_END`) already holds; set `battleState` synchronously (**this closes the Shove/Pull/Swap double-tap and is the HealAll re-entry guard**; `init` already resets state, so nothing new to clear). `commitVisionSnapshotIfPending()`.
2. **Validate** with the same finders the menu used (`findHealTargets`/`wouldMend` :118/:157, `getRelocationDestinations` StaffRelocation.js:73, `getBlinkTiles`, `canUseAbility`, `find{Shove,Pull,Swap,Dance}Targets`, `findTalkTarget`, `validateConsumable`). Invalid → restore the combat weapon (`restoreCombatWeapon` :79, staff flows only), `showActionMenu(unit)`, return `false`. Nothing charged.
3. **Settle** in one synchronous block inside a `try`: history observations at their current relative points (Shove/Pull/Swap/Blink observe *before* the move as :5439/:5474/:5768/:308 do; relocation after, :367; Talk 'recruited' after the join, :6865), the engine settlement, `restoreCombatWeapon` (staff), `deedsFor()`, then `awardScaledXP` (heal, cure, HealAll, relocation, Dance; it queues popups, draws growths, and its text is already guarded). Talk's `removeUnitGraphic`/`addUnitGraphic` (:6868) are presentation; `registerBattleEntity` is idempotent for an NPC that already has its id (BattleEntityIdentity.js:15–28), so identity is not at stake.
4. **Capture**: `captureResolvedAction(scene, { kind: 'finish', unitName, unitId, skipCanto: false }, { session, preserveRng: true })`. Extend `captureResolvedAction` (BattlePresentationCheckpoint.js:65) to forward `preserveRng` to `_captureSuspendCheckpoint` (:9241) → `captureCheckpoint` (BattleSuspendController.js:68). With `preserveRng`, a legacy battle is **not reseeded** at this new checkpoint (:92–96) while `rngState` is still saved (BattleCheckpointAdapter.js:16) and restored exactly (BattleSuspendController.js:293). This honours "no new checkpoints that reseed legacy battles"; the completion checkpoint keeps reseeding as today. Fixed-v1 is unaffected either way. If it returned `false` and `scene._checkpointPersistenceResult.reason` is retryable, `const g = scene._saveRetryGate?.(session); if (g) { await g; if (!isCurrentBattleSession(scene, session)) return; }` (6c's gate, null when not blocking: no microtask on the normal path).
5. **Present recorded facts**, each under `safeBattlePresentation` with `isCurrentBattleSession` after every await: `presentMoves(moves)` (fade-out → `updateUnitPosition` → fade-in, never writing col/row; relocation and Blink keep `originalAlpha`, #170; Shove/Pull/Swap keep their position tweens via `_awaitSceneTween` with the `onComplete` emptied), `animateHeal(target, healAmount, healer)` per target from the facts (no live HP read: `hpAfter` is already set, so the bar reads right either way), `animateCure`, condition icons, `playBuff`/`playHeal`/`playStatus`, hints, the Dance sparkle, `showBriefBanner`, Talk's card/dialogue then `removeUnitGraphic`+`addUnitGraphic`+`updateObjectiveText`, `_refreshPostCombatMovementState(moved, { revealFog: false })` (Blink :321 and now every move: fog lifts at completion, FogRevealOnCommit stays true).
6. `await presentQueuedLevelUps(scene, null, { session })` (no second capture), then `finishUnitAction(unit, { session })` **once**, outside any `finally`. The queue is empty by then, so `finishUnitAction` goes straight to Canto/`completeBattleAction`. The wrapper awaits everything it starts: `await scene.executeHeal(...)` resolves after completion (today it does not).
7. `catch`: the `try` spans steps 3–6. Domain-failure policy below.

Per-action specifics: HealAll presents each target's heal in order from the facts; a failure on target 2 no longer stops anything because nothing remains to settle. Rally presents the drained hint beats through `_playPostCombatBeats` (unchanged helper). Ballista: move `damageUnit` to immediately after `resolveBallistaStrike` (:9928), keep the shot under its guard, keep `removeUnit`/sweep/`checkBattleEnd` after the guarded number; the `isCurrent` early-return then drops only presentation.

**Talk policy: settle the recruit before the card.** Pressing Talk is the decision; the card (`showRecruit`, GrowthCeremonyController.js:472) and the dialogue (`DialogueOverlay.show` :48) are skippable ceremonies, not choices (`bindCeremonySkip`; the overlay auto-dismisses, resolves on shutdown via `destroy` :37–38 and returns at once when destroyed :97). The worst outcome today — action spent, no recruit — comes precisely from treating the line as a gate. The player still sees the line before the sprite recolours, because the graphic rebuild stays after the dialogue. BattleSceneActionErrorRecovery.test.js:94 changes meaning: a throwing overlay now leaves `npc` in `playerUnits` and finishes with `skipCanto: false`.

### Domain-failure policy

- Prevalidation failure (step 2): state untouched, weapon restored, menu returns; no telemetry (it is a stale UI pick).
- A throw inside step 3 (settlement is validated pure code; a throw is a bug): `reportAsyncError('battle_action_domain_error', err, { label, battleState, phase, turn })`, then the existing `_recoverUnitActionError(unit, label, err, { session })` (:5243): finishes once with `skipCanto: true` and leaves whatever settled; `completeBattleAction` captures that state. No replay exists for these actions (no committed intent), so nothing is charged twice, and `battleState` is never left in a resolving state. Making step 3 transactional is PR 8.
- A throw inside steps 4–6 after settlement: same recovery; the action is already settled, the recovery only completes it.
- Presentation failure: reported by `safeBattlePresentation`, play continues.

### Interface exposed to 6c (no UI here)

After step 3 the action is settled in memory and its `finish` continuation is in `scene._pendingActionCompletion` and in the live checkpoint (`rm.battleInProgress.checkpoint`, latest wins, BattleSuspendController.js:100). `captureResolvedAction` returns `true` (persisted), `false` (stale session or persistence failed; read `scene._checkpointPersistenceResult = { ok, reason, cloud? }`) or `undefined` (fatal/defeat decision pending; never during a player action). `completeBattleAction` returns `saved === true` when a run battle exists, else `true`; it also surfaces through `_checkpointPersistenceResult`. Reasons: `quota`, `write_error` are the retryable ones and the only ones 6c keeps a candidate for; `no_battle`, `missing_slot` are the in-memory completion path (tutorial/QA); `cloud.reason === 'protected_slot'` with `ok: true` is informational. 6a/6b never touch `_retryCandidate`; a retry (`retryCheckpoint({ session })`, explicit session per 6c G3) re-persists the frozen candidate and never re-runs settlement, so no cost or effect is applied twice. Agreement with 6c (Part 2): the gate is awaited only after a failed capture and only in step 4, never inside a `finally` (6c's parking risk); `init` resets `_checkpointPersistenceResult` there. One request to 6c: `_saveRetryGate` must return `null` for `no_battle`/`missing_slot` so tutorial heals add no microtask.

## RNG (fixed-v1 cursor equality, proven per action)

Draws in these flows: growth rolls in `applyXpGain` (8 per level gained, `levelUp` UnitManager.js:1020) for heal/cure/HealAll/relocation/Dance; one symmetric-2RN `rollHit` call (two draws) per ballista shot; one conditional item-UID draw when Talk grants a blessing consumable without a UID. Nothing else draws: `applyCondition(..., { recoveryChance: 0 })`, `clearAllConditions`, deeds (DeedSystem.js:9), history (BattleHistoryRecorder.js:15–16), `pickFresh` (hashed, pickFresh.js:17–19), identity (BattleEntityIdentity.js:15), `applyLegendaryStaffHeal`, `allyBuff`, `settleMoves`; presentation never does in fixed-v1 (probe: shown = skipped cursor). Heal/cure/HealAll/relocation/Dance move the growth draws *earlier* relative to presentation that draws nothing, so the cursor after the action is identical and the per-stat results are identical. Blink, Rally, Circle, Ensnare, Shove/Pull/Swap and consumables: zero draws before and after. Talk retains one conditional item-UID draw when recruitment grants a blessing consumable without a UID; otherwise it draws nothing. Ballista: both draws stay before the shot. No saved intent replays any of these actions, so no version gate is needed. **Legacy-v1**: canvas text draws (heal `+n`, `Cured!`, hints, banners) now follow the growth draws instead of preceding them; growth results for a legacy heal level-up therefore differ from today's build at the same cursor. Legacy promises only live-vs-resume equality on one build (PR 5 Guarantee 1 wording), and the mid-action capture preserves the stream, so this is acceptable without a gate.

## Test plan

**Infrastructure** (extend `tests/harness/PresentationFailureProxy.js`): remove `animateHeal` from the stub list (:111) so HealController's real `animateHeal`/`animateCure` run; add counted `_combatFx.playHeal`, `playBuff`, `ballistaShot`; counted `scene.add.circle`; `_awaitSceneTween` resolving `{ status: 'finished' }` after calling `config.onComplete` when the world is not "timed out"; `dialogueOverlay.show` and `_getCeremonies().showNotice` as counted surfaces (no DOM host in vitest → canvas/overlay fallback paths); `_addConditionIcon`/`_removeAllConditionIcons`/`addUnitGraphic`/`removeUnitGraphic` counted with `addUnitGraphic` still calling `registerBattleEntity`; `grid.showHealRange/showAttackRange` counted. Units get `graphic = calls.visual` except in the `no sprites` world. `scene.registry.get('audio')` stays null. Fixture as CombatBoundaryPresentation.test.js:348–560 (real `TurnManager`, `checkBattleEnd`, `RunDriver` + `JourneyStorage`), one file `tests/ActionBoundaryPresentation.test.js` with `it(..., { timeout: 20_000 })` per matrix case (the combat cases ran 2.5–2.9 s under the 5 s default).

**Worlds per scenario**: shown (asserts `calls > 0`, zero `reportAsyncError`, and the labels contain the action's own FX label as the tripwire), skipped, paused (`scene.isActive` false), no sprites, `'all'`, every nth call, one tween timeout (`timeoutMs` on the move fade), shutdown + immediate `init` mid-presentation (restart helper, BattleSessionOwnership.test.js:43), and storage failure (`storage.failWrites`) with `retryCheckpoint({ session })` re-persisting without re-settling. Compare `model()` of units, `_pendingActionCompletion`, popups, `visibleSet`, `narrativeSeen`, `_battleRecruits`, gold, `battleState`, RNG cursor, the checkpoint and the durable save.

**Scenarios with hand-derived expectations** (MAG 6 healer, Heal staff: 6 + 5 = 11 ≤ missing → target 5 → 16; XP 20 at par ×1): heal (16, `_usesSpent` 1, xp +20); heal with level-up (95 → 15/level 6, 8 draws, one popup, continuation captured before any FX); Mend on a 2-missing target (heal 2, never past max); cure with Restore (conditions `[]`, HP untouched, use 1); Fortify on three targets with the third at full (two healed, one use, one XP; failure on target 2's FX); legendary self-heal trait (healer +amount once, `_legendaryGraceTurn` = turn); staff depletion (`restoreCombatWeapon` equips the prior tome; `run-recovery.spec.js:126` keeps its identity assertion); Rescue/Warp (ally at `dest`, caster finished, ally `hasActed` unchanged, fog unchanged until completion); Blink (unit at tile, `_battleAbilityUsage.map.blink` 1, usage and move both present in the failed-fade world); Rally (two allies each one `_battleTimedWeaponArtBuffs` entry STR+2/SPD+2, expiry per `resolveTimedBuffExpiry`); Healing Circle (15 each, self included, full-HP ally skipped); Ensnare (root with `turnsRemaining` 2, immune enemy untouched); Shove/Pull/Swap (positions swapped exactly; double tap during the "tween" runs once; Swap re-dims only an acted ally); Dance (target flags false, dancer xp +20, draws 0); Talk (npc in `playerUnits`, `_battleRecruits[0].unit.faction === 'player'`, blessing consumable granted, uid assigned, continuation `finish` for the lord; overlay throws → same); Vulnerary (+10, uses 2), Elixir (full, removed), Herb on an adjacent ally via `_handleCureTargetClick` (conditions cleared, uses 1), Remedy (cleared and +10, removed), stale `_pendingCureTarget` after `init` ignored; stat booster in `consumables` refused with the item intact; Ballista (hit: target −(10−RES), two draws, damage present when the shot throws; miss: HP intact, two draws).

**Planted regressions that must fail**: move `spendStaffUse` back after `animateHeal`; put `col/row` back inside the fade / the tween `onComplete`; `markUsed` before `validate`/outside the settlement; capture after the first await; drop `preserveRng` (legacy fixture: cursor differs live vs today's reseed); a second `captureResolvedAction` in `presentQueuedLevelUps` (checkpoint index +1); recruit after the dialogue; `uses--` after the banner; `damageUnit` after the shot; re-add the `HEAL_RESOLVING` leak by removing the synchronous state write (double-tap test); remove `_pendingCureTarget` from `init`; stop reporting `battle_action_domain_error`.

**Existing tests to migrate**: HealXP.test.js:131/148 and StaffRelocationExecution.test.js:256/278 (XP rejection now lands in the domain branch; assert one finish and the telemetry code), BattleSceneDanceXP.test.js:74, BattleSceneActionErrorRecovery.test.js:94/116/154 (expectations above), BattleAbilities.test.js:351 (same outcome, different order), BattleSceneSwapDimming.test.js (drive the tween through `_awaitSceneTween`), BattleSceneAsyncGuards.test.js:145 (parking still holds).

**HeadlessBattle**: replace `_executeHeal` (tests/harness/HeadlessBattle.js:1884) with `settleStaffHeal` + `_grantScaledXP` + `_finishUnitAction`, which also removes its divergence (it deletes a depleted staff from the inventory, :1897–1902; production keeps it); replace `_executeTalk` (:1927) with `settleRecruitJoin`. Delete both copies; don't keep them beside the engine functions.

## Deferred to PR 8

Transactional settlement (a throw mid-step 3), the full outcome record for combat, `showMinorHintAt`/`add.text` legacy isolation, `_recoverUnitActionError`'s partial-settlement save, the harness's remaining mirrors (combat, village, Canto).

## Risks

- `captureResolvedAction` grows an option; PromotionController/ReclassController keep reseeding legacy at their capture (unchanged, documented).
- `allyBuff` drained before presentation means a dead-ally filter is evaluated once; identical today because nothing dies during Rally.
- Talk's settle-first changes what a mid-dialogue refresh resumes into (recruit joined, lord's action pending) — the intended guarantee, but `fallen-recruit.spec.js` and `run-recovery.spec.js` need a pass.
- The 6c gate inside step 4 must stay outside `try/finally`; a gate that parks under a `finally` that finishes the action would finish it in a dead session.
- `isWounded` prevalidation of heal items is stricter than today's `useConsumable` (the menu already refuses); any direct caller that bypassed the menu now gets the menu back.

## Size and order

**6a** (staff + consumables + XP reuse): `StaffSettlement.js` +90, `ConsumableSettlement.js` +50, `BattleActionSettlement.js` +80, HealController ≈ −120/+110, `useConsumable` ≈ −40/+35, `captureResolvedAction` +3, `init` +1, harness −40; tests ≈ 150 (proxy) + 500 (matrix) + migrations. **M.**
**6b** (movement, abilities, Dance, Talk, Ballista): `ActionMovement.js` +25, `ActionAbilitySystem.js` +60, `BattleRecruits.js` +35, AbilityController ≈ −80/+90, BattleScene Shove/Pull/Swap/Dance/Talk/Ballista ≈ −120/+140; tests ≈ 450 + migrations. **M.**
Land **6a first**: it introduces the shared wrapper, the `preserveRng` capture and the proxy extensions that 6b and 6c build on; 6b second; 6c last (it hooks the capture results both produce).

# Part 2: 6c, save-retry UI and persistence status

All `file:line` references are to `$S/wt6-stack` (c56d0ef7). 6c assumes 6a/6b already settle each action in memory and capture its resolved continuation before presentation. 6c adds no checkpoint, recapture or reseed. The only write it adds is a re-persist of a candidate that was already frozen.

## Current plumbing

- `captureCheckpoint` (BattleSuspendController.js:68–133) runs its guards first (:70–84). It then clears the retry state *before* its `try` (:86–87), reseeds legacy battles (:96), installs the new checkpoint in memory (:100), writes through `_persistBattleRunState` (:112) and falls back to dropping timeline history on quota (:113–126). It keeps a clone of the candidate after **any** failed write, including `missing_slot` and `stale_session` (:127), and returns a boolean through `_captureResult` (:135–140), which also stores `scene._checkpointPersistenceResult`.
- `retryCheckpoint()` (:143–166) checks only the session and that the checkpoint has not been replaced. If the first failure was not a quota error, a retry that then hits quota gets no timeline fallback. It has no production caller; the only callers are in tests.
- `_persistBattleRunState` (BattleScene.js:9217–9238) returns `{ok:false}` with `stale_session`, `missing_run` or `missing_slot`, or the result of `saveRun`. `saveRun` (RunManager.js:5285–5318) returns `quota` or `write_error` (a SecurityError lands here), or `{ok:true, cloud}`. It re-stamps `savedAt` (:5290) and always runs `setItemFreeingSpace` (:5295; SaveSpace.js:53–72 sheds other slots' history in stages 1–3).
- Cloud: `pushRunSave` (CloudSync.js:439–458) returns `protected_slot`, `offline` or `{queued:true}`. `protected_slot` is reported once per account and slot (:442–445) and appears in the Title notice (TitleScene.js:496–499).
- `toJSON` shares `battleInProgress` by reference (RunManager.js:4418), so the frozen candidate has to be a clone.
- `_checkpointPersistenceResult` is **not reset in `init`** (BattleScene.js:446–540). A value from a previous session can outlive a restart.

**Capture sites:**
- **Player actions:** `completeBattleAction` (BattleActionCompletion.js:46), `captureResolvedAction` / `completeResolvedAction` (BattlePresentationCheckpoint.js:70, :152), queued level-ups (:79), the commit intent (BattleScene.js:8496 via :8572), ambush/blocked move (:3642), End Turn (:4522), trade (BattleTradeController.js:108, :129), escape (EscapeObjectiveController.js:134), parked activation (VisionRewindController.js:688).
- **Turn start and enemy phase:** turn start (BattleScene.js:9674, :9685), handoff recovery (:10381), enemy action (:10503).
- **Vision and orientation:** tutorial Vision (:2975; has no `runManager`, so it is n/a), portrait re-open (PortraitBattleController.js:266).
- **Persist-first writes with their own failure UX:** Vision rewind (VisionRewindController.js:1005–1022), fatal decision and defeat (BattleFatalDecision.js:55, :106).
- **Writes outside checkpoints:** battle start (BattleScene.js:1504), Formation (FormationController.js:590), post-battle (PostCombatController.js:232/406/622/658/679/745/934, BossRecruitOverlay.js:54, LordArrivalOverlay.js:505).
- **Save & Exit** writes nothing; it assumes the checkpoint is durable (BattleScene.js:4621–4626).

## Fixes in BattleSuspendController

- **G1, latest wins without early loss.** Delete :85–87. Directly after `rm.setBattleCheckpoint(checkpoint)` (:100), set `_retryCandidate = null; _retryCheckpoint = checkpoint`.
  - **Throw before :100** (reseed, `_buildCheckpoint`, `setBattleCheckpoint`): the live checkpoint is still the older one, and the older candidate still serializes it, so the older candidate remains recovery evidence. It may be retried as current progress only when the live serialized gameplay still matches it; a construction failure after new gameplay must not write the older candidate or clear the unsaved indicator.
  - **After :100**, writing the older candidate is unsafe: retry success assigns `rm.battleInProgress = candidate.battleInProgress` (:159), which would roll memory back. It must therefore be dropped. A `toJSON` throw after :100 stays `checkpoint_replaced` (the existing test at BattleSuspendController.test.js:707 still holds).
- **G2.** Keep a candidate only for `quota` and `write_error`; other reasons get no clone and no prompt.
- **G3.** `retryCheckpoint({ session })` takes the session as a required argument; without one it returns `stale_session` (no default that samples the current session). It returns:
  - `no_battle` when `battleInProgress` is gone;
  - `unstable_boundary` on `BATTLE_END`, `_fatalDecision`, `_fatalCapturePending` or `_defeatDecision`, keeping the candidate (copy the guards from :73–80);
  - `checkpoint_replaced` when the checkpoint identity no longer matches;
  - `no_candidate` when there is nothing to retry.

  Before any write, compare the frozen candidate with live serialized gameplay (ignore save timestamps and optional timeline trimming only). A mismatch returns `checkpoint_replaced`, without changing live state or declaring it saved. This closes the case where domain settlement advanced but checkpoint construction threw.

  On quota it runs `persistWithTimelineFallback` over the frozen candidate (dropping history only) and, on success, adopts `fallback.candidate`. Update the callers that pass no argument: BattleSuspendController.test.js:633/654/666/702/720, BattleSessionOwnership.test.js:595 and CombatBoundaryPresentation.test.js:50.
- **G4.** `captureCheckpoint` gains an option `progress = true` (default). Portrait passes `progress:false, session: battleSession(s)` captured at `_switch` entry. `_captureResult(result, {session, progress})` forwards to `scene._onCheckpointResult(...)`.
- **G5.** Add `hasRetryCandidate()` and `dropRetryCandidate()`.

## When the prompt appears

Classification lives in `engine/SavePersistenceStatus.js` (pure):

| Result | Prompt |
|---|---|
| `quota`, `write_error` with a candidate, `progress:true` | **Blocking dialog** |
| Same, `progress:false` (portrait) | None. Portrait keeps its notice. Only the fixed-v1 RNG state is captured; the durable save equals it. |
| `capture_error` (a bug, no candidate) | No dialog; "Not saved" status + telemetry. If G1 kept an older candidate, the prompt stays. |
| `stale_session`, `missing_slot`, `missing_run`, `no_battle` (tutorial/no-slot), `unstable_boundary`, `wrong_phase`, `missing_persistence` | Never |
| `{ok:true, cloud:{queued:false}}` (`offline`, `protected_slot`, `callback_error`) | Never. Local save is durable. `protected_slot` already reaches the Title notice; `callback_error` → telemetry. No in-battle cloud UI. |

**Superseding writes.** Any successful write of current gameplay through `_persistBattleRunState` in the same session (a capture, a retry, a rewind, a fatal/defeat decision or a post-battle save) writes state built from live memory *after* the failed capture, so it supersedes it. On `ok`, call `_saveRetry?.onDurableWrite({session})`, which calls `dropRetryCandidate()` and moves to `idle`.

## What is blocked

The controller has three states:
- **`idle`**
- **`pending`**: prompting, retrying, failed again
- **`degraded`**: the player chose Keep playing; a "Not saved" pill shows

Only `pending` blocks.

| Flow | `pending` | `degraded` |
|---|---|---|
| Pointer, keys, gamepad, mobile HUD | DOM modal shield + input scope (MenuSurface.js:67–101); `isStoryInputLocked` (BattleScene.js:2244) gets `\|\| this._saveRetry?.isBlocking()` → mobile context `none`; End Turn refused (`canForceEndTurn`, :4259) | allowed |
| Enemy turn-start pipeline | parks before `processTerrainDamage` (:9810) | runs |
| Enemy action loop | parks after the capture's `finally` (:10506), before `presentQueuedLevelUps` (:10507) | runs |
| Committed-attack rolls | parks after `_commitCombatIntent` (:8572) | runs |
| ESC / Pause / Save & Exit / Vision | consumed by the modal: `onClose` is a no-op that refocuses, and the header Close button is removed | Save & Exit flushes first (below); Vision is allowed, and a durable rewind supersedes |
| Orientation re-open | waits (`_modalOpen` via `hasInputFocus`, PortraitBattleController.js:139) | its own capture is an implicit retry |
| Battle end, fatal, defeat | cannot start; if presentation running under the modal reaches one, the controller closes and releases waiters | own persist-first flows |

**battleState is never changed.** That avoids the overwrite race with `unitActed` → `onPhaseChange('enemy')` (BattleActionCompletion.js:48). The dialog opens in a **microtask** after the failed capture, so it is up before any DOM event can run.

**The gate.** `_saveRetryGate(session)` returns `null` when not blocking. Callers do `const g=…; if (g) { await g; if (!isCurrent…) return; }`, so the unfailed path adds no microtask and RNG and harness timing do not change.
- The wait is a `_createLifecycleAwaitGuard({label:'save_retry', timeoutMs:null})`, so shutdown and restart park it.
- All waiters share one guard and resume exactly once.

**6a/6b coordination.** Await the gate after a failed `captureResolvedAction`, before presentation.

**SceneGuard.** Its stuck detector (SceneGuard.js:560–569, 15 s on `ENEMY_PHASE`/`COMBAT_RESOLVING`) must set `stateChangedAt = Date.now()` while `scene._saveRetry?.isBlocking()`.

## Options and semantics

- **Retry** calls `suspend.retryCheckpoint({session: episode.session})`. That is the frozen candidate re-stamped by `saveRun`: no recapture, no reseed, no timeline row, no effects re-applied. `saveRun` re-runs the SaveSpace shedding each time.
  - `ok`: close, show a DOM toast "Battle saved.", release waiters, go `idle`.
  - `quota` or `write_error`: show "failed again" with an attempt count.
  - `checkpoint_replaced` or `no_candidate`: go `degraded` and release waiters.
  - `unstable_boundary` or `no_battle`: close and release.
- **No "Free space" button.** Automatic shedding (other slots, stages 1–3) and the slot's own timeline fallback already run inside every attempt. Everything left in storage is player data (other slots, `_cloud_pending` reservations, conflict copies). Deleting it mid-battle would break Guarantee 3. The copy tells the player to free device space instead.
- **Keep playing** moves to `degraded` and releases waiters once. Every later capture writes a newer candidate, so recovery is automatic: the first durable write moves to `idle` with "Battle saved.". Later failures do not prompt again.
- **Save & Exit** (`saveExitCb`, BattleScene.js:4621): first `await _saveRetry.ensureDurableForExit({session})`.
  - If a candidate exists, retry it.
  - If the retry fails while `degraded`, show the exit dialog: **Retry / Exit anyway / Stay**. Stay restores `prePauseState`, like `onResume`.
  - While `idle` (only a `progress:false` failure), exit without asking.
  - When unsaved, the pause warning (:4685) becomes "Not saved yet. Exit tries to save it.".
- **Refresh or crash while unsaved.** Resume restores the last durable checkpoint, so the actions after it are lost and can be chosen again. Continue from Map remains the sanctioned revert. While `pending` the loss is the one blocked boundary; while `degraded` it is whatever the player played after the risk copy. This is a bounded exception to the anti-refresh guarantee: it applies only when storage refuses writes, and no UI can close it. Note it in the CLAUDE.md Persistence bullet and the response doc.

## Copy (lines ≤ 40 characters, DOM, `SAVE_RETRY_COPY`)

- **Title:** "Battle not saved"
- **First line, by reason:** "This device's storage is full." (quota) / "This device refused the save." (write_error)
- **Then:** "If the game closes now, you go back" / "to your last save."
- **Quota only:** "Free space on this device, then Retry."
- **Then:** "Keep playing retries after each action."
- **Buttons:** "Retry", "Keep playing"
- **States:**
  - retrying: "Saving..." (both buttons disabled, `ignoreRepeatedActivation`)
  - failed again: "Still not saved. Tries: N"
  - success: auto-dismiss
- **Pill:** "Not saved" (aria: "Battle not saved. It retries after each action.")
- **Exit dialog:** "Exit without saving?" / "Your latest moves are not saved." / "Exit now and they are lost."

**Layout:**
- MenuSurface `{modal:true}` at `DOM_UI_DEPTHS.MENU` (uiDepths.js:66). The shield already hides the mobile HUD (cohesion.css:194–202, :278–283). `data-save-retry-action` attributes are the test hooks.
- The pill uses `pointer-events:none` and `--re-depth-forecast`, and is placed by JS from the `#game-container` rect (top-center, under `.portrait-battle-notice` when present). That needs no `html.portrait-ui` CSS, so PortraitCssGating is unaffected. Its CSS sits beside `.portrait-battle-notice` (portraitBattle.css:37). No new depth constant.

## Enemy phase

Yes: the enemy phase pauses at the enemy-action gate and the pipeline-start gate. Retry or Keep playing resumes it once. `_enemyActionCheckpoint` has already been reset by then (the gate sits after the `finally`).

## Telemetry (`reportAsyncError` codes)

- `battle_save_failed`: reason, site, phase, turn, checkpointIndex, policy. Reported once per failure streak, from `_persistBattleRunState`.
- `battle_save_retry_failed`: attempt number, reason.
- `battle_save_retry_rejected`: replaced, no_candidate or unstable.
- `battle_save_continue_unsaved`
- `battle_save_recovered`: via retry, later capture or superseding write; attempts; captures while unsaved; ms unsaved.
- `battle_save_exit_unsaved`
- `battle_checkpoint_capture_error`
- `battle_cloud_push_error`: callback_error, once per session.

## Implementation

- **`src/ui/SaveRetryController.js`**
  - Shape: constructor(scene), create() and destroy() per the extraction pattern.
  - API:
    - `onCheckpointResult`, `onDurableWrite`
    - `whenSettled` (the gate), `isBlocking`, `isUnsaved`
    - `retry`, `keepPlaying`, `ensureDurableForExit`
    - `update()`: per frame; closes on `BATTLE_END` or fatal flags and places the pill.
  - Each episode stores the **operation's session** passed in by the capture. Microtasks and button handlers do nothing if `!isCurrentBattleSession(scene, episode.session)`.
  - It draws no canvas objects and makes no RNG draws.
  - With no DOM host it renders nothing; tests drive `retry` and `keepPlaying`.
- **`src/engine/SavePersistenceStatus.js`**: `RETRYABLE_SAVE_REASONS`, `classifySaveResult`.
- **BattleScene changes (small shims only):**
  - `init`: `_saveRetry=null; _checkpointPersistenceResult=null`.
  - shutdown cleanup (:597+): `_saveRetry?.destroy()`.
  - add `_onCheckpointResult` (lazy `||=`) and `_saveRetryGate`.
  - add the `isStoryInputLocked` clause, the `_persistBattleRunState` hooks, the three gates, the `saveExitCb` flush and `update()` → `_saveRetry?.update()`.

## Tests

**Unit: `tests/SaveRetryController.test.js`** (pure, fake suspend):
- classification of every reason;
- the copy line-length test;
- double-tap Retry → one write;
- Retry then Keep playing → one release;
- a stale episode's button is inert.

**Journey: `tests/harness/SaveRetryJourney.test.js`** (JourneyBattleScene, `storage.failWrites`, explicit `{timeout: 20_000}`):
- **Every capture site:** inject a write failure at each site above and assert:
  - the prompt does or does not appear;
  - blocked flows are refused, and `executeCombat`, the enemy loop and End Turn do not advance (HP, positions and fixed-v1 RNG cursor unchanged while open);
  - Retry writes JSON equal to the no-failure world except `savedAt`;
  - afterwards HP, uses, XP and the RNG cursor equal the no-failure world;
  - the continuation runs once.
- **Capture order:** a throw before `setBattleCheckpoint` (G1) and after it.
- **Retry outcomes:** quota on retry (fallback adopted).
- **Rejected retries:** retry after a defeat or fatal decision or `BATTLE_END` never overwrites (G3).
- **Supersession:** degraded → a Vision rewind or later capture succeeds → pill gone, and `hasRetryCandidate()` is false.
- **Save & Exit:** flush and the exit dialog.
- **Restart while open:** `restartScene` → old gate parked, new session clean, old Retry inert.
- **Non-prompting worlds:** a tutorial or no-slot battle with throwing storage never prompts and never clones. Cloud `protected_slot` never prompts.
- **Portrait:** `progress:false` does not prompt.

**Existing tests to update:**
- CombatBoundaryPresentation.test.js:37: `executeCombat` now parks; resolve it with `keepPlaying()`.
- The `retryCheckpoint()` callers listed under G3.

**Browser: `tests/e2e/save-retry.spec.js` in lane `contracts`** (`tests/e2e/lanes.json`). Failures are injected through `Storage.prototype.setItem`, as in portrait-rotation.spec.js:895.
- Desktop at 640×480: Wait → dialog, ESC inert, keyboard and gamepad navigation; failed again; storage restored → Retry → closes, the slot holds the checkpoint; next action works.
- A failure during the enemy phase → enemies hold; Keep playing → pill; recovery.
- Refresh while open → Resume restores the older checkpoint.
- Save & Exit while degraded.
- Layout: dialog and pill inside the viewport at 640×480 and in phone landscape; mobile HUD hidden while open.

**Portrait lane.** Rewrite portrait-rotation.spec.js:883: after `moveAndWait('Sera')` the dialog now appears; choose Keep playing; the pill clears on the successful turn. Add an upright check that the dialog fits above the rail.

**Planted regressions that must fail:**
- remove the G3 guards;
- restore :86–87;
- drop each of the three gates;
- drop the `isStoryInputLocked` clause;
- resolve waiters twice;
- skip the exit flush;
- skip the `init` resets;
- prompt on `missing_slot` or `protected_slot`;
- retry by recapture;
- no quota fallback on retry;
- prompt on `progress:false`.

## Size and risks

**Size:** about 300 lines of source, about 700 of tests, one e2e spec (M).

**Risks:**
- a gate placed inside a `try/finally`, which parks forever;
- harness hangs where existing tests inject failures;
- the `stuck_blocking` false positive;
- legacy reseed before build (:96) when the capture throws (existing behavior, out of scope);
- post-battle and NodeMap save failures stay telemetry-only (PR 7).
