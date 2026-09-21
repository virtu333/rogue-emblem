# Player-expectation audit — September 20, 2026

Baseline: TestFlight build 9 source. This is an investigation and implementation plan; **no application source changes or new TestFlight release** were made in this pass. Three independent code reviews covered journey/setup/references, combat, and roster/services/rewards. Root validated findings through visible in-app browser navigation and isolated headed Chromium probes. Existing player saves were not altered by fixtures.

Implementation follow-up: [ux-contract-implementation.md](ux-contract-implementation.md). The evidence and baseline findings below are preserved as the pre-fix audit.

## What the interface should promise

1. **One action, one result.** A completed trade commits movement; cancel cannot mint another movement allowance. Canto finishes the same reward/save obligations as any other action.
2. **Back reverses navigation, not committed gameplay.** It returns exactly one step and retains unit, tab, selection and scroll. Focus remains on a usable control.
3. **Rewind returns to a coherent playable turn.** Units, inventory references, automatic effects, terrain and danger display agree. Saving/loading cannot change these rules.
4. **Before confirming, the consequence is visible.** Costs, actual benefits, changed weapons/skills, full bags and skill-cap losses are explicit. A paid no-op is unavailable.
5. **Information is reachable on the current device.** Touch help teaches touch; every control and long description is reachable by keyboard/controller. Search finds information without requiring prior knowledge of its category.
6. **Feedback survives long enough to be understood.** Show what changed, why an action is blocked, and what to do next. Use canonical game data for explanations.

## Verified correctness findings — fix first

### C1. Repeated movement after a committed trade

**Evidence: live in-app browser, 667×375, real map taps/buttons.** In `combat_actions`, move Edric (3,3) → (2,2); Trade Vulnerary to adjacent Sera; Done; open Trade and Back; Back to idle; reselect Edric; Back again; tap (6,2). Edric executes another four-tile move in the same turn. The initial reselection alone shows a misleading blue range but does not allow movement on phone; the additional Back is necessary for the demonstrated bypass.

Cause: `BattleScene.showActionMenu` resets `tradeMutatedThisSession`; reselect sets a new `preMoveLoc`; `undoMove` resets `hasMoved`. Sources: `src/scenes/BattleScene.js:5789,6126`; `src/ui/InputController.js:363,378,453`.

**Expected fix:** Keep movement/action commitment on the unit/turn, independently of which submenu is open. Reselection may expose remaining actions, never a fresh movement budget. Regression must drive the complete trade → submenu → Back → reselect → Back sequence on touch and desktop; assert position, movement spent, inventory and action state.

### C2. Canto completion bypasses village and save hooks

**Evidence: headed phone browser with synthetic Canto/village setup and real Item → Vulnerary → Back actions.** The unit became acted and returned to PLAYER_IDLE, but the village remained intact, checkpoint stayed at 1 and the save hook ran zero times. The control path without Canto invokes both hooks.

**Important correction:** Wait intentionally skips Canto and does claim a village. The demonstrated issue requires an action that actually enters Canto. Actual reload loss was not separately executed; missing checkpoint was measured directly.

Sources: `src/scenes/BattleScene.js:4752–4778,5442,5564`. **Expected fix:** One shared action-finalization path for ordinary completion, Canto skip, and Canto movement. Run village effects and save exactly once, after the final location is settled; preserve async reward ownership and turn ordering. Test all three completion paths, then resume the resulting save.

### C3. Rewind removes resolved turn-start healing

**Evidence: headed phone browser.** On turn 2, Renewal healed Sera 10→15 and aura healing raised Patient 13→16. After Edric Wait → Rewind confirmation, turn remained 2 but HP reverted to 10 and 13; a rewind charge was consumed. No runtime errors occurred.

Cause: snapshot capture precedes turn-start effects; restore goes straight to PLAYER_IDLE. Sources: `src/scenes/BattleScene.js:9196,9207`; `src/ui/VisionRewindController.js:252`.

**Expected fix:** Define the rewind boundary as the point where the player first receives control, with automatic effects resolved. Preserve existing deferred snapshot-commit semantics and lifecycle guards. Test healing, damage, death/victory from automatic effects, and no duplicate effect/RNG consumption.

### C4. Saved rewind snapshots lose equipped-item identity

**Evidence: real-controller/engine probe through JSON save round trip.** Resume-like snapshot loading → rewind → trade equipped Iron Sword: donor inventory becomes empty, recipient owns the sword, but donor.weapon still points to a detached sword and `canCounter` returns true.

