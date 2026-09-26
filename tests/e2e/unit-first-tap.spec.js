import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

async function tilePoint(page, col, row) {
  return page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const world = s.grid.gridToPixel(col, row);
      const screen = s._worldToScreen(world.x, world.y);
      const r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (screen.x * r.width) / s.scale.width,
        y: r.y + (screen.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
}

for (const terrain of ['Forest', 'Mountain', 'Plain']) {
  test(`first tap on ${terrain} offers actions and terrain; destination tap still moves`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
    );
    const origin = await page.evaluate((terrain) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.playerUnits[0];
      const idx = s.grid.terrainData.findIndex((t) => t.name === terrain);
      s.grid.setTerrainAt(u.col, u.row, idx);
      return { col: u.col, row: u.row, name: u.name };
    }, terrain);
    const p = await tilePoint(page, origin.col, origin.row);
    await page.touchscreen.tap(p.x, p.y);
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await expect(hud.getByRole('button', { name: 'Item', exact: true })).toBeVisible();
    await expect(hud.locator('.mb-summary h2')).toHaveText(origin.name);
    await expect(hud.locator('.mb-terrain strong')).toHaveText(terrain);
    // The selection menu carries the "tap a blue tile" reminder, but on a screen this
    // short (375px) the reminder yields its row to the commands (#78).
    await expect(hud.getByText('Tap a blue tile to move.')).toHaveCount(1);
    await expect(hud.getByText('Tap a blue tile to move.')).toBeHidden();
    await page.screenshot({ path: `test-results/first-tap-actions-${terrain}.png` });
    const destination = await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const u = s.selectedUnit;
      const key = [...s.movementRange].find(([key, value]) => {
        const [col, row] = key.split(',').map(Number);
        return (
          value.stoppable !== false && (col !== u.col || row !== u.row) && !s.getUnitAt(col, row)
        );
      })[0];
      const [col, row] = key.split(',').map(Number);
      return { col, row };
    });
    const to = await tilePoint(page, destination.col, destination.row);
    await page.touchscreen.tap(to.x, to.y);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return { col: s.selectedUnit.col, row: s.selectedUnit.row, state: s.battleState };
        }),
      )
      .toEqual({ ...destination, state: 'UNIT_ACTION_MENU' });
    // A post-movement action menu cannot accept another destination.
    await page.touchscreen.tap(p.x, p.y);
    expect(
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return { col: s.selectedUnit.col, row: s.selectedUnit.row };
      }),
    ).toEqual(destination);
    await hud.getByRole('button', { name: 'Back', exact: true }).tap();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          return { col: s.selectedUnit.col, row: s.selectedUnit.row, state: s.battleState };
        }),
      )
      .toEqual({ col: origin.col, row: origin.row, state: 'UNIT_SELECTED' });
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/first-tap-${terrain}.png` });
  });
}
