import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// Formation: with 3+ units the army waits off the field and the player chooses who
// stands on which spawn tile before turn 1. Dev routes skip it unless formation=1.
// eslint-disable-next-line no-unused-vars
const { defaultBrowserType, ...IPHONE } = devices['iPhone 13'];
const PHONE = '/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&formation=1';
const DESKTOP = '/?devScene=battle&preset=combat_actions&seed=42&formation=1';

const battle = (page, fn, arg) =>
  page.evaluate(
    ([source, a]) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return new Function('s', 'a', source)(s, a);
    },
    [fn, arg],
  );

async function ready(page, url) {
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle')._formation?.ready === true,
    null,
    { timeout: 30_000 },
  );
}

/** Page coordinates of formation tile i (world → canvas → page). */
function tileOnPage(page, i) {
  return battle(
    page,
    `const t = s._formation.tiles[a];
     const w = s.grid.gridToPixel(t.col, t.row);
     const p = s._worldToScreen(w.x, w.y);
     const r = s.game.canvas.getBoundingClientRect();
     return { x: r.left + p.x * r.width / s.scale.width, y: r.top + p.y * r.height / s.scale.height };`,
    i,
  );
}

const snapshot = (page) =>
  battle(
    page,
    `const f = s._formation;
     return {
       state: s.battleState,
       onField: s.playerUnits.map((u) => u.name),
       at: f ? f.formation.at : null,
       names: f ? f.units.map((u) => u.name) : null,
       tiles: f ? f.tiles.length : null,
       hidden: f ? f.units.filter((u) => u.graphic && !u.graphic.visible).map((u) => u.name) : null,
     };`,
  );

test.describe('phone', () => {
  test.use({ ...IPHONE, viewport: { width: 844, height: 390 } });

  test('the army waits off the field; tiles and the bench place units, then Start begins turn 1', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await ready(page, PHONE);
    const rail = page.getByRole('complementary', { name: 'Battle commands' });
    let snap = await snapshot(page);
    // 5 units + a cushion of max(2, ceil(5/2)) = 3 spare tiles; nobody on the field.
    expect(snap).toMatchObject({ state: 'DEPLOY_POSITIONING', onField: [], tiles: 8 });
    expect(snap.hidden).toEqual(snap.names);
    await expect(rail).toContainText('0 / 5 placed');
    await expect(rail.getByRole('button', { name: /^Start battle/ })).toBeDisabled();

    // Tap tile 2 → "Who stands here?" → Edric.
    let at = await tileOnPage(page, 2);
    await page.touchscreen.tap(at.x, at.y);
    const picker = page.getByRole('dialog', { name: 'Who stands here?', exact: true });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: /^Edric/ }).tap();
    await expect(picker).toHaveCount(0);
    snap = await snapshot(page);
    expect(snap.at[0]).toBe(2);
    expect(snap.onField).toEqual(['Edric']);

    // Bench flow: tap Sera's chip, then Edric's tile — Sera takes it, Edric waits again.
    await rail.getByRole('button', { name: /^Sera,/ }).tap();
    await expect(rail).toContainText('Tap a blue tile for Sera.');
    await page.touchscreen.tap(at.x, at.y);
    snap = await snapshot(page);
    expect(snap.at.slice(0, 2)).toEqual([null, 2]);
    expect(snap.onField).toEqual(['Sera']);

    // Picking a placed unit for another tile moves it there.
    at = await tileOnPage(page, 5);
    await page.touchscreen.tap(at.x, at.y);
    await picker.getByRole('button', { name: /^Sera · move here/ }).tap();
    snap = await snapshot(page);
    expect(snap.at[1]).toBe(5);

    // Auto-place fills the rest; the player's choice stays.
    await rail.getByRole('button', { name: 'Auto-place', exact: true }).tap();
    snap = await snapshot(page);
    expect(snap.at.every((t) => t !== null)).toBe(true);
    expect(snap.at[1]).toBe(5);
    expect(new Set(snap.at).size).toBe(5);
    await expect(rail).toContainText('5 / 5 placed');

    const chosen = await battle(
      page,
      `const f = s._formation; return f.units.map((u, i) => [u.name, f.tiles[f.formation.at[i]]]);`,
    );
    await rail.getByRole('button', { name: 'Start battle', exact: true }).tap();
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
    const after = await battle(
      page,
      `return {
         turn: s.turnManager.turnNumber,
         units: s.playerUnits.map((u) => [u.name, { col: u.col, row: u.row }]),
         visible: s.playerUnits.every((u) => u.graphic?.visible !== false),
         formation: Boolean(s._formation?.active),
       };`,
    );
    expect(after).toMatchObject({ turn: 1, visible: true, formation: false });
    // Same roster order, each unit on the tile chosen for it.
    expect(after.units).toEqual(chosen);
    expect(errors).toEqual([]);
  });

  test('tap a placed unit to pick it up: move it, swap it, open its menu, send it to wait', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await ready(page, PHONE);
    const rail = page.getByRole('complementary', { name: 'Battle commands' });
    await rail.getByRole('button', { name: 'Auto-place', exact: true }).tap();
    let snap = await snapshot(page);
    expect(snap.at.every((t) => t !== null)).toBe(true);
    const free = [...Array(snap.tiles).keys()].filter((t) => !snap.at.includes(t));
    const tapTile = async (t) => {
      const at = await tileOnPage(page, t);
      await page.touchscreen.tap(at.x, at.y);
    };
    const held = () => battle(page, 'return s._formation.heldUnit?.name ?? null;');
    const reach = () =>
      battle(
        page,
        `const r = s._formation.reachTiles(); return r ? r.move.length + r.attack.length : 0;`,
      );

    // Tap Edric: he is picked up (no picker), his turn-1 reach shows, the rail says what to do.
    const edric = snap.at[0];
    await tapTile(edric);
    expect(await held()).toBe('Edric');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await reach()).toBeGreaterThan(0);
    await expect(rail).toContainText('Move Edric: tap a tile, or a unit to swap.');

    // An empty tile: he moves there and is set down.
    await tapTile(free[0]);
    snap = await snapshot(page);
    expect(snap.at[0]).toBe(free[0]);
    expect(await held()).toBeNull();
    expect(await reach()).toBe(0);

    // Edric onto Sera: they trade tiles.
    const sera = snap.at[1];
    await tapTile(free[0]);
    await tapTile(sera);
    snap = await snapshot(page);
    expect([snap.at[0], snap.at[1]]).toEqual([sera, free[0]]);

    // Edric twice: his menu. Close keeps him in hand; Cancel on the rail sets him down.
    await tapTile(sera);
    await tapTile(sera);
    const menu = page.getByRole('dialog', { name: 'Edric', exact: true });
    await expect(menu).toBeVisible();
    await menu.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(menu).toHaveCount(0);
    expect(await held()).toBe('Edric');
    await rail.getByRole('button', { name: 'Cancel', exact: true }).tap();
    expect(await held()).toBeNull();

    // The menu sends him back to wait; then a waiting unit's chip is placed as before.
    await tapTile(sera);
    await tapTile(sera);
    await menu.getByRole('button', { name: 'Send Edric back to wait', exact: true }).tap();
    await expect(menu).toHaveCount(0);
    snap = await snapshot(page);
    expect(snap.at[0]).toBeNull();
    await expect(rail).toContainText('4 / 5 placed');

    // A placed unit in hand + Edric's chip: Edric takes that unit's tile and it waits.
    const third = snap.at[2];
    await tapTile(third);
    expect(await held()).toBe(snap.names[2]);
    await rail.getByRole('button', { name: /^Edric,/ }).tap();
    snap = await snapshot(page);
    expect(snap.at[0]).toBe(third);
    expect(snap.at[2]).toBeNull();

    // Remove on the rail sends the unit in hand back to wait.
    await tapTile(third);
    await rail.getByRole('button', { name: 'Remove', exact: true }).tap();
    snap = await snapshot(page);
    expect(snap.at[0]).toBeNull();
    expect(await held()).toBeNull();
    expect(errors).toEqual([]);
  });

  test('a tile a unit cannot stand on is offered but blocked, with the reason', async ({
    page,
  }) => {
    await ready(page, PHONE);
    await battle(
      page,
      `const f = s._formation;
       const t = f.tiles[0];
       const mountain = s.gameData.terrain.findIndex((x) => x.name === 'Mountain');
       f.ctx.mapLayout[t.row][t.col] = mountain;
       return import('/src/engine/FormationPlacement.js').then((m) => {
         f.rules = m.createStandingRules(f.ctx, f.tiles);
         f.units[2].moveType = 'Cavalry';
       });`,
    );
    const at = await tileOnPage(page, 0);
    await page.touchscreen.tap(at.x, at.y);
    const picker = page.getByRole('dialog', { name: 'Who stands here?', exact: true });
    const blocked = picker.getByRole('button', { name: /^Utility/ });
    await expect(blocked).toBeDisabled();
    await expect(blocked).toContainText("Cavalry units can't stand on Mountain.");
    await expect(picker.getByRole('button', { name: /^Edric/ })).toBeEnabled();
    await picker.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(picker).toHaveCount(0);
    expect((await snapshot(page)).state).toBe('DEPLOY_POSITIONING');
  });
});

