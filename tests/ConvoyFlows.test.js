import { beforeAll, describe, expect, it, vi } from 'vitest';
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

let NodeMapScene;
const gameData = loadGameData();

function makeDisplayObject(seed = {}) {
  return {
    ...seed,
    handlers: {},
    setDepth() { return this; },
    setStrokeStyle() { return this; },
    setInteractive() { this._interactive = true; return this; },
    setOrigin() { return this; },
    setDisplaySize() { return this; },
    setColor() { return this; },
    setY(y) { this.y = y; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; },
    setSize(width, height) { this.width = width; this.height = height; return this; },
    on(event, cb) { this.handlers[event] = cb; return this; },
    destroy() { this._destroyed = true; },
  };
}

function makeRosterSceneStub() {
  return {
    add: {
      rectangle: (x, y, width, height, color, alpha) => makeDisplayObject({ kind: 'rectangle', x, y, width, height, color, alpha }),
      text: (x, y, text, style) => makeDisplayObject({ kind: 'text', x, y, text, style, height: 20 }),
      image: (x, y, key) => makeDisplayObject({ kind: 'image', x, y, key }),
    },
    textures: {
      exists: () => false,
    },
  };
}

function seedRoster(rm, count) {
  if (count <= 0) {
    rm.roster = [];
    return;
  }
  const template = structuredClone(rm.roster[0]);
  rm.roster = Array.from({ length: count }, (_, i) => {
    const unit = structuredClone(template);
    unit.name = `Unit${i + 1}`;
    unit.level = Number.isFinite(unit.level) ? unit.level : 1;
    unit.stats = unit.stats || { HP: 20 };
    unit.currentHP = Number.isFinite(unit.currentHP) ? unit.currentHP : unit.stats.HP;
    unit.inventory = Array.isArray(unit.inventory) ? unit.inventory : [];
    unit.consumables = Array.isArray(unit.consumables) ? unit.consumables : [];
    unit.skills = Array.isArray(unit.skills) ? unit.skills : [];
    return unit;
  });
}

beforeAll(async () => {
  ({ NodeMapScene } = await import('../src/scenes/NodeMapScene.js'));
});

