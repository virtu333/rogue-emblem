import { test, expect } from '@playwright/test';
import { waitForScene } from './helpers.js';
import {
  DESKTOPS,
  LANDSCAPE_PHONES,
  NOTCH_PORTRAIT,
  PORTRAIT_PHONES,
  clippedText,
  emulateSafeArea,
  expectInsideSafeArea,
  expectNoSidewaysScroll,
  expectPortraitUi,
  expectSingleLine,
  expectTappable,
  pageErrors,
  phone as phoneContext,
  quietSettings,
} from './portraitHelpers.js';

// phone() spreads a device descriptor whose defaultBrowserType would force a new worker
// inside a describe group; the lane runs Chromium either way.
// eslint-disable-next-line no-unused-vars
const phone = (viewport) => (({ defaultBrowserType, ...rest }) => rest)(phoneContext(viewport));

// The upright battle rail (docs/portrait-battles.md): the short strip under the turned
// board, its submenus and lists, the forecast bottom sheet, Formation, the tutorial
// note, the side objectives in the compact header, and the input lifecycle around it.
// Every phone here is the real default path: a touch phone, portrait mode on by
// default, no ?portrait=1 and no forced class.
//
// Failure modes each test guards against:
//   - a submenu or list squeezed three across (briefs cut, notes ellipsised);
//   - a unit's commands, the idle trio or Battle details pushed under the fold;
//   - the forecast's two sides side by side at ~150px (labels broken, enemy numbers
//     below the fold), Cancel / Confirm under the home bar;
//   - a pinned Wait's note clipped, a greyed Attack's reason crowding the commands;
//   - Formation's dock breaking "Danger" mid-word, a tap on the turned board placing
//     on the wrong tile, a turn mid-placement losing the formation;
//   - the deploy menu leading to a board that has to re-open;
//   - the tutorial note inset for a side rail (~150px wide) over the bottom rail;
//   - the village and caravan invisible in the compact header, or the caravan's HP
//     read through the fog;
//   - a finger lifted with no press on record acting on the board;
//   - any of this changing the landscape phones or the desktop.

const ROUTE = '/?devScene=battle&preset=combat_actions&seed=42';

// Longest real strings (data/*.json, ItemNameMigration renames): a two-word unit name
// from the name pool, the longest class, and the longest weapon an imbue and forge can
// make (Armorbane + Twisting Vortex + 3).
const LONG_UNIT = 'Constance';
const LONG_CLASS = 'Light Priestess';
const LONG_WEAPON = 'Armorbane Twisting Vortex +3';
const startsWith = (text) => new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const battle = (page, source, arg) =>
  page.evaluate(
    ([src, a]) => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      return new Function('s', 'a', src)(s, a);
    },
    [source, arg],
  );

const rail = (page) => page.getByRole('complementary', { name: 'Battle commands' });

async function boot(page, url = ROUTE, settings = {}) {
  await quietSettings(page, settings);
  await page.goto(url);
  await waitForScene(page, 'Battle');
  await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
    timeout: 30_000,
  });
  // The turn banner has faded and the rail settled.
  await expect(rail(page)).toBeVisible();
}

// An orientation switch re-opens only from a save that reached storage, so a battle that
// must turn needs a real slot (the dev route has none). The test profile is isolated.
async function attachSlot(page) {
  await page.evaluate(async () => {
    const game = window.__emblemRogueGame;
    const { getMetaKey, setActiveSlot } = await import('/src/engine/SlotManager.js');
    const meta = game.registry.get('meta');
    meta.storageKey = getMetaKey(1);
    meta._save();
    game.registry.set('activeSlot', 1);
    setActiveSlot(1);
  });
}

// CSS point at the centre of a tile, through the live camera and canvas scale.
function tileCss(page, col, row) {
  return battle(
    page,
    `const w = s.grid.gridToPixel(a.col, a.row);
     const p = s._worldToScreen(w.x, w.y);
     const r = s.game.canvas.getBoundingClientRect();
     return { x: r.left + (p.x * r.width) / s.scale.width, y: r.top + (p.y * r.height) / s.scale.height };`,
    { col, row },
  );
}

const unitCss = async (page, name) => {
  const u = await battle(
    page,
    `const u = [...s.playerUnits, ...s.npcUnits].find((x) => x.name === a); return { col: u.col, row: u.row };`,
    name,
  );
  return tileCss(page, u.col, u.row);
};

/** Buttons (and the details row) in the scrolling command body, with whether each is whole. */
function bodyControls(page) {
  return page.evaluate(() => {
    const body = document.querySelector('.mobile-battle-hud .mb-body');
    const box = body.getBoundingClientRect();
    return [...body.querySelectorAll('button, summary')]
      .filter((el) => el.getClientRects().length && !el.closest('details:not([open]) > div'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return {
          name: (el.getAttribute('aria-label') || el.innerText).replace(/\s+/g, ' ').trim(),
          disabled: el.disabled === true,
          top: r.top,
          left: r.left,
          width: r.width,
          height: r.height,
          whole: r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5,
        };
      });
  });
}

// The bottom edge: the dock (End turn / Wait / Start, Danger) beside the four tools. Each
// control's box, whether anything covers its centre, and any word broken across lines.
function bottomRow(page) {
  return page.evaluate(() => {
    const hud = document.querySelector('.mobile-battle-hud');
    return [...hud.querySelectorAll('.mb-dock > button, .bl-tools > button')].map((button) => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const broken = [];
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (getComputedStyle(node.parentElement).display === 'none') continue;
        for (const m of node.textContent.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const rects = [...range.getClientRects()].filter((q) => q.width > 0);
          const inside = rects.every(
            (q) => q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.bottom <= r.bottom + 0.5,
          );
          if (rects.length !== 1 || !inside) broken.push(m[0]);
        }
      }
      return {
        name: button.getAttribute('aria-label') || button.innerText.replace(/\s+/g, ' ').trim(),
        top: r.top,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
        onScreen: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5,
        onTop: Boolean(hit && button.contains(hit)),
        broken,
      };
    });
  });
}

function expectWholeRow(row, names) {
  expect(row.map((c) => c.name)).toEqual(names);
  for (const [i, c] of row.entries()) {
    expect(c, c.name).toMatchObject({ onScreen: true, onTop: true, broken: [] });
    expect(c.width, `${c.name} width`).toBeGreaterThanOrEqual(44);
    expect(c.height, `${c.name} height`).toBeGreaterThanOrEqual(44);
    expect(Math.abs(c.top - row[0].top), `${c.name} shares the row`).toBeLessThan(1);
    if (i > 0)
      expect(c.left, `${c.name} clear of ${row[i - 1].name}`).toBeGreaterThan(row[i - 1].right);
  }
}

