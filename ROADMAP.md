# Rogue Emblem - Roadmap

## Current State

Phases 1-9 complete. 888 tests in suite on `main` baseline (Feb 12, 2026). Deployed to Netlify with Supabase auth + cloud saves. 41 meta upgrades across 6 categories, 52 weapons, 21 skills, 18 accessories, 29 classes, 38 music tracks, battle actions (Trade/Swap/Dance), turn bonus system, boss recruit event, tutorial hints, dual currency meta, FE GBA-style combat forecast. Wave 2 map generation enhancements are merged on `main`; Wave 6 blessings core + telemetry integration is on `main`; Wave 8 Part A difficulty foundation is now shipped on `main` (data contract, deterministic wiring, UX flow, unlock gating). For architecture details, data file reference, and build order, see **CLAUDE.md**.

## Priority Order (Feb 2026)

Organized by impact and logical sequencing:

### Done
1. ~~**Playtest Bugfixes (P0)**~~ - Canto+Wait, stale tooltip, enemy range, node freeze
2. ~~**UI Polish (P1)**~~ - V-overlay tabs, combat forecast, weapon proficiency, forge hover
3. ~~**Anti-Juggernaut & Balance (Wave 0)**~~ - XP scaling, Sunder weapons, enemy skills, shop frequency
4. ~~**Church Upgrades**~~ - Heal/Revive/Promote 3-service menu
5. ~~**Playtest Fixes (Feb 2026)**~~ - Weapon reference integrity, proficiency enforcement, music overlap, volume curve, recruit spawn bias
6. ~~**Playtest Fixes (Feb 2026, follow-up batch)**~~ - Recruit card mojibake separator fix, fort guard AI assignment restricted to seize maps, touch-down battle tap targeting, fog-of-war undo visibility fix, Master Seal-required battle promotion, battle music overlap self-heal, meta currency cloud-sync hardening

### Now (Current Sprint)
7. **Wave 1: Stabilization Gate (P0)** - Treat audio overlap, scene-transition spam races, and save/cloud correctness as a mandatory release gate before major feature merges.
8. **Wave 2: Low-Risk / High-Impact Content (P0-P1)** - Ship enemy affixes + recruit naming/dialogue scaffolding with deterministic tests and no startup/audio regressions.
9. **AI reliability pass (P0)** - Continue long-distance enemy engagement hardening and targeted regression coverage (fort/river-crossing edge cases).
10. **Regression harness expansion (P1)** - Keep battle + full-run harness parity as a merge gate for scene/run-state/difficulty changes.
11. **Post-merge stabilization + playtest pass** - Validate startup watchdog behavior, mobile-safe scene loading, and full transition QA after each merge batch.

### Next (1-3 Months)
12. **Wave 3B: Convoy MVP** - Convoy data model, overflow flow, node/deploy access, persistence, and meta-capacity hooks.
13. **Wave 3A: Wyvern + Reclass Foundation** - Wyvern Rider/Lord integration, loot table structure alignment, and Second Seal core rules.
14. **Wave 4: Weapon Arts (phased)** - Foundation -> acquisition/meta -> enemy/legendary arts -> polish/balance.
15. **Elite/Miniboss Nodes + Post-Act** - Endgame content and difficulty curve
16. **Difficulty Follow-up (Part B+)** - Balance iteration, additional mode content (Lunatic rollout timing), and expanded difficulty-aware tuning hooks after Part A ship
17. **Dynamic Recruit Nodes** - Roster-aware recruit frequency
18. **Expanded Skills** - Command skills, on-kill triggers (tactical depth)

