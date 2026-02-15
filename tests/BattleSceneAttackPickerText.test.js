import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCombatWeaponsMock } = vi.hoisted(() => ({
  getCombatWeaponsMock: vi.fn(),
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
    getCombatWeapons: getCombatWeaponsMock,
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    destroy() {},
  };
}

describe('BattleScene attack weapon picker text', () => {
  beforeEach(() => {
    getCombatWeaponsMock.mockReset();
  });

  it('includes Wt in attack picker details with safe defaults', () => {
    const scene = new BattleScene();
    scene.hideActionMenu = vi.fn();
    scene.registry = { get: () => null };
    scene._clearSelectedWeaponArtIfInvalid = vi.fn();
    scene.findAttackTargets = vi.fn(() => []);
    scene.grid = {
      cols: 10,
      gridToPixel: () => ({ x: 64, y: 64 }),
      showAttackRange: vi.fn(),
    };
    scene.add = {
      rectangle: () => makeDisplayObject(),
    };
    scene._clampMenuPosition = (x, y) => ({ x, y });
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));

    const equipped = {
      name: 'Iron Sword',
      type: 'Sword',
      might: 5,
      hit: 90,
      crit: 0,
      weight: 5,
      range: '1',
    };
    const fallbackStats = {
      name: 'Unknown Relic',
      type: 'Sword',
    };

    getCombatWeaponsMock.mockReturnValue([equipped, fallbackStats]);

    const unit = {
      col: 1,
      row: 1,
      weapon: equipped,
      inventory: [equipped, fallbackStats],
    };

    BattleScene.prototype.showWeaponPicker.call(scene, unit, []);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels).toHaveLength(2);

    for (const label of labels) {
      expect(label).toContain('Wt');
      expect(label).not.toContain('undefined');
    }

    expect(labels[1]).toContain('0Mt 0Hit 0Crt 0Wt Rng 1');
  });
});
