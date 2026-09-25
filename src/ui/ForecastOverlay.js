import { forecastProjection, forecastNotes } from './forecastDisplay.js';
import { UI_PALETTE, UI_HEX, applyTextResolution, getHPBarColor } from '../utils/uiStyles.js';
/**
 * ForecastOverlay — extracted from BattleScene.
 * Renders the combat forecast panel (FE GBA-style split layout).
 * All state mutations, weapon selection, and skill context remain on BattleScene.
 */
import { getEffectivenessMultiplier, calculateEffectiveSpeed } from '../engine/Combat.js';
import { isForged } from '../engine/ForgeSystem.js';
import { portraitCanvasFrame } from './portraitArt.js';

export class ForecastOverlay {
  /**
   * @param {object} scene — the BattleScene (or mock) that owns this overlay
   */
  constructor(scene) {
    this.scene = scene;
    /** @type {object[]} Phaser display objects for cleanup tracking */
    this.displayObjects = [];
  }

  /**
   * Build all Phaser display objects for the forecast panel.
   * @param {object} config
   * @param {object} config.attacker
   * @param {object} config.defender
   * @param {object} config.forecast — result of getCombatForecast()
   * @param {object|null} config.weaponArt
   * @param {string|null} config.gamblerLine
   * @param {object[]} config.validWeapons
   */
  render({ attacker, defender, forecast, weaponArt, gamblerLine, validWeapons }) {
    const scene = this.scene;
    if (scene._mobileBattleHud) {
      scene._mobileBattleHud.showForecast({
        attacker,
        defender,
        forecast,
        weaponArt,
        gamblerLine,
        validWeapons,
      });
      this.mobileHud = scene._mobileBattleHud;
      return;
    }
    const depth = 200;
    const panelW = 380;
    const projection = forecastProjection(forecast);
    const afterCost = weaponArt
      ? scene._getWeaponArtHpAfterCost(attacker, weaponArt)
      : forecast.attacker.hp;
    const notes = [true, false].map((attacking) =>
      forecastNotes(forecast, attacking, afterCost).map((text) =>
        applyTextResolution(
          scene.add.text(0, 0, text, {
            fontFamily: 'Arial',
            fontSize: '10px',
            color: UI_PALETTE.text,
            wordWrap: { width: 178 },
            lineSpacing: 2,
          }),
        ).setDepth(depth + 1),
      ),
    );
    const noteHeight = (side) => notes[side].reduce((height, text) => height + text.height + 5, 0);

    // Pre-calculate content height for dynamic panel sizing
    let _atkExtraH = 0;
    const _atkSkills = forecast.attacker.skills || [];
    const _hasMiracle = (u) =>
      u.skills?.some((s) => (typeof s === 'string' ? s : s?.id) === 'miracle');
    if (_atkSkills.length > 0 || _hasMiracle(attacker)) _atkExtraH += 24;
    if (weaponArt) _atkExtraH += 24;
    if (gamblerLine) _atkExtraH += 24;
    if (forecast.attacker.warnings?.length)
      _atkExtraH += 2 + forecast.attacker.warnings.length * 14;
    let _defExtraH = 0;
    const _defSkills = forecast.defender.skills || [];
    if (_defSkills.length > 0 || _hasMiracle(defender)) _defExtraH += 24;
    if (forecast.defender.warnings?.length)
      _defExtraH += 2 + forecast.defender.warnings.length * 14;
    const panelH = 166 + Math.max(_atkExtraH + noteHeight(0), _defExtraH + noteHeight(1));
    const panelX = (scene.cameras.main.width - panelW) / 2;
    const panelY = scene.cameras.main.height - panelH - 10;
    const halfW = (panelW - 8) / 2; // 186 per side

    // Panel background
    const bg = scene.add
      .rectangle(panelX + panelW / 2, panelY + panelH / 2, panelW, panelH, UI_HEX.panel, 1)
      .setDepth(depth)
      .setStrokeStyle(2, UI_HEX.line);
    this.displayObjects.push(bg);

    // Draw attacker (left) and defender (right)
    this._drawSide(panelX + 4, panelY, attacker, forecast.attacker, defender, true, depth, {
      weaponArt,
      gamblerLine,
      validWeapons,
      notes: notes[0],
      predictedHP: projection?.attackerHP,
    });
    this._drawSide(
      panelX + halfW + 8,
      panelY,
      defender,
      forecast.defender,
      attacker,
      false,
      depth,
      {
        weaponArt: null,
        gamblerLine: null,
        validWeapons: null,
        notes: notes[1],
        predictedHP: projection?.defenderHP,
      },
    );

    // Center divider + VS
    const divGfx = scene.add.graphics().setDepth(depth + 1);
    divGfx.lineStyle(1, 0x444466);
    divGfx.lineBetween(panelX + panelW / 2, panelY + 8, panelX + panelW / 2, panelY + panelH - 22);
    this.displayObjects.push(divGfx);

    const vs = applyTextResolution(
      scene.add.text(panelX + panelW / 2, panelY + 28, 'VS', {
        fontFamily: 'Arial',
        fontSize: '9px',
        color: '#666688',
      }),
    )
      .setOrigin(0.5)
      .setDepth(depth + 1);
    this.displayObjects.push(vs);

    // Confirm footer
    this._drawFooter(panelX, panelY, panelW, panelH, depth, validWeapons);
  }

