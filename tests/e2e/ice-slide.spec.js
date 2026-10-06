// Ice slides are priced (src/engine/IceMovement.js): stepping onto Ice costs the tile,
// the first tile slid past it is free, and each tile after that costs movement. A slide
// the unit can no longer pay for stops on the ice and ends the move. The blue range
// offers that tile, and a real tap on it moves the unit there and no farther, spending
// its whole allowance (so Canto has nothing left).
import { test, expect, devices } from '@playwright/test';
import { waitForGame, waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });

async function boot(page) {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42');
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
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
}

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

const state = (page) => page.evaluate(() => window.__sceneState.battle.state);

test('a slide the unit cannot pay for stops on the ice, in the range and on the move', async ({
  page,
}) => {
  await boot(page);
  // A straight ice lane from a ground unit, two tiles longer than its MOV can pay for:
  // entry 1, the next tile free, then 1 a tile, so MOV m stops m + 1 tiles out.
  const lane = await page.evaluate(() => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    b.registry.get('settings')?.setHints?.(false);
    const occupied = new Set(
      [...b.playerUnits, ...b.enemyUnits, ...(b.npcUnits || [])].map((u) => `${u.col},${u.row}`),
    );
    const open = (c, r) =>
      c >= 0 &&
      r >= 0 &&
      c < b.grid.cols &&
      r < b.grid.rows &&
      !occupied.has(`${c},${r}`) &&
      Number.isFinite(b.grid.getMoveCost(c, r, 'Infantry'));
    for (const unit of b.playerUnits) {
      if (unit.moveType === 'Flying' || !(unit.mov > 0)) continue;
      const length = unit.mov + 2;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const tiles = Array.from({ length }, (_, k) => [
          unit.col + dc * (k + 1),
          unit.row + dr * (k + 1),
        ]);
        if (!tiles.every(([c, r]) => open(c, r))) continue;
        for (const [c, r] of tiles) b.grid.setTemporaryTerrain(c, r, 'Ice', 3);
        const stop = tiles[unit.mov]; // m + 1 tiles out
        const beyond = tiles[unit.mov + 1];
        return {
          name: unit.name,
          mov: unit.mov,
          unit: { col: unit.col, row: unit.row },
          stop: { col: stop[0], row: stop[1] },
          beyond: { col: beyond[0], row: beyond[1] },
        };
      }
    }
    return null;
  });
  expect(lane, 'a ground unit with a clear lane').not.toBeNull();

  // Select the unit (a tap opens its menu in place; Back keeps it selected).
  await tapTile(page, lane.unit.col, lane.unit.row);
  await expect.poll(() => state(page)).toBe('UNIT_ACTION_MENU');
  await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect.poll(() => state(page)).toBe('UNIT_SELECTED');

  const range = await page.evaluate(
    ({ stop, beyond }) => {
      const b = window.__emblemRogueGame.scene.getScene('Battle');
      const at = (t) => b.movementRange.get(`${t.col},${t.row}`) || null;
      return { stop: at(stop), beyond: at(beyond) };
    },
    { stop: lane.stop, beyond: lane.beyond },
  );
  expect(range.stop).toMatchObject({ cost: lane.mov, slideStop: true });
  expect(range.beyond).toBeNull();

  await tapTile(page, lane.stop.col, lane.stop.row);
  await expect.poll(() => state(page)).toBe('UNIT_ACTION_MENU');
  const moved = await page.evaluate((name) => {
    const b = window.__emblemRogueGame.scene.getScene('Battle');
    const u = b.playerUnits.find((p) => p.name === name);
    return {
      col: u.col,
      row: u.row,
      terrain: b.grid.getTerrainAt(u.col, u.row).name,
      spent: u._movementSpent,
    };
  }, lane.name);
  expect(moved).toEqual({ ...lane.stop, terrain: 'Ice', spent: lane.mov });
});
