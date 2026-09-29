// The item trade menu on an upright phone (docs/specs/item-trade.md, "UI"; trade.css,
// "Upright phones"): the two holders stack, one above the other, each full width and
// scrolling on its own; the header is the title and Done, then the bag tabs. Landscape
// phones and desktop keep the two columns.
//
// Ways this can fail, a test (or an assertion group) each:
//   1. the holders stay two ~170px columns upright (every brief cut, names wrapped);
//   2. the dialog keeps its 520px landscape cap instead of the tall screen;
//   3. a header control (Done, a bag tab) is under 44px, covered, off-screen, broken
//      mid-label, or under the notch / home bar;
//   4. the height split starves the acting unit: its five slots do not show whole in
//      their half on a 375×667 phone, or a long convoy pushes it off;
//   5. a row or the page scrolls sideways, or text is clipped;
//   6. tap-to-hold / tap-to-drop stops committing, or commits without saving: every
//      flow reads the save slot back (the roster's loadRun, the battle's checkpoint);
//   7. keyboard / gamepad: Down at the end of the top holder does not reach the lower
//      one (or Left/Right stop switching holders);
//   8. turning the phone with the menu open drops the held item or focus, or leaves
//      the held row outside its resized list;
//   9. a staff in the convoy crashes the menu (it has no wielder for its uses);
//  10. any of it leaks into landscape: columns move at 844x390 or 640x480, or Down
//      starts crossing between side-by-side columns.
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
  expectInsideSafeArea,
  pageErrors,
  safeAreaInsets,
} from './portraitHelpers.js';
import { waitForScene, installSimPad, padTap } from './helpers.js';

const BTN = { A: 0, B: 1, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const [SE, IPHONE_13, PRO_MAX] = PORTRAIT_PHONES;

/** A phone context for test.use in a describe block (the browser stays chromium). */
function phoneContext(viewport) {
  // eslint-disable-next-line no-unused-vars
  const { defaultBrowserType, ...context } = phone(viewport);
  return context;
}

// Edric's five weapons (the longest real names among them), Sera's three: two of her
// weapon slots are free. Each item carries a uid, so a bag reads as "name#uid".
const EDRIC = [
  ['Iron Sword', 'e1'],
  ['Eldritch Grasp', 'e2', 'Armorbane Eldritch Grasp +3'],
  ['Silver Sword', 'e3'],
  ['Keen Sword', 'e4'],
  ['Steel Sword', 'e5'],
];
const SERA = [
  ['Glimmer', 's1'],
  ['Twisting Vortex', 's2'],
  ['Heal', 's3'],
];
const CONVOY_NAMES = ['Iron Axe', 'Steel Lance', 'Iron Bow', 'Conflagration', 'Hush Staff'];
const tag = ([base, uid, name]) => `${name || base}#${uid}`;

/** A real tap on a touch phone, a click on a desktop. */
const press = (locator, touch = true) => (touch ? locator.tap() : locator.click());

async function bootRoute(page, { extra = '', touch = true } = {}) {
  await quietSettings(page);
  await page.goto(`/?devScene=nodemap&preset=battle_smoke&seed=42${extra}`);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await expect(skip).toBeVisible();
  await press(skip, touch);
  await expect(page.locator('.re-node-map')).toBeVisible();
}

/**
 * Hand-built bags saved to slot 1. `convoy`: that many weapons in the convoy (a staff
 * among them); `breath`: Edric's fifth weapon is a Fire Breath (the convoy cannot store
 * it); `accessories`: Edric wears a Sisters' Mantle, Sera a Power Ring, and Edric carries a
 * Poultice (all three bag tabs show).
 */
async function seedBags(
  page,
  { convoy = 0, breath = false, accessories = false, seraFull = false } = {},
) {
  await page.evaluate(
    async ({ EDRIC, SERA, CONVOY_NAMES, convoy, breath, accessories, seraFull }) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const { equipAccessory, unequipAccessory } = await import('/src/engine/UnitManager.js');
      s.registry.set('activeSlot', 1);
      const run = s.runManager;
      const weapon = (base) => {
        const w = s.gameData.weapons.find((x) => x.name === base);
        if (!w) throw new Error(`no weapon ${base}`);
        return structuredClone(w);
      };
      const make = ([base, uid, name]) => ({ ...weapon(base), name: name || base, uid });
      const edric = run.roster.find((u) => u.name === 'Edric');
      const sera = run.roster.find((u) => u.name === 'Sera');
      const edricBag = EDRIC.map(make);
      if (breath) edricBag[4] = { ...weapon('Fire Breath'), uid: 'b1' };
      edric.inventory = edricBag;
      edric.weapon = edric.inventory[0];
      sera.inventory = SERA.map(make);
      if (seraFull) sera.inventory.push(make(['Glimmer', 's4']), make(['Cleanse', 's5']));
      sera.weapon = sera.inventory[0];
      edric.consumables = [];
      sera.consumables = [];
      run.convoy.weapons = Array.from({ length: convoy }, (_, i) => ({
        ...weapon(CONVOY_NAMES[i % CONVOY_NAMES.length]),
        uid: `c${i + 1}`,
      }));
      if (accessories) {
        unequipAccessory(edric);
        unequipAccessory(sera);
        const robe = structuredClone(
          s.gameData.accessories.find((a) => a.name === "Sisters' Mantle"),
        );
        const ring = structuredClone(s.gameData.accessories.find((a) => a.name === 'Power Ring'));
        robe.uid = 'robe';
        ring.uid = 'ring';
        equipAccessory(edric, robe);
        equipAccessory(sera, ring);
        const vulnerary = s.gameData.consumables.find((c) => c.name === 'Poultice');
        edric.consumables = [{ ...structuredClone(vulnerary), uid: 'v1' }];
      }
      const { saveRun } = await import('/src/engine/RunManager.js');
      if (!saveRun(run, null, 1).ok) throw new Error('seed save failed');
    },
    { EDRIC, SERA, CONVOY_NAMES, convoy, breath, accessories, seraFull },
  );
}

