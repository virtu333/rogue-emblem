# UX audit supplement — September 20, 2026 (second pass)

Companion to `docs/ux-contract-audit.md`. This pass covered territory the first audit did not: fog/status/danger information integrity, run-lifecycle persistence, the cloud sync boundary, the DOM/mobile input layer, and live phone-viewport gameplay in the in-app browser. Nothing here duplicates C1–C7 / N1–N10. No repo source files were modified; scratch harnesses live in the session scratchpad and were verified against real engine modules.

Legend: **[live]** reproduced in a headed browser at 667×375; **[script]** verified with a harness against real engine code; **[trace]** confirmed by direct code path analysis.

---

## Tier 1 — Player loses progress, money, or trust

### S1. Node-map "Abandon Run" silently forfeits all Valor/Supply [script]
`NodeMapScene.js:1155-1162` calls `failRun()` without `settleEndRunRewards`, while the identical button in battle (`BattleScene.js:4159-4160`) settles rewards. Abandoning from the map pays nothing; abandoning from inside a battle (or losing) pays the full meta payout. `incrementRunsCompleted` also never fires, so "runs finished" drifts. The confirm ("Progress will be lost") never says what is or isn't kept.
**Fix:** settle rewards identically on both paths; state the payout in the confirm. Existing tests (`RunClearSlotForwardingScenes.test.js:219+`) mock `failRun` only and would not catch either path losing the settle call.

### S2. Colosseum results are never persisted [script]
No save call exists anywhere in `ColosseumOverlay.js` / `ArenaMenu.js` / `leaveColosseumNode` (`NodeMapScene.js:1933-1943`), and pause → Save & Exit on the node map deliberately doesn't save (`NodeMapScene.js:1104`). The next real save is the next `NodeMapScene.create()`. Harness confirmed: memory gold 700 / node completed, persisted gold 200 / node unvisited. Arena losses are free to refresh away; wins and level-ups evaporate on a crash. The UI actively lies: `ArenaMenu.js:50,126` say "Leave the colosseum to save this visit."
**Fix:** route colosseum leave (and each result/hire) through the same `serviceSave.js` path shops use.

### S3. Service-node completion isn't saved → torn saves [script]
Shop/church transactions save per-transaction, but `markNodeComplete` in all three leave paths (`ShopController.js:446`, `ChurchController.js:757`, `NodeMapScene.js:1940`) is never followed by a save. Save & Exit after visiting a village: purchases and spent gold persist, but the node is unvisited and route position rolls back (free repeat church heal-all).
**Fix:** persist immediately after `markNodeComplete` in each leave path.

### S4. Merchant Caravan re-rolls rare stock on every reload [trace]
`pendingCaravanShop` is serialized but only cleared in `leaveShopNode` (`ShopController.js:437`) which never saves; caravan stock is never cached (`ShopController.js:133`, `_saveShopState` early-return at `:1964`). Buy the best item, refresh, get a fresh rare roll — repeatable until gold runs out.
**Fix:** clear + persist `pendingCaravanShop` when the caravan opens; cache its stock.

### S5. NEW GAME with a suspended battle starts a new run with zero warning [live]
From Title with a mid-battle suspended run, NEW GAME silently allocated the next free slot and switched `emblem_rogue_active_slot` to it — no slot picker, no mention. The old run survives in slot 1, but nothing tells the player; their battle appears simply gone unless they think to press CONTINUE and pick the right slot.
**Fix:** when a run/suspended battle exists, NEW GAME should show the slot picker (or at least confirm "start a new run in a new slot? Your current run stays in Slot 1").

### S6. Slot cards are indistinguishable [live]
After S5, slots 1 and 2 both read "0 Valor · 0 Supply · 1 runs started · Act 1 in progress." No timestamp, lord/roster, node position, or "Battle suspended" badge. The player cannot tell which save is theirs.
**Fix:** add saved-at time, current location, and a suspended-battle marker to slot cards.

