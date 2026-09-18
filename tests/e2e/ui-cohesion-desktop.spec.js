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
