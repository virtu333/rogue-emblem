// The Old Sanctum (docs/specs/blessings-v3.md §6.5): a church whose vow offers a pair of earned
// blessings in place of the tier I three. On a landscape phone: the sanctum's menu, its two earned
// rows, the take behind the confirmation, then a reload through the slot: the vow holds, no earned
// row comes back and the pause list says "Earned". Every wait is on state (dialogs, the scene, the
// slot's save), never on time.
import { test, expect } from '@playwright/test';
import { attachSlot, pageErrors, phone, quietSettings } from './portraitHelpers.js';
import { waitForGame, waitForScene } from './helpers.js';
import { pauseBlessingNames, reloadToRouteMap, savedRun } from './earnedPickHelpers.js';

test.setTimeout(150_000);
const { defaultBrowserType: _browser, ...use } = phone({ width: 667, height: 375 });
test.use(use);

const SANCTUM = 'Old Sanctum';

/** Make the first reachable node an Old Sanctum and walk in, as the route map would. */
async function enterSanctum(page) {
  return page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const r = s.runManager;
    const node = r.getAvailableNodes()[0];
    node.type = 'church';
    node.battleParams = null;
    node.sanctum = true;
    s.onNodeClick(node);
    return node.id;
  });
}

test('the Old Sanctum offers an earned pair as its vow; the take survives a reload', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await quietSettings(page);
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForGame(page);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  if (await skip.isVisible()) await skip.tap();
  await attachSlot(page);
  await expect
    .poll(() =>
      page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap')?.isSceneReady),
    )
    .toBe(true);

  const nodeId = await enterSanctum(page);
  const sanctum = page.getByRole('dialog', { name: SANCTUM, exact: true });
  await expect(sanctum).toBeVisible();
  await expect(sanctum.getByRole('heading', { name: 'Earned blessing · Free' })).toBeVisible();
  await expect(sanctum.getByRole('heading', { name: 'Blessing · Free', exact: true })).toHaveCount(
    0,
  );
  const rows = sanctum.locator('button.church-earned');
  await expect(rows).toHaveCount(2);
  // Rolled and saved the moment the door opened.
  await expect
    .poll(async () => (await savedRun(page))?.earnedBlessingPicks?.[`sanctum:${nodeId}`]?.status)
    .toBe('open');
  const offered = (await savedRun(page)).earnedBlessingPicks[`sanctum:${nodeId}`].offered;
  expect(await rows.evaluateAll((list) => list.map((b) => b.dataset.blessing))).toEqual(offered);
  // Nothing spills sideways on a phone.
  expect(await sanctum.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  const box = await rows.first().boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(667 + 1);

  // Take the first: a confirmation names it and the vow, then the take is saved.
  const name = (await rows.first().textContent()).split(' · ')[0];
  await rows.first().scrollIntoViewIfNeeded();
  await rows.first().tap();
  const confirm = page.getByRole('dialog', { name: `Take ${name}?`, exact: true });
  await expect(confirm).toContainText('This is your vow here');
  await confirm.getByRole('button', { name: 'Take the blessing', exact: true }).tap();
  await expect(confirm).toHaveCount(0);
  await expect(sanctum).toContainText('Your vow here was a Blessing');
  await expect(rows).toHaveCount(0);
  await expect
    .poll(async () => (await savedRun(page)).earnedBlessingPicks[`sanctum:${nodeId}`])
    .toMatchObject({ status: 'taken', chosen: offered[0] });

  await sanctum.getByRole('button', { name: 'Leave', exact: true }).tap();
  await expect(sanctum).toHaveCount(0);

  // Close the game and come back through the slot: the vow holds; re-entering offers nothing.
  await reloadToRouteMap(page);
  await page.evaluate((id) => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.onNodeClick(s.runManager.nodeMap.nodes.find((n) => n.id === id));
  }, nodeId);
  await expect(sanctum).toBeVisible();
  await expect(sanctum).toContainText('Your vow here was a Blessing');
  await expect(sanctum.locator('button.church-earned')).toHaveCount(0);
  await sanctum.getByRole('button', { name: 'Leave', exact: true }).tap();
  await expect(sanctum).toHaveCount(0);
  expect(await pauseBlessingNames(page)).toContain(`${name} · Earned`);
  expect(errors).toEqual([]);
});
