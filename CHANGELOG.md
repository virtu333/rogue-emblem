# Changelog

## Unreleased

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
