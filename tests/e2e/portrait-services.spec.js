// Node services and the roster sheet on an upright phone: shop and caravan, church,
// the Ruins' rest-or-scavenge choice, the arena, and the roster sheet's equipment,
// convoy and art binding. Portrait mode is the real default on a phone (no opt-in, no
// forced class). Every flow completes and reads the save slot back.
//
// Ways this can fail, a test (or an assertion group) each:
//   1. a two-column split stays upright and squeezes the list or the detail;
//   2. a footer tool breaks mid-label ("Restock · 150 / G") or a primary action (Buy,
//      Sell, Choose forge, Rest, Fight, Replace) is under 44px, covered or off-screen;
//   3. comparison rows, forge previews, keyword chips, warnings or the full-bag copy
//      are clipped or scroll the page sideways;
//   4. the Ruins choice hides what each path gives and costs, or the "only one" rule;
//   5. an unarmed fighter can enter the arena, or its reason is not shown;
//   6. the art binding picker cuts its choices down to fit an empty preview;
//   7. a flow looks right but does not save (buy, sell, forge, heal, revive, rest,
//      scavenge, fight, store, bind);
//   8. any of it leaks into landscape: boxes move at 844x390 or 640x480, or the Ruins
//      effect lines appear there.
import { test, expect } from '@playwright/test';
import {
  PORTRAIT_PHONES,
  NOTCH_PORTRAIT,
  phone,
  quietSettings,
  emulateSafeArea,
  expectPortraitUi,
  expectNoSidewaysScroll,
  expectTappable,
  expectSingleLine,
  clippedText,
  expectInsideSafeArea,
  pageErrors,
} from './portraitHelpers.js';
import { waitForScene } from './helpers.js';

const [SE, IPHONE_13] = PORTRAIT_PHONES;

/** A phone context for test.use in a describe block (the browser stays chromium). */
function phoneContext(viewport) {
  // eslint-disable-next-line no-unused-vars
  const { defaultBrowserType, ...context } = phone(viewport);
  return context;
}

const press = (locator, touch = true) => (touch ? locator.tap() : locator.click());

async function bootRoute(page, { touch = true } = {}) {
  await quietSettings(page);
  await page.goto('/?devScene=nodemap&preset=battle_smoke&seed=42');
  await waitForScene(page, 'NodeMap');
  const skip = page.getByRole('button', { name: 'Skip conversation', exact: true });
  await expect(skip).toBeVisible();
  await press(skip, touch);
  await expect(page.locator('.re-node-map')).toBeVisible();
  await page.evaluate(() => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    s.registry.set('activeSlot', 1);
    s.runManager.gold = 10000;
  });
}

/** The run as saved in slot 1 (a summary of what these flows change). */
function saved(page) {
  return page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const { loadRun } = await import('/src/engine/RunManager.js');
    const view = (run) => {
      if (!run) return null;
      const unit = (name) => run.roster.find((u) => u.name === name) || null;
      const who = (u) =>
        u && {
          hp: u.currentHP,
          maxHp: u.stats.HP,
          inventory: u.inventory.map((i) => i.name),
          forge: u.inventory.map((i) => i._forgeLevel || 0),
          arts: u.inventory.map((i) => i.weaponArtIds || []),
          consumables: u.consumables.map((i) => i.name),
        };
      return {
        gold: run.gold,
        roster: run.roster.map((u) => u.name),
        edric: who(unit('Edric')),
        sera: who(unit('Sera')),
        convoy: [...run.convoy.weapons, ...run.convoy.consumables].map((i) => i.name),
        scrolls: (run.scrolls || []).length,
        ruins: run.ruinsChoiceByNodeId || {},
        colosseum: Object.fromEntries(
          run.nodeMap.nodes.filter((n) => n.colosseumState).map((n) => [n.id, n.colosseumState]),
        ),
      };
    };
    return { live: view(s.runManager), saved: view(loadRun(s.gameData, 1)) };
  });
}

/** The saved run equals the live one on these keys, and they have these values. */
async function expectSaved(page, check) {
  const { live, saved: slot } = await saved(page);
  check(live);
  check(slot);
}

function boxes(page, selectors) {
  return page.evaluate(
    (sels) =>
      Object.fromEntries(
        sels.map((sel) => [
          sel,
          [...document.querySelectorAll(sel)].slice(0, 12).map((el) => {
            const r = el.getBoundingClientRect();
            return [r.x, r.y, r.width, r.height];
          }),
        ]),
      ),
    selectors,
  );
}

/** `upper` sits above `lower`; both span most of the width. */
async function expectStackedPair(page, upper, lower) {
  const b = await boxes(page, [upper, lower]);
  const [u] = b[upper];
  const [l] = b[lower];
  const vw = page.viewportSize().width;
  expect(u[1] + u[3], `${upper} above ${lower}`).toBeLessThanOrEqual(l[1] + 0.5);
  expect(u[2]).toBeGreaterThanOrEqual(vw * 0.88);
  expect(l[2]).toBeGreaterThanOrEqual(vw * 0.88);
}

async function expectClean(page, root) {
  await expectNoSidewaysScroll(page, root);
  expect(await clippedText(page, root), `clipped text in ${root}`).toEqual([]);
}

