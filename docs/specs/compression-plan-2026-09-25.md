# Compression plan and verification audit (2026-09-25)

**Status:** plan. Step 0 is done; nothing else is implemented yet except where marked.
**Source:** an external architecture review, three read-only investigations and a fault-injection pilot, run against `main` at 74cc967 / dfb551f.
**Line references** are as of those commits. Re-verify them before starting. Since then, #93 routed the attack forecast through `BattleScene._computePlayerForecast`.

The goal is **fewer ways for code to share and repair mutable state**, not fewer files. Every step below names what disappears. Moving code into another file does not count as compression.

## Sequence

| # | Change | What disappears | Precondition |
|---|---|---|---|
| 0 | Test hygiene: fix stale browser specs, add a mechanical CI lane check, run harness/sim tests in CI (**done**, 2026-09-26; see below) | Specs that rot because nothing runs them | none |
| 1 | One definition of the resolved-action continuation | Duplicate validation of the same shape | none |
| 2 | Read-only attack forecast (equipment) | `WeaponPreviewSession.js` and the equip/restore round trip | characterisation tests first |
| 3 | Explicit gameplay RNG, one complete path at a time | The global `Math.random` install and presentation shielding wrappers | #2 settled |
| 4 | Presentation fields off domain units; equipped weapon by identity | Serialization deny-lists; `relinkWeapon` repair | #2 |
| 5 | The headless harness calls production operations as they become isolated | Mirrored orchestration in `tests/harness/HeadlessBattle.js` | alongside 2–4 |

**Serialize changes to the battle lifecycle.** Use one implementation owner at a time for `BattleScene`, checkpoints, RNG and persistence. Other agents can investigate, write independent fixtures, or review. Hold new mechanics that add persistent battle state until steps 2–4 settle.

## 0. Test hygiene (done, 2026-09-26)

**Every browser spec runs in CI.** `tests/e2e/lanes.json` is the only list of lanes; `tools/e2eLanes.js` reads it for everything else:
- the Playwright configs select their files from it (`specSelection`), so `playwright.release.config.js` and `playwright.compact.config.js` no longer keep their own lists;
- `npm run test:e2e:lane -- <lane> [playwright args]` runs one lane (`test:e2e:smoke`, `test:ux-contracts` and `test:e2e:presentation` are now lanes);
- CI's `e2e-lanes` job runs `npm run check:e2e-lanes` and turns the lanes into the `e2e` job matrix, one job per lane shard;
- `check:e2e-lanes` fails when a spec is in no lane and not in `excluded` with a reason, when a lane or exclusion names a spec that does not exist, when a spec is listed twice, or when `package.json` or a workflow names specs itself. `tests/E2eLanes.test.js` covers each rule and the real manifest.

105 specs in 11 lanes, none excluded (before: 39 specs in 5 CI steps, 66 in none). Local times are one Playwright worker on a shared 4-core container at load 5–26; CI uses two workers on a 4-vCPU runner. The existing lanes ran 1.6–2.7× faster in CI than here, so the CI column divides by 2.2.

| Lane | Specs | Tests | Shards | Local | CI (measured or estimated) |
|---|---|---|---|---|---|
| smoke | 3 | 10 | 1 | 1.4 min | 0.9 min (measured) |
| contracts (`--workers=2`) | 10 | 46 | 1 | 16.1 min | 5.9 min (measured) |
| presentation | 18 | 37 | 1 | 11.4 min | 5.0 min (measured) |
| mobile-ui | 6 | 30 | 1 | 4.9 min | 2.9 min (measured) |
| release (needs `npm run build`) | 2 | 4 | 1 | 1.3 min | 0.6 min (measured) |
| battle-input | 14 | 84 | 3 | 18.4 min | ~2.8 min per shard |
| battle-history | 5 | 16 | 1 | 8.1 min (2 workers) | ~4 min |
| art | 14 | 80 | 2 | 19.0 min | ~4.3 min per shard |
| run-flow | 21 | 87 | 3 | 23.3 min | ~3.5 min per shard |
| menus | 11 | 59 | 2 | 14.1 min | ~3.2 min per shard |
| compact (`playwright.compact.config.js`, 2 device profiles) | 1 | 10 | 1 | 2.1 min | ~1 min |

In total about 2 h of browser time locally and about 55 min in CI, spread over 17 jobs. Each job also spends about 50 s on checkout, `npm ci` and the browser install. The longest job is `contracts` (about 7 min), so the e2e wall clock drops from about 16 min (one serial job) to about 7 min.