/** A list of full-width rows: one column, each row the list's width, 44px or taller. */
async function expectFullWidthRows(page, selector) {
  const info = await page.evaluate((sel) => {
    const list = document.querySelector(sel);
    const lr = list.getBoundingClientRect();
    return {
      columns: getComputedStyle(list).gridTemplateColumns.split(' ').length,
      listWidth: lr.width,
      rows: [...list.children].map((b) => {
        const r = b.getBoundingClientRect();
        return { name: b.innerText.split('\n')[0], width: r.width, height: r.height, left: r.left };
      }),
      listLeft: lr.left,
    };
  }, selector);
  expect(info.columns, `${selector} is one column`).toBe(1);
  expect(info.rows.length).toBeGreaterThan(0);
  for (const row of info.rows) {
    expect(Math.abs(row.width - info.listWidth), `"${row.name}" spans the list`).toBeLessThan(1);
    expect(Math.abs(row.left - info.listLeft)).toBeLessThan(1);
    expect(row.height, `"${row.name}" height`).toBeGreaterThanOrEqual(44);
  }
}

/** Make Sera carry the longest names: her class, a long imbued tome, staves, two items. */
function longestStrings(page) {
  return battle(
    page,
    `const sera = s.playerUnits.find((u) => u.name === 'Sera');
     const item = (n) => structuredClone(s.gameData.weapons.find((w) => w.name === n));
     const tome = item('Twisting Vortex');
     tome.name = a.weapon;
     sera.proficiencies = [...sera.proficiencies, { type: 'Tome', rank: 'Mast' }];
     sera.inventory[sera.inventory.length - 1] = tome; // a full pack: the tome replaces Warp
     sera.className = a.cls;
     sera.consumables = [
       { name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10, uses: 3 },
       { name: 'Elixir', type: 'Consumable', effect: 'heal', value: 99, uses: 1 },
     ];
     sera.currentHP = sera.stats.HP - 12;
     s._mobileBattleHud.lastSnapshot = '';`,
    { weapon: LONG_WEAPON, cls: LONG_CLASS },
  );
}

const openMenu = (page, name) =>
  battle(
    page,
    `const u = s.playerUnits.find((x) => x.name === a); s.selectUnit(u); s.showActionMenu(u);`,
    name,
  );
const closeAll = (page) =>
  battle(
    page,
    `for (let i = 0; i < 6 && s.battleState !== 'PLAYER_IDLE'; i++) s.requestCancel({ allowPause: false });`,
  );

/**
 * The rail has stopped rebuilding its rows: opening a list renders the rail a few times
 * as it settles (main behaves the same), so a row found before that is detached. Waits
 * for a quiet spell with no rows added or removed.
 */
function railSettled(page, quietMs = 400) {
  return page.evaluate(
    (quietMs) =>
      new Promise((resolve) => {
        const hud = document.querySelector('.mobile-battle-hud');
        let timer;
        const observer = new MutationObserver((records) => {
          if (records.some((r) => r.type === 'childList')) arm();
        });
        const arm = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            observer.disconnect();
            resolve();
          }, quietMs);
        };
        observer.observe(hud, { childList: true, subtree: true });
        arm();
      }),
    quietMs,
  );
}

