import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gainExperienceMock, checkLevelUpSkillsMock, popupShowMock } = vi.hoisted(() => ({
  gainExperienceMock: vi.fn(),
  checkLevelUpSkillsMock: vi.fn(() => []),
  popupShowMock: vi.fn(),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
  },
}));

vi.mock('../src/engine/UnitManager.js', async () => {
  const actual = await vi.importActual('../src/engine/UnitManager.js');
  return {
    ...actual,
    gainExperience: gainExperienceMock,
    checkLevelUpSkills: checkLevelUpSkillsMock,
  };
});

vi.mock('../src/ui/LevelUpPopup.js', () => ({
  LevelUpPopup: class {
    show() {
      return popupShowMock();
    }
  },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeTextStub() {
  return {
    setOrigin() { return this; },
    setDepth() { return this; },
    destroy() {},
  };
}

function makeScene() {
  const lifecycle = [];
  const audio = {
    playSFX: vi.fn((key) => lifecycle.push(`play:${key}`)),
  };

  const scene = new BattleScene();
  scene.registry = { get: (key) => (key === 'audio' ? audio : null) };
  scene.sound = { stopByKey: vi.fn((key) => lifecycle.push(`stop:${key}`)) };
  scene.grid = { gridToPixel: () => ({ x: 0, y: 0 }) };
  scene.add = { text: () => makeTextStub() };
  scene.tweens = { add: ({ onComplete }) => { if (onComplete) onComplete(); } };
  scene.updateHPBar = vi.fn();
  scene.gameData = { classes: [], skills: [] };
  scene.battleParams = { xpMultiplier: 1 };

  return { scene, lifecycle };
}

describe('BattleScene level-up audio lifecycle', () => {
  beforeEach(() => {
    gainExperienceMock.mockReset();
    checkLevelUpSkillsMock.mockReset();
    checkLevelUpSkillsMock.mockReturnValue([]);
    popupShowMock.mockReset();
    popupShowMock.mockResolvedValue(undefined);
  });

  it('does not stack level-up SFX across repeated level-up popups', async () => {
    gainExperienceMock.mockReturnValue({
      levelUps: [
        { newLevel: 2, gains: {} },
        { newLevel: 3, gains: {} },
      ],
    });

    const { scene, lifecycle } = makeScene();
    const unit = { col: 1, row: 1, stats: {} };

    await BattleScene.prototype.awardScaledXP.call(scene, unit, 50);

    expect(lifecycle).toEqual([
      'play:sfx_levelup',
      'stop:sfx_levelup',
      'play:sfx_levelup',
      'stop:sfx_levelup',
    ]);
  });

  it('stops and clears level-up SFX when popup closes', async () => {
    gainExperienceMock.mockReturnValue({
      levelUps: [{ newLevel: 2, gains: {} }],
    });

    const { scene } = makeScene();
    const unit = { col: 1, row: 1, stats: {} };

    await BattleScene.prototype.awardScaledXP.call(scene, unit, 30);

    expect(scene.sound.stopByKey).toHaveBeenCalledTimes(1);
    BattleScene.prototype._stopLevelUpSfx.call(scene);
    expect(scene.sound.stopByKey).toHaveBeenCalledTimes(1);
  });
});