/** Live bags and the saved slot's bags ("name#uid"). */
function bags(page) {
  return page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const view = (run) => {
      const unit = (name) => run.roster.find((u) => u.name === name);
      const items = (list) => list.map((i) => `${i.name}#${i.uid}`);
      const who = (u) => ({
        inventory: items(u.inventory),
        weapon: u.weapon ? `${u.weapon.name}#${u.weapon.uid}` : null,
        accessory: u.accessory ? `${u.accessory.name}#${u.accessory.uid}` : null,
        STR: u.stats.STR,
      });
      return {
        edric: who(unit('Edric')),
        sera: who(unit('Sera')),
        convoy: items(run.convoy.weapons),
      };
    };
    const saved = loadRun(s.gameData, 1);
    return { live: view(s.runManager), saved: saved ? view(saved) : null };
  });
}

/** Each key ("edric.inventory", "convoy", …) matches both live and in the save slot. */
async function expectSaved(page, expected) {
  const { live, saved } = await bags(page);
  for (const [key, value] of Object.entries(expected)) {
    const [who, field] = key.split('.');
    const pick = (v) => (field ? v[who][field] : v[who]);
    expect(pick(live), `live ${key}`).toEqual(value);
    expect(pick(saved), `saved ${key}`).toEqual(value);
  }
}

async function openSheet(page, touch = true) {
  await press(
    page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }),
    touch,
  );
  const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Roster → Equipment → Trade with… → partner → Trade: the menu with nothing held. */
async function tradeWith(page, partner, touch = true) {
  const sheet = await openSheet(page, touch);
  await press(sheet.getByRole('button', { name: 'Equipment', exact: true }), touch);
  await press(sheet.getByRole('button', { name: 'Trade with…', exact: true }), touch);
  const picker = page.getByRole('dialog', { name: 'Edric: trade with…', exact: true });
  await press(picker.getByRole('button', { name: new RegExp(`^${partner}`) }), touch);
  await press(picker.getByRole('button', { name: 'Trade', exact: true }), touch);
  const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
  await expect(menu).toBeVisible();
  return { sheet, menu };
}

/** The menu's geometry: the dialog, both holders and their lists. */
function layout(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.tm-trade');
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
      };
    };
    const list = (side) => {
      const el = root.querySelector(`.tm-list-${side}`);
      return {
        ...box(el),
        fits: el.scrollHeight <= el.clientHeight + 1,
        scrolls: el.scrollHeight > el.clientHeight + 1,
        sideways: el.scrollWidth > el.clientWidth + 1,
      };
    };
    return {
      vw: innerWidth,
      vh: innerHeight,
      root: box(root),
      left: box(root.querySelector('.tm-col-left')),
      right: box(root.querySelector('.tm-col-right')),
      listLeft: list('left'),
      listRight: list('right'),
      done: box(root.querySelector('.tm-done')),
      tabs: [...root.querySelectorAll('.tm-tab')].map(box),
    };
  });
}