### Later (3-6+ Months)
12. **Additional Map Objectives** - Defend, Survive, Escape (battle variety) + reinforcement system
13. **Status Staves + Countermeasures** - Sleep/Berserk/Plant staves (enemy Act 2+), Herbs/Pure Water/Remedy counter items (See `docs/specs/difficulty_spec.md` section 10)
14. **Terrain Hazards + Act 4 Content** - Lava, Cracked Floor, Rift Portal terrain + Zombies/Dragons/Manaketes + Act 4 structure + Temporal Guardian boss (See `docs/specs/difficulty_spec.md` section 4-5)
15. **Secret Act + Narrative** - Void terrain, Warp Tiles, Null Zones, Chronophage boss, dialogue system, true ending (See `docs/specs/difficulty_spec.md` section 5-6)
16. **Meta-Progression Expansion** - Full GDD section 9.2 vision + Act 4/Lunatic-specific sinks
17. **QoL** - Undo movement, battle log, battle speed (ongoing)
18. **Acts 2 & 3 content tuning** + Post-Act + Final Boss design
19. **Special Characters** + Lord selection
20. **Full battle animations**
21. **Additional biomes** (volcanic, void, cave, castle per act - See `docs/specs/difficulty_spec.md` section 8)
22. **Campaign system**
23. **Endless mode + Lunatic+** - Post-Lunatic content (See `docs/specs/difficulty_spec.md` section 12.3)

---

## Parallel Workstreams (Feb 11, 2026)

Work is intentionally split across parallel agents. Roadmap source of truth remains this file plus merged code on `main`.

1. **Blessings stabilization stream** - Validate contract behavior end-to-end (selection, persistence, telemetry, deterministic application order), then land follow-up balancing and UX polish.
2. **Harness/regression stream** - Keep deterministic harness and replay compatibility stable while blessings and map/difficulty-adjacent changes merge.
3. **Difficulty follow-up stream** - Tune Part A values/UX based on playtest data while keeping Lunatic and future content decoupled.
4. **Integration cadence** - Small PRs, frequent rebase on `main`, no cross-stream contract breaks (harness/Wave 2 surfaces treated as external).
5. **Economy rebalance stream (active, separate agent plan)** - `C:\Users\davec\.claude\plans\velvet-napping-spark.md` covers turn bonus payout correction, kill-gold tuning, church promote pricing, and late-game forge sink expansion.

---

## Implementation Waves

### Completed Waves (Summary)
- **Wave 2A-C** (Accessories, Weapons, Forging) - Complete. 18 accessories, 52 weapons, forge system with shop tab + loot whetstones
- **Wave 2D** (Stat Boosters) - Complete. 7 stat boosters in consumables.json, loot-only (not in shops)
- **Wave 2 (Map Generation Enhancements 2A-2E)** - Complete. Terrain-aware enemy placement, template affinity, boss throne AI/guards, recruit visibility safety, and template-driven fog
- **Wave 4A** (On-Defend Skills, New Skills) - Complete. 21 skills, 6 trigger types, 9 class innate skills, 8 scrolls
- **Wave 6A** (Home Base UI) - Complete. 6-tab UI, 41 upgrades, starting equipment/skills meta tabs
- **Wave 7A-B** (Inspection Panel, Danger Zone) - Complete
- **Wave 1** (Battle Actions) - Complete. Trade, Swap, Dance + Canto + Shove/Pull implemented
- **Wave 1.5** (Turn Bonus) - Complete. Par calculation, S/A/B/C rating, bonus gold on loot screen
- **Boss Recruit Event** - Complete. 3 recruit candidates after act boss, lord chance, 29 tests
- **Tutorial Hints** - Complete. 12 contextual hints, HintManager + HintDisplay
- **Loot Rebalance + Stat Boosters** - Complete. Act 1/2 pool restructuring, 7 stat boosters
- **Meta Rework Phase A** - Complete. Repricing, prerequisites, milestones
- **Wave P0** (Playtest Bugfixes) - Complete. Canto+Wait, stale tooltip, enemy range, recruit node freeze
- **Wave 0** (Balance + Anti-Juggernaut) - Complete. Sunder weapons, XP scaling, enemy skills, shop frequency, promoted recruits, guaranteed shop consumables
- **Wave P1** (UI Polish) - Complete. Weapon proficiency display, V-overlay Stats/Gear tabs, shop forge hover stats, guaranteed Vulnerary/Elixir
- **Church Upgrades** - Complete. 3-service menu: Heal All (free), Revive Fallen (1000G), Promote (3000G)
- **Playtest Fixes (Feb 2026)** - Complete. FE GBA-style combat forecast with weapon cycling, weapon reference integrity after JSON round-trips (relinkWeapon), proficiency enforcement across all equip/heal/relink paths, music overlap singleton boot guard, quadratic volume curve, HP persistence hint, recruit spawn bias toward players
- **Playtest Fixes (Feb 2026 follow-up)** - Complete on `main`. Recruit card separator text corruption fix, seize-only fort guard assignment, touch-down tap targeting, fog visibility rollback on move cancel, Master Seal gating for battle promotion, and same-key music overlap recovery
- **Cloud Sync Hardening (Meta Currency)** - Complete on `main`. Timestamped meta payload (`savedAt`), serialized per-table cloud writes, and safer cloud-fetch error handling to reduce silent currency rollback risk
- **Wave 6 Blessings Stabilization** - Complete on `main`. Blessings telemetry + act hit bonus integration landed with analytics coverage
- **Wave 8 Part A (Difficulty Foundation)** - Complete on `main`. Normal/Hard selector, `difficulty.json` contract, deterministic modifier plumbing, run-state persistence, and victory-only Hard unlock gating
- **Startup/Mobile Reliability Hardening** - Complete on `main`. startup telemetry/runtime flags, asset warmup + scene loader split, and watchdog recovery flow

