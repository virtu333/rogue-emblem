# Weapon Arts Playtest Checklist

Use this checklist for quick manual validation after Weapon Arts logic/UI/data changes.

## 1. Forecast/Execute parity

- Select an art and open forecast: confirm art line shows HP cost and post-cost HP.
- Cancel forecast repeatedly: confirm HP and usage counters do not change.
- Confirm combat once: HP cost and usage consume exactly once.
- Re-open forecast after execute: values should reflect updated HP/limits.

## 2. Unlock-source behavior

- Start a run with no meta unlocks: only current-act arts should appear.
- Advance acts: newly unlocked act-gated arts should appear with unlock banner.
- Start a run with meta-unlocked art(s): those arts should be available immediately.
- Save/load migration spot-check: no unlock source loss or duplication.

## 3. Requirement/status clarity

- For a non-proficient unit, art should show rank/proficiency gating reason.
- For insufficient HP, art should show HP gating reason.
- On turn/map caps, reason should switch to limit reached and recover next valid window.

## 4. Legendary + enemy guardrails

- Legendary-bound arts should appear only with matching legendary weapon equipped.
- Weapon swap away from matching legendary should remove that art from choices.
- Enemies should never select player-only legendary arts.
- Enemy art selection should remain deterministic on equal score (cost then ID tie-break).

## 5. Difficulty sanity

- Normal: enemy arts should trigger less often and avoid marginal-value uses.
- Hard/Lunatic: trigger frequency should increase as configured.
- Verify no self-lethal enemy usage from HP-costed arts.

