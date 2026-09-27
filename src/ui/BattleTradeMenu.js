import { TradeMenu } from './TradeMenu.js';
import { planTrade, bagItems, bagCapacity, unitHolder } from '../engine/ItemTrade.js';
import {
  BATTLE_TRADE_BAGS,
  BATTLE_TRADE_CTX,
  TRADE_UNAVAILABLE,
  battleTradeController,
} from './BattleTradeController.js';

const ENGINE = Object.freeze({ planTrade, bagItems, bagCapacity, unitHolder });

// Battle trading: the shared TradeMenu (Weapons and Supplies, give or swap)
// over the battle context. Every write goes through BattleTradeController,
// which owns the guards, movement commitment, history and checkpoint.
export class BattleTradeMenu {
  constructor(scene, left, right, controller = battleTradeController(scene)) {
    Object.assign(this, { scene, left, right, controller });
    this.menu = new TradeMenu({
      scene,
      ctx: BATTLE_TRADE_CTX,
      left,
      right,
      bags: BATTLE_TRADE_BAGS,
      engine: ENGINE,
      commit: (from, to) => this.commit(from, to),
      onClose: () => this.close(),
    });
  }

  commit(from, to) {
    if (this.closed) return { ok: false, reason: TRADE_UNAVAILABLE };
    return this.controller.commit(this.left, this.right, from, to);
  }

  /** Done / cancel with nothing held: back to the acting unit's commands. */
  close() {
    if (this.closed) return;
    const scene = this.scene;
    const mutated = scene.tradeMutatedThisSession;
    scene.cleanupTradeUI();
    scene.showActionMenu(this.left);
    scene.tradeMutatedThisSession = mutated;
  }

  /** Teardown only (rewind, suspend, shutdown): never returns to the menu. */
  destroy() {
    this.closed = true;
    this.menu.destroy();
  }
}
