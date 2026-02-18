import { describe, expect, it, vi } from 'vitest';
import { RosterOverlay } from '../src/ui/RosterOverlay.js';
import { RunManager } from '../src/engine/RunManager.js';
import { CONSUMABLE_MAX, INVENTORY_MAX } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

vi.mock('phaser', () => ({
  default: {
    Scene: class {},
    Math: { Clamp: (value, min, max) => Math.min(max, Math.max(min, value)) },
  },
}));

const gameData = loadGameData();

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    setInteractive(opts) { this._interactive = opts || true; return this; },
    setOrigin() { return this; },
    setDisplaySize() { return this; },
    setColor(color) { this.color = color; return this; },
    setText(text) { this.text = text; this.width = String(text).length * 6; return this; },
    setSize(width, height) { this.width = width; this.height = height; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    on(event, cb) {
      if (!this.handlers[event]) this.handlers[event] = [];
      this.handlers[event].push(cb);
      return this;
    },
    trigger(event, ...args) {
      for (const cb of this.handlers[event] || []) cb(...args);
    },
    destroy() { this._destroyed = true; },
  };
}

function makeSceneStub() {
  const created = {
    rectangles: [],
    texts: [],
    images: [],
  };
  const scene = {
    add: {
      rectangle: (x, y, width, height, color, alpha) => {
        const obj = makeDisplayObject({ kind: 'rectangle', x, y, width, height, color, alpha });
        created.rectangles.push(obj);
        return obj;
      },
      text: (x, y, text, style) => {
        const obj = makeDisplayObject({ kind: 'text', x, y, text, style, width: String(text).length * 6 });
        created.texts.push(obj);
        return obj;
      },
      image: (x, y, key) => {
        const obj = makeDisplayObject({ kind: 'image', x, y, key });
        created.images.push(obj);
        return obj;
      },
    },
    textures: {
      exists: () => false,
    },
    created,
  };
  return scene;
}

function makeOverlay() {
  const rm = new RunManager(gameData);
  rm.startRun();
  const scene = makeSceneStub();
  const overlay = new RosterOverlay(scene, rm, {
    lords: gameData.lords || [],
    classes: gameData.classes || [],
    skills: gameData.skills || [],
    accessories: gameData.accessories || [],
    weaponArts: gameData.weaponArts || { arts: [] },
  });
  return { overlay, rm, scene };
}

function makeWeapon(name, type) {
  return {
    name,
    type,
    rankRequired: 'Prof',
    range: type === 'Bow' ? '2' : '1',
    might: 5,
    hit: 90,
    crit: 0,
    weight: 5,
    price: 500,
  };
}

function makeUnit({ name, type, inventory, weapon }) {
  return {
    name,
    className: 'Mage',
    level: 1,
    exp: 0,
    proficiencies: [{ type, rank: 'Prof' }],
    inventory,
    weapon,
    consumables: [],
    accessory: null,
    skills: [],
    stats: { HP: 20, STR: 5, MAG: 5, SKL: 5, SPD: 5, DEF: 5, RES: 5, LCK: 5, MOV: 5 },
    currentHP: 20,
  };
}

describe('Roster trade weapon gating', () => {
  it('allows trading equipped last weapon between one-weapon units', () => {
    const { overlay, scene } = makeOverlay();
    const elfire = makeWeapon('Elfire', 'Tome');
    const fire = makeWeapon('Fire', 'Tome');
    const unitA = makeUnit({ name: 'Iris', type: 'Tome', inventory: [elfire], weapon: elfire });
    const unitB = makeUnit({ name: 'Mora', type: 'Tome', inventory: [fire], weapon: fire });

    overlay._showTradeScreen(unitA, unitB);
    const leftRowHit = scene.created.rectangles.find((obj) => obj._interactive && obj.alpha === 0 && obj.x < 360);
    expect(leftRowHit).toBeTruthy();

    leftRowHit.trigger('pointerdown');

    expect(unitA.inventory).toHaveLength(0);
    expect(unitA.weapon).toBeNull();
    expect(unitB.inventory.map((item) => item.name)).toEqual(expect.arrayContaining(['Fire', 'Elfire']));
  });

  it('keeps weapon rows disabled when recipient inventory is full', () => {
    const { overlay, scene } = makeOverlay();
    const sword = makeWeapon('Iron Sword', 'Sword');
    const filler = Array.from({ length: INVENTORY_MAX }, (_v, idx) => makeWeapon(`Filler ${idx + 1}`, 'Axe'));
    const unitA = makeUnit({ name: 'Edric', type: 'Sword', inventory: [sword], weapon: sword });
    const unitB = makeUnit({ name: 'Bran', type: 'Axe', inventory: filler, weapon: filler[0] });

    overlay._showTradeScreen(unitA, unitB);

    const leftRowHit = scene.created.rectangles.find((obj) => obj._interactive && obj.alpha === 0 && obj.x < 360);
    expect(leftRowHit).toBeUndefined();

    const row = scene.created.texts.find((obj) => obj.text === 'Iron Sword');
    expect(row).toBeTruthy();
    expect(row.style?.color).toBe('#666666');
    expect(unitA.inventory).toHaveLength(1);
    expect(unitB.inventory).toHaveLength(INVENTORY_MAX);
  });

  it('shows * marker for trade rows when a weapon has bound art', () => {
    const { overlay, scene } = makeOverlay();
    const sword = { ...makeWeapon('Iron Sword', 'Sword'), weaponArtId: 'sword_precise_cut' };
    const axe = makeWeapon('Iron Axe', 'Axe');
    const unitA = makeUnit({ name: 'Edric', type: 'Sword', inventory: [sword], weapon: sword });
    const unitB = makeUnit({ name: 'Bran', type: 'Axe', inventory: [axe], weapon: axe });

    overlay._showTradeScreen(unitA, unitB);

    expect(scene.created.texts.some((obj) => obj.text === '*')).toBe(true);
  });

  it('shows * marker for roster gear rows when a weapon has bound art', () => {
    const { overlay, scene } = makeOverlay();
    const sword = { ...makeWeapon('Iron Sword', 'Sword'), weaponArtId: 'sword_precise_cut' };
    const unit = makeUnit({ name: 'Edric', type: 'Sword', inventory: [sword], weapon: sword });

    overlay._drawGearTab(40, 60, unit);

    expect(scene.created.texts.some((obj) => obj.text === '*')).toBe(true);
  });
});