for (const viewport of PORTRAIT_PHONES) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`upright ${size}`, () => {
    test.use(phone(viewport));

    test('a unit menu fits; Equip, Item and a staff pick list full-width rows with their notes', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const errors = pageErrors(page);
      await boot(page);
      await expectPortraitUi(page);
      await longestStrings(page);
      await openMenu(page, 'Sera');
      const hud = rail(page);
      const actions = hud.locator('.mb-actions').first();
      await expect(actions.getByRole('button', { name: 'Equip', exact: true })).toBeVisible();

      // The unit's commands: three across, every one whole in the body without a scroll.
      const menu = await bodyControls(page);
      const commands = menu.filter((c) => !c.disabled && c.name !== 'Battle details');
      expect(commands.length).toBeGreaterThanOrEqual(5);
      for (const c of commands) expect(c.whole, `${c.name} needs no scroll`).toBe(true);
      const firstRow = commands.filter((c) => Math.abs(c.top - commands[0].top) < 1);
      expect(firstRow.length).toBe(3);
      // The header gave the unit its row: the turn and objective step aside.
      await expect(hud.locator('.mb-phase')).toBeHidden();
      await expect(hud.locator('.mb-summary h2')).toHaveText('Sera');
      await expect(hud.locator('.mb-summary .mb-detail')).toContainText(LONG_CLASS);
      expect(await clippedText(page, '.mobile-battle-hud')).toEqual([]);

      // Equip: one row per weapon, the long name and its two-line brief whole.
      await actions.getByRole('button', { name: 'Equip', exact: true }).tap();
      const list = hud.locator('.mb-actions.mb-submenu');
      await expect(list).toBeVisible();
      await expectFullWidthRows(page, '.mobile-battle-hud .mb-actions.mb-submenu');
      const tome = list.getByRole('button', { name: startsWith(LONG_WEAPON) });
      await expectTappable(tome);
      const brief = await tome.locator('.mb-item-summary').evaluate((n) => ({
        lines: Math.round(
          n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight),
        ),
        text: n.textContent,
      }));
      expect(brief.text).toMatch(/^Mt \d+ · Hit \d+.*\nAttack speed \d+/);
      expect(brief.lines).toBe(2);
      expect(await clippedText(page, '.mobile-battle-hud .mb-body')).toEqual([]);
      await expectNoSidewaysScroll(page, '.mobile-battle-hud');
      await list.getByRole('button', { name: 'Back', exact: true }).tap();

      // Item: the note that using an item ends the action stays, above whole rows.
      await actions.getByRole('button', { name: 'Item', exact: true }).tap();
      await expect(
        hud.locator('.mb-body > .mb-detail').filter({ hasText: 'ends this unit' }),
      ).toBeVisible();
      await expectFullWidthRows(page, '.mobile-battle-hud .mb-actions.mb-submenu');
      await expectTappable(list.getByRole('button', { name: /^Vulnerary \(3\)/ }));
      await expect(list.getByRole('button', { name: /^Vulnerary \(3\)/ })).toContainText(
        'Restore 10 HP',
      );
      expect(await clippedText(page, '.mobile-battle-hud .mb-body')).toEqual([]);
      await list.getByRole('button', { name: 'Back', exact: true }).tap();

      // A staff pick list (the one "Staff (n/n)" opens with several usable staves): rows
      // with their descriptions, whole.
      await closeAll(page);
      await battle(
        page,
        `const u = s.playerUnits.find((x) => x.name === 'Sera');
         s.selectUnit(u); s.showActionMenu(u); s.hideActionMenu();
         s.showStaffPicker(u, u.inventory.filter((w) => w.type === 'Staff'));`,
      );
      await expect(list).toBeVisible();
      await expectFullWidthRows(page, '.mobile-battle-hud .mb-actions.mb-submenu');
      await expect(list.getByRole('button', { name: /^Heal/ })).toContainText('Heals');
      expect(await clippedText(page, '.mobile-battle-hud .mb-body')).toEqual([]);
      expect(errors).toEqual([]);
    });

    test('attack and heal target lists: full-width rows, the heal preview on one line, NPC allies listed', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await boot(page);
      // Two enemies in Edric's reach, one with the longest class name.
      await battle(
        page,
        `const u = s.playerUnits.find((p) => p.name === 'Edric');
         const es = s.enemyUnits.filter((e) => e.currentHP > 0);
         const [e, f] = es;
         f.col = e.col + 1; f.row = e.row - 1; f.name = a.cls; f.className = a.cls;
         u.col = e.col + 1; u.row = e.row;
         for (const x of [u, e, f]) s.updateUnitPosition(x);`,
        { cls: LONG_CLASS },
      );
      await openMenu(page, 'Edric');
      const hud = rail(page);
      await hud.locator('.mb-actions').getByRole('button', { name: 'Attack', exact: true }).tap();
      await expect(hud.locator('.mb-targets')).toBeVisible();
      await railSettled(page);
      await expectFullWidthRows(page, '.mobile-battle-hud .mb-targets');
      await expectSingleLine(hud.locator('.mb-targets .mb-item-summary'));
      expect(await clippedText(page, '.mobile-battle-hud .mb-body')).toEqual([]);
      await closeAll(page);

      // Heal: a hurt ally and the hurt merchant caravan (#141) in Sera's reach.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { createCaravanUnit } = await import('/src/engine/CaravanSystem.js');
        const sera = s.playerUnits.find((p) => p.name === 'Sera');
        const pat = s.playerUnits.find((p) => p.name === 'Patient');
        pat.col = sera.col + 1;
        pat.row = sera.row;
        s.updateUnitPosition(pat);
        const taken = new Set(
          [...s.playerUnits, ...s.enemyUnits, ...s.npcUnits].map((u) => `${u.col},${u.row}`),
        );
        const tile = [
          [0, -1],
          [-1, 0],
          [0, 1],
        ]
          .map(([dc, dr]) => ({ col: sera.col + dc, row: sera.row + dr }))
          .find((t) => t.col >= 0 && t.row >= 0 && !taken.has(`${t.col},${t.row}`));
        const caravan = createCaravanUnit('act2', tile);
        caravan.currentHP = 8;
        s.npcUnits.push(caravan);
        s.addUnitGraphic(caravan);
        s.battleConfig.caravanSpawn = tile;
      });
      await openMenu(page, 'Sera');
      // One usable staff reads "Heal (3/3)"; several open a staff list first.
      await hud
        .locator('.mb-actions')
        .getByRole('button', { name: /^(Heal|Staff)/ })
        .tap();
      const pick = hud.locator('.mb-submenu').getByRole('button', { name: /^Heal/ });
      if (await pick.count()) await pick.tap();
      await expect(hud.locator('.mb-heal-targets')).toBeVisible();
      await railSettled(page);
      await expectFullWidthRows(page, '.mobile-battle-hud .mb-heal-targets');
      const merchant = hud.locator('.mb-heal-targets').getByRole('button', { name: /^Merchant/ });
      await expectTappable(merchant);
      await expect(merchant.locator('.mb-item-summary')).toHaveText(
        /^HP 8\/\d+ → \d+\/\d+ \(\+\d+\)$/,
      );
      await expectSingleLine(hud.locator('.mb-heal-targets .mb-item-summary'));
      expect(await clippedText(page, '.mobile-battle-hud .mb-body')).toEqual([]);
      await expectNoSidewaysScroll(page, '.mobile-battle-hud');
    });

    test('forecast sheet: sides stacked, one row of numbers each, Cancel and Confirm above the home bar', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const errors = pageErrors(page);
      await boot(page);
      const safe = await emulateSafeArea(page, NOTCH_PORTRAIT);
      await battle(
        page,
        `const u = s.playerUnits.find((p) => p.name === 'Edric');
         const e = s.enemyUnits.find((x) => x.currentHP > 0);
         u.col = Math.max(0, e.col - 1); u.row = e.row; if (u.col === e.col) u.col += 1;
         s.selectUnit(u); s.hideActionMenu();
         return s.showForecast(u, e);`,
      );
      const dialog = page.getByRole('dialog', { name: 'Combat forecast' });
      await expect(dialog).toBeVisible();
      const layout = () =>
        page.evaluate(() => {
          const sheet = document.querySelector('.mb-forecast');
          const sides = sheet.querySelector('.mb-forecast-sides');
          const box = sides.getBoundingClientRect();
          return [...sheet.querySelectorAll('.mb-forecast-side')].map((side) => {
            const r = side.getBoundingClientRect();
            const cells = [...side.querySelectorAll('.mb-stats > div')].map((d) =>
              d.getBoundingClientRect(),
            );
            return {
              top: r.top,
              bottom: r.bottom,
              width: r.width,
              sidesWidth: box.width,
              statTops: cells.map((c) => Math.round(c.top)),
              numbersInView: cells.every(
                (c) => c.top >= box.top - 0.5 && c.bottom <= box.bottom + 0.5,
              ),
            };
          });
        });
      let [mine, theirs] = await layout();
      // Stacked: each side spans the sheet; the enemy's reply sits under the attack.
      expect(Math.abs(mine.width - mine.sidesWidth)).toBeLessThan(1);
      expect(theirs.top).toBeGreaterThanOrEqual(mine.bottom);
      // Damage × hits, Hit, Crit, AS on one row per side, both sides in view unscrolled.
      for (const side of [mine, theirs]) {
        expect(side.statTops.length).toBe(4);
        expect(new Set(side.statTops).size).toBe(1);
        expect(side.numbersInView).toBe(true);
      }
      await expectSingleLine(dialog.locator('.mb-stats dt'));
      await expectSingleLine(dialog.locator('.mb-forecast-side .mb-hp'));
      for (const name of ['Cancel', 'Confirm attack'])
        await expectTappable(dialog.getByRole('button', { name, exact: true }));
      if (safe)
        await expectInsideSafeArea(
          page,
          '.mb-forecast-backdrop [data-forecast-role]',
          NOTCH_PORTRAIT,
        );
      expect(await clippedText(page, '.mb-forecast')).toEqual([]);
      await expectNoSidewaysScroll(page);

      // The longest names, a planned weapon switch ("Confirming equips …") and skills that
      // change the numbers (details.mb-modifier): whole, and each modifier a 44px row.
      await closeAll(page);
      await battle(
        page,
        `const u = s.playerUnits.find((p) => p.name === 'Edric');
         const item = (n) => structuredClone(s.gameData.weapons.find((w) => w.name === n));
         const long = item('Steel Sword'); long.name = a.weapon;
         u.inventory = [item('Iron Sword'), long]; u.weapon = u.inventory[0];
         u.proficiencies = [{ type: 'Sword', rank: 'Mast' }];
         s.enemyUnits.find((x) => x.currentHP > 0).name = a.cls;`,
        { weapon: LONG_WEAPON, cls: LONG_CLASS },
      );
      await battle(
        page,
        `const u = s.playerUnits.find((p) => p.name === 'Edric');
         const e = s.enemyUnits.find((x) => x.currentHP > 0);
         u.col = Math.max(0, e.col - 1); u.row = e.row; if (u.col === e.col) u.col += 1;
         s.selectUnit(u); s.hideActionMenu();
         return s.showForecast(u, e, { weapon: u.inventory[1] });`,
      );
      await battle(
        page,
        `const hud = s._mobileBattleHud; const cfg = hud.forecast;
         const forecast = { ...cfg.forecast,
           attacker: { ...cfg.forecast.attacker, skills: [{ id: 'sol', name: 'Sol' }, { id: 'luna', name: 'Luna' }] },
           defender: { ...cfg.forecast.defender, skills: [{ id: 'vantage', name: 'Vantage' }] } };
         hud.showForecast({ ...cfg, forecast });`,
      );
      await expect(dialog.getByText(`Confirming equips ${LONG_WEAPON}`)).toBeVisible();
      await expect(dialog.locator('.mb-enemy h3')).toHaveText(LONG_CLASS);
      const modifiers = dialog.locator('details.mb-modifier > summary');
      await expect(modifiers).toHaveCount(3);
      const sol = modifiers.filter({ hasText: 'Sol' });
      await expectTappable(sol);
      await sol.tap();
      await expect(dialog.locator('details.mb-modifier[open] > p')).toContainText('heal');
      expect(await clippedText(page, '.mb-forecast')).toEqual([]);
      [mine, theirs] = await layout();
      expect(theirs.top).toBeGreaterThanOrEqual(mine.bottom);

      // A weapon art: its HP cost, effect and uses read whole on the attack side.
      await closeAll(page);
      await battle(
        page,
        `const u = s.playerUnits.find((p) => p.name === 'Edric');
         u.inventory = [structuredClone(s.gameData.weapons.find((w) => w.name === 'Iron Sword'))];
         u.weapon = u.inventory[0];
         u.weapon.weaponArtIds = ['sword_wrath_strike'];
         const e = s.enemyUnits.find((x) => x.currentHP > 0);
         u.col = Math.max(0, e.col - 1); u.row = e.row; if (u.col === e.col) u.col += 1;
         s.selectUnit(u); s.hideActionMenu();
         s._setSelectedWeaponArt(u, 'sword_wrath_strike', u.weapon);
         return s.showForecast(u, e);`,
      );
      await expect(dialog.getByText(/^Wrath Strike · HP cost \d+ \(\d+ → \d+\)$/)).toBeVisible();
      await expect(dialog.getByText(/map uses left/)).toBeVisible();
      expect(await clippedText(page, '.mb-forecast')).toEqual([]);
      for (const name of ['Cancel', 'Confirm attack'])
        await expectTappable(dialog.getByRole('button', { name, exact: true }));
      expect(errors).toEqual([]);
    });

    test('End turn beside the terrain card; village Wait, greyed Attack and the healer note fit', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await boot(page, ROUTE, { hints: true, guidance: 'full' });
      // A village under Support (Wait visits it), a hurt caravan beside Sera, Patient
      // unarmed (#141), and the slot's hints so the healer note (#142) can show.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { createVillageState } = await import('/src/engine/VillageSystem.js');
        const { createCaravanUnit } = await import('/src/engine/CaravanSystem.js');
        const { HintManager } = await import('/src/engine/HintManager.js');
        const hints = new HintManager(9, () => true);
        hints.reset();
        for (const id of ['guide_first_turn', 'guide_commander_low_hp']) hints.markSeen(id);
        s.registry.set('hints', hints);
        const sup = s.playerUnits.find((p) => p.name === 'Support');
        s.battleConfig.villageTile = { col: sup.col, row: sup.row };
        s._villageState = createVillageState({ col: sup.col, row: sup.row });
        const sera = s.playerUnits.find((p) => p.name === 'Sera');
        const taken = new Set(
          [...s.playerUnits, ...s.enemyUnits, ...s.npcUnits].map((u) => `${u.col},${u.row}`),
        );
        const tile = [
          [0, -1],
          [1, 0],
          [-1, 0],
          [0, 1],
        ]
          .map(([dc, dr]) => ({ col: sera.col + dc, row: sera.row + dr }))
          .find((t) => t.col >= 0 && t.row >= 0 && !taken.has(`${t.col},${t.row}`));
        const caravan = createCaravanUnit('act2', tile);
        caravan.currentHP = 8;
        s.npcUnits.push(caravan);
        s.addUnitGraphic(caravan);
        s.battleConfig.caravanSpawn = tile;
        const pat = s.playerUnits.find((p) => p.name === 'Patient');
        pat.inventory = [];
        pat.weapon = null;
        pat.currentHP = pat.stats.HP; // only the caravan is hurt: the NPC wording
        s.updateObjectiveText();
        const u = s.playerUnits[0];
        s._inputController.refreshTileInfo(u.col, u.row);
      });
      const hud = rail(page);
      const tools = ['Overview', 'Recenter', 'Back', 'Menu'];
      await expect(hud.locator('.mb-terrain')).toBeVisible();
      await expect.poll(async () => (await bottomRow(page)).length).toBe(6);
      expectWholeRow(await bottomRow(page), ['End turn…', 'Danger', ...tools]);
      // The idle commands and Battle details are whole with the terrain card showing.
      const idle = await bodyControls(page);
      expect(idle.map((c) => [c.name, c.whole])).toEqual([
        ['Inspect', true],
        ['Roster', true],
        ['Rewind', true],
        ['Battle details', true],
      ]);
      // The side objectives ride under the objective without growing the header.
      await expect(hud.locator('.mb-objective-status')).toBeVisible();
      await expect(hud.locator('.mb-objective-status')).toHaveText(
        /Village intact\s*Caravan 8\/\d+ HP/,
      );
      await expectSingleLine(hud.locator('.mb-objective-part'));
      const header = await page.evaluate(() => ({
        phase: document.querySelector('.mobile-battle-hud .mb-phase').getBoundingClientRect()
          .height,
        objective: document
          .querySelector('.mobile-battle-hud .mb-objective-slot')
          .getBoundingClientRect().height,
      }));
      expect(header.objective).toBeLessThanOrEqual(header.phase + 0.5);
      expect(await clippedText(page, '.mobile-battle-hud')).toEqual([]);

      // Support on the village: Wait is pinned with its note, whole.
      await openMenu(page, 'Support');
      await expect(hud.locator('.mb-dock .mb-pinned-command')).toContainText('Visits village');
      expectWholeRow(await bottomRow(page), ['Wait', 'Danger', ...tools]);
      expect(await clippedText(page, '.mobile-battle-hud .mb-dock')).toEqual([]);
      await closeAll(page);

      // Patient, unarmed: the greyed Attack takes a row after the usable commands, its
      // reason on one line; those commands stay whole without a scroll.
      await openMenu(page, 'Patient');
      const attack = hud.locator('.mb-actions').getByRole('button', { name: /^Attack/ });
      await expect(attack).toBeDisabled();
      await expect(attack.locator('.mb-item-summary')).toHaveText(
        'Unarmed: no weapon to attack with',
      );
      await expectSingleLine(attack.locator('.mb-item-summary'));
      const controls = await bodyControls(page);
      const usable = controls.filter((c) => !c.disabled && c.name !== 'Battle details');
      const greyed = controls.find((c) => c.name.startsWith('Attack'));
      for (const c of usable) {
        expect(c.whole, `${c.name} needs no scroll`).toBe(true);
        expect(greyed.top).toBeGreaterThan(c.top);
      }
      const listWidth = await hud
        .locator('.mb-actions')
        .evaluate((n) => n.getBoundingClientRect().width);
      expect(Math.abs(greyed.width - listWidth)).toBeLessThan(1);
      await closeAll(page);

      // A real tap on Sera: the healer note names the caravan and stays off the rail.
      const at = await unitCss(page, 'Sera');
      await page.touchscreen.tap(at.x, at.y);
      const note = page.locator('.re-guide[data-guide="guide_healer_heals"]');
      await expect(note).toBeVisible();
      await expect(note).toContainText('caravan');
      const overlap = await page.evaluate(() => {
        const n = document.querySelector('.re-guide').getBoundingClientRect();
        const r = document.querySelector('.mobile-battle-hud').getBoundingClientRect();
        return n.bottom - r.top;
      });
      expect(overlap).toBeLessThanOrEqual(0.5);
      // The note's own buttons are 32px (guidance.css, outside this rail): whole and uncovered.
      await expectTappable(note.getByRole('button', { name: 'Got it', exact: true }), { min: 32 });
      expectWholeRow(await bottomRow(page), ['Wait', 'Danger', ...tools]);
    });
  });
}

