# Combat actions browser review — 2026-09-20

## Replay

Start `npm run dev`, then open:

http://localhost:3000/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1

Reload resets the synthetic encounter. The development-only route clears its active save-slot association before creating the encounter, so combat checkpoints do not write into an existing player slot. The normal deployment cap is used (Act 2 allows five units); this is deliberately not an early-game balance scenario.

The fixed 10×8 map has a nearby Knight and Fighter, a distant Archer to keep the encounter open, clear relocation spaces, and a water obstruction. All actions run through normal engine rules and controllers.

| Unit | Review actions |
| --- | --- |
| Edric | Iron Sword with Wrath Strike and Dueling Blade; adjacent Knight for forecast and combat |
| Sera | Lightning, Heal, Restore, Rescue Staff, Warp Staff; Staff Mast for this fixture |
| Utility | Blink, Rally Cry, Healing Circle, Ensnare (synthetic Mage loadout) |
| Support | Dance, Shove, Pull (synthetic Dancer loadout) |
| Patient | Injured Fighter for healing, relocation, and refresh tests |

For Dance, have Patient Wait first. For Pull, target Edric north of Support: the space behind Support is free. For Restore, the automated fixture adds poison before selecting the staff; other actions need no state injection. The low-HP test likewise sets an affordability boundary before using normal UI controls.

## Confirmed issues and changes

### Cancelled staff targeting left the staff equipped

Reproduced manually in the visible browser and in a failing regression: Sera → Heal → Heal staff → Back showed `Light Sage · Heal`, and Wait retained that non-combat weapon. This could remove normal counterattacks despite the previous fix for *completed* healing.

Abandoning healing or staff-ally targeting now restores a usable combat weapon through HealController's existing shared logic. Back from a relocation destination to ally selection keeps the staff, since that action is still in progress. A stale staff choice with no targets also restores the combat weapon. This applies to all staff users; it does not give staff-only units a new weapon or an extra action.

### Ability and weapon-art effects depended on hover/long press

The mobile list showed names and costs but omitted the effect descriptions carried by canvas tooltips. Registered action-menu entries now expose their existing description to the DOM HUD. Skill, weapon-art, and staff rows show those descriptions directly. No balance/content values changed.

## Verification

- 15 new headed Chromium tests at iPhone SE landscape (667×375), plus 8 existing battle-submenu tests: **23 passed**.
- 162 targeted unit tests passed: dev startup, action abilities, weapon-art controller, staff defense/relocation, input routing, and mobile controls.
- Targeted ESLint: zero errors; existing warnings remain in BattleScene. `git diff --check` passes.
- Manual visible in-app-browser inspection at 844×390: skill descriptions, Blink targeting/completion, staff descriptions, and staff cancellation before/after the fix.
- Browser tests capture page errors and require an empty error list. Tests use real touch controls for selections, targeting, confirmations, and completion; game state is read for assertions. Synthetic poison/HP/usage setup is explicitly marked in the spec.

Covered: Wrath Strike forecast cancellation and committed usage; Healing Circle HP restoration; Rally timed buffs; Ensnare root; Blink rejecting an occupied target and completing a valid teleport; Shove/Pull; healing and combat-weapon restoration; Warp/Rescue destination cancellation and exactly one spent use; Dance; Restore; low-HP/exhaustion explanations; staff cancellation followed by Wait. Existing submenu coverage also exercises item double-activation protection and keyboard/gamepad focus routing.

## Follow-up coverage and UX notes

- This is representative action-flow coverage, not an exhaustive test of every weapon art, legendary effect, enemy art, or passive skill combination.
- Still schedule physical-iPhone touch/audio/background-resume testing and late-game multi-effect encounters. A synthetic, buffed loadout says nothing reliable about Normal-mode balance.
- At phone height, long ability descriptions need scrolling. Readability is improved, but a future selected-action detail area could reduce repeated text without restoring hover-only information.

These changes are local and are not yet in TestFlight.

## Follow-up: unavailable ability discovery

The Ability entry now remains openable whenever a unit owns a supported active skill, even if every skill is currently blocked. Skill rows remain visible and disabled with descriptions and explicit remaining counts: `0/1 uses left · Used this battle`, `1/1 uses left · Silenced`, or `1/1 uses left · No valid targets`. Available skills say `Ends unit action`. Units without supported active skills still have no Ability entry.

An explicit Back row ensures keyboard/controller confirmation can exit an all-disabled picker; illegal skills cannot activate. Tests cover a single exhausted, silenced, or targetless skill, returning to the menu without spending an action or charge, plus successful ability effects.

The adversarial review also found that the synthetic preset could inherit an alternate lord pairing and then fail to find Edric. Its copied starting effects now fix the fixture pairing to Edric/Sera without changing the saved selection; an alternate-pair regression covers this.

TestFlight upload is on hold for user review.

## Follow-up: contrast-only sprite legibility pass

Option 1 is implemented for the rebuilt battlefield presentation: cached one-source-pixel charcoal contours on units, lighter spent-unit tint (0xb8 instead of 0x88), clearer spent-unit faction rings, and 30% contrast compression of Plain ground around its own average color. Trees, mountains, shores, forts and hazards retain their detail. Source files, sprite display sizes, unit anchors, camera framing, terrain IDs and gameplay rules are unchanged.

Development comparison: append `&battleContrast=original` to the combat lab URL to review the old rendering. Remove it for the new default. This override is ignored in production. Outlined textures are cached separately from source textures.

Verified matched headed-browser before/after captures with identical camera zoom, sprite display sizes, unit positions and terrain layout, with no page errors. Existing terrain/dimming/fog suites: 65 tests passed. Three headed terrain selection/movement/undo tests passed. Screenshots: `/tmp/battle-contrast-original.png` and `/tmp/battle-contrast-improved.png`. Sprite-resolution/scaling changes (option 2) remain deferred. No TestFlight upload.


## Option 2: denser sprite sampling preview

Development-only `&spriteSampling=clean` prepares rebuilt sprite textures at twice their usual density with nearest-neighbor sampling. Their display sizes and anchors remain unchanged; the option 1 contour scales with texture density to retain the same on-map thickness. Existing 48px class assets are unchanged: this cannot recover detail absent from those sources. No new art is generated.

A filtered-downsampling trial was rejected because it softened the pixel-art style. The retained preview uses crisp sampling. Matched headed-browser captures at 844×390 confirm identical camera zoom, display sizes, unit positions and terrain, with no page errors. Targeted ESLint and diff checks pass. Comparison captures: `/tmp/sprite-sampling-current.png` and `/tmp/sprite-sampling-clean.png`.

Option 1 remains the production default. Option 2 is awaiting visual review; TestFlight upload remains on hold.

## Release decision

User selected option 1 for all battle sprites and authorized TestFlight on September 20. Removed the option 2 sampling experiment and its query flag. The shared normal/entity unit renderer applies the contrast texture to lords, recruitable classes, enemies, bosses and NPCs, including respawn/recruit/promotion paths that recreate graphics. No asset regeneration or sprite-size increase. Production mobile keeps the approved contrast, spent-unit tint and grass treatment.

Build 8 release complete: archived/uploaded September 20, 2026, and verified Testing in Public Playtest with automatic notifications. Final release checks: 5,198 unit tests; 109 harness tests; all PR simulation slices; 29 unique selected browser checks across main run and corrected assertion rerun; production offline smoke; lint zero errors and parity/theme gates. See `docs/testflight-beta.md`.
