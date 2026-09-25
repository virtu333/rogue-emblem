import { test, expect, devices } from '@playwright/test';
import { waitForScene, collectErrors } from './helpers.js';
test.use({ ...devices['iPhone SE'], viewport: { width: 667, height: 375 } });
test('Church heal, roster, map, promotion cancellation and arena forecast/rewards/hire', async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors = collectErrors(page);
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page
    .getByRole('button', { name: 'Skip conversation', exact: true })
    .waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.runManager.gold = 10000;
    s.runManager.roster[0].currentHP = 1;
    s.runManager.roster[0].level = 10;
    s.handleChurch(s.runManager.getAvailableNodes()[0]);
  });
  let church = page.getByRole('dialog', { name: 'Church', exact: true });
  await church.getByRole('button', { name: 'Heal all · Free', exact: true }).tap();
  await expect(church.getByRole('status')).toHaveText('All units healed.');
  expect(
    await church.locator('.re-menu-body').evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
  ).toBeGreaterThanOrEqual(14);
  await church.getByRole('button', { name: 'View map', exact: true }).tap();
  await page
    .getByRole('dialog', { name: 'Campaign map', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap();
  await church.getByRole('button', { name: 'Roster', exact: true }).tap();
  await page
    .getByRole('dialog', { name: 'Manage roster', exact: true })
    .getByRole('button', { name: 'Close', exact: true })
    .tap();
  await church.getByRole('button', { name: /Edric.*Lord/ }).tap();
  const promote = page.getByRole('dialog', { name: 'Promote Edric', exact: true });
  await promote.getByRole('button', { name: 'Close', exact: true }).tap();
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.gold),
  ).toBe(10000);
  await church.getByRole('button', { name: /Edric.*Lord/ }).tap();
  await promote.getByRole('button', { name: /^Promote to Great Lord · 3500 G$/ }).tap();
  // The rite plays over the church once gold, promotion and save are committed.
  const rite = page.getByRole('dialog', { name: 'Promotion', exact: true });
  await expect(rite).toBeVisible();
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.gold),
  ).toBe(6500);
  await page.waitForTimeout(300);
  await rite.getByRole('button', { name: /Skip|Continue/ }).tap();
  await expect(rite.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await rite.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(rite).toHaveCount(0);
  await expect(church.getByRole('status')).toContainText('promoted');
  expect(
    await page.evaluate(() => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.gold),
  ).toBe(6500);
  await page.screenshot({ path: 'test-results/audit-church.png' });
  await church.getByRole('button', { name: 'Leave', exact: true }).tap();
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
    window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
    window.arena.show(s.runManager.getAvailableNodes()[0], () => {});
  });
  await page.getByRole('button', { name: 'Arena', exact: true }).tap();
  await page.getByRole('button', { name: /Edric.*Fights/ }).tap();
  await page.screenshot({ path: 'test-results/audit-arena-tiers.png' });
  await page.getByRole('button', { name: /^Bronze/ }).tap();
  let forecast = page.getByRole('dialog', { name: 'Arena · Combat forecast', exact: true });
  await expect(forecast.locator('.service-card')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/audit-arena-forecast.png' });
  await forecast.getByRole('button', { name: 'Back', exact: true }).tap();
  await page.getByRole('button', { name: /^Bronze/ }).tap();
  await forecast.getByRole('button', { name: 'Fight', exact: true }).tap();
  await page.getByRole('button', { name: 'Continue', exact: true }).last().tap();
  // An arena level plays the level-up card(s) before the rewards (saved first).
  const result = page.getByRole('dialog', { name: 'Arena · Rewards', exact: true });
  const levelCard = page.getByRole('dialog', { name: 'Level up', exact: true });
  await expect(result.or(levelCard)).toBeVisible();
  while (await levelCard.isVisible().catch(() => false)) {
    await page.waitForTimeout(250);
    await levelCard.getByRole('button', { name: /^(Reveal gains|Continue)$/ }).tap();
    if (await levelCard.isVisible().catch(() => false))
      await levelCard.getByRole('button', { name: 'Continue', exact: true }).tap();
  }
  await expect(result).toContainText('XP');
  const gold = await page.evaluate(() => window.arena.runManager.gold);
  await result.getByRole('button', { name: 'Back to colosseum', exact: true }).tap();
  await page.getByRole('button', { name: 'Mercenary board', exact: true }).tap();
  const merc = page.getByRole('dialog', { name: 'Mercenary board', exact: true });
  await merc.locator('.re-menu-body button').first().tap();
  const hire = page.getByRole('dialog', { name: /^Hire / });
  await expect(hire).toContainText('Hire cost:');
  await page.screenshot({ path: 'test-results/audit-mercenary.png' });
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await hire.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  // Portrait intentionally places the landscape prompt above the game.
  // Verify layout while rotated, then restore the supported play orientation.
  await expect(page.getByRole('button', { name: 'Use landscape', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 667, height: 375 });
  await expect(page.getByRole('button', { name: 'Use landscape', exact: true })).toBeHidden();
  await hire.getByRole('button', { name: 'Back', exact: true }).tap();
  expect(await page.evaluate(() => window.arena.runManager.gold)).toBe(gold);
  await merc.locator('.re-menu-body button').first().tap();
  await hire.getByRole('button', { name: 'Confirm hire', exact: true }).tap();
  // The hire is saved, then the mercenary's "joins your army" card (skippable).
  const join = page.locator('.gr-join-layer');
  await expect(join).toBeVisible();
  await page.waitForTimeout(250);
  await join.tap();
  await expect(merc).toContainText('Hired');
  await merc.getByRole('button', { name: 'Back', exact: true }).tap();
  await page
    .getByRole('dialog', { name: 'Colosseum', exact: true })
    .getByRole('button', { name: 'Leave', exact: true })
    .tap();
  await expect(page.locator('.service-menu')).toHaveCount(0);
  expect(errors).toEqual([]);
});
