// A village under attack (an ambush shop node): the fight, its rewards, then the freed
// village's shop, in that order, whether the rewards are claimed in the battle, left
// for the route map ("View map") or interrupted by a reload and continued from the slot.
import { test, expect } from '@playwright/test';
import { waitForScene, finishFormation } from './helpers.js';
import { attachSlot, phone, LANDSCAPE_PHONES, quietSettings } from './portraitHelpers.js';
import { reloadToRouteMap, savedRun } from './earnedPickHelpers.js';

test.use(phone(LANDSCAPE_PHONES[1]));

const REWARDS = 'Battle rewards';
const VILLAGE = 'Village';

/** A saved run whose next node is a village under attack; travel there and win the fight. */
async function winVillageAmbush(page) {
  await quietSettings(page, { battleSpeed: 'fast' });
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await attachSlot(page);
  const nodeId = await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { convertNodeToRoutBattle } = await import('/src/engine/NodeMapGenerator.js');
    const n = s.runManager.getAvailableNodes()[0];
    n.type = 'shop';
    n.isAmbush = true;
    n.ambushCleared = false;
    convertNodeToRoutBattle(n, s.runManager.currentAct, s.gameData.mapTemplates, {
      extraParams: { isAmbush: true },
    });
    s.onNodeClick(n);
    return n.id;
  });
  await waitForScene(page, 'Battle');
  await finishFormation(page);
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('Battle');
    for (const enemy of [...s.enemyUnits]) {
      enemy.currentHP = 0;
      await s.removeUnit(enemy, { killer: s.playerUnits[0] });
    }
    s.checkBattleEnd();
  });
  const rewards = page.getByRole('dialog', { name: REWARDS, exact: true });
  await expect(rewards).toBeVisible({ timeout: 30_000 });
  // The victory is saved with its rewards owed and the village's shop owed after them.
  const saved = await savedRun(page);
  expect(saved.pendingBattleReward).toBeTruthy();
  expect(saved.pendingAmbushNodeId).toBe(nodeId);
  return { nodeId, rewards };
}

/** Claim the reward on the open rewards dialog: the gold card, then confirm. */
async function claimGold(page) {
  const rewards = page.getByRole('dialog', { name: REWARDS, exact: true });
  const gold = rewards.locator('.reward-card').last(); // "Take N gold instead"
  await expect(async () => {
    await gold.tap();
    await expect(gold).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
  }).toPass({ timeout: 20_000 });
  await rewards.getByRole('button', { name: 'Take gold', exact: true }).tap();
  await expect(rewards).toHaveCount(0);
}

async function leaveShop(page) {
  const shop = page.getByRole('dialog', { name: VILLAGE, exact: true });
  await shop.getByRole('button', { name: 'Leave', exact: true }).tap();
  await expect(shop).toHaveCount(0);
}

const runState = (page) =>
  page.evaluate(() => {
    const rm = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    return {
      pendingReward: Boolean(rm.pendingBattleReward),
      pendingAmbush: rm.pendingAmbushNodeId,
      gold: rm.gold,
    };
  });

test('claimed in the battle: the rewards, then the freed village', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await winVillageAmbush(page);
  await claimGold(page);
  await waitForScene(page, 'NodeMap');
  const shop = page.getByRole('dialog', { name: VILLAGE, exact: true });
  await expect(shop).toBeVisible({ timeout: 30_000 });
  await expect(shop).toContainText('Liberated village');
  await leaveShop(page);
  expect(await runState(page)).toMatchObject({ pendingReward: false, pendingAmbush: null });
  expect(errors).toEqual([]);
});

test('left for the map: the village waits until the rewards are claimed', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { rewards } = await winVillageAmbush(page);
  await rewards.getByRole('button', { name: 'View map', exact: true }).tap();
  await waitForScene(page, 'NodeMap');
  const shop = page.getByRole('dialog', { name: VILLAGE, exact: true });
  const back = page.getByRole('button', { name: 'Return to rewards', exact: true });
  await expect(back).toBeVisible({ timeout: 30_000 });
  await expect(shop).toHaveCount(0);
  expect(await runState(page)).toMatchObject({ pendingReward: true });
  await back.tap();
  await expect(page.getByRole('dialog', { name: REWARDS, exact: true })).toBeVisible();
  await claimGold(page);
  await expect(shop).toBeVisible({ timeout: 30_000 });
  await expect(shop).toContainText('Liberated village');
  await leaveShop(page);
  expect(await runState(page)).toMatchObject({ pendingReward: false, pendingAmbush: null });
  expect(errors).toEqual([]);
});

test('a reload on the rewards: Continue offers them first, then the village', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await winVillageAmbush(page);
  await reloadToRouteMap(page);
  const shop = page.getByRole('dialog', { name: VILLAGE, exact: true });
  const back = page.getByRole('button', { name: 'Return to rewards', exact: true });
  await expect(back).toBeVisible({ timeout: 30_000 });
  await expect(shop).toHaveCount(0);
  const before = await runState(page);
  expect(before.pendingReward).toBe(true);
  await back.tap();
  await claimGold(page);
  await expect(shop).toBeVisible({ timeout: 30_000 });
  const after = await runState(page);
  expect(after.gold).toBeGreaterThan(before.gold);
  expect(after.pendingReward).toBe(false);
  await leaveShop(page);
  expect(await runState(page)).toMatchObject({ pendingAmbush: null });
  // Paid once: a second reload neither re-offers the reward nor re-opens the village.
  await reloadToRouteMap(page);
  await expect(page.getByRole('dialog', { name: REWARDS, exact: true })).toHaveCount(0);
  await expect(shop).toHaveCount(0);
  expect(await runState(page)).toMatchObject({ pendingReward: false, gold: after.gold });
  expect(errors).toEqual([]);
});
