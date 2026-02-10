// Invariants — Post-step invariant checks + phase watchdogs.

import { HEADLESS_STATES, CANTO_DISABLED } from './HeadlessBattle.js';

const VALID_STATES = new Set(Object.values(HEADLESS_STATES));

/**
 * Check invariants after every step.
 * Returns array of error strings (empty = all pass).
 */
export function checkInvariants(driver, context = {}) {
  const errors = [];
  const b = driver.battle;

  // 1. HP bounds: every unit currentHP in (0, stats.HP]
  for (const u of [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits]) {
    if (u.currentHP <= 0) {
      errors.push(`hp_bounds: ${u.name} has HP=${u.currentHP} (should be dead/removed)`);
    }
    if (u.currentHP > u.stats.HP) {
      errors.push(`hp_bounds: ${u.name} has HP=${u.currentHP} > maxHP=${u.stats.HP}`);
    }
  }

  // 2. No orphan dead — handled by #1 (dead units with HP<=0 still in arrays)

  // 3. Position uniqueness
  const positions = new Map();
  for (const u of [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits]) {
    const key = `${u.col},${u.row}`;
    if (positions.has(key)) {
      errors.push(`position_unique: ${u.name} and ${positions.get(key)} at (${u.col},${u.row})`);
    }
    positions.set(key, u.name);
  }

  // 4. Weapon consistency
  for (const u of [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits]) {
    if (u.weapon && u.inventory && !u.inventory.includes(u.weapon)) {
      errors.push(`weapon_consistency: ${u.name}'s equipped weapon "${u.weapon.name}" not in inventory`);
    }
  }

  // 5. State machine legality
  if (!VALID_STATES.has(b.battleState)) {
    errors.push(`state_legality: invalid state "${b.battleState}"`);
  }

  // 6. Turn monotonicity
  const currentTurn = b.turnManager?.turnNumber || 0;
  if (context.lastTurn !== undefined && currentTurn < context.lastTurn) {
    errors.push(`turn_monotonic: turn went from ${context.lastTurn} to ${currentTurn}`);
  }
  context.lastTurn = currentTurn;

  // 7. Edric alive (unless battle ended)
  if (b.battleState !== HEADLESS_STATES.BATTLE_END) {
    const edricAlive = b.playerUnits.some(u => u.name === 'Edric');
    if (!edricAlive) {
      errors.push(`edric_alive: Edric not in playerUnits but battle hasn't ended`);
    }
  }

  // 8. Canto disabled flag
  if (!CANTO_DISABLED) {
    errors.push(`canto_disabled: CANTO_DISABLED flag is false (should be true in MVP)`);
  }

  // 9. Phase watchdogs
  if (context.enemyPhaseActions !== undefined) {
    const maxExpected = b.enemyUnits.length * 3;
    if (context.enemyPhaseActions > maxExpected) {
      errors.push(`enemy_phase_bound: ${context.enemyPhaseActions} actions > expected max ${maxExpected}`);
    }
  }

  // 10. Repeated selection detection
  if (context.selectionCounts) {
    for (const [name, count] of Object.entries(context.selectionCounts)) {
      if (count >= 5 && !context.anyUnitActed) {
        errors.push(`repeated_selection: ${name} selected ${count} times without any unit acting`);
      }
    }
  }

  // 11. Global stuck detection
  if (context.sameHashCount !== undefined && context.sameHashCount >= 30) {
    errors.push(`global_stuck: same state hash for ${context.sameHashCount} consecutive steps`);
  }

  return errors;
}

/**
 * Create a fresh invariant context for tracking phase watchdogs.
 */
export function createInvariantContext() {
  return {
    lastTurn: undefined,
    lastHash: null,
    sameHashCount: 0,
    selectionCounts: {},
    anyUnitActed: false,
    enemyPhaseActions: 0,
  };
}

/**
 * Update context tracking based on the action taken.
 */
export function updateContext(context, action, driver) {
  const hash = driver.stateHash();

  // Track same-hash repetition
  if (hash === context.lastHash) {
    context.sameHashCount++;
  } else {
    context.sameHashCount = 0;
  }
  context.lastHash = hash;

  // Track unit selections
  if (action.type === 'select_unit') {
    const name = action.payload.unitName;
    context.selectionCounts[name] = (context.selectionCounts[name] || 0) + 1;
  }

  // Reset selection tracking when a unit acts
  if (action.type === 'choose_action' || action.type === 'choose_target' || action.type === 'end_turn') {
    context.anyUnitActed = true;
    context.selectionCounts = {};
  }
}
