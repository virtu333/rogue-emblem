import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

async function bootBattle(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  // Reuse the deterministic deployment fixture pattern from battle-invariants.
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    if (battle.battleState !== 'DEPLOY_SELECTION') return;
    battle.children.list
      .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
      .at(-1)
      ?.emit('pointerdown');
  });
  await expect(page.getByRole('complementary', { name: 'Battle commands' })).toBeVisible();
}

async function prepareMenu(page) {
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => u.currentHP > 0 && !u.hasActed);
    battle.selectUnit(unit);
    battle.showActionMenu(unit);
  });
}

async function prepareForecast(page) {
  await page.evaluate(async () => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => u.weapon && u.weapon.type !== 'Staff');
    const enemy = battle.enemyUnits.find((u) => u.currentHP > 0);
    // Place the fixture in combat range; real forecast/weapon logic is retained.
    unit.col = Math.max(0, enemy.col - 1);
    unit.row = enemy.row;
    if (unit.col === enemy.col) unit.col += 1;
    battle.selectUnit(unit);
    battle.hideActionMenu();
    await battle.showForecast(unit, enemy);
  });
  await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toBeVisible();
}

test('commands have readable targets, toggle feedback and reversible end-turn confirmation', async ({
  page,
}) => {
  await bootBattle(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Danger', exact: true }).tap();
  await expect(hud.getByRole('button', { name: 'Danger', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
  await expect(hud.getByRole('button', { name: 'End turn now' })).toBeVisible();
  expect(await page.evaluate(() => window.__sceneState.battle.state)).toBe('PLAYER_IDLE');
  await hud.getByRole('button', { name: 'Keep playing' }).tap();
  await expect(hud.getByRole('button', { name: 'End turn…', exact: true })).toBeVisible();
  const metrics = await hud.getByRole('button').evaluateAll((buttons) =>
    buttons.map((b) => ({
      height: b.getBoundingClientRect().height,
      font: parseFloat(getComputedStyle(b).fontSize),
    })),
  );
  expect(metrics.every((m) => m.height >= 44)).toBe(true);
  const commandFonts = await hud
    .locator('.mb-body button')
    .evaluateAll((buttons) => buttons.map((b) => parseFloat(getComputedStyle(b).fontSize)));
  expect(commandFonts.every((font) => font >= 13)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-battle-commands.png' });
});

test('action list invokes the existing Wait action and releases it afterward', async ({ page }) => {
  await bootBattle(page);
  await prepareMenu(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toBeVisible();
  const name = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit.name,
  );
  await page.screenshot({ path: 'test-results/mobile-battle-actions.png' });
  await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          window.__emblemRogueGame.scene.getScene('Battle').playerUnits.find((u) => u.name === name)
            .hasActed,
        name,
      ),
    )
    .toBe(true);
  await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toHaveCount(0);
});

test('forecast requires explicit confirmation, keeps engine numbers and cancels back to actions', async ({
  page,
}) => {
  await bootBattle(page);
  await prepareForecast(page);
  const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
  await expect(dialog).toHaveCSS('display', 'flex');
  await expect(dialog).toHaveCSS('flex-direction', 'column');
  await expect(dialog).toHaveCSS('padding', '14px');
  await expect(dialog).toHaveCSS('border-top-width', '1px');
  expect(await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  );
  const portrait = dialog.locator('.mb-portrait').first();
  await expect(portrait).toBeVisible();
  await expect(portrait).toHaveCSS('width', '48px');
  await expect(portrait).toHaveCSS('height', '48px');
  await expect(portrait).toHaveCSS('image-rendering', 'pixelated');
  const expected = await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const f = battle._mobileBattleHud.forecast.forecast.attacker;
    battle.handleForecastClick({ col: battle.forecastTarget.col, row: battle.forecastTarget.row });
    return { damage: `${f.damage} × ${f.attackCount || 1}`, state: battle.battleState };
  });
  expect(expected.state).toBe('SHOWING_FORECAST');
  await expect(dialog.locator('.mb-ally')).toContainText(expected.damage);
  await page.screenshot({ path: 'test-results/mobile-battle-forecast.png' });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('SELECTING_TARGET');
  await page
    .getByRole('navigation', { name: 'Battle utilities' })
    .getByRole('button', { name: 'Back', exact: true })
    .tap();
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('UNIT_ACTION_MENU');
});

test('small phones keep long forecasts scrollable with confirmation visible', async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await bootBattle(page);
  await prepareForecast(page);
  await page.evaluate(() => {
    const hud = window.__emblemRogueGame.scene.getScene('Battle')._mobileBattleHud;
    const config = hud.forecast;
    const attacker = { ...config.attacker, name: 'A very long commander name' };
    const forecast = {
      ...config.forecast,
      attacker: { ...config.forecast.attacker, warnings: Array(10).fill('Extra combat warning') },
    };
    hud.showForecast({ ...config, attacker, forecast });
  });
  const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
  const button = dialog.getByRole('button', { name: 'Confirm attack' });
  const box = await button.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(375);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(
    await dialog.locator('.mb-forecast-sides').evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-battle-small-phone.png' });
});

test('higher overlays own input and scene shutdown removes the mobile layer', async ({ page }) => {
  await bootBattle(page);
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Roster', exact: true }).tap();
  // Keep the map viewport stable while a higher sheet owns input.
  // Covered controls are deliberately hidden from the accessibility tree.
  await expect(
    page.getByRole('complementary', { name: 'Battle commands', includeHidden: true }),
  ).toHaveClass(/bl-inactive/);
  await expect(hud).toHaveCount(0);
  const roster = page.getByRole('dialog', { name: 'Inspect roster', exact: true });
  await expect(roster).toBeVisible();
  await roster.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(hud).not.toHaveClass(/bl-inactive/);
  await expect(hud).toBeVisible();
  await page.evaluate(async () => {
    const { startSceneLazy } = await import('/src/utils/sceneLoader.js');
    await startSceneLazy(window.__emblemRogueGame.scene.getScene('Battle'), 'Title');
  });
  await waitForScene(page, 'Title');
  await expect(hud).toHaveCount(0);
  await expect(page.locator('.mb-forecast-backdrop')).toHaveCount(0);
  await expect(page.locator('#game-wrapper')).not.toHaveClass(/mobile-battle-layout/);
});

test('confirming the forecast commits combat once and removes the dialog', async ({ page }) => {
  await bootBattle(page);
  await prepareForecast(page);
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const original = battle.executeCombat.bind(battle);
    window.__mobileCombatCommits = 0;
    battle.executeCombat = (...args) => {
      window.__mobileCombatCommits += 1;
      return original(...args);
    };
  });
  await page
    .getByRole('dialog', { name: 'Combat forecast' })
    .getByRole('button', { name: 'Confirm attack' })
    .tap();
  await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toHaveCount(0);
  expect(await page.evaluate(() => window.__mobileCombatCommits)).toBe(1);
});

