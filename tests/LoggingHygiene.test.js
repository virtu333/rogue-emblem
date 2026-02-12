import { describe, it, expect, vi } from 'vitest';
import { AIController } from '../src/engine/AIController.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { generateNodeMap } from '../src/engine/NodeMapGenerator.js';
import { ACT_CONFIG } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

describe('Logging hygiene', () => {
  it('does not emit console output from hot-path map generation in default mode', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      generateBattle({ act: 'act1', objective: 'rout' }, data);
      generateNodeMap('act1', ACT_CONFIG.act1, data.mapTemplates);

      expect(logSpy).not.toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('does not emit console output from AI hot path in default mode', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const grid = {
      getMoveCost: () => 1,
      getMovementRange: () => {
        const map = new Map();
        map.set('5,5', 0);
        map.set('4,5', 1);
        map.set('6,5', 1);
        return map;
      },
      getAttackRange: (col, row) => [{ col: col - 1, row }],
      findPath: (fromCol, fromRow, toCol, toRow) => [{ col: fromCol, row: fromRow }, { col: toCol, row: toRow }],
    };

    const enemy = {
      name: 'Enemy',
      col: 5,
      row: 5,
      mov: 3,
      moveType: 'Infantry',
      faction: 'enemy',
      isBoss: false,
      weapon: { type: 'Sword', range: '1' },
      stats: { HP: 20 },
      currentHP: 20,
    };
    const player = {
      name: 'Player',
      col: 4,
      row: 5,
      moveType: 'Infantry',
      faction: 'player',
      weapon: { type: 'Sword', range: '1' },
      stats: { HP: 20 },
      currentHP: 20,
    };

    try {
      const ai = new AIController(grid, {}, { objective: 'rout' });
      ai._decideAction(enemy, [enemy], [player], []);

      expect(logSpy).not.toHaveBeenCalled();
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      debugSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
