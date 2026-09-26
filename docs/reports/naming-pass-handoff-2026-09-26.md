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

**The one CI failure:**
- **What failed:** `e2e (run-flow-1of3)` on #130, in `guidance-notes.spec.js` › "Light still names the recruit".
- **Cause:** it is also flaky on main (2 of 3 local runs fail). The test boots three battles within Playwright's default 30 s test timeout.
- **Fix:** `bc5cb4b` sets `test.setTimeout(120_000)`; 18/18 local runs pass.
- **Where it is:** in #130 and #132 only. main still has the flaky test until #130 lands.

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