### S7. Cloud-vs-local conflicts resolve silently [trace]
`CloudSync.js:805-817` is a pure timestamp compare; `applyRunSlots` (`:134-141`) overwrites local slots with cloud copies with no prompt or notice. Offline progress on one device vanishes on login if another device's cloud copy is newer.
**Fix:** surface a conflict choice (or at minimum a "restored from cloud" notice) on the slot picker when material progress differs.

### S8. Failed logout backup stays "confirmed" forever [trace]
`TitleScene.js:1061` sets `_logoutWipeConfirmed = true` after a failed backup and never clears it; a LOG OUT click minutes later skips the backup retry and wipes every local slot (`clearAllSlotData()`, `:1076`).
**Fix:** reset the flag on notice dismissal or successful sync.

---

## Tier 2 — Combat information integrity

### B1. Fog of war leaks full enemy data via inspect [trace]
`_showInspectionAtPixel` (`InputController.js:621`) has no visibility gate: right-click (`:264`), touch long-press (`:522`), inspect-mode tap (`:720`), and gamepad L2 (`BattleScene.js:674`) all reveal a hidden enemy's name/level/class/HP/weapon plus movement and attack ranges. The mobile plain-tap path (`InputController.js:386-391`) gates correctly, as does `refreshTileInfo` (`:60-63`). The only inspect test runs with `fogEnabled: false`.
**Fix:** return false for units on non-visible tiles when `grid.fogEnabled`, matching the mobile tap path.

### B2. Status-staff threat is invisible in the Danger Zone [trace]
`calculateDangerZone` (`BattleScene.js:10311-10356`) reads `enemy.weapon` only; `enemy.statusStaff` (range 3-5 Sleep / 3-7 Silence on top of movement) is never included, and the quick inspection tooltip doesn't show it either. Units get slept from "safe" tiles on Hard/Lunatic.
**Fix:** union status-staff reach into the danger zone (distinct tint), and show the staff in quick inspection.

### B3. No UI anywhere shows status conditions [trace]
A slept unit gets the same grey tint as an acted unit; clicking it is silently swallowed (`InputController.js:363,400-402`). No UI file reads `_conditions`/`isSleeping`/`isSilenced` for display. Silence silently *removes* Attack/Art/Heal from the action menu (`BattleScene.js:5795-5816`) with no explanation.
**Fix:** "Asleep (2 turns)" on tap; conditions section in inspection/detail panels; grey out blocked menu entries with the reason instead of removing them.

### B4. Level-up/promotion popups are an unbounded refresh-undo window [trace]
Checkpoints capture only at completed actions (`BattleActionCompletion.js:12`) and at two explicit escape hatches (`BattleScene.js:7803,7834`), but `awardXP` → `awardScaledXP` (`:7769`, `:8831-8850`) awaits `LevelUpPopup.show()` (resolves only on pointerdown) *before* those. Refresh during the popup → Resume restores pre-attack state: the resolved combat, deaths, and XP are undone and the player can act with knowledge of the outcome. Same window in `PromotionController.js:122-140` (seal + stat gains reverted). RNG reseed mitigates rerolls but not choose-a-different-action.
**Fix:** checkpoint immediately after combat/XP application, before any dismissible popup.

### B5. Boss enrage fires with zero warning [trace]
`updateAntiTurtlePressure` runs only at enemy-phase start (`BattleScene.js:9296`); the deterministic threshold (turn 12 / par+5) is never telegraphed, and enraged `aggressiveMode` widens guard range 3→6 (`AIController.js:180`) instantly.
**Fix:** "Boss enrages next turn" on the prior player phase + a persistent enraged indicator.

### B6. Visible Danger Zone can go stale after a move [trace]
`dangerZoneStale = true` writes (e.g. `BattleScene.js:8448,8967`) only invalidate the cache; nothing re-renders a visible overlay except the Capture branch (`:5994-5998`). Sequence: select unit (hides overlay) → D again → move → overlay shows pre-move threat.
**Fix:** factor the Capture branch into `refreshDangerZone()` and call it wherever stale is set while visible.

