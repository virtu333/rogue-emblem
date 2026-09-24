# Emblem Rogue — mobile review backlog

Updated September 15, 2026. Proposed work below is for review; it has not been implemented unless marked completed.

## Completed in the first battle prototype

- Fixed-size battle command panel and selected-unit summary.
- Scrollable primary action list using the existing game actions.
- Readable combat forecast, portraits, weapon cycling, and explicit attack confirmation.
- End-turn confirmation in the touch command panel.
- Input-aware hints in tutorials, deployment, navigation, rewards, and unit details; touch controls reference page.
- Development-only mobile preview on desktop.
- Whole-layout safe-area reservation to keep controls away from the iPhone camera cutout, visually verified in the iPhone 17 Pro simulator.
- Canvas sizing refresh when switching between the battle panel and older tutorial controls.

## Completed in the roster pass

- Scrollable mobile unit list and Stats/Equipment tabs, with item descriptions and same-type weapon comparisons.
- Read-only battle inspection; between-battle equip, store, withdraw, healing, and accessory controls.
- Shared convoy with explicit recipient, capacity feedback, and empty states.
- Existing promotion, scroll and trade screens remain reachable through Advanced management; full inspection remains under More details.
- Verified 15 mobile browser tests, 5 guarded inventory tests, and 47 existing roster tests. iOS simulator compilation succeeded.

## Suggested next work

Effort is relative: small is a focused change; medium spans a screen/system; large spans several screens and playtesting.

| Priority | Opportunity | Evidence / hypothesis | Proposed change | Effort |
|---|---|---|---|---|
| 1 | Roster, equipment, inventory and shop readability | The core roster/equipment/convoy views now have mobile sheets; advanced pickers and shops still use the older canvas layout. Many text labels elsewhere in the battle scene are 8–12px before scaling. | Reuse the battle typography and touch targets in scrollable sheets. Show item details and comparisons without hover. | Large |
| 1 | Terrain and objective information | The top-left terrain/turn text and objective text still live in the scaled canvas; the new unit summary covers only part of that information. | Add readable terrain effects, objective progress, turn rating and rewind availability to the touch interface. | Medium |
| 1 | Tutorial and deployment layout | Native simulator inspection showed the older side controls during tutorial hints. Safe areas are now handled, but the tutorial cards and deployment UI still shrink with the canvas. | Apply responsive cards and explicit, generously sized Continue/Confirm/Back buttons. Test a fresh first-run path. | Medium |
| 1 | Phone reliability | A simulator launch is not a full device playtest. The game uses audio, local saves and optional Supabase cloud saves. | Test background/resume, interruptions, device lock, offline starts and saves across app upgrades on a physical phone. | Medium |
| 2 | Battle visual clarity | Pixel-art units and terrain share a busy texture field. Legibility needs checking at actual phone size. | Prototype stronger faction bases, selected-unit outlines, and distinct move/attack/threat patterns. Evaluate on several terrain palettes. | Medium |
| 2 | Explain movement commitment | Existing code supports cancel and pre-move state, but players must learn when an action becomes final. | Add short state-specific guidance such as “Cancel to undo movement” only where that is actually true. Playtest a complete move/attack/cancel loop. | Small–medium |
| 2 | Combat consequence clarity | The forecast exposes damage, hit, critical, skills and warnings. Risk can still be hard to assess quickly. | Explore a clearly labeled potential HP outcome and concise explanations for Shielded/Thorns/Miracle. Preserve uncertainty and attack-order effects rather than presenting an unreliable guaranteed outcome. | Medium |
| 2 | Reduce travel friction | Hypothesis from the preview: crossing empty tiles may feel slower on touch, especially on large maps. This is not a measured problem yet. | Measure taps and turn duration in several battles before considering camera follow, move previews, or faster movement animation. Preserve tactical rules. | Medium |
| 3 | Consistent art and icon language | Older controls use emoji, while the new battle panel uses text and the game’s existing portraits. | Establish a small, consistent icon set, border treatment, and type hierarchy. Keep sprite art intact until playtesting identifies specific weak assets. | Medium |
| 3 | Asset loading and package size | Source media totals roughly 235 MB. | Profile actual device startup and memory; optimize oversized portraits/audio first if they are measured bottlenecks. | Medium |

