import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canEquipMock, hasProficiencyMock } = vi.hoisted(() => ({
  canEquipMock: vi.fn(() => true),
  hasProficiencyMock: vi.fn(() => true),
}));

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (val, min, max) => Math.max(min, Math.min(max, val)) },
  },
}));

vi.mock('../src/engine/UnitManager.js', async () => {
  const actual = await vi.importActual('../src/engine/UnitManager.js');
  return {
    ...actual,
    canEquip: canEquipMock,
    hasProficiency: hasProficiencyMock,
  };
});

import { BattleScene } from '../src/scenes/BattleScene.js';

beforeEach(() => {
  canEquipMock.mockReset();
  canEquipMock.mockImplementation(() => true);
  hasProficiencyMock.mockReset();
  hasProficiencyMock.mockImplementation(() => true);
});

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
};

function makeBaseScene() {
  const scene = new BattleScene();
  scene.hideActionMenu = vi.fn();
  scene.showActionMenu = vi.fn();
  scene._showWeaponDetailTooltip = vi.fn();
  scene._hideWeaponDetailTooltip = vi.fn();
  scene.findAttackTargets = vi.fn(() => []);
  scene.findHealTargets = vi.fn(() => []);
  scene.getActiveHealStaff = vi.fn(() => null);
  scene._getWeaponArtChoices = vi.fn(() => []);
  scene._getSelectedWeaponArtForUnit = vi.fn(() => null);
  scene.getPromotionConsumable = vi.fn(() => null);
  scene.findShoveTargets = vi.fn(() => []);
  scene.findPullTargets = vi.fn(() => []);
  scene.findTradeTargets = vi.fn(() => []);
  scene.findSwapTargets = vi.fn(() => []);
  scene.findDanceTargets = vi.fn(() => []);
  scene.findBreakTargets = vi.fn(() => []);
  scene.registry = { get: vi.fn(() => null) };
  scene.npcUnits = [];
  scene.enemyUnits = [];
  scene.playerUnits = [];
  scene.runManager = null;
  scene.battleConfig = { objective: 'rout' };
  scene.gameData = { classes: [], lords: [] };
  scene._playerDeathsThisBattle = 0;
  scene.cameras = {
    main: { centerX: 320, centerY: 240, width: 640, height: 480 },
  };
  scene.input = { on: vi.fn(), off: vi.fn() };
  scene.grid = {
    cols: 10,
    gridToPixel: () => ({ x: 64, y: 64 }),
  };
  scene.add = {
    rectangle: () => makeDisplayObject(),
  };
  scene._clampMenuPosition = (x, y) => ({ x, y });
  return scene;
}

