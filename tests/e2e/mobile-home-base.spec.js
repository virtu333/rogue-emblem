import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
async function boot(page) {
  await page.goto('/?devScene=homebase&mobilePreview=1');
  await waitForScene(page, 'HomeBase');
  await expect(page.getByRole('dialog', { name: 'Home base', exact: true })).toBeVisible();
}
test('lord unlocks, distinct pair, skill limits and persisted loadout', async ({ page }) => {
  await boot(page);
  await expect(page.locator('[data-focus="lord-Kira"]')).toBeDisabled();
  await expect(page.locator('.mu-requirements')).toContainText('Banner of Command');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    for (const u of s.meta.upgradesData)
      if (u.effects.some((e) => e.commanderChoiceTier || e.unlockSkill))
        s.meta.purchasedUpgrades[u.id] = 1;
    s.meta._save();
    s.mobileHome.render();
  });
  await page.locator('[data-focus="lord-Kira"]').tap();
  await expect(page.locator('[data-focus="commander"]')).toContainText('Kira');
  await page.locator('[data-focus="partner"]').tap();
  await expect(page.locator('[data-focus="lord-Kira"]')).toBeDisabled();
  await page.locator('[data-focus="lord-Voss"]').tap();
  await page.locator('[data-focus="skills"]').tap();
  await page.locator('.mh-skill').first().tap();
  await expect(page.locator('.mh-slots')).toHaveText('1 / 1 starting slots used');
  await expect(page.locator('.mh-skill').nth(1)).toBeDisabled();
  await page.reload();
  await waitForScene(page, 'HomeBase');
  await expect(page.locator('[data-focus="commander"]')).toContainText('Kira');
  await expect(page.locator('[data-focus="partner"]')).toContainText('Voss');
  await page.locator('[data-focus="partner"]').tap();
  await page.locator('[data-focus="skills"]').tap();
  await expect(page.locator('.mh-slots')).toHaveText('1 / 1 starting slots used');
  await page.getByRole('button', { name: /^Remove / }).tap();
  await expect(page.locator('.mh-slots')).toHaveText('0 / 1 starting slots used');
  await page.getByRole('button', { name: 'Upgrades', exact: true }).tap();
  await page.getByRole('button', { name: 'Home base', exact: true }).tap();
  await page.getByRole('button', { name: 'Begin Run', exact: true }).tap();
  await waitForScene(page, 'DifficultySelect');
  await expect(page.locator('.mu-screen,.mu-launch')).toHaveCount(0);
});
for (const width of [640, 667, 844])
  test(`home loadout fits ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 640 ? 480 : 375 });
    await boot(page);
    for (const tab of ['lords', 'skills']) {
      await page.locator(`[data-focus="${tab}"]`).tap();
      expect(
        await page
          .locator('.mh-screen')
          .evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight),
      ).toBe(true);
      const begin = await page
        .getByRole('button', { name: 'Begin Run', exact: true })
        .boundingBox();
      expect(begin.height).toBeGreaterThanOrEqual(44);
      expect(begin.y + begin.height).toBeLessThanOrEqual(width === 640 ? 480 : 375);
    }
    await page.locator('[data-focus="lords"]').tap();
    await page.screenshot({ path: `test-results/mobile-home-${width}.png` });
  });
