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

// Menu titles on a DPR 1 desktop. The shared menu surface (MenuSurface: Settings,
// Victory records, Compendium, Help, shops…) titles itself in --re-pf-11 and the
// roster sheet matches it. The desktop pixel-font grid once snapped 11px to its
// nearest crisp size at DPR 1, 8px, so every title read smaller than the 13px
// copy under it (and the roster's 10px title shrank to its 8px tab labels).
const titleSize = (dialog) =>
  dialog.evaluate((el) => {
    const h2 = el.querySelector('header h2');
    return {
      size: parseFloat(getComputedStyle(h2).fontSize),
      overflows: h2.scrollWidth > h2.clientWidth + 1,
      dpr: window.devicePixelRatio,
    };
  });

for (const [width, height] of [
  [640, 480],
  [1280, 720],
  [1920, 1080],
]) {
  test(`menu titles keep their design size on a ${width}x${height} DPR 1 desktop`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors = collectErrors(page);
    await page.goto('/');
    await waitForScene(page, 'Title');
    await page.evaluate(() => document.fonts.ready);
    for (const [open, name] of [
      ['Settings', 'Settings'],
      ['Records', 'Victory records'],
      ['Compendium', 'Compendium'],
    ]) {
      await page.getByRole('button', { name: open, exact: true }).click();
      const dialog = page.getByRole('dialog', { name, exact: true });
      await expect(dialog).toBeVisible();
      expect(await titleSize(dialog), name).toEqual({ size: 11, overflows: false, dpr: 1 });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test('the roster title matches the menu titles on a DPR 1 desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForScene(page, 'NodeMap');
  await page.waitForFunction(
    () => window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
  );
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
  await page.waitForFunction(
    () => !window.__emblemRogueGame.scene.getScene('NodeMap').dialogueOverlay?.visible,
  );
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')._openRoster());
  const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(roster).toBeVisible();
  expect(await titleSize(roster)).toEqual({ size: 11, overflows: false, dpr: 1 });
});