describe('BattleScene equip menu text', () => {
  it('shows compact name-only labels with equipped marker', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));

    const unit = {
      col: 1,
      row: 1,
      weapon: equipped,
      inventory: [equipped, secondary],
    };

    BattleScene.prototype.showEquipMenu.call(scene, unit);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels).toHaveLength(2);

    // Labels are single-line name-only
    for (const label of labels) {
      expect(label.split('\n')).toHaveLength(1);
      expect(label).not.toContain('Mt');
      expect(label).not.toContain('Hit');
      expect(label).not.toContain('undefined');
    }

    const equippedLabel = labels.find((label) => label.includes('Iron Sword'));
    const nonEquippedLabel = labels.find((label) => label.includes('Steel Sword'));
    expect(equippedLabel).toBeTruthy();
    expect(nonEquippedLabel).toBeTruthy();
    // Equipped weapon has marker
    expect(equippedLabel.startsWith('\u25b6')).toBe(true);
    expect(nonEquippedLabel.startsWith('  ')).toBe(true);

    // Auto-show tooltip fires for equipped weapon
    expect(scene._showWeaponDetailTooltip).toHaveBeenCalledWith(
      equipped,
      expect.any(Object),
      expect.any(Number),
    );
  });

  it('does not pass clickOnPointerUp to equip buttons', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));

    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showEquipMenu.call(scene, unit);

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
    const unit = { col: 1, row: 1, weapon: artBound, inventory: [artBound, secondary] };

    BattleScene.prototype.showEquipMenu.call(scene, unit);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels.find((label) => label.includes('Iron Sword'))).toContain('*');
    expect(labels.find((label) => label.includes('Steel Sword'))).not.toContain('*');
  });

  it('shows Equip in action menu with one equippable and one non-proficient weapon', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));
    const noProfWeapon = { name: 'Iron Axe', type: 'Axe' };
    canEquipMock.mockImplementation((_unit, weapon) => weapon !== noProfWeapon);
    hasProficiencyMock.mockImplementation((_unit, weapon) => weapon !== noProfWeapon);

    const unit = {
      col: 1,
      row: 1,
      weapon: equipped,
      inventory: [equipped, noProfWeapon],
      consumables: [],
      skills: [],
    };

    BattleScene.prototype.showActionMenu.call(scene, unit);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels).toContain('Equip');
  });

  it('hides top-level Reclass when multiple reclass seals are usable', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));
    scene.gameData = {
      classes: [
        { name: 'Myrmidon', tier: 'base', moveType: 'Infantry' },
        { name: 'Knight', tier: 'base', moveType: 'Armored' },
        { name: 'Cavalier', tier: 'base', moveType: 'Cavalry' },
      ],
      lords: [],
    };

    const unit = {
      col: 1,
      row: 1,
      className: 'Myrmidon',
      tier: 'base',
      weapon: equipped,
      inventory: [equipped],
      consumables: [
        {
          name: 'Infantry Seal',
          type: 'Consumable',
          effect: 'reclass',
          subEffect: 'infantry',
          uses: 1,
        },
        {
          name: 'Mounted Seal',
          type: 'Consumable',
          effect: 'reclass',
          subEffect: 'mounted',
          uses: 1,
        },
      ],
      skills: [],
    };

    BattleScene.prototype.showActionMenu.call(scene, unit);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels).not.toContain('Reclass');
    expect(labels).toContain('Item');
  });

  it('shows top-level Reclass only for a single usable seal and routes to that seal', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));
    scene.showReclassClassPicker = vi.fn();
    scene.gameData = {
      classes: [
        { name: 'Myrmidon', tier: 'base', moveType: 'Infantry' },
        { name: 'Knight', tier: 'base', moveType: 'Armored' },
      ],
      lords: [],
    };

    const infantrySeal = {
      name: 'Infantry Seal',
      type: 'Consumable',
      effect: 'reclass',
      subEffect: 'infantry',
      uses: 1,
    };
    const mountedSeal = {
      name: 'Mounted Seal',
      type: 'Consumable',
      effect: 'reclass',
      subEffect: 'mounted',
      uses: 1,
    };
    const unit = {
      col: 1,
      row: 1,
      className: 'Myrmidon',
      tier: 'base',
      weapon: equipped,
      inventory: [equipped],
      consumables: [infantrySeal, mountedSeal],
      skills: [],
    };

    BattleScene.prototype.showActionMenu.call(scene, unit);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels).toContain('Reclass');

    const reclassCall = scene._makeMenuTextButton.mock.calls.find((call) => call[2] === 'Reclass');
    expect(reclassCall).toBeTruthy();
    reclassCall[5]();

    expect(scene.showReclassClassPicker).toHaveBeenCalledWith(unit, infantrySeal);
  });

  it('shows Heal when only a non-equipped staff has targets', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));

    const heal = { name: 'Heal', type: 'Staff', uses: 3, _usesSpent: 0 };
    const physic = { name: 'Physic', type: 'Staff', uses: 1, _usesSpent: 0 };
    const ally = { name: 'Ally' };

    scene.getUsableStaves = vi.fn(() => [heal, physic]);
    scene.findHealTargets = vi.fn((_unit, staffOverride) =>
      staffOverride === physic ? [ally] : [],
    );

    const unit = {
      col: 1,
      row: 1,
      weapon: heal,
      inventory: [heal, physic],
      stats: { MAG: 18 },
      consumables: [],
      skills: [],
    };

    BattleScene.prototype.showActionMenu.call(scene, unit);

    const labels = scene._makeMenuTextButton.mock.calls.map((call) => call[2]);
    expect(labels.some((label) => label.startsWith('Heal ('))).toBe(true);
    expect(scene.findHealTargets).toHaveBeenCalledWith(unit, heal);
    expect(scene.findHealTargets).toHaveBeenCalledWith(unit, physic);
  });

  it('heal action auto-selects the only staff that has targets', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));
    scene.showStaffPicker = vi.fn();
    scene.startHealTargetSelection = vi.fn();

    const heal = { name: 'Heal', type: 'Staff', uses: 3, _usesSpent: 0 };
    const physic = { name: 'Physic', type: 'Staff', uses: 1, _usesSpent: 0 };
    const ally = { name: 'Ally' };

    scene.getUsableStaves = vi.fn(() => [heal, physic]);
    scene.findHealTargets = vi.fn((_unit, staffOverride) =>
      staffOverride === physic ? [ally] : [],
    );

    const unit = {
      col: 1,
      row: 1,
      weapon: heal,
      inventory: [heal, physic],
      stats: { MAG: 18 },
      consumables: [],
      skills: [],
    };

    BattleScene.prototype.showActionMenu.call(scene, unit);
    const healCall = scene._makeMenuTextButton.mock.calls.find((call) =>
      call[2].startsWith('Heal ('),
    );
    expect(healCall).toBeTruthy();
    healCall[5]();

    expect(scene.showStaffPicker).not.toHaveBeenCalled();
    expect(scene.startHealTargetSelection).toHaveBeenCalledWith(unit, [ally], physic);
  });

  it('non-proficient rows render gray with (no prof) suffix', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));
    const noProfWeapon = { name: 'Iron Axe', type: 'Axe' };
    canEquipMock.mockImplementation((_unit, weapon) => weapon !== noProfWeapon);
    hasProficiencyMock.mockImplementation((_unit, weapon) => weapon !== noProfWeapon);

    const unit = {
      col: 1,
      row: 1,
      weapon: equipped,
      inventory: [equipped, noProfWeapon],
    };

    BattleScene.prototype.showEquipMenu.call(scene, unit);

    const noProfCall = scene._makeMenuTextButton.mock.calls.find((call) =>
      call[2].includes('Iron Axe'),
    );
    expect(noProfCall).toBeTruthy();
    expect(noProfCall[2]).toContain('(no prof)');
    expect(noProfCall[3].color).toBe('#888888');
  });

  it('non-proficient row click does not equip or change weapon', () => {
    const scene = makeBaseScene();
    scene._makeMenuTextButton = vi.fn((_x, _y, label) => makeDisplayObject({ label }));
    const noProfWeapon = { name: 'Iron Axe', type: 'Axe' };
    canEquipMock.mockImplementation((_unit, weapon) => weapon !== noProfWeapon);
    hasProficiencyMock.mockImplementation((_unit, weapon) => weapon !== noProfWeapon);

    const unit = {
      col: 1,
      row: 1,
      weapon: equipped,
      inventory: [equipped, noProfWeapon],
    };

    BattleScene.prototype.showEquipMenu.call(scene, unit);
    const noProfCall = scene._makeMenuTextButton.mock.calls.find((call) =>
      call[2].includes('Iron Axe'),
    );
    const onClick = noProfCall[5];
    onClick();

    expect(unit.weapon).toBe(equipped);
    expect(scene.showActionMenu).not.toHaveBeenCalled();
  });

  it('tooltip handlers still fire for non-proficient rows', () => {
    const scene = makeBaseScene();
    const textObjects = [];
    scene._makeMenuTextButton = vi.fn((_x, _y, label, _style, _color, _onClick) => {
      const obj = makeHandlerCapturingObject({ label, y: _y });
      textObjects.push(obj);
      return obj;
    });
    const noProfWeapon = { name: 'Iron Axe', type: 'Axe' };
    canEquipMock.mockImplementation((_unit, weapon) => weapon !== noProfWeapon);
    hasProficiencyMock.mockImplementation((_unit, weapon) => weapon !== noProfWeapon);

    const unit = {
      col: 1,
      row: 1,
      weapon: equipped,
      inventory: [equipped, noProfWeapon],
    };

    BattleScene.prototype.showEquipMenu.call(scene, unit);

    const noProfText = textObjects.find((obj) => obj.label.includes('Iron Axe'));
    scene._showWeaponDetailTooltip.mockClear();
    const overHandlers = noProfText.handlers.pointerover;
    overHandlers[overHandlers.length - 1]();

    expect(scene._showWeaponDetailTooltip).toHaveBeenCalledWith(
      noProfWeapon,
      expect.any(Object),
      expect.any(Number),
    );
  });
});

