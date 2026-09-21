import { describe, expect, it } from 'vitest';
import { ScriptedAgent } from './agents/ScriptedAgent.js';

const move = (col, row) => ({ type: 'move_to', payload: { col, row } });
const makeAgent = (isLord, enemies = []) =>
  new ScriptedAgent({
    battle: {
      battleConfig: { objective: 'seize', thronePos: { col: 7, row: 4 } },
      selectedUnit: { name: 'Edric', isLord, col: 6, row: 4 },
      enemyUnits: enemies,
    },
  });

describe('ScriptedAgent seize movement', () => {
  it('moves a Lord onto the cleared throne and then chooses Seize', () => {
    const agent = makeAgent(true);
    expect(agent.chooseAction([move(6, 4), move(7, 4)])).toEqual(move(7, 4));
    const seize = { type: 'choose_action', payload: { label: 'Seize' } };
    expect(agent.chooseAction([{ type: 'choose_action', payload: { label: 'Wait' } }, seize])).toBe(
      seize,
    );
  });

  it('keeps approaching living enemies while the boss remains', () => {
    const agent = makeAgent(true, [{ isBoss: true, col: 5, row: 4 }]);
    expect(agent.chooseAction([move(7, 4), move(5, 4)])).toEqual(move(5, 4));
  });

  it('does not direct non-Lords to the throne', () => {
    const agent = makeAgent(false, [{ isBoss: false, col: 5, row: 4 }]);
    expect(agent.chooseAction([move(7, 4), move(5, 4)])).toEqual(move(5, 4));
  });
});

it.each(['rout', 'seize'])(
  'takes a wall detour toward a %s objective instead of waiting',
  async (objective) => {
    const { Grid } = await import('../src/engine/Grid.js');
    const { loadGameData } = await import('./testData.js');
    const grid = Object.assign(Object.create(Grid.prototype), {
      cols: 5,
      rows: 4,
      terrainData: loadGameData().terrain,
      mapLayout: [
        [0, 0, 0, 0, 0],
        [0, 0, 5, 0, 0],
        [0, 0, 5, 0, 0],
        [0, 0, 5, 0, 0],
      ],
    });
    const agent = new ScriptedAgent({
      battle: {
        grid,
        selectedUnit: { col: 1, row: 3, moveType: 'Infantry', isLord: true },
        enemyUnits: objective === 'rout' ? [{ col: 3, row: 3 }] : [],
        battleConfig: { objective, thronePos: { col: 3, row: 3 } },
      },
    });
    expect(agent.chooseAction([move(1, 3), move(1, 2), move(1, 1)])).toEqual(move(1, 1));
  },
);
