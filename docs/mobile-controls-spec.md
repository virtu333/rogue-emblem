# Rogue Emblem — Mobile Virtual Controls Spec

**Version:** 1.0
**Date:** 2026-02-13
**Status:** Draft (Not Implemented)
**Scope:** Web-only (mobile browser), with optionality toward Capacitor/Electron wrapping later
**Context Sync:** Independent of Act 4/reinforcement runtime wiring; safe to deliver as a standalone UX feature.

---

## Problem Statement

Rogue Emblem is playable on mobile browsers but two issues make the experience poor:

1. **Resolution/readability:** The 640x480 canvas scales to ~520x390 on phones in landscape (0.65x), making 32px tiles render at ~21px and 12px fonts at ~8px — below usable thresholds.
2. **Missing inputs:** 11 keyboard shortcuts + right-click have no touch equivalents, blocking core gameplay actions (cancel, danger zone, roster viewer, end turn, etc.).

### What already works on mobile
- Tap-to-select with 12px drag threshold (pointerup commit)
- Long-press (420ms) for unit inspection panel
- Touch scroll in NodeMapScene/HomeBaseScene
- Mobile UA detection → `isMobileInput` flag, `reducedEffects` auto-enabled
- Menu position clamping against camera bounds
- Expanded hit areas on action menu buttons (28px hitHeight)

---

## Goals

- All game functions accessible without keyboard or right-click
- Comfortable to play on iPhone 13+ / Galaxy S21+ / Pixel 6+ in landscape
- No changes to 640x480 game canvas (avoids breaking all hardcoded coordinates)
- Controls hidden on desktop — zero impact on existing experience
- Implementation reusable if we later wrap with Capacitor (iOS) or Electron (Steam)

## Non-Goals (v1)

- D-pad / virtual analog stick (navigation is tap-based, not joystick)
- Resolution increase (640x480 stays; readability improved via landscape + side panels)
- Portrait mode support
- iPad-specific optimizations
- Native app wrapper (Capacitor/Electron deferred)

---

## Target Devices

| Device | Viewport (landscape) | Canvas Scale | Side Panel Space |
|--------|---------------------|--------------|-----------------|
| iPhone 13/14 | 844 x 390 | ~520 x 390 | ~324px total (162px/side) |
| iPhone 15 Pro | 852 x 393 | ~524 x 393 | ~328px total |
| iPhone 15 Pro Max | 932 x 430 | ~573 x 430 | ~359px total |
| Galaxy S21 | 851 x 393 | ~524 x 393 | ~327px total |
| Galaxy S24 | 892 x 411 | ~548 x 411 | ~344px total |
| Pixel 6/7 | 851 x 393 | ~524 x 393 | ~327px total |

All target devices provide **160px+ per side** in landscape, which is ample space for button panels.

---

## Approach: Landscape + HTML Overlay

### Why HTML overlay (not Phaser canvas extension)

| Consideration | HTML Overlay | Phaser Canvas Extension |
|---------------|-------------|------------------------|
| Implementation | Standard DOM + CSS | Extend canvas, update all scenes |
| Touch handling | Native DOM events | Manual hit-area management |
| Responsive sizing | CSS media queries + flexbox | Manual math per device |
| Maintenance | CSS only, no game logic changes | Every scene must know control area |
| Show/hide | `display: none` | Depth/visibility management |
| Desktop impact | Zero (hidden via CSS) | Must guard every scene |
| iOS/Steam reuse | Works in any webview | Works in any webview |

**Decision: HTML overlay.** Standard web patterns, no game canvas changes, easier to build and maintain.

### Why landscape-only

- Landscape gives 324px+ of horizontal letterbox space for controls
- Portrait scales canvas to ~390x293 → tiles at ~19px (unusable)
- Game is 4:3 aspect ratio — landscape is natural fit
- Side panels in letterbox space don't obstruct gameplay at all

