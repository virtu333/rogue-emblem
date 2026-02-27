/**
 * LordArrivalOverlay — Post-battle overlay for the Power of Friendship meta upgrade.
 * Renders lord selection cards when a third lord joins mid-run.
 * Adapted from BossRecruitOverlay with lord-specific theming.
 */
import { generateThirdLordCandidates } from '../engine/BossRecruitSystem.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import { applyTextResolution } from '../utils/uiStyles.js';
import {
  TOOLTIP_HOVER_DELAY_MS,
  TOOLTIP_LONG_PRESS_MS,
  TOOLTIP_LONG_PRESS_MOVE_THRESHOLD,
} from '../utils/tooltipTiming.js';

export class LordArrivalOverlay {
  /**
   * @param {object} scene — the BattleScene (or mock)
   * @param {object} runManager
   * @param {object} gameData
   */
  constructor(scene, runManager, gameData) {
    this.scene = scene;
    this.runManager = runManager;
    this.gameData = gameData;
    /** @type {object[]} Phaser display objects for lootGroup tracking */
    this.displayObjects = [];
  }

  /**
   * Render the lord arrival UI.
   * @param {(selectedUnit: object|null) => void} onComplete — called once with the selected unit or null
   */
  show(onComplete) {
    const scene = this.scene;
    const mode = this.runManager.metaEffects?.thirdLordMode || 'random';
    const metaEffects = this.runManager.getEffectiveMetaEffects();
    const result = generateThirdLordCandidates(
      this.runManager.roster,
      this.gameData,
      metaEffects,
      this.runManager?.fallenUnits || [],
      mode,
    );

    // No candidates available — resolve immediately
    if (!result) {
      onComplete(null);
      return;
    }

    const { candidates } = result;

    // One-shot resolution guard
    let _resolved = false;
    const resolve = (unit) => {
      if (_resolved) return;
      _resolved = true;
      this._cleanup();
      onComplete(unit);
    };

    if (mode === 'random') {
      this._renderSingleLordCard(candidates[0], resolve);
    } else {
      this._renderSelectionCards(candidates, resolve);
      if (this.runManager.canRerollThirdLord()) {
        this._renderRerollButton(onComplete);
      }
    }
  }

  _renderSingleLordCard(candidate, resolve) {
    const scene = this.scene;
    const audio = scene.registry?.get('audio');
    const group = this.displayObjects;
    const cam = scene.cameras.main;

    // Dark overlay
    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.85)
      .setDepth(700)
      .setInteractive();
    group.push(bg);

    this._renderHeader(group, cam);

    // Single centered card
    const cardW = 160;
    const cardH = 230;
    const cx = cam.centerX;
    const cardY = cam.centerY + 20;
    const u = candidate.unit;

    const card = scene.add
      .rectangle(cx, cardY, cardW, cardH, 0x443322, 1)
      .setStrokeStyle(2, 0xffdd44)
      .setDepth(701);
    group.push(card);

    this._renderCardContent(group, cx, cardY, cardW, cardH, candidate);

    // Confirm button below the card
    const btnY = cardY + cardH / 2 + 30;
    const btn = scene.add
      .rectangle(cx, btnY, 120, 32, 0x445522, 1)
      .setStrokeStyle(2, 0xaadd44)
      .setDepth(701)
      .setInteractive({ useHandCursor: true });
    group.push(btn);

    const btnText = applyTextResolution(
      scene.add
        .text(cx, btnY, 'WELCOME', {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ffdd44',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(702),
    );
    group.push(btnText);

    btn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      if (audio) audio.playSFX('sfx_confirm');
      resolve(u);
    });
    btn.on('pointerover', () => btn.setStrokeStyle(3, 0xffffff));
    btn.on('pointerout', () => btn.setStrokeStyle(2, 0xaadd44));

