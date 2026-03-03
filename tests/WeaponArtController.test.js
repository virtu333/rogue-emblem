import { describe, expect, it, vi } from 'vitest';

import { WeaponArtController } from '../src/ui/WeaponArtController.js';

function makeDisplayObject(seed = {}) {
  return {
    x: 0,
    y: 0,
    width: 32,
    height: 14,
    depth: 0,
    originX: 0,
    originY: 0,
    handlers: {},
    ...seed,
    setOrigin(x = 0, y = x) {
      this.originX = x;
      this.originY = y;
      return this;
    },
    setDepth(depth) {
      this.depth = depth;
      return this;
    },
    setInteractive() {
      this.interactive = true;
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setPosition(x, y) {
      this.x = x;
      this.y = y;
      return this;
    },
    setColor() {
      return this;
    },
    setText(text) {
      this.text = text;
      return this;
    },
    getBounds() {
      const left = this.x - this.width * this.originX;
      const top = this.y - this.height * this.originY;
      return { left, top, right: left + this.width, bottom: top + this.height };
    },
    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    },
    destroy: vi.fn(),
  };
}

function makeScene() {
  const scene = {
    hideActionMenu: vi.fn(),
    showActionMenu: vi.fn(),
    _clampMenuPosition: vi.fn((x, y) => ({ x, y })),
    _pinToScreen: vi.fn(),
    _hideMenuTooltip: vi.fn(),
    _menuTooltipHoverTimer: null,
    _menuTooltipPressTimer: null,
    _selectedWeaponArt: null,
    inEquipMenu: false,
    battleState: 'PLAYER_IDLE',
    actionMenu: null,
    isMobileInput: false,
    grid: {
      cols: 10,
      gridToPixel: vi.fn(() => ({ x: 100, y: 80 })),
    },
    cameras: {
      main: {
        width: 640,
        height: 480,
      },
    },
    registry: {
      get: vi.fn(() => null),
    },
    time: {
      delayedCall: vi.fn((ms, cb) => ({
        ms,
        cb,
        remove: vi.fn(),
      })),
    },
    add: {
      rectangle: vi.fn((x, y, width, height) => makeDisplayObject({ x, y, width, height })),
      text: vi.fn((x, y, text) =>
        makeDisplayObject({
          x,
          y,
          text,
          width: Math.max(1, String(text ?? '').length) * 6,
          height: 14,
        }),
      ),
      container: vi.fn((x, y, children = []) => makeDisplayObject({ x, y, list: children })),
    },
  };
  scene._makeMenuTextButton = vi.fn((_x, _y, label, _style, _defaultColor, onClick) =>
    makeDisplayObject({ text: label, onClick }),
  );
  scene._clearMenuTooltipTimer = vi.fn((key) => {
    const timer = scene[key];
    if (timer?.remove) timer.remove(false);
    scene[key] = null;
  });
  return scene;
}

describe('WeaponArtController', () => {
  it('showWeaponArtPicker writes menu state on scene (not controller fields)', () => {
    const scene = makeScene();
    const controller = new WeaponArtController(scene);
    const weapon = { id: 'iron_sword', name: 'Iron Sword', type: 'Sword' };
    const art = { id: 'art_slash', name: 'Slash', weaponType: 'Sword' };
    const unit = { name: 'Edric', col: 1, row: 1, weapon, inventory: [weapon] };

    vi.spyOn(controller, '_getWeaponArtChoices').mockReturnValue([
      { weapon, art, canUse: true, reason: null },
    ]);
    vi.spyOn(controller, '_getWeaponArtStatusLine').mockReturnValue('Ready');
    vi.spyOn(controller, '_wireWeaponArtTooltip').mockImplementation(() => {});

    controller.showWeaponArtPicker(unit);

    expect(scene.inEquipMenu).toBe(true);
    expect(scene.battleState).toBe('UNIT_ACTION_MENU');
    expect(Array.isArray(scene.actionMenu)).toBe(true);
    expect(scene.actionMenu.length).toBeGreaterThan(0);
    expect(scene._pinToScreen).toHaveBeenCalledWith(scene.actionMenu);
    expect(controller.inEquipMenu).toBeUndefined();
    expect(controller.battleState).toBeUndefined();
  });

  it('_setSelectedWeaponArt writes selection to scene state only', () => {
    const scene = makeScene();
    const controller = new WeaponArtController(scene);
    const weapon = { id: 'iron_sword', name: 'Iron Sword', type: 'Sword' };
    const unit = { name: 'Edric', weapon, inventory: [weapon] };

    controller._setSelectedWeaponArt(unit, 'art_slash', weapon);

    expect(scene._selectedWeaponArt).toEqual({
      unitName: 'Edric',
      artId: 'art_slash',
      weaponIndex: 0,
    });
    expect(controller._selectedWeaponArt).toBeUndefined();
  });

  it('_wireWeaponArtTooltip sets suppress-next-click on long press', () => {
    const scene = makeScene();
    const controller = new WeaponArtController(scene);
    const text = makeDisplayObject();
    const art = { id: 'art_slash', name: 'Slash' };
    const showSpy = vi.spyOn(controller, '_showWeaponArtTooltip').mockImplementation(() => {});

    controller._wireWeaponArtTooltip(text, art);

    text.handlers.pointerdown({ button: 0 });
    expect(scene.time.delayedCall).toHaveBeenCalledTimes(1);

    const [, pressCb] = scene.time.delayedCall.mock.calls[0];
    pressCb();

    expect(scene._menuTooltipPressTimer).toBeNull();
    expect(text._suppressNextClick).toBe(true);
    expect(showSpy).toHaveBeenCalledWith(text, art);
  });

  it('_wireWeaponArtTooltip hover path schedules and shows tooltip', () => {
    const scene = makeScene();
    const controller = new WeaponArtController(scene);
    const text = makeDisplayObject();
    const art = { id: 'art_slash', name: 'Slash' };
    const showSpy = vi.spyOn(controller, '_showWeaponArtTooltip').mockImplementation(() => {});

    controller._wireWeaponArtTooltip(text, art);

    text.handlers.pointerover();
    expect(scene.time.delayedCall).toHaveBeenCalledTimes(1);

    const [, hoverCb] = scene.time.delayedCall.mock.calls[0];
    hoverCb();

    expect(scene._menuTooltipHoverTimer).toBeNull();
    expect(showSpy).toHaveBeenCalledWith(text, art);
  });
});