---

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ ┌──────────┐  ┌──────────────────────────┐  ┌────────┐ │
│ │          │  │                          │  │        │ │
│ │  LEFT    │  │                          │  │ RIGHT  │ │
│ │  PANEL   │  │     640x480 GAME CANVAS  │  │ PANEL  │ │
│ │          │  │     (Phaser — unchanged)  │  │        │ │
│ │          │  │                          │  │        │ │
│ │          │  │                          │  │        │ │
│ ├──────────┤  └──────────────────────────┘  ├────────┤ │
│ │ [Cancel] │                                │ [Info] │ │
│ │ [Menu]   │                                │ [End]  │ │
│ └──────────┘                                └────────┘ │
└─────────────────────────────────────────────────────────┘
```

- **Left panel:** Persistent controls (Cancel, Menu/Pause)
- **Right panel:** Context-sensitive controls (change based on game state)
- **Panels sit in the horizontal letterbox** — outside the game canvas, never overlapping gameplay
- **CSS flexbox** positions panels on either side of `#game-container`
- **Safe areas** respected via `env(safe-area-inset-*)`

---

## Control Mapping

### Left Panel (Always Visible)

| Button | Label | Touch Equivalent Of | Action |
|--------|-------|-------------------|--------|
| B | **Cancel** | Right-click / ESC (context-dependent) | Deselect unit, close menu, back out of selection |
| ☰ | **Menu** | ESC (when nothing active) | Open pause overlay (settings, help, save & exit) |

### Right Panel (Context-Sensitive)

Buttons appear/disappear based on current game state.

#### Battle — PLAYER_IDLE / PLAYER_TURN

| Button | Label | Key Equiv | Action |
|--------|-------|-----------|--------|
| ⚠ | **Danger** | D | Toggle danger zone overlay |
| 📋 | **Roster** | R | Open roster overlay |
| ℹ | **Info** | O | Show objective display |
| ⏭ | **End Turn** | E | End player phase |

#### Battle — UNIT_SELECTED / UNIT_MOVED / ACTION_MENU

| Button | Label | Key Equiv | Action |
|--------|-------|-----------|--------|
| ⚠ | **Danger** | D | Toggle danger zone overlay |
| 👁 | **Inspect** | V | Toggle inspect mode (tap unit for details) |

#### Battle — CONFIRMING_ATTACK (weapon picker visible)

| Button | Label | Key Equiv | Action |
|--------|-------|-----------|--------|
| ◀ | **Prev Wpn** | LEFT | Previous weapon |
| ▶ | **Next Wpn** | RIGHT | Next weapon |

#### Battle — BATTLE_END (loot screen)

| Button | Label | Key Equiv | Action |
|--------|-------|-----------|--------|
| 📋 | **Roster** | R | Open roster viewer |

#### NodeMapScene

| Button | Label | Key Equiv | Action |
|--------|-------|-----------|--------|
| 📋 | **Roster** | R | Open roster overlay |

#### HomeBaseScene

No right-panel buttons needed — all interactions are tap-based.

#### Tabbed Overlays (Inspection Panel, Help, How-to-Play)

| Button | Label | Key Equiv | Action |
|--------|-------|-----------|--------|
| ◀ | **Prev Tab** | LEFT | Previous tab/page |
| ▶ | **Next Tab** | RIGHT | Next tab/page |

### Long-Press Enhancement

The existing 420ms long-press currently only shows the inspection panel. Extend it to:

- **Long-press on player unit:** Show inspection panel (existing behavior)
- **Long-press on enemy unit:** Show inspection panel + enemy movement/attack range (currently right-click only)
- **Long-press on empty tile:** Show terrain info (if not already shown by inspection panel)

This is a small change in BattleScene's `startTouchInspectHold()` handler.

---

## Button Design

