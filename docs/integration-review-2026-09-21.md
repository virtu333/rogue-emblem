# Integration Review — Accumulated Local Slices (September 21, 2026)

Scope: everything uncommitted on top of `b5d42c9` (S0 + remap, U1–U5, onboarding, balance tweaks, journey harness). Three tracks: full gate run, live playthrough (fresh install → battle → suspend → resume, 812×375), and an adversarial file-by-file integration review with standalone repros. No files were modified.

**Verdict: the work is fundamentally sound — architecture, contracts, and test discipline all held up — but four findings should be fixed before the next TestFlight build, led by two cloud-settings bugs that would silently undo S0 for logged-in players.**

Gates: 5,518 unit tests pass; `check:reference`, `check:data-parity`, `sim:fullrun:harness:pr` all pass.

---

## Fix before next TestFlight build

### F1 (HIGH) — Cloud settings hydration re-clobbers the new flags on every login
`applySettings` (`src/cloud/CloudSync.js:177-186`) writes `normalizeSettings(cloudData)` unconditionally — no freshness guard, unlike run/meta. And the local migration write-back (`SettingsManager.js:47-48`) runs before `onSave` is wired (`BootScene.js:713` vs `:746`), so the migrated shape never reaches the cloud. A pre-S0 cloud row (`{reducedEffects:true}`) therefore re-derives `reduceMotion` from the OS media query and `effectsQuality` from the legacy flag **on every login**, overriding explicit local choices until the user happens to toggle something. Fix: freshness guard on settings (mirror the meta `savedAt` pattern) + push the migrated blob once `onSave` is wired.

### F2 (HIGH) — Background cloud refetch overwrites settings under a live SettingsManager
`main.js:386-389` assumes "merge guards make late application safe" — true for run/meta, false for settings. A late `backgroundCloudRefetch` rewrites `emblem_rogue_settings`; the in-memory `SettingsManager` never re-reads; the next toggle pushes the stale copy back over the fresh one, locally and to the cloud. Pre-existing hole; S0/U5 widened it from 3 keys to 6. Fix with F1 (same freshness mechanism, plus re-hydrate or merge into the live manager).

### F3 (HIGH) — Forecast projection misses three damage-changing procs; can say "survives" when the unit dies
The `simpleExchange` blocklist (`src/engine/Combat.js:945-976`) omits **`aether`**, **`flare`**, **`seraph_strike`** — all on-attack procs that change HP outcomes, including on counters. Verified repro: attacker at 10 HP vs a defender with aether shows "If all hits land: 1 HP (no crits/procs)" and dies in the actual resolution; `counterRisk` (`forecastDisplay.js:26-37`) emits no warning either. The existing test (`ForecastDisplay.test.js:37-51`) asserts the projection should be null for exactly this class. Fix: add the three ids to the blocklist (+ regression tests per skill). Companion: the zeroed early-return forecast (`Combat.js:721-750`) lacks a `display` block → weaponless attackers get a wrong fallback string.

### F4 (MEDIUM-HIGH) — Hint/tutorial seen-state is not cloud-synced
`HintManager` is localStorage-only (`emblem_rogue_slot_<n>_hints`); cloud `TABLES` covers run/meta/settings. Sign in on a second device with a veteran save → the full tutorial-lesson set and every one-shot hint replays. Also `HintManager.reset()` sets `isNew = false` before clearing, so "Reset hints" suppresses tutorial lessons while replaying contextual hints. Fix: sync the seen set (piggyback on meta or a fourth table) and correct the reset semantics.

## Fix soon (next slice window)

