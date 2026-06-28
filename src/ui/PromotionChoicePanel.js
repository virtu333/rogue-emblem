// PromotionChoicePanel — Side-by-side promotion choice overlay
// Used by BattleScene, NodeMapScene (church), and RosterOverlay

import { XP_STAT_NAMES } from '../utils/constants.js';
import { STAT_COLORS, UI_COLORS } from '../utils/uiStyles.js';
import { getClassInnateSkills } from '../engine/UnitManager.js';
import { consumeEscEvent } from '../utils/escPriority.js';
import { pushOverlay, removeOverlay, isTopOverlay } from '../utils/overlayStack.js';
import { BoundingFocusController } from './BoundingFocusController.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';

const DEPTH_DIM = 850;
const DEPTH_PANEL = 851;
const DEPTH_TEXT = 852;

const LINE_H = 16;
const COL_W = 180;
const COL_GAP = 12;
const PANEL_PAD = 14;
const FONT = 'monospace';

export class PromotionChoicePanel {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} unit - unit being promoted
   * @param {object[]} targets - 2-element array of promoted class data
   * @param {object[]} skillsData - full skills.json array
   */
  constructor(scene, unit, targets, skillsData) {
    this.scene = scene;
    this.unit = unit;
    this.targets = targets;
    this.skillsData = skillsData;
    this.objects = [];
    this._scenePromotionChoiceGuardRegistered = false;
    // Gamepad focus: a ring over the two "Select" buttons.
    this._selectButtons = [];
    this._focus = null;
    this._onInputActionBound = null;
  }

  /**
   * Show the panel. Returns Promise that resolves to selected class data or null (cancel).
   * @returns {Promise<object|null>}
   */
  show() {
    return new Promise((resolve) => {
      this._resolve = resolve;
      this._registerScenePromotionChoiceGuard();
      this._build();
    });
  }

  _build() {
    const cam = this.scene.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    const unit = this.unit;

    // --- Compute column content for each target ---
    const columns = this.targets.map((cls) => this._buildColumnData(cls));
    const maxLines = Math.max(...columns.map((c) => c.lines.length));

    // Panel sizing
    const panelW = COL_W * 2 + COL_GAP + PANEL_PAD * 2;
    const headerH = LINE_H * 2 + 8; // title + unit name
    const bodyH = maxLines * LINE_H;
    const footerH = LINE_H * 2 + 12; // select buttons + cancel hint
    const panelH = headerH + bodyH + footerH + PANEL_PAD * 2;

    // Dim
    const dim = this.scene.add
      .rectangle(cam.width / 2, cam.height / 2, cam.width, cam.height, 0x000000, 0.5)
      .setDepth(DEPTH_DIM)
      .setInteractive();
    this.objects.push(dim);

    // Panel bg
    const bg = this.scene.add
      .rectangle(cx, cy, panelW, panelH, 0x111122, 0.95)
      .setDepth(DEPTH_PANEL)
      .setStrokeStyle(2, 0x4466aa);
    this.objects.push(bg);

    // --- Header ---
    let y = cy - panelH / 2 + PANEL_PAD;
    this._text(
      cx,
      y,
      'CHOOSE PROMOTION',
      {
        fontSize: '14px',
        color: '#88ffff',
        fontStyle: 'bold',
      },
      0.5,
    );
    y += LINE_H + 2;
    this._text(
      cx,
      y,
      `${unit.name} — ${unit.className}`,
      {
        fontSize: '11px',
        color: '#cccccc',
      },
      0.5,
    );
    y += LINE_H + 6;

    // --- Two columns ---
    const col1X = cx - COL_GAP / 2 - COL_W;
    const col2X = cx + COL_GAP / 2;

    // Divider line
    const divX = cx;
    const divTop = y - 2;
    const divBot = y + bodyH + 2;
    const divLine = this.scene.add
      .rectangle(divX, (divTop + divBot) / 2, 1, divBot - divTop, 0x4466aa)
      .setDepth(DEPTH_PANEL);
    this.objects.push(divLine);

    // Render columns
    for (let ci = 0; ci < columns.length; ci++) {
      const colX = ci === 0 ? col1X : col2X;
      const col = columns[ci];
      let ly = y;

      for (const line of col.lines) {
        this._text(
          colX + 4,
          ly,
          line.text,
          {
            fontSize: line.fontSize || '11px',
            color: line.color || '#e0e0e0',
            fontStyle: line.bold ? 'bold' : '',
          },
          0,
        );
        ly += LINE_H;
      }
    }

    // --- Select buttons ---
    const btnY = y + bodyH + 10;
    for (let ci = 0; ci < columns.length; ci++) {
      const colX = ci === 0 ? col1X : col2X;
      const btnCx = colX + COL_W / 2;
      const cls = this.targets[ci];

      const btnBg = this.scene.add
        .rectangle(btnCx, btnY, COL_W - 16, 22, 0x224488, 1)
        .setDepth(DEPTH_TEXT)
        .setStrokeStyle(1, 0x6688cc)
        .setInteractive({ useHandCursor: true });
      this.objects.push(btnBg);
      this._selectButtons.push(btnBg);

      this._text(
        btnCx,
        btnY,
        `Select ${cls.name}`,
        {
          fontSize: '11px',
          color: '#ffffff',
          fontStyle: 'bold',
        },
        0.5,
      );

      btnBg.on('pointerover', () => btnBg.setFillStyle(0x3366aa));
      btnBg.on('pointerout', () => btnBg.setFillStyle(0x224488));
      btnBg.once('pointerdown', () => {
        this.destroy();
        this._resolve(cls);
      });
    }

    // Cancel hint
    const cancelY = btnY + LINE_H + 8;
    const cancelText = this._text(
      cx,
      cancelY,
      '(ESC to cancel)',
      {
        fontSize: '10px',
        color: '#888888',
      },
      0.5,
    );

    // ESC key handler (only acts while top of the scene's overlay stack)
    this._overlayToken = pushOverlay(this.scene, {
      name: 'promotion_choice',
      onCancel: (event) => {
        this._escHandler?.(event);
        return true;
      },
    });
    this._escHandler = (event) => {
      if (!isTopOverlay(this.scene, this._overlayToken)) return;
      if (!consumeEscEvent(this.scene, event)) return;
      this.destroy();
      this._resolve(null);
    };
    this.scene.input.keyboard.on('keydown-ESC', this._escHandler);

    // Also cancel on dim click outside panel
    dim.on('pointerdown', (pointer) => {
      const px = pointer.x,
        py = pointer.y;
      const halfW = panelW / 2,
        halfH = panelH / 2;
      if (px < cx - halfW || px > cx + halfW || py < cy - halfH || py > cy + halfH) {
        this.destroy();
        this._resolve(null);
      }
    });

    this._setupInputFocus();
  }

  // Claim the input-focus stack so the pad drives this forced choice (and not the
  // scene behind it). The ring tracks the two Select buttons; released in destroy().
  _setupInputFocus() {
    this._focus = new BoundingFocusController(this.scene, DEPTH_TEXT + 5);
    this._focus.setObjects(this._selectButtons, true);
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);
  }

  _onInputAction(action, payload) {
    switch (action) {
      case InputAction.NAVIGATE:
        // Columns sit side by side — left/right picks between them.
        this._focus?.move(payload?.dx || 0);
        break;
      case InputAction.CONFIRM:
        this._focus?.activate(); // -> the button's pointerdown -> resolve(cls)
        break;
      case InputAction.CANCEL:
      case InputAction.PAUSE:
        this.destroy();
        this._resolve?.(null);
        break;
    }
  }

  /**
   * Build display lines for one promotion target column.
   */
  _buildColumnData(cls) {
    const unit = this.unit;
    const lines = [];

    // Class name header
    lines.push({ text: cls.name, color: '#ffdd44', bold: true, fontSize: '13px' });
    lines.push({ text: '' }); // spacer

    // Stat bonuses: "STR  12 → 14  (+2)"
    lines.push({ text: 'Stat Bonuses', color: '#aaaaaa', bold: true });
    const bonuses = cls.promotionBonuses || {};
    for (const stat of XP_STAT_NAMES) {
      const bonus = bonuses[stat] || 0;
      if (bonus === 0) continue;
      const cur = unit.stats[stat];
      const after = cur + bonus;
      const color = STAT_COLORS[stat] || '#e0e0e0';
      lines.push({
        text: `  ${stat.padEnd(4)} ${String(cur).padStart(2)} → ${String(after).padStart(2)}  (+${bonus})`,
        color,
      });
    }
    // MOV bonus (separate since not in XP_STAT_NAMES)
    const movBonus = bonuses.MOV || 0;
    if (movBonus > 0) {
      const cur = unit.stats.MOV;
      lines.push({
        text: `  MOV  ${String(cur).padStart(2)} → ${String(cur + movBonus).padStart(2)}  (+${movBonus})`,
        color: STAT_COLORS.MOV || '#e0e0e0',
      });
    }

    lines.push({ text: '' }); // spacer

    // Growth bonuses
    if (cls.growthBonuses && Object.keys(cls.growthBonuses).length > 0) {
      lines.push({ text: 'Growth Bonuses', color: '#aaaaaa', bold: true });
      for (const [stat, val] of Object.entries(cls.growthBonuses)) {
        lines.push({ text: `  +${val}% ${stat}`, color: '#88ffff' });
      }
      lines.push({ text: '' });
    }

    // Weapons
    lines.push({ text: 'Weapons', color: '#aaaaaa', bold: true });
    lines.push({ text: `  ${cls.weaponProficiencies}`, color: '#e0e0e0' });
    lines.push({ text: '' });

    // Move type (highlight if changed)
    if (cls.moveType !== unit.moveType) {
      lines.push({ text: 'Move Type', color: '#aaaaaa', bold: true });
      lines.push({ text: `  ${unit.moveType} → ${cls.moveType}`, color: '#88ffff' });
      lines.push({ text: '' });
    }

    // Innate skill
    const innateIds = getClassInnateSkills(cls.name, this.skillsData);
    if (innateIds.length > 0) {
      lines.push({ text: 'Innate Skill', color: '#aaaaaa', bold: true });
      for (const sid of innateIds) {
        const skill = this.skillsData.find((s) => s.id === sid);
        if (skill) {
          lines.push({ text: `  ${skill.name}`, color: '#ffcc44', bold: true });
          // Wrap description to fit column
          const desc = skill.description || '';
          const wrapped = this._wrap(desc, 26);
          for (const wl of wrapped) {
            lines.push({ text: `  ${wl}`, color: '#cccccc', fontSize: '10px' });
          }
        }
      }
    }

    return { lines };
  }

  /** Simple word-wrap for tooltip text. */
  _wrap(text, maxChars) {
    const words = text.split(' ');
    const result = [];
    let cur = '';
    for (const w of words) {
      if (cur.length + w.length + 1 > maxChars && cur.length > 0) {
        result.push(cur);
        cur = w;
      } else {
        cur = cur ? cur + ' ' + w : w;
      }
    }
    if (cur) result.push(cur);
    return result;
  }

  /** Helper to add text, track for cleanup, and return it. */
  _text(x, y, str, style, originX = 0) {
    const t = this.scene.add
      .text(x, y, str, {
        fontFamily: FONT,
        fontSize: '11px',
        ...style,
      })
      .setOrigin(originX, 0)
      .setDepth(DEPTH_TEXT);
    this.objects.push(t);
    return t;
  }

  _registerScenePromotionChoiceGuard() {
    if (this._scenePromotionChoiceGuardRegistered) return;
    if (!this.scene || typeof this.scene !== 'object') return;
    const next = Math.max(0, Number(this.scene._promotionChoicePanelOpen) || 0) + 1;
    this.scene._promotionChoicePanelOpen = next;
    this._scenePromotionChoiceGuardRegistered = true;
  }

  _unregisterScenePromotionChoiceGuard() {
    if (!this._scenePromotionChoiceGuardRegistered) return;
    if (!this.scene || typeof this.scene !== 'object') {
      this._scenePromotionChoiceGuardRegistered = false;
      return;
    }
    const current = Math.max(0, Number(this.scene._promotionChoicePanelOpen) || 0);
    this.scene._promotionChoicePanelOpen = Math.max(0, current - 1);
    this._scenePromotionChoiceGuardRegistered = false;
  }

  destroy() {
    if (this._escHandler) {
      this.scene?.input?.keyboard?.off?.('keydown-ESC', this._escHandler);
      this._escHandler = null;
    }
    if (this._onInputActionBound) {
      popInputScope(this);
      this._onInputActionBound = null;
    }
    if (this._focus) {
      this._focus.destroy();
      this._focus = null;
    }
    this._selectButtons = [];
    removeOverlay(this.scene, this._overlayToken);
    this._overlayToken = null;
    this._unregisterScenePromotionChoiceGuard();
    for (const obj of this.objects) {
      obj.destroy();
    }
    this.objects = [];
  }
}
