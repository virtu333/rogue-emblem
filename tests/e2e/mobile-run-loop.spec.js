import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

async function tapText(page, key, text) {
  await page.waitForFunction(
    ({ key, text }) => {
      const s = window.__emblemRogueGame.scene.getScene(key);
      const walk = (nodes) =>
        nodes.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
      return walk(s.children.list).some((o) => o.type === 'Text' && o.visible && o.text === text);
    },
    { key, text },
    { timeout: 10000 },
  );
  const point = await page.evaluate(
    ({ key, text }) => {
      const s = window.__emblemRogueGame.scene.getScene(key);
      const walk = (nodes) =>
        nodes.flatMap((o) => [o, ...(Array.isArray(o.list) ? walk(o.list) : [])]);
      const o = walk(s.children.list).find(
        (o) => o.type === 'Text' && o.visible && o.text === text,
      );
      const b = o.getBounds(),
        r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (b.centerX * r.width) / s.scale.width,
        y: r.y + (b.centerY * r.height) / s.scale.height,
      };
    },
    { key, text },
  );
  console.log('Tap', key, text);
  await page.touchscreen.tap(point.x, point.y);
}
async function enterNode(page, desired) {
  for (let i = 0; i < 12; i++) {
    const blocked = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      return !!(s._storyDialogueActive || s.dialogueOverlay?.visible);
    });
    if (!blocked) break;
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    if (await skip.isVisible()) await skip.tap();
    else await page.getByRole('button', { name: 'Continue', exact: true }).tap();
    await page.waitForTimeout(150);
  }

  await page.waitForFunction(
    () =>
      window.__emblemRogueGame.scene.getScene('NodeMap').runManager.getAvailableNodes().length > 0,
  );
  const nodeId = await page.evaluate((desired) => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const n =
      s.runManager.getAvailableNodes().find((n) => n.type === desired) ||
      s.runManager.getAvailableNodes()[0];
    n.type = desired;
    s.drawMap();
    return n.id;
  }, desired);
  await page.locator(`[data-node="${nodeId}"]`).tap();
  await page.getByRole('button', { name: 'Travel', exact: true }).tap();
}

