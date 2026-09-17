import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });
test('local launch needs no login or external requests and preserves saved progress after reload', async ({
  page,
}) => {
  const external = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    ) {
      external.push(url.hostname);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForScene(page, 'NodeMap');
  await expect(page.locator('#auth-overlay')).toBeHidden();
  await page.evaluate(async () => {
    const scene = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { saveRun } = await import('/src/engine/RunManager.js');
    scene.runManager.gold = 777;
    const result = saveRun(scene.runManager, null, 1);
    if (!result.ok) throw new Error('Local save failed');
  });
  await page.goto('/');
  await waitForScene(page, 'Title');
  const restored = await page.evaluate(async () => {
    const { loadRun } = await import('/src/engine/RunManager.js');
    const game = window.__emblemRogueGame;
    const run = loadRun(game.scene.getScene('Title').gameData, 1);
    return {
      gold: run?.gold,
      cloud: game.registry.get('cloud') || null,
      font: document.fonts.check('12px "Press Start 2P"'),
    };
  });
  expect(restored).toEqual({ gold: 777, cloud: null, font: true });
  expect(external).toEqual([]);
});
