
## PR #151 merged (Formation pick-up, fog on commit, help pop-ups) — review follow-ups

- Talk: `findTalkTarget` (BattleScene ~6370) offers Talk to a fog-hidden recruit beside a lord who just moved (fog now lifts only on commit). Filter by visibility.
- Shove/Pull: `findShoveTargets` / `findPullTargets` (~5001/5026) test `getUnitAt` on a possibly fogged landing tile; use `seenTileOccupant` like Blink/Warp/Rescue.
- Design sign-off: a unit moving next to a fog-hidden enemy cannot attack it that turn (must Wait); the headless harness no longer reveals on move.
- Formation `moveTo` (~359) clears `heldUnit` before `assign`; a refused assign leaves the held tint until the next redraw.
- Still open from #151: hidden enemies block movement range/paths (needs an ambush-style stop).
- Now unblocked: Formation Menu → pause menu (Save & Exit) and "Back to map" (triage #3).
