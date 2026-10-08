import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

// Branching Threads (a Home Base upgrade): the battle rewards' Reroll button. Each test
// wins the smoke battle with a run granted `rewardRerolls` (its meta effects, as a run
// started with the upgrade has them) and plays the reward screen with real input.

async function winWithRerolls(page, rerolls, url) {
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.evaluate((n) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.registry.set('activeSlot', 1);
    s.runManager.metaEffects = { ...(s.runManager.metaEffects || {}), rewardRerolls: n };
    s.onVictory();
  }, rerolls);
  const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

const savedRun = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')));
const uidsOf = (record) => record.choices.map((c) => c.item?.uid || `gold:${c.goldAmount}`);
const fitsWidth = (locator) => locator.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);

test('no Reroll without Branching Threads', async ({ page }) => {
  const dialog = await winWithRerolls(page, 0, '/?devScene=battle&preset=battle_smoke&seed=42');
  await expect(dialog.getByRole('button', { name: 'Choose reward', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Reroll|rerolls left/ })).toHaveCount(0);
});

test('desktop: Reroll redraws the saved choices, counts down, then reads No rerolls left', async ({
  page,
}) => {
  const dialog = await winWithRerolls(page, 2, '/?devScene=battle&preset=battle_smoke&seed=42');
  const reroll = dialog.getByRole('button', { name: 'Reroll (2)', exact: true });
  await expect(reroll).toBeEnabled();
  expect(await fitsWidth(reroll)).toBe(true);
  expect(await fitsWidth(dialog)).toBe(true);
  const firstSave = await savedRun(page);
  const first = firstSave.pendingBattleReward;
  expect(firstSave.rewardRerollsSpent ?? 0).toBe(0);

  // Mouse.
  await reroll.click();
  const afterOne = dialog.getByRole('button', { name: 'Reroll (1)', exact: true });
  await expect(afterOne).toBeEnabled();
  await expect(dialog.getByText(/New choices drawn/)).toBeVisible();
  let saved = await savedRun(page);
  expect(saved.rewardRerollsSpent).toBe(1);
  expect(uidsOf(saved.pendingBattleReward)).not.toEqual(uidsOf(first));
  // The screen shows exactly what was saved.
  const live = await page.evaluate(
    () => window.__emblemRogueGame.scene.getScene('Battle').runManager.pendingBattleReward,
  );
  expect(live.choices).toEqual(saved.pendingBattleReward.choices);
  expect(saved.gold).toBe(firstSave.gold);

  // Keyboard: the button keeps focus after a reroll; Enter spends the last charge.
  await expect(afterOne).toBeFocused();
  const goldBefore = saved.gold;
  await page.keyboard.press('Enter');
  const spent = dialog.getByRole('button', { name: 'No rerolls left', exact: true });
  await expect(spent).toBeDisabled();
  saved = await savedRun(page);
  expect(saved.rewardRerollsSpent).toBe(2);
  expect(saved.gold).toBe(goldBefore);
  expect(saved.pendingBattleReward.skipGold).toBe(first.skipGold);

  // A reload offers the rerolled choices with both charges spent.
  const beforeReload = saved;
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  const after = await savedRun(page);
  expect(after.rewardRerollsSpent).toBe(2);
  expect(after.pendingBattleReward.choices).toEqual(beforeReload.pendingBattleReward.choices);
});

test.describe('phone', () => {
  // eslint-disable-next-line no-unused-vars
  const { defaultBrowserType, ...phone } = devices['iPhone SE'];
  test.use({ ...phone, viewport: { width: 375, height: 667 } });
  test('a pick disables Reroll on an elite reward; it fits a portrait phone', async ({ page }) => {
    const dialog = await winWithRerolls(
      page,
      3,
      '/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1',
    );
    const reroll = dialog.getByRole('button', { name: 'Reroll (3)', exact: true });
    await expect(reroll).toBeInViewport();
    expect(await fitsWidth(dialog)).toBe(true);
    // Turn the pending reward into an elite's two picks with a gold card first, saved.
    await page.evaluate(() => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const ctrl = s._lootController;
      ctrl.record.picksRemaining = 2;
      ctrl.scene._elitePicksRemaining = 2;
      ctrl.record.choices[0] = { type: 'gold', goldAmount: 50, xpAmount: 0 };
      ctrl.mobileRewards.choices = ctrl.choices = ctrl.record.choices;
      ctrl.mobileRewards.selected = 0;
      if (!ctrl.persist()) throw new Error('reward save failed');
      ctrl.mobileRewards.render();
    });
    await dialog.getByRole('button', { name: /^50 gold/ }).tap();
    await dialog.getByRole('button', { name: 'Choose reward', exact: true }).tap();
    await expect(dialog.getByRole('button', { name: 'Reroll (3)', exact: true })).toBeDisabled();
    const saved = await savedRun(page);
    expect(saved.pendingBattleReward.claimed).toEqual([0]);
    expect(saved.rewardRerollsSpent ?? 0).toBe(0);
  });
});