// ── Shop and caravan ──

async function openShop(page, stock, options = {}) {
  await page.evaluate(
    ({ stock, options }) => {
      const s = window.__emblemRogueGame.scene.getScene('NodeMap');
      const find = (name) =>
        s.gameData.weapons.find((w) => w.name === name) ||
        s.gameData.consumables.find((c) => c.name === name);
      const items = stock.map(([name, price]) => {
        const item = structuredClone(find(name));
        return { type: item.type === 'Consumable' ? 'consumable' : 'weapon', item, price };
      });
      if (options.caravan) {
        s.showShopOverlay(null, items, { caravan: true });
        return;
      }
      const n = s.runManager.getAvailableNodes()[0];
      n.type = 'shop';
      s.showShopOverlay(n, items);
    },
    { stock, options },
  );
  const shop = page.locator('.shop-menu');
  await expect(shop).toBeVisible();
  return shop;
}

/** Shop body upright: list over detail, one-line tools in reach, Buy/Sell in reach. */
async function expectShopLayout(page, shop, insets) {
  await expectStackedPair(page, '.shop-stock', '.shop-detail');
  const tools = shop.locator('.shop-tools .re-btn');
  await expectSingleLine(tools);
  for (const tool of await tools.all()) await expectTappable(tool);
  await expectTappable(shop.locator('.shop-commit .re-btn'));
  await expectTappable(shop.getByRole('button', { name: /^(Leave|Return to ruins)$/ }));
  await expectSingleLine(shop.locator('.re-header > button, .shop-gold'));
  await expectClean(page, '.shop-menu');
  if (insets)
    await expectInsideSafeArea(
      page,
      '.shop-menu .re-header, .shop-tabs .re-btn, .shop-tools .re-btn, .shop-commit .re-btn',
      insets,
    );
}

