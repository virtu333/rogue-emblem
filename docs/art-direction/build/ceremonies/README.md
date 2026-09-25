# Ceremonies — build captures

> Captures in this folder are a curated subset; see [CAPTURES.md](../../CAPTURES.md) for the full sets.

Captures of the Ink & Ember ceremonies (see `docs/art-direction/ART_BIBLE.md` →
Ceremonies), taken from the running game. Each file is `<shot>-<W>x<H>.webp` at
three viewports:

- `844x390` — iPhone landscape (`mobilePreview=1`, DPR 2): map area plus the live command rail
- `667x375` — small phone landscape (`mobilePreview=1`, DPR 2): the tightest fit target
- `960x720` — desktop, 640×480 canvas letterboxed at 1.5×

Regenerate against a dev server (port 3202 is the local convention):

```sh
npx vite --port 3202 --host 127.0.0.1 --strictPort
CHROMIUM_PATH=/opt/pw-browsers/chromium node tools/art/captureCeremonies.mjs \
  --base http://127.0.0.1:3202 --out docs/art-direction/build/ceremonies --viewport 844x390m
# repeat with --viewport 667x375m and --viewport 960x720; --only boss,fallen,... limits scenarios
```

The script uses dev routes only (`devScene`, `devNode=boss`, `preset`). Dev routes
have no save slot, so the route map's "Save failed" toast is hidden during
capture; it is not part of any ceremony.

## Shots

| Shot | Moment | How it is reached |
|---|---|---|
| `boss-card` | Boss encounter: dark band, rebuilt bust breaking the frame, **NAME**, epithet, crimson hairline, "Tap to continue" | Real boss node (`devNode=boss`), before the boss's lines |
| `boss-card-longest` | Longest boss name (Knight Commander, "First Lance of the Second Push") | Card shown for that boss over a battle |
| `entity-card` | The Entity: no name card, "· · ·", image torn into drifting slices | Card shown for the Entity over a battle |
| `bossbar` | Boss bar docked at the bottom of the map area | Boss battle after the card |
| `bossbar-chunk` | Gold "just lost" chunk draining after a hit | Boss HP lowered, then the game's own `updateHPBar` |
| `bossbar-enraged` | Ember bar and "Enraged · Turn 12" status line | Turn 12 through the game's own `updateAntiTurtlePressure` |
| `foe-vanquished` | **FOE VANQUISHED** with what is left to do ("Seize the throne with a Lord") | Boss removed through `removeUnit` on a seize map |
| `cutin-crit` | Critical cut-in: eyes strip, speed lines, **CRITICAL**, unit · weapon | `ProcBannerController.showCutIn` in a live battle, hold stretched for the capture |
| `cutin-art` | Weapon-art cut-in (art name in place of CRITICAL) | Same, with a weapon art |
| `cutin-boss` | Enemy cut-in, mirrored, crimson | Same, for an enemy boss |
| `cutin-crit-reduced` | Reduced motion: the static end state, same timing labels | Reduce Motion on |
| `phase-enemy` | Phase band | `showPhaseBanner('enemy', n)` |
| `phase-player-place` | Turn 1 band with the place line | `showPhaseBanner('player', 1)` |
| `victory-routed` | **ROUTED** with turn · par · rank (seize, escape, defend use SEIZED / ESCAPED / DEFENDED) | All enemies removed, then the game's own `checkBattleEnd` |
| `fallen` | **FALLEN** band, name · class, Sera's offer: "Rewind · N left" / "Accept fate" | Edric removed with a rewind charge left |
| `defeat` | Defeat band | "Accept fate" pressed on the offer above |
| `thread-cut` | **THE THREAD IS CUT**: who fell to whom, where and when, over the farewell lines | The RunComplete that follows |
| `result-menu` | The unchanged result menu that follows | Farewell lines skipped |
| `thread-cut-longest` | Longest run-end strings (Astrid · Knight Commander · Imperial Heartland · Act III · Turn 12) | Card forced over a battle — a text-fit check only |
| `thread-holds` | **THE THREAD HOLDS**, the victory counterpart, held alone (no lines) | RunComplete started as a final-act victory |
| `act1-runstart` | Act I title (region · grade name · hairline) framing the run-start lines | Real fresh run on the route map |
| `act3-alone` | An act title held alone (as when its lines were already seen) | Card shown on the route map |

## Policies the captures reflect

- Presentation only: ceremonies never touch game state, RNG, saves or checkpoint timing, and never replay on resume or reload (a resumed boss battle restores the bar silently, with no card).
- Tap, click, Enter, Space, Escape or gamepad confirm/cancel skips; nothing blocks input longer than the ceremony itself.
- Reduced motion and Instant speed show the end state without animation; Instant also halves holds and skips cut-ins entirely (as before).
- On phones ceremonies cover the map area only; the command rail stays in view (inert while a blocking ceremony is up). On desktop they follow the letterboxed canvas.
- Every text line is fitted (Cinzel waits for its font before fitting); the 667×375 shots use the longest strings.
