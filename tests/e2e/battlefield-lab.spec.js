import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
async function boot(page, query = '') {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1' + query);
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
  await expect(page.locator('.battlefield-lab')).toBeVisible();
  // Procedural terrain is the default renderer; ?terrainArt=weathered keeps the atlases.
  const renderer = new URLSearchParams(query).get('terrainArt') || 'procedural';
  await expect(page.locator('.battlefield-lab')).toHaveAttribute('data-terrain-art', renderer);
}
test('lab viewport remains stable through move and modal states', async ({ page }) => {
  await boot(page);
  const before = await page.locator('#game-container canvas').boundingBox();
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b.battleState = 'UNIT_MOVING';
    b._mobileBattleHud.sync();
  });
  await expect(page.locator('.mobile-battle-hud')).toBeVisible();
  expect(await page.locator('#game-container canvas').boundingBox()).toEqual(before);
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b.battleState = 'PLAYER_IDLE';
    b._mobileBattleHud.sync();
  });
  await page.getByRole('button', { name: 'Menu', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Paused', exact: true })).toBeVisible();
  expect(await page.locator('#game-container canvas').boundingBox()).toEqual(before);
  await page.getByRole('button', { name: 'Resume', exact: true }).tap();
  await page.screenshot({ path: 'test-results/battlefield-lab.png' });
});

async function tapTile(page, col, row) {
  const point = await page.evaluate(
    ({ col, row }) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const p = b.grid.gridToPixel(col, row);
      const screen = b._battleCamera.worldToScreen(p.x, p.y);
      const r = b.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (screen.x * r.width) / b.scale.width,
        y: r.y + (screen.y * r.height) / b.scale.height,
      };
    },
    { col, row },
  );
  await page.touchscreen.tap(point.x, point.y);
}

test('real touch movement, attack cancellation, combat and next turn remain playable', async ({
  page,
}) => {
  await boot(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const viewport = await page.locator('#game-container canvas').boundingBox();
  await tapTile(page, 6, 2);
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('UNIT_ACTION_MENU');
  await tapTile(page, 10, 2);
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('UNIT_ACTION_MENU');
  expect(await page.locator('#game-container canvas').boundingBox()).toEqual(viewport);
  // Target first: Attack goes straight to target selection.
  await page.getByRole('button', { name: 'Attack', exact: true }).tap();
  await tapTile(page, 10, 3);
  await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toHaveCount(0);
  await tapTile(page, 10, 3);
  await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toBeVisible();
  await page.screenshot({ path: 'test-results/battlefield-lab-forecast.png' });
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state), { timeout: 15000 })
    .toBe('PLAYER_IDLE');
  await page.getByRole('button', { name: 'End turn…', exact: true }).tap();
  await page.getByRole('button', { name: 'End turn now', exact: true }).tap();
  await expect
    .poll(
      () =>
        page.evaluate(
          () => window.__emblemRogueGame.scene.getScene('Battle').turnManager.turnNumber,
        ),
      { timeout: 15000 },
    )
    .toBe(2);
  expect(await page.locator('#game-container canvas').boundingBox()).toEqual(viewport);
  expect(errors).toEqual([]);
});

test('small phone commands fit, tiles stay square and cleanup restores the original game size', async ({
  page,
}) => {
  await page.setViewportSize({ width: 667, height: 375 });
  await boot(page);
  const canvas = await page.locator('#game-container canvas').boundingBox();
  const logical = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return { width: b.scale.width, height: b.scale.height };
  });
  expect(Math.abs(canvas.width / logical.width - canvas.height / logical.height)).toBeLessThan(
    0.002,
  );
  for (const name of ['Danger', 'Inspect', 'Roster', 'Rewind', 'End turn…', 'More', 'Menu']) {
    const button =
      name === 'More'
        ? page.locator('.mb-battle-info summary')
        : page.getByRole('button', { name, exact: true });
    const box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.y + box.height).toBeLessThanOrEqual(375);
    expect(box.x + box.width).toBeLessThanOrEqual(667);
  }
  await page.screenshot({ path: 'test-results/battlefield-lab-small.png' });
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b._mobileBattleHud.destroy();
    b._mobileBattleHud = null;
  });
  await expect(page.locator('.battlefield-lab')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scale;
      return [s.width, s.height];
    }),
  ).toEqual([640, 480]);
});