for (const viewport of [SE, IPHONE_13]) {
  const size = `${viewport.width}x${viewport.height}`;
  const insets = viewport === SE ? null : NOTCH_PORTRAIT;

  test.describe(`upright services ${size}`, () => {
    test.use(phoneContext(viewport));
    test.describe.configure({ timeout: 90_000 });
    test.beforeEach(async ({ page }) => {
      if (insets) expect(await emulateSafeArea(page, insets)).toBe(true);
    });

    test('shop: buy with a comparison, sell the last weapon, forge; each is saved', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      await bootRoute(page);
      await expectPortraitUi(page);
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const sera = s.runManager.roster.find((u) => u.name === 'Sera');
        sera.inventory = sera.inventory.filter((w) => w.name === 'Glimmer');
        sera.weapon = sera.inventory[0];
      });
      const shop = await openShop(page, [
        ['Steel Sword', 1000],
        ['Rapier', 1800],
        ['Keen Sword', 2300],
        ['Vulnerary', 300],
      ]);
      await expectShopLayout(page, shop, insets);
      await page.screenshot({ path: info.outputPath(`shop-buy-${size}.png`) });

      // The Rapier's keyword chips (#130) and the roster comparison (#139) fit.
      await press(shop.locator('.shop-row').filter({ hasText: 'Rapier' }));
      await expect(shop.locator('.shop-detail .re-item-keys')).toBeVisible();
      await shop.getByText('Compare with your roster', { exact: true }).tap();
      const line = shop.locator('.shop-copy details p').filter({ hasText: 'Edric: If equipped:' });
      await expect(line).toContainText('Attack');
      await line.scrollIntoViewIfNeeded();
      await expectShopLayout(page, shop, insets);

      // Buy the Steel Sword for Edric: the picker row carries the comparison.
      await press(shop.locator('.shop-row').filter({ hasText: 'Steel Sword' }));
      const buy = shop.getByRole('button', { name: 'Buy · 1000 G', exact: true });
      await expectTappable(buy);
      await buy.tap();
      const give = page.getByRole('dialog', { name: 'Give Steel Sword to', exact: true });
      const edricRow = give.getByRole('button', { name: /^Edric/ });
      await expect(edricRow).toContainText('If equipped: Attack');
      await expectClean(page, '.re-choice-picker');
      await page.screenshot({ path: info.outputPath(`shop-buy-picker-${size}.png`) });
      await edricRow.tap();
      const confirm = give.getByRole('button', { name: 'Confirm', exact: true });
      await expectTappable(confirm);
      await confirm.tap();
      await expect(give).toHaveCount(0);
      await expectSaved(page, (run) => {
        expect(run.gold).toBe(9000);
        expect(run.edric.inventory).toContain('Steel Sword');
      });

      // Sell Sera's only weapon: the warning (#141) shows before the confirm.
      await shop.getByRole('button', { name: 'Sell', exact: true }).tap();
      await press(shop.locator('.shop-row').filter({ hasText: 'Glimmer' }));
      await expect(shop.locator('.shop-warning')).toHaveText('Leaves Sera unarmed.');
      await expectShopLayout(page, shop, insets);
      await page.screenshot({ path: info.outputPath(`shop-sell-${size}.png`) });
      await shop.getByRole('button', { name: 'Sell · 350 G', exact: true }).tap();
      const sell = page.getByRole('dialog', { name: 'Sell Glimmer?', exact: true });
      await expect(sell).toContainText('Leaves Sera unarmed.');
      await expectTappable(sell.getByRole('button', { name: 'Confirm', exact: true }));
      await sell.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await expect(sell).toHaveCount(0);
      await expectSaved(page, (run) => {
        expect(run.gold).toBe(9350);
        expect(run.sera.inventory).toEqual([]);
      });

      // Forge Edric's Iron Sword +1 Might: the picker previews "Attack 11 → 12".
      await shop.getByRole('button', { name: 'Forge', exact: true }).tap();
      await press(shop.locator('.shop-row').filter({ hasText: 'Iron Sword' }));
      await expectShopLayout(page, shop, insets);
      await shop.getByRole('button', { name: 'Choose forge', exact: true }).tap();
      const forge = page.getByRole('dialog', { name: 'Forge Iron Sword', exact: true });
      const might = forge.getByRole('button', { name: /^\+1 Might/ });
      await expect(might).toContainText(/Attack \d+ → \d+/);
      await expectClean(page, '.re-choice-picker');
      await page.screenshot({ path: info.outputPath(`shop-forge-picker-${size}.png`) });
      const cost = Number((await might.textContent()).match(/(\d+) gold/)[1]);
      await might.tap();
      await forge.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await expect(forge).toHaveCount(0);
      await expectSaved(page, (run) => {
        expect(run.gold).toBe(9350 - cost);
        expect(run.edric.forge[run.edric.inventory.findIndex((n) => /^Iron Sword/.test(n))]).toBe(
          1,
        );
      });
      expect(errors).toEqual([]);
    });

    test('a full bag: the buy picker says where the item goes, and it lands in the convoy', async ({
      page,
    }) => {
      await bootRoute(page);
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const edric = s.runManager.roster.find((u) => u.name === 'Edric');
        const sword = s.gameData.weapons.find((w) => w.name === 'Iron Sword');
        edric.inventory = Array.from({ length: 5 }, () => structuredClone(sword));
        edric.weapon = edric.inventory[0];
      });
      const shop = await openShop(page, [['Steel Sword', 1000]]);
      await shop.getByRole('button', { name: 'Buy · 1000 G', exact: true }).tap();
      const give = page.getByRole('dialog', { name: 'Give Steel Sword to', exact: true });
      const edricRow = give.getByRole('button', { name: /^Edric/ });
      await expect(edricRow).toContainText(
        'Items 5/5 · Full: sent to convoy · trade it in from Roster',
      );
      await expectClean(page, '.re-choice-picker');
      await edricRow.tap();
      await give.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await expect(give).toHaveCount(0);
      await expectSaved(page, (run) => {
        expect(run.convoy).toContain('Steel Sword');
        expect(run.edric.inventory).toHaveLength(5);
      });
    });

    test('caravan: the Merchant Caravan fits, and a purchase is saved', async ({ page }, info) => {
      await bootRoute(page);
      const shop = await openShop(page, [['Vulnerary', 300]], { caravan: true });
      await expect(shop.getByRole('heading', { name: 'Merchant Caravan' })).toBeVisible();
      await expect(shop.getByRole('button', { name: /^Restock/ })).toHaveCount(0);
      await expectShopLayout(page, shop, insets);
      // One item: the list is as tall as its row, not an empty band over the detail.
      const band = await shop.locator('.shop-stock').evaluate((el) => {
        const box = el.getBoundingClientRect();
        const last = el.lastElementChild.getBoundingClientRect();
        return { box: box.height, rows: last.bottom - box.top };
      });
      expect(band.box - band.rows, 'empty space under the stock').toBeLessThanOrEqual(24);
      await page.screenshot({ path: info.outputPath(`caravan-${size}.png`) });
      await shop.getByRole('button', { name: 'Buy · 300 G', exact: true }).tap();
      const give = page.getByRole('dialog', { name: 'Give Vulnerary to', exact: true });
      await give.getByRole('button', { name: /^Edric/ }).tap();
      await give.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await expect(give).toHaveCount(0);
      await expectSaved(page, (run) => {
        expect(run.gold).toBe(9700);
        expect(run.edric.consumables).toContain('Vulnerary');
      });
    });

    test('church: heal and revive, with the map and roster in reach', async ({ page }, info) => {
      const errors = pageErrors(page);
      await bootRoute(page);
      const maxHp = await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const r = s.runManager;
        r.roster[0].currentHP = 1;
        const { createUnit } = await import('/src/engine/UnitManager.js');
        const fallen = createUnit(
          s.gameData.classes.find((c) => c.name === 'Fighter'),
          2,
          s.gameData.weapons,
          { name: 'Benedetta' },
        );
        fallen.currentHP = 0;
        r.fallenUnits.push(fallen);
        // The next node becomes a church, entered through the route (as a tap would).
        const node = r.getAvailableNodes()[0];
        node.type = 'church';
        s.onNodeClick(node);
        return r.roster[0].stats.HP;
      });
      const church = page.getByRole('dialog', { name: 'Church', exact: true });
      await expect(church).toBeVisible();
      for (const name of ['Leave', 'Heal all · Free', 'View map', 'Roster'])
        await expectTappable(church.getByRole('button', { name, exact: true }));
      const revive = church.getByRole('button', { name: /^Benedetta · Fighter · Revive 1100 G$/ });
      await expectTappable(revive);
      await expectClean(page, '.service-menu');
      if (insets) await expectInsideSafeArea(page, '.service-menu .re-header', insets);
      await page.screenshot({ path: info.outputPath(`church-${size}.png`) });

      await church.getByRole('button', { name: 'Heal all · Free', exact: true }).tap();
      await expect(church.getByRole('status')).toHaveText('All units healed.');
      await expectSaved(page, (run) => expect(run.edric.hp).toBe(maxHp));
      await revive.tap();
      const confirm = page.getByRole('dialog', { name: 'Revive Benedetta?', exact: true });
      await expectTappable(confirm.getByRole('button', { name: 'Confirm', exact: true }));
      await confirm.getByRole('button', { name: 'Confirm', exact: true }).tap();
      await expect(church.getByRole('status')).toContainText('Benedetta revived');
      await expectSaved(page, (run) => {
        expect(run.roster).toContain('Benedetta');
        expect(run.gold).toBe(8900);
      });
      await church.getByRole('button', { name: 'View map', exact: true }).tap();
      const map = page.getByRole('dialog', { name: 'Campaign map', exact: true });
      await expectTappable(map.getByRole('button', { name: 'Close', exact: true }));
      await map.getByRole('button', { name: 'Close', exact: true }).tap();
      await church.getByRole('button', { name: 'Roster', exact: true }).tap();
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await sheet.getByRole('button', { name: 'Close', exact: true }).tap();
      await expect(sheet).toHaveCount(0);
      await expect(church).toBeVisible();
      // Leave; the route's re-entry reads "Re-enter church" and reopens it.
      await church.getByRole('button', { name: 'Leave', exact: true }).tap();
      await expect(church).toHaveCount(0);
      await page
        .getByRole('button', { name: /^Church ·/ })
        .first()
        .tap();
      const again = page.getByRole('button', { name: 'Re-enter church', exact: true });
      await expectTappable(again);
      await again.tap();
      await expect(church).toBeVisible();
      await expectSaved(page, (run) => expect(run.roster).toContain('Benedetta'));
      expect(errors).toEqual([]);
    });

    test('arena: an unarmed fighter is turned away; the forecast stacks; a fight is saved', async ({
      page,
    }, info) => {
      await bootRoute(page);
      const nodeId = await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const sera = s.runManager.roster.find((u) => u.name === 'Sera');
        sera.inventory = [];
        sera.weapon = null;
        const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
        const node = s.runManager.getAvailableNodes()[0];
        window.__arena = new ColosseumOverlay(s, s.runManager, s.gameData);
        window.__arena.show(node, () => {});
        return node.id;
      });
      const menu = page.getByRole('dialog', { name: 'Colosseum', exact: true });
      await expectTappable(menu.getByRole('button', { name: 'Arena', exact: true }));
      await expectTappable(menu.getByRole('button', { name: 'Mercenary board', exact: true }));
      await menu.getByRole('button', { name: 'Arena', exact: true }).tap();
      const units = page.getByRole('dialog', { name: 'Arena · Choose fighter', exact: true });
      // #141: an unarmed unit cannot enter, and the screen says why.
      await expect(units.getByRole('button', { name: /^Sera ·/ })).toBeDisabled();
      await expect(
        units.getByText('Sera has no weapon to fight with.', { exact: true }),
      ).toBeVisible();
      await expectClean(page, '.service-menu');
      await page.screenshot({ path: info.outputPath(`arena-units-${size}.png`) });
      await units.getByRole('button', { name: /^Edric ·/ }).tap();
      await page.getByRole('button', { name: /^Bronze/ }).tap();
      const forecast = page.getByRole('dialog', { name: 'Arena · Combat forecast', exact: true });
      const cards = forecast.locator('.service-card');
      await expect(cards).toHaveCount(2);
      // One card per fighter, stacked full width; each names its weapon.
      const [a, b] = await cards.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, width: r.width };
        }),
      );
      expect(a.bottom).toBeLessThanOrEqual(b.top + 0.5);
      expect(a.width).toBeGreaterThanOrEqual(page.viewportSize().width * 0.88);
      await expect(cards.nth(0)).toContainText('Iron Sword');
      await expectClean(page, '.service-menu');
      await page.screenshot({ path: info.outputPath(`arena-forecast-${size}.png`) });
      const fight = forecast.getByRole('button', { name: 'Fight', exact: true });
      await expectTappable(fight);
      await fight.tap();
      const log = page.getByRole('dialog', { name: 'Arena · Combat result', exact: true });
      await log.getByRole('button', { name: 'Continue', exact: true }).last().tap();
      await expect(
        page.getByRole('dialog', { name: 'Arena · Rewards', exact: true }),
      ).toBeVisible();
      await expectSaved(page, (run) => {
        expect(run.colosseum[nodeId].fightsPerUnit).toEqual({ Edric: 1 });
      });
      const { live, saved: slot } = await saved(page);
      expect(slot.gold).toBe(live.gold);
    });

    test('mercenary board (choice.css): the hire screen fits and Confirm hire is in reach', async ({
      page,
    }) => {
      await bootRoute(page);
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const { ColosseumOverlay } = await import('/src/ui/ColosseumOverlay.js');
        window.__arena = new ColosseumOverlay(s, s.runManager, s.gameData);
        window.__arena.show(s.runManager.getAvailableNodes()[0], () => {});
      });
      await page.getByRole('button', { name: 'Mercenary board', exact: true }).tap();
      const board = page.getByRole('dialog', { name: 'Mercenary board', exact: true });
      await expectNoSidewaysScroll(page, '.service-menu');
      await page.screenshot({
        path: test.info().outputPath(`merc-board-${page.viewportSize().width}.png`),
      });
      await board.locator('.re-menu-body button').first().tap();
      const hire = page.getByRole('dialog', { name: /^Hire / });
      await expect(hire).toContainText('Hire cost:');
      await expectNoSidewaysScroll(page, '.service-menu');
      await expectTappable(hire.getByRole('button', { name: 'Confirm hire', exact: true }));
      await page.screenshot({
        path: test.info().outputPath(`merc-hire-${page.viewportSize().width}.png`),
      });
    });
  });
}