test.describe('Formation upright', () => {
  test.use(phone(PORTRAIT_PHONES[0]));

  async function formation(page) {
    await quietSettings(page);
    await page.goto(`${ROUTE}&formation=1`);
    await waitForScene(page, 'Battle');
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle')._formation?.ready === true,
      null,
      { timeout: 30_000 },
    );
  }
  const formationTile = (page, i) =>
    battle(page, `const t = s._formation.tiles[a]; return { col: t.col, row: t.row };`, i).then(
      (t) => tileCss(page, t.col, t.row),
    );
  const placements = (page) =>
    battle(
      page,
      `const f = s._formation; return f.units.map((u, i) => [u.name, f.formation.at[i] === null ? null : { ...f.tiles[f.formation.at[i]] }]);`,
    );

  test('dock, bench and picker read whole; a tap on the turned board places the unit', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = pageErrors(page);
    await formation(page);
    expect(await battle(page, 'return s.grid.board.rotation')).toBe('ccw');
    // The longest names on the bench and in the picker; one unit carries nothing.
    await battle(
      page,
      `const f = s._formation;
       f.units[0].name = a.unit; f.units[1].name = 'Benedetta'; f.units[1].className = a.cls;
       f.units[4].inventory = []; f.units[4].weapon = null;
       f.touch();`,
      { unit: LONG_UNIT, cls: LONG_CLASS },
    );
    const hud = rail(page);
    const tools = ['Overview', 'Recenter', 'Back', 'Menu'];
    const start = 'Start battle (place everyone first: 0 of 5)';
    expectWholeRow(await bottomRow(page), [start, 'Danger', ...tools]);
    // The bench carries each unit's class, and marks the one that cannot fight.
    const patient = hud.getByRole('button', { name: /^Patient,/ });
    await expectTappable(patient);
    await expect(patient.locator('small')).toBeVisible();
    await expect(patient.locator('small')).toHaveText(/· Unarmed$/);
    await expectNoSidewaysScroll(page, '.mobile-battle-hud');

    // A real tap on the turned board opens that tile's picker; pick the long-named lord.
    const at = await formationTile(page, 2);
    await page.touchscreen.tap(at.x, at.y);
    const picker = page.getByRole('dialog', { name: 'Who stands here?', exact: true });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: startsWith(LONG_UNIT) }).tap();
    await expect(picker).toHaveCount(0);
    const tile2 = await battle(
      page,
      'const t = s._formation.tiles[2]; return { col: t.col, row: t.row };',
    );
    expect((await placements(page))[0]).toEqual([LONG_UNIT, tile2]);

    // Benedetta for that tile: the swap names who waits; emptying it names them too.
    await page.touchscreen.tap(at.x, at.y);
    await expect(picker).toBeVisible();
    const swap = picker.getByRole('button', { name: /^Benedetta/ });
    await expect(swap).toContainText(LONG_CLASS);
    const clear = picker.getByRole('button', { name: `Empty this tile (${LONG_UNIT} waits)` });
    await expectTappable(clear);
    expect(await clippedText(page, '.fm-picker')).toEqual([]);
    await expectNoSidewaysScroll(page);
    await picker.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(picker).toHaveCount(0);

    // Auto-place fills the rest; Start is whole and begins turn 1 with that formation.
    await hud.getByRole('button', { name: 'Auto-place', exact: true }).tap();
    await expect(hud).toContainText('5 / 5 placed');
    expectWholeRow(await bottomRow(page), ['Start battle', 'Danger', ...tools]);
    const chosen = await placements(page);
    await hud.getByRole('button', { name: 'Start battle', exact: true }).tap();
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
    expect(
      await battle(page, `return s.playerUnits.map((u) => [u.name, { col: u.col, row: u.row }]);`),
    ).toEqual(chosen);
    expect(errors).toEqual([]);
  });

  test('turning the phone mid-Formation keeps the board until turn 1, then re-opens it with the formation', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await formation(page);
    await attachSlot(page);
    expect(await battle(page, 'return s.grid.board.rotation')).toBe('ccw');

    // Sideways mid-placement: the layout follows the phone at once, the board waits.
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('.portrait-battle-notice')).toContainText('when your turn is ready');
    expect(await battle(page, 'return [s.grid.board.rotation, s.battleState]')).toEqual([
      'ccw',
      'DEPLOY_POSITIONING',
    ]);
    // The formation tiles stay in view and a real tap still places on the right tile.
    const inView = await battle(
      page,
      `const r = s.game.canvas.getBoundingClientRect();
       return s._formation.tiles.every((t) => {
         const w = s.grid.gridToPixel(t.col, t.row); const p = s._worldToScreen(w.x, w.y);
         const x = r.left + p.x * r.width / s.scale.width, y = r.top + p.y * r.height / s.scale.height;
         return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
       });`,
    );
    expect(inView).toBe(true);
    const at = await formationTile(page, 1);
    await page.touchscreen.tap(at.x, at.y);
    const picker = page.getByRole('dialog', { name: 'Who stands here?', exact: true });
    await picker.getByRole('button', { name: /^Edric/ }).tap();
    const tile1 = await battle(
      page,
      'const t = s._formation.tiles[1]; return { col: t.col, row: t.row };',
    );
    expect((await placements(page))[0]).toEqual(['Edric', tile1]);
    const hud = rail(page);
    await hud.getByRole('button', { name: 'Auto-place', exact: true }).tap();
    const chosen = await placements(page);

    // Start: turn 1 begins, then the board re-opens sideways with every unit in place.
    await hud.getByRole('button', { name: 'Start battle', exact: true }).tap();
    await expect
      .poll(() => battle(page, 'return s.grid?.board?.rotation'), { timeout: 30_000 })
      .toBe('none');
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE');
    expect(
      await battle(page, `return s.playerUnits.map((u) => [u.name, { col: u.col, row: u.row }]);`),
    ).toEqual(chosen);
    expect(await battle(page, 'return s.turnManager.turnNumber')).toBe(1);
  });
});

