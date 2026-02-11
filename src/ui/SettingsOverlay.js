// SettingsOverlay — Reusable SNES-style settings panel (volume controls)
// Follows StatPanel show()/hide() pattern with this.objects[].

export class SettingsOverlay {
  constructor(scene, onClose) {
    this.scene = scene;
    this.onClose = onClose;
    this.objects = [];
    this.visible = false;
  }

  show() {
    this.hide();
    this.visible = true;

    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;

    // Dark background
    const bg = this.scene.add.rectangle(cx, cy, 640, 480, 0x000000, 0.85)
      .setDepth(900).setInteractive();
    this.objects.push(bg);

    // Panel
    const panel = this.scene.add.rectangle(cx, cy, 300, 250, 0x1a1a2e, 1)
      .setDepth(901).setStrokeStyle(2, 0x888888);
    this.objects.push(panel);

    // Title
    const title = this.scene.add.text(cx, cy - 96, 'Settings', {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(902);
    this.objects.push(title);

    const settings = this.scene.registry.get('settings');
    const audio = this.scene.registry.get('audio');

    // Music volume row
    this._addVolumeRow(cx, cy - 46, 'Music', settings.getMusicVolume(), (val) => {
      settings.setMusicVolume(val);
      if (audio) audio.setMusicVolume(val);
    });

    // SFX volume row
    this._addVolumeRow(cx, cy + 4, 'SFX', settings.getSFXVolume(), (val) => {
      settings.setSFXVolume(val);
      if (audio) {
        audio.setSFXVolume(val);
        audio.playSFX('sfx_confirm');
      }
    });

    this._addToggleRow(cx, cy + 54, 'Reduced Effects', settings.getReducedEffects?.() ?? false, (enabled) => {
      if (settings?.setReducedEffects) settings.setReducedEffects(enabled);
    });

    // Close button
    const closeBtn = this.scene.add.text(cx, cy + 96, '[ Close ]', {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(902).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffdd44'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#e0e0e0'));
    closeBtn.on('pointerdown', () => this.hide());
    this.objects.push(closeBtn);
  }

  _addVolumeRow(cx, y, label, initialValue, onChange) {
    let value = Math.round(initialValue * 100);

    const labelText = this.scene.add.text(cx - 100, y, label, {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
    }).setOrigin(0, 0.5).setDepth(902);
    this.objects.push(labelText);

    const valText = this.scene.add.text(cx + 20, y, `${value}%`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
    }).setOrigin(0.5, 0.5).setDepth(902);
    this.objects.push(valText);

    const update = (delta) => {
      value = Math.max(0, Math.min(100, value + delta));
      valText.setText(`${value}%`);
      onChange(value / 100);
    };

    // Left arrow
    const leftBtn = this.scene.add.text(cx - 20, y, '\u25C0', {
      fontFamily: 'monospace', fontSize: '16px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(902).setInteractive({ useHandCursor: true });
    leftBtn.on('pointerover', () => leftBtn.setColor('#ffdd44'));
    leftBtn.on('pointerout', () => leftBtn.setColor('#aaaaaa'));
    leftBtn.on('pointerdown', () => update(-10));
    this.objects.push(leftBtn);

    // Right arrow
    const rightBtn = this.scene.add.text(cx + 60, y, '\u25B6', {
      fontFamily: 'monospace', fontSize: '16px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(902).setInteractive({ useHandCursor: true });
    rightBtn.on('pointerover', () => rightBtn.setColor('#ffdd44'));
    rightBtn.on('pointerout', () => rightBtn.setColor('#aaaaaa'));
    rightBtn.on('pointerdown', () => update(10));
    this.objects.push(rightBtn);
  }

  _addToggleRow(cx, y, label, initialValue, onChange) {
    let value = !!initialValue;

    const labelText = this.scene.add.text(cx - 102, y, label, {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
    }).setOrigin(0, 0.5).setDepth(902);
    this.objects.push(labelText);

    const valueText = this.scene.add.text(cx + 72, y, value ? 'ON' : 'OFF', {
      fontFamily: 'monospace', fontSize: '14px', color: value ? '#88ff88' : '#ff8888',
    }).setOrigin(0.5, 0.5).setDepth(902);
    this.objects.push(valueText);

    const update = (delta) => {
      value = delta === 0 ? !value : delta > 0;
      valueText.setText(value ? 'ON' : 'OFF');
      valueText.setColor(value ? '#88ff88' : '#ff8888');
      onChange(value);
    };

    const leftBtn = this.scene.add.text(cx + 30, y, '\u25C0', {
      fontFamily: 'monospace', fontSize: '16px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(902).setInteractive({ useHandCursor: true });
    leftBtn.on('pointerover', () => leftBtn.setColor('#ffdd44'));
    leftBtn.on('pointerout', () => leftBtn.setColor('#aaaaaa'));
    leftBtn.on('pointerdown', () => update(-1));
    this.objects.push(leftBtn);

    const rightBtn = this.scene.add.text(cx + 114, y, '\u25B6', {
      fontFamily: 'monospace', fontSize: '16px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(902).setInteractive({ useHandCursor: true });
    rightBtn.on('pointerover', () => rightBtn.setColor('#ffdd44'));
    rightBtn.on('pointerout', () => rightBtn.setColor('#aaaaaa'));
    rightBtn.on('pointerdown', () => update(1));
    this.objects.push(rightBtn);
  }

  hide() {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (this.onClose) this.onClose();
  }
}
