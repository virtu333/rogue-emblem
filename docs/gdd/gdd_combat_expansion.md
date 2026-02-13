# Combat Expansion Design — Weapon Arts & Status Staves (v3 FINAL)

> **Ported from:** `References/GDDExpansion/` (Feb 13, 2026)
> **Implementation status:** Weapon Arts phases 1-2 shipped (39 of 67 arts in code). Stat-scaling arts, magic catalog, tactical-depth arts (effectiveness/no-counter/range modifiers), combat flags, and act/meta progression are on `main`. Status staves remain future scope — deferred until after Act 4 stabilizes.

**Date:** February 11, 2026
**Status:** Design complete — partially implemented (weapon arts phases 1-2 shipped, status staves deferred)
**Dependencies:** Forging system, scroll system, loot tables, meta-progression, skill system
**Source Research:** Serenes Forest — Echoes: SoV, Three Houses, Engage combat arts/skills

---

## Part 1: Weapon Arts System

### 1.1 Design Philosophy

Weapon Arts give players a resource-management decision each combat: spend HP for a powerful effect, or play safe with a normal attack. This creates tension that scales naturally — HP is always scarce in a roguelike, and arts reward aggressive play while punishing recklessness.

**Key design lessons from FE research:**

- **Echoes model (HP cost, weapon-tied):** Arts are intrinsic to specific weapons. Iron Sword always has Wrath Strike. Creates strong weapon identity but limits build diversity.
- **Three Houses model (durability cost, character-learned):** Arts learned by characters, equipped in 3 slots, usable with any weapon of that type. More customizable but less weapon identity.
- **Engage model (movement-integrated, type-bonus effects):** Arts interact with positioning — Lunge, Override, Advance. Movement is a combat resource alongside damage.
- **Emblem Rogue hybrid:** Arts are tied to weapons (like Echoes), but can be added via scrolls (like Three Houses equipping). HP cost model (no durability system). Random innate art assignment from tier pools makes every weapon drop unique across runs. Only Legendary weapons have fixed signature arts.

### 1.2 Core Mechanics

