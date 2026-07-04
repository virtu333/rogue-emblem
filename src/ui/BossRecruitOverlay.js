/**
 * BossRecruitOverlay — extracted from BattleScene.
 * Renders the post-boss recruit card selection UI.
 * Uses a one-shot resolution guard to prevent double-tap.
 */
import { generateBossRecruitCandidates } from '../engine/BossRecruitSystem.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import { getTraitNames } from '../engine/TraitSystem.js';
import { applyTextResolution } from '../utils/uiStyles.js';
import { BoundingFocusController } from './BoundingFocusController.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import {
  TOOLTIP_HOVER_DELAY_MS,
  TOOLTIP_LONG_PRESS_MS,
  TOOLTIP_LONG_PRESS_MOVE_THRESHOLD,
} from '../utils/tooltipTiming.js';

export class BossRecruitOverlay {
  /**
   * @param {object} scene  — the BattleScene (or mock) that owns this overlay
   * @param {object} runManager
   * @param {object} gameData
   */
  constructor(scene, runManager, gameData) {
    this.scene = scene;
    this.runManager = runManager;
    this.gameData = gameData;
    /** @type {object[]} Phaser display objects for lootGroup tracking */
    this.displayObjects = [];
    // Gamepad focus: a ring over the candidate cards + skip card.
    this._focusCards = [];
    this._focus = null;
    this._onInputActionBound = null;
    this._resolveSelection = null;
  }

  /**
   * Render the boss-recruit card UI.
   * @param {(selectedUnit: object|null) => void} onComplete — called once with the selected unit or null
   */
  show(onComplete) {
    const scene = this.scene;
    const candidates = generateBossRecruitCandidates(
      this.runManager.currentAct,
      this.runManager.roster,
      this.gameData,
      this.runManager.getEffectiveMetaEffects(),
      this.runManager?.fallenUnits || [],
    );

    // Fallback — no candidates
    if (!candidates || candidates.length === 0) {
      onComplete(null);
      return;
    }

    // One-shot resolution guard
    let _resolved = false;
    const resolve = (unit) => {
      if (_resolved) return;
      _resolved = true;
      this._cleanup();
      onComplete(unit);
    };
    this._resolveSelection = resolve;
    this._focusCards = [];

    const audio = scene.registry.get('audio');
    const recruitGroup = this.displayObjects;
    const cam = scene.cameras.main;

    // Dark overlay
    const overlay = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.85)
      .setDepth(700)
      .setInteractive();
    recruitGroup.push(overlay);

    // Title
    const title = applyTextResolution(
      scene.add
        .text(cam.centerX, 28, 'BOSS RECRUIT', {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#ffdd44',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(701),
    );
    recruitGroup.push(title);

    const subtitle = applyTextResolution(
      scene.add
        .text(cam.centerX, 54, 'Choose a warrior to join your cause', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#aaaaaa',
        })
        .setOrigin(0.5)
        .setDepth(701),
    );
    recruitGroup.push(subtitle);

    // Card layout: candidates + skip
    const cardCount = candidates.length + 1;
    const cardW = 150;
    const cardH = 220;
    const gap = 12;
    const totalW = cardCount * cardW + (cardCount - 1) * gap;
    const startX = cam.centerX - totalW / 2 + cardW / 2;
    const cardY = cam.centerY + 20;

    // Render candidate cards
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cx = startX + i * (cardW + gap);
      const u = c.unit;

      const cardColor = c.isLord ? 0x443322 : 0x2a2a44;
      const strokeColor = c.isLord ? 0xffdd44 : 0x66aacc;
      const card = scene.add
        .rectangle(cx, cardY, cardW, cardH, cardColor, 1)
        .setStrokeStyle(2, strokeColor)
        .setDepth(701)
        .setInteractive({ useHandCursor: true });
      recruitGroup.push(card);
      this._focusCards.push(card);

      let yOff = cardY - cardH / 2 + 12;

      // Lord tag
      if (c.isLord) {
        const tag = applyTextResolution(
          scene.add
            .text(cx, yOff, '[LORD]', {
              fontFamily: 'monospace',
              fontSize: '9px',
              color: '#ffdd44',
              fontStyle: 'bold',
            })
            .setOrigin(0.5)
            .setDepth(702),
        );
        recruitGroup.push(tag);
        yOff += 14;
      }

      // Name
      const name = applyTextResolution(
        scene.add
          .text(cx, yOff, c.displayName, {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#ffffff',
            fontStyle: 'bold',
          })
          .setOrigin(0.5)
          .setDepth(702),
      );
      recruitGroup.push(name);
      yOff += 16;

      // Class
      const cls = applyTextResolution(
        scene.add
          .text(cx, yOff, u.className, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#aaaaaa',
          })
          .setOrigin(0.5)
          .setDepth(702),
      );
      recruitGroup.push(cls);
      yOff += 16;

