import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('leave and re-enter current shop retains stock, costs and route position', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const n = s.runManager.getAvailableNodes()[0];
    n.type = 'shop';
    n.isAmbush = false;
    window.shopNodeId = n.id;
    s.onNodeClick(n);
  });
  const shop = page.getByRole('dialog', { name: 'Village', exact: true });
  await expect(shop).toBeVisible();
  const before = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.shopBuyItems.splice(0, 1);
    s.shopRerollCount = 2;
    s.shopForgesUsed = 1;
    s._shopController.refreshShop();
    return { stock: s.runManager.getShopState(window.shopNodeId), gold: s.runManager.gold };
  });
  await shop.getByRole('button', { name: 'Leave', exact: true }).tap();
  await page
    .getByRole('button', { name: /^Village ·/ })
    .first()
    .tap();
  await page.getByRole('button', { name: 'Re-enter shop', exact: true }).tap();
  await expect(shop).toBeVisible();
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      return { stock: s.runManager.getShopState(window.shopNodeId), gold: s.runManager.gold };
    }),
  ).toEqual(before);
  expect(errors).toEqual([]);
});
