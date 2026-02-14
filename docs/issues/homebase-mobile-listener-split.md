# HomeBase Mobile Listener Follow-up

## Status
- Tracked for separate commit from the Vanguard Cadre + XP damping patch.

## Why split
- Mobile event listener wiring in `HomeBaseScene` is unrelated to meta-progression behavior.
- Keeping it separate reduces regression risk and makes rollback/cherry-pick cleaner.

## Follow-up scope
- `src/scenes/HomeBaseScene.js`
- Add/remove listeners for:
- `mobile:cancel`
- `mobile:menu`
- Emit context:
- `mobile:setContext` with `homebase`

## Commit note
- Land this as a standalone commit after progression patch validation.