test('desktop: the dock stays off the map, Esc opens the formation menu, Start needs everyone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, DESKTOP);
  const dock = page.getByRole('region', { name: 'Formation' });
  await expect(dock).toBeVisible();
  // The dock never covers a formation tile.
  const box = await dock.boundingBox();
  for (let i = 0; i < 8; i++) {
    const t = await tileOnPage(page, i);
    const inside =
      t.x >= box.x && t.x <= box.x + box.width && t.y >= box.y && t.y <= box.y + box.height;
    expect(inside, `tile ${i} under the dock`).toBe(false);
  }
  await expect(dock.getByRole('button', { name: /^Start battle/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Formation', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Auto-place', exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(dock).toContainText('5 / 5 placed');
  await dock.getByRole('button', { name: 'Start battle', exact: true }).click();
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  await expect(page.locator('.fm-dock')).toHaveCount(0);
  expect(await battle(page, 'return s.playerUnits.length;')).toBe(5);
});

test('desktop: click a placed unit to pick it up; Esc closes its menu, then sets it down', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, DESKTOP);
  const dock = page.getByRole('region', { name: 'Formation' });
  await dock.getByRole('button', { name: 'Auto-place', exact: true }).click();
  const snap = await snapshot(page);
  const at = await tileOnPage(page, snap.at[1]);
  await page.mouse.click(at.x, at.y);
  expect(await battle(page, 'return s._formation.heldUnit?.name ?? null;')).toBe('Sera');
  await dock.getByRole('button', { name: 'Options', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Sera', exact: true });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  expect(await battle(page, 'return s._formation.heldUnit?.name ?? null;')).toBe('Sera');
  await page.keyboard.press('Escape');
  expect(await battle(page, 'return s._formation.heldUnit?.name ?? null;')).toBeNull();
  // Nothing held: Esc opens the formation menu, as before.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Formation', exact: true })).toBeVisible();
});

test('dev routes without formation=1 still start on turn 1', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42');
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
  expect(await battle(page, 'return [s._formation, s.playerUnits.length];')).toEqual([null, 5]);
});