/** Upright: full-screen, the holders one above the other, each full width. */
async function expectStacked(page) {
  const l = await layout(page);
  expect(l.root.height, 'the dialog takes the tall screen').toBeGreaterThanOrEqual(l.vh - 1);
  expect(l.left.bottom, 'the lower holder starts below the upper one').toBeLessThanOrEqual(
    l.right.top + 0.5,
  );
  for (const side of ['left', 'right'])
    expect(l[side].width, `${side} holder is full width`).toBeGreaterThanOrEqual(l.vw * 0.9);
  // Done shares the title row at its right end (where every upright screen keeps its
  // close control); the tabs take the row below it.
  expect(l.done.right, 'Done at the right end').toBeGreaterThanOrEqual(l.root.right - 60);
  expect(l.done.top).toBeLessThan(l.left.top);
  for (const tab of l.tabs) expect(tab.top).toBeGreaterThanOrEqual(l.done.bottom - 0.5);
  expect(l.listLeft.sideways || l.listRight.sideways).toBe(false);
  return l;
}

/** Landscape: two columns side by side, sharing the dialog's width. */
async function expectColumns(page) {
  const l = await layout(page);
  expect(l.right.left, 'the right column starts right of the left one').toBeGreaterThanOrEqual(
    l.left.right - 0.5,
  );
  expect(Math.abs(l.left.top - l.right.top)).toBeLessThanOrEqual(1);
  expect(l.left.width).toBeGreaterThan(l.root.width * 0.4);
  return l;
}

/**
 * A row fully inside the visible part of its own list, and clear of the fade an upright
 * list with more rows below draws over its last 18px.
 */
function rowInList(row) {
  return row.evaluate((el) => {
    const list = el.closest('.tm-list');
    const r = el.getBoundingClientRect();
    const l = list.getBoundingClientRect();
    const cs = getComputedStyle(list);
    const mask = cs.maskImage || cs.webkitMaskImage || 'none';
    const fade = mask !== 'none' ? 18 : 0;
    return r.top >= l.top - 1 && r.bottom <= l.bottom - fade + 1;
  });
}

const focusedLabel = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute('aria-label') || null);

/** Header controls, lists and status: tappable, one line, inside the safe area. */
async function expectHeaderAndBody(page, menu, insets) {
  await expectTappable(menu.getByRole('button', { name: 'Done', exact: true }));
  const tabs = menu.getByRole('tab');
  for (const tab of await tabs.all()) await expectTappable(tab);
  await expectSingleLine(menu.locator('.tm-tab, .tm-done'));
  await expectNoSidewaysScroll(page, '.tm-trade');
  expect(await clippedText(page, '.tm-trade')).toEqual([]);
  if (insets)
    await expectInsideSafeArea(
      page,
      '.tm-trade .re-header, .tm-trade .tm-tab, .tm-trade .tm-done, .tm-trade .tm-col-head, .tm-trade .tm-list, .tm-trade .tm-status',
      insets,
    );
}

