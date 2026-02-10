// DebugOverlay — Dev-only panel for playtesting (toggled with backtick key)
// Gated behind DEBUG_MODE from debugMode.js — never instantiated in production.

import { debugState } from '../utils/debugMode.js';
import { gainExperience } from '../engine/UnitManager.js';

export class DebugOverlay {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.visible = false;
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    this.hide();
    this.visible = true;

    const isBattle = this.scene.scene.key === 'Battle';
    const panelX = 8;
    const panelY = 50;
    const panelW = 160;
    const btnH = 22;
    const pad = 4;

    // Collect buttons based on scene
    const buttons = isBattle ? this._battleButtons() : this._nodeMapButtons();
    const panelH = 30 + buttons.length * (btnH + pad) + pad;

    // Semi-transparent dark panel
    const bg = this.scene.add.rectangle(panelX + panelW / 2, panelY + panelH / 2, panelW, panelH, 0x1a0000, 0.9)
      .setDepth(950).setStrokeStyle(1, 0xcc3333).setInteractive();
    this.objects.push(bg);

    // Header
    const header = this.scene.add.text(panelX + panelW / 2, panelY + 12, 'DEBUG', {
      fontFamily: 'monospace', fontSize: '12px', color: '#ff4444', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(951);
    this.objects.push(header);

    // Buttons
    let btnY = panelY + 28;
    for (const { label, onClick, getLabel } of buttons) {
      const displayLabel = getLabel ? getLabel() : label;
      const btn = this.scene.add.text(panelX + pad, btnY, displayLabel, {
        fontFamily: 'monospace', fontSize: '10px', color: '#e0e0e0',
        backgroundColor: '#333333', padding: { x: 6, y: 3 },
        fixedWidth: panelW - pad * 2,
      }).setDepth(951).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor('#e0e0e0'));
      btn.on('pointerdown', () => {
        onClick();
        // Refresh button labels (e.g. invincible toggle)
        if (getLabel) btn.setText(getLabel());
      });
      if (getLabel) btn._getLabel = getLabel;
      this.objects.push(btn);
      btnY += btnH + pad;
    }
  }

  hide() {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
  }

  // --- Toast notification ---
  _toast(msg) {
    const t = this.scene.add.text(
      this.scene.cameras.main.centerX, 60, msg,
      { fontFamily: 'monospace', fontSize: '12px', color: '#ff8888', backgroundColor: '#000000cc', padding: { x: 8, y: 4 } }
    ).setOrigin(0.5).setDepth(999);
    this.scene.tweens.add({ targets: t, alpha: 0, delay: 1200, duration: 400, onComplete: () => t.destroy() });
  }

  // --- BattleScene buttons ---
  _battleButtons() {
    const scene = this.scene;
    return [
      {
        label: 'Win Battle',
        onClick: () => {
          if (scene.battleState !== 'PLAYER_IDLE') {
            this._toast('Wait for Player Phase');
            return;
          }
          // Kill all enemies — splice in reverse to avoid index issues
          const enemies = [...scene.enemyUnits];
          for (const e of enemies) {
            scene.removeUnitGraphic(e);
            const idx = scene.enemyUnits.indexOf(e);
            if (idx !== -1) scene.enemyUnits.splice(idx, 1);
          }
          scene.dangerZoneStale = true;
          scene.updateObjectiveText();
          scene.checkBattleEnd();
          this.hide();
        },
      },
      {
        label: 'Heal All',
        onClick: () => {
          for (const u of scene.playerUnits) {
            u.currentHP = u.stats.HP;
            scene.updateHPBar(u);
          }
          this._toast('All units healed');
        },
      },
      {
        label: '+1000 Gold',
        onClick: () => {
          if (!scene.runManager) { this._toast('No run active'); return; }
          scene.runManager.addGold(1000);
          this._toast(`Gold: ${scene.runManager.gold}`);
        },
      },
      {
        label: 'Level Up Selected',
        onClick: () => {
          const unit = scene.selectedUnit;
          if (!unit || unit.faction !== 'player') {
            this._toast('Select a player unit first');
            return;
          }
          const xpNeeded = 100 - unit.xp;
          gainExperience(unit, xpNeeded, scene.gameData.classes, scene.gameData.skills);
          scene.updateHPBar(unit);
          this._toast(`${unit.name} → Lv ${unit.level}`);
        },
      },
      {
        getLabel: () => debugState.invincible ? 'Invincible: ON' : 'Invincible: OFF',
        onClick: () => {
          debugState.invincible = !debugState.invincible;
          this._toast(debugState.invincible ? 'Invincible ON' : 'Invincible OFF');
        },
      },
      {
        label: 'Skip Enemy Phase',
        onClick: () => {
          scene._debugSkipEnemyPhase = true;
          this._toast('Enemy phase will be skipped');
        },
      },
    ];
  }

  // --- NodeMapScene buttons ---
  _nodeMapButtons() {
    const scene = this.scene;
    return [
      {
        label: '+1000 Gold',
        onClick: () => {
          scene.runManager.addGold(1000);
          scene.drawMap();
          this.show(); // redraw debug panel after drawMap clears children
          this._toast(`Gold: ${scene.runManager.gold}`);
        },
      },
      {
        label: 'Jump to Act 2',
        onClick: () => this._jumpToAct(1),
      },
      {
        label: 'Jump to Act 3',
        onClick: () => this._jumpToAct(2),
      },
      {
        label: 'Jump to Final Boss',
        onClick: () => this._jumpToAct(3),
      },
      {
        label: 'Complete Next Node',
        onClick: () => {
          const rm = scene.runManager;
          const available = rm.getAvailableNodes();
          if (available.length === 0) {
            this._toast('No available nodes');
            return;
          }
          // Complete the first available node
          const node = available[0];
          rm.markNodeComplete(node.id);
          scene.drawMap();
          this.show();
          this._toast(`Completed: ${node.type} node`);
        },
      },
      {
        label: 'Max Roster Levels',
        onClick: () => {
          const rm = scene.runManager;
          for (const unit of rm.roster) {
            while (unit.level < 20) {
              const xpNeeded = 100 - unit.xp;
              gainExperience(unit, xpNeeded, scene.gameData.classes, scene.gameData.skills);
            }
          }
          scene.drawMap();
          this.show();
          this._toast('All units → Lv 20');
        },
      },
    ];
  }

  _jumpToAct(targetActIndex) {
    const scene = this.scene;
    const rm = scene.runManager;
    while (rm.actIndex < targetActIndex) {
      rm.advanceAct();
    }
    scene.drawMap();
    this.show();
    this._toast(`Jumped to Act ${rm.actIndex + 1}`);
  }
}
