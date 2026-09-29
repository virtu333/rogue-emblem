// Zombie remains upright (playtest 2026-09-29 #11; docs/portrait-battles.md): on the
// turned board the bone pile and its countdown sit on the Zombie's tile as drawn, the
// rail names them, and Smash works from the rail. Landscape and desktop:
// zombie-remains.spec.js. Failure modes:
//   - the pile drawn in the unturned cell (it would sit on another tile upright)
//   - the rail's tile card or Smash missing upright
//   - the count not following the enemy phases, or the last Smash not winning the Rout
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
import {
  PORTRAIT_PHONES,
  expectPortraitUi,
  phone as phoneContext,
  quietSettings,
} from './portraitHelpers.js';

// eslint-disable-next-line no-unused-vars
const phone = (viewport) => (({ defaultBrowserType, ...rest }) => rest)(phoneContext(viewport));

const ROUTE = '/?devScene=battle&preset=zombie_remains&seed=42';
test.setTimeout(120_000);
test.use(phone(PORTRAIT_PHONES[1]));

const rail = (page) => page.getByRole('complementary', { name: 'Battle commands' });

async function tap(page, col, row) {
  const p = await page.evaluate(
    ({ col, row }) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const w = s.grid.gridToPixel(col, row);
      const p = s._worldToScreen(w.x, w.y);
      const r = s.game.canvas.getBoundingClientRect();
      return {
        x: r.x + (p.x * r.width) / s.scale.width,
        y: r.y + (p.y * r.height) / s.scale.height,
      };
    },
    { col, row },
  );
  await page.touchscreen.tap(p.x, p.y);
}

const board = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const labels = (s.children?.list || []).filter((o) => o.name === 'remains-countdown');
    return {
      rotated: s.grid.board.rotated,
      records: (s._zombieTombstones || []).map((r) => [r.col, r.row, r.turnsRemaining]),
      shown: s._remainsCtrl?.markers?.shown || [],
      countdowns: labels.map((o) => o.text),
      state: s.battleState,
      phase: s.turnManager?.currentPhase,
      turn: s.turnManager?.turnNumber,
    };
  });

test('upright: fell the Zombie, the pile counts down on its turned tile, Smash wins', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await quietSettings(page);
  await page.goto(ROUTE);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return s.battleState === 'PLAYER_IDLE' && s._devScenarioResult;
  });
  await expectPortraitUi(page, true);
  const note = page.getByRole('button', { name: 'Continue', exact: true });
  if (await note.count()) await note.tap();
  const hud = rail(page);
  await expect(hud).toBeVisible();
  const { edric, spot } = await page.evaluate(() => {
    const r = window.__emblemRogueGame.scene.getScene('Battle')._devScenarioResult;
    return { edric: { col: r.unit.col, row: r.unit.row }, spot: r.spot };
  });

  await tap(page, edric.col, edric.row);
  await hud.getByRole('button', { name: 'Attack', exact: true }).tap();
  await tap(page, spot.col, spot.row);
  await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
  await expect
    .poll(async () => (await board(page)).records, { timeout: 30_000 })
    .toEqual([[spot.col, spot.row, 3]]);
  await expect.poll(async () => (await board(page)).countdowns).toEqual(['3']);

  // The pile sits in the turned cell of its tile, not where the unturned board had it.
  const placed = await page.evaluate(({ col, row }) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const g = s.grid;
    const unturned = {
      x: g.offsetX + col * 32 + 16,
      y: g.offsetY + row * 32 + 16,
    };
    const cell = g.board.toDisplay(col, row);
    return {
      shown: s._remainsCtrl.markers.shown[0],
      turned: { x: g.offsetX + cell.col * 32 + 16, y: g.offsetY + cell.row * 32 + 16 },
      unturned,
    };
  }, spot);
  expect((await board(page)).rotated).toBe(true);
  expect({ x: placed.shown.x, y: placed.shown.y }).toEqual(placed.turned);
  expect(placed.turned).not.toEqual(placed.unturned);
  await page.screenshot({ path: 'test-results/zombie-remains-portrait.png' });

  // The rail's tile card names the bones.
  await tap(page, spot.col, spot.row);
  await expect(hud.locator('.mb-remains')).toHaveText('Zombie remains · rises in 3 enemy phases');

  // One enemy phase: 2.
  await hud.getByRole('button', { name: 'End turn…', exact: true }).tap();
  await hud.getByRole('button', { name: 'End turn now', exact: true }).tap();
  await expect
    .poll(
      async () => {
        const b = await board(page);
        return [b.turn, b.phase, b.state, b.countdowns];
      },
      { timeout: 30_000 },
    )
    .toEqual([2, 'player', 'PLAYER_IDLE', ['2']]);

  // Smash from the rail; the last remains win the Rout.
  await tap(page, edric.col, edric.row);
  await hud.getByRole('button', { name: 'Smash', exact: true }).tap();
  await expect.poll(async () => (await board(page)).state).toBe('SELECTING_REMAINS_TARGET');
  await tap(page, spot.col, spot.row);
  await expect.poll(async () => (await board(page)).records).toEqual([]);
  expect((await board(page)).countdowns).toEqual([]);
  await expect.poll(async () => (await board(page)).state).toBe('BATTLE_END');
  expect(errors).toEqual([]);
});
