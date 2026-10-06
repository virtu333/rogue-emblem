// The Village forge tab and a worn weapon (docs/specs/worn-weapons.md), played through the
// real ShopMenu with the journey harness: Repair replaces the forge stats, shows its cost,
// disables when gold is short or the forge limit is spent, spends a forge use, and the
// weapon's displayed numbers change. The ways it can fail: the worn weapon vanishes from the
// forge tab (canForge is false for it), the button charges a different price than the
// confirm, a repair does not count against the shop's forge uses, the card keeps showing the
// old numbers, or a long name breaks the confirm.
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { applyWear } from '../src/engine/WeaponWear.js';
import { applyImbue, getImbueById } from '../src/engine/ImbueSystem.js';
import { SHOP_FORGE_LIMITS } from '../src/utils/constants.js';

let d;
let weapon;
let owner;
const nodes = () => d.menu.surface.body.all();
const text = () => nodes().map((n) => n.textContent).join(' | '); // prettier-ignore
const button = (label) =>
  nodes().find(
    (n) =>
      n.tag === 'button' &&
      (label instanceof RegExp ? label.test(n.textContent) : n.textContent === label),
  );
const rowText = (row) => row.all().map((n) => n.textContent).join(' '); // prettier-ignore
const forgeLimit = () =>
  SHOP_FORGE_LIMITS[d.run.currentAct] + (d.run.blessingRuntimeModifiers?.forgeLimitDelta || 0);
function openForge() {
  d.scene.activeShopTab = 'forge';
  d.menu.selected = weapon;
  d.menu.render();
}
function confirmRepair() {
  button(/^Repair/).onclick();
  const result = d.menu.child.options.apply(true);
  d.menu.child?.close?.();
  d.menu.render();
  return result;
}

beforeEach(async () => {
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
  d = new RunDriver(storage);
  await d.step({ type: 'enter', service: 'shop' });
  owner = d.run.roster[0];
  // A Steel Sword, so the base forge prices apply: might repair 200, hit repair 125.
  weapon = { ...structuredClone(d.data.weapons.find((w) => w.name === 'Steel Sword')), uid: 'wm1' };
  owner.inventory = [weapon];
  owner.weapon = weapon;
  applyWear(weapon, 'might');
  applyWear(weapon, 'hit');
  d.run.gold = 1000;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('lists the worn weapon on the forge tab with Repair and its cost instead of the forge choice', () => {
  openForge();
  const row = rowText(nodes().find((n) => n.classList.contains('shop-row')));
  expect(row).toContain('Steel Sword -2');
  expect(row).toContain('Worn 2/3');
  expect(button('Repair · 125 G')).toBeTruthy();
  expect(button('Choose forge')).toBeUndefined();
  // Named wear, by step, on the card.
  expect(text()).toContain('Worn 2/3 · Dulled −1 Might · Bent −5 Hit');
  expect(text()).toContain(`${forgeLimit()} of ${forgeLimit()} shop forges remaining.`);
});

it('a repair spends the cost and one forge use, mends the stat and updates the card', () => {
  const steel = d.data.weapons.find((w) => w.name === 'Steel Sword');
  openForge();
  expect(text()).toContain(`Might: ${steel.might - 1}`);
  expect(text()).toContain(`Hit: ${steel.hit - 5} `);
  const gold = d.run.gold;
  button('Repair · 125 G').onclick();
  // The confirm names the weapon and states the same price the button showed.
  expect(d.menu.child.options.title).toBe('Repair Steel Sword -2?');
  expect(d.menu.child.options.describe(true)).toContain('Bent: restores +5 Hit');
  expect(d.menu.child.options.describe(true)).toContain('125 gold and one shop forge');
  expect(d.menu.child.options.apply(true).ok).toBe(true);
  expect(d.run.gold).toBe(gold - 125);
  expect(d.scene.shopForgesUsed).toBe(1);
  expect(weapon.name).toBe('Steel Sword -1');
  expect(weapon.hit).toBe(steel.hit);
  d.assertPersisted('repair');
  d.menu.child?.close?.();
  d.menu.render();
  expect(text()).toContain(`Hit: ${steel.hit}`);
  expect(text()).toContain('Worn 1/3 · Dulled −1 Might');
  expect(button('Repair · 200 G')).toBeTruthy();
});

it('a second confirmation of the same repair cannot mend two steps', () => {
  openForge();
  button(/^Repair/).onclick();
  const apply = d.menu.child.options.apply;
  expect(apply(true).ok).toBe(true);
  const gold = d.run.gold;
  expect(apply(true).ok).toBe(false);
  expect(d.run.gold).toBe(gold);
  expect(d.scene.shopForgesUsed).toBe(1);
  expect(weapon.name).toBe('Steel Sword -1');
});

it('is disabled, with the gold missing named, when the purse is short', () => {
  d.run.gold = 100;
  openForge();
  expect(button('Repair · 125 G').disabled).toBe(true);
  expect(text()).toContain('Not enough gold: 25 G short.');
  d.run.gold = 125;
  d.menu.render();
  expect(button('Repair · 125 G').disabled).toBe(false);
});

it('is disabled when the shop has no forge uses left; a repair spends the same counter forging does', () => {
  const limit = forgeLimit();
  d.scene.shopForgesUsed = limit;
  openForge();
  expect(button(/^Repair/).disabled).toBe(true);
  expect(text()).toContain('No forges remain at this shop.');
  expect(text()).toContain(`0 of ${limit} shop forges remaining.`);
  d.scene.shopForgesUsed = limit - 1;
  d.menu.render();
  expect(button(/^Repair/).disabled).toBe(false);
  expect(confirmRepair().ok).toBe(true);
  expect(d.scene.shopForgesUsed).toBe(limit);
  expect(button(/^Repair/).disabled).toBe(true);
});

it('a fully repaired weapon returns to the forge list as a forge candidate', () => {
  openForge();
  expect(confirmRepair().ok).toBe(true);
  expect(confirmRepair().ok).toBe(true);
  expect(weapon.name).toBe('Steel Sword');
  expect(button('Choose forge')).toBeTruthy();
  expect(button(/^Repair/)).toBeUndefined();
});

it('the Ruins has no forge tab, so no repair there', () => {
  d.scene._currentShopIsRuins = true;
  expect(d.shop._getShopTabs().map((t) => t.key)).toEqual(['buy', 'sell']);
});

it('a long imbued, worn name reads whole in the row, the card and the confirm', () => {
  applyImbue(weapon, getImbueById(d.data.imbues, 'vampiric'));
  applyWear(weapon, 'weight');
  const long = 'Vampiric Steel Sword -3';
  expect(weapon.name).toBe(long);
  openForge();
  const row = rowText(nodes().find((n) => n.classList.contains('shop-row')));
  expect(row).toContain(long);
  expect(text()).toContain('Worn 3/3 · Dulled −1 Might · Bent −5 Hit · Rusted +1 Weight');
  button(/^Repair/).onclick();
  expect(d.menu.child.options.title).toBe(`Repair ${long}?`);
  expect(d.menu.child.options.apply(true).ok).toBe(true);
  expect(weapon.name).toBe('Vampiric Steel Sword -2');
});
