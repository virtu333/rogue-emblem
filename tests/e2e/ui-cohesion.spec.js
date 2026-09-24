import { test, expect, devices } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
test('route art, dialogue portraits, reference search and settings use touch UI', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await expect(next).toBeVisible();
  if (await next.isVisible()) {
    const portrait = page.locator('.re-dialogue img');
    await expect(portrait).toBeVisible();
    expect(await portrait.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    if (await skip.isVisible()) await skip.tap();
    else await next.tap();
  }
  await expect(page.locator('.re-node-map')).toBeVisible();
  const future = page.locator('.re-node[aria-label*="Future"]').first();
  await future.tap();
  await expect(page.getByRole('button', { name: 'Advance', exact: true })).toBeDisabled();
  await page.locator('.re-node.is-available').first().tap();
  await expect(page.getByRole('button', { name: 'Advance', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/cohesion-node-map.png' });
  await page.locator('.re-node-map').getByRole('button', { name: 'Menu', exact: true }).tap();
  await page.getByRole('button', { name: 'Compendium', exact: true }).tap();
  const comp = page.getByRole('dialog', { name: 'Compendium', exact: true });
  await expect(comp).toBeVisible();
  await comp.getByRole('searchbox').fill('Iron Sword');
  await expect(comp.locator('.re-row')).toHaveCount(1);
  await expect(comp.locator('article')).toContainText('Iron Sword');
  await page.screenshot({ path: 'test-results/cohesion-compendium.png' });
  await comp.getByRole('searchbox').fill('not-a-real-weapon');
  await expect(comp.locator('article')).toContainText('No matching entries');
  await comp.getByRole('button', { name: 'Close', exact: true }).tap();
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole('button', { name: 'Decrease music', exact: true }).tap();
  await settings.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(settings).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const width of [640, 667])
  test(`reference menus and route fit ${width}px landscape`, async ({ page }) => {
    await page.setViewportSize({ width, height: 390 });
    await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
    await waitForScene(page, 'NodeMap');
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
    const route = page.locator('.re-node-map');
    await expect(route).toBeVisible();
    const advance = route.getByRole('button', { name: 'Advance', exact: true });
    const box = await advance.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `test-results/cohesion-route-${width}.png` });
    await route.getByRole('button', { name: 'Menu', exact: true }).tap();
    await page.getByRole('button', { name: 'Compendium', exact: true }).tap();
    const comp = page.getByRole('dialog', { name: 'Compendium', exact: true });
    await comp.getByRole('button', { name: 'Terrain', exact: true }).tap();
    await expect(comp.locator('article')).not.toBeEmpty();
    expect(await comp.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.keyboard.press('Tab');
    expect(await comp.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(comp).toHaveCount(0);
  });

test('in-battle campaign overview is read-only and returns to pause', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.showPauseMenu();
  });
  await page.getByRole('button', { name: 'Campaign Map', exact: true }).tap();
  const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
  await expect(map).toBeVisible();
  const before = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').runManager.currentNodeId,
  );
  if (await map.locator('.re-node').count()) await map.locator('.re-node').first().tap();
  await expect(map.getByRole('button', { name: 'Advance', exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').runManager.currentNodeId,
    ),
  ).toBe(before);
  await map.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
