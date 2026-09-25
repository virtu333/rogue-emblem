import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

async function openForecast(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    if (s.battleState === 'DEPLOY_SELECTION')
      s.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
    const unit = s.playerUnits.find((u) => u.weapon && u.weapon.type !== 'Staff');
    const enemy = s.enemyUnits.find((u) => u.currentHP > 0);
    unit.col = Math.max(0, enemy.col - 1);
    unit.row = enemy.row;
    if (unit.col === enemy.col) unit.col += 1;
    // Two legal weapons retain real equip/rebuild logic.
    unit.inventory.push({ ...unit.weapon, name: 'Forecast spare weapon' });
    s.selectUnit(unit);
    s.hideActionMenu();
    await s.showForecast(unit, enemy);
    const hud = s._mobileBattleHud;
    const config = hud.forecast;
    hud.showForecast({
      ...config,
      forecast: {
        ...config.forecast,
        attacker: {
          ...config.forecast.attacker,
          warnings: Array(12).fill('Long forecast warning: read all effects before confirming.'),
        },
      },
    });
    window.__forecastChecks = { gridMoves: 0, gridConfirms: 0, commits: 0, cancels: 0 };
    for (const [object, method, counter] of [
      [s._gridCursor, 'move', 'gridMoves'],
      [s._gridCursor, 'confirm', 'gridConfirms'],
      [s, 'confirmForecastCombat', 'commits'],
      [s, 'requestCancel', 'cancels'],
    ]) {
      const original = object[method].bind(object);
      object[method] = (...args) => {
        window.__forecastChecks[counter]++;
        return original(...args);
      };
    }
  });
  await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toBeVisible();
}
async function pad(page, action, payload) {
  await page.evaluate(
    async ({ action, payload }) => {
      const { InputAction, INPUT_ACTION_EVENT } = await import('/src/utils/InputActions.js');
      window.__emblemRogueGame.events.emit(INPUT_ACTION_EVENT, InputAction[action], payload);
    },
    { action, payload },
  );
}
async function owner(page) {
  return page.evaluate(async () => {
    const { activeInputOwner } = await import('/src/utils/inputFocus.js');
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return activeInputOwner() === s._mobileBattleHud
      ? 'forecast'
      : activeInputOwner() === s
        ? 'battle'
        : 'other';
  });
}

test('phone keyboard reads all forecast content and Escape cancels exactly once', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openForecast(page);
  const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  // Reading order: header scroll controls, the weapon stepper, then the footer.
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Next weapon' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Previous weapon' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Scroll forecast down' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect
    .poll(() => dialog.locator('.mb-forecast-sides').evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  const metrics = await dialog.evaluate((e) => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    bottom: e.getBoundingClientRect().bottom,
    heights: [...e.querySelectorAll('button')].map((b) => b.getBoundingClientRect().height),
  }));
  expect(metrics.width).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.bottom).toBeLessThanOrEqual(375);
  expect(metrics.heights.every((h) => h >= 44)).toBe(true);
  await page.screenshot({ path: '/tmp/forecast-input-tests/keyboard-scroll.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await expect(dialog).toHaveCount(0);
  expect(await owner(page)).toBe('battle');
  expect(await page.evaluate(() => window.__sceneState.battle.state)).toBe('SELECTING_TARGET');
  expect(await page.evaluate(() => window.__forecastChecks)).toEqual({
    gridMoves: 0,
    gridConfirms: 0,
    commits: 0,
    cancels: 1,
  });
  expect(errors).toEqual([]);
});

test('controller owns forecast reading, weapon rebuild, overlay recovery and one commit', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openForecast(page);
  const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
  expect(await owner(page)).toBe('forecast');
  for (let i = 0; i < 3; i++) await pad(page, 'NAVIGATE', { dy: -1 });
  await expect(dialog.getByRole('button', { name: 'Scroll forecast down' })).toBeFocused();
  await pad(page, 'CONFIRM');
  await expect
    .poll(() => dialog.locator('.mb-forecast-sides').evaluate((e) => e.scrollTop))
    .toBeGreaterThan(0);
  const before = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return { hp: s.selectedUnit.currentHP, weapon: s.selectedUnit.weapon.name };
  });
  await pad(page, 'NEXT_UNIT');
  await expect(dialog).toBeVisible();
  expect(await owner(page)).toBe('forecast');
  const after = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return { hp: s.selectedUnit.currentHP, weapon: s.selectedUnit.weapon.name };
  });
  expect(after.weapon).not.toBe(before.weapon);
  expect(after.hp).toBe(before.hp);
  await page.evaluate(async () => {
    const { MenuSurface } = await import('/src/ui/MenuSurface.js');
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    window.__forecastOverlay = new MenuSurface(
      s,
      'Forecast test overlay',
      () => window.__forecastOverlay.destroy(),
      { modal: true },
    );
  });
  expect(await owner(page)).toBe('other');
  await pad(page, 'CANCEL');
  await expect(dialog).toBeVisible();
  expect(await owner(page)).toBe('forecast');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  // The weapon stepper sits with the weapon; Confirm follows Cancel.
  await pad(page, 'NAVIGATE', { dy: 1 });
  await expect(dialog.getByRole('button', { name: 'Confirm attack' })).toBeFocused();
  await pad(page, 'CONFIRM');
  await expect(dialog).toHaveCount(0);
  expect(await owner(page)).toBe('battle');
  expect(await page.evaluate(() => window.__forecastChecks)).toEqual({
    gridMoves: 0,
    gridConfirms: 0,
    commits: 1,
    cancels: 0,
  });
  expect(errors).toEqual([]);
});

test('scene shutdown releases an open forecast scope and removes its controls', async ({
  page,
}) => {
  await openForecast(page);
  await page.evaluate(async () => {
    const { startSceneLazy } = await import('/src/utils/sceneLoader.js');
    await startSceneLazy(window.__emblemRogueGame.scene.getScene('Battle'), 'Title');
  });
  await waitForScene(page, 'Title');
  await expect(page.locator('.mb-forecast-backdrop')).toHaveCount(0);
  expect(await owner(page)).toBe('other');
});
