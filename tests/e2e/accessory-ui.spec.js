import { test, expect } from '@playwright/test';
import {
  waitForGame,
  waitForScene,
  assertNoInvariantErrors,
  attachSceneCrashArtifacts,
  collectErrors,
} from './helpers.js';

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test.describe('Accessory UI smoke', () => {
  test('shop scroll/accessory purchases land in the shared pools', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/?devScene=nodemap&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');
    // The run-start lines open after the act card; wait for them or for a
    // ready map instead of sampling once, then wait until nodes take clicks.
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    const mapReady = () =>
      page.waitForFunction(
        () => window.__emblemRogueGame.scene.getScene('NodeMap')?.isSceneReady === true,
      );
    await Promise.race([skip.waitFor({ state: 'visible' }), mapReady()]);
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await mapReady();

    const before = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const n = s.runManager.getAvailableNodes()[0];
      n.type = 'shop';
      n.isAmbush = false;
      s.runManager.gold = 10000;
      s.onNodeClick(n);
      s.shopBuyItems = [
        { type: 'scroll', price: 100, item: { name: 'Sol Scroll', type: 'Scroll' } },
        {
          type: 'accessory',
          price: 100,
          item: { name: 'Goddess Icon', type: 'Accessory', effects: { LCK: 5 } },
        },
      ];
      s._shopController.refreshShop();
      const rm = s.runManager;
      return { scrolls: rm.scrolls?.length || 0, accessories: rm.accessories?.length || 0 };
    });

    const shop = page.getByRole('dialog', { name: 'Village', exact: true });
    await expect(shop).toBeVisible();
    const status = shop.getByRole('status');

    await shop.locator('.shop-row', { hasText: 'Sol Scroll' }).click();
    await shop.getByRole('button', { name: 'Buy · 100 G', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Buy Sol Scroll?', exact: true });
    await confirm.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(status).toContainText('Sol Scroll → Scroll pool.');

    await shop.locator('.shop-row', { hasText: 'Goddess Icon' }).click();
    await shop.getByRole('button', { name: 'Buy · 100 G', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Buy and equip Goddess Icon', exact: true });
    await picker.getByRole('button', { name: /Keep in shared pool/ }).click();
    await picker.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(status).toContainText('Goddess Icon → Accessory pool.');

    const after = await page.evaluate(() => {
      const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
      return { scrolls: rm.scrolls?.length || 0, accessories: rm.accessories?.length || 0 };
    });
    expect(after.scrolls - before.scrolls).toBe(1);
    expect(after.accessories - before.accessories).toBe(1);

    await assertNoInvariantErrors(page);
    expect(errors).toEqual([]);
  });

  test('accessory picker uses dynamic rows and paginates above cap', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/?devScene=nodemap&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');

    const result = await page.evaluate(() => {
      const game = window.__emblemRogueGame;
      const nodeMap = game?.scene?.getScene?.('NodeMap');
      if (!nodeMap) return null;

      nodeMap._openRoster();
      const overlay = nodeMap.rosterOverlay;
      if (!overlay) return null;

      const unit = nodeMap.runManager.roster?.[0];
      if (!unit) return null;

      const getPickerState = () => {
        const bg = overlay.tradeObjects.find(
          (o) => o?.type === 'Rectangle' && Number(o.width) === 460,
        );
        const pageLabel = overlay.tradeObjects.find(
          (o) => typeof o?.text === 'string' && o.text.startsWith('Page '),
        );
        return {
          height: bg ? Number(bg.height) : null,
          page: pageLabel ? pageLabel.text : null,
        };
      };

      nodeMap.runManager.accessories = [
        { name: 'Goddess Icon', effects: { LCK: 5 } },
        { name: 'Power Ring', effects: { STR: 2 } },
      ];
      overlay._showAccessoryPicker(unit);
      const small = getPickerState();

      overlay._destroyTrade();
      nodeMap.runManager.accessories = Array.from({ length: 10 }, (_v, i) => ({
        name: `Acc ${i + 1}`,
        effects: { STR: 1 },
      }));
      overlay._showAccessoryPicker(unit);
      const large = getPickerState();

      const next = overlay.tradeObjects.find(
        (o) => typeof o?.text === 'string' && o.text === 'Next',
      );
      if (next?.emit) next.emit('pointerdown');
      const afterNext = getPickerState();

      return { small, large, afterNext };
    });

    expect(result).toBeTruthy();
    expect(result.small.height).toBe(142);
    expect(result.small.page).toBe('Page 1/1');
    expect(result.large.height).toBe(286);
    expect(result.large.page).toBe('Page 1/2');
    expect(result.afterNext.page).toBe('Page 2/2');

    await assertNoInvariantErrors(page);
    expect(errors).toEqual([]);
  });
});
