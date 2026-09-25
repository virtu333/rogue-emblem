// Item art wiring through the shipping service menus (rendering-only journey adapters):
// every shop row carries its item's icon, the detail carries the hero, and each service
// shows its place. The headed e2e (tests/e2e/item-art.spec.js) owns layout and pixels.
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { itemIconId } from '../src/ui/itemIcons.js';

let d;
beforeEach(() => {
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
  d = new RunDriver(storage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const nodes = (menu, cls) =>
  menu.surface.body.all().filter((n) =>
    String(n?.className || '')
      .split(' ')
      .includes(cls),
  );

it('shop rows carry their item icons and the detail its hero; tabs pick the place', async () => {
  await d.step({ type: 'enter', service: 'shop' });
  const menu = d.shop.nativeMenu;
  const rows = nodes(menu, 'shop-row');
  expect(rows.length).toBe(d.scene.shopBuyItems.length);
  rows.forEach((row, i) => {
    const icon = row.children.find((c) => c.className === 'ia-icon');
    expect(icon.dataset.iconId).toBe(itemIconId(d.scene.shopBuyItems[i].item));
    expect(icon.dataset.iconId.startsWith('generic-')).toBe(false);
  });
  const hero = nodes(menu, 'ia-hero');
  expect(hero).toHaveLength(1);
  expect(hero[0].dataset.iconId).toBe(itemIconId(d.scene.shopBuyItems[0].item));
  expect(menu.surface.root.dataset.vignette).toBe('shop');
  expect(nodes(menu, 'ia-band')).toHaveLength(1);
  menu.surface.onKey({ key: 'ArrowRight' });
  menu.surface.onKey({ key: 'ArrowRight' });
  expect(d.scene.activeShopTab).toBe('forge');
  expect(menu.surface.root.dataset.vignette).toBe('forge');
});

it('church and ruins show their places', async () => {
  await d.step({ type: 'enter', service: 'church' });
  expect(d.church.nativeMenu.surface.root.dataset.vignette).toBe('church');
  d.church.showChurchOverlay(d.node('church'), { ruinsMode: true });
  expect(d.church.nativeMenu.surface.root.dataset.vignette).toBe('ruins');
});
