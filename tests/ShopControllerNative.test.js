import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { InputAction } from '../src/utils/InputActions.js';
import { getForgeCost } from '../src/engine/ForgeSystem.js';
import { AMBUSH_SHOP_DISCOUNT } from '../src/utils/constants.js';
import { showMinorHint } from '../src/ui/HintDisplay.js';
let d;
beforeEach(async () => {
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
  d = new RunDriver(storage);
  await d.step({ type: 'enter', service: 'shop' });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('keyboard and controller tab changes route through the same native menu', () => {
  const menu = d.shop.nativeMenu;
  expect(menu.surface.onKey({ key: 'ArrowRight' })).toBe(true);
  expect(d.scene.activeShopTab).toBe('sell');
  expect(menu.surface.onAction(InputAction.NAVIGATE, { dx: 1 })).toBe(true);
  expect(d.scene.activeShopTab).toBe('forge');
  expect(menu.surface.onKey({ key: 'ArrowRight', metaKey: true })).toBe(false);
  expect(d.scene.activeShopTab).toBe('forge');
});
it('restock Back changes nothing; confirm spends once and persists', async () => {
  const gold = d.run.gold;
  await d.step({ type: 'press', label: /^Restock ·/ });
  const apply = d.shop.nativeMenu.child.options.apply;
  await d.step({ type: 'back' });
  expect(d.run.gold).toBe(gold);
  await d.step({ type: 'press', label: /^Restock ·/ });
  await d.step({ type: 'confirm', index: 0 });
  expect(d.run.gold).toBeLessThan(gold);
  const after = d.run.gold;
  expect(apply().ok).toBe(false);
  expect(d.run.gold).toBe(after);
  d.assertPersisted('restock');
});
it('forge displays the same stacked-discount price charged and rejects a stale second apply', () => {
  d.scene._currentShopHasAmbushDiscount = true;
  vi.spyOn(d.run, 'getForgeCostDiscount').mockReturnValue(0.2);
  const menu = d.shop.nativeMenu,
    weapon = d.run.roster[0].weapon;
  menu.forge(weapon);
  const options = menu.child.options,
    stat = options.choices[0];
  const cost = Math.max(1, Math.floor(getForgeCost(weapon, stat.key) * 0.8 * AMBUSH_SHOP_DISCOUNT));
  expect(options.describe(stat)).toContain(`${cost} gold`);
  const gold = d.run.gold;
  expect(options.apply(stat).ok).toBe(true);
  expect(d.run.gold).toBe(gold - cost);
  expect(options.apply(stat).ok).toBe(false);
  expect(d.scene.shopForgesUsed).toBe(1);
  d.assertPersisted('discounted forge');
});
it('previewing an unaffordable item retains details and blocks recipient confirmation', () => {
  d.run.gold = 0;
  const menu = d.shop.nativeMenu,
    entry = { type: 'weapon', item: structuredClone(d.run.roster[0].weapon), price: 100 };
  d.scene.shopBuyItems = [entry];
  menu.buy(entry);
  expect(menu.child.options.blocked(d.run.roster[0])).toBeTruthy();
  expect(menu.child.options.apply(d.run.roster[0]).ok).toBe(false);
  expect(d.run.gold).toBe(0);
});
it('notices outside the shop still use the shared hint channel', () => {
  d.shop.closeShopOverlay();
  d.shop.showShopBanner('Act unlocked');
  expect(showMinorHint).toHaveBeenCalledWith(d.scene, 'Act unlocked');
});

it.each(['weapon', 'consumable'])(
  'native %s purchase handles full bags, failed spend and failed convoy delivery',
  (type) => {
    const menu = d.shop.nativeMenu,
      unit = d.run.roster[0];
    const item = structuredClone(
      type === 'weapon' ? unit.weapon : d.data.consumables.find((i) => i.name === 'Vulnerary'),
    );
    const field = type === 'weapon' ? 'inventory' : 'consumables';
    unit[field] = Array.from({ length: type === 'weapon' ? 5 : 3 }, () => structuredClone(item));
    const entry = { type, item, price: 100 };
    d.scene.shopBuyItems = [entry];
    menu.buy(entry);
    const options = menu.child.options;
    expect(options.describe(unit)).toContain('Full: sent to convoy');
    const gold = d.run.gold;
    const spend = vi.spyOn(d.run, 'spendGold').mockReturnValueOnce(false);
    expect(options.apply(unit).ok).toBe(false);
    expect(d.run.gold).toBe(gold);
    expect(d.scene.shopBuyItems).toContain(entry);
    spend.mockRestore();
    const deliver = vi.spyOn(d.run, 'addToConvoy').mockReturnValueOnce(false);
    expect(options.apply(unit).ok).toBe(false);
    expect(d.run.gold).toBe(gold);
    expect(d.scene.shopBuyItems).toContain(entry);
    deliver.mockRestore();
    expect(options.apply(unit).ok).toBe(true);
    expect(menu.status).toContain('Convoy');
    expect(d.run.gold).toBe(gold - 100);
    expect(d.scene.shopBuyItems).not.toContain(entry);
    d.assertPersisted('overflow purchase');
  },
);
it.each(['scroll', 'accessory'])('native %s purchase identifies the correct team pool', (type) => {
  const item = structuredClone(
    type === 'scroll' ? d.data.weapons.find((i) => i.type === 'Scroll') : d.data.accessories[0],
  );
  const entry = { type, item, price: 100 };
  d.scene.shopBuyItems = [entry];
  const menu = d.shop.nativeMenu;
  menu.buy(entry);
  expect(menu.child.options.apply(type === 'accessory' ? 'pool' : true).ok).toBe(true);
  expect(menu.status).toContain(type === 'scroll' ? 'Scroll pool' : 'Accessory pool');
  d.assertPersisted('pool purchase');
});
it('shop entry flavor appears in the native status region', () => {
  d.scene.gameData = {
    ...d.data,
    dialogue: { shopFlavor: { act1: ['Merchant eyes your purse.'] } },
  };
  d.shop.showShopOverlay(d.node('shop'), d.scene.shopBuyItems);
  expect(d.shop.nativeMenu.status).toBe('Merchant eyes your purse.');
});

it('leaving keeps shop stock and costs durable for re-entry without moving the route', () => {
  const node = d.scene._shopNode;
  d.scene.shopBuyItems.splice(0, 1);
  d.scene.shopForgesUsed = 1;
  d.scene.shopRerollCount = 2;
  d.shop.leaveShopNode();
  expect(d.run.canReenterShop(node.id)).toBe(true);
  const saved = d.run.getShopState(node.id);
  expect(saved.forgesUsed).toBe(1);
  expect(saved.rerollCount).toBe(2);
  d.assertPersisted('shop leave with retained stock');
  d.shop.handleShop(node);
  expect(d.scene.shopBuyItems.map(({ index, ...entry }) => entry)).toEqual(saved.items);
  expect(d.scene.shopRerollCount).toBe(2);
  expect(d.scene.shopForgesUsed).toBe(1);
  d.shop.leaveShopNode();
  expect(d.run.currentNodeId).toBe(node.id);
  d.run.currentNodeId = 'another-node';
  expect(d.run.canReenterShop(node.id)).toBe(false);
});

it('ruins stock, prices and visit limits survive leave, reload and re-entry', () => {
  const node = d.node('shop');
  node.type = 'ruins';
  d.scene.handleRuins = (n) => d.church.handleRuins(n);
  d.shop.closeShopOverlay();
  d.run.clearShopState(node.id);
  d.shop.handleShop(node, { ruins: true });
  d.scene.shopBuyItems.splice(0, 1);
  d.scene.shopForgesUsed = 1;
  d.scene.shopRerollCount = 2;
  const gold = d.run.gold;
  d.shop.leaveShopNode();
  d.church.leaveChurchNode();
  const saved = d.run.getShopState(node.id);
  expect(d.run.canReenterService(node.id)).toBe(true);
  const restored = d.run.constructor.fromJSON(d.run.toJSON(), d.data);
  d.run = restored;
  d.bindScene();
  d.shop.handleShop(
    restored.nodeMap.nodes.find((n) => n.id === node.id),
    { ruins: true },
  );
  expect(d.scene.shopBuyItems.map(({ index, ...entry }) => entry)).toEqual(saved.items);
  expect(d.scene.shopForgesUsed).toBe(1);
  expect(d.scene.shopRerollCount).toBe(2);
  expect(restored.gold).toBe(gold);
  restored.battleInProgress = true;
  expect(restored.canReenterService(node.id)).toBe(false);
  restored.battleInProgress = false;
  restored.currentNodeId = 'next';
  expect(restored.canReenterService(node.id)).toBe(false);
});

it('shop scroll headers do not imply a weapon rank requirement', () => {
  const item = structuredClone(d.data.weapons.find((i) => i.name === 'Sol Scroll'));
  expect(item.rankRequired).toBe('Prof');
  d.scene.shopBuyItems = [{ type: 'scroll', item, price: 100 }];
  d.shop.nativeMenu.render();
  const text = d.shop.nativeMenu.surface.body
    .all()
    .map((n) => n.textContent)
    .join(' ');
  expect(text).toContain('Sol Scroll');
  expect(text).not.toContain('Requires Prof');
});

it('all forge stat choices preview the wielder’s resulting combat numbers', () => {
  const owner = d.run.roster[0];
  owner.stats = { ...owner.stats, STR: 7, MAG: 2, SPD: 10, SKL: 8, LCK: 3 };
  const w = {
    ...d.data.weapons.find((w) => w.name === 'Steel Sword'),
    might: 8,
    hit: 80,
    crit: 0,
    weight: 10,
  };
  owner.inventory = [w];
  owner.weapon = w;
  d.shop.nativeMenu.forge(w);
  const options = d.shop.nativeMenu.child.options;
  const text = Object.fromEntries(
    options.choices.map((stat) => [stat.key, options.describe(stat)]),
  );
  expect(text.might).toContain('Attack 15 → 16');
  expect(text.hit).toContain('Hit 99 → 104');
  expect(text.crit).toContain('Crit 4 → 9');
  expect(text.weight).toContain('AS 1 → 2');
});
