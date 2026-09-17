import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });
async function boot(page) {
  await page.goto('/?devScene=homebase&mobilePreview=1');
  await waitForScene(page, 'HomeBase');
  await page.getByRole('button', { name: 'Upgrades', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Army upgrades' })).toBeVisible();
}
test('real purchase, refund fee, selection, scroll and saved reload', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    s.meta.totalSupply = 1000;
    s.meta._save();
    s.mobileUpgrades.render();
  });
  const row = page.locator('[data-upgrade="recruit_hp_growth"]');
  await row.tap();
  await expect(page.locator('.mu-effects')).toContainText('Next: +5%');
  await page.getByRole('button', { name: 'Buy · 50 supply', exact: true }).tap();
  await expect(row).toHaveAttribute('aria-pressed', 'true');
  await expect(row).toContainText('Tier 1 / 5');
  await expect(page.locator('.mu-currency.active')).toContainText('950');
  await page.reload();
  await waitForScene(page, 'HomeBase');
  await page.getByRole('button', { name: 'Upgrades', exact: true }).tap();
  await expect(row).toContainText('Tier 1 / 5');
  await page.getByRole('button', { name: 'Refund one tier', exact: true }).tap();
  await expect(page.locator('.mu-refund-info')).toContainText('less 20 fee');
  await page.getByRole('button', { name: 'Keep upgrade' }).tap();
  await expect(row).toContainText('Tier 1 / 5');
  await page.getByRole('button', { name: 'Refund one tier' }).tap();
  await page.getByRole('button', { name: 'Confirm refund' }).tap();
  await expect(row).toContainText('Tier 0 / 5');
  await expect(page.locator('.mu-currency.active')).toContainText('980');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    for (let i = 0; i < 3; i++) s.meta.purchaseUpgrade('recruit_res_growth');
    s.mobileUpgrades.render();
  });
  const last = page.locator('.mu-row').last();
  await last.click();
  const offset = await page.locator('.mu-list').evaluate((e) => e.scrollTop);
  await page.locator('.mu-buy').tap();
  expect(await page.locator('.mu-list').evaluate((e) => e.scrollTop)).toBeCloseTo(offset, 0);
  await page.getByRole('button', { name: 'Economy', exact: true }).tap();
  await page.getByRole('button', { name: 'Recruits', exact: true }).tap();
  expect(await page.locator('.mu-list').evaluate((e) => e.scrollTop)).toBeCloseTo(offset, 0);
  await page.getByRole('button', { name: 'Home base', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Army upgrades' })).toHaveCount(0);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('HomeBase').input.enabled),
  ).toBe(false);
  await page.getByRole('button', { name: 'Upgrades', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Army upgrades' })).toBeVisible();
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('HomeBase').scene.start('Title'),
  );
  await expect(page.locator('.mu-screen,.mu-launch')).toHaveCount(0);
});
for (const width of [640, 844])
  test(`categories, locks and readable layout at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 640 ? 480 : 390 });
    await boot(page);
    for (const label of ['Recruits', 'Lords', 'Economy', 'Battalion', 'Equipment', 'Skills']) {
      await page.getByRole('button', { name: label, exact: true }).tap();
      await expect(page.locator('.mu-row').first()).toBeVisible();
      const sizes = await page.locator('.mu-screen').evaluate((e) => ({
        w: e.clientWidth,
        sw: e.scrollWidth,
        h: e.clientHeight,
        sh: e.scrollHeight,
      }));
      expect(sizes.sw).toBeLessThanOrEqual(sizes.w);
      expect(sizes.sh).toBeLessThanOrEqual(sizes.h);
    }
    await page.getByRole('button', { name: 'Recruits', exact: true }).tap();
    const locked = page.locator('.mu-row').filter({ hasText: 'Locked' }).first();
    if (await locked.count()) {
      await locked.click();
      await expect(page.locator('.mu-requirements')).toContainText('Requires:');
      await expect(page.locator('.mu-buy')).toBeDisabled();
    }
    await page.screenshot({ path: `test-results/mobile-upgrades-${width}.png` });
  });

test('unaffordable, maxed and milestone-locked upgrades explain their state', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    s.meta.totalSupply = 0;
    s.mobileUpgrades.render();
  });
  await expect(page.locator('.mu-buy')).toBeDisabled();
  await expect(page.locator('.mu-requirements')).toContainText('Not enough supply');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    s.meta.purchasedUpgrades.recruit_hp_growth = 5;
    s.mobileUpgrades.render();
  });
  await expect(page.locator('.mu-buy')).toHaveText('Fully upgraded');
  await expect(page.locator('[data-upgrade="recruit_hp_growth"]')).toContainText('MAX');
  const id = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    s.meta.milestones.clear();
    const u = s.meta.upgradesData.find((u) => u.requires?.milestones?.length);
    s.mobileUpgrades.selectCategory(u.category);
    return u.id;
  });
  await page.locator(`[data-upgrade="${id}"]`).click();
  await expect(page.locator('.mu-detail h2')).toHaveText('Unknown upgrade');
  await expect(page.locator('.mu-requirements')).toContainText('Requires:');
  await expect(page.locator('.mu-buy')).toBeDisabled();
  const buy = await page.locator('.mu-buy').boundingBox();
  expect(buy.y + buy.height).toBeLessThanOrEqual(375);
});
