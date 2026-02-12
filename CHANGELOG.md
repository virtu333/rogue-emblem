# Changelog

## Unreleased

### Weapon Arts + Wyvern + Convoy (Feb 12, 2026)
- **Weapon Arts foundation shipped**: Added weapon art data/system integration, battle command flow, and forecast/execution parity safeguards (including HP-cost timing parity and unlock gating hardening).
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
- **Complete Weapon Stats Display**: All weapon stats (Mt/Ht/Cr/Wt/Rng) now visible in RosterOverlay and UnitInspectionPanel. Hover tooltip for weapon specials (Ragnell, Runesword, etc.). Asterisk indicator (*) for weapons with special abilities in compact panels.

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
