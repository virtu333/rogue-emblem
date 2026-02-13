# Units, Reclassing & Loot Restructure — GDD Section (v1 FINAL)

> **Ported from:** `References/GDDExpansion/` (Feb 13, 2026)
> **Implementation status:** Wyvern Rider/Wyvern Lord shipped on `main` (classes, enemy/recruit pool integration, Stun + Intimidate skills, loot compatibility). Second Seal / Reclass system, Sickle & Hammer, Lord Selection, and Loot Table Restructure remain future scope.

**Date:** February 11, 2026
**Status:** Design complete — partially implemented (Wyvern shipped, reclass deferred)
**Dependencies:** classes.json, skills.json, lootTables.json, consumables.json, metaUpgrades.json, recruits.json, enemies.json
**Source Research:** Serenes Forest — Path of Radiance, Sacred Stones (Wyvern class data)

---

## Part 1: Wyvern Rider / Wyvern Lord

### 1.1 Design Philosophy

Wyvern Riders are the STR/DEF flying counterpart to Pegasus Knights. Across every FE game, this relationship is consistent: Pegasus Knights are fast, fragile, and have high RES; Wyvern Riders are slow, bulky, and have terrible RES. Both fly, both use Lances, both are weak to Bows. The tactical choice is clear — speed vs. power in the air.

**Reference data used:**

| Stat | FE8 Wyvern Rider (base) | FE8 Peg Knight (base) | Delta |
|------|------------------------|-----------------------|-------|
| HP | 20 | 17 | +3 |
| STR | 7 | 6 | +1 |
| SKL | 3 | 7 | -4 |
| SPD | 5 | 9 | -4 |
| DEF | 8 | 5 | +3 |
| RES | 0 | 5 | -5 |
| MOV | 7 | 7 | 0 |

| Stat | PoR Wyvern Rider (class growth) | PoR Peg Knight (class growth) | Delta |
|------|-------------------------------|------------------------------|-------|
| HP | 80% | 60% | +20% |
| STR | 55% | 40% | +15% |
| SKL | 50% | 55% | -5% |
| SPD | 40% | 55% | -15% |
| DEF | 55% | 35% | +20% |
| RES | 40% | 50% | -10% |

### 1.2 Emblem Rogue Stats

#### Wyvern Rider (Base Class)

```json
{
  "name": "Wyvern Rider",
  "tier": "base",
  "baseStats": {
    "HP": 21, "STR": 7, "MAG": 0, "SKL": 4,
    "SPD": 4, "DEF": 8, "RES": 1, "LCK": 3, "MOV": 5
  },
  "moveType": "Flying",
  "weaponProficiencies": "Lances (P)",
  "role": "Heavy flier, high STR/DEF, bow-weak",
  "growthRanges": {
    "HP": "70-85", "STR": "45-60", "MAG": "0-10", "SKL": "25-40",
    "SPD": "20-35", "DEF": "40-55", "RES": "5-15", "LCK": "15-25"
  },
  "promotesTo": "Wyvern Lord",
  "learnableSkills": [
    { "skillId": "stun", "level": 15 }
  ]
}
```

**Comparison to Emblem Rogue Pegasus Knight:**

| Stat | Wyvern Rider | Pegasus Knight | Delta |
|------|-------------|----------------|-------|
| HP | 21 | 17 | +4 |
| STR | 7 | 5 | +2 |
| MAG | 0 | 2 | -2 |
| SKL | 4 | 6 | -2 |
| SPD | 4 | 8 | -4 |
| DEF | 8 | 4 | +4 |
| RES | 1 | 6 | -5 |
| LCK | 3 | 5 | -2 |
| MOV | 5 | 5 | 0 |

Stat total: Wyvern 52 vs Peg Knight 52. Perfectly balanced in aggregate, radically different in distribution.

#### Wyvern Lord (Promoted Class)

```json
{
  "name": "Wyvern Lord",
  "tier": "promoted",
  "promotesFrom": "Wyvern Rider",
  "promotionBonuses": {
    "HP": 4, "STR": 3, "MAG": 0, "SKL": 1,
    "SPD": 1, "DEF": 3, "RES": 1, "LCK": 0, "MOV": 1
  },
  "moveType": "Flying",
  "weaponProficiencies": "Lances (M), Axes (P)",
  "roleChange": "Gains Axes, flying tank"
}
```

Promotion bonuses are generous (total +14) compared to Falcon Knight (+12), reflecting the Wyvern Lord's identity as a stat monster. The +1 MOV makes them MOV 6 — matching Cavalier base MOV, which feels right for a promoted flier.

