import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('reward submenu can consult Compendium, resume, and safely cancel leaving', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1&battleLab=1');
  await waitForScene(page, 'Battle');
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.set('activeSlot', 1);
    s.onVictory();
  });
  const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(rewards).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    const r = s._lootController.mobileRewards;
    r.choices[0] = {
      type: 'forge',
      item: { type: 'Whetstone', name: 'Silver Whetstone', forgeStat: 'choice' },
    };
    r.selected = 0;
    r.render();
  });
  await rewards.getByRole('button', { name: 'Choose reward', exact: true }).tap();
  await rewards.getByRole('button', { name: 'Continue', exact: true }).tap();
  await rewards.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(rewards.getByRole('button', { name: 'Apply reward', exact: true })).toBeVisible();
  const state = () =>
    page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle'),
        r = s._lootController.mobileRewards;
      return {
        selected: r.selected,
        steps: r.steps.length,
        gold: s.runManager.gold,
        save: (() => {
          const saved = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
          delete saved.savedAt;
          return saved;
        })(),
      };
    });
  const before = await state();
  await rewards.getByRole('button', { name: 'Menu', exact: true }).tap();
  const menu = page.getByRole('dialog', { name: 'Paused', exact: true });
  await expect(menu).toBeVisible();
  await expect(rewards).toBeHidden();
  await menu.getByRole('button', { name: 'Compendium', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Compendium', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Resume', exact: true }).tap();
  await expect(rewards.getByRole('button', { name: 'Apply reward', exact: true })).toBeVisible();
  expect(await state()).toEqual(before);
  await rewards.getByRole('button', { name: 'Menu', exact: true }).tap();
  await menu.getByRole('button', { name: 'Save & Return to Title', exact: true }).tap();
  await expect(menu.getByText(/Your battle and remaining rewards are saved/)).toBeVisible();
  await menu.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await menu.getByRole('button', { name: 'Resume', exact: true }).tap();
  expect(await state()).toEqual(before);
  await rewards.getByRole('button', { name: 'Menu', exact: true }).tap();
  await menu.getByRole('button', { name: 'Save & Return to Title', exact: true }).tap();
  await menu.getByRole('button', { name: 'Save & return', exact: true }).tap();
  await waitForScene(page, 'Title');
  await expect(rewards).toHaveCount(0);
  await expect(menu).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run'));
      delete saved.savedAt;
      return saved;
    }),
  ).toEqual(before.save);
  expect(errors).toEqual([]);
});
