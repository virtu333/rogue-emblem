// Reinforcement arrivals are never healers (Cleric, Bishop): a wave copies the garrison's
// fighters, so a Cleric standing in the map's spawns must not become an arrival template,
// and the act-pool fallback and the ladder's promoted classes leave healers out too.
import { describe, it, expect } from 'vitest';
import {
  buildReinforcementTemplatePool,
  isHealerClass,
  ladderPromotedClasses,
} from '../src/engine/ReinforcementSpawns.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

describe('reinforcements bring no healers', () => {
  it('names healers by their weapons: staff/Light only', () => {
    expect(isHealerClass('Cleric', data.classes)).toBe(true);
    expect(isHealerClass('Bishop', data.classes)).toBe(true);
    expect(isHealerClass('Fighter', data.classes)).toBe(false);
    expect(isHealerClass('Sage', data.classes)).toBe(false);
  });

  it("does not copy a garrison Cleric into the wave's templates", () => {
    const templates = buildReinforcementTemplatePool({
      battleConfig: {
        enemySpawns: [
          { className: 'Cleric', level: 5 },
          { className: 'Fighter', level: 5 },
        ],
      },
      battleParams: { act: 'act2' },
      gameData: data,
    });
    expect(templates.map((t) => t.className)).toEqual(['Fighter']);
  });

  it('keeps healers out of the act-pool fallback and the promoted ladder', () => {
    const fallback = buildReinforcementTemplatePool({
      battleConfig: { enemySpawns: [] },
      battleParams: { act: 'act4', difficultyId: 'lunatic' },
      gameData: data,
    });
    expect(fallback.length).toBeGreaterThan(0);
    expect(fallback.some((t) => isHealerClass(t.className, data.classes))).toBe(false);
    const promoted = ladderPromotedClasses({
      battleParams: { act: 'act4', difficultyId: 'lunatic' },
      gameData: data,
    });
    expect(promoted.some((c) => isHealerClass(c, data.classes))).toBe(false);
  });
});
