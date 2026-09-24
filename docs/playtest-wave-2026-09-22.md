# Build 19 playtest follow-up wave

Scope: priorities 5, 3, 4 and 2 from `playtest-2026-09-22.md`. Priority 1 (battle sidebar layout) remains for a separate UI/UX discussion.

## Changes

- **Targeted balance:** newly generated Dancer hires cost twice the ordinary class price (Normal Act 1: 800–1,300 G). Other classes and stored offers retain their prices. Newly rolled Vulnerary rewards contain three items; existing pending rewards retain their recorded quantity. Brawny now requires Sword, Lance, Axe or Bow proficiency, including hybrids. Existing traits are not rerolled or removed.
- **Inventory:** reward Roster supports between-battle management. Accessory rewards and purchases offer immediate equip or shared storage, explicitly returning replaced accessories to the pool. Reward recipient restrictions name the weapon proficiency. Escape completion preserves prior roster order; new recruits follow existing members. Shop tab changes reset stock scroll, while refreshes within a tab retain it.
- **Arena:** draws award 25% of non-kill combat XP, multiplied by the tier and subject to existing diminishing returns (minimum 1 XP). No gold is awarded or charged for draws; HP loss and per-visit fight limits remain. This addresses training value without changing single-exchange combat or inflating win payouts. Opponent matchup tuning remains a future balance question.
- **Timeline:** recorded defeats, village reward details, critical hits and misses take priority over generic attack/movement labels; ordinary hit results also precede attack intent. Selected history rows are revealed when opening History or changing selection. Expanded details lead with the same outcome. Village rewards already had persistent recorded details; this change makes them visible rather than granting or storing rewards a second time.

## Review boundaries

Accessory eligibility is checked before spending/claiming; swaps use the existing equipment command. Reward claims keep their existing save/retry guard and cannot grant twice. Roster management returning to rewards refreshes recipient details and rechecks save status. Timeline changes only read already visibility-filtered recorded data and do not modify rewind state or consume random numbers. No enemy rules, throne aggression, map terrain, or battle sidebar layout changed.

## Verification

Results recorded after the final checks below. Physical iPhone validation and long-run balance measurement are outside this patch pass. No TestFlight upload is part of this follow-up wave yet.

- 5,713 unit tests across 341 files passed (`/tmp/followup-unit-final.log`).
- 165 harness tests passed (`/tmp/followup-harness.log`).
- All 12 unique focused browser cases passed across the final runs (`/tmp/followup-browser-final.log`, `/tmp/followup-new-ui-final.log`). Earlier failures were stale text assertions and a new test racing opening dialogue; these were corrected and rerun. Browser tests ran headlessly with isolated contexts.
- Production build, data validation and data parity passed. Lint reported zero errors; repository-wide warnings include existing tools/art content.
- Additional unit coverage checks draw diminishing returns, physical/hybrid trait eligibility, accessory transaction rejection/double claims, bundle overflow, preserved roster order and outcome-first history labels.
