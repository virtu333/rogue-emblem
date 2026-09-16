# Mobile Overlay Theme Guide

**Date:** 2026-09-16
**Status:** Reference for the mobile UI/UX revamp
**Interactive mockups:** `docs/mobile/mockups/roster-theme-options.html` (open in any browser — three switchable variants of the roster screen)

## Problem

The mobile menu revamp (roster overlay and friends) improved readability and touch
ergonomics but lost the game's visual identity: rounded slate-gray cards, system
fonts everywhere, all-gold stat numbers, drop-shadow buttons. It reads as a generic
admin dashboard, not Rogue Emblem.

The fix is a **reskin, not a relayout** — keep the revamp's structure, spacing,
information order, and ≥44px touch targets. Only the chrome changes.

## Source of truth for the vibe

The game already defines its language in two places. Do not invent new colors:

- `src/utils/uiStyles.js` — `UI_COLORS`, `STAT_COLORS`, `HP_BAR_COLORS`, `getHPBarColor()`
- `index.html` auth overlay CSS — the canonical example of an **HTML overlay that
  keeps the pixel vibe**: `#12111f` panels, `#e8b849` gold focus, 'Press Start 2P'.

## Non-negotiables (any variant)

1. **Border radius ≤ 3px.** Rounded 8–12px cards are the single biggest vibe-killer.
2. **'Press Start 2P'** for headers, labels, buttons, tabs. Keep the readable
   system/monospace font for body copy and long descriptions — the readability win
   stays. Budget ~8px/char at 9px size; test longest strings (promoted class names,
   "Advanced Management").
3. **Gold = selected/focused/actionable**, exactly as in-game: border `#e8b849`,
   fill `rgba(232,184,73,.06)`, text `#f5d77a`. No filled blue primary buttons.
4. **Stat colors from `STAT_COLORS`**: HP `#ff6666`, STR/MAG/SKL `#ffdd44`,
   SPD `#66ddff`, DEF/RES `#66ff66`, LCK/MOV `#e0e0e0`. All-gold numbers throw away
   information the game already encodes.
5. **Panels are navy, not slate**: fills `#12111f` / `#1a1a2e` on ground `#0a0c1e`,
   hairlines `#3a3a55`. No drop shadows — depth comes from borders/fills (or
   Variant B's inset bevels).
6. **HP bars wherever HP appears** (thresholds per `getHPBarColor`) and mini stat
   bars in stat grids — bars are half the FE feel.
7. **Micro-details**: 2px gold rule under screen titles; ▸/◆ glyphs as cursors and
   markers; `image-rendering: pixelated` on sprites/portraits;
   `font-variant-numeric: tabular-nums` on stat columns; hover/press states shift
   color to gold, never fade opacity.

## Drop-in tokens

```css
/* mobile-overlay theme tokens — mirrors uiStyles.js + index.html auth overlay */
:root {
  --re-bg: #0a0c1e;        /* page ground */
  --re-panel: #12111f;     /* chrome / buttons */
  --re-panel-2: #1a1a2e;   /* content panels (Phaser 0x1a1a2e) */
  --re-line: #3a3a55;      /* hairline borders */
  --re-gold: #e8b849;      /* selection / focus border */
  --re-gold-hi: #f5d77a;   /* selected / hover text */
  --re-gold-ui: #ffdd44;   /* in-canvas gold (headers, offense stats) */
  --re-text: #e0e0e0;  --re-muted: #8888aa;  --re-blue: #88ccff;
  --re-hp: #ff6666; --re-off: #ffdd44; --re-spd: #66ddff; --re-def: #66ff66;
  --re-font-px: 'Press Start 2P', monospace;
}
.re-panel  { background: var(--re-panel-2); border: 1px solid var(--re-line); border-radius: 0; }
.re-select { border-color: var(--re-gold); background: rgba(232,184,73,.06); color: var(--re-gold-hi); }
.re-btn    { font: 8px/1 var(--re-font-px); letter-spacing: 1px; color: #cccccc;
             background: var(--re-panel); border: 1px solid #444466; padding: 12px 16px; }
.re-btn:hover, .re-btn:active { border-color: var(--re-gold); color: var(--re-gold-hi);
             background: rgba(232,184,73,.06); }
```

## The three variants (see mockup file)

- **A · Command Panel (recommended baseline).** Direct port of the auth-overlay +
  Phaser panel language: square corners, hairlines, navy panels, gold selection,
  active tab `#443300` with `#ffdd44` border. Roughly a CSS-only diff on the
  current revamp markup.
- **B · FE Window (most "Fire Emblem").** GBA-style bevelled blue windows via
  layered `box-shadow` insets (no images), pixel-checker backdrop, text shadows.
  Highest effort; only adopt if applied to every overlay in one pass — mixed with
  flat panels it looks broken.
- **C · Gilded Tactics (modern-tactical middle ground).** Near-black ground,
  hairline panels with gold corner brackets (pseudo-elements), chamfered
  (`clip-path`) buttons/tabs, ▸ cursor on the selected unit. Distinctive without
  imitating GBA chrome; the bracket/chamfer classes are additive on top of A.

## Suggested path

1. Ship **A** now as one shared stylesheet for all mobile HTML overlays (roster,
   shop, church, settings, deploy) — token substitution on current markup.
2. Layer **C**'s brackets/chamfers on hero surfaces if A feels too plain.
3. Treat **B** as the aspirational full-commit skin.
4. Whichever wins, extract the tokens into one shared CSS file so the mobile
   overlays and the `index.html` auth overlay stop diverging.