    // Footer
    const inst = applyTextResolution(
      scene.add
        .text(cam.centerX, btnY + 30, 'The power of friendship prevails', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#888888',
        })
        .setOrigin(0.5)
        .setDepth(701),
    );
    group.push(inst);

    if (typeof scene._pinToScreen === 'function') scene._pinToScreen(group);
  }

  _renderSelectionCards(candidates, resolve) {
    const scene = this.scene;
    const audio = scene.registry?.get('audio');
    const group = this.displayObjects;
    const cam = scene.cameras.main;

    // Dark overlay
    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.85)
      .setDepth(700)
      .setInteractive();
    group.push(bg);

    this._renderHeader(group, cam);

    const maxCards = candidates.length;
    const cardW = maxCards <= 3 ? 150 : Math.floor((620 - (maxCards - 1) * 10) / maxCards);
    const cardH = maxCards <= 3 ? 220 : 210;
    const gap = maxCards <= 3 ? 12 : 10;
    const totalW = maxCards * cardW + (maxCards - 1) * gap;
    const startX = cam.centerX - totalW / 2 + cardW / 2;
    const cardY = cam.centerY + 20;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cx = startX + i * (cardW + gap);
      const u = c.unit;

      const card = scene.add
        .rectangle(cx, cardY, cardW, cardH, 0x443322, 1)
        .setStrokeStyle(2, 0xffdd44)
        .setDepth(701)
        .setInteractive({ useHandCursor: true });
      group.push(card);

      const { name: nameObj, cls: clsObj } = this._renderCardContent(
        group,
        cx,
        cardY,
        cardW,
        cardH,
        c,
      );

      const classData = this.gameData.classes?.find((cl) => cl.name === u.className);
      const descText = classData?.description || '';

      const selectLord = () => {
        if (audio) audio.playSFX('sfx_confirm');
        resolve(u);
      };

      card.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        selectLord();
      });
      card.on('pointerover', () => card.setStrokeStyle(3, 0xffffff));
      card.on('pointerout', () => card.setStrokeStyle(2, 0xffdd44));

      // Wire class tooltips directly on this card's text objects
      this._wireLordCardTooltip(nameObj, descText, selectLord);
      this._wireLordCardTooltip(clsObj, descText, selectLord);
    }

    // Footer hints
    const inst = applyTextResolution(
      scene.add
        .text(cam.centerX, cardY + cardH / 2 + 24, 'Choose a lord to join your roster', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#888888',
        })
        .setOrigin(0.5)
        .setDepth(701),
    );
    group.push(inst);

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
    group.push(hintText);

    if (typeof scene._pinToScreen === 'function') scene._pinToScreen(group);
  }

  _renderHeader(group, cam) {
    const scene = this.scene;
    const title = applyTextResolution(
      scene.add
        .text(cam.centerX, 28, 'LORD ARRIVAL', {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#ffdd44',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(701),
    );
    group.push(title);

    const subtitle = applyTextResolution(
      scene.add
        .text(cam.centerX, 54, 'The power of friendship prevails', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#aaaaaa',
        })
        .setOrigin(0.5)
        .setDepth(701),
    );
    group.push(subtitle);
  }

  _renderCardContent(group, cx, cardY, cardW, cardH, candidate) {
    const scene = this.scene;
    const u = candidate.unit;
    let yOff = cardY - cardH / 2 + 12;

    // Lord tag
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
    group.push(tag);
    yOff += 14;

    // Name
    const name = applyTextResolution(
      scene.add
        .text(cx, yOff, u.name, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(702),
    );
    group.push(name);
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
    group.push(cls);
    yOff += 16;

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
    group.push(lvl);
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
    group.push(sep);
    yOff += 12;

    // Core comparison stats — scale font for narrow cards
    const statFont = cardW < 140 ? '9px' : '10px';
    const profWrapW = cardW < 140 ? cardW - 6 : cardW - 10;
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
          fontSize: statFont,
          color: '#cccccc',
        })
        .setOrigin(0.5)
        .setDepth(702),
    );
    group.push(coreA);
    yOff += 13;

    const coreB = applyTextResolution(
      scene.add
        .text(cx, yOff, `DEF ${def} RES ${res} MOV ${mov}`, {
          fontFamily: 'monospace',
          fontSize: statFont,
          color: '#88bbff',
        })
        .setOrigin(0.5)
        .setDepth(702),
    );
    group.push(coreB);
    yOff += 15;

    // Weapon proficiency
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
            wordWrap: { width: profWrapW },
            align: 'center',
          })
          .setOrigin(0.5)
          .setDepth(702),
      );
      group.push(prof);
      yOff += 13;
    }

    // Notable skill
    const notableSkill = Array.isArray(u.skills)
      ? u.skills.find((s) => typeof s === 'string' && s.trim().length > 0)
      : null;
    if (notableSkill) {
      const sk = applyTextResolution(
        scene.add
          .text(cx, yOff, `Skill: ${notableSkill}`, {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#ffdd44',
            wordWrap: { width: profWrapW },
            align: 'center',
          })
          .setOrigin(0.5)
          .setDepth(702),
      );
      group.push(sk);
    }

    return { name, cls };
  }

  _renderRerollButton(onComplete) {
    const scene = this.scene;
    const audio = scene.registry?.get('audio');
    const group = this.displayObjects;
    const cam = scene.cameras.main;
    const cardY = cam.centerY + 20;

    const btnY = cardY + 110 + 24 + 20;
    const btn = scene.add
      .rectangle(cam.centerX, btnY, 130, 28, 0x553322, 1)
      .setStrokeStyle(2, 0xddaa44)
      .setDepth(701)
      .setInteractive({ useHandCursor: true });
    group.push(btn);

    const btnText = applyTextResolution(
      scene.add
        .text(cam.centerX, btnY, 'REROLL', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#ffdd44',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(702),
    );
    group.push(btnText);

    btn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      if (audio) audio.playSFX('sfx_confirm');
      this._handleReroll(onComplete);
    });
    btn.on('pointerover', () => btn.setStrokeStyle(3, 0xffffff));
    btn.on('pointerout', () => btn.setStrokeStyle(2, 0xddaa44));
  }

  _handleReroll(onComplete) {
    this._cleanup();
    this.displayObjects = [];
    this.runManager.consumeThirdLordReroll();
    this.show(onComplete);
  }

  // ── Tooltip helpers (same pattern as BossRecruitOverlay) ──────────

  _showLordCardTooltip(anchorText, description) {
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
    const bgRect = scene.add
      .rectangle(0, 0, txt.width + padding * 2, txt.height + padding * 2, 0x222222, 0.95)
      .setOrigin(0)
      .setStrokeStyle(1, 0x666666)
      .setDepth(tooltipDepth);
    const box = scene.add.container(0, 0, [bgRect, txt]).setDepth(tooltipDepth);
    txt.setPosition(padding, padding);

    const b = anchorText.getBounds();
    let x = b.right + 8;
    let y = b.top - 4;
    if (x + bgRect.width > scene.cameras.main.width - 4) x = b.left - bgRect.width - 8;
    if (x < 4) x = 4;
    if (y + bgRect.height > scene.cameras.main.height - 4)
      y = scene.cameras.main.height - bgRect.height - 4;
    if (y < 4) y = 4;
    box.setPosition(x, y);
    if (typeof scene._pinToScreen === 'function') scene._pinToScreen(box);
    scene._menuTooltip = box;
  }

  _wireLordCardTooltip(text, description, onTap) {
    const scene = this.scene;
    if (!text || typeof description !== 'string' || !description.trim()) return;
    text.setInteractive({ useHandCursor: true });
    text.on('pointerover', () => {
      if (typeof scene._clearMenuTooltipTimer === 'function')
        scene._clearMenuTooltipTimer('_menuTooltipHoverTimer');
      scene._menuTooltipHoverTimer = scene.time.delayedCall(TOOLTIP_HOVER_DELAY_MS, () => {
        scene._menuTooltipHoverTimer = null;
        this._showLordCardTooltip(text, description);
      });
    });
    text.on('pointerout', () => {
      if (typeof scene._clearMenuTooltipTimer === 'function')
        scene._clearMenuTooltipTimer('_menuTooltipPressTimer');
      text._lordCardPressed = null;
      if (typeof scene._hideMenuTooltip === 'function') scene._hideMenuTooltip();
    });
    text.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      if (typeof scene._clearMenuTooltipTimer === 'function')
        scene._clearMenuTooltipTimer('_menuTooltipPressTimer');
      text._lordCardPressed = {
        id: pointer?.id,
        x: pointer?.x ?? 0,
        y: pointer?.y ?? 0,
        longPressShown: false,
      };
      scene._menuTooltipPressTimer = scene.time.delayedCall(TOOLTIP_LONG_PRESS_MS, () => {
        scene._menuTooltipPressTimer = null;
        if (!text._lordCardPressed) return;
        text._lordCardPressed.longPressShown = true;
        this._showLordCardTooltip(text, description);
      });
    });
    text.on('pointermove', (pointer) => {
      const pressed = text._lordCardPressed;
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
      const longPressShown = !!text._lordCardPressed?.longPressShown;
      text._lordCardPressed = null;
      if (longPressShown) return;
      if (typeof onTap === 'function') onTap();
    });
  }

  _cleanup() {
    const scene = this.scene;
    if (typeof scene._hideMenuTooltip === 'function') scene._hideMenuTooltip();
    if (typeof scene.hideLootRoster === 'function') scene.hideLootRoster();
    for (const obj of this.displayObjects) {
      if (obj && typeof obj.destroy === 'function') obj.destroy();
    }
  }
}
