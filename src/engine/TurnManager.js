// TurnManager — Player/enemy phase state machine (no Phaser dependencies)

export class TurnManager {
  constructor({ onPhaseChange, onVictory, onDefeat }) {
    this.onPhaseChange = onPhaseChange;
    this.onVictory = onVictory;
    this.onDefeat = onDefeat;

    this.playerUnits = [];
    this.enemyUnits = [];
    this.currentPhase = 'player';
    this.turnNumber = 1;
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
    this.onPhaseChange('player', this.turnNumber);
  }

  /** Called when a player unit finishes its action. Checks if phase should end. */
  unitActed(unit) {
    unit.hasActed = true;

    // Check if all player units have acted
    const allActed = this.playerUnits.every(u => u.hasActed);
    if (allActed) {
      this.endPlayerPhase();
    }
  }

  endPlayerPhase() {
    if (this._checkBattleEnd()) return;

    this.currentPhase = 'enemy';
    this.onPhaseChange('enemy', this.turnNumber);
  }

  /** Called by BattleScene after AI finishes all enemy actions. */
  endEnemyPhase() {
    if (this._checkBattleEnd()) return;

    // Reset enemy units
    for (const u of this.enemyUnits) {
      u.hasMoved = false;
      u.hasActed = false;
    }

    this.turnNumber++;
    this.currentPhase = 'player';
    this.onPhaseChange('player', this.turnNumber);
  }

  // Unit removal is handled by BattleScene via in-place splice.
  // TurnManager shares the same array references, so no separate removal needed.
  // Battle end is checked at phase transitions.

  getAvailableUnits(faction) {
    const units = faction === 'player' ? this.playerUnits : this.enemyUnits;
    return units.filter(u => !u.hasActed);
  }

  _checkBattleEnd() {
    if (this.playerUnits.length === 0) {
      this.onDefeat();
      return true;
    }
    // Rout: all enemies dead = victory
    if (this.objective === 'rout' && this.enemyUnits.length === 0) {
      this.onVictory();
      return true;
    }
    // Seize victory is handled via BattleScene action menu, not here
    return false;
  }
}