describe('convoy scene/UI flows', () => {
  it('routes full-consumable shop purchase to convoy', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Iris', inventory: [], consumables: new Array(CONSUMABLE_MAX).fill({}) };
    const entry = { price: 120, item: { name: 'Vulnerary', type: 'Consumable', uses: 3 } };
    const showUnitPicker = vi.fn((onPick) => onPick(0));
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => true),
      addToConvoy: vi.fn(() => true),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker,
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.addToConvoy).toHaveBeenCalledWith(entry.item);
    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(showUnitPicker).toHaveBeenCalledWith(expect.any(Function), { itemTypeContext: 'consumable' });
    expect(ctx.shopBuyItems).toHaveLength(0);
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Vulnerary sent to convoy.', '#88ccff');
  });

  it('does not consume shop entry when overflow convoy purchase cannot spend gold', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Iris', inventory: [], consumables: new Array(CONSUMABLE_MAX).fill({}) };
    const entry = { price: 120, item: { name: 'Vulnerary', type: 'Consumable', uses: 3 } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => false),
      addToConvoy: vi.fn(() => true),
      addGold: vi.fn(),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.addToConvoy).not.toHaveBeenCalled();
    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(1);
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Not enough gold.', '#ff8888');
  });

  it('routes full-inventory shop purchase to convoy', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Kane', inventory: new Array(INVENTORY_MAX).fill({}), consumables: [] };
    const entry = { price: 200, item: { name: 'Iron Sword', type: 'Sword' } };
    const showUnitPicker = vi.fn((onPick) => onPick(0));
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => true),
      addToConvoy: vi.fn(() => true),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker,
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.addToConvoy).toHaveBeenCalledWith(entry.item);
    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(showUnitPicker).toHaveBeenCalledWith(
      expect.any(Function),
      { profCheckItem: entry.item, itemTypeContext: 'inventory' }
    );
    expect(ctx.shopBuyItems).toHaveLength(0);
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Iron Sword sent to convoy.', '#88ccff');
  });

  it('does not consume weapon shop entry when overflow convoy purchase cannot spend gold', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Kane', inventory: new Array(INVENTORY_MAX).fill({}), consumables: [] };
    const entry = { price: 200, item: { name: 'Iron Sword', type: 'Sword' } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => false),
      addToConvoy: vi.fn(() => true),
      addGold: vi.fn(),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.addToConvoy).not.toHaveBeenCalled();
    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(1);
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Not enough gold.', '#ff8888');
  });

  it('refunds gold and aborts when consumable overflow convoy add fails after spend', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Iris', inventory: [], consumables: new Array(CONSUMABLE_MAX).fill({}) };
    const entry = { price: 120, item: { name: 'Vulnerary', type: 'Consumable', uses: 3 } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => true),
      addToConvoy: vi.fn(() => false),
      addGold: vi.fn(),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(rm.addToConvoy).toHaveBeenCalledWith(entry.item);
    expect(rm.addGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(1);
    expect(ctx.showShopBanner).toHaveBeenCalledWith("Iris's consumables are full!", '#ff8888');
  });

  it('refunds gold and aborts when weapon overflow convoy add fails after spend', () => {
    const audio = { playSFX: vi.fn() };
    const unit = { name: 'Kane', inventory: new Array(INVENTORY_MAX).fill({}), consumables: [] };
    const entry = { price: 200, item: { name: 'Iron Sword', type: 'Sword' } };
    const rm = {
      gold: 999,
      roster: [unit],
      spendGold: vi.fn(() => true),
      addToConvoy: vi.fn(() => false),
      addGold: vi.fn(),
    };
    const ctx = {
      runManager: rm,
      shopBuyItems: [entry],
      showUnitPicker: (onPick) => onPick(0),
      registry: { get: () => audio },
      refreshShop: vi.fn(),
      showShopBanner: vi.fn(),
    };

    NodeMapScene.prototype.onBuyItem.call(ctx, entry);

    expect(rm.spendGold).toHaveBeenCalledWith(entry.price);
    expect(rm.addToConvoy).toHaveBeenCalledWith(entry.item);
    expect(rm.addGold).toHaveBeenCalledWith(entry.price);
    expect(ctx.shopBuyItems).toHaveLength(1);
    expect(ctx.showShopBanner).toHaveBeenCalledWith("Kane's inventory is full!", '#ff8888');
  });

  it('stores a consumable from roster into convoy via store action', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    unit.inventory = [];
    unit.consumables = [structuredClone(vuln)];
    unit.skills = unit.skills || [];
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });
    const actions = [];
    overlay._actionBtn = (x, y, label, onClick) => {
      actions.push({ label, onClick });
      return makeDisplayObject();
    };

    overlay._activeTab = 'gear';
    overlay.drawUnitDetails();
    const storeAction = actions.find(a => a.label === '[Store]');
    expect(storeAction).toBeTruthy();
    storeAction.onClick();

    expect(unit.consumables).toHaveLength(0);
    expect(rm.getConvoyCounts().consumables).toBe(1);
  });

  it('keeps roster [Store] locked for a unit last combat weapon', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const profType = unit.proficiencies?.[0]?.type || 'Sword';
    const baseWeapon = gameData.weapons.find(w => w.type === profType && w.rankRequired === 'Prof')
      || gameData.weapons.find(w => w.type === profType)
      || gameData.weapons.find(w => w.type === 'Sword');
    const weapon = structuredClone(baseWeapon);
    unit.inventory = [weapon];
    unit.weapon = weapon;
    unit.consumables = [];
    unit.skills = unit.skills || [];
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });
    const actions = [];
    overlay._actionBtn = (x, y, label, onClick) => {
      actions.push({ label, onClick });
      return makeDisplayObject();
    };

    overlay._activeTab = 'gear';
    overlay.drawUnitDetails();

    const storeAction = actions.find(a => a.label === '[Store]');
    expect(storeAction).toBeUndefined();
  });

  it('applies a weapon-art scroll to an eligible weapon and consumes the scroll', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const sword = structuredClone(gameData.weapons.find(w => w.type === 'Sword' && w.name === 'Iron Sword'));
    unit.inventory = [sword];
    unit.weapon = sword;
    unit.skills = unit.skills || [];
    rm.scrolls = [{
      name: 'Precise Cut Scroll',
      teachesWeaponArtId: 'sword_precise_cut',
      allowedWeaponTypes: ['Sword'],
    }];

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
      weaponArts: gameData.weaponArts || { arts: [] },
    });
    overlay.scene.registry = { get: () => null };
    overlay._showBanner = vi.fn();
    overlay.refresh = vi.fn();

    overlay._useTeamScroll(unit, rm.scrolls[0]);

    expect(sword.weaponArtIds).toEqual(['sword_precise_cut']);
    expect(sword.weaponArtSources).toEqual(['scroll']);
    expect(sword.weaponArtId).toBe('sword_precise_cut');
    expect(sword.weaponArtSource).toBe('scroll');
    expect(rm.scrolls).toHaveLength(0);
  });

  it('supports overwrite confirmation for innate weapon arts with single consume and single write', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const sword = structuredClone(gameData.weapons.find(w => w.type === 'Sword' && w.name === 'Iron Sword'));
    sword.weaponArtIds = ['legend_gemini_tempest', 'custom_art_a', 'custom_art_b'];
    sword.weaponArtSources = ['innate', 'scroll', 'scroll'];
    sword.weaponArtId = 'legend_gemini_tempest';
    sword.weaponArtSource = 'innate';
    unit.inventory = [sword];
    unit.weapon = sword;
    unit.skills = unit.skills || [];
    rm.scrolls = [{
      name: 'Precise Cut Scroll',
      teachesWeaponArtId: 'sword_precise_cut',
      allowedWeaponTypes: ['Sword'],
    }];

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
      weaponArts: gameData.weaponArts || { arts: [] },
    });
    overlay.scene.registry = { get: () => null };
    overlay._showBanner = vi.fn();
    overlay.refresh = vi.fn();
    overlay._showWeaponArtSlotPicker = vi.fn((weapon, art, onSelect) => onSelect({ index: 0, binding: { id: 'legend_gemini_tempest', source: 'innate' } }));
    overlay._showWeaponArtOverwriteConfirm = vi.fn((binding, art, onConfirm) => onConfirm());

    const removeSpy = vi.spyOn(overlay, '_removeTeamScroll');
    const writeSpy = vi.spyOn(overlay, '_writeWeaponArtBindings');

    overlay._useTeamScroll(unit, rm.scrolls[0]);

    expect(overlay._showWeaponArtOverwriteConfirm).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(rm.scrolls).toHaveLength(0);
    expect(sword.weaponArtIds).toEqual(['sword_precise_cut', 'custom_art_a', 'custom_art_b']);
    expect(sword.weaponArtSources).toEqual(['scroll', 'scroll', 'scroll']);
    expect(sword.weaponArtId).toBe('sword_precise_cut');
    expect(sword.weaponArtSource).toBe('scroll');
  });

  it('does not mutate weapon arts when overwrite confirm is canceled', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const sword = structuredClone(gameData.weapons.find(w => w.type === 'Sword' && w.name === 'Iron Sword'));
    sword.weaponArtIds = ['legend_gemini_tempest', 'custom_art_a', 'custom_art_b'];
    sword.weaponArtSources = ['innate', 'scroll', 'scroll'];
    sword.weaponArtId = 'legend_gemini_tempest';
    sword.weaponArtSource = 'innate';
    unit.inventory = [sword];
    unit.weapon = sword;
    rm.scrolls = [{
      name: 'Precise Cut Scroll',
      teachesWeaponArtId: 'sword_precise_cut',
      allowedWeaponTypes: ['Sword'],
    }];

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
      weaponArts: gameData.weaponArts || { arts: [] },
    });
    overlay.scene.registry = { get: () => null };
    overlay._showBanner = vi.fn();
    overlay.refresh = vi.fn();
    overlay._showWeaponArtSlotPicker = vi.fn((weapon, art, onSelect) => onSelect({ index: 0, binding: { id: 'legend_gemini_tempest', source: 'innate' } }));
    overlay._showWeaponArtOverwriteConfirm = vi.fn((_binding, _art, _onConfirm) => {});

    overlay._useTeamScroll(unit, rm.scrolls[0]);

    expect(rm.scrolls).toHaveLength(1);
    expect(sword.weaponArtIds).toEqual(['legend_gemini_tempest', 'custom_art_a', 'custom_art_b']);
    expect(sword.weaponArtSources).toEqual(['innate', 'scroll', 'scroll']);
    expect(sword.weaponArtId).toBe('legend_gemini_tempest');
    expect(sword.weaponArtSource).toBe('innate');
  });

  it('does not mutate weapon arts when scroll consumption fails', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const sword = structuredClone(gameData.weapons.find(w => w.type === 'Sword' && w.name === 'Iron Sword'));
    sword.weaponArtIds = ['legend_gemini_tempest', 'custom_art_a', 'custom_art_b'];
    sword.weaponArtSources = ['innate', 'scroll', 'scroll'];
    sword.weaponArtId = 'legend_gemini_tempest';
    sword.weaponArtSource = 'innate';
    unit.inventory = [sword];
    unit.weapon = sword;
    rm.scrolls = [{
      name: 'Precise Cut Scroll',
      teachesWeaponArtId: 'sword_precise_cut',
      allowedWeaponTypes: ['Sword'],
    }];

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
      weaponArts: gameData.weaponArts || { arts: [] },
    });
    overlay.scene.registry = { get: () => null };
    overlay._showBanner = vi.fn();
    overlay.refresh = vi.fn();
    overlay._showWeaponArtSlotPicker = vi.fn((weapon, art, onSelect) => onSelect({ index: 0, binding: { id: 'legend_gemini_tempest', source: 'innate' } }));
    overlay._showWeaponArtOverwriteConfirm = vi.fn((binding, art, onConfirm) => onConfirm());
    vi.spyOn(overlay, '_removeTeamScroll').mockReturnValue(false);

    overlay._useTeamScroll(unit, rm.scrolls[0]);

    expect(rm.scrolls).toHaveLength(1);
    expect(sword.weaponArtIds).toEqual(['legend_gemini_tempest', 'custom_art_a', 'custom_art_b']);
    expect(sword.weaponArtSources).toEqual(['innate', 'scroll', 'scroll']);
    expect(sword.weaponArtId).toBe('legend_gemini_tempest');
    expect(sword.weaponArtSource).toBe('innate');
  });

  it('slot picker cancel on full weapon path leaves scroll and weapon unchanged', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const sword = structuredClone(gameData.weapons.find(w => w.type === 'Sword' && w.name === 'Iron Sword'));
    sword.weaponArtIds = ['legend_gemini_tempest', 'sword_comet_edge', 'custom_art_b'];
    sword.weaponArtSources = ['innate', 'scroll', 'scroll'];
    sword.weaponArtId = 'legend_gemini_tempest';
    sword.weaponArtSource = 'innate';
    unit.inventory = [sword];
    unit.weapon = sword;
    rm.scrolls = [{
      name: 'Precise Cut Scroll',
      teachesWeaponArtId: 'sword_precise_cut',
      allowedWeaponTypes: ['Sword'],
    }];

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
      weaponArts: gameData.weaponArts || { arts: [] },
    });
    overlay.scene.registry = { get: () => null };
    overlay._showBanner = vi.fn();
    overlay.refresh = vi.fn();
    overlay._showWeaponArtSlotPicker = vi.fn((weapon, art, onSelect) => onSelect(null));

    overlay._useTeamScroll(unit, rm.scrolls[0]);

    expect(rm.scrolls).toHaveLength(1);
    expect(sword.weaponArtIds).toEqual(['legend_gemini_tempest', 'sword_comet_edge', 'custom_art_b']);
    expect(sword.weaponArtSources).toEqual(['innate', 'scroll', 'scroll']);
    expect(sword.weaponArtId).toBe('legend_gemini_tempest');
    expect(sword.weaponArtSource).toBe('innate');
  });

  it('replaces only the selected slot and preserves other arts in insertion order', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const sword = structuredClone(gameData.weapons.find(w => w.type === 'Sword' && w.name === 'Iron Sword'));
    sword.weaponArtIds = ['legend_gemini_tempest', 'sword_comet_edge', 'custom_art_b'];
    sword.weaponArtSources = ['innate', 'scroll', 'scroll'];
    sword.weaponArtId = 'legend_gemini_tempest';
    sword.weaponArtSource = 'innate';
    unit.inventory = [sword];
    unit.weapon = sword;

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
      weaponArts: gameData.weaponArts || { arts: [] },
    });

    const plan = overlay._planWeaponArtScrollApply(
      sword,
      { id: 'sword_precise_cut', name: 'Precise Cut' },
      1
    );

    expect(plan.ok).toBe(true);
    expect(plan.overwritten).toEqual({ id: 'sword_comet_edge', source: 'scroll' });
    overlay._writeWeaponArtBindings(sword, plan.nextBindings);
    expect(sword.weaponArtIds).toEqual(['legend_gemini_tempest', 'sword_precise_cut', 'custom_art_b']);
    expect(sword.weaponArtSources).toEqual(['innate', 'scroll', 'scroll']);
  });
  it('recomputes plan at commit time to avoid stale overwrite state', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const sword = structuredClone(gameData.weapons.find(w => w.type === 'Sword' && w.name === 'Iron Sword'));
    sword.weaponArtIds = ['legend_gemini_tempest', 'custom_art_a', 'custom_art_b'];
    sword.weaponArtSources = ['innate', 'scroll', 'scroll'];
    sword.weaponArtId = 'legend_gemini_tempest';
    sword.weaponArtSource = 'innate';
    unit.inventory = [sword];
    unit.weapon = sword;
    unit.skills = unit.skills || [];

    const scroll = {
      name: 'Precise Cut Scroll',
      teachesWeaponArtId: 'sword_precise_cut',
      allowedWeaponTypes: ['Sword'],
    };
    rm.scrolls = [scroll];

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
      weaponArts: gameData.weaponArts || { arts: [] },
    });
    overlay.scene.registry = { get: () => null };
    overlay._showBanner = vi.fn();
    overlay.refresh = vi.fn();

    const art = { id: 'sword_precise_cut', name: 'Precise Cut', weaponType: 'Sword', requiredRank: 'Prof' };
    const stalePlan = overlay._planWeaponArtScrollApply(sword, art, 0);
    expect(stalePlan.ok).toBe(true);

    // Simulate state drift while overwrite confirm is open.
    sword.weaponArtIds = ['legend_gemini_tempest', 'custom_art_a', 'custom_art_z'];
    sword.weaponArtSources = ['innate', 'scroll', 'scroll'];
    sword.weaponArtId = 'legend_gemini_tempest';
    sword.weaponArtSource = 'innate';

    const committed = overlay._commitWeaponArtScrollApply(unit, scroll, sword, art, stalePlan, 0);

    expect(committed).toBe(true);
    expect(rm.scrolls).toHaveLength(0);
    expect(sword.weaponArtIds).toEqual(['sword_precise_cut', 'custom_art_a', 'custom_art_z']);
    expect(sword.weaponArtSources).toEqual(['scroll', 'scroll', 'scroll']);
    expect(sword.weaponArtId).toBe('sword_precise_cut');
    expect(sword.weaponArtSource).toBe('scroll');
  });
  it('takes a consumable from convoy into roster via take action', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const unit = rm.roster[0];
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    unit.inventory = [];
    unit.consumables = [];
    unit.skills = unit.skills || [];
    rm.addToConvoy(vuln);
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });
    const actions = [];
    overlay._actionBtn = (x, y, label, onClick) => {
      actions.push({ label, onClick });
      return makeDisplayObject();
    };

    overlay.select('convoy');
    overlay.drawUnitDetails();
    const takeAction = actions.find(a => a.label === '[ Withdraw ]');
    expect(takeAction).toBeTruthy();
    takeAction.onClick();

    expect(unit.consumables).toHaveLength(1);
    expect(unit.consumables[0].name).toBe('Vulnerary');
    expect(rm.getConvoyCounts().consumables).toBe(0);
  });

  it('does not crash convoy detail when roster is empty', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    rm.roster = [];
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    rm.addToConvoy(vuln);

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });

    overlay.select('convoy');
    expect(() => overlay.drawUnitDetails()).not.toThrow();
  });

  it('show/hide is safe when scene input plugins are unavailable', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });

    expect(() => overlay.show()).not.toThrow();
    expect(() => overlay.hide()).not.toThrow();
  });

  it('keeps convoy entry visible and selectable for roster sizes 0 through 14', () => {
    for (let size = 0; size <= 14; size++) {
      const rm = new RunManager(gameData);
      rm.startRun();
      seedRoster(rm, size);

      const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
        lords: gameData.lords || [],
        classes: gameData.classes || [],
        skills: gameData.skills || [],
        accessories: gameData.accessories || [],
      });

      overlay.drawUnitList();
      const clickableRows = overlay.objects.filter((obj) =>
        obj?._rosterList && obj?._interactive && obj.handlers?.pointerdown
      );
      expect(clickableRows.length).toBeGreaterThan(0);

      const convoyRow = clickableRows.reduce((best, row) => (!best || row.y > best.y ? row : best), null);
      expect(convoyRow).toBeTruthy();
      expect(convoyRow.y - (convoyRow.height / 2)).toBeGreaterThanOrEqual(50);
      expect(convoyRow.y + (convoyRow.height / 2)).toBeLessThanOrEqual(462);

      const convoyText = overlay.objects.find((obj) => obj?._rosterList && obj.text === 'Convoy Management');
      expect(convoyText).toBeTruthy();

      convoyRow.handlers.pointerdown();
      expect(overlay.selection.kind).toBe('convoy');
    }
  });

  it('shows weapon-art unlock banner after act transition', () => {
    const ctx = {
      runManager: {
        isActComplete: () => true,
        isRunComplete: () => false,
        advanceAct: () => ['sword_precise_cut'],
      },
      gameData: {
        weaponArts: { arts: [{ id: 'sword_precise_cut', name: 'Precise Cut' }] },
      },
      drawMap: vi.fn(),
      showActCompleteBanner: (onComplete) => { if (onComplete) onComplete(); },
      showShopBanner: vi.fn(),
      showWeaponArtsUnlockedBanner: NodeMapScene.prototype.showWeaponArtsUnlockedBanner,
    };

    NodeMapScene.prototype.checkActComplete.call(ctx);

    expect(ctx.drawMap).toHaveBeenCalled();
    expect(ctx.showShopBanner).toHaveBeenCalledWith('Weapon Art unlocked: Precise Cut', '#88ddff');
  });

  it('does not fire onClose during initial show', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const onClose = vi.fn();
    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    }, { onClose });

    overlay.show();
    expect(onClose).not.toHaveBeenCalled();

    overlay.hide();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clamps convoy scroll offset after convoy content shrinks', () => {
    const rm = new RunManager(gameData);
    rm.startRun();
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    const ironSword = gameData.weapons.find(w => w.name === 'Iron Sword');
    const unit = rm.roster[0];
    unit.inventory = [];
    unit.consumables = [];

    for (let i = 0; i < 60; i++) {
      rm.addToConvoy(vuln);
    }
    rm.addToConvoy(ironSword);

    const overlay = new RosterOverlay(makeRosterSceneStub(), rm, {
      lords: gameData.lords || [],
      classes: gameData.classes || [],
      skills: gameData.skills || [],
      accessories: gameData.accessories || [],
    });

    overlay.select('convoy');
    overlay._convoyScrollOffset = 2000;
    overlay.drawUnitDetails();
    const beforeMax = overlay._convoyScrollMax;
    expect(beforeMax).toBeGreaterThan(0);
    expect(overlay._convoyScrollOffset).toBeLessThanOrEqual(beforeMax);

    while (rm.convoy.consumables.length > 0) {
      const pulled = rm.takeFromConvoy('consumable', 0);
      if (!pulled) break;
      unit.consumables.push(pulled);
      unit.consumables = [];
    }
    while (rm.convoy.weapons.length > 0) {
      const pulled = rm.takeFromConvoy('weapon', 0);
      if (!pulled) break;
      unit.inventory.push(pulled);
      unit.inventory = [];
    }

    overlay.drawUnitDetails();
    expect(overlay._convoyScrollMax).toBe(0);
    expect(overlay._convoyScrollOffset).toBe(0);
  });
});
