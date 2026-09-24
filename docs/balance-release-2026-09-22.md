# September 22 balance and command clarity update

## Scope
- Include the previously verified Act 3 recruit equipment and unpromoted readiness bonuses.
- Sol 600 Valor; old owners keep ownership and a 400-Valor refund basis until repurchased.
- Reduced Quartermaster's Craft, Honed Blades, Lethal Armory II/III, Field Supplies, and Master of Arms prices. Legacy owners receive the purchased-tier price difference, persisted with a revision marker at the next ordinary save.
- Random forge grants skip ineligible choices rather than losing a forge to a zero-weight weapon.
- Swift Instinct becomes tier 2; Coin of Fate grants 750 gold. Focused Curriculum and Quartermaster Cache become tier 2. Existing selected benefits/runtime modifiers and rolled costs survive reload; old cost-free Swift selections remain free.
- Blessing descriptions state recipients and duration; Astra states half damage. Other tier-4 benefit changes remain an evaluation item, not an untested numerical change.
- Luna now halves the relevant base DEF/RES, rounded down, before damage and critical multipliers; terrain and separate defensive modifiers remain. Sunder does not quarter defense. Chance and proc precedence remain unchanged. Applies to both sides.
- Show exits follows standard commands and End turn. More is renamed Battle details, retaining its existing anchored disclosure behavior.

## Verification
- 5,708 unit tests passed; 165 harness tests passed.
- Data schema validation, mirrored-data parity, production build and native asset sync passed.
- 24 targeted mobile browser cases passed (22 initially; 2 escape cases after fixing selected-unit exit access). All four simulation release slices passed. Lint: zero errors.
- Physical iPhone verification remains a tester follow-up.

## Follow-up playtest
Use a dedicated local origin and muted audio. Record actual active play time separately from build/test time. Spend 2–3 hours on normal gameplay, focusing on command visibility, disclosure usage, escape navigation, blessing decisions, rewards, inventory, and permanent-upgrade affordability. Preserve saves and report evidence versus hypotheses. No claim of completed long-session coverage until performed.