### 1.3 New Skills

#### Stun (Wyvern Rider learnable at L15)

```json
{
  "id": "stun",
  "name": "Stun",
  "description": "STR/2% chance to deal double damage and inflict Root (1 turn)",
  "trigger": "on-attack",
  "activation": "STR_HALF"
}
```

- **Activation:** STR/2%. At 15 STR (mid-game Wyvern) = 7.5% → ~8%. At 25 STR (late-game Wyvern Lord) = 12.5%. Powerful but rare enough to not be relied upon.
- **Effect:** 2x damage on that hit + target is Rooted for 1 turn (cannot move, can still attack/use items).
- **Thematic:** The wyvern's crushing weight stuns the target. Rewards STR stacking.
- **Synergy with status system:** Root is an existing condition from the status staves design. No new mechanics needed.
- **Comparison:** Similar activation range to Astra (SKL/2%) but different stat. Effect is more impactful per-proc (2x damage + CC) but procs less often on the classes that get it.

#### Intimidate (Wyvern Lord class innate)

```json
{
  "id": "intimidate",
  "name": "Intimidate",
  "description": "Enemies within 2 tiles suffer -20 Hit",
  "trigger": "passive-aura",
  "range": 2,
  "effects": {
    "enemyHitPenalty": 20
  },
  "classInnate": "Wyvern Lord"
}
```

- **Design:** Passive aura (like Charisma) but affects enemies instead of allies. -20 Hit is significant — turns near-misses into misses, protects adjacent allies.
- **Thematic:** The wyvern's presence is terrifying. Enemies falter.
- **Counter to Wyvern weakness:** Wyvern Lords are bow-weak. Intimidate makes archers less accurate when the Wyvern Lord closes in, giving it a fighting chance.
- **Does NOT stack with Charisma.** Charisma gives allies +10 Hit/+5 Avoid; Intimidate gives enemies -20 Hit. Both can be active simultaneously but they affect different targets (allies vs enemies).

### 1.4 Enemy & Recruit Integration

**Enemy pools:**

| Act | Base Pool Addition | Promoted Pool Addition |
|-----|-------------------|----------------------|
| Act 1 | — | — |
| Act 2 | Wyvern Rider | — |
| Act 3 | Wyvern Rider | Wyvern Lord |
| Post-Act | — | Wyvern Lord |
| Final Boss | — | Wyvern Lord |

Wyvern Riders in Act 2 enemies force the player to value archers and anti-air tools. Wyvern Lords in Act 3+ are serious threats — high DEF fliers that ignore terrain.

**Recruit pool update:**

```json
"act2": {
  "pool": [
    { "className": "Thief", "name": "Nyx" },
    { "className": "Mercenary", "name": "Gareth" },
    { "className": "Pegasus Knight", "name": "Elysia" },
    { "className": "Mage", "name": "Theron" },
    { "className": "Knight", "name": "Osric" },
    { "className": "Cavalier", "name": "Helena" },
    { "className": "Dancer", "name": "Sylvie" },
    { "className": "Wyvern Rider", "name": "Draven" }
  ]
}
```

Draven joins the Act 2 pool, creating a direct choice: Elysia (Peg Knight — fast/fragile/high-RES) vs Draven (Wyvern — slow/tanky/high-STR). Both are fliers, radically different play patterns.

### 1.5 Second Seal Interactions

- Wyvern Rider is a **Flying** class → accessible via **Mount Second Seal** only
- Infantry Second Seal cannot reach Wyvern Rider or Wyvern Lord
- Mount Second Seal pool: Cavalier, Pegasus Knight, Wyvern Rider (base) / Paladin, Falcon Knight, Wyvern Lord (promoted)
- A Cavalier using Mount Second Seal becomes Wyvern Rider → gains Flying, loses Cavalry, switches Lance proficiency context, gains bow weakness
- Effectiveness follows current class: a reclassed Wyvern Rider takes 3x from bows regardless of origin

---

## Part 2: Second Seal System

### 2.1 Core Rules

**Two seal types:**

| Seal | Rarity | Target Classes | Price | Availability |
|------|--------|---------------|-------|-------------|
| Infantry Second Seal | Uncommon | All Infantry + Armored classes | 3000 | Act 2+ loot, Act 3+ shops |
| Mount Second Seal | Rare | All Cavalry + Flying classes | — | Act 3 loot only, never in shops |

