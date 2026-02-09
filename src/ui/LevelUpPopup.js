// LevelUpPopup.js — FE-style level-up stat gain popup
// Shows which stats gained +1 in green. Click to dismiss.

import { XP_STAT_NAMES } from '../utils/constants.js';
import { STAT_COLORS } from '../utils/uiStyles.js';

export class LevelUpPopup {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} unit - unit that leveled up
   * @param {object} levelUpResult - { gains: {HP:1,...}, newLevel: 3 }
   * @param {boolean} isPromotion - if true, shows "PROMOTION" title instead of level-up
   * @param {string[]} learnedSkills - names of skills learned this level-up
   */
  constructor(scene, unit, levelUpResult, isPromotion = false, learnedSkills = []) {
    this.scene = scene;
    this.unit = unit;
    this.levelUpResult = levelUpResult;
    this.isPromotion = isPromotion;
    this.learnedSkills = learnedSkills;
    this.objects = [];
  }

  /** Show the popup. Returns a Promise that resolves when dismissed. */
  show() {
    return new Promise(resolve => {
      const cam = this.scene.cameras.main;
      const cx = cam.width / 2;
      const cy = cam.height / 2;

      const oldLevel = this.levelUpResult.newLevel - 1;
      const newLevel = this.levelUpResult.newLevel;
      const gains = this.levelUpResult.gains;

      // Build text lines
      const lines = [];
      lines.push(`  LEVEL UP!  Lv ${oldLevel} → Lv ${newLevel}`);
      lines.push('');

      const statLines = [];
      for (const stat of XP_STAT_NAMES) {
        const val = this.unit.stats[stat];
        const gained = gains[stat] || 0;
        const label = stat.padEnd(4);
        if (gained > 0) {
          statLines.push({ text: `  ${label} ${String(val).padStart(3)}  +${gained}`, gained: true });
        } else {
          statLines.push({ text: `  ${label} ${String(val).padStart(3)}`, gained: false });
        }
      }

      // Panel dimensions
      const lineHeight = 18;
      const panelWidth = 200;
      const skillLineCount = this.learnedSkills.length > 0 ? this.learnedSkills.length + 1 : 0;
      const panelHeight = (statLines.length + 4 + skillLineCount) * lineHeight + 16;

      // Dim background
      const dimBg = this.scene.add.rectangle(
        cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0.4
      ).setDepth(900).setInteractive();
      this.objects.push(dimBg);

      // Panel background
      const bg = this.scene.add.rectangle(
        cx, cy, panelWidth, panelHeight, 0x111122, 0.95
      ).setDepth(901).setStrokeStyle(2, 0x4466aa);
      this.objects.push(bg);

      // Title
      let y = cy - panelHeight / 2 + 14;
      const titleStr = this.isPromotion
        ? `PROMOTION!  ${this.unit.className}`
        : `LEVEL UP!  Lv ${oldLevel} → Lv ${newLevel}`;
      const titleColor = this.isPromotion ? '#88ffff' : '#ffdd44';
      const title = this.scene.add.text(cx, y, titleStr, {
        fontFamily: 'monospace', fontSize: '13px', color: titleColor, fontStyle: 'bold',
      }).setOrigin(0.5, 0).setDepth(902);
      this.objects.push(title);
      y += lineHeight + 6;

      // Stat lines with color coding
      const statNames = [...XP_STAT_NAMES];
      for (let si = 0; si < statLines.length; si++) {
        const sl = statLines[si];
        const stat = statNames[si];
        const color = sl.gained ? '#44ff44' : (STAT_COLORS[stat] || '#cccccc');
        const text = this.scene.add.text(cx - panelWidth / 2 + 12, y, sl.text, {
          fontFamily: 'monospace', fontSize: '12px', color,
        }).setOrigin(0, 0).setDepth(902);
        this.objects.push(text);
        y += lineHeight;
      }

      // Learned skills
      if (this.learnedSkills.length > 0) {
        y += 4;
        for (const skillName of this.learnedSkills) {
          const skillText = this.scene.add.text(cx - panelWidth / 2 + 12, y, `  NEW SKILL: ${skillName}`, {
            fontFamily: 'monospace', fontSize: '12px', color: '#88ffff', fontStyle: 'bold',
          }).setOrigin(0, 0).setDepth(902);
          this.objects.push(skillText);
          y += lineHeight;
        }
      }

      // Dismiss hint
      y += 6;
      const hint = this.scene.add.text(cx, y, '(click to continue)', {
        fontFamily: 'monospace', fontSize: '10px', color: '#888888',
      }).setOrigin(0.5, 0).setDepth(902);
      this.objects.push(hint);

      // Click to dismiss
      dimBg.once('pointerdown', () => {
        this.destroy();
        resolve();
      });
    });
  }

  destroy() {
    for (const obj of this.objects) {
      obj.destroy();
    }
    this.objects = [];
  }
}
