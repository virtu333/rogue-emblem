// The shop's Wake button for an NG+ kept weapon's sleeping forges (docs/specs/ng-plus.md §13.1),
// played through the real ShopMenu with the journey harness. The ways it can fail: a kept weapon at
// the forge cap vanishes from the forge tab, the button charges a different price than the confirm,
// a wake spends a forge use (or the forge spends a wake), the shop's wakes reset on a reload, or
// the button stays live past the act's limit.
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { loadRun } from '../src/engine/RunManager.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { lullForges } from '../src/engine/KeptForges.js';

let d;
let weapon;
const nodes = () => d.menu.surface.body.all();
const text = () => nodes().map((n) => n.textContent).join(' | '); // prettier-ignore
const button = (label) =>
  nodes().find(
    (n) =>
      n.tag === 'button' &&
      (label instanceof RegExp ? label.test(n.textContent) : n.textContent === label),
  );
function openForge() {
  d.scene.activeShopTab = 'forge';
  d.menu.selected = weapon;
  d.menu.render();
}
function confirmWake() {
  button(/^Wake/).onclick();
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
  const owner = d.run.roster[0];
  // A Steel Sword forged +7 (might, hit, crit, ...), with all but 2 asleep as an NG+ Act I start.
  weapon = { ...structuredClone(d.data.weapons.find((w) => w.name === 'Steel Sword')), uid: 'wk1' };
  for (const stat of ['might', 'hit', 'crit', 'might', 'hit', 'crit', 'might'])
    applyForge(weapon, stat, 0, { free: true });
  lullForges(weapon, 2);
  owner.inventory = [weapon];
  owner.weapon = weapon;
  d.run.gold = 5000;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows the sleeping forges and a Wake button priced as the next forge', () => {
  openForge();
  expect(text()).toContain('5 kept forges sleeping · 2 of 2 shop wakes left.');
  // The next is crit, its first: 300 G on a Steel weapon.
  const wake = button('Wake +5 Crit · 300 G');
  expect(wake).toBeTruthy();
  expect(wake.disabled).toBe(false);
});

it('a wake spends its price and a shop wake, never a forge use, and is saved with the shop', () => {
  openForge();
  const might = weapon.might;
  const crit = weapon.crit;
  const gold = d.run.gold;
  button(/^Wake/).onclick();
  expect(d.menu.child.options.title).toBe(`Wake a forge on ${weapon.name}?`);
  expect(d.menu.child.options.describe(true)).toContain('+5 Crit wakes now');
  expect(d.menu.child.options.describe(true)).toContain('300 gold');
  expect(d.menu.child.options.apply(true).ok).toBe(true);
  d.menu.child?.close?.();
  d.menu.render();
  expect(d.run.gold).toBe(gold - 300);
  expect(weapon.crit).toBe(crit + 5);
  expect(weapon.might).toBe(might);
  expect(d.scene.shopWakesUsed).toBe(1);
  expect(d.scene.shopForgesUsed || 0).toBe(0);
  expect(text()).toContain('4 kept forges sleeping · 1 of 2 shop wakes left.');
  d.assertPersisted('wake');
  const saved = loadRun(d.data, 1);
  expect(Object.values(saved.shopStateByNodeId).some((s) => s.wakesUsed === 1)).toBe(true);
});

it('stops at the act’s limit and says so', () => {
  openForge();
  expect(confirmWake().ok).toBe(true);
  expect(confirmWake().ok).toBe(true);
  expect(button(/^Wake/).disabled).toBe(true);
  expect(text()).toContain('No wakes remain at this shop.');
  expect(text()).toContain('3 kept forges sleeping · 0 of 2 shop wakes left.');
});

it('a second confirmation of the same wake cannot wake two forges', () => {
  openForge();
  button(/^Wake/).onclick();
  const apply = d.menu.child.options.apply;
  expect(apply(true).ok).toBe(true);
  const gold = d.run.gold;
  expect(apply(true).ok).toBe(false);
  expect(d.run.gold).toBe(gold);
  expect(d.scene.shopWakesUsed).toBe(1);
});

it('names the gold missing when the purse is short', () => {
  d.run.gold = 100;
  openForge();
  expect(button(/^Wake/).disabled).toBe(true);
  expect(text()).toContain('Not enough gold: 200 G short.');
});

it("a full weapon's forge picker puts the wake on its own note line", () => {
  // Failure: the wake is buried in one long run-on line (Jeff missed it), or a stat that would
  // add a new forge is told it wakes one.
  for (const stat of ['hit', 'crit', 'might', 'hit', 'crit', 'might', 'hit', 'weight'])
    applyForge(weapon, stat, 0, { free: true });
  lullForges(weapon, 2);
  openForge();
  button('Choose forge').onclick();
  const describe = d.menu.child.options.describe;
  const notes = (stat) =>
    describe({ key: stat })
      .all()
      .filter((n) => n.classList.contains('row-line--note'))
      .map((n) => n.textContent);
  expect(notes('weight')).toEqual([
    'Already 15/15 · wakes a sleeping Weight forge now (no new forge)',
  ]);
  const lines = describe({ key: 'weight' })
    .all()
    .filter((n) => n.classList.contains('row-line'));
  expect(lines).toHaveLength(2);
});