test.describe('deployment upright', () => {
  test.use(phone(PORTRAIT_PHONES[1]));

  test('the deploy menu is upright and Deploy opens the turned board at once, never re-opened', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await boot(page);
    // A roster larger than the act's limit brings up the deploy menu before the battle.
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { createUnit } = await import('/src/engine/UnitManager.js');
      const rm = s.runManager;
      for (const [name, cls] of [
        ['Garrick', 'Fighter'],
        ['Emmeline', 'Myrmidon'],
      ]) {
        const c = s.gameData.classes.find((x) => x.name === cls);
        rm.roster.push(createUnit(c, 1, s.gameData.weapons, { name }));
      }
      s.scene.restart({
        gameData: s.gameData,
        runManager: rm,
        roster: rm.getRoster(),
        nodeId: s.nodeId,
        battleParams: s.battleParams,
      });
    });
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'DEPLOY_SELECTION');
    const menu = page.getByRole('dialog', { name: 'Deploy units' });
    await expect(menu).toBeVisible();
    // Upright: no rotate prompt; no board yet, so no board class.
    await expectPortraitUi(page);
    expect(
      await page.evaluate(() => document.documentElement.classList.contains('portrait-battle')),
    ).toBe(false);
    const deploy = menu.getByRole('button', { name: 'Deploy', exact: true });
    await expectTappable(deploy);
    await deploy.tap();
    await page.waitForFunction(() => window.__sceneState?.battle?.state === 'PLAYER_IDLE', null, {
      timeout: 30_000,
    });
    // The board was chosen when Deploy began the battle: turned from its first frame,
    // the upright rail in place, no switch pending and no re-open.
    expect(await battle(page, 'return [s.grid.board.rotation, s._presentationSwitch]')).toEqual([
      'ccw',
      false,
    ]);
    expect(
      await page.evaluate(() => ({
        board: document.documentElement.classList.contains('portrait-battle'),
        notice: document.querySelectorAll('.portrait-battle-notice').length,
      })),
    ).toEqual({ board: true, notice: 0 });
    await expect(rail(page).getByRole('button', { name: 'End turn…', exact: true })).toBeInViewport(
      {
        ratio: 1,
      },
    );
  });
});

