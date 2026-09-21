# Input ownership audit — September 20, 2026

Status: distributed in TestFlight 0.1.0 (9) to Public Playtest on September 20, 2026; App Store Connect confirms Testing.

## Scope and method

Review every DOM creation/event-listener entry point in `src/main.js`, `src/ui`, `src/utils/MobileControls.js`, and recovery code. Follow shared MenuSurface callers (16 source modules), custom sheet roots, keyboard/controller focus, hidden parents, and shutdown. Inspect Phaser's installed mouse/touch listeners to distinguish DOM event leakage from normal canvas events. Preserve gameplay rules and saves.

Use headed Chromium phone and desktop runs, live in-app browser navigation, and targeted probes that count calls to Phaser's input manager. Counting the manager matters: a sidebar press can reach Phaser without emitting a scene pointer event because its coordinates happen to be outside the canvas.

## Findings and fixes

| Finding | Evidence | Resolution |
| --- | --- | --- |
| Battle sidebar misses legacy touch/mouse isolation | Both real touch and mouse presses on its phase text reached Phaser's input manager. Nested Pause opening had the same leaked first press. Usually outside map bounds today. | Isolate the entire sidebar, including blank areas, More, utilities and buttons. |
| Compatibility side rails cover touch but miss mouse-down/up; rotate prompt lacks the shared boundary | Source review of MobileControls; after-fix browser tests expose the real rails and confirm one intended action and zero leaked presses for both modalities. | Boundary on both rail roots and rotation prompt, with teardown. Protect the legacy upgrade launcher too. |
| Runtime/boot recovery and update notice are outside the menu kit | Runtime recovery text tap reached Phaser in a live fixture. Recovery had neither keyboard focus ownership nor a controller scope. Boot/update use the same standalone pattern. | Shared event isolation; recovery additionally owns focus/controller input, makes the game wrapper inert, traps Tab, and prevents keys outside its card from reaching the game. Recovery Cancel is deliberately non-dismissible. Teardown releases ownership. Update notice remains non-modal. |
| Canvas-origin mouse release over a menu leaves a stuck held pointer | Reproduced: mouse down on canvas, open Settings, release over Settings, `mousePointer.isDown` remains true. | Capture that cross-surface release, reset the pointer, and send cleanup-only `pointerupoutside`. No map click or menu activation; listener removed on game destruction. |
| Held Escape closes multiple layers | Reproduced after Settings closes and Pause regains focus: a repeated Escape also closes Pause. | Ignore repeated Enter/Space/Escape activation across custom and shared menu roots. Preserve arrow repeat and text entry. |
| Stale blocked choice loses keyboard focus | Source review: pre-apply block branch rerenders the focused Confirm button without restoring focus. Added a browser regression with eligibility changing between render and confirmation. | Restore content focus, display the reason, keep Escape usable, and apply nothing. |

The existing Compendium fix still protects the shared menu roots and Title actions. No lord entry has a navigation action.

## Coverage inventory

| Surface family | Review/checks |
| --- | --- |
| Title, save slots, results and recovery | Covered title guard; Compendium touch/mouse at 667/844; save delete/cancel focus; result transition/shutdown; recovery fixture and input teardown. |
| Home Base, upgrades, difficulty/blessings | Custom root event handling, input enable restoration, focus and scope teardown; loadout/skill limits, purchase/refund, locks and saved reload. |
| Node map and references | NodeMapMenu isolation; MenuSurface reused by Compendium, Help, How to Play, Campaign Map and Settings. Live battle → Pause → Compendium → Back. Shared compact backdrop and focus path reviewed. |
| Battle sidebar and forecast | Root isolation, forecast backdrop/Tab trap, cancel/confirm/weapon cycle, actual map taps, item/ability/art targeting, state and cost checks. |
| Pause and confirmations | One-layer Back, held Escape, settings return, scrolling, abandon/save-exit callback exactly once. |
| Roster and choice pickers | Root and child ownership, focus restoration, desktop controls, stale choices, busy/duplicate apply protection. |
| Rewards and reward substeps | Weapon/consumable/booster/forge/imbue/convoy, busy apply, Back, roster/settings round trips, reload without duplicate award. |
| Deployment and arrivals | Selection preserved through roster, required/optional cancel, resolve once, reroll once, rotation and shutdown. |
| Level-up, promotion, trade and rewind | Shared MenuSurface routing, controller confirm, cancel, callback once, shutdown, inert HUD. |
| Shop, Church, arena | Shared surface/picker roots; purchases/recipient, map and roster round trips, healing/promotion, arena combat/reward/hire. |
| Compatibility rails, rotation prompt, update notice | Root boundaries and listener lifecycle; rails exercised in a browser fixture. Update availability itself is not simulated; its boundary is covered by the shared helper test. |
| Auth/login screen | Exists before Phaser is created; not a covered-game click-through path. |

## Decisions / non-findings

- Do not disable all window input globally: legitimate releases outside the canvas must still clean up gestures.
- Do not prevent native defaults on ordinary DOM buttons or scroll regions. Stop propagation at the boundary.
- Do not delete canvas fallback implementations as part of this bug fix. Their shipping callers were traced to the DOM gates; legacy cleanup is a separate project.
- Existing forecast Tab trapping and the controller input stack were already present. They were not the cause of the original pointer leak.
- Browser phone emulation is not physical iOS validation. WebKit is not installed locally; native Safari/WKWebView gesture handling remains a device check.
- This is an audit of the current input-ownership paths, not a claim that every future timing/device combination is bug-free.

## Verification

- **5,201 unit tests passed / 281 files** on the final code.
- **83 unique headed browser cases passed across the main run and focused reruns**: 79 selected existing/audit cases plus four additional held-key, stale-choice and compatibility-rail cases. The first broad run had one failed and one retried legacy Pause test referencing removed controls; the updated Pause file passed all four cases in its focused rerun. No unresolved product failure from that run remains.
- Nine focused audit cases cover touch/mouse sidebar isolation, recovery keyboard/controller isolation and teardown, mouse release over a modal, nested menu ownership, held Escape, stale choice focus and both compatibility-rail modalities.
- Production build and theme generation check passed. Targeted lint: zero errors, 11 existing warnings. `git diff --check` passed.
- Live in-app browser checks: battle → Pause → Compendium → Back, and roster → Skills → Back, with no unintended transition/action.
- Physical iOS validation remains pending; WebKit is not installed in the local Playwright runtime.

Tests used disposable browser contexts and did not modify tester saves. The follow-up release uploaded these fixes as build 9; see `docs/testflight-beta.md` for release evidence.

### Reviewer / next device pass

Review `domInputBoundary.js`, its main-game installation, and the remaining custom roots first. Exercise: hold a map press while opening a menu; rapid open/close; Settings → Pause with a held Escape; touch scrolling and pinch after dismissal; and a runtime recovery dialog. The helper deliberately cancels only canvas-origin mouse releases on a different DOM target, leaving ordinary map presses and native DOM controls alone.
