// The shrine's gift on an upright phone (docs/specs/blessings-v3.md §7 and §8, PR D5): a fourth
// card is the "no whole card on 375x667" risk the spec recorded. With the gift offered (the pinned
// seed ?runSeed=6, DEV only: the Fallen Hoard), every card is a full-width row, and each one,
// chosen by touch or reached by the keyboard, lies whole inside the scrolling list and the
// screen; nothing scrolls sideways; Confirm stays tappable; the gift is taken.
//
// Measured with bounding boxes against the list's own box (the list clips its rows), so the check
// is the player's view: a card cut by the list's edge or the screen fails.
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  attachSlot,
  expectNoSidewaysScroll,
  expectPortraitUi,
  expectTappable,
  pageErrors,
  phone,
  quietSettings,
} from './portraitHelpers.js';
import { waitForScene } from './helpers.js';

test.setTimeout(120_000);
const SEED = 6;
const { defaultBrowserType: _browser, ...use } = phone(PORTRAIT_PHONES[0]); // 375x667
test.use(use);

/** How the element sits against the list that clips it and the screen (CSS px, + is inside). */
function wholeness(locator) {
  return locator.evaluate((el) => {
    const card = el.getBoundingClientRect();
    const list = (el.closest('.ch-draft') || document.documentElement).getBoundingClientRect();
    const top = Math.max(list.top, 0);
    const bottom = Math.min(list.bottom, innerHeight);
    return {
      top: card.top - top,
      bottom: bottom - card.bottom,
      left: card.left - Math.max(list.left, 0),
      right: Math.min(list.right, innerWidth) - card.right,
      height: card.height,
      room: bottom - top,
    };
  });
}
async function expectWhole(locator, label) {
  await expect
    .poll(async () => {
      const w = await wholeness(locator);
      return Math.min(w.top, w.bottom, w.left, w.right) >= -0.5;
    }, label)
    .toBe(true);
}

test('375x667: four cards with the gift, each chosen card whole in view, the gift taken', async ({
  page,
}) => {
  const errors = pageErrors(page);
  await quietSettings(page);
  await page.goto(`/?devScene=difficulty&runSeed=${SEED}`);
  await page.waitForFunction(() => window.__sceneState?.activeScene === 'DifficultySelect', null, {
    timeout: 60_000,
  });
  await expectPortraitUi(page);
  await attachSlot(page);
  await page.evaluate(() => {
    const meta = window.__emblemRogueGame.registry.get('meta');
    meta.runsStarted = 1;
    meta._save();
  });
  await page.getByRole('button', { name: 'Confirm', exact: true }).tap();
  await waitForScene(page, 'BlessingSelect');
  const shrine = page.getByRole('dialog', { name: 'Choose a blessing', exact: true });
  await expect(shrine).toBeVisible();
  const cards = shrine.locator('.ch-tarot');
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(3)).toHaveAttribute('data-tier', 'gift');
  await expectNoSidewaysScroll(page, '[aria-label="Choose a blessing"]');

  // Touch: each card, chosen in turn, is whole inside the list (a chosen card opens; the list
  // brings it clear), never taller than the room the list has.
  for (let i = 0; i < 4; i++) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    await card.tap();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    const w = await wholeness(card);
    expect(w.height, `card ${i} fits the list`).toBeLessThanOrEqual(w.room + 0.5);
    await expectWhole(card, `chosen card ${i} whole in view`);
    // The cost (here the catch) is a price: always inside its card.
    const cardBox = await card.boundingBox();
    const costBox = await card.locator('.ch-cost').boundingBox();
    expect(costBox.y + costBox.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 0.5);
    await expectTappable(shrine.getByRole('button', { name: 'Confirm', exact: true }));
  }

  // Keyboard: walking down the list keeps the focused card whole too, the gift included.
  await cards.nth(0).focus();
  for (let i = 1; i < 4; i++) {
    await page.keyboard.press('ArrowDown');
    await expect(cards.nth(i)).toBeFocused();
    await expectWhole(cards.nth(i), `focused card ${i} whole in view`);
  }
  await page.keyboard.press('Enter');
  await expect(cards.nth(3)).toHaveAttribute('aria-pressed', 'true');
  await expectWhole(cards.nth(3), 'the chosen gift whole in view');
  await expect(shrine.locator('.ch-footer-lead')).toContainText('Hunted:');
  await expectNoSidewaysScroll(page, '[aria-label="Choose a blessing"]');

  const confirm = shrine.getByRole('button', { name: 'Confirm', exact: true });
  await expectTappable(confirm);
  await confirm.tap();
  await waitForScene(page, 'NodeMap');
  expect(
    await page.evaluate(
      () => window.__emblemRogueGame.scene.getScene('NodeMap').runManager.startGift?.id,
    ),
  ).toBe('fallen_hoard');
  expect(errors).toEqual([]);
});
