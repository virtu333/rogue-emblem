/**
 * LootScreenController — extracted from BattleScene.
 *
 * Instance method `renderCards()` builds the loot card UI.
 * Static methods handle sub-picker rendering and pure text helpers.
 * All flow methods (finalizeLootPick, cleanupLootScreen, etc.) stay on BattleScene.
 */
import { generateLootChoices, calculateSkipLootBonus } from '../engine/LootSystem.js';
import {
  addToInventory,
  addToConsumables,
  canEquip,
  applyStatBoost,
  gainExperience,
  checkLevelUpSkills,
} from '../engine/UnitManager.js';
import { canForge, canForgeStat } from '../engine/ForgeSystem.js';
import { getRating, calculateBonusGold } from '../engine/TurnBonusCalculator.js';
import {
  GOLD_BATTLE_BONUS,
  LOOT_CHOICES,
  ELITE_LOOT_CHOICES,
  INVENTORY_MAX,
  CONSUMABLE_MAX,
  FORGE_MAX_LEVEL,
  FORGE_STAT_CAP,
  GOLD_LOOT_REWARD_MULTIPLIER,
} from '../utils/constants.js';
import { applyTextResolution } from '../utils/uiStyles.js';
import { formatAccessoryDetail } from '../utils/accessoryText.js';
import { formatUses, getConsumableDescription } from '../utils/consumableText.js';
import { summarizeWeaponArtEffect } from '../ui/WeaponArtVisibility.js';
import { showMinorHint } from '../ui/HintDisplay.js';

export class LootScreenController {
  /**
   * @param {object} scene       — the BattleScene (or mock)
   * @param {object} runManager
   * @param {object} gameData
   * @param {object} ctx         — battle context snapshot
   */
  constructor(scene, runManager, gameData, ctx) {
    this.scene = scene;
    this.runManager = runManager;
    this.gameData = gameData;
    this.ctx = ctx;
    /** @type {object[]} Phaser display objects exposed to BattleScene for lootGroup */
    this.lootGroup = [];
  }

  /**
   * Render the loot card UI. Writes scene-owned state (_lootCards, _lootInstruction, etc.)
   * onto this.scene so BattleScene's flow methods can access them.
   */
  renderCards() {
    const scene = this.scene;
    const lootGroup = this.lootGroup;
    const cam = scene.cameras.main;
    const runManager = this.runManager;
    const gameData = this.gameData;
    const ctx = this.ctx;

    const turnPressure =
      ctx.victoryPressureState ||
      (typeof scene.getTurnPressureState === 'function'
        ? scene.getTurnPressureState()
        : { active: false, goldMultiplier: 1 });
    const pressureGoldMultiplier = Number.isFinite(turnPressure?.goldMultiplier)
      ? turnPressure.goldMultiplier
      : 1;
    const completionGold = Number.isFinite(ctx.completionGoldAward)
      ? ctx.completionGoldAward
      : Math.max(0, Math.floor(GOLD_BATTLE_BONUS * pressureGoldMultiplier));
    const battleCompletionGold = Number.isFinite(ctx.battleCompletionAwardedGold)
      ? Math.max(0, Math.trunc(ctx.battleCompletionAwardedGold))
      : (ctx.goldEarned || 0) + completionGold;
    const previewAwardedGold = (amount) => {
      const normalized = Math.max(0, Math.trunc(Number(amount) || 0));
      return normalized;
    };
    const awardGoldNow = (amount) => {
      if (typeof runManager?.awardGold === 'function') return runManager.awardGold(amount);
      if (typeof runManager?.addGold === 'function') runManager.addGold(amount);
      return Math.max(0, Math.trunc(Number(amount) || 0));
    };

    // Dark overlay
    const overlay = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.85)
      .setDepth(700)
      .setInteractive();
    lootGroup.push(overlay);