      const classData = this.gameData.classes?.find((cl) => cl.name === u.className);
      const descText = classData?.description || '';

      // Level
      const lvl = applyTextResolution(
        scene.add
          .text(cx, yOff, `Lv ${getDisplayLevel(u)}`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#66ddff',
          })
          .setOrigin(0.5)
          .setDepth(702),
      );
      recruitGroup.push(lvl);
      yOff += 16;

      // Separator
      const sep = applyTextResolution(
        scene.add
          .text(cx, yOff, '-----------------', {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#555555',
          })
          .setOrigin(0.5)
          .setDepth(702),
      );
      recruitGroup.push(sep);
      yOff += 12;

      const selectRecruit = () => {
        if (audio) audio.playSFX('sfx_confirm');
        resolve(c.unit);
      };
      this._wireBossRecruitClassTooltip(name, descText, selectRecruit);
      this._wireBossRecruitClassTooltip(cls, descText, selectRecruit);

      // Core comparison stats
      const useMag = (u.stats?.MAG || 0) > (u.stats?.STR || 0);
      const atkStat = useMag ? 'MAG' : 'STR';
      const hp = Number(u.stats?.HP || 0);
      const atk = Number(u.stats?.[atkStat] || 0);
      const spd = Number(u.stats?.SPD || 0);
      const def = Number(u.stats?.DEF || 0);
      const res = Number(u.stats?.RES || 0);
      const mov = Number(u.mov ?? u.stats?.MOV ?? 0);

      const coreA = applyTextResolution(
        scene.add
          .text(cx, yOff, `HP ${hp} ${atkStat} ${atk} SPD ${spd}`, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#cccccc',
          })
          .setOrigin(0.5)
          .setDepth(702),
      );
      recruitGroup.push(coreA);
      yOff += 13;

      const coreB = applyTextResolution(
        scene.add
          .text(cx, yOff, `DEF ${def} RES ${res} MOV ${mov}`, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#88bbff',
          })
          .setOrigin(0.5)
          .setDepth(702),
      );
      recruitGroup.push(coreB);
      yOff += 15;

      // Weapon proficiency signal
      if (u.proficiencies && u.proficiencies.length > 0) {
        const profShort = {
          Sword: 'Swd',
          Lance: 'Lnc',
          Axe: 'Axe',
          Bow: 'Bow',
          Tome: 'Tom',
          Light: 'Lgt',
          Staff: 'Stf',
        };
        const profEntries = u.proficiencies.map(
          (p) => `${profShort[p.type] || p.type}(${(p.rank || '?')[0]})`,
        );
        const profPreview = `${profEntries.slice(0, 2).join(' ')}${profEntries.length > 2 ? ` +${profEntries.length - 2}` : ''}`;
        const prof = applyTextResolution(
          scene.add
            .text(cx, yOff, `Wpn: ${profPreview}`, {
              fontFamily: 'monospace',
              fontSize: '9px',
              color: '#aaaaaa',
              wordWrap: { width: cardW - 10 },
              align: 'center',
            })
            .setOrigin(0.5)
            .setDepth(702),
        );
        recruitGroup.push(prof);
        yOff += 13;
      }

      // Traits — the player decides with this info
      const traitNames = getTraitNames(u, this.gameData.traits);
      if (traitNames) {
        const tr = applyTextResolution(
          scene.add
            .text(cx, yOff, `Traits: ${traitNames}`, {
              fontFamily: 'monospace',
              fontSize: '9px',
              color: '#cc99ff',
              wordWrap: { width: cardW - 10 },
              align: 'center',
            })
            .setOrigin(0.5)
            .setDepth(702),
        );
        recruitGroup.push(tr);
        yOff += 13;
      }

      // Notable personal/class skill
      const notableSkill = Array.isArray(u.skills)
        ? u.skills.find((s) => typeof s === 'string' && s.trim().length > 0)
        : null;
      if (notableSkill) {
        const sk = applyTextResolution(
          scene.add
            .text(cx, yOff, `Skill: ${notableSkill}`, {
              fontFamily: 'monospace',
              fontSize: '9px',
              color: c.isLord ? '#ffdd44' : '#aaccff',
              wordWrap: { width: cardW - 10 },
              align: 'center',
            })
            .setOrigin(0.5)
            .setDepth(702),
        );
        recruitGroup.push(sk);
      }

      // Click handler
      card.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        selectRecruit();
      });

      // Hover effect
      card.on('pointerover', () => card.setStrokeStyle(3, 0xffffff));
      card.on('pointerout', () => card.setStrokeStyle(2, strokeColor));
    }

    // Skip card
    const skipX = startX + candidates.length * (cardW + gap);
    const skipCard = scene.add
      .rectangle(skipX, cardY, cardW, cardH, 0x333333, 1)
      .setStrokeStyle(2, 0x666666)
      .setDepth(701)
      .setInteractive({ useHandCursor: true });
    recruitGroup.push(skipCard);
    this._focusCards.push(skipCard);

    const skipIcon = applyTextResolution(
      scene.add
        .text(skipX, cardY - 30, '>', {
          fontFamily: 'monospace',
          fontSize: '28px',
          color: '#888888',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(702),
    );
    recruitGroup.push(skipIcon);

    const skipLabel = applyTextResolution(
      scene.add
        .text(skipX, cardY + 10, 'SKIP', {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#aaaaaa',
        })
        .setOrigin(0.5)
        .setDepth(702),
    );
    recruitGroup.push(skipLabel);

    const skipDesc = applyTextResolution(
      scene.add
        .text(skipX, cardY + 35, 'Continue\nto Loot', {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#777777',
          align: 'center',
        })
        .setOrigin(0.5)
        .setDepth(702),
    );
    recruitGroup.push(skipDesc);

    skipCard.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      if (audio) audio.playSFX('sfx_confirm');
      resolve(null);
    });
    skipCard.on('pointerover', () => skipCard.setStrokeStyle(3, 0xffffff));
    skipCard.on('pointerout', () => skipCard.setStrokeStyle(2, 0x666666));

    // Footer hints
    const inst = applyTextResolution(
      scene.add
        .text(cam.centerX, cardY + cardH / 2 + 24, 'Choose a recruit to add to your roster', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#888888',
        })
        .setOrigin(0.5)
        .setDepth(701),
    );
    recruitGroup.push(inst);

    const hintText = applyTextResolution(
      scene.add
        .text(cam.centerX, cardY + cardH / 2 + 42, '[R] Roster', {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#666666',
        })
        .setOrigin(0.5)
        .setDepth(701),
    );
    recruitGroup.push(hintText);

    if (typeof scene._pinToScreen === 'function') {
      scene._pinToScreen(recruitGroup);
    }

    this._setupInputFocus();
  }

  // Claim the input-focus stack so the pad drives this forced choice. The ring
  // tracks the candidate cards + skip card; pinned to the screen like the cards
  // (the battle camera may be scrolled at boss-recruit time). Released in _cleanup.
  _setupInputFocus() {
    const scene = this.scene;
    this._focus = new BoundingFocusController(scene, 705);
    this._focus.setObjects(this._focusCards, true);
    if (this._focus.ring && typeof scene._pinToScreen === 'function') {
      scene._pinToScreen(this._focus.ring);
    }
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);
  }

  _onInputAction(action, payload) {
    switch (action) {
      case InputAction.NAVIGATE:
        // Cards sit in a horizontal row.
        this._focus?.move(payload?.dx || 0);
        break;
      case InputAction.CONFIRM:
        this._focus?.activate(); // -> the card's pointerdown -> resolve
        break;
      case InputAction.CANCEL:
      case InputAction.PAUSE:
        this._resolveSelection?.(null); // = Skip
        break;
    }
  }

  // ── Tooltip helpers (moved from BattleScene) ──────────────────

  _showBossRecruitClassTooltip(anchorText, description) {
    const scene = this.scene;
    if (!anchorText || typeof description !== 'string') return;
    const body = description.trim();
    if (!body) return;
    if (typeof scene._hideMenuTooltip === 'function') scene._hideMenuTooltip();
    const anchorDepth = Number(anchorText?.depth);
    const tooltipDepth = Number.isFinite(anchorDepth) ? Math.max(703, anchorDepth + 1) : 703;
    const padding = 8;
    const maxWidth = 220;
    const txt = scene.add
      .text(0, 0, body, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e0e0e0',
        wordWrap: { width: maxWidth - padding * 2 },
      })
      .setDepth(tooltipDepth);
    const bg = scene.add
      .rectangle(0, 0, txt.width + padding * 2, txt.height + padding * 2, 0x222222, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0x666666)
      .setDepth(tooltipDepth);
    const box = scene.add.container(0, 0, [bg, txt]).setDepth(tooltipDepth);
    txt.setPosition(padding, padding);

    const b = anchorText.getBounds();
    let x = b.right + 8;
    let y = b.top - 4;
    if (x + bg.width > scene.cameras.main.width - 4) x = b.left - bg.width - 8;
    if (x < 4) x = 4;
    if (y + bg.height > scene.cameras.main.height - 4)
      y = scene.cameras.main.height - bg.height - 4;
    if (y < 4) y = 4;
    box.setPosition(x, y);
    if (typeof scene._pinToScreen === 'function') scene._pinToScreen(box);
    scene._menuTooltip = box;
  }

  _wireBossRecruitClassTooltip(text, description, onTap) {
    const scene = this.scene;
    if (!text || typeof description !== 'string' || !description.trim()) return;
    text.setInteractive({ useHandCursor: true });
    text.on('pointerover', () => {
      if (typeof scene._clearMenuTooltipTimer === 'function')
        scene._clearMenuTooltipTimer('_menuTooltipHoverTimer');
      scene._menuTooltipHoverTimer = scene.time.delayedCall(TOOLTIP_HOVER_DELAY_MS, () => {
        scene._menuTooltipHoverTimer = null;
        this._showBossRecruitClassTooltip(text, description);
      });
    });
    text.on('pointerout', () => {
      if (typeof scene._clearMenuTooltipTimer === 'function')
        scene._clearMenuTooltipTimer('_menuTooltipPressTimer');
      text._bossRecruitPressed = null;
      if (typeof scene._hideMenuTooltip === 'function') scene._hideMenuTooltip();
    });
    text.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      if (typeof scene._clearMenuTooltipTimer === 'function')
        scene._clearMenuTooltipTimer('_menuTooltipPressTimer');
      text._bossRecruitPressed = {
        id: pointer?.id,
        x: pointer?.x ?? 0,
        y: pointer?.y ?? 0,
        longPressShown: false,
      };
      scene._menuTooltipPressTimer = scene.time.delayedCall(TOOLTIP_LONG_PRESS_MS, () => {
        scene._menuTooltipPressTimer = null;
        if (!text._bossRecruitPressed) return;
        text._bossRecruitPressed.longPressShown = true;
        this._showBossRecruitClassTooltip(text, description);
      });
    });
    text.on('pointermove', (pointer) => {
      const pressed = text._bossRecruitPressed;
      if (!pressed || !scene._menuTooltipPressTimer) return;
      if (pressed.id !== pointer?.id) return;
      const dx = (pointer?.x ?? 0) - pressed.x;
      const dy = (pointer?.y ?? 0) - pressed.y;
      if (Math.hypot(dx, dy) > TOOLTIP_LONG_PRESS_MOVE_THRESHOLD) {
        if (typeof scene._clearMenuTooltipTimer === 'function')
          scene._clearMenuTooltipTimer('_menuTooltipPressTimer');
      }
    });
    text.on('pointerup', (pointer) => {
      if (pointer?.button !== 0) return;
      if (typeof scene._clearMenuTooltipTimer === 'function')
        scene._clearMenuTooltipTimer('_menuTooltipPressTimer');
      const longPressShown = !!text._bossRecruitPressed?.longPressShown;
      text._bossRecruitPressed = null;
      if (longPressShown) return;
      if (typeof onTap === 'function') onTap();
    });
  }

  _cleanup() {
    const scene = this.scene;
    if (this._onInputActionBound) {
      popInputScope(this);
      this._onInputActionBound = null;
    }
    if (this._focus) {
      this._focus.destroy();
      this._focus = null;
    }
    this._focusCards = [];
    if (typeof scene._hideMenuTooltip === 'function') scene._hideMenuTooltip();
    if (typeof scene.hideLootRoster === 'function') scene.hideLootRoster();
    for (const obj of this.displayObjects) {
      if (obj && typeof obj.destroy === 'function') obj.destroy();
    }
  }
}
