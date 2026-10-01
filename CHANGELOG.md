# Changelog

## Unreleased

### Area Weapon Arts, Engine (Oct 1, 2026)

- **Balance change: splash and pierce are now each victim's own blow.** Cinder Quake (Burning Quake), Radiant Burst, Barrage, Cataclysm Bolt and Tempest no longer pass on a share of the hit that landed on the target. Each foe in the area takes the art's own strike against its own DEF or RES, terrain, weapon triangle and weapon bonuses. Crits and strike skills no longer carry over, and the art's flat bonuses and passive skills still count. Against a foe built like the target, the numbers match the old non-crit splash. Tempest's effectiveness now reaches fliers in its area, capped at 3× (only the target itself can reach 5×). Cataclysm keeps its fixed 5.
- **Piercing Charge and Doom Thrust** strike the foe behind with their own blow on every landed hit. Doom Thrust now pierces at range 2 as well, though its push still needs it to stand next to the target. Pierce, like before, lands even if the counter then fells its user.
- **Anchored** foes can no longer be pushed or swapped by weapon arts (Overrun, Doom Thrust, Lunge). Before, the affix's protection was never applied.
- **Four new area arts.** Each is taught by a scroll; Cleave and Skewer drop in Acts 2-3, Benediction and Battering Ram in Act 3, and all four can also roll on Steel/Silver weapons:
  - **Sweeping Cleave** (Axe/Sword, Steel, 6 HP, 2 per map): a 50% blow to every other foe next to you.
  - **Skewer** (Lance/Bow, Steel, 6 HP, 2 per map): a 60% blow to up to two foes behind the target on each hit, at any range.
  - **Benediction** (Light, Silver, 6 HP, 3 per map, player only): on a hit, allies next to you heal half the damage you dealt.
  - **Battering Ram** (Lance/Axe, Silver, 6 HP, 2 per map, player only): pushes the target up to two tiles. If something stops it, the target takes 5, and so does a foe it crashes into.
- **Previews before you confirm.** An area art tints the tiles it covers and rings each foe you can see in reach. The forecast lists each foe's damage, KOs and heals, and the board shows them as numbers. A foe hidden in fog is never shown, though it still takes the blow.
- **Groundwork, not yet live: XP for every foe an area art hits.** The rule is built and tested (0.35 of the combat XP for a hit, 0.6 for a kill, at most 75 base per action), but battles don't pay it yet. It turns on, in battles and the sim harness together (`AREA_XP_LIVE`), when the battle scene is wired after the stability PRs land.
- Spec: `docs/specs/aoe-weapon-arts.md`.

### Staff Relocation Visuals (Sep 30, 2026)

- Rescue and Warp preserve each visual element's opacity when moving an already-used ally, so the next turn restores its ready appearance without leaving the sprite or HP bar faded.

### Audio Recording Versions (Sep 30, 2026)

- Returning desktop installs now request exact soundtrack versions instead of replaying old cached placeholder music. Adaptive layers validate recording identity and timeline compatibility; invalid recordings fail cleanly.
- iOS hashes compact audio before bundling. Audio diagnostics identify recording versions and rejected layers.

### Home Base Stat Upgrade Pricing (Sep 27, 2026)
- **Stat upgrades priced by value**: Every lord/recruit growth and flat stat track now costs (value weight x a shared escalating curve), so the next tier of any stat is roughly as good a buy as any other. Weights (DEF = 1): SPD 1.15 (offense and defense), STR 0.8, HP 0.55 growth / 0.85 flat, RES 0.45, MAG 0.4, SKL 0.4, LCK 0.35. SPD costs most (lord SPD flat `250 / 695 / 1460`), MAG/SKL/LCK least (lord LCK flat `125 / 210 / 445`).
- **MAG and LCK tracks**: eight new stat upgrades (lord and recruit, growth and flat) on the same curves: Keen Minds / Lucky Stars, Recruit Arcana / Recruit Fortune, Lord Sorcery / Lord Fortune, Lord Arcana / Lord Providence. Flat tiers unlock at growth tier 3; Lord Arcana also needs Act 1 beaten, like the other offensive lord flats.
- **`sim/metaStatValue.js`**: paired-seed full-run sweep (real run loop) that measures what each stat track is worth in battles won; the weights above blend its results with design judgement.

