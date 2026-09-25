import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

// Portrait battles (beta): an upright phone draws the board turned a quarter with the
// player's side at the bottom; taps, commands and the rotate prompt follow.
test.use({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });

async function bootBattle(page, query = '&portrait=1') {
  await page.goto(`/?devScene=battle&preset=battle_smoke&seed=42${query}`);
  await waitForGame(page);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() =>
    ['DEPLOY_SELECTION', 'PLAYER_IDLE'].includes(window.__sceneState?.battle?.state),
  );
  await page.evaluate(() => {
    const battle = window.__emblemRogueGame.scene.getScene('Battle');
    if (battle.battleState !== 'DEPLOY_SELECTION') return;
    battle.children.list
      .filter((o) => o.type === 'Rectangle' && o.input?.enabled && o.listenerCount('pointerdown'))
      .at(-1)
      ?.emit('pointerdown');
  });
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
}

// CSS point at the center of a grid tile, through the live camera and canvas scale.
function tileCss(page, col, row) {
  return page.evaluate(
    ([col, row]) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const world = b.grid.gridToPixel(col, row);
      const screen = b._worldToScreen(world.x, world.y);
      const rect = b.game.canvas.getBoundingClientRect();
      return {
        x: rect.left + (screen.x * rect.width) / b.scale.width,
        y: rect.top + (screen.y * rect.height) / b.scale.height,
      };
    },
    [col, row],
  );
}

function battleSnapshot(page) {
  return page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    return {
      rotation: b.grid.board.rotation,
      state: b.battleState,
      units: [...b.playerUnits, ...b.enemyUnits].map((u) => [
        u.name,
        u.col,
        u.row,
        u.currentHP,
        Boolean(u.hasActed),
      ]),
      rng: b._battleRng?.getState?.(),
    };
  });
}

test('upright phone plays on a turned board with thumb-reach commands', async ({ page }) => {
  await bootBattle(page);
  const info = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const player = b.playerUnits.map((u) => b.grid.gridToPixel(u.col, u.row).y);
    const enemy = b.enemyUnits.map((u) => b.grid.gridToPixel(u.col, u.row).y);
    return {
      rotation: b.grid.board.rotation,
      canvas: [b.scale.width, b.scale.height],
      playerBelowEnemies: Math.min(...player) > Math.max(...enemy),
      prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
      classes: document.documentElement.className,
    };
  });
  expect(info.rotation).toBe('ccw');
  expect(info.canvas[1]).toBeGreaterThan(info.canvas[0]);
  expect(info.playerBelowEnemies).toBe(true);
  expect(info.prompt).toBe('none');
  expect(info.classes).toContain('portrait-battle');

  // The rail sits under the map and every main command is on screen.
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  const endTurn = hud.getByRole('button', { name: 'End turn…', exact: true });
  await expect(endTurn).toBeInViewport({ ratio: 1 });
  const canvasBox = await page.locator('#game-container canvas').boundingBox();
  const hudBox = await hud.boundingBox();
  expect(hudBox.y).toBeGreaterThanOrEqual(canvasBox.y + canvasBox.height - 1);
  for (const name of ['Overview', 'Recenter', 'Back', 'Menu'])
    await expect(hud.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });

  // Real taps on the turned board select the unit and move it to the tapped tile.
  const unit = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((x) => x.currentHP > 0 && !x.hasActed);
    const occupied = new Set([...b.playerUnits, ...b.enemyUnits].map((x) => `${x.col},${x.row}`));
    let dest = null;
    for (const key of b.grid.getMovementRange(u.col, u.row, u.stats.MOV, u.moveType).keys()) {
      if (occupied.has(key)) continue;
      const [col, row] = key.split(',').map(Number);
      if (!dest || col > dest.col) dest = { col, row };
    }
    return { name: u.name, col: u.col, row: u.row, dest };
  });
  let point = await tileCss(page, unit.col, unit.row);
  await page.touchscreen.tap(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').selectedUnit?.name),
    )
    .toBe(unit.name);
  point = await tileCss(page, unit.dest.col, unit.dest.row);
  await page.touchscreen.tap(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate((name) => {
        const u = window.__emblemRogueGame.scene
          .getScene('Battle')
          .playerUnits.find((x) => x.name === name);
        return [u.col, u.row];
      }, unit.name),
    )
    .toEqual([unit.dest.col, unit.dest.row]);
  await expect(hud.getByRole('button', { name: 'Wait', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await page.screenshot({ path: 'test-results/portrait-battle-actions.png' });
});

test('turning the phone re-opens the battle exactly as it stood', async ({ page }) => {
  await bootBattle(page);
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((x) => !x.hasActed);
    b.selectUnit(u);
    b.showActionMenu(u);
  });
  const hud = page.getByRole('complementary', { name: 'Battle commands' });
  await hud.getByRole('button', { name: 'Wait', exact: true }).tap();
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  const before = await battleSnapshot(page);
  expect(before.rotation).toBe('ccw');

  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('none');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  const landscape = await battleSnapshot(page);
  expect(landscape.units).toEqual(before.units);
  expect(landscape.rng).toEqual(before.rng);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('ccw');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  const upright = await battleSnapshot(page);
  expect(upright.units).toEqual(before.units);
  expect(upright.rng).toEqual(before.rng);
});

test('a turn mid-action waits for the next safe moment', async ({ page }) => {
  await bootBattle(page);
  await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((x) => !x.hasActed);
    b.selectUnit(u);
    b.showActionMenu(u);
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.portrait-battle-notice')).toContainText('when your turn is ready');
  expect((await battleSnapshot(page)).rotation).toBe('ccw');
  await page
    .getByRole('complementary', { name: 'Battle commands' })
    .getByRole('button', { name: 'Back', exact: true })
    .tap();
  await expect.poll(async () => (await battleSnapshot(page)).rotation).toBe('none');
});

test('without the opt-in an upright phone still asks for landscape', async ({ page }) => {
  await bootBattle(page, '&portrait=0');
  const info = await page.evaluate(() => ({
    rotation: window.__emblemRogueGame.scene.getScene('Battle').grid.board.rotation,
    prompt: getComputedStyle(document.getElementById('rotate-prompt')).display,
  }));
  expect(info).toEqual({ rotation: 'none', prompt: 'flex' });
});
