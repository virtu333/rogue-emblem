// One definition of the resolved-action continuation (compression plan step 1).
// The snapshot validator and the resume path used to validate this shape
// separately and disagreed on a unitName longer than 8192 characters: resume
// accepted it while the validator rejected the whole state.
import { describe, it, expect } from 'vitest';
import { readActionContinuation, SAVED_TEXT_MAX } from '../src/engine/ActionContinuation.js';
import { readActionContinuation as readFromUi } from '../src/ui/BattlePresentationCheckpoint.js';
import { validateBattleState } from '../src/engine/BattleStateSnapshot.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
import {
  isBattleEntityId,
  registerBattleEntity,
  resetBattleIdentities,
} from '../src/engine/BattleEntityIdentity.js';
import { createUnit } from '../src/engine/UnitManager.js';
import classes from '../data/classes.json';
import weapons from '../data/weapons.json';

function state() {
  const scene = {
    playerUnits: [],
    enemyUnits: [],
    npcUnits: [],
    escapedUnits: [],
    nonDeployedUnits: [],
    battleState: 'PLAYER_IDLE',
    turnManager: { currentPhase: 'player', turnNumber: 3 },
    grid: { mapLayout: Array.from({ length: 8 }, () => Array(8).fill(0)), temporaryTerrains: [] },
    runManager: { convoy: { weapons: [], consumables: [] }, accessories: [], gold: 0 },
    addUnitGraphic() {},
    dimUnit() {},
  };
  resetBattleIdentities(scene);
  const unit = createUnit(
    classes.find((c) => c.name === 'Fighter'),
    5,
    weapons,
    { name: 'Bram' },
  );
  Object.assign(unit, { col: 1, row: 1 });
  registerBattleEntity(scene, unit);
  scene.playerUnits.push(unit);
  return captureBattleState(scene, { rngSeed: 7 });
}

const long = 'x'.repeat(SAVED_TEXT_MAX + 1);
// [label, saved value, normalized result or null]
const CASES = [
  ['combat', { kind: 'combat', unitName: 'Bram' }, { kind: 'combat', unitName: 'Bram' }],
  [
    'finish with every field',
    { kind: 'finish', unitName: 'Bram', unitId: 'u12', skipCanto: true, gambitTriggered: false },
    { kind: 'finish', unitName: 'Bram', unitId: 'u12', skipCanto: true, gambitTriggered: false },
  ],
  [
    'extra fields are dropped',
    { kind: 'combat', unitName: 'Bram', extra: 1 },
    { kind: 'combat', unitName: 'Bram' },
  ],
  [
    'name at the cap',
    { kind: 'combat', unitName: 'y'.repeat(SAVED_TEXT_MAX) },
    { kind: 'combat', unitName: 'y'.repeat(SAVED_TEXT_MAX) },
  ],
  ['name over the cap', { kind: 'combat', unitName: long }, null],
  ['unknown kind', { kind: 'replay', unitName: 'Bram' }, null],
  ['blank name', { kind: 'combat', unitName: '   ' }, null],
  ['missing name', { kind: 'combat' }, null],
  ['numeric id', { kind: 'combat', unitName: 'Bram', unitId: 1 }, null],
  ['u0 id', { kind: 'combat', unitName: 'Bram', unitId: 'u0' }, null],
  ['string flag', { kind: 'finish', unitName: 'Bram', skipCanto: 'false' }, null],
  ['string gambit', { kind: 'combat', unitName: 'Bram', gambitTriggered: 1 }, null],
  ['array', [{ kind: 'combat', unitName: 'Bram' }], null],
  ['false', false, null],
];

describe('readActionContinuation', () => {
  it.each(CASES)('%s', (_, value, expected) => {
    expect(readActionContinuation(value)).toEqual(expected);
  });

  it('is the same function on the resume path', () => {
    expect(readFromUi).toBe(readActionContinuation);
  });

  it.each(CASES)(
    'the snapshot validator accepts exactly what resume reads: %s',
    (_, value, expected) => {
      const saved = { ...state(), pendingActionCompletion: value };
      expect(validateBattleState(saved)).toBe(expected !== null);
    },
  );

  it('a state without a continuation stays valid', () => {
    expect(validateBattleState(state())).toBe(true);
    expect(validateBattleState({ ...state(), pendingActionCompletion: null })).toBe(true);
  });
});

describe('isBattleEntityId', () => {
  it.each([
    ['u1', true],
    ['u42', true],
    ['u0', false],
    ['u01', false],
    ['U1', false],
    ['u1 ', false],
    [1, false],
    [null, false],
    [['u1'], false], // an array used to pass the bare regex by string coercion
  ])('%j -> %s', (value, expected) => {
    expect(isBattleEntityId(value)).toBe(expected);
  });
});
