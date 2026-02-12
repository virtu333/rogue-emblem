import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

let BattleScene;

function makeDisplayObject(label = '') {
  return {
    _label: label,
    _handlers: {},
    destroyed: false,
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    setInteractive() { return this; },
    setOrigin() { return this; },
    setDisplaySize() { return this; },
    setVisible() { return this; },
    setFillStyle() { return this; },
    disableInteractive() { return this; },
    removeAllListeners() { return this; },
    on(event, handler) { this._handlers[event] = handler; return this; },
    destroy() { this.destroyed = true; },
  };
}

function buildBattleContext(addResult) {
  const textObjects = [];
  const audio = { playSFX: vi.fn() };
  const context = {
    cameras: { main: { centerX: 320, centerY: 240, height: 480 } },
    add: {
      rectangle: () => makeDisplayObject(),
      text: (x, y, text) => {
        const obj = makeDisplayObject(text);
        textObjects.push(obj);
        return obj;
      },
    },
    registry: { get: () => audio },
    runManager: {
      roster: [{
        name: 'Iris',
        inventory: [],
        consumables: [],
        proficiencies: [{ type: 'Sword', rank: 'Prof' }],
      }],
      canAddToConvoy: vi.fn(() => true),
      addToConvoy: vi.fn(() => addResult),
    },
    finalizeLootPick: vi.fn(),
    showLootStatus: vi.fn(),
  };
  return { context, textObjects };
}

beforeAll(async () => {
  ({ BattleScene } = await import('../src/scenes/BattleScene.js'));
});

describe('battle loot convoy guard', () => {
  it('does not finalize weapon loot pick when convoy add fails', () => {
    const { context, textObjects } = buildBattleContext(false);
    const lootGroup = [makeDisplayObject(), makeDisplayObject()];
    const item = { name: 'Iron Sword', type: 'Sword', rankRequired: 'Prof' };

    BattleScene.prototype.showLootUnitPicker.call(context, item, lootGroup, 0);

    const convoyBtn = textObjects.find(t => t._label === '[ Send to Convoy ]');
    expect(convoyBtn).toBeTruthy();
    convoyBtn._handlers.pointerdown();

    expect(context.runManager.addToConvoy).toHaveBeenCalledWith(item);
    expect(context.finalizeLootPick).not.toHaveBeenCalled();
    expect(context.showLootStatus).toHaveBeenCalledWith('Convoy is full. Choose another reward.', '#ff8888');
    expect(convoyBtn.destroyed).toBe(false);
  });

  it('does not finalize consumable loot pick when convoy add fails', () => {
    const { context, textObjects } = buildBattleContext(false);
    const lootGroup = [makeDisplayObject(), makeDisplayObject()];
    const item = { name: 'Vulnerary', type: 'Consumable', uses: 3 };

    BattleScene.prototype.showConsumableUnitPicker.call(context, item, lootGroup, 1);

    const convoyBtn = textObjects.find(t => t._label === '[ Send to Convoy ]');
    expect(convoyBtn).toBeTruthy();
    convoyBtn._handlers.pointerdown();

    expect(context.runManager.addToConvoy).toHaveBeenCalledWith(item);
    expect(context.finalizeLootPick).not.toHaveBeenCalled();
    expect(context.showLootStatus).toHaveBeenCalledWith('Convoy is full. Choose another reward.', '#ff8888');
    expect(convoyBtn.destroyed).toBe(false);
  });
});
