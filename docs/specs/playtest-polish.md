# Playtest 3 polish (mobile + desktop, 2026-09-25)

Status: **built** on `claude/playtest-polish` (on top of `claude/threat-and-onboarding`).
Source: the September 25 phone (844×390) and desktop (1676×858, 640×480) playtest of
main through PR84. Captures: [`art-direction/ux-polish/playtest-3/`](../art-direction/ux-polish/playtest-3/README.md).

## 1. Phone: undoing a move keeps the tile choice readable

Select Sera → tap a blue tile → **Back**: she returns and the blue tiles stay, but the rail
used to switch to the idle commands (Inspect / Roster / Rewind / End turn) because
`UNIT_SELECTED` shared the `PLAYER_IDLE` rail.

- `UNIT_SELECTED` with a selected unit now leads with **"Choose a tile · <Name>"** and a
  **Cancel** (accessible name "Cancel selection") that deselects — the phone twin of the
  desktop `[X] Cancel` footer. Cancel sits in one row with End turn, so both stay in view
  at 844×390 without scrolling. Inspect / Roster / Rewind / End turn are all still there.
- One Cancel press deselects even while an enemy is being inspected (it clears the
  planning inspection first). During a tutorial movement gate only the prompt shows.
- Tapping another blue tile still moves (unchanged input); the rail returns to the action
  menu after the move.
- Also locator-selected units (End turn → Show <name>) read the same way.

## 2. Desktop: clicking an enemy while a unit is selected attacks it

Before: with a unit selected (movement shown), a left click on an enemy fell through to
"not a destination" and **deselected** (the hover panel then showed the enemy, which read
as inspection). The only route to attack was own tile → Attack → enemy. Not a documented
decision for desktop: the attack-flow spec keeps tap-to-inspect only for the **touch**
selection menu, and U6 (implementation plan 2026-09-20) made inspect-without-deselect a
mobile feature, leaving desktop right-click unchanged.

Now (pointer and pad on desktop; touch unchanged):

- Click an enemy the selected unit can attack **from where it stands** → the action menu
  opens on its tile and the forecast opens on that enemy at once (same as own tile →
  tap the enemy after the menu, `tryDirectAttack`).
- Click an enemy it can attack **after moving** → it walks to the attack tile, then the
  forecast opens (target-first flow, `AttackFlowController.begin(unit, { target })`).
  If it stopped somewhere else (ice slide) and can no longer reach, the ordinary post-move
  menu stays.
- **Attack tile choice** (`AttackOptions.chooseAttackTile`, pure): among the unit's tile
  and its stoppable, free destinations from which any usable weapon reaches (the same
  range union Attack uses): least movement → the equipped weapon reaches (the forecast
  opens on it) → better terrain (Def + Avoid) → reading order. Predictable over clever:
  never moves when it can already strike.
- **Hover preview:** pointing at such an enemy draws the walk to that tile (the normal
  path dots), so the destination is known before the click.
- **Unwinding:** Esc/Cancel → targets → action menu → undo move, exactly as after a
  manual move.
- Unreachable enemies keep today's deselect; idle clicks, right-click / hold inspection and
  `[V]` details are unchanged.
- The footer guide follows the state: while a unit is selected it reads
  **"Blue tile: move · enemy in reach: attack · unit: actions"** (short enough to fit the
  640 px canvas footer beside `[X] Cancel`; the idle line is too long to show there).
  Selecting a unit now refreshes the footer, so `[X] Cancel` appears on the first click,
  not only after an Escape.

## 3. Reward bundle copy

`applyRewardBundle` grants `quantity` separate copies, each with its full uses. A bundle
card (and its tooltip) now reads **"3 uses each"**; single items keep "3 uses"
(`formatBundleUses`, used by both the card detail lines and the tooltip text that the DOM
reward cards render on phone and desktop).

## 4. Copy consistency

