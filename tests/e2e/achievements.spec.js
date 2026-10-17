// Achievements in the browser (docs/specs/achievements.md §5, §6): the Records screen's
// Achievements tab on a desktop and an upright phone, and the unlock card.
//
// What can go wrong here that the unit tests cannot see: the tab never opens, a secret shows
// its name, a row runs past the phone's width, the card never shows, shows a card per
// retroactive achievement, takes a tap meant for what is under it, or never leaves.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

const DEVICE_KEY = 'emblem_rogue_achievements';
const seeded = {
  v: 1,
  earned: {
    first_blood: { at: Date.UTC(2026, 9, 1) },
    seize_the_day: { at: Date.UTC(2026, 9, 3) },
    shatter: { at: Date.UTC(2026, 9, 9) },
    unfathomed: { at: Date.UTC(2026, 9, 12) },
  },
  sets: { marks: ['forge', 'veil'], rungs: ['normal'] },
  tally: { steals: { 1: 6 } },
  recent: [],
};

async function openAchievements(page) {
  await page.addInitScript(
    ([key, state]) => localStorage.setItem(key, JSON.stringify(state)),
    [DEVICE_KEY, seeded],
  );
  await page.goto('/?devScene=title');
  await waitForScene(page, 'Title');
  await page.getByRole('button', { name: 'Records', exact: true }).click();
  const records = page.getByRole('dialog', { name: 'Records' });
  await expect(records).toBeVisible();
  await records.getByRole('tab', { name: 'Achievements' }).click();
  await expect(records.getByRole('tab', { name: 'Achievements' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  return records;
}

async function expectTab(records) {
  await expect(records.locator('.ach-total')).toHaveText(/^4 \/ \d+$/);
  // An earned secret reads in full; one not yet earned gives nothing away.
  await expect(records.locator('.ach-row[data-id="unfathomed"] .ach-name')).toHaveText(
    'Unfathomed',
  );
  await expect(records.locator('.ach-row[data-id="third_time"] .ach-name')).toHaveText('???');
  await expect(records.locator('.ach-row[data-id="third_time"] .ach-rule')).not.toContainText(
    'boss',
  );
  // Counted ones show how far along they are.
  await expect(records.locator('.ach-row[data-id="cutpurse"] .ach-count')).toHaveText('6 / 15');
  await expect(records.locator('.ach-row[data-id="five_marks"] .ach-count')).toHaveText('2 / 5');
  await expect(records.locator('.ach-row[data-id="shatter"]')).toHaveClass(/is-earned/);
}

async function expectNoSidewaysSpill(records) {
  const spill = await records.locator('.re-menu-body').evaluate((body) => {
    const edge = body.getBoundingClientRect().right + 1;
    return [...body.querySelectorAll('.ach-row, .ach-summary')]
      .filter((el) => el.getBoundingClientRect().right > edge)
      .map((el) => el.dataset.id || el.className);
  });
  expect(spill).toEqual([]);
}

test('desktop: Records opens on Victories and its Achievements tab lists them', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const records = await openAchievements(page);
  await expectTab(records);
  await expectNoSidewaysSpill(records);
  await page.screenshot({ path: info.outputPath('achievements-desktop.png') });
  // Back to Victories and closed: the Title is as it was.
  await records.getByRole('tab', { name: 'Victories' }).click();
  await expect(records.locator('.rr-intro')).toBeVisible();
  await records.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(records).toHaveCount(0);
});

test('upright phone: the tab fits the width and scrolls', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const records = await openAchievements(page);
  await expectTab(records);
  await expectNoSidewaysSpill(records);
  await page.screenshot({ path: info.outputPath('achievements-phone.png') });
  const body = records.locator('.re-menu-body');
  await body.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: info.outputPath('achievements-phone-secrets.png') });
});

test('the unlock card: one per achievement, one for the past, click-through, then gone', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?devScene=title');
  await waitForScene(page, 'Title');
  await page.evaluate(async () => {
    const { announceAchievements } = await import('/src/engine/AchievementStore.js');
    announceAchievements(['first_blood', 'heavy_hand']);
  });
  const cards = page.locator('.ach-toast');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0).locator('.ach-toast-name')).toHaveText('First Blood');
  await expect(cards.nth(1).locator('.ach-toast-heading')).toHaveText('Achievement · Silver');
  await page.screenshot({ path: info.outputPath('achievement-card.png') });
  // A tap where the card stands reaches what is under it.
  const box = await cards.nth(0).boundingBox();
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.ach-toast') !== null,
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hit).toBe(false);
  await expect(cards).toHaveCount(0, { timeout: 10_000 });

  await page.evaluate(async () => {
    const { announceAchievements } = await import('/src/engine/AchievementStore.js');
    announceAchievements(['first_blood', 'seize_the_day', 'into_the_dusk'], { retro: true });
  });
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator('.ach-toast-name')).toHaveText('3 achievements earned');
  await expect(cards.first()).toHaveAttribute('data-tier', 'gold');
  await page.screenshot({ path: info.outputPath('achievement-card-retro.png') });
});
