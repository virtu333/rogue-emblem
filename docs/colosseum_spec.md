# Colosseum Node Spec

## Overview

A new node type (`COLOSSEUM`) on the campaign node map that combines two services:
1. **Arena** — Send units into 1v1 fights against random challengers for XP and gold
2. **Mercenary Board** — Pay gold to recruit from a pool of mercenaries (separate from standard RECRUIT nodes)

Thematic pitch: A gladiatorial arena where warriors test their mettle. The player can train underleveled units through controlled fights, gamble on tougher opponents for bigger rewards, or hire sellswords from the crowd watching the fights.

---

## 1. Arena (1v1 Training Fights)

### Core Loop
1. Player selects a unit from their roster to enter the arena
2. A **challenger** is generated (random enemy from the act's pool, scaled to the entrant)
3. Player sees a **combat forecast** (same as the existing FE GBA-style forecast) and chooses:
   - **Fight** — Commit to the bout
   - **Withdraw** — Back out (no cost, no penalty)
4. Combat plays out using standard Combat.js resolution (weapon triangle, skills, crits, doubles — everything)
5. Outcome:
   - **Win** → Unit gains XP + gold prize. Unit can fight again or leave.
   - **Lose** → Unit is reduced to 1 HP (not killed). Ejected from the arena. Gold entry fee lost.
   - **Draw** (both unable to kill) → Both sides walk away. Entry fee refunded.

### Challenger Generation

Challengers are procedurally generated from the current act's enemy pool:

| Parameter | Formula |
|-----------|---------|
| **Class** | Random from act's `base` pool (Act 1-2) or `base + promoted` pool (Act 3+) |
| **Level** | `entrantLevel + offset`, where offset is drawn from a **tier** (see below) |
| **Weapons** | Random weapon appropriate to class, tier-scaled |
| **Skills** | Standard enemy skill assignment rules |

### Difficulty Tiers

Before each fight, the player picks a tier that determines the challenger's strength and the reward:

| Tier | Level Offset | Entry Fee | Gold Reward (win) | XP Multiplier |
|------|-------------|-----------|-------------------|---------------|
| **Bronze** | -1 to +0 | 50G | 80G | 0.8× |
| **Silver** | +0 to +2 | 100G | 200G | 1.0× |
| **Gold** | +2 to +4 | 200G | 450G | 1.3× |
| **Platinum** | +4 to +6 | 350G | 800G | 1.5× |

- Tier availability scales by act: Act 1 = Bronze/Silver, Act 2 = Bronze/Silver/Gold, Act 3+ = all four
- XP multiplier applies to the standard combat XP formula (so Gold tier fights give 1.3× the normal XP for that level difference)
- Entry fee is paid upfront; lost on defeat, refunded on draw

### Fight Limits
- Each unit can fight **up to 3 times** per Colosseum visit (prevents infinite grinding)
- HP/status carries between arena fights (no free healing between bouts)
- This makes the decision to "go again" genuinely risky — your unit is weakened

### Anti-Abuse Safeguards
- **XP diminishing returns:** If a unit has already gained 2+ levels at this Colosseum, subsequent XP gains are halved
- **No death:** Units are always reduced to 1 HP on loss, never killed (this is the arena's key selling point — safe training)
- **Challenger scaling:** Tied to the entrant's level, not party average, so you can't cheese by sending a Level 1 into Bronze tier with a broken weapon
- **Lord restriction (optional consideration):** Lords could be barred from Platinum tier to prevent easy overleveling of your anchor unit. Or: Lords can enter any tier but don't get the XP multiplier bonus.

### UX Flow
```
[Colosseum Menu]
  ├── Arena
  │   ├── Select Unit (roster list, shows current HP)
  │   ├── Select Tier (Bronze/Silver/Gold/Platinum)
  │   ├── Preview Challenger (combat forecast)
  │   ├── Fight / Withdraw
  │   ├── Combat Resolution (standard battle animation)
  │   └── Result Screen (XP gained, gold won/lost, "Fight Again?" if eligible)
  └── Mercenary Board
      └── (see section 2)
```

---

## 2. Mercenary Board (Paid Recruitment)

### Concept
Unlike standard RECRUIT nodes (where you get a free unit from the act pool), the Mercenary Board offers **premium recruits** for gold. These are stronger, more specialized, or from pools not normally available at this point in the run.

### How It Works
1. Colosseum generates 2-3 mercenary candidates on arrival
2. Each candidate has a **hire cost** displayed alongside their stat card
3. Player can hire as many as they can afford (and have roster space for)
4. Hired mercenaries join the roster immediately

### Mercenary Generation

| Property | Rule |
|----------|------|
| **Pool** | Mix of current act pool + next act's pool (gives early access to later classes) |
| **Level** | Lord level + random(-1, +1) — same as standard recruits |
| **Quality** | Higher average stats than standard recruits: +1 to two random stats |
| **Weapons** | Come equipped with a weapon one tier above what shops currently sell |
| **Skills** | 50% chance to spawn with a random combat skill (independent of `recruitRandomSkill` meta) |

### Pricing

| Act | Base Hire Cost | Notes |
|-----|---------------|-------|
| Act 1 | 300-500G | Steep early — this is a luxury, not a necessity |
| Act 2 | 500-800G | Competing with church promotions (3000G) and forge costs |
| Act 3 | 800-1200G | Premium promoted units available |

Price is randomized within the range per mercenary. Promoted-class mercenaries cost 1.5× the base range.

### What Makes This Different from RECRUIT Nodes
- **Costs gold** (RECRUIT nodes are free)
- **Better quality** (+1 to two stats, better starting gear, skill chance)
- **Cross-act pool access** (can get Act 2 classes during Act 1)
- **Multiple hires possible** (RECRUIT gives you one pick from candidates)
- **No guarantee of availability** (Colosseum nodes are rarer on the map)

---

## 3. Node Map Integration

### Placement Rules
- New node type: `COLOSSEUM` added to `NODE_TYPES` in constants.js
- **Frequency:** Max 1 per act, not guaranteed. ~40% chance to appear in an act's node layout.
- **Position:** Mid-to-late rows preferred (rows 2-4 of an act). Never row 0 (too early) or final row (that's boss).
- **Icon:** Colosseum/amphitheater icon on the node map (distinct from battle swords, shop bag, church cross)
- **Cannot replace** SHOP, CHURCH, or BOSS nodes — only competes with BATTLE/REST/RECRUIT slots

### Difficulty Scaling
- On **Hard:** Challenger level offsets increase by +1 across all tiers. Mercenary prices increase 20%.
- On **Lunatic:** Challengers always have 1 skill. Platinum tier challengers may have 2 skills. Mercenary prices increase 40%. Arena fight limit reduced to 2 per unit.

---

## 4. Economy Impact Analysis

### Gold Sink
The Colosseum is primarily a **gold sink** — you're paying entry fees and mercenary costs. Net gold from arena is positive only if you win consistently at Silver+ tiers.

Expected value per Colosseum visit (assuming 2 units × 2 fights each at Silver tier, 70% win rate):
- Entry fees: -400G
- Winnings: +280G (0.7 × 200 × 2 fights × 2 units... wait)
- Actually: 4 fights × (0.7 × 200 - 0.3 × 100) = 4 × (140 - 30) = **+440G net from arena**
- So arena is slightly gold-positive at Silver if you're good. Gold/Platinum are higher risk/reward.

The mercenary board is a pure sink (300-1200G per hire). Together, they create meaningful "do I invest in training or gear?" tension with shops.

### XP Budget
A unit winning 3 Silver-tier fights gains roughly the equivalent of 1.5-2 standard battle nodes worth of XP for that unit alone. This is significant but bounded by the 3-fight limit and diminishing returns.

---

## 5. Data Contract

### colosseum.json (new file in data/)
```json
{
  "arena": {
    "maxFightsPerUnit": 3,
    "diminishingReturnsAfterLevels": 2,
    "diminishingReturnsFactor": 0.5,
    "tiers": {
      "bronze": {
        "levelOffset": [-1, 0],
        "entryFee": 50,
        "goldReward": 80,
        "xpMultiplier": 0.8,
        "minAct": "act1"
      },
      "silver": {
        "levelOffset": [0, 2],
        "entryFee": 100,
        "goldReward": 200,
        "xpMultiplier": 1.0,
        "minAct": "act1"
      },
      "gold": {
        "levelOffset": [2, 4],
        "entryFee": 200,
        "goldReward": 450,
        "xpMultiplier": 1.3,
        "minAct": "act2"
      },
      "platinum": {
        "levelOffset": [4, 6],
        "entryFee": 350,
        "goldReward": 800,
        "xpMultiplier": 1.5,
        "minAct": "act3"
      }
    },
    "defeatHP": 1,
    "lordXpMultiplierOverride": null
  },
  "mercenaries": {
    "candidateCount": [2, 3],
    "statBonus": { "count": 2, "value": 1 },
    "skillChance": 0.5,
    "weaponTierBonus": 1,
    "pricing": {
      "act1": [300, 500],
      "act2": [500, 800],
      "act3": [800, 1200]
    },
    "promotedMultiplier": 1.5,
    "crossActPoolAccess": true
  },
  "difficulty": {
    "hard": {
      "challengerLevelBonus": 1,
      "mercenaryPriceMultiplier": 1.2
    },
    "lunatic": {
      "challengerLevelBonus": 2,
      "challengerMinSkills": 1,
      "platinumMaxSkills": 2,
      "mercenaryPriceMultiplier": 1.4,
      "maxFightsPerUnit": 2
    }
  },
  "nodeGeneration": {
    "maxPerAct": 1,
    "spawnChance": 0.4,
    "preferredRows": [2, 3, 4],
    "excludedRows": [0]
  }
}
```

### Integration Points
- `constants.js` — Add `COLOSSEUM: 'COLOSSEUM'` to `NODE_TYPES`
- `NodeMapGenerator.js` — Add Colosseum placement logic in node type assignment
- `enemies.json` — No changes needed (challenger generation reads existing pools)
- `recruits.json` — No changes needed (mercenaries pull from existing + next-act pools)
- `difficulty.json` — Add `colosseum` modifier block for Hard/Lunatic scaling
- `Combat.js` — No changes needed (arena uses standard combat resolution)
- New scene: `ColosseumScene.js` — Arena fight selection, mercenary board UI

---

## 6. Open Questions

1. **Should arena fights use the full battle grid or a simplified 1v1 view?** A small 4×4 arena map with both units placed 2 tiles apart would use existing Combat.js + Grid.js with minimal new code. Alternatively, a streamlined "combat forecast resolves instantly" mode would be faster to implement but less engaging.

2. **Weapon durability / uses:** If weapon durability is ever added, arena fights should consume weapon uses. For now (infinite durability), not relevant.

3. **Can you use Vision (rewind) in arena fights?** Probably yes — it's a core tactical tool and arena fights are real combat. But could argue no to keep arena as a pure "deal with the outcome" gamble.

4. **Special Colosseum-only rewards?** Could offer rare accessories or whetstones as Platinum-tier win streaks (win 3 Platinum fights in a row → bonus loot). Adds aspirational goal but increases scope.

5. **Spectator betting?** An additional gold-gambling layer where you can bet on NPC fights happening in the background. Fun flavor but significant implementation cost for marginal gameplay value. Park for later.

6. **Champion fights?** A fixed, named champion per act (like a mini-boss) that appears if you win 3 Gold/Platinum fights. Drops a unique reward. Good for repeat Colosseum visits across runs.