---

## Tier 3 — Mobile/touch layer

### M1. SW "UPDATE READY" toast covers End turn with a ~14px dismiss [trace]
`.sw-update-toast` (`index.html:302-357`, z-index 10000, fixed bottom-right, ≤340px wide) sits on `body`, beating every `uiDepths` value and the `:has()` rail-hiding rules. It covers the battle HUD's `End turn…` and the forecast's `Confirm attack`; RESTART is ~25px tall, the × dismiss ~14×14px. Mid-battle, reaching for End turn triggers a full app reload.
**Fix:** offset above the rails or suppress during battle; 44px hit areas; depth below `--re-depth-menu`.

### M2. Auth screen: ~27-30px fields, 6.6px portrait text, silent "Play offline" [trace]
`index.html:100-166,382-389`: inputs `min(11px,1.7vw)` (6.6px in portrait), ~27px tall; `#auth-toggle` and `.offline-link` are ~17px `<p>` handlers 7px apart — mis-tapping "Play offline" silently drops cloud sync with no confirm. (`cohesion.css:72` already applies the 16px iOS floor to in-game inputs; auth predates it.)
**Fix:** 16px minimum input font, `min-height: var(--re-tap)`, real buttons with 44px targets, confirm on offline.

### M3. Safe-area inset is carved out of fixed-width rails → buttons overlap the map [trace]
`.mobile-panel` is 76-80px wide with `padding-left: max(8px, env(safe-area-inset-left))` inside `box-sizing: border-box` (`index.html:191-230`, `mobileBattle.css:18-20`). A ~59px notch inset leaves ~9px for 48px buttons; they overflow onto the canvas and swallow taps on the leftmost tile column. Contradicts `docs/mobile-controls-spec.md:106,186`.
**Fix:** `width: calc(76px + env(safe-area-inset-left))` — add the inset, don't subtract it.

### M4. Rail buttons fire on touchend with no slide-off cancel; end-turn path unconfirmed [trace]
`MobileControls.js:237-281` runs the handler on `touchend` unconditionally (no move tracking, no bounds check) — you cannot abort a mis-press by sliding off, unlike `MobileBattleHUD.button()` which rejects >10px drags. Worse, `mobile:endTurn` routes straight to `forceEndTurn()` (`BattleScene.js:1852-1855`) with no confirm, while the DOM HUD requires two steps. Also: buttons removed/hidden mid-gesture (`MobileControls.js:155-176,212-221`) still deliver `touchend` → ghost activation in the new context.
**Fix:** bounds/threshold check on release + connected-and-visible guard; route rail end-turn through the same two-step confirm.

### M5. ~20px battle tiles with no one-finger pan after zoom [trace]
With the HUD (`clamp(200px,27vw,248px)`) and 76px rail, an iPhone SE landscape canvas is 391×375 → ~19.6px tiles. `BattleCameraController` (`:183-215`) only pans with two fingers; one-finger drag is tap-or-longpress. Move taps and staff/heal/shove/dance targets commit immediately with no forecast step (`InputController.handleSelectedClick`) — a wrong destination or wasted staff use is routine at that size. Confirmed live: taps missing a tile by ~10px produce zero feedback.
**Fix:** single-finger drag past the tap threshold pans and suppresses the tap; consider a confirm step (or tap-again-to-commit) for move/staff targeting at small tile sizes.

### M6. Rotate prompt renders behind open modals [trace]
`#rotate-prompt` z-index 50 (`index.html:285-294`) vs modal depths 950-1250. Rotate to portrait with a modal open → squashed modal, no rotate instruction, rails hidden. Web/PWA only (iOS native is landscape-locked). Also `_onRotateTap` (`MobileControls.js:99-110`) depends on `requestFullscreen`/`orientation.lock`, both unavailable on iPhone Safari — the prompt looks tappable but is a no-op.
**Fix:** z above `--re-depth-menu`; hide the pointer affordance where lock is unsupported.

