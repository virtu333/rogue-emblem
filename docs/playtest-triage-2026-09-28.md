
## PR #151 merged (Formation pick-up, fog on commit, help pop-ups) — review follow-ups

- Talk: `findTalkTarget` (BattleScene ~6370) offers Talk to a fog-hidden recruit beside a lord who just moved (fog now lifts only on commit). Filter by visibility.
- Shove/Pull: `findShoveTargets` / `findPullTargets` (~5001/5026) test `getUnitAt` on a possibly fogged landing tile; use `seenTileOccupant` like Blink/Warp/Rescue.
- Design sign-off: a unit moving next to a fog-hidden enemy cannot attack it that turn (must Wait); the headless harness no longer reveals on move.
- Formation `moveTo` (~359) clears `heldUnit` before `assign`; a refused assign leaves the held tint until the next redraw.
- Still open from #151: hidden enemies block movement range/paths (needs an ambush-style stop).
- Now unblocked: Formation Menu → pause menu (Save & Exit) and "Back to map" (triage #3).

## Decisions on the #151 follow-ups (Dave, 2026-09-28)

- **Talk / fogged recruit:** reveal the recruit NPC on fog maps (always visible), rather than filter Talk. A recruit banner already marks the recruit from turn 1 through fog (BattleScene, "Recruit battles: a banner marks the recruit"); extend it so the NPC sprite itself is never fog-hidden. Low priority; acceptable to leave as is meanwhile.
- **Shove / Pull:** fix — landing-tile checks go through `seenTileOccupant` (like Blink/Warp/Rescue).
- **No attack on an enemy only the new tile would reveal:** intended. Keep.
- **Hidden enemies and movement:** new design. The blue range and paths ignore hidden enemies (no gaps). A move that runs into a hidden enemy stops on the last free tile before it, the enemy is revealed, and the unit can then act normally (attack, Wait, items). Replaces `buildUnitPositionMap` blocking hidden units; needs the ambush stop in the move/path code, Canto, the AI (AI sees everything, unchanged) and the headless harness.
- **Help pop-ups on iPhone: still broken after #151.** The text is present but the pop-up UI still blocks reading most of it. Needs a real-WebKit repro (Playwright `--browser=webkit` locally, or TestFlight) and a screenshot from Dave. High priority, first in the next round.

## Next round, in order

1. iPhone help pop-ups (still unreadable).
2. Formation Menu → pause menu (Save & Exit, Settings, Help) and "Back to map" (triage #3).
3. Shove/Pull fog fix.
4. Hidden-enemy ambush stop (movement design above).
5. Then Wave 2 (readability) or the difficulty ladder (Dusk / Nightfall / Black Sun), Dave to pick.
