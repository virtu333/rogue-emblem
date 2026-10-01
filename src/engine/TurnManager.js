// TurnManager — Player/enemy phase state machine (no Phaser dependencies)

export class TurnManager {
  constructor({ onPhaseChange, onVictory, onDefeat, checkBattleEnd, onRejectedTransition }) {
    this.onPhaseChange = onPhaseChange;
    this.onVictory = onVictory;
    this.onDefeat = onDefeat;
    this._externalCheckBattleEnd = checkBattleEnd || null;
    this._onRejectedTransition = onRejectedTransition || null;

    this.playerUnits = [];
    this.enemyUnits = [];
    this.currentPhase = 'player';
    this.turnNumber = 1;
    this._battleEnded = false;
  }

  init(playerUnits, enemyUnits, npcUnits, objective = 'rout') {
    this.playerUnits = playerUnits;
    this.enemyUnits = enemyUnits;
    this.npcUnits = npcUnits || [];
    this.objective = objective;
  }

  startBattle() {
    this.turnNumber = 1;
    this.currentPhase = 'player';
    this._battleEnded = false;
    this.onPhaseChange('player', this.turnNumber);
  }

  /** Called when a player unit finishes its action. Checks if phase should end. */
  unitActed(unit) {
    if (
      this._battleEnded ||
      this.currentPhase !== 'player' ||
      !unit ||
      !this.playerUnits.includes(unit)
    )
      return this._rejectTransition('unitActed');
    unit.hasActed = true;
    this.checkPlayerPhaseComplete();
    return true;
  }

  /** Escape/death can remove an actor before completion; only check those still on the field. */
  checkPlayerPhaseComplete() {
    if (this._battleEnded || this.currentPhase !== 'player')
      return this._rejectTransition('checkPlayerPhaseComplete');
    if (
      !this.playerUnits
        .filter((unit) => unit != null && !(unit.currentHP <= 0))
        .every((unit) => unit.hasActed)
    )
      return false;
    return this.endPlayerPhase();
  }

  endPlayerPhase() {
    if (this._battleEnded || this.currentPhase !== 'player')
      return this._rejectTransition('endPlayerPhase');
    if (this._checkBattleEnd()) return false;

    this.currentPhase = 'enemy';
    this.onPhaseChange('enemy', this.turnNumber);
    return true;
  }

  /** Called by BattleScene after AI finishes all enemy actions. */
  endEnemyPhase() {
    if (this._battleEnded || this.currentPhase !== 'enemy')
      return this._rejectTransition('endEnemyPhase');
    if (this._checkBattleEnd()) return false;

    // Reset enemy units
    for (const u of this.enemyUnits) {
      u.hasMoved = false;
      u.hasActed = false;
    }

    this.turnNumber++;
    this.currentPhase = 'player';
    this.onPhaseChange('player', this.turnNumber);
    return true;
  }

  _rejectTransition(action) {
    this._onRejectedTransition?.({ action, phase: this.currentPhase, turn: this.turnNumber });
    return false;
  }

  // Unit removal is handled by BattleScene via in-place splice.
  // TurnManager shares the same array references, so no separate removal needed.
  // Battle end is checked at phase transitions.

  getAvailableUnits(faction) {
    const units = faction === 'player' ? this.playerUnits : this.enemyUnits;
    return units.filter((u) => !u.hasActed);
  }

  _checkBattleEnd() {
    if (this._externalCheckBattleEnd) {
      // Scene checks also return true while a reversible Vision decision is open.
      // Only the standalone fallback below owns an irreversible end latch.
      return Boolean(this._externalCheckBattleEnd());
    }
    // Fallback for standalone/test usage
    if (this.playerUnits.length === 0) {
      this._battleEnded = true;
      this.onDefeat();
      return true;
    }
    // Rout: all enemies dead = victory
    if (this.objective === 'rout' && this.enemyUnits.length === 0) {
      this._battleEnded = true;
      this.onVictory();
      return true;
    }
    // Seize victory is handled via BattleScene action menu, not here
    return false;
  }
}
