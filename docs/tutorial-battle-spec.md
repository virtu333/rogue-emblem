# Tutorial Battle — Feature Spec

**Status:** Draft (Not Implemented)  
**Context Sync (2026-02-13):** Tutorial mode requirements remain compatible with current runtime; it should explicitly disable reinforcements and skip run rewards/meta progression.

## Problem Statement

New players are dropped into a real battle with no interactive guidance. The existing How to Play is 4 pages of text, and the 12 contextual hints fire once each during normal play — but neither teaches the moment-to-moment loop of *select unit → move → attack → end turn*. Players who don't already know Fire Emblem conventions will lose their first battle before they understand the controls, creating a frustrating first impression and likely churn.

## Goals

1. **Teach the core loop** — A new player who completes the tutorial can move a unit, attack an enemy, and end their turn without external guidance.
2. **Low friction** — Tutorial is optional, accessible from the Title screen, and completable in under 3 minutes.
3. **Minimal new code** — Reuse BattleScene (already supports `runManager=null` + standalone roster) with a `tutorialMode` flag that triggers scripted hints at the right moments.
4. **One-time encouragement** — First-time players see a prompt nudging them toward the tutorial; returning players can replay it anytime.

## Non-Goals

- **Not a campaign prologue.** This is not a story-driven intro mission. No dialogue, no narrative framing.
- **Not a comprehensive reference.** Advanced topics (weapon triangle details, skills, promotion, meta-progression) belong in Help/How to Play, not here.
- **Not a forced gate.** Players can skip it entirely. No rewards or unlocks are tied to completing it.
- **No new art assets.** Uses existing sprites, tiles, and UI. No custom tutorial map textures or character art.

## User Stories

**As a first-time player:**
- I want an optional guided battle so I can learn the controls before risking a real run.
- I want each step explained one at a time so I'm not overwhelmed by text walls.
- I want the tutorial to feel like the real game so the skills transfer directly.

**As a returning player:**
- I want to replay the tutorial if I forgot the controls after a break.
- I don't want the tutorial pushed on me every time I open the game.

---

## Requirements

### P0 — Must Have

#### 1. "TUTORIAL" button on Title screen
- Add a new menu button between "HOW TO PLAY" and "MORE INFO" in the Title scene button stack.
- Label: `TUTORIAL`
- On first launch (before `emblem_rogue_seen_how_to_play` is set), show a pulsing "NEW" badge on the TUTORIAL button (same style as the existing HOW TO PLAY badge).
- Clicking launches BattleScene in tutorial mode (see below).
- **Acceptance:** Button visible on Title, launches tutorial battle, no regression on existing button layout/spacing.

#### 2. Tutorial battle configuration
- **Fixed seed** (`battleSeed: 42`) for deterministic map generation — every tutorial plays the same layout.
- **Small map** — 8×6 grid. Objective: `rout` (defeat all enemies).
- **Custom roster (no RunManager):** 2 player units passed via `data.roster`:
  - **Edric** (Lord class, level 3) — Iron Sword + Vulnerary
  - **Sera** (Cleric class, level 3) — Heal staff + Vulnerary
- **2 enemies:** 1 Fighter (level 1, Iron Axe) on a plain tile, 1 Archer (level 1, Iron Bow) near a forest tile.
- **Terrain:** Mix of Plain, Forest, and Fort tiles so terrain bonuses are visible.
- **No fog of war, no reinforcements, no NPC recruits.**
- `battleParams.tutorialMode = true` — this flag is the sole signal for tutorial behavior.
- `battleParams.act = 'act1'`, `battleParams.objective = 'rout'`.
- **Acceptance:** Battle loads consistently with the same layout, 2v2, small map, no crashes. All units have correct equipment.

#### 3. Scripted tutorial hints (sequential, blocking)
Tutorial hints fire via `showImportantHint()` (blocking popup requiring Space/Enter/click to dismiss). They are keyed to game-state events, not timers. The tutorial uses a **step counter** to track progress and avoid re-showing hints on edge cases.

