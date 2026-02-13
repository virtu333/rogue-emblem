# Biomes, Maps & Objectives — GDD Design Document

> **Ported from:** `References/GDDExpansion/` (Feb 13, 2026)
> **Implementation status:** Vision doc — mostly unimplemented. Only Grassland biome + 6 templates (4 rout, 2 seize) are shipped. Act 4 scope (Tundra + Volcano) is next priority via `docs/act4-hardmode-rollout-plan.md`. Defend/Escape objectives are deferred.
>
> **Canonical overrides:**
> - **Ice terrain:** -10 avoid + slide mechanic only. NO end-of-turn damage (this doc's §3.2 says "1 damage/turn" — that is superseded). Flying units ignore slide.
> - **Lava Crack:** 5 HP end-of-turn damage. Flying units STILL take damage (volcanic fumes).
> - **Act 4 scope:** Tundra + Volcano only. Other biomes (Coastal, Desert, Void) remain future scope.
> - **Objectives:** Rout/Seize only for Act 4. Defend/Escape deferred.

**Date:** February 11, 2026
**Status:** Design complete — partially implemented (see overrides above)
**Dependencies:** terrain.json, mapTemplates.json, turnBonus.json, enemies.json, difficulty.json
**Related:** `gdd_combat_expansion.md` (weapon arts, status staves)

---

## 1. Design Philosophy

The current game runs entirely on a single grassland biome with 6 map templates (4 rout, 2 seize). This expansion introduces 5 new biomes, 8 new terrain types, ~14 new map templates, 2 new battle objectives, and pre-fixed boss maps — transforming the tactical variety available across a full run.

**Key principles:**

- **Biomes ramp with acts.** Act 1 is pure grassland (learning). New biomes appear in Act 2+ to add complexity as the player masters fundamentals.
- **Terrain creates decisions, not frustration.** Every hazardous tile should have a counterplay (fly over lava, slide past ice, heal on blessing tiles). No "gotcha" damage without clear visual indicators.
- **Templates are biome-bound.** New templates leverage biome-specific terrain and don't work as generic reskins. Original grassland templates remain available in all acts.
- **Objectives diversify the experience.** Defend and Escape join Rout and Seize to ensure battles feel distinct even within the same biome.
- **Boss maps are pre-fixed.** Act bosses and the final/secret bosses use hand-designed maps for dramatic, memorable encounters.

---

## 2. Biome Definitions & Act Mapping

### 2.1 Biome Overview

| Biome | Signature Terrain | Tactical Identity | First Appears |
|-------|------------------|-------------------|---------------|
| Grassland | Plain, Forest, Mountain, Water | Fundamentals — positioning, terrain bonuses, weapon triangle | Act 1 |
| Castle/Cave | Floor, Pillar, Door, Wall | Chokepoints, hallways, rooms. Cavalry penalized. Thief utility (Lockpick). | Act 2 |
| Swamp | Swamp, Bog, Forest (dead trees) | Movement hell. Negative avoid. Fliers are king. | Act 2 |
| Temple | Floor, Pillar, Blessing Tile, Throne (altar) | Contested healing positions. Deny-or-use tactical layer. | Act 3 |
| Tundra | Sand (snow), Ice, Mountain (snowdrift), Water (frozen lake) | Sliding hazards, environmental damage, route planning | Act 4 |
| Volcano | Plain (scorched earth), Lava Crack, Water (magma), Mountain (obsidian) | Damage tiles, aggressive pacing, anti-turtle | Act 4 |

### 2.2 Act-Biome Mapping

| Act | Biome Pool | Approximate Weight | Design Intent |
|-----|-----------|-------------------|---------------|
| Act 1 | Grassland | 100% | Clean learning environment. Master fundamentals. |
| Act 2 | Grassland, Castle/Cave, Swamp | 50% / 30% / 20% | Indoor chokepoints and swamp movement both hit. Major tactical step-up. |
| Act 3 | Grassland, Castle/Cave, Temple | 40% / 30% / 30% | Temple blessing tiles add contested-position gameplay. Escalation toward sacred/corrupted ground. |
| Act 4 (Hard/Lunatic) | Tundra, Volcano, earlier biomes | 30% / 30% / 40% mix | Environmental extremes — ice and fire. Corruption warping the land. |
| Final Boss | Castle (pre-fixed) | Fixed | Throne room. Hand-designed. |
| Secret Act (Lunatic) | Void/Corrupted (unique) | Fixed | Corrupted blessing tiles, ice lanes, lava cracks — ultimate terrain puzzle. |

### 2.3 Narrative Framing

- **Act 1 — Wilderness/Frontier:** On the road, early skirmishes. Open terrain.
- **Act 2 — Contested Territory:** Entering enemy-held areas. Fortresses and marshlands.
- **Act 3 — Sacred Ground:** Approaching the lieutenant's seat of power. Ancient temples.
- **Act 4 — Corrupted Lands:** The lieutenant's corruption warps the land itself. Extreme terrain.
- **Secret Act — The Void:** Fate itself is breaking. Terrain rules warp and contradict.

This creates a natural mechanical ramp: learn basics on open maps → adapt to chokepoints indoors → contest healing positions → survive environmental hazards.

---

## 3. New Terrain Types

### 3.1 Consolidation Approach

Many biome-specific terrains share identical stats with existing types and differ only in sprite/visual presentation. The biome/template system handles which sprite to render — terrain.json defines only mechanically distinct entries.

**Consolidations (visual variants, not new terrain.json entries):**

| Visual Variant | Actual Terrain Entry | Used In |
|---------------|---------------------|---------|
| Sanctum Floor | Floor | Temple |
| Sacred Pillar | Pillar | Temple |
| Altar | Throne | Temple (boss seat) |
| Dead Tree | Forest | Swamp |
| Snow | Sand | Tundra |
| Snowdrift | Mountain | Tundra |
| Frozen Lake | Water | Tundra |
| Scorched Earth | Plain | Volcano |
| Magma | Water | Volcano |
| Obsidian | Mountain | Volcano |

### 3.2 New Terrain Entries (8 additions to terrain.json)

**Floor** — Indoor plain equivalent.

| Move Type | Cost | Avoid | DEF | Special |
|-----------|------|-------|-----|---------|
| Infantry | 1 | 0 | 0 | Cavalry +1 penalty (cost 2). |
| Armored | 1 | | | |
| Cavalry | 2 | | | |
| Flying | 1 | | | |

Used in: Castle/Cave, Temple biomes.

---

**Pillar** — Indoor forest equivalent. Partial cover.

| Move Type | Cost | Avoid | DEF | Special |
|-----------|------|-------|-----|---------|
| Infantry | 2 | 20 | 1 | Cavalry +1 penalty (cost 3). |
| Armored | 2 | | | |
| Cavalry | 3 | | | |
| Flying | 1 | | | |

Used in: Castle/Cave, Temple biomes.

---

**Door** — Breakable barrier. Blocks cavalry/fliers until opened.

| Move Type | Cost | Avoid | DEF | Special |
|-----------|------|-------|-----|---------|
| Infantry | 2 | 0 | 0 | Breakable: 2 hits to destroy. Lockpick: Thief/Assassin opens instantly. |
| Armored | 2 | | | Becomes Floor when opened/destroyed. |
| Cavalry | — | | | Blocks cavalry and fliers until opened. |
| Flying | — | | | |

Used in: Castle/Cave, Temple biomes.
**Implementation note:** Door state (closed/open) tracked per-tile at runtime. Once opened, tile type changes to Floor.

---

**Swamp** — Deep muck. Negative avoid — units are exposed and stuck.

| Move Type | Cost | Avoid | DEF | Special |
|-----------|------|-------|-----|---------|
| Infantry | 3 | -10 | 0 | Infantry and flying only. |
| Armored | — | | | Negative avoid — punishes sitting still. |
| Cavalry | — | | | |
| Flying | 1 | | | |

Used in: Swamp biome.

---

**Bog** — Shallow muck. Everyone can traverse, but slowly.

| Move Type | Cost | Avoid | DEF | Special |
|-----------|------|-------|-----|---------|
| Infantry | 2 | -5 | 0 | Universal access but slow. |
| Armored | 3 | | | Negative avoid (lighter than Swamp). |
| Cavalry | 3 | | | |
| Flying | 1 | | | |

Used in: Swamp biome.

---

**Ice** — Slide tile. Unit continues in entry direction until hitting non-ice.

| Move Type | Cost | Avoid | DEF | Special |
|-----------|------|-------|-----|---------|
| Infantry | 1 | -10 | 0 | **Slide:** Unit continues moving in entry direction until reaching a non-ice tile or map edge. |
| Armored | 1 | | | 1 damage per turn if ending turn on ice. |
| Cavalry | 1 | | | -10 avoid (exposed on ice). |
| Flying | 1 | | | Flying units are NOT affected by sliding. |

Used in: Tundra biome.
**Slide mechanic detail:** Direction is determined by the tile the unit entered from. If a unit moves right onto ice, they slide right. Slide stops when the unit reaches a non-ice tile (they land on it) or the map edge (they stop on the last ice tile). Sliding is resolved during movement, not as a separate phase. UI should show the slide path when previewing movement.

---

**Lava Crack** — Damage tile. Passable but punishing.

| Move Type | Cost | Avoid | DEF | Special |
|-----------|------|-------|-----|---------|
| Infantry | 1 | 0 | 0 | 5 damage at end of turn if unit is on this tile. |
| Armored | 1 | | | No movement penalty — the cost is HP. |
| Cavalry | 1 | | | Synergizes with turn bonus (rush through lava to hit par). |
| Flying | 1 | | | Flying units still take damage (volcanic fumes). |

Used in: Volcano biome.

---

**Blessing Tile** — Contested healing position.

| Move Type | Cost | Avoid | DEF | Special |
|-----------|------|-------|-----|---------|
| Infantry | 1 | 10 | 0 | Heals 10% HP/turn for ANY unit (player or enemy). |
| Armored | 1 | | | Cavalry penalty indoors (cost 2). |
| Cavalry | 2 | | | Creates tug-of-war over positioning. |
| Flying | 1 | | | +10 avoid as light defensive bonus. |

Used in: Temple biome.
**Design note:** Enemy AI should value blessing tiles — an enemy on a blessing tile heals each turn, making "deny the tile" a valid player strategy.

---

### 3.3 Cavalry Indoor Penalty

Rather than a dismount mechanic, mounted units pay +1 move cost on all indoor-traversable tiles (Floor, Pillar, Door, Blessing Tile). This is encoded directly in the terrain move costs (Cavalry cost = Infantry cost + 1 for indoor terrain). No special system needed.

**Narrative justification:** Tight corridors and low ceilings slow mounted units. They don't dismount — they just maneuver poorly indoors.

### 3.4 Lockpick Skill

New innate skill for Thief and Assassin classes. Opens Doors (and future Chests) instantly without attacking.

```json
{
  "id": "lockpick",
  "name": "Lockpick",
  "description": "Open doors and chests instantly",
  "trigger": "action",
  "classInnate": ["Thief", "Assassin"]
}
```

Added to skills.json. Persists through promotion (Thief → Assassin). Functions like Dance/Shove/Pull as an action-trigger skill — appears in the action menu when adjacent to a locked Door (or Chest in future).

---

## 4. Map Templates

### 4.1 Template Organization

Templates are organized by biome. Each template is hard-bound to its biome — the system selects a biome first (based on act weights), then picks a template from that biome's pool.

Original grassland templates remain available in all acts. New biome templates only appear in acts where that biome is available.

### 4.2 Existing Templates (Grassland — 6 total)

| ID | Name | Objective | Key Feature |
|----|------|-----------|-------------|
| open_field | Open Field | Rout | Wide open. Cavalry advantage. |
| river_crossing | River Crossing | Rout | Central river with bridges. Chokepoints. |
| forest_ambush | Forest Ambush | Rout | Heavy forest. High fog chance. Infantry advantage. |
| chokepoint | Chokepoint | Rout | Wall formations create narrow pass. |
| castle_assault | Castle Assault | Seize | Castle walls on right side. Throne. |
| hilltop_fortress | Hilltop Fortress | Seize | Mountain/fort terrain. Elevated throne. |

No changes to existing templates.

### 4.3 Castle/Cave Templates (3 new)

**Corridor Siege** (Rout)
- Layout: Long horizontal map. Wide central corridor flanked by rooms connected via Doors.
- Key terrain: Floor (base), Pillar (cover in rooms), Door (2 per side passage), Wall (corridor boundaries).
- Tactical identity: "Do you push the chokepoint or invest turns opening side paths?"
- Player spawn: Left side of central corridor.
- Enemy spawn: Right end of corridor + rooms.
- Thief utility: Lockpick doors for faster flanking access.
- Enemy weights: Knight 1.5, Archer 1.3 (corridor defense).

**Great Hall** (Seize)
- Layout: Two narrow entry corridors converge into a large central room with pillar grid. Throne at back.
- Key terrain: Floor, Pillar (grid pattern in hall), Wall (corridor boundaries), Throne (boss seat).
- Tactical identity: "Open space once inside, but getting in is the challenge."
- Player spawn: Left side, split across both corridor entrances.
- Enemy spawn: Great hall interior, boss on throne with pillar-adjacent guards.
- Enemy weights: Knight 1.5, Archer 1.3, Mage 1.2.

**Dungeon Escape** (Escape)
- Layout: Player starts center/rear, exit tiles on far right edge. Multiple branching paths through doors and corridors.
- Key terrain: Floor, Door (multiple — route choices), Wall, Pillar (sparse cover).
- Tactical identity: "Route planning under pressure. Some paths shorter but more enemies, some longer but safer."
- Player spawn: Center-left.
- Exit tiles: 2-3 tiles on right edge.
- Enemy distribution: Clusters at intersections, not uniform. Light enemy count — challenge is efficiency.
- Enemy weights: Infantry 1.3, Cavalry 0.5 (indoor penalty makes cavalry rare).

### 4.4 Swamp Templates (2 new)

**Mire Crossing** (Rout)
- Layout: Large swamp/bog area center. "Islands" of plain with forest (dead trees) for cover. Two strips of plain crossing the mire.
- Key terrain: Swamp (center mass), Bog (transition areas), Plain (islands), Forest/dead trees (cover on islands).
- Tactical identity: "River Crossing but worse — no clean bridge, just mud." Fliers have massive advantage.
- Player spawn: Left side (solid ground).
- Enemy spawn: Right side islands + scattered in bog.
- Enemy weights: Cavalry 0.5, Archer 1.5, Flying 1.3. Ground-heavy enemies struggle in swamp.

**Sunken Ruins** (Defend)
- Layout: Hybrid swamp + indoor. Partially submerged castle. Defend tile on elevated ground center-ish.
- Key terrain: Swamp (outer areas), Bog (transitions), Floor/Pillar (ruin fragments), Plain (elevated defend position), Fort (defend tile area).
- Tactical identity: "Hold the high ground while enemies slog through the mire."
- Player spawn: Center, near defend tile.
- Defend tile: 1 tile, center of the elevated ruin section.
- Reinforcement edges: Left, right, bottom. Enemies approach through swamp.
- Enemy weights: Infantry 1.5, Flying 1.5 (fliers bypass swamp — key threat).

### 4.5 Temple Templates (2 new)

**Sacred Grounds** (Rout)
- Layout: Open temple courtyard. Blessing tiles scattered in a pattern at key intersections. Pillar rows create lanes.
- Key terrain: Floor (base), Pillar (lane dividers), Blessing Tile (4-6 tiles at intersections), Wall (outer boundary).
- Tactical identity: "Fight over healing positions." Both sides benefit from blessing tiles — deny or occupy.
- Player spawn: Left side.
- Enemy spawn: Right side. AI values blessing tiles highly.
- Enemy weights: Knight 1.3, Mage 1.2 (durable units that benefit from healing tiles).

**Inner Sanctum** (Seize)
- Layout: Tight temple interior. Throne (altar) at center-back. Blessing tiles flanking the approach. Narrow corridors with pillar cover.
- Key terrain: Floor (base), Pillar (corridor cover), Blessing Tile (2-4 flanking approach), Throne/altar (boss), Wall, Door (optional).
- Tactical identity: "Storm the altar while enemies heal on blessing tiles."
- Player spawn: Left side.
- Enemy spawn: Around altar/throne. Boss on throne. Guards on blessing tiles.
- Enemy weights: Knight 1.5, Mage 1.2, Archer 1.3.

### 4.6 Tundra Templates (Act 4 — 2 new)

**Frozen Pass** (Rout)
- Layout: Winding pass created by mountain (snowdrift) walls. Ice patches on pass floor create sliding hazards. Sand (snow) as general ground.
- Key terrain: Sand/snow (general), Ice (pass hazards — sliding lanes), Mountain/snowdrift (walls), Plain (sheltered pockets).
- Tactical identity: "Navigate the ice lanes or take the slow mountain route."
- Player spawn: Left side, solid ground.
- Enemy spawn: Right side, beyond ice lanes.
- Enemy weights: Infantry 1.3, Cavalry 0.7 (snow slows cavalry).

**Glacier Fortress** (Seize)
- Layout: Water (frozen lake) outer boundary. Ice lanes leading toward central fortress with Floor/Throne. Mountain (snowdrift) blocking direct paths.
- Key terrain: Water/frozen lake (outer impassable), Ice (approach lanes), Mountain/snowdrift (path blockers), Floor (fortress interior), Throne (boss).
- Tactical identity: "You have to slide to get there." Ice lane placement controls approach angles.
- Player spawn: Left edge, solid ground.
- Enemy spawn: Central fortress. Boss on throne.
- Enemy weights: Archer 1.5 (ranged threats while you slide), Armored 1.3.

### 4.7 Volcano Templates (Act 4 — 2 new)

**Caldera** (Rout)
- Layout: Plain (scorched earth) islands separated by lava crack lanes. Water (magma) pools as impassable. Mountain (obsidian) for cover.
- Key terrain: Plain/scorched (safe islands), Lava Crack (connecting lanes), Water/magma (impassable), Mountain/obsidian (cover).
- Tactical identity: "Island hopping through fire." Rush across lava cracks or take slow detours.
- Player spawn: Left island.
- Enemy spawn: Right islands, distributed.
- Enemy weights: Flying 1.3 (lava doesn't impede movement, just damages), Infantry 1.0.

**Eruption Point** (Defend)
- Layout: Central plain (scorched earth) defend area. Enemies approach from multiple directions across lava crack lanes.
- Key terrain: Plain/scorched (center safe zone), Lava Crack (approach lanes from 3 sides), Water/magma (boundaries), Fort (defend tile).
- Tactical identity: "Hold the safe ground while lava damages approaching enemies too."
- Defend tile: 1 tile, center of scorched earth area.
- Reinforcement edges: Right, top, bottom. Enemies cross lava cracks to reach you.
- Player spawn: Center, near defend tile.
- Enemy weights: Infantry 1.5, Flying 1.5 (fliers take lava damage too but approach fast).

### 4.8 Pre-Fixed Boss Maps (5 total)

Pre-fixed maps use hand-designed layouts stored as complete tile grids rather than procedural zone-based generation. Each has a consistent design meant to reflect the narrative weight of the encounter.

| Map | Biome | Objective | Design Notes |
|-----|-------|-----------|--------------|
| Act 1 Boss — Open Battlefield | Grassland | Seize | No gimmick terrain. Pure tactics test. Clear approach with forests, throne at back. |
| Act 2 Boss — Fortress Gate | Castle | Seize | Multi-room castle. Doors, courtyard, throne room. Guards at chokepoints. Thief shortcuts. |
| Act 3 Boss — Temple of Fate | Temple | Seize | Blessing tiles contested. Boss on altar/throne. Guards on healing positions. |
| Final Boss — Throne of Corruption | Castle | Seize | Large throne room. Corrupted terrain — lava cracks mixed with floor. Dramatic layout. |
| Secret Boss — Void Temple (Lunatic) | Unique | Seize | Corrupted blessing tiles (damage instead of heal), ice lanes, lava cracks. Ultimate terrain puzzle. |

**Data format:** Pre-fixed maps can be stored as complete `tileGrid[][]` arrays in a separate `data/fixedMaps.json` file, bypassing the procedural `MapGenerator` pipeline entirely. Enemy placement, spawn points, and terrain are all hand-placed.

**Additional pre-fixed maps** (Act 4 boss, post-act encounters, etc.) are deferred to future roadmap as act content is designed.

### 4.9 Template Summary

| Biome | Templates | Objectives Covered |
|-------|-----------|--------------------|
| Grassland (existing) | 6 (4 rout, 2 seize) | Rout, Seize |
| Castle/Cave (new) | 3 (1 rout, 1 seize, 1 escape) | Rout, Seize, Escape |
| Swamp (new) | 2 (1 rout, 1 defend) | Rout, Defend |
| Temple (new) | 2 (1 rout, 1 seize) | Rout, Seize |
| Tundra (new) | 2 (1 rout, 1 seize) | Rout, Seize |
| Volcano (new) | 2 (1 rout, 1 defend) | Rout, Defend |
| Pre-fixed boss | 5 | Seize (all) |

**Total: 22 templates** (6 existing + 11 new procedural + 5 pre-fixed boss).

---

## 5. New Objectives

### 5.1 Objective Overview

| Objective | Core Mechanic | Rating Basis | First Appears |
|-----------|--------------|--------------|---------------|
| Rout | Kill all enemies | Turn count (par system) | Act 1 |
| Seize | Lord captures throne after boss dies | Turn count (par system) | Act 1 (elite nodes) |
| Defend | Protect a tile for N turns | Kill % + unit survival | Act 2 |
| Escape | Move all lords to exit tiles | Turn count (par system) | Act 2 |

### 5.2 Defend

**Core concept:** Protect a single defend tile for a fixed number of turns against enemy waves. Enemy AI prioritizes reaching the defend tile.

**Mechanics:**

- **Defend tile:** 1 marked tile on the map. Clear UI indicator (glow, icon, color).
- **Turn limit:** Scales by act. 6 turns (Act 2), 8 turns (Act 3), 10 turns (Act 4).
- **Reinforcement waves:** New enemies spawn every 2-3 turns from designated map edges. Wave composition scales with act and difficulty.
- **Capture mechanic (one-turn grace period):**
  1. Enemy moves onto defend tile during enemy phase → "Capturing" indicator appears.
  2. Player has their full next player phase to kill or push that enemy off the tile.
  3. If the enemy is still on the defend tile at the start of the *next* enemy phase → defeat.
  4. This gives one full turn of counterplay. Feels fair for permadeath roguelike.
- **Victory:** Survive all turns with the defend tile not captured.
- **Defeat:** Enemy captures the defend tile (occupies for a full turn cycle), OR Edric dies.

**Enemy AI:**
- Highest priority: Path toward defend tile and occupy it.
- Secondary: Attack player units blocking the path to the defend tile.
- Reinforcement waves approach from different edges for multi-directional pressure.

**Reinforcements — Data Structure:**

Defend templates include a `reinforcements` block:

```json
"reinforcements": {
  "spawnEdges": ["right", "top", "bottom"],
  "waves": [
    { "turn": 2, "count": [2, 3], "edges": ["right"] },
    { "turn": 4, "count": [3, 4], "edges": ["right", "top"] },
    { "turn": 6, "count": [3, 5], "edges": ["right", "top", "bottom"] }
  ],
  "xpDecay": [1.0, 0.75, 0.5, 0.25]
}
```

- `count`: [min, max] enemies per wave. Actual count influenced by difficulty `enemyCountBonus`.
- `edges`: Which map edges this wave spawns from.
- `pool`: Pulled from the act's enemy pool in `enemies.json`. Difficulty modifiers from `difficulty.json` apply as normal (stat bonuses, skill chance, etc.).
- `xpDecay`: XP multiplier per successive wave. Wave 1 = 100%, Wave 2 = 75%, Wave 3 = 50%, Wave 4+ = 25%. Prevents XP farming from infinite waves.

**Reinforcement Composition by Difficulty:**
- **Normal:** All base classes. No promoted units in reinforcements.
- **Hard:** Base classes waves 1-2. Mixed base + promoted from wave 3 onward.
- **Lunatic:** Mixed from wave 1. Later waves majority promoted.

### 5.3 Escape

**Core concept:** Move all lords to exit tiles on the far side of the map. Speed over combat.

**Mechanics:**

- **Exit tiles:** 2-3 marked tiles on one edge of the map (typically opposite from player spawn). Clear UI indicator.
- **Escape action:** When a lord is on an exit tile, an "Escape" action appears in their action menu. Using it removes the lord from the map. Cannot be undone.
- **All lords must escape.** Since Edric is always deployed and a second lord is chosen at run start, both lords must reach exit tiles and use the Escape action.
- **Non-lord units:** Can also Escape (optional). Not required for victory. Escaped units are safe — they rejoin the roster after battle.
- **Fallen units:** Do not need to escape. A fallen non-lord unit is lost (permadeath) regardless.
- **No lord escape order restriction.** Either lord can escape first. Simpler than "Edric last."
- **Light enemy presence.** No reinforcements, or at most one small wave. Challenge is navigating efficiently, not enduring attrition.
- **Victory:** All lords have escaped.
- **Defeat:** Edric dies before escaping.

**Escape Tension:**
- Non-lord units that haven't escaped when all lords escape are **safe** — they're assumed to follow. No unit loss for stragglers.
- The tension comes from getting lords through enemy-held territory efficiently. Do you clear a path (costs turns) or try to dodge through (risky)?
- Escape maps should have multiple route options — some shorter with more enemies, some longer but safer.

### 5.4 Rating & Rewards

**Rout / Seize / Escape — Turn-based par system (existing):**

Uses the current `turnBonus.json` formula. New entries for Escape:

```json
"objectiveBasePar": {
  "rout": 2,
  "seize": 4,
  "escape": 3
},
"objectiveAdjustments": {
  "rout": 0,
  "seize": 1,
  "escape": 0
}
```

Escape has a tight par (basePar 3, no adjustment) — speed is everything.

**Defend — Kill-percentage + survival rating:**

Since turn count is fixed for defend maps, par doesn't apply. Rating is based on performance during the defense:

```json
"defendRating": {
  "S": { "killPercent": 80, "maxLosses": 0, "bonusMultiplier": 1.0 },
  "A": { "killPercent": 60, "maxLosses": 1, "bonusMultiplier": 0.6 },
  "B": { "killPercent": 40, "maxLosses": 999, "bonusMultiplier": 0.25 },
  "C": { "killPercent": 0, "maxLosses": 999, "bonusMultiplier": 0.0 }
}
```

- `killPercent`: Percentage of total spawned enemies (initial + all reinforcement waves) killed.
- `maxLosses`: Maximum player units lost (0 = no losses allowed for that rating).
- S-rank requires both high kills AND no losses — can't turtle OR play recklessly.

Bonus gold uses the same `baseBonusGold` per act from `turnBonus.json`, multiplied by the bracket's `bonusMultiplier`. Reward structure stays consistent across all objective types.

### 5.5 Objective Distribution by Node Type

| Node Type | Objective | Notes |
|-----------|-----------|-------|
| Battle (standard) | Rout | Most common. Available all acts. |
| Battle (standard) | Defend | Mixed in from Act 2. |
| Battle (standard) | Escape | Mixed in from Act 2. |
| Elite | Seize | Seize exclusive to elite nodes. 1 strong miniboss + guards. Feels special. |
| Boss | Fixed/Seize | Pre-designed maps. Always seize. |

**Standard battle node objective weights (Act 2+):**

| Act | Rout | Defend | Escape |
|-----|------|--------|--------|
| Act 1 | 100% | 0% | 0% |
| Act 2 | 60% | 20% | 20% |
| Act 3 | 50% | 25% | 25% |
| Act 4 | 40% | 30% | 30% |

Elite nodes remain seize-only across all acts.

---

## 6. Implementation Sequencing

### Phase 1: Indoor Biome Foundation
1. Add Floor, Pillar, Door to `terrain.json` with cavalry penalty costs.
2. Create Corridor Siege, Great Hall, Dungeon Escape templates in `mapTemplates.json`.
3. Implement Door state tracking (closed → open after 2 hits or Lockpick).
4. Add Lockpick skill to `skills.json` (action trigger, Thief/Assassin innate).
5. Biome selection logic in map generation pipeline (act → biome weights → template pool).
6. Visual variant mapping (same terrain ID, different sprite per biome).
7. Tests: door breaking, lockpick action, cavalry move costs indoors, biome-template binding.

### Phase 2: Swamp Biome
8. Add Swamp, Bog to `terrain.json`.
9. Create Mire Crossing, Sunken Ruins templates.
10. Validate negative avoid in Combat.js (terrain avoid can go below 0).
11. Tests: swamp move costs, negative avoid calculation, armored impassability.

### Phase 3: New Objectives
12. Implement Defend objective: defend tile, capture mechanic (one-turn grace), wave spawning, victory/defeat conditions.
13. Implement Escape objective: exit tiles, Escape action, lord tracking, victory condition.
14. Reinforcement system: wave spawning from edges per template data.
15. XP decay per reinforcement wave.
16. Defend rating system (kill % + losses).
17. Escape par entries in `turnBonus.json`.
18. Tests: defend capture grace period, wave spawning, XP decay, escape lord tracking, rating calculation.

### Phase 4: Temple Biome
19. Add Blessing Tile to `terrain.json`.
20. Implement blessing tile healing (10% HP/turn, both sides).
21. Create Sacred Grounds, Inner Sanctum templates.
22. AI: enemy valuation of blessing tiles.
23. Tests: blessing healing friend/foe, AI tile priority.

### Phase 5: Pre-Fixed Boss Maps
24. Create `data/fixedMaps.json` format (complete tileGrid, enemy placements, spawn points).
25. Implement 5 boss maps (Act 1-3, Final, Secret).
26. Boss node routing: bypass procedural generation, load fixed map.
27. Tests: fixed map loading, enemy placement, objective setup.

### Phase 6: Act 4 Biomes (Tundra + Volcano)
28. Add Ice, Lava Crack to `terrain.json`.
29. Implement ice sliding mechanic (entry-direction, stop on non-ice, UI preview).
30. Implement lava crack damage (5 HP end of turn).
31. Create Frozen Pass, Glacier Fortress, Caldera, Eruption Point templates.
32. Tests: ice slide direction, edge cases (slide into wall, slide into unit), lava damage, flying + lava.

### Phase 7: Polish
33. Biome-specific tilesets and visual variants.
34. Biome-appropriate music mapping.
35. Defend/Escape UI elements (capture indicator, exit tile markers, turn counter, wave counter).
36. Playtest tuning: wave timing, enemy counts, par values, biome weights.

---

## 7. Data File Changes Summary

### terrain.json
Add 8 entries: Floor, Pillar, Door, Swamp, Bog, Ice, Lava Crack, Blessing Tile.

### mapTemplates.json
Add 11 procedural templates across 5 biomes. Add biome tag and objective type per template.

### fixedMaps.json (new file)
5 pre-fixed boss maps with complete tile grids, enemy placements, and spawn points.

### turnBonus.json
Add `escape` to `objectiveBasePar` and `objectiveAdjustments`. Add `defendRating` block.

### skills.json
Add Lockpick (action trigger, Thief/Assassin innate).

### enemies.json
No structural changes. Reinforcement composition pulls from existing act pools + difficulty modifiers.

### difficulty.json
No structural changes for biomes/objectives. Reinforcement composition scaling is difficulty-aware via existing modifiers.

---

## 8. Open Items & Future Vision

### Deferred to Future Roadmap

- **Chests:** Breakable containers (2-3 hits) or Lockpick-openable. Loot tables, placement rules, enemy interaction. Design is sketched but implementation deferred.
- **Cavalry dismounting:** Cut in favor of +1 move cost penalty. Could revisit if indoor maps need more cavalry restriction.
- **Additional pre-fixed maps:** Act 4 boss, post-act encounters, and other narrative-significant battles.
- **Void terrain (Secret Act):** Unique terrain types — corrupted blessing tiles (damage), warp tiles, null zones. Needs full design pass.
- **Biome-specific music:** Each biome should have distinct battle/exploration tracks.
- **Weather/time-of-day effects:** Rain (reduced bow accuracy), night (reduced vision), sandstorm (damage). Long-term consideration.

### Design Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cavalry indoor | +1 move cost, no dismount | Simpler. Data-driven via terrain costs. No special system needed. |
| Terrain consolidation | 8 new entries, visual variants for rest | Keeps terrain.json lean. Biome handles sprite swaps. |
| Ice slide direction | Entry direction | More tactical than fixed direction. Harder to communicate — needs UI preview. |
| Blessing tiles heal enemies | Yes | Creates "deny the tile" gameplay. More interesting than player-only healing. |
| Survive objective | Cut | Too similar to Defend. Two new objectives (Defend + Escape) is sufficient variety. |
| Defend capture | One-turn grace period | Harsh instant-loss is unfair in permadeath roguelike. Grace period allows counterplay. |
| Seize exclusive to elite nodes | Yes | Keeps seize feeling special. Elite nodes get miniboss treatment. |
| Template-biome binding | Hard binding for new templates | Limits complexity. New templates leverage biome-specific terrain. |
| Defend XP | Diminishing per wave | Natural anti-exploit. Reinforcements are cannon fodder, not training partners. |
| Escape completion | All lords escape | Simple. Consistent with lord-selection model. Non-lords safe if lords escape. |
