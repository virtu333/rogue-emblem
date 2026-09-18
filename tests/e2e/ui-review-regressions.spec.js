import { test, expect, devices } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 390 } });
async function nodeMap(page) {
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
}
async function action(page, name, payload) {
  await page.evaluate(
    ({ name, payload }) =>
      window.__emblemRogueGame.events.emit('input:action', `input:${name}`, payload),
    { name, payload },
  );
}
test('setup owns keyboard/gamepad actions and initially confirms forward', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/?devScene=homebase&mobilePreview=1');
  await waitForScene(page, 'HomeBase');
  expect(
    await page.evaluate(
      () =>
        window.__emblemRogueGame.scene
          .getScene('HomeBase')
          .children.list.filter((o) => o.input?.enabled).length,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Begin Run', exact: true }).tap();
  const difficulty = page.getByRole('dialog', { name: 'Choose difficulty', exact: true });
  await expect(difficulty).toBeVisible();
  await expect(difficulty.getByRole('button', { name: 'Confirm', exact: true })).toBeFocused();
  for (const key of ['Meta+m', 'Control+m', 'Alt+m']) {
    await page.keyboard.press(key);
    await expect(
      difficulty.getByRole('button', { name: 'Army upgrades: On', exact: true }),
    ).toBeVisible();
  }
  await page.keyboard.press('m');
  await expect(
    difficulty.getByRole('button', { name: 'Army upgrades: Off', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(difficulty.locator('article')).toContainText('Beat the game');
  await expect(difficulty.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await action(page, 'navigate', { dx: -1, dy: 0 });
  await expect(difficulty.getByRole('button', { name: 'Confirm', exact: true })).toBeFocused();
  await action(page, 'confirm');
  const blessing = page.getByRole('dialog', { name: 'Choose a blessing', exact: true });
  await expect(blessing).toBeVisible();
  await expect(blessing.getByRole('button', { name: 'Confirm', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await waitForScene(page, 'NodeMap');
  expect(errors).toEqual([]);
});
test('reference shortcuts and compact backdrop preserve input ownership', async ({ page }) => {
  await nodeMap(page);
  await page.locator('.re-node-map').getByRole('button', { name: 'Menu', exact: true }).tap();
  await page.getByRole('button', { name: 'Compendium', exact: true }).tap();
  const comp = page.getByRole('dialog', { name: 'Compendium', exact: true });
  await expect(comp.getByRole('button', { name: 'Close', exact: true })).not.toBeFocused();
  await page.keyboard.press('/');
  await expect(comp.getByRole('searchbox')).toBeFocused();
  await comp.getByRole('searchbox').fill('Iron');
  await expect(comp.locator('mark').first()).toHaveText('Iron');
  await comp.getByRole('searchbox').fill('');
  await action(page, 'nextUnit');
  await expect(comp.getByRole('button', { name: 'Skills', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.keyboard.press('ArrowDown');
  await expect(comp.locator('.re-row[aria-pressed=true]')).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await expect(settings.getByRole('button', { name: 'Decrease music', exact: true })).toBeFocused();
  await page.mouse.click(2, 2);
  await expect(settings).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});
test('late route opens centered on available choices and service preview returns safely', async ({
  page,
}) => {
  const errors = collectErrors(page);
  await nodeMap(page);
  const target = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const n = s.runManager.nodeMap.nodes.find((n) => n.row >= 6);
    s.runManager.getAvailableNodes = () => [n];
    s.nodeView.destroy();
    s.drawMap();
    return n.id;
  });
  const choice = page.locator(`[data-node="${target}"]`);
  const box = await choice.boundingBox(),
    viewport = await page.locator('.re-node-scroll').boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(viewport.y);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.y + viewport.height);
  expect(
    await page.evaluate(
      () =>
        window.__emblemRogueGame.scene
          .getScene('NodeMap')
          .children.list.filter((o) => o.text?.includes('Click a node')).length,
    ),
  ).toBe(0);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.showChurchOverlay(s.runManager.nodeMap.nodes[0]);
    s.showChurchMessage('All units healed!', '#44ff44');
  });
  const geometry = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    return {
      message: s.churchMessage.getBounds(),
      heal: s._churchController._churchFixed.heal.getBounds(),
      mobile: s.isMobileInput,
      rowHeight: s._churchController.rowHeight,
      handlerCount: s.game.events.listenerCount('mobile:cancel'),
    };
  });
  expect(geometry.mobile).toBe(true);
  expect(geometry.rowHeight).toBeGreaterThanOrEqual(44);
  expect(geometry.handlerCount).toBe(1);
  await expect(page.locator('#mobile-left-panel [data-action=cancel]')).toBeVisible();
  await expect(page.locator('#mobile-right-panel [data-action=roster]')).toBeVisible();
  expect(geometry.message.y).toBeGreaterThan(geometry.heal.y + geometry.heal.height);
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('NodeMap')._enterChurchMapView(),
  );
  const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Close', exact: true }).tap();
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._churchViewingMap),
  ).toBe(false);
  await page.locator('#mobile-left-panel [data-action=cancel]').tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
  expect(errors).toEqual([]);
});