**Reclass rules:**
1. **Tier-locked:** Unpromoted → unpromoted only. Promoted → promoted only. Cannot skip or reset tier.
2. **Keep current level.** Level 8 Myrmidon → Level 8 Knight. No level reset.
3. **Keep all stats.** Pure lateral move. No stat adjustments, no class base stat minimums applied.
4. **Keep all weapon proficiencies.** A Swordmaster→General keeps Swords (M) and gains Lances (M) + Axes (P). Intentionally generous — seals are rare consumables.
5. **Effectiveness follows current class.** Checked against `unit.moveType` and `unit.className` at combat time. Cavalier→Myrmidon loses Horseslayer weakness.
6. **Keep scroll-learned skills.** Skills from scrolls (Sol, Luna, etc.) are permanent to the unit.
7. **Keep personal skills.** Lord personal skills and unit-specific skills persist.

### 2.2 Skill Behavior on Reclass

**On reclass, class-specific skills swap to the new class's equivalents:**

1. **Strip** all skills from the old class's `learnableSkills` list
2. **Check** the new class's `learnableSkills` — if current level ≥ threshold, learn those skills
3. **Strip** old class innate skill (if promoted), **gain** new class innate skill (if promoted and new class has one)
4. **Keep** all scroll-learned skills (these belong to the unit, not the class)
5. **Keep** all personal skills

**Example walkthrough:**

