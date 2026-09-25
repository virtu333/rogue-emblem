# Playtest 2 — threat sight, guidance, Mac text

Spec: [`docs/specs/threat-and-onboarding.md`](../../../specs/threat-and-onboarding.md).
Phone captures at 844×390 (stored at 1.5×, i.e. half the DPR-3 capture), desktop at 1280×800, Mac crops at 1440×900 @2×
(1:1 device pixels). Captured from the `combat_actions` preset with the enemy line pulled
into reach; palette PNGs.

## Threat sight

| | |
|---|---|
| `threat-1280.png` | Desktop: hovering a destination. Each enemy that can reach it gets a crimson eye, corner ticks and a dashed ink line; the tile carries the count; the info panel reads `Threat: 4 can reach`. |
| `threat-844.png` | Phone: after the tap-move (tentative, Back undoes it) the eyes stay on; the rail's terrain card says **4 can reach**. |
| `threat-grades-1280.png` | The same marks under the act grades act1, act2, act3 (top) and act4 night, the Deep (bottom), Atmosphere Full. |

## Guidance (new players)

| | |
|---|---|
| `guide-first-turn-844.png` | First player phase on a new save: one field note, docked where it covers no unit; text is click-through, only *Got it* / *Fewer tips* take input. |
| `attack-greyed-844.png` | Sera selected with nobody in reach: **Attack** stays in the menu, greyed, "No target in range 1–2" (was: no Attack at all, Equip looking like the primary action). |
| `guide-fragile-844.png`, `guide-fragile-1280.png` | Sera moved where 4 enemies reach: the fragile-unit note ("Tap Back" / "Press Esc or right-click"); desktop notes stay on the battlefield, clear of the HUD plates and the action menu. |
| `convoy-844.png` | Roster › Convoy explains the convoy and Store / Withdraw in plain words. |

## Mac text (1440×900 @2×, Chromium)

| before (main) | after |
|---|---|
| `mac-forecast-before.png` | `mac-forecast-after.png` — canvas forecast: 2× text was NEAREST-downsampled into the 640×480 canvas ("Damage/l it", broken "If all hits land"); now LINEAR. |
| `mac-hud-before.png` | `mac-hud-after.png` — desktop HUD plates. |
| `mac-title-before.png` | `mac-title-after.png` — Press Start 2P on the transform-scaled title now lands on whole device pixels (even stroke widths). |
| `mac-blessing-before.png` | `mac-blessing-after.png` — DOM header kicker snapped to the device-pixel grid. |
