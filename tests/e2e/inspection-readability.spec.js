import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('inspection uses readable sidebar details without a canvas popup; crit quip fits at top edge', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' && Boolean(s._playerTurnStartToken);
  });
  const position = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const unit = s.enemyUnits[0],
      pos = s.grid.gridToPixel(unit.col, unit.row);
    const p = s._worldToScreen(pos.x, pos.y),
      r = s.game.canvas.getBoundingClientRect();
    return { x: r.x + (p.x * r.width) / s.scale.width, y: r.y + (p.y * r.height) / s.scale.height };
  });
  await page.touchscreen.tap(position.x, position.y);
  const view = page.getByRole('button', { name: 'View unit details', exact: true });
  await expect(view).toBeVisible();
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('Battle').inspectionPanel.objects.length,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: 'Pin range', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Unpin range', exact: true })).toBeVisible();
  await view.click();
  await expect(page.locator('.mr-sheet')).toBeVisible();
  await page.locator('.mr-sheet').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(view).toBeVisible();
  const bounds = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { BattleBeatsController } = await import('/src/ui/BattleBeatsController.js');
    const beats = new BattleBeatsController(s);
    const point = s._screenToWorld(8, 8);
    const original = s.grid.gridToPixel;
    s.grid.gridToPixel = () => point;
    beats._showQuipText(s.playerUnits[0], 'For the banner!');
    s.grid.gridToPixel = original;
    const text = [...beats._live][0];
    const b = text.getBounds();
    return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: s.cameras.main.width };
  });
  expect(bounds.x).toBeGreaterThanOrEqual(7);
  expect(bounds.y).toBeGreaterThanOrEqual(7);
  expect(bounds.right).toBeLessThanOrEqual(bounds.width - 7);
  await page.screenshot({ path: '/tmp/build13-inspection-quip.png' });
  expect(errors).toEqual([]);
});
