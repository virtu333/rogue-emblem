import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('reload mid-forge preserves completed battle and forfeits unclaimed loot without duplicate award', async ({
  page,
}) => {
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.set('activeSlot', 1);
    s.onVictory();
  });
  const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(dialog).toBeVisible();
  const saved = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const rewards = s._lootController.mobileRewards;
    rewards.choices[0] = {
      type: 'forge',
      item: { type: 'Whetstone', name: 'Silver Whetstone', forgeStat: 'choice' },
    };
    rewards.selected = 0;
    rewards.render();
    return localStorage.getItem('emblem_rogue_slot_1_run');
  });
  expect(saved).toBeTruthy();
  await dialog.getByRole('button', { name: 'Choose reward', exact: true }).tap();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: 'Apply reward', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(dialog.getByRole('button', { name: 'Apply reward', exact: true })).toBeInViewport();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 667, height: 375 });
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  await expect(page.getByRole('dialog', { name: 'Battle rewards', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_run'))).toBe(saved);
  const state = JSON.parse(saved);
  expect(state.battleInProgress).toBeNull();
});