---

## Tier 4 — Shell, feedback, and copy [all live unless noted]

- **S9. Viewport changes after startup never reconcile.** The viewport guard stops 14s after boot (`startupViewportGuard.js:235`); the game's logical size is fixed at boot (`main.js:469-494`). A live resize left the canvas letterboxed at 500×375 in a 667×375 window until reload.
- **S10. Loading percent sticks at 5%** while hundreds of assets stream; the "taking longer than expected" panel with Reload buttons appears during a *normal* load — on cellular this reads as a hang and invites reload loops.
- **S11. Zero-size second canvas inside `auth-wrapper`** persists after boot alongside the game canvas — confirm it's not a second live Phaser instance holding memory/audio.
- **S12. Destructive confirms put "Yes" in the primary top slot** that every info dialog uses for Continue (Abandon Run confirm) — muscle-memory hazard. Save & Exit confirm copy is a statement, not a question ("Battle Suspended — Resume From Continue" / Yes / Cancel).
- **S13. "1 units still have actions"** (`MobileBattleHUD.js:406`); objective line runs two sentences together ("Rout: 2 enemies remaining Village: Visit before bandits!", `VillageController.js:72`).
- **S14. Ruins +25% markup / liberated-village −20% discount are invisible** — prices rewritten in place (`ShopController.js:2028-2035`), `ShopMenu.details()` shows only the final number; the old green-tint affordance is dead canvas code. [trace]
- **S15. Fallen units' gear relocation is silent** — `_transferFallenUnitItems` (`RunManager.js:2686-2716`) moves gear to convoy (or strands it on the corpse at convoy cap) with no message anywhere except a church flavor line. [trace]
- **S16. Accessories and scrolls can be bought but never sold** — `shopOwnedItems` (`ShopCommands.js:10-33`) never enumerates `run.accessories`/`run.scrolls`. A 2,500G scroll for a dead unit is a permanent hole. [trace]

---

## Verified clean this pass (don't re-audit)

- **Combat forecast vs. resolution: 0 mismatches across ~7,000 scripted matchups** (classes × weapons × accessories × imbues × terrain × arts, HP straddling `below50`/`above75`). Forecast skill context correctly pre-applies art HP costs.
- Reinforcement spawn placement/timing, rout-victory deferral, wave caps; turn-transition race guards (`_playerTurnStartToken`/epoch/turn triple); conditions cleared at deploy.
- DOM input isolation (all surfaces isolate `DOM_INPUT_EVENTS`), `:has()` rail hiding, `mobile:setContext` stack, audio recovery, backgrounding, per-action suspend checkpoint, safe-area usage in all CSS overlay files (only `index.html` rails wrong).
- Shop full-bag divert + full-convoy refund with messaging; last-combat-weapon sell block; forge cost preserved in sell price; duplicate-reward guards; service-node re-entry lock; select-then-Advance route commit; suspend → Resume Battle exact restore (verified live).

## Testing implication (extends the first audit's section)

The persistence findings (S1-S4) share one root: **saves happen per-transaction inside overlays but not at node-lifecycle boundaries**, and every relevant test mocks the save layer instead of asserting "persisted state == memory state after leave." A single harness invariant — serialize after each leave-path and diff against the live RunManager — would have caught S2, S3, and S4 at once, and is the cheapest new gate to add.

## Suggested order

1. **S1-S4 + B4** (persistence/refresh integrity — same family as C1-C5, should ship together).
2. **B1-B3** (fog/status information integrity — affects difficulty modes about to be exercised in TestFlight).
3. **M1-M4 + S5-S6** (first-session mobile experience: auth, toast, rails, slot clarity).
4. **S7-S8** (cloud boundary), then Tier 4 polish.
