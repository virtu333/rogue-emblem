# Wyvern (No Reclass) + Weapon Arts Execution Plan

Date: 2026-02-12
Owner: gameplay roadmap stream

## Scope Lock

1. Implement **Wyvern integration now**.
2. Explicitly **defer Reclass/Second Seal** (rules, UI, persistence migration complexity).
3. Prioritize **Weapon Arts** immediately after Wyvern lands.

## Phase A: Wyvern Foundation (Reclass Deferred)

### A1. Data + Contracts

1. Add/verify Wyvern classes in `data/classes.json`:
   - `Wyvern Rider` (base)
   - `Wyvern Lord` (promoted)
2. Validate class fields align with current loader expectations:
   - `tier`, `baseStats`, `moveType`, `weaponProficiencies`, `promotesTo`, `learnableSkills`
3. Keep promotion flow class-based only (no class swap/reclass surfaces).

### A2. Runtime Integration

1. Enemy generation supports Wyvern classes in intended act pools.
2. Recruit generation can produce Wyvern class entries where configured.
3. Promotion resolution supports Wyvern promotion paths without introducing Second Seal logic.

### A3. Gameplay QA Focus

1. Movement/pathing correctness for flying move type.
2. AI turn stability on maps with dense terrain/chokes.
3. Combat and forecast surfaces correctly display Wyvern loadouts.

### A4. Tests / Gates

1. Unit tests for class creation + promotion resolution.
2. Map/enemy/recruit generation deterministic tests for Wyvern inclusion.
3. Harness/sim smoke runs with Wyvern present.

## Phase B: Weapon Arts (Priority Track)

### B1. Foundation

1. Add `data/weaponArts.json` contract and loader validation.
2. Add combat engine hooks:
   - art selection
   - eligibility checks
   - effect application
   - resource/cooldown/uses consumption
3. Integrate battle UI and forecast deltas for active art selection.

### B2. Acquisition + Persistence

1. Define initial unlock/acquisition path (class unlocks or loot/shop unlocks; keep one simple path first).
2. Persist unlocked/known arts in run state.
3. Ensure serialization and cloud payload compatibility.

### B3. Content Rollout

1. Start with a small, balanced set (6-10 arts across core weapon types).
2. Add enemy and legendary-weapon arts after player UX stabilizes.
3. Run tuning pass on costs, damage ceilings, and AI usage frequency.

## Asset Production Track (Required)

Use Imagen API pipeline prompt and scaffold:

- Reference: `References/imagen-asset-pipeline-prompt.md`
- Target location: `tools/imagen-pipeline/`
- Required outputs:
  1. `generate.js` (Imagen generation runner)
  2. `process.js` (post-process, nearest-neighbor downscale, optional bg removal/palette reduction)
  3. `manifest.json` (wave-scoped asset manifest)

Asset governance:

1. Keep `assets/` as the canonical source of truth.
2. Treat `public/` as generated/deploy-facing output only.
3. Add a repeatable command path for generation + processing in `package.json` scripts once pipeline is in place.

## Suggested Merge Sequence

1. Wyvern data + runtime + tests (no reclass)  
2. Weapon Arts foundation + contract + UI hooks  
3. Weapon Arts content + persistence + balancing  
4. Imagen pipeline tooling + first asset batch integration

## Risks / Controls

1. Scope creep into reclass:
   - Control: block Second Seal/Reclass changes in Wave 3A PRs.
2. Weapon Arts UI complexity:
   - Control: ship narrow MVP first; keep menu interactions deterministic.
3. Asset pipeline drift:
   - Control: enforce assets/public source-of-truth policy and scriptable regeneration.