| Step | Trigger | Hint Text |
|------|---------|-----------|
| 0 | Battle starts (after grid renders, before first input) | `"Welcome to the tutorial!\nYou control the blue units. Enemies are red.\nDefeat all enemies to win."` |
| 1 | After step 0 dismissed | `"Click a blue unit to select it.\nBlue tiles show where it can move."` |
| 2 | Player selects a unit (movement range shown) | `"Click a blue tile to move there.\nTerrain matters — forests give +20 avoid and +1 defense."` |
| 3 | Player moves a unit (action menu appears) | `"Choose an action:\n  Attack — fight an adjacent enemy\n  Wait — end this unit's turn\n  Items — use a Vulnerary to heal"` |
| 4 | Player attacks (combat forecast shown) | `"The forecast shows damage, hit %, and crit %.\nConfirm to attack. The defender strikes back\nif they can reach you."` |
| 5 | First combat resolves | `"Nice! Units gain XP from combat.\nAt 100 XP, they level up and grow stronger."` |
| 6 | All enemies defeated (victory) | `"Victory! You've completed the tutorial.\nStart a New Game when you're ready\nfor the real thing."` |

**Implementation notes:**
- Steps 0–1 fire in `beginBattle()` after grid + units are created, gated by `this.battleParams.tutorialMode`.
- Steps 2–5 fire from existing event hooks (unit selection, move completion, action menu, combat resolution) with a `tutorialStep` counter check.
- Step 6 fires from the victory handler, replacing the normal loot/RunComplete flow.
- Hints should use the existing `showImportantHint(scene, message)` from `HintDisplay.js`.
- The hint text should adapt for mobile: step 1 says "Tap" instead of "Click" when `this.isMobileInput` is true.
- **Acceptance:** Each hint fires exactly once in order. Dismissing a hint enables the next game action. No hints fire outside tutorial mode.

#### 4. Tutorial victory flow
- On victory (all enemies defeated), show the step 6 hint.
- After dismissal, transition directly back to TitleScene — **no loot screen, no RunComplete, no meta currency**.
- Set `localStorage.setItem('emblem_rogue_tutorial_completed', '1')` so the "NEW" badge can stop showing.
- **Acceptance:** Defeating all enemies returns to Title cleanly. No save state is created or corrupted. No meta currency awarded.

#### 5. Tutorial defeat flow
- If Edric dies, show: `"Your lord fell! In a real run, this ends everything.\nDon't worry — try the tutorial again from the title screen."`
- Transition back to TitleScene after dismissal. No penalty.
- **Acceptance:** Lord death → hint → Title. No crash, no save corruption.

### P1 — Nice to Have

#### 6. Highlight target tile during hints
- During step 1 ("Click a blue unit"), pulse/highlight Edric's tile to draw attention.
- During step 2 ("Click a blue tile"), pulse a specific recommended tile (e.g., the forest tile adjacent to the Fighter).
- Uses existing `grid.highlightTile()` or a simple tween on a colored rectangle overlay.
- **Acceptance:** Visual indicator draws player attention without blocking input.

#### 7. Skip tutorial button
- Small "Skip" text button in the top-right corner during tutorial (similar to the existing close button pattern).
- Clicking it shows a confirmation, then returns to Title.
- **Acceptance:** Skip works at any point during tutorial. Returns to Title cleanly.

#### 8. "Try the Tutorial?" prompt for first-time new game
- When a player clicks "NEW GAME" for the first time (no `emblem_rogue_tutorial_completed` flag), show a one-time prompt: `"First time? Try the Tutorial first to learn the basics."` with **[Tutorial]** and **[Skip]** buttons.
- Only shown once. Dismissing or choosing Skip proceeds to HomeBase normally and sets `emblem_rogue_tutorial_prompted`.
- **Acceptance:** Prompt appears once for new players. Tutorial button launches tutorial. Skip proceeds normally. Never appears again after either choice.

### P2 — Future Considerations

