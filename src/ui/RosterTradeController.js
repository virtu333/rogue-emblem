// RosterTradeController -- trade state machine extracted from RosterOverlay.
// Owns the trade target picker, unit picker, two-column trade screen, and the
// item detail pane. All trade state stays on the overlay (tradeObjects,
// _tradeDetailObjects, _tradeDetailPaneY, ...) because the overlay's other
// pickers reuse the same trade layer; cross-cutting seams are invoked via the
// overlay's delegating wrappers so tests can intercept them as before.

import { INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';
import {
  addToInventory,
  removeFromInventory,
  hasProficiency,
  canEquip,
} from '../engine/UnitManager.js';
import { getStaffRemainingUses, getStaffMaxUses, parseRange } from '../engine/Combat.js';
import { getConsumableDescription } from '../utils/consumableText.js';
import { hasWeaponArt } from './WeaponArtVisibility.js';
import {
  DEPTH_PICKER,
  DETAIL_X,
  DETAIL_WIDTH,
  formatUnitCapacityLabel,
} from './rosterOverlayShared.js';

export class RosterTradeController {
  constructor(overlay) {
    this.overlay = overlay;
  }

  _destroyTrade() {
    const overlay = this.overlay;
    if (overlay._tradeDetailObjects) {
      for (const obj of overlay._tradeDetailObjects) obj.destroy();
      overlay._tradeDetailObjects = [];
    }
    for (const obj of overlay.tradeObjects) obj.destroy();
    overlay.tradeObjects = [];
  }

  _drawTradeDetailPane(item, ownerUnit, recipientUnit) {
    const overlay = this.overlay;
    // Clear previous detail content
    if (overlay._tradeDetailObjects) {
      for (const obj of overlay._tradeDetailObjects) obj.destroy();
    }
    overlay._tradeDetailObjects = [];
    const paneY = overlay._tradeDetailPaneY;
    if (paneY == null) return;

    const paneX = DETAIL_X + 20;
    const depth = DEPTH_PICKER + 2;
    const addText = (x, y, str, color = '#e0e0e0', fontSize = '10px') => {
      const t = overlay.scene.add
        .text(x, y, str, {
          fontFamily: 'monospace',
          fontSize,
          color,
        })
        .setDepth(depth);
      overlay._tradeDetailObjects.push(t);
      return t;
    };

    if (!item) {
      addText(DETAIL_X + DETAIL_WIDTH / 2 - 60, paneY + 20, 'Hover item for details', '#666666');
      return;
    }

    // --- Consumable detail ---
    if (item.type === 'Consumable') {
      addText(
        paneX,
        paneY + 6,
        `${item.name} (${item.uses} use${item.uses !== 1 ? 's' : ''})`,
        '#88ff88',
        '11px',
      );
      const effectLabel = getConsumableDescription(item) || item.effect || '';
      addText(paneX, paneY + 22, `Effect: ${effectLabel}`, '#bbbbbb');
      if (item.price) addText(paneX, paneY + 36, `Value: ${item.price}G`, '#888888');
      return;
    }

    // --- Weapon/Staff detail ---
    const line1Y = paneY + 4;
    const line2Y = paneY + 18;
    const line3Y = paneY + 32;

    // Line 1: Type + full name
    const baseName = overlay._getWeaponBaseName(item);
    const forgeLevel = overlay._getWeaponForgeLevel(item);
    const fullName = forgeLevel > 0 ? `${baseName} +${forgeLevel}` : baseName;
    const typeLabel = item.type || '';
    addText(paneX, line1Y, `${typeLabel}:`, '#aaaaaa');
    addText(
      paneX + typeLabel.length * 6 + 12,
      line1Y,
      fullName,
      overlay._getWeaponNameColor(item, '#e0e0e0'),
      '11px',
    );

    // Line 2: Stats
    if (item.type === 'Staff') {
      const rem = ownerUnit ? getStaffRemainingUses(item, ownerUnit) : '?';
      const max = ownerUnit ? getStaffMaxUses(item, ownerUnit) : '?';
      const healBase = item.healBase != null ? `Heal: MAG+${item.healBase}` : '';
      addText(paneX, line2Y, `${healBase}  Uses: ${rem}/${max}`, '#bbbbbb');
      if (item.range) {
        const rng = parseRange(item.range);
        const rngStr = rng.min === rng.max ? `${rng.max}` : `${rng.min}-${rng.max}`;
        addText(paneX + 240, line2Y, `Rng ${rngStr}`, '#bbbbbb');
      }
    } else if (item.might !== undefined) {
      const rng = parseRange(item.range);
      const rngStr = rng.min === rng.max ? `${rng.max}` : `${rng.min}-${rng.max}`;
      let cx = paneX;
      const stats = [
        ['Mt', item.might, 'might'],
        ['Hit', item.hit, 'hit'],
        ['Crit', item.crit, 'crit'],
        ['Wt', item.weight, 'weight'],
      ];
      for (const [label, val, key] of stats) {
        const color = overlay._getForgeStatColor(item, key, '#bbbbbb');
        addText(cx, line2Y, `${label}${val}`, color);
        cx += `${label}${val}`.length * 6 + 10;
      }
      addText(cx, line2Y, `Rng ${rngStr}`, '#bbbbbb');
    }

    // Line 3: Special / proficiency warning
    const parts = [];
    if (item.special) parts.push(item.special);
    if (recipientUnit && !hasProficiency(recipientUnit, item)) {
      parts.push(`\u26a0 ${recipientUnit.name} cannot equip`);
    }
    if (parts.length > 0) {
      const specialColor =
        recipientUnit && !hasProficiency(recipientUnit, item) ? '#cc8844' : '#aaaaaa';
      addText(paneX, line3Y, parts.join('  |  '), specialColor);
    }
  }

  _showTradePicker(sourceUnit) {
    const overlay = this.overlay;
    overlay._destroyTrade();

    const roster = overlay.runManager.roster;
    const targets = roster.filter((_, i) => i !== overlay.selection.index);
    const cx = 320;
    const itemH = 28;
    const titleH = 30;
    const pad = 12;
    const totalH = titleH + targets.length * itemH + itemH + pad; // title + targets + cancel + padding
    const cy = 240;
    const topY = cy - totalH / 2;

    const pickerBg = overlay.scene.add
      .rectangle(cx, cy, 360, totalH, 0x222222, 0.95)
      .setDepth(DEPTH_PICKER)
      .setStrokeStyle(1, 0x888888);
    overlay.tradeObjects.push(pickerBg);

    const pickerTitle = overlay.scene.add
      .text(cx, topY + pad, 'Trade with:', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_PICKER + 1);
    overlay.tradeObjects.push(pickerTitle);

    targets.forEach((unit, i) => {
      const y = topY + titleH + i * itemH + pad;
      const btn = overlay.scene.add
        .text(cx, y, formatUnitCapacityLabel(unit, 18), {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#e0e0e0',
          backgroundColor: '#444444',
          padding: { x: 12, y: 3 },
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_PICKER + 1)
        .setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor('#e0e0e0'));
      btn.on('pointerdown', () => {
        overlay._destroyTrade();
        overlay._showTradeScreen(sourceUnit, unit);
      });
      overlay.tradeObjects.push(btn);
    });

    // Cancel
    const cancelY = topY + titleH + targets.length * itemH + pad;
    const cancelBtn = overlay.scene.add
      .text(cx, cancelY, 'Cancel', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
        backgroundColor: '#333333',
        padding: { x: 10, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_PICKER + 1)
      .setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#888888'));
    cancelBtn.on('pointerdown', () => overlay._destroyTrade());
    overlay.tradeObjects.push(cancelBtn);
  }

  showUnitPicker(onSelect) {
    const overlay = this.overlay;
    overlay._destroyTrade();

    const roster = overlay.runManager.roster;
    const cx = 320;
    const itemH = 28;
    const titleH = 30;
    const pad = 12;
    const totalH = titleH + roster.length * itemH + itemH + pad;
    const cy = 240;
    const topY = cy - totalH / 2;

    const pickerBg = overlay.scene.add
      .rectangle(cx, cy, 260, totalH, 0x222222, 0.95)
      .setDepth(DEPTH_PICKER)
      .setStrokeStyle(1, 0x888888);
    overlay.tradeObjects.push(pickerBg);

    const pickerTitle = overlay.scene.add
      .text(cx, topY + pad, 'Select Unit:', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_PICKER + 1);
    overlay.tradeObjects.push(pickerTitle);

    roster.forEach((unit, i) => {
      const y = topY + titleH + i * itemH + pad;
      const btn = overlay.scene.add
        .text(cx, y, unit.name, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#e0e0e0',
          backgroundColor: '#444444',
          padding: { x: 12, y: 3 },
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_PICKER + 1)
        .setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor('#e0e0e0'));
      btn.on('pointerdown', () => {
        overlay._destroyTrade();
        onSelect(i);
      });
      overlay.tradeObjects.push(btn);
    });

    const cancelY = topY + titleH + roster.length * itemH + pad;
    const cancelBtn = overlay.scene.add
      .text(cx, cancelY, 'Cancel', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
        backgroundColor: '#333333',
        padding: { x: 10, y: 3 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_PICKER + 1)
      .setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#888888'));
    cancelBtn.on('pointerdown', () => overlay._destroyTrade());
    overlay.tradeObjects.push(cancelBtn);
  }

  _showTradeScreen(unitA, unitB) {
    const overlay = this.overlay;
    overlay._destroyTrade();

    const leftX = DETAIL_X + 20;
    const rightX = DETAIL_X + 230;
    let y = 55;

    // Detail pane dimensions
    const DETAIL_PANE_H = 56;

    // Trade overlay bg (extra height for detail pane)
    const tradeBg = overlay.scene.add
      .rectangle(DETAIL_X + DETAIL_WIDTH / 2, 240, DETAIL_WIDTH, 480, 0x1a1a2e, 0.98)
      .setDepth(DEPTH_PICKER)
      .setStrokeStyle(1, 0x888888);
    overlay.tradeObjects.push(tradeBg);

    // Init detail pane tracking
    overlay._tradeDetailObjects = [];

    overlay._tradeText(leftX + 80, y, 'Trade Items', '#ffdd44', '14px');
    y += 22;

    // Column headers
    overlay._tradeText(leftX, y, formatUnitCapacityLabel(unitA, 11), '#e0e0e0', '11px');
    overlay._tradeText(rightX, y, formatUnitCapacityLabel(unitB, 11), '#e0e0e0', '11px');
    y += 18;

    // Left side items (unitA) → click to give to unitB
    const drawSide = (unit, otherUnit, xPos, startY) => {
      let sy = startY;
      const inventory = unit.inventory || [];
      const otherInventory = otherUnit.inventory || [];

      // Inventory
      if (inventory.length === 0) {
        overlay._tradeText(xPos, sy, '(empty)', '#888888', '10px');
        sy += 14;
      } else {
        for (const item of [...inventory]) {
          const marker = item === unit.weapon ? '\u25b6 ' : '  ';
          const noProf = !hasProficiency(otherUnit, item);
          const ownerUsable = canEquip(unit, item);
          const rowColor = ownerUsable ? '#e0e0e0' : '#777777';
          const baseNameColor = ownerUsable
            ? overlay._getWeaponNameColor(item, rowColor)
            : rowColor;
          const forgeSuffixSegments = ownerUsable
            ? overlay._getWeaponForgeSuffixSegments(item)
            : overlay._getWeaponForgeSuffixSegments(item).map((segment) => ({
                ...segment,
                color: rowColor,
              }));
          const nameColor = noProf ? '#cc8844' : baseNameColor;
          const segments = [
            { text: marker, color: rowColor },
            { text: overlay._getWeaponBaseName(item), color: nameColor },
            ...forgeSuffixSegments,
          ];
          if (hasWeaponArt(item, overlay.gameData?.weaponArts?.arts || [])) {
            segments.push({ text: '*', color: rowColor });
          }
          if (item.type === 'Staff') {
            const rem = getStaffRemainingUses(item, unit);
            const max = getStaffMaxUses(item, unit);
            segments.push({ text: ` (${rem}/${max})`, color: rowColor });
          }

          if (otherInventory.length < INVENTORY_MAX) {
            const interactiveSegments = [...segments, { text: '  \u25b6', color: '#e0e0e0' }];
            const row = overlay._tradeTextSegments(xPos, sy, interactiveSegments, '10px');
            const hit = overlay.scene.add
              .rectangle(
                xPos + Math.max(row.width, 12) / 2,
                sy + 6,
                Math.max(row.width, 12),
                12,
                0x000000,
                0,
              )
              .setOrigin(0.5)
              .setDepth(DEPTH_PICKER + 3)
              .setInteractive({ useHandCursor: true });
            const restore = () => {
              row.texts.forEach((t, idx) =>
                t.setColor(interactiveSegments[idx]?.color || '#e0e0e0'),
              );
            };
            hit.on('pointerover', () => {
              row.texts.forEach((t) => t.setColor('#ffdd44'));
              overlay._drawTradeDetailPane(item, unit, otherUnit);
            });
            hit.on('pointerout', () => {
              restore();
              overlay._drawTradeDetailPane(null);
            });
            hit.on('pointerdown', () => {
              removeFromInventory(unit, item);
              addToInventory(otherUnit, item);
              overlay._showTradeScreen(unitA, unitB); // redraw
            });
            overlay.tradeObjects.push(hit);
          } else {
            const disabledSegments = segments.map((segment) => ({ ...segment, color: '#666666' }));
            overlay._tradeTextSegments(xPos, sy, disabledSegments, '10px');
          }
          sy += 14;
        }
      }

      // Consumables
      const consumables = unit.consumables || [];
      if (consumables.length > 0) {
        for (const item of [...consumables]) {
          const marker = '  ';
          const color = '#88ff88';
          const label = `${marker}${item.name} (${item.uses})`;

          if ((otherUnit.consumables || []).length < CONSUMABLE_MAX) {
            const btn = overlay.scene.add
              .text(xPos, sy, label + '  \u25b6', {
                fontFamily: 'monospace',
                fontSize: '10px',
                color,
              })
              .setDepth(DEPTH_PICKER + 2)
              .setInteractive({ useHandCursor: true });
            btn.on('pointerover', () => {
              btn.setColor('#ffdd44');
              overlay._drawTradeDetailPane(item, unit, otherUnit);
            });
            btn.on('pointerout', () => {
              btn.setColor(color);
              overlay._drawTradeDetailPane(null);
            });
            btn.on('pointerdown', () => {
              const idx = unit.consumables.indexOf(item);
              if (idx !== -1) unit.consumables.splice(idx, 1);
              if (!otherUnit.consumables) otherUnit.consumables = [];
              otherUnit.consumables.push(item);
              overlay._showTradeScreen(unitA, unitB); // redraw
            });
            overlay.tradeObjects.push(btn);
          } else {
            overlay._tradeText(xPos, sy, label, '#666666', '10px');
          }
          sy += 14;
        }
      }

      return sy;
    };

    const leftEnd = drawSide(unitA, unitB, leftX, y);
    const rightEnd = drawSide(unitB, unitA, rightX, y);
    const detailPaneY = Math.max(leftEnd, rightEnd) + 10;

    // Detail pane background (persistent area at bottom of item lists)
    const detailPaneBg = overlay.scene.add
      .rectangle(
        DETAIL_X + DETAIL_WIDTH / 2,
        detailPaneY + DETAIL_PANE_H / 2,
        DETAIL_WIDTH - 20,
        DETAIL_PANE_H,
        0x111122,
        0.95,
      )
      .setDepth(DEPTH_PICKER + 1)
      .setStrokeStyle(1, 0x555566);
    overlay.tradeObjects.push(detailPaneBg);
    overlay._tradeDetailPaneBg = detailPaneBg;
    overlay._tradeDetailPaneY = detailPaneY;

    // Default hint text
    overlay._drawTradeDetailPane(null);

    // Done button (below detail pane)
    const doneY = detailPaneY + DETAIL_PANE_H + 12;
    const doneBtn = overlay.scene.add
      .text(DETAIL_X + DETAIL_WIDTH / 2, doneY, '[ Done ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 16, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_PICKER + 2)
      .setInteractive({ useHandCursor: true });
    doneBtn.on('pointerover', () => doneBtn.setColor('#ffdd44'));
    doneBtn.on('pointerout', () => doneBtn.setColor('#e0e0e0'));
    doneBtn.on('pointerdown', () => {
      overlay._destroyTrade();
      overlay.refresh();
    });
    overlay.tradeObjects.push(doneBtn);

    // Resize bg to fit all content
    const totalH = doneY + 28 - (55 - 15); // from top padding to below Done
    tradeBg.setSize(DETAIL_WIDTH, totalH);
    tradeBg.setPosition(DETAIL_X + DETAIL_WIDTH / 2, 55 - 15 + totalH / 2);
  }

  _tradeText(x, y, str, color = '#e0e0e0', fontSize = '10px') {
    const overlay = this.overlay;
    const t = overlay.scene.add
      .text(x, y, str, {
        fontFamily: 'monospace',
        fontSize,
        color,
      })
      .setDepth(DEPTH_PICKER + 2);
    overlay.tradeObjects.push(t);
    return t;
  }

  _tradeTextSegments(x, y, segments, fontSize = '10px') {
    const overlay = this.overlay;
    let cursor = x;
    const texts = [];
    for (const segment of segments) {
      const text = String(segment?.text ?? '');
      if (!text) continue;
      const t = overlay.scene.add
        .text(cursor, y, text, {
          fontFamily: 'monospace',
          fontSize,
          color: segment?.color || '#e0e0e0',
        })
        .setDepth(DEPTH_PICKER + 2);
      overlay.tradeObjects.push(t);
      texts.push(t);
      cursor += t.width;
    }
    return { texts, width: Math.max(0, cursor - x) };
  }
  destroy() {
    this.overlay = null;
  }
}
