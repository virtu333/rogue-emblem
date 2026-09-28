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

test('a skip worth less than a gold card on offer is quieted until that card is taken', async ({
  page,
}) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('Battle').onVictory());
  const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(dialog).toBeVisible();
  const skipGold = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const rewards = s._lootController.mobileRewards;
    // An elite's two picks: the count lives on the persisted reward record.
    s.isElite = true;
    s.runManager.pendingBattleReward.picksRemaining = 2;
    rewards.choices[0] = { type: 'gold', goldAmount: rewards.skipGold + 40, xpAmount: 25 };
    rewards.selected = 0;
    rewards.render();
    return rewards.skipGold;
  });
  const skip = dialog.getByRole('button', { name: new RegExp(`^Take ${skipGold} gold instead`) });
  await expect(skip).toHaveClass(/\bis-dominated\b/);
  await expect(skip).toContainText('The gold reward pays more.');
  await expect(skip).toBeEnabled();
  // Taking the gold card leaves the skip a fair offer for the second pick.
  await dialog.getByRole('button', { name: 'Choose reward', exact: true }).click();
  await expect(dialog.locator('.ch-stamp')).toHaveText('Claimed');
  await expect(skip).not.toHaveClass(/\bis-dominated\b/);
  await expect(skip).toContainText('Pass on the remaining rewards');
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
