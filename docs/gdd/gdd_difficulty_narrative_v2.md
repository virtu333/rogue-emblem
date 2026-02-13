# Difficulty, Endgame & Narrative — GDD Section (v2 FINAL)

> **Ported from:** `References/GDDExpansion/` (Feb 13, 2026)
> **Implementation status:** Difficulty foundation (Part A) shipped — Normal/Hard selector, `difficulty.json` contract, deterministic modifier plumbing, Hard unlock gating. Narrative framework and Act 4 content are next priority. Secret Act / Lunatic content deferred.
>
> **Canonical decisions:**
> - **The Emperor** (General class, level 20, bossStatBonus 4, Pavise + Renewal) is the canonical Act 4 boss. See `docs/specs/difficulty_spec.md` §8.5.
> - **Act 4 enemy pool:** Standard promoted classes initially (not zombies/Manaketes required). Zombies/Dragons CAN appear in Hard as an optional extension but need new weapon types (Claws, Dragonstone).
> - **Extended leveling** (+1 random stat per level past promoted L20) enabled on Hard/Lunatic via `extendedLevelingEnabled`.

**Date:** February 11, 2026
**Status:** Design complete — partially implemented (difficulty foundation shipped, Act 4 content in progress)
**Dependencies:** difficulty.json, enemies.json, recruits.json, mapTemplates.json, terrain.json, blessings.json, metaUpgrades.json
**Related docs:** `gdd_biomes_maps.md` (Act 4 biomes, pre-fixed boss maps), `gdd_combat_expansion.md` (status staves, weapon arts), `gdd_units_reclassing.md` (Wyvern enemies, lord selection)

---

## 1. Design Philosophy

Difficulty modes in Emblem Rogue serve two purposes: challenge scaling and **narrative gating**. Each difficulty reveals more of the story, giving players a reason to push beyond their comfort zone. Normal tells the surface story. Hard reveals the true enemy. Lunatic confronts something beyond human understanding.

**Core principles:**

- **Difficulty is a modifier layer.** All changes flow through `difficulty.json` + `DifficultyEngine`. No per-mode branching logic in game systems.
- **Hard = same content plus Act 4.** The 3-act structure is extended with a fourth act. Economy squeeze and stat inflation create pressure alongside new content.
- **Lunatic = Hard + Secret Boss.** A single climactic encounter unlocked by mastery. The true ending.
- **Each difficulty tells more story.** Normal ends at the lieutenant's defeat. Hard confronts the emperor behind the lieutenant. Lunatic faces what they were trying to resurrect.
- **Meta-progression helps but doesn't trivialize.** A fully upgraded roster on Normal should feel comfortable. On Hard, meta helps bridge the gap. On Lunatic, you need meta AND tight play AND some luck.

---

## 2. Narrative Framework

### 2.1 Story Premise

Edric's kingdom was conquered by an imperialist emperor who now rules the land through military force and dark ambition. The emperor and his lieutenant — a gifted seer whose abilities mirror Sera's — are working to revive an eldritch being buried beneath the kingdom's sacred ground. The entity is not evil in any human sense. It simply *is* — an ancient force of nature that predates human civilization, and whose awakening would reshape the world in ways no one can predict or survive.

Sera, a Light Sage whose prophetic gift awakened when the corruption began, sees fragments of possible futures — branching, collapsing, contradictory. Alone she's overwhelmed by the visions. Edric, the deposed lord of the fallen kingdom, grounds her. He makes decisions, acts on what she sees. Together they lead a small warband to reclaim their homeland and stop the ritual before it's completed.

Each run is Sera attempting to see a path through the corruption. Failed runs aren't just bad luck — they're futures the lieutenant has poisoned or blocked. The lieutenant can see the future too, and is actively trying to close off Sera's successful paths. This explains why the game gets harder as you progress — the lieutenant notices you getting closer and fights back.

### 2.2 The Antagonists

**The Lieutenant** — The Act 3 final boss (Normal mode endpoint). A seer like Sera, but in service to the emperor. Their power fractures the timeline, creating the branching paths and random dangers Sera struggles to navigate. They are the direct obstacle — the one actively sabotaging your visions. Defeating them on Normal ends the immediate threat to the kingdom.

**The Emperor** — The Act 4 final boss (Hard mode). The imperialist ruler who conquered Edric's kingdom. The lieutenant serves him. His ambition drives the ritual to resurrect the entity — he believes he can control it and use its power to expand his empire forever. He is human, powerful, and wrong. Defeating him on Hard stops the ritual and frees the kingdom, but the ritual has already partially succeeded. The entity stirs.

**The Entity** — The Secret Act boss (Lunatic mode). An eldritch being in the Dark Souls tradition — vast, ancient, and fundamentally alien. It is not evil. It does not scheme or hate. It simply exists, and its existence is incompatible with the world as humans know it. The lieutenant and emperor's ritual has fed it enough power to begin waking. On Lunatic, after the emperor falls, Sera senses the entity stirring beneath everything and the party must descend to confront it before it fully awakens. The entity does not speak in words — only sounds, distortions, silence. It has no dialogue lines, only ambient presence.

### 2.3 How It Maps to Mechanics

| Mechanic | Narrative Framing |
|----------|-------------------|
| **Run start** | Sera has a vision. The node map is what she can see of the path ahead — branching because her sight is imperfect. |
| **Node map** | "I see two paths... one leads through a dark forest, the other to a ruined keep. I can't see which is safer." |
| **Run failure (Edric dies)** | Sera's vision collapses. She's not rewinding time — she's discarding a future she now knows won't work. |
| **Rewind charges** | Sera's signature ability. She glimpses moments ahead in battle and warns Edric. Limited charges = her power is finite. |
| **Meta-progression** | Sera's visions grow clearer across attempts. Better stats = "I see you more clearly now." New options = "I've seen allies we haven't met." |
| **Blessings** | Before each run, Sera offers guidance — fragments of prophecy that shape the coming journey. |
| **Difficulty escalation** | The lieutenant notices you getting closer and fights back. Harder enemies = the timeline being actively sabotaged. |
| **Biome progression** | The land warps as you approach the ritual site. Grassland → contested territory → sacred ground → corrupted lands. |
| **Normal → Hard loop** | You killed the lieutenant, but the ritual was already too far along. The entity has gained strength. The source of the corruption is now the entity itself, not the lieutenant's magic. You have to go deeper. |

### 2.4 Per-Act Story Beats

Story is delivered through brief text boxes with speaker portraits at key moments. No dialogue trees, no branching, no cutscenes. Just flavor text that contextualizes the journey.

**Act transitions (node map, between acts):**

