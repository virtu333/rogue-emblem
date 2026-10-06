// The Phase 2 Event surfaces on an upright phone (docs/specs/event-nodes-phase2.md §2E;
// docs/portrait-battles.md): a multi-page event with counters, a tell and its trail, the longest
// strings, the contract chip beside the burden chips, the church's Cleanse rows, a Dark Omen's page
// and the colosseum's bouts. Portrait mode is the real default on a phone. Played on the review
// route (`event=dev_*` are review fixtures, src/utils/devEventFixtures.js).
//
// Ways this can fail, a test each:
//   1. the page overflows sideways or cuts text at 375x667 or 390x844 (counters, tells, the trail);
//   2. a choice, the trail toggle, Continue or a Cleanse row is under 44px, covered or off screen;
//   3. the contract chip breaks the route header, wraps mid-word, or its terms run off the screen;
//   4. the sticky action row hides the last line of a long outcome or the trail;
//   5. any of it leaks into landscape (the portrait rules are keyed to html.portrait-ui).
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  NOTCH_PORTRAIT,
  phone,
  expectPortraitUi,
  expectNoSidewaysScroll,
  expectTappable,
  expectSingleLine,
  clippedText,
  emulateSafeArea,
  expectInsideSafeArea,
  pageErrors,
} from './portraitHelpers.js';
import { bootEvent, chooseThrough, enterNode, savedEvent } from './eventHelpers.js';

