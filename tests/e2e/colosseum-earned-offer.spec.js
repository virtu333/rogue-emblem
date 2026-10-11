// The Colosseum's earned blessing (docs/specs/blessings-v3.md §6.7, D-8): the first win in a gold
// bout offers the Mercenary Ledger, saved with the bout; the colosseum's menu opens the one-card
// pick; taken, the fees are halved and the visit allows one more bout. On a landscape phone.
// Every wait is on state (dialogs, the slot's save), never on time.
import { test, expect } from '@playwright/test';
import { attachSlot, pageErrors, phone, quietSettings } from './portraitHelpers.js';
import { fightArenaBout, waitForGame, waitForScene } from './helpers.js';
import { savedRun } from './earnedPickHelpers.js';

test.setTimeout(150_000);
const { defaultBrowserType: _browser, ...use } = phone({ width: 667, height: 375 });
test.use(use);

test('a gold win offers the Mercenary Ledger; taken, fees are halved and a bout is added', async ({
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
  await page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const r = s.runManager;
    r.actIndex = 1; // Act II: the gold tier is open
    r.gold = 10000;
    // Edric outclasses any gold challenger: every strike lands and fells it first.
    const edric = r.roster[0];
    Object.assign(edric.stats, { HP: 80, STR: 90, SKL: 90, SPD: 99, DEF: 90, RES: 90, LCK: 90 });
    edric.currentHP = 80;
    const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
    window.arena = new ColosseumOverlay(s, r, s.gameData);
    s.colosseumOverlay = window.arena;
    window.arena.show(r.getAvailableNodes()[0], () => {});
  });
  const cap = await page.evaluate(() => window.arena._maxVisitBouts);
  const menu = page.getByRole('dialog', { name: 'Colosseum', exact: true });
  await expect(menu).toContainText(`Bouts left here: ${cap}`);
  await menu.getByRole('button', { name: 'Arena', exact: true }).tap();
  await page.getByRole('button', { name: /Edric.*Fights/ }).tap();
  await page.getByRole('button', { name: /^Gold · .*Loss −200 G/ }).tap();
  const forecast = page.getByRole('dialog', { name: 'Arena · Combat forecast', exact: true });
  await forecast.getByRole('button', { name: 'Fight', exact: true }).tap();
  const log = await fightArenaBout(page);
  await expect(log).toContainText('Victory!');
  // Rolled with the bout's own save, before anything is shown.
  await expect
    .poll(async () => (await savedRun(page))?.earnedBlessingPicks?.colosseum)
    .toMatchObject({ source: 'colosseum', status: 'owed', offered: ['mercenary_ledger'] });
  await log.getByRole('button', { name: 'Continue', exact: true }).last().tap();
  const result = page.getByRole('dialog', { name: 'Arena · Rewards', exact: true });
  await result.getByRole('button', { name: 'Back to colosseum', exact: true }).tap();

  // The menu opens on the pick: one card, from the Colosseum.
  const pick = page.getByRole('dialog', { name: 'An earned blessing', exact: true });
  await expect(pick).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(pick.locator('.ch-card')).toHaveCount(1);
  await expect(pick).toContainText('Won from the Colosseum. Take it, or leave it.');
  expect(await pick.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  await pick.locator('.ch-card').first().tap();
  await pick.getByRole('button', { name: 'Take', exact: true }).tap();
  await expect(pick).toHaveCount(0);

  // Back on the menu: the bout fought is counted and the Ledger's is added.
  await expect(menu).toContainText(`Bouts left here: ${cap}`);
  await expect
    .poll(async () => (await savedRun(page))?.earnedBlessingPicks?.colosseum?.status)
    .toBe('taken');
  expect((await savedRun(page)).activeBlessings.map((b) => b.id ?? b)).toContain(
    'mercenary_ledger',
  );
  // The fees are halved where they are shown.
  await menu.getByRole('button', { name: 'Arena', exact: true }).tap();
  const tiers = page.getByRole('dialog', { name: 'Arena · Choose tier', exact: true });
  await page.getByRole('button', { name: /Edric.*Fights/ }).tap();
  await expect(tiers).toContainText('Mercenary Ledger: entry fees are halved.');
  await expect(tiers.getByRole('button', { name: /^Gold · .*Loss −100 G/ })).toBeVisible();
  expect(errors).toEqual([]);
});