### Village Ambush + Coverage Hardening (Feb 18, 2026)
- **Village ambush flow**: Shop nodes can become ambush encounters by difficulty (Normal 10%, Hard 20%, Lunatic 25%). Players must win a rout battle before the shop opens, then receive a 20% ambush discount that applies to item prices, rerolls, and forge costs, stacking multiplicatively with blessing discounts.
- **Ambush deterministic fullrun slice**: Added a Hard-difficulty invincible PR slice on seeds 301-312 to continuously gate battle-first ambush shop flow and economy invariants, including a strict `avg_ambush_battles` threshold.
- **Ambush edge-case test coverage**: Added simulation defeat/timeout abort coverage for ambush shop battles, plus generator assertions for intermediate ambush probability and ambush battleParams row/level scaling composition.

### Economy + Inventory + Reclass Sync (Feb 18, 2026)
- **Fallen-unit transfer behavior hardened**: Fallen units now route eligible weapons/staves and consumables to convoy, accessories to the accessory pool, avoid duplicate convoy transfer on deep-equal equipped-weapon edge cases, and preserve blocked equipped items on the fallen unit when convoy is full.
- **Shop sell + capacity UX clarified**: Consumables can now be sold in village shops; sell-list scrolling now uses a unified row model (no dead-scroll drift); shop picker, battle trade, and roster trade surfaces now show labeled capacities (`Inventory x/5 | Consumables y/3`).
- **Shop convoy fallback preserved**: Full unit rows in the shop picker remain selectable so purchases can still route to convoy when personal slots are full.
- **Reclass seal closeout landed**: `starting_reclass_seal` is now present in runtime/public meta upgrade data and validated by run-start regression coverage.
- **Meta economy retune applied**: Updated outlier upgrades and costs, including `Plunder` (`+10% / +20%`, costs `125 / 325`), `War Chest` pricing (`50 / 100 / 150` for flat `+500 / +1000 / +1500`), `Expanded Ranks` (`+3` at `175`), vision charge pricing, and starting-gear economy costs.

### Act 4 + Narrative + Systems Hardening (Feb 15, 2026)
- **Act 4 hard-mode progression shipped**: Added runtime progression support for Act 4 with new templates, terrain hazards, and slide-aware AI behavior.
- **Reinforcement system expanded and hardened**: Added contract validation, scripted boss-map waves, deterministic turn jitter, and parity/state fixes with focused regressions.
- **Boss-map generation safeguards**: Added hybrid arena validation/overrides, boss-only template gating, and deterministic fallback handling for missing objective pools.
- **Act 4 boss follow-up polish**: Trimmed map presentation, routed emperor sprite usage, and added spawn-pressure guards for boss encounters.
- **Narrative flow foundation landed**: Added dialogue system support, act transition narrative hooks, and boss naming updates.
- **NodeMap dialogue input safety**: Node clicks are now queued during story dialogue to avoid skipped or invalid map actions.
- **Weapon Arts expansion (Phase 1/2)**: Added stat-scaling, expanded magic-art catalog coverage, and new tactical-depth arts/combat flags.
- **Weapon Art assignment reliability**: Hardened run-start art assignment and instance-bound selection behavior with dedicated regression coverage.
- **Weapon Art meta wiring split**: Meta upgrade progression for arts was split for clearer unlock flow, with migration-only legacy reference cleanup in docs.
- **Scene lifecycle hardening pass**: Added transition metadata, cleanup contracts, leak detection/audits, crash tracing, SceneRouter facade coverage, and combat NaN guards.
- **Audio lifecycle reliability**: Hardened overlap prevention and delayed-transition behavior with watchdog + scene guard improvements.
- **Mobile controls architecture upgrade**: Added HTML overlay infrastructure, scene context stack handling, listener lifecycle cleanup, ghost-click prevention, and Home Base mobile cancel/menu semantics.
- **Tutorial flow improvements**: Hardened tutorial gate/skip flows, clarified terrain hints and Fort move checks, and added a turn-3 vision-rewind intro step.
- **Help/tutorial discoverability**: Added Eye guidance and help search support, plus tuned chunk-E tutorial rewards.
- **Meta-progression economy updates**: Added a full refund system with UI/tests, split Deadly Arsenal into Rapier/Silver tiers, added Vanguard Cadre + Field Supplies II, and retuned upgrade costs.
- **Economy reward rebalance**: Increased battle/loot/par gold rewards, updated gold multipliers, and tuned War Chest starting-gold scaling.
- **XP tuning for priority targets**: Added a +30% XP bonus for boss/elite kills.
- **Combat/runtime fixes**: Added `resBonus` support, fixed Adept state initialization paths, corrected Rapier cavalry effectiveness text/data mismatch, and fixed lethal-armory export/wiring.
- **Loot/accessory flow fixes**: Restored accessory loot feedback, added accessory pool equip UX, fixed loot quality/category mapping/effect parsing, and hardened legacy migration parity.
- **Battle/UI readability pass**: Added weapon stats in equip menus, weight in attack picker details, tighter equip stat layout, faction base rings, tinted HP bar backgrounds, and richer post-battle recruit/loot card text.
- **Home Base / shop UX polish**: Added meta-upgrade hover tooltips, centered Home Base footer controls, and added NodeMap shop-item hover detail text.
- **Release-gate and regression expansion**: Added CI workflow coverage for unit + harness gates, expanded Playwright scene/node-map coverage, and added economy/mobile/context regression + CLI smoke tests.
- **Harness governance updates**: Added threshold calibration guidance and adjusted sim PR gate thresholds with refreshed reference artifacts.