for (const viewport of PORTRAIT_PHONES.slice(0, 2)) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`upright event pages ${size}`, () => {
    // eslint-disable-next-line no-unused-vars
    const { defaultBrowserType, ...context } = phone(viewport);
    test.use(context);
    test.describe.configure({ timeout: 150_000 });
    const boot = (page, query) => bootEvent(page, query, { tap: true });
    const enter = (page, kind = 'Event', label = 'Travel') =>
      enterNode(page, kind, { label, tap: true });

    test('a three-page event fits: counters, a tell, the step just taken and the trail', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      const insets = await emulateSafeArea(page, NOTCH_PORTRAIT);
      await boot(page, 'seed=42&event=dev_mine');
      await expectPortraitUi(page);
      await enter(page);
      const dialog = page.getByRole('dialog', { name: 'The Deep Mine', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.ev-counter')).toContainText('Torches 3/3');
      await expect(dialog.locator('.ev-tell')).toContainText('Mira: This tunnel breathes.');
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      await expectTappable(dialog.getByRole('button', { name: /^Go deeper/ }));
      await expectTappable(dialog.getByRole('button', { name: /^Climb out/ }));
      if (insets) await expectInsideSafeArea(page, '.ev-menu .re-header', NOTCH_PORTRAIT);
      await page.screenshot({ path: info.outputPath('mine-1.png') });

      await chooseThrough(page, dialog, /^Go deeper/, { tap: true });
      await expect(dialog.locator('.ev-recent')).toContainText('Ore, glinting');
      await expectNoSidewaysScroll(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('mine-2.png') });

      await chooseThrough(page, dialog, /^Deeper still/, { tap: true });
      const toggle = dialog.locator('.ev-trail-toggle');
      await expect(toggle).toContainText('Earlier on this road · 1 step');
      await expectTappable(toggle);
      await toggle.tap();
      await expect(dialog.locator('.ev-step')).toHaveCount(1);
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      await page.screenshot({ path: info.outputPath('mine-3-open.png') });
      await expectTappable(dialog.getByRole('button', { name: /^Take the hoard and run/ }));

      await chooseThrough(page, dialog, /^Take the hoard and run/, { tap: true });
      const primary = dialog.locator('.ev-primary');
      await expectTappable(primary);
      if (insets) await expectInsideSafeArea(page, '.ev-primary', NOTCH_PORTRAIT);
      await expectNoSidewaysScroll(page, '.ev-menu');
      await page.screenshot({ path: info.outputPath('mine-outcome.png') });
      await primary.tap();
      await expect(dialog).toHaveCount(0);
      expect(await savedEvent(page)).toMatchObject({ completed: true, steps: 2 });
      expect(errors).toEqual([]);
    });

    test('the longest strings: two counters, a long tell, a price, a greyed choice', async ({
      page,
    }, info) => {
      await boot(page, 'seed=42&event=dev_stress');
      await expectPortraitUi(page);
      await enter(page);
      const dialog = page.getByRole('dialog', {
        name: 'The Merchant of Unreasonably Long Titles',
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      await expect(dialog.locator('.ev-counter')).toHaveCount(2);
      await expect(dialog.locator('.ev-seal')).toHaveText('150 G');
      await expect(
        dialog.getByRole('button', { name: /^This choice is greyed out/ }),
      ).toBeDisabled();
      await page.screenshot({ path: info.outputPath('stress.png') });
      await chooseThrough(page, dialog, /^Buy the Sealed Reliquary/, { tap: true });
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      await page.screenshot({ path: info.outputPath('stress-2.png') });
    });

    test('a contract chip sits on one line beside the burden chips; its terms fit', async ({
      page,
    }, info) => {
      await boot(
        page,
        'seed=42&event=drill_yard&burdens=ill_omen:2,debt:450,wounded&contract=underPar',
      );
      await expectPortraitUi(page);
      const chips = page.locator('.re-burden');
      await expect(chips).toHaveCount(4);
      const contract = page.locator('.re-contract');
      await expect(contract).toContainText('Under par');
      await expectNoSidewaysScroll(page, '.re-node-map');
      for (const chip of await chips.all()) await expectSingleLine(chip);
      await contract.tap();
      const note = page.locator('.re-burden-note');
      await expect(note).toContainText('Win the next battle by turn par or sooner.');
      await expectNoSidewaysScroll(page, '.re-node-map');
      await expectTappable(page.locator('.re-loom-travel'));
      await page.screenshot({ path: info.outputPath('chips.png') });
    });

    test('the church lists each burden with its words, Debt greyed, every row tappable', async ({
      page,
    }, info) => {
      await boot(page, 'seed=7&as=church&burdens=ill_omen:2,debt:450,hunted');
      await expectPortraitUi(page);
      await enter(page, 'Church');
      const church = page.getByRole('dialog', { name: 'Church', exact: true });
      await expect(church).toBeVisible();
      const hunted = church.getByRole('button', { name: 'Hunted · 2 left' });
      await hunted.scrollIntoViewIfNeeded();
      await expectTappable(hunted);
      await expectTappable(church.getByRole('button', { name: 'Ill Omen · 2 left' }));
      await expect(church.getByRole('button', { name: 'Debt · 450 G' })).toBeDisabled();
      await expectNoSidewaysScroll(page, '.service-menu');
      expect(await clippedText(page, '.service-menu')).toEqual([]);
      await page.screenshot({ path: info.outputPath('cleanse.png') });
      await hunted.tap();
      const confirm = page.getByRole('dialog', { name: 'Lift Hunted?', exact: true });
      await expectNoSidewaysScroll(page);
      await expectTappable(confirm.getByRole('button', { name: 'Lift the burden', exact: true }));
      await page.screenshot({ path: info.outputPath('cleanse-confirm.png') });
    });

    test('a Dark Omen: its page, and the colosseum says the bouts left', async ({ page }, info) => {
      await boot(page, 'seed=42&event=drill_yard&omen=1');
      await expectPortraitUi(page);
      await expectNoSidewaysScroll(page, '.re-node-map');
      await page.screenshot({ path: info.outputPath('omen-route.png') });
      await enter(page, 'Dark Omen');
      const dialog = page.getByRole('dialog', { name: 'The Drill Yard', exact: true });
      await expect(dialog.locator('.ev-kicker')).toHaveText('DARK OMEN');
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      await page.screenshot({ path: info.outputPath('omen-page.png') });
    });

    test('the shipped Plague Village and Cartographer: trail, a join, a greyed choice with its reason', async ({
      page,
    }, info) => {
      await boot(page, 'seed=1&event=plague_village');
      await expectPortraitUi(page);
      await enter(page);
      const dialog = page.getByRole('dialog', { name: 'The Plague Village', exact: true });
      await chooseThrough(page, dialog, /^Give your medicine/, { tap: true });
      await chooseThrough(page, dialog, /^Give a second dose/, { tap: true });
      await chooseThrough(page, dialog, /^Give the last dose/, { tap: true });
      await expect(dialog.locator('.ev-result[data-kind="join"]')).toContainText('joins the army');
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      await expectTappable(dialog.locator('.ev-primary'));
      await page.screenshot({ path: info.outputPath('real-plague.png') });
    });

    test('a greyed Cartographer choice reads whole at this width', async ({ page }, info) => {
      await boot(page, 'seed=1&event=cartographer');
      await expectPortraitUi(page);
      await enter(page);
      const dialog = page.getByRole('dialog', { name: 'The Cartographer', exact: true });
      const guide = dialog.getByRole('button', { name: /^Hire her as a guide/ });
      await expect(guide).toBeDisabled();
      await expect(guide).toContainText('finds no road to add.');
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      await page.screenshot({ path: info.outputPath('real-cartographer.png') });
    });

    test('the arena says the bouts left, on one line, on the menu', async ({ page }, info) => {
      await boot(page, 'seed=7&as=colosseum');
      await expectPortraitUi(page);
      await enter(page, 'Colosseum');
      const menu = page.getByRole('dialog', { name: 'Colosseum', exact: true });
      await expect(menu.locator('.arena-bouts-left')).toHaveText('Bouts left here: 5');
      await expectSingleLine(menu.locator('.arena-bouts-left'));
      await expectNoSidewaysScroll(page, '.service-menu');
      await page.screenshot({ path: info.outputPath('arena.png') });
    });
  });
}
