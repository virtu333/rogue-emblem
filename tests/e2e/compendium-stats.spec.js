import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('Stats reference filters, search and long details work on a small phone', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=combat_actions&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { CompendiumOverlay } = await import('/src/ui/CompendiumOverlay.js');
    new CompendiumOverlay(s, s.gameData).show();
  });
  const dialog = page.getByRole('dialog', { name: 'Compendium', exact: true });
  await dialog.getByRole('button', { name: 'Stats', exact: true }).tap();
  await dialog.getByRole('button', { name: 'Core', exact: true }).tap();
  await dialog.getByRole('button', { name: /MOV — Movement/ }).tap();
  await expect(dialog.getByText(/MOV never grows on level-up/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Derived', exact: true }).tap();
  await dialog.getByRole('button', { name: /Attack \(Atk\)/ }).tap();
  await expect(dialog.getByText(/triple weapon Might/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Growth', exact: true }).tap();
  await dialog.getByRole('button', { name: /Promotion Growth/ }).tap();
  await expect(dialog.getByText(/When extended leveling is enabled/)).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Stats', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Scroll details down', exact: true }).tap();
  await expect(dialog.getByText(/When extended leveling is enabled/)).toBeInViewport();
  await page.screenshot({ path: info.outputPath('stats-small-phone.png') });
  await dialog.getByRole('searchbox').fill('Master Seal');
  await expect(dialog.getByRole('button', { name: /Promotion Growth/ })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});
