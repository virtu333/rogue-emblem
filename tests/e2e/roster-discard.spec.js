// Discard in the roster (CLAUDE.md "Roster Discard"): the roster sheet's Discard on a carried item
// and on a convoy item, on a desktop and a landscape phone. Each flow drives the real sheet and its
// confirmation, then reads the save slot back (loadRun) so a discard that never reached storage, or a
// Cancel that quietly removed the item, fails here.
//
// Ways this can fail, a test each:
//   1. Discard acts on the first tap, or Cancel / Escape still removes the item or writes a save;
//   2. Confirm removes the wrong one of two items (Edric carries five blades, each with its own uid), moves
//      the item into the convoy, or the save still holds it (live and as saved in slot 1);
//   3. the confirmation hides that the unit is left unarmed;
//   4. a convoy item is thrown away from the wrong place, or comes back from the save;
//   5. a lord's personal weapon can be discarded;
//   6. the confirmation overflows the screen with a very long item name.
import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';

const VIEWPORTS = [
  { name: 'desktop-640x480', width: 640, height: 480, phone: false },
  { name: 'phone-844x390', width: 844, height: 390, phone: true },
];
const SETTINGS = JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false });
const BLADES = [
  'Edric Blade 1',
  'Edric Blade 2',
  'Edric Blade 3',
  'Edric Blade 4',
  'Edric Blade 5',
];
const LONG_NAME = 'Legendary Silver Greatsword of the Hollow Sun Ascendant';

const press = (vp, locator) => (vp.phone ? locator.tap() : locator.click());

async function bootNodeMap(page, vp) {
  await page.addInitScript((s) => localStorage.setItem('emblem_rogue_settings', s), SETTINGS);
  await page.goto(
    `/?devScene=nodemap&preset=battle_smoke&seed=42${vp.phone ? '&mobilePreview=1' : ''}`,
  );
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await expect(skip).toBeVisible();
  await press(vp, skip);
  await expect(page.locator('.re-node-map')).toBeVisible();
}

/**
 * Edric carries five Iron Sword blades with known uids (the third is `thirdName`), the convoy three
 * stored blades; the run saves to slot 1 so a read-back sees what a refresh would.
 */
async function seed(page, { blades = BLADES, thirdName = null, personal = false } = {}) {
  await page.evaluate(
    async ({ blades, thirdName, personal }) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      s.registry.set('activeSlot', 1);
      const run = s.runManager;
      const edric = run.roster.find((u) => u.name === 'Edric');
      const sword = s.gameData.weapons.find((w) => w.name === 'Iron Sword');
      const make = (name, uid) => ({ ...structuredClone(sword), name, uid });
      edric.inventory = blades.map((n, i) =>
        make(i === 2 && thirdName ? thirdName : n, `e${i + 1}`),
      );
      if (personal) {
        const sig = s.gameData.weapons.find((w) => w.signatureOf === 'Edric');
        edric.inventory[4] = { ...structuredClone(sig), uid: 'sig' };
      }
      edric.weapon = edric.inventory[0];
      edric.consumables = [];
      run.convoy.weapons = [1, 2, 3].map((i) => make(`Convoy Blade ${i}`, `c${i}`));
      run.convoy.consumables = [];
      s.persistRunSave();
    },
    { blades, thirdName, personal },
  );
}

/** Edric's bag, the convoy's weapons and the gold, live and as saved in slot 1 (names with uids). */
async function bags(page) {
  return page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const view = (run) => {
      const edric = run.roster.find((u) => u.name === 'Edric');
      const items = (list) => list.map((i) => `${i.name}#${i.uid}`);
      return {
        bag: items(edric.inventory),
        weapon: edric.weapon ? `${edric.weapon.name}#${edric.weapon.uid}` : null,
        convoy: items(run.convoy.weapons),
        gold: run.gold,
      };
    };
    return { live: view(s.runManager), saved: view(loadRun(s.gameData, 1)) };
  });
}

async function expectBoth(page, expected) {
  const { live, saved } = await bags(page);
  for (const [field, value] of Object.entries(expected)) {
    expect(live[field], `live ${field}`).toEqual(value);
    expect(saved[field], `saved ${field}`).toEqual(value);
  }
}

