# Track A2/A3 Deferred Backlog (Path A)

Date: 2026-02-19
Status: Deferred from Track A closeout, intentionally not in current implementation scope.

## Backlog Items

1. Extract combat forecast rendering from `BattleScene` to `src/ui/CombatForecastDisplay.js`.
   - Priority: Medium
   - Goal: isolate forecast UI drawing and interaction logic from battle state logic.

2. Extract combat resolution sequence from `BattleScene` to `src/engine/CombatResolutionFlow.js`.
   - Priority: Medium
   - Goal: reduce battle-scene coupling and make resolution flow independently testable.

3. Extract XP/Gold award orchestration from `BattleScene` to `src/ui/XPGoldAwardFlow.js`.
   - Priority: Medium
   - Goal: separate post-combat reward presentation/state updates from core battle loop.

4. Evaluate optional migration from overlay model to `src/scenes/ColosseumScene.js`.
   - Priority: Low
   - Goal: revisit only if future product direction requires scene-based routing or lifecycle isolation.

## Constraints For Deferred Work

- Preserve current Colosseum gameplay behavior and economy policy.
- Avoid broad RunManager redesign as part of extraction-only work.
- Keep save compatibility across existing slots/runs.
