# Emblem Rogue — GDD Overview

> **Ported from:** `References/GDDExpansion/` (Feb 13, 2026)
> **Implementation status:** Index document. Individual doc statuses below. All detail docs now live in `docs/gdd/`.

**Last Updated:** February 13, 2026
**Project Status:** Shipped alpha, approaching early beta. 1118 tests, deployed on Netlify with Supabase auth + cloud saves.

---

## Purpose

This document is the master index for Emblem Rogue's Game Design Document. The full GDD is split across focused design documents, each covering a specific system or feature area. This overview provides context, links to detail files, and tracks design status.

For implementation details, architecture, and data file references, see **CLAUDE.md**.
For roadmap priorities and sequencing, see **ROADMAP.md**.

---

## Game Summary

Emblem Rogue is a browser-based tactical RPG combining Fire Emblem's grid-based combat with Slay the Spire's roguelike progression structure. Players lead a party through procedurally generated battles across a branching node map, managing resources, recruiting units, and building toward a final confrontation.

**Core pillars:**
- **Tactical combat depth** — Weapon triangle, terrain, positioning, skills, class promotion
- **Roguelike tension** — Permadeath, randomized encounters, meaningful loot choices, gold scarcity
- **Meta-progression** — Persistent upgrades across runs that expand options without trivializing difficulty
- **SNES-inspired aesthetics** — Pixel art, chiptune audio, Fire Emblem GBA-era feel

---

## Design Document Index

### Shipped / Implemented Systems

These systems are live in the current build. The original GDD (`docs/emblem_rogue_gdd.docx`) covers most of these but is outdated in places. Canonical data lives in `data/*.json` files and `CLAUDE.md`.

| System | Status | Reference |
|--------|--------|-----------|
| Grid engine, movement, pathfinding | Shipped | CLAUDE.md §Grid.js |
| Combat system (damage, weapon triangle, hit/crit, doubles) | Shipped | CLAUDE.md §Combat.js |
| Unit system (stats, leveling, growth rates, promotion) | Shipped | CLAUDE.md §UnitManager.js |
| 29 classes (15 base + 14 promoted, including lord classes) | Shipped | `data/classes.json` |
| 52 weapons (8 types, throwables, effectiveness, specials) | Shipped | `data/weapons.json` |
| 34 skills (6 trigger types, on-defend, action skills, L20 lord skills) | Shipped | `data/skills.json` |
| 18 accessories (stat + combat effect types) | Shipped | `data/accessories.json` |
| Forging system (whetstones, stat bonuses) | Shipped | `data/whetstones.json` |
| 10 consumables (healing, promotion, stat boosters) | Shipped | `data/consumables.json` |
| Map generation (6 templates, 2 objectives) | Shipped | `data/mapTemplates.json` |
| Node map (branching, per-act, battle/rest/shop/boss nodes) | Shipped | CLAUDE.md §NodeMapGenerator.js |
| Gold economy (kill gold, turn bonus, shops, loot, church) | Shipped | CLAUDE.md §LootSystem.js, `data/turnBonus.json` |
| Meta-progression (41 upgrades, 6 categories, dual currency) | Shipped | `data/metaUpgrades.json` |
| Blessings system (11 blessings, 4 tiers, boon/cost structure) | Shipped | `data/blessings.json` |
| Difficulty modes (Normal/Hard selector, Lunatic visible) | Shipped | `data/difficulty.json` |
| Fog of war | Shipped | CLAUDE.md §Grid.js |
| Battle actions (Trade, Swap, Dance, Shove, Pull, Canto) | Shipped | CLAUDE.md §skills.json |
| Boss recruit event | Shipped | CLAUDE.md |
| Cloud saves + Supabase auth (3 save slots) | Shipped | CLAUDE.md §cloud/ |
| Tutorial hints | Shipped | CLAUDE.md §HintManager |

### Partially Shipped (Design Complete, Implementation In Progress)

| System | Design Doc | Status |
|--------|-----------|--------|
| **Weapon Arts** | `docs/gdd/gdd_combat_expansion.md` | Phases 1-2 shipped (39 of 67 arts). Stat-scaling, magic catalog, tactical-depth arts on `main`. Remaining: legendary signature arts, polish pass. |
| **Convoy** | `docs/gdd/gdd_economy_convoy.md` | MVP shipped (5+5 split slots, unlimited accessories). Economy tuning ongoing. |
| **Wyvern Rider/Lord** | `docs/gdd/gdd_units_reclassing.md` | Classes shipped. Stun + Intimidate skills. Enemy/recruit pool integration done. |
| **Difficulty Foundation** | `docs/gdd/gdd_difficulty_narrative_v2.md` | Normal/Hard selector shipped. Act 4 content next. Lunatic/Secret Act deferred. |
| **Enemy Affixes** | `data/affixes.json` | 12 affixes shipped with difficulty-gated spawn. Inspection UI done. |

### Design-Complete (Not Yet Implemented)