for (const viewport of PORTRAIT_PHONES) {
  const size = `${viewport.width}x${viewport.height}`;
  // iPhone SE has no notch; the taller phones get the notch and home bar.
  const insets = viewport === SE ? null : NOTCH_PORTRAIT;

  test.describe(`upright trade ${size}`, () => {
    test.use(phoneContext(viewport));
    test.describe.configure({ timeout: 90_000 });

    test('unit to unit: the holders stack, both whole; a give and a swap are saved', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      if (insets) await safeAreaInsets(page, insets);
      await bootRoute(page);
      await expectPortraitUi(page);
      await seedBags(page);
      const { sheet, menu } = await tradeWith(page, 'Sera');
      await expectStacked(page);
      const l = await layout(page);
      // Nothing held: Edric's five slots and Sera's five (three items, two free) are
      // each whole in their half; neither list needs to scroll.
      expect(l.listLeft.fits, "Edric's five slots show whole").toBe(true);
      expect(l.listRight.fits, "Sera's five slots show whole").toBe(true);
      await expectHeaderAndBody(page, menu, insets);
      // The longest name keeps to one line at full width.
      await expectSingleLine(
        menu.locator('.tm-row strong').filter({ hasText: 'Armorbane Eldritch Grasp +3' }),
      );
      await page.screenshot({ path: info.outputPath(`trade-${size}.png`) });

      // Give: hold Edric's third weapon, drop it in Sera's free slot 4 (#141's
      // numbered names for empty slots).
      await menu.getByRole('button', { name: 'Silver Sword', exact: true }).tap();
      await expect(menu.getByRole('status')).toContainText('Holding Silver Sword.');
      const give = menu.getByRole('button', {
        name: 'Give Silver Sword to Sera, slot 4',
        exact: true,
      });
      await expect(
        menu.getByRole('button', { name: 'Give Silver Sword to Sera, slot 5', exact: true }),
      ).toHaveCount(1);
      // Every target row now carries its warnings: still no clipping or sideways scroll.
      await expectHeaderAndBody(page, menu, insets);
      await page.screenshot({ path: info.outputPath(`trade-held-${size}.png`) });
      await expectTappable(give);
      await give.tap();
      await expect(menu.getByRole('status')).toContainText('Gave Silver Sword to Sera.');
      await expectSaved(page, {
        'edric.inventory': [tag(EDRIC[0]), tag(EDRIC[1]), tag(EDRIC[3]), tag(EDRIC[4])],
        'sera.inventory': [...SERA.map(tag), tag(EDRIC[2])],
      });

      // Swap: Edric's equipped Iron Sword for Sera's Twisting Vortex (both keep a slot).
      await menu.getByRole('button', { name: 'Iron Sword, equipped', exact: true }).tap();
      const swap = menu.getByRole('button', {
        name: 'Trade Iron Sword for Twisting Vortex',
        exact: true,
      });
      await expectTappable(swap);
      await swap.tap();
      await expect(menu.getByRole('status')).toContainText(
        'Traded Iron Sword for Twisting Vortex.',
      );
      // By hand: the tome takes the Iron Sword's slot 0. Edric can use neither it nor
      // the Grasp (a Legend sword: Mastery rank), so his first usable weapon, the Keen
      // Sword (slot 2), is equipped and moves to slot 0; the others shift down.
      await expectSaved(page, {
        'edric.inventory': [tag(EDRIC[3]), 'Twisting Vortex#s2', tag(EDRIC[1]), tag(EDRIC[4])],
        'edric.weapon': tag(EDRIC[3]),
        'sera.inventory': ['Glimmer#s1', 'Iron Sword#e1', 'Heal#s3', tag(EDRIC[2])],
      });
      await menu.getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(menu).toHaveCount(0);
      await expect(sheet.getByRole('status')).toContainText(
        'Traded Iron Sword for Twisting Vortex.',
      );
      expect(errors).toEqual([]);
    });

    test('two full bags: each holder shows its five slots whole', async ({ page }) => {
      if (insets) await safeAreaInsets(page, insets);
      await bootRoute(page);
      await seedBags(page, { seraFull: true });
      const { menu } = await tradeWith(page, 'Sera');
      await expect(menu.getByRole('tab', { name: 'Weapons 5/5 · 5/5' })).toBeVisible();
      await expectStacked(page);
      const l = await layout(page);
      expect(l.listLeft.fits, "Edric's five slots show whole").toBe(true);
      expect(l.listRight.fits, "Sera's five slots show whole").toBe(true);
      await expectHeaderAndBody(page, menu, insets);
    });

    // The Pro Max checks the layout alone; the flows run on the two smaller phones.
    if (viewport === PRO_MAX) return;

    test('a long convoy scrolls below the unit; a full-bag swap from deep in it is saved', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      if (insets) await safeAreaInsets(page, insets);
      await bootRoute(page);
      // Eighteen convoy weapons, staves among them (a convoy staff has no wielder).
      await seedBags(page, { convoy: 18 });
      const deep = 'Conflagration'; // c4, c9, c14: Trade… on the last card starts at c14
      const sheet = await openSheet(page);
      await sheet.getByRole('button', { name: 'Convoy', exact: true }).tap();
      const cards = sheet
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: deep, exact: true }) });
      await expect(cards).toHaveCount(3);
      const card = cards.nth(2);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toContainText('Equipment full: trade to swap it for a carried item.');
      await card.getByRole('button', { name: 'Trade…', exact: true }).tap();
      const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.locator('.tm-col-right .tm-col-name')).toHaveText('Convoy');
      await expectStacked(page);
      const l = await layout(page);
      // The unit keeps its five slots whole; the convoy scrolls in the rest.
      expect(l.listLeft.fits, "Edric's five slots show whole").toBe(true);
      expect(l.listRight.scrolls, 'the convoy scrolls on its own').toBe(true);
      expect(l.right.height).toBeGreaterThanOrEqual(l.left.height - 1);
      // Nothing is held on open; the card's item, fourteenth in the convoy, is scrolled
      // into view, so the first tap picks it.
      await expect(menu.locator('.tm-row[aria-pressed="true"]')).toHaveCount(0);
      const source = menu.locator('.tm-row[data-side="right"][data-index="13"]');
      await expect(source).toHaveAttribute('aria-label', deep);
      expect(await rowInList(source)).toBe(true);
      await source.tap();
      const held = menu.locator('.tm-row[aria-pressed="true"]');
      await expect(held).toHaveCount(1);
      await expect(held).toHaveAttribute('data-index', '13');
      expect(await rowInList(held)).toBe(true);
      // A tap leaves no row focused (no focus ring), and nothing has moved yet.
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.tm-row')))).toBe(
        false,
      );
      expect((await bags(page)).live.convoy[13]).toBe(`${deep}#c14`);
      await expectHeaderAndBody(page, menu, insets);
      await page.screenshot({ path: info.outputPath(`trade-convoy-${size}.png`) });

      const swap = menu.getByRole('button', { name: `Trade ${deep} for Keen Sword`, exact: true });
      await expectTappable(swap);
      await swap.tap();
      await expect(menu.getByRole('status')).toContainText(`Traded ${deep} for Keen Sword.`);
      const convoy = (await bags(page)).live.convoy;
      expect(convoy[13]).toBe('Keen Sword#e4');
      await expectSaved(page, {
        'edric.inventory': [
          tag(EDRIC[0]),
          tag(EDRIC[1]),
          tag(EDRIC[2]),
          `${deep}#c14`,
          tag(EDRIC[4]),
        ],
        convoy,
      });
      expect(convoy).toHaveLength(18);
      await menu.getByRole('button', { name: 'Done', exact: true }).tap();
      await expect(menu).toHaveCount(0);
      expect(errors).toEqual([]);
    });

    test('keyboard and gamepad follow the stack: Down crosses to the lower holder', async ({
      page,
    }) => {
      await bootRoute(page, { extra: '&gamepadSim=1' });
      await installSimPad(page);
      await seedBags(page);
      const { menu } = await tradeWith(page, 'Sera');
      await expectStacked(page);
      // Nothing is highlighted on open; the first key shows the cursor on the first item.
      await expect.poll(() => focusedLabel(page)).toBe('Trade items');
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => focusedLabel(page)).toBe('Iron Sword, equipped');
      // Keyboard: down through Edric's five, then on into Sera's first row.
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
      await expect.poll(() => focusedLabel(page)).toBe('Steel Sword');
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => focusedLabel(page)).toBe('Glimmer, equipped');
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => focusedLabel(page)).toBe('Steel Sword');
      // Left/Right still switch holders, keeping the row.
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => focusedLabel(page)).toBe('Silver Sword');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => focusedLabel(page)).toBe('Heal');
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => focusedLabel(page)).toBe('Silver Sword');
      // The outer ends still stop.
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => focusedLabel(page)).toBe('Iron Sword, equipped');

      // Gamepad: A holds Edric's last weapon, Down crosses into Sera's list, A gives it
      // to her free slot 4.
      for (let i = 0; i < 4; i++) await padTap(page, BTN.DOWN);
      await expect.poll(() => focusedLabel(page)).toBe('Steel Sword');
      await padTap(page, BTN.A);
      await expect(menu.getByRole('button', { name: 'Steel Sword', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await padTap(page, BTN.DOWN);
      await expect.poll(() => focusedLabel(page)).toBe('Trade Steel Sword for Glimmer');
      for (let i = 0; i < 3; i++) await padTap(page, BTN.DOWN);
      await expect.poll(() => focusedLabel(page)).toBe('Give Steel Sword to Sera, slot 4');
      await padTap(page, BTN.A);
      await expect(menu.getByRole('status')).toContainText('Gave Steel Sword to Sera.');
      await expectSaved(page, {
        'edric.inventory': EDRIC.slice(0, 4).map(tag),
        'sera.inventory': [...SERA.map(tag), tag(EDRIC[4])],
      });
      // Focus returns to the slot the blade left (Edric's last, now empty); Down
      // crosses to Sera's first row and Up climbs back.
      await expect.poll(() => focusedLabel(page)).toBe('Empty slot 5');
      await padTap(page, BTN.DOWN);
      await expect.poll(() => focusedLabel(page)).toBe('Glimmer, equipped');
      await padTap(page, BTN.UP);
      await expect.poll(() => focusedLabel(page)).toBe('Empty slot 5');
      // B closes (nothing held); the sheet takes input again.
      await padTap(page, BTN.B);
      await expect(menu).toHaveCount(0);
    });

    test('accessories: three bag tabs fit the row, and the swap moves the stats', async ({
      page,
    }, info) => {
      if (insets) await safeAreaInsets(page, insets);
      await bootRoute(page);
      await seedBags(page, { accessories: true });
      const before = (await bags(page)).live;
      const { menu } = await tradeWith(page, 'Sera');
      // The widest header: Weapons 5/5 · 3/5, Supplies 1/3 · 0/3 and Accessory.
      await expect(menu.getByRole('tab')).toHaveCount(3);
      await menu.getByRole('tab', { name: 'Accessory', exact: true }).tap();
      await expect(menu.getByRole('tab', { name: 'Accessory', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expectStacked(page);
      await expectHeaderAndBody(page, menu, insets);
      await page.screenshot({ path: info.outputPath(`trade-accessory-${size}.png`) });
      await menu.getByRole('button', { name: /^Sisters' Mantle/ }).tap();
      await menu
        .getByRole('button', { name: "Trade Sisters' Mantle for Power Ring", exact: true })
        .tap();
      await expect(menu.getByRole('status')).toContainText(
        "Traded Sisters' Mantle for Power Ring.",
      );
      // The Power Ring's +2 STR moves from Sera to Edric.
      await expectSaved(page, {
        'edric.accessory': 'Power Ring#ring',
        'sera.accessory': "Sisters' Mantle#robe",
        'edric.STR': before.edric.STR + 2,
        'sera.STR': before.sera.STR - 2,
      });
    });

    test('a blocked target explains itself and nothing moves', async ({ page }) => {
      await bootRoute(page);
      await seedBags(page, { convoy: 3, breath: true });
      const { menu } = await tradeWith(page, 'Convoy');
      await expectStacked(page);
      const before = await bags(page);
      expect(before.saved.edric.inventory).toContain('Fire Breath#b1');
      await menu.getByRole('button', { name: 'Fire Breath', exact: true }).tap();
      // The convoy cannot store a breath: every convoy row says so and stays put.
      const target = menu.getByRole('button', {
        name: 'Trade Fire Breath for Iron Axe',
        exact: true,
      });
      await expect(target).toHaveAttribute('aria-disabled', 'true');
      await expectTappable(target);
      // aria-disabled, not disabled: a player can still tap it (force skips Playwright's
      // "enabled" wait, which reads aria-disabled).
      await target.tap({ force: true });
      await expect(menu.getByRole('status')).toHaveText('The convoy cannot store this item.');
      expect(await bags(page)).toEqual(before);
      await expectNoSidewaysScroll(page, '.tm-trade');
      expect(await clippedText(page, '.tm-trade')).toEqual([]);
    });

    // One rotation round trip is enough.
    if (viewport !== IPHONE_13) return;
    test('turning the phone keeps the held item and focus, and each in view', async ({ page }) => {
      await bootRoute(page);
      await seedBags(page, { convoy: 18 });
      // Trade… on the thirteenth convoy item (c13, an Iron Bow): the menu opens with it
      // scrolled up to the convoy list's lower edge, nothing held yet.
      const { menu } = await tradeFromConvoyCardAt(page, 12);
      await expectStacked(page);
      const source = menu.locator('.tm-row[data-side="right"][data-index="12"]');
      expect(await rowInList(source)).toBe(true);
      await expect(menu.locator('.tm-row[aria-pressed="true"]')).toHaveCount(0);
      // Keys: Enter shows the cursor on it, Enter holds it, Left crosses to Edric's bag.
      await page.keyboard.press('Enter');
      await expect(source).toBeFocused();
      await page.keyboard.press('Enter');
      const held = menu.locator('.tm-row[aria-pressed="true"]');
      await expect(held).toHaveAttribute('data-index', '12');
      expect(await rowInList(held)).toBe(true);
      await page.keyboard.press('ArrowLeft');
      const focus = await focusedLabel(page);
      expect(focus).toMatch(/^Trade /);
      const status = await menu.getByRole('status').textContent();

      for (const [turn, expectLayout] of [
        [{ width: viewport.height, height: viewport.width }, expectColumns],
        [viewport, expectStacked],
      ]) {
        await page.setViewportSize(turn);
        await expectPortraitUi(page, turn.height > turn.width);
        await expectLayout(page);
        await expect(held).toHaveAttribute('aria-pressed', 'true');
        await expect(held).toHaveAttribute('data-index', '12');
        expect(await rowInList(held), 'the held row is whole in its list').toBe(true);
        expect(await focusedLabel(page)).toBe(focus);
        const focused = menu.locator('.tm-row:focus');
        expect(await rowInList(focused), 'the focused row is whole in its list').toBe(true);
        await expect(menu.getByRole('status')).toHaveText(status);
      }
      // Still the same trade: commit it.
      await menu.locator('.tm-row:focus').tap();
      await expect(menu.getByRole('status')).toContainText('Traded Iron Bow for');
      const saved = (await bags(page)).saved;
      expect(saved.edric.inventory).toContain('Iron Bow#c13');
    });
  });
}

/** Trade… on the convoy card at `index` (convoy order). */
async function tradeFromConvoyCardAt(page, index) {
  const sheet = await openSheet(page);
  await sheet.getByRole('button', { name: 'Convoy', exact: true }).tap();
  const card = sheet
    .locator('.mr-item-card')
    .filter({ has: page.getByRole('button', { name: 'Trade…' }) })
    .nth(index);
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'Trade…', exact: true }).tap();
  const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
  await expect(menu).toBeVisible();
  return { sheet, menu };
}

test.describe('upright battle trade', () => {
  test.use(phoneContext(IPHONE_13));
  test.describe.configure({ timeout: 90_000 });

  /** CSS point at a grid tile's centre on the (turned) board. */
  async function tapTile(page, col, row) {
    const p = await page.evaluate(
      ([col, row]) => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const w = s.grid.gridToPixel(col, row);
        const q = s._worldToScreen(w.x, w.y);
        const r = s.game.canvas.getBoundingClientRect();
        return {
          x: r.left + (q.x * r.width) / s.scale.width,
          y: r.top + (q.y * r.height) / s.scale.height,
        };
      },
      [col, row],
    );
    await page.touchscreen.tap(p.x, p.y);
  }

  test('adjacent units trade on the turned board; the swap reaches the checkpoint', async ({
    page,
  }, info) => {
    // Boots a battle: give it the slow-runner budget (CI runners are slower).
    test.slow();
    const errors = pageErrors(page);
    await safeAreaInsets(page, NOTCH_PORTRAIT);
    await quietSettings(page);
    // battleLab=1: the dev fixture map for this preset (Edric at 3,3 beside Sera at 2,3).
    await page.goto('/?devScene=battle&preset=combat_actions&seed=42&battleLab=1');
    await page.waitForFunction(
      () => window.__emblemRogueGame?.scene.getScene('Battle')?.battleState === 'PLAYER_IDLE',
    );
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.classList.contains('portrait-battle')),
      )
      .toBe(true);
    // A run slot, so the battle checkpoint is written to storage.
    const start = await page.evaluate(async () => {
      const game = window.__emblemRogueGame;
      const { setActiveSlot } = await import('/src/engine/SlotManager.js');
      game.registry.set('activeSlot', 1);
      setActiveSlot(1);
      const s = game.scene.getScene('Battle');
      const { ensureItemUid } = await import('/src/utils/itemUid.js');
      const weapon = (name) => structuredClone(s.gameData.weapons.find((w) => w.name === name));
      const edric = s.playerUnits.find((u) => u.name === 'Edric');
      const grasp = weapon('Eldritch Grasp');
      grasp.name = 'Armorbane Eldritch Grasp +3';
      edric.inventory.push(
        grasp,
        weapon('Silver Sword'),
        weapon('Iron Lance'),
        weapon('Steel Sword'),
      );
      for (const u of s.playerUnits) u.inventory.forEach(ensureItemUid);
      s._timelineBoundary = 'turn_start';
      s._captureSuspendCheckpoint();
      const names = (u) => u.inventory.map((w) => w.name);
      return { edric: names(edric), sera: names(s.playerUnits.find((u) => u.name === 'Sera')) };
    });
    // The preset's bags: Edric's Iron Sword (plus the four above), Sera's Glimmer and staves.
    expect(start.edric).toEqual([
      'Iron Sword',
      'Armorbane Eldritch Grasp +3',
      'Silver Sword',
      'Iron Lance',
      'Steel Sword',
    ]);
    expect(start.sera).toEqual(['Glimmer', 'Heal', 'Cleanse', 'Deliverance Staff', 'Fold Staff']);
    // Edric (3,3) stays put beside Sera (2,3): select, same tile, Trade, Sera.
    await tapTile(page, 3, 3);
    await tapTile(page, 3, 3);
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
    );
    await page
      .getByRole('complementary', { name: 'Battle commands' })
      .getByRole('button', { name: 'Trade', exact: true })
      .tap();
    await tapTile(page, 2, 3);
    const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
    await expect(menu).toBeVisible();
    await expect(menu.locator('.tm-notice')).toHaveText("Trading locks in Edric's move.");
    await expectStacked(page);
    await expectHeaderAndBody(page, menu, NOTCH_PORTRAIT);
    await expect(menu.locator('.tm-row[aria-pressed="true"]')).toHaveCount(0);
    await menu.getByRole('button', { name: 'Iron Sword, equipped', exact: true }).tap();
    // The tap holds the sword and leaves no row focused (no focus ring on a touch screen).
    await expect(menu.locator('.tm-row[aria-pressed="true"]')).toHaveCount(1);
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.tm-row')))).toBe(
      false,
    );
    await page.screenshot({ path: info.outputPath('battle-trade-390x844.png') });
    await expectHeaderAndBody(page, menu, NOTCH_PORTRAIT);
    const swap = menu.getByRole('button', { name: 'Trade Iron Sword for Glimmer', exact: true });
    await expectTappable(swap);
    await swap.tap();
    await expect(menu.getByRole('status')).toHaveText('Traded Iron Sword for Glimmer.');
    // The swap is in the live units and in the checkpoint written to the slot.
    const state = await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { getRunKey } = await import('/src/engine/SlotManager.js');
      const saved = JSON.parse(localStorage.getItem(getRunKey(1)) || 'null')?.battleInProgress
        ?.checkpoint;
      const names = (u) => u.inventory.map((w) => w.name);
      const pick = (list) =>
        Object.fromEntries(
          list.filter((u) => ['Edric', 'Sera'].includes(u.name)).map((u) => [u.name, names(u)]),
        );
      return { live: pick(s.playerUnits), saved: saved ? pick(saved.playerUnits) : null };
    });
    // By hand: each item takes the other's slot 0. Edric can use neither Glimmer nor the
    // Grasp (Mastery rank), so the Silver Sword (slot 2) is equipped and moves to slot 0;
    // Sera can't use the Iron Sword and has no other attack, so Heal moves to slot 0.
    expect(state.live).toEqual({
      Edric: [
        'Silver Sword',
        'Glimmer',
        'Armorbane Eldritch Grasp +3',
        'Iron Lance',
        'Steel Sword',
      ],
      Sera: ['Heal', 'Iron Sword', 'Cleanse', 'Deliverance Staff', 'Fold Staff'],
    });
    expect(state.saved).toEqual(state.live);
    await menu.getByRole('button', { name: 'Done', exact: true }).tap();
    await expect(menu).toHaveCount(0);
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle').battleState === 'UNIT_ACTION_MENU',
    );
    expect(errors).toEqual([]);
  });
});

