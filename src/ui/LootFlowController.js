import { UI_PALETTE, UI_HEX, applyTextResolution } from '../utils/uiStyles.js';
import { inputHint } from '../utils/inputHint.js';
import {
  canForge,
  canForgeStat,
  applyForge,
  isForged,
  getStatForgeCount,
} from '../engine/ForgeSystem.js';
import {
  canImbue,
  applyImbue,
  isImbueStone,
  resolveStoneImbue,
  getImbueList,
  IMBUE_CHOICE_ID,
} from '../engine/ImbueSystem.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import { FORGE_MAX_LEVEL, FORGE_STAT_CAP, LORE_TEXT_COLOR } from '../utils/constants.js';
import { BoundingFocusController } from './BoundingFocusController.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';

const POST_LOOT_TRANSITION_TIMEOUT_MS = 8000;
const POST_LOOT_TRANSITION_STORY_GRACE_MS = 30000;
const POST_LOOT_TRANSITION_RECHECK_MS = 250;

export class LootFlowController {
  constructor(scene) {
    this.scene = scene;
  }

  _clearPostLootTransitionFallback() {
    const scene = this.scene;
    if (scene._postLootTransitionTimer) {
      clearTimeout(scene._postLootTransitionTimer);
      scene._postLootTransitionTimer = null;
    }
  }

  _startPostLootTransition() {
    const scene = this.scene;
    if (scene._postLootTransitionStarted) return;
    scene._postLootTransitionStarted = true;
    scene._postLootTransitionCompleted = false;
    scene._postLootTransitionStartedAt = Date.now();

    const maybeForceFallback = () => {
      if (scene._postLootTransitionCompleted) return;
      const elapsed = Date.now() - scene._postLootTransitionStartedAt;
      if (scene.isStoryInputLocked() && elapsed < POST_LOOT_TRANSITION_STORY_GRACE_MS) {
        scene._postLootTransitionTimer = setTimeout(
          maybeForceFallback,
          POST_LOOT_TRANSITION_RECHECK_MS,
        );
        return;
      }
      scene.forceTransitionAfterBattle();
    };

    scene._postLootTransitionTimer = setTimeout(
      maybeForceFallback,
      POST_LOOT_TRANSITION_TIMEOUT_MS,
    );
    scene._transitionAfterBattlePromise = Promise.resolve(scene.transitionAfterBattle())
      .then((ok) => {
        if (ok === true) {
          scene._postLootTransitionCompleted = true;
          this._clearPostLootTransitionFallback();
        }
        // If failed or undefined, leave the fallback timer running
      })
      .catch((err) => {
        console.warn('[BattleScene] transitionAfterBattle rejected:', err);
        // Don't clear fallback - let it fire forceTransitionAfterBattle
      });
  }

  _showLootTooltip(choice, item, cx, cardY, cardH) {
    const scene = this.scene;
    this._hideLootTooltip();
    const text = scene._getLootTooltipText(choice, item);
    if (!text) return;

    const padX = 8;
    const padY = 6;
    const maxTextW = 224;
    const cam = scene.cameras.main;

    const detailText = applyTextResolution(
      scene.add.text(0, 0, text, {
        fontFamily: 'Arial',
        fontSize: '9px',
        color: UI_PALETTE.text,
        lineSpacing: 3,
        wordWrap: { width: maxTextW },
      }),
    ).setDepth(761);

    // Lore as its own stacked object (single-color Phaser text; the tooltip
    // text builder stays untouched so its exact-string tests hold).
    const loreGap = 6;
    const loreText = item?.lore
      ? applyTextResolution(
          scene.add.text(0, 0, `"${item.lore}"`, {
            fontFamily: 'Arial',
            fontSize: '9px',
            fontStyle: 'italic',
            color: LORE_TEXT_COLOR,
            lineSpacing: 3,
            wordWrap: { width: maxTextW },
          }),
        ).setDepth(761)
      : null;

    const contentW = Math.max(detailText.width, loreText ? loreText.width : 0);
    const contentH = detailText.height + (loreText ? loreGap + loreText.height : 0);
    const boxW = Math.min(Math.max(contentW + padX * 2, 120), 240);
    const boxH = contentH + padY * 2;

    // Position above card with 6px gap, clamped to viewport
    let tx = cx - boxW / 2;
    let ty = cardY - cardH / 2 - boxH - 6;
    if (tx + boxW > cam.width - 5) tx = cam.width - 5 - boxW;
    if (tx < 5) tx = 5;
    if (ty < 5) ty = cardY + cardH / 2 + 6; // flip below if no room above

    const bg = scene.add
      .rectangle(tx + boxW / 2, ty + boxH / 2, boxW, boxH, UI_HEX.panel, 0.95)
      .setDepth(760)
      .setStrokeStyle(1, 0x336666);
    detailText.setPosition(tx + padX, ty + padY);
    if (loreText) loreText.setPosition(tx + padX, ty + padY + detailText.height + loreGap);

    scene._lootTooltip = scene.add
      .container(0, 0, loreText ? [bg, detailText, loreText] : [bg, detailText])
      .setDepth(760);
    scene._pinToScreen(scene._lootTooltip);
  }

