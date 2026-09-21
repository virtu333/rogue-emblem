# Build 13 — inspection, crit text and route pacing

## Changes
- Title: Save Slots follows New Game, Records and More Info have separate aligned corner buttons. A single active run keeps Resume; multiple saves use Save Slots. More Info retains controls/objectives/meta help that Compendium does not replace.
- Mobile enemy/unit inspection uses the DOM sidebar's View unit details action; the duplicate small canvas popup is suppressed. Shared inspection state, fog gating, selection, Back and range pinning remain intact. Desktop keeps its existing inspection surface.
- Lord crit/kill quips use screen coordinates, wrap, and clamp their full bounds plus upward drift. Text is 13px instead of 10px. Presentation text keeps UUID allocation outside gameplay RNG.
- New act maps disallow shop→shop, church→church, duplicate service options from a shared parent, and three-service chains (including Colosseum). Prefer a different service; otherwise create a fully initialized battle before village ambush assignment. Recruit nodes, edges, opening and pre-boss ruins are preserved. Existing saved maps are not regenerated.

## Route design review
Keep shop→church and arena→shop: they offer different services and can support recovery or spending winnings. Do not remove normal battle streaks merely for visual variety: battles fund later services and offer XP. Guaranteed shops on every route, church usefulness for healthy parties, and chains of elite battles deserve a separate economy/difficulty pass rather than silently altering them here.

Seeded comparison (1,000 maps per act, no optional arena/ambush configuration): average shops per graph falls from 2.26 to 1.79 in Act 1 and 3.53 to 2.70 in Act 2. Graphs with no shop decrease from 91 to 79 and 10 to 5 respectively. Recruits are unchanged. This is graph-wide, not a promise of service access on every chosen path.

## Verification
- 5,690 tests passed across 342 files.
- Route contracts checked on 1,000 seeded acts, with arena and ambush options enabled.
- Nine headed browser cases passed, including title button bounds, How to Play, saved-run navigation and conflict handling, plus: SE sidebar details/pin/close and top-edge quip, mobile selection/planning, pin lifecycle, desktop keyboard pin/global danger.
- Targeted lint and UI theme check passed. Physical-phone readability remains useful follow-up.

No save schema changes. No GitHub push.
