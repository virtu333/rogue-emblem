# Battlefield rewind release review — September 21, 2026

## Decision

No remaining reproducible regression attributable to the new rewind work was found after the fixes below. Proceed with the authorized TestFlight beta; this is not a green full-browser-suite or physical-device certification. Physical iPhone gestures, background/resume, existing-save upgrade and long-history performance remain beta acceptance checks.

## Findings addressed

- **P1 — History rendering consumed gameplay RNG.** The new historical scene used Phaser `add.text` outside the battle scene’s protected text factory. Opening a history frame containing a status label changed the battle RNG cursor while leaving the save and units unchanged. The new browser regression failed before the fix and passed afterward. All historical renderer text now uses `presentationText`, including conditions, buffs, affixes, object markers, missing-art labels and animated HP changes. The test checks live RNG/save/unit equality before opening, after drawing labels, after an animated HP cue and after closing.
- **P2 — End-turn default focus changed in the recent locator patch.** Inserting “Show [unit]” before “Keep playing” changed the safe default keyboard/controller target. Keep playing is first again. Both escape-map sizes and the locator/confirmation cases pass.
- **Test drift — Canto fixture assumed 20 HP.** Starting traits can raise Edric’s maximum HP. The test now compares the healed checkpoint with the actual maximum; it still verifies one consumable use, one checkpoint and one village reward.
- **Test drift — older mobile fixtures.** Enabled touch explicitly for compact roster tests; title tests select Compendium/Save Slots by label instead of menu index; battlefield tests follow the initial action menu, then Back to movement selection and Back to idle, and use current terrain wording. Assertions still verify movement, cancellation, inspection, terrain preservation and input isolation.

## Review scope

Read the projection/codec, observation hooks, archive retention/hydration/branching, history renderer and session lifecycle, DOM navigation and durable rewind handoff. Inspected map screenshots at base and phone dimensions. Focused coverage includes hidden routes/terrain, interleaved actions and reload, post-commit failure, zero charges, fatal/report review, camera restoration, rapid scrubbing, 50 open/close cycles and RNG neutrality. No gameplay policy, enemy-action rewind eligibility, charge economy or fog rules were changed by this review.

## Verification

- 5,681 unit tests across 339 files passed; 238 timeline tests across 10 files passed (overlap with unit/harness counts).
- 165 harness tests passed; all four PR simulation slices passed.
- 14 final rewind/battle browser contracts passed, including the new RNG regression.
- 27 distinct corrected battlefield/roster/title cases passed (9 in the initial correction run plus all 18 battlefield cases in the final run).
- Four end-turn/escape/locator checks and two isolated input checks passed.
- Production offline mobile smoke passed in WebKit (fresh startup, battle, compact layout and Compendium; external requests blocked). The initial attempt could not launch because WebKit was not installed; installing the official Playwright runtime resolved it.
- Production build, data schema/parity checks passed. Changed JavaScript lint: zero errors, 47 existing warnings.
- Browser checks were muted and headless, with isolated test profiles. Physical-device testing was not performed.

## Full browser gate disposition

The fresh broad run completed with **216 passed, 53 failed, one skipped**, without retries. It started before the review fixes; final focused runs above supersede the affected cases. A clean archive of shipped commit `fc2609c` reproduced 47 of the 53 failures. Four failures were the corrected Canto/escape cases. The two remaining input cases (L1/R1 cursor cycling and Equip click) passed on an isolated rerun; their original broad-run failures remain recorded as intermittent, not silently counted as first-pass successes.

After the verified fixture corrections, **25 broad-suite failures remain unresolved**. They reproduce on the shipped baseline, but that alone does not prove each is harmless test drift. They are retained as test/product triage debt, not labeled fixed. The full suite was not repeated after all narrow corrections.

| Remaining test file | Case |
| --- | --- |
| accessory-ui.spec.js | shop scroll/accessory purchases show correct pool banners |
| gamepad-menus.spec.js | DifficultySelect <-> BlessingSelect via pad NAVIGATE/CONFIRM/CANCEL |
| journey-contracts.spec.js | controller reaches Compendium filters, long details and close |
| journey-contracts.spec.js | controller reaches difficulty secondary actions and detail scrolling on phone |
| journey-contracts.spec.js | HP persistence hint waits for the first battle and shows only once |
| journey-run-loop.spec.js | Title -> HomeBase -> Difficulty -> Blessing -> NodeMap -> Battle -> Title |
| management-contracts.spec.js | zero-weight reward is blocked without claiming, and a useful stat remains selectable |
| mobile-run-loop.spec.js | touch run: loadout, battle action, rewards, shop, equipment, next battle and local resume |
| mobile-viewport.spec.js | Title scene within safe y-bounds |
| mobile-viewport.spec.js | Mobile button containment and tap routing in Battle |
| native-rewards.spec.js | native weapon reward supports Back, guarded apply and elite continuation |
| native-rewards.spec.js | native forge reward supports Back, guarded apply and elite continuation |
| native-rewards.spec.js | native imbue reward supports Back, guarded apply and elite continuation |
| native-rewards.spec.js | native booster reward supports Back, guarded apply and elite continuation |
| native-rewards.spec.js | native consumable reward supports Back, guarded apply and elite continuation |
| native-rewards.spec.js | native convoy reward supports Back, guarded apply and elite continuation |
| playtest-followups.spec.js | enemy combat pauses for its level-up and has a durable enemy checkpoint |
| reload-contracts.spec.js | reclass UI save reload deploy preserves learned skill, spent seal and usable equipment identity |
| reward-menu.spec.js | reward submenu can consult Compendium, resume, and safely cancel leaving |
| reward-reload.spec.js | reload mid-forge preserves completed battle and forfeits unclaimed loot without duplicate award |
| run-recovery.spec.js | run result is readable, rotates, and exits without destroyed-text repaint |
| ui-review-regressions.spec.js | setup owns keyboard/gamepad actions and initially confirms forward |
| ui-review-regressions.spec.js | reference shortcuts and compact backdrop preserve input ownership |
| weapon-selection.spec.js | weapon picker - pointerdown selects weapon and enters target selection |
| weapon-selection.spec.js | equip menu - pointerdown selects weapon and returns to action menu |

Evidence logs: `/tmp/release-review-browser.log`, `/tmp/release-review-browser.json`, `/tmp/release-baseline-browser.log`, `/tmp/release-baseline-first.json`, `/tmp/release-baseline-remaining.log`, `/tmp/release-baseline-second.json`, `/tmp/release-rng-browser.log` (original reproduction), `/tmp/release-rng-fixed.log`, `/tmp/release-final-timeline-browser.log`, `/tmp/release-locator-fixed.log`, `/tmp/release-fixture-corrections.log`, `/tmp/release-fixture-final.log`, `/tmp/release-race-browser.log`.
