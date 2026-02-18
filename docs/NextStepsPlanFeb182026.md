# Next Steps Plan — Feb 18, 2026

## Context

All phases 1-9 complete, Act 4 shipped, 2226 tests across 136 files. Sprint slot open. This plan captures the agreed sequencing for the next 3+ months of work, based on roadmap review and prioritization discussion.

## Execution Sequence

### Sprint 1: P0 Repo Hardening (2 days)

**Goal:** Establish formatting/lint/schema gates before content branches.

**Why first:** The lint pass creates a large formatting diff. Landing it before content work prevents every future PR from fighting merge conflicts against a mid-stream formatting change. Schema validation catches malformed JSON before runtime — insurance that pays for itself during content sprints with parallel agents.

**Scope** (from `docs/reports/repo-hardening-next-steps-2026-02-17.md`):
1. **Prettier + ESLint policy**
   - Add `.prettierrc`, `.prettierignore`, `eslint.config.js`
   - Add npm scripts: `format`, `format:check`, `lint`, `lint:fix`
   - Add pre-commit hook (staged-file enforcement)
   - Add CI steps in `.github/workflows/ci.yml`
   - One-time baseline formatting PR, then enforce going forward
2. **JSON schema validation**
   - AJV + JSON Schema for highest-risk data files: `classes.json`, `weapons.json`, `skills.json`, `enemies.json`, `mapTemplates.json`
   - `npm run validate:data` script + CI gate
   - Known-bad fixture test to prove failure behavior

**Not in scope for Sprint 1:** BattleScene decomposition, CI artifacts, nightly workflow, CONTRIBUTING.md, licensing. These are P1/P2 and slot in later.

**Validation:** `npm run test:unit` + `npm run test:harness:pr` + `npm run sim:fullrun:pr` all green before merging.

---

### Sprint 2: Promotion Branching

**Goal:** Each base class gets 2 promotion paths. Foundational change that all subsequent features build on.

**Why before Colosseum:** Promotion branching touches `classes.json`, the promotion UI, and the class system. Colosseum's enemy generation, expanded skills, and status staves all build on the class tree. Doing branching first means downstream features get it for free instead of being retrofitted.

**Design direction:**
- One path = stat/combat specialization (existing promotion style)
- Other path = secondary weapon type or unique mechanic
- Example: Myrmidon → Swordmaster (crit monster, existing) OR Duelist (lower crit, gains 1-2 range counter + avoid on initiate)
- Key design risk: both options must feel genuinely competitive, not have an obvious "correct" choice
- Lean toward offense-focused vs. utility-focused split per Three Houses model

**Scope:**
- `classes.json` schema changes: each base class gets `promotesTo: [classA, classB]` instead of single target
- New promotion classes in `classes.json` (16 base classes × 2 paths = 32 promoted, up from current 19)
- Promotion UI rework: player chooses between two paths (preview stat bonuses, weapon unlocks, innate skill)
- `UnitManager.js` promotion logic update
- Enemy generation: enemies can use either promotion path
- Balance pass: stat bonuses, weapon unlocks, innate skills per branch
- Tests: promotion choice persistence, save/load, enemy generation, class data integrity

**Spec needed:** Full promotion branching spec should be written before implementation, covering all 16 base class branch designs.

**Validation:** Full test suite + manual playtest of promotion flow.

---

### Sprint 3: Colosseum Node

**Goal:** New COLOSSEUM node type with forecast-only 1v1 arena and single mercenary recruit.

**Why this drives BattleScene decomposition:** Building the arena requires extracting combat forecast/resolution from BattleScene into reusable modules. This is the P1.4 decomposition happening organically — let the feature drive which modules get extracted.

**Design:**
- **Arena:** Forecast-only 1v1 combat (no grid, no vision). Standard Combat.js resolution. 4 difficulty tiers (Bronze/Silver/Gold/Platinum, act-gated). Entry fee + gold reward. HP carries between bouts. 3-fight limit per unit. XP diminishing returns after 2 levels gained. Units reduced to 1 HP on loss (never killed). No vulnerary use until exiting arena.
- **Mercenary recruit:** Single promoted unit with fixed (non-random) stats. Known quantity — you're paying a premium for guaranteed quality. Much more expensive than regular recruits. Differentiates from RECRUIT nodes (random base class, random growths, free).
- **Economy analysis required** before finalizing gold figures (existing spec uses old economy numbers).

