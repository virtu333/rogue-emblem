# Playtest Notes — February 23, 2026

Organized by priority tiers. Within each tier, items are grouped by theme and ordered by impact.

---

## P0: Bugs (Fix Now)

### B1. Church revive breaks promotion eligibility
- **Symptom:** Unit revived at church can no longer be promoted (Master Seal doesn't work on them)
- **Likely cause:** Revive path may not fully restore unit state (e.g., missing class data, level, or promotion flag)
- **Impact:** High — blocks player progression for a key unit
- **Effort:** Low-Medium — trace revive logic in NodeMapScene church handler + UnitManager
- **Files:** `src/scenes/NodeMapScene.js` (church service), `src/engine/UnitManager.js` (promotion checks)

### B2. Offline play produces excessive errors
- **Symptom:** If user is not connected to internet, gets a lot of errors (not just graceful degradation)
- **Likely cause:** Supabase calls not properly guarded when offline; cloud sync attempts may throw unhandled
- **Impact:** High — many users play offline or on spotty connections
- **Effort:** Medium — audit all cloud sync callsites for null/offline guards
- **Files:** `src/cloud/supabaseClient.js`, `src/cloud/CloudSync.js`, `src/main.js`

### B3. Teleport affix issues with doubling
- **Symptom:** Teleport affix seems to have issues when a unit is doubled (or maybe working as intended?)
- **Action:** Investigate — does the teleport trigger between strikes of a double attack? Should it?
- **Effort:** Low — read AffixSystem teleport handler + test
- **Files:** `src/engine/AffixSystem.js`, `src/scenes/BattleScene.js` (combat resolution)

### B4. Wall affix is broken in multiple ways
- **Symptom:** Units disappearing, walls appearing with no wall affix unit present, wall affix units that don't move, walls aren't threatening
- **Impact:** Medium-High — visible glitchiness undermines trust in the system
- **Effort:** Medium — likely needs a redesign of wall placement/removal lifecycle
- **Files:** `src/engine/AffixSystem.js`, `src/scenes/BattleScene.js`
- **Consider:** May need full rework — walls should block movement but the affix unit should still act. Walls despawning on unit death. Clear visual linkage between unit and its walls.

### B5. Enemy unit detail scroll goes through player units
- **Symptom:** When viewing enemy unit detail, up/down arrow scrolling cycles through your own units instead of enemy units
- **Impact:** Medium — annoying UX when scouting enemies
- **Effort:** Low — fix scroll target list based on which faction is being inspected
- **Files:** `src/ui/UnitInspectionPanel.js` or `src/ui/UnitDetailOverlay.js`

---

## P1: Quick Wins (High Impact, Low Effort)

### Q1. Remove "Deploy X-Y units" text from deploy screen
- **Issue:** Confusing and potentially inaccurate — the "X/Max deploy slots" indicator already communicates this
- **Effort:** Very Low — remove one text element
- **Files:** `src/scenes/BattleScene.js` (deploy phase UI)

### Q2. Skip gold/loot screen on final boss victory
- **Issue:** Seeing a gold loot screen after defeating the final boss is anticlimactic
- **Effort:** Low — conditional skip in loot/results flow when `isFinalBoss`
- **Files:** `src/scenes/BattleScene.js` (completeBattle / loot flow)

### Q3. Reduce Physic staff to 1 base use
- **Issue:** Current base uses make Physic too available (ranged healing should be scarce)
- **Effort:** Very Low — data change in weapons.json
- **Files:** `data/weapons.json`, `public/data/weapons.json`

### Q4. Increase Colosseum gold rewards
- **Issue:** Arena gold rewards feel low relative to risk/opportunity cost
- **Effort:** Very Low — tune numbers in colosseum.json
- **Files:** `data/colosseum.json`, `public/data/colosseum.json`

### Q5. Increase mercenary hire costs
- **Issue:** Mercs feel too cheap for their quality advantage over free recruits
- **Effort:** Very Low — tune pricing ranges in colosseum.json
- **Files:** `data/colosseum.json`, `public/data/colosseum.json`

### Q6. Make turn par harder on Hard, slightly harder on Lunatic
- **Issue:** Par ratings are too generous on higher difficulties
- **Effort:** Low — adjust brackets or add difficulty multiplier to TurnBonusCalculator
- **Files:** `data/turnBonus.json`, possibly `src/engine/TurnBonusCalculator.js`

---

## P2: Balance Tuning

### T1. Blessing cost tuning
- **"-1 village item" cost is still active and very weak** — either remove it or make it more impactful (e.g., -1 village item AND -1 shop slot)
- **Add new cost types:** "healing magic -20% effectiveness", "weapon arts cost +2 HP"
- **Effort:** Low-Medium — data changes in `blessings.json` + minor BlessingEngine handler additions
- **Files:** `data/blessings.json`, `src/engine/BlessingEngine.js`, `src/engine/Combat.js` (for healing reduction)

### T2. Boss crit reduction
- **Issue:** Bosses can still be crit-bursted down too easily
- **Approach:** Add a passive "boss fortitude" effect that reduces incoming crit rate (e.g., -15 crit against bosses)
- **Effort:** Low — add modifier in Combat.js crit calc when target is boss
- **Files:** `src/engine/Combat.js`

### T3. Lord weapon meta upgrade → 3 random forges instead of guaranteed +might
- **Issue:** Guaranteed +might on lord weapon at run start is too strong and removes decision-making
- **Approach:** Apply 3 random forge stats (from the whetstone pool) instead
- **Effort:** Low-Medium — modify starting equipment meta effect application
- **Files:** `src/engine/RunManager.js` (meta effect application), `src/engine/ForgeSystem.js`

### T4. "No meta upgrades" mode
- **Issue:** Meta upgrades trivialize Hard mode over time
- **Approach:** Option to disable all meta effects for a run (maybe as a Hard mode toggle or blessing)
- **Effort:** Medium — add flag to run state, gate all metaEffects application on it
- **Files:** `src/engine/RunManager.js`, `src/scenes/DifficultySelectScene.js` or `src/scenes/BlessingSelectScene.js`

### T5. Allow Bolting to spawn on enemy mages in Lunatic
- **Issue:** Lunatic needs more enemy threat diversity; siege magic creates interesting pressure
- **Effort:** Low — add Bolting to Lunatic enemy mage weapon pool or difficulty-gated equipment rules
- **Files:** `src/engine/UnitManager.js` (enemy creation), `data/difficulty.json` or enemy equip logic

---

## P3: UX & Quality of Life

### U1. Final shop node before final boss
- **Issue:** No opportunity to prepare (buy items, forge weapons) before the final fight
- **Approach:** Add a guaranteed SHOP node in the final row before the boss, or make the boss node itself offer a pre-battle shop
- **Also:** Include a "Rewind" item for purchase (if rewind/vision mechanic exists)
- **Effort:** Medium — NodeMapGenerator change for node placement + possible new item
- **Files:** `src/engine/NodeMapGenerator.js`, `data/consumables.json` (if adding Rewind item)

### U2. Win streak counter
- **Issue:** No visible reward/tracking for consecutive battle wins
- **Approach:** Track in RunManager, display on node map or pause screen
- **Effort:** Low — add counter to run state, increment on battle win, reset on loss
- **Files:** `src/engine/RunManager.js`, `src/scenes/NodeMapScene.js` (display)

### U3. Combat log (replay what happened)
- **Issue:** After complex enemy phases, player has no way to review what happened
- **Approach:** Log every action (attack, skill proc, damage, death) to an array. Accessible from pause menu. Each entry has a tooltip showing details.
- **Effort:** Medium-High — new logging system + UI overlay
- **Files:** New `src/engine/CombatLog.js`, `src/ui/CombatLogOverlay.js`, `src/scenes/BattleScene.js`
- **Note:** Already tracked in ROADMAP.md Wave 11

### U4. Anti-save-scum for shops and blessings
- **Issue:** Players can refresh to re-roll village shop inventories and blessing selection
- **Approach:** Seed shop/blessing RNG from run state (nodeId + run seed) so results are deterministic per node visit
- **Effort:** Medium — add seeded RNG to shop generation and blessing selection
- **Files:** `src/engine/LootSystem.js` (shop gen), `src/engine/BlessingEngine.js`, `src/engine/RunManager.js` (seed)
- **Note:** Already partially tracked in ROADMAP.md (Anti-Refresh Exploit)

---

## P4: New Content — Enemies & Map Mechanics

### C1. Ballistas on Hard/Lunatic maps
- **Concept:** Static map objects that fire at units in range. Especially on chokepoint, bridge, and seize maps. More common on Lunatic.
- **Approach:** New "Ballista" terrain/object type. Enemy-controlled (or neutral — attacks anyone in range). Can be captured by player units standing on them.
- **Effort:** High — new map object type, targeting AI, terrain integration, template placement
- **Files:** `data/terrain.json`, `data/mapTemplates.json`, `src/engine/Grid.js`, `src/scenes/BattleScene.js`, `src/engine/TurnManager.js`

### C2. Zombie and Dragon enemies
- **Zombies:** Drain life on attack. Revive after death unless killed by Light magic. Take extra damage from Light weapons (effectiveness). Dark enemy type.
- **Dragons:** High MAG damage, extremely tanky. Large stat block.
- **Assets:** Already have sprites that need to be generated/processed
- **Effort:** High — new enemy classes in `classes.json`, special combat behaviors in `Combat.js`, revival mechanic
- **Files:** `data/classes.json`, `data/enemies.json`, `src/engine/Combat.js`, `src/engine/UnitManager.js`

### C3. Chaotic Vortex map hazard
- **Concept:** Damaging zone that starts on the left edge and creeps 1-2 columns per turn (66% chance 1 col, 34% chance 2 cols). Forces rightward push.
- **Effort:** High — new map hazard system, turn-start processing, visual overlay, AI awareness
- **Files:** `src/engine/Grid.js`, `src/scenes/BattleScene.js`, `src/engine/AIController.js`

### C4. Assassinate map objective
- **Concept:** Kill a specific target enemy (not the boss). Target is guarded, may try to flee.
- **Effort:** Medium-High — new objective type, target designation, flee AI, win condition check
- **Files:** `src/engine/TurnManager.js`, `src/engine/MapGenerator.js`, `data/mapTemplates.json`

### C5. More enemy affix ideas
- **Action:** Brainstorm and spec new affixes (note: currently 12 in `affixes.json`)
- **Candidates to consider:** Regen, Berserk (attacks nearest unit regardless of faction), Mirror (reflects % damage), Summon (spawns weak allies), etc.
- **Effort:** Varies per affix — Low for stat-only, Medium for behavioral
- **Files:** `data/affixes.json`, `src/engine/AffixSystem.js`

---

## P5: Systems & Meta Features

### S1. Weapon rank-up buffs (S-tier / weapon XP)
- **Concept:** Beyond Proficiency and Mastery, add an "S rank" that requires X uses of a weapon type + Mastery rank. On rank-up, choose a small permanent buff.
- **Could be:** Meta progression unlock that enables the weapon XP tracking
- **Effort:** High — new tracking system, rank-up event, buff selection UI, meta gate
- **Files:** New system file, `src/engine/UnitManager.js`, `data/metaUpgrades.json`, `src/scenes/BattleScene.js`

---

## P6: Polish & Narrative

### N1. Better victory music for final boss / run completion
- **Issue:** Current music doesn't match the weight of the moment
- **Effort:** Low — add/swap a music track, wire it to final boss victory and RunCompleteScene
- **Files:** `src/utils/musicConfig.js`, `src/scenes/RunCompleteScene.js`, `src/scenes/BattleScene.js`

### N2. Dark Souls-inspired understated story elements
- **Concept:** Environmental storytelling, item descriptions with lore, cryptic NPC dialogue. Very understated — show, don't tell.
- **Approach:** Add `lore` field to weapons/accessories/consumables. Brief flavor text on inspection. Cryptic dialogue lines for recruits/bosses.
- **Effort:** Medium — data additions + UI display hooks
- **Files:** `data/weapons.json`, `data/accessories.json`, `data/dialogue.json`, `src/ui/UnitInspectionPanel.js`

---

## Suggested Execution Order

### Sprint 1: Bug Fixes + Quick Wins (1-2 days)
- B1 (church revive promotion)
- B3 (teleport affix investigation)
- B5 (enemy scroll direction)
- Q1 (deploy text removal)
- Q2 (skip final boss loot screen)
- Q3 (Physic base uses)
- Q4 + Q5 (Colosseum gold/merc tuning)

### Sprint 2: Balance & Affix Rework (2-3 days)
- B4 (wall affix rework)
- T1 (blessing cost tuning)
- T2 (boss crit reduction)
- T3 (lord weapon forge randomization)
- T5 (Bolting on Lunatic mages)
- Q6 (par difficulty scaling)

### Sprint 3: UX & QoL (2-3 days)
- B2 (offline error hardening)
- U1 (final shop before boss)
- U2 (win streak counter)
- T4 (no meta upgrades mode)

### Sprint 4: New Content (4-5 days)
- C1 (ballistas)
- C4 (assassinate objective)
- C5 (new affixes)
- N1 (victory music)

### Backlog (future sprints)
- C2 (zombie/dragon enemies)
- C3 (chaotic vortex)
- S1 (weapon rank S-tier)
- U3 (combat log)
- U4 (anti-save-scum)
- N2 (Dark Souls lore)

---

## Cross-Reference: Code Review (Feb 23)

Several code review items from `docs/code-review-2026-02-23.md` overlap with or compound these playtest findings:

| Playtest Item | Related Code Review Issue |
|---------------|--------------------------|
| B2 (offline errors) | M18, M19 (no supabase null guards) |
| B4 (wall affix) | M5 (aura missing isLivingOnMap check) |
| B3 (teleport affix) | H5 (Haste affix MOV→SPD bug) |
| T2 (boss crit) | — (new item, no overlap) |
| U3 (combat log) | ROADMAP Wave 11 |
| U4 (anti-save-scum) | ROADMAP Wave 11 (Anti-Refresh Exploit) |

Recommend addressing code review C1 + H1-H6 alongside Sprint 1 bug fixes since they share the same files and risk profile.
