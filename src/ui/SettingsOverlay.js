import { BATTLE_SPEEDS } from '../utils/combatTiming.js';
import { resolveAtmosphereMode } from '../art/atmosphereConfig.js';
import { detectMobileRuntime } from '../utils/runtimeFlags.js';
import { SettingsMenu } from './SettingsMenu.js';
import { hasDOMHost } from '../utils/domUI.js';
import { UI_PALETTE, UI_HEX, applyTextResolution } from '../utils/uiStyles.js';
// SettingsOverlay — Reusable SNES-style settings panel (volume controls)
// Follows StatPanel show()/hide() pattern with this.objects[].

import { BoundingFocusController } from './BoundingFocusController.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';

export class SettingsOverlay {
  constructor(scene, onClose) {
    this.scene = scene;
    this.onClose = onClose;
    this.objects = [];
    this.visible = false;

    // Gamepad/keyboard focus: a ring over the rows (Music / SFX / Reduced Effects /
    // Close). The overlay pushes one input-focus scope (LIFO) on show and pops it on
    // hide, so the pad drives it on top of whatever opened it (Pause/Title/NodeMap/
    // loot). d-pad up/down move the ring; left/right adjust the focused control; A
    // activates (flip a toggle / press Close); B/Start close.
    this._focus = null;
    this._focusIndex = 0;
    this._rows = []; // [{ focus, adjust(dir), activate() }] in reading order
    this._onInputBound = null;
  }

  show() {
    this.hide();
    this.visible = true;
    if (hasDOMHost()) {
      this.domMenu = new SettingsMenu(this.scene, () => this.hide());
      return;
    }

    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;

    // Dark background
    const bg = this.scene.add
      .rectangle(cx, cy, 640, 480, 0x000000, 0.85)
      .setDepth(900)
      .setInteractive();
    this.objects.push(bg);

    // Panel
    const panel = this.scene.add
      .rectangle(cx, cy, 330, 370, UI_HEX.panel, 1)
      .setDepth(901)
      .setStrokeStyle(2, UI_HEX.line);
    this.objects.push(panel);

    // Title
    const title = applyTextResolution(
      this.scene.add.text(cx, cy - 156, 'Settings', {
        fontFamily: 'Arial',
        fontSize: '18px',
        color: UI_PALETTE.accent,
      }),
    )
      .setOrigin(0.5)
      .setDepth(902);
    this.objects.push(title);

    const settings = this.scene.registry.get('settings');
    const audio = this.scene.registry.get('audio');

    this._rows = [];

    // Music volume row
    this._rows.push(
      this._addVolumeRow(cx, cy - 118, 'Music', settings.getMusicVolume(), (val) => {
        settings.setMusicVolume(val);
        if (audio) audio.setMusicVolume(val);
      }),
    );

    // SFX volume row
    this._rows.push(
      this._addVolumeRow(cx, cy - 74, 'SFX', settings.getSFXVolume(), (val) => {
        settings.setSFXVolume(val);
        if (audio) {
          audio.setSFXVolume(val);
          audio.playSFX('sfx_confirm');
        }
      }),
    );

    this._rows.push(
      this._addToggleRow(
        cx,
        cy - 30,
        'Reduce Motion',
        settings.getReduceMotion?.() ?? false,
        (enabled) => {
          if (settings?.setReduceMotion) settings.setReduceMotion(enabled);
        },
      ),
    );

    this._rows.push(
      this._addToggleRow(
        cx,
        cy + 14,
        'Effects Quality',
        settings.getEffectsQuality?.() !== 'low',
        (high) => settings.setEffectsQuality?.(high ? 'high' : 'low'),
        ['LOW', 'HIGH'],
      ),
    );

    this._rows.push(
      this._addToggleRow(
        cx,
        cy + 58,
        'Battle Speed',
        Math.max(0, BATTLE_SPEEDS.indexOf(settings.getBattleSpeed?.())),
        (index) => settings.setBattleSpeed?.(BATTLE_SPEEDS[index]),
        ['NORMAL', 'FAST', 'INSTANT'],
      ),
    );

    const atmosphereModes = ['full', 'reduced', 'off'];
    const atmosphereNow = resolveAtmosphereMode(settings.getAtmosphere?.() || 'auto', {
      mobile: detectMobileRuntime(),
    }).mode;
    this._rows.push(
      this._addToggleRow(
        cx,
        cy + 102,
        'Atmosphere',
        Math.max(0, atmosphereModes.indexOf(atmosphereNow)),
        (index) => settings.setAtmosphere?.(atmosphereModes[index]),
        ['FULL', 'REDUCED', 'OFF'],
      ),
    );

    // Close button
    const closeBtn = applyTextResolution(
      this.scene.add.text(cx, cy + 156, '[ Close ]', {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.text,
        backgroundColor: UI_PALETTE.raised,
        padding: { x: 12, y: 6 },
      }),
    )
      .setOrigin(0.5)
      .setDepth(902)
      .setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor(UI_PALETTE.accent));
    closeBtn.on('pointerout', () => closeBtn.setColor(UI_PALETTE.text));
    closeBtn.on('pointerdown', () => this.hide());
    this.objects.push(closeBtn);
    this._rows.push({
      focus: closeBtn,
      adjust: () => {},
      activate: () => closeBtn.emit('pointerdown', { button: 0 }),
    });

