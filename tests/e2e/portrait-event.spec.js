// A story Event on an upright phone (docs/specs/event-nodes.md §10; docs/portrait-battles.md):
// the route's Event node, its page (the longest copy the shipped events have, and a stress
// event with a 32-character label, a long hint, a price and a greyed choice), the unit picker,
// the outcome with many result lines, and the burden chips. Portrait mode is the real default
// on a phone. Every flow reads the save slot back.
//
// Ways this can fail, a test each:
//   1. the page overflows sideways, or text is cut off, at 375x667 or 390x844;
//   2. a choice, the confirm, Continue or Fight is under 44px, covered or off screen;
//   3. the choice list hides a price or the reason a choice is greyed;
//   4. the sticky action row hides a result line or leaves it under the home bar;
//   5. the burden chips break the route's header or its Travel label wraps mid-word;
//   6. any of it leaks into landscape (the portrait rules are keyed to html.portrait-ui).
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  NOTCH_PORTRAIT,
  phone,
  quietSettings,
  expectPortraitUi,
  expectNoSidewaysScroll,
  expectTappable,
  expectSingleLine,
  clippedText,
  emulateSafeArea,
  expectInsideSafeArea,
  pageErrors,
} from './portraitHelpers.js';
import { waitForScene } from './helpers.js';

const STRESS = {
  id: 'stress',
  title: 'The Abandoned Armory of Saint Varen',
  weight: 1,
  intro:
    'The garrison left in a hurry: boots by the door, a cold pot, racks of weapons nobody came back for. Somewhere inside, a door is barred from the wrong side, and something behind it is knocking in a slow, patient rhythm like a ledger.',
  choices: [
    {
      id: 'a',
      label: "Search the quartermaster's desk",
      hint: "Offices keep their best things where the wrong people won't look. Or where they will, ask anyone.",
      cost: { gold: { base: 150, perAct: 100 } },
      outcomes: [{ id: 'x', weight: 100, text: 'Nothing.', effects: [] }],
    },
    {
      id: 'b',
      label: 'Take everything that is not nailed down',
      hint: 'A very long hint line that keeps going to test wrapping at the narrowest widths we ship to.',
      target: { prompt: 'Who carries the load?', filter: { weaponTypes: ['Sword'] } },
      outcomes: [
        {
          id: 'all',
          weight: 100,
          text: 'The cellar gives up more than anyone could carry, and takes a little in return.',
          effects: [
            { type: 'gold', value: 200 },
            { type: 'item', name: 'Steel Sword', to: 'target', wear: 2 },
            { type: 'learnSkill', skillId: 'vantage', to: 'target' },
            { type: 'hp', mode: 'damage', percent: 10, scope: 'target' },
            { type: 'shadow', value: 3 },
            { type: 'vision', value: 1 },
            { type: 'blessing', tier: 1 },
            { type: 'burden', id: 'debt', params: { owed: 450 } },
            { type: 'burden', id: 'ill_omen' },
          ],
        },
      ],
    },
    {
      id: 'c',
      label: 'Bring in the unit that cannot',
      requires: { goldAtLeast: 99999, reason: 'No one here can read the old script on the door.' },
      outcomes: [{ id: 'x', weight: 100, text: 'Never.', effects: [] }],
    },
    {
      id: 'd',
      label: 'Leave it be',
      outcomes: [{ id: 'x', weight: 100, text: 'You go.', effects: [] }],
    },
  ],
};

async function boot(page, eventId) {
  await quietSettings(page);
  await page.goto(`/?devScene=nodemap&preset=event&seed=42&event=${eventId}`);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await expect(skip).toBeVisible();
  await skip.tap();
  await expect(page.locator('.re-node-map')).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.persistRunSave();
  });
}

const enter = async (page, label = 'Travel') => {
  await page
    .getByRole('button', { name: /^Event · (Available|You are here)/ })
    .first()
    .tap();
  await page.getByRole('button', { name: label, exact: true }).tap();
};

const saved = (page) =>
  page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const run = loadRun(s.gameData, 1);
    const node = run.nodeMap.nodes.find((n) => n.type === 'event' && run.eventStateByNodeId[n.id]);
    const state = run.eventStateByNodeId[node.id];
    return { choiceId: state.choiceId ?? null, completed: node.completed, gold: run.gold };
  });

