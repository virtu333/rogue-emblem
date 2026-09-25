import { presentationText } from '../utils/presentationText.js';
import { hasDOMHost } from '../utils/domUI.js';
import { progressionResult } from './ProgressionMenus.js';
import { inputHint } from '../utils/inputHint.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
// LevelUpPopup.js — FE-style level-up stat gain popup
// Shows which stats gained +1 in green. Click to dismiss.

import { XP_STAT_NAMES } from '../utils/constants.js';
import { STAT_COLORS, UI_PALETTE, UI_HEX } from '../utils/uiStyles.js';

export class LevelUpPopup {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} unit - unit that leveled up
   * @param {object} levelUpResult - { gains: {HP:1,...}, newLevel: 3 }
   * @param {boolean} isPromotion - if true, shows "PROMOTION" title instead of level-up
   * @param {string[]} learnedSkills - names of skills learned this level-up
   * @param {object} [growthBonuses] - optional {stat: bonus%} from promoted class
   */
  constructor(
    scene,
    unit,
    levelUpResult,
    isPromotion = false,
    learnedSkills = [],
    growthBonuses = null,
  ) {
    this.scene = scene;
    this.unit = unit;
    this.levelUpResult = levelUpResult;
    this.isPromotion = isPromotion;
    this.learnedSkills = learnedSkills;
    this.growthBonuses = growthBonuses;
    this.objects = [];
  }

  /**
   * Show the popup. Returns a Promise that resolves when dismissed.
   * Always resolves: destroy() (including via scene shutdown) settles the
   * promise so awaiting callers can never hang on a popup that no longer
   * exists.
   */
  show() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      if (hasDOMHost()) {
        this._onSceneShutdown = () => this.destroy();
        this.scene.events?.once?.('shutdown', this._onSceneShutdown);
        // Level-ups are a ceremony card: portrait, crest, ember pips, and a
        // beat of their own for perfect or lean levels. Promotions have the rite.
        const growth = this.isPromotion ? null : growthCeremonies(this.scene);
        if (growth) {
          this._growthHandle = {};
          void growth
            .showLevelUp({
              unit: this.unit,
              result: this.levelUpResult,
              learnedNames: this.learnedSkills,
              handle: this._growthHandle,
            })
            .then(
              () => this.destroy(),
              () => this.destroy(),
            );
          return;
        }
        this.surface = progressionResult(
          this.scene,
          this.unit,
          this.levelUpResult,
          this.isPromotion,
          this.learnedSkills,
          this.growthBonuses,
          () => this.destroy(),
        );
        return;
      }
      const cam = this.scene.cameras.main;
      const cx = cam.width / 2;
      const cy = cam.height / 2;

      const gains = this.levelUpResult.gains;

      // Compute display-friendly level strings (extended: "20+N")
      let oldLevelStr, newLevelStr;
      if (this.levelUpResult.isExtended) {
        const extLv = this.levelUpResult.extendedLevel;
        newLevelStr = `20+${extLv}`;
        oldLevelStr = extLv - 1 === 0 ? '20' : `20+${extLv - 1}`;
      } else {
        oldLevelStr = String(this.levelUpResult.newLevel - 1);
        newLevelStr = String(this.levelUpResult.newLevel);
      }

      // Build text lines
      const lines = [];
      lines.push(`  LEVEL UP!  Lv ${oldLevelStr} → Lv ${newLevelStr}`);
      lines.push('');

      const statLines = [];
      for (const stat of XP_STAT_NAMES) {
        const val = (this.levelUpResult.displayStats || this.unit.stats)[stat];
        const gained = gains[stat] || 0;
        const label = stat.padEnd(4);
        if (gained > 0) {
          statLines.push({
            text: `  ${label} ${String(val).padStart(3)}  +${gained}`,
            gained: true,
          });
        } else {
          statLines.push({ text: `  ${label} ${String(val).padStart(3)}`, gained: false });
        }
      }

      // Growth bonus lines (promotion only)
      const growthLines = [];
      if (this.growthBonuses) {
        for (const [stat, val] of Object.entries(this.growthBonuses)) {
          growthLines.push(`  +${val}% ${stat} Growth`);
        }
      }

      // Panel dimensions
      const lineHeight = 18;
      const panelWidth = 260;
      const skillLineCount = this.learnedSkills.length > 0 ? this.learnedSkills.length + 1 : 0;
      const growthLineCount = growthLines.length > 0 ? growthLines.length + 1 : 0;
      const panelHeight =
        (statLines.length + 4 + skillLineCount + growthLineCount) * lineHeight + 16;

      // Dim background
      const dimBg = this.scene.add
        .rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0.4)
        .setDepth(900)
        .setInteractive();
      this.objects.push(dimBg);

      // Panel background
      const bg = this.scene.add
        .rectangle(cx, cy, panelWidth, panelHeight, UI_HEX.panel, 0.95)
        .setDepth(901)
        .setStrokeStyle(2, UI_HEX.line);
      this.objects.push(bg);

      // Title
      let y = cy - panelHeight / 2 + 14;
      const titleStr = this.isPromotion
        ? `PROMOTION!  ${this.unit.className}`
        : `LEVEL UP!  Lv ${oldLevelStr} → Lv ${newLevelStr}`;
      const titleColor = this.isPromotion ? UI_PALETTE.info : UI_PALETTE.accentText;
      const title = presentationText(this.scene, cx, y, titleStr, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: titleColor,
        fontStyle: 'bold',
      })
        .setOrigin(0.5, 0)
        .setDepth(902);
      this.objects.push(title);
      y += lineHeight + 6;

      // Stat lines with color coding
      const statNames = [...XP_STAT_NAMES];
      for (let si = 0; si < statLines.length; si++) {
        const sl = statLines[si];
        const stat = statNames[si];
        const color = sl.gained ? UI_PALETTE.good : STAT_COLORS[stat] || UI_PALETTE.text;
        const text = presentationText(this.scene, cx - panelWidth / 2 + 12, y, sl.text, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color,
        })
          .setOrigin(0, 0)
          .setDepth(902);
        this.objects.push(text);
        y += lineHeight;
      }

      // Growth bonuses (promotion only)
      if (growthLines.length > 0) {
        y += 4;
        for (const gl of growthLines) {
          const growthText = presentationText(this.scene, cx - panelWidth / 2 + 12, y, gl, {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: UI_PALETTE.info,
          })
            .setOrigin(0, 0)
            .setDepth(902);
          this.objects.push(growthText);
          y += lineHeight;
        }
      }

      // Learned skills
      if (this.learnedSkills.length > 0) {
        y += 4;
        for (const skillName of this.learnedSkills) {
          const skillText = presentationText(
            this.scene,
            cx - panelWidth / 2 + 12,
            y,
            `  NEW SKILL: ${skillName}`,
            {
              fontFamily: 'monospace',
              fontSize: '12px',
              color: UI_PALETTE.info,
              fontStyle: 'bold',
            },
          )
            .setOrigin(0, 0)
            .setDepth(902);
          this.objects.push(skillText);
          y += lineHeight;
        }
      }

      // Dismiss hint
      y += 6;
      const hint = presentationText(
        this.scene,
        cx,
        y,
        inputHint(this.scene, '(click to continue)', '(tap to continue)'),
        {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: UI_PALETTE.muted,
        },
      )
        .setOrigin(0.5, 0)
        .setDepth(902);
      this.objects.push(hint);

      // Hook shutdown only after the popup built successfully -- a throw
      // above (e.g. dead scene) must not leave a stale listener behind.
      this._onSceneShutdown = () => this.destroy();
      this.scene.events?.once?.('shutdown', this._onSceneShutdown);

      // Click to dismiss
      dimBg.once('pointerdown', () => {
        this.destroy();
      });
    });
  }

  destroy() {
    this.surface?.destroy();
    this.surface = null;
    const growthHandle = this._growthHandle;
    this._growthHandle = null;
    growthHandle?.cancel?.();
    if (this._onSceneShutdown) {
      this.scene?.events?.off?.('shutdown', this._onSceneShutdown);
      this._onSceneShutdown = null;
    }
    for (const obj of this.objects) {
      obj.destroy();
    }
    this.objects = [];
    const resolve = this._resolve;
    this._resolve = null;
    if (resolve) resolve();
  }
}
