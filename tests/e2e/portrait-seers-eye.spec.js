// Seer's Eye upright (docs/portrait-battles.md; docs/specs/blessings-v3.md §6.7): the route map's
// scout panel on an upright phone wraps inside its card. Nothing scrolls sideways, no row clips,
// and the panel reads what the scout found. The landscape journey (the panel, then the battle it
// scouted) is seers-eye-preview.spec.js.
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  clippedText,
  expectNoSidewaysScroll,
  expectPortraitUi,
  pageErrors,
  phone,
} from './portraitHelpers.js';
import { loomCard, routeWithTheEye, scoutPanel } from './seersEyeHelpers.js';

test.setTimeout(150_000);

for (const viewport of [PORTRAIT_PHONES[0], PORTRAIT_PHONES[1]]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    const { defaultBrowserType: _browser, ...use } = phone(viewport);
    test.use(use);

    test('the panel wraps inside the card: no sideways scroll, every row whole', async ({
      page,
    }) => {
      const errors = pageErrors(page);
      const nodeId = await routeWithTheEye(page);
      await expectPortraitUi(page);
      await page.locator(`.re-node[data-node="${nodeId}"]`).tap();
      await expect(scoutPanel(page)).toBeAttached();
      await scoutPanel(page).scrollIntoViewIfNeeded();
      await expect(scoutPanel(page)).toContainText("Seer's Eye");
      await expect(scoutPanel(page)).toContainText('Scouted for 2 in the field.');
      await expectNoSidewaysScroll(page, '.re-loom-card');
      expect(await loomCard(page).evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      const rows = scoutPanel(page).locator('li');
      expect(await rows.count()).toBeGreaterThan(0);
      for (const row of await rows.all())
        expect(await row.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
      expect(await clippedText(page, '.re-loom-scout')).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