| Trigger | Speaker | Line |
|---------|---------|------|
| Run start | Sera | "I see a path... fragmented, but there. Stay close, Edric." |
| Act 1 → Act 2 | Sera | "The frontier is behind us. The emperor's forces know we're coming — I can feel the lieutenant watching." |
| Act 2 → Act 3 | Edric | "The sacred ground ahead is corrupted. The ritual is close. And so is the lieutenant." |
| Act 3 → Final Boss (Normal) | Sera | "The lieutenant is near. I can feel their visions pressing against mine. This ends now." |
| Victory (Normal) | Sera | "The lieutenant has fallen. The visions are clearing... but something deeper still stirs. I can feel it." |
| Act 3 → Act 4 (Hard/Lunatic) | Sera | "The lieutenant is gone, but the corruption hasn't stopped. It's stronger. The ritual — the emperor must have completed it before we—" / Edric: "Then we go to him." |
| Act 4 → Final Boss (Hard/Lunatic) | Edric | "The emperor's stronghold. He thinks he can control what he's awakened. He's wrong." |
| Victory (Hard) | Sera | "The emperor is defeated. The ritual is broken... mostly. I still see something beneath it all. Sleeping, but not for long." |
| Final Boss defeated (Lunatic) | Sera | "Wait — the ground is shaking. The ritual fed it too much. It's waking up. We have to go down there. Now." |
| Secret Act start (Lunatic) | Sera | "This place is... wrong. The air doesn't move. Time doesn't pass. It's here." |

**Boss encounter lines (pre-battle):**

| Boss | Line |
|------|------|
| Iron Captain (Act 1) | "You'll go no further. This border belongs to the empire now." |
| Warchief (Act 1) | "Another band of fools. My axe grows thirsty." |
| Knight Commander (Act 2) | "The emperor's will is absolute. Your little rebellion ends here." |
| Archmage (Act 2) | "I've studied the rifts your prophet creates. Fascinating — and so fragile." |
| Blade Lord (Act 3) | "The lieutenant sees all paths. You walk the one that ends in your grave." |
| Iron Wall (Act 3) | "None have breached these walls. None ever will." |
| The Lieutenant (Act 3 Final / Normal endpoint) | "I've seen every future you could reach. In all of them, you fall." |
| The Emperor (Act 4 Final / Hard endpoint) | "You think you've won something by killing my seer? I don't need visions. I have power." |
| The Entity (Secret Boss / Lunatic) | *(No dialogue. Screen distortion. A low, resonant hum that grows louder. The text box shows: "...".)* |

**Boss defeat lines:**

| Boss | Line |
|------|------|
| Iron Captain | "Impossible... the border was supposed to hold..." |
| Warchief | "Hah... you fight well. Better than I expected." |
| Knight Commander | "The emperor will hear of this. You've only delayed the inevitable." |
| Archmage | "The rifts... they're stronger than my models predicted..." |
| Blade Lord | "You shouldn't be here. The lieutenant said this path was sealed." |
| Iron Wall | "The walls... are nothing... without the will behind them..." |
| The Lieutenant | "You... found the one path I couldn't block. But it won't matter. My master's work is already done." |
| The Emperor | "You fools. You have no idea what I was holding back. Without me, there's nothing between you and—" |
| The Entity | *(The hum stops. Silence. Then Sera: "It's... receding. Going back to sleep. We did it. It's over.")* |

### 2.5 Lord Backstories

Displayed in the Home Base lord selection screen. Two sentences each.

| Lord | Backstory |
|------|-----------|
| Edric | A young lord whose kingdom fell to the emperor's conquest. Sera's visions showed him a path to fight back — he took it without hesitation. |
| Sera | A Light Sage whose prophetic gift awakened when the corruption began. She sees all possible futures but needs a champion to act on what she sees. |
| Voss | A ranger from the destroyed borderlands. The emperor's armies took everything from him — his home, his family. What remains is purpose. |
| Kira | A tactician who studied the corruption's patterns in the academy before it fell. She fights with calculation where others fight with fury. |

### 2.6 Sera When Not Deployed

When the player selects Voss or Kira as their second lord instead of Sera:

- Sera is **narratively present** — flavor text, rewind charges, blessings, node map vision all still work
- Sera does **not deploy** to battles — no unit on the map
- Rewind charges and vision are narratively explained as Sera guiding from afar

When Sera IS selected as the second lord and falls in battle, she is simply **unavailable for the rest of the run** — same as any other non-lord unit. Losing your healer is already punishing enough without additional mechanical penalties.

### 2.7 Dialogue Data Model

