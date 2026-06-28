import {
  canForge,
  canForgeStat,
  applyForge,
  isForged,
  getStatForgeCount,
} from '../engine/ForgeSystem.js';
import { getDisplayLevel } from '../engine/UnitManager.js';
import { FORGE_MAX_LEVEL, FORGE_STAT_CAP } from '../utils/constants.js';
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

    const detailText = scene.add
      .text(0, 0, text, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#e0e0e0',
        lineSpacing: 3,
        wordWrap: { width: maxTextW },
      })
      .setDepth(761);

    const boxW = Math.min(Math.max(detailText.width + padX * 2, 120), 240);
    const boxH = detailText.height + padY * 2;

    // Position above card with 6px gap, clamped to viewport
    let tx = cx - boxW / 2;
    let ty = cardY - cardH / 2 - boxH - 6;
    if (tx + boxW > cam.width - 5) tx = cam.width - 5 - boxW;
    if (tx < 5) tx = 5;
    if (ty < 5) ty = cardY + cardH / 2 + 6; // flip below if no room above

    const bg = scene.add
      .rectangle(tx + boxW / 2, ty + boxH / 2, boxW, boxH, 0x111122, 0.95)
      .setDepth(760)
      .setStrokeStyle(1, 0x336666);
    detailText.setPosition(tx + padX, ty + padY);

    scene._lootTooltip = scene.add.container(0, 0, [bg, detailText]).setDepth(760);
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

    const bg = scene.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710)
      .setInteractive();
    pickerGroup.push(bg);

    const title = scene.add
      .text(cam.centerX, 60, `${unit.name}: Select weapon to forge`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ff8844',
      })
      .setOrigin(0.5)
      .setDepth(711);
    pickerGroup.push(title);

    const forgeableWeapons = unit.inventory.filter((w) =>
      whetstone.forgeStat !== 'choice' ? canForgeStat(w, whetstone.forgeStat) : canForge(w),
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
      const wpnColor = isForged(wpn) ? '#44ff88' : '#e0e0e0';

      const btn = scene.add
        .rectangle(cam.centerX, by, 280, btnH, 0x443322, 1)
        .setStrokeStyle(1, 0xff8844)
        .setDepth(711)
        .setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);
      focusButtons.push(btn);

      const label = scene.add
        .text(cam.centerX, by - Math.floor(btnH * 0.22), wpn.name, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: wpnColor,
        })
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(label);

      const detail = scene.add
        .text(
          cam.centerX,
          by + Math.floor(btnH * 0.28),
          `Mt:${wpn.might} Ht:${wpn.hit} Cr:${wpn.crit} Wt:${wpn.weight}  [${level}/${FORGE_MAX_LEVEL}]`,
          {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#aaaaaa',
          },
        )
        .setOrigin(0.5)
        .setDepth(712);
      pickerGroup.push(detail);

      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        try {
          teardownFocus();
          for (const obj of pickerGroup) obj.destroy();
          if (whetstone.forgeStat === 'choice') {
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
              scene.showLootStatus('Forge failed. Choose another weapon.', '#ff8888');
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
            cardIdx,
          });
          scene.showLootStatus('An error occurred while forging. Returning to rewards.', '#ff8888');
          for (const obj of lootGroup) obj.setVisible(true);
        }
      });
    }

    // Back button
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

    const title = scene.add
      .text(cam.centerX, 100, `Forge ${weapon.name}: Choose stat`, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#ff8844',
      })
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
      const color = atStatCap ? '#666666' : '#e0e0e0';
      const countLabel = atStatCap ? 'MAX' : `(${statCount}/${FORGE_STAT_CAP})`;

      const btn = scene.add
        .rectangle(cam.centerX, by, 240, btnH, atStatCap ? 0x332222 : 0x443322, 1)
        .setStrokeStyle(1, atStatCap ? 0x666666 : 0xff8844)
        .setDepth(711);
      pickerGroup.push(btn);

      const label = scene.add
        .text(cam.centerX, by, `${stat.label}  ${countLabel}`, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color,
        })
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
    const backBtn = scene.add
      .text(cam.centerX, startY + stats.length * (btnH + 10) + 20, '< Back', {
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
      teardownFocus();
      for (const obj of pickerGroup) obj.destroy();
      scene.showForgeLootPicker(whetstone, lootGroup, cardIdx);
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
      .rectangle(px, py, panelW, panelH, 0x111122, 0.95)
      .setStrokeStyle(2, 0x8888cc)
      .setDepth(750)
      .setInteractive();
    scene.lootRosterGroup.push(bg);

    const title = scene.add
      .text(px, py - panelH / 2 + 14, 'ROSTER', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffdd44',
        fontStyle: 'bold',
      })
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
      const txt = scene.add
        .text(leftX, y, line, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#cccccc',
        })
        .setDepth(751);
      scene.lootRosterGroup.push(txt);
    }

    const hint = scene.add
      .text(px, py + panelH / 2 - 10, '[R] Close  |  [ESC] Close', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#888888',
      })
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
      cardRef.bg.setFillStyle(0x222222);
      cardRef.bg.setStrokeStyle(2, 0x444444);
      cardRef.bg.removeAllListeners('pointerdown');
      cardRef.bg.disableInteractive();
    }

    // Re-show loot cards (sub-pickers hide them)
    for (const obj of lootGroup) obj.setVisible(true);

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
