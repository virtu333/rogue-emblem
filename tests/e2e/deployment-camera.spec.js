import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 667, height: 375 } });
for (const map of ['corridor_siege', 'magma_flow']) {
  test(`${map}: readable deployment, overview, recenter and resize`, async ({ page }) => {
    await page.goto(`/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1&labMap=${map}`);
    await waitForGame(page);
    await waitForScene(page, 'Battle');
    await expect(page.getByRole('button', { name: 'Recenter', exact: true })).toBeVisible();
    const read = () =>
      page.evaluate(() => {
        const b = window.__emblemRogueGame.scene.getScene('Battle'),
          c = b.cameras.main;
        const rect = b.game.canvas.getBoundingClientRect();
        return {
          zoom: c.zoom,
          min: b._battleCamera.minZoom,
          x: c.scrollX + c.width / 2,
          y: c.scrollY + c.height / 2,
          tile: (32 * c.zoom * rect.height) / b.scale.height,
          minTile: (32 * b._battleCamera.minZoom * rect.height) / b.scale.height,
        };
      });
    expect((await read()).tile).toBeGreaterThanOrEqual(29.9);
    await page.getByRole('button', { name: 'Overview', exact: true }).tap();
    expect((await read()).zoom).toBeCloseTo((await read()).min);
    await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      b.selectUnit(b.playerUnits[1]);
      b._mobileBattleHud.sync();
    });
    await page.getByRole('button', { name: 'Recenter', exact: true }).tap();
    const visible = await page.evaluate(() => {
      const b = window.__emblemRogueGame.scene.getScene('Battle'),
        u = b.selectedUnit;
      const p = b.grid.gridToPixel(u.col, u.row),
        s = b._battleCamera.worldToScreen(p.x, p.y),
        c = b.cameras.main;
      return s.x >= 0 && s.x <= c.width && s.y >= 0 && s.y <= c.height;
    });
    expect(visible).toBe(true);
    expect((await read()).tile).toBeGreaterThanOrEqual(33.9);
    await page.getByRole('button', { name: 'Back', exact: true }).tap();
    const before = await read();
    await page.getByRole('button', { name: 'Menu', exact: true }).tap();
    await page.getByRole('button', { name: 'Resume', exact: true }).tap();
    expect(await read()).toEqual(before);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect
      .poll(async () => {
        const view = await read();
        return view.tile - Math.max(before.tile, view.minTile);
      })
      .toBeCloseTo(0, 1);
    const buttons = await page.locator('.bl-tools button').evaluateAll((es) =>
      es.map((e) => ({
        w: e.getBoundingClientRect().width,
        h: e.getBoundingClientRect().height,
      })),
    );
    for (const b of buttons) {
      expect(b.w).toBeGreaterThanOrEqual(44);
      expect(b.h).toBeGreaterThanOrEqual(44);
    }
  });
}
