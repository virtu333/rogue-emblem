// The act boss's earned-blessing pick (docs/specs/blessings-v3.md §6.4), on a landscape phone:
// after the boss's reward, two earned blessings; the one taken is held and the act advances; a
// reload with the pick open offers the same pair; Escape asks before leaving them, and a pick
// left is never offered again. Waits are on state (dialogs, scenes, the slot's save).
import { test, expect } from '@playwright/test';
import { pageErrors, phone } from './portraitHelpers.js';
import {
  PICK,
  pauseBlessingNames,
  pickIds,
  playOnToRouteMap,
  reloadToRouteMap,
  savedRun,
  winBossToPick,
} from './earnedPickHelpers.js';

test.setTimeout(180_000);
const { defaultBrowserType: _browser, ...use } = phone({ width: 667, height: 375 });
test.use(use);

test('the boss gives two earned blessings: one taken, the act advances, the pause list says Earned', async ({
  page,
}) => {
  const errors = pageErrors(page);
  const { pick, atVictory } = await winBossToPick(page);
  // Rolled and saved with the victory, before the band and the reward.
  expect(atVictory).toMatchObject({ status: 'owed', actId: 'act1' });
  const offered = await pickIds(pick);
  expect(offered).toEqual(atVictory.offered);
  expect(offered).toHaveLength(2);

  const take = pick.getByRole('button', { name: 'Take', exact: true });
  await expect(take).toBeDisabled(); // nothing chosen yet
  await pick.locator('.ch-card').first().tap();
  await expect(pick.locator('.ch-card').first()).toHaveAttribute('aria-pressed', 'true');
  await expect(take).toBeEnabled();
  await take.tap();
  await expect(pick).toHaveCount(0);

  await playOnToRouteMap(page);
  const saved = await savedRun(page);
  expect(saved.currentAct).toBe('act2');
  expect(saved.earnedBlessingPicks.act1).toMatchObject({ status: 'taken', chosen: offered[0] });
  const name = await page.evaluate(
    (id) =>
      window.__emblemRogueGame.scene
        .getScene('NodeMap')
        .gameData.blessings.blessings.find((b) => b.id === id).name,
    offered[0],
  );
  expect(await pauseBlessingNames(page)).toContain(`${name} · Earned`);
  expect(errors).toEqual([]);
});

test('a reload with the pick open offers the same pair; Escape asks first; a pick left is gone', async ({
  page,
}) => {
  const errors = pageErrors(page);
  const { pick } = await winBossToPick(page);
  const offered = await pickIds(pick);

  await reloadToRouteMap(page);
  await expect(pick).toBeVisible({ timeout: 30_000 });
  expect(await pickIds(pick)).toEqual(offered); // not lost, not re-rolled
  expect((await savedRun(page)).currentAct).toBe('act1'); // the act waits on the pick

  // Escape never leaves them silently: it asks, and Back keeps the pick.
  await pick.locator('.ch-card').first().focus();
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: 'Leave them?', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(confirm).toHaveCount(0);
  await expect(pick).toBeVisible();
  expect((await savedRun(page)).earnedBlessingPicks.act1.status).toBe('owed');

  await pick.locator('.ch-card').first().focus();
  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: 'Leave them', exact: true }).tap();
  await expect(pick).toHaveCount(0);
  await expect
    .poll(async () => {
      const run = await savedRun(page);
      return [run.earnedBlessingPicks.act1.status, run.currentAct];
    })
    .toEqual(['skipped', 'act2']);

  await reloadToRouteMap(page);
  await expect(page.locator('.re-node-map')).toBeVisible(); // nothing over the map
  await expect(page.getByRole('dialog', { name: PICK, exact: true })).toHaveCount(0);
  const run = await savedRun(page);
  expect(run.earnedBlessingPicks.act1.status).toBe('skipped');
  expect(offered.some((id) => run.activeBlessings.some((b) => (b.id || b) === id))).toBe(false);
  expect(errors).toEqual([]);
});