### Size
- **Minimum 48x48 CSS pixels** per button (exceeds Apple's 44pt HIG minimum)
- Buttons fill available panel width with 8px padding between
- Text labels below icons, 11px font

### Visual Style
- Semi-transparent dark background (`rgba(0, 0, 0, 0.7)`)
- White icon/text, 1px border (`rgba(255, 255, 255, 0.3)`)
- Active/pressed state: brighter border + slight scale (`transform: scale(0.95)`)
- Rounded corners (4px) to match pixel-art aesthetic without over-designing
- No pixel-art rendering needed — clean/minimal is fine for overlay controls

### Opacity
- Full opacity when interactable
- 50% opacity when disabled/unavailable
- Smooth CSS transitions (150ms)

---

## Implementation Architecture

### HTML Structure

```html
<!-- Added alongside existing #game-container -->
<div id="mobile-controls" style="display: none;">
  <div id="mobile-left-panel">
    <button data-action="cancel" class="mobile-btn">
      <span class="mobile-btn-icon">✕</span>
      <span class="mobile-btn-label">Cancel</span>
    </button>
    <button data-action="menu" class="mobile-btn">
      <span class="mobile-btn-icon">☰</span>
      <span class="mobile-btn-label">Menu</span>
    </button>
  </div>
  <div id="mobile-right-panel">
    <!-- Populated dynamically by MobileControls.js -->
  </div>
</div>
```

### CSS Layout

```css
/* Wrapper becomes flex container */
#game-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
}

#mobile-left-panel, #mobile-right-panel {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;  /* Buttons anchored to bottom */
  gap: 8px;
  padding: 8px;
  padding-bottom: env(safe-area-inset-bottom, 8px);
  width: 80px;
}

/* Hide on desktop */
@media (pointer: fine) {
  #mobile-controls { display: none !important; }
}

/* Portrait orientation prompt */
@media (orientation: portrait) {
  #mobile-controls { display: none; }
  #rotate-prompt { display: flex; }
}
```

### JavaScript Bridge: `MobileControls.js`

New utility module (not a Phaser scene — pure DOM).

```
src/utils/MobileControls.js
```

**Responsibilities:**
1. Create/manage DOM button elements
2. Listen for button taps → emit Phaser game events
3. Receive state updates from scenes → show/hide/enable buttons
4. Detect mobile → show/hide entire overlay

**Bridge pattern:**

```javascript
// MobileControls.js emits events on the Phaser game instance:
game.events.emit('mobile:cancel');
game.events.emit('mobile:menu');
game.events.emit('mobile:endTurn');
game.events.emit('mobile:danger');
game.events.emit('mobile:roster');
game.events.emit('mobile:objective');
game.events.emit('mobile:inspect');
game.events.emit('mobile:prevTab');
game.events.emit('mobile:nextTab');
game.events.emit('mobile:prevWeapon');
game.events.emit('mobile:nextWeapon');

// Scenes update visible buttons:
game.events.emit('mobile:setContext', {
  context: 'battle_idle',  // or 'battle_selected', 'loot', 'nodemap', etc.
});
```

Each scene calls `game.events.emit('mobile:setContext', ...)` in its state transitions. `MobileControls.js` swaps the right panel buttons accordingly.

**Lifecycle:**
- Created once in `main.js` after Phaser game instance boots (only if `isMobile`)
- Persists across scene transitions (DOM element, not Phaser object)
- Scenes register listeners in `create()`, remove in `shutdown`

### Scene Integration Points

Each scene needs minimal changes — just emit context events at state transitions and listen for mobile events.

**BattleScene:**
- `create()` → register `mobile:*` event listeners alongside existing keyboard listeners
- State transitions → emit `mobile:setContext` with current state
- `shutdown` → remove listeners
- ~30 lines of new code (listener registration + context emissions)

**NodeMapScene:**
- `create()` → register `mobile:roster` listener, emit context
- ~10 lines

**HomeBaseScene:**
- `create()` → emit context (no right-panel buttons needed)
- ~5 lines

**Tabbed overlays (UnitInspectionPanel, HelpOverlay, HowToPlayOverlay):**
- `show()` → emit context with tab arrows
- `hide()` → emit previous context
- ~10 lines each

---

## Landscape Enforcement

### Web approach (no native lock available)

1. **CSS `@media (orientation: portrait)`** — show a "Rotate your device" overlay
2. **Screen Orientation API** — `screen.orientation.lock('landscape')` where supported (Chrome Android supports it; Safari does not without user gesture from fullscreen)
3. **Fullscreen prompt on mobile** — tapping the rotate prompt requests fullscreen + landscape lock

```html
<div id="rotate-prompt" style="display: none;">
  <p>↻ Rotate your device to landscape</p>
</div>
```

This is a soft enforcement — we can't force orientation on all mobile browsers, but the prompt is clear.

---

## Menu Touch Target Improvements

Separate from the virtual controls, improve existing in-canvas menu usability:

1. **`_makeMenuTextButton` hitHeight:** Increase from 28px to 40px on mobile (detected via `isMobileInput`)
2. **Action menu width:** Increase minimum width to 140px on mobile for easier tapping
3. **Loot card tap targets:** Ensure full card area is tappable, not just text
4. **Shop item rows:** Increase row height on mobile

These are small changes within existing BattleScene/NodeMapScene code, gated by `this.isMobileInput`.

---

## Orientation Prompt Dismissal

When the user rotates to landscape:
- Prompt fades out (200ms CSS transition)
- Game canvas becomes visible
- Mobile controls appear
- Any `screen.orientation.lock()` request fires

---

## Testing Plan

### Device Matrix

| Device | Browser | Priority |
|--------|---------|----------|
| iPhone 13 | Safari | High |
| iPhone 15 Pro | Safari | High |
| Galaxy S21 | Chrome | High |
| Pixel 7 | Chrome | Medium |
| Galaxy S24 | Chrome | Medium |
| iPhone SE (3rd gen) | Safari | Medium (small screen edge case) |

### Test Scenarios

1. **Full battle run without keyboard** — select units, attack, heal, use items, end turn, loot
2. **Cancel flow** — Cancel button deselects unit, closes menus, backs out of attack confirm
3. **Menu button** — opens pause overlay from any state
4. **Context switching** — right panel updates correctly when entering/exiting battles, loot screens, node map
5. **Long-press enemy** — shows inspection + range
6. **Tab navigation** — prev/next buttons cycle inspection panel tabs, help pages
7. **Weapon switching** — prev/next weapon during attack confirmation
8. **Landscape enforcement** — rotate prompt shown in portrait, hidden in landscape
9. **Desktop hidden** — no mobile controls visible on desktop browsers
10. **Safe areas** — buttons not obscured by notch/Dynamic Island on iPhone
11. **Large-map readability** — on active late-game map sizes (post row-trim), control labels remain readable and not visually merged with map tiles

### Acceptance Criteria

- [ ] All 11 keyboard shortcuts have touch equivalents
- [ ] Can complete a full run (Home Base → battles → boss → run complete) without keyboard
- [ ] All touch targets ≥ 48x48 CSS pixels
- [ ] Controls hidden on desktop (pointer: fine)
- [ ] Landscape rotation prompt shown in portrait
- [ ] No performance regression on mobile (already runs with reducedEffects)
- [ ] No visual overlap between controls and game canvas

---

## Effort Estimate

| Task | Estimate |
|------|----------|
| HTML/CSS layout (panels, buttons, responsive) | 2-3 hours |
| MobileControls.js (DOM management, event bridge) | 3-4 hours |
| BattleScene integration (listeners + context emissions) | 3-4 hours |
| NodeMapScene / HomeBase / overlay integration | 2-3 hours |
| Long-press enhancement (enemy range) | 1 hour |
| Menu touch target improvements | 1-2 hours |
| Landscape prompt | 1 hour |
| Testing across device matrix | 3-4 hours |
| **Total** | **~16-21 hours** |

---

## Future Considerations

- **Capacitor wrapping:** HTML overlay approach works identically in Capacitor's WKWebView — no changes needed. Landscape lock becomes native (`info.plist`).
- **Electron/Steam:** Controls hidden on desktop automatically. No changes needed.
- **Resolution bump:** If 640x480 proves too small even in landscape, bump to 960x640 as a separate initiative. The virtual controls spec is independent of canvas resolution.
- **Haptic feedback:** If wrapped natively, can add vibration on button press (via Capacitor Haptics plugin).
- **Customizable layout:** Could later let users drag-reposition panels or adjust button size. Not needed for v1.
- **iPad:** Landscape layout works fine; panels may be unnecessarily wide. Could scale button size up and reduce panel count. Low priority.
- **Battle HUD overlap parity:** Canvas HUD readability now tracks the "row-trim first, HUD fallback second" approach in `docs/specs/act4_boss_map_followup_spec.md`; mobile overlay implementation should keep controls outside map content by design.

---

## Open Questions

None — all decisions resolved. Ready for implementation.
