import { BattleHistorySession } from './BattleHistorySession.js';
import { resetHistoryRecording } from './BattleHistoryRecorder.js';
import { validateBattleState } from '../engine/BattleStateSnapshot.js';
import { isSleeping } from '../engine/StatusConditionSystem.js';
import { persistFatalDecision } from './BattleFatalDecision.js';
import { BattleTimelineView } from './BattleTimelineView.js';
import {
  branchBattleTimeline,
  canRewindToEntry,
  getEntryState,
  hydrateBattleTimeline,
} from '../engine/BattleTimeline.js';
import { presentationText } from '../utils/presentationText.js';
import { captureBattleState } from './BattleCheckpointAdapter.js';
import { prepareBattleRewind, persistBattleRewind } from '../engine/BattleRewindTransaction.js';
import { hasDOMHost } from '../utils/domUI.js';
import { MenuSurface, element, button } from './MenuSurface.js';
// VisionRewindController — extracted from BattleScene (Chunk 4)
// Manages vision rewind snapshots, dialog UI, charge tracking, and HUD display.
// State properties (visionSnapshot, pendingVisionSnapshot, visionDialog, visionBaseSeed,
// visionHudText) remain on BattleScene; controller accesses via this.scene.*.

import { relinkWeapon } from '../engine/RunManager.js';
import { captureBattleWorldState, restoreBattleWorldState } from '../engine/BattleSnapshotState.js';
import { serializeBattleUnit, restoreEquippedReference } from '../engine/BattleUnitState.js';
import {
  resetBattleIdentities,
  registerBattleEntity,
  BATTLE_UNIT_GROUPS,
} from '../engine/BattleEntityIdentity.js';
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
    this._historySession?.destroy({ resume: false });
    this._historySession = null;
    this._historyReturnState = null;
    this._historySelection = null;
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
    if (scene._battleRewindPolicy === 'fixed-v1')
      scene._battleDecisionRngState = scene._battleRng?.getState?.() || null;
    const stripVisuals = (unit) => {
      const data = serializeBattleUnit(unit);
      // Legacy Vision anchors are turn starts, not action continuations.
      data.hasActed = false;
      data.hasMoved = false;
      return data;
    };
    const fog = scene.grid?.fogEnabled
      ? {
          visible: [...(scene.grid.visibleSet || new Set())],
          everSeen: [...(scene.grid.everSeenSet || new Set())],
        }
      : null;
    const snapshot =
      scene._battleRewindPolicy === 'fixed-v1'
        ? captureBattleState(scene, { rngSeed: this.runManager?.rngSeed ?? scene.visionBaseSeed })
        : {
            ...captureBattleState(scene, {
              rngSeed: this.runManager?.rngSeed ?? scene.visionBaseSeed,
            }),
            runBattleState: this.runManager
              ? structuredClone({
                  convoy: this.runManager.convoy || { weapons: [], consumables: [] },
                  accessories: this.runManager.accessories || [],
                  gold: this.runManager.gold || 0,
                })
              : null,
            nextEntityId: scene._nextBattleEntityId || 1,
            ...captureBattleWorldState(scene),
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
            // Micro-objective lifecycle state: a rewind spanning a village visit or
            // raze must revert the village (and its reward item) together with the
            // gold — see VillageController.restoreFromVisionSnapshot.
            villageState: scene._villageState ? structuredClone(scene._villageState) : null,
            caravanExited: scene._caravanExited === true,
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

  _applySnapshot({ committed = false } = {}) {
    const scene = this.scene;
    if (!scene.visionSnapshot) return false;
    resetBattleIdentities(
      scene,
      scene.visionSnapshot.nextEntityId,
      BATTLE_UNIT_GROUPS.flatMap((key) => scene.visionSnapshot[key] || scene[key] || []),
    );
    for (const unit of scene.nonDeployedUnits || []) registerBattleEntity(scene, unit);
    const restoreUnits = (targetArr, sourceUnits) => {
      for (const unit of targetArr) scene.removeUnitGraphic(unit);
      targetArr.length = 0;
      for (const unitData of sourceUnits) {
        const unit = structuredClone(unitData);
        restoreEquippedReference(unit);
        relinkWeapon(unit);
        targetArr.push(unit);
        registerBattleEntity(scene, unit);
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
      scene.escapedUnits = scene.visionSnapshot.escapedUnits.map((data) => {
        const unit = structuredClone(data);
        restoreEquippedReference(unit);
        relinkWeapon(unit);
        registerBattleEntity(scene, unit);
        return unit;
      });
    }
    if (Array.isArray(scene.visionSnapshot.nonDeployedUnits)) {
      scene.nonDeployedUnits = scene.visionSnapshot.nonDeployedUnits.map((data) => {
        const unit = structuredClone(data);
        restoreEquippedReference(unit);
        relinkWeapon(unit);
        return unit;
      });
    }
    // Complete owner table after all groups have been reconstructed.
    resetBattleIdentities(
      scene,
      scene.visionSnapshot.nextEntityId,
      BATTLE_UNIT_GROUPS.flatMap((key) => scene[key] || []),
    );
    for (const key of BATTLE_UNIT_GROUPS)
      for (const unit of scene[key] || []) registerBattleEntity(scene, unit);
    for (const unit of scene.playerUnits) if (unit.hasActed) scene.dimUnit?.(unit);
    if (Number.isFinite(scene.visionSnapshot.goldEarned)) {
      scene.goldEarned = scene.visionSnapshot.goldEarned;
    }

    restoreBattleWorldState(scene, scene.visionSnapshot);

    scene.selectedUnit = null;
    scene.preMoveLoc = null;
    scene._preFogSnapshot = null;
    scene.movementRange = null;
    scene.unitPositions = null;
    scene.attackTargets = [];
    scene.healTargets = [];
    scene.staffRelocateTargets = [];
    scene.staffRelocateAlly = null;
    scene.staffRelocateTiles = [];
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
    // Rewind micro-objective lifecycles with the rest of the turn: village
    // visit/raze (terrain, marker, convoy reward) and the caravan exit flag
    // (a lord-death rewind can span the enemy-phase step that exited it).
    if (scene.visionSnapshot.runBattleState && scene.runManager) {
      const domain = scene.visionSnapshot.runBattleState;
      scene.runManager.convoy = structuredClone(domain.convoy);
      scene.runManager.accessories = structuredClone(domain.accessories);
      scene.runManager.gold = domain.gold;
      scene._villageState = structuredClone(scene.visionSnapshot.villageState);
      scene._villageController?._destroyMarkers?.();
      if (scene._villageState?.status === 'intact') scene._villageController?._renderMarker?.();
    } else scene._villageController?.restoreFromVisionSnapshot?.(scene.visionSnapshot.villageState);
    if ('caravanExited' in scene.visionSnapshot) {
      scene._caravanExited = scene.visionSnapshot.caravanExited === true;
    }

    const sourceSeed = Number.isFinite(scene.visionSnapshot.rngSeed)
      ? scene.visionSnapshot.rngSeed >>> 0
      : scene.visionBaseSeed >>> 0;
    const rewindCount = this._chargeHost().visionCount || 0;
    const reseed = hashRewindSeed(sourceSeed, rewindCount);
    const resolvedSeed =
      committed || scene._battleRewindPolicy === 'fixed-v1' ? sourceSeed : reseed;
    if (scene.visionSnapshot.rngState)
      scene.reseedBattleRng(resolvedSeed, scene.visionSnapshot.rngState);
    else scene.reseedBattleRng(resolvedSeed);
    scene._battleDecisionRngState =
      scene.visionSnapshot.decisionRngState || scene.visionSnapshot.rngState || null;
    scene._pendingActionCompletion = null;
    scene._pendingLevelUpPopups = [];
    scene._timelineFacts = [];
    resetHistoryRecording(scene);
    scene._commanderKillerName = null;
    this._rewindFatalOrigin = false;
    scene._fatalDecision = null;
    scene._fatalCapturePending = false;
    scene._defeatDecision = null;
    scene._clearCombatRollSession?.();

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
    if (scene.cameras?.main)
      void scene.showBriefBanner?.(
        `Returned to player turn ${scene.turnManager.turnNumber}`,
        '#9ed8ff',
      );
    // Re-assert current music to trigger orphan scanner (no-op when clean)
    const audio = scene.registry.get('audio');
    if (audio && audio.currentMusicKey) {
      audio.playMusic(audio.currentMusicKey, scene, 0);
    }
    if (
      committed &&
      scene.playerUnits.length &&
      scene.playerUnits.every((unit) => unit.currentHP <= 0 || unit.hasActed || isSleeping(unit))
    )
      scene.turnManager.endPlayerPhase();
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
    const allowedStates = new Set(['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU']);
    return (
      scene.turnManager?.currentPhase === 'player' &&
      allowedStates.has(scene.battleState) &&
      (scene.battleState !== 'UNIT_ACTION_MENU' ||
        scene._inputController?.isSelectionMenu?.() === true) &&
      !scene._pendingActionCompletion &&
      !scene._pendingLevelUpPopups?.length &&
      !scene.pauseOverlay?.visible &&
      !scene.visionDialog &&
      ((hasDOMHost() && Boolean(scene._battleTimeline?.entries?.length)) ||
        (this.getChargesRemaining() > 0 && !!scene.visionSnapshot))
    );
  }

  // ── Rewind request + dialog ─────────────────────────────────

  requestRewind({ force = false } = {}) {
    const scene = this.scene;
    if (scene.isStoryInputLocked()) return false;
    if (!force && !this.canUseNow()) return false;
    if (hasDOMHost() && scene._battleTimeline?.entries?.length) return this.openTimeline();
    if (!scene.visionSnapshot) return false;
    const remaining = this.getChargesRemaining();
    if (remaining <= 0) return false;
    if (this.runManager && !scene.visionSnapshot.runBattleState) {
      this.showDialog({
        title: 'Earlier rewind unavailable',
        body: 'This older save does not contain enough inventory history to restore that turn safely. Your charges are unchanged. New turn-start points will be recorded as you play.',
        confirmLabel: 'Return to battle',
        cancelLabel: 'Back',
        onConfirm: () => {},
        onCancel: () => {},
      });
      return true;
    }

    const intent = this.createRewindIntent(scene.visionSnapshot);
    this.showDialog({
      title: 'Foresee a different path?',
      body: `Spend 1 rewind to return to the start of player turn ${scene.visionSnapshot.turnNumber}?\n(${remaining} left this run)`,
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel',
      onConfirm: () => this.executeRewind(intent.target, null, intent),
      onCancel: () => {},
    });
    return true;
  }

  openTimeline({ fatal = false } = {}) {
    const scene = this.scene;
    const history =
      scene._battleTimeline || hydrateBattleTimeline(this.runManager?.battleInProgress?.timeline);
    if (!hasDOMHost() || !history?.entries?.length) return false;
    this.closeDialog();
    const prevState = this._historyReturnState || scene.battleState;
    this._historyReturnState = prevState;
    if (!this._historySession && history.presentation?.records.length && scene.game?.scene)
      this._historySession = new BattleHistorySession(scene);
    const close = () => {
      this.endHistorySession();
      this.closeDialog();
      if (fatal) this.returnToFatalDecision();
    };
    scene.visionDialog = { group: [], prevState, onCancel: close };
    scene.battleState = 'PAUSED';
    const view = new BattleTimelineView(scene, {
      history,
      session: this._historySession,
      selectedId: this._historySelection,
      charges: this.getChargesRemaining(),
      difficulty: this.runManager?.difficultyId || 'normal',
      allowPlayerActions: true,
      currentEntryId: scene._timelineCurrentEntryId,
      fatal,
      onClose: close,
      onRewind: (id) => {
        if (
          id === scene._timelineCurrentEntryId ||
          !canRewindToEntry(history, id, {
            difficulty: this.runManager?.difficultyId || 'normal',
            allowPlayerActions: true,
          }) ||
          this.getChargesRemaining() <= 0
        )
          return;
        const target = getEntryState(history, id);
        const intent = this.createRewindIntent(target);
        const branch = branchBattleTimeline(history, id);
        const row = history.entries.find((entry) => entry.id === id);
        this._historySelection = view.selectedId;
        this._historySession?.rememberView({
          historyOpen: !view.list.hidden,
          scrollTop: view.list.scrollTop,
        });
        this.closeDialog();
        this.showDialog({
          title: 'Rewind to this point?',
          body: `Return to turn ${target.turnNumber}, ${row.kind === 'turn_start' ? 'start of player phase' : 'after this player action'}?${row.preview?.enemiesActNext ? ' Enemies will act next.' : ''} This spends 1 rewind charge. Later actions will be removed.`,
          confirmLabel: 'Spend 1 rewind',
          cancelLabel: 'Back',
          onConfirm: () => this.executeRewind(target, branch, intent),
          onCancel: () => this.openTimeline({ fatal }),
        });
      },
    });
    scene.visionDialog.surface = view;
    return true;
  }

  endHistorySession() {
    this._historySession?.destroy();
    this._historySession = null;
    if (this._historyReturnState) this.scene.battleState = this._historyReturnState;
    this._historyReturnState = null;
    this._historySelection = null;
  }

  returnToFatalDecision() {
    if (!this.showLordDeathPrompt()) this.scene.onDefeat();
  }

  showLordDeathPrompt() {
    const remaining = this.getChargesRemaining();
    if (remaining <= 0) return false;
    const anchor = this.scene.visionSnapshot;
    const usableAnchor = Boolean(
      anchor &&
      (!this.runManager?.battleInProgress || anchor.runBattleState) &&
      (this.scene._battleRewindPolicy !== 'fixed-v1' || validateBattleState(anchor)),
    );
    const hasUsableTimeline = () =>
      hasDOMHost() &&
      this.scene._battleTimeline?.entries?.some((entry) =>
        canRewindToEntry(this.scene._battleTimeline, entry.id, {
          difficulty: this.runManager?.difficultyId || 'normal',
          allowPlayerActions: this.scene._battleRewindPolicy === 'fixed-v1',
        }),
      );
    if (!usableAnchor && !hasUsableTimeline()) return false;
    if (this.runManager?.battleInProgress) {
      const result = persistFatalDecision(this.scene);
      if (!result.ok) {
        this.showDialog({
          title: 'Battle could not be saved',
          body: 'The battle is paused. Retry saving before choosing what happens next. Closing the app now may return to the last saved point.',
          confirmLabel: 'Retry save',
          cancelLabel: 'Retry save',
          onConfirm: () => this.returnToFatalDecision(),
          onCancel: () => this.returnToFatalDecision(),
        });
        return true;
      }
      // Storage-pressure recovery may discard optional history. Do not offer
      // a rewind button with neither a surviving destination nor a fallback.
      if (!usableAnchor && !hasUsableTimeline()) return false;
    }
    // Flavor follows Sera: generic copy when she isn't part of this run.
    const visionPool = this.runManager?.roster || this.scene.playerUnits || [];
    const seraPresent = visionPool.some((u) => u?.name === 'Sera');
    this._rewindFatalOrigin = true;
    const intent = usableAnchor ? this.createRewindIntent(anchor) : null;
    const fallen = this.scene._battleCommanderName || 'Your commander';
    const charges = `${remaining} rewind${remaining === 1 ? '' : 's'} left this run`;
    this.showDialog({
      title: seraPresent ? "Sera's vision fractures!" : 'A vision fractures!',
      body: `${fallen} has fallen. Accepting fate ends this run.\nRewind to reveal another path? (${charges})`,
      confirmLabel:
        hasDOMHost() && this.scene._battleTimeline?.entries?.length ? 'Review timeline' : 'Rewind',
      cancelLabel: 'Accept Fate',
      onConfirm: () => {
        if (!this.openTimeline({ fatal: true }) && intent)
          this.executeRewind(intent.target, null, intent);
      },
      onCancel: () => {
        this._rewindFatalOrigin = false;
        this.scene.onDefeat();
      },
      // Ending the run must be a deliberate choice: ESC, pad B/Start and the
      // header close slot never stand in for Accept Fate.
      dismissible: false,
      accent: 0xcc6666,
    });
    return true;
  }

  /**
   * @param {object} opts
   * @param {boolean} [opts.dismissible=true] false when the cancel action is
   *   consequential (e.g. accepting defeat): ESC/back/close then do nothing and
   *   the cancel choice is only reachable as its own labelled button.
   */
  showDialog({
    title,
    body,
    confirmLabel,
    cancelLabel,
    onConfirm,
    onCancel,
    dismissible = true,
    accent = 0x66aacc,
  }) {
    const scene = this.scene;
    if (scene.visionDialog) this.closeDialog();
    const prevState = scene.battleState;
    scene.battleState = 'PAUSED';
    if (hasDOMHost()) {
      scene.visionDialog = { group: [], prevState, onConfirm, onCancel, dismissible };
      const surface = new MenuSurface(scene, title, () => this.dismissDialog(), { modal: true });
      scene.visionDialog.surface = surface;
      const headerButton = surface.header.querySelector('button');
      const confirm = button(confirmLabel, () => this.confirmDialog(), 're-btn re-btn--primary');
      surface.body.append(element('p', body), confirm);
      if (dismissible) {
        headerButton.textContent = cancelLabel;
      } else {
        headerButton.remove();
        surface.body.append(button(cancelLabel, () => this.cancelDialog(), 're-btn'));
      }
      surface.focusContent();
      return;
    }
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
    const titleText = presentationText(scene, cx, cy - 54, title, {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffdd88',
      fontStyle: 'bold',
    })
      .setOrigin(0.5)
      .setDepth(902);
    group.push(titleText);
    const bodyText = presentationText(scene, cx, cy - 14, body, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#d0d7e8',
      align: 'center',
    })
      .setOrigin(0.5)
      .setDepth(902);
    group.push(bodyText);
    const makeButton = (x, y, label, color, callback) => {
      const btn = presentationText(scene, x, y, label, {
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
      dismissible,
    };
  }

  confirmDialog() {
    if (!this.scene.visionDialog) return;
    const onConfirm = this.scene.visionDialog.onConfirm;
    this.closeDialog();
    onConfirm?.();
  }

  /**
   * Generic back/ESC/close request. Runs the cancel action only for
   * dismissible dialogs; a non-dismissible one stays open (and keeps focus)
   * until one of its buttons is chosen explicitly.
   * @returns {boolean} true when a dialog was open (the request is consumed)
   */
  dismissDialog() {
    const dialog = this.scene.visionDialog;
    if (!dialog) return false;
    if (dialog.dismissible === false) {
      dialog.surface?.focusContent?.();
      return true;
    }
    this.cancelDialog();
    return true;
  }

  cancelDialog() {
    if (!this.scene.visionDialog) return;
    const onCancel = this.scene.visionDialog.onCancel;
    this.closeDialog();
    onCancel?.();
  }

  closeDialog() {
    if (!this.scene.visionDialog) return;
    this.scene.visionDialog.surface?.destroy();
    const prevState = this.scene.visionDialog.prevState || 'PLAYER_IDLE';
    for (const obj of this.scene.visionDialog.group) obj.destroy();
    this.scene.visionDialog = null;
    this.scene.battleState =
      this._historySession && !this._historySession.destroyed ? 'PAUSED' : prevState;
    this.scene.refreshEndTurnControl();
  }

  // ── Execute rewind ──────────────────────────────────────────

  createRewindIntent(target) {
    return {
      target: structuredClone(target),
      expectedBattle: this.runManager?.battleInProgress?.startedAt,
      expectedRevision: this.runManager?.battleInProgress?.rewindRevision || 0,
    };
  }

  executeRewind(
    target = this.scene.visionSnapshot,
    history = null,
    intent = this.createRewindIntent(target),
  ) {
    const scene = this.scene;
    if (this.runManager && !this.runManager.battleInProgress) return false;
    if (!target || this._rewindCommitting) return false;
    const host = this._chargeHost();
    if (host.visionChargesRemaining <= 0) {
      this.endHistorySession();
      return false;
    }
    // Tutorial has no run record. It retains its existing in-memory teaching
    // rewind; every persisted game uses the same transaction below.
    if (!this.runManager) {
      host.visionChargesRemaining--;
      host.visionCount = Math.max(0, (host.visionCount || 0) + 1);
      scene.pendingVisionSnapshot = null;
      return scene.applyVisionSnapshot();
    }
    this._rewindCommitting = true;
    try {
      const state = this._prepareTarget(target);
      const prepared = prepareBattleRewind(this.runManager.toJSON(), state, {
        history,
        expectedBattle: intent.expectedBattle,
        expectedRevision: intent.expectedRevision,
      });
      const result = persistBattleRewind(prepared, (candidate) =>
        scene._persistBattleRunState(candidate),
      );
      if (!result.ok) {
        if (
          ['stale_battle', 'stale_branch', 'battle_closed', 'no_charges'].includes(result.reason)
        ) {
          this.endHistorySession();
          return false;
        }
        this.lastRewindError = result.reason;
        this.showDialog({
          title: 'Rewind was not saved',
          body: 'The battle and your rewind charge are unchanged. Try again or return to the battle.',
          confirmLabel: 'Retry',
          cancelLabel: 'Cancel',
          onConfirm: () => this.executeRewind(target, history, intent),
          onCancel: () => {
            this.endHistorySession();
            if (this._rewindFatalOrigin) this.returnToFatalDecision();
          },
        });
        return false;
      }
      const candidate = result.candidate;
      // Durability is established. Release the presentation scene without
      // restoring old UI/gameplay state; reconstruction owns the host now.
      this._historyReturnState = null;
      this._historySelection = null;
      host.visionChargesRemaining = candidate.visionChargesRemaining;
      host.visionCount = candidate.visionCount;
      this.runManager.battleInProgress = candidate.battleInProgress;
      scene.visionSnapshot = state;
      scene.pendingVisionSnapshot = null;
      scene._battleTimeline = candidate.battleInProgress.timeline;
      scene._timelineCurrentEntryId = candidate.battleInProgress.timelineCurrentEntryId;
      this.lastRewindError = null;
      // Reconstruction is after durability. Never refund/retry the debit if
      // rendering fails; reload adopts the already-committed checkpoint.
      try {
        this._historySession?.destroy();
        this._historySession = null;
        return this._applySnapshot({ committed: true });
      } catch (error) {
        scene.battleState = 'PAUSED';
        this.showDialog({
          title: 'Rewind saved',
          body: 'Reload to finish restoring this battle. Your charge has already been spent.',
          confirmLabel: 'Reload',
          cancelLabel: 'Reload',
          onConfirm: () => globalThis.location?.reload(),
          onCancel: () => globalThis.location?.reload(),
        });
        console.error('[Rewind] saved checkpoint needs reload:', error);
        return false;
      }
    } finally {
      this._rewindCommitting = false;
    }
  }

  _prepareTarget(anchor) {
    const scene = this.scene;
    const policy = this.runManager.battleInProgress?.rewindPolicy || 'legacy-v1';
    if (!anchor?.runBattleState) return null;
    if (policy === 'fixed-v1') return structuredClone(anchor);
    // Old anchors lack the canonical envelope. Upgrade a detached copy once;
    // preserve their original reroll policy throughout this battle.
    const state = {
      ...captureBattleState(scene),
      ...structuredClone(anchor),
      rewindPolicy: 'legacy-v1',
    };
    delete state.visionSnapshot;
    delete state.pendingVisionSnapshot;
    state.pendingActionCompletion = null;
    state.rngSeed = hashRewindSeed(
      anchor.rngSeed ?? scene.visionBaseSeed,
      (this.runManager.visionCount || 0) + 1,
    );
    state.rngState = null;
    state.decisionRngState = null;
    const detached = {};
    resetBattleIdentities(
      detached,
      state.nextEntityId,
      BATTLE_UNIT_GROUPS.flatMap((key) => state[key] || []),
    );
    for (const key of BATTLE_UNIT_GROUPS)
      state[key] = (state[key] || []).map((unit) => {
        restoreEquippedReference(unit);
        relinkWeapon(unit);
        registerBattleEntity(detached, unit);
        return serializeBattleUnit(unit);
      });
    state.nextEntityId = detached._nextBattleEntityId;
    if (
      !anchor.runBattleState &&
      scene._villageState?.rewardItemUid &&
      anchor.villageState?.status === 'intact'
    ) {
      const uid = scene._villageState.rewardItemUid;
      for (const bucket of ['weapons', 'consumables'])
        state.runBattleState.convoy[bucket] = state.runBattleState.convoy[bucket].filter(
          (item) => item.uid !== uid,
        );
    }
    return state;
  }

  // ── HUD ─────────────────────────────────────────────────────

  updateHud() {
    if (!this.scene.visionHudText) return;
    const charges = this.getChargesRemaining();
    this.scene.visionHudText.setText(`Eye: ${charges} left this run`);
    this.scene.visionHudText.setColor(charges > 0 ? '#9ed8ff' : '#777777');
    this.scene.updateTopLeftHudLayout();
  }
}
