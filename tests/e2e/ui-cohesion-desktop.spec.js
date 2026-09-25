import { test, expect } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';

test('desktop home uses shared loadout with keyboard focus and upgrades round-trip', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = collectErrors(page);
  await page.goto('/?devScene=homebase');
  await waitForScene(page, 'HomeBase');
  const home = page.getByRole('dialog', { name: 'Home base', exact: true });
  await expect(home).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await home.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.getByRole('button', { name: 'Upgrades', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Home base', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Home base', exact: true }).click();
  await expect(home).toBeVisible();
  await page.getByRole('button', { name: 'Begin Run', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Choose difficulty', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Choose difficulty', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await waitForScene(page, 'HomeBase');
  await expect(home).toBeVisible();
  expect(errors).toEqual([]);
});

// Wide desktop windows: the full-screen menu column padding (≥1000px) must not
// reach compact dialogs. It once left a 540px Field note ~165px of content at
// 1475px wide, stacking "Continue" one letter per line.
for (const [width, height] of [
  [1475, 761],
  [1920, 1080],
]) {
  test(`compact dialogs keep their reading width at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors = collectErrors(page);
    await page.goto('/');
    await waitForScene(page, 'Title');
    await page.getByRole('button', { name: /^Tutorial/ }).click();
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle')?._tutorialController,
    );
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      void s._tutorialController.note(
        'Fort tile reached. Fight from cover to take less damage and dodge more.',
      );
    });
    const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
    await expect(note).toBeVisible();
    const body = await note.locator('.re-menu-body').boundingBox();
    const dialog = await note.boundingBox();
    expect(body.width).toBeGreaterThan(dialog.width - 80);
    const cont = await note.getByRole('button', { name: 'Continue', exact: true }).boundingBox();
    expect(cont.height).toBeLessThan(80);
    expect(cont.width).toBeGreaterThan(cont.height);
    expect(errors).toEqual([]);
  });
}

test('full-screen menus keep their centered column on wide desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('/?devScene=homebase');
  await waitForScene(page, 'HomeBase');
  await page.getByRole('button', { name: 'Begin Run', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Choose difficulty', exact: true });
  await expect(setup).toBeVisible();
  const pad = await setup.evaluate((el) => {
    const menu = el.closest('.re-live-menu') || el.querySelector('.re-live-menu') || el;
    return {
      compact: menu.classList.contains('re-compact-menu'),
      live: menu.classList.contains('re-live-menu'),
      left: parseFloat(getComputedStyle(menu).paddingLeft),
    };
  });
  expect(pad).toEqual({ compact: false, live: true, left: 250 });
});