test.describe('tutorial note upright', () => {
  for (const viewport of PORTRAIT_PHONES.slice(0, 2)) {
    test.describe(`${viewport.width}x${viewport.height}`, () => {
      test.use(phone(viewport));
      test('the note spans the map above the rail, never over it', async ({ page }) => {
        test.setTimeout(90_000);
        await quietSettings(page, { hints: true });
        await page.goto('/');
        await waitForScene(page, 'Title');
        await page.getByRole('button', { name: /^Tutorial/ }).tap();
        await waitForScene(page, 'Battle');
        await expect(page.getByRole('region', { name: 'Tutorial guide', exact: true })).toBeVisible(
          {
            timeout: 20_000,
          },
        );
        await page.evaluate(async () => {
          const s = window.__emblemRogueGame.scene.getScene('Battle');
          const { showImportantHint } = await import('/src/ui/HintDisplay.js');
          window.__note = showImportantHint(
            s,
            'Forts heal a unit that starts its turn on them and add defence. Stand here to hold the line while the enemy comes to you.',
          );
        });
        const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
        await expect(note).toBeVisible();
        const box = await page.evaluate(() => {
          const n = document.querySelector('.re-tutorial-note').getBoundingClientRect();
          const r = document.querySelector('.mobile-battle-hud').getBoundingClientRect();
          return { left: n.left, right: n.right, bottom: n.bottom, top: n.top, railTop: r.top };
        });
        // Nearly the full width (12px margins), not a ~150px column; on the rail's edge.
        expect(box.right - box.left).toBeGreaterThanOrEqual(viewport.width - 24 - 1);
        expect(box.bottom).toBeLessThanOrEqual(box.railTop + 0.5);
        expect(box.top).toBeGreaterThanOrEqual(0);
        await expectTappable(note.getByRole('button', { name: 'Continue', exact: true }));
        expect(await clippedText(page, '.re-tutorial-note')).toEqual([]);
        await note.getByRole('button', { name: 'Continue', exact: true }).tap();
        await expect(note).toHaveCount(0);
      });
    });
  }
});

