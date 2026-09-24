import { test, expect } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ viewport: { width: 667, height: 375 }, hasTouch: true });

const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(async ({ page }, testInfo) => {
  await page.screenshot({ path: testInfo.outputPath('final.png') });
  expect(pageErrors.get(page)).toEqual([]);
});

async function boot(page, mobile = true) {
  await page.goto(`/?devScene=homebase${mobile ? '&mobilePreview=1' : ''}`);
  await waitForGame(page);
  await waitForScene(page, 'HomeBase');
}
async function showReference(page, kind) {
  await page.evaluate(async (kind) => {
    const scene = window.__emblemRogueGame.scene.getScene('HomeBase');
    scene.mobileHome.hide();
    const module = await import(`/src/ui/${kind}Overlay.js`);
    window.__reference =
      kind === 'Compendium'
        ? new module.CompendiumOverlay(scene, scene.gameData, () => {})
        : new module[`${kind}Overlay`](scene, () => {});
    window.__reference.show();
  }, kind);
}
async function pad(page, action, payload) {
  await page.evaluate(
    async ({ action, payload }) => {
      const { dispatchInputAction } = await import('/src/utils/inputFocus.js');
      const { InputAction } = await import('/src/utils/InputActions.js');
      dispatchInputAction(InputAction[action], payload);
    },
    { action, payload },
  );
}
// Navigate the real input scope: never focus a target directly for controller checks.
async function padFocus(page, label) {
  for (let i = 0; i < 160; i++) {
    if (
      await page.evaluate((label) => {
        const el = document.activeElement;
        return (
          el?.getAttribute('aria-label') === label ||
          el?.textContent?.trim() === label ||
          el?.querySelector('strong')?.textContent === label
        );
      }, label)
    )
      return;
    await pad(page, 'NAVIGATE', { dy: 1, dx: 0 });
  }
  throw new Error(`Controller could not reach ${label}`);
}

