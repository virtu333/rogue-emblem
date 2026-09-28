// Playtest round 3 (2026-09-26): a ruins market compared Witchfire with the
// wielder's Wildfire as only "Attack 20 → 20, AS 3 → 3", hiding its +30 crit and
// the Mire art. The shop now adds a row for each meaningful difference. This
// checks the rows reach both shop surfaces (the roster comparison and the buy
// picker) and fit at the design size and on landscape phones.
import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene, collectErrors } from './helpers.js';

const SIZES = [
  { name: 'desktop 640x480', viewport: { width: 640, height: 480 }, mobile: false },
  { name: 'phone 844x390', viewport: { width: 844, height: 390 }, mobile: true },
  { name: 'phone 667x375', viewport: { width: 667, height: 375 }, mobile: true },
];

const fits = (locator) => locator.evaluate((e) => e.scrollWidth <= e.clientWidth + 1);

for (const size of SIZES) {
  test.describe(`shop comparison ${size.name}`, () => {
    test.use({ viewport: size.viewport, hasTouch: size.mobile, isMobile: size.mobile });

    test('Witchfire over Wildfire shows its crit and Mire art', async ({ page }, info) => {
      test.setTimeout(60_000);
      const errors = collectErrors(page);
      await page.goto(`/?devScene=nodemap${size.mobile ? '&mobilePreview=1' : ''}`);
      await waitForGame(page);
      await waitForScene(page, 'NodeMap');
      const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
      if (await skip.isVisible()) await skip.click();
      const skl = await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        s.dialogueOverlay?.hide?.();
        s._storyDialogueActive = false;
        s.registry.set('activeSlot', 1);
        s.runManager.gold = 10000;
        const { createUnit } = await import('/src/engine/UnitManager.js');
        const weapon = (name) => structuredClone(s.gameData.weapons.find((w) => w.name === name));
        const mage = createUnit(
          s.gameData.classes.find((c) => c.name === 'Mage'),
          5,
          s.gameData.weapons,
          { name: 'Ottoline' },
        );
        const wildfire = weapon('Wildfire');
        mage.inventory = [wildfire];
        mage.weapon = wildfire;
        s.runManager.roster.push(mage);
        const witchfire = weapon('Witchfire');
        witchfire.weaponArtIds = ['magic_mire'];
        const n = s.runManager.getAvailableNodes()[0];
        n.type = 'shop';
        s.showShopOverlay(n, [{ type: 'weapon', item: witchfire, price: 3306 }]);
        return mage.stats.SKL;
      });
      // Static crit = floor(SKL / 2) + weapon crit: Wildfire 0, Witchfire 30.
      const crit = `Crit ${Math.floor(skl / 2)} → ${Math.floor(skl / 2) + 30}`;

      const shop = page.locator('.shop-menu');
      await expect(shop).toBeVisible();
      await shop.locator('.shop-row').filter({ hasText: 'Witchfire' }).click();
      await shop.getByText('Compare with your roster', { exact: true }).click();
      const line = shop.locator('details p').filter({ hasText: 'Ottoline: If equipped:' });
      await expect(line).toContainText(crit);
      await expect(line).toContainText('Art none → Mire');
      await line.scrollIntoViewIfNeeded();
      expect(await fits(line)).toBe(true);
      expect(await fits(shop)).toBe(true);
      await page.screenshot({ path: info.outputPath('shop-compare.png') });

      await shop.getByRole('button', { name: 'Buy · 3306 G', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Give Witchfire to', exact: true });
      const choice = picker.getByRole('button', { name: /^Ottoline/ });
      await expect(choice).toContainText(crit);
      await expect(choice).toContainText('Art none → Mire');
      await choice.scrollIntoViewIfNeeded();
      expect(await fits(choice)).toBe(true);
      expect(await fits(picker)).toBe(true);
      await page.screenshot({ path: info.outputPath('shop-compare-picker.png') });
      await picker.getByRole('button', { name: 'Close', exact: true }).click();
      expect(errors).toEqual([]);
    });
  });
}