test.describe('tutorial forecast lessons upright', () => {
  test.use(phone(PORTRAIT_PHONES[0]));

  // A lesson over the forecast shows only the numbers it teaches, between the top and
  // the note. Stacked sides pushed the enemy's numbers under the note at 375x667.
  test('both sides of each lesson stay above the note', async ({ page }) => {
    test.setTimeout(120_000);
    await quietSettings(page, { hints: true });
    await page.goto('/');
    await waitForScene(page, 'Title');
    await page.getByRole('button', { name: /^Tutorial/ }).tap();
    await waitForScene(page, 'Battle');
    // Wait until the battle takes taps: a press while input is locked is not a tap.
    await page.waitForFunction(
      () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        return s.tutorialStep === 2 && s.battleState === 'PLAYER_IDLE' && !s.isStoryInputLocked();
      },
      null,
      { timeout: 20_000 },
    );
    const coach = page.getByRole('region', { name: 'Tutorial guide', exact: true });
    const tapTile = async (col, row) => {
      const p = await tileCss(page, col, row);
      await page.touchscreen.tap(p.x, p.y);
    };
    const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
    await tapTile(1, 2);
    await expect(coach.locator('.re-coach-goal')).toHaveText('Move onto the Fort');
    await tapTile(3, 3);
    await expect(note).toContainText('Fort tile reached');
    await note.getByRole('button', { name: 'Continue', exact: true }).tap();
    await page.waitForFunction(
      () => window.__emblemRogueGame.scene.getScene('Battle')._tutorialStrictGateReleased,
    );
    for (const expected of ['Review damage per hit', 'Weapon triangle', 'Attack speed']) {
      // The landscape lesson spec's controlled matchup (tutorial-lessons.spec.js).
      await battle(
        page,
        `const u = s.playerUnits[0], d = s.enemyUnits[0];
         s.hideForecast(); s.hideActionMenu();
         u.skills = []; d.skills = []; u.accessory = null; d.accessory = null;
         u.stats.SPD = 20; d.stats.SPD = 1; u.stats.STR = 10; d.stats.HP = 100; d.currentHP = 100;
         d.col = u.col + 1; d.row = u.row;
         u.weapon = { ...s.gameData.weapons.find((w) => w.name === 'Iron Sword') }; u.inventory = [u.weapon];
         d.weapon = { ...s.gameData.weapons.find((w) => w.name === 'Iron Axe') }; d.inventory = [d.weapon];
         void s.showForecast(u, d);`,
      );
      await expect(note).toContainText(expected);
      await expect(page.locator('.mb-tutorial-forecast')).toBeVisible();
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const top = document.querySelector('.re-tutorial-note').getBoundingClientRect().top;
              const subjects = [...document.querySelectorAll('.mb-tutorial-subject')];
              return (
                subjects.length > 0 &&
                subjects.every((el) => {
                  const r = el.getBoundingClientRect();
                  return r.height > 0 && r.top >= 0 && r.bottom <= top - 1;
                })
              );
            }),
          { timeout: 15_000 },
        )
        .toBe(true);
      await note.getByRole('button', { name: 'Continue', exact: true }).tap();
      await expect(note).toHaveCount(0);
      await page
        .getByRole('dialog', { name: 'Combat forecast', exact: true })
        .getByRole('button', { name: 'Cancel', exact: true })
        .tap();
    }
  });
});

test.describe('side objectives', () => {
  test.use(phone(PORTRAIT_PHONES[0]));

  test('village and caravan read in the compact header as they change; the fog hides the caravan', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await boot(page);
    const hud = rail(page);
    const status = hud.locator('.mb-objective-status');
    await expect(status).toHaveCount(0);
    await page.evaluate(async () => {
      const s = window.__emblemRogueGame.scene.getScene('Battle');
      const { createVillageState } = await import('/src/engine/VillageSystem.js');
      const { createCaravanUnit } = await import('/src/engine/CaravanSystem.js');
      const sup = s.playerUnits.find((p) => p.name === 'Support');
      s.battleConfig.villageTile = { col: sup.col, row: sup.row };
      s._villageState = createVillageState({ col: sup.col, row: sup.row });
      const taken = new Set(
        [...s.playerUnits, ...s.enemyUnits, ...s.npcUnits].map((u) => `${u.col},${u.row}`),
      );
      let tile = null;
      for (let d = 2; !tile && d < 6; d++)
        for (const t of [
          { col: sup.col, row: sup.row - d },
          { col: sup.col + d, row: sup.row },
          { col: sup.col - d, row: sup.row },
        ])
          if (!tile && t.col >= 0 && t.row >= 0 && t.col < s.grid.cols && t.row < s.grid.rows)
            if (!taken.has(`${t.col},${t.row}`)) tile = t;
      const caravan = createCaravanUnit('act2', tile);
      s.npcUnits.push(caravan);
      s.addUnitGraphic(caravan);
      s.battleConfig.caravanSpawn = tile;
      s.updateObjectiveText();
    });
    await expect(status).toBeVisible();
    await expect(status).toHaveText(/^Village intact\s*Caravan (\d+)\/\1 HP$/);
    // A real Wait on the village tile visits it.
    await openMenu(page, 'Support');
    await hud.locator('.mb-dock').getByRole('button', { name: 'Wait', exact: true }).tap();
    await expect(status.locator('[data-objective="village"]')).toHaveText('Village visited');
    await expect(status.locator('[data-objective="village"]')).toHaveClass(/is-good/);
    // Hurt to half: a warning; out of sight in fog: no HP; gone with its tile in sight: lost.
    await battle(
      page,
      `const c = s.npcUnits.find((u) => u.isCaravan); c.currentHP = Math.floor(c.stats.HP / 2);`,
    );
    await expect(status.locator('[data-objective="caravan"]')).toHaveClass(/is-warn/);
    await battle(
      page,
      `const c = s.npcUnits.find((u) => u.isCaravan);
       s.grid.fogEnabled = true; const seen = s.grid.isVisible.bind(s.grid);
       s.grid.isVisible = (col, row) => (col === c.col && row === c.row ? false : seen(col, row));`,
    );
    await expect(status.locator('[data-objective="caravan"]')).toHaveText('Caravan in fog');
    await battle(
      page,
      `const c = s.npcUnits.find((u) => u.isCaravan); c.currentHP = 0;
       s.npcUnits.splice(s.npcUnits.indexOf(c), 1);`,
    );
    await expect(status.locator('[data-objective="caravan"]')).toHaveText('Caravan in fog');
    await battle(
      page,
      `s.grid.fogEnabled = false; s._mobileBattleHud.lastSnapshot = ''; s._mobileBattleHud.sync();`,
    );
    await expect(status.locator('[data-objective="caravan"]')).toHaveText('Caravan lost');
    await expectSingleLine(status.locator('.mb-objective-part'));
  });
});

test.describe('input lifecycle', () => {
  test.use(phone(PORTRAIT_PHONES[1]));

  test('a finger lifted with no press on record never acts on the board; real taps still do', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await boot(page);
    await attachSlot(page);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, p) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y, id: 1 }],
      });
    const selected = () => battle(page, 'return [s.battleState, s.selectedUnit?.name ?? null]');

    // Pressed during a story lock (dialogue), lifted after it closed: not a tap.
    let at = await unitCss(page, 'Edric');
    await battle(page, 's._storyDialogueActive = true;');
    await touch('touchStart', at);
    await battle(page, 's._storyDialogueActive = false;');
    await touch('touchEnd', at);
    await expect.poll(selected).toEqual(['PLAYER_IDLE', null]);

    // Held through a re-open of the battle (the checkpoint path an orientation switch
    // uses), lifted on the new board over a unit: not a tap.
    at = await unitCss(page, 'Sera');
    await touch('touchStart', at);
    expect(await battle(page, 'return s._portraitBattle._switch();')).toBe(true);
    await page.waitForFunction(
      () =>
        window.__sceneState?.battle?.state === 'PLAYER_IDLE' &&
        window.__emblemRogueGame.scene.getScene('Battle')._presentationSwitch,
    );
    at = await unitCss(page, 'Sera');
    await touch('touchEnd', at);
    await expect.poll(selected).toEqual(['PLAYER_IDLE', null]);

    // A real tap selects (the next press is not eaten).
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(selected).toEqual(['UNIT_ACTION_MENU', 'Sera']);
  });
});