// ── The Ruins ──

/** Walk to the act's pre-boss ruins with Edric wounded and one ally fallen. */
async function enterRuins(page) {
  return page.evaluate(async () => {
    const s = window.__emblemRogueGame.scene.getScene('NodeMap');
    const r = s.runManager;
    const ruins = r.nodeMap.nodes.find((n) => n.type === 'ruins');
    const before = r.nodeMap.nodes.find((n) => n.edges.includes(ruins.id));
    before.completed = true;
    r.currentNodeId = before.id;
    r.roster[0].currentHP = 1;
    const { createUnit } = await import('/src/engine/UnitManager.js');
    const fallen = createUnit(
      s.gameData.classes.find((c) => c.name === 'Fighter'),
      2,
      s.gameData.weapons,
      { name: 'Ruinsfallen' },
    );
    fallen.currentHP = 0;
    r.fallenUnits.push(fallen);
    s.onNodeClick(ruins);
    return { id: ruins.id, maxHp: r.roster[0].stats.HP };
  });
}

const REST = 'Rest — heal everyone, revive the fallen';
const SCAVENGE = "Scavenge — the ruins' wares (+25%)";

for (const viewport of [SE, IPHONE_13]) {
  const size = `${viewport.width}x${viewport.height}`;
  const insets = viewport === SE ? null : NOTCH_PORTRAIT;

  test.describe(`upright ruins ${size}`, () => {
    test.use(phoneContext(viewport));
    test.describe.configure({ timeout: 90_000 });
    test.beforeEach(async ({ page }) => {
      if (insets) expect(await emulateSafeArea(page, insets)).toBe(true);
    });

    test('two full-width choices with their effects; Rest heals, saves and re-enters', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      await bootRoute(page);
      const { id, maxHp } = await enterRuins(page);
      const sanctuary = page.getByRole('dialog', { name: 'Ruins sanctuary', exact: true });
      await expect(sanctuary).toBeVisible();
      const rule = sanctuary.locator('.ruins-rule');
      await expect(rule).toHaveText('Rest or scavenge. The ruins allow only one.');
      const rest = sanctuary.getByRole('button', { name: REST, exact: true });
      const scavenge = sanctuary.getByRole('button', { name: SCAVENGE, exact: true });
      // Each choice: whole, full width, below the rule, its effects in view and as its
      // description.
      for (const choice of [rest, scavenge]) await expectTappable(choice);
      await expectStackedPair(page, '.ruins-rule', '.ruins-path[data-path="rest"]');
      await expectStackedPair(
        page,
        '.ruins-path[data-path="rest"]',
        '.ruins-path[data-path="scavenge"]',
      );
      await expect(rest.locator('.ruins-path-effect')).toHaveText([
        'Heal every unit now · Free',
        'Revive the fallen for gold · 1 waiting',
        'The wares stay buried',
      ]);
      await expect(scavenge.locator('.ruins-path-effect')).toHaveText([
        "Buy and sell the ruins' stock · +25% over village prices",
        'No healing or revival here',
      ]);
      for (const effect of await sanctuary.locator('.ruins-path-effect').all())
        await expect(effect).toBeInViewport({ ratio: 1 });
      await expect(rest).toHaveAccessibleDescription(/Heal every unit now · Free/);
      await expectClean(page, '.service-menu');
      if (insets) await expectInsideSafeArea(page, '.service-menu .re-header, .ruins-path', insets);
      await page.screenshot({ path: info.outputPath(`ruins-choice-${size}.png`) });

      await rest.tap();
      const confirm = page.getByRole('dialog', { name: 'Rest here?', exact: true });
      await expect(confirm).toContainText('This cannot be undone.');
      await expectClean(page, '.re-choice-picker');
      const ok = confirm.getByRole('button', { name: 'Rest', exact: true });
      await expectTappable(ok);
      await ok.tap();
      await expect(sanctuary.getByRole('status')).toContainText('All units healed.');
      await expect(sanctuary.locator('.ruins-chosen')).toHaveText(
        'You chose to rest here. The wares stay buried.',
      );
      await expectSaved(page, (run) => {
        expect(run.ruins[id]).toBe('rest');
        expect(run.edric.hp).toBe(maxHp);
      });
      await expectTappable(
        sanctuary.getByRole('button', { name: /Ruinsfallen · Fighter · Revive/ }),
      );
      await expectClean(page, '.service-menu');
      await page.screenshot({ path: info.outputPath(`ruins-rest-${size}.png`) });

      // Leave; the route's re-entry reads "Return to ruins" and reopens the sanctuary.
      await sanctuary.getByRole('button', { name: 'Leave', exact: true }).tap();
      await expect(sanctuary).toHaveCount(0);
      await page
        .getByRole('button', { name: /^Ruins ·/ })
        .first()
        .tap();
      const back = page.getByRole('button', { name: 'Return to ruins', exact: true });
      await expectTappable(back);
      await back.tap();
      await expect(sanctuary).toBeVisible();
      await expect(
        sanctuary.getByRole('button', { name: 'Heal all · Free', exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    });

    test('Scavenge opens the wares; a purchase saves; Return to ruins shows Browse wares', async ({
      page,
    }, info) => {
      await bootRoute(page);
      const { id } = await enterRuins(page);
      const sanctuary = page.getByRole('dialog', { name: 'Ruins sanctuary', exact: true });
      await sanctuary.getByRole('button', { name: SCAVENGE, exact: true }).tap();
      const confirm = page.getByRole('dialog', { name: 'Scavenge the ruins?', exact: true });
      await confirm.getByRole('button', { name: 'Scavenge', exact: true }).tap();
      const market = page.getByRole('dialog', { name: 'Ruins market', exact: true });
      await expect(market).toBeVisible();
      await expectSaved(page, (run) => expect(run.ruins[id]).toBe('scavenge'));
      await expectShopLayout(page, market, insets);
      // The markup note sits inside the detail's padding, not against its border.
      const inset = await market
        .locator('.shop-detail > p', { hasText: 'Ruins prices include' })
        .evaluate((p) => {
          const range = document.createRange();
          range.selectNodeContents(p);
          return range.getBoundingClientRect().left - p.parentElement.getBoundingClientRect().left;
        });
      expect(inset).toBeGreaterThanOrEqual(8);
      await page.screenshot({ path: info.outputPath(`ruins-market-${size}.png`) });
      const gold = (await saved(page)).live.gold;
      await market.locator('.shop-row').filter({ hasText: 'Vulnerary' }).first().tap();
      const buy = market.getByRole('button', { name: /^Buy · \d+ G$/ });
      const price = Number((await buy.textContent()).match(/(\d+) G/)[1]);
      await buy.tap();
      const give = page.getByRole('dialog', { name: 'Give Vulnerary to', exact: true });
      await give.locator('.re-btn--primary').tap();
      await expect(give).toHaveCount(0);
      await expectSaved(page, (run) => expect(run.gold).toBe(gold - price));
      await market.getByRole('button', { name: 'Return to ruins', exact: true }).tap();
      await expect(sanctuary.locator('.ruins-chosen')).toHaveText(
        'You chose to scavenge here. No rest tonight.',
      );
      await expectTappable(sanctuary.getByRole('button', { name: 'Browse wares', exact: true }));
      await expectClean(page, '.service-menu');
    });
  });
}

// ── The roster sheet ──

for (const viewport of [SE, IPHONE_13]) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`upright roster sheet ${size}`, () => {
    test.use(phoneContext(viewport));
    test.describe.configure({ timeout: 90_000 });

    test('equipment, the unarmed warning, About this item and the convoy note fit', async ({
      page,
    }, info) => {
      const errors = pageErrors(page);
      await bootRoute(page);
      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const run = s.runManager;
        const weapon = (name) => structuredClone(s.gameData.weapons.find((w) => w.name === name));
        const edric = run.roster.find((u) => u.name === 'Edric');
        const sera = run.roster.find((u) => u.name === 'Sera');
        const grasp = weapon('Eldritch Grasp');
        grasp.name = 'Armorbane Eldritch Grasp +3';
        edric.inventory = [
          weapon('Rapier'),
          grasp,
          weapon('Keen Sword'),
          weapon('Silver Sword'),
          weapon('Iron Lance'),
        ];
        edric.weapon = edric.inventory[0];
        sera.inventory = [weapon('Glimmer')];
        sera.weapon = sera.inventory[0];
        run.convoy.weapons = [weapon('Twisting Vortex')];
        run.accessories = [
          structuredClone(s.gameData.accessories.find((a) => a.name === "Vampire's Bloodshard")),
        ];
      });
      await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).tap();
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await sheet.getByRole('button', { name: 'Equipment', exact: true }).tap();
      // #140: "Equipment · 5/5" and Trade with… share a row without touching.
      const heading = sheet.locator('.mr-heading-row h3');
      await expect(heading).toHaveText('Equipment · 5/5');
      const tradeWith = sheet.getByRole('button', { name: 'Trade with…', exact: true });
      await expectTappable(tradeWith);
      const [h, t] = [await heading.boundingBox(), await tradeWith.boundingBox()];
      expect(h.x + h.width <= t.x + 0.5 || h.y + h.height <= t.y + 0.5).toBe(true);
      for (const name of ['Trade…', 'Store', 'Equip'])
        await expectTappable(sheet.getByRole('button', { name, exact: true }).first());
      // #118: About this item opens the picture beside (or over) its story, in the card.
      const card = sheet
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: /^Rapier/ }) });
      await card.getByText('About this item', { exact: true }).tap();
      const about = card.locator('.mr-about');
      await expect(about).toBeVisible();
      await expect(about.locator('.mr-lore')).toBeVisible();
      const [aboutBox, cardBox] = [await about.boundingBox(), await card.boundingBox()];
      expect(aboutBox.x + aboutBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 0.5);
      await expect(card.locator('.re-item-keys')).toBeVisible();
      await expectClean(page, '.mr-sheet');
      await page.screenshot({ path: info.outputPath(`roster-equipment-${size}.png`) });

      // #141: Sera's only weapon: Store warns, then the unarmed card.
      await sheet
        .getByRole('navigation', { name: 'Units' })
        .getByRole('button', { name: /Sera/ })
        .tap();
      const seraCard = sheet
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: /^Glimmer/ }) });
      await seraCard.scrollIntoViewIfNeeded();
      await expect(seraCard.locator('small.mr-warn')).toHaveText('Leaves Sera unarmed.');
      await expectClean(page, '.mr-sheet');
      await seraCard.getByRole('button', { name: 'Store', exact: true }).tap();
      await expect(sheet).toContainText(
        'Unarmed: this unit cannot attack or counterattack until it carries a weapon.',
      );
      await expectSaved(page, (run) => {
        expect(run.sera.inventory).toEqual([]);
        expect(run.convoy).toContain('Glimmer');
      });
      await page.screenshot({ path: info.outputPath(`roster-unarmed-${size}.png`) });

      // #140: Edric's bag is full, so a convoy card offers Trade… and says why.
      await sheet
        .getByRole('navigation', { name: 'Units' })
        .getByRole('button', { name: /Edric/ })
        .tap();
      await sheet.getByRole('button', { name: 'Convoy', exact: true }).tap();
      const convoyCard = sheet
        .getByRole('article')
        .filter({ has: page.getByRole('heading', { name: 'Twisting Vortex' }) });
      await convoyCard.scrollIntoViewIfNeeded();
      await expect(convoyCard).toContainText(
        'Equipment full: trade to swap it for a carried item.',
      );
      await expectTappable(convoyCard.getByRole('button', { name: 'Trade…', exact: true }));
      await expectClean(page, '.mr-sheet');
      expect(errors).toEqual([]);
    });

    test('art binding: the choices come before the preview; Replace binds and saves', async ({
      page,
    }, info) => {
      await bootRoute(page);
      const names = await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        const unit = s.runManager.roster[0];
        const arts = s.gameData.weaponArts.arts
          .filter((a) => a.weaponType === 'Sword' && a.requiredRank === 'Prof')
          .slice(0, 4);
        const weapon = (name) => structuredClone(s.gameData.weapons.find((w) => w.name === name));
        unit.inventory = [
          weapon('Iron Sword'),
          weapon('Rapier'),
          weapon('Keen Sword'),
          weapon('Silver Sword'),
        ];
        unit.weapon = unit.inventory[0];
        unit.inventory[0].weaponArtIds = arts.slice(0, 3).map((a) => a.id);
        unit.inventory[0].weaponArtSources = ['innate', 'scroll', 'meta_innate'];
        s.runManager.scrolls = [{ name: "Hunter's Volley Scroll", teachesWeaponArtId: arts[3].id }];
        return { old: arts[0].name, next: arts[3].id };
      });
      await page.locator('.re-node-map').getByRole('button', { name: 'Roster', exact: true }).tap();
      const sheet = page.getByRole('dialog', { name: 'Manage roster', exact: true });
      await sheet.getByRole('button', { name: 'Skills', exact: true }).tap();
      await sheet.getByRole('button', { name: 'Bind to weapon…' }).tap();
      const weapons = page.getByRole('dialog', {
        name: "Choose weapon for Hunter's Volley Scroll",
      });
      await expect(weapons).toBeVisible();
      // The weapon list gets the room it needs before the preview: whole, or at least
      // as tall as the preview while it scrolls.
      const fit = await weapons.evaluate((root) => {
        const list = root.querySelector('.re-choice-list');
        const preview = root.querySelector('.re-choice-preview');
        return {
          fits: list.scrollHeight <= list.clientHeight + 1,
          list: list.clientHeight,
          preview: preview.clientHeight,
        };
      });
      expect(fit.fits || fit.list >= fit.preview, JSON.stringify(fit)).toBe(true);
      await expectClean(page, '.re-choice-picker');
      await expectTappable(weapons.getByRole('button', { name: 'Confirm', exact: true }));
      await page.screenshot({ path: info.outputPath(`bind-weapon-${size}.png`) });
      await weapons.getByRole('button', { name: 'Confirm', exact: true }).tap();
      // #135: a full weapon asks which art to replace; Replace is the one confirmation.
      const slots = page.getByRole('dialog', { name: 'Choose art to replace', exact: true });
      await expect(slots.locator('[aria-pressed="true"]')).toContainText(names.old);
      const slotFit = await slots.evaluate((root) => {
        const list = root.querySelector('.re-choice-list');
        return list.scrollHeight <= list.clientHeight + 1;
      });
      expect(slotFit, 'all three art slots show whole').toBe(true);
      await expectClean(page, '.re-choice-picker');
      const replace = slots.getByRole('button', { name: 'Replace', exact: true });
      await expectTappable(replace);
      await page.screenshot({ path: info.outputPath(`bind-replace-${size}.png`) });
      await replace.tap();
      await expect(page.locator('.re-choice-picker')).toHaveCount(0);
      await expectSaved(page, (run) => {
        expect(run.edric.arts[0][0]).toBe(names.next);
        expect(run.scrolls).toBe(0);
      });
    });
  });
}

