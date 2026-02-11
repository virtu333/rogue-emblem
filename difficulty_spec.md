# Emblem Rogue — Difficulty Modes & Extended Content Spec

**Version:** 1.1 — February 2026
**Scope:** Hard/Lunatic difficulty modes, Act 4, Secret Act, extended leveling, new enemies, terrain hazards, narrative scaffold
**Structure:** Part A covers foundation systems (Hard mode, modifiers, leveling) shippable independently. Part B covers expansion content (Lunatic, Act 4, Secret Act, new enemies) requiring terrain hazards and map objectives as prerequisites.
**Later (out of scope for this spec):** Endless mode, Lunatic+, detailed new enemy/weapon designs, full meta-progression sink expansion

## Implementation Snapshot On `main` (Feb 11, 2026)

- Part A foundation is shipped: data contract (`data/difficulty.json`), loader validation, run-state persistence, deterministic modifier wiring, Normal/Hard selector, Lunatic disabled label.
- Hard unlock is gated by true run victory (`beatGame` milestone), not merely reaching the final boss.
- Current shipped `actsIncluded` for all visible modes is `["act1","act2","act3","finalBoss"]`.
- Current shipped Hard values are conservative for rollout (`enemyStatBonus: 1`, `enemyCountBonus: 1`, `enemySkillChance: 0.2`, `enemyPoisonChance: 0.08`, `enemyStatusStaffChance: 0.0`, `goldMultiplier: 0.9`, `shopPriceMultiplier: 1.15`, `xpMultiplier: 0.9`, `fogChanceBonus: 0.15`, `currencyMultiplier: 1.25`).
- Status staves, Act 4/Secret Act, and full Lunatic content remain future scope in Part B.

---

# ═══ PART A — Foundation (Hard Mode + Core Systems) ═══

## 1. Difficulty Selection

### 1.1 Where & When
Difficulty is selected at the **Home Base before each run** — not locked per save slot. A player on the same slot can run Normal one attempt and Hard the next. This fits the roguelike philosophy: each run is a fresh attempt with fresh parameters.

### 1.2 UI
Add a **Difficulty Selector** to the Home Base, visible before "Begin Run." Options:

| Difficulty | Unlock Condition | Icon Color | Availability |
|------------|-----------------|------------|--------------|
| Normal | Default | Green | Part A |
| Hard | Clear Normal (defeat Final Boss) | Orange | Part A |
| Lunatic | Clear Hard (defeat Act 4 Boss) | Red | Part B — greyed out "Coming Soon" until Part B content ships |
| Endless | Clear Lunatic (defeat Secret Boss) | Purple | Later scope — greyed out "Coming Soon" |
| Lunatic+ | Clear Endless Act 6+ | Gold | Later scope — greyed out "Coming Soon" |

### 1.3 Currency Multiplier (Valor + Supply)
Higher difficulties award a modest currency bonus to incentivize challenge without making Normal feel punishing:

| Difficulty | Currency Multiplier |
|------------|---------------------|
| Normal | 1.0× |
| Hard | 1.25× |
| Lunatic | 1.5× |

This applies to all Valor and Supply sources (boss kills, act completions, enemy kills, bonus objectives). The multiplier is displayed on the difficulty selector tooltip and on the RunCompleteScene summary.

---

## 2. Difficulty Modifier Layer

### 2.1 Configuration: `data/difficulty.json`

A single config file defining modifier values per difficulty. The engine reads this at run start and applies multipliers throughout.

```json
{
  "normal": {
    "enemyStatBonus": 0,
    "enemyCountBonus": 0,
    "enemyEquipTierShift": 0,
    "enemySkillChance": 0.0,
    "enemyPoisonChance": 0.0,
    "enemyStatusStaffChance": 0.0,
    "goldMultiplier": 1.0,
    "shopPriceMultiplier": 1.0,
    "lootQualityShift": 0,
    "deployLimitBonus": 0,
    "xpMultiplier": 1.0,
    "fogChanceBonus": 0,
    "reinforcementTurnOffset": 0,
    "currencyMultiplier": 1.0,
    "actsIncluded": ["act1", "act2", "act3", "postAct", "finalBoss"],
    "extendedLevelingEnabled": false
  },
  "hard": {
    "enemyStatBonus": 1,
    "enemyCountBonus": 1,
    "enemyEquipTierShift": 1,
    "enemySkillChance": 0.25,
    "enemyPoisonChance": 0.1,
    "enemyStatusStaffChance": 0.15,
    "goldMultiplier": 0.85,
    "shopPriceMultiplier": 1.2,
    "lootQualityShift": 0,
    "deployLimitBonus": 0,
    "xpMultiplier": 0.9,
    "fogChanceBonus": 0.15,
    "reinforcementTurnOffset": -1,
    "currencyMultiplier": 1.25,
    "actsIncluded": ["act1", "act2", "act3", "act4", "postAct", "finalBoss"],
    "extendedLevelingEnabled": true
  },
  "lunatic": {
    "enemyStatBonus": 2,
    "enemyCountBonus": 2,
    "enemyEquipTierShift": 1,
    "enemySkillChance": 0.5,
    "enemyPoisonChance": 0.25,
    "enemyStatusStaffChance": 0.3,
    "goldMultiplier": 0.7,
    "shopPriceMultiplier": 1.3,
    "lootQualityShift": 0,
    "deployLimitBonus": 0,
    "xpMultiplier": 0.8,
    "fogChanceBonus": 0.25,
    "reinforcementTurnOffset": -2,
    "currencyMultiplier": 1.5,
    "actsIncluded": ["act1", "act2", "act3", "act4", "postAct", "finalBoss", "secretAct", "secretBoss"],
    "extendedLevelingEnabled": true
  }
}
```

