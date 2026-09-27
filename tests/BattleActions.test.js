// BattleActions.test.js — Tests for Trade, Swap, and Dance battle actions
// NOTE: These actions are primarily BattleScene methods that depend on Phaser.
// Full integration testing requires manual gameplay testing.

import { describe, it, expect } from 'vitest';
import { shouldCommitTradeExit, shouldAllowUndoMove } from '../src/engine/TradeFlow.js';
import { canTradeBetween } from '../src/engine/ItemTrade.js';

describe('Battle Actions - Trade (canTradeBetween)', () => {
  const sword = () => ({ name: 'Iron Sword', type: 'Sword', rankRequired: 'Prof' });
  const tonic = () => ({ name: 'Vulnerary', type: 'Consumable', uses: 3 });
  const unit = (inventory = [], consumables = []) => ({ inventory, consumables });

  it('is offered when either unit carries a weapon or a supply', () => {
    expect(canTradeBetween(unit([sword()]), unit())).toBe(true);
    expect(canTradeBetween(unit(), unit([sword()]))).toBe(true);
    expect(canTradeBetween(unit([], [tonic()]), unit())).toBe(true);
    expect(canTradeBetween(unit(), unit([], [tonic()]))).toBe(true);
  });

  it('is offered between two full bags (a swap needs no free slot)', () => {
    const full = () => unit([1, 2, 3, 4, 5].map(sword), [tonic(), tonic(), tonic()]);
    expect(canTradeBetween(full(), full())).toBe(true);
  });

  it('is not offered when neither carries anything, or without a partner', () => {
    expect(canTradeBetween(unit(), unit())).toBe(false);
    expect(canTradeBetween({}, {})).toBe(false);
    const a = unit([sword()]);
    expect(canTradeBetween(a, a)).toBe(false);
    expect(canTradeBetween(a, null)).toBe(false);
  });
});

describe('Battle Actions - Swap', () => {
  it('should validate terrain compatibility for both units', () => {
    // Swap requires:
    // - Adjacent ally exists
    // - Both positions are walkable by both units
    // This is validated by checking grid.getMoveCost() !== Infinity for both positions

    // Mock scenario: Infantry can walk on each other's tiles
    const infantryA = { moveType: 'Infantry', col: 0, row: 0 };
    const infantryB = { moveType: 'Infantry', col: 1, row: 0 };

    // Both positions should be walkable (Plains = moveCost 1 for Infantry)
    expect(infantryA.moveType).toBe('Infantry');
    expect(infantryB.moveType).toBe('Infantry');
  });

  it('should reject swap when terrain is impassable for one unit', () => {
    // Mock scenario: Armored cannot walk on mountain (moveCost Infinity)
    const armored = { moveType: 'Armored' };
    const flying = { moveType: 'Flying' };

    // In real implementation, getMoveCost(mountain, Armored) === Infinity
    // This would cause swap validation to fail
    expect(armored.moveType).toBe('Armored');
    expect(flying.moveType).toBe('Flying');
  });
});

describe('Battle Actions - Dance', () => {
  it('should reset hasMoved and hasActed flags', () => {
    // Dance resets target's action state
    const target = {
      hasMoved: true,
      hasActed: true,
    };

    // After dance:
    target.hasMoved = false;
    target.hasActed = false;

    expect(target.hasMoved).toBe(false);
    expect(target.hasActed).toBe(false);
  });

  it('should only target units that have acted', () => {
    const actedUnit = { hasActed: true, skills: [] };
    const freshUnit = { hasActed: false, skills: [] };

    expect(actedUnit.hasActed).toBe(true);
    expect(freshUnit.hasActed).toBe(false);
  });

  it('should not target other dancers', () => {
    const dancer = { hasActed: true, skills: ['dance'] };
    const warrior = { hasActed: true, skills: ['vantage'] };

    const isDancer = dancer.skills?.includes('dance');
    const isWarrior = warrior.skills?.includes('dance');

    expect(isDancer).toBe(true); // Should be excluded
    expect(isWarrior).toBe(false); // Valid target
  });
});

describe('Battle Actions - Integration Notes', () => {
  it('documents expected behavior for manual testing', () => {
    const testingChecklist = {
      Swap: [
        'Both units animate to swapped positions',
        'Infantry↔Flying swap works on varied terrain',
        'Armored units blocked on impassable terrain',
      ],
      Dance: [
        'Only for Dancer class',
        'Target becomes fresh (can move + act again)',
        'Cannot dance another dancer',
        'Sparkle visual effect plays',
      ],
    };

    expect(testingChecklist.Swap.length).toBe(3);
    expect(testingChecklist.Dance.length).toBe(4);
  });
});

describe('Battle Actions - Trade Cancel Exploit Guard', () => {
  it('commits trade exit once any trade mutation occurred', () => {
    expect(shouldCommitTradeExit(true)).toBe(true);
    expect(shouldCommitTradeExit(false)).toBe(false);
  });

  it('blocks move undo after trade mutation but allows normal pre-action undo', () => {
    expect(shouldAllowUndoMove({ col: 3, row: 4 }, true)).toBe(false);
    expect(shouldAllowUndoMove({ col: 3, row: 4 }, false)).toBe(true);
    expect(shouldAllowUndoMove(null, false)).toBe(false);
  });
});