for (const viewport of PORTRAIT_PHONES.slice(0, 2)) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`upright event ${size}`, () => {
    // eslint-disable-next-line no-unused-vars
    const { defaultBrowserType, ...context } = phone(viewport);
    test.use(context);
    test.describe.configure({ timeout: 120_000 });

    test('the stress event fits, every control is tappable, the outcome scrolls above its footer', async ({
      page,
    }) => {
      const errors = pageErrors(page);
      const insets = await emulateSafeArea(page, NOTCH_PORTRAIT);
      await boot(page, 'abandoned_armory');
      await expectPortraitUi(page);
      await page.evaluate((stress) => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const r = s.runManager;
        r.gameData = { ...r.gameData, events: { ...r.gameData.events, events: [stress] } };
        r.difficultyId = 'hard';
      }, STRESS);
      await enter(page);
      const dialog = page.getByRole('dialog', { name: STRESS.title, exact: true });
      await expect(dialog).toBeVisible();
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      // The price and the reason are on the choices, never hidden.
      await expect(dialog.locator('.ev-seal')).toHaveText('310 G'); // (150 + 100) x 1.25 = 312.5, rounded to 10
      const greyed = dialog.getByRole('button', { name: /^Bring in the unit that cannot/ });
      await expect(greyed).toBeDisabled();
      await expect(greyed).toContainText('No one here can read the old script on the door.');
      for (const name of [/^Search the quartermaster/, /^Take everything/, /^Leave it be/])
        await expectTappable(dialog.getByRole('button', { name }));
      await expectTappable(dialog.locator('.ev-roster'));
      if (insets) await expectInsideSafeArea(page, '.ev-menu .re-header', NOTCH_PORTRAIT);

      // The unit picker, then the outcome with its many lines.
      await dialog.getByRole('button', { name: /^Take everything/ }).tap();
      const picker = page.getByRole('dialog', { name: 'Who carries the load?', exact: true });
      await expect(picker).toBeVisible();
      await expectNoSidewaysScroll(page);
      await picker.getByRole('button', { name: 'Choose', exact: true }).tap();
      await expect(dialog.locator('.ev-result')).toHaveCount(9);
      const primary = dialog.locator('.ev-primary');
      await expectTappable(primary);
      await expectNoSidewaysScroll(page, '.ev-menu');
      expect(await clippedText(page, '.ev-menu')).toEqual([]);
      if (insets) await expectInsideSafeArea(page, '.ev-primary', NOTCH_PORTRAIT);
      // The last line can be scrolled clear of the footer.
      const lastClear = await page.evaluate(() => {
        const body = document.querySelector('.ev-menu .re-menu-body');
        body.scrollTop = body.scrollHeight;
        const last = [...document.querySelectorAll('.ev-result')].at(-1).getBoundingClientRect();
        const footer = document.querySelector('.ev-actions').getBoundingClientRect();
        return footer.top - last.bottom;
      });
      expect(lastClear).toBeGreaterThanOrEqual(-0.5);
      expect(await saved(page)).toMatchObject({ choiceId: 'b', completed: false });
      await primary.tap();
      await expect(dialog).toHaveCount(0);
      expect(await saved(page)).toMatchObject({ completed: true });

      // The route now carries two burdens: chips under the header, Travel on one line.
      const chips = page.locator('.re-burden');
      await expect(chips).toHaveCount(2);
      await expectNoSidewaysScroll(page, '.re-node-map');
      for (const chip of await chips.all()) await expectSingleLine(chip);
      await chips.first().tap();
      await expect(page.locator('.re-burden-note')).toBeVisible();
      await expectNoSidewaysScroll(page, '.re-node-map');
      expect(errors).toEqual([]);
    });

    test('the route names the way back, on one line, and the fight page offers only Fight', async ({
      page,
    }) => {
      await boot(page, 'abandoned_armory');
      await enter(page);
      const dialog = page.getByRole('dialog', { name: 'The Abandoned Armory', exact: true });
      await dialog.getByRole('button', { name: /^Force the barred door/ }).tap();
      await page
        .getByRole('dialog', { name: 'Force the barred door', exact: true })
        .getByRole('button', { name: 'Choose', exact: true })
        .tap();
      await expect(dialog.getByRole('button', { name: 'Fight', exact: true })).toBeVisible();
      await expectTappable(dialog.getByRole('button', { name: 'Fight', exact: true }));
      await expect(dialog.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await page
        .getByRole('button', { name: /^Event · (Available|You are here)/ })
        .first()
        .tap();
      const travel = page.locator('.re-loom-travel');
      await expect(travel).toHaveText('Return to the event');
      await expectSingleLine(travel.locator('span'));
      await expectTappable(travel);
    });
  });
}

test.describe('landscape keeps its layout', () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
  test('the upright rules never move the landscape event page', async ({ page }) => {
    await boot(page, 'old_swordmaster');
    await enter(page);
    const dialog = page.getByRole('dialog', { name: 'The Old Swordmaster', exact: true });
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('portrait-ui')),
    ).toBe(false);
    // The landscape hero keeps its kicker on the title's line.
    const flow = await page.evaluate(
      () => getComputedStyle(document.querySelector('.ev-hero')).flexDirection,
    );
    expect(flow).toBe('row');
  });
});