describe('BattleScene equip menu tooltip lifecycle', () => {
  function makeSceneWithHandlerCapture() {
    const scene = makeBaseScene();
    const textObjects = [];
    scene._makeMenuTextButton = vi.fn((_x, _y, label, _style, _color, _onClick) => {
      const obj = makeHandlerCapturingObject({ label, y: _y });
      textObjects.push(obj);
      return obj;
    });
    return { scene, textObjects };
  }

  it('pointerover shows tooltip, mouse pointerout hides it', () => {
    const { scene, textObjects } = makeSceneWithHandlerCapture();
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showEquipMenu.call(scene, unit);

    scene._showWeaponDetailTooltip.mockClear();

    const overHandlers = textObjects[1].handlers.pointerover;
    overHandlers[overHandlers.length - 1]();
    expect(scene._showWeaponDetailTooltip).toHaveBeenCalledWith(
      secondary,
      expect.any(Object),
      expect.any(Number),
    );

    const outHandlers = textObjects[1].handlers.pointerout;
    outHandlers[outHandlers.length - 1]({ pointerType: 'mouse' });
    expect(scene._hideWeaponDetailTooltip).toHaveBeenCalled();
  });

  it('touch pointerout does NOT hide tooltip', () => {
    const { scene, textObjects } = makeSceneWithHandlerCapture();
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showEquipMenu.call(scene, unit);

    scene._hideWeaponDetailTooltip.mockClear();
    const outHandlers = textObjects[0].handlers.pointerout;
    outHandlers[outHandlers.length - 1]({ pointerType: 'touch' });
    expect(scene._hideWeaponDetailTooltip).not.toHaveBeenCalled();
  });

  it('equip rows do not register pointerdown tooltip handlers', () => {
    const { scene, textObjects } = makeSceneWithHandlerCapture();
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showEquipMenu.call(scene, unit);

    // No row-level pointerdown handlers should exist on equip text objects
    for (const obj of textObjects) {
      expect(obj.handlers.pointerdown).toBeUndefined();
    }
  });

  it('pointerup after equip menu open does not trigger selection', () => {
    const { scene, textObjects } = makeSceneWithHandlerCapture();
    const unit = { col: 1, row: 1, weapon: equipped, inventory: [equipped, secondary] };
    BattleScene.prototype.showEquipMenu.call(scene, unit);

    // Since buttons use pointerdown mode, a stray pointerup should not trigger anything
    for (const obj of textObjects) {
      expect(obj.handlers.pointerup).toBeUndefined();
    }
  });
});