### Weapon Arts + Wyvern + Convoy (Feb 12, 2026)
- **Weapon Arts foundation shipped**: Added weapon art data/system integration, battle command flow, and forecast/execution parity safeguards (including HP-cost timing parity and unlock gating hardening).
- **Scroll overwrite transaction hardening**: Scroll apply now commits atomically on confirm (no pre-confirm mutation), re-plans at commit time to avoid stale overwrite state, and preserves cancel/failure behavior without mutating weapon slots.
- **Act-based weapon art progression**: Added run-state unlock progression by act and node-map unlock banner notifications.
- **Unlock safety hardening**: Empty unlock states are treated as authoritative (no fallback leak to full catalog), and unknown `unlockAct` values now fail closed.
- **Weapon art contract hardening**: Added engine-level `unlockAct` config validation so malformed act IDs fail closed anywhere `canUseWeaponArt` is evaluated.
- **Enemy art AI guardrails**: Enemy weapon art selection now uses deterministic tie-breaks (score -> lower HP cost -> ID), with explicit regression tests for tie resolution and lethal self-cost rejection.
- **Forecast/execute parity regression coverage**: Added tests that enforce identical post-cost HP skill context between forecast and execution paths, repeated-preview no-consumption behavior, and illegal-candidate filtering in enemy art tie scenarios.
- **Home Base UI declutter**: Removed the non-interactive Arts tab from Home Base to reduce navigation noise while Weapon Arts progression remains handled in run/battle flows.
- **Help discoverability update**: Added a dedicated Help page for Weapon Arts usage, costs, and limits after removing the Home Base Arts tab.
- **Help clarity follow-up**: Clarified Weapon Arts help copy for `Req Prof` vs `Req Mast`, and explicitly documented act-unlock (run progression) vs meta-unlock (active from run start) semantics.
- **Acquisition/meta surface clarity**: Home Base upgrade descriptions now call out Weapon Art unlock side effects (for example, Deadly Arsenal now explicitly indicates it unlocks Weapon Arts).
- **Initial Weapon Arts balance pass**: Tuned `Longshot` and increased legendary art HP costs, with new data-level guardrail tests to prevent reintroducing low-risk dominant picks.
- **Difficulty-aware enemy art frequency**: Enemy Weapon Art usage now scales by difficulty (stricter/less frequent on Normal, more frequent on Hard/Lunatic) with deterministic regression coverage for thresholding and proc-rate behavior.
- **3c polish wrap-up hardening**: Added run-start integration coverage for meta/act unlock availability in battle choices, plus deterministic enemy-art proc roll injection/clamping for safer harness/test behavior.
- **Weapon Arts UX copy polish**: Help page now explicitly calls out that status text explains why an art is unavailable.
- **QA playtest checklist added**: Added `docs/weapon_arts_playtest_checklist.md` as a repeatable smoke path for forecast parity, unlock-source behavior, requirement clarity, legendary/enemy guardrails, and difficulty sanity.
- **Meta-innate spawn wiring**: Shop and battle-loot weapon generation now bind eligible meta-unlocked arts onto spawned Iron/Steel weapons (`meta_innate` source), with deterministic selection and regression tests.
- **Meta unlock surfaced for spawn binding**: Replaced legacy `Arcane Etching` (`weapon_art_infusion`) with `iron_arms` + `steel_arms` + `art_adept`; basic Sword/Lance/Axe/Bow arts now bind to eligible Iron/Steel spawns via the new upgrades, with legacy key support retained only for save migration.
- **Wyvern foundation (no reclass)**: Added Wyvern Rider/Lord integration and deterministic coverage while explicitly deferring Second Seal/reclass scope.
- **Wyvern hardening follow-up**: Promotion/load paths now normalize class-driven state (`moveType`, `mov` sync, tier/proficiencies) to prevent legacy drift; post-normalization weapon relink ensures equipped weapons remain legal.
- **Convoy MVP landed**: Added convoy storage + overflow routing with hardened transaction paths for shop overflow and battle loot pickup failure cases.
- **Accessory flow simplification**: Removed in-battle accessory action; accessory management is now roster-oriented.