test('forecast weapon cycling updates the preview without committing combat', async ({ page }) => {
  await bootBattle(page);
  await prepareForecast(page);
  const before = await page.locator('.mb-ally .mb-weapon').innerText();
  await page
    .getByRole('dialog', { name: 'Combat forecast' })
    .getByRole('button', { name: 'Weapon ›', exact: true })
    .tap();
  await expect(page.locator('.mb-ally .mb-weapon')).not.toHaveText(before);
  expect(await page.evaluate(() => window.__sceneState.battle.state)).toBe('SHOWING_FORECAST');
});

test('real map taps select a unit and open its touch action list', async ({ page }) => {
  await bootBattle(page);
  const position = await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = battle.playerUnits.find((u) => u.currentHP > 0 && !u.hasActed);
    const world = battle.grid.gridToPixel(unit.col, unit.row);
    const screen = battle._worldToScreen(world.x, world.y);
    const canvas = battle.game.canvas.getBoundingClientRect();
    return {
      name: unit.name,
      x: canvas.x + (screen.x * canvas.width) / battle.scale.width,
      y: canvas.y + (screen.y * canvas.height) / battle.scale.height,
    };
  });
  await page.touchscreen.tap(position.x, position.y);
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('UNIT_ACTION_MENU');
  await expect(page.locator('.mb-summary h2')).toHaveText(position.name);
  await expect(
    page
      .getByRole('complementary', { name: 'Battle commands' })
      .getByRole('button', { name: 'Wait', exact: true }),
  ).toBeVisible();
});

test('small landscape canvas fits its container when touch panels are present', async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await bootBattle(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const parent = document.getElementById('game-container').getBoundingClientRect();
        const canvas = document.querySelector('#game-container canvas').getBoundingClientRect();
        return (
          canvas.left >= parent.left - 1 &&
          canvas.right <= parent.right + 1 &&
          canvas.top >= parent.top - 1 &&
          canvas.bottom <= parent.bottom + 1
        );
      }),
    )
    .toBe(true);
});
