import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

test.use({ ...devices['iPhone 13'], viewport: { width: 844, height: 390 } });
test('legendary traits and recovered staves are readable in the mobile roster and Compendium', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem(
      'emblem_rogue_settings',
      JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false }),
    ),
  );
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await expect(skip).toBeVisible();
  await skip.click();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const rm = s.runManager;
    rm.roster[0].traits = ['standard_bearer'];
    const sera = rm.roster.find((u) => u.name === 'Sera');
    sera.traits = ['overflowing_grace'];
    const staff = sera.inventory.find((w) => w.type === 'Staff');
    staff._usesSpent = 2;
    const node = rm.nodeMap.nodes.find((n) => !n.completed && n.type === 'battle');
    if (!node || !rm.completeBattle(rm.getRoster(), node.id))
      throw new Error('Fixture battle did not complete');
    s._openRoster();
  });
  const roster = page.locator('.mr-sheet');
  await expect(roster).toContainText('Legendary · Standard Bearer');
  await roster.getByRole('button', { name: /Sera/ }).click();
  await expect(roster).toContainText('Legendary · Overflowing Grace');
  await roster.getByText('Legendary · Overflowing Grace', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/legendary-trait-mobile.png' });
  await roster.getByRole('button', { name: 'Equipment', exact: true }).click();
  await expect(roster).toContainText('Refills after battle');
  const staffSummary = roster.getByText(/Staff · Range .*Refills after battle/);
  await staffSummary.scrollIntoViewIfNeeded();
  const summary = await staffSummary.innerText();
  const [, remaining, maximum] = summary.match(/Uses (\d+)\/(\d+)/);
  expect(remaining).toBe(maximum);
  expect(await roster.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/legendary-staff-mobile.png' });
  await roster.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { CompendiumOverlay } = await import('/src/ui/CompendiumOverlay.js');
    s._legendaryTestCompendium = new CompendiumOverlay(s, s.gameData);
    s._legendaryTestCompendium.show();
  });
  await page.getByRole('button', { name: 'Lords', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Compendium', exact: true })).toContainText(
    'Legendary trait: Standard Bearer',
  );
  expect(errors).toEqual([]);
});
