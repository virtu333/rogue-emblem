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
  // Arrow keys and controller navigation traverse the dialog's own controls;
  // the canvas scene never receives them as difficulty changes.
  await page.keyboard.press('ArrowRight');
  await expect(difficulty.getByRole('button', { name: 'Back', exact: true })).toBeFocused();
  await expect(difficulty.locator('article')).not.toContainText('Beat the game');
  await action(page, 'navigate', { dx: -1, dy: 0 });
  await expect(difficulty.getByRole('button', { name: 'Confirm', exact: true })).toBeFocused();
  await difficulty.getByRole('button', { name: /^Hard/ }).tap();
  await expect(difficulty.locator('article')).toContainText('Beat the game');
  await expect(difficulty.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await difficulty.getByRole('button', { name: /^Normal/ }).tap();
  await expect(difficulty.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await difficulty.getByRole('button', { name: 'Confirm', exact: true }).focus();
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
  // Arrow keys traverse the dialog's controls in order; the selected entry
  // keeps its pressed state rather than taking focus.
  await page.keyboard.press('ArrowDown');
  await expect(comp.getByRole('button', { name: 'Arts', exact: true })).toBeFocused();
  await expect(comp.locator('.re-row[aria-pressed=true]')).toHaveCount(1);
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
    s.registry.set('activeSlot', 1);
    s.showChurchOverlay(s.runManager.nodeMap.nodes[0]);
  });
  const church = page.getByRole('dialog', { name: 'Church', exact: true });
  await church.getByRole('button', { name: 'Heal all · Free', exact: true }).tap();
  await expect(church.getByRole('status')).toHaveText('All units healed.');
  const routing = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    return {
      mobile: s.isMobileInput,
      handlerCount: s.game.events.listenerCount('mobile:cancel'),
    };
  });
  expect(routing).toEqual({ mobile: true, handlerCount: 1 });
  // The native service surface owns navigation; covered canvas rails stay hidden.
  await expect(page.locator('#mobile-left-panel [data-action=cancel]')).not.toBeVisible();
  await expect(page.locator('#mobile-right-panel [data-action=roster]')).not.toBeVisible();
  await church.getByRole('button', { name: 'View map', exact: true }).tap();
  const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
  await expect(map).toBeVisible();
  await map.getByRole('button', { name: 'Close', exact: true }).tap();
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._churchViewingMap),
  ).toBe(false);
  await church.getByRole('button', { name: 'Leave', exact: true }).tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
  expect(errors).toEqual([]);
});