// ── Landscape stays as it was ──

const LANDSCAPE_KEYS = {
  shop: [
    '.shop-menu .re-header',
    '.shop-tabs .re-btn',
    '.shop-stock',
    '.shop-detail',
    '.shop-tools .re-btn',
    '.shop-commit .re-btn',
  ],
  ruins: ['.service-menu .re-header', '.ruins-rule', '.ruins-path', '.shop-tools .re-btn'],
  church: ['.service-menu .re-header', '.service-menu .re-menu-body > .re-btn'],
};

/** The portrait class alone (announced as the shell would) moves nothing here. */
async function expectClassInert(page, screen) {
  await page.evaluate(() => document.fonts.ready);
  const before = await boxes(page, LANDSCAPE_KEYS[screen]);
  await page.evaluate(() => {
    document.documentElement.classList.add('portrait-ui');
    window.dispatchEvent(new CustomEvent('emblem-rogue:portrait-ui', { detail: { active: true } }));
  });
  const after = await boxes(page, LANDSCAPE_KEYS[screen]);
  for (const sel of LANDSCAPE_KEYS[screen]) {
    expect(after[sel].length, `${screen} ${sel}`).toBe(before[sel].length);
    expect(before[sel].length, `${screen} ${sel} rendered`).toBeGreaterThan(0);
    after[sel].forEach((box, i) =>
      box.forEach((v, k) =>
        expect(Math.abs(v - before[sel][i][k]), `${screen} ${sel}[${i}]`).toBeLessThanOrEqual(1),
      ),
    );
  }
  await page.evaluate(() => document.documentElement.classList.remove('portrait-ui'));
}

