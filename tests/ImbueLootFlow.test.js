// LootFlowController imbue stone flow: weapon picker filtered by canImbue,
// immediate apply for specific stones, imbue picker for the Prismatic Stone.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LootFlowController } from '../src/ui/LootFlowController.js';
import { getImbueStoneItems, isImbued } from '../src/engine/ImbueSystem.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const stones = getImbueStoneItems(data.imbues);
const vampiricStone = stones.find((s) => s.name === 'Vampiric Imbuing Stone');
const prismaticStone = stones.find((s) => s.name === 'Prismatic Stone');

function makeDisplayObject(seed = {}) {
  return {
    active: true,
    visible: true,
    handlers: {},
    ...seed,
    setOrigin() {
      return this;
    },
    setDepth() {
      return this;
    },
    setInteractive() {
      return this;
    },
    setStrokeStyle() {
      return this;
    },
    setVisible(visible) {
      this.visible = visible;
      return this;
    },
    on(event, handler) {
      this.handlers[event] = handler;
      return this;
    },
    emit(event, payload) {
      this.handlers[event]?.(payload);
      return this;
    },
    destroy: vi.fn(function destroy() {
      this.active = false;
    }),
  };
}

function makeScene() {
  const rectangles = [];
  const texts = [];
  const audio = { playSFX: vi.fn() };
  return {
    cameras: { main: { centerX: 320, centerY: 240, width: 640, height: 480 } },
    add: {
      rectangle: vi.fn((x, y, w, h) => {
        const obj = makeDisplayObject({ kind: 'rect', x, y, w, h });
        rectangles.push(obj);
        return obj;
      }),
      text: vi.fn((x, y, text) => {
        const obj = makeDisplayObject({ kind: 'text', x, y, text });
        texts.push(obj);
        return obj;
      }),
    },
    registry: { get: vi.fn((key) => (key === 'audio' ? audio : null)) },
    gameData: data,
    runManager: { roster: [] },
    showForgeLootPicker: vi.fn(),
    showLootStatus: vi.fn(),
    reportLootError: vi.fn(),
    _pinToScreen: vi.fn(),
    isStoryInputLocked: vi.fn(() => false),
    __rectangles: rectangles,
    __texts: texts,
    __audio: audio,
  };
}

function makeSword(overrides = {}) {
  return {
    name: 'Iron Sword',
    type: 'Sword',
    tier: 'Iron',
    might: 5,
    hit: 90,
    crit: 0,
    weight: 5,
    range: '1',
    price: 500,
    ...overrides,
  };
}