```json
// data/dialogue.json
{
  "actTransitions": {
    "runStart": { "speaker": "Sera", "portrait": "sera", "line": "I see a path..." },
    "act1_to_act2": { "speaker": "Sera", "portrait": "sera", "line": "The frontier is behind us..." },
    "act2_to_act3": { "speaker": "Edric", "portrait": "edric", "line": "The sacred ground ahead is corrupted..." },
    "act3_to_finalBoss_normal": { "speaker": "Sera", "portrait": "sera", "line": "The lieutenant is near..." },
    "act3_to_act4": [
      { "speaker": "Sera", "portrait": "sera", "line": "The lieutenant is gone, but the corruption hasn't stopped..." },
      { "speaker": "Edric", "portrait": "edric", "line": "Then we go to him." }
    ],
    "act4_to_finalBoss": { "speaker": "Edric", "portrait": "edric", "line": "The emperor's stronghold..." },
    "finalBoss_to_secretAct": { "speaker": "Sera", "portrait": "sera", "line": "Wait — the ground is shaking..." },
    "secretAct_start": { "speaker": "Sera", "portrait": "sera", "line": "This place is... wrong..." }
  },
  "bossEncounters": {
    "The Lieutenant": {
      "preBattle": { "speaker": "The Lieutenant", "portrait": "boss_lieutenant", "line": "I've seen every future you could reach..." },
      "defeat": { "speaker": "The Lieutenant", "portrait": "boss_lieutenant", "line": "You... found the one path I couldn't block..." }
    },
    "The Emperor": {
      "preBattle": { "speaker": "The Emperor", "portrait": "boss_emperor", "line": "You think you've won something by killing my seer?..." },
      "defeat": { "speaker": "The Emperor", "portrait": "boss_emperor", "line": "You fools. You have no idea what I was holding back..." }
    },
    "The Entity": {
      "preBattle": { "speaker": null, "portrait": "boss_entity", "effect": "screen_distortion", "line": "..." },
      "defeat": { "speaker": "Sera", "portrait": "sera", "line": "It's... receding. Going back to sleep. We did it. It's over." }
    }
  },
  "recruitLines": {
    "Fighter":        ["Need an axe? I'm with you.", "Point me at something to hit."],
    "Archer":         ["I don't miss. Point me at a target.", "My arrows are yours."],
    "Mage":           ["My spells aren't gentle, but they're effective.", "I've studied enough. Time to fight."],
    "Cavalier":       ["My lance is yours, Commander.", "I rode from the front lines. Where do you need me?"],
    "Cleric":         ["I can mend what's broken. Stay close.", "The wounded need me. Lead on."],
    "Myrmidon":       ["I fight alone. But I'll fight beside you.", "One blade is enough. Mine."],
    "Thief":          ["I go where I please. Right now, I please to go with you.", "Locks, traps, pockets — I handle them all."],
    "Mercenary":      ["Coin's good. Cause is better. You've got both.", "I've fought for worse reasons."],
    "Pegasus Knight": ["The skies are mine. Let's see what's ahead.", "From above, I've seen what the corruption does."],
    "Knight":         ["I am the shield. You are the sword.", "Nothing gets past me. Nothing."],
    "Dancer":         ["A dance can turn the tide. Watch and see.", "Morale wins wars. I'm here for that."],
    "Wyvern Rider":   ["My wyvern and I answer to no lord. But for this fight — we'll make an exception.", "The skies belong to us."],
    "Hero":           ["I've fought in darker wars than this. What matters is seeing it through.", "Another war. Let's end this one."],
    "Falcon Knight":  ["From above, I've seen what the corruption does. No more.", "Lance and sky. That's all I need."],
    "Sage":           ["The old magic is failing. Perhaps your seer can show us a better path.", "Knowledge is a weapon. I'm well-armed."],
    "Assassin":       ["I don't do speeches. Just tell me who dies.", "Silence is my specialty."],
    "Sniper":         ["One shot. One kill. That's the only math that matters.", "I see the target. That's enough."],
    "Bishop":         ["The light fades, but it hasn't gone. Not yet.", "Healing and faith. I bring both."]
  },
  "runComplete": {
    "victory_normal": { "speaker": "Sera", "portrait": "sera", "line": "The lieutenant has fallen. The visions are clearing... but something deeper still stirs." },
    "victory_hard": { "speaker": "Sera", "portrait": "sera", "line": "The emperor is defeated. The ritual is broken... mostly. I still see something beneath it all." },
    "victory_lunatic": { "speaker": "Sera", "portrait": "sera", "line": "It's going back to sleep. The cycle is broken. For the first time... I can't see what comes next. And that's beautiful." },
    "defeat": { "speaker": "Sera", "portrait": "sera", "line": "No... this path leads to ruin. We must try again." }
  }
}
```

**Implementation:** Simple text box overlay with speaker portrait (128x128, left side), speaker name, and line text. Auto-advances on click/key. No branching, no choices, no animation beyond fade-in/out. For the Entity, no speaker name is displayed — just the portrait (distorted/abstract) and "..." with a screen distortion VFX.

---

## 3. Recruit Naming System

### 3.1 Problem

Current `recruits.json` has fixed name-class pairs (Galvin the Fighter, Ren the Archer). If a player encounters multiple Fighter recruits across a run, they'd get duplicate "Galvin"s. This breaks immersion.

### 3.2 Solution: Name Pools Per Class

Each class has a pool of possible names. When a recruit spawns, a name is drawn from the pool and removed from the available names for that run. Names never repeat within a single run.

```json
// Updated recruits.json structure
{
  "namePool": {
    "Fighter":        ["Galvin", "Bram", "Tormund", "Halvar", "Roderick", "Bjorn"],
    "Archer":         ["Ren", "Ashara", "Wren", "Lysander", "Talia", "Quinn"],
    "Mage":           ["Lira", "Theron", "Elara", "Corvus", "Isolde", "Maren"],
    "Cavalier":       ["Aldric", "Helena", "Marcus", "Rowena", "Cyrus", "Leona"],
    "Cleric":         ["Miriel", "Iona", "Caelen", "Vesper", "Althea", "Brynn"],
    "Myrmidon":       ["Soren", "Kael", "Hana", "Zephyr", "Riven", "Yara"],
    "Thief":          ["Nyx", "Shade", "Wicker", "Dusk", "Sparrow", "Rook"],
    "Mercenary":      ["Gareth", "Dante", "Kestrel", "Brandt", "Sigrid", "Valen"],
    "Pegasus Knight": ["Elysia", "Celeste", "Aerin", "Lunara", "Soleil", "Iris"],
    "Knight":         ["Osric", "Gunther", "Ingrid", "Baldric", "Thane", "Helga"],
    "Dancer":         ["Sylvie", "Aria", "Melodia", "Cadence", "Lyric", "Rhapsody"],
    "Wyvern Rider":   ["Draven", "Ragna", "Scales", "Obsidian", "Cinder", "Talon"],
    "Hero":           ["Dante", "Roland", "Sigurd", "Ajax", "Hector", "Leonidas"],
    "Falcon Knight":  ["Celeste", "Seraphina", "Valkyrie", "Tempest", "Azure", "Gale"],
    "Sage":           ["Vaelan", "Merric", "Arcanis", "Sage", "Grimoire", "Tomes"],
    "Assassin":       ["Shade", "Phantom", "Whisper", "Null", "Echo", "Wraith"],
    "Sniper":         ["Faye", "Hawkeye", "Bullseye", "Keen", "Vera", "Artemis"],
    "Bishop":         ["Io", "Lumina", "Aurel", "Clement", "Solace", "Grace"]
  },
  "act1": {
    "levelRange": [1, 3],
    "classPool": ["Fighter", "Archer", "Mage", "Cavalier", "Cleric", "Myrmidon"]
  },
  "act2": {
    "levelRange": [5, 8],
    "classPool": ["Thief", "Mercenary", "Pegasus Knight", "Mage", "Knight", "Cavalier", "Dancer"]
  },
  "act3": {
    "levelRange": [5, 8],
    "classPool": ["Hero", "Falcon Knight", "Sage", "Assassin", "Sniper", "Bishop"]
  },
  "act4": {
    "levelRange": [12, 16],
    "classPool": ["Hero", "Sage", "Sniper", "Paladin", "Warrior", "Wyvern Lord"]
  }
}
```

### 3.3 Spawn Logic

1. Pick a random class from the act's `classPool`
2. Check `namePool[className]` for names not yet used this run
3. Pick a random available name
4. Track used names in run state (array of strings, persisted in save)
5. If all names for a class are used (extremely unlikely with 6 per class), fall back to "className + number" (e.g., "Fighter II")

