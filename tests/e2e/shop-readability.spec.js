import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';

test.use({ ...devices['iPhone 13'] });
for (const width of [667, 844]) {
  test.describe(`shop ${width}`, () => {
    test.use({ viewport: { width, height: 390 } });
    test('read details, buy, sell, forge, return from roster/map, and rotate', async ({ page }) => {
      test.setTimeout(90000);
      const errors = collectErrors(page);
      await page.goto('/?devScene=nodemap&mobilePreview=1');
      await waitForGame(page);
      await waitForScene(page, 'NodeMap');
      const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
      if (await skip.isVisible()) await skip.tap();
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        s.dialogueOverlay?.hide?.();
        s._storyDialogueActive = false;
        s.registry.set('activeSlot', 1);
        s.runManager.gold = 10000;
        const n = s.runManager.getAvailableNodes()[0];
        n.type = 'shop';
        const sword = structuredClone(s.gameData.weapons.find((w) => w.name === 'Steel Sword'));
        const icon = structuredClone(s.gameData.accessories.find((w) => w.name === 'Goddess Icon'));
        s.showShopOverlay(n, [
          { type: 'weapon', item: sword, price: 1000 },
          { type: 'accessory', item: icon, price: 1000 },
        ]);
      });
      const shop = page.locator('.shop-menu');
      await expect(shop).toBeVisible();
      await expect(shop.locator('.shop-mechanics')).toContainText('Might: 8');
      expect(
        await shop
          .locator('.shop-mechanics')
          .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
      ).toBeGreaterThanOrEqual(14);
      // The item's story reads under its picture without a disclosure tap.
      await expect(shop.locator('.shop-hero .ia-hero')).toBeVisible();
      await expect(shop.locator('.shop-lore')).toBeVisible();
      await expect(shop.locator('.shop-lore')).not.toBeEmpty();
      await shop.locator('.shop-row').filter({ hasText: 'Goddess Icon' }).tap();
      await expect(shop.locator('.shop-mechanics')).toContainText('LCK');
      await page.screenshot({ path: `test-results/shop-${width}-details.png` });
      await shop.locator('.shop-row').filter({ hasText: 'Steel Sword' }).last().tap();
      await shop.getByRole('button', { name: 'Buy · 1000 G', exact: true }).tap();
      const picker = page.getByRole('dialog', { name: 'Give Steel Sword to', exact: true });
      await picker.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(shop.locator('.shop-gold')).toHaveText('10000 G');
      await shop.getByRole('button', { name: 'Buy · 1000 G', exact: true }).tap();
      await picker.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await expect(shop.locator('.shop-gold')).toHaveText('9000 G');
      await expect(shop.locator('.shop-status')).toContainText('Steel Sword');
      await shop.getByRole('button', { name: 'Roster', exact: true }).tap();
      const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await roster.getByRole('button', { name: 'Equipment', exact: true }).tap();
      await expect(
        roster.getByRole('heading', { name: 'Steel Sword', exact: true }).first(),
      ).toBeVisible();
      await roster.getByRole('button', { name: 'Close', exact: true }).tap();
      await shop.getByRole('button', { name: 'Forge', exact: true }).tap();
      await shop.locator('.shop-row').filter({ hasText: 'Steel Sword' }).last().tap();
      await shop.getByRole('button', { name: 'Choose forge', exact: true }).tap();
      const forge = page.getByRole('dialog', { name: 'Forge Steel Sword', exact: true });
      await forge.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await expect(shop.locator('.shop-copy h3')).toHaveText('Steel Sword +1');
      await shop.getByRole('button', { name: 'Sell', exact: true }).tap();
      await shop.locator('.shop-row').filter({ hasText: 'Steel Sword +1' }).tap();
      await shop.locator('.shop-commit button').tap();
      const sale = page.getByRole('dialog', { name: 'Sell Steel Sword +1?', exact: true });
      await sale.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(shop.locator('.shop-copy h3')).toHaveText('Steel Sword +1');
      await shop.locator('.shop-commit button').tap();
      await sale.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await expect(shop.locator('.shop-status')).toContainText('Sold Steel Sword +1');
      await shop.getByRole('button', { name: 'Buy', exact: true }).tap();
      await shop.getByRole('button', { name: 'View map', exact: true }).tap();
      const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
      await expect(map).toBeVisible();
      await map.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(shop).toBeVisible();
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(shop.locator('.shop-commit button')).toBeInViewport();
      const overflow = await shop.evaluate((e) => e.scrollWidth > e.clientWidth + 1);
      expect(overflow).toBe(false);
      await page.screenshot({ path: `test-results/shop-${width}-portrait.png` });
      await page.setViewportSize({ width, height: 390 });
      await shop.getByRole('button', { name: 'Leave', exact: true }).tap();
      await expect(shop).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  });
}