### 2.2 How Modifiers Apply

| Modifier | Effect |
|----------|--------|
| `enemyStatBonus` | Flat bonus to ALL enemy stats at generation time (HP gets 2× the bonus) |
| `enemyCountBonus` | Additional enemies per battle (applied in MapGenerator) |
| `enemyEquipTierShift` | Shift enemy equipment up N tiers (Iron→Steel in Act 1 on Hard, Steel→Silver in Act 2) |
| `enemySkillChance` | % of non-boss enemies in Act 2+ that spawn with a random skill |
| `enemyPoisonChance` | % of eligible enemies (Sword/Lance/Axe users) that spawn with a poison weapon variant instead of their normal weapon. 0 on Normal, 10% on Hard, 25% on Lunatic. See §2.4 |
| `enemyStatusStaffChance` | % of staff-wielding enemies that carry a status staff (Sleep/Berserk/Plant) instead of a healing staff. 0 on Normal, 15% on Hard, 30% on Lunatic. Act 2+ only. See §4 |
| `goldMultiplier` | Multiplier on all gold earned (battle rewards, turn bonuses, selling). Applied source-side — see §7 |
| `shopPriceMultiplier` | Multiplier on all shop prices |
| `lootQualityShift` | Shift to loot tier rolls (negative = worse drops; 0 across all difficulties to keep loot rewarding — tunable later) |
| `deployLimitBonus` | Added to deploy limits per act (0 across all difficulties — deploy reduction felt too punishing without Blessing system offset) |
| `xpMultiplier` | Multiplier on all XP gained (slows leveling on higher difficulties) |
| `fogChanceBonus` | Adds to per-act `FOG_CHANCE_BY_ACT` values in constants.js. Capped at 0.9 |
| `reinforcementTurnOffset` | **Deferred — no-op until reinforcement system ships.** Config key exists for stable data contract. When active: reinforcements arrive N turns earlier (negative = sooner) |
| `currencyMultiplier` | Multiplier applied to all Valor and Supply earned during the run. See §7 for source-side application |
| `actsIncluded` | Which acts appear in the campaign sequence |
| `extendedLevelingEnabled` | Whether units can level past promoted L20 |

### 2.3 Integration Points

These modifiers touch the following existing systems:
- **UnitManager** — `enemyStatBonus` applied during `createEnemyUnit()`
- **MapGenerator** — `enemyCountBonus` added to enemy count rolls, `enemyEquipTierShift` passed to equipment selection, `enemySkillChance` for skill assignment, `enemyPoisonChance` for poison weapon substitution, `enemyStatusStaffChance` for status staff assignment
- **LootSystem** — `goldMultiplier` on gold calculations (source-side, see §7), `lootQualityShift` on tier rolls
- **NodeMapScene/Shop** — `shopPriceMultiplier` on displayed prices
- **Combat/UnitManager** — `xpMultiplier` on XP awards
- **NodeMapGenerator** — `fogChanceBonus` adds to per-act `FOG_CHANCE_BY_ACT` values in constants.js (capped at 0.9)
- **TurnManager** — `reinforcementTurnOffset` adjusts reinforcement scheduling (no-op until reinforcement system ships)
- **RunManager** — `actsIncluded` drives `ACT_SEQUENCE`, `currencyMultiplier` on Valor + Supply calculation
- **RunManager** — stores `difficulty` in run state for persistence + display

### 2.4 Expanded Poison Weapons (Anti-Juggernaut Layer)

Currently only Venin Edge (sword) exists as a poison weapon. This is insufficient for higher difficulties — a juggernaut with high stats can shrug off everything except chip damage and attrition. Poison weapons are the attrition answer, alongside Sunder (DEF-halving) and status staves (action denial).

**Design philosophy:** The same logic that drove Sunder weapons applies here. High-stat units shouldn't be invincible — poison forces the player to manage HP attrition even when winning every exchange. On Lunatic, every battle should drain resources (Vulneraries, healer actions) rather than being free for a capped unit.

**New poison weapon variants (enemy-only, not droppable):**

| Weapon | Type | Might | Hit | Crit | Weight | Range | Special |
|--------|------|-------|-----|------|--------|-------|---------|
| Venin Edge | Sword | 5 | 80 | 0 | 5 | 1 | Poison: -5 HP after combat (exists) |
| Venin Lance | Lance | 6 | 75 | 0 | 8 | 1 | Poison: -5 HP after combat |
| Venin Axe | Axe | 7 | 65 | 0 | 10 | 1 | Poison: -5 HP after combat |
| Venin Bow | Bow | 5 | 80 | 0 | 5 | 2 | Poison: -5 HP after combat |
| Toxin Edge | Sword | 7 | 75 | 0 | 6 | 1 | Poison: -8 HP after combat (Act 3+/Lunatic) |
| Toxin Lance | Lance | 8 | 70 | 0 | 9 | 1 | Poison: -8 HP after combat (Act 3+/Lunatic) |

**Scaling by difficulty:**
- **Normal:** Venin Edge only (current behavior). No additional poison weapons.
- **Hard:** Venin Edge/Lance/Axe/Bow added to enemy weapon pools. `enemyPoisonChance` (10%) means ~1 in 10 melee/bow enemies carries a poison weapon instead of their normal tier weapon.
- **Lunatic:** All Venin + Toxin variants. `enemyPoisonChance` (25%) means roughly 1 in 4 enemies is a poison threat. Toxin weapons (−8 HP) appear in Act 3+ and are a serious drain.