test('starting skills retain usable focus and rapid/held Escape returns one step', async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    const upgrade = s.meta.upgradesData.find((u) => u.effects.some((e) => e.unlockSkill));
    s.meta.purchasedUpgrades[upgrade.id] = 1;
    s.mobileHome.render();
  });
  await page.locator('[data-focus="skills"]').click();
  const choice = page.locator('.mh-skill').first();
  const id = (await choice.getAttribute('data-focus')).slice('skill-'.length);
  await choice.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-focus="remove-${id}"]`)).toBeFocused();
  // Avoid a rendering-frame delay between removal and Escape: this previously leaked
  // the Enter keyup and let Phaser replay the following Escape through two menus.
  await page.keyboard.press('Enter');
  await expect(choice).toBeFocused();
  await page.keyboard.down('Escape');
  await page.keyboard.down('Escape');
  await page.keyboard.up('Escape');
  await expect(page.locator('[data-focus="lords"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-focus="lords"]')).toBeFocused();
  expect(await page.evaluate(() => window.__sceneState.activeScene)).toBe('HomeBase');
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('HomeBase').isTransitioning),
  ).toBe(false);
});

test('DOM Help resolves mobile copy, searches all categories and restores browsing context', async ({
  page,
}) => {
  await boot(page);
  await showReference(page, 'Help');
  const menu = page.getByRole('dialog', { name: 'Help', exact: true });
  await menu.getByRole('button', { name: 'Input', exact: true }).click();
  await menu.getByRole('button', { name: 'Touch Controls', exact: true }).click();
  await expect(menu.locator('article')).toContainText('Tap');
  await expect(menu.locator('article')).not.toContainText('Right click');
  await menu.getByRole('button', { name: 'Scroll details down' }).click();
  const previousScroll = await menu.locator('article').evaluate((el) => el.scrollTop);
  const search = menu.getByRole('searchbox');
  await search.fill('Par');
  await expect(menu.locator('.re-row').filter({ hasText: 'Battle Objectives' })).toContainText(
    'Goals',
  );
  await expect(menu.locator('article')).toContainText('Par: target turns');
  await expect(search).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('End');
  await expect(search).toHaveValue('Par');
  await search.fill('zzzz-missing');
  await expect(menu.locator('article')).toContainText('No matching help entries.');
  await search.fill('');
  await expect(menu.locator('article h3')).toHaveText('Touch Controls');
  expect(await menu.locator('article').evaluate((el) => el.scrollTop)).toBe(previousScroll);
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await showReference(page, 'HowToPlay');
  const guide = page.getByRole('dialog', { name: 'How to play', exact: true });
  await guide.getByRole('button', { name: 'Combat Basics', exact: true }).click();
  await expect(guide.locator('article')).toContainText('Tap Danger');
  await expect(guide.locator('article')).not.toContainText('Press D');
});

test.describe('desktop input', () => {
  test.use({ hasTouch: false });
  test('desktop help keeps keyboard instructions', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 });
    await boot(page, false);
    await showReference(page, 'Help');
    const menu = page.getByRole('dialog', { name: 'Help', exact: true });
    await menu.getByRole('button', { name: 'Input', exact: true }).click();
    await menu.getByRole('button', { name: 'Keyboard & Mouse', exact: true }).click();
    await expect(menu.locator('article')).toContainText('Right click');
  });
});

test('controller reaches Compendium filters, long details and close', async ({ page }) => {
  await boot(page);
  await showReference(page, 'Compendium');
  const menu = page.getByRole('dialog', { name: 'Compendium', exact: true });
  await padFocus(page, 'Sword');
  await pad(page, 'CONFIRM');
  await expect(menu.getByRole('button', { name: 'Sword', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await page.evaluate(() => window.__reference.domMenu.filter)).toBe(1);
  expect(await menu.locator('.re-row').count()).toBeGreaterThan(0);
  await padFocus(page, 'Class');
  await pad(page, 'CONFIRM');
  await padFocus(page, 'Scroll details down');
  await pad(page, 'CONFIRM');
  expect(await menu.locator('article').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await padFocus(page, 'Scroll details up');
  await pad(page, 'CONFIRM');
  expect(await menu.locator('article').evaluate((el) => el.scrollTop)).toBe(0);
  await padFocus(page, 'Close');
  await pad(page, 'CONFIRM');
  await expect(menu).toHaveCount(0);
});

test('controller reaches difficulty secondary actions and detail scrolling on phone', async ({
  page,
}) => {
  await boot(page);
  await page.getByRole('button', { name: 'Begin Run', exact: true }).click();
  await waitForScene(page, 'DifficultySelect');
  const menu = page.getByRole('dialog', { name: 'Choose difficulty', exact: true });
  await pad(page, 'DANGER');
  await expect(menu.getByRole('button', { name: 'Army upgrades: Off', exact: true })).toBeVisible();
  await padFocus(page, 'Army upgrades: Off');
  await pad(page, 'CONFIRM');
  await expect(menu.getByRole('button', { name: 'Army upgrades: On', exact: true })).toBeFocused();
  await padFocus(page, 'Hard');
  await pad(page, 'CONFIRM');
  await padFocus(page, 'Scroll details down');
  await pad(page, 'CONFIRM');
  expect(await menu.locator('article').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await menu.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await pad(page, 'CANCEL');
  await waitForScene(page, 'HomeBase');
});

test('HP persistence hint waits for the first battle and shows only once', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('HomeBase');
    const { HintManager } = await import('/src/engine/HintManager.js');
    const hints = new HintManager(3);
    hints.markSeen('nodemap_intro');
    s.registry.set('hints', hints);
    s.registry.set('activeSlot', 3);
    const { RunManager } = await import('/src/engine/RunManager.js');
    const rm = new RunManager(s.gameData);
    rm.startRun({ difficultyId: 'normal' });
    const { ensureSceneLoaded } = await import('/src/utils/sceneLoader.js');
    await ensureSceneLoaded(s, 'NodeMap');
    s.scene.start('NodeMap', { gameData: { ...s.gameData, dialogue: {} }, runManager: rm });
  });
  await waitForScene(page, 'NodeMap');
  await expect(page.locator('.re-node-map')).toBeVisible();
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene
        .getScene('NodeMap')
        .registry.get('hints')
        .hasSeen('nodemap_hp_persist'),
    ),
  ).toBe(false);
  for (const battles of [1, 2]) {
    await page.evaluate((battles) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.runManager.completedBattles = battles;
      s.scene.restart({ gameData: s.gameData, runManager: s.runManager });
    }, battles);
    await expect(page.locator('.re-node-map')).toBeVisible();
    if (battles === 1)
      await expect(
        page.getByRole('status').filter({ hasText: 'HP carries between battles.' }),
      ).toContainText('HP carries between battles. Visit Church or Ruins');
    else
      await expect(
        page.getByRole('status').filter({ hasText: 'HP carries between battles.' }),
      ).toHaveCount(0);
  }
});

test('results use each difficulty act count', async ({ page }) => {
  await boot(page);
  for (const difficulty of ['normal', 'hard', 'lunatic']) {
    const count = await page.evaluate(async (difficulty) => {
      const s = window.__emblemRogueGame.scene.getScene('HomeBase');
      const { RunManager } = await import('/src/engine/RunManager.js');
      const { runResultMenu } = await import('/src/ui/RunFlowMenus.js');
      const rm = new RunManager(s.gameData);
      rm.startRun({ difficultyId: difficulty });
      rm.actIndex = rm.actSequence.length - 1;
      window.__result?.destroy();
      window.__result = runResultMenu(
        Object.assign(Object.create(s), { runManager: rm, result: 'victory' }),
        { currencyMultiplier: 1, valor: 1, supply: 1 },
      );
      return rm.actSequence.length;
    }, difficulty);
    const summary = page.getByRole('dialog', { name: 'Run complete', exact: true });
    await expect(
      summary.locator('dt').filter({ hasText: 'Act reached' }).locator('+ dd'),
    ).toHaveText(`${count} / ${count}`);
  }
});
