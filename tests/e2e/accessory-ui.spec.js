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
  test('shop scroll/accessory purchases show correct pool banners', async ({ page }) => {
    const errors = collectErrors(page);

    await page.goto('/?devScene=nodemap&preset=weapon_arts');
    await waitForGame(page);
    await waitForScene(page, 'NodeMap');

    const result = await page.evaluate(() => {
      const game = window.__emblemRogueGame;
      const nodeMap = game?.scene?.getScene?.('NodeMap');
      if (!nodeMap) return null;

      const rm = nodeMap.runManager;
      const beforeScrolls = Array.isArray(rm.scrolls) ? rm.scrolls.length : 0;
      const beforeAccessories = Array.isArray(rm.accessories) ? rm.accessories.length : 0;

      const captured = [];
      nodeMap.showShopBanner = (msg, color) => {
        captured.push({ msg, color });
      };
      nodeMap.refreshShop = () => {};

      const scrollEntry = { type: 'scroll', price: 100, item: { name: 'Sol Scroll' } };
      const accessoryEntry = {
        type: 'accessory',
        price: 100,
        item: { name: 'Goddess Icon', effects: { LCK: 5 } },
      };

      nodeMap.shopBuyItems = [scrollEntry, accessoryEntry];
      nodeMap.onBuyItem(scrollEntry);
      nodeMap.onBuyItem(accessoryEntry);

      const afterScrolls = Array.isArray(rm.scrolls) ? rm.scrolls.length : 0;
      const afterAccessories = Array.isArray(rm.accessories) ? rm.accessories.length : 0;
      return {
        captured,
        scrollDelta: afterScrolls - beforeScrolls,
        accessoryDelta: afterAccessories - beforeAccessories,
      };
    });

    expect(result).toBeTruthy();
    expect(result.scrollDelta).toBe(1);
    expect(result.accessoryDelta).toBe(1);
    expect(result.captured).toContainEqual({
      msg: 'Got Sol Scroll! Added to Scroll Pool.',
      color: '#88ff88',
    });
    expect(result.captured).toContainEqual({
      msg: 'Got Goddess Icon! Added to Accessory Pool.',
      color: '#88ff88',
    });

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
        const bg = overlay.tradeObjects.find((o) => o?.type === 'Rectangle' && Number(o.width) === 460);
        const pageLabel = overlay.tradeObjects.find((o) => typeof o?.text === 'string' && o.text.startsWith('Page '));
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

      const next = overlay.tradeObjects.find((o) => typeof o?.text === 'string' && o.text === 'Next');
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