**How `enemyPoisonChance` works:**
- At enemy generation time, for each non-boss enemy with Sword/Lance/Axe/Bow proficiency, roll against `enemyPoisonChance`.
- On success, replace their weapon with the matching Venin variant (or Toxin variant in Act 3+ on Lunatic).
- Poison weapons are enemy-only and not droppable — they don't enter the player's loot pool.
- Bosses never have poison weapons (they have named/legendary weapons).

**Counterplay:** Vulneraries, Elixirs, healer staves, Renewal skill, Herbs (status recovery also works as a heal-after-combat tool). Pure Water's +7 RES doesn't help against poison (physical damage), but the player's resource management is the real answer. Players who stock up on healing items and bring dedicated healers are rewarded.

---

## 3. Extended Leveling

### 3.1 Design
After reaching promoted level 20, units continue gaining XP and leveling up. Each level-up past the cap grants exactly **1 random stat increase** (chosen uniformly from the 8 non-MOV stats: HP, STR, MAG, SKL, SPD, DEF, RES, LCK).

### 3.2 Rules
- **No hard cap.** Units can theoretically level indefinitely.
- **Growth rates are ignored** past promoted L20 — always exactly 1 stat, always random.
- **XP thresholds continue scaling** using the existing formula (no reset).
- **Enabled only on Hard/Lunatic** (and later Endless) via `extendedLevelingEnabled`. On Normal, units hitting promoted L20 simply stop gaining XP.
- **Display:** Level shows as "20+" with a count (e.g., "Lv 20+3" meaning 3 levels past cap). The level-up popup shows the single stat gain.

### 3.3 Why This Works
- Prevents units from becoming gods — 1 stat per level is marginal compared to real level-ups.
- Gives a reason to keep fighting in Act 4 / Secret Act without obsoleting the difficulty.
- Creates gentle power growth that can't keep pace with enemy scaling in Endless mode.
- Avoids the "wasted XP" frustration of hitting a hard cap mid-run.

### 3.4 Implementation
- **UnitManager:** After `level >= 20` on a promoted unit, `levelUp()` skips growth rate rolls and instead picks 1 random stat to increment. Track extended levels as `unit.extendedLevels` (integer).
- **XP system:** Continue awarding XP past cap. `canGainXP()` returns true if `extendedLevelingEnabled`.
- **Display:** `getDisplayLevel(unit)` returns `"20+N"` format when `extendedLevels > 0`.

---

## 4. Status Staves & Countermeasures

### 4.1 Status Staves (Enemy-Only Initially)

New staff weapons that inflict status conditions. These target RES (like existing staves target for healing) and add a tactical layer — especially on Hard/Lunatic where `enemyStatusStaffChance` puts these in enemy hands.

| Staff | Effect | Duration | Range | Uses | Target Stat |
|-------|--------|----------|-------|------|-------------|
| Sleep | Target cannot move or act. Wakes on taking damage. | 1–2 turns (random) | 1–MAG/4 | 1 | RES |
| Berserk | Target attacks nearest unit (ally or enemy) uncontrollably. | 2 turns | 1–MAG/4 | 1 | RES |
| Plant | Target cannot move (can still attack/use items in place). | 2 turns | 1–MAG/4 | 1 | RES |

**Hit formula:** `(Caster MAG × 2 + Staff Hit) - (Target RES × 2 + Target LCK)`. Status staves have base Hit ~70. High-RES units resist effectively; low-RES units are vulnerable.

**Design notes:**
- Status staves appear in **Act 2+ enemy hands** (never Act 1 — too punishing before counterplay is available).
- On Hard, `enemyStatusStaffChance` of 15% means ~1 status staff user per 6–7 enemy group in Act 2+.
- On Lunatic, 30% chance — status management becomes a core tactical concern.
- **Player access (later scope):** Status staves could appear in Act 3+ shops or as rare loot. Not included in this phase.

### 4.2 Status Countermeasure Items

New consumables and a staff to counter status conditions:

| Item | Type | Effect | Uses | Price |
|------|------|--------|------|-------|
| Herbs | Consumable | Cures all status conditions on self | 2 | 400g |
| Pure Water | Consumable | +7 RES for 3 turns (prevents/resists status staves and reduces magic damage) | 1 | 600g |
| Remedy | Staff | Cures all status conditions on target ally | 2 (+1 at MAG 8/14/20) | 800g |

**Design notes:**
- Herbs are the cheap, accessible counter — available in Act 1+ shops so players can stock up before status staves appear.
- Pure Water is proactive — use it on your low-RES glass cannons before engaging status staff users. The +7 RES also helps against Tomes and Magic generally, making it useful even without status staves on the map.
- Remedy is the healer's answer — efficient (ranged, multi-use) but requires a dedicated healer action.
- All three appear in shop inventories. Herbs and Pure Water also appear in loot tables from Act 2+.

### 4.3 Status Integration Points

- **UnitManager:** Add `unit.status` field (`null`, `"sleep"`, `"berserk"`, `"plant"`), `unit.statusTurns` (countdown).
- **TurnManager:** At start of unit's turn, decrement `statusTurns`. If 0, clear status. If `sleep` or `plant`, skip/restrict movement. If `berserk`, override AI to attack nearest unit.
- **Combat.js:** Sleep broken on taking damage (clear status immediately). Status staves use new hit formula vs RES.
- **BattleScene:** Visual indicators for statused units (zzz for sleep, red tint for berserk, vine/root for plant).
- **AI (enemy status staff usage):** Target player units with lowest RES. Prefer high-value targets (lords, healers). Don't waste on units already statused.

---

## 5. Blessing Clarification

Blessings (Wave 6 in roadmap) are **unchanged across difficulties** — the same blessing pool, tiers, and costs apply to Normal, Hard, and Lunatic. Only **1 blessing per run** (chosen at the Shrine before the run begins). Difficulty should come from the modifier layer, not from restricting run-start options.

