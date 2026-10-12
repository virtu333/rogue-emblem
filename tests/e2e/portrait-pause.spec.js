// The Pause panel at its fullest on an upright phone (docs/portrait-battles.md): every burden
// the review route can carry (`&burdens=`), an open contract (`&contract=`), and the blessings
// a long run holds (a start gift that gave no blessing, a tier IV pact, church vows, an earned
// card and a twisted one), on the route map and in a battle. The panel is taller than the
// phone, so something has to give.
//
// Ways this can fail, each caught here:
//   1. a list flex-shrinks below its own tallest entry: that entry is clipped by its list and
//      no scroll ever shows it whole;
//   2. the actions squeeze and scroll inside themselves, under a list;
//   3. a row or a button stays cut off, by the panel or by the screen, after it is scrolled to;
//   4. a button drops under 44 px, or the panel crosses the notch or the home bar;
//   5. an upright window with no portrait mode (a fine pointer: no html.portrait-ui and no rotate
//      prompt) keeps the old squeeze, since the fix is keyed to the orientation, not the class.
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  NOTCH_PORTRAIT,
  phone,
  quietSettings,
  expectPortraitUi,
  expectNoSidewaysScroll,
  expectTappable,
  expectWholeInViewport,
  clippedText,
  emulateSafeArea,
  expectInsideSafeArea,
  openDevBattle,
  battleRail,
  pageErrors,
} from './portraitHelpers.js';
import { waitForScene } from './helpers.js';

const sizeOf = (vp) => `${vp.width}x${vp.height}`;

// Every burden the review route knows (utils/devStartup.js addReviewBurdens), and its contract.
const BURDENS = 'ill_omen,debt:450,hunted,sworn_enemy,wounded';
const CONTRACT = 'underPar';
// One burden row each, then the contract's.
const BURDEN_ROWS = BURDENS.split(',').length + 1;

/**
 * The blessings a long run holds, as the run records them: the Fallen Hoard (a gift that gave
 * accessories, so it is its own entry, its catch the Hunted above), Scholar's Vow at its pact, two
 * church vows (free), the Unbroken Banner (earned, free) and Blood Covenant (earned, its twist as
 * the price). Prices come from the catalog through BlessingEngine, never typed here.
 */
async function holdBlessings(page, sceneKey) {
  return page.evaluate(async (key) => {
    const run = window.__emblemRogueGame.scene.getScene(key).runManager;
    const { rollPriceForBlessing } = await import('/src/engine/BlessingEngine.js');
    const catalog = run.gameData.blessings;
    const byId = (id) => catalog.blessings.find((b) => b.id === id);
    const priced = (id) => ({
      id,
      rolledCost: rollPriceForBlessing(catalog, byId(id), () => 0, {
        difficultyId: run.difficultyId,
      }),
    });
    run.startGift = {
      id: 'fallen_hoard',
      granted: [
        { kind: 'accessory', name: 'Power Ring', skill: 'vantage' },
        { kind: 'accessory', name: 'Speed Ring' },
      ],
      catchLabel: catalog.gifts.list.find((g) => g.id === 'fallen_hoard').catch.label,
    };
    const twisted = byId('blood_covenant');
    run.activeBlessings = [
      priced('scholar_vow'),
      { id: 'steady_hands', midRun: true },
      { id: 'field_medic', midRun: true },
      { id: 'unbroken_banner', midRun: true },
      {
        id: 'blood_covenant',
        midRun: true,
        rolledCost: { kind: 'twist', label: twisted.twist.label, effects: [] },
      },
    ];
    return run.activeBlessings.length + 1;
  }, sceneKey);
}

/** The route map's review route with every burden and the contract, then the blessings. */
async function routeMapPause(page) {
  await page.goto(
    `/?devScene=nodemap&preset=event&seed=42&burdens=${BURDENS}&contract=${CONTRACT}`,
  );
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await expect(skip).toBeVisible();
  await skip.tap();
  const map = page.locator('.re-node-map');
  await expect(map).toBeVisible();
  const blessings = await holdBlessings(page, 'NodeMap');
  await map.getByRole('button', { name: 'Menu', exact: true }).tap();
  return blessings;
}

/** A battle with the contract (`&contract=` on the battle route) and the same run state. */
async function battlePause(page) {
  await openDevBattle(page, { slot: null, query: `&contract=${CONTRACT}` });
  await page.evaluate(async (list) => {
    const run = window.__emblemRogueGame.scene.getScene('Battle').runManager;
    const { addBurden } = await import('/src/engine/Burdens.js');
    // The review route's own reading of the list (devStartup addReviewBurdens).
    for (const entry of list.split(',')) {
      const [id, figure] = entry.split(':');
      const params = {};
      if (id === 'debt') params.owed = Number(figure);
      if (id === 'wounded') {
        const unit = run.roster.find((u) => u.isLord) || run.roster[0];
        Object.assign(params, { unitUid: unit.unitUid, unitName: unit.name, stat: 'STR' });
      }
      addBurden(run, id, params);
    }
  }, BURDENS);
  const blessings = await holdBlessings(page, 'Battle');
  await battleRail(page).getByRole('button', { name: 'Menu', exact: true }).tap();
  return blessings;
}