> Level 15 Myrmidon has: Vantage (learned at L15 from Myrmidon), Sol (from scroll)
>
> Uses Infantry Second Seal → Knight
>
> - Strip Vantage (Myrmidon's L15 learnable skill)
> - Check Knight's learnableSkills: Guard at L15. Current level is 15 → learn Guard
> - Keep Sol (scroll-learned)
>
> **Result:** Level 15 Knight with Guard + Sol

**Promoted reclass example:**

> Swordmaster (from Myrmidon) has: Crit+15 (class innate), Vantage (learned), Luna (scroll)
>
> Uses Infantry Second Seal → General
>
> - Strip Vantage (Myrmidon's learnable, carried through promotion)
> - Strip Crit+15 (Swordmaster innate)
> - Gain Pavise (General innate)
> - Check General's base class (Knight) learnableSkills: Guard at L15. If level ≥ 15 → learn Guard
> - Keep Luna (scroll-learned)
>
> **Result:** General with Pavise + Guard + Luna + Swords (M) + Lances (M) + Axes (P)

**Edge case — duplicate skill:** If the new class would grant a skill the unit already has from a scroll, no duplication occurs. The skill is already known.

**Edge case — promotion path:** After reclass, the unit uses the new class's promotion path. Myrmidon → (Second Seal) → Archer → (Master Seal) → Sniper.

### 2.3 Class Pools

#### Infantry Second Seal — Target Classes

**Base tier targets:** Myrmidon, Knight, Fighter, Archer, Mage, Cleric, Thief, Mercenary

**Promoted tier targets:** Swordmaster, General, Warrior, Sniper, Sage, Bishop, Assassin, Hero

**Excluded from Infantry pool:**
- **Dancer** — Dance is too powerful to gain from a consumable. (Can reclass FROM Dancer → other infantry class, losing Dance.)
- **Lord classes** (Lord, Tactician, Ranger, Light Sage and all promoted lord variants) — narrative anchors, cannot be reclassed to or from.

#### Mount Second Seal — Target Classes

**Base tier targets:** Cavalier, Pegasus Knight, Wyvern Rider

**Promoted tier targets:** Paladin, Falcon Knight, Wyvern Lord

**Excluded:**
- **Lord classes** — same restriction as infantry.

### 2.4 Restrictions

| Rule | Detail |
|------|--------|
| Lords cannot use Second Seals | Edric/Kira/Voss/Sera are locked to their class lines |
| Cannot reclass TO Dancer | Dance is too powerful; Dancer excluded from all seal pools |
| Can reclass FROM Dancer | Player's choice — loses Dance, gains new class |
| Cannot cross Infantry↔Mount | Infantry Seal only reaches infantry/armored; Mount Seal only reaches cavalry/flying |
| Tier must match | Unpromoted↔unpromoted, promoted↔promoted |
| Cannot reclass to same class | No-op prevented; seal is not consumed |
| Bard (removed) | Bard/Dancer promotion removed from game; Dancer has no promotion path |

### 2.5 UI Flow

1. Open inventory → select Second Seal → "Use"
2. Show eligible class list (filtered by seal type + current tier)
3. Preview panel shows: new class name, weapon proficiencies gained, skills that will change
4. Confirm → class swaps instantly. Stats unchanged. Skills updated per rules.
5. Seal consumed.

---

## Part 3: Sickle & Hammer

### 3.1 Core Rules

| Property | Value |
|----------|-------|
| Rarity | Extremely rare |
| Availability | Act 3 loot only (weighted low), never in shops |
| Price | 0 (not for sale) |
| Effect | Reset unit to Level 1 of current class's base form |

**On use:**
1. Unit's class changes to the **base form of their current class.** General → Knight. Swordmaster → Myrmidon. Already-unpromoted classes stay the same class.
2. Level resets to **1.**
3. **Stats are kept.** All current stats persist — the unit is statistically powerful but gains 19+ levels of additional growth.
4. **All weapon proficiencies are kept.**
5. **All class-specific skills are stripped** — learned skills, class innate skills. As if truly Level 1 of that class.
6. **Scroll-learned skills are kept.** Unit investment is preserved.
7. **Personal skills are kept.**
8. **All growth rates permanently reduced by 20%.** Each use stacks: 1st use = -20%, 2nd = -40%, 3rd = -60%.
9. Growth reduction is **communicated in the confirmation prompt.**

### 3.2 Diminishing Returns

| Uses | Growth Penalty | Typical Effect |
|------|---------------|----------------|
| 1 | -20% all growths | Still strong. Most growths 30-50% → 10-30%. Worth it for 19 extra levels. |
| 2 | -40% all growths | Noticeable. Many growths near 0-20%. Gains become inconsistent. |
| 3 | -60% all growths | Barely functional. Most growths 0-10%. Only HP/STR might still tick. |

The system is naturally self-limiting. After 3 uses, the unit has gained ~57 levels of stat-ups but at drastically reduced rates. The math works out to roughly equivalent total stats as a normal unit that promoted once — but with more weapon proficiencies and flexibility.

### 3.3 Edge Cases

| Scenario | Behavior |
|----------|----------|
| Unpromoted unit uses it | Stays same class, resets to L1. Loses learned skills. Still gains growth penalty. |
| Reclassed unit uses it | Resets to base form of CURRENT class (not original). Swordmaster-who-was-once-Archer → Myrmidon. |
| Lord uses it | **Cannot.** Same restriction as Second Seal. |
| Unit at L1 uses it | Prevented — no benefit. Item not consumed. |
| Dancer uses it | Stays Dancer L1. Loses nothing (Dancer has no learnable skills). Gets growth penalty. Mostly pointless. |
| Growth penalty display | Confirmation dialog: "WARNING: All growth rates permanently reduced by 20%. Current penalty: [X]%. Proceed?" |

### 3.4 Sickle & Hammer Exploits:

The Issue: If a unit uses a Sickle & Hammer to reset to Level 1, they are technically back in the "Growth Rate" zone (Level 1-20). However, they retain their massive stats. If they then hit Level 21 again in the same run (very possible in Act 4/Lunatic), does the -20% penalty apply to the "Extended Leveling" +1 stat roll?

Interpretation: Logic suggests Extended Leveling should bypass the penalty (since it's a flat +1), but the loop creates a "stat god" exploit where players cycle Sickle -> Level 20 -> Extended Leveling to bypass the penalty mechanics entirely.

Resolution: Explicitly define that Sickle & Hammer resets the "Extended Leveling" flag. A unit that resets to Level 1 must progress through standard leveling (with the -20% penalty) until they hit Level 20 again.

Add Rule: The -20% penalty applies only to standard growth rolls (L1-20). It does not affect the +1 random stat from Extended Leveling. (This naturally balances it: the penalty hurts the journey back to 20, but the reward at 21+ remains consistent).

Additional exploits may be possible; need to carefully review/manage

---

## Part 4: Lord Selection

### 4.1 Core Design

- **Edric is always selected.** He is the narrative anchor and fail-state lord (run ends on his death).
- **Player picks one additional lord** at run start from available options.
- **Second lord dying:** Painful — lose a strong unit, personal skill, and their equipment. NOT run-ending.
- **Sera is always narratively present** for rewinds and blessings regardless of whether she's deployed.

### 4.2 Unlock Structure

| Lord | Unlock Condition | Rationale |
|------|-----------------|-----------|
| Sera | Always available | Narrative default — she's with Edric from the start |
| Voss | Beat Normal mode (full run victory) | Intermediate milestone |
| Kira | Beat Hard mode (full run victory) | Advanced milestone — rewards skilled players with the tactical mage |

### 4.3 UI Flow — Home Base Lords Tab

The existing **Lords** tab in Home Base is extended:

1. Top section: Lord portraits in a row (Edric highlighted/locked, others selectable)
2. Edric always shown with a crown/lock icon — cannot be deselected
3. Available lords show portraits + name + class + personal skill summary
4. Locked lords show silhouette + unlock requirement text (e.g., "Clear Normal mode to unlock")
5. Click an available lord to select them → highlighted border, checkmark
6. Only one additional lord can be selected at a time
7. Selection persists in slot meta data (remembered between runs within a save slot)
8. **Begin Run** uses Edric + selected lord as the starting roster

### 4.4 When Sera is NOT the Second Lord

If the player picks Voss or Kira instead of Sera:

- Sera is **narratively present** (flavor text, rewind charges, blessings still work)
- Sera does **not deploy** to battles — no unit on the map
- Rewind charges are **unchanged** (untied from Sera's deployment status)
- Node map vision is **unchanged** (Sera's prophecy still works narratively)
- If Sera IS selected and dies in battle: rewinds persist, vision persists (decided in planning session)

### 4.5 Meta-Progression Interaction

Lord-specific meta upgrades (Lord Growth, Lord Flat Stats, Lord Starting Equipment) apply to **both deployed lords.** This is intentional — the player is investing in "lords" as a category, not a specific lord.

Starting equipment upgrades that reference specific lords by name (e.g., "Healer's Art — Sera starts with a better staff") only apply when that lord is in the party.

---

## Part 5: Loot Table Restructure

### 5.1 Problem Statement

The current loot system has a single `rare` pool mixing skill scrolls, legendary weapons, and soon weapon art scrolls + reclassing items. With 27+ new items entering the pipeline, the flat-weighted pool becomes unacceptably diluted. A player looking for a Sol Scroll competes with 40+ items in the same bucket.

### 5.2 New Structure — Typed Sub-Pools with Independent Weights

Each act's loot table splits into named sub-pools. When loot is generated:
1. Roll against the top-level `weights` to select a category
2. Pick a random item from that category's pool
3. For categories with internal item weights (like `special_items`), use weighted random within the pool

```
lootTables.json structure:
{
  "act1": {
    "weapons": [...],
    "consumables": [...],
    "accessories": [...],
    "forge": [...],
    "skill_scrolls": [...],       // NEW — split from old "rare"
    "art_scrolls": [...],         // NEW — weapon art scrolls
    "legendary": [...],           // NEW — legendary weapons only
    "special_items": [...],       // NEW — Second Seals, Sickle & Hammer
    "weights": { ... },
    "goldRange": [min, max]
  }
}
```

### 5.3 Roster Filtering

**Weapons:** Filtered by roster proficiencies (existing behavior). Only drop weapons someone on roster can use.

**Art scrolls:** Filtered by roster proficiencies with a **5% leak rate.** 95% of the time, only drop art scrolls matching a weapon type someone on roster uses. 5% chance to drop any art scroll regardless. This gives occasional "plan ahead" moments — find a Burning Quake Scroll before you have a mage, then recruit one later.

**Skill scrolls:** No filtering (all skills are universally equippable).

**Accessories, consumables, forge, special_items, legendary:** No filtering.

### 5.4 Full Loot Tables by Act

#### Act 1

| Category | Weight | Pool |
|----------|--------|------|
| weapon | 20 | Hand Axe, Javelin, Steel Sword, Steel Lance, Steel Axe, Steel Bow, Elfire, Shine, Mend, Horseslayer, Armorslayer, Lancereaver, Swordreaver, Axereaver, Wind Sword |
| consumable | 12 | Vulnerary ×4, Master Seal |
| gold | 30 | 300–500 |
| accessory | 12 | Goddess Icon, Shield Ring, Forest Charm |
| forge | 12 | Might Whetstone, Hit Whetstone, Weight Whetstone |
| art_scroll | 8 | Grounder Scroll (Sword/Iron), Helm Splitter Scroll (Axe/Iron) |
| skill_scroll | 0 | — |
| legendary | 0 | — |
| special_items | 0 | — |

**Notes:** Art scrolls in Act 1 are limited to Iron-tier arts that feel appropriate for early game. A few Steel-tier utility scrolls could be added (e.g., Encloser Scroll, Windsweep Scroll) if playtesting shows Act 1 loot needs more excitement. Weight of 8 means ~1 in 12 loot drops is an art scroll — rare enough to feel special, common enough to be seen in most runs.

Skill scrolls, legendaries, and special items are not available in Act 1.

#### Act 2

| Category | Weight | Pool |
|----------|--------|------|
| weapon | 16 | Short Spear, Longbow, Horseslayer, Armorslayer, Killing Edge, Hammer, Spear, Killer Lance, Physic, Bolganone, Aura |
| consumable | 10 | Vulnerary, Elixir, Master Seal, Energy Drop, Spirit Dust, Secret Book, Speedwing, Dracoshield, Talisman, Angelic Robe |
| gold | 16 | 600–900 |
| accessory | 10 | Power Ring, Speed Ring, Barrier Ring, Skill Ring, Life Ring, Veteran's Crest |
| forge | 12 | Silver Whetstone, Might Whetstone, Crit Whetstone, Hit Whetstone, Weight Whetstone |
| skill_scroll | 10 | Sol Scroll, Luna Scroll, Guard Scroll, Cancel Scroll, Desperation Scroll |
| art_scroll | 10 | Windsweep, Lunge, Grounder, Hexblade, Knightkneeler, Vengeance, Helm Splitter, Wild Abandon, Rushing Blow, Encloser, Ward Arrow, Healing Light, Seraphim |
| legendary | 0 | — |
| special_items | 6 | Infantry Second Seal (weight 1) |

**Notes:** Skill scrolls and art scrolls each get 10% — combined 20% chance of "some kind of scroll" which feels exciting without overwhelming. Infantry Second Seal enters at a modest 6% category weight, and since it's the only item in the pool, it drops whenever the category triggers.

#### Act 3

| Category | Weight | Pool |
|----------|--------|------|
| weapon | 14 | Silver Sword, Silver Lance, Silver Axe, Silver Bow, Bolganone, Aura, Recover, Physic, Killing Edge, Hammer, Tomahawk, Spear, Killer Lance, Venin Blade, Killer Axe, Killer Bow, Tempest Blade, Levin Sword |
| consumable | 8 | Elixir, Master Seal, Energy Drop, Spirit Dust, Secret Book, Speedwing, Dracoshield, Talisman, Angelic Robe |
| gold | 10 | 900–1400 |
| accessory | 8 | Seraph Robe, Magic Ring, Boots, Delphi Shield, Wrath Band, Counter Seal, Pursuit Ring, Nullify Ring |
| forge | 8 | Silver Whetstone, Might Whetstone, Crit Whetstone, Hit Whetstone, Weight Whetstone |
| skill_scroll | 12 | Astra, Vantage, Wrath, Adept, Miracle, Quick Riposte, Death Blow, Darting Blow, Shove, Pull |
| art_scroll | 12 | Dragonhaze, Longearche, Glowing Ember, Armored Strike, Deadeye, Hunter's Volley, Burning Quake, Nosferatu, Silence Strike |
| legendary | 12 | Ragnarok, Soulreaver, Bolting, Gemini, Doomblade, Gae Bolg, Starfall, Stormbreaker, Ruin |
| special_items | 8 | Infantry Second Seal (weight 3), Mount Second Seal (weight 2), Sickle & Hammer (weight 1) |

**Notes:** Act 3 is the climax. Legendaries at 12% feel generous but this is the final stretch before the boss. Special items at 8% with internal weighting means: when it triggers, ~50% Infantry Seal, ~33% Mount Seal, ~17% Sickle & Hammer.

Skill scrolls get bumped to 12% (from 10% in Act 2) because the Act 3 skill pool is stronger (Astra, Death Blow, etc.) and players need them for endgame builds.

#### Final Boss

| Category | Weight | Pool |
|----------|--------|------|
| gold | 100 | 1200–1800 |

No changes. Gold only.

### 5.5 Shop Availability for New Items

| Item | Shop Appearance | Price | Notes |
|------|----------------|-------|-------|
| Infantry Second Seal | Act 3+ shops (all difficulties) | 3000 | Expensive but guarantees access |
| Mount Second Seal | Never in shops | — | Loot only |
| Sickle & Hammer | Never in shops | — | Loot only |
| Herb | Hard Act 3+, Lunatic Act 2+ | 400 | Status countermeasure |
| Pure Water | Hard Act 3+, Lunatic Act 2+ | 600 | Status countermeasure |
| Remedy | Hard Act 3+, Lunatic Act 2+ | 800 | Status countermeasure |
| Restore Staff | Hard Act 3+, Lunatic Act 2+ | 1500 | Status countermeasure |

### 5.6 consumables.json Additions

```json
[
  {
    "name": "Infantry Second Seal",
    "type": "Consumable",
    "effect": "reclass",
    "reclassPool": "infantry",
    "uses": 1,
    "price": 3000
  },
  {
    "name": "Mount Second Seal",
    "type": "Consumable",
    "effect": "reclass",
    "reclassPool": "mount",
    "uses": 1,
    "price": 0
  },
  {
    "name": "Sickle & Hammer",
    "type": "Consumable",
    "effect": "classReset",
    "growthPenalty": 20,
    "uses": 1,
    "price": 0
  }
]
```

---

## Part 6: enemies.json Updates

### 6.1 Wyvern Addition to Enemy Pools

```json
{
  "pools": {
    "act1": {
      "base": ["Myrmidon", "Fighter", "Archer", "Cavalier"],
      "promoted": []
    },
    "act2": {
      "base": ["Myrmidon", "Fighter", "Knight", "Archer", "Cavalier", "Mage", "Thief", "Pegasus Knight", "Wyvern Rider"],
      "promoted": []
    },
    "act3": {
      "base": ["Myrmidon", "Fighter", "Knight", "Archer", "Cavalier", "Mage", "Thief", "Pegasus Knight", "Wyvern Rider"],
      "promoted": ["Swordmaster", "General", "Paladin", "Sniper", "Wyvern Lord"]
    },
    "postAct": {
      "base": ["Myrmidon", "Fighter", "Cavalier", "Mage"],
      "promoted": ["Swordmaster", "General", "Warrior", "Paladin", "Sniper", "Sage", "Falcon Knight", "Hero", "Wyvern Lord"]
    },
    "finalBoss": {
      "base": [],
      "promoted": ["Swordmaster", "General", "Warrior", "Paladin", "Sniper", "Sage", "Hero", "Wyvern Lord"]
    }
  }
}
```

---

## Part 7: Edge Cases & Rules Summary

### 7.1 Comprehensive Edge Case Table

| Scenario | Behavior | Rationale |
|----------|----------|-----------|
| Lord uses Second Seal | **Blocked.** Item grayed out, cannot target lords. | Narrative anchor; lords have fixed class identity |
| Lord uses Sickle & Hammer | **Blocked.** Same as above. | Same rationale |
| Dancer uses Infantry Second Seal | **Allowed.** Dancer becomes target class, loses Dance. | Player's deliberate choice. Painful but valid. |
| Unit reclasses TO Dancer | **Blocked.** Dancer excluded from all seal target pools. | Dance is too powerful to gain from a consumable |
| Promoted unit uses Infantry Seal | Shown only promoted infantry targets. Cannot pick base classes. | Tier-locked |
| Unpromoted unit uses Mount Seal | Shown only base mounted/flying targets. | Tier-locked |
| Reclassed unit uses Sickle | Resets to base form of CURRENT class, not original. | Current class is what matters |
| Unit with no learnable skills reclasses | No skills to strip; check new class for skills at level. | Clean — just gain |
| Unit already has new class's learnable skill (from scroll) | No duplication. Skill already known. | Prevent exploits |
| Reclass to same class | **Blocked.** Seal not consumed. | No-op prevention |
| Reclass changes moveType | Effectiveness changes immediately. Horse→Infantry loses cavalry weakness. Infantry→Flying gains bow weakness. | Combat checks current class |
| Reclass to class with Canto innate (Paladin/Falcon Knight) | Gain Canto immediately. | Class innate applies on reclass |
| Reclass FROM class with Canto | Lose Canto immediately. | Class innate stripped on reclass |
| Sickle on unit at Level 1 | **Blocked.** No benefit. Item not consumed. | Waste prevention |
| Sickle on unpromoted unit | Stays same class at L1. Loses learnable skills. Gets -20% growths. | Legal but often unwise |
| Sickle + Second Seal combo | Legal. Sickle first → L1 base class → level up → Second Seal → new class. -20% growths from Sickle persists. | The "infinite growth" dream path, self-limited by growth penalty |
| Multiple Sickle uses | Each adds -20% to all growths (cumulative). 3rd use = -60%. | Self-limiting. Most growths become 0-10% after 3 uses |
| Bard class | **Removed from game.** Dancer has no promotion path. | Design decision (pre-existing) |

### 7.2 Data Model Changes

**Unit object additions for reclassing/Sickle support:**

```javascript
unit.sickleUses = 0;          // Track number of Sickle & Hammer uses
unit.scrollSkills = [];        // Skills learned from scrolls (persist through reclass)
unit.originalClassName = null;  // Optional: track original class for display/flavor
```

Growth penalty is applied as: `effectiveGrowth = baseGrowth - (sickleUses * 20)`, clamped to minimum 0.

---

## Part 8: Implementation Sequencing

### Phase 1: Wyvern Classes
1. Add Wyvern Rider + Wyvern Lord to `classes.json`
2. Add Stun + Intimidate skills to `skills.json`
3. Add `STR_HALF` activation type to SkillSystem.js
4. Add Wyvern Rider to Act 2 enemy pool, Wyvern Lord to Act 3+ enemy pools
5. Add Draven (Wyvern Rider) to Act 2 recruit pool
6. Tests: Wyvern stat blocks, Stun proc rate, Intimidate aura, enemy spawning, recruit availability

### Phase 2: Loot Table Restructure
7. Refactor `lootTables.json` to new sub-pool structure
8. Update LootSystem.js: category weight roll → pool selection → item pick (with internal weights for special_items)
9. Implement roster-based art scroll filtering with 5% leak rate
10. Add Infantry Second Seal, Mount Second Seal, Sickle & Hammer to consumables.json
11. Add new items to shop inventory with act/difficulty gating
12. Tests: weight distribution, roster filtering, leak rate, shop availability by act/difficulty

### Phase 3: Second Seal System
13. Implement reclass logic in UnitManager.js (class swap, skill swap, proficiency union)
14. Build seal target pool generation (Infantry vs Mount, tier-filtered, Dancer excluded, Lord blocked)
15. Reclass UI flow in inventory/roster screen
16. Effectiveness-follows-current-class verification in Combat.js
17. Tests: full reclass flows, skill swap correctness, proficiency accumulation, effectiveness change, blocked cases

### Phase 4: Sickle & Hammer
18. Implement class reset logic (to base form, L1, strip skills, keep stats)
19. Growth penalty tracking (`sickleUses` on unit, applied in level-up)
20. Confirmation dialog with growth penalty warning
21. Tests: reset correctness, growth penalty accumulation, L1 block, scroll skill persistence

### Phase 5: Lord Selection
22. Extend Home Base Lords tab with selection UI
23. Milestone-based unlock checks (Normal victory for Voss, Hard victory for Kira)
24. Run initialization: start with Edric + selected lord
25. Handle Sera-not-deployed narrative state (rewinds/vision still active)
26. Tests: unlock gating, lord selection persistence, dual-lord run initialization, Sera narrative state

### Phase 6: Polish
27. Inspection panel updates for reclassed units (show original class? accumulated proficiencies?)
28. Combat forecast accuracy with new effectiveness rules
29. Balance pass on loot weights based on playtest data

---

## Appendix A: Resolved Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Wyvern weapon type | Lances (base), +Axes (promoted) | Differentiates from Falcon Knight's +Swords; axes match heavy bruiser identity |
| Wyvern innate skill | Stun (STR/2%: 2x damage + Root) | STR-scaling keeps proc rate low on the class that has it; Root synergizes with status system |
| Wyvern Lord innate | Intimidate (-20 Hit to enemies within 2 tiles) | Defensive aura that helps compensate for bow weakness |
| Stun activation rate | STR/2% (not STR%) | STR% would proc at 40-50%+ which is too reliable for 2x damage + CC |
| Dancer reclass rules | Can reclass FROM (losing Dance), cannot reclass TO | Dance too powerful to gain from consumable |
| Lord reclass | Blocked entirely | Narrative anchors with fixed class identity |
| Skill behavior on reclass | Swap class skills, keep scroll skills, keep personal | Clean model; class identity changes, unit investment preserved |
| Sickle growth penalty | -20% all growths per use | Self-limiting; 3 uses makes most growths nonfunctional |
| Mount Second Seal availability | Act 3 loot only, never in shops | Rare and exciting find; infantry reclass is the common one |
| Loot restructure | Split into typed sub-pools with independent weights | Prevents dilution; each item type has fair discovery rate |
| Art scroll filtering | Roster-filtered with 5% leak rate | Mostly relevant drops with occasional "plan ahead" moments |
| Lord selection unlock | Voss: beat Normal, Kira: beat Hard | Milestone-based; rewards progression |
| Bard class | Removed | Dancer has no promotion path (pre-existing decision) |

## Appendix B: New Data File Changes Summary

| File | Changes |
|------|---------|
| `classes.json` | +2 entries (Wyvern Rider, Wyvern Lord) |
| `skills.json` | +2 entries (Stun, Intimidate) |
| `consumables.json` | +3 entries (Infantry Second Seal, Mount Second Seal, Sickle & Hammer) |
| `enemies.json` | Wyvern Rider in act2 base, Wyvern Lord in act3/postAct/finalBoss promoted |
| `recruits.json` | +1 entry in act2 pool (Draven, Wyvern Rider) |
| `lootTables.json` | Full restructure: 8 sub-pools per act with independent weights |
| `metaUpgrades.json` | No changes in this doc (Iron Arms/Steel Arms covered in combat expansion doc) |
