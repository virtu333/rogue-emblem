# UI Cleanup Passes — Spec (2026-07-02)

Three independent patches delivered as **three separate draft PRs** (A → B → C). Branch each from current `main` (post Ruins PR #42 merge if merged; the touched regions do not overlap #42's diff). Commit this spec file with PR A.

User-approved decisions (via design review 2026-07-02):
- **Class lore in Compendium:** inline wrapped lore lines (Foes-tab style), NOT a hover tooltip.
- **Foes tab gating:** hide act bosses until any run (any slot) has reached that act; classes always visible.
- **First-run onboarding:** a brand-new save skips Home Base → Difficulty Select → Blessing Select entirely and lands on the act-1 node map (Normal auto-selected, blessing auto-skipped). Later runs keep the full flow.

All file:line references verified on `main` @ 93c2928 (pre-#42-merge numbering; re-verify anchors after branching).

---

## PR A — "Compendium & UI cleanup" (rendering/layout only, no engine changes)

### A1. Compendium pagination collision + inline class lore

**Current behavior (verified):**
- Panel: 580×420 centered at (320,240) → top=30, bottom=450 (`src/ui/CompendiumOverlay.js:396-399`).
- Content starts y=132 for tabs with a filter row (`:458-461`); footer (Prev/Next buttons + "Page x/y") at navY = top+panelH−28 = **422** (`:1014`).
- Row layout: `linesPerItem × 14 + 2` px per row; per-page and line counts from `PER_PAGE_BY_KEY` / `LINES_BY_KEY` (`:49-55`); tabs absent from the tables default to 10/page, 2 lines.
- **Collision:** Arts (weaponArts), Skills, Class, Terrain, Affixes = 10 × 30px from y=132 → last row bottom **432 > 422**. Foes = 5 × 58px → **422 exactly**. Arms/Items/Lords/Bless (6/page, 3 lines) end at 384 ✓. This is the overlapping-components bug visible on the Arts tab screenshot.
- Class tab renderer `_renderClass` (`:826-848`) draws 2 lines (name/tier + stats/promotions) and **never renders `item.lore`**, even though every entry in `data/classes.json` has a `lore` field (≤160 chars, enforced by `tests/LoreContent.test.js` — budget sized for two wrapped ~84-char lines). Class lore IS already in the search index (`:298`).
- Foes tab already renders multi-line wrapped lore (`:992-995`) — reuse that pattern.

**Change:**
1. 2-line tabs (`weaponArts`, `skills`, `terrain`, `affixes`): add explicit entries → **9/page** (9×30=270 → last bottom 402 ✓).
2. Class tab: `_renderClass` gains **2 wrapped lore lines** below the stat line, Foes-tab pattern, in the established lore color. Use compact 12px line-height for the lore lines so a row = 14+14+12+12+2 = **54px**, and set classes to **5/page** (5×54=270 ✓). If you keep 14px lore lines instead, use 4/page — the invariant below is what matters, not the exact numbers.
3. Foes tab: apply the same compact lore line-height (58 → 54px rows) so 5/page ends at 402 ✓ (or drop to 4/page).
4. **Invariant + regression guard:** for every tab, `contentStartY + perPage × rowHeight ≤ navY − 10`. Add a test in `tests/CompendiumOverlay.test.js` that computes this from the actual tables for ALL tabs, so future tabs can't reintroduce the collision. Update the existing per-page matrix test.
5. Test max-length strings: longest class name + 160-char lore must wrap inside the panel (no overflow past right edge at x=610-ish; check the Foes-tab wrap width used at `:992-995`).

### A2. Home Base Skills tab overflow

**Current behavior (verified, `src/scenes/HomeBaseScene.js`):**
- Lord Skills section `_drawSkillsTab` (`:1202-1338`): exactly 2 cards (selected commander + partner), `cardW=270`, `startX=40` → columns at cx=40 and cx=310. Portrait 40×40 at (cx+20, y+20) origin 0 (`:1240-1246`, only drawn if texture exists — no fallback). Text column starts at cx+66. Buttons at cx+200.
- **Bug:** locked-slot hint `"○ Slot 2 (locked — requires Extra Skill Slot)"` (`:1325-1337`) — 47 chars ≈ 282px at monospace 10px, **no wordWrap**. Card 0's copy (x=106) runs to ~388, underneath card 1's portrait zone (330–370) and text start (376). Card 1's copy (x=376) runs to ~658 — past `TAB_CONTENT_RIGHT_X` (610) and under the `[^]`/`[v]`/"Scroll" rail at x=598 (`drawScrollIndicators`, `:445-483`).
- **Asset note:** `lord_sera.png` is a full-body figure on a transparent canvas; the other 6 lord portraits are opaque busts. At 40×40 Sera renders as a small floating figure over the panel, which reads as overlap. Regenerating her bust is an **out-of-scope art follow-up** — do a code mitigation only.

**Change:**
1. Locked-slot line: shorter copy + wrap, e.g. `"○ Slot 2 — locked (Extra Skill Slot)"` with `wordWrap: { width: 190 }`. Hard requirement: the rendered text must stay inside its own card (no crossing x = cx+cardW−10) and clear of the scroll rail (x<590) for BOTH columns. If it wraps to 2 lines, bump the Skills-tab height estimate (`_estimateTabHeight`-equivalent at `:1960-1964`, lord-card block currently a fixed 80px) so scroll bounds stay correct.
2. Portrait containment: draw a 40×40 dark backdrop + 1px border rect behind the portrait slot (draw it whether or not the texture exists) so transparent/odd-aspect art reads as a contained thumbnail. Apply the same treatment to the Commander section portraits (`_drawCommanderSection`, cards at `:1619` cardW=148, portraits `:1647`).
3. Audit the Commander section for the same overflow class of bug (long strings, 148px cards) and fix anything found with the same technique.
4. Live smoke both states: fresh save (1 slot + locked line) and with Extra Skill Slot purchased (2 slots, no locked line), plus a non-default commander pair if quick (any pair renders identically — layout is positional).

### A3. Node map bottom HUD crowding

**Current behavior (verified):**
- `src/scenes/NodeMapScene.js:55-58`: MAP_TOP=60, MAP_BOTTOM=400. Row y = 60 + yFrac×340; **row 0 (start node) is always centered at y=400** regardless of row count (so Ruins #42's extra rows don't change this).
- Selection ring: RING_RADIUS=20 (`src/ui/NodeMapCursorController.js:10`) → ring bottom **420**.
- Hint text `'Click a node to proceed'` at (centerX, MAP_BOTTOM+20=**420**), 11px, origin 0.5 (`NodeMapScene.js:1339`) → extent ~413–427.
- Lord HUD (`drawRoster`, `:1420-1488`): labels at ROSTER_Y=**425**, HP bars 443–451. `[ Roster ]` button at y=414–428 (`:1301-1310`).
- Net: ring bottom, hint text, and HUD labels stack within ~7px — the crowding in the screenshot.
- `SAFE_BOTTOM_Y=425` (`src/utils/constants.js:24`) exists for iOS Safari landscape home-indicator clearance — **do not raise it**.

**Change:**
- Target invariant: **≥6px vertical clearance** between (a) selection-ring bottom, (b) hint-text bounds, (c) HUD label top, at 640×480 on a 9-row act-1 map (post-#42).
- Suggested lever set (tune to hit the invariant, then prove with a live-smoke screenshot): MAP_BOTTOM 400 → ~382 (frees 18px; rows redistribute automatically), reposition the hint text into the freed band, optionally RING_RADIUS 20 → 17. Keep the hint centered; keep the Roster button clear of the hint's right extent.
- Check hover labels for bottom-row nodes still render on-screen after the shift, and that the top row (boss) still clears the top HUD at MAP_TOP=60 with 9-row acts.

---

## PR B — "First-run fast path" (routing only, no engine changes)

**Rationale (verified):** on a truly fresh save there is nothing to do in the skipped scenes — Valor/Supply are 0 (`MetaProgressionManager.js:115-116`), Hard/Lunatic are milestone-locked so Normal is the only pickable difficulty (`DifficultySelectScene.js:111-137`), and commander choice is meta-gated to Edric+Sera (Banner of Command tier 0). Blessing Select is auto-skipped by decision (it has real options from run 1, but the skip is deliberate onboarding simplification).

**Detection:** fresh slot = `getSlotSummary(slot)` returns null (empty slot) OR `runsStarted === 0 && runsCompleted === 0` (`src/engine/SlotManager.js:102-149`). Fast path fires ONLY then. Any other state → unchanged flow.

**Entry points (both must use ONE shared helper — no duplication):**
- `SlotPickerScene.selectSlot` no-active-run branch (`src/scenes/SlotPickerScene.js:445-452`, currently → HomeBase). Registry meta/hints/activeSlot already set at `:393-400`.
- `TitleScene.handleNewGame` (`src/scenes/TitleScene.js:1153-1200`, currently → HomeBase; sets meta/activeSlot itself at `:1174-1180` — verify it also sets hints; if not, set it the way SlotPicker does).

**Recipe — replicate the Blessing-skip path exactly (`src/scenes/BlessingSelectScene.js:92-108`, `:140-181`):**
1. `metaEffects = meta.getActiveEffects(...)` with the same arguments BlessingSelectScene uses (including the weaponArtCatalog option — copy verbatim).
2. `new RunManager(gameData, metaEffects)` → `startRun({ difficultyId: 'normal', applyBlessingsAtStart: false })` → `chooseBlessing(null)` (sets `activeBlessings=[]`, `_blessingChosen=true`).
3. `transitionToScene(this, 'NodeMap', { gameData, runManager }, ...)` via SceneRouter (never raw `scene.start()`).
4. On transition success only: `meta.incrementRunsStarted()` then `clearSavedRun(...)` — same post-transition order as `BlessingSelectScene:172-179`.

**Why this is safe (encode as tests/comments, don't re-derive):**
- NodeMapScene auto-saves on entry (`NodeMapScene.js:193` persistRunSave) → quit-and-Continue resume works identically to the normal flow.
- The act-1 intro (`runStart` dialogue) triggers in `NodeMapScene.finalizeSceneReady` (`:383-453`) → no story is skipped.
- Add a first-run hint via the HintManager `shouldShow` pattern (see `HomeBaseScene.js:286-300`) telling the player Home Base, difficulty, and blessings open up after this run.

**Tests:** fast-path detection matrix (empty slot / used slot / active-run slot / corrupt run → only the first two fast-path); an assertion that the helper-built RunManager state matches the BlessingSelect skip path (difficultyId 'normal', `activeBlessings` empty, blessing-chosen flag set, roster/nodeMap initialized); runsStarted incremented exactly once. Live smoke: brand-new slot → lands on node map with intro dialogue → quit → Continue resumes to node map; second run (after abandoning/finishing) goes through Home Base normally.

---

## PR C — "Foes tab boss gating" (small meta feature + compendium filter)

**Current behavior (verified):** `CompendiumOverlay._getFoesItems` (`src/ui/CompendiumOverlay.js:224-245`) memoizes all bosses from `gameData.enemies.bosses[act1..act4, finalBoss]` (each stamped `_kind:'boss'`, `_actLabel`) plus all classes. No discovery/progression filtering anywhere; search index (`:282-308`) includes them all. Result: every boss and its lore is visible from a brand-new save.

**Change:**
1. **New milestones** `reachedAct1`, `reachedAct2`, `reachedAct3`, `reachedAct4`, `reachedFinalBoss` via existing `meta.recordMilestone()` (`src/engine/MetaProgressionManager.js:281-285`). Serialization is automatic (`milestones` Set → array in `_save()` `:969-1002`); old saves deserialize to an empty Set — back-compat is "nothing unlocked yet", which is correct. Cloud sync carries the blob unchanged.
2. **Recording hook:** NodeMapScene entry (in/near `create()`): map `runManager.currentAct` → milestone name and `recordMilestone` it, guarded by `hasMilestone` to avoid redundant `_save()` calls. This is real-time (a mid-run pause → Compendium shows the current act's boss), idempotent, and covers resumed runs. Do NOT rely solely on run-end `_applySettledRewardsToMeta` (`RunManager.js:3118-3147`) — it would lag a full run behind. Null-check meta (registry singleton gotcha — standalone/dev routes may have no meta; skip recording then).
3. **Read side:** use `hasAnySlotMilestone(name)` (`src/engine/SlotManager.js:214-226` — direct localStorage read across all 3 slots; the existing Lunatic-unlock pattern from `DifficultySelectScene.js:128-129`) unconditionally in CompendiumOverlay, so Title-screen access (no registry meta — verified TitleScene opens the overlay at `:901` before any slot is active) and in-run access behave identically (cross-slot union). Read once per overlay open (memoize with `_foesItems`).
4. **Gating location:** filter bosses inside `_getFoesItems()` before memoization — the search index builds from `_getItemsForTab()`, so hidden bosses drop out of search automatically (verify with a test). Classes always visible.
5. **Empty state:** fresh install + "Bosses" filter = 0 items → render `"No foes encountered yet."` (UI checklist: handle 0 items). Page indicator must show "Page 1/1", not "Page 1/0".
6. Gate `finalBoss` entries behind `reachedFinalBoss` (both difficulty variants).

**Tests:** milestone round-trip in `tests/MetaProgressionManager.test.js` (existing mock-localStorage pattern); gating tests in `tests/CompendiumOverlay.test.js` using its `makeScene()` factory (`:39-80`): seed slot meta in mock localStorage → assert per-act boss visibility, search-index exclusion of hidden bosses, cross-slot union (milestone in slot 2 unlocks at Title), empty state, and classes always present. NodeMapScene hook test if a scene-level harness exists; otherwise cover the mapping function.

---

## Verification gates (each PR)

1. `npm test` — full suite green (≈4,650 tests; zero regressions).
2. `npm run check:reference`, `npm run check:data-parity`, `npm run sim:fullrun:harness:pr`.
3. 640×480 live smoke with screenshots of each fixed surface (dev server; `?devScene=`/`?qaStep=` routes where useful).
4. Security/PII scan of staged files before each commit; atomic commits; end commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
5. Draft PR per patch against `main`; never push to `main`.

## Repo gotchas that apply here

- SceneRouter is canonical — never raw `scene.start()`.
- Registry singletons (meta/hints/audio/settings) may be null on dev routes — null-check.
- Use `uiDepths.js` constants for any new overlay elements; `escPriority.js` for ESC stacking.
- 'Press Start 2P' at 9px ≈ 8px/char; monospace 10px ≈ 6px/char — test max-length strings.
- Never remove textures in scene shutdown handlers; never iterate+destroy `sound.sounds[]`.
- If any `data/*.json` changes were needed (none are expected in these PRs): surgical line-level edits only, then `npm run sync-data`.

## Out of scope (named follow-ups)

- `lord_sera.png` bust portrait regeneration via the Imagen pipeline (art task; code mitigation in A2 only).
- Proper `node_ruins.png` icon (existing follow-up from PR #42).
- Lore content for skills/weapon-arts/terrain/affixes (no `lore` fields in those data files today).
- Compendium discovery-gating beyond bosses (weapons/classes stay fully visible by decision).