/** Every list at least its tallest entry, the actions unscrolled, every row and button whole. */
async function expectWholePause(page, { blessings, safeArea = true }) {
  const pause = page.getByRole('dialog', { name: 'Paused' });
  await expect(pause).toBeVisible();
  const burdenRows = pause.locator('.mp-burdens li');
  const blessingRows = pause.locator('.mp-blessings li');
  await expect(burdenRows).toHaveCount(BURDEN_ROWS);
  await expect(pause.locator('.mp-burdens li.is-contract')).toHaveCount(1);
  await expect(blessingRows).toHaveCount(blessings);
  await expect(blessingRows.first()).toContainText('Gift');
  await expect(pause.locator('.mp-blessings')).toContainText('Earned');
  await expect(pause.locator('.mp-blessings')).toContainText('Twist:');

  const fit = await pause.evaluate((root) => {
    const panel = root.querySelector('.mp-panel');
    const actions = root.querySelector('.mp-actions');
    return {
      // The case under test: the contents are taller than the room the panel has.
      overflow:
        [...panel.children].reduce((sum, el) => sum + el.scrollHeight, 0) - panel.clientHeight,
      lists: ['.mp-burdens', '.mp-blessings'].map((sel) => {
        const list = root.querySelector(sel);
        return {
          sel,
          height: list.clientHeight,
          tallest: Math.max(...[...list.children].map((li) => li.getBoundingClientRect().height)),
        };
      }),
      actionsScroll: actions.scrollHeight - actions.clientHeight,
    };
  });
  expect(fit.overflow, 'the Pause list at its fullest is taller than the phone').toBeGreaterThan(0);
  for (const list of fit.lists)
    expect(
      list.height,
      `${list.sel} is never shorter than its tallest entry`,
    ).toBeGreaterThanOrEqual(list.tallest - 0.5);
  expect(fit.actionsScroll, 'the actions keep their full height').toBeLessThanOrEqual(1);

  // Centred in its list and the panel, as a player scrolls to read it: flush to an edge, the
  // 30vh cap's fraction of a pixel would read as a cut.
  const showWhole = (locator) =>
    locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  for (const row of [...(await burdenRows.all()), ...(await blessingRows.all())]) {
    await showWhole(row);
    await expectWholeInViewport(row);
  }
  expect(await clippedText(page, '.mp-burdens')).toEqual([]);
  expect(await clippedText(page, '.mp-blessings')).toEqual([]);
  const buttons = await pause.locator('.mp-actions button').all();
  expect(buttons.length).toBeGreaterThan(1);
  for (const button of buttons) {
    await showWhole(button);
    await expectWholeInViewport(button);
    await expectTappable(button);
  }
  if (safeArea) await expectInsideSafeArea(page, '.mp-panel', NOTCH_PORTRAIT);
  await expectNoSidewaysScroll(page);
  return pause;
}

for (const vp of PORTRAIT_PHONES.slice(0, 2)) {
  test.describe(`pause at its fullest upright ${sizeOf(vp)}`, () => {
    test.use(phone(vp));

    test('the route map: every burden, the contract and the blessings, each whole', async ({
      page,
    }, info) => {
      test.setTimeout(90_000);
      const errors = pageErrors(page);
      await quietSettings(page);
      const blessings = await routeMapPause(page);
      await expectPortraitUi(page);
      await emulateSafeArea(page);
      const pause = await expectWholePause(page, { blessings });
      await page.screenshot({ path: info.outputPath(`pause-route-${sizeOf(vp)}.png`) });
      await pause.getByRole('button', { name: 'Resume', exact: true }).tap();
      await expect(pause).toBeHidden();
      expect(errors).toEqual([]);
    });

    test('a battle: the same list over the battle actions, each whole', async ({ page }, info) => {
      // Booting a battle takes most of the default 30 s on a CI runner.
      test.setTimeout(90_000);
      const errors = pageErrors(page);
      await quietSettings(page);
      await emulateSafeArea(page);
      const blessings = await battlePause(page);
      await expectPortraitUi(page);
      const pause = await expectWholePause(page, { blessings });
      await page.screenshot({ path: info.outputPath(`pause-battle-${sizeOf(vp)}.png`) });
      await pause.getByRole('button', { name: 'Resume', exact: true }).tap();
      await expect(pause).toBeHidden();
      expect(errors).toEqual([]);
    });
  });
}

// A desktop browser in a window taller than it is wide: no portrait mode (a fine pointer) and no
// rotate prompt (index.html hides it for a fine pointer), so the Pause panel is upright all the
// same. The fix is keyed to the orientation for this window too.
test.describe('pause at its fullest in an upright desktop window', () => {
  test.use({ viewport: PORTRAIT_PHONES[0], hasTouch: false, isMobile: false });

  test('no portrait mode, the same whole list', async ({ page }) => {
    test.setTimeout(90_000);
    const errors = pageErrors(page);
    await quietSettings(page);
    await page.goto(
      `/?devScene=nodemap&preset=event&seed=42&burdens=${BURDENS}&contract=${CONTRACT}`,
    );
    await waitForScene(page, 'NodeMap');
    await page.getByRole('button', { name: 'Skip conversation', exact: true }).click();
    const map = page.locator('.re-node-map');
    await expect(map).toBeVisible();
    await expectPortraitUi(page, false);
    await expect(page.locator('#rotate-prompt')).toBeHidden();
    const blessings = await holdBlessings(page, 'NodeMap');
    await map.getByRole('button', { name: 'Menu', exact: true }).click();
    await expectWholePause(page, { blessings, safeArea: false });
    expect(errors).toEqual([]);
  });
});