describe('LootFlowController — imbue stone flow', () => {
  let scene;
  let controller;

  beforeEach(() => {
    scene = makeScene();
    controller = new LootFlowController(scene);
  });

  it('weapon picker lists only imbueable weapons for an imbue stone', () => {
    const unit = {
      name: 'Edric',
      inventory: [
        makeSword(),
        makeSword({ name: 'Blessed Blade', _imbueId: 'keen' }), // already imbued
        { name: 'Heal', type: 'Staff', price: 300 }, // excluded type
      ],
    };
    controller.showForgeWeaponPicker(vampiricStone, unit, [makeDisplayObject()], 0);

    const weaponButtons = scene.__rectangles.filter(
      (obj) => typeof obj.handlers.pointerdown === 'function' && obj.w === 280,
    );
    expect(weaponButtons).toHaveLength(1);
    expect(scene.__texts.some((t) => t.text === 'Iron Sword')).toBe(true);
    expect(scene.__texts.some((t) => t.text === 'Blessed Blade')).toBe(false);
    expect(scene.__texts.some((t) => t.text === 'Edric: Select weapon to imbue')).toBe(true);
  });

  it('specific stone applies its imbue immediately and finalizes the pick', () => {
    const sword = makeSword();
    const unit = { name: 'Edric', inventory: [sword] };
    const lootGroup = [makeDisplayObject()];
    const finalizeSpy = vi.spyOn(controller, 'finalizeLootPick').mockImplementation(() => {});

    controller.showForgeWeaponPicker(vampiricStone, unit, lootGroup, 2);
    const btn = scene.__rectangles.find(
      (obj) => typeof obj.handlers.pointerdown === 'function' && obj.w === 280,
    );
    btn.handlers.pointerdown({ button: 0 });

    expect(sword._imbueId).toBe('vampiric');
    expect(sword.name).toBe('Vampiric Iron Sword');
    expect(scene.__audio.playSFX).toHaveBeenCalledWith('sfx_gold');
    expect(finalizeSpy).toHaveBeenCalledWith(lootGroup, 2);
  });

  it('prismatic stone opens the imbue picker, which applies the chosen imbue', () => {
    const sword = makeSword();
    const unit = { name: 'Edric', inventory: [sword] };
    const lootGroup = [makeDisplayObject()];
    const finalizeSpy = vi.spyOn(controller, 'finalizeLootPick').mockImplementation(() => {});
    const imbuePickerSpy = vi.spyOn(controller, 'showImbuePickerLoot');

    controller.showForgeWeaponPicker(prismaticStone, unit, lootGroup, 1);
    const weaponBtn = scene.__rectangles.find(
      (obj) => typeof obj.handlers.pointerdown === 'function' && obj.w === 280,
    );
    weaponBtn.handlers.pointerdown({ button: 0 });
    expect(imbuePickerSpy).toHaveBeenCalledWith(prismaticStone, sword, lootGroup, 1);
    expect(isImbued(sword)).toBe(false); // nothing applied yet

    // The imbue picker lists all six imbues; picking one applies it
    const imbueButtons = scene.__rectangles.filter(
      (obj) => typeof obj.handlers.pointerdown === 'function' && obj.w === 380,
    );
    expect(imbueButtons).toHaveLength(6);
    imbueButtons[2].handlers.pointerdown({ button: 0 }); // 'keen' (catalog order)

    expect(sword._imbueId).toBe('keen');
    expect(sword.name).toBe('Keen Iron Sword');
    expect(finalizeSpy).toHaveBeenCalledWith(lootGroup, 1);
  });

  it('imbue picker back button returns to the unit picker', () => {
    const sword = makeSword();
    const lootGroup = [makeDisplayObject()];
    controller.showImbuePickerLoot(prismaticStone, sword, lootGroup, 4);

    const backBtn = scene.__texts.find(
      (obj) => obj.text === '< Back' && typeof obj.handlers.pointerdown === 'function',
    );
    backBtn.handlers.pointerdown({ button: 0 });
    expect(scene.showForgeLootPicker).toHaveBeenCalledWith(prismaticStone, lootGroup, 4);
    expect(isImbued(sword)).toBe(false);
  });

  it('reports an error and returns to rewards when applyImbue fails', () => {
    // Already-imbued weapon sneaks through (defensive path)
    const sword = makeSword({ _imbueId: 'keen' });
    const unit = { name: 'Edric', inventory: [sword] };
    const lootGroup = [makeDisplayObject({ visible: false })];

    // Force the button to exist by using a fresh weapon for the list, then
    // imbue it before clicking (race-style failure).
    const freshSword = makeSword();
    const freshUnit = { name: 'Edric', inventory: [freshSword] };
    controller.showForgeWeaponPicker(vampiricStone, freshUnit, lootGroup, 0);
    freshSword._imbueId = 'keen'; // becomes unimbueable after render
    const btn = scene.__rectangles.find(
      (obj) => typeof obj.handlers.pointerdown === 'function' && obj.w === 280,
    );
    btn.handlers.pointerdown({ button: 0 });

    expect(scene.reportLootError).toHaveBeenCalledWith(
      'showForgeWeaponPicker:applyImbueFailed',
      expect.any(Error),
      expect.objectContaining({ imbueId: 'vampiric' }),
    );
    expect(scene.showForgeLootPicker).toHaveBeenCalledWith(vampiricStone, lootGroup, 0);
    expect(unit.inventory[0]._imbueId).toBe('keen');
  });
});