---

## NOW: Stabilization + Content Ramp

Difficulty foundation and blessings integration are now merged on `main`; active work is stabilization confidence plus next content ramp.

1. Preserve blessing + difficulty contract invariants (`docs/blessings_contract.md`, `docs/specs/difficulty_spec.md` Part A).
2. Enforce Wave 1 stabilization gate on all gameplay merges touching scenes/audio/startup/run-state/cloud sync.
3. Run full-suite + harness validation on each merge touching startup, run-state, mode modifiers, or scene transitions.
4. Keep mobile-safe input/scene-loading parity as a non-regression gate for new UI features.
5. Use playtest telemetry to tune Hard economic pressure and blessing pacing before Lunatic rollout.

### Wave 1 Gate (Required Before Major Feature Merges)
- [x] Audio overlap and orphaned-track recovery guards/diagnostics landed on `Title -> Continue/New -> NodeMap -> Battle` and return paths.
- [x] Scene transition spam-click race coverage present (automated) and manual smoke paths added.
- [x] Save/cloud conflict path hardened and observable (timeout/retry/version mismatch paths).
- [x] `npm run test:unit` passes (41 files / 888 tests on Feb 12, 2026).
- [x] Harness/sim smoke passes (`npm run test:harness`, `npm run test:sim` on Feb 12, 2026).
- [x] Two consecutive QA passes with no repro on known crash paths.

### Wave 2 Scope (Low-Risk / High-Impact)
- [x] Enemy affixes runtime wiring from `affixes.json` (difficulty-gated, exclusion rules, scaling).
- [x] Affix UI indicator + inspection visibility.
- [x] Recruit naming pools + dialogue scaffold integration (`dialogue.json` data + loader/test coverage).
- [x] Deterministic tests for spawn, exclusions, and serialization.
- [x] Post-merge QA confirms no startup/audio/scene transition regressions.

QA evidence (Feb 12, 2026):
- Pass 1: `npm run test:unit` (42 files / 890 tests), `npm run test:harness` (5 files / 53 tests), `npm run test:sim` (2 files / 5 tests) all green.
- Pass 2: repeated `npm run test:unit`, `npm run test:harness`, `npm run test:sim`; all green with identical coverage.

### Open Engineering Tickets
- [x] **TICKET: Boss recruit test suite regression triage (non-blocking for UI overlays)**
  - File: `tests/BossRecruitSystem.test.js`
  - Current state: resolved via `63b80ed`; suite is green (32 passing tests on Feb 12, 2026).
  - Scope: completed candidate pool contract compatibility update (`generateBossRecruitCandidates`) and restored green suite.
  - Priority: P2 (address before next boss-recruit/affix/recruit-system logic merge; not a blocker for NodeMap church/village panel UX fixes)

