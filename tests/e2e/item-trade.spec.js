// Item trade in the roster (docs/specs/item-trade.md, "Roster" and "Tests"): the
// roster sheet's Trade… flows on two desktop and two landscape-phone viewports.
//
// Each flow drives the real sheet, partner picker and trade menu, then reads the
// save slot back (loadRun) so a commit that never reached storage fails here.
// Fixtures are hand-built so every expected bag is derived by hand from the
// spec's rules: a swap puts each item in the slot the other left; a unit that
// loses its equipped weapon re-equips its first usable combat weapon, which moves
// to slot 0; an accessory swap unequips both, then equips crosswise (unequipping
// keeps missing HP, equipping adds the HP bonus to current HP).
import { test, expect } from '@playwright/test';
import { waitForScene, installSimPad, padTap } from './helpers.js';

const VIEWPORTS = [
  { name: 'desktop-1280x800', width: 1280, height: 800, phone: false },
  { name: 'desktop-640x480', width: 640, height: 480, phone: false },
  { name: 'phone-844x390', width: 844, height: 390, phone: true },
  { name: 'phone-568x320', width: 568, height: 320, phone: true },
];
const SETTINGS = JSON.stringify({ musicVolume: 0, sfxVolume: 0, hints: false });
const BTN = { A: 0, B: 1, L1: 4, R1: 5, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

const EDRIC = ['Edric Blade 1', 'Edric Blade 2', 'Edric Blade 3', 'Edric Blade 4', 'Edric Blade 5'];
const SERA = ['Sera Tome 1', 'Sera Tome 2', 'Sera Tome 3', 'Sera Tome 4', 'Sera Tome 5'];

async function boot(page, vp, route) {
  await page.addInitScript((s) => localStorage.setItem('emblem_rogue_settings', s), SETTINGS);
  const sep = route.includes('?') ? '&' : '?';
  await page.goto(`${route}${vp.phone ? `${sep}mobilePreview=1` : ''}`);
}

async function bootNodeMap(page, vp, extra = '') {
  await boot(page, vp, `/?devScene=nodemap&preset=battle_smoke&seed=42${extra}`);
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await expect(skip).toBeVisible();
  await press(vp, skip);
  await expect(page.locator('.re-node-map')).toBeVisible();
}

function press(vp, locator) {
  return vp.phone ? locator.tap() : locator.click();
}

/**
 * Edric (Sword) carries five blades, Sera (Light, Staff) five tomes, each with a
 * known uid; the run saves to slot 1. `sceneKey` is the scene that owns the run.
 */
async function seedFullBags(page, sceneKey, { convoyFull = false, accessories = false } = {}) {
  await page.evaluate(
    async ({ sceneKey, EDRIC, SERA, convoyFull, accessories }) => {
      const s = window.__emblemRogueGame.scene.getScene(sceneKey);
      const { equipAccessory, unequipAccessory } = await import('/src/engine/UnitManager.js');
      s.registry.set('activeSlot', 1);
      const run = s.runManager;
      const edric = run.roster.find((u) => u.name === 'Edric');
      const sera = run.roster.find((u) => u.name === 'Sera');
      const sword = s.gameData.weapons.find((w) => w.name === 'Iron Sword');
      const tome = s.gameData.weapons.find((w) => w.name === 'Glimmer');
      const make = (base, name, uid) => ({ ...structuredClone(base), name, uid });
      edric.inventory = EDRIC.map((n, i) => make(sword, n, `e${i + 1}`));
      edric.weapon = edric.inventory[0];
      sera.inventory = SERA.map((n, i) => make(tome, n, `s${i + 1}`));
      sera.weapon = sera.inventory[0];
      edric.consumables = [];
      sera.consumables = [];
      if (convoyFull) {
        const cap = run.getConvoyCapacities().weapons;
        run.convoy.weapons = Array.from({ length: cap }, (_, i) =>
          make(sword, `Convoy Blade ${i + 1}`, `c${i + 1}`),
        );
      }
      if (accessories) {
        unequipAccessory(edric);
        unequipAccessory(sera);
        const robe = structuredClone(s.gameData.accessories.find((a) => a.name === 'Seraph Robe'));
        const ring = structuredClone(s.gameData.accessories.find((a) => a.name === 'Power Ring'));
        robe.uid = 'robe';
        ring.uid = 'ring';
        edric.currentHP = edric.stats.HP - 7;
        sera.currentHP = sera.stats.HP;
        window.__before = {
          edric: { HP: edric.stats.HP, cur: edric.currentHP, STR: edric.stats.STR },
          sera: { HP: sera.stats.HP, cur: sera.currentHP, STR: sera.stats.STR },
        };
        equipAccessory(edric, robe);
        equipAccessory(sera, ring);
      }
    },
    { sceneKey, EDRIC, SERA, convoyFull, accessories },
  );
}

/** Live bags and the saved slot's bags, as names and uids. */
async function bags(page, sceneKey) {
  return page.evaluate(async (sceneKey) => {
    const s = window.__emblemRogueGame.scene.getScene(sceneKey);
    const { loadRun } = await import('/src/engine/RunManager.js');
    const view = (run) => {
      const unit = (name) => run.roster.find((u) => u.name === name);
      const items = (list) => list.map((i) => `${i.name}#${i.uid}`);
      const who = (u) => ({
        inventory: items(u.inventory),
        weapon: u.weapon ? `${u.weapon.name}#${u.weapon.uid}` : null,
        accessory: u.accessory ? `${u.accessory.name}#${u.accessory.uid}` : null,
        HP: u.stats.HP,
        cur: u.currentHP,
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
  }, sceneKey);
}

async function expectSaved(page, sceneKey, expected) {
  const { live, saved } = await bags(page, sceneKey);
  for (const [key, value] of Object.entries(expected)) {
    const [who, field] = key.split('.');
    const pick = (v) => (field ? v[who][field] : v[who]);
    expect(pick(live), `live ${key}`).toEqual(value);
    expect(pick(saved), `saved ${key}`).toEqual(value);
  }
}

const withUid = (names, prefix, order) => order.map((i) => `${names[i - 1]}#${prefix}${i}`);

/** Open the roster sheet on Edric's Equipment tab (the sheet opens on the first unit). */
async function equipmentTab(page, vp, sheet) {
  await expect(sheet).toBeVisible();
  await press(vp, sheet.getByRole('button', { name: 'Equipment', exact: true }));
  await expect(sheet.getByRole('heading', { name: /^Equipment · 5\/5/ })).toBeVisible();
}

function itemCard(sheet, name) {
  return sheet.getByRole('article').filter({
    // `has` is matched inside each article, so it starts from the page.
    has: sheet.page().getByRole('heading', { name: new RegExp(`^${name}( Equipped)?$`) }),
  });
}

/** Trade… on an item card, pick the partner, confirm: the trade menu opens. */
async function tradeFromCard(page, vp, sheet, itemName, partner) {
  const card = itemCard(sheet, itemName);
  await card.scrollIntoViewIfNeeded();
  await press(vp, card.getByRole('button', { name: 'Trade…', exact: true }));
  const picker = page.getByRole('dialog', { name: `Trade ${itemName} with…`, exact: true });
  await expect(picker).toBeVisible();
  const row = picker.getByRole('button', { name: new RegExp(`^${partner}`) });
  await press(vp, row);
  await press(vp, picker.getByRole('button', { name: 'Trade', exact: true }));
  await expect(picker).toHaveCount(0);
  const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
  await expect(menu).toBeVisible();
  return { menu };
}

/** No horizontal overflow; both columns, the status and Done on screen; row heights. */
async function checkLayout(page, vp, menu) {
  const size = page.viewportSize();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await menu.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  const inside = async (locator, label) => {
    const box = await locator.boundingBox();
    expect(box, label).toBeTruthy();
    expect(box.x, label).toBeGreaterThanOrEqual(0);
    expect(box.y, label).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, label).toBeLessThanOrEqual(size.width + 0.5);
    expect(box.y + box.height, label).toBeLessThanOrEqual(size.height + 0.5);
  };
  await inside(menu.locator('.tm-col-left .tm-col-head'), 'left column head');
  await inside(menu.locator('.tm-col-right .tm-col-head'), 'right column head');
  await inside(menu.getByRole('button', { name: 'Done', exact: true }), 'Done');
  await inside(menu.getByRole('status'), 'status line');
  for (const side of ['left', 'right']) {
    // Columns never overflow sideways; each scrolls on its own.
    const list = menu.locator(`.tm-list-${side}`);
    expect(await list.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const heights = await menu
      .locator(`.tm-list-${side} .tm-row`)
      .evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
    expect(heights.length).toBe(5);
    for (const h of heights) expect(h).toBeGreaterThanOrEqual(vp.phone ? 44 : 32);
  }
  // The held item's column (no warning lines) shows all five slots without
  // scrolling, above the status line.
  const held = menu.locator('.tm-list-left');
  expect(await held.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  const lastLeft = menu.locator('.tm-list-left .tm-row').nth(4);
  await inside(lastLeft, 'fifth slot of the held column');
  const status = await menu.getByRole('status').boundingBox();
  const fifth = await lastLeft.boundingBox();
  expect(fifth.y + fifth.height).toBeLessThanOrEqual(status.y + 0.5);
  if (vp.phone)
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
}

test.describe.configure({ timeout: 90_000 });

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({
      viewport: { width: vp.width, height: vp.height },
      ...(vp.phone ? { hasTouch: true, isMobile: true } : {}),
    });

    test('full–full unit trade: each swap is saved; layout fits', async ({ page }, info) => {
      await bootNodeMap(page, vp);
      await seedFullBags(page, 'NodeMap');
      await press(
        vp,
        page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }),
      );
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await equipmentTab(page, vp, sheet);
      expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(sheet.getByRole('button', { name: 'Give…' })).toHaveCount(0);
      await expect(sheet.getByRole('button', { name: 'Trade with…', exact: true })).toBeVisible();

      // The partner picker blocks nobody: Sera's full bag reads as a swap prompt.
      const card = itemCard(sheet, 'Edric Blade 3');
      await card.scrollIntoViewIfNeeded();
      await press(vp, card.getByRole('button', { name: 'Trade…', exact: true }));
      const picker = page.getByRole('dialog', { name: 'Trade Edric Blade 3 with…', exact: true });
      await expect(picker.getByRole('button', { name: /^Sera/ })).toContainText(
        'Items 5/5 · full: pick an item to trade',
      );
      await expect(picker.getByRole('button', { name: /^Convoy/ })).toContainText('Weapons 0/');
      await press(vp, picker.getByRole('button', { name: /^Sera/ }));
      await expect(picker.getByRole('button', { name: 'Trade', exact: true })).toBeEnabled();
      await press(vp, picker.getByRole('button', { name: 'Trade', exact: true }));
      const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole('status')).toHaveText(
        'Holding Edric Blade 3. Choose where it goes.',
      );
      await checkLayout(page, vp, menu);
      await page.screenshot({ path: info.outputPath(`${vp.name}-unit-trade.png`) });

      // Swap 1: Blade 3 (slot 2) for Tome 2 (slot 1); both keep their equipped weapon.
      await press(vp, menu.getByRole('button', { name: 'Trade Edric Blade 3 for Sera Tome 2' }));
      await expect(menu.getByRole('status')).toHaveText(
        "Traded Edric Blade 3 for Sera Tome 2. Sera can't equip this; can carry. Edric can't equip this; can carry.",
      );
      await expectSaved(page, 'NodeMap', {
        'edric.inventory': [
          ...withUid(EDRIC, 'e', [1, 2]),
          'Sera Tome 2#s2',
          ...withUid(EDRIC, 'e', [4, 5]),
        ],
        'sera.inventory': ['Sera Tome 1#s1', 'Edric Blade 3#e3', ...withUid(SERA, 's', [3, 4, 5])],
        'edric.weapon': 'Edric Blade 1#e1',
        'sera.weapon': 'Sera Tome 1#s1',
      });

      // Swap 2: both equipped weapons. Neither can use what it receives, so each
      // re-equips its first usable weapon, which moves to slot 0.
      await press(vp, menu.getByRole('button', { name: 'Edric Blade 1, equipped' }));
      await press(vp, menu.getByRole('button', { name: 'Trade Edric Blade 1 for Sera Tome 1' }));
      await expectSaved(page, 'NodeMap', {
        'edric.inventory': [
          'Edric Blade 2#e2',
          'Sera Tome 1#s1',
          'Sera Tome 2#s2',
          'Edric Blade 4#e4',
          'Edric Blade 5#e5',
        ],
        'sera.inventory': [
          'Sera Tome 3#s3',
          'Edric Blade 1#e1',
          'Edric Blade 3#e3',
          'Sera Tome 4#s4',
          'Sera Tome 5#s5',
        ],
        'edric.weapon': 'Edric Blade 2#e2',
        'sera.weapon': 'Sera Tome 3#s3',
      });

      // Done: the menu goes, the sheet re-renders with the trade in its cards.
      await press(vp, menu.getByRole('button', { name: 'Done', exact: true }));
      await expect(menu).toHaveCount(0);
      await expect(sheet.getByRole('status')).toContainText(
        'Traded Edric Blade 1 for Sera Tome 1.',
      );
      await expect(itemCard(sheet, 'Sera Tome 2')).toHaveCount(1);
      await expect(itemCard(sheet, 'Edric Blade 3')).toHaveCount(0);
    });

    test('convoy swap with the bag and the convoy both full', async ({ page }, info) => {
      await bootNodeMap(page, vp);
      await seedFullBags(page, 'NodeMap', { convoyFull: true });
      const cap = await page.evaluate(
        () =>
          window.__emblemRogueGame.scene.getScene('NodeMap').runManager.getConvoyCapacities()
            .weapons,
      );
      await press(
        vp,
        page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }),
      );
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await expect(sheet).toBeVisible();
      await press(vp, sheet.getByRole('button', { name: 'Convoy', exact: true }));
      const card = itemCard(sheet, 'Convoy Blade 2');
      await card.scrollIntoViewIfNeeded();
      // Edric's bag is full: Withdraw has become Trade….
      await expect(card.getByRole('button', { name: 'Withdraw', exact: true })).toHaveCount(0);
      await expect(card).toContainText('Equipment full: trade to swap it for a carried item.');
      await press(vp, card.getByRole('button', { name: 'Trade…', exact: true }));
      const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.locator('.tm-col-right .tm-col-name')).toHaveText('Convoy');
      await expect(menu.getByRole('status')).toHaveText(
        'Holding Convoy Blade 2. Choose where it goes.',
      );
      await checkLayoutColumnsOnly(page, menu);
      await page.screenshot({ path: info.outputPath(`${vp.name}-convoy-trade.png`) });
      await press(vp, menu.getByRole('button', { name: 'Trade Convoy Blade 2 for Edric Blade 4' }));
      await expect(menu.getByRole('status')).toHaveText('Traded Convoy Blade 2 for Edric Blade 4.');
      const convoy = Array.from({ length: cap }, (_, i) => `Convoy Blade ${i + 1}#c${i + 1}`);
      convoy[1] = 'Edric Blade 4#e4';
      await expectSaved(page, 'NodeMap', {
        'edric.inventory': [
          ...withUid(EDRIC, 'e', [1, 2, 3]),
          'Convoy Blade 2#c2',
          'Edric Blade 5#e5',
        ],
        'edric.weapon': 'Edric Blade 1#e1',
        convoy: convoy,
      });
      await press(vp, menu.getByRole('button', { name: 'Done', exact: true }));
      await expect(menu).toHaveCount(0);
      await expect(itemCard(sheet, 'Edric Blade 4')).toHaveCount(1);
    });

    test('accessory swap: stats and HP move with the accessories', async ({ page }, info) => {
      await bootNodeMap(page, vp);
      await seedFullBags(page, 'NodeMap', { accessories: true });
      const before = await page.evaluate(() => window.__before);
      await press(
        vp,
        page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }),
      );
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await equipmentTab(page, vp, sheet);
      const card = itemCard(sheet, 'Seraph Robe');
      await card.scrollIntoViewIfNeeded();
      await press(vp, card.getByRole('button', { name: 'Trade…', exact: true }));
      const picker = page.getByRole('dialog', { name: 'Trade Seraph Robe with…', exact: true });
      // Accessories trade only between units: no Convoy row.
      await expect(picker.getByRole('button', { name: /^Convoy/ })).toHaveCount(0);
      await expect(picker.getByRole('button', { name: /^Sera/ })).toContainText('Wears Power Ring');
      await press(vp, picker.getByRole('button', { name: /^Sera/ }));
      await press(vp, picker.getByRole('button', { name: 'Trade', exact: true }));
      const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
      await expect(menu.getByRole('tab', { name: 'Accessory', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.screenshot({ path: info.outputPath(`${vp.name}-accessory-trade.png`) });
      await press(vp, menu.getByRole('button', { name: 'Trade Seraph Robe for Power Ring' }));
      // By hand: Edric wore the Robe at (HP+5, cur+5) and Sera the Ring (STR+2).
      // Robe off keeps Edric 7 HP down at his base max; the Ring adds 2 STR.
      // Sera: Ring off, Robe on: max +5 and current +5 from full.
      const e = before.edric;
      const s = before.sera;
      await expectSaved(page, 'NodeMap', {
        'edric.accessory': 'Power Ring#ring',
        'sera.accessory': 'Seraph Robe#robe',
        'edric.HP': e.HP,
        'edric.cur': e.HP - 7,
        'edric.STR': e.STR + 2,
        'sera.HP': s.HP + 5,
        'sera.cur': s.HP + 5,
        'sera.STR': s.STR,
      });
      await press(vp, menu.getByRole('button', { name: 'Done', exact: true }));
      await expect(sheet.locator('.mr-summary')).toContainText(`HP ${e.HP - 7}/${e.HP}`);
    });

    test('shop Roster: trade saves at once; the full-bag buy line points here', async ({
      page,
    }, info) => {
      await bootNodeMap(page, vp);
      await seedFullBags(page, 'NodeMap');
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        s.runManager.gold = 10000;
        const n = s.runManager.getAvailableNodes()[0];
        n.type = 'shop';
        const item = structuredClone(s.gameData.weapons.find((w) => w.name === 'Steel Sword'));
        s.showShopOverlay(n, [{ type: 'weapon', item, price: 1000 }]);
      });
      const shop = page.locator('.shop-menu');
      await expect(shop).toBeVisible();
      await press(vp, shop.getByRole('button', { name: 'Buy · 1000 G', exact: true }));
      const buy = page.getByRole('dialog', { name: /Steel Sword/ });
      await expect(buy.getByRole('button').filter({ hasText: 'Edric' })).toContainText(
        'Items 5/5 · Full: sent to convoy · trade it in from Roster',
      );
      await press(vp, buy.getByRole('button', { name: 'Close', exact: true }));
      await expect(buy).toHaveCount(0);
      await press(vp, shop.getByRole('button', { name: 'Roster', exact: true }));
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await equipmentTab(page, vp, sheet);
      const { menu } = await tradeFromCard(page, vp, sheet, 'Edric Blade 5', 'Sera');
      await press(vp, menu.getByRole('button', { name: 'Trade Edric Blade 5 for Sera Tome 5' }));
      await expect(menu.getByRole('status')).toContainText('Traded Edric Blade 5 for Sera Tome 5.');
      // Saved before the sheet or the shop closes.
      await expectSaved(page, 'NodeMap', {
        'edric.inventory': [...withUid(EDRIC, 'e', [1, 2, 3, 4]), 'Sera Tome 5#s5'],
        'sera.inventory': [...withUid(SERA, 's', [1, 2, 3, 4]), 'Edric Blade 5#e5'],
      });
      await page.screenshot({ path: info.outputPath(`${vp.name}-shop-trade.png`) });
      await press(vp, menu.getByRole('button', { name: 'Done', exact: true }));
      await press(vp, sheet.getByRole('button', { name: 'Close', exact: true }));
      await expect(sheet).toHaveCount(0);
      await expect(shop).toBeVisible();
    });

    test('rewards Roster: trade saves through the rewards persist', async ({ page }, info) => {
      await boot(page, vp, '/?devScene=battle&preset=battle_smoke&seed=42&battleLab=1');
      await waitForScene(page, 'Battle');
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        s.registry.set('activeSlot', 1);
        s.onVictory();
      });
      const rewards = page.getByRole('dialog', { name: 'Battle rewards', exact: true });
      await expect(rewards).toBeVisible();
      await seedFullBags(page, 'Battle');
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const r = s._lootController.mobileRewards;
        const controller = r.controller;
        const persist = controller.persist.bind(controller);
        window.__rewardPersists = 0;
        controller.persist = () => {
          window.__rewardPersists++;
          return persist();
        };
        r.choices[0] = {
          type: 'weapon',
          item: structuredClone(s.gameData.weapons.find((w) => w.name === 'Steel Sword')),
        };
        r.selected = 0;
        r.render();
      });
      // The full-bag recipient row names the way out (a UI string).
      await press(vp, rewards.getByRole('button', { name: 'Choose reward', exact: true }));
      await expect(rewards.getByRole('button').filter({ hasText: 'Edric' })).toContainText(
        'Bag full: send to convoy, or trade in Roster',
      );
      await press(vp, rewards.getByRole('button', { name: 'Back', exact: true }));
      await press(vp, rewards.getByRole('button', { name: 'Roster', exact: true }));
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await equipmentTab(page, vp, sheet);
      const persistsBefore = await page.evaluate(() => window.__rewardPersists);
      const { menu } = await tradeFromCard(page, vp, sheet, 'Edric Blade 2', 'Sera');
      await press(vp, menu.getByRole('button', { name: 'Trade Edric Blade 2 for Sera Tome 4' }));
      await expect(menu.getByRole('status')).toHaveText(
        "Traded Edric Blade 2 for Sera Tome 4. Sera can't equip this; can carry. Edric can't equip this; can carry.",
      );
      expect(await page.evaluate(() => window.__rewardPersists)).toBe(persistsBefore + 1);
      await expectSaved(page, 'Battle', {
        'edric.inventory': [
          'Edric Blade 1#e1',
          'Sera Tome 4#s4',
          ...withUid(EDRIC, 'e', [3, 4, 5]),
        ],
        'sera.inventory': [...withUid(SERA, 's', [1, 2, 3]), 'Edric Blade 2#e2', 'Sera Tome 5#s5'],
      });
      await page.screenshot({ path: info.outputPath(`${vp.name}-rewards-trade.png`) });
      await press(vp, menu.getByRole('button', { name: 'Done', exact: true }));
      await press(vp, sheet.getByRole('button', { name: 'Close', exact: true }));
      await expect(rewards).toBeVisible();
    });

    test('gamepad: L1/R1 switch tabs, A holds and commits, B releases then closes', async ({
      page,
    }) => {
      await bootNodeMap(page, vp, '&gamepadSim=1');
      await installSimPad(page);
      await seedFullBags(page, 'NodeMap');
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const run = s.runManager;
        const vulnerary = s.gameData.consumables.find((c) => c.name === 'Vulnerary');
        run.roster.find((u) => u.name === 'Edric').consumables = [
          { ...structuredClone(vulnerary), uid: 'v1' },
        ];
        s._openRoster();
      });
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await expect(sheet).toBeVisible();
      // Stats → Skills → Equipment, then down to Trade with….
      await padTap(page, BTN.RIGHT);
      await padTap(page, BTN.RIGHT);
      await expect(sheet.getByRole('heading', { name: /^Equipment · 5\/5/ })).toBeVisible();
      const tradeWith = sheet.getByRole('button', { name: 'Trade with…', exact: true });
      for (
        let i = 0;
        i < 40 && !(await tradeWith.evaluate((el) => el === document.activeElement));
        i++
      )
        await padTap(page, BTN.DOWN);
      await expect(tradeWith).toBeFocused();
      await padTap(page, BTN.A);
      const picker = page.getByRole('dialog', { name: 'Edric: trade with…', exact: true });
      await expect(picker).toBeVisible();
      const confirm = picker.getByRole('button', { name: 'Trade', exact: true });
      for (
        let i = 0;
        i < 10 && !(await confirm.evaluate((el) => el === document.activeElement));
        i++
      )
        await padTap(page, BTN.DOWN);
      await expect(confirm).toBeFocused();
      await padTap(page, BTN.A);
      const menu = page.getByRole('dialog', { name: 'Trade items', exact: true });
      await expect(menu).toBeVisible();
      const weapons = menu.getByRole('tab', { name: /^Weapons/ });
      const supplies = menu.getByRole('tab', { name: /^Supplies/ });
      await expect(weapons).toHaveAttribute('aria-selected', 'true');
      await padTap(page, BTN.R1);
      await expect(supplies).toHaveAttribute('aria-selected', 'true');
      await padTap(page, BTN.L1);
      await expect(weapons).toHaveAttribute('aria-selected', 'true');
      // Focus starts on Edric's first item; A holds it, right crosses to Sera's
      // same slot, A swaps (both bags are full).
      const first = menu.getByRole('button', { name: 'Edric Blade 1, equipped' });
      await expect(first).toBeFocused();
      await padTap(page, BTN.A);
      await expect(menu.getByRole('button', { name: 'Edric Blade 1, equipped' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await padTap(page, BTN.RIGHT);
      await expect(
        menu.getByRole('button', { name: 'Trade Edric Blade 1 for Sera Tome 1' }),
      ).toBeFocused();
      await padTap(page, BTN.A);
      await expect(menu.getByRole('status')).toContainText('Traded Edric Blade 1 for Sera Tome 1.');
      await expectSaved(page, 'NodeMap', {
        'edric.weapon': 'Edric Blade 2#e2',
        'sera.weapon': 'Sera Tome 2#s2',
      });
      // B releases a held item first, then closes the menu.
      await padTap(page, BTN.LEFT);
      await padTap(page, BTN.A);
      await expect(menu.locator('.tm-row[aria-pressed="true"]')).toHaveCount(1);
      await padTap(page, BTN.B);
      await expect(menu).toBeVisible();
      await expect(menu.locator('.tm-row[aria-pressed="true"]')).toHaveCount(0);
      await padTap(page, BTN.B);
      await expect(menu).toHaveCount(0);
      await expect(sheet).toBeVisible();
      // The sheet has input again: B now closes it.
      await padTap(page, BTN.B);
      await expect(sheet).toHaveCount(0);
    });
  });
}

/** Columns, Done and status on screen with no sideways overflow (convoy lists scroll). */
async function checkLayoutColumnsOnly(page, menu) {
  const size = page.viewportSize();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await menu.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  for (const locator of [
    menu.locator('.tm-col-left .tm-col-head'),
    menu.locator('.tm-col-right .tm-col-head'),
    menu.getByRole('button', { name: 'Done', exact: true }),
    menu.getByRole('status'),
  ]) {
    const box = await locator.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
    expect(box.y + box.height).toBeLessThanOrEqual(size.height + 0.5);
  }
}
