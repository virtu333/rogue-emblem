import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });
async function battle(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    if (b.battleState === 'DEPLOY_SELECTION')
      b.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
  });
  await expect(page.getByRole('complementary', { name: 'Battle commands' })).toBeVisible();
}
test('battle information replaces canvas labels and preserves terrain, par and rewind details', async ({
  page,
}) => {
  await battle(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const terrainName = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b._mobileTerrainFocus = { col: b.playerUnits[0].col, row: b.playerUnits[0].row };
    return b.grid.getTerrainAt(b._mobileTerrainFocus.col, b._mobileTerrainFocus.row).name;
  });
  await expect(hud.locator('.mb-terrain')).toContainText(terrainName);
  await expect(hud.locator('.mb-terrain')).toContainText('Avoid');
  await hud.locator('summary').filter({ hasText: 'More' }).tap();
  await expect(hud.locator('.mb-objective')).not.toBeEmpty();
  expect(
    await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return [b.infoText, b.objectiveText, b.turnCounterText, b.visionHudText]
        .filter(Boolean)
        .every((o) => !o.visible);
    }),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-battle-info.png' });
  await hud.locator('summary').filter({ hasText: 'More' }).tap();
  expect(
    await hud.locator('.mb-command-grid .mb-button').evaluateAll((buttons) =>
      buttons.every((button) => {
        const range = document.createRange();
        range.selectNodeContents(button);
        return range.getClientRects().length === 1;
      }),
    ),
  ).toBe(true);
});
test('pause is scrollable, child settings return correctly, and resume releases input', async ({
  page,
}) => {
  await battle(page);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await expect(pause).toBeVisible();
  expect(
    await pause
      .locator('button')
      .evaluateAll((bs) => bs.every((b) => b.getBoundingClientRect().height >= 44)),
  ).toBe(true);
  expect(await pause.locator('.mp-actions').evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/mobile-pause.png' });
  await pause.getByRole('button', { name: 'Settings', exact: true }).tap();
  await expect(pause).toBeHidden();
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('Battle').pauseOverlay.closeActiveSubOverlay(),
  );
  await expect(pause).toBeVisible();
  await pause.getByRole('button', { name: 'Resume', exact: true }).tap();
  await expect(pause).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Battle commands' })).toBeVisible();
});
test('abandon retains confirmation and invokes the existing callback only once', async ({
  page,
}) => {
  await battle(page);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    window.__testAbandons = 0;
    b.pauseOverlay.onAbandon = () => {
      window.__testAbandons++;
    };
  });
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await pause.getByRole('button', { name: 'Abandon Run', exact: true }).tap();
  await expect(pause.getByText('Abandon this run?', { exact: false })).toBeVisible();
  await expect(pause.getByRole('button').first()).toHaveText('Cancel');
  await expect(pause.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await pause.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(await page.evaluate(() => window.__testAbandons)).toBe(0);
  await pause.getByRole('button', { name: 'Abandon Run', exact: true }).tap();
  await pause.getByRole('button', { name: 'Abandon run', exact: true }).tap();
  await expect(pause).toHaveCount(0);
  expect(await page.evaluate(() => window.__testAbandons)).toBe(1);
});

test('save-exit confirmation cancels safely and hands off once without resuming', async ({
  page,
}) => {
  await battle(page);
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Menu', exact: true })
    .tap();
  await page.evaluate(() => {
    const o = window.__emblemRogueGame.scene.getScene('Battle').pauseOverlay;
    window.__testExit = { saved: 0, resumed: 0 };
    o.onSaveAndExitWarning = 'Return to title with this saved run?';
    o.onSaveAndExit = () => {
      window.__testExit.saved++;
    };
    o.onResume = () => {
      window.__testExit.resumed++;
    };
  });
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await pause.getByRole('button', { name: 'Save & Return to Title', exact: true }).tap();
  await expect(pause).toContainText('Save and return to Title?');
  await expect(pause.getByRole('button').first()).toHaveText('Cancel');
  await expect(pause.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await pause.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(await page.evaluate(() => window.__testExit)).toEqual({ saved: 0, resumed: 0 });
  await pause.getByRole('button', { name: 'Save & Return to Title', exact: true }).tap();
  await pause.getByRole('button', { name: 'Save & return', exact: true }).tap();
  await expect(pause).toHaveCount(0);
  expect(await page.evaluate(() => window.__testExit)).toEqual({ saved: 1, resumed: 0 });
});