    this._setupFocus();
  }

  // --- Gamepad/keyboard focus ---

  _setupFocus() {
    this._focus = new BoundingFocusController(this.scene, 905); // above content (902)
    this._focusIndex = 0;
    if (!this._onInputBound) {
      this._onInputBound = (action, payload) => this._onSettingsInput(action, payload);
    }
    pushInputScope(this, this._onInputBound);
    this._renderFocus();
  }

  _teardownFocus() {
    if (this._onInputBound) {
      popInputScope(this);
      this._onInputBound = null;
    }
    if (this._focus) {
      this._focus.destroy();
      this._focus = null;
    }
    this._rows = [];
  }

  _onSettingsInput(action, payload) {
    if (!this.visible) return;
    switch (action) {
      case InputAction.NAVIGATE:
        if (payload?.dy) this._moveFocus(payload.dy);
        else if (payload?.dx) this._adjustFocused(payload.dx); // ramps while held
        break;
      case InputAction.CONFIRM:
        this._rows[this._focusIndex]?.activate?.();
        break;
      case InputAction.CANCEL:
      case InputAction.PAUSE:
        this.hide();
        break;
    }
  }

  _moveFocus(delta) {
    const n = this._rows.length;
    if (!n || !delta) return;
    const dir = delta > 0 ? 1 : -1;
    this._focusIndex = Math.max(0, Math.min(n - 1, this._focusIndex + dir));
    this._renderFocus();
  }

  _adjustFocused(dx) {
    this._rows[this._focusIndex]?.adjust?.(dx);
  }

  _renderFocus() {
    if (!this._focus) return;
    const target = this._rows[this._focusIndex]?.focus || null;
    this._focus.setObjects(target ? [target] : [], true);
  }

  _addVolumeRow(cx, y, label, initialValue, onChange) {
    let value = Math.round(initialValue * 100);

    // Invisible full-row span so the gamepad ring highlights the whole control.
    const rowRect = this.scene.add.rectangle(cx, y, 250, 26, 0x000000, 0).setDepth(902);
    this.objects.push(rowRect);

    const labelText = applyTextResolution(
      this.scene.add.text(cx - 100, y, label, {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.text,
      }),
    )
      .setOrigin(0, 0.5)
      .setDepth(902);
    this.objects.push(labelText);

    const valText = applyTextResolution(
      this.scene.add.text(cx + 20, y, `${value}%`, {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.text,
      }),
    )
      .setOrigin(0.5, 0.5)
      .setDepth(902);
    this.objects.push(valText);

    const update = (delta) => {
      value = Math.max(0, Math.min(100, value + delta));
      valText.setText(`${value}%`);
      onChange(value / 100);
    };

    // Left arrow
    const leftBtn = applyTextResolution(
      this.scene.add.text(cx - 20, y, '\u25C0', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.muted,
      }),
    )
      .setOrigin(0.5)
      .setDepth(902)
      .setInteractive({ useHandCursor: true });
    leftBtn.on('pointerover', () => leftBtn.setColor(UI_PALETTE.accent));
    leftBtn.on('pointerout', () => leftBtn.setColor(UI_PALETTE.muted));
    leftBtn.on('pointerdown', () => update(-10));
    this.objects.push(leftBtn);

    // Right arrow
    const rightBtn = applyTextResolution(
      this.scene.add.text(cx + 60, y, '\u25B6', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.muted,
      }),
    )
      .setOrigin(0.5)
      .setDepth(902)
      .setInteractive({ useHandCursor: true });
    rightBtn.on('pointerover', () => rightBtn.setColor(UI_PALETTE.accent));
    rightBtn.on('pointerout', () => rightBtn.setColor(UI_PALETTE.muted));
    rightBtn.on('pointerdown', () => update(10));
    this.objects.push(rightBtn);

    // d-pad left/right step the slider; A is a no-op (nothing to "press").
    return { focus: rowRect, adjust: (dir) => update(dir > 0 ? 10 : -10), activate: () => {} };
  }

  _addToggleRow(cx, y, label, initialValue, onChange, values = ['OFF', 'ON']) {
    let value = values.length > 2 ? initialValue : !!initialValue;

    // Invisible full-row span so the gamepad ring highlights the whole control.
    const rowRect = this.scene.add.rectangle(cx, y, 250, 26, 0x000000, 0).setDepth(902);
    this.objects.push(rowRect);

    const labelText = applyTextResolution(
      this.scene.add.text(cx - 102, y, label, {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.text,
      }),
    )
      .setOrigin(0, 0.5)
      .setDepth(902);
    this.objects.push(labelText);

    const valueText = applyTextResolution(
      this.scene.add.text(cx + 72, y, values[Number(value)], {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: value ? UI_PALETTE.good : UI_PALETTE.bad,
      }),
    )
      .setOrigin(0.5, 0.5)
      .setDepth(902);
    this.objects.push(valueText);

    const update = (delta) => {
      value =
        values.length > 2
          ? (Number(value) + (delta < 0 ? -1 : 1) + values.length) % values.length
          : delta === 0
            ? !value
            : delta > 0;
      valueText.setText(values[Number(value)]);
      valueText.setColor(value ? UI_PALETTE.good : UI_PALETTE.bad);
      onChange(value);
    };

    const leftBtn = applyTextResolution(
      this.scene.add.text(cx + 30, y, '\u25C0', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.muted,
      }),
    )
      .setOrigin(0.5)
      .setDepth(902)
      .setInteractive({ useHandCursor: true });
    leftBtn.on('pointerover', () => leftBtn.setColor(UI_PALETTE.accent));
    leftBtn.on('pointerout', () => leftBtn.setColor(UI_PALETTE.muted));
    leftBtn.on('pointerdown', () => update(-1));
    this.objects.push(leftBtn);

    const rightBtn = applyTextResolution(
      this.scene.add.text(cx + 114, y, '\u25B6', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.muted,
      }),
    )
      .setOrigin(0.5)
      .setDepth(902)
      .setInteractive({ useHandCursor: true });
    rightBtn.on('pointerover', () => rightBtn.setColor(UI_PALETTE.accent));
    rightBtn.on('pointerout', () => rightBtn.setColor(UI_PALETTE.muted));
    rightBtn.on('pointerdown', () => update(1));
    this.objects.push(rightBtn);

    // d-pad left/right force OFF/ON; A flips the current value.
    return { focus: rowRect, adjust: (dir) => update(dir), activate: () => update(0) };
  }

  hide() {
    this.domMenu?.destroy();
    this.domMenu = null;
    const wasVisible = this.visible;
    this._teardownFocus();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (wasVisible && this.onClose) this.onClose();
  }
}