---

## 6. Engine Assumptions

This table maps spec concepts to their current codebase locations. Use it as a reference when implementing the modifier layer.

| Spec Concept | Code Location | Notes |
|---|---|---|
| `actsIncluded` | `ACT_SEQUENCE` in constants.js:89 | Currently hardcoded; must become dynamic at run start |
| `currencyMultiplier` | `calculateCurrencies()` in MetaProgressionManager.js:352 | Multiply both Valor and Supply by this value |
| `goldMultiplier` | `calculateKillGold()` / `calculateBattleGold()` in LootSystem.js | Source-side: each gold source applies multiplier |
| `shopPriceMultiplier` | NodeMapScene / ShopScene | Display-side; base data prices unchanged |
| `fogChanceBonus` | `FOG_CHANCE_BY_ACT` in constants.js:191, NodeMapGenerator.js:91 | Adds to per-act values |
| `reinforcementTurnOffset` | TurnManager.js | NO-OP — no reinforcement system exists yet |
| `deployLimitBonus` | `DEPLOY_LIMITS` in constants.js | Added to per-act deploy values |

---

## 7. Economy Multiplier Ownership

All economy multipliers (`goldMultiplier`, `currencyMultiplier`) are applied **source-side** — each gold or currency source applies the multiplier at the point of award, not as a global post-hoc adjustment. This ensures:

- Individual gold sources (kill gold, battle gold, turn bonus gold, sell prices) each apply `goldMultiplier` independently in their respective calculation functions.
- Valor and Supply awards each apply `currencyMultiplier` at the point they're computed in MetaProgressionManager.
- Shop prices apply `shopPriceMultiplier` at display time — base data prices in JSON remain unchanged.

This source-side approach makes debugging straightforward (each source reports its final value) and avoids floating-point drift from a single global multiply.

---

### Implementation Phases (Part A)

**Phase A — Difficulty Infrastructure (2-3 days):**
- [ ] `data/difficulty.json` — config file with Normal/Hard/Lunatic values
- [ ] Difficulty selector UI in HomeBaseScene
- [ ] RunManager: store difficulty, load config, apply `actsIncluded` to `ACT_SEQUENCE`
- [ ] Currency multiplier application (Valor + Supply)
- [ ] Wire modifier values into UnitManager, MapGenerator, LootSystem, Combat, NodeMapGenerator
- [ ] Tests: difficulty config loading, modifier application, act sequence generation

**Phase B — Extended Leveling (1 day):**
- [ ] UnitManager: post-cap leveling (1 random stat per level)
- [ ] `extendedLevels` tracking + display ("Lv 20+N")
- [ ] XP continues past cap when `extendedLevelingEnabled`
- [ ] LevelUpPopup: handle single-stat gain display
- [ ] Tests: extended leveling, XP past cap, display format

**Phase C — New Enemy Types + Status System (5-7 days):**
- [ ] `classes.json`: Revenant, Wight, Manakete class definitions
- [ ] `enemies.json`: act4 and secretAct pools
- [ ] Undying mechanic in Combat/TurnManager (death marker, revival timer, permanent kill conditions — any unit can destroy marker via Wait)
- [ ] Zombie XP rules (0 XP on re-kill)
- [ ] Dragon Skin damage reduction in Combat.js: `max(1, damage - 3)` — effectiveness multiplier applies before reduction
- [ ] Light weapon effectiveness vs undead
- [ ] Wyrmslayer weapon (or dragon-effective tag on existing weapons)
- [ ] **Status system:** `unit.status` / `statusTurns` fields, Sleep/Berserk/Plant effects in TurnManager
- [ ] **Status staves:** Sleep, Berserk, Plant in weapons.json (enemy-only initially, Act 2+)
- [ ] **Status countermeasures:** Herbs, Pure Water, Remedy staff in consumables.json + weapons.json
- [ ] **Enemy AI for status staves:** Target lowest-RES player units, prefer high-value targets
- [ ] **Status hit formula:** `(MAG×2 + Hit) - (RES×2 + LCK)` in Combat.js
- [ ] Tests: Undying revival, XP blocking, Dragon Skin, effectiveness tags, status application/recovery/duration, countermeasure items

---

# ═══ PART B — Expansion (Lunatic + New Content) ═══

## 8. Act 4 (Hard+ Only)

### 8.1 Narrative Context: The Loop Fights Back
After defeating the Act 3 Boss, the expected victory doesn't come. The world warps — time fractures visibly. The force maintaining the loop has noticed the player's progress and is actively resisting. Act 4 takes place in a **corrupted/temporal rift** version of the world: familiar terrain twisted by temporal decay.

**Story beat (Act 3 → Act 4 transition):**
> *"The throne falls. The war should be over. But the world shudders — the sky cracks, terrain shifts underfoot. Something ancient stirs. The cycle isn't broken. It's fighting back."*

### 8.2 Structure