Sources: `VisionRewindController.js:197`, `BattleSuspendController.js:184`, `UnitManager.js:1409` (all under `src/ui/` except UnitManager under `src/engine/`). **Expected fix:** Reuse canonical unit hydration/relinking for every restored unit, including nested rewind snapshots. Test save → load → rewind → trade/equip/remove, including duplicate-name items with distinct forges/arts.

### C5. Rewind omits terrain, threat-cache and casualty state

**Evidence: source trace plus real-controller probes; not a complete browser reproduction for these subcases.** Restoring units does not invalidate `dangerZoneStale`; old danger overlays can remain after enemy positions change. Temporary terrain and owner references, hybrid terrain state and `_playerDeathsThisBattle` are not restored. Consequences include obsolete threat information, walls surviving/restoring incorrectly, and an inflated recruitment-cap calculation after undoing a death.

Sources: `src/ui/VisionRewindController.js:195–252`; `src/scenes/BattleScene.js:4000,5874`; Grid temporary-terrain ownership. No separate reinforcement-scheduler defect was established—the scheduler is stateless.

**Expected fix:** Enumerate the full battle snapshot contract, restore stable IDs/references, rebuild derived overlays after restore, and test fog/no-fog, broken temporary walls, Waller death and revived-unit recruitment capacity. Group this with C3/C4; do not fix only visible HP.

### C6. Zero-weight forging spends resources for no benefit

**Evidence: headed shop browser.** With a zero-weight Iron Sword, “−1 Weight” is enabled; Confirm reduces gold 10000→9750 and increments forge level to 1 while weight stays 0. Engine reproduction also confirms it. A natural case is Lightning after its first weight reduction. Reward/whetstone paths share eligibility.

Sources: `src/engine/ForgeSystem.js:86`, `ShopCommands.js:129`. **Expected fix:** Engine rejects weight forging at zero. UI says “Already at minimum weight”; no gold, item, reward choice, forge allowance or level is consumed. Test shop and reward routes plus other still-valid stats.

### C7. Reclass may leave a unit unarmed and silently omit new skills

**Evidence: real command/serialization probes.** Fighter→Myrmidon clears the invalid axe, then grants Iron Sword without equipping it; `weapon:null` survives relinking. A capped-skill Warrior→Hero consumes the seal but does not learn Vigilance and returns no dropped-skill notice.

Sources: `src/engine/RosterCommands.js:105–121`; `UnitManager.js:1302–1314`. **Expected fix:** After grants, preserve any existing valid equipped weapon and select a usable combat weapon only if none remains; explicitly warn when impossible. Repair the class-change outcome rather than changing general null-equipment hydration semantics. Collect/report genuinely omitted skill grants (such as at_cap), excluding already_known deduplication, using the promotion pattern. Cover full bag, no valid weapon, skill cap, already-known skills and save/deploy after reclass. Do not silently change the underlying skill-cap rule.

## Navigation and comprehension findings

