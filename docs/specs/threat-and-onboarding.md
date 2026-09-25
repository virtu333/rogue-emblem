# Threat sight, new-player guidance and Mac font scaling (playtest 2)

Status: **built** on `claude/threat-and-onboarding` (2026-09-25). Source: a second round
of playtests (phone and a Mac desktop browser). Captures:
[`art-direction/ux-polish/playtest-2/`](../art-direction/ux-polish/playtest-2/README.md).

## Feedback

- "The little red arc to indicate that a unit is threatening the character you're moving
  is so so nice [Three Houses] … just turn the enemies' eyes red or something if they're
  threatening your character so you don't have to figure out the weird 3D arc thing."
- "I can't get Sera to attack and she just dies a lot." / "Never put Sera in danger early
  and have her heal Edric." / "I don't quite understand what the convoy and withdrawal do."
- (Mac, desktop browser) "The new UI has some weird chunky font scaling issues on mac even
  though the animations and look overall are 👌."

## 1. Threat sight — who can reach this tile

While a player unit is selected (`UNIT_SELECTED`, or the action menu before it acts):

- **Which tile.** The destination under the mouse / grid cursor when it is a stoppable
  move tile; otherwise (no hover, off-range, touch, after a tap-move) the unit's own
  tile. On touch the tentative destination *is* the unit's tile after the tap-move, until
  Back undoes it.
- **Who.** Every *visible* enemy that could strike that tile next enemy phase: a crimson
  **eye** above its head (`src/art/threatSigil.js`, 17×9 art px, ink outline + glow,
  slit pupil; violet for status staves), crimson **corner ticks** on its tile and a short
  dashed **ink line** with an arrowhead from it to the tile (max 8 lines). A crimson
  **count tag** sits on the tile.
