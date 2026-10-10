import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';
import {
  PORTRAIT_PHONES,
  attachSlot,
  pageErrors,
  phone,
  quietSettings,
} from './portraitHelpers.js';

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

// The two cases below play the whole flow on a portrait phone: a reroll from a list
// scrolled down, and a reroll that survives a reload and is then claimed.
test.describe('portrait phone: reroll, reload, claim', () => {
  test.setTimeout(150_000);
  const { defaultBrowserType: _browser, ...use } = phone(PORTRAIT_PHONES[1]);
  test.use(use);

  const tapMiddle = (page) => page.touchscreen.tap(195, 420);

  /** The smoke battle won with `rerolls` Branching Threads charges, up to the rewards. */
  async function winToRewards(page, rerolls) {
    await quietSettings(page, { battleSpeed: 'fast' });
    await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
      timeout: 90_000,
    });
    await attachSlot(page);
    await page.evaluate((n) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      s.runManager.metaEffects = { ...s.runManager.metaEffects, rewardRerolls: n };
      // A won caravan battle owes its shop ahead of the rewards: keep the route map next.
      s.battleConfig = { ...s.battleConfig, caravanSpawn: null };
      for (const e of s.enemyUnits) e.currentHP = 0;
      s.onVictory();
    }, rerolls);
    const dialog = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
    const next = page.getByRole('button', { name: 'Continue', exact: true });
    while (!(await dialog.isVisible())) {
      // The victory band and any card before the rewards: tap them away, like a player.
      if (await next.count()) await next.first().tap();
      else await tapMiddle(page);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
    }
    return dialog;
  }

  // The rebuilt list scrolls the selected card into view (keepDraftScroll), and a reroll
  // selects the first card: a hand rerolled from a list scrolled down opens at the top.
  test('a reroll from a scrolled list opens the new hand at the top', async ({ page }) => {
    const dialog = await winToRewards(page, 2);
    const list = dialog.locator('.ch-draft');
    // A short screen makes the hand scroll; scroll it to the bottom.
    await page.setViewportSize({ width: 390, height: 520 });
    const scrolled = await list.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Reroll (2)', exact: true }).tap();
    await expect(dialog.getByRole('button', { name: 'Reroll (1)', exact: true })).toBeVisible();
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0);
    await expect(dialog.locator('.reward-card').first()).toBeInViewport();
    await expect(dialog.locator('.reward-card').first()).toHaveAttribute('aria-pressed', 'true');
  });

  test('a reroll survives a reload, and the rerolled item is claimed into one place', async ({
    page,
  }) => {
    const errors = pageErrors(page);
    const dialog = await winToRewards(page, 2);
    await dialog.getByRole('button', { name: 'Reroll (2)', exact: true }).tap();
    await expect(dialog.getByRole('button', { name: 'Reroll (1)', exact: true })).toBeVisible();
    const rerolled = (await savedRun(page)).pendingBattleReward;
    expect((await savedRun(page)).rewardRerollsSpent).toBe(1);

    // Close the game and come back through the slot to the route map, rewards owed.
    await page.evaluate(() => history.replaceState(null, '', '/'));
    await page.reload();
    await waitForScene(page, 'Title');
    await page.getByRole('button', { name: 'Save Slots', exact: true }).tap();
    await waitForScene(page, 'SlotPicker');
    await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
    await waitForScene(page, 'NodeMap');
    const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
    if (await skip.count()) await skip.tap();
    await expect(page.locator('.re-node-map')).toBeVisible();
    await page.evaluate(() =>
      window.__emblemRogueGame.scene.getScene('NodeMap').openPendingRewards(),
    );
    const again = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
    await expect(again).toBeVisible();
    // The same rerolled hand, with one charge left (not refunded, not spent again).
    await expect(again.getByRole('button', { name: 'Reroll (1)', exact: true })).toBeEnabled();
    const live = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.pendingBattleReward,
    );
    expect(live.choices).toEqual(rerolled.choices);

    // Claim a card from the rerolled hand, wherever the draw put one: a kept item (into
    // the convoy, or a unit when it cannot go there), an accessory (the shared pool), a
    // stat booster (used on the spot) or gold.
    const before = await savedRun(page);
    const kinds = rerolled.choices.map((c) => {
      if (c.type === 'gold') return 'gold';
      if (c.type === 'accessory') return 'accessory';
      // A whetstone has steps of its own; a scroll is taken at once into the team's.
      if (c.type === 'forge' || c.item?.type === 'Scroll') return null;
      if (c.type === 'statBooster' || c.item?.effect === 'statBoost') return 'booster';
      return c.item?.uid ? 'kept' : null;
    });
    const kind = ['kept', 'accessory', 'booster', 'gold'].find((k) => kinds.includes(k));
    expect(kind).toBeTruthy();
    const index = kinds.indexOf(kind);
    const choice = rerolled.choices[index];
    await again.locator('.reward-card').nth(index).tap();
    await again.getByRole('button', { name: 'Choose reward', exact: true }).tap();
    if (kind === 'kept') {
      const convoy = again.getByRole('button', { name: /Send to Convoy/ });
      if (await convoy.count()) await convoy.first().tap();
    } else if (kind === 'accessory') {
      await again
        .getByRole('button', { name: /Keep in shared pool/ })
        .first()
        .tap();
    }
    if (kind !== 'gold')
      await again.getByRole('button', { name: 'Apply reward', exact: true }).tap();
    await expect.poll(async () => (await savedRun(page)).pendingBattleReward).toBeNull();

    const after = await savedRun(page);
    expect(after.rewardRerollsSpent).toBe(1);
    const carried = (run) => [
      ...run.roster.flatMap((u) => [
        ...(u.inventory || []),
        ...(u.consumables || []),
        ...(u.accessory ? [u.accessory] : []),
      ]),
      ...(run.convoy?.weapons || []),
      ...(run.convoy?.consumables || []),
      ...(run.accessories || []),
    ];
    const uid = choice.item?.uid;
    if (kind === 'kept' || kind === 'accessory')
      // The rerolled item itself, in exactly one place.
      expect(carried(after).filter((item) => item?.uid === uid)).toHaveLength(1);
    if (kind === 'booster') {
      const total = (run) =>
        run.roster.reduce((sum, u) => sum + (Number(u.stats?.[choice.item.stat]) || 0), 0);
      expect(total(after)).toBe(total(before) + choice.item.value);
      expect(carried(after).filter((item) => item?.uid === uid)).toHaveLength(0);
    }
    if (kind === 'gold') expect(after.gold).toBe(before.gold + choice.goldAmount);
    expect(errors).toEqual([]);
  });
});