### 3.4 Recruit Lines

Lines are keyed by **class**, not by name. When a recruit is picked up, a random line from that class's pool is displayed. Two lines per class provides minimal variety without excessive content.

This means recruits are lightweight — a class, a random name, and a generic class line. Named Special Characters (future feature) will have fixed names, unique portraits, and personal lines, creating a clear distinction between "random soldiers" and "story characters."

---

## 4. Difficulty Structure

### 4.1 Overview

| Mode | Unlock | Acts | Final Boss | Narrative Scope |
|------|--------|------|------------|----------------|
| Normal | Default | Act 1-3 + Final Boss | The Lieutenant | Lieutenant defeated. Kingdom's immediate threat removed. |
| Hard | Beat Normal | Act 1-4 + Final Boss | The Emperor | Emperor defeated. Ritual stopped. But the entity stirs. |
| Lunatic | Beat Hard | Act 1-4 + Final Boss + Secret Act | The Entity | Entity put back to sleep. True ending. |

### 4.2 Difficulty Selection

- Selected at **Home Base before each run** (per-run, not per-slot)
- Locked difficulties show the unlock requirement: "Clear Normal to unlock" / "Clear Hard to unlock"
- Difficulty stored in run state — persists through save/load
- Lunatic visible but grayed out until Hard is beaten (teaser to motivate Hard clears)

### 4.3 Unlock Gating

| Unlock | Condition | Tracking |
|--------|-----------|----------|
| Hard | Defeat the Lieutenant on Normal (any save slot) | `milestones.beatNormal` |
| Lunatic | Defeat the Emperor on Hard (any save slot) | `milestones.beatHard` |
| Voss (lord) | Beat Normal | Same milestone |
| Kira (lord) | Beat Hard | Same milestone |

Milestones are account-level (stored in meta-progression, not per-run). Unlocking Hard on slot 1 makes it available on all slots.

---

## 5. Normal Mode (Baseline)

### 5.1 Structure

3 Acts + Final Boss. The current shipped experience.

| Act | Nodes | Level Range | Biome |
|-----|-------|-------------|-------|
| Act 1 | 5-6 battle + shops/rest/recruit | 1-3 | Grassland (100%) |
| Act 2 | 5-6 battle + shops/rest/recruit | 3-8 | Grassland/Castle/Swamp |
| Act 3 | 5-6 battle + shops/rest/recruit | 8-15 | Grassland/Castle/Temple |
| Final Boss | 1 fixed map | 13-18 (enemies) | Castle (pre-fixed) |

### 5.2 Modifiers

All modifiers are 0 / 1.0 (no adjustments). This is the baseline experience.

### 5.3 Boss Chain (Normal)

| Act | Boss | Class | Level | Role in Story |
|-----|------|-------|-------|---------------|
| Act 1 | Iron Captain / Warchief | Cavalier / Fighter | 3 | Border commanders |
| Act 2 | Knight Commander / Archmage | Paladin / Sage | 12 | Regional officers |
| Act 3 | Blade Lord / Iron Wall | Swordmaster / General | 17 | Elite guards |
| Final Boss | **The Lieutenant** | Hero | 20 | The seer blocking Sera's visions |

The Dark Champion boss entry in `enemies.json` is renamed to "The Lieutenant" with updated dialogue. Class remains Hero, level remains 20.

### 5.4 Narrative

Normal tells the story of Edric and Sera confronting the emperor's lieutenant — the seer who's been fracturing the timeline and blocking their visions. Defeating the Lieutenant removes the immediate magical threat, but Sera's closing line hints that something deeper stirs beneath the sacred ground.

---

## 6. Hard Mode

### 6.1 Structure

4 Acts + Final Boss. Act 4 is the key structural addition.

| Act | Nodes | Level Range | Biome | New vs Normal |
|-----|-------|-------------|-------|---------------|
| Act 1 | 5-6 | 1-3 | Grassland | Same structure, harder numbers |
| Act 2 | 5-6 | 3-8 | Grassland/Castle/Swamp | Same + status countermeasures in shops |
| Act 3 | 5-6 | 8-15 | Grassland/Castle/Temple | Same + status staves on enemies (Act 3+) |
| **Act 4** | **7-8** | **15-20** | **Tundra/Volcano/earlier** | **NEW.** Corrupted terrain. Harder enemies. Extended leveling begins. |
| Final Boss | 1 fixed map | 18-20+ | Castle (pre-fixed) | **The Emperor** replaces The Lieutenant as final boss |

### 6.2 Hard Narrative: Why Four Acts?

On Normal, you defeat the Lieutenant — but their dying words reveal the truth: "My master's work is already done." The ritual to revive the entity was further along than Sera realized. Killing the Lieutenant removed the magical interference, but the corruption's source is now the entity itself, not the Lieutenant's sorcery. To stop it, you need to reach the Emperor and destroy the ritual apparatus.

Act 4 represents pushing into the emperor's heartland — corrupted terrain warped by the entity's growing influence. The Tundra and Volcanic biomes reflect a world being unmade by something that doesn't belong in it.

### 6.3 Act 4 Design

**Node map:** 7-8 nodes on a branching path. Same node type distribution as Act 3 (battle, shop, rest, recruit, boss). One guaranteed shop, one guaranteed rest. Boss node at the end.

**Biome weights:** Tundra 30%, Volcano 30%, earlier biomes (Grassland/Castle/Temple) 40%.

**Enemy pool — act4:**

```json
"act4": {
  "levelRange": [15, 20],
  "base": ["Myrmidon", "Fighter", "Knight", "Archer", "Cavalier", "Mage", "Pegasus Knight", "Wyvern Rider"],
  "promoted": ["Swordmaster", "General", "Warrior", "Paladin", "Sniper", "Sage", "Falcon Knight", "Hero", "Wyvern Lord"],
  "sunderChance": 0.25
}
```

Act 4 enemies are a mix of high-level base classes and promoted classes. The promoted pool is the full roster. Sunder chance is highest of any act.

**Act 4 Boss — The Emperor:**

```json
{
  "className": "General",
  "level": 20,
  "name": "The Emperor",
  "bossStatBonus": 4,
  "skills": ["pavise", "renewal"]
}
```

The Emperor is a General-class boss — an armored conqueror. Enhanced stats (+4 all over class base, compared to the normal +2). Has Pavise (chance to halve physical damage) and Renewal (sustain). The pre-fixed boss map uses a fortress/throne room setting (see `gdd_biomes_maps.md`).

