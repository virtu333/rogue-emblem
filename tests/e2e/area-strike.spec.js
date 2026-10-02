// E2E: a chosen-center weapon art (Stormcall on Breachbolt), aimed and fired on a phone
// by touch, on a desktop by keyboard, and with a pad (docs/specs/aoe-weapon-arts.md §6).
// The combat_actions lab: Utility (a Mage, given Breachbolt here) stands at (4,4); the
// Fighter stands at (6,4), two tiles away (inside Breachbolt's 3-10 minimum), so it is
// reached only by a blast centred beside it, e.g. (6,5), three tiles from Utility.
import { test, expect, devices } from '@playwright/test';
import { attachSceneCrashArtifacts, installSimPad, padTap, waitForScene } from './helpers.js';

const BTN = { CONFIRM: 0, CANCEL: 1, L1: 4, R1: 5 };
const lab = '/?devScene=battle&preset=combat_actions&seed=42&battleLab=1';

async function boot(page, query = '') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${lab}${query}`);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'PLAYER_IDLE',
  );
  // Utility becomes a Breachbolt sage: Mast tomes, MAG 22, 32 of 40 HP.
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === 'Utility');
    const tome = structuredClone(s.gameData.weapons.find((w) => w.name === 'Breachbolt'));
    u.proficiencies = [{ type: 'Tome', rank: 'Mast' }];
    u.inventory = [tome];
    u.weapon = tome;
    Object.assign(u.stats, { MAG: 22, HP: 40 });
    u.currentHP = 32;
  });
  return errors;
}

const state = (page) =>
  page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const area = s._areaTargetingController;
    const unit = (name) => [...s.playerUnits, ...s.enemyUnits].find((u) => u.name === name);
    const fighter = s.enemyUnits.find((u) => u.className === 'Fighter');
    return {
      battleState: s.battleState,
      aim: area?.pending?.aim || null,
      locked: area?.locked || null,
      utility: { hp: unit('Utility').currentHP, acted: unit('Utility').hasActed },
      fighter: fighter ? { hp: fighter.currentHP, res: fighter.stats.RES } : null,
      uses: unit('Utility')._battleWeaponArtUsage?.map?.legend_stormcall || 0,
    };
  });

/** Begin aiming as the art picker's Stormcall row does (the desktop and pad specs). */
async function beginAiming(page) {
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const u = s.playerUnits.find((x) => x.name === 'Utility');
    const art = s.gameData.weaponArts.arts.find((a) => a.id === 'legend_stormcall');
    s.selectUnit(u);
    s._areaTargeting().begin(u, u.weapon, art);
  });
  await expect.poll(async () => (await state(page)).battleState).toBe('SELECTING_AREA_CENTER');
}

async function settled(page) {
  await expect
    .poll(async () => (await state(page)).battleState, { timeout: 15_000 })
    .toBe('PLAYER_IDLE');
}

/** Stormcall's blow on the Fighter: (MAG 22 + Breachbolt 8 − RES) × 0.8, rounded down. */
const blow = (res) => Math.floor((22 + 8 - res) * 0.8);

test.afterEach(async ({ page }, testInfo) => {
  await attachSceneCrashArtifacts(page, testInfo);
});

test.describe('phone, by touch', () => {
  // The phone's touch, size and agent; the browser stays the configured one (a describe
  // group cannot switch it).
  const { defaultBrowserType: _browser, ...phone } = devices['iPhone SE'];
  test.use({ ...phone, viewport: { width: 667, height: 375 } });

  async function tapTile(page, col, row) {
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

  test('Weapon Art → Stormcall → aim → Back → Fire', async ({ page }) => {
    const errors = await boot(page, '&mobilePreview=1');
    const hud = page.getByRole('complementary', { name: 'Battle commands' });
    await tapTile(page, 4, 4);
    await hud.getByRole('button', { name: /^Weapon Art/ }).tap();
    await hud.getByRole('button', { name: /Stormcall/ }).tap();
    await expect.poll(async () => (await state(page)).battleState).toBe('SELECTING_AREA_CENTER');

    // One tile away is inside Breachbolt's minimum range: nothing happens.
    await tapTile(page, 5, 4);
    expect((await state(page)).locked).toBeNull();

    // Aiming offers ◀ Foe ▶; the Fire / Back prompt stands alone.
    const foeButtons = page.getByRole('button', { name: /Foe/ }).filter({ visible: true });
    await expect(hud.getByRole('button', { name: 'Foe ▶' })).toBeVisible();
    await tapTile(page, 6, 5);
    await expect.poll(async () => (await state(page)).locked).toEqual({ col: 6, row: 5 });
    await expect(hud.getByRole('button', { name: /Fire Stormcall/ })).toBeVisible();
    await expect(foeButtons).toHaveCount(0);
    // The rail's Back tool steps back out of the prompt (the scene's cancel route).
    await page.getByLabel('Battle utilities').getByRole('button', { name: 'Back' }).tap();
    await expect.poll(async () => (await state(page)).locked).toBeNull();
    expect((await state(page)).battleState).toBe('SELECTING_AREA_CENTER');

    const before = await state(page);
    await tapTile(page, 6, 5);
    await hud.getByRole('button', { name: /Fire Stormcall/ }).tap();
    await settled(page);
    const after = await state(page);
    expect(after.utility).toEqual({ hp: 32 - 8, acted: true });
    expect(after.uses).toBe(1);
    expect(after.fighter.hp).toBe(Math.max(0, before.fighter.hp - blow(before.fighter.res)));
    expect(errors).toEqual([]);
  });
});

test.describe('desktop, by keyboard', () => {
  test('cycle with E, lock with Enter, Esc back, Enter twice fires', async ({ page }) => {
    const errors = await boot(page);
    await beginAiming(page);
    // The only seen foe on a legal centre is the Archer (9,7); E stays on it.
    await page.keyboard.press('e');
    expect((await state(page)).aim).toEqual({ col: 9, row: 7 });
    // Arrows walk the cursor to (6,5): from (9,7), three left and two up.
    for (const key of ['ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowUp'])
      await page.keyboard.press(key);
    await expect.poll(async () => (await state(page)).aim).toEqual({ col: 6, row: 5 });
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).locked).toEqual({ col: 6, row: 5 });
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await state(page)).locked).toBeNull();
    expect((await state(page)).battleState).toBe('SELECTING_AREA_CENTER');
    const before = await state(page);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).locked).toEqual({ col: 6, row: 5 });
    await page.keyboard.press('Enter');
    await settled(page);
    const after = await state(page);
    expect(after.utility).toEqual({ hp: 24, acted: true });
    expect(after.fighter.hp).toBe(Math.max(0, before.fighter.hp - blow(before.fighter.res)));
    expect(errors).toEqual([]);
  });

  test('Esc from aiming returns to the art picker, spending nothing', async ({ page }) => {
    await boot(page);
    await beginAiming(page);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await state(page)).battleState).toBe('UNIT_ACTION_MENU');
    expect((await state(page)).utility).toEqual({ hp: 32, acted: false });
  });
});

test.describe('pad', () => {
  test('R1 cycles, A locks, B backs out, A twice fires', async ({ page }) => {
    const errors = await boot(page, '&gamepadSim=1');
    await installSimPad(page);
    await beginAiming(page);
    await padTap(page, BTN.R1);
    expect((await state(page)).aim).toEqual({ col: 9, row: 7 });
    await padTap(page, BTN.CONFIRM);
    await expect.poll(async () => (await state(page)).locked).toEqual({ col: 9, row: 7 });
    await padTap(page, BTN.CANCEL);
    await expect.poll(async () => (await state(page)).locked).toBeNull();
    await padTap(page, BTN.CONFIRM);
    await expect.poll(async () => (await state(page)).locked).toEqual({ col: 9, row: 7 });
    await padTap(page, BTN.CONFIRM);
    await settled(page);
    const after = await state(page);
    expect(after.utility).toEqual({ hp: 24, acted: true });
    expect(after.uses).toBe(1);
    expect(errors).toEqual([]);
  });
});
