import { beforeAll, describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

let BattleScene;

function makeLegendarySwordUnit() {
  return {
    name: 'Edric',
    faction: 'player',
    currentHP: 20,
    stats: { HP: 24 },
    weapon: { type: 'Sword', name: 'Gemini' },
    proficiencies: [{ type: 'Sword', rank: 'Mast' }],
  };
}

describe('Weapon Art run-start integration', () => {
  beforeAll(async () => {
    ({ BattleScene } = await import('../src/scenes/BattleScene.js'));
  });

  it('activates meta-unlocked arts immediately at run start', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData, { metaUnlockedWeaponArts: ['legend_gemini_tempest'] });
    rm.startRun();

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.runManager = rm;
    scene.turnManager = { turnNumber: 1 };

    const choices = scene._getWeaponArtChoices(makeLegendarySwordUnit(), makeLegendarySwordUnit().weapon);
    expect(choices.some((entry) => entry.art?.id === 'legend_gemini_tempest')).toBe(true);
  });

  it('keeps legendary bound art availability instance-bound and not act-gated', () => {
    const gameData = loadGameData();
    const rm = new RunManager(gameData);
    rm.startRun();

    const scene = new BattleScene();
    scene.gameData = gameData;
    scene.runManager = rm;
    scene.turnManager = { turnNumber: 1 };

    const unit = makeLegendarySwordUnit();
    const before = scene._getWeaponArtChoices(unit, unit.weapon);
    expect(before.some((entry) => entry.art?.id === 'legend_gemini_tempest')).toBe(true);

    rm.advanceAct();
    rm.advanceAct();

    const after = scene._getWeaponArtChoices(unit, unit.weapon);
    expect(after.some((entry) => entry.art?.id === 'legend_gemini_tempest')).toBe(true);
  });
});