test('touch run: loadout, battle action, rewards, shop, equipment, next battle and local resume', async ({
  page,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') console.log('GAME ERROR', m.text());
  });
  const errors = collectErrors(page);
  const external = [];
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (
      ['http:', 'https:'].includes(u.protocol) &&
      !['localhost', '127.0.0.1'].includes(u.hostname)
    ) {
      external.push(u.hostname);
      return route.abort();
    }
    return route.continue();
  });
  // Returning-player Home Base. Brand-new slots intentionally use the existing first-run fast path.
  await page.goto('/?devScene=homebase');
  await waitForGame(page);
  await waitForScene(page, 'HomeBase');
  // The dev launcher deliberately uses a sandbox meta key; attach this isolated
  // test's returning player to slot 1 so the real Continue UI can discover it.
  await page.evaluate(async () => {
    const g = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = g.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    g.registry.set('activeSlot', 1);
    setActiveSlot(1);
  });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Begin Run', exact: true }).tap();
  await waitForScene(page, 'DifficultySelect');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await waitForScene(page, 'BlessingSelect');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'No blessing', exact: true }).tap();
  await page.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  // Skip narrative/hint presentation so the test can deterministically reach combat.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.requestCancel({ allowPause: false });
  });
  await page.waitForTimeout(1000);
  await enterNode(page, 'battle');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(
      window.__emblemRogueGame.scene.getScene('Battle').battleState,
    ),
  );
  const deploy = page.getByRole('dialog', { name: 'Deploy units', exact: true });
  if (await deploy.isVisible()) {
    const confirm = deploy.getByRole('button', { name: 'Deploy', exact: true });
    if (await confirm.isDisabled())
      await deploy.locator('.re-party-row[aria-pressed="false"]').first().tap();
    await confirm.tap();
  }
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  // UI action follows the same selected-unit menu as a map tap; fixture skips pathfinding.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.selectUnit(s.playerUnits[0]);
    s.showActionMenu(s.playerUnits[0]);
  });
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Wait', exact: true })
    .tap();
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].hasActed,
      ),
    )
    .toBe(true);
  // Exercise the actual victory/reward/persistence pipeline, without replaying combat balance.
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  await page.waitForFunction(() => !!window.__emblemRogueGame.scene.getScene('Battle').lootGroup);
  await page.screenshot({ path: 'test-results/mobile-loop-rewards.png' });
  // Inspect a concrete item, enter its recipient picker, then return without claiming.
  const itemName = await page.evaluate(() => {
    const c = window.__emblemRogueGame.scene.getScene('Battle')._lootController;
    return c.mobileRewards.choices.find(
      (c) => c.item?.type === 'Consumable' && c.item.effect !== 'statBoost',
    )?.item.name;
  });
  if (itemName) {
    await page
      .getByRole('dialog', { name: 'Battle rewards' })
      .locator('.reward-card')
      // Bundled rewards render as "Name ×N" (e.g. Vulnerary ×3 since 2f1c0fe).
      .filter({
        has: page.getByText(
          new RegExp(`^${itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( ×\\d+)?$`),
        ),
      })
      .tap();
    await page.getByRole('button', { name: 'Choose reward', exact: true }).tap();
    await page
      .getByRole('dialog', { name: 'Battle rewards', exact: true })
      .getByRole('button', { name: 'Back', exact: true })
      .tap();
    await expect(page.getByRole('dialog', { name: 'Battle rewards' })).toBeVisible();
  }

  await expect(page.locator('#mobile-right-panel [data-action=roster]')).not.toBeVisible();
  await expect(page.locator('#mobile-left-panel [data-action=menu]')).not.toBeVisible();
  await page.getByRole('button', { name: /Take .* gold instead/ }).tap();
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(
      () => !!window.__emblemRogueGame.scene.getScene('Battle').settingsOverlay?.visible,
    ),
  ).toBe(false);
  await page.getByRole('button', { name: 'Take gold', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  await page.waitForTimeout(800);
  await enterNode(page, 'shop');
  await page.waitForFunction(
    () => !!window.__emblemRogueGame.scene.getScene('NodeMap').shopOverlay,
  );
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').isMobileInput),
  ).toBe(true);
  await expect(page.locator('.shop-menu')).toBeVisible();
  const tabSizes = await page
    .locator('.shop-tabs button')
    .evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().height));
  expect(tabSizes.every((height) => height >= 44)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-loop-shop.png' });
  const entry = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const e = s.shopBuyItems.find(
      (e) => e.price <= s.runManager.gold && !['accessory', 'scroll'].includes(e.type),
    );
    if (!e) return null;
    return {
      name: e.item.name,
      price: e.price,
    };
  });
  expect(entry).not.toBeNull();
  await page
    .locator('.shop-row')
    .filter({ has: page.getByText(entry.name, { exact: true }) })
    .tap();
  await page.locator('.shop-commit button').tap();
  await page
    .getByRole('dialog', { name: `Give ${entry.name} to`, exact: true })
    .getByRole('button', { name: 'Confirm', exact: true })
    .tap();
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          window.__emblemRogueGame.scene
            .getScene('NodeMap')
            .runManager.roster.some((u) =>
              [...u.inventory, ...(u.consumables || [])].some((i) => i.name === name),
            ),
        entry.name,
      ),
    )
    .toBe(true);
  await page.locator('.shop-menu').getByRole('button', { name: 'Leave', exact: true }).tap();
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._openRoster());
  const sheet = page.getByRole('dialog', { name: 'Manage roster' });
  await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
  await expect(sheet.getByRole('heading', { name: entry.name, exact: true }).first()).toBeVisible();
  await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
  await page.waitForTimeout(800);
  await enterNode(page, 'battle');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(
      window.__emblemRogueGame.scene.getScene('Battle').battleState,
    ),
  );
  const saved = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { saveRun, loadRun } = await import('/src/engine/RunManager.js');
    const result = saveRun(s.runManager, null, 1);
    const loaded = loadRun(s.gameData, 1);
    return {
      ok: result.ok,
      gold: loaded.gold,
      act: loaded.currentAct,
      roster: loaded.roster.map((u) => u.name),
    };
  });
  expect(saved.ok).toBe(true);
  await page.goto('/');
  await waitForScene(page, 'Title');
  const restored = await page.evaluate(async () => {
    const { loadRun } = await import('/src/engine/RunManager.js');
    const r = loadRun(window.__emblemRogueGame.scene.getScene('Title').gameData, 1);
    return { gold: r.gold, act: r.currentAct, roster: r.roster.map((u) => u.name) };
  });
  expect(restored).toEqual({ gold: saved.gold, act: saved.act, roster: saved.roster });
  await page.waitForTimeout(1300);
  await tapText(page, 'Title', 'SAVE SLOTS');
  await waitForScene(page, 'SlotPicker');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('SlotPicker').input.enabled,
  );
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await page.waitForTimeout(400);
  const suspended = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('SlotPicker');
    return s.sys.isActive() && !!s.nativeDialog;
  });
  if (suspended) await page.getByRole('button', { name: 'Resume Battle', exact: true }).tap();
  await page.waitForFunction(() => {
    const g = window.__emblemRogueGame;
    return g.scene.isActive('NodeMap') || g.scene.isActive('Battle');
  });
  const continued = await page.evaluate(() => {
    const g = window.__emblemRogueGame;
    const r = g.scene.getScene(g.scene.isActive('Battle') ? 'Battle' : 'NodeMap').runManager;
    return { gold: r.gold, act: r.currentAct, roster: r.roster.map((u) => u.name) };
  });
  expect(continued).toEqual(restored);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