## Recommended review sequence

1. Play one battle on a small phone: select, move, inspect, compare weapons, confirm, cancel, and end turn.
2. Agree on the battle interface’s density and visual style.
3. Apply that style to unit details, inventory/equipment and shops.
4. Refine onboarding, terrain/objective presentation, and combat feedback.
5. Complete physical-device reliability checks before TestFlight.

## Limits of this prototype

The primary battle actions, forecast, roster inspection, equipment, consumables and convoy have mobile views. Battle equipment/item submenus, advanced promotion/scroll/trade pickers, shop screens, some canvas status text and tutorial/deployment panels still use the existing layout. Core combat and progression rules were not rebalanced. No new sprite art has been generated. Offline play and local saves are now explicit defaults; cloud requires a deliberate build-time opt-in.

Native roster verification: iPhone 17 Pro landscape inspection and equipment sheets remain clear of the camera cutout. Portraits now render from decoded game textures, avoiding revoked loader URLs; the regression test passes.

## Visual direction for the next menu refinement

User feedback: the new menus are cleaner but too plain. Use the supplied `roster-theme-options.html` as design inspiration, not as an instruction to ship its suggested changes immediately.

Proposed direction for review: Command Panel (A) as the shared foundation, with restrained Gilded Tactics (C) corner brackets and selection markers. FE Window (B) is a stronger alternative if a cohesive beveled blue style is desired across the game.

- Replace slate rounded cards with the game's deep navy palette, sharper borders, gold focus/selection states, and a clearer title treatment.
- Use the existing pixel font selectively for short headings and accents; keep descriptions and dense item information readable. Do not copy the reference's 7–9px text sizes onto phones without checking legibility.
- Restore the game's per-stat colors and add compact HP bars alongside numeric HP. Consider stat bars only with meaningful, consistent scales; the reference's sample maxima are mockup values, not game rules.
- Use portraits, restrained corner details, and selected-unit markers to give the roster more identity without reducing content space.
- Share visual tokens across battle, roster, inventory and future shop screens; avoid a different style for each overlay.
- Preserve at least 44px touch targets, safe areas, visible focus, scrolling, readable contrast, and the existing interaction safeguards. Color must supplement labels and state markers.

Next design checkpoint: style one populated roster/equipment screen at small-phone landscape size, including selected/disabled states and long item names, then review the result before extending the treatment throughout the menus. The subsequent refinement pass applies A’s navy/gold foundation with C-inspired corner accents to the roster and battle panels.

## Completed visual refinement and local-play default

- Shared navy/gold theme, sharp borders, pixel headings/tabs, selection markers, readable body text and stat colors.
- HP bars in roster selection, unit summary and battle forecast; values stay numeric and use existing health thresholds. Stat bars with invented caps were not introduced.
- Pixel font bundled locally; no Google Fonts dependency on launch.
- Local-only default independent of whether Supabase credentials are present. No login/session restoration/cloud sync unless explicitly enabled in the build; existing local saves preserved.
- 332 targeted unit tests and 16 browser checks passed. Updated iOS simulator build compiled.

Next refinement candidates remain the advanced promotion/scroll/trade screens, battle item submenus and shops, using the same visual tokens. Device-save backup/export is a separate future consideration; it is not implemented by the local-play default.

Final native check: the bundled pixel font renders correctly from startup, and the themed battle and roster panels, HP bars, portraits and stat colors remain clear of the iPhone 17 Pro camera cutout. Font readiness has a bounded fallback so it cannot block startup indefinitely.