### UX / Input Reliability (Feb 12, 2026)
- **Menu click bleed-through guard**: Added one-shot input suppression so UI clicks (weapon picker/menu buttons) do not trigger unintended map actions on pointer-up.
- **Defeat-state hardening**: Added stronger post-defeat input/state guards to avoid softlock-like interaction drift.
- **Title screen polish**: Added `MORE INFO` surface + GitHub link, title-button layout refresh, and desktop notice readability improvements.

### AI Reliability (Feb 11, 2026)
- **Path-aware enemy chase fix**: Enemy AI no longer idles when reaching a target requires temporarily increasing Manhattan distance (common around river/bridge detours). Chase logic now picks a reachable step along the shortest real path to an eventual attack tile.
- **Regression coverage added**: `tests/AIController.test.js` now includes a detour scenario to prevent reintroducing long-distance idle behavior.

### Documentation + Release Sync (Feb 11, 2026)
- **Difficulty foundation shipped on `main`**: Added/landed `difficulty.json`, deterministic modifier wiring, run-state persistence, Home Base difficulty UX, and Lunatic preview lock state.
- **Hard unlock rule tightened**: Hard mode now unlocks only after a true victory run (not partial progress), with guardrails in run-complete and menu flows.
- **Startup hardening + mobile-safe loading**: Added startup telemetry/runtime flags, asset warmup + scene loader split, and watchdog recovery to reduce boot stalls and improve mobile reliability.
- **Wave 6 blessings follow-through**: Blessings telemetry + act hit-bonus integration merged, with associated analytics/tests.
- **Save migration coverage**: Added migration path to backfill missing class innate skills on existing saves.
- **Test baseline updated**: `npm test` now passes at **846 tests** on `main`.

### New Features
- **Complete Weapon Stats Display**: All weapon stats (Mt/Ht/Cr/Wt/Rng) now visible in RosterOverlay and UnitInspectionPanel. Hover tooltip for weapon specials (Ragnell, Runesword, etc.).

### Major Features
- **Turn Bonus System**: S/A/B/C rating per battle based on turn par, bonus gold per act
- **Staff Mechanics Overhaul**: MAG-based healing, limited uses with scaling, 5 staves (Heal/Mend/Physic/Recover/Fortify)
- **Weapon Forging**: +1Mt/+5Crit/+5Hit/-1Wt per forge (max 3), shop forge tab, loot whetstones
- **Help & Onboarding**: 8-tab help dictionary, 4-page How to Play guide
- **3 Save Slots**: Independent slot system with migration from single-save
- **Meta-Progression**: 41 tiered upgrades across 6 categories (Recruits/Lords/Economy/Battalion/Equipment/Skills)
- **Starting Equipment & Skills**: Meta tabs for weapon forge, deadly arsenal, accessories, staff upgrades, skill assignments
- **Supabase Auth**: Username/password login with cloud save sync (3 tables with RLS)
- **Music System**: 21 background tracks with per-act battle/explore/boss music, 18 SFX
- **Recruitment System**: NPC spawn on recruit nodes, Talk to recruit, level scaled to lord
- **Economy**: Shops (buy/sell/forge tabs), reroll, node gold multipliers, loot tables with roster filtering
- **Node Map**: Column-lane system (5 lanes, non-crossing edges), act progression, auto-save
- **Accessories**: 18 items (11 stat-based + 7 combat effect), equip/unequip/trade
- **Fog of War**: Vision ranges by class, fog generation per node
- **Expanded Skills**: 21 skills (6 trigger types), on-defend (Pavise/Aegis/Miracle), scroll consumables
- **Expanded Weapons**: 52 weapons, throwables, effectiveness, poison, drain, siege, equipped stat bonuses
- **Balance Simulations**: 4 sim scripts (progression, matchups, economy, full run)

### UI & Polish
- Animated pixel-art title screen and auth/login screen
- Tabbed unit inspection panel (Stats/Gear, 160px width)
- Roster overlay with portraits, skill tooltips, trade picker
- Danger zone overlay (D key toggle), enemy range on right-click
- Combat forecast with miracle indicator, weapon auto-switch tooltip
- Dynamic roster bar spacing, HP bar gradient

### Bug Fixes
- **NEW GAME scene flow**: Fixed NEW GAME button to go through HomeBase before NodeMap (was skipping meta-progression screen)
- Weapon/consumable cloning (shared reference bug)
- Music overlap on scene transitions
- Node map visual crossing fix (fixed 5-column grid)
- Staff depletion + auto-equip, Miracle reset per battle
- removeFromInventory filter (combat weapons only)
- Recruit level scaling to lord level
- Various UI overflow and positioning fixes