**Narrative beat:** "You think you've won something by killing my seer? I don't need visions. I have power." The Emperor is pragmatic, not magical. He conquered through military might, and the ritual is simply another tool of empire. He doesn't understand what he's awakening — he thinks he can control it.

### 6.4 Extended Leveling

After reaching Level 20 (promoted), units continue gaining XP and leveling up. Each level beyond 20 grants **+1 to a single random stat** (chosen uniformly from HP, STR, MAG, SKL, SPD, DEF, RES, LCK). No cap.

**Design rationale:**
- Growth rates become irrelevant past 20 — every unit improves at the same slow rate
- +1 per level is meaningful but not explosive. A unit at level 25 has +5 random stats over a level 20
- No cap because Lunatic's Secret Act needs units to still be improving, and the random distribution prevents any single stat from running away
- This matches Fire Emblem Radiant Dawn's third-tier philosophy
- XP requirements continue scaling normally (same formula, just higher levels)

**Data model:** No changes needed to level-up logic except removing the level 20 cap when `extendedLevelingEnabled: true` in `difficulty.json`. The growth roll is replaced with a single random stat +1.

### 6.5 Hard Modifiers (Updated difficulty.json)

```json
"hard": {
  "label": "Hard",
  "color": "#ff8800",
  "enemyStatBonus": 1,
  "enemyCountBonus": 1,
  "enemyEquipTierShift": 0,
  "enemySkillChance": 0.2,
  "enemyPoisonChance": 0.08,
  "enemyStatusStaffChance": 0.08,
  "statusStaffActGating": { "act1": 0, "act2": 0, "act3": 1.0, "act4": 1.0, "finalBoss": 1.0 },
  "goldMultiplier": 0.9,
  "shopPriceMultiplier": 1.15,
  "lootQualityShift": 0,
  "deployLimitBonus": 0,
  "xpMultiplier": 0.9,
  "fogChanceBonus": 0.15,
  "reinforcementTurnOffset": 0,
  "currencyMultiplier": 1.25,
  "actsIncluded": ["act1", "act2", "act3", "act4", "finalBoss"],
  "extendedLevelingEnabled": true
}
```

**Changes from current shipped Hard:**
- Added `act4` to `actsIncluded`
- Added `statusStaffActGating` (status staves only in Act 3+)
- Added `extendedLevelingEnabled: true`

**Tuning note:** Playtesters have not yet beaten Act 1 on Normal without significant meta-progression investment, though they're getting close. This is acceptable for a roguelike. Hard should feel meaningfully harder than a meta-invested Normal clear. The 10% gold reduction + 15% price increase compounds to ~25% effective purchasing power reduction over a full run. If Hard proves too punishing, reduce `shopPriceMultiplier` before `enemyStatBonus` — economic pressure is more interesting than stat inflation.

---

## 7. Lunatic Mode

### 7.1 Structure

Same as Hard (Acts 1-4 + Final Boss) PLUS a Secret Act after the Final Boss.

| Act | Nodes | Level Range | Biome | New vs Hard |
|-----|-------|-------------|-------|-------------|
| Acts 1-4 | Same as Hard | Same | Same | Harsher modifiers |
| Final Boss | 1 fixed map | 18-20+ | Castle | Same boss (The Emperor) |
| **Secret Act** | **1 fixed map** | **20+** | **Void (unique)** | **NEW.** The Entity. True ending. |

### 7.2 Secret Act Design

The Secret Act is a single pre-fixed boss map that triggers after the Emperor is defeated on Lunatic. The ritual fed the entity enough power to begin awakening. Sera senses it stirring and the party must descend to confront it.

**Map — The Deep:**

An alien space beneath the world. Not a temple or a dungeon — something that predates human architecture. The terrain is wrong: corrupted blessing tiles (deal 5 damage/turn instead of healing), ice lanes, obsidian cover, and warp tiles. The map tests everything the player has learned across the full run.

