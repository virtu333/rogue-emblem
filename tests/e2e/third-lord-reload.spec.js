// The Power of Friendship arrival survives a reload.
//
// The third lord falls due with the third won battle. The arrival used to be rolled
// only when its cards were drawn, so closing the game while choosing lost the lord for
// good (the pending rewards opened without it, and the next battle is past the
// trigger). The draft is now rolled and saved with the win, a reroll is saved as it is
// spent, and the route map re-offers the very same cards until one is chosen.
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  attachSlot,
  pageErrors,
  phone,
  quietSettings,
} from './portraitHelpers.js';
import { waitForScene } from './helpers.js';

test.setTimeout(150_000);
const { defaultBrowserType: _browser, ...use } = phone(PORTRAIT_PHONES[1]);
test.use(use);

const tapMiddle = (page) => page.touchscreen.tap(195, 420);
const frames = (page, n = 2) =>
  page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const step = (left) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
        step(n);
      }),
    n,
  );

const savedRun = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('emblem_rogue_slot_1_run')));
const cardsOf = (dialog) =>
  dialog.locator('.ch-card').evaluateAll((cards) => cards.map((c) => c.getAttribute('aria-label')));

/**
 * The third won battle, won like a player, up to the lord arrival cards. Returns what
 * the victory save already held (while the band was still up) and the army's size.
 */
async function winThirdBattleToArrival(page, mode) {
  await quietSettings(page, { battleSpeed: 'fast' });
  await page.goto('/?devScene=battle&preset=battle_smoke&seed=42&mobilePreview=1');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
    timeout: 90_000,
  });
  await attachSlot(page);
  const armyBefore = await page.evaluate((mode) => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    s.runManager.metaEffects = { ...s.runManager.metaEffects, thirdLordMode: mode };
    s.runManager.completedBattles = 2; // the win below is the third
    // This spec is about the lord's arrival. A generated map may hand the node a Merchant
    // Caravan, whose shop a won caravan battle owes on the way back to the route map
    // (ahead of the owed rewards): leave the caravan out so the route map is what opens.
    s.battleConfig = { ...s.battleConfig, caravanSpawn: null };
    for (const e of s.enemyUnits) e.currentHP = 0;
    s.onVictory();
    return s.runManager.roster.length;
  }, mode);
  await page.waitForSelector('.ce-band-layer--victory');
  // What the victory save already holds, while the band is still up.
  const atVictory = await savedRun(page);
  await tapMiddle(page); // the victory band skips on a tap
  const arrival = page.getByRole('dialog', { name: 'Lord arrival', exact: true });
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  while (!(await arrival.isVisible())) {
    // Whatever card or line is up: tap it away, like a player.
    if (await continueButton.count()) await continueButton.first().tap();
    else await tapMiddle(page);
    await frames(page, 6);
  }
  return { armyBefore, atVictory, arrival };
}

/** Close the game and come back through the slot to the route map, rewards owed. */
async function reloadToRouteMap(page) {
  await page.evaluate(() => history.replaceState(null, '', '/'));
  await page.reload();
  await waitForScene(page, 'Title');
  const slots = page.getByRole('button', { name: 'Save Slots', exact: true });
  await expect(slots).toBeEnabled();
  await slots.tap();
  await waitForScene(page, 'SlotPicker');
  await page.getByRole('button', { name: 'Select Slot 1', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
  await page.evaluate(() =>
    window.__emblemRogueGame.scene.getScene('NodeMap').openPendingRewards(),
  );
}

test('a reload before choosing the third lord offers the same cards, with the reroll unspent', async ({
  page,
}) => {
  const errors = pageErrors(page);
  const { armyBefore, atVictory, arrival } = await winThirdBattleToArrival(page, 'pick3_reroll');
  // The arrival is rolled and saved with the win, beside the unclaimed reward.
  expect(atVictory.pendingBattleReward).toBeTruthy();
  expect(atVictory.pendingThirdLord.candidates).toHaveLength(3);
  expect(atVictory.pendingThirdLord.mode).toBe('pick3_reroll');
  const offered = await cardsOf(arrival);
  expect(offered).toHaveLength(3);
  await expect(arrival.getByRole('button', { name: 'Reroll', exact: true })).toBeVisible();

  await reloadToRouteMap(page);
  await expect(arrival).toBeVisible();
  expect(await cardsOf(arrival)).toEqual(offered); // not lost, not re-rolled
  await expect(arrival.getByRole('button', { name: 'Reroll', exact: true })).toBeVisible();

  await arrival.locator('.ch-card').last().tap();
  await arrival.getByRole('button', { name: 'Welcome', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: 'Battle rewards', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  const after = await savedRun(page);
  expect(after.pendingThirdLord).toBeNull(); // cleared by the choice
  expect(after.thirdLordJoined).toBe(true);
  expect(after.roster).toHaveLength(armyBefore + 1); // saved with the lord in it
  expect(after.pendingBattleReward).not.toBeNull(); // the rewards still owed
  expect(errors).toEqual([]);
});

test('a reroll is spent for good: reloading shows the rerolled cards and no second reroll', async ({
  page,
}) => {
  const errors = pageErrors(page);
  const { arrival } = await winThirdBattleToArrival(page, 'pick3_reroll');
  const first = await cardsOf(arrival);
  await arrival.getByRole('button', { name: 'Reroll', exact: true }).tap();
  await expect.poll(() => savedRun(page).then((run) => run.thirdLordRerolled)).toBe(true);
  await expect(arrival.getByRole('button', { name: 'Reroll', exact: true })).toHaveCount(0);
  const second = await cardsOf(arrival);
  expect(second).not.toEqual(first);
  // The save that spent the reroll holds the cards that replaced them.
  const saved = await savedRun(page);
  expect(saved.pendingThirdLord.rerolled).toBe(true);
  expect(saved.pendingThirdLord.candidates).toHaveLength(3);

  await reloadToRouteMap(page);
  await expect(arrival).toBeVisible();
  expect(await cardsOf(arrival)).toEqual(second);
  await expect(arrival.getByRole('button', { name: 'Reroll', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