describe('equip menu overflow', () => {
  const wpn3 = { name: 'Silver Sword', type: 'Sword' };
  const wpn4 = { name: 'Killing Edge', type: 'Sword' };
  const overflowWeapons = [equipped, secondary, wpn3, wpn4];

  function makeOverflowScene() {
    const scene = makeBaseScene();
    // Shrink camera height to force overflow (4 items x 20px = 80px content vs ~50px view)
    scene.cameras.main.height = 80;
    const textObjects = [];
    scene._makeMenuTextButton = vi.fn((_x, _y, label, _style, _color, _onClick, _opts) => {
      const obj = makeHandlerCapturingObject({ label, y: _y });
      obj.setVisible = vi.fn();
      obj.input = { enabled: true };
      textObjects.push(obj);
      return obj;
    });
    scene.add.text = vi.fn(() => {
      const t = makeDisplayObject();
      t.setOrigin = vi.fn().mockReturnThis();
      return t;
    });
    return { scene, textObjects };
  }

  it('registers scroll handler when content overflows', () => {
    const { scene } = makeOverflowScene();
    const unit = { col: 1, row: 1, weapon: equipped, inventory: overflowWeapons };
    BattleScene.prototype.showEquipMenu.call(scene, unit);

    expect(scene.input.on).toHaveBeenCalledWith('wheel', expect.any(Function));
  });

  it('skips auto-preview when overflowing', () => {
    const { scene } = makeOverflowScene();
    const unit = { col: 1, row: 1, weapon: equipped, inventory: overflowWeapons };
    BattleScene.prototype.showEquipMenu.call(scene, unit);

    expect(scene._showWeaponDetailTooltip).not.toHaveBeenCalled();
    expect(scene._weaponPreviewedItem).toBeNull();
  });

  it('tooltip uses live text.y after scroll', () => {
    const { scene, textObjects } = makeOverflowScene();
    const unit = { col: 1, row: 1, weapon: equipped, inventory: overflowWeapons };
    BattleScene.prototype.showEquipMenu.call(scene, unit);

    // Get the wheel handler and simulate a scroll
    const wheelCall = scene.input.on.mock.calls.find((c) => c[0] === 'wheel');
    const wheelHandler = wheelCall[1];
    scene.inEquipMenu = true;
    scene.battleState = 'UNIT_ACTION_MENU';
    wheelHandler(null, null, 0, 100); // scroll down

    // text.y should have been updated by applyScroll
    const firstText = textObjects[0];
    const updatedY = firstText.y;

    // Now trigger pointerover — should pass live text.y, not the original itemY
    scene._showWeaponDetailTooltip.mockClear();
    const overHandlers = firstText.handlers.pointerover;
    overHandlers[overHandlers.length - 1]();

    expect(scene._showWeaponDetailTooltip).toHaveBeenCalledWith(
      equipped,
      expect.any(Object),
      updatedY,
    );
  });
});

