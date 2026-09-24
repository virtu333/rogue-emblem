import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { RunDriver, JourneyStorage } from './harness/RunDriver.js';
import { loadRun } from '../src/engine/RunManager.js';
let d;
beforeEach(() => {
  const storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  d = new RunDriver(storage);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('Church uses one native surface, replacing it without completing the visit', async () => {
  await d.step({ type: 'enter', service: 'church' });
  const controller = d.church;
  const first = controller.nativeMenu.surface;
  controller.showChurchOverlay(d.node('church'));
  expect(first.destroyed).toBe(true);
  expect(controller.nativeMenu.surface.destroyed).not.toBe(true);
  expect(d.node('church').completed).toBe(false);
  controller.destroy();
  expect(d.scene.churchOverlay).toBeNull();
  expect(d.node('church').completed).toBe(false);
});
it('Ruins offers wares without promotions; switching service does not complete the node', () => {
  const node = d.node('church');
  d.scene.handleShop = vi.fn();
  d.church.showChurchOverlay(node, { ruinsMode: true });
  const labels = d.church.nativeMenu.surface.body.all().map((n) => n.textContent);
  expect(labels.some((s) => s.startsWith('Promote'))).toBe(false);
  const browse = d.church.nativeMenu.surface.body
    .all()
    .find((n) => n.textContent === 'Browse wares');
  browse.onclick();
  expect(d.scene.handleShop).toHaveBeenCalledWith(node, { ruins: true });
  expect(node.completed).toBe(false);
  d.church.showChurchOverlay(node, { ruinsMode: true });
  d.church.nativeMenu.surface.onClose();
  expect(loadRun(d.data, 1).nodeMap.nodes.find((n) => n.id === node.id).completed).toBe(true);
});
it('native map-view visibility keeps status and restores the same visit', async () => {
  await d.step({ type: 'enter', service: 'church' });
  const menu = d.church.nativeMenu;
  menu.render('Retained notice');
  menu.setVisible(false);
  expect(menu.surface).toBeNull();
  menu.setVisible(true);
  expect(menu.surface.body.all().some((n) => n.textContent === 'Retained notice')).toBe(true);
  expect(d.node('church').completed).toBe(false);
});