- **F5 (MED)** — RESUME auto-select: untracked `delayedCall(0)` fires on a possibly half-built scene (`SlotPickerScene.js:47-55`; shutdown doesn't cancel it); it races the background cloud refetch's conflict detection (manual picking gives the fetch human-speed slack, RESUME doesn't); and the conflict prompt is `hasDOMHost()`-gated, so a canvas RESUME tap silently resolves a real cloud divergence in favor of local.
- **F6 (MED)** — `TitleScene.js:734` computes `hasSlots` before the slot sweep at `:758-761`, whose `getSlotSummary` deletes corrupt slots — a corrupt-only save renders CONTINUE into an empty picker and skips the START-FIRST-RUN treatment.
- **F7 (MED)** — U4×U5 conflict: level-up stagger is a raw `setInterval(120)` — unscaled by battleSpeed, so Instant makes fights faster and level-ups comparatively slower, plus two clicks (Reveal→Continue) per level. ESC now triggers `advance` instead of dismissing, and the header close button was removed, so the popup has no one-press exit. Canvas fallback doesn't stagger at all (presentation divergence). Fix: drive the stagger through the combat-timing multiplier, collapse Instant to a single revealed popup, restore ESC-to-dismiss after reveal.
- **F8 (LOW-MED)** — Double-shortening: `animate_strike_miss_hold`/`animate_strike_hit_hold` (`BattleScene.js:8577, :8670`) keep their `reduced ?` ternaries *and* sit in `COMBAT_WAITS` — reduceMotion+Fast leaves the damage number ~40ms on screen. Delete the ternaries (the multiplier is the single mechanism everywhere else).
- **F9 (LOW-MED)** — `COMBAT_WAITS` allowlist gaps: ballista floats, entity splash, deathburst chains, enemy break/move-step, poison/terrain/acid damage, promotion/skill banners all ignore Instant — a Lunatic enemy phase runs at full speed. Add the labels.
- **F10 (LOW-MED)** — `lastRevivalResult` written (`RunManager.js:2974`) and read (`ChurchCommands.js:50-51`) but missing from the `toJSON` whitelist — revive → refresh → Church panel renders a blank skills line.
- **F11 (LOW-MED)** — CI gap: **13 new e2e specs are in no CI invocation** (ci.yml runs smoke + fixed lists; release config matches only `mobile-release.spec.js`). battle-speed, effects-settings, forecast-parity, progression-reveal, selection-planning, tutorial-lessons, hint-reading, reward-menu, shop-reentry, compendium-stats, escape-exits, item-explanations-revival. Add an explicit bundle script + ci.yml step. Also: `get/setReducedEffects` now have zero src callers (delete), and `OverlayLifecycle.test.js:89` still stubs the legacy accessor so the overlay silently takes fallback branches.

## Low / cleanup

- **F12** — Deployment memory: no cap guard before adding the commander (`DeploymentSelection.js:11-14`; unreachable today), roster de-dup renames (`Sera → Sera II`) don't rewrite `lastDeployment`, "Clear" is in-memory only (re-entry re-applies memory; `restore.disabled` never refreshed), neither button on canvas.
- **F13** — `+XP` float at `BattleScene.js:8869` uses raw `add.text` (not `presentationText`) — settings-independent draw count so no desync, but inconsistent; and `presentationText`'s capture/restore of `Math.random` would clobber a synchronous `reseedBattleRng` — one refactor from fighting.
- **F14** — `lastDifficulty` cloud merge is last-writer-wins among `Math.max`/union neighbors; `rememberDifficulty` adopts foreign disk state twice, and the second adopt can discard the just-made choice under concurrent tabs.
- **F15** — `showCutIn` still plays a full portrait strip at `effectsQuality: 'low'` (only the slide is removed) while every overlay path hard-returns — inconsistent quality axis.

## Live-playthrough notes (experience level)

- The forecast is the standout improvement: projected end-HP + "(no crits/procs)", triangle explained in words, planned hits, in-forecast weapon cycling, explicit confirm.
- Resume flow is excellent: reload → `RESUME · ACT 1` → two taps to an exact mid-turn restore.
- **Title ordering:** NEW GAME sits above RESUME and holds default focus when an active run exists — resume should own the top slot and focus.
- **Modal train:** battle start stacks 2–3 Field Notes modals back-to-back (village, par, rewind); consider merging or deferring the par note to turn 2.
- Settings copy is genuinely good; all three controls verified working and persistent.

## Verified clean (for reviewer confidence)

Single-scaling of combat waits (watchdogs computed unscaled — Instant can't trip timeouts); `_combatSpeedSnapshot` re-entrancy; camera-shake RNG fix complete — no path found where gameplay RNG draw count varies across the 12 setting combos; `finishStrike` cleanup and shutdown wiring; forecast exchange ordering incl. kill-before-counter; brave/multiHit/arts/accessories/poison-imbues/drain genuinely excluded; Clever-trait migration deterministic, RNG-free, idempotent across load/hydration/suspend/rewind; `lastDeployment` round-trip + min/max re-checks at click time; `lastDifficulty` lock guards; auto-select double-fire guards; revival catch-up RNG isolation. Targeted suites 54/54.
