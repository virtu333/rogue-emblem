import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });

// Since #79 the reward screen saves its draft (the steps chosen so far) with the
// pending reward, so a reload resumes it. A reload mid-forge must keep the battle
// completed and the reward unclaimed: nothing applied, nothing awarded twice, and
// nothing in the save changed except the draft.
test('reload mid-forge keeps the completed battle and the unclaimed reward with its draft', async ({
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
    // The fixture's choice is part of the saved reward record from here on.
    if (!s._lootController.persist()) throw new Error('reward save failed');
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

  const before = JSON.parse(saved);
  const after = JSON.parse(
    await page.evaluate(() => localStorage.getItem('emblem_rogue_slot_1_run')),
  );
  expect(before.battleInProgress).toBeNull();
  expect(after.battleInProgress).toBeNull();
  // The draft reached the forge's last step (recipient, weapon, stat) ...
  expect(before.pendingBattleReward.draft?.path ?? []).toEqual([]);
  expect(after.pendingBattleReward.draft.path).toHaveLength(3);
  // ... and nothing else in the save moved: the reward is still unclaimed.
  const strip = (run) => ({
    ...run,
    savedAt: null,
    pendingBattleReward: { ...run.pendingBattleReward, draft: null },
  });
  expect(strip(after)).toEqual(strip(before));
  expect(after.pendingBattleReward.claimed).toEqual([]);
});
