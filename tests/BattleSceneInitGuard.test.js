import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: { Scene: class {} },
}));

import { BattleScene } from '../src/scenes/BattleScene.js';

describe('BattleScene.init() guard', () => {
  it('throws when called with null data', () => {
    const scene = new BattleScene();
    expect(() => scene.init(null)).toThrow('BattleScene requires data');
  });

  it('throws when called with undefined data', () => {
    const scene = new BattleScene();
    expect(() => scene.init(undefined)).toThrow('BattleScene requires data');
  });

  it('accepts empty object as direct-gameData payload via fallback', () => {
    const scene = new BattleScene();
    expect(() => scene.init({})).not.toThrow();
  });
});
