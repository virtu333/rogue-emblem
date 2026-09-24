# Contextual help review — September 20, 2026

Scope: visible combat-lab roster inspection (Stats, expanded attribute/growth disclosures, Skills, Equipment), cross-checked against the current roster, mastery, combat, skill, weapon-art and post-combat code. Suggestions only; no runtime changes in this review.

## Priority 1: mastery and terminology

Confirmed: Class mastery is a static card showing only `0/8` until mastered. It has no help action, progress unit, or preview of the reward. Weapon proficiency simultaneously uses `Prof` and `Mast`, which can be mistaken for the same progression.

Recommended always-visible card:

- `Class mastery — 0 / 8 battles`
- `Unlock: Resolve · +1 Attack, +1 Defense`
- Whole labeled header is a help button with a subtle question-mark cue; minimum 44px target.

On tap, open a compact shared help surface. Explain that the counter advances once for a deployed survivor after a completed victory (escaped survivors count; benched/fallen units do not), not per attack or kill. Show this unit's actual threshold/perk using MasterySystem, including trait overrides. Explain promotion carryover and that switching class families changes the active perk/progress; past counters are retained. Do not promise all earned class perks stack permanently. Distinguish class mastery from weapon proficiency explicitly.

Weapon rank labels should expand to `Sword: Proficient` and `Sword: Master`. Help explains which rank the selected weapon/art needs, using canonical Prof/Mast requirements. Do not add a weapon-use XP bar: ranks are class/promotion driven in the current system.

Evidence: MobileRosterSheet.stats; MasterySystem; PostCombatController victory survivor loop; UnitManager proficiency parsing/promotion/equip rules.

## Priority 2: combat numbers and weapon arts

Confirmed live: Edric's Equipment shows sword Weight 3, while Combat shows Wt 2 and AS 6. This is correct effective-weight behavior, but the UI never explains the difference. Hit 115 is also not a 115% hit chance against a particular enemy.

Add a Combat header help action and rename the card `Combat baseline`. Explain Attack, Attack Speed, Hit rating, Avoid, Crit and effective Weight with a unit-specific breakdown. Example from the inspected fixture: `Weapon weight 3 − Strength allowance 1 = effective weight 2; Speed 8 − 2 = AS 6`. Avoid claiming this is the final forecast: conditional skills, mastery, terrain and opponent effects may alter combat. Target-specific hit/damage/doubling belongs in the existing forecast.

Confirmed live: Wrath Strike shows flavor text, HP cost and Ready, but omits its +5 Attack/+10 Hit. Dueling Blade omits +30 Avoid. Both have three-per-map limits in the catalog. The command status uses `Map 0/3` for usage spent, which is easy to read as zero remaining.

Render numerical effects, effective HP cost and explicit remaining uses alongside flavor. Use a shared formatter in roster, battle selection and forecast; support complex effect schemas rather than treating all arts as flat stat bonuses. Say `3 uses left this battle` rather than `Map 0/3`. Help states when the effect applies and which limits reset. Opening help must never select/activate the art or spend an action.

## Priority 3: passive skills and growths

Charisma already has its numeric bonus/range description; preserve it. Add a small `Passive aura` label and optional details: automatic, affects other allies in range, no action/uses, silence disables projection. Later, a temporary range preview could help, but only after the text/help interaction is sound. Do not make passive skills look like action buttons.

Growths already expand on tap, but opening the section reveals only percentages. Add one short explanation: each percentage is the chance of +1 on a level-up. Mention the existing minimum-one-stat fallback in deeper help. Preserve Attribute explanations as a working disclosure; no need to add a question mark to every stat.

## Follow-up: mastery earned notification

PostCombatController still creates a transient Phaser mastery toast while rewards use an opaque DOM sheet. This is a potential hidden-notification seam found in source, not reproduced during this review. Verify a unit crossing its threshold after victory. Prefer a persistent DOM reward notice with perk name/effect and a help action so players can revisit the explanation.

## Shared interaction

Use one compact Help sheet built on MenuSurface with a clear title, contextual current values, short rule explanation and Close. Reuse existing depth/input ownership. Close via touch, Escape and controller B; restore focus to the exact invoking control and preserve roster tab/unit/scroll. Only one help sheet at a time; destroy on parent/scene teardown. At phone widths, body scrolls while Close stays accessible. No hover-only or long-press-only information. For actionable cards, keep a separate explicit information control so help cannot trigger a purchase, equip, skill or turn action.

Show decision-critical information inline (progress units, rewards, costs, effects, disabled reasons); help is for the explanation, not a substitute for those facts.

## Proposed sequence and verification

1. Shared help surface, mastery card and expanded proficiency labels.
2. Combat-baseline breakdown and numerical weapon-art descriptions/remaining uses.
3. Passive/growth clarifications and mastery-earned DOM notice after verifying the seam.

Check at 667×375 and 844×390 plus desktop keyboard/controller. Cover opening/closing without gameplay mutations, focus/scroll restoration, parent shutdown, long names, mastered/unmastered units, threshold/perk-changing traits, promotion/reclass round trips, and art HP-cost modifiers. Source all values from engine/catalog helpers; no duplicated eligibility logic or invented rules.
