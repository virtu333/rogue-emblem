# Add Skills Tab to Home Base Meta Progression

**Type:** Feature | **Priority:** Normal | **Effort:** Large
**Depends on:** Wave 4 (Expanded Skills) from NEXT_STEPS.md

## TL;DR

Add a 5th "Skills" tab to the Home Base upgrade shop. Players spend Renown to unlock innate skills for classes, increase equipped skill slot count, and unlock skill scrolls in shops.

## Current State

- Home Base has 4 tabs: Recruits, Lords, Economy, Capacity (28 upgrades)
- 3 skills have `classInnate` (Swordmaster, Sniper, Assassin) — granted automatically on promotion
- `MAX_SKILLS = 5` is a hard constant — no meta upgrade to change equipped slot count
- Skill scrolls only appear as loot drops, never in shops

## Expected Outcome

New "Skills" category in `metaUpgrades.json` with upgrades like:

- **Base Class Innate Skills** (~10 upgrades, 1 per base class) — unlock an innate skill granted at recruitment. Cost: 150-250R each
- **Promoted Class Innate Skills** (~10 upgrades) — unlock an innate skill granted on promotion. Cost: 200-350R each
- **Equipped Skill Slots** (2 tiers) — increase equipped skill cap from 1 → 2 → 3 (separate from MAX_SKILLS=5 total). Cost: 400 → 600R
- **Scroll Availability** (1-2 tiers) — skill scrolls appear in Act 2+ shops. Cost: 200-400R

HomeBaseScene adds "Skills" as 5th tab, listing these upgrades with the same progress bar UI.

## Files to Touch

- `data/metaUpgrades.json` — add ~23 new upgrades in `"skills"` category
- `src/scenes/HomeBaseScene.js` — add Skills to CATEGORIES array
- `src/engine/MetaProgressionManager.js` — may need new effect types (`classInnateSkill`, `equippedSlotBonus`)
- `src/engine/UnitManager.js` — apply innate skill unlocks in `createUnit()`/`createRecruitUnit()`, respect equipped slot meta
- `src/engine/LootSystem.js` — scroll shop availability based on meta effect

## Risks / Notes

- **Blocked by Wave 4**: Need on-defend/on-kill triggers and command skills defined before we know which skills to assign as innates
- **Equipped vs total skills**: Currently MAX_SKILLS=5 is a hard cap on total skills a unit can *know*. The meta upgrade should control how many can be *equipped at once* (a new concept), not the total cap
- **Skill balance**: Unlocking too many innate skills for free could trivialize early acts. Consider making each unlock apply to one specific class, not all classes
- **UI space**: 5 tabs may need tighter tab spacing or abbreviation on smaller screens