- **Healing tutorial step** — Add an enemy that damages Sera so the player is prompted to use a Vulnerary or Heal staff. Would add 1-2 more hint steps.
- **Weapon triangle step** — Include a Sword user vs Axe user matchup and call out the advantage in a hint.
- **Interactive tutorial progression** — Lock input to only the "correct" action at each step (guided mode). Much higher complexity.
- **Tutorial for advanced mechanics** — Separate tutorials for deployment, shops, promotion, skills. Each would be its own mini-battle or overlay.

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Tutorial completion rate | >70% of players who start it finish it | localStorage flag `emblem_rogue_tutorial_completed` |
| Tutorial engagement | >30% of first-time players try the tutorial | Compare `tutorial_completed` vs total new slots created |
| First-run survival | Players who complete tutorial survive longer in Act 1 | Compare act1 battle count before first defeat: tutorial completers vs non-completers (future analytics) |

*Note: Current analytics are localStorage-only. Server-side tracking would require Supabase instrumentation (out of scope).*

---

## Technical Design Notes

### What already works
- **BattleScene standalone mode** (`BattleScene.js:159-161`): When `roster=null`, it creates Edric + Sera with default gear. The tutorial just needs to pass a custom 2-unit roster instead.
- **No RunManager required** (`BattleScene.js:131`): `this.runManager = data.runManager || null` — all RunManager calls are null-checked throughout.
- **HintDisplay** (`HintDisplay.js`): `showImportantHint()` returns a Promise, so hints can be `await`ed sequentially.
- **HintManager** is NOT needed for tutorial — tutorial hints are step-based (counter), not one-time-per-slot. The tutorial always shows all hints.

### Key integration points
- **TitleScene** (`TitleScene.js:583-612`): Insert new button in the menu stack. Use `createMenuButton()` helper.
- **BattleScene.beginBattle()** (`BattleScene.js:173`): Add tutorial hint injection point after units are created.
- **BattleScene victory handler** (`BattleScene.js:~5889`): Branch on `tutorialMode` to skip loot/RunComplete.
- **BattleScene defeat handler** (`BattleScene.js:~7145`): Branch on `tutorialMode` to skip RunComplete.

### New code estimate
- **TitleScene.js** — ~15 lines (one new button + badge logic)
- **BattleScene.js** — ~80-100 lines (tutorial step tracking, hint triggers at 6 points, victory/defeat branches)
- **helpContent.js or inline** — Tutorial hint text strings (could live in helpContent.js for consistency, or inline in BattleScene since they're only used there)
- **No new files needed.** No new scenes, no new engine modules.

### What NOT to touch
- MapGenerator — The tutorial uses `generateBattle()` with a fixed seed. No custom map builder needed.
- RunManager — Not instantiated for tutorial. No save/load interaction.
- MetaProgressionManager — No currency earned in tutorial.
- HintManager — Tutorial hints are ephemeral (step counter), not persisted.
- NodeMapScene / HomeBaseScene — Tutorial doesn't touch the meta loop.

---

## Open Questions

| Question | Owner | Notes |
|----------|-------|-------|
| Should tutorial use act1 music or a distinct "calm" track? | Design | Currently 3 act1 battle tracks exist. Could pick the least intense one via fixed seed. |
| Should the tutorial map be fully procedural (fixed seed) or a hand-authored layout? | Engineering | Fixed seed is simpler (no new data). Hand-authored gives more control over terrain placement but requires a new template or hardcoded layout. |
| Should we track tutorial completion in Supabase for analytics? | Engineering | Low priority. localStorage flag is sufficient for MVP. |

---

## Timeline Considerations

- **No hard deadlines.** This is a quality-of-life feature.
- **Dependencies:** None. All required infrastructure exists.
- **Can ship independently** of ongoing reinforcement tuning work (main overlap remains `BattleScene`).
- **Estimated scope:** Small. ~100-120 lines of new code across 2 files (TitleScene + BattleScene), plus hint text.
