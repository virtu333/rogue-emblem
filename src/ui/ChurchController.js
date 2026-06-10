// ChurchController -- church node overlay flow extracted from NodeMapScene.
// Owns the church overlay UI (heal/revive/promote services, scroll content)
// and its message/flavor timers. All overlay state stays on the scene
// (churchOverlay, churchContentGroup, churchScrollOffset, ...) because the
// scene's input handlers and cancel logic read it; cross-cutting seams are
// invoked via the scene's delegating wrappers so tests and other systems can
// intercept them on the scene as before.

import { CHURCH_PROMOTE_COST, SAFE_BOTTOM_Y } from '../utils/constants.js';
import { getReviveCost } from '../engine/RunManager.js';
import {
  canPromote,
  promoteUnit,
  getSkillDisplayNames,
  resolvePromotionTargets,
  getDisplayLevel,
} from '../engine/UnitManager.js';
import { MUSIC, getMusicKey, pickTrack } from '../utils/musicConfig.js';
import { showMinorHint } from './HintDisplay.js';
import { trackSceneTimer, clearTrackedSceneTimer } from '../utils/sceneTimers.js';
import {
  OVERLAY_PANEL_W,
  OVERLAY_PANEL_H,
  OVERLAY_PANEL_DEPTH,
  OVERLAY_CONTENT_DEPTH,
  CHURCH_ITEM_HEIGHT,
  CHURCH_LIST_TOP_Y,
  CHURCH_VIEW_MAP_Y,
  CHURCH_LIST_BOTTOM_Y,
} from './nodeMapOverlayLayout.js';

export class ChurchController {
  constructor(scene) {
    this.scene = scene;
  }

