# Desktop playtest — round 3

Build: `336cd41d98611a755485a8641fcc95cd83b36428`, isolated snapshot `/tmp/rogue-review113`, Chrome origin `http://127.0.0.1:3093/`, native 1308×735 viewport. Normal, fresh slot 1, Full Guidance. Music and SFX muted through settings. All progress through visible inputs; no fixtures, hidden state, injection, or source patches.

## Current result

Two battles won in three turns each. Third battle Forest Ambush ongoing at player turn 3; Maud recruited successfully, all three allies alive. Normal victory not yet achieved. Browser execution approval stopped both an ordinary combat-preview click and subsequent read-only screenshot; play cannot continue until access returns. Live state retained in Chrome tab 225334251. Server session 53323 remains running to preserve continuation.

## Coverage and route

- Fresh title, Normal onboarding, Sera/Edric introduction and first-run notes.
- Chokepoint: routed two Fighters in three turns. Tested move, cancel, item use, ranged attack, forecast, Iron/Steel comparison and keyboard confirm. Iron Sword 8×2 beat Steel 11×1 in relevant matchup. An exposed Sera survived a genuine tactical mistake; no rewind used.
- Reward: chose 676G and 25 team XP, leaving 1448G. Reloaded without manual saving, then resumed slot 1. Route, completed node, gold and HP (Edric 11/20; Sera 17/18) restored correctly.
- Roster: used Vulnerary to restore Edric, confirmed remaining uses and prevention at full HP.
- River Crossing: routed two Myrmidons in three turns. Forest/fort positioning, ranged chip, heavier lethal weapon selection, level-ups for both characters. Sera fort healing worked. Cancelled an adjacent forecast and moved to range 2.
- Reward: applied Might Whetstone to Edric Iron Sword. Roster verified Iron Sword +1, Might 6; equipped it. Gold 2031G. Healed Sera before next node.
- Forest Ambush: previewed Maud's stats/Old Campaigner trait. Edric approached and Talk recruited Maud turn 2. Recruit immediately usable. Threat Sight warned of 3 enemies at a forward square; movement undo and safer forest square reduced to 1. Iron Axe remained equipped after cancelling Hand Axe forecast. All three survived enemy phase into turn 3.

## Findings

### P2 — Hover information can retain stale HP after combat

Observed several times after confirming an attack while pointer stayed over target: top-left enemy information retained pre-hit HP (including Fighter 6/22 after death and Myrmidon 19/19 after damage), while sprite/result reflected combat. Moving pointer updates context. Suggest refresh or dismiss hover details after combat resolves. This is a visible observation, not yet source-confirmed.

### P2 — Battle consumable action lacks useful detail before immediate use

Battle Item menu shows only e.g. `Vulnerary (3)` and Back. It does not explain restore 10 HP or that use spends the unit's action before the click consumes it. Roster and reward card do explain healing. Add healing amount and action cost in the battle item detail area.

### P3 — Active forecast confirmation looks disabled

Confirm Attack uses pale text on pale green; low contrast resembles a disabled control. It works with Return. Use darker text/higher contrast for the enabled state.

### P3 — Preview flavor contradicts actual encounter

River Crossing scout text reports six at the ford, mostly quarry picks. Actual battle had two sword Myrmidons. New players may read a scout report as tactical information. Remove concrete counts/weapon claims or derive them from encounter composition.

### P3 — Small unexplained terms

Preview danger tags `Hunters +1` and `Captain` do not explain their effect adjacent to the choice. Weapon reward uses `Prof` without expansion. Add concise hover/focus hints or plain labels.

## Positive UX / intentional challenge

- Full Guidance clearly explains cancel steps, disabled Attack, HP carryover and recruitment.
- Threat count and lines materially improved a tactical decision, and movement undo worked.
- Reward illustrations and recipient/forge workflow are clear; application persisted correctly.
- Level-up panel and explicit Continue are readable and polished.
- Roster healing details and full-HP refusal are clear.
- Weapon weight and accuracy tradeoffs are meaningful: Maud's range-2 Hand Axe forecast showed 18% hit and AS -1 against a sword enemy in forest; rejected deliberately. This is tactical difficulty, not a bug.
- Save/resume boundary passed organically.

## Remaining coverage

Full Normal completion, service nodes/shop, later acts, boss, final save/exit, console check, and post-reload audio-setting verification remain untested. No console claims are made. No screenshots were exported to file; visual evidence is present in tool captures only.

## Follow-up: desktop UI parity and rewind discoverability

**P2 — Rewind keyboard help disappears at the tested desktop size.** In the 1308×735 captures, footer shows D Danger, O Roster, E End Turn, and contextual X Cancel, with no rewind instruction. Top-left says `Eye: 1 left this run`, which does not explain how to invoke it. Source confirms R is bound in `src/scenes/BattleScene.js:1170`; the intended help string includes `[R] Vision` at `src/ui/DesktopBattleHud.js:30`. However, layout at `src/ui/DesktopBattleHud.js:258` hides the entire hint if it cannot fit in the remaining single-row space. Add a persistent Vision control with R badge or let secondary shortcuts wrap. This is a discoverability issue, not an absent keyboard implementation.

The desktop canvas menus look visibly older and less informative than the illustrated roster/reward UI. A shared responsive DOM battle panel, adapted from MobileBattleHUD, is a reasonable direction. `src/ui/MobileBattleHUD.js:91` describes it as a presentation view over existing scene actions; combat stays in the engine. Extract or reuse shared command/forecast/item view data and handlers, then add desktop sidebar/dock layout, mouse-oriented instructions and keyboard badges/focus. Do not globally enable mobile input or touch camera behavior merely to get the newer appearance. This would also unify item descriptions and confirmation styling that currently differ across surfaces.

**Persistence limitation:** Turn-3 live state is visible, but its exact autosave checkpoint has not been reloaded or verified. Last verified persistence checkpoint was the route after battle 1. No final manual save was possible once browser execution approval was denied. Preserve the running tab/server for continuation; do not claim the third-battle checkpoint is durable.