| System | Design Doc | Summary |
|--------|-----------|---------|
| **Status Staves & Conditions** | `docs/gdd/gdd_combat_expansion.md` | 4 status conditions (Sleep, Berserk, Silence, Root). Enemy-only. MAG vs RES hit formula. Countermeasure items. Deferred until after Act 4. |
| **Biomes & Map Expansion** | `docs/gdd/gdd_biomes_maps.md` | 6 biomes, 8 terrain types, ~14 templates, 2 objectives (Defend, Escape), 5 boss maps. Act 4 scope (Tundra + Volcano) is next. See overrides in doc header. |
| **Second Seal / Reclass** | `docs/gdd/gdd_units_reclassing.md` | Reclassing system, Sickle & Hammer, Lord Selection. All deferred until after Act 4. |
| **Act 4 Content** | `docs/gdd/gdd_difficulty_narrative_v2.md` + `docs/act4-hardmode-rollout-plan.md` | The Emperor boss (General class), Tundra/Volcano biomes, reinforcement system. Phase-gated rollout in progress. |

### Design-In-Progress (Future Sessions)

| System | Planned Doc | Key Questions |
|--------|------------|---------------|
| **Narrative & Story** | `docs/gdd/gdd_difficulty_narrative_v2.md` | Sera/Edric framework exists. Needs: dialogue system design, per-act story beats, lord backstories, recruitment dialogue. |
| **Lunatic + Secret Act** | `docs/gdd/gdd_difficulty_narrative_v2.md` | Chronophage boss, void terrain, true ending. Deferred until Act 4 + reinforcements stable. |
| **Economy Expansion** | `docs/gdd/gdd_economy_convoy.md` | Relic catalog, legendary accessories, convoy capacity tuning, item fate on death. |

### Deferred (Future Vision)

Noted in design documents as long-term considerations. No active design work planned.

- Random Event Nodes
- Divine Seals (advanced reclassing)
- Campaign system (multiple campaign configs)
- Full battle animations (side-view combat, 64x64/96x96 sprites)
- Endless mode / Lunatic+
- Weather/time-of-day effects
- Monetization design (cosmetic only)
- Weapon blessings - additional, unique stat upgrades for weapons with a theme (e.g., increase hit/crit; increase weight/might/crit; reduce weight / increase hit; etc.)
- "Enemy affixes" for lunatic mode — **DECIDED, moved to Design-Complete.** See `data/affixes.json`. 12 affixes, difficulty-gated, ships with Lunatic rollout in Difficulty Follow-up (Part B+).

---

## Cross-Cutting Design Principles

These apply across all systems and should be referenced when making design decisions:

1. **Data-driven.** All content in JSON. Never hardcode stats, classes, weapons, or balance values.
2. **Difficulty is a modifier layer.** New systems wire through `difficulty.json` + `DifficultyEngine`. No per-mode branching logic.
3. **Roguelike identity.** Every decision should have weight. Resources are scarce. Permadeath matters. Runs feel unique.
4. **Classic FE feel.** Player Phase / Enemy Phase. Weapon triangle. Terrain matters. Growth rates create unique units.
5. **Separate logic from rendering.** Combat math, economy, and level-ups are pure functions. Enables sims, headless testing, and future engine migration.
6. **Mobile-safe architecture.** No fixed-canvas assumptions. Touch-capable equivalents for all inputs. Mobile release deferred but architecture is not.
7. **Meta-progression expands options, not power.** Upgrades should open new strategies, not trivialize combat difficulty.

---

## Known GDD Gaps (Reconciliation Needed)

The original GDD (`docs/emblem_rogue_gdd.docx`) is outdated in several areas. These sections need updating to match the current implementation before or alongside new design work:

- **§2.2 Campaign Structure** — Map sizes, deploy limits incorrect
- **§5 Classes** — Now 29 classes; lord classes, learnable skills missing
- **§6 Skills** — Now 34 skills; action triggers, on-defend, L20 lord skills missing
- **§7 Equipment** — Missing forge, whetstones, weapon specials, scrolls, stat boosters, combat accessories
- **§8.4 Gold Economy** — Missing turn bonus, church services, kill gold
- **§9 Meta-Progression** — Now 41 upgrades, dual currency, prerequisites, milestones
- **§11 Enemy & Boss** — Missing sunder weapons, enemy skills, per-act scaling
- **§14 Build Order** — All 10 phases complete

Sections entirely missing from original GDD (exist in game, not documented):
- Blessings, Difficulty modes, Cloud saves, Save slots, Fog of war, Danger zone, Battle actions, Boss recruit event, Tutorial hints

---

## Document Conventions

- **DECIDED** = Final design decision, ready for implementation
- **TODO** = Needs design work before implementation
- **DEFERRED** = Acknowledged but not planned for near-term
- **Data references** use `data/filename.json` paths (source of truth, synced to `public/data/` at build)
- **Implementation phases** are sequenced within each design doc, not globally — cross-doc dependencies are noted