describe('Roster trade copy', () => {
  it('shows labeled capacities in trade picker rows', () => {
    const { overlay, rm, scene } = makeOverlay();
    const sword = makeWeapon('Iron Sword', 'Sword');
    const axe = makeWeapon('Iron Axe', 'Axe');
    const unitA = makeUnit({ name: 'Edric', type: 'Sword', inventory: [sword], weapon: sword });
    const unitB = makeUnit({ name: 'Bran', type: 'Axe', inventory: [axe], weapon: axe });
    unitA.consumables = [{ name: 'Vulnerary', type: 'Consumable', uses: 3 }];
    unitB.consumables = [{ name: 'Elixir', type: 'Consumable', uses: 1 }];
    rm.roster = [unitA, unitB];
    overlay.selection = { type: 'unit', index: 0 };

    overlay._showTradePicker(unitA);

    const expectedLabel = `${unitB.name} (Inventory 1/${INVENTORY_MAX} | Consumables 1/${CONSUMABLE_MAX})`;
    expect(scene.created.texts.some((obj) => obj.text === expectedLabel)).toBe(true);
  });

  it('shows labeled capacities in trade headers with null-safe counts', () => {
    const { overlay, scene } = makeOverlay();
    const sword = makeWeapon('Iron Sword', 'Sword');
    const unitA = makeUnit({ name: 'Edric', type: 'Sword', inventory: [sword], weapon: sword });
    const unitB = makeUnit({ name: 'Bran', type: 'Axe', inventory: [], weapon: null });
    unitA.consumables = [{ name: 'Vulnerary', type: 'Consumable', uses: 3 }];
    unitB.inventory = undefined;
    unitB.consumables = undefined;

    expect(() => overlay._showTradeScreen(unitA, unitB)).not.toThrow();

    const leftHeader = `${unitA.name} (Inventory 1/${INVENTORY_MAX} | Consumables 1/${CONSUMABLE_MAX})`;
    const rightHeader = `${unitB.name} (Inventory 0/${INVENTORY_MAX} | Consumables 0/${CONSUMABLE_MAX})`;
    expect(scene.created.texts.some((obj) => obj.text === leftHeader)).toBe(true);
    expect(scene.created.texts.some((obj) => obj.text === rightHeader)).toBe(true);
  });

  it('truncates long names in trade picker rows while preserving capacity labels', () => {
    const { overlay, rm, scene } = makeOverlay();
    const sword = makeWeapon('Iron Sword', 'Sword');
    const axe = makeWeapon('Iron Axe', 'Axe');
    const unitA = makeUnit({ name: 'Edric', type: 'Sword', inventory: [sword], weapon: sword });
    const longName = 'VeryLongCompanionNameForTradePicker';
    const unitB = makeUnit({ name: longName, type: 'Axe', inventory: [axe], weapon: axe });
    rm.roster = [unitA, unitB];
    overlay.selection = { type: 'unit', index: 0 };

    overlay._showTradePicker(unitA);

    const row = scene.created.texts.find((obj) => typeof obj.text === 'string' && obj.text.includes('(Inventory'));
    expect(row).toBeTruthy();
    expect(row.text).toContain(`Inventory 1/${INVENTORY_MAX} | Consumables 0/${CONSUMABLE_MAX}`);
    expect(row.text).toContain('...');
    expect(row.text.includes(`${longName} (`)).toBe(false);
  });
});
