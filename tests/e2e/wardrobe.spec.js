// The Wardrobe at Home Base (docs/specs/lord-outfits.md): buy a lord's outfit with Valor (two
// taps), see it on the lord everywhere Home Base shows them, switch back to the own look, and a
// lord with no win cannot buy. Played by taps on the DOM.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

const valor = (page) =>
  page.evaluate(() => window.__emblemRogueGame.scene.getScene('HomeBase').meta.getTotalValor());

test('buy an outfit, wear it, take it off; a locked lord cannot buy', async ({ page }) => {
  await page.goto('/?devScene=homebase&preset=wardrobe&mobilePreview=1');
  await waitForScene(page, 'HomeBase');
  const home = page.getByRole('dialog', { name: 'Home base', exact: true });
  await expect(home).toBeVisible();

  await page.locator('[data-focus="wardrobe"]').tap();
  await expect(page.locator('[data-focus="wd-Kira"]')).toContainText('Wearing');

  // Cael has no win: his outfit says why and cannot be bought.
  await page.locator('[data-focus="wd-Cael"]').tap();
  await expect(home).toContainText('Win a run with Cael alive to unlock.');
  await expect(page.locator('[data-focus="wd-buy-old_guard"]')).toBeDisabled();

  // Edric: the first tap asks, the second pays.
  await page.locator('[data-focus="wd-Edric"]').tap();
  const before = await valor(page);
  const buy = page.locator('[data-focus="wd-buy-ashen_crown"]');
  await buy.tap();
  await expect(buy).toHaveText('Spend 6,000 Valor?');
  expect(await valor(page)).toBe(before);
  await buy.tap();
  await expect(home).toContainText('Edric now wears Ashen Crown.');
  expect(await valor(page)).toBe(before - 6000);
  await expect(page.locator('[data-focus="wd-Edric"]')).toContainText('Wearing');

  // The Starting lords list shows him in it.
  await page.locator('[data-focus="lords"]').tap();
  await expect(
    page.locator('[data-focus="lord-Edric"] [data-portrait-id="lord_edric__ashen_crown"]'),
  ).toBeVisible();

  // Back to the own look.
  await page.locator('[data-focus="wardrobe"]').tap();
  await page.locator('[data-focus="wd-Edric"]').tap();
  await page.locator('[data-focus="wd-wear-own-Edric"]').tap();
  await expect(page.locator('[data-focus="wd-Edric"]')).toContainText('Owned');
  await page.locator('[data-focus="lords"]').tap();
  await expect(
    page.locator('[data-focus="lord-Edric"] [data-portrait-id="lord_edric"]'),
  ).toBeVisible();
  expect(await valor(page)).toBe(before - 6000);
});
