# UI Overflow & Polish — Code Review (Feb 25, 2026)

Reviewed fixed-width containers, text overlap, and depth ordering across UI components. Most findings are theoretical or don't manifest with current game data. Logged here for reference if issues surface during playtesting.

## Actionable (Low Priority)

### 1. SlotPicker "finalBoss" act label
- **File:** `src/scenes/SlotPickerScene.js` (line ~216)
- **Issue:** Status text `Act ${summary.actReached} in progress` renders "Act finalBoss in progress" (25 chars) on a 160px center-aligned card. Overflows by ~5px.
- **Fix:** Map `finalBoss` to a display-friendly label like "Final Boss" before rendering.

### 2. DialogueOverlay fixed box height
- **File:** `src/ui/DialogueOverlay.js` (line 88)
- **Issue:** Box height fixed at 110px. Current longest dialogue line (~132 chars) wraps to ~3-4 lines and fits, but no safety valve if future dialogue is longer (7+ wrapped lines would spill).
- **Fix:** Calculate `boxH` from `lineText.height` after creation, or clamp text with ellipsis.

### 3. RosterOverlay visual text under buttons
- **File:** `src/ui/RosterOverlay.js` (lines 1057-1058)
- **Issue:** Item name + stats text can visually extend under [Equip]/[Store] buttons at `x+280`/`x+340`. Interaction zones are already correctly clamped (lines 1059-1062), so this is cosmetic only.
- **Fix:** Truncate rendered item text to `btnX - x - 8` width, or use Phaser `setCrop()`.

## Not Broken (Verified Against Data)

| Component | Claim | Reality |
|-----------|-------|---------|
| UnitInspectionPanel (120px) | Long names overflow | Longest real name is 15 chars (~90px), fits with 6px padding |
| LevelUpPopup (260px) | Skill name overflow | "NEW SKILL: Tactical Advantage" ≈ 216px, fits in 248px |
| UnitDetailOverlay (400px) | Proficiency string overflow | 5 profs with ranks ≈ 294px, fits in 376px |
| Convoy [Withdraw] overlap | Item name hits button at x+250 | Longest weapon name ≈ 156px from x+8, ends well before x+250 |
| Auth form narrow viewport | Press Start 2P clips | JS resize maintains 4:3 ratio, extreme narrow doesn't apply |
| Mobile btn labels nowrap | Label overflow | Labels are static ("Reset", "Cancel", "Menu"), all ≤6 chars |
| Tooltip x=430 cap | Awkward distance | Intentional clamping; 430+200=630 stays within 640px viewport |
| Depth 960 vs 901 | Dialogue covers level-up | Game flow is sequential (level-up → recruit → loot), never simultaneous |