- Compact objective: "Rout · 1 enemy remains" / "2 enemies remain" (was "1 enemy
  remain"); the tombstone variant pluralizes ("1 enemy + 2 reviving"); the rail's
  "1 unit ready".
- Save & Exit confirmation: "Battle suspended. Choose Resume on the Title screen to pick
  up where you left off." (was "Battle Suspended — Resume From Continue"); the rewards
  variant says "Resume returns to the map". Title messages that still pointed at a
  "Continue" button now name **Save Slots** (the Title labels are Resume · Act N /
  New Game / Save Slots).

## 5. Desktop route rail

Pointer-only and ≥ 1100 px wide: the side pane is `clamp(204px, 18vw, 300px)` (230 px at
1280, 300 px from ~1670) and its reading text steps up one size (body 12 → 13.5 px, place
13 → 15 px, state/notes, tags, lord chips, recruit preview). Phones and the 640×480
fallback keep 184/204 px and the old sizes. Checked at 640×480, 1280×800, 1676×858 and
1920×1080: no element leaves the pane, no page or card horizontal scroll.

## Playtest 4 (phone, before TestFlight)

Captures: [`art-direction/ux-polish/playtest-4/`](../art-direction/ux-polish/playtest-4/README.md).

### Recruit battles open without a dialog

"The recruit-battle intro note blocks play as a modal at the start of every recruit
battle, even with contextual helpers turned off." `RecruitBeaconController.create()`
called `showMinorHint(scene, recruitIntroHint(npc))` for every recruit battle that was not
a resume or tutorial, with no once-per-slot id and no Guidance check; at 20 words
`hintReadingPolicy` sends a minor hint through `showImportantHint`, a modal. Now:

- The beacon only draws the banner/halo and names the recruit in the objective line; it
  opens nothing.
- The Guidance note `guide_recruit_on_map` carries the recruit-specific copy: "Garrick
  (Cavalier) under the gold banner can join you. Move a Lord next to them and choose Talk
  before enemies reach them." (was "The green unit, Garrick, can join you. Move a Lord next
  to them and choose Talk before enemies reach them."). Non-blocking, once per save slot,
  Full and Light, never Off (legacy `hints: false` loads as Off). It may name a recruit the
  fog hides, since the banner shows through fog.
- The `battle_recruit` toast ("Move a Lord beside the green recruit and choose Talk.") is
  retired (the note says the same). A recruit battle also skips the other start-of-battle
  lessons that render as dialogs (the pinch-zoom lesson and the turn-1 par / Rewind
  lessons, each over 12 words); they wait for the next battle. Tutorial battles are
  unchanged (no recruit, no Guidance notes).

### Wait is always in view on the phone rail

"On phones, Wait now sits below the fold in a six-command menu." With Guidance Full a unit
with no target keeps a greyed Attack row, so a Dancer reads Attack / Shove / Pull / Trade /
Swap / Wait, and at 844×390 the scroll region shows two and a half rows (one at 568×320).

Options weighed: moving Wait second would fit but reorders the list against the canvas menu
and the keyboard/gamepad order (arrow keys would jump back up to it); compacting the greyed
Attack row saves at most one row and still loses Wait in a seven-command menu. Chosen:
**Wait is pinned in the fixed dock** (`pinnedRailCommand`, `MobileBattleHUD.syncDock`),
sharing Danger's row, so the dock stays one row and the scroll region keeps its height:

- Only the unit's own action menu pins it (any length, so it never moves between menus);
  equip/staff/art/ability pickers, the end-turn prompt and other states keep the dock as
  before (full-width Danger).
- Danger turns compact beside it: swatch, "Danger", and "Hold to pin" / "N in reach";
  same name, pressed state, tap and hold-to-pin.
- The list keeps the canvas order with the primary action first, the greyed Attack and its
  reason, and "more ▾" for whatever still overflows.
- Wait stays last in `_menuFocus` (the canvas menu is unchanged), which is where the dock
  sits visually: Arrow Down from the last list command lands on Wait, then wraps. It is the
  same menu item (`item.domButton`), so focus, `mb-menu-focused`, activation guards and the
  accessible name "Wait" are unchanged. Focus on Wait survives re-renders.
- The #93 "Choose a tile" / Cancel rail (UNIT_SELECTED) and the tutorial coach targets
  (Attack, End turn) are untouched.

Tests: `tests/MobileBattleRailPin.test.js`, `tests/e2e/mobile-battle-hud.spec.js` (six
commands at 844×390, 667×375 and 568×320: Wait on screen with no scroll, others reachable,
arrow order, tap), `tests/e2e/guidance-notes.spec.js` and `strategy-layer.spec.js` (recruit
battle: no dialog; note on Full/Light, none on Off or legacy helpers-off; once per slot).

## Triangle forecast note (verification)

The desktop read "Triangle advantage · −1 damage · +10 Hit". `triangleText` derives the
label and the sign from the same `bonus.damage > 0`, and `getWeaponTriangleBonus` only
returns both-positive or both-negative pairs (or zero after "ignores disadvantage"), so
the copy cannot pair "advantage" with a minus. Rendering Iron Sword vs Iron Axe at
1676×858 on this branch: the text object is "Triangle advantage · +1 damage · +10 Hit"
at DPR 1 and 2, and it renders with a plus. Re-sampling the same texture with NEAREST (the
filter before `crispCanvasText`) visibly drops strokes (e → c, · → -, t → !), which is the
mechanism by which a "+" loses its vertical bar. No code change; unit tests now pin the
label/sign agreement for normal and mastery ranks.

## Deviations

- Item 2 was implemented rather than replaced by a prompt: the no-attack behaviour on
  desktop was not a documented design (only the touch selection menu's tap-to-inspect
  is). The prompt was added as well, as the footer guide.
- The phone rail was not changed to restore the full selection action menu after Back;
  the prompt + Cancel keep the existing state machine (UNIT_SELECTED) untouched.
