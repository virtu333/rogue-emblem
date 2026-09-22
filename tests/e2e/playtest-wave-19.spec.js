import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ viewport: { width: 844, height: 390 } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
});
test('rewards allow inventory management and direct accessory equip', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.set('activeSlot', 1);
    s.onVictory();
  });
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const r = s._lootController.mobileRewards;
    r.choices[0] = { type: 'accessory', item: structuredClone(s.gameData.accessories[0]) };
    r.selected = 0;
    r.render();
  });
  await rewards.getByRole('button', { name: 'Roster', exact: true }).click();
  const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(roster).toBeVisible();
  await roster.getByRole('button', { name: 'Equipment', exact: true }).click();
  await expect(roster.getByRole('button', { name: 'Store', exact: true }).first()).toBeVisible();
  await roster.getByRole('button', { name: 'Close', exact: true }).click();
  await rewards.getByRole('button', { name: 'Choose reward', exact: true }).click();
  await expect(rewards.getByRole('button', { name: /Keep in shared pool/ })).toBeVisible();
  await rewards.getByRole('button', { name: 'Apply reward', exact: true }).click();
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s.runManager.roster[0].accessory?.name;
    }),
  ).toBeTruthy();
  expect(errors).toEqual([]);
});

test('shop accessory can be equipped immediately and tabs reset their list scroll', async ({
  page,
}) => {
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await skip.click();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const n = s.runManager.getAvailableNodes()[0];
    n.type = 'shop';
    n.isAmbush = false;
    s.runManager.gold = 10000;
    s.onNodeClick(n);
    s.shopBuyItems = [
      { type: 'accessory', price: 100, item: structuredClone(s.gameData.accessories[0]) },
    ];
    s._shopController.refreshShop();
  });
  const shop = page.getByRole('dialog', { name: 'Village', exact: true });
  await expect(shop).toBeVisible();
  await shop.getByRole('button', { name: 'Buy · 100 G', exact: true }).click();
  const picker = page.getByRole('dialog', { name: /^Buy and equip/ });
  await expect(picker).toBeVisible();
  await picker.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.roster[0].accessory?.name,
    ),
  ).toBeTruthy();
  await shop.getByRole('button', { name: 'Forge', exact: true }).click();
  expect(await shop.locator('.shop-stock').evaluate((el) => el.scrollTop)).toBe(0);
});