**Action Menu Integration:**
```
Attack | Art ▸ | Equip | Item | Wait
              ├─ Wrath Strike (Iron Sword)
              ├─ Hexblade (Steel Sword)
              └─ Encloser (Steel Bow)
```
- Art submenu shows the art name AND the weapon it will use in parentheses
- Selecting an art auto-equips that weapon for the attack
- If only 1 art exists across all carried weapons → "Art" directly activates it (no submenu)
- If 0 arts across all weapons → "Art" doesn't appear
- Art replaces the normal attack for that action (not additive)
- Art button grayed out if unit HP ≤ art cost (can't kill yourself)
- A unit might have arts on multiple weapons — the menu shows all available arts across inventory

**HP Cost by Weapon Tier:**

| Tier | HP Cost Range | Design Intent |
|------|--------------|---------------|
| Iron | 3–5 HP | Modest. Safe to use 2-3 times per battle |
| Steel | 5–8 HP | Meaningful. Must weigh risk. ~2 uses before danger |
| Silver | 10–12 HP | Significant. Commit or don't. 1 use + healing needed |
| Legendary | 12–18 HP | Build-defining. Using this IS your turn's strategy |

**Arts Per Weapon:**
- Max 3 art slots per weapon
- All weapons come with at most 1 innate art (randomly rolled from tier-appropriate pool for that weapon type)
- Iron/Steel only get an innate art after meta-progression unlock
- Silver always spawns with 1 random innate art
- Legendary weapons have 1 fixed signature art (not random)
- Additional arts added via Weapon Art Scrolls (up to 3 total)
- UI tooltip: shows "Arts: 1/3" or "Arts: Windsweep, —, —"

**Combat Rules for Arts:**
- Arts **cannot** trigger follow-up attacks (consistent with FE precedent)
- Arts **can** trigger on-attack skills (Sol, Luna, Astra, etc.) — intentional for build synergy
- Arts **can** crit (unless specifically noted otherwise)
- Arts deal their damage based on the weapon's stats modified by the art's bonuses
- Brave/consecutive-hit arts use modified damage per hit as noted in each art
- Effectiveness from arts caps at 5x total when combined with weapon effectiveness (see 1.9)
- Art-inflicted status conditions (Encloser → Root, Ward Arrow → Silence, Seal arts) are automatic on hit — no MAG vs RES roll. Duration is always 1 turn (shorter than staff-inflicted conditions).

### 1.3 Innate Art Distribution (Random Pool System)

When a weapon spawns (via loot, shop, or starting loadout), if it qualifies for an innate art, one art is rolled randomly from the tier-appropriate pool for that weapon type.

**Iron/Steel weapons: NO innate arts by default.**
- Meta-progression unlock: "Iron Arms" → Iron weapons spawn with 1 random art from Iron pool
- Meta-progression unlock: "Steel Arms" → Steel weapons spawn with 1 random art from Steel pool
- Same weapon can roll differently across runs (roguelike variety)

**Silver weapons: 1 random innate art always.**
- Rolled from the Silver pool for that weapon type
- A Silver Sword could get Finesse Blade, Shadow Gambit, Astra Strike, or Dragonhaze

**Legendary weapons: 1 fixed signature art always.**
- Not random — each legendary has a specific identity-defining art
- See Section 1.5 for full legendary art assignments

**Scrolls can add arts from ANY tier to ANY weapon** (as long as it matches weapon type). You could put an Iron-tier Wrath Strike on a Silver Sword via scroll if you wanted a cheap reliable option alongside the Silver innate art.

### 1.4 Weapon Art Catalog — Standard Pool

Arts organized by weapon type. Tomes and Light magic share a unified "Magic" pool since scroll drops for a thin weapon type would feel bad. Each art lists its `tierAffinity` — the pool(s) it can randomly appear in as an innate art.

**Identity by type:**
- **Swords** = Precision, speed, evasion, repositioning, counter-play
- **Lances** = Reach, positioning, anti-cavalry, defensive scaling
- **Axes** = Raw power, risk/reward, armor-breaking, war cries
- **Bows** = Range extension, debuffs, utility, high-stakes shots
- **Magic (Tomes + Light)** = AoE, penetration, sustain, debuffs

---

#### SWORD ARTS (Iron: 3 | Steel: 6 | Silver: 4)

| Art Name | HP Cost | Effect | Tier Affinity | Notes |
|----------|---------|--------|---------------|-------|
| Wrath Strike | 3 | +5 Might, +10 Hit | Iron | Basic reliable damage boost |
| Dueling Blade | 4 | +30 Avoid during this combat | Iron | Offensive + defensive. Great on Myrmidons |
| Advancing Strike | 4 | Move 1 tile toward a foe 2 tiles away and attack | Iron | Gap-closer. Infantry catching up to cavalry |
| Windsweep | 5 | Prevents enemy counter-attack | Steel | Safe chip damage. Key tactical tool |
| Hexblade | 6 | Targets RES instead of DEF | Steel | Magical sword strike. Fantastic vs Knights |
| Grounder | 7 | Effective vs Flying (3x) | Iron | Gives swords anti-air utility |
| Lunge | 6 | After combat, swap positions with the enemy | Steel | Repositioning art. Pull enemies out of formation or push past chokepoints |
| Seal Speed | 6 | After combat, target SPD -4 for 1 turn | Steel | Sets up doubles for allies on follow-up attacks |
| Poison Strike | 5 | After combat, target loses 5 HP | Steel | Chip damage art. Consistent attrition |
| Finesse Blade | 10 | +SKL/2 to damage | Silver | Rewards high-SKL units (Swordmasters) |
| Shadow Gambit | 10 | +10 Crit, ignores terrain DEF/Avoid | Silver | Precision kill art. Assassin fantasy |
| Astra Strike | 10 | 3 consecutive hits at 50% damage | Silver | Mini-Astra. 150% total if all hit |
| Dragonhaze | 10 | +SPD/2 to damage | Silver | SPD-scaling alternative. Fast units deal huge bonus damage |

#### LANCE ARTS (Iron: 3 | Steel: 3 | Silver: 3)

| Art Name | HP Cost | Effect | Tier Affinity | Notes |
|----------|---------|--------|---------------|-------|
| Tempest Lance | 3 | +8 Might | Iron | Simple power boost |
| Hit and Run | 4 | +10 Avoid; user retreats 1 tile after combat | Iron | Positioning art. Cavalry love this |
| Countering Strike | 4 | +5 DEF during this combat | Iron | Defensive option. Tank art for enemy phase |
| Knightkneeler | 6 | Effective vs Cavalry (3x) | Steel | Core anti-cav tool |
| Shatter Slash | 6 | After combat, target DEF -3 for 1 turn | Steel | Setup art for follow-up attacks by allies |
| Vengeance | 7 | +damage equal to HP lost (max HP - current HP) | Steel | Risk/reward. Incredible at low HP |
| Overrun | 10 | +4 Might; pushes target 1 tile back after combat | Silver | Forced repositioning |
| Longearche | 10 | This attack has Range 2 (melee lance hits from distance) | Silver | Turns melee lance into ranged for 1 attack |
| Glowing Ember | 10 | +DEF/2 to damage, +10 Avoid | Silver | DEF-scaling. Knight/General hitting hard |

#### AXE ARTS (Iron: 3 | Steel: 4 | Silver: 3)

| Art Name | HP Cost | Effect | Tier Affinity | Notes |
|----------|---------|--------|---------------|-------|
| Smash | 3 | +20 Hit, +20 Crit | Iron | Fixes axes' accuracy problem |
| Gamble | 4 | +10 Might, -30 Hit | Iron | Swing for the fences. Pure risk/reward |
| Helm Splitter | 5 | Effective vs Armored (3x) | Iron | Anti-armor available early. Pairs with Hammer |
| Wild Abandon | 6 | +10 Might, -30 Hit, +30 Crit | Steel | Maximum risk/reward. Axe identity |
| Diamond Axe | 8 | +14 Might, -20 Hit | Steel | Pure power. Less crit than Wild Abandon |
| Rushing Blow | 7 | +4 Might; after combat, user moves 1 tile past the enemy | Steel | Aggressive repositioning. Break through enemy lines |
| Rallying Blow | 8 | Normal attack; allies within 2 tiles gain +3 STR, +10 Crit for 1 turn | Steel | Support-offense hybrid. War cry fantasy |
| Armored Strike | 10 | +DEF/2 to damage | Silver | Generals/Warriors deal huge art damage |
| Pavise Strike | 10 | -3 Might, but take half physical damage during this combat | Silver | Attack + survive. Tank's dream art |
| Rallying Blow | 10 | Normal attack; allies within 2 tiles gain +3 STR, +10 Crit for 1 turn | Silver | Support-offense hybrid. War cry fantasy |

> **Note:** Rallying Blow appears at both Steel and Silver with different HP costs. The Silver version is identical in effect but costs more HP due to the tier it spawns in. When rolled as innate, the weapon tier determines which version appears. Scrolls apply the version matching the target weapon's tier. Alternatively, we can differentiate them:

**REVISED — Split Rallying Blow into two distinct arts:**

| Art Name | HP Cost | Effect | Tier Affinity | Notes |
|----------|---------|--------|---------------|-------|
| War Cry | 7 | Normal attack; allies within 2 tiles gain +3 STR for 1 turn | Steel | Simpler buff. Team offense boost |
| Rallying Blow | 10 | Normal attack; allies within 2 tiles gain +3 STR, +10 Crit for 1 turn | Silver | Stronger buff. Enables crit combos |

**CORRECTED AXE POOL (Iron: 3 | Steel: 4 | Silver: 3):**

| Art Name | HP Cost | Effect | Tier Affinity |
|----------|---------|--------|---------------|
| Smash | 3 | +20 Hit, +20 Crit | Iron |
| Gamble | 4 | +10 Might, -30 Hit | Iron |
| Helm Splitter | 5 | Effective vs Armored (3x) | Iron |
| Wild Abandon | 6 | +10 Might, -30 Hit, +30 Crit | Steel |
| Diamond Axe | 8 | +14 Might, -20 Hit | Steel |
| Rushing Blow | 7 | +4 Might; move 1 tile past enemy after combat | Steel |
| War Cry | 7 | Normal attack; allies within 2 tiles gain +3 STR for 1 turn | Steel |
| Armored Strike | 10 | +DEF/2 to damage | Silver |
| Pavise Strike | 10 | -3 Might, take half physical damage this combat | Silver |
| Rallying Blow | 10 | Normal attack; allies within 2 tiles gain +3 STR, +10 Crit for 1 turn | Silver |

#### BOW ARTS (Iron: 2 | Steel: 5 | Silver: 3)

| Art Name | HP Cost | Effect | Tier Affinity | Notes |
|----------|---------|--------|---------------|-------|
| Curved Shot | 3 | +1 Range, +30 Hit | Iron | Extends range to 3. Reliable |
| Heavy Draw | 5 | +8 Might | Iron | Simple power boost |
| Encloser | 6 | Inflicts Root (1 turn, automatic on hit) | Steel | Pin down threats. Incredible utility |
| Ward Arrow | 6 | Inflicts Silence (1 turn, automatic on hit) | Steel | Anti-mage utility. Shuts down magic + skills |
| Break Shot | 5 | After combat, target DEF -3 for 1 turn | Steel | Setup for melee allies |
| Waning Shot | 5 | After combat, target STR -3 for 1 turn | Steel | Weaken before enemy phase |
| Seal Magic | 5 | After combat, target MAG -4 for 1 turn | Steel | Anti-mage debuff. Reduce incoming magic damage |
| Deadeye | 10 | +3 Range (total range 5), -20 Hit | Silver | Extreme range snipe. Inaccurate tradeoff |
| All or Nothing | 11 | If attack hits, deal 2x damage. If misses, user takes 5 self-damage | Silver | High-stakes marksmanship |
| Hunter's Volley | 12 | 2 consecutive hits at 80% damage | Silver | 160% total. Bow's brave art. Sniper fantasy |

#### MAGIC ARTS — Tomes + Light unified pool (Iron: 2 | Steel: 5 | Silver: 5)

| Art Name | HP Cost | Applicable To | Effect | Tier Affinity | Notes |
|----------|---------|---------------|--------|---------------|-------|
| Focused Bolt | 3 | Tomes, Light | +5 Might, +10 Hit | Iron | Basic reliable boost |
| Resonance | 5 | Tomes, Light | +MAG/3 to damage | Iron | Rewards high-MAG. Available early |
| Seraphim | 7 | Tomes, Light | Effective vs Armored (3x, targets RES) | Steel | Magic anti-armor. Bypasses DEF entirely |
| Purifying Light | 6 | Light only | +5 Might normally; +10 Might vs dark enemies | Steel | Light's identity niche |
| Healing Light | 7 | Tomes, Light | After combat, heal self for 30% of damage dealt | Steel | Sustain for fragile mages |
| Mire | 10 | Tomes, Light | +2 Range, -15 Hit | Silver | Long-range harassment, accuracy tradeoff |
| Burning Quake | 10 | Tomes only | AoE: hits target + adjacent enemies for 50% damage. Shows preview. | Silver | AoE! Mage's unique identity |
| Radiant Burst | 10 | Light only | Hits target + 1 random adjacent enemy for 75% damage | Silver | Light's mini-AoE |
| Silence Strike | 12 | Tomes, Light | After combat, target loses all abilities and magic for 2 turns | Silver | Full shutdown — magic AND skills |
| Nosferatu | 10 | Tomes, Light | Heal HP equal to 100% of damage dealt | Silver | Full drain. Expensive but sustaining |

### 1.5 Legendary Weapon Signature Arts

Each legendary weapon has 1 unique fixed signature art. These cannot be taught via scrolls or appear in random pools. Players can still add up to 2 more arts to legendaries via scrolls.

#### Brave Weapon Signature Arts

| Weapon | Art Name | HP Cost | Effect |
|--------|----------|---------|--------|
| Brave Sword | Phantom Rush | 15 | 2 hits at full damage; user can move 1 tile in any passable direction after combat and attack again (2 hits at full damage). User set to 5 HP after resolution. |
| Brave Lance | Piercing Charge | 14 | 2 hits at full damage that pierce through the target, also hitting the enemy directly behind (if any) for full damage. |
| Brave Axe | Galeforce Assault | 18 | 2 hits at full damage; user can move 1 tile and attack again (2 hits). User set to 5 HP. Allies within 2 tiles gain +3 STR for 1 turn. |
| Brave Bow | Barrage | 14 | 2 hits at full damage against target + all enemies adjacent to target take 1 hit at 50% damage. |

#### Other Legendary Signature Arts

| Weapon | Art Name | HP Cost | Effect |
|--------|----------|---------|--------|
| Ragnarok | Storm Blade | 14 | 2 hits at full damage; Windsweep (no counter); +5 DEF during combat; user retreats 1 tile after. |
| Soulreaver | Life Drain | 12 | Normal attack; heal HP equal to 150% of damage dealt. |
| Gemini | Twin Fang | 14 | 2 hits at full damage; if the first hit crits, the other automatically crits too. |
| Doomblade | Doom Thrust | 14 | Hits target and enemy on tile directly behind for full damage; pushes both 1 tile back. |
| Gae Bolg | Blood Lance | 15 | +damage equal to HP lost (Vengeance); +5 STR on next counterattack phase; 3x vs Cavalry. |
| Stormbreaker | Cataclysm | 15 | +20 Might; all enemies within 2 tiles of target take 5 fixed damage; +5 DEF/RES during combat. |
| Ruin | Annihilate | 14 | Ignores weapon triangle; +14 Might, -20 Hit; if kills, next ally to attack this turn gets +5 Might. |
| Starfall | Rain of Stars | 14 | 3 hits at 50% damage each; Range 2-3; +10 Hit per successive hit (2nd at +10, 3rd at +20). |
| Excalibur | Tempest | 12 | AoE: hits target + all adjacent enemies for 75% damage; 3x vs Flying on all targets. |
| Bolting | Cataclysm Bolt | 12 | AoE: hits target + all enemies within 2 tiles for 50% damage; Range 3-10. |
| Luce | Divine Flare | 14 | Ignore target's RES entirely; +10 Might vs dark enemies. |

### 1.6 Art Acquisition Pipeline

**How players get arts on their weapons:**

1. **Innate Arts (random from pool)** — Silver weapons always spawn with 1 random art. Iron/Steel after meta unlock. Legendaries have 1 fixed signature art.
2. **Weapon Art Scrolls** — Consumable item. Applied to a weapon to add a specific art. Weapon must have an open slot (< 3 arts). Scroll is weapon-type-locked.
3. **Forging** — Silver Whetstone (player's choice) can optionally "add a random art" instead of a stat boost. Creates interesting forge decisions.
4. **Loot/Shop** — Art Scrolls in Act 2+ loot rare pool and Act 3+ shops.

**Weapon Art Scroll Catalog:**

| Scroll Name | Art | Weapon Type | Price | Loot Pool |
|-------------|-----|-------------|-------|-----------|
| Windsweep Scroll | Windsweep | Sword | 2000 | Act 2 rare |
| Lunge Scroll | Lunge | Sword | 2000 | Act 2 rare |
| Grounder Scroll | Grounder | Sword | 2000 | Act 2 rare |
| Hexblade Scroll | Hexblade | Sword | 2000 | Act 2 rare |
| Dragonhaze Scroll | Dragonhaze | Sword | 2500 | Act 3 rare |
| Knightkneeler Scroll | Knightkneeler | Lance | 2000 | Act 2 rare |
| Vengeance Scroll | Vengeance | Lance | 2000 | Act 2 rare |
| Longearche Scroll | Longearche | Lance | 2500 | Act 3 rare |
| Glowing Ember Scroll | Glowing Ember | Lance | 2500 | Act 3 rare |
| Helm Splitter Scroll | Helm Splitter | Axe | 1500 | Act 2 rare |
| Wild Abandon Scroll | Wild Abandon | Axe | 1500 | Act 2 rare |
| Rushing Blow Scroll | Rushing Blow | Axe | 2000 | Act 2 rare |
| Armored Strike Scroll | Armored Strike | Axe | 2500 | Act 3 rare |
| Encloser Scroll | Encloser | Bow | 2000 | Act 2 rare |
| Ward Arrow Scroll | Ward Arrow | Bow | 2000 | Act 2 rare |
| Deadeye Scroll | Deadeye | Bow | 2500 | Act 3 rare |
| Hunter's Volley Scroll | Hunter's Volley | Bow | 2500 | Act 3 rare |
| Burning Quake Scroll | Burning Quake | Magic | 2500 | Act 3 rare |
| Nosferatu Scroll | Nosferatu | Magic | 2500 | Act 3 rare |
| Silence Strike Scroll | Silence Strike | Magic | 2500 | Act 3 rare |
| Healing Light Scroll | Healing Light | Magic | 2000 | Act 2 rare |
| Seraphim Scroll | Seraphim | Magic | 2000 | Act 2 rare |

Note: Not every art needs a scroll. Iron-tier arts (Wrath Strike, Smash, etc.) are common enough via meta-unlock innate spawns that scrolls aren't needed. Scrolls exist for Steel+ arts where targeted acquisition matters.

### 1.7 Meta-Progression Integration

New meta upgrades:

| Upgrade ID | Name | Category | Max Level | Costs | Effect |
|------------|------|----------|-----------|-------|--------|
| iron_arms | Iron Arms | starting_equipment | 1 | [400] | Iron weapons spawn with 1 random type-appropriate art |
| steel_arms | Steel Arms | starting_equipment | 1 | [800] | Steel weapons spawn with 1 random type-appropriate art. Requires: iron_arms level 1 |
| art_adept | Art Adept | starting_skills | 1 | [500] | Lord's starting weapon gains 1 additional random art |

**Interaction with Edric's starting loadout (Iron Sword + Steel Sword):**
- No meta: Both weapons artless
- Iron Arms: Iron Sword gets 1 random Sword Iron art (e.g., Advancing Strike)
- Iron Arms + Steel Arms: Both swords get arts (e.g., Advancing Strike on Iron, Lunge on Steel)
- + Art Adept: One weapon (random) gains 1 additional art (now has 2 arts)

### 1.8 Enemy Weapon Arts

| Difficulty | Act 1 | Act 2 | Act 3 | Final Boss |
|-----------|-------|-------|-------|------------|
| Normal | 0% (first 2 nodes), then 10% | 15% | 20% | Boss always |
| Hard | 20% | 30% | 40% | Boss + miniboss always |
| Lunatic | 50% | 55% | 60% | Boss + 60% all enemies |

- Enemy arts restricted to tier-appropriate pool (Iron arts on Iron weapons, etc.)
- No legendary signature arts on non-boss enemies
- Boss enemies get thematic arts or strong Silver-tier arts
- **UI requirement:** Combat forecast and inspection panel must show enemy arts. Forecast shows "Art: [Name]" with HP cost when enemy might use one.

### 1.9 Interaction with Existing Systems

**Forging:** Forged stats apply to art attacks. A forged +2 Might sword's art uses the boosted Might.

**Skills:** On-attack skills (Sol, Luna, Astra, Adept) can proc during arts.

**Brave weapons + Arts:** Brave weapons have unique signature arts (Section 1.5) that replace the normal brave double-hit. When NOT using an art, Brave weapons still attack twice normally. A scroll-applied non-signature art also replaces the brave double.

**Effectiveness stacking:** Cap at **5x** total. Example: Horseslayer (3x vs Cavalry) + Knightkneeler art = 5x vs Cavalry. Only one effectiveness type applies per combat if multiple would qualify.

**Art-inflicted conditions:** Encloser (Root), Ward Arrow (Silence), Seal Speed, Seal Magic, Poison Strike — all automatic on hit. No resistance roll. Duration is 1 turn. These are shorter and more reliable than staff-inflicted conditions to justify the HP cost.

**AoE arts:** Burning Quake, Radiant Burst, Barrage, Cataclysm Bolt, Tempest — all show a targeting preview highlighting affected tiles before confirmation. Player can cancel.

---

## Part 2: Status Staves System

### 2.1 Design Philosophy

Status staves add a new enemy threat axis in Act 2+ that demands roster-building answers. Players need to think about RES coverage and carry countermeasure items.

Status staves appear **only on enemies**. Countermeasure items let the player respond. This creates one-sided pressure that makes enemy composition more dangerous without giving the player an "I win" button.

### 2.2 Status Conditions

| Condition | Effect | Max Duration | Recovery | Visual |
|-----------|--------|-------------|----------|--------|
| Sleep | Unit cannot act. Ends immediately if attacked. | 3 turns | 50%/turn, or attacked, or Restore/Herb/Remedy | Zzz icon + grayed sprite |
| Berserk | Unit attacks nearest unit (ally or enemy). Player loses control. | 3 turns | 50%/turn, or Restore/Herb/Remedy | Red tint + rage icon |
| Silence | Unit cannot use magic (Tomes/Light/Staves) or activate any skills (passive or triggered). Physical attacks and items still work. | 3 turns | 50%/turn, or Restore/Herb/Remedy | Muted icon |
| Root | Unit cannot move. Can still attack in range, use items, use arts. Canto suppressed. | 2 turns | 50%/turn, or Restore/Herb/Remedy | Vine/chain icon + anchored sprite |

**Recovery notes:**
- Turn start: 50% chance to naturally recover each condition independently (before unit's action)
- Sleep: also ends immediately when attacked by anyone
- Restore/Herb/Remedy: clears ALL conditions at once
- Multiple conditions can stack; each resolves independently

### 2.3 Hit Formula (Staff-Inflicted Only)

```
Status Hit = Base Hit + (Caster MAG × 3) - (Target RES × 3)
Clamped to: [15%, 90%]
```

Art-inflicted conditions (Encloser, Ward Arrow, etc.) bypass this formula entirely — automatic on hit, 1-turn duration.

**Base hit by staff:**

| Staff | Base Hit |
|-------|----------|
| Sleep Staff | 40 |
| Berserk Staff | 40 |
| Silence Staff | 40 |
| Root Staff | 50 |

**Scenario analysis:**

| Caster MAG | Target RES | Staff | Raw Hit | Clamped |
|-----------|-----------|-------|---------|---------|
| 8 (Act 2 Mage) | 2 (Fighter) | Sleep 40 | 58% | 58% |
| 8 | 5 (Cavalier) | Sleep 40 | 49% | 49% |
| 8 | 7 (Sera/Cleric) | Sleep 40 | 43% | 43% |
| 12 (Act 3 Sage) | 5 | Sleep 40 | 61% | 61% |
| 12 | 10 (Bishop) | Sleep 40 | 46% | 46% |
| 12 | 15 (Sera promoted) | Sleep 40 | 31% | 31% |
| 8 | 2 (Fighter) | Root 50 | 68% | 68% |
| 12 | 15 (Sera promoted) | Root 50 | 41% | 41% |

### 2.4 Enemy Status Staves

| Staff | Condition | Range | Uses/Battle | Enemy Pool |
|-------|-----------|-------|-------------|------------|
| Sleep Staff | Sleep | 3-5 | 1 | Act 2+ Mages/Sages |
| Berserk Staff | Berserk | 3-5 | 1 | Act 3+ Sages only |
| Silence Staff | Silence | 3-7 | 2 | Act 2+ Mages/Sages |
| Root Staff | Root | 3-5 | 2 | Act 2+ Mages/Sages |

**Distribution by difficulty:**

| Difficulty | Act 1 | Act 2 | Act 3 | Final Boss |
|-----------|-------|-------|-------|------------|
| Normal | 0% | 0% | 0% | 0% |
| Hard | 0% | 0% | 8% mages | 15% mages |
| Lunatic | 0% | 8% mages | 15% mages | 25% mages |

Max 1 status staff enemy per battle on Hard, 1-2 on Lunatic.

### 2.5 AI Targeting Priority

1. **Berserk:** Target adjacent to most allies (maximize friendly fire)
2. **Sleep:** Highest-threat unit that hasn't acted this turn
3. **Silence:** Magic/staff users first
4. **Root:** Highest-MOV or Canto units (pin mobile threats)

AI uses status staff turns 1-2 if targets in range. After charges spent, switches to normal combat.

### 2.6 Countermeasure Items

| Item | Type | Effect | Uses | Price | Availability |
|------|------|--------|------|-------|-------------|
| Herb | Consumable | Remove ALL conditions from self or adjacent ally | 2 | 400 | Hard Act 3+ shops; Lunatic Act 2+ shops |
| Pure Water | Consumable | +7 RES for 1 battle (self only, pre-combat use) | 1 | 600 | Hard Act 3+ shops; Lunatic Act 2+ shops |
| Remedy | Consumable | Remove ALL conditions from self or adjacent ally + heal 10 HP | 1 | 800 | Act 3+ loot; Act 3+ shops (Hard/Lunatic) |
| Restore Staff | Staff (weapon) | Remove ALL conditions from 1 ally, range 1 | 2/battle | 1500 | Hard Act 3+ shops; Lunatic Act 2+ shops |

**Availability gating:**
- **Normal mode:** These items never appear (no status staves exist)
- **Hard Act 1-2:** Items don't appear (no status staves until Act 3)
- **Hard Act 3+:** All countermeasure items available in shops
- **Lunatic Act 1:** Items don't appear (no status staves)
- **Lunatic Act 2+:** Herb, Pure Water, Restore in shops. Remedy in Act 3+ loot/shops.

### 2.7 Edge Cases & Interactions

**Berserk behavior:**
- Attacks nearest unit (ally or enemy). Ties broken by lowest HP target.
- Can ONLY use Attack action. No arts, items, Dance, Trade, Swap, Shove, Pull.
- If no valid attack target in range: unit Waits.
- Berserked Dancer: Cannot Dance. Attempts Attack with Swords. If no target, Waits.
- Berserked Lord: Will attack allies. Counterplay: Herb/Restore/Remedy, position allies out of range, or wait for natural recovery.

**Berserk + Sleep:** Sleep takes priority (can't act at all). Berserk resumes if Sleep ends first.

**Silence scope:** Blocks Tomes, Light, Staves AND all skill activations (passive, on-attack, on-defend, on-combat-start, class innate). Physical weapons, consumable items, and basic physical attacks still work.

**Root behavior:** Cannot move. CAN attack, use items, equip, use arts, Dance (if adjacent). Canto suppressed.

**Status + Healing:** Heal staves/Vulneraries do NOT remove conditions. Only Herb, Restore, Remedy do.

**Multiple conditions:** All resolve independently. One Herb/Restore/Remedy clears everything.

### 2.8 Data Additions

**consumables.json additions:**

```json
[
  {
    "name": "Herb",
    "type": "Consumable",
    "effect": "removeAllConditions",
    "target": "self_or_adjacent",
    "healValue": 0,
    "uses": 2,
    "price": 400,
    "availabilityGating": { "requiresStatusStaves": true }
  },
  {
    "name": "Pure Water",
    "type": "Consumable",
    "effect": "tempStatBuff",
    "stat": "RES",
    "value": 7,
    "duration": "battle",
    "target": "self",
    "uses": 1,
    "price": 600,
    "availabilityGating": { "requiresStatusStaves": true }
  },
  {
    "name": "Remedy",
    "type": "Consumable",
    "effect": "removeAllConditions",
    "target": "self_or_adjacent",
    "healValue": 10,
    "uses": 1,
    "price": 800,
    "availabilityGating": { "requiresStatusStaves": true }
  }
]
```

**weapons.json additions:**

```json
[
  {
    "name": "Sleep Staff",
    "type": "Staff", "tier": "Silver", "rankRequired": "Prof",
    "might": 0, "hit": 40, "crit": 0, "weight": 3,
    "range": "3-5", "uses": 1, "perBattleUses": true,
    "special": "Inflicts Sleep", "statusEffect": "sleep",
    "enemyOnly": true, "price": 0
  },
  {
    "name": "Berserk Staff",
    "type": "Staff", "tier": "Silver", "rankRequired": "Prof",
    "might": 0, "hit": 40, "crit": 0, "weight": 4,
    "range": "3-5", "uses": 1, "perBattleUses": true,
    "special": "Inflicts Berserk", "statusEffect": "berserk",
    "enemyOnly": true, "price": 0
  },
  {
    "name": "Silence Staff",
    "type": "Staff", "tier": "Steel", "rankRequired": "Prof",
    "might": 0, "hit": 40, "crit": 0, "weight": 2,
    "range": "3-7", "uses": 2, "perBattleUses": true,
    "special": "Inflicts Silence (blocks magic + all skills)",
    "statusEffect": "silence", "enemyOnly": true, "price": 0
  },
  {
    "name": "Root Staff",
    "type": "Staff", "tier": "Steel", "rankRequired": "Prof",
    "might": 0, "hit": 50, "crit": 0, "weight": 2,
    "range": "3-5", "uses": 2, "perBattleUses": true,
    "special": "Inflicts Root (immobilize)",
    "statusEffect": "root", "enemyOnly": true, "price": 0
  },
  {
    "name": "Restore",
    "type": "Staff", "tier": "Silver", "rankRequired": "Prof",
    "might": 0, "hit": 100, "crit": 0, "weight": 2,
    "range": "1", "uses": 2, "perBattleUses": true,
    "healBase": 0,
    "special": "Removes all status conditions from target",
    "restoreConditions": true, "price": 1500
  }
]
```

### 2.9 Difficulty Integration

Update `difficulty.json`:

```json
"hard": {
  "enemyStatusStaffChance": 0.08,
  "statusStaffActGating": { "act1": 0, "act2": 0, "act3": 1.0, "finalBoss": 1.0 }
},
"lunatic": {
  "enemyStatusStaffChance": 0.15,
  "statusStaffActGating": { "act1": 0, "act2": 0.5, "act3": 1.0, "finalBoss": 1.0 }
}
```

Effective chance = `enemyStatusStaffChance × statusStaffActGating[act]`.

---

## Part 3: Roadmap Items Surfaced

1. **Deploy Rework** — Deploy screen before every map. Choose spawn points. Use items, manage inventory, equip weapons, trade between units. Full pre-battle preparation phase.
2. **Warp Staff** — Player-usable. Teleport ally to any tile in range. Powerful repositioning.
3. **Rescue Staff** — Player-usable. Pull distant ally to adjacent tile. Defensive repositioning.
4. **AoE Targeting Preview UI** — Highlight affected tiles before confirming AoE arts/weapons.
5. **Enemy Art Visibility** — Combat forecast and inspection panel must show enemy weapon arts.

---

## Part 4: Implementation Sequencing

### Phase 1: Weapon Arts Foundation
1. Create `data/weaponArts.json` with full catalog (pool system, tier affinity tags)
2. Add `innateArts` (array), `artSlots` (3), and innate art roll logic to weapon spawn pipeline
3. Implement art resolution in Combat.js (HP cost, effects, no follow-up, 5x effectiveness cap)
4. Add "Art ▸" to BattleScene action menu with weapon label in parentheses
5. Art-inflicted conditions: automatic on hit, 1-turn duration, no formula
6. Tests: art damage calc, HP cost, no-follow-up, prevent-counter, effectiveness cap, random pool distribution

### Phase 2: Art Acquisition & Meta
7. Weapon Art Scroll items added to consumables + loot tables
8. Apply-art-to-weapon flow in inventory UI (type-check, slot-check)
9. Meta-progression: Iron Arms, Steel Arms, Art Adept
10. Forge integration: Silver Whetstone "add random art" option
11. Tests: scroll application, slot limits, type enforcement, meta starting loadout with arts

### Phase 3: Legendary & Enemy Arts
12. Implement all legendary signature arts (Brave arts with set-to-5-HP, Galeforce, Pierce, etc.)
13. Enemy art assignment by difficulty tier (random from pool)
14. AoE targeting preview UI
15. Enemy art display in combat forecast + inspection panel
16. Tests: brave art resolution, set-to-5-HP, AoE splash, enemy art rates, forecast display

### Phase 4: Status Conditions Foundation
17. Status condition data model on units (conditions[], duration, turn counters)
18. Hit formula in Combat.js (base + MAG×3 - RES×3, clamp 15-90)
19. Condition resolution in TurnManager (Sleep skip, Berserk forced Attack/Wait, Silence blocks, Root blocks movement)
20. Natural recovery 50% rolls at turn start
21. Tests: application, duration caps, recovery, stacking, Berserk targeting, Silence skill blocking, Root + Canto

### Phase 5: Status Countermeasures & Integration
22. Herb, Pure Water, Remedy items with availability gating
23. Restore Staff (player-usable)
24. AI targeting priority for status staff enemies
25. Difficulty/act gating for staff spawns and item availability
26. Combat forecast: show status hit chance for staff enemies
27. Tests: countermeasure clearing all conditions, AI priority, gating, forecast

### Phase 6: Polish & Balance
28. Visual effects: status icons, AoE preview, art activation flash, movement arts animation
29. Inspection panel updates: arts on weapons, conditions on units
30. Playtest tuning: HP costs, hit formula, durations, enemy art rates, pool balance

---

## Appendix A: Pool Summary

### Standard Art Pools by Weapon Type and Tier

**Swords** (13 arts total)
| Tier | Count | Arts |
|------|-------|------|
| Iron | 3 | Wrath Strike, Dueling Blade, Advancing Strike |
| Steel | 6 | Windsweep, Hexblade, Grounder, Lunge, Seal Speed, Poison Strike |
| Silver | 4 | Finesse Blade, Shadow Gambit, Astra Strike, Dragonhaze |

**Lances** (9 arts total)
| Tier | Count | Arts |
|------|-------|------|
| Iron | 3 | Tempest Lance, Hit and Run, Countering Strike |
| Steel | 3 | Knightkneeler, Shatter Slash, Vengeance |
| Silver | 3 | Overrun, Longearche, Glowing Ember |

**Axes** (10 arts total)
| Tier | Count | Arts |
|------|-------|------|
| Iron | 3 | Smash, Gamble, Helm Splitter |
| Steel | 4 | Wild Abandon, Diamond Axe, Rushing Blow, War Cry |
| Silver | 3 | Armored Strike, Pavise Strike, Rallying Blow |

**Bows** (10 arts total)
| Tier | Count | Arts |
|------|-------|------|
| Iron | 2 | Curved Shot, Heavy Draw |
| Steel | 5 | Encloser, Ward Arrow, Break Shot, Waning Shot, Seal Magic |
| Silver | 3 | Deadeye, All or Nothing, Hunter's Volley |

**Magic — Tomes + Light** (10 arts total)
| Tier | Count | Arts |
|------|-------|------|
| Iron | 2 | Focused Bolt, Resonance |
| Steel | 3 | Seraphim, Purifying Light (Light only), Healing Light |
| Silver | 5 | Mire, Burning Quake (Tomes only), Radiant Burst (Light only), Silence Strike, Nosferatu |

**Total standard arts:** 52
**Legendary signature arts:** 15 (4 Brave + 11 other)
**Grand total:** 67 weapon arts

### Appendix B: Resolved Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Art innate distribution | Random from tier pool (not fixed per weapon) | Roguelike variety; same Silver Sword can roll differently across runs |
| Legendary arts | Fixed per weapon (not random) | Identity-defining; Brave Sword is always Phantom Rush |
| Effectiveness stacking | Cap at 5x | Meaningful for rare combos without instant-kill |
| Staff Arts | None (skipped) | Not worth UI complexity |
| AoE preview | Yes | Player clarity worth the investment |
| Brave + Art | Unique signature arts per Brave weapon | Preserves Brave identity |
| Status base hit | 40 (50 for Root) | Healthy curve; high-RES units resist meaningfully |
| Silence scope | Magic + ALL skills | Full shutdown creates clear counterplay |
| Art-inflicted conditions | Automatic on hit, 1 turn | No MAG/RES for physical attackers; reliable but short |
| Countermeasure clearing | ALL conditions at once | Simpler; worth the item slot |
| Countermeasure availability | Gated by difficulty + act | No dead items in safe modes |
| Tome + Light pool | Unified "Magic" | Prevents bad scroll drops for thin roster types |
