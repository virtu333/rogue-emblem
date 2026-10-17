// Omens on the difficulty screen (docs/specs/omens.md): closed until a Black Sun win, chosen in
// the picker by taps, carried into the run, and laid out inside the phone and the 640x480 screen.
import { test, expect, devices } from '@playwright/test';
import { waitForScene } from './helpers.js';

async function openDifficulty(page, { won = true } = {}) {
  await page.goto('/?devScene=homebase&mobilePreview=1');
  await waitForScene(page, 'HomeBase');
  await page.evaluate((winBlackSun) => {
    const { meta } = window.__emblemRogueGame.scene.getScene('HomeBase');
    const marks = ['beatGame', 'beatDusk', 'beatHard'];
    if (winBlackSun) marks.push('beatLunatic', 'heat:hard:5');
    for (const m of marks) meta.milestones.add(m);
  }, won);
  await page.getByRole('button', { name: 'Begin Run', exact: true }).click();
  await waitForScene(page, 'DifficultySelect');
}

/** The rank text the data gives an Omen at a rank (1-based), and its heat. */
const omenRank = (page, id, rank) =>
  page.evaluate(
    ([omenId, r]) => {
      const { gameData } = window.__emblemRogueGame.scene.getScene('DifficultySelect');
      const omen = gameData.difficulty.omens.list.find((o) => o.id === omenId);
      return omen.ranks[r - 1];
    },
    [id, rank],
  );

/** A landscape phone's page (a context of its own: a device preset in test.use forces a worker). */
async function phonePage(browser) {
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    viewport: { width: 844, height: 390 },
  });
  return { context, page: await context.newPage() };
}

test.describe('phone', () => {
  test('Omens stay closed until a Black Sun win', async ({ browser }) => {
    const { context, page } = await phonePage(browser);
    await openDifficulty(page, { won: false });
    await page.locator('[data-mode="hard"]').tap();
    await expect(page.locator('[data-focus="omens"]')).toHaveCount(0);
    await context.close();
  });

  test('the picker raises ranks, sums Heat, and the run starts with them', async ({ browser }) => {
    const { context, page } = await phonePage(browser);
    await openDifficulty(page);
    await page.locator('[data-mode="dusk"]').tap();
    await expect(page.locator('[data-focus="omens"]')).toHaveCount(0);
    await page.locator('[data-mode="hard"]').tap();
    const opener = page.locator('[data-focus="omens"]');
    await expect(opener).toHaveText('Omens: Heat 0');
    await opener.tap();

    const picker = page.getByRole('dialog', { name: 'Omens' });
    await expect(picker).toBeVisible();
    await expect(picker.locator('.om-summary')).toContainText('Best: 5');
    const hardened = picker.locator('[data-focus="omen-hardened"]');
    await hardened.tap();
    await hardened.tap();
    const rank2 = await omenRank(page, 'hardened', 2);
    await expect(hardened).toHaveAttribute('data-rank', '2');
    await expect(hardened).toContainText(rank2.text);
    const grave = picker.locator('[data-focus="omen-grave_road"]');
    await grave.tap();
    const graveRank = await omenRank(page, 'grave_road', 1);
    const heat = rank2.heat + graveRank.heat;
    await expect(picker.locator('.om-summary')).toContainText(`Heat ${heat}`);

    await picker.locator('[data-focus="omens-done"]').tap();
    await expect(picker).toHaveCount(0);
    await expect(opener).toHaveText(`Omens: Heat ${heat}`);

    await page.getByRole('button', { name: 'Confirm', exact: true }).tap();
    await waitForScene(page, 'BlessingSelect');
    const omens = await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('BlessingSelect').runManager.omens,
    );
    expect(omens.ranks).toEqual({ hardened: 2, grave_road: 1 });
    expect(omens.heat).toBe(heat);
    await context.close();
  });
});

for (const [width, height, label] of [
  [640, 480, 'desktop 640x480'],
  [390, 844, 'upright phone'],
])
  test(`the picker fits the ${label}`, async ({ browser }) => {
    const context = await browser.newContext(
      width < height
        ? { ...devices['iPhone 13'], viewport: { width, height } }
        : { viewport: { width, height } },
    );
    const page = await context.newPage();
    await openDifficulty(page);
    await page.locator('[data-mode="lunatic"]').click();
    await page.locator('[data-focus="omens"]').click();
    const picker = page.getByRole('dialog', { name: 'Omens' });
    await expect(picker).toBeVisible();
    // Nothing spills sideways, and Done can be reached.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    for (const row of await picker.locator('.om-row').all()) {
      const fits = await row.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits).toBe(true);
    }
    const done = picker.locator('[data-focus="omens-done"]');
    await done.scrollIntoViewIfNeeded();
    const box = await done.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await done.click();
    await expect(picker).toHaveCount(0);
    await context.close();
  });