// Landscape phones and desktops: every rule added for the upright rail stays inert.
for (const viewport of LANDSCAPE_PHONES) {
  test.describe(`landscape ${viewport.width}x${viewport.height}`, () => {
    test.use(phone(viewport));

    test('the side rail, its lists, the forecast and the tutorial inset are unchanged', async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await boot(page);
      await expectPortraitUi(page, false);
      const hud = rail(page);
      const style = (sel, props) =>
        page.evaluate(
          ([s, p]) => {
            const el = document.querySelector(s);
            const cs = getComputedStyle(el);
            return Object.fromEntries(p.map((k) => [k, cs[k]]));
          },
          [sel, props],
        );
      const columns = (sel) =>
        page.evaluate(
          (s) => getComputedStyle(document.querySelector(s)).gridTemplateColumns.split(' ').length,
          sel,
        );
      // A village makes the side-objective line exist; sideways it is not shown.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { createVillageState } = await import('/src/engine/VillageSystem.js');
        const u = s.playerUnits[1];
        s.battleConfig.villageTile = { col: u.col, row: u.row };
        s._villageState = createVillageState({ col: u.col, row: u.row });
        s.updateObjectiveText();
        s._inputController.refreshTileInfo(u.col, u.row);
      });
      await expect(hud.locator('.mb-objective-status')).toHaveCount(1);
      await expect(hud.locator('.mb-objective-status')).toBeHidden();
      expect(await style('.mobile-battle-hud', ['display', 'flexDirection'])).toEqual({
        display: 'flex',
        flexDirection: 'column',
      });
      expect(await style('.mobile-battle-hud .mb-terrain', ['display'])).toEqual({
        display: 'grid',
      });

      // A unit's menu: two across; the turn and objective stay in the header.
      await openMenu(page, 'Sera');
      expect(await columns('.mobile-battle-hud .mb-actions')).toBe(2);
      await expect(hud.locator('.mb-phase')).toBeVisible();
      await expect(hud.locator('.mb-objective-slot')).toBeVisible();
      await hud.locator('.mb-actions').getByRole('button', { name: 'Equip', exact: true }).tap();
      expect(await columns('.mobile-battle-hud .mb-actions.mb-submenu')).toBe(1);
      expect(
        await style('.mobile-battle-hud .mb-actions.mb-submenu > .mb-button', ['textAlign']),
      ).toEqual({
        textAlign: 'center',
      });
      await closeAll(page);

      // The forecast: two sides side by side; the name and HP keep their own lines.
      await battle(
        page,
        `const u = s.playerUnits.find((p) => p.name === 'Edric');
         const e = s.enemyUnits.find((x) => x.currentHP > 0);
         u.col = Math.max(0, e.col - 1); u.row = e.row; if (u.col === e.col) u.col += 1;
         s.selectUnit(u); s.hideActionMenu(); return s.showForecast(u, e);`,
      );
      await expect(page.getByRole('dialog', { name: 'Combat forecast' })).toBeVisible();
      expect(await columns('.mb-forecast-sides')).toBe(2);
      expect(await style('.mb-forecast-who', ['display'])).toEqual({ display: 'contents' });
      const hpBelowName = await page.evaluate(() => {
        const side = document.querySelector('.mb-forecast-side');
        return (
          side.querySelector('.mb-hp').getBoundingClientRect().top >=
          side.querySelector('h3').getBoundingClientRect().bottom - 0.5
        );
      });
      expect(hpBelowName).toBe(true);
      await closeAll(page);

      // A tutorial note keeps its side inset: it ends where the side rail begins.
      await page.evaluate(async () => {
        const s = window.__emblemRogueGame.scene.getScene('Battle');
        const { showImportantHint } = await import('/src/ui/HintDisplay.js');
        s.battleParams.tutorialMode = true; // the note's tutorial styling, nothing else
        window.__note = showImportantHint(s, 'Forts heal a unit that starts its turn on them.');
        s.battleParams.tutorialMode = false;
      });
      const note = page.getByRole('dialog', { name: 'Field notes', exact: true });
      await expect(note).toBeVisible();
      const inset = await page.evaluate(() => {
        const shield = document.querySelector('.re-modal-shield:has(.re-tutorial-note)');
        const railBox = document.querySelector('.mobile-battle-hud').getBoundingClientRect();
        return { shieldRight: shield.getBoundingClientRect().right, railLeft: railBox.left };
      });
      expect(Math.abs(inset.shieldRight - inset.railLeft)).toBeLessThanOrEqual(1);
      await note.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(note).toHaveCount(0);

      // Formation's dock: Start and Danger split evenly, as before.
      await page.goto(`${ROUTE}&formation=1`);
      await page.waitForFunction(
        () => window.__emblemRogueGame?.scene?.getScene('Battle')?._formation?.ready === true,
        null,
        { timeout: 30_000 },
      );
      const dock = await page.evaluate(() =>
        [...document.querySelectorAll('.mb-dock.is-formation > button')].map((b) =>
          Math.round(b.getBoundingClientRect().width),
        ),
      );
      expect(dock.length).toBe(2);
      expect(Math.abs(dock[0] - dock[1])).toBeLessThanOrEqual(1);
      await expect(page.locator('.mobile-battle-hud .fm-chip-text small').first()).toBeHidden();
    });
  });
}

for (const viewport of DESKTOPS) {
  test(`desktop ${viewport.width}x${viewport.height}: no rail, no portrait classes, the formation dock unchanged`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await quietSettings(page);
    await page.goto(`${ROUTE}&formation=1`);
    await page.waitForFunction(
      () => window.__emblemRogueGame?.scene?.getScene('Battle')?._formation?.ready === true,
      null,
      { timeout: 30_000 },
    );
    expect(
      await page.evaluate(() => ({
        rail: document.querySelectorAll('.mobile-battle-hud').length,
        classes: ['portrait-ui', 'portrait-battle', 'portrait-battle-capable'].filter((c) =>
          document.documentElement.classList.contains(c),
        ),
      })),
    ).toEqual({ rail: 0, classes: [] });
    // The desktop dock keeps each unit's class line.
    await expect(page.locator('.fm-dock .fm-chip-text small').first()).toBeVisible();
  });
}
