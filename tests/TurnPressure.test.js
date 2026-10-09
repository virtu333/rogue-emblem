// The battle's anti-turtle clock (engine/TurnPressure.js), shared by BattleScene and the
// headless harness. Pins what BattleScene.updateAntiTurtlePressure did before it moved.
import { describe, it, expect } from 'vitest';
import {
  advanceTurnPressure,
  bestLordEscapeDistance,
  bestLordThroneDistance,
  createTurnPressureState,
  measureTurnPressure,
} from '../src/engine/TurnPressure.js';
import { ANTI_TURTLE_NO_PROGRESS_TURNS } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const turnBonus = loadGameData().turnBonus;
const lord = (col, row) => ({ isLord: true, currentHP: 10, col, row });
const foe = (extra = {}) => ({ currentHP: 10, col: 9, row: 9, ...extra });

function measure({
  enemies = 3,
  throne = Infinity,
  escape = Infinity,
  escaped = 0,
  boss = false,
} = {}) {
  return {
    enemyCount: enemies,
    lordThroneDistance: throne,
    lordEscapeDistance: escape,
    escapedCount: escaped,
    hasLivingBoss: boss,
  };
}
const clock = (turn, par = 10) => ({ turn, par, turnBonusConfig: turnBonus });

describe('TurnPressure', () => {
  it('turns aggressive after the configured number of phases without progress, not before', () => {
    let state = createTurnPressureState(measure());
    for (let turn = 1; turn < ANTI_TURTLE_NO_PROGRESS_TURNS; turn++) {
      const step = advanceTurnPressure(state, measure(), clock(turn));
      expect(step.aggressiveMode).toBe(false);
      state = step.state;
    }
    const step = advanceTurnPressure(state, measure(), clock(ANTI_TURTLE_NO_PROGRESS_TURNS));
    expect(step.aggressiveMode).toBe(true);
    expect(step.state.noProgressTurns).toBe(ANTI_TURTLE_NO_PROGRESS_TURNS);
  });

  it('a kill, a lord step toward the throne or exit, and an escape each reset the count', () => {
    const stalled = {
      ...createTurnPressureState(measure({ throne: 6, escape: 6 })),
      noProgressTurns: 2,
    };
    for (const now of [
      measure({ enemies: 2, throne: 6, escape: 6 }),
      measure({ throne: 5, escape: 6 }),
      measure({ throne: 6, escape: 5 }),
      measure({ throne: 6, escape: 6, escaped: 1 }),
    ]) {
      const step = advanceTurnPressure(stalled, now, clock(5));
      expect(step.state.noProgressTurns).toBe(0);
      expect(step.aggressiveMode).toBe(false);
    }
  });

  it('remembers the best mark: walking away and back is not progress', () => {
    let state = createTurnPressureState(measure({ throne: 4 }));
    state = advanceTurnPressure(state, measure({ throne: 6 }), clock(1)).state;
    const back = advanceTurnPressure(state, measure({ throne: 4 }), clock(2));
    expect(back.state.noProgressTurns).toBe(2);
  });

  it('a reinforcement wave raising the count does not lower the best mark', () => {
    let state = createTurnPressureState(measure({ enemies: 3 }));
    state = advanceTurnPressure(state, measure({ enemies: 2 }), clock(1)).state;
    state = advanceTurnPressure(state, measure({ enemies: 5 }), clock(2)).state;
    expect(state.bestEnemyCount).toBe(2);
    const kill = advanceTurnPressure(state, measure({ enemies: 4 }), clock(3));
    expect(kill.state.noProgressTurns).toBe(2); // 4 is not below the best of 2
  });

  it('boss enrage turns the AI aggressive at max(par+1, min(12, par+2)) only while a boss lives', () => {
    // par 7 → enrage turn 9 (turnBonus.json: bossEnrageTurn 12, bossEnrageOverPar 2).
    const fresh = createTurnPressureState(measure({ boss: true }));
    const before = advanceTurnPressure(fresh, measure({ enemies: 2, boss: true }), clock(8, 7));
    expect(before.turnEnrageActive).toBe(false);
    const at = advanceTurnPressure(before.state, measure({ enemies: 1, boss: true }), clock(9, 7));
    expect(at.turnEnrageActive).toBe(true);
    expect(at.becameEnraged).toBe(true);
    expect(at.aggressiveMode).toBe(true);
    const again = advanceTurnPressure(at.state, measure({ enemies: 0, boss: true }), clock(10, 7));
    expect(again.becameEnraged).toBe(false);
    const noBoss = advanceTurnPressure(fresh, measure({ enemies: 2 }), clock(20, 7));
    expect(noBoss.turnEnrageActive).toBe(false);
  });

  it('a par-12 boss map enrages on turn 13, not on par (the par + 1 floor)', () => {
    // large-maps/02 §2.1: max(12 + 1, min(12, 12 + 2)) = 13. Was 12, i.e. on par.
    const fresh = createTurnPressureState(measure({ boss: true }));
    const onPar = advanceTurnPressure(fresh, measure({ enemies: 2, boss: true }), clock(12, 12));
    expect(onPar.turnEnrageActive).toBe(false);
    expect(onPar.aggressiveMode).toBe(false);
    const after = advanceTurnPressure(
      onPar.state,
      measure({ enemies: 1, boss: true }),
      clock(13, 12),
    );
    expect(after.turnEnrageActive).toBe(true);
    expect(after.becameEnraged).toBe(true);
  });

  it('survives a JSON round trip (Infinity distances become null)', () => {
    const state = JSON.parse(JSON.stringify(createTurnPressureState(measure())));
    expect(state.bestLordThroneDistance).toBeNull();
    const step = advanceTurnPressure(state, measure({ throne: 5 }), clock(1));
    expect(step.state.noProgressTurns).toBe(0);
    expect(step.state.bestLordThroneDistance).toBe(5);
  });

  it('measures lords only, living ones, and only on their own objective', () => {
    const seize = { objective: 'seize', thronePos: { col: 0, row: 0 } };
    const units = [
      lord(3, 4),
      { isLord: false, currentHP: 10, col: 0, row: 1 },
      { ...lord(1, 0), currentHP: 0 },
    ];
    expect(bestLordThroneDistance(units, seize)).toBe(7);
    expect(bestLordThroneDistance(units, { objective: 'rout' })).toBe(Infinity);
    const escape = {
      objective: 'escape',
      escapeTiles: [
        { col: 9, row: 9 },
        { col: 3, row: 6 },
      ],
    };
    expect(bestLordEscapeDistance(units, escape)).toBe(2);
    const m = measureTurnPressure({
      playerUnits: units,
      enemyUnits: [foe(), foe({ isBoss: true, currentHP: 0 })],
      escapedUnits: [{}],
      battleConfig: seize,
    });
    expect(m).toEqual({
      enemyCount: 2,
      lordThroneDistance: 7,
      lordEscapeDistance: Infinity,
      escapedCount: 1,
      hasLivingBoss: false,
    });
  });
});