**Unit-level suites.** The `harness` job now runs `npm run test:sim` (all 8 files, 35 tests, about 11–18 s) and `npm run test:harness` (all 10 files, 165 tests, about 23–36 s) instead of the `test:sim:triage` and `test:journey` subsets. Both are fast enough to stay in that job. `RunSimulationDriver.test.js` failed on main because its fixture cloned a living unit's `unitUid` into the fallen list; since #98, battle entry gives the later holder of a shared uid a fresh one. The fixture now gives the casualty its own uid; the driver was right.

**What had rotted.** 21 of the 66 unrun specs (38 tests) failed. Each was traced to the change that caused it:
- Stale:
  - #64: terrain card text; Danger on the command rail; rotate prompt on portrait phones.
  - #67: focus colour; promotion chooser labels; the DOM Title; the run-end card before the result menu.
  - #77: target-first attacks; the equipped badge in item headings; equip-row geometry.
  - #78: "Level n" unit rows; the move reminder hidden on short screens.
  - #79: draft cards for mercenaries and boss recruits; reward drafts saved across a reload.
  - #44: the first-run fast path. `journey-run-loop` was rewritten for the DOM menus.
  - Elite reward picks on the persisted record.
- Racy:
  - Gamepad taps. The shared `padTap()` now holds a button for exactly one reader poll.
  - The first turn's `TURN_START_RESOLVING`.
  - A ceremony's own reveal clock.
  - A guidance note's self-dismiss.
  - Real download progress overwriting emulated progress.
  - The unlock-started music.
  - A floater wait bounded in wall time instead of game time.

**One real bug, fixed.** A save slot tapped within 350 ms of the picker appearing was silently dropped: `SlotPickerScene.selectSlot` did not retry the router's cooldown BLOCKED. The regression test in `slot-picker.spec.js` fails without the fix.

**Also:** `E2E_PORT` gives a checkout its own dev server, since `reuseExistingServer` on a shared port 3000 silently tests another worktree's code. The portrait-variety specs no longer overwrite committed doc screenshots unless `PORTRAIT_SHOTS` is set, like the other art specs.

## 1. Resolved-action continuation (small)

The same continuation shape `{kind, unitId, unitName, skipCanto?, gambitTriggered?}` is validated twice:

- `readActionContinuation` in `src/ui/BattlePresentationCheckpoint.js`. It returns a normalized copy or null. It has no `unitName` length cap, and a failure silently falls through on resume.
- The `pendingActionCompletion` block in `src/engine/BattleStateSnapshot.js` (`validateBattleState`). It returns a boolean and caps `unitName` at 8192 via `text()`. A failure rejects the whole state, which makes recovery invalid, rejects the rewind target and drops the timeline entry.

They are otherwise identical: the same `kind` set, trim check, `unitId` rejection and optional booleans.

**Plan:**
- Create a pure `src/engine/ActionContinuation.js` exporting `readActionContinuation(value) → normalized | null` with the 8192 cap.
- Both callers use it. `BattlePresentationCheckpoint` re-exports it (ui → engine is allowed; engine never imports ui).
- Each caller keeps its own failure policy.
- Adopting the cap everywhere breaks no legacy save, because the engine validator already gates every v2 suspend checkpoint first (`RunManager` recovery).

**Optional in the same change:** export `isBattleEntityId` from `BattleEntityIdentity.js`. The `/^u[1-9]\d*$/` regex is repeated about 10 times.

**Found in passing:** `validateBattleState` never checks `pendingCommittedAction`; only `readCommittedAction` guards it.

## 2. Read-only attack forecast (equipment)

**Today:** previewing a weapon equips it on the live unit, and cancel restores the baseline weapon and bag order (`src/ui/WeaponPreviewSession.js`). The forecast then reads `attacker.weapon`.

**The goal:** opening, cycling, switching target, cancelling, pressing Back, force End Turn and deselecting leave `unit.weapon`, inventory identity and inventory order unchanged. Equipping happens only on confirm.

**The naive version breaks forecast numbers.** Passing the candidate weapon to the forecast is not enough. Two skill-mod reads use the equipped weapon implicitly:

- `SkillSystem.getSkillCombatMods`: `getConditionalWeaponBonuses(unit.weapon…)`, the Doublebow-style bonus.
- The `_grantedSkill` passive of the equipped weapon.

Both need a `context.weapon` override threaded through `buildSkillCtx`. Without it, the forecast shows the equipped weapon's bonus instead of the candidate's, and no existing test would notice.

**Mutation sites to remove:**
- `beginWeaponPreview`: on attack start and when the forecast shows.
- `resetWeaponPreview`: on forecast open, target switch and cancel.
- `equipForAttackPlanning(chosen)`: on open, weapon cycle and target switch. It becomes `scene._forecastWeapon = chosen`, which is cleared in `hideForecast`.
- The weapon-art getter `_getSelectedWeaponArtForUnit` equips as a side effect. Make it pure.
- `WeaponArtController`: picking an art row equips its weapon. Delete that.
- The Weapon Art menu auto-equips a combat weapon over a staff (`showAutoSwitchTooltip`). Delete it. **This needs a UX decision:** the tooltip would no longer be true.
- `showActionMenu` → `restoreWeaponPreview` also **clears the selected weapon art**. Replace it with an explicit `_clearSelectedWeaponArt()`.
- `forceEndTurn` and `deselectUnit` restores: delete them (the art is already cleared there).
- Confirm (`commitWeaponPreview` → `normalizeEquippedFirst`): becomes `equipWeapon(unit, planned)` with the default reorder.

