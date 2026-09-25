import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ viewport: { width: 1280, height: 800 } });
test('desktop T toggles inspected threat independently of global Danger', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' && Boolean(s._playerTurnStartToken);
  });
  const position = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.enemyUnits[0],
      w = s.grid.gridToPixel(u.col, u.row),
      p = s._worldToScreen(w.x, w.y),
      r = s.game.canvas.getBoundingClientRect();
    return { x: r.x + (p.x * r.width) / s.scale.width, y: r.y + (p.y * r.height) / s.scale.height };
  });
  await page.mouse.click(position.x, position.y, { button: 'right' });
  await page.keyboard.press('t');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').pinnedThreatEnemies.size,
      ),
    )
    .toBe(1);
  await page.waitForTimeout(80); // Separate Phaser keyboard processing frames.
  await page.keyboard.press('d');
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').dangerZone.visible),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return s.dangerZone.tiles.every((t) => [0, 0.2, 0.3, 0.4].includes(t.fillAlpha));
    }),
  ).toBe(true);
  await page.waitForTimeout(1200); // Capture after the opening banner clears.
  await page.screenshot({ path: '/tmp/u7-global-and-pinned.png' });
  await page.keyboard.press('t');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').pinnedThreatEnemies.size,
      ),
    )
    .toBe(0);
  await page.reload();
  await waitForScene(page, 'Battle');
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').pinnedThreatEnemies.size,
      ),
    )
    .toBe(0);
  expect(errors).toEqual([]);
});
