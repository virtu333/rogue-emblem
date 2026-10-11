// A twisted earned blessing (docs/specs/blessings-v3.md §6.6), on a landscape phone: an act
// boss's pair holding Hollow Sun's Favor (forced by setting the ledger in-page, as a victory
// would have filed it), taken from the route map's pick. Its twist is charged with it: the
// Hunted chip on the loom ("Until Act III"), and the pause list's "Twist: ..." line under the
// card. A reload through the slot shows both again, and the twist is not charged twice. Every
// wait is on state (dialogs, the scene, the slot's save), never on time.
import { test, expect } from '@playwright/test';
import { attachSlot, pageErrors, phone, quietSettings } from './portraitHelpers.js';
import { waitForGame, waitForScene } from './helpers.js';
import { PICK, pickIds, reloadToRouteMap, savedRun } from './earnedPickHelpers.js';

test.setTimeout(150_000);
const { defaultBrowserType: _browser, ...use } = phone({ width: 667, height: 375 });
test.use(use);

const TWISTED = 'hollow_sun_favor';
const PAIR = [TWISTED, 'captains_whistle'];

/** The pause list's held blessing entries: their name lines and their price lines. */
async function pauseBlessings(page) {
  await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').showPauseMenu());
  const list = page.getByRole('list', { name: 'Blessings', exact: true });
  await expect(list).toBeVisible();
  const entries = await list.locator('li').evaluateAll((items) =>
    items.map((li) => ({
      name: li.querySelector('strong')?.textContent || '',
      price:
        li.querySelector('.mp-blessing-price summary, span.mp-blessing-price')?.textContent || '',
    })),
  );
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
  return entries;
}

test("a twisted card taken from the boss's pick: its Hunted chip and its Twist line, kept on reload", async ({
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

  // Act I's boss filed this pair at its victory commit; the route map's host offers it.
  const twistLabel = await page.evaluate(
    ({ pair, id }) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const r = s.runManager;
      r.earnedBlessingPicks = {
        act1: {
          version: 2,
          source: 'act_boss',
          actId: 'act1',
          nodeId: r.nodeMap.bossNodeId,
          offered: pair,
          status: 'owed',
          chosen: null,
        },
      };
      s._maybeOpenEarnedPick();
      return s.gameData.blessings.blessings.find((b) => b.id === id).twist.label;
    },
    { pair: PAIR, id: TWISTED },
  );
  const pick = page.getByRole('dialog', { name: PICK, exact: true });
  await expect(pick).toBeVisible();
  expect(await pickIds(pick)).toEqual(PAIR);
  // The twisted card says what it costs, as a Twist.
  const card = pick.locator(`.ch-card[data-blessing="${TWISTED}"]`);
  await expect(card).toContainText('Twist');
  await expect(card).toContainText(twistLabel);
  await expect(page.locator('.re-burden[data-burden="hunted"]')).toHaveCount(0);

  await card.tap();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  await pick.getByRole('button', { name: 'Take', exact: true }).tap();
  await expect(pick).toHaveCount(0);

  // Saved with its twist: the held price, the Hunted through Act II.
  await expect
    .poll(async () => (await savedRun(page))?.earnedBlessingPicks?.act1?.status)
    .toBe('taken');
  const saved = await savedRun(page);
  expect(saved.activeBlessings.find((b) => b.id === TWISTED)?.rolledCost).toMatchObject({
    kind: 'twist',
    label: twistLabel,
  });
  expect(saved.burdens).toEqual([
    expect.objectContaining({ id: 'hunted', untilAct: 'act3', battles: 0 }),
  ]);

  // The loom's chip and the pause list's line.
  const chip = page.locator('.re-burden[data-burden="hunted"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Until Act III');
  const entry = (await pauseBlessings(page)).find((e) => e.name.startsWith("Hollow Sun's Favor"));
  expect(entry).toEqual({
    name: "Hollow Sun's Favor · Earned",
    price: `Twist: ${twistLabel}`,
  });

  // Close the game and come back through the slot: both still there, the twist not charged
  // twice (one Hunted, one held price), the pick not offered again.
  await reloadToRouteMap(page);
  await expect(page.getByRole('dialog', { name: PICK, exact: true })).toHaveCount(0);
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Until Act III');
  const after = (await pauseBlessings(page)).filter((e) => e.name.startsWith("Hollow Sun's Favor"));
  expect(after).toEqual([{ name: "Hollow Sun's Favor · Earned", price: `Twist: ${twistLabel}` }]);
  const reloaded = await savedRun(page);
  expect(reloaded.burdens.filter((b) => b.id === 'hunted')).toHaveLength(1);
  expect(reloaded.activeBlessings.filter((b) => b.id === TWISTED)).toHaveLength(1);
  expect(errors).toEqual([]);
});