**Confirm must:**
1. Run the silence guard on the planned weapon.
2. Abort to the action menu if the planned weapon is no longer carried or can't be equipped. `equipWeapon` fails silently, so without this guard the attack would go ahead with the old weapon.
3. Resolve the art entry, then equip.
4. Keep re-setting the art with the post-reorder index.
5. Keep the art-weapon equip in `executeCombat` after `_commitCombatIntent`, behind an explicit option, so `resumeCommittedAttack` behaves as today.

**Unchanged:**
- The roll-session key has no weapon in it, so Gambler rolls are reused.
- In fixed-v1 the forecast draws no gameplay RNG.
- In legacy-v1 the Gambler forecast roll and canvas `ForecastOverlay` text do draw `Math.random`. That is by design and recorded in the committed intent. Don't "fix" it here.
- Never stamp item uids during the forecast: `generateItemUid` calls `Math.random`.

**Display reads to move to the plan:**
- `ForecastOverlay`'s attacker side (name, forged colour, [E] badge, stepper, next-weapon hint).
- `MobileBattleHUD`'s forecast side and ◀ ▶ stepper.
- `AttackFlowController`'s cycle index.
- The HUD summary and the roster overlay (openable during the forecast) will now show the committed weapon. That is an intended behaviour change.

**Out of scope, still mutating:**
- `_buildForecastSkillCtx` temporarily changes HP, stats, `mov`, the Phoenix flag and timed art buffs, then restores them in a `finally`.
- `HealController` provisionally equips a staff.

Both are follow-up candidates. So this step makes the forecast read-only **for equipment**.

**Tests, written first:**
- **Characterisation, passing before and after:**
  - The sequence open → cycle → switch target → switch back → cycle → confirm produces the same `unit.weapon`, inventory uid order, `_pendingCommittedAction`, `equippedInventoryIndex`, roll-session key and `resolveCombat` result.
  - Doublebow and `_grantedSkill` forecast parity.
  - A weapon art on a non-equipped duplicate weapon, without uids.
  - The legacy-v1 Gambler draw count.
- **New contract, failing before and passing after:** every preview interaction leaves equipment and bag order untouched, and fixed-v1 makes no `Math.random` call.
- **Browser:** a variant of `combat-refresh-commit.spec.js` that cycles to a non-default weapon, then checks the stored checkpoint and the resumed replay.
- **Tests to rewrite:** `AttackFlowController.test.js` asserts the mutation itself. `BattleWeaponArts.test.js` asserts the getter equips. `e2e/forecast-input-contract.spec.js` asserts `selectedUnit.weapon.name` changes.
- **Carry over three `WeaponPreviewSession.test.js` cases.** The pilot found they are the only tests catching three realistic bugs (see below).

**Size:** about 100 source lines deleted (the whole of `WeaponPreviewSession.js`, plus imports and call sites) and about 40 added. The value is correctness, not size.

## 3. Explicit gameplay RNG (series)

Battle execution installs the battle RNG as global `Math.random`. `src/utils/presentationRandom.js` and `presentationText.js` then shield rendering from it.

**Target invariant:** only gameplay operations holding the RNG can advance it, and rendering never receives it.

**How to migrate:**
- Go one complete path at a time, including nested skill and affix draws.
- Keep the generator, the saved cursor and the draw order.
- Keep legacy-v1 behaviour behind an explicit compatibility policy.
- Lint-ban ambient randomness in each path once it is migrated.

