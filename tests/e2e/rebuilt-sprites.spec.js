import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
test('rebuilt sprites load with tile anchors and remain aligned after rewind', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits?.length > 0,
  );
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    if (b.battleState === 'DEPLOY_SELECTION')
      b.children.list
        .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
        .at(-1)
        ?.emit('pointerdown');
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b.selectUnit(b.playerUnits[0]);
    b.moveUnit(b.playerUnits[0], 7, 2);
  });
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
  );
  const moved = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle'),
      u = b.playerUnits[0];
    return { col: u.col, x: u.graphic.x, expected: b.grid.gridToPixel(7, 2).x };
  });
  expect(moved.col).toBe(7);
  expect(moved.x).toBe(moved.expected);
  expect(
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('Battle').executeVisionRewind(),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].col),
  ).toBe(6);
  const result = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return [...b.playerUnits, ...b.enemyUnits].map((u) => ({
      name: u.name,
      className: u.className,
      key: u.graphic.texture.key,
      width: u.graphic.displayWidth,
      x: u.graphic.x,
      y: u.graphic.y,
      pos: b.grid.gridToPixel(u.col, u.row),
    }));
  });
  for (const u of result) {
    expect(u.key, JSON.stringify(u)).toMatch(/^rebuilt-/);
    expect(u.width).toBe(64);
    expect(u.x).toBe(u.pos.x);
    expect(u.y).toBe(u.pos.y);
  }
});
test('classic comparison does not load rebuilt textures', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1&spriteArt=classic');
  await waitForScene(page, 'Battle');
  expect(
    await page.evaluate(() =>
      Object.keys(window.__emblemRogueGame.textures.list).filter((k) => k.startsWith('rebuilt-')),
    ),
  ).toEqual([]);
});