for (const viewport of [
  { width: 844, height: 390, touch: true },
  { width: 640, height: 480, touch: false },
]) {
  const size = `${viewport.width}x${viewport.height}`;
  test.describe(`landscape services ${size}`, () => {
    test.use(
      viewport.touch
        ? phoneContext({ width: viewport.width, height: viewport.height })
        : { viewport: { width: viewport.width, height: viewport.height } },
    );

    test('shop, church and the Ruins choice ignore the portrait class', async ({ page }) => {
      await bootRoute(page, { touch: viewport.touch });
      await expectPortraitUi(page, false);
      const shop = await openShop(page, [
        ['Steel Sword', 1000],
        ['Vulnerary', 300],
      ]);
      await page.screenshot({ path: test.info().outputPath(`shop-landscape-${size}.png`) });
      await expectClassInert(page, 'shop');
      await press(shop.getByRole('button', { name: 'Leave', exact: true }), viewport.touch);
      await expect(shop).toHaveCount(0);

      await page.evaluate(() => {
        const s = window.__emblemRogueGame.scene.getScene('NodeMap');
        s.handleChurch(s.runManager.getAvailableNodes()[0]);
      });
      const church = page.getByRole('dialog', { name: 'Church', exact: true });
      await expect(church).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`church-landscape-${size}.png`) });
      await expectClassInert(page, 'church');
      await press(church.getByRole('button', { name: 'Leave', exact: true }), viewport.touch);
      await expect(church).toHaveCount(0);
    });

    test('the Ruins choice keeps its one-line buttons; the effect lines stay hidden', async ({
      page,
    }) => {
      await bootRoute(page, { touch: viewport.touch });
      await enterRuins(page);
      const sanctuary = page.getByRole('dialog', { name: 'Ruins sanctuary', exact: true });
      await expect(sanctuary).toBeVisible();
      await expect(sanctuary.locator('.ruins-path-effects').first()).toBeHidden();
      await expectSingleLine(sanctuary.locator('.ruins-path'));
      await expect(
        sanctuary.getByRole('button', { name: REST, exact: true }),
      ).toHaveAccessibleDescription(/Heal every unit now · Free/);
      await page.screenshot({ path: test.info().outputPath(`ruins-landscape-${size}.png`) });
      await expectClassInert(page, 'ruins');
    });
  });
}
