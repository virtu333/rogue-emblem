# Battle Timeline Rewind — Proposal

**Date:** 2026-09-21
**Status:** Original proposal; implementation assumptions and sequencing superseded by the [investigated timeline plan](battle-timeline-rewind-plan-2026-09-21.md). Retained as design history.
**Branch context:** `mobile-rebuild-checkpoint`
**Replaces / extends:** the current turn-start "Vision" rewind (`src/ui/VisionRewindController.js`)

## 1. Summary

Turn Vision into a modern Fire Emblem style rewind (Three Houses' Divine Pulse,
Engage's Time Crystal): every action on both phases is logged, the player can
open a timeline, scrub backwards and forwards to see exactly what happened, and
rewind to any stable point on a player phase (and, in a later slice, to points
inside an enemy phase). The existing per-run Vision charge economy stays; what
changes is how far and how precisely a charge can take you.

Most of the machinery already exists. The battle already captures an exact,
restorable checkpoint after **every** completed player action for the
anti-refresh suspend feature (`BattleSuspendController.captureCheckpoint`),
and Vision already restores a checkpoint-shaped snapshot exactly
(`VisionRewindController._applySnapshot`). The gap is that only one checkpoint
and one Vision snapshot are kept. The proposal is, at its core: keep a bounded
history of those checkpoints, attach a human-readable log entry to each, and
build a viewer over that history.

## 2. Where we are today

Facts about the current implementation that the design leans on:

| Piece | What it does today | File |
| --- | --- | --- |
| Vision snapshot | One snapshot per player turn, taken after turn-start effects resolve (`captureVisionSnapshot` in the turn-start pipeline). A pending/active double buffer means the "current" snapshot is the start of the turn the player is on. | `src/scenes/BattleScene.js` ~9239, `VisionRewindController.captureSnapshot` |
| Vision rewind | Spends 1 charge, restores the turn-start snapshot exactly, bumps `_enemyPhaseEpoch` to kill any in-flight enemy phase, reseeds RNG with `hashRewindSeed(seed, visionCount)`. | `VisionRewindController._applySnapshot` |
| Vision charges | Per run: `1 + metaEffects.visionChargesBonus`, +1 after act 2/3/4 boss. Tutorial uses a scene-scoped store. | `RunManager.getBaseVisionCharges`, `RunManager.completeBattle` |
| Lord death | On enemy phase, commander death opens "vision fractures" prompt: Rewind (to turn start) or Accept Fate. | `BattleScene.checkBattleEnd` ~10281, `showLordDeathPrompt` |
| Suspend checkpoint | After every completed player action, at turn start, and after a rewind, the battle serializes units, world state, fog, ballistas, village state, etc. into `runManager.battleInProgress.checkpoint` and persists the run save. Each capture reseeds RNG with `hashRewindSeed(visionBaseSeed, checkpointIndex)` so live play and a resume share one stream. | `BattleSuspendController` |
| Resume | `applyUnits` + `finalizeResume` rebuild the scene from the checkpoint exactly; an exhausted player phase hands straight to the enemy phase, which replays deterministically. | `BattleSuspendController` |
| Shared world contract | Map layout, temporary terrains, deaths this battle, hybrid override turns, late-pressure flag. | `src/engine/BattleSnapshotState.js` |
| Enemy phase | Async pipeline driven by `AIController.processEnemyPhase` callbacks (`onMoveUnit`, `onAttack`, `onStatusStaff`, `onBreak`, `onUnitDone`, `onDecision`), then terrain damage, reinforcements, `endEnemyPhase`. Every step re-checks the epoch. | `BattleScene.startEnemyPhase` ~9878 |
| Determinism | `AIController` and `ReinforcementScheduler` draw no `Math.random`; combat, skills and loot do, but `Math.random` is replaced by a seeded generator (`reseedBattleRng`). The harness already has `Determinism.test.js`. | `tests/harness/` |
| Resolved-action continuation | Level-up popups persist a `{kind, unitName, skipCanto, gambitTriggered}` continuation with the checkpoint so a refresh mid-presentation cannot lose or replay a resolved action. | `src/ui/BattlePresentationCheckpoint.js` |
| Mobile HUD | Already labels the Vision text "Rewinds:" and has a Rewind button; help text already says "Open the rewind viewer". | `src/ui/MobileBattleHUD.js`, `src/data/helpContent.js` |

Known gaps this proposal must respect:

- Only player-phase stable points are checkpointed. Nothing is captured during
  an enemy phase.
- Checkpoints go to `localStorage` and Supabase on every action, so the save
  size budget is real (quota errors are already handled in `RunManager`).
- BattleScene is ~10,900 lines; any new flow must be a controller, not inline.
- Terminology is inconsistent in the UI ("Vision", "Eye", "Rewind"); the
  playtest note from 2026-09-20 already asks for one term.

## 3. Target experience

### 3.1 Vocabulary

- **Timeline**: the ordered list of everything that happened this battle.
- **Entry**: one logged event (a unit's action, an enemy's action, a turn
  start, reinforcements arriving, terrain damage, a death, a level up).
- **Stable point**: an entry the game can restore to. All player-phase
  entries after a completed action are stable; in slice 4 enemy-phase
  entries after each enemy finishes are stable too.
- **Vision** stays the player-facing name for the resource; the button is
  "Vision" everywhere (HUD, mobile bar, help), and the screen is "Vision
  timeline". "Rewind" is the verb on the confirm button only.

### 3.2 Opening the timeline

- Desktop: `R` key or the HUD "Vision" label; mobile: the existing Rewind
  button in the battle bar (renamed Vision).
- Allowed whenever `canUseNow()` allows today (player phase, an idle-ish
  battle state, no modal). Opening is always allowed even with 0 charges,
  because reading the log is free. The rewind confirm is what costs.
- Also opened automatically by the lord-death prompt (see 3.5).

### 3.3 The viewer

A DOM `MenuSurface` (modal, `role="dialog"`, `aria-label="Vision timeline"`),
consistent with the other rebuilt menus, docked on the right on landscape
phones and desktop so the map stays visible on the left.

```
┌ Vision timeline ──────────────────── [Back] ┐
│ Turn 4 · Player phase          Vision: 2   │
│ ────────────────────────────────────────── │
│ ● Turn 4 begins                            │   ← stable
│ ● Edric → (7,4) attacks Brigand: 12 dmg,   │   ← stable
│     crit! Brigand falls. +34 XP            │
│ ● Sera heals Edric +9                      │   ← stable
│ ○ Turn 3 · Enemy phase                     │
│ ○ Archer → (9,6) attacks Lyra: miss        │   ← preview only (S4: stable)
│ ○ Mercenary → (8,5) attacks Edric: 7 dmg   │
│ ○ Reinforcements: 2 Cavaliers (north)      │
│ ● Turn 3 begins                            │
│ …                                          │
│ ────────────────────────────────────────── │
│ [ Rewind here — 1 Vision ]                 │   ← disabled on non-stable rows
└────────────────────────────────────────────┘
```

Behaviour:

- Entries are `button`s so the existing `MenuSurface.focusNext` traversal
  works untouched: Up/Down (and controller NAVIGATE) move focus, and
  **focus is the scrub**. Focusing a row previews the board at that moment.
  Tapping a row on mobile focuses it (preview); a second tap on the already
  focused row is the same as pressing Rewind here.
- Preview repositions units, sets HP, fog, terrain and the turn counter to
  that entry's state. Units that no longer exist at that moment are gone;
  units that had not spawned yet are absent. A thin "Preview — Turn 3, enemy
  phase" ribbon sits over the map while previewing.
- The row for the current moment ("Now") is always the top row and previews
  the live state; Back from the viewer always restores the live state.
- Rows are grouped by phase with sticky headers; the list opens scrolled to
  Now.
- The Rewind button label shows the cost and is disabled with a reason when
  a row is not a stable point ("You can only return to your own turn" in S3;
  never disabled for that reason after S4) or when charges are 0
  ("No Vision left").
- Rewinding closes the viewer, plays the existing rewind flash, and shows the
  restored state. The entries after the landing point are dropped (FE
  behaviour). A short toast: "Returned to Turn 3 — Edric's turn".

### 3.4 Charge policy (recommendation)

Keep charges per run. One rewind costs one charge regardless of how far back
it lands. Two additional rules make step rewind feel like the modern games
without making Vision cheap:

- **Free undo within the current player phase** is *not* granted by default.
  It is the one thing that most changes the feel of the game, so it is a
  switch in `difficulty.json` (`freeSamePhaseRewind`), off on all modes to
  start. If playtests show misclick frustration on touch, enable it on
  Normal only. (See Decision D2.)
- **Lunatic**: timeline viewing is always available; rewind landing points
  are limited to turn starts (today's behaviour) via `difficulty.json`
  (`rewindGranularity: "turn"`), so Lunatic keeps its identity.

### 3.5 Lord death

Today the enemy-phase commander death opens a two-button prompt. New flow:
the prompt's Rewind button opens the timeline with the fatal entry at the
top and the last stable point pre-focused, so the player can choose how far
back to go. Accept Fate stays. Cancelling the viewer from this state returns
to the prompt (not to the dead board), so the player cannot escape the
decision.

### 3.6 Tutorial

`TutorialController.showLordRewindPrompt` and the turn-3 "vision intro" hint
are rewritten to teach the timeline: "Open Vision to see what happened and
return to any earlier moment." The tutorial's standalone charge store keeps
working since the controller reuses `_chargeHost()`.

## 4. Architecture

### 4.1 Modules

| Module | Kind | Responsibility |
| --- | --- | --- |
| `src/engine/BattleTimeline.js` | pure, no Phaser | Ordered entry store: `append(entry)`, `markStable(entryId, checkpoint)`, `truncateAfter(entryId)`, `entriesForView()`, `prune(policy)`, `toJSON()/fromJSON()`. Owns the size policy. |
| `src/engine/BattleCheckpoint.js` | pure | `captureBattleCheckpoint(scene, {index, seed})` — the body of `BattleSuspendController._buildCheckpoint` moved here so suspend, Vision and the timeline share one serializer. `serializeSuspendUnit` moves with it. Adds `version: 2` fields listed in 4.3. |
| `src/engine/BattleLogFormatter.js` | pure | Turns a raw entry (`kind`, actor, target, combat `events[]`) into the row text: summary line, detail lines, icon. Fully unit-testable against the longest names (UI polish rule). |
| `src/ui/BattleTimelineController.js` | controller (`create/destroy`) | Records entries from scene hooks, owns preview/restore, owns the viewer surface. Replaces the dialog half of `VisionRewindController`; the charge/HUD half stays. |
| `src/ui/BattleSuspendController.js` | existing | Restore path (`applyUnits`, `finalizeResume`) refactored into `restoreBattleCheckpoint(scene, checkpoint, {mode: 'resume' | 'rewind' | 'preview'})` so all three paths share one implementation. |

Everything the scene needs to expose is one recorder API, called from the
existing choke points:

```js
scene._timeline.record({ kind, actor, target, payload })  // returns entry id
scene._timeline.stablePoint(entryId)                      // captures checkpoint
```

### 4.2 Stable points

Reuse the exact places that already call `_captureSuspendCheckpoint`:

| Moment | Existing hook | Entry kind |
| --- | --- | --- |
| Turn start, after turn-start effects (poison, ballista, recovery, level-up popups) | turn-start pipeline (`BattleScene` ~9239) | `turn_start` |
| After every completed player action (incl. Canto finished, Gambit refresh applied) | `completeBattleAction` (`src/ui/BattleActionCompletion.js`) | the action's entry becomes stable |
| After a rewind | `applyVisionSnapshot` | `rewind` (informational, stays in the log) |
| After the enemy phase ends (reinforcements applied) — **new** | end of `startEnemyPhase` tail | `enemy_phase_end` |
| After each enemy finishes — **new, slice 4** | `onUnitDone` callback | that enemy's entry becomes stable |

The suspend checkpoint becomes simply "the latest stable point"; nothing about
the resume flow changes in slice 1 except where the payload is built.

Not stable, by design: mid-Canto, mid-trade, mid-forecast, while a level-up
popup or a `_pendingActionCompletion` continuation is outstanding, during
`COMBAT_RESOLVING`, and during story/dialogue locks. These are the same
exclusions the suspend controller relies on today.

### 4.3 What a checkpoint must also carry (version 2)

The current payload is nearly complete. Gaps found while reading the restore
paths, to add and to cover with tests:

- `enemyPhase` progress (slice 4): index of the next enemy to act in the
  ordered copy `AIController.processEnemyPhase` iterates, plus the enemy
  order itself (names in order) so a mid-phase resume continues with the
  right units.
- `reinforcementState`: anything `applyReinforcementsForTurn` keeps between
  turns beyond `appliedHybridOverrideTurns` (escape-map `repeatingWaves`
  counters, per-wave spawned flags). Verify during S1; if it is all derived
  from `(turn, seed)` it needs nothing.
- `commanderKillerName` and `currentEnemyPhaseAiStats` are ephemeral and
  intentionally **not** captured (narrative memory and telemetry).
- `_pendingLevelUpPopups` must be empty at a stable point (it is, by the
  exclusions above); assert it in the capture.

### 4.4 Restore modes

One function, three modes:

- `resume`: today's `applyUnits` + `finalizeResume` (scene being built).
- `rewind`: today's `_applySnapshot` (scene live): clear selection/highlights,
  bump `_enemyPhaseEpoch`, restore units/world/fog/turn/anti-turtle, reseed,
  re-capture the suspend checkpoint, play the flash.
- `preview`: like `rewind` but no epoch bump, no reseed, no checkpoint
  persist, no flash, no HUD refresh of charges, and the viewer stays open.
  The live state is itself a stable point (captured on open), so "cancel" is
  `preview(liveEntry)`; "confirm" is `rewind(entry)`.

Preview by full restore is the correct first implementation: it is exact, it
reuses tested code, and the cost (rebuilding ~20 unit graphics) is a few
milliseconds. If scrubbing on low-end iOS stutters, a later optimisation is a
lightweight `previewDiff` that only moves graphics and HP bars between
adjacent entries. Do not start there.

Input while previewing: the map is inert (no unit selection, no danger zone);
`InputController` already gates on `battleState`, so the viewer sets
`battleState = 'TIMELINE'` and the gate list gets one new state.

### 4.5 Log entries and their sources

| Kind | Source hook | Payload |
| --- | --- | --- |
| `turn_start` | `onPhaseChange('player')` | turn, par rating, turn-start effects (poison ticks, recoveries, ballista hits) |
| `player_action` | `finishUnitAction` / `completeBattleAction` | actor, from/to tile, action (attack, heal, item, talk, seize, visit, wait, trade, shove, pull, dance, art, ability, ballista, escape), target, combat `events[]` from `Combat.resolveCombat`, XP gained, level up (stats), kills, gold, item drops, uses spent |
| `enemy_phase_start` | `onPhaseChange('enemy')` | turn |
| `enemy_action` | AI callbacks (`onMoveUnit`, `onAttack`, `onStatusStaff`, `onBreak`, `onUnitDone`) | actor, path end, target, combat `events[]`, deaths, village raze |
| `terrain_damage` | `processTerrainDamage` | per-unit damage, deaths |
| `reinforcements` | `applyReinforcementsForTurn` | list of spawned units + edge |
| `caravan_step`, `boss_enrage`, `late_pressure` | their controllers | short text |
| `death` | `removeUnit` | unit, killer (also folded into the parent action's detail) |
| `rewind` | `applyVisionSnapshot` | landing entry, charges left |

Combat rows are built from the same `events[]` the combat animation consumes,
so hit/miss/crit/damage text is authoritative and free.

### 4.6 Enemy-phase landing points (slice 4)

The AI loop is already resumable in shape: it iterates a copied array, skips
dead enemies, and marks `hasActed` through `onUnitDone`. To land inside an
enemy phase:

1. Capture a stable point in `onUnitDone` (cheap: the scene is already at a
   settled state between enemies; the 300 ms inter-enemy delay hides the
   cost).
2. The checkpoint stores the enemy order and the next index (4.3).
3. `restoreBattleCheckpoint(..., {mode: 'rewind'})` with `phase === 'enemy'`
   sets `battleState = 'ENEMY_PHASE'` and calls a new
   `resumeEnemyPhase(fromIndex)` that runs `processEnemyPhase` on the
   remaining enemies under a fresh epoch, then the normal tail (terrain
   damage, reinforcements, `endEnemyPhase`).
4. `finalizeResume` (refresh mid-enemy-phase) uses the same path instead of
   the current "replay whole enemy phase from the exhausted player state".

Because the RNG is reseeded at every stable point, the remaining enemies act
identically on resume and on rewind-to-that-point (see 4.7).

### 4.7 RNG policy

Today a Vision rewind reseeds with `hashRewindSeed(turnSeed, visionCount)`,
so repeating the same actions after a rewind rolls **different** results.
Checkpoints, on the other hand, reseed with `hashRewindSeed(base, index)`,
so a resume replays **identical** results.

Recommendation: **fixed stream per stable point** (Engage/Three Houses
behaviour). Rewinding to entry *k* restores `seed_k`; doing exactly the same
thing again gives exactly the same outcome; doing anything different (even
attacking in another order) consumes the stream differently and changes
later rolls. Reasons:

- It removes savescumming a 30% hit into a hit by burning charges on the
  same attack, which the step granularity would otherwise make very cheap.
- It matches the fiction: Sera *sees* the future; to change it you must act
  differently.
- It makes the timeline itself trustworthy: previewing a future entry after
  rewinding shows what *will* happen if nothing changes. (We do not need to
  expose that, but tests can rely on it.)
- Resume and rewind then share one rule instead of two.

The one behaviour to keep from today: the lord-death rewind should still be
survivable by repeating a plan, so the per-turn `visionCount` salt stays
available behind `difficulty.json` (`rewindRerollsRng: true|false`) with the
default **false**. (Decision D1.)

### 4.8 Persistence and size

Per stable point the checkpoint is the full unit list plus map layout; for a
20-unit map that is roughly tens of KB of JSON (measure in S1 and record the
number here). Keeping every stable point of a long battle in the run save is
not acceptable for `localStorage` (5 MB shared with three slots) or for the
per-action Supabase push.

Policy:

- **In memory:** keep every stable point for the current turn and the
  previous `N` full turns (`N = 3` by default, `difficulty.json`), plus the
  turn-start point of every earlier turn. Older intermediate points are
  pruned but their log rows stay (rows are ~100 bytes). Rows older than the
  oldest stable point are shown greyed with "Too far back".
- **Persisted in the suspend checkpoint:** the log rows (all), the latest
  stable point (as today), every stable point of the current turn, and the
  turn-start points of the previous `N` turns. On resume the player can
  therefore rewind within the turn they were on and to recent turn starts,
  which covers the realistic cases. Measure; if the save exceeds a budget
  (propose 512 KB per slot for the battle checkpoint) drop the oldest
  persisted points first and the log rows last. `RunManager` already reports
  quota failures; add a soft guard before the write.
- **Cloud:** unchanged mechanism; the payload grows by the above. The
  per-table write serialization already coalesces rapid saves.

### 4.9 Controller boundaries inside BattleScene

- No new rendering or flow inline in `BattleScene`. The scene gains one
  field (`_timeline`), one state (`TIMELINE`), and one-line calls at the
  hooks in 4.2 and 4.5.
- `VisionRewindController` keeps: charge host, `initialize`, `getChargesRemaining`,
  `executeRewind` (now takes a target entry), `updateHud`, `playRewindEffect`.
  Its `captureSnapshot`/`pendingVisionSnapshot` double buffer is deleted once
  the timeline provides turn-start entries; `checkpoint.visionSnapshot`
  stays readable for one release for old saves (version 1 → 2 migration:
  treat the old `visionSnapshot` as the single turn-start stable point).

## 5. Edge cases

| Case | Handling |
| --- | --- |
| Rewind while an enemy phase is animating (lord-death prompt, or R pressed mid-phase in S4) | Existing epoch mechanism: every AI callback and the tail check `phaseSuperseded()`. Preview must **also** bump nothing: it only happens with the viewer modal open, and the viewer cannot open during an unsuperseded enemy phase except via the lord-death prompt, where the prompt already blocks the callbacks (`this.visionDialog` guards). Keep that guard, generalised to "a timeline modal is open". |
| Level-up popup queued when a rewind is requested | Not a stable point; the viewer cannot open until `PLAYER_IDLE`. Stable points assert the queue is empty. |
| `_pendingActionCompletion` (refresh mid level-up presentation) | Resume finishes the continuation first (today's behaviour), then the timeline is available. |
| Canto | Stable point only after Canto completes (`completeBattleAction`), never between attack and Canto move. The row shows both legs. |
| Gambit refresh | `completeResolvedAction` refreshes adjacent allies then falls into the stable capture; row detail lists refreshed allies. |
| Recruit via Talk / boss recruit mid-battle | Unit is in `playerUnits` in the snapshot. Roster changes happen at battle end (`completeBattle`), so nothing leaks to `RunManager` before then. Verify `BossRecruitOverlay` does not touch the roster early. |
| Items consumed, staff uses, per-battle art uses, timed buffs, once-per-battle flags | Already in `serializeSuspendUnit`. |
| Trades and convoy | Trades are unit-to-unit (in snapshot). Village rewards go to the convoy: `villageState` + `VillageController.restoreFromVisionSnapshot` already revert the item; extend to any other mid-battle convoy writes (audit `RunManager.convoy` writers reachable from `BattleScene`). |
| Promotion / reclass mid-battle | Inventory and class live on the unit; covered. Promotion presentation is a multi-step flow; it is excluded from stable points until it completes. |
| Gold earned | `goldEarned` in snapshot (already). |
| Loot drops / post-combat loot flow | `LootFlowController` runs before the action completes; the stable point is after it. Drops that were declined/taken are in unit inventories or `goldEarned`. |
| Escape objective | `escapedUnits` restored (already). A unit that escaped later than the landing point returns to the map. |
| Seize / victory / defeat | No stable points after `BATTLE_END`. Lord death goes through the prompt (3.5). Victory is final: FE also does not allow rewinding out of a won map; the level-complete flow writes to the run. |
| Fog of war | Snapshot restores `visibleSet`/`everSeenSet` exactly. The player keeps what they *learned* while scrubbing (enemy positions under fog at later entries). Preview therefore renders fog **as of that entry** and hides units not visible then; a rewind reveals nothing the player did not see live. This is the same information the game already showed them, so no new leak. |
| Danger zone / caches | `restoreBattleWorldState` already invalidates. |
| Reinforcements | Entry logged; spawn is a function of `(turn, reinforcement seed)` and captured world state. Verify no scheduler state lives outside the checkpoint (4.3). |
| Ballista ammo, temporary terrains, broken walls, razed village, lava/ice changes | `ballistas`, `temporaryTerrains`, `mapLayout` in snapshot (already). |
| Zombie tombstones (revive) | In snapshot (already). |
| Conditions (sleep, silence, root, acid) | In snapshot; icons rebuilt (already). |
| Anti-turtle / turn par / late pressure / boss enrage | In snapshot (already); a rewind before the enrage turn un-enrages. |
| Tutorial battle | No `RunManager`; charge host is scene-scoped; timeline works the same. Tutorial steps that reference the old prompt are rewritten (3.6). |
| Suspend + resume mid-preview | Viewer open means no writes; on shutdown the live stable point is what is persisted. Preview never persists. |
| Save quota | Soft budget check before persisting; prune persisted points first (4.8). |
| Cloud conflict (two devices) | Unchanged: `battleInProgress` is part of the run save and the freshness guard applies. |
| Audio | Rewind re-asserts current music (already). Preview does not touch audio. |
| Hint/tutorial seen state (`HintManager`) | Not part of the snapshot; a rewind never re-shows a dismissed hint. Keep it that way. |
| Telemetry / AI stats | Enemy-phase AI stats are per phase run; a rewind that replays a phase produces a second stats record. Tag records with the epoch. |
| Difficulty gating | `difficulty.json` gains `rewindGranularity` (`"turn"` / `"action"`), `rewindHistoryTurns`, `freeSamePhaseRewind`, `rewindRerollsRng`. Data-driven per the project rules. |
| Determinism tests | `tests/harness/Determinism.test.js` gains: record a battle, rewind to entry *k*, replay the same driver inputs, assert identical log from *k* onward. |
| Very long battles (turn 30+) | Log rows are cheap; stable points are pruned by policy; the viewer virtualises nothing (≤ ~400 rows is fine in the DOM). |
| Longest names | `BattleLogFormatter` tests use the longest class/weapon/skill names; rows wrap rather than clip (UI polish rule). |

## 6. Testing

- **Unit (Vitest):** `BattleTimeline` (append/truncate/prune/serialize),
  `BattleCheckpoint` round trip against `HeadlessBattle`, `BattleLogFormatter`
  golden strings, `BattleTimelineController` charge/permission logic with a
  mock scene (pattern from `VisionRewindController.test.js`).
- **Harness:** `HeadlessBattle` records a timeline; assert every stable point
  restores to a state equal to the live state at that moment (deep-equal on
  the serialized form), on both phases (S4).
- **Determinism:** as above; also assert that the *old* Vision behaviour
  (turn-start landing) is a strict subset of the new one.
- **Suspend/resume:** existing `BattleSuspendController.test.js` extended for
  version-2 payloads and the migration from version 1.
- **E2E (Playwright, ux-contracts group):** open the viewer with the
  keyboard and by tap, arrows scrub, preview ribbon visible, Back restores
  live state, Rewind lands and drops later rows, 0-charge state disables
  confirm, lord-death prompt opens the viewer, mobile preview layout keeps
  the map visible. Follow the existing DOM menu input contract (arrows move
  focus).
- **Save size:** a test that builds a 20-turn battle and asserts the
  persisted checkpoint stays under the budget.
- **Gates before each slice merges:** `check:reference`, `check:data-parity`,
  `test:unit`, `test:ux-contracts`, `test:e2e:smoke`, `sim:fullrun:harness:pr`.

## 7. Delivery slices

Each slice ships on its own and leaves the game playable.

| Slice | Scope | Rough size |
| --- | --- | --- |
| **S1 — Foundations** | Extract `captureBattleCheckpoint` and `restoreBattleCheckpoint`; add `BattleTimeline` recording player-phase stable points in memory; Vision's turn-start snapshot becomes the timeline's `turn_start` entry (behaviour identical to today); version-2 checkpoint fields; measure snapshot size. | 2–3 days |
| **S2 — Log + read-only viewer** | Entry recording for both phases, `BattleLogFormatter`, the DOM viewer with scrub/preview, HUD/mobile button wiring, terminology cleanup. No new rewind targets yet (Rewind here works only on `turn_start`, same as today). This already answers "what just happened on enemy phase". | 3–4 days |
| **S3 — Rewind to any player-phase point** | Enable stable rows, charge policy, lord-death prompt integration, tutorial rewrite, help text, difficulty flags, RNG policy switch, e2e contracts. | 2–3 days |
| **S4 — Enemy-phase landing points** | `onUnitDone` stable points, enemy order/index in checkpoint, `resumeEnemyPhase`, refresh-mid-enemy-phase uses the same path, harness determinism on both phases. | 3–4 days |
| **S5 — Persistence** | Bounded persistence of stable points in the suspend checkpoint, size guard, version-1 save migration, cloud payload check, iOS low-end scrub performance pass (lightweight preview diff only if needed). | 2 days |

S1 and S2 are safe to do while other UI work continues; S3 is the first
player-visible behaviour change and the point to playtest the charge policy.

## 8. Decisions needed

Recommendations are first; the rest are the alternatives.

- **D1 — RNG after rewind.** Fixed stream per stable point (recommended) vs
  today's reroll salt. Ship the flag either way; pick the default.
- **D2 — Free undo inside the current player phase.** Off (recommended, keep
  Vision scarce) vs on for Normal only vs on everywhere.
- **D3 — Charge economy.** Keep per-run charges with one charge per rewind
  (recommended) vs per-battle charges (FE style, would need a new
  meta-upgrade track and rebalancing of `vision_charges_*`).
- **D4 — Lunatic.** Turn-start landing only (recommended) vs full timeline.
- **D5 — History depth.** Three full turns of stable points in memory,
  current turn plus three turn starts persisted (recommended).
- **D6 — Enemy-phase landing (S4) in the first release or later.** Later
  (recommended): S1–S3 already deliver the log and player-phase rewind, and
  S4 is the riskiest piece.

## 9. Things easy to miss

- **The suspend checkpoint is the rewind.** Because a checkpoint is captured
  after every action already, the persisted save is *by construction* a
  step-rewind point. Reusing it means the anti-refresh guarantee and the
  timeline can never disagree about what state is "real".
- **Preview must be side-effect free.** Two writers of scene state (preview
  and the live game) is the classic source of ghost bugs. The rule "preview
  = restore with mode flags, no persistence, no epoch, no RNG" plus a
  `TIMELINE` battle state that gates all input keeps it to one writer.
- **Determinism is now a player-visible promise.** Any new `Math.random`
  consumer that runs between stable points (a new animation that rolls, a
  new skill) silently changes replay. The harness determinism test becomes
  the guard; add a lint-style test that lists allowed `Math.random` call
  sites in `src/engine`.
- **Time-of-capture vs time-of-persist.** Today capture and persist are one
  call. With bounded persistence they diverge; make sure the *latest* stable
  point is always persisted synchronously (the anti-refresh guarantee), and
  only the history is best-effort.
- **Menu input contract.** Arrows move focus in DOM menus (commit b5d42c9).
  Designing the scrub as focus keeps the timeline consistent with every
  other menu and avoids a special-case handler.
- **Version-1 saves in the wild.** TestFlight build 10 saves have
  `visionSnapshot`/`pendingVisionSnapshot`. The migration is one line
  (treat as a single `turn_start` stable point) but must be tested.
- **Narrative.** The GDD frames Vision as Sera's foresight; the timeline is
  a natural fit ("what Sera saw"). If Sera is not in the run, the generic
  copy path already exists (`showLordDeathPrompt`).
