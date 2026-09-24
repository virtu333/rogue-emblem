# Compact battle sidebar — September 22

Implements the approved three-state sidebar mockups after the build 19 playtest follow-up wave.

## Behavior

- Turn/phase, par/rating when available, and remaining rewind charges sit above the commands.
- The objective is compact and persistent; its visible information indicator opens the full existing instructions, including recruit/village objectives and escape instructions.
- Focused terrain name, movement cost/type, DEF and Avoid stay outside the scrolling command area. Terrain special rules are available through a labeled details button.
- Selected-unit name, HP, class/weapon and conditions use a compact summary. Enemy inspection exposes View unit and Pin range in the command grid.
- Main actions use a 38px minimum height. Overview, Recenter, Back and Menu retain their existing 44px minimum height and bottom position.
- Danger displays a Hold to pin/unpin cue. It also works in the unit action menu without canceling that selection. Tap remains the ordinary toggle; the explicit pin option remains in Battle details.
- Show exits remains below standard commands. Long item lists and unusual combinations can still scroll; terrain and bottom navigation remain outside that scrolling area.
- Pin-cap replacement information remains available in Battle details and the pin control's accessible description. Planning inspection retains its detail/pin controls.

## Verification

- 5,715 unit tests / 342 files passed.
- 165 harness tests / 11 files passed.
- Targeted lint passed with zero errors (40 existing BattleScene warnings).
- Eight focused headless browser tests passed: 844×390, 667×375, 640×480, idle/enemy/selected states, objective help closing, selected-menu Danger tap/hold, planning and threat pins, fresh/resumed escape maps.
- Screenshots inspected for the compact command rail. Early test timing race was replaced with polling for stable layout; escape tests now open the objective instructions explicitly.
- Production build passed. Physical iPhone validation remains outstanding.
- No TestFlight upload in this change. Other agents' untracked art directories are untouched.
