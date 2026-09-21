import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
const url = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1';
async function boot(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  return { hud: page.getByRole('complementary', { name: 'Battle commands' }), errors };
}
async function tapTile(page, col, row) {
  const p = await page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(col, row),
        p = s._worldToScreen(w.x, w.y),
        r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
  await page.touchscreen.tap(p.x, p.y);
}
async function select(page, name) {
  const pos = await page.evaluate((name) => {
    const u = window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.find((u) => u.name === name);
    return { col: u.col, row: u.row };
  }, name);
  await tapTile(page, pos.col, pos.row);
}
test('mobile planning: switch, inspect, close, move and tap away', async ({ page }) => {
  const { errors } = await boot(page);
  const names = await page.evaluate(() =>
    window.__emblemRogueGame.scene
      .getScene('Battle')
      .playerUnits.slice(0, 2)
      .map((u) => u.name),
  );
  await select(page, names[0]);
  await select(page, names[1]);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
    )
    .toBe(names[1]);
  const empty = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    for (let row = 0; row < s.grid.rows; row++)
      for (let col = 0; col < s.grid.cols; col++) {
        if (!s.getUnitAt(col, row) && !s.movementRange.has(`${col},${row}`)) return { col, row };
      }
  });
  await tapTile(page, empty.col, empty.row);
  await expect
    .poll(() => page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState))
    .toBe('PLAYER_IDLE');
  await select(page, names[1]);
  const enemy = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.enemyUnits[0];
    return { col: u.col, row: u.row };
  });
  await tapTile(page, enemy.col, enemy.row);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          window.__emblemRogueGame.scene.getScene('Battle')._inputController._planningInspection,
        ),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: '/tmp/u6-inspection.png' });
  const before = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      name: s.selectedUnit.name,
      range: [...s.movementRange.keys()],
      highlights: s.grid.highlightTiles.length,
    };
  });
  await page.keyboard.press('Escape');
  expect(
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return {
        name: s.selectedUnit.name,
        range: [...s.movementRange.keys()],
        highlights: s.grid.highlightTiles.length,
      };
    }),
  ).toEqual(before);
  const destination = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    for (const [key, e] of s.movementRange) {
      const [col, row] = key.split(',').map(Number);
      if (e.stoppable !== false && !s.getUnitAt(col, row)) return { col, row };
    }
  });
  await tapTile(page, destination.col, destination.row);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.hasMoved),
    )
    .toBe(true);
  // Undo returns to UNIT_SELECTED. Opening the own-tile menu must restore
  // its pre-commit selection contract, not turn all grid taps into no-ops.
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect
    .poll(() => page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState))
    .toBe('UNIT_SELECTED');
  await select(page, names[1]);
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__emblemRogueGame.scene.getScene('Battle')._inputController.isSelectionMenu(),
      ),
    )
    .toBe(true);
  await select(page, names[0]);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
    )
    .toBe(names[0]);
  await tapTile(page, empty.col, empty.row);
  await expect
    .poll(() => page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').battleState))
    .toBe('PLAYER_IDLE');
  expect(errors).toEqual([]);
});

test('pinned enemy range survives planning and clears on death', async ({ page }) => {
  const { hud, errors } = await boot(page);
  const enemy = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return { col: s.enemyUnits[0].col, row: s.enemyUnits[0].row };
  });
  await tapTile(page, enemy.col, enemy.row);
  await hud.getByRole('button', { name: 'Pin range', exact: true }).click();
  await expect(hud.getByRole('button', { name: 'Unpin range', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return s._pinnedThreats.overlay.tiles.length;
      }),
    )
    .toBeGreaterThan(0);
  const name = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').playerUnits[0].name,
  );
  await select(page, name);
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').pinnedThreatEnemies.size,
      ),
    )
    .toBe(1);
  await page.screenshot({ path: '/tmp/u7-pinned-range.png' });
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.enemyUnits[0].currentHP = 0;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.__emblemRogueGame.scene.getScene('Battle').pinnedThreatEnemies.size,
      ),
    )
    .toBe(0);
  expect(errors).toEqual([]);
});