// ── Landscape stays as it was ──
for (const viewport of [
  { width: 844, height: 390, touch: true },
  { width: 640, height: 480, touch: false },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`landscape trade ${size}`, () => {
    test.use(
      viewport.touch
        ? phoneContext({ width: viewport.width, height: viewport.height })
        : { viewport: { width: viewport.width, height: viewport.height } },
    );

    test('two columns, the portrait class inert, Down stops at a column end', async ({
      page,
    }, info) => {
      await bootRoute(page, { touch: viewport.touch });
      await expectPortraitUi(page, false);
      await seedBags(page);
      const { menu } = await tradeWith(page, 'Sera', viewport.touch);
      const before = await expectColumns(page);
      await page.screenshot({ path: info.outputPath(`trade-landscape-${size}.png`) });
      // The class alone (announced as the shell would) moves nothing here.
      await page.evaluate(() => {
        document.documentElement.classList.add('portrait-ui');
        window.dispatchEvent(
          new CustomEvent('emblem-rogue:portrait-ui', { detail: { active: true } }),
        );
      });
      const withClass = await layout(page);
      for (const key of ['root', 'left', 'right', 'listLeft', 'listRight', 'done'])
        for (const edge of ['top', 'left', 'width', 'height'])
          expect(
            Math.abs(withClass[key][edge] - before[key][edge]),
            `${key}.${edge}`,
          ).toBeLessThanOrEqual(1);
      await page.evaluate(() => document.documentElement.classList.remove('portrait-ui'));
      // Side by side, Down at the bottom of the left column stays there (the first
      // Down only shows the cursor on the first item).
      await expect.poll(() => focusedLabel(page)).toBe('Trade items');
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => focusedLabel(page)).toBe('Iron Sword, equipped');
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
      await expect.poll(() => focusedLabel(page)).toBe('Steel Sword');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => focusedLabel(page)).toBe('Empty slot 5');
      await menu.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(menu).toHaveCount(0);
    });
  });
}