describe('BattleScene weapon detail tooltip', () => {
  it('includes weapon art summary lines when weapon has a bound art', () => {
    const scene = new BattleScene();
    let tooltipText = '';
    scene.add = {
      text: (_x, _y, text) => {
        tooltipText = String(text);
        return {
          width: 140,
          height: 48,
          setDepth() {
            return this;
          },
          setPosition() {
            return this;
          },
        };
      },
      rectangle: () => ({
        width: 152,
        height: 60,
        setOrigin() {
          return this;
        },
        setStrokeStyle() {
          return this;
        },
        setDepth() {
          return this;
        },
      }),
      container: () => ({
        setDepth() {
          return this;
        },
        setPosition() {
          return this;
        },
        destroy() {},
      }),
    };
    scene.cameras = { main: { width: 640, height: 480 } };
    scene._pinToScreen = vi.fn();
    scene._formatSpecialLinesForUi = BattleScene.prototype._formatSpecialLinesForUi;
    scene._hideWeaponDetailTooltip = BattleScene.prototype._hideWeaponDetailTooltip;
    scene._getWeaponArtCatalog = () => [
      { id: 'sword_art', name: 'Sword Art', combatMods: { hitBonus: 10 } },
    ];

    BattleScene.prototype._showWeaponDetailTooltip.call(
      scene,
      { ...equipped, weaponArtId: 'sword_art' },
      { x: 20, y: 20, width: 100, height: 80 },
      50,
    );

    expect(tooltipText).toContain('Art: Sword Art - Hit +10');
  });
});
