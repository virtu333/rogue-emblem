// BattleTradeController -- the one write path for trading in battle
// (docs/specs/item-trade.md, "Battle"). The DOM menu (BattleTradeMenu over
// TradeMenu) and the headless canvas fallback both commit through here, so the
// guards, the movement commitment, the history beat and the checkpoint are the
// same whichever surface the player used.
//
// Trading is a free, pre-action command: it never touches `hasActed`, and it
// never touches the partner's `hasActed`, `hasMoved` or `_movementCommitted`.

import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { applyTrade } from '../engine/ItemTrade.js';

/** The trade context in battle: player units only, no convoy, no accessories. */
export const BATTLE_TRADE_CTX = Object.freeze({ context: 'battle' });

/** The bags a battle trade offers (Weapons and Supplies tabs). */
export const BATTLE_TRADE_BAGS = Object.freeze(['inventory', 'consumables']);

/** Shown when the trade session no longer allows a commit (state moved on). */
export const TRADE_UNAVAILABLE = 'Trading is no longer available.';

function isAdjacent(a, b) {
  const dc = Number(a?.col) - Number(b?.col);
  const dr = Number(a?.row) - Number(b?.row);
  return Number.isFinite(dc) && Number.isFinite(dr) && Math.abs(dc) + Math.abs(dr) === 1;
}

function slotUnit(slot) {
  return slot?.holder?.kind === 'unit' ? slot.holder.unit || null : null;
}

export class BattleTradeController {
  constructor(scene) {
    this.scene = scene;
    this.destroyed = false;
  }

  /** No visuals of its own: the menu belongs to the scene (cleanupTradeUI). */
  create() {
    this.destroyed = false;
    return this;
  }

  destroy() {
    this.destroyed = true;
  }

  /**
   * True when `left` (the selected, acting unit) may still trade with `right`
   * using these two slots: the scene is in its trade session on the player
   * phase, left has not acted, both are fielded player units standing next to
   * each other, and the slots belong to exactly those two units.
   */
  canCommit(left, right, from, to) {
    const scene = this.scene;
    if (this.destroyed || !scene || !left || !right || left === right) return false;
    if (scene.battleState !== 'TRADING') return false;
    if (scene.turnManager?.currentPhase !== 'player') return false;
    if (scene.selectedUnit !== left || left.hasActed) return false;
    const fielded = Array.isArray(scene.playerUnits) ? scene.playerUnits : [];
    if (!fielded.includes(left) || !fielded.includes(right)) return false;
    if (!isAdjacent(left, right)) return false;
    const a = slotUnit(from);
    const b = slotUnit(to);
    return (a === left && b === right) || (a === right && b === left);
  }

  /**
   * Give or swap one item between `left` and `right`.
   * @returns the ItemTrade result ({ ok: true, kind, warnings, detail } |
   *   { ok: false, reason }). Nothing is committed unless it is ok.
   */
  commit(left, right, from, to) {
    if (!this.canCommit(left, right, from, to)) return { ok: false, reason: TRADE_UNAVAILABLE };
    const scene = this.scene;
    const result = applyTrade(BATTLE_TRADE_CTX, from, to);
    if (!result.ok) return result;
    // The first change of a trade session locks in the acting unit's move.
    if (!scene.tradeMutatedThisSession) {
      scene.tradeMutatedThisSession = true;
      left._movementCommitted = true;
      scene.preMoveLoc = null;
      scene.commitVisionSnapshotIfPending();
    }
    observeHistoryAction(scene, 'traded with', left, right, result.detail);
    scene._captureSuspendCheckpoint?.();
    return result;
  }
}

/** The scene's controller, created on first use (fake scenes in tests included). */
export function battleTradeController(scene) {
  if (!scene._tradeController || scene._tradeController.destroyed)
    scene._tradeController = new BattleTradeController(scene).create();
  return scene._tradeController;
}