  /**
   * Draw one side of the forecast panel.
   * @param {number} x
   * @param {number} panelY
   * @param {object} unit
   * @param {object} info — forecast.attacker or forecast.defender
   * @param {object} opponent
   * @param {boolean} isAttacker
   * @param {number} depth
   * @param {object} opts — { weaponArt, gamblerLine, validWeapons }
   */
  _drawSide(x, panelY, unit, info, opponent, isAttacker, depth, opts = {}) {
    const scene = this.scene;
    const sideW = 186;
    const textDepth = depth + 1;
    let y = panelY + 6;

    // Portrait (40x40) -- attacker on left edge, defender on right edge
    const face = portraitCanvasFrame(scene, scene._getPortraitKey(unit), 40);
    if (face) {
      const px = isAttacker ? x + 2 : x + sideW - 42;
      const portrait = scene.add
        .image(px + 20, y + 20, face.key, face.frame)
        .setDisplaySize(40, 40)
        .setDepth(textDepth);
      this.displayObjects.push(portrait);
    }

    // Name -- positioned next to portrait
    const nameX = isAttacker ? x + 48 : x + 2;
    const name = applyTextResolution(
      scene.add.text(nameX, y + 6, unit.name, {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: UI_PALETTE.accent,
        fontStyle: 'bold',
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(name);

    // EFFECTIVE! banner -- below name, beside portrait
    if (
      unit.weapon &&
      getEffectivenessMultiplier(unit.weapon, opponent) > 1 &&
      (isAttacker || info.canCounter)
    ) {
      const eff = applyTextResolution(
        scene.add.text(nameX, y + 22, 'EFFECTIVE!', {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: UI_PALETTE.bad,
          fontStyle: 'bold',
        }),
      ).setDepth(textDepth);
      this.displayObjects.push(eff);
    }

    // HP row -- below portrait area
    y += 44;
    const hpLabel = applyTextResolution(
      scene.add.text(x + 2, y, 'HP', {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.muted,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(hpLabel);

    const hpVal = applyTextResolution(
      scene.add.text(x + 22, y, `${unit.currentHP}/${unit.stats.HP}`, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.text,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(hpVal);

    // HP bar
    const barX = x + 80;
    const barW = sideW - 86;
    const barH = 6;
    const barY = y + 4;
    const hpGfx = scene.add.graphics().setDepth(textDepth);
    hpGfx.fillStyle(UI_HEX.raised);
    hpGfx.fillRect(barX, barY, barW, barH);
    const ratio = Math.max(0, unit.currentHP / unit.stats.HP);
    hpGfx.fillStyle(getHPBarColor(ratio));
    hpGfx.fillRect(barX, barY, Math.round(barW * ratio), barH);
    if (Number.isFinite(opts.predictedHP)) {
      const remaining = Math.max(0, Math.min(unit.currentHP, opts.predictedHP));
      hpGfx.fillStyle(UI_HEX.accent, 0.75);
      hpGfx.fillRect(
        barX + Math.round((barW * remaining) / unit.stats.HP),
        barY,
        Math.round((barW * (unit.currentHP - remaining)) / unit.stats.HP),
        barH,
      );
    }
    this.displayObjects.push(hpGfx);

    y += 16;

    for (const note of opts.notes || []) {
      note.x = x + 2;
      note.y = y;
      this.displayObjects.push(note);
      y += note.height + 5;
    }

    // Cannot counter case (defender only)
    if (!isAttacker && !info.canCounter) {
      const noCounter = applyTextResolution(
        scene.add.text(x + sideW / 2, y + 4, '-- No Counter --', {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: UI_PALETTE.bad,
        }),
      )
        .setOrigin(0.5, 0)
        .setDepth(textDepth);
      this.displayObjects.push(noCounter);

      y += 20;
      const wpnName = unit.weapon?.name || 'Unarmed';
      const wpn = applyTextResolution(
        scene.add.text(x + 2, y, wpnName, {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: UI_PALETTE.info,
        }),
      ).setDepth(textDepth);
      this.displayObjects.push(wpn);
      return;
    }

    // Stat row 1: Dmg + Hit
    const dmgLabel = applyTextResolution(
      scene.add.text(x + 2, y, 'Damage/hit', {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.muted,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(dmgLabel);
    const dmgVal = applyTextResolution(
      scene.add.text(x + 64, y, `${info.damage}`, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.text,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(dmgVal);

    const hitLabel = applyTextResolution(
      scene.add.text(x + 94, y, 'Hit rating', {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.muted,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(hitLabel);
    const hitVal = applyTextResolution(
      scene.add.text(x + 148, y, `${info.hit}`, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.text,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(hitVal);

    y += 14;

    // Stat row 2: Crt + doubling
    const crtLabel = applyTextResolution(
      scene.add.text(x + 2, y, 'Crt', {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.muted,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(crtLabel);
    const crtVal = applyTextResolution(
      scene.add.text(x + 32, y, `${info.crit}%`, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.text,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(crtVal);

    // AS display
    const baseAs = calculateEffectiveSpeed(unit, unit.weapon);
    let asColor = UI_PALETTE.text;
    if (info.as < baseAs) asColor = UI_PALETTE.bad;
    else if (info.as > baseAs) asColor = UI_PALETTE.good;
    const asLabel = applyTextResolution(
      scene.add.text(x + 80, y, 'AS', {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.muted,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(asLabel);
    const asVal = applyTextResolution(
      scene.add.text(x + 108, y, `${info.as}`, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: asColor,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(asVal);

    y += 14;
    const countText = applyTextResolution(
      scene.add.text(x + 2, y, `Planned hits: ${info.attackCount || 1}x`, {
        fontFamily: 'Arial',
        fontSize: '10px',
        color: UI_PALETTE.accent,
      }),
    ).setDepth(textDepth);
    this.displayObjects.push(countText);
    y += 14;

    // Weapon name (with <- -> arrows + next weapon preview if attacker has 2+ valid weapons)
    const wpnName = unit.weapon?.name || 'Unarmed';
    const wpnColor = unit.weapon && isForged(unit.weapon) ? UI_PALETTE.good : UI_PALETTE.info;
    const validWpns = opts.validWeapons;
    const canCycle = isAttacker && validWpns?.length >= 2;

    if (canCycle) {
      // Left arrow
      const leftArrow = applyTextResolution(
        scene.add.text(x + 1, y - 2, '\u25C4', {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.muted,
        }),
      )
        .setDepth(textDepth)
        .setInteractive({ useHandCursor: true });
      leftArrow.on('pointerover', () => leftArrow.setColor(UI_PALETTE.accent));
      leftArrow.on('pointerout', () => leftArrow.setColor(UI_PALETTE.muted));
      leftArrow.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        scene._uiClickBlocked = true;
        scene._cycleForecastWeapon(-1);
      });
      this.displayObjects.push(leftArrow);

      // Current weapon name (centered between arrows)
      const wpn = applyTextResolution(
        scene.add.text(x + 16, y, wpnName, {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: wpnColor,
        }),
      ).setDepth(textDepth);
      this.displayObjects.push(wpn);

      // Right arrow
      const rightArrow = applyTextResolution(
        scene.add.text(x + sideW - 14, y - 2, '\u25BA', {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.muted,
        }),
      )
        .setDepth(textDepth)
        .setInteractive({ useHandCursor: true });
      rightArrow.on('pointerover', () => rightArrow.setColor(UI_PALETTE.accent));
      rightArrow.on('pointerout', () => rightArrow.setColor(UI_PALETTE.muted));
      rightArrow.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        scene._uiClickBlocked = true;
        scene._cycleForecastWeapon(1);
      });
      this.displayObjects.push(rightArrow);

      // Next weapon preview (right arrow direction)
      const curIdx = validWpns.indexOf(unit.weapon);
      const nextIdx = (curIdx + 1) % validWpns.length;
      const nextWpn = validWpns[nextIdx];
      if (nextWpn) {
        const preview = applyTextResolution(
          scene.add.text(x + 2, y + 11, `\u25BA ${nextWpn.name}`, {
            fontFamily: 'Arial',
            fontSize: '8px',
            color: '#666688',
          }),
        ).setDepth(textDepth);
        this.displayObjects.push(preview);
      }
    } else {
      const wpn = applyTextResolution(
        scene.add.text(x + 2, y, wpnName, {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: wpnColor,
        }),
      ).setDepth(textDepth);
      this.displayObjects.push(wpn);
    }

    y += 12;

    // Skills + Miracle (combined on one line if both present)
    const parts = [];
    if (info.skills?.length) {
      parts.push(info.skills.map((s) => s.name).join(', '));
    }
    if (unit.skills?.includes('miracle')) {
      const used = unit._miracleUsed;
      parts.push(`Miracle: ${used ? 'Used' : 'Ready'}`);
    }
    if (parts.length) {
      const skillText = applyTextResolution(
        scene.add.text(x + 2, y, parts.join('  '), {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: UI_PALETTE.info,
          wordWrap: { width: sideW - 6 },
        }),
      ).setDepth(textDepth);
      this.displayObjects.push(skillText);
      y += skillText.height + 2;
    }

    if (isAttacker && opts.weaponArt) {
      const hpCost = scene._formatWeaponArtCostLabel(unit, opts.weaponArt);
      const hpNow = Number(unit.currentHP) || 0;
      const hpAfter = scene._getWeaponArtHpAfterCost(unit, opts.weaponArt);
      const artText = applyTextResolution(
        scene.add.text(
          x + 2,
          y,
          `ART: ${opts.weaponArt.name}  (HP-${hpCost} ${hpNow}->${hpAfter})`,
          {
            fontFamily: 'Arial',
            fontSize: '9px',
            color: '#ffd98a',
            wordWrap: { width: sideW - 6 },
          },
        ),
      ).setDepth(textDepth);
      this.displayObjects.push(artText);
      y += artText.height + 2;
    }

    if (isAttacker && opts.gamblerLine) {
      const gamblerText = applyTextResolution(
        scene.add.text(x + 2, y, opts.gamblerLine, {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: '#ffb38a',
          wordWrap: { width: sideW - 6 },
        }),
      ).setDepth(textDepth);
      this.displayObjects.push(gamblerText);
      y += gamblerText.height + 2;
    }

    if (info.warnings?.length) {
      y += 2;
      for (const warn of info.warnings) {
        let label = warn.toUpperCase();
        let color = UI_PALETTE.warn;
        if (warn === 'Shielded') {
          label = '[BLOCK]';
          color = UI_PALETTE.info;
        }
        if (warn === 'Thorns') {
          label = '[REFLECT]';
          color = UI_PALETTE.bad;
        }
        if (warn === 'Teleporter') {
          label = '[WARP]';
          color = UI_PALETTE.rarityEpic;
        }

        const warningText = applyTextResolution(
          scene.add.text(x + 2, y, label, {
            fontFamily: 'Arial',
            fontSize: '10px',
            color,
            fontStyle: 'bold',
            backgroundColor: '#00000088',
            padding: { x: 4, y: 1 },
          }),
        ).setDepth(textDepth);
        this.displayObjects.push(warningText);
        y += 14;
      }
    }
  }

  /**
   * Render the footer: responsive hint text + CONFIRM ATTACK button.
   */
  _drawFooter(panelX, panelY, panelW, panelH, depth, validWeapons) {
    const scene = this.scene;

    const hintStyle = { fontFamily: 'Arial', fontSize: '8px', color: UI_PALETTE.muted };
    const hintPrimary =
      validWeapons.length >= 2
        ? 'Click enemy or [CONFIRM ATTACK] | \u25C4 \u25BA weapon | ESC cancel'
        : 'Click enemy or [CONFIRM ATTACK] | ESC cancel';
    const hintCompact =
      validWeapons.length >= 2
        ? 'Click enemy or button | \u25C4 \u25BA weapon | ESC cancel'
        : 'Click enemy or button | ESC cancel';
    const hintUltraCompact =
      validWeapons.length >= 2 ? '[CONFIRM] | \u25C4 \u25BA weapon | ESC' : '[CONFIRM] | ESC';

    const measureHint = (text) => {
      const t = applyTextResolution(scene.add.text(-9999, -9999, text, hintStyle)).setVisible(
        false,
      );
      const w = t.width;
      t.destroy();
      return w;
    };

    const confirmBtnW = 132;
    const confirmBtnH = 14;
    const footerLeftPad = 10;
    const footerRightPad = 8;
    const btnGap = 8;
    const hintMaxSingleRow = panelW - footerLeftPad - footerRightPad - confirmBtnW - btnGap - 4;

    let hintText = hintPrimary;
    if (measureHint(hintText) > hintMaxSingleRow) hintText = hintCompact;
    if (measureHint(hintText) > hintMaxSingleRow) hintText = hintUltraCompact;

    // Stack hint/button when viewport is narrow or compact hint still does not fit.
    const useTwoRows = scene.cameras.main.width < 460 || measureHint(hintText) > hintMaxSingleRow;
    const footerH = useTwoRows ? 32 : 16;
    const footerTop = panelY + panelH - (useTwoRows ? 34 : 18);
    const hintY = useTwoRows ? footerTop + 8 : footerTop + 9;
    const confirmBtnY = useTwoRows ? footerTop + 24 : footerTop + 9;
    const confirmBtnX = useTwoRows
      ? panelX + panelW / 2
      : panelX + panelW - footerRightPad - confirmBtnW / 2;
    const hintX = panelX + footerLeftPad;
    const hintWrapW = useTwoRows ? panelW - footerLeftPad - footerRightPad - 2 : hintMaxSingleRow;

    const hintBg = scene.add
      .rectangle(panelX + panelW / 2, footerTop + footerH / 2, panelW - 4, footerH, 0x0a0a15, 0.8)
      .setDepth(depth);
    this.displayObjects.push(hintBg);

    const confirmBtnBg = scene.add
      .rectangle(confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, UI_HEX.hpHigh, 0.95)
      .setDepth(depth + 1)
      .setStrokeStyle(1, 0x4dff77)
      .setInteractive({ useHandCursor: true });
    const confirmBtnText = applyTextResolution(
      scene.add.text(confirmBtnX, confirmBtnY, 'CONFIRM ATTACK', {
        fontFamily: 'Arial',
        fontSize: '9px',
        color: UI_PALETTE.good,
        fontStyle: 'bold',
      }),
    )
      .setOrigin(0.5)
      .setDepth(depth + 2);
    confirmBtnBg.on('pointerover', () => {
      confirmBtnBg.setFillStyle(0x2c7b3a, 1);
      confirmBtnText.setColor(UI_PALETTE.text);
    });
    confirmBtnBg.on('pointerout', () => {
      confirmBtnBg.setFillStyle(UI_HEX.hpHigh, 0.95);
      confirmBtnText.setColor(UI_PALETTE.good);
    });
    confirmBtnBg.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._uiClickBlocked = true;
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      scene.confirmForecastCombat();
    });
    this.displayObjects.push(confirmBtnBg, confirmBtnText);

    const hint = applyTextResolution(
      scene.add.text(hintX, hintY, hintText, {
        ...hintStyle,
        wordWrap: { width: hintWrapW, useAdvancedWrap: false },
      }),
    )
      .setOrigin(0, 0.5)
      .setDepth(depth + 1);
    this.displayObjects.push(hint);
  }

  /**
   * Destroy all display objects and clear the array in-place.
   * Uses .length = 0 (not reassignment) so BattleScene's alias stays valid.
   */
  destroy() {
    this.mobileHud?.hideForecast();
    this.mobileHud = null;
    for (const obj of this.displayObjects) {
      try {
        obj.destroy();
      } catch {
        // already destroyed — safe to ignore
      }
    }
    this.displayObjects.length = 0;
  }
}