| ID | Finding / evidence | Recommended change |
|---|---|---|
| N1 | **Home Base loses focus after assigning/removing starting skills.** Headed browser confirmed BODY focus both times. Rapid Enter→Escape after removal reached Title, skipping the intended Skills→Lords stop. Phaser queue replay reproduced independently explains how one ESC can be delivered twice; exact browser queue instrumentation remains follow-up. `MobileHomeBase.js:253–286,320–323`. | Focus Remove after assign; skill choice after remove; stable tab/root fallback. Keep DOM-owned keyboard input away from legacy scene ESC. Test rapid and held keys as well as ordinary navigation. Do not describe Escape as simply dead. |
| N2 | **Controller cannot reach Compendium filters or Army upgrades toggle.** Complete source routing trace; headed action-bus DANGER left Army upgrades On. Reference actions navigate only categories/entries. `ReferenceMenu.js:41–50`; `RunSetupMenu.js:29–36`. | Define controller regions/control traversal, including filters, secondary actions and scrollable details; show bindings where needed. Assert actual value/filter changes, not just movement of a legacy cursor. |
| N3 | **Mobile Help teaches desktop keys.** Live How to play → Combat Basics says “Press D”; Help providers discard existing mobile text/title variants. `HelpOverlay.js:54–56`; `HowToPlayOverlay.js:35–40`. | Resolve input-specific copy through the existing content helpers. Verify the DOM-rendered result on phone and desktop. |
| N4 | **Search Help only searches the current category.** Live/headed `Par` on Stats reports no results; switching Goals reveals Battle Objectives. Legacy Help global search was broader. `ReferenceMenu.js:122–125`. | Search all Help categories with category labels. Preserve selection and return behavior when clearing search; distinguish any intentional category filters in Compendium. |
| N5 | **HP-persistence hint is consumed at zero battles.** Real HintManager probe: hint never appears at 0,1,2 battles because `shouldShow` marks it before eligibility is checked. `NodeMapScene.js:253–254`. | Check eligibility first, then mark seen when presented. Test first map→first victory→second victory. Correct obsolete “Rest” node wording against actual node types. |
| N6 | **Promotion/reclass preview contains mostly flavor.** Source-confirmed roster chooser lacks the stats/proficiencies/skills comparison already used in Church. `MobileRosterSheet.js:565`. | Shared before/after preview with weapon changes, growth changes/reroll behavior, skill-cap omissions and seal/resource consumption. Provide this before confirmation. |
| N7 | **Weapon-art replacement has no stepwise Back or old/new effect comparison.** Close/Escape exits the workflow rather than returning to weapon/art choice. `MobileRosterSheet.js:440,493`. | Retain a small step stack; explain what will be replaced. Cancel consumes nothing, Back preserves choices and focus. |
| N8 | **Revival omits the 1 HP result.** Confirmation/success discuss convoy gear but not healing needed. `ChurchMenu.js:74`; `ChurchCommands.js:50`. | Say “Returns with 1 HP”; provide a clear path to heal and re-equip. |
| N9 | **Mastery and weapon-art detail remain underspecified.** Live roster still shows mastery `0/8` without units/reward and art flavor/HP cost without full numerical effects. | Implement the existing `docs/contextual-help-review.md`: critical facts inline, deeper help on tap, canonical values, no gameplay action from help. |
| N10 | **Lunatic results can show Act reached 5 / 4.** Source/data verified; denominator is hard-coded. `RunFlowMenus.js:22`, `RunCompleteScene.js:122`. | Use the active run's act sequence; test every difficulty's final stage. |

## Why existing tests miss these

- Single-screen success assertions miss sequences: trade→Back→reselect, save→rewind→trade, class change→deployment.
- Tests assert a command succeeded, not whether a meaningful benefit occurred or whether the unit is ready afterward.
- Some tests still exercise legacy canvas implementations. `journey-run-loop.spec.js:245` expects a fresh slot to go through Home Base, while the shipping first-run flow goes directly to NodeMap. Existing Help global-search tests do not render the DOM Help.
- Harness village completion is not the shipping Canto completion path. Phase tests check that snapshot capture happened, not that it contains the playable turn-start state.
- “No console errors” and “no overflow” are necessary but cannot detect wrong HP, wasted gold, false threat shading or missing information.

## Proposed implementation order

1. **Action/rewind integrity (C1–C5).** Add failing reproductions first. Centralize finalization, commitment and hydration contracts. Review independently before release; these affect gameplay and saved battle state.
2. **Safe management outcomes (C6–C7, N6–N8).** Engine eligibility/result fixes, shared decision previews, reversible step navigation. No content/balance changes beyond rejecting unintended no-ops.
3. **Navigation and discoverability (N1–N5, N9–N10).** Stable focus, complete controller routes, correct help/search/hints and contextual explanations.
4. **Combined adversarial journey, then TestFlight.** Fresh and returning save; actual selection/move/attack/item/heal/trade/art/Canto; reward→shop→roster→next battle; suspend/reload/rewind; keyboard/controller and small-phone touch. Run existing required gates after targeted contracts pass. Keep cleanup/refactor work separate.

For each operation, verify: eligibility reason → preview → cancel with no mutation → confirm exactly once → usable focus and correct next screen → save/resume equivalence. Add empty/one/full lists, capped skills, no compatible weapons, HP boundaries and long names. Use focused pairwise combinations rather than trying an unbounded Cartesian product.

## Evidence and limits

Artifacts and temporary reproduction scripts are copied into `docs/reviews/ux-contract-audit-2026-09-20/`. They are diagnostic fixtures, not permanent green regression tests; convert them to assertions of corrected behavior when implementing. Scripts currently contain the local repo path/localhost URL. Initial probes had stale selectors and were corrected before the completed evidence run.

Completed isolated browser evidence recorded **zero page errors** while reproducing multiple product defects. Visible in-app review also covered title/help, battle movement/trading/cancellation, roster Stats/Skills and Help search. Synthetic setups supplied Canto, village, wounded Renewal units and a zero-weight weapon; action execution used real controls. These are not claims of natural-campaign balance testing, physical iOS validation, or exhaustive coverage of every possible input timing. No new release was uploaded.
