// Closing the iPhone app: backgrounding (visibilitychange → hidden, pagehide,
// Capacitor App pause) persists what the player just did, and a reload finds
// it intact. The native-mirror case fakes the Capacitor bridge + Filesystem
// plugin and then evicts localStorage the way iOS can under storage pressure.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test.setTimeout(120_000);
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15_000);
  // Source edits by other work must not make Vite refresh a save test.
  await page.routeWebSocket(/^ws:\/\/(?:127\.0\.0\.1|localhost):\d+/, (socket) => socket.close());
});

async function attachSlot(page) {
  await page.evaluate(async () => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
  });
}

/** What iOS does when the app leaves the foreground (no reload). */
async function background(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
  });
}

const savedRun = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run') || 'null'));

async function relaunch(page, { battle = false } = {}) {
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  await page.waitForTimeout(1300);
  const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
  await expect(slots).toBeEnabled();
  await slots.tap();
  await waitForScene(page, 'SlotPicker');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  if (battle) await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await waitForScene(page, battle ? 'Battle' : 'NodeMap');
}

async function openRouteMap(page) {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await attachSlot(page);
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').persistRunSave());
}

test('route map: state still only in memory is saved when the app is backgrounded', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openRouteMap(page);
  const gold = await page.evaluate(() => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    rm.gold += 777; // stands in for any change not yet written
    return rm.gold;
  });
  expect((await savedRun(page)).gold).toBe(gold - 777);
  await background(page);
  expect((await savedRun(page)).gold).toBe(gold);
  await relaunch(page);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.gold),
  ).toBe(gold);
  expect(errors).toEqual([]);
});

test('roster sheet: an accessory change is saved before the sheet closes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openRouteMap(page);
  const { unitName, accessory } = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const item = structuredClone(s.gameData.accessories.find((a) => a.combatEffects));
    s.runManager.accessories = [item];
    for (const unit of s.runManager.roster) unit.accessory = null;
    s.persistRunSave();
    return { unitName: s.runManager.roster[0].name, accessory: item.name };
  });
  await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.locator('.mr-sheet');
  await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await roster.getByRole('button', { name: 'Equip accessory', exact: true }).first().tap();
  // Saved as it applied — the sheet is still open.
  await expect(roster).toBeVisible();
  const saved = await savedRun(page);
  expect(saved.roster.find((u) => u.name === unitName).accessory?.name).toBe(accessory);
  expect(saved.accessories).toEqual([]);
  await background(page);
  await relaunch(page);
  const after = await page.evaluate(
    (name) =>
      window.__emblemRogueGame.scene
        .getScene('NodeMap')
        .runManager.roster.find((u) => u.name === name)?.accessory?.name,
    unitName,
  );
  expect(after).toBe(accessory);
  expect(errors).toEqual([]);
});

test('shop: a purchase survives backgrounding mid-visit and a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openRouteMap(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.runManager.gold = 5000;
    const n = s.runManager.getAvailableNodes()[0];
    n.type = 'shop';
    n.isAmbush = false;
    window.shopNodeId = n.id;
    s.onNodeClick(n);
  });
  const shop = page.getByRole('dialog', { name: 'Village', exact: true });
  await expect(shop).toBeVisible();
  const vulnerary = shop.locator('.shop-stock button', { hasText: 'Vulnerary' }).first();
  await vulnerary.tap();
  await shop.getByRole('button', { name: /^Buy · \d+ G$/ }).tap();
  const picker = page.getByRole('dialog', { name: /^Give Vulnerary to$/ });
  await picker.getByRole('button', { name: /^Convoy/ }).tap();
  await picker.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await expect(picker).toHaveCount(0);
  const before = await page.evaluate(() => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    return {
      gold: rm.gold,
      convoy: rm.convoy.consumables.map((c) => c.name),
      stock: rm.getShopState(window.shopNodeId),
      currentNodeId: rm.currentNodeId,
    };
  });
  expect(before.gold).toBeLessThan(5000);
  expect(before.convoy).toContain('Vulnerary');
  await background(page);
  const saved = await savedRun(page);
  expect(saved.gold).toBe(before.gold);
  await relaunch(page);
  const after = await page.evaluate((nodeId) => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    return {
      gold: rm.gold,
      convoy: rm.convoy.consumables.map((c) => c.name),
      stock: rm.getShopState(nodeId),
      currentNodeId: rm.currentNodeId,
    };
  }, before.currentNodeId);
  expect(after).toEqual(before);
  expect(errors).toEqual([]);
});