const withUid = (names, prefix, order) => order.map((i) => `${names[i - 1]}#${prefix}${i}`);
const ALL = withUid(BLADES, 'e', [1, 2, 3, 4, 5]);
const CONVOY = ['Convoy Blade 1#c1', 'Convoy Blade 2#c2', 'Convoy Blade 3#c3'];

async function openRoster(page, vp) {
  await press(
    vp,
    page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }),
  );
  const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function equipmentTab(page, vp, sheet) {
  await press(vp, sheet.getByRole('button', { name: 'Equipment', exact: true }));
  await expect(sheet.getByRole('heading', { name: /^Equipment · 5\/5/ })).toBeVisible();
}

function itemCard(sheet, name) {
  return sheet.getByRole('article').filter({
    has: sheet.page().getByRole('heading', { name: new RegExp(`^${name}( Equipped)?$`) }),
  });
}

/** Discard on a card: the confirmation opens and nothing has changed yet. */
async function askToDiscard(page, vp, sheet, name, title = `Discard ${name}?`) {
  const card = itemCard(sheet, name);
  await card.scrollIntoViewIfNeeded();
  await press(vp, card.getByRole('button', { name: 'Discard', exact: true }));
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('It is gone for good');
  return dialog;
}

/** The dialog and its two buttons are wholly on screen, with no sideways overflow. */
async function expectOnScreen(page, dialog) {
  const size = page.viewportSize();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const name of ['Discard', 'Cancel']) {
    const box = await dialog.getByRole('button', { name, exact: true }).boundingBox();
    expect(box, name).toBeTruthy();
    expect(box.x, name).toBeGreaterThanOrEqual(0);
    expect(box.y, name).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, name).toBeLessThanOrEqual(size.width + 0.5);
    expect(box.y + box.height, name).toBeLessThanOrEqual(size.height + 0.5);
  }
}