### Wave 3-4 Planned Sequence
- **Wave 3B (Convoy MVP):** convoy data model + persistence, overflow routing, node/deploy access UI, meta capacity integration.
- **Wave 3A (Wyvern + Reclass Foundation):** Wyvern classes, enemy pool/recruit integration, loot table compatibility, Second Seal core rules.
- **Wave 4 (Weapon Arts):** foundation (combat + data contract), acquisition/meta, enemy/legendary arts, then balance pass.
- **Deferred until Wave 4 stabilizes:** status staves + countermeasure rollout.

---

## LATER: Objectives & Content Expansion
### Wave 7: Additional Map Objectives
**Priority:** Medium - Adds battle variety
**Effort:** 2 weeks

- [ ] `objective: 'defend'` - protect tile for N turns, reinforcements every 2-3 turns, turn counter UI
- [ ] `objective: 'survive'` - endure N turns, heavier reinforcement waves, kill-scaled rewards
- [ ] `objective: 'escape'` - move all units to exit tiles, Lord escapes last
- [ ] 1-2 map templates per new objective type in mapTemplates.json
- [ ] Bonus objectives: under-par turns or no losses -> extra gold/XP

**Success Criteria:**
- [ ] ~30% of battles use non-Rout/Seize objectives
- [ ] Defend maps feel tense (wave defense)
- [ ] Escape maps reward speed over kills

---

### Wave 8: Difficulty Foundation (Part A) - Shipped
**Status:** Complete on `main` (Feb 11, 2026)

1. Source of truth remains `docs/specs/difficulty_spec.md` Part A and `docs/wave8_difficulty_kickoff.md`.
2. Delivered scope: Normal/Hard selectable, Lunatic visible but disabled, `difficulty.json` data contract, run-state persistence, deterministic modifier wiring, and test gates.
3. Latest hardening: Hard unlock now requires true run victory; startup/watchdog flow updated for reliability.

---

### Wave 9: Special Terrain Hazards
**Priority:** Low-Medium - Adds map variety, but content-heavy
**Effort:** 1-2 weeks

#### 9A: New Terrain Types
- [ ] Add to terrain.json: Ice (slippery), Lava (damage per turn), Quicksand (immobilize)
- [ ] Terrain effects in Combat.js
- [ ] Add terrain to mapTemplates.json (volcanic, tundra biomes)

#### 9B: Boss Arena Features
- [ ] Add `arenaFeatures` field to boss configs in enemies.json
- [ ] MapGenerator: Place arena features based on boss config

**Success Criteria:**
- [ ] Boss battles feel unique and memorable
- [ ] Terrain hazards create tactical decisions (risk damage for shortcut?)

---

### Wave 10: Meta-Progression Expansion
**Priority:** Medium - Full GDD section9.2 vision
**Effort:** 2-3 weeks

- [ ] Home Base scrolling support if upgrades overflow tab area
- [ ] Current effects summary at top of each tab
- [ ] Lord Weapon Proficiency - unlock second weapon type (300-500 Supply)
- [ ] Lord Weapon Mastery - upgrade primary to Mastery pre-promotion (400 Valor)
- [ ] Base Class Innate Skill unlocks (10 upgrades, 150-250 Supply each)
- [ ] Promoted Class Innate Skill unlocks (10 upgrades, 200-350 Supply each)
- [ ] Equipped Skill Slots - increase max from 2->3->4 (400->600 Valor)
- [ ] Better Shop Inventory - higher tier items 1 act earlier (2 tiers, 200->400 Supply)
- [ ] Extra Node Events - +1 RECRUIT guaranteed per act (350 Supply)
- [ ] NPC Warriors - recruit battle NPCs gain +2 all stats (200 Supply)
- [ ] Special Characters: `data/specialChars.json` (3-5 named units with fixed growths, personal skills, unlock via meta)
- [ ] Tests for new upgrade types, special character creation, equip slot meta

