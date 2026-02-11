# Agent B Mobile UX/Perf Status

Date: 2026-02-11
Branch: agent-b/mobile-ui-perf

## Merge Status

- Scope from this branch is now merged on `main` via Feb 10-11 startup/mobile reliability commits.
- Keep this doc as implementation notes and candidate follow-ups; treat branch name as historical context.

## Top 10 issues (ranked by impact)

1. Grid click handling used `pointerdown` with no touch drag threshold, causing tap/drag misfires on phones.
2. Battle action menus used small text-only hit areas, creating missed taps for core actions.
3. Menu clamping used hardcoded `480` height assumptions and did not clamp X, causing potential clipping.
4. Touch pointer move executed hover/path preview work that is not meaningful on touch devices.
5. Path preview recalculated on every mouse move event, including repeated events on the same tile.
6. No user-facing reduced-effects toggle persisted in settings for mobile performance control.
7. Recruit fog marker ran infinite tween pulses even when reduced effects would be preferred.
8. Dance/phase/combat feedback effects had fixed animation timings, increasing scene cost on mobile.
9. Settings overlay lacked mobile perf controls and had compact spacing for larger touch targets.
10. Several overlays still rely on fixed virtual coordinates and should get a full narrow-viewport pass.

## Implemented in this branch (batch 1)

- Touch tap-vs-drag guard for battle grid input (pointer-up click commit with movement threshold).
- Dynamic menu position clamping for both X/Y against camera dimensions.
- Larger effective hit areas for core battle menus (action, weapon, staff, equip, item, accessory).
- Reduced hover/path work on touch and avoid redundant path recomputation on identical hovered tile.
- New persisted setting: `reducedEffects` (default on for mobile UA, off for desktop UA).
- Settings UI now exposes `Reduced Effects` toggle.
- Reduced-effects hooks in battle visual flow (recruit marker pulse, dance sparkle, phase banner, combat/heal/poison text timing).

## Next batch candidates

- Full narrow-viewport audit for battle HUD and roster/detail overlays.
- Touch camera pan + selection mode separation on larger maps.
- Additional reduced-effects hooks for non-critical tween-heavy overlays.