test.describe.configure({ timeout: 90_000 });

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      ...(vp.phone ? { hasTouch: true, isMobile: true } : {}),
    });

    test('Cancel and Escape keep the item; Confirm throws that one blade away and saves', async ({
      page,
    }) => {
      await bootNodeMap(page, vp);
      await seed(page);
      await expectBoth(page, { bag: ALL, convoy: CONVOY });
      const gold = (await bags(page)).live.gold;
      const sheet = await openRoster(page, vp);
      await equipmentTab(page, vp, sheet);

      // The first tap asks; nothing has moved. Cancel keeps the blade.
      let dialog = await askToDiscard(page, vp, sheet, 'Edric Blade 3');
      await expectOnScreen(page, dialog);
      await expectBoth(page, { bag: ALL, convoy: CONVOY });
      await press(vp, dialog.getByRole('button', { name: 'Cancel', exact: true }));
      await expect(dialog).toHaveCount(0);
      await expect(itemCard(sheet, 'Edric Blade 3')).toHaveCount(1);
      await expectBoth(page, { bag: ALL, convoy: CONVOY });

      // Escape closes the confirmation, not the roster, and changes nothing.
      dialog = await askToDiscard(page, vp, sheet, 'Edric Blade 3');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(sheet).toBeVisible();
      await expectBoth(page, { bag: ALL, convoy: CONVOY });

      // Confirm: that blade is gone from the bag, the convoy and the save; no gold is paid.
      dialog = await askToDiscard(page, vp, sheet, 'Edric Blade 3');
      await press(vp, dialog.getByRole('button', { name: 'Discard', exact: true }));
      await expect(dialog).toHaveCount(0);
      await expect(itemCard(sheet, 'Edric Blade 3')).toHaveCount(0);
      await expect(sheet.getByRole('heading', { name: /^Equipment · 4\/5/ })).toBeVisible();
      await expect(sheet.getByRole('status')).toHaveText('Discarded Edric Blade 3.');
      await expectBoth(page, {
        bag: withUid(BLADES, 'e', [1, 2, 4, 5]),
        weapon: 'Edric Blade 1#e1',
        convoy: CONVOY,
        gold,
      });
    });

    test('the equipped blade can go: the next one is equipped, in the save too', async ({
      page,
    }) => {
      await bootNodeMap(page, vp);
      await seed(page);
      const sheet = await openRoster(page, vp);
      await equipmentTab(page, vp, sheet);
      const dialog = await askToDiscard(page, vp, sheet, 'Edric Blade 1');
      await press(vp, dialog.getByRole('button', { name: 'Discard', exact: true }));
      await expect(dialog).toHaveCount(0);
      await expectBoth(page, {
        bag: withUid(BLADES, 'e', [2, 3, 4, 5]),
        weapon: 'Edric Blade 2#e2',
        convoy: CONVOY,
      });
    });

    test('the last weapon: the confirmation says Edric is left unarmed', async ({ page }) => {
      await bootNodeMap(page, vp);
      await seed(page);
      await page.evaluate(() => {
        const run = window.__emblemRogueGame.scene.getScene('NodeMap').runManager;
        const edric = run.roster.find((u) => u.name === 'Edric');
        edric.inventory = [edric.inventory[0]];
        edric.weapon = edric.inventory[0];
      });
      const sheet = await openRoster(page, vp);
      await press(vp, sheet.getByRole('button', { name: 'Equipment', exact: true }));
      const dialog = await askToDiscard(page, vp, sheet, 'Edric Blade 1');
      await expect(dialog).toContainText('Leaves Edric unarmed.');
      await press(vp, dialog.getByRole('button', { name: 'Discard', exact: true }));
      await expect(dialog).toHaveCount(0);
      await expect(sheet.getByRole('status')).toHaveText(
        'Discarded Edric Blade 1. Leaves Edric unarmed.',
      );
      await expectBoth(page, { bag: [], weapon: null, convoy: CONVOY });
    });

    test('a convoy item is thrown away from the convoy, and stays gone in the save', async ({
      page,
    }) => {
      await bootNodeMap(page, vp);
      await seed(page);
      const sheet = await openRoster(page, vp);
      await press(vp, sheet.getByRole('button', { name: 'Convoy', exact: true }));
      const dialog = await askToDiscard(page, vp, sheet, 'Convoy Blade 2');
      await press(vp, dialog.getByRole('button', { name: 'Cancel', exact: true }));
      await expectBoth(page, { bag: ALL, convoy: CONVOY });
      const again = await askToDiscard(page, vp, sheet, 'Convoy Blade 2');
      await press(vp, again.getByRole('button', { name: 'Discard', exact: true }));
      await expect(again).toHaveCount(0);
      await expect(itemCard(sheet, 'Convoy Blade 2')).toHaveCount(0);
      await expectBoth(page, {
        bag: ALL,
        convoy: ['Convoy Blade 1#c1', 'Convoy Blade 3#c3'],
      });
    });

    test("a lord's personal weapon cannot be discarded", async ({ page }) => {
      await bootNodeMap(page, vp);
      await seed(page, { personal: true });
      const sheet = await openRoster(page, vp);
      await press(vp, sheet.getByRole('button', { name: 'Equipment', exact: true }));
      const name = await page.evaluate(
        () =>
          window.__emblemRogueGame.scene
            .getScene('NodeMap')
            .gameData.weapons.find((w) => w.signatureOf === 'Edric').name,
      );
      const card = itemCard(sheet, name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      await card.scrollIntoViewIfNeeded();
      await expect(card.getByRole('button', { name: 'Discard', exact: true })).toBeDisabled();
      await expect(card).toContainText("A lord's personal weapon cannot be discarded.");
    });

    test('a very long item name still fits the confirmation', async ({ page }) => {
      await bootNodeMap(page, vp);
      await seed(page, { thirdName: LONG_NAME });
      const sheet = await openRoster(page, vp);
      await equipmentTab(page, vp, sheet);
      const dialog = await askToDiscard(page, vp, sheet, LONG_NAME, `Discard ${LONG_NAME}?`);
      await expectOnScreen(page, dialog);
      await press(vp, dialog.getByRole('button', { name: 'Cancel', exact: true }));
      await expect(dialog).toHaveCount(0);
    });
  });
}