for (const template of [
  'river_crossing',
  'forest_ambush',
  'chokepoint',
  'corridor_siege',
  'castle_ruins',
  'mire_crossing',
  'frozen_pass',
  'glacier_run',
  'caldera',
  'magma_flow',
]) {
  test(`painted generated ${template} preserves terrain and accepts touch selection`, async ({
    page,
  }) => {
    await boot(page, `&labMap=${template}`);
    const before = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        layout: JSON.stringify(b.grid.mapLayout),
        names: b.grid.mapLayout.flat().map((i) => b.grid.terrainData[i].name),
        unit: { col: b.playerUnits[0].col, row: b.playerUnits[0].row },
        allPainted: b.grid.tiles.flat().every((t) => t.texture.key === b._battlefieldTerrain?.key),
      };
    });
    expect(before.allPainted).toBe(true);
    const expected = {
      chokepoint: 'Wall',
      river_crossing: 'Water',
      forest_ambush: 'Forest',
      corridor_siege: 'Floor',
      castle_ruins: 'Floor',
      mire_crossing: 'Swamp',
      frozen_pass: 'Ice',
      glacier_run: 'Ice',
      caldera: 'Lava Crack',
      magma_flow: 'Lava Crack',
    };
    expect(before.names).toContain(expected[template]);
    expect(
      await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').battleConfig.templateId,
      ),
    ).toBe(template);
    await tapTile(page, before.unit.col, before.unit.row);
    await expect
      .poll(() => page.evaluate(() => window.__sceneState.battle.state))
      .toBe('UNIT_ACTION_MENU');
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await expect
      .poll(() => page.evaluate(() => window.__sceneState.battle.state))
      .toBe('UNIT_SELECTED');
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    await expect
      .poll(() => page.evaluate(() => window.__sceneState.battle.state))
      .toBe('PLAYER_IDLE');
    expect(
      await page.evaluate(() =>
        JSON.stringify(window.__emblemRogueGame.scene.getScene('Battle').grid.mapLayout),
      ),
    ).toBe(before.layout);
    await page.screenshot({ path: `test-results/painted-${template}.png` });
  });
}

test('the weathered atlases remain available as a renderer', async ({ page }) => {
  await boot(page, '&labMap=river_crossing&terrainArt=weathered');
  expect(
    await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      return b.grid.tiles.flat().every((t) => t.texture.key === b._battlefieldTerrain?.key);
    }),
  ).toBe(true);
});

test('More stays anchored and closes from the same sidebar control', async ({ page }) => {
  await boot(page);
  const toggle = page.locator('.mb-battle-info summary');
  const before = await toggle.boundingBox();
  await toggle.tap();
  await expect(page.locator('.mb-more-content')).toBeVisible();
  expect(await toggle.boundingBox()).toEqual(before);
  await toggle.tap();
  await expect(page.locator('.mb-more-content')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Roster', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rewind', exact: true })).toBeVisible();
  await expect(page.locator('.mb-hint')).toHaveCount(0);
  await expect(page.getByText('Your battlefield', { exact: true })).toHaveCount(0);
  expect(await toggle.boundingBox()).toEqual(before);
});

test('touch Inspect opens ally and enemy details directly and selected-unit inspect preserves selection', async ({
  page,
}) => {
  await boot(page);
  for (const [col, row] of [
    [6, 2],
    [10, 3],
  ]) {
    await page.getByRole('button', { name: 'Inspect', exact: true }).tap();
    await tapTile(page, col, row);
    const dialog = page.getByRole('dialog', { name: 'Inspect roster' });
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').inspectionPanel.visible,
      ),
    ).toBe(false);
    await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    expect(
      await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').inspectMode),
    ).toBe(false);
  }
  await tapTile(page, 6, 2);
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await page.getByRole('button', { name: 'Inspect', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Inspect roster' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect
    .poll(() => page.evaluate(() => window.__sceneState.battle.state))
    .toBe('UNIT_SELECTED');
});

test('terrain advantages update on touch without persistent tutorial copy', async ({ page }) => {
  await boot(page);
  await tapTile(page, 2, 1);
  const terrain = page.locator('.mb-terrain');
  await expect(terrain).toContainText('Forest');
  await expect(terrain).toContainText('Move cost 2');
  await expect(terrain).toContainText('Def +1 · Avoid +20');
  await tapTile(page, 6, 2);
  await expect(terrain).toContainText('Plain');
  await expect(terrain).toContainText('Def +0 · Avoid +0');
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(page.locator('.mb-hint')).toHaveCount(0);
  for (const name of ['Roster', 'Rewind'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
});

for (const width of [844, 667])
  test(`ice effect stays readable at ${width}px without pushing idle commands out of view`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 667 ? 375 : 390 });
    await boot(page, '&labMap=frozen_pass');
    const tile = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      for (let row = 0; row < b.grid.rows; row++)
        for (let col = 0; col < b.grid.cols; col++)
          if (b.grid.getTerrainAt(col, row).name === 'Ice') return { col, row };
    });
    await page.evaluate((tile) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      b._mobileTerrainFocus = tile;
      b._mobileBattleHud.lastSnapshot = '';
      b._mobileBattleHud.sync();
    }, tile);
    await expect(page.locator('.mb-terrain')).toContainText('Slide straight until off ice');
    const more = await page.locator('.mb-battle-info summary').boundingBox();
    const tools = await page.locator('.bl-tools').boundingBox();
    expect(more.y + more.height).toBeLessThanOrEqual(tools.y);
  });