  handleChurch(node) {
    const scene = this.scene;
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.rest), scene, 300); // Peaceful music

    scene._churchPromotionsThisVisit = scene.runManager.getChurchPromotionCount(node.id);
    scene._currentChurchNodeId = node.id;
    scene.showChurchOverlay(node);
  }

  showChurchOverlay(node) {
    const scene = this.scene;
    scene.churchOverlay = [];
    scene.churchContentGroup = [];
    scene._churchNode = node;
    scene._churchViewingMap = false;
    scene.churchScrollOffset = 0;
    scene.churchScrollMax = 0;
    scene._churchScrollItems = null;

    // Tutorial hint for church
    const hints = scene.registry.get('hints');
    if (hints?.shouldShow('nodemap_church')) {
      showMinorHint(scene, 'Heal, revive fallen allies, or promote units.');
    }

    // Dark overlay background
    const bg = scene.add.rectangle(320, 240, 640, 480, 0x000000, 0.9).setDepth(300);
    scene.churchOverlay.push(bg);

    // Centered panel container
    const panel = scene.add
      .rectangle(320, 240, OVERLAY_PANEL_W, OVERLAY_PANEL_H, 0x111111, 0.95)
      .setDepth(OVERLAY_PANEL_DEPTH)
      .setStrokeStyle(2, 0x444444)
      .setInteractive();
    scene.churchOverlay.push(panel);

    // Title
    const title = scene.add
      .text(320, 40, 'Church', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#cccccc',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH);
    scene.churchOverlay.push(title);

    // Gold display
    scene.churchGoldText = scene.add
      .text(320, 70, `Gold: ${scene.runManager.gold}G`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH);
    scene.churchOverlay.push(scene.churchGoldText);

    const rm = scene.runManager;

    // Service 1: Heal All (Free) — fixed, not scrollable
    const healBtn = scene.add
      .text(320, 110, '[ Heal All Units ] (Free)', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#44ff44',
        backgroundColor: '#222222',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    healBtn.on('pointerover', () => healBtn.setBackgroundColor('#333333'));
    healBtn.on('pointerout', () => healBtn.setBackgroundColor('#222222'));
    healBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      for (const unit of rm.roster) {
        unit.currentHP = unit.stats.HP;
      }
      const audio = scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_heal');
      scene.showChurchMessage('All units healed!', '#44ff44');
    });
    scene.churchOverlay.push(healBtn);

    // View Map button — fixed
    const viewMapBtn = scene.add
      .text(320, CHURCH_VIEW_MAP_Y, '[ View Map ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    viewMapBtn.on('pointerover', () => viewMapBtn.setColor('#ffdd44'));
    viewMapBtn.on('pointerout', () => viewMapBtn.setColor('#aaddff'));
    viewMapBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._enterChurchMapView();
    });
    scene.churchOverlay.push(viewMapBtn);

    // Roster button — fixed
    const rosterBtn = scene.add
      .text(180, SAFE_BOTTOM_Y, '[ Roster ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaddff',
        backgroundColor: '#223344',
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    rosterBtn.on('pointerover', () => rosterBtn.setColor('#ffdd44'));
    rosterBtn.on('pointerout', () => rosterBtn.setColor('#aaddff'));
    rosterBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene._touchScrollDrag = null;
      scene._setChurchOverlayVisibility(false);
      scene._churchViewingRoster = true;
      scene._openRoster();
      if (scene.rosterOverlay) {
        const baseOnClose = scene.rosterOverlay.onClose;
        scene.rosterOverlay.onClose = () => {
          if (baseOnClose) baseOnClose();
          scene._churchViewingRoster = false;
          scene._setChurchOverlayVisibility(true);
        };
      } else {
        // _openRoster() hit an early return — roll back
        scene._churchViewingRoster = false;
        scene._setChurchOverlayVisibility(true);
      }
    });
    scene.churchOverlay.push(rosterBtn);

    // Leave button — fixed
    const leaveBtn = scene.add
      .text(320, SAFE_BOTTOM_Y, '[ Leave Church ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setDepth(OVERLAY_CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerover', () => leaveBtn.setColor('#ffdd44'));
    leaveBtn.on('pointerout', () => leaveBtn.setColor('#e0e0e0'));
    leaveBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      scene.leaveChurchNode();
    });
    scene.churchOverlay.push(leaveBtn);

    // Build scrollable item descriptors
    const items = [];
    let localY = 0;

    // Service 2: Revive Fallen Unit (1000g)
    if (rm.fallenUnits.length > 0) {
      items.push({
        type: 'label',
        text: 'Revive Fallen Unit:',
        color: '#cccccc',
        y: localY,
      });
      localY += 25;
      for (const fallen of rm.fallenUnits) {
        items.push({ type: 'revive', unit: fallen, cost: getReviveCost(fallen), y: localY });
        localY += CHURCH_ITEM_HEIGHT;
      }
      localY += 10;
    }

    // Service 3: Promote Unit
    const promoLimit = rm.getDifficultyModifier('churchPromotionLimit', -1);
    const promoRemaining =
      promoLimit >= 0 ? promoLimit - (scene._churchPromotionsThisVisit || 0) : -1;
    const promoLimitText = promoRemaining >= 0 ? ` [${promoRemaining} left]` : '';
    items.push({
      type: 'label',
      text: `Promote Unit (${CHURCH_PROMOTE_COST}G):${promoLimitText}`,
      color: '#cccccc',
      y: localY,
    });
    localY += 25;

    const eligibleUnits = rm.roster.filter((u) => canPromote(u));
    if (promoRemaining === 0) {
      items.push({ type: 'none', text: '(Promotion limit reached)', y: localY });
      localY += CHURCH_ITEM_HEIGHT;
    } else if (eligibleUnits.length === 0) {
      items.push({ type: 'none', text: '(No units eligible for promotion)', y: localY });
      localY += CHURCH_ITEM_HEIGHT;
    } else {
      for (const unit of eligibleUnits) {
        items.push({ type: 'promote', unit, y: localY });
        localY += CHURCH_ITEM_HEIGHT;
      }
    }

    scene._churchScrollItems = items;
    const availableHeight = CHURCH_LIST_BOTTOM_Y - CHURCH_LIST_TOP_Y;
    scene.churchScrollMax = Math.max(0, localY - availableHeight);
    scene.churchScrollOffset = 0;

    scene.drawChurchScrollContent();
  }

  drawChurchScrollContent() {
    const scene = this.scene;
    // Destroy previous scroll content
    if (scene.churchContentGroup) scene.churchContentGroup.forEach((o) => o.destroy());
    scene.churchContentGroup = [];

    const items = scene._churchScrollItems;
    if (!items) return;

    const offset = scene.churchScrollOffset || 0;
    const rm = scene.runManager;
    const node = scene._churchNode;

    for (const item of items) {
      const y = CHURCH_LIST_TOP_Y + item.y - offset;
      // Keep row/button bounds out of fixed controls; use half-row guard at bottom.
      if (
        y < CHURCH_LIST_TOP_Y - CHURCH_ITEM_HEIGHT ||
        y > CHURCH_LIST_BOTTOM_Y - CHURCH_ITEM_HEIGHT / 2
      )
        continue;

      if (item.type === 'label') {
        const label = scene.add
          .text(320, y, item.text, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: item.color,
          })
          .setOrigin(0.5)
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.churchContentGroup.push(label);
      } else if (item.type === 'none') {
        const noneText = scene.add
          .text(320, y, item.text, {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#888888',
          })
          .setOrigin(0.5)
          .setDepth(OVERLAY_CONTENT_DEPTH);
        scene.churchContentGroup.push(noneText);
      } else if (item.type === 'revive') {
        const fallen = item.unit;
        const cost = item.cost;
        const unitBtn = scene.add
          .text(
            320,
            y,
            `${fallen.name} (Lv${getDisplayLevel(fallen)} ${fallen.className}) — ${cost}G`,
            {
              fontFamily: 'monospace',
              fontSize: '14px',
              color: '#e0e0e0',
              backgroundColor: '#222222',
              padding: { x: 10, y: 4 },
            },
          )
          .setOrigin(0.5)
          .setDepth(OVERLAY_CONTENT_DEPTH)
          .setInteractive({ useHandCursor: true });
        unitBtn.on('pointerover', () => {
          if (rm.gold >= cost) unitBtn.setColor('#ffdd44');
          unitBtn.setBackgroundColor('#333333');
        });
        unitBtn.on('pointerout', () => {
          unitBtn.setColor('#e0e0e0');
          unitBtn.setBackgroundColor('#222222');
        });
        unitBtn.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          if (rm.reviveFallenUnit(fallen.name, cost)) {
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_heal');
            let functionalMessage = `${fallen.name} revived!`;
            if (!rm.hasShownDialogue('revive_convoy_hint')) {
              rm.markDialogueShown('revive_convoy_hint');
              functionalMessage = `${fallen.name} revived! (Gear stored in convoy — re-equip via Roster)`;
            }
            scene._showChurchSuccessMessage(node, functionalMessage, '#44ff44', 'revival');
          } else {
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            scene.showChurchMessage('Not enough gold or roster full!', '#ff4444');
          }
        });
        scene.churchContentGroup.push(unitBtn);
      } else if (item.type === 'promote') {
        const unit = item.unit;
        const unitBtn = scene.add
          .text(320, y, `${unit.name} (Lv${getDisplayLevel(unit)} ${unit.className})`, {
            fontFamily: 'monospace',
            fontSize: '14px',
            color: '#e0e0e0',
            backgroundColor: '#222222',
            padding: { x: 10, y: 4 },
          })
          .setOrigin(0.5)
          .setDepth(OVERLAY_CONTENT_DEPTH)
          .setInteractive({ useHandCursor: true });
        unitBtn.on('pointerover', () => {
          if (rm.gold >= CHURCH_PROMOTE_COST) unitBtn.setColor('#ffdd44');
          unitBtn.setBackgroundColor('#333333');
        });
        unitBtn.on('pointerout', () => {
          unitBtn.setColor('#e0e0e0');
          unitBtn.setBackgroundColor('#222222');
        });
        unitBtn.on('pointerdown', async (pointer) => {
          if (pointer?.button !== 0) return;
          const _promoLimit = rm.getDifficultyModifier('churchPromotionLimit', -1);
          if (_promoLimit >= 0 && (scene._churchPromotionsThisVisit || 0) >= _promoLimit) {
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            scene.showChurchMessage('Promotion limit reached!', '#ff4444');
            return;
          }
          if (rm.gold < CHURCH_PROMOTE_COST) {
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            scene.showChurchMessage('Not enough gold!', '#ff4444');
            return;
          }

          const lordData = scene.gameData.lords.find((l) => l.name === unit.name);
          const targets = resolvePromotionTargets(
            unit,
            scene.gameData.classes,
            scene.gameData.lords,
          );
          if (!targets?.length) {
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            scene.showChurchMessage('Promotion unavailable for this unit.', '#ff4444');
            return;
          }

          // Choose class first, THEN charge gold (cancel must not spend)
          let promotedClassData;
          if (targets.length === 1) {
            promotedClassData = targets[0];
          } else {
            const { PromotionChoicePanel } = await import('./PromotionChoicePanel.js');
            const panel = new PromotionChoicePanel(scene, unit, targets, scene.gameData.skills);
            promotedClassData = await panel.show();
            if (!promotedClassData) {
              // Cancelled — no gold spent
              return;
            }
          }

          const promotionBonuses = lordData?.promotionBonuses || promotedClassData.promotionBonuses;
          if (!promotionBonuses) {
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            scene.showChurchMessage('Promotion data missing.', '#ff4444');
            return;
          }

          // Charge gold only after successful selection
          if (!rm.spendGold(CHURCH_PROMOTE_COST)) {
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            scene.showChurchMessage('Not enough gold!', '#ff4444');
            return;
          }

          const promotionResult = promoteUnit(
            unit,
            promotedClassData,
            promotionBonuses,
            scene.gameData.skills,
          );
          scene._churchPromotionsThisVisit = (scene._churchPromotionsThisVisit || 0) + 1;
          scene.runManager.setChurchPromotionCount(
            scene._currentChurchNodeId,
            scene._churchPromotionsThisVisit,
          );

          if (typeof scene.sound?.stopByKey === 'function') scene.sound.stopByKey('sfx_levelup');
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_levelup');
          const droppedNames = getSkillDisplayNames(
            promotionResult?.droppedSkills,
            scene.gameData.skills,
          );
          scene._showChurchSuccessMessage(
            node,
            droppedNames.length > 0
              ? `${unit.name} promoted to ${promotedClassData.name}! ` +
                  `Skill limit: couldn't learn ${droppedNames.join(', ')}.`
              : `${unit.name} promoted to ${promotedClassData.name}!`,
            droppedNames.length > 0 ? '#ffaa66' : '#ffdd44',
            'promotion',
          );
        });
        scene.churchContentGroup.push(unitBtn);
      }
    }

    // Scroll hint when content overflows
    if ((scene.churchScrollMax || 0) > 0) {
      const percent =
        scene.churchScrollMax > 0 ? Math.round((offset / scene.churchScrollMax) * 100) : 0;
      const hint = scene.add
        .text(445, CHURCH_LIST_BOTTOM_Y + 2, `Scroll: ${percent}%`, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#888888',
          backgroundColor: '#222222',
          padding: { x: 4, y: 2 },
        })
        .setDepth(OVERLAY_CONTENT_DEPTH);
      scene.churchContentGroup.push(hint);
    }
  }

  leaveChurchNode() {
    const scene = this.scene;
    if (!scene.churchOverlay) return;
    if (typeof scene.sound?.stopByKey === 'function') scene.sound.stopByKey('sfx_levelup');
    const node = scene._churchNode;
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', scene.runManager.currentAct), scene, 300);
    scene.closeChurchOverlay();
    if (node) {
      scene.runManager.markNodeComplete(node.id);
      scene.checkActComplete();
    }
  }

  _showChurchSuccessMessage(node, functionalMessage, functionalColor, flavorType) {
    const scene = this.scene;
    scene.refreshChurchOverlay(node);
    scene.showChurchMessage(functionalMessage, functionalColor);
    try {
      scene._scheduleChurchFlavor(flavorType);
    } catch (_) {
      /* best-effort flavor — don't block functional message */
    }
  }

  _scheduleChurchFlavor(flavorType, delayMs = 600) {
    const scene = this.scene;
    clearTrackedSceneTimer(scene, scene._churchFlavorTimer);
    scene._churchFlavorTimer = null;
    const act = scene.runManager?.currentAct || 'act1';
    const pool =
      scene.gameData?.dialogue?.churchFlavor?.[flavorType]?.[act] ||
      scene.gameData?.dialogue?.churchFlavor?.[flavorType]?.['act3'];
    if (!Array.isArray(pool) || pool.length === 0) return;
    const line = pool[Math.floor(Math.random() * pool.length)];
    scene._churchFlavorTimer = trackSceneTimer(
      scene,
      scene.time?.delayedCall?.(delayMs, () => {
        scene._churchFlavorTimer = null;
        if (scene.scene?.isActive && !scene.scene.isActive()) return;
        if (!Array.isArray(scene.churchOverlay)) return;
        scene.showChurchMessage(line, '#aabbcc');
      }),
    );
  }

  showChurchMessage(text, color) {
    const scene = this.scene;
    if (scene.scene?.isActive && !scene.scene.isActive()) return;
    if (!Array.isArray(scene.churchOverlay)) return;
    if (scene.churchMessage) scene.churchMessage.destroy();
    clearTrackedSceneTimer(scene, scene._churchMessageTimer);
    scene._churchMessageTimer = null;
    scene.churchMessage = scene.add
      .text(320, 95, text, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color,
        backgroundColor: '#000000dd',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(302);
    scene.churchOverlay.push(scene.churchMessage);

    scene._churchMessageTimer = trackSceneTimer(
      scene,
      scene.time?.delayedCall?.(2000, () => {
        scene._churchMessageTimer = null;
        if (scene.churchMessage) {
          scene.churchMessage.destroy();
          scene.churchMessage = null;
        }
      }),
    );
  }

  refreshChurchOverlay(node) {
    const scene = this.scene;
    scene.closeChurchOverlay();
    scene.showChurchOverlay(node);
  }

  closeChurchOverlay() {
    const scene = this.scene;
    scene._churchViewingRoster = false;
    clearTrackedSceneTimer(scene, scene._churchMessageTimer);
    scene._churchMessageTimer = null;
    clearTrackedSceneTimer(scene, scene._churchFlavorTimer);
    scene._churchFlavorTimer = null;
    if (scene.churchOverlay) {
      scene.churchOverlay.forEach((o) => o.destroy());
      scene.churchOverlay = null;
    }
    if (scene.churchContentGroup) {
      scene.churchContentGroup.forEach((o) => o.destroy());
      scene.churchContentGroup = null;
    }
    if (scene.churchMessage) {
      scene.churchMessage.destroy();
      scene.churchMessage = null;
    }
    scene.churchGoldText = null;
    scene._churchNode = null;
    scene._churchViewingMap = false;
    if (scene._churchReturnBtn) {
      scene._churchReturnBtn.destroy();
      scene._churchReturnBtn = null;
    }
    scene._churchMapViewSuppressCancel = false;
    scene.churchScrollOffset = 0;
    scene.churchScrollMax = 0;
    scene._churchScrollItems = null;
    scene._touchScrollDrag = null;
  }

  destroy() {
    this.scene = null;
  }
}
