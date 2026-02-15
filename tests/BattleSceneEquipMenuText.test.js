import { describe, expect, it, vi } from 'vitest';

const { canEquipMock } = vi.hoisted(() => ({
  canEquipMock: vi.fn(() => true),
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
    canEquip: canEquipMock,
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

describe('BattleScene equip menu text', () => {
  it('shows weapon stat summary and exactly one equipped marker', () => {
    const scene = new BattleScene();
    scene.hideActionMenu = vi.fn();
    scene.showActionMenu = vi.fn();
    scene.grid = {
      cols: 10,
      gridToPixel: () => ({ x: 64, y: 64 }),
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
    const secondary = {
      name: 'Steel Sword',
      type: 'Sword',
    };
    const unit = {
      col: 1,
      row: 1,
      weapon: equipped,
      inventory: [equipped, secondary],
    };

    BattleScene.prototype.showEquipMenu.call(scene, unit);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels).toHaveLength(2);

    for (const label of labels) {
      expect(label).toContain('Mt');
      expect(label).toContain('Hit');
      expect(label).toContain('Crt');
      expect(label).toContain('Wt');
      expect(label).toContain('Rng');
      expect(label).not.toContain('undefined');
    }

    const equippedLabel = labels.find((label) => label.includes('Iron Sword'));
    const nonEquippedLabel = labels.find((label) => label.includes('Steel Sword'));
    expect(equippedLabel).toBeTruthy();
    expect(nonEquippedLabel).toBeTruthy();
    expect(equippedLabel.startsWith('  ')).toBe(false);
    expect(nonEquippedLabel.startsWith('  ')).toBe(true);
  });
});