- **Move preview.** Phone rail terrain card: "2 can reach" (crimson when > 0; "No foe can
  reach" otherwise; "· 1 staff"; "· fog may hide more" under fog). Desktop info panel:
  `Threat: 2 can reach`.
- **Same computation as Danger.** `src/engine/ThreatForecast.js` now owns the Danger
  overlay's math (`computeDangerTiles`; `BattleScene.calculateDangerZone` delegates) and
  `threatsOnTile` evaluates the same rules — movement, terrain costs, roots that outlast the
  phase, blocking units, weapon and status-staff range, entities, enemy ballistas — with the
  mover lifted off its tile and set down on the destination, so paths the move opens (a
  chokepoint) or closes are honoured. Tested tile-for-tile against the overlay (incl. ice).
- **Fog.** Only enemies the player can see are evaluated; hidden units are never revealed.
- **Cost.** A cheap key is compared each frame; the query runs only when the focus tile,
  selection, turn or state changes, is memoized per tile against a world signature, and
  prunes enemies beyond movement + reach (exact without ice). ~0.3 ms per hovered tile with
  6 enemies, ~1.7 ms average / 6 ms worst with 27. Graphics redraw only when the answer
  changes; the eye's bob is a stepped 2-px transform tween (static under Reduce Motion).
- **No RNG.** Construction runs under the presentation RNG; e2e asserts the battle RNG
  cursor is unchanged by hovering.
- Depths stay in world space (< `SCREEN_UI`): lines 7.6, corner ticks 8.5, eyes 16, tag
  16.5 — readable over every act grade (captured act1–act4 + deep).

## 2. New-player support

### What actually stopped Sera attacking

Audited as a brand-new player at 844×390. Sera starts with Lightning (1–2 range) and Heal;
nothing is mis-equipped. The trap: tapping a unit opens its planning menu at once, and
without an enemy in weapon range **Attack is simply absent** — Sera's menu read *Equip /
Item / Wait*, with Equip wearing the focus ring as if it were the primary action. A new
player looks for Attack, taps Equip, sees Lightning already equipped, and concludes she
cannot attack. Then they walk her forward and the next enemy phase takes 15 of her 21 HP.

Fixes: with Guidance on Full, the menu keeps a greyed **Attack** row with the reason
("No target in range 1–2"); a disabled Attack is never styled primary; the threat eyes and
the fragile-unit note (below) make the danger visible before committing.

### Guidance setting

Settings → **Guidance · Full / Light / Off** (replaces "Contextual helpers").
`auto` (the stored default) resolves to Full for a save slot that has not finished a run
and Light afterwards (`engine/Guidance.js`). Legacy `hints: false` loads as Off and the two
keys stay in step for older clients (`normalizeSettings`).

- **Full** — coaching notes plus first-use explanations, greyed Attack with reason.
- **Light** — first-use explanations only (commander, recruits).
- **Off** — no field notes. The practice tutorial is unchanged.

### Field notes (`GuidanceController` + `GuidanceNote`)

Non-blocking DOM notes docked in the map corner that covers the fewest units (the unit a
note is about counts triple); the plate is click-through, only **Got it** / **Fewer tips**
take input. One note at a time, at most two coaching notes per battle, each id once per
save slot (HintManager; marked read on Got it or after a continuous reading window). Never
in tutorial battles. "Fewer tips" sets Guidance to Light.

| id | tier | when | copy (touch) |
|---|---|---|---|
| `guide_first_turn` | coach | first player phase | Tap a unit with a blue ring to see where it can move. While you choose a tile, a red eye marks each enemy that could reach it next turn. |
| `guide_fragile_in_reach` | coach | a healer / thin unit (DEF ≤ 4, HP ≤ 22) was moved where ≥ 1 enemy reaches | Sera would be in reach of 2 enemies and can't take many hits. Tap Back to choose a safer tile. |
| `guide_healer_heals` | coach | a healer with staff uses is selected while an ally is hurt | Sera heals with a staff: move next to a hurt ally and choose Heal. Early on, keep Sera out of reach and heal Edric. |
| `guide_no_attack` | coach | a unit ended its move with no target | No enemy is in reach of Sera here, so Attack is greyed out. Tap Back to try a closer tile, or Wait. |
| `guide_commander_low_hp` | essential | commander starts a player phase at ≤ 50% HP | Edric is badly hurt. If Edric falls, the run ends. Pull back, heal with a staff, or use a Vulnerary from Item. |
| `guide_recruit_on_map` | essential | a visible green (recruitable) unit | The green unit can join you. Move a Lord next to them and choose Talk before enemies reach them. |

Desktop wording swaps "Tap Back" for "Press Esc or right-click".

### Convoy and Withdraw

Convoy = the army's shared storage (20 weapons / 15 consumables, + meta bonus), used
between battles from Roster › Convoy; units only fight with what they carry (5 weapons,
3 consumables). **Store** moves a carried item into it; **Withdraw** gives a stored item
to the chosen unit. There is no "retreat"/withdraw-from-battle command (Escape maps let
non-lords "retreat safely" when the lords exit — that wording is unchanged). The Convoy
tab now says this in plain words, the desktop convoy panel has one line, and the reward
picker's "Send to Convoy" reads "Shared storage. Withdraw it to any unit from Roster ›
Convoy between battles."

### First-30-minutes audit (844×390, new save)

1. First battle opens with a modal about pinch-zoom; nothing says how to act. → first-turn note.
2. Tapping Sera: *Equip / Item / Wait*, no Attack, Equip focused like a primary. → greyed Attack + reason; not primary.
3. Moving Sera one tile forward costs 15 of 21 HP next phase with no warning. → eyes, "N can reach", fragile note.
4. Nothing teaches that Sera heals Edric. → healer note.
5. Convoy tab: "Withdraw to: Edric" looks like an action on an empty convoy; no definition. → plain explanation.
6. Rewards: two gold cards ("472 gold + 25 team XP" vs "Take 272 gold instead") read as duplicates; "Prof" is jargon. (Not changed here — noted for the choice-screens pass.)
7. The first-turn phase band and level-up card are clear; the node-map field note is good.
8. The run-ending rule (only the commander's fall ends the run) is only taught if the tutorial is played. → commander note.

## 3. Mac font scaling

Reproduced in Chromium at 1440×900, 1512×982, 1728×1117 and 1280×720 at DPR 2, and at
browser zoom 110% (DPR 2.2) / 90% (DPR 1.8). Two causes:

1. **Canvas text.** The desktop battle HUD, action menus and the forecast are canvas text
   rasterized at 2× into the 640×480 pixel-art canvas. With NEAREST sampling the 2×
   texture was downsampled by dropping every other texel, so glyphs broke up ("Par: 10"
   read "Par: J0", "Damage/l it") — then the canvas is magnified 3.75× on a Retina Mac.
   This is exactly Alex's forecast screenshot. `crispCanvasText` uploads supersampled text
   with LINEAR filtering; sprites and 1× text keep NEAREST.
2. **DOM pixel font.** Press Start 2P is an 8-px grid font; at 7/9/10/11 px (or scaled by
   the desktop title's transform / ceremony `--ce-scale`) a Retina screen gets 1.75–3.75
   device pixels per font pixel: uneven strokes. `pixelFontGrid` publishes `--re-pf-N`
   (N = 6…24) snapped to the nearest size whose font pixels are whole device pixels for the
   current DPR (ties go down, ±25% cap, follows zoom / display changes). CSS uses
   `var(--re-pf-N, Npx)`; the title stage publishes `--rt-pf-N` for its scale and
   ceremonies `--ce-pf-7/8`. Cinzel and the body face are vector faces and were fine.

Deliberately not done: integer-scaling the desktop canvas (uniform pixels, but up to 20%
smaller play area at 1440×900) and re-rendering the canvas at device resolution (would
need camera zoom across every scene). Safari/WebKit could not be run here (Chromium only);
the fixes are engine-independent (texture filtering, CSS sizes).

## Tests

Unit: `ThreatForecast.test.js` (overlay parity incl. ice, chokepoints, fog, roots, staves,
ballistas, entities, no RNG), `ThreatSightController.test.js`, `Guidance.test.js`
(levels, copy, settings migration, controller moments), `PixelFontGrid.test.js`.
e2e: `threat-sight.spec.js` (desktop hover, reduced motion, touch), `guidance-notes.spec.js`
(once, dismissible, non-blocking, Light/Off, Settings cycle), `mac-font-grid.spec.js`
(6 Mac viewports/zooms: crisp pixel fonts, no overflow, LINEAR canvas text).

## Deviations

- The UX-polish systems named in the brief (new DangerZoneOverlay, TutorialCoach,
  infoAffordance, UnitLocator) had not landed on main during this work; threat sight
  shares the Danger overlay's *computation* (which lives on main) and uses its palette
  tokens (`threatEdge/Ink/Fill/Status`, identical values). Field notes are a small
  separate component styled like the coach; they can move into the coach once it lands.
- The line is straight and dashed (2D), not an arc.