  _hideLootTooltip() {
    const scene = this.scene;
    this._clearLootTooltipTimer();
    if (scene._lootTooltip) {
      scene._lootTooltip.destroy();
      scene._lootTooltip = null;
    }
  }

  _clearLootTooltipTimer() {
    const scene = this.scene;
    if (scene._lootTooltipTimer) {
      scene._lootTooltipTimer.remove(false);
      scene._lootTooltipTimer = null;
    }
  }

  // Gamepad/keyboard focus for the forge sub-pickers (which build flat button
  // lists, not the scrolling roster pickers). A ring tracks the selectable buttons
  // + Back; pushing a scope auto-hides the loot-card ring beneath (onTopChange).
  // Returns an idempotent teardown to call on every exit path.
  _attachForgePickerFocus(focusButtons, backBtn) {
    const targets = [...focusButtons, backBtn].filter(Boolean);
    if (targets.length === 0) return () => {};
    const ring = new BoundingFocusController(this.scene, 715);
    ring.setObjects(targets, true);
    const owner = {};
    pushInputScope(owner, (action, payload) => {
      switch (action) {
        case InputAction.NAVIGATE:
          ring.move(payload?.dy || 0);
          break;
        case InputAction.CONFIRM:
          ring.activate();
          break;
        case InputAction.CANCEL:
        case InputAction.PAUSE:
          backBtn?.emit('pointerdown', { button: 0 });
          break;
      }
    });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      popInputScope(owner);
      ring.destroy();
    };
  }

  showForgeWeaponPicker(whetstone, unit, lootGroup, cardIdx) {
    const scene = this.scene;
    const pickerGroup = [];
    const cam = scene.cameras.main;
    let teardownFocus = () => {};
    const focusButtons = [];
    const stoneIsImbue = isImbueStone(whetstone);

    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710)
      .setInteractive();
    pickerGroup.push(bg);

    const title = applyTextResolution(
      scene.add.text(
        cam.centerX,
        60,
        `${unit.name}: Select weapon to ${stoneIsImbue ? 'imbue' : 'forge'}`,
        {
          fontFamily: 'Arial',
          fontSize: '14px',
          color: UI_PALETTE.warn,
        },
      ),
    )
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(title);

    const forgeableWeapons = unit.inventory.filter((w) =>
      stoneIsImbue
        ? canImbue(w)
        : whetstone.forgeStat !== 'choice'
          ? canForgeStat(w, whetstone.forgeStat)
          : canForge(w),
    );
    const topY = 110;
    const bottomY = cam.height - 70;
    const rowGap = Math.max(
      30,
      Math.min(48, Math.floor((bottomY - topY) / Math.max(forgeableWeapons.length, 1))),
    );
    const btnH = Math.max(24, rowGap - 8);

    for (let i = 0; i < forgeableWeapons.length; i++) {
      const wpn = forgeableWeapons[i];
      const level = wpn._forgeLevel || 0;
      const by = topY + i * rowGap;
      const wpnColor = isForged(wpn) ? UI_PALETTE.good : UI_PALETTE.text;

      const btn = scene.add
        .rectangle(cam.centerX, by, 280, btnH, UI_HEX.selected, 1)
        .setStrokeStyle(1, UI_HEX.warn)
        .setDepth(711)
        .setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);
      focusButtons.push(btn);

      const label = applyTextResolution(
        scene.add.text(cam.centerX, by - Math.floor(btnH * 0.22), wpn.name, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: wpnColor,
        }),
      )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(label);

      const detail = applyTextResolution(
        scene.add.text(
          cam.centerX,
          by + Math.floor(btnH * 0.28),
          `Mt:${wpn.might} Ht:${wpn.hit} Cr:${wpn.crit} Wt:${wpn.weight}  [${level}/${FORGE_MAX_LEVEL}]`,
          {
            fontFamily: 'Arial',
            fontSize: '9px',
            color: UI_PALETTE.muted,
          },
        ),
      )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(detail);

      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        try {
          teardownFocus();
          for (const obj of pickerGroup) obj.destroy();
          if (stoneIsImbue && whetstone.imbueId === IMBUE_CHOICE_ID) {
            // Prismatic Stone: pick which imbue to apply
            this.showImbuePickerLoot(whetstone, wpn, lootGroup, cardIdx);
          } else if (stoneIsImbue) {
            // Specific imbuing stone: apply immediately
            const imbueDef = resolveStoneImbue(whetstone, scene.gameData?.imbues);
            const result = imbueDef ? applyImbue(wpn, imbueDef) : { success: false };
            if (!result.success) {
              scene.reportLootError(
                'showForgeWeaponPicker:applyImbueFailed',
                new Error('applyImbue returned success=false'),
                {
                  unit: unit?.name,
                  weapon: wpn?.name,
                  imbueId: whetstone?.imbueId,
                  cardIdx,
                },
              );
              scene.showLootStatus('Imbue failed. Choose another weapon.', UI_PALETTE.bad);
              scene.showForgeLootPicker(whetstone, lootGroup, cardIdx);
              return;
            }
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            scene.showLootStatus(`${wpn.name} shimmers with new power!`, UI_PALETTE.rarityEpic);
            this.finalizeLootPick(lootGroup, cardIdx);
          } else if (whetstone.forgeStat === 'choice') {
            // Silver Whetstone: pick stat
            this.showForgeStatPickerLoot(whetstone, wpn, lootGroup, cardIdx);
          } else {
            // Specific whetstone: apply immediately
            const result = applyForge(wpn, whetstone.forgeStat);
            if (!result.success) {
              scene.reportLootError(
                'showForgeWeaponPicker:applyForgeFailed',
                new Error('applyForge returned success=false'),
                {
                  unit: unit?.name,
                  weapon: wpn?.name,
                  forgeStat: whetstone?.forgeStat,
                  cardIdx,
                },
              );
              scene.showLootStatus('Forge failed. Choose another weapon.', UI_PALETTE.bad);
              scene.showForgeLootPicker(whetstone, lootGroup, cardIdx);
              return;
            }
            const audio = scene.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            this.finalizeLootPick(lootGroup, cardIdx);
          }
        } catch (err) {
          scene.reportLootError('showForgeWeaponPicker:pointerdown', err, {
            unit: unit?.name,
            weapon: wpn?.name,
            forgeStat: whetstone?.forgeStat,
            imbueId: whetstone?.imbueId,
            cardIdx,
          });
          scene.showLootStatus(
            'An error occurred while forging. Returning to rewards.',
            UI_PALETTE.bad,
          );
          for (const obj of lootGroup) obj.setVisible(true);
          scene._lootController?.mobileRewards?.open();
        }
      });
    }

    // Back button
    const backBtn = applyTextResolution(
      scene.add.text(cam.centerX, cam.height - 24, '< Back', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: UI_PALETTE.muted,
        backgroundColor: UI_PALETTE.raised,
        padding: { x: 12, y: 6 },
      }),
    )
      .setOrigin(0.5)
      .setDepth(711)
      .setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      teardownFocus();
      for (const obj of pickerGroup) obj.destroy();
      scene.showForgeLootPicker(whetstone, lootGroup, cardIdx);
    });

    teardownFocus = this._attachForgePickerFocus(focusButtons, backBtn);
  }

  showForgeStatPickerLoot(whetstone, weapon, lootGroup, cardIdx) {
    const scene = this.scene;
    const pickerGroup = [];
    const cam = scene.cameras.main;
    let teardownFocus = () => {};
    const focusButtons = [];

    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710)
      .setInteractive();
    pickerGroup.push(bg);

    const title = applyTextResolution(
      scene.add.text(cam.centerX, 100, `Forge ${weapon.name}: Choose stat`, {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.warn,
      }),
    )
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(title);

    const stats = [
      { key: 'might', label: '+1 Might' },
      { key: 'crit', label: '+5 Crit' },
      { key: 'hit', label: '+5 Hit' },
      { key: 'weight', label: '-1 Weight' },
    ];

    const startY = 160;
    const btnH = 40;

    for (let i = 0; i < stats.length; i++) {
      const stat = stats[i];
      const statCount = getStatForgeCount(weapon, stat.key);
      const atStatCap = statCount >= FORGE_STAT_CAP;
      const by = startY + i * (btnH + 10);
      const color = atStatCap ? UI_PALETTE.muted : UI_PALETTE.text;
      const countLabel = atStatCap ? 'MAX' : `(${statCount}/${FORGE_STAT_CAP})`;

      const btn = scene.add
        .rectangle(cam.centerX, by, 240, btnH, atStatCap ? 0x332222 : UI_HEX.selected, 1)
        .setStrokeStyle(1, atStatCap ? UI_HEX.line : UI_HEX.warn)
        .setDepth(711);
      pickerGroup.push(btn);

      const label = applyTextResolution(
        scene.add.text(cam.centerX, by, `${stat.label}  ${countLabel}`, {
          fontFamily: 'Arial',
          fontSize: '13px',
          color,
        }),
      )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(label);

      if (!atStatCap) {
        btn.setInteractive({ useHandCursor: true });
        focusButtons.push(btn);
        btn.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          applyForge(weapon, stat.key);
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          teardownFocus();
          for (const obj of pickerGroup) obj.destroy();
          this.finalizeLootPick(lootGroup, cardIdx);
        });
      }
    }

    // Back button
    const backBtn = applyTextResolution(
      scene.add.text(cam.centerX, startY + stats.length * (btnH + 10) + 20, '< Back', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: UI_PALETTE.muted,
        backgroundColor: UI_PALETTE.raised,
        padding: { x: 12, y: 6 },
      }),
    )
      .setOrigin(0.5)
      .setDepth(711)
      .setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      teardownFocus();
      for (const obj of pickerGroup) obj.destroy();
      scene.showForgeLootPicker(whetstone, lootGroup, cardIdx);
    });

    teardownFocus = this._attachForgePickerFocus(focusButtons, backBtn);
  }

  // Prismatic Stone: pick which imbue to bless the chosen weapon with.
  // Mirrors showForgeStatPickerLoot (Silver Whetstone stat choice).
  showImbuePickerLoot(stone, weapon, lootGroup, cardIdx) {
    const scene = this.scene;
    const pickerGroup = [];
    const cam = scene.cameras.main;
    let teardownFocus = () => {};
    const focusButtons = [];

    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710)
      .setInteractive();
    pickerGroup.push(bg);

    const title = applyTextResolution(
      scene.add.text(cam.centerX, 70, `Imbue ${weapon.name}: Choose blessing`, {
        fontFamily: 'Arial',
        fontSize: '14px',
        color: UI_PALETTE.rarityEpic,
      }),
    )
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(title);

    const imbues = getImbueList(scene.gameData?.imbues);
    const startY = 116;
    const btnH = 40;

    for (let i = 0; i < imbues.length; i++) {
      const imbue = imbues[i];
      const by = startY + i * (btnH + 8);

      const btn = scene.add
        .rectangle(cam.centerX, by, 380, btnH, 0x332244, 1)
        .setStrokeStyle(1, 0xcc88ff)
        .setDepth(711)
        .setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);
      focusButtons.push(btn);

      const label = applyTextResolution(
        scene.add.text(cam.centerX, by - Math.floor(btnH * 0.2), imbue.name, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: '#e0d0ff',
        }),
      )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(label);

      const detail = applyTextResolution(
        scene.add.text(cam.centerX, by + Math.floor(btnH * 0.25), imbue.description || '', {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: UI_PALETTE.muted,
        }),
      )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(detail);

      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        try {
          const result = applyImbue(weapon, imbue);
          if (!result.success) {
            scene.reportLootError(
              'showImbuePickerLoot:applyImbueFailed',
              new Error('applyImbue returned success=false'),
              { weapon: weapon?.name, imbueId: imbue?.id, cardIdx },
            );
            scene.showLootStatus('Imbue failed. Choose another reward.', UI_PALETTE.bad);
            teardownFocus();
            for (const obj of pickerGroup) obj.destroy();
            for (const obj of lootGroup) obj.setVisible(true);
            scene._lootController?.mobileRewards?.open();
            return;
          }
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          teardownFocus();
          for (const obj of pickerGroup) obj.destroy();
          scene.showLootStatus(`${weapon.name} shimmers with new power!`, UI_PALETTE.rarityEpic);
          this.finalizeLootPick(lootGroup, cardIdx);
        } catch (err) {
          scene.reportLootError('showImbuePickerLoot:pointerdown', err, {
            weapon: weapon?.name,
            imbueId: imbue?.id,
            cardIdx,
          });
          scene.showLootStatus(
            'An error occurred while imbuing. Returning to rewards.',
            UI_PALETTE.bad,
          );
          teardownFocus();
          for (const obj of pickerGroup) obj.destroy();
          for (const obj of lootGroup) obj.setVisible(true);
          scene._lootController?.mobileRewards?.open();
        }
      });
    }

    // Back button
    const backBtn = applyTextResolution(
      scene.add.text(cam.centerX, cam.height - 24, '< Back', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: UI_PALETTE.muted,
        backgroundColor: UI_PALETTE.raised,
        padding: { x: 12, y: 6 },
      }),
    )
      .setOrigin(0.5)
      .setDepth(711)
      .setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', (pointer) => {
      if (pointer?.button !== 0) return;
      teardownFocus();
      for (const obj of pickerGroup) obj.destroy();
      scene.showForgeLootPicker(stone, lootGroup, cardIdx);
    });

    teardownFocus = this._attachForgePickerFocus(focusButtons, backBtn);
  }

  showLootRoster() {
    const scene = this.scene;
    if (scene.lootRosterVisible) return;
    scene.lootRosterVisible = true;
    scene.lootRosterGroup = [];
    const cam = scene.cameras.main;
    const roster = scene.runManager.roster;

    const panelW = 500;
    const lineH = 18;
    const headerH = 30;
    const panelH = headerH + roster.length * lineH + 16;
    const px = cam.centerX;
    const py = cam.centerY;

    const bg = scene.add
      .rectangle(px, py, panelW, panelH, UI_HEX.panel, 0.95)
      .setStrokeStyle(2, UI_HEX.line)
      .setDepth(750)
      .setInteractive();
    scene.lootRosterGroup.push(bg);

    const title = applyTextResolution(
      scene.add.text(px, py - panelH / 2 + 14, 'ROSTER', {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: UI_PALETTE.accent,
        fontStyle: 'bold',
      }),
    )
      .setOrigin(0.5)
      .setDepth(751);
    scene.lootRosterGroup.push(title);

    const startY = py - panelH / 2 + headerH + 8;
    const leftX = px - panelW / 2 + 12;

    for (let i = 0; i < roster.length; i++) {
      const u = roster[i];
      const y = startY + i * lineH;
      const wpnName = u.weapon?.name || u.inventory?.[0]?.name || '-';
      const accName = u.accessory?.name || '-';
      const invCount = (u.inventory || []).length;
      const line = `${u.name.padEnd(10)} ${u.className.padEnd(12)} Lv${String(getDisplayLevel(u)).padStart(2)} HP:${u.stats.HP}/${u.maxHP || u.stats.HP}  Wpn:${wpnName}  Acc:${accName}  Inv:${invCount}`;
      const txt = applyTextResolution(
        scene.add.text(leftX, y, line, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: UI_PALETTE.muted,
        }),
      ).setDepth(751);
      scene.lootRosterGroup.push(txt);
    }

    const hint = applyTextResolution(
      scene.add.text(
        px,
        py + panelH / 2 - 10,
        inputHint(scene, '[R] Close  |  [ESC] Close', 'Tap Roster again to close'),
        {
          fontFamily: 'Arial',
          fontSize: '9px',
          color: UI_PALETTE.muted,
        },
      ),
    )
      .setOrigin(0.5)
      .setDepth(751);
    scene.lootRosterGroup.push(hint);
    scene._pinToScreen(scene.lootRosterGroup);
  }

  hideLootRoster() {
    const scene = this.scene;
    if (!scene.lootRosterVisible) return;
    scene.lootRosterVisible = false;
    if (scene.lootRosterGroup) {
      for (const obj of scene.lootRosterGroup) obj.destroy();
      scene.lootRosterGroup = null;
    }
  }

  finalizeLootPick(lootGroup, cardIndex) {
    const scene = this.scene;
    this._hideLootTooltip();
    if (scene._lootResolving) return;
    scene._lootController?.claimed?.add(cardIndex);
    if (!scene.isElite || !scene._elitePicksRemaining || scene._elitePicksRemaining <= 1) {
      // Non-elite or last pick - clean up immediately
      scene._lootResolving = true;
      scene._lootCards = null;
      scene._lootInstruction = null;
      this.scheduleLootCleanup(lootGroup);
      return;
    }

    scene._elitePicksRemaining--;

    // Gray out the chosen card
    const cardRef = scene._lootCards?.[cardIndex];
    if (cardRef?.bg) {
      cardRef.bg.setFillStyle(UI_HEX.panel);
      cardRef.bg.setStrokeStyle(2, UI_HEX.line);
      cardRef.bg.removeAllListeners('pointerdown');
      cardRef.bg.disableInteractive();
    }

    // Re-show loot cards (sub-pickers hide them)
    for (const obj of lootGroup) obj.setVisible(true);
    scene._lootController?.mobileRewards?.open();

    // Update instruction text
    if (scene._lootInstruction) {
      scene._lootInstruction.setText('Choose 1 more reward');
    }
  }

  cleanupLootScreen(lootGroup) {
    const scene = this.scene;
    this._hideLootTooltip();
    if (scene._lootCleanedUp) return;
    scene._lootCleanedUp = true;
    scene._lootController?._teardownInputFocus?.();
    this.hideLootRoster();
    if (scene.lootSettingsOverlay) {
      scene.lootSettingsOverlay.hide();
      scene.lootSettingsOverlay = null;
    }
    const resolvedLootGroup = lootGroup || scene.lootGroup || [];
    try {
      for (const obj of resolvedLootGroup) {
        try {
          if (obj && typeof obj.destroy === 'function') obj.destroy();
        } catch (objErr) {
          console.warn('[BattleScene][LootFlow] failed to destroy loot object', objErr);
        }
      }
      scene.lootGroup = null;
      this._startPostLootTransition();
    } catch (err) {
      scene._lootResolving = false;
      scene._lootCleanedUp = false;
      scene.reportLootError('cleanupLootScreen', err, {
        isElite: scene.isElite,
        picksRemaining: scene._elitePicksRemaining,
      });
    }
  }

  scheduleLootCleanup(lootGroup) {
    const scene = this.scene;
    if (scene._lootCleanupScheduled) return;
    scene._lootCleanupScheduled = true;
    const runCleanup = () => {
      scene._lootCleanupScheduled = false;
      scene._lootCleanupTimeout = null;
      if (scene._sceneShutdownCleanedUp) return;
      if (!scene._lootCleanedUp) this.cleanupLootScreen(lootGroup);
    };
    Promise.resolve().then(runCleanup);
    scene._lootCleanupTimeout = setTimeout(runCleanup, 0);
  }

  destroy() {
    this.scene = null;
  }
}
