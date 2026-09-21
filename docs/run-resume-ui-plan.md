# Run recovery and remaining UI audit — build 7

## Order and acceptance

1. Reproduce/investigate `this.data.drawImage` on reload/RunComplete. Fix the underlying lifecycle/texture fault without hiding runtime errors or discarding saves. Exercise resume, defeat, results → Home Base, and repeat new runs.
2. Visible browser playthrough of New Game / Continue / suspend choice / Home Base / difficulty / blessing / map / deployment / battle / results. Replace remaining setup and result canvas menus with the shared MenuSurface, preserving rewards, save-slot behavior, and transition guards. Document other legacy surfaces discovered.
3. Recover music after foreground return and on the next user gesture if Web Audio remains interrupted. Preserve volume/mute and avoid duplicate loops or foreground/background resume races.
4. Staff users restore their previous eligible combat weapon (otherwise first usable combat weapon) after heal/cure/relocate/all-heal. No bonus action; counterattack still uses normal combat range and proficiency. Preserve staff uses and XP.
5. Normal Act 1: exclude Cavaliers until a further unit has joined. Cover generated enemies and reinforcements, preserve Hard/Lunatic and later-act pools. Use the persisted roster plus fallen-unit history so casualties/deployment choices do not re-enable the restriction; no new save schema.
6. Targeted regressions, visible browser verification, independent adversarial review, then broader release gates. Distribution follows only after verification.

## Observations

- Screenshot's result UI confirmed as RunCompleteScene canvas text with overlapping fixed Y positions.
- SlotPickerScene and its suspended-battle/delete dialogs remain canvas-only despite surrounding DOM menus.
- HealController only changes back to a combat weapon when a staff is depleted.
- Audio recovery currently listens to foreground events, but lacks a post-background user-gesture retry.
- Preserve working tree from prior TestFlight releases; no GitHub push.

## Confirmed crash
Independent review reproduced the exact drawImage failure in real Phaser: scene DisplayList shutdown destroys Text before MenuFocusController.destroy recolors it. Teardown now discards references without repaint; clear/render/activate guard destroyed objects. Also guard RunComplete post-dialogue continuation with a per-create token: stopping it during dialogue previously resurrected seven objects and a live input scope.


## Completed / verified — September 20, 2026

- New MenuSurface paths cover save slots, resume/delete decisions, run results and important hints. Minor hints use accessible DOM status toasts. Emergency recovery prompts retain independent lifecycle but use readable theme colors and controls. Title artwork and noninteractive battlefield effects deliberately remain canvas.
- Visible in-app playthrough: Title → new run → map → first battle; pause/settings; save/title/reload/resume; abandon test run → Home Base → difficulty → blessing. Headed full-loop automation additionally completes rewards, shop, equipment, next battle and save/resume.
- Results now show aligned rewards without overlap; result rotation and Home Base return pass. Real Phaser Text teardown and stopping results mid-dialogue are regression-tested.
- Sera and other staff users restore an eligible combat weapon after staff actions. Staff use/XP/action costs remain unchanged; normal counterattack range still applies.
- Normal Act 1 Cavalier restriction uses roster plus fallen history (<3). Covers normal/boss pools and reinforcement paths; existing generated battles remain unchanged.
- Audio recovers on foreground plus bounded retries/next gesture. Real Web Audio suspend/resume preserves music identity and volume in headed Chromium. Actual iOS app switching is still a physical-device verification item.
- Independent adversarial review reproduced both lifecycle faults and caught child-dialog focus restoration while its parent remained inert; all are fixed.
- Gates: 5,183 unit tests; 109 harness tests; all PR simulation slices; reference/data parity/theme; lint zero errors (existing warnings); production build. Headed recovery/progression/scene suite: 15 passed, plus full mobile run loop passed. Initial audio-test selector ambiguity was corrected to target the game canvas; its meaningful resume assertion passes.
- No save schema changes and no GitHub push. Release build 7 includes prior build 6 changes from the existing working tree.

- Production offline smoke also passed in a headed phone-sized browser: first-run narrative/hints, rebuilt battle art, pause contrast and Compendium search, with external requests blocked. The smoke selectors now target the native Field notes body action.
