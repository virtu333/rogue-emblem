# PR 5 design note: narrow combat presentation boundaries and Teleporter extraction (2026-10-01)

Part of the stability effort. Read with `docs/specs/stability-round2-remediation-2026-10-01.md`.

**Prerequisites.** PR 5 builds on #171 and #173 *after* the round-2 fixes:
- #171 B1 removes the cleanup pass from the Deathburst chain's `finally`.
- #171 A1 resets the chain depth in `init`.
- #173 A2 makes session identity the counter plus `!_sceneShutdownCleanedUp`, and paused-but-current waits resolve instead of parking.

The A2 fix changes `_isSceneActiveForAsync`, so recheck the matrix-infrastructure notes below about `scene.scene.isActive` against the fixed tree. The line numbers below are from the pre-fix stack and will shift.

Published PR base: #173 (`fix/stability-session-ownership`); PR 5 is #175 (`fix/stability-combat-boundaries`). The evidence and historical `file:line` references below were collected on the earlier #171 + #173 integration tree (`8f5c568e`) and are not current line references. The combined verification branch is a test integration, not the PR base.

## Goal / non-goals

**Goal.** For `executeCombat` (BattleScene.js:8478) and `executeEnemyCombat` (:10587), normal, skipped, timed-out and failed presentation leave the same settled state (HP, positions, debt, statuses, XP/level-ups, rewards, roster membership, continuation, and for fixed-v1 the RNG cursor), and every presentation failure is reported. Teleporter settlement leaves the animation.

**Non-goals.** No staged combat context, no final-HP catch-up pass, no change to the catch blocks' partial-settlement semantics (:8559–8600, :10639–10650), no new `rewindPolicy` id, no checkpoint added or reseeded, no legacy text-draw isolation. Those are PR 8 (full outcome in the engine) or stay as they are.

## Evidence (scratch probe, stack tree, `executeCombat` end to end, Teleporter defender, seed 7)

| world | defender pos | RNG cursor |
| --- | --- | --- |
| shown, lethal hit (baseline: a dead target does not warp) | (3,2), removed | 1199730150 |
| `onContact` skipped (`CombatFxController._live()` false, CombatChoreography.js:101), lethal | **(4,4)**, removed | **3031295963** |
| shown, survivable (baseline: warps) | (4,4) | 3031295963 |
| `hpBar` null, survivable: `unit.hpBar.bg` throws (:8915) after the draw (:8910) | **(3,2)** | 3031295963 |
| `updateHPBar` throws inside `onContact`, survivable: exchange aborted before the warp | (3,2) | 1199730150 |

A cosmetic `setScale` miss in `showStrikeProcChips` (:8736) likewise discarded the whole exchange before `applyCombatHP` (:8340): defender at full HP, action consumed, RNG advanced, no XP/post-combat/Phoenix/continuation. Traps 1–4 are reachable from the real entry points.

## The boundary (stack tree)

Required settlement — never inside a presentation guard, never after an unchecked await:

- Art cost trio (:8266–8268); engine `checkPhoenixBrooch` inside `_checkPhoenixBrooch` (:7783; visuals already guarded :7785–7787).
- `buildSkillCtx`, `resolveCombat` (:8276), timeline/history observes (:8287–8311), Shielded flag (just before :8340), `applyCombatHP` (:8340), debug invincibility, `deedsFor().onCombat` (:8354), `_applyResolvedCombatPostEffects` (:8358; `remove`/`moved` beats required, the rest guarded at :8630–8640), Phoenix both sides (:8366/:8368).
- **New:** per-strike interim HP (`applyStrikeHP`) and Teleporter settlement (`settleTeleporterWarp`), synchronous in the strike loop (:8313–8327).
- `awardXP` → `applyXpGain` (:8989/:9043, settle-before-text since #171), `removeUnit` domain work (:9165+), `_sweepFallenUnits` (:9394), `completeResolvedAction`/`completeBattleAction`, `checkBattleEnd`, enemy-action checkpoint (:10381).

Presentation — wrapped in `safeBattlePresentation`, continue on failure, `isCurrentBattleSession` after every awaited guard (#173):

- `updateHPBar(attacker)` after the art cost (:8269) — the one bar #171 left unguarded.
- `animateSkillActivation` (:8316) and all of `animateStrike` (:8321 → proc chips :8736, cut-in :8746, `playStrike` :8765, `_showStrikeResult` :8817–8902 minus its HP writes, warp fades).
- `showXpLesson` (:8515), `_maybeShowTutorialPermadeathHint` (:8522/:10611), `checkBossHalfHealth` (:8542/:10633; it marks the dialogue shown first, a loss its own comment accepts), `onChipLance`/`onLowHealth` (:8545–8546/:10636).
- Everything in `_presentWarp` (replaces `executeWarp` :8904–8947).

## Interim HP decision (trap 3)

Keep per-strike interim HP, but move the writes out of the Phaser callback. Add to `engine/UnitHealth.js`:

```js
/** One strike's HP as _showStrikeResult wrote it: target, drain heal, Thorns. Misses write nothing. */
export function applyStrikeHP(striker, target, event) {
  if (!event || event.type !== 'strike' || event.miss) return;
  setUnitHP(target, event.targetHPAfter);                                        // was :8844
  if (event.heal > 0 && event.strikerHealTo !== undefined) setUnitHP(striker, event.strikerHealTo);   // :8854
  if (event.reflectDamage > 0 && event.strikerHPAfter !== undefined) setUnitHP(striker, event.strikerHPAfter); // :8879
}
```

Call it in the strike loop before `animateStrike`; delete the three `setUnitHP` calls from `_showStrikeResult`, which keeps its `updateHPBar` calls (the bar still drops at contact: it reads `currentHP`, and nothing redraws it earlier). Every strike event carries `targetHPAfter` (Combat.js:1271 miss, :1401 hit); `applyCombatHP` (UnitHealth.js:96–119) stays as the final write and debt backstop, so convergence no longer depends on `onContact`, which is skipped at CombatChoreography.js:101/105 and on any throw before :194. Nothing reads HP mid-exchange except presentation (`BattleBeatsController` :108–111, :254–255, :285–287, all after resolution; `getUnitAt` :3515 filters `currentHP <= 0` but is reached only by the warp, which now takes settled HP). PR 8 keeps `applyStrikeHP` as the per-strike row of the full outcome and adds only the display-HP projection. `tests/HealthPresentationInvariance.test.js:123–127` must stop calling `_showStrikeResult` for "show"; its worlds become "strike presentation runs / absent" with unchanged assertions.

## Teleporter extraction (traps 1, 2, 4)

Pure function in `engine/AffixSystem.js` beside `getWarpCandidates` (:270):

```js
/** Teleporter settlement: one RNG draw iff a candidate exists, then the move. No graphics. */
export function settleTeleporterWarp({ unit, range, attacker, grid, getUnitAt, random = Math.random }) {
  const picks = getWarpCandidates(unit, range, attacker, grid, getUnitAt);
  if (picks.length === 0) return null;
  const pick = picks[Math.floor(random() * picks.length)];
  const from = { col: unit.col, row: unit.row };
  unit.col = pick.col; unit.row = pick.row;
  return { unit, from, to: { col: pick.col, row: pick.row } };
}
```

Strike loop (replaces :8318–8326):

```js
applyStrikeHP(striker, target, event);
await safeBattlePresentation(`strike ${i}`, () => this.animateStrike(event, attacker, defender, opts));
if (!isCurrentBattleSession(this, session)) return;
if (event.warpRange > 0 && event.targetHPAfter > 0) {            // was live currentHP (:8790)
  const warp = settleTeleporterWarp({ unit: target, range: event.warpRange, attacker: striker,
    grid: this.grid, getUnitAt: (c, r) => this.getUnitAt(c, r) });  // Math.random is the battle stream (:2383)
  if (warp) {
    this._refreshPostCombatMovementState([target]);               // :8714 — danger + fog/visibility model
    await safeBattlePresentation('warp', () => this._presentWarp(target, warp));
    if (!isCurrentBattleSession(this, session)) return;
  }
}
```

`_presentWarp(unit, { to })`: the old targets filter, `if (targets.length <= 0) return` before any tween, fade-out, `updateUnitPosition(unit)`, fade-in; it never writes `col`/`row`. Delete `executeWarp` (at the review base no test called it; current main later added an opacity regression, which is migrated to settlement plus `_presentWarp`; `tests/AffixCombat.test.js:117` uses `getWarpCandidates`). Settling after the strike's own animation keeps CombatChoreography's `tileDistance` and the damage-number tile right; settling before `_applyResolvedCombatPostEffects` (:8358) keeps pierce (PostCombatEffects.js:259–264), shove (:250–254) and Tier 5 splash reading the warped tile, as live play does today and every failure world now will. Combat.js ends the exchange at the warp event (:1795, :1867): one warp per combat, no later strike depends on it.

**RNG-order equivalence (fixed-v1).** The draw stays at the same logical point: after strike *i*'s animation, before event *i+1*, post-combat and the growth rolls in `applyXpGain`. Nothing between `resolveCombat` and that point draws from the battle stream: strike texts use `presentationText`/`isolateBattleTextFactory` (:2385), fx are seeded (`fxSeed`), quips use `BattleBeatsController`'s own `createSeededRng` (:44). Draw count is one iff candidates exist, identical to today whenever sprites exist; the only change is the old bug (draw, then no move when `targets` was empty, :8910 → :8918). A fixed-v1 checkpoint holding a committed attack (`_commitCombatIntent` :8379; `rngState` saved policy-independently at BattleCheckpointAdapter.js:16, restored at BattleSuspendController.js:282) has the same replay inputs across the version line. This is a compatibility argument, not an executed cross-version migration test. Round-3 tests exercise the actual JSON load, unit restore, finalize-resume and committed-attack replay on this build for both fixed-v1 and legacy-v1 Teleporter exchanges. Fixed-v1 compares the complete normalized checkpoint and gameplay/RNG state. The legacy example compares gameplay, current RNG and checkpoint state, separately pinning the differing `decisionRngState` envelope: legacy capture leaves it unchanged, whereas finalize-resume fills it from the incoming checkpoint. **Legacy-v1** retains unisolated canvas text sites, so this one shown live/resume example does not promise presentation-independent legacy cursors or general parity across versions.

Harness: `tests/harness/HeadlessBattle.js` has no warp (combat :1780–1830 goes straight to `applyCombatHP`), so nothing to delete. Optional one-liner: call `settleTeleporterWarp` for the warp event after `resolveCombat` so Teleporter enemies stop desynchronising the harness stream; PR 8 removes the duplication anyway.

## Enemy-combat parity (trap 8) and Entity splash (trap 7)

`executeEnemyCombat` shares `_runCombatResolution`, so the strike-loop boundary covers both. PR 5 adds its three guards (:10611, :10633, :10636) and telemetry in its catch (:10640). The matrix drives `executeEnemyCombat` directly, including an enemy Teleporter warped by a counter (`event.targetSide === 'attacker'`). **Entity splash belongs to #171 and is finished**: damage is applied before the guarded visuals (:10660–10693), removal is required, the per-victim `rollSplashDamage` order is already presentation-independent. PR 5 only adds an Entity scenario to the enemy matrix; PR 6 drops its "Entity splash computes RNG/damage before per-tile effects" bullet (hoisting the rolls would change the fixed-v1 stream for no gain).

## Error reporting

`src/ui/safeBattlePresentation.js:3–13` only `console.warn`s. Give it `reportAsyncError('battle_presentation_failed', error, { label, battleState, phase, turn })` (errorReporter.js:13) — add an optional `{ scene }` argument so the context fields are available; keep the `console.warn` (tests spy on it). Both combat catches (:8561, :10640) report `battle_combat_domain_error` the same way before their existing cleanup. A domain throw still reaches the catch and still keeps today's recovery (clear intent, consume action); retaining the committed intent would replay a deterministic throw on every resume, so it stays cleared.

## Guarantee 1 wording (trap 5)

Amend the spec's "and RNG": "and, for fixed-v1 battles, the RNG cursor. A legacy-v1 battle keeps the settlement draw order (hit, crit, warp, growths) but its canvas text still draws from the stream, so its cursor is compared only between live play and resume on one build." WS3 already says this; Guarantee 1 should not promise more.

## Test plan

**Infrastructure.** Lift `rendering()` from `tests/BattleCosmeticFailure.test.js:42–94` into `tests/harness/PresentationFailureProxy.js` (PR 6 reuses it) and extend it: `scene.add` is a counted surface for `text`/`image`/`rectangle`/`graphics`/`container` returning a chainable visual (the probe hit `setScale` in proc chips and `add.rectangle` in `updateAffixPips`); `_combatFx` is a counted surface with every method CombatChoreography calls (`tintUnit`, `lungeForward`, `travel`, `dodge`, `playImpact`, `playProcOverlays`, `playArtBurst`, `impactLight`, `vignettePulse`, `moteBurst`, `critImpact`, `zoomPunch`, `recoil`, `playDust`, `driftHome`, `brace`, `lungeBack`, `_later`, `playStrikeSound`, `finishStrike`, `deathFade`, `playOverlay`, `playStatus`) plus **uncounted** `_live: () => true`, `stale: () => false`, `epoch: 0` (a generic proxy makes `stale()` truthy and aborts every strike at CombatChoreography.js:105). Set `scene.scene = { isActive: () => true }` and `scene.sys = { isActive: () => true }`: otherwise `_isSceneActiveForAsync` (:882) makes `_awaitSceneTween`/`_awaitSceneDelay` (:985/:1022) never resolve and the warp hangs; a `tweens.add` returning nothing resolves at once (:1069). Add `grid.getMoveCost`/`getTerrainAt`. Use `RunDriver`+`JourneyStorage` so `_commitCombatIntent` and the resolved-action checkpoint persist (as `BattleCosmeticFailure.test.js:263–309`).

`journeyBattleScene`'s `turnManager` (JourneyBattleScene.js:43–60) is counters only; `checkBattleEnd` is `() => false` (:83), `_clearCombatRollSession` a noop (:84). Install the real `TurnManager` with `onPhaseChange: () => {}` (as :291–295) and restore `checkBattleEnd = BattleScene.prototype.checkBattleEnd`: phase transitions, victory and `completeBattleAction` become real while the enemy-phase pipeline (`onPhaseChange` :9410) deliberately does not run. The matrix proves action settlement, not the phase pipeline.

**Worlds per scenario.** baseline (shown), skipped (`_live` false), `'all'`, every nth presentation call, one timed-out tween (short `timeoutMs`), one shutdown/restart mid-strike (restart helper from `BattleSessionOwnership.test.js`). The baseline asserts `calls > 0` **and** zero `reportAsyncError` calls, or a missing proxy method silently turns it into a failed world. Compare `snapshot()` extended with positions, `_accessoryHpOwed`, xp/level/skills/stats, `hasActed`, `_pendingActionCompletion`, `_pendingCommittedAction`, `visibleSet`, remains, gold, deaths, phase, RNG cursor and the persisted checkpoint normalised (strip wall-clock timestamps only).

**Scenarios and independent expectations** (hand-derived from data, never from the code under test): plain kill (gold = 28+8 for a level-1 enemy as #171 pinned); counter kills a non-commander (deaths 1, no XP); brave/double + drain on the `debtor` unit (debt forgiven, HP 10); art HP cost + Phoenix (HP 12, `_phoenixBroochUsed`, call 1 is the art-cost bar); Thorns (striker 7); Teleporter survives (position ∈ `getWarpCandidates` max-distance set; draw count = (cursor delta ÷ 0x6d2b79f5 mod 2³², BattleRng.js:14) equals the hand count: one hit roll per strike, one crit roll per landed strike, one warp draw, nothing after the warp event because it ends the exchange at Combat.js:1795); Teleporter lethal (cursor equals the no-affix twin: a dead target ends the exchange either way and the affix roll itself draws nothing, AffixSystem.js:118–123); Teleporter boxed in (no candidates → no draw); Teleporter + Tier 2 pierce (secondary target computed from the warped tile); Deathburst chain (rewards once, 72); Tier 5 splash third-party kill + Zombie remains; poison/status beats; level-up (`veteranFixture` at 99 xp → level 15, `wrath`, one queued popup); victory (`result 'victory'`, no continuation capture); Canto confirm/Wait/Back/retap and Commander's Gambit refresh (adjacent allies `hasActed` false, BattlePresentationCheckpoint.js:101–130); enemy phase: kill, counter-kill with `survivedAttack` XP, enemy Teleporter warped by the counter, Entity splash (two 1-HP neighbours fall); one checkpoint-retry case (storage throws, `retryCheckpoint` re-persists the frozen candidate, combat not re-run).

**Planted regressions that must fail:** draw before the candidates check; write `col`/`row` inside the fade; unguard :8269; settle the warp after post-combat effects; drop the Thorns write from `applyStrikeHP`; make `safeBattlePresentation` stop reporting (telemetry assertion); unguard `checkBossHalfHealth` in the enemy path.

## Deferred

PR 6: staff, Blink, consumables, Shove/Pull/Swap, Rally, Dance, Talk, Ballista, HealAll (not Entity splash). PR 8: one outcome record computed before any presentation (warp, interim HP, post-combat, Phoenix, XP), display-HP projection in `_showStrikeResult`, harness duplication removal, the catch blocks' partial-settlement save. Out of scope: enemy-phase pipeline coverage, legacy text isolation.

## Risks

- The `_combatFx` surface must track CombatChoreography's method list; the zero-telemetry baseline assertion is the tripwire.
- `_refreshPostCombatMovementState` after a warp is a small intentional change (an enemy warping into fog hides at once); use `refreshVisibleDangerZone` alone if strict parity is preferred.
- `showXpLesson` keeps its await (a real tutorial step); a failure skips it, per the spec's cosmetic rule.
- Interim HP written before the animation is visible to a session that dies mid-strike; the pre-roll checkpoint governs resume, so nothing persists differently.

## Size

M: `AffixSystem.js` +25, `UnitHealth.js` +15, `BattleScene.js` ≈ −45/+70, `safeBattlePresentation.js` +12, optional harness +6; tests ≈ 120 (proxy) + 600–800 (matrix) + small edits to `HealthPresentationInvariance` and `AffixCombat`.


## Implementation notes

The final implementation also guards completion overlays, per-target Warp opacity
cleanup and the two inner `BattleBeatsController` rendering catches found in review.
The matrix has 23 real-entry scenarios plus 13 focused tests and exercises no-sprite
worlds as well as skipped, paused and failed presentation. Dropping only the live-HP
Teleporter gate is now an equivalent mutation because interim HP is already settled;
regressions that restore presentation-owned HP/movement are independently caught.
Latest-checkpoint-wins retry semantics are unchanged; the retry UI belongs to PR 6.


## Round-3 verification scope

The real-entry matrix gives each scenario an explicit 20-second timeout; the rest
of the suite keeps Vitest's normal timeout. The new fog scenario uses shipping
`Grid.updateFogOfWar` and `BattleScene.updateEnemyVisibility`, checks the independently
enumerated 24-tile visibility union and hidden warped defender before post-combat
effects, and compares gameplay, durable fog and fixed-v1 RNG through shown, skipped,
paused, missing-sprite, all-failed and every nth failed rendering call. A planted
removal of the warp's `_refreshPostCombatMovementState` call must fail this test even
though the later end-of-action fog refresh remains.

Same-build committed Teleporter replay is covered through `RunManager.fromJSON`,
`BattleSuspendController.applyUnits` and `finalizeResume`, and the real scheduled
attack callback. No old-build/new-build executable pair was run. Legacy presentation
parity and arbitrary cross-version resume remain unverified. Mutation results and
unit counts in this note describe local runs, not combined-branch CI.