**Existing spec:** `docs/colosseum_spec.md` — needs updates for forecast-only, single fixed-stat recruit, pricing rebalance.

**BattleScene extractions likely needed:**
- Combat forecast display (reuse in arena preview)
- Combat resolution pipeline (run Combat.js without grid/turn system)
- XP/gold award flow (reuse for arena rewards)

**Validation:** Full test suite + economy sim analysis + manual playtest.

---

### Sprint 4: Expanded Skills + Status Staves (Combined)

**Goal:** Ship counterplay and the problem together so Hard/Lunatic feel challenging but fair.

**Skills side:**
- Command skills, on-kill triggers, cleanse effects
- Positioning-based skills
- New scroll items for skill teaching

**Staves side:**
- Sleep/Berserk/Plant staves (enemy Act 2+)
- Herbs/Pure Water/Remedy counter items in shops
- See `docs/specs/difficulty_spec.md` section 10

**Why combined:** Staves without answers = punishing. Skills without staves = some skills lack purpose.

**Validation:** Full test suite + difficulty balance playtest on Hard.

---

### Flex Slots: Dynamic Recruit Nodes + Difficulty Follow-up

These slot in at natural pauses between the main sprints above.

- **Dynamic Recruit Nodes:** Roster-aware recruit frequency. Smaller scope, can be a 2-3 day effort between sprints.
- **Difficulty Follow-up (Part B+):** Balance iteration, Lunatic rollout timing, tuning hooks. Ongoing work that benefits from playtest data gathered during the content sprints.

---

### Next Quarter: Class Mastery + Trait System (Combined)

**Goal:** Make every unit feel like a unique individual.

- **Class Mastery:** Permanent bonus after N battles in a class, persists through promotion.
- **Trait System:** 1-2 random personality traits on recruitment with small stat/behavioral modifiers.
- **Cross-system interaction:** Traits should interact with mastery (e.g. "Studious" reaches mastery faster, "Reckless" gets ATK from mastery at DEF cost).
- Ship together — individually minor, combined they're transformative for unit identity.

### Next Quarter: Merchant Caravan

- Rare battle NPC (10-20% spawn chance, meta upgrade to increase frequency)
- Spawns like a recruit NPC, moves 1 tile/turn toward map edge
- Enemies target it (AI priority)
- Survives → post-battle rare shop. Dies → no reward.
- Embedded escort objective without full "Additional Map Objectives" infrastructure

---

## Repo Hardening (Interleaved)

From `docs/reports/repo-hardening-next-steps-2026-02-17.md`:

| Item | Priority | When |
|------|----------|------|
| Prettier + ESLint | P0 | Sprint 1 (before content) |
| JSON schema validation | P0 | Sprint 1 (before content) |
| CI failure artifacts | P0 | After Sprint 1, low urgency |
| BattleScene decomposition | P1 | Driven by Sprint 3 (Colosseum) |
| CONTRIBUTING.md | P1 | After decomposition starts |
| Nightly wide-seed CI | P2 | When convenient |
| LICENSE + ASSET_LICENSE | P2 | When convenient |

---

## Backlog (6-12+ Months)

Designed but not near-term. Each could absorb a month+:
- Lord Ultimates (charge system, per-lord tuning, AI) — design notes in ROADMAP.md
- Secret Act + Narrative
- Support Bonds Lite
- Shrinking Safe Zone
- Multi-Stage Battles
- Full Battle Animations
- Additional Biomes
- Campaign System
- Endless Mode + Lunatic+
- Special Characters + Lord Selection

---

## Decision Log

| Decision | Rationale |
|----------|-----------|
| P0 hardening before content | Lint diff before content branches avoids merge conflict noise; schema validation = insurance |
| Promotion Branching before Colosseum | Foundational — all downstream features build on the class tree |
| BattleScene decomposition via feature work | Colosseum naturally extracts modules; abstract refactor may not align with actual needs |
| Skills + Staves combined | Problem and counterplay must ship together for fun balance |
| "Later" split into Next Quarter + Backlog | Prevents false velocity expectations; Lord Ultimates etc. are realistically 6-12 month items |
| Colosseum mercenary = fixed-stat promoted unit | Differentiates from regular recruit nodes (random/free); makes gold decision interesting |
| Class Mastery + Traits combined | Cross-system interaction (traits affect mastery) makes both features worth their cost |