- Size: 18x14 (252 tiles, same as post-act maps)
- Objective: Rout (defeat the Entity — no throne to seize, this thing isn't sitting on a chair)
- Enemies: 8-10 promoted enemies from the full pool + the Entity
- No reinforcements (this is the final test, not an endurance fight)
- Deploy limit: 6 (standard for this map size)

**Secret Boss — The Entity:**

```json
{
  "className": "Hero",
  "level": 20,
  "name": "The Entity",
  "bossStatBonus": 6,
  "skills": ["aether", "vantage", "renewal"],
  "personalWeapon": {
    "name": "Void Grasp",
    "type": "Sword",
    "tier": "Legend",
    "might": 16,
    "hit": 90,
    "crit": 10,
    "weight": 7,
    "range": "1-2",
    "special": "Drains HP equal to damage dealt. +5 DEF/RES when equipped."
  }
}
```

The Entity is a Hero-class boss with exceptional stats (+6 all over class base). Three skills: Aether (Sol+Luna combo proc), Vantage (attacks first below 50%), Renewal (heals each turn). Personal weapon Void Grasp is a 1-2 range drain sword with defensive bonuses.

**Design intent:** The Entity should feel like a puzzle boss. Renewal + drain means you can't chip them down slowly. Vantage means you can't safely rush when they're low. Aether means any hit could heal them substantially. Players need burst damage (Brave weapons, Astra, kill arts), anti-sustain (Silence from status staves), or overwhelming action economy (Dancer + multiple attackers per turn).

**Narrative presentation:** The Entity has no dialogue. Its "pre-battle" moment is a screen distortion effect, a low resonant hum, and a text box showing only "..." — it's aware of you, but it doesn't communicate in language. Its defeat is narrated by Sera: "It's... receding. Going back to sleep. We did it. It's over."

The Entity is not destroyed — it's put back to sleep. This is deliberate. It's not evil, it can't be killed, and the victory is about preventing the awakening, not slaying a monster. This leaves narrative space for future content (Endless mode, Lunatic+) where the Entity stirs again.

### 7.3 Lunatic Modifiers (Updated difficulty.json)

```json
"lunatic": {
  "label": "Lunatic",
  "color": "#cc3333",
  "enemyStatBonus": 2,
  "enemyCountBonus": 2,
  "enemyEquipTierShift": 1,
  "enemySkillChance": 0.4,
  "enemyPoisonChance": 0.2,
  "enemyStatusStaffChance": 0.15,
  "statusStaffActGating": { "act1": 0, "act2": 0.5, "act3": 1.0, "act4": 1.0, "finalBoss": 1.0, "secretAct": 1.0 },
  "goldMultiplier": 0.8,
  "shopPriceMultiplier": 1.25,
  "lootQualityShift": 0,
  "deployLimitBonus": 0,
  "xpMultiplier": 0.8,
  "fogChanceBonus": 0.25,
  "reinforcementTurnOffset": -1,
  "currencyMultiplier": 1.5,
  "actsIncluded": ["act1", "act2", "act3", "act4", "finalBoss", "secretAct"],
  "extendedLevelingEnabled": true
}
```

### 7.4 Lunatic Narrative

After the Emperor falls, the ground shakes. The ritual fed the entity too much power — it's waking up regardless of the Emperor's death. The party descends into The Deep, a space that predates human civilization. The Entity is not a villain to be defeated but a force to be quieted.

Victory on Lunatic triggers a unique ending screen with Sera's final line. The player unlocks a permanent "True Ending" flag visible on their save slot. Meta-currency reward for Lunatic clear is the highest (1.5x multiplier).

---

## 8. Boss Definitions — Full Updated enemies.json Changes

### 8.1 Normal Boss Chain

```json
"bosses": {
  "act1": [
    { "className": "Cavalier", "level": 3, "name": "Iron Captain" },
    { "className": "Fighter", "level": 3, "name": "Warchief" }
  ],
  "act2": [
    { "className": "Paladin", "level": 12, "name": "Knight Commander" },
    { "className": "Sage", "level": 12, "name": "Archmage" }
  ],
  "act3": [
    { "className": "Swordmaster", "level": 17, "name": "Blade Lord" },
    { "className": "General", "level": 17, "name": "Iron Wall" }
  ],
  "finalBoss": [
    { "className": "Hero", "level": 20, "name": "The Lieutenant" }
  ]
}
```

### 8.2 Hard/Lunatic Boss Additions

```json
"act4": [
  { "className": "General", "level": 20, "name": "The Emperor", "bossStatBonus": 4, "skills": ["pavise", "renewal"] }
],
"secretAct": [
  { "className": "Hero", "level": 20, "name": "The Entity", "bossStatBonus": 6, "skills": ["aether", "vantage", "renewal"],
    "personalWeapon": {
      "name": "Void Grasp", "type": "Sword", "tier": "Legend", "might": 16, "hit": 90, "crit": 10, "weight": 7,
      "range": "1-2", "special": "Drains HP equal to damage dealt. +5 DEF/RES when equipped."
    }
  }
]
```

### 8.3 Enemy Pool Additions

```json
"act4": {
  "levelRange": [15, 20],
  "base": ["Myrmidon", "Fighter", "Knight", "Archer", "Cavalier", "Mage", "Pegasus Knight", "Wyvern Rider"],
  "promoted": ["Swordmaster", "General", "Warrior", "Paladin", "Sniper", "Sage", "Falcon Knight", "Hero", "Wyvern Lord"],
  "sunderChance": 0.25
},
"secretAct": {
  "levelRange": [18, 20],
  "base": [],
  "promoted": ["Swordmaster", "General", "Warrior", "Paladin", "Sniper", "Sage", "Falcon Knight", "Hero", "Wyvern Lord"],
  "sunderChance": 0.20
}
```

---

## 9. Node Map Changes for Act 4

### 9.1 ACT_CONFIG Addition

```json
"act4": {
  "nodes": { "min": 7, "max": 8 },
  "battleNodes": { "min": 4, "max": 5 },
  "shopNodes": { "min": 1, "max": 1 },
  "restNodes": { "min": 1, "max": 1 },
  "recruitNodes": { "min": 0, "max": 1 },
  "bossNode": true,
  "mapSizes": ["18x12", "18x14"],
  "deployLimit": [5, 6],
  "biomeWeights": { "tundra": 30, "volcano": 30, "grassland": 15, "castle": 15, "temple": 10 }
}
```

### 9.2 Level Scaling

| Act 4 Row | Level Range |
|-----------|-------------|
| Row 0 | [15, 16] |
| Row 1 | [16, 18] |
| Row 2+ | [18, 20] |
| Boss | 20 |

### 9.3 Secret Act Node

The Secret Act is not a full node map — it's a single fixed boss encounter that triggers after the Emperor is defeated on Lunatic difficulty. No shop, no rest, no recruit. Party state carries over directly from the Act 4 boss. This is deliberate — resource management across both the Emperor AND the Entity is part of the challenge.

---

## 10. difficulty.json — Full Updated Contract

```json
{
  "version": 2,
  "modes": {
    "normal": {
      "label": "Normal",
      "color": "#44cc44",
      "enemyStatBonus": 0,
      "enemyCountBonus": 0,
      "enemyEquipTierShift": 0,
      "enemySkillChance": 0,
      "enemyPoisonChance": 0,
      "enemyStatusStaffChance": 0,
      "statusStaffActGating": {},
      "goldMultiplier": 1,
      "shopPriceMultiplier": 1,
      "lootQualityShift": 0,
      "deployLimitBonus": 0,
      "xpMultiplier": 1,
      "fogChanceBonus": 0,
      "reinforcementTurnOffset": 0,
      "currencyMultiplier": 1,
      "actsIncluded": ["act1", "act2", "act3", "finalBoss"],
      "extendedLevelingEnabled": false
    },
    "hard": {
      "label": "Hard",
      "color": "#ff8800",
      "enemyStatBonus": 1,
      "enemyCountBonus": 1,
      "enemyEquipTierShift": 0,
      "enemySkillChance": 0.2,
      "enemyPoisonChance": 0.08,
      "enemyStatusStaffChance": 0.08,
      "statusStaffActGating": { "act1": 0, "act2": 0, "act3": 1.0, "act4": 1.0, "finalBoss": 1.0 },
      "goldMultiplier": 0.9,
      "shopPriceMultiplier": 1.15,
      "lootQualityShift": 0,
      "deployLimitBonus": 0,
      "xpMultiplier": 0.9,
      "fogChanceBonus": 0.15,
      "reinforcementTurnOffset": 0,
      "currencyMultiplier": 1.25,
      "actsIncluded": ["act1", "act2", "act3", "act4", "finalBoss"],
      "extendedLevelingEnabled": true
    },
    "lunatic": {
      "label": "Lunatic",
      "color": "#cc3333",
      "enemyStatBonus": 2,
      "enemyCountBonus": 2,
      "enemyEquipTierShift": 1,
      "enemySkillChance": 0.4,
      "enemyPoisonChance": 0.2,
      "enemyStatusStaffChance": 0.15,
      "statusStaffActGating": { "act1": 0, "act2": 0.5, "act3": 1.0, "act4": 1.0, "finalBoss": 1.0, "secretAct": 1.0 },
      "goldMultiplier": 0.8,
      "shopPriceMultiplier": 1.25,
      "lootQualityShift": 0,
      "deployLimitBonus": 0,
      "xpMultiplier": 0.8,
      "fogChanceBonus": 0.25,
      "reinforcementTurnOffset": -1,
      "currencyMultiplier": 1.5,
      "actsIncluded": ["act1", "act2", "act3", "act4", "finalBoss", "secretAct"],
      "extendedLevelingEnabled": true
    }
  }
}
```

## 10.5 Enemy Affixes

### Overview

Enemy affixes are data-driven modifiers applied to non-boss enemies at spawn time, gated by difficulty mode and act progression. They make Hard and Lunatic encounters feel qualitatively different — not just numerically harder. Affixes create tactical puzzles that reward adaptation over brute-force stat investment.

**Narrative framing:** The lieutenant's corruption warps the timeline. In harder difficulties, this corruption manifests physically — enemies carry unnatural abilities that shouldn't exist. Thorns, teleportation, corrosive weapons — these are symptoms of a world coming undone.

### Data Contract

Full data lives in `data/affixes.json` (version 1). Key structure:

- **12 affixes** across 2 tiers. Tier 1 = common, straightforward. Tier 2 = disruptive, requires tactical adaptation.
- **Difficulty gating:** Normal = no affixes. Hard = 12% chance per enemy, max 1, Tier 1 only. Lunatic = 30% chance, max 2, Tier 1+2.
- **Act scaling:** Affix chance is multiplied by per-act factors (Act 1 = 0.5×, Act 2 = 0.75×, Act 3+ = 1.0×) so early encounters stay approachable.
- **Exclusion rules:** Mutually exclusive pairs (Regenerator/Deathburst, Teleporter/Anchored), class exclusions (no Haste on cavalry, no Teleporter on armored).
- **Boss exemption:** Bosses have hand-crafted skill loadouts. Affixes apply to regular/elite enemies only.

### Affix Roster

| ID | Name | Tier | Trigger | Effect | Tactical Impact |
|----|------|------|---------|--------|-----------------|
| thorns | Thorns | 1 | on-defend | Reflect 25% melee damage | Punishes juggernaut melee. Use ranged or magic. |
| regenerator | Regenerator | 1 | on-turn-start | Heal 20% max HP | Must focus fire. Can't chip and retreat. |
| venomous | Venomous | 1 | on-attack | 5 poison damage after combat | Increases attrition pressure. Prioritize killing or healing. |
| rally | Rally | 1 | passive-aura | +3 ATK to enemies within 2 tiles | Kill the rally unit first or isolate targets. |
| berserker | Berserker | 1 | passive | +5 ATK / -3 DEF, targets weakest | Protect fragile units. Glass cannon enemy — hit hard. |
| haste | Haste | 1 | passive | +2 MOV | Extends threat range. Changes positioning math. |
| anchored | Anchored | 1 | passive | Immune to Shove/Pull, +2 DEF on Fort/Throne | Can't displace from defensive terrain. Go around or burst. |
| waller | Waller | 2 | on-turn-start | Spawn temporary Wall (2 turns) | Changes map topology. Can block your paths OR create new cover. |
| teleporter | Teleporter | 2 | on-defend | Warp within 3 after taking damage | Can't pin down. Forces burst kills or area control. |
| shielded | Shielded | 2 | on-defend | First hit each player phase deals 0 | Requires two attackers minimum. Punishes single-unit focus. |
| deathburst | Deathburst | 2 | on-death | 5 AoE damage within 1 tile | Don't cluster when finishing. Ranged kills are safer. |
| corrosive | Corrosive | 2 | on-attack | -2 DEF per hit (stacks, battle-long) | Tanks degrade over time. Rotate frontline or kill fast. |

### Spawn Logic

1. At enemy unit creation, check difficulty gating → if `affixChance` is 0, skip
2. Roll `affixChance × actScaling[currentAct].chanceMultiplier` per enemy
3. If roll succeeds, pick random affix from eligible `tierPool`
4. Check exclusion rules against any already-assigned affixes and unit class
5. If `maxAffixesPerUnit > 1`, roll again for a second affix (Lunatic only)
6. Store affixes as `unit.affixes = [{ id, ... }]` on the unit object
7. Affixes persist for the battle (not cross-battle)

### Visual Indicators

- Affixed enemies display a colored pip above their map sprite: Tier 1 = yellow, Tier 2 = red
- Two affixes show two pips
- Unit Inspection Panel gains an "Affixes" row below Skills showing affix name(s) + description(s)
- On hover/tap, affix tooltip shows the `narrativeHint` flavor text

### Integration Points

| System | Change |
|--------|--------|
| `UnitManager.js` | Add `unit.affixes` array at enemy creation time. Roll logic using `affixes.json` config. |
| `Combat.js` | Check attacker/defender affixes at existing hook points (same as skill checks). Handle: thorns reflect, venomous poison, corrosive debuff, shielded negate, berserker stat mod. |
| `SkillSystem.js` | Affix evaluation can share the same trigger infrastructure as skills. New `evaluateAffixes(trigger, ctx)` function parallel to `evaluateSkills`. |
| `TurnManager.js` | On enemy phase start: regenerator heal, waller terrain spawn. On unit death: deathburst AoE. |
| `AIController.js` | Berserker `aiOverride: "target_lowest_hp"` changes target selection. Other affixes don't change AI. |
| `Grid.js` | Waller spawns temporary Wall tiles (need duration tracking + removal). |
| `MapGenerator.js` | No changes — affixes are applied post-generation at unit creation time. |
| `DifficultyEngine.js` | Read `affixes.json` config section, expose `getAffixConfig(difficulty)` for spawn logic. |
| UI (Inspection Panel) | Add affix display row. Colored pip rendering on map sprites. |

### Testing Strategy

- Unit tests: affix roll logic, exclusion rules, class filtering, tier gating
- Combat tests: each affix effect in isolation (thorns damage calc, regen amount, poison application, shielded negate, corrosive stacking)
- Integration: affixed enemy in simulated combat round, verify affix + skill interaction doesn't double-fire
- Regression: non-affixed enemies on Normal behave identically to current baseline

---

### Phase 1: Extended Leveling
1. Remove level 20 promoted cap when `extendedLevelingEnabled` is true
2. Replace growth-rate level-up with +1 random stat per level for levels beyond 20
3. XP formula continues scaling normally
4. Tests: level 21+ stat gains, random distribution, XP requirements, disabled when flag is false

### Phase 2: Boss Rename + Dialogue Foundation
5. Rename Dark Champion → The Lieutenant in `enemies.json`
6. Create `data/dialogue.json` with all text (act transitions, boss lines, recruit lines by class, run complete)
7. Build simple dialogue text box UI (portrait + name + line, click/key to advance)
8. Hook dialogue display into: act transitions, boss battle start, recruit event, run complete
9. Tests: dialogue loading, display triggers, portrait mapping

### Phase 3: Recruit Naming System
10. Restructure `recruits.json` to class pools + name pools
11. Implement name draw logic: pick class from act pool, draw unused name from class name pool
12. Track used names in run state (persisted in save)
13. Recruit lines keyed by class, randomly selected from array of 2 options
14. Tests: name uniqueness within run, fallback naming, line selection

### Phase 4: Act 4 Structure
15. Add `act4` to `ACT_CONFIG` in constants.js (7-8 nodes, map sizes, deploy limits)
16. Add `act4` enemy pool to `enemies.json`
17. Add Emperor boss definition
18. Node map generation: Act 4 appears after Act 3 when `actsIncluded` contains `act4`
19. Act 4 level scaling in `NodeMapGenerator.js`
20. Tests: act4 node generation, enemy pool, boss spawning, level ranges, act progression

### Phase 5: Secret Act
21. Secret Act trigger: after Emperor victory on Lunatic, transition to secret boss map
22. Entity boss definition with personal weapon and skill loadout, no dialogue (screen distortion + "...")
23. Secret Act pre-fixed map (The Deep) in `fixedMaps.json`
24. Secret Act victory → unique ending screen + true ending milestone
25. Tests: trigger condition (Lunatic only), party state carryover, boss skills, victory handling

### Phase 6: Difficulty Contract Update
26. Update `difficulty.json` to version 2 with all new fields
27. Wire `statusStaffActGating` through DifficultyEngine
28. Wire `reinforcementTurnOffset` through defend map wave timing
29. Wire `extendedLevelingEnabled` through level-up logic
30. Wire `actsIncluded` through act progression
31. Tests: all modifier paths, act gating, status staff gating

### Phase 7: Enemy Affixes
32. Create `data/affixes.json` with 12 affixes, config, and exclusion rules
33. Add affix roll logic to enemy creation in `UnitManager.js`
34. Wire affix effects through `Combat.js` (thorns, venomous, corrosive, shielded, berserker)
35. Wire affix effects through `TurnManager.js` (regenerator, waller, deathburst)
36. Wire affix auras through `SkillSystem.js` (rally)
37. Wire remaining passives (haste MOV, anchored displacement immunity, teleporter warp)
38. Add affix display to Unit Inspection Panel + colored pip indicators on map sprites
39. Wire `DifficultyEngine` to read affix config and gate by difficulty/act
40. Tests: roll logic, exclusions, each affix effect, affix+skill interaction, Normal-mode no-affix regression

### Phase 8: Polish
41. Lord backstory text in Home Base lord selection screen
42. Difficulty selection UI: show act count and narrative teaser per difficulty
43. Run complete screen: different text/music for Normal/Hard/Lunatic victories
44. True Ending flag display on save slot
45. Balance pass: Act 4 enemy tuning, Emperor difficulty, Entity difficulty, affix chance tuning

---

## 12. Data File Changes Summary

| File | Changes |
|------|---------|
| `affixes.json` (new) | 12 enemy affixes in 2 tiers, difficulty gating config, act scaling, exclusion rules, visual indicator spec |
| `difficulty.json` | Version 2: statusStaffActGating, extendedLevelingEnabled, act4/secretAct in actsIncluded |
| `enemies.json` | Rename Dark Champion → The Lieutenant; add act4 pool, Emperor boss, Entity boss with personal weapon; add secretAct pool |
| `recruits.json` | Restructure: class pools per act + name pools per class (6 names each). Remove fixed name-class pairs. Add act4 recruit pool. |
| `constants.js` | Add act4 to ACT_CONFIG |
| `dialogue.json` (new) | All narrative text: act transitions, boss encounters, recruit lines by class, run complete, lord backstories |
| `fixedMaps.json` | Add The Deep (secret boss map) |
| `metaUpgrades.json` | No changes |
| `blessings.json` | No changes |

---

## 13. Open Items & Future Vision

### Deferred

- **Zombies / Dragons** — New enemy classes for Act 4+. Add alongside expanded content.
- **Endless mode** — After Lunatic, infinitely scaling acts. The Entity stirs again as framing.
- **Lunatic+** — Enemies get random additional skills (FE Awakening style). Affix system provides foundation; Lunatic+ could increase `maxAffixesPerUnit` to 3 and unlock a Tier 3 pool.
- **AI intelligence flags** — Enemy behavior scaling by difficulty. Current AI works; revisit if needed.
- **Per-difficulty loot tables** — Economy multipliers handle pressure for now.
- **Special Characters** — Named units with fixed stats, unique portraits, personal recruitment scenes. Distinct from random recruits.

### Design Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Boss chain | Lieutenant (Act 3) → Emperor (Act 4) → Entity (Secret) | Escalating human → political → cosmic threat. Classic. |
| Emperor class | General | Armored conqueror. Pragmatic military power, not magic. |
| Entity class | Hero | Versatile, sword-wielding. Alien entity taking humanoid combat form. |
| Entity dialogue | None — screen distortion + "..." | Eldritch beings don't monologue. Dark Souls tradition. |
| Entity is not destroyed | Put back to sleep | Not evil, can't be killed. Leaves space for future content. |
| Recruit naming | Random from per-class pool, no repeats per run | Solves duplicate problem. 6 names per class = virtually no collisions. |
| Recruit lines | Per-class, 2 variations each | Lightweight, no name-specific content for random soldiers. |
| Sera death | Standard unit loss, no extra penalties | Losing the healer is punishment enough. Keep it simple. |
| Hard structure | 4 acts | New content (not just harder numbers) rewards mastery |
| Lunatic secret | Single boss map, not multi-node act | Achievable scope. Climactic. Party carries from Emperor fight. |
| Extended leveling | +1 random stat/level, no cap | Simple, fair, prevents explosion |
| Affix gating | Hard T1 only, Lunatic T1+T2 | Hard introduces the concept gently; Lunatic makes it a core mechanic |
| Affix cap | Max 1 (Hard) / Max 2 (Lunatic) | Two affixes create combos; three would be unreadable |
| Boss affix exemption | Bosses skip affixes | Bosses have hand-crafted skills. Affixes are for rank-and-file variety |
| Affix act scaling | 0.5× Act 1, 0.75× Act 2, 1.0× Act 3+ | Early acts stay approachable even on Lunatic |
| Affix trigger reuse | Same hook points as skills | No new combat resolution phases needed. Minimal architecture cost |
