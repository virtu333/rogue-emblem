/**
 * ForecastOverlay — extracted from BattleScene.
 * Renders the combat forecast panel (FE GBA-style split layout).
 * All state mutations, weapon selection, and skill context remain on BattleScene.
 */
import { getEffectivenessMultiplier, calculateEffectiveSpeed } from '../engine/Combat.js';
import { isForged } from '../engine/ForgeSystem.js';
import { getHPBarColor } from '../utils/uiStyles.js';

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
    const depth = 200;
    const panelW = 380;

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
    const panelH = Math.max(152, 152 + Math.max(_atkExtraH, _defExtraH));
    const panelX = (scene.cameras.main.width - panelW) / 2;
    const panelY = scene.cameras.main.height - panelH - 10;
    const halfW = (panelW - 8) / 2; // 186 per side

    // Panel background
    const bg = scene.add
      .rectangle(panelX + panelW / 2, panelY + panelH / 2, panelW, panelH, 0x111122, 0.95)
      .setDepth(depth)
      .setStrokeStyle(2, 0x4466aa);
    this.displayObjects.push(bg);

    // Draw attacker (left) and defender (right)
    this._drawSide(panelX + 4, panelY, attacker, forecast.attacker, defender, true, depth, {
      weaponArt,
      gamblerLine,
      validWeapons,
    });
    this._drawSide(
      panelX + halfW + 8,
      panelY,
      defender,
      forecast.defender,
      attacker,
      false,
      depth,
      { weaponArt: null, gamblerLine: null, validWeapons: null },
    );

    // Center divider + VS
    const divGfx = scene.add.graphics().setDepth(depth + 1);
    divGfx.lineStyle(1, 0x444466);
    divGfx.lineBetween(panelX + panelW / 2, panelY + 8, panelX + panelW / 2, panelY + panelH - 22);
    this.displayObjects.push(divGfx);

    const vs = scene.add
      .text(panelX + panelW / 2, panelY + 28, 'VS', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#666688',
      })
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
    const portraitKey = scene._getPortraitKey(unit);
    if (portraitKey && scene.textures.exists(portraitKey)) {
      const px = isAttacker ? x + 2 : x + sideW - 42;
      const portrait = scene.add
        .image(px + 20, y + 20, portraitKey)
        .setDisplaySize(40, 40)
        .setDepth(textDepth);
      this.displayObjects.push(portrait);
    }

    // Name -- positioned next to portrait
    const nameX = isAttacker ? x + 48 : x + 2;
    const name = scene.add
      .text(nameX, y + 6, unit.name, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffdd44',
        fontStyle: 'bold',
      })
      .setDepth(textDepth);
    this.displayObjects.push(name);

    // EFFECTIVE! banner -- below name, beside portrait
    if (
      unit.weapon &&
      getEffectivenessMultiplier(unit.weapon, opponent) > 1 &&
      (isAttacker || info.canCounter)
    ) {
      const eff = scene.add
        .text(nameX, y + 22, 'EFFECTIVE!', {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#ff4444',
          fontStyle: 'bold',
        })
        .setDepth(textDepth);
      this.displayObjects.push(eff);
    }

    // HP row -- below portrait area
    y += 44;
    const hpLabel = scene.add
      .text(x + 2, y, 'HP', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#aaaaaa',
      })
      .setDepth(textDepth);
    this.displayObjects.push(hpLabel);

    const hpVal = scene.add
      .text(x + 22, y, `${unit.currentHP}/${unit.stats.HP}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffffff',
      })
      .setDepth(textDepth);
    this.displayObjects.push(hpVal);

    // HP bar
    const barX = x + 80;
    const barW = sideW - 86;
    const barH = 6;
    const barY = y + 4;
    const hpGfx = scene.add.graphics().setDepth(textDepth);
    hpGfx.fillStyle(0x333333);
    hpGfx.fillRect(barX, barY, barW, barH);
    const ratio = Math.max(0, unit.currentHP / unit.stats.HP);
    hpGfx.fillStyle(getHPBarColor(ratio));
    hpGfx.fillRect(barX, barY, Math.round(barW * ratio), barH);
    this.displayObjects.push(hpGfx);

    y += 16;

    // Cannot counter case (defender only)
    if (!isAttacker && !info.canCounter) {
      const noCounter = scene.add
        .text(x + sideW / 2, y + 4, '-- No Counter --', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#cc6666',
        })
        .setOrigin(0.5, 0)
        .setDepth(textDepth);
      this.displayObjects.push(noCounter);

      y += 20;
      const wpnName = unit.weapon?.name || 'Unarmed';
      const wpn = scene.add
        .text(x + 2, y, wpnName, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#88bbff',
        })
        .setDepth(textDepth);
      this.displayObjects.push(wpn);
      return;
    }

    // Stat row 1: Dmg + Hit
    const dmgLabel = scene.add
      .text(x + 2, y, 'Dmg', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
      })
      .setDepth(textDepth);
    this.displayObjects.push(dmgLabel);
    const dmgVal = scene.add
      .text(x + 32, y, `${info.damage}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e0e0e0',
      })
      .setDepth(textDepth);
    this.displayObjects.push(dmgVal);

    const hitLabel = scene.add
      .text(x + 80, y, 'Hit', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
      })
      .setDepth(textDepth);
    this.displayObjects.push(hitLabel);
    const hitVal = scene.add
      .text(x + 108, y, `${info.hit}%`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e0e0e0',
      })
      .setDepth(textDepth);
    this.displayObjects.push(hitVal);

    y += 14;

    // Stat row 2: Crt + doubling
    const crtLabel = scene.add
      .text(x + 2, y, 'Crt', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
      })
      .setDepth(textDepth);
    this.displayObjects.push(crtLabel);
    const crtVal = scene.add
      .text(x + 32, y, `${info.crit}%`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#e0e0e0',
      })
      .setDepth(textDepth);
    this.displayObjects.push(crtVal);

    // AS display
    const baseAs = calculateEffectiveSpeed(unit, unit.weapon);
    let asColor = '#e0e0e0';
    if (info.as < baseAs) asColor = '#ff6666';
    else if (info.as > baseAs) asColor = '#44ff88';
    const asLabel = scene.add
      .text(x + 80, y, 'AS', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
      })
      .setDepth(textDepth);
    this.displayObjects.push(asLabel);
    const asVal = scene.add
      .text(x + 108, y, `${info.as}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: asColor,
      })
      .setDepth(textDepth);
    this.displayObjects.push(asVal);

    // Doubling indicator
    if (info.attackCount > 1) {
      const countText = scene.add
        .text(x + 134, y, `x${info.attackCount}`, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#ffdd44',
          fontStyle: 'bold',
        })
        .setDepth(textDepth);
      this.displayObjects.push(countText);
    }

    y += 14;

    // Weapon name (with <- -> arrows + next weapon preview if attacker has 2+ valid weapons)
    const wpnName = unit.weapon?.name || 'Unarmed';
    const wpnColor = unit.weapon && isForged(unit.weapon) ? '#44ff88' : '#88bbff';
    const validWpns = opts.validWeapons;
    const canCycle = isAttacker && validWpns?.length >= 2;

    if (canCycle) {
      // Left arrow
      const leftArrow = scene.add
        .text(x + 1, y - 2, '\u25C4', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#888888',
        })
        .setDepth(textDepth)
        .setInteractive({ useHandCursor: true });
      leftArrow.on('pointerover', () => leftArrow.setColor('#ffdd44'));
      leftArrow.on('pointerout', () => leftArrow.setColor('#888888'));
      leftArrow.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        scene._uiClickBlocked = true;
        scene._cycleForecastWeapon(-1);
      });
      this.displayObjects.push(leftArrow);

      // Current weapon name (centered between arrows)
      const wpn = scene.add
        .text(x + 16, y, wpnName, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: wpnColor,
        })
        .setDepth(textDepth);
      this.displayObjects.push(wpn);

      // Right arrow
      const rightArrow = scene.add
        .text(x + sideW - 14, y - 2, '\u25BA', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#888888',
        })
        .setDepth(textDepth)
        .setInteractive({ useHandCursor: true });
      rightArrow.on('pointerover', () => rightArrow.setColor('#ffdd44'));
      rightArrow.on('pointerout', () => rightArrow.setColor('#888888'));
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
        const preview = scene.add
          .text(x + 2, y + 11, `\u25BA ${nextWpn.name}`, {
            fontFamily: 'monospace',
            fontSize: '8px',
            color: '#666688',
          })
          .setDepth(textDepth);
        this.displayObjects.push(preview);
      }
    } else {
      const wpn = scene.add
        .text(x + 2, y, wpnName, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: wpnColor,
        })
        .setDepth(textDepth);
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
      const skillText = scene.add
        .text(x + 2, y, parts.join('  '), {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#aaddff',
          wordWrap: { width: sideW - 6 },
        })
        .setDepth(textDepth);
      this.displayObjects.push(skillText);
      y += skillText.height + 2;
    }

    if (isAttacker && opts.weaponArt) {
      const hpCost = scene._formatWeaponArtCostLabel(unit, opts.weaponArt);
      const hpNow = Number(unit.currentHP) || 0;
      const hpAfter = scene._getWeaponArtHpAfterCost(unit, opts.weaponArt);
      const artText = scene.add
        .text(x + 2, y, `ART: ${opts.weaponArt.name}  (HP-${hpCost} ${hpNow}->${hpAfter})`, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#ffd98a',
          wordWrap: { width: sideW - 6 },
        })
        .setDepth(textDepth);
      this.displayObjects.push(artText);
      y += artText.height + 2;
    }

    if (isAttacker && opts.gamblerLine) {
      const gamblerText = scene.add
        .text(x + 2, y, opts.gamblerLine, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#ffb38a',
          wordWrap: { width: sideW - 6 },
        })
        .setDepth(textDepth);
      this.displayObjects.push(gamblerText);
      y += gamblerText.height + 2;
    }

    if (info.warnings?.length) {
      y += 2;
      for (const warn of info.warnings) {
        let label = warn.toUpperCase();
        let color = '#ffcc88';
        if (warn === 'Shielded') {
          label = '[BLOCK]';
          color = '#88ccff';
        }
        if (warn === 'Thorns') {
          label = '[REFLECT]';
          color = '#ff8888';
        }
        if (warn === 'Teleporter') {
          label = '[WARP]';
          color = '#cc88ff';
        }

        const warningText = scene.add
          .text(x + 2, y, label, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color,
            fontStyle: 'bold',
            backgroundColor: '#00000088',
            padding: { x: 4, y: 1 },
          })
          .setDepth(textDepth);
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

    const hintStyle = { fontFamily: 'monospace', fontSize: '8px', color: '#a0a0b8' };
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
      const t = scene.add.text(-9999, -9999, text, hintStyle).setVisible(false);
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
      .rectangle(confirmBtnX, confirmBtnY, confirmBtnW, confirmBtnH, 0x1d5f2a, 0.95)
      .setDepth(depth + 1)
      .setStrokeStyle(1, 0x4dff77)
      .setInteractive({ useHandCursor: true });
    const confirmBtnText = scene.add
      .text(confirmBtnX, confirmBtnY, 'CONFIRM ATTACK', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#d8ffe1',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(depth + 2);
    confirmBtnBg.on('pointerover', () => {
      confirmBtnBg.setFillStyle(0x2c7b3a, 1);
      confirmBtnText.setColor('#ffffff');
    });
    confirmBtnBg.on('pointerout', () => {
      confirmBtnBg.setFillStyle(0x1d5f2a, 0.95);
      confirmBtnText.setColor('#d8ffe1');
    });
    confirmBtnBg.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._uiClickBlocked = true;
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      scene.confirmForecastCombat();
    });
    this.displayObjects.push(confirmBtnBg, confirmBtnText);

    const hint = scene.add
      .text(hintX, hintY, hintText, {
        ...hintStyle,
        wordWrap: { width: hintWrapW, useAdvancedWrap: false },
      })
      .setOrigin(0, 0.5)
      .setDepth(depth + 1);
    this.displayObjects.push(hint);
  }

  /**
   * Destroy all display objects and clear the array in-place.
   * Uses .length = 0 (not reassignment) so BattleScene's alias stays valid.
   */
  destroy() {
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
