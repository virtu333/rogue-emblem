# Changelog

## Unreleased

### Documentation Sync (Feb 2026)
- **Roadmap status alignment**: Updated `ROADMAP.md` to reflect current baseline (`720` tests on `main`), mark Wave 2 map enhancements complete, and track Wave 6 blessings as active PR-branch work.
- **Guide accuracy pass**: Updated `CLAUDE.md` to remove stale `NEXT_STEPS.md` reference and replace outdated fixed test counts with current baseline-oriented wording.
- **Wave 6 branch status note**: Added explicit callout that blessings contract/plumbing work is staged in `agent/wave6-blessings` prior to merge.

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
- **Expanded Weapons**: 51 weapons, throwables, effectiveness, poison, drain, siege, equipped stat bonuses
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
