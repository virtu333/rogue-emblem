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
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setColor() {
      return this;
    },
    on: vi.fn().mockReturnThis(),
    destroy() {},
  };
}

function makeHandlerCapturingObject(seed = {}) {
  const handlers = {};
  return {
    ...seed,
    setDepth() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setColor() {
      return this;
    },
    setOrigin() {
      return this;
    },
    setInteractive() {
      return this;
    },
    on(event, cb) {
      if (!handlers[event]) handlers[event] = [];
      handlers[event].push(cb);
      return this;
    },
    handlers,
    destroy() {},
  };
}

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
  might: 8,
  hit: 80,
  crit: 0,
  weight: 7,
  range: '1',
};

function makeBaseScene() {
  const scene = new BattleScene();
  scene.hideActionMenu = vi.fn();
  scene.registry = { get: () => null };
  scene._clearSelectedWeaponArtIfInvalid = vi.fn();
  scene.findAttackTargets = vi.fn(() => []);
  scene._showWeaponDetailTooltip = vi.fn();
  scene._hideWeaponDetailTooltip = vi.fn();
  scene.cameras = { main: { width: 640, height: 480 } };
  scene.grid = {
    cols: 10,
    gridToPixel: () => ({ x: 64, y: 64 }),
    showAttackRange: vi.fn(),
  };
  scene.add = {
    rectangle: () => makeDisplayObject(),
  };
  scene._clampMenuPosition = (x, y) => ({ x, y });
  return scene;
}

describe('BattleScene attack weapon picker text', () => {
  beforeEach(() => {
    getCombatWeaponsMock.mockReset();
  });

  it('shows compact name-only labels in attack picker', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));

    const fallbackStats = { name: 'Unknown Relic', type: 'Sword' };
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

    // Labels are name-only (no stat details inline)
    expect(labels[0]).toContain('Iron Sword');
    expect(labels[1]).toContain('Unknown Relic');
    for (const label of labels) {
      expect(label).not.toContain('Mt');
      expect(label).not.toContain('Hit');
      expect(label).not.toContain('undefined');
    }

    // Equipped marker on first weapon
    expect(labels[0]).toMatch(/^\u25b6/);
    expect(labels[1]).toMatch(/^ /);

    // Auto-show tooltip fires for equipped weapon
    expect(scene._showWeaponDetailTooltip).toHaveBeenCalledWith(
      equipped,
      expect.any(Object),
      expect.any(Number),
    );
  });

  it('does not pass clickOnPointerUp to weapon buttons', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));

    getCombatWeaponsMock.mockReturnValue([equipped, secondary]);
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showWeaponPicker.call(scene, unit, []);

    for (const call of scene._makeMenuTextButton.mock.calls) {
      expect(call[6]?.clickOnPointerUp).toBeFalsy();
    }
  });

  it('appends * marker when a weapon has bound weapon art', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));
    scene.gameData = {
      weaponArts: {
        arts: [{ id: 'sword_art', name: 'Sword Art' }],
      },
    };
    const artBound = { ...equipped, weaponArtId: 'sword_art' };
    getCombatWeaponsMock.mockReturnValue([artBound, secondary]);
    const unit = { col: 1, row: 1, weapon: artBound, inventory: [artBound, secondary] };

    BattleScene.prototype.showWeaponPicker.call(scene, unit, []);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels.find((label) => label.includes('Iron Sword'))).toContain('*');
    expect(labels.find((label) => label.includes('Steel Sword'))).not.toContain('*');
  });
});

describe('BattleScene attack picker tooltip lifecycle', () => {
  beforeEach(() => {
    getCombatWeaponsMock.mockReset();
  });

  function makeSceneWithHandlerCapture() {
    const scene = makeBaseScene();
    const textObjects = [];
    scene._makeMenuTextButton = vi.fn((_x, _y, label, _style, _color, _onClick) => {
      const obj = makeHandlerCapturingObject({ label });
      textObjects.push(obj);
      return obj;
    });
    return { scene, textObjects };
  }

  it('pointerover shows tooltip, pointerout hides it (mouse)', () => {
    const { scene, textObjects } = makeSceneWithHandlerCapture();
    getCombatWeaponsMock.mockReturnValue([equipped, secondary]);
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showWeaponPicker.call(scene, unit, []);

    // Clear auto-show call
    scene._showWeaponDetailTooltip.mockClear();

    // Hover over second weapon
    const overHandlers = textObjects[1].handlers.pointerover;
    overHandlers[overHandlers.length - 1]();
    expect(scene._showWeaponDetailTooltip).toHaveBeenCalledWith(
      secondary,
      expect.any(Object),
      expect.any(Number),
    );

    // Mouse pointerout hides tooltip
    const outHandlers = textObjects[1].handlers.pointerout;
    outHandlers[outHandlers.length - 1]({ pointerType: 'mouse' });
    expect(scene._hideWeaponDetailTooltip).toHaveBeenCalled();
  });

  it('touch pointerout does NOT hide tooltip', () => {
    const { scene, textObjects } = makeSceneWithHandlerCapture();
    getCombatWeaponsMock.mockReturnValue([equipped, secondary]);
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showWeaponPicker.call(scene, unit, []);

    scene._hideWeaponDetailTooltip.mockClear();
    const outHandlers = textObjects[0].handlers.pointerout;
    outHandlers[outHandlers.length - 1]({ pointerType: 'touch' });
    expect(scene._hideWeaponDetailTooltip).not.toHaveBeenCalled();
  });

  it('weapon rows do not register pointerdown tooltip handlers', () => {
    const { scene, textObjects } = makeSceneWithHandlerCapture();
    getCombatWeaponsMock.mockReturnValue([equipped, secondary]);
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showWeaponPicker.call(scene, unit, []);

    // No row-level pointerdown handlers should exist on weapon text objects
    for (const obj of textObjects) {
      expect(obj.handlers.pointerdown).toBeUndefined();
    }
  });

  it('pointerup after weapon picker open does not trigger selection', () => {
    const { scene, textObjects } = makeSceneWithHandlerCapture();
    getCombatWeaponsMock.mockReturnValue([equipped, secondary]);
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showWeaponPicker.call(scene, unit, []);

    // Since buttons use pointerdown mode, a stray pointerup should not trigger anything
    // Weapon rows should have no pointerup handlers registered by showWeaponPicker
    for (const obj of textObjects) {
      expect(obj.handlers.pointerup).toBeUndefined();
    }
  });
});