| Property | Value |
|----------|-------|
| Nodes | 6–8 (same as other acts) |
| Map Size | 12x10 to 14x10 |
| Deploy Limit | 6 units |
| Enemy Level Range | 18–22 (extended past Normal's cap) |
| Equipment Tier | Silver / Legendary |
| New Enemy Types | Zombies (Revenants, Wights), Dragons (Manaketes) |
| Biome | Volcanic / Corrupted Rift |
| Boss | Temporal Guardian (see §8.5) |

### 8.3 New Enemy Types

#### Zombies (Revenants & Wights)
Classic FE undead. Two classes:

**Revenant (base zombie):**
- Stats: High HP, high STR, low SKL, low SPD, low RES
- Weapons: Claws (physical, range 1, built-in weapon — not droppable)
- Movement: 4 (shambling)
- Special: **Undying** — on death, leaves a "fallen" marker. After 2 turns, revives at 50% HP at the marker location. Killed permanently by: Light magic, or killing the revived form, or destroying the marker (any unit uses Wait action on the marker tile)
- XP: **Only awarded on first kill.** Revival kills grant 0 XP (prevents camping) — see §13

**Wight (promoted zombie):**
- Stats: Higher across the board than Revenant, notably better SKL and SPD
- Weapons: Shadow Claws (magical damage, range 1) or Shadow Bolt (range 2, tome-equivalent)
- Special: **Undying** (same as Revenant but revives at 75% HP). Marker destroyed by any unit's Wait action.
- Effective against: Light weapons deal 3× damage to both zombie types

#### Dragons (Manaketes)
FE-style dragon enemies. One class for now:

**Manakete:**
- Stats: Very high HP/STR/DEF, moderate RES, low SPD
- Weapons: Dragonstone (magical damage using STR, range 1, built-in)
- Movement: 5
- Special: **Dragon Skin** — all damage received reduced by 3 (flat, applied after DEF/RES), but cannot reduce damage below 1. Formula: `max(1, damage - 3)`. A unit dealing 1–3 raw damage still deals 1; a unit dealing 4 raw damage also deals 1 (4−3). This prevents total immunity while keeping Manaketes tanky against chip damage.
- Effective against: A new "Wyrmslayer" weapon (sword, effective vs Dragon) should be added to the weapon pool. Alternatively, tag existing legendary weapons as dragon-effective. Effectiveness multiplier applies before Dragon Skin reduction.
- Role: Act 4 miniboss / elite enemy. 1–2 per battle maximum

### 8.4 Act 4 Enemy Pool
```json
"act4": {
  "levelRange": [18, 22],
  "base": ["Revenant"],
  "promoted": ["Swordmaster", "General", "Sniper", "Sage", "Paladin", "Warrior", "Wight", "Manakete"],
  "promotedRatio": 0.8,
  "skillChance": 0.4,
  "bosses": [{ "className": "TemporalGuardian", "level": 23, "name": "Temporal Guardian" }]
}
```

Act 4 is predominantly promoted enemies. Zombies provide a unique tactical puzzle (manage revive timers, bring Light users). Manaketes serve as elite mini-boss threats within regular battles.

### 8.5 Act 4 Boss: Temporal Guardian

A multi-phase boss encounter on a volcanic/rift arena.

**Phase 1 — The Guardian:**
- Class: Custom boss class (armored dragon-type)
- Stats: Boss-scaled with high HP/DEF/RES
- Weapon: Temporal Blade (range 1–2, magical damage)
- Skill: **Stasis** — once per phase, freezes a random player unit for 1 turn (can't move or act)
- Arena: Lava tiles around the perimeter, safe path to the throne
- Reinforcements: Wights spawn every 3 turns from rift portals

**Phase 2 — Unbound (at 50% HP):**
- Guardian moves off throne, becomes aggressive
- Lava tiles shift inward (arena shrinks by 1 tile ring)
- Gains **Warp Strike** — can teleport to any tile adjacent to a player unit once per turn before attacking
- Reinforcements accelerate to every 2 turns

### 8.6 Terrain: Volcanic / Corrupted Rift

New terrain types for Act 4 maps:

| Terrain | Move Cost | Avoid | DEF | Special |
|---------|-----------|-------|-----|---------|
| Lava | — (impassable by default) | — | — | Units ending turn adjacent to lava take 2 fire damage. Fliers can cross (move cost 2). Some maps have lava that shifts/flows each turn |
| Cracked Floor | 1 | 0 | 0 | After any unit walks on it, becomes a Pit next turn. Visual warning (cracks appear). **Map gen constraint:** Cracked Floor tiles must not block the only path between player spawn and objectives. Generator should verify reachability assuming all Cracked Floor tiles become Pits. Cap at ~15-20% of walkable tiles per map to ensure viable alternate routes. |
| Pit | — (impassable) | — | — | Former cracked floor. Blocks movement permanently. Creates dynamic terrain denial. Fliers can cross (move cost 2). |
| Rift Portal | 1 | 0 | 0 | Enemies may spawn from these tiles. Player units can destroy a portal by using Wait on it (Lord or any unit) |
| Corrupted Fort | 1 | +10 | +1 | Weaker fort variant. Heals 5% HP per turn instead of 10% |

**Design intent:** Lava + cracked floor creates an "arena shrinks over time" mechanic. Players must advance aggressively rather than turtling. Rift portals give a secondary objective (destroy spawners or deal with endless reinforcements).

---

## 9. Secret Act (Lunatic Only)

### 9.1 Narrative Context: The Source of the Loop
After the Final Boss falls, a rift tears open. The player's Lord recognizes it — this is where the loop begins and ends. The Secret Act takes place in **The Void Between** — a liminal space outside time where the entity maintaining the roguelike cycle resides.

**Story beat (Final Boss → Secret Act transition):**
> *"The final blow lands. For a moment, silence. Then the world unravels — not in destruction, but in revelation. The sky peels away to reveal... nothing. An endless dark, and at its center, something watching. Something that has watched every run, every death, every restart. The cycle has a keeper. And now it knows you know."*

### 9.2 Structure

| Property | Value |
|----------|-------|
| Nodes | 3–5 (shorter than a full act — this is the final gauntlet) |
| Map Size | 12x10 to 14x12 |
| Deploy Limit | 6 units |
| Enemy Level Range | 22–25+ |
| Equipment Tier | Silver / Legendary (enemies have Legendary weapons) |
| Enemy Types | Void-corrupted promoted enemies, Manaketes, unique Void enemies |
| Biome | Void / Abstract (floating platforms, warp tiles) |
| Boss | The Chronophage — Keeper of the Loop (see §9.4) |

### 9.3 Terrain: The Void

| Terrain | Move Cost | Avoid | DEF | Special |
|---------|-----------|-------|-----|---------|
| Void Floor | 1 | 0 | 0 | Standard tile, but aesthetically distinct (floating in darkness) |
| Warp Tile | 1 | 0 | 0 | Stepping on it teleports the unit to the paired warp tile. Pairs are color-coded. Can be tactical (shortcut) or dangerous (separates your team) |
| Null Zone | 1 | 0 | 0 | All skills are suppressed while standing on this tile. No skill procs, no innate abilities. Pure stat checks only |
| Healing Void | — | — | — | Impassable. Heals ALL enemies within 2 tiles by 10% HP per turn. Must be destroyed by attacking it (15 HP, 6 DEF) to stop the healing. Destroying a Healing Void applies a **Void Shatter** debuff to the Chronophage: halves all stats (rounded down) for 2 turns. This makes Healing Voids a strategic priority — not just stopping enemy heals, but creating damage windows against the boss. |
| Time Fracture | 1 | -10 | -1 | Dangerous tile. Unit takes 3 damage at end of turn. Provides no defensive benefit. Sometimes the only path forward |

**Design intent:** The Void terrain strips away safety nets. Null Zones punish skill-dependent builds. Warp tiles create chaos and force adaptation. Healing Voids are secondary objectives that punish passive play. The message is clear: everything you relied on is being tested.

### 9.4 Secret Boss: The Chronophage

The entity that maintains the time loop. A multi-phase encounter that tests mastery of all systems.

**Thematic concept:** The Chronophage has been observing every run. It knows the player's patterns. Mechanically, this translates to an AI that's more responsive than normal bosses.

**Phase 1 — The Observer (100%–60% HP):**
- Class: Unique (no weapon triangle interaction — immune to triangle advantage/disadvantage)
- Stats: Extreme HP pool, high all stats, moderate SPD
- Weapon: Temporal Erasure (range 1–3, mixed physical/magical — uses higher of STR or MAG vs lower of DEF or RES)
- Skill: **Rewind** — once, at 60% HP, heals back to 80% HP. This only triggers once (the player must "break" through it)
- Arena: Central platform with Null Zones on the direct approach and Warp Tiles on the flanks
- Reinforcements: Promoted enemies every 3 turns

**Phase 2 — The Unraveler (60%–30% HP):**
- Chronophage moves off its position, gains 2 MOV
- **Loop Echo** — at the start of each Enemy Phase, creates a "shadow" of the Chronophage at its position from 2 turns ago. The shadow has 30% of the boss's stats and attacks the nearest player unit, then disappears. Forces the player to keep moving
- Warp Tiles on the arena shuffle (new random pairs). **Occupied tile rule:** Tiles with a unit standing on them are excluded from the shuffle — they retain their current pairing until the unit moves off. Only unoccupied warp tiles get new random pairs. This prevents involuntary teleportation into enemy clusters or hazard tiles, which would feel unfair even on Lunatic.
- Null Zones expand by 1 tile

**Phase 3 — The Desperate (30%–0% HP):**
- **Temporal Collapse** — each turn, 1 random tile becomes a Time Fracture (permanent). The arena slowly becomes hostile
- Chronophage gains **Desperation** — always attacks twice regardless of SPD comparison
- All remaining reinforcements spawn at once (one final wave)
- Defeating the Chronophage triggers the true ending

### 9.5 True Ending
On defeating the Chronophage, the time loop shatters. A unique ending scene plays — distinct from the Normal/Hard endings. The run summary shows "TRUE ENDING" with the Lunatic difficulty badge. This is the canonical conclusion to the story.

---

## 10. Narrative Scaffold

### 10.1 The Time Loop Framework
The roguelike structure is diegetic — it exists within the story world. Each run is a loop through time. The Lord retains fragmented memories across loops (justifying meta-progression). Death resets the timeline. The difficulty modes reveal progressively more of this truth:

| Difficulty | What the Player Learns |
|------------|----------------------|
| Normal | Surface-level conflict. Defeat the antagonist. Credits suggest the world is saved, but there's an undercurrent of unease — "why does this feel familiar?" |
| Hard | The victory was incomplete. Act 4 reveals that the world is caught in a temporal cycle. The Act 4 Boss is a guardian placed to prevent anyone from reaching the truth |
| Lunatic | The Secret Act reveals the cycle's architect. The true ending breaks the loop permanently. The Lord remembers everything — every run, every death, every ally lost |

### 10.2 Per-Act Story Beats (Light Touch)

These are brief text scenes shown at act transitions. Not a full narrative system — just a few lines to establish context.

**Normal Campaign:**
- **Run Start:** Lord rallies their warband. "This time, we end this."
- **Act 1 → Act 2:** Enemy forces are stronger than expected. The Lord pushes deeper.
- **Act 2 → Act 3:** The antagonist's stronghold is in sight. Final preparations.
- **Act 3 Boss defeated:** Victory. But something feels... incomplete. (Fade to credits on Normal.)

**Hard Campaign (adds):**
- **Act 3 Boss → Act 4:** The world cracks. "We've been here before. All of us." The Lord's memories of past loops begin surfacing.
- **Act 4 traversal:** Brief scenes of déjà vu — the Lord recognizes places, enemies, patterns from past runs.
- **Act 4 Boss defeated → Final Boss:** The Temporal Guardian falls. The path to the true antagonist is clear. "This is the fight that was always waiting."

**Lunatic Campaign (adds):**
- **Final Boss → Secret Act:** The rift opens. The Lord steps through willingly. "I know what's on the other side. I've always known."
- **Secret Act traversal:** The Void reflects fragments of past runs — echoes of fallen allies, discarded equipment, abandoned timelines.
- **Chronophage defeated:** The loop breaks. The Lord stands in a world free of the cycle for the first time. Different Lord characters get unique closing lines reflecting their personality.

### 10.3 Implementation Notes
- Story beats are data-driven: `data/dialogue.json` with keys per transition point and per difficulty
- Displayed as simple text overlay (speaker portrait + text box) — no complex VN engine
- Optional: players can skip with a button press
- Lord-specific lines keyed by lord ID in the dialogue data

---

## 11. Campaign Sequence Changes

### 11.1 Act Sequence by Difficulty

**Normal (current):**
```
Act 1 → Act 2 → Act 3 → Post-Act (3-4 nodes) → Final Boss
~20-25 battles
```

**Hard:**
```
Act 1 → Act 2 → Act 3 → Act 4 → Post-Act (3-4 nodes) → Final Boss
~26-33 battles
```

**Lunatic:**
```
Act 1 → Act 2 → Act 3 → Act 4 → Post-Act → Final Boss → Secret Act (3-5 nodes) → Secret Boss
~30-38 battles
```

### 11.2 ACT_CONFIG Expansion

`constants.js` needs Act 4, Secret Act, and difficulty-driven sequence:

```javascript
ACT_CONFIG: {
  act1: { nodes: [6,8], mapSize: ['8x6','10x8'], deploy: [3,4], ... },
  act2: { nodes: [6,8], mapSize: ['10x8','12x8'], deploy: [4,5], ... },
  act3: { nodes: [6,8], mapSize: ['10x8','12x10'], deploy: [5,6], ... },
  act4: { nodes: [6,8], mapSize: ['12x10','14x10'], deploy: [6,6], biome: 'volcanic' },
  postAct: { nodes: [3,4], mapSize: ['12x10+'], deploy: [6,6], ... },
  secretAct: { nodes: [3,5], mapSize: ['12x10','14x12'], deploy: [6,6], biome: 'void' }
}
```

The `actsIncluded` array from `difficulty.json` drives which acts appear in `ACT_SEQUENCE` for a given run.

### 11.3 enemies.json Expansion

See §8.4 for the canonical `act4` pool definition (including bosses). Additional pool needed for Secret Act:

```json
{
  "secretAct": {
    "levelRange": [22, 25],
    "base": [],
    "promoted": ["Swordmaster", "General", "Sage", "Paladin", "Wight", "Manakete"],
    "bosses": [{ "className": "Chronophage", "level": 27, "name": "The Chronophage" }]
  }
}
```

### 11.4 lootTables.json Expansion

| Act | Weapons | Consumables | Rare | Accessories |
|-----|---------|-------------|------|-------------|
| Act 4 | Silver, Legendary (low chance) | Elixir, Master Seal | Legendary weapons, high-tier scrolls | Rare accessories |
| Secret Act | Silver, Legendary | Elixir only | Legendary guaranteed per battle | Rare + unique void accessories (later scope) |

---

## 12. Per-Act Biome Progression

Maps already support biome as a concept. This formalizes which acts use which biomes and what terrain is available:

| Act | Biome | Terrain Palette | Signature Element |
|-----|-------|----------------|-------------------|
| Act 1 | Grassland / Plains | Plain, Forest, Mountain, Fort, Wall, Water | None — learn the basics |
| Act 2 | Castle / Fortress | Plain, Fort, Throne, Wall, Gate, Ballista* | Ballista tiles (later scope: interactive siege weapons) |
| Act 3 | Cave / Dungeon | Plain, Mountain, Wall, Fort, Darkness* | Higher fog chance, trap tiles (later scope) |
| Act 4 | Volcanic / Corrupted | Plain, Lava, Cracked Floor, Rift Portal, Corrupted Fort, Wall | Lava hazard, crumbling terrain, rift portals |
| Post-Act | Mixed (Acts 2–3 on Normal; Acts 2–4 on Hard+) | Varies | Variety |
| Secret Act | Void | Void Floor, Warp Tile, Null Zone, Healing Void, Time Fracture | All new terrain, hostile environment |

*Ballista, Darkness, and Trap tiles are later-scope terrain additions noted in the roadmap. Act 2 and 3 use existing terrain for now and gain their signature elements when those features ship.

---

## 13. Zombie XP Rules

### 13.1 Anti-Camping Design
Zombies (Revenants and Wights) have the **Undying** mechanic — they revive after death. Without restrictions, players could farm infinite XP by repeatedly killing the same zombie.

### 13.2 Rules
- Each zombie unit has a unique internal ID (as all units do).
- **First kill:** Awards full XP as normal.
- **Subsequent kills (after revival):** Awards **0 XP**.
- XP tracking: `unit._xpAwarded = true` flag set on first defeat. Checked in `Combat.resolveCombat()` before awarding XP.
- This applies to both Revenants and Wights.
- **Destroying the marker** (preventing revival) does not award additional XP.

### 13.3 Player Messaging
When a revived zombie is killed again, the combat results should show "0 XP" with a brief note: "No XP — already defeated." This makes the mechanic transparent.

---

### Implementation Phases (Part B)

**Phase D — Act 4 Content (3-5 days):**
- [ ] ACT_CONFIG: act4 entry with volcanic biome
- [ ] terrain.json: Lava, Cracked Floor, Pit, Rift Portal, Corrupted Fort
- [ ] mapTemplates.json: 2-3 volcanic/rift templates
- [ ] Act 4 Boss: Temporal Guardian (2-phase, arena mechanics)
- [ ] Lava damage + cracked floor → pit transition in TurnManager
- [ ] Rift Portal enemy spawning + player destruction mechanic
- [ ] lootTables.json: act4 entry
- [ ] Narrative transitions (Act 3 → Act 4, Act 4 → Post-Act)
- [ ] Tests: new terrain effects, boss phases, act progression

**Phase E — Secret Act Content (3-5 days):**
- [ ] ACT_CONFIG: secretAct entry with void biome
- [ ] terrain.json: Void Floor, Warp Tile, Null Zone, Healing Void, Time Fracture
- [ ] mapTemplates.json: 1-2 void templates
- [ ] Warp tile teleportation mechanic in Grid.js / BattleScene
- [ ] Null Zone skill suppression in SkillSystem.js
- [ ] Healing Void (destructible terrain, enemy healing aura)
- [ ] Secret Boss: Chronophage (3-phase, Rewind/Loop Echo/Temporal Collapse)
- [ ] True ending scene
- [ ] lootTables.json: secretAct entry
- [ ] Tests: warp tiles, null zones, boss phases, true ending trigger

**Phase F — Story & Polish (2-3 days):**
- [ ] `data/dialogue.json` — per-difficulty transition text, per-lord variants
- [ ] Story scene overlay (portrait + text box, skip button)
- [ ] Difficulty badge on RunCompleteScene
- [ ] Unlock conditions enforcement (clear Normal → unlock Hard, etc.)
- [ ] Unlock notification/celebration when new difficulty is earned
- [ ] Integration testing: full Hard run, full Lunatic run

### Later Scope (Roadmap Items)

These are acknowledged but not specced here — add to "Later" section of ROADMAP.md:

- [ ] **Endless Mode** — infinite act scaling after final/secret boss, leaderboards
- [ ] **Lunatic+** — random enemy skills (FE Awakening style)
- [ ] **More enemy types** — additional undead variants, dragon subtypes, void creatures
- [ ] **More enemy weapon types** — claws, dragonstones, void weapons as equipment categories
- [ ] **Ballista / siege terrain** — interactive map objects for Act 2+
- [ ] **Darkness / trap tiles** — Act 3 signature terrain
- [ ] **Warp tile variants** — one-way warps, unstable warps (random destination)
- [ ] **Boss arena features per act** — unique terrain configs per boss encounter
- [ ] **Meta-progression sinks for extended play** — Act 4+ specific upgrades, void resistance, dragon-killer unlocks
- [ ] **Per-difficulty enemy AI improvements** — smarter targeting on Hard, coordinated attacks on Lunatic
- [ ] **New map objectives for Act 4** — Purge (destroy all rift portals), Seal (Lord must close N rifts)
- [ ] **Player-usable status staves** — Sleep/Berserk/Plant staves in Act 3+ shops or rare loot

---

# ═══ SHARED ═══

## Roadmap Integration

### Where This Fits

Difficulty modes are a **content expansion** that builds on top of existing systems. It should slot in after the current tactical depth waves are complete:

**Revised priority sequence:**
1. ~~Wave 2 (Map Gen Enhancements)~~ — Current
2. Wave 3 (Elite/Miniboss Nodes)
3. Wave 4 (Dynamic Recruits)
4. Wave 5 (Expanded Skills)
5. Wave 6 (Blessing System)
6. **Wave 7 (Additional Map Objectives)** — Defend, Survive, Escape
7. **Wave 8A (Terrain Hazards: Lava, Cracked Floor, Rift Portal)** — Required for Act 4
8. **→ Difficulty Modes (this spec)** — Hard/Lunatic, Act 4, Secret Act, extended leveling, new enemies
9. Wave 9 (Meta-Progression Expansion) — More sinks for extended play
10. Wave 10 (QoL)

**Rationale:** Difficulty modes depend on varied objectives (Wave 7) and terrain hazards (Wave 8) to make the extended acts feel distinct. Shipping them without those foundations would make Act 4 and Secret Act feel like "more of the same but harder" rather than genuinely new content.

---

## Design Principles

1. **Hard should demand skill, not luck.** Modest stat bumps + tighter economy + longer run = resource management and consistent good play are rewarded. Bad RNG shouldn't brick a Hard run.

2. **Lunatic should demand mastery AND meta-progression.** The combination of stat penalties, deploy reduction, and extended content means players need both strong meta-upgrades and tight tactical play. Some runs will fail to RNG — that's the Lunatic contract.

3. **New content > bigger numbers.** Act 4 and Secret Act should feel like genuinely new experiences (new enemies, new terrain, new mechanics) rather than "same maps but enemies have +5 STR." The numeric difficulty is the backdrop; the content is the attraction.

4. **The story rewards persistence.** Each difficulty tier reveals more lore. Players who push through Hard and Lunatic are rewarded with a deeper understanding of the world and a true ending. This is the classic FE tradition (unlocking Hector Hard Mode, etc.).

5. **Anti-camping, anti-turtling.** Zombie revival gives 0 XP. Lava shrinks arenas. Cracked floors punish standing still. Healing Voids punish passive play. The message: push forward.

6. **Extended leveling is a safety net, not a power source.** +1 random stat per level won't save a bad team composition. It prevents the "my units are capped and gaining nothing" frustration without breaking difficulty curves.

7. **Anti-juggernaut trio: Sunder + Poison + Status.** High-stat units should never be sufficient on their own. Three systems work together to prevent stat-balling: **Sunder** halves DEF (punishes armor-stacking), **Poison weapons** drain HP after combat (punishes trading without healing resources), **Status staves** deny actions (punishes overextending without RES investment or countermeasure items). Each scales with difficulty — Normal has minimal exposure, Hard introduces all three at low rates, Lunatic makes them a core tactical concern requiring active resource management every battle.
