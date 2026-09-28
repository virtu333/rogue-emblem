# Round 3 playtest fixes — implementation and verification

Base: `e92add8` (main through formation #121 and forecast purity #123). Branch: `fix/playtest-round3`.

Implements WS1–WS8 from `claude/beautiful-ritchie-j9v4ig:docs/specs/playtest-round3-fixes-2026-09-26.md`. Work is isolated from the primary checkout and other agents' branches. No art regeneration, balance tuning, portrait-mode work, or shared desktop/mobile battle-panel migration is included.

## Changes

| Workstream | Result |
| --- | --- |
| WS1 — legacy recruit identity | Restore reconciles Talk recruits by battle entity ID and name, reserves existing UIDs before allocation, and preserves the distinction between a recruit and a same-name hired unit. Shared by suspend, Vision, and timeline restore. No gameplay RNG. |
| WS2 — native deletion mirror | A newer deletion watermark is persisted even when both cached values are null. A later relaunch cannot revive the deleted newer run. |
| WS3 — The Last | Requires at least two allied deaths in that battle, alongside the sole surviving non-lord and deployment requirements. The death counter is already rewindable. |
| WS4 — lean levels | Audited the 174 lean-level lines; removed claims of zero growth, retained character voices, and pinned the engine's guaranteed single gain. |
| WS5 — desktop battle | Visible `[R] Rewind` and Vision resource labels; footer degrades by whole shortcuts; stationary hover refreshes after HP changes, movement and removal; item rows explain effects and action cost; Confirm Attack uses a readable primary palette. |
| WS6 — healing | Desktop hover and phone target rows show the real capped, blessing-adjusted healing result. Cure explains conditions removed. Back remains safe; repeat activation spends one use. Warp/Rescue and Fortify retain their existing flows. |
| WS7 — forecasts and route services | Phone decision stats precede steppers and fit at 844×390. Eligible arts project HP/KO. Modifiers have explanations. Route lord cards select that unit. Current Church/Ruins nodes can be re-entered without refreshing limited services or stock. |
| WS8 — decision clarity | Scout flavor avoids fabricated encounter facts; Hunters/Captain explain their meaning; rank copy is clearer and skill scrolls omit fake rank requirements. Art binding takes one confirmation unless a replacement must be selected. Tutorial range/casualty copy is corrected. All forge choices preview combat-stat impact. |

## Deliberate corrections to the proposed implementation

- **Art projections are fail-closed.** Do not simply remove the weapon-art exclusion. Poison Strike and other scene-level hooks are applied outside `resolveCombat`; a resolver-only parity check misses their later effects. Only arts with no external effect hooks and no vengeance/drain/order-dependent behavior opt in. Unknown hooks remain excluded. The shared “all hits land; no crits/procs” assumption stays visible.
- **Identity is never repaired using a name alone.** Nonempty battle entity IDs and matching names link recruit records. Existing UIDs are reserved before any fresh allocation, preventing ordering-dependent collisions.
- **Returning to a service is not a fresh visit.** Church promotion counts and Kindle usage, plus Ruins stock/prices/forge/restock counts, survive leave and save reload. Re-entry stops after traveling onward or during battle.
- **A third art slot is still an empty slot.** The simplified binding flow tracks successful binding explicitly; filling the final slot must not open a replacement dialog after spending the scroll.
- **Desktop shortcut fitting is cached.** Re-measuring candidate strings every frame would needlessly redraw Phaser text textures. It is recalculated only when its available space, mode, or font changes.

## Regression evidence

The new assertions were also run on a temporary checkout of the base revision, without changing the primary checkout:

- WS1/WS2: six failing identity/deletion assertions before the fixes; 235 relevant tests green afterward.
- WS3: the casualty-free and one-casualty cases fail the old deed condition; 68 deed tests green afterward.
- WS4: the lean-level content guard rejects old zero-growth lines; the guaranteed one-stat growth case is pinned.
- Desktop/item/forecast/route/content: ten failures on the old code covering absent item effects, hidden shortcut, low-contrast Confirm, absent modifier tooltip, absent safe-art projection, unexplained recruit tags, wrong selected roster unit, and misleading voice/scout copy.
- Browser regression cases cover HP preview and one-use healing, forecast numbers above the fold, one-confirm art binding (including the final slot), and church re-entry.
- Forge previews are hand-calculated in tests (STR 7 + Might 8 = Attack 15 → 16; Hit 99 → 104; Crit 4 → 9; weight improvement AS 1 → 2).

## Verification

### Checks run

- Full unit suite: **7,531 passed, 2 failed** across 458 files. Both failing generated-art checks also fail at the unchanged base `e92add8`: `CombatFxGenerator` atlas frame packing and `ItemIcons` PNG byte parity. This branch does not regenerate either asset family.
- Final focused unit pass: **179 passed** (Vision, item menu, healing previews, Loom, forge/rank helpers, forecast projection and forced-art resolution parity).
- Harness: **163 passed**. Simulation tests: **35 passed**.
- Production build, formatting, data schema/cross-reference validation, 29-file runtime data parity, and e2e lane coverage passed. Lint: **0 errors**, 360 existing warnings.
- Browser coverage: the five affected broad lanes (`contracts`, `presentation`, `battle-input`, `art`, `run-flow`) ran **353 cases**. Initial result: 335 passed, 16 failed, 2 flaky. Most failures were old copy/layout assertions; those were updated to preserve the intended outcome checks. The follow-up 96-case run (corrected assertions plus the complete `mobile-ui` lane) had 93 passes, two baseline deed-layout failures, and one remaining stale portrait-size assertion. After updating that assertion from 48 px to the specified 32 px compact size, the entire mobile battle HUD file passed **13/13**. All newly added regression cases pass. These counts are separate runs, not additive unique-test totals.
- Regression assertions were run against the old code and demonstrated failures before the fixes. The baseline runs use a separate archived checkout, not the user's primary checkout.

### Remaining failures to carry into consolidation

1. **Generated-art unit checks:** atlas frame packing / item icon bytes, reproduced on base. Re-run after the new art PRs are combined; do not regenerate assets just to silence these checks.
2. **Atmosphere browser cases:** three `battlefield-presentation.spec.js` cases fail on both base and this branch (live mood/settings, atmosphere RNG check, night-light movement/rewind). The failure does not by itself prove RNG is changing; investigate the assertions/setup and actual runtime result together.
3. **Deed-card text overflow:** `ceremonies.spec.js` longest small-phone card and `deeds.spec.js` desktop victory title have intermittent overflow. Reproduced on the base in a three-repeat comparison (two phone failures and one desktop retry). No ceremony layout fix is included in these workstreams.
4. **Existing desktop input flakes:** attack-flow alternate-weapon confirmation and weapon-selection click/release each needed a retry in the broad run. Alternate-weapon confirmation also failed in an earlier base run and passed the final focused rerun. Keep these visible when running consolidated CI.

These are recorded limitations, not a claim of an entirely green tree or TestFlight readiness.

Physical iPhone/WKWebView testing is not claimed. Browser checks use isolated Playwright contexts; they do not use the user's saves or foreground browser.

## Handoff to the consolidation reviewer

### Branch boundary

- This is the stopping point for **WS1–WS8 only**. No additional gameplay/balance, portrait-mode rollout, art regeneration, or ceremony redesign is folded in.
- Tested base: **`e92add8`**. During the final checks, `origin/main` advanced to **`538d036`**, adding #126, #118, #120 and #127. Those changes are **not merged into this branch**. Results above apply to this isolated branch; repeat the key checks after consolidation.
- A non-mutating `git merge-tree` preview against `538d036` completed without textual conflicts. This is not integrated runtime validation; the behavioral overlaps below still need review.
- The first four commits independently carry identity repair, native deletion repair, the deed rule, and lean-level copy. The remaining UI work is grouped because it shares forecast/menu components and tests.
- The implementation report and PR description are the consolidation handoff. Code through `01b06c9` was tested; a following documentation-only commit records these results.

### Concrete overlap points

| Concurrent work | Review when combining |
| --- | --- |
| Main #118, item art on every surface | Preserve item images while retaining heal rows, compact forecast stats, single-confirm binding and forge impact text in `MobileBattleHUD`, `MobileRosterSheet`, `MobileRewards`, `mobileBattle.css`, and submenu tests. |
| Main #127, Soldier/class changes | Merge `dialogue.json` by entries so new class voice pools survive the lean-level/scout copy audit; regenerate `public/data` from source. Preserve both changes to `RunManager` and `growthContent`. Extend content guards to new voice pools if needed. |
| #133, forecast/save/shop polish | Direct overlap in `forecastDisplay`, both forecast surfaces and `ShopMenu`. Keep its weapon-switch notice alongside our shared HP assumption and modifier details. Reconcile its rank wording with `shopRequirementLabel` rather than printing two requirement lines. `NodeMapScene` must retain selected-unit roster opening. |
| #130, weapon identity/effect chips | Same item/forecast/roster/reward surfaces. Avoid duplicate mechanics copy, retain our one-use action note and art-binding confirmation behavior, and keep stats above the phone forecast fold. |
| #99 / #122 / #129, portrait battle and shell | Keep the new `HEAL_RESOLVING` guard, content-sized Vision dialogs, heal row selection and compact forecast layout while preserving rotated-board/history coordinates. This branch does not validate their combined portrait behavior. |
| #124 / #128, portrait route and lists | `NodeMapMenu`, `loomModel`, `loom.css`, and roster binding overlap. Keep per-unit route selection, service re-entry and readable Hunters/Captain disclosures in the bottom-sheet version. |
| #125, portrait choice cards | Retain forge outcome previews in the portrait reward picker. |
| #132, weapon names/migration | No direct production-file overlap found, but many fixtures use literal weapon names. Update those consistently after migration; retain independent expected-stat values. |
| #134, music | Direct overlap in help copy; keep Vision/resource wording. Its ceremony work is a useful place to recheck the existing title-overflow failures. |

### Invariants worth adversarial attention

- Legacy recruit repair reserves existing IDs first and never links by name alone; same-name mercenary/recruit casualty paths must remain disjoint through suspend, rewind, completion and revival.
- Tombstones advance their deletion watermark even when both values are null; failed writes must still retry.
- Safe-art projection is opt-in. Do not undo the exclusion for external post-combat damage/status/movement hooks while merging forecast changes. No preview may consume gameplay RNG or equip a weapon.
- Current-node Church/Ruins re-entry retains all limited service state across save/reload; it becomes unavailable after moving on.
- Art scrolls consume exactly once, including filling slot three; replacement is explicit and Back consumes nothing.
- Healing rows use the resolver's capped/blessing-adjusted result. Cure describes conditions, not HP. Double activation and stale target selection must not consume another use.
- Keep ordinary allies' Church revival distinct from commander defeat, and Vision resource counts distinct from the Rewind action.

### Suggested consolidated verification

Run format/lint/data checks and the full unit suite, then the `contracts`, `presentation`, `battle-input`, `mobile-ui`, and `run-flow` browser lanes. Recheck art lane failures separately after #118/#120. Prioritize: formation → battle → suspend/rewind; duplicate-name casualties; native delete/recreate/delete; phone forecast with two weapons/two targets; Church/Ruins leave/reload/re-enter; third-slot/replacement art binding; heal/Cure Back and double tap. Finally test the combined portrait branch on a physical iPhone before any release claim.
