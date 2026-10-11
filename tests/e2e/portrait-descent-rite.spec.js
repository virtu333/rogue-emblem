// The Rite on an upright phone (docs/specs/act-v-descent.md §4, §8; docs/portrait-battles.md): the
// chip beside the route map's burden chips, its note, and the gate card's Rite block, on a 390x844
// phone in the real portrait shell. The Descent ships dark; the review route
// (src/utils/devDescentFixtures.js, dev routes only) switches it on for the page.
//
// Ways this can fail, a test each:
//   1. the chip or its note overflows the page sideways or leaves the screen upright;
//   2. the note's tap target (the chip) is not reachable by touch, or the card's Rite block is
//      missing or cut off once the gate is selected.
import { test, expect } from '@playwright/test';
import {
  expectNoSidewaysScroll,
  expectPortraitUi,
  phone,
  quietSettings,
} from './portraitHelpers.js';
import { IN_ANSWERED, openRoute, selectNode } from './riteHelpers.js';

const cardText = (route) => route.locator('.re-loom-card .re-loom-rite');

test.describe('an upright phone', () => {
  // eslint-disable-next-line no-unused-vars
  const { defaultBrowserType, ...context } = phone({ width: 390, height: 844 });
  test.use(context);

  test('the chip, its note and the card’s Rite block fit the screen', async ({ page }) => {
    await quietSettings(page);
    const route = await openRoute(page, { rite: IN_ANSWERED });
    await expectPortraitUi(page);
    const chip = route.locator('.re-burden.re-rite');
    await expect(chip.locator('.re-burden-short')).toHaveText(`${IN_ANSWERED} words · Answered`);
    await chip.tap();
    await expect(route.locator('.re-burden-note')).toBeVisible();
    await expectNoSidewaysScroll(page);
    // Inside the viewport, whole.
    const box = await route.locator('.re-burden-note').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 0.5);
    await chip.tap();
    await selectNode(page, 'gate');
    await expect(cardText(route)).toBeVisible();
    await expectNoSidewaysScroll(page);
  });
});