    // Title
    const titleText = ctx.isElite ? 'ELITE BATTLE REWARDS' : 'BATTLE REWARDS';
    const title = scene.add
      .text(cam.centerX, 30, titleText, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffdd44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(701);
    lootGroup.push(title);

    // Calculate and award turn bonus gold
    let turnBonusGold = 0;
    let turnRating = null;
    if (ctx.turnPar != null && ctx.turnBonusConfig) {
      const result = getRating(ctx.turnNumber, ctx.turnPar, ctx.turnBonusConfig);
      turnRating = result.rating;
      const rawTurnBonusGold = calculateBonusGold(
        result,
        runManager.currentAct,
        ctx.turnBonusConfig,
      );
      const scaledTurnBonusGold = Math.max(
        0,
        Math.floor(rawTurnBonusGold * pressureGoldMultiplier),
      );
      if (scaledTurnBonusGold > 0) {
        turnBonusGold = awardGoldNow(scaledTurnBonusGold);
      }
    }
    const totalGold = (ctx.goldEarned || 0) + completionGold + turnBonusGold;
    const displayedTotalGold = battleCompletionGold + turnBonusGold;

    // Gold summary with breakdown
    const goldLines = [`Battle+Completion: ${battleCompletionGold}G`];
    if (turnBonusGold > 0) {
      goldLines.push(`Turn ${turnRating}: +${turnBonusGold}G`);
    }
    if (turnPressure.active) {
      const fmtFn =
        typeof scene.formatPressureMultiplier === 'function'
          ? (v) => scene.formatPressureMultiplier(v)
          : (v) => `×${v}`;
      goldLines.push(`Late pressure: Gold ${fmtFn(pressureGoldMultiplier)}`);
    }
    goldLines.push(`Total: ${displayedTotalGold}G  |  Vault: ${runManager.gold}G`);

    const goldText = scene.add
      .text(cam.centerX, 58, goldLines.join('  |  '), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#aaffaa',
        wordWrap: { width: 620 },
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(701);
    lootGroup.push(goldText);

    // Tutorial hint for loot screen
    const hints = scene.registry.get('hints');
    if (hints?.shouldShow('battle_loot')) {
      const hintMsg = ctx.isElite
        ? 'Elite battle! Choose 2 rewards. Press [R] for roster.'
        : 'Choose one reward. Weapons equip to a unit. Press [R] for roster.';
      showMinorHint(scene, hintMsg);
    }

    // Generate loot choices
    const lootWeaponQualityBonus =
      ctx.metaEffects?.lootWeaponQualityBonus ?? ctx.metaEffects?.lootWeaponWeightBonus ?? 0;
    const metaLootBonuses = ctx.metaEffects?.lootCategoryWeightBonuses;
    const lootCount = ctx.isElite ? ELITE_LOOT_CHOICES : LOOT_CHOICES;
    const choices = generateLootChoices(
      runManager.currentAct,
      gameData.lootTables,
      gameData.weapons,
      gameData.consumables,
      lootCount,
      lootWeaponQualityBonus,
      gameData.accessories,
      gameData.whetstones,
      runManager.roster,
      ctx.isBoss,
      null,
      ctx.isElite,
      runManager.getWeaponArtSpawnConfig(),
      { lootCategoryWeightBonuses: metaLootBonuses },
    );

    // Skip bonus gold
    const skipGold = Math.floor(calculateSkipLootBonus(totalGold) * GOLD_LOOT_REWARD_MULTIPLIER);

    // Render cards
    const totalCards = choices.length + 1;
    const cardW = totalCards <= 4 ? 120 : 100;
    const cardH = 180;
    const gap = totalCards <= 4 ? 16 : 12;
    const totalW = totalCards * cardW + (totalCards - 1) * gap;
    const startX = cam.centerX - totalW / 2 + cardW / 2;
    const cardY = cam.centerY + 10;

    const typeIcons = {
      weapon: 'W',
      consumable: 'H',
      rare: 'R',
      gold: '$',
      accessory: 'A',
      forge: 'F',
    };
    const typeColors = {
      weapon: '#88bbff',
      consumable: '#88ff88',
      rare: '#ffaa55',
      gold: '#ffdd44',
      accessory: '#cc88ff',
      forge: '#ff8844',
    };
    const lootTypeDisplayMap = {
      healing: 'consumable',
      statBooster: 'consumable',
      promotion: 'rare',
      skillScroll: 'rare',
      weaponArtScroll: 'rare',
      legendaryWeapon: 'weapon',
    };

    scene._lootCards = [];

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const cx = startX + i * (cardW + gap);
      const cardIdx = i;

      // Card background
      const cardColor = choice.type === 'forge' ? 0x443322 : 0x333355;
      const strokeColor = choice.type === 'forge' ? 0xff8844 : 0x8888cc;
      const card = scene.add
        .rectangle(cx, cardY, cardW, cardH, cardColor, 1)
        .setStrokeStyle(2, strokeColor)
        .setDepth(701)
        .setInteractive({ useHandCursor: true });
      lootGroup.push(card);

      scene._lootCards.push({ bg: card });

      // Type icon
      const displayType = lootTypeDisplayMap[choice.type] || choice.type;
      const icon = scene.add
        .text(cx, cardY - 55, typeIcons[displayType] || '?', {
          fontFamily: 'monospace',
          fontSize: '28px',
          color: typeColors[displayType] || '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(702);
      lootGroup.push(icon);

      if (choice.type === 'gold') {
        const scaledGoldAmount = Math.max(
          0,
          Math.floor((choice.goldAmount || 0) * pressureGoldMultiplier),
        );
        const displayedGoldAmount = previewAwardedGold(scaledGoldAmount);
        const goldLabel = scene.add
          .text(cx, cardY - 2, `${displayedGoldAmount}G`, {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#ffdd44',
          })
          .setOrigin(0.5)
          .setDepth(702);
        lootGroup.push(goldLabel);

        if (choice.xpAmount) {
          const xpLabel = scene.add
            .text(cx, cardY + 22, `+${choice.xpAmount} XP All`, {
              fontFamily: 'monospace',
              fontSize: '10px',
              color: '#88ff88',
            })
            .setOrigin(0.5)
            .setDepth(702);
          lootGroup.push(xpLabel);
        }

        const typeLabel = scene.add
          .text(cx, cardY + 42, 'Gold', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#aaaaaa',
          })
          .setOrigin(0.5)
          .setDepth(702);
        lootGroup.push(typeLabel);

        card.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          scene._hideLootTooltip();
          const audio = scene.registry.get('audio');
          if (audio) {
            audio.playSFX('sfx_gold');
            audio.playSFX('sfx_confirm');
          }
          awardGoldNow(scaledGoldAmount);
          // Distribute team XP to entire roster
          if (choice.xpAmount && runManager.roster) {
            const extOpt = {
              extendedLevelingEnabled:
                runManager?.getDifficultyModifier?.('extendedLevelingEnabled', false) || false,
            };
            for (const unit of runManager.roster) {
              gainExperience(unit, choice.xpAmount, extOpt);
              checkLevelUpSkills(unit, gameData.classes);
            }
          }
          scene.finalizeLootPick(lootGroup, cardIdx);
        });
      } else if (choice.type === 'forge') {
        // Forge whetstone card
        const item = choice.item;
        const nameLines = _wrapText(item.name, 12);
        const nameLabel = scene.add
          .text(cx, cardY + 5, nameLines, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#ff8844',
            align: 'center',
          })
          .setOrigin(0.5)
          .setDepth(702);
        lootGroup.push(nameLabel);

        let detail =
          item.forgeStat === 'choice'
            ? 'Choose stat'
            : item.forgeStat === 'might'
              ? '+1 Might'
              : item.forgeStat === 'crit'
                ? '+5 Crit'
                : item.forgeStat === 'hit'
                  ? '+5 Hit'
                  : '-1 Weight';
        const detailLabel = applyTextResolution(
          scene.add
            .text(cx, cardY + 35, detail, {
              fontFamily: 'monospace',
              fontSize: '10px',
              color: '#ddaa66',
            })
            .setOrigin(0.5)
            .setDepth(702),
        );
        lootGroup.push(detailLabel);

        card.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          scene._hideLootTooltip();
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          scene.showForgeLootPicker(item, lootGroup, cardIdx);
        });
        card.on('pointerover', () => {
          scene._clearLootTooltipTimer();
          scene._lootTooltipTimer = scene.time.delayedCall(
            typeof scene._lootTooltipDelayMs === 'number' ? scene._lootTooltipDelayMs : 180,
            () => {
              scene._lootTooltipTimer = null;
              scene._showLootTooltip(choice, item, cx, cardY, cardH);
            },
          );
        });
        card.on('pointerout', () => scene._hideLootTooltip());
      } else {
        // Item choice (weapon, consumable, rare, accessory)
        const item = choice.item;
        const nameLines = _wrapText(item.name, 12);
        const nameLabel = scene.add
          .text(cx, cardY + 5, nameLines, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#ffffff',
            align: 'center',
          })
          .setOrigin(0.5)
          .setDepth(702);
        lootGroup.push(nameLabel);

        const priceLabel = scene.add
          .text(cx, cardY + 35, `${item.price || 0}G`, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#aaaaaa',
          })
          .setOrigin(0.5)
          .setDepth(702);
        lootGroup.push(priceLabel);

        // Category-aware detail text
        const detailInfo = scene.getLootCardDetailLines(choice, item, cardW);
        if (detailInfo.lines.length > 0) {
          const detailLabel = applyTextResolution(
            scene.add
              .text(cx, cardY + 46, detailInfo.lines.join('\n'), {
                fontFamily: 'monospace',
                fontSize: '10px',
                color: detailInfo.color,
                align: 'center',
              })
              .setOrigin(0.5, 0)
              .setDepth(702),
          );
          lootGroup.push(detailLabel);
        }

        card.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          scene._hideLootTooltip();
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');

          if (item.type === 'Scroll') {
            if (!runManager.scrolls) runManager.scrolls = [];
            runManager.scrolls.push({ ...item });
            scene.finalizeLootPick(lootGroup, cardIdx);
          } else if (choice.type === 'accessory') {
            if (!runManager.accessories) runManager.accessories = [];
            runManager.accessories.push({ ...item });
            scene.showLootStatus(`Added ${item.name} to Accessory Pool.`, '#88ff88');
            scene.finalizeLootPick(lootGroup, cardIdx);
          } else if (item.type === 'Consumable' && item.effect === 'statBoost') {
            scene.showStatBoostUnitPicker(item, lootGroup, cardIdx);
          } else if (item.type === 'Consumable') {
            scene.showConsumableUnitPicker(item, lootGroup, cardIdx);
          } else {
            scene.showLootUnitPicker(item, lootGroup, cardIdx);
          }
        });
        card.on('pointerover', () => {
          scene._clearLootTooltipTimer();
          scene._lootTooltipTimer = scene.time.delayedCall(
            typeof scene._lootTooltipDelayMs === 'number' ? scene._lootTooltipDelayMs : 180,
            () => {
              scene._lootTooltipTimer = null;
              scene._showLootTooltip(choice, item, cx, cardY, cardH);
            },
          );
        });
        card.on('pointerout', () => scene._hideLootTooltip());
      }
    }

    // Skip card
    const skipX = startX + choices.length * (cardW + gap);
    const skipCard = scene.add
      .rectangle(skipX, cardY, cardW, cardH, 0x554433, 1)
      .setStrokeStyle(2, 0xccaa44)
      .setDepth(701)
      .setInteractive({ useHandCursor: true });
    lootGroup.push(skipCard);

    const skipIcon = scene.add
      .text(skipX, cardY - 55, '$', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffdd44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(702);
    lootGroup.push(skipIcon);

    const displayedSkipGold = previewAwardedGold(skipGold);
    const skipLabel = scene.add
      .text(skipX, cardY + 5, `+${displayedSkipGold}G`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(702);
    lootGroup.push(skipLabel);

    const skipDesc = scene.add
      .text(skipX, cardY + 35, 'Skip Loot', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ccaa66',
      })
      .setOrigin(0.5)
      .setDepth(702);
    lootGroup.push(skipDesc);

    skipCard.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._hideLootTooltip();
      const audio = scene.registry.get('audio');
      if (audio) {
        audio.playSFX('sfx_gold');
        audio.playSFX('sfx_confirm');
      }
      awardGoldNow(skipGold);
      scene.cleanupLootScreen(lootGroup);
    });

    // Instruction
    const instText = ctx.isElite ? 'Choose 2 rewards' : 'Choose a reward';
    const inst = scene.add
      .text(cam.centerX, cardY + cardH / 2 + 24, instText, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
      })
      .setOrigin(0.5)
      .setDepth(701);
    lootGroup.push(inst);
    scene._lootInstruction = inst;

    const hintText = scene.add
      .text(cam.centerX, cardY + cardH / 2 + 42, '[R] Roster  |  [ESC] Settings', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#666666',
      })
      .setOrigin(0.5)
      .setDepth(701);
    lootGroup.push(hintText);

    if (typeof scene._pinToScreen === 'function') {
      scene._pinToScreen(lootGroup);
    }
  }

  // ── Static rendering methods ─────────────────────────────────

  static renderUnitPicker(scene, item, lootGroup, cardIdx) {
    // Hide loot cards temporarily
    for (const obj of lootGroup) obj.setVisible(false);

    const pickerGroup = [];
    const cam = scene.cameras.main;

    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710)
      .setInteractive();
    pickerGroup.push(bg);

    const title = scene.add
      .text(cam.centerX, 80, `Give ${item.name} to:`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(title);

    const roster = scene.runManager.roster;
    const btnW = 200;
    const listTop = 124;
    const listBottom = cam.height - 86;
    const rowHeight = 36;
    const btnH = 24;
    const nameOffset = -Math.floor(btnH * 0.22);
    const detailOffset = Math.floor(btnH * 0.28);
    const rows = [];
    let detachScroll = () => {};
    let pickerClosed = false;
    const closePicker = (afterClose) => {
      if (pickerClosed) return;
      pickerClosed = true;
      detachScroll();
      detachScroll = () => {};
      for (const obj of pickerGroup) {
        if (obj && typeof obj.destroy === 'function') obj.destroy();
      }
      if (typeof afterClose === 'function') afterClose();
    };

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const invCount = unit.inventory ? unit.inventory.length : 0;
      const full = invCount >= INVENTORY_MAX;
      const cannotEquip = !canEquip(unit, item);
      const by = listTop + i * rowHeight + rowHeight / 2;

      const btnColor = full ? 0x444444 : cannotEquip ? 0x554433 : 0x335566;
      const borderColor = full ? 0x666666 : cannotEquip ? 0xcc8844 : 0x66aacc;
      const btn = scene.add
        .rectangle(cam.centerX, by, btnW, btnH, btnColor, 1)
        .setStrokeStyle(2, borderColor)
        .setDepth(711);
      if (!full && !cannotEquip) btn.setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const nameColor = full ? '#666666' : cannotEquip ? '#cc8844' : '#ffffff';
      const lockSuffix = cannotEquip ? `  (needs ${item.rankRequired || 'rank'})` : '';
      const label = scene.add
        .text(cam.centerX, by - Math.floor(btnH * 0.22), unit.name + lockSuffix, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: nameColor,
        })
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(label);

      const statusText = full ? 'Inventory full' : `${invCount}/${INVENTORY_MAX} items`;
      const invLabel = scene.add
        .text(cam.centerX, by + Math.floor(btnH * 0.28), statusText, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: full ? '#aa4444' : '#aaaaaa',
        })
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(invLabel);

      const selectable = !full && !cannotEquip;
      rows.push({
        objects: [btn, label, invLabel],
        selectable,
        inputTarget: btn,
        setCenterY: (centerY) => {
          btn.y = centerY;
          label.y = centerY + nameOffset;
          invLabel.y = centerY + detailOffset;
        },
      });

      if (!full && !cannotEquip) {
        btn.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          addToInventory(unit, { ...item });
          closePicker(() => scene.finalizeLootPick(lootGroup, cardIdx));
        });
      }
    }

    const convoyCanStore = Boolean(scene.runManager?.canAddToConvoy?.(item));
    const convoyBtn = scene.add
      .text(
        cam.centerX,
        cam.height - 54,
        convoyCanStore ? '[ Send to Convoy ]' : '[ Convoy Full ]',
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: convoyCanStore ? '#88ccff' : '#666666',
          backgroundColor: '#223344',
          padding: { x: 12, y: 6 },
        },
      )
      .setOrigin(0.5)
      .setDepth(711);
    if (convoyCanStore) convoyBtn.setInteractive({ useHandCursor: true });
    pickerGroup.push(convoyBtn);
    if (convoyCanStore) {
      convoyBtn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        if (!scene.runManager.addToConvoy(item)) {
          scene.showLootStatus('Convoy is full. Choose another reward.', '#ff8888');
          return;
        }
        const audio = scene.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        closePicker(() => scene.finalizeLootPick(lootGroup, cardIdx));
      });
    }

    const handleBack = () => {
      closePicker(() => {
        for (const obj of lootGroup) obj.setVisible(true);
      });
    };

    const backBtn = scene.add
      .text(cam.centerX, cam.height - 24, '< Back', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#aaaaaa',
        backgroundColor: '#333333',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(711)
      .setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      handleBack();
    });

    const setupScroller =
      scene._setupLootPickerScroller ||
      (scene.constructor &&
        scene.constructor.prototype &&
        scene.constructor.prototype._setupLootPickerScroller);
    if (typeof setupScroller === 'function') {
      detachScroll = setupScroller.call(scene, {
        pickerGroup,
        rows,
        topY: listTop,
        bottomY: listBottom,
        rowHeight,
        listLeft: cam.centerX - btnW / 2,
        listRight: cam.centerX + btnW / 2,
        onBack: handleBack,
      });
    }
  }

  static renderConsumableUnitPicker(scene, item, lootGroup, cardIdx) {
    for (const obj of lootGroup) obj.setVisible(false);

    const pickerGroup = [];
    const cam = scene.cameras.main;

    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710)
      .setInteractive();
    pickerGroup.push(bg);

    const title = scene.add
      .text(cam.centerX, 80, `Give ${item.name} to:`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(title);

    const roster = scene.runManager.roster;
    const btnW = 200;
    const listTop = 124;
    const listBottom = cam.height - 86;
    const rowHeight = 36;
    const btnH = 24;
    const nameOffset = -Math.floor(btnH * 0.22);
    const detailOffset = Math.floor(btnH * 0.28);
    const rows = [];
    let detachScroll = () => {};
    let pickerClosed = false;
    const closePicker = (afterClose) => {
      if (pickerClosed) return;
      pickerClosed = true;
      detachScroll();
      detachScroll = () => {};
      for (const obj of pickerGroup) {
        if (obj && typeof obj.destroy === 'function') obj.destroy();
      }
      if (typeof afterClose === 'function') afterClose();
    };

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const consumableCount = unit.consumables ? unit.consumables.length : 0;
      const full = consumableCount >= CONSUMABLE_MAX;
      const by = listTop + i * rowHeight + rowHeight / 2;

      const btn = scene.add
        .rectangle(cam.centerX, by, btnW, btnH, full ? 0x444444 : 0x335566, 1)
        .setStrokeStyle(2, full ? 0x666666 : 0x66aacc)
        .setDepth(711);
      if (!full) btn.setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const label = scene.add
        .text(cam.centerX, by - Math.floor(btnH * 0.22), unit.name, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: full ? '#666666' : '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(label);

      const invLabel = scene.add
        .text(
          cam.centerX,
          by + Math.floor(btnH * 0.28),
          full ? 'Consumables full' : `${consumableCount}/${CONSUMABLE_MAX} items`,
          {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: full ? '#aa4444' : '#aaaaaa',
          },
        )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(invLabel);
      const selectable = !full;
      rows.push({
        objects: [btn, label, invLabel],
        selectable,
        inputTarget: btn,
        setCenterY: (centerY) => {
          btn.y = centerY;
          label.y = centerY + nameOffset;
          invLabel.y = centerY + detailOffset;
        },
      });

      if (!full) {
        btn.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          addToConsumables(unit, { ...item });
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          closePicker(() => scene.finalizeLootPick(lootGroup, cardIdx));
        });
      }
    }

    const convoyCanStore = Boolean(scene.runManager?.canAddToConvoy?.(item));
    const convoyBtn = scene.add
      .text(
        cam.centerX,
        cam.height - 54,
        convoyCanStore ? '[ Send to Convoy ]' : '[ Convoy Full ]',
        {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: convoyCanStore ? '#88ccff' : '#666666',
          backgroundColor: '#223344',
          padding: { x: 12, y: 6 },
        },
      )
      .setOrigin(0.5)
      .setDepth(711);
    if (convoyCanStore) convoyBtn.setInteractive({ useHandCursor: true });
    pickerGroup.push(convoyBtn);
    if (convoyCanStore) {
      convoyBtn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        if (!scene.runManager.addToConvoy(item)) {
          scene.showLootStatus('Convoy is full. Choose another reward.', '#ff8888');
          return;
        }
        const audio = scene.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        closePicker(() => scene.finalizeLootPick(lootGroup, cardIdx));
      });
    }

    const handleBack = () => {
      closePicker(() => {
        for (const obj of lootGroup) obj.setVisible(true);
      });
    };

    const backBtn = scene.add
      .text(cam.centerX, cam.height - 24, '< Back', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#aaaaaa',
        backgroundColor: '#333333',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(711)
      .setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      handleBack();
    });

    const setupScroller =
      scene._setupLootPickerScroller ||
      (scene.constructor &&
        scene.constructor.prototype &&
        scene.constructor.prototype._setupLootPickerScroller);
    if (typeof setupScroller === 'function') {
      detachScroll = setupScroller.call(scene, {
        pickerGroup,
        rows,
        topY: listTop,
        bottomY: listBottom,
        rowHeight,
        listLeft: cam.centerX - btnW / 2,
        listRight: cam.centerX + btnW / 2,
        onBack: handleBack,
      });
    }
  }

  static renderStatBoostPicker(scene, item, lootGroup, cardIdx) {
    for (const obj of lootGroup) obj.setVisible(false);

    const pickerGroup = [];
    const cam = scene.cameras.main;

    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710)
      .setInteractive();
    pickerGroup.push(bg);

    const title = scene.add
      .text(cam.centerX, 80, `Use ${item.name} (+${item.value} ${item.stat}) on:`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#88ff88',
      })
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(title);

    const roster = scene.runManager.roster;
    const btnW = 200;
    const listTop = 124;
    const listBottom = cam.height - 52;
    const rowHeight = 36;
    const btnH = 24;
    const nameOffset = -Math.floor(btnH * 0.22);
    const detailOffset = Math.floor(btnH * 0.28);
    const rows = [];
    let detachScroll = () => {};
    let pickerClosed = false;
    const closePicker = (afterClose) => {
      if (pickerClosed) return;
      pickerClosed = true;
      detachScroll();
      detachScroll = () => {};
      for (const obj of pickerGroup) {
        if (obj && typeof obj.destroy === 'function') obj.destroy();
      }
      if (typeof afterClose === 'function') afterClose();
    };

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const currentVal = unit.stats[item.stat] || 0;
      const by = listTop + i * rowHeight + rowHeight / 2;

      const btn = scene.add
        .rectangle(cam.centerX, by, btnW, btnH, 0x335566, 1)
        .setStrokeStyle(2, 0x66aacc)
        .setDepth(711)
        .setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const label = scene.add
        .text(cam.centerX, by - Math.floor(btnH * 0.22), unit.name, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#ffffff',
        })
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(label);

      const statLabel = scene.add
        .text(
          cam.centerX,
          by + Math.floor(btnH * 0.28),
          `${item.stat}: ${currentVal} -> ${currentVal + item.value}`,
          {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#88ff88',
          },
        )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(statLabel);
      rows.push({
        objects: [btn, label, statLabel],
        selectable: true,
        inputTarget: btn,
        setCenterY: (centerY) => {
          btn.y = centerY;
          label.y = centerY + nameOffset;
          statLabel.y = centerY + detailOffset;
        },
      });

      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        applyStatBoost(unit, item);
        const audio = scene.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        closePicker(() => scene.finalizeLootPick(lootGroup, cardIdx));
      });
    }

    const handleBack = () => {
      closePicker(() => {
        for (const obj of lootGroup) obj.setVisible(true);
      });
    };

    const backBtn = scene.add
      .text(cam.centerX, cam.height - 24, '< Back', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#aaaaaa',
        backgroundColor: '#333333',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(711)
      .setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      handleBack();
    });

    const setupScroller =
      scene._setupLootPickerScroller ||
      (scene.constructor &&
        scene.constructor.prototype &&
        scene.constructor.prototype._setupLootPickerScroller);
    if (typeof setupScroller === 'function') {
      detachScroll = setupScroller.call(scene, {
        pickerGroup,
        rows,
        topY: listTop,
        bottomY: listBottom,
        rowHeight,
        listLeft: cam.centerX - btnW / 2,
        listRight: cam.centerX + btnW / 2,
        onBack: handleBack,
      });
    }
  }

  static renderForgePicker(scene, whetstone, lootGroup, cardIdx) {
    for (const obj of lootGroup) obj.setVisible(false);

    const pickerGroup = [];
    const cam = scene.cameras.main;
    const roster = scene.runManager.roster;

    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710)
      .setInteractive();
    pickerGroup.push(bg);

    const title = scene.add
      .text(cam.centerX, 60, `Apply ${whetstone.name}`, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ff8844',
      })
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(title);

    const subtitle = scene.add
      .text(cam.centerX, 82, 'Select a unit:', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(subtitle);

    const btnW = 240;
    const listTop = 108;
    const listBottom = cam.height - 62;
    const rowHeight = 30;
    const btnH = 22;
    const labelOffset = -Math.floor(btnH * 0.1);
    const rows = [];
    let detachScroll = () => {};
    let pickerClosed = false;
    const closePicker = (afterClose) => {
      if (pickerClosed) return;
      pickerClosed = true;
      detachScroll();
      detachScroll = () => {};
      for (const obj of pickerGroup) {
        if (obj && typeof obj.destroy === 'function') obj.destroy();
      }
      if (typeof afterClose === 'function') afterClose();
    };
    let validCount = 0;

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const forgeableCount = unit.inventory.filter((w) =>
        whetstone.forgeStat !== 'choice' ? canForgeStat(w, whetstone.forgeStat) : canForge(w),
      ).length;
      const by = listTop + i * rowHeight + rowHeight / 2;

      if (forgeableCount === 0) {
        const label = scene.add
          .text(cam.centerX, by, `${unit.name}  (no forgeable weapons)`, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#666666',
          })
          .setOrigin(0.5)
          .setDepth(712);
        pickerGroup.push(label);
        rows.push({
          objects: [label],
          selectable: false,
          inputTarget: null,
          setCenterY: (centerY) => {
            label.y = centerY + labelOffset;
          },
        });
        continue;
      }

      validCount++;
      const btn = scene.add
        .rectangle(cam.centerX, by, btnW, btnH, 0x443322, 1)
        .setStrokeStyle(1, 0xff8844)
        .setDepth(711)
        .setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const label = scene.add
        .text(
          cam.centerX,
          by,
          `${unit.name}  (${forgeableCount} weapon${forgeableCount > 1 ? 's' : ''})`,
          {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#e0e0e0',
          },
        )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(label);
      rows.push({
        objects: [btn, label],
        selectable: true,
        inputTarget: btn,
        setCenterY: (centerY) => {
          btn.y = centerY;
          label.y = centerY + labelOffset;
        },
      });

      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        try {
          closePicker(() => scene.showForgeWeaponPicker(whetstone, unit, lootGroup, cardIdx));
        } catch (err) {
          scene.reportLootError('showForgeLootPicker:unitSelect', err, {
            unit: unit?.name,
            whetstone: whetstone?.name,
          });
          for (const obj of lootGroup) obj.setVisible(true);
        }
      });
    }

    if (validCount === 0) {
      const noWeapons = scene.add
        .text(cam.centerX, cam.centerY + 10, 'No forgeable weapons in roster!', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ff8888',
        })
        .setOrigin(0.5)
        .setDepth(711);
      pickerGroup.push(noWeapons);
    }

    const handleBack = () => {
      closePicker(() => {
        for (const obj of lootGroup) obj.setVisible(true);
      });
    };

    const backBtn = scene.add
      .text(cam.centerX, cam.height - 24, '< Back', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#aaaaaa',
        backgroundColor: '#333333',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(711)
      .setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      handleBack();
    });

    const setupScroller =
      scene._setupLootPickerScroller ||
      (scene.constructor &&
        scene.constructor.prototype &&
        scene.constructor.prototype._setupLootPickerScroller);
    if (typeof setupScroller === 'function') {
      detachScroll = setupScroller.call(scene, {
        pickerGroup,
        rows,
        topY: listTop,
        bottomY: listBottom,
        rowHeight,
        listLeft: cam.centerX - btnW / 2,
        listRight: cam.centerX + btnW / 2,
        onBack: handleBack,
      });
    }
  }

  // ── Static pure functions ────────────────────────────────────

  static getCardDetailLines(scene, choice, item, cardWidth = 110) {
    if (!item) return { lines: [], color: '#bbbbbb' };

    const asNum = (value, fallback = 0) => {
      const num = Number(value);
      return Number.isFinite(num) ? num : fallback;
    };
    const detailWrapChars = Math.max(10, Math.floor((cardWidth - 12) / 5.5));
    const wrapDetailLines = (lines, maxLines = 2) => {
      const text = Array.isArray(lines)
        ? lines.filter((line) => typeof line === 'string' && line.trim().length > 0).join('\n')
        : String(lines || '');
      return scene._formatSpecialLinesForUi(text, detailWrapChars, maxLines);
    };
    const usesLine = formatUses(item);
    const type = choice?.type;
    const consumableDescription = getConsumableDescription(item);

    if (
      (item.might !== undefined && item.type !== 'Scroll') ||
      type === 'weapon' ||
      type === 'legendaryWeapon'
    ) {
      const range = item.range == null ? '1' : String(item.range);
      const lines = [];
      if (item.type) lines.push(item.type);
      lines.push(`${asNum(item.might)}Mt ${asNum(item.hit)}Hit ${asNum(item.crit)}Crt`);
      lines.push(`${asNum(item.weight)}Wt Rng${range}`);
      lines.push(...scene._formatSpecialLinesForUi(item.special, detailWrapChars, 1));
      return { lines, color: '#aaccff' };
    }

    if (item.type === 'Accessory' || type === 'accessory') {
      const detail = scene.getAccessoryDetailText(item);
      return {
        lines: wrapDetailLines(detail ? detail.split('\n') : ['Equip for passive bonus'], 2),
        color: '#ddaaff',
      };
    }

    if (item.type === 'Scroll' || type === 'skillScroll' || type === 'weaponArtScroll') {
      const typeHint =
        Array.isArray(item.allowedWeaponTypes) && item.allowedWeaponTypes.length > 0
          ? `For ${item.allowedWeaponTypes.join('/')}`
          : '';
      if (item.teachesWeaponArtId || type === 'weaponArtScroll') {
        return {
          lines: wrapDetailLines(['Teaches Weapon Art', ...(typeHint ? [typeHint] : [])], 2),
          color: '#ffbb77',
        };
      }
      const special =
        typeof item.special === 'string' && item.special.trim().length > 0
          ? item.special.trim()
          : 'Teaches a skill';
      const skillDef = scene.gameData?.skills?.find((s) => s.id === item.skillId);
      const descLine = skillDef?.description || '';
      return {
        lines: wrapDetailLines([special, ...(descLine ? [descLine] : [])], 3),
        color: '#ffbb77',
      };
    }

    if (item.effect === 'statBoost' || type === 'statBooster') {
      const statText =
        item.effect === 'statBoost' && consumableDescription
          ? consumableDescription
          : `Permanent +${asNum(item.value)} ${item.stat || 'Stat'}`;
      return {
        lines: wrapDetailLines([statText], 2),
        color: '#aaffaa',
      };
    }

    if (item.effect === 'reclass') {
      return {
        lines: wrapDetailLines([consumableDescription || 'Reclass to an infantry class'], 2),
        color: '#aaffff',
      };
    }

    if (item.effect === 'promote' || (type === 'promotion' && item.effect !== 'reclass')) {
      return {
        lines: wrapDetailLines([consumableDescription || 'Promote a Lv 10+ unit'], 2),
        color: '#ffbb77',
      };
    }

    if (
      item.effect === 'heal' ||
      item.effect === 'healFull' ||
      item.effect === 'cure' ||
      item.effect === 'cureHeal' ||
      type === 'healing'
    ) {
      const amount = asNum(item.value);
      const fallbackText =
        item.effect === 'healFull'
          ? 'Restore HP to full'
          : `Restore ${amount > 0 ? amount : ''} HP`.trim();
      return {
        lines: [consumableDescription || fallbackText, ...(usesLine ? [usesLine] : [])],
        color: '#aaffaa',
      };
    }

    if (usesLine) return { lines: [usesLine], color: '#bbbbbb' };
    return { lines: [], color: '#bbbbbb' };
  }

  static getTooltipText(scene, choice, item) {
    if (!item) return null;
    const type = choice?.type;
    const asNum = (v, fb = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fb;
    };

    // Weapons (non-scroll)
    if (
      (item.might !== undefined && item.type !== 'Scroll') ||
      type === 'weapon' ||
      type === 'legendaryWeapon'
    ) {
      const lines = [];
      if (item.type) lines.push(item.type);
      const range = item.range == null ? '1' : String(item.range);
      lines.push(`Mt ${asNum(item.might)}  Hit ${asNum(item.hit)}  Crit ${asNum(item.crit)}`);
      lines.push(`Wt ${asNum(item.weight)}  Range ${range}  ${item.rankRequired || 'Prof'}`);
      if (item.special) lines.push('', item.special);
      return lines.join('\n');
    }

    // Weapon art scrolls
    if (item.teachesWeaponArtId || type === 'weaponArtScroll') {
      const artId = item.teachesWeaponArtId;
      const art = artId && scene.gameData?.weaponArts?.arts?.find((a) => a.id === artId);
      const lines = [];
      if (art) {
        lines.push(art.name || artId);
        const meta = [];
        if (art.weaponType) meta.push(art.weaponType);
        if (art.hpCost) meta.push(`HP Cost: ${art.hpCost}`);
        if (art.requiredRank) meta.push(art.requiredRank);
        if (meta.length) lines.push(meta.join('  |  '));
        const limits = [];
        if (art.perTurnLimit) limits.push(`${art.perTurnLimit}/turn`);
        if (art.perMapLimit) limits.push(`${art.perMapLimit}/map`);
        if (limits.length) lines.push(limits.join('  '));
        if (art.description) lines.push('', art.description);
        const summary = summarizeWeaponArtEffect(art);
        if (summary && summary !== 'No combat modifier' && summary !== art.description) {
          lines.push('', summary);
        }
      } else {
        lines.push('Teaches Weapon Art');
        if (artId) lines.push(artId);
      }
      return lines.join('\n');
    }

    // Skill scrolls
    if (item.type === 'Scroll' || type === 'skillScroll') {
      const skillDef = item.skillId && scene.gameData?.skills?.find((s) => s.id === item.skillId);
      const lines = [];
      lines.push(item.name || 'Skill Scroll');
      if (skillDef) {
        if (skillDef.description) lines.push('', skillDef.description);
        if (skillDef.trigger) lines.push(`Trigger: ${skillDef.trigger}`);
        if (skillDef.activation) lines.push(`Activation: ${skillDef.activation}`);
      } else if (item.special) {
        lines.push('', item.special);
      }
      return lines.join('\n');
    }

    // Accessories
    if (item.type === 'Accessory' || type === 'accessory') {
      return formatAccessoryDetail(item, {
        separator: '\n',
        statSeparator: ', ',
        fallback: 'Equip for passive bonus',
      });
    }

    // Consumables
    if (item.type === 'Consumable') {
      const lines = [item.name || 'Consumable'];
      const description = getConsumableDescription(item);
      if (description) lines.push(description);
      const usesText = formatUses(item);
      if (usesText) lines.push(usesText);
      return lines.join('\n');
    }

    // Whetstones
    if (item.type === 'Whetstone' || type === 'forge') {
      const lines = [item.name || 'Whetstone'];
      if (item.forgeStat === 'choice') lines.push('Choose which stat to forge');
      else if (item.forgeStat === 'might') lines.push('+1 Might to a weapon');
      else if (item.forgeStat === 'crit') lines.push('+5 Crit to a weapon');
      else if (item.forgeStat === 'hit') lines.push('+5 Hit to a weapon');
      else if (item.forgeStat === 'weight') lines.push('-1 Weight on a weapon');
      lines.push(`Max ${FORGE_MAX_LEVEL} forges, ${FORGE_STAT_CAP}/stat`);
      return lines.join('\n');
    }

    return null;
  }
}

// ── Module-private helpers ───────────────────────────────────

function _wrapText(text, maxChars) {
  const value = typeof text === 'string' ? text : String(text ?? '');
  const width = Math.max(1, Math.floor(Number(maxChars) || 0));
  if (value.length <= width) return value;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const lines = [];
  let line = '';
  for (const word of words) {
    let remaining = word;
    while (remaining.length > width) {
      if (line.length > 0) {
        lines.push(line);
        line = '';
      }
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    if (!remaining) continue;
    if (line.length === 0) {
      line = remaining;
    } else if (line.length + remaining.length + 1 > width) {
      lines.push(line);
      line = remaining;
    } else {
      line = `${line} ${remaining}`;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}