---

### Wave 11: QoL & Polish (Ongoing)
**Priority:** Low-Medium - Nice-to-haves
**Effort:** 1-2 days each

- [ ] Undo Movement - store pre-move position, cancel returns unit if no action taken
- [ ] Battle Log - scrollable log of combat results, level-ups, skill activations, defeats
- [ ] Battle Speed Controls - fast mode toggle (2x animations), persist via SettingsManager
- [ ] Auto-End Turn - button to skip remaining units (all units have acted or can't act)
- [ ] Keybind customization - rebind ESC, D, R, etc. via SettingsOverlay

---

## Known Deviations from GDD

| Item | GDD Says | Implementation | Reason |
|------|----------|---------------|--------|
| Inventory cap | 4 items | `INVENTORY_MAX = 5` | Extra slot for flexibility; may revert |
| Act 1 enemy levels | 1-5 | 1-3 (per-node: row0=[1,1], row1=[1,2], row2+=[2,3]) | Balance: original range too lethal |
| Knight in Act 1 | In pool | Removed from pool (still boss class) | Balance: too tanky for L1 party |
| Boss stat bonus | Not specified | `BOSS_STAT_BONUS = 2` (was 3) | Balance: 3 was overwhelming |
| Rescue mechanic | Classic rescue (carry + halved stats) | Simple swap (exchange positions) | Simpler; may upgrade later |
| Sim scripts location | `tools/balance/` | `sim/` | Better separation of concerns |
| Weight formula | Not specified | Reworked to `weight - STR/5` | Late-game viability of heavy weapons |
| Church services | Heal only | Heal + Revive (1K) + Promotion (3K) | Makes church nodes worth visiting |
| Sunder weapons | Not in GDD | Enemy-only, halves target DEF | Anti-juggernaut mechanic from playtesting |

---

## Residual Risk / Test Gaps

- **Heal action hidden for non-proficient staff (no scene-level test):** `hasStaff()`/`getStaffWeapon()` now enforce `canEquip`, so the Heal button won't appear for units without Staff proficiency. This is validated by unit tests on the helpers, but no integration test explicitly asserts "Heal action hidden in BattleScene action menu." Validated by behavior inference + manual playtesting for now.

---

## Long-Term Vision (6-12+ Months)

- **Full Battle Animations** - Side-view combat animations (64x64 or 96x96) for each class. Combat resolution already decoupled from animation
- **Additional Biomes** - Castle/fortress, cave/dungeon, forest, volcanic, tundra biomes beyond grassland. Map generator takes biome parameter
- **Narrative & Dialogue** - Brief dialogue at rest/recruitment/boss events. Simple text box with speaker portrait, no VN engine
- **Difficulty Modes** - Normal/Hard/Lunatic modifier layers, currency multiplier (Valor + Supply), Act 4, Secret Act, extended leveling, new enemies (Zombies/Dragons), status staves. Full spec: `docs/specs/difficulty_spec.md`. Foundation (modifier layer) ships early; content (Act 4+) ships after objectives/terrain waves.
- **Story Scaffold** - Light narrative: per-Lord motivation, recruitment dialogue, boss encounter lines. Data in `dialogue.json`
- **Campaign System** - Multiple campaigns with different biome progressions, boss rosters, enemy pools. Campaign = JSON config
- **Additional Lords** - Kira, Voss, Sera playable (data exists in lords.json). Lord selection at run start
- **Special Characters** - Named units with fixed growths and personal skills, unlocked via meta-progression
- **Monetization** - If commercial: cosmetic palette swaps, campaign DLC. Never sell gameplay advantages
- **Mobile Web Support** - Release target remains deferred until core gameplay stabilizes, but architecture guardrails are active now: avoid hardcoded 640x480 layout assumptions in new work, centralize scene/layout scaling math, and add touch-parity input paths for new controls so mobile delivery stays incremental later.
- **iOS Port** - Capacitor wrapper after mobile web support stable (6-week effort, see `docs/ios-port-spec.md`)

---

## Roadmap Decisions & Tradeoffs

### Why Map Generation Next?
- Map gen improvements affect 100% of battles. Boss throne AI is nearly mandatory for seize maps. Guard enemies + terrain-aware placement make every fight feel smarter.

### Why Keep Blessings Separate From Difficulty?
- Blessings are run-shaping modifiers and difficulty is a baseline challenge layer. Keeping them separate preserves clearer balancing and avoids coupling unrelated tuning axes.

### Why Difficulty Foundation Before Next Content Waves?
- The numeric modifier layer (enemy stats, gold, prices, XP, fog, enemy count) touches only existing systems - zero new features required. Shipping it after Elite Nodes means every subsequent wave is difficulty-aware from the start. Hard is fully playable with just the modifier layer (same acts, tighter economy, tougher enemies). Act 4/Secret Act content ships later when terrain hazards and new enemy types are ready.

### Why Status Staves in Later?
- Status effects are a significant new combat system (3 conditions, hit formula, AI targeting, countermeasure items). They add the most value alongside Act 4's harder enemies where status management becomes a core tactical concern. Countermeasure items (Herbs, Pure Water, Remedy) should be available in shops before status staves appear on enemies.

### Why Enforce Mobile-Safe Architecture Now (Even With Mobile Deferred)?
- Deferring mobile release is fine; deferring mobile-safe architecture is expensive. New gameplay/UI work must avoid locking in desktop-only assumptions so eventual mobile support does not require scene rewrites.
- Guardrail policy for new features: avoid fixed-canvas literals in feature logic/layout placement, route controls through reusable input abstractions, and ensure every keyboard-only action has a clickable/touch-capable equivalent.

### Asset Source of Truth Policy
- `assets/` is the canonical source of truth for game assets.
- `public/` should be treated as generated/deployment-facing output where needed, not an independently authored mirror of the same assets.
- New asset pipeline work should prevent drift between authored assets and runtime-served assets.

### Cloud Save Concurrency Policy
- Adopt **versioned optimistic concurrency** for cloud saves (run/meta/settings payloads).
- Save records should carry a revision/version token; writes succeed only if client revision matches server revision. On mismatch, client refetches latest, resolves per-slot merge policy, and retries with incremented revision.
- Rationale: protects against silent lost updates from concurrent save operations (multi-tab, rapid fire-and-forget writes, cross-device overlap) while avoiding heavy locking.
- Tradeoff: higher implementation complexity (revision checks + retry/merge flow), but materially stronger data correctness than whole-object last-write-wins upserts.

---

## Next Actions

1. ~~**Waves P0/P1/Wave 0** (Bugfixes, UI Polish, Balance)~~ [done] Done
2. ~~**Church Upgrades + Playtest Fixes (Feb 2026)**~~ [done] Done
3. ~~**Wave 2** (Map Generation Enhancements)~~ [done] Done
4. ~~**Wave 6** (Blessings)~~ [done] Core + telemetry integration merged on `main`
5. ~~**Wave 8** (Difficulty Foundation Part A)~~ [done] Selector + modifier layer + unlock gating merged on `main`
6. **Wave 1 Stabilization Gate** (audio/scene/save/cloud + transition spam QA + merge gates)
7. **Wave 2 Low-Risk Content** (enemy affixes + recruit naming scaffold)
8. **Wave 3B** (Convoy MVP) -> **Wave 3A** (Wyvern + reclass foundation)
9. **Wave 4** (Weapon Arts phased rollout)
10. **After Wave 4 stability:** Status Staves -> Elite/Miniboss Nodes -> Objectives/Terrain -> Act 4/Secret Act -> Meta Expansion

## Deployment

Auto-deploys via Netlify GitHub integration. Pushing to `main` triggers build + publish automatically. No manual `netlify deploy` needed.
