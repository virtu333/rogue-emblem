// VisionRewindController — extracted from BattleScene (Chunk 4)
// Manages vision rewind snapshots, dialog UI, charge tracking, and HUD display.
// State properties (visionSnapshot, pendingVisionSnapshot, visionDialog, visionBaseSeed,
// visionHudText) remain on BattleScene; controller accesses via this.scene.*.

import { serializeUnit } from '../engine/RunManager.js';
import { getRating } from '../engine/TurnBonusCalculator.js';

/**
 * FNV-1a hash — deterministic seed derivation for rewind RNG re-seeding.
 * Exported for direct unit testing.
 */
export function hashRewindSeed(seed, rewindCount) {
  const input = `${seed >>> 0}:${Math.max(0, rewindCount | 0)}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class VisionRewindController {
  constructor(scene, runManager) {
    this.scene = scene;
    this.runManager = runManager;
  }

  /**
   * Where Vision charges live. Runs charge the RunManager; standalone battles
   * (tutorial) get a scene-scoped store so charges can be granted and spent
   * without a run — it starts at 0, so nothing changes unless something
   * (the tutorial lord-death flow) deposits a charge.
   */
  _chargeHost() {
    if (this.runManager) return this.runManager;
    return (this.scene._standaloneVisionState ||= { visionChargesRemaining: 0, visionCount: 0 });
  }

  // ── Initialization ──────────────────────────────────────────

  initialize() {
    if (this.runManager) {
      const baseSeed = Number.isFinite(this.runManager.rngSeed)
        ? this.runManager.rngSeed >>> 0
        : this.scene.deriveBattleSeed() >>> 0;
      this.runManager.rngSeed = baseSeed;
      this.scene.visionBaseSeed = baseSeed;
      if (!Number.isFinite(this.runManager.visionChargesRemaining)) {
        const getBaseVisionCharges = this.runManager.getBaseVisionCharges;
        this.runManager.visionChargesRemaining =
          typeof getBaseVisionCharges === 'function'
            ? getBaseVisionCharges.call(this.runManager)
            : 1;
      }
      if (!Number.isFinite(this.runManager.visionCount)) this.runManager.visionCount = 0;
    } else {
      this.scene.visionBaseSeed = this.scene.deriveBattleSeed() >>> 0;
    }
  }

  // ── Charge query ────────────────────────────────────────────

  getChargesRemaining() {
    return Math.max(0, Math.trunc(this._chargeHost().visionChargesRemaining || 0));
  }

  // ── Snapshot capture / commit ───────────────────────────────

  captureSnapshot() {
    const scene = this.scene;
    const stripVisuals = (unit) => {
      const serialized = serializeUnit(unit);
      // serializeUnit reverts timed-buff stats and strips per-battle art
      // tracking for between-battle persistence. Mid-battle snapshots must
      // keep them — otherwise a rewind refunds perMapLimit art uses from
      // earlier turns and drops active kill buffs. Mirrors
      // BattleSuspendController.serializeSuspendUnit.
      serialized.stats = { ...unit.stats };
      // Live mov must travel with live stats — a MOV timed buff reverted in
      // serialized.mov but kept in stats.MOV would desync movement from HUD.
      if (Number.isFinite(unit.mov)) serialized.mov = unit.mov;
      // Once-per-battle flags consumed on earlier turns must survive the
      // rewind — serializeUnit force-clears them for between-battle reuse.
      serialized._miracleUsed = unit._miracleUsed === true;
      serialized._phoenixBroochUsed = unit._phoenixBroochUsed === true;
      for (const field of [
        '_battleDeltas',
        '_battleWeaponArtUsage',
        '_battleAbilityUsage',
        '_battleTimedWeaponArtBuffs',
        '_battleTimedWeaponArtAppliedStats',
        '_battleTimedWeaponArtAppliedCombatMods',
      ]) {
        if (unit[field] !== undefined) serialized[field] = structuredClone(unit[field]);
      }
      try {
        return structuredClone(serialized);
      } catch (err) {
        try {
          return JSON.parse(JSON.stringify(serialized));
        } catch {
          const minimal = {
            name: serialized.name,
            className: serialized.className,
            faction: serialized.faction,
            level: serialized.level,
            xp: serialized.xp,
            stats: serialized.stats,
            growths: serialized.growths,
            currentHP: serialized.currentHP,
            col: serialized.col,
            row: serialized.row,
            hasMoved: Boolean(serialized.hasMoved),
            hasActed: Boolean(serialized.hasActed),
            weapon: serialized.weapon || null,
            inventory: Array.isArray(serialized.inventory) ? serialized.inventory : [],
            consumables: Array.isArray(serialized.consumables) ? serialized.consumables : [],
            skills: Array.isArray(serialized.skills) ? serialized.skills : [],
            proficiencies: Array.isArray(serialized.proficiencies) ? serialized.proficiencies : [],
            accessory: serialized.accessory || null,
            isLord: Boolean(serialized.isLord),
            isBoss: Boolean(serialized.isBoss),
            _miracleUsed: Boolean(serialized._miracleUsed),
            _gambitUsedThisTurn: Boolean(serialized._gambitUsedThisTurn),
          };
          console.warn(
            'Vision snapshot used minimal fallback clone for unit:',
            serialized?.name,
            err,
          );
          return minimal;
        }
      }
    };
    const fog = scene.grid?.fogEnabled
      ? {
          visible: [...(scene.grid.visibleSet || new Set())],
          everSeen: [...(scene.grid.everSeenSet || new Set())],
        }
      : null;
    const snapshot = {
      playerUnits: scene.playerUnits.map(stripVisuals),
      enemyUnits: scene.enemyUnits.map(stripVisuals),
      npcUnits: scene.npcUnits.map(stripVisuals),
      escapedUnits: (scene.escapedUnits || []).map(stripVisuals),
      goldEarned: scene.goldEarned || 0,
      turnNumber: scene.turnManager?.turnNumber || 1,
      phase: scene.turnManager?.currentPhase || 'player',
      turnPar: scene.turnPar,
      objectiveText: scene.objectiveText?.text || '',
      antiTurtleState: structuredClone(scene.antiTurtleState || {}),
      rngSeed: Number.isFinite(this.runManager?.rngSeed)
        ? this.runManager.rngSeed >>> 0
        : scene.visionBaseSeed >>> 0,
      fog,
      ballistas: scene.ballistas?.map((b) => ({ ...b })) || [],
      zombieTombstones: structuredClone(scene._zombieTombstones || []),
    };
    if (!scene.visionSnapshot) {
      scene.visionSnapshot = snapshot;
      scene.pendingVisionSnapshot = null;
    } else {
      scene.pendingVisionSnapshot = snapshot;
    }
  }

  _activatePendingSnapshot() {
    if (!this.scene.pendingVisionSnapshot) return;
    this.scene.visionSnapshot = this.scene.pendingVisionSnapshot;
    this.scene.pendingVisionSnapshot = null;
  }

  commitSnapshotIfPending() {
    if (this.scene.turnManager?.currentPhase !== 'player') return false;
    if (!this.scene.pendingVisionSnapshot) return false;
    this._activatePendingSnapshot();
    return true;
  }

  // ── Snapshot apply (rewind) ─────────────────────────────────

  _applySnapshot() {
    const scene = this.scene;
    if (!scene.visionSnapshot) return false;
    const restoreUnits = (targetArr, sourceUnits) => {
      for (const unit of targetArr) scene.removeUnitGraphic(unit);
      targetArr.length = 0;
      for (const unitData of sourceUnits) {
        const unit = structuredClone(unitData);
        targetArr.push(unit);
        scene.addUnitGraphic(unit);
        // Conditions rewind with the unit; rebuild their badges (mirrors
        // BattleSuspendController's restore).
        for (const cond of Array.isArray(unit._conditions) ? unit._conditions : []) {
          if (cond?.id) scene._addConditionIcon?.(unit, cond.id);
        }
      }
    };

    restoreUnits(scene.playerUnits, scene.visionSnapshot.playerUnits);
    restoreUnits(scene.enemyUnits, scene.visionSnapshot.enemyUnits);
    restoreUnits(scene.npcUnits, scene.visionSnapshot.npcUnits);
    // Off-field escapees rewind too (a unit that escaped this turn returns to
    // the field via playerUnits above), along with the turn's earned gold.
    if (Array.isArray(scene.visionSnapshot.escapedUnits)) {
      scene.escapedUnits = scene.visionSnapshot.escapedUnits.map((u) => structuredClone(u));
    }
    if (Number.isFinite(scene.visionSnapshot.goldEarned)) {
      scene.goldEarned = scene.visionSnapshot.goldEarned;
    }

    scene.selectedUnit = null;
    scene.preMoveLoc = null;
    scene._preFogSnapshot = null;
    scene.movementRange = null;
    scene.unitPositions = null;
    scene.attackTargets = [];
    scene.healTargets = [];
    scene.shoveTargets = [];
    scene.pullTargets = [];
    scene.tradeTargets = [];
    scene.swapTargets = [];
    scene.danceTargets = [];
    scene.tradeMutatedThisSession = false;
    scene.hideActionMenu();
    scene.hideForecast();
    scene.cleanupTradeUI();
    scene.grid.clearHighlights();
    scene.grid.clearAttackHighlights();
    scene.grid.clearPath();
    if (scene.inspectionPanel?.visible) scene.inspectionPanel.hide();
    if (scene.unitDetailOverlay?.visible) scene.unitDetailOverlay.hide();

    // Invalidate any in-flight enemy-phase pipeline: its AI callbacks and
    // end-of-phase tail must not act on, or advance, the restored state.
    scene._enemyPhaseEpoch = (scene._enemyPhaseEpoch || 0) + 1;
    scene.turnManager.currentPhase = scene.visionSnapshot.phase;
    scene.turnManager.turnNumber = scene.visionSnapshot.turnNumber;
    scene.turnPar =
      'turnPar' in scene.visionSnapshot ? scene.visionSnapshot.turnPar : scene.turnPar;
    scene.battleState = 'PLAYER_IDLE';
    scene.antiTurtleState = structuredClone(
      scene.visionSnapshot.antiTurtleState || {
        noProgressTurns: 0,
        aggressiveMode: false,
        turnEnrageActive: false,
        bestEnemyCount: scene.enemyUnits.length,
        bestLordThroneDistance: scene.getBestLordThroneDistance(),
      },
    );
    scene.aiController?.setAggressiveMode?.(Boolean(scene.antiTurtleState.aggressiveMode));

    if (scene.grid.fogEnabled) {
      const fog = scene.visionSnapshot.fog || { visible: [], everSeen: [] };
      scene.grid.visibleSet = new Set(fog.visible || []);
      scene.grid.everSeenSet = new Set(fog.everSeen || []);
      for (let row = 0; row < scene.grid.rows; row++) {
        for (let col = 0; col < scene.grid.cols; col++) {
          const key = `${col},${row}`;
          const overlay = scene.grid.fogOverlays[row]?.[col];
          if (!overlay) continue;
          if (scene.grid.visibleSet.has(key)) overlay.setAlpha(0);
          else if (scene.grid.everSeenSet.has(key)) overlay.setAlpha(0.3);
          else overlay.setAlpha(0.7);
        }
      }
      scene.updateEnemyVisibility();
    }

    scene.ballistas = (scene.visionSnapshot.ballistas || []).map((b) => ({ ...b }));
    scene._zombieTombstones = structuredClone(scene.visionSnapshot.zombieTombstones || []);

    const sourceSeed = Number.isFinite(scene.visionSnapshot.rngSeed)
      ? scene.visionSnapshot.rngSeed >>> 0
      : scene.visionBaseSeed >>> 0;
    const rewindCount = this._chargeHost().visionCount || 0;
    const reseed = hashRewindSeed(sourceSeed, rewindCount);
    scene.reseedBattleRng(reseed);

    scene.updateObjectiveText();
    if (scene.turnCounterText && scene.turnPar !== null) {
      const rating = getRating(scene.turnManager.turnNumber, scene.turnPar, scene.turnBonusConfig);
      const colors = { S: '#44ff44', A: '#88ccff', B: '#ffaa55', C: '#cc3333' };
      const pressureSuffix = scene.getTurnPressureSummary(scene.turnManager.turnNumber);
      scene.turnCounterText.setText(
        `Turn: ${scene.turnManager.turnNumber} / Par: ${scene.turnPar} (${rating.rating})${pressureSuffix}`,
      );
      scene.turnCounterText.setColor(colors[rating.rating] || '#e0e0e0');
    } else if (scene.turnCounterText) {
      const pressureSuffix = scene.getTurnPressureSummary(scene.turnManager.turnNumber);
      scene.turnCounterText.setText(`Turn: ${scene.turnManager.turnNumber}${pressureSuffix}`);
      scene.turnCounterText.setColor('#e0e0e0');
    }
    this.updateHud();
    scene.refreshEndTurnControl();
    this.playRewindEffect();
    // Re-assert current music to trigger orphan scanner (no-op when clean)
    const audio = scene.registry.get('audio');
    if (audio && audio.currentMusicKey) {
      audio.playMusic(audio.currentMusicKey, scene, 0);
    }
    return true;
  }

  // ── Rewind effect ───────────────────────────────────────────

  playRewindEffect() {
    const scene = this.scene;
    const flash = scene.add
      .rectangle(
        scene.cameras.main.centerX,
        scene.cameras.main.centerY,
        scene.cameras.main.width,
        scene.cameras.main.height,
        0xa8f2ff,
        0,
      )
      .setDepth(950);
    scene._pinToScreen(flash);
    scene.tweens.add({
      targets: flash,
      alpha: 0.22,
      duration: 140,
      yoyo: true,
      onComplete: () => flash.destroy(),
    });
  }

  // ── Permission check ────────────────────────────────────────

  canUseNow() {
    const scene = this.scene;
    const allowedStates = new Set([
      'PLAYER_IDLE',
      'UNIT_SELECTED',
      'UNIT_ACTION_MENU',
      'SHOWING_FORECAST',
      'SELECTING_TARGET',
      'SELECTING_HEAL_TARGET',
      'SELECTING_CURE_TARGET',
      'SELECTING_SHOVE_TARGET',
      'SELECTING_PULL_TARGET',
      'SELECTING_TRADE_TARGET',
      'SELECTING_SWAP_TARGET',
      'SELECTING_DANCE_TARGET',
      'SELECTING_ABILITY_TILE',
      'TRADING',
      'CANTO_MOVING',
    ]);
    return (
      scene.turnManager?.currentPhase === 'player' &&
      allowedStates.has(scene.battleState) &&
      !scene.pauseOverlay?.visible &&
      !scene.visionDialog &&
      this.getChargesRemaining() > 0 &&
      !!scene.visionSnapshot
    );
  }

  // ── Rewind request + dialog ─────────────────────────────────

  requestRewind({ force = false } = {}) {
    const scene = this.scene;
    if (scene.isStoryInputLocked()) return false;
    if (!force && !this.canUseNow()) return false;
    if (!scene.visionSnapshot) return false;
    const remaining = this.getChargesRemaining();
    if (remaining <= 0) return false;

    this.showDialog({
      title: 'Foresee a different path?',
      body: `Spend 1 Vision to rewind this turn?\n(${remaining} remaining)`,
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      onConfirm: () => this.executeRewind(),
      onCancel: () => {},
    });
    return true;
  }

  showLordDeathPrompt() {
    const remaining = this.getChargesRemaining();
    if (remaining <= 0 || !this.scene.visionSnapshot) return false;
    // Flavor follows Sera: generic copy when she isn't part of this run.
    const visionPool = this.runManager?.roster || this.scene.playerUnits || [];
    const seraPresent = visionPool.some((u) => u?.name === 'Sera');
    this.showDialog({
      title: seraPresent ? "Sera's vision fractures!" : 'A vision fractures!',
      body: `Reveal another path?\n(${remaining} remaining)`,
      confirmLabel: 'Rewind',
      cancelLabel: 'Accept Fate',
      onConfirm: () => this.executeRewind(),
      onCancel: () => this.scene.onDefeat(),
      accent: 0xcc6666,
    });
    return true;
  }

  showDialog({ title, body, confirmLabel, cancelLabel, onConfirm, onCancel, accent = 0x66aacc }) {
    const scene = this.scene;
    if (scene.visionDialog) this.closeDialog();
    const prevState = scene.battleState;
    scene.battleState = 'PAUSED';
    const group = [];
    const cx = scene.cameras.main.centerX;
    const cy = scene.cameras.main.centerY;

    const blocker = scene.add
      .rectangle(cx, cy, scene.cameras.main.width, scene.cameras.main.height, 0x000000, 0.75)
      .setDepth(900)
      .setInteractive();
    group.push(blocker);
    const panel = scene.add
      .rectangle(cx, cy, 340, 170, 0x121a2a, 0.96)
      .setDepth(901)
      .setStrokeStyle(2, accent, 1);
    group.push(panel);
    const titleText = scene.add
      .text(cx, cy - 54, title, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffdd88',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(902);
    group.push(titleText);
    const bodyText = scene.add
      .text(cx, cy - 14, body, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#d0d7e8',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(902);
    group.push(bodyText);
    const makeButton = (x, y, label, color, callback) => {
      const btn = scene.add
        .text(x, y, label, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color,
          backgroundColor: '#223044',
          padding: { x: 10, y: 5 },
        })
        .setOrigin(0.5)
        .setDepth(902)
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor(color));
      btn.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0) return;
        scene._uiClickBlocked = true;
        callback();
      });
      group.push(btn);
    };
    makeButton(cx - 74, cy + 52, `[ ${confirmLabel} ]`, '#a6ffb0', () => {
      this.confirmDialog();
    });
    makeButton(cx + 74, cy + 52, `[ ${cancelLabel} ]`, '#e0e0e0', () => {
      this.cancelDialog();
    });
    scene._pinToScreen(group);

    scene.visionDialog = {
      group,
      prevState,
      onConfirm,
      onCancel,
    };
  }

  confirmDialog() {
    if (!this.scene.visionDialog) return;
    const onConfirm = this.scene.visionDialog.onConfirm;
    this.closeDialog();
    onConfirm?.();
  }

  cancelDialog() {
    if (!this.scene.visionDialog) return;
    const onCancel = this.scene.visionDialog.onCancel;
    this.closeDialog();
    onCancel?.();
  }

  closeDialog() {
    if (!this.scene.visionDialog) return;
    const prevState = this.scene.visionDialog.prevState || 'PLAYER_IDLE';
    for (const obj of this.scene.visionDialog.group) obj.destroy();
    this.scene.visionDialog = null;
    this.scene.battleState = prevState;
    this.scene.refreshEndTurnControl();
  }

  // ── Execute rewind ──────────────────────────────────────────

  executeRewind() {
    if (!this.scene.visionSnapshot) return false;
    const host = this._chargeHost();
    if (host.visionChargesRemaining <= 0) return false;
    host.visionChargesRemaining -= 1;
    host.visionCount = Math.max(0, (host.visionCount || 0) + 1);
    this.scene.pendingVisionSnapshot = null;
    // Route through scene shim so test mocks on scene.applyVisionSnapshot still work
    return this.scene.applyVisionSnapshot();
  }

  // ── HUD ─────────────────────────────────────────────────────

  updateHud() {
    if (!this.scene.visionHudText) return;
    const charges = this.getChargesRemaining();
    this.scene.visionHudText.setText(`Eye: ${charges} (rewind current turn)`);
    this.scene.visionHudText.setColor(charges > 0 ? '#9ed8ff' : '#777777');
    this.scene.updateTopLeftHudLayout();
  }
}