## Consistency pass after battle/pause screenshot feedback

- Replaced modern sans-serif mobile menu copy with the shared readable monospace family and pixel headings.
- Moved objective, terrain, turn-rating and rewind text out of tiny black canvas labels and into the touch battle panel. Battle info is expandable; action menus and end-turn confirmation take priority.
- Added a matching mobile Pause menu with scrolling, large touch targets and the existing Settings/Help/Compendium/Map/Save/Abandon callbacks. Existing confirmations remain intact.
- Verified 43 pause/transition unit tests and 19 browser cases across pause, battle and roster, including cancellation and exactly-once save/abandon callbacks. Narrow command labels no longer split inside words. iOS simulator build succeeded.

Remaining consistency targets: Settings, Help/Compendium/Campaign Map, tutorial/deployment cards, shops and advanced roster pickers still use older canvas layouts. Their menus remain reachable; this pass does not claim to have redesigned those screens.

## Battlefield Lab (development-only playable study)

- Fixed the original movement HUD disappearing during UNIT_MOVING.
- Added an opt-in wider battlefield with a fixed bottom tray and bright retro window palette.
- Added a 24×8 river crossing and original terrain studies; retained engine rules and unit sprites.
- Integrated nested weapon/equipment action callbacks into the lab tray.
- Review next: final terrain atlas, clearer team/selection markers, compact forecast, and legacy vision/reward dialogs. See battlefield-lab.md.

## Weathered battle lab follow-up

- Review generator intent for disconnected bridge cells and enclosed chokepoint wall shapes. Rendering currently preserves these exactly.
- Check side-pane weapon lists/forecast comfort and default zoom on a physical landscape iPhone.
- Author additional multi-bank shoreline corners and reduce visible ground texture repetition.
- Retain class readability when refreshing unit sprites; do not substitute a single shared character across classes.


## September 21 follow-up

### Promotion ceremony — backlog, not implemented
- Dim the screen; showcase the current sprite, then reveal the promoted sprite and class through a short glow/silhouette transition.
- Animate stat gains sequentially with before/after values and ascending notes; prominently explain new skills, weapon access, and movement changes.
- Target 3–4 seconds of skippable animation. Tap completes animation; a separate Continue closes an untimed summary. Honor mute/reduced motion/Instant settings.
- Use current art first; reserve ornate lord designs for promoted variants. Optional character lines and return-to-map glow later.
- Apply promotion once; presentation must never repeat mutations after skip, reload, or resume. Coordinate with the separate rewind implementation before touching shared lifecycle code.

### Map framing and ready units
- First patch: end-turn confirmation lists a Show [name] button for each unit with actions left; centers that unit without spending an action or changing zoom.
- Consider persistent off-screen ally arrows, a ready-unit counter with Next unit navigation, and a contextual “Overview shows the whole map” hint. Prefer actionable navigation over a generic instruction to zoom.

### Weapon-art clarity and Phantom Rush
- Audit shared details for numeric bonuses, multi-strike damage, positional effects, status durations, area damage, ally buffs, and drawbacks.
- Phantom Rush: 8 base HP upfront, removing the forced post-combat 5 HP. Three 60%-damage strikes, bonuses, and hit-gated retreat remain. A provisional balance adjustment, to compare with normal Brave Sword attacks in play.

### Holy Knight movement — reviewed, no balance change
- User clarified the class was Holy Knight, not Chevalier. Holy Knight already has Canto and +1 MOV on promotion (Rowan 5 → 6). Terrain costs and movement spent before acting reduce reachable tiles/Canto distance.


Verification for this follow-up: 148 focused unit/integration tests passed across the weapon-art and item-detail suites; six muted headless mobile browser checks passed, including locating a deliberately off-screen ready unit without spending its action. The locator check waits for the camera render frame. Data validation and all 27 runtime JSON mirrors passed. No full-suite/release claim; the separate rewind work remains in progress.
