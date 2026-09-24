import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
test('desktop rewards use native menus and keep Escape inside the choice', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Take .* gold instead/ }).click();
  await dialog.getByRole('button', { name: 'Take gold', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('desktop pause uses the shared menu and resumes cleanly', async ({ page }) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const { PauseOverlay } = await import('/src/ui/PauseOverlay.js');
    window.resumed = 0;
    new PauseOverlay(s, { onResume: () => window.resumed++ }).show();
  });
  const pause = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(pause).toBeVisible();
  await pause.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(pause).toHaveCount(0);
  expect(await page.evaluate(() => window.resumed)).toBe(1);
});
