# Handoff: item art, naming pass and Soldier class (2026-09-26)

**For:** the consolidation agent reviewing the open PRs.
**State:** PRs frozen at the heads below. Nothing more will be pushed unless the owner asks.

## The PRs

| PR | Branch (head) | What | Depends on |
|---|---|---|---|
| [#118](https://github.com/virtu333/rogue-emblem/pull/118) | `claude/quirky-cannon-qpdh20` (`574bf31`) | Item art wiring: roster accessories as item cards, reward lore/art, trade and battle-rail icons, compendium art | main |
| [#120](https://github.com/virtu333/rogue-emblem/pull/120) | `claude/quirky-cannon-qpdh20-art` (`a384913`) | Nine rerolled item paintings; pixel icons match their paintings | main |
| [#127](https://github.com/virtu333/rogue-emblem/pull/127) | `claude/quirky-cannon-qpdh20-soldier` (`c0b662d`) | Soldier base class; Sage and Battle Monk wield Light; class lineage fix; pc98 `--only` atlas fix | main (independent of the rest) |
| [#130](https://github.com/virtu333/rogue-emblem/pull/130) | `claude/quirky-cannon-qpdh20-chips` (`bc5cb4b`) | Weapon keyword tags and base line on item cards | **contains #118** (merge commit) |
| [#132](https://github.com/virtu333/rogue-emblem/pull/132) | `claude/quirky-cannon-qpdh20-renames` (`9fb50c0`) | Weapon/tome renames (the Armoury Grammar) with a save migration | **contains #118, #120, #130** (merge commits) |

**Merge order:** #118 and #120, then #130, then #132. #127 can go at any point.

The stacking is by merge commits, not rebases. Each later PR's diff shrinks to its own change once its bases land on main. If the owner squash-merges, merge main into the next branch before merging it. That merge is expected to be clean: the later branches carry the same content.

## Integration check (done before this report)

**Text merges:** each branch merges cleanly into current main (`e92add8`, after #121 Formation). #132 and #127 also merge cleanly with each other.

**Octopus merge:** I merged `main + #132 + #127` in a scratch worktree (covering all five PRs). On that tree:
- `validate:data`, `check:data-parity`, `check:reference`, `check:e2e-lanes`, the icon build `--check`, `lint` and `format:check` all pass.
- Unit tests pass: 459 files, 7,559 tests.
- `test:sim` and `test:harness` pass.

A grep of the merged tree for old weapon names in `src`, `data`, `tests` and `sim` found none. Allowed exceptions: the rename table in `ItemNameMigration.js` and archived data.

**Per-branch validation:**
- Every branch passed `test:unit`, `format:check`, `lint` and `build` locally before its PR.
- #127 and #132 also passed the harness/sim gates (`test:sim`, `test:harness`, `test:harness:pr`, `sim:fullrun:pr`).
- Browser specs are listed in each PR body.
- CI: #118, #120 and #127 are green. #130 and #132 were re-running after the fix below.

**CI failures:** see the CI failure log below.

## CI failure log (as of 2026-09-26 22:35 UTC)

The failures below are all browser (e2e) lanes. None reproduced locally on the PRs' current heads. Lint, unit tests, the harness and the static checks have not failed on any of these PRs.

**Where CI stands**
- #118, #120 and #127: green.
- #130 (`bc5cb4b`): lint, test, harness and e2e-lanes are green. The e2e smoke lane passed; the other e2e lanes were queued or running.
- #132 (`69c276f`): the whole run was still queued behind the runner backlog. Every failure below on #132 was on the superseded head `814054d`.

**Failures seen**

| # | Lane / test | Where | Diagnosis | Status |
|---|---|---|---|---|
| 1 | `e2e (run-flow-1of3)`: `guidance-notes.spec.js:284` "Light still names the recruit; Off and legacy helpers-off show nothing" | #130 `d0660b6`; #132 `814054d` | **Pre-existing on main**: 2 of 3 local runs on `origin/main` fail. The test boots a battle in three browser contexts (each wait allows 30 s) inside Playwright's default 30 s *test* timeout, so it times out under load. | Fixed in `bc5cb4b`: `test.setTimeout(120_000)` on that test; 18/18 local runs pass. The fix is in #130 and #132 (merged). main keeps the flake until #130 lands. |
| 2 | `e2e (contracts)`: `battle-contracts.spec.js:91` "phone action contracts › committed trade survives submenu Back, reselection and another Back" | #132 `814054d` | **Not reproduced**: `battle-contracts`, `mobile-shell-contracts` and `contextual-help` pass 18/18 locally with retries off on #132's head `69c276f`. The desktop variant of the same test was flaky (failed, then passed on retry) in the same run. That run was a 13-minute lane under a runner backlog. | Watch. This test drives the battle trade menu, whose rows #118/#130 changed: an icon (#118) and tag text in the detail line (#130). #130's own contracts lane had not reported yet. **If it fails again on a current head, check it first.** |
| 3 | `e2e (contracts)`: `mobile-shell-contracts.spec.js:220` "late phone resize reconciles the map; decorative auth canvas is gone" | #132 `814054d` | **Not reproduced** locally (same run as row 2). None of these PRs touch the resize or auth-canvas paths. | Treat as load-related unless it repeats. |
| 4 | `e2e (contracts)`: `contextual-help.spec.js:69` "earned mastery remains visible above rewards after selection changes" | #132 `814054d` (flaky: passed on retry) | Its first wait (reward dialog visible, 5 s) timed out once. It touches the reward screen, where #118 added lore notes and #130 the tag row. Passes locally. | Watch, as for row 2. |

**Suggested order for the build agent**
1. Wait for the current-head runs on #130 (`bc5cb4b`) and #132 (`69c276f`).
2. If `contracts` goes red again on either, run rows 2 and 4 with `--repeat-each=5 --retries=0` on that head and on `origin/main`:
   - If they fail only on the PR, the likely cause is the trade detail line or the reward-card layout (the tag row sits under the reward name). Check those first.
   - If main fails too, it is a load flake: give the tests a larger budget as in row 1. Never skip them.
3. Row 1 needs no further action once #130 merges.

## Cross-cutting things to check

1. **Item names are identity.** Saves store whole item objects, and weapon-art gates, siege weapons, icons and fx look items up by name.
   - #132 renames 32 weapons/tomes, 2 imbue display names and 1 weapon-art name.
   - `RunManager.fromJSON` runs `migrateSavedItemNames` over the whole parsed save before anything reads it. The walk covers units, convoy, shops, rewards, colosseum mercs, the battle checkpoint, entry state, rewind keyframes and patches, and siege strings.
   - New saves carry `itemNamesRevision`, and the walk skips them.
   - Any other open or future work that adds item names must use the new names; `tests/ItemNameMigration.test.js` fails if an old name reappears in the catalog.
   - The rule is in CLAUDE.md, and the full design is in `docs/specs/item-names.md`.
2. **Generated files. Regenerate them on conflict; never hand-merge.**
   - `public/data/*` via `npm run sync-data`.
   - `data/referenceViewer.json` and `src/data/generated/mechanicsHelp.js` via `npm run build:reference`.
   - Item atlases and `src/ui/itemIconManifest.json` via `node tools/art/icons/build.mjs`.
   - PC-98 portrait atlases, `Pc98PortraitManifest.json` and `portraitVariants.json` via `tools/art/pc98/build.mjs` (#127).
   - Traced sprite atlases and `TracedSpriteManifest.json` via `tools/art/sprite-trace` (#127).
3. **Item paintings are keyed by slug** (`assets/ui/items/hero/<slug>.png` plus the `public/` copy).
   - #132 `git mv`s about 34 of them to new slugs and repaints 5.
   - `tools/art/icons/hero/selections.json` and `prompts.mjs` are keyed the same way.
   - Do not run `tools/art/icons/hero/select.mjs`: it rebuilds selections from raw takes named by the old ids and would drop the renamed entries. Its header now says so.
4. **Class lineage (#127).**
   - Duelist and Paladin now have two bases each (Myrmidon/Cavalier and the new Soldier).
   - A promoted unit records `unit.baseClass`.
   - Mastery, level-10 skills, skill migrations and portrait fallbacks read it through `engine/ClassLineage.js`.
   - Any other open work that reads `promotesFrom` off a promoted unit's class should use `unitBaseClassName` or `promotedFromName` instead.
5. **UI surfaces touched by #118/#130:** `MobileRosterSheet`, `MobileRewards`, `ShopMenu`, `ReferenceMenu`, `BattleTradeMenu`, `CompendiumOverlay`, `MobileBattleHUD`. Other open work on those files is the likeliest conflict source.

## What each PR changes (short)

**#118 (wiring)**
- Accessories (equipped and pool) render as item cards.
- Scroll cards get "About this item".
- Reward lore appears under the cards, with a picture on reward steps.
- Trade rows and battle-rail submenus get icons.
- Compendium list icons and floated art.
- Accessory detail reads like the shop.
- Test: `tests/ItemArtSurfaces.test.js`.

**#120 (art)**
- 9 hero paintings rerolled on the Pro model.
- Named icon silhouettes (katana, gust, bolt, falchion, viking, twin, glaive, barbs, throwing, hook), set in `iconDefs.mjs` and `itemGrammar.mjs`.
- `treat.mjs --publish --only`.

**#127 (Soldier)**
- `data/classes.json`, `recruits.json`, `enemies.json` and `dialogue.json` entries.
- Sage and Battle Monk proficiencies.
- `ClassLineage.js`.
- Art: traced sprites, legacy and PC-98 portraits, crest.
- Tools: `gen-class-sheet.mjs`, `gen-legacy-base.mjs`.
- `tools/art/pc98/build.mjs --only` now always recomposes atlases, pinned by a test that every atlas frame holds its own portrait.

**#130 (tags)**
- `engine/ItemKeywords.js` (pure; reads the same `special` text `Combat.js` does).
- `ui/itemKeywordChips.js` and `itemKeywords.css`.
- Wired into the shop, rewards, roster/convoy, trade and compendium.
- The help page "Weapon Specials" becomes "Weapon Tags".
- The phone battle rail is unchanged (it keeps a one-line, 36-character brief).
- Spec: `docs/specs/item-keywords.md`.

**#132 (renames)**
- The table is `ITEM_RENAMES` in `engine/ItemNameMigration.js`. Imbues: Keen → Cruel, Sundering → Armorbane (ids unchanged).
- Wind/Tempest blades get a "Wind gust" rule instead of "Throwable" (text and tag only; combat unchanged).
- Tome sound effects are picked by the element in the name.
- 5 repaints plus new icon shapes: jian, hooked quillon, bill hook, and a steel Tidebreaker.
- Lore rewritten for 5 items. The old Swordreaver line wrongly said swords beat lances.
- Historical docs keep the old names on purpose.

## Open decisions for the owner

- **"Legend" vs "Relic":** reward cards label the tier "Legend · Weapon", while the new base line says "Relic Sword".
- **Renames not yet reviewed:** accessories and supplies (Dracoshield, Angelic Robe, Energy Drop, Speedwing, …), staves, scrolls and class names. The naming ledger artifact holds the proposals.
- **Dark Mage** and a Dark magic type (backlog).

## Follow-ups outside these PRs

- **Lore bible:** the branch `claude/kind-ride-yejupz` (not merged) names about 20 relics by their old names (Brave Sword, Soulreaver, Excalibur, …) and needs a sweep after #132.
- **Flaky guidance test on main:** it stays flaky until #130 lands (see above).
