// Blink Strike in the browser (docs/specs/phase3.md 3E): Ability → Blink Strike → a destination
// → a foe → the forecast, read from the destination → Confirm, as ONE action; Cancel steps back
// one stage and nothing has moved until Confirm. On the phone (taps on the board and the rail's
// Confirm / Cancel) and on the desktop (canvas menu, mouse clicks, Enter / Escape).
//
// The board is the combat_actions lab: Edric (3,3) with an Iron Sword, a Knight beside him at
// (4,3), a Fighter at (6,4). Edric is given Blink Strike here (the lab's own loadout stays as the
// other specs read it). Warping beside the Fighter at (5,4) is three tiles away.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// A phone profile without its default browser (a describe group cannot switch it).
// eslint-disable-next-line no-unused-vars
const { defaultBrowserType, ...phone } = devices['iPhone SE'];
const url = '/?devScene=battle&preset=combat_actions&seed=42&battleLab=1';

async function boot(page, extra = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url + extra);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const edric = s.playerUnits.find((u) => u.name === 'Edric');
    edric.skills = [...edric.skills, 'blink_strike'];
  });
  return errors;
}

/** The viewport position of a board tile (a tap or a click lands on it). */
async function tilePoint(page, col, row) {
  return page.evaluate(
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
}

const battle = (page, read) =>
  page.evaluate((src) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    return new Function('s', `return (${src})(s)`)(s);
  }, read.toString());

const edric = (page) =>
  battle(page, (s) => {
    const u = s.playerUnits.find((x) => x.name === 'Edric');
    return {
      col: u.col,
      row: u.row,
      acted: u.hasActed,
      hp: u.currentHP,
      usage: u._battleAbilityUsage?.map?.blink_strike ?? 0,
    };
  });
const fighterHP = (page) =>
  battle(page, (s) => s.enemyUnits.find((x) => x.className === 'Fighter').currentHP);
const state = (page) => battle(page, (s) => s.battleState);

test.describe('on the phone', () => {
  test.use({ ...phone, viewport: { width: 667, height: 375 } });

  test('destination, foe, forecast from the destination; Cancel steps back; Confirm warps and strikes as one action', async ({
    page,
  }) => {
    test.setTimeout(60_000); // a long, real-input flow on a software-rendered phone canvas
    const errors = await boot(page, '&mobilePreview=1');
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    const tap = async (col, row) => {
      const p = await tilePoint(page, col, row);
      await page.touchscreen.tap(p.x, p.y);
    };
    const hpBefore = await fighterHP(page);

    await tap(3, 3); // Edric
    await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
    await expect(hud.getByRole('button', { name: /^Blink Strike.*1\/1 uses left/s })).toBeEnabled();
    await hud.getByRole('button', { name: /^Blink Strike/ }).tap();
    expect(await state(page)).toBe('SELECTING_ABILITY_TILE');
    await expect(hud.getByText(/Tap a lit tile to warp to/)).toBeVisible();

    // A tile that reaches no foe does nothing.
    await tap(1, 6);
    expect(await edric(page)).toMatchObject({ col: 3, row: 3, acted: false, usage: 0 });
    expect(await battle(page, (s) => s._pendingAbility.step)).toBe('destination');

    // The destination beside the Fighter, then the Fighter.
    await tap(5, 4);
    await expect(hud.getByText(/Tap a foe to strike/)).toBeVisible();
    expect(await edric(page)).toMatchObject({ col: 3, row: 3, usage: 0 }); // nothing has moved
    await tap(6, 4);
    await expect(page.getByRole('button', { name: 'Confirm attack', exact: true })).toBeVisible();
    expect(await state(page)).toBe('SHOWING_FORECAST');
    // The forecast is the equipped weapon's alone, and Edric still stands on his tile.
    expect(await edric(page)).toMatchObject({ col: 3, row: 3, acted: false, usage: 0 });
    await page.screenshot({ path: 'test-results/blink-strike-forecast-phone.png' });

    // Cancel: back to the foe, then the destinations, then the menu: nothing changed.
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
    expect(await state(page)).toBe('SELECTING_ABILITY_TILE');
    expect(await battle(page, (s) => s._pendingAbility.step)).toBe('target');
    await page.keyboard.press('Escape');
    expect(await battle(page, (s) => s._pendingAbility.step)).toBe('destination');
    await page.keyboard.press('Escape');
    await expect(hud.getByRole('button', { name: 'Ability', exact: true })).toBeVisible();
    expect(await edric(page)).toMatchObject({ col: 3, row: 3, acted: false, usage: 0 });
    expect(await fighterHP(page)).toBe(hpBefore);

    // Again, and Confirm.
    await hud.getByRole('button', { name: 'Ability', exact: true }).tap();
    await hud.getByRole('button', { name: /^Blink Strike/ }).tap();
    await tap(5, 4);
    await tap(6, 4);
    await page.getByRole('button', { name: 'Confirm attack', exact: true }).tap();
    await expect.poll(async () => (await edric(page)).acted, { timeout: 15000 }).toBe(true);
    expect(await edric(page)).toMatchObject({ col: 5, row: 4, usage: 1 });
    expect(await fighterHP(page)).toBeLessThan(hpBefore);
    // An attack: no Canto, and the ability is spent for the battle.
    expect(await state(page)).toBe('PLAYER_IDLE');
    expect(errors).toEqual([]);
  });
});

test.describe('on the desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('canvas menu, mouse clicks, Enter confirms and Escape steps back', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = await boot(page);
    const click = async (col, row) => {
      const p = await tilePoint(page, col, row);
      await page.mouse.click(p.x, p.y);
    };
    const hpBefore = await fighterHP(page);

    await battle(page, (s) => {
      const u = s.playerUnits.find((x) => x.name === 'Edric');
      s.selectUnit(u);
      s.showActionMenu(u);
      s.showAbilityPicker(u);
    });
    const rows = await battle(page, (s) => s.actionMenu.map((o) => o.text || '').join(' | '));
    expect(rows).toContain('Blink Strike');
    expect(rows).toContain('1/1 uses left');
    await page.keyboard.press('Enter'); // the first row: Blink Strike
    expect(await state(page)).toBe('SELECTING_ABILITY_TILE');

    await click(5, 4);
    expect(await battle(page, (s) => s._pendingAbility.step)).toBe('target');
    await click(6, 4);
    expect(await state(page)).toBe('SHOWING_FORECAST');
    expect(await edric(page)).toMatchObject({ col: 3, row: 3, acted: false });
    await page.screenshot({ path: 'test-results/blink-strike-forecast-desktop.png' });

    await page.keyboard.press('Escape');
    expect(await battle(page, (s) => s._pendingAbility.step)).toBe('target');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    expect(await edric(page)).toMatchObject({ col: 3, row: 3, acted: false, usage: 0 });

    await battle(page, (s) => {
      const u = s.playerUnits.find((x) => x.name === 'Edric');
      s.showAbilityPicker(u);
    });
    await page.keyboard.press('Enter');
    await click(5, 4);
    await click(6, 4);
    expect(await state(page)).toBe('SHOWING_FORECAST');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await edric(page)).acted, { timeout: 15000 }).toBe(true);
    expect(await edric(page)).toMatchObject({ col: 5, row: 4, usage: 1 });
    expect(await fighterHP(page)).toBeLessThan(hpBefore);
    expect(errors).toEqual([]);
  });
});
