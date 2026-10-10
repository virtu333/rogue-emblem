// The act boss's earned-blessing pick upright (docs/portrait-battles.md): the two cards read as
// rows, whole and unclipped; Skip and Take are a thumb's size and in view; nothing scrolls
// sideways; the pick taken upright advances the act like any other.
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  clippedText,
  expectNoSidewaysScroll,
  expectPortraitUi,
  expectTappable,
  pageErrors,
  phone,
} from './portraitHelpers.js';
import { pickIds, playOnToRouteMap, savedRun, winBossToPick } from './earnedPickHelpers.js';

test.setTimeout(180_000);

for (const viewport of [PORTRAIT_PHONES[0], PORTRAIT_PHONES[1]]) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    const { defaultBrowserType: _browser, ...use } = phone(viewport);
    test.use(use);

    test('the pick upright: whole cards, a thumb-sized Take, and the act advances', async ({
      page,
    }) => {
      const errors = pageErrors(page);
      const { pick } = await winBossToPick(page);
      await expectPortraitUi(page);
      const offered = await pickIds(pick);
      expect(offered).toHaveLength(2);
      await expectNoSidewaysScroll(page, '.ch-earned-pick');
      expect(await clippedText(page, '.ch-earned-pick')).toEqual([]);
      const cards = pick.locator('.ch-card');
      for (let i = 0; i < 2; i++) await expect(cards.nth(i)).toBeInViewport();
      await expectTappable(pick.getByRole('button', { name: 'Skip', exact: true }));

      await cards.last().tap();
      await expect(cards.last()).toHaveAttribute('aria-pressed', 'true');
      const take = pick.getByRole('button', { name: 'Take', exact: true });
      await expectTappable(take);
      await take.tap();
      await expect(pick).toHaveCount(0);
      await playOnToRouteMap(page);
      const saved = await savedRun(page);
      expect(saved.currentAct).toBe('act2');
      expect(saved.earnedBlessingPicks.act1).toMatchObject({ status: 'taken', chosen: offered[1] });
      expect(errors).toEqual([]);
    });
  });
}
