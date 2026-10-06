import { test, expect, devices } from '@playwright/test';
import { waitForScene, collectErrors, fightArenaBout } from './helpers.js';
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
    // The bout is real dice (Math.random) against a rolled challenger: a lost bout earns
    // no XP and its result has no EXP bar (docs/specs/exp-bars.md §2.6). Edric outclasses
    // any Bronze challenger (every strike of his hits and kills before a foe can land one),
    // one XP short of a level, so the result always fills a bar and hands off to a card.
    const edric = s.runManager.roster[0];
    Object.assign(edric.stats, { HP: 60, STR: 60, SKL: 60, SPD: 80, DEF: 60, RES: 60, LCK: 80 });
    edric.currentHP = 60;
    edric.xp = 99;
    const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
    window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
    window.arena.show(s.runManager.getAvailableNodes()[0], () => {});
  });
  // The visit's cap (arena.maxFightsPerVisit, per rung) shows before the first bout.
  const visitCap = await page.evaluate(() => window.arena._maxVisitBouts);
  expect(visitCap).toBeGreaterThan(1);
  const colosseumMenu = page.getByRole('dialog', { name: 'Colosseum', exact: true });
  await expect(colosseumMenu).toContainText(`Bouts left here: ${visitCap}`);
  await page.getByRole('button', { name: 'Arena', exact: true }).tap();
  await expect(
    page.getByRole('dialog', { name: 'Arena · Choose fighter', exact: true }),
  ).toContainText(`Bouts left here: ${visitCap}`);
  await page.getByRole('button', { name: /Edric.*Fights/ }).tap();
  await page.screenshot({ path: 'test-results/audit-arena-tiers.png' });
  await page.getByRole('button', { name: /^Bronze/ }).tap();
  let forecast = page.getByRole('dialog', { name: 'Arena · Combat forecast', exact: true });
  await expect(forecast.locator('.service-card')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/audit-arena-forecast.png' });
  await forecast.getByRole('button', { name: 'Back', exact: true }).tap();
  await page.getByRole('button', { name: /^Bronze/ }).tap();
  await expect(forecast.locator('.arena-odds')).toHaveText(
    'If fought to the end: Win over 95% · Lose under 5%',
  );
  await forecast.getByRole('button', { name: 'Fight', exact: true }).tap();
  const log = await fightArenaBout(page);
  await expect(log).toContainText('Victory!');
  await log.getByRole('button', { name: 'Continue', exact: true }).last().tap();
  // The rewards (saved first) open with the EXP bar filling; the arena level hands off
  // to the level-up card over them once it has filled (docs/specs/exp-bars.md §2.6).
  const result = page.getByRole('dialog', { name: 'Arena · Rewards', exact: true });
  const levelCard = page.getByRole('dialog', { name: 'Level up', exact: true });
  await expect(result).toBeVisible();
  await expect(result).toContainText('Level 1 → 2');
  const bar = result.getByRole('meter', { name: 'EXP', exact: true });
  await expect(bar).toBeVisible();
  await page.waitForFunction(() => !window.arena._arenaFill);
  // Filled to what Edric now holds, then the card.
  const xp = await page.evaluate(() => window.arena._selectedUnit.xp);
  await expect(bar).toHaveAttribute('aria-valuenow', String(xp));
  await expect(levelCard).toBeVisible();
  await levelCard
    .getByRole('button', { name: /^(Reveal gains|Continue)$/ })
    .first()
    .tap();
  if (await levelCard.count())
    await levelCard.getByRole('button', { name: 'Continue', exact: true }).tap();
  await expect(levelCard).toHaveCount(0);
  await expect(result).toContainText('XP +');
  const gold = await page.evaluate(() => window.arena.runManager.gold);
  await expect(result).toContainText(`Bouts left here: ${visitCap - 1}`);
  await result.getByRole('button', { name: 'Back to colosseum', exact: true }).tap();
  // One bout fought: the count dropped by one and the arena is still open to the rest.
  await expect(colosseumMenu).toContainText(`Bouts left here: ${visitCap - 1}`);
  await expect(colosseumMenu.getByRole('button', { name: 'Arena', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Mercenary board', exact: true }).tap();
  const merc = page.getByRole('dialog', { name: 'Mercenary board', exact: true });
  await merc.locator('.re-menu-body button').first().tap();
  const hire = page.getByRole('dialog', { name: /^Hire / });
  await expect(hire).toContainText('Hire cost:');
  await page.screenshot({ path: 'test-results/audit-mercenary.png' });
  await page.setViewportSize({ width: 375, height: 667 });
  expect(await hire.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  // Portrait mode is on by default on a phone: turned upright, the hire screen itself
  // shows (no rotate prompt), Confirm hire still in view; then turn back.
  await expect(page.locator('html')).toHaveClass(/\bportrait-ui\b/);
  await expect(page.getByRole('button', { name: 'Use landscape', exact: true })).toBeHidden();
  await expect(hire.getByRole('button', { name: 'Confirm hire', exact: true })).toBeInViewport();
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

test('Colosseum: View map, Roster and unit details, as at the shop and church', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = collectErrors(page);
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.runManager.gold = 10000;
    const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
    window.arena = new ColosseumOverlay(s, s.runManager, s.gameData);
    window.arena.show(s.runManager.getAvailableNodes()[0], () => {});
  });
  const menu = page.getByRole('dialog', { name: 'Colosseum', exact: true });
  // View map returns to the colosseum.
  await menu.getByRole('button', { name: 'View map', exact: true }).tap();
  const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
  await map.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(map).toHaveCount(0);
  await expect(menu.getByRole('button', { name: 'Arena', exact: true })).toBeVisible();
  // Roster: the managed roster, then back to the same screen.
  await menu.getByRole('button', { name: 'Roster', exact: true }).tap();
  const roster = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(roster).toBeVisible();
  await roster.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(roster).toHaveCount(0);
  // The fighter list has the same tools; the chosen fighter has its details.
  await menu.getByRole('button', { name: 'Arena', exact: true }).tap();
  const fighters = page.getByRole('dialog', { name: 'Arena · Choose fighter', exact: true });
  await expect(fighters.getByRole('button', { name: 'Roster', exact: true })).toBeVisible();
  await fighters.getByRole('button', { name: /Edric.*Fights/ }).tap();
  const tiers = page.getByRole('dialog', { name: 'Arena · Choose tier', exact: true });
  await tiers.getByRole('button', { name: "Edric's details", exact: true }).tap();
  await expect(roster.locator('h2').first()).toBeVisible();
  await expect(roster).toContainText('Edric');
  await roster.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(tiers.getByRole('button', { name: /^Bronze/ })).toBeVisible();
  await tiers.getByRole('button', { name: 'Back', exact: true }).tap();
  await fighters.getByRole('button', { name: 'Back', exact: true }).tap();
  // A mercenary's contract opens its read-only sheet.
  await menu.getByRole('button', { name: 'Mercenary board', exact: true }).tap();
  const merc = page.getByRole('dialog', { name: 'Mercenary board', exact: true });
  await merc.locator('.re-menu-body button').first().tap();
  const hire = page.getByRole('dialog', { name: /^Hire / });
  const name = (await hire.getAttribute('aria-label')).replace(/^Hire /, '');
  await hire.getByRole('button', { name: 'Details', exact: true }).tap();
  const inspect = page.getByRole('dialog', { name: 'Inspect roster', exact: true });
  await expect(inspect).toContainText(name);
  await expect(inspect.getByRole('tab', { name: 'Convoy' })).toHaveCount(0);
  await inspect.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(hire.getByRole('button', { name: 'Confirm hire', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.arena.runManager.gold)).toBe(10000);
  expect(errors).toEqual([]);
});

test('Church vow: taking a blessing is this church’s vow, and closes its promotions', async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors = collectErrors(page);
  await page.goto('/?devScene=nodemap&mobilePreview=1');
  await waitForScene(page, 'NodeMap');
  await page.getByRole('button', { name: 'Skip conversation', exact: true }).tap();
  const gold = await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.runManager.gold = 10000;
    s.runManager.activeBlessings = [];
    s.runManager.roster[0].level = 10;
    s.handleChurch(s.runManager.getAvailableNodes()[0]);
    return s.runManager.gold;
  });
  const church = page.getByRole('dialog', { name: 'Church', exact: true });
  await expect(church).toContainText('one vow per church');
  const blessing = church.locator('.church-blessing').first();
  const label = await blessing.textContent();
  const name = label.split(' · ')[0];
  await blessing.tap();
  const confirm = page.getByRole('dialog', { name: `Take ${name}?`, exact: true });
  await confirm.getByRole('button', { name: 'Take the blessing', exact: true }).tap();
  await expect(church).toContainText('Your vow here was a Blessing');
  await expect(church.locator('.church-blessing')).toHaveCount(0);
  await expect(church.getByRole('button', { name: /Edric.*Lord/ })).toBeDisabled();
  const after = await page.evaluate(() => {
    const run = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
    return { ids: run.getActiveBlessingIds(), gold: run.gold };
  });
  expect(after.ids).toHaveLength(1);
  if (name === 'Coin of Fate') expect(after.gold).toBe(gold + 750);
  expect(errors).toEqual([]);
});