**Acceptance test pattern:** identical saved state plus identical commands must give an identical domain state and RNG cursor, across animation speed, reduced motion, history viewing, forecast opening and presentation switches. `tests/e2e/portrait-battle.spec.js` ("does not change how the battle plays out"; in PR #99, not yet merged) is a working example of this differential test through the real resume path.

## Verification audit

**CI lanes** (`ci.yml` is the only workflow that runs tests, on push/PR to `main`; `testflight.yml` only builds the iOS app):
- 60 of 99 `tests/e2e` specs were in no lane (66 of 105 on 2026-09-26).
- 7 of 10 `tests/harness/*.test.js` files and 6 of 8 `tests/sim/*.test.js` files never ran. `npm run test:e2e`, `test:harness` and `test:sim` existed but CI did not call them. (Since step 0, every spec and every harness/sim file runs in CI.)
- The 8 browser failures seen locally were all stale or racy tests in unrun specs:
  - #78 changed the command rail;
  - #64 changed the terrain card;
  - #77 made attacks target-first;
  - #67 moved the Title to the DOM;
  - a gamepad `tap()` races the 250 ms auto-repeat under load.
- Step 0 fixed these and added `npm run check:e2e-lanes` (see "0. Test hygiene").

**What the headless harness proves:** `HeadlessBattle` calls real engine modules (combat, AI, skills, loot and so on) but mirrors `BattleScene`'s state machine, with `CANTO_DISABLED = true`. It has no async presentation and no checkpoint/resume. A green harness run proves engine resolution for the scenarios it exercises. It does not prove the production action lifecycle; the Journey tests and e2e cover that.

**Fault-injection pilot** (65 hand-made realistic mutants across 4 modules, 63 valid):

| Module | Caught by own tests | Caught by whole unit suite |
|---|---|---|
| `Combat.js` | 6/17 | 12/17 |
| Battle snapshot persistence | 6/16 | 8/16 |
| `WeaponPreviewSession` + `AttackFlowController` | 8/17 | 8/17 |
| `LootScreenController` | 1/13 | 6/13 |
| **Total** | 21/63 | **32/63** |

**About half of realistic bugs survive all ~7,000 unit tests.** The bigger problem is gaps, not surplus tests. Survivors worth a test:

- **Combat:**
  - crit uses ceil instead of floor on SKL/2;
  - weight uses ceil instead of floor on STR/5 (every test uses STR values that are multiples of 5);
  - Gae Bolg's +5 is inverted;
  - healing on hit can exceed max HP;
  - full 3× crit damage against the Entity gets through (the Entity crit tests at `Combat.test.js:2508-2559` are vacuous).
- **Snapshot validator boundaries:**
  - `turnNumber` 0;
  - no upper bound on `rngSeed`;
  - `pendingVisionSnapshot` missing from the forbidden keys;
  - no `currentHP` check;
  - row equal to the map height, column equal to the width;
  - a `sourceRef` index equal to the length;
  - `turnPar` dropped from the capture (possibly recomputed on resume; unverified).
- **Forecast:**
  - `restoreOrder` drops an item added mid-preview;
  - switching target keeps the previewed weapon (the fixture has one target);
  - held Enter confirms the attack;
  - canvas keys are handled while the phone forecast is open.
- **Loot:**
  - **a weapon given to a unit is never added to its inventory;**
  - team XP from a gold card is never granted;
  - gold rewards are not marked claimed (double award);
  - rewards stay available while loot is resolving;
  - the inventory-full check is off by one (items and consumables);
  - a scroll reward is never stored.

**Classification of the 101 sampled tests:** A 60 (contract/spec), B 14 (pinned past bug), C 14 (restates the implementation), D 13 (tautological/data shape).

- C and D are about a quarter of the sample (27/101). The estimate across the suite is 15–25%, concentrated in UI and scene tests.
- 41 of 429 test files are more than half mock-call assertions.
- The LootScreenController C tests caught zero mutants. They mock `addToInventory` and `applyStatBoost` and never assert on them.
- **But a mock-call assertion was once the only catch** (`_clearSelectedWeaponArt`).
- **11 of the 32 catches came from other modules' test files.**

So a blanket "delete low-signal tests" pass is not safe.

**Procedure for deleting or rewriting tests:**
1. Rewrite C tests as assertions on outcomes: player-visible or persisted state.
2. Delete D tests only where `validate:data` or a contract test already guards the fact.
3. Before deleting a test file, remove it, re-run its module's mutants, and delete only if the survivor set does not grow.
4. **Engine:** Stryker (`@stryker-mutator/core` + vitest runner, `coverageAnalysis: "perTest"`, incremental). Rough cost: `Combat.js` 30–60 min; all of `src/engine` overnight; a changed-files PR gate takes minutes.
5. **UI controllers:** a hand-mutation script, about 10 s per mutant against focused tests.

## Rules for new tests (summary; also in CLAUDE.md)

- Before writing a test, list the realistic ways the change could fail. Each test should name the regression it would catch.
- Assert on outcomes (what the player sees, persisted state, RNG cursor), not on internal call sequences. Use a mock-call assertion only when the call *is* the observable effect.
- Derive expected values independently (hand-computed fixtures), never by re-running the code under test.
- Before a refactor, pin today's behaviour with characterisation tests that must pass before and after. A bug fix gets a test that fails before the fix.
- Prove a new test can fail: plant the bug once and watch it fail.
- Every e2e spec belongs to a CI lane or is listed with a reason: add it to `tests/e2e/lanes.json`. `npm run check:e2e-lanes` (in CI) fails otherwise.