test('battle: an action taken before backgrounding is there after a reload', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await attachSlot(page);
  const acted = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s._captureSuspendCheckpoint();
    const unit = s.playerUnits[0];
    s.selectUnit(unit);
    s.finishUnitAction(unit, { skipCanto: true }); // Wait in place: a completed action
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { name: unit.name, col: unit.col, row: unit.row, hasActed: unit.hasActed };
  });
  expect(acted.hasActed).toBe(true);
  await background(page);
  await relaunch(page, { battle: true });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  const resumed = await page.evaluate((name) => {
    const u = window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.find((unit) => unit.name === name);
    return { name: u.name, col: u.col, row: u.row, hasActed: u.hasActed };
  }, acted.name);
  expect(resumed).toEqual(acted);
  expect(errors).toEqual([]);
});

// Fake Capacitor bridge: PluginHeaders + nativePromise/addListener, with a
// Filesystem whose files persist across reloads in sessionStorage. When
// `__evictOnLoad` is set, localStorage is wiped before the app starts — iOS
// evicting the WebKit store while the app was closed.
const FAKE_NATIVE = () => {
  const FS_KEY = '__fakeNativeFs';
  const read = () => JSON.parse(sessionStorage.getItem(FS_KEY) || '{}');
  const write = (files) => sessionStorage.setItem(FS_KEY, JSON.stringify(files));
  if (sessionStorage.getItem('__evictOnLoad') === '1') {
    sessionStorage.removeItem('__evictOnLoad');
    localStorage.clear();
  }
  const listeners = [];
  window.__fakeNativeListeners = listeners;
  window.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    PluginHeaders: [
      { name: 'Filesystem', methods: [] },
      { name: 'App', methods: [] },
    ],
    addListener(plugin, eventName, callback) {
      const entry = { plugin, eventName, callback };
      listeners.push(entry);
      return { remove: async () => listeners.splice(listeners.indexOf(entry), 1) };
    },
    nativePromise(plugin, method, options = {}) {
      if (plugin !== 'Filesystem') return Promise.reject(new Error('not implemented'));
      const files = read();
      if (method === 'readdir') {
        const prefix = `${options.path}/`;
        return Promise.resolve({
          files: Object.keys(files)
            .filter((p) => p.startsWith(prefix))
            .map((p) => ({ name: p.slice(prefix.length), type: 'file' })),
        });
      }
      if (method === 'readFile')
        return options.path in files
          ? Promise.resolve({ data: files[options.path] })
          : Promise.reject(new Error('File does not exist.'));
      if (method === 'writeFile') {
        files[options.path] = options.data;
        write(files);
        window.__fakeNativeWrites = (window.__fakeNativeWrites || 0) + 1;
        return Promise.resolve({ uri: options.path });
      }
      return Promise.reject(new Error(`unexpected ${method}`));
    },
  };
  window.__fakeCapFire = (plugin, eventName, data) => {
    for (const l of listeners)
      if (l.plugin === plugin && l.eventName === eventName) l.callback(data);
  };
};

test('iOS: saves mirrored to native storage come back after WebKit storage is evicted', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(FAKE_NATIVE);
  await openRouteMap(page);
  // The App plugin pause event is wired.
  expect(
    await page.evaluate(() =>
      window.__fakeNativeListeners.map((l) => `${l.plugin}.${l.eventName}`).sort(),
    ),
  ).toEqual(['App.appStateChange', 'App.pause']);
  const gold = await page.evaluate(() => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    rm.gold += 4321;
    return rm.gold;
  });
  // App pause: the route state is saved and the mirror write dispatched.
  await page.evaluate(() => window.__fakeCapFire('App', 'pause'));
  await expect
    .poll(() =>
      page.evaluate(() => {
        const files = JSON.parse(sessionStorage.getItem('__fakeNativeFs') || '{}');
        return Object.entries(files)
          .filter(([name]) => name.includes('emblem_rogue_slot_1_run'))
          .map(([, text]) => JSON.parse(text.slice(text.indexOf('\n') + 1)).gold);
      }),
    )
    .toContain(gold);
  // iOS purges the WebKit store while the app is closed.
  await page.evaluate(() => sessionStorage.setItem('__evictOnLoad', '1'));
  await relaunch(page);
  const restored = await page.evaluate(() => ({
    gold: window.__emblemRogueGame.scene.getScene('NodeMap').runManager.gold,
    sentinel: localStorage.getItem('emblem_rogue_storage_sentinel') !== null,
  }));
  expect(restored).toEqual({ gold, sentinel: true });
  expect(errors).toEqual([]);
});